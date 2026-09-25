import { useState, type FormEvent } from 'react'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { Field, Input } from '../ui/Input'
import { PASSWORD_RULE_MESSAGE, isValidPassword } from '../../lib/passwordPolicy'

export function EditarAcessoModal({
  open,
  userName,
  currentEmail,
  onClose,
  onSubmit,
  submitting,
}: {
  open: boolean
  userName: string
  currentEmail: string | null
  onClose: () => void
  onSubmit: (input: { email?: string; password?: string }) => void
  submitting: boolean
}) {
  const [email, setEmail] = useState(currentEmail ?? '')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState('')

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const trimmed = email.trim().toLowerCase()
    const emailChanged = trimmed !== (currentEmail ?? '').toLowerCase()
    if (emailChanged && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmed)) return setError('E-mail inválido.')
    if (password && !isValidPassword(password)) return setError(PASSWORD_RULE_MESSAGE)
    if (password && password !== confirmation) return setError('As senhas não conferem.')
    if (!emailChanged && !password) return setError('Informe um novo e-mail ou uma nova senha.')
    setError('')
    onSubmit({ email: emailChanged ? trimmed : undefined, password: password || undefined })
  }

  return (
    <Modal open={open} title={`Editar acesso — ${userName}`} onClose={onClose}>
      <form onSubmit={handleSubmit} className="grid gap-3">
        <Field label="E-mail de login">
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Nova senha">
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Deixe em branco para manter" />
        </Field>
        <Field label="Confirmar nova senha">
          <Input type="password" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} />
        </Field>
        <p className="text-xs text-[var(--app-muted)]">
          Ninguém consegue consultar a senha atual: ela é guardada cifrada. Para socorrer quem esqueceu, defina uma nova aqui.
        </p>
        {error ? <p className="app-field__error" role="alert">{error}</p> : null}
        <div className="mt-2 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Voltar</Button>
          <Button type="submit" loading={submitting}>Salvar</Button>
        </div>
      </form>
    </Modal>
  )
}
