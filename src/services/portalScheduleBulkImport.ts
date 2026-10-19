import { importDateOrNull } from '../lib/importDate'
import { PORTAL_SCHEDULE_LANES, portalLaneCode, type PortalScheduleLaneKind } from './portalScheduleLanes'
import type { ImportIssue } from './importValidation'
import type { ScheduleLaneInput, ScheduleSheetPlanRow } from './voyageFromSchedule'

export type BulkScheduleRow = {
  vesselName: string
  vesselImo: string
  voyageNumber: string
  lanes: ScheduleLaneInput[]
  /**
   * Colunas com conteúdo que não pode ser lido como data. É erro: recusa a
   * planilha inteira (regra de 2026-10-19).
   */
  invalidCells: string[]
  /** Linha da planilha, quando lida pelo leitor comum; a prévia aponta o erro por ela. */
  rowNumber?: number
}

function stripAccents(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

function laneColumn(label: string, kind: PortalScheduleLaneKind) {
  return `${label} ${kind === 'pol' ? 'ETD' : 'ETA'}`
}

function readCell(row: Record<string, unknown>, column: string) {
  return row[column] ?? row[stripAccents(column)]
}

export function scheduleTemplateColumns(): string[] {
  return ['VESSEL NAME', 'VOY', 'IMO', ...PORTAL_SCHEDULE_LANES.map((lane) => laneColumn(lane.label, lane.kind))]
}

// Data civil única dos imports (src/lib/importDate.ts). "X" marca escala sem data.
export function parseCellDate(raw: unknown): string | null {
  const value = String(raw ?? '').trim()
  if (!value || value.toUpperCase() === 'X') return null
  return importDateOrNull(value)
}

function isBlankCell(raw: unknown): boolean {
  if (raw == null) return true
  const value = String(raw).trim()
  return value === '' || value.toUpperCase() === 'X'
}

/**
 * Duas colunas para o mesmo campo bloqueiam (ADR 0078, item 22). O leitor
 * comum dá sufixo à repetição (`VOY`, `VOY_1`) e este parser lê por nome: sem
 * esta checagem, a segunda coluna seria ignorada em silêncio.
 */
export function assertNoRepeatedScheduleColumns(headers: readonly string[]) {
  const known = new Set([...scheduleTemplateColumns(), ...PORTAL_SCHEDULE_LANES.map((lane) => lane.label)]
    .map((column) => stripAccents(column).trim().toUpperCase()))
  const counts = new Map<string, number>()
  for (const header of headers) {
    const base = stripAccents(String(header ?? '')).trim().toUpperCase().replace(/_\d+$/, '')
    if (known.has(base)) counts.set(base, (counts.get(base) ?? 0) + 1)
  }
  const repeated = [...counts].filter(([, count]) => count > 1).map(([column]) => `"${column}"`)
  if (repeated.length) {
    throw new Error(`A coluna ${repeated.join(', ')} aparece mais de uma vez no cabeçalho. Deixe só uma e importe de novo.`)
  }
}

export function parseScheduleRows(rows: Array<Record<string, unknown>>): BulkScheduleRow[] {
  return rows
    .map((row) => {
      const vesselName = String(row['VESSEL NAME'] ?? row['Vessel Name'] ?? '').trim()
      const voyageNumber = String(row.VOY ?? '').trim()
      const vesselImo = String(row.IMO ?? '').trim()
      const invalidCells: string[] = []
      const lanes = PORTAL_SCHEDULE_LANES.map((lane) => {
        const column = laneColumn(lane.label, lane.kind)
        const raw = readCell(row, column) ?? row[lane.label]
        const date = parseCellDate(raw)
        if (date === null && !isBlankCell(raw)) invalidCells.push(column)
        return { code: portalLaneCode(lane), kind: lane.kind, date }
      })
      const rowNumber = typeof row.rowNumber === 'number' ? row.rowNumber : undefined
      return { vesselName, vesselImo, voyageNumber, lanes, invalidCells, ...(rowNumber === undefined ? {} : { rowNumber }) }
    })
    .filter((row) => row.vesselName && row.voyageNumber && row.vesselName !== 'EXEMPLO NAVIO')
}

/**
 * Erros da planilha de programação (regra de 2026-10-19): data ilegível e
 * Viagem que a prévia recusa. Qualquer um recusa a planilha inteira. `plan`
 * tem uma linha por linha de `rows`, na mesma ordem (`planScheduleSheet`).
 */
export function scheduleSheetIssues(rows: readonly BulkScheduleRow[], plan: readonly ScheduleSheetPlanRow[]): ImportIssue[] {
  const issues: ImportIssue[] = []
  rows.forEach((row, index) => {
    const line = row.rowNumber ?? index + 2
    const label = `${row.vesselName} / ${row.voyageNumber}`
    if (row.invalidCells.length) {
      issues.push({ row: line, field: 'date', code: 'invalid_date', severity: 'error', message: `${label}: data ilegível em ${row.invalidCells.join(', ')}.` })
    }
    const planned = plan[index]
    if (planned?.error) {
      issues.push({ row: line, field: 'row', code: 'invalid_group', severity: 'error', message: `${planned.label}: ${planned.error}` })
    }
  })
  return issues
}
