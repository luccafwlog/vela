import type { ReactNode } from 'react'
import { CopyButton } from './CopyValue'

export type IdentityFact = { label: string; value: ReactNode }

/**
 * Faixa de identidade da ficha (ADR 0081, regras 3 e 7): primeira coisa da
 * ficha, em azul-marinho, com o tipo do registro, o identificador como título
 * da página, os fatos que o situam e as ações do registro à direita.
 */
export function IdentityBand({
  kind,
  title,
  titleCopy,
  facts = [],
  actions,
}: {
  kind?: ReactNode
  title: ReactNode
  /** Ícone de copiar ao lado do título, fora do `h1` (o nome do título fica só o identificador). */
  titleCopy?: { value: string; label: string }
  facts?: IdentityFact[]
  actions?: ReactNode
}) {
  return (
    <header className="app-identity">
      <div className="app-identity__main">
        {kind ? <p className="app-identity__kind">{kind}</p> : null}
        {titleCopy ? (
          <div className="app-copy">
            <h1 className="app-identity__title">{title}</h1>
            <CopyButton value={titleCopy.value} label={titleCopy.label} />
          </div>
        ) : (
          <h1 className="app-identity__title">{title}</h1>
        )}
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
