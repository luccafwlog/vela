import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Modal } from '../ui/Modal'
import { Field, Input } from '../ui/Input'
import { Button } from '../ui/Button'
import { useConfirm } from '../ui/ConfirmDialog'
import {
  getEditableVoyagePodCeStatus,
  POD_CE_STATUS_OPTIONS,
  sortAtracacoes,
  type EditableVoyagePodCeStatus,
  type VoyagePodCeStatus,
} from '../../services/voyageRouteSchedules'
import { formatDateTimeBR, splitIsoDateTime, combineIsoDateTime } from '../../lib/utils'
import { normalizePortCode } from '../../services/portCode'
import { normalizeDischargePorts } from '../../services/voyageExportSchedules'
import type {
  ClosedAdrBlocker,
  OperationFront,
  OperationFrontDirection,
  OperationFrontKind,
  TerminalOption,
  TerminalScaleState,
} from '../../services/escalaTerminalAllocation'

// Portos brasileiros de escala, na ordem em que a operação os lê.
const ESCALA_PORT_SUGGESTIONS = [
  'BRVIX', 'BRSSA', 'BRPEC', 'BRSUA', 'BRSSZ', 'BRIGI', 'BRNVT',
  'BRPNG', 'BRRIG', 'BRRIO', 'BRITJ', 'BRMCZ', 'BRFOR', 'BRBEL', 'BRREC',
  'BRNAT', 'BRSLZ', 'BRMAO', 'BRSFS', 'BRIOS',
] as const

export type EscalaExportPayload = {
  temExportacao: boolean
  hasGranite: boolean
  hasEmpty: boolean
  containersQty: number | null
  movementsQty: number | null
  dischargePorts: string[]
}

export type EscalaModalPayload = {
  voyageId: number
  port: string
  temImportacao: boolean
  eta: string | null
  ata: string | null
  ceStatus: EditableVoyagePodCeStatus
  linked: boolean
  escalaNumber: string | null
  exportacao: EscalaExportPayload
  exportExistingId: string | null
  terminalState?: {
    expectedRevision: number
    fronts: Array<{
      sentido: OperationFrontDirection
      modalidade: OperationFrontKind
      terminalId: string | null
      source: OperationFront['source']
    }>
    terminals: Array<{
      terminalId: string | null
      etb: string | null
      atb: string | null
      etd: string | null
      atd: string | null
      restow: number | null
    }>
    exportExpectation: Record<string, unknown>
    justification: string | null
  }
}

export type EscalaModalTerminalScale = TerminalScaleState & {
  loading?: boolean
  error?: string | null
}

export type EscalaModalData = {
  voyageId: number
  voyageLabel: string
  /** `null` cria uma escala nova; preenchido edita a escala daquele porto. */
  port: string | null
  temImportacao: boolean
  eta: string | null
  ata: string | null
  ceStatus: VoyagePodCeStatus | null
  linked: boolean | null
  escalaNumber: string | null
  exportExistingId: string | null
  temExportacao: boolean
  hasGranite: boolean
  hasEmpty: boolean
  containersQty: number | null
  movementsQty: number | null
  dischargePorts: string[]
  /**
   * Há granito ou Embarque de Vazios nesta escala: a exportação não pode ser
   * desdeclarada enquanto a carga existir.
   */
  exportLocked: boolean
  /** Bloqueios por natureza: granito não deve ser travado por vazios vinculados. */
  graniteLocked?: boolean
  emptyLocked?: boolean
  terminalScale?: EscalaModalTerminalScale | null
  /** `undefined` keeps the normal modal focus; `null` focuses the terminal section. */
  focusTerminalId?: string | null
}

// Modais apresentacionais de escala e de manifesto; a persistência fica no
// callback do pai.

export function PolScheduleModal({
  open,
  polSchedule,
  onClose,
  onSaved,
}: {
  open: boolean
  polSchedule: {
    voyageId: number
    voyageLabel: string
    pol: string
    pod: string
    etd: string | null
    atd: string | null
    ceMaster: string | null
    batchIds: number[]
    cargoMode?: 'container' | 'vazios' | 'carga_solta'
  } | null
  onClose: () => void
  onSaved: (payload: { voyageId: number; pol: string; pod: string; etd: string | null; atd: string | null; ceMaster: string | null; batchIds: number[]; cargoMode?: 'container' | 'vazios' | 'carga_solta' }) => Promise<void>
}) {
  const [etd, setEtd] = useState('')
  const [atd, setAtd] = useState('')
  const [ceMaster, setCeMaster] = useState('')
  const [saving, setSaving] = useState(false)

  // O pai cria um payload novo a cada abertura; re-baseia os campos por
  // identidade do payload, durante o render (sem useEffect).
  const [prevSchedule, setPrevSchedule] = useState<typeof polSchedule>(null)
  if (open && polSchedule && polSchedule !== prevSchedule) {
    setPrevSchedule(polSchedule)
    setEtd(polSchedule.etd ?? '')
    setAtd(polSchedule.atd ?? '')
    setCeMaster(polSchedule.ceMaster ?? '')
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!polSchedule) return

    setSaving(true)
    try {
      await onSaved({
        voyageId: polSchedule.voyageId,
        pol: polSchedule.pol,
        pod: polSchedule.pod,
        etd: etd || null,
        atd: atd || null,
        ceMaster: ceMaster.trim() || null,
        batchIds: polSchedule.batchIds,
        cargoMode: polSchedule.cargoMode,
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={polSchedule?.cargoMode === 'vazios' ? 'Manifesto de Vazios · Nº de Manifesto Mercante' : 'Editar ETD + ATD e Nº de Manifesto Mercante'}>
      {polSchedule ? (
        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          <div className="app-escala-summary">
            <div>
              <div className="app-escala-summary__voyage">{polSchedule.voyageLabel}</div>
              <div className="app-escala-summary__meta">Rota: {polSchedule.pol} -&gt; {polSchedule.pod}</div>
            </div>
            <div className="app-escala-summary__status">
              {polSchedule.cargoMode === 'vazios' ? 'Manifesto de Vazios' : 'Rota / Manifesto'}
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <Field label="ETD">
              <Input type="date" value={etd} onChange={(event) => setEtd(event.target.value)} />
            </Field>
            <Field label="ATD">
              <Input type="date" value={atd} onChange={(event) => setAtd(event.target.value)} />
            </Field>
            <Field label="Nº MANIFESTO">
              <Input value={ceMaster} onChange={(event) => setCeMaster(event.target.value)} placeholder="Ex.: 25BR00481" />
            </Field>
          </div>

          <div className="app-modal__actions">
            <Button variant="secondary" type="button" onClick={onClose}>
              Voltar
            </Button>
            <Button loading={saving} type="submit">
              Salvar
            </Button>
          </div>
        </form>
      ) : null}
    </Modal>
  )
}

const FRONT_LABELS: Record<OperationFrontKind, string> = {
  carga_cheia: 'Carga cheia',
  carga_solta: 'Carga solta',
  vazio: 'Vazios',
  veiculo: 'Veículos',
  granito: 'Granito',
}

const DIRECTION_LABELS: Record<OperationFrontDirection, string> = {
  importacao: 'Importação',
  exportacao: 'Exportação',
}

type EscalaOperationMode = 'import' | 'both' | 'export'

function frontKey(front: Pick<OperationFront, 'sentido' | 'modalidade'>) {
  return `${front.sentido}:${front.modalidade}`
}

export type TerminalDatesDraft = {
  etbDate: string
  etbTime: string
  atbDate: string
  atbTime: string
  etdDate: string
  etdTime: string
  atdDate: string
  atdTime: string
  restow: string
}

function emptyTerminalDatesDraft(): TerminalDatesDraft {
  return {
    etbDate: '',
    etbTime: '',
    atbDate: '',
    atbTime: '',
    etdDate: '',
    etdTime: '',
    atdDate: '',
    atdTime: '',
    restow: '',
  }
}

function terminalToDatesDraft(terminal?: {
  etb?: string | null
  atb?: string | null
  etd?: string | null
  atd?: string | null
  restow?: number | null
} | null): TerminalDatesDraft {
  const etb = splitIsoDateTime(terminal?.etb)
  const atb = splitIsoDateTime(terminal?.atb)
  const etd = splitIsoDateTime(terminal?.etd)
  const atd = splitIsoDateTime(terminal?.atd)
  return {
    etbDate: etb.date,
    etbTime: etb.time,
    atbDate: atb.date,
    atbTime: atb.time,
    etdDate: etd.date,
    etdTime: etd.time,
    atdDate: atd.date,
    atdTime: atd.time,
    restow: terminal?.restow == null ? '' : String(terminal.restow),
  }
}

function sameDateTimeValue(left: string | null | undefined, right: string | null | undefined) {
  if (!left && !right) return true
  const l = splitIsoDateTime(left)
  const r = splitIsoDateTime(right)
  return l.date === r.date && l.time === r.time
}

function mergeTerminalOptions(active: TerminalOption[], historical: TerminalOption[]) {
  const options = new Map<string, TerminalOption>()
  for (const option of [...active, ...historical]) {
    const existing = options.get(option.id)
    options.set(option.id, existing && existing.active ? existing : option)
  }
  return [...options.values()].sort((left, right) => left.code.localeCompare(right.code))
}

function orderTerminalIds(
  scale: TerminalScaleState,
  fronts: Record<string, string>,
  dates: Record<string, TerminalDatesDraft>,
  terminalById: Map<string, TerminalOption>,
) {
  const ids = new Set(scale.terminals.flatMap((terminal) => terminal.terminalId ? [terminal.terminalId] : []))
  const tbcDates = dates.__tbc__
  const hasTbcData = Boolean(
    tbcDates?.etbDate || tbcDates?.atbDate || tbcDates?.etdDate || tbcDates?.atdDate || tbcDates?.restow,
  )
  if (scale.terminals.some((terminal) => terminal.terminalId === null && (
    terminal.etb || terminal.atb || terminal.etd || terminal.atd || terminal.restow !== null
  )) || hasTbcData) ids.add('__tbc__')
  for (const terminalId of Object.values(fronts)) if (terminalId) ids.add(terminalId)
  return sortAtracacoes([...ids].map((terminalId) => ({
    terminalId,
    terminalCode: terminalById.get(terminalId)?.code ?? 'TBC',
    etb: combineIsoDateTime(dates[terminalId]?.etbDate ?? '', dates[terminalId]?.etbTime ?? ''),
    atb: combineIsoDateTime(dates[terminalId]?.atbDate ?? '', dates[terminalId]?.atbTime ?? ''),
  }))).map((terminal) => terminal.terminalId as string)
}

function sameDraft(left: Record<string, unknown>, right: Record<string, unknown>) {
  const normalize = (value: Record<string, unknown>) => Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right))
}

function sameExportExpectation(left: Record<string, unknown>, right: Record<string, unknown>) {
  const normalize = (value: Record<string, unknown>) => ({
    ...value,
    discharge_ports: Array.isArray(value.discharge_ports)
      ? value.discharge_ports.map(String).map((port) => port.trim().toUpperCase()).sort()
      : [],
  })
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right))
}

function isRevisionConflictError(error: unknown) {
  const value = error as { code?: string; message?: string } | null
  return value?.code === 'ESCALA_REVISION_CONFLICT'
    || value?.code === 'P0001'
    || /REVISAO_OBSOLETA|revis[aã]o.*(obsoleta|atualizada)|vers[aã]o.*(obsoleta|atualizada)/i.test(value?.message ?? '')
}

function isClosedAdrError(error: unknown): error is { blockers: ClosedAdrBlocker[] } {
  const value = error as { code?: string; blockers?: ClosedAdrBlocker[]; message?: string } | null
  return value?.code === 'ADR_CLOSED_BLOCKED'
    || (Array.isArray(value?.blockers) && value.blockers.length > 0)
    || /ADR fechado/i.test(value?.message ?? '')
}

function buildTerminalPayload({
  terminalScale,
  terminalFronts,
  terminalDates,
  terminalStateChanged,
  justification,
  exportExpectation,
  initialExportExpectation,
}: {
  terminalScale: EscalaModalTerminalScale | null
  terminalFronts: Record<string, string>
  terminalDates: Record<string, TerminalDatesDraft>
  terminalStateChanged: boolean
  justification: string
  exportExpectation: Record<string, unknown>
  initialExportExpectation: Record<string, unknown>
}): { value?: EscalaModalPayload['terminalState']; error?: string } {
  if (!terminalScale) return {}
  if (terminalScale.loading) return { error: 'Aguarde o carregamento das frentes e terminais antes de salvar a escala.' }
  if (terminalScale.error) return { error: terminalScale.error }

  const frontsByKey = new Map(terminalScale.fronts.map((front) => [frontKey(front), front]))
  const fronts = terminalScale.fronts.flatMap((front) => {
    if (front.sentido === 'exportacao') {
      if (exportExpectation.tem_exportacao !== true) return []
      if (front.modalidade === 'granito' && exportExpectation.granito !== true) return []
      if (front.modalidade === 'vazio' && exportExpectation.has_empty !== true) return []
    }
    const terminalId = terminalFronts[frontKey(front)] || null
    return [{ sentido: front.sentido, modalidade: front.modalidade, terminalId, source: front.source }]
  })
  for (const modalidade of ['granito', 'vazio'] as const) {
    if (exportExpectation.tem_exportacao === true && exportExpectation[modalidade === 'vazio' ? 'has_empty' : modalidade] === true && !frontsByKey.has(`exportacao:${modalidade}`)) {
      fronts.push({ sentido: 'exportacao', modalidade, terminalId: null, source: 'export_declaration' })
    }
  }

  // O payload representa o estado atual das frentes. Manter todos os IDs que
  // vieram do state anterior deixava terminais sem frente persistidos depois
  // de uma realocação completa.
  const terminalIds = new Set<string>(
    fronts.flatMap((front) => front.terminalId ? [front.terminalId] : []),
  )
  const terminals: NonNullable<EscalaModalPayload['terminalState']>['terminals'] = []
  for (const terminalId of terminalIds) {
    const draft = terminalDates[terminalId] ?? emptyTerminalDatesDraft()
    const code = [...terminalScale.activeTerminals, ...terminalScale.historicalTerminals].find((option) => option.id === terminalId)?.code ?? 'TBC'

    if (draft.atbDate && !draft.atbTime.trim()) {
      return { error: `A hora do ATB é obrigatória quando a data estiver preenchida para o terminal ${code}.` }
    }

    const etb = combineIsoDateTime(draft.etbDate, draft.etbTime)
    const atb = combineIsoDateTime(draft.atbDate, draft.atbTime)
    const etd = combineIsoDateTime(draft.etdDate, draft.etdTime)
    const atd = combineIsoDateTime(draft.atdDate, draft.atdTime)

    if (atd && (!atb || atd < atb)) {
      return { error: `Informe o ATB antes do ATD do terminal ${code}; o ATD não pode ser anterior ao ATB.` }
    }
    const restow = draft.restow.trim() ? Number(draft.restow) : null
    if (restow !== null && (!Number.isInteger(restow) || restow < 0)) {
      return { error: `Restow inválido para o terminal ${terminalId}.` }
    }
    if (etd && (!etb || etd < etb)) {
      return { error: `Informe o ETB antes do ETD do terminal ${code}; o ETD não pode ser anterior ao ETB.` }
    }
    terminals.push({ terminalId, etb, atb, etd, atd, restow })
  }
  if (fronts.some((front) => !front.terminalId)) {
    const draft = terminalDates.__tbc__ ?? emptyTerminalDatesDraft()
    const etb = combineIsoDateTime(draft.etbDate, draft.etbTime)
    const atb = combineIsoDateTime(draft.atbDate, draft.atbTime)
    const etd = combineIsoDateTime(draft.etdDate, draft.etdTime)
    const atd = combineIsoDateTime(draft.atdDate, draft.atdTime)
    terminals.push({
      terminalId: null,
      etb,
      atb,
      etd,
      atd,
      restow: draft.restow.trim() ? Number(draft.restow) : null,
    })
  }

  const submittedFronts = fronts
    .map((front) => `${front.sentido}:${front.modalidade}:${front.terminalId ?? ''}:${front.source}`)
    .sort()
  const persistedFronts = terminalScale.fronts
    .map((front) => `${front.sentido}:${front.modalidade}:${front.terminalId ?? ''}:${front.source}`)
    .sort()
  const realizedDateChanged = terminals.some((terminal) => {
    const previous = terminalScale.terminals.find((candidate) => candidate.terminalId === terminal.terminalId)
    return (previous?.atb != null && !sameDateTimeValue(previous.atb, terminal.atb))
      || (previous?.atd != null && !sameDateTimeValue(previous.atd, terminal.atd))
  })
  const terminalizedStateChanged = terminalStateChanged
    || JSON.stringify(submittedFronts) !== JSON.stringify(persistedFronts)
  const exportExpectationChanged = !sameExportExpectation(exportExpectation, initialExportExpectation)
  if (terminalScale.revision > 0 && (terminalizedStateChanged || exportExpectationChanged || realizedDateChanged) && !justification.trim()) {
    return { error: 'Informe a justificativa para alterar o estado terminalizado existente da escala.' }
  }

  return {
    value: {
      expectedRevision: terminalScale.revision,
      fronts,
      terminals,
      exportExpectation,
      justification: justification.trim() || null,
    },
  }
}

function TerminalFrontEditor({
  scale,
  terminalFronts,
  terminalDates,
  terminalOptions,
  terminalById,
  terminalIds,
  onTerminalChange,
  onDateChange,
  justification,
  onJustificationChange,
  showJustification,
  error,
  blockers,
  onReopenAdr,
  focusTerminalId,
}: {
  scale: EscalaModalTerminalScale
  terminalFronts: Record<string, string>
  terminalDates: Record<string, TerminalDatesDraft>
  terminalOptions: TerminalOption[]
  terminalById: Map<string, TerminalOption>
  terminalIds: string[]
  onTerminalChange: (front: OperationFront, terminalId: string) => void
  onDateChange: (terminalId: string, field: keyof TerminalDatesDraft, value: string) => void
  justification: string
  onJustificationChange: (value: string) => void
  showJustification: boolean
  error: string | null
  blockers: ClosedAdrBlocker[]
  onReopenAdr?: (blocker: ClosedAdrBlocker) => void
  focusTerminalId?: string | null
}) {
  const sectionRef = useRef<HTMLElement>(null)
  const terminalRowRefs = useRef(new Map<string, HTMLDivElement>())
  const grouped = (['importacao', 'exportacao'] as OperationFrontDirection[]).map((sentido) => ({
    sentido,
    fronts: scale.fronts.filter((front) => front.sentido === sentido),
  })).filter((group) => group.fronts.length > 0)
  const terminalIdsKey = terminalIds.join('|')

  useEffect(() => {
    if (focusTerminalId === undefined) return
    const target = (focusTerminalId ? terminalRowRefs.current.get(focusTerminalId) : null) ?? sectionRef.current
    if (!target) return
    target.scrollIntoView?.({ block: 'center' })
    const focusTarget = (focusTerminalId ? target.querySelector<HTMLElement>('input, select') : null) ?? sectionRef.current
    const timeoutId = window.setTimeout(() => focusTarget?.focus(), 0)
    return () => window.clearTimeout(timeoutId)
  }, [focusTerminalId, terminalIdsKey])

  return (
    <section ref={sectionRef} tabIndex={-1} aria-label="Terminais por operação" className="app-escala-section app-escala-terminals">
      <div>
        <h3 className="app-escala-section__title">Terminais por operação</h3>
        <p className="app-escala-section__description">Cada operação ativa recebe seu próprio terminal. Sem atribuição, ela permanece em TBC e não cria uma atracação no planejamento.</p>
      </div>
      {grouped.map((group) => (
        <div key={group.sentido} className="app-escala-operation-group">
          <h4 className="app-escala-operation-group__title">{DIRECTION_LABELS[group.sentido]}</h4>
          {group.fronts.map((front) => {
            const selected = terminalFronts[frontKey(front)] ?? ''
            return (
              <div key={frontKey(front)} className="app-escala-operation-row">
                <div>
                  <div className="app-escala-operation-row__title">{DIRECTION_LABELS[front.sentido]} · {FRONT_LABELS[front.modalidade]}</div>
                  <div className={selected ? 'app-escala-operation-row__meta' : 'app-escala-operation-row__meta app-escala-operation-row__meta--pending'}>
                    {selected ? 'Terminal atribuído para esta operação' : 'TBC — pendente de atribuição de terminal'}
                  </div>
                </div>
                <label className="app-escala-field app-escala-field--compact">
                  Terminal
                  <select
                    aria-label={`Terminal da operação ${DIRECTION_LABELS[front.sentido]} ${FRONT_LABELS[front.modalidade]}`}
                    className="app-input mt-1"
                    value={selected}
                    onChange={(event) => onTerminalChange(front, event.target.value)}
                  >
                    <option value="">TBC</option>
                    {terminalOptions.map((option) => {
                      const isCurrent = option.id === selected
                      return (
                        <option key={option.id} value={option.id} disabled={!option.active && !isCurrent}>
                          {option.code}{!option.active ? ' (inativo · histórico)' : ''}
                        </option>
                      )
                    })}
                  </select>
                </label>
              </div>
            )
          })}
        </div>
      ))}

      <div className="app-escala-terminal-dates">
        <h4 className="app-escala-operation-group__title">Datas por terminal</h4>
        {terminalIds.length === 0 ? <p className="app-escala-section__description">Nenhum terminal atribuído ainda. A chegada ETA/ATA permanece na escala.</p> : null}
        {terminalIds.map((terminalId) => {
          const option = terminalId === '__tbc__' ? undefined : terminalById.get(terminalId)
          const draft = terminalDates[terminalId] ?? emptyTerminalDatesDraft()
          const code = terminalId === '__tbc__' ? 'TBC' : option?.code ?? 'TBC'
          return (
            <div
              key={terminalId}
              ref={(node) => {
                if (node) terminalRowRefs.current.set(terminalId, node)
                else terminalRowRefs.current.delete(terminalId)
              }}
              className="app-escala-terminal-date-row"
            >
              <div className="app-escala-terminal-date-row__name">
                {code}
                {option?.active === false ? <div className="app-escala-operation-row__meta app-escala-operation-row__meta--pending">Terminal inativo · histórico</div> : null}
              </div>
              <Field label={`ETB ${code}`}>
                <div className="flex gap-1">
                  <Input type="date" aria-label={`ETB ${code}`} value={draft.etbDate} onChange={(event) => onDateChange(terminalId, 'etbDate', event.target.value)} />
                  <Input type="time" aria-label={`ETB ${code} Hora`} value={draft.etbTime} onChange={(event) => onDateChange(terminalId, 'etbTime', event.target.value)} />
                </div>
              </Field>
              <Field label={`ATB ${code}`}>
                <div className="flex gap-1">
                  <Input type="date" aria-label={`ATB ${code}`} value={draft.atbDate} onChange={(event) => onDateChange(terminalId, 'atbDate', event.target.value)} />
                  <Input type="time" aria-label={`ATB ${code} Hora`} value={draft.atbTime} onChange={(event) => onDateChange(terminalId, 'atbTime', event.target.value)} />
                </div>
              </Field>
              <Field label={`ETD ${code}`}>
                <div className="flex gap-1">
                  <Input type="date" aria-label={`ETD ${code}`} value={draft.etdDate} onChange={(event) => onDateChange(terminalId, 'etdDate', event.target.value)} />
                  <Input type="time" aria-label={`ETD ${code} Hora`} value={draft.etdTime} onChange={(event) => onDateChange(terminalId, 'etdTime', event.target.value)} />
                </div>
              </Field>
              <Field label={`ATD ${code}`}>
                <div className="flex gap-1">
                  <Input type="date" aria-label={`ATD ${code}`} value={draft.atdDate} onChange={(event) => onDateChange(terminalId, 'atdDate', event.target.value)} />
                  <Input type="time" aria-label={`ATD ${code} Hora`} value={draft.atdTime} onChange={(event) => onDateChange(terminalId, 'atdTime', event.target.value)} />
                </div>
              </Field>
              <Field label={`Restow ${code}`}><Input type="number" min="0" step="1" value={draft.restow} onChange={(event) => onDateChange(terminalId, 'restow', event.target.value)} /></Field>
            </div>
          )
        })}
      </div>

      {showJustification ? (
        <Field label="Justificativa da alteração">
          <Input value={justification} onChange={(event) => onJustificationChange(event.target.value)} placeholder="Explique a troca de terminal, remoção ou ajuste de data" />
        </Field>
      ) : null}
      {error ? <p role="alert" className="text-xs text-red-300">{error}</p> : null}
      {blockers.length > 0 ? (
        <div className="grid gap-2 rounded-md border border-red-400/30 bg-red-950/20 p-2 text-xs text-red-100">
          {blockers.map((blocker) => (
            <div key={`${blocker.reportId ?? 'report'}-${blocker.terminalId ?? 'terminal'}`} className="flex flex-wrap items-center justify-between gap-2">
              <span>ADR fechado{blocker.terminalCode ? ` · terminal ${blocker.terminalCode}` : ''}{blocker.reportId ? ` · ${blocker.reportId}` : ''}</span>
              <Button type="button" variant="secondary" className="app-btn--sm" onClick={() => onReopenAdr?.(blocker)}>Reabrir ADR</Button>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  )
}

/**
 * Um porto, uma escala, um modal: importação e exportação da mesma escala são
 * declaradas aqui (ADR 0035, nota editorial de 2026-08-03).
 */
export function EscalaModal({
  open,
  escala,
  onClose,
  onSaved,
  onReopenAdr,
}: {
  open: boolean
  escala: EscalaModalData | null
  onClose: () => void
  onSaved: (payload: EscalaModalPayload) => Promise<void>
  onReopenAdr?: (blocker: ClosedAdrBlocker) => void
}) {
  const [port, setPort] = useState('')
  const [etaDate, setEtaDate] = useState('')
  const [etaTime, setEtaTime] = useState('')
  const [ataDate, setAtaDate] = useState('')
  const [ataTime, setAtaTime] = useState('')
  const [ceStatus, setCeStatus] = useState<EditableVoyagePodCeStatus>('waiting')
  const [linked, setLinked] = useState<'true' | 'false'>('false')
  const [escalaNumber, setEscalaNumber] = useState('')
  const [temImportacao, setTemImportacao] = useState(true)
  const [temExportacao, setTemExportacao] = useState(false)
  const [hasGranite, setHasGranite] = useState(false)
  const [hasEmpty, setHasEmpty] = useState(false)
  const [containersQty, setContainersQty] = useState('')
  const [movementsQty, setMovementsQty] = useState('')
  const [dischargePorts, setDischargePorts] = useState('')
  const [portError, setPortError] = useState<string | null>(null)
  const [exportError, setExportError] = useState<string | null>(null)
  const [terminalFronts, setTerminalFronts] = useState<Record<string, string>>({})
  const [terminalDates, setTerminalDates] = useState<Record<string, TerminalDatesDraft>>({})
  const [justification, setJustification] = useState('')
  const [terminalError, setTerminalError] = useState<string | null>(null)
  const [closedBlockers, setClosedBlockers] = useState<ClosedAdrBlocker[]>([])
  const [saving, setSaving] = useState(false)
  const confirm = useConfirm()
  const [touchedTerminalFronts, setTouchedTerminalFronts] = useState<Set<string>>(() => new Set())
  const [touchedTerminalDates, setTouchedTerminalDates] = useState<Set<string>>(() => new Set())

  const terminalScale = escala?.terminalScale ?? null
  // O ATD da Escala e derivado: existe so quando toda Atracacao desatracou, e
  // e o mais recente entre elas. Sem dizer de onde veio (ou o que falta), o
  // operador procura um campo ATD da Escala que nao existe mais.
  const atracacoesDoModal = terminalScale?.terminals ?? []
  const atracacaoLabel = (terminal: { terminalId: string | null; terminalCode?: string | null }) =>
    terminal.terminalCode ?? terminal.terminalId ?? 'TBC'
  const atracacoesSemAtd = atracacoesDoModal.filter((terminal) => !terminal.atd)
  const ultimaAtracacaoComAtd = atracacoesDoModal.length > 0 && atracacoesSemAtd.length === 0
    ? [...atracacoesDoModal].sort((left, right) => (left.atd ?? '').localeCompare(right.atd ?? '')).at(-1) ?? null
    : null
  const derivedTerminalAtd = ultimaAtracacaoComAtd?.atd ?? null
  // A lista de Atracacoes chega vazia enquanto carrega e quando a leitura
  // falha; afirmar "nenhuma registrada" nesses estados mente sobre uma escala
  // que pode ter Atracacoes.
  const derivedTerminalAtdHint = terminalScale?.loading
    ? 'Carregando as Atracações desta escala…'
    : terminalScale?.error
      ? 'Não foi possível ler as Atracações desta escala.'
      : ultimaAtracacaoComAtd
        ? `Derivado da última Atracação — ${atracacaoLabel(ultimaAtracacaoComAtd)}.`
        : atracacoesDoModal.length === 0
          ? 'Nasce das Atracações: nenhuma registrada nesta escala ainda.'
          : `Aguardando o ATD de ${atracacoesSemAtd.map(atracacaoLabel).join(', ')}.`
  const terminalScaleSourceKey = terminalScale
    ? [
        terminalScale.loading ? 'loading' : 'ready',
        terminalScale.error ?? '',
        terminalScale.revision,
        terminalScale.fronts.map((front) => `${frontKey(front)}:${front.terminalId ?? ''}`).join(','),
        terminalScale.terminals.map((terminal) => `${terminal.terminalId}:${terminal.etb ?? ''}:${terminal.atb ?? ''}:${terminal.etd ?? ''}:${terminal.atd ?? ''}:${terminal.restow ?? ''}`).join(','),
      ].join('|')
    : 'none'

  // O pai cria um payload novo a cada abertura; re-baseia os campos por
  // escala, durante o render (sem useEffect). O estado remoto dos terminais
  // chega depois do placeholder; nessa transição só campos ainda não tocados
  // pelo operador são hidratados.
  const [prevEscalaKey, setPrevEscalaKey] = useState<string | null>(null)
  const [prevTerminalScaleSourceKey, setPrevTerminalScaleSourceKey] = useState<string | null>(null)
  const escalaKey = escala ? `${escala.voyageId}:${escala.port ?? 'new'}` : null
  if (open && escala && escalaKey !== prevEscalaKey) {
    setPrevEscalaKey(escalaKey)
    setPrevTerminalScaleSourceKey(terminalScaleSourceKey)
    setTouchedTerminalFronts(new Set())
    setTouchedTerminalDates(new Set())
    setPort(escala.port ?? '')
    const etaParsed = splitIsoDateTime(escala.eta)
    const ataParsed = splitIsoDateTime(escala.ata)
    setEtaDate(etaParsed.date)
    setEtaTime(etaParsed.time)
    setAtaDate(ataParsed.date)
    setAtaTime(ataParsed.time)
    setCeStatus(getEditableVoyagePodCeStatus(escala.ceStatus))
    setLinked(escala.linked ? 'true' : 'false')
    setEscalaNumber(escala.escalaNumber ?? '')
    setTemImportacao(escala.temImportacao)
    setTemExportacao(escala.temExportacao)
    setHasGranite(escala.hasGranite)
    setHasEmpty(escala.hasEmpty)
    setContainersQty(escala.containersQty === null ? '' : String(escala.containersQty))
    setMovementsQty(escala.movementsQty === null ? '' : String(escala.movementsQty))
    setDischargePorts(escala.dischargePorts.join(', '))
    setPortError(null)
    setExportError(null)
    setTerminalError(null)
    setClosedBlockers([])
    setJustification('')
    const state = escala.terminalScale
    setTerminalFronts(Object.fromEntries(
      (state?.fronts ?? []).map((front) => [frontKey(front), front.terminalId ?? '']),
    ))
    setTerminalDates(Object.fromEntries(
      (state?.terminals ?? []).map((terminal) => [terminal.terminalId ?? '__tbc__', terminalToDatesDraft(terminal)]),
    ))
  } else if (open && escala && terminalScaleSourceKey !== prevTerminalScaleSourceKey) {
    const wasLoading = prevTerminalScaleSourceKey?.startsWith('loading|') ?? false
    setPrevTerminalScaleSourceKey(terminalScaleSourceKey)
    if (wasLoading && terminalScale && !terminalScale.loading && !terminalScale.error) {
      const hydratedFronts = { ...terminalFronts }
      for (const front of terminalScale.fronts) {
        const key = frontKey(front)
        if (!touchedTerminalFronts.has(key)) hydratedFronts[key] = front.terminalId ?? ''
      }
      const hydratedDates = { ...terminalDates }
      for (const terminal of terminalScale.terminals) {
        const terminalKey = terminal.terminalId ?? '__tbc__'
        const current = hydratedDates[terminalKey] ?? emptyTerminalDatesDraft()
        const scaleDraft = terminalToDatesDraft(terminal)
        const next = { ...current }
        for (const field of ['etbDate', 'etbTime', 'atbDate', 'atbTime', 'etdDate', 'etdTime', 'atdDate', 'atdTime', 'restow'] as const) {
          if (!touchedTerminalDates.has(`${terminalKey}:${field}`)) {
            next[field] = scaleDraft[field]
          }
        }
        hydratedDates[terminalKey] = next
      }
      setTerminalFronts(hydratedFronts)
      setTerminalDates(hydratedDates)
    }
  }

  const isNew = escala?.port === null
  const terminalOptions = terminalScale
    ? mergeTerminalOptions(terminalScale.activeTerminals, terminalScale.historicalTerminals)
      .filter((option) => terminalScale.portId == null || option.portId == null || option.portId === terminalScale.portId)
    : []
  const terminalById = new Map(terminalOptions.map((option) => [option.id, option]))
  const terminalIds = terminalScale
    ? orderTerminalIds(terminalScale, terminalFronts, terminalDates, terminalById)
    : []
  const initialTerminalFronts = Object.fromEntries(
    (terminalScale?.fronts ?? []).map((front) => [frontKey(front), front.terminalId ?? '']),
  )
  const initialTerminalDates = Object.fromEntries(
    (terminalScale?.terminals ?? []).map((terminal) => [terminal.terminalId ?? '__tbc__', terminalToDatesDraft(terminal)]),
  )
  const terminalStateChanged = terminalScale
    ? !sameDraft(terminalFronts, initialTerminalFronts) || !sameDraft(terminalDates, initialTerminalDates)
    : false
  const hasPriorTerminalAssignment = Boolean(
    terminalScale?.fronts.some((front) => front.terminalId !== null) || terminalScale?.terminals.length,
  )
  const operationMode: EscalaOperationMode = temImportacao && temExportacao
    ? 'both'
    : temExportacao
      ? 'export'
      : 'import'

  async function handleOperationModeChange(nextMode: EscalaOperationMode) {
    const nextTemImportacao = nextMode !== 'export'
    const nextTemExportacao = nextMode !== 'import'
    if (!nextTemExportacao && temExportacao) {
      if (escala?.exportLocked) return
      const confirmed = await confirm({
        title: 'Retirar a exportação desta escala',
        message: 'As frentes de exportação e o planejamento digitado (containers, movimentos e portos de descarga) serão removidos ao salvar. Continuar?',
        confirmLabel: 'Retirar',
        tone: 'danger',
      })
      if (!confirmed) return
      setHasGranite(false)
      setHasEmpty(false)
      setContainersQty('')
      setMovementsQty('')
      setDischargePorts('')
    }
    setTemImportacao(nextTemImportacao)
    setTemExportacao(nextTemExportacao)
    setExportError(null)
  }

  async function handleDeclarationChange(kind: 'granito' | 'vazios', next: boolean) {
    if (!next && kind === 'granito' && (escala?.graniteLocked ?? escala?.exportLocked)) return
    if (!next && kind === 'vazios' && (escala?.emptyLocked ?? escala?.exportLocked)) return

    const nextHasGranite = kind === 'granito' ? next : hasGranite
    const nextHasEmpty = kind === 'vazios' ? next : hasEmpty
    if (next) setTemExportacao(true)
    setExportError(null)
    const hasPlanning = containersQty.trim() !== '' || movementsQty.trim() !== '' || dischargePorts.trim() !== ''
    if (!nextHasGranite && !nextHasEmpty && hasPlanning) {
      const confirmed = await confirm({
        title: 'Retirar a exportação desta escala',
        message: 'O planejamento de exportação digitado (containers, movimentos e portos de descarga) será descartado. Continuar?',
        confirmLabel: 'Retirar',
        tone: 'danger',
      })
      if (!confirmed) return
      setContainersQty('')
      setMovementsQty('')
      setDischargePorts('')
    }
    setHasGranite(nextHasGranite)
    setHasEmpty(nextHasEmpty)
  }

  function handleTerminalChange(front: OperationFront, nextTerminalId: string) {
    const key = frontKey(front)
    setTouchedTerminalFronts((current) => new Set(current).add(key))
    setTerminalFronts((current) => ({ ...current, [key]: nextTerminalId }))
    if (nextTerminalId) {
      setTerminalDates((current) => current[nextTerminalId] ? current : {
        ...current,
        [nextTerminalId]: emptyTerminalDatesDraft(),
      })
    }
    setTerminalError(null)
    setClosedBlockers([])
  }

  function handleTerminalDateChange(terminalId: string, field: keyof TerminalDatesDraft, value: string) {
    setTouchedTerminalDates((current) => new Set(current).add(`${terminalId}:${field}`))
    setTerminalDates((current) => ({
      ...current,
      [terminalId]: { ...(current[terminalId] ?? emptyTerminalDatesDraft()), [field]: value },
    }))
    setTerminalError(null)
    setClosedBlockers([])
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!escala) return

    const normalizedPort = normalizePortCode(port) ?? port.trim().toUpperCase()
    if (!normalizedPort) {
      setPortError('Informe o porto da escala.')
      return
    }
    if (!normalizedPort.startsWith('BR')) {
      setPortError('A escala é de porto brasileiro; portos estrangeiros da rota não são escalas.')
      return
    }
    setPortError(null)

    if (ataDate && !ataTime.trim()) {
      setTerminalError('A hora do ATA é obrigatória quando a data estiver preenchida.')
      return
    }

    const isLegacyUnclassifiedExport = Boolean(
      escala.exportExistingId && escala.temExportacao && !escala.hasGranite && !escala.hasEmpty,
    )
    if (temExportacao && !hasGranite && !hasEmpty && !isLegacyUnclassifiedExport) {
      setExportError('Uma nova declaração de exportação exige granito ou vazios.')
      return
    }
    const terminalPayload = buildTerminalPayload({
      terminalScale,
      terminalFronts,
      terminalDates,
      terminalStateChanged,
      justification,
      exportExpectation: {
        tem_exportacao: temExportacao,
        granito: temExportacao ? hasGranite : false,
        vazios: temExportacao ? hasEmpty : false,
        has_empty: temExportacao ? hasEmpty : false,
        containers_qty: temExportacao && containersQty.trim() ? Number(containersQty) : null,
        movements_qty: temExportacao && movementsQty.trim() ? Number(movementsQty) : null,
        discharge_ports: temExportacao ? normalizeDischargePorts(dischargePorts.split(/[,;/\s]+/)) : [],
        ce_status: ceStatus,
        linked: linked === 'true',
      },
      initialExportExpectation: {
        tem_exportacao: escala.temExportacao,
        granito: escala.temExportacao ? escala.hasGranite : false,
        vazios: escala.temExportacao ? escala.hasEmpty : false,
        has_empty: escala.temExportacao ? escala.hasEmpty : false,
        containers_qty: escala.temExportacao ? escala.containersQty : null,
        movements_qty: escala.temExportacao ? escala.movementsQty : null,
        discharge_ports: escala.temExportacao ? escala.dischargePorts : [],
        ce_status: getEditableVoyagePodCeStatus(escala.ceStatus),
        linked: Boolean(escala.linked),
      },
    })
    if (terminalPayload.error) {
      setTerminalError(terminalPayload.error)
      return
    }

    setSaving(true)
    try {
      await onSaved({
        voyageId: escala.voyageId,
        port: normalizedPort,
        temImportacao,
        eta: combineIsoDateTime(etaDate, etaTime),
        ata: combineIsoDateTime(ataDate, ataTime),
        ceStatus,
        linked: linked === 'true',
        escalaNumber: escalaNumber.trim() || null,
        exportacao: {
          temExportacao,
          hasGranite: temExportacao ? hasGranite : false,
          hasEmpty: temExportacao ? hasEmpty : false,
          containersQty: temExportacao && containersQty.trim() ? Number(containersQty) : null,
          movementsQty: temExportacao && movementsQty.trim() ? Number(movementsQty) : null,
          dischargePorts: temExportacao ? normalizeDischargePorts(dischargePorts.split(/[,;/\s]+/)) : [],
        },
        exportExistingId: escala.exportExistingId,
        terminalState: terminalPayload.value,
      })
      setTerminalError(null)
      setClosedBlockers([])
    } catch (error) {
      if (isClosedAdrError(error)) {
        setClosedBlockers(error.blockers)
        setTerminalError('A alteração não foi aplicada porque existe ADR fechado. Reabra o ADR indicado e tente novamente.')
      } else if (isRevisionConflictError(error)) {
        setTerminalError('A escala foi atualizada por outra pessoa. Seus dados foram preservados; recarregue a escala antes de salvar novamente.')
      } else {
        setTerminalError(error instanceof Error ? error.message : 'Falha ao salvar a escala.')
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isNew ? 'Adicionar escala' : 'Editar escala'}
      className="app-modal--escala"
      bodyClassName="app-modal__body--escala"
    >
      {escala ? (
        <form className="app-escala-form" onSubmit={handleSubmit}>
          <div className="app-escala-summary">
            <div>
              <div className="app-escala-summary__voyage">{escala.voyageLabel}</div>
              <div className="app-escala-summary__meta">
              {isNew
                ? 'Uma escala pode descarregar importação, embarcar exportação ou as duas.'
                : `Escala: ${escala.port}`}
              </div>
            </div>
            <div className="app-escala-summary__status">{operationMode === 'both' ? 'Importação + exportação' : operationMode === 'import' ? 'Importação' : 'Exportação'}</div>
          </div>

          {isNew ? (
            <div className="app-escala-section"><Field label="Porto da escala" error={portError ?? undefined}>
              <Input
                list="escala-port-suggestions"
                value={port}
                onChange={(event) => setPort(event.target.value.toUpperCase())}
                placeholder="Ex.: BRVIX"
              />
              <datalist id="escala-port-suggestions">
                {ESCALA_PORT_SUGGESTIONS.map((value) => (
                  <option key={value} value={value} />
                ))}
              </datalist>
            </Field></div>
          ) : null}

          <section aria-label="Chegada ao porto" className="app-escala-section">
            <div className="app-escala-section__heading">
              <div>
                <h3 className="app-escala-section__title">Chegada ao porto</h3>
                <p className="app-escala-section__description">Datas gerais da escala.</p>
              </div>
            </div>
            <div className="app-escala-field-grid app-escala-field-grid--three">
              <Field label="ETA">
                <div className="flex gap-1">
                  <Input type="date" aria-label="ETA" value={etaDate} onChange={(event) => setEtaDate(event.target.value)} />
                  <Input type="time" aria-label="ETA Hora" value={etaTime} onChange={(event) => setEtaTime(event.target.value)} />
                </div>
              </Field>
              <Field label="ATA">
                <div className="flex gap-1">
                  <Input type="date" aria-label="ATA" value={ataDate} onChange={(event) => setAtaDate(event.target.value)} />
                  <Input type="time" aria-label="ATA Hora" value={ataTime} onChange={(event) => setAtaTime(event.target.value)} />
                </div>
              </Field>
              <Field label="ATD derivado" hint={derivedTerminalAtdHint}>
                <Input value={derivedTerminalAtd ? formatDateTimeBR(derivedTerminalAtd) : '—'} readOnly aria-readonly="true" aria-label="ATD derivado" />
              </Field>
            </div>
          </section>

          <section aria-label="Operação da escala" className="app-escala-section">
            <div className="app-escala-section__heading">
              <div>
                <h3 className="app-escala-section__title">Operação da escala</h3>
                <p className="app-escala-section__description">Escolha o que será operado nesta escala. Isso define as operações e os terminais que precisam ser planejados.</p>
              </div>
            </div>
            <div className="app-escala-operation-modes" role="group" aria-label="Modo de operação">
              {([
                ['import', 'Somente importação', 'Descarregamento no porto da escala'],
                ['both', 'Importação + exportação', 'Descarregamento e embarque na mesma escala'],
                ['export', 'Somente exportação', 'Embarque de carga nesta escala'],
              ] as const).map(([mode, title, description]) => (
                <button
                  key={mode}
                  type="button"
                  className={`app-escala-operation-mode${operationMode === mode ? ' app-escala-operation-mode--active' : ''}`}
                  aria-label={title}
                  aria-pressed={operationMode === mode}
                  onClick={() => { void handleOperationModeChange(mode) }}
                >
                  <span className="app-escala-operation-mode__title">{title}</span>
                  <span className="app-escala-operation-mode__description">{description}</span>
                </button>
              ))}
            </div>

            {temExportacao ? (
              <div className="app-escala-export-block">
                <div className="app-escala-subsection-title">Carga de exportação</div>
                <div className="app-escala-cargo-options">
                  <button
                    type="button"
                    className={`app-escala-cargo-option${hasGranite ? ' app-escala-cargo-option--active' : ''}`}
                    aria-pressed={hasGranite}
                    disabled={Boolean((escala.graniteLocked ?? escala.exportLocked) && hasGranite)}
                    onClick={() => { void handleDeclarationChange('granito', !hasGranite) }}
                  >
                    Granito
                  </button>
                  <button
                    type="button"
                    className={`app-escala-cargo-option${hasEmpty ? ' app-escala-cargo-option--active' : ''}`}
                    aria-pressed={hasEmpty}
                    disabled={Boolean((escala.emptyLocked ?? escala.exportLocked) && hasEmpty)}
                    onClick={() => { void handleDeclarationChange('vazios', !hasEmpty) }}
                  >
                    Embarque de vazios
                  </button>
                </div>
                {hasEmpty ? (
                  <div className="app-escala-empty-planning">
                    <div className="app-escala-subsection-title">Planejamento do embarque de vazios</div>
                    <div className="app-escala-field-grid app-escala-field-grid--two">
                      <Field label="Quantidade de CNTR vazios">
                        <Input
                          type="number"
                          min="0"
                          step="1"
                          value={containersQty}
                          onChange={(event) => setContainersQty(event.target.value)}
                          placeholder="Opcional; quantidade operada"
                        />
                      </Field>
                      <Field label="Movimentos">
                        <Input
                          type="number"
                          min="0"
                          step="1"
                          value={movementsQty}
                          onChange={(event) => setMovementsQty(event.target.value)}
                          placeholder="Opcional; quantidade operada"
                        />
                      </Field>
                    </div>
                  </div>
                ) : null}
                {(hasGranite || hasEmpty) ? (
                  <div className="app-escala-export-destination">
                    <Field label="Portos de descarga">
                      <Input
                        value={dischargePorts}
                        onChange={(event) => setDischargePorts(event.target.value.toUpperCase())}
                        placeholder="Ex.: ITGOA, NLRTM"
                      />
                    </Field>
                    <p className="app-escala-section__description">Destino da carga embarcada nesta escala. Separe por vírgula; isso forma a perna de exportação da rota.</p>
                  </div>
                ) : null}
              </div>
            ) : null}
            {exportError ? <p role="alert" className="app-escala-error">{exportError}</p> : null}
            {escala.exportLocked && (hasGranite || hasEmpty) ? (
              <p className="app-escala-section__description">Há carga de exportação vinculada a esta escala; a declaração só pode ser retirada depois que a carga deixar de existir.</p>
            ) : null}
          </section>

          <section aria-label="BLs e CEs" className="app-escala-section">
            <div className="app-escala-section__heading">
              <div>
                <h3 className="app-escala-section__title">BLs e CEs</h3>
                <p className="app-escala-section__description">Status documental da importação e vínculo da escala.</p>
              </div>
            </div>
            <div className="app-escala-field-grid app-escala-field-grid--three">
              <Field label="BLs e CEs">
                <select className="app-input" value={ceStatus} onChange={(event) => setCeStatus(event.target.value as EditableVoyagePodCeStatus)}>
                  {POD_CE_STATUS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </Field>
              <Field label="Vinculada">
                <select className="app-input" value={linked} onChange={(event) => setLinked(event.target.value as 'true' | 'false')}>
                  <option value="true">SIM</option>
                  <option value="false">NÃO</option>
                </select>
              </Field>
              <Field label="Nº escala (Mercante)">
                <Input value={escalaNumber} onChange={(event) => setEscalaNumber(event.target.value)} placeholder="Ex.: 25BR00481" />
              </Field>
            </div>
          </section>

          <div className="app-escala-terminal-container">
            {terminalScale?.loading ? (
              <div className="app-escala-section app-escala-loading">Carregando operações e terminais da escala…</div>
            ) : terminalScale ? (
              <TerminalFrontEditor
                scale={terminalScale}
                terminalFronts={terminalFronts}
                terminalDates={terminalDates}
                terminalOptions={terminalOptions}
                terminalById={terminalById}
                terminalIds={terminalIds}
                onTerminalChange={handleTerminalChange}
                onDateChange={handleTerminalDateChange}
                justification={justification}
                onJustificationChange={setJustification}
                showJustification={hasPriorTerminalAssignment || terminalScale.revision > 0}
                error={terminalError ?? terminalScale.error ?? null}
                blockers={closedBlockers}
                onReopenAdr={onReopenAdr}
                focusTerminalId={escala.focusTerminalId}
              />
            ) : terminalError ? (
              <p role="alert" className="text-xs text-red-300 px-4 py-2">{terminalError}</p>
            ) : null}
          </div>

          <div className="app-modal__actions app-escala-actions">
            <Button variant="secondary" type="button" onClick={onClose}>
              Voltar
            </Button>
            <Button loading={saving} disabled={saving || Boolean(terminalScale?.loading || terminalScale?.error)} type="submit">
              {isNew ? 'Adicionar escala' : 'Salvar escala'}
            </Button>
          </div>
        </form>
      ) : null}
    </Modal>
  )
}
