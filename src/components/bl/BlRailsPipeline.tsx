import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { Block } from '../ui/Block'
import { NextAction } from '../ui/NextAction'
import { StepRail } from '../ui/StepRail'
import { Badge } from '../ui/Badge'
import type { DocumentalSummary, RailStage } from '../../services/blRails'
import { nextActionLinkLabel, railStagesToSteps } from './blRailSteps'

/**
 * Próxima ação e situação do B/L (ADR 0081, regra 3): a próxima ação em faixa
 * própria, logo abaixo da identidade, e os trilhos Operacional e Documental
 * em blocos lado a lado. Sem pendência documental não há faixa; o bloco
 * Documental diz "Sem pendências".
 */
export function BlRailsPipeline({ operational, documental, documentalSummary, nextAction }: {
  operational: RailStage[]
  documental: RailStage[]
  documentalSummary: DocumentalSummary
  nextAction: RailStage | null
}) {
  const linkLabel = nextActionLinkLabel(nextAction?.href)
  const operationalAside = operational.find((stage) => stage.key === 'discharge')?.detail
  return (
    <>
      {nextAction ? (
        <NextAction
          tone={nextAction.state === 'blocked' ? 'danger' : 'warning'}
          action={nextAction.href && linkLabel ? (
            <Link className="app-btn app-btn--secondary app-btn--sm" to={nextAction.href}>
              {linkLabel}
              <ArrowRight size={14} aria-hidden="true" />
            </Link>
          ) : null}
        >
          {nextAction.label}: {nextAction.detail}
        </NextAction>
      ) : null}
      <section className="grid gap-3 lg:grid-cols-2" aria-label="Situação do B/L">
        {operational.length ? (
          <Block title="Operacional" aside={operationalAside}>
            <StepRail label="Trilho operacional" steps={railStagesToSteps(operational)} />
          </Block>
        ) : null}
        <Block
          title="Documental"
          aside={(
            <Badge tone={documentalSummary.pendingCount ? 'danger' : 'success'}>{documentalSummary.label}</Badge>
          )}
        >
          <StepRail label="Trilho documental" steps={railStagesToSteps(documental)} />
        </Block>
      </section>
    </>
  )
}
