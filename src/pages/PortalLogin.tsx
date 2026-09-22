import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { Button } from '../components/ui/Button'
import { Card, InlineError } from '../components/ui/Card'
import { Field, Input } from '../components/ui/Input'
import { usePortalAuth } from '../hooks/usePortalAuth'
import { isSupabaseConfigured } from '../services/supabase'
import { normalizeCnpj } from '../lib/cnpj'
import { INCOMPLETE_CNPJ_MESSAGE, isCompleteCnpjLogin } from '../lib/portalCnpjLogin'

function isNetworkError(error: unknown): boolean {
  if (error instanceof TypeError) return true
  if (!error || typeof error !== 'object') return false
  const name = String((error as { name?: unknown }).name ?? '')
  const message = String((error as { message?: unknown }).message ?? '').toLowerCase()
  return name === 'AuthRetryableFetchError' || message.includes('failed to fetch') || message.includes('fetch failed')
}

export function PortalLogin() {
  const navigate = useNavigate()
  const { isAuthenticated, loading, signIn } = usePortalAuth()
  const [cnpj, setCnpj] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

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

    setSubmitting(true)

    try {
      await signIn(cnpj, password)
      navigate('/portal', { replace: true })
    } catch (err: unknown) {
      const code = typeof err === 'object' && err !== null ? String((err as { code?: string }).code ?? '') : ''
      if (code === 'P0429') {
        setError('Muitas tentativas de acesso. Aguarde alguns minutos antes de tentar novamente.')
      } else if (isNetworkError(err)) {
        setError('Não foi possível conectar. Verifique sua internet e tente novamente.')
      } else {
        setError('Credenciais inválidas para o portal do cliente.')
      }
    } finally {
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

        <form className="grid gap-4" onSubmit={handleSubmit}>
          <Field label="CNPJ">
            <Input
              required
              type="text"
              inputMode="text"
              autoComplete="username"
              maxLength={18}
              value={cnpj}
              onChange={(event) => setCnpj(normalizeCnpj(event.target.value))}
              onPaste={(event) => {
                event.preventDefault()
                setCnpj(normalizeCnpj(event.clipboardData.getData('text')))
              }}
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
