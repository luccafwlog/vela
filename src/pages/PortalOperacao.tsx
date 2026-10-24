import { Fragment, useMemo, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ChevronDown, ChevronRight, Download } from 'lucide-react'
import { usePortalScope } from '../hooks/usePortalScope'
import { portalPath } from '../services/portalScope'
import { Block, Fact, FactList } from '../components/ui/Block'
import { Button } from '../components/ui/Button'
import { EmptyState, InlineError, PageHeader } from '../components/ui/Card'
import { CopyValue } from '../components/ui/CopyValue'
import { MetricCard } from '../components/ui/MetricCard'
import { NoValue } from '../components/ui/NoValue'
import { StatusText } from '../components/ui/StatusText'
import { TabButton } from '../components/ui/TabButton'
import { TabList } from '../components/ui/TabList'
import { FilterBar } from '../components/ui/FilterBar'
import { Field, Input, Select } from '../components/ui/Input'
import { TableFooterPagination } from '../components/ui/TableFooterPagination'
import { usePortalOperationBls } from '../hooks/usePortalOperation'
import { formatBRL, formatDate } from '../lib/utils'
import {
  blCargoLabel,
  blMatchesReturnSituation,
  blReturnSummary,
  containerMatchesReturnSituation,
  containerSituation,
  flattenContainers,
  formatTons,
  localChargesView,
  type PortalFlatContainer,
  type ReturnSituation,
} from '../lib/portalOperationViews'
import { exportPortalBlsWorkbook, exportPortalContainersWorkbook } from '../services/exports'
import type { PortalOperationBL, PortalOperationContainer, PortalOperationContainerStatus } from '../services/portalOperation'
import { matchesAnyToken } from '../lib/searchTerms'

type OperationTab = 'bls' | 'containers'
type OpStatus = '' | PortalOperationContainerStatus

const PAGE_SIZES = [10, 25, 50, 100]

const RETURN_OPTIONS: { value: ReturnSituation; label: string }[] = [
  { value: '', label: 'Todos' },
  { value: 'todos_devolvidos', label: 'Todos devolvidos' },
  { value: 'sem_devolucao', label: 'Com containers sem devolução' },
  { value: 'no_free_time', label: 'Sem devolução, no free time' },
  { value: 'em_demurrage', label: 'Com containers em demurrage' },
  { value: 'sem_descarga', label: 'Sem descarga' },
]

const STATUS_OPTIONS: { value: OpStatus; label: string }[] = [
  { value: '', label: 'Todos' },
  { value: 'sem_descarga', label: 'Sem descarga' },
  { value: 'dentro_free_time', label: 'Dentro do free time' },
  { value: 'em_demurrage', label: 'Em demurrage' },
  { value: 'devolvido', label: 'Devolvido' },
  { value: 'tarifa_indisponivel', label: 'Tarifa indisponível' },
  { value: 'soc', label: 'SOC (sem devolução)' },
]

// Cartões que filtram (rodada 2): usam o filtro de devolução de cada aba.
const BL_CARDS: { value: ReturnSituation; label: string; warn?: boolean }[] = [
  { value: '', label: 'B/Ls' },
  { value: 'sem_devolucao', label: 'Com container sem devolução', warn: true },
  { value: 'em_demurrage', label: 'Com container em demurrage', warn: true },
  { value: 'todos_devolvidos', label: 'Tudo devolvido' },
]

const CONTAINER_CARDS: { value: ReturnSituation; label: string; warn?: boolean }[] = [
  { value: '', label: 'Containers' },
  { value: 'no_free_time', label: 'Sem devolução, no free time', warn: true },
  { value: 'em_demurrage', label: 'Em demurrage', warn: true },
  { value: 'todos_devolvidos', label: 'Devolvidos' },
]

const monoClass = 'font-(family-name:--app-font-mono) tabular-nums whitespace-nowrap'

function includesText(value: string | null | undefined, term: string) {
  if (!term.trim()) return true
  return (value ?? '').toLowerCase().includes(term.trim().toLowerCase())
}

/** B/L, CE e contêiner: também aceita uma lista colada (ponto 9 de 2026-10-23). */
function includesNumber(value: string | null | undefined, term: string) {
  return includesText(value, term) || matchesAnyToken(term, [value])
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
  const scope = usePortalScope()
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

  // Os atalhos ficam uma vez só, no título da página (rodada 2).
  return (
    <>
      <PageHeader
        title="BLs e Containers"
        description="Consulte seus B/Ls e containers: descarga, devolução, free time e dias de demurrage."
        action={
          <>
            <Link className="app-btn app-btn--secondary" to={portalPath(scope, '/informacoes/devolucao')}>Depósitos de devolução</Link>
            <Link className="app-btn app-btn--secondary" to={portalPath(scope, '/informacoes/tracking')}>Tracking do B/L</Link>
            <Link className="app-btn app-btn--secondary" to={portalPath(scope, '/desbloqueio-ce')}>Solicitar desbloqueio de CE</Link>
          </>
        }
      />

      <TabList label="BLs e Containers" className="mb-4">
        <TabButton id="operacao-tab-bls" controls="operacao-panel" active={tab === 'bls'} label="BLs" onClick={() => setTab('bls')} />
        <TabButton id="operacao-tab-containers" controls="operacao-panel" active={tab === 'containers'} label="Containers" onClick={() => setTab('containers')} />
      </TabList>

      <div id="operacao-panel" role="tabpanel" aria-labelledby={tab === 'bls' ? 'operacao-tab-bls' : 'operacao-tab-containers'}>
        {isLoading ? <EmptyState title="Carregando..." description="Buscando dados operacionais." /> : null}
        {error ? <div className="px-1 py-4"><InlineError message="Falha ao carregar dados operacionais do portal." /></div> : null}

        {!isLoading && !error ? (
          tab === 'bls' ? (
            <BlsTab rows={rows} filters={blFilters} onFilters={setBlFilters} />
          ) : (
            <ContainersTab rows={rows} filters={containerFilters} onFilters={setContainerFilters} />
          )
        ) : null}
      </div>
    </>
  )
}

function FilterCards({
  label,
  cards,
  counts,
  selected,
  onSelect,
}: {
  label: string
  cards: { value: ReturnSituation; label: string; warn?: boolean }[]
  counts: Record<string, number>
  selected: ReturnSituation
  onSelect: (value: ReturnSituation) => void
}) {
  return (
    <div className="app-metric-row" role="group" aria-label={label}>
      {cards.map((card) => {
        const count = counts[card.value] ?? 0
        return (
          <MetricCard
            key={card.value || 'todos'}
            label={card.label}
            value={count}
            tone={card.warn && count > 0 ? 'warning' : 'secondary'}
            selected={selected === card.value}
            onSelect={() => onSelect(selected === card.value ? '' : card.value)}
          />
        )
      })}
    </div>
  )
}

function ExportButton({ onClick, disabled }: { onClick: () => void; disabled: boolean }) {
  return (
    <Button variant="secondary" className="app-btn--sm" onClick={onClick} disabled={disabled}>
      <Download size={14} aria-hidden="true" />
      Exportar Excel
    </Button>
  )
}

// --- Aba BLs -------------------------------------------------------------

function BlsTab({ rows, filters, onFilters }: { rows: PortalOperationBL[]; filters: BlFilters; onFilters: (f: BlFilters) => void }) {
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(25)
  const [openBl, setOpenBl] = useState<string | null>(null)

  // Os cartões contam o recorte dos demais filtros; o cartão escolhido é o
  // filtro de devolução.
  const scoped = useMemo(
    () =>
      rows.filter(
        (r) =>
          includesNumber(r.bl_id, filters.bl) &&
          includesNumber(r.ce_mercante, filters.ce) &&
          includesText(r.vessel_name, filters.vessel) &&
          includesText(r.voyage_number, filters.voyage) &&
          includesText(r.pol, filters.pol) &&
          includesText(r.pod, filters.pod) &&
          (!filters.status || r.containers.some((c) => c.status === filters.status)),
      ),
    [rows, filters.bl, filters.ce, filters.vessel, filters.voyage, filters.pol, filters.pod, filters.status],
  )
  const filtered = useMemo(() => scoped.filter((r) => blMatchesReturnSituation(r, filters.devolucao)), [scoped, filters.devolucao])
  const counts = useMemo(
    () => Object.fromEntries(BL_CARDS.map((card) => [card.value, scoped.filter((r) => blMatchesReturnSituation(r, card.value)).length])),
    [scoped],
  )

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(page, totalPages - 1)
  const paginated = filtered.slice(safePage * pageSize, (safePage + 1) * pageSize)
  const activeFilters = Object.values(filters).filter(Boolean).length
  const update = (next: Partial<BlFilters>) => { onFilters({ ...filters, ...next }); setPage(0) }

  return (
    <>
      <FilterCards label="Filtrar B/Ls por devolução" cards={BL_CARDS} counts={counts} selected={filters.devolucao} onSelect={(devolucao) => update({ devolucao })} />

      <Block
        title="B/Ls"
        flush
        aside={<>{filtered.length}<ExportButton onClick={() => void exportPortalBlsWorkbook(filtered)} disabled={filtered.length === 0} /></>}
      >
        <div className="app-block__body">
          <FilterBar activeCount={activeFilters} onClear={() => { onFilters(EMPTY_BL_FILTERS); setPage(0) }}>
            <div className="app-filter-grid">
              <Field label="B/L"><Input value={filters.bl} onChange={(e) => update({ bl: e.target.value })} placeholder="Número do B/L" /></Field>
              <Field label="CE Mercante"><Input value={filters.ce} onChange={(e) => update({ ce: e.target.value })} placeholder="CE Mercante" /></Field>
              <Field label="Navio"><Input value={filters.vessel} onChange={(e) => update({ vessel: e.target.value })} placeholder="Navio" /></Field>
              <Field label="Viagem"><Input value={filters.voyage} onChange={(e) => update({ voyage: e.target.value })} placeholder="Viagem" /></Field>
              <Field label="POL"><Input value={filters.pol} onChange={(e) => update({ pol: e.target.value })} placeholder="POL" /></Field>
              <Field label="POD"><Input value={filters.pod} onChange={(e) => update({ pod: e.target.value })} placeholder="POD" /></Field>
              <Field label="Situação de devolução">
                <Select value={filters.devolucao} onChange={(e) => update({ devolucao: e.target.value as ReturnSituation })}>
                  {RETURN_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </Select>
              </Field>
              <Field label="Status operacional">
                <Select value={filters.status} onChange={(e) => update({ status: e.target.value as OpStatus })}>
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
              <table className="app-table app-table--dense text-sm">
                <caption className="sr-only">B/Ls da operação do cliente; cada linha abre os containers do B/L</caption>
                <thead>
                  <tr>
                    <th scope="col"><span className="sr-only">Abrir containers</span></th>
                    <th scope="col">B/L</th>
                    <th scope="col">CE Mercante</th>
                    <th scope="col" className="app-table__text-head">Navio / Viagem</th>
                    <th scope="col">Trecho</th>
                    <th scope="col">Carga</th>
                    <th scope="col">Taxas locais</th>
                    <th scope="col">Pagamento</th>
                    <th scope="col">Devolução</th>
                    <th scope="col">Demurrage</th>
                  </tr>
                </thead>
                <tbody>
                  {paginated.map((row) => {
                    const isOpen = openBl === row.bl_id
                    const panelId = `operacao-bl-${row.bl_id}`
                    const toggle = () => setOpenBl(isOpen ? null : row.bl_id)
                    return (
                      <Fragment key={row.bl_id}>
                        <tr className={`cursor-pointer ${row.cancelled_at ? 'app-table__row--muted' : ''}`} onClick={toggle}>
                          <td>
                            <button
                              type="button"
                              className="app-table__icon-button"
                              aria-controls={isOpen ? panelId : undefined}
                              aria-expanded={isOpen}
                              aria-label={`${isOpen ? 'Recolher' : 'Abrir'} os containers do B/L ${row.bl_id}`}
                              onClick={(event) => { event.stopPropagation(); toggle() }}
                            >
                              {isOpen ? <ChevronDown size={15} aria-hidden="true" /> : <ChevronRight size={15} aria-hidden="true" />}
                            </button>
                          </td>
                          <td className="whitespace-nowrap">
                            <span className={`${monoClass} font-semibold`}><CopyValue value={row.bl_id} label="número do B/L" /></span>
                            {row.cancelled_at ? <> · <StatusText tone="muted">Cancelado</StatusText></> : null}
                          </td>
                          <td className="whitespace-nowrap"><CeMercante value={row.ce_mercante} /></td>
                          <td className="app-table__text" title={vesselVoyage(row) ?? undefined}>{vesselVoyage(row) ?? <NoValue label="Sem navio e viagem" />}</td>
                          <td className="whitespace-nowrap">{route(row)}</td>
                          <td className="whitespace-nowrap">{blCargoLabel(row)}</td>
                          <LocalChargesCells row={row} />
                          <td className="whitespace-nowrap tabular-nums"><ReturnCell row={row} /></td>
                          <td className="whitespace-nowrap tabular-nums"><DemurrageCell row={row} /></td>
                        </tr>
                        {isOpen ? (
                          <tr id={panelId} data-row-detail>
                            <td colSpan={10}><BlDetails row={row} /></td>
                          </tr>
                        ) : null}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div className="grid gap-3 px-4 pb-4 md:hidden" data-testid="portal-operacao-bl-mobile-cards">
              {paginated.map((row) => {
                const { total, payment } = localChargesView(row.local_charges)
                return (
                  <article key={row.bl_id} aria-label={`B/L ${row.bl_id}`} className="grid gap-3 rounded-xl border border-[var(--app-border)] bg-[var(--app-surface)] p-4">
                    <div className="flex flex-wrap items-center gap-2 font-semibold">
                      <span>B/L <span className={monoClass}><CopyValue value={row.bl_id} label="número do B/L" /></span></span>
                      {row.cancelled_at ? <StatusText tone="muted">Cancelado</StatusText> : null}
                    </div>
                    <FactList columns={2}>
                      <Fact label="CE Mercante" className="col-span-2 content-start"><CeMercante value={row.ce_mercante} /></Fact>
                      <Fact className="content-start" label="Navio / Viagem">{vesselVoyage(row) ?? <NoValue label="Sem navio e viagem" />}</Fact>
                      <Fact className="content-start" label="Trecho">{route(row)}</Fact>
                      <Fact className="content-start" label="Carga">{blCargoLabel(row)}</Fact>
                      <Fact className="content-start" label="Taxas locais">{total != null ? formatBRL(total) : <NoValue label="Sem valor de fatura" />}</Fact>
                      <Fact className="content-start" label="Pagamento">{payment ? <StatusText tone={payment.tone}>{payment.label}</StatusText> : <NoValue label="Sem fatura" />}</Fact>
                      <Fact className="content-start" label="Devolução"><ReturnCell row={row} /></Fact>
                      <Fact className="content-start" label="Demurrage"><DemurrageCell row={row} /></Fact>
                    </FactList>
                  </article>
                )
              })}
            </div>
            <TableFooterPagination
              page={safePage}
              pageBase={0}
              pageSize={pageSize}
              totalCount={filtered.length}
              totalPages={totalPages}
              onPageChange={setPage}
            />
          </>
        )}
      </Block>
    </>
  )
}

function vesselVoyage(row: { vessel_name: string | null; voyage_number: string | null }) {
  return [row.vessel_name, row.voyage_number].filter(Boolean).join(' / ') || null
}

function route(row: PortalOperationBL) {
  if (!row.pol && !row.pod) return <NoValue label="Sem trecho" />
  return <>{row.pol ?? <NoValue label="Sem POL" />} → {row.pod ?? <NoValue label="Sem POD" />}</>
}

function CeMercante({ value }: { value: string | null }) {
  return value ? <span className={monoClass}><CopyValue value={value} label="CE Mercante" /></span> : <NoValue label="Sem CE Mercante" />
}

function LocalChargesCells({ row }: { row: PortalOperationBL }) {
  const { total, payment } = localChargesView(row.local_charges)
  return (
    <>
      <td className="whitespace-nowrap tabular-nums">{total != null ? formatBRL(total) : <NoValue label="Sem valor de fatura" />}</td>
      <td className="whitespace-nowrap tabular-nums">{payment ? <StatusText tone={payment.tone}>{payment.label}</StatusText> : <NoValue label="Sem fatura" />}</td>
    </>
  )
}

function ReturnCell({ row }: { row: PortalOperationBL }) {
  if (row.containers.length === 0) return <NoValue label="Sem containers" />
  const { returnable, returned, awaiting } = blReturnSummary(row)
  if (returnable === 0) return <>SOC (sem devolução)</>
  const text = `${returned} de ${returnable} ${returnable === 1 ? 'devolvido' : 'devolvidos'}`
  return awaiting > 0 ? <StatusText tone="warning">{text}</StatusText> : <>{text}</>
}

function DemurrageCell({ row }: { row: PortalOperationBL }) {
  if (row.containers.length === 0) return <NoValue label="Sem containers" />
  const { inDemurrage } = blReturnSummary(row)
  return inDemurrage > 0 ? <StatusText tone="danger">{`${inDemurrage} em demurrage`}</StatusText> : <>Nenhum</>
}

// --- Aba Containers ------------------------------------------------------

function ContainersTab({ rows, filters, onFilters }: { rows: PortalOperationBL[]; filters: ContainerFilters; onFilters: (f: ContainerFilters) => void }) {
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(25)

  const containers = useMemo(() => flattenContainers(rows), [rows])

  const scoped = useMemo(
    () =>
      containers.filter(
        (c) =>
          includesNumber(c.container_number, filters.container) &&
          includesNumber(c.bl_id, filters.bl) &&
          includesNumber(c.ce_mercante, filters.ce) &&
          includesText(c.vessel_name, filters.vessel) &&
          includesText(c.voyage_number, filters.voyage) &&
          includesText(c.pol, filters.pol) &&
          includesText(c.pod, filters.pod) &&
          (!filters.status || c.status === filters.status),
      ),
    [containers, filters.container, filters.bl, filters.ce, filters.vessel, filters.voyage, filters.pol, filters.pod, filters.status],
  )
  const filtered = useMemo(() => scoped.filter((c) => containerMatchesReturnSituation(c, filters.devolucao)), [scoped, filters.devolucao])
  const counts = useMemo(
    () => Object.fromEntries(CONTAINER_CARDS.map((card) => [card.value, scoped.filter((c) => containerMatchesReturnSituation(c, card.value)).length])),
    [scoped],
  )

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(page, totalPages - 1)
  const paginated = filtered.slice(safePage * pageSize, (safePage + 1) * pageSize)
  const activeFilters = Object.values(filters).filter(Boolean).length
  const update = (next: Partial<ContainerFilters>) => { onFilters({ ...filters, ...next }); setPage(0) }

  return (
    <>
      <FilterCards label="Filtrar containers por devolução" cards={CONTAINER_CARDS} counts={counts} selected={filters.devolucao} onSelect={(devolucao) => update({ devolucao })} />

      <Block
        title="Containers"
        flush
        aside={<>{filtered.length}<ExportButton onClick={() => void exportPortalContainersWorkbook(filtered)} disabled={filtered.length === 0} /></>}
      >
        <div className="app-block__body">
          <FilterBar activeCount={activeFilters} onClear={() => { onFilters(EMPTY_CONTAINER_FILTERS); setPage(0) }}>
            <div className="app-filter-grid">
              <Field label="Container"><Input value={filters.container} onChange={(e) => update({ container: e.target.value })} placeholder="Número do container" /></Field>
              <Field label="B/L"><Input value={filters.bl} onChange={(e) => update({ bl: e.target.value })} placeholder="Número do B/L" /></Field>
              <Field label="CE Mercante"><Input value={filters.ce} onChange={(e) => update({ ce: e.target.value })} placeholder="CE Mercante" /></Field>
              <Field label="Navio"><Input value={filters.vessel} onChange={(e) => update({ vessel: e.target.value })} placeholder="Navio" /></Field>
              <Field label="Viagem"><Input value={filters.voyage} onChange={(e) => update({ voyage: e.target.value })} placeholder="Viagem" /></Field>
              <Field label="POL"><Input value={filters.pol} onChange={(e) => update({ pol: e.target.value })} placeholder="POL" /></Field>
              <Field label="POD"><Input value={filters.pod} onChange={(e) => update({ pod: e.target.value })} placeholder="POD" /></Field>
              <Field label="Situação de devolução">
                <Select value={filters.devolucao} onChange={(e) => update({ devolucao: e.target.value as ReturnSituation })}>
                  {RETURN_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </Select>
              </Field>
              <Field label="Status operacional">
                <Select value={filters.status} onChange={(e) => update({ status: e.target.value as OpStatus })}>
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
            {/* CE Mercante, Navio, Viagem e POL ficam na aba BLs e na planilha
                (rodada 1): sem elas a Situação cabe a 1440 px. */}
            <div className="hidden app-table-scroll md:block">
              <table className="app-table app-table--dense text-sm">
                <caption className="sr-only">Containers da operação do cliente</caption>
                <thead>
                  <tr>
                    <th scope="col">Container</th>
                    <th scope="col">Tipo</th>
                    <th scope="col">B/L</th>
                    <th scope="col">POD</th>
                    <th scope="col">Descarga</th>
                    <th scope="col">Devolução</th>
                    <th scope="col">Dias de uso</th>
                    <th scope="col">Free time</th>
                    <th scope="col">Dias em demurrage</th>
                    <th scope="col">Situação</th>
                  </tr>
                </thead>
                <tbody>
                  {paginated.map((c) => (
                    <tr key={`${c.bl_id}-${c.id}`}>
                      <td className="whitespace-nowrap"><span className={`${monoClass} font-semibold`}><CopyValue value={c.container_number} label="número do contêiner" /></span></td>
                      <td>{c.type ?? <NoValue label="Sem tipo" />}</td>
                      <td className="whitespace-nowrap"><span className={monoClass}><CopyValue value={c.bl_id} label="número do B/L" /></span></td>
                      <td>{c.pod ?? <NoValue label="Sem POD" />}</td>
                      <ContainerDayCells container={c} />
                      <td className="whitespace-nowrap"><Situation container={c} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="grid gap-3 px-4 pb-4 md:hidden" data-testid="portal-operacao-container-mobile-cards">
              {paginated.map((c) => <ContainerCard key={`${c.bl_id}-${c.id}`} container={c} />)}
            </div>
            <TableFooterPagination
              page={safePage}
              pageBase={0}
              pageSize={pageSize}
              totalCount={filtered.length}
              totalPages={totalPages}
              onPageChange={setPage}
            />
          </>
        )}
      </Block>
    </>
  )
}

function ContainerCard({ container: c }: { container: PortalFlatContainer }) {
  return (
    <article aria-label={`Container ${c.container_number}`} className="grid gap-3 rounded-xl border border-[var(--app-border)] bg-[var(--app-surface)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold">Container <span className={monoClass}><CopyValue value={c.container_number} label="número do contêiner" /></span></span>
        <Situation container={c} />
      </div>
      <FactList columns={2}>
        <Fact label="B/L" className="col-span-2 content-start"><span className={monoClass}><CopyValue value={c.bl_id} label="número do B/L" /></span></Fact>
        <Fact className="content-start" label="Tipo">{c.type ?? <NoValue label="Sem tipo" />}</Fact>
        <Fact className="content-start" label="POD">{c.pod ?? <NoValue label="Sem POD" />}</Fact>
        <Fact className="content-start" label="Descarga">{c.discharge_date ? formatDate(c.discharge_date) : <NoValue label="Sem data de descarga" />}</Fact>
        <Fact className="content-start" label="Devolução">{c.return_date ? formatDate(c.return_date) : <NoValue label="Ainda não devolvido" />}</Fact>
        <Fact className="content-start" label="Dias de uso">{formatNumber(c.usage_days, 'Sem dias de uso')}</Fact>
        <Fact className="content-start" label="Free time">{formatNumber(c.free_time_days, 'Sem free time')}</Fact>
        <Fact className="content-start" label="Dias em demurrage">{formatNumber(c.demurrage_days, 'Sem dias em demurrage')}</Fact>
      </FactList>
    </article>
  )
}

function ContainerDayCells({ container }: { container: PortalOperationContainer }) {
  return (
    <>
      <td className="whitespace-nowrap tabular-nums">{container.discharge_date ? formatDate(container.discharge_date) : <NoValue label="Sem data de descarga" />}</td>
      <td className="whitespace-nowrap tabular-nums">{container.return_date ? formatDate(container.return_date) : <NoValue label="Ainda não devolvido" />}</td>
      <td className="tabular-nums">{formatNumber(container.usage_days, 'Sem dias de uso')}</td>
      <td className="tabular-nums">{formatNumber(container.free_time_days, 'Sem free time')}</td>
      <td className="tabular-nums">{formatNumber(container.demurrage_days, 'Sem dias em demurrage')}</td>
    </>
  )
}

function Situation({ container }: { container: PortalOperationContainer }) {
  const { label, tone, title } = containerSituation(container)
  const text = tone === 'default' ? <>{label}</> : <StatusText tone={tone}>{label}</StatusText>
  return title ? <span title={title}>{text}</span> : text
}

function BlDetails({ row }: { row: PortalOperationBL }) {
  const hasBreakbulk =
    row.cargo_mode === 'misto' ||
    row.cargo_mode === 'carga_solta' ||
    (row.bb_weight_ton != null && row.bb_weight_ton > 0)
  const blocks: ReactNode[] = []
  if (row.transshipment) blocks.push(<PortalTransshipmentBlock key="transbordo" transshipment={row.transshipment} />)
  if (hasBreakbulk) {
    blocks.push(
      <div key="carga-solta" data-testid="portal-breakbulk-summary">
        <Block title="Carga solta" headingLevel={3}>
          <FactList columns={2}>
            <Fact className="content-start" label="Peso total">{row.bb_weight_ton != null ? formatTons(row.bb_weight_ton) : <NoValue label="Sem peso total" />}</Fact>
            <Fact className="content-start" label="Packages">{row.bb_packages_qty ?? <NoValue label="Sem packages" />}</Fact>
          </FactList>
        </Block>
      </div>,
    )
  }

  return (
    <div className="grid gap-3 py-2">
      {blocks.length ? <div className="grid gap-3 lg:grid-cols-2">{blocks}</div> : null}
      {row.containers.length === 0 ? (
        row.cargo_mode === 'carga_solta' ? null : <p className="m-0 text-sm text-[var(--app-muted)]">Nenhum container vinculado a este B/L.</p>
      ) : (
        <div className="app-table-scroll">
          <table className="app-table app-table--dense text-sm">
            <caption className="sr-only">Containers do B/L {row.bl_id}</caption>
            <thead>
              <tr>
                <th scope="col">Container</th>
                <th scope="col">Tipo</th>
                <th scope="col">Descarga</th>
                <th scope="col">Devolução</th>
                <th scope="col">Dias de uso</th>
                <th scope="col">Free time</th>
                <th scope="col">Dias em demurrage</th>
                <th scope="col">Situação</th>
              </tr>
            </thead>
            <tbody>
              {row.containers.map((container) => (
                <tr key={container.id}>
                  <td className="whitespace-nowrap"><span className={`${monoClass} font-semibold`}><CopyValue value={container.container_number} label="número do contêiner" /></span></td>
                  <td>{container.type ?? <NoValue label="Sem tipo" />}</td>
                  <ContainerDayCells container={container} />
                  <td className="whitespace-nowrap"><Situation container={container} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function PortalTransshipmentBlock({ transshipment }: { transshipment: NonNullable<PortalOperationBL['transshipment']> }) {
  const value = (text: string | null, label = 'Sem informação') => text || <NoValue label={label} />

  if (transshipment.disposition === 'cod') {
    return (
      <Block title={<>Destino alterado para {value(transshipment.discharge_pod, 'Sem porto')} (COD)</>} headingLevel={3}>
        <p className="m-0 text-sm">Sua carga não seguirá em transbordo.</p>
      </Block>
    )
  }

  return (
    <Block title="Informações de Transbordo" headingLevel={3}>
      <p className="m-0 text-sm">Escala de {value(transshipment.omitted_pod)} omitida · Porto de Transbordo — {value(transshipment.discharge_pod)}</p>
      <FactList columns={3}>
        {[
          ['Navio', transshipment.onward_vessel_name],
          ['Armador', transshipment.onward_carrier],
          ['Viagem', transshipment.onward_voyage_number],
          ['ETD', transshipment.onward_etd ? formatDate(transshipment.onward_etd) : null],
          ['ETA', transshipment.onward_eta ? formatDate(transshipment.onward_eta) : null],
        ].map(([label, text]) => (
          <Fact key={label} label={label}>{value(text, `Sem ${label}`)}</Fact>
        ))}
      </FactList>
    </Block>
  )
}

function formatNumber(value: number | null, emptyLabel: string) {
  return value == null ? <NoValue label={emptyLabel} /> : String(value)
}
