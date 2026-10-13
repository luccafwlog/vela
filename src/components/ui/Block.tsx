import { useId, type ReactNode } from 'react'
import { cn } from '../../lib/utils'

/**
 * Bloco da identidade visual (ADR 0081, regra 1 "um assunto, um bloco"):
 * superfície branca com o título numa faixa azulada. Cada grupo de
 * informação de uma tela é um Block; dois assuntos não dividem o mesmo bloco.
 * `aside` fica à direita da faixa (contagem, botão, origem do dado). Com
 * `flush`, o conteúdo encosta nas bordas (tabela dentro do bloco).
 */
export function Block({
  title,
  aside,
  children,
  flush = false,
  headingLevel = 2,
  className,
  bodyClassName,
}: {
  title: ReactNode
  aside?: ReactNode
  children: ReactNode
  flush?: boolean
  headingLevel?: 2 | 3 | 4
  className?: string
  bodyClassName?: string
}) {
  const titleId = useId()
  const Heading = `h${headingLevel}` as const
  return (
    <section className={cn('app-block', className)} aria-labelledby={titleId}>
      <header className="app-block__header">
        <Heading id={titleId} className="app-block__title">{title}</Heading>
        {aside ? <div className="app-block__aside">{aside}</div> : null}
      </header>
      <div className={cn(flush ? 'app-block__flush' : 'app-block__body', bodyClassName)}>{children}</div>
    </section>
  )
}

/**
 * Dado principal de um bloco (regra 2): maior e em negrito. `tone` só quando
 * o dado pede ação (regra 5); o texto continua dizendo o estado.
 */
export function LeadValue({
  children,
  detail,
  tone = 'default',
  className,
}: {
  children: ReactNode
  detail?: ReactNode
  tone?: 'default' | 'warning' | 'danger'
  className?: string
}) {
  return (
    <div className={cn('app-lead', className)}>
      <p className={cn('app-lead__value', tone !== 'default' && `app-lead__value--${tone}`)}>{children}</p>
      {hasContent(detail) ? <p className="app-lead__detail">{detail}</p> : null}
    </div>
  )
}

// Zero conhecido é dado (regra 4): só nulo, vazio ou false some.
function hasContent(value: ReactNode) {
  return value != null && value !== false && value !== ''
}

/** Pares rótulo/valor de apoio: rótulo cinza em cima, valor embaixo. */
export function FactList({ children, columns = 2, className }: { children: ReactNode; columns?: 1 | 2 | 3 | 4; className?: string }) {
  return <dl className={cn('app-facts', `app-facts--${columns}`, className)}>{children}</dl>
}

export function Fact({ label, children, detail }: { label: ReactNode; children: ReactNode; detail?: ReactNode }) {
  return (
    <div className="app-facts__item">
      <dt className="app-facts__label">{label}</dt>
      <dd className="app-facts__value">
        {children}
        {hasContent(detail) ? <span className="app-facts__detail">{detail}</span> : null}
      </dd>
    </div>
  )
}
