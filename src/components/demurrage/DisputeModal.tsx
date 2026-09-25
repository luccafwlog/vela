import { Button } from '../ui/Button'
import { Field, Input, Select, Textarea } from '../ui/Input'
import { Modal } from '../ui/Modal'
import {
  DISPUTE_STATUS_LABELS,
  type DisputeForm,
} from '../../services/demurrage/demurrageForms'
import type { DemurrageInvoice } from '../../types/database'

type Props = {
  open: boolean
  form: DisputeForm
  loading: boolean
  onFormChange: (form: DisputeForm) => void
  onClose: () => void
  onSubmit: () => void
}

export function DisputeModal({ open, form, loading, onFormChange, onClose, onSubmit }: Props) {
  return (
    <Modal open={open} onClose={onClose} title="Disputa">
      <div className="space-y-4 p-4">
        <label className="flex items-center gap-2 text-sm text-[var(--app-text)]">
          <input
            type="checkbox"
            className="rounded"
            checked={form.dispute_open}
            onChange={(event) => onFormChange({ ...form, dispute_open: event.target.checked })}
          />
          Disputa em aberto
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Assunto">
            <Input type="text" value={form.dispute_subject} onChange={(event) => onFormChange({ ...form, dispute_subject: event.target.value })} />
          </Field>
          <Field label="Status">
            <Select
              value={form.dispute_status ?? ''}
              onChange={(event) => onFormChange({ ...form, dispute_status: (event.target.value || null) as DemurrageInvoice['dispute_status'] })}
            >
              <option value="">Sem status</option>
              {(Object.entries(DISPUTE_STATUS_LABELS) as [NonNullable<DemurrageInvoice['dispute_status']>, string][]).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Motivo">
          <Textarea rows={2} value={form.dispute_reason} onChange={(event) => onFormChange({ ...form, dispute_reason: event.target.value })} />
        </Field>
        <Field label="Notas">
          <Textarea rows={2} value={form.dispute_notes} onChange={(event) => onFormChange({ ...form, dispute_notes: event.target.value })} />
        </Field>
        <div className="flex gap-2">
          <Button loading={loading} onClick={onSubmit}>Salvar</Button>
          <Button variant="ghost" onClick={onClose}>Voltar</Button>
        </div>
      </div>
    </Modal>
  )
}
