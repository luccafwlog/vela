import { Fragment, useState } from 'react'
import { Link } from 'react-router-dom'
import { Ban, CalendarDays, ChevronDown, ChevronRight, Clock, Download, FilePlus2, FileText } from 'lucide-react'
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
import { FREE_TIME_SOURCE_LABELS, fmtUSD } from '../../services/demurrage/demurragePresentation'
import {
  DEMURRAGE_DIVISIONS,
  DEMURRAGE_DIVISION_LABELS,
  boxCounts,
  canWaiveBox,
  divisionTotals,
  matchesBoardSearch,
  nextStep,
  type BoardBox,
  type BoardGroup,
  type DemurrageDivision,
} from '../../services/demurrage/demurrageBoard'
import { formatDate } from '../../lib/utils'
import { extractErrorText } from '../../lib/errors'

type Props = {
  groups: BoardGroup[] | undefined
  search: string
  division: DemurrageDivision
  loading: boolean
  error: unknown
  canIssue: boolean
  generatingBl: string | null
  /** Recusa do banco ao gerar, mostrada na linha do B/L que a pediu. */
  generateError?: { blId: string; message: string } | null
  onRetry: () => void
  onSearchChange: (value: string) => void
  onDivisionChange: (division: DemurrageDivision) => void
  onGenerateInvoice: (blId: string) => void
  onEditContainer: (box: BoardBox, group: BoardGroup) => void
  onOpenInvoice: (invoiceId: number) => void
  /** Dispensar a cobrança da caixa (ADR 0112, D24); ausente, a ação não aparece. */
  onWaiveBox?: (box: BoardBox, group: BoardGroup) => void
  /** Planilha de Exposição do recorte da tela (lote 6). */
  onExport?: (groups: BoardGroup[], division: DemurrageDivision) => void
}

const EMPTY_TEXT: Record<DemurrageDivision, string> = {
  correndo: 'Nenhum container fora passou do free time.',
  a_emitir: 'Nenhum grupo com tudo devolvido e Demurrage sem Invoice.',
  esperando: 'Nenhuma caixa devolvida com sobreestadia esperando outra caixa do grupo.',
  travado: 'Nada travado: toda sobreestadia tem como ser cobrada.',
}

/**
 * Aba Containers (ADR 0112, D1 a D5): a classificação vem do banco
 * (`list_demurrage_billing_board`, migration 515), um grupo de cobrança por
 * linha, em quatro divisões. Cada caixa aparece num lugar só; a já cobrada
 * sai da aba quando a Invoice é emitida.
 */
export function DemurrageContainersTab({
  groups,
  search,
  division,
  loading,
  error,
  canIssue,
  generatingBl,
  generateError = null,
  onRetry,
  onSearchChange,
  onDivisionChange,
  onGenerateInvoice,
  onEditContainer,
  onOpenInvoice,
  onWaiveBox,
  onExport,
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
  const searched = (groups ?? []).filter((group) => matchesBoardSearch(group, search))
  const totals = divisionTotals(searched)
  const visible = searched.filter((group) => group.division === division)
  const visibleTotal = totals[division]

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
          label="Divisão da cobrança"
          value={division}
          onChange={onDivisionChange}
          options={DEMURRAGE_DIVISIONS.map((value) => ({ value, label: `${DEMURRAGE_DIVISION_LABELS[value]} (${totals[value].groups})` }))}
        />
      </div>

      <QueryStateGate
        isLoading={loading}
        isError={Boolean(error)}
        hasData={groups !== undefined}
        errorMessage={`Não foi possível carregar os containers: ${extractErrorText(error)}`}
        onRetry={onRetry}
        loadingLabel="Carregando containers…"
      >
        <div className="app-dem-tablebar">
          <SummaryStrip
            label={`Resumo de ${DEMURRAGE_DIVISION_LABELS[division]}`}
            items={[
              { label: visibleTotal.groups === 1 ? 'grupo de B/L' : 'grupos de B/L', value: String(visibleTotal.groups) },
              { label: visibleTotal.boxes === 1 ? 'container' : 'containers', value: String(visibleTotal.boxes) },
              { label: 'US$ previsto hoje', value: fmtUSD(visibleTotal.usd), tone: visibleTotal.usd > 0 ? (division === 'travado' ? 'danger' : 'warning') : 'default' },
            ]}
          />
          {onExport && visible.length ? (
            <Button variant="secondary" className="app-btn--sm" onClick={() => onExport(visible, division)}>
              <Download size={14} aria-hidden="true" />
              Exportar
            </Button>
          ) : null}
          {!canIssue ? <p className="app-dem-note">Gerar Invoice exige um perfil interno ativo.</p> : null}
        </div>

        {visible.length === 0 ? (
          search.trim() ? (
            <EmptyState
              icon={Clock}
              title="Nada encontrado nesta divisão"
              description={`Nada encontrado para "${search.trim()}".`}
              action={<Button variant="secondary" onClick={() => onSearchChange('')}>Limpar busca</Button>}
            />
          ) : (
            <EmptyState icon={Clock} title={`Nada em ${DEMURRAGE_DIVISION_LABELS[division]}`} description={EMPTY_TEXT[division]} />
          )
        ) : narrow ? (
          <div className="app-dem-cards">
            {visible.map((group) => (
              <article key={group.anchor_bl_id} className="app-dem-card" aria-label={`B/L ${group.anchor_bl_id}`}>
                <div className="app-dem-group__row">
                  <div className="app-dem-group__identity">
                    <BlLink blId={group.anchor_bl_id} />
                    <span className="app-dem-group__customer">{group.customer_name ?? 'Cliente não vinculado'}</span>
                    {group.voyage_label ? <span className="app-dem-group__meta">{group.voyage_label}</span> : null}
                    <span><NextStepText group={group} /></span>
                  </div>
                  <div className="app-dem-group__actions">
                    {group.usd > 0 ? <span className="app-dem-group__amount">{fmtUSD(group.usd)}</span> : null}
                    <NextStepAction group={group} canIssue={canIssue} generatingBl={generatingBl} onGenerateInvoice={onGenerateInvoice} />
                  </div>
                  {generateError?.blId === group.anchor_bl_id ? <p className="app-dem-group__error" role="alert">{generateError.message}</p> : null}
                </div>
                <ul className="app-dem-card__list">
                  {group.boxes.map((box) => (
                    <li key={box.container_id} className="app-dem-card__item">
                      <div className="app-dem-card__head">
                        <span className="app-dem-code app-dem-strong"><CopyValue value={box.container_number} label="número do contêiner" /></span>
                        <span className="app-dem-meta">{box.type ?? <NoValue label="Sem tipo" />}</span>
                        <Button type="button" variant="secondary" className="app-btn--sm" aria-label={`Editar datas de ${box.container_number}`} onClick={() => onEditContainer(box, group)}>
                          Editar datas
                        </Button>
                      </div>
                      <p className="app-dem-meta">
                        Descarga {box.discharge_date ? formatDate(box.discharge_date) : <NoValue label="Sem data de descarga" />} · Devolução {box.return_date ? formatDate(box.return_date) : 'pendente'}
                        {box.free_days != null ? ` · Free time ${box.free_days} dias${box.free_source ? ` (${FREE_TIME_SOURCE_LABELS[box.free_source]})` : ''}` : ''}
                      </p>
                      <div className="app-dem-card__foot">
                        <span className="app-dem-meta">{box.total_days != null ? `${box.total_days} dias` : null}</span>
                        <div className="app-dem-num"><BoxUsd box={box} onOpenInvoice={onOpenInvoice} /></div>
                      </div>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        ) : (
          <div className="app-surface app-dem-table-surface">
            <div className="app-table-scroll app-table-scroll--sticky">
              <table className="app-table app-table--compact app-dem-table">
                <caption className="sr-only">{`Grupos de B/L em ${DEMURRAGE_DIVISION_LABELS[division]}; cada linha abre os containers`}</caption>
                <thead>
                  <tr>
                    <th scope="col"><span className="sr-only">Abrir containers</span></th>
                    <th scope="col">B/L</th>
                    <th scope="col" className="app-table__text-head">Cliente</th>
                    <th scope="col">Navio / Viagem</th>
                    <th scope="col">Containers</th>
                    <th scope="col">US$ previsto hoje</th>
                    <th scope="col" className="app-table__text-head">Próximo passo / motivo</th>
                    <th scope="col"><span className="sr-only">Ações</span></th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((group) => {
                    const blId = group.anchor_bl_id
                    const open = expanded.has(blId)
                    const panelId = `dem-bl-${blId}`
                    const counts = boxCounts(group)
                    const others = group.bl_ids.filter((id) => id !== blId)
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
                          <td className="app-dem-code">
                            <BlLink blId={blId} />
                            {others.length ? <span className="app-dem-meta block" title={others.join(', ')}>+ {others.length} B/L do grupo</span> : null}
                          </td>
                          <td className="app-table__text" title={group.customer_name ?? undefined}>{group.customer_name ?? <StatusText tone="warning">Cliente não vinculado</StatusText>}</td>
                          <td>{group.voyage_label ?? <NoValue label="Sem viagem" />}</td>
                          <td className="tabular-nums" title="Fora · devolvidos · total do grupo">{counts.out} fora · {counts.returned} devolvidos · {counts.total}</td>
                          <td className="tabular-nums">{group.usd > 0 ? <StatusText tone={division === 'travado' ? 'danger' : 'warning'}>{fmtUSD(group.usd)}</StatusText> : <NoValue label="Sem valor calculado" />}</td>
                          <td className="app-table__text app-table__text--wrap"><NextStepText group={group} /></td>
                          <td className="app-dem-row-action">
                            <NextStepAction group={group} canIssue={canIssue} generatingBl={generatingBl} onGenerateInvoice={onGenerateInvoice} iconOnly />
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
                              <table className="app-table app-table--compact app-dem-table">
                                <caption className="sr-only">Containers do grupo do B/L {blId}</caption>
                                <thead>
                                  <tr>
                                    <th scope="col">Container</th>
                                    <th scope="col">B/L</th>
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
                                  {group.boxes.map((box) => (
                                    <tr key={box.container_id}>
                                      <td className="app-dem-code app-dem-strong"><CopyValue value={box.container_number} label="número do contêiner" /></td>
                                      <td className="app-dem-code">{box.bl_id}</td>
                                      <td>{box.type ?? <NoValue label="Sem tipo" />}</td>
                                      <td className="tabular-nums">{box.discharge_date ? formatDate(box.discharge_date) : <NoValue label="Sem data de descarga" />}</td>
                                      <td className="tabular-nums">{box.return_date ? formatDate(box.return_date) : <NoValue label="Não devolvido" />}</td>
                                      <td className="tabular-nums">{box.total_days == null ? <NoValue label="Sem descarga" /> : overFree(box) ? <StatusText tone="warning">{box.total_days}</StatusText> : box.total_days}</td>
                                      <td className="tabular-nums" title={box.free_source ? `Free time ${FREE_TIME_SOURCE_LABELS[box.free_source]}` : undefined}>{box.free_days ?? <NoValue label="Sem free time: tipo sem tarifa" />}</td>
                                      <td className="tabular-nums">{periodValue(box.days_p1, box.rate_p1_usd)}</td>
                                      <td className="tabular-nums">{periodValue(box.days_p2, box.rate_p2_usd)}</td>
                                      <td><BoxUsd box={box} onOpenInvoice={onOpenInvoice} /></td>
                                      <td className="app-dem-row-action">
                                        <div className="app-dem-row-buttons">
                                          <RowActionButton
                                            label={`Editar datas de ${box.container_number}`}
                                            icon={CalendarDays}
                                            disabled={generatingBl === blId}
                                            onClick={() => onEditContainer(box, group)}
                                          />
                                          {onWaiveBox && canWaiveBox(box) && group.customer_id != null ? (
                                            <RowActionButton
                                              label={`Dispensar cobrança de ${box.container_number}`}
                                              icon={Ban}
                                              disabled={generatingBl === blId}
                                              onClick={() => onWaiveBox(box, group)}
                                            />
                                          ) : null}
                                        </div>
                                      </td>
                                    </tr>
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

function BlLink({ blId }: { blId: string }) {
  return (
    <CopyValue value={blId} label="número do B/L">
      <Link to={`/bls/${encodeURIComponent(blId)}?tab=faturamento`} className="app-dem-link app-dem-strong">{blId}</Link>
    </CopyValue>
  )
}

function overFree(box: BoardBox) {
  return box.total_days != null && box.free_days != null && box.total_days > box.free_days
}

/** "9 × US$ 30,00", como na fatura do Portal; "—" sem dias no período. */
function periodValue(days: number | null, rate: number | null) {
  return days && rate != null && days > 0 ? `${days} × ${fmtUSD(rate)}` : <NoValue label="Sem dias neste período" />
}

function BoxUsd({ box, onOpenInvoice }: { box: BoardBox; onOpenInvoice: (id: number) => void }) {
  if (box.state === 'covered' && box.covered_by != null) {
    return (
      <span className="app-dem-meta">
        cobrada em{' '}
        <button type="button" className="app-dem-link app-dem-code" onClick={() => onOpenInvoice(box.covered_by!)}>{box.covered_doc ?? `#${box.covered_by}`}</button>
      </span>
    )
  }
  if (box.state === 'waived') return <span className="app-dem-meta">cobrança dispensada</span>
  if (box.state === 'no_rate') return <StatusText tone="danger">Tipo sem tarifa</StatusText>
  if (box.state === 'no_discharge') return <NoValue label="Sem descarga" />
  if (box.state === 'in_free_time') return <span className="app-dem-meta">no free time{box.last_free_day ? ` até ${formatDate(box.last_free_day)}` : ''}</span>
  if (box.state === 'returned_free') return <NoValue label="Devolvido no free time" />
  return <span className="tabular-nums">{fmtUSD(box.usd ?? 0)}</span>
}

/** Próximo passo ou motivo, em texto (D5); o aviso do que vai travar a emissão em âmbar. */
function NextStepText({ group }: { group: BoardGroup }) {
  const step = nextStep(group)
  const warning = group.warning ? <span className="block"><StatusText tone="warning">{group.warning}</StatusText></span> : null
  if (step.kind === 'generate') {
    return <>{step.complement ? 'O grupo já tem Invoice: gerar a complementar das caixas sem Invoice' : 'Pronto para gerar a Invoice'}</>
  }
  if (step.kind === 'link') return <><StatusText tone="danger">{step.note}</StatusText> <Link className="app-link" to={step.href}>{step.label}</Link></>
  if (step.kind === 'note') return <StatusText tone="danger">{step.text}</StatusText>
  return <>{step.text}{warning}</>
}

function NextStepAction({
  group,
  canIssue,
  generatingBl,
  onGenerateInvoice,
  iconOnly = false,
}: {
  group: BoardGroup
  canIssue: boolean
  generatingBl: string | null
  onGenerateInvoice: (blId: string) => void
  iconOnly?: boolean
}) {
  const step = nextStep(group)
  // Gerar Invoice só onde o banco aceita: A emitir (D4).
  if (step.kind !== 'generate' || !canIssue) return null
  const blId = group.anchor_bl_id
  const label = step.complement ? `Gerar Invoice complementar do B/L ${blId}` : `Gerar Invoice do B/L ${blId}`
  if (iconOnly) {
    return (
      <RowActionButton
        label={label}
        icon={step.complement ? FilePlus2 : FileText}
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
      aria-label={label}
    >
      <FileText size={14} aria-hidden="true" />
      {step.complement ? 'Gerar complementar' : 'Gerar Invoice'}
    </Button>
  )
}
