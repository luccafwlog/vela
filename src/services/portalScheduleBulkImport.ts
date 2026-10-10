import { importDateOrNull } from '../lib/importDate'
import { PORTAL_SCHEDULE_LANES, portalLaneCode, type PortalScheduleLaneKind } from './portalScheduleLanes'
import type { ScheduleLaneInput } from './voyageFromSchedule'

export type BulkScheduleRow = {
  vesselName: string
  vesselImo: string
  voyageNumber: string
  lanes: ScheduleLaneInput[]
  /** Colunas com conteudo que nao pode ser lido como data (aviso ao operador). */
  invalidCells: string[]
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
      return { vesselName, vesselImo, voyageNumber, lanes, invalidCells }
    })
    .filter((row) => row.vesselName && row.voyageNumber && row.vesselName !== 'EXEMPLO NAVIO')
}
