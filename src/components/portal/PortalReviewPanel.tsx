import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Eye } from 'lucide-react'
import { Button } from '../ui/Button'
import { InlineError } from '../ui/Card'
import { Block, Fact, FactList, LeadValue } from '../ui/Block'
import { ChoiceCards } from '../ui/ChoiceCards'
import { Modal } from '../ui/Modal'
import { NoValue } from '../ui/NoValue'
import { StatusText } from '../ui/StatusText'
import { Field, Input, Textarea } from '../ui/Input'
import { useConfirm } from '../ui/ConfirmDialog'
import { useToast } from '../ui/Toast'
import { useAuth } from '../../hooks/useAuth'
import type { QueueRow } from '../../services/portalProvisioning'
import { useAdminChangeCnpj, useAssistedEmailChange, useCancelPortalInvite, usePortalEvents, useReleaseSuppressedEmail, useReturnToAnalysis, useSendPortalInvite, useSuspendPortalAccount } from '../../hooks/usePortalProvisioning'
import { accountSituationLabel, contactPurposeLabel, deliveryStatusLabel, hasBrokenRecoveryEmail, isPortalReadyForBilling, portalEventActorLabel, portalEventDescription, provisioningDecisionLabel, recoveryEmailSourceLabel, recoveryEmailStatusLabel } from '../../lib/portalProvisioningViewModel'
import { formatDateTime } from '../../lib/utils'
import { CNPJ_INPUT_MAX_LENGTH, normalizeCnpj } from '../../lib/cnpj'
import { BillingPortalReleaseCard } from '../clientes/BillingPortalReleaseCard'

type Props = {
  row: QueueRow
  variant?: 'inline' | 'embedded'
  onSaved?: () => void
  onClose?: () => void
}

type AdminAction = 'cnpj' | 'suspend' | 'reactivate' | 'release' | 'reopen' | 'revoke'
const OTHER_EMAIL = '__outro__'

const ADMIN_ACTIONS: Record<AdminAction, { title: string; description: string }> = {
  cnpj: { title: 'Alterar o CNPJ', description: 'Corrige o CNPJ do Cliente; fica registrado com quem alterou e por quê.' },
  suspend: { title: 'Suspender a conta', description: 'Encerra as sessões do Cliente no Portal.' },
  reactivate: { title: 'Reativar a conta', description: 'Devolve o Cliente à fila de análise para um novo convite.' },
  release: { title: 'Liberar endereço bloqueado', description: 'O endereço volta a receber e-mails do Portal; registra quem liberou e por quê.' },
  reopen: { title: 'Reabrir a análise', description: 'Devolve o Cliente para "Aguardando análise".' },
  revoke: { title: 'Revogar o convite', description: 'O link enviado deixa de funcionar e o Cliente volta à fila de análise.' },
}

/**
 * Conta do Portal de um Cliente: a linha aberta do Provisionamento e o bloco
 * "Acesso ao Portal" da ficha do Cliente (lote 5a). Blocos Conta do Portal,
 * Liberação de faturamento, E-mail de recuperação e convite e Histórico; as
 * ações administrativas abrem uma janela, sem sair da tela, e mostram só as
 * que valem para a situação da conta.
 */
export function PortalReviewPanel({ row, variant = 'embedded', onSaved, onClose }: Props) {
  const { can, isAdmin, effectiveRole } = useAuth()
  const canProvision = can ? can('portal_provisioning') : isAdmin
  const isOperations = effectiveRole === 'operacoes'
  const canReadEvents = ['administrativo', 'documentacao', 'financeiro', 'operacoes', 'equipamentos'].includes(effectiveRole ?? '')
  const confirm = useConfirm()
  const { showToast } = useToast()
  const initialChoice = row.recovery_email
    ? (row.candidates.some((candidate) => candidate.email === row.recovery_email) ? row.recovery_email : OTHER_EMAIL)
    : null
  const [emailChoice, setEmailChoice] = useState<string | null>(initialChoice)
  const [manualEmail, setManualEmail] = useState(initialChoice === OTHER_EMAIL ? row.recovery_email ?? '' : '')
  const [emailReason, setEmailReason] = useState('')
  const [error, setError] = useState('')
  const [adminOpen, setAdminOpen] = useState(false)
  const [adminAction, setAdminAction] = useState<AdminAction | null>(null)
  const [adminReason, setAdminReason] = useState('')
  const [newCnpj, setNewCnpj] = useState('')
  const [adminError, setAdminError] = useState('')
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
    || releaseSuppressedMutation.isPending || adminCnpjMutation.isPending
  const email = emailChoice === OTHER_EMAIL ? manualEmail.trim() : (emailChoice ?? '')
  const hasValidRecoveryEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  const canUseRecoveryEmail = canProvision && hasValidRecoveryEmail && !busy
  const situation = row.account_situation
  const isActive = situation === 'ativo'
  const brokenEmail = hasBrokenRecoveryEmail(row)

  async function sendInvite() {
    if (!hasValidRecoveryEmail) {
      setError('Informe um e-mail de recuperação válido.')
      return
    }
    const authorized = await confirm({
      title: 'Autorizar e-mail de recuperação',
      message: 'Você confirma que este e-mail pertence à pessoa autorizada pelo Cliente?',
      confirmLabel: 'Enviar convite',
    })
    if (!authorized) return
    try {
      await sendInviteMutation.mutateAsync({ customerId: row.customer_id, recoveryEmail: email, source: row.candidates.some((candidate) => candidate.email === email) ? 'candidato' : 'informado_manualmente' })
      showToast('Convite aceito pelo provedor de e-mail.', 'success'); onSaved?.()
    } catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível enviar o convite.') }
  }

  async function assistedEmailChange() {
    if (!hasValidRecoveryEmail || !emailReason.trim()) { setError('Informe um e-mail de recuperação válido e a justificativa.'); return }
    try {
      const notice = await assistedEmailMutation.mutateAsync({ customerId: row.customer_id, email, reason: emailReason.trim() })
      if (notice === 'falhou') showToast('E-mail alterado, mas o aviso ao endereço anterior não pôde ser enviado.', 'error')
      else showToast(notice === 'enviado' ? 'E-mail alterado. O endereço anterior foi avisado.' : 'E-mail alterado por atendimento.', 'success')
      onSaved?.()
    }
    catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível alterar o e-mail.') }
  }

  // Só as ações que valem para a situação desta conta. Alterar o CNPJ é do
  // Administrativo; as demais, de quem provisiona.
  const availableActions: AdminAction[] = [
    ...(isAdmin ? ['cnpj' as const] : []),
    ...(situation === 'ativo' ? ['suspend' as const] : []),
    ...(situation === 'suspenso' ? ['reactivate' as const] : []),
    ...(row.recoveryEmailSuppressed ? ['release' as const] : []),
    ...(row.provisioning_decision !== 'aguardando_analise' ? ['reopen' as const] : []),
    ...(situation === 'convite_pendente' ? ['revoke' as const] : []),
  ]

  function openAdmin() {
    setAdminAction(availableActions.length === 1 ? availableActions[0] : null)
    setAdminReason('')
    setNewCnpj('')
    setAdminError('')
    setAdminOpen(true)
  }

  async function runAdminAction() {
    if (!adminAction) return
    const reason = adminReason.trim()
    if (!reason) { setAdminError('Informe a justificativa.'); return }
    try {
      if (adminAction === 'cnpj') {
        const cnpj = normalizeCnpj(newCnpj)
        if (!cnpj || cnpj === row.cnpj_cpf) { setAdminError('Informe o novo CNPJ.'); return }
        await adminCnpjMutation.mutateAsync({ customerId: row.customer_id, cnpj, reason })
        showToast('CNPJ alterado de forma auditada.', 'success')
      } else if (adminAction === 'suspend' || adminAction === 'reactivate') {
        await suspendMutation.mutateAsync({ customerId: row.customer_id, action: adminAction, reason })
        showToast('Situação da conta atualizada.', 'success')
      } else if (adminAction === 'release') {
        const target = row.recovery_email?.trim()
        if (!target) { setAdminError('Não há e-mail de recuperação para liberar.'); return }
        // Desbloquear reexpõe o domínio de envio a devoluções: a confirmação
        // explícita e a justificativa fazem da liberação uma decisão registrada.
        const authorized = await confirm({
          title: 'Liberar endereço bloqueado',
          message: 'O endereço voltará a receber e-mails do Portal. Se a caixa ainda estiver morta, cada novo envio gasta a reputação do domínio. Confirme que o Cliente informou que o endereço voltou.',
          confirmLabel: 'Liberar endereço',
        })
        if (!authorized) return
        await releaseSuppressedMutation.mutateAsync({ customerId: row.customer_id, email: target, reason })
        showToast('Endereço liberado da lista de bloqueio.', 'success')
      } else if (adminAction === 'reopen') {
        await returnToAnalysisMutation.mutateAsync({ customerId: row.customer_id, reason })
        showToast('Decisão do Portal atualizada.', 'success')
      } else {
        const confirmed = await confirm({
          title: 'Revogar convite do Portal',
          message: `Revogar o convite de acesso ao Portal de ${row.customer_name}?`,
          consequence: 'O link enviado deixa de funcionar e o cliente não consegue ativar a conta por ele.',
          reversibility: 'Enviar um novo convite.',
          confirmLabel: 'Revogar convite',
          tone: 'danger',
        })
        if (!confirmed) return
        await cancelInviteMutation.mutateAsync({ customerId: row.customer_id, reason })
        showToast('Convite revogado.', 'success')
      }
      setAdminOpen(false)
      onSaved?.()
    } catch (err) {
      setAdminError(err instanceof Error ? err.message : 'Não foi possível concluir a ação.')
    }
  }

  const situationTone = situation === 'falha_no_envio' ? 'danger' : isActive && !brokenEmail ? 'default' : 'warning'
  const candidateOptions = [
    ...row.candidates.map((candidate) => ({
      value: candidate.email,
      title: candidate.email,
      description: `${candidate.origin} · caixa ${contactPurposeLabel(candidate.purpose)}`,
    })),
    { value: OTHER_EMAIL, title: 'Outro e-mail', description: 'Informado à mão; vale só como e-mail de recuperação.' },
  ]
  const inviteLabel = situation === 'convite_pendente' || situation === 'convite_expirado' ? 'Reenviar convite' : 'Enviar convite'

  return (
    <div className="grid gap-4" aria-label="Conta do Portal">
      <div className="grid gap-4 xl:grid-cols-2">
        <Block
          title="Conta do Portal"
          headingLevel={3}
          aside={(
            <span className="flex flex-wrap items-center gap-2">
              {variant === 'embedded' ? (
                <Link to={`/clientes/portal/inspecao/${row.customer_id}?origem=ficha`} className="app-btn app-btn--secondary app-btn--sm">
                  <Eye size={15} aria-hidden="true" />
                  {isActive ? 'Ver como o Cliente vê' : 'Ver o que o Cliente veria'}
                </Link>
              ) : (
                <Link to={`/clientes/${row.cnpj_cpf}`} className="app-btn app-btn--secondary app-btn--sm">Abrir ficha do Cliente</Link>
              )}
              {onClose ? <Button variant="ghost" className="app-btn--sm" onClick={onClose}>Fechar</Button> : null}
            </span>
          )}
        >
          <LeadValue tone={situationTone} detail={provisioningDecisionLabel(row.provisioning_decision)}>
            {accountSituationLabel(situation)}
          </LeadValue>
          <FactList columns={3}>
            <Fact label="E-mail de recuperação">{row.recovery_email ?? <NoValue label="Sem e-mail de recuperação" />}</Fact>
            <Fact label="Origem">{row.recovery_email ? recoveryEmailSourceLabel(row.recovery_email_source) : <NoValue label="Sem e-mail de recuperação" />}</Fact>
            <Fact label="Última entrega">{row.latestDeliveryStatus ? deliveryStatusLabel(row.latestDeliveryStatus) : <NoValue label="Nenhum envio" />}</Fact>
            {row.recovery_email ? <Fact label="Estado do e-mail">{recoveryEmailStatusLabel(row.recoveryEmailStatus)}</Fact> : null}
          </FactList>
          {/* A conta segue ativa e o cliente entra com a senha; o que quebrou foi
              o endereço para onde a recuperação seria enviada. Sem este aviso, o
              único sinal era um alerta na fila. */}
          {brokenEmail ? (
            <p className="mt-3">
              <StatusText tone="danger">
                O e-mail de recuperação deste Cliente {row.recoveryEmailSuppressed ? 'está na lista de bloqueio de envio' : 'apresentou falha permanente'}. A conta continua funcionando com a senha,
                mas a recuperação de senha não chega. Informe outro endereço ou libere o atual quando o Cliente confirmar que a caixa voltou.
              </StatusText>
            </p>
          ) : null}
        </Block>

        <BillingPortalReleaseCard customerId={row.customer_id} portalReady={isPortalReadyForBilling(row)} variant="card" />
      </div>

      {/* Operações lê e-mail, origem, entrega e contatos; as ações de
          provisionamento seguem de quem provisiona (ADR 0045; migration 250). */}
      {isOperations ? (
        <Block title="Contatos com e-mail" headingLevel={3}>
          {row.candidates.length ? (
            <ul className="grid gap-2">
              {row.candidates.map((candidate) => (
                <li key={`${candidate.email}-${candidate.purpose}`}>
                  <span className="font-medium">{candidate.email}</span>
                  <span className="text-[var(--app-muted)]"> · {candidate.origin} · caixa {contactPurposeLabel(candidate.purpose)}</span>
                </li>
              ))}
            </ul>
          ) : <p className="text-[var(--app-muted)]">Nenhum contato com e-mail.</p>}
          {row.recovery_email ? (
            <p className="mt-3">
              E-mail de recuperação: {row.recovery_email}
              {row.recovery_email_source ? ` · ${row.recovery_email_source === 'candidato' ? 'escolhido entre os contatos' : 'informado manualmente'}` : ''}
            </p>
          ) : null}
        </Block>
      ) : (
        <Block
          title="E-mail de recuperação e convite"
          headingLevel={3}
          aside={availableActions.length ? <Button variant="secondary" className="app-btn--sm" onClick={openAdmin}>Ações administrativas</Button> : null}
        >
          <div className="grid gap-3">
            {row.candidates.length === 0 ? <p className="text-[var(--app-muted)]">Nenhum contato do Cliente tem e-mail. Informe um e-mail abaixo.</p> : null}
            <ChoiceCards
              label={isActive ? 'Novo e-mail de recuperação' : 'E-mail de recuperação'}
              options={candidateOptions}
              value={emailChoice}
              onChange={(value) => { setEmailChoice(value); setError('') }}
              disabled={!canProvision}
            />
            {emailChoice === OTHER_EMAIL ? (
              <Field label="Outro e-mail" error={manualEmail && !hasValidRecoveryEmail ? 'Informe um e-mail válido.' : undefined}>
                <Input type="email" value={manualEmail} onChange={(event) => setManualEmail(event.target.value)} />
              </Field>
            ) : null}
            {row.sharedEmailCount > 0 ? (
              <p><StatusText tone="warning">Este e-mail também aparece em {row.sharedEmailCount} {row.sharedEmailCount === 1 ? 'outro CNPJ' : 'outros CNPJs'}. A análise manual continua obrigatória.</StatusText></p>
            ) : null}
            {isActive ? (
              <Field label="Justificativa da troca">
                <Textarea value={emailReason} onChange={(event) => setEmailReason(event.target.value)} />
              </Field>
            ) : null}
            {error ? <InlineError message={error} /> : null}
            <div className="flex flex-wrap gap-2">
              {['sem_conta', 'convite_pendente', 'convite_expirado'].includes(situation) ? (
                <Button onClick={() => void sendInvite()} disabled={!canUseRecoveryEmail}>
                  {hasValidRecoveryEmail ? `${inviteLabel} para ${email}` : inviteLabel}
                </Button>
              ) : null}
              {situation === 'falha_no_envio' ? <Button onClick={() => void sendInvite()} disabled={!canUseRecoveryEmail}>Revisar e-mail e reenviar</Button> : null}
              {isActive ? <Button variant="secondary" onClick={() => void assistedEmailChange()} disabled={!canUseRecoveryEmail || !emailReason.trim()}>Trocar e-mail de recuperação</Button> : null}
            </div>
          </div>
        </Block>
      )}

      {canReadEvents ? (
        <Block title="Histórico do Portal" headingLevel={3} flush>
          {events.length ? (
            <div className="app-table-scroll">
              <table className="app-table app-table--nested">
                <caption className="sr-only">Histórico do Portal</caption>
                <thead>
                  <tr>
                    <th scope="col">Quando</th>
                    <th scope="col" className="app-table__text-head">O que aconteceu</th>
                    <th scope="col">Conta</th>
                    <th scope="col">Por</th>
                  </tr>
                </thead>
                <tbody>
                  {events.slice(0, 10).map((event) => (
                    <tr key={event.id}>
                      <td className="whitespace-nowrap">{event.created_at ? formatDateTime(event.created_at) : <NoValue label="Sem data" />}</td>
                      <td className="app-table__text app-table__text--wrap">{portalEventDescription(event)}</td>
                      <td>{event.new_situation ? accountSituationLabel(event.new_situation) : <NoValue label="Sem mudança" />}</td>
                      <td>{portalEventActorLabel(event.actor_type) ?? <NoValue label="Sem autor" />}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="px-4 py-3 text-[var(--app-muted)]">Nenhum evento registrado.</p>}
        </Block>
      ) : null}

      <Modal open={adminOpen} title="Ações administrativas" onClose={() => setAdminOpen(false)} size="md">
        <div className="grid gap-4">
          <p className="text-[var(--app-muted)]">{row.customer_name}</p>
          <ChoiceCards
            label="O que fazer"
            options={availableActions.map((action) => ({ value: action, title: ADMIN_ACTIONS[action].title, description: ADMIN_ACTIONS[action].description }))}
            value={adminAction}
            onChange={(value) => { setAdminAction(value); setAdminError('') }}
          />
          {adminAction === 'cnpj' ? (
            <Field label="Novo CNPJ">
              <Input maxLength={CNPJ_INPUT_MAX_LENGTH} value={newCnpj} onChange={(event) => setNewCnpj(normalizeCnpj(event.target.value))} />
            </Field>
          ) : null}
          {adminAction ? (
            <Field label="Justificativa">
              <Textarea value={adminReason} onChange={(event) => setAdminReason(event.target.value)} placeholder="O que foi conferido e com quem" />
            </Field>
          ) : null}
          {adminError ? <InlineError message={adminError} /> : null}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setAdminOpen(false)} disabled={busy}>Voltar</Button>
            <Button
              variant={adminAction === 'revoke' || adminAction === 'suspend' ? 'danger' : 'primary'}
              onClick={() => void runAdminAction()}
              disabled={!adminAction || !adminReason.trim() || !canProvision || busy}
            >
              {adminAction ? ADMIN_ACTIONS[adminAction].title : 'Escolha a ação'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
