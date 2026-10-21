import { Link } from 'react-router-dom'
import { NoValue } from '../ui/NoValue'
import { StatusText } from '../ui/StatusText'
import { queuedLabel } from '../../lib/communicationAutoRunner'
import { formatCommunicationDateTime } from '../../services/customerCommunicationTemplates'
import { COVERAGE_KINDS, type CoverageCell, type CoverageKind, type VoyageCommunicationCoverageSummary } from '../../services/customerCommunications'

const KIND_HEADERS: Record<CoverageKind, string> = {
  ce_mercante_taxas: 'CE e Taxas',
  aviso_chegada_noa: 'NOA',
  aviso_prontidao_nor: 'NOR',
  aviso_atracacao_nob: 'NOB',
}

function sentAtText(value: string): string {
  return `${formatCommunicationDateTime(value).replace(' (horário de Brasília)', '')} (BRT)`
}

/**
 * Uma célula do drill-down: a situação em texto, nunca só em cor. Âmbar só no
 * que pede ação (devido ou bloqueado); na fila e em envio seguem sozinhos.
 */
export function CoverageCellText({ cell, kind, now }: { cell: CoverageCell; kind: CoverageKind; now: Date }) {
  const sentLink = cell.communicationId != null && cell.sentAt ? (
    <Link className="app-link text-xs" to={`/clientes/comunicacao?tab=historico&communication=${cell.communicationId}`}>
      {cell.state === 'enviado' ? `Enviado em ${sentAtText(cell.sentAt)}` : `Último envio em ${sentAtText(cell.sentAt)}`}
    </Link>
  ) : null
  switch (cell.state) {
    case 'enviado':
      return sentLink ?? <StatusText tone="default">Enviado</StatusText>
    case 'na_fila':
      return <span className="inline-flex flex-col"><StatusText>{queuedLabel(now)}</StatusText>{sentLink}</span>
    case 'em_envio':
      return <span className="inline-flex flex-col"><StatusText>Em envio</StatusText>{sentLink}</span>
    case 'devido':
      return <StatusText tone="warning">Devido, não enviado</StatusText>
    case 'bloqueado':
      return (
        <span className="inline-flex flex-col">
          <StatusText tone="warning">Bloqueado</StatusText>
          {cell.reason ? <span className="text-xs text-[var(--app-muted)]">{cell.reason}</span> : null}
          {sentLink}
        </span>
      )
    case 'nao_devido':
      return <NoValue label={kind === 'aviso_atracacao_nob' ? 'Sem atracação devida' : 'Não devido'} />
  }
}

/** Os Clientes de uma linha da Cobertura (viagem × porto) e a situação de cada modelo. */
export function CoverageDrilldown({ row, now, id }: { row: VoyageCommunicationCoverageSummary; now: Date; id: string }) {
  const label = `Comunicados por Cliente — ${row.vesselName} / ${row.voyageNumber}${row.port ? `, ${row.port}` : ''}`
  if (!row.details.length) {
    return <p id={id} className="px-4 py-3 text-[var(--app-muted)]">Nenhum Cliente com B/L nesta linha.</p>
  }
  return (
    <div id={id} className="app-table-scroll">
      <table className="app-table">
        <caption className="sr-only">{label}</caption>
        <thead>
          <tr>
            <th scope="col" className="app-table__text-head">Cliente</th>
            {COVERAGE_KINDS.map((kind) => <th key={kind} scope="col" className="app-table__text-head">{KIND_HEADERS[kind]}</th>)}
          </tr>
        </thead>
        <tbody>
          {row.details.map((detail) => (
            <tr key={detail.customerId}>
              <th scope="row" className="app-table__text">{detail.customerName}</th>
              {COVERAGE_KINDS.map((kind) => (
                <td key={kind} className="app-table__text"><CoverageCellText cell={detail.cells[kind]} kind={kind} now={now} /></td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
