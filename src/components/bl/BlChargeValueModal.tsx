import { useState, type FormEvent } from 'react'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { Fact, FactList } from '../ui/Block'
import { Field, Input, Textarea } from '../ui/Input'
import { SegmentedControl } from '../ui/SegmentedControl'
import { useConfirm } from '../ui/ConfirmDialog'
import { useToast } from '../ui/Toast'
import { useAuth } from '../../hooks/useAuth'
import { useChangeBlCharge } from '../../hooks/useLocalCharges'
import { readInvoiceEffect } from './blChargeInvoiceEffect'
import { userFacingErrorMessage } from '../../lib/errors'
import { applicationBasisLabel } from '../billing/conferenciaCalculo'
import { formatNumber } from '../../pages/blDetalheHelpers'
import type { LocalChargeLine } from '../../services/charges/chargeOperationsService'
import {
  chargedTotalValue,
  chargedUnitValue,
  formatChargeMoney,
  isAdjustedLine,
  newTotalPreview,
  readChargeValueDraft,
  tableTotalValue,
  tableUnitValue,
} from './blChargeAdjustmentPresentation'

/** Modal "Alterar valor — <taxa>" (ADR 0111): por unidade ou pelo total, com justificativa interna. */
export function BlChargeValueModal({ blId, line, onClose, billed = false }: { blId: string; line: LocalChargeLine; onClose: () => void; billed?: boolean }) {
  const { user } = useAuth()
  const { showToast } = useToast()
  const confirm = useConfirm()
  const mutation = useChangeBlCharge(blId)
  const startKind = line.adjustment_kind === 'total' ? 'total' : 'unit'
  const [kind, setKind] = useState<'unit' | 'total'>(startKind)
  const [value, setValue] = useState('')
  const [justification, setJustification] = useState('')
  const [error, setError] = useState<{ field: 'value' | 'justification' | 'form'; message: string } | null>(null)

  const basis = applicationBasisLabel(line.application_basis) ?? 'por unidade'
  const money = (amount: number) => formatChargeMoney(amount, line.currency)
  const currencyLabel = line.currency === 'USD' ? 'US$' : 'R$'
  const preview = newTotalPreview(kind, value, line)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!user) return
    const read = readChargeValueDraft({ kind, value, justification }, line)
    if (!read.ok) {
      setError({ field: read.field, message: read.message })
      return
    }
    setError(null)
    const newUnit = kind === 'unit' ? read.value : Math.round((read.value / Number(line.quantity || 1)) * 100) / 100
    const newTotal = kind === 'unit' ? Math.round(read.value * Number(line.quantity ?? 0) * 100) / 100 : read.value
    const effect = await readInvoiceEffect(billed, { blId, action: 'alter', lineKey: line.calculation_key, kind, value: read.value })
    if (!effect.ok) {
      setError({ field: 'form', message: `Não foi possível alterar a taxa: ${userFacingErrorMessage(effect.error)}` })
      return
    }
    const confirmed = await confirm({
      title: 'Alterar valor da taxa',
      message: `Alterar o valor de ${line.charge_name} neste B/L?`,
      changes: [
        { field: `${line.charge_name} · ${basis}`, before: money(chargedUnitValue(line)), after: money(newUnit) },
        { field: 'Total', before: money(chargedTotalValue(line)), after: money(newTotal) },
      ],
      consequence: effect.message ?? `O B/L passa a cobrar ${money(newTotal)} por esta taxa. A alteração vale nos próximos recálculos e na fatura; só se perde se o B/L mudar de POD ou de modalidade.`,
      reversibility: 'Volte quando quiser com Voltar ao valor da tabela, com justificativa.',
      confirmLabel: 'Alterar valor',
    })
    if (!confirmed) return
    try {
      await mutation.mutateAsync({
        action: 'alter', lineKey: line.calculation_key ?? '', kind, value: read.value, justification: justification.trim(), actorId: user.id,
      })
      showToast('Valor da taxa alterado.', 'success')
      onClose()
    } catch (failure) {
      setError({ field: 'form', message: `Não foi possível alterar a taxa: ${userFacingErrorMessage(failure)}` })
    }
  }

  return (
    <Modal open title={`Alterar valor — ${line.charge_name}`} onClose={onClose} size="sm">
      <form onSubmit={handleSubmit} className="grid gap-4" noValidate>
        <FactList columns={2}>
          <Fact label="Quantidade">{formatNumber(line.quantity)} · vem da carga do B/L, não se altera</Fact>
          <Fact label="Valor da tabela">{money(tableUnitValue(line))} {basis} · total {money(tableTotalValue(line))}</Fact>
          {isAdjustedLine(line) ? (
            <Fact label="Valor atual">{money(chargedUnitValue(line))} {basis} · total {money(chargedTotalValue(line))}</Fact>
          ) : null}
        </FactList>
        <SegmentedControl
          label="Jeito de alterar"
          options={[{ value: 'unit', label: 'Por unidade' }, { value: 'total', label: 'Total da taxa' }]}
          value={kind}
          onChange={(next) => { setKind(next); setError(null) }}
        />
        <Field
          label={kind === 'unit' ? `Novo valor por unidade (${currencyLabel})` : `Novo valor total (${currencyLabel})`}
          required
          error={error?.field === 'value' ? error.message : undefined}
          hint={preview ?? undefined}
        >
          <Input inputMode="decimal" autoComplete="off" value={value} onChange={(e) => setValue(e.target.value)} />
        </Field>
        <Field
          label="Justificativa (interna)"
          required
          hint="Fica no histórico do B/L com o seu nome. O Cliente não vê."
          error={error?.field === 'justification' ? error.message : undefined}
        >
          <Textarea rows={3} value={justification} onChange={(e) => setJustification(e.target.value)} />
        </Field>
        {error?.field === 'form' ? <p className="app-field__error" role="alert">{error.message}</p> : null}
        <div className="mt-2 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Voltar</Button>
          <Button type="submit" loading={mutation.isPending} loadingLabel="Alterando…">Revisar alteração</Button>
        </div>
      </form>
    </Modal>
  )
}
