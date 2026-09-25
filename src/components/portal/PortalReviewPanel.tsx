import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '../ui/Button'
import { Card, InlineError } from '../ui/Card'
import { Field, Input, Textarea } from '../ui/Input'
import { useConfirm } from '../ui/ConfirmDialog'
import { useToast } from '../ui/Toast'
import { useAuth } from '../../hooks/useAuth'
import type { QueueRow } from '../../services/portalProvisioning'
import { useAdminChangeCnpj, useAssistedEmailChange, useCancelPortalInvite, usePortalEvents, useReleaseSuppressedEmail, useReturnToAnalysis, useSendPortalInvite, useSuspendPortalAccount } from '../../hooks/usePortalProvisioning'
import { accountSituationLabel, contactPurposeLabel, deliveryStatusLabel, hasBrokenRecoveryEmail, provisioningDecisionLabel, recoveryEmailSourceLabel, recoveryEmailStatusLabel } from '../../lib/portalProvisioningViewModel'
import { formatCnpjCpf } from '../../lib/utils'
import { CNPJ_INPUT_MAX_LENGTH, normalizeCnpj } from '../../lib/cnpj'
import { BillingPortalReleaseCard } from '../clientes/BillingPortalReleaseCard'
import { isPortalReadyForBilling } from '../../lib/portalProvisioningViewModel'

type Props = {
  row: QueueRow
  variant?: 'inline' | 'embedded'
  onSaved?: () => void
  onClose?: () => void
}

export function PortalReviewPanel({ row, variant = 'embedded', onSaved, onClose }: Props) {
  const { can, isAdmin, effectiveRole } = useAuth()
  const canProvision = can ? can('portal_provisioning') : isAdmin
  const isOperations = effectiveRole === 'operacoes'
  const canReadEvents = ['administrativo', 'documentacao', 'financeiro', 'operacoes', 'equipamentos'].includes(effectiveRole ?? '')
  const confirm = useConfirm()
  const { showToast } = useToast()
  const [email, setEmail] = useState(row.recovery_email ?? '')
  const [newCnpj, setNewCnpj] = useState(row.cnpj_cpf)
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const { data: events = [] } = usePortalEvents(row.customer_id, canReadEvents)
  const sendInviteMutation = useSendPortalInvite()
  const cancelInviteMutation = useCancelPortalInvite()
  const suspendMutation = useSuspendPortalAccount()
  const assistedEmailMutation = useAssistedEmailChange()
  const adminCnpjMutation = useAdminChangeCnpj()
  const returnToAnalysisMutation = useReturnToAnalysis()
  const releaseSuppressedMutation = useReleaseSuppressedEmail()
  const busy = sendInviteMutation.isPending || cancelInviteMutation.isPending || suspendMutation.isPending
    || assistedEmailMutation.isPending || returnToAnalysisMutation.isPending
    || releaseSuppressedMutation.isPending
  const hasValidRecoveryEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
  const canUseRecoveryEmail = canProvision && hasValidRecoveryEmail && !busy

  async function sendInvite() {
    if (!hasValidRecoveryEmail) {
      setError('Informe um email de recuperação válido.')
      return
    }
    const authorized = await confirm({
      title: 'Autorizar email de recuperação',
      message: 'Você confirma que este email pertence à pessoa autorizada pelo Cliente?',
      confirmLabel: 'Enviar convite',
    })
    if (!authorized) return
    try {
      await sendInviteMutation.mutateAsync({ customerId: row.customer_id, recoveryEmail: email.trim(), source: row.candidates.some((candidate) => candidate.email === email.trim()) ? 'candidato' : 'informado_manualmente' })
      showToast('Convite enviado.', 'success'); onSaved?.()
    } catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível enviar o convite.') }
  }

  async function cancelInvite() {
    if (!reason.trim()) { setError('Informe a justificativa.'); return }
    const confirmed = await confirm({
      title: 'Revogar convite do Portal',
      message: `Revogar o convite de acesso ao Portal de ${row.customer_name}?`,
      consequence: 'O link enviado deixa de funcionar e o cliente não consegue ativar a conta por ele.',
      reversibility: 'Enviar um novo convite.',
      confirmLabel: 'Revogar convite',
      tone: 'danger',
    })
    if (!confirmed) return
    try { await cancelInviteMutation.mutateAsync({ customerId: row.customer_id, reason: reason.trim() }); showToast('Convite revogado.', 'success'); onSaved?.() }
    catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível revogar o convite.') }
  }

  async function changeAccount(action: 'suspend' | 'reactivate') {
    if (!reason.trim()) { setError('Informe a justificativa.'); return }
    try { await suspendMutation.mutateAsync({ customerId: row.customer_id, action, reason: reason.trim() }); showToast('Situação da conta atualizada.', 'success'); onSaved?.() }
    catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível atualizar a conta.') }
  }

  async function reopenAnalysis() {
    if (!reason.trim()) { setError('Informe a justificativa.'); return }
    try {
      await returnToAnalysisMutation.mutateAsync({ customerId: row.customer_id, reason: reason.trim() })
      showToast('Decisão do Portal atualizada.', 'success'); onSaved?.()
    } catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível atualizar a decisão.') }
  }

  async function assistedEmailChange() {
    if (!hasValidRecoveryEmail || !reason.trim()) { setError('Informe um email de recuperação válido e a justificativa.'); return }
    try { await assistedEmailMutation.mutateAsync({ customerId: row.customer_id, email: email.trim(), reason: reason.trim() }); showToast('Email alterado por atendimento.', 'success'); onSaved?.() }
    catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível alterar o email.') }
  }

  // Desbloquear reexpoe o dominio de envio a bounces. A confirmacao explicita e
  // a justificativa obrigatoria existem para que a liberacao seja uma decisao
  // registrada, e nao um botao de habito -- a RPC grava quem liberou e por que.
  async function releaseSuppressedEmail() {
    const target = row.recovery_email?.trim()
    if (!target) { setError('Não há Email de Recuperação para liberar.'); return }
    if (!reason.trim()) { setError('Informe a justificativa.'); return }
    const authorized = await confirm({
      title: 'Liberar endereço bloqueado',
      message: 'O endereço voltará a receber emails do Portal. Se a caixa ainda estiver morta, cada novo envio gasta a reputação do domínio. Confirme que o Cliente informou que o endereço voltou.',
      confirmLabel: 'Liberar endereço',
    })
    if (!authorized) return
    try { await releaseSuppressedMutation.mutateAsync({ customerId: row.customer_id, email: target, reason: reason.trim() }); showToast('Endereço liberado da lista de bloqueio.', 'success'); onSaved?.() }
    catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível liberar o endereço.') }
  }

  async function adminCnpjChange() {
    if (!newCnpj.trim() || !reason.trim()) { setError('Informe CNPJ e justificativa.'); return }
    try { await adminCnpjMutation.mutateAsync({ customerId: row.customer_id, cnpj: normalizeCnpj(newCnpj), reason: reason.trim() }) }
    catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível alterar o CNPJ.'); return }
    showToast('CNPJ alterado de forma auditada.', 'success'); onSaved?.()
  }

  return (
    <Card className={variant === 'inline' ? 'overflow-hidden' : 'overflow-y-auto'} aria-label="Revisão do Portal">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-wider text-[var(--app-muted)]">Revisão do Portal</div>
          <h2 className="mt-1 text-xl font-semibold">{row.customer_name}</h2>
          <p className="font-mono text-sm text-[var(--app-muted)]">{formatCnpjCpf(row.cnpj_cpf)}</p>
        </div>
        <div className="flex items-center gap-2"><Link to={`/clientes/portal/inspecao/${row.customer_id}?origem=${variant === 'inline' ? 'provisionamento' : 'ficha'}`} target={variant === 'inline' ? '_blank' : undefined} className="rounded-lg border border-cyan-400/50 px-3 py-2 text-sm font-medium text-cyan-200">{row.account_situation === 'ativo' ? 'Ver como o cliente vê' : 'Ver o que o cliente veria'}</Link>{onClose ? <Button variant="ghost" onClick={onClose}>Fechar</Button> : null}</div>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <div><div className="text-xs text-[var(--app-muted)]">Situação</div><div>{accountSituationLabel(row.account_situation)}</div></div>
        <div><div className="text-xs text-[var(--app-muted)]">Decisão</div><div>{provisioningDecisionLabel(row.provisioning_decision)}</div></div>
        <div><div className="text-xs text-[var(--app-muted)]">Email atual</div><div>{row.recovery_email ?? 'Não informado'}</div></div>
        <div><div className="text-xs text-[var(--app-muted)]">Origem</div><div>{recoveryEmailSourceLabel(row.recovery_email_source)}</div></div>
        <div><div className="text-xs text-[var(--app-muted)]">Entrega</div><div>{deliveryStatusLabel(row.latestDeliveryStatus)}</div></div>
        <div><div className="text-xs text-[var(--app-muted)]">Email de Recuperação</div><div>{recoveryEmailStatusLabel(row.recoveryEmailStatus)}</div></div>
      </div>

      {/* A conta segue ativa e o cliente entra com a senha; o que quebrou foi o
          endereco para onde a recuperacao seria enviada. Sem este aviso, o unico
          sinal era um alerta na fila, e a recuperacao respondia "enviamos" em
          silencio -- correto contra enumeracao, e mudo para o operador. */}
      {!isOperations && hasBrokenRecoveryEmail(row) ? (
        <p className="mt-4 rounded-lg border border-red-400/40 bg-red-950/20 p-3 text-sm text-red-100">
          O Email de Recuperação deste Cliente {row.recoveryEmailSuppressed ? 'está na lista de bloqueio de envio' : 'apresentou falha permanente'}. A conta continua funcionando com a senha,
          mas a recuperação de senha não chega. Informe outro endereço ou libere o atual quando o Cliente confirmar que a caixa voltou.
        </p>
      ) : null}

      {!isOperations ? <section className="mt-6 grid gap-3">
        <h3 className="font-semibold">Candidatos de email</h3>
        {row.candidates.length ? row.candidates.map((candidate) => (
          <button key={`${candidate.email}-${candidate.purpose}`} type="button" className="rounded-lg border border-[var(--app-border)] px-3 py-2 text-left hover:border-cyan-400" onClick={() => setEmail(candidate.email)}>
            <div className="font-medium">{candidate.email}</div>
            <div className="text-xs text-[var(--app-muted)]">{contactPurposeLabel(candidate.purpose)} · {candidate.origin}</div>
          </button>
        )) : <p className="text-sm text-[var(--app-muted)]">Nenhum contato com email disponível.</p>}
      </section> : null}

      {!isOperations && row.sharedEmailCount > 0 ? <p className="mt-3 rounded-lg border border-amber-400/40 bg-amber-950/20 p-3 text-sm text-amber-100">Este email também aparece em {row.sharedEmailCount} outro(s) CNPJ(s). A análise manual continua obrigatória.</p> : null}
      {!isOperations ? <div className="mt-5 grid gap-3">
        <Field label="Email de Recuperação"><Input type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></Field>
        {email && !hasValidRecoveryEmail ? <p className="text-xs text-red-200">Informe um email válido.</p> : null}
        {email && hasValidRecoveryEmail && !row.candidates.some((candidate) => candidate.email === email) ? <p className="text-xs text-amber-200">Email informado manualmente; será usado apenas como Email de Recuperação.</p> : null}
        {error ? <InlineError message={error} /> : null}
        {['sem_conta', 'convite_pendente', 'convite_expirado'].includes(row.account_situation) ? <Button onClick={sendInvite} disabled={!canUseRecoveryEmail}>{row.account_situation === 'convite_pendente' || row.account_situation === 'convite_expirado' ? 'Reenviar convite' : 'Enviar convite'}</Button> : null}
        {row.account_situation === 'falha_no_envio' ? <Button onClick={sendInvite} disabled={!canUseRecoveryEmail}>Revisar email e reenviar</Button> : null}
        {row.account_situation === 'ativo' ? <Button variant="secondary" onClick={() => void assistedEmailChange()} disabled={!canUseRecoveryEmail}>Trocar Email de Recuperação</Button> : null}
      </div> : null}

      {isAdmin && !isOperations ? <div className="mt-5 grid gap-3 border-t border-[var(--app-border)] pt-5"><Field label="Novo CNPJ"><Input maxLength={CNPJ_INPUT_MAX_LENGTH} value={newCnpj} onChange={(event) => setNewCnpj(normalizeCnpj(event.target.value))} /></Field><Button variant="secondary" onClick={() => void adminCnpjChange()} disabled={!newCnpj.trim() || newCnpj === row.cnpj_cpf || busy}>Alterar CNPJ auditado</Button></div> : null}

      {!isOperations && row.account_situation === 'convite_pendente' ? (
        <div className="mt-6 grid gap-3 border-t border-[var(--app-border)] pt-5">
          <Field label="Justificativa"><Textarea value={reason} onChange={(event) => setReason(event.target.value)} /></Field>
          <p className="text-sm text-[var(--app-muted)]">Cancelar invalida o link atual e devolve o Cliente à fila de análise.</p>
          <Button variant="secondary" onClick={cancelInvite} disabled={!canProvision || busy}>Revogar convite</Button>
        </div>
      ) : null}

      {!isOperations ? <details className="mt-6 border-t border-[var(--app-border)] pt-5">
        <summary className="cursor-pointer font-semibold">Ações administrativas</summary>
        <div className="mt-4 grid gap-3">
        <Field label="Justificativa para ações administrativas"><Textarea value={reason} onChange={(event) => setReason(event.target.value)} /></Field>
        {row.account_situation === 'ativo' ? <p className="text-sm text-[var(--app-muted)]">Suspender encerra as sessões ativas do Cliente.</p> : null}
        {row.account_situation === 'suspenso' ? <p className="text-sm text-[var(--app-muted)]">Reativar devolve o cliente à fila de análise para um novo convite.</p> : null}
        {row.recoveryEmailSuppressed ? <p className="text-sm text-[var(--app-muted)]">Liberar devolve o endereço à fila de envio e registra quem liberou e por quê. O bloqueio é opinião do provedor sobre um instante: caixa cheia, servidor em manutenção e domínio em migração dão o mesmo sintoma de endereço morto.</p> : null}
        <div className="flex flex-wrap gap-2">
          {row.account_situation === 'ativo' || row.account_situation === 'suspenso' ? <Button variant="secondary" onClick={() => void changeAccount(row.account_situation === 'ativo' ? 'suspend' : 'reactivate')} disabled={!canProvision || busy}>{row.account_situation === 'ativo' ? 'Suspender conta' : 'Reativar conta'}</Button> : null}
          {row.recoveryEmailSuppressed ? <Button variant="secondary" onClick={() => void releaseSuppressedEmail()} disabled={!canProvision || busy}>Liberar endereço bloqueado</Button> : null}
          {row.provisioning_decision !== 'aguardando_analise' ? <Button variant="secondary" onClick={() => void reopenAnalysis()} disabled={!canProvision || busy}>Reabrir análise</Button> : null}
        </div>
        </div>
      </details> : null}

      {!isOperations ? <section className="mt-6 border-t border-[var(--app-border)] pt-5">
        <BillingPortalReleaseCard customerId={row.customer_id} portalReady={isPortalReadyForBilling(row)} variant="embedded" />
      </section> : null}

      {canReadEvents ? <section className="mt-6 border-t border-[var(--app-border)] pt-5">
        <h3 className="font-semibold">Histórico</h3>
        {events.length ? <ol className="mt-3 grid gap-2 text-sm">{events.slice(0, 10).map((event) => <li key={event.id} className="rounded border border-[var(--app-border)] p-2"><div>{event.reason ?? 'Evento do Portal'}</div><div className="text-xs text-[var(--app-muted)]">{accountSituationLabel(event.new_situation)} · {event.created_at ? new Date(event.created_at).toLocaleString('pt-BR') : 'Não informado'}</div></li>)}</ol> : <p className="mt-2 text-sm text-[var(--app-muted)]">Nenhum evento registrado.</p>}
      </section> : null}

      <Link className="mt-6 inline-block text-sm text-cyan-300 hover:text-cyan-200" to={`/clientes/${row.cnpj_cpf}`}>Abrir ficha completa →</Link>
    </Card>
  )
}
