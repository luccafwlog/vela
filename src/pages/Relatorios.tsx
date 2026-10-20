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
  fetchDemurrageReport,
  fetchFinancialReport,
  fetchOperationalReport,
  isReportComplete,
  reportReviewLabel,
  type ReportLoad,
  type ReportScope,
} from '../services/reports'
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

const DEMURRAGE_STATUS_FILTER_OPTIONS = ['draft', 'issued', 'paid', 'cancelled'] as const

function DemurrageReportView(props: ViewProps) {
  const { params, setParam, setParams } = props
  const filters = demurrageFiltersFromSearch(params)
  const customerName = customerNameFromSearch(params)
  const handlers = useScopeHandlers(props, true)
  const { data: voyages } = useVoyageOptions()
  const exporter = useExport()

  const query = useQuery({
    queryKey: ['demurrage-report', filters],
    queryFn: () => fetchDemurrageReport(filters),
    staleTime: 60_000,
  })
  const { data } = query
  const page = useReportPage(data?.rows)

  const moreLines: ReportFilterLine[] = [
    { Filtro: 'Situação', Valor: filters.status ? statusLabel(DEMURRAGE_INVOICE_STATUS_LABELS, filters.status) : '' },
    { Filtro: 'Em disputa', Valor: filters.dispute === 'sim' ? 'Sim' : filters.dispute === 'nao' ? 'Não' : '' },
    { Filtro: 'Vencidas', Valor: filters.overdue === 'sim' ? 'Só vencidas' : '' },
  ]
  const lines = activeLines([...scopeFilterLines(filters, 'Data do documento', voyageLabel(voyages, filters.voyageId), customerName), ...moreLines])
  const moreCount = activeLines(moreLines).length

  function clearMore() {
    let next = params
    for (const key of ['situacao', 'disputa', 'vencidas'] as const) next = withReportParam(next, key, '')
    setParams(next)
  }

  const exportReport = () => exporter.run(async () => {
    const { rows } = await fetchDemurrageReport(filters, EXPORT_ALL)
    const { exportDemurrageReportWorkbook } = await import('../services/exports')
    await exportDemurrageReportWorkbook(rows, lines)
    return rows.length
  })

  return (
    <>
      <ScopeFilters
        scope={filters}
        customerName={customerName}
        periodLabel="Data do documento"
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
              {DEMURRAGE_STATUS_FILTER_OPTIONS.map((status) => (
                <option key={status} value={status}>{statusLabel(DEMURRAGE_INVOICE_STATUS_LABELS, status)}</option>
              ))}
            </Select>
          </Field>
          <Field label="Em disputa">
            <Select value={filters.dispute} onChange={(event) => setParam('disputa', event.target.value)}>
              <option value="">Todas</option>
              <option value="sim">Sim</option>
              <option value="nao">Não</option>
            </Select>
          </Field>
          <Field label="Vencidas">
            <Select value={filters.overdue} onChange={(event) => setParam('vencidas', event.target.value)}>
              <option value="">Todas</option>
              <option value="sim">Só vencidas</option>
            </Select>
          </Field>
        </div>
      </FilterBar>
      <ActiveFiltersNote lines={lines} />

      <div className="app-metric-row" role="group" aria-label="Totais do recorte">
        <MetricCard label="Total US$ (exceto canceladas)" value={formatUSD(data?.kpis.totalUsd ?? 0)} />
        <MetricCard label="Faturas" value={(data?.rows.length ?? 0).toLocaleString('pt-BR')} />
        <MetricCard label="Faturado (R$)" value={formatBRL(data?.kpis.billedBrl ?? 0)} />
        <MetricCard label="Recebido (R$)" value={formatBRL(data?.kpis.paidBrl ?? 0)} />
      </div>

      <LoadNotice sources={[{ load: data?.load, noun: 'Invoices' }]} />

      <ReportTable
        title="Invoices de Demurrage"
        aside={`${formatResultCount(data?.rows.length ?? 0, 'Invoice', 'Invoices')} · criação mais recente primeiro`}
        columns={['Invoice', 'B/L', 'Cliente', 'Emissão', 'Vencimento', 'Total US$', 'Total R$', 'Situação']}
        minWidth="min-w-[900px]"
        caption="Invoices do relatório de Demurrage"
        isLoading={query.isLoading}
        error={query.error}
        errorMessage="Não foi possível carregar o relatório de Demurrage."
        onRetry={() => void query.refetch()}
        hasData={data !== undefined}
        isEmpty={!data?.rows.length}
        emptyTitle="Nenhuma Invoice no período."
        pagination={page.pagination}
      >
        {page.rows.map((invoice) => (
          <tr key={invoice.id} className={invoice.status === 'cancelled' ? 'app-table__row--muted' : undefined}>
            <td><Link className="app-link" to={demurrageInvoiceHref(invoice.id)}>{invoice.doc_number}</Link></td>
            <td>
              {invoice.bl_id
                ? <CopyValue value={invoice.bl_id} label="número do B/L"><Link className="app-link" to={`/bls/${encodeURIComponent(invoice.bl_id)}`}>{invoice.bl_id}</Link></CopyValue>
                : <NoValue label="Sem B/L" />}
            </td>
            <td className="app-table__text" title={invoice.customer?.name ?? undefined}>{invoice.customer?.name ?? <NoValue label="Sem Cliente" />}</td>
            <td>{invoice.doc_date ? formatDate(invoice.doc_date) : <NoValue label="Sem data de emissão" />}</td>
            <td>{invoice.due_date ? formatDate(invoice.due_date) : <NoValue label="Sem vencimento" />}</td>
            <td>{formatUSD(invoice.total_usd ?? 0)}</td>
            <td>{formatBRL(invoice.current_total_brl ?? 0)}</td>
            <td><InvoiceStatusBadge status={invoice.status} /></td>
          </tr>
        ))}
      </ReportTable>
    </>
  )
}
