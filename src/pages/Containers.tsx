import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { afterCargaAlterada } from '../services/cacheEffects'
import { CalendarDays, Download, MoreVertical, Trash2 } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { ActionMenu } from '../components/ui/ActionMenu'
import { Card, EmptyState, PageHeader } from '../components/ui/Card'
import { FilterBar } from '../components/ui/FilterBar'
import { Field, Input, Select } from '../components/ui/Input'
import { SummaryStrip, type SummaryItem } from '../components/ui/SummaryStrip'
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
import { CargoProfileBadge, ChargeStatusBadge, ContainerOwnershipBadge } from '../components/shared/OperationalBadges'
import { VoyageCombobox } from '../components/shared/VoyageCombobox'
import { checkContainerDependencies, deleteContainers } from '../services/containers'
import { buildDeleteAffected, formatBlockedSummary, formatDeleteOutcome } from '../services/deleteDependencies'
import { type ContainerFilters, fetchAllContainers, useContainers, usePortOptions, useContainerTypeOptions } from '../hooks/useBls'
import { userFacingErrorMessage } from '../lib/errors'
import { formatDate } from '../lib/utils'
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
  return (
    <span className="app-cargo-cell__stack">
      {voyage?.id ? (
        <Link className="app-cargo-link app-cargo-cell__truncate" to={`/viagens/${voyage.id}`} title={voyageText(row)}>{voyageText(row)}</Link>
      ) : <span>—</span>}
      <span className="app-cargo-cell__sub">{routeText(row)}</span>
    </span>
  )
}

function BlCell({ row }: { row: ContainerRow }) {
  const name = partyName(row)
  return (
    <span className="app-cargo-cell__stack">
      {row.bl?.id ? <Link className="app-cargo-link app-cargo-id" to={`/bls/${row.bl.id}`}>{row.bl.id}</Link> : <span>—</span>}
      {name ? <span className="app-cargo-cell__sub app-cargo-cell__truncate" title={name}>{name}</span> : null}
    </span>
  )
}

function OwnershipCell({ row }: { row: ContainerRow }) {
  const source = ownershipSourceLabel(row.ownership_source, row.ownership)
  return (
    <span className="app-cargo-cell__stack">
      <ContainerOwnershipBadge ownership={row.ownership} />
      {source ? <span className="app-cargo-cell__sub">{source}</span> : null}
    </span>
  )
}

function ProfileCell({ row }: { row: ContainerRow }) {
  if (!row.is_imo && !row.is_oog) return <span className="app-cargo-cell__muted" aria-label="Sem IMO nem OOG">—</span>
  return <CargoProfileBadge isImo={Boolean(row.is_imo)} isOog={Boolean(row.is_oog)} />
}

function DateCell({ value, label }: { value: string | null | undefined; label: string }) {
  if (!value) return <span className="app-cargo-cell__muted" aria-label={`Sem ${label}`}>—</span>
  return <span className="app-cargo-num">{formatDate(value)}</span>
}

function ReturnCell({ row }: { row: ContainerRow }) {
  const { text, muted, srText } = describeReturn(row.return_date, row.ownership, formatDate)
  return <span className={muted ? 'app-cargo-cell__muted' : 'app-cargo-num'} aria-label={srText}>{text}</span>
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
  const listSearch = containersSearchFromFilters(filters)
  useEffect(() => {
    if (listSearch !== searchParams.toString()) setSearchParams(new URLSearchParams(listSearch), { replace: true })
  }, [listSearch, searchParams, setSearchParams])

  const debouncedSearch = useDebouncedValue(filters.search)
  const queryFilters = useMemo(() => ({
    ...filters,
    search: debouncedSearch,
    page: debouncedSearch === filters.search ? filters.page : 1,
  }), [debouncedSearch, filters])
  const { data, isLoading, error, fetchStatus, refetch } = useContainers(queryFilters)
  const { data: portOptions } = usePortOptions()
  const { data: typeOptions } = useContainerTypeOptions()
  const rows = (data?.rows ?? []) as ContainerRow[]

  const totalPages = Math.max(1, Math.ceil((data?.count ?? 0) / filters.pageSize))
  const activeFilterCount = countActiveContainerFilters(filters)

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
  const containerColumnCount = isAdmin ? 11 : 9
  const containerSkeletonTemplate = `${isAdmin ? '44px ' : ''}1.1fr 1.3fr 1.4fr 0.6fr 0.7fr 0.9fr 0.8fr 0.9fr 0.9fr${isAdmin ? ' 52px' : ''}`

  // Erro ou carregamento mostram "—", nunca um zero que o sistema não sabe.
  const known = data !== undefined && !error
  const count = (value: number | undefined) => (known ? (value ?? 0).toLocaleString('pt-BR') : '—')
  const summaryItems: SummaryItem[] = [
    { label: 'containers distintos', value: count(data?.distinctCount) },
    { label: data?.blCount === 1 ? 'B/L' : 'B/Ls', value: count(data?.blCount) },
    { label: 'OOG', value: count(data?.oogDistinctCount) },
    { label: 'IMO', value: count(data?.imoDistinctCount) },
    ...(known ? (data?.typeSummary ?? []).map((item) => ({ label: displayAggregateLabel(item.type), value: item.distinctCount.toLocaleString('pt-BR') })) : []),
  ]
  const repeatedAcrossBls = known && (data?.count ?? 0) > (data?.distinctCount ?? 0)

  function rowMenu(row: ContainerRow) {
    return (
      <ActionMenu
        label={`Ações para container ${row.container_number}`}
        menuId={`container-actions-${row.id}`}
        triggerClassName="app-table__icon-button"
        trigger={<MoreVertical size={16} aria-hidden="true" />}
        items={[{
          key: 'delete',
          label: 'Excluir container',
          icon: <Trash2 size={14} aria-hidden="true" />,
          danger: true,
          disabled: deleting,
          onSelect: () => void runContainerDelete([row.id]),
        }]}
      />
    )
  }

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

      <FilterBar activeCount={activeFilterCount} onClear={clearFilters}>
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
          <Field label="Tipo de container">
            <Select value={filters.containerType ?? ''} onChange={(event) => updateFilter('containerType', event.target.value)}>
              <option value="">Todos</option>
              {typeOptions?.map((type) => <option key={type} value={type}>{type}</option>)}
            </Select>
          </Field>
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
        <div className="app-cargo-toolbar">
          <SummaryStrip label="Resumo do recorte" items={summaryItems} />
          {repeatedAcrossBls ? (
            <span className="app-cargo-toolbar__hint">Container em mais de um B/L conta uma vez nos distintos e aparece em cada B/L.</span>
          ) : null}
        </div>
        <QueryStateGate
          isLoading={false}
          isError={Boolean(error)}
          isPaused={fetchStatus === 'paused'}
          hasData={data !== undefined}
          errorMessage="Não foi possível carregar os containers."
          onRetry={() => void refetch()}
        >
          {isLoading ? (
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
            <ul className="app-cargo-cards" aria-label="Containers">
              {rows.map((row) => (
                <li key={row.id} className="app-cargo-card">
                  <div className="app-cargo-card__head">
                    {isAdmin ? (
                      <input
                        type="checkbox"
                        className="app-cargo-card__check"
                        aria-label={`Selecionar container ${row.container_number}`}
                        checked={selection.isSelected(row.id)}
                        onChange={() => selection.toggle(row.id)}
                      />
                    ) : null}
                    <div className="app-cargo-card__id">
                      <span className="app-cargo-code app-cargo-id">{row.container_number}</span>
                      <span className="app-cargo-cell__sub">
                        {row.type ?? 'Tipo não informado'}{row.seal_number ? ` · Lacre ${row.seal_number}` : ''}
                      </span>
                    </div>
                    {isAdmin ? rowMenu(row) : null}
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
                      <ContainerOwnershipBadge ownership={row.ownership} />
                      <ChargeStatusBadge status={row.bl?.charge_status ?? null} />
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="app-table-scroll app-table-scroll--sticky">
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
                          onChange={() => selection.toggleMany(pageContainerIds)}
                        />
                      </th>
                    ) : null}
                    <th scope="col" className="app-cargo-table__id">Container</th>
                    <th scope="col">B/L e cliente</th>
                    <th scope="col">Navio / Viagem</th>
                    <th scope="col">Tipo</th>
                    <th scope="col">IMO / OOG</th>
                    <th scope="col">SOC/COC</th>
                    <th scope="col">Descarga</th>
                    <th scope="col">Devolução</th>
                    <th scope="col">Taxas locais</th>
                    {isAdmin ? <th scope="col"><span className="sr-only">Ações</span></th> : null}
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
                            onChange={() => selection.toggle(row.id)}
                          />
                        </td>
                      ) : null}
                      <td className="app-cargo-table__id">
                        <span className="app-cargo-cell__stack">
                          <span className="app-cargo-code app-cargo-id">{row.container_number}</span>
                          {row.seal_number ? <span className="app-cargo-cell__sub">Lacre {row.seal_number}</span> : null}
                        </span>
                      </td>
                      <td><BlCell row={row} /></td>
                      <td><VoyageCell row={row} /></td>
                      <td>{row.type ?? <span className="app-cargo-cell__muted" aria-label="Tipo não informado">—</span>}</td>
                      <td><ProfileCell row={row} /></td>
                      <td><OwnershipCell row={row} /></td>
                      <td><DateCell value={row.discharge_date} label="descarga" /></td>
                      <td><ReturnCell row={row} /></td>
                      <td><ChargeStatusBadge status={row.bl?.charge_status ?? null} /></td>
                      {isAdmin ? <td>{rowMenu(row)}</td> : null}
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
