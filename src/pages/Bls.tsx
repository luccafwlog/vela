import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigationType, useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { ChevronDown, ChevronUp, Download, FileText, Upload } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { CopyValue } from '../components/ui/CopyValue'
import { NoValue } from '../components/ui/NoValue'
import { MetricCard } from '../components/ui/MetricCard'
import { Card, EmptyState, PageHeader } from '../components/ui/Card'
import { FilterBar } from '../components/ui/FilterBar'
import { SegmentedControl } from '../components/ui/SegmentedControl'
import { LocalChargesStatus } from '../components/bl/LocalChargesStatus'
import { SkeletonTable } from '../components/ui/Skeleton'
import { CeMercanteImportModal } from '../components/shared/CeMercanteImportModal'
import { BlImportModal } from '../components/shared/BlImportModal'
import { BlDocumentImportModal } from '../components/shared/BlDocumentImportModal'
import { CargoProfileBadge } from '../components/shared/OperationalBadges'
import { BulkActionsBar } from '../components/shared/BulkActionsBar'
import { VoyageCombobox } from '../components/shared/VoyageCombobox'
import { VoyageRail } from '../components/voyages/VoyageRail'
import { toggleRailVoyage, useVoyageRailItems } from '../hooks/useVoyageRailItems'
import { Field, Input, Select } from '../components/ui/Input'
import { TableFooterPagination } from '../components/ui/TableFooterPagination'
import { QueryStateGate } from '../components/shared/QueryStateGate'
import { useToast } from '../components/ui/Toast'
import { useConfirmWithReason } from '../components/ui/ConfirmDialog'
import { useAuth } from '../hooks/useAuth'
import { loadAllPageKeys, useFilteredSelection } from '../hooks/useFilteredSelection'
import { listOperationalBls } from '../services/operationalLists'
import { SelectAllFilteredCheckbox } from '../components/shared/SelectAllFilteredCheckbox'
import { usePageFilters } from '../hooks/usePageFilters'
import { useDebouncedValue } from '../hooks/useDebouncedValue'
import { checkBlDependencies, deleteBls } from '../services/bls'
import { buildDeleteAffected, formatDeleteOutcome } from '../services/deleteDependencies'
import { type BlFilters, fetchAllBls, useBls, useBlSummary, usePortOptions } from '../hooks/useBls'
import { formatBlCargoBadge } from '../lib/blCargoBadge'
import { BlRowDetail } from '../components/bl/BlRowDetail'
import { ActionMenu, type ActionMenuItem } from '../components/ui/ActionMenu'
import { BreakbulkManifestUploadModal } from '../components/bl/BlBreakbulkManifestModal'
import { useNarrowViewport } from '../components/bl/useNarrowViewport'
import { LOCAL_CHARGES_FILTER_OPTIONS, blsSearchFromFilters, filtersFromBlsSearch, rememberBlsListSearch } from './blsListState'
import { describeEmptyState } from '../lib/operationalState'
import { formatPortDisplayName } from '../lib/voyageFormat'
import { afterCargaAlterada } from '../services/cacheEffects'
import type { BLListItem } from '../types/database'
import { userFacingErrorMessage } from '../lib/errors'
import { STALE_PAGE_CLASS } from '../lib/pagination'

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
  customerLink: '',
}

function CustomerCell({ bl }: { bl: BLListItem }) {
  const name = bl.customer?.name ?? null
  if (name) return <span className="app-bl-cell__truncate" title={name}>{name}</span>
  return (
    <>
      <span className="app-bl-cell__truncate app-bl-cell__sub--muted" title={bl.consignee ?? undefined}>{bl.consignee ?? <NoValue label="Sem consignatário" />}</span>
      <span className="app-bl-cell__sub app-bl-cell__sub--warning">Sem cliente vinculado</span>
    </>
  )
}

/** A própria contagem ("2 CNTR") abre a carga embaixo da linha. */
function CargoCell({ bl, expanded, onToggle }: { bl: BLListItem; expanded?: boolean; onToggle?: () => void }) {
  const isImo = Boolean(bl.bl_containers?.some((container) => container.is_imo))
  const isOog = Boolean(bl.bl_containers?.some((container) => container.is_oog))
  const label = formatBlCargoBadge(bl)
  return (
    <span className="app-bl-cell__inline">
      {onToggle ? (
        <button
          type="button"
          className="app-btn app-btn--ghost app-btn--sm tabular-nums"
          aria-expanded={expanded}
          aria-controls={`bl-detail-${bl.id}`}
          aria-label={`${expanded ? 'Recolher' : 'Expandir'} carga do B/L ${bl.id}`}
          onClick={onToggle}
        >
          {label}
          {expanded ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
        </button>
      ) : (
        <span className="tabular-nums">{label}</span>
      )}
      {isImo || isOog ? <CargoProfileBadge isImo={isImo} isOog={isOog} /> : null}
    </span>
  )
}

function vesselText(bl: BLListItem) {
  return bl.voyage?.vessel?.name ?? null
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
  const [deleting, setDeleting] = useState(false)
  // Exclusão recusada pelas dependências: o motivo fica na lista, não só no toast.
  const [deleteBlocked, setDeleteBlocked] = useState<Array<{ id: string; reasons: string[] }> | null>(null)
  // Oito colunas não cabem abaixo de 1024 px sem esconder Carga, CE e Taxas
  // locais atrás da rolagem; ali a lista vira cartões.
  const narrow = useNarrowViewport('(max-width: 1023px)')

  // Filtros, lente e página vivem na URL: voltar da ficha, recarregar ou
  // compartilhar o endereço reabre a mesma lista.
  const { filters, setFilters, updateFilter } = usePageFilters<BlFilters>(filtersFromBlsSearch(searchParams))
  const voyageRail = useVoyageRailItems()

  const [blFreightOpen, setBlFreightOpen] = useState(false)
  const [ceMercanteOpen, setCeMercanteOpen] = useState(false)
  const [breakbulkOpen, setBreakbulkOpen] = useState(false)
  const [blDocumentOpen, setBlDocumentOpen] = useState(false)
  const [exporting, setExporting] = useState(false)
  // Uma linha expandida por vez: estado de visualização, fora da URL.
  const [expandedBlId, setExpandedBlId] = useState<string | null>(null)
  const { showToast } = useToast()

  const listSearch = blsSearchFromFilters(filters)
  // Navegação de fora (link do sino com a lista já aberta, voltar do
  // navegador) substitui os filtros, em vez de ser sobrescrita por eles. Ela é
  // reconhecida pela chave e pelo tipo da navegação, não comparando o texto do
  // endereço: o BrowserRouter aplica cada troca de endereço numa transição, e
  // uma tecla digitada antes dela terminar renderiza com o endereço antigo,
  // que não pode ser tomado por externo (o texto voltaria e a letra sumiria).
  const location = useLocation()
  const navigationType = useNavigationType()
  const seenKey = useRef(location.key)
  useEffect(() => {
    let search = listSearch
    if (location.key !== seenKey.current) {
      seenKey.current = location.key
      // PUSH e POP vêm de fora (sino, voltar do navegador, menu); REPLACE é a
      // própria lista gravando o recorte.
      if (navigationType !== 'REPLACE') {
        const external = filtersFromBlsSearch(searchParams)
        setFilters(external)
        search = blsSearchFromFilters(external)
      }
    }
    // Endereço fora da forma canônica (aberto de fora ou com grafia antiga) é
    // reescrito, e o recorte fica lembrado para o "BLs" da ficha voltar a ele.
    if (search !== searchParams.toString()) setSearchParams(new URLSearchParams(search), { replace: true })
    rememberBlsListSearch(search)
  }, [location.key, navigationType, listSearch, searchParams, setSearchParams, setFilters])

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

  const { data, isLoading, isPlaceholderData, error, fetchStatus, refetch } = useBls(queryFilters)
  // "Selecionar todos" marca o filtro inteiro, em todas as páginas (G1); a
  // seleção atravessa páginas e zera quando o filtro muda.
  const selection = useFilteredSelection<string>({
    scope: { ...queryFilters, page: undefined, pageSize: undefined },
    totalCount: data?.count ?? 0,
    loadAll: () => loadAllPageKeys((page) => listOperationalBls(queryFilters, page, 100), (row) => row.id, { pageSize: 100 }),
  })
  // Filtro trocado: as linhas na tela ainda são do recorte anterior até a
  // resposta chegar. Ficam esmaecidas e sem seleção.
  const stale = isPlaceholderData
  const summaryQuery = useBlSummary(queryFilters)
  const summary = summaryQuery.data
  const { data: portOptions } = usePortOptions()

  const totalPages = Math.max(1, Math.ceil((data?.count ?? 0) / filters.pageSize))

  // Link com ?page= além do total (lista que encolheu, URL antiga): vai para a
  // última página que existe, com replace, em vez de mostrar o vazio inicial.
  const pageOutOfRange = Boolean(data && data.count > 0 && filters.page > totalPages)
  useEffect(() => {
    if (pageOutOfRange) setFilters((current) => ({ ...current, page: totalPages }))
  }, [pageOutOfRange, totalPages, setFilters])

  // Busca, Viagem, POL e POD ficam abertos; os outros quatro vão para "Mais filtros".
  // A lente de modalidade tem controle próprio, sempre visível.
  const isSet = (key: keyof BlFilters) => String(filters[key] ?? '').trim() !== ''
  const moreFilterCount = (['reviewStatus', 'financialStatus', 'chargeStatus', 'cargoProfile', 'customerLink'] as (keyof BlFilters)[]).filter(isSet).length
  const openFilterCount = (['search', 'voyageId', 'pol', 'pod'] as (keyof BlFilters)[]).filter(isSet).length
  const hasAnyFilter = moreFilterCount + openFilterCount > 0 || Boolean(filters.cargoMode)

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

  function toggleChargeFilter(value: 'pending' | 'exempt') {
    updateFilter('chargeStatus', filters.chargeStatus === value ? '' : value)
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

  const importItems: ActionMenuItem[] = [
    { key: 'cntr', label: 'B/L de contêiner (.xlsx)', icon: <Upload size={14} aria-hidden="true" />, onSelect: () => setBlFreightOpen(true) },
    { key: 'avulso', label: 'B/L de carga solta (.pdf, .docx)', icon: <FileText size={14} aria-hidden="true" />, onSelect: () => setBlDocumentOpen(true) },
    { key: 'bb', label: 'Manifesto de carga solta (BB)', icon: <Upload size={14} aria-hidden="true" />, onSelect: () => setBreakbulkOpen(true) },
    { key: 'ce', label: 'CE Mercante', icon: <Upload size={14} aria-hidden="true" />, onSelect: () => setCeMercanteOpen(true) },
  ]

  // Colunas: B/L, Cliente, Navio, Viagem, Trecho, Carga, CE Mercante, Taxas locais (+ seleção do Administrativo).
  const blColumnCount = 8 + (isAdmin ? 1 : 0)
  const blSkeletonTemplate = `${isAdmin ? '40px ' : ''}1.3fr 1.8fr 1.4fr 0.8fr 1.2fr 1fr 1.3fr 1fr`
  const lens = (filters.cargoMode ?? '') as CargoLens

  // Cartões de total do recorte: acompanham filtros e lente. Sem resumo
  // (carregando ou erro), nada de zero falso.
  const metric = (value: number | undefined, digits = 0) => {
    if (summaryQuery.isError) return '—'
    if (value === undefined) return '…'
    return value.toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits })
  }
  const withUnit = (value: string, unit: string) => (
    <>{value} <span className="app-metric-tile__unit">{unit}</span></>
  )
  const chargePending = summary?.chargePending ?? 0

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

      {voyageRail.isLoading ? null : (
        <VoyageRail
          items={voyageRail.items}
          selectedId={filters.voyageId ? Number(filters.voyageId) : null}
          onSelect={(id) => updateFilter('voyageId', toggleRailVoyage(filters.voyageId, id))}
        />
      )}

      <div className="app-metric-row" role="group" aria-label="Totais do recorte">
        <MetricCard label="B/Ls" value={metric(summary?.totalBls)} />
        <MetricCard label="Contêineres" value={metric(summary?.totalDistinctContainers)} />
        <MetricCard label="Volume" value={withUnit(metric(summary?.totalCbm, 1), 'm³')} />
        <MetricCard
          label="Carga solta"
          value={withUnit(metric(summary?.breakbulkWeightTon, 1), 't')}
          detail={summary ? `${metric(summary.totalMachines)} máquinas · ${metric(summary.totalPackages)} packages` : null}
        />
        <MetricCard
          label="Taxas pendentes"
          value={metric(summary?.chargePending)}
          tone={chargePending > 0 ? 'warning' : 'secondary'}
          detail="Toque para filtrar"
          selected={filters.chargeStatus === 'pending'}
          onSelect={() => toggleChargeFilter('pending')}
        />
        <MetricCard
          label="Isentos"
          value={metric(summary?.chargeExempt)}
          detail="Toque para filtrar"
          selected={filters.chargeStatus === 'exempt'}
          onSelect={() => toggleChargeFilter('exempt')}
        />
      </div>
      {summaryQuery.isError ? (
        <p className="app-bl-toolbar__hint" role="alert">
          Totais indisponíveis; aparecem como —.{' '}
          <Button variant="secondary" className="app-btn--sm" onClick={() => void summaryQuery.refetch()}>Tentar novamente</Button>
        </p>
      ) : null}

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
        {openFilterCount > 0 && moreFilterCount === 0 ? (
          <div><Button variant="ghost" onClick={clearFilters}>Limpar filtros</Button></div>
        ) : null}
      </div>

      <FilterBar title="Mais filtros" activeCount={moreFilterCount} onClear={clearFilters}>
        <div className="app-filter-grid">
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
              {LOCAL_CHARGES_FILTER_OPTIONS.map((option) => (
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
          <Field label="Cliente">
            <Select value={filters.customerLink ?? ''} onChange={(event) => updateFilter('customerLink', event.target.value)}>
              <option value="">Todos</option>
              <option value="sem">Sem Cliente vinculado</option>
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
          total={selection.totalCount}
          loadingAll={selection.loadingAll}
          loadError={selection.loadError}
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
        </div>
        <QueryStateGate
          isLoading={false}
          isError={Boolean(error)}
          isPaused={fetchStatus === 'paused'}
          hasData={data !== undefined}
          errorMessage="Não foi possível carregar os B/Ls."
          onRetry={() => void refetch()}
        >
          {isLoading || pageOutOfRange || (stale && data?.rows.length === 0) ? (
            <SkeletonTable rows={8} cols={blColumnCount} columnTemplate={blSkeletonTemplate} label="Carregando B/Ls" />
          ) : data?.rows.length === 0 ? (
            <EmptyState title={emptyState.title} description={emptyState.description} action={emptyAction} />
          ) : narrow ? (
            <ul className={`app-bl-cards${stale ? ` ${STALE_PAGE_CLASS}` : ''}`} aria-label="B/Ls" aria-busy={stale || undefined}>
              {data?.rows.map((bl) => (
                <li key={bl.id} className="app-bl-card" data-bl-card>
                  <div className="app-bl-card__head">
                    {isAdmin ? (
                      <input
                        type="checkbox"
                        className="app-bl-card__check"
                        aria-label={`Selecionar B/L ${bl.id}`}
                        checked={selection.isSelected(bl.id)}
                        disabled={stale}
                        onChange={() => selection.toggle(bl.id)}
                      />
                    ) : null}
                    <div className="app-bl-card__id">
                      <CopyValue value={bl.id} label="número do B/L"><Link className="app-bl-link app-bl-id" to={`/bls/${bl.id}`}>{bl.id}</Link></CopyValue>
                    </div>
                  </div>
                  <div className="app-bl-card__body">
                    <span className="app-bl-cell__stack"><CustomerCell bl={bl} /></span>
                    <span className="app-bl-cell__sub">{vesselText(bl) ?? '—'} / {bl.voyage?.voyage_number ?? '—'} · {routeText(bl)}</span>
                    <span className="app-bl-cell__sub">
                      <CargoCell bl={bl} />
                      {' · CE '}
                      <span className="app-bl-code">{bl.ce_mercante ? <CopyValue value={bl.ce_mercante} label="CE Mercante" /> : <NoValue label="Sem CE Mercante" />}</span>
                    </span>
                    <span className="app-bl-card__status">
                      Taxas locais: <LocalChargesStatus bl={bl as BLListItem & { cancelled_at?: string | null }} />
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className={`app-table-scroll app-table-scroll--sticky${stale ? ` ${STALE_PAGE_CLASS}` : ''}`} aria-busy={stale || undefined}>
              <table className={`app-table app-bl-table${isAdmin ? ' app-bl-table--selectable' : ''}`}>
                <caption className="sr-only">B/Ls do recorte atual</caption>
                <thead>
                  <tr>
                    {isAdmin ? (
                      <th scope="col" className="app-bl-table__check">
                        <SelectAllFilteredCheckbox selection={selection} noun="B/Ls" disabled={stale} />
                      </th>
                    ) : null}
                    <th scope="col" className="app-bl-table__id">B/L</th>
                    <th scope="col" className="app-table__text-head">Cliente</th>
                    <th scope="col" className="app-table__text-head">Navio</th>
                    <th scope="col">Viagem</th>
                    <th scope="col">Trecho</th>
                    <th scope="col">Carga</th>
                    <th scope="col">CE Mercante</th>
                    <th scope="col">Taxas locais</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.rows.map((bl) => {
                    const isExpanded = expandedBlId === bl.id
                    return (
                      <Fragment key={bl.id}>
                        <tr className={isExpanded ? 'app-bl-table__row--open' : undefined}>
                          {isAdmin ? (
                            <td className="app-bl-table__check">
                              <input
                                type="checkbox"
                                aria-label={`Selecionar B/L ${bl.id}`}
                                checked={selection.isSelected(bl.id)}
                                disabled={stale}
                                onChange={() => selection.toggle(bl.id)}
                              />
                            </td>
                          ) : null}
                          <td className="app-bl-table__id">
                            <CopyValue value={bl.id} label="número do B/L"><Link className="app-bl-link app-bl-id" to={`/bls/${bl.id}`}>{bl.id}</Link></CopyValue>
                          </td>
                          <td className="app-table__text"><span className="app-bl-cell__stack"><CustomerCell bl={bl} /></span></td>
                          <td className="app-table__text">
                            {vesselText(bl) ? <span className="app-bl-cell__truncate" title={vesselText(bl) ?? undefined}>{vesselText(bl)}</span> : <NoValue label="Sem navio" />}
                          </td>
                          <td className="whitespace-nowrap">{bl.voyage?.voyage_number ?? <NoValue label="Sem viagem" />}</td>
                          <td className="whitespace-nowrap">{routeText(bl)}</td>
                          <td>
                            <CargoCell bl={bl} expanded={isExpanded} onToggle={() => setExpandedBlId(isExpanded ? null : bl.id)} />
                          </td>
                          <td className="app-bl-code whitespace-nowrap">{bl.ce_mercante ? <CopyValue value={bl.ce_mercante} label="CE Mercante" /> : <NoValue label="Sem CE Mercante" />}</td>
                          <td><LocalChargesStatus bl={bl as BLListItem & { cancelled_at?: string | null }} /></td>
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
          initialVoyageId={filters.voyageId ? Number(filters.voyageId) : undefined}
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
