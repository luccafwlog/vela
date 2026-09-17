import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Boxes, Download, Upload, MoreVertical, FileText } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { MetricCard } from '../components/ui/MetricCard'
import { Card, EmptyState, PageHeader } from '../components/ui/Card'
import { FilterBar } from '../components/ui/FilterBar'
import { SkeletonTable } from '../components/ui/Skeleton'
import { CeMercanteImportModal } from '../components/shared/CeMercanteImportModal'
import { BlImportModal } from '../components/shared/BlImportModal'
import { BlDocumentImportModal } from '../components/shared/BlDocumentImportModal'
import { FileImportModal } from '../components/shared/FileImportModal'
import { CargoProfileBadge, ChargeStatusBadge } from '../components/shared/OperationalBadges'
import { BulkActionsBar } from '../components/shared/BulkActionsBar'
import { VoyageCombobox } from '../components/shared/VoyageCombobox'
import { Field, Input, Select } from '../components/ui/Input'
import { TableFooterPagination } from '../components/ui/TableFooterPagination'
import { QueryStateGate } from '../components/shared/QueryStateGate'
import { PreviewBox } from '../components/ui/PreviewBox'
import { TruncationNote } from '../components/shared/TruncationNote'
import { ImportIssuesPanel } from '../components/shared/ImportIssuesPanel'
import { useToast } from '../components/ui/Toast'
import { useConfirm } from '../components/ui/ConfirmDialog'
import { useAuth } from '../hooks/useAuth'
import { useRowSelection } from '../hooks/useRowSelection'
import { usePageFilters } from '../hooks/usePageFilters'
import { useDebouncedValue } from '../hooks/useDebouncedValue'
import { checkBlDependencies, deleteBls } from '../services/bls'
import { formatBlockedSummary } from '../services/deleteDependencies'
import { type BlFilters, fetchAllBls, useBls, useBlSummary, usePortOptions } from '../hooks/useBls'
import { useInvoiceLinks } from '../hooks/useBilling'
import { countDistinctContainerNumbers } from '../lib/containerCounts'
import { describeActiveFilters, describeEmptyState, formatResultCount } from '../lib/operationalState'
import { formatPortDisplayName } from '../lib/voyageFormat'
import { importBreakbulkManifest, parseBreakbulkManifestFile, type ParsedBreakbulkManifest } from '../services/breakbulkImport'
import { afterManifestoImportado } from '../services/cacheEffects'
import { inspectImportUpload } from '../services/importText'
import { rowErrorsToImportIssues } from '../services/importValidation'
import type { InvoiceLinkInfo } from '../services/billing'
import type { BLListItem } from '../types/database'

export function formatBlCargoBadge(bl: BLListItem): string {
  const cntrCount = countDistinctContainerNumbers(bl.bl_containers)
  const bbWeight = bl.bb_weight_ton != null
    ? Number(bl.bb_weight_ton)
    : (bl.total_weight_kg ? Number(bl.total_weight_kg) / 1000 : 0)

  if (bl.cargo_mode === 'misto') {
    const formattedWeight = bbWeight % 1 === 0 ? bbWeight : bbWeight.toFixed(1)
    if (cntrCount > 0 && bbWeight > 0) {
      return `${cntrCount} CNTR + ${formattedWeight} ton`
    }
    if (cntrCount > 0) {
      const itemsCount = bl.bl_breakbulk_items?.length ?? 0
      return `${cntrCount} CNTR + ${itemsCount} ${itemsCount === 1 ? 'item' : 'itens'}`
    }
  }

  if (bl.cargo_mode === 'carga_solta') {
    if (bbWeight > 0) {
      return `${bbWeight % 1 === 0 ? bbWeight : bbWeight.toFixed(1)} ton`
    }
    if (bl.bb_packages_qty) {
      return `${bl.bb_packages_qty} vol`
    }
    return `${bl.bl_breakbulk_items?.length ?? 0} itens`
  }

  return `${cntrCount} CNTR`
}

function InvoiceLink({ links }: { links: InvoiceLinkInfo[] }) {
  if (!links.length) return <span>-</span>
  return (
    <div className="flex flex-col gap-0.5">
      {links.map((link) => (
        <Link
          key={link.id}
          className="text-xs text-[#58a6ff] hover:underline"
          to={`/taxas-locais?invoiceId=${link.id}`}
        >
          {link.invoice_number ?? `Fat #${link.id}`}
        </Link>
      ))}
    </div>
  )
}

type ActionsMenuState = {
  id: string
  top: number
  left: number
} | null

export function Bls() {
  const [searchParams] = useSearchParams()
  const initialVoyage = searchParams.get('voyage') ?? ''
  const initialPol = searchParams.get('pol') ?? ''
  const initialPod = searchParams.get('pod') ?? ''
  const initialMode = (searchParams.get('cargoMode') ?? '') as BlFilters['cargoMode']

  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const { isAdmin, user, profile } = useAuth()
  const canImport = Boolean(profile || user)
  const selection = useRowSelection<string>()
  const [deleting, setDeleting] = useState(false)

  const { filters, setFilters, updateFilter } = usePageFilters<BlFilters>({
    search: '',
    voyageId: initialVoyage,
    cargoMode: initialMode || '',
    pol: initialPol,
    pod: initialPod,
    reviewStatus: '',
    financialStatus: '',
    chargeStatus: '',
    cargoProfile: '',
    page: 1,
    pageSize: 20,
  })

  const [blFreightOpen, setBlFreightOpen] = useState(false)
  const [ceMercanteOpen, setCeMercanteOpen] = useState(false)
  const [breakbulkOpen, setBreakbulkOpen] = useState(false)
  const [blDocumentOpen, setBlDocumentOpen] = useState(false)
  const [exporting, setExporting] = useState(false)
  const { showToast } = useToast()

  const debouncedSearch = useDebouncedValue(filters.search)
  const queryFilters = useMemo(() => ({
    ...filters,
    search: debouncedSearch,
    page: debouncedSearch === filters.search ? filters.page : 1,
  }), [debouncedSearch, filters])

  const { data, isLoading, error, fetchStatus, refetch } = useBls(queryFilters)
  const { data: summary, isLoading: isSummaryLoading } = useBlSummary(queryFilters)
  const { data: portOptions } = usePortOptions()
  const blIdsOnPage = useMemo(() => (data?.rows ?? []).map((row) => row.id), [data?.rows])
  const { data: invoiceLinksByBl } = useInvoiceLinks(blIdsOnPage)

  const totalPages = Math.max(1, Math.ceil((data?.count ?? 0) / filters.pageSize))

  const activeFilterCount = (
    ['search', 'voyageId', 'cargoMode', 'pol', 'pod', 'reviewStatus', 'financialStatus', 'chargeStatus', 'cargoProfile'] as (keyof BlFilters)[]
  ).filter((key) => String(filters[key] ?? '').trim() !== '').length

  const filterDescription = describeActiveFilters([
    { label: 'Texto', value: filters.search },
    { label: 'Viagem', value: filters.voyageId },
    { label: 'Modalidade', value: filters.cargoMode },
    { label: 'POL', value: filters.pol },
    { label: 'POD', value: filters.pod },
    { label: 'Revisão', value: filters.reviewStatus },
    { label: 'Financeiro', value: filters.financialStatus },
    { label: 'Taxas', value: filters.chargeStatus },
    { label: 'Perfil', value: filters.cargoProfile },
  ])

  const emptyState = describeEmptyState({
    entitySingular: 'B/L',
    entityPlural: 'B/Ls',
    hasActiveFilters: activeFilterCount > 0,
    emptyWithoutFilters: 'Nenhum B/L cadastrado ainda.',
    emptyWithFilters: 'Nenhum B/L encontrado.',
  })

  const [actionsMenu, setActionsMenu] = useState<ActionsMenuState>(null)
  const actionsTriggerRef = useRef<HTMLButtonElement | null>(null)
  const actionsItemRef = useRef<HTMLButtonElement | null>(null)

  function openActionsMenu(id: string, button: HTMLButtonElement) {
    actionsTriggerRef.current = button
    const rect = button.getBoundingClientRect()
    setActionsMenu({
      id,
      top: rect.bottom + window.scrollY + 4,
      left: rect.right + window.scrollX - 160,
    })
  }

  useEffect(() => {
    if (!actionsMenu) {
      actionsTriggerRef.current?.focus()
      actionsTriggerRef.current = null
      return
    }
    actionsItemRef.current?.focus()
  }, [actionsMenu])

  useEffect(() => {
    if (!actionsMenu) return
    const close = () => setActionsMenu(null)
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    const onPointer = (event: MouseEvent) => {
      const target = event.target as HTMLElement
      if (!target.closest('[data-actions-menu]')) close()
    }
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onPointer)
    return () => {
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onPointer)
    }
  }, [actionsMenu])

  function clearFilters() {
    setFilters((current) => ({
      ...current,
      search: '',
      voyageId: '',
      cargoMode: '',
      pol: '',
      pod: '',
      reviewStatus: '',
      financialStatus: '',
      chargeStatus: '',
      cargoProfile: '',
      page: 1,
    }))
  }

  async function handleExport() {
    setExporting(true)
    try {
      const rows = await fetchAllBls(filters)
      if (!rows.length) {
        showToast('Nenhum B/L encontrado para exportar com os filtros atuais.', 'info')
        return
      }

      const { exportManifestWorkbook } = await import('../services/exports')
      await exportManifestWorkbook(rows)
      showToast(`Exportação concluída com ${rows.length} B/L(s).`, 'success')
    } catch {
      showToast('Falha ao exportar B/Ls.', 'error')
    } finally {
      setExporting(false)
    }
  }

  async function runBlDelete(ids: string[]) {
    setDeleting(true)
    try {
      const report = await checkBlDependencies(ids)
      if (report.deletableIds.length === 0) {
        showToast(`Nenhum B/L pode ser excluído. ${formatBlockedSummary(report.blockedIds)}`, 'error')
        return
      }

      const parts = [
        `Excluir ${report.deletableIds.length} B/L(s)? Containers, carga solta e veículos vinculados serão excluídos junto. Esta ação é irreversível.`,
      ]
      if (report.blockedIds.length) parts.push(formatBlockedSummary(report.blockedIds))
      const ok = await confirm({ message: parts.join('\n\n'), tone: 'danger', confirmLabel: 'Excluir' })
      if (!ok) return

      await deleteBls(report.deletableIds, user?.id)
      selection.clear()
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['bls'] }),
        queryClient.invalidateQueries({ queryKey: ['bl-summary'] }),
        queryClient.invalidateQueries({ queryKey: ['containers'] }),
        queryClient.invalidateQueries({ queryKey: ['vehicles'] }),
        queryClient.invalidateQueries({ queryKey: ['invoice-links'] }),
        queryClient.invalidateQueries({ queryKey: ['voyages'] }),
        queryClient.invalidateQueries({ queryKey: ['baplie-reconciliation'] }),
      ])
      showToast(`${report.deletableIds.length} B/L(s) excluído(s).`, 'success')
    } catch (err) {
      const detail = err instanceof Error ? err.message : 'erro desconhecido'
      showToast(`Falha ao excluir B/L(s): ${detail}`, 'error')
    } finally {
      setDeleting(false)
    }
  }

  const pageBlIds = (data?.rows ?? []).map((row) => row.id)
  const allPageSelected = pageBlIds.length > 0 && pageBlIds.every((id) => selection.isSelected(id))
  const blColumnCount = isAdmin ? 12 : 11

  return (
    <>
      <PageHeader
        title="BLs"
        description="Consulta consolidada de B/Ls de contêiner, carga solta e mistos. Cada B/L registra seu trecho POL/POD, terminal e vincula clientes pela base cadastral."
        action={
          <div className="flex flex-wrap justify-end gap-2">
            <Link
              className="app-btn app-btn--secondary"
              to={filters.voyageId ? `/containers?voyage=${filters.voyageId}` : '/containers'}
            >
              <Boxes size={16} />
              Containers
            </Link>
            <Button variant="secondary" loading={exporting} onClick={handleExport}>
              <Download size={16} />
              Exportar
            </Button>
            {canImport ? (
              <>
                <Button variant="secondary" onClick={() => setCeMercanteOpen(true)}>
                  <Upload size={16} />
                  Importar CE Mercante
                </Button>
                <Button variant="secondary" onClick={() => setBlFreightOpen(true)}>
                  <Upload size={16} />
                  Importar B/L
                </Button>
                <Button variant="secondary" onClick={() => setBreakbulkOpen(true)}>
                  <Upload size={16} />
                  Manifesto Carga Solta
                </Button>
                <Button variant="secondary" onClick={() => setBlDocumentOpen(true)}>
                  <FileText size={16} />
                  Importar Documento
                </Button>
              </>
            ) : null}
          </div>
        }
      />

      {/* Filtro Rápido de Modalidade */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-[var(--app-muted)]">Modalidade:</span>
        <div className="inline-flex rounded-lg border border-[var(--app-border)] bg-[var(--app-surface)] p-0.5 text-xs">
          {[
            { label: 'Todos', value: '' },
            { label: 'Contêiner', value: 'container' },
            { label: 'Carga Solta', value: 'carga_solta' },
            { label: 'Misto', value: 'misto' },
          ].map((mode) => {
            const active = (filters.cargoMode ?? '') === mode.value
            return (
              <button
                key={mode.value}
                type="button"
                className={`rounded-md px-3 py-1 font-medium transition-colors ${
                  active
                    ? 'bg-[#1f6feb] text-white'
                    : 'text-[var(--app-text)] hover:bg-[var(--app-surface-hover,#21262d)]'
                }`}
                onClick={() => updateFilter('cargoMode', mode.value as BlFilters['cargoMode'])}
              >
                {mode.label}
              </button>
            )
          })}
        </div>
      </div>

      <FilterBar activeCount={activeFilterCount} onClear={clearFilters}>
        <div className="app-filter-grid">
          <Field label="Texto livre">
            <Input
              placeholder="B/L ou cliente"
              value={filters.search}
              onChange={(event) => updateFilter('search', event.target.value)}
            />
          </Field>
          <VoyageCombobox
            clearable
            label="Viagem"
            selectedVoyageId={filters.voyageId}
            onSelect={(id) => updateFilter('voyageId', id == null ? '' : String(id))}
          />
          <Field label="POL">
            <Select value={filters.pol} onChange={(event) => updateFilter('pol', event.target.value)}>
              <option value="">Todos</option>
              {portOptions?.pols.map((pol) => (
                <option key={pol} value={pol}>
                  {formatPortDisplayName(pol)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="POD">
            <Select value={filters.pod} onChange={(event) => updateFilter('pod', event.target.value)}>
              <option value="">Todos</option>
              {portOptions?.pods.map((pod) => (
                <option key={pod} value={pod}>
                  {formatPortDisplayName(pod)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Status revisão">
            <Select value={filters.reviewStatus} onChange={(event) => updateFilter('reviewStatus', event.target.value)}>
              <option value="">Todos</option>
              <option value="ok">OK</option>
              <option value="pending_review">Pendente</option>
              <option value="reviewed">Revisado</option>
            </Select>
          </Field>
          <Field label="Status financeiro">
            <Select
              value={filters.financialStatus}
              onChange={(event) => updateFilter('financialStatus', event.target.value)}
            >
              <option value="">Todos</option>
              <option value="pending">Pendente</option>
              <option value="invoiced">Faturado</option>
              <option value="paid">Pago</option>
              <option value="cancelled">Cancelado</option>
            </Select>
          </Field>
          <Field label="Status taxas locais">
            <Select value={filters.chargeStatus} onChange={(event) => updateFilter('chargeStatus', event.target.value)}>
              <option value="">Todos</option>
              <option value="review_required">Revisão</option>
              <option value="exempt">Isento</option>
              <option value="ready_for_billing">Faturado</option>
            </Select>
          </Field>
          <Field label="Perfil de carga">
            <Select value={filters.cargoProfile} onChange={(event) => updateFilter('cargoProfile', event.target.value)}>
              <option value="">Todos</option>
              <option value="standard">Standard</option>
              <option value="oog">OOG</option>
              <option value="imo">IMO</option>
            </Select>
          </Field>
        </div>
      </FilterBar>

      <div className="mb-5 flex flex-col gap-4">
        <div>
          <MetricCard label="Pendentes revisão" value={isSummaryLoading ? '...' : summary?.pendingReview ?? 0} tone="primary" />
        </div>
        <div className="grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-[repeat(auto-fit,minmax(200px,1fr))]">
          <MetricCard label="BLs filtrados" value={isSummaryLoading ? '...' : summary?.totalBls ?? 0} />
          <MetricCard label="CNTRS" value={isSummaryLoading ? '...' : summary?.totalDistinctContainers ?? 0} />
          <MetricCard
            label="Carga Solta"
            value={isSummaryLoading ? '...' : `${(summary?.totalWeightTon ?? 0).toLocaleString('pt-BR')} ton`}
          />
          <MetricCard label="Sem faturamento" value={isSummaryLoading ? '...' : summary?.pendingFinancial ?? 0} />
          <MetricCard label="Taxas pendentes" value={isSummaryLoading ? '...' : summary?.chargePending ?? 0} />
          <MetricCard label="Faturados" value={isSummaryLoading ? '...' : summary?.chargeReady ?? 0} />
          <MetricCard label="Isentos" value={isSummaryLoading ? '...' : summary?.chargeExempt ?? 0} />
        </div>
      </div>

      {isAdmin ? (
        <BulkActionsBar
          count={selection.count}
          onClear={selection.clear}
          onDelete={() => runBlDelete([...selection.selected])}
          deleting={deleting}
          noun={['B/L', 'B/Ls']}
        />
      ) : null}

      <Card className="overflow-hidden p-0">
        <div className="flex flex-col gap-1 border-b border-[#30363d] px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
          <span className="font-semibold text-white">{formatResultCount(data?.count ?? 0, 'B/L retornado', 'B/Ls retornados')}</span>
          <span className="text-xs text-slate-400">{filterDescription}</span>
        </div>
        <QueryStateGate
          isLoading={false}
          isError={Boolean(error)}
          isPaused={fetchStatus === 'paused'}
          hasData={data !== undefined}
          errorMessage="Erro ao carregar BLs."
          onRetry={() => void refetch()}
        >
        <div className="app-table-scroll app-table-scroll--sticky">
          <table className="app-table app-table--compact app-table--sticky-actions min-w-[920px] text-left text-sm whitespace-nowrap">
            <caption className="sr-only">Tabela de BLs filtrados</caption>
            <thead>
              <tr>
                {isAdmin ? (
                  <th scope="col" className="w-10 px-3 py-3">
                    <input
                      type="checkbox"
                      aria-label="Selecionar todos os B/Ls da pagina"
                      checked={allPageSelected}
                      onChange={() => selection.toggleMany(pageBlIds)}
                    />
                  </th>
                ) : null}
                <th scope="col" className="px-3 py-3">No. B/L</th>
                <th scope="col" className="px-3 py-3">CE Mercante</th>
                <th scope="col" className="px-3 py-3">Navio/Viagem</th>
                <th scope="col" className="px-3 py-3">CNEE</th>
                <th scope="col" className="px-3 py-3">POL</th>
                <th scope="col" className="px-3 py-3">POD</th>
                <th scope="col" className="px-3 py-3">Carga</th>
                <th scope="col" className="px-3 py-3">Perfil</th>
                <th scope="col" className="px-3 py-3">Taxas locais</th>
                <th scope="col" className="px-3 py-3">Invoice</th>
                <th scope="col" className="px-3 py-3">Ações</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={blColumnCount} className="p-0">
                    <SkeletonTable rows={8} cols={6} />
                  </td>
                </tr>
              ) : null}
              {!isLoading && data?.rows.length === 0 ? (
                <tr>
                  <td colSpan={blColumnCount} className="p-0">
                    <EmptyState title={emptyState.title} description={emptyState.description} />
                  </td>
                </tr>
              ) : null}
              {data?.rows.map((bl) => (
                <tr key={bl.id} className="hover:bg-[#21262d]/60">
                  {isAdmin ? (
                    <td className="px-3 py-3">
                      <input
                        type="checkbox"
                        aria-label={`Selecionar B/L ${bl.id}`}
                        checked={selection.isSelected(bl.id)}
                        onChange={() => selection.toggle(bl.id)}
                      />
                    </td>
                  ) : null}
                  <td className="px-3 py-3 font-semibold">
                    <Link className="text-[#58a6ff] hover:underline" to={`/bls/${bl.id}`}>
                      {bl.id}
                    </Link>
                  </td>
                  <td className="px-3 py-3">{bl.ce_mercante ?? '-'}</td>
                  <td className="px-3 py-3">
                    <span
                      className="app-table__truncate app-table__truncate--sm"
                      title={`${bl.voyage?.vessel?.name ?? '-'} / ${bl.voyage?.voyage_number ?? '-'}`}
                    >
                      {bl.voyage?.vessel?.name ?? '-'} / {bl.voyage?.voyage_number ?? '-'}
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    <span
                      className="app-table__truncate app-table__truncate--sm"
                      title={bl.customer?.name ?? bl.consignee ?? '-'}
                    >
                      {bl.customer?.name ?? bl.consignee ?? '-'}
                    </span>
                  </td>
                  <td className="px-3 py-3">{bl.pol ?? '-'}</td>
                  <td className="px-3 py-3">{bl.pod ?? '-'}</td>
                  <td className="px-3 py-3 font-medium text-slate-200">
                    {formatBlCargoBadge(bl)}
                  </td>
                  <td className="px-3 py-3">
                    <CargoProfileBadge
                      isImo={Boolean(bl.bl_containers?.some((container) => container.is_imo))}
                      isOog={Boolean(bl.bl_containers?.some((container) => container.is_oog))}
                    />
                  </td>
                  <td className="px-3 py-3">
                    <ChargeStatusBadge status={bl.charge_status} />
                  </td>
                  <td className="px-3 py-3">
                    <InvoiceLink links={invoiceLinksByBl?.[bl.id] ?? []} />
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-2">
                      <Link
                        className="app-table__action"
                        to={`/bls/${bl.id}`}
                      >
                        Abrir B/L
                      </Link>
                      {isAdmin ? (
                        <button
                          type="button"
                          className="app-btn app-btn--secondary p-1 leading-none"
                          aria-label={`Ações para B/L ${bl.id}`}
                          aria-haspopup="menu"
                          aria-expanded={actionsMenu?.id === bl.id}
                          aria-controls="bls-actions-menu"
                          onClick={(e) => openActionsMenu(bl.id, e.currentTarget)}
                          onKeyDown={(e) => {
                            if (e.key === 'ArrowDown') {
                              e.preventDefault()
                              openActionsMenu(bl.id, e.currentTarget)
                            }
                          }}
                        >
                          <MoreVertical size={15} />
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </QueryStateGate>

        {data && totalPages > 1 ? (
          <TableFooterPagination
            page={filters.page}
            pageSize={filters.pageSize}
            totalCount={data?.count ?? 0}
            totalPages={totalPages}
            countLabel={`${data?.count ?? 0} B/Ls`}
            onPageChange={(page) => updateFilter('page', page)}
            onPageSizeChange={(pageSize) => updateFilter('pageSize', pageSize)}
          />
        ) : null}
      </Card>

      {actionsMenu ? (
        <div
          data-actions-menu
          id="bls-actions-menu"
          className="app-floating-menu"
          role="menu"
          style={{ top: actionsMenu.top, left: actionsMenu.left }}
        >
          {isAdmin ? (
            <button
              type="button"
              role="menuitem"
              ref={actionsItemRef}
              className="app-floating-menu__danger"
              disabled={deleting}
              onClick={() => {
                const targetId = actionsMenu.id
                setActionsMenu(null)
                void runBlDelete([targetId])
              }}
            >
              Excluir B/L
            </button>
          ) : null}
        </div>
      ) : null}

      {/* Modais de Importação */}
      {blFreightOpen ? (
        <BlImportModal
          open={blFreightOpen}
          onClose={() => setBlFreightOpen(false)}
          voyageId={filters.voyageId ? Number(filters.voyageId) : undefined}
        />
      ) : null}

      {ceMercanteOpen ? (
        <CeMercanteImportModal
          open={ceMercanteOpen}
          onClose={() => setCeMercanteOpen(false)}
          lockedVoyageId={filters.voyageId ? Number(filters.voyageId) : undefined}
        />
      ) : null}

      {breakbulkOpen ? (
        <BreakbulkManifestUploadModal
          open={breakbulkOpen}
          onClose={() => setBreakbulkOpen(false)}
          defaultVoyageId={filters.voyageId}
        />
      ) : null}

      {blDocumentOpen ? (
        <BlDocumentImportModal
          onClose={() => setBlDocumentOpen(false)}
          voyageId={filters.voyageId ? Number(filters.voyageId) : undefined}
        />
      ) : null}
    </>
  )
}

function BreakbulkManifestUploadModal({
  open,
  onClose,
  defaultVoyageId,
}: {
  open: boolean
  onClose: () => void
  defaultVoyageId?: string
}) {
  const [voyageId, setVoyageId] = useState(defaultVoyageId ?? '')
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const { showToast } = useToast()

  if (!open) return null

  return (
    <FileImportModal
      title="Importar Manifesto Breakbulk (Carga Solta)"
      accept=".xlsx,.xls,.csv"
      parser={parseBreakbulkManifestFile}
      inspectFile={inspectImportUpload}
      importer={async (nextManifest, file, override) => {
        if (!user || !voyageId) return
        await importBreakbulkManifest({
          filename: file.name,
          voyageId: Number(voyageId),
          manifest: nextManifest,
          uploadedBy: user.id,
          allowRowErrors: Boolean(override),
        })
        await afterManifestoImportado(queryClient, { voyageId })
        showToast('Manifesto de carga solta importado com sucesso.', 'success')
        setVoyageId('')
        onClose()
      }}
      canImport={(nextManifest, override) =>
        nextManifest.bls.length > 0 && (nextManifest.rowErrors.length === 0 || Boolean(override))
      }
      getIssues={(nextManifest) => rowErrorsToImportIssues(nextManifest.rowErrors)}
      ready={Boolean(voyageId && user)}
      prerequisite={
        <VoyageCombobox
          required
          label="Viagem de destino"
          selectedVoyageId={voyageId}
          onSelect={(id) => setVoyageId(id == null ? '' : String(id))}
        />
      }
      renderPreview={(nextManifest) => <BreakbulkPreview manifest={nextManifest} />}
      helper={
        <div className="app-panel app-panel--padded text-sm">
          <div className="app-panel__title">Estrutura obrigatória da planilha</div>
          <div className="mt-2">BL, CE, MAQUINAS, PACKAGES, PACKAGES TOTAL, WEIGHT (TON), CBM (M3), SHIPPER, CONSIGNEE, NOTIFY.</div>
          <div className="app-panel__meta mt-2">Colunas opcionais: CNPJ, POL, POD.</div>
          <div className="mt-3 flex flex-wrap gap-2">
            <a className="app-btn app-btn--secondary" href="/templates/carga-solta-modelo.xlsx" download="carga-solta-modelo.xlsx">
              <Download size={16} />Baixar modelo .xlsx
            </a>
            <a className="app-btn app-btn--secondary" href="/templates/carga-solta-modelo.csv" download="carga-solta-modelo.csv">
              <Download size={16} />Baixar modelo .csv
            </a>
          </div>
        </div>
      }
      onClose={() => {
        setVoyageId('')
        onClose()
      }}
    />
  )
}

function BreakbulkPreview({ manifest }: { manifest: ParsedBreakbulkManifest }) {
  return (
    <div className="grid gap-4">
      <div className="grid gap-3 grid-cols-[repeat(auto-fit,minmax(150px,1fr))]">
        <PreviewBox label="B/Ls válidos" value={manifest.bls.length} variant="metric-strip" />
        <PreviewBox
          label="Máquinas"
          value={manifest.bls.reduce((sum, bl) => sum + Number(bl.bb_machine_qty ?? 0), 0)}
          variant="metric-strip"
        />
        <PreviewBox
          label="Total de volumes"
          value={manifest.bls.reduce((sum, bl) => sum + Number(bl.bb_packages_total ?? bl.bb_packages_qty ?? 0), 0)}
          variant="metric-strip"
        />
        <PreviewBox
          label="Peso (ton)"
          value={manifest.bls.reduce(
            (sum, bl) => sum + Number(bl.bb_weight_ton ?? (bl.total_weight_kg ? bl.total_weight_kg / 1000 : 0)),
            0,
          )}
          variant="metric-strip"
        />
        <PreviewBox
          label="CBM (M3)"
          value={manifest.bls.reduce((sum, bl) => sum + Number(bl.total_cbm ?? 0), 0)}
          variant="metric-strip"
        />
        <PreviewBox label="Erros de parser" value={manifest.rowErrors.length} variant="metric-strip" />
      </div>
      <div className="app-table-scroll max-h-72 rounded-xl border border-[var(--app-border)]">
        <table className="app-table app-table--compact min-w-[1220px] text-left text-sm whitespace-nowrap">
          <thead>
            <tr>
              {['BL', 'CE', 'Máquinas', 'Volumes', 'Total de volumes', 'Peso (ton)', 'CBM (M3)', 'Shipper', 'Consignee', 'Notify'].map(
                (label) => (
                  <th key={label} scope="col" className="px-3 py-2">
                    {label}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {manifest.bls.slice(0, 25).map((bl) => (
              <tr key={bl.bl_id}>
                <td className="px-3 py-2 font-semibold text-[var(--app-text-strong)]">{bl.bl_id}</td>
                <td className="px-3 py-2">{bl.ce_mercante ?? '-'}</td>
                <td className="px-3 py-2">{formatBBNumber(bl.bb_machine_qty)}</td>
                <td className="px-3 py-2">{formatBBNumber(bl.bb_packages_qty)}</td>
                <td className="px-3 py-2">{formatBBNumber(bl.bb_packages_total)}</td>
                <td className="px-3 py-2">
                  {formatBBNumber(bl.bb_weight_ton ?? (bl.total_weight_kg ? bl.total_weight_kg / 1000 : null))}
                </td>
                <td className="px-3 py-2">{formatBBNumber(bl.total_cbm)}</td>
                <td className="px-3 py-2">{bl.shipper ?? '-'}</td>
                <td className="px-3 py-2">{bl.consignee ?? '-'}</td>
                <td className="px-3 py-2">{bl.notify_party ?? '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <TruncationNote shown={25} total={manifest.bls.length} noun="B/L" nounPlural="B/Ls" />
      <ImportIssuesPanel issues={rowErrorsToImportIssues(manifest.rowErrors)} filename="manifesto-bb-issues.csv" />
    </div>
  )
}

function formatBBNumber(value: number | null | undefined) {
  if (value === null || value === undefined) return '-'
  return Number(value).toLocaleString('pt-BR')
}

export default Bls
