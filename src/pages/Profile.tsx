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
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [passwordOpen, setPasswordOpen] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const trimmedName = name.trim()
    if (!trimmedName) {
      setError('Informe o nome.')
      return
    }
    const currentName = profile?.full_name ?? ''
    if (trimmedName === currentName) {
      showToast('Nenhuma alteração detectada.', 'info')
      return
    }

    const confirmed = await confirm({
      title: 'Confirmar alterações do perfil',
      message: 'Salvar as alterações dos dados pessoais?',
      confirmLabel: 'Salvar alterações',
      changes: [{ field: 'Nome', before: currentName, after: trimmedName }],
      consequence: 'O nome será atualizado nos dados de acesso ao sistema.',
      reversibility: 'Edite novamente para corrigir o nome.',
    })
    if (!confirmed) return

    setError('')
    setSaving(true)
    try {
      const { error: profileError } = await supabase
        .from('user_profiles')
        .update({ full_name: trimmedName })
        .eq('id', profile?.id ?? '')
      if (profileError) throw profileError
      showToast('Dados do perfil salvos.', 'success')
      await refreshProfile()
    } catch {
      setError('Não foi possível salvar os dados do perfil.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <PageHeader title="Meu perfil" description="Nome, e-mail de acesso ao Vela e troca de senha." />
      <div className="vela-profile">
        <Card>
          <form className="grid gap-4" onSubmit={handleSubmit}>
            <h2 className="portal-profile__section-title">Dados pessoais</h2>
            <Field label="Nome" required>
              <Input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" />
            </Field>
            <dl className="vela-profile__facts">
              <div>
                <dt>E-mail de acesso</dt>
                <dd>{session?.user.email ?? '—'}</dd>
              </div>
              <div>
                <dt>Departamento</dt>
                <dd>{departmentLabel(profile?.role)}</dd>
              </div>
            </dl>
            {/* D13 (plano dos e-mails, 4.9): a confirmação de troca pelo Auth nunca
                chegava (SMTP padrão do Supabase só entrega ao Team); quem troca é o
                Administrativo em Admin › Usuários › Editar acesso, sem e-mail. */}
            <p className="app-field__hint">
              Para trocar o e-mail de acesso, peça ao Administrativo: a troca é feita em Admin › Usuários › Editar acesso.
            </p>
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
