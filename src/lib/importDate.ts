// Fronteira de datas dos imports (ADR 0078, item 22), irmã de importNumber.ts.
//
// Toda data de planilha vira data civil `AAAA-MM-DD`, sem fuso: o leitor comum
// (`readSheet`) já entrega a célula de data do Excel como `AAAA-MM-DD` (ou
// `AAAA-MM-DD HH:MM`), calculada do serial e não de um `Date` no fuso do
// navegador; o texto digitado segue o contrato da operação, `DD/MM/AAAA`. Ano
// fora de quatro dígitos é recusado (`01/08/126` não vira 2126). Nunca usar
// `toISOString`, `getUTC*` ou `cellDates` para converter célula.

export type ParsedImportDate =
  | { kind: 'value'; date: string; time: string | null }
  | { kind: 'empty' }
  | { kind: 'invalid'; reason: string }

const ISO_PATTERN = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?)?$/
const BR_PATTERN = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d+)(?:\s+(\d{1,2}):(\d{2})(?::\d{2})?)?$/

export function isValidCivilDate(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false
  if (year < 1000 || year > 9999 || month < 1 || month > 12 || day < 1) return false
  const daysInMonth = [31, (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return day <= daysInMonth[month - 1]
}

function civil(year: number, month: number, day: number) {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function clock(hours: string | undefined, minutes: string | undefined): string | null | undefined {
  if (hours === undefined || minutes === undefined) return null
  const h = Number(hours)
  const m = Number(minutes)
  if (h > 23 || m > 59) return undefined
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/**
 * Lê uma célula de data: `AAAA-MM-DD[ HH:MM]` (célula de data do Excel, pelo
 * leitor comum) ou `DD/MM/AAAA[ HH:MM]` (texto). Número solto (serial cru),
 * `Date` e qualquer outra forma são recusados com motivo: quem chama decide se
 * vira erro de linha.
 */
export function parseImportDate(value: unknown): ParsedImportDate {
  if (value === null || value === undefined) return { kind: 'empty' }
  if (typeof value !== 'string') {
    return { kind: 'invalid', reason: 'a célula não é uma data nem um texto DD/MM/AAAA' }
  }
  const text = value.trim()
  if (!text) return { kind: 'empty' }

  const iso = text.match(ISO_PATTERN)
  if (iso) {
    const [, y, m, d, hh, mm] = iso
    const time = clock(hh, mm)
    if (!isValidCivilDate(Number(y), Number(m), Number(d)) || time === undefined) {
      return { kind: 'invalid', reason: `"${text}" não é uma data válida` }
    }
    return { kind: 'value', date: civil(Number(y), Number(m), Number(d)), time }
  }

  const br = text.match(BR_PATTERN)
  if (br) {
    const [, d, m, y, hh, mm] = br
    if (y.length !== 4) return { kind: 'invalid', reason: `"${text}": o ano precisa de quatro dígitos (DD/MM/AAAA)` }
    const time = clock(hh, mm)
    if (!isValidCivilDate(Number(y), Number(m), Number(d)) || time === undefined) {
      return { kind: 'invalid', reason: `"${text}" não é uma data válida` }
    }
    return { kind: 'value', date: civil(Number(y), Number(m), Number(d)), time }
  }

  return { kind: 'invalid', reason: `"${text}" não está em DD/MM/AAAA` }
}

/** Atalho: a data civil ou `null` (vazio ou inválido). */
export function importDateOrNull(value: unknown): string | null {
  const parsed = parseImportDate(value)
  return parsed.kind === 'value' ? parsed.date : null
}

/**
 * Data civil de um serial do Excel, sem passar por `Date` no fuso do
 * navegador. Usado pelo leitor comum ao entregar a célula de data.
 *
 * `date1904`: pasta gravada no sistema de datas 1904 (Excel antigo de Mac,
 * `Workbook.WBProps.date1904`), em que o serial 0 é 01/01/1904 — 1462 dias
 * depois do serial 0 do sistema 1900. Sem a flag, a data sairia 4 anos e 1 dia
 * antes.
 */
export function excelSerialToCivil(
  serial: number,
  options: { date1904?: boolean } = {},
): { date: string; time: string | null } | null {
  if (!Number.isFinite(serial)) return null
  const serial1900 = options.date1904 ? serial + 1462 : serial
  // Arredonda ao segundo ANTES de separar dia e hora: o serial é uma fração
  // binária, e 46236 − 1e-9 (meia-noite) não pode cair no dia anterior às
  // 23:59. A hora entregue é HH:MM truncada, como o Excel mostra em "hh:mm"
  // (16:29:40 é 16:29, não 16:30).
  const totalSeconds = Math.round(serial1900 * 86_400)
  const whole = Math.floor(totalSeconds / 86_400)
  // Serial sem dia inteiro é célula só de hora (`excelSerialTimeOfDay`), não data.
  if (whole < 1) return null
  // 1900 é tratado pelo Excel como bissexto: o serial 60 é o inexistente 29/02/1900
  // (lido como 01/03/1900). O serial 25569 é 01/01/1970; a conversão é
  // aritmética de calendário pura.
  const { year, month, day } = civilFromDays(whole - 25569 + (whole <= 60 ? 1 : 0))
  const date = civil(year, month, day)
  const minutes = Math.floor((totalSeconds - whole * 86_400) / 60)
  if (minutes <= 0) return { date, time: null }
  return { date, time: `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}` }
}

/**
 * Hora `HH:MM` de uma célula só de hora (`hh:mm`), cujo serial fica entre 0 e
 * 1 (fração do dia, sem data), ou `null` quando o serial tem data. O leitor
 * comum entrega esse texto no lugar da célula vazia: a hora não some em
 * silêncio, e o parser de data a recusa com motivo ("não está em DD/MM/AAAA").
 *
 * O serial 0 é tratado como vazio (`null` aqui e em `excelSerialToCivil`): é o
 * que uma fórmula que aponta para célula vazia devolve numa coluna de data.
 * ponytail: a meia-noite digitada como hora pura (`00:00`) também é 0 e cai
 * nesse vazio; upgrade = olhar o formato da célula (só hora × data).
 */
export function excelSerialTimeOfDay(serial: number): string | null {
  if (!Number.isFinite(serial) || serial <= 0) return null
  const totalSeconds = Math.round(serial * 86_400)
  if (totalSeconds >= 86_400) return null
  const minutes = Math.floor(totalSeconds / 60)
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}

/** Dias desde 01/01/1970 → data civil (algoritmo de H. Hinnant, sem `Date`). */
function civilFromDays(daysSinceEpoch: number) {
  const z = daysSinceEpoch + 719468
  const era = Math.floor(z / 146097)
  const doe = z - era * 146097
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365)
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100))
  const mp = Math.floor((5 * doy + 2) / 153)
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1
  const month = mp < 10 ? mp + 3 : mp - 9
  const year = yoe + era * 400 + (month <= 2 ? 1 : 0)
  return { year, month, day }
}
