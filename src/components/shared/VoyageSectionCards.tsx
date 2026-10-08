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
          <div className="app-voyage-section__title">{title}</div>
          <div className="mt-1 text-sm text-[var(--app-muted)]">{description}</div>
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
  // Uma superfície por nível: a seção é separada por filete e título, não por
  // outro card dentro da ficha. `compact` só reduz o respiro.
  return (
    <section className={`app-voyage-section${compact ? ' app-voyage-section--compact' : ''}`}>
      <div className="app-voyage-section__head">
        <div>
          <h3 className="app-voyage-section__title">{title}</h3>
          {description ? <p className="app-voyage-section__description">{description}</p> : null}
        </div>
        {actions ? <div className="app-voyage-section__actions">{actions}</div> : null}
      </div>
      {children}
    </section>
  )
}
