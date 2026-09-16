import { useEffect, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Button } from '../components/ui/Button'
import { Card, InlineError, PageHeader } from '../components/ui/Card'
import { Field, Input } from '../components/ui/Input'
import { useToast } from '../components/ui/Toast'
import { usePortalProfile } from '../hooks/usePortalProfile'
import { usePortalScope } from '../hooks/usePortalScope'
import { portalErrorMessage } from '../lib/portalErrorMessage'
import type { PortalProfile as PortalProfileData } from '../services/portalBilling'
import { supabasePortal } from '../services/supabase'
import { PortalContactConfiguration } from '../components/portal/PortalContactConfiguration'
import { isPortalReadOnly } from '../services/portalScope'

export const RECOVERY_EMAIL_RATE_LIMIT_MESSAGE =
  'Muitas tentativas com a senha atual. Este limite é o mesmo do login do Portal, então aguarde alguns minutos antes de tentar de novo — aqui e no login.'

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
      <PageHeader title="Meu perfil" description="Atualize seus dados de contato e endereco." />

      <Card className="max-w-xl p-5">
        {profile.data ? (
          <PortalProfileForm
            profile={profile.data}
            updateProfile={profile.updateProfile.mutateAsync}
            loadError={loadError}
            loadFailed={profile.isError}
            readOnly={readOnly}
          />
        ) : (
          <div className="grid gap-4">
            {loadError ? <InlineError message={loadError} /> : <div className="text-sm text-[var(--app-muted)]">Carregando perfil...</div>}
            <div className="flex justify-end">
              <Button disabled type="button">Salvar alteracoes</Button>
            </div>
          </div>
        )}
      </Card>
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

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError('')
    if (readOnly) return
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
    event.preventDefault(); setError('')
    if (newRecoveryEmail.trim().toLowerCase() !== confirmRecoveryEmail.trim().toLowerCase()) { setError('Os emails de recuperação não conferem.'); return }
    if (readOnly) return
    setEmailSubmitting(true)
    try {
      const { error: invokeError } = await supabasePortal.functions.invoke('portal-recovery-email-change', { body: { action: 'request', current_password: currentPassword, new_email: newRecoveryEmail.trim() } })
      if ((invokeError as { context?: { status?: number } } | null)?.context?.status === 429) { setError(RECOVERY_EMAIL_RATE_LIMIT_MESSAGE); return }
      if (invokeError) throw invokeError
      showToast('Enviamos um link para confirmar o novo email.', 'success')
      setCurrentPassword(''); setNewRecoveryEmail(''); setConfirmRecoveryEmail('')
    } catch (err) { setError(portalErrorMessage(err, 'Não foi possível iniciar a troca de email.')) } finally { setEmailSubmitting(false) }
  }

  return (
    <>
      <form className="grid gap-4" onSubmit={handleSubmit}>
        <h2 className="text-lg font-semibold text-[var(--app-text-strong)]">Dados cadastrais</h2>
        <Field label="Endereço">
          <Input
            type="text"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Rua, numero, complemento"
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Cidade">
            <Input type="text" value={city} onChange={(e) => setCity(e.target.value)} placeholder="Sao Paulo" />
          </Field>
          <Field label="Estado">
            <Input type="text" value={state} onChange={(e) => setState(e.target.value)} placeholder="SP" maxLength={2} />
          </Field>
          <Field label="CEP">
            <Input type="text" value={zip} onChange={(e) => setZip(e.target.value)} placeholder="01000-000" />
          </Field>
        </div>

        {loadError || error ? <InlineError message={error || loadError} /> : null}

        <div className="flex justify-end">
          <Button disabled={readOnly || loadFailed} loading={submitting} type="submit" title={readOnly ? 'Ação do cliente — indisponível em Modo Inspeção' : undefined}>Salvar alterações</Button>
        </div>
      </form>

      <PortalContactConfiguration readOnly={readOnly} />
        <div className="mt-8 border-t border-[var(--app-border)] pt-5">
          <h2 className="text-lg font-semibold">Email de Recuperação</h2>
          <p className="mt-1 text-sm text-[var(--app-muted)]">O endereço atual permanece válido até a confirmação do novo.</p>
          <form className="mt-4 grid gap-4" onSubmit={handleRecoveryEmailChange}>
            <Field label="Senha atual"><Input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} /></Field>
            <p className="-mt-2 text-xs text-[var(--app-muted)]">Errar a senha aqui consome as mesmas tentativas do login do Portal.</p>
            <Field label="Novo email"><Input type="email" value={newRecoveryEmail} onChange={(e) => setNewRecoveryEmail(e.target.value)} /></Field>
            <Field label="Confirmar novo email"><Input type="email" value={confirmRecoveryEmail} onChange={(e) => setConfirmRecoveryEmail(e.target.value)} /></Field>
            <div className="flex justify-end"><Button disabled={readOnly} loading={emailSubmitting} type="submit" title={readOnly ? 'Ação do cliente — indisponível em Modo Inspeção' : undefined}>Solicitar troca de email</Button></div>
          </form>
        </div>
    </>
  )
}
