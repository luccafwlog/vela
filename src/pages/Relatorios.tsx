import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { FileDown } from 'lucide-react'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { MetricCard } from '../components/ui/MetricCard'
import { TabButton } from '../components/ui/TabButton'
import { Card, EmptyState, InlineError, PageHeader } from '../components/ui/Card'
import { Field, Input, Select } from '../components/ui/Input'
import { SkeletonTable } from '../components/ui/Skeleton'
import { InvoiceStatusBadge } from '../components/demurrage/DemurrageBadges'
import { useToast } from '../components/ui/Toast'
import { formatBRL, formatCnpjCpf, formatDate, formatUSD } from '../lib/utils'
import { describeActiveFilters, formatResultCount, type OperationalFilter } from '../lib/operationalState'
import {
  DEMURRAGE_INVOICE_STATUS_LABELS,
  FINANCIAL_STATUS_LABELS,
  INVOICE_STATUS_LABELS,
  REVIEW_STATUS_LABELS,
  statusLabel,
} from '../lib/statusLabels'
import {
  fetchCustomerReport,
  fetchFinancialReport,
  fetchFinancialReportForExport,
  fetchOperationalReport,
  fetchOperationalReportForExport,
  type FinancialReportFilters,
  type OperationalReportFilters,
  type ReportFilters,
} from '../services/reports'
import { listDemurrageInvoices } from '../services/demurrage/demurrageInvoices'
import { blTotalCbm, blTotalWeightKg, cargoModeLabel } from '../lib/cargoMode'

type ReportTab = 'operacional' | 'financeiro' | 'clientes' | 'demurrage'

export function Relatorios() {
  const [tab, setTab] = useState<ReportTab>('operacional')

  return (
    <>
      <PageHeader
        title="Relatórios"
        description="Visão consolidada de operação, faturamento e clientes por período. Cada visão informa seu próprio limite."
      />

      <div className="mb-4 flex flex-wrap gap-2" role="tablist">
        <TabButton active={tab === 'operacional'} label="Operacional" onClick={() => setTab('operacional')} />
        <TabButton active={tab === 'financeiro'} label="Financeiro" onClick={() => setTab('financeiro')} />
        <TabButton active={tab === 'clientes'} label="Por Cliente" onClick={() => setTab('clientes')} />
        <TabButton active={tab === 'demurrage'} label="Demurrage" onClick={() => setTab('demurrage')} />
      </div>

      {tab === 'operacional' ? <OperationalReportTab /> : null}
      {tab === 'financeiro' ? <FinancialReportTab /> : null}
      {tab === 'clientes' ? <CustomerReportTab /> : null}
      {tab === 'demurrage' ? <DemurrageReportTab /> : null}
    </>
  )
}

// ---------- Peças compartilhadas pelas quatro visões ----------

// As quatro abas repetiam a mesma caixa âmbar para limite de linhas e acesso
// restrito. Uma peça só mantém o mesmo peso visual em todas.
function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-4 rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-sm text-amber-800">
      {children}
    </div>
  )
}

// O usuário precisa ler o recorte aplicado sem reconstruir os filtros de cabeça.
// Mesma barra já usada nas tabelas de Faturamento e Demurrage.
function TableCaption({ count, singular, plural, filters, sortNote }: {
  count: number
  singular: string
  plural: string
  filters: OperationalFilter[]
  sortNote: string
}) {
  return (
    <div className="billing-table__head flex flex-col gap-1 border-b px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
      <span className="font-semibold text-white">{formatResultCount(count, singular, plural)}</span>
      <span className="text-xs">{describeActiveFilters(filters)} · {sortNote}</span>
    </div>
  )
}

function LimitNotice({ limit, exportIsComplete }: { limit: number; exportIsComplete: boolean }) {
  return (
    <Notice>
      Limite de {limit.toLocaleString('pt-BR')} linhas atingido; os indicadores acima consideram apenas essas linhas.{' '}
      {exportIsComplete
        ? 'A exportação xlsx traz todas as linhas do filtro.'
        : 'Reduza o período para obter totais completos.'}
    </Notice>
  )
}

function periodFilters(dateFrom: string, dateTo: string): OperationalFilter[] {
  return [
    { label: 'de', value: dateFrom ? formatDate(dateFrom) : '' },
    { label: 'até', value: dateTo ? formatDate(dateTo) : '' },
  ]
}

// ---------- Operacional ----------

function OperationalReportTab() {
  const { showToast } = useToast()
  const [filters, setFilters] = useState<OperationalReportFilters>({
    dateFrom: '',
    dateTo: '',
    pod: '',
    cargoMode: '',
  })
  const [exporting, setExporting] = useState(false)

  const { data, isLoading, error } = useQuery({
    queryKey: ['report-operational', filters],
    queryFn: () => fetchOperationalReport(filters),
    staleTime: 30_000,
  })

  async function handleExport() {
    setExporting(true)
    try {
      // Export fetches without row limit for complete data
      const rows = await fetchOperationalReportForExport(filters)
      const { exportOperationalReportWorkbook } = await import('../services/exports')
      await exportOperationalReportWorkbook(rows)
      showToast(`Relatório operacional exportado (${rows.length} linhas).`, 'success')
    } catch {
      showToast('Falha ao exportar o relatório.', 'error')
    } finally {
      setExporting(false)
    }
  }

  return (
    <>
      <Card className="mb-5">
        <div className="reports-filter-grid grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <Field label="Data inicial" hint="Recorte pela data de criação do B/L.">
            <Input
              type="date"
              value={filters.dateFrom}
              onChange={(event) => setFilters((prev) => ({ ...prev, dateFrom: event.target.value }))}
            />
          </Field>
          <Field label="Data final">
            <Input
              type="date"
              value={filters.dateTo}
              onChange={(event) => setFilters((prev) => ({ ...prev, dateTo: event.target.value }))}
            />
          </Field>
          <Field label="POD">
            <Input
              value={filters.pod}
              onChange={(event) => setFilters((prev) => ({ ...prev, pod: event.target.value.toUpperCase() }))}
              placeholder="BRVIT"
            />
          </Field>
          <Field label="Modalidade">
            <Select
              value={filters.cargoMode}
              onChange={(event) =>
                setFilters((prev) => ({ ...prev, cargoMode: event.target.value as OperationalReportFilters['cargoMode'] }))
              }
            >
              <option value="">Todas</option>
              <option value="container">Container</option>
              <option value="carga_solta">Carga Solta</option>
              <option value="misto">Misto</option>
            </Select>
          </Field>
          <div className="reports-filter-action">
            <Button onClick={handleExport} loading={exporting} disabled={!data?.rows.length}>
              <FileDown size={15} />
              Exportar xlsx
            </Button>
          </div>
        </div>
      </Card>

      <div className="mb-5 flex flex-col gap-4">
        <div>
          <MetricCard label="B/Ls" value={String(data?.kpis.totalBls ?? 0)} tone="primary" />
        </div>
        <div className="grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-[repeat(auto-fit,minmax(200px,1fr))]">
          <MetricCard label="Containers distintos" value={String(data?.kpis.totalContainers ?? 0)} />
          <MetricCard label="Viagens distintas" value={String(data?.kpis.totalVoyages ?? 0)} />
          <MetricCard label="Peso total (kg)" value={(data?.kpis.totalWeightKg ?? 0).toLocaleString('pt-BR')} />
          <MetricCard label="CBM total" value={(data?.kpis.totalCbm ?? 0).toLocaleString('pt-BR')} />
        </div>
      </div>

      {data?.kpis.truncated ? <LimitNotice limit={2000} exportIsComplete /> : null}

      <Card className="overflow-hidden p-0">
        <TableCaption
          count={data?.rows.length ?? 0}
          singular="B/L retornado"
          plural="B/Ls retornados"
          filters={[
            ...periodFilters(filters.dateFrom, filters.dateTo),
            { label: 'POD', value: filters.pod },
            {
              label: 'modalidade',
              value: filters.cargoMode ? cargoModeLabel(filters.cargoMode) : '',
            },
          ]}
          sortNote="Ordenado por criação (recente)"
        />
        {error ? <InlineError message="Erro ao carregar relatório operacional." /> : null}
        <div className="app-table-scroll">
          <table className="app-table app-table--compact min-w-[1100px] text-left text-sm">
            <thead>
              <tr>
                <th scope="col" className="px-4 py-3">B/L</th>
                <th scope="col" className="px-4 py-3">Navio/Viagem</th>
                <th scope="col" className="px-4 py-3">POL</th>
                <th scope="col" className="px-4 py-3">POD</th>
                <th scope="col" className="px-4 py-3">Cliente</th>
                <th scope="col" className="px-4 py-3 text-right">Containers</th>
                <th scope="col" className="px-4 py-3 text-right">Peso (kg)</th>
                <th scope="col" className="px-4 py-3 text-right">CBM</th>
                <th scope="col" className="px-4 py-3">Revisão</th>
                <th scope="col" className="px-4 py-3">Financeiro</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={10} className="p-0">
                    <SkeletonTable rows={6} cols={10} />
                  </td>
                </tr>
              ) : null}
              {!isLoading && !error && !data?.rows.length ? (
                <tr>
                  <td colSpan={10} className="p-0">
                    <EmptyState title="Nenhum dado encontrado." description="Ajuste o período ou os filtros aplicados." />
                  </td>
                </tr>
              ) : null}
              {data?.rows.map((row) => (
                <tr key={row.id}>
                  <td className="px-4 py-3 font-semibold text-[var(--app-text-strong)]">{row.id}</td>
                  <td className="px-4 py-3 text-[var(--app-text)]">
                    {row.voyage?.vessel?.name ?? '-'} / {row.voyage?.voyage_number ?? '-'}
                  </td>
                  <td className="px-4 py-3">{row.pol ?? '-'}</td>
                  <td className="px-4 py-3">{row.pod ?? '-'}</td>
                  <td className="px-4 py-3 text-[var(--app-text)]">{row.customer?.name ?? '-'}</td>
                  <td className="px-4 py-3 text-right">{(row.bl_containers ?? []).length}</td>
                  <td className="px-4 py-3 text-right font-mono">
                    {blTotalWeightKg(row).toLocaleString('pt-BR')}
                  </td>
                  <td className="px-4 py-3 text-right font-mono">
                    {blTotalCbm(row).toLocaleString('pt-BR')}
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={row.review_status === 'reviewed' || row.review_status === 'ok' ? 'green' : 'yellow'}>
                      {statusLabel(REVIEW_STATUS_LABELS, row.review_status)}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-[var(--app-muted)]">{statusLabel(FINANCIAL_STATUS_LABELS, row.financial_status)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  )
}

// ---------- Financeiro ----------

const FINANCIAL_STATUS_FILTER_OPTIONS = ['draft', 'issued', 'partially_paid', 'paid', 'cancelled'] as const

function FinancialReportTab() {
  const { showToast } = useToast()
  const [filters, setFilters] = useState<FinancialReportFilters>({
    dateFrom: '',
    dateTo: '',
    status: '',
  })
  const [exporting, setExporting] = useState(false)

  const { data, isLoading, error } = useQuery({
    queryKey: ['report-financial', filters],
    queryFn: () => fetchFinancialReport(filters),
    staleTime: 30_000,
  })
  const accessDenied = Boolean(data?.accessDenied)

  async function handleExport() {
    setExporting(true)
    try {
      const rows = await fetchFinancialReportForExport(filters)
      const { exportFinancialReportWorkbook } = await import('../services/exports')
      await exportFinancialReportWorkbook(rows)
      showToast(`Relatório financeiro exportado (${rows.length} linhas).`, 'success')
    } catch {
      showToast('Falha ao exportar o relatório.', 'error')
    } finally {
      setExporting(false)
    }
  }

  return (
    <>
      <Card className="mb-5">
        <div className="reports-filter-grid grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Field label="Data inicial" hint="Recorte pela data de emissão da invoice.">
            <Input
              type="date"
              value={filters.dateFrom}
              onChange={(event) => setFilters((prev) => ({ ...prev, dateFrom: event.target.value }))}
            />
          </Field>
          <Field label="Data final">
            <Input
              type="date"
              value={filters.dateTo}
              onChange={(event) => setFilters((prev) => ({ ...prev, dateTo: event.target.value }))}
            />
          </Field>
          <Field label="Status">
            <Select
              value={filters.status}
              onChange={(event) =>
                setFilters((prev) => ({ ...prev, status: event.target.value as FinancialReportFilters['status'] }))
              }
            >
              <option value="">Todos</option>
              {FINANCIAL_STATUS_FILTER_OPTIONS.map((status) => (
                <option key={status} value={status}>
                  {statusLabel(INVOICE_STATUS_LABELS, status)}
                </option>
              ))}
            </Select>
          </Field>
          <div className="reports-filter-action">
            <Button onClick={handleExport} loading={exporting} disabled={!data?.rows.length}>
              <FileDown size={15} />
              Exportar xlsx
            </Button>
          </div>
        </div>
      </Card>

      {accessDenied ? (
        <Notice>
          Visualização financeira restrita ao perfil admin. Nenhum indicador, linha ou exportação é liberado para este perfil.
        </Notice>
      ) : null}

      {accessDenied ? null : (
        <>
          <div className="mb-5 flex flex-col gap-4">
            <div>
              <MetricCard label="Saldo em aberto" value={formatBRL(data?.kpis.totalOpen ?? 0)} tone="primary" />
            </div>
            <div className="grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-[repeat(auto-fit,minmax(200px,1fr))]">
              <MetricCard label="Invoices" value={String(data?.kpis.totalInvoices ?? 0)} />
              <MetricCard label="Total emitido" value={formatBRL(data?.kpis.totalIssued ?? 0)} />
              <MetricCard label="Total pago" value={formatBRL(data?.kpis.totalPaid ?? 0)} />
              <div className="opacity-75">
                <MetricCard label="Canceladas" value={String(data?.kpis.totalCanceled ?? 0)} />
              </div>
            </div>
          </div>

          {data?.kpis.truncated ? <LimitNotice limit={2000} exportIsComplete /> : null}

          <Card className="overflow-hidden p-0">
            <TableCaption
              count={data?.rows.length ?? 0}
              singular="invoice retornada"
              plural="invoices retornadas"
              filters={[
                ...periodFilters(filters.dateFrom, filters.dateTo),
                { label: 'status', value: filters.status ? statusLabel(INVOICE_STATUS_LABELS, filters.status) : '' },
              ]}
              sortNote="Ordenado por emissão (recente)"
            />
            {error ? <InlineError message="Erro ao carregar relatório financeiro." /> : null}
            <div className="app-table-scroll">
              <table className="app-table app-table--compact min-w-[980px] text-left text-sm">
                <thead>
                  <tr>
                    <th scope="col" className="px-4 py-3">Invoice</th>
                    <th scope="col" className="px-4 py-3">Cliente</th>
                    <th scope="col" className="px-4 py-3">Emissão</th>
                    <th scope="col" className="px-4 py-3 text-right">Total BRL</th>
                    <th scope="col" className="px-4 py-3 text-right">Saldo BRL</th>
                    <th scope="col" className="px-4 py-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    <tr>
                      <td colSpan={6} className="p-0">
                        <SkeletonTable rows={6} cols={6} />
                      </td>
                    </tr>
                  ) : null}
                  {!isLoading && !error && !data?.rows.length ? (
                    <tr>
                      <td colSpan={6} className="p-0">
                        <EmptyState title="Nenhum dado encontrado." description="Ajuste o período ou os filtros aplicados." />
                      </td>
                    </tr>
                  ) : null}
                  {data?.rows.map((row) => (
                    <tr key={row.id}>
                      <td className="px-4 py-3 font-semibold text-[var(--app-text-strong)]">{row.invoice_number ?? `INV-${row.id}`}</td>
                      <td className="px-4 py-3 text-[var(--app-text)]">{row.customer?.name ?? '-'}</td>
                      <td className="px-4 py-3 text-[var(--app-muted)]">{formatDate(row.issued_at)}</td>
                      <td className="px-4 py-3 text-right font-mono text-[var(--app-text-strong)]">{formatBRL(row.total_brl ?? 0)}</td>
                      <td className="px-4 py-3 text-right font-mono text-amber-700">{formatBRL(row.balance_brl ?? 0)}</td>
                      <td className="px-4 py-3">
                        <Badge tone={invoiceStatusTone(row.status)}>{statusLabel(INVOICE_STATUS_LABELS, row.status)}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </>
  )
}

function invoiceStatusTone(status: string | null): 'green' | 'yellow' | 'red' | 'blue' | 'slate' {
  switch (status) {
    case 'paid':
      return 'green'
    case 'partially_paid':
      return 'blue'
    case 'issued':
      return 'yellow'
    case 'draft':
    case 'cancelled':
    default:
      return 'slate'
  }
}

// ---------- Clientes ----------

function CustomerReportTab() {
  const { showToast } = useToast()
  const [filters, setFilters] = useState<ReportFilters>({
    dateFrom: '',
    dateTo: '',
  })
  const [exporting, setExporting] = useState(false)

  const { data, isLoading, error } = useQuery({
    queryKey: ['report-customers', filters],
    queryFn: () => fetchCustomerReport(filters),
    staleTime: 30_000,
  })

  async function handleExport() {
    if (!data?.rows.length) {
      showToast('Nenhum dado para exportar.', 'info')
      return
    }
    setExporting(true)
    try {
      const { exportCustomerReportWorkbook } = await import('../services/exports')
      await exportCustomerReportWorkbook(data.rows)
      showToast(`Relatório por cliente exportado (${data.rows.length} linhas).`, 'success')
    } catch {
      showToast('Falha ao exportar o relatório.', 'error')
    } finally {
      setExporting(false)
    }
  }

  return (
    <>
      <Card className="mb-5">
        <div className="reports-filter-grid grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Field label="Data inicial" hint="B/Ls pela criação; invoices pela emissão.">
            <Input
              type="date"
              value={filters.dateFrom}
              onChange={(event) => setFilters((prev) => ({ ...prev, dateFrom: event.target.value }))}
            />
          </Field>
          <Field label="Data final">
            <Input
              type="date"
              value={filters.dateTo}
              onChange={(event) => setFilters((prev) => ({ ...prev, dateTo: event.target.value }))}
            />
          </Field>
          <div className="reports-filter-action">
            <Button onClick={handleExport} loading={exporting} disabled={!data?.rows.length}>
              <FileDown size={15} />
              Exportar xlsx
            </Button>
          </div>
        </div>
      </Card>

      {data?.invoicesAccessDenied ? (
        <Notice>
          Totais financeiros por cliente indisponíveis para este perfil. Exibindo apenas métricas operacionais; as colunas
          Invoices, Emitido e Em aberto ficam zeradas, inclusive no arquivo exportado.
        </Notice>
      ) : null}

      <div className="mb-5 flex flex-col gap-4">
        <div>
          <MetricCard label="Total faturado" value={formatBRL(data?.kpis.totalIssued ?? 0)} tone="primary" />
        </div>
        <div className="grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-[repeat(auto-fit,minmax(200px,1fr))]">
          <MetricCard label="Clientes ativos" value={String(data?.kpis.totalCustomers ?? 0)} />
          <MetricCard label="Top por volume (B/Ls)" value={data?.kpis.topByBls ?? '-'} />
          <MetricCard label="Top por faturamento" value={data?.kpis.topByInvoiced ?? '-'} />
        </div>
      </div>

      {data?.kpis.truncated ? <LimitNotice limit={4000} exportIsComplete={false} /> : null}

      <Card className="overflow-hidden p-0">
        <TableCaption
          count={data?.rows.length ?? 0}
          singular="cliente retornado"
          plural="clientes retornados"
          filters={periodFilters(filters.dateFrom, filters.dateTo)}
          sortNote="Ordenado por faturamento"
        />
        {error ? <InlineError message="Erro ao carregar relatório por cliente." /> : null}
        <div className="app-table-scroll">
          <table className="app-table app-table--compact min-w-[1020px] text-left text-sm">
            <thead>
              <tr>
                <th scope="col" className="px-4 py-3">Cliente</th>
                <th scope="col" className="px-4 py-3">CNPJ</th>
                <th scope="col" className="px-4 py-3 text-right">B/Ls</th>
                <th scope="col" className="px-4 py-3 text-right">Peso (kg)</th>
                <th scope="col" className="px-4 py-3 text-right">CBM</th>
                <th scope="col" className="px-4 py-3 text-right">Invoices</th>
                <th scope="col" className="px-4 py-3 text-right">Emitido</th>
                <th scope="col" className="px-4 py-3 text-right">Em aberto</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={8} className="p-0">
                    <SkeletonTable rows={6} cols={8} />
                  </td>
                </tr>
              ) : null}
              {!isLoading && !error && !data?.rows.length ? (
                <tr>
                  <td colSpan={8} className="p-0">
                    <EmptyState title="Nenhum dado encontrado." description="Ajuste o período ou os filtros aplicados." />
                  </td>
                </tr>
              ) : null}
              {data?.rows.map((row) => (
                <tr key={row.customer_id}>
                  <td className="px-4 py-3 font-semibold text-[var(--app-text-strong)]">{row.name}</td>
                  <td className="px-4 py-3 font-mono text-xs text-[var(--app-muted)]">{formatCnpjCpf(row.cnpj_cpf)}</td>
                  <td className="px-4 py-3 text-right">{row.blCount}</td>
                  <td className="px-4 py-3 text-right font-mono">
                    {row.totalWeightKg.toLocaleString('pt-BR')}
                  </td>
                  <td className="px-4 py-3 text-right font-mono">
                    {row.totalCbm.toLocaleString('pt-BR')}
                  </td>
                  <td className="px-4 py-3 text-right">{row.invoiceCount}</td>
                  <td className="px-4 py-3 text-right font-mono text-[var(--app-text-strong)]">{formatBRL(row.totalIssued)}</td>
                  <td className="px-4 py-3 text-right font-mono text-amber-700">{formatBRL(row.totalBalance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  )
}

// ---------- Demurrage ----------

const DEMURRAGE_STATUS_FILTER_OPTIONS = ['draft', 'issued', 'paid', 'cancelled'] as const

function DemurrageReportTab() {
  const { showToast } = useToast()
  const today = new Date().toISOString().slice(0, 10)
  const firstOfYear = today.slice(0, 4) + '-01-01'
  const [dateFrom, setDateFrom] = useState(firstOfYear)
  const [dateTo, setDateTo] = useState(today)
  const [statusFilter, setStatusFilter] = useState('')
  const [exporting, setExporting] = useState(false)

  const { data, isLoading, error } = useQuery({
    queryKey: ['demurrage-report', dateFrom, dateTo, statusFilter],
    queryFn: () => listDemurrageInvoices({
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      status: (statusFilter as 'draft' | 'issued' | 'paid' | 'cancelled') || undefined,
    }),
    staleTime: 60_000,
  })

  const invoices = data ?? []
  // Faturas canceladas continuam listadas (o operador precisa vê-las), mas somá-las
  // inflaria os totais. Cada indicador declara no rótulo o recorte que agrega.
  const active = invoices.filter((invoice) => invoice.status !== 'cancelled')
  const totalUSD = active.reduce((sum, invoice) => sum + (invoice.total_usd ?? 0), 0)
  const billedBRL = active
    .filter((invoice) => invoice.status === 'issued' || invoice.status === 'paid')
    .reduce((sum, invoice) => sum + (invoice.current_total_brl ?? 0), 0)
  const paidBRL = invoices
    .filter((invoice) => invoice.status === 'paid')
    .reduce((sum, invoice) => sum + (invoice.current_total_brl ?? 0), 0)

  async function handleExport() {
    if (!invoices.length) {
      showToast('Nenhum dado para exportar.', 'info')
      return
    }
    setExporting(true)
    try {
      const { exportDemurrageReportWorkbook } = await import('../services/exports')
      await exportDemurrageReportWorkbook(invoices)
      showToast(`Relatório de demurrage exportado (${invoices.length} linhas).`, 'success')
    } catch {
      showToast('Falha ao exportar o relatório.', 'error')
    } finally {
      setExporting(false)
    }
  }

  return (
    <>
      <Card className="mb-5">
        <div className="reports-filter-grid grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Field label="Data inicial" hint="Recorte pela data do documento.">
            <Input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
          </Field>
          <Field label="Data final">
            <Input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
          </Field>
          <Field label="Status">
            <Select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="">Todos</option>
              {DEMURRAGE_STATUS_FILTER_OPTIONS.map((status) => (
                <option key={status} value={status}>
                  {statusLabel(DEMURRAGE_INVOICE_STATUS_LABELS, status)}
                </option>
              ))}
            </Select>
          </Field>
          <div className="reports-filter-action">
            <Button onClick={handleExport} loading={exporting} disabled={!invoices.length}>
              <FileDown size={15} />
              Exportar xlsx
            </Button>
          </div>
        </div>
      </Card>

      <div className="mb-5 flex flex-col gap-4">
        <div>
          <MetricCard label="Total USD (exceto canceladas)" value={formatUSD(totalUSD)} tone="primary" />
        </div>
        <div className="grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-[repeat(auto-fit,minmax(200px,1fr))]">
          <MetricCard label="Faturas" value={String(invoices.length)} />
          <MetricCard label="Faturado (BRL)" value={formatBRL(billedBRL)} />
          <MetricCard label="Recebido (BRL)" value={formatBRL(paidBRL)} />
        </div>
      </div>

      <Card className="overflow-hidden p-0">
        <TableCaption
          count={invoices.length}
          singular="fatura retornada"
          plural="faturas retornadas"
          filters={[
            ...periodFilters(dateFrom, dateTo),
            { label: 'status', value: statusFilter ? statusLabel(DEMURRAGE_INVOICE_STATUS_LABELS, statusFilter) : '' },
          ]}
          sortNote="Ordenado por criação (recente)"
        />
        {error ? <InlineError message="Erro ao carregar relatório de demurrage." /> : null}
        <div className="app-table-scroll">
          <table className="app-table app-table--compact min-w-[900px] text-left text-sm">
            <thead>
              <tr>
                <th scope="col" className="px-4 py-3">Doc</th>
                <th scope="col" className="px-4 py-3">BL</th>
                <th scope="col" className="px-4 py-3">Cliente</th>
                <th scope="col" className="px-4 py-3">Emissão</th>
                <th scope="col" className="px-4 py-3">Vencimento</th>
                <th scope="col" className="px-4 py-3 text-right">Total USD</th>
                <th scope="col" className="px-4 py-3 text-right">Total BRL</th>
                <th scope="col" className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={8} className="p-0">
                    <SkeletonTable rows={6} cols={8} />
                  </td>
                </tr>
              ) : null}
              {!isLoading && !error && !invoices.length ? (
                <tr>
                  <td colSpan={8} className="p-0">
                    <EmptyState title="Nenhuma invoice no período." description="Ajuste o período ou o status aplicado." />
                  </td>
                </tr>
              ) : null}
              {invoices.map((invoice) => (
                <tr key={invoice.id}>
                  <td className="px-4 py-2 font-mono text-xs text-[var(--app-text-strong)]">{invoice.doc_number}</td>
                  <td className="px-4 py-2 text-[var(--app-blue-btn)]">{invoice.bl_id}</td>
                  <td className="px-4 py-2">{invoice.customer?.name ?? '—'}</td>
                  <td className="px-4 py-2 text-[var(--app-muted)]">{invoice.doc_date ? formatDate(invoice.doc_date) : '—'}</td>
                  <td className="px-4 py-2 text-[var(--app-muted)]">{invoice.due_date ? formatDate(invoice.due_date) : '—'}</td>
                  <td className="px-4 py-2 text-right font-mono font-semibold text-amber-700">{formatUSD(invoice.total_usd ?? 0)}</td>
                  <td className="px-4 py-2 text-right font-mono font-semibold text-green-700">{formatBRL(invoice.current_total_brl ?? 0)}</td>
                  <td className="px-4 py-2"><InvoiceStatusBadge status={invoice.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  )
}
