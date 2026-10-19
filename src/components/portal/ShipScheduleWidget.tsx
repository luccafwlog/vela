import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'
import { usePortalScheduleVoyages } from '../../hooks/usePortalScheduleVoyages'
import { PORTAL_SCHEDULE_LANES, formatScheduleDate, type PortalScheduleLane } from '../../services/portalScheduleLanes'
import { scheduleCellState, scheduleLaneTitle, type ScheduleCellState } from './shipScheduleCells'
import type { PortalScheduleVoyage } from '../../services/portalScheduleVoyages'
import { Block } from '../ui/Block'
import { Button } from '../ui/Button'
import { SkeletonTable } from '../ui/Skeleton'
import { NoValue } from '../ui/NoValue'
import { StatusText } from '../ui/StatusText'

const POL_LANES = PORTAL_SCHEDULE_LANES.filter((lane) => lane.kind === 'pol')
const POD_LANES = PORTAL_SCHEDULE_LANES.filter((lane) => lane.kind === 'pod')

const CELL_DESCRIPTION: Record<ScheduleCellState, (lane: PortalScheduleLane) => string> = {
  actual: (lane) => (lane.kind === 'pol' ? 'saída registrada' : 'chegada registrada'),
  forecast: () => 'previsão',
  overdue: () => 'previsão a confirmar',
  omitted: () => 'escala omitida pelo armador',
  none: () => 'sem data programada',
}

export function ScheduleDate({ voyage, lane }: { voyage: PortalScheduleVoyage; lane: PortalScheduleLane }) {
  const { state, value } = scheduleCellState(voyage, lane)
  const description = CELL_DESCRIPTION[state](lane)
  if (state === 'omitted') return <StatusText tone="muted">Omitida<span className="sr-only">: {description}</span></StatusText>
  if (state === 'none') return <NoValue label="Sem data programada" />
  if (state === 'overdue') {
    // Previsão já passada e sem registro, de saída ou de chegada: âmbar (decisão de 2026-10-16).
    const title = lane.kind === 'pol' ? 'Previsão já passou; aguarda o registro da saída' : 'Previsão já passou; aguarda o registro da chegada'
    return <span title={title}><StatusText tone="warning">{formatScheduleDate(value ?? '')}<span className="sr-only">, {description}</span></StatusText></span>
  }
  return (
    <span className="app-schedule-date">
      {state === 'actual' ? <span className="app-schedule-date__check" aria-hidden="true">✓ </span> : null}
      {formatScheduleDate(value ?? '')}
      <span className="sr-only">, {description}</span>
    </span>
  )
}

/** Posição do navio no MarineTraffic, pelo IMO cadastrado; sem IMO, nada. */
export function VesselMapButton({ voyage }: { voyage: PortalScheduleVoyage }) {
  if (!voyage.imoNumber) return null
  return (
    <a
      href={`https://www.marinetraffic.com/en/ais/details/ships/imo:${voyage.imoNumber}`}
      target="_blank"
      rel="noopener noreferrer"
      className="app-btn app-btn--secondary app-btn--sm"
      aria-label={`Ver ${voyage.vesselName} no mapa (MarineTraffic, abre em nova aba)`}
    >
      Ver no mapa
    </a>
  )
}

export function ScheduleLegend() {
  return (
    <p className="app-schedule-legend">
      <span><span className="app-schedule-date__check">✓</span> data efetiva: saída ou chegada registrada</span>
      <span><StatusText tone="warning">âmbar</StatusText>: previsão já passou e ainda não foi registrada</span>
      <span>"Omitida": escala omitida pelo armador · "—": sem data</span>
      <span>As demais datas são previsões</span>
    </p>
  )
}

/** Portos com alguma data (ou omissão) em algum navio; o que não tem nada sai da tabela (regra 4). */
function visibleLanes(vessels: readonly PortalScheduleVoyage[]) {
  return PORTAL_SCHEDULE_LANES.filter((lane) => vessels.some((vessel) => scheduleCellState(vessel, lane).state !== 'none'))
}

/**
 * Tabela da Programação, a mesma em Chegadas e Saídas e no Portal (lote 2,
 * 2026-10-16): Saída na origem e depois Chegada no Brasil, na ordem em que
 * acontecem, numa linha de título só; a posição do navio e as ações da tela
 * ficam na ponta da linha.
 */
export function ScheduleTable({ vessels, caption, actions }: {
  vessels: readonly PortalScheduleVoyage[]
  caption: string
  actions?: (vessel: PortalScheduleVoyage) => ReactNode
}) {
  const lanes = visibleLanes(vessels)
  const hidden = PORTAL_SCHEDULE_LANES.length - lanes.length
  return (
    <>
      <div className="app-table-scroll">
        <table className="app-table app-table--dense">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              <th scope="col" className="app-table__text-head">Navio</th>
              <th scope="col">Viagem</th>
              {lanes.map((lane) => (
                <th key={lane.label} scope="col">{scheduleLaneTitle(lane)} {lane.kind === 'pol' ? 'ETD' : 'ETA'}</th>
              ))}
              {/* Colunas na largura do dado (2026-10-19): a sobra do bloco vai
                  toda para a coluna de ações, em vez de se espalhar entre as datas. */}
              <th scope="col" className="w-full"><span className="sr-only">Ações</span></th>
            </tr>
          </thead>
          <tbody>
            {vessels.map((vessel) => (
              <tr key={vessel.voyageId}>
                <th scope="row" className="app-table__text font-semibold">{vessel.vesselName}</th>
                <td>{vessel.voyage}</td>
                {lanes.map((lane) => (
                  <td key={lane.label}><ScheduleDate voyage={vessel} lane={lane} /></td>
                ))}
                <td className="w-full"><span className="ml-2 flex gap-2"><VesselMapButton voyage={vessel} />{actions?.(vessel)}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {hidden > 0 ? <p className="app-schedule-legend">{hidden === 1 ? '1 porto sem data em nenhum navio não aparece.' : `${hidden} portos sem data em nenhum navio não aparecem.`}</p> : null}
    </>
  )
}

/**
 * Programação de navios no Portal (dono: etapa 03; composto no Painel do
 * Portal pela etapa 19). Mesma projeção e mesmas regras de célula de
 * Chegadas e Saídas, que publica estas datas. Um bloco só (lote 4): o nome
 * do serviço na faixa do título e a legenda no pé.
 */
export function ShipScheduleWidget({ className }: { className?: string }) {
  const { data: vessels, isLoading, isError, refetch, isFetching } = usePortalScheduleVoyages()
  // O cartão do celular segue a tabela: Saída antes da Chegada, sem o porto
  // que não tem data em nenhum navio.
  const shownLanes = new Set(visibleLanes(vessels ?? []))
  const cardPolLanes = POL_LANES.filter((lane) => shownLanes.has(lane))
  const cardPodLanes = POD_LANES.filter((lane) => shownLanes.has(lane))

  return (
    <Block title="Programação de navios" aside="CSSC Container Liner Service Schedule – ECSA" flush className={cn('app-schedule', className)}>
      {isLoading ? (
        <SkeletonTable rows={3} cols={6} label="Carregando a programação de navios" />
      ) : isError ? (
        <div className="app-schedule__state" role="alert">
          <p>Não foi possível carregar a programação de navios.</p>
          <Button variant="secondary" className="app-btn--sm" loading={isFetching} loadingLabel="Tentando novamente" onClick={() => void refetch()}>
            Tentar novamente
          </Button>
        </div>
      ) : !vessels || vessels.length === 0 ? (
        <div className="app-schedule__state">Nenhum navio programado no momento.</div>
      ) : (
        <>
          <div className="app-schedule__table">
            <ScheduleTable vessels={vessels} caption="Programação de navios: saída na origem e chegada no Brasil" />
          </div>

          <ul className="app-schedule__cards" aria-label="Programação de navios">
            {vessels.map((vessel) => (
              <li key={vessel.voyageId} className="app-schedule-card">
                <div className="app-schedule-card__head">
                  <span className="app-schedule-card__vessel">{vessel.vesselName}</span>
                  <span className="app-schedule-card__voyage">Viagem {vessel.voyage}</span>
                </div>
                <ScheduleCardGroup title="Saída na origem (ETD)" lanes={cardPolLanes} voyage={vessel} />
                <ScheduleCardGroup title="Chegada no Brasil (ETA)" lanes={cardPodLanes} voyage={vessel} />
                <VesselMapButton voyage={vessel} />
              </li>
            ))}
          </ul>

          <ScheduleLegend />
        </>
      )}
    </Block>
  )
}

function ScheduleCardGroup({ title, lanes, voyage }: { title: string; lanes: PortalScheduleLane[]; voyage: PortalScheduleVoyage }) {
  if (!lanes.length) return null
  return (
    <div className="app-schedule-card__group">
      <div className="app-schedule-card__group-title">{title}</div>
      <dl className="app-schedule-card__dates">
        {lanes.map((lane) => (
          <div key={lane.label}>
            <dt>{scheduleLaneTitle(lane)}</dt>
            <dd><ScheduleDate voyage={voyage} lane={lane} /></dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
