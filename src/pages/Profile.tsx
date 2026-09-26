import { useState, type FormEvent } from 'react'
import { Card, InlineError, PageHeader } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Field, Input } from '../components/ui/Input'
import { AlterarMinhaSenhaModal } from '../components/admin/AlterarMinhaSenhaModal'
import { useAuth } from '../hooks/useAuth'
import { useToast } from '../components/ui/Toast'
import { supabase } from '../services/supabase'

function departmentLabel(role: string | null | undefined): string {
  switch (role) {
    case 'administrativo': return 'Administrativo'
    case 'financeiro': return 'Financeiro'
    case 'operacoes': return 'Operações'
    case 'equipamentos': return 'Equipamentos'
    case 'operator':
    case 'documentacao': return 'Documentação'
    default: return '—'
  }
}

export function Profile() {
  const { profile, session, refreshProfile } = useAuth()
  const { showToast } = useToast()
  const [name, setName] = useState(profile?.full_name ?? '')
  const [email, setEmail] = useState(session?.user.email ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [passwordOpen, setPasswordOpen] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const trimmedName = name.trim()
    const trimmedEmail = email.trim().toLowerCase()
    if (!trimmedName || !trimmedEmail) {
      setError('Informe nome e e-mail.')
      return
    }
    setError('')
    setSaving(true)
    try {
      const { error: profileError } = await supabase
        .from('user_profiles')
        .update({ full_name: trimmedName })
        .eq('id', profile?.id ?? '')
      if (profileError) throw profileError

      if (trimmedEmail !== session?.user.email?.toLowerCase()) {
        const { error: emailError } = await supabase.auth.updateUser({ email: trimmedEmail })
        if (emailError) throw emailError
        showToast('Dados salvos. Confirme o novo e-mail pela mensagem recebida.', 'success')
      } else {
        showToast('Dados do perfil salvos.', 'success')
      }
      await refreshProfile()
    } catch {
      setError('Não foi possível salvar os dados do perfil.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <PageHeader title="Meu perfil" description="Consulte e atualize seus dados de acesso ao sistema." />
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <form className="grid gap-4" onSubmit={handleSubmit}>
            <div className="text-sm font-semibold text-[var(--app-text-strong)]">Dados pessoais</div>
            <Field label="Nome" required>
              <Input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" />
            </Field>
            <Field label="E-mail" required>
              <Input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" />
            </Field>
            <Field label="Departamento">
              <Input value={departmentLabel(profile?.role)} readOnly aria-readonly="true" />
            </Field>
            {error ? <InlineError message={error} /> : null}
            <div className="flex justify-end">
              <Button type="submit" loading={saving}>Salvar alterações</Button>
            </div>
          </form>
        </Card>

        <Card>
          <div className="grid gap-3">
            <div>
              <div className="text-sm font-semibold text-[var(--app-text-strong)]">Senha</div>
              <p className="mt-1 text-sm text-[var(--app-muted)]">Altere sua senha informando a senha atual.</p>
            </div>
            <div>
              <Button variant="secondary" onClick={() => setPasswordOpen(true)}>Alterar senha</Button>
            </div>
          </div>
        </Card>
      </div>
      {passwordOpen && session?.user.email ? (
        <AlterarMinhaSenhaModal open email={session.user.email} onClose={() => setPasswordOpen(false)} />
      ) : null}
    </>
  )
}
