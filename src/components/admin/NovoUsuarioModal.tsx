import { useState, type FormEvent } from 'react'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { Field, Input, Select } from '../ui/Input'
import { MANAGED_PROFILES, PROFILE_LABELS, PROFILE_SCOPES } from '../../services/adminUsers'
import { PASSWORD_RULE_MESSAGE, isValidPassword } from '../../lib/passwordPolicy'
import type { UserProfileRole } from '../../types/database'

export function NovoUsuarioModal({
  open,
  onClose,
  onSubmit,
  submitting,
}: {
  open: boolean
  onClose: () => void
  onSubmit: (input: { full_name: string; email: string; password: string; role: UserProfileRole }) => void
  submitting: boolean
}) {
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState('')

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (fullName.trim().length < 3) return setError('Informe o nome completo do usuário.')
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) return setError('E-mail inválido.')
    if (!role) return setError('Selecione o setor do usuário.')
    if (!isValidPassword(password)) return setError(PASSWORD_RULE_MESSAGE)
    if (password !== confirmation) return setError('As senhas não conferem.')
    setError('')
    onSubmit({ full_name: fullName.trim(), email: email.trim().toLowerCase(), password, role: role as UserProfileRole })
  }

  return (
    <Modal open={open} title="Novo usuário" onClose={onClose}>
      <form onSubmit={handleSubmit} noValidate className="grid gap-3">
        <Field label="Nome completo" required>
          <Input value={fullName} onChange={(e) => setFullName(e.target.value)} autoFocus />
        </Field>
        <Field label="E-mail de login" required>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Setor" required>
          <Select value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="">Selecione o setor</option>
            {MANAGED_PROFILES.map((profile) => (
              <option key={profile} value={profile}>{PROFILE_LABELS[profile]}</option>
            ))}
          </Select>
        </Field>
        {role ? <p className="text-xs text-[var(--app-muted)]">{PROFILE_SCOPES[role]}</p> : null}
        <Field label="Senha" required>
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Field label="Confirmar senha" required>
          <Input type="password" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} />
        </Field>
        <p className="text-xs text-[var(--app-muted)]">{PASSWORD_RULE_MESSAGE}</p>
        {error ? <p className="app-field__error" role="alert">{error}</p> : null}
        <div className="mt-2 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Voltar</Button>
          <Button type="submit" loading={submitting}>Criar usuário</Button>
        </div>
      </form>
    </Modal>
  )
}
