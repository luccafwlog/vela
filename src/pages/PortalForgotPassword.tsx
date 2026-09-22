import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '../components/ui/Button'
import { Card, InlineError } from '../components/ui/Card'
import { Field, Input } from '../components/ui/Input'
import { supabasePortal } from '../services/supabase'
import { CNPJ_INPUT_MAX_LENGTH, normalizeCnpj } from '../lib/cnpj'
import { INCOMPLETE_CNPJ_MESSAGE, isCompleteCnpjLogin } from '../lib/portalCnpjLogin'

export function PortalForgotPassword() {
  const [cnpj, setCnpj] = useState('')
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)
  const [submitting, setSubmitting] = useState(false)

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

    setSubmitting(true)

    try {
      const { data, error: resetError } = await supabasePortal.functions.invoke('portal-password-recovery', { body: { cnpj } })
      if (resetError) throw resetError
      if (data?.rate_limited === true) setError('Muitas solicitações em pouco tempo. Aguarde alguns minutos e tente novamente.')
      else setSent(true)
    } catch (err: unknown) {
      void err
      // A solicitação NÃO chegou ao servidor (rede/função fora do ar). Repetir
      // aqui a mensagem de "enviaremos um link" faria o cliente esperar por um
      // email que nunca sairia.
      setError('Não foi possível concluir a solicitação agora. Tente novamente em instantes.')
    } finally {
      setSubmitting(false)
    }
  }

  if (sent) {
    return (
      <main className="app-auth">
        <Card className="app-auth__card">
          <div className="app-auth__brand">
            <img alt="Fwlog" className="app-auth__logo app-auth__logo--on-light" src="/branding/fwlog-logo.png" />
            <div>
              <h1 className="app-auth__title">Solicitação recebida</h1>
            </div>
          </div>
          {/* A tela afirma o envio sem condicionar a "se houver conta": o texto
              condicional devolvia ao cliente o mesmo sinal de enumeração que o
              backend deixou de dar (achado 3.2). Nenhuma variação por CNPJ. */}
          <p className="text-sm text-[var(--app-muted)]">
            Enviamos um link de redefinição para o email cadastrado na conta. O link vale por 1 hora.
          </p>
          <p className="mt-2 text-sm text-[var(--app-muted)]">
            Não recebeu em alguns minutos? Confira a caixa de spam ou fale com seu contato comercial na Fwlog.
          </p>
          <div className="mt-4 text-center">
            <Link to="/portal/login" className="text-sm text-[var(--app-link)] hover:underline">
              Voltar para o login
            </Link>
          </div>
        </Card>
      </main>
    )
  }

  return (
    <main className="app-auth">
      <Card className="app-auth__card">
        <div className="app-auth__brand">
          <img alt="Fwlog" className="app-auth__logo app-auth__logo--on-light" src="/branding/fwlog-logo.png" />
          <div>
            <h1 className="app-auth__title">Recuperar senha</h1>
            <p className="app-auth__subtitle">Informe seu CNPJ cadastrado para receber o link de redefinição.</p>
          </div>
        </div>

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

          {error ? <InlineError message={error} /> : null}

          <Button loading={submitting} type="submit">
            Enviar link de recuperação
          </Button>
        </form>

        <div className="mt-3 text-center text-sm">
          <Link to="/portal/login" className="text-[var(--app-link)] hover:underline">
            Voltar para o login
          </Link>
        </div>

        <p className="app-auth__meta">
          O link será enviado para o email cadastrado na sua conta de portal.
          <br />
          Problemas? Solicite um novo acesso ao seu contato comercial na Transhipping.
        </p>
      </Card>
    </main>
  )
}
