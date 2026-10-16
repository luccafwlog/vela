import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { afterCargaAlterada } from '../services/cacheEffects'
import { CalendarDays, Download } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { CopyValue } from '../components/ui/CopyValue'
import { NoValue } from '../components/ui/NoValue'
import { Card, EmptyState, PageHeader } from '../components/ui/Card'
import { FilterBar } from '../components/ui/FilterBar'
import { Field, Input, Select } from '../components/ui/Input'
import { MetricCard } from '../components/ui/MetricCard'
import { LocalChargesStatus } from '../components/bl/LocalChargesStatus'
import { TableFooterPagination } from '../components/ui/TableFooterPagination'
import { SkeletonTable } from '../components/ui/Skeleton'
import { QueryStateGate } from '../components/shared/QueryStateGate'
import { useToast } from '../components/ui/Toast'
import { useConfirmWithReason } from '../components/ui/ConfirmDialog'
import { useAuth } from '../hooks/useAuth'
import { useRowSelection } from '../hooks/useRowSelection'
import { usePageFilters } from '../hooks/usePageFilters'
import { useDebouncedValue } from '../hooks/useDebouncedValue'
import { useNarrowViewport } from '../components/bl/useNarrowViewport'
import { BulkActionsBar } from '../components/shared/BulkActionsBar'
import { ContainerDatesImportModal } from '../components/shared/ContainerDatesImportModal'
import { CargoProfileBadge, ContainerOwnershipBadge } from '../components/shared/OperationalBadges'
import { VoyageCombobox } from '../components/shared/VoyageCombobox'
import { checkContainerDependencies, deleteContainers } from '../services/containers'
import { buildDeleteAffected, formatBlockedSummary, formatDeleteOutcome } from '../services/deleteDependencies'
import { type ContainerFilters, fetchAllContainers, useContainers, usePortOptions, useContainerTypeOptions } from '../hooks/useBls'
import { userFacingErrorMessage } from '../lib/errors'
import { formatDate } from '../lib/utils'
import { STALE_PAGE_CLASS } from '../lib/pagination'
import type { BLContainer, ContainerListItem } from '../types/database'
import { CHARGE_STATUS_FILTER_OPTIONS } from './blsListState'
import {
  containersSearchFromFilters,
  countActiveContainerFilters,
  describeReturn,
  filtersFromContainersSearch,
  ownershipSourceLabel,
} from './containersListState'
import { displayAggregateLabel } from './veiculosPresentation'

// A RPC `operational_list_containers` projeta todas as colunas de
// `bl_containers`; o tipo de lista só nomeia as da época em que foi escrito.
type ContainerRow = ContainerListItem & Partial<Pick<BLContainer, 'discharge_date' | 'return_date' | 'ownership_source'>>

const EMPTY_FILTERS: Omit<ContainerFilters, 'page' | 'pageSize'> = {
  search: '',
  voyageId: '',
  cargoMode: '',
  pol: '',
  pod: '',
  reviewStatus: '',
  financialStatus: '',
  chargeStatus: '',
  cargoProfile: '',
  containerType: '',
  vehicleContainer: '',
}

function voyageText(row: ContainerRow) {
  const voyage = row.bl?.voyage
  if (!voyage) return '—'
  return `${voyage.vessel?.name ?? 'Navio'} / ${voyage.voyage_number ?? '—'}`
}

function routeText(row: ContainerRow) {
  return `${row.bl?.pol ?? '—'} → ${row.bl?.pod ?? '—'}`
}

function partyName(row: ContainerRow) {
  return row.bl?.customer?.name ?? row.bl?.consignee ?? null
}

function VoyageCell({ row }: { row: ContainerRow }) {
  const voyage = row.bl?.voyage
  // Tabela limpa (lote 2): o trecho POL → POD fica nos filtros e ao passar o mouse.
  return voyage?.id ? (
    <Link className="app-cargo-link app-cargo-cell__truncate" to={`/viagens/${voyage.id}`} title={`${voyageText(row)} · ${routeText(row)}`}>{voyageText(row)}</Link>
  ) : <NoValue label="Sem viagem" />
}

function BlNumberCell({ row }: { row: ContainerRow }) {
  return row.bl?.id ? <CopyValue value={row.bl.id} label="número do B/L"><Link className="app-cargo-link app-cargo-id" to={`/bls/${row.bl.id}`}>{row.bl.id}</Link></CopyValue> : <NoValue label="Sem B/L" />
}

function BlCell({ row }: { row: ContainerRow }) {
  const name = partyName(row)
  return (
    <span className="app-cargo-cell__stack app-table__cell-stack">
      {row.bl?.id ? <CopyValue value={row.bl.id} label="número do B/L"><Link className="app-cargo-link app-cargo-id" to={`/bls/${row.bl.id}`}>{row.bl.id}</Link></CopyValue> : <NoValue label="Sem B/L" />}
      {name ? <span className="app-cargo-cell__sub app-cargo-cell__truncate" title={name}>{name}</span> : null}
    </span>
  )
}

/** COC/SOC em texto (lote 2); a origem e o "tratado como COC" ao passar o mouse. */
function OwnershipText({ row }: { row: ContainerRow }) {
  const source = ownershipSourceLabel(row.ownership_source, row.ownership)
  if (row.ownership !== 'SOC' && row.ownership !== 'COC') {
    return <span title="Não informado: tratado como COC"><NoValue label="SOC/COC não informado, tratado como COC" /></span>
  }
  return <span title={source ?? undefined}>{row.ownership}</span>
}

function ProfileText({ row }: { row: ContainerRow }) {
  if (!row.is_imo && !row.is_oog) return <NoValue label="Sem IMO nem OOG" />
  return <>{[row.is_imo ? 'IMO' : null, row.is_oog ? 'OOG' : null].filter(Boolean).join(' · ')}</>
}

function OwnershipCell({ row }: { row: ContainerRow }) {
  const source = ownershipSourceLabel(row.ownership_source, row.ownership)
  return (
    <span className="app-cargo-cell__stack app-table__cell-stack app-table__cell-stack--center">
      <ContainerOwnershipBadge ownership={row.ownership} />
      {source ? <span className="app-cargo-cell__sub">{source}</span> : null}
    </span>
  )
}

function DateCell({ value, label }: { value: string | null | undefined; label: string }) {
  if (!value) return <NoValue label={`Sem ${label}`} />
  return <span className="app-cargo-num">{formatDate(value)}</span>
}

function ReturnCell({ row }: { row: ContainerRow }) {
  const { text, muted, srText } = describeReturn(row.return_date, row.ownership, formatDate)
  if (srText) return <NoValue label={srText} />
  return <span className={muted ? 'app-cargo-cell__muted' : 'app-cargo-num'}>{text}</span>
}

export function Containers() {
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const { showToast } = useToast()
  const confirmWithReason = useConfirmWithReason()
  const { isAdmin } = useAuth()
  const narrow = useNarrowViewport()
  const selection = useRowSelection<number>()
  const [deleting, setDeleting] = useState(false)
  const { filters, setFilters, updateFilter } = usePageFilters<ContainerFilters>(filtersFromContainersSearch(searchParams))
  const [exporting, setExporting] = useState(false)
  const [datesImportOpen, setDatesImportOpen] = useState(false)

  // Filtros e página vivem na URL: voltar do B/L ou recarregar reabre o recorte.
  // Uma URL que a própria tela não escreveu (menu lateral, outro link para
  // /containers com a página aberta) manda nos filtros; senão a tela grava os
  // filtros na URL.
  const listSearch = containersSearchFromFilters(filters)
  const writtenSearch = useRef(searchParams.toString())
  useEffect(() => {
    const current = searchParams.toString()
    if (current === listSearch) {
      writtenSearch.current = current
    } else if (current !== writtenSearch.current) {
      writtenSearch.current = current
      setFilters(filtersFromContainersSearch(searchParams))
    } else {
      writtenSearch.current = listSearch
      setSearchParams(new URLSearchParams(listSearch), { replace: true })
    }
  }, [listSearch, searchParams, setFilters, setSearchParams])

  const debouncedSearch = useDebouncedValue(filters.search)
  const queryFilters = useMemo(() => ({
    ...filters,
    search: debouncedSearch,
    page: debouncedSearch === filters.search ? filters.page : 1,
  }), [debouncedSearch, filters])
  const { data, isLoading, isPlaceholderData, error, fetchStatus, refetch } = useContainers(queryFilters)
  // Filtro trocado: as linhas na tela ainda são do recorte anterior até a
  // resposta chegar. Ficam esmaecidas e sem seleção, e os totais não as contam.
  const stale = isPlaceholderData
  const { data: portOptions } = usePortOptions()
  const { data: typeOptions } = useContainerTypeOptions()
  const rows = (data?.rows ?? []) as ContainerRow[]

  const totalPages = Math.max(1, Math.ceil((data?.count ?? 0) / filters.pageSize))
  // Página além do resultado (URL antiga ou compartilhada, ou lista que encolheu):
  // volta para a última página com linhas, em vez de mostrar "nenhum container".
  const lastPage = data && !error ? totalPages : null
  useEffect(() => {
    if (lastPage !== null && filters.page > lastPage) updateFilter('page', lastPage)
  }, [filters.page, lastPage, updateFilter])
  const activeFilterCount = countActiveContainerFilters(filters)
  // Busca, Viagem, Tipo, POL e POD ficam abertos; o resto vai para "Mais filtros" (como na lista de BLs).
  const moreFilterCount = (['cargoProfile', 'vehicleContainer', 'reviewStatus', 'financialStatus', 'chargeStatus'] as (keyof ContainerFilters)[])
    .filter((key) => String(filters[key] ?? '').trim() !== '').length

  function clearFilters() {
    setFilters((current) => ({ ...current, ...EMPTY_FILTERS, page: 1 }))
  }

  async function handleExport() {
    setExporting(true)
    try {
      const exportRows = await fetchAllContainers(filters)
      if (!exportRows.length) {
        showToast('Nenhum container para exportar com os filtros atuais.', 'info')
        return
      }

      const { exportContainerWorkbook } = await import('../services/exports')
      await exportContainerWorkbook(exportRows)
      showToast(`Exportação concluída com ${exportRows.length} container(es).`, 'success')
    } catch {
      showToast('Falha ao exportar containers.', 'error')
    } finally {
      setExporting(false)
    }
  }

  async function runContainerDelete(ids: number[]) {
    setDeleting(true)
    try {
      const report = await checkContainerDependencies(ids)
      if (report.deletableIds.length === 0) {
        showToast(`Nenhum container pode ser excluído. ${formatBlockedSummary(report.blockedIds)}`, 'error')
        return
      }

      const reason = await confirmWithReason({
        title: 'Excluir container',
        message: `Excluir ${report.deletableIds.length} container(es)?`,
        affected: buildDeleteAffected('container(es)', report),
        consequence: 'Os containers saem do B/L e das listas; os veículos dentro deles são apagados junto.',
        reversibility: 'Não é possível desfazer pelo sistema; o registro apagado fica guardado na auditoria.',
        confirmLabel: 'Excluir',
        tone: 'danger',
      })
      if (reason === null) return

      const result = await deleteContainers(report.deletableIds, reason)
      selection.clear()
      await afterCargaAlterada(queryClient)
      const outcome = formatDeleteOutcome('container(es)', result)
      showToast(outcome.message, outcome.tone)
    } catch (err) {
      const detail = userFacingErrorMessage(err, 'Não foi possível excluir os containers selecionados.')
      showToast(`Falha ao excluir container(es): ${detail}`, 'error')
    } finally {
      setDeleting(false)
    }
  }

  const pageContainerIds = rows.map((row) => row.id)
  const allPageSelected = pageContainerIds.length > 0 && pageContainerIds.every((id) => selection.isSelected(id))
  const containerColumnCount = isAdmin ? 11 : 10
  const containerSkeletonTemplate = `${isAdmin ? '44px ' : ''}1.1fr 1.1fr 1.3fr 1.4fr 0.6fr 0.7fr 0.7fr 0.8fr 0.9fr 0.9fr`

  // Erro ou carregamento mostram "—", nunca um zero que o sistema não sabe.
  const known = data !== undefined && !error && !stale
  const count = (value: number | undefined) => (known ? (value ?? 0).toLocaleString('pt-BR') : '—')
  // Quantos há de cada tipo vai no próprio filtro Tipo (decisão de 2026-10-16: sem cartão por tipo).
  const typeCounts = new Map((known ? data?.typeSummary ?? [] : []).map((item) => [displayAggregateLabel(item.type), item.distinctCount]))
  const repeatedAcrossBls = known && (data?.count ?? 0) > (data?.distinctCount ?? 0)

  return (
    <>
      <PageHeader
        title="Containers"
        action={
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" onClick={() => setDatesImportOpen(true)}>
              <CalendarDays size={16} aria-hidden="true" />
              Importar Datas de Descarga e Devolução
            </Button>
            <Button variant="secondary" loading={exporting} loadingLabel="Exportando…" onClick={handleExport}>
              <Download size={16} aria-hidden="true" />
              Exportar
            </Button>
          </div>
        }
      />

      <div className="app-metric-row" role="group" aria-label="Totais do recorte">
        <MetricCard label="Containers" value={count(data?.distinctCount)} />
        <MetricCard label="B/Ls" value={count(data?.blCount)} />
        <MetricCard label="IMO" value={count(data?.imoDistinctCount)} />
        <MetricCard label="OOG" value={count(data?.oogDistinctCount)} />
      </div>

      <div className="app-filter-grid">
          <Field label="Buscar">
            <Input
              type="search"
              placeholder="Container, lacre, B/L, cliente ou navio"
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
          <Field label="Tipo">
            <Select value={filters.containerType ?? ''} onChange={(event) => updateFilter('containerType', event.target.value)}>
              <option value="">Todos</option>
              {typeOptions?.map((type) => <option key={type} value={type}>{typeCounts.has(type) ? `${type} (${typeCounts.get(type)!.toLocaleString('pt-BR')})` : type}</option>)}
            </Select>
          </Field>
          <Field label="POL">
            <Select value={filters.pol} onChange={(event) => updateFilter('pol', event.target.value)}>
              <option value="">Todos</option>
              {portOptions?.pols.map((pol) => <option key={pol} value={pol}>{pol}</option>)}
            </Select>
          </Field>
          <Field label="POD">
            <Select value={filters.pod} onChange={(event) => updateFilter('pod', event.target.value)}>
              <option value="">Todos</option>
              {portOptions?.pods.map((pod) => <option key={pod} value={pod}>{pod}</option>)}
            </Select>
          </Field>
      </div>

      <FilterBar title="Mais filtros" activeCount={moreFilterCount} onClear={clearFilters}>
        <div className="app-filter-grid">
          <Field label="Perfil de carga">
            <Select value={filters.cargoProfile} onChange={(event) => updateFilter('cargoProfile', event.target.value)}>
              <option value="">Todos</option>
              <option value="imo">IMO</option>
              <option value="oog">OOG</option>
              <option value="standard">Sem IMO nem OOG</option>
            </Select>
          </Field>
          <Field label="Veículos">
            <Select value={filters.vehicleContainer} onChange={(event) => updateFilter('vehicleContainer', event.target.value as ContainerFilters['vehicleContainer'])}>
              <option value="">Todos</option>
              <option value="true">Com veículo</option>
              <option value="false">Sem veículo</option>
            </Select>
          </Field>
          <Field label="Revisão do B/L">
            <Select value={filters.reviewStatus} onChange={(event) => updateFilter('reviewStatus', event.target.value)}>
              <option value="">Todas</option>
              <option value="pending_review">Revisão pendente</option>
              <option value="reviewed">Revisado</option>
              <option value="ok">Sem pendência</option>
            </Select>
          </Field>
          <Field label="Situação financeira do B/L">
            <Select value={filters.financialStatus} onChange={(event) => updateFilter('financialStatus', event.target.value)}>
              <option value="">Todas</option>
              <option value="pending">Pendente</option>
              <option value="invoiced">Faturado</option>
              <option value="paid">Pago</option>
              <option value="cancelled">Cancelado</option>
            </Select>
          </Field>
          <Field label="Taxas locais">
            <Select value={filters.chargeStatus} onChange={(event) => updateFilter('chargeStatus', event.target.value)}>
              <option value="">Todas</option>
              {CHARGE_STATUS_FILTER_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </Select>
          </Field>
        </div>
      </FilterBar>

      {isAdmin ? (
        <BulkActionsBar
          count={selection.count}
          onClear={selection.clear}
          onDelete={() => runContainerDelete([...selection.selected])}
          deleting={deleting}
          noun={['container', 'containers']}
        />
      ) : null}

      <Card className="overflow-hidden p-0">
        {repeatedAcrossBls ? (
          <div className="app-cargo-toolbar">
            <span className="app-cargo-toolbar__hint">Container em mais de um B/L conta uma vez no total e aparece em cada B/L.</span>
          </div>
        ) : null}
        <QueryStateGate
          isLoading={false}
          isError={Boolean(error)}
          isPaused={fetchStatus === 'paused'}
          hasData={data !== undefined}
          errorMessage="Não foi possível carregar os containers."
          onRetry={() => void refetch()}
        >
          {isLoading || (stale && rows.length === 0) ? (
            <SkeletonTable rows={8} cols={containerColumnCount} columnTemplate={containerSkeletonTemplate} label="Carregando containers" />
          ) : rows.length === 0 ? (
            activeFilterCount > 0 ? (
              <EmptyState
                title="Nenhum container neste recorte"
                description="Nenhum container atende aos filtros aplicados."
                action={<Button variant="secondary" onClick={clearFilters}>Limpar filtros</Button>}
              />
            ) : (
              <EmptyState
                title="Nenhum container importado"
                description="Os containers entram pela importação de B/L de container. O Baplie confere a carga física, mas não cria container no B/L."
                action={<Link className="app-btn app-btn--secondary" to="/bls">Ir para B/Ls</Link>}
              />
            )
          ) : narrow ? (
            <ul className={`app-cargo-cards${stale ? ` ${STALE_PAGE_CLASS}` : ''}`} aria-label="Containers" aria-busy={stale || undefined}>
              {rows.map((row) => (
                <li key={row.id} className="app-cargo-card">
                  <div className="app-cargo-card__head">
                    {isAdmin ? (
                      <input
                        type="checkbox"
                        className="app-cargo-card__check"
                        aria-label={`Selecionar container ${row.container_number}`}
                        checked={selection.isSelected(row.id)}
                        disabled={stale}
                        onChange={() => selection.toggle(row.id)}
                      />
                    ) : null}
                    <div className="app-cargo-card__id">
                      <span className="app-cargo-code app-cargo-id"><CopyValue value={row.container_number} label="número do contêiner" /></span>
                      <span className="app-cargo-cell__sub">
                        {row.type ?? 'Tipo não informado'}{row.seal_number ? ` · Lacre ${row.seal_number}` : ''}
                      </span>
                    </div>
                  </div>
                  <div className="app-cargo-card__body">
                    <BlCell row={row} />
                    <VoyageCell row={row} />
                    <span className="app-cargo-card__facts">
                      <span>Descarga <DateCell value={row.discharge_date} label="descarga" /></span>
                      <span>Devolução <ReturnCell row={row} /></span>
                    </span>
                    <span className="app-cargo-card__status">
                      {row.is_imo || row.is_oog ? <CargoProfileBadge isImo={Boolean(row.is_imo)} isOog={Boolean(row.is_oog)} /> : null}
                      <OwnershipCell row={row} />
                      <LocalChargesStatus bl={row.bl ?? {}} />
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className={`app-table-scroll app-table-scroll--sticky${stale ? ` ${STALE_PAGE_CLASS}` : ''}`} aria-busy={stale || undefined}>
              <table className={`app-table app-cargo-table${isAdmin ? ' app-cargo-table--selectable' : ''}`}>
                <caption className="sr-only">Containers do recorte atual</caption>
                <thead>
                  <tr>
                    {isAdmin ? (
                      <th scope="col" className="app-cargo-table__check">
                        <input
                          type="checkbox"
                          aria-label="Selecionar todos os containers da página"
                          checked={allPageSelected}
                          disabled={stale}
                          onChange={() => selection.toggleMany(pageContainerIds)}
                        />
                      </th>
                    ) : null}
                    <th scope="col" className="app-cargo-table__id app-table__text-head">Container</th>
                    <th scope="col">B/L</th>
                    <th scope="col" className="app-table__text-head">Cliente</th>
                    <th scope="col" className="app-table__text-head">Navio / Viagem</th>
                    <th scope="col">Tipo</th>
                    <th scope="col">IMO / OOG</th>
                    <th scope="col">SOC/COC</th>
                    <th scope="col">Descarga</th>
                    <th scope="col">Devolução</th>
                    <th scope="col">Taxas locais</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id}>
                      {isAdmin ? (
                        <td className="app-cargo-table__check">
                          <input
                            type="checkbox"
                            aria-label={`Selecionar container ${row.container_number}`}
                            checked={selection.isSelected(row.id)}
                            disabled={stale}
                            onChange={() => selection.toggle(row.id)}
                          />
                        </td>
                      ) : null}
                      <td className="app-cargo-table__id"><span className="app-cargo-code app-cargo-id"><CopyValue value={row.container_number} label="número do contêiner" /></span></td>
                      <td><BlNumberCell row={row} /></td>
                      <td className="app-table__text" title={partyName(row) ?? undefined}>{partyName(row) ?? <NoValue label="Sem cliente" />}</td>
                      <td className="app-table__text"><VoyageCell row={row} /></td>
                      <td>{row.type ?? <NoValue label="Tipo não informado" />}</td>
                      <td><ProfileText row={row} /></td>
                      <td><OwnershipText row={row} /></td>
                      <td><DateCell value={row.discharge_date} label="descarga" /></td>
                      <td><ReturnCell row={row} /></td>
                      <td><LocalChargesStatus bl={row.bl ?? {}} /></td>
                    </tr>
                  ))}
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

      <ContainerDatesImportModal open={datesImportOpen} onClose={() => setDatesImportOpen(false)} />
    </>
  )
}
