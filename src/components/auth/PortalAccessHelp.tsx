/**
 * Ajuda única das telas públicas do Portal (login, recuperação, redefinição,
 * ativação e confirmação de email). Antes cada tela indicava um caminho
 * diferente; o texto não varia por CNPJ para não revelar se a conta existe.
 */
export function PortalAccessHelp() {
  return (
    <p className="app-auth__meta">
      O acesso ao Portal é provisionado pela FWLOG. Problemas para entrar?{' '}
      <a href="mailto:suporte@fwlog.com.br" className="app-auth__link">Fale com o suporte</a>.
    </p>
  )
}
