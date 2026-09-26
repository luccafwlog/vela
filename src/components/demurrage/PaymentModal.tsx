import { Button } from '../ui/Button'
import { Field, Input } from '../ui/Input'
import { Modal } from '../ui/Modal'

type Props = {
  open: boolean
  paymentId: number | null
  paymentDate: string
  onPaymentDateChange: (date: string) => void
  onClose: () => void
  onSubmit: (id: number, date: string) => void
}

export function PaymentModal({
  open,
  paymentId,
  paymentDate,
  onPaymentDateChange,
  onClose,
  onSubmit,
}: Props) {
  return (
    <Modal open={open} onClose={onClose} title="Registrar Pagamento">
      <div className="space-y-4 p-4">
        <Field label="Data do pagamento">
          <Input type="date" value={paymentDate} onChange={(event) => onPaymentDateChange(event.target.value)} />
        </Field>
        <div className="flex gap-2">
          <Button onClick={() => paymentId && onSubmit(paymentId, paymentDate)}>Confirmar</Button>
          <Button variant="ghost" onClick={onClose}>Voltar</Button>
        </div>
      </div>
    </Modal>
  )
}
