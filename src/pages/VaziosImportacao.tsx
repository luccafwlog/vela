import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, Upload } from 'lucide-react'
import { Block } from '../components/ui/Block'
import { Button } from '../components/ui/Button'
import { CopyValue } from '../components/ui/CopyValue'
import { NoValue } from '../components/ui/NoValue'
import { StatusText } from '../components/ui/StatusText'
import { EmptyState, PageHeader } from '../components/ui/Card'
import { Field, Input, Select } from '../components/ui/Input'
import { SkeletonTable } from '../components/ui/Skeleton'
import { TableFooterPagination } from '../components/ui/TableFooterPagination'
import { useToast } from '../components/ui/Toast'
import { useConfirm } from '../components/ui/ConfirmDialog'
import { QueryStateGate } from '../components/shared/QueryStateGate'
import { VoyageCombobox } from '../components/shared/VoyageCombobox'
import { FileImportModal } from '../components/shared/FileImportModal'
import { VaziosImportacaoGuide, VaziosImportacaoPreview } from '../components/shared/VaziosImportacaoImportParts'
import { BulkActionsBar } from '../components/shared/BulkActionsBar'
import { useAuth } from '../hooks/useAuth'
import { useVoyageOptions } from '../hooks/useBls'
import { useDebouncedValue } from '../hooks/useDebouncedValue'
import { usePageFilters } from '../hooks/usePageFilters'
import { useRowSelection } from '../hooks/useRowSelection'
import { describeActiveFilters } from '../lib/operationalState'
import { formatDate, voyageLabel } from '../lib/utils'
import {
  parseVaziosImportacaoFile,
  importVaziosImportacaoManifest,
  listVaziosMercanteManifestos,
  resolveVaziosManifestNumbers,
  vaziosImportacaoHiddenConfirmOptions,
  vazioManifestoNumero,
  listVaziosImportacaoContainers,
  type VaziosMercanteManifesto,
} from '../services/vaziosImportacaoImport'
import { listBrazilianPorts } from '../services/depots'
import { exportVaziosImportacaoWorkbook } from '../services/exports'
import { rowErrorsToImportIssues } from '../services/importValidation'
import { fetchVaziosImportacaoContainerIds, setVaziosImportacaoNaturezaMany } from '../services/vaziosNatureza'
import { afterManifestoImportado, afterNaturezaVaziosAlterada } from '../services/cacheEffects'
import { queryKeys } from '../services/queryKeys'
import { inspectImportUpload } from '../services/importText'
import type { VaziosImportacaoContainerListItem } from '../types/database'

const exportPageSize = 200
const COLUMN_COUNT = 9

type Filters = {
  search: string
  voyageId: string
  /** Manifesto Mercante (de vazios) da Viagem escolhida; o filtro vira a rota dele. */
  mercanteId: string
  pod: string
  page: number
  pageSize: number
}

const NATUREZA_LABELS: Record<string, string> = { cama: 'Cama', cover_plate: 'Cover plate' }

function vaziosMercanteKey(voyageIds: number[]) {
  return [...queryKeys.manifestosMercante.all(), 'vazio', [...voyageIds].sort((a, b) => a - b)] as const
}

function voyageIdsOf(rows: VaziosImportacaoContainerListItem[]): number[] {
  return Array.from(new Set(rows.map((row) => row.manifest?.voyage_id).filter((id): id is number => typeof id === 'number')))
}

function containerCount(count: number) {
  return `${count.toLocaleString('pt-BR')} ${count === 1 ? 'container' : 'containers'}`
}

export function VaziosImportacao() {
  const [searchParams] = useSearchParams()
  const queryClient = useQueryClient()
  const { user, profile } = useAuth()
  const canImport = Boolean(profile || user)
  const { showToast } = useToast()
  const confirm = useConfirm()

  // A Line Up abre a tela com a Viagem e o POD no endereço.
  const { filters, setFilters, updateFilter } = usePageFilters<Filters>({
    search: '',
    voyageId: searchParams.get('voyage') ?? '',
    mercanteId: '',
    pod: (searchParams.get('pod') ?? '').toUpperCase(),
    page: 1,
    pageSize: 20,
  })

  const [uploadOpen, setUploadOpen] = useState(false)
  const [voyageId, setVoyageId] = useState(searchParams.get('voyage') ?? '')
  const [description, setDescription] = useState('')
  const [manifestNumbers, setManifestNumbers] = useState<Record<string, string>>({})
  const [exporting, setExporting] = useState(false)
  const [bulkUpdating, setBulkUpdating] = useState(false)
  const [selectingAllFiltered, setSelectingAllFiltered] = useState(false)

  const filterVoyageId = Number(filters.voyageId)
  const hasVoyage = Number.isInteger(filterVoyageId) && filterVoyageId > 0
  const voyageManifestos = useQuery({
    queryKey: vaziosMercanteKey(hasVoyage ? [filterVoyageId] : []),
    queryFn: () => listVaziosMercanteManifestos([filterVoyageId]),
    enabled: hasVoyage,
  })
  const selectedManifesto: VaziosMercanteManifesto | null = filters.mercanteId
    ? (voyageManifestos.data ?? []).find((item) => item.id === filters.mercanteId) ?? null
    : null
  // Manifesto que não é da Viagem (removido, reimportado ou de outra Viagem
  // no endereço): sem a rota a lista ficaria parada com as linhas antigas.
  const mercanteMissing = Boolean(filters.mercanteId) && voyageManifestos.isSuccess && selectedManifesto === null
  useEffect(() => {
    if (mercanteMissing) setFilters((current) => ({ ...current, mercanteId: '', page: 1 }))
  }, [mercanteMissing, setFilters])

  const debouncedSearch = useDebouncedValue(filters.search)
  const queryFilters = useMemo(() => ({
    search: debouncedSearch,
    voyageId: filters.voyageId,
    pol: selectedManifesto?.pol ?? '',
    pod: filters.pod,
    page: debouncedSearch === filters.search ? filters.page : 1,
    pageSize: filters.pageSize,
  }), [debouncedSearch, filters, selectedManifesto])

  const selection = useRowSelection<string>(queryFilters)

  const containers = useQuery({
    queryKey: ['vazios-importacao-containers', queryFilters],
    queryFn: () => listVaziosImportacaoContainers(queryFilters),
    // Manifesto escolhido mas ainda sem a rota: espera, para não listar a Viagem inteira.
    enabled: !filters.mercanteId || selectedManifesto !== null,
    placeholderData: keepPreviousData,
  })
  const data = containers.data
  const rows = data?.rows ?? []
  const rowVoyageIds = voyageIdsOf(rows)
  const rowManifestos = useQuery({
    queryKey: vaziosMercanteKey(rowVoyageIds),
    queryFn: () => listVaziosMercanteManifestos(rowVoyageIds),
    enabled: rowVoyageIds.length > 0,
  })
  const ports = useQuery({ queryKey: ['ports', 'brazilian'], queryFn: listBrazilianPorts, staleTime: 300_000 })
  const { data: voyages = [] } = useVoyageOptions()

  const podOptions = useMemo(() => {
    const codes = new Set((ports.data ?? []).map((port) => port.locode))
    if (filters.pod) codes.add(filters.pod)
    return [...codes].sort()
  }, [ports.data, filters.pod])

  const totalCount = data?.count ?? 0
  const totalPages = Math.max(1, Math.ceil(totalCount / filters.pageSize))
  const pageContainerIds = rows.map((row) => row.id)
  const allPageSelected = pageContainerIds.length > 0 && pageContainerIds.every((id) => selection.isSelected(id))
  const hasMultiplePages = totalCount > pageContainerIds.length
  const isAllFilteredSelected = selection.count === totalCount && totalCount > 0

  const selectedVoyage = voyages.find((voyage) => String(voyage.id) === filters.voyageId)
  const activeFilterCount = [filters.search, filters.voyageId, filters.mercanteId, filters.pod].filter((value) => value.trim() !== '').length
  // V2: navio e viagem e o Nº do manifesto, nunca o número interno.
  const filterDescription = describeActiveFilters([
    { label: 'Busca', value: filters.search },
    { label: 'Viagem', value: filters.voyageId ? (selectedVoyage ? voyageLabel(selectedVoyage.vessel?.name, selectedVoyage.voyage_number, null) : 'escolhida') : '' },
    { label: 'Manifesto Mercante', value: selectedManifesto?.numero ?? '' },
    { label: 'POD', value: filters.pod },
  ])

  function clearFilters() {
    setFilters((current) => ({ ...current, search: '', voyageId: '', mercanteId: '', pod: '', page: 1 }))
  }

  function chooseManifesto(id: string) {
    const manifesto = (voyageManifestos.data ?? []).find((item) => item.id === id)
    // O manifesto é de uma rota: o POD acompanha.
    setFilters((current) => ({ ...current, mercanteId: id, pod: manifesto?.pod ?? current.pod, page: 1 }))
  }

  function choosePod(pod: string) {
    setFilters((current) => ({
      ...current,
      pod,
      mercanteId: selectedManifesto && selectedManifesto.pod !== pod ? '' : current.mercanteId,
      page: 1,
    }))
  }

  function resetUpload() {
    setUploadOpen(false)
    setVoyageId('')
    setDescription('')
    setManifestNumbers({})
  }

  async function handleSelectAllFiltered() {
    setSelectingAllFiltered(true)
    try {
      const allIds = await fetchVaziosImportacaoContainerIds(queryFilters)
      selection.toggleMany(allIds)
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Não foi possível selecionar os containers do filtro.', 'error')
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
      await afterNaturezaVaziosAlterada(queryClient)
      const count = selectedIds.length
      const what = count === 1 ? '1 container atualizado' : `${count.toLocaleString('pt-BR')} containers atualizados`
      showToast(natureza ? `${what} como ${NATUREZA_LABELS[natureza]}.` : `${what}: sem natureza.`, 'success')
      selection.clear()
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Não foi possível atualizar a natureza dos containers.', 'error')
    } finally {
      setBulkUpdating(false)
    }
  }

  async function handleExport() {
    setExporting(true)
    try {
      const all: VaziosImportacaoContainerListItem[] = []
      let page = 1
      let total = 0
      while (true) {
        const result = await listVaziosImportacaoContainers({ ...queryFilters, page, pageSize: exportPageSize })
        if (page === 1) total = result.count
        all.push(...result.rows)
        if (all.length >= total || result.rows.length === 0) break
        page += 1
      }
      if (!all.length) {
        showToast('Nenhum container para exportar com os filtros atuais.', 'info')
        return
      }
      const manifestos = await listVaziosMercanteManifestos(voyageIdsOf(all))
      await exportVaziosImportacaoWorkbook(all.map((row) => ({ ...row, manifesto_numero: vazioManifestoNumero(row, manifestos) })))
      showToast(`${containerCount(all.length)} ${all.length === 1 ? 'exportado' : 'exportados'}.`, 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Não foi possível exportar os vazios.', 'error')
    } finally {
      setExporting(false)
    }
  }

  const stale = containers.isPlaceholderData

  return (
    <>
      <PageHeader
        title="Vazios de importação"
        description="Containers vazios que descarregam (chegam) ao porto. São os futuros vazios de exportação."
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" loading={exporting} loadingLabel="Exportando…" onClick={handleExport}>
              <Download size={16} aria-hidden="true" />
              Exportar
            </Button>
            {canImport ? (
              <Button onClick={() => setUploadOpen(true)}>
                <Upload size={16} aria-hidden="true" />
                Importar planilha
              </Button>
            ) : null}
          </div>
        }
      />

      <div className="app-filter-grid">
        <Field label="Busca">
          <Input
            type="search"
            placeholder="Container ou tipo"
            value={filters.search}
            onChange={(event) => updateFilter('search', event.target.value)}
          />
        </Field>
        <VoyageCombobox
          clearable
          label="Viagem"
          placeholder="Navio ou viagem"
          selectedVoyageId={filters.voyageId}
          onSelect={(id) => setFilters((current) => ({ ...current, voyageId: id == null ? '' : String(id), mercanteId: '', page: 1 }))}
        />
        <Field label="Manifesto Mercante" hint={hasVoyage ? undefined : 'Escolha a Viagem para ver os manifestos dela.'}>
          <Select value={filters.mercanteId} disabled={!hasVoyage} onChange={(event) => chooseManifesto(event.target.value)}>
            <option value="">{hasVoyage ? 'Todos da viagem' : 'Todos'}</option>
            {(voyageManifestos.data ?? []).map((manifesto) => (
              <option key={manifesto.id} value={manifesto.id}>
                {manifesto.numero} · {manifesto.pol} → {manifesto.pod}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="POD">
          <Select value={filters.pod} onChange={(event) => choosePod(event.target.value)}>
            <option value="">Todos</option>
            {podOptions.map((code) => <option key={code} value={code}>{code}</option>)}
          </Select>
        </Field>
        {activeFilterCount > 0 ? (
          <div><Button variant="ghost" onClick={clearFilters}>Limpar filtros</Button></div>
        ) : null}
      </div>
      {activeFilterCount > 0 ? <p className="mb-3 text-xs text-[var(--app-muted)]" aria-live="polite">{filterDescription}</p> : null}

      {canImport ? (
        <BulkActionsBar
          count={selection.count}
          onClear={selection.clear}
          deleting={bulkUpdating}
          noun={['container', 'containers']}
          extraActions={
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm">Natureza:</span>
              <Button variant="secondary" disabled={bulkUpdating} onClick={() => void handleBulkNatureza('cama')}>Cama</Button>
              <Button variant="secondary" disabled={bulkUpdating} onClick={() => void handleBulkNatureza('cover_plate')}>Cover plate</Button>
              <Button variant="ghost" disabled={bulkUpdating} aria-label="Limpar natureza" onClick={() => void handleBulkNatureza(null)}>Limpar</Button>
              {allPageSelected && hasMultiplePages && !isAllFilteredSelected ? (
                <Button variant="secondary" loading={selectingAllFiltered} loadingLabel="Selecionando…" onClick={() => void handleSelectAllFiltered()}>
                  {`Selecionar os ${totalCount.toLocaleString('pt-BR')} do filtro`}
                </Button>
              ) : null}
            </div>
          }
        />
      ) : null}

      <Block
        title="Containers vazios"
        aside={data && !containers.error ? <span className="tabular-nums">{containerCount(totalCount)}</span> : null}
        flush
      >
        <QueryStateGate
          isLoading={false}
          isError={Boolean(containers.error)}
          isPaused={containers.fetchStatus === 'paused'}
          hasData={data !== undefined}
          errorMessage="Não foi possível carregar os containers vazios."
          onRetry={() => void containers.refetch()}
        >
          {containers.isLoading || (stale && rows.length === 0) ? (
            <SkeletonTable rows={8} cols={COLUMN_COUNT} label="Carregando containers vazios" />
          ) : rows.length === 0 ? (
            activeFilterCount > 0 ? (
              <EmptyState
                title="Nenhum container neste recorte"
                description="Nenhum container vazio atende aos filtros aplicados."
                action={<Button variant="secondary" onClick={clearFilters}>Limpar filtros</Button>}
              />
            ) : (
              <EmptyState
                title="Nenhum container vazio importado"
                description="Os vazios entram pela planilha (Importar planilha) ou pelo Baplie da Viagem."
              />
            )
          ) : (
            <div className="app-table-scroll app-table-scroll--sticky" aria-busy={stale || undefined}>
              <table className="app-table app-table--compact">
                <caption className="sr-only">Containers vazios de importação</caption>
                <thead>
                  <tr>
                    {canImport ? (
                      <th scope="col">
                        <input
                          type="checkbox"
                          aria-label="Selecionar todos os containers da página"
                          checked={allPageSelected}
                          disabled={stale}
                          onChange={() => selection.toggleMany(pageContainerIds)}
                        />
                      </th>
                    ) : null}
                    <th scope="col">Container</th>
                    <th scope="col">Tipo</th>
                    <th scope="col">Tara</th>
                    <th scope="col">Trecho</th>
                    <th scope="col">Natureza</th>
                    <th scope="col" className="app-table__text-head">Navio / Viagem</th>
                    <th scope="col">Manifesto Mercante</th>
                    <th scope="col">Importado em</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const numero = vazioManifestoNumero(row, rowManifestos.data ?? [])
                    const voyage = row.manifest?.voyage
                    const voyageText = voyage ? voyageLabel(voyage.vessel?.name, voyage.voyage_number, null) : null
                    return (
                      <tr key={row.id}>
                        {canImport ? (
                          <td>
                            <input
                              type="checkbox"
                              aria-label={`Selecionar container ${row.container_number}`}
                              checked={selection.isSelected(row.id)}
                              disabled={stale}
                              onChange={() => selection.toggle(row.id)}
                            />
                          </td>
                        ) : null}
                        <td className="font-[var(--app-font-mono)]"><CopyValue value={row.container_number} label="número do contêiner" /></td>
                        <td>{row.container_type ?? <NoValue label="Sem tipo" />}</td>
                        <td className="tabular-nums">{row.tare_kg != null ? `${Number(row.tare_kg).toLocaleString('pt-BR')} kg` : <NoValue label="Sem tara" />}</td>
                        <td>{row.pol || row.pod ? <>{row.pol ?? <NoValue label="Sem POL" />} → {row.pod ?? <NoValue label="Sem POD" />}</> : <NoValue label="Sem trecho" />}</td>
                        <td>{row.natureza ? NATUREZA_LABELS[row.natureza] ?? row.natureza : <NoValue label="Sem natureza" />}</td>
                        <td className="app-table__text" title={voyageText ?? undefined}>{voyageText ?? <NoValue label="Sem navio e viagem" />}</td>
                        <td className="tabular-nums">
                          {numero
                            ? numero
                            : rowManifestos.isLoading
                              ? <NoValue label="Carregando o número do manifesto" />
                              : rowManifestos.error
                                // Falha ao ler os manifestos não é pendência da rota.
                                ? <StatusText tone="danger">Não foi possível carregar</StatusText>
                                : <StatusText tone="warning">Sem número</StatusText>}
                        </td>
                        <td className="tabular-nums">{formatDate(row.manifest?.imported_at)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </QueryStateGate>
        {data && totalCount > 0 ? (
          <TableFooterPagination
            page={queryFilters.page}
            pageSize={filters.pageSize}
            totalCount={totalCount}
            totalPages={totalPages}
            onPageChange={(page) => updateFilter('page', page)}
            onPageSizeChange={(pageSize) => updateFilter('pageSize', pageSize)}
          />
        ) : null}
      </Block>

      {uploadOpen && canImport ? (
        <FileImportModal
          issuesFilename="vazios-importacao-issues.csv"
          title="Importar planilha de vazios"
          accept=".xlsx,.xls,.csv"
          parser={parseVaziosImportacaoFile}
          inspectFile={inspectImportUpload}
          confirmBeforeImport={async (nextManifest) => {
            const hiddenQuestion = vaziosImportacaoHiddenConfirmOptions(nextManifest.hidden)
            return hiddenQuestion ? confirm(hiddenQuestion) : true
          }}
          importer={async (nextManifest, _file, override) => {
            if (!user || !voyageId) return
            await importVaziosImportacaoManifest({ manifest: nextManifest, uploadedBy: user.id, voyageId: Number(voyageId), manifestNumbers, description: description.trim() || undefined, allowRowErrors: Boolean(override) })
            await afterManifestoImportado(queryClient, { voyageId })
            showToast(`${containerCount(nextManifest.containers.length)} ${nextManifest.containers.length === 1 ? 'importado' : 'importados'}.`, 'success')
          }}
          canImport={(nextManifest, override) => resolveVaziosManifestNumbers(nextManifest, manifestNumbers).manifestos !== null && (nextManifest.rowErrors.length === 0 || Boolean(override))}
          getIssues={(nextManifest) => rowErrorsToImportIssues(nextManifest.rowErrors)}
          ready={Boolean(voyageId && user)}
          notReadyReason="Escolha a viagem de destino para liberar o arquivo."
          confirmLabel="Importar manifesto"
          prerequisite={<VoyageCombobox required label="Viagem de destino" selectedVoyageId={voyageId} onSelect={(id) => setVoyageId(id == null ? '' : String(id))} />}
          helper={
            <>
              <VaziosImportacaoGuide />
              <Field label="Descrição (opcional)"><Input placeholder="Ex.: importação da semana 15" value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
            </>
          }
          renderPreview={(nextManifest) => <VaziosImportacaoPreview manifest={nextManifest} manifestNumbers={manifestNumbers} onManifestNumbersChange={setManifestNumbers} />}
          onClose={resetUpload}
        />
      ) : null}
    </>
  )
}
