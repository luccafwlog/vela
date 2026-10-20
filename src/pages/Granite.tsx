import { useMemo, useState, type ChangeEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { Upload } from 'lucide-react'
import { Block } from '../components/ui/Block'
import { Button } from '../components/ui/Button'
import { CopyValue } from '../components/ui/CopyValue'
import { NoValue } from '../components/ui/NoValue'
import { EmptyState, PageHeader } from '../components/ui/Card'
import { Field, Input, Select } from '../components/ui/Input'
import { MetricCard } from '../components/ui/MetricCard'
import { Modal } from '../components/ui/Modal'
import { PreviewBox } from '../components/ui/PreviewBox'
import { SkeletonTable } from '../components/ui/Skeleton'
import { TableFooterPagination } from '../components/ui/TableFooterPagination'
import { useToast } from '../components/ui/Toast'
import { useConfirm } from '../components/ui/ConfirmDialog'
import { QueryStateGate } from '../components/shared/QueryStateGate'
import { TruncationNote } from '../components/shared/TruncationNote'
import { VoyageCombobox } from '../components/shared/VoyageCombobox'
import { ImportIssuesPanel } from '../components/shared/ImportIssuesPanel'
import { ImportReadProgress } from '../components/shared/ImportReadProgress'
import { useAuth } from '../hooks/useAuth'
import { useVoyageOptions } from '../hooks/useBls'
import { useCancellableFileRead } from '../hooks/useCancellableFileRead'
import { useDebouncedValue } from '../hooks/useDebouncedValue'
import { usePageFilters } from '../hooks/usePageFilters'
import { afterManifestoImportado } from '../services/cacheEffects'
import { queryKeys } from '../services/queryKeys'
import {
  parseGraniteManifestFile,
  describeGraniteImport,
  graniteRemovalConfirmOptions,
  importGraniteManifest,
  type ParsedGraniteManifest,
} from '../services/graniteImport'
import {
  fetchGraniteCargoRows,
  formatGraniteTons,
  graniteLegLabel,
  graniteVoyageLabel,
  graniteWeightKg,
  listGraniteBls,
  summarizeGraniteCargo,
} from '../services/graniteCargo'
import { rowErrorsToImportIssues } from '../services/importValidation'
import { describeActiveFilters } from '../lib/operationalState'
import { STALE_PAGE_CLASS } from '../lib/pagination'
import { userFacingErrorMessage } from '../lib/errors'
import { voyageDisplayName } from '../lib/utils'

type Filters = {
  search: string
  voyageId: string
  dischargePort: string
  page: number
  pageSize: number
}

const plural = (count: number, one: string, many: string) => `${count.toLocaleString('pt-BR')} ${count === 1 ? one : many}`

/**
 * Granito (lote 5b da identidade, aprovado em 2026-10-19): só a carga
 * movimentada no navio. Sem Cliente, sem taxa e sem CE (regra em
 * docs/modules/granito.md).
 */
export function Granite() {
  const queryClient = useQueryClient()
  const [searchParams] = useSearchParams()
  const { user, profile } = useAuth()
  const canWrite = Boolean(profile || user)
  const initialVoyageId = searchParams.get('voyage') ?? ''

  const { filters, setFilters, updateFilter } = usePageFilters<Filters>({
    search: '',
    voyageId: initialVoyageId,
    dischargePort: '',
    page: 1,
    pageSize: 20,
  })
  const [uploadOpen, setUploadOpen] = useState(false)

  const debouncedSearch = useDebouncedValue(filters.search)
  const listFilters = useMemo(() => ({
    ...filters,
    search: debouncedSearch,
    page: debouncedSearch === filters.search ? filters.page : 1,
  }), [debouncedSearch, filters])
  const cargoFilters = useMemo(() => ({ search: debouncedSearch, voyageId: filters.voyageId }), [debouncedSearch, filters.voyageId])

  const listQuery = useQuery({
    queryKey: queryKeys.granite.bls(listFilters),
    queryFn: () => listGraniteBls(listFilters),
    placeholderData: keepPreviousData,
  })
  const cargoQuery = useQuery({
    queryKey: queryKeys.granite.cargo(cargoFilters),
    queryFn: () => fetchGraniteCargoRows(cargoFilters),
    placeholderData: keepPreviousData,
  })
  const { data: voyageOptions } = useVoyageOptions()

  // O POD filtra na tela: a lista de portos vem do recorte sem ele.
  const cargoRows = useMemo(() => cargoQuery.data ?? [], [cargoQuery.data])
  const podOptions = useMemo(() => {
    const ports = new Set(cargoRows.map((row) => row.discharge_port?.trim()).filter((port): port is string => Boolean(port)))
    if (filters.dischargePort) ports.add(filters.dischargePort)
    return [...ports].sort()
  }, [cargoRows, filters.dischargePort])
  const summary = useMemo(
    () => summarizeGraniteCargo(filters.dischargePort ? cargoRows.filter((row) => row.discharge_port === filters.dischargePort) : cargoRows),
    [cargoRows, filters.dischargePort],
  )

  const stale = listQuery.isPlaceholderData
  const rows = listQuery.data?.rows ?? []
  const totalCount = listQuery.data?.count ?? 0
  const totalPages = Math.max(1, Math.ceil(totalCount / filters.pageSize))
  const cargoKnown = cargoQuery.data !== undefined && !cargoQuery.error && !cargoQuery.isPlaceholderData
  // Com erro de leitura o cartão diz que falta o dado, não que está carregando.
  const metricGapLabel = cargoQuery.error ? 'Sem dado' : 'Carregando'
  const metric = (value: string) => (cargoKnown ? value : <NoValue label={metricGapLabel} />)

  // Filtros ativos com o nome do navio e da viagem, nunca o número interno (lote 5b).
  const selectedVoyage = voyageOptions?.find((voyage) => String(voyage.id) === filters.voyageId)
  const voyageFilterLabel = filters.voyageId
    ? voyageDisplayName(selectedVoyage?.vessel?.name, selectedVoyage?.voyage_number) ?? 'escolhida'
    : ''
  const hasActiveFilters = [filters.search, filters.voyageId, filters.dischargePort].some((value) => value.trim() !== '')
  const filterDescription = describeActiveFilters([
    { label: 'Busca', value: filters.search },
    { label: 'Viagem', value: voyageFilterLabel },
    { label: 'POD', value: filters.dischargePort },
  ])

  function clearFilters() {
    setFilters((current) => ({ ...current, search: '', voyageId: '', dischargePort: '', page: 1 }))
  }

  return (
    <>
      <PageHeader
        title="Granito"
        action={canWrite ? (
          <Button onClick={() => setUploadOpen(true)}>
            <Upload size={16} aria-hidden="true" />
            Importar planilha COSCO
          </Button>
        ) : undefined}
      />

      <div className="app-metric-row" role="group" aria-label="Totais do recorte">
        <MetricCard label="B/Ls" value={metric(summary.totals.bls.toLocaleString('pt-BR'))} detail="no recorte" />
        <MetricCard label="Blocos" value={metric(summary.totals.blocks.toLocaleString('pt-BR'))} detail="no recorte" />
        <MetricCard label="Peso" value={metric(formatGraniteTons(summary.totals.weightKg))} detail="no recorte" />
      </div>

      <div className="app-filter-grid mb-4">
        <Field label="Busca">
          <Input
            type="search"
            placeholder="B/L ou shipper"
            value={filters.search}
            onChange={(event) => updateFilter('search', event.target.value)}
          />
        </Field>
        <VoyageCombobox
          clearable
          label="Viagem"
          placeholder="Navio ou viagem"
          selectedVoyageId={filters.voyageId}
          onSelect={(id) => updateFilter('voyageId', id == null ? '' : String(id))}
        />
        <Field label="POD">
          <Select value={filters.dischargePort} onChange={(event) => updateFilter('dischargePort', event.target.value)}>
            <option value="">Todos</option>
            {podOptions.map((port) => <option key={port} value={port}>{port}</option>)}
          </Select>
        </Field>
        {hasActiveFilters ? (
          <div><Button variant="ghost" onClick={clearFilters}>Limpar filtros</Button></div>
        ) : null}
      </div>

      {summary.byVoyage.length > 0 || cargoQuery.isLoading || cargoQuery.error ? (
        <Block title="Carga por viagem" aside="o que o navio movimentou de Granito" flush className="mb-4">
          <QueryStateGate
            isLoading={cargoQuery.isLoading}
            isError={Boolean(cargoQuery.error)}
            isPaused={cargoQuery.fetchStatus === 'paused'}
            hasData={cargoQuery.data !== undefined}
            errorMessage="Não foi possível carregar a carga por viagem."
            onRetry={() => void cargoQuery.refetch()}
            loadingFallback={<SkeletonTable rows={2} cols={5} label="Carregando a carga por viagem" />}
          >
            <div className={`app-table-scroll${cargoQuery.isPlaceholderData ? ` ${STALE_PAGE_CLASS}` : ''}`} aria-busy={cargoQuery.isPlaceholderData || undefined}>
              <table className="app-table">
                <caption className="sr-only">Carga de Granito por navio e viagem</caption>
                <thead>
                  <tr>
                    <th scope="col" className="app-table__text-head">Navio / Viagem</th>
                    <th scope="col">Trecho</th>
                    <th scope="col">B/Ls</th>
                    <th scope="col">Blocos</th>
                    <th scope="col">Peso</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.byVoyage.map((group) => (
                    <tr key={group.key}>
                      <td className="app-table__text">
                        {group.voyageId != null && group.voyageLabel ? (
                          <Link className="app-link" to={`/viagens/${group.voyageId}`}>{group.voyageLabel}</Link>
                        ) : group.voyageLabel ?? <NoValue label="Sem navio e viagem" />}
                      </td>
                      <td>{group.leg ?? <NoValue label="Sem trecho" />}</td>
                      <td className="tabular-nums">{group.bls.toLocaleString('pt-BR')}</td>
                      <td className="tabular-nums">{group.blocks.toLocaleString('pt-BR')}</td>
                      <td className="tabular-nums"><strong>{formatGraniteTons(group.weightKg)}</strong></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </QueryStateGate>
        </Block>
      ) : null}

      <Block
        title="B/Ls de Granito"
        aside={cargoKnown ? `${plural(summary.totals.bls, 'B/L', 'B/Ls')} · ${plural(summary.totals.blocks, 'bloco', 'blocos')} · ${formatGraniteTons(summary.totals.weightKg)}` : null}
        flush
      >
        <QueryStateGate
          isLoading={false}
          isError={Boolean(listQuery.error)}
          isPaused={listQuery.fetchStatus === 'paused'}
          hasData={listQuery.data !== undefined}
          errorMessage="Não foi possível carregar os B/Ls de Granito."
          onRetry={() => void listQuery.refetch()}
        >
          {listQuery.isLoading || (stale && rows.length === 0) ? (
            <SkeletonTable rows={8} cols={6} label="Carregando os B/Ls de Granito" />
          ) : rows.length === 0 ? (
            hasActiveFilters ? (
              <EmptyState
                title="Nenhum B/L de Granito neste recorte"
                description={`${filterDescription}.`}
                action={<Button variant="secondary" onClick={clearFilters}>Limpar filtros</Button>}
              />
            ) : (
              <EmptyState
                title="Nenhum B/L de Granito importado"
                description="Os B/Ls entram pela planilha COSCO, aqui ou na ficha da Viagem."
              />
            )
          ) : (
            <>
              <div className={`app-table-scroll${stale ? ` ${STALE_PAGE_CLASS}` : ''}`} aria-busy={stale || undefined}>
                <table className="app-table">
                  <caption className="sr-only">B/Ls de Granito do recorte atual</caption>
                  <thead>
                    <tr>
                      <th scope="col">B/L</th>
                      <th scope="col" className="app-table__text-head">Shipper</th>
                      <th scope="col">Navio / Viagem</th>
                      <th scope="col">Trecho</th>
                      <th scope="col">Blocos</th>
                      <th scope="col">Peso</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((bl) => {
                      const weightKg = graniteWeightKg(bl)
                      const leg = graniteLegLabel(bl)
                      return (
                        <tr key={bl.id}>
                          <td><span className="app-cargo-code"><CopyValue value={bl.bl_number} label="número do B/L" /></span></td>
                          <td className="app-table__text" title={bl.shipper_name ?? undefined}>{bl.shipper_name ?? <NoValue label="Sem shipper" />}</td>
                          <td>{graniteVoyageLabel(bl) ?? <NoValue label="Sem navio e viagem" />}</td>
                          <td>{leg ?? <NoValue label="Sem trecho" />}</td>
                          <td className="tabular-nums">{bl.blocks_qty != null ? Number(bl.blocks_qty).toLocaleString('pt-BR') : <NoValue label="Sem blocos" />}</td>
                          <td className="tabular-nums">{weightKg != null ? formatGraniteTons(weightKg) : <NoValue label="Sem peso" />}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <div className="app-block__body"><p className="app-facts__detail">Peso: o peso real da planilha COSCO.</p></div>
            </>
          )}
        </QueryStateGate>

        {listQuery.data && totalCount > 0 ? (
          <TableFooterPagination
            page={listFilters.page}
            pageSize={filters.pageSize}
            totalCount={totalCount}
            totalPages={totalPages}
            onPageChange={(page) => updateFilter('page', page)}
            onPageSizeChange={(pageSize) => updateFilter('pageSize', pageSize)}
          />
        ) : null}
      </Block>

      {uploadOpen && canWrite ? (
        <GraniteImportModal
          initialVoyageId={filters.voyageId}
          onClose={() => setUploadOpen(false)}
          onImported={async (voyageId) => {
            await afterManifestoImportado(queryClient, { voyageId })
          }}
        />
      ) : null}
    </>
  )
}

/** Janela da planilha COSCO: Viagem de destino, arquivo e prévia da carga. */
function GraniteImportModal({
  initialVoyageId,
  onClose,
  onImported,
}: {
  initialVoyageId: string
  onClose: () => void
  onImported: (voyageId: number) => Promise<void>
}) {
  const { user } = useAuth()
  const { showToast } = useToast()
  const confirm = useConfirm()
  const [voyageId, setVoyageId] = useState(initialVoyageId)
  const [submitting, setSubmitting] = useState(false)
  const { file, preview: manifest, parsing, progress, readFile, cancel: cancelReading } = useCancellableFileRead<ParsedGraniteManifest>(parseGraniteManifestFile)

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    try {
      await readFile(event.target.files?.[0] ?? null)
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Não foi possível ler o arquivo.', 'error')
    }
  }

  function close() {
    cancelReading()
    onClose()
  }

  async function handleImport() {
    if (!manifest || manifest.rowErrors.length > 0 || !voyageId || !user) return
    setSubmitting(true)
    try {
      const result = await importGraniteManifest({
        filename: file?.name ?? 'granito.xlsx',
        voyageId: Number(voyageId),
        manifest,
        uploadedBy: user.id,
        confirmRemoval: (missing) => confirm(graniteRemovalConfirmOptions(missing, manifest.hidden)),
      })
      await onImported(Number(voyageId))
      showToast(`Granito importado: ${describeGraniteImport(result)}.`, 'success')
      close()
    } catch (err) {
      showToast(userFacingErrorMessage(err, 'Não foi possível importar a planilha do Granito. Tente novamente.'), 'error')
    } finally {
      setSubmitting(false)
    }
  }

  const blocks = manifest?.bls.reduce((sum, bl) => sum + Number(bl.blocks_qty ?? 0), 0) ?? 0
  const weightKg = manifest?.bls.reduce((sum, bl) => sum + (graniteWeightKg(bl) ?? 0), 0) ?? 0

  return (
    <Modal open onClose={close} title="Importar planilha COSCO">
      <div className="grid gap-5">
        <p className="app-panel__meta">
          Planilha "Relatório de Cargas/Booking" exportada pela COSCO. Colunas obrigatórias: <strong>BL</strong> e <strong>Real Weight</strong>.
        </p>

        <VoyageCombobox
          required
          label="Viagem de destino"
          selectedVoyageId={voyageId}
          onSelect={(id) => setVoyageId(id == null ? '' : String(id))}
        />

        <Field label="Arquivo .xls ou .xlsx">
          <Input accept=".xlsx,.xls" type="file" onChange={handleFile} />
        </Field>

        {parsing ? <ImportReadProgress progress={progress} /> : null}

        {manifest ? (
          <div className="grid gap-4">
            <div className="grid gap-3 grid-cols-[repeat(auto-fit,minmax(140px,1fr))]">
              <PreviewBox label="B/Ls válidos" value={manifest.bls.length} />
              <PreviewBox label="Blocos" value={blocks} />
              <PreviewBox label="Peso" value={formatGraniteTons(weightKg)} />
              <PreviewBox label="Erros de leitura" value={manifest.rowErrors.length} />
            </div>

            <div className="app-table-scroll max-h-80">
              <table className="app-table">
                <caption className="sr-only">Prévia dos B/Ls da planilha</caption>
                <thead>
                  <tr>
                    <th scope="col">B/L</th>
                    <th scope="col" className="app-table__text-head">Shipper</th>
                    <th scope="col">Trecho</th>
                    <th scope="col">Blocos</th>
                    <th scope="col">Peso</th>
                  </tr>
                </thead>
                <tbody>
                  {manifest.bls.slice(0, 50).map((bl) => {
                    const blWeight = graniteWeightKg(bl)
                    return (
                      <tr key={bl.bl_number}>
                        <td><span className="app-cargo-code">{bl.bl_number}</span></td>
                        <td className="app-table__text" title={bl.shipper_name ?? undefined}>{bl.shipper_name ?? <NoValue label="Sem shipper" />}</td>
                        <td>{graniteLegLabel(bl) ?? <NoValue label="Sem trecho" />}</td>
                        <td className="tabular-nums">{bl.blocks_qty != null ? bl.blocks_qty.toLocaleString('pt-BR') : <NoValue label="Sem blocos" />}</td>
                        <td className="tabular-nums">{blWeight != null ? formatGraniteTons(blWeight) : <NoValue label="Sem peso" />}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <TruncationNote shown={50} total={manifest.bls.length} noun="B/L" nounPlural="B/Ls" />

            <ImportIssuesPanel issues={rowErrorsToImportIssues(manifest.rowErrors)} filename="granito-erros-de-leitura.csv" />
          </div>
        ) : null}

        <div className="app-modal__actions">
          <Button variant="secondary" disabled={submitting} onClick={parsing ? cancelReading : close}>{parsing ? 'Interromper leitura' : 'Voltar'}</Button>
          <Button disabled={!manifest || manifest.rowErrors.length > 0 || !voyageId || !user} loading={submitting} loadingLabel="Importando…" onClick={handleImport}>
            Confirmar importação
          </Button>
        </div>
      </div>
    </Modal>
  )
}
