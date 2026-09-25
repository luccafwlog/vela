import { useEffect, useId, useRef, useState } from 'react'
import { History } from 'lucide-react'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { formatDate } from '../../lib/utils'
import { signoffLabels, type AgencyReportSection, type AgencyReportSignoffEvent, type SignoffState } from '../../services/agencyDepartureReport'

const segmentModifier: Record<SignoffState, string> = {
  pending: 'app-signoff__segment--pending',
  confirmed: 'app-signoff__segment--confirmed',
  nothing_to_declare: 'app-signoff__segment--nothing',
}

// A primeira saída de "pending" é a primeira decisão da seção: só pede
// confirmação. Alterar uma decisão já registrada (voltar a pending ou trocar
// confirmed<->nothing_to_declare) exige justificativa, porque desfaz algo que
// já entrou no histórico.
function actionModeFor(current: SignoffState): 'confirm' | 'justify' {
  return current === 'pending' ? 'confirm' : 'justify'
}

export function SignoffControl({
  section,
  state,
  attribution,
  departmentLabel,
  canSignoff,
  events,
  actorNames,
  isPending,
  compact = false,
  onChange,
}: {
  section: AgencyReportSection
  state: SignoffState
  attribution?: string | null
  departmentLabel: string
  canSignoff: boolean
  events: AgencyReportSignoffEvent[]
  actorNames: Record<string, string>
  isPending?: boolean
  compact?: boolean
  onChange: (section: AgencyReportSection, nextState: SignoffState, justification?: string) => void
}) {
  const [pendingAction, setPendingAction] = useState<{ nextState: SignoffState; mode: 'confirm' | 'justify' } | null>(null)
  const [justification, setJustification] = useState('')
  const [historyOpen, setHistoryOpen] = useState(false)
  const [compactOpen, setCompactOpen] = useState(false)
  const compactContainerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!compactOpen) return
    const handleClickOutside = (event: MouseEvent | TouchEvent) => {
      if (compactContainerRef.current && !compactContainerRef.current.contains(event.target as Node)) {
        setCompactOpen(false)
      }
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setCompactOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('touchstart', handleClickOutside)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('touchstart', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [compactOpen])

  const openAction = (nextState: SignoffState) => {
    if (nextState === state) return
    setJustification('')
    setPendingAction({ nextState, mode: actionModeFor(state) })
  }

  const closeAction = () => {
    setPendingAction(null)
    setJustification('')
  }

  const confirmAction = () => {
    if (!pendingAction) return
    if (pendingAction.mode === 'justify' && !justification.trim()) return
    onChange(section, pendingAction.nextState, pendingAction.mode === 'justify' ? justification.trim() : undefined)
    closeAction()
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {!compact ? <span className="text-xs text-[var(--app-muted)]">Setor: {departmentLabel}</span> : null}
      {attribution ? <span className="text-xs text-[var(--app-muted)]">{attribution}</span> : null}
      {events.length ? (
        <button
          type="button"
          className="inline-flex min-h-[40px] min-w-[40px] items-center justify-center rounded-full text-[var(--app-muted)] hover:text-[var(--app-text)]"
          aria-label={`Ver histórico de ${signoffLabels[state]}`}
          title="Ver histórico"
          onClick={() => setHistoryOpen(true)}
        >
          <History size={16} />
        </button>
      ) : null}
      {canSignoff ? (
        compact ? (
          <div ref={compactContainerRef} className="relative flex items-center gap-2">
            <button
              type="button"
              className={`app-badge ${state === 'confirmed' ? 'app-badge--green' : state === 'nothing_to_declare' ? 'app-badge--yellow' : 'app-badge--slate'}`}
              aria-expanded={compactOpen}
              onClick={() => setCompactOpen((value) => !value)}
            >
              {signoffLabels[state]}
            </button>
            <button
              type="button"
              className="app-btn app-btn--secondary app-btn--sm"
              onClick={() => setCompactOpen((value) => !value)}
              aria-label={`Alterar resolução de ${departmentLabel}`}
            >
              Alterar
            </button>
            {compactOpen ? (
              <div className="absolute right-0 top-full z-10 mt-2 grid min-w-44 gap-1 rounded-lg border border-[var(--app-border)] bg-[var(--app-surface)] p-2 shadow-lg" role="group" aria-label="Resolução da seção">
                {(Object.keys(signoffLabels) as SignoffState[]).map((option) => (
                  <button
                    key={option}
                    type="button"
                    className={`rounded-md px-2.5 py-2 text-left text-xs font-semibold transition-colors hover:bg-[var(--app-surface-muted)] ${state === option ? 'text-[var(--app-text-strong)]' : 'text-[var(--app-muted)]'}`}
                    aria-pressed={state === option}
                    disabled={isPending}
                    onClick={() => { setCompactOpen(false); openAction(option) }}
                  >
                    {signoffLabels[option]}
                </button>
              ))}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="app-signoff" role="group" aria-label={`Sign-off da seção`}>
            {(Object.keys(signoffLabels) as SignoffState[]).map((option) => (
              <button
                key={option}
                type="button"
                className={`app-signoff__segment ${segmentModifier[option]}`}
                aria-pressed={state === option}
                disabled={isPending}
                onClick={() => openAction(option)}
              >
                {signoffLabels[option]}
              </button>
            ))}
          </div>
        )
      ) : (
        <span className="app-badge app-badge--slate">{signoffLabels[state]}</span>
      )}

      <SignoffActionModal
        open={pendingAction !== null}
        mode={pendingAction?.mode ?? 'confirm'}
        nextState={pendingAction?.nextState ?? 'pending'}
        justification={justification}
        onJustificationChange={setJustification}
        onCancel={closeAction}
        onConfirm={confirmAction}
      />
      <SignoffHistoryModal
        open={historyOpen}
        events={events}
        actorNames={actorNames}
        onClose={() => setHistoryOpen(false)}
      />
    </div>
  )
}

function SignoffActionModal({
  open,
  mode,
  nextState,
  justification,
  onJustificationChange,
  onCancel,
  onConfirm,
}: {
  open: boolean
  mode: 'confirm' | 'justify'
  nextState: SignoffState
  justification: string
  onJustificationChange: (value: string) => void
  onCancel: () => void
  onConfirm: () => void
}) {
  const textareaId = useId()
  if (!open) return null

  return (
    <Modal open={open} title={mode === 'confirm' ? 'Confirmar decisão' : 'Justificar alteração'} onClose={onCancel}>
      <p className="text-sm text-[var(--app-text)]">
        {mode === 'confirm'
          ? <>Marcar esta seção como <strong>{signoffLabels[nextState]}</strong>?</>
          : <>Esta seção já tem uma decisão registrada. Alterar para <strong>{signoffLabels[nextState]}</strong> exige justificativa e fica no histórico.</>}
      </p>
      {mode === 'justify' ? (
        <label htmlFor={textareaId} className="mt-3 grid gap-2 text-sm">
          Justificativa
          <textarea
            id={textareaId}
            value={justification}
            onChange={(event) => onJustificationChange(event.target.value)}
            autoFocus
            className="min-h-24 rounded border border-[var(--app-border)] bg-transparent p-2"
          />
        </label>
      ) : null}
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>Voltar</Button>
        <Button variant="primary" disabled={mode === 'justify' && !justification.trim()} onClick={onConfirm}>Confirmar</Button>
      </div>
    </Modal>
  )
}

function SignoffHistoryModal({
  open,
  events,
  actorNames,
  onClose,
}: {
  open: boolean
  events: AgencyReportSignoffEvent[]
  actorNames: Record<string, string>
  onClose: () => void
}) {
  if (!open) return null

  return (
    <Modal open={open} title="Histórico da seção" onClose={onClose}>
      <div className="app-signoff-history">
        {events.map((event) => {
          const actor = (event.changed_by && actorNames[event.changed_by]) || '—'
          const from = event.old_value ? signoffLabels[event.old_value as SignoffState] : '—'
          const to = event.new_value ? signoffLabels[event.new_value as SignoffState] : '—'
          return (
            <div key={event.id} className="app-signoff-history__item">
              <span className="text-sm font-semibold text-[var(--app-text)]">{from} → {to}</span>
              <span className="text-xs text-[var(--app-muted)]">{actor} · {formatDate(event.changed_at)}</span>
              {event.justification ? <span className="text-sm text-[var(--app-text)]">{event.justification}</span> : null}
            </div>
          )
        })}
      </div>
    </Modal>
  )
}
