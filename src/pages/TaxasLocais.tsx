import { useMemo, useState } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Download, FilePlus2 } from 'lucide-react'
import { ConsolidatedInvoiceModal } from '../components/billing/ConsolidatedInvoiceModal'
import { ValidacaoTab } from '../components/billing/ValidacaoTab'
import { FinancialAlertsPanel } from '../components/billing/FinancialAlertsPanel'
import { CodAdjustmentsPanel } from '../components/billing/CodAdjustmentsPanel'
import { InvoiceFiltersBar } from '../components/billing/InvoiceFiltersBar'
import { FILTER_KEYS, type Filters } from '../components/billing/invoiceFilters'
import { InvoicesTable } from '../components/billing/InvoicesTable'
import { InvoiceDetailModal } from '../components/billing/InvoiceDetailModal'
import { Button } from '../components/ui/Button'
import { TabButton } from '../components/ui/TabButton'
import { PageHeader } from '../components/ui/Card'
import { MetricCard } from '../components/ui/MetricCard'
import { useToast } from '../components/ui/Toast'
import { useAuth } from '../hooks/useAuth'
import { useInvoices } from '../hooks/useBilling'
import { resolveLegacyFaturamentoRedirect, toRouteTarget } from '../lib/routeRedirects'
import { isConsolidatedInvoice, listInvoicesForExport } from '../services/billing'
import { exportInvoicesWorkbook } from '../services/exports'
import { listFinancialAlerts } from '../services/alerts'
import { queryKeys } from '../services/queryKeys'
import { describeActiveFilters, describeEmptyState } from '../lib/operationalState'
import { formatBRL } from '../lib/utils'

function extractMessage(error: unknown, fallback: string): string {
  if (!error) return fallback
  if (typeof error === 'string') return error
  if (typeof error === 'object') {
    const msg = (error as { message?: string }).message
    if (msg) return msg
  }
  return fallback
}

export function TaxasLocais() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { user } = useAuth()
  const { showToast } = useToast()

  const [filters, setFilters] = useState<Filters>({
    search: '',
    customerId: searchParams.get('customer') ?? '',
    status: '',
    invoiceType: '',
    blSearch: searchParams.get('bl') ?? '',
    voyageSearch: '',
    pod: '',
    dateFrom: '',
    dateTo: '',
    paidFrom: '',
    paidTo: '',
    page: 1,
    pageSize: 20,
  })
  const [customerFilterLabel, setCustomerFilterLabel] = useState(searchParams.get('customerName') ?? '')
  const [filterResetKey, setFilterResetKey] = useState(0)
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<number | null>(Number(searchParams.get('invoice') ?? '') || null)
  // Etapa 12 do plano de faturamento: as abas Pendências e Demurrage saíram.
  // Pendências era subconjunto literal da Validação (mesma fonte, mesmo
  // limite, só chargeStatus=review_required fixo) — quem vinha de
  // ?tab=pendencias cai na Validação com esse filtro pré-aplicado.
  // Demurrage duplicava /demurrage sem os filtros e a impressão de lá —
  // quem vinha de ?tab=demurrage é redirecionado para o módulo real.
  const requestedTab = searchParams.get('tab')
  const [activeTab, setActiveTab] = useState<'validacao' | 'invoices'>(
    requestedTab === 'validacao' || requestedTab === 'pendencias' ? 'validacao' : 'invoices'
  )
  const validacaoInitialBlockCode = requestedTab === 'pendencias' ? 'calculo_incompleto' : undefined

  const [exporting, setExporting] = useState(false)
  const [consolidatedOpen, setConsolidatedOpen] = useState(false)

  // Sincroniza estado com a URL — ajuste durante o render (sem useEffect),
  // disparado pela identidade de searchParams como o effect original
  // (prev inicia null para reproduzir a execução de montagem).
  const [prevSearchParams, setPrevSearchParams] = useState<typeof searchParams | null>(null)
  if (searchParams !== prevSearchParams) {
    setPrevSearchParams(searchParams)
    const invoiceId = Number(searchParams.get('invoice') ?? '') || null
    const customerId = searchParams.get('customer') ?? ''
    const customerName = searchParams.get('customerName') ?? ''
    const blSearch = searchParams.get('bl') ?? ''

    setSelectedInvoiceId(invoiceId)
    if (invoiceId) setActiveTab('invoices')
    setCustomerFilterLabel(customerName)
    setFilters((current) =>
      current.customerId === customerId && current.blSearch === blSearch
        ? current
        : { ...current, customerId, blSearch, page: 1 },
    )
  }

  const { data, isLoading, error } = useInvoices(filters)

  const financialAlertsQuery = useQuery({
    queryKey: queryKeys.alerts.financial(),
    queryFn: listFinancialAlerts,
    staleTime: 60_000,
  })

  const totalPages = Math.max(1, Math.ceil((data?.count ?? 0) / filters.pageSize))
  const invoices = useMemo(() => data?.rows ?? [], [data?.rows])

  const summary = useMemo(() => {
    const paidStatuses = new Set(['paid', 'covered'])
    const cancelledStatuses = new Set(['cancelled', 'obsolete'])
    const open = invoices.filter((row) => !paidStatuses.has(row.status ?? '') && !cancelledStatuses.has(row.status ?? ''))
    return {
      count: data?.count ?? 0,
      openBalance: open.reduce((sum, row) => sum + Number(row.balance_brl ?? 0), 0),
      paidCount: invoices.filter((row) => paidStatuses.has(row.status ?? '')).length,
      consolidatedCount: invoices.filter((row) => isConsolidatedInvoice(row)).length,
      overdueCount: invoices.filter((row) => row.status === 'overdue').length,
    }
  }, [data?.count, invoices])

  function updateFilter<K extends keyof Filters>(key: K, value: Filters[K]) {
    setFilters((current) => ({ ...current, [key]: value, page: key === 'page' ? Number(value) : 1 }))
  }

  const activeFilterCount = FILTER_KEYS.filter((key) => String(filters[key] ?? '').trim() !== '').length
  const filterDescription = describeActiveFilters([
    { label: 'B/L', value: filters.blSearch },
    { label: 'Fatura', value: filters.search },
    { label: 'Cliente', value: filters.customerId },
    { label: 'Navio/Viagem', value: filters.voyageSearch },
    { label: 'POD', value: filters.pod },
    { label: 'Tipo', value: filters.invoiceType },
    { label: 'Status', value: filters.status },
    { label: 'Emissao de', value: filters.dateFrom },
    { label: 'Emissao ate', value: filters.dateTo },
    { label: 'Pagamento de', value: filters.paidFrom },
    { label: 'Pagamento ate', value: filters.paidTo },
  ])
  const emptyState = describeEmptyState({
    entitySingular: 'fatura',
    entityPlural: 'faturas',
    hasActiveFilters: activeFilterCount > 0,
    emptyWithoutFilters: 'Nenhuma fatura emitida ainda.',
  })

  function clearFilters() {
    setCustomerFilterLabel('')
    setFilters((current) => ({
      ...current,
      search: '',
      customerId: '',
      status: '',
      invoiceType: '',
      blSearch: '',
      voyageSearch: '',
      pod: '',
      dateFrom: '',
      dateTo: '',
      paidFrom: '',
      paidTo: '',
      page: 1,
    }))
    setFilterResetKey((key) => key + 1)
  }

  function closeDetails() {
    setSelectedInvoiceId(null)
    const next = new URLSearchParams(searchParams)
    next.delete('invoice')
    setSearchParams(next)
  }

  async function handleExport() {
    setExporting(true)
    try {
      const rows = await listInvoicesForExport(filters)
      if (rows.length === 0) {
        showToast('Nenhuma fatura para exportar com os filtros atuais.', 'info')
        return
      }
      await exportInvoicesWorkbook(rows)
      showToast(`Relatório exportado (${rows.length} fatura(s)).`, 'success')
    } catch (error) {
      showToast(extractMessage(error, 'Falha ao exportar relatório.'), 'error')
    } finally {
      setExporting(false)
    }
  }

  // Precisa vir depois de todos os hooks acima (Regras dos Hooks): a
  // contagem/ordem de chamadas tem que ser igual em toda renderização deste
  // componente, inclusive na que redireciona.
  if (requestedTab === 'demurrage') {
    return <Navigate to={toRouteTarget(resolveLegacyFaturamentoRedirect(`?${searchParams.toString()}`))} replace />
  }

  return (
    <main className="billing-page">
      <PageHeader
        title="Taxas Locais"
        description="Emissão de taxas locais, validação de cálculos e acompanhamento financeiro por B/L."
        action={
          <>
            <Link className="app-btn app-btn--secondary" to="/taxas-locais/tabelas">Gerenciar em Tabelas</Link>
            <Button onClick={() => setConsolidatedOpen(true)}><FilePlus2 size={16} />Gerar fatura consolidada</Button>
          </>
        }
      />

      <ConsolidatedInvoiceModal open={consolidatedOpen} onClose={() => setConsolidatedOpen(false)} />

      <FinancialAlertsPanel
        alerts={financialAlertsQuery.data ?? []}
        loading={financialAlertsQuery.isLoading}
      />

      <CodAdjustmentsPanel />

      <div className="billing-page__tabs mb-5 flex flex-wrap gap-2" role="tablist" aria-label="Módulos de faturamento">
        <TabButton active={activeTab === 'invoices'} label="Faturas" onClick={() => setActiveTab('invoices')} />
        <TabButton active={activeTab === 'validacao'} label="Validação" onClick={() => setActiveTab('validacao')} />
      </div>

      {activeTab === 'validacao' ? (
        <ValidacaoTab userId={user?.id ?? null} initialBlockCode={validacaoInitialBlockCode} initialBlSearch={searchParams.get('bl') ?? ''} />
      ) : null}

      {activeTab === 'invoices' ? (
        <>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="app-panel__title">Faturas</h2>
            <Button variant="secondary" loading={exporting} onClick={() => void handleExport()}>
              <Download size={16} />Exportar Relatório
            </Button>
          </div>
          <InvoiceFiltersBar
            filters={filters}
            filterResetKey={filterResetKey}
            customerInitialValue={customerFilterLabel}
            activeFilterCount={activeFilterCount}
            onClear={clearFilters}
            updateFilter={updateFilter}
          />

          <div className="billing-page__metrics mb-5">
            <MetricCard label="Saldo aberto" value={formatBRL(summary.openBalance)} tone="primary" />
            <MetricCard label="Faturas filtradas" value={String(summary.count)} />
            <MetricCard label="Pagas" value={String(summary.paidCount)} />
            <MetricCard label="Consolidadas" value={String(summary.consolidatedCount)} />
            <MetricCard label="Vencidas" value={String(summary.overdueCount)} />
          </div>

          <InvoicesTable
            invoices={invoices}
            isLoading={isLoading}
            error={error}
            totalCount={data?.count ?? 0}
            filterDescription={filterDescription}
            emptyState={emptyState}
            emptyAction={activeFilterCount > 0 ? <Button variant="secondary" onClick={clearFilters}>Limpar filtros</Button> : undefined}
            page={filters.page}
            totalPages={totalPages}
            onPageChange={(page) => updateFilter('page', page)}
            onSelectInvoice={(invoiceId) => setSelectedInvoiceId(invoiceId)}
            showCommunication
          />
        </>
      ) : null}

      <InvoiceDetailModal invoiceId={selectedInvoiceId} onClose={closeDetails} />
    </main>
  )
}
