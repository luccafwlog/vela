import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Button } from '../components/ui/Button'
import { Card, InlineError } from '../components/ui/Card'
import { useConfirm } from '../components/ui/ConfirmDialog'
import { Field } from '../components/ui/Input'
import { PasswordInput } from '../components/auth/PasswordInput'
import { PortalAccessHelp } from '../components/auth/PortalAccessHelp'
import { supabasePortal } from '../services/supabase'
import { portalErrorMessage } from '../lib/portalErrorMessage'
import { PASSWORD_RULE_MESSAGE, isValidPassword } from '../lib/passwordPolicy'

const INVALID_LINK_MESSAGE = 'Link de recuperação inválido ou expirado.'

export function PortalResetPassword() {
  const confirmAction = useConfirm()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [token] = useState(() => searchParams.get('token'))
  // Achado 3.3 (auditoria 2026-08-12): o token vaza para a telemetria via
  // event.request.url se permanecer na URL. Removido da barra de enderecos
  // assim que lido, mantido em estado para o submit (espelha PortalProfile).
  useEffect(() => {
    if (!searchParams.get('token')) return
    searchParams.delete('token')
    setSearchParams(searchParams, { replace: true })
  }, [searchParams, setSearchParams])
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState(() => (token ? '' : INVALID_LINK_MESSAGE))
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)

  async function handleSubmit(event: FormEvent) {
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

    const confirmed = await confirmAction({
      title: 'Redefinir senha do Portal',
      message: 'Usar a nova senha informada para sua conta do Portal?',
      confirmLabel: 'Redefinir senha',
      affected: { summary: 'Conta do Portal associada ao link de recuperação' },
      consequence: 'Altera a senha e encerra as sessões abertas. Entre novamente usando a nova senha.',
      reversibility: 'A senha pode ser redefinida outra vez pelo fluxo de recuperação do Portal.',
    })
    if (!confirmed) return

    setSubmitting(true)

    try {
      if (!token) throw new Error(INVALID_LINK_MESSAGE)
      const { error: updateError } = await supabasePortal.functions.invoke('portal-password-reset', { body: { token, password } })
      if (updateError) throw updateError
      setDone(true)
    } catch (err: unknown) {
      setError(portalErrorMessage(err, 'Falha ao redefinir senha. Tente novamente em instantes.'))
    } finally {
      setSubmitting(false)
    }
  }

  if (done) {
    return (
      <main className="app-auth">
        <Card className="app-auth__card">
          <div className="app-auth__brand">
            <img alt="Fwlog" className="app-auth__logo app-auth__logo--on-light" src="/branding/fwlog-logo.png" />
            <h1 className="app-auth__title">Senha redefinida</h1>
          </div>
          <div className="app-auth__body" role="status">
            <p>Sua senha foi alterada e as sessões anteriores foram encerradas. Entre novamente com a nova senha.</p>
          </div>
          <div className="app-auth__actions">
            <Button onClick={() => navigate('/portal/login', { replace: true })}>Ir para o login</Button>
          </div>
        </Card>
      </main>
    )
  }

  // Sem token não há o que redefinir: a tela explica e leva ao pedido de um
  // novo link, em vez de parar num erro sem saída.
  if (!token) {
    return (
      <main className="app-auth">
        <Card className="app-auth__card">
          <div className="app-auth__brand">
            <img alt="Fwlog" className="app-auth__logo app-auth__logo--on-light" src="/branding/fwlog-logo.png" />
            <h1 className="app-auth__title">Link indisponível</h1>
          </div>
          <InlineError message={error || INVALID_LINK_MESSAGE} />
          <div className="app-auth__body">
            <p>O link de redefinição vale por 1 hora e só pode ser usado uma vez. Peça um novo para continuar.</p>
          </div>
          <div className="app-auth__actions">
            <Link to="/portal/esqueci-senha" className="app-btn app-btn--primary">Solicitar novo link</Link>
            <Link to="/portal/login" className="app-auth__link">Voltar para o login</Link>
          </div>
          <PortalAccessHelp />
        </Card>
      </main>
    )
  }

  return (
    <main className="app-auth">
      <Card className="app-auth__card">
        <div className="app-auth__brand">
          <img alt="Fwlog" className="app-auth__logo app-auth__logo--on-light" src="/branding/fwlog-logo.png" />
          <div className="app-auth__form-header">
            <h1 className="app-auth__title">Redefinir senha</h1>
            <p className="app-auth__subtitle">Escolha uma nova senha para acessar o Portal.</p>
          </div>
        </div>

        <form className="grid gap-4" onSubmit={handleSubmit}>
          {/* A regra fica fora do <label> para não entrar no nome do campo. */}
          <div className="grid gap-1.5">
            <Field label="Nova senha">
              <PasswordInput
                required
                autoComplete="new-password"
                aria-describedby="portal-reset-password-rule"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </Field>
            <p id="portal-reset-password-rule" className="app-field__hint">{PASSWORD_RULE_MESSAGE}</p>
          </div>

          <Field label="Confirmar senha">
            <PasswordInput
              required
              autoComplete="new-password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
            />
          </Field>

          {error ? <InlineError message={error} /> : null}

          <Button loading={submitting} loadingLabel="Redefinindo..." type="submit">
            Redefinir senha
          </Button>
        </form>

        <PortalAccessHelp />
      </Card>
    </main>
  )
}
