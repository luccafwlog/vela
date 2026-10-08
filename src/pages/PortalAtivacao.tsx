import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Button } from '../components/ui/Button'
import { Card, InlineError } from '../components/ui/Card'
import { Field } from '../components/ui/Input'
import { PasswordInput } from '../components/auth/PasswordInput'
import { PortalAccessHelp } from '../components/auth/PortalAccessHelp'
import { supabasePortal } from '../services/supabase'
import { PASSWORD_RULE_MESSAGE, isValidPassword } from '../lib/passwordPolicy'

const invalid = 'Link inválido ou expirado. Solicite um novo convite à empresa.'

export function PortalAtivacao() {
  const [params, setParams] = useSearchParams()
  const [token] = useState(() => params.get('token') ?? '')
  const [company, setCompany] = useState<{ company_name: string; cnpj_masked: string } | null>(null)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState(token ? '' : invalid)
  const [done, setDone] = useState(false)
  const [loading, setLoading] = useState(Boolean(token))
  const [submitting, setSubmitting] = useState(false)
  // Erro de validação fica no campo que precisa mudar, não no fim do formulário.
  const [fieldError, setFieldError] = useState<{ field: 'password' | 'confirm'; message: string } | null>(null)
  const passwordRef = useRef<HTMLInputElement>(null)
  const confirmRef = useRef<HTMLInputElement>(null)

  // Achado 3.3 (auditoria 2026-08-12): o token vaza para a telemetria via
  // event.request.url se permanecer na URL. Removido da barra de enderecos
  // assim que lido, mantido em estado para o submit (espelha PortalProfile).
  useEffect(() => {
    if (!params.get('token')) return
    params.delete('token')
    setParams(params, { replace: true })
  }, [params, setParams])

  useEffect(() => {
    if (!token) return
    void supabasePortal.functions.invoke('portal-invite-activate', { body: { action: 'inspect', token } }).then(({ data, error: invokeError }) => {
      if (invokeError || !data?.company_name) setError(invalid)
      else setCompany(data as { company_name: string; cnpj_masked: string })
      setLoading(false)
    })
  }, [token])

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError('')
    setFieldError(null)
    if (!isValidPassword(password)) {
      setFieldError({ field: 'password', message: PASSWORD_RULE_MESSAGE })
      passwordRef.current?.focus()
      return
    }
    if (password !== confirm) {
      setFieldError({ field: 'confirm', message: 'As senhas não conferem.' })
      confirmRef.current?.focus()
      return
    }
    setSubmitting(true)
    try {
      const { error: invokeError } = await supabasePortal.functions.invoke('portal-invite-activate', { body: { action: 'activate', token, password } })
      if (invokeError) throw invokeError
      setDone(true)
    } catch {
      setError('Não foi possível ativar o acesso. Solicite um novo convite.')
    } finally {
      setSubmitting(false)
    }
  }

  const title = done ? 'Acesso ativado' : company || loading ? 'Ativar acesso ao Portal' : 'Convite indisponível'

  return (
    <main className="app-auth">
      <Card className="app-auth__card">
        <div className="app-auth__brand">
          <img alt="Fwlog" className="app-auth__logo app-auth__logo--on-light" src="/branding/fwlog-logo.png" />
          <h1 className="app-auth__title">{title}</h1>
        </div>

        {loading ? (
          <p className="app-auth__body" role="status">Verificando convite…</p>
        ) : done ? (
          <>
            <div className="app-auth__body" role="status">
              <p>Você já pode entrar com o CNPJ da empresa e a senha criada.</p>
            </div>
            <div className="app-auth__actions">
              <Link className="app-btn app-btn--primary" to="/portal/login">Ir para o login</Link>
            </div>
          </>
        ) : company ? (
          <>
            {/* Confirma para quem é o acesso antes de criar a senha. */}
            <dl className="app-auth__identity">
              <div>
                <dt>Empresa</dt>
                <dd>{company.company_name}</dd>
              </div>
              <div>
                <dt>CNPJ</dt>
                <dd>{company.cnpj_masked}</dd>
              </div>
            </dl>
            <form className="grid gap-4" onSubmit={submit}>
              <Field
                label="Nova senha"
                hint={fieldError?.field === 'password' ? undefined : PASSWORD_RULE_MESSAGE}
                error={fieldError?.field === 'password' ? fieldError.message : undefined}
              >
                <PasswordInput
                  ref={passwordRef}
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </Field>
              <Field label="Confirmar senha" error={fieldError?.field === 'confirm' ? fieldError.message : undefined}>
                <PasswordInput ref={confirmRef} autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
              </Field>
              {error ? <InlineError message={error} /> : null}
              <Button loading={submitting} loadingLabel="Ativando..." type="submit">Ativar acesso</Button>
            </form>
          </>
        ) : (
          <>
            <InlineError message={error || invalid} />
            <div className="app-auth__body">
              <p>O convite vale por 48 horas e só pode ser usado uma vez. Um convite reenviado invalida os anteriores.</p>
            </div>
            <div className="app-auth__actions">
              <Link className="app-auth__link" to="/portal/login">Ir para o login</Link>
            </div>
          </>
        )}

        <PortalAccessHelp />
      </Card>
    </main>
  )
}
