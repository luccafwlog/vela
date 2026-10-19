import { Link } from 'react-router-dom'
import { Block, Fact, FactList } from '../ui/Block'
import { NoValue } from '../ui/NoValue'
import { StatusText } from '../ui/StatusText'
import { EmptyState } from '../ui/Card'
import type { LineUpRow } from '../../services/lineup'
import { formatShortDateSafe } from '../../lib/utils'
import { arrivalDisplay, deriveEscalaState } from '../../lib/escalaState'
import { formatLineUpInteger, lineUpCeStatus, lineUpExportLabel, lineUpLinked } from './lineUpStatus'

/**
 * Line-Up do Painel. A TV (`LineUpTVDisplay`) tem quadro próprio; os dois leem
 * status, rótulos e formatação de `lineUpStatus.ts`.
 *
 * Tabela limpa (lote 5a): situação em texto, âmbar só no que pede ação (CE
 * aguardando, manifesto não vinculado); a data efetiva leva ✓ (ATA na coluna
 * ETA, ATB na coluna ETB); o navio atracado é marcado pela faixa verde à
 * esquerda da linha. No celular (`cards`), um cartão por escala com todas as
 * informações da linha.
 */
export function LineUpTable({
  rows,
  emptyTitle,
  emptyDescription,
  cards = false,
}: {
  rows: LineUpRow[]
  emptyTitle: string
  emptyDescription: string
  cards?: boolean
}) {
  if (cards) {
    if (rows.length === 0) return <EmptyState title={emptyTitle} description={emptyDescription} />
    return (
      <ul className="grid gap-3 p-3" aria-label="Escalas do Line Up">
        {rows.map((row) => <li key={row.id}><LineUpCard row={row} /></li>)}
      </ul>
    )
  }
  return (
    <div className="app-table-scroll">
      <table className="app-table app-table--dense app-table--lineup min-w-full table-fixed">
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
            <th scope="col" className="app-table__text-head">Navio</th>
            <th scope="col">Viagem</th>
            <th scope="col" title="Porto de descarga">POD</th>
            <th scope="col" title="Terminal da operação, por sentido">Terminal</th>
            <th scope="col" title="Chegada: ATA quando registrada (✓), senão ETA">ETA</th>
            <th scope="col" title="Atracação: ATB quando registrada (✓), senão ETB">ETB</th>
            <th scope="col" title="Veículos">VIN</th>
            <th scope="col" title="Containers com veículos">VIN CNTR</th>
            <th scope="col" title="Carga geral em container">CG</th>
            <th scope="col" title="Total de containers">Total</th>
            <th scope="col" title="Containers vazios">MTY</th>
            <th scope="col" title="Restow (remanejo a bordo)">RTW</th>
            <th scope="col" title="Break-bulk: máquinas / packages">BB</th>
            <th scope="col" title="Status de BLs e CEs da escala">CEs</th>
            <th scope="col" title="Manifestos vinculados à escala">Vinculada</th>
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
            const view = lineUpRowView(row)
            return (
              <tr key={row.id} className={view.isBerthed ? 'app-lineup-row--berthed' : undefined}>
                <td className="app-table__text font-semibold">
                  <Link className="app-link" to={`/viagens/${row.voyageId}`}>{row.vesselName}</Link>
                </td>
                <td>{row.voyageNumber}</td>
                <td><PodCell row={row} /></td>
                <td>{view.terminal}</td>
                <td className="tabular-nums"><DateCell value={view.arrival.value} actual={view.arrival.isActual} actualTitle="ATA registrada" /></td>
                <td className="tabular-nums"><DateCell value={view.berthing.value} actual={view.berthing.isActual} actualTitle="ATB registrada" /></td>
                {view.isExport ? (
                  <td colSpan={7} className="text-[var(--app-muted)]">{lineUpExportLabel(row)}</td>
                ) : (
                  <>
                    <td className="tabular-nums"><CargoLink row={row} cell="vin" /></td>
                    <td className="tabular-nums"><CargoLink row={row} cell="car" /></td>
                    <td className="tabular-nums"><CargoLink row={row} cell="cg" /></td>
                    <td className="font-semibold tabular-nums"><CargoLink row={row} cell="total" /></td>
                    <td className="tabular-nums"><CargoLink row={row} cell="mty" /></td>
                    <td className="tabular-nums"><CargoLink row={row} cell="rtw" /></td>
                    <td><CargoLink row={row} cell="bb" /></td>
                  </>
                )}
                <td><CeCell row={row} /></td>
                <td><StatusText tone={view.linked.tone === 'warning' ? 'warning' : 'default'}>{view.linked.label}</StatusText></td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function lineUpRowView(row: LineUpRow) {
  const isExport = row.rowType === 'export'
  return {
    isExport,
    terminal: isExport ? row.exportTerminal : row.importTerminal,
    arrival: arrivalDisplay({ eta: row.eta, ata: row.ata }),
    berthing: row.atb ? { value: row.atb, isActual: true } : { value: row.etb, isActual: false },
    isBerthed: deriveEscalaState({ atb: row.atb, atd: row.atd }) === 'atracada',
    linked: lineUpLinked(isExport ? row.exportLinked : row.linked),
  }
}

function LineUpCard({ row }: { row: LineUpRow }) {
  const view = lineUpRowView(row)
  const aside = [row.voyageNumber, row.pod, row.omitted ? 'Omitida' : null, view.isBerthed ? 'Atracado' : null].filter(Boolean).join(' · ')
  return (
    <Block
      headingLevel={3}
      title={<Link className="app-link" to={`/viagens/${row.voyageId}`}>{row.vesselName}</Link>}
      aside={aside}
    >
      <FactList columns={3}>
        <Fact label="Terminal">{view.terminal}</Fact>
        <Fact label="ETA"><DateCell value={view.arrival.value} actual={view.arrival.isActual} actualTitle="ATA registrada" /></Fact>
        <Fact label="ETB"><DateCell value={view.berthing.value} actual={view.berthing.isActual} actualTitle="ATB registrada" /></Fact>
        {view.isExport ? null : (
          <>
            <Fact label="VIN"><CargoLink row={row} cell="vin" /></Fact>
            <Fact label="VIN CNTR"><CargoLink row={row} cell="car" /></Fact>
            <Fact label="CG"><CargoLink row={row} cell="cg" /></Fact>
            <Fact label="Total"><CargoLink row={row} cell="total" /></Fact>
            <Fact label="MTY"><CargoLink row={row} cell="mty" /></Fact>
            <Fact label="RTW"><CargoLink row={row} cell="rtw" /></Fact>
            <Fact label="BB"><CargoLink row={row} cell="bb" /></Fact>
          </>
        )}
        <Fact label="CEs"><CeCell row={row} /></Fact>
        <Fact label="Vinculada"><StatusText tone={view.linked.tone === 'warning' ? 'warning' : 'default'}>{view.linked.label}</StatusText></Fact>
      </FactList>
      {view.isExport ? <p className="mt-2 text-[var(--app-muted)]">{lineUpExportLabel(row)}</p> : null}
    </Block>
  )
}

function PodCell({ row }: { row: LineUpRow }) {
  return (
    <>
      <span className="font-medium">{row.pod}</span>
      {row.omitted ? <> <StatusText tone="muted"><span title="Escala omitida — o navio não atracará neste porto.">Omitida</span></StatusText></> : null}
    </>
  )
}

function DateCell({ value, actual, actualTitle }: { value: string | null; actual: boolean; actualTitle: string }) {
  if (!value) return <NoValue label="Sem data" />
  return actual
    ? <span className="app-date--actual" title={actualTitle}>✓ {formatShortDateSafe(value)}</span>
    : <>{formatShortDateSafe(value)}</>
}

// "Aguardando" (CE ainda não recebido) é o único estado do CE que pede ação.
function CeCell({ row }: { row: LineUpRow }) {
  const isExport = row.rowType === 'export'
  const status = isExport ? row.exportCeStatus ?? 'waiting' : row.ceStatus
  const ce = lineUpCeStatus(status)
  const text = <StatusText tone={ce.tone === 'danger' ? 'warning' : 'default'}>{ce.label}</StatusText>
  if (isExport) return text
  return <Link to={`/bls?voyage=${row.voyageId}&pod=${encodeURIComponent(row.pod)}`} aria-label={`CEs: ${ce.label}`}>{text}</Link>
}

type CargoCell = 'vin' | 'car' | 'cg' | 'total' | 'mty' | 'rtw' | 'bb'

function CargoLink({ row, cell }: { row: LineUpRow; cell: CargoCell }) {
  const podQuery = `voyage=${row.voyageId}&pod=${encodeURIComponent(row.pod)}`
  switch (cell) {
    case 'vin': return <Link className="app-link" to={`/veiculos?voyage=${row.voyageId}`}>{formatLineUpInteger(row.vin)}</Link>
    case 'car': return <Link className="app-link" to={`/containers?${podQuery}&vehicle_container=true`}>{formatLineUpInteger(row.car)}</Link>
    case 'cg': return <Link className="app-link" to={`/containers?${podQuery}&vehicle_container=false`}>{formatLineUpInteger(row.cg)}</Link>
    case 'total': return <Link className="app-link" to={`/containers?${podQuery}`}>{formatLineUpInteger(row.total)}</Link>
    case 'mty': return <Link className="app-link" to={`/vazios-importacao?${podQuery}`}>{formatLineUpInteger(row.mty)}</Link>
    case 'rtw': return row.rtw === null ? <NoValue label="Sem restow" /> : <>{formatLineUpInteger(row.rtw)}</>
    case 'bb': return (
      <Link to={`/bls?${podQuery}&cargoMode=carga_solta`} className="app-link app-lineup-bb" aria-label={`${formatLineUpInteger(row.bbMachines)} máquinas e ${formatLineUpInteger(row.bbPackages)} packages`}>
        {formatLineUpInteger(row.bbMachines)} / {formatLineUpInteger(row.bbPackages)}
      </Link>
    )
  }
}
