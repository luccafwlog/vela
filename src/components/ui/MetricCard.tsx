import type { ReactNode } from 'react'
// Cartão de métrica/KPI padrão do app (estilo "app-metric-tile"): rótulo em
// caixa normal + valor em destaque, fundo neutro, legível em tema claro e escuro.
// Unifica as 7 cópias que existiam por página. Use no máximo quatro por tela e
// só para números que levam a uma decisão; os demais vão para a SummaryStrip.
// Com `onSelect`, o card vira botão: com `selected`, aplica o filtro
// correspondente (aria-pressed); sem `selected`, só leva a outra tela.
export function MetricCard({
  label,
  value,
  tone = 'secondary',
  detail,
  onSelect,
  selected,
}: {
  label: string
  /** Número ou texto; para ausência, `<NoValue />`. */
  value: ReactNode
  /** `warning` só quando o número pede ação e é maior que zero (regra 5). */
  tone?: 'primary' | 'secondary' | 'warning'
  /** Linha curta de apoio sob o valor. */
  detail?: ReactNode
  onSelect?: () => void
  /** Filtro do card aplicado no momento; omita no card que só navega. */
  selected?: boolean
}) {
  const className = `app-metric-tile ${tone === 'secondary' ? '' : `app-metric-tile--${tone}`}`
  const content = (
    <>
      <span className="app-metric-tile__label">{label}</span>
      <span className="app-metric-tile__value">{value}</span>
      {detail ? <span className="app-metric-tile__detail">{detail}</span> : null}
    </>
  )
  if (onSelect) {
    return (
      <button type="button" className={className} aria-pressed={selected} onClick={onSelect}>
        {content}
      </button>
    )
  }
  return <div className={className}>{content}</div>
}
