import { PORTAL_SCHEDULE_LANES, portalLaneCode } from './portalScheduleLanes'
import { callPortalRpc, clientPortalScope, type PortalScope } from './portalScope'
import { supabase } from './supabase'

export type PortalScheduleRpcRow = {
  voyage_id: number
  vessel_name: string
  voyage: string
  imo_number: string | null
  port_code: string
  kind: 'pol' | 'pod'
  date_value: string | null
  actual_value?: string | null
  omitted?: boolean
}

export type PortalScheduleVoyage = {
  voyageId: number
  vesselName: string
  voyage: string
  imoNumber: string | null
  datesByLabel: Record<string, string>
  forecastDatesByLabel?: Record<string, string>
  actualDatesByLabel?: Record<string, string>
  omittedByLabel?: Record<string, boolean>
  earliestEta: string | null
}

const LABEL_BY_CODE = new Map(PORTAL_SCHEDULE_LANES.map((lane) => [portalLaneCode(lane), lane.label]))

export function projectPortalScheduleRows(rows: PortalScheduleRpcRow[]): PortalScheduleVoyage[] {
  const byVoyage = new Map<number, PortalScheduleVoyage>()

  for (const row of rows) {
    const voyage = byVoyage.get(row.voyage_id) ?? {
      voyageId: row.voyage_id,
      vesselName: row.vessel_name,
      voyage: row.voyage,
      imoNumber: row.imo_number,
      datesByLabel: {},
      forecastDatesByLabel: {},
      actualDatesByLabel: {},
      omittedByLabel: {},
      earliestEta: null,
    }
    const label = LABEL_BY_CODE.get(row.port_code)
    if (label) {
      if (row.omitted) {
        const omittedByLabel = voyage.omittedByLabel ?? (voyage.omittedByLabel = {})
        omittedByLabel[label] = true
      }
    }
    if (label && row.date_value) {
      const forecastDatesByLabel = voyage.forecastDatesByLabel ?? (voyage.forecastDatesByLabel = {})
      const actualDatesByLabel = voyage.actualDatesByLabel ?? (voyage.actualDatesByLabel = {})
      voyage.datesByLabel[label] = row.date_value
      forecastDatesByLabel[label] = row.date_value
      if (row.actual_value) {
        actualDatesByLabel[label] = row.actual_value
        voyage.datesByLabel[label] = row.actual_value
      }
      if (row.kind === 'pod' && (voyage.earliestEta === null || row.date_value < voyage.earliestEta)) {
        voyage.earliestEta = row.date_value
      }
    }
    byVoyage.set(row.voyage_id, voyage)
  }

  return Array.from(byVoyage.values()).sort((left, right) => {
    if (left.earliestEta && right.earliestEta) return left.earliestEta.localeCompare(right.earliestEta)
    if (left.earliestEta) return -1
    if (right.earliestEta) return 1
    return left.voyage.localeCompare(right.voyage, 'pt-BR')
  })
}

function projectRpcRows(data: PortalScheduleRpcRow[] | null): PortalScheduleVoyage[] {
  return projectPortalScheduleRows((data ?? []).map((row) => {
    if (row.kind !== 'pol' && row.kind !== 'pod') throw new Error(`Tipo de escala inválido: ${row.kind}`)
    return { ...row, kind: row.kind }
  }))
}

export async function fetchPortalScheduleVoyages(scope: PortalScope = clientPortalScope): Promise<PortalScheduleVoyage[]> {
  return projectRpcRows(await callPortalRpc<PortalScheduleRpcRow[]>(scope, 'portal_ship_schedule'))
}

// `/chegadas-saidas` lê a mesma projeção com a sessão interna. O cliente do
// Portal não tem login no Vela e chamaria como `anon`, sem EXECUTE desde a
// migration 302 (ADR 0090).
export async function fetchInternalScheduleVoyages(): Promise<PortalScheduleVoyage[]> {
  const { data, error } = await supabase.rpc('portal_ship_schedule')
  if (error) throw error
  return projectRpcRows(data as PortalScheduleRpcRow[] | null)
}
