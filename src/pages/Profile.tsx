import { useState, type FormEvent } from 'react'
import { Card, InlineError, PageHeader } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { useConfirm } from '../components/ui/ConfirmDialog'
import { Field, Input } from '../components/ui/Input'
import { AlterarMinhaSenhaModal } from '../components/admin/AlterarMinhaSenhaModal'
import { useAuth } from '../hooks/useAuth'
import { useToast } from '../components/ui/Toast'
import { supabase } from '../services/supabase'
import { departmentLabel } from '../lib/departmentLabel'

export function Profile() {
  const { profile, session, refreshProfile } = useAuth()
  const { showToast } = useToast()
  const confirm = useConfirm()
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
    const currentName = profile?.full_name ?? ''
    const currentEmail = session?.user.email?.toLowerCase() ?? ''
    const emailChanged = trimmedEmail !== currentEmail
    const changes = [
      ...(trimmedName !== currentName ? [{ field: 'Nome', before: currentName, after: trimmedName }] : []),
      ...(emailChanged ? [{ field: 'E-mail', before: currentEmail, after: trimmedEmail }] : []),
    ]
    if (changes.length === 0) {
      showToast('Nenhuma alteração detectada.', 'info')
      return
    }

    const confirmed = await confirm({
      title: 'Confirmar alterações do perfil',
      message: 'Salvar as alterações dos dados pessoais?',
      confirmLabel: 'Salvar alterações',
      changes,
      consequence: emailChanged
        ? 'O nome será atualizado e o e-mail novo ficará pendente até a confirmação enviada ao endereço informado.'
        : 'O nome será atualizado nos dados de acesso ao sistema.',
      reversibility: emailChanged
        ? 'O nome pode ser editado novamente. A troca de e-mail só passa a valer depois da confirmação do link.'
        : 'Edite novamente para corrigir o nome.',
    })
    if (!confirmed) return

    setError('')
    setSaving(true)
    try {
      if (trimmedName !== currentName) {
        const { error: profileError } = await supabase
          .from('user_profiles')
          .update({ full_name: trimmedName })
          .eq('id', profile?.id ?? '')
        if (profileError) throw profileError
      }

      if (emailChanged) {
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
      <PageHeader title="Meu perfil" description="Nome e e-mail de acesso ao Vela e troca de senha." />
      <div className="vela-profile">
        <Card>
          <form className="grid gap-4" onSubmit={handleSubmit}>
            <h2 className="portal-profile__section-title">Dados pessoais</h2>
            <Field label="Nome" required>
              <Input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" />
            </Field>
            <div className="grid gap-1.5">
              <Field label="E-mail" required>
                <Input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoComplete="email"
                  aria-describedby="profile-email-note"
                />
              </Field>
              <p id="profile-email-note" className="app-field__hint">
                É o e-mail de login. Um endereço novo só passa a valer depois da confirmação enviada a ele.
              </p>
            </div>
            <dl className="vela-profile__facts">
              <div>
                <dt>Departamento</dt>
                <dd>{departmentLabel(profile?.role)}</dd>
              </div>
            </dl>
            {error ? <InlineError message={error} /> : null}
            <div className="portal-profile__form-actions">
              <Button type="submit" loading={saving} loadingLabel="Salvando...">Salvar alterações</Button>
            </div>
          </form>
        </Card>

        <Card>
          <div className="grid gap-3">
            <div>
              <h2 className="portal-profile__section-title">Senha</h2>
              <p className="portal-profile__section-intro">Para trocar, informe a senha atual e a nova.</p>
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
