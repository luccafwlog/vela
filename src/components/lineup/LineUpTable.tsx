import type { Ref } from 'react'
import type { CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { Badge } from '../ui/Badge'
import { EmptyState } from '../ui/Card'
import type { LineUpRow } from '../../services/lineup'
import { getVoyagePodCeStatusLabel } from '../../services/voyageRouteSchedules'
import { formatShortDateSafe } from '../../lib/utils'
import { arrivalDisplay, deriveEscalaState } from '../../lib/escalaState'

export function LineUpTable({
  rows,
  emptyTitle,
  emptyDescription,
  mode = 'app',
  rowHeight,
  fillSlots,
  containerRef,
  bodyStyle,
  getRowKey,
}: {
  rows: LineUpRow[]
  emptyTitle: string
  emptyDescription: string
  mode?: 'app' | 'display'
  rowHeight?: number
  fillSlots?: number
  containerRef?: Ref<HTMLDivElement>
  bodyStyle?: CSSProperties
  getRowKey?: (row: LineUpRow, index: number) => string
}) {
  const isDisplay = mode === 'display'
  const placeholderSlots = isDisplay && rows.length > 0 ? Math.max(0, (fillSlots ?? 0) - rows.length) : 0

  return (
    <div ref={containerRef} className={isDisplay ? 'app-lineup-display-scroll' : 'app-table-scroll'}>
      <table
        className={`app-table app-table--dense app-table--lineup ${isDisplay ? 'app-table--lineup-display' : ''} min-w-full table-fixed text-left`}
        style={isDisplay && rowHeight ? ({ ['--lineup-display-row-height' as string]: `${rowHeight}px` } as CSSProperties) : undefined}
      >
        <colgroup>
          <col className={isDisplay ? 'w-[20%]' : 'w-[19%]'} />
          <col className={isDisplay ? 'w-[5%]' : 'w-[5%]'} />
          <col className={isDisplay ? 'w-[7%]' : 'w-[7%]'} />
          <col className={isDisplay ? 'w-[6%]' : 'w-[7%]'} />
          <col className={isDisplay ? 'w-[6%]' : 'w-[6%]'} />
          <col className={isDisplay ? 'w-[6%]' : 'w-[6%]'} />
          <col className={isDisplay ? 'w-[6%]' : 'w-[5%]'} />
          <col className={isDisplay ? 'w-[6%]' : 'w-[8%]'} />
          <col className={isDisplay ? 'w-[5%]' : 'w-[5%]'} />
          <col className={isDisplay ? 'w-[7%]' : 'w-[6%]'} />
          <col className={isDisplay ? 'w-[6%]' : 'w-[5%]'} />
          <col className={isDisplay ? 'w-[5%]' : 'w-[5%]'} />
          <col className={isDisplay ? 'w-[7%]' : 'w-[8%]'} />
          <col className={isDisplay ? 'w-[8%]' : 'w-[9%]'} />
          <col className={isDisplay ? 'w-[6%]' : 'w-[6%]'} />
        </colgroup>
        <thead className={isDisplay ? 'bg-[#16325f] text-[13px] uppercase tracking-[0.18em] text-white' : 'bg-[#0d1117] text-xs uppercase tracking-wider text-slate-500'}>
          <tr>
            <th scope="col" className="px-1 py-2 text-center" title="Navio">Vessel</th>
            <th scope="col" className="px-1 py-2 text-center" title="Número da viagem">Voy</th>
            <th scope="col" className="px-1 py-2 text-center" title="Porto de descarga">POD</th>
            <th scope="col" className="px-1 py-2 text-center" title="Terminal da operação, por sentido">Terminal</th>
            <th scope="col" className="px-1 py-2 text-center" title="Chegada estimada">ETA</th>
            <th scope="col" className="px-1 py-2 text-center" title="Atracação estimada">ETB</th>
<th scope="col" className="px-1 py-2 text-center" title="Veículos">VIN</th>
<th scope="col" className="px-1 py-2 text-center" title="Containers com veículos">VIN CNTR</th>
            <th scope="col" className="px-1 py-2 text-center" title="Carga geral em container">CG</th>
            <th scope="col" className="px-1 py-2 text-center" title="Total de containers">Total</th>
            <th scope="col" className="px-1 py-2 text-center" title="Containers vazios">MTY</th>
            <th scope="col" className="px-1 py-2 text-center" title="Restow (remanejo a bordo)">RTW</th>
            <th scope="col" className="px-1 py-2 text-center" title="Break-bulk: máquinas / pacotes / total">BB</th>
            <th scope="col" className="px-1 py-2 text-center" title="Status dos CEs Mercante">CEs</th>
            <th scope="col" className="px-1 py-2 text-center" title="Manifesto vinculado à viagem">Linked</th>
          </tr>
        </thead>
        <tbody
          className={isDisplay ? 'divide-y divide-[#d6dfeb] bg-white' : 'divide-y divide-[#30363d]'}
          style={bodyStyle}
        >
          {rows.length === 0 ? (
            <tr>
              <td colSpan={15} className="p-0">
                <EmptyState title={emptyTitle} description={emptyDescription} />
              </td>
            </tr>
          ) : null}

          {rows.map((row, index) => {
            const isExport = row.rowType === 'export'
            const terminal = isExport ? row.exportTerminal : row.importTerminal
            const arrival = arrivalDisplay({ eta: row.eta, ata: row.ata })
            const isBerthed = deriveEscalaState({ atb: row.atb, atd: row.atd }) === 'atracada'
            return (
              <tr
                key={getRowKey ? getRowKey(row, index) : row.id}
                className={`${isExport ? (isDisplay ? 'app-lineup-export-row--display' : 'app-lineup-export-row') : ''} ${isBerthed ? 'app-lineup-row--berthed' : ''}`.trim() || undefined}
              >
                <td className={isDisplay ? 'px-1 py-1 text-center font-black text-[#214b2f]' : 'px-2 py-2 text-center font-semibold text-white'}>
                  {isDisplay ? row.vesselName : (
                    <Link
                      to={`/viagens/${row.voyageId}`}
                      className="hover:underline hover:text-[#58a6ff]"
                    >
                      {row.vesselName}
                    </Link>
                  )}
                </td>
                <td className={isDisplay ? 'px-1 py-1 text-center font-black text-[#214b2f]' : 'px-3 py-3 text-center font-semibold text-white'}>{row.voyageNumber}</td>
                <td className={isDisplay ? 'px-1 py-1 text-center font-black text-[#214b2f]' : 'px-3 py-3 text-center font-semibold text-white'}>
                  <div className="flex flex-wrap items-center justify-center gap-1">
                    <span>{row.pod}</span>
                    {row.omitted ? <OmittedChip /> : null}
                  </div>
                </td>
                <td className={isDisplay ? 'px-1 py-1 text-center font-black text-[#214b2f]' : 'px-3 py-3 text-center font-semibold text-white'}>
                  {terminal}
                </td>
                <td className={isDisplay ? 'px-1 py-1 text-center' : 'px-3 py-3 text-center'}>
                  <span className={arrival.isActual ? 'text-green-600' : undefined}>{formatShortDate(arrival.value)}</span>
                </td>
                <td className={isDisplay ? 'px-1 py-1 text-center' : 'px-3 py-3 text-center'}>{formatShortDate(row.etb)}</td>
                {isExport ? (
                  <>
                    <td
                      colSpan={7}
                      className={isDisplay
                        ? 'px-2 py-1 text-center font-black text-[#7c4a00]'
                        : 'px-3 py-3 text-center font-semibold text-amber-400'}
                    >
                      {buildExportLabel(row)}
                    </td>
                    <td className={isDisplay ? 'px-1 py-1 text-center' : 'px-3 py-3 text-center'}>
                      {isDisplay
                        ? renderDisplayCeStatus(row.exportCeStatus ?? 'waiting')
                        : renderCeStatus(row.exportCeStatus ?? 'waiting')}
                    </td>
                    <td className={isDisplay ? 'px-1 py-1 text-center' : 'px-3 py-3 text-center'}>
                      {isDisplay ? (
                        <span className={`app-lineup-display-status ${row.exportLinked ? 'app-lineup-display-status--green' : 'app-lineup-display-status--amber'}`}>
                          {row.exportLinked ? 'SIM' : 'NÃO'}
                        </span>
                      ) : (
                        <Badge tone={row.exportLinked ? 'green' : 'yellow'}>{row.exportLinked ? 'SIM' : 'NÃO'}</Badge>
                      )}
                    </td>
                  </>
                ) : (
                  <>
                    <td className={isDisplay ? 'px-1 py-1 text-center font-black text-[#214b2f]' : 'px-3 py-3 text-center font-semibold text-white'}>
                      {isDisplay ? formatInteger(row.vin) : (
                        <Link to={`/veiculos?voyage=${row.voyageId}`} className="hover:underline hover:text-[#58a6ff]">
                          {formatInteger(row.vin)}
                        </Link>
                      )}
                    </td>
                    <td className={isDisplay ? 'px-1 py-1 text-center' : 'px-3 py-3 text-center'}>
                      {isDisplay ? formatInteger(row.car) : (
                        <Link to={`/containers?voyage=${row.voyageId}&pod=${encodeURIComponent(row.pod)}&vehicle_container=true`} className="hover:underline hover:text-[#58a6ff]">
                          {formatInteger(row.car)}
                        </Link>
                      )}
                    </td>
                    <td className={isDisplay ? 'px-1 py-1 text-center' : 'px-3 py-3 text-center'}>
                      {isDisplay ? formatInteger(row.cg) : (
                        <Link to={`/containers?voyage=${row.voyageId}&pod=${encodeURIComponent(row.pod)}&vehicle_container=false`} className="hover:underline hover:text-[#58a6ff]">
                          {formatInteger(row.cg)}
                        </Link>
                      )}
                    </td>
                    <td className={isDisplay ? 'px-1 py-1 text-center font-semibold text-[#58a6ff]' : 'px-3 py-3 text-center font-semibold text-[#58a6ff]'}>
                      {isDisplay ? formatInteger(row.total) : (
                        <Link to={`/containers?voyage=${row.voyageId}&pod=${encodeURIComponent(row.pod)}`} className="hover:underline hover:text-[#58a6ff]">
                          {formatInteger(row.total)}
                        </Link>
                      )}
                    </td>
                    <td className={isDisplay ? 'px-1 py-1 text-center' : 'px-3 py-3 text-center'}>
                      {isDisplay ? formatInteger(row.mty) : (
                        <Link to={`/vazios-importacao?voyage=${row.voyageId}&pod=${encodeURIComponent(row.pod)}`} className="hover:underline hover:text-[#58a6ff]">
                          {formatInteger(row.mty)}
                        </Link>
                      )}
                    </td>
                    <td className={isDisplay ? 'px-1 py-1 text-center' : 'px-3 py-3 text-center'}>{row.rtw === null ? '-' : formatInteger(row.rtw)}</td>
                    <td className={isDisplay ? 'px-1 py-1' : 'px-3 py-3'}>
                      {isDisplay ? (
                        <div className="app-lineup-bb">
                          <span>{formatInteger(row.bbMachines)} MAQ</span>
                          <span>{formatInteger(row.bbPackages)} PACK</span>
                          <span>{formatInteger(row.bbTotal)} TOTAL</span>
                        </div>
                      ) : (
                        <Link to={`/bls?voyage=${row.voyageId}&pod=${encodeURIComponent(row.pod)}&cargoMode=carga_solta`} className="block app-lineup-bb hover:opacity-80">
                          <span>{formatInteger(row.bbMachines)} MAQ</span>
                          <span>{formatInteger(row.bbPackages)} PACK</span>
                          <span>{formatInteger(row.bbTotal)} TOTAL</span>
                        </Link>
                      )}
                    </td>
                    <td className={isDisplay ? 'px-1 py-1 text-center' : 'px-3 py-3 text-center'}>
                      {isDisplay ? renderDisplayCeStatus(row.ceStatus) : (
                        <Link to={`/bls?voyage=${row.voyageId}&pod=${encodeURIComponent(row.pod)}`} className="inline-block hover:opacity-80">
                          {renderCeStatus(row.ceStatus)}
                        </Link>
                      )}
                    </td>
                    <td className={isDisplay ? 'px-1 py-1 text-center' : 'px-3 py-3 text-center'}>
                      {isDisplay ? (
                        <span className={`app-lineup-display-status ${row.linked ? 'app-lineup-display-status--green' : 'app-lineup-display-status--amber'}`}>
                          {row.linked ? 'SIM' : 'NÃO'}
                        </span>
                      ) : (
                        <Badge tone={row.linked ? 'green' : 'yellow'}>{row.linked ? 'SIM' : 'NÃO'}</Badge>
                      )}
                    </td>
                  </>
                )}
              </tr>
            )
          })}

          {Array.from({ length: placeholderSlots }).map((_, index) => (
            <tr key={`lineup-placeholder-${index}`} className="app-lineup-placeholder-row" aria-hidden="true">
              <td colSpan={15} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function buildExportLabel(row: LineUpRow) {
  const parts: string[] = ['EXP']
  if (row.exportHasGranite) parts.push('GRANITE')
  if (row.exportContainersQty !== null) {
    const moves = row.exportMovementsQty !== null ? ` - ${formatInteger(row.exportMovementsQty)} MOVES` : ''
    parts.push(`${formatInteger(row.exportContainersQty)} CNTRS${moves}`)
  }
  return parts.join(' | ')
}

function renderCeStatus(status: LineUpRow['ceStatus']) {
  if (status === 'approved') return <Badge tone="green">{getVoyagePodCeStatusLabel(status)}</Badge>
  if (status === 'received' || status === 'approving') return <Badge tone="blue">{getVoyagePodCeStatusLabel(status)}</Badge>
  if (status === 'launching' || status === 'partial') return <Badge tone="yellow">{getVoyagePodCeStatusLabel(status)}</Badge>
  return <Badge tone="red">{getVoyagePodCeStatusLabel(status)}</Badge>
}

function renderDisplayCeStatus(status: LineUpRow['ceStatus']) {
  if (status === 'approved') {
    return <span className="app-lineup-display-status app-lineup-display-status--green">{getVoyagePodCeStatusLabel(status)}</span>
  }
  if (status === 'received' || status === 'approving' || status === 'launching' || status === 'partial') {
    return <span className="app-lineup-display-status app-lineup-display-status--amber">{getVoyagePodCeStatusLabel(status)}</span>
  }
  return <span className="app-lineup-display-status app-lineup-display-status--red">{getVoyagePodCeStatusLabel(status)}</span>
}

function formatShortDate(value: string | null) {
  return formatShortDateSafe(value)
}

function formatInteger(value: number) {
  return new Intl.NumberFormat('pt-BR').format(Number(value ?? 0))
}

function OmittedChip() {
  return (
    <span
      className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800"
      title="Escala omitida — o navio não atracou neste porto."
    >
      Omitida
    </span>
  )
}
