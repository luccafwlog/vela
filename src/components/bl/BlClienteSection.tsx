import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Search, X } from 'lucide-react'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { Field, Input } from '../ui/Input'
import { ReviewCustomerOnboarding, type ReviewCustomerOnboardingInput } from '../review/ReviewCustomerOnboarding'
import { BlPortalCard, type BlPortalStatus } from './BlPortalCard'
import { useConfirm } from '../ui/ConfirmDialog'
import { useToast } from '../ui/Toast'
import { useAuth } from '../../hooks/useAuth'
import { useOverrideCustomers } from '../../hooks/useLocalCharges'
import { useCustomerLookup } from '../../hooks/useCustomers'
import { useReviewCustomerGroup } from '../../hooks/useReviewCustomerGroup'
import type { ReviewQueueItem } from '../../hooks/useReview'
import { groupReviewItems } from '../../pages/revisaoHelpers'
import { canonicalizeDocument } from '../../lib/cnpj'
import { formatBRL, formatCnpjCpf } from '../../lib/utils'
import { userFacingErrorMessage } from '../../lib/errors'
import { afterBlEstadoAlterado, afterBlRevisado } from '../../services/cacheEffects'
import { sendReviewPortalInvite } from '../../services/reviewCustomerGroup'
import { tryAutoIssueInvoice } from '../../services/reviewBillingAutomation'
import { createCustomer, findCustomerIdByDocument } from '../../services/customers'
import { linkBlCustomer } from '../../services/review'
import { queryKeys } from '../../services/queryKeys'
import type { BLDetail } from '../../types/database'

const RECONCILIATION: Record<string, { label: string; tone: 'green' | 'blue' | 'yellow' | 'red' }> = {
  reconciled: { label: 'Reconciliado', tone: 'green' },
  matched_document: { label: 'Conferido por CNPJ', tone: 'blue' },
  matched_name: { label: 'Conferido por nome', tone: 'yellow' },
  rejected: { label: 'Rejeitado', tone: 'red' },
}

type Candidate = { id: number; name: string; cnpj_cpf: string | null }

// Vínculo do B/L com o cliente. Um só fluxo: a sugestão do manifesto e a busca
// no cadastro ficam no mesmo bloco, e o vínculo vive na Visão Geral porque
// afeta Portal, comunicação e faturamento, não só a fatura.
export function BlClienteSection({ bl, portalStatus }: { bl: BLDetail; portalStatus?: BlPortalStatus }) {
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const { showToast } = useToast()
  const confirm = useConfirm()
  const [picking, setPicking] = useState(false)
  const [search, setSearch] = useState('')
  const [saving, setSaving] = useState(false)
  const [completing, setCompleting] = useState(false)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [inviteEmail, setInviteEmail] = useState(bl.manifest_customer_email?.trim() ?? '')
  const [failedInvite, setFailedInvite] = useState<{ customerId: number; email: string } | null>(null)
  const onboarding = useReviewCustomerGroup()
  const customerLookup = useCustomerLookup(bl.customer?.cnpj_cpf ?? '')
  const searching = search.trim().length >= 2
  const { data: options, isFetching } = useOverrideCustomers(searching ? search : '')

  const linked = bl.customer ?? null
  const manifestName = bl.manifest_customer_name?.trim() || null
  const manifestDocument = bl.manifest_customer_cnpj_cpf?.trim() || null
  const manifestDiverges = Boolean(linked && manifestDocument && linked.cnpj_cpf
    && canonicalizeDocument(linked.cnpj_cpf) !== canonicalizeDocument(manifestDocument))
  const reconciliation = RECONCILIATION[bl.customer_reconciliation_status ?? ''] ?? { label: 'Conciliação pendente', tone: 'yellow' as const }
  const showPicker = !linked || picking
  const reviewCustomer = customerLookup.data?.find((customer) => customer.id === linked?.id) ?? linked
  const knownContacts = reviewCustomer && 'customer_contacts' in reviewCustomer ? reviewCustomer.customer_contacts as { email: string | null }[] | null : null
  const customerEmail = knownContacts?.find((contact) => contact.email?.trim())?.email ?? bl.manifest_customer_email ?? ''
  const reviewGroup = groupReviewItems([{ ...bl, customer: reviewCustomer, source: 'bl' } as ReviewQueueItem])[0]
  const showOnboarding = bl.review_status === 'pending_review' && !picking && (!linked || completing)

  async function refresh() {
    await Promise.all([
      afterBlRevisado(queryClient, { blId: bl.id, includeCustomers: true, includeCharges: true, includeInvoices: true, includePortal: true }),
      afterBlEstadoAlterado(queryClient, { blId: bl.id, voyageId: bl.voyage_id }),
      queryClient.invalidateQueries({ queryKey: queryKeys.portal.blStatus(bl.id) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.bls.timeline(bl.id) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.bls.localChargeLines(bl.id) }),
      queryClient.invalidateQueries({ queryKey: ['customer-detail'] }),
    ])
  }

  async function completeCustomer(input: ReviewCustomerOnboardingInput) {
    if (!user) return
    if (!(await confirm({
      title: input.customerId ? 'Vincular cliente ao B/L' : 'Cadastrar cliente pelo B/L',
      message: `Salvar ${input.name} (${formatCnpjCpf(input.cnpjCpf)}) e vincular ao B/L ${bl.id}?`,
      confirmLabel: input.sendPortalInvite ? 'Salvar e enviar convite' : 'Salvar cadastro',
      affected: { summary: `B/L ${bl.id} · ${input.name} · ${formatCnpjCpf(input.cnpjCpf)}` },
      consequence: `Salva o cliente e o contato ${input.email}.${input.sendPortalInvite ? ` Inicia também o convite do Portal para ${input.email}.` : ''} Se esta correção liberar o B/L, a fatura poderá ser emitida automaticamente.`,
      reversibility: 'Cadastro e contato podem ser corrigidos; o convite pode ser revogado. Faturas emitidas só podem ser canceladas pelo Administrativo quando não houver pagamento.',
    }))) return
    setSaving(true)
    try {
      const result = await onboarding.mutateAsync({ ...input, blIds: [bl.id], changedBy: user.id })
      setCompleting(false)
      setFailedInvite(result.portalInvite === 'failed' ? { customerId: result.onboarding.customer.id, email: input.email } : null)
      let billingMessage = ''
      if (result.onboarding.bls.some((entry) => entry.blId === bl.id && entry.resolved)) {
        try {
          const invoice = await tryAutoIssueInvoice({ blId: bl.id, customerId: result.onboarding.customer.id, actorId: user.id })
          if (invoice.status === 'invoiced') billingMessage = ' Fatura emitida.'
          else if (invoice.unexpected) billingMessage = ' Não foi possível concluir o faturamento; confira a aba Faturamento.'
        } catch {
          billingMessage = ' Não foi possível concluir o faturamento; confira a aba Faturamento.'
        }
      }
      await refresh()
      const inviteMessage = result.portalInvite === 'failed'
        ? ' O cadastro foi concluído, mas não foi possível iniciar o convite do Portal.'
        : result.portalInvite === 'sent' ? ' Convite do Portal iniciado para o e-mail informado.' : ''
      showToast(`Cliente vinculado.${inviteMessage}${billingMessage}`, result.portalInvite === 'failed' || billingMessage.includes('Não foi possível') ? 'info' : 'success')
    } catch (error) {
      await refresh()
      showToast(error instanceof Error ? error.message : userFacingErrorMessage(error, 'Falha ao cadastrar ou vincular cliente.'), 'error')
    } finally {
      setSaving(false)
    }
  }

  async function invite(customerId: number, email: string) {
    const normalizedEmail = email.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      showToast('Informe um e-mail válido para o convite.', 'error')
      return
    }
    if (!(await confirm({
      title: 'Enviar convite do Portal',
      message: `Iniciar o convite do Portal para ${normalizedEmail}?`,
      confirmLabel: 'Enviar convite',
      consequence: 'O cliente receberá o convite para ativar o acesso ao Portal. O vínculo deste B/L é preservado.',
      reversibility: 'O convite pode ser revogado em Provisionamento do Portal.',
    }))) return
    setSaving(true)
    try {
      await sendReviewPortalInvite(customerId, normalizedEmail)
      setFailedInvite(null)
      setInviteOpen(false)
      await refresh()
      showToast('Convite do Portal iniciado.', 'success')
    } catch (error) {
      setFailedInvite({ customerId, email: normalizedEmail })
      showToast(error instanceof Error ? error.message : userFacingErrorMessage(error, 'Falha ao iniciar o convite do Portal.'), 'error')
    } finally {
      setSaving(false)
    }
  }

  function confirmLink(target: { name: string } | null, extra = '') {
    return confirm({
      title: target ? 'Vincular cliente' : 'Desvincular cliente',
      message: target ? `Vincular o B/L ${bl.id} a ${target.name}?` : `Desvincular ${linked?.name ?? 'o cliente'} do B/L ${bl.id}?`,
      changes: [{ field: 'Cliente', before: linked?.name ?? 'Sem cliente', after: target?.name ?? 'Sem cliente' }],
      consequence: target
        ? `${extra}O B/L passa a aparecer no Portal deste cliente e entra no faturamento dele.`
        : 'O B/L sai do Portal do cliente e não pode ser faturado até receber outro cliente.',
      reversibility: 'Pode ser trocado ou desfeito nesta mesma ficha. Fica no histórico.',
      confirmLabel: target ? 'Vincular' : 'Desvincular',
      tone: target ? 'primary' : 'danger',
    })
  }

  async function save(customerId: number | null) {
    if (!user) return
    await linkBlCustomer({
      blId: bl.id,
      customerId,
      previousCustomerId: bl.customer_id != null ? Number(bl.customer_id) : null,
      changedBy: user.id,
      expectedUpdatedAt: bl.updated_at ?? null,
    })
    await Promise.all([
      afterBlEstadoAlterado(queryClient, { blId: bl.id, voyageId: bl.voyage_id }),
      queryClient.invalidateQueries({ queryKey: queryKeys.portal.blStatus(bl.id) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.bls.timeline(bl.id) }),
    ])
    showToast(customerId != null ? 'Cliente vinculado.' : 'Cliente desvinculado.', 'success')
    setFailedInvite(null)
    setInviteOpen(false)
    setSearch('')
    setPicking(false)
  }

  async function link(target: Candidate | null) {
    if (!user || !(await confirmLink(target))) return
    setSaving(true)
    try {
      await save(target?.id ?? null)
    } catch (error) {
      await refresh()
      showToast(userFacingErrorMessage(error, 'Falha ao alterar o cliente do B/L.'), 'error')
    } finally {
      setSaving(false)
    }
  }

  // Cliente do manifesto: usa o cadastro existente pelo CNPJ; só cadastra
  // (depois da confirmação) quando não existe, e aí o e-mail do manifesto vira
  // o contato principal.
  async function linkManifestCustomer() {
    if (!user || !manifestName || !manifestDocument) return
    setSaving(true)
    try {
      const existingId = await findCustomerIdByDocument(manifestDocument)
      const email = bl.manifest_customer_email?.trim()
      if (existingId == null && (!email || !email.includes('@'))) {
        showToast('O cliente do manifesto não está cadastrado e o manifesto não traz e-mail. Cadastre-o em Clientes e vincule pela busca.', 'error')
        return
      }
      const extra = existingId == null ? 'O cliente é cadastrado com o e-mail do manifesto como contato principal. ' : ''
      if (!(await confirmLink({ name: manifestName }, extra))) return
      let customerId = existingId
      if (customerId == null) {
        try {
          customerId = (await createCustomer({
            cnpjCpf: manifestDocument,
            name: manifestName,
            contacts: [{
              name: 'Contato manifesto',
              email: email!,
              purpose: 'geral' as const,
              is_primary: true,
              box_codes: ['documentacao_operacao', 'financeiro', 'demurrage'],
            }],
          })).id
        } catch (error) {
          const duplicate = typeof error === 'object' && error !== null && 'code' in error && error.code === '23505'
          if (!duplicate) throw error
          customerId = await findCustomerIdByDocument(manifestDocument)
          if (customerId == null) throw error
        }
      }
      await save(customerId)
    } catch (error) {
      showToast(userFacingErrorMessage(error, 'Falha ao vincular o cliente do manifesto.'), 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className="lg:col-span-2">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Cliente e Portal</h3>
        {linked ? <Badge tone={reconciliation.tone}>{reconciliation.label}</Badge> : <Badge tone="yellow">Sem cliente vinculado</Badge>}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="min-w-0">

          {linked ? (
            <div className="grid gap-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 text-sm">
                  {linked.cnpj_cpf ? (
                    <Link className="font-semibold text-[var(--app-link)] hover:underline" to={`/clientes/${encodeURIComponent(linked.cnpj_cpf)}`}>
                      {linked.name}
                    </Link>
                  ) : <span className="font-semibold text-[var(--app-text-strong)]">{linked.name}</span>}
                  <div className="font-mono text-xs text-[var(--app-muted)]">{formatCnpjCpf(linked.cnpj_cpf)}</div>
                  <div className="mt-1 text-xs text-[var(--app-muted)]">Saldo pendente: {formatBRL(linked.pending_balance ?? 0)}</div>
                </div>
                {!picking ? (
                  <div className="flex gap-2">
                    <Button type="button" variant="secondary" onClick={() => setPicking(true)} disabled={saving}>Trocar</Button>
                    <Button type="button" variant="ghost" onClick={() => void link(null)} loading={saving}>Desvincular</Button>
                  </div>
                ) : null}
              </div>
              {manifestDiverges ? (
                <p className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs text-[var(--app-text)]">
                  O manifesto declara outro cliente: {manifestName ?? '—'} ({formatCnpjCpf(manifestDocument)}).
                </p>
              ) : null}
            </div>
          ) : null}

          {showOnboarding ? (
            <ReviewCustomerOnboarding
              key={`${bl.id}:${reviewCustomer?.id ?? 'new'}:${customerEmail}:${completing}`}
              embedded
              group={reviewGroup}
              existingCustomerId={reviewCustomer?.id ?? null}
              existingCustomer={reviewCustomer ?? null}
              initialName={reviewCustomer?.name ?? manifestName ?? bl.consignee ?? ''}
              initialCnpj={reviewCustomer?.cnpj_cpf ?? manifestDocument ?? ''}
              initialEmail={customerEmail}
              saving={saving || onboarding.isPending}
              onSelectExistingCustomer={() => undefined}
              onSubmit={(input) => void completeCustomer(input)}
            />
          ) : showPicker ? (
            <div className={linked ? 'mt-4 grid gap-3 border-t border-[var(--app-border)] pt-4' : 'grid gap-3'}>
              {!linked && manifestName && manifestDocument ? (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--app-border)] bg-[var(--app-surface-muted)] px-3 py-2">
                  <div className="min-w-0 text-sm">
                    <div className="text-xs text-[var(--app-muted)]">Declarado no manifesto</div>
                    <div className="font-semibold text-[var(--app-text-strong)]">{manifestName}</div>
                    <div className="font-mono text-xs text-[var(--app-muted)]">{formatCnpjCpf(manifestDocument)}</div>
                  </div>
                  <Button type="button" onClick={() => void linkManifestCustomer()} loading={saving}>Vincular</Button>
                </div>
              ) : null}
              <div className="relative">
                <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--app-muted)]" aria-hidden="true" />
                <Input
                  aria-label="Buscar cliente no cadastro"
                  className="pl-8"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={!linked && manifestName ? 'Ou busque outro cliente por razão social ou CNPJ' : 'Buscar cliente por razão social ou CNPJ'}
                />
              </div>
              {searching ? (
                <ul className="grid max-h-60 gap-1 overflow-y-auto" aria-label="Clientes encontrados">
                  {(options ?? []).slice(0, 8).map((option) => (
                    <li key={option.id} className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 hover:bg-[var(--app-surface-muted)]">
                      <div className="min-w-0 text-sm">
                        <div className="truncate font-medium text-[var(--app-text-strong)]">{option.name}</div>
                        <div className="font-mono text-xs text-[var(--app-muted)]">{formatCnpjCpf(option.cnpj_cpf)}</div>
                      </div>
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={saving || option.id === linked?.id}
                        onClick={() => void link({ id: option.id, name: option.name, cnpj_cpf: option.cnpj_cpf })}
                      >
                        {option.id === linked?.id ? 'Atual' : 'Vincular'}
                      </Button>
                    </li>
                  ))}
                  {!isFetching && !(options ?? []).length ? (
                    <li className="px-2 py-1.5 text-sm text-[var(--app-muted)]">Nenhum cliente encontrado.</li>
                  ) : null}
                </ul>
              ) : null}
              {linked ? (
                <div>
                  <Button type="button" variant="ghost" onClick={() => { setPicking(false); setSearch('') }}>
                    <X size={14} />
                    Cancelar troca
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}
          {linked && bl.review_status === 'pending_review' && !picking ? (
            <Button type="button" variant="secondary" className="mt-3" disabled={saving} onClick={() => setCompleting(!completing)}>
              {completing ? 'Voltar' : 'Completar cadastro e convidar'}
            </Button>
          ) : null}
        </div>
        <div className="grid content-start gap-3 border-t border-[var(--app-border)] pt-4 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
          {portalStatus ? <BlPortalCard status={portalStatus} embedded /> : <p className="text-sm text-[var(--app-muted)]">Verificando situação do Portal…</p>}
          {failedInvite ? (
            <div role="status" className="grid gap-2 text-sm">
              <p>Cadastro concluído. O convite para {failedInvite.email} precisa de nova tentativa.</p>
              <Button type="button" variant="secondary" loading={saving} onClick={() => void invite(failedInvite.customerId, failedInvite.email)}>Tentar convite novamente</Button>
            </div>
          ) : linked && portalStatus?.visibility.reasons.some((reason) => reason.includes('Conta do Portal')) && !showOnboarding ? (
            <Button type="button" variant="secondary" disabled={saving} onClick={() => { setInviteOpen(!inviteOpen); setInviteEmail(customerEmail) }}>Enviar convite do Portal</Button>
          ) : null}
          {inviteOpen && linked ? (
            <div className="grid gap-3">
              <Field label="E-mail do convite"><Input type="email" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} /></Field>
              <Button type="button" loading={saving} onClick={() => void invite(linked.id, inviteEmail)}>Confirmar envio do convite</Button>
            </div>
          ) : null}
        </div>
      </div>
    </Card>
  )
}
