import type { ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { tokenizeInfoValue } from '../../lib/voyageFormat'

// Componentes apresentacionais da tela de Viagens: acordeões e métricas.

export function AccordionSection({
  title,
  description,
  open,
  onToggle,
  children,
}: {
  title: string
  description: string
  open: boolean
  onToggle: () => void
  children: ReactNode
}) {
  const contentId = `accordion-${title.toLowerCase().replace(/\s+/g, '-')}`
  return (
    <section className="app-voyage-accordion">
      <button
        type="button"
        className="app-voyage-accordion__trigger"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={contentId}
      >
        <div>
          <div className="app-voyage-section-card__title">{title}</div>
          <div className="app-voyage-section-card__description">{description}</div>
        </div>
        <ChevronDown size={18} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open ? <div id={contentId} className="app-voyage-accordion__content">{children}</div> : null}
    </section>
  )
}

export function Info({ label, value }: { label: string; value: string }) {
  const tokens = tokenizeInfoValue(value)

  return (
    <div className={tokens.length ? 'app-voyage-info app-voyage-info--tokenized' : 'app-voyage-info'}>
      <span className="app-voyage-info__label">{label}</span>
      {tokens.length ? (
        <div className="app-voyage-token-list">
          {tokens.map((token) => (
            <span key={`${label}-${token}`} className="app-voyage-token">
              {token}
            </span>
          ))}
        </div>
      ) : (
        <span className="app-voyage-info__value">{value}</span>
      )}
    </div>
  )
}

export function MetricPanel({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  return (
    <div className="app-voyage-metric-panel">
      <div className="app-voyage-metric-panel__title">{title}</div>
      <dl className="grid gap-3 text-sm text-[var(--app-text)]">{children}</dl>
    </div>
  )
}

export function MetricSection({
  title,
  description,
  children,
  actions,
  compact,
}: {
  title: string
  description?: string
  children: ReactNode
  actions?: ReactNode
  compact?: boolean
}) {
  return (
    <section className={`app-voyage-section-card${compact ? ' app-voyage-section-card--compact' : ''}`}>
      <div className={`flex flex-wrap justify-between gap-3 ${compact ? 'items-center' : 'items-start'}`}>
        <div>
          <h3 className="app-voyage-section-card__title">{title}</h3>
          {description ? <div className="app-voyage-section-card__description">{description}</div> : null}
        </div>
        {actions ? <div className="flex shrink-0 gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  )
}
