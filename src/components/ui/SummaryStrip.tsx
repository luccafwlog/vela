import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'

export type SummaryItem = {
  label: string
  value: ReactNode
  /** Destaca um número que pede ação (por exemplo vencidos). */
  tone?: 'default' | 'warning' | 'danger'
}

/**
 * Faixa de resumo de uma linha para a barra da tabela: "12 B/Ls · 16 CNTRs ·
 * 1.069,1 m³". Substitui cards de métrica que não levam a uma decisão; os
 * cards ficam para até quatro números que aplicam filtro.
 */
export function SummaryStrip({ items, label = 'Resumo', className }: { items: SummaryItem[]; label?: string; className?: string }) {
  if (!items.length) return null
  return (
    <dl className={cn('app-summary-strip', className)} aria-label={label}>
      {items.map((item) => (
        <div key={item.label} className={cn('app-summary-strip__item', item.tone && item.tone !== 'default' && `app-summary-strip__item--${item.tone}`)}>
          <dt className="app-summary-strip__label">{item.label}</dt>
          <dd className="app-summary-strip__value">{item.value}</dd>
        </div>
      ))}
    </dl>
  )
}
