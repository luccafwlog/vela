import { ExternalLink } from 'lucide-react'
import { usePortalScheduleVoyages } from '../../hooks/usePortalScheduleVoyages'
import { PORTAL_SCHEDULE_LANES, formatScheduleDate, type PortalScheduleLane } from '../../services/portalScheduleLanes'
import { scheduleCellState, scheduleLaneTitle, type ScheduleCellState } from './shipScheduleCells'
import type { PortalScheduleVoyage } from '../../services/portalScheduleVoyages'
import { Button } from '../ui/Button'
import { SkeletonTable } from '../ui/Skeleton'

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
  if (state === 'omitted') {
    return <span className="app-schedule-date app-schedule-date--omitted" title="Escala omitida pelo armador">OMIT<span className="sr-only">: {description}</span></span>
  }
  if (state === 'none') {
    return <span className="app-schedule-date app-schedule-date--none" title="Sem data programada">X<span className="sr-only">: {description}</span></span>
  }
  return (
    <span className={`app-schedule-date app-schedule-date--${state}`}>
      {state === 'actual' ? <span aria-hidden="true">✓ </span> : null}
      {formatScheduleDate(value ?? '')}
      {state === 'overdue' ? <span className="app-schedule-date__note" aria-hidden="true">a confirmar</span> : null}
      <span className="sr-only">, {description}</span>
    </span>
  )
}

export function VesselLink({ voyage }: { voyage: PortalScheduleVoyage }) {
  if (!voyage.imoNumber) return <>{voyage.vesselName}</>
  return (
    <a
      href={`https://www.marinetraffic.com/en/ais/details/ships/imo:${voyage.imoNumber}`}
      target="_blank"
      rel="noopener noreferrer"
      className="app-schedule-vessel-link"
    >
      {voyage.vesselName}
      <ExternalLink size={13} aria-hidden="true" />
      <span className="sr-only"> (posição do navio, abre em nova aba)</span>
    </a>
  )
}

export function ScheduleLegend() {
  return (
    <p className="app-schedule-legend">
      <span><span className="app-schedule-date app-schedule-date--actual">✓ 02/10</span> data efetiva: saída ou chegada registrada</span>
      <span>As demais datas são previsões; <span className="app-schedule-date__note">a confirmar</span> = previsão já passada, aguardando registro</span>
      <span><strong>X</strong> = sem data programada</span>
      <span><strong>OMIT</strong> = escala omitida pelo armador</span>
    </p>
  )
}

/**
 * Programação de navios no Portal (dono: etapa 03; composto no Painel do
 * Portal pela etapa 19). Mesma projeção e mesmas regras de célula de
 * Chegadas e Saídas, que publica estas datas.
 */
export function ShipScheduleWidget() {
  const { data: vessels, isLoading, isError, refetch, isFetching } = usePortalScheduleVoyages()

  return (
    <section className="app-schedule" aria-labelledby="ship-schedule-title">
      <header className="app-schedule__header">
        <h3 id="ship-schedule-title" className="app-schedule__title">Programação de navios</h3>
        <p className="app-schedule__service">CSSC Container Liner Service Schedule – ECSA · Datas atualizadas conforme os dados publicados</p>
      </header>

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
            <div className="app-table-scroll">
              <table className="app-table app-table--dense">
                <caption className="sr-only">Programação de navios: saída na origem e chegada no Brasil</caption>
                <thead>
                  <tr>
                    <th scope="col" rowSpan={2} className="text-left">Navio</th>
                    <th scope="col" rowSpan={2} className="text-center">Viagem</th>
                    <th scope="colgroup" colSpan={POL_LANES.length} className="text-center app-schedule__group">Saída na origem (ETD)</th>
                    <th scope="colgroup" colSpan={POD_LANES.length} className="text-center app-schedule__group">Chegada no Brasil (ETA)</th>
                  </tr>
                  <tr>
                    {PORTAL_SCHEDULE_LANES.map((lane) => (
                      <th key={lane.label} scope="col" className="text-center">{scheduleLaneTitle(lane)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {vessels.map((vessel) => (
                    <tr key={vessel.voyageId}>
                      <th scope="row" className="text-left font-semibold"><VesselLink voyage={vessel} /></th>
                      <td className="text-center">{vessel.voyage}</td>
                      {PORTAL_SCHEDULE_LANES.map((lane) => (
                        <td key={lane.label} className="text-center">
                          <ScheduleDate voyage={vessel} lane={lane} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <ul className="app-schedule__cards" aria-label="Programação de navios">
            {vessels.map((vessel) => (
              <li key={vessel.voyageId} className="app-schedule-card">
                <div className="app-schedule-card__head">
                  <span className="app-schedule-card__vessel"><VesselLink voyage={vessel} /></span>
                  <span className="app-schedule-card__voyage">Viagem {vessel.voyage}</span>
                </div>
                <ScheduleCardGroup title="Chegada no Brasil (ETA)" lanes={POD_LANES} voyage={vessel} />
                <ScheduleCardGroup title="Saída na origem (ETD)" lanes={POL_LANES} voyage={vessel} />
              </li>
            ))}
          </ul>

          <ScheduleLegend />
        </>
      )}
    </section>
  )
}

function ScheduleCardGroup({ title, lanes, voyage }: { title: string; lanes: PortalScheduleLane[]; voyage: PortalScheduleVoyage }) {
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
