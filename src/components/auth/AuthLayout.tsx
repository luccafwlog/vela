import type { ReactNode } from 'react'

/**
 * Tela de acesso (lote 6a da identidade): painel da marca em azul-marinho e
 * formulário ao lado; abaixo de 680 px a marca vira uma faixa no topo. O Vela
 * mostra o veleiro e o nome "Vela"; o Portal, a logo branca da Fwlog sobre o
 * azul-marinho da marca (`data-app="portal"` troca o token `--app-navy`).
 */
export function AuthLayout({
  brand,
  title,
  subtitle,
  children,
}: {
  brand: 'vela' | 'portal'
  title: string
  subtitle?: ReactNode
  children: ReactNode
}) {
  return (
    <main className="app-auth">
      <div className="app-auth__panel">
        <div className="app-auth__branding">
          {brand === 'vela' ? (
            <div className="app-auth__logo-lockup">
              <img alt="" className="app-auth__logo app-auth__logo--vela" src="/branding/vela-mark-dark.svg" />
              <span className="app-auth__logo-name">Vela</span>
            </div>
          ) : (
            <img alt="Fwlog" className="app-auth__logo app-auth__logo--fwlog" src="/branding/fwlog-logo-white.png" />
          )}
          <div className="app-auth__branding-copy">
            {brand === 'vela' ? <p className="app-auth__branding-label">Sistema operacional</p> : null}
            <p className="app-auth__branding-desc">
              {brand === 'vela'
                ? 'Viagens, B/Ls, Taxas Locais, Demurrage e conciliação em um só lugar.'
                : 'Faturas, B/Ls e containers da sua empresa.'}
            </p>
          </div>
        </div>

        <div className="app-auth__form-wrap">
          <div className="app-auth__form-header">
            <h1 className="app-auth__title">{title}</h1>
            {subtitle ? <p className="app-auth__subtitle">{subtitle}</p> : null}
          </div>
          {children}
        </div>
      </div>
    </main>
  )
}

/**
 * Link vencido, convite indisponível: o motivo e a explicação num aviso só
 * (lote 6a), em vez do aviso vermelho seguido de um parágrafo sobre o mesmo
 * assunto.
 */
export function AuthNotice({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="app-auth__notice" role="alert">
      <p className="app-auth__notice-title">{title}</p>
      {children ? <p className="app-auth__notice-text">{children}</p> : null}
    </div>
  )
}
