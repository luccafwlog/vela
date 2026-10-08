import { Link } from 'react-router-dom'
import { Badge } from '../ui/Badge'
import { EmptyState } from '../ui/Card'
import type { LineUpRow } from '../../services/lineup'
import { formatShortDateSafe } from '../../lib/utils'
import { arrivalDisplay, deriveEscalaState } from '../../lib/escalaState'
import { formatLineUpInteger, lineUpCeStatus, lineUpExportLabel, lineUpLinked } from './lineUpStatus'

/**
 * Line-Up do Painel. A TV (`LineUpTVDisplay`) tem quadro próprio; os dois leem
 * status, rótulos e formatação de `lineUpStatus.ts`.
 */
export function LineUpTable({
  rows,
  emptyTitle,
  emptyDescription,
}: {
  rows: LineUpRow[]
  emptyTitle: string
  emptyDescription: string
}) {
  return (
    <div className="app-table-scroll">
      <table className="app-table app-table--dense app-table--lineup min-w-full table-fixed text-left">
        <caption className="sr-only">Programação de viagens e escalas</caption>
        <colgroup>
          <col className="w-[18%]" />
          <col className="w-[6%]" />
          <col className="w-[7%]" />
          <col className="w-[7%]" />
          <col className="w-[6%]" />
          <col className="w-[6%]" />
          <col className="w-[5%]" />
          <col className="w-[7%]" />
          <col className="w-[5%]" />
          <col className="w-[6%]" />
          <col className="w-[5%]" />
          <col className="w-[5%]" />
          <col className="w-[7%]" />
          <col className="w-[10%]" />
          <col className="w-[7%]" />
        </colgroup>
        <thead>
          <tr>
            <th scope="col" className="text-left">Navio</th>
            <th scope="col" className="text-center">Viagem</th>
            <th scope="col" className="text-center" title="Porto de descarga">POD</th>
            <th scope="col" className="text-center" title="Terminal da operação, por sentido">Terminal</th>
            <th scope="col" className="text-center" title="Chegada: ATA quando registrada (✓), senão ETA">ETA</th>
            <th scope="col" className="text-center" title="Atracação estimada">ETB</th>
            <th scope="col" className="text-right" title="Veículos">VIN</th>
            <th scope="col" className="text-right" title="Containers com veículos">VIN CNTR</th>
            <th scope="col" className="text-right" title="Carga geral em container">CG</th>
            <th scope="col" className="text-right" title="Total de containers">Total</th>
            <th scope="col" className="text-right" title="Containers vazios">MTY</th>
            <th scope="col" className="text-right" title="Restow (remanejo a bordo)">RTW</th>
            <th scope="col" className="text-right" title="Break-bulk: máquinas / packages">BB</th>
            <th scope="col" className="text-center" title="Status de BLs e CEs da escala">CEs</th>
            <th scope="col" className="text-center" title="Manifestos vinculados à escala">Vinculada</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={15} className="p-0">
                <EmptyState title={emptyTitle} description={emptyDescription} />
              </td>
            </tr>
          ) : null}

          {rows.map((row) => {
            const isExport = row.rowType === 'export'
            const terminal = isExport ? row.exportTerminal : row.importTerminal
            const arrival = arrivalDisplay({ eta: row.eta, ata: row.ata })
            const isBerthed = deriveEscalaState({ atb: row.atb, atd: row.atd }) === 'atracada'
            const ce = lineUpCeStatus(isExport ? row.exportCeStatus ?? 'waiting' : row.ceStatus)
            const linked = lineUpLinked(isExport ? row.exportLinked : row.linked)
            const podQuery = `voyage=${row.voyageId}&pod=${encodeURIComponent(row.pod)}`
            return (
              <tr
                key={row.id}
                className={`${isExport ? 'app-lineup-export-row' : ''} ${isBerthed ? 'app-lineup-row--berthed' : ''}`.trim() || undefined}
              >
                <td className="font-semibold">
                  <Link to={`/viagens/${row.voyageId}`}>{row.vesselName}</Link>
                </td>
                <td className="text-center">{row.voyageNumber}</td>
                <td className="text-center font-medium">
                  <span>{row.pod}</span>
                  {row.omitted ? <> <Badge tone="warning" title="Escala omitida — o navio não atracará neste porto.">OMIT</Badge></> : null}
                </td>
                <td className="text-center">{terminal}</td>
                <td className="text-center tabular-nums">
                  {arrival.isActual ? (
                    <span className="app-date--actual" title="ATA registrada">✓ {formatShortDateSafe(arrival.value)}</span>
                  ) : formatShortDateSafe(arrival.value)}
                </td>
                <td className="text-center tabular-nums">{formatShortDateSafe(row.etb)}</td>
                {isExport ? (
                  <td colSpan={7} className="text-center font-medium">
                    {lineUpExportLabel(row)}
                  </td>
                ) : (
                  <>
                    <td className="text-right tabular-nums">
                      <Link to={`/veiculos?voyage=${row.voyageId}`}>{formatLineUpInteger(row.vin)}</Link>
                    </td>
                    <td className="text-right tabular-nums">
                      <Link to={`/containers?${podQuery}&vehicle_container=true`}>{formatLineUpInteger(row.car)}</Link>
                    </td>
                    <td className="text-right tabular-nums">
                      <Link to={`/containers?${podQuery}&vehicle_container=false`}>{formatLineUpInteger(row.cg)}</Link>
                    </td>
                    <td className="text-right font-semibold tabular-nums">
                      <Link to={`/containers?${podQuery}`}>{formatLineUpInteger(row.total)}</Link>
                    </td>
                    <td className="text-right tabular-nums">
                      <Link to={`/vazios-importacao?${podQuery}`}>{formatLineUpInteger(row.mty)}</Link>
                    </td>
                    <td className="text-right tabular-nums">{row.rtw === null ? '—' : formatLineUpInteger(row.rtw)}</td>
                    <td className="text-right">
                      <Link to={`/bls?${podQuery}&cargoMode=carga_solta`} className="app-lineup-bb" aria-label={`${formatLineUpInteger(row.bbMachines)} máquinas e ${formatLineUpInteger(row.bbPackages)} packages`}>
                        {formatLineUpInteger(row.bbMachines)} / {formatLineUpInteger(row.bbPackages)}
                      </Link>
                    </td>
                  </>
                )}
                <td className="text-center">
                  {isExport ? (
                    <Badge tone={ce.tone}>{ce.label}</Badge>
                  ) : (
                    <Link to={`/bls?${podQuery}`} className="inline-block hover:opacity-80">
                      <Badge tone={ce.tone}>{ce.label}</Badge>
                    </Link>
                  )}
                </td>
                <td className="text-center">
                  <Badge tone={linked.tone}>{linked.label}</Badge>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
