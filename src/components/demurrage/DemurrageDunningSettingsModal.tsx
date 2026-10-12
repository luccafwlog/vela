import { useState } from 'react'
import { Button } from '../ui/Button'
import { InlineError } from '../ui/Card'
import { Field, Input } from '../ui/Input'
import { Modal } from '../ui/Modal'
import { useConfirm } from '../ui/ConfirmDialog'
import { useAppSettings, useSetDemurrageDunningIntervalDays } from '../../hooks/useAppSettings'
import { useAuth } from '../../hooks/useAuth'

type Props = {
  open: boolean
  onClose: () => void
}

export function DemurrageDunningSettingsModal({ open, onClose }: Props) {
  const { data: settings, isLoading, error: settingsError } = useAppSettings()
  // A RPC `set_demurrage_dunning_interval_days` aceita só o Administrativo.
  const { effectiveRole } = useAuth()
  const canEdit = effectiveRole === 'administrativo'
  const setDunningMutation = useSetDemurrageDunningIntervalDays()
  const confirm = useConfirm()
  const [daysInput, setDaysInput] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const currentDays = daysInput ?? String(settings?.demurrage_dunning_interval_days ?? 7)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!canEdit) return
    setError(null)
    const days = Number(currentDays)
    if (!Number.isInteger(days) || days < 1 || days > 365) {
      setError('Informe um intervalo válido entre 1 e 365 dias.')
      return
    }
    if (days === Number(settings?.demurrage_dunning_interval_days ?? 7)) {
      onClose()
      return
    }
    const confirmed = await confirm({
      title: 'Confirmar intervalo da régua de cobrança',
      message: `Alterar o intervalo entre cobranças automáticas para ${days} dias?`,
      confirmLabel: 'Salvar intervalo',
      changes: [{
        field: 'Intervalo entre cobranças',
        before: `${settings?.demurrage_dunning_interval_days ?? 7} dias`,
        after: `${days} dias`,
      }],
      consequence: 'A régua automática de Demurrage usará o novo intervalo para faturas emitidas e não pagas; salvar não envia cobrança imediatamente.',
      reversibility: 'Altere o intervalo novamente a qualquer momento.',
    })
    if (!confirmed) return
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

  const savedDays = settings?.demurrage_dunning_interval_days ?? 7

  return (
    <Modal open={open} onClose={handleClose} title="Régua de Cobrança de Demurrage" size="sm">
      <form onSubmit={handleSubmit} className="app-dem-form" noValidate>
        <p className="app-dem-note">
          A Régua envia a cobrança por e-mail às caixas Financeiro e Demurrage do Cliente, a partir da emissão e depois a cada intervalo, sem limite de tentativas, enquanto a Invoice estiver emitida e não paga.
        </p>
        <ul className="app-dem-rules">
          <li>Pausa com disputa aberta ou sem contato válido, e volta quando a situação se regulariza.</li>
          <li>Não cobra a Invoice tirada da Régua por datas alteradas depois do pagamento, ou com desconto ou disputa; ela espera tratamento à mão pelo alerta.</li>
          <li>O comunicado mostra o valor em USD, o BRL do dia como referência e o link do Portal.</li>
        </ul>

        {settingsError ? <InlineError message="Não foi possível ler o intervalo atual." /> : null}
        {canEdit ? (
          <Field label="Intervalo entre cobranças, em dias" required hint="De 1 a 365. Salvar não envia cobrança na hora." error={error ?? undefined}>
            <Input
              type="number"
              min={1}
              max={365}
              value={currentDays}
              disabled={isLoading}
              onChange={(event) => { setDaysInput(event.target.value); setError(null) }}
              placeholder="Ex.: 7"
            />
          </Field>
        ) : (
          <p className="app-dem-facts-line">
            Intervalo atual: <strong>{isLoading ? '…' : `${savedDays} ${savedDays === 1 ? 'dia' : 'dias'}`}</strong>. Só o Administrativo altera o intervalo.
          </p>
        )}

        <div className="app-dem-form__actions">
          <Button type="button" variant={canEdit ? 'ghost' : 'secondary'} onClick={handleClose}>
            Voltar
          </Button>
          {canEdit ? (
            <Button type="submit" loading={setDunningMutation.isPending} loadingLabel="Salvando…">
              Salvar intervalo
            </Button>
          ) : null}
        </div>
      </form>
    </Modal>
  )
}
