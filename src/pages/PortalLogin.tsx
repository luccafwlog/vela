import { useCallback, useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { Button } from '../components/ui/Button'
import { Card, InlineError } from '../components/ui/Card'
import { Field, Input } from '../components/ui/Input'
import { usePortalAuth } from '../hooks/usePortalAuth'
import { isSupabaseConfigured } from '../services/supabase'
import { CNPJ_INPUT_MAX_LENGTH, normalizeCnpj } from '../lib/cnpj'
import { INCOMPLETE_CNPJ_MESSAGE, isCompleteCnpjLogin } from '../lib/portalCnpjLogin'
import { TurnstileChallenge } from '../components/security/TurnstileChallenge'
import { PORTAL_TURNSTILE_REJECTION_MESSAGE } from '../lib/portalTurnstileError'

function isNetworkError(error: unknown): boolean {
  if (error instanceof TypeError) return true
  if (!error || typeof error !== 'object') return false
  const name = String((error as { name?: unknown }).name ?? '')
  const message = String((error as { message?: unknown }).message ?? '').toLowerCase()
  return name === 'AuthRetryableFetchError' || message.includes('failed to fetch') || message.includes('fetch failed')
}

const SIGNOUT_NOTICE = 'Sua sessão foi encerrada neste dispositivo. A revogação no servidor não pôde ser confirmada devido a instabilidade de rede.'

export function PortalLogin() {
  const navigate = useNavigate()
  const { isAuthenticated, loading, signIn, signOutError } = usePortalAuth()
  const [cnpj, setCnpj] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [turnstileToken, setTurnstileToken] = useState('')
  const [turnstileError, setTurnstileError] = useState('')
  const [turnstileResetKey, setTurnstileResetKey] = useState(0)
  // Derivado do estado vivo do provider: o redirecionamento para esta tela
  // acontece antes do timeout da revogação remota, então um valor congelado na
  // montagem nunca veria a falha.
  const notice = signOutError ? SIGNOUT_NOTICE : ''
  const handleTurnstileToken = useCallback((token: string) => setTurnstileToken(token), [])
  const handleTurnstileError = useCallback((message: string) => setTurnstileError(message), [])

  if (!loading && isAuthenticated) {
    return <Navigate to="/portal" replace />
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError('')

    // CNPJ incompleto é erro de digitação, não credencial errada: dizer isso
    // não revela nada (o formato se confere offline) e poupa uma tentativa
    // contra o rate limit de login.
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
      await signIn(cnpj, password, turnstileToken || undefined)
      navigate('/portal', { replace: true })
    } catch (err: unknown) {
      const code = typeof err === 'object' && err !== null ? String((err as { code?: string }).code ?? '') : ''
      if (code === 'TURNSTILE_REJECTED') {
        setError(PORTAL_TURNSTILE_REJECTION_MESSAGE)
      } else if (code === 'P0429') {
        setError('Muitas tentativas de acesso. Aguarde alguns minutos antes de tentar novamente.')
      } else if (isNetworkError(err)) {
        setError('Não foi possível conectar. Verifique sua internet e tente novamente.')
      } else {
        setError('Credenciais inválidas para o portal do cliente.')
      }
    } finally {
      setTurnstileToken('')
      setTurnstileResetKey((current) => current + 1)
      setSubmitting(false)
    }
  }

  return (
    <main className="app-auth">
      <Card className="app-auth__card">
        <div className="app-auth__brand">
          <img
            alt="Fwlog"
            className="app-auth__logo app-auth__logo--on-light"
            src="/branding/fwlog-logo.png"
            onError={(event) => {
              event.currentTarget.onerror = null
              event.currentTarget.src = '/branding/fwlog-logo.png'
            }}
          />
          <div>
            <h1 className="app-auth__title">Portal do cliente</h1>
            <p className="app-auth__subtitle">Consulte faturas emitidas e consolide B/Ls prontos para faturamento.</p>
          </div>
        </div>

        {!isSupabaseConfigured ? (
          <div className="app-callout app-callout--warning">
            Configure VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no .env antes de autenticar.
          </div>
        ) : null}

        {notice ? (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
            {notice}
          </div>
        ) : null}

        <form className="grid gap-4" onSubmit={handleSubmit}>
          <Field label="CNPJ">
            <Input
              required
              type="text"
              inputMode="text"
              autoComplete="username"
              maxLength={CNPJ_INPUT_MAX_LENGTH}
              value={cnpj}
              onChange={(event) => setCnpj(normalizeCnpj(event.target.value))}
              placeholder="00.000.000/0000-00"
            />
          </Field>

          <Field label="Senha">
            <Input
              required
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </Field>

          <TurnstileChallenge
            action="portal_login"
            resetKey={turnstileResetKey}
            onToken={handleTurnstileToken}
            onError={handleTurnstileError}
          />

          {error ? <InlineError message={error} /> : null}

          <Button loading={submitting} type="submit">
            Entrar no portal
          </Button>
        </form>

        <div className="mt-3 text-center text-sm">
          <Link to="/portal/esqueci-senha" className="text-[var(--app-link)] hover:underline">
            Esqueci minha senha
          </Link>
        </div>

        <p className="app-auth__meta">
          Acesso provisionado internamente por cliente. Não há cadastro público.
          <br />
          Problemas para acessar? Solicite um novo acesso ao seu contato comercial na Transhipping.
        </p>
      </Card>
    </main>
  )
}
