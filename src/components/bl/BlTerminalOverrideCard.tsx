import { useMemo, useState } from 'react'
import { Button } from '../ui/Button'
import { Field, Select, Textarea } from '../ui/Input'

export type BlTerminalOverrideOption = {
  id: string
  code: string
  name: string | null
  portId: number | null
}

// Terminal de descarga do B/L, como um fato do Embarque. Mostra o terminal em
// uso e a origem (escala ou exceção deste B/L) em texto; o formulário de
// exceção só abre quando alguém pede para alterar.
export function BlTerminalOverrideCard({
  currentLabel,
  terminalId,
  podPortId,
  options,
  canEdit,
  saving,
  error,
  onSave,
}: {
  /** Nome do terminal aplicado; vazio quando herda e a escala ainda não tem terminal. */
  currentLabel: string | null
  terminalId: string | null
  podPortId: number | null
  options: BlTerminalOverrideOption[]
  canEdit: boolean
  saving?: boolean
  error?: string | null
  onSave?: (input: { terminalId: string | null; podPortId: number | null; justification: string }) => void
}) {
  const [selectedTerminalId, setSelectedTerminalId] = useState(terminalId ?? '')
  const [justification, setJustification] = useState('')
  const [editing, setEditing] = useState(false)
  const isOverride = Boolean(terminalId)
  const selectedOption = useMemo(
    () => options.find((option) => option.id === selectedTerminalId) ?? null,
    [options, selectedTerminalId],
  )

  const selectedPortId = selectedOption?.portId ?? (selectedTerminalId ? podPortId : null)
  const selectionChanged = selectedTerminalId !== (terminalId ?? '')
  const canSubmit = Boolean(onSave && canEdit && selectionChanged && justification.trim() && (!selectedTerminalId || selectedPortId != null))

  function cancel() {
    setEditing(false)
    setSelectedTerminalId(terminalId ?? '')
    setJustification('')
  }

  return (
    <div className="app-bl-facts__item app-bl-facts__wide app-bl-terminal">
      <dt>Terminal de descarga</dt>
      <dd>
          <span className="app-bl-terminal__value">
            <span>{currentLabel ?? (isOverride ? 'Terminal da exceção' : 'Padrão da escala')}</span>
            {canEdit && !editing ? (
              <button type="button" className="app-bl-text-button" onClick={() => setEditing(true)}>
                {isOverride ? 'Alterar exceção' : 'Definir exceção'}
              </button>
            ) : null}
          </span>
          <span className={isOverride ? 'app-bl-facts__sub app-bl-tone--warning' : 'app-bl-facts__sub'}>
            {isOverride ? 'Exceção deste B/L, fora da Frente de Operação' : 'Herdado da Frente de Operação do POD'}
          </span>

      {editing && canEdit ? (
        <div className="app-bl-terminal__form">
          <p className="app-bl-terminal__intro">
            Use uma exceção só quando este B/L descarrega em outro terminal. Fica no histórico com autor e justificativa.
          </p>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Terminal aplicado">
              <Select value={selectedTerminalId} onChange={(event) => setSelectedTerminalId(event.target.value)}>
                <option value="">Herdar da Frente de Operação</option>
                {options.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.code}{option.name ? ` — ${option.name}` : ''}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Justificativa" required hint="Obrigatória para definir ou remover a exceção.">
              <Textarea
                rows={2}
                aria-required="true"
                value={justification}
                onChange={(event) => setJustification(event.target.value)}
                placeholder="Por que este B/L usa outro terminal?"
              />
            </Field>
          </div>
          <div className="app-bl-terminal__actions">
            <Button type="button" variant="ghost" onClick={cancel}>Voltar</Button>
            {isOverride ? (
              <Button
                type="button"
                variant="secondary"
                disabled={saving || !justification.trim()}
                onClick={() => onSave?.({ terminalId: null, podPortId: null, justification: justification.trim() })}
              >
                Remover exceção
              </Button>
            ) : null}
            {selectedTerminalId ? (
              <Button
                type="button"
                loading={saving}
                loadingLabel="Salvando…"
                disabled={!canSubmit}
                onClick={() => onSave?.({ terminalId: selectedTerminalId, podPortId: selectedPortId, justification: justification.trim() })}
              >
                Salvar exceção
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
      {error ? <p className="app-bl-error" role="alert">{error}</p> : null}
      </dd>
    </div>
  )
}
