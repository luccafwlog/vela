import { Link } from 'react-router-dom'
import { Block } from '../ui/Block'
import { Button } from '../ui/Button'
import { NoValue } from '../ui/NoValue'
import { StatusText } from '../ui/StatusText'
import { formatDate } from '../../lib/utils'
import type { VoyageRailItem } from '../../services/voyageSummaries'

const CONCILIACAO_LABEL: Record<VoyageRailItem['estado'], string> = {
  conciliado: 'Conciliada',
  incompleto: 'Pendente',
  divergente: 'Divergente',
  verificando: 'Verificando',
}

function shortDate(iso: string | null | undefined) {
  return iso ? formatDate(iso).slice(0, 5) : null
}

/**
 * Tabela de viagens quando nenhuma está escolhida (lote 2, 2026-10-16), na
 * mesma ordem e com os mesmos filtros da faixa de cartões, que continua em
 * cima. A linha abre a ficha da Viagem, como o cartão.
 */
export function VoyageListTable({ items, breakbulkTons, breakbulkError = false, vehicleCounts, onEdit }: {
  items: readonly VoyageRailItem[]
  breakbulkTons: ReadonlyMap<number, number> | undefined
  /** A leitura das toneladas falhou: o traço diz que não carregou, não que não há carga solta. */
  breakbulkError?: boolean
  vehicleCounts: Readonly<Record<number, { totalVehicles?: number } | undefined>>
  onEdit?: (id: number) => void
}) {
  return (
    <Block title="Viagens" aside={`${items.length} ${items.length === 1 ? 'viagem' : 'viagens'} · por próxima escala no Brasil`} flush>
      <div className="app-table-scroll">
        <table className="app-table">
          <caption className="sr-only">Viagens do recorte, por próxima escala no Brasil</caption>
          <thead>
            <tr>
              <th scope="col" className="app-table__text-head">Navio / Viagem</th>
              <th scope="col" className="app-table__text-head">Armador</th>
              <th scope="col">Próxima escala</th>
              <th scope="col" className="app-table__text-head">Escalas no Brasil</th>
              <th scope="col">B/Ls</th>
              <th scope="col">Containers</th>
              <th scope="col">BB (t)</th>
              <th scope="col">Veículos</th>
              <th scope="col">CE</th>
              <th scope="col" className="app-table__text-head">Conciliação</th>
              {onEdit ? <th scope="col"><span className="sr-only">Ações</span></th> : null}
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const tons = breakbulkTons?.get(item.id)
              const vehicles = vehicleCounts[item.id]?.totalVehicles ?? 0
              const ce = item.ceCoverage
              return (
                <tr key={item.id} className={item.status === 'cancelled' ? 'app-table__row--muted' : undefined}>
                  <td className="app-table__text"><Link className="app-link font-semibold" to={`/viagens/${item.id}`}>{item.vesselName} / {item.voyageNumber}</Link></td>
                  <td className="app-table__text">{item.carrierName || <NoValue label="Sem armador" />}</td>
                  <td className="tabular-nums">{item.proximaEscala ? `${item.proximaEscala.pod} ${formatDate(item.proximaEscala.eta)}` : <NoValue label="Sem próxima escala" />}</td>
                  <td className="app-table__text">
                    {item.escalasBrasileiras.length
                      ? item.escalasBrasileiras.map((escala) => [escala.port, shortDate(escala.eta)].filter(Boolean).join(' ')).join(' · ')
                      : <StatusText tone="muted">Sem escala brasileira prevista</StatusText>}
                  </td>
                  <td className="tabular-nums">{(item.blCount ?? 0).toLocaleString('pt-BR')}</td>
                  <td className="tabular-nums">{(item.containerCount ?? 0).toLocaleString('pt-BR')}</td>
                  <td className="tabular-nums">{tons != null
                    ? tons.toLocaleString('pt-BR', { maximumFractionDigits: 1 })
                    // Mapa carregado sem a viagem: ela não tem B/L de carga solta ativo.
                    : <NoValue label={breakbulkTons ? 'Sem carga solta' : breakbulkError ? 'Toneladas de carga solta não carregadas' : 'Carregando toneladas de carga solta'} />}</td>
                  <td className="tabular-nums">{vehicles.toLocaleString('pt-BR')}</td>
                  <td className="tabular-nums">{ce && ce.total > 0 ? (ce.filled < ce.total ? <StatusText tone="warning">{ce.filled} de {ce.total}</StatusText> : `${ce.filled} de ${ce.total}`) : <NoValue label="Sem B/L" />}</td>
                  <td className="app-table__text">{item.estado === 'conciliado' ? CONCILIACAO_LABEL[item.estado] : item.estado === 'verificando' ? <StatusText tone="muted">{CONCILIACAO_LABEL[item.estado]}</StatusText> : <StatusText tone="warning">{CONCILIACAO_LABEL[item.estado]}</StatusText>}</td>
                  {onEdit ? (
                    <td>{item.status === 'cancelled' ? null : <Button variant="secondary" className="app-btn--sm" onClick={() => onEdit(item.id)} aria-label={`Editar viagem ${item.vesselName} / ${item.voyageNumber}`}>Editar</Button>}</td>
                  ) : null}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Block>
  )
}
