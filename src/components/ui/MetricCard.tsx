import type { ReactNode } from 'react'
import { ArrowRight, Filter } from 'lucide-react'
// Cartão de métrica/KPI padrão do app (estilo "app-metric-tile"): rótulo em
// caixa normal + valor em destaque, legível em tema claro e escuro.
// Unifica as 7 cópias que existiam por página. Use no máximo quatro por tela e
// só para números que levam a uma decisão; os demais vão para a SummaryStrip.
//
// Cartão que age tem cara de botão em repouso (decisão do dono de 2026-11-01):
// com `onSelect` e `selected`, aplica o filtro (aria-pressed) e mostra
// "Filtrar"; com `onSelect` sem `selected`, leva a outra tela e mostra "Abrir".
// Sem `onSelect` o cartão é liso, sem borda de ação nem hover, e não aceita
// tom: âmbar e azul só onde o clique resolve (regra 5).
type MetricCardBase = {
  label: string
  /** Número ou texto; para ausência, `<NoValue />`. */
  value: ReactNode
  /** Linha curta de apoio sob o valor. */
  detail?: ReactNode
}

type MetricCardProps = MetricCardBase & (
  | {
      onSelect: () => void
      /** Filtro do card aplicado no momento; omita no card que só navega. */
      selected?: boolean
      /** `warning` só quando o número pede ação e é maior que zero (regra 5). */
      tone?: 'primary' | 'secondary' | 'warning'
    }
  | { onSelect?: undefined; selected?: undefined; tone?: 'secondary' }
)

export function MetricCard({ label, value, tone = 'secondary', detail, onSelect, selected }: MetricCardProps) {
  const toneClass = tone === 'secondary' ? '' : ` app-metric-tile--${tone}`
  const content = (
    <>
      <span className="app-metric-tile__label">{label}</span>
      <span className="app-metric-tile__value">{value}</span>
      {detail ? <span className="app-metric-tile__detail">{detail}</span> : null}
    </>
  )
  if (onSelect) {
    const filters = selected !== undefined
    return (
      <button type="button" className={`app-metric-tile app-metric-tile--action${toneClass}`} aria-pressed={selected} onClick={onSelect}>
        {content}
        <span className="app-metric-tile__cue" aria-hidden="true">
          {filters ? <Filter size={12} /> : <ArrowRight size={12} />}
          {filters ? (selected ? 'Filtrando' : 'Filtrar') : 'Abrir'}
        </span>
      </button>
    )
  }
  return <div className={`app-metric-tile app-metric-tile--static${toneClass}`}>{content}</div>
}
