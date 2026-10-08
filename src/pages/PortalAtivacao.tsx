import { useEffect, useState, type FormEvent } from 'react'
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
    if (!isValidPassword(password)) { setError(PASSWORD_RULE_MESSAGE); return }
    if (password !== confirm) { setError('As senhas não conferem.'); return }
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
              {/* A regra fica fora do <label> para não entrar no nome do campo. */}
              <div className="grid gap-1.5">
                <Field label="Nova senha">
                  <PasswordInput
                    autoComplete="new-password"
                    aria-describedby="portal-activation-password-rule"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </Field>
                <p id="portal-activation-password-rule" className="app-field__hint">{PASSWORD_RULE_MESSAGE}</p>
              </div>
              <Field label="Confirmar senha">
                <PasswordInput autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
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
