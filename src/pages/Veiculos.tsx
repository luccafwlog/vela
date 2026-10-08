import { Fragment, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { afterCargaAlterada } from '../services/cacheEffects'
import { Download, MapPin, Trash2, Upload } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { Card, EmptyState, PageHeader } from '../components/ui/Card'
import { FilterBar } from '../components/ui/FilterBar'
import { Field, Input, Select } from '../components/ui/Input'
import { SummaryStrip, type SummaryItem } from '../components/ui/SummaryStrip'
import { TableFooterPagination } from '../components/ui/TableFooterPagination'
import { SkeletonTable } from '../components/ui/Skeleton'
import { Modal } from '../components/ui/Modal'
import { useToast } from '../components/ui/Toast'
import { TruncationNote } from '../components/shared/TruncationNote'
import { useConfirmWithReason } from '../components/ui/ConfirmDialog'
import { BulkActionsBar } from '../components/shared/BulkActionsBar'
import { VoyageCombobox } from '../components/shared/VoyageCombobox'
import { ImportFilePicker, ImportFootnote, ImportGuide, ImportNotice, ImportSection, ImportTemplateLinks } from '../components/shared/ImportParts'
import { plural } from '../components/shared/importPresentation'
import { useNarrowViewport } from '../components/bl/useNarrowViewport'
import { useAuth } from '../hooks/useAuth'
import { useVoyages } from '../hooks/useBls'
import { useCancellableFileRead } from '../hooks/useCancellableFileRead'
import { useRowSelection } from '../hooks/useRowSelection'
import { usePageFilters } from '../hooks/usePageFilters'
import { UNPACKING_LOCATION_NONE, useVehicleOptions, useVehicles, useVoyageVehicleStats, type VehiclePageFilters } from '../hooks/useVehicles'
import { deleteVehicles } from '../services/vehicles'
import { formatDeleteOutcome } from '../services/deleteDependencies'
import { importVehicleRows, parseVehicleImportFile, type ParsedVehicleImport } from '../services/vehicleImport'
import { setContainerUnpackingLocation } from '../services/vaziosNatureza'
import { exportVehicleWorkbook } from '../services/exports'
import { listVoyageEscalaSchedulesByVoyageIds } from '../services/voyageRouteSchedules'
import { buildVoyageRailItems, type VoyageRailModuleStats } from '../services/voyageSummaries'
import { VoyageRail } from '../components/voyages/VoyageRail'
import { ImportIssuesPanel } from '../components/shared/ImportIssuesPanel'
import { rowErrorsToImportIssues } from '../services/importValidation'
import { ImportReadProgress } from '../components/shared/ImportReadProgress'
import { displayAggregateLabel, groupVehiclesByContainer, isMissingLabel, unpackingScopeText } from './veiculosPresentation'

type DesovaStatus = { kind: 'saved' } | { kind: 'error'; message: string }

const EMPTY_FILTERS = { search: '', brand: '', model: '', container: '', containerType: '', seal: '', bl: '', unpackingLocation: '' }

function formatKg(value: number | null | undefined) {
  return value == null ? '—' : `${Number(value).toLocaleString('pt-BR')} kg`
}

function formatCbm(value: number | null | undefined) {
  return value == null ? '—' : `${Number(value).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} m³`
}

/**
 * Edição inline do Local de desova: um campo por container, grava ao sair do
 * campo ou com Enter; Escape desfaz o rascunho. O resultado fica ao lado do
 * campo, não só no aviso flutuante.
 */
function UnpackingLocationField({
  containerNumber,
  value,
  savedValue,
  disabled,
  saving,
  status,
  vehicleCount,
  onChange,
  onCommit,
  onRevert,
}: {
  containerNumber: string
  value: string
  savedValue: string | null
  disabled: boolean
  saving: boolean
  status: DesovaStatus | undefined
  vehicleCount: number
  onChange: (value: string) => void
  onCommit: (value: string) => void
  onRevert: () => void
}) {
  const statusId = `desova-status-${containerNumber}`
  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault()
      onCommit(event.currentTarget.value)
    } else if (event.key === 'Escape' && value !== (savedValue ?? '')) {
      event.preventDefault()
      event.stopPropagation()
      onRevert()
    }
  }
  return (
    <span className="app-cargo-desova">
      <Input
        aria-label={`Local de desova do container ${containerNumber}`}
        aria-describedby={statusId}
        className="app-cargo-desova__input"
        disabled={disabled || saving}
        value={value}
        placeholder="Informar local"
        onChange={(event) => onChange(event.target.value)}
        onBlur={(event) => onCommit(event.target.value)}
        onKeyDown={handleKeyDown}
      />
      <span
        id={statusId}
        className={`app-cargo-desova__status${status?.kind === 'error' ? ' app-cargo-desova__status--error' : ''}`}
        role={status?.kind === 'error' ? 'alert' : undefined}
        aria-live="polite"
      >
        {saving ? 'Salvando…' : status?.kind === 'error' ? status.message : status?.kind === 'saved' ? 'Salvo' : unpackingScopeText(vehicleCount)}
      </span>
    </span>
  )
}

export function Veiculos() {
  const [searchParams, setSearchParams] = useSearchParams()
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const confirmWithReason = useConfirmWithReason()
  const { isAdmin, user, profile } = useAuth()
  const narrow = useNarrowViewport()
  const canEditVehicles = Boolean(profile || user)
  const canDeleteVehicles = isAdmin
  // Selecionar serve ao local de desova em lote (quem edita) e à exclusão (Administrativo).
  const canSelect = canEditVehicles
  const [deleting, setDeleting] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [unpackingLocations, setUnpackingLocations] = useState<Record<number, string>>({})
  const [desovaStatus, setDesovaStatus] = useState<Record<number, DesovaStatus>>({})
  const [savingContainerId, setSavingContainerId] = useState<number | null>(null)
  // Enter grava e desativa o campo, o que dispara o blur: a segunda chamada não repete a escrita.
  const savingRef = useRef(new Set<number>())
  const [bulkDesovaOpen, setBulkDesovaOpen] = useState(false)
  const [bulkDesovaValue, setBulkDesovaValue] = useState('')
  const [bulkDesovaSaving, setBulkDesovaSaving] = useState(false)
  const [bulkDesovaError, setBulkDesovaError] = useState<string | null>(null)
  const { data: options } = useVehicleOptions()
  const selectedVoyageId = searchParams.get('voyage') ?? ''
  const { filters, setFilters, updateFilter } = usePageFilters<VehiclePageFilters>({ ...EMPTY_FILTERS, page: 1, pageSize: 20 })
  const selection = useRowSelection<number>(`${selectedVoyageId}:${JSON.stringify({ ...filters, page: undefined, pageSize: undefined })}`)
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
    return buildVoyageRailItems(voyageRows, escalaSchedulesByVoyage, moduleStats)
  }, [voyageRows, escalaSchedulesByVoyage, voyageVehicleStats])

  const voyageId = selectedVoyageId ? Number(selectedVoyageId) : null
  const { data, isLoading, error } = useVehicles(voyageId, filters)
  const totalPages = Math.max(1, Math.ceil((data?.count ?? 0) / filters.pageSize))
  const groups = useMemo(() => groupVehiclesByContainer(data?.rows ?? []), [data?.rows])

  const activeFilterCount = (Object.keys(EMPTY_FILTERS) as (keyof typeof EMPTY_FILTERS)[])
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
    if (!data?.rows.length) return
    setExporting(true)
    try {
      await exportVehicleWorkbook(data.rows)
      showToast('Exportação de veículos concluída.', 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Falha ao exportar veículos.', 'error')
    } finally {
      setExporting(false)
    }
  }

  function cacheSavedUnpackingLocations(containerIds: readonly number[], value: string | null) {
    const ids = new Set(containerIds)
    // Atualiza só consultas existentes com a escrita confirmada, antes da releitura.
    queryClient.setQueriesData<typeof data>({ queryKey: ['vehicles'] }, (cached) => cached && ({
      ...cached,
      rows: cached.rows.map((row) => row.container && ids.has(row.container.id)
        ? { ...row, container: { ...row.container, unpacking_location: value } }
        : row),
    }))
  }

  async function handleUnpackingLocationSave(containerId: number, value: string, currentValue: string | null) {
    const unpackingLocation = value.trim() || null
    if (unpackingLocation === currentValue || savingRef.current.has(containerId)) return

    savingRef.current.add(containerId)
    setSavingContainerId(containerId)
    setDesovaStatus((current) => {
      const next = { ...current }
      delete next[containerId]
      return next
    })
    try {
      await setContainerUnpackingLocation(containerId, unpackingLocation)
      cacheSavedUnpackingLocations([containerId], unpackingLocation)
      await afterCargaAlterada(queryClient)
      setUnpackingLocations((current) => {
        const next = { ...current }
        if (current[containerId] === value) delete next[containerId]
        return next
      })
      setDesovaStatus((current) => ({ ...current, [containerId]: { kind: 'saved' } }))
    } catch (err) {
      setUnpackingLocations((current) => ({ ...current, [containerId]: currentValue ?? '' }))
      const message = err instanceof Error ? err.message : 'Falha ao salvar o local de desova.'
      setDesovaStatus((current) => ({ ...current, [containerId]: { kind: 'error', message: `Não salvo: ${message}` } }))
    } finally {
      savingRef.current.delete(containerId)
      setSavingContainerId(null)
    }
  }

  function revertUnpackingLocation(containerId: number) {
    setUnpackingLocations((current) => {
      const next = { ...current }
      delete next[containerId]
      return next
    })
  }

  const selectedContainerIds = [...new Set(
    (data?.filteredIds ?? [])
      .filter((vehicleId) => selection.isSelected(vehicleId))
      .map((vehicleId) => data?.containerIdByVehicleId?.[vehicleId])
      .filter((containerId): containerId is number => typeof containerId === 'number'),
  )]

  async function handleBulkUnpackingLocation() {
    const value = bulkDesovaValue.trim() || null
    const containerIds = selectedContainerIds
    if (!containerIds.length) {
      setBulkDesovaError('Nenhum container nas linhas selecionadas.')
      return
    }
    const submittedDrafts = unpackingLocations
    setBulkDesovaSaving(true)
    setBulkDesovaError(null)
    try {
      await Promise.all(containerIds.map(async (containerId) => {
        await setContainerUnpackingLocation(containerId, value)
        cacheSavedUnpackingLocations([containerId], value)
      }))
      await afterCargaAlterada(queryClient)
      setUnpackingLocations((current) => {
        const next = { ...current }
        for (const containerId of containerIds) {
          if (current[containerId] === submittedDrafts[containerId]) delete next[containerId]
        }
        return next
      })
      showToast(`Local de desova aplicado a ${containerIds.length} container(s).`, 'success')
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
      const detail = err instanceof Error ? err.message : 'erro desconhecido'
      showToast(`Falha ao excluir veículo(s): ${detail}`, 'error')
    } finally {
      setDeleting(false)
    }
  }

  const filteredRowIds = data?.filteredIds ?? []
  const allFilteredSelected = filteredRowIds.length > 0 && filteredRowIds.every((id) => selection.isSelected(id))
  const columnCount = 6 + (canSelect ? 1 : 0) + (canDeleteVehicles ? 1 : 0)
  const skeletonTemplate = `${canSelect ? '40px ' : ''}1.4fr 1fr 1fr 0.7fr 0.7fr 1fr${canDeleteVehicles ? ' 52px' : ''}`

  const statsKnown = !isLoading && !error
  const missingDesova = (data?.unpackingLocations ?? []).find((item) => isMissingLabel(item.label))?.count ?? 0
  const summaryItems: SummaryItem[] = [
    { label: 'veículos na viagem', value: statsKnown ? (data?.vehiclesByBrand ?? []).reduce((sum, item) => sum + item.count, 0).toLocaleString('pt-BR') : '—' },
    { label: 'containers', value: statsKnown ? (data?.distinctContainerCount ?? 0).toLocaleString('pt-BR') : '—' },
    { label: data?.distinctBlCount === 1 ? 'B/L' : 'B/Ls', value: statsKnown ? (data?.distinctBlCount ?? 0).toLocaleString('pt-BR') : '—' },
    { label: 'peso total', value: statsKnown ? formatKg(data?.totalWeightKg ?? 0) : '—' },
    { label: 'cubagem', value: statsKnown ? formatCbm(data?.totalCbm ?? 0) : '—' },
    ...(statsKnown && missingDesova > 0 ? [{ label: 'veículos sem local de desova', value: missingDesova.toLocaleString('pt-BR'), tone: 'warning' as const }] : []),
  ]
  const brandItems: SummaryItem[] = statsKnown
    ? (data?.vehiclesByBrand ?? []).slice(0, 8).map((item) => ({ label: displayAggregateLabel(item.label), value: item.count.toLocaleString('pt-BR') }))
    : []

  function desovaFieldFor(container: NonNullable<(typeof groups)[number]['container']>) {
    return (
      <UnpackingLocationField
        containerNumber={container.container_number}
        value={unpackingLocations[container.id] ?? container.unpacking_location ?? ''}
        savedValue={container.unpacking_location ?? null}
        disabled={!canEditVehicles}
        saving={savingContainerId === container.id}
        status={desovaStatus[container.id]}
        vehicleCount={data?.vehicleCountByContainerId?.[container.id] ?? 1}
        onChange={(value) => {
          setUnpackingLocations((current) => ({ ...current, [container.id]: value }))
          setDesovaStatus((current) => {
            if (!current[container.id]) return current
            const next = { ...current }
            delete next[container.id]
            return next
          })
        }}
        onCommit={(value) => void handleUnpackingLocationSave(container.id, value, container.unpacking_location ?? null)}
        onRevert={() => revertUnpackingLocation(container.id)}
      />
    )
  }

  function deleteButton(row: { id: number; chassis: string }) {
    return (
      <button
        type="button"
        onClick={() => runDelete([row.id], `Excluir o veículo ${row.chassis}?`)}
        disabled={deleting}
        className="app-table__icon-button app-cargo-danger-icon"
        title="Excluir veículo"
        aria-label={`Excluir veículo ${row.chassis}`}
      >
        <Trash2 size={15} aria-hidden="true" />
      </button>
    )
  }

  function groupHead(group: (typeof groups)[number]) {
    const container = group.container
    return (
      <span className="app-cargo-group__head">
        <span className="app-cargo-group__id">
          {container ? (
            <>
              <span className="app-cargo-code app-cargo-id">{container.container_number}</span>
              <span className="app-cargo-cell__sub">
                {[container.type, container.seal_number ? `Lacre ${container.seal_number}` : null, plural(group.vehicles.length, 'veículo nesta página', 'veículos nesta página')].filter(Boolean).join(' · ')}
              </span>
            </>
          ) : <span className="app-cargo-id">Sem container</span>}
        </span>
        <span className="app-cargo-group__bls">
          {group.blIds.map((blId) => <Link key={blId} className="app-cargo-link app-cargo-id" to={`/bls/${blId}`}>{blId}</Link>)}
        </span>
      </span>
    )
  }

  return (
    <>
      <PageHeader
        title="Veículos"
        action={(
          <div className="flex flex-wrap gap-2">
            {voyageId ? (
              <Button variant="secondary" loading={exporting} loadingLabel="Exportando…" disabled={!data?.rows.length} onClick={() => void handleExport()}>
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
          <FilterBar activeCount={activeFilterCount} onClear={clearFilters}>
            <div className="app-filter-grid">
              <Field label="Chassi">
                <Input type="search" value={filters.search} onChange={(event) => updateFilter('search', event.target.value)} />
              </Field>
              <Field label="Container">
                <Input type="search" value={filters.container} onChange={(event) => updateFilter('container', event.target.value)} />
              </Field>
              <Field label="B/L">
                <Input type="search" value={filters.bl} onChange={(event) => updateFilter('bl', event.target.value)} />
              </Field>
              <Field label="Lacre">
                <Input type="search" value={filters.seal} onChange={(event) => updateFilter('seal', event.target.value)} />
              </Field>
              <Field label="Marca">
                <Select value={filters.brand} onChange={(event) => updateFilter('brand', event.target.value)}>
                  <option value="">Todas</option>
                  {(data?.vehiclesByBrand ?? []).filter((item) => !isMissingLabel(item.label)).map((item) => <option key={item.label} value={item.label}>{item.label}</option>)}
                </Select>
              </Field>
              <Field label="Modelo">
                <Select value={filters.model} onChange={(event) => updateFilter('model', event.target.value)}>
                  <option value="">Todos</option>
                  {(data?.vehiclesByModel ?? []).filter((item) => !isMissingLabel(item.label)).map((item) => <option key={item.label} value={item.label}>{item.label}</option>)}
                </Select>
              </Field>
              <Field label="Tipo de container">
                <Select value={filters.containerType} onChange={(event) => updateFilter('containerType', event.target.value)}>
                  <option value="">Todos</option>
                  {(data?.vehiclesByContainerType ?? []).filter((item) => !isMissingLabel(item.label)).map((item) => <option key={item.label} value={item.label}>{item.label}</option>)}
                </Select>
              </Field>
              <Field label="Local de desova">
                <Select value={filters.unpackingLocation} onChange={(event) => updateFilter('unpackingLocation', event.target.value)}>
                  <option value="">Todos</option>
                  <option value={UNPACKING_LOCATION_NONE}>Sem local informado</option>
                  {(data?.unpackingLocations ?? []).filter((item) => !isMissingLabel(item.label)).map((item) => <option key={item.label} value={item.label}>{item.label}</option>)}
                </Select>
              </Field>
            </div>
          </FilterBar>

          {canSelect ? (
            <BulkActionsBar
              count={selection.count}
              onClear={selection.clear}
              onDelete={canDeleteVehicles ? () => runDelete([...selection.selected], `Excluir ${selection.count} veículo(s) selecionado(s)?`) : undefined}
              deleting={deleting}
              noun={['veículo', 'veículos']}
              extraActions={canEditVehicles ? (
                <Button variant="secondary" onClick={() => { setBulkDesovaError(null); setBulkDesovaOpen(true) }} disabled={deleting}>
                  <MapPin size={15} aria-hidden="true" />
                  Definir local de desova
                </Button>
              ) : null}
            />
          ) : null}

          <Card className="overflow-hidden p-0">
            <div className="app-cargo-toolbar">
              <SummaryStrip label="Resumo da viagem" items={summaryItems} />
              {brandItems.length ? <SummaryStrip label="Veículos por marca" items={brandItems} className="app-cargo-toolbar__secondary" /> : null}
            </div>
            {error ? (
              <div className="app-cargo-error" role="alert">
                Não foi possível carregar os veículos. Os totais aparecem como —.
              </div>
            ) : null}
            {isLoading ? (
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
              <ul className="app-cargo-cards" aria-label="Veículos por container">
                {groups.map((group) => (
                  <li key={group.key} className="app-cargo-card">
                    <div className="app-cargo-card__head">{groupHead(group)}</div>
                    {group.container ? <div className="app-cargo-card__field">{desovaFieldFor(group.container)}</div> : null}
                    <ul className="app-cargo-card__list" aria-label={`Veículos do container ${group.container?.container_number ?? 'sem container'}`}>
                      {group.vehicles.map((row) => (
                        <li key={row.id} className="app-cargo-card__item">
                          {canSelect ? (
                            <input
                              type="checkbox"
                              aria-label={`Selecionar veículo ${row.chassis}`}
                              checked={selection.isSelected(row.id)}
                              onChange={() => selection.toggle(row.id)}
                            />
                          ) : null}
                          <span className="app-cargo-cell__stack">
                            <span className="app-cargo-code">{row.chassis}</span>
                            <span className="app-cargo-cell__sub">{[row.brand, row.model].filter(Boolean).join(' ')} · {formatKg(row.weight_kg)}</span>
                          </span>
                          {canDeleteVehicles ? deleteButton(row) : null}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="app-table-scroll app-table-scroll--sticky">
                <table className="app-table app-cargo-table app-cargo-table--grouped">
                  <caption className="sr-only">Veículos da viagem agrupados por container</caption>
                  <thead>
                    <tr>
                      {canSelect ? (
                        <th scope="col" className="app-cargo-table__check">
                          <input
                            type="checkbox"
                            aria-label={`Selecionar os ${filteredRowIds.length} veículos do recorte`}
                            checked={allFilteredSelected}
                            onChange={() => selection.toggleMany(filteredRowIds)}
                          />
                        </th>
                      ) : null}
                      <th scope="col">Chassi</th>
                      <th scope="col">Marca</th>
                      <th scope="col">Modelo</th>
                      <th scope="col" className="app-cargo-num">Peso</th>
                      <th scope="col" className="app-cargo-num">Cubagem</th>
                      <th scope="col">Local de desova</th>
                      {canDeleteVehicles ? <th scope="col"><span className="sr-only">Ações</span></th> : null}
                    </tr>
                  </thead>
                  {groups.map((group) => (
                    <tbody key={group.key} className="app-cargo-group">
                      <tr className="app-cargo-group__row">
                        {canSelect ? (
                          <td className="app-cargo-table__check">
                            <input
                              type="checkbox"
                              aria-label={`Selecionar os veículos do container ${group.container?.container_number ?? 'sem container'}`}
                              checked={group.vehicles.every((row) => selection.isSelected(row.id))}
                              onChange={() => selection.toggleMany(group.vehicles.map((row) => row.id))}
                            />
                          </td>
                        ) : null}
                        <th scope="rowgroup" colSpan={5} className="app-cargo-group__cell">{groupHead(group)}</th>
                        <td colSpan={canDeleteVehicles ? 2 : 1}>
                          {group.container ? desovaFieldFor(group.container) : <span className="app-cargo-cell__muted">—</span>}
                        </td>
                      </tr>
                      {group.vehicles.map((row) => (
                        <Fragment key={row.id}>
                          <tr>
                            {canSelect ? (
                              <td className="app-cargo-table__check">
                                <input
                                  type="checkbox"
                                  aria-label={`Selecionar veículo ${row.chassis}`}
                                  checked={selection.isSelected(row.id)}
                                  onChange={() => selection.toggle(row.id)}
                                />
                              </td>
                            ) : null}
                            <td className="app-cargo-code">{row.chassis}</td>
                            <td>{row.brand ?? '—'}</td>
                            <td>{row.model ?? '—'}</td>
                            <td className="app-cargo-num">{formatKg(row.weight_kg)}</td>
                            <td className="app-cargo-num">{formatCbm(row.cbm)}</td>
                            <td aria-hidden="true" />
                            {canDeleteVehicles ? <td>{deleteButton(row)}</td> : null}
                          </tr>
                        </Fragment>
                      ))}
                    </tbody>
                  ))}
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
          </Card>
        </>
      )}

      {importOpen && canEditVehicles ? (
        <VehicleImportModal
          initialVoyageId={selectedVoyageId || (options?.voyages.length === 1 ? String(options.voyages[0].id) : '')}
          onClose={() => setImportOpen(false)}
        />
      ) : null}

      <Modal open={bulkDesovaOpen} size="sm" title="Definir local de desova" onClose={() => setBulkDesovaOpen(false)}>
        <div className="grid gap-4">
          <p className="text-sm text-[var(--app-text)]">
            {selectedContainerIds.length
              ? `O local vale para ${plural(selectedContainerIds.length, 'container', 'containers')} das linhas selecionadas e para todos os veículos dentro deles.`
              : 'As linhas selecionadas não têm container.'}
          </p>
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
              disabled={!selectedContainerIds.length}
            >
              {bulkDesovaValue.trim() ? `Aplicar a ${plural(selectedContainerIds.length, 'container', 'containers')}` : 'Apagar o local'}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  )
}

/**
 * Importação de veículos com viagem escolhida aqui (a ação rápida da Viagem já
 * vem com a viagem fixa). Regra da página: linha com erro bloqueia o lote.
 */
function VehicleImportModal({ initialVoyageId, onClose }: { initialVoyageId: string; onClose: () => void }) {
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const [voyageId, setVoyageId] = useState(initialVoyageId)
  const { file, preview, parsing, progress, readFile, cancel: cancelReading } = useCancellableFileRead<ParsedVehicleImport>(parseVehicleImportFile)
  const [importing, setImporting] = useState(false)
  const [readError, setReadError] = useState<string | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [result, setResult] = useState<Awaited<ReturnType<typeof importVehicleRows>> | null>(null)

  async function handleFiles(files: File[]) {
    setReadError(null)
    setImportError(null)
    setResult(null)
    try {
      await readFile(files[0] ?? null)
    } catch (err) {
      setReadError(err instanceof Error ? err.message : 'Falha ao ler o arquivo.')
    }
  }

  function handleClose() {
    cancelReading()
    onClose()
  }

  const rowErrors = preview?.rowErrors.length ?? 0
  const canConfirm = Boolean(voyageId) && Boolean(preview?.rows.length) && rowErrors === 0 && !result

  async function handleImport() {
    if (!canConfirm || !preview) return
    setImporting(true)
    setImportError(null)
    try {
      const nextResult = await importVehicleRows({ voyageId: Number(voyageId), rows: preview.rows })
      await afterCargaAlterada(queryClient)
      if (nextResult.errorCount) {
        // Com recusas o modal fica aberto e lista o que não entrou.
        setResult(nextResult)
      } else {
        showToast(`${plural(nextResult.successCount, 'veículo importado', 'veículos importados')}.`, 'success')
        onClose()
      }
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Falha ao importar veículos.')
    } finally {
      setImporting(false)
    }
  }

  let footnote = 'Nada é gravado antes de você conferir a prévia e confirmar.'
  if (result) footnote = 'Importação gravada em parte. As linhas recusadas estão acima.'
  else if (parsing) footnote = 'Lendo o arquivo. Nada foi gravado.'
  else if (preview && rowErrors) footnote = 'Há linhas com erro: corrija a planilha e escolha de novo. Nada é gravado enquanto houver erro.'
  else if (preview?.rows.length && !voyageId) footnote = 'Escolha a viagem de destino para importar.'
  else if (preview?.rows.length) footnote = `${plural(preview.rows.length, 'veículo será gravado', 'veículos serão gravados')}. Nada foi gravado ainda.`

  return (
    <Modal open onClose={handleClose} title="Importar planilha de veículos">
      <div className="app-import">
        <VoyageCombobox
          required
          label="Viagem de destino"
          selectedVoyageId={voyageId}
          onSelect={(id) => setVoyageId(id == null ? '' : String(id))}
        />
        <ImportGuide
          required="CHASSI, MARCA, MODELO, PESO, CUBAGEM, CONTAINER, TIPO_CONTAINER, LACRE e BL."
          details={<p>Também aceita o Daily Report COSCO e cabeçalhos em chinês. Cada linha precisa de um B/L da viagem e de um container que case por número, tipo e lacre.</p>}
          templates={<ImportTemplateLinks baseName="veiculos-modelo" />}
        />
        <ImportFilePicker accept=".xlsx,.xls,.csv" files={file ? [file] : []} onFiles={(files) => void handleFiles(files)} disabled={importing || Boolean(result)} />
        {parsing ? <ImportReadProgress progress={progress} /> : null}
        {readError ? (
          <ImportNotice tone="danger" role="alert" title="Não foi possível ler o arquivo">
            <p>{readError}</p>
            <p>Confira o formato e escolha o arquivo de novo.</p>
          </ImportNotice>
        ) : null}
        {preview ? (
          <ImportSection
            title={result ? 'Resultado' : 'Prévia'}
            aside={
              <SummaryStrip
                label={result ? 'Resultado da importação' : 'Resumo da planilha'}
                items={result ? [
                  { label: 'gravados', value: result.successCount },
                  { label: 'recusados', value: result.errorCount, tone: result.errorCount ? 'danger' : 'default' },
                ] : [
                  { label: preview.rows.length === 1 ? 'veículo' : 'veículos', value: preview.rows.length },
                  { label: rowErrors === 1 ? 'linha com erro' : 'linhas com erro', value: rowErrors, tone: rowErrors ? 'danger' : 'default' },
                ]}
              />
            }
          >
            {result?.errors.length ? (
              <ImportIssuesPanel
                issues={rowErrorsToImportIssues(result.errors)}
                filename="veiculos-recusados.csv"
                title={`${plural(result.errors.length, 'linha recusada', 'linhas recusadas')} ao gravar`}
                hint="Os demais veículos foram gravados. Corrija estas linhas e importe uma planilha só com elas."
              />
            ) : (
              <>
                {preview.rows.length ? (
                  <>
                    <div className="app-table-scroll max-h-72">
                      <table className="app-table app-cargo-table app-cargo-table--preview">
                        <caption className="sr-only">Prévia da importação de veículos</caption>
                        <thead>
                          <tr>
                            <th scope="col">Chassi</th>
                            <th scope="col">Marca e modelo</th>
                            <th scope="col">Container</th>
                            <th scope="col">Lacre</th>
                            <th scope="col">B/L</th>
                          </tr>
                        </thead>
                        <tbody>
                          {preview.rows.slice(0, 20).map((row) => (
                            <tr key={`${row.rowNumber}-${row.chassis}`}>
                              <td className="app-cargo-code">{row.chassis}</td>
                              <td>{[row.brand, row.model].filter(Boolean).join(' ')}</td>
                              <td><span className="app-cargo-code">{row.container_number}</span> <span className="app-cargo-cell__sub">{row.container_type}</span></td>
                              <td>{row.seal_number || '—'}</td>
                              <td className="app-cargo-code">{row.bl_id}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <TruncationNote shown={20} total={preview.rows.length} noun="veículo" nounPlural="veículos" />
                  </>
                ) : null}
                <ImportIssuesPanel issues={rowErrorsToImportIssues(preview.rowErrors)} filename="veiculos-issues.csv" />
              </>
            )}
          </ImportSection>
        ) : null}
        {importError ? (
          <ImportNotice tone="danger" role="alert" title="A importação não foi concluída">
            <p>{importError}</p>
            <p>A prévia continua aqui; confirme de novo quando o problema for resolvido.</p>
          </ImportNotice>
        ) : null}
        <div className="app-modal__actions">
          <ImportFootnote tone={result || (preview && rowErrors) ? 'warning' : 'default'}>{footnote}</ImportFootnote>
          {result ? (
            <Button onClick={onClose}>Concluir</Button>
          ) : (
            <>
              <Button variant="secondary" disabled={importing} onClick={parsing ? cancelReading : handleClose}>{parsing ? 'Interromper leitura' : 'Voltar'}</Button>
              <Button disabled={!canConfirm || parsing} loading={importing} loadingLabel="Importando…" onClick={() => void handleImport()}>
                {preview?.rows.length ? `Importar ${plural(preview.rows.length, 'veículo', 'veículos')}` : 'Importar veículos'}
              </Button>
            </>
          )}
        </div>
      </div>
    </Modal>
  )
}
