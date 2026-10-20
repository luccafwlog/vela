import { Fragment, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarDays, ChevronDown, ChevronRight, Clock, FilePlus2, FileText } from 'lucide-react'
import { Button } from '../ui/Button'
import { RowActionButton } from '../ui/RowActionButton'
import { CopyValue } from '../ui/CopyValue'
import { NoValue } from '../ui/NoValue'
import { EmptyState } from '../ui/Card'
import { Input } from '../ui/Input'
import { SegmentedControl } from '../ui/SegmentedControl'
import { StatusText } from '../ui/StatusText'
import { SummaryStrip } from '../ui/SummaryStrip'
import { QueryStateGate } from '../shared/QueryStateGate'
import { useNarrowViewport } from '../bl/useNarrowViewport'
import {
  FREE_TIME_SOURCE_LABELS,
  containerFreeTimeDays,
  blBillingState,
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
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  function toggle(blId: string) {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(blId)) next.delete(blId)
      else next.add(blId)
      return next
    })
  }
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
          {!canIssue ? <p className="app-dem-note">Gerar Invoice exige um perfil interno ativo.</p> : null}
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
                <caption className="sr-only">B/Ls com containers em Demurrage; cada linha abre os containers do B/L</caption>
                <thead>
                  <tr>
                    <th scope="col"><span className="sr-only">Abrir containers</span></th>
                    <th scope="col">B/L</th>
                    <th scope="col" className="app-table__text-head">Cliente</th>
                    <th scope="col">Navio / Viagem</th>
                    <th scope="col">Containers</th>
                    <th scope="col">US$</th>
                    <th scope="col" className="app-table__text-head">Situação</th>
                    <th scope="col"><span className="sr-only">Ações</span></th>
                  </tr>
                </thead>
                <tbody>
                  {Array.from(grouped.entries()).map(([blId, rows]) => {
                    const state = stateOf(rows)
                    const leadBlId = leadOf(blId, rows)
                    const isLead = leadBlId === blId
                    const open = expanded.has(blId)
                    const panelId = `dem-bl-${blId}`
                    const boxes = distinctBoxes(rows)
                    const returned = boxes.filter((container) => Boolean(container.return_date)).length
                    const blUsd = boxes.reduce((sum, container) => sum + (calcs.get(container.id)?.calc?.total_usd ?? 0), 0)
                    // Âmbar só o que ainda não tem Invoice; a parte já cobrada fica no total.
                    const usdPending = isLead && state.action !== 'covered' && state.uncoveredUsd > 0
                    const { customerName, voyage } = blContext(rows)
                    const rowError = generateError?.blId === blId ? generateError.message : null
                    return (
                      <Fragment key={blId}>
                        <tr>
                          <td>
                            <button
                              type="button"
                              className="app-table__icon-button"
                              aria-controls={open ? panelId : undefined}
                              aria-expanded={open}
                              aria-label={`${open ? 'Recolher' : 'Abrir'} os containers do B/L ${blId}`}
                              onClick={() => toggle(blId)}
                            >
                              {open ? <ChevronDown size={15} aria-hidden="true" /> : <ChevronRight size={15} aria-hidden="true" />}
                            </button>
                          </td>
                          <td className="app-dem-code"><CopyValue value={blId} label="número do B/L"><Link to={`/bls/${encodeURIComponent(blId)}?tab=faturamento`} className="app-dem-link app-dem-strong">{blId}</Link></CopyValue></td>
                          <td className="app-table__text" title={customerName}>{customerName}</td>
                          <td>{voyage ?? <NoValue label="Sem viagem" />}</td>
                          <td className="tabular-nums">{returned} de {formatCountLabel(boxes.length, 'devolvido', 'devolvidos')}</td>
                          <td className="tabular-nums">
                            {usdPending ? (
                              <>
                                <StatusText tone="warning">{fmtUSD(state.uncoveredUsd)}</StatusText>
                                {' '}<span className="app-dem-meta">{state.action === 'waiting' ? 'correndo' : 'a faturar'}{state.uncoveredUsd < blUsd ? ` de ${fmtUSD(blUsd)}` : ''}</span>
                              </>
                            ) : fmtUSD(blUsd)}
                          </td>
                          <td className="app-table__text"><BlSituation state={state} isLead={isLead} leadBlId={leadBlId} canIssue={canIssue} onOpenInvoice={onOpenInvoice} /></td>
                          <td className="app-dem-row-action">
                            {isLead ? <BillingAction blId={blId} state={state} canIssue={canIssue} generatingBl={generatingBl} onGenerateInvoice={onGenerateInvoice} iconOnly /> : null}
                          </td>
                        </tr>
                        {rowError ? (
                          <tr data-row-detail>
                            <td colSpan={8}><p className="app-dem-group__error" role="alert">{rowError}</p></td>
                          </tr>
                        ) : null}
                        {open ? (
                          <tr id={panelId} data-row-detail>
                            <td colSpan={8}>
                              {isLead && state.action === 'complement' ? (
                                <p className="app-dem-group__hint">
                                  O grupo já tem Invoice. A complementar cobra só {state.uncovered.length === 1 ? 'a caixa ainda não cobrada' : 'as caixas ainda não cobradas'}: {state.uncovered.map((container) => container.container_number).join(', ')}.
                                </p>
                              ) : null}
                              <table className="app-table app-table--compact app-dem-table">
                                <caption className="sr-only">Containers do B/L {blId}</caption>
                                <thead>
                                  <tr>
                                    <th scope="col">Container</th>
                                    <th scope="col">Tipo</th>
                                    <th scope="col">Descarga</th>
                                    <th scope="col">Devolução</th>
                                    <th scope="col">Dias</th>
                                    <th scope="col">Free time</th>
                                    <th scope="col">1º período</th>
                                    <th scope="col">2º período</th>
                                    <th scope="col">US$</th>
                                    <th scope="col"><span className="sr-only">Ações</span></th>
                                  </tr>
                                </thead>
                                <tbody>
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
                                </tbody>
                              </table>
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </QueryStateGate>
    </div>
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

/**
 * Situação do B/L em texto (regra 5): aguarda devolução, a faturar ou a
 * Invoice que já cobra o grupo, com a situação dela.
 */
function BlSituation({ state, isLead, leadBlId, canIssue, onOpenInvoice }: {
  state: BlBillingState
  isLead: boolean
  leadBlId: string
  canIssue: boolean
  onOpenInvoice: (id: number) => void
}) {
  if (!isLead) return <StatusText tone="muted">Cobrança junto com o B/L {leadBlId}</StatusText>
  const invoices = state.invoices.map((ref, index) => (
    <Fragment key={ref.id}>
      {index > 0 ? ', ' : null}
      <button type="button" className="app-dem-link app-dem-code" onClick={() => onOpenInvoice(ref.id)}>{ref.doc_number}</button>
      {' '}
      {ref.status === 'paid'
        ? <StatusText tone="paid">{statusLabel(DEMURRAGE_INVOICE_STATUS_LABELS, ref.status)}</StatusText>
        : <span className="lowercase">{statusLabel(DEMURRAGE_INVOICE_STATUS_LABELS, ref.status)}</span>}
    </Fragment>
  ))
  if (state.action === 'waiting') {
    return <>{invoices.length ? <>{invoices} · </> : null}<StatusText tone="muted">Aguarda devolução de {formatCountLabel(state.stillOut, 'container', 'containers')}</StatusText></>
  }
  if (state.action === 'generate') return <StatusText tone={canIssue ? 'muted' : 'warning'}>{canIssue ? 'A faturar' : 'Pronto para faturar'}</StatusText>
  if (state.action === 'complement') return <>{invoices} · <StatusText tone="warning">{formatCountLabel(state.uncovered.length, 'caixa', 'caixas')} sem Invoice</StatusText></>
  if (invoices.length) return <>{invoices}</>
  return <NoValue label="Nada a cobrar" />
}

function BillingAction({
  blId,
  state,
  canIssue,
  generatingBl,
  onGenerateInvoice,
  iconOnly = false,
}: {
  blId: string
  state: BlBillingState
  canIssue: boolean
  generatingBl: string | null
  onGenerateInvoice: (blId: string) => void
  /** Na linha da tabela de B/Ls, só o ícone (regra 9); no grupo por B/L, com texto. */
  iconOnly?: boolean
}) {
  if (state.action !== 'generate' && state.action !== 'complement') return null
  const complement = state.action === 'complement'
  if (!canIssue) return null
  if (iconOnly) {
    return (
      <RowActionButton
        label={complement ? `Gerar Invoice complementar do B/L ${blId}` : `Gerar Invoice do B/L ${blId}`}
        icon={complement ? FilePlus2 : FileText}
        loading={generatingBl === blId}
        disabled={Boolean(generatingBl) && generatingBl !== blId}
        onClick={() => onGenerateInvoice(blId)}
      />
    )
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
        <CopyValue value={blId} label="número do B/L"><Link to={`/bls/${encodeURIComponent(blId)}?tab=faturamento`} className="app-dem-link app-dem-code app-dem-group__bl">{blId}</Link></CopyValue>
        <span className="app-dem-group__customer">{customerName}</span>
        {voyage ? <span className="app-dem-group__meta">{voyage}</span> : null}
        <span><BlSituation state={state} isLead={isLead} leadBlId={leadBlId} canIssue={canIssue} onOpenInvoice={onOpenInvoice} /></span>
      </div>
      <div className="app-dem-group__actions">
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

/** "9 × US$ 30,00", como na fatura do Portal (lote 1); "—" sem dias no período. */
function periodValue(days: number, rate: number) {
  return days > 0 ? `${days} × ${fmtUSD(rate)}` : <NoValue label="Sem dias neste período" />
}

/** Invoice(s) que já cobram a caixa, abríveis por teclado e toque. */
function BilledIn({ container, onOpenInvoice }: { container: DemurrageContainerRow; onOpenInvoice: (id: number) => void }) {
  const billed = container.billed_in ?? []
  if (!billed.length) return null
  return (
    <span className="app-dem-meta">
      {' '}· cobrada em{' '}
      {billed.map((ref, index) => (
        <Fragment key={ref.id}>
          {index > 0 ? ', ' : null}
          <button type="button" className="app-dem-link app-dem-code" onClick={() => onOpenInvoice(ref.id)}>{ref.doc_number}</button>
        </Fragment>
      ))}
    </span>
  )
}

function UsdCell({ calc }: { calc: Calc }) {
  if (calc.error) return <span className="app-dem-error-text">{calc.error}</span>
  if (!calc.calc) return <NoValue label="Sem descarga" />
  return <span className="tabular-nums">{fmtUSD(calc.calc.total_usd)}</span>
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
  const late = Boolean(result && result.days_p1 + result.days_p2 > 0)
  const billed = container.billed_in ?? []
  return (
    <tr>
      <td className="app-dem-code app-dem-strong"><CopyValue value={container.container_number} label="número do contêiner" /></td>
      <td>{container.type ?? <NoValue label="Sem tipo" />}</td>
      <td className="tabular-nums">{container.discharge_date ? formatDate(container.discharge_date) : <NoValue label="Sem data de descarga" />}</td>
      <td className="tabular-nums">{container.return_date ? formatDate(container.return_date) : <NoValue label="Não devolvido" />}</td>
      <td className="tabular-nums">{result ? (late ? <StatusText tone="warning">{result.total_days}</StatusText> : result.total_days) : <NoValue label="Sem dias calculados" />}</td>
      <td className="tabular-nums" title={result ? `Free time ${FREE_TIME_SOURCE_LABELS[freeTimeSource(container)]}` : undefined}>
        {result ? containerFreeTimeDays(container) ?? result.free_days : <NoValue label="Sem free time calculado" />}
      </td>
      <td className="tabular-nums">{result ? periodValue(result.days_p1, result.rate_p1_usd) : <NoValue label="Sem dias calculados" />}</td>
      <td className="tabular-nums">{result ? periodValue(result.days_p2, result.rate_p2_usd) : <NoValue label="Sem dias calculados" />}</td>
      <td title={billed.length ? 'Recalculado hoje; o valor cobrado é o da Invoice' : undefined}><UsdCell calc={calc} /><BilledIn container={container} onOpenInvoice={onOpenInvoice} /></td>
      <td className="app-dem-row-action">
        <RowActionButton
          label={`Editar datas de ${container.container_number}`}
          icon={CalendarDays}
          disabled={disabled}
          onClick={() => onEdit(container)}
        />
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
                <span className="app-dem-code app-dem-strong"><CopyValue value={container.container_number} label="número do contêiner" /></span>
                <span className="app-dem-meta">{container.type ?? <NoValue label="Sem tipo" />}</span>
                <Button
                  type="button"
                  variant="secondary"
                  className="app-btn--sm"
                  aria-label={`Editar datas de ${container.container_number}`}
                  disabled={generatingBl === blId}
                  onClick={() => onEditContainer(container)}
                >
                  Editar datas
                </Button>
              </div>
              <p className="app-dem-meta">
                Descarga {container.discharge_date ? formatDate(container.discharge_date) : <NoValue label="Sem data de descarga" />} · Devolução {container.return_date ? formatDate(container.return_date) : 'pendente'}
                {calc.calc ? ` · Free time ${containerFreeTimeDays(container) ?? calc.calc.free_days} dias (${FREE_TIME_SOURCE_LABELS[freeTimeSource(container)]})` : ''}
              </p>
              <div className="app-dem-card__foot">
                <span className="app-dem-meta">{calc.calc ? `${calc.calc.total_days} dias` : null}</span>
                <div className="app-dem-num"><UsdCell calc={calc} /><BilledIn container={container} onOpenInvoice={onOpenInvoice} /></div>
              </div>
            </li>
          )
        })}
      </ul>
    </article>
  )
}
