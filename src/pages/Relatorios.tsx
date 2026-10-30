import { useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { FileDown } from 'lucide-react'
import { Block } from '../components/ui/Block'
import { Button } from '../components/ui/Button'
import { MetricCard } from '../components/ui/MetricCard'
import { TabButton } from '../components/ui/TabButton'
import { TabList } from '../components/ui/TabList'
import { EmptyState, PageHeader } from '../components/ui/Card'
import { CopyValue } from '../components/ui/CopyValue'
import { NoValue } from '../components/ui/NoValue'
import { StatusText, type StatusTextTone } from '../components/ui/StatusText'
import { Combobox, type ComboOption } from '../components/ui/Combobox'
import { FilterBar } from '../components/ui/FilterBar'
import { Field, Input, Select } from '../components/ui/Input'
import { SkeletonTable } from '../components/ui/Skeleton'
import { TableFooterPagination } from '../components/ui/TableFooterPagination'
import { QueryStateGate } from '../components/shared/QueryStateGate'
import { VoyageCombobox } from '../components/shared/VoyageCombobox'
import { LocalChargesStatus } from '../components/bl/LocalChargesStatus'
import { InvoiceStatusBadge } from '../components/demurrage/DemurrageBadges'
import { useToast } from '../components/ui/Toast'
import { useVoyageOptions, usePortOptions } from '../hooks/useBls'
import { formatBRL, formatCnpjCpf, formatDate, formatUSD } from '../lib/utils'
import { describeActiveFilters, formatResultCount, type OperationalFilter } from '../lib/operationalState'
import { userFacingErrorMessage } from '../lib/errors'
import { formatPortDisplayName } from '../lib/voyageFormat'
import { DEMURRAGE_INVOICE_STATUS_LABELS, INVOICE_STATUS_LABELS, statusLabel } from '../lib/statusLabels'
import { blTotalCbm, blTotalWeightKg, cargoModeLabel } from '../lib/cargoMode'
import { REPORT_LOCAL_CHARGES_STATE_LABELS } from '../lib/chargeStatus'
import { listBillingCustomers } from '../services/billing'
import type { ReportFilterLine } from '../services/exports'
import {
  fetchCustomerReport,
  fetchDemurrageExposure,
  fetchDemurrageItemsReport,
  fetchDemurrageReport,
  fetchFinancialReport,
  fetchOperationalReport,
  isReportComplete,
  reportReviewLabel,
  type DemurrageReportSlice,
  type ReportLoad,
  type ReportScope,
} from '../services/reports'
import { DEMURRAGE_DIVISIONS, DEMURRAGE_DIVISION_LABELS } from '../services/demurrage/demurrageDivisions'
import { SegmentedControl } from '../components/ui/SegmentedControl'
import {
  REPORT_VIEWS,
  customerFiltersFromSearch,
  customerNameFromSearch,
  demurrageFiltersFromSearch,
  financialFiltersFromSearch,
  hasDateParam,
  operationalFiltersFromSearch,
  reportViewFromSearch,
  withReportParam,
  withReportView,
  type ReportParam,
  type ReportView,
} from './relatoriosListState'
import { demurrageInvoiceHref } from './demurrageListState'

// A planilha lê o recorte inteiro, sem o teto da tela (achado R2).
const EXPORT_ALL = { ceiling: Number.POSITIVE_INFINITY }

// ponytail: o relatório chega inteiro até o teto da tela (cartões e planilha
// usam tudo) e a tabela mostra uma página por vez, recortada no navegador.
// Com as 1.000 linhas na tela eram ~37 mil nós e meio segundo de thread travada.
function useReportPage<T>(rows: readonly T[] | undefined) {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [pageRows, setPageRows] = useState(rows)
  if (pageRows !== rows) {
    setPageRows(rows)
    setPage(1)
  }
  const totalCount = rows?.length ?? 0
  return {
    rows: (rows ?? []).slice((page - 1) * pageSize, page * pageSize),
    pagination: {
      page,
      pageSize,
      totalCount,
      totalPages: Math.max(1, Math.ceil(totalCount / pageSize)),
      onPageChange: setPage,
      onPageSizeChange: (size: number) => {
        setPageSize(size)
        setPage(1)
      },
    },
  }
}

type ViewProps = {
  params: URLSearchParams
  setParam: (key: ReportParam, value: string, keepEmpty?: boolean) => void
  setParams: (next: URLSearchParams) => void
}

export function Relatorios() {
  const [searchParams, setSearchParams] = useSearchParams()
  const view = reportViewFromSearch(searchParams)
  const setParams = (next: URLSearchParams) => setSearchParams(next, { replace: true })
  const props: ViewProps = {
    params: searchParams,
    setParams,
    setParam: (key, value, keepEmpty) => setParams(withReportParam(searchParams, key, value, keepEmpty)),
  }

  return (
    <>
      <PageHeader title="Relatórios" />

      <TabList label="Visões do relatório" className="mb-4">
        {REPORT_VIEWS.map((option) => (
          <TabButton
            key={option.value}
            id={`report-tab-${option.value}`}
            controls="report-panel"
            active={view === option.value}
            label={option.label}
            onClick={() => setSearchParams(withReportView(searchParams, option.value as ReportView))}
          />
        ))}
      </TabList>

      <div id="report-panel" role="tabpanel" aria-labelledby={`report-tab-${view}`}>
        {view === 'operacional' ? <OperationalReportView {...props} /> : null}
        {view === 'financeiro' ? <FinancialReportView {...props} /> : null}
        {view === 'por-cliente' ? <CustomerReportView {...props} /> : null}
        {view === 'demurrage' ? <DemurrageReportView {...props} /> : null}
      </div>
    </>
  )
}

// ---------- Peças compartilhadas pelas quatro visões ----------

function voyageLabel(voyages: ReturnType<typeof useVoyageOptions>['data'], voyageId: string) {
  if (!voyageId) return ''
  const voyage = voyages?.find((option) => String(option.id) === voyageId)
  return voyage ? `${voyage.vessel?.name ?? 'Navio'} / ${voyage.voyage_number}` : `Viagem ${voyageId}`
}

/** Período, Navio / Viagem e Cliente em linhas de filtro (planilha e "Filtros ativos"). */
function scopeFilterLines(scope: ReportScope, periodLabel: string, voyage: string, customerName: string): ReportFilterLine[] {
  return [
    { Filtro: `${periodLabel} de`, Valor: scope.dateFrom ? formatDate(scope.dateFrom) : '' },
    { Filtro: `${periodLabel} até`, Valor: scope.dateTo ? formatDate(scope.dateTo) : '' },
    { Filtro: 'Navio / Viagem', Valor: voyage },
    { Filtro: 'Cliente', Valor: scope.customerId ? customerName || `Cliente ${scope.customerId}` : '' },
  ]
}

function activeLines(lines: ReportFilterLine[]) {
  return lines.filter((line) => line.Valor.trim() !== '')
}

function toOperationalFilters(lines: ReportFilterLine[]): OperationalFilter[] {
  return lines.map((line) => ({ label: line.Filtro, value: line.Valor }))
}

/** Período, Navio / Viagem e Cliente: sempre abertos; "Exportar planilha" ao lado. */
function ScopeFilters({ scope, customerName, periodLabel, onDate, onVoyage, onCustomer, exporting, canExport, onExport }: {
  scope: ReportScope
  customerName: string
  periodLabel: string
  onDate: (key: 'de' | 'ate', value: string) => void
  onVoyage: (voyageId: string) => void
  onCustomer: (customerId: string, customerName: string) => void
  exporting: boolean
  canExport: boolean
  onExport: () => void
}) {
  return (
    <div className="app-filter-grid">
      <Field label={`${periodLabel} de`}>
        <Input type="date" value={scope.dateFrom} onChange={(event) => onDate('de', event.target.value)} />
      </Field>
      <Field label="até">
        <Input type="date" value={scope.dateTo} onChange={(event) => onDate('ate', event.target.value)} />
      </Field>
      <VoyageCombobox
        clearable
        label="Navio / Viagem"
        placeholder="Todos"
        selectedVoyageId={scope.voyageId}
        onSelect={(id) => onVoyage(id == null ? '' : String(id))}
      />
      <Combobox
        key={`cliente-${scope.customerId}-${customerName}`}
        label="Cliente"
        placeholder="Todos"
        initialValue={customerName}
        onValueChange={(value) => { if (!value.trim() && scope.customerId) onCustomer('', '') }}
        fetchOptions={async (query) =>
          (await listBillingCustomers(query)).map((customer): ComboOption => ({
            value: String(customer.id),
            label: customer.name,
            meta: formatCnpjCpf(customer.cnpj_cpf),
          }))
        }
        onSelectOption={(option) => onCustomer(option.value, option.label)}
      />
      <div>
        <Button variant="secondary" onClick={onExport} loading={exporting} loadingLabel="Exportando…" disabled={!canExport}>
          <FileDown size={16} aria-hidden="true" />
          Exportar planilha
        </Button>
      </div>
    </div>
  )
}

function useScopeHandlers({ params, setParams }: ViewProps, keepEmptyDates = false) {
  return {
    onDate: (key: 'de' | 'ate', value: string) => {
      let next = withReportParam(params, key, value, keepEmptyDates)
      // Demurrage: a primeira data escolhida grava as duas, senão a outra
      // voltaria ao padrão do ano em vez do valor que estava na tela.
      if (keepEmptyDates) {
        const current = demurrageFiltersFromSearch(params)
        const other = key === 'de' ? 'ate' : 'de'
        if (!hasDateParam(params, other)) next = withReportParam(next, other, other === 'de' ? current.dateFrom : current.dateTo, true)
      }
      setParams(next)
    },
    onVoyage: (voyageId: string) => setParams(withReportParam(params, 'viagem', voyageId)),
    onCustomer: (customerId: string, customerName: string) => {
      const next = withReportParam(params, 'cliente', customerId)
      setParams(customerId ? withReportParam(next, 'clienteNome', customerName) : next)
    },
  }
}

function ActiveFiltersNote({ lines }: { lines: ReportFilterLine[] }) {
  return <p className="mb-4 text-xs text-[var(--app-muted)]">{describeActiveFilters(toOperationalFilters(lines))}</p>
}

type LoadSource = { load: ReportLoad | undefined; noun: string }

/**
 * Aviso de limite (achado R2): uma fonte parou no teto declarado. Diz, por
 * fonte (B/Ls, faturas, Invoices), quantas foram lidas e quantas faltam, e
 * que a planilha traz todas. "Lidas", não "mostradas": um filtro aplicado no
 * navegador (Saldo em aberto) mostra menos linhas do que as lidas.
 */
function LoadNotice({ sources, note }: { sources: LoadSource[]; note?: string }) {
  const partial = sources.flatMap(({ load, noun }) => (load && !isReportComplete(load) ? [{ load, noun }] : []))
  if (partial.length === 0) return null
  const n = (value: number) => value.toLocaleString('pt-BR')
  return (
    <p className="app-bl-notice app-bl-notice--warning mb-4" role="status">
      {partial.map(({ load, noun }) => `A tela leu ${n(load.loaded)} de ${n(load.total)} ${noun}; faltam ${n(load.total - load.loaded)}.`).join(' ')}
      {' '}Cartões e tabela usam só o que foi lido{note ? `; ${note}` : ''}. A planilha traz todas.
    </p>
  )
}

function useExport() {
  const { showToast } = useToast()
  const [exporting, setExporting] = useState(false)
  async function run(task: () => Promise<number>) {
    setExporting(true)
    try {
      const count = await task()
      showToast(`Planilha exportada (${count.toLocaleString('pt-BR')} linhas).`, 'success')
    } catch (error) {
      showToast(userFacingErrorMessage(error, 'Não foi possível exportar a planilha.'), 'error')
    } finally {
      setExporting(false)
    }
  }
  return { exporting, run }
}

const decimal = (value: number, digits: number) =>
  value.toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits })

function WithUnit({ value, unit }: { value: string; unit: string }) {
  return <>{value} <span className="app-metric-tile__unit">{unit}</span></>
}

/** Valor em aberto: âmbar só quando passa de zero (regra 5). */
function OpenAmount({ value }: { value: number }) {
  return value > 0 ? <StatusText tone="warning">{formatBRL(value)}</StatusText> : <>{formatBRL(value)}</>
}

function ReportTable({ title, aside, columns, minWidth, caption, isLoading, error, errorMessage, onRetry, hasData, isEmpty, emptyTitle, children, pagination }: {
  title: string
  aside: string
  columns: string[]
  minWidth: string
  caption: string
  isLoading: boolean
  error: unknown
  errorMessage: string
  onRetry: () => void
  hasData: boolean
  isEmpty: boolean
  emptyTitle: string
  children: ReactNode
  pagination: ReturnType<typeof useReportPage>['pagination']
}) {
  return (
    <Block title={title} aside={hasData ? aside : undefined} flush>
      {/* Item 8: com erro, a tela mostra só o erro; nunca "Nenhum dado" junto. */}
      <QueryStateGate
        isLoading={isLoading}
        isError={Boolean(error)}
        hasData={hasData}
        errorMessage={userFacingErrorMessage(error, errorMessage)}
        onRetry={onRetry}
        loadingFallback={<SkeletonTable rows={6} cols={columns.length} />}
      >
        {isEmpty ? (
          <EmptyState title={emptyTitle} description="Ajuste o período ou os filtros aplicados." />
        ) : (
          <>
            <div className="app-table-scroll">
              <table className={`app-table app-table--compact text-sm ${minWidth}`}>
                <caption className="sr-only">{caption}</caption>
                <thead>
                  <tr>
                    {columns.map((column) => (
                      <th key={column} scope="col" className={column === 'Cliente' ? 'app-table__text-head' : undefined}>{column}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>{children}</tbody>
              </table>
            </div>
            <TableFooterPagination {...pagination} />
          </>
        )}
      </QueryStateGate>
    </Block>
  )
}

// ---------- Operacional ----------

/** Mesmo rótulo da planilha e do filtro Revisão (`reportReviewLabel`): vazio é "Em ordem". */
function reviewText(status: string | null) {
  const label = reportReviewLabel(status)
  return status === 'pending_review' ? <StatusText tone="warning">{label}</StatusText> : <StatusText>{label}</StatusText>
}

const REVIEW_FILTER_LABELS: Record<string, string> = { pendente: 'Pendente', 'em-ordem': 'Em ordem' }
const LOCAL_CHARGES_FILTER_OPTIONS = [
  { value: 'pendente', label: REPORT_LOCAL_CHARGES_STATE_LABELS.pending },
  { value: 'emitida', label: REPORT_LOCAL_CHARGES_STATE_LABELS.issued },
  { value: 'parcial', label: REPORT_LOCAL_CHARGES_STATE_LABELS.partially_paid },
  { value: 'paga', label: REPORT_LOCAL_CHARGES_STATE_LABELS.paid },
  { value: 'isenta', label: REPORT_LOCAL_CHARGES_STATE_LABELS.exempt },
]

function OperationalReportView(props: ViewProps) {
  const { params, setParam, setParams } = props
  const filters = operationalFiltersFromSearch(params)
  const customerName = customerNameFromSearch(params)
  const handlers = useScopeHandlers(props)
  const { data: voyages } = useVoyageOptions()
  const { data: portOptions } = usePortOptions()
  const exporter = useExport()

  const query = useQuery({
    queryKey: ['report-operational', filters],
    queryFn: () => fetchOperationalReport(filters),
    staleTime: 30_000,
  })
  const { data } = query
  const page = useReportPage(data?.rows)

  const moreLines: ReportFilterLine[] = [
    { Filtro: 'POL', Valor: filters.pol ? formatPortDisplayName(filters.pol) : '' },
    { Filtro: 'POD', Valor: filters.pod ? formatPortDisplayName(filters.pod) : '' },
    { Filtro: 'Modalidade', Valor: filters.cargoMode ? cargoModeLabel(filters.cargoMode) : '' },
    { Filtro: 'Revisão', Valor: REVIEW_FILTER_LABELS[filters.review] ?? '' },
    { Filtro: 'Taxas locais', Valor: LOCAL_CHARGES_FILTER_OPTIONS.find((option) => option.value === filters.localCharges)?.label ?? '' },
  ]
  const lines = activeLines([...scopeFilterLines(filters, 'Criação do B/L', voyageLabel(voyages, filters.voyageId), customerName), ...moreLines])
  const moreCount = activeLines(moreLines).length

  function clearMore() {
    let next = params
    for (const key of ['pol', 'pod', 'modalidade', 'revisao', 'taxas'] as const) next = withReportParam(next, key, '')
    setParams(next)
  }

  const exportReport = () => exporter.run(async () => {
    const { rows } = await fetchOperationalReport(filters, EXPORT_ALL)
    const { exportOperationalReportWorkbook } = await import('../services/exports')
    await exportOperationalReportWorkbook(rows, lines)
    return rows.length
  })

  return (
    <>
      <ScopeFilters
        scope={filters}
        customerName={customerName}
        periodLabel="Criação do B/L"
        {...handlers}
        exporting={exporter.exporting}
        canExport={Boolean(data?.rows.length)}
        onExport={() => void exportReport()}
      />
      <FilterBar title="Mais filtros" activeCount={moreCount} onClear={clearMore}>
        <div className="app-filter-grid">
          <Field label="POL">
            <Select value={filters.pol} onChange={(event) => setParam('pol', event.target.value)}>
              <option value="">Todos</option>
              {portOptions?.pols.map((pol) => <option key={pol} value={pol}>{formatPortDisplayName(pol)}</option>)}
            </Select>
          </Field>
          <Field label="POD">
            <Select value={filters.pod} onChange={(event) => setParam('pod', event.target.value)}>
              <option value="">Todos</option>
              {portOptions?.pods.map((pod) => <option key={pod} value={pod}>{formatPortDisplayName(pod)}</option>)}
            </Select>
          </Field>
          <Field label="Modalidade">
            <Select value={filters.cargoMode} onChange={(event) => setParam('modalidade', event.target.value)}>
              <option value="">Todas</option>
              <option value="container">Container</option>
              <option value="carga_solta">Carga Solta</option>
              <option value="misto">Misto</option>
            </Select>
          </Field>
          <Field label="Revisão">
            <Select value={filters.review} onChange={(event) => setParam('revisao', event.target.value)}>
              <option value="">Todas</option>
              <option value="pendente">Pendente</option>
              <option value="em-ordem">Em ordem</option>
            </Select>
          </Field>
          <Field label="Taxas locais">
            <Select value={filters.localCharges} onChange={(event) => setParam('taxas', event.target.value)}>
              <option value="">Todas</option>
              {LOCAL_CHARGES_FILTER_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </Select>
          </Field>
        </div>
      </FilterBar>
      <ActiveFiltersNote lines={lines} />

      <div className="app-metric-row" role="group" aria-label="Totais do recorte">
        <MetricCard label="B/Ls" value={(data?.kpis.totalBls ?? 0).toLocaleString('pt-BR')} />
        <MetricCard label="Containers" value={(data?.kpis.totalContainers ?? 0).toLocaleString('pt-BR')} />
        <MetricCard label="Viagens" value={(data?.kpis.totalVoyages ?? 0).toLocaleString('pt-BR')} />
        <MetricCard label="Peso" value={<WithUnit value={decimal((data?.kpis.totalWeightKg ?? 0) / 1000, 1)} unit="t" />} />
        <MetricCard label="CBM" value={decimal(data?.kpis.totalCbm ?? 0, 1)} />
      </div>

      <LoadNotice sources={[{ load: data?.load, noun: 'B/Ls' }]} />

      <ReportTable
        title="B/Ls"
        aside={`${formatResultCount(data?.rows.length ?? 0, 'B/L', 'B/Ls')} · criação mais recente primeiro`}
        columns={['B/L', 'Navio / Viagem', 'Trecho', 'Cliente', 'Containers', 'Peso', 'CBM', 'Revisão', 'Taxas locais']}
        minWidth="min-w-[1100px]"
        caption="B/Ls do relatório operacional"
        isLoading={query.isLoading}
        error={query.error}
        errorMessage="Não foi possível carregar o relatório operacional."
        onRetry={() => void query.refetch()}
        hasData={data !== undefined}
        isEmpty={!data?.rows.length}
        emptyTitle="Nenhum B/L neste recorte."
        pagination={page.pagination}
      >
        {page.rows.map((row) => (
          <tr key={row.id}>
            <td><CopyValue value={row.id} label="número do B/L"><Link className="app-link" to={`/bls/${encodeURIComponent(row.id)}`}>{row.id}</Link></CopyValue></td>
            <td>{row.voyage?.vessel?.name ?? <NoValue label="Sem navio" />} / {row.voyage?.voyage_number ?? <NoValue label="Sem viagem" />}</td>
            <td>{row.pol ?? <NoValue label="Sem POL" />} → {row.pod ?? <NoValue label="Sem POD" />}</td>
            <td className="app-table__text" title={row.customer?.name ?? undefined}>
              {row.customer?.name ?? <StatusText tone="warning">Sem cliente vinculado</StatusText>}
            </td>
            <td>{(row.bl_containers ?? []).length}</td>
            <td>{blTotalWeightKg(row).toLocaleString('pt-BR')} kg</td>
            <td>{blTotalCbm(row).toLocaleString('pt-BR')}</td>
            <td>{reviewText(row.review_status)}</td>
            <td><LocalChargesStatus bl={row} showPaid /></td>
          </tr>
        ))}
      </ReportTable>
    </>
  )
}

// ---------- Financeiro ----------

const FINANCIAL_STATUS_FILTER_OPTIONS = ['draft', 'issued', 'partially_paid', 'paid', 'cancelled'] as const

function invoiceStatusTone(status: string | null): StatusTextTone {
  // Coberta é Paga no Faturamento: quitada pela consolidada.
  if (status === 'paid' || status === 'covered') return 'paid'
  if (status === 'cancelled' || status === 'obsolete') return 'muted'
  return 'default'
}

function FinancialReportView(props: ViewProps) {
  const { params, setParam, setParams } = props
  const filters = financialFiltersFromSearch(params)
  const customerName = customerNameFromSearch(params)
  const handlers = useScopeHandlers(props)
  const { data: voyages } = useVoyageOptions()
  const exporter = useExport()

  const query = useQuery({
    queryKey: ['report-financial', filters],
    queryFn: () => fetchFinancialReport(filters),
    staleTime: 30_000,
  })
  const { data } = query
  const page = useReportPage(data?.rows)
  const accessDenied = Boolean(data?.accessDenied)

  const moreLines: ReportFilterLine[] = [
    { Filtro: 'Situação', Valor: filters.status ? statusLabel(INVOICE_STATUS_LABELS, filters.status) : '' },
    { Filtro: 'Consolidada', Valor: filters.consolidated === 'sim' ? 'Só consolidadas' : filters.consolidated === 'nao' ? 'Sem consolidadas' : '' },
    { Filtro: 'Saldo em aberto', Valor: filters.balance === 'aberto' ? 'Com saldo' : filters.balance === 'zerado' ? 'Sem saldo' : '' },
  ]
  const lines = activeLines([...scopeFilterLines(filters, 'Emissão', voyageLabel(voyages, filters.voyageId), customerName), ...moreLines])
  const moreCount = activeLines(moreLines).length

  function clearMore() {
    let next = params
    for (const key of ['situacao', 'consolidada', 'saldo'] as const) next = withReportParam(next, key, '')
    setParams(next)
  }

  const exportReport = () => exporter.run(async () => {
    const result = await fetchFinancialReport(filters, EXPORT_ALL)
    if (result.accessDenied) throw new Error('Sem permissão para ver as faturas.')
    const { exportFinancialReportWorkbook } = await import('../services/exports')
    await exportFinancialReportWorkbook(result.rows, lines)
    return result.rows.length
  })

  return (
    <>
      <ScopeFilters
        scope={filters}
        customerName={customerName}
        periodLabel="Emissão"
        {...handlers}
        exporting={exporter.exporting}
        canExport={Boolean(data?.rows.length)}
        onExport={() => void exportReport()}
      />
      <FilterBar title="Mais filtros" activeCount={moreCount} onClear={clearMore}>
        <div className="app-filter-grid">
          <Field label="Situação">
            <Select value={filters.status} onChange={(event) => setParam('situacao', event.target.value)}>
              <option value="">Todas</option>
              {FINANCIAL_STATUS_FILTER_OPTIONS.map((status) => (
                <option key={status} value={status}>{statusLabel(INVOICE_STATUS_LABELS, status)}</option>
              ))}
            </Select>
          </Field>
          <Field label="Consolidada">
            <Select value={filters.consolidated} onChange={(event) => setParam('consolidada', event.target.value)}>
              <option value="">Todas</option>
              <option value="sim">Só consolidadas</option>
              <option value="nao">Sem consolidadas</option>
            </Select>
          </Field>
          <Field label="Saldo em aberto">
            <Select value={filters.balance} onChange={(event) => setParam('saldo', event.target.value)}>
              <option value="">Todos</option>
              <option value="aberto">Com saldo</option>
              <option value="zerado">Sem saldo</option>
            </Select>
          </Field>
        </div>
      </FilterBar>
      <ActiveFiltersNote lines={lines} />

      {accessDenied ? (
        <p className="app-bl-notice app-bl-notice--warning mb-4" role="status">
          Sem permissão para ver as faturas: nenhum cartão, linha ou planilha é mostrado.
        </p>
      ) : (
        <>
          <div className="app-metric-row" role="group" aria-label="Totais do recorte">
            <MetricCard
              label="Saldo em aberto"
              value={formatBRL(data?.kpis.totalOpen ?? 0)}
              tone={(data?.kpis.totalOpen ?? 0) > 0 ? 'warning' : 'secondary'}
            />
            <MetricCard label="Faturas" value={(data?.kpis.totalInvoices ?? 0).toLocaleString('pt-BR')} detail="Emitidas, sem rascunho nem cancelada" />
            <MetricCard label="Emitido" value={formatBRL(data?.kpis.totalIssued ?? 0)} />
            <MetricCard label="Pago" value={formatBRL(data?.kpis.totalPaid ?? 0)} />
            <MetricCard label="Canceladas" value={(data?.kpis.totalCanceled ?? 0).toLocaleString('pt-BR')} />
          </div>

          <LoadNotice
            sources={[{ load: data?.load, noun: 'faturas' }]}
            note={filters.balance ? 'o filtro de Saldo em aberto vale só sobre as faturas lidas' : undefined}
          />

          <ReportTable
            title="Faturas"
            aside={`${formatResultCount(data?.rows.length ?? 0, 'fatura', 'faturas')} · emissão mais recente primeiro`}
            columns={['Fatura', 'Cliente', 'Emissão', 'Total', 'Saldo', 'Situação']}
            minWidth="min-w-[900px]"
            caption="Faturas do relatório financeiro"
            isLoading={query.isLoading}
            error={query.error}
            errorMessage="Não foi possível carregar o relatório financeiro."
            onRetry={() => void query.refetch()}
            hasData={data !== undefined}
            isEmpty={!data?.rows.length}
            emptyTitle="Nenhuma fatura neste recorte."
            pagination={page.pagination}
          >
            {page.rows.map((row) => (
              <tr key={row.id} className={row.status === 'cancelled' || row.status === 'obsolete' ? 'app-table__row--muted' : undefined}>
                <td><Link className="app-link" to={`/taxas-locais?invoice=${row.id}`}>{row.invoice_number}</Link></td>
                <td className="app-table__text" title={row.customer?.name ?? undefined}>{row.customer?.name ?? <NoValue label="Sem Cliente" />}</td>
                <td>{row.issued_at ? formatDate(row.issued_at) : <NoValue label="Sem data de emissão" />}</td>
                <td>{formatBRL(row.total_brl ?? 0)}</td>
                <td><OpenAmount value={Number(row.balance_brl ?? 0)} /></td>
                <td><StatusText tone={invoiceStatusTone(row.status)}>{statusLabel(INVOICE_STATUS_LABELS, row.status)}</StatusText></td>
              </tr>
            ))}
          </ReportTable>
        </>
      )}
    </>
  )
}

// ---------- Por Cliente ----------

function CustomerReportView(props: ViewProps) {
  const { params } = props
  const filters = customerFiltersFromSearch(params)
  const customerName = customerNameFromSearch(params)
  const handlers = useScopeHandlers(props)
  const { data: voyages } = useVoyageOptions()
  const exporter = useExport()

  const query = useQuery({
    queryKey: ['report-customers', filters],
    queryFn: () => fetchCustomerReport(filters),
    staleTime: 30_000,
  })
  const { data } = query
  const page = useReportPage(data?.rows)
  const lines = activeLines(scopeFilterLines(filters, 'Período', voyageLabel(voyages, filters.voyageId), customerName))

  const exportReport = () => exporter.run(async () => {
    const result = await fetchCustomerReport(filters, EXPORT_ALL)
    const { exportCustomerReportWorkbook } = await import('../services/exports')
    await exportCustomerReportWorkbook(result.rows, lines)
    return result.rows.length
  })

  return (
    <>
      <ScopeFilters
        scope={filters}
        customerName={customerName}
        periodLabel="Período"
        {...handlers}
        exporting={exporter.exporting}
        canExport={Boolean(data?.rows.length)}
        onExport={() => void exportReport()}
      />
      <p className="mb-1 text-xs text-[var(--app-muted)]">B/Ls pela data de criação; faturas pela emissão, sem rascunho nem cancelada.</p>
      <ActiveFiltersNote lines={lines} />

      {data?.invoicesAccessDenied ? (
        <p className="app-bl-notice app-bl-notice--warning mb-4" role="status">
          Sem permissão para ver as faturas: as colunas Faturas, Emitido e Em aberto ficam zeradas, inclusive na planilha.
        </p>
      ) : null}

      <div className="app-metric-row" role="group" aria-label="Totais do recorte">
        <MetricCard label="Emitido" value={formatBRL(data?.kpis.totalIssued ?? 0)} />
        <MetricCard label="Clientes com fatura no período" value={(data?.kpis.customersWithInvoices ?? 0).toLocaleString('pt-BR')} />
        <MetricCard label="Top por volume (B/Ls)" value={data?.kpis.topByBls ?? <NoValue label="Sem B/L no período" />} />
        <MetricCard label="Top por faturamento" value={data?.kpis.topByInvoiced ?? <NoValue label="Sem fatura no período" />} />
      </div>

      <LoadNotice sources={[{ load: data?.load.bls, noun: 'B/Ls' }, { load: data?.load.invoices, noun: 'faturas' }]} />

      <ReportTable
        title="Clientes"
        aside={`${formatResultCount(data?.rows.length ?? 0, 'Cliente', 'Clientes')} · maior emitido primeiro`}
        columns={['Cliente', 'CNPJ', 'B/Ls', 'Peso', 'CBM', 'Faturas', 'Emitido', 'Em aberto']}
        minWidth="min-w-[1000px]"
        caption="Clientes por faturamento"
        isLoading={query.isLoading}
        error={query.error}
        errorMessage="Não foi possível carregar o relatório por Cliente."
        onRetry={() => void query.refetch()}
        hasData={data !== undefined}
        isEmpty={!data?.rows.length}
        emptyTitle="Nenhum Cliente neste recorte."
        pagination={page.pagination}
      >
        {page.rows.map((row) => (
          <tr key={row.customer_id}>
            <td className="app-table__text" title={row.name}>
              {row.cnpj_cpf ? <Link className="app-link" to={`/clientes/${encodeURIComponent(row.cnpj_cpf)}`}>{row.name}</Link> : row.name}
            </td>
            <td>{row.cnpj_cpf ? <CopyValue value={formatCnpjCpf(row.cnpj_cpf)} label="CNPJ/CPF" /> : <NoValue label="Sem CNPJ/CPF" />}</td>
            <td>{row.blCount}</td>
            <td>{row.totalWeightKg.toLocaleString('pt-BR')} kg</td>
            <td>{row.totalCbm.toLocaleString('pt-BR')}</td>
            <td>{row.invoiceCount}</td>
            <td>{formatBRL(row.totalIssued)}</td>
            <td><OpenAmount value={row.totalBalance} /></td>
          </tr>
        ))}
      </ReportTable>
    </>
  )
}

// ---------- Demurrage ----------

// Três recortes (ADR 0112, D13); a planilha traz os três, um por aba (D14).
const DEMURRAGE_SLICES: Array<{ value: DemurrageReportSlice; label: string }> = [
  { value: 'exposicao', label: 'Exposição' },
  { value: 'invoices', label: 'Invoices' },
  { value: 'itens', label: 'Itens por container' },
]
const DEMURRAGE_STATUS_FILTER_OPTIONS = ['issued', 'paid', 'cancelled'] as const

function DemurrageReportView(props: ViewProps) {
  const { params, setParam, setParams } = props
  const filters = demurrageFiltersFromSearch(params)
  const customerName = customerNameFromSearch(params)
  const handlers = useScopeHandlers(props, true)
  const { data: voyages } = useVoyageOptions()
  const exporter = useExport()

  const exposureQuery = useQuery({
    queryKey: ['demurrage-report', 'exposicao', filters.customerId, filters.voyageId, filters.division],
    queryFn: () => fetchDemurrageExposure(filters),
    staleTime: 60_000,
    enabled: filters.slice === 'exposicao',
  })
  const invoicesQuery = useQuery({
    queryKey: ['demurrage-report', 'invoices', filters],
    queryFn: () => fetchDemurrageReport(filters),
    staleTime: 60_000,
    enabled: filters.slice === 'invoices',
  })
  const itemsQuery = useQuery({
    queryKey: ['demurrage-report', 'itens', filters.dateFrom, filters.dateTo, filters.customerId, filters.voyageId],
    queryFn: () => fetchDemurrageItemsReport(filters),
    staleTime: 60_000,
    enabled: filters.slice === 'itens',
  })
  const exposurePage = useReportPage(exposureQuery.data?.rows)
  const invoicesPage = useReportPage(invoicesQuery.data?.rows)
  const itemsPage = useReportPage(itemsQuery.data?.rows)

  const sliceLine: ReportFilterLine = { Filtro: 'Recorte', Valor: DEMURRAGE_SLICES.find((item) => item.value === filters.slice)?.label ?? '' }
  const moreLines: ReportFilterLine[] = [
    { Filtro: 'Situação', Valor: filters.status ? statusLabel(DEMURRAGE_INVOICE_STATUS_LABELS, filters.status) : '' },
    { Filtro: 'Em disputa', Valor: filters.dispute === 'sim' ? 'Sim' : filters.dispute === 'nao' ? 'Não' : '' },
    { Filtro: 'Divisão', Valor: filters.division ? DEMURRAGE_DIVISION_LABELS[filters.division] : '' },
  ]
  const lines = activeLines([sliceLine, ...scopeFilterLines(filters, 'Emissão', voyageLabel(voyages, filters.voyageId), customerName), ...moreLines])
  const moreCount = activeLines(moreLines).length

  function clearMore() {
    let next = params
    for (const key of ['situacao', 'disputa', 'divisao'] as const) next = withReportParam(next, key, '')
    setParams(next)
  }

  const exportReport = () => exporter.run(async () => {
    const [exposure, invoices, items] = await Promise.all([
      fetchDemurrageExposure(filters),
      fetchDemurrageReport(filters, EXPORT_ALL),
      fetchDemurrageItemsReport(filters, EXPORT_ALL),
    ])
    const { exportDemurrageReportWorkbook } = await import('../services/exports')
    await exportDemurrageReportWorkbook({ exposure: exposure.rows, invoices: invoices.rows, items: items.rows }, lines)
    return exposure.rows.length + invoices.rows.length + items.rows.length
  })
  const current = filters.slice === 'exposicao' ? exposureQuery.data?.rows : filters.slice === 'itens' ? itemsQuery.data?.rows : invoicesQuery.data?.rows

  return (
    <>
      <SegmentedControl
        label="Recorte de Demurrage"
        className="mb-4"
        value={filters.slice}
        onChange={(value) => setParam('recorte', value === 'invoices' ? '' : value)}
        options={DEMURRAGE_SLICES}
      />
      <ScopeFilters
        scope={filters}
        customerName={customerName}
        periodLabel="Emissão"
        {...handlers}
        exporting={exporter.exporting}
        canExport={Boolean(current?.length)}
        onExport={() => void exportReport()}
      />
      <FilterBar title="Mais filtros" activeCount={moreCount} onClear={clearMore}>
        <div className="app-filter-grid">
          <Field label="Situação (Invoices)">
            <Select value={filters.status} onChange={(event) => setParam('situacao', event.target.value)}>
              <option value="">Todas</option>
              {DEMURRAGE_STATUS_FILTER_OPTIONS.map((status) => (
                <option key={status} value={status}>{statusLabel(DEMURRAGE_INVOICE_STATUS_LABELS, status)}</option>
              ))}
            </Select>
          </Field>
          <Field label="Em disputa (Invoices)">
            <Select value={filters.dispute} onChange={(event) => setParam('disputa', event.target.value)}>
              <option value="">Todas</option>
              <option value="sim">Sim</option>
              <option value="nao">Não</option>
            </Select>
          </Field>
          <Field label="Divisão (Exposição)">
            <Select value={filters.division} onChange={(event) => setParam('divisao', event.target.value)}>
              <option value="">Todas</option>
              {DEMURRAGE_DIVISIONS.map((division) => <option key={division} value={division}>{DEMURRAGE_DIVISION_LABELS[division]}</option>)}
            </Select>
          </Field>
        </div>
      </FilterBar>
      <ActiveFiltersNote lines={lines} />

      {filters.slice === 'exposicao' ? (
        <>
          <p className="mb-1 text-xs text-[var(--app-muted)]">A Exposição é o que corre hoje, sem Invoice: o período não se aplica. A planilha traz também Invoices e Itens por container.</p>
          <div className="app-metric-row" role="group" aria-label="Totais da Exposição por divisão">
            {DEMURRAGE_DIVISIONS.map((division) => (
              <MetricCard
                key={division}
                label={`${DEMURRAGE_DIVISION_LABELS[division]} (US$)`}
                value={formatUSD(exposureQuery.data?.byDivision[division].usd ?? 0)}
                detail={`${(exposureQuery.data?.byDivision[division].boxes ?? 0).toLocaleString('pt-BR')} containers`}
              />
            ))}
          </div>
          <ReportTable
            title="Exposição"
            aside={`${formatResultCount(exposureQuery.data?.rows.length ?? 0, 'container', 'containers')} · por divisão, maior US$ primeiro`}
            columns={['Divisão', 'Cliente', 'Navio / Viagem', 'B/L', 'Container', 'Descarga', 'Devolução', 'Dias', 'Free time', 'US$ previsto']}
            minWidth="min-w-[1100px]"
            caption="Containers com Demurrage sem Invoice"
            isLoading={exposureQuery.isLoading}
            error={exposureQuery.error}
            errorMessage="Não foi possível carregar a Exposição de Demurrage."
            onRetry={() => void exposureQuery.refetch()}
            hasData={exposureQuery.data !== undefined}
            isEmpty={!exposureQuery.data?.rows.length}
            emptyTitle="Nenhum container com Demurrage sem Invoice."
            pagination={exposurePage.pagination}
          >
            {exposurePage.rows.map((row) => (
              <tr key={row.container_id}>
                <td title={row.division === 'travado' ? row.reason ?? undefined : undefined}>
                  {row.division === 'travado' ? <StatusText tone="warning">{DEMURRAGE_DIVISION_LABELS[row.division]}</StatusText> : DEMURRAGE_DIVISION_LABELS[row.division]}
                </td>
                <td className="app-table__text" title={row.customer_name ?? undefined}>{row.customer_name ?? <NoValue label="Sem Cliente" />}</td>
                <td>{row.voyage_label ?? <NoValue label="Sem Viagem" />}</td>
                <td><CopyValue value={row.bl_id} label="número do B/L"><Link className="app-link" to={`/bls/${encodeURIComponent(row.bl_id)}`}>{row.bl_id}</Link></CopyValue></td>
                <td>{row.container_number}</td>
                <td>{row.discharge_date ? formatDate(row.discharge_date) : <NoValue label="Sem descarga" />}</td>
                <td>{row.return_date ? formatDate(row.return_date) : 'Fora'}</td>
                <td>{row.total_days ?? <NoValue label="Sem dias" />}</td>
                <td>{row.free_days ?? <NoValue label="Sem free time" />}</td>
                <td>{row.state === 'no_rate' ? <StatusText tone="warning">Tipo sem tarifa</StatusText> : formatUSD(row.usd ?? 0)}</td>
              </tr>
            ))}
          </ReportTable>
          {exposureQuery.data?.byCustomer.length ? (
            <Block title="Totais por Cliente" flush>
              <div className="app-table-scroll">
                <table className="app-table app-table--compact text-sm">
                  <caption className="sr-only">Exposição de Demurrage por Cliente</caption>
                  <thead><tr><th scope="col" className="app-table__text-head">Cliente</th><th scope="col">Containers</th><th scope="col">US$ previsto</th></tr></thead>
                  <tbody>
                    {exposureQuery.data.byCustomer.map((row) => (
                      <tr key={String(row.customer_id ?? 'sem')}>
                        <td className="app-table__text">{row.customer_name}</td>
                        <td>{row.boxes}</td>
                        <td>{formatUSD(row.usd)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Block>
          ) : null}
        </>
      ) : null}

      {filters.slice === 'invoices' ? (
        <>
          <div className="app-metric-row" role="group" aria-label="Totais do recorte">
            <MetricCard label="USD líquido (exceto canceladas)" value={formatUSD(invoicesQuery.data?.kpis.netUsd ?? 0)} />
            <MetricCard label="Faturas (exceto canceladas)" value={(invoicesQuery.data?.kpis.invoices ?? 0).toLocaleString('pt-BR')} />
            <MetricCard label="Em aberto (R$ hoje)" value={formatBRL(invoicesQuery.data?.kpis.openBrl ?? 0)} />
            <MetricCard label="Recebido (R$ pago)" value={formatBRL(invoicesQuery.data?.kpis.paidBrl ?? 0)} />
          </div>
          <LoadNotice sources={[{ load: invoicesQuery.data?.load, noun: 'Invoices' }]} />
          <ReportTable
            title="Invoices de Demurrage"
            aside={`${formatResultCount(invoicesQuery.data?.rows.length ?? 0, 'Invoice', 'Invoices')} · emissão mais recente primeiro`}
            columns={['Invoice', 'Tipo', 'B/L', 'Navio / Viagem', 'Cliente', 'Emissão', 'USD líquido', 'Desconto', 'R$ hoje', 'R$ pago', 'Paga em', 'Disputa', 'Situação']}
            minWidth="min-w-[1400px]"
            caption="Invoices do relatório de Demurrage"
            isLoading={invoicesQuery.isLoading}
            error={invoicesQuery.error}
            errorMessage="Não foi possível carregar o relatório de Demurrage."
            onRetry={() => void invoicesQuery.refetch()}
            hasData={invoicesQuery.data !== undefined}
            isEmpty={!invoicesQuery.data?.rows.length}
            emptyTitle="Nenhuma Invoice no período."
            pagination={invoicesPage.pagination}
          >
            {invoicesPage.rows.map((invoice) => {
              const open = invoice.status === 'issued' || invoice.status === 'overdue'
              return (
                <tr key={invoice.id} className={invoice.status === 'cancelled' ? 'app-table__row--muted' : undefined}>
                  <td><Link className="app-link" to={demurrageInvoiceHref(invoice.id)}>{invoice.doc_number}</Link></td>
                  <td>{invoice.kind.doc ? `${invoice.kind.label} ${invoice.kind.doc}` : invoice.kind.label}</td>
                  <td>
                    {invoice.bl_id
                      ? <CopyValue value={invoice.bl_id} label="número do B/L"><Link className="app-link" to={`/bls/${encodeURIComponent(invoice.bl_id)}`}>{invoice.bl_id}</Link></CopyValue>
                      : <NoValue label="Sem B/L" />}
                  </td>
                  <td>{invoice.bl?.voyage ? `${invoice.bl.voyage.vessel?.name ?? 'Navio'} / ${invoice.bl.voyage.voyage_number}` : <NoValue label="Sem Viagem" />}</td>
                  <td className="app-table__text" title={invoice.customer?.name ?? undefined}>{invoice.customer?.name ?? <NoValue label="Sem Cliente" />}</td>
                  <td>{invoice.billed_at ? formatDate(invoice.billed_at) : <NoValue label="Sem data de emissão" />}</td>
                  <td>{formatUSD(invoice.net_usd)}</td>
                  <td title={invoice.discount_justification ?? undefined}>{invoice.discount_usd > 0 ? formatUSD(invoice.discount_usd) : <NoValue label="Sem desconto" />}</td>
                  <td>{open ? formatBRL(invoice.current_total_brl ?? 0) : <NoValue label="Não se aplica" />}</td>
                  <td>{invoice.status === 'paid' ? formatBRL(invoice.current_total_brl ?? 0) : <NoValue label="Não se aplica" />}</td>
                  <td>{invoice.paid_at ? formatDate(invoice.paid_at) : <NoValue label="Sem pagamento" />}</td>
                  <td>{invoice.dispute_open ? <StatusText tone="warning">Aberta</StatusText> : <NoValue label="Sem disputa aberta" />}</td>
                  <td><InvoiceStatusBadge status={invoice.status} /></td>
                </tr>
              )
            })}
          </ReportTable>
        </>
      ) : null}

      {filters.slice === 'itens' ? (
        <>
          <LoadNotice sources={[{ load: itemsQuery.data?.load, noun: 'itens' }]} />
          <ReportTable
            title="Itens por container"
            aside={`${formatResultCount(itemsQuery.data?.rows.length ?? 0, 'item', 'itens')} · Invoices emitidas ou pagas, pela emissão`}
            columns={['Invoice', 'Cliente', 'B/L', 'Container', 'Descarga', 'Devolução', 'Dias', 'Free time', '1º período', '2º período', 'US$']}
            minWidth="min-w-[1300px]"
            caption="Itens das Invoices de Demurrage por container"
            isLoading={itemsQuery.isLoading}
            error={itemsQuery.error}
            errorMessage="Não foi possível carregar os itens das Invoices de Demurrage."
            onRetry={() => void itemsQuery.refetch()}
            hasData={itemsQuery.data !== undefined}
            isEmpty={!itemsQuery.data?.rows.length}
            emptyTitle="Nenhum item de Invoice no período."
            pagination={itemsPage.pagination}
          >
            {itemsPage.rows.map((item) => (
              <tr key={item.id}>
                <td><Link className="app-link" to={demurrageInvoiceHref(item.invoice.id)}>{item.invoice.doc_number}</Link></td>
                <td className="app-table__text" title={item.invoice.customer?.name ?? undefined}>{item.invoice.customer?.name ?? <NoValue label="Sem Cliente" />}</td>
                <td>{item.invoice.bl_id}</td>
                <td>{item.container_number}</td>
                <td>{item.discharge_date ? formatDate(item.discharge_date) : <NoValue label="Sem descarga" />}</td>
                <td>{item.return_date ? formatDate(item.return_date) : <NoValue label="Sem devolução" />}</td>
                <td>{item.total_days ?? <NoValue label="Sem dias" />}</td>
                <td>{item.free_days ?? <NoValue label="Sem free time" />}</td>
                <td>{item.days_p1 ? `${item.days_p1} × ${formatUSD(Number(item.rate_p1_usd ?? 0))}` : '0'}</td>
                <td>{item.days_p2 ? `${item.days_p2} × ${formatUSD(Number(item.rate_p2_usd ?? 0))}` : '0'}</td>
                <td>{formatUSD(Number(item.subtotal_usd ?? 0))}</td>
              </tr>
            ))}
          </ReportTable>
        </>
      ) : null}
    </>
  )
}
