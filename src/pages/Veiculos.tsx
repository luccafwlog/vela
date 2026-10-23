import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { afterCargaAlterada } from '../services/cacheEffects'
import { Download, MapPin, Upload } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { CopyValue } from '../components/ui/CopyValue'
import { NoValue } from '../components/ui/NoValue'
import { Card, EmptyState, PageHeader } from '../components/ui/Card'
import { Block } from '../components/ui/Block'
import { ChoiceCards } from '../components/ui/ChoiceCards'
import { MetricCard } from '../components/ui/MetricCard'
import { StatusText } from '../components/ui/StatusText'
import { FilterBar } from '../components/ui/FilterBar'
import { Field, Input, Select } from '../components/ui/Input'
import { TableFooterPagination } from '../components/ui/TableFooterPagination'
import { SkeletonTable } from '../components/ui/Skeleton'
import { Modal } from '../components/ui/Modal'
import { useToast } from '../components/ui/Toast'
import { useConfirm, useConfirmWithReason } from '../components/ui/ConfirmDialog'
import { BulkActionsBar } from '../components/shared/BulkActionsBar'
import { VehicleImportModal } from '../components/shared/VehicleImportModal'
import { VoyageCombobox } from '../components/shared/VoyageCombobox'
import { ImportNotice } from '../components/shared/ImportParts'
import { plural } from '../components/shared/importPresentation'
import { useNarrowViewport } from '../components/bl/useNarrowViewport'
import { useAuth } from '../hooks/useAuth'
import { useVoyages } from '../hooks/useBls'
import { useVoyageRailDivergences } from '../hooks/useVoyageReconciliation'
import { useFilteredSelection } from '../hooks/useFilteredSelection'
import { SelectAllFilteredCheckbox } from '../components/shared/SelectAllFilteredCheckbox'
import { usePageFilters } from '../hooks/usePageFilters'
import { useDebouncedValue } from '../hooks/useDebouncedValue'
import { STALE_PAGE_CLASS } from '../lib/pagination'
import { UNPACKING_LOCATION_NONE, cacheUnpackingLocation, useVehicleOptions, useVehicles, useVoyageVehicleStats, type VehiclePageFilters } from '../hooks/useVehicles'
import { deleteVehicles } from '../services/vehicles'
import { MoveVehiclesModal } from '../components/vehicles/MoveVehiclesModal'
import { formatDeleteOutcome } from '../services/deleteDependencies'
import { userFacingErrorMessage } from '../lib/errors'
import { findUnpackingReplacements, setContainerUnpackingLocation } from '../services/vaziosNatureza'
import { exportVehicleWorkbook } from '../services/exports'
import { listVoyageEscalaSchedulesByVoyageIds } from '../services/voyageRouteSchedules'
import { buildVoyageRailItems, type VoyageRailModuleStats } from '../services/voyageSummaries'
import { VoyageRail } from '../components/voyages/VoyageRail'
import { isMissingLabel } from './veiculosPresentation'

type DesovaScope = 'selected' | 'all' | 'missing'

/** Local de desova como dado: "Sem local" em âmbar pede ação (regra 5). */
function DesovaText({ value, hasContainer }: { value: string | null | undefined; hasContainer: boolean }) {
  if (!hasContainer) return <NoValue label="Sem container, sem local de desova" />
  return value?.trim() ? <>{value}</> : <StatusText tone="warning">Sem local</StatusText>
}

const EMPTY_FILTERS = { search: '', brand: '', model: '', container: '', containerType: '', seal: '', bl: '', unpackingLocation: '' }

function formatKg(value: number | null | undefined) {
  return value == null ? '—' : `${Number(value).toLocaleString('pt-BR')} kg`
}

function formatCbm(value: number | null | undefined) {
  return value == null ? '—' : `${Number(value).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} m³`
}

export function Veiculos() {
  const [searchParams, setSearchParams] = useSearchParams()
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const confirmWithReason = useConfirmWithReason()
  const confirm = useConfirm()
  const { user, profile } = useAuth()
  const narrow = useNarrowViewport()
  const canEditVehicles = Boolean(profile || user)
  // Excluir e Mover valem para qualquer usuário, com motivo (ADR 0078, item 23).
  const canDeleteVehicles = canEditVehicles
  const canSelect = canEditVehicles
  const [deleting, setDeleting] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [bulkDesovaOpen, setBulkDesovaOpen] = useState(false)
  const [moveOpen, setMoveOpen] = useState(false)
  const [bulkDesovaValue, setBulkDesovaValue] = useState('')
  const [bulkDesovaSaving, setBulkDesovaSaving] = useState(false)
  const [bulkDesovaError, setBulkDesovaError] = useState<string | null>(null)
  const [bulkDesovaScope, setBulkDesovaScope] = useState<DesovaScope | null>(null)
  const { data: options } = useVehicleOptions()
  const selectedVoyageId = searchParams.get('voyage') ?? ''
  const { filters, setFilters, updateFilter } = usePageFilters<VehiclePageFilters>({ ...EMPTY_FILTERS, page: 1, pageSize: 20 })
  const [importOpen, setImportOpen] = useState(false)

  // A faixa usa o mesmo resumo de Viagens que o Baplie (armador, situação, B/Ls,
  // containers e CE), acrescido de quais viagens têm veículos.
  const { data: voyageRows = [] } = useVoyages()
  const voyageIds = useMemo(() => voyageRows.map((voyage) => voyage.id), [voyageRows])
  const { data: voyageVehicleStats } = useVoyageVehicleStats(voyageIds)
  const { data: escalaSchedulesByVoyage = new Map() } = useQuery({
    queryKey: ['vehicles-voyage-card-schedules', voyageIds],
    enabled: voyageIds.length > 0,
    queryFn: () => listVoyageEscalaSchedulesByVoyageIds(voyageIds),
  })
  const openDivergencesByVoyage = useVoyageRailDivergences(voyageRows)
  const voyageRailItems = useMemo(() => {
    const moduleStats = new Map<number, VoyageRailModuleStats>()
    for (const voyage of voyageRows) {
      const stats = voyageVehicleStats?.byVoyageId[voyage.id]
      moduleStats.set(voyage.id, {
        hasVehicles: (stats?.totalVehicles ?? 0) > 0,
        vehicleContainerNumbers: stats?.containerNumbers ?? [],
        vehiclePorts: Object.keys(stats?.byPod ?? {}),
      })
    }
    return buildVoyageRailItems(voyageRows, escalaSchedulesByVoyage, moduleStats, openDivergencesByVoyage)
  }, [voyageRows, escalaSchedulesByVoyage, voyageVehicleStats, openDivergencesByVoyage])

  const voyageId = selectedVoyageId ? Number(selectedVoyageId) : null
  // Chassi e lacre vão ao servidor: só depois da pausa na digitação.
  const debouncedSearch = useDebouncedValue(filters.search)
  const debouncedSeal = useDebouncedValue(filters.seal)
  const queryFilters = useMemo(() => ({ ...filters, search: debouncedSearch, seal: debouncedSeal }), [filters, debouncedSearch, debouncedSeal])
  const { data, isLoading, isPlaceholderData, error } = useVehicles(voyageId, queryFilters)
  // O recorte inteiro já vem carregado (`filteredIds`): o "selecionar todos" do
  // cabeçalho marca todas as páginas (G1), com o hook comum das listas.
  const filteredRowIds = data?.filteredIds ?? []
  const selection = useFilteredSelection<number>({
    // Pelo filtro que foi ao servidor: na pausa da digitação, `filteredRowIds` ainda é o do anterior.
    scope: `${selectedVoyageId}:${JSON.stringify({ ...queryFilters, page: undefined, pageSize: undefined })}`,
    totalCount: filteredRowIds.length,
    loadAll: () => filteredRowIds,
  })
  // Chassi, lacre, marca, modelo ou tipo trocados: as linhas na tela ainda são
  // do recorte anterior até a resposta chegar. Ficam esmaecidas e sem seleção.
  const stale = isPlaceholderData
  // O recorte na tela ainda não é o dos filtros: resposta a caminho ou chassi/
  // lacre na pausa da digitação. Exportar e aplicar ao recorte esperam por ele.
  const sliceSettling = stale || filters.search !== debouncedSearch || filters.seal !== debouncedSeal
  const totalPages = Math.max(1, Math.ceil((data?.count ?? 0) / filters.pageSize))
  // Lista que encolheu (desova aplicada com "Sem local de desova" ligado, exclusão):
  // volta para a última página com linhas, como em Containers.
  const lastPage = data && !error && !sliceSettling ? totalPages : null
  useEffect(() => {
    if (lastPage !== null && filters.page > lastPage) setFilters((current) => ({ ...current, page: lastPage }))
  }, [filters.page, lastPage, setFilters])

  const activeFilterCount = (Object.keys(EMPTY_FILTERS) as (keyof typeof EMPTY_FILTERS)[])
    .filter((key) => String(filters[key] ?? '').trim() !== '').length
  const moreFilterCount = (['container', 'bl', 'seal', 'containerType'] as (keyof typeof EMPTY_FILTERS)[])
    .filter((key) => String(filters[key] ?? '').trim() !== '').length

  function selectVoyage(id: string) {
    const next = new URLSearchParams(searchParams)
    if (id) next.set('voyage', id)
    else next.delete('voyage')
    setSearchParams(next)
    setFilters((current) => ({ ...current, ...EMPTY_FILTERS, page: 1 }))
  }

  function clearFilters() {
    setFilters((current) => ({ ...current, ...EMPTY_FILTERS, page: 1 }))
  }

  async function handleExport() {
    if (sliceSettling || !data?.filteredRows.length) return
    setExporting(true)
    try {
      await exportVehicleWorkbook(data.filteredRows)
      showToast('Exportação de veículos concluída.', 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Falha ao exportar veículos.', 'error')
    } finally {
      setExporting(false)
    }
  }

  const selectedContainerIds = [...new Set(
    (data?.filteredIds ?? [])
      .filter((vehicleId) => selection.isSelected(vehicleId))
      .map((vehicleId) => data?.containerIdByVehicleId?.[vehicleId])
      .filter((containerId): containerId is number => typeof containerId === 'number'),
  )]

  // A quem a janela aplica o local (decisão de 2026-10-16): os marcados, o
  // recorte inteiro ou só os veículos do recorte ainda sem local.
  const filteredRows = data?.filteredRows ?? []
  const containersOf = (rows: typeof filteredRows) => [...new Set(rows.map((row) => row.container?.id).filter((id): id is number => typeof id === 'number'))]
  const scopeContainerIds: Record<DesovaScope, number[]> = {
    selected: selectedContainerIds,
    all: containersOf(filteredRows),
    missing: containersOf(filteredRows.filter((row) => row.container && !(row.container.unpacking_location ?? '').trim())),
  }
  const scopeVehicleCount: Record<DesovaScope, number> = {
    selected: selection.count,
    all: filteredRows.length,
    missing: filteredRows.filter((row) => row.container && !(row.container.unpacking_location ?? '').trim()).length,
  }

  // O local é do container: conta todos os veículos dentro dele, inclusive os
  // que o filtro de agora esconde (outra marca no mesmo container).
  const affectedVehicles = (containerIds: number[]) => containerIds
    .reduce((sum, containerId) => sum + (data?.vehicleCountByContainerId?.[containerId] ?? 0), 0)
  const scopeDescription = (scope: DesovaScope, base: string) => {
    const containers = scopeContainerIds[scope]
    const affected = affectedVehicles(containers)
    const total = `${plural(containers.length, 'container', 'containers')}, ${plural(affected, 'veículo', 'veículos')} no total`
    return base ? `${base} · ${total}` : total
  }

  function openBulkDesova() {
    setBulkDesovaError(null)
    setBulkDesovaScope(selection.count > 0 ? 'selected' : null)
    setBulkDesovaOpen(true)
  }

  async function handleBulkUnpackingLocation() {
    const value = bulkDesovaValue.trim() || null
    const containerIds = bulkDesovaScope ? scopeContainerIds[bulkDesovaScope] : []
    if (bulkDesovaScope !== 'selected' && sliceSettling) {
      setBulkDesovaError('O recorte ainda está carregando os filtros novos. Aguarde e aplique de novo.')
      return
    }
    if (!containerIds.length) {
      setBulkDesovaError('Nenhum container nesta escolha.')
      return
    }
    setBulkDesovaSaving(true)
    setBulkDesovaError(null)
    try {
      // Um local por container físico (ADR 0095, decisão 26): o servidor grava
      // em todos os B/Ls do container; local diferente já gravado pede confirmação.
      const replaced = await findUnpackingReplacements(containerIds, value)
      if (replaced.length) {
        const shown = replaced.slice(0, 8).map((item) => `${item.containerNumber} (B/L ${item.blId}): ${item.current}`)
        if (replaced.length > shown.length) shown.push(`e mais ${replaced.length - shown.length}`)
        const proceed = await confirm({
          title: value ? 'Trocar o local de desova' : 'Apagar o local de desova',
          message: `${plural(replaced.length, 'container já tem', 'containers já têm')} outro local de desova: ${shown.join('; ')}.`,
          consequence: value
            ? `O local passa a ser "${value}" no container em todos os B/Ls da Viagem que o compartilham.`
            : 'O local é apagado do container em todos os B/Ls da Viagem que o compartilham.',
          reversibility: 'Dá para gravar o local anterior de novo; a troca fica no Histórico de cada B/L.',
          confirmLabel: value ? 'Trocar o local' : 'Apagar o local',
        })
        if (!proceed) return
      }
      // Em sequência: o gatilho da 406 grava cada container nos B/Ls irmãos, e
      // duas gravações paralelas do mesmo container físico travariam uma à outra.
      for (const containerId of containerIds) {
        await setContainerUnpackingLocation(containerId, value)
        cacheUnpackingLocation(queryClient, [containerId], value)
      }
      await afterCargaAlterada(queryClient)
      showToast(`Local de desova aplicado a ${containerIds.length} container(s).`, 'success')
      // Os marcados podem ter saído do recorte (filtro "Sem local de desova").
      selection.clear()
      setBulkDesovaOpen(false)
      setBulkDesovaValue('')
    } catch (err) {
      // Parte dos containers pode ter sido gravada: a releitura mostra o que ficou.
      await afterCargaAlterada(queryClient).catch(() => undefined)
      setBulkDesovaError(err instanceof Error ? err.message : 'Falha ao aplicar o local de desova.')
    } finally {
      setBulkDesovaSaving(false)
    }
  }

  async function runDelete(ids: number[], message: string) {
    const reason = await confirmWithReason({
      title: 'Excluir veículo',
      message,
      consequence: 'Os veículos saem do B/L, do container e das listas.',
      reversibility: 'Não é possível desfazer pelo sistema; o registro apagado fica guardado na auditoria.',
      confirmLabel: 'Excluir',
      tone: 'danger',
    })
    if (reason === null) return

    setDeleting(true)
    try {
      const result = await deleteVehicles(ids, reason)
      selection.clear()
      await afterCargaAlterada(queryClient)
      const outcome = formatDeleteOutcome('veículo(s)', result)
      showToast(outcome.message, outcome.tone)
    } catch (err) {
      showToast(`Falha ao excluir veículo(s): ${userFacingErrorMessage(err, 'tente novamente.')}`, 'error')
    } finally {
      setDeleting(false)
    }
  }

  const columnCount = 8 + (canSelect ? 1 : 0)
  const skeletonTemplate = `${canSelect ? '40px ' : ''}1.4fr 0.8fr 1fr 1.1fr 1.2fr 0.7fr 0.7fr 1fr`

  const statsKnown = !isLoading && !error
  const missingDesova = (data?.unpackingLocations ?? []).find((item) => isMissingLabel(item.label))?.count ?? 0
  const metric = (value: number | string) => (statsKnown ? (typeof value === 'number' ? value.toLocaleString('pt-BR') : value) : '—')
  const totalVehicles = (data?.vehiclesByBrand ?? []).reduce((sum, item) => sum + item.count, 0)
  const brandCount = (label: string) => (data?.vehiclesByBrand ?? []).find((item) => item.label === label)?.count

  return (
    <>
      <PageHeader
        title="Veículos"
        action={(
          <div className="flex flex-wrap gap-2">
            {voyageId ? (
              <Button variant="secondary" loading={exporting} loadingLabel="Exportando…" disabled={sliceSettling || !data?.filteredRows.length} onClick={() => void handleExport()}>
                <Download size={16} aria-hidden="true" /> Exportar
              </Button>
            ) : null}
            {canEditVehicles ? (
              <Button variant="secondary" onClick={() => setImportOpen(true)}>
                <Upload size={16} aria-hidden="true" />
                Importar veículos
              </Button>
            ) : null}
          </div>
        )}
      />

      <section className="app-cargo-voyage" aria-label="Viagem">
        <VoyageRail
          items={voyageRailItems}
          selectedId={voyageId}
          onSelect={(id) => selectVoyage(String(id))}
        />
        <div className="app-cargo-voyage__search">
          <VoyageCombobox
            clearable
            label="Buscar viagem"
            selectedVoyageId={selectedVoyageId}
            onSelect={(id) => selectVoyage(id == null ? '' : String(id))}
          />
        </div>
      </section>

      {!voyageId ? (
        <Card className="overflow-hidden p-0">
          <EmptyState
            title="Escolha uma viagem"
            description="Os veículos são listados por viagem. Escolha na faixa acima ou busque pelo navio."
          />
        </Card>
      ) : (
        <>
          <div className="app-metric-row" role="group" aria-label="Totais da viagem">
            <MetricCard label="Veículos na viagem" value={metric(totalVehicles)} />
            <MetricCard label="Containers" value={metric(data?.distinctContainerCount ?? 0)} />
            <MetricCard label="Peso total" value={metric(formatKg(data?.totalWeightKg ?? 0))} />
            <MetricCard label="Cubagem" value={metric(formatCbm(data?.totalCbm ?? 0))} />
            <MetricCard
              label="Sem local de desova"
              value={metric(missingDesova)}
              tone={statsKnown && missingDesova > 0 ? 'warning' : 'secondary'}
              selected={filters.unpackingLocation === UNPACKING_LOCATION_NONE}
              onSelect={() => updateFilter('unpackingLocation', filters.unpackingLocation === UNPACKING_LOCATION_NONE ? '' : UNPACKING_LOCATION_NONE)}
            />
          </div>

          <div className="app-filter-grid">
            <Field label="Chassi">
              <Input type="search" value={filters.search} onChange={(event) => updateFilter('search', event.target.value)} />
            </Field>
            <Field label="Marca">
              <Select value={filters.brand} onChange={(event) => updateFilter('brand', event.target.value)}>
                <option value="">Todas</option>
                {(data?.vehiclesByBrand ?? []).filter((item) => !isMissingLabel(item.label)).map((item) => <option key={item.label} value={item.label}>{item.label} ({brandCount(item.label)?.toLocaleString('pt-BR')})</option>)}
              </Select>
            </Field>
            <Field label="Modelo">
              <Select value={filters.model} onChange={(event) => updateFilter('model', event.target.value)}>
                <option value="">Todos</option>
                {(data?.vehiclesByModel ?? []).filter((item) => !isMissingLabel(item.label)).map((item) => <option key={item.label} value={item.label}>{item.label}</option>)}
              </Select>
            </Field>
            <Field label="Local de desova">
              <Select value={filters.unpackingLocation} onChange={(event) => updateFilter('unpackingLocation', event.target.value)}>
                <option value="">Todos</option>
                <option value={UNPACKING_LOCATION_NONE}>Sem local informado</option>
                {(data?.unpackingLocations ?? []).filter((item) => !isMissingLabel(item.label)).map((item) => <option key={item.label} value={item.label}>{item.label}</option>)}
              </Select>
            </Field>
            {/* Como na lista de BLs: com filtro só nos campos abertos, o Limpar fica aqui; com "Mais filtros", fica lá. */}
            {activeFilterCount > 0 && moreFilterCount === 0 ? (
              <div><Button variant="ghost" onClick={clearFilters}>Limpar filtros</Button></div>
            ) : null}
          </div>

          <FilterBar title="Mais filtros" activeCount={moreFilterCount} onClear={clearFilters}>
            <div className="app-filter-grid">
              <Field label="Container">
                <Input type="search" value={filters.container} onChange={(event) => updateFilter('container', event.target.value)} />
              </Field>
              <Field label="B/L">
                <Input type="search" value={filters.bl} onChange={(event) => updateFilter('bl', event.target.value)} />
              </Field>
              <Field label="Lacre">
                <Input type="search" value={filters.seal} onChange={(event) => updateFilter('seal', event.target.value)} />
              </Field>
              <Field label="Tipo de container">
                <Select value={filters.containerType} onChange={(event) => updateFilter('containerType', event.target.value)}>
                  <option value="">Todos</option>
                  {(data?.vehiclesByContainerType ?? []).filter((item) => !isMissingLabel(item.label)).map((item) => <option key={item.label} value={item.label}>{item.label}</option>)}
                </Select>
              </Field>
            </div>
          </FilterBar>

          {canSelect ? (
            <BulkActionsBar
              count={selection.count}
              total={selection.totalCount}
              loadingAll={selection.loadingAll}
              loadError={selection.loadError}
              onClear={selection.clear}
              onDelete={canDeleteVehicles ? () => runDelete([...selection.selected], `Excluir ${selection.count} veículo(s) selecionado(s)?`) : undefined}
              deleting={deleting}
              noun={['veículo', 'veículos']}
              extraActions={canEditVehicles ? (
                <>
                  <Button variant="secondary" onClick={openBulkDesova} disabled={deleting}>
                    <MapPin size={15} aria-hidden="true" />
                    Definir local de desova
                  </Button>
                  <Button variant="secondary" onClick={() => setMoveOpen(true)} disabled={deleting}>
                    Mover para outro B/L
                  </Button>
                </>
              ) : null}
            />
          ) : null}

          <Block
            title={statsKnown ? plural(data?.count ?? 0, 'veículo', 'veículos') : 'Veículos'}
            aside={canEditVehicles ? (
              <span className="inline-flex flex-wrap items-center gap-2">
                {selection.count === 0 ? <span>marque veículos, ou defina o local para o recorte inteiro</span> : null}
                <Button className="app-btn--sm" onClick={openBulkDesova} disabled={deleting || sliceSettling || !data?.filteredRows.length}>
                  <MapPin size={14} aria-hidden="true" />
                  Definir local de desova
                </Button>
              </span>
            ) : undefined}
            flush
          >
            {error ? (
              <div className="app-cargo-error" role="alert">
                Não foi possível carregar os veículos. Os totais aparecem como —.
              </div>
            ) : null}
            {isLoading || (stale && !data?.rows.length) ? (
              <SkeletonTable rows={6} cols={columnCount} columnTemplate={skeletonTemplate} label="Carregando veículos" />
            ) : error && !data?.rows.length ? null : !data?.rows.length ? (
              activeFilterCount > 0 ? (
                <EmptyState
                  title="Nenhum veículo neste recorte"
                  description="Nenhum veículo atende aos filtros aplicados."
                  action={<Button variant="secondary" onClick={clearFilters}>Limpar filtros</Button>}
                />
              ) : (
                <EmptyState
                  title="Nenhum veículo nesta viagem"
                  description="Os veículos entram pela planilha do armador, ligados ao B/L e ao container da viagem."
                  action={canEditVehicles ? <Button variant="secondary" onClick={() => setImportOpen(true)}>Importar veículos</Button> : undefined}
                />
              )
            ) : narrow ? (
              <ul className={`app-cargo-cards${stale ? ` ${STALE_PAGE_CLASS}` : ''}`} aria-label="Veículos" aria-busy={stale || undefined}>
                {data.rows.map((row) => (
                  <li key={row.id} className="app-cargo-card">
                    <div className="app-cargo-card__head">
                      {canSelect ? (
                        <input
                          type="checkbox"
                          aria-label={`Selecionar veículo ${row.chassis}`}
                          checked={selection.isSelected(row.id)}
                          disabled={stale}
                          onChange={() => selection.toggle(row.id)}
                        />
                      ) : null}
                      <span className="app-cargo-code">{row.chassis}</span>
                    </div>
                    <div className="app-cargo-card__body">
                      <span>{[row.brand, row.model].filter(Boolean).join(' ')} · {formatKg(row.weight_kg)} · {formatCbm(row.cbm)}</span>
                      <span>{row.container?.container_number ?? 'Sem container'}{row.bl?.id ? ` · B/L ${row.bl.id}` : ''}</span>
                      <DesovaText value={row.container?.unpacking_location} hasContainer={Boolean(row.container)} />
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <div className={`app-table-scroll app-table-scroll--sticky${stale ? ` ${STALE_PAGE_CLASS}` : ''}`} aria-busy={stale || undefined}>
                <table className="app-table app-cargo-table">
                  <caption className="sr-only">Veículos da viagem, ordenados por container</caption>
                  <thead>
                    <tr>
                      {canSelect ? (
                        <th scope="col" className="app-cargo-table__check">
                          <SelectAllFilteredCheckbox selection={selection} noun="veículos" disabled={sliceSettling} />
                        </th>
                      ) : null}
                      <th scope="col">Chassi</th>
                      <th scope="col">Marca</th>
                      <th scope="col">Modelo</th>
                      <th scope="col">Container</th>
                      <th scope="col">B/L</th>
                      <th scope="col">Peso</th>
                      <th scope="col">Cubagem</th>
                      <th scope="col" className="app-table__text-head">Local de desova</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map((row) => (
                      <tr key={row.id}>
                        {canSelect ? (
                          <td className="app-cargo-table__check">
                            <input
                              type="checkbox"
                              aria-label={`Selecionar veículo ${row.chassis}`}
                              checked={selection.isSelected(row.id)}
                              disabled={stale}
                              onChange={() => selection.toggle(row.id)}
                            />
                          </td>
                        ) : null}
                        <td className="app-cargo-code">{row.chassis}</td>
                        <td>{row.brand ?? <NoValue label="Sem marca" />}</td>
                        <td>{row.model ?? <NoValue label="Sem modelo" />}</td>
                        <td className="app-cargo-code">{row.container?.container_number ? <CopyValue value={row.container.container_number} label="número do contêiner" /> : <NoValue label="Sem container" />}</td>
                        <td>{row.bl?.id ? <CopyValue value={row.bl.id} label="número do B/L"><Link className="app-cargo-link app-cargo-id" to={`/bls/${row.bl.id}`}>{row.bl.id}</Link></CopyValue> : <NoValue label="Sem B/L" />}</td>
                        <td className="tabular-nums">{row.weight_kg == null ? <NoValue label="Sem peso" /> : formatKg(row.weight_kg)}</td>
                        <td className="tabular-nums">{row.cbm == null ? <NoValue label="Sem cubagem" /> : formatCbm(row.cbm)}</td>
                        <td className="app-table__text"><DesovaText value={row.container?.unpacking_location} hasContainer={Boolean(row.container)} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {data && data.count > 0 ? (
              <TableFooterPagination
                page={filters.page}
                pageSize={filters.pageSize}
                totalCount={data?.count ?? 0}
                totalPages={totalPages}
                onPageChange={(page) => updateFilter('page', page)}
                onPageSizeChange={(pageSize) => updateFilter('pageSize', pageSize)}
              />
            ) : null}
          </Block>
        </>
      )}

      {importOpen && canEditVehicles ? (
        <VehicleImportModal
          defaultVoyageId={selectedVoyageId || (options?.voyages.length === 1 ? String(options.voyages[0].id) : '')}
          onClose={() => setImportOpen(false)}
        />
      ) : null}

      <MoveVehiclesModal
        open={moveOpen}
        vehicleIds={[...selection.selected]}
        onClose={() => setMoveOpen(false)}
        onMoved={async () => { selection.clear(); await afterCargaAlterada(queryClient) }}
      />
      <Modal open={bulkDesovaOpen} size="sm" title="Definir local de desova" onClose={() => setBulkDesovaOpen(false)}>
        <div className="grid gap-4">
          <ChoiceCards
            label="Aplicar a"
            value={bulkDesovaScope}
            onChange={setBulkDesovaScope}
            options={[
              ...(selection.count > 0 ? [{ value: 'selected' as const, title: `Os ${plural(scopeVehicleCount.selected, 'veículo marcado', 'veículos marcados')}`, description: scopeDescription('selected', '') }] : []),
              { value: 'all' as const, title: `Todos os ${plural(scopeVehicleCount.all, 'veículo', 'veículos')} do recorte`, description: scopeDescription('all', 'os que aparecem com os filtros de agora') },
              { value: 'missing' as const, title: `Só os ${plural(scopeVehicleCount.missing, 'veículo sem local', 'veículos sem local')}`, description: scopeDescription('missing', 'não muda quem já tem local') },
            ]}
          />
          <p className="text-sm text-[var(--app-muted)]">O local é do container: vale para todos os veículos dentro dele.</p>
          <Field label="Local de desova" hint="Deixe em branco para apagar o local registrado.">
            <Input value={bulkDesovaValue} onChange={(event) => setBulkDesovaValue(event.target.value)} placeholder="Ex.: Pátio 3" />
          </Field>
          {bulkDesovaError ? (
            <ImportNotice tone="danger" role="alert" title="O local não foi aplicado a todos">
              <p>{bulkDesovaError}</p>
              <p>A lista mostra o que ficou gravado; confira e aplique de novo.</p>
            </ImportNotice>
          ) : null}
          <div className="app-modal__actions">
            <Button variant="secondary" disabled={bulkDesovaSaving} onClick={() => setBulkDesovaOpen(false)}>Voltar</Button>
            <Button
              onClick={() => void handleBulkUnpackingLocation()}
              loading={bulkDesovaSaving}
              loadingLabel="Aplicando…"
              disabled={!bulkDesovaScope || !scopeContainerIds[bulkDesovaScope].length}
            >
              {!bulkDesovaScope ? 'Escolha a quem aplicar' : bulkDesovaValue.trim() ? `Aplicar a ${plural(scopeContainerIds[bulkDesovaScope].length, 'container', 'containers')}` : `Apagar o local de ${plural(scopeContainerIds[bulkDesovaScope].length, 'container', 'containers')}`}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  )
}
