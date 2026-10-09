import { useEffect, useId, useRef, useState } from 'react'
import { Button } from '../ui/Button'
import { Card, InlineError } from '../ui/Card'
import { Badge } from '../ui/Badge'
import { Field, Input, Textarea } from '../ui/Input'
import { useConfirm, useConfirmWithReason } from '../ui/ConfirmDialog'
import { useToast } from '../ui/Toast'
import { useAuth } from '../../hooks/useAuth'
import { useBillingPortalRelease, useGrantBillingPortalRelease, useRevokeBillingPortalRelease } from '../../hooks/useBillingPortalRelease'
import { billingPortalReleaseState } from '../../services/billingPortalRelease'
import { userFacingErrorMessage } from '../../lib/errors'
import { formatDate } from '../../lib/utils'

const STATE_BADGE = {
  vigente: { tone: 'success', label: 'Vigente' },
  vencida: { tone: 'warning', label: 'Vencida' },
  revogada: { tone: 'neutral', label: 'Revogada' },
} as const

// Teto da migration 084 (decisão de 2026-09-24); o banco recusa além disso.
const MAX_REVIEW_DAYS = 30

function todayPlusDays(days: number) {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return date.toLocaleDateString('en-CA')
}

function plural(count: number, singular: string, pluralForm: string) {
  return `${count} ${count === 1 ? singular : pluralForm}`
}

/**
 * Liberação de faturamento sem Portal (ADR 0070). Sem Portal pronto, o CE
 * retém a fatura; a liberação, concedida pelo Administrativo com justificativa
 * e data de revisão, emite o que estava retido. Vencida a data, a trava volta.
 * Consumida na aba Financeiro da ficha e no `PortalReviewPanel` (console).
 */
export function BillingPortalReleaseCard({ customerId, portalReady, variant = 'card' }: {
  customerId: number
  portalReady?: boolean
  variant?: 'card' | 'embedded'
}) {
  const { effectiveRole } = useAuth()
  const canManage = effectiveRole === 'administrativo'
  const confirm = useConfirm()
  const confirmWithReason = useConfirmWithReason()
  const { showToast } = useToast()
  const formId = useId()
  const { data: release, isLoading, isError, refetch } = useBillingPortalRelease(customerId)
  const grant = useGrantBillingPortalRelease()
  const revoke = useRevokeBillingPortalRelease()
  const [formOpen, setFormOpen] = useState(false)
  const [justification, setJustification] = useState('')
  const [reviewDate, setReviewDate] = useState(todayPlusDays(MAX_REVIEW_DAYS))
  const [errors, setErrors] = useState<{ justification?: string; reviewDate?: string; submit?: string }>({})
  // Resultado da concessão fica no conteúdo: quantas faturas saíram e o que segue retido.
  const [outcome, setOutcome] = useState<string | null>(null)
  const state = release ? billingPortalReleaseState(release) : null
  const busy = grant.isPending || revoke.isPending
  const canGrant = canManage && !portalReady && state !== 'vigente'
  const formRef = useRef<HTMLFormElement>(null)

  // O botão que abre o formulário some ao abrir: o foco vai para a justificativa.
  useEffect(() => {
    if (formOpen) formRef.current?.querySelector('textarea')?.focus()
  }, [formOpen])

  async function handleGrant() {
    const nextErrors: typeof errors = {}
    if (justification.trim().length < 3) nextErrors.justification = 'Informe a justificativa.'
    if (!reviewDate || reviewDate <= todayPlusDays(0)) nextErrors.reviewDate = 'A data de revisão precisa ser futura.'
    else if (reviewDate > todayPlusDays(MAX_REVIEW_DAYS)) nextErrors.reviewDate = `A data de revisão pode ser no máximo ${MAX_REVIEW_DAYS} dias à frente.`
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length) return
    const ok = await confirm({
      title: 'Liberar faturamento sem Portal',
      message: `As faturas retidas deste Cliente serão emitidas agora, e as próximas sairão sem esperar o Portal até ${formatDate(reviewDate)}.`,
      consequence: 'Sem Portal, a fatura não chega ao Cliente pelo Portal: um usuário interno a entrega. A liberação não ativa a conta.',
      reversibility: 'Revogar a liberação a qualquer momento; as faturas já emitidas continuam emitidas.',
      confirmLabel: 'Liberar e emitir',
    })
    if (!ok) return
    try {
      const result = await grant.mutateAsync({ customerId, justification, reviewDate })
      const { issued, blocked, failed } = result.reprocess
      const parts = [
        issued > 0 ? `${plural(issued, 'fatura emitida', 'faturas emitidas')}` : 'nenhuma fatura estava pronta para emitir',
        blocked > 0 ? `${plural(blocked, 'B/L segue', 'B/Ls seguem')} com outro bloqueio na Validação` : null,
        failed > 0 ? `${plural(failed, 'emissão falhou', 'emissões falharam')}; confira em Taxas Locais` : null,
      ].filter(Boolean)
      setOutcome(`Liberação concedida: ${parts.join('; ')}.`)
      showToast('Liberação concedida.', 'success')
      setJustification('')
      setFormOpen(false)
    } catch (cause) {
      setErrors({ submit: userFacingErrorMessage(cause, 'Não foi possível conceder a liberação.') })
    }
  }

  async function handleRevoke() {
    setErrors({})
    const reason = await confirmWithReason({
      title: 'Revogar liberação',
      message: 'Revogar a Liberação de faturamento sem Portal deste Cliente?',
      consequence: 'Sem Portal pronto, as próximas faturas voltam a ficar retidas quando o CE Mercante for registrado.',
      reversibility: 'Conceder uma nova liberação, com justificativa e data de revisão.',
      reasonLabel: 'Motivo da revogação (obrigatório, mínimo de 3 caracteres)',
      confirmLabel: 'Revogar liberação',
      tone: 'danger',
    })
    if (reason === null) return
    // O banco recusa motivo com menos de 3 caracteres (migration 083).
    if (reason.trim().length < 3) {
      setErrors({ submit: 'Informe o motivo da revogação com pelo menos 3 caracteres.' })
      return
    }
    try {
      await revoke.mutateAsync({ customerId, reason })
      setOutcome(null)
      showToast('Liberação revogada.', 'success')
    } catch (cause) {
      setErrors({ submit: userFacingErrorMessage(cause, 'Não foi possível revogar a liberação.') })
    }
  }

  const statusText = portalReady
    ? 'O Portal deste Cliente está pronto: o faturamento não depende de liberação.'
    : state === 'vigente'
      ? `Faturas saem sem esperar o Portal até ${formatDate(release!.review_at)}. Depois, voltam a ficar retidas até o Portal ficar pronto.`
      : 'Sem Portal pronto, a fatura fica retida quando o CE Mercante é registrado. A liberação emite as retidas, com as taxas calculadas no registro do CE.'

  const content = (
    <section className="app-customer-release" aria-labelledby={`${formId}-title`}>
      <div className="app-customer-section-head">
        <h3 id={`${formId}-title`} className="app-customer-section-title app-customer-section-title--sub">
          Liberação de faturamento sem Portal
          {state ? <Badge tone={STATE_BADGE[state].tone}>{STATE_BADGE[state].label}</Badge> : null}
        </h3>
        <div className="app-customer-section-links">
          {canManage && state === 'vigente' ? (
            <Button variant="danger" onClick={() => void handleRevoke()} loading={revoke.isPending} loadingLabel="Revogando…" disabled={busy}>
              Revogar liberação
            </Button>
          ) : null}
          {canGrant && !formOpen ? (
            <Button variant="secondary" onClick={() => setFormOpen(true)}>
              {state ? 'Conceder nova liberação' : 'Conceder liberação'}
            </Button>
          ) : null}
        </div>
      </div>
      <p className="app-customer-muted">{statusText}</p>
      {isLoading ? <p className="app-customer-muted" role="status">Carregando a liberação…</p> : null}
      {isError ? (
        <div className="app-customer-notice app-customer-notice--danger" role="alert">
          <span>Não foi possível carregar a liberação.</span>
          <Button variant="secondary" className="app-btn--sm" onClick={() => void refetch()}>Tentar novamente</Button>
        </div>
      ) : null}
      {outcome ? <p className="app-customer-notice app-customer-notice--success" role="status">{outcome}</p> : null}
      {release ? (
        <dl className="app-customer-facts">
          <div className="app-customer-facts__wide"><dt>Justificativa</dt><dd>{release.justification}</dd></div>
          <div><dt>Concedida em</dt><dd className="tabular-nums">{formatDate(release.granted_at)}</dd></div>
          <div><dt>Revisão em</dt><dd className="tabular-nums">{formatDate(release.review_at)}</dd></div>
          {release.revoked_at ? (
            <div className="app-customer-facts__wide"><dt>Revogada em</dt><dd><span className="tabular-nums">{formatDate(release.revoked_at)}</span>{release.revoke_reason ? ` · ${release.revoke_reason}` : ''}</dd></div>
          ) : null}
        </dl>
      ) : null}
      {canGrant && formOpen ? (
        <form
          ref={formRef}
          id={`${formId}-form`}
          className="app-customer-release__form"
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            void handleGrant()
          }}
        >
          <Field label="Justificativa" required error={errors.justification}>
            <Textarea rows={2} value={justification} onChange={(event) => setJustification(event.target.value)} disabled={busy} />
          </Field>
          <Field label="Data de revisão" required error={errors.reviewDate} hint={`Até ${MAX_REVIEW_DAYS} dias. Depois dela, as faturas voltam a ficar retidas até o Portal ficar pronto.`}>
            <Input className="app-customer-release__date" type="date" min={todayPlusDays(1)} max={todayPlusDays(MAX_REVIEW_DAYS)} value={reviewDate} onChange={(event) => setReviewDate(event.target.value)} disabled={busy} />
          </Field>
          <div className="app-customer-savebar__actions">
            <Button type="button" variant="secondary" onClick={() => { setFormOpen(false); setErrors({}) }} disabled={busy}>Voltar</Button>
            <Button type="submit" loading={grant.isPending} loadingLabel="Liberando…" disabled={busy}>Liberar faturamento</Button>
          </div>
        </form>
      ) : null}
      {!canManage && !portalReady && state !== 'vigente' ? (
        <p className="app-customer-muted">A liberação é concedida pelo Administrativo.</p>
      ) : null}
      {errors.submit ? <InlineError message={errors.submit} /> : null}
    </section>
  )

  return variant === 'card' ? <Card className="app-customer-sheet">{content}</Card> : content
}
