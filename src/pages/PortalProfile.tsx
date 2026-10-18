import { useEffect, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Block, Fact, FactList } from '../components/ui/Block'
import { Button } from '../components/ui/Button'
import { InlineError, PageHeader } from '../components/ui/Card'
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
import { ProfileSaveBar } from '../components/portal/ProfileSaveBar'
import { isPortalReadOnly } from '../services/portalScope'

export const RECOVERY_EMAIL_RATE_LIMIT_MESSAGE =
  'Muitas tentativas com a senha atual. Este limite é o mesmo do login do Portal, então aguarde alguns minutos antes de tentar de novo — aqui e no login.'

export const RECOVERY_EMAIL_SEND_FAILED_MESSAGE =
  'Não conseguimos enviar o email de confirmação. Nenhuma troca foi iniciada; tente novamente mais tarde.'

const READ_ONLY_TITLE = 'Ação do cliente — indisponível em Modo Inspeção'
const fieldsetClass = 'm-0 grid min-w-0 gap-4 border-0 p-0'

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
      showToast(error ? 'Não foi possível confirmar o novo e-mail.' : 'E-mail de recuperação atualizado com sucesso.', error ? 'error' : 'success')
      searchParams.delete('confirm_email'); setSearchParams(searchParams, { replace: true })
    })
  }, [searchParams, setSearchParams, showToast, readOnly])
  const loadError = profile.error
    ? portalErrorMessage(profile.error, 'Falha ao carregar perfil. Tente novamente em instantes.')
    : ''

  return (
    <>
      <PageHeader title="Meu perfil" description="Contatos que recebem comunicados, endereço da empresa e o e-mail usado para recuperar a senha." />

      {readOnly ? (
        <p className="portal-profile__inspection-note" role="note">
          Modo Inspeção: os formulários aparecem como o Cliente vê, mas ficam só para leitura.
        </p>
      ) : null}

      <div className="grid gap-4">
        <PortalContactConfiguration readOnly={readOnly} />

        {profile.data ? (
          <PortalProfileForm
            profile={profile.data}
            updateProfile={profile.updateProfile.mutateAsync}
            loadError={loadError}
            loadFailed={profile.isError}
            readOnly={readOnly}
          />
        ) : (
          <Block title="Endereço da empresa" aside="no cadastro da FWLOG">
            {loadError ? <InlineError message={loadError} /> : <p className="m-0 text-sm text-[var(--app-muted)]" role="status">Carregando perfil…</p>}
            <ProfileSaveBar>
              <Button disabled type="button">Salvar endereço</Button>
            </ProfileSaveBar>
          </Block>
        )}
      </div>
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

  const addressChanges = ([
    ['Endereço', profile.address ?? '', address.trim() || '—'],
    ['Cidade', profile.city ?? '', city.trim() || '—'],
    ['Estado', profile.state ?? '', state.trim() || '—'],
    ['CEP', profile.zip ?? '', zip.trim() || '—'],
  ] as const)
    .filter(([, before, after]) => (before || '—') !== after)
    .map(([field, before, after]) => ({ field, before: before || '—', after }))
  const addressDirty = addressChanges.length > 0
  const recoveryReady = Boolean(currentPassword && newRecoveryEmail.trim() && confirmRecoveryEmail.trim())
  // ponytail: o e-mail de recuperação atual só aparece quando
  // `portal_get_profile` o devolve; a consulta de hoje traz só o contact_email,
  // que não acompanha a troca. Sem o campo, o bloco começa pela senha atual.
  const currentRecoveryEmail = (profile as PortalProfileData & { recovery_email?: string | null }).recovery_email ?? null

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError('')
    if (readOnly) return
    if (!addressDirty) {
      showToast('Nenhuma alteração detectada.', 'info')
      return
    }
    const confirmed = await confirm({
      title: 'Confirmar endereço da empresa',
      message: 'Salvar o endereço alterado?',
      confirmLabel: 'Salvar endereço',
      changes: addressChanges,
      consequence: 'O endereço do cliente será atualizado no Portal e nos fluxos que consultam o perfil.',
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
      showToast('Endereço atualizado com sucesso.', 'success')
    } catch (err: unknown) {
      setError(portalErrorMessage(err, 'Falha ao atualizar perfil. Tente novamente em instantes.'))
    } finally {
      setSubmitting(false)
    }
  }

  async function handleRecoveryEmailChange(event: FormEvent) {
    event.preventDefault(); setRecoveryError('')
    if (newRecoveryEmail.trim().toLowerCase() !== confirmRecoveryEmail.trim().toLowerCase()) { setRecoveryError('Os e-mails de recuperação não conferem.'); return }
    if (readOnly) return
    const nextRecoveryEmail = newRecoveryEmail.trim().toLowerCase()
    const confirmed = await confirm({
      title: 'Confirmar troca do e-mail de recuperação',
      message: `Enviar um link para confirmar ${nextRecoveryEmail}?`,
      confirmLabel: 'Enviar link',
      changes: [{ field: 'E-mail de recuperação', before: currentRecoveryEmail ?? 'Endereço atual', after: nextRecoveryEmail }],
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
      showToast('Enviamos um link para confirmar o novo e-mail.', 'success')
      setCurrentPassword(''); setNewRecoveryEmail(''); setConfirmRecoveryEmail('')
    } catch (err) { setRecoveryError(portalErrorMessage(err, 'Não foi possível iniciar a troca de e-mail.')) } finally { setEmailSubmitting(false) }
  }

  // Três blocos independentes, cada um com o próprio botão principal no pé e
  // os próprios erros: contatos (quem recebe comunicados), endereço e e-mail
  // de recuperação (convites e redefinição de senha, separado dos contatos).
  return (
    <div className="grid items-start gap-4 lg:grid-cols-2">
      <Block title="Endereço da empresa" aside="no cadastro da FWLOG">
        <form className="grid gap-4" onSubmit={handleSubmit}>
          <fieldset className={fieldsetClass} disabled={readOnly}>
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
            <div className="grid gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1.2fr)]">
              <Field label="Cidade">
                <Input type="text" value={city} onChange={(e) => setCity(e.target.value)} placeholder="São Paulo" autoComplete="address-level2" />
              </Field>
              <Field label="Estado">
                <Input type="text" value={state} onChange={(e) => setState(e.target.value)} placeholder="SP" maxLength={2} autoComplete="address-level1" />
              </Field>
              <Field label="CEP">
                <Input type="text" inputMode="numeric" value={zip} onChange={(e) => setZip(e.target.value)} placeholder="01000-000" autoComplete="postal-code" />
              </Field>
            </div>
          </fieldset>

          {loadError || error ? <InlineError message={error || loadError} /> : null}

          <ProfileSaveBar status={readOnly ? null : addressDirty ? 'Endereço alterado, ainda não salvo.' : 'Nada alterado.'}>
            <Button disabled={readOnly || loadFailed || !addressDirty} loading={submitting} loadingLabel="Salvando..." type="submit" title={readOnly ? READ_ONLY_TITLE : undefined}>Salvar endereço</Button>
          </ProfileSaveBar>
        </form>
      </Block>

      <Block title="E-mail de recuperação" aside="recebe convites e o link para trocar a senha">
        <form className="grid gap-4" onSubmit={handleRecoveryEmailChange}>
          {currentRecoveryEmail ? (
            <FactList columns={1}>
              <Fact label="E-mail atual">{currentRecoveryEmail}</Fact>
            </FactList>
          ) : null}
          <fieldset className={fieldsetClass} disabled={readOnly}>
            <legend className="sr-only">Trocar e-mail de recuperação</legend>
            <Field label="Senha atual">
              <PasswordInput
                autoComplete="current-password"
                aria-describedby="portal-recovery-password-note"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Novo e-mail"><Input type="email" autoComplete="email" placeholder="nome@empresa.com.br" value={newRecoveryEmail} onChange={(e) => setNewRecoveryEmail(e.target.value)} /></Field>
              <Field label="Confirmar novo e-mail"><Input type="email" autoComplete="email" placeholder="repita o e-mail" value={confirmRecoveryEmail} onChange={(e) => setConfirmRecoveryEmail(e.target.value)} /></Field>
            </div>
          </fieldset>
          <p id="portal-recovery-password-note" className="m-0 text-sm text-[var(--app-muted)]">
            O e-mail atual continua valendo até o novo ser confirmado pelo link que enviaremos. Errar a senha conta como tentativa de login.
          </p>
          {recoveryError ? <InlineError message={recoveryError} /> : null}
          <ProfileSaveBar>
            <Button disabled={readOnly || !recoveryReady} loading={emailSubmitting} loadingLabel="Enviando..." type="submit" title={readOnly ? READ_ONLY_TITLE : undefined}>Trocar e-mail de recuperação</Button>
          </ProfileSaveBar>
        </form>
      </Block>
    </div>
  )
}
