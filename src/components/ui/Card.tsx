import type { LucideIcon } from 'lucide-react'
import { AlertCircle, Inbox } from 'lucide-react'
import { cn } from '../../lib/utils'

export function Card({ className, children, title }: { className?: string; children: React.ReactNode; title?: string }) {
  const hasPaddingOverride = /\bp(?:[trblxy])?-[^\s]+/.test(className ?? '')

  return (
    <section className={cn('app-surface', !hasPaddingOverride && 'app-surface--padded', className)} title={title}>
      {children}
    </section>
  )
}

export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
}: {
  icon?: LucideIcon
  title: string
  description?: string
  action?: React.ReactNode
}) {
  return (
    <div className="app-empty-state">
      <div className="app-empty-state__icon">
        <Icon size={34} strokeWidth={1.7} />
      </div>
      <p className="app-empty-state__title">{title}</p>
      {description ? <p className="app-empty-state__description">{description}</p> : null}
      {action ? <div className="app-empty-state__action">{action}</div> : null}
    </div>
  )
}

export function InlineError({ message }: { message: string }) {
  return (
    <div className="app-inline-error" role="alert">
      <AlertCircle size={15} className="shrink-0" aria-hidden="true" />
      {message}
    </div>
  )
}

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string
  description?: string
  action?: React.ReactNode
}) {
  return (
    <div className="page-header">
      <div className="page-header__copy">
        <h1 className="page-header__title">{title}</h1>
        {description ? <p className="page-header__description">{description}</p> : null}
      </div>
      {action ? <div className="page-header__actions">{action}</div> : null}
    </div>
  )
}
