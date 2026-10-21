import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, Download, FilePlus2 } from 'lucide-react'
import { ConsolidatedInvoiceModal } from '../components/billing/ConsolidatedInvoiceModal'
import { PendingReissuesPanel } from '../components/billing/PendingReissuesPanel'
import { ManualInvoiceModal } from '../components/billing/ManualInvoiceModal'
import { ValidacaoTab } from '../components/billing/ValidacaoTab'
import { FinancialAlertsPanel } from '../components/billing/FinancialAlertsPanel'
import { CodAdjustmentsPanel } from '../components/billing/CodAdjustmentsPanel'
import { InvoiceFiltersBar } from '../components/billing/InvoiceFiltersBar'
import { FILTER_KEYS, type Filters } from '../components/billing/invoiceFilters'
import { InvoicesTable } from '../components/billing/InvoicesTable'
import { InvoiceDetailModal } from '../components/billing/InvoiceDetailModal'
import { Button } from '../components/ui/Button'
import { TabButton } from '../components/ui/TabButton'
import { TabList } from '../components/ui/TabList'
import { PageHeader } from '../components/ui/Card'
import { Block } from '../components/ui/Block'
import { StatusText } from '../components/ui/StatusText'
import { useToast } from '../components/ui/Toast'
import { useAuth } from '../hooks/useAuth'
import { useInvoices } from '../hooks/useBilling'
import { portalInvoicesInOpenBalance } from '../lib/portalInvoiceStatus'
import { resolveLegacyFaturamentoRedirect, toRouteTarget } from '../lib/routeRedirects'
import { listInvoicesForExport } from '../services/billing'
import { exportInvoicesWorkbook } from '../services/exports'
import { listFinancialAlerts } from '../services/alerts'
import { queryKeys } from '../services/queryKeys'
import { describeEmptyState } from '../lib/operationalState'
import { userFacingErrorMessage } from '../lib/errors'
import { formatBRL } from '../lib/utils'
import { VALIDACAO_BL_PARAM, faturasFiltersFromSearch, fromLegacyValidacaoLink, tabFromSearch, withFaturasFilter, withoutFaturasFilters, withTab, withValidacaoBl, type TaxasLocaisTab } from './faturasListState'

export function TaxasLocais() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { user } = useAuth()
  const { showToast } = useToast()

  // A URL é a fonte do recorte: aba, filtros, página e fatura aberta
  // (`faturasListState.ts`). Etapa 12 do plano de faturamento: `?tab=pendencias`
  // cai na Validação com o filtro de cálculo; `?tab=demurrage` vai para /demurrage.
  const filters = useMemo(() => faturasFiltersFromSearch(searchParams), [searchParams])
  const activeTab = tabFromSearch(searchParams)
  const requestedTab = searchParams.get('tab')
  const validacaoInitialBlockCode = requestedTab === 'pendencias' ? 'calculo_incompleto' : undefined
  const selectedInvoiceId = Number(searchParams.get('invoice') ?? '') || null
  const customerFilterLabel = searchParams.get('customerName') ?? ''
  const validacaoBl = searchParams.get(VALIDACAO_BL_PARAM) ?? ''
  const [legacyValidacaoLink] = useState(() => fromLegacyValidacaoLink(searchParams))
  useEffect(() => {
    if (legacyValidacaoLink) setSearchParams(legacyValidacaoLink, { replace: true })
  }, [legacyValidacaoLink, setSearchParams])
  const [filterResetKey, setFilterResetKey] = useState(0)

  const [exporting, setExporting] = useState(false)
  const [consolidatedOpen, setConsolidatedOpen] = useState(false)
  const [manualOpen, setManualOpen] = useState(false)

  const invoicesQuery = useInvoices(filters)
  const { data, isLoading, error } = invoicesQuery

  const financialAlertsQuery = useQuery({
    queryKey: queryKeys.alerts.financial(),
    queryFn: listFinancialAlerts,
    staleTime: 60_000,
  })

  const totalCount = data?.count ?? 0
  const totalPages = Math.max(1, Math.ceil(totalCount / filters.pageSize))
  const invoices = useMemo(() => data?.rows ?? [], [data?.rows])

  // Só a página carregada é conhecida aqui; o rótulo diz isso em vez de
  // apresentar a soma da página como total da carteira.
  // Cada B/L uma vez, como no Portal (ADR 0093, decisão 10): a consolidada
  // aberta da página conta no lugar das individuais que agrupa.
  const pageSummary = useMemo(() => {
    const open = invoices.filter((row) => ['issued', 'partially_paid', 'draft'].includes(row.status ?? 'issued'))
    const counted = portalInvoicesInOpenBalance(open.map((row) => ({
      status: row.status,
      invoice_type: row.invoice_type,
      balance_brl: Number(row.balance_brl ?? 0),
      bls: [...(row.invoice_bls ?? []), ...(row.invoice_receivable_links ?? [])].map((link) => link.bl_id).filter((bl): bl is string => Boolean(bl)),
    })))
    return {
      openCount: open.length,
      openBalance: counted.reduce((sum, row) => sum + Number(row.balance_brl ?? 0), 0),
    }
  }, [invoices])

  // Link com ?page= além do total (recorte que encolheu, URL antiga): vai para
  // a última página que existe em vez de mostrar a lista vazia.
  const pageOutOfRange = Boolean(data && totalCount > 0 && filters.page > totalPages)
  useEffect(() => {
    if (pageOutOfRange) setSearchParams((current) => withFaturasFilter(current, 'page', totalPages), { replace: true })
  }, [pageOutOfRange, totalPages, setSearchParams])

  function update(next: URLSearchParams) {
    setSearchParams(next, { replace: true })
  }

  function updateFilter<K extends keyof Filters>(key: K, value: Filters[K]) {
    update(withFaturasFilter(searchParams, key, value))
  }

  function selectCustomer(customerId: string, customerName: string) {
    const next = withFaturasFilter(searchParams, 'customerId', customerId)
    next.set('customerName', customerName)
    update(next)
  }

  function selectTab(tab: TaxasLocaisTab) {
    setSearchParams(withTab(searchParams, tab))
  }

  function openInvoice(invoiceId: number) {
    const next = new URLSearchParams(searchParams)
    next.set('invoice', String(invoiceId))
    setSearchParams(next)
  }

  function openValidacaoForBl(blId: string) {
    setSearchParams(withValidacaoBl(searchParams, blId))
  }

  function closeDetails() {
    const next = new URLSearchParams(searchParams)
    next.delete('invoice')
    setSearchParams(next)
  }

  const activeFilterCount = FILTER_KEYS.filter((key) => String(filters[key] ?? '').trim() !== '').length
  const emptyState = describeEmptyState({
    entitySingular: 'fatura',
    entityPlural: 'faturas',
    hasActiveFilters: activeFilterCount > 0,
    emptyWithoutFilters: 'Nenhuma fatura emitida ainda. As faturas de Taxas Locais saem sozinhas com o CE Mercante; use Validação para ver o que trava a emissão.',
  })

  function clearFilters() {
    update(withoutFaturasFilters(searchParams))
    setFilterResetKey((key) => key + 1)
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
    } catch (exportError) {
      showToast(userFacingErrorMessage(exportError, 'Falha ao exportar relatório.'), 'error')
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
        action={
          <>
            <Link className="app-btn app-btn--secondary" to="/taxas-locais/tabelas">Tabelas e condições<ArrowRight size={14} aria-hidden="true" /></Link>
            <Button variant="secondary" onClick={() => setManualOpen(true)}><FilePlus2 size={16} />Gerar fatura avulsa</Button>
            <Button onClick={() => setConsolidatedOpen(true)}><FilePlus2 size={16} />Gerar fatura consolidada</Button>
          </>
        }
      />

      <ConsolidatedInvoiceModal open={consolidatedOpen} onClose={() => setConsolidatedOpen(false)} />
      <ManualInvoiceModal open={manualOpen} onClose={() => setManualOpen(false)} />

      <div className="app-fin-stack">
        <FinancialAlertsPanel
          alerts={financialAlertsQuery.data ?? []}
          loading={financialAlertsQuery.isLoading}
          error={Boolean(financialAlertsQuery.error)}
          onOpenInvoice={openInvoice}
          onOpenValidacao={openValidacaoForBl}
        />
        <PendingReissuesPanel onOpenInvoice={openInvoice} />
        <CodAdjustmentsPanel />
      </div>

      <TabList label="Faturamento de Taxas Locais" className="billing-page__tabs">
        <TabButton id="taxas-tab-faturas" controls="taxas-panel" active={activeTab === 'faturas'} label="Faturas" onClick={() => selectTab('faturas')} />
        <TabButton id="taxas-tab-validacao" controls="taxas-panel" active={activeTab === 'validacao'} label="Validação" onClick={() => selectTab('validacao')} />
      </TabList>

      <div id="taxas-panel" role="tabpanel" aria-labelledby={activeTab === 'faturas' ? 'taxas-tab-faturas' : 'taxas-tab-validacao'}>
        {activeTab === 'validacao' ? (
          // A busca da fila só é semeada na montagem; um alerta de outro B/L precisa remontá-la.
          <ValidacaoTab key={`validacao-${validacaoBl}`} userId={user?.id ?? null} initialBlockCode={validacaoInitialBlockCode} initialBlSearch={validacaoBl} />
        ) : (
          <>
            <Block
              title="Faturas"
              headingLevel={2}
              flush
              aside={(
                <>
                  {!isLoading && !error ? (
                    <span>
                      {totalCount === 1 ? '1 fatura' : `${totalCount.toLocaleString('pt-BR')} faturas`}
                      {pageSummary.openBalance > 0 ? (
                        <> · <StatusText tone="warning">{formatBRL(pageSummary.openBalance)} em aberto{totalPages > 1 ? ' nesta página' : ''}</StatusText></>
                      ) : null}
                    </span>
                  ) : null}
                  <Button variant="secondary" className="app-btn--sm" loading={exporting} loadingLabel="Exportando…" disabled={!isLoading && totalCount === 0} onClick={() => void handleExport()}>
                    <Download size={14} aria-hidden="true" />Exportar
                  </Button>
                </>
              )}
            >
              <div className="app-block__body">
                <InvoiceFiltersBar
                  filters={filters}
                  filterResetKey={filterResetKey}
                  customerInitialValue={customerFilterLabel}
                  activeFilterCount={activeFilterCount}
                  onClear={clearFilters}
                  onSelectCustomer={selectCustomer}
                  updateFilter={updateFilter}
                />
              </div>
              <InvoicesTable
                invoices={invoices}
                isLoading={isLoading}
                error={error}
                onRetry={() => void invoicesQuery.refetch?.()}
                totalCount={totalCount}
                emptyState={emptyState}
                emptyAction={activeFilterCount > 0 ? <Button variant="secondary" onClick={clearFilters}>Limpar filtros</Button> : undefined}
                page={filters.page}
                pageSize={filters.pageSize}
                totalPages={totalPages}
                onPageChange={(page) => setSearchParams(withFaturasFilter(searchParams, 'page', page))}
                onSelectInvoice={openInvoice}
              />
            </Block>
          </>
        )}
      </div>

      <InvoiceDetailModal invoiceId={selectedInvoiceId} onClose={closeDetails} />
    </main>
  )
}
