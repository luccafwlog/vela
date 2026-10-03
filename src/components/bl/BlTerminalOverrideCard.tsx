import { useMemo, useState } from 'react'
import { AlertTriangle, GitBranch, RotateCcw, X } from 'lucide-react'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { Field, Select, Textarea } from '../ui/Input'

export type BlTerminalOverrideOption = {
  id: string
  code: string
  name: string | null
  portId: number | null
}

// Terminal de descarga do B/L. Mostra o terminal em uso numa linha; o
// formulário de exceção só abre quando alguém pede para alterar.
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
  currentLabel: string
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
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <GitBranch size={16} className="text-[var(--app-link)]" aria-hidden="true" />
          <h3 className="text-sm font-semibold">Terminal de descarga</h3>
          <span className="text-sm font-medium text-[var(--app-text-strong)]">{currentLabel}</span>
          <Badge tone={isOverride ? 'yellow' : 'slate'}>{isOverride ? 'Exceção individual' : 'Herdado da escala'}</Badge>
        </div>
        {canEdit && !editing ? (
          <Button type="button" variant="secondary" onClick={() => setEditing(true)}>
            {isOverride ? 'Alterar exceção' : 'Definir exceção'}
          </Button>
        ) : null}
      </div>
      {isOverride ? (
        <p className="mt-2 text-sm text-[var(--app-muted)]">
          Este B/L está desviado da Frente de Operação. A alteração fica no histórico com autor e justificativa.
        </p>
      ) : null}

      {editing && canEdit ? (
        <div className="mt-4 border-t border-[var(--app-border)] pt-4">
          <p className="mb-4 text-sm text-[var(--app-muted)]">
            O terminal vem da Frente de Operação do POD. Use uma exceção somente quando este B/L tiver um destino operacional diferente.
          </p>
          <div className="grid gap-4 md:grid-cols-2">
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
            <Field label="Justificativa" hint="Obrigatória para definir ou remover a exceção.">
              <Textarea
                rows={2}
                value={justification}
                onChange={(event) => setJustification(event.target.value)}
                placeholder="Explique por que este B/L deve usar outro terminal."
              />
            </Field>
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
            <Button type="button" variant="ghost" onClick={cancel}>
              <X size={14} />
              Cancelar
            </Button>
            {isOverride ? (
              <Button
                type="button"
                variant="secondary"
                disabled={saving || !justification.trim()}
                onClick={() => onSave?.({ terminalId: null, podPortId: null, justification: justification.trim() })}
              >
                <RotateCcw size={14} />
                Voltar à escala
              </Button>
            ) : null}
            <Button
              type="button"
              loading={saving}
              disabled={!canSubmit}
              onClick={() => onSave?.({ terminalId: selectedTerminalId || null, podPortId: selectedPortId, justification: justification.trim() })}
            >
              <AlertTriangle size={14} />
              {selectedTerminalId || !isOverride ? 'Salvar exceção' : 'Remover exceção'}
            </Button>
          </div>
        </div>
      ) : null}
      {error ? <p className="mt-3 text-sm text-red-300" role="alert">{error}</p> : null}
    </Card>
  )
}
