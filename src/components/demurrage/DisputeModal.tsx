import { Button } from '../ui/Button'
import { Field, Input, Textarea } from '../ui/Input'
import { Modal } from '../ui/Modal'
import type { DisputeForm } from '../../services/demurrage/demurrageForms'

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
        <p className="text-sm text-[var(--app-muted)]">
          Encerrar ou reabrir a Dispute é feito na conversa de Disputes desta página.
        </p>
        <Field label="Assunto">
          <Input type="text" value={form.dispute_subject} onChange={(event) => onFormChange({ ...form, dispute_subject: event.target.value })} />
        </Field>
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
