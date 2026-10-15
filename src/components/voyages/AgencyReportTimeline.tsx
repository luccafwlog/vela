/* eslint-disable react-refresh/only-export-components */
import { deriveAgencyReportDeadlineState, formatAgencyReportInstant, type AgencyReportDeadlineState } from '../../services/agencyReportDeadline'
import { AGENCY_REPORT_DEPARTMENT_LABELS, filterDepartmentReopeningEvents, type AgencyReportDepartmentSignoffEvent } from '../../services/agencyDepartureReport'
import type { AgencyReportDepartmentKey, AgencyReportDepartmentSignoff } from '../../types/database'
import { formatDate } from '../../lib/utils'
import { Block, Fact, FactList } from '../ui/Block'
import { NoValue } from '../ui/NoValue'
import { StatusText } from '../ui/StatusText'

const DEPARTMENT_ORDER = Object.keys(AGENCY_REPORT_DEPARTMENT_LABELS) as AgencyReportDepartmentKey[]

const STATE_LABELS: Record<AgencyReportDeadlineState, string> = {
  'no-deadline': 'Sem prazo',
  'on-time': 'No prazo',
  overdue: 'Atrasado',
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
 * Situação de cada departamento no painel da Linha do Tempo (ADR 0039):
 * veredito de prazo pela assinatura vigente e reaberturas (new_value='false').
 */
export function buildDepartmentTimelineRows({
  atd,
  frozenDeadlineDate = null,
  omitted,
  now,
  departmentSignoffs,
  departmentEvents,
  actorNames,
}: {
  atd: string | null
  /** ADR fechado antes da regra de 72 h: a data congelada no Fechamento (YYYY-MM-DD). */
  frozenDeadlineDate?: string | null
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
    const state = deriveAgencyReportDeadlineState({ atd, omitted, signedAt, now, frozenDeadlineDate })

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

export type AdrHistoryRow = {
  key: string
  label: string
  at: string
  by: string | null
  deadline: AgencyReportDeadlineState | null
  detail: string | null
}

const ATD_SOURCE_LABELS: Record<'pod' | 'pol' | 'terminal', string> = {
  pod: 'POD',
  pol: 'POL',
  terminal: 'Atracação',
}

/**
 * Registro do ADR: só o que já aconteceu, em ordem — ATD, cada assinatura
 * (com o veredito de prazo daquele momento), cada reabertura com a
 * justificativa e o fechamento. Assinatura sem trilha em audit_logs (anterior
 * à migration 223) entra pela linha vigente do sign-off.
 */
export function buildAdrHistoryRows({
  atd,
  frozenDeadlineDate = null,
  atdSource,
  atdRegisteredAt,
  omitted,
  departmentSignoffs,
  departmentEvents,
  actorNames,
  closedAt,
  closedByName,
}: {
  atd: string | null
  /** ADR fechado antes da regra de 72 h: a data congelada no Fechamento (YYYY-MM-DD). */
  frozenDeadlineDate?: string | null
  atdSource: 'pod' | 'pol' | 'terminal' | null
  atdRegisteredAt: string | null
  omitted: boolean
  departmentSignoffs: AgencyReportDepartmentSignoff[]
  departmentEvents: AgencyReportDepartmentSignoffEvent[]
  actorNames: Record<string, string>
  closedAt: string | null
  closedByName: string | null
}): AdrHistoryRow[] {
  const nameOf = (id: string | null | undefined) => (id ? actorNames[id] ?? id : null)
  const rows: AdrHistoryRow[] = []
  if (atd) {
    rows.push({
      key: 'atd',
      label: 'Saída do navio (ATD)',
      at: atd,
      by: null,
      deadline: null,
      detail: atdRegisteredAt
        ? `registrado em ${formatInstant(atdRegisteredAt)}${atdSource ? ` (${ATD_SOURCE_LABELS[atdSource]})` : ''}`
        : null,
    })
  }
  for (const event of departmentEvents) {
    if (!event.changed_at) continue
    const label = AGENCY_REPORT_DEPARTMENT_LABELS[event.department] ?? event.department
    const reopening = event.new_value === 'false'
    rows.push({
      key: `event-${event.id}`,
      label: `${reopening ? 'Reabertura' : 'Assinatura'} · ${label}`,
      at: event.changed_at,
      by: nameOf(event.changed_by),
      deadline: reopening ? null : deriveAgencyReportDeadlineState({ atd, omitted, signedAt: event.changed_at, now: event.changed_at, frozenDeadlineDate }),
      detail: reopening ? event.justification : null,
    })
  }
  for (const signoff of departmentSignoffs) {
    if (!signoff.signed_at) continue
    const tracked = departmentEvents.some((event) => event.department === signoff.department && event.new_value === 'true')
    if (tracked) continue
    rows.push({
      key: `signoff-${signoff.department}`,
      label: `Assinatura · ${AGENCY_REPORT_DEPARTMENT_LABELS[signoff.department]}`,
      at: signoff.signed_at,
      by: nameOf(signoff.signed_by),
      deadline: deriveAgencyReportDeadlineState({ atd, omitted, signedAt: signoff.signed_at, now: signoff.signed_at, frozenDeadlineDate }),
      detail: null,
    })
  }
  if (closedAt) rows.push({ key: 'closed', label: 'Fechamento do ADR', at: closedAt, by: closedByName, deadline: null, detail: null })
  return rows.sort((left, right) => Date.parse(left.at) - Date.parse(right.at))
}

function formatInstant(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? formatDate(value) : formatAgencyReportInstant(value)
}

function DeadlineText({ state }: { state: AgencyReportDeadlineState }) {
  return <StatusText tone={state === 'overdue' ? 'warning' : state === 'no-deadline' ? 'muted' : 'default'}>{STATE_LABELS[state]}</StatusText>
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
  /** Instante do prazo (ATD + 72 h) ou, em ADR fechado antes da regra, a data congelada (YYYY-MM-DD). */
  deadline: string | null
  omitted: boolean
  now: string | Date
  departmentSignoffs: AgencyReportDepartmentSignoff[]
  departmentEvents: AgencyReportDepartmentSignoffEvent[]
  actorNames: Record<string, string>
  closedAt: string | null
  closedByName: string | null
}) {
  // Só a data (YYYY-MM-DD) é prazo congelado da regra de dias úteis: os
  // vereditos seguem o prazo que valia no Fechamento, como em /admin/prazo-adr.
  const frozenDeadlineDate = deadline && /^\d{4}-\d{2}-\d{2}$/.test(deadline) ? deadline : null
  const departmentRows = buildDepartmentTimelineRows({ atd, frozenDeadlineDate, omitted, now, departmentSignoffs, departmentEvents, actorNames })
  const history = buildAdrHistoryRows({ atd, frozenDeadlineDate, atdSource, atdRegisteredAt, omitted, departmentSignoffs, departmentEvents, actorNames, closedAt, closedByName })
  const signedCount = departmentRows.filter((row) => row.signedAt).length
  const deadlineText = deadline ? formatInstant(deadline) : null

  return (
    <Block
      title="Linha do tempo do ADR"
      aside={`${signedCount} de ${departmentRows.length} departamentos assinados${deadlineText && !omitted ? ` · prazo ${deadlineText}` : ''}`}
    >
      <div className="grid gap-4">
        <FactList columns={3}>
          <Fact label="Saída do navio (ATD)">
            {atd ? formatInstant(atd) : <NoValue label="Aguardando a saída do navio" />}
          </Fact>
          <Fact
            label="Prazo de conclusão"
            detail={omitted ? null : deadline ? (deadline.length > 10 ? '72 horas após o ATD' : '3 dias úteis após o ATD') : null}
          >
            {omitted ? 'Escala omitida — fora da medição' : deadlineText ?? <NoValue label="Aguardando a saída do navio" />}
          </Fact>
          <Fact label="Fechamento">{closedAt ? formatInstant(closedAt) : 'Não fechado'}</Fact>
          {departmentRows.map((row) => (
            <Fact key={row.department} label={row.label} detail={<DeadlineText state={row.state} />}>
              {row.signedAt ? 'Assinado' : <StatusText tone="warning">Aguarda assinatura</StatusText>}
            </Fact>
          ))}
        </FactList>

        {history.length ? (
          <div className="app-table-scroll">
            <table className="app-table app-table--compact">
              <caption className="sr-only">Registro do ADR</caption>
              <thead>
                <tr>
                  <th scope="col" className="app-table__text-head">Registro</th>
                  <th scope="col">Quando</th>
                  <th scope="col">Por</th>
                  <th scope="col">Prazo</th>
                  <th scope="col" className="app-table__text-head">Detalhe</th>
                </tr>
              </thead>
              <tbody>
                {history.map((row) => (
                  <tr key={row.key}>
                    <td className="app-table__text whitespace-nowrap">{row.label}</td>
                    <td className="whitespace-nowrap tabular-nums"><time dateTime={row.at}>{formatInstant(row.at)}</time></td>
                    <td className="whitespace-nowrap">{row.by ?? <NoValue label="Sem autor" />}</td>
                    <td className="whitespace-nowrap">{row.deadline ? <DeadlineText state={row.deadline} /> : <NoValue label="Não se aplica" />}</td>
                    <td className="app-table__text app-table__text--wrap">{row.detail ?? <NoValue label="Sem detalhe" />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </Block>
  )
}
