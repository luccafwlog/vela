/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useId, useMemo, useRef, useState, type PropsWithChildren } from 'react'
import { AlertTriangle, ArrowRightCircle, Ban, ChevronDown, Info, Search, Undo2 } from 'lucide-react'
import { Button } from './Button'
import { Modal } from './Modal'

/**
 * Registros afetados por uma acao (ADR 0072): um resumo com totais e, sob
 * demanda, a lista completa. Bloqueados aparecem com o motivo.
 */
export type ConfirmAffected = {
  summary: string
  items?: string[]
  blocked?: Array<{ label: string; reasons: string[] }>
}

export type ConfirmFieldChange = { field: string; before: string; after: string }

type ConfirmOptions = {
  /** Texto principal: o que sera feito, com o termo do vocabulario. */
  message: string
  title?: string
  confirmLabel?: string
  /** Rotulo do botao que fecha sem executar. Padrao: "Voltar" (ADR 0072). */
  cancelLabel?: string
  tone?: 'danger' | 'primary'
  affected?: ConfirmAffected
  /** Consequencia visivel: onde muda, quem ve, o que recalcula ou envia. */
  consequence?: string
  /** Se da para desfazer e como. */
  reversibility?: string
  /** Campos alterados, para confirmar um Salvar. */
  changes?: ConfirmFieldChange[]
}

type ReasonOptions = ConfirmOptions & { reasonLabel?: string }

type ConfirmState = ReasonOptions & { open: boolean; requireReason: boolean }

type Settlement = { confirmed: boolean; reason: string }

type ConfirmContextValue = {
  confirm: (options: ConfirmOptions) => Promise<boolean>
  confirmWithReason: (options: ReasonOptions) => Promise<string | null>
}

const ConfirmContext = createContext<ConfirmContextValue | null>(null)

const CLOSED: ConfirmState = { open: false, message: '', requireReason: false }

/** Acima disso, os bloqueados aparecem agrupados por motivo e a lista abre sob demanda. */
const BLOCKED_INLINE_LIMIT = 5
/** Acima disso, a lista ganha um filtro. */
const FILTER_THRESHOLD = 12
// ponytail: a lista renderiza no máximo 500 linhas filtradas; lotes maiores
// pedem para refinar o filtro. Se lotes de milhares virarem rotina, trocar por
// lista virtualizada.
const RENDER_LIMIT = 500

function countByReason(blocked: NonNullable<ConfirmAffected['blocked']>) {
  const counts = new Map<string, number>()
  for (const b of blocked) {
    for (const r of b.reasons.length > 0 ? b.reasons : ['sem motivo informado']) {
      counts.set(r, (counts.get(r) ?? 0) + 1)
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])
}

function RecordList({
  entries,
  noun,
  variant = 'items',
}: {
  entries: Array<{ label: string; detail?: string }>
  noun: string
  variant?: 'items' | 'blocked'
}) {
  const [filter, setFilter] = useState('')
  const filterId = useId()
  const needle = filter.trim().toLocaleLowerCase('pt-BR')
  const matches = needle
    ? entries.filter((e) => `${e.label} ${e.detail ?? ''}`.toLocaleLowerCase('pt-BR').includes(needle))
    : entries
  const visible = matches.slice(0, RENDER_LIMIT)
  const hasFilter = entries.length > FILTER_THRESHOLD

  return (
    <div className="app-confirm__list">
      {hasFilter ? (
        <div className="app-confirm__filter">
          <Search size={14} aria-hidden="true" />
          <input
            id={filterId}
            type="search"
            className="app-confirm__filter-input"
            placeholder={`Filtrar ${noun}`}
            aria-label={`Filtrar ${noun}`}
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
          <span className="app-confirm__filter-count" aria-live="polite">
            {matches.length === entries.length ? `${entries.length}` : `${matches.length} de ${entries.length}`}
          </span>
        </div>
      ) : null}
      {visible.length > 0 ? (
        <ul className={variant === 'blocked' ? 'app-confirm__blocked-list' : 'app-confirm__items'}>
          {visible.map((e, index) =>
            variant === 'blocked' ? (
              <li key={`${index}-${e.label}`}>
                <span className="app-confirm__blocked-label">{e.label}</span>
                <span className="app-confirm__blocked-reasons">{e.detail}</span>
              </li>
            ) : (
              <li key={`${index}-${e.label}`}>{e.label}</li>
            ),
          )}
        </ul>
      ) : (
        <p className="app-confirm__empty">Nenhum registro corresponde ao filtro.</p>
      )}
      {matches.length > visible.length ? (
        <p className="app-confirm__empty">
          Mostrando {visible.length} de {matches.length}. Use o filtro para localizar os demais.
        </p>
      ) : null}
    </div>
  )
}

export function ConfirmDialogProvider({ children }: PropsWithChildren) {
  const [state, setState] = useState<ConfirmState>(CLOSED)
  const [reason, setReason] = useState('')
  const [showAll, setShowAll] = useState(false)
  const [showBlocked, setShowBlocked] = useState(false)
  const resolveRef = useRef<((value: Settlement) => void) | null>(null)
  const reasonRef = useRef<HTMLTextAreaElement>(null)
  const backRef = useRef<HTMLButtonElement>(null)
  const reasonId = useId()

  const settle = useCallback((value: Settlement) => {
    resolveRef.current?.(value)
    resolveRef.current = null
    setState((prev) => ({ ...prev, open: false }))
  }, [])

  const open = useCallback((options: ReasonOptions, requireReason: boolean) => {
    return new Promise<Settlement>((resolve) => {
      // Um diálogo novo substitui o aberto: o anterior encerra como Voltar,
      // em vez de deixar a ação dele esperando para sempre.
      resolveRef.current?.({ confirmed: false, reason: '' })
      resolveRef.current = resolve
      setReason('')
      setShowAll(false)
      setShowBlocked(false)
      setState({ ...options, requireReason, open: true })
    })
  }, [])

  const confirm = useCallback(
    (options: ConfirmOptions) => open(options, false).then((result) => result.confirmed),
    [open],
  )

  const confirmWithReason = useCallback(
    (options: ReasonOptions) =>
      open(options, true).then((result) => (result.confirmed ? result.reason : null)),
    [open],
  )

  const value = useMemo(() => ({ confirm, confirmWithReason }), [confirm, confirmWithReason])
  const trimmedReason = reason.trim()
  const canConfirm = !state.requireReason || trimmedReason.length > 0
  const items = state.affected?.items ?? []
  const blocked = state.affected?.blocked ?? []

  const danger = state.tone === 'danger'
  const LeadIcon = danger ? AlertTriangle : Info

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      <Modal
        open={state.open}
        title={state.title ?? 'Confirmar ação'}
        onClose={() => settle({ confirmed: false, reason: '' })}
        initialFocusRef={state.requireReason ? reasonRef : backRef}
        className="app-confirm"
        bodyClassName="app-confirm__body"
      >
        <div className={`app-confirm__lead app-confirm__lead--${danger ? 'danger' : 'primary'}`}>
          <span className="app-confirm__lead-icon" aria-hidden="true"><LeadIcon size={20} /></span>
          <p className="app-confirm__message">{state.message}</p>
        </div>

        {state.affected ? (
          <section aria-label="Registros afetados" className="app-confirm__panel">
            <div className="app-confirm__panel-head">
              <p className="app-confirm__summary">{state.affected.summary}</p>
              {items.length > 0 ? (
                <button
                  type="button"
                  className="app-confirm__toggle"
                  onClick={() => setShowAll((v) => !v)}
                  aria-expanded={showAll}
                >
                  {showAll ? 'Ocultar lista' : `Ver lista (${items.length})`}
                  <ChevronDown size={14} aria-hidden="true" className={showAll ? 'rotate-180' : undefined} />
                </button>
              ) : null}
            </div>
            {items.length > 0 && showAll ? (
              <RecordList entries={items.map((item) => ({ label: item }))} noun="registros" />
            ) : null}
          </section>
        ) : null}

        {blocked.length > 0 ? (
          <section aria-label="Registros bloqueados" className="app-confirm__blocked">
            <div className="app-confirm__panel-head">
              <p className="app-confirm__blocked-title">
                <Ban size={15} aria-hidden="true" />
                Não serão alterados ({blocked.length})
              </p>
              {blocked.length > BLOCKED_INLINE_LIMIT ? (
                <button
                  type="button"
                  className="app-confirm__toggle"
                  onClick={() => setShowBlocked((v) => !v)}
                  aria-expanded={showBlocked}
                >
                  {showBlocked ? 'Ocultar bloqueados' : `Ver bloqueados (${blocked.length})`}
                  <ChevronDown size={14} aria-hidden="true" className={showBlocked ? 'rotate-180' : undefined} />
                </button>
              ) : null}
            </div>
            {blocked.length > BLOCKED_INLINE_LIMIT ? (
              <ul className="app-confirm__reason-counts" aria-label="Motivos dos bloqueios">
                {countByReason(blocked).map(([reasonText, count]) => (
                  <li key={reasonText}><span>{reasonText}</span><strong>{count}</strong></li>
                ))}
              </ul>
            ) : null}
            {blocked.length <= BLOCKED_INLINE_LIMIT || showBlocked ? (
              <RecordList
                entries={blocked.map((b) => ({ label: b.label, detail: b.reasons.join(', ') }))}
                noun="bloqueados"
                variant="blocked"
              />
            ) : null}
          </section>
        ) : null}

        {state.changes && state.changes.length > 0 ? (
          <div className="app-confirm__changes">
            <table aria-label="Campos alterados">
              <thead><tr><th scope="col">Campo</th><th scope="col">Antes</th><th scope="col">Depois</th></tr></thead>
              <tbody>
                {state.changes.map((change) => (
                  <tr key={change.field}>
                    <th scope="row">{change.field}</th>
                    <td className={change.before ? 'app-confirm__before' : 'app-confirm__empty-value'}>{change.before || '—'}</td>
                    <td className={change.after ? 'app-confirm__after' : 'app-confirm__empty-value'}>{change.after || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {state.consequence || state.reversibility ? (
          <dl className="app-confirm__facts">
            {state.consequence ? (
              <div className="app-confirm__fact">
                <dt><ArrowRightCircle size={15} aria-hidden="true" />Consequência</dt>
                <dd>{state.consequence}</dd>
              </div>
            ) : null}
            {state.reversibility ? (
              <div className="app-confirm__fact">
                <dt><Undo2 size={15} aria-hidden="true" />Desfazer</dt>
                <dd>{state.reversibility}</dd>
              </div>
            ) : null}
          </dl>
        ) : null}

        {state.requireReason ? (
          <div className="app-field app-confirm__reason">
            <label htmlFor={reasonId} className="app-field__label">
              {state.reasonLabel ?? 'Motivo (obrigatório)'}
            </label>
            <textarea
              id={reasonId}
              ref={reasonRef}
              className="app-input app-confirm__textarea"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              aria-required="true"
              aria-describedby={`${reasonId}-hint`}
            />
            <span id={`${reasonId}-hint`} className="app-field__hint">O motivo fica gravado junto com a ação.</span>
          </div>
        ) : null}

        <div className="app-confirm__actions">
          <Button ref={backRef} variant="secondary" onClick={() => settle({ confirmed: false, reason: '' })}>
            {state.cancelLabel ?? 'Voltar'}
          </Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            className={danger ? 'app-confirm__danger' : undefined}
            disabled={!canConfirm}
            title={canConfirm ? undefined : 'Informe o motivo para continuar'}
            onClick={() => settle({ confirmed: true, reason: trimmedReason })}
          >
            {state.confirmLabel ?? 'Confirmar'}
          </Button>
        </div>
      </Modal>
    </ConfirmContext.Provider>
  )
}

export function useConfirm() {
  const value = useContext(ConfirmContext)
  if (!value) throw new Error('useConfirm deve ser usado dentro de ConfirmDialogProvider')
  return value.confirm
}

/**
 * Confirmacao com motivo obrigatorio (ADR 0072): devolve o motivo digitado, ou
 * `null` quando a pessoa volta sem executar.
 */
export function useConfirmWithReason() {
  const value = useContext(ConfirmContext)
  if (!value) throw new Error('useConfirmWithReason deve ser usado dentro de ConfirmDialogProvider')
  return value.confirmWithReason
}
