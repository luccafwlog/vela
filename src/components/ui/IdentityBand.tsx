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
  titleAside,
  facts = [],
  actions,
  headingLevel = 1,
}: {
  kind?: ReactNode
  title: ReactNode
  /** Ícone de copiar ao lado do título, fora do `h1` (o nome do título fica só o identificador). */
  titleCopy?: { value: string; label: string }
  /** Situação ao lado do título (selo da viagem), fora do `h*`. */
  titleAside?: ReactNode
  facts?: IdentityFact[]
  actions?: ReactNode
  /** Nível do título; 2 quando a página já tem o seu `h1` (ficha da Viagem dentro de Viagens). */
  headingLevel?: 1 | 2
}) {
  const Heading = `h${headingLevel}` as const
  return (
    <header className="app-identity">
      <div className="app-identity__main">
        {kind ? <p className="app-identity__kind">{kind}</p> : null}
        {titleCopy ? (
          <div className="app-copy">
            <Heading className="app-identity__title">{title}</Heading>
            <CopyButton value={titleCopy.value} label={titleCopy.label} />
            {titleAside}
          </div>
        ) : titleAside ? (
          <div className="app-identity__title-row">
            <Heading className="app-identity__title">{title}</Heading>
            {titleAside}
          </div>
        ) : (
          <Heading className="app-identity__title">{title}</Heading>
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
