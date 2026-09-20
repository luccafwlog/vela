import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, Upload } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { Card, EmptyState, InlineError, PageHeader } from '../components/ui/Card'
import { FilterBar } from '../components/ui/FilterBar'
import { Field, Input, Select } from '../components/ui/Input'
import { TableFooterPagination } from '../components/ui/TableFooterPagination'
import { useToast } from '../components/ui/Toast'
import { TruncationNote } from '../components/shared/TruncationNote'
import { VoyageCombobox } from '../components/shared/VoyageCombobox'
import { FileImportModal } from '../components/shared/FileImportModal'
import { useAuth } from '../hooks/useAuth'
import { PAGE_SIZES, usePageFilters } from '../hooks/usePageFilters'
import { describeActiveFilters, describeEmptyState, formatResultCount } from '../lib/operationalState'
import { formatDate } from '../lib/utils'
import { useRowSelection } from '../hooks/useRowSelection'
import { BulkActionsBar } from '../components/shared/BulkActionsBar'
import {
  parseVaziosImportacaoFile,
  importVaziosImportacaoManifest,
  listVaziosImportacaoContainers,
  listVaziosImportacaoManifests,
  type ParsedVaziosImportacaoManifest,
} from '../services/vaziosImportacaoImport'
import { exportVaziosImportacaoWorkbook } from '../services/exports'
import { rowErrorsToImportIssues } from '../services/importValidation'
import { ImportIssuesPanel } from '../components/shared/ImportIssuesPanel'
import {
  fetchVaziosImportacaoContainerIds,
  setVazioImportacaoNatureza,
  setVaziosImportacaoNaturezaMany,
} from '../services/vaziosNatureza'
import { afterManifestoImportado } from '../services/cacheEffects'
import { inspectImportUpload } from '../services/importText'

const exportPageSize = 200

type Filters = {
  search: string
  manifestId: string
  voyageId: string
  pod: string
  page: number
  pageSize: number
}

function VaziosImportacaoPreview({ manifest }: { manifest: ParsedVaziosImportacaoManifest }) {
  return (
    <div className="grid gap-4">
      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-xl border border-[#30363d] bg-[#0d1117] p-3"><div className="text-xs uppercase tracking-wider text-slate-500">Containers validos</div><div className="mt-1 text-2xl font-bold text-white">{manifest.containers.length}</div></div>
        <div className="rounded-xl border border-[#30363d] bg-[#0d1117] p-3"><div className="text-xs uppercase tracking-wider text-slate-500">Avisos</div><div className="mt-1 text-2xl font-bold text-white">{manifest.rowErrors.length}</div></div>
      </div>
      <div className="app-table-scroll max-h-64 rounded-xl border border-[#30363d]">
        <table className="app-table app-table--compact min-w-[480px] text-left text-sm whitespace-nowrap">
          <thead className="bg-[#0d1117] text-xs uppercase tracking-wider text-slate-500"><tr><th scope="col" className="px-3 py-2">Container</th><th scope="col" className="px-3 py-2">Tipo</th><th scope="col" className="px-3 py-2">Tara (kg)</th></tr></thead>
          <tbody className="divide-y divide-[#30363d]">{manifest.containers.slice(0, 25).map((container, index) => <tr key={`${container.container_number}-${index}`}><td className="px-3 py-2 font-semibold text-white">{container.container_number}</td><td className="px-3 py-2">{container.container_type ?? '-'}</td><td className="px-3 py-2">{container.tare_kg != null ? Number(container.tare_kg).toLocaleString('pt-BR') : '-'}</td></tr>)}</tbody>
        </table>
      </div>
      <TruncationNote shown={25} total={manifest.containers.length} noun="container" nounPlural="containers" />
      <ImportIssuesPanel issues={rowErrorsToImportIssues(manifest.rowErrors)} filename="vazios-importacao-issues.csv" />
    </div>
  )
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
  const [voyageId, setVoyageId] = useState(searchParams.get('voyage') ?? '')
  const [description, setDescription] = useState('')
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

  function resetUpload() {
    setUploadOpen(false)
    setVoyageId('')
    setDescription('')
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
          <button
            type="button"
            className="font-semibold text-[var(--app-link)] hover:underline disabled:opacity-50"
            disabled={selectingAllFiltered}
            onClick={() => void handleSelectAllFiltered()}
          >
            {selectingAllFiltered ? 'Selecionando...' : `Selecionar todos os ${data?.count} containers do filtro`}
          </button>
        </div>
      ) : null}

      <Card className="overflow-hidden p-0">
        <div className="flex flex-col gap-1 border-b border-[#30363d] px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
          <span className="font-semibold text-white">{formatResultCount(data?.count ?? 0, 'container retornado', 'containers retornados')}</span>
          <span className="text-xs text-slate-400">{filterDescription}</span>
        </div>
        {error ? <InlineError message="Erro ao carregar containers." /> : null}

        <div className="app-table-scroll app-table-scroll--sticky">
          <table className="app-table app-table--compact min-w-[600px] text-left text-sm whitespace-nowrap">
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
                <th scope="col" className="px-4 py-3">Navio / Viagem</th>
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
                    <td className="px-4 py-3 font-semibold text-[#58a6ff]">{row.container_number}</td>
                    <td className="px-4 py-3">{row.container_type ?? '-'}</td>
                    <td className="px-4 py-3">{row.tare_kg != null ? Number(row.tare_kg).toLocaleString('pt-BR') : '-'}</td>
                    <td className="px-4 py-3">{row.pod ?? '-'}</td>
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
                    <td className="px-4 py-3">
                      {row.manifest?.voyage
                        ? `${row.manifest.voyage.vessel?.name ?? '-'} / ${row.manifest.voyage.voyage_number}`
                        : '-'}
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
        <FileImportModal
          title="Importar Planilha de Vazios (Importacao)"
          accept=".xlsx,.xls,.csv"
          parser={parseVaziosImportacaoFile}
          inspectFile={inspectImportUpload}
          importer={async (nextManifest, _file, override) => {
            if (!user || !voyageId) return
            await importVaziosImportacaoManifest({ manifest: nextManifest, uploadedBy: user.id, voyageId: Number(voyageId), description: description.trim() || undefined, allowRowErrors: Boolean(override) })
            await afterManifestoImportado(queryClient, { voyageId })
            showToast(`${nextManifest.containers.length} containers importados.`, 'success')
          }}
          canImport={(nextManifest, override) => nextManifest.containers.length > 0 && (nextManifest.rowErrors.length === 0 || Boolean(override))}
          getIssues={(nextManifest) => rowErrorsToImportIssues(nextManifest.rowErrors)}
          ready={Boolean(voyageId && user)}
          prerequisite={<VoyageCombobox required label="Viagem de destino" selectedVoyageId={voyageId} onSelect={(id) => setVoyageId(id == null ? '' : String(id))} />}
          helper={
            <>
              <div className="rounded-xl border border-[#30363d] bg-[#0d1117] p-4 text-sm text-slate-300"><div className="font-semibold text-white">Formato esperado</div><div className="mt-2 text-slate-400">Colunas: <strong>Container</strong> (obrigatorio), <strong>Tipo</strong>, <strong>Tara</strong> (kg).</div></div>
              <Field label="Descricao (opcional)"><Input placeholder="Ex: Importacao semana 15" value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
            </>
          }
          renderPreview={(nextManifest) => <VaziosImportacaoPreview manifest={nextManifest} />}
          onClose={resetUpload}
        />
      ) : null}

    </>
  )
}
