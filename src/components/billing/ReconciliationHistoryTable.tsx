import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { ArrowDown, ArrowUp, ArrowUpDown, Download } from 'lucide-react'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { EmptyState } from '../ui/Card'
import { SkeletonTable } from '../ui/Skeleton'
import { FilterBar } from '../ui/FilterBar'
import { Field, Input, Select } from '../ui/Input'
import { Combobox, type ComboOption } from '../ui/Combobox'
import { TableFooterPagination } from '../ui/TableFooterPagination'
import { useToast } from '../ui/Toast'
import { useNarrowViewport } from '../bl/useNarrowViewport'
import { describePageRange } from '../../lib/pagination'
import { extractErrorText } from '../../lib/errors'
import { formatBRL, formatCnpjCpf, formatDate } from '../../lib/utils'
import { invoiceTypeLabel, listBillingCustomers } from '../../services/billing'
import { historyRowStatus } from './pixReconciliationPresentation'
import { queryKeys } from '../../services/queryKeys'
import {
  exportReconciliationHistoryExcel,
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
  type HistorySortField,
} from '../../pages/reconciliacaoState'

type ReconciliationHistoryTableProps = {
  onSelectLocalInvoice?: (invoiceId: number, paymentId: number | null) => void
  onSelectDemurrageInvoice?: (demurrageId: number) => void
}

function amountLines(row: ReconciliationHistoryRow) {
  const lines: string[] = []
  if (Math.abs(row.totalAmount - row.blAmount) > 0.005) lines.push(`de ${formatBRL(row.totalAmount)} na fatura`)
  if (row.status === 'partially_paid' && row.totalPaid != null) {
    lines.push(`recebido ${formatBRL(row.totalPaid)}${row.balance != null ? ` · saldo ${formatBRL(row.balance)}` : ''}`)
  }
  return lines
}

function docTypeLabel(row: ReconciliationHistoryRow) {
  return row.source === 'demurrage' ? 'Demurrage' : `Taxas Locais · ${invoiceTypeLabel(row.invoiceType)}`
}

function shipLine(row: ReconciliationHistoryRow) {
  const ship = [row.vesselName, row.voyageNumber].filter(Boolean).join(' · ')
  return [ship || null, row.pod].filter(Boolean).join(' · ') || '—'
}

/**
 * Histórico de baixas confirmadas (Taxas Locais e Demurrage), seja pelo Itaú,
 * pelo extrato ou pelo registro manual. Filtros, ordenação e página ficam na
 * URL; o número do documento abre o detalhe, onde a baixa pode ser cancelada.
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

  const query = useQuery({
    queryKey: [...queryKeys.reconciliation.history(), filters],
    queryFn: () => listReconciliationHistory(filters),
    staleTime: 15_000,
  })

  const rows = query.data?.rows ?? []
  const totalCount = query.data?.totalCount ?? 0
  const totalPages = Math.max(1, Math.ceil(totalCount / state.pageSize))
  const failed = Boolean(query.error)
  const range = query.data ? describePageRange({ page: state.page, pageSize: state.pageSize, totalCount }) : null

  const update = (next: (params: URLSearchParams) => URLSearchParams) => setSearchParams((params) => next(params), { replace: true })
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

  const empty = !query.isLoading && !failed && rows.length === 0
  const emptyState = activeCount > 0 ? (
    <EmptyState
      title="Nenhuma baixa neste recorte"
      description="Nenhum pagamento confirmado bate com os filtros."
      action={<Button variant="secondary" onClick={() => update(withoutHistoryFilters)}>Limpar filtros</Button>}
    />
  ) : (
    <EmptyState title="Nenhuma baixa registrada ainda" description="Pagamentos confirmados pelo Itaú, pelo extrato ou registrados à mão aparecem aqui." />
  )

  return (
    <section className="app-invoices app-pix-history" aria-label="Histórico de baixas">
      <div className="app-pix-history__filters">
        <FilterBar activeCount={activeCount} onClear={() => update(withoutHistoryFilters)} title="Filtros do histórico">
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
            <Field label="Tipo de fatura" hint={state.source === 'demurrage' ? 'Só vale para Taxas Locais.' : undefined}>
              <Select value={state.invoiceTypeFilter} disabled={state.source === 'demurrage'} onChange={(e) => setFilter('invoiceTypeFilter', e.target.value)}>
                <option value="">Todos</option>
                <option value="single">{invoiceTypeLabel('individual')}</option>
                <option value="consolidated">{invoiceTypeLabel('consolidated')}</option>
                <option value="manual">{invoiceTypeLabel('manual')}</option>
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
              <Input type="text" value={state.blSearch} onChange={(e) => setFilter('blSearch', e.target.value)} />
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

      <div className="app-invoices__bar">
        <p className="app-invoices__summary" aria-live="polite">{range ?? (failed ? 'Histórico indisponível' : 'Carregando…')}</p>
        <div className="app-invoices__actions">
          <Button
            variant="secondary"
            onClick={handleExport}
            loading={exporting}
            loadingLabel="Exportando…"
            disabled={!totalCount}
            title={totalCount ? undefined : 'Nada a exportar neste recorte'}
          >
            <Download size={15} aria-hidden="true" />
            Exportar planilha
          </Button>
        </div>
      </div>

      {failed ? (
        <div role="alert" className="app-invoices__error">
          <p>Não foi possível carregar o histórico de baixas: {extractErrorText(query.error)}</p>
          <Button variant="secondary" onClick={() => void query.refetch()}>Tentar novamente</Button>
        </div>
      ) : null}

      {narrow ? (
        <div className="app-invoice-cards">
          {query.isLoading ? <SkeletonTable rows={4} cols={2} /> : null}
          {empty ? emptyState : null}
          {rows.map((row) => {
            const status = historyRowStatus(row)
            return (
              <article key={row.id} className="app-invoice-card">
                <div className="app-invoice-card__head">
                  <button type="button" className="app-invoices__number" onClick={() => open(row)}>{row.docNumber}</button>
                  <Badge tone={status.tone}>{status.label}</Badge>
                </div>
                <p className="app-invoice-card__amount">
                  <span className="app-invoices__amount">{formatBRL(row.blAmount)}</span>
                  {amountLines(row).map((line) => <span key={line} className="app-invoices__meta">{line}</span>)}
                </p>
                <p className="app-invoices__meta">{docTypeLabel(row)} · pago em {row.paidAt ? formatDate(row.paidAt) : '—'}</p>
                <p className="app-invoices__customer">{row.customerName || '—'}</p>
                <p className="app-invoices__meta">
                  {row.blId === '-' ? 'Sem B/L' : <span className="app-pix-code">{row.blId}</span>} · {shipLine(row)}
                </p>
              </article>
            )
          })}
        </div>
      ) : (
        <div className="app-table-scroll app-table-scroll--sticky">
          <table className="app-table app-table--compact app-pix-history__table">
            <caption className="sr-only">Histórico de baixas</caption>
            <thead>
              <tr>
                {sortHeader('docNumber', 'Fatura')}
                {sortHeader('blId', 'B/L')}
                {sortHeader('customerName', 'Cliente')}
                <th scope="col">Navio / Viagem · POD</th>
                {sortHeader('paidAt', 'Pago em')}
                <th scope="col">Situação</th>
                {sortHeader('blAmount', 'Valor', 'app-invoices__num')}
              </tr>
            </thead>
            <tbody>
              {query.isLoading ? (
                <tr><td colSpan={7} className="p-0"><SkeletonTable rows={6} cols={7} /></td></tr>
              ) : null}
              {empty ? <tr><td colSpan={7} className="p-0">{emptyState}</td></tr> : null}
              {rows.map((row) => {
                const status = historyRowStatus(row)
                return (
                  <tr key={row.id}>
                    <td>
                      <button type="button" className="app-invoices__number" onClick={() => open(row)}>{row.docNumber}</button>
                      <span className="app-invoices__meta">{docTypeLabel(row)}</span>
                    </td>
                    <td>{row.blId === '-' ? <span className="app-pix-muted">Sem B/L</span> : <span className="app-pix-code">{row.blId}</span>}</td>
                    <td>
                      <span className="app-invoices__customer app-invoices__clamp" title={row.customerName}>{row.customerName || '—'}</span>
                      {row.customerCnpj ? <span className="app-invoices__meta tabular-nums">{formatCnpjCpf(row.customerCnpj)}</span> : null}
                    </td>
                    <td><span className="app-invoices__clamp">{shipLine(row)}</span></td>
                    <td className="app-invoices__date tabular-nums">{row.paidAt ? formatDate(row.paidAt) : '—'}</td>
                    <td><Badge tone={status.tone}>{status.label}</Badge></td>
                    <td className="app-invoices__num">
                      <span className="app-invoices__amount">{formatBRL(row.blAmount)}</span>
                      {amountLines(row).map((line) => <span key={line} className="app-invoices__meta">{line}</span>)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {query.data ? (
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
    </section>
  )
}
