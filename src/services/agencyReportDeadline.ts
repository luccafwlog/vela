import { saoPauloTodayIso } from '../lib/dates'

// Regra de prazo do ADR (Agency Departure Report) por departamento.
//
// Desde 2026-10-15 (decisão do responsável; nota na ADR 0039): prazo = ATD +
// 72 horas corridas, a partir da hora do ATD (sábado, domingo e feriado
// contam). ATD gravado só com a data (registro antigo) vale como 00:00 de
// Brasília. ADR fechado antes da regra congelou só a data do prazo
// (`header.deadlineDate`, regra antiga de 3 dias úteis): para ele a
// comparação continua por dia (`frozenDeadlineDate`).
// Ver docs/adr/0039-prazo-de-conclusao-do-adr-medido-por-departamento.md.

export const AGENCY_REPORT_DEADLINE_HOURS = 72
const HOUR_MS = 60 * 60 * 1000

/** Estado de prazo por departamento, derivado do ATD e da assinatura vigente. */
export type AgencyReportDeadlineState = 'no-deadline' | 'on-time' | 'overdue'

export type AgencyReportDeadlineInput = {
  /** ATD da escala: instante ISO (com hora) ou, em registro antigo, YYYY-MM-DD. */
  atd: string | null
  /** Escala omitida pelo armador: excluida da medicao permanentemente. */
  omitted: boolean
  /** Timestamp ISO da assinatura vigente do departamento, ou null se nao assinado. */
  signedAt: string | null
  /** Instante de referencia ("agora"), injetado para manter a funcao pura/testavel. */
  now: string | Date
  /** ADR fechado antes das 72 h: a data do prazo congelada (regra de dias úteis), comparada por dia. */
  frozenDeadlineDate?: string | null
}

/** Instante do ATD; data sem hora vale 00:00 de Brasília. */
export function agencyReportAtdInstant(atd: string): Date | null {
  // Só ISO: '08/03/2026' não significa o mesmo em pt-BR e en-US.
  if (!/^\d{4}-\d{2}-\d{2}/.test(atd)) return null
  const dateOnly = atd.match(DATE_ONLY_PATTERN)
  const parsed = new Date(dateOnly ? `${dateOnly[0]}T00:00:00-03:00` : atd)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

/** Instante do prazo de conclusão (ISO): ATD + 72 horas. */
export function calculateAgencyReportDeadlineAt(atd: string): string | null {
  const start = agencyReportAtdInstant(atd)
  return start ? new Date(start.getTime() + AGENCY_REPORT_DEADLINE_HOURS * HOUR_MS).toISOString() : null
}

/** "16/10/2026 18:40", na hora de Brasília. */
export function formatAgencyReportInstant(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date).replace(',', '')
}

/** Horas inteiras entre o ATD e um instante (assinatura, fechamento), para o SLA. */
export function hoursSinceAtd(atd: string, until: string): number | null {
  const start = agencyReportAtdInstant(atd)
  const end = new Date(until)
  if (!start || Number.isNaN(end.getTime())) return null
  return Math.max(0, Math.floor((end.getTime() - start.getTime()) / HOUR_MS))
}

const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/
/**
 * Dia local (America/Sao_Paulo) de um instante ISO, ou a própria data-only
 * string. B9: assinar às 22h de Brasília do último dia ainda é "no prazo" —
 * em UTC já seria o dia seguinte.
 */
export function toDateOnly(value: string): string | null {
  const dateOnlyMatch = value.match(DATE_ONLY_PATTERN)
  if (dateOnlyMatch) return dateOnlyMatch[0]

  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return null

  return saoPauloTodayIso(parsed)
}

/**
 * Deriva o estado de prazo do ADR para um departamento a partir do ATD,
 * da flag de escala omitida e da assinatura vigente (ou de "agora" quando
 * ainda nao assinado). Assinar exatamente no instante do prazo conta como
 * "no prazo".
 */
export function deriveAgencyReportDeadlineState(input: AgencyReportDeadlineInput): AgencyReportDeadlineState {
  const { atd, omitted, signedAt, now, frozenDeadlineDate } = input

  if (omitted) return 'no-deadline'
  if (!atd) return 'no-deadline'

  const reference = signedAt ?? (typeof now === 'string' ? now : now.toISOString())

  // ADR fechado antes da regra de 72 h: compara por dia com a data congelada.
  if (frozenDeadlineDate) {
    const referenceDate = toDateOnly(reference)
    if (!referenceDate) return 'no-deadline'
    return referenceDate <= frozenDeadlineDate ? 'on-time' : 'overdue'
  }

  const deadlineAt = calculateAgencyReportDeadlineAt(atd)
  const referenceMs = new Date(reference).getTime()
  if (!deadlineAt || Number.isNaN(referenceMs)) return 'no-deadline'
  return referenceMs <= new Date(deadlineAt).getTime() ? 'on-time' : 'overdue'
}
