// Agregado de SLA do Prazo de Conclusão do ADR (Task 5 do ADR 0039):
// uma linha por (viagem, porto) de ADR fechado, com o ATD, a assinatura de
// cada departamento, dias úteis até cada uma, cumpriu/não cumpriu, e o tempo
// total decorrido até o Fechamento. Vive em /admin/prazo-do-adr (dado de
// visibilidade de equipe, não financeiro/de cliente) porque o cumprimento é
// atributo do DEPARTAMENTO, nunca da pessoa (ADR 0039: "O cumprimento é
// atributo do departamento, nunca da pessoa" — ranking por usuário foi
// rejeitado como alternativa).
//
// Vigência: um ADR fechado ANTES desta feature existir carrega um
// closed_snapshot sem header.unifiedAtd/header.deadlineDate (Tasks 3/4
// nasceram na mesma release). "snapshot tem esses campos" é o sinal de
// vigência usado aqui — evita depender de agency_report_pending_baselines,
// que é server-only (REVOKE ALL ... FROM PUBLIC, anon, authenticated) e não é
// legível do cliente.
//
// Escala omitida: um ADR fechado pode existir para uma escala omitida (ver
// VoyageAgencyReportTab.tsx, badge "Omitida"). O snapshot congelado não carrega
// uma flag `omitted` explícita — em vez de assumir que ausência de ATD já
// cobre o caso (ver nota em excludeOmittedRows), este módulo confere o status
// `omitted` vigente via listVoyageEscalaSchedulesByVoyageIds (mesma função
// batch que a projeção de escalas já usa), a fonte de verdade viva.

import { supabase } from './supabase'
import { brasiliaDayBounds } from '../lib/dates'
import {
  hoursSinceAtd,
  deriveAgencyReportDeadlineState,
  toDateOnly,
  type AgencyReportDeadlineState,
} from './agencyReportDeadline'
import { listVoyageEscalaSchedulesByVoyageIds, type VoyageEscalaSchedule } from './voyageRouteSchedules'
import { AGENCY_REPORT_DEPARTMENT_LABELS } from './agencyDepartureReport'
import type { AgencyReportDepartmentKey } from '../types/database'

const DEPARTMENT_ORDER = Object.keys(AGENCY_REPORT_DEPARTMENT_LABELS) as AgencyReportDepartmentKey[]

// Shape mínimo lido de closed_snapshot — só os campos congelados pelo Task 4
// (VoyageAgencyReportTab.tsx) que este agregado precisa. Campos ausentes
// (snapshot legado) tornam a linha inelegível, ver mapClosedReportToSlaRow.
export type ClosedAgencyReportSnapshotForSla = {
  header?: {
    unifiedAtd?: string | null
    deadlineDate?: string | null
    /** Instante do prazo (ATD + 72 h); só nos ADRs fechados desde 2026-10-15. */
    deadlineAt?: string | null
  } | null
  departmentSignoffs?: Array<{
    department: AgencyReportDepartmentKey
    signed_by?: string | null
    signed_at?: string | null
  }> | null
}

export type ClosedAgencyReportListItem = {
  voyage_id: number
  port: string
  terminal: string | null
  closed_at: string | null
  closed_by: string | null
  closed_snapshot: ClosedAgencyReportSnapshotForSla | null
  voyage: { voyage_number: string | null; vessel: { name: string | null } | null } | null
}

export type AgencyReportSlaDateRange = {
  /** closed_at >= from (YYYY-MM-DD, inclusive). */
  from?: string
  /** closed_at <= to (YYYY-MM-DD, inclusive). */
  to?: string
}

/**
 * Lista ADRs fechados de todas as viagens, com o snapshot congelado no
 * Fechamento. Sem escopo por viagem — primeira consulta cross-voyage deste
 * módulo. RLS de agency_departure_reports só checa is_active_read_user()
 * (sem escopo por viagem), então um .select() simples já traz tudo que um
 * usuário ativo pode ver.
 */
export async function listClosedAgencyReports(range?: AgencyReportSlaDateRange): Promise<ClosedAgencyReportListItem[]> {
  let query = supabase
    .from('agency_departure_reports')
    .select('voyage_id, port, terminal, closed_at, closed_by, closed_snapshot, voyage:voyages(voyage_number, vessel:vessels(name))')
    .eq('status', 'closed')
    .order('closed_at', { ascending: false })

  // Dias de Brasília, não de UTC (achado R4 do lote 5b).
  if (range?.from) query = query.gte('closed_at', brasiliaDayBounds(range.from).start)
  if (range?.to) query = query.lte('closed_at', brasiliaDayBounds(range.to).end)

  const { data, error } = await query
  if (error) throw error
  return (data ?? []) as unknown as ClosedAgencyReportListItem[]
}

export type AgencyReportSlaDepartmentRow = {
  department: AgencyReportDepartmentKey
  label: string
  signedAt: string | null
  /** Horas do ATD até a assinatura; null se ainda não assinado (não deveria ocorrer em ADR fechado — ver mapClosedReportToSlaRow). */
  hoursElapsed: number | null
  state: AgencyReportDeadlineState
  /** Como a tela mostra: no prazo, atrasou (com as horas) ou não assinou (achado A6 do lote 5b). */
  outcome: 'on-time' | 'late' | 'unsigned'
  /** Horas depois do prazo, arredondadas para cima; só quando atrasou. */
  hoursLate: number | null
}

export type AgencyReportSlaRow = {
  voyageId: number
  port: string
  terminal: string | null
  voyageNumber: string | null
  vesselName: string | null
  /** ATD da escala unificada (YYYY-MM-DD), congelado no Fechamento. */
  atd: string
  /** Data do prazo (YYYY-MM-DD), congelada no Fechamento. */
  deadlineDate: string
  /** Instante do prazo (ATD + 72 h), só nos ADRs fechados desde 2026-10-15. */
  deadlineAt: string | null
  closedAt: string
  closedBy: string | null
  /** Dias corridos (calendário) do ATD até o Fechamento — rótulo explícito porque a unidade dos departamentos acima é dias úteis. */
  elapsedCalendarDaysToClosure: number | null
  departments: AgencyReportSlaDepartmentRow[]
}

/**
 * Mapeia um ADR fechado para uma linha do agregado de SLA. Retorna null
 * quando a linha deve ser excluída: snapshot legado (sem header.unifiedAtd/
 * header.deadlineDate — "antes da vigência", ver comentário do módulo) ou sem
 * closed_at (não deveria ocorrer para status='closed', defensivo).
 * Pura: não toca o banco.
 */
export function mapClosedReportToSlaRow(row: ClosedAgencyReportListItem): AgencyReportSlaRow | null {
  const header = row.closed_snapshot?.header
  const atd = header?.unifiedAtd ?? null
  const deadlineDate = header?.deadlineDate ?? null
  if (!atd || !deadlineDate) return null // snapshot legado: antes da vigência do Prazo de Conclusão do ADR.
  if (!row.closed_at) return null

  const closedDateOnly = toDateOnly(row.closed_at)
  const elapsedCalendarDaysToClosure = closedDateOnly ? countBusinessDaysToCalendarDays(atd, closedDateOnly) : null

  const signoffsByDepartment = new Map(
    (row.closed_snapshot?.departmentSignoffs ?? []).map((signoff) => [signoff.department, signoff]),
  )

  const departments: AgencyReportSlaDepartmentRow[] = DEPARTMENT_ORDER.map((department) => {
    const signoff = signoffsByDepartment.get(department)
    const signedAt = signoff?.signed_at ?? null
    // Fechado com o prazo de 72 h guarda `deadlineAt`; fechado antes guarda só
    // a data (regra de dias úteis) e é comparado por dia, como foi medido.
    const state = signedAt ? deriveAgencyReportDeadlineState({
      atd,
      omitted: false, // linhas omitidas já são excluídas antes de chegar aqui (ver excludeOmittedRows).
      signedAt,
      now: signedAt,
      frozenDeadlineDate: header?.deadlineAt ? null : deadlineDate,
    }) : 'no-deadline'
    const hoursElapsed = signedAt ? hoursSinceAtd(atd, signedAt) : null
    const outcome = !signedAt ? 'unsigned' : state === 'overdue' ? 'late' : 'on-time'

    return {
      department,
      label: AGENCY_REPORT_DEPARTMENT_LABELS[department],
      signedAt,
      hoursElapsed,
      state,
      outcome,
      hoursLate: outcome === 'late' && signedAt ? hoursAfterDeadline(header?.deadlineAt ?? null, deadlineDate, signedAt) : null,
    }
  })

  return {
    voyageId: row.voyage_id,
    port: row.port,
    terminal: row.terminal,
    voyageNumber: row.voyage?.voyage_number ?? null,
    vesselName: row.voyage?.vessel?.name ?? null,
    atd,
    deadlineDate,
    deadlineAt: header?.deadlineAt ?? null,
    closedAt: row.closed_at,
    closedBy: row.closed_by,
    elapsedCalendarDaysToClosure,
    departments,
  }
}

/**
 * Horas entre o prazo e a assinatura atrasada, para cima ("Atrasou 6 h"). O
 * ADR fechado antes da regra de 72 h guarda só a data: o prazo é o fim desse
 * dia em Brasília. ponytail: fuso fixo -03:00, sem horário de verão desde 2019.
 */
function hoursAfterDeadline(deadlineAt: string | null, deadlineDate: string, signedAt: string): number | null {
  const deadline = new Date(deadlineAt ?? `${deadlineDate}T23:59:59.999-03:00`).getTime()
  const signed = new Date(signedAt).getTime()
  if (Number.isNaN(deadline) || Number.isNaN(signed)) return null
  return Math.max(1, Math.ceil((signed - deadline) / (60 * 60 * 1000)))
}

// Dias corridos entre duas datas YYYY-MM-DD — mesma parametrização de
// countBusinessDaysBetween, mas contando todos os dias (não só úteis), para
// o "tempo total decorrido até o Fechamento" pedido pelo Task 5. Deliberado
// não reaproveitar countBusinessDaysBetween aqui: as duas contagens têm
// unidades diferentes e a rotulagem explícita (elapsedCalendarDaysToClosure)
// evita confundi-las.
function countBusinessDaysToCalendarDays(fromDateOnly: string, toDateOnlyValue: string): number | null {
  const from = new Date(`${fromDateOnly}T00:00:00.000Z`)
  const to = new Date(`${toDateOnlyValue}T00:00:00.000Z`)
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null
  const diffMs = to.getTime() - from.getTime()
  return Math.round(diffMs / (24 * 60 * 60 * 1000))
}

/**
 * Confere se a escala (voyageId, port) de uma linha já mapeada está omitida
 * no estado vigente de voyage_pod_schedule (fonte viva, via
 * listVoyageEscalaSchedulesByVoyageIds — não o snapshot congelado, que não
 * carrega essa flag). Pura sobre o mapa já buscado.
 *
 * Nota: na prática, uma escala omitida quase nunca registra um ATD real antes
 * do fechamento (o navio não atracou), então a exclusão por
 * header.unifiedAtd ausente (mapClosedReportToSlaRow) já cobriria a maioria
 * dos casos. Mas nada no schema impede as duas flags de conviverem — omitted
 * e atd são campos independentes em voyage_pod_schedule, e a UI
 * (VoyageAgencyReportTab.tsx) mantém o ADR de uma escala omitida legível
 * mesmo com dados lançados. Por isso este agregado confere `omitted`
 * explicitamente, em vez de confiar no proxy do ATD — mesma decisão que
 * detect_agency_report_deadline_missed (migration 271) já tomou no lado SQL.
 */
export function isEscalaOmitted(
  escalasByVoyage: Map<number, VoyageEscalaSchedule[]>,
  voyageId: number,
  port: string,
): boolean {
  const escalas = escalasByVoyage.get(voyageId) ?? []
  const escala = escalas.find((entry) => entry.port === port)
  // Escala não encontrada na projeção viva: não há como confirmar omissão,
  // não exclui por precaução.
  return escala?.omitted ?? false
}

/**
 * Lista o agregado de SLA completo: busca os ADRs fechados no período,
 * mapeia para linhas (excluindo snapshots legados — antes da vigência),
 * exclui escalas omitidas, e ordena por Fechamento mais recente primeiro.
 */
export async function listAgencyReportSlaRows(range?: AgencyReportSlaDateRange): Promise<AgencyReportSlaRow[]> {
  const closedReports = await listClosedAgencyReports(range)
  const mapped = closedReports
    .map(mapClosedReportToSlaRow)
    .filter((row): row is AgencyReportSlaRow => row !== null)

  if (!mapped.length) return mapped

  const voyageIds = [...new Set(mapped.map((row) => row.voyageId))]
  const escalasByVoyage = await listVoyageEscalaSchedulesByVoyageIds(voyageIds)

  return mapped.filter((row) => !isEscalaOmitted(escalasByVoyage, row.voyageId, row.port))
}

export type AgencyReportSlaDepartmentSummary = {
  department: AgencyReportDepartmentKey
  label: string
  onTime: number
  overdue: number
  /** ADRs fechados sem a assinatura do departamento: contam no total, nunca no prazo. */
  unsigned: number
  total: number
  /** Taxa de cumprimento no prazo, de 0 a 1 (ou null se total = 0). */
  rate: number | null
}

/**
 * Agrega a taxa de cumprimento por DEPARTAMENTO, nunca por usuário — soma
 * on-time/overdue de todas as linhas incluídas (linhas já filtradas por
 * vigência e escala omitida antes de chegar aqui). Pura.
 */
export function summarizeAgencyReportSlaByDepartment(rows: AgencyReportSlaRow[]): AgencyReportSlaDepartmentSummary[] {
  return DEPARTMENT_ORDER.map((department) => {
    let onTime = 0
    let overdue = 0
    let unsigned = 0
    for (const row of rows) {
      const departmentRow = row.departments.find((d) => d.department === department)
      if (!departmentRow) continue
      if (departmentRow.outcome === 'on-time') onTime += 1
      else if (departmentRow.outcome === 'late') overdue += 1
      else unsigned += 1
    }
    // "x de y no prazo": y é o número de ADRs fechados; quem não assinou não cumpriu.
    const total = onTime + overdue + unsigned
    return {
      department,
      label: AGENCY_REPORT_DEPARTMENT_LABELS[department],
      onTime,
      overdue,
      unsigned,
      total,
      rate: total > 0 ? onTime / total : null,
    }
  })
}
