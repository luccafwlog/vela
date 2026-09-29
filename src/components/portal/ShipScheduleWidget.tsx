import { Ship, Anchor } from 'lucide-react'
import { usePortalScheduleVoyages } from '../../hooks/usePortalScheduleVoyages'
import { PORTAL_SCHEDULE_LANES, formatScheduleDate } from '../../services/portalScheduleLanes'

function DateCell({ value, isActual = false, omitted = false }: { value: string; isActual?: boolean; omitted?: boolean }) {
  const isX = value === 'X'
  return (
    <td title={omitted ? 'Escala omitida pelo armador' : undefined} className={`px-3 py-2.5 text-center text-sm border-r border-[var(--app-border)] ${omitted || isX ? 'text-[var(--app-muted-soft)]' : isActual ? 'text-[var(--app-blue-btn)] font-semibold' : 'text-[var(--app-text)]'}`}>
      {omitted ? 'OMIT' : isX ? 'X' : formatScheduleDate(value)}
    </td>
  )
}

export function ShipScheduleWidget() {
  const { data: vessels, isLoading } = usePortalScheduleVoyages()

  if (isLoading) {
    return (
      <div className="app-surface app-surface--padded text-sm text-[var(--app-muted)] text-center">
        Carregando programação de navios...
      </div>
    )
  }

  return (
    <div className="w-full overflow-hidden rounded-lg border border-[var(--app-border)] bg-[var(--app-surface)] shadow-[var(--app-shadow)]">
      <div className="bg-[var(--app-blue-btn)] px-4 py-3 flex items-center gap-3">
        <Ship className="w-5 h-5 text-[var(--app-thead-text)]" />
        <h2 className="text-base font-bold text-[var(--app-thead-text)] tracking-wide">
          CSSC Container Liner Service Schedule - ECSA
        </h2>
        <Anchor className="w-4 h-4 text-[var(--app-thead-text)] opacity-70 ml-auto" />
      </div>

      {!vessels || vessels.length === 0 ? (
        <div className="p-8 text-center text-sm text-[var(--app-muted)]">
          Nenhum navio programado no momento.
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse min-w-[900px]">
              <caption className="sr-only">Programação de navios no Portal</caption>
              <thead>
                <tr className="bg-[var(--app-blue-btn)]">
                  <th className="px-3 py-3 text-center text-xs font-bold text-[var(--app-thead-text)] uppercase tracking-wider border-r border-[color-mix(in_srgb,var(--app-thead-text)_20%,transparent)] min-w-[160px]">
                    Vessel Name
                  </th>
                  <th className="px-3 py-3 text-center text-xs font-bold text-[var(--app-thead-text)] uppercase tracking-wider border-r border-[color-mix(in_srgb,var(--app-thead-text)_20%,transparent)] w-14">
                    VOY
                  </th>
                  {PORTAL_SCHEDULE_LANES.map((lane) => (
                    <th key={lane.label} className="px-3 py-3 text-center text-xs font-bold text-[var(--app-thead-text)] uppercase tracking-wider border-r border-[color-mix(in_srgb,var(--app-thead-text)_20%,transparent)]">
                      <div>{lane.label}</div>
                      <div className="text-[10px] font-normal opacity-80">{lane.kind === 'pol' ? 'ATD POL / ETD' : 'ATA / ETA'}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {vessels.map((vessel, index) => {
                  const rowBg = index % 2 === 0 ? 'bg-[var(--app-surface)]' : 'bg-[var(--app-surface-muted)]'
                  return (
                    <tr key={vessel.voyageId} className={`${rowBg} hover:bg-[var(--app-blue-soft)] transition-colors duration-150 border-b border-[var(--app-border)] last:border-b-0`}>
                      <td className="px-3 py-2.5 text-center border-r border-[var(--app-border)] text-sm font-semibold text-[var(--app-blue-btn)]">
                        {vessel.imoNumber ? (
                          <a
                            href={`https://www.marinetraffic.com/en/ais/details/ships/imo:${vessel.imoNumber}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="underline hover:opacity-80"
                          >
                            {vessel.vesselName}
                          </a>
                        ) : (
                          vessel.vesselName
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-center border-r border-[var(--app-border)] text-sm font-medium text-[var(--app-text)]">
                        {vessel.voyage}
                      </td>
                      {PORTAL_SCHEDULE_LANES.map((lane) => (
                        <DateCell key={lane.label} value={vessel.datesByLabel[lane.label] ?? 'X'} omitted={Boolean(vessel.omittedByLabel?.[lane.label])} isActual={Boolean(vessel.actualDatesByLabel?.[lane.label])} />
                      ))}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="bg-[var(--app-surface-muted)] px-4 py-2 text-xs text-[var(--app-muted)] flex flex-wrap items-center justify-between gap-y-1 border-t border-[var(--app-border)]">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <span className="font-medium"><span className="text-[var(--app-blue-btn)]">Datas em azul</span> = data efetiva confirmada. Datas em preto = data prevista.</span>
              <span className="font-medium">X = Não programado</span>
            </div>
             <span className="font-medium">A data programada já alcançada aparece em azul. Atualizado conforme os dados publicados.</span>
          </div>
        </>
      )}
    </div>
  )
}
