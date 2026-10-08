import { Fragment, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { ChevronDown, ChevronUp, Copy, Download, FileText, MoreVertical, Trash2, Upload } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { MetricCard } from '../components/ui/MetricCard'
import { Card, EmptyState, PageHeader } from '../components/ui/Card'
import { FilterBar } from '../components/ui/FilterBar'
import { SegmentedControl } from '../components/ui/SegmentedControl'
import { SummaryStrip, type SummaryItem } from '../components/ui/SummaryStrip'
import { SkeletonTable } from '../components/ui/Skeleton'
import { CeMercanteImportModal } from '../components/shared/CeMercanteImportModal'
import { BlImportModal } from '../components/shared/BlImportModal'
import { BlDocumentImportModal } from '../components/shared/BlDocumentImportModal'
import { CargoProfileBadge, ChargeStatusBadge } from '../components/shared/OperationalBadges'
import { BulkActionsBar } from '../components/shared/BulkActionsBar'
import { VoyageCombobox } from '../components/shared/VoyageCombobox'
import { Field, Input, Select } from '../components/ui/Input'
import { TableFooterPagination } from '../components/ui/TableFooterPagination'
import { QueryStateGate } from '../components/shared/QueryStateGate'
import { useToast } from '../components/ui/Toast'
import { useConfirmWithReason } from '../components/ui/ConfirmDialog'
import { useAuth } from '../hooks/useAuth'
import { useRowSelection } from '../hooks/useRowSelection'
import { usePageFilters } from '../hooks/usePageFilters'
import { useDebouncedValue } from '../hooks/useDebouncedValue'
import { checkBlDependencies, deleteBls } from '../services/bls'
import { buildDeleteAffected, formatDeleteOutcome } from '../services/deleteDependencies'
import { type BlFilters, fetchAllBls, useBls, useBlSummary, usePortOptions } from '../hooks/useBls'
import { useInvoiceLinks } from '../hooks/useBilling'
import { formatBlCargoBadge } from '../lib/blCargoBadge'
import { BlRowDetail } from '../components/bl/BlRowDetail'
import { ActionMenu, type ActionMenuItem } from '../components/ui/ActionMenu'
import { BreakbulkManifestUploadModal } from '../components/bl/BlBreakbulkManifestModal'
import { useNarrowViewport } from '../components/bl/useNarrowViewport'
import { CHARGE_STATUS_FILTER_OPTIONS, blsSearchFromFilters, filtersFromBlsSearch, rememberBlsListSearch } from './blsListState'
import { describeEmptyState } from '../lib/operationalState'
import { formatPortDisplayName } from '../lib/voyageFormat'
import { afterCargaAlterada } from '../services/cacheEffects'
import type { InvoiceLinkInfo } from '../services/billing'
import type { BLListItem } from '../types/database'
import { userFacingErrorMessage } from '../lib/errors'

type CargoLens = NonNullable<BlFilters['cargoMode']>

const CARGO_LENSES: { value: CargoLens; label: string }[] = [
  { value: '', label: 'Todos' },
  { value: 'container', label: 'Contêiner' },
  { value: 'carga_solta', label: 'Carga solta' },
  { value: 'misto', label: 'Misto' },
]

const EMPTY_FILTERS = {
  search: '',
  voyageId: '',
  cargoMode: '' as CargoLens,
  pol: '',
  pod: '',
  reviewStatus: '',
  financialStatus: '',
  chargeStatus: '',
  cargoProfile: '',
}

function InvoiceLinks({ links }: { links: InvoiceLinkInfo[] }) {
  if (!links.length) return null
  return (
    <span className="app-bl-cell__sub">
      {links.map((link, index) => (
        <Fragment key={link.id}>
          {index > 0 ? ', ' : 'Fatura '}
          <Link className="app-bl-link" to={`/taxas-locais?invoice=${link.id}`}>
            {link.invoice_number ?? `#${link.id}`}
          </Link>
        </Fragment>
      ))}
    </span>
  )
}

function isCancelled(bl: BLListItem) {
  return Boolean((bl as { cancelled_at?: string | null }).cancelled_at)
}

/** Segunda linha do identificador: só o que pede atenção. */
function BlStateNote({ bl }: { bl: BLListItem }) {
  if (isCancelled(bl)) return <span className="app-bl-cell__sub app-bl-cell__sub--muted">Cancelado</span>
  if (bl.review_status === 'pending_review') return <span className="app-bl-cell__sub app-bl-cell__sub--warning">Revisão pendente</span>
  return null
}

function CustomerCell({ bl }: { bl: BLListItem }) {
  const name = bl.customer?.name ?? null
  if (name) return <span className="app-bl-cell__truncate" title={name}>{name}</span>
  return (
    <>
      <span className="app-bl-cell__truncate app-bl-cell__sub--muted" title={bl.consignee ?? undefined}>{bl.consignee ?? '—'}</span>
      <span className="app-bl-cell__sub app-bl-cell__sub--warning">Sem cliente vinculado</span>
    </>
  )
}

function CargoCell({ bl }: { bl: BLListItem }) {
  const isImo = Boolean(bl.bl_containers?.some((container) => container.is_imo))
  const isOog = Boolean(bl.bl_containers?.some((container) => container.is_oog))
  return (
    <span className="app-bl-cell__inline">
      <span className="tabular-nums">{formatBlCargoBadge(bl)}</span>
      {isImo || isOog ? <CargoProfileBadge isImo={isImo} isOog={isOog} /> : null}
    </span>
  )
}

function voyageText(bl: BLListItem) {
  return `${bl.voyage?.vessel?.name ?? '—'} / ${bl.voyage?.voyage_number ?? '—'}`
}

function routeText(bl: BLListItem) {
  return `${bl.pol ?? '—'} → ${bl.pod ?? '—'}`
}

export function Bls() {
  const [searchParams, setSearchParams] = useSearchParams()
  const queryClient = useQueryClient()
  const confirmWithReason = useConfirmWithReason()
  const { isAdmin, user, profile } = useAuth()
  const canImport = Boolean(profile || user)
  const selection = useRowSelection<string>()
  const [deleting, setDeleting] = useState(false)
  // Exclusão recusada pelas dependências: o motivo fica na lista, não só no toast.
  const [deleteBlocked, setDeleteBlocked] = useState<Array<{ id: string; reasons: string[] }> | null>(null)
  const narrow = useNarrowViewport()

  // Filtros, lente e página vivem na URL: voltar da ficha, recarregar ou
  // compartilhar o endereço reabre a mesma lista.
  const { filters, setFilters, updateFilter } = usePageFilters<BlFilters>(filtersFromBlsSearch(searchParams))

  const [blFreightOpen, setBlFreightOpen] = useState(false)
  const [ceMercanteOpen, setCeMercanteOpen] = useState(false)
  const [breakbulkOpen, setBreakbulkOpen] = useState(false)
  const [blDocumentOpen, setBlDocumentOpen] = useState(false)
  const [exporting, setExporting] = useState(false)
  // Uma linha expandida por vez: estado de visualização, fora da URL.
  const [expandedBlId, setExpandedBlId] = useState<string | null>(null)
  const { showToast } = useToast()

  const listSearch = blsSearchFromFilters(filters)
  useEffect(() => {
    if (listSearch !== searchParams.toString()) setSearchParams(new URLSearchParams(listSearch), { replace: true })
    rememberBlsListSearch(listSearch)
  }, [listSearch, searchParams, setSearchParams])

  const debouncedSearch = useDebouncedValue(filters.search)
  const queryFilters = useMemo(() => ({
    ...filters,
    search: debouncedSearch,
    page: debouncedSearch === filters.search ? filters.page : 1,
  }), [debouncedSearch, filters])

  // Trocar de página ou de filtro troca as linhas: a linha aberta deixaria de existir.
  const [expandedKey, setExpandedKey] = useState(listSearch)
  if (listSearch !== expandedKey) {
    setExpandedKey(listSearch)
    setExpandedBlId(null)
  }

  const { data, isLoading, error, fetchStatus, refetch } = useBls(queryFilters)
  const summaryQuery = useBlSummary(queryFilters)
  const summary = summaryQuery.data
  const { data: portOptions } = usePortOptions()
  const blIdsOnPage = useMemo(() => (data?.rows ?? []).map((row) => row.id), [data?.rows])
  const { data: invoiceLinksByBl } = useInvoiceLinks(blIdsOnPage)

  const totalPages = Math.max(1, Math.ceil((data?.count ?? 0) / filters.pageSize))

  // Link com ?page= além do total (lista que encolheu, URL antiga): vai para a
  // última página que existe, com replace, em vez de mostrar o vazio inicial.
  const pageOutOfRange = Boolean(data && data.count > 0 && filters.page > totalPages)
  useEffect(() => {
    if (pageOutOfRange) setFilters((current) => ({ ...current, page: totalPages }))
  }, [pageOutOfRange, totalPages, setFilters])

  // A lente de modalidade não conta como filtro do painel: ela tem controle próprio, sempre visível.
  const panelFilterCount = (
    ['search', 'voyageId', 'pol', 'pod', 'reviewStatus', 'financialStatus', 'chargeStatus', 'cargoProfile'] as (keyof BlFilters)[]
  ).filter((key) => String(filters[key] ?? '').trim() !== '').length
  const hasAnyFilter = panelFilterCount > 0 || Boolean(filters.cargoMode)

  const emptyState = describeEmptyState({
    entitySingular: 'B/L',
    entityPlural: 'B/Ls',
    hasActiveFilters: hasAnyFilter,
    emptyWithoutFilters: 'Nenhum B/L cadastrado ainda.',
    emptyWithFilters: 'Nenhum B/L encontrado.',
  })

  function clearFilters() {
    setFilters((current) => ({ ...current, ...EMPTY_FILTERS, page: 1 }))
  }

  function toggleFilter<K extends 'reviewStatus' | 'financialStatus' | 'chargeStatus'>(key: K, value: string) {
    updateFilter(key, filters[key] === value ? '' : value)
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
    setDeleteBlocked(null)
    try {
      const report = await checkBlDependencies(ids)
      if (report.deletableIds.length === 0) {
        setDeleteBlocked(report.blockedIds)
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
      await afterCargaAlterada(queryClient)
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
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard indisponível')
      await navigator.clipboard.writeText(targetId)
      showToast(`Número do B/L copiado: ${targetId}`, 'success')
    } catch {
      showToast('Não foi possível copiar o número do B/L.', 'error')
    }
  }

  function rowMenuItems(blId: string): ActionMenuItem[] {
    return [
      { key: 'copy', label: 'Copiar número do B/L', icon: <Copy size={14} aria-hidden="true" />, onSelect: () => void copyBlNumber(blId) },
      ...(isAdmin
        ? [{ key: 'delete', label: 'Excluir B/L', icon: <Trash2 size={14} aria-hidden="true" />, danger: true, disabled: deleting, onSelect: () => void runBlDelete([blId]) }]
        : []),
    ]
  }

  const importItems: ActionMenuItem[] = [
    { key: 'cntr', label: 'B/L de contêiner (.xlsx)', icon: <Upload size={14} aria-hidden="true" />, onSelect: () => setBlFreightOpen(true) },
    { key: 'avulso', label: 'B/L de carga solta (.pdf, .docx)', icon: <FileText size={14} aria-hidden="true" />, onSelect: () => setBlDocumentOpen(true) },
    { key: 'bb', label: 'Manifesto de carga solta (BB)', icon: <Upload size={14} aria-hidden="true" />, onSelect: () => setBreakbulkOpen(true) },
    { key: 'ce', label: 'CE Mercante', icon: <Upload size={14} aria-hidden="true" />, onSelect: () => setCeMercanteOpen(true) },
  ]

  const pageBlIds = (data?.rows ?? []).map((row) => row.id)
  const allPageSelected = pageBlIds.length > 0 && pageBlIds.every((id) => selection.isSelected(id))
  // Colunas: B/L, CE, Navio/Viagem, Cliente, Trecho, Carga, Taxas e fatura, ações (+ seleção do Administrativo).
  const blColumnCount = 8 + (isAdmin ? 1 : 0)
  const blSkeletonTemplate = `${isAdmin ? '40px ' : ''}1.3fr 1.2fr 1.4fr 1.6fr 1fr 1fr 1.2fr 80px`
  const lens = (filters.cargoMode ?? '') as CargoLens

  // Faixa de resumo: volumes do recorte. Sem resumo (carregando ou erro), nada de zero falso.
  const summaryValue = (value: number | undefined, unit = '') => {
    if (summaryQuery.isError) return '—'
    if (value === undefined) return '…'
    return `${value.toLocaleString('pt-BR')}${unit}`
  }
  const summaryItems: SummaryItem[] = [
    { label: summary?.totalBls === 1 ? 'B/L' : 'B/Ls', value: summaryValue(summary?.totalBls) },
    ...(lens !== 'carga_solta' ? [{ label: 'CNTRs', value: summaryValue(summary?.totalDistinctContainers) }] : []),
    ...(lens !== 'container'
      ? [
          { label: 'de carga solta', value: summaryValue(summary?.breakbulkWeightTon, ' t') },
          { label: 'máquinas', value: summaryValue(summary?.totalMachines) },
          { label: 'packages', value: summaryValue(summary?.totalPackages) },
        ]
      : []),
    { label: 'no total', value: summaryValue(summary?.totalCbm, ' m³') },
    { label: 'com taxas pendentes', value: summaryValue(summary?.chargePending), tone: summary?.chargePending ? 'warning' : 'default' },
    { label: summary?.chargeExempt === 1 ? 'isento' : 'isentos', value: summaryValue(summary?.chargeExempt) },
  ]
  const metric = (value: number | undefined) => (summaryQuery.isError ? '—' : value === undefined ? '…' : value.toLocaleString('pt-BR'))

  const emptyAction = hasAnyFilter
    ? <Button variant="secondary" onClick={clearFilters}>Limpar filtros</Button>
    : canImport ? <Button onClick={() => setBlFreightOpen(true)}>Importar B/L de contêiner</Button> : undefined

  return (
    <>
      <PageHeader
        title="BLs"
        action={
          <>
            {canImport ? (
              <ActionMenu
                label="Importar"
                menuId="bls-import-menu"
                triggerClassName="app-btn app-btn--secondary"
                trigger={<><Upload size={16} aria-hidden="true" />Importar<ChevronDown size={14} aria-hidden="true" /></>}
                items={importItems}
              />
            ) : null}
            <Button variant="secondary" loading={exporting} loadingLabel="Exportando…" onClick={() => void handleExport()}>
              <Download size={16} aria-hidden="true" />
              Exportar
            </Button>
          </>
        }
      />

      {deleteBlocked?.length ? (
        <div className="app-bl-notice app-bl-notice--warning app-bl-notice--row" role="alert">
          <div>
            <strong>{deleteBlocked.length === 1 ? 'Este B/L não pode ser excluído:' : 'Nenhum destes B/Ls pode ser excluído:'}</strong>
            <ul className="app-bl-notice__list">
              {deleteBlocked.map((item) => (
                <li key={item.id}><span className="font-[var(--app-font-mono)]">{item.id}</span>: {item.reasons.join(', ')}</li>
              ))}
            </ul>
          </div>
          <Button variant="secondary" onClick={() => setDeleteBlocked(null)}>Fechar aviso</Button>
        </div>
      ) : null}

      <div className="app-bl-metrics" role="group" aria-label="Pendências do recorte">
        <MetricCard
          label="Pendentes de revisão"
          value={metric(summary?.pendingReview)}
          tone="primary"
          selected={filters.reviewStatus === 'pending_review'}
          onSelect={() => toggleFilter('reviewStatus', 'pending_review')}
        />
        <MetricCard
          label="Prontos para faturar"
          value={metric(summary?.chargeReady)}
          selected={filters.chargeStatus === 'ready_for_billing'}
          onSelect={() => toggleFilter('chargeStatus', 'ready_for_billing')}
        />
        <MetricCard
          label="Sem faturamento"
          value={metric(summary?.pendingFinancial)}
          selected={filters.financialStatus === 'pending'}
          onSelect={() => toggleFilter('financialStatus', 'pending')}
        />
      </div>

      <FilterBar activeCount={panelFilterCount} onClear={clearFilters}>
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
                <option key={pol} value={pol}>{formatPortDisplayName(pol)}</option>
              ))}
            </Select>
          </Field>
          <Field label="POD">
            <Select value={filters.pod} onChange={(event) => updateFilter('pod', event.target.value)}>
              <option value="">Todos</option>
              {portOptions?.pods.map((pod) => (
                <option key={pod} value={pod}>{formatPortDisplayName(pod)}</option>
              ))}
            </Select>
          </Field>
          <Field label="Revisão">
            <Select value={filters.reviewStatus} onChange={(event) => updateFilter('reviewStatus', event.target.value)}>
              <option value="">Todas</option>
              <option value="pending_review">Pendente</option>
              <option value="reviewed">Revisado</option>
              <option value="ok">Sem pendência</option>
            </Select>
          </Field>
          <Field label="Faturamento">
            <Select value={filters.financialStatus} onChange={(event) => updateFilter('financialStatus', event.target.value)}>
              <option value="">Todos</option>
              <option value="pending">Sem faturamento</option>
              <option value="invoiced">Faturado</option>
              <option value="paid">Pago</option>
              <option value="cancelled">Cancelado</option>
            </Select>
          </Field>
          <Field label="Taxas locais">
            <Select value={filters.chargeStatus} onChange={(event) => updateFilter('chargeStatus', event.target.value)}>
              <option value="">Todas</option>
              {CHARGE_STATUS_FILTER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </Select>
          </Field>
          <Field label="Perfil de carga">
            <Select value={filters.cargoProfile} onChange={(event) => updateFilter('cargoProfile', event.target.value)}>
              <option value="">Todos</option>
              <option value="standard">Padrão</option>
              <option value="oog">OOG</option>
              <option value="imo">IMO</option>
            </Select>
          </Field>
        </div>
      </FilterBar>

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
        <div className="app-bl-toolbar">
          <div className="app-bl-toolbar__lens">
            <SegmentedControl
              label="Modalidade"
              options={CARGO_LENSES}
              value={lens}
              onChange={(value) => updateFilter('cargoMode', value)}
            />
            {lens === 'container' || lens === 'carga_solta' ? (
              <span className="app-bl-toolbar__hint">Inclui os mistos</span>
            ) : null}
          </div>
          <SummaryStrip label="Resumo do recorte" items={summaryItems} />
          {summaryQuery.isError ? (
            <p className="app-bl-toolbar__hint" role="alert">
              Resumo indisponível; os totais aparecem como —.{' '}
              <button type="button" className="app-bl-text-button" onClick={() => void summaryQuery.refetch()}>Tentar novamente</button>
            </p>
          ) : null}
        </div>
        <QueryStateGate
          isLoading={false}
          isError={Boolean(error)}
          isPaused={fetchStatus === 'paused'}
          hasData={data !== undefined}
          errorMessage="Não foi possível carregar os B/Ls."
          onRetry={() => void refetch()}
        >
          {isLoading || pageOutOfRange ? (
            <SkeletonTable rows={8} cols={blColumnCount} columnTemplate={blSkeletonTemplate} label="Carregando B/Ls" />
          ) : data?.rows.length === 0 ? (
            <EmptyState title={emptyState.title} description={emptyState.description} action={emptyAction} />
          ) : narrow ? (
            <ul className="app-bl-cards" aria-label="B/Ls">
              {data?.rows.map((bl) => (
                <li key={bl.id} className="app-bl-card" data-bl-card>
                  <div className="app-bl-card__head">
                    {isAdmin ? (
                      <input
                        type="checkbox"
                        className="app-bl-card__check"
                        aria-label={`Selecionar B/L ${bl.id}`}
                        checked={selection.isSelected(bl.id)}
                        onChange={() => selection.toggle(bl.id)}
                      />
                    ) : null}
                    <div className="app-bl-card__id">
                      <Link className="app-bl-link app-bl-id" to={`/bls/${bl.id}`}>{bl.id}</Link>
                      <BlStateNote bl={bl} />
                    </div>
                    <ActionMenu
                      label={`Ações para B/L ${bl.id}`}
                      menuId={`bl-actions-${bl.id}`}
                      triggerClassName="app-table__icon-button"
                      trigger={<MoreVertical size={16} aria-hidden="true" />}
                      items={rowMenuItems(bl.id)}
                    />
                  </div>
                  <div className="app-bl-card__body">
                    <span className="app-bl-cell__stack"><CustomerCell bl={bl} /></span>
                    <span className="app-bl-cell__sub">{voyageText(bl)} · {routeText(bl)}</span>
                    <span className="app-bl-cell__sub">
                      <CargoCell bl={bl} />
                      {' · CE '}
                      <span className="app-bl-code">{bl.ce_mercante ?? '—'}</span>
                    </span>
                    <span className="app-bl-card__status">
                      <ChargeStatusBadge status={bl.charge_status} />
                      <InvoiceLinks links={invoiceLinksByBl?.[bl.id] ?? []} />
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="app-table-scroll app-table-scroll--sticky">
              <table className={`app-table app-table--sticky-actions app-bl-table${isAdmin ? ' app-bl-table--selectable' : ''}`}>
                <caption className="sr-only">B/Ls do recorte atual</caption>
                <thead>
                  <tr>
                    {isAdmin ? (
                      <th scope="col" className="app-bl-table__check">
                        <input
                          type="checkbox"
                          aria-label="Selecionar todos os B/Ls da página"
                          checked={allPageSelected}
                          onChange={() => selection.toggleMany(pageBlIds)}
                        />
                      </th>
                    ) : null}
                    <th scope="col" className="app-bl-table__id">B/L</th>
                    <th scope="col">CE Mercante</th>
                    <th scope="col">Navio / Viagem</th>
                    <th scope="col">Cliente</th>
                    <th scope="col">Trecho</th>
                    <th scope="col">Carga</th>
                    <th scope="col">Taxas locais e fatura</th>
                    <th scope="col"><span className="sr-only">Ações</span></th>
                  </tr>
                </thead>
                <tbody>
                  {data?.rows.map((bl) => {
                    const isExpanded = expandedBlId === bl.id
                    const detailId = `bl-detail-${bl.id}`
                    return (
                      <Fragment key={bl.id}>
                        <tr className={isExpanded ? 'app-bl-table__row--open' : undefined}>
                          {isAdmin ? (
                            <td className="app-bl-table__check">
                              <input
                                type="checkbox"
                                aria-label={`Selecionar B/L ${bl.id}`}
                                checked={selection.isSelected(bl.id)}
                                onChange={() => selection.toggle(bl.id)}
                              />
                            </td>
                          ) : null}
                          <td className="app-bl-table__id">
                            <span className="app-bl-cell__stack">
                              <Link className="app-bl-link app-bl-id" to={`/bls/${bl.id}`}>{bl.id}</Link>
                              <BlStateNote bl={bl} />
                            </span>
                          </td>
                          <td className="app-bl-code">{bl.ce_mercante ?? <span aria-label="Sem CE Mercante">—</span>}</td>
                          <td><span className="app-bl-cell__truncate" title={voyageText(bl)}>{voyageText(bl)}</span></td>
                          <td><span className="app-bl-cell__stack"><CustomerCell bl={bl} /></span></td>
                          <td className="whitespace-nowrap">{routeText(bl)}</td>
                          <td><CargoCell bl={bl} /></td>
                          <td>
                            <span className="app-bl-cell__stack">
                              <ChargeStatusBadge status={bl.charge_status} />
                              <InvoiceLinks links={invoiceLinksByBl?.[bl.id] ?? []} />
                            </span>
                          </td>
                          <td>
                            <span className="app-bl-row-actions">
                              {/* Única ação secundária visível: compara a carga de vários B/Ls sem sair da lista. */}
                              <button
                                type="button"
                                className="app-table__icon-button"
                                aria-expanded={isExpanded}
                                aria-controls={detailId}
                                aria-label={`${isExpanded ? 'Recolher' : 'Expandir'} carga do B/L ${bl.id}`}
                                title={isExpanded ? 'Recolher carga' : 'Ver carga'}
                                onClick={() => setExpandedBlId(isExpanded ? null : bl.id)}
                              >
                                {isExpanded ? <ChevronUp size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}
                              </button>
                              <ActionMenu
                                label={`Ações para B/L ${bl.id}`}
                                menuId={`bl-actions-${bl.id}`}
                                triggerClassName="app-table__icon-button"
                                trigger={<MoreVertical size={16} aria-hidden="true" />}
                                items={rowMenuItems(bl.id)}
                              />
                            </span>
                          </td>
                        </tr>
                        {isExpanded ? <BlRowDetail bl={bl} colSpan={blColumnCount} /> : null}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
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

      {/* Modais de importação (etapa 04) */}
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

export default Bls
