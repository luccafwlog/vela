import { useState, type FormEvent } from 'react'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { Field } from '../ui/Input'
import { PasswordInput } from '../auth/PasswordInput'
import { useToast } from '../ui/Toast'
import { supabase } from '../../services/supabase'
import { PASSWORD_RULE_MESSAGE, isValidPassword } from '../../lib/passwordPolicy'
import { recordAuditEntries } from '../../services/auditEntries'
import { reportBestEffortFailure } from '../../lib/telemetry'

const CURRENT_PASSWORD_CODES = new Set(['invalid_credentials', 'current_password_mismatch', 'current_password_required'])

export function AlterarMinhaSenhaModal({
  open,
  email,
  onClose,
}: {
  open: boolean
  email: string
  onClose: () => void
}) {
  const { showToast } = useToast()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!isValidPassword(next)) return setError(PASSWORD_RULE_MESSAGE)
    if (next !== confirmation) return setError('As senhas não conferem.')
    setError('')
    setSubmitting(true)
    try {
      // Revalidar a senha atual impede que uma estação destravada troque a senha.
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password: current })
      if (signInError) { setError('Senha atual incorreta.'); return }
      // A senha atual também vai na troca: com "Require current password" ligado
      // no Auth, um token roubado não troca a senha sem ela (auditoria run-3, P1).
      const { data: updated, error: updateError } = await supabase.auth.updateUser({ password: next, current_password: current })
      if (updateError) {
        setError(CURRENT_PASSWORD_CODES.has(updateError.code ?? '') ? 'Senha atual incorreta.' : 'Não foi possível alterar a senha.')
        return
      }
      // Histórico da troca (migration 421), sem a senha. A troca já valeu: falha
      // aqui só vai para a telemetria.
      const userId = updated?.user?.id
      if (userId) {
        await recordAuditEntries([{ entity_type: 'user_profile', entity_id: userId, field_name: 'password', old_value: null, new_value: 'alterada pelo próprio usuário' }])
          .catch((auditError: unknown) => reportBestEffortFailure('alterar-minha-senha:historico', auditError))
      }
      showToast('Senha alterada.', 'success')
      onClose()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal open={open} title="Alterar minha senha" onClose={onClose} size="sm">
      <form onSubmit={handleSubmit} className="grid gap-4">
        <Field label="Senha atual" required>
          <PasswordInput autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        </Field>
        <div className="grid gap-1.5">
          <Field label="Nova senha" required>
            <PasswordInput
              autoComplete="new-password"
              aria-describedby="alterar-senha-regra"
              value={next}
              onChange={(e) => setNext(e.target.value)}
            />
          </Field>
          <p id="alterar-senha-regra" className="app-field__hint">{PASSWORD_RULE_MESSAGE}</p>
        </div>
        <Field label="Confirmar nova senha" required>
          <PasswordInput autoComplete="new-password" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} />
        </Field>
        {error ? <p className="app-field__error" role="alert">{error}</p> : null}
        <div className="mt-2 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Voltar</Button>
          <Button type="submit" loading={submitting} loadingLabel="Alterando...">Alterar senha</Button>
        </div>
      </form>
    </Modal>
  )
}
