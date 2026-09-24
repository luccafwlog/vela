import { useState } from 'react'
import { Button } from '../ui/Button'
import { Card, InlineError } from '../ui/Card'
import { Badge } from '../ui/Badge'
import { Field, Input, Textarea } from '../ui/Input'
import { useConfirm } from '../ui/ConfirmDialog'
import { useToast } from '../ui/Toast'
import { useAuth } from '../../hooks/useAuth'
import { useBillingPortalRelease, useGrantBillingPortalRelease, useRevokeBillingPortalRelease } from '../../hooks/useBillingPortalRelease'
import { billingPortalReleaseState } from '../../services/billingPortalRelease'
import { formatDate } from '../../lib/utils'

const STATE_BADGE = {
  vigente: { tone: 'green', label: 'Vigente' },
  vencida: { tone: 'yellow', label: 'Vencida' },
  revogada: { tone: 'slate', label: 'Revogada' },
} as const

// Teto da migration 084 (decisão de 2026-09-24); o banco recusa além disso.
const MAX_REVIEW_DAYS = 30

function todayPlusDays(days: number) {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return date.toLocaleDateString('en-CA')
}

/**
 * Liberação de faturamento sem Portal (ADR 0070). Sem Portal pronto, o CE
 * retém a fatura; a liberação, concedida pelo Administrativo com justificativa
 * e data de revisão, emite o que estava retido. Vencida a data, a trava volta.
 */
export function BillingPortalReleaseCard({ customerId, portalReady, variant = 'card' }: {
  customerId: number
  portalReady?: boolean
  variant?: 'card' | 'embedded'
}) {
  const { effectiveRole } = useAuth()
  const canManage = effectiveRole === 'administrativo'
  const confirm = useConfirm()
  const { showToast } = useToast()
  const { data: release, isLoading, isError } = useBillingPortalRelease(customerId)
  const grant = useGrantBillingPortalRelease()
  const revoke = useRevokeBillingPortalRelease()
  const [justification, setJustification] = useState('')
  const [reviewDate, setReviewDate] = useState(todayPlusDays(MAX_REVIEW_DAYS))
  const [revokeReason, setRevokeReason] = useState('')
  const [error, setError] = useState('')
  const state = release ? billingPortalReleaseState(release) : null
  const busy = grant.isPending || revoke.isPending

  async function handleGrant() {
    setError('')
    if (justification.trim().length < 3) return setError('Informe a justificativa.')
    if (!reviewDate || reviewDate <= todayPlusDays(0)) return setError('A data de revisão precisa ser futura.')
    if (reviewDate > todayPlusDays(MAX_REVIEW_DAYS)) return setError(`A data de revisão pode ser no máximo ${MAX_REVIEW_DAYS} dias à frente.`)
    const ok = await confirm({
      title: 'Liberar faturamento sem Portal',
      message: 'As faturas retidas deste Cliente serão emitidas agora, e as próximas sairão sem esperar o Portal até a data de revisão.',
      confirmLabel: 'Liberar e emitir',
    })
    if (!ok) return
    try {
      const result = await grant.mutateAsync({ customerId, justification, reviewDate })
      const { issued, blocked } = result.reprocess
      showToast(
        issued > 0
          ? `Liberação concedida. ${issued === 1 ? '1 fatura emitida' : `${issued} faturas emitidas`}${blocked ? `; ${blocked} B/L segue com outro bloqueio na Validação` : ''}.`
          : 'Liberação concedida. Nenhuma fatura estava pronta para emitir.',
        'success',
      )
      setJustification('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível conceder a liberação.')
    }
  }

  async function handleRevoke() {
    setError('')
    if (revokeReason.trim().length < 3) return setError('Informe o motivo da revogação.')
    const ok = await confirm({
      title: 'Revogar liberação',
      message: 'Sem Portal pronto, as próximas faturas deste Cliente voltarão a ficar retidas.',
      confirmLabel: 'Revogar',
      tone: 'danger',
    })
    if (!ok) return
    try {
      await revoke.mutateAsync({ customerId, reason: revokeReason })
      showToast('Liberação revogada.', 'success')
      setRevokeReason('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível revogar a liberação.')
    }
  }

  const content = (
    <div className="grid gap-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold">Liberação de faturamento sem Portal</h3>
        {state ? <Badge tone={STATE_BADGE[state].tone}>{STATE_BADGE[state].label}</Badge> : null}
      </div>
      <p className="text-[var(--app-muted)]">
        {portalReady
          ? 'O Portal deste Cliente está pronto: o faturamento não depende de liberação.'
          : 'Sem Portal pronto, a fatura fica retida quando o CE Mercante é registrado. A liberação emite as retidas e vale até a data de revisão. Exige contato do Cliente com e-mail, que passa a ser o único canal da fatura.'}
      </p>
      {isLoading ? <div className="text-[var(--app-muted)]">Carregando…</div> : null}
      {isError ? <InlineError message="Erro ao carregar a liberação." /> : null}
      {release ? (
        <dl className="grid gap-1 rounded-lg border border-[var(--app-border)] p-3">
          <div><dt className="inline text-[var(--app-muted)]">Justificativa: </dt><dd className="inline">{release.justification}</dd></div>
          <div><dt className="inline text-[var(--app-muted)]">Concedida em: </dt><dd className="inline">{formatDate(release.granted_at)}</dd></div>
          <div><dt className="inline text-[var(--app-muted)]">Revisão em: </dt><dd className="inline">{formatDate(release.review_at)}</dd></div>
          {release.revoked_at ? (
            <div><dt className="inline text-[var(--app-muted)]">Revogada em: </dt><dd className="inline">{formatDate(release.revoked_at)} · {release.revoke_reason}</dd></div>
          ) : null}
        </dl>
      ) : null}
      {canManage && state === 'vigente' ? (
        <div className="grid gap-2">
          <Field label="Motivo da revogação" required>
            <Input value={revokeReason} onChange={(event) => setRevokeReason(event.target.value)} disabled={busy} />
          </Field>
          <div><Button variant="secondary" onClick={() => void handleRevoke()} disabled={busy}>Revogar liberação</Button></div>
        </div>
      ) : null}
      {canManage && !portalReady && state !== 'vigente' ? (
        <div className="grid gap-2">
          <Field label="Justificativa" required>
            <Textarea rows={2} value={justification} onChange={(event) => setJustification(event.target.value)} disabled={busy} />
          </Field>
          <Field label="Data de revisão" required hint={`Até ${MAX_REVIEW_DAYS} dias. Depois dela, as faturas voltam a ficar retidas até o Portal ficar pronto.`}>
            <Input type="date" min={todayPlusDays(1)} max={todayPlusDays(MAX_REVIEW_DAYS)} value={reviewDate} onChange={(event) => setReviewDate(event.target.value)} disabled={busy} />
          </Field>
          <div><Button onClick={() => void handleGrant()} disabled={busy}>Liberar faturamento</Button></div>
        </div>
      ) : null}
      {!canManage && !portalReady && state !== 'vigente' ? (
        <p className="text-[var(--app-muted)]">A liberação é concedida pelo Administrativo.</p>
      ) : null}
      {error ? <InlineError message={error} /> : null}
    </div>
  )

  return variant === 'card' ? <Card>{content}</Card> : content
}
