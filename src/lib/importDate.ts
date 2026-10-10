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
 * Data civil de um serial do Excel (sistema 1900), sem passar por `Date` no
 * fuso do navegador. Usado pelo leitor comum ao entregar a célula de data.
 */
export function excelSerialToCivil(serial: number): { date: string; time: string | null } | null {
  if (!Number.isFinite(serial) || serial < 1) return null
  const whole = Math.floor(serial)
  // 1900 é tratado pelo Excel como bissexto: o serial 60 é o inexistente 29/02/1900.
  // O serial 25569 é 01/01/1970; a conversão é aritmética de calendário pura.
  const { year, month, day } = civilFromDays(whole - 25569 + (whole <= 60 ? 1 : 0))
  const date = civil(year, month, day)
  const minutes = Math.round((serial - whole) * 1440)
  if (minutes <= 0 || minutes >= 1440) return { date, time: null }
  return { date, time: `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}` }
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
