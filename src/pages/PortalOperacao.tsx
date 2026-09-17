import { Fragment, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ChevronDown, ChevronUp, Download } from 'lucide-react'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card, EmptyState, InlineError, PageHeader } from '../components/ui/Card'
import { TabButton } from '../components/ui/TabButton'
import { FilterBar } from '../components/ui/FilterBar'
import { Field, Input, Select } from '../components/ui/Input'
import { TableFooterPagination } from '../components/ui/TableFooterPagination'
import { usePortalOperationBls } from '../hooks/usePortalOperation'
import { formatDate } from '../lib/utils'
import {
  blMatchesReturnSituation,
  containerMatchesReturnSituation,
  flattenContainers,
  type ReturnSituation,
} from '../lib/portalOperationViews'
import { exportPortalBlsWorkbook, exportPortalContainersWorkbook } from '../services/exports'
import type { PortalOperationBL, PortalOperationContainerStatus } from '../services/portalOperation'

type OperationTab = 'bls' | 'containers'
type OpStatus = '' | PortalOperationContainerStatus

const PAGE_SIZES = [10, 25, 50, 100]

const RETURN_OPTIONS: { value: ReturnSituation; label: string }[] = [
  { value: '', label: 'Todos' },
  { value: 'todos_devolvidos', label: 'Todos devolvidos' },
  { value: 'sem_devolucao', label: 'Com containers sem devolução' },
  { value: 'em_demurrage', label: 'Com containers em demurrage' },
  { value: 'sem_descarga', label: 'Sem descarga' },
]

const STATUS_OPTIONS: { value: OpStatus; label: string }[] = [
  { value: '', label: 'Todos' },
  { value: 'sem_descarga', label: 'Sem descarga' },
  { value: 'dentro_free_time', label: 'Dentro do free time' },
  { value: 'em_demurrage', label: 'Em demurrage' },
  { value: 'devolvido', label: 'Devolvido' },
]

function includesText(value: string | null | undefined, term: string) {
  if (!term.trim()) return true
  return (value ?? '').toLowerCase().includes(term.trim().toLowerCase())
}

type BlFilters = {
  bl: string
  ce: string
  vessel: string
  voyage: string
  pol: string
  pod: string
  devolucao: ReturnSituation
  status: OpStatus
}

type ContainerFilters = {
  container: string
  bl: string
  ce: string
  vessel: string
  voyage: string
  pol: string
  pod: string
  devolucao: ReturnSituation
  status: OpStatus
}

const EMPTY_BL_FILTERS: BlFilters = { bl: '', ce: '', vessel: '', voyage: '', pol: '', pod: '', devolucao: '', status: '' }
const EMPTY_CONTAINER_FILTERS: ContainerFilters = { container: '', bl: '', ce: '', vessel: '', voyage: '', pol: '', pod: '', devolucao: '', status: '' }

export function PortalOperacao() {
  const { data, isLoading, error } = usePortalOperationBls()
  const rows = useMemo(() => data ?? [], [data])

  const [searchParams, setSearchParams] = useSearchParams()
  const tab: OperationTab = searchParams.get('tab') === 'containers' ? 'containers' : 'bls'
  const setTab = (next: OperationTab) => {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev)
      params.set('tab', next)
      return params
    })
  }

  const initialDevolucao = (searchParams.get('devolucao') ?? '') as ReturnSituation
  const [blFilters, setBlFilters] = useState<BlFilters>(EMPTY_BL_FILTERS)
  const [containerFilters, setContainerFilters] = useState<ContainerFilters>({
    ...EMPTY_CONTAINER_FILTERS,
    devolucao: RETURN_OPTIONS.some((o) => o.value === initialDevolucao) ? initialDevolucao : '',
  })

  return (
    <>
      <PageHeader
        title="BLs e Containers"
        description="Consulte seus B/Ls e containers: descarga, devolução, free time e dias de demurrage."
      />

      <div className="mb-4 flex gap-2 border-b border-[var(--app-border)]" role="tablist">
        <TabButton active={tab === 'bls'} label="BLs" onClick={() => setTab('bls')} />
        <TabButton active={tab === 'containers'} label="Containers" onClick={() => setTab('containers')} />
      </div>

      {isLoading ? <EmptyState title="Carregando..." description="Buscando dados operacionais." /> : null}
      {error ? <div className="px-1 py-4"><InlineError message="Falha ao carregar dados operacionais do portal." /></div> : null}

      {!isLoading && !error ? (
        tab === 'bls' ? (
          <BlsTab rows={rows} filters={blFilters} onFilters={setBlFilters} />
        ) : (
          <ContainersTab rows={rows} filters={containerFilters} onFilters={setContainerFilters} />
        )
      ) : null}
    </>
  )
}

// --- Aba BLs -------------------------------------------------------------

function BlsTab({ rows, filters, onFilters }: { rows: PortalOperationBL[]; filters: BlFilters; onFilters: (f: BlFilters) => void }) {
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(25)
  const [openBl, setOpenBl] = useState<string | null>(null)

  const filtered = useMemo(
    () =>
      rows.filter(
        (r) =>
          includesText(r.bl_id, filters.bl) &&
          includesText(r.ce_mercante, filters.ce) &&
          includesText(r.vessel_name, filters.vessel) &&
          includesText(r.voyage_number, filters.voyage) &&
          includesText(r.pol, filters.pol) &&
          includesText(r.pod, filters.pod) &&
          blMatchesReturnSituation(r, filters.devolucao) &&
          (!filters.status || r.containers.some((c) => c.status === filters.status)),
      ),
    [rows, filters],
  )

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(page, totalPages - 1)
  const paginated = filtered.slice(safePage * pageSize, (safePage + 1) * pageSize)
  const activeFilters = Object.values(filters).filter(Boolean).length

  return (
    <Card className="overflow-hidden p-0">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--app-border)] px-5 py-4">
        <div>
          <h2 className="text-base font-semibold">B/Ls</h2>
          <p className="mt-1 text-sm text-[var(--app-muted)]">{filtered.length} B/L(s) encontrado(s)</p>
        </div>
        <Button variant="secondary" onClick={() => void exportPortalBlsWorkbook(filtered)} disabled={filtered.length === 0}>
          <Download size={16} />
          Exportar Excel
        </Button>
      </div>

      <div className="px-5 pt-4">
        <FilterBar activeCount={activeFilters} onClear={() => { onFilters(EMPTY_BL_FILTERS); setPage(0) }}>
          <div className="app-filter-grid">
            <Field label="B/L"><Input value={filters.bl} onChange={(e) => { onFilters({ ...filters, bl: e.target.value }); setPage(0) }} placeholder="Numero do B/L" /></Field>
            <Field label="CE Mercante"><Input value={filters.ce} onChange={(e) => { onFilters({ ...filters, ce: e.target.value }); setPage(0) }} placeholder="CE Mercante" /></Field>
            <Field label="Navio"><Input value={filters.vessel} onChange={(e) => { onFilters({ ...filters, vessel: e.target.value }); setPage(0) }} placeholder="Navio" /></Field>
            <Field label="Viagem"><Input value={filters.voyage} onChange={(e) => { onFilters({ ...filters, voyage: e.target.value }); setPage(0) }} placeholder="Viagem" /></Field>
            <Field label="POL"><Input value={filters.pol} onChange={(e) => { onFilters({ ...filters, pol: e.target.value }); setPage(0) }} placeholder="POL" /></Field>
            <Field label="POD"><Input value={filters.pod} onChange={(e) => { onFilters({ ...filters, pod: e.target.value }); setPage(0) }} placeholder="POD" /></Field>
            <Field label="Situação de devolução">
              <Select value={filters.devolucao} onChange={(e) => { onFilters({ ...filters, devolucao: e.target.value as ReturnSituation }); setPage(0) }}>
                {RETURN_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </Select>
            </Field>
            <Field label="Status operacional">
              <Select value={filters.status} onChange={(e) => { onFilters({ ...filters, status: e.target.value as OpStatus }); setPage(0) }}>
                {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </Select>
            </Field>
            <Field label="Por página">
              <Select value={String(pageSize)} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(0) }}>
                {PAGE_SIZES.map((s) => <option key={s} value={String(s)}>{s}</option>)}
              </Select>
            </Field>
          </div>
        </FilterBar>
      </div>

      {filtered.length === 0 ? (
        <EmptyState title="Sem B/Ls" description="Nenhum B/L encontrado para os filtros atuais." />
      ) : (
        <>
          <div className="hidden app-table-scroll md:block">
            <table className="app-table app-table--compact min-w-[1040px] text-left text-sm">
              <thead>
                <tr>
                  <th scope="col" className="px-4 py-3">B/L</th>
                  <th scope="col" className="px-4 py-3">CE Mercante</th>
                  <th scope="col" className="px-4 py-3">Navio</th>
                  <th scope="col" className="px-4 py-3">Viagem</th>
                  <th scope="col" className="px-4 py-3">POL</th>
                  <th scope="col" className="px-4 py-3">POD</th>
                  <th scope="col" className="px-4 py-3">Containers</th>
                  <th scope="col" className="px-4 py-3">Devolvidos</th>
                  <th scope="col" className="px-4 py-3">Sem devolução</th>
                  <th scope="col" className="px-4 py-3">Em demurrage</th>
                  <th scope="col" className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {paginated.map((row) => {
                  const isOpen = openBl === row.bl_id
                  const noReturn = row.container_count - row.containers_returned
                  return (
                    <Fragment key={row.bl_id}>
                      <tr className={`cursor-pointer ${isOpen ? 'bg-[var(--app-surface-hover)]' : ''}`} onClick={() => setOpenBl(isOpen ? null : row.bl_id)}>
                        <td className="px-4 py-3 font-semibold">{row.bl_id}</td>
                        <td className="px-4 py-3">{row.ce_mercante ? <Badge tone="blue">CE {row.ce_mercante}</Badge> : <Badge>Sem CE</Badge>}</td>
                        <td className="px-4 py-3">{row.vessel_name ?? '-'}</td>
                        <td className="px-4 py-3">{row.voyage_number ?? '-'}</td>
                        <td className="px-4 py-3">{row.pol ?? '-'}</td>
                        <td className="px-4 py-3">{row.pod ?? '-'}</td>
                        <td className="px-4 py-3">
                          {row.cargo_mode === 'misto' || ((row.bb_weight_ton ?? 0) > 0 && row.container_count > 0) ? (
                            <span className="font-medium">{row.container_count} CNTR + {row.bb_weight_ton ?? 0}t</span>
                          ) : row.cargo_mode === 'carga_solta' ? (
                            <span className="font-medium">{row.bb_weight_ton ?? 0}t</span>
                          ) : (
                            row.container_count
                          )}
                        </td>
                        <td className="px-4 py-3">{row.containers_returned}</td>
                        <td className="px-4 py-3">{noReturn > 0 ? <Badge tone="yellow">{noReturn}</Badge> : '0'}</td>
                        <td className="px-4 py-3">{row.containers_in_demurrage > 0 ? <Badge tone="red">{row.containers_in_demurrage}</Badge> : '0'}</td>
                        <td className="px-4 py-3">{isOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</td>
                      </tr>
                      {isOpen ? (
                        <tr key={`${row.bl_id}-details`}>
                          <td colSpan={11} className="p-0"><ContainerDetails row={row} /></td>
                        </tr>
                      ) : null}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="grid gap-3 p-4 md:hidden" data-testid="portal-operacao-bl-mobile-cards">
            {paginated.map((row) => {
              const noReturn = row.container_count - row.containers_returned
              return (
                <button
                  key={row.bl_id}
                  type="button"
                  onClick={() => setOpenBl(openBl === row.bl_id ? null : row.bl_id)}
                  className="rounded-xl border border-[var(--app-border)] bg-[var(--app-surface)] p-4 text-left"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold">B/L {row.bl_id}</span>
                    {row.ce_mercante ? <Badge tone="blue">CE</Badge> : <Badge>Sem CE</Badge>}
                  </div>
                  <div className="mt-2 text-sm text-[var(--app-muted)]">
                    {[row.vessel_name, row.voyage_number].filter(Boolean).join(' / ') || '-'}
                  </div>
                  <div className="mt-1 text-sm text-[var(--app-muted)]">{row.pol ?? '-'} - {row.pod ?? '-'}</div>
                  <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                    <span>Containers {row.container_count}</span>
                    <span>Sem dev. {noReturn}</span>
                    <span>Dem. {row.containers_in_demurrage}</span>
                  </div>
                </button>
              )
            })}
          </div>
          <TableFooterPagination
            page={safePage}
            pageBase={0}
            pageSize={pageSize}
            totalCount={filtered.length}
            totalPages={totalPages}
            countLabel={`${safePage * pageSize + 1}-${Math.min((safePage + 1) * pageSize, filtered.length)} de ${filtered.length}`}
            onPageChange={setPage}
          />
        </>
      )}
    </Card>
  )
}

// --- Aba Containers ------------------------------------------------------

function ContainersTab({ rows, filters, onFilters }: { rows: PortalOperationBL[]; filters: ContainerFilters; onFilters: (f: ContainerFilters) => void }) {
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(25)

  const containers = useMemo(() => flattenContainers(rows), [rows])

  const filtered = useMemo(
    () =>
      containers.filter(
        (c) =>
          includesText(c.container_number, filters.container) &&
          includesText(c.bl_id, filters.bl) &&
          includesText(c.ce_mercante, filters.ce) &&
          includesText(c.vessel_name, filters.vessel) &&
          includesText(c.voyage_number, filters.voyage) &&
          includesText(c.pol, filters.pol) &&
          includesText(c.pod, filters.pod) &&
          containerMatchesReturnSituation(c, filters.devolucao) &&
          (!filters.status || c.status === filters.status),
      ),
    [containers, filters],
  )

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(page, totalPages - 1)
  const paginated = filtered.slice(safePage * pageSize, (safePage + 1) * pageSize)
  const activeFilters = Object.values(filters).filter(Boolean).length

  return (
    <Card className="overflow-hidden p-0">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--app-border)] px-5 py-4">
        <div>
          <h2 className="text-base font-semibold">Containers</h2>
          <p className="mt-1 text-sm text-[var(--app-muted)]">{filtered.length} container(es) encontrado(s)</p>
        </div>
        <Button variant="secondary" onClick={() => void exportPortalContainersWorkbook(filtered)} disabled={filtered.length === 0}>
          <Download size={16} />
          Exportar Excel
        </Button>
      </div>

      <div className="px-5 pt-4">
        <FilterBar activeCount={activeFilters} onClear={() => { onFilters(EMPTY_CONTAINER_FILTERS); setPage(0) }}>
          <div className="app-filter-grid">
            <Field label="Container"><Input value={filters.container} onChange={(e) => { onFilters({ ...filters, container: e.target.value }); setPage(0) }} placeholder="Numero do container" /></Field>
            <Field label="B/L"><Input value={filters.bl} onChange={(e) => { onFilters({ ...filters, bl: e.target.value }); setPage(0) }} placeholder="Numero do B/L" /></Field>
            <Field label="CE Mercante"><Input value={filters.ce} onChange={(e) => { onFilters({ ...filters, ce: e.target.value }); setPage(0) }} placeholder="CE Mercante" /></Field>
            <Field label="Navio"><Input value={filters.vessel} onChange={(e) => { onFilters({ ...filters, vessel: e.target.value }); setPage(0) }} placeholder="Navio" /></Field>
            <Field label="Viagem"><Input value={filters.voyage} onChange={(e) => { onFilters({ ...filters, voyage: e.target.value }); setPage(0) }} placeholder="Viagem" /></Field>
            <Field label="POL"><Input value={filters.pol} onChange={(e) => { onFilters({ ...filters, pol: e.target.value }); setPage(0) }} placeholder="POL" /></Field>
            <Field label="POD"><Input value={filters.pod} onChange={(e) => { onFilters({ ...filters, pod: e.target.value }); setPage(0) }} placeholder="POD" /></Field>
            <Field label="Situação de devolução">
              <Select value={filters.devolucao} onChange={(e) => { onFilters({ ...filters, devolucao: e.target.value as ReturnSituation }); setPage(0) }}>
                {RETURN_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </Select>
            </Field>
            <Field label="Status operacional">
              <Select value={filters.status} onChange={(e) => { onFilters({ ...filters, status: e.target.value as OpStatus }); setPage(0) }}>
                {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </Select>
            </Field>
            <Field label="Por página">
              <Select value={String(pageSize)} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(0) }}>
                {PAGE_SIZES.map((s) => <option key={s} value={String(s)}>{s}</option>)}
              </Select>
            </Field>
          </div>
        </FilterBar>
      </div>

      {filtered.length === 0 ? (
        <EmptyState title="Sem containers" description="Nenhum container encontrado para os filtros atuais." />
      ) : (
        <>
          <div className="hidden app-table-scroll md:block">
            <table className="app-table app-table--compact min-w-[1200px] text-left text-sm">
              <thead>
                <tr>
                  <th scope="col" className="px-4 py-3">Container</th>
                  <th scope="col" className="px-4 py-3">Tipo</th>
                  <th scope="col" className="px-4 py-3">B/L</th>
                  <th scope="col" className="px-4 py-3">CE Mercante</th>
                  <th scope="col" className="px-4 py-3">Navio</th>
                  <th scope="col" className="px-4 py-3">Viagem</th>
                  <th scope="col" className="px-4 py-3">POL</th>
                  <th scope="col" className="px-4 py-3">POD</th>
                  <th scope="col" className="px-4 py-3">Descarga</th>
                  <th scope="col" className="px-4 py-3">Devolução</th>
                  <th scope="col" className="px-4 py-3">Dias de uso</th>
                  <th scope="col" className="px-4 py-3">Free time</th>
                  <th scope="col" className="px-4 py-3">Dias em demurrage</th>
                  <th scope="col" className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {paginated.map((c) => (
                  <tr key={`${c.bl_id}-${c.id}`}>
                    <td className="px-4 py-3 font-semibold">{c.container_number}</td>
                    <td className="px-4 py-3">{c.type ?? '-'}</td>
                    <td className="px-4 py-3">{c.bl_id}</td>
                    <td className="px-4 py-3">{c.ce_mercante ?? '-'}</td>
                    <td className="px-4 py-3">{c.vessel_name ?? '-'}</td>
                    <td className="px-4 py-3">{c.voyage_number ?? '-'}</td>
                    <td className="px-4 py-3">{c.pol ?? '-'}</td>
                    <td className="px-4 py-3">{c.pod ?? '-'}</td>
                    <td className="px-4 py-3">{formatDate(c.discharge_date)}</td>
                    <td className="px-4 py-3">{c.return_date ? formatDate(c.return_date) : 'Pendente'}</td>
                    <td className="px-4 py-3">{formatNumber(c.usage_days)}</td>
                    <td className="px-4 py-3">{formatNumber(c.free_time_days)}</td>
                    <td className="px-4 py-3">{formatNumber(c.demurrage_days)}</td>
                    <td className="px-4 py-3">{renderStatus(c.status)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="grid gap-3 p-4 md:hidden" data-testid="portal-operacao-container-mobile-cards">
            {paginated.map((c) => (
              <div
                key={`${c.bl_id}-${c.id}`}
                className="rounded-xl border border-[var(--app-border)] bg-[var(--app-surface)] p-4 text-left"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold">Container {c.container_number}</span>
                  {renderStatus(c.status)}
                </div>
                <div className="mt-2 text-sm text-[var(--app-muted)]">B/L {c.bl_id}</div>
                <div className="mt-1 text-sm text-[var(--app-muted)]">
                  {[c.vessel_name, c.voyage_number].filter(Boolean).join(' / ') || '-'}
                </div>
                <div className="mt-1 text-sm text-[var(--app-muted)]">{c.pol ?? '-'} - {c.pod ?? '-'}</div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                  <span>Uso {formatNumber(c.usage_days)}</span>
                  <span>Free {formatNumber(c.free_time_days)}</span>
                  <span>Dem. {formatNumber(c.demurrage_days)}</span>
                </div>
              </div>
            ))}
          </div>
          <TableFooterPagination
            page={safePage}
            pageBase={0}
            pageSize={pageSize}
            totalCount={filtered.length}
            totalPages={totalPages}
            countLabel={`${safePage * pageSize + 1}-${Math.min((safePage + 1) * pageSize, filtered.length)} de ${filtered.length}`}
            onPageChange={setPage}
          />
        </>
      )}
    </Card>
  )
}

function ContainerDetails({ row }: { row: PortalOperationBL }) {
  const hasBreakbulk =
    row.cargo_mode === 'misto' ||
    row.cargo_mode === 'carga_solta' ||
    (row.bb_weight_ton != null && row.bb_weight_ton > 0)

  return (
    <div className="border-t border-[var(--app-border)]">
      {row.transshipment ? <PortalTransshipmentCard transshipment={row.transshipment} /> : null}
      {hasBreakbulk ? (
        <section
          className="m-4 grid gap-1 rounded-xl border border-[var(--app-border)] bg-[var(--app-surface-muted)] p-4"
          data-testid="portal-breakbulk-summary"
        >
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-[var(--app-text-strong)]">Carga Solta (Breakbulk)</h3>
            <Badge tone="slate">Breakbulk</Badge>
          </div>
          <p className="text-sm text-[var(--app-muted)]">
            Resumo dos volumes de carga solta vinculados a este B/L.
          </p>
          <div className="mt-2 flex flex-wrap gap-6 text-sm">
            <div>
              <span className="text-xs text-[var(--app-muted)]">Peso Total: </span>
              <span className="font-semibold">{row.bb_weight_ton != null ? `${row.bb_weight_ton} ton` : '—'}</span>
            </div>
            <div>
              <span className="text-xs text-[var(--app-muted)]">Volumes: </span>
              <span className="font-semibold">
                {row.bb_packages_qty != null ? `${row.bb_packages_qty} volume(s)` : '—'}
              </span>
            </div>
          </div>
        </section>
      ) : null}
      {row.containers.length === 0 ? (
        <div className="px-5 pb-5 text-sm text-[var(--app-muted)]">Nenhum container vinculado a este B/L.</div>
      ) : <div className="app-table-scroll">
      <table aria-label={`Containers do BL ${row.bl_id}`} className="app-table app-table--compact min-w-[860px] text-left text-sm">
        <thead>
          <tr>
            <th scope="col" className="px-4 py-3">Container</th>
            <th scope="col" className="px-4 py-3">Tipo</th>
            <th scope="col" className="px-4 py-3">Descarga</th>
            <th scope="col" className="px-4 py-3">Devolução</th>
            <th scope="col" className="px-4 py-3">Dias uso</th>
            <th scope="col" className="px-4 py-3">Free time</th>
            <th scope="col" className="px-4 py-3">Demurrage</th>
            <th scope="col" className="px-4 py-3">Status</th>
          </tr>
        </thead>
        <tbody>
          {row.containers.map((container) => (
            <tr key={container.id}>
              <td className="px-4 py-3 font-semibold">{container.container_number}</td>
              <td className="px-4 py-3">{container.type ?? '-'}</td>
              <td className="px-4 py-3">{formatDate(container.discharge_date)}</td>
              <td className="px-4 py-3">{container.return_date ? formatDate(container.return_date) : 'Pendente'}</td>
              <td className="px-4 py-3">{formatNumber(container.usage_days)}</td>
              <td className="px-4 py-3">{formatNumber(container.free_time_days)}</td>
              <td className="px-4 py-3">{formatNumber(container.demurrage_days)}</td>
              <td className="px-4 py-3">{renderStatus(container.status)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>}
    </div>
  )
}

function PortalTransshipmentCard({ transshipment }: { transshipment: NonNullable<PortalOperationBL['transshipment']> }) {
  const value = (text: string | null) => text || '—'

  if (transshipment.disposition === 'cod') {
    return (
      <section className="m-4 grid gap-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-950">
        <h3 className="text-sm font-semibold">Destino alterado para {value(transshipment.discharge_pod)} (COD)</h3>
        <p className="text-sm">Sua carga não seguirá em transbordo.</p>
      </section>
    )
  }

  return (
    <section className="m-4 grid gap-3 rounded-xl border border-[var(--app-border)] bg-[var(--app-surface-muted)] p-4">
      <h3 className="text-sm font-semibold text-[var(--app-text-strong)]">Informações de Transbordo</h3>
      <p className="text-sm">Escala de {value(transshipment.omitted_pod)} omitida · Porto de Transbordo — {value(transshipment.discharge_pod)}</p>
      <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
        {[
          ['Navio', transshipment.onward_vessel_name],
          ['Armador', transshipment.onward_carrier],
          ['Viagem', transshipment.onward_voyage_number],
          ['ETD', transshipment.onward_etd ? formatDate(transshipment.onward_etd) : null],
          ['ETA', transshipment.onward_eta ? formatDate(transshipment.onward_eta) : null],
        ].map(([label, text]) => (
          <div key={label}><dt className="text-xs text-[var(--app-muted)]">{label}</dt><dd>{value(text)}</dd></div>
        ))}
      </dl>
    </section>
  )
}

function formatNumber(value: number | null) {
  return value == null ? '-' : String(value)
}

function renderStatus(status: PortalOperationContainerStatus) {
  if (status === 'devolvido') return <Badge tone="green">Devolvido</Badge>
  if (status === 'em_demurrage') return <Badge tone="red">Em demurrage</Badge>
  if (status === 'dentro_free_time') return <Badge tone="blue">Dentro free time</Badge>
  return <Badge tone="slate">Sem descarga</Badge>
}
