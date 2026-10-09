import { Link } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, X, XCircle } from 'lucide-react'
import { Button } from '../ui/Button'

/**
 * Resultado de uma ação da fila que precisa continuar visível depois que o
 * grupo some ou muda: o que deu certo, o que falhou e o que ainda falta.
 */
export type ReviewOutcome = {
  id: string
  tone: 'success' | 'warning' | 'danger'
  title: string
  lines: string[]
}

/** Registro que saiu da revisão com as taxas ainda por recalcular. */
export type ReviewRecalcNotice = { id: string; label: string; source: 'bl' | 'granite' }

const toneIcon = {
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: XCircle,
}

export function ReviewOutcomes({
  outcomes,
  recalcNotices,
  recalcingId,
  onDismissOutcome,
  onDismissRecalc,
  onRecalc,
}: {
  outcomes: ReviewOutcome[]
  recalcNotices: ReviewRecalcNotice[]
  recalcingId: string | null
  onDismissOutcome: (id: string) => void
  onDismissRecalc: (id: string) => void
  onRecalc: (notice: ReviewRecalcNotice) => void
}) {
  return (
    <section className="review-outcomes" aria-label="Resultados recentes" aria-live="polite">
      {outcomes.map((outcome) => {
        const Icon = toneIcon[outcome.tone]
        return (
          <div key={outcome.id} className={`review-outcome review-outcome--${outcome.tone}`} role={outcome.tone === 'danger' ? 'alert' : undefined}>
            <Icon size={16} aria-hidden="true" className="review-outcome__icon" />
            <div className="review-outcome__copy">
              <p className="review-outcome__title">{outcome.title}</p>
              {outcome.lines.map((line) => <p key={line} className="review-outcome__line">{line}</p>)}
            </div>
            <button type="button" className="review-outcome__dismiss" onClick={() => onDismissOutcome(outcome.id)} aria-label={`Dispensar: ${outcome.title}`}>
              <X size={14} aria-hidden="true" />
            </button>
          </div>
        )
      })}
      {recalcNotices.map((notice) => (
        <div key={notice.id} className="review-outcome review-outcome--warning">
          <AlertTriangle size={16} aria-hidden="true" className="review-outcome__icon" />
          <div className="review-outcome__copy">
            <p className="review-outcome__title">
              {notice.source === 'granite' ? `Granito ${notice.label}: refaça o cálculo de taxas no Granito.` : `B/L ${notice.label}: taxas locais ainda por recalcular.`}
            </p>
            <p className="review-outcome__line">
              {notice.source === 'granite'
                ? 'O cliente foi vinculado, mas o cálculo de apoio continua pendente.'
                : 'A revisão foi salva, mas as taxas locais continuam pendentes de recálculo e a fatura não saiu.'}
            </p>
          </div>
          <div className="review-outcome__actions">
            {notice.source === 'bl' ? (
              <Button variant="secondary" className="app-btn--sm" loading={recalcingId === notice.id} loadingLabel="Recalculando…" onClick={() => onRecalc(notice)}>
                Recalcular taxas
              </Button>
            ) : (
              <Link className="review-link" to="/granito">Abrir Granito</Link>
            )}
            <button type="button" className="review-outcome__dismiss" onClick={() => onDismissRecalc(notice.id)} aria-label={`Dispensar aviso de ${notice.label}`}>
              <X size={14} aria-hidden="true" />
            </button>
          </div>
        </div>
      ))}
    </section>
  )
}
