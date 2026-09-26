import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { ChevronDown, ChevronUp, Copy, Download, ExternalLink, FileText, Loader2, MoreVertical, Trash2, Upload } from 'lucide-react'
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
import { useConfirmWithReason } from '../components/ui/ConfirmDialog'
import { useAuth } from '../hooks/useAuth'
import { useRowSelection } from '../hooks/useRowSelection'
import { usePageFilters } from '../hooks/usePageFilters'
import { useDebouncedValue } from '../hooks/useDebouncedValue'
import { checkBlDependencies, deleteBls } from '../services/bls'
import { buildDeleteAffected, formatBlockedSummary, formatDeleteOutcome } from '../services/deleteDependencies'
import { type BlFilters, fetchAllBls, useBls, useBlSummary, usePortOptions } from '../hooks/useBls'
import { useInvoiceLinks } from '../hooks/useBilling'
import { formatBlCargoBadge } from '../lib/blCargoBadge'
import { BlRowDetail } from '../components/bl/BlRowDetail'
import { describeActiveFilters, describeEmptyState, formatResultCount } from '../lib/operationalState'
import { formatPortDisplayName } from '../lib/voyageFormat'
import {
  hasBlockingRowErrors,
  importBreakbulkManifest,
  parseBreakbulkManifestFile,
  type BreakbulkNumberFormat,
  type ParseBreakbulkOptions,
  type ParsedBreakbulkManifest,
} from '../services/breakbulkImport'
import { afterManifestoImportado } from '../services/cacheEffects'
import { inspectImportUpload } from '../services/importText'
import { rowErrorsToImportIssues } from '../services/importValidation'
import type { InvoiceLinkInfo } from '../services/billing'
import { userFacingErrorMessage } from '../lib/errors'

function InvoiceLink({ links }: { links: InvoiceLinkInfo[] }) {
  if (!links.length) return <span>-</span>
  return (
    <div className="flex flex-col gap-0.5">
      {links.map((link) => (
        <Link
          key={link.id}
          className="text-xs text-[#58a6ff] hover:underline"
          to={`/taxas-locais?invoice=${link.id}`}
        >
          {link.invoice_number ?? `Fat #${link.id}`}
        </Link>
      ))}
    </div>
  )
}

// Colunas fixas da tabela (sem a caixa de seleção, que só existe para admin):
// expandir, No. B/L, CE, Navio/Viagem, CNEE, POL, POD, Carga, Perfil, Taxas,
// Invoice, Ações.
const BASE_BL_COLUMNS = 12

/** Identidade do conjunto de linhas: muda quando o filtro muda. */
function activeFilterKey(filters: BlFilters) {
  return [
    filters.search, filters.voyageId, filters.cargoMode, filters.pol, filters.pod,
    filters.reviewStatus, filters.financialStatus, filters.chargeStatus, filters.cargoProfile,
    filters.pageSize,
  ].join('|')
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
  const confirmWithReason = useConfirmWithReason()
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
  // Uma linha expandida por vez: mantém a página curta e dispensa medir altura
  // de N painéis. É estado de visualização, não de consulta — por isso fica
  // fora de usePageFilters e não entra na URL.
  const [expandedBlId, setExpandedBlId] = useState<string | null>(null)
  const { showToast } = useToast()

  const debouncedSearch = useDebouncedValue(filters.search)
  const queryFilters = useMemo(() => ({
    ...filters,
    search: debouncedSearch,
    page: debouncedSearch === filters.search ? filters.page : 1,
  }), [debouncedSearch, filters])

  // Trocar de página ou de filtro troca as linhas: manter o id expandido
  // reabriria uma linha que não está mais na tela, ou nenhuma.
  const [expandedKey, setExpandedKey] = useState(`${filters.page}:${activeFilterKey(filters)}`)
  const currentKey = `${filters.page}:${activeFilterKey(filters)}`
  if (currentKey !== expandedKey) {
    setExpandedKey(currentKey)
    setExpandedBlId(null)
  }

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
  const actionsMenuRef = useRef<HTMLDivElement | null>(null)
  const actionsItemRefs = useRef<Array<HTMLElement | null>>([])

  function openActionsMenu(id: string, button: HTMLButtonElement) {
    actionsTriggerRef.current = button
    const rect = button.getBoundingClientRect()
    setActionsMenu({
      id,
      top: rect.bottom + 4,
      left: rect.right,
    })
  }

  function focusActionsMenuItem(index: number) {
    const items = actionsItemRefs.current.filter((item): item is HTMLElement => item !== null)
    if (!items.length) return
    items[(index + items.length) % items.length]?.focus()
  }

  function handleActionsMenuKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const items = actionsItemRefs.current.filter((item): item is HTMLElement => item !== null)
    const currentIndex = items.indexOf(document.activeElement as HTMLElement)
    if (currentIndex < 0) return

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      focusActionsMenuItem(currentIndex + 1)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      focusActionsMenuItem(currentIndex - 1)
    } else if (event.key === 'Home') {
      event.preventDefault()
      focusActionsMenuItem(0)
    } else if (event.key === 'End') {
      event.preventDefault()
      focusActionsMenuItem(items.length - 1)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      setActionsMenu(null)
    }
  }

  useEffect(() => {
    if (!actionsMenu) {
      actionsTriggerRef.current?.focus()
      actionsTriggerRef.current = null
      return
    }
    actionsItemRefs.current[0]?.focus()
  }, [actionsMenu])

  useLayoutEffect(() => {
    if (!actionsMenu || !actionsMenuRef.current) return
    const menuRect = actionsMenuRef.current.getBoundingClientRect()
    const maxTop = Math.max(4, window.innerHeight - menuRect.height - 4)
    const top = Math.min(Math.max(actionsMenu.top, 4), maxTop)
    const maxLeft = Math.max(4, window.innerWidth - menuRect.width - 4)
    const actualLeft = Math.min(Math.max(actionsMenu.left - menuRect.width, 4), maxLeft)
    const left = actualLeft + menuRect.width

    if (top !== actionsMenu.top || left !== actionsMenu.left) {
      setActionsMenu({ ...actionsMenu, top, left })
    }
  }, [actionsMenu])

  useEffect(() => {
    if (!actionsMenu) return
    const close = () => setActionsMenu(null)
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    const onPointer = (event: MouseEvent) => {
      const target = event.target as HTMLElement
      if (!target.closest('[data-actions-menu]') && !target.closest('[data-actions-trigger]')) close()
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

      const reason = await confirmWithReason({
        title: 'Excluir B/L',
        message: `Excluir ${report.deletableIds.length} B/L(s)?`,
        affected: buildDeleteAffected('B/L(s)', report),
        consequence: 'Os B/Ls saem das listas, da viagem e da revisão; containers, carga solta, veículos e cálculos de taxa deles são apagados junto.',
        reversibility: 'Não é possível desfazer pelo sistema; o registro apagado fica guardado na auditoria.',
        confirmLabel: 'Excluir',
        tone: 'danger',
      })
      if (reason === null) return

      const result = await deleteBls(report.deletableIds, reason)
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
      const outcome = formatDeleteOutcome('B/L(s)', result)
      showToast(outcome.message, outcome.tone)
    } catch (err) {
      const detail = userFacingErrorMessage(err, 'Não foi possível excluir os B/Ls selecionados.')
      showToast(`Falha ao excluir B/L(s): ${detail}`, 'error')
    } finally {
      setDeleting(false)
    }
  }

  async function copyBlNumber(targetId: string) {
    setActionsMenu(null)
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard indisponível')
      await navigator.clipboard.writeText(targetId)
      showToast(`Número do B/L copiado: ${targetId}`, 'success')
    } catch {
      showToast('Não foi possível copiar o número do B/L.', 'error')
    }
  }

  const pageBlIds = (data?.rows ?? []).map((row) => row.id)
  const allPageSelected = pageBlIds.length > 0 && pageBlIds.every((id) => selection.isSelected(id))
  // Uma constante só: o cabeçalho, o colSpan do estado vazio, o do skeleton e o
  // da linha de detalhe têm de concordar, e antes o número era escrito à mão.
  const blColumnCount = BASE_BL_COLUMNS + (isAdmin ? 1 : 0)
  const blSkeletonTemplate = `${isAdmin ? '44px ' : ''}44px 1.2fr 1.2fr 1.4fr 1.6fr repeat(6, 1fr) 96px`
  const showBreakbulkMetrics = filters.cargoMode !== 'container'

  return (
    <>
      <PageHeader
        title="BLs"
        description="Consulta consolidada de B/Ls de contêiner, carga solta e mistos. Cada B/L registra seu trecho POL/POD, terminal e vincula clientes pela base cadastral."
        action={
          <>
            {canImport ? (
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => setBlFreightOpen(true)}>
                  <Upload size={16} aria-hidden="true" />
                  B/L CNTR
                </Button>
                <Button variant="secondary" onClick={() => setBlDocumentOpen(true)}>
                  <FileText size={16} aria-hidden="true" />
                  B/L Carga Solta
                </Button>
                <Button variant="secondary" onClick={() => setBreakbulkOpen(true)}>
                  <Upload size={16} aria-hidden="true" />
                  Manifesto Carga solta
                </Button>
                <Button variant="secondary" onClick={() => setCeMercanteOpen(true)}>
                  <Upload size={16} aria-hidden="true" />
                  CE Mercante
                </Button>
              </div>
            ) : null}
            <button
              type="button"
              className="app-btn app-btn--ghost app-btn--sm h-10 w-10 shrink-0 p-0"
              aria-label="Exportar B/Ls"
              title="Exportar B/Ls"
              disabled={exporting}
              onClick={() => void handleExport()}
            >
              {exporting ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Download size={16} aria-hidden="true" />}
            </button>
          </>
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
                className={`min-h-10 rounded-md px-3 py-2 font-medium transition-colors sm:min-h-0 sm:py-1 ${
                  active
                    ? 'bg-[#1f6feb] text-white'
                    : 'text-[var(--app-text)] hover:bg-[var(--app-surface-hover,#21262d)]'
                }`}
                aria-pressed={active}
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
          <Field label="Buscar B/L ou cliente">
            <Input
              placeholder="Número do B/L, contêiner, cliente..."
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
        <div className="grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-[repeat(auto-fit,minmax(200px,1fr))]">
          <MetricCard label="Pendentes revisão" value={isSummaryLoading ? '...' : summary?.pendingReview ?? 0} tone="primary" />
          <MetricCard label="BLs filtrados" value={isSummaryLoading ? '...' : summary?.totalBls ?? 0} />
          <MetricCard label="CNTRS" value={isSummaryLoading ? '...' : summary?.totalDistinctContainers ?? 0} />
          <MetricCard
            label="Carga Solta"
            value={isSummaryLoading ? '...' : `${(summary?.breakbulkWeightTon ?? 0).toLocaleString('pt-BR')} ton`}
          />
          {/* Máquinas, volumes e CBM eram calculados pela RPC e descartados sem
              renderizar desde a unificação — eram três das colunas que a tela de
              carga solta tinha. Só aparecem fora da lente de contêiner puro. */}
          {showBreakbulkMetrics ? (
            <>
              <MetricCard label="Máquinas" value={isSummaryLoading ? '...' : (summary?.totalMachines ?? 0).toLocaleString('pt-BR')} />
              <MetricCard label="Total de volumes" value={isSummaryLoading ? '...' : (summary?.totalPackages ?? 0).toLocaleString('pt-BR')} />
              <MetricCard
                label="CBM carga solta"
                value={isSummaryLoading ? '...' : `${(summary?.breakbulkCbm ?? 0).toLocaleString('pt-BR')} m³`}
              />
            </>
          ) : null}
          {/* Cubagem do documento inteiro (contêiner + carga solta), que a
              migration 064 tornou uma soma aditiva. Vinha da RPC e era
              descartada sem renderizar — o mesmo defeito dos três cards acima. */}
          <MetricCard
            label="CBM total"
            value={isSummaryLoading ? '...' : `${(summary?.totalCbm ?? 0).toLocaleString('pt-BR')} m³`}
          />
          <MetricCard label="Sem faturamento" value={isSummaryLoading ? '...' : summary?.pendingFinancial ?? 0} />
          <MetricCard label="Taxas pendentes" value={isSummaryLoading ? '...' : summary?.chargePending ?? 0} />
          <MetricCard label="Faturados" value={isSummaryLoading ? '...' : summary?.chargeReady ?? 0} />
          <MetricCard label="Isentos" value={isSummaryLoading ? '...' : summary?.chargeExempt ?? 0} />
        </div>
        <p className="text-xs text-[var(--app-muted)]">
          As lentes Contêiner e Carga Solta incluem os B/Ls mistos, que participam das duas — por isso
          um B/L misto conta uma vez em “BLs filtrados” e aparece nos dois recortes.
        </p>
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
                <th scope="col" className="w-10 px-3 py-3">
                  <span className="sr-only">Expandir carga</span>
                </th>
                <th scope="col" className="px-3 py-3">No. B/L</th>
                <th scope="col" className="px-3 py-3">CE Mercante</th>
                <th scope="col" className="px-3 py-3">Navio/Viagem</th>
                <th scope="col" className="px-3 py-3">CNEE</th>
                <th scope="col" className="px-3 py-3">POL</th>
                <th scope="col" className="px-3 py-3">POD</th>
                <th scope="col" className="px-3 py-3">Carga</th>
                <th scope="col" className="px-3 py-3">Perfil</th>
                <th scope="col" className="px-3 py-3">Taxas locais</th>
                <th scope="col" className="px-3 py-3">Fatura</th>
                <th scope="col" className="px-3 py-3">Ações</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={blColumnCount} className="p-0">
                    <SkeletonTable rows={8} cols={blColumnCount} columnTemplate={blSkeletonTemplate} label="Carregando B/Ls" />
                  </td>
                </tr>
              ) : null}
              {!isLoading && data?.rows.length === 0 ? (
                <tr>
                  <td colSpan={blColumnCount} className="p-0">
                    <EmptyState
                      title={emptyState.title}
                      description={emptyState.description}
                      action={activeFilterCount > 0
                        ? <Button variant="secondary" onClick={clearFilters}>Limpar filtros</Button>
                        : canImport ? <Button onClick={() => setBlFreightOpen(true)}>Importar B/L CNTR</Button> : undefined}
                    />
                  </td>
                </tr>
              ) : null}
              {data?.rows.map((bl) => {
                const isExpanded = expandedBlId === bl.id
                const detailId = `bl-detail-${bl.id}`
                return (
                <Fragment key={bl.id}>
                <tr className="hover:bg-[#21262d]/60">
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
                  <td className="px-3 py-3">
                    {/* Botão próprio, e não clique na linha: a seleção em massa
                        e o link do B/L continuam intactos. */}
                    <button
                      type="button"
                      className="app-table__icon-button"
                      aria-expanded={isExpanded}
                      aria-controls={detailId}
                      aria-label={`${isExpanded ? 'Recolher' : 'Expandir'} carga do B/L ${bl.id}`}
                      title={isExpanded ? 'Recolher carga' : 'Expandir carga'}
                      onClick={() => setExpandedBlId(isExpanded ? null : bl.id)}
                    >
                      {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </button>
                  </td>
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
                      <button
                        type="button"
                        data-actions-trigger
                        className="app-btn app-btn--secondary p-1 leading-none"
                        aria-label={`Ações para B/L ${bl.id}`}
                        aria-haspopup="menu"
                        aria-expanded={actionsMenu?.id === bl.id}
                        aria-controls="bls-actions-menu"
                        onClick={(e) => {
                          e.stopPropagation()
                          if (actionsMenu?.id === bl.id) {
                            setActionsMenu(null)
                          } else {
                            openActionsMenu(bl.id, e.currentTarget)
                          }
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'ArrowDown') {
                            e.preventDefault()
                            openActionsMenu(bl.id, e.currentTarget)
                          }
                        }}
                      >
                        <MoreVertical size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
                {isExpanded ? <BlRowDetail bl={bl} colSpan={blColumnCount} /> : null}
                </Fragment>
                )
              })}
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
          ref={actionsMenuRef}
          role="menu"
          onKeyDown={handleActionsMenuKeyDown}
          style={{ top: actionsMenu.top, left: actionsMenu.left }}
        >
          <button
            type="button"
            role="menuitem"
            ref={(element) => { actionsItemRefs.current[0] = element }}
            onClick={() => void copyBlNumber(actionsMenu.id)}
          >
            <Copy size={14} />
            <span>Copiar número do B/L</span>
          </button>

          <Link
            role="menuitem"
            ref={(element) => { actionsItemRefs.current[1] = element }}
            to={`/bls/${actionsMenu.id}`}
            onClick={() => setActionsMenu(null)}
          >
            <ExternalLink size={14} />
            <span>Abrir detalhes</span>
          </Link>

          {isAdmin ? (
            <button
              type="button"
              role="menuitem"
              ref={(element) => { actionsItemRefs.current[2] = element }}
              className="app-floating-menu__danger"
              disabled={deleting}
              onClick={() => {
                const targetId = actionsMenu.id
                setActionsMenu(null)
                void runBlDelete([targetId])
              }}
            >
              <Trash2 size={14} />
              <span>Excluir B/L</span>
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
  // 'auto' lê pela evidência do arquivo e BLOQUEIA o que a evidência não
  // resolve; declarar o formato é o que desfaz a ambiguidade de vez. Ver
  // `readNumericColumns` em breakbulkManifestParser.ts.
  const [numberFormat, setNumberFormat] = useState<'auto' | BreakbulkNumberFormat>('auto')
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const { showToast } = useToast()
  const parseOptions = useMemo<ParseBreakbulkOptions>(
    () => (numberFormat === 'auto' ? {} : { numberFormat }),
    [numberFormat],
  )
  const parseManifest = useCallback(
    (file: File) => parseBreakbulkManifestFile(file, parseOptions),
    [parseOptions],
  )

  if (!open) return null

  return (
    <FileImportModal
      title="Importar Manifesto Breakbulk (Carga Solta)"
      accept=".xlsx,.xls,.csv"
      parser={parseManifest}
      reparseKey={numberFormat}
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
        setNumberFormat('auto')
        onClose()
      }}
      canImport={(nextManifest, override) =>
        nextManifest.bls.length > 0 && (!hasBlockingRowErrors(nextManifest.rowErrors) || Boolean(override))
      }
      getIssues={(nextManifest) => rowErrorsToImportIssues(nextManifest.rowErrors)}
      ready={Boolean(voyageId && user)}
      prerequisite={
        <div className="grid gap-3">
          <VoyageCombobox
            required
            label="Viagem de destino"
            selectedVoyageId={voyageId}
            onSelect={(id) => setVoyageId(id == null ? '' : String(id))}
          />
          <Field
            label="Formato numérico do arquivo"
            hint={numberFormat === 'auto'
              ? 'Detectar usa a evidência do próprio arquivo e recusa a linha quando ela não basta — "259.312" pode ser 259 mil ou 259,312. Declarar o formato resolve.'
              : 'A leitura inteira usa este separador decimal. Se o arquivo contradisser, a importação é recusada em vez de corrigir sozinha.'}
          >
            <Select value={numberFormat} onChange={(event) => setNumberFormat(event.target.value as typeof numberFormat)}>
              <option value="auto">Detectar pelo arquivo</option>
              <option value="pt-BR">Vírgula decimal — 259,312 (pt-BR)</option>
              <option value="en-US">Ponto decimal — 259.312 (en-US)</option>
            </Select>
          </Field>
        </div>
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
        setNumberFormat('auto')
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
            (sum, bl) => sum + Number(bl.bb_weight_ton ?? 0),
            0,
          )}
          variant="metric-strip"
        />
        <PreviewBox
          label="CBM (M3)"
          value={manifest.bls.reduce((sum, bl) => sum + Number(bl.bb_cbm ?? 0), 0)}
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
                  <th key={label} scope="col" className={`px-3 py-2 ${['Máquinas', 'Volumes', 'Total de volumes', 'Peso (ton)', 'CBM (M3)'].includes(label) ? 'text-right' : ''}`}>
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
                <td className="px-3 py-2 text-right tabular-nums">{formatBBNumber(bl.bb_machine_qty)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatBBNumber(bl.bb_packages_qty)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatBBNumber(bl.bb_packages_total)}</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {formatBBNumber(bl.bb_weight_ton)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{formatBBNumber(bl.bb_cbm)}</td>
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
