import { useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { Button } from '../components/ui/Button'
import { InlineError } from '../components/ui/Card'
import { Field, Input } from '../components/ui/Input'
import { PasswordInput } from '../components/auth/PasswordInput'
import { isSupabaseConfigured } from '../services/supabase'
import { useAuth } from '../hooks/useAuth'

// Distingue falha de transporte/rede (backend indisponível) de credencial inválida.
// O signInWithPassword do Supabase lança AuthApiError (status HTTP) para credencial
// errada e TypeError/AuthRetryableFetchError quando o fetch nem completa.
function isTransportError(err: unknown): boolean {
  if (err instanceof TypeError) return true
  const candidate = err as { name?: string; status?: number } | null
  if (candidate?.name === 'AuthRetryableFetchError') return true
  if (typeof candidate?.status === 'number' && candidate.status === 0) return true
  return false
}

export function Login() {
  const navigate = useNavigate()
  const { user, loading, signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  if (!loading && user) {
    return <Navigate to="/painel" replace />
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError('')

    if (!isSupabaseConfigured) {
      setError('Configure VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no .env antes de autenticar.')
      return
    }

    setSubmitting(true)

    try {
      await signIn(email, password)
      navigate('/painel', { replace: true })
    } catch (err) {
      setError(
        isTransportError(err)
          ? 'Serviço de autenticação indisponível no momento. Verifique a conexão e tente novamente.'
          : 'Credenciais inválidas ou usuário sem permissão ativa.',
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="app-auth">
      <div className="app-auth__panel">
        <div className="app-auth__branding">
          <div className="app-auth__logo-lockup">
            <img alt="" className="app-auth__logo app-auth__logo--vela" src="/branding/vela-mark-dark.svg" />
            <span className="app-auth__logo-name">Vela</span>
          </div>
          <div className="app-auth__branding-copy">
            <p className="app-auth__branding-label">Sistema operacional</p>
            <p className="app-auth__branding-desc">Viagens, B/Ls, Taxas Locais, Demurrage e conciliação em um só lugar.</p>
          </div>
        </div>

        <div className="app-auth__form-wrap">
          <div className="app-auth__form-header">
            <h1 className="app-auth__title">Acesso interno</h1>
            <p className="app-auth__subtitle">Entre com o e-mail e a senha provisionados pelo Administrativo.</p>
          </div>

          {!isSupabaseConfigured ? (
            <div className="app-callout app-callout--warning">
              Configure VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no .env antes de autenticar.
            </div>
          ) : null}

          <form className="grid gap-4" onSubmit={handleSubmit}>
            <Field label="E-mail">
              <Input
                required
                type="email"
                autoComplete="username"
                autoFocus
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </Field>

            <Field label="Senha">
              <PasswordInput
                required
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </Field>

            {error ? <InlineError message={error} /> : null}

            <Button disabled={!isSupabaseConfigured} loading={submitting} loadingLabel="Entrando..." type="submit">
              Entrar
            </Button>
          </form>

          <p className="app-auth__meta">Esqueceu a senha ou perdeu o acesso? Peça a redefinição ao Administrativo.</p>
        </div>
      </div>
    </main>
  )
}
