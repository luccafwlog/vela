import { saoPauloTodayIso } from '../lib/dates'

// Regra de prazo do ADR (Agency Departure Report) por departamento.
//
// Prazo = ATD + 3 dias uteis (segunda a sexta; sabado e domingo nao contam;
// feriados contam como dia util - simplificacao deliberada, sem calendario
// de feriados). O dia do ATD nunca conta. O prazo vence ao fim do 3º dia
// util. Ver docs/adr/0039-prazo-de-conclusao-do-adr-medido-por-departamento.md.

/** Estado de prazo por departamento, derivado do ATD e da assinatura vigente. */
export type AgencyReportDeadlineState = 'no-deadline' | 'on-time' | 'overdue'

export type AgencyReportDeadlineInput = {
  /** ATD da escala unificada, formato YYYY-MM-DD (sem componente de hora). */
  atd: string | null
  /** Escala omitida pelo armador: excluida da medicao permanentemente. */
  omitted: boolean
  /** Timestamp ISO da assinatura vigente do departamento, ou null se nao assinado. */
  signedAt: string | null
  /** Instante de referencia ("agora"), injetado para manter a funcao pura/testavel. */
  now: string | Date
}

const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/
// O ATD do ADR passou a nascer da Atracacao, cuja coluna e TIMESTAMPTZ
// (migration 306): chega como '2026-08-23T00:00:00+00:00', nao mais como a
// string 'YYYY-MM-DD' da trilha de auditoria da Escala. Aceitar o sufixo de
// hora e o que mantem o Prazo de Conclusao vivo; formatos ambiguos como
// '08/03/2026' continuam recusados de proposito, porque em pt-BR eles nao
// significam o mesmo que em en-US.
const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/

/** Reduz uma data ISO (com ou sem hora) ao seu 'YYYY-MM-DD'; null se nao for ISO. */
function toIsoDateOnly(value: string): string | null {
  const match = value.match(ISO_DATE_PATTERN)
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null
}

/**
 * Avanca `cursor` (mutado in-place) em UM dia de calendario e informa se o
 * dia resultante e util (segunda a sexta). Passo unico e nao "pula direto
 * para o proximo dia util" de proposito: countBusinessDaysBetween precisa
 * checar o alvo a cada dia de calendario, nao a cada dia util, senao um
 * alvo que cai num fim de semana faria o cursor ultrapassar o alvo antes de
 * parar. Compartilhado por calculateAgencyReportDeadlineDate (soma 3 dias
 * uteis a partir de uma data) e countBusinessDaysBetween (conta dias uteis
 * entre duas datas), para a regra de dia util nunca divergir entre as duas.
 */
function stepOneCalendarDayIsBusinessDay(cursor: Date): boolean {
  cursor.setUTCDate(cursor.getUTCDate() + 1)
  const weekday = cursor.getUTCDay() // 0 = domingo, 6 = sabado
  return weekday !== 0 && weekday !== 6
}

/**
 * Calcula a data do prazo (YYYY-MM-DD) a partir de um ATD (YYYY-MM-DD),
 * somando 3 dias uteis (segunda a sexta). O dia do ATD nunca conta.
 * Retorna null se `atd` nao estiver no formato YYYY-MM-DD.
 */
export function calculateAgencyReportDeadlineDate(atd: string): string | null {
  const dateOnly = toIsoDateOnly(atd)
  if (!dateOnly) return null

  const [yearStr, monthStr, dayStr] = dateOnly.split('-')
  const year = Number(yearStr)
  const month = Number(monthStr)
  const day = Number(dayStr)

  // Usa UTC para evitar deslocamento por fuso horario local ao somar dias.
  const cursor = new Date(Date.UTC(year, month - 1, day))
  if (Number.isNaN(cursor.getTime())) return null

  let businessDaysAdded = 0
  while (businessDaysAdded < 3) {
    if (stepOneCalendarDayIsBusinessDay(cursor)) businessDaysAdded += 1
  }

  const deadlineYear = cursor.getUTCFullYear()
  const deadlineMonth = String(cursor.getUTCMonth() + 1).padStart(2, '0')
  const deadlineDay = String(cursor.getUTCDate()).padStart(2, '0')
  return `${deadlineYear}-${deadlineMonth}-${deadlineDay}`
}

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
 * Conta dias úteis (segunda a sexta) estritamente entre duas datas
 * YYYY-MM-DD, sem contar o dia de `fromDateOnly` (mesma convenção de
 * calculateAgencyReportDeadlineDate: o dia de partida nunca conta, o loop
 * sempre avança antes de contar). Usada pelo agregado de SLA (Task 5 do ADR
 * 0039) para medir quantos dias úteis um departamento levou do ATD até a
 * assinatura. Retorna 0 se `toDateOnlyValue` não é posterior a
 * `fromDateOnly`, ou null se alguma das datas não estiver no formato
 * YYYY-MM-DD.
 */
export function countBusinessDaysBetween(fromDateOnly: string, toDateOnlyValue: string): number | null {
  const fromIso = toIsoDateOnly(fromDateOnly)
  const toIso = toIsoDateOnly(toDateOnlyValue)
  if (!fromIso || !toIso) return null

  const [fromYear, fromMonth, fromDay] = fromIso.split('-')
  const cursor = new Date(Date.UTC(Number(fromYear), Number(fromMonth) - 1, Number(fromDay)))
  if (Number.isNaN(cursor.getTime())) return null

  const [toYear, toMonth, toDay] = toIso.split('-')
  const target = new Date(Date.UTC(Number(toYear), Number(toMonth) - 1, Number(toDay)))
  if (Number.isNaN(target.getTime())) return null

  if (target.getTime() <= cursor.getTime()) return 0

  let businessDays = 0
  while (cursor.getTime() < target.getTime()) {
    if (stepOneCalendarDayIsBusinessDay(cursor)) businessDays += 1
  }
  return businessDays
}

/**
 * Deriva o estado de prazo do ADR para um departamento a partir do ATD,
 * da flag de escala omitida e da assinatura vigente (ou de "agora" quando
 * ainda nao assinado). Comparacao por data (sem hora): assinar/observar
 * exatamente no dia do prazo conta como "no prazo".
 */
export function deriveAgencyReportDeadlineState(input: AgencyReportDeadlineInput): AgencyReportDeadlineState {
  const { atd, omitted, signedAt, now } = input

  if (omitted) return 'no-deadline'
  if (!atd) return 'no-deadline'

  const deadlineDate = calculateAgencyReportDeadlineDate(atd)
  if (!deadlineDate) return 'no-deadline'

  if (signedAt) {
    const signedDate = toDateOnly(signedAt)
    if (!signedDate) return 'no-deadline'
    return signedDate <= deadlineDate ? 'on-time' : 'overdue'
  }

  const nowValue = typeof now === 'string' ? now : now.toISOString()
  const nowDate = toDateOnly(nowValue)
  if (!nowDate) return 'no-deadline'

  return nowDate <= deadlineDate ? 'on-time' : 'overdue'
}
