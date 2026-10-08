import { Card } from './Card'

type PreviewBoxProps = {
  label: string
  value: number | string
  decimals?: number
  variant?: 'metric' | 'metric-centered' | 'surface' | 'kpi'
  tone?: 'navy' | 'blue' | 'green' | 'gold'
}

export function PreviewBox({ label, value, decimals, variant = 'metric', tone = 'navy' }: PreviewBoxProps) {
  const displayValue = typeof value === 'number'
    ? value.toLocaleString('pt-BR', decimals === undefined ? undefined : {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      })
    : value

  if (variant === 'surface') {
    return (
      <div className="rounded-lg border border-[var(--app-border)] bg-[var(--app-surface-muted)] p-3">
        <div className="text-xs font-medium text-[var(--app-muted)]">{label}</div>
        <div className="mt-1 text-xl font-semibold tabular-nums text-[var(--app-text-strong)]">{displayValue}</div>
      </div>
    )
  }

  if (variant === 'kpi') {
    return (
      <Card className={`app-kpi-card app-kpi-card--${tone}`}>
        <div className="app-kpi-card__label">{label}</div>
        <div className={`app-kpi-card__value app-kpi-card__value--${tone}`}>{displayValue}</div>
      </Card>
    )
  }

  return (
    <div className={`app-metric-tile${variant === 'metric-centered' ? ' text-center' : ''}`}>
      <div className="app-metric-tile__label">{label}</div>
      <div className="app-metric-tile__value">{displayValue}</div>
    </div>
  )
}
