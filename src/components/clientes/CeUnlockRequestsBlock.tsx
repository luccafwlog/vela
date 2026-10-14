import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { Block } from '../ui/Block'
import { Button } from '../ui/Button'
import { Field, Input } from '../ui/Input'
import { NoValue } from '../ui/NoValue'
import { StatusText } from '../ui/StatusText'
import { TableFooterPagination } from '../ui/TableFooterPagination'
import { CeUnlockSla } from '../ce-unlock/CeUnlockSla'
import { useCustomerCeUnlockRequests } from '../../hooks/useCeUnlock'
import { useDebouncedValue } from '../../hooks/useDebouncedValue'
import { ceStateLabel } from '../../lib/ceUnlockLabels'
import { formatCountLabel, formatDate } from '../../lib/utils'
import type { CeUnlockReviewRow } from '../../types/ceUnlock'

const DOCUMENT_STATUS: Record<string, [string, 'default' | 'warning' | 'muted']> = {
  uploaded: ['Aguardando análise', 'warning'],
  approved: ['Aprovado', 'default'],
  changes_requested: ['Recusado, aguardando o Cliente', 'warning'],
  revoked: ['Revogado', 'muted'],
}

function DocumentStatus({ status }: { status: CeUnlockReviewRow['termo_status'] }) {
  if (!status) return <StatusText tone="muted">Não enviado</StatusText>
  const [label, tone] = DOCUMENT_STATUS[status] ?? [status, 'default']
  return <StatusText tone={tone}>{label}</StatusText>
}

const OPEN_STATES = new Set(['draft', 'submitted', 'in_review', 'changes_requested'])

/** Solicitações de desbloqueio do Cliente (lote 1 da identidade), antes da Condição VIP. */
export function CeUnlockRequestsBlock({ customerId, manage }: { customerId: number; manage: boolean }) {
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const debounced = useDebouncedValue(search)
  const query = useCustomerCeUnlockRequests(customerId, debounced, page)
  const rows = query.data?.items ?? []
  const total = query.data?.total ?? 0
  const pageSize = query.data?.page_size ?? 20

  return (
    <Block
      title="Solicitações de desbloqueio"
      headingLevel={2}
      flush
      aside={(
        <>
          {query.data ? <span>{formatCountLabel(total, 'solicitação', 'solicitações')}{rows.some((row) => OPEN_STATES.has(row.state)) ? ' · com pedido em andamento' : ''}</span> : null}
          <Link className="app-btn app-btn--secondary app-btn--sm" to="/desbloqueio-ce">
            Abrir em Desbloqueio de CE <ArrowRight size={14} aria-hidden="true" />
          </Link>
        </>
      )}
    >
      <div className="app-block__body">
        <div className="app-filter-grid">
          <Field label="Buscar B/L">
            <Input placeholder="Ex.: COSU6401234501" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1) }} />
          </Field>
        </div>
      </div>
      {query.isLoading ? <p className="app-block__body app-facts__detail" role="status">Carregando as solicitações…</p>
        : query.isError ? (
          <div className="app-block__body app-customer-notice app-customer-notice--danger" role="alert">
            <span>Não foi possível carregar as solicitações.</span>
            <Button variant="secondary" className="app-btn--sm" onClick={() => void query.refetch()}>Tentar novamente</Button>
          </div>
        )
        : !rows.length ? <p className="app-block__body app-facts__detail">{debounced.trim() ? 'Nenhuma solicitação com esse B/L.' : 'Nenhuma solicitação de desbloqueio deste Cliente.'}</p>
        : (
          <>
            <div className="app-table-scroll">
              <table className="app-table app-table--compact">
                <caption className="sr-only">Solicitações de desbloqueio de CE do Cliente</caption>
                <thead>
                  <tr>
                    <th scope="col">Protocolo</th>
                    <th scope="col">B/Ls</th>
                    <th scope="col">Situação</th>
                    <th scope="col">Termo de devolução</th>
                    <th scope="col">Procuração</th>
                    <th scope="col">Prazo</th>
                    <th scope="col">Aberta em</th>
                    <th scope="col"><span className="sr-only">Ação</span></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id}>
                      <td className="whitespace-nowrap"><strong>{row.protocol}</strong></td>
                      <td className="whitespace-nowrap">
                        {row.bl_ids.length ? (
                          <>
                            <Link className="app-customer-link app-customer-code" to={`/bls/${row.bl_ids[0]}`}>{row.bl_ids[0]}</Link>
                            {row.bl_ids.length > 1 ? <span className="app-facts__detail" title={row.bl_ids.join(', ')}> +{row.bl_ids.length - 1}</span> : null}
                          </>
                        ) : <NoValue label="Sem B/L" />}
                      </td>
                      <td className="whitespace-nowrap"><StatusText tone={row.state === 'changes_requested' ? 'warning' : row.state === 'cancelled' ? 'muted' : 'default'}>{ceStateLabel(row.state)}</StatusText></td>
                      <td className="whitespace-nowrap"><DocumentStatus status={row.termo_status} /></td>
                      <td className="whitespace-nowrap"><DocumentStatus status={row.procuracao_status} /></td>
                      <td><CeUnlockSla start={OPEN_STATES.has(row.state) ? row.sla_started_at : null} /></td>
                      <td className="whitespace-nowrap tabular-nums">{formatDate(row.created_at)}</td>
                      <td>
                        <Link className="app-btn app-btn--secondary app-btn--sm" to={`/desbloqueio-ce?pedido=${row.id}`} aria-label={`${manage && OPEN_STATES.has(row.state) ? 'Analisar' : 'Ver'} ${row.protocol}`}>
                          {manage && OPEN_STATES.has(row.state) ? 'Analisar' : 'Ver'}
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {total > pageSize ? (
              <TableFooterPagination page={page} pageSize={pageSize} totalCount={total} totalPages={Math.ceil(total / pageSize)} onPageChange={setPage} pageSizes={[pageSize]} />
            ) : null}
          </>
        )}
    </Block>
  )
}
