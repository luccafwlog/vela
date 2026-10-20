import { useState, type FormEvent } from 'react'
import { InlineError, PageHeader } from '../components/ui/Card'
import { Block, Fact, FactList, LeadValue } from '../components/ui/Block'
import { NoValue } from '../components/ui/NoValue'
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
      <PageHeader title="Meu perfil" />
      {/* Dois blocos, um acima do outro, até 720 px (lote 6a da identidade). */}
      <div className="grid max-w-[720px] gap-4">
        <Block title="Dados pessoais">
          <form className="grid gap-4" onSubmit={handleSubmit}>
            {/* Só o nome: e-mail e Departamento ficam na lista abaixo, sem repetir. */}
            <LeadValue>{profile?.full_name || <NoValue label="Sem nome" />}</LeadValue>
            <Field label="Nome" required>
              <Input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" />
            </Field>
            <FactList>
              <Fact label="E-mail de acesso">{session?.user.email ?? <NoValue />}</Fact>
              <Fact label="Departamento">{departmentLabel(profile?.role)}</Fact>
            </FactList>
            {/* D13 (plano dos e-mails, 4.9): a confirmação de troca pelo Auth nunca
                chegava (SMTP padrão do Supabase só entrega ao Team); quem troca é o
                Administrativo em Admin › Usuários › Editar acesso, sem e-mail. */}
            <p className="app-field__hint">
              Para trocar o e-mail de acesso, peça ao Administrativo: a troca é feita em Admin › Usuários › Editar acesso.
            </p>
            {error ? <InlineError message={error} /> : null}
            <div className="flex justify-end">
              <Button type="submit" loading={saving} loadingLabel="Salvando...">Salvar alterações</Button>
            </div>
          </form>
        </Block>

        <Block title="Senha">
          <div className="grid justify-items-start gap-3">
            <p className="app-field__hint">Para trocar, informe a senha atual e a nova.</p>
            <Button variant="secondary" onClick={() => setPasswordOpen(true)}>Alterar senha</Button>
          </div>
        </Block>
      </div>
      {passwordOpen && session?.user.email ? (
        <AlterarMinhaSenhaModal open email={session.user.email} onClose={() => setPasswordOpen(false)} />
      ) : null}
    </>
  )
}
