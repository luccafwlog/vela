import { Link } from 'react-router-dom'
import { cn } from '../../lib/utils'

export type StepState = 'done' | 'current' | 'pending' | 'blocked' | 'skipped'

export type Step = {
  key: string
  label: string
  /** Valor da etapa: data, quantidade ou situação curta. */
  detail?: string
  state: StepState
  /** Leva ao lugar onde a etapa se resolve. */
  href?: string
}

const STEP_STATE_LABEL: Record<StepState, string> = {
  done: 'Concluída',
  current: 'Em andamento',
  pending: 'Pendente',
  blocked: 'Bloqueada',
  skipped: 'Não se aplica',
}

/**
 * Trilho de etapas, a assinatura visual da direção "Carta náutica": sequência
 * horizontal com ponto, rótulo e valor (Saída → Chegada → Descarga →
 * Devolução; Emitida → Paga). O estado é lido em texto, não só pela cor do
 * ponto. Em telas estreitas a sequência vira coluna.
 */
export function StepRail({ label, steps, className }: { label: string; steps: Step[]; className?: string }) {
  if (!steps.length) return null
  return (
    <ol className={cn('app-step-rail', className)} aria-label={label}>
      {steps.map((step) => {
        const body = (
          <>
            <span className="app-step-rail__dot" aria-hidden="true" />
            <span className="app-step-rail__label">{step.label}</span>
            {step.detail ? <span className="app-step-rail__detail">{step.detail}</span> : null}
            <span className="sr-only">{`: ${STEP_STATE_LABEL[step.state]}`}</span>
          </>
        )
        return (
          <li
            key={step.key}
            className={`app-step-rail__step app-step-rail__step--${step.state}`}
            aria-current={step.state === 'current' ? 'step' : undefined}
          >
            {step.href ? <Link to={step.href} className="app-step-rail__link">{body}</Link> : <span className="app-step-rail__link">{body}</span>}
          </li>
        )
      })}
    </ol>
  )
}
