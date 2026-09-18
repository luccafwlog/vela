// Contrato de saída compartilhado dos imports (S03 §§2.5, 3.5, 6.2).
// ImportIssue é a única forma de reportar divergência: sem `raw` (nunca vai
// à telemetria), com severidade explícita para canImport.
import { z } from 'zod'

export type ImportIssueCode =
  | 'invalid_number'
  | 'ambiguous_number'
  | 'invalid_date'
  | 'missing_header'
  | 'unknown_port'
  | 'invalid_iso'
  | 'invalid_group'
  | 'ambiguous_voyage'

export type ImportIssue = {
  row: number
  field: string
  code: ImportIssueCode
  severity: 'error' | 'warning'
  message: string
}

type RowErrorLike = { row: number; message: string; raw?: unknown; severity?: 'error' | 'warning' }

/** Converte o legado `{ row, message, raw }` sem carregar o payload bruto. */
export function rowErrorsToImportIssues(rowErrors: readonly RowErrorLike[]): ImportIssue[] {
  return rowErrors.map((error) => {
    const lower = error.message.toLocaleLowerCase('pt-BR')
    const code: ImportIssueCode = lower.includes('porto') || lower.includes('locode') || lower.includes('pol ') || lower.includes('pod ')
      ? 'unknown_port'
      : lower.includes('container') || lower.includes('iso')
        ? 'invalid_iso'
        : lower.includes('data') || lower.includes('date')
          ? 'invalid_date'
          : lower.includes('peso') || lower.includes('tara') || lower.includes('cubagem') || lower.includes('num') || lower.includes('expoente')
            ? 'invalid_number'
            : lower.includes('cabeçalho') || lower.includes('header')
              ? 'missing_header'
              : 'invalid_group'
    const field = code === 'unknown_port'
      ? lower.includes('pod') ? 'pod' : 'pol'
      : code === 'invalid_iso'
        ? 'container_number'
        : code === 'invalid_date'
          ? 'date'
          : code === 'invalid_number'
            ? 'value'
            : 'row'
    // O parser é quem sabe se a divergência impede a importação. Antes daqui
    // tudo virava 'error', então um aviso de conferência bloqueava o import e
    // o painel mandava "corrija os problemas" para algo que não era problema.
    return { row: error.row, field, code, severity: error.severity ?? 'error', message: error.message }
  })
}

export function hasBlockingIssues(issues: readonly ImportIssue[]): boolean {
  return issues.some((issue) => issue.severity === 'error')
}

/** canImport usa erro bloqueante e conjunto aplicável, não só quantidade. */
export function canImportPreview(hasRows: boolean, issues: readonly ImportIssue[]): boolean {
  return hasRows && !hasBlockingIssues(issues)
}

// ponytail: máscara mínima para nunca vazar email cru em mensagem exportada/telemetria.
const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi

export function sanitizeIssueMessage(message: string): string {
  return message.replace(EMAIL_PATTERN, '[email]')
}

export function formatIssuesAsCsv(issues: readonly ImportIssue[]): string {
  const header = 'row,field,code,severity,message'
  const lines = issues.map((issue) =>
    [issue.row, issue.field, issue.code, issue.severity, `"${sanitizeIssueMessage(issue.message).replace(/"/g, '""')}"`].join(','),
  )
  return [header, ...lines].join('\n')
}

export function downloadIssuesCsv(filename: string, issues: readonly ImportIssue[]): void {
  const blob = new Blob([formatIssuesAsCsv(issues)], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

// Schemas Zod concretos de saída (S03 §6.2): primitivas compartilhadas,
// sem framework genérico.
export const IsoContainerSchema = z
  .string()
  .regex(/^[A-Z]{4}\d{7}$/, 'formato ISO esperado (XXXX0000000)')

export const LocodeSchema = z.string().regex(/^[A-Z]{5}$/, 'LOCODE esperado (5 letras)')

export function isValidCalendarDate(iso: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!match) return false

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (year < 1 || month < 1 || month > 12 || day < 1) return false

  const isLeapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const daysInMonth = [31, isLeapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return day <= daysInMonth[month - 1]
}

export const IsoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'data ISO esperada (AAAA-MM-DD)')
  .refine(isValidCalendarDate, 'data de calendário inválida')

export const NonNegativeDecimalSchema = z
  .string()
  .regex(/^-?\d+(\.\d+)?$/, 'decimal canônico esperado')
  .refine((value) => Number(value) >= 0, 'valor não pode ser negativo')
