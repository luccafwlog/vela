import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Button } from '../components/ui/Button'
import { Card, InlineError } from '../components/ui/Card'
import { Field, Input } from '../components/ui/Input'
import { TurnstileChallenge } from '../components/security/TurnstileChallenge'
import { supabasePortal } from '../services/supabase'
import { PASSWORD_RULE_MESSAGE, isValidPassword } from '../lib/passwordPolicy'
import { isPortalTurnstileRejection, PORTAL_TURNSTILE_REJECTION_MESSAGE } from '../lib/portalTurnstileError'

const invalid = 'Link inválido ou expirado. Solicite um novo convite à empresa.'
const verificationRequired = 'Complete a verificação de segurança para continuar.'

export function PortalAtivacao() {
  const [params, setParams] = useSearchParams()
  const [token] = useState(() => params.get('token') ?? '')
  const [company, setCompany] = useState<{ company_name: string; cnpj_masked: string } | null>(null)
  const companyLoaded = useRef(false)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState(token ? '' : invalid)
  const [captchaError, setCaptchaError] = useState('')
  const [captchaToken, setCaptchaToken] = useState('')
  const [captchaResetKey, setCaptchaResetKey] = useState(0)
  const [done, setDone] = useState(false)
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const handleCaptchaToken = useCallback((value: string) => setCaptchaToken(value), [])
  const handleCaptchaError = useCallback((message: string) => setCaptchaError(message), [])

  // O token do convite sai da URL assim que é lido, para que não seja coletado
  // por telemetria/Referer; ele permanece somente no estado desta tela.
  useEffect(() => {
    if (!params.get('token')) return
    params.delete('token')
    setParams(params, { replace: true })
  }, [params, setParams])

  useEffect(() => {
    if (!token || !captchaToken || companyLoaded.current) return
    let active = true
    const oneTimeToken = captchaToken
    setLoading(true)
    setError('')
    void supabasePortal.functions.invoke('portal-invite-activate', {
      body: { action: 'inspect', token, turnstile_token: oneTimeToken },
    }).then(({ data, error: invokeError }) => {
      if (!active) return
      if (isPortalTurnstileRejection(invokeError)) setError(PORTAL_TURNSTILE_REJECTION_MESSAGE)
      else if (invokeError || !data?.company_name) setError(invalid)
      else {
        companyLoaded.current = true
        setCompany(data as { company_name: string; cnpj_masked: string })
      }
    }).catch(() => {
      if (active) setError('Não foi possível verificar o convite. Tente novamente.')
    }).finally(() => {
      if (!active) return
      setLoading(false)
      setCaptchaToken('')
      setCaptchaResetKey((current) => current + 1)
    })
    return () => { active = false }
  }, [token, captchaToken])

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError('')
    if (!isValidPassword(password)) {
      setError(PASSWORD_RULE_MESSAGE)
      return
    }
    if (password !== confirm) {
      setError('As senhas não conferem.')
      return
    }
    if (!captchaToken) {
      setError(captchaError || verificationRequired)
      return
    }

    setSubmitting(true)
    const oneTimeToken = captchaToken
    try {
      const { error: invokeError } = await supabasePortal.functions.invoke('portal-invite-activate', {
        body: { action: 'activate', token, password, turnstile_token: oneTimeToken },
      })
      if (invokeError) throw invokeError
      setDone(true)
    } catch (invokeError: unknown) {
      setError(isPortalTurnstileRejection(invokeError)
        ? PORTAL_TURNSTILE_REJECTION_MESSAGE
        : 'Não foi possível ativar o acesso. Solicite um novo convite.')
    } finally {
      setCaptchaToken('')
      setCaptchaResetKey((current) => current + 1)
      setSubmitting(false)
    }
  }

  return (
    <main className="app-auth">
      <Card className="app-auth__card">
        <h1 className="app-auth__title">Ativar acesso ao Portal</h1>
        {loading ? <p>Verificando convite…</p> : done ? (
          <>
            <p className="mt-4">Acesso ativado. Você já pode entrar com seu CNPJ e a senha criada.</p>
            <Link className="mt-4 inline-block text-[var(--app-link)]" to="/portal/login">Ir para o login</Link>
          </>
        ) : company ? (
          <>
            <p className="mt-4">Empresa: <strong>{company.company_name}</strong></p>
            <p className="text-sm text-[var(--app-muted)]">CNPJ: {company.cnpj_masked}</p>
            <form className="mt-4 grid gap-4" onSubmit={submit}>
              <Field label="Nova senha" hint={PASSWORD_RULE_MESSAGE}>
                <Input type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} />
              </Field>
              <Field label="Confirmar senha">
                <Input type="password" autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} />
              </Field>
              {error ? <InlineError message={error} /> : null}
              <Button loading={submitting} type="submit">Ativar acesso</Button>
            </form>
          </>
        ) : token && !error ? (
          <>
            <p className="mt-4 text-sm text-[var(--app-muted)]">Confirme a verificação de segurança para consultar o convite.</p>
          </>
        ) : <InlineError message={error || invalid} />}
        {!done && token && (company || !error) ? (
          <div className="mt-4 grid gap-2">
            <TurnstileChallenge action="portal_activation" resetKey={captchaResetKey} onToken={handleCaptchaToken} onError={handleCaptchaError} />
            {captchaError ? <InlineError message={captchaError} /> : null}
          </div>
        ) : null}
      </Card>
    </main>
  )
}
