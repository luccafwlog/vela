import { Button } from '../ui/Button'
import { Field, Input, Textarea } from '../ui/Input'
import { Modal } from '../ui/Modal'
import type { DisputeForm } from '../../services/demurrage/demurrageForms'

type Props = {
  open: boolean
  docNumber?: string | null
  form: DisputeForm
  loading: boolean
  error?: string | null
  onFormChange: (form: DisputeForm) => void
  onClose: () => void
  onSubmit: () => void
}

/**
 * Registro interno da disputa (assunto, motivo e notas). O estado da Disputa
 * (aberta, resolvida, reaberta) muda só pela conversa de Disputas: o banco não
 * aceita UPDATE dessas colunas (migration 106).
 */
export function DisputeModal({ open, docNumber, form, loading, error = null, onFormChange, onClose, onSubmit }: Props) {
  return (
    <Modal open={open} onClose={onClose} title={docNumber ? `Dados da disputa ${docNumber}` : 'Dados da disputa'} size="md">
      <form className="app-dem-form" noValidate onSubmit={(event) => { event.preventDefault(); onSubmit() }}>
        <p className="app-dem-note">
          Registro interno. Abrir, encerrar ou reabrir a Disputa e responder ao Cliente é feito na aba Disputas.
        </p>
        <Field label="Assunto">
          <Input type="text" value={form.dispute_subject} onChange={(event) => onFormChange({ ...form, dispute_subject: event.target.value })} />
        </Field>
        <Field label="Motivo">
          <Textarea rows={2} value={form.dispute_reason} onChange={(event) => onFormChange({ ...form, dispute_reason: event.target.value })} />
        </Field>
        <Field label="Notas" hint="Não aparecem para o Cliente.">
          <Textarea rows={2} value={form.dispute_notes} onChange={(event) => onFormChange({ ...form, dispute_notes: event.target.value })} />
        </Field>
        {error ? <p className="app-dem-form__error" role="alert">{error} Nada foi salvo.</p> : null}
        <div className="app-dem-form__actions">
          <Button type="button" variant="ghost" onClick={onClose}>Voltar</Button>
          <Button type="submit" loading={loading} loadingLabel="Salvando…">Salvar dados</Button>
        </div>
      </form>
    </Modal>
  )
}
