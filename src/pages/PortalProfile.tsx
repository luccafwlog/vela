import { useEffect, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Button } from '../components/ui/Button'
import { Card, InlineError, PageHeader } from '../components/ui/Card'
import { Field, Input } from '../components/ui/Input'
import { PasswordInput } from '../components/auth/PasswordInput'
import { useToast } from '../components/ui/Toast'
import { useConfirm } from '../components/ui/ConfirmDialog'
import { usePortalProfile } from '../hooks/usePortalProfile'
import { usePortalScope } from '../hooks/usePortalScope'
import { portalErrorMessage } from '../lib/portalErrorMessage'
import type { PortalProfile as PortalProfileData } from '../services/portalBilling'
import { supabasePortal } from '../services/supabase'
import { PortalContactConfiguration } from '../components/portal/PortalContactConfiguration'
import { isPortalReadOnly } from '../services/portalScope'

export const RECOVERY_EMAIL_RATE_LIMIT_MESSAGE =
  'Muitas tentativas com a senha atual. Este limite é o mesmo do login do Portal, então aguarde alguns minutos antes de tentar de novo — aqui e no login.'

export const RECOVERY_EMAIL_SEND_FAILED_MESSAGE =
  'Não conseguimos enviar o email de confirmação. Nenhuma troca foi iniciada; tente novamente mais tarde.'

export function PortalProfile() {
  const profile = usePortalProfile()
  const scope = usePortalScope()
  const readOnly = isPortalReadOnly(scope)
  const [searchParams, setSearchParams] = useSearchParams()
  const { showToast } = useToast()
  // Compatibilidade: a confirmacao passou a viver em /portal/confirmar-email
  // (rota publica). Este ramo atende os links ja enviados para
  // /portal/perfil?confirm_email=, validos por 48h, e pode sair depois que a
  // ultima janela desses convites expirar.
  useEffect(() => {
    const token = searchParams.get('confirm_email')
    if (!token) return
    if (readOnly) return
    void supabasePortal.functions.invoke('portal-recovery-email-change', { body: { action: 'confirm', token } }).then(({ error }) => {
      showToast(error ? 'Não foi possível confirmar o novo email.' : 'Email de Recuperação atualizado com sucesso.', error ? 'error' : 'success')
      searchParams.delete('confirm_email'); setSearchParams(searchParams, { replace: true })
    })
  }, [searchParams, setSearchParams, showToast, readOnly])
  const loadError = profile.error
    ? portalErrorMessage(profile.error, 'Falha ao carregar perfil. Tente novamente em instantes.')
    : ''

  return (
    <>
      <PageHeader title="Meu perfil" description="Contatos que recebem comunicados, endereço da empresa e o email usado para recuperar a senha." />

      {readOnly ? (
        <p className="portal-profile__inspection-note" role="note">
          Modo Inspeção: os formulários aparecem como o Cliente vê, mas ficam só para leitura.
        </p>
      ) : null}

      {profile.data ? (
        <PortalProfileForm
          profile={profile.data}
          updateProfile={profile.updateProfile.mutateAsync}
          loadError={loadError}
          loadFailed={profile.isError}
          readOnly={readOnly}
        />
      ) : (
        <Card className="p-5">
          <div className="grid gap-4">
            {loadError ? <InlineError message={loadError} /> : <div className="text-sm text-[var(--app-muted)]" role="status">Carregando perfil…</div>}
            <div className="flex justify-end">
              <Button disabled type="button">Salvar alterações</Button>
            </div>
          </div>
        </Card>
      )}
    </>
  )
}

function PortalProfileForm({
  profile,
  updateProfile,
  loadError,
  loadFailed,
  readOnly,
}: {
  profile: PortalProfileData
  updateProfile: (input: {
    contactEmail?: string | null
    phone?: string | null
    address?: string | null
    city?: string | null
    state?: string | null
    zip?: string | null
  }) => Promise<unknown>
  loadError: string
  loadFailed: boolean
  readOnly: boolean
}) {
  const { showToast } = useToast()
  const confirm = useConfirm()
  const [address, setAddress] = useState(profile.address ?? '')
  const [city, setCity] = useState(profile.city ?? '')
  const [state, setState] = useState(profile.state ?? '')
  const [zip, setZip] = useState(profile.zip ?? '')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newRecoveryEmail, setNewRecoveryEmail] = useState('')
  const [confirmRecoveryEmail, setConfirmRecoveryEmail] = useState('')
  const [emailSubmitting, setEmailSubmitting] = useState(false)
  const [recoveryError, setRecoveryError] = useState('')

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError('')
    if (readOnly) return
    const changes = [
      ...([
        ['Endereço', profile.address ?? '', address.trim() || '—'],
        ['Cidade', profile.city ?? '', city.trim() || '—'],
        ['Estado', profile.state ?? '', state.trim() || '—'],
        ['CEP', profile.zip ?? '', zip.trim() || '—'],
      ] as const)
        .filter(([, before, after]) => (before || '—') !== after)
        .map(([field, before, after]) => ({ field, before: before || '—', after })),
    ]
    if (changes.length === 0) {
      showToast('Nenhuma alteração detectada.', 'info')
      return
    }
    const confirmed = await confirm({
      title: 'Confirmar alterações do perfil',
      message: 'Salvar os dados cadastrais alterados?',
      confirmLabel: 'Salvar alterações',
      changes,
      consequence: 'Os dados de contato e endereço do cliente serão atualizados no Portal e nos fluxos que consultam o perfil.',
      reversibility: 'Edite novamente para corrigir os dados.',
    })
    if (!confirmed) return
    setSubmitting(true)

    try {
      await updateProfile({
        address: address.trim() || null,
        city: city.trim() || null,
        state: state.trim() || null,
        zip: zip.trim() || null,
      })
      showToast('Perfil atualizado com sucesso.', 'success')
    } catch (err: unknown) {
      setError(portalErrorMessage(err, 'Falha ao atualizar perfil. Tente novamente em instantes.'))
    } finally {
      setSubmitting(false)
    }
  }

  async function handleRecoveryEmailChange(event: FormEvent) {
    event.preventDefault(); setRecoveryError('')
    if (newRecoveryEmail.trim().toLowerCase() !== confirmRecoveryEmail.trim().toLowerCase()) { setRecoveryError('Os emails de recuperação não conferem.'); return }
    if (readOnly) return
    const nextRecoveryEmail = newRecoveryEmail.trim().toLowerCase()
    const confirmed = await confirm({
      title: 'Confirmar troca do e-mail de recuperação',
      message: `Enviar um link para confirmar ${nextRecoveryEmail}?`,
      confirmLabel: 'Enviar link',
      changes: [{ field: 'E-mail de recuperação', before: 'Endereço atual', after: nextRecoveryEmail }],
      consequence: 'Um link de confirmação será enviado ao novo endereço. O endereço atual continua válido até a confirmação.',
      reversibility: 'Antes da confirmação, basta solicitar a troca para outro endereço.',
    })
    if (!confirmed) return
    setEmailSubmitting(true)
    try {
      const { error: invokeError } = await supabasePortal.functions.invoke('portal-recovery-email-change', { body: { action: 'request', current_password: currentPassword, new_email: nextRecoveryEmail } })
      const status = (invokeError as { context?: { status?: number } } | null)?.context?.status
      if (status === 429) { setRecoveryError(RECOVERY_EMAIL_RATE_LIMIT_MESSAGE); return }
      if (status === 502) { setRecoveryError(RECOVERY_EMAIL_SEND_FAILED_MESSAGE); return }
      if (invokeError) throw invokeError
      showToast('Enviamos um link para confirmar o novo email.', 'success')
      setCurrentPassword(''); setNewRecoveryEmail(''); setConfirmRecoveryEmail('')
    } catch (err) { setRecoveryError(portalErrorMessage(err, 'Não foi possível iniciar a troca de email.')) } finally { setEmailSubmitting(false) }
  }

  // Três formulários independentes, cada um com o próprio botão e os próprios
  // erros: contatos (quem recebe comunicados), dados cadastrais (endereço) e
  // Email de Recuperação (convites e redefinição de senha, separado dos
  // contatos).
  return (
    <div className="portal-profile">
      <Card className="portal-profile__contacts min-w-0">
        <PortalContactConfiguration readOnly={readOnly} />
      </Card>

      <div className="portal-profile__side">
        <Card className="min-w-0">
          <form className="grid gap-4" onSubmit={handleSubmit}>
            <div>
              <h2 className="portal-profile__section-title">Dados cadastrais</h2>
              <p className="portal-profile__section-intro">Endereço da empresa no cadastro da FWLOG.</p>
            </div>
            <fieldset className="portal-profile__fieldset" disabled={readOnly}>
              <legend className="sr-only">Endereço</legend>
              <Field label="Endereço">
                <Input
                  type="text"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="Rua, número, complemento"
                  autoComplete="street-address"
                />
              </Field>

              <Field label="Cidade">
                <Input type="text" value={city} onChange={(e) => setCity(e.target.value)} placeholder="São Paulo" autoComplete="address-level2" />
              </Field>
              <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-4">
                <Field label="Estado">
                  <Input type="text" value={state} onChange={(e) => setState(e.target.value)} placeholder="SP" maxLength={2} autoComplete="address-level1" />
                </Field>
                <Field label="CEP">
                  <Input type="text" inputMode="numeric" value={zip} onChange={(e) => setZip(e.target.value)} placeholder="01000-000" autoComplete="postal-code" />
                </Field>
              </div>
            </fieldset>

            {loadError || error ? <InlineError message={error || loadError} /> : null}

            <div className="portal-profile__form-actions">
              <Button disabled={readOnly || loadFailed} loading={submitting} loadingLabel="Salvando..." type="submit" title={readOnly ? 'Ação do cliente — indisponível em Modo Inspeção' : undefined}>Salvar alterações</Button>
            </div>
          </form>
        </Card>

        <Card className="min-w-0">
          <form className="grid gap-4" onSubmit={handleRecoveryEmailChange}>
            <div>
              <h2 className="portal-profile__section-title">Email de Recuperação</h2>
              <p className="portal-profile__section-intro">
                Recebe convites e links para redefinir a senha do Portal; é separado dos contatos de comunicados. O endereço atual continua valendo até o novo ser confirmado pelo link.
              </p>
            </div>
            <fieldset className="portal-profile__fieldset" disabled={readOnly}>
              <legend className="sr-only">Trocar Email de Recuperação</legend>
              <div className="grid gap-1.5">
                <Field label="Senha atual">
                  <PasswordInput
                    autoComplete="current-password"
                    aria-describedby="portal-recovery-password-note"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                  />
                </Field>
                <p id="portal-recovery-password-note" className="app-field__hint">Errar a senha aqui consome as mesmas tentativas do login do Portal.</p>
              </div>
              <Field label="Novo email"><Input type="email" autoComplete="email" value={newRecoveryEmail} onChange={(e) => setNewRecoveryEmail(e.target.value)} /></Field>
              <Field label="Confirmar novo email"><Input type="email" autoComplete="email" value={confirmRecoveryEmail} onChange={(e) => setConfirmRecoveryEmail(e.target.value)} /></Field>
            </fieldset>
            {recoveryError ? <InlineError message={recoveryError} /> : null}
            <div className="portal-profile__form-actions"><Button disabled={readOnly} loading={emailSubmitting} loadingLabel="Enviando..." type="submit" title={readOnly ? 'Ação do cliente — indisponível em Modo Inspeção' : undefined}>Solicitar troca de email</Button></div>
          </form>
        </Card>
      </div>
    </div>
  )
}
