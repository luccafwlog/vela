import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { ArrowDown, ArrowUp, ArrowUpDown, Download } from 'lucide-react'
import { Block } from '../ui/Block'
import { Button } from '../ui/Button'
import { EmptyState } from '../ui/Card'
import { CopyValue } from '../ui/CopyValue'
import { NoValue } from '../ui/NoValue'
import { ConsolidatedMark, StatusText } from '../ui/StatusText'
import { SkeletonTable } from '../ui/Skeleton'
import { FilterBar } from '../ui/FilterBar'
import { Field, Input, Select } from '../ui/Input'
import { Combobox, type ComboOption } from '../ui/Combobox'
import { TableFooterPagination } from '../ui/TableFooterPagination'
import { useToast } from '../ui/Toast'
import { useNarrowViewport } from '../bl/useNarrowViewport'
import { extractErrorText } from '../../lib/errors'
import { formatBRL, formatCnpjCpf, formatDate } from '../../lib/utils'
import { invoiceTypeLabel, listBillingCustomers } from '../../services/billing'
import { historyRowStatus, pluralize } from './pixReconciliationPresentation'
import { queryKeys } from '../../services/queryKeys'
import {
  exportReconciliationHistoryExcel,
  historyBalance,
  historyPaidAmount,
  listReconciliationHistory,
  type ReconciliationFilters,
  type ReconciliationHistoryRow,
} from '../../services/reconciliacao'
import {
  HISTORY_PAGE_SIZES,
  countActiveHistoryFilters,
  historyStateFromSearch,
  withHistoryCustomer,
  withHistoryFilter,
  withHistoryPage,
  withHistoryPageSize,
  withHistorySort,
  withoutHistoryFilters,
  type HistoryFilterKey,
  type HistoryUrlState,
  type HistorySortField,
} from '../../pages/reconciliacaoState'

type ReconciliationHistoryTableProps = {
  onSelectLocalInvoice?: (invoiceId: number, paymentId: number | null) => void
  onSelectDemurrageInvoice?: (demurrageId: number) => void
}

const sourceLabel = (row: ReconciliationHistoryRow) => (row.source === 'demurrage' ? 'Demurrage' : 'Taxas Locais')

function shipLine(row: ReconciliationHistoryRow): string | null {
  return [row.vesselName, row.voyageNumber].filter(Boolean).join(' / ') || null
}

/** Filtros que ficam em "Mais filtros"; os demais ficam abertos. */
const MORE_FILTER_KEYS: readonly HistoryFilterKey[] = ['invoiceTypeFilter', 'vesselSearch', 'voyageSearch', 'pod']

function countMoreFilters(state: HistoryUrlState) {
  return MORE_FILTER_KEYS.filter((key) => String(state[key] ?? '').trim() !== '').length
}

function HistoryStatus({ row }: { row: ReconciliationHistoryRow }) {
  const status = historyRowStatus(row)
  if (status.kind === 'paid') return <StatusText tone="paid">{status.label}</StatusText>
  if (status.kind === 'covered') return <span className="inline-flex items-center gap-1"><ConsolidatedMark />{status.label}</span>
  return <>{status.label}</>
}

function PaidAmount({ row }: { row: ReconciliationHistoryRow }) {
  const paid = historyPaidAmount(row)
  return paid == null ? <NoValue label="Pago pela consolidada" /> : <>{formatBRL(paid)}</>
}

/** Saldo maior que zero em âmbar: ainda há o que receber. */
function Balance({ row }: { row: ReconciliationHistoryRow }) {
  const balance = historyBalance(row)
  return balance > 0.005 ? <StatusText tone="warning">{formatBRL(balance)}</StatusText> : <>{formatBRL(balance)}</>
}

function isConsolidated(row: ReconciliationHistoryRow) {
  return row.source === 'local' && row.invoiceType === 'consolidated'
}

/**
 * Histórico de baixas confirmadas (Taxas Locais e Demurrage), seja pelo Itaú,
 * pelo extrato ou pelo registro manual. Filtros, ordenação e página ficam na
 * URL; o número da fatura abre o detalhe, onde a baixa pode ser cancelada.
 * Tabela limpa (lote 3 da identidade): nada escrito embaixo da célula.
 */
export function ReconciliationHistoryTable({
  onSelectLocalInvoice,
  onSelectDemurrageInvoice,
}: ReconciliationHistoryTableProps) {
  const { showToast } = useToast()
  const narrow = useNarrowViewport()
  const [searchParams, setSearchParams] = useSearchParams()
  const state = historyStateFromSearch(searchParams)
  const [exporting, setExporting] = useState(false)

  const filters: ReconciliationFilters = {
    paidFrom: state.paidFrom,
    paidTo: state.paidTo,
    source: state.source,
    customerId: state.customerId,
    blSearch: state.blSearch.trim(),
    vesselSearch: state.vesselSearch.trim(),
    voyageSearch: state.voyageSearch.trim(),
    invoiceTypeFilter: state.invoiceTypeFilter,
    pod: state.pod.trim(),
    sort: state.sort,
    sortDir: state.sortDir,
    page: state.page,
    pageSize: state.pageSize,
  }
  const activeCount = countActiveHistoryFilters(state)
  const moreCount = countMoreFilters(state)

  const query = useQuery({
    queryKey: [...queryKeys.reconciliation.history(), filters],
    queryFn: () => listReconciliationHistory(filters),
    staleTime: 15_000,
  })

  const rows = query.data?.rows ?? []
  const totalCount = query.data?.totalCount ?? 0
  const summary = query.data?.summary
  const totalPages = Math.max(1, Math.ceil(totalCount / state.pageSize))
  const failed = Boolean(query.error)
  // Página além do fim (link compartilhado, ou baixa cancelada na última página):
  // vai para a última existente em vez de dizer que não há baixas.
  const pastEnd = Boolean(query.data) && state.page > totalPages

  const update = (next: (params: URLSearchParams) => URLSearchParams) => setSearchParams((params) => next(params), { replace: true })
  useEffect(() => {
    if (pastEnd) setSearchParams((params) => withHistoryPage(params, totalPages), { replace: true })
  }, [pastEnd, totalPages, setSearchParams])
  const setFilter = (key: HistoryFilterKey, value: string) => update((params) => withHistoryFilter(params, key, value))
  const open = (row: ReconciliationHistoryRow) => {
    if (row.source === 'local') onSelectLocalInvoice?.(row.invoiceId, row.paymentId)
    else onSelectDemurrageInvoice?.(row.invoiceId)
  }

  async function handleExport() {
    setExporting(true)
    try {
      await exportReconciliationHistoryExcel(filters)
    } catch {
      showToast('Falha ao exportar o histórico de baixas.', 'error')
    } finally {
      setExporting(false)
    }
  }

  function sortHeader(field: HistorySortField, label: string, className?: string) {
    const active = state.sort === field
    return (
      <th scope="col" className={className} aria-sort={active ? (state.sortDir === 'asc' ? 'ascending' : 'descending') : undefined}>
        <button type="button" className="app-table__sort" onClick={() => update((params) => withHistorySort(params, field))}>
          {label}
          {active ? (
            state.sortDir === 'desc' ? <ArrowDown size={13} aria-hidden="true" /> : <ArrowUp size={13} aria-hidden="true" />
          ) : (
            <ArrowUpDown size={13} className="opacity-30" aria-hidden="true" />
          )}
        </button>
      </th>
    )
  }

  const columns = 9
  const empty = !query.isLoading && !failed && !pastEnd && rows.length === 0
  const emptyState = activeCount > 0 ? (
    <EmptyState
      title="Nenhuma baixa neste recorte"
      description="Nenhum pagamento confirmado bate com os filtros."
      action={<Button variant="secondary" onClick={() => update(withoutHistoryFilters)}>Limpar filtros</Button>}
    />
  ) : (
    <EmptyState title="Nenhuma baixa registrada ainda" description="Pagamentos confirmados pelo Itaú, pelo extrato ou registrados à mão aparecem aqui." />
  )

  const invoiceButton = (row: ReconciliationHistoryRow) => (
    <>
      <button type="button" className="app-link" onClick={() => open(row)}>{row.docNumber}</button>
      {isConsolidated(row) ? <ConsolidatedMark /> : null}
    </>
  )
  const blValue = (row: ReconciliationHistoryRow) =>
    row.blId === '-' || !row.blId ? <NoValue label="Sem B/L" /> : <CopyValue value={row.blId} label="número do B/L" />

  return (
    <div className="grid min-w-0 gap-4">
      <div className="grid gap-3" role="group" aria-label="Filtros do histórico">
        <div className="app-filter-grid">
          <Field label="Pago de">
            <Input type="date" value={state.paidFrom} max={state.paidTo || undefined} onChange={(e) => setFilter('paidFrom', e.target.value)} />
          </Field>
          <Field label="Pago até">
            <Input type="date" value={state.paidTo} min={state.paidFrom || undefined} onChange={(e) => setFilter('paidTo', e.target.value)} />
          </Field>
          <Field label="Origem">
            <Select value={state.source} onChange={(e) => setFilter('source', e.target.value)}>
              <option value="">Todas</option>
              <option value="local">Taxas Locais</option>
              <option value="demurrage">Demurrage</option>
            </Select>
          </Field>
          <Combobox
            key={state.customerId || 'sem-cliente'}
            label="Cliente"
            placeholder="Nome ou CNPJ"
            initialValue={state.customerName}
            onValueChange={(value) => { if (!value.trim() && state.customerId) update((params) => withHistoryCustomer(params, null)) }}
            fetchOptions={async (q) =>
              (await listBillingCustomers(q)).map((c): ComboOption => ({ value: String(c.id), label: c.name, meta: formatCnpjCpf(c.cnpj_cpf) }))
            }
            onSelectOption={(option) => update((params) => withHistoryCustomer(params, { id: option.value, name: option.label }))}
          />
          <Field label="B/L">
            <Input type="text" placeholder="Número do B/L" value={state.blSearch} onChange={(e) => setFilter('blSearch', e.target.value)} />
          </Field>
          {activeCount > moreCount ? (
            <div className="self-end">
              <Button variant="ghost" onClick={() => update(withoutHistoryFilters)}>Limpar filtros</Button>
            </div>
          ) : null}
        </div>
        <FilterBar title="Mais filtros" activeCount={moreCount} onClear={() => update(withoutHistoryFilters)}>
          <div className="app-filter-grid">
            <Field label="Tipo de fatura" hint={state.source === 'demurrage' ? 'Só vale para Taxas Locais.' : undefined}>
              <Select value={state.invoiceTypeFilter} disabled={state.source === 'demurrage'} onChange={(e) => setFilter('invoiceTypeFilter', e.target.value)}>
                <option value="">Todos</option>
                <option value="single">{invoiceTypeLabel('individual')}</option>
                <option value="consolidated">{invoiceTypeLabel('consolidated')}</option>
                <option value="manual">{invoiceTypeLabel('manual')}</option>
              </Select>
            </Field>
            <Field label="Navio">
              <Input type="text" value={state.vesselSearch} onChange={(e) => setFilter('vesselSearch', e.target.value)} />
            </Field>
            <Field label="Viagem">
              <Input type="text" value={state.voyageSearch} onChange={(e) => setFilter('voyageSearch', e.target.value)} />
            </Field>
            <Field label="POD">
              <Input type="text" value={state.pod} onChange={(e) => setFilter('pod', e.target.value)} />
            </Field>
          </div>
        </FilterBar>
      </div>

      <Block
        title="Baixas"
        flush
        aside={(
          <>
            <span aria-live="polite">
              {summary && !failed
                ? `${pluralize(summary.invoices, 'baixa', 'baixas')} · ${formatBRL(summary.received)} recebidos${activeCount ? ' no recorte' : ''}`
                : failed ? 'Histórico indisponível' : 'Carregando…'}
            </span>
            <Button
              variant="secondary"
              className="app-btn--sm"
              onClick={handleExport}
              loading={exporting}
              loadingLabel="Exportando…"
              disabled={!totalCount}
              title={totalCount ? undefined : 'Nada a exportar neste recorte'}
            >
              <Download size={14} aria-hidden="true" />
              Exportar planilha
            </Button>
          </>
        )}
      >
        {failed ? (
          <div role="alert" className="app-block__body">
            <p>Não foi possível carregar o histórico de baixas: {extractErrorText(query.error)}</p>
            <Button variant="secondary" onClick={() => void query.refetch()}>Tentar novamente</Button>
          </div>
        ) : null}

        {narrow ? (
          <div className="app-invoice-cards">
            {query.isLoading ? <SkeletonTable rows={4} cols={2} /> : null}
            {empty ? emptyState : null}
            {rows.map((row) => (
              <article key={row.id} className="app-invoice-card" aria-label={`Fatura ${row.docNumber}`}>
                <div className="app-invoice-card__head">
                  <span>{invoiceButton(row)}</span>
                  <HistoryStatus row={row} />
                </div>
                <div className="app-invoice-card__amount">
                  Pago <PaidAmount row={row} /> · Saldo <Balance row={row} />
                </div>
                <div>{row.customerName || <NoValue label="Sem Cliente" />}</div>
                <p className="app-invoices__meta">{sourceLabel(row)} · pago em {row.paidAt ? formatDate(row.paidAt) : <NoValue label="Sem data de pagamento" />}</p>
                <div>{blValue(row)}</div>
              </article>
            ))}
          </div>
        ) : (
          <div className="app-table-scroll app-table-scroll--sticky">
            <table className="app-table app-table--compact">
              <caption className="sr-only">Histórico de baixas</caption>
              <thead>
                <tr>
                  {sortHeader('docNumber', 'Fatura')}
                  <th scope="col">Origem</th>
                  {sortHeader('blId', 'B/L')}
                  {sortHeader('customerName', 'Cliente', 'app-table__text-head')}
                  <th scope="col" className="app-table__text-head">Navio / Viagem</th>
                  {sortHeader('paidAt', 'Pago em')}
                  <th scope="col">Valor pago</th>
                  <th scope="col">Saldo</th>
                  <th scope="col">Situação</th>
                </tr>
              </thead>
              <tbody>
                {query.isLoading ? (
                  <tr><td colSpan={columns} className="p-0"><SkeletonTable rows={6} cols={columns} /></td></tr>
                ) : null}
                {empty ? <tr><td colSpan={columns} className="p-0">{emptyState}</td></tr> : null}
                {rows.map((row) => {
                  const ship = shipLine(row)
                  return (
                    <tr key={row.id}>
                      <td className="whitespace-nowrap">{invoiceButton(row)}</td>
                      <td className="whitespace-nowrap">{sourceLabel(row)}</td>
                      <td className="whitespace-nowrap">{blValue(row)}</td>
                      <td className="app-table__text" title={row.customerName || undefined}>{row.customerName || <NoValue label="Sem Cliente" />}</td>
                      <td className="app-table__text" title={ship ?? undefined}>{ship ?? <NoValue label="Sem navio e viagem" />}</td>
                      <td className="whitespace-nowrap tabular-nums">{row.paidAt ? formatDate(row.paidAt) : <NoValue label="Sem data de pagamento" />}</td>
                      <td className="whitespace-nowrap tabular-nums"><PaidAmount row={row} /></td>
                      <td className="whitespace-nowrap tabular-nums"><Balance row={row} /></td>
                      <td className="whitespace-nowrap"><HistoryStatus row={row} /></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {query.data && !pastEnd ? (
          <TableFooterPagination
            page={state.page}
            pageSize={state.pageSize}
            totalCount={totalCount}
            totalPages={totalPages}
            pageSizes={HISTORY_PAGE_SIZES}
            onPageChange={(page) => update((params) => withHistoryPage(params, page))}
            onPageSizeChange={(size) => update((params) => withHistoryPageSize(params, size))}
          />
        ) : null}
      </Block>
    </div>
  )
}
