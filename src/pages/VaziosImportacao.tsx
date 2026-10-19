import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, Upload } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { CopyValue } from '../components/ui/CopyValue'
import { NoValue } from '../components/ui/NoValue'
import { Card, EmptyState, InlineError, PageHeader } from '../components/ui/Card'
import { FilterBar } from '../components/ui/FilterBar'
import { Field, Input, Select } from '../components/ui/Input'
import { TableFooterPagination } from '../components/ui/TableFooterPagination'
import { useToast } from '../components/ui/Toast'
import { VoyageCombobox } from '../components/shared/VoyageCombobox'
import { VaziosImportacaoImportModal } from '../components/shared/VaziosImportacaoImportModal'
import { useAuth } from '../hooks/useAuth'
import { PAGE_SIZES, usePageFilters } from '../hooks/usePageFilters'
import { describeActiveFilters, describeEmptyState, formatResultCount } from '../lib/operationalState'
import { formatDate } from '../lib/utils'
import { useRowSelection } from '../hooks/useRowSelection'
import { BulkActionsBar } from '../components/shared/BulkActionsBar'
import {
  listVaziosImportacaoContainers,
  listVaziosImportacaoManifests,
} from '../services/vaziosImportacaoImport'
import { exportVaziosImportacaoWorkbook } from '../services/exports'
import {
  fetchVaziosImportacaoContainerIds,
  setVazioImportacaoNatureza,
  setVaziosImportacaoNaturezaMany,
} from '../services/vaziosNatureza'

const exportPageSize = 200

type Filters = {
  search: string
  manifestId: string
  voyageId: string
  pod: string
  page: number
  pageSize: number
}

export function VaziosImportacao() {
  const [searchParams] = useSearchParams()
  const queryClient = useQueryClient()
  const { user, profile } = useAuth()
  const canImport = Boolean(profile || user)
  const { showToast } = useToast()

  const { filters, setFilters, updateFilter } = usePageFilters<Filters>({
    search: '',
    manifestId: '',
    voyageId: searchParams.get('voyage') ?? '',
    pod: searchParams.get('pod') ?? '',
    page: 1,
    pageSize: 20,
  })

  const [uploadOpen, setUploadOpen] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [updatingNaturezaId, setUpdatingNaturezaId] = useState<string | null>(null)
  const [bulkUpdating, setBulkUpdating] = useState(false)
  const [selectingAllFiltered, setSelectingAllFiltered] = useState(false)

  const selection = useRowSelection<string>(filters)

  const { data, isLoading, error } = useQuery({
    queryKey: ['vazios-importacao-containers', filters],
    queryFn: () => listVaziosImportacaoContainers(filters),
  })

  const { data: manifests } = useQuery({
    queryKey: ['vazios-importacao-manifests'],
    queryFn: listVaziosImportacaoManifests,
  })

  const totalPages = Math.max(1, Math.ceil((data?.count ?? 0) / filters.pageSize))
  const pageContainerIds = (data?.rows ?? []).map((row) => row.id)
  const allPageSelected = pageContainerIds.length > 0 && pageContainerIds.every((id) => selection.isSelected(id))
  const hasMultiplePages = (data?.count ?? 0) > pageContainerIds.length
  const isAllFilteredSelected = selection.count === (data?.count ?? 0) && (data?.count ?? 0) > 0

  const activeFilterCount = (['search', 'manifestId', 'voyageId', 'pod'] as (keyof Filters)[])
    .filter((key) => String(filters[key] ?? '').trim() !== '').length
  const filterDescription = describeActiveFilters([
    { label: 'Texto', value: filters.search },
    { label: 'Manifesto', value: filters.manifestId },
    { label: 'Viagem', value: filters.voyageId },
    { label: 'POD', value: filters.pod },
  ])
  const emptyState = describeEmptyState({
    entitySingular: 'container',
    entityPlural: 'containers',
    hasActiveFilters: activeFilterCount > 0,
    emptyWithoutFilters: 'Nenhum container vazio importado ainda.',
    emptyWithFilters: 'Nenhum container encontrado.',
  })

  function clearFilters() {
    setFilters((f) => ({ ...f, search: '', manifestId: '', voyageId: '', pod: '', page: 1 }))
  }

  async function handleSelectAllFiltered() {
    setSelectingAllFiltered(true)
    try {
      const allIds = await fetchVaziosImportacaoContainerIds(filters)
      selection.toggleMany(allIds)
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Falha ao selecionar todos os containers.', 'error')
    } finally {
      setSelectingAllFiltered(false)
    }
  }

  async function handleBulkNatureza(natureza: 'cama' | 'cover_plate' | null) {
    const selectedIds = Array.from(selection.selected)
    if (!selectedIds.length) return
    setBulkUpdating(true)
    try {
      await setVaziosImportacaoNaturezaMany(selectedIds, natureza)
      await queryClient.invalidateQueries({ queryKey: ['vazios-importacao-containers'] })
      await queryClient.invalidateQueries({ queryKey: ['vazios-importacao-stats'] })
      await queryClient.invalidateQueries({ queryKey: ['agency-report'] })
      const label = natureza === 'cama' ? 'Cama' : natureza === 'cover_plate' ? 'Cover plate' : 'Sem natureza'
      showToast(`${selectedIds.length} container(s) atualizado(s) como ${label}.`, 'success')
      selection.clear()
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Falha ao atualizar containers em lote.', 'error')
    } finally {
      setBulkUpdating(false)
    }
  }

  async function handleExport() {
    setExporting(true)
    try {
      const rows = []
      let page = 1
      let total = 0
      while (true) {
        const result = await listVaziosImportacaoContainers({ ...filters, page, pageSize: exportPageSize })
        if (page === 1) total = result.count
        rows.push(...result.rows)
        if (rows.length >= total || result.rows.length === 0) break
        page += 1
      }
      await exportVaziosImportacaoWorkbook(rows)
      showToast(`${rows.length} container(s) exportado(s).`, 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Falha ao exportar vazios.', 'error')
    } finally {
      setExporting(false)
    }
  }

  async function handleNaturezaChange(id: string, natureza: 'cama' | 'cover_plate' | null) {
    setUpdatingNaturezaId(id)
    try {
      await setVazioImportacaoNatureza(id, natureza)
      await queryClient.invalidateQueries({ queryKey: ['vazios-importacao-containers'] })
      await queryClient.invalidateQueries({ queryKey: ['vazios-importacao-stats'] })
      await queryClient.invalidateQueries({ queryKey: ['agency-report'] })
      showToast('Natureza atualizada.', 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Falha ao atualizar natureza.', 'error')
    } finally {
      setUpdatingNaturezaId(null)
    }
  }

  const colSpanCount = canImport ? 9 : 8

  return (
    <>
      <PageHeader
        title="Vazios — Importação"
        description="Containers vazios que descarregam (chegam) ao porto. São os futuros vazios de exportação."
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" loading={exporting} onClick={handleExport}>
              <Download size={16} />
              Exportar
            </Button>
            {canImport ? (
              <Button onClick={() => setUploadOpen(true)}>
                <Upload size={16} />
                Importar Planilha
              </Button>
            ) : null}
          </div>
        }
      />

      <FilterBar activeCount={activeFilterCount} onClear={clearFilters}>
        <div className="app-filter-grid">
          <Field label="Texto livre">
            <Input
              placeholder="Container ou tipo"
              value={filters.search}
              onChange={(e) => updateFilter('search', e.target.value)}
            />
          </Field>
          <VoyageCombobox
            clearable
            label="Viagem"
            selectedVoyageId={filters.voyageId}
            onSelect={(id) => updateFilter('voyageId', id == null ? '' : String(id))}
          />
          <Field label="Manifesto">
            <Select value={filters.manifestId} onChange={(e) => updateFilter('manifestId', e.target.value)}>
              <option value="">Todos</option>
              {(manifests ?? []).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.description ? m.description : formatDate(m.imported_at)}{' '}
                  ({m.total_containers} ctrs)
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Por página">
            <Select value={filters.pageSize} onChange={(e) => updateFilter('pageSize', Number(e.target.value))}>
              {PAGE_SIZES.map((s) => (
                <option key={s} value={s}>{s}/pag.</option>
              ))}
            </Select>
          </Field>
        </div>
      </FilterBar>

      {canImport ? (
        <BulkActionsBar
          count={selection.count}
          onClear={selection.clear}
          deleting={bulkUpdating}
          noun={['container', 'containers']}
          extraActions={
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="secondary"
                disabled={bulkUpdating}
                onClick={() => void handleBulkNatureza('cama')}
              >
                Definir como Cama
              </Button>
              <Button
                variant="secondary"
                disabled={bulkUpdating}
                onClick={() => void handleBulkNatureza('cover_plate')}
              >
                Definir como Cover plate
              </Button>
              <Button
                variant="ghost"
                disabled={bulkUpdating}
                onClick={() => void handleBulkNatureza(null)}
              >
                Limpar Natureza
              </Button>
            </div>
          }
        />
      ) : null}

      {canImport && allPageSelected && hasMultiplePages && !isAllFilteredSelected ? (
        <div className="mb-3 flex items-center justify-between rounded-lg border border-[var(--app-border)] bg-[var(--app-surface-muted)] px-4 py-2 text-xs text-[var(--app-muted)]">
          <span>
            Todos os {pageContainerIds.length} containers desta página estão selecionados.
          </span>
          <Button
            variant="secondary"
            className="app-btn--sm"
            disabled={selectingAllFiltered}
            onClick={() => void handleSelectAllFiltered()}
          >
            {selectingAllFiltered ? 'Selecionando...' : `Selecionar todos os ${data?.count} containers do filtro`}
          </Button>
        </div>
      ) : null}

      <Card className="overflow-hidden p-0">
        <div className="flex flex-col gap-1 border-b border-[#30363d] px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
          <span className="font-semibold text-white">{formatResultCount(data?.count ?? 0, 'container retornado', 'containers retornados')}</span>
          <span className="text-xs text-slate-400">{filterDescription}</span>
        </div>
        {error ? <InlineError message="Erro ao carregar containers." /> : null}

        <div className="app-table-scroll app-table-scroll--sticky">
          <table className="app-table app-table--compact min-w-[600px] text-sm whitespace-nowrap">
            <caption className="sr-only">Containers vazios de importação</caption>
            <thead className="bg-[#0d1117] text-xs uppercase tracking-wider text-slate-500">
              <tr>
                {canImport ? (
                  <th scope="col" className="w-10 px-4 py-3">
                    <input
                      type="checkbox"
                      aria-label="Selecionar todos os containers da página"
                      checked={allPageSelected}
                      onChange={() => selection.toggleMany(pageContainerIds)}
                    />
                  </th>
                ) : null}
                <th scope="col" className="px-4 py-3">Container</th>
                <th scope="col" className="px-4 py-3">Tipo</th>
                <th scope="col" className="px-4 py-3">Tara (kg)</th>
                <th scope="col" className="px-4 py-3">POD</th>
                <th scope="col" className="px-4 py-3">Natureza</th>
                <th scope="col" className="app-table__text-head px-4 py-3">Navio / Viagem</th>
                <th scope="col" className="px-4 py-3">Manifesto</th>
                <th scope="col" className="px-4 py-3">Importado em</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#30363d]">
              {isLoading ? (
                <tr>
                  <td className="px-4 py-8 text-center text-slate-400" colSpan={colSpanCount}>Carregando...</td>
                </tr>
              ) : null}
              {!isLoading && data?.rows.length === 0 ? (
                <tr>
                  <td colSpan={colSpanCount} className="p-0">
                    <EmptyState
                      title={emptyState.title}
                      description={emptyState.description}
                    />
                  </td>
                </tr>
              ) : null}
              {(data?.rows ?? []).map((row) => {
                const manifestLabel = row.manifest?.description
                  ? row.manifest.description
                  : formatDate(row.manifest?.imported_at)
                return (
                  <tr key={row.id} className="hover:bg-[#21262d]/60">
                    {canImport ? (
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          aria-label={`Selecionar container ${row.container_number}`}
                          checked={selection.isSelected(row.id)}
                          onChange={() => selection.toggle(row.id)}
                        />
                      </td>
                    ) : null}
                    <td className="px-4 py-3 font-semibold text-[#58a6ff]"><CopyValue value={row.container_number} label="número do contêiner" /></td>
                    <td className="px-4 py-3">{row.container_type ?? <NoValue label="Sem tipo" />}</td>
                    <td className="px-4 py-3">{row.tare_kg != null ? Number(row.tare_kg).toLocaleString('pt-BR') : <NoValue label="Sem tara" />}</td>
                    <td className="px-4 py-3">{row.pod ?? <NoValue label="Sem POD" />}</td>
                    <td className="px-4 py-3">
                      <Select
                        aria-label={`Natureza do container ${row.container_number}`}
                        className="min-w-32"
                        disabled={!canImport || updatingNaturezaId === row.id || bulkUpdating}
                        value={row.natureza ?? ''}
                        onChange={(event) => handleNaturezaChange(
                          row.id,
                          event.target.value === '' ? null : event.target.value as 'cama' | 'cover_plate',
                        )}
                      >
                        <option value="">—</option>
                        <option value="cama">Cama</option>
                        <option value="cover_plate">Cover plate</option>
                      </Select>
                    </td>
                    <td className="app-table__text px-4 py-3">
                      {row.manifest?.voyage
                        ? `${row.manifest.voyage.vessel?.name ?? '-'} / ${row.manifest.voyage.voyage_number}`
                        : <NoValue label="Sem navio e viagem" />}
                    </td>
                    <td className="px-4 py-3">{manifestLabel}</td>
                    <td className="px-4 py-3">{formatDate(row.manifest?.imported_at)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <TableFooterPagination
          page={filters.page}
          pageSize={filters.pageSize}
          totalCount={data?.count ?? 0}
          totalPages={totalPages}
          onPageChange={(page) => updateFilter('page', page)}
        />
      </Card>

      {uploadOpen && canImport ? (
        <VaziosImportacaoImportModal defaultVoyageId={searchParams.get('voyage') ?? ''} onClose={() => setUploadOpen(false)} />
      ) : null}

    </>
  )
}
