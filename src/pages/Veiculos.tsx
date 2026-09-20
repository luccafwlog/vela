import { useMemo, useState, type ChangeEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, Trash2, Upload } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { Card, EmptyState, InlineError, PageHeader } from '../components/ui/Card'
import { MetricCard } from '../components/ui/MetricCard'
import { FilterBar } from '../components/ui/FilterBar'
import { Field, Input, Select } from '../components/ui/Input'
import { TableFooterPagination } from '../components/ui/TableFooterPagination'
import { Modal } from '../components/ui/Modal'
import { PreviewBox } from '../components/ui/PreviewBox'
import { useToast } from '../components/ui/Toast'
import { TruncationNote } from '../components/shared/TruncationNote'
import { useConfirm } from '../components/ui/ConfirmDialog'
import { BulkActionsBar } from '../components/shared/BulkActionsBar'
import { VoyageCombobox } from '../components/shared/VoyageCombobox'
import { useAuth } from '../hooks/useAuth'
import { useCancellableFileRead } from '../hooks/useCancellableFileRead'
import { useRowSelection } from '../hooks/useRowSelection'
import { usePageFilters } from '../hooks/usePageFilters'
import { useVehicleOptions, useVehicles, useVoyageVehicleStats, type VehiclePageFilters } from '../hooks/useVehicles'
import { formatDate } from '../lib/utils'
import { deleteVehicles } from '../services/vehicles'
import { importVehicleRows, parseVehicleImportFile, type ParsedVehicleImport } from '../services/vehicleImport'
import { setContainerUnpackingLocation } from '../services/vaziosNatureza'
import { exportVehicleWorkbook } from '../services/exports'
import { listVoyageEscalaSchedulesByVoyageIds } from '../services/voyageRouteSchedules'
import { buildVoyageRailItems, type VoyageRailModuleStats } from '../services/voyageSummaries'
import { VoyageRail } from '../components/voyages/VoyageRail'
import { ImportIssuesPanel } from '../components/shared/ImportIssuesPanel'
import { rowErrorsToImportIssues } from '../services/importValidation'
import { ImportReadProgress } from '../components/shared/ImportReadProgress'

export function Veiculos() {
  const [searchParams] = useSearchParams()
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const confirm = useConfirm()
  const { isAdmin, user, profile } = useAuth()
  const canEditVehicles = Boolean(profile || user)
  const canDeleteVehicles = isAdmin
  const [deleting, setDeleting] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [unpackingLocations, setUnpackingLocations] = useState<Record<number, string>>({})
  const [savingContainerId, setSavingContainerId] = useState<number | null>(null)
  const [focusedContainerId, setFocusedContainerId] = useState<number | null>(null)
  const [bulkDesovaOpen, setBulkDesovaOpen] = useState(false)
  const [bulkDesovaValue, setBulkDesovaValue] = useState('')
  const [bulkDesovaSaving, setBulkDesovaSaving] = useState(false)
  const { data: options } = useVehicleOptions()
  const [selectedVoyageId, setSelectedVoyageId] = useState(searchParams.get('voyage') ?? '')
  const [importVoyageId, setImportVoyageId] = useState('')
  const { filters, setFilters, updateFilter } = usePageFilters<VehiclePageFilters>({
    search: '',
    brand: '',
    model: '',
    container: '',
    containerType: '',
    seal: '',
    bl: '',
    unpackingLocation: '',
    page: 1,
    pageSize: 20,
  })
  const selection = useRowSelection<number>(`${selectedVoyageId}:${JSON.stringify({ ...filters, page: undefined, pageSize: undefined })}`)
  const [importOpen, setImportOpen] = useState(false)
  const [fileName, setFileName] = useState('')
  const { preview: parsedImport, parsing, progress, readFile, cancel: cancelReading } = useCancellableFileRead<ParsedVehicleImport>(parseVehicleImportFile)
  const [importing, setImporting] = useState(false)
  const [autoSelectedImportOpen, setAutoSelectedImportOpen] = useState(false)
  const [importReport, setImportReport] = useState<{
    processed: number
    successCount: number
    errorCount: number
    errors: { row: number; message: string }[]
  } | null>(null)

  const allVoyageOptions = useMemo(() => options?.voyages ?? [], [options?.voyages])
  const voyageIds = useMemo(() => allVoyageOptions.map((voyage) => voyage.id), [allVoyageOptions])
  const { data: voyageVehicleStats } = useVoyageVehicleStats(voyageIds)
  const { data: escalaSchedulesByVoyage = new Map() } = useQuery({
    queryKey: ['vehicles-voyage-card-schedules', voyageIds],
    enabled: voyageIds.length > 0,
    queryFn: () => listVoyageEscalaSchedulesByVoyageIds(voyageIds),
  })
  const voyageRailItems = useMemo(() => {
    const moduleStats = new Map<number, VoyageRailModuleStats>()
    for (const voyage of allVoyageOptions) {
      const stats = voyageVehicleStats?.byVoyageId[voyage.id]
      moduleStats.set(voyage.id, {
        hasVehicles: (stats?.totalVehicles ?? 0) > 0,
        vehicleContainerNumbers: stats?.containerNumbers ?? [],
        vehiclePorts: Object.keys(stats?.byPod ?? {}),
      })
    }
    return buildVoyageRailItems(
      allVoyageOptions.map((voyage) => ({
        id: voyage.id,
        voyage_number: voyage.voyage_number,
        status: 'active',
        vessel: { name: voyage.vessel?.name ?? 'Navio', carrier: null },
      })),
      escalaSchedulesByVoyage,
      moduleStats,
    )
  }, [allVoyageOptions, escalaSchedulesByVoyage, voyageVehicleStats])

  // Ajustes de estado durante o render (sem useEffect): cada condição se
  // auto-falsifica após o setState, convergindo em um re-render.
  if (importOpen && !autoSelectedImportOpen && !importVoyageId) {
    if (selectedVoyageId) {
      setImportVoyageId(selectedVoyageId)
      setAutoSelectedImportOpen(true)
    } else if (allVoyageOptions.length === 1) {
      setImportVoyageId(String(allVoyageOptions[0].id))
      setAutoSelectedImportOpen(true)
    }
  }

  const voyageId = selectedVoyageId ? Number(selectedVoyageId) : null
  const importTargetVoyageId = importVoyageId ? Number(importVoyageId) : null
  const { data, isLoading, error } = useVehicles(voyageId, filters)
  const totalPages = Math.max(1, Math.ceil((data?.count ?? 0) / filters.pageSize))

  const activeFilterCount = (['search', 'brand', 'model', 'container', 'containerType', 'seal', 'bl', 'unpackingLocation'] as (keyof VehiclePageFilters)[])
    .filter((key) => String(filters[key] ?? '').trim() !== '').length

  function clearFilters() {
    setFilters((current) => ({ ...current, search: '', brand: '', model: '', container: '', containerType: '', seal: '', bl: '', unpackingLocation: '', page: 1 }))
  }

  function resetImportState() {
    setImportOpen(false)
    setImportVoyageId('')
    setFileName('')
    cancelReading()
    setImportReport(null)
    setImporting(false)
    setAutoSelectedImportOpen(false)
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null
    setFileName(file?.name ?? '')
    setImportReport(null)

    try {
      const parsed = await readFile(file)
      if (!parsed) return
      showToast(
        parsed.rowErrors.length
          ? `Preview carregado com ${parsed.rows.length} linha(s) valida(s) e ${parsed.rowErrors.length} erro(s).`
          : `Preview carregado com ${parsed.rows.length} linha(s) valida(s).`,
        parsed.rowErrors.length ? 'info' : 'success',
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha ao ler arquivo.'
      showToast(message, 'error')
    }
  }

  async function handleImport() {
    if (!importTargetVoyageId || !parsedImport?.rows.length || parsedImport.rowErrors.length) return

    setImporting(true)
    try {
      const result = await importVehicleRows({ voyageId: importTargetVoyageId, rows: parsedImport.rows })
      setImportReport(result)

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['vehicles'] }),
        queryClient.invalidateQueries({ queryKey: ['vehicle-stats'] }),
        queryClient.invalidateQueries({ queryKey: ['voyage-vehicle-stats'] }),
        queryClient.invalidateQueries({ queryKey: ['bl-detail'] }),
        // P0-4: a seção "Veículos" do ADR conta por marca/VIN a partir de
        // `vehicles`; sem esta linha, importar veículos não atualizava a aba.
        queryClient.invalidateQueries({ queryKey: ['agency-report'] }),
      ])

      showToast(
        `Importacao concluida: ${result.successCount} sucesso(s), ${result.errorCount} erro(s), ${result.processed} processado(s).`,
        result.errorCount ? 'info' : 'success',
      )
      if (!result.errorCount) {
        resetImportState()
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha ao importar veiculos.'
      showToast(`Falha ao importar veiculos: ${message}`, 'error')
    } finally {
      setImporting(false)
    }
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

  async function invalidateAfterDelete() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['vehicles'] }),
      queryClient.invalidateQueries({ queryKey: ['vehicle-stats'] }),
      queryClient.invalidateQueries({ queryKey: ['voyage-vehicle-stats'] }),
      queryClient.invalidateQueries({ queryKey: ['bl-detail'] }),
      queryClient.invalidateQueries({ queryKey: ['agency-report'] }),
    ])
  }

  async function handleUnpackingLocationSave(containerId: number, value: string, currentValue: string | null) {
    const unpackingLocation = value.trim() || null
    if (unpackingLocation === currentValue) return

    setSavingContainerId(containerId)
    try {
      await setContainerUnpackingLocation(containerId, unpackingLocation)
      setUnpackingLocations((current) => ({ ...current, [containerId]: unpackingLocation ?? '' }))
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['vehicles'] }),
        queryClient.invalidateQueries({ queryKey: ['agency-report'] }),
      ])
      showToast('Local de desova atualizado.', 'success')
    } catch (err) {
      setUnpackingLocations((current) => ({ ...current, [containerId]: currentValue ?? '' }))
      showToast(err instanceof Error ? err.message : 'Falha ao atualizar local de desova.', 'error')
    } finally {
      setSavingContainerId(null)
    }
  }

  async function handleBulkUnpackingLocation() {
    const value = bulkDesovaValue.trim() || null
    const containerIds = [...new Set(
      (data?.filteredIds ?? [])
        .filter((vehicleId) => selection.isSelected(vehicleId))
        .map((vehicleId) => data?.containerIdByVehicleId?.[vehicleId])
        .filter((containerId): containerId is number => typeof containerId === 'number'),
    )]
    if (!containerIds.length) {
      showToast('Nenhum container nas linhas selecionadas.', 'info')
      return
    }
    setBulkDesovaSaving(true)
    try {
      await Promise.all(containerIds.map((containerId) => setContainerUnpackingLocation(containerId, value)))
      setUnpackingLocations((current) => {
        const next = { ...current }
        for (const containerId of containerIds) next[containerId] = value ?? ''
        return next
      })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['vehicles'] }),
        queryClient.invalidateQueries({ queryKey: ['agency-report'] }),
      ])
      showToast(`Local de desova aplicado a ${containerIds.length} container(s).`, 'success')
      setBulkDesovaOpen(false)
      setBulkDesovaValue('')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Falha ao aplicar local de desova.', 'error')
    } finally {
      setBulkDesovaSaving(false)
    }
  }

  async function runDelete(ids: number[], message: string) {
    const ok = await confirm({ message, tone: 'danger', confirmLabel: 'Excluir' })
    if (!ok) return

    setDeleting(true)
    try {
      await deleteVehicles(ids, user?.id)
      selection.clear()
      await invalidateAfterDelete()
      showToast(ids.length === 1 ? 'Veiculo excluido.' : `${ids.length} veiculos excluidos.`, 'success')
    } catch (err) {
      const detail = err instanceof Error ? err.message : 'erro desconhecido'
      showToast(`Falha ao excluir veiculo(s): ${detail}`, 'error')
    } finally {
      setDeleting(false)
    }
  }

  function handleDeleteOne(id: number, chassis: string) {
    return runDelete([id], `Excluir o veiculo ${chassis}? Esta acao e irreversivel.`)
  }

  function handleDeleteSelected() {
    return runDelete([...selection.selected], `Excluir ${selection.count} veiculo(s) selecionado(s)? Esta acao e irreversivel.`)
  }

  const filteredRowIds = data?.filteredIds ?? []
  const allPageSelected = filteredRowIds.length > 0 && filteredRowIds.every((id) => selection.isSelected(id))
  const columnCount = canDeleteVehicles ? 12 : 10

  return (
    <>
      <PageHeader
        title="Veículos"
        description="Gestão e importação de veículos vinculados a viagem, containers e BLs."
        action={(
          <div className="flex flex-wrap gap-2">
            {voyageId ? <Button variant="secondary" loading={exporting} disabled={!data?.rows.length} onClick={() => void handleExport()}><Download size={16} /> Exportar Excel</Button> : null}
            {canEditVehicles ? (
          <Button variant="secondary" onClick={() => setImportOpen(true)}>
            <Upload size={16} />
            Importar Veículos
          </Button>
            ) : null}
          </div>
        )}
      />

      <section className="mb-5 min-w-0">
        <VoyageRail
          items={voyageRailItems}
          selectedId={selectedVoyageId ? Number(selectedVoyageId) : null}
          onSelect={(id) => setSelectedVoyageId(String(id))}
        />
      </section>

      <Card className="mb-5">
        <div className="grid gap-4 md:grid-cols-2">
          <VoyageCombobox
            clearable
            label="Viagem"
            selectedVoyageId={selectedVoyageId}
            onSelect={(id) => setSelectedVoyageId(id == null ? '' : String(id))}
          />
        </div>
        {!voyageId ? (
          <div className="mt-3 text-sm text-[var(--app-muted)]">
            Selecione uma viagem para ver a lista de veículos.
          </div>
        ) : null}
      </Card>

      {!voyageId ? (
        <Card className="overflow-hidden p-0">
          <EmptyState
            title="Selecione uma viagem"
            description="Os veículos, indicadores e filtros aparecem após escolher a viagem acima. Para importar, use o botão Importar Veículos."
          />
        </Card>
      ) : (
        <>

      <div className="mb-5 grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-[repeat(auto-fit,minmax(200px,1fr))]">
        <MetricCard label="Veiculos filtrados" value={isLoading ? '...' : data?.count ?? 0} />
        <MetricCard label="Containers distintos" value={isLoading ? '...' : data?.distinctContainerCount ?? 0} />
        <MetricCard label="BLs distintos" value={isLoading ? '...' : data?.distinctBlCount ?? 0} />
        <MetricCard label="Peso total (kg)" value={isLoading ? '...' : Number(data?.totalWeightKg ?? 0).toLocaleString('pt-BR')} />
      </div>

      <div className="mb-5 grid gap-4 xl:grid-cols-3">
        <BreakdownCard
          title="Veiculos por marca"
          loading={isLoading}
          items={data?.vehiclesByBrand ?? []}
          emptyLabel="Nenhuma marca no filtro."
        />
        <BreakdownCard
          title="Veiculos por tipo de container"
          loading={isLoading}
          items={data?.vehiclesByContainerType ?? []}
          emptyLabel="Nenhum tipo no filtro."
        />
        <BreakdownCard
          title="Containers por tipo de container"
          loading={isLoading}
          items={data?.containersByContainerType ?? []}
          emptyLabel="Nenhum container no filtro."
        />
      </div>

      <FilterBar activeCount={activeFilterCount} onClear={clearFilters}>
        <div className="app-filter-grid">
          <Field label="Buscar por chassi">
            <Input value={filters.search} onChange={(event) => updateFilter('search', event.target.value)} />
          </Field>
          <Field label="Filtro por marca">
            <Select value={filters.brand} onChange={(event) => updateFilter('brand', event.target.value)}>
              <option value="">Todas</option>
              {(data?.vehiclesByBrand ?? []).map((item) => <option key={item.label} value={item.label}>{item.label}</option>)}
            </Select>
          </Field>
          <Field label="Filtro por modelo">
            <Select value={filters.model} onChange={(event) => updateFilter('model', event.target.value)}>
              <option value="">Todos</option>
              {(data?.vehiclesByModel ?? []).map((item) => <option key={item.label} value={item.label}>{item.label}</option>)}
            </Select>
          </Field>
          <Field label="Filtro por tipo de container">
            <Select value={filters.containerType} onChange={(event) => updateFilter('containerType', event.target.value)}>
              <option value="">Todos</option>
              {(data?.vehiclesByContainerType ?? []).map((item) => <option key={item.label} value={item.label}>{item.label}</option>)}
            </Select>
          </Field>
          <Field label="Filtro por lacre">
            <Input value={filters.seal} onChange={(event) => updateFilter('seal', event.target.value)} />
          </Field>
          <Field label="Filtro por container">
            <Input value={filters.container} onChange={(event) => updateFilter('container', event.target.value)} />
          </Field>
          <Field label="Filtro por BL">
            <Input value={filters.bl} onChange={(event) => updateFilter('bl', event.target.value)} />
          </Field>
          <Field label="Filtro por local de desova">
            <Select value={filters.unpackingLocation} onChange={(event) => updateFilter('unpackingLocation', event.target.value)}>
              <option value="">Todos</option>
              {(data?.unpackingLocations ?? []).map((item) => <option key={item.label} value={item.label}>{item.label}</option>)}
            </Select>
          </Field>
        </div>
      </FilterBar>

      {canDeleteVehicles ? (
        <BulkActionsBar
          count={selection.count}
          onClear={selection.clear}
          onDelete={handleDeleteSelected}
          deleting={deleting}
          noun={['veiculo', 'veiculos']}
          extraActions={canEditVehicles ? (
            <Button variant="secondary" onClick={() => setBulkDesovaOpen(true)} disabled={deleting}>
              Definir local de desova
            </Button>
          ) : null}
        />
      ) : null}

      <Card className="overflow-hidden p-0">
        {error ? <InlineError message="Erro ao carregar veiculos." /> : null}
        <div className="app-table-scroll app-table-scroll--sticky">
          <table className="app-table app-table--compact min-w-[980px] text-left text-sm whitespace-nowrap">
            <thead>
              <tr>
                {canDeleteVehicles ? (
                  <th scope="col" className="px-4 py-3 w-10">
                    <input
                      type="checkbox"
                      aria-label="Selecionar todos os veiculos da pagina"
                      checked={allPageSelected}
                      onChange={() => selection.toggleMany(filteredRowIds)}
                    />
                  </th>
                ) : null}
                <th scope="col" className="px-4 py-3">Chassi</th>
                <th scope="col" className="px-4 py-3">Marca</th>
                <th scope="col" className="px-4 py-3">Modelo</th>
                <th scope="col" className="px-4 py-3">Peso</th>
                <th scope="col" className="px-4 py-3">Cubagem</th>
                <th scope="col" className="px-4 py-3">Container</th>
                <th scope="col" className="px-4 py-3">Tipo Container</th>
                <th scope="col" className="px-4 py-3">Lacre</th>
                <th scope="col" className="px-4 py-3">BL</th>
                <th scope="col" className="px-4 py-3">Local desova</th>
                {canDeleteVehicles ? <th scope="col" className="px-4 py-3 w-16">Ações</th> : null}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td className="px-4 py-8 text-center text-[var(--app-muted)]" colSpan={columnCount}>
                    Carregando veiculos...
                  </td>
                </tr>
              ) : null}
              {!isLoading && !data?.rows.length ? (
                <tr>
                  <td colSpan={columnCount} className="p-0">
                    <EmptyState title="Nenhum veiculo encontrado." description="Importe uma planilha de veiculos ou ajuste os filtros." />
                  </td>
                </tr>
              ) : null}
              {data?.rows.map((row) => (
                <tr key={row.id} className="hover:bg-[#21262d]/60">
                  {canDeleteVehicles ? (
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        aria-label={`Selecionar veiculo ${row.chassis}`}
                        checked={selection.isSelected(row.id)}
                        onChange={() => selection.toggle(row.id)}
                      />
                    </td>
                  ) : null}
                  <td className="px-4 py-3 font-semibold text-[var(--app-text-strong)]">{row.chassis}</td>
                  <td className="px-4 py-3">{row.brand}</td>
                  <td className="px-4 py-3">{row.model}</td>
                  <td className="px-4 py-3">{Number(row.weight_kg).toLocaleString('pt-BR')} kg</td>
                  <td className="px-4 py-3">{Number(row.cbm).toLocaleString('pt-BR')}</td>
                  <td className="px-4 py-3">{row.container?.container_number ?? '-'}</td>
                  <td className="px-4 py-3">{row.container?.type ?? '-'}</td>
                  <td className="px-4 py-3">{row.container?.seal_number ?? '-'}</td>
                  <td className="px-4 py-3">
                    {row.bl?.id ? (
                      <Link className="app-table__action" to={`/bls/${row.bl.id}`}>{row.bl.id}</Link>
                    ) : '-'}
                  </td>
                  <td className="px-4 py-3">
                    {row.container ? (
                      <div className="grid gap-1">
                        <Input
                          aria-label={`Local de desova do container ${row.container.container_number}`}
                          disabled={!canEditVehicles || savingContainerId === row.container.id}
                          title={`Aplica a todos os ${data?.vehicleCountByContainerId?.[row.container.id] ?? 1} veículos do container ${row.container.container_number}`}
                          value={unpackingLocations[row.container.id] ?? row.container.unpacking_location ?? ''}
                          onBlur={(event) => handleUnpackingLocationSave(
                            row.container!.id,
                            event.target.value,
                            row.container!.unpacking_location,
                          )}
                          onChange={(event) => setUnpackingLocations((current) => ({
                            ...current,
                            [row.container!.id]: event.target.value,
                          }))}
                          onFocus={() => setFocusedContainerId(row.container!.id)}
                          onBlurCapture={() => setFocusedContainerId(null)}
                          placeholder="Ex.: Pátio 3"
                        />
                        {focusedContainerId === row.container.id ? (
                          <span className="text-xs text-[var(--app-muted)]">
                            Aplica a todos os {data?.vehicleCountByContainerId?.[row.container.id] ?? 1} veículos do container {row.container.container_number}.
                          </span>
                        ) : null}
                      </div>
                    ) : '-'}
                  </td>
                  {canDeleteVehicles ? (
                    <td className="px-4 py-3">
                      <button
                        onClick={() => handleDeleteOne(row.id, row.chassis)}
                        disabled={deleting}
                        className="text-red-400 hover:text-red-300 disabled:opacity-40"
                        title="Excluir veiculo"
                        aria-label={`Excluir veiculo ${row.chassis}`}
                      >
                        <Trash2 size={15} />
                      </button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <TableFooterPagination
          page={filters.page}
          pageSize={filters.pageSize}
          totalCount={data?.count ?? 0}
          totalPages={totalPages}
          onPageChange={(page) => updateFilter('page', page)}
          onPageSizeChange={(pageSize) => updateFilter('pageSize', pageSize)}
        />
      </Card>

        </>
      )}

      <Modal open={importOpen && canEditVehicles} onClose={resetImportState} title="Importar Veículos">
        <div className="grid gap-5">
          <div className="app-panel app-panel--padded text-sm">
            <div className="app-panel__title">Estrutura obrigatoria da planilha</div>
            <div className="mt-2">CHASSI, MARCA, MODELO, PESO, CUBAGEM, CONTAINER, TIPO_CONTAINER, LACRE, BL.</div>
            <div className="app-panel__meta mt-2">
              Cada linha valida veiculo, container e BL antes da persistencia. Linhas inválidas são rejeitadas individualmente.
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <a
                className="app-btn app-btn--secondary"
                href="/templates/veiculos-modelo.xlsx"
                download="veiculos-modelo.xlsx"
              >
                <Download size={16} />
                Baixar modelo .xlsx
              </a>
              <a
                className="app-btn app-btn--secondary"
                href="/templates/veiculos-modelo.csv"
                download="veiculos-modelo.csv"
              >
                <Download size={16} />
                Baixar modelo .csv
              </a>
            </div>
          </div>

          <VoyageCombobox
            required
            label="Viagem de destino"
            selectedVoyageId={importVoyageId}
            onSelect={(id) => setImportVoyageId(id == null ? '' : String(id))}
          />

          <Field label="Arquivo .xlsx, .xls ou .csv">
            <Input accept=".xlsx,.xls,.csv" type="file" onChange={handleFileChange} />
          </Field>

          {fileName ? <div className="app-panel__meta">Arquivo selecionado: {fileName}</div> : null}
          {parsing ? <ImportReadProgress progress={progress} /> : null}

          {parsedImport ? (
            <div className="grid gap-4">
              <div className="grid gap-3 grid-cols-[repeat(auto-fit,minmax(150px,1fr))]">
                <PreviewBox label="Linhas validas" value={parsedImport.rows.length} variant="kpi" tone="navy" />
                <PreviewBox label="Erros de estrutura" value={parsedImport.rowErrors.length} variant="kpi" tone="navy" />
                <PreviewBox label="Viagem selecionada" value={formatImportVoyageLabel(allVoyageOptions, importVoyageId)} variant="kpi" tone="navy" />
              </div>

              <div className="app-table-scroll max-h-72 rounded-xl border border-[var(--app-border)]">
                <table className="app-table app-table--compact min-w-[980px] text-left text-sm">
                  <thead>
                    <tr>
                      <th scope="col" className="px-3 py-2">Chassi</th>
                      <th scope="col" className="px-3 py-2">Marca</th>
                      <th scope="col" className="px-3 py-2">Modelo</th>
                      <th scope="col" className="px-3 py-2">Container</th>
                      <th scope="col" className="px-3 py-2">Tipo</th>
                      <th scope="col" className="px-3 py-2">Lacre</th>
                      <th scope="col" className="px-3 py-2">BL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsedImport.rows.slice(0, 20).map((row) => (
                      <tr key={`${row.rowNumber}-${row.chassis}`}>
                        <td className="px-3 py-2 font-semibold text-[var(--app-text-strong)]">{row.chassis}</td>
                        <td className="px-3 py-2">{row.brand}</td>
                        <td className="px-3 py-2">{row.model}</td>
                        <td className="px-3 py-2">{row.container_number}</td>
                        <td className="px-3 py-2">{row.container_type}</td>
                        <td className="px-3 py-2">{row.seal_number}</td>
                        <td className="px-3 py-2">{row.bl_id}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <TruncationNote shown={20} total={parsedImport.rows.length} noun="veículo" nounPlural="veículos" />

              <ImportIssuesPanel issues={rowErrorsToImportIssues(parsedImport.rowErrors)} filename="veiculos-issues.csv" />
            </div>
          ) : null}

          {importReport ? (
            <div className="app-panel app-panel--padded grid gap-4">
              <div className="grid gap-3 grid-cols-[repeat(auto-fit,minmax(150px,1fr))]">
                <PreviewBox label="Processados" value={importReport.processed} variant="kpi" tone="blue" />
                <PreviewBox label="Sucesso" value={importReport.successCount} variant="kpi" tone="green" />
                <PreviewBox label="Erros" value={importReport.errorCount} variant="kpi" tone="gold" />
              </div>
              {importReport.errors.length ? (
                <div className="max-h-48 overflow-auto rounded-xl border border-[var(--app-border)] p-3 text-sm text-[var(--app-text)]">
                  {importReport.errors.map((item) => (
                    <div key={`${item.row}-${item.message}`} className="border-b border-[var(--app-border)] py-1 last:border-b-0">
                      Linha {item.row}: {item.message}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-sm text-green-700">Nenhum erro de integracao no lote importado.</div>
              )}
              <div className="app-panel__meta">Atualizado em {formatDate(new Date().toISOString())}</div>
            </div>
          ) : null}

          <div className="app-modal__actions">
            <Button variant="secondary" disabled={importing} onClick={parsing ? cancelReading : resetImportState}>
              {parsing ? 'Cancelar leitura' : 'Fechar'}
            </Button>
            <Button disabled={!importTargetVoyageId || !parsedImport?.rows.length || Boolean(parsedImport.rowErrors.length) || Boolean(importReport)} loading={importing} onClick={handleImport}>
              Confirmar importação
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={bulkDesovaOpen} title="Definir local de desova" onClose={() => setBulkDesovaOpen(false)}>
        <div className="grid gap-3">
          <p className="text-sm text-[var(--app-muted)]">
            Aplica aos containers das linhas selecionadas. Deixe vazio para limpar o local.
          </p>
          <Field label="Local de desova">
            <Input value={bulkDesovaValue} onChange={(event) => setBulkDesovaValue(event.target.value)} placeholder="Ex.: Pátio 3" />
          </Field>
          <Button onClick={() => void handleBulkUnpackingLocation()} loading={bulkDesovaSaving}>Aplicar</Button>
        </div>
      </Modal>
    </>
  )
}


function formatImportVoyageLabel(
  voyages: Array<{ id: number; voyage_number: string | null; vessel?: { name?: string | null } | null }>,
  voyageId: string,
) {
  if (!voyageId) return '-'
  const voyage = voyages.find((item) => String(item.id) === voyageId)
  if (!voyage) return 'Selecionada'
  return `${voyage.vessel?.name ?? 'Navio'} / ${voyage.voyage_number ?? '-'}`
}

function BreakdownCard({
  title,
  items,
  loading,
  emptyLabel,
}: {
  title: string
  items: Array<{ label: string; count: number }>
  loading: boolean
  emptyLabel: string
}) {
  return (
    <Card>
      <div className="app-panel__title">{title}</div>
      <div className="mt-3 grid gap-2">
        {loading ? <div className="app-panel__meta">Carregando...</div> : null}
        {!loading && !items.length ? <div className="app-panel__meta">{emptyLabel}</div> : null}
        {!loading
          ? items.slice(0, 8).map((item) => (
              <div key={item.label} className="flex items-center justify-between rounded-lg border border-[var(--app-border)] bg-[var(--app-surface-muted)] px-3 py-2 text-sm">
                <span className="truncate pr-2 text-[var(--app-text)]">{item.label}</span>
                <span className="font-semibold text-[var(--app-text-strong)]">{item.count}</span>
              </div>
            ))
          : null}
      </div>
    </Card>
  )
}
