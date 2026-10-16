import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Block, Fact, FactList, LeadValue } from '../ui/Block'
import { Button } from '../ui/Button'
import { Field, Input } from '../ui/Input'
import { NoValue } from '../ui/NoValue'
import { useConfirm } from '../ui/ConfirmDialog'
import { useAuth } from '../../hooks/useAuth'
import { usePortalProvisioningForCustomer, useSendPortalInvite } from '../../hooks/usePortalProvisioning'
import type { ReviewCustomer } from '../../hooks/useReview'
import {
  accountSituationLabel,
  deliveryStatusLabel,
  hasBrokenRecoveryEmail,
  provisioningDecisionLabel,
} from '../../lib/portalProvisioningViewModel'
import type { AccountSituation, QueueRow } from '../../services/portalProvisioning'
import { extractErrorText } from '../../lib/errors'
import { formatCnpjCpf, formatDate } from '../../lib/utils'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** E-mail que o convite usaria: o já autorizado, senão o primeiro candidato. */
function inviteEmail(row: QueueRow | undefined) {
  return row?.recovery_email ?? row?.candidates[0]?.email ?? null
}

function emailOrigin(row: QueueRow | undefined, email: string | null) {
  if (!row || !email) return null
  if (row.recovery_email === email) return row.recovery_email_source === 'candidato' ? 'Escolhido entre os contatos' : 'Informado manualmente'
  const candidate = row.candidates.find((entry) => entry.email === email)
  return candidate ? `Contato do Cliente · ${candidate.origin}` : null
}

const SEND_LABELS: Partial<Record<AccountSituation, string>> = {
  sem_conta: 'Autorizar e enviar convite',
  convite_pendente: 'Reenviar convite',
  convite_expirado: 'Enviar novo convite',
  falha_no_envio: 'Reenviar convite',
}

/**
 * Caso D da Revisão: o Cliente está cadastrado e o Portal está pendente. O dado
 * principal é a situação da conta, e a ação muda com ela. As ações do
 * Provisionamento ficam aqui (decisão de 2026-10-16); a Liberação de
 * faturamento sem Portal fica só na ficha do Cliente.
 */
export function ReviewPortalBlock({ customer, blCount }: { customer: ReviewCustomer; blCount: number }) {
  const { can } = useAuth()
  const canProvision = can?.('portal_provisioning') ?? false
  const confirm = useConfirm()
  const provisioning = usePortalProvisioningForCustomer(customer.id)
  const sendInvite = useSendPortalInvite()
  const row = provisioning.data
  const suggested = inviteEmail(row)
  const [otherEmail, setOtherEmail] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sentTo, setSentTo] = useState<string | null>(null)
  const situation: AccountSituation = row?.account_situation ?? 'sem_conta'
  const email = (otherEmail ?? suggested ?? '').trim().toLowerCase()
  const emailValid = EMAIL_PATTERN.test(email)
  const sendLabel = SEND_LABELS[situation]
  const ficha = `/clientes/${encodeURIComponent(customer.cnpj_cpf)}`

  async function handleSend() {
    if (!row || !emailValid || !sendLabel) return
    const confirmed = await confirm({
      title: sendLabel,
      message: `Enviar o convite do Portal de ${customer.name} para ${email}?`,
      confirmLabel: 'Enviar convite',
      affected: { summary: `${customer.name} · ${formatCnpjCpf(customer.cnpj_cpf)}` },
      consequence: `Autoriza ${email} como Email de Recuperação do Portal e envia o convite. ${blCount === 1 ? 'O B/L sai' : 'Os B/Ls saem'} da Revisão quando o Cliente ativar a conta.`,
      reversibility: 'O convite pode ser revogado no Provisionamento do Portal enquanto não for aceito.',
    })
    if (!confirmed) return
    setError(null)
    try {
      await sendInvite.mutateAsync({
        customerId: customer.id,
        recoveryEmail: email,
        source: row.candidates.some((candidate) => candidate.email === email) ? 'candidato' : 'informado_manualmente',
      })
      setSentTo(email)
      setOtherEmail(null)
    } catch (err) {
      setError(extractErrorText(err) || 'Não foi possível enviar o convite.')
    }
  }

  const lead = provisioning.isLoading
    ? 'Consultando o Portal…'
    : provisioning.isError
      ? 'Situação do Portal indisponível'
      : accountSituationLabel(situation)
  const leadTone = situation === 'convite_pendente' ? 'default' : 'warning'

  return (
    <Block
      title="Portal do Cliente"
      headingLevel={3}
      aside={<Link className="app-btn app-btn--secondary app-btn--sm" to={`${ficha}?tab=financeiro`}>Liberação na ficha do Cliente</Link>}
    >
      <div className="grid gap-4">
        <LeadValue tone={provisioning.isError ? 'warning' : leadTone} detail="A fatura só sai com o Portal ativo ou com a Liberação de faturamento sem Portal, concedida na ficha do Cliente.">
          {lead}
        </LeadValue>
        <FactList columns={4}>
          <Fact label="E-mail para o convite">{suggested ?? <NoValue label="Nenhum e-mail disponível" />}</Fact>
          <Fact label="Origem do e-mail">{emailOrigin(row, suggested) ?? <NoValue label="Sem origem" />}</Fact>
          <Fact label="Provisionamento">{row ? provisioningDecisionLabel(row.provisioning_decision) : <NoValue />}</Fact>
          <Fact label={situation === 'convite_pendente' || situation === 'convite_expirado' ? 'Convite expira em' : 'Último envio'}>
            {situation === 'convite_pendente' || situation === 'convite_expirado'
              ? (row?.pending_invite_expires_at ? formatDate(row.pending_invite_expires_at) : <NoValue />)
              : (row?.latestDeliveryStatus ? deliveryStatusLabel(row.latestDeliveryStatus) : <NoValue label="Nenhum envio" />)}
          </Fact>
        </FactList>
        {row && hasBrokenRecoveryEmail(row) ? (
          <p className="app-status-text app-status-text--warning">O Email de Recuperação apresentou falha permanente. Use outro e-mail.</p>
        ) : null}

        {otherEmail !== null ? (
          <Field label="Outro e-mail para o convite">
            <Input type="email" value={otherEmail} onChange={(event) => setOtherEmail(event.target.value)} placeholder="financeiro@cliente.com.br" />
          </Field>
        ) : null}

        {sentTo ? <p role="status">Convite enviado para <strong>{sentTo}</strong>. {blCount === 1 ? 'O B/L sai' : 'Os B/Ls saem'} da Revisão quando o Cliente ativar a conta.</p> : null}
        {error ? <p role="alert" className="app-status-text app-status-text--warning">{error}</p> : null}

        <div className="flex flex-wrap items-center gap-2">
          {situation === 'suspenso' ? (
            <Link className="app-btn app-btn--primary app-btn--sm" to={`/clientes/portal?cliente=${customer.id}`}>Abrir no Provisionamento do Portal</Link>
          ) : canProvision && sendLabel ? (
            <>
              <Button className="app-btn--sm" disabled={!row || !emailValid} loading={sendInvite.isPending} loadingLabel="Enviando…" onClick={() => void handleSend()}>
                {sendLabel}
              </Button>
              <Button variant="secondary" className="app-btn--sm" onClick={() => setOtherEmail(otherEmail === null ? '' : null)}>
                {otherEmail === null ? 'Usar outro e-mail' : 'Voltar ao e-mail sugerido'}
              </Button>
            </>
          ) : !canProvision ? (
            <p className="text-[var(--app-muted)]">O convite do Portal é enviado pela Documentação ou pelo Administrativo.</p>
          ) : row ? (
            // Conta ativa ou situação sem convite a enviar: a fila só sai quando o servidor reavaliar.
            <Link className="app-btn app-btn--secondary app-btn--sm" to={`/clientes/portal?cliente=${customer.id}`}>Abrir no Provisionamento do Portal</Link>
          ) : null}
        </div>
      </div>
    </Block>
  )
}
