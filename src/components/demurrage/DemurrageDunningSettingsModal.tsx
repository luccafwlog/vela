import { useState } from 'react'
import { Button } from '../ui/Button'
import { InlineError } from '../ui/Card'
import { Field, Input } from '../ui/Input'
import { Modal } from '../ui/Modal'
import { useAppSettings, useSetDemurrageDunningIntervalDays } from '../../hooks/useAppSettings'

type Props = {
  open: boolean
  onClose: () => void
}

export function DemurrageDunningSettingsModal({ open, onClose }: Props) {
  const { data: settings } = useAppSettings()
  const setDunningMutation = useSetDemurrageDunningIntervalDays()
  const [daysInput, setDaysInput] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const currentDays = daysInput ?? String(settings?.demurrage_dunning_interval_days ?? 7)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    const days = Number(currentDays)
    if (!Number.isInteger(days) || days < 1 || days > 365) {
      setError('Informe um intervalo válido entre 1 e 365 dias.')
      return
    }
    try {
      await setDunningMutation.mutateAsync(days)
      setDaysInput(null)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao salvar o intervalo da régua.')
    }
  }

  function handleClose() {
    setDaysInput(null)
    setError(null)
    onClose()
  }

  return (
    <Modal open={open} onClose={handleClose} title="Régua de Cobrança de Demurrage">
      <form onSubmit={handleSubmit} className="space-y-4">
        <p className="text-sm text-[var(--app-muted)]">
          Configure o intervalo em dias entre cobranças automáticas por e-mail para faturas de demurrage emitidas e não pagas. A régua é contínua e não possui limite de tentativas.
        </p>

        <Field label="Intervalo em dias entre cobranças (1 a 365)">
          <Input
            type="number"
            min={1}
            max={365}
            value={currentDays}
            onChange={(event) => setDaysInput(event.target.value)}
            placeholder="Ex.: 7"
            required
          />
        </Field>

        {error ? <InlineError message={error} /> : null}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={handleClose}>
            Voltar
          </Button>
          <Button type="submit" loading={setDunningMutation.isPending}>
            Salvar intervalo
          </Button>
        </div>
      </form>
    </Modal>
  )
}
