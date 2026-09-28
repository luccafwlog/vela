import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, ArrowUpDown, Eye } from 'lucide-react'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Card, EmptyState, InlineError } from '../ui/Card'
import { SkeletonTable } from '../ui/Skeleton'
import { FilterBar } from '../ui/FilterBar'
import { Field, Input, Select } from '../ui/Input'
import { Combobox, type ComboOption } from '../ui/Combobox'
import { useToast } from '../ui/Toast'
import { formatBRL, formatDate } from '../../lib/utils'
import { invoiceTypeLabel, listBillingCustomers } from '../../services/billing'
import { TableFooterPagination } from '../ui/TableFooterPagination'
import { listReconciliationHistory, exportReconciliationHistoryExcel, type ReconciliationFilters } from '../../services/reconciliacao'

type SortField = NonNullable<ReconciliationFilters['sort']>

type SortConfig = { field: SortField; dir: 'asc' | 'desc' }

const DEFAULT_SORT: SortConfig = { field: 'paidAt', dir: 'desc' }

const PAGE_SIZES = [20, 50, 100]

type ReconciliationHistoryTableProps = {
  onSelectLocalInvoice?: (invoiceId: number, paymentId: number | null) => void
  onSelectDemurrageInvoice?: (demurrageId: number) => void
}

export function ReconciliationHistoryTable({
  onSelectLocalInvoice,
  onSelectDemurrageInvoice,
}: ReconciliationHistoryTableProps) {
  const { showToast } = useToast()
  const [paidFrom, setPaidFrom] = useState('')
  const [paidTo, setPaidTo] = useState('')
  const [sourceFilter, setSourceFilter] = useState<'' | 'local' | 'demurrage'>('')
  const [invoiceTypeFilter, setInvoiceTypeFilter] = useState<'' | 'consolidated' | 'single' | 'manual'>('')
  const [customerId, setCustomerId] = useState('')
  const [blSearch, setBlSearch] = useState('')
  const [vesselSearch, setVesselSearch] = useState('')
  const [voyageSearch, setVoyageSearch] = useState('')
  const [pod, setPod] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [sort, setSort] = useState<SortConfig>(DEFAULT_SORT)
  const [exporting, setExporting] = useState(false)

  const filters: ReconciliationFilters = {
    paidFrom, paidTo, source: sourceFilter, customerId,
    blSearch, vesselSearch, voyageSearch, invoiceTypeFilter, pod,
    sort: sort.field, sortDir: sort.dir,
    page, pageSize,
  }

  const activeCount = useMemo(() => {
    let n = 0
    if (paidFrom) n++
    if (paidTo) n++
    if (sourceFilter) n++
    if (invoiceTypeFilter) n++
    if (customerId) n++
    if (blSearch) n++
    if (vesselSearch) n++
    if (voyageSearch) n++
    if (pod) n++
    return n
  }, [paidFrom, paidTo, sourceFilter, invoiceTypeFilter, customerId, blSearch, vesselSearch, voyageSearch, pod])

  const { data, isLoading, error } = useQuery({
    queryKey: ['reconciliation-history', filters],
    queryFn: () => listReconciliationHistory(filters),
    staleTime: 15_000,
  })

  const rows = useMemo(() => data?.rows ?? [], [data?.rows])
  const totalCount = data?.totalCount ?? 0
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize))

  function updateSort(field: SortField) {
    setSort((prev) => ({
      field,
      dir: prev.field === field && prev.dir === 'desc' ? 'asc' : 'desc',
    }))
    setPage(1)
  }

  function clearFilters() {
    setPaidFrom('')
    setPaidTo('')
    setSourceFilter('')
    setInvoiceTypeFilter('')
    setCustomerId('')
    setBlSearch('')
    setVesselSearch('')
    setVoyageSearch('')
    setPod('')
    setPage(1)
  }

  async function handleExport() {
    setExporting(true)
    try {
      await exportReconciliationHistoryExcel(filters)
    } catch {
      showToast('Falha ao exportar o histórico de conciliação.', 'error')
    } finally {
      setExporting(false)
    }
  }

  function renderSortCell(field: SortField, label: string) {
    const active = sort.field === field
    return (
      <th
        scope="col"
        className="cursor-pointer select-none px-4 py-3 hover:text-slate-300"
        onClick={() => updateSort(field)}
      >
        <div className="flex items-center gap-1">
          {label}
          {active ? (
            sort.dir === 'desc' ? <ArrowDown size={13} /> : <ArrowUp size={13} />
          ) : (
            <ArrowUpDown size={13} className="opacity-30" />
          )}
        </div>
      </th>
    )
  }

  return (
    <Card className="overflow-hidden p-0">
      <div className="border-b border-[#30363d] p-4">
        <FilterBar activeCount={activeCount} onClear={clearFilters} title="Filtros do histórico">
          <div className="app-filter-grid">
            <Field label="Período de">
              <Input type="date" value={paidFrom} onChange={(e) => { setPaidFrom(e.target.value); setPage(1) }} />
            </Field>
            <Field label="Período até">
              <Input type="date" value={paidTo} onChange={(e) => { setPaidTo(e.target.value); setPage(1) }} />
            </Field>
            <Field label="Tipo">
              <Select value={sourceFilter} onChange={(e) => { setSourceFilter(e.target.value as '' | 'local' | 'demurrage'); setPage(1) }}>
                <option value="">Todos</option>
                <option value="local">Taxas Locais</option>
                <option value="demurrage">Demurrage</option>
              </Select>
            </Field>
            <Field label="Tipo Doc.">
              <Select value={invoiceTypeFilter} onChange={(e) => { setInvoiceTypeFilter(e.target.value as '' | 'consolidated' | 'single' | 'manual'); setPage(1) }}>
                <option value="">Todos</option>
                <option value="consolidated">Consolidada</option>
                <option value="single">Único BL</option>
                <option value="manual">Avulsa</option>
              </Select>
            </Field>
            <Combobox
              key={`cust-${page}`}
              label="Consignatário"
              placeholder="Nome ou CNPJ"
              initialValue=""
              onValueChange={(value) => { if (!value.trim()) { setCustomerId(''); setPage(1) } }}
              fetchOptions={async (q) =>
                (await listBillingCustomers(q)).map((c): ComboOption => ({ value: String(c.id), label: c.name, meta: c.cnpj_cpf }))
              }
              onSelectOption={(option) => { setCustomerId(option.value); setPage(1) }}
            />
            <Field label="B/L">
              <Input
                type="text"
                placeholder="Número do BL"
                value={blSearch}
                onChange={(e) => { setBlSearch(e.target.value); setPage(1) }}
              />
            </Field>
            <Field label="Navio">
              <Input
                type="text"
                placeholder="Nome do navio"
                value={vesselSearch}
                onChange={(e) => { setVesselSearch(e.target.value); setPage(1) }}
              />
            </Field>
            <Field label="Viagem">
              <Input
                type="text"
                placeholder="Nº da viagem"
                value={voyageSearch}
                onChange={(e) => { setVoyageSearch(e.target.value); setPage(1) }}
              />
            </Field>
            <Field label="POD">
              <Input
                type="text"
                placeholder="Porto de destino"
                value={pod}
                onChange={(e) => { setPod(e.target.value); setPage(1) }}
              />
            </Field>
            <Field label="Itens por página">
              <Select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1) }}>
                {PAGE_SIZES.map((s) => <option key={s} value={s}>{s}/pág.</option>)}
              </Select>
            </Field>
          </div>
        </FilterBar>
      </div>

      <div className="flex flex-col gap-1 border-b border-[#30363d] px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
        <span className="font-semibold text-white">{totalCount} registro(s) encontrado(s)</span>
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-400">
            Página {page} de {totalPages}
          </span>
          <Button variant="secondary" className="text-xs" onClick={handleExport} loading={exporting}>
            Exportar Excel
          </Button>
        </div>
      </div>

      {error ? <InlineError message="Erro ao carregar histórico de conciliação." /> : null}

      <div className="app-table-scroll app-table-scroll--sticky">
        <table className="app-table app-table--compact min-w-[1200px] text-left text-sm">
          <thead className="bg-[#0d1117] text-xs uppercase tracking-wider text-slate-500">
            <tr>
              {renderSortCell('blId', 'B/L')}
              {renderSortCell('docNumber', 'Nº Documento')}
              <th scope="col" className="px-4 py-3">Tipo</th>
              {renderSortCell('customerName', 'Consignatário')}
              {renderSortCell('blAmount', 'Valor BL')}
              {renderSortCell('totalAmount', 'Valor Total')}
              <th scope="col" className="px-4 py-3">Navio</th>
              <th scope="col" className="px-4 py-3">Viagem</th>
              <th scope="col" className="px-4 py-3">POD</th>
              {renderSortCell('paidAt', 'Pagamento')}
              <th scope="col" className="w-12 px-2 py-3 text-center">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#30363d]">
            {isLoading ? (
              <tr><td colSpan={11} className="p-0"><SkeletonTable rows={6} cols={11} /></td></tr>
            ) : null}
            {!isLoading && rows.length === 0 ? (
              <tr><td colSpan={11} className="p-0"><EmptyState title="Nenhum pagamento encontrado." description={activeCount > 0 ? 'Tente limpar os filtros.' : 'Nenhuma conciliação registrada ainda.'} /></td></tr>
            ) : null}
            {rows.map((row) => {
              return (
                <tr key={row.id}>
                  <td className="px-4 py-3 font-semibold text-[#58a6ff]">{row.blId === '-' ? 'Sem B/L' : row.blId}</td>
                  <td className="px-4 py-3">
                    <div className="app-table__cell-stack">
                      <div className="font-semibold text-white">{row.docNumber}</div>
                      {row.source !== 'demurrage' && (
                        <Badge tone={row.invoiceType === 'consolidated' ? 'blue' : 'green'} className="text-[10px] px-1.5 py-0.5">
                          {invoiceTypeLabel(row.invoiceType)}
                        </Badge>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {row.source === 'demurrage' ? (
                      <Badge tone="blue">Demurrage</Badge>
                    ) : (
                      <Badge tone="green">Taxas Locais</Badge>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="app-table__cell-stack">
                      <div className="app-table__truncate app-table__truncate--xl" title={row.customerName}>
                        {row.customerName || '—'}
                      </div>
                      <div className="app-table__cell-meta">{row.customerCnpj || ''}</div>
                    </div>
                  </td>
                  <td className="px-4 py-3 font-medium text-[var(--app-link)]">{formatBRL(row.blAmount)}</td>
                  <td className="px-4 py-3 text-green-400">{formatBRL(row.totalAmount)}</td>
                  <td className="px-4 py-3 text-slate-300">{row.vesselName || '—'}</td>
                  <td className="px-4 py-3 text-slate-300">{row.voyageNumber || '—'}</td>
                  <td className="px-4 py-3 text-slate-300">{row.pod || '—'}</td>
                  <td className="px-4 py-3">{row.paidAt ? formatDate(row.paidAt) : <span className="text-slate-500">—</span>}</td>
                  <td className="w-12 px-2 py-3 text-center">
                    <button
                      className="app-btn app-btn--secondary p-1 leading-none"
                      title="Detalhes"
                      onClick={() => {
                        if (row.source === 'local') onSelectLocalInvoice?.(row.invoiceId, row.paymentId)
                        else onSelectDemurrageInvoice?.(row.invoiceId)
                      }}
                    >
                      <Eye size={15} />
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <TableFooterPagination
        page={page}
        pageSize={pageSize}
        totalCount={totalCount}
        totalPages={totalPages}
        onPageChange={setPage}
      />
    </Card>
  )
}
