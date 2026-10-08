// Cartão de métrica/KPI padrão do app (estilo "app-metric-tile"): rótulo em
// caixa normal + valor em destaque, fundo neutro, legível em tema claro e escuro.
// Unifica as 7 cópias que existiam por página. Use no máximo quatro por tela e
// só para números que levam a uma decisão; os demais vão para a SummaryStrip.
// Com `onSelect`, o card vira o botão que aplica o filtro correspondente.
export function MetricCard({
  label,
  value,
  tone = 'secondary',
  onSelect,
  selected = false,
}: {
  label: string
  value: string | number
  tone?: 'primary' | 'secondary'
  onSelect?: () => void
  /** Filtro do card aplicado no momento. */
  selected?: boolean
}) {
  const className = `app-metric-tile ${tone === 'primary' ? 'app-metric-tile--primary' : ''}`
  const content = (
    <>
      <span className="app-metric-tile__label">{label}</span>
      <span className="app-metric-tile__value">{value}</span>
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
