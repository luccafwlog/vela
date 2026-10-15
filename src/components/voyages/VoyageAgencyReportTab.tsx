import { useState, type ReactNode } from 'react'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { NoValue } from '../ui/NoValue'
import { AgencyReportDocument, buildAgencyReportPrintFilename } from './AgencyReportDocument'
import { Block, Fact, FactList, LeadValue } from '../ui/Block'
import { StatusText } from '../ui/StatusText'
import { SignoffControl } from './SignoffControl'
import { DepartmentSignoffControl } from './DepartmentSignoffControl'
import { AgencyReportTimeline } from './AgencyReportTimeline'
import {
  useAgencyReportDepartmentSignoffEvents,
  useAgencyReportAtdRegisteredAt,
  useAgencyReportDerived,
  useAgencyReportOwn,
  useAgencyReportTerminalState,
  useAgencyReportSignoffEvents,
  useCloseAgencyReport,
  useReopenAgencyReport,
  useSetAgencyReportDepartmentSignoff,
  useSetAgencyReportSectionObservation,
  useSetAgencyReportSignoff,
  useSetAgencyReportTerminal,
} from '../../hooks/useAgencyReport'
import {
  AGENCY_REPORT_SECTIONS,
  AGENCY_REPORT_SECTION_ORDER,
  AGENCY_REPORT_DEPARTMENT_LABELS,
  blBelongsToTerminal,
  buildContainerTypeMatrix,
  summarizeBreakbulk,
  type AgencyReportBlTerminal,
  filterDepartmentReopeningEvents,
  groupEmptyEmbarkBookings,
  isTransshipmentContainer,
  MATRIX_CATEGORY_LABELS,
  groupVehiclesByBrand,
  summarizeVehiclesByContainerTypeAndModel,
  signoffLabels,
  type AgencyReportSection,
  type AgencyReportSignoffEvent,
  type SignoffState,
} from '../../services/agencyDepartureReport'
import { calculateAgencyReportDeadlineAt, formatAgencyReportInstant, toDateOnly } from '../../services/agencyReportDeadline'
import type { AgencyReportDepartmentKey, Json } from '../../types/database'
import type { AdrEscalaPod } from '../../services/voyageSummaries'
import { formatBRL, formatDate, formatDateTimeBR } from '../../lib/utils'
import { normalizePortCode } from '../../services/portCode'
import { useAuth } from '../../hooks/useAuth'
import { useToast } from '../ui/Toast'
import { useConfirm } from '../ui/ConfirmDialog'

const DEPARTMENTS: AgencyReportDepartmentKey[] = ['operacoes', 'documentacao', 'equipamentos']

type Props = {
  voyageId: number
  voyageLabel: string
  carrierName: string
  pods: AdrEscalaPod[]
  initialEscala?: string
  reportId?: string | null
  terminalCode?: string | null
  readOnly?: boolean
}

const OPERATION_FRONT_LABELS: Record<string, string> = {
  'importacao:carga_cheia': 'Carga cheia',
  'importacao:carga_solta': 'Carga solta',
  'importacao:vazio': 'Vazios IMP',
  'importacao:veiculo': 'Veículos',
  'exportacao:granito': 'Granito',
  'exportacao:vazio': 'Vazios EXP',
}

// B8: ADR fechado antes do campo atdRegisteredAt no snapshot. O registro ao vivo
// só vale se o ATD vigente for o mesmo congelado; ATD corrigido depois não mostra "registrado em".
function closedAtdRegisteredAt(
  header: { unifiedAtd?: string | null; atdRegisteredAt?: string | null } | null | undefined,
  liveAtd: string | null,
  liveRegisteredAt: string | null,
): string | null {
  if (header?.atdRegisteredAt) return header.atdRegisteredAt
  const frozenAtd = header?.unifiedAtd ?? null
  if (frozenAtd == null) return liveRegisteredAt
  if (liveAtd == null) return null
  const sameAtd = frozenAtd === liveAtd || (Date.parse(frozenAtd) === Date.parse(liveAtd) && !Number.isNaN(Date.parse(liveAtd)))
  return sameAtd ? liveRegisteredAt : null
}

function operationFrontLabel(front: string) {
  return OPERATION_FRONT_LABELS[front] ?? front
}

function ReportSection({
  title,
  section,
  state,
  attribution,
  canSignoff,
  events,
  actorNames,
  isPending,
  onSignoff,
  observation,
  onObservationChange,
  terminalView,
  children,
}: {
  title: string
  section?: AgencyReportSection
  state?: SignoffState
  attribution?: string | null
  canSignoff?: boolean
  events?: AgencyReportSignoffEvent[]
  actorNames?: Record<string, string>
  isPending?: boolean
  onSignoff?: (section: AgencyReportSection, state: SignoffState, justification?: string) => void
  observation?: string | null
  onObservationChange?: (section: AgencyReportSection, observation: string) => void
  terminalView?: { assigned: boolean; state: 'operated' | 'nothing_operated'; fronts?: string[] }
  children: ReactNode
}) {
  const showTerminalContent = !terminalView || (terminalView.assigned && terminalView.state === 'operated')
  // Seção é um bloco dentro do bloco do departamento: frentes, resolução e
  // observação na faixa; o conteúdo operado no corpo.
  return (
    <Block
      title={title}
      headingLevel={3}
      aside={<span className="flex flex-wrap items-center justify-end gap-2">
        {terminalView?.fronts?.length ? <span>{terminalView.fronts.join(' · ')}</span> : null}
        {section && state ? <>
          <SectionObservationAction
            section={section}
            title={title}
            observation={observation}
            canEdit={Boolean(canSignoff)}
            onChange={onObservationChange}
          />
          <SignoffControl
            section={section}
            sectionLabel={title}
            state={state}
            attribution={attribution}
            departmentLabel={AGENCY_REPORT_DEPARTMENT_LABELS[AGENCY_REPORT_SECTIONS[section]]}
            canSignoff={Boolean(canSignoff)}
            events={events ?? []}
            actorNames={actorNames ?? {}}
            isPending={isPending}
            compact
            onChange={(nextSection, nextState, justification) => onSignoff?.(nextSection, nextState, justification)}
          />
        </> : null}
      </span>}
    >
      <div className="grid gap-3">
        {showTerminalContent ? children : <NadaOperado>{terminalView?.assigned ? 'Nada operado nesta frente.' : 'Não há frente atribuída a este terminal.'}</NadaOperado>}
        {section ? <SectionObservation observation={observation} /> : null}
      </div>
    </Block>
  )
}

function SectionObservationAction({
  section,
  title,
  observation,
  canEdit,
  onChange,
}: {
  section: AgencyReportSection
  title: string
  observation?: string | null
  canEdit: boolean
  onChange?: (section: AgencyReportSection, observation: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(observation ?? '')
  const confirm = useConfirm()
  const text = observation?.trim() ?? ''

  async function confirmSave() {
    const before = observation ?? ''
    if (draft === before) {
      setEditing(false)
      return
    }
    const confirmed = await confirm({
      title: `Confirmar observação — ${title}`,
      message: `Salvar a observação desta seção do ADR?`,
      confirmLabel: text ? 'Salvar alterações' : 'Salvar observação',
      changes: [{ field: 'Observação', before: before || '—', after: draft || '—' }],
      consequence: 'A observação passa a integrar o histórico do ADR e o relatório desta escala.',
      reversibility: 'Edite novamente para corrigir a observação; a Auditoria preserva a mudança.',
    })
    if (!confirmed) return
    onChange?.(section, draft)
    setEditing(false)
  }

  if (!canEdit) return null

  if (editing) {
    return (
      <Modal open onClose={() => setEditing(false)} title={`${text ? 'Editar' : 'Adicionar'} observação — ${title}`}>
        <div className="grid gap-4">
          <textarea
            key={`${section}:${observation ?? ''}`}
            aria-label={`Observação — ${title}`}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            autoFocus
            className="min-h-32 w-full rounded-lg border border-[var(--app-border)] bg-[var(--app-surface)] p-3 text-sm"
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setEditing(false)}>Voltar</Button>
            <Button
              type="button"
              variant="primary"
              disabled={draft === (observation ?? '')}
              onClick={() => void confirmSave()}
            >
              {text ? 'Salvar alterações' : 'Salvar observação'}
            </Button>
          </div>
        </div>
      </Modal>
    )
  }

  return (
    <Button
      type="button"
      variant="secondary"
      className="app-btn--sm"
      onClick={() => { setDraft(observation ?? ''); setEditing(true) }}
    >
      {text ? 'Editar observação' : 'Adicionar observação'}
    </Button>
  )
}

// A observação é conteúdo do relatório, não um campo de formulário sempre
// aberto (ADR 0036): quando existe texto, ele é lido por todo mundo; quando
// não existe, só o dono da seção vê o convite para escrever. Quem não pode
// assinar nunca mais vê um "—" ocupando espaço por uma nota que ninguém deixou.
function SectionObservation({
  observation,
}: {
  observation?: string | null
}) {
  const [expanded, setExpanded] = useState(false)
  const text = observation?.trim() ?? ''

  if (!text) return null

  return (
    <div className="grid gap-1.5 rounded-r-lg border-l-[3px] border-[var(--app-border-strong)] bg-[var(--app-surface-muted)] px-3 py-2.5 text-sm">
      <span className="text-xs font-semibold text-[var(--app-muted)]">Observação</span>
      <p className={`whitespace-pre-line text-[var(--app-text)] ${expanded ? '' : 'max-h-24 overflow-hidden'}`}>{text}</p>
      {text.split('\n').length > 4 || text.length > 200 ? (
        <Button variant="secondary" className="app-btn--sm justify-self-start" onClick={() => setExpanded((value) => !value)}>
          {expanded ? 'Recolher observação' : 'Ver observação completa'}
        </Button>
      ) : null}
    </div>
  )
}

// Parte de uma seção que tem resolução única (ADR 0036): "Embarque de vazios"
// mostra as unidades embarcadas e a operação de pátio como dois blocos de
// conteúdo, sem dois sign-offs para o mesmo fato.
function Subsection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="grid gap-3 border-t border-[var(--app-border)] pt-4 first:border-t-0 first:pt-0">
      <h4 className="text-sm font-semibold text-[var(--app-text)]">{title}</h4>
      {children}
    </div>
  )
}

// Substitui o número zero + placeholder genérico de uma seção inteira sem
// ocorrência (Task 4 do ADR 2026-07-31, aplicado a todas as seções de carga
// — inclusive Granito, revisão pós-merge): a seção continua exigindo
// resolução (o controle de sign-off é um irmão desta linha, não é afetado).
function NadaOperado({ children = 'Nada operado nesta escala.' }: { children?: ReactNode }) {
  return <p className="m-0 text-sm text-[var(--app-muted)]">{children}</p>
}

// Aviso de divergência entre fontes (Task 3 calculou os números; Task 4
// exibe). Não é bloqueante — só sinaliza que a Conciliação Baplie × B/L
// precisa revisar o item.
function DivergenceWarning({ children }: { children: ReactNode }) {
  return <div className="app-callout flex items-start gap-2 border-[var(--app-red)] bg-[var(--app-red-soft)] text-xs leading-5 text-[var(--app-red)]"><span aria-hidden="true">!</span><span><strong>Divergência</strong> — {children}</span></div>
}

// Aviso de dado órfão (Task 10 do ADR 2026-07-31): granito ou Embarque de
// Vazios lançado num porto que não é escala nenhuma da viagem. Reaproveita o
// wrapper do DivergenceWarning — informativo, não bloqueia sign-off nem
// fechamento — em vez de redeclarar o mesmo <p>, para ter um só lugar onde
// mudar o estilo visual do aviso.
function OrphanDataWarning({ entries, label }: { entries: Array<{ port: string; count: number }>; label: string }) {
  if (!entries.length) return null
  const text = `${entries.map((entry) => `${entry.count} ${label} em ${entry.port}`).join('; ')} — porto não é escala desta viagem, verificar o cadastro.`
  return <div className="app-callout app-callout--warning flex items-start gap-2 text-xs leading-5"><span aria-hidden="true">!</span><span><strong>Dado órfão</strong> — {text}</span></div>
}

function ContainerNatureTable({ rows }: { rows: Record<string, Record<string, number>> }) {
  const natureKeys = ['carga_geral', 'imo', 'oog']
  const labels: Record<string, string> = { carga_geral: 'Carga geral', imo: 'IMO', oog: 'OOG' }
  const types = Object.keys(rows).sort((a, b) => a.localeCompare(b))
  const totals = natureKeys.map((key) => types.reduce((sum, type) => sum + (rows[type]?.[key] ?? 0), 0))
  const total = totals.reduce((sum, value) => sum + value, 0)

  if (!types.length) return <NadaOperado />

  return (
    <div className="app-table-scroll">
      <table className="app-table app-table--compact app-table--nested" aria-label="Contêineres por tipo e natureza">
        <thead><tr><th scope="col">Tipo</th>{natureKeys.map((key) => <th key={key} scope="col">{labels[key]}</th>)}<th scope="col">Total</th></tr></thead>
        <tbody>
          {types.map((type) => {
            const values = natureKeys.map((key) => rows[type]?.[key] ?? 0)
            return <tr key={type}><td>{type}</td>{values.map((value, index) => <td key={natureKeys[index]}>{value}</td>)}<td>{values.reduce((sum, value) => sum + value, 0)}</td></tr>
          })}
        </tbody>
        <tfoot><tr><th scope="row">Total</th>{totals.map((value, index) => <td key={natureKeys[index]}>{value}</td>)}<td>{total}</td></tr></tfoot>
      </table>
    </div>
  )
}

export function VoyageAgencyReportTab({ voyageId, voyageLabel, carrierName, pods, initialEscala, reportId: initialReportId, terminalCode: initialTerminalCode, readOnly = false }: Props) {
  const { showToast } = useToast()
  const confirm = useConfirm()
  const initialPortCode = normalizePortCode(initialEscala)
  const initialPort = initialPortCode && pods.some((entry) => normalizePortCode(entry.pod) === initialPortCode) ? initialPortCode : (normalizePortCode(pods[0]?.pod) ?? null)
  const [port, setPort] = useState<string | null>(initialPort)
  const [selectedReportId, setSelectedReportId] = useState<string | null>(initialReportId ?? null)
  const { data: terminalState, isLoading: isTerminalStateLoading, error: terminalStateError } = useAgencyReportTerminalState(voyageId, port)
  const terminalStateReady = Boolean(terminalState) && !isTerminalStateLoading && !terminalStateError
  const terminalReports = terminalStateReady ? (terminalState?.agencyReports ?? []) : []
  const preferredReportId = initialReportId && terminalReports.some((report) => report.reportId === initialReportId)
    ? initialReportId
    : initialTerminalCode
      ? terminalReports.find((report) => report.terminalCode === initialTerminalCode)?.reportId
      : undefined
  const effectiveSelectedReportId = selectedReportId && terminalReports.some((report) => report.reportId === selectedReportId)
    ? selectedReportId
    : preferredReportId ?? terminalReports[0]?.reportId ?? null
  const selectedTerminalReport = terminalReports.find((report) => report.reportId === effectiveSelectedReportId)
  const terminalizedReports = terminalReports.filter((report) => Boolean(report.terminalId))
  // ADR legado continua sendo lido/alterado pelo caminho legado, mesmo quando
  // a mesma escala também possui ADRs terminalizados. Só um relatório com
  // terminal_id pode alimentar as RPCs *_by_report_id.
  const resolvedReportId = selectedTerminalReport?.terminalId ? selectedTerminalReport.reportId : null
  const resolvedTerminalCode = selectedTerminalReport?.terminalCode ?? initialTerminalCode ?? null
  const resolvedTerminalName = selectedTerminalReport?.terminal ?? null
  const terminalViewFor = (section: AgencyReportSection) => {
    if (!resolvedReportId) return undefined
    const selected = selectedTerminalReport?.sections.find((item) => item.section === section)
    return {
      assigned: Boolean(selected?.fronts.length),
      state: selected?.state ?? 'nothing_operated' as const,
      fronts: selected?.frontKeys?.length
        ? selected.frontKeys.map(operationFrontLabel)
        : (selected?.fronts ?? []).map((front) => operationFrontLabel(front)),
    }
  }
  const selectedSectionFronts = (section: AgencyReportSection) => {
    const selected = selectedTerminalReport?.sections.find((item) => item.section === section)
    // `frontKeys` retains (sentido, modalidade); `fronts` is the legacy
    // presentation fallback for reports loaded before this projection field.
    return selected?.frontKeys ?? selected?.fronts ?? []
  }
  const sectionIsVisible = (section: AgencyReportSection) => !resolvedReportId || selectedSectionFronts(section).length > 0
  const { data, isLoading, error } = useAgencyReportDerived(voyageId, port)
  const { data: ownData } = useAgencyReportOwn(voyageId, port, resolvedReportId)
  const { data: signoffEvents } = useAgencyReportSignoffEvents(voyageId, port, resolvedReportId)
  const { data: departmentSignoffEvents } = useAgencyReportDepartmentSignoffEvents(voyageId, port, resolvedReportId)
  // B8: momento do registro do ATD da Atracação do terminal selecionado (mesma escolha de `selectedAtracacao`, abaixo).
  const atdTerminalId = selectedTerminalReport?.terminalId ?? null
  const atdForTimeline = atdTerminalId ? data?.terminalSchedules?.find((entry) => entry.terminalId === atdTerminalId)?.atd ?? null : null
  const { data: terminalAtdRegisteredAt } = useAgencyReportAtdRegisteredAt(voyageId, port, atdTerminalId, atdForTimeline)
  const { effectiveRole, isAdmin } = useAuth()
  const canEditOperations = !readOnly && (isAdmin || effectiveRole === 'operacoes')
  const signoffMutation = useSetAgencyReportSignoff(resolvedReportId)
  const departmentSignoffMutation = useSetAgencyReportDepartmentSignoff(resolvedReportId)
  const observationMutation = useSetAgencyReportSectionObservation(resolvedReportId)
  const closeMutation = useCloseAgencyReport(resolvedReportId)
  const reopenMutation = useReopenAgencyReport(resolvedReportId)
  const terminalMutation = useSetAgencyReportTerminal()
  const [printOpen, setPrintOpen] = useState(false)
  const [reopenOpen, setReopenOpen] = useState(false)
  const [reopenJustification, setReopenJustification] = useState('')
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false)
  const [terminalDraft, setTerminalDraft] = useState('')
  const terminalDraftSourceKey = [
    ownData?.id ?? 'none',
    ownData?.terminal ?? '',
    selectedTerminalReport?.reportId ?? 'none',
    selectedTerminalReport?.terminal ?? '',
  ].join(':')
  const [previousTerminalDraftSourceKey, setPreviousTerminalDraftSourceKey] = useState<string | null>(null)
  if (terminalDraftSourceKey !== previousTerminalDraftSourceKey) {
    setPreviousTerminalDraftSourceKey(terminalDraftSourceKey)
    setTerminalDraft(ownData?.terminal ?? selectedTerminalReport?.terminal ?? '')
  }

  if (!pods.length) {
    return <div className="app-panel app-panel--padded text-sm text-[var(--app-muted)]">Nenhuma escala ativa para compor o ADR.</div>
  }

  // O seletor de escalas fica visível, senão uma escala TBC ou com erro de carga prende a aba.
  const escalaSelector = (
    <div className="flex flex-wrap items-center gap-2" aria-label="Selecionar escala ADR" role="group">
      <span className="text-xs font-semibold text-[var(--app-muted)]">Escala</span>
      {pods.map(({ pod, omitted }) => (
        <Button key={pod} variant={port === pod ? 'primary' : 'secondary'} aria-pressed={port === pod} onClick={() => setPort(pod)} className="app-btn--sm">
          {pod}
          {omitted ? (
            <span
              className={`rounded-full px-1.5 py-0.5 text-xs font-semibold ${port === pod ? 'bg-white/20 text-white' : 'bg-[var(--app-surface-muted)] text-[var(--app-muted)]'}`}
              title="Escala omitida — o navio não atracou neste porto; ADR mantido apenas como registro fechado."
            >
              Omitida
            </span>
          ) : null}
        </Button>
      ))}
    </div>
  )
  if (terminalStateError) {
    return (
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
        {escalaSelector}
        <div className="app-panel app-panel--padded text-sm text-[var(--app-red)]">Não foi possível carregar frentes, terminais e ADRs da escala. Nenhuma ação foi habilitada.</div>
      </div>
    )
  }

  if (isTerminalStateLoading || !terminalState) {
    return <div className="app-panel app-panel--padded text-sm text-[var(--app-muted)]">Carregando frentes, terminais e ADRs da escala…</div>
  }

  // B6 (migration 259): escala com frente de operação é do modelo terminalizado.
  // Sem terminal atribuído (frentes TBC) e sem ADR já existente, não há ADR a
  // abrir — o caminho legado por porto não é oferecido.
  if ((terminalState.fronts ?? []).length > 0 && terminalReports.length === 0) {
    return (
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
        {escalaSelector}
        <div className="app-panel app-panel--padded text-sm text-[var(--app-muted)]" role="status">Nenhum terminal atribuído às frentes desta escala (TBC). Atribua o terminal na edição da escala para abrir o ADR do terminal.</div>
      </div>
    )
  }

  // Dados operacionais continuam sendo consultados por escala, mas um ADR
  // terminalizado precisa mostrar somente as frentes atribuídas ao terminal
  // selecionado. Sem este recorte, dois terminais da mesma escala imprimem o
  // mesmo conteúdo e o sign-off deixa de ser auditável.
  // B2 (ADR 0068): no ADR terminalizado, a Carga descarregada é só a dos B/Ls
  // deste terminal — a exceção de terminal do B/L vence a frente.
  const cargoTerminalId = resolvedReportId ? selectedTerminalReport?.terminalId ?? null : null
  const belongsHere = (bl: AgencyReportBlTerminal) => !cargoTerminalId || blBelongsToTerminal(bl, terminalState.fronts ?? [], cargoTerminalId)
  const containers = sectionIsVisible('carga_descarregada')
    ? (data?.containers ?? []).filter((container) => !cargoTerminalId || (container.blTerminals ?? []).some(belongsHere))
    : []
  const cargaSolta = !sectionIsVisible('carga_descarregada') ? undefined
    : cargoTerminalId && data?.cargaSoltaBls
      ? {
          ...summarizeBreakbulk(data.cargaSoltaBls.finalDestination.filter((bl) => belongsHere({ terminal_id: bl.terminal_id ?? null, cargo_mode: bl.cargo_mode ?? null }))),
          transshipment: summarizeBreakbulk(data.cargaSoltaBls.transshipment.filter((bl) => belongsHere({ terminal_id: bl.terminal_id ?? null, cargo_mode: bl.cargo_mode ?? null }))),
        }
      : data?.cargaSolta
  const vaziosImp = sectionIsVisible('vazios_descarregados') ? (data?.vaziosImp ?? []) : []
  const vaziosExp = sectionIsVisible('vazios_embarcados') ? (data?.vaziosExp ?? []) : []
  const vehiclesData = sectionIsVisible('veiculos') ? (data?.vehicles ?? []) : []
  const graniteData = sectionIsVisible('carga_carregada') ? (data?.granite ?? []) : []
  const imoCount = containers.filter((container) => container.is_imo).length
  const dischargeMatrix = buildContainerTypeMatrix(containers.map((container) => ({
    type: container.size_type ?? '—',
    category: container.category,
  })))
  // Transbordo deixou de ser uma categoria da matriz (natureza e destino são
  // eixos independentes), então o split de destino precisa viajar junto do
  // snapshot: sem ele o ADR fechado/impresso perde um número que a aba mostra.
  // `cargaDescarregada` continua sendo a mesma seção da allowlist de
  // `close_agency_departure_report` (migration 249) — só ganha campos irmãos
  // de `rows`/`totals`.
  const dischargeTransshipmentCount = containers.filter(isTransshipmentContainer).length
  const dischargeDestination = {
    destinoFinal: containers.length - dischargeTransshipmentCount,
    transbordo: dischargeTransshipmentCount,
  }
  const emptyDischargeMatrix = buildContainerTypeMatrix(vaziosImp.map((container) => ({
    type: container.container_type ?? '—',
    category: container.natureza === 'cama' ? 'vazio_cama' : container.natureza === 'cover_plate' ? 'vazio_cover_plate' : 'vazio',
  })))
  const emptyEmbarkRows = groupEmptyEmbarkBookings(vaziosExp.map((booking) => ({
    type: booking.container_type ?? '—',
    condition: booking.condition,
    localLabel: booking.local?.name ?? booking.local?.code ?? null,
  })))
  // Duas leituras lado a lado do mesmo embarque de vazios: total por tipo (sem
  // quebra por local) e o mesmo total por tipo dentro de cada depot/terminal —
  // emptyEmbarkRows já soma por (tipo, condição, local); aqui só reagrupamos
  // sem duplicar a consulta.
  const emptyEmbarkByType = new Map<string, number>()
  const emptyEmbarkByLocal = new Map<string, Map<string, number>>()
  for (const row of emptyEmbarkRows) {
    emptyEmbarkByType.set(row.type, (emptyEmbarkByType.get(row.type) ?? 0) + row.quantity)
    const localKey = row.localLabel || '—'
    const byType = emptyEmbarkByLocal.get(localKey) ?? new Map<string, number>()
    byType.set(row.type, (byType.get(row.type) ?? 0) + row.quantity)
    emptyEmbarkByLocal.set(localKey, byType)
  }
  const emptyEmbarkTypeTotals = [...emptyEmbarkByType.entries()].sort(([a], [b]) => a.localeCompare(b))
  const emptyEmbarkLocalTotals = [...emptyEmbarkByLocal.entries()]
    .map(([localLabel, byType]) => ({
      localLabel,
      types: [...byType.entries()].sort(([a], [b]) => a.localeCompare(b)),
    }))
    .sort((a, b) => a.localLabel.localeCompare(b.localLabel))
  const vehicles = groupVehiclesByBrand(vehiclesData)
  const vehicleBreakdown = summarizeVehiclesByContainerTypeAndModel(vehiclesData.map((vehicle) => ({
    chassis: vehicle.chassis,
    model: vehicle.model,
    containerNumber: vehicle.container?.container_number ?? null,
    containerType: vehicle.container?.type ?? null,
  })))
  const vehicleVinTotal = vehicles.reduce((total, vehicle) => total + vehicle.vinCount, 0)
  const vehicleLocations = new Map<string, string[]>()
  for (const vehicle of vehiclesData) {
    const locations = vehicleLocations.get(vehicle.brand) ?? []
    const location = vehicle.container?.unpacking_location
    if (location && !locations.includes(location)) locations.push(location)
    vehicleLocations.set(vehicle.brand, locations)
  }
  const bookings = vaziosExp
  const depots = [...new Set(bookings
    .filter((booking) => booking.local?.tipo === 'depot')
    .map((booking) => booking.local?.name ?? booking.local?.code)
    .filter(Boolean))]
  const directEmbarkCount = bookings.filter((booking) => booking.local?.tipo === 'terminal_portuario').length
  // A subseção de pátio só afirma "nada" quando nenhuma das suas fontes tem
  // dado — storage, embarque direto, locais ou linhas de serviço.
  const hasPatioOperation = Boolean(
    (sectionIsVisible('vazios_embarcados') && data?.storage.days) || (sectionIsVisible('vazios_embarcados') && data?.storage.containers) || directEmbarkCount || depots.length || (sectionIsVisible('vazios_embarcados') && data?.costs?.serviceLines?.length),
  )
  const granite = {
    bls: graniteData.length,
    blocks: graniteData.reduce((total, item) => total + (item.blocks_qty ?? 0), 0),
    weightTon: graniteData.reduce((total, item) => total + (item.real_weight_kg ?? 0), 0) / 1000,
  }
  const cargaSoltaTransshipment = cargaSolta?.transshipment ?? { bls: 0, machines: 0, packages: 0, weightTon: 0, cbm: 0 }
  const cargaSoltaTotal = cargaSolta ? {
    bls: cargaSolta.bls + cargaSoltaTransshipment.bls,
    weightTon: cargaSolta.weightTon + cargaSoltaTransshipment.weightTon,
  } : null
  const signoffs = new Map((ownData?.signoffs ?? []).map((signoff) => [signoff.section, signoff.state]))
  const sectionState = (section: AgencyReportSection) => signoffs.get(section) ?? 'pending'
  const actorNames = ownData?.actor_names ?? {}
  const signoffRows = new Map((ownData?.signoffs ?? []).map((signoff) => [signoff.section, signoff]))
  const sectionAttribution = (section: AgencyReportSection): string | null => {
    const signoff = signoffRows.get(section)
    if (!signoff || signoff.state === 'pending' || !signoff.signed_at) return null
    const name = (signoff.signed_by && actorNames[signoff.signed_by]) || null
    return `${signoffLabels[signoff.state]} por ${name ?? '—'} em ${formatDate(signoff.signed_at)}`
  }
  const canSignoff = (section: AgencyReportSection) => !readOnly && (isAdmin || effectiveRole === AGENCY_REPORT_SECTIONS[section])
  const updateSignoff = (section: AgencyReportSection, state: SignoffState, justification?: string) => {
    if (!readOnly && port) signoffMutation.mutate({ voyageId, port, section, state, justification })
  }
  const updateObservation = (section: AgencyReportSection, observation: string) => {
    if (!readOnly && port) observationMutation.mutate({ voyageId, port, section, observation })
  }
  const eventsBySection = (section: AgencyReportSection) => (signoffEvents ?? []).filter((event) => event.section === section)

  const departmentSignoffs = new Map((ownData?.departmentSignoffs ?? []).map((row) => [row.department, row]))
  const sectionsOf = (department: AgencyReportDepartmentKey) =>
    AGENCY_REPORT_SECTION_ORDER.filter((section) => AGENCY_REPORT_SECTIONS[section] === department)
  const departmentSectionsPending = (department: AgencyReportDepartmentKey) =>
    sectionsOf(department).some((section) => sectionState(section) === 'pending')
  const isDepartmentSigned = (department: AgencyReportDepartmentKey) => Boolean(departmentSignoffs.get(department)?.signed_at)
  const departmentAttribution = (department: AgencyReportDepartmentKey): string | null => {
    const row = departmentSignoffs.get(department)
    if (!row?.signed_at) return null
    const name = (row.signed_by && actorNames[row.signed_by]) || null
    return `Assinado por ${name ?? '—'} em ${formatDate(row.signed_at)}`
  }
  const canSignDepartment = (department: AgencyReportDepartmentKey) => !readOnly && (isAdmin || effectiveRole === department)
  const updateDepartmentSignoff = (department: AgencyReportDepartmentKey, signed: boolean, justification?: string) => {
    if (!readOnly && port) departmentSignoffMutation.mutate({ voyageId, port, department, signed, justification })
  }
  async function saveTerminal() {
    if (readOnly || !port) return
    const before = ownData?.terminal ?? selectedTerminalReport?.terminal ?? ''
    const after = terminalDraft.trim()
    if (after === before) return
    const confirmed = await confirm({
      title: 'Confirmar terminal do ADR',
      message: `Salvar ${after || 'sem terminal'} como terminal desta escala?`,
      confirmLabel: 'Salvar terminal',
      changes: [{ field: 'Terminal', before: before || '—', after: after || '—' }],
      consequence: 'O terminal identifica este ADR e orienta a leitura dos dados e dos prazos da escala.',
      reversibility: 'Edite novamente para corrigir o terminal.',
    })
    if (!confirmed) return
    terminalMutation.mutate({ voyageId, port, terminal: after }, {
      onSuccess: () => showToast('Terminal do ADR salvo.', 'success'),
      onError: (error) => showToast(error instanceof Error ? error.message : 'Falha ao salvar o terminal do ADR.', 'error'),
    })
  }
  const signedDepartmentsCount = DEPARTMENTS.filter(isDepartmentSigned).length
  const missingDepartmentLabels = DEPARTMENTS.filter((department) => !isDepartmentSigned(department)).map((department) => AGENCY_REPORT_DEPARTMENT_LABELS[department])

  // O relógio do ADR é da Atracação do terminal selecionado. ATA continua
  // sendo uma data própria da Escala; não há fallback para o ATD documental
  // do POL nem para a Atracação de outro terminal.
  const selectedAtracacao = selectedTerminalReport?.terminalId
    ? data?.terminalSchedules?.find((entry) => entry.terminalId === selectedTerminalReport.terminalId) ?? null
    : null
  const terminalAtd = selectedAtracacao?.atd ?? null
  const terminalAtb = selectedAtracacao?.atb ?? null
  const terminalRtw = selectedAtracacao?.rtw ?? null
  // Prazo: ATD + 72 horas (290). `deadlineDate` é o dia de Brasília do prazo, para o relatório de SLA e a impressão.
  const deadlineAt = terminalAtd ? calculateAgencyReportDeadlineAt(terminalAtd) : null
  const deadlineDate = deadlineAt ? toDateOnly(deadlineAt) : null

  // Reaberturas por departamento (com justificativa) — o predicado de
  // "o que é reabertura" vem de filterDepartmentReopeningEvents
  // (agencyDepartureReport.ts), a mesma regra usada por
  // buildDepartmentTimelineRows (AgencyReportTimeline.tsx); só o projeto após
  // o filtro difere aqui, porque o snapshot precisa apenas de (data, autor,
  // justificativa) em vez das linhas completas da Linha do Tempo (estado de
  // prazo incluso). Task 4 do ADR 0039: os marcos do fechamento vão dentro de
  // `departmentSignoffs`, chave de topo já liberada pela allowlist de
  // close_agency_departure_report — nenhuma chave nova é adicionada.
  const departmentReopenings = (department: AgencyReportDepartmentKey) =>
    filterDepartmentReopeningEvents(departmentSignoffEvents ?? [], department)
      .map((event) => ({
        changed_at: event.changed_at,
        changed_by: event.changed_by,
        justification: event.justification,
      }))

  const snapshot = {
    header: {
      carrierName,
      voyageLabel,
      port,
      terminal: resolvedTerminalName ?? ownData?.terminal ?? null,
      terminalCode: resolvedTerminalCode,
      reportId: resolvedReportId,
      terminalScope: resolvedReportId
        ? Object.fromEntries(AGENCY_REPORT_SECTION_ORDER.map((section) => [
            section,
            { assigned: section === 'datas' || selectedSectionFronts(section).length > 0 },
          ]))
        : null,
      schedule: {
        ata: data?.escala?.ata ?? data?.schedule?.ata ?? null,
        atb: terminalAtb,
        atd: terminalAtd,
        rtw: terminalRtw,
      },
      // ADR 0039: marcos do Prazo de Conclusão congelados no fechamento —
      // usados por Task 5 (relatório agregado de SLA) para recalcular
      // cumprimento/atraso históricos sem reconsultar audit_logs. Não são
      // impressos (AgencyReportDocument.tsx mostra só datas de assinatura).
      unifiedAtd: terminalAtd,
      atdRegisteredAt: terminalAtdRegisteredAt ?? null,
      atdSource: terminalAtd ? ('terminal' as const) : null,
      deadlineDate,
      deadlineAt,
    },
    sections: {
      cargaDescarregada: { ...dischargeMatrix, destino: dischargeDestination },
      cargaSolta: cargaSolta ?? null,
      vaziosDescarregados: emptyDischargeMatrix,
      veiculos: vehicles,
      // Task 4 do ADR 2026-07-31: passa a listar (tipo, condição, local) em
      // vez da matriz 2D com natureza fixa em 'carga_geral' (perdia condição e
      // local). Shape é EmptyEmbarkRow[] — o impresso (AgencyReportDocument.tsx)
      // lê via EmptyEmbarkTable/asEmptyEmbarkRows.
      vaziosEmbarcados: emptyEmbarkRows,
      vaziosUnidades: vaziosExp,
      vehicleLocations: Object.fromEntries(vehicleLocations),
      depots,
      directEmbarkCount,
      granito: granite,
      storage: sectionIsVisible('vazios_embarcados') ? data?.storage ?? null : null,
      operation: sectionIsVisible('vazios_embarcados') ? data?.operation ?? null : null,
      costs: sectionIsVisible('vazios_embarcados') ? data?.costs ?? null : null,
    },
    occurrences: ownData?.occurrences ?? [],
    signoffs: ownData?.signoffs ?? [],
    // Task 5 do ADR 2026-07-31: chave de topo irmã de `signoffs` — o impresso
    // fecha com os três sign-offs departamentais. Task 9 libera esta chave na
    // validação de fechamento (allowlist em close_agency_departure_report).
    // ADR 0039 (Task 4): cada linha ganha `reopenings` — reaberturas com
    // justificativa, mesmo dado impresso na Linha do Tempo, agora congelado
    // no snapshot para o relatório de SLA (Task 5) e para o impresso mostrar
    // a história de reabertura sem veredito de prazo.
    departmentSignoffs: (ownData?.departmentSignoffs ?? []).map((row) => ({
      ...row,
      reopenings: departmentReopenings(row.department),
    })),
  }
  const closedSnapshot = ownData?.closed_snapshot as typeof snapshot | null
  const isClosed = ownData?.status === 'closed' && closedSnapshot

  const printClosedReport = () => {
    if (!closedSnapshot) return
    const previousTitle = document.title
    let restored = false
    const restoreTitle = () => {
      if (restored) return
      restored = true
      document.title = previousTitle
      window.removeEventListener('afterprint', restoreTitle)
    }
    document.title = buildAgencyReportPrintFilename(closedSnapshot)
    window.addEventListener('afterprint', restoreTitle, { once: true })
    window.print()
    // Alguns browsers não disparam afterprint quando a janela de impressão é
    // bloqueada; o fallback não pode restaurar o título no mesmo tick de print.
    window.setTimeout(restoreTitle, 1000)
  }

  const isOmittedEscala = pods.find((entry) => entry.pod === port)?.omitted ?? false

  const departmentAside = (department: AgencyReportDepartmentKey, label: string) => {
    const sections = sectionsOf(department)
    const resolved = sections.filter((section) => sectionState(section) !== 'pending').length
    const attribution = departmentAttribution(department)
    return (
      <span className="flex flex-wrap items-center justify-end gap-3">
        <span>
          {resolved} de {sections.length} {sections.length === 1 ? 'seção resolvida' : 'seções resolvidas'} · {attribution ?? <StatusText tone="warning">aguarda assinatura</StatusText>}
        </span>
        <DepartmentSignoffControl department={department} label={label} signed={isDepartmentSigned(department)} attribution={attribution} canSignoff={canSignDepartment(department)} sectionsPending={departmentSectionsPending(department)} isPending={departmentSignoffMutation.isPending} compact onChange={updateDepartmentSignoff} />
      </span>
    )
  }
  const sectionProps = (section: AgencyReportSection) => ({
    section,
    state: sectionState(section),
    attribution: sectionAttribution(section),
    canSignoff: canSignoff(section),
    events: eventsBySection(section),
    actorNames,
    isPending: signoffMutation.isPending,
    onSignoff: updateSignoff,
    observation: signoffRows.get(section)?.observation,
    onObservationChange: updateObservation,
    terminalView: section === 'datas' ? undefined : terminalViewFor(section),
  })
  const formatTon = (value: number) => value.toLocaleString('pt-BR', { maximumFractionDigits: 3 })
  const vehicleContainerTotal = vehicleBreakdown.containersByType.reduce((total, item) => total + item.count, 0)
  const vehicleLead = `${vehicleVinTotal} ${vehicleVinTotal === 1 ? 'veículo' : 'veículos'} em ${vehicleContainerTotal} ${vehicleContainerTotal === 1 ? 'contêiner' : 'contêineres'}${vehicleBreakdown.containersByType.length === 1 ? ` ${vehicleBreakdown.containersByType[0].label}` : ''}`
  const hasVehicleTransshipment = vehicles.some((vehicle) => vehicle.transshipmentVinCount)
  const emptyEmbarkLocals = emptyEmbarkLocalTotals.map((entry) => entry.localLabel)
  const terminalLabel = resolvedReportId
    ? (resolvedTerminalCode ? `${resolvedTerminalCode}${resolvedTerminalName && resolvedTerminalName !== resolvedTerminalCode ? ` — ${resolvedTerminalName}` : ''}` : (ownData?.terminal ?? null))
    : (ownData?.terminal ?? null)

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      {escalaSelector}

      {terminalizedReports.length ? (
        <div className="flex flex-wrap items-center gap-2" aria-label="Selecionar ADR por terminal" role="group">
          <span className="text-xs font-semibold text-[var(--app-muted)]">Terminal</span>
          {terminalizedReports.map((report) => {
            const label = report.terminalCode ?? report.terminal ?? 'Terminal sem código'
            const name = report.terminalCode && report.terminal && report.terminal !== report.terminalCode ? ` — ${report.terminal}` : ''
            return (
              <Button
                key={report.reportId}
                variant={resolvedReportId === report.reportId ? 'primary' : 'secondary'}
                aria-pressed={resolvedReportId === report.reportId}
                onClick={() => setSelectedReportId(report.reportId)}
                className="app-btn--sm"
              >
                {label}{name}
              </Button>
            )
          })}
        </div>
      ) : null}

      {isLoading ? <div className="app-panel app-panel--padded text-sm text-[var(--app-muted)]">Carregando dados do ADR…</div> : null}
      {error ? <div className="app-panel app-panel--padded text-sm text-[var(--app-red)]">Não foi possível carregar os dados do ADR.</div> : null}
      {!isLoading && !error ? <>
        {isClosed ? <>
          <Block
            title="ADR"
            aside={<span className="flex gap-2"><Button variant="secondary" className="app-btn--sm" onClick={() => setPrintOpen(true)}>Imprimir</Button>{!readOnly ? <Button variant="danger" className="app-btn--sm" onClick={() => setReopenOpen(true)}>Reabrir</Button> : null}</span>}
          >
            <div role="status">
              <LeadValue detail={`por ${ownData?.closed_by_name ?? ownData?.closed_by ?? '—'}`}>Fechado em {formatDate(ownData?.closed_at)}</LeadValue>
            </div>
          </Block>
          <AgencyReportTimeline
            atd={closedSnapshot.header?.unifiedAtd ?? terminalAtd}
            atdSource={closedSnapshot.header?.atdSource ?? (terminalAtd ? ('terminal' as const) : null)}
            atdRegisteredAt={closedAtdRegisteredAt(closedSnapshot.header, terminalAtd, terminalAtdRegisteredAt ?? null)}
            deadline={closedSnapshot.header?.deadlineAt ?? closedSnapshot.header?.deadlineDate ?? deadlineAt}
            omitted={isOmittedEscala}
            now={new Date()}
            departmentSignoffs={closedSnapshot.departmentSignoffs ?? ownData?.departmentSignoffs ?? []}
            departmentEvents={departmentSignoffEvents ?? []}
            actorNames={actorNames}
            closedAt={ownData?.closed_at ?? null}
            closedByName={ownData?.closed_by_name ?? ownData?.closed_by ?? null}
          />
          <Modal open={printOpen} title="Relatório de Saída do Navio (ADR)" onClose={() => setPrintOpen(false)}><div className="flex justify-end pb-3"><Button variant="secondary" onClick={printClosedReport}>Imprimir</Button></div><AgencyReportDocument snapshot={closedSnapshot} actorNames={actorNames} /></Modal>
          <Modal open={reopenOpen} title="Reabrir ADR" onClose={() => setReopenOpen(false)}><label className="grid gap-2">Justificativa<textarea value={reopenJustification} onChange={(event) => setReopenJustification(event.target.value)} className="min-h-24 rounded border border-[var(--app-border)] bg-transparent p-2" /></label><Button variant="danger" className="mt-3" disabled={readOnly || !reopenJustification.trim() || reopenMutation.isPending} onClick={() => { if (!readOnly && port) reopenMutation.mutate({ voyageId, port, justification: reopenJustification.trim() }, { onSuccess: () => { setReopenOpen(false); setReopenJustification('') } }) }}>Confirmar reabertura</Button></Modal>
        </> : <>
          <Block
            title="ADR"
            aside={<span className="flex gap-2">
              <Button variant="secondary" className="app-btn--sm" disabled title="A impressão fica disponível depois do fechamento.">Imprimir</Button>
              <Button variant="primary" className="app-btn--sm" disabled={readOnly || signedDepartmentsCount !== 3 || !departmentSignoffEvents || closeMutation.isPending || !port} title={signedDepartmentsCount !== 3 ? 'Assine os 3 departamentos para fechar o ADR.' : !departmentSignoffEvents ? 'Aguardando o histórico de reaberturas.' : undefined} onClick={() => setCloseConfirmOpen(true)}>Fechar ADR</Button>
            </span>}
          >
            <div className="grid gap-4">
              <LeadValue
                tone={signedDepartmentsCount === 3 ? 'default' : 'warning'}
                detail={missingDepartmentLabels.length ? `Falta ${new Intl.ListFormat('pt-BR', { type: 'conjunction' }).format(missingDepartmentLabels)} assinar` : 'Pronto para fechar'}
              >
                {signedDepartmentsCount} de 3 departamentos assinados
              </LeadValue>
              <FactList columns={3}>
                <Fact label="Prazo de conclusão" detail={deadlineAt ? '72 horas após o ATD' : null}>{isOmittedEscala ? 'Escala omitida' : deadlineAt ? formatAgencyReportInstant(deadlineAt) : <NoValue label="Aguardando a saída do navio" />}</Fact>
                <Fact label="Escala">{port ?? <NoValue />}</Fact>
                <Fact label="Terminal">{terminalLabel ?? <NoValue label="Sem terminal" />}</Fact>
              </FactList>
            </div>
          </Block>
          <Modal open={closeConfirmOpen} title="Confirmar fechamento do ADR" onClose={() => setCloseConfirmOpen(false)}>
            <p className="text-sm text-[var(--app-text)]">Fechar o ADR de <strong>{voyageLabel}</strong> em <strong>{port ?? 'esta escala'}</strong> congela o retrato atual e libera a impressão.</p>
            <div className="mt-4 flex justify-end gap-2"><Button variant="secondary" onClick={() => setCloseConfirmOpen(false)}>Voltar</Button><Button variant="primary" loading={closeMutation.isPending} disabled={readOnly} onClick={() => { if (!readOnly && port) closeMutation.mutate({ voyageId, port, snapshot: snapshot as unknown as Json }, { onSuccess: () => setCloseConfirmOpen(false), onError: () => showToast('Falha ao fechar o ADR. Tente novamente.', 'error') }) }}>Confirmar fechamento</Button></div>
          </Modal>

          <Block title="Operações" aside={departmentAside('operacoes', 'Operações')}>
            <ReportSection title="Escala" {...sectionProps('datas')}>
              <FactList columns={4}>
                <Fact label="Armador">{carrierName}</Fact>
                <Fact label="Navio / viagem">{voyageLabel}</Fact>
                <Fact label="Porto">{port ?? <NoValue />}</Fact>
                {resolvedReportId || !canEditOperations ? (
                  <Fact label="Terminal">{terminalLabel ?? <NoValue label="Sem terminal" />}</Fact>
                ) : (
                  <div className="grid gap-1"><label htmlFor="legacy-adr-terminal" className="app-facts__label">Terminal</label><div className="flex gap-2"><input id="legacy-adr-terminal" className="app-input w-0 min-w-0 flex-1" value={terminalDraft} onChange={(event) => setTerminalDraft(event.target.value)} placeholder="Informe o terminal" disabled={readOnly || ownData?.status === 'closed' || terminalMutation.isPending} /><Button type="button" variant="secondary" disabled={readOnly || !port || ownData?.status === 'closed' || terminalMutation.isPending || terminalDraft.trim() === (ownData?.terminal ?? '')} onClick={() => void saveTerminal()}>Salvar</Button></div></div>
                )}
                <Fact label="ATA">{scheduleValue(data?.escala?.ata ?? data?.schedule?.ata)}</Fact>
                <Fact label="ATB">{scheduleValue(terminalAtb)}</Fact>
                <Fact label="ATD">{scheduleValue(terminalAtd)}</Fact>
                <Fact label="Restow">{terminalRtw === null ? <NoValue /> : String(terminalRtw)}</Fact>
              </FactList>
            </ReportSection>
          </Block>

          <Block title="Documentação" aside={departmentAside('documentacao', 'Documentação')}>
            <div className="grid gap-4">
              <ReportSection title="Carga descarregada" {...sectionProps('carga_descarregada')}>
                {containers.length || cargaSoltaTotal?.bls ? <div className="grid gap-4 xl:grid-cols-2">
                  {containers.length ? <div className="grid content-start gap-3">
                    <LeadValue detail={[
                      imoCount ? `${imoCount} IMO` : null,
                      containers.filter((container) => container.is_oog).length ? `${containers.filter((container) => container.is_oog).length} OOG` : null,
                      `${dischargeDestination.destinoFinal} destino final`,
                      `${dischargeDestination.transbordo} em transbordo`,
                      dischargeMatrix.unknownTypeCount ? `${dischargeMatrix.unknownTypeCount} de tipo não reconhecido` : null,
                    ].filter(Boolean).join(' · ')}>
                      {containers.length} {containers.length === 1 ? 'contêiner' : 'contêineres'} · {dischargeMatrix.teu} TEU
                    </LeadValue>
                    <ContainerNatureTable rows={dischargeMatrix.rows} />
                  </div> : null}
                  {cargaSoltaTotal?.bls ? <div className="grid content-start gap-3">
                    <LeadValue>{formatTon(cargaSoltaTotal.weightTon)} t de carga solta · {cargaSoltaTotal.bls} {cargaSoltaTotal.bls === 1 ? 'B/L' : 'B/Ls'}</LeadValue>
                    <div className="app-table-scroll">
                      <table className="app-table app-table--compact app-table--nested" aria-label="Carga solta">
                        <thead><tr><th scope="col" className="app-table__text-head">Destino</th><th scope="col">B/Ls</th><th scope="col">Peso (t)</th><th scope="col">Máquinas</th><th scope="col">Packages</th><th scope="col">CBM</th></tr></thead>
                        <tbody>
                          {[['Destino final', cargaSolta ?? cargaSoltaTransshipment, Boolean(cargaSolta)], ['Em transbordo', cargaSoltaTransshipment, true]].map(([label, row, known]) => {
                            const values = known ? row as typeof cargaSoltaTransshipment : { bls: 0, machines: 0, packages: 0, weightTon: 0, cbm: 0 }
                            return <tr key={label as string}><td className="app-table__text">{label as string}</td><td>{values.bls}</td><td>{formatTon(values.weightTon)}</td><td>{values.machines}</td><td>{values.packages}</td><td>{(values.cbm ?? 0).toLocaleString('pt-BR')}</td></tr>
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div> : null}
                </div> : <NadaOperado />}
                {data?.dischargeDivergence && data.dischargeDivergence.orphanFullContainers > 0 ? (
                  <DivergenceWarning>
                    {data.dischargeDivergence.orphanFullContainers} container(s) cheio(s) no Baplie sem B/L correspondente nesta escala — revisar na Conciliação Baplie × B/L.
                  </DivergenceWarning>
                ) : null}
              </ReportSection>

              <ReportSection title="Vazios descarregados" {...sectionProps('vazios_descarregados')}>
                {vaziosImp.length || data?.vaziosDivergence?.baplieCount ? (
                  <div className="grid content-start gap-3">
                    <LeadValue detail={emptyDischargeMatrix.unknownTypeCount ? `${emptyDischargeMatrix.unknownTypeCount} de tipo não reconhecido` : null}>
                      {vaziosImp.length || data?.vaziosDivergence?.baplieCount || 0} vazios descarregados · {emptyDischargeMatrix.teu} TEU
                    </LeadValue>
                    {data?.vaziosDivergence?.unclassifiedCount ? (
                      <p className="text-sm"><StatusText tone="warning">{data.vaziosDivergence.unclassifiedCount} sem natureza</StatusText> · classifique como cama ou cover plate em Vazios — Importação</p>
                    ) : null}
                    <OperatedListing rows={emptyDischargeMatrix.rows} />
                  </div>
                ) : <NadaOperado />}
                {data?.vaziosDivergence?.diverges ? (
                  <DivergenceWarning>
                    Baplie aponta {data.vaziosDivergence.baplieCount} vazio(s) descarregado(s) contra {data.vaziosDivergence.moduleCount} no módulo de Vazios de Importação
                    {data.vaziosDivergence.unclassifiedCount > 0 ? ` (${data.vaziosDivergence.unclassifiedCount} ainda sem natureza classificada)` : ''} — revisar na Conciliação Baplie × B/L.
                  </DivergenceWarning>
                ) : null}
              </ReportSection>
            </div>
          </Block>

          <Block title="Equipamentos" aside={departmentAside('equipamentos', 'Equipamentos')}>
            <div className="grid gap-4">
              <ReportSection title="Veículos" {...sectionProps('veiculos')}>
                {vehicleVinTotal ? <div className="grid gap-3">
                  <LeadValue>{vehicleLead}</LeadValue>
                  <div className="app-table-scroll">
                    <table className="app-table app-table--compact app-table--nested" aria-label="Veículos por marca">
                      <thead><tr><th scope="col" className="app-table__text-head">Marca</th><th scope="col">B/Ls</th><th scope="col">Veículos</th>{hasVehicleTransshipment ? <th scope="col">Em transbordo</th> : null}<th scope="col" className="app-table__text-head">Local de desova</th></tr></thead>
                      <tbody>{vehicles.map((vehicle) => <tr key={vehicle.brand}><td className="app-table__text">{vehicle.brand || 'Marca não informada'}</td><td>{vehicle.blCount}</td><td>{vehicle.vinCount}</td>{hasVehicleTransshipment ? <td>{vehicle.transshipmentVinCount}</td> : null}<td className="app-table__text">{vehicleLocations.get(vehicle.brand)?.join(', ') || <NoValue label="Local de desova não informado" />}</td></tr>)}</tbody>
                    </table>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    <CountTable label="Contêineres por tipo" head="Tipo" rows={vehicleBreakdown.containersByType.map((item) => [item.label, item.count])} />
                    <CountTable label="Veículos por modelo" head="Modelo" rows={vehicleBreakdown.vehiclesByModel.map((item) => [item.label, item.count])} />
                  </div>
                </div> : <NadaOperado />}
              </ReportSection>

              <ReportSection title="Carga carregada" {...sectionProps('carga_carregada')}>
                {graniteData.length ? <div className="grid gap-3">
                  <LeadValue>{formatTon(granite.weightTon)} t de granito · {granite.bls} {granite.bls === 1 ? 'B/L' : 'B/Ls'}</LeadValue>
                  <FactList columns={3}><Fact label="B/Ls">{granite.bls}</Fact><Fact label="Blocos">{granite.blocks}</Fact><Fact label="Peso">{formatTon(granite.weightTon)} t</Fact></FactList>
                </div> : data?.orphanData?.granito.length ? null : <NadaOperado />}
                <OrphanDataWarning entries={data?.orphanData?.granito ?? []} label="B/L(s) de granito" />
              </ReportSection>

              {/* Embarque de Vazios é UM agregado por escala (CONTEXT.md): as
                  unidades embarcadas e os serviços performados sobre elas são duas
                  partes do mesmo fato, com uma resolução só (ADR 0036). A
                  armazenagem — dias e custo — fica inteira na operação de pátio. */}
              <ReportSection title="Embarque de vazios" {...sectionProps('vazios_embarcados')}>
                <Subsection title="Containers embarcados">
                  {bookings.length ? <>
                    <LeadValue>{bookings.length} vazios embarcados</LeadValue>
                    <div className="app-table-scroll">
                      <table className="app-table app-table--compact app-table--nested" aria-label="Total por tipo">
                        <thead><tr><th scope="col">Tipo</th>{emptyEmbarkLocals.map((local) => <th key={local} scope="col">{local}</th>)}<th scope="col">Total</th></tr></thead>
                        <tbody>{emptyEmbarkTypeTotals.map(([type, quantity]) => <tr key={type}><td>{type}</td>{emptyEmbarkLocalTotals.map(({ localLabel, types }) => <td key={localLabel}>{types.find(([candidate]) => candidate === type)?.[1] ?? 0}</td>)}<td>{quantity}</td></tr>)}</tbody>
                      </table>
                    </div>
                  </> : data?.orphanData?.vaziosEmbarcados.length ? null : <NadaOperado>Nenhum vazio embarcado nesta escala.</NadaOperado>}
                  <OrphanDataWarning entries={data?.orphanData?.vaziosEmbarcados ?? []} label="unidade(s) de vazios embarcados" />
                </Subsection>

                <Subsection title="Operação de pátio">
                  {hasPatioOperation ? <>
                    <LeadValue>{data?.storage.days ?? 0} dias de storage</LeadValue>
                    <FactList columns={4}>
                      <Fact label="Containers em storage">{data?.storage.containers ?? 0}</Fact>
                      <Fact label="Unidades sem armazenagem">{directEmbarkCount}</Fact>
                      <Fact label="Depots / terminais">{depots.join(', ') || <NoValue />}</Fact>
                      <Fact label="Total da operação">{formatBRL(data?.costs?.total ?? 0)}</Fact>
                    </FactList>
                    {data?.costs?.serviceLines?.length ? <div className="app-table-scroll"><table className="app-table app-table--compact app-table--nested min-w-[1050px]" aria-label="Linhas de serviço"><thead><tr><th className="app-table__text-head">Serviço</th><th>Local</th><th>Rota</th><th>Tipo</th><th>Quantidade</th><th>Unitário</th><th>Total</th><th className="app-table__text-head">Observação</th></tr></thead><tbody>{data.costs.serviceLines.map((service) => <tr key={service.id}><td className="app-table__text">{service.service?.name ?? <NoValue label="Sem serviço" />}</td><td>{service.local?.name ?? service.local?.code ?? service.local_id}</td><td>{service.destino?.name ?? service.destino?.code ?? <NoValue label="Sem rota" />}</td><td>{service.container_type ?? <NoValue label="Sem tipo" />}</td><td>{String(service.quantidade)}</td><td>{formatBRL(Number(service.valor_unitario))}</td><td>{formatBRL(Number(service.total))}</td><td className="app-table__text app-table__text--wrap">{service.observation ?? <NoValue label="Sem observação" />}</td></tr>)}</tbody></table></div> : null}
                  </> : <NadaOperado>Nenhum serviço de pátio nesta escala.</NadaOperado>}
                </Subsection>
              </ReportSection>
            </div>
          </Block>

          <AgencyReportTimeline
            atd={terminalAtd}
            atdSource={terminalAtd ? ('terminal' as const) : null}
            atdRegisteredAt={terminalAtdRegisteredAt ?? null}
            deadline={deadlineAt}
            omitted={isOmittedEscala}
            now={new Date()}
            departmentSignoffs={ownData?.departmentSignoffs ?? []}
            departmentEvents={departmentSignoffEvents ?? []}
            actorNames={actorNames}
            closedAt={ownData?.closed_at ?? null}
            closedByName={ownData?.closed_by_name ?? ownData?.closed_by ?? null}
          />
        </>}
      </> : null}
    </div>
  )
}

function scheduleValue(value: string | null | undefined) {
  return value ? formatDateTimeBR(value) : <NoValue />
}

function CountTable({ label, head, rows }: { label: string; head: string; rows: Array<[string, number]> }) {
  return (
    <div className="app-table-scroll">
      <table className="app-table app-table--compact app-table--nested" aria-label={label}>
        <thead><tr><th scope="col" className="app-table__text-head">{head}</th><th scope="col">Quantidade</th></tr></thead>
        <tbody>{rows.map(([name, count]) => <tr key={name}><td className="app-table__text">{name}</td><td>{count}</td></tr>)}</tbody>
      </table>
    </div>
  )
}

// Task 4 do ADR 2026-07-31: uma linha por combinação (tipo, categoria)
// existente — a "listagem do operado" literal do plano, sem célula zerada
// porque buildContainerTypeMatrix só grava o que ocorreu.
function OperatedListing({ rows }: { rows: Record<string, Record<string, number>> }) {
  const combos = Object.entries(rows)
    .flatMap(([type, categories]) => Object.entries(categories).map(([category, quantity]) => ({ type, category, quantity })))
    .sort((a, b) => a.type.localeCompare(b.type) || a.category.localeCompare(b.category))

  if (!combos.length) return <NadaOperado />

  return (
    <div className="app-table-scroll">
      <table className="app-table app-table--compact app-table--nested" aria-label="Vazios por tipo e natureza">
        <thead><tr><th scope="col">Tipo</th><th scope="col">Natureza</th><th scope="col">Quantidade</th></tr></thead>
        <tbody>{combos.map((combo) => <tr key={`${combo.type}:${combo.category}`}><td>{combo.type}</td><td>{MATRIX_CATEGORY_LABELS[combo.category] ?? combo.category}</td><td>{combo.quantity}</td></tr>)}</tbody>
      </table>
    </div>
  )
}
