import { useCallback, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '../components/ui/Button'
import { InlineError } from '../components/ui/Card'
import { AuthLayout } from '../components/auth/AuthLayout'
import { Field, Input } from '../components/ui/Input'
import { supabasePortal } from '../services/supabase'
import { CNPJ_INPUT_MAX_LENGTH, normalizeCnpj } from '../lib/cnpj'
import { INCOMPLETE_CNPJ_MESSAGE, isCompleteCnpjLogin } from '../lib/portalCnpjLogin'
import { TurnstileChallenge } from '../components/security/TurnstileChallenge'
import { PortalAccessHelp } from '../components/auth/PortalAccessHelp'
import { isPortalTurnstileRejection, PORTAL_TURNSTILE_REJECTION_MESSAGE } from '../lib/portalTurnstileError'

export function PortalForgotPassword() {
  const [cnpj, setCnpj] = useState('')
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [turnstileToken, setTurnstileToken] = useState('')
  const [turnstileError, setTurnstileError] = useState('')
  const [turnstileResetKey, setTurnstileResetKey] = useState(0)
  const handleTurnstileToken = useCallback((token: string) => setTurnstileToken(token), [])
  const handleTurnstileError = useCallback((message: string) => setTurnstileError(message), [])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError('')

    // Formato do CNPJ é verificável sem consultar o servidor, então avisar aqui
    // não revela nada sobre a base — e evita a tela de "solicitação recebida"
    // para quem simplesmente digitou o CNPJ pela metade e nunca receberia email.
    if (!isCompleteCnpjLogin(cnpj)) {
      setError(INCOMPLETE_CNPJ_MESSAGE)
      return
    }

    const hasSiteKey = Boolean(String(import.meta.env.VITE_TURNSTILE_SITE_KEY ?? '').trim())
    if (hasSiteKey && !turnstileToken) {
      setError(turnstileError || 'Complete a verificação de segurança antes de continuar.')
      return
    }

    setSubmitting(true)

    try {
      const payload: Record<string, unknown> = { cnpj }
      if (turnstileToken) payload.turnstile_token = turnstileToken
      const { data, error: resetError } = await supabasePortal.functions.invoke('portal-password-recovery', {
        body: payload,
      })
      if (resetError) throw resetError
      if (data?.rate_limited === true) setError('Muitas solicitações em pouco tempo. Aguarde alguns minutos e tente novamente.')
      else setSent(true)
    } catch (err: unknown) {
      if (isPortalTurnstileRejection(err)) {
        setError(PORTAL_TURNSTILE_REJECTION_MESSAGE)
        return
      }
      // A solicitação NÃO chegou ao servidor (rede/função fora do ar). Repetir
      // aqui a mensagem de "enviaremos um link" faria o cliente esperar por um
      // email que nunca sairia.
      setError('Não foi possível concluir a solicitação agora. Tente novamente em instantes.')
    } finally {
      setTurnstileToken('')
      setTurnstileResetKey((current) => current + 1)
      setSubmitting(false)
    }
  }

  if (sent) {
    return (
      <AuthLayout brand="portal" title="Link enviado">
        {/* A tela afirma o envio sem condicionar a "se houver conta": o texto
            condicional devolvia ao cliente o mesmo sinal de enumeração que o
            backend deixou de dar (achado 3.2). Nenhuma variação por CNPJ. */}
        <div className="app-auth__body" role="status">
          <p>Enviamos um link de redefinição para o e-mail cadastrado na conta. O link vale por 1 hora.</p>
          <p className="app-auth__subtitle">Não recebeu em alguns minutos? Confira a caixa de spam ou peça de novo.</p>
        </div>
        <div className="app-auth__actions app-auth__actions--stack">
          <Link to="/portal/login" className="app-btn app-btn--primary">Voltar para o login</Link>
          <Button variant="secondary" onClick={() => setSent(false)}>Pedir outro link</Button>
        </div>
        <PortalAccessHelp />
      </AuthLayout>
    )
  }

  return (
    <AuthLayout
      brand="portal"
      title="Recuperar senha"
      subtitle="Informe o CNPJ da conta. Enviaremos o link de redefinição para o e-mail cadastrado."
    >
      <form className="grid gap-4" onSubmit={handleSubmit}>
        <Field label="CNPJ">
          <Input
            required
            type="text"
            inputMode="text"
            autoComplete="username"
            autoFocus
            maxLength={CNPJ_INPUT_MAX_LENGTH}
            value={cnpj}
            onChange={(event) => setCnpj(normalizeCnpj(event.target.value))}
            placeholder="00.000.000/0000-00"
          />
        </Field>
        <TurnstileChallenge
          action="portal_recovery"
          resetKey={turnstileResetKey}
          onToken={handleTurnstileToken}
          onError={handleTurnstileError}
        />
        {error ? <InlineError message={error} /> : null}
        <Button loading={submitting} loadingLabel="Enviando..." type="submit">
          Enviar link de recuperação
        </Button>
        <Link to="/portal/login" className="app-btn app-btn--secondary">
          Voltar para o login
        </Link>
      </form>
      <PortalAccessHelp />
    </AuthLayout>
  )
}
