import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { Block, Fact, FactList, LeadValue } from '../ui/Block'
import { NoValue } from '../ui/NoValue'
import { DemurrageStatusBadge } from '../demurrage/DemurrageBadges'
import type { BLDetail } from '../../types/database'
import type { ContainerSummary, BreakbulkSummary } from './BlCargaTab'
import { BlTransshipmentCard } from './BlTransshipmentCard'
import type { BlDisposition, VoyageOmission } from '../../services/transshipments'
import type { BlPortalStatus } from './BlPortalCard'
import { BlClienteSection } from './BlClienteSection'
import { formatNumber, type CargoMode } from '../../pages/blDetalheHelpers'
import { formatDate } from '../../lib/utils'
import { isBreakbulkCargoMode, isContainerCargoMode } from '../../lib/cargoMode'
import { BlTerminalOverrideCard, type BlTerminalOverrideOption } from './BlTerminalOverrideCard'
import { describeBaplie, describeReturns, type BaplieStatus } from './blOverviewPresentation'

export type { BaplieStatus } from './blOverviewPresentation'

type ManifestoMercante = { id: string; numero: string | null } | null

// ponytail: a Visão geral mostra até 10 contêineres; o resto fica na aba
// Carga, que já lista todos. Se B/L com muitos contêineres virar regra, trocar
// por paginação ou só o resumo.
const OVERVIEW_CONTAINER_LIMIT = 10

// Visão geral (ADR 0081): um bloco por assunto, cada um com o seu dado
// principal. Embarque, Documento Mercante e Cliente na primeira linha; Carga,
// com os contêineres, e Portal na segunda. Datas de POL/POD, taxas e fatura
// ficam nos trilhos acima das abas.
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
  const voyageText = [bl.voyage?.vessel?.name, bl.voyage?.voyage_number].filter(Boolean).join(' / ')
  const manifesto = (bl as { manifesto_mercante?: ManifestoMercante }).manifesto_mercante ?? null
  const baplie = baplieStatus ? describeBaplie(baplieStatus) : null
  const containers = bl.bl_containers ?? []
  const returns = showContainers ? describeReturns(containers) : null
  const shownContainers = containers.slice(0, OVERVIEW_CONTAINER_LIMIT)
  const breakbulkText = `${formatNumber(breakbulkSummary.weightTon)} t · ${formatNumber(breakbulkSummary.cbm)} m³`
  const breakbulkDetail = `${formatNumber(breakbulkSummary.machines)} ${breakbulkSummary.machines === 1 ? 'máquina' : 'máquinas'} · ${formatNumber(breakbulkSummary.packagesTotal)} packages`
  const containerDetail = [
    `${containerSummary.distinct} ${containerSummary.distinct === 1 ? 'contêiner' : 'contêineres'}`,
    containerSummary.imo ? `${containerSummary.imo} IMO` : null,
    containerSummary.oog ? `${containerSummary.oog} OOG` : null,
    `${containerSummary.soc} SOC · ${containerSummary.coc} COC`,
  ].filter(Boolean).join(' · ')

  const embarque = (
    <Block title="Embarque">
      <LeadValue detail={[carrier, `${bl.pol ?? '—'} → ${bl.pod ?? '—'}`].filter(Boolean).join(' · ')}>
        {bl.voyage_id && voyageText
          ? <Link className="app-bl-link" to={`/viagens/${bl.voyage_id}`}>{voyageText}</Link>
          : <NoValue label="Sem viagem" />}
      </LeadValue>
      {terminalOptions ? (
        <FactList columns={1}>
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
        </FactList>
      ) : null}
    </Block>
  )

  const mercante = (
    <Block title="Documento Mercante">
      <LeadValue detail="CE do B/L; não muda com COD">
        {bl.ce_mercante ? <span className="font-(family-name:--app-font-mono) tabular-nums">{bl.ce_mercante}</span> : <NoValue label="CE Mercante não informado" />}
      </LeadValue>
      <FactList columns={1}>
        <Fact label="Manifesto Mercante" detail="Agrupa os B/Ls da rota na viagem">
          {manifesto?.numero ? <span className="app-bl-code">{manifesto.numero}</span> : <NoValue label="Sem vínculo com Manifesto Mercante" />}
        </Fact>
      </FactList>
    </Block>
  )

  const carga = (
    <Block
      title="Carga"
      flush
      aside={(
        <Link className="app-btn app-btn--secondary app-btn--sm" to={`/bls/${bl.id}?tab=carga`}>
          Ver na aba Carga
          <ArrowRight size={14} aria-hidden="true" />
        </Link>
      )}
    >
      <div className="grid gap-3 px-4 py-3">
        {showContainers ? (
          <LeadValue tone={returns?.tone} detail={containerDetail}>
            {returns?.text ?? `${containerSummary.distinct} ${containerSummary.distinct === 1 ? 'contêiner' : 'contêineres'}`}
          </LeadValue>
        ) : (
          <LeadValue detail={breakbulkDetail}>{breakbulkText}</LeadValue>
        )}
        {(showContainers && baplie && bl.voyage_id) || (showContainers && showBreakbulk) ? (
          <FactList>
            {showContainers && baplie && bl.voyage_id ? (
              <Fact label="Baplie">
                <span className="flex flex-wrap items-center gap-2">
                  <span className={`app-bl-tone--${baplie.tone}`}>{baplie.text}</span>
                  <Link className="app-btn app-btn--ghost app-btn--sm" to={`/baplie?voyage=${bl.voyage_id}`} aria-label={`${baplie.text}. Abrir conciliação do Baplie`}>
                    Abrir conciliação
                  </Link>
                </span>
              </Fact>
            ) : null}
            {showContainers && showBreakbulk ? (
              <Fact label="Carga solta (misto)" detail={breakbulkDetail}>{breakbulkText}</Fact>
            ) : null}
          </FactList>
        ) : null}
      </div>
      {showContainers && shownContainers.length ? (
        <div className="app-table-scroll">
          <table className="app-table app-table--compact app-table--padrao">
            <thead>
              <tr>
                <th scope="col" className="app-table__group"><span className="sr-only">Contêiner</span></th>
                <th scope="colgroup" colSpan={2} className="app-table__group"><span>Devolução</span></th>
                <th scope="colgroup" colSpan={3} className="app-table__group"><span>No terminal</span></th>
              </tr>
              <tr>
                <th scope="col">Contêiner</th>
                <th scope="col">Data</th>
                <th scope="col">Demurrage</th>
                <th scope="col">Descarga</th>
                <th scope="col">Lacre</th>
                <th scope="col">Peso bruto (kg)</th>
              </tr>
            </thead>
            <tbody>
              {shownContainers.map((container) => {
                const soc = container.ownership === 'SOC'
                return (
                  <tr key={container.id}>
                    <td className="app-bl-code text-[var(--app-text-strong)]">{container.container_number}</td>
                    <td className="tabular-nums">
                      {container.return_date ? formatDate(container.return_date) : <NoValue label={soc ? 'SOC, sem devolução' : 'Sem data de devolução'} />}
                    </td>
                    <td>{soc ? <NoValue label="SOC, sem Demurrage" /> : <DemurrageStatusBadge status={container.demurrage_status} />}</td>
                    <td className="tabular-nums">
                      {container.discharge_date ? formatDate(container.discharge_date) : <NoValue label="Sem descarga" />}
                    </td>
                    <td className="app-bl-code">{container.seal_number ?? <NoValue label="Sem lacre" />}</td>
                    <td className="tabular-nums">{container.gross_weight_kg == null ? <NoValue label="Sem peso bruto" /> : formatNumber(container.gross_weight_kg)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {containers.length > shownContainers.length ? (
            <p className="app-facts__detail px-4 py-2">
              {`Mais ${containers.length - shownContainers.length} na aba Carga.`}
            </p>
          ) : null}
        </div>
      ) : null}
    </Block>
  )

  return (
    <div className="grid gap-3">
      {omission ? (
        <BlTransshipmentCard omission={omission} disposition={effectiveDisposition} saving={savingDisposition ?? false} onCod={onCod} onRestore={onRestore} />
      ) : null}
      <BlClienteSection
        key={bl.id}
        bl={bl}
        portalStatus={portalStatus}
        portalStatusError={portalStatusError}
        onRetryPortalStatus={onRetryPortalStatus}
        layout={({ cliente, portal, wide }) => (
          <>
            <div className={wide ? 'grid gap-3 lg:grid-cols-2' : 'grid gap-3 lg:grid-cols-3'}>
              {embarque}
              {mercante}
              {wide ? null : cliente}
            </div>
            {wide ? cliente : null}
            <div className="grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
              {carga}
              {portal}
            </div>
          </>
        )}
      />
    </div>
  )
}
