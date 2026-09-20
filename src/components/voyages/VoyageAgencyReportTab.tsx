import { useState, type ReactNode } from 'react'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { AgencyReportDocument, buildAgencyReportPrintFilename } from './AgencyReportDocument'
import { Info, MetricPanel } from '../shared/VoyageSectionCards'
import { SignoffControl } from './SignoffControl'
import { DepartmentSignoffControl } from './DepartmentSignoffControl'
import { AgencyReportTimeline } from './AgencyReportTimeline'
import {
  useAgencyReportDepartmentSignoffEvents,
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
  buildContainerTypeMatrix,
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
import { calculateAgencyReportDeadlineDate } from '../../services/agencyReportDeadline'
import type { AgencyReportDepartmentKey, Json } from '../../types/database'
import type { AdrEscalaPod } from '../../services/voyageSummaries'
import { formatBRL, formatDate } from '../../lib/utils'
import { normalizePortCode } from '../../services/portCode'
import { useAuth } from '../../hooks/useAuth'
import { useToast } from '../ui/Toast'

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
  'exportacao:granito': 'Granito',
  'exportacao:vazio': 'Vazios EXP',
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
  return (
    <section className="grid gap-3 rounded-lg border border-[var(--app-border)] bg-[var(--app-surface)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h3 className="text-[15px] font-bold text-[var(--app-text-strong)]">{title}</h3>
          {terminalView?.fronts?.map((front) => <span key={front} className="app-voyage-token bg-[var(--app-surface-muted)] px-2 py-0.5 text-[11px]">{front}</span>)}
        </div>
        {section && state ? (
          <div className="flex flex-wrap items-center justify-end gap-2">
            <SectionObservationAction
              section={section}
              title={title}
              observation={observation}
              canEdit={Boolean(canSignoff)}
              onChange={onObservationChange}
            />
            <SignoffControl
              section={section}
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
          </div>
        ) : null}
      </div>
      {showTerminalContent ? children : <NadaOperado>{terminalView?.assigned ? 'Nada operado nesta frente.' : 'Não há frente atribuída a este terminal.'}</NadaOperado>}
      {section ? (
        <SectionObservation
          observation={observation}
        />
      ) : null}
    </section>
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
  const text = observation?.trim() ?? ''

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
            className="min-h-32 w-full rounded-lg border border-[var(--app-border)] bg-[var(--app-surface)] p-3 text-sm shadow-sm"
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setEditing(false)}>Cancelar</Button>
            <Button
              type="button"
              variant="primary"
              disabled={draft === (observation ?? '')}
              onClick={() => { onChange?.(section, draft); setEditing(false) }}
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
      <span className="text-[10px] font-bold uppercase tracking-[0.09em] text-[var(--app-muted-soft)]">Observação</span>
      <p className={`whitespace-pre-line text-[var(--app-text)] ${expanded ? '' : 'max-h-24 overflow-hidden'}`}>{text}</p>
      {text.split('\n').length > 4 || text.length > 200 ? (
        <button type="button" className="justify-self-start text-xs font-semibold text-[var(--app-muted)] underline underline-offset-4 hover:text-[var(--app-text)]" onClick={() => setExpanded((value) => !value)}>
          {expanded ? 'Recolher observação' : 'Ver observação completa'}
        </button>
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

function Hero({ value, unit }: { value: string; unit?: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="font-[var(--app-font-display)] text-[26px] font-bold tracking-[-0.02em] text-[var(--app-text-strong)]" style={{ fontVariantNumeric: 'tabular-nums' }}>{value}</span>
      {unit ? <span className="text-xs font-semibold uppercase tracking-[0.04em] text-[var(--app-muted-soft)]">{unit}</span> : null}
    </div>
  )
}

// Substitui o Hero(0) + placeholder genérico de uma seção inteira sem
// ocorrência (Task 4 do ADR 2026-07-31, aplicado a todas as seções de carga
// — inclusive Granito, revisão pós-merge): a seção continua exigindo
// resolução (o controle de sign-off é um irmão desta linha, não é afetado).
function NadaOperado({ children = 'Nada operado nesta escala.' }: { children?: ReactNode }) {
  return <div className="rounded-md border border-dashed border-[var(--app-border)] px-3 py-3 text-center text-xs text-[var(--app-muted-soft)]">{children}</div>
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

function ReportToken({ label, value }: { label: string; value: string | number }) {
  return <span className="app-voyage-token gap-1.5 bg-[var(--app-surface-muted)] px-2 py-0.5"><span className="font-semibold text-[var(--app-text)]">{label}</span><span className="font-[var(--app-font-mono)] text-[var(--app-muted-soft)]">{value}</span></span>
}

function ContainerNatureTable({ rows }: { rows: Record<string, Record<string, number>> }) {
  const natureKeys = ['carga_geral', 'imo', 'oog']
  const labels: Record<string, string> = { carga_geral: 'Carga geral', imo: 'IMO', oog: 'OOG' }
  const types = Object.keys(rows).sort((a, b) => a.localeCompare(b))
  const totals = natureKeys.map((key) => types.reduce((sum, type) => sum + (rows[type]?.[key] ?? 0), 0))
  const total = totals.reduce((sum, value) => sum + value, 0)

  if (!types.length) return <NadaOperado />

  return (
    <div className="overflow-x-auto rounded-md border border-[var(--app-border)]">
      <table className="min-w-full border-collapse text-xs">
        <thead className="bg-[var(--app-surface-muted)] text-[10px] uppercase tracking-[0.06em] text-[var(--app-muted-soft)]">
          <tr><th className="px-2 py-1.5 text-left font-bold">Tipo</th>{natureKeys.map((key) => <th key={key} className="px-2 py-1.5 text-right font-bold">{labels[key]}</th>)}<th className="px-2 py-1.5 text-right font-bold text-[var(--app-muted)]">Total</th></tr>
        </thead>
        <tbody>
          {types.map((type) => {
            const values = natureKeys.map((key) => rows[type]?.[key] ?? 0)
            return <tr key={type} className="border-t border-[var(--app-border)]"><th className="px-2 py-1.5 text-left font-semibold text-[var(--app-text)]">{type}</th>{values.map((value, index) => <td key={natureKeys[index]} className={`px-2 py-1.5 text-right font-[var(--app-font-mono)] ${value ? 'text-[var(--app-text)]' : 'text-[var(--app-muted-soft)]'}`}>{value || '—'}</td>)}<td className="px-2 py-1.5 text-right font-[var(--app-font-mono)] font-bold text-[var(--app-text-strong)]">{values.reduce((sum, value) => sum + value, 0)}</td></tr>
          })}
          <tr className="border-t border-[var(--app-border-strong)] bg-[var(--app-surface-muted)]"><th className="px-2 py-1.5 text-left text-[10px] uppercase tracking-[0.06em] text-[var(--app-muted)]">Total</th>{totals.map((value, index) => <td key={natureKeys[index]} className="px-2 py-1.5 text-right font-[var(--app-font-mono)] font-bold text-[var(--app-text-strong)]">{value || '—'}</td>)}<td className="px-2 py-1.5 text-right font-[var(--app-font-mono)] font-bold text-[var(--app-text-strong)]">{total}</td></tr>
        </tbody>
      </table>
    </div>
  )
}

export function VoyageAgencyReportTab({ voyageId, voyageLabel, carrierName, pods, initialEscala, reportId: initialReportId, terminalCode: initialTerminalCode, readOnly = false }: Props) {
  const { showToast } = useToast()
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

  if (terminalStateError) {
    return <div className="app-panel app-panel--padded text-sm text-[var(--app-red)]">Não foi possível carregar frentes, terminais e ADRs da escala. Nenhuma ação foi habilitada.</div>
  }

  if (isTerminalStateLoading || !terminalState) {
    return <div className="app-panel app-panel--padded text-sm text-[var(--app-muted)]">Carregando frentes, terminais e ADRs da escala…</div>
  }

  // Dados operacionais continuam sendo consultados por escala, mas um ADR
  // terminalizado precisa mostrar somente as frentes atribuídas ao terminal
  // selecionado. Sem este recorte, dois terminais da mesma escala imprimem o
  // mesmo conteúdo e o sign-off deixa de ser auditável.
  const containers = sectionIsVisible('carga_descarregada') ? (data?.containers ?? []) : []
  const cargaSolta = sectionIsVisible('carga_descarregada') ? data?.cargaSolta : undefined
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
  const deadlineDate = terminalAtd ? calculateAgencyReportDeadlineDate(terminalAtd) : null

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
      atdRegisteredAt: null,
      atdSource: terminalAtd ? ('terminal' as const) : null,
      deadlineDate,
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

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap gap-2" aria-label="Selecionar escala ADR">
        {pods.map(({ pod, omitted }) => (
          <Button key={pod} variant={port === pod ? 'primary' : 'secondary'} aria-pressed={port === pod} onClick={() => setPort(pod)} className="rounded-full">
            {pod}
            {omitted ? (
              <span
                className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${port === pod ? 'bg-white/20 text-white' : 'bg-[var(--app-surface-muted)] text-[var(--app-muted)]'}`}
                title="Escala omitida — o navio não atracou neste porto; ADR mantido apenas como registro fechado."
              >
                Omitida
              </span>
            ) : null}
          </Button>
        ))}
      </div>

      {terminalizedReports.length ? (
        <div className="app-panel app-panel--padded grid gap-2" aria-label="Selecionar ADR por terminal">
          <span className="text-xs font-semibold uppercase tracking-wide text-[var(--app-muted)]">ADR por terminal</span>
          <div className="flex flex-wrap gap-2">
            {terminalizedReports.map((report) => {
              const label = report.terminalCode ?? report.terminal ?? 'Terminal sem código'
              const name = report.terminalCode && report.terminal && report.terminal !== report.terminalCode ? ` — ${report.terminal}` : ''
              return (
                <Button
                  key={report.reportId}
                  variant={resolvedReportId === report.reportId ? 'primary' : 'secondary'}
                  aria-pressed={resolvedReportId === report.reportId}
                  onClick={() => setSelectedReportId(report.reportId)}
                  className="rounded-full"
                >
                  {label}{name}
                </Button>
              )
            })}
          </div>
        </div>
      ) : null}

      {isLoading ? <div className="app-panel app-panel--padded text-sm text-[var(--app-muted)]">Carregando dados do ADR…</div> : null}
      {error ? <div className="app-panel app-panel--padded text-sm text-[var(--app-red)]">Não foi possível carregar os dados do ADR.</div> : null}
      {!isLoading && !error ? <>
        {isClosed ? <>
          <div className="app-panel app-panel--padded flex flex-wrap items-center justify-between gap-3" role="status"><span>Fechado em {formatDate(ownData?.closed_at)} por {ownData?.closed_by_name ?? ownData?.closed_by ?? '—'}</span><div className="flex gap-2"><Button variant="secondary" onClick={() => setPrintOpen(true)}>Imprimir</Button>{isAdmin && !readOnly ? <Button variant="danger" onClick={() => setReopenOpen(true)}>Reabrir</Button> : null}</div></div>
          <AgencyReportTimeline
            atd={closedSnapshot.header?.unifiedAtd ?? terminalAtd}
            atdSource={closedSnapshot.header?.atdSource ?? (terminalAtd ? ('terminal' as const) : null)}
            atdRegisteredAt={closedSnapshot.header?.atdRegisteredAt ?? null}
            deadline={closedSnapshot.header?.deadlineDate ?? deadlineDate}
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
         <div className="grid gap-3 rounded-lg border border-[var(--app-border)] bg-[var(--app-surface-muted)] p-3.5 px-4">
           <div className="flex flex-wrap items-center justify-between gap-3">
             <div className="flex flex-wrap items-center gap-3">
               <span className="font-[var(--app-font-mono)] text-[13px] font-semibold text-[var(--app-text)]" style={{ fontVariantNumeric: 'tabular-nums' }}>{signedDepartmentsCount}/3 departamentos assinados</span>
               <span className="app-badge app-badge--slate">{deadlineDate ? `Prazo ${formatDate(deadlineDate)}` : 'Sem prazo'}</span>
             </div>
             <div className="flex gap-2">
               <Button variant="secondary" disabled title="A impressão fica disponível depois do fechamento.">Imprimir</Button>
               <Button variant="primary" disabled={readOnly || signedDepartmentsCount !== 3 || !departmentSignoffEvents || closeMutation.isPending || !port} title={signedDepartmentsCount !== 3 ? 'Assine os 3 departamentos para fechar o ADR.' : !departmentSignoffEvents ? 'Aguardando o histórico de reaberturas.' : undefined} onClick={() => setCloseConfirmOpen(true)}>Fechar ADR</Button>
             </div>
           </div>
           {missingDepartmentLabels.length ? <div className="flex items-start gap-2 border-t border-[var(--app-border)] pt-3 text-xs leading-5 text-[var(--app-muted)]"><span className="text-[var(--app-gold)]" aria-hidden="true">!</span><span><strong className="text-[var(--app-gold-strong)]">Falta {missingDepartmentLabels.join(' e ')} assinar</strong> — todas as seções do setor precisam estar resolvidas antes da assinatura departamental.</span></div> : null}
         </div>
         <Modal open={closeConfirmOpen} title="Confirmar fechamento do ADR" onClose={() => setCloseConfirmOpen(false)}>
           <p className="text-sm text-[var(--app-text)]">Fechar o ADR de <strong>{voyageLabel}</strong> em <strong>{port ?? 'esta escala'}</strong> congela o retrato atual e libera a impressão.</p>
           <div className="mt-4 flex justify-end gap-2"><Button variant="secondary" onClick={() => setCloseConfirmOpen(false)}>Cancelar</Button><Button variant="primary" loading={closeMutation.isPending} disabled={readOnly} onClick={() => { if (!readOnly && port) closeMutation.mutate({ voyageId, port, snapshot: snapshot as unknown as Json }, { onSuccess: () => setCloseConfirmOpen(false), onError: () => showToast('Falha ao fechar o ADR. Tente novamente.', 'error') }) }}>Confirmar fechamento</Button></div>
         </Modal>

        <div className="grid gap-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2 px-1">
            <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--app-muted)]">Seções por departamento</h2>
            <span className="text-xs text-[var(--app-muted-soft)]">quem assina responde pelo grupo inteiro</span>
          </div>
          <div className="app-panel grid gap-3 rounded-lg border border-[var(--app-border)] bg-[var(--app-surface-muted)] p-3.5 px-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3"><h2 className="text-[11px] font-bold uppercase tracking-[0.09em] text-[var(--app-muted)]">Operações</h2><span className="font-[var(--app-font-mono)] text-xs text-[var(--app-green)]">{sectionsOf('operacoes').filter((section) => sectionState(section) !== 'pending').length}/{sectionsOf('operacoes').length} seções</span><span className="flex gap-1">{sectionsOf('operacoes').map((section) => <span key={section} className={`h-1 w-7 rounded-full ${sectionState(section) === 'pending' ? 'bg-[var(--app-panel-strong)]' : 'bg-[var(--app-green)]'}`} />)}</span></div>
              <div className="flex flex-wrap items-center justify-end gap-2"><span className="app-badge app-badge--slate">{deadlineDate ? `Prazo ${formatDate(deadlineDate)}` : 'Sem prazo'}</span><DepartmentSignoffControl department="operacoes" label="Operações" signed={isDepartmentSigned('operacoes')} attribution={departmentAttribution('operacoes')} canSignoff={canSignDepartment('operacoes')} sectionsPending={departmentSectionsPending('operacoes')} isPending={departmentSignoffMutation.isPending} compact onChange={updateDepartmentSignoff} /></div>
            </div>
            <div className="grid gap-3">
              <ReportSection
                title="Escala"
                section="datas" state={sectionState('datas')} attribution={sectionAttribution('datas')} canSignoff={canSignoff('datas')} events={eventsBySection('datas')} actorNames={actorNames} isPending={signoffMutation.isPending} onSignoff={updateSignoff}
                observation={signoffRows.get('datas')?.observation} onObservationChange={updateObservation}
              >
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                  <Info label="Armador" value={carrierName} />
                  <Info label="Navio / viagem" value={voyageLabel} />
                  <Info label="Porto" value={port ?? '—'} />
                  {resolvedReportId ? (
                    <Info label="Terminal" value={resolvedTerminalCode ? `${resolvedTerminalCode}${resolvedTerminalName && resolvedTerminalName !== resolvedTerminalCode ? ` — ${resolvedTerminalName}` : ''}` : (ownData?.terminal ?? '—')} />
                  ) : canEditOperations ? (
                    <div className="grid gap-1"><label htmlFor="legacy-adr-terminal" className="text-xs font-semibold uppercase tracking-wide text-[var(--app-muted)]">Terminal</label><div className="flex gap-2"><input id="legacy-adr-terminal" className="app-input min-w-0" value={terminalDraft} onChange={(event) => setTerminalDraft(event.target.value)} placeholder="Informe o terminal" disabled={readOnly || ownData?.status === 'closed' || terminalMutation.isPending} /><Button type="button" variant="secondary" disabled={readOnly || !port || ownData?.status === 'closed' || terminalMutation.isPending || terminalDraft.trim() === (ownData?.terminal ?? '')} onClick={() => { if (readOnly || !port) return; terminalMutation.mutate({ voyageId, port, terminal: terminalDraft.trim() }, { onSuccess: () => showToast('Terminal do ADR salvo.', 'success'), onError: (error) => showToast(error instanceof Error ? error.message : 'Falha ao salvar o terminal do ADR.', 'error') }) }}>Salvar</Button></div></div>
                  ) : <Info label="Terminal" value={ownData?.terminal ?? '—'} />}
                  <Info label="ATA" value={formatDate(data?.escala?.ata ?? data?.schedule?.ata)} />
                  <Info label="ATB" value={formatDate(terminalAtb)} />
                  <Info label="ATD" value={formatDate(terminalAtd)} />
                  <Info label="Restow" value={terminalRtw === null ? '—' : String(terminalRtw)} />
                </div>
              </ReportSection>
            </div>
          </div>

          <div className="app-panel grid gap-3 rounded-lg border border-[var(--app-border)] bg-[var(--app-surface-muted)] p-3.5 px-4">
            <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-3"><h2 className="text-[11px] font-bold uppercase tracking-[0.09em] text-[var(--app-muted)]">Documentação</h2><span className="font-[var(--app-font-mono)] text-xs text-[var(--app-green)]">{sectionsOf('documentacao').filter((section) => sectionState(section) !== 'pending').length}/{sectionsOf('documentacao').length} seções</span><span className="flex gap-1">{sectionsOf('documentacao').map((section) => <span key={section} className={`h-1 w-7 rounded-full ${sectionState(section) === 'pending' ? 'bg-[var(--app-panel-strong)]' : 'bg-[var(--app-green)]'}`} />)}</span></div><DepartmentSignoffControl department="documentacao" label="Documentação" signed={isDepartmentSigned('documentacao')} attribution={departmentAttribution('documentacao')} canSignoff={canSignDepartment('documentacao')} sectionsPending={departmentSectionsPending('documentacao')} isPending={departmentSignoffMutation.isPending} compact onChange={updateDepartmentSignoff} /></div>
            <div className="grid gap-3">
          <ReportSection
            title="Carga descarregada"
            section="carga_descarregada" state={sectionState('carga_descarregada')} attribution={sectionAttribution('carga_descarregada')} canSignoff={canSignoff('carga_descarregada')} events={eventsBySection('carga_descarregada')} actorNames={actorNames} isPending={signoffMutation.isPending} onSignoff={updateSignoff}
            observation={signoffRows.get('carga_descarregada')?.observation} onObservationChange={updateObservation} terminalView={terminalViewFor('carga_descarregada')}
          >
            {containers.length || cargaSoltaTotal?.bls ? <div className="grid gap-3 xl:grid-cols-2">
              {containers.length ? <div className="grid content-start gap-3 rounded-lg border border-[var(--app-border)] bg-[var(--app-surface)] p-3.5">
                <div className="flex flex-wrap items-baseline justify-between gap-2"><span className="text-[10px] font-bold uppercase tracking-[0.09em] text-[var(--app-muted-soft)]">Containers descarregados</span><Hero value={String(containers.length)} unit="unidades" /></div>
                <div className="flex flex-wrap gap-1.5">{imoCount ? <ReportToken label="IMO" value={imoCount} /> : null}{containers.filter((container) => container.is_oog).length ? <ReportToken label="OOG" value={containers.filter((container) => container.is_oog).length} /> : null}</div>
                <div className="flex flex-wrap gap-1.5"><ReportToken label="TEU" value={dischargeMatrix.teu} />{dischargeMatrix.unknownTypeCount ? <ReportToken label="Tipo não reconhecido" value={dischargeMatrix.unknownTypeCount} /> : null}</div>
                <div className="grid gap-2"><span className="text-[10px] font-bold uppercase tracking-[0.09em] text-[var(--app-muted)]">Por tipo</span><div className="flex flex-wrap gap-1.5">{Object.entries(dischargeMatrix.rows).sort(([a], [b]) => a.localeCompare(b)).map(([type, categories]) => <ReportToken key={type} label={type} value={Object.values(categories).reduce((sum, value) => sum + value, 0)} />)}</div></div>
                <div className="grid gap-2"><span className="text-[10px] font-bold uppercase tracking-[0.09em] text-[var(--app-muted)]">Por tipo e natureza</span><ContainerNatureTable rows={dischargeMatrix.rows} /></div>
                <div className="grid gap-2"><span className="text-[10px] font-bold uppercase tracking-[0.09em] text-[var(--app-muted)]">Destino</span><div className="flex flex-wrap gap-1.5"><ReportToken label="Destino final" value={dischargeDestination.destinoFinal} /><ReportToken label="Em transbordo" value={dischargeDestination.transbordo} /></div></div>
                <p className="m-0 text-[11px] leading-5 text-[var(--app-muted-soft)]">Só container cheio. Vazios do Baplie vivem em <strong className="text-[var(--app-muted)]">Vazios descarregados</strong>.</p>
              </div> : null}
              {cargaSoltaTotal?.bls ? <div className="grid content-start gap-3 rounded-lg border border-[var(--app-border)] bg-[var(--app-surface)] p-3.5"><div className="flex flex-wrap items-baseline justify-between gap-2"><span className="text-[10px] font-bold uppercase tracking-[0.09em] text-[var(--app-muted-soft)]">Carga solta</span><Hero value={String(cargaSoltaTotal.bls)} unit="B/Ls" /></div><span className="font-[var(--app-font-mono)] text-xs font-semibold text-[var(--app-text)]">{cargaSoltaTotal.weightTon.toLocaleString('pt-BR')} ton</span><div className="grid gap-3 border-t border-[var(--app-border)] pt-3"><div className="flex flex-wrap items-baseline justify-between gap-2"><span className="text-[10px] font-bold uppercase tracking-[0.09em] text-[var(--app-muted)]">Destino final</span><span className="font-[var(--app-font-mono)] text-xs text-[var(--app-text)]">{cargaSolta?.bls ?? 0} B/Ls · {cargaSolta?.weightTon.toLocaleString('pt-BR') ?? '0'} ton</span></div><div className="flex flex-wrap gap-1.5"><ReportToken label="Máquinas" value={cargaSolta?.machines ?? 0} /><ReportToken label="Packages" value={cargaSolta?.packages ?? 0} /><ReportToken label="CBM" value={cargaSolta?.cbm?.toLocaleString('pt-BR') ?? '0'} /></div></div><div className="grid gap-3 border-t border-[var(--app-border)] pt-3"><div className="flex flex-wrap items-baseline justify-between gap-2"><span className="text-[10px] font-bold uppercase tracking-[0.09em] text-[var(--app-muted)]">Em transbordo</span><span className="font-[var(--app-font-mono)] text-xs text-[var(--app-text)]">{cargaSoltaTransshipment.bls} B/L · {cargaSoltaTransshipment.weightTon.toLocaleString('pt-BR')} ton</span></div><div className="flex flex-wrap gap-1.5"><ReportToken label="Máquinas" value={cargaSoltaTransshipment.machines} /><ReportToken label="Packages" value={cargaSoltaTransshipment.packages} /><ReportToken label="CBM" value={cargaSoltaTransshipment.cbm.toLocaleString('pt-BR')} /></div></div></div> : null}
            </div> : <NadaOperado />}
            {data?.dischargeDivergence && data.dischargeDivergence.orphanFullContainers > 0 ? (
              <DivergenceWarning>
                {data.dischargeDivergence.orphanFullContainers} container(s) cheio(s) no Baplie sem B/L correspondente nesta escala — revisar na Conciliação Baplie × B/L.
              </DivergenceWarning>
            ) : null}
          </ReportSection>

          <ReportSection
            title="Vazios descarregados"
            section="vazios_descarregados" state={sectionState('vazios_descarregados')} attribution={sectionAttribution('vazios_descarregados')} canSignoff={canSignoff('vazios_descarregados')} events={eventsBySection('vazios_descarregados')} actorNames={actorNames} isPending={signoffMutation.isPending} onSignoff={updateSignoff}
            observation={signoffRows.get('vazios_descarregados')?.observation} onObservationChange={updateObservation} terminalView={terminalViewFor('vazios_descarregados')}
          >
            {vaziosImp.length || data?.vaziosDivergence?.baplieCount ? (
              <div className="grid content-start gap-3 rounded-lg border border-[var(--app-border)] bg-[var(--app-surface)] p-3.5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-[0.09em] text-[var(--app-muted-soft)]">
                    Vazios descarregados
                  </span>
                  <Hero value={String(vaziosImp.length || data?.vaziosDivergence?.baplieCount || 0)} unit="vazios descarregados" />
                </div>
                <div className="flex flex-wrap gap-1.5"><ReportToken label="TEU" value={emptyDischargeMatrix.teu} />{emptyDischargeMatrix.unknownTypeCount ? <ReportToken label="Tipo não reconhecido" value={emptyDischargeMatrix.unknownTypeCount} /> : null}</div>
                {data?.vaziosDivergence?.unclassifiedCount ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="app-badge app-badge--yellow w-fit">
                      {data.vaziosDivergence.unclassifiedCount} sem natureza
                    </span>
                    <span className="text-xs text-[var(--app-muted-soft)]">
                      Classifique como cama ou cover plate em Vazios — Importação
                    </span>
                  </div>
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

          <ReportSection
            title="Veículos"
            section="veiculos" state={sectionState('veiculos')} attribution={sectionAttribution('veiculos')} canSignoff={canSignoff('veiculos')} events={eventsBySection('veiculos')} actorNames={actorNames} isPending={signoffMutation.isPending} onSignoff={updateSignoff}
            observation={signoffRows.get('veiculos')?.observation} onObservationChange={updateObservation} terminalView={terminalViewFor('veiculos')}
          >
            {vehicleVinTotal ? <>
              <Hero value={String(vehicleVinTotal)} unit="VINs" />
              <div className="grid gap-2">{vehicles.map((vehicle) => <Info key={vehicle.brand} label={vehicle.brand || 'Marca não informada'} value={`${vehicle.blCount} ${vehicle.blCount === 1 ? 'BL' : 'BLs'} · ${vehicle.vinCount} ${vehicle.vinCount === 1 ? 'VIN' : 'VINs'}${vehicle.transshipmentVinCount ? ` · ${vehicle.transshipmentVinCount} em transbordo` : ''} · ${vehicleLocations.get(vehicle.brand)?.join(', ') || 'local de desova não informado'}`} />)}</div>
              <div className="grid gap-3 md:grid-cols-2">
                <MetricPanel title="Containers distintos por tipo">
                  {vehicleBreakdown.containersByType.map((item) => <Info key={item.label} label={item.label} value={String(item.count)} />)}
                </MetricPanel>
                <MetricPanel title="Veículos por modelo">
                  {vehicleBreakdown.vehiclesByModel.map((item) => <Info key={item.label} label={item.label} value={String(item.count)} />)}
                </MetricPanel>
              </div>
            </> : <NadaOperado />}
          </ReportSection>
            </div>
          </div>

          <div className="app-panel grid gap-3 rounded-lg border border-[var(--app-border)] bg-[var(--app-surface-muted)] p-3.5 px-4">
            <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-3"><h2 className="text-[11px] font-bold uppercase tracking-[0.09em] text-[var(--app-muted)]">Equipamentos</h2><span className="font-[var(--app-font-mono)] text-xs text-[var(--app-green)]">{sectionsOf('equipamentos').filter((section) => sectionState(section) !== 'pending').length}/{sectionsOf('equipamentos').length} seções</span><span className="flex gap-1">{sectionsOf('equipamentos').map((section) => <span key={section} className={`h-1 w-7 rounded-full ${sectionState(section) === 'pending' ? 'bg-[var(--app-panel-strong)]' : 'bg-[var(--app-green)]'}`} />)}</span></div><DepartmentSignoffControl department="equipamentos" label="Equipamentos" signed={isDepartmentSigned('equipamentos')} attribution={departmentAttribution('equipamentos')} canSignoff={canSignDepartment('equipamentos')} sectionsPending={departmentSectionsPending('equipamentos')} isPending={departmentSignoffMutation.isPending} compact onChange={updateDepartmentSignoff} /></div>
            <div className="grid gap-3">
          <ReportSection
            title="Carga carregada"
            section="carga_carregada" state={sectionState('carga_carregada')} attribution={sectionAttribution('carga_carregada')} canSignoff={canSignoff('carga_carregada')} events={eventsBySection('carga_carregada')} actorNames={actorNames} isPending={signoffMutation.isPending} onSignoff={updateSignoff}
            observation={signoffRows.get('carga_carregada')?.observation} onObservationChange={updateObservation} terminalView={terminalViewFor('carga_carregada')}
          >
            {graniteData.length ? <>
              <Hero value={(graniteData.reduce((total, item) => total + (item.real_weight_kg ?? 0), 0) / 1000).toLocaleString('pt-BR')} unit="ton" />
              <MetricPanel title="Granito"><Info label="B/Ls" value={String(graniteData.length)} /><Info label="Blocos" value={String(graniteData.reduce((total, item) => total + (item.blocks_qty ?? 0), 0))} /><Info label="Peso" value={`${(graniteData.reduce((total, item) => total + (item.real_weight_kg ?? 0), 0) / 1000).toLocaleString('pt-BR')} ton`} /></MetricPanel>
            </> : data?.orphanData?.granito.length ? null : <NadaOperado />}
            <OrphanDataWarning entries={data?.orphanData?.granito ?? []} label="B/L(s) de granito" />
          </ReportSection>

          {/* Embarque de Vazios é UM agregado por escala (CONTEXT.md): as
              unidades embarcadas e os serviços performados sobre elas são duas
              partes do mesmo fato, com uma resolução só (ADR 0036). A
              armazenagem — dias e custo — fica inteira na operação de pátio. */}
          <ReportSection
            title="Embarque de vazios"
            section="vazios_embarcados" state={sectionState('vazios_embarcados')} attribution={sectionAttribution('vazios_embarcados')} canSignoff={canSignoff('vazios_embarcados')} events={eventsBySection('vazios_embarcados')} actorNames={actorNames} isPending={signoffMutation.isPending} onSignoff={updateSignoff}
            observation={signoffRows.get('vazios_embarcados')?.observation} onObservationChange={updateObservation} terminalView={terminalViewFor('vazios_embarcados')}
          >
            <Subsection title="Containers embarcados">
              {bookings.length ? <>
                <Hero value={String(bookings.length)} unit="vazios embarcados" />
                <div className="grid gap-4">
                  <MetricPanel title="Total por tipo">
                    {emptyEmbarkTypeTotals.map(([type, quantity]) => <Info key={type} label={type} value={String(quantity)} />)}
                  </MetricPanel>
                  <div className="grid gap-4 md:grid-cols-2">
                    {emptyEmbarkLocalTotals.map(({ localLabel, types }) => (
                      <MetricPanel key={localLabel} title={localLabel}>
                        {types.map(([type, quantity]) => <Info key={type} label={type} value={String(quantity)} />)}
                      </MetricPanel>
                    ))}
                  </div>
                </div>
              </> : data?.orphanData?.vaziosEmbarcados.length ? null : <NadaOperado>Nenhum vazio embarcado nesta escala.</NadaOperado>}
              <OrphanDataWarning entries={data?.orphanData?.vaziosEmbarcados ?? []} label="unidade(s) de vazios embarcados" />
            </Subsection>

            <Subsection title="Operação de pátio">
              {hasPatioOperation ? <>
                <Hero value={String(data?.storage.days ?? 0)} unit="dias de storage" />
                <div className="grid gap-4 xl:grid-cols-3">
                  {data?.storage.days ? <MetricPanel title="Storage"><Info label="Containers" value={String(data.storage.containers)} /><Info label="Dias" value={String(data.storage.days)} /></MetricPanel> : null}
                  {directEmbarkCount ? <MetricPanel title="Embarque direto"><Info label="Unidades sem armazenagem" value={String(directEmbarkCount)} /></MetricPanel> : null}
                  <MetricPanel title="Locais"><Info label="Depots / terminais" value={depots.join(', ') || '—'} /></MetricPanel>
                </div>
                <MetricPanel title="Linhas de serviço">{data?.costs?.serviceLines?.length ? <div className="app-table-scroll"><table className="app-table min-w-[1050px] text-left text-sm"><thead><tr><th>Serviço</th><th>Local</th><th>Rota</th><th>Tipo</th><th>Quantidade</th><th>Unitário</th><th>Total</th><th>Observação</th></tr></thead><tbody>{data.costs.serviceLines.map((service) => <tr key={service.id}><td>{service.service?.name ?? '—'}</td><td>{service.local?.name ?? service.local?.code ?? service.local_id}</td><td>{service.destino?.name ?? service.destino?.code ?? '—'}</td><td>{service.container_type ?? '—'}</td><td>{String(service.quantidade)}</td><td>{formatBRL(Number(service.valor_unitario))}</td><td>{formatBRL(Number(service.total))}</td><td className="whitespace-pre-line">{service.observation ?? '—'}</td></tr>)}</tbody></table></div> : <Info label="Registros" value="0" />}</MetricPanel>
                <MetricPanel title="Totais"><Info label="Total da operação" value={formatBRL(data?.costs?.total ?? 0)} /></MetricPanel>
              </> : <NadaOperado>Nenhum serviço de pátio nesta escala.</NadaOperado>}
            </Subsection>
          </ReportSection>
            </div>
          </div>

          <AgencyReportTimeline
            atd={terminalAtd}
            atdSource={terminalAtd ? ('terminal' as const) : null}
            atdRegisteredAt={null}
            deadline={deadlineDate}
            omitted={isOmittedEscala}
            now={new Date()}
            departmentSignoffs={ownData?.departmentSignoffs ?? []}
            departmentEvents={departmentSignoffEvents ?? []}
            actorNames={actorNames}
            closedAt={ownData?.closed_at ?? null}
            closedByName={ownData?.closed_by_name ?? ownData?.closed_by ?? null}
          />
        </div>
        </>}
      </> : null}
    </div>
  )
}

// Task 4 do ADR 2026-07-31: substitui a antiga Matrix (uma linha por tipo,
// categorias mescladas numa string só) por uma linha por combinação
// (tipo, categoria) existente — a "listagem do operado" literal do plano, sem
// célula zerada porque buildContainerTypeMatrix só grava o que ocorreu.
function OperatedListing({ rows }: { rows: Record<string, Record<string, number>> }) {
  const combos = Object.entries(rows)
    .flatMap(([type, categories]) => Object.entries(categories).map(([category, quantity]) => ({ type, category, quantity })))
    .sort((a, b) => a.type.localeCompare(b.type) || a.category.localeCompare(b.category))

  if (!combos.length) return <NadaOperado />

  return (
    <div className="grid gap-2">
      {combos.map((combo) => <Info key={`${combo.type}:${combo.category}`} label={`${combo.type} · ${MATRIX_CATEGORY_LABELS[combo.category] ?? combo.category}`} value={String(combo.quantity)} />)}
    </div>
  )
}
