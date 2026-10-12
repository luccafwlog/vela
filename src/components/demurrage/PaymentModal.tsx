import { useState } from 'react'
import { Button } from '../ui/Button'
import { Field, Input } from '../ui/Input'
import { Modal } from '../ui/Modal'
import { fmtBRL, fmtUSD } from '../../services/demurrage/demurragePresentation'
import { formatDate } from '../../lib/utils'

export type PaymentTarget = {
  id: number
  docNumber: string
  netUsd: number
  currentTotalBrl: number | null
  billedAt: string | null
}

type Props = {
  open: boolean
  invoice: PaymentTarget | null
  paymentDate: string
  loading?: boolean
  error?: string | null
  onPaymentDateChange: (date: string) => void
  onClose: () => void
  onSubmit: (id: number, date: string) => void
}

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

/**
 * Baixa manual (`register_demurrage_payment`): congela o valor em BRL e o
 * ROE da Invoice, e o recálculo diário dela termina. A data não pode ser
 * anterior à emissão (a RPC procura a foto financeira até a data paga).
 */
export function PaymentModal({ open, invoice, paymentDate, loading = false, error = null, onPaymentDateChange, onClose, onSubmit }: Props) {
  const [dateError, setDateError] = useState<string | null>(null)
  const minDate = invoice?.billedAt?.slice(0, 10)
  const maxDate = todayIso()

  function submit() {
    if (!invoice) return
    if (!paymentDate) return setDateError('Informe a data do pagamento.')
    if (paymentDate > maxDate) return setDateError('A data do pagamento não pode ser futura.')
    if (minDate && paymentDate < minDate) return setDateError(`A data do pagamento não pode ser anterior à emissão (${formatDate(minDate)}).`)
    setDateError(null)
    onSubmit(invoice.id, paymentDate)
  }

  return (
    <Modal open={open} onClose={onClose} title={invoice ? `Registrar pagamento ${invoice.docNumber}` : 'Registrar pagamento'} size="sm">
      <form className="app-dem-form" noValidate onSubmit={(event) => { event.preventDefault(); submit() }}>
        {invoice ? (
          <dl className="app-dem-facts">
            <div><dt>USD a cobrar</dt><dd>{fmtUSD(invoice.netUsd)}</dd></div>
            <div><dt>BRL hoje</dt><dd>{fmtBRL(invoice.currentTotalBrl)}</dd></div>
          </dl>
        ) : null}
        <Field label="Data do pagamento" required error={dateError ?? undefined} hint={minDate ? `Entre ${formatDate(minDate)} e hoje.` : undefined}>
          <Input type="date" value={paymentDate} min={minDate} max={maxDate} onChange={(event) => { onPaymentDateChange(event.target.value); setDateError(null) }} />
        </Field>
        <p className="app-dem-note">A baixa congela o valor em BRL e o ROE da Invoice; o recálculo pela PTAX termina. Para baixar pelo extrato ou pelo PIX, use a Conciliação.</p>
        {error ? <p className="app-dem-form__error" role="alert">{error} Nada foi baixado.</p> : null}
        <div className="app-dem-form__actions">
          <Button type="button" variant="ghost" onClick={onClose}>Voltar</Button>
          <Button type="submit" loading={loading} loadingLabel="Registrando…">Registrar pagamento</Button>
        </div>
      </form>
    </Modal>
  )
}
