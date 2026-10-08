import { Link } from 'react-router-dom'
import { AlertTriangle, ArrowRight, CheckCircle2 } from 'lucide-react'
import { StepRail } from '../ui/StepRail'
import type { DocumentalSummary, RailStage } from '../../services/blRails'
import { nextActionLinkLabel, railStagesToSteps } from './blRailSteps'

/**
 * Situação do B/L: a próxima ação e os dois trilhos (Operacional e
 * Documental) no `StepRail` comum. O trilho é o mapa; a próxima ação é o único
 * aviso da ficha que pede clique, com o destino escrito no link.
 */
export function BlRailsPipeline({ operational, documental, documentalSummary, nextAction }: {
  operational: RailStage[]
  documental: RailStage[]
  documentalSummary: DocumentalSummary
  nextAction: RailStage | null
}) {
  const linkLabel = nextActionLinkLabel(nextAction?.href)
  return (
    <section className="app-bl-status" aria-label="Situação do B/L">
      {nextAction ? (
        <div className={`app-bl-status__next app-bl-status__next--${nextAction.state === 'blocked' ? 'blocked' : 'pending'}`}>
          <AlertTriangle size={16} aria-hidden="true" className="shrink-0" />
          <p className="app-bl-status__next-text">
            <span className="app-bl-status__next-label">Próxima ação</span>
            <span>{nextAction.label}: {nextAction.detail}</span>
          </p>
          {nextAction.href && linkLabel ? (
            <Link className="app-bl-status__next-link" to={nextAction.href}>
              {linkLabel}
              <ArrowRight size={14} aria-hidden="true" />
            </Link>
          ) : null}
        </div>
      ) : (
        <div className="app-bl-status__next app-bl-status__next--done" role="status">
          <CheckCircle2 size={16} aria-hidden="true" className="shrink-0" />
          <p className="app-bl-status__next-text">Sem pendências documentais.</p>
        </div>
      )}
      {operational.length ? (
        <div className="app-bl-status__rail">
          <h2 className="app-bl-status__rail-title">Operacional</h2>
          <StepRail label="Trilho operacional" steps={railStagesToSteps(operational)} />
        </div>
      ) : null}
      <div className="app-bl-status__rail">
        <h2 className="app-bl-status__rail-title">
          Documental
          <span className="app-bl-status__rail-count" aria-label={`Pendências documentais: ${documentalSummary.label}`}>
            {documentalSummary.label}
          </span>
        </h2>
        <StepRail label="Trilho documental" steps={railStagesToSteps(documental)} />
      </div>
    </section>
  )
}
