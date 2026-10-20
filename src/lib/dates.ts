const DAY_MS = 86400000

function calendarDayUtc(date: Date) {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
}

function parseCalendarDay(value: string) {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (dateOnly) {
    return Date.UTC(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
  }

  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return null
  return calendarDayUtc(parsed)
}

export function isWithinNextCalendarDays(dateStr: string | null, days: number, today = new Date()): boolean {
  if (!dateStr) return false
  const targetDay = parseCalendarDay(dateStr)
  if (targetDay == null) return false
  const diffDays = Math.round((targetDay - calendarDayUtc(today)) / DAY_MS)
  return diffDays >= 0 && diffDays <= days
}

/**
 * Data de hoje (aaaa-mm-dd) no calendário de Brasília, o mesmo que o banco usa
 * (`now() AT TIME ZONE 'America/Sao_Paulo'`). `toISOString()` é UTC e vira o
 * dia seguinte a partir das 21h.
 */
export function saoPauloTodayIso(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]))
  return `${values.year}-${values.month}-${values.day}`
}

/**
 * Início e fim de um dia de Brasília (aaaa-mm-dd) como instantes, para filtro
 * de data não cortar o dia três horas antes, no horário UTC.
 * ponytail: fuso fixo -03:00; o Brasil não tem horário de verão desde 2019.
 */
export function brasiliaDayBounds(day: string): { start: string; end: string } {
  return { start: `${day}T00:00:00-03:00`, end: `${day}T23:59:59.999-03:00` }
}
