import { useState, type FormEvent } from 'react'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { Field, Input } from '../ui/Input'
import { useToast } from '../ui/Toast'
import { supabase } from '../../services/supabase'
import { PASSWORD_RULE_MESSAGE, isValidPassword } from '../../lib/passwordPolicy'

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
      const { error: updateError } = await supabase.auth.updateUser({ password: next })
      if (updateError) { setError('Não foi possível alterar a senha.'); return }
      showToast('Senha alterada.', 'success')
      onClose()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal open={open} title="Alterar minha senha" onClose={onClose}>
      <form onSubmit={handleSubmit} className="grid gap-3">
        <Field label="Senha atual" required>
          <Input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoFocus />
        </Field>
        <Field label="Nova senha" required>
          <Input type="password" value={next} onChange={(e) => setNext(e.target.value)} />
        </Field>
        <Field label="Confirmar nova senha" required>
          <Input type="password" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} />
        </Field>
        <p className="text-xs text-[var(--app-muted)]">{PASSWORD_RULE_MESSAGE}</p>
        {error ? <p className="app-field__error" role="alert">{error}</p> : null}
        <div className="mt-2 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Voltar</Button>
          <Button type="submit" loading={submitting}>Alterar senha</Button>
        </div>
      </form>
    </Modal>
  )
}
