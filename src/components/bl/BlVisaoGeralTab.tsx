import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Card } from '../ui/Card'
import type { BLDetail } from '../../types/database'
import type { ContainerSummary, BreakbulkSummary } from './BlCargaTab'
import { BlTransshipmentCard } from './BlTransshipmentCard'
import type { BlDisposition, VoyageOmission } from '../../services/transshipments'
import type { BlPortalStatus } from './BlPortalCard'
import { BlClienteSection } from './BlClienteSection'
import { formatNumber, type CargoMode } from '../../pages/blDetalheHelpers'
import { isBreakbulkCargoMode, isContainerCargoMode } from '../../lib/cargoMode'
import { BlTerminalOverrideCard, type BlTerminalOverrideOption } from './BlTerminalOverrideCard'
import { describeBaplie, type BaplieStatus } from './blOverviewPresentation'

export type { BaplieStatus } from './blOverviewPresentation'

type ManifestoMercante = { id: string; numero: string | null } | null

// Visão Geral: o que identifica o embarque, o documento Mercante, a carga e o
// cliente. Datas de POL/POD, taxas e fatura ficam no trilho acima das abas.
export function BlVisaoGeralTab({ active, bl, cargoMode, containerSummary, breakbulkSummary, onCod, onRestore, disposition, omission, savingDisposition, portalStatus, portalStatusError, onRetryPortalStatus, baplieStatus, terminalOptions, canEditTerminal, terminalOverrideSaving, terminalOverrideError, onSaveTerminalOverride }: {
  active: boolean
  bl: BLDetail
  cargoMode: CargoMode
  containerSummary: ContainerSummary
  breakbulkSummary: BreakbulkSummary
  onCod?: (justification: string) => void
  onRestore?: (justification: string) => void
  disposition?: BlDisposition | null
  omission?: VoyageOmission | null
  savingDisposition?: boolean
  portalStatus?: BlPortalStatus
  /** Falha da consulta de situação no Portal: mostra erro com Tentar novamente. */
  portalStatusError?: boolean
  onRetryPortalStatus?: () => void
  baplieStatus?: BaplieStatus
  terminalOptions?: BlTerminalOverrideOption[]
  canEditTerminal?: boolean
  terminalOverrideSaving?: boolean
  terminalOverrideError?: string | null
  onSaveTerminalOverride?: (input: { terminalId: string | null; podPortId: number | null; justification: string }) => void
}) {
  if (!active) return null
  const effectiveDisposition: BlDisposition = disposition ?? 'transshipment'
  const showContainers = isContainerCargoMode(cargoMode)
  const showBreakbulk = isBreakbulkCargoMode(cargoMode)
  const carrier = bl.voyage?.vessel?.carrier?.name ?? null
  const voyageText = [bl.voyage?.vessel?.name, bl.voyage?.voyage_number].filter(Boolean).join(' / ') || '—'
  const manifesto = (bl as { manifesto_mercante?: ManifestoMercante }).manifesto_mercante ?? null
  const baplie = baplieStatus ? describeBaplie(baplieStatus) : null

  return (
    <div className="app-bl-overview">
      {omission ? (
        <BlTransshipmentCard omission={omission} disposition={effectiveDisposition} saving={savingDisposition ?? false} onCod={onCod} onRestore={onRestore} />
      ) : null}

      <Card className="app-bl-sheet">
        <div className="app-bl-sheet__columns">
          <section className="app-bl-sheet__section" aria-labelledby="bl-embarque">
            <h2 id="bl-embarque" className="app-bl-section-title">Embarque</h2>
            <dl className="app-bl-facts">
              <Fact label="Navio / Viagem">
                {bl.voyage_id ? (
                  <Link className="app-bl-link" to={`/viagens/${bl.voyage_id}`}>{voyageText}</Link>
                ) : '—'}
                {carrier ? <span className="app-bl-facts__sub">{carrier}</span> : null}
              </Fact>
              <Fact label="Trecho">{`${bl.pol ?? '—'} → ${bl.pod ?? '—'}`}</Fact>
              {terminalOptions ? (
                <BlTerminalOverrideCard
                    key={`${bl.id}:${bl.terminal_id ?? 'inherit'}:${bl.pod_port_id ?? 'none'}`}
                    currentLabel={bl.terminal?.name ?? (bl.terminal_id ? `Terminal #${bl.terminal_id}` : null)}
                    terminalId={bl.terminal_id}
                    podPortId={bl.pod_port_id}
                    options={terminalOptions}
                    canEdit={canEditTerminal ?? false}
                    saving={terminalOverrideSaving}
                    error={terminalOverrideError}
                    onSave={onSaveTerminalOverride}
                  />
              ) : null}
            </dl>
          </section>

          <section className="app-bl-sheet__section" aria-labelledby="bl-mercante">
            <h2 id="bl-mercante" className="app-bl-section-title">Documento Mercante</h2>
            <dl className="app-bl-facts">
              <Fact label="CE Mercante" hint="Do B/L; não muda com COD.">
                {bl.ce_mercante ? <span className="app-bl-code">{bl.ce_mercante}</span> : <span className="app-bl-facts__missing">Não informado</span>}
              </Fact>
              <Fact label="Manifesto Mercante" hint="Agrupa os B/Ls da rota na viagem.">
                {manifesto?.numero
                  ? <span className="app-bl-code">{manifesto.numero}</span>
                  : <span className="app-bl-facts__missing">Sem vínculo</span>}
              </Fact>
            </dl>
          </section>
        </div>

        <section className="app-bl-sheet__section app-bl-sheet__section--ruled" aria-labelledby="bl-carga-resumo">
          <div className="app-bl-section-head">
            <h2 id="bl-carga-resumo" className="app-bl-section-title">Carga</h2>
            <Link className="app-bl-link app-bl-section-head__link" to={`/bls/${bl.id}?tab=carga`}>Ver itens da carga</Link>
          </div>
          <dl className="app-bl-facts app-bl-facts--cargo">
            {showContainers ? (
              <Fact label={showBreakbulk ? 'Contêineres (misto)' : 'Contêineres'}>
                <span className="tabular-nums">{`${containerSummary.distinct} ${containerSummary.distinct === 1 ? 'CNTR' : 'CNTRs'}`}</span>
                <span className="app-bl-facts__sub">
                  {[
                    containerSummary.imo ? `${containerSummary.imo} IMO` : null,
                    containerSummary.oog ? `${containerSummary.oog} OOG` : null,
                    `${containerSummary.soc} SOC · ${containerSummary.coc} COC`,
                  ].filter(Boolean).join(' · ')}
                </span>
              </Fact>
            ) : null}
            {showContainers && baplie && bl.voyage_id ? (
              <Fact label="Baplie">
                <Link className={`app-bl-link app-bl-tone--${baplie.tone}`} to={`/baplie?voyage=${bl.voyage_id}`} aria-label={`${baplie.text}. Abrir conciliação do Baplie`}>
                  {baplie.text}
                </Link>
              </Fact>
            ) : null}
            {showBreakbulk ? (
              <Fact label={showContainers ? 'Carga solta (misto)' : 'Carga solta'}>
                <span className="tabular-nums">{`${formatNumber(breakbulkSummary.weightTon)} t · ${formatNumber(breakbulkSummary.cbm)} m³`}</span>
                <span className="app-bl-facts__sub">
                  {`${formatNumber(breakbulkSummary.machines)} ${breakbulkSummary.machines === 1 ? 'máquina' : 'máquinas'} · ${formatNumber(breakbulkSummary.packagesTotal)} packages`}
                </span>
              </Fact>
            ) : null}
          </dl>
        </section>

        <BlClienteSection key={bl.id} bl={bl} portalStatus={portalStatus} portalStatusError={portalStatusError} onRetryPortalStatus={onRetryPortalStatus} />
      </Card>
    </div>
  )
}

function Fact({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="app-bl-facts__item">
      <dt>{label}</dt>
      <dd>{children}</dd>
      {hint ? <dd className="app-bl-facts__hint">{hint}</dd> : null}
    </div>
  )
}
