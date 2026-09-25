import { Button } from '../ui/Button'
import { Field, Input } from '../ui/Input'
import { Modal } from '../ui/Modal'

type Props = {
  open: boolean
  value: string
  loading: boolean
  onValueChange: (value: string) => void
  onClose: () => void
  onSubmit: (ptax: number) => void
  onInvalid: () => void
}

export function PtaxModal({ open, value, loading, onValueChange, onClose, onSubmit, onInvalid }: Props) {
  function handleSubmit() {
    const ptax = parseFloat(value.replace(',', '.'))
    if (!Number.isFinite(ptax) || ptax <= 0) {
      onInvalid()
      return
    }
    onSubmit(ptax)
  }

  return (
    <Modal open={open} onClose={onClose} title="Informar PTAX manualmente">
      <div className="space-y-4">
        <p className="text-sm text-slate-400">
          Use quando o BCB estiver indisponível ou o recálculo automático falhar. Informe a cotação de
          venda do dólar (PTAX, sem markup). O sistema recalcula todas as faturas emitidas e não pagas.
        </p>
        <Field label="PTAX (cotação de venda)">
          <Input
            type="number"
            step="0.0001"
            min="0"
            value={value}
            onChange={(event) => onValueChange(event.target.value)}
            placeholder="Ex.: 5.4321"
          />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Voltar</Button>
          <Button onClick={handleSubmit} disabled={loading}>
            {loading ? 'Recalculando…' : 'Recalcular'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
