/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useMemo, useRef, useState, type PropsWithChildren } from 'react'
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

export function ConfirmDialogProvider({ children }: PropsWithChildren) {
  const [state, setState] = useState<ConfirmState>(CLOSED)
  const [reason, setReason] = useState('')
  const [showAll, setShowAll] = useState(false)
  const resolveRef = useRef<((value: Settlement) => void) | null>(null)

  const settle = useCallback((value: Settlement) => {
    resolveRef.current?.(value)
    resolveRef.current = null
    setState((prev) => ({ ...prev, open: false }))
  }, [])

  const open = useCallback((options: ReasonOptions, requireReason: boolean) => {
    return new Promise<Settlement>((resolve) => {
      resolveRef.current = resolve
      setReason('')
      setShowAll(false)
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

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      <Modal
        open={state.open}
        title={state.title ?? 'Confirmar ação'}
        onClose={() => settle({ confirmed: false, reason: '' })}
        className="w-[min(100%,480px)]"
      >
        <div className="grid gap-4 text-sm leading-relaxed" style={{ color: 'var(--app-text)' }}>
          <p className="whitespace-pre-line">{state.message}</p>

          {state.affected ? (
            <section aria-label="Registros afetados" className="grid gap-1">
              <p className="font-medium">{state.affected.summary}</p>
              {items.length > 0 ? (
                <>
                  <Button variant="ghost" onClick={() => setShowAll((v) => !v)} aria-expanded={showAll}>
                    {showAll ? 'Ocultar lista' : `Ver lista (${items.length})`}
                  </Button>
                  {showAll ? (
                    <ul className="max-h-40 list-disc overflow-auto pl-5">
                      {items.map((item) => <li key={item}>{item}</li>)}
                    </ul>
                  ) : null}
                </>
              ) : null}
              {blocked.length > 0 ? (
                <div>
                  <p className="font-medium">Não serão alterados ({blocked.length}):</p>
                  <ul className="max-h-32 list-disc overflow-auto pl-5">
                    {blocked.map((b) => <li key={b.label}>{b.label}: {b.reasons.join(', ')}</li>)}
                  </ul>
                </div>
              ) : null}
            </section>
          ) : null}

          {state.changes && state.changes.length > 0 ? (
            <table aria-label="Campos alterados" className="w-full text-left">
              <thead><tr><th>Campo</th><th>Antes</th><th>Depois</th></tr></thead>
              <tbody>
                {state.changes.map((change) => (
                  <tr key={change.field}><td>{change.field}</td><td>{change.before || '—'}</td><td>{change.after || '—'}</td></tr>
                ))}
              </tbody>
            </table>
          ) : null}

          {state.consequence ? (
            <p><strong>Consequência:</strong> {state.consequence}</p>
          ) : null}
          {state.reversibility ? (
            <p><strong>Desfazer:</strong> {state.reversibility}</p>
          ) : null}

          {state.requireReason ? (
            <label className="grid gap-1">
              <span className="font-medium">{state.reasonLabel ?? 'Motivo (obrigatório)'}</span>
              <textarea
                className="app-input min-h-[72px]"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </label>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => settle({ confirmed: false, reason: '' })}>
              {state.cancelLabel ?? 'Voltar'}
            </Button>
            <Button
              variant={state.tone === 'danger' ? 'danger' : 'primary'}
              disabled={!canConfirm}
              onClick={() => settle({ confirmed: true, reason: trimmedReason })}
            >
              {state.confirmLabel ?? 'Confirmar'}
            </Button>
          </div>
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
