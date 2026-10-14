import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'

/**
 * A única próxima ação da tela (ADR 0081, regras 3 e 5): faixa própria logo
 * abaixo da identidade, com o motivo em texto e o botão que leva a resolver
 * à direita. Sem pendência, a tela não mostra a faixa.
 */
export function NextAction({
  children,
  action,
  tone = 'danger',
  label = 'Próxima ação',
}: {
  children: ReactNode
  action?: ReactNode
  tone?: 'danger' | 'warning' | 'info'
  label?: string
}) {
  return (
    <section className={cn('app-next-action', `app-next-action--${tone}`)} aria-label={label}>
      <strong className="app-next-action__label">{label}</strong>
      <p className="app-next-action__text">{children}</p>
      {action ? <div className="app-next-action__action">{action}</div> : null}
    </section>
  )
}
