import type { ReactNode } from 'react'

export type IdentityFact = { label: string; value: ReactNode }

/**
 * Faixa de identidade da ficha (ADR 0081, regras 3 e 7): primeira coisa da
 * ficha, em azul-marinho, com o tipo do registro, o identificador como título
 * da página, os fatos que o situam e as ações do registro à direita.
 */
export function IdentityBand({
  kind,
  title,
  facts = [],
  actions,
}: {
  kind?: ReactNode
  title: ReactNode
  facts?: IdentityFact[]
  actions?: ReactNode
}) {
  return (
    <header className="app-identity">
      <div className="app-identity__main">
        {kind ? <p className="app-identity__kind">{kind}</p> : null}
        <h1 className="app-identity__title">{title}</h1>
        {facts.length ? (
          <dl className="app-identity__facts">
            {facts.map((fact) => (
              <div key={fact.label} className="app-identity__fact">
                <dt>{fact.label}</dt>
                <dd>{fact.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </div>
      {actions ? <div className="app-identity__actions">{actions}</div> : null}
    </header>
  )
}
