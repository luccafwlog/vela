/* eslint-disable react-refresh/only-export-components */
import type { ReactNode } from 'react'
import { deriveAgencyReportDeadlineState, formatAgencyReportInstant, type AgencyReportDeadlineState } from '../../services/agencyReportDeadline'
import { AGENCY_REPORT_DEPARTMENT_LABELS, filterDepartmentReopeningEvents, type AgencyReportDepartmentSignoffEvent } from '../../services/agencyDepartureReport'
import type { AgencyReportDepartmentKey, AgencyReportDepartmentSignoff } from '../../types/database'
import { formatDate } from '../../lib/utils'

const DEPARTMENT_ORDER = Object.keys(AGENCY_REPORT_DEPARTMENT_LABELS) as AgencyReportDepartmentKey[]

const STATE_LABELS: Record<AgencyReportDeadlineState, string> = {
  'no-deadline': 'Sem prazo',
  'on-time': 'No prazo',
  overdue: 'Atrasado',
}

// Cores do prazo (ADR 0039): "sem prazo" é deliberadamente neutro — não é
// vermelho de alerta nem verde de cumprido, é a ausência do compromisso
// (aguardando saída do navio ou escala omitida).
const STATE_BADGE_CLASS: Record<AgencyReportDeadlineState, string> = {
  'no-deadline': 'border-[var(--app-border)] text-[var(--app-muted)]',
  'on-time': 'border-[var(--app-green)] text-[var(--app-green)]',
  overdue: 'border-[var(--app-red)] text-[var(--app-red)]',
}

export type DepartmentTimelineReopening = {
  changedAt: string | null
  changedByName: string | null
  justification: string | null
}

export type DepartmentTimelineRow = {
  department: AgencyReportDepartmentKey
  label: string
  state: AgencyReportDeadlineState
  signedAt: string | null
  signedByName: string | null
  reopenings: DepartmentTimelineReopening[]
}

/**
 * Mapeia as assinaturas departamentais + os eventos de audit_logs para as
 * linhas da Linha do Tempo do ADR (ADR 0039). Pura e testável sem montar o
 * componente: usa deriveAgencyReportDeadlineState (Task 1) para o veredito de
 * cada departamento e filtra as reaberturas (new_value='false') das
 * (re)assinaturas simples (new_value='true', sem justificativa).
 */
export function buildDepartmentTimelineRows({
  atd,
  omitted,
  now,
  departmentSignoffs,
  departmentEvents,
  actorNames,
}: {
  atd: string | null
  omitted: boolean
  now: string | Date
  departmentSignoffs: AgencyReportDepartmentSignoff[]
  departmentEvents: AgencyReportDepartmentSignoffEvent[]
  actorNames: Record<string, string>
}): DepartmentTimelineRow[] {
  const signoffByDepartment = new Map(departmentSignoffs.map((row) => [row.department, row]))

  return DEPARTMENT_ORDER.map((department) => {
    const signoff = signoffByDepartment.get(department)
    const signedAt = signoff?.signed_at ?? null
    const state = deriveAgencyReportDeadlineState({ atd, omitted, signedAt, now })

    const reopenings = filterDepartmentReopeningEvents(departmentEvents, department)
      .map((event): DepartmentTimelineReopening => ({
        changedAt: event.changed_at,
        changedByName: (event.changed_by && actorNames[event.changed_by]) ?? event.changed_by,
        justification: event.justification,
      }))

    return {
      department,
      label: AGENCY_REPORT_DEPARTMENT_LABELS[department],
      state,
      signedAt,
      signedByName: (signoff?.signed_by && actorNames[signoff.signed_by]) ?? signoff?.signed_by ?? null,
      reopenings,
    }
  })
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }).format(date)
}

function StateBadge({ state }: { state: AgencyReportDeadlineState }) {
  return (
    <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${STATE_BADGE_CLASS[state]}`}>
      {STATE_LABELS[state]}
    </span>
  )
}

function Milestone({ title, badge, children }: { title: string; badge?: ReactNode; children?: ReactNode }) {
  return (
    <div className="grid min-w-0 gap-1 border-t border-[var(--app-border)] pt-3 first:border-t-0 first:pt-0 md:border-l md:border-t-0 md:pl-3 md:pt-0 md:first:border-l-0 md:first:pl-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-semibold text-[var(--app-text)]">{title}</span>
        {badge}
      </div>
      {children}
    </div>
  )
}

const ATD_SOURCE_LABELS: Record<'pod' | 'pol' | 'terminal', string> = {
  pod: 'POD',
  pol: 'POL',
  terminal: 'Atracação',
}

export function AgencyReportTimeline({
  atd,
  atdSource,
  atdRegisteredAt,
  deadline,
  omitted,
  now,
  departmentSignoffs,
  departmentEvents,
  actorNames,
  closedAt,
  closedByName,
}: {
  atd: string | null
  atdSource: 'pod' | 'pol' | 'terminal' | null
  atdRegisteredAt: string | null
  /** Data do prazo (YYYY-MM-DD), já calculada pela chamadora com calculateAgencyReportDeadlineDate. */
  deadline: string | null
  omitted: boolean
  now: string | Date
  departmentSignoffs: AgencyReportDepartmentSignoff[]
  departmentEvents: AgencyReportDepartmentSignoffEvent[]
  actorNames: Record<string, string>
  closedAt: string | null
  closedByName: string | null
}) {
  const departmentRows = buildDepartmentTimelineRows({ atd, omitted, now, departmentSignoffs, departmentEvents, actorNames })

  return (
    <section className="app-panel app-panel--padded grid gap-4">
      <h3 className="app-panel__title text-base">Linha do tempo do ADR</h3>

      <div className="grid gap-4 md:grid-cols-6">
        <Milestone title="Saída do navio (ATD)">
          {atd ? (
            <p className="text-sm text-[var(--app-text)]">
              {formatDate(atd)}
              {atdRegisteredAt ? (
                <span className="text-[var(--app-muted)]"> · registrado em {formatDateTime(atdRegisteredAt) ?? '—'}{atdSource ? ` (${ATD_SOURCE_LABELS[atdSource]})` : ''}</span>
              ) : null}
            </p>
          ) : (
            <p className="text-sm text-[var(--app-muted)]">Aguardando a saída do navio.</p>
          )}
        </Milestone>

        <Milestone title="Prazo de Conclusão do ADR">
          {omitted ? (
            <p className="text-sm text-[var(--app-muted)]">Escala omitida — fora da medição.</p>
          ) : deadline ? (
            <p className="text-sm text-[var(--app-text)]">{deadline.length > 10 ? `Vence em ${formatAgencyReportInstant(deadline)} (72 horas após o ATD).` : `Vence em ${formatDate(deadline)} (3 dias úteis após o ATD).`}</p>
          ) : (
            <p className="text-sm text-[var(--app-muted)]">Aguardando a saída do navio.</p>
          )}
        </Milestone>

        {departmentRows.map((row) => (
          <Milestone key={row.department} title={`Assinatura — ${row.label}`} badge={<StateBadge state={row.state} />}>
            {row.signedAt ? (
              <p className="text-sm text-[var(--app-text)]">
                Assinado em {formatDateTime(row.signedAt) ?? formatDate(row.signedAt)} por {row.signedByName ?? '—'}
              </p>
            ) : (
              <p className="text-sm text-[var(--app-muted)]">Ainda não assinado.</p>
            )}
            {row.reopenings.length ? (
              <div className="grid gap-1">
                {row.reopenings.map((reopening, index) => (
                  <p key={`${row.department}-reopen-${index}`} className="text-xs text-[var(--app-muted)]">
                    Reaberto em {formatDateTime(reopening.changedAt) ?? '—'} por {reopening.changedByName ?? '—'}
                    {reopening.justification ? `: ${reopening.justification}` : ''}
                  </p>
                ))}
              </div>
            ) : null}
          </Milestone>
        ))}

        <Milestone title="Fechamento do ADR">
          {closedAt ? (
            <p className="text-sm text-[var(--app-text)]">
              Fechado em {formatDateTime(closedAt) ?? formatDate(closedAt)} por {closedByName ?? '—'}
            </p>
          ) : (
            <p className="text-sm text-[var(--app-muted)]">Não fechado.</p>
          )}
        </Milestone>
      </div>
    </section>
  )
}
