import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Boxes, CalendarDays, Download, Trash2, MoreVertical } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { MetricCard } from '../components/ui/MetricCard'
import { Card, EmptyState, PageHeader } from '../components/ui/Card'
import { FilterBar } from '../components/ui/FilterBar'
import { Field, Input, Select } from '../components/ui/Input'
import { TableFooterPagination } from '../components/ui/TableFooterPagination'
import { QueryStateGate } from '../components/shared/QueryStateGate'
import { useToast } from '../components/ui/Toast'
import { useConfirm } from '../components/ui/ConfirmDialog'
import { useAuth } from '../hooks/useAuth'
import { useRowSelection } from '../hooks/useRowSelection'
import { usePageFilters } from '../hooks/usePageFilters'
import { useDebouncedValue } from '../hooks/useDebouncedValue'
import { BulkActionsBar } from '../components/shared/BulkActionsBar'
import { ContainerDatesImportModal } from '../components/shared/ContainerDatesImportModal'
import { CargoProfileBadge, ChargeStatusBadge } from '../components/shared/OperationalBadges'
import { VoyageCombobox } from '../components/shared/VoyageCombobox'
import { checkContainerDependencies, deleteContainers } from '../services/containers'
import { formatBlockedSummary } from '../services/deleteDependencies'
import { type ContainerFilters, fetchAllContainers, useContainers, usePortOptions, useContainerTypeOptions } from '../hooks/useBls'

export function Containers() {
  const queryClient = useQueryClient()
  const [searchParams] = useSearchParams()
  const initialVoyage = searchParams.get('voyage') ?? ''
  const initialPod = searchParams.get('pod') ?? ''
  const initialVehicleContainer = (searchParams.get('vehicle_container') ?? '') as ContainerFilters['vehicleContainer']
  const { showToast } = useToast()
  const confirm = useConfirm()
  const { user, isAdmin } = useAuth()
  const selection = useRowSelection<number>()
  const [deleting, setDeleting] = useState(false)
  const { filters, setFilters, updateFilter } = usePageFilters<ContainerFilters>({
    search: searchParams.get('search') ?? '',
    voyageId: initialVoyage,
    cargoMode: '',
    pol: '',
    pod: initialPod,
    reviewStatus: '',
    financialStatus: '',
    chargeStatus: '',
    cargoProfile: '',
    containerType: '',
    vehicleContainer: initialVehicleContainer,
    page: 1,
    pageSize: 20,
  })
  const [exporting, setExporting] = useState(false)
  const [datesImportOpen, setDatesImportOpen] = useState(false)
  const debouncedSearch = useDebouncedValue(filters.search)
  const queryFilters = useMemo(() => ({
    ...filters,
    search: debouncedSearch,
    page: debouncedSearch === filters.search ? filters.page : 1,
  }), [debouncedSearch, filters])
  const { data, isLoading, error, fetchStatus, refetch } = useContainers(queryFilters)
  const { data: portOptions } = usePortOptions()
  const { data: typeOptions } = useContainerTypeOptions()

  const totalPages = Math.max(1, Math.ceil((data?.count ?? 0) / filters.pageSize))

  const activeFilterCount = (
    ['search', 'voyageId', 'pol', 'pod', 'reviewStatus', 'financialStatus', 'chargeStatus', 'cargoProfile', 'containerType', 'vehicleContainer'] as (keyof ContainerFilters)[]
  ).filter((key) => String(filters[key] ?? '').trim() !== '').length

  type ActionsMenuState = {
    id: number
    top: number
    left: number
  } | null
  const [actionsMenu, setActionsMenu] = useState<ActionsMenuState>(null)
  const actionsTriggerRef = useRef<HTMLButtonElement | null>(null)
  const actionsItemRef = useRef<HTMLButtonElement | null>(null)

  function openActionsMenu(id: number, button: HTMLButtonElement) {
    actionsTriggerRef.current = button
    const rect = button.getBoundingClientRect()
    setActionsMenu({
      id,
      top: rect.bottom + window.scrollY + 4,
      left: rect.right + window.scrollX - 160,
    })
  }

  useEffect(() => {
    if (!actionsMenu) {
      actionsTriggerRef.current?.focus()
      actionsTriggerRef.current = null
      return
    }
    actionsItemRef.current?.focus()
  }, [actionsMenu])

  useEffect(() => {
    if (!actionsMenu) return
    const close = () => setActionsMenu(null)
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    const onPointer = (event: MouseEvent) => {
      const target = event.target as HTMLElement
      if (!target.closest('[data-actions-menu]')) close()
    }
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onPointer)
    return () => {
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onPointer)
    }
  }, [actionsMenu])

  function clearFilters() {
    setFilters((current) => ({
      ...current,
      search: '',
      voyageId: '',
      pol: '',
      pod: '',
      reviewStatus: '',
      financialStatus: '',
      chargeStatus: '',
      cargoProfile: '',
      containerType: '',
      vehicleContainer: '',
      page: 1,
    }))
  }

  async function handleExport() {
    setExporting(true)
    try {
      const rows = await fetchAllContainers(filters)
      if (!rows.length) {
        showToast('Nenhum container encontrado para exportar com os filtros atuais.', 'info')
        return
      }

      const { exportContainerWorkbook } = await import('../services/exports')
      await exportContainerWorkbook(rows)
      showToast(`Exportação concluída com ${rows.length} container(es).`, 'success')
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
        showToast(`Nenhum container pode ser excluido. ${formatBlockedSummary(report.blockedIds)}`, 'error')
        return
      }

      const parts = [
        `Excluir ${report.deletableIds.length} container(es)? Os veiculos vinculados serao excluidos junto. Esta acao e irreversivel.`,
      ]
      if (report.blockedIds.length) parts.push(formatBlockedSummary(report.blockedIds))
      const ok = await confirm({ message: parts.join('\n\n'), tone: 'danger', confirmLabel: 'Excluir' })
      if (!ok) return

      await deleteContainers(report.deletableIds, user?.id)
      selection.clear()
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['containers'] }),
        queryClient.invalidateQueries({ queryKey: ['bls'] }),
        queryClient.invalidateQueries({ queryKey: ['vehicles'] }),
        queryClient.invalidateQueries({ queryKey: ['bl-detail'] }),
      ])
      showToast(`${report.deletableIds.length} container(es) excluido(s).`, 'success')
    } catch (err) {
      const detail = err instanceof Error ? err.message : 'erro desconhecido'
      showToast(`Falha ao excluir container(es): ${detail}`, 'error')
    } finally {
      setDeleting(false)
    }
  }

  const pageContainerIds = (data?.rows ?? []).map((row) => row.id)
  const allPageSelected = pageContainerIds.length > 0 && pageContainerIds.every((id) => selection.isSelected(id))
  const containerColumnCount = isAdmin ? 11 : 10

  return (
    <>
      <PageHeader
        title="Containers"
        description="Lista consolidada dos containers importados via manifestos. O total distinto considera o número do container, mesmo quando ele aparece em mais de um B/L."
        action={
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" onClick={() => setDatesImportOpen(true)}>
              <CalendarDays size={16} />
              Importar Datas de Descarga e Devolução
            </Button>
            <Button variant="secondary" loading={exporting} onClick={handleExport}>
              <Download size={16} />
              Exportar Containers
            </Button>
            <Link
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-[#21262d] px-4 text-sm font-semibold text-slate-100 transition hover:bg-[#30363d]"
              to="/bls"
            >
              <Boxes size={16} />
              Voltar aos BLs
            </Link>
          </div>
        }
      />

      <FilterBar activeCount={activeFilterCount} onClear={clearFilters}>
        <div className="app-filter-grid">
          <Field label="Texto livre">
            <Input
              placeholder="Container, B/L, cliente ou navio"
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
                <option key={pol} value={pol}>
                  {pol}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="POD">
            <Select value={filters.pod} onChange={(event) => updateFilter('pod', event.target.value)}>
              <option value="">Todos</option>
              {portOptions?.pods.map((pod) => (
                <option key={pod} value={pod}>
                  {pod}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Status revisao do B/L">
            <Select value={filters.reviewStatus} onChange={(event) => updateFilter('reviewStatus', event.target.value)}>
              <option value="">Todos</option>
              <option value="ok">OK</option>
              <option value="pending_review">Pendente</option>
              <option value="reviewed">Revisado</option>
            </Select>
          </Field>
          <Field label="Status financeiro do B/L">
            <Select
              value={filters.financialStatus}
              onChange={(event) => updateFilter('financialStatus', event.target.value)}
            >
              <option value="">Todos</option>
              <option value="pending">Pendente</option>
              <option value="invoiced">Faturado</option>
              <option value="paid">Pago</option>
              <option value="cancelled">Cancelado</option>
            </Select>
          </Field>
          <Field label="Status taxas locais">
            <Select value={filters.chargeStatus} onChange={(event) => updateFilter('chargeStatus', event.target.value)}>
              <option value="">Todos</option>
              <option value="review_required">Revisão</option>
              <option value="exempt">Isento</option>
              <option value="ready_for_billing">Faturado</option>
            </Select>
          </Field>
          <Field label="Perfil de carga">
            <Select value={filters.cargoProfile} onChange={(event) => updateFilter('cargoProfile', event.target.value)}>
              <option value="">Todos</option>
              <option value="oog">OOG</option>
              <option value="imo">IMO</option>
            </Select>
          </Field>
          <Field label="Tipo de container">
            <Select value={filters.containerType ?? ''} onChange={(event) => updateFilter('containerType', event.target.value)}>
              <option value="">Todos</option>
              {typeOptions?.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Veículo">
            <Select value={filters.vehicleContainer} onChange={(event) => updateFilter('vehicleContainer', event.target.value as ContainerFilters['vehicleContainer'])}>
              <option value="">Todos</option>
              <option value="true">Com veículo</option>
              <option value="false">Sem veículo</option>
            </Select>
          </Field>
        </div>
      </FilterBar>

      <div className="mb-5 flex flex-col gap-4">
        <div>
          <MetricCard label="Containers distintos" value={isLoading ? '...' : data?.distinctCount ?? 0} tone="primary" />
        </div>
        <div className="grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-[repeat(auto-fit,minmax(200px,1fr))]">
          <MetricCard label="Registros filtrados" value={isLoading ? '...' : data?.count ?? 0} />
          <MetricCard label="B/Ls envolvidos" value={isLoading ? '...' : data?.blCount ?? 0} />
          <MetricCard label="OOG distintos" value={isLoading ? '...' : data?.oogDistinctCount ?? 0} />
          <MetricCard label="IMO distintos" value={isLoading ? '...' : data?.imoDistinctCount ?? 0} />
        </div>
      </div>

      <Card className="mb-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-sm text-slate-400">Resumo por tipo</div>
            <div className="mt-1 text-xs text-slate-500">Conta containers distintos por tipo com base nos filtros ativos.</div>
          </div>
          <div className="flex flex-wrap gap-2">
            {isLoading ? (
              <span className="text-sm text-slate-400">Carregando tipos...</span>
            ) : data?.typeSummary.length ? (
              data.typeSummary.map((item) => (
                <div key={item.type} className="rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2 text-sm">
                  <span className="font-semibold text-white">{item.type}</span>
                  <span className="ml-2 text-slate-400">{item.distinctCount}</span>
                </div>
              ))
            ) : (
              <span className="text-sm text-slate-400">Nenhum tipo encontrado.</span>
            )}
          </div>
        </div>
      </Card>

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
        <QueryStateGate
          isLoading={false}
          isError={Boolean(error)}
          isPaused={fetchStatus === 'paused'}
          hasData={data !== undefined}
          errorMessage="Erro ao carregar containers."
          onRetry={() => void refetch()}
        >
        <div className="app-table-scroll app-table-scroll--sticky">
          <table className="app-table app-table--compact min-w-[1060px] border-collapse text-left text-sm whitespace-nowrap">
            <caption className="sr-only">Containers filtrados</caption>
            <thead className="bg-[#0d1117] text-xs uppercase tracking-wider text-slate-500">
              <tr>
                {isAdmin ? (
                  <th scope="col" className="w-10 px-4 py-3">
                    <input
                      type="checkbox"
                      aria-label="Selecionar todos os containers da pagina"
                      checked={allPageSelected}
                      onChange={() => selection.toggleMany(pageContainerIds)}
                    />
                  </th>
                ) : null}
                <th scope="col" className="px-4 py-3">Container</th>
                <th scope="col" className="px-4 py-3">B/L</th>
                <th scope="col" className="w-[84px] px-4 py-3">CNEE</th>
                <th scope="col" className="px-4 py-3">Navio/Viagem</th>
                <th scope="col" className="px-4 py-3">POL</th>
                <th scope="col" className="px-4 py-3">POD</th>
                <th scope="col" className="px-4 py-3">Tipo</th>
                <th scope="col" className="px-4 py-3">Perfil</th>
                <th scope="col" className="px-4 py-3">Taxas locais</th>
                <th scope="col" className="px-4 py-3">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#30363d]">
              {isLoading ? (
                <tr>
                  <td colSpan={containerColumnCount} className="px-4 py-8 text-center text-slate-400">
                    Carregando containers...
                  </td>
                </tr>
              ) : null}
              {!isLoading && data?.rows.length === 0 ? (
                <tr>
                  <td colSpan={containerColumnCount} className="p-0">
                    <EmptyState title="Nenhum container encontrado." description="Ajuste os filtros de viagem ou POD." />
                  </td>
                </tr>
              ) : null}
              {data?.rows.map((container) => (
                <tr key={container.id} className="hover:bg-[#21262d]/60">
                  {isAdmin ? (
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        aria-label={`Selecionar container ${container.container_number}`}
                        checked={selection.isSelected(container.id)}
                        onChange={() => selection.toggle(container.id)}
                      />
                    </td>
                  ) : null}
                  <td className="px-4 py-3 font-semibold text-white">{container.container_number}</td>
                  <td className="px-4 py-3">
                    <Link className="text-[#58a6ff] hover:underline" to={`/bls/${container.bl?.id}`}>
                      {container.bl?.id ?? '-'}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className="app-table__truncate app-table__truncate--xs"
                      title={container.bl?.customer?.name ?? container.bl?.consignee ?? '-'}
                    >
                      {container.bl?.customer?.name ?? container.bl?.consignee ?? '-'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className="app-table__truncate app-table__truncate--xl"
                      title={`${container.bl?.voyage?.vessel?.name ?? '-'} / ${container.bl?.voyage?.voyage_number ?? '-'}`}
                    >
                      {container.bl?.voyage?.vessel?.name ?? '-'} / {container.bl?.voyage?.voyage_number ?? '-'}
                    </span>
                  </td>
                  <td className="px-4 py-3">{container.bl?.pol ?? '-'}</td>
                  <td className="px-4 py-3">{container.bl?.pod ?? '-'}</td>
                  <td className="px-4 py-3">{container.type ?? '-'}</td>
                  <td className="px-4 py-3">
                    <CargoProfileBadge isImo={Boolean(container.is_imo)} isOog={Boolean(container.is_oog)} />
                  </td>
                  <td className="px-4 py-3">
                    <ChargeStatusBadge status={container.bl?.charge_status ?? null} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <Link
                        className="app-table__action"
                        to={`/bls/${container.bl?.id}`}
                      >
                        Abrir B/L
                      </Link>
                      {isAdmin ? (
                        <button
                          type="button"
                          className="app-btn app-btn--secondary p-1 leading-none"
                          aria-label={`Ações para container ${container.container_number}`}
                          aria-haspopup="menu"
                          aria-expanded={actionsMenu?.id === container.id}
                          aria-controls="containers-actions-menu"
                          onClick={(e) => openActionsMenu(container.id, e.currentTarget)}
                          onKeyDown={(e) => {
                            if (e.key === 'ArrowDown') {
                              e.preventDefault()
                              openActionsMenu(container.id, e.currentTarget)
                            }
                          }}
                        >
                          <MoreVertical size={15} />
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </QueryStateGate>

        {data && totalPages > 1 ? (
          <TableFooterPagination
            page={filters.page}
            pageSize={filters.pageSize}
            totalCount={data?.count ?? 0}
            totalPages={totalPages}
            countLabel={`${data?.count ?? 0} containers`}
            onPageChange={(page) => updateFilter('page', page)}
            onPageSizeChange={(pageSize) => updateFilter('pageSize', pageSize)}
          />
        ) : null}
      </Card>

      {actionsMenu ? (
        <div
          data-actions-menu
          id="containers-actions-menu"
          className="app-floating-menu"
          role="menu"
          style={{ top: actionsMenu.top, left: actionsMenu.left }}
        >
          {isAdmin ? (
            <button
              type="button"
              role="menuitem"
              ref={actionsItemRef}
              className="app-floating-menu__danger"
              disabled={deleting}
              onClick={() => {
                const id = actionsMenu.id
                setActionsMenu(null)
                void runContainerDelete([id])
              }}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault()
                  setActionsMenu(null)
                }
              }}
            >
              <Trash2 size={14} />
              Excluir container
            </button>
          ) : null}
        </div>
      ) : null}

      <ContainerDatesImportModal open={datesImportOpen} onClose={() => setDatesImportOpen(false)} />
    </>
  )
}
