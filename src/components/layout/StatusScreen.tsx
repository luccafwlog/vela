import { useId, type ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '../../lib/utils'

/**
 * Painel de estado do shell (etapa 02): sessão carregando, acesso restrito,
 * perfil ausente, erro de tela e página não encontrada. `fullscreen` ocupa a
 * tela inteira quando não há shell em volta (guardas e erro na raiz).
 */
export function StatusScreen({
  icon: Icon,
  tone = 'neutral',
  title,
  children,
  actions,
  fullscreen = false,
  role,
}: {
  icon?: LucideIcon
  tone?: 'neutral' | 'warning' | 'danger'
  title: string
  children?: ReactNode
  actions?: ReactNode
  fullscreen?: boolean
  role?: 'alert' | 'status'
}) {
  // id único: duas telas de estado na mesma página não repetem o mesmo id.
  const titleId = useId()
  const panel = (
    <section className={cn('app-status-panel', `app-status-panel--${tone}`)} role={role} aria-labelledby={titleId}>
      {Icon ? (
        <span className="app-status-panel__icon" aria-hidden="true">
          <Icon size={20} />
        </span>
      ) : null}
      <div className="app-status-panel__body">
        <h1 id={titleId} className="app-status-panel__title">{title}</h1>
        {children ? <div className="app-status-panel__text">{children}</div> : null}
        {actions ? <div className="app-status-panel__actions">{actions}</div> : null}
      </div>
    </section>
  )
  return fullscreen ? <main className="app-auth">{panel}</main> : panel
}
