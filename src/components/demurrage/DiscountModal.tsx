import { Button } from '../ui/Button'
import { Field, Input, Select, Textarea } from '../ui/Input'
import { Modal } from '../ui/Modal'
import {
  DISCOUNT_TYPE_LABELS,
  type DiscountForm,
} from '../../services/demurrage/demurrageForms'
import type { DemurrageInvoice } from '../../types/database'

type Props = {
  open: boolean
  form: DiscountForm
  loading: boolean
  onFormChange: (form: DiscountForm) => void
  onClose: () => void
  onSubmit: () => void
}

export function DiscountModal({ open, form, loading, onFormChange, onClose, onSubmit }: Props) {
  return (
    <Modal open={open} onClose={onClose} title="Desconto">
      <div className="space-y-4 p-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Tipo de desconto">
            <Select
              value={form.discount_type ?? ''}
              onChange={(event) => onFormChange({ ...form, discount_type: (event.target.value || null) as DemurrageInvoice['discount_type'] })}
            >
              <option value="">Sem desconto</option>
              {(Object.entries(DISCOUNT_TYPE_LABELS) as [NonNullable<DemurrageInvoice['discount_type']>, string][]).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </Select>
          </Field>
          <Field label="Modo">
            <Select
              value={form.discount_mode}
              onChange={(event) => onFormChange({ ...form, discount_mode: event.target.value as 'percent' | 'fixed' })}
            >
              <option value="percent">Percentual (%)</option>
              <option value="fixed">Valor fixo (USD)</option>
            </Select>
          </Field>
        </div>
        <Field label="Valor do desconto">
          <Input
            type="number"
            min="0"
            step="0.01"
            value={form.discount_value}
            onChange={(event) => onFormChange({ ...form, discount_value: event.target.value })}
          />
          <p className="mt-1 text-xs text-slate-400">
            {form.discount_mode === 'fixed'
              ? 'Valor em dólares (USD), descontado antes da conversão para BRL.'
              : 'Percentual sobre o total USD.'}
          </p>
        </Field>
        <Field label="Justificativa">
          <Textarea rows={2} value={form.discount_justification} onChange={(event) => onFormChange({ ...form, discount_justification: event.target.value })} />
        </Field>
        <Field label="Aprovador">
          <Input type="text" value={form.discount_approver} onChange={(event) => onFormChange({ ...form, discount_approver: event.target.value })} />
        </Field>
        <div className="flex gap-2">
          <Button loading={loading} onClick={onSubmit}>Salvar</Button>
          <Button variant="ghost" onClick={onClose}>Voltar</Button>
        </div>
      </div>
    </Modal>
  )
}
