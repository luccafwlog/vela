import { useMemo, useState } from 'react'
import { AlertTriangle, GitBranch, RotateCcw } from 'lucide-react'
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

export function BlTerminalOverrideCard({
  terminalId,
  podPortId,
  options,
  canEdit,
  saving,
  error,
  onSave,
}: {
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
  const isOverride = Boolean(terminalId)
  const selectedOption = useMemo(
    () => options.find((option) => option.id === selectedTerminalId) ?? null,
    [options, selectedTerminalId],
  )

  const selectedPortId = selectedOption?.portId ?? (selectedTerminalId ? podPortId : null)
  const selectionChanged = selectedTerminalId !== (terminalId ?? '')
  const canSubmit = Boolean(onSave && canEdit && selectionChanged && justification.trim() && (!selectedTerminalId || selectedPortId != null))

  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <GitBranch size={16} className="text-[var(--app-link)]" aria-hidden="true" />
        <h3 className="text-sm font-semibold">Terminal de descarga</h3>
        <Badge tone={isOverride ? 'yellow' : 'slate'}>{isOverride ? 'Exceção individual' : 'Herdado da escala'}</Badge>
      </div>
      <p className="mb-4 text-sm text-[var(--app-muted)]">
        {isOverride
          ? 'Este B/L está desviado da Frente de Operação. A alteração fica registrada no histórico com autor e justificativa.'
          : 'O terminal é resolvido pela Frente de Operação do POD. Use uma exceção somente quando este B/L tiver um destino operacional diferente.'}
      </p>

      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Field label="Terminal aplicado">
          {canEdit ? (
            <Select value={selectedTerminalId} onChange={(event) => setSelectedTerminalId(event.target.value)}>
              <option value="">Herdar da Frente de Operação</option>
              {options.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.code}{option.name ? ` — ${option.name}` : ''}
                </option>
              ))}
            </Select>
          ) : (
            <div className="app-input app-input--full flex items-center gap-2">
              {isOverride ? (options.find((option) => option.id === terminalId)?.code ?? terminalId) : 'Herdado da escala'}
            </div>
          )}
        </Field>
        {canEdit ? (
          <Field label="Justificativa" hint="Obrigatória para definir ou remover a exceção.">
            <Textarea
              rows={3}
              value={justification}
              onChange={(event) => setJustification(event.target.value)}
              placeholder="Explique por que este B/L deve usar outro terminal."
            />
          </Field>
        ) : null}
      </div>

      {error ? <p className="mt-3 text-sm text-red-300" role="alert">{error}</p> : null}
      {canEdit ? (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            loading={saving}
            disabled={!canSubmit}
            onClick={() => onSave?.({ terminalId: selectedTerminalId || null, podPortId: selectedPortId, justification: justification.trim() })}
          >
            <AlertTriangle size={14} />
            {selectedTerminalId ? 'Salvar exceção' : isOverride ? 'Remover exceção' : 'Selecione um terminal'}
          </Button>
          {isOverride ? (
            <Button
              type="button"
              variant="ghost"
              disabled={saving || !justification.trim()}
              onClick={() => onSave?.({ terminalId: null, podPortId: null, justification: justification.trim() })}
            >
              <RotateCcw size={14} />
              Voltar à escala
            </Button>
          ) : null}
        </div>
      ) : null}
    </Card>
  )
}
