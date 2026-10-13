import { Fragment, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Clock, FileText, Pencil } from 'lucide-react'
import { Button } from '../ui/Button'
import { EmptyState } from '../ui/Card'
import { Input } from '../ui/Input'
import { SegmentedControl } from '../ui/SegmentedControl'
import { SummaryStrip } from '../ui/SummaryStrip'
import { QueryStateGate } from '../shared/QueryStateGate'
import { useNarrowViewport } from '../bl/useNarrowViewport'
import { DemurrageStatusBadge } from './DemurrageBadges'
import {
  FREE_TIME_SOURCE_LABELS,
  containerFreeTimeDays,
  blBillingState,
  daysSince,
  distinctBoxes,
  effectiveDemurrage,
  fmtUSD,
  freeTimeSource,
  groupByBl,
  type BlBillingState,
} from '../../services/demurrage/demurragePresentation'
import { DEMURRAGE_INVOICE_STATUS_LABELS, statusLabel } from '../../lib/statusLabels'
import { formatCountLabel, formatDate } from '../../lib/utils'
import { extractErrorText } from '../../lib/errors'
import { saoPauloTodayIso } from '../../lib/dates'
import type { DemurrageContainerRow } from '../../services/demurrage/demurrageContainers'
import type { ContainerLens } from '../../pages/demurrageListState'

type Props = {
  containers: DemurrageContainerRow[] | undefined
  search: string
  lens: ContainerLens
  loading: boolean
  error: unknown
  canIssue: boolean
  generatingBl: string | null
  /** Recusa do banco ao gerar, mostrada na linha do B/L que a pediu. */
  generateError?: { blId: string; message: string } | null
  onRetry: () => void
  onSearchChange: (value: string) => void
  onLensChange: (lens: ContainerLens) => void
  onGenerateInvoice: (blId: string) => void
  onEditContainer: (container: DemurrageContainerRow) => void
  onOpenInvoice: (invoiceId: number) => void
}

type Calc = { calc: ReturnType<typeof effectiveDemurrage>; error: string | null }

function safeCalc(container: DemurrageContainerRow): Calc {
  try {
    return { calc: effectiveDemurrage(container), error: null }
  } catch (error) {
    return { calc: null, error: extractErrorText(error) }
  }
}

const today = () => saoPauloTodayIso()

function matchesSearch(container: DemurrageContainerRow, query: string) {
  if (!query) return true
  const term = query.toLowerCase()
  return (
    container.container_number.toLowerCase().includes(term)
    || (container.bl_id ?? '').toLowerCase().includes(term)
    || (container.bl?.customer?.name ?? '').toLowerCase().includes(term)
    || (container.billed_in ?? []).some((ref) => ref.doc_number.toLowerCase().includes(term))
  )
}

/**
 * Monitoramento operacional (ADR 0014): containers em atraso (status gravado
 * pelo banco), devolvidos com sobreestadia e caixas já cobradas numa Invoice,
 * agrupados por B/L. A decisão financeira (gerar Invoice) fica na linha do B/L.
 */
export function DemurrageContainersTab({
  containers,
  search,
  lens,
  loading,
  error,
  canIssue,
  generatingBl,
  generateError = null,
  onRetry,
  onSearchChange,
  onLensChange,
  onGenerateInvoice,
  onEditContainer,
  onOpenInvoice,
}: Props) {
  const narrow = useNarrowViewport()
  const calcs = useMemo(() => new Map((containers ?? []).map((container) => [container.id, safeCalc(container)])), [containers])

  // Devolvido no free time e sem Invoice não é monitoramento; o que já está
  // numa Invoice fica para dizer onde a caixa foi cobrada, e o que não se
  // calcula (tipo sem tarifa) fica para o erro e a correção aparecerem.
  const monitored = useMemo(() => (containers ?? []).filter((container) => (
    container.demurrage_status !== 'returned'
    || (calcs.get(container.id)?.calc?.total_usd ?? 0) > 0
    || Boolean(calcs.get(container.id)?.error)
    || Boolean(container.billed_in?.length)
  )), [containers, calcs])
  const searched = monitored.filter((container) => matchesSearch(container, search.trim()))
  const lensCounts = {
    todos: searched.length,
    atraso: searched.filter((container) => container.demurrage_status === 'overdue').length,
    devolvidos: searched.filter((container) => Boolean(container.return_date)).length,
  }
  const visible = searched.filter((container) => (
    lens === 'atraso' ? container.demurrage_status === 'overdue'
      : lens === 'devolvidos' ? Boolean(container.return_date)
        : true
  ))
  const grouped = groupByBl(visible)
  // O estado de cobrança é do grupo inteiro (todas as caixas monitoradas dos
  // B/Ls do grupo), nunca só do que a busca ou a lente deixaram visível: com a
  // lente Devolvidos, a caixa irmã ainda fora continua segurando a emissão.
  const billing = useMemo(() => {
    const rowsByGroup = new Map<string, DemurrageContainerRow[]>()
    for (const container of monitored) {
      const key = groupKeyOf(container)
      rowsByGroup.set(key, [...(rowsByGroup.get(key) ?? []), container])
    }
    const states = new Map<string, BlBillingState>()
    for (const [key, rows] of rowsByGroup) states.set(key, blBillingState(rows, rows[0]?.billing_group))
    return states
  }, [monitored])
  const stateOf = (rows: DemurrageContainerRow[]) => billing.get(groupKeyOf(rows[0])) ?? blBillingState(rows)
  // A ação aparece uma vez por grupo, no primeiro B/L dele na lista; o banco
  // emite pelo âncora qualquer que seja o B/L pedido.
  const leadBlOfGroup = new Map<string, string>()
  for (const [blId, rows] of grouped) {
    const key = groupKeyOf(rows[0])
    if (!leadBlOfGroup.has(key)) leadBlOfGroup.set(key, blId)
  }
  const leadOf = (blId: string, rows: DemurrageContainerRow[]) => leadBlOfGroup.get(groupKeyOf(rows[0])) ?? blId
  // Container compartilhado entre B/Ls do grupo conta uma vez.
  const visibleBoxes = distinctBoxes(visible)
  const runningUsd = visibleBoxes
    .filter((container) => !container.return_date)
    .reduce((sum, container) => sum + (calcs.get(container.id)?.calc?.total_usd ?? 0), 0)
  const toBillUsd = [...leadBlOfGroup.values()].reduce((sum, blId) => {
    const state = stateOf(grouped.get(blId)!)
    return sum + (state.action === 'generate' || state.action === 'complement' ? state.uncoveredUsd : 0)
  }, 0)
  const filtering = Boolean(search.trim()) || lens !== 'todos'

  return (
    <div className="app-dem-tab">
      <div className="app-dem-toolbar">
        <div className="app-dem-toolbar__search">
          <label className="sr-only" htmlFor="demurrage-container-search">Buscar container, B/L, Cliente ou Invoice</label>
          <Input
            id="demurrage-container-search"
            type="search"
            placeholder="Container, B/L, Cliente ou Invoice"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
          />
        </div>
        <SegmentedControl
          label="Recorte dos containers"
          value={lens}
          onChange={onLensChange}
          options={[
            { value: 'todos', label: `Todos (${lensCounts.todos})` },
            { value: 'atraso', label: `Em atraso (${lensCounts.atraso})` },
            { value: 'devolvidos', label: `Devolvidos (${lensCounts.devolvidos})` },
          ]}
        />
      </div>

      <QueryStateGate
        isLoading={loading}
        isError={Boolean(error)}
        hasData={containers !== undefined}
        errorMessage={`Não foi possível carregar os containers: ${extractErrorText(error)}`}
        onRetry={onRetry}
        loadingLabel="Carregando containers…"
      >
        <div className="app-dem-tablebar">
          <SummaryStrip
            label="Resumo dos containers"
            items={[
              { label: visibleBoxes.length === 1 ? 'container' : 'containers', value: String(visibleBoxes.length) },
              { label: grouped.size === 1 ? 'B/L' : 'B/Ls', value: String(grouped.size) },
              { label: 'correndo até hoje', value: fmtUSD(runningUsd), tone: runningUsd > 0 ? 'danger' : 'default' },
              { label: 'a faturar (previsto)', value: fmtUSD(toBillUsd), tone: toBillUsd > 0 ? 'warning' : 'default' },
            ]}
          />
          {!canIssue ? <p className="app-dem-note">Gerar Invoice é do Administrativo.</p> : null}
        </div>

        {grouped.size === 0 ? (
          filtering ? (
            <EmptyState
              icon={Clock}
              title="Nenhum container neste recorte"
              description={search.trim() ? `Nada encontrado para "${search.trim()}".` : 'Nenhum container corresponde ao recorte escolhido.'}
              action={<Button variant="secondary" onClick={() => { onSearchChange(''); onLensChange('todos') }}>Limpar busca e recorte</Button>}
            />
          ) : (
            <EmptyState
              icon={Clock}
              title="Nenhum container em Demurrage"
              description="Aparecem aqui os containers em atraso, os devolvidos com sobreestadia e os que já estão numa Invoice."
            />
          )
        ) : narrow ? (
          <div className="app-dem-cards">
            {Array.from(grouped.entries()).map(([blId, rows]) => (
              <BlCard
                key={blId}
                blId={blId}
                rows={rows}
                state={stateOf(rows)}
                leadBlId={leadOf(blId, rows)}
                calcs={calcs}
                canIssue={canIssue}
                generatingBl={generatingBl}
                error={generateError?.blId === blId ? generateError.message : null}
                onGenerateInvoice={onGenerateInvoice}
                onEditContainer={onEditContainer}
                onOpenInvoice={onOpenInvoice}
              />
            ))}
          </div>
        ) : (
          <div className="app-surface app-dem-table-surface">
            <div className="app-table-scroll app-table-scroll--sticky">
              <table className="app-table app-table--compact app-dem-table">
                <caption className="sr-only">Containers em Demurrage agrupados por B/L</caption>
                <thead>
                  <tr>
                    <th scope="col">Container</th>
                    <th scope="col">Tipo</th>
                    <th scope="col">Descarga</th>
                    <th scope="col">Devolução</th>
                    <th scope="col">Free time</th>
                    <th scope="col">P1 · P2</th>
                    <th scope="col">Situação</th>
                    <th scope="col" className="app-dem-num">USD</th>
                    <th scope="col"><span className="sr-only">Ações</span></th>
                  </tr>
                </thead>
                <tbody>
                  {Array.from(grouped.entries()).map(([blId, rows]) => {
                    const state = stateOf(rows)
                    return (
                      <Fragment key={blId}>
                        <tr className="app-dem-group">
                          <th scope="colgroup" colSpan={9}>
                            <BlHeader
                              blId={blId}
                              rows={rows}
                              state={state}
                              leadBlId={leadOf(blId, rows)}
                              canIssue={canIssue}
                              generatingBl={generatingBl}
                              error={generateError?.blId === blId ? generateError.message : null}
                              onGenerateInvoice={onGenerateInvoice}
                              onOpenInvoice={onOpenInvoice}
                            />
                          </th>
                        </tr>
                        {rows.map((container) => (
                          <ContainerRow
                            key={container.id}
                            container={container}
                            calc={calcs.get(container.id) ?? { calc: null, error: null }}
                            disabled={generatingBl === blId}
                            onEdit={onEditContainer}
                            onOpenInvoice={onOpenInvoice}
                          />
                        ))}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <Legend />
          </div>
        )}
      </QueryStateGate>
    </div>
  )
}

function Legend() {
  // P1/P2 são as faixas tarifárias do CONTEXT.md, não abreviação de interface.
  return (
    <p className="app-dem-legend">
      Free time: dias sem cobrança depois da descarga · P1: primeira faixa diária depois do free time · P2: segunda faixa, com diária maior ·
      USD: sobreestadia calculada até a devolução ou até hoje; o valor cobrado é o da Invoice, travado na emissão.
    </p>
  )
}

/** Grupo de cobrança da caixa: o âncora do banco, ou o próprio B/L sem grupo. */
function groupKeyOf(container: DemurrageContainerRow | undefined): string {
  return container?.billing_group?.anchorBlId ?? `bl:${container?.bl_id ?? ''}`
}

function blContext(rows: DemurrageContainerRow[]) {
  const bl = rows[0]?.bl
  return {
    customerName: bl?.customer?.name ?? 'Cliente não vinculado',
    voyage: bl?.voyage?.voyage_number ? `${bl.voyage.voyage_number}${bl.voyage.vessel?.name ? ` · ${bl.voyage.vessel.name}` : ''}` : null,
  }
}

function InvoiceRefs({ state, onOpenInvoice }: { state: BlBillingState; onOpenInvoice: (id: number) => void }) {
  if (!state.invoices.length) return null
  return (
    <span className="app-dem-refs">
      <span>{state.invoices.length > 1 ? 'Invoices:' : 'Invoice:'}</span>
      {state.invoices.map((ref) => (
        <button key={ref.id} type="button" className="app-dem-link app-dem-code" onClick={() => onOpenInvoice(ref.id)}>
          {ref.doc_number}
          <span className="app-dem-refs__status"> · {statusLabel(DEMURRAGE_INVOICE_STATUS_LABELS, ref.status)}</span>
        </button>
      ))}
    </span>
  )
}

function BillingAction({
  blId,
  state,
  canIssue,
  generatingBl,
  onGenerateInvoice,
}: {
  blId: string
  state: BlBillingState
  canIssue: boolean
  generatingBl: string | null
  onGenerateInvoice: (blId: string) => void
}) {
  if (state.action === 'waiting') {
    return <span className="app-dem-state app-dem-state--muted">Aguarda devolução de {formatCountLabel(state.stillOut, 'container', 'containers')}</span>
  }
  if (state.action === 'covered') {
    return <span className="app-dem-state app-dem-state--success">Todas as caixas cobradas</span>
  }
  if (state.action === 'none') return null
  const complement = state.action === 'complement'
  if (!canIssue) {
    return <span className="app-dem-state app-dem-state--warning">{complement ? `${formatCountLabel(state.uncovered.length, 'caixa', 'caixas')} sem Invoice` : 'Pronto para faturar'}</span>
  }
  return (
    <Button
      variant="secondary"
      className="app-btn--sm"
      loading={generatingBl === blId}
      loadingLabel="Gerando…"
      disabled={Boolean(generatingBl) && generatingBl !== blId}
      onClick={() => onGenerateInvoice(blId)}
      aria-label={complement ? `Gerar Invoice complementar do B/L ${blId}` : `Gerar Invoice do B/L ${blId}`}
    >
      <FileText size={14} aria-hidden="true" />
      {complement ? 'Gerar complementar' : 'Gerar Invoice'}
    </Button>
  )
}

function BlHeader({
  blId,
  rows,
  state,
  leadBlId,
  canIssue,
  generatingBl,
  error,
  onGenerateInvoice,
  onOpenInvoice,
}: {
  blId: string
  rows: DemurrageContainerRow[]
  state: BlBillingState
  /** B/L do mesmo grupo que mostra a ação; nos demais, só a referência a ele. */
  leadBlId: string
  canIssue: boolean
  generatingBl: string | null
  error?: string | null
  onGenerateInvoice: (blId: string) => void
  onOpenInvoice: (id: number) => void
}) {
  const { customerName, voyage } = blContext(rows)
  const isLead = leadBlId === blId
  return (
    <div className="app-dem-group__row">
      <div className="app-dem-group__identity">
        <Link to={`/bls/${encodeURIComponent(blId)}?tab=faturamento`} className="app-dem-link app-dem-code app-dem-group__bl">{blId}</Link>
        <span className="app-dem-group__customer">{customerName}</span>
        {voyage ? <span className="app-dem-group__meta">{voyage}</span> : null}
        <InvoiceRefs state={state} onOpenInvoice={onOpenInvoice} />
      </div>
      <div className="app-dem-group__actions">
        {!isLead ? (
          <span className="app-dem-state app-dem-state--muted">Container compartilhado: cobrança junto com o B/L {leadBlId}</span>
        ) : null}
        {isLead && state.uncoveredUsd > 0 && state.action !== 'covered' ? (
          <span className="app-dem-group__amount" title="Sobreestadia prevista das caixas ainda sem Invoice">
            {fmtUSD(state.uncoveredUsd)}
            <span className="app-dem-group__amount-label">{state.action === 'waiting' ? ' correndo' : ' a faturar'}</span>
          </span>
        ) : null}
        {isLead ? <BillingAction blId={blId} state={state} canIssue={canIssue} generatingBl={generatingBl} onGenerateInvoice={onGenerateInvoice} /> : null}
      </div>
      {isLead && state.action === 'complement' ? (
        <p className="app-dem-group__hint">
          O grupo já tem Invoice. A complementar cobra só {state.uncovered.length === 1 ? 'a caixa ainda não cobrada' : 'as caixas ainda não cobradas'}: {state.uncovered.map((container) => container.container_number).join(', ')}.
        </p>
      ) : null}
      {error ? <p className="app-dem-group__error" role="alert">{error}</p> : null}
    </div>
  )
}

function situationNote(container: DemurrageContainerRow) {
  if (!container.return_date && container.discharge_date) return `Fora há ${daysSince(container.discharge_date, today())} dias`
  return null
}

function UsdCell({ container, calc }: { container: DemurrageContainerRow; calc: Calc }) {
  if (calc.error) return <span className="app-dem-error-text">{calc.error}</span>
  if (!calc.calc) return <span aria-label="Sem descarga">—</span>
  const billed = container.billed_in?.[0]
  return (
    <>
      <span className="app-dem-amount">{calc.calc.total_usd > 0 ? fmtUSD(calc.calc.total_usd) : fmtUSD(0)}</span>
      <span className="app-dem-meta">{billed ? `recalculado hoje; o cobrado é o da ${billed.doc_number}` : container.return_date ? 'previsto' : 'até hoje'}</span>
    </>
  )
}

function SituationCell({ container, onOpenInvoice }: { container: DemurrageContainerRow; onOpenInvoice: (id: number) => void }) {
  const note = situationNote(container)
  const billed = container.billed_in ?? []
  return (
    <div className="app-table__cell-stack">
      <DemurrageStatusBadge status={container.demurrage_status} />
      {note ? <span className="app-dem-meta">{note}</span> : null}
      {billed.length ? (
        <span className="app-dem-meta">
          Cobrada em{' '}
          {billed.map((ref, index) => (
            <Fragment key={ref.id}>
              {index > 0 ? ', ' : null}
              <button type="button" className="app-dem-link app-dem-code" onClick={() => onOpenInvoice(ref.id)}>{ref.doc_number}</button>
            </Fragment>
          ))}
        </span>
      ) : container.return_date ? <span className="app-dem-meta">Sem Invoice</span> : null}
    </div>
  )
}

function ContainerRow({
  container,
  calc,
  disabled,
  onEdit,
  onOpenInvoice,
}: {
  container: DemurrageContainerRow
  calc: Calc
  disabled: boolean
  onEdit: (container: DemurrageContainerRow) => void
  onOpenInvoice: (id: number) => void
}) {
  const result = calc.calc
  return (
    <tr>
      <td className="app-dem-code app-dem-strong">{container.container_number}</td>
      <td>{container.type ?? '—'}</td>
      <td className="tabular-nums">{container.discharge_date ? formatDate(container.discharge_date) : '—'}</td>
      <td className="tabular-nums">{container.return_date ? formatDate(container.return_date) : <span className="app-dem-meta">Não devolvido</span>}</td>
      <td>
        {result ? (
          <div className="app-table__cell-stack">
            <span className="tabular-nums">{containerFreeTimeDays(container) ?? result.free_days} dias</span>
            <span className="app-dem-meta">{FREE_TIME_SOURCE_LABELS[freeTimeSource(container)]}</span>
          </div>
        ) : '—'}
      </td>
      <td className="tabular-nums">{result ? `${result.days_p1} d · ${result.days_p2} d` : '—'}</td>
      <td><SituationCell container={container} onOpenInvoice={onOpenInvoice} /></td>
      <td className="app-dem-num"><div className="app-table__cell-stack"><UsdCell container={container} calc={calc} /></div></td>
      <td className="app-dem-row-action">
        <button
          type="button"
          className="app-table__icon-button app-table__icon-button--sm"
          aria-label={`Editar datas de ${container.container_number}`}
          title="Editar datas"
          disabled={disabled}
          onClick={() => onEdit(container)}
        >
          <Pencil size={15} aria-hidden="true" />
        </button>
      </td>
    </tr>
  )
}

function BlCard({
  blId,
  rows,
  state,
  leadBlId,
  calcs,
  canIssue,
  generatingBl,
  error,
  onGenerateInvoice,
  onEditContainer,
  onOpenInvoice,
}: {
  blId: string
  rows: DemurrageContainerRow[]
  state: BlBillingState
  leadBlId: string
  calcs: Map<number, Calc>
  canIssue: boolean
  generatingBl: string | null
  error?: string | null
  onGenerateInvoice: (blId: string) => void
  onEditContainer: (container: DemurrageContainerRow) => void
  onOpenInvoice: (id: number) => void
}) {
  return (
    <article className="app-dem-card" aria-label={`B/L ${blId}`}>
      <BlHeader
        blId={blId}
        rows={rows}
        state={state}
        leadBlId={leadBlId}
        canIssue={canIssue}
        generatingBl={generatingBl}
        error={error}
        onGenerateInvoice={onGenerateInvoice}
        onOpenInvoice={onOpenInvoice}
      />
      <ul className="app-dem-card__list">
        {rows.map((container) => {
          const calc = calcs.get(container.id) ?? { calc: null, error: null }
          return (
            <li key={container.id} className="app-dem-card__item">
              <div className="app-dem-card__head">
                <span className="app-dem-code app-dem-strong">{container.container_number}</span>
                <span className="app-dem-meta">{container.type ?? ''}</span>
                <button
                  type="button"
                  className="app-table__icon-button app-table__icon-button--sm"
                  aria-label={`Editar datas de ${container.container_number}`}
                  disabled={generatingBl === blId}
                  onClick={() => onEditContainer(container)}
                >
                  <Pencil size={15} aria-hidden="true" />
                </button>
              </div>
              <p className="app-dem-meta">
                Descarga {container.discharge_date ? formatDate(container.discharge_date) : '—'} · Devolução {container.return_date ? formatDate(container.return_date) : 'pendente'}
                {calc.calc ? ` · Free time ${containerFreeTimeDays(container) ?? calc.calc.free_days} dias (${FREE_TIME_SOURCE_LABELS[freeTimeSource(container)]})` : ''}
              </p>
              <div className="app-dem-card__foot">
                <SituationCell container={container} onOpenInvoice={onOpenInvoice} />
                <div className="app-table__cell-stack app-dem-num"><UsdCell container={container} calc={calc} /></div>
              </div>
            </li>
          )
        })}
      </ul>
    </article>
  )
}
