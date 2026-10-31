import { useMemo } from 'react'
import { MetricCard } from '../ui/MetricCard'
import { ALERT_DEPARTMENT_LABELS, type AlertDepartmentSummary } from '../../services/alerts'

const KNOWN_ALERT_DEPARTMENTS = ['documentacao', 'equipamentos', 'operacoes', 'administrativo'] as const

type DepartmentCard = { department: string; label: string; activeCount: number; detail?: string }

/**
 * Um cartão por setor, inclusive o Administrativo, responsável por parte do
 * catálogo de alertas (lote 5a, achado A1). "Sem setor" (alertas anteriores à
 * divisão por setor) só aparece quando tem alerta. A dispensa saiu na
 * migration 476 (ADR 0108): o cartão não conta dispensados.
 */
function buildDepartmentCards(summary: AlertDepartmentSummary[] | undefined): DepartmentCard[] {
  const byDept = new Map<string, AlertDepartmentSummary>()
  if (Array.isArray(summary)) for (const item of summary) byDept.set(item.department, item)
  const count = (dept: string) => Number(byDept.get(dept)?.active_count ?? 0)
  const cards: DepartmentCard[] = KNOWN_ALERT_DEPARTMENTS.map((dept) => ({
    department: dept,
    label: ALERT_DEPARTMENT_LABELS[dept] ?? dept,
    activeCount: count(dept),
  }))
  if (count('sem_departamento') > 0) {
    cards.push({ department: 'sem_departamento', label: 'Sem setor', activeCount: count('sem_departamento'), detail: 'anteriores aos setores' })
  }
  return cards
}

/**
 * Cartões de alertas por setor. No Painel levam à fila filtrada (sem
 * `selected`); na fila de Alertas aplicam o filtro de setor ali mesmo.
 */
export function AlertDepartmentCards({
  summary,
  onSelect,
  selectedDepartment,
}: {
  summary: AlertDepartmentSummary[] | undefined
  onSelect: (department: string) => void
  /** Setor filtrado no momento; omita quando o card só navega. */
  selectedDepartment?: string
}) {
  const cards = useMemo(() => buildDepartmentCards(summary), [summary])
  return (
    <div className="app-metric-row" role="group" aria-label="Alertas por setor">
      {cards.map((card) => (
        <MetricCard
          key={card.department}
          label={card.label}
          value={card.activeCount === 0 ? 'Nenhum' : `${card.activeCount} ${card.activeCount === 1 ? 'alerta' : 'alertas'}`}
          tone={card.activeCount > 0 ? 'warning' : 'secondary'}
          detail={card.detail}
          onSelect={() => onSelect(card.department)}
          selected={selectedDepartment === undefined ? undefined : selectedDepartment === card.department}
        />
      ))}
    </div>
  )
}
