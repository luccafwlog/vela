import { useState } from 'react'
import { Block } from '../ui/Block'
import { Button } from '../ui/Button'
import { Field, Input } from '../ui/Input'
import { MetricCard } from '../ui/MetricCard'
import { NoValue } from '../ui/NoValue'
import { StatusText } from '../ui/StatusText'
import { QueryStateGate } from '../shared/QueryStateGate'
import { formatBrasiliaDateTime } from './auditLogPresentation'
import { formatDate } from '../../lib/utils'
import { useAgencyReportSla } from '../../hooks/useAgencyReport'
import { AGENCY_REPORT_DEPARTMENT_LABELS } from '../../services/agencyDepartureReport'
import {
  summarizeAgencyReportSlaByDepartment,
  type AgencyReportSlaDepartmentRow,
  type AgencyReportSlaRow,
} from '../../services/agencyReportSla'

const DEPARTMENTS = ['operacoes', 'documentacao', 'equipamentos'] as const

/**
 * Prazo do ADR (lote 5b): cumprimento do prazo de assinatura por
 * departamento, nunca por pessoa (ADR 0039). A regra do prazo está em
 * docs/modules/viagens.md § Prazo de Conclusão do ADR.
 */
export function AdminAdrDeadlineTab() {
  const [range, setRange] = useState<{ from: string; to: string }>({ from: '', to: '' })
  const query = useAgencyReportSla({ from: range.from || undefined, to: range.to || undefined }, true)
  const rows = query.data ?? []
  const summary = summarizeAgencyReportSlaByDepartment(rows)
  const hasFilters = Boolean(range.from || range.to)

  return (
    <>
      <div className="app-filter-grid mb-4">
        <Field label="Fechado de">
          <Input type="date" value={range.from} onChange={(e) => setRange((current) => ({ ...current, from: e.target.value }))} />
        </Field>
        <Field label="Fechado até">
          <Input type="date" value={range.to} onChange={(e) => setRange((current) => ({ ...current, to: e.target.value }))} />
        </Field>
        {hasFilters ? (
          <div className="flex items-end"><Button variant="ghost" onClick={() => setRange({ from: '', to: '' })}>Limpar filtros</Button></div>
        ) : null}
      </div>

      {query.data ? (
        <div className="app-metric-row" role="group" aria-label="Cumprimento do prazo por departamento">
          {summary.map((entry) => (
            <MetricCard
              key={entry.department}
              label={entry.label}
              value={entry.total > 0 ? `${entry.onTime} de ${entry.total}` : <NoValue label="Sem ADR fechado no período" />}
              detail={entry.total > 0 ? `no prazo · ${Math.round((entry.rate ?? 0) * 100)}%` : 'sem ADR fechado'}
            />
          ))}
        </div>
      ) : null}

      <Block title="ADRs fechados no período" aside="Medido por departamento, nunca por pessoa" flush>
        <QueryStateGate
          isLoading={query.isLoading}
          isError={Boolean(query.error)}
          hasData={query.data !== undefined && query.data !== null}
          errorMessage="Não foi possível carregar o Prazo do ADR."
          onRetry={() => void query.refetch?.()}
          loadingLabel="Carregando ADRs fechados…"
        >
          {rows.length === 0 ? (
            <p className="px-4 py-8 text-center text-[var(--app-muted)]">Nenhum ADR fechado no período.</p>
          ) : (
            <div className="app-table-scroll">
              <table className="app-table">
                <caption className="sr-only">Prazo de assinatura de cada ADR fechado, por departamento</caption>
                <thead>
                  <tr>
                    <th scope="col" className="app-table__text-head">Navio / Viagem</th>
                    <th scope="col">Porto</th>
                    <th scope="col">Terminal</th>
                    <th scope="col">ATD</th>
                    <th scope="col">Prazo</th>
                    {DEPARTMENTS.map((department) => (
                      <th key={department} scope="col">{AGENCY_REPORT_DEPARTMENT_LABELS[department]}</th>
                    ))}
                    <th scope="col">Dias corridos do ATD ao Fechamento</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={`${row.voyageId}::${row.port}::${row.terminal ?? 'legacy'}`}>
                      <td className="app-table__text" title={vesselVoyage(row)}>{vesselVoyage(row)}</td>
                      <td>{row.port}</td>
                      <td>{row.terminal ?? <NoValue label="Sem terminal" />}</td>
                      <td className="tabular-nums whitespace-nowrap">{formatDate(row.atd)}</td>
                      <td className="tabular-nums whitespace-nowrap">{row.deadlineAt ? formatBrasiliaDateTime(row.deadlineAt) : formatDate(row.deadlineDate)}</td>
                      {DEPARTMENTS.map((department) => (
                        <td key={department} className="whitespace-nowrap">
                          <DepartmentOutcome entry={row.departments.find((entry) => entry.department === department)} />
                        </td>
                      ))}
                      <td className="tabular-nums whitespace-nowrap" title={row.closedAt ? `Fechado em ${formatBrasiliaDateTime(row.closedAt)}` : undefined}>
                        {row.elapsedCalendarDaysToClosure !== null
                          ? `${row.elapsedCalendarDaysToClosure} ${row.elapsedCalendarDaysToClosure === 1 ? 'dia' : 'dias'}`
                          : <NoValue label="Sem fechamento" />}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </QueryStateGate>
      </Block>
    </>
  )
}

function vesselVoyage(row: AgencyReportSlaRow) {
  return [row.vesselName, row.voyageNumber].filter(Boolean).join(' / ') || 'Viagem sem nome'
}

/** "No prazo", "Atrasou N h" em âmbar ou "Não assinou" em cinza (A6); a hora da assinatura fica no `title`. */
function DepartmentOutcome({ entry }: { entry: AgencyReportSlaDepartmentRow | undefined }) {
  if (!entry || entry.outcome === 'unsigned') return <StatusText tone="muted">Não assinou</StatusText>
  const signed = entry.signedAt ? `Assinou em ${formatBrasiliaDateTime(entry.signedAt)}` : undefined
  if (entry.outcome === 'late') {
    return <span title={signed}><StatusText tone="warning">{entry.hoursLate ? `Atrasou ${entry.hoursLate} h` : 'Atrasou'}</StatusText></span>
  }
  return <span title={signed}>No prazo</span>
}
