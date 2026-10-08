import type { LineUpRow } from '../services/lineup'

export type LineUpPeriodoFilter = 'all' | 'custom'
export type LineUpCeFilter = 'all' | 'waiting' | 'received' | 'launching' | 'approving' | 'approved'
// Viagem cancelada não entra no Line-Up (lineup.ts), então não há filtro para ela.
export type LineUpStatusFilter = 'all' | 'active' | 'completed'
export type LineUpPresenceFilter = 'all' | 'with' | 'without'

export type LineUpFilters = {
  search: string
  status: LineUpStatusFilter
  periodo: LineUpPeriodoFilter
  dataInicio: string
  dataFim: string
  vehicles: LineUpPresenceFilter
  bb: LineUpPresenceFilter
  ces: LineUpCeFilter
  linked: LineUpPresenceFilter
  mty: LineUpPresenceFilter
  rtw: LineUpPresenceFilter
}

export function filterLineUpRows(rows: LineUpRow[], filters: LineUpFilters): LineUpRow[] {
  const voyagesWithMty = new Set(rows.filter((row) => row.mty > 0).map((row) => row.voyageId))
  const search = filters.search.trim().toLowerCase()

  return rows.filter((row) => {
    // Exportações representam uma programação distinta e não somem com filtros operacionais do Line Up.
    if (row.rowType === 'export') return true
    if (filters.status !== 'all' && row.voyageStatus !== filters.status) return false
    if (search && !row.vesselName.toLowerCase().includes(search) && !row.voyageNumber.toLowerCase().includes(search)) return false
    if (filters.periodo === 'custom' && !isWithinPeriod(row.eta, filters.dataInicio, filters.dataFim)) return false
    if (!matchesPresence(filters.vehicles, row.vin > 0)) return false
    if (!matchesPresence(filters.bb, row.bbTotal > 0)) return false
    if (filters.ces !== 'all' && ceFilterStatus(row.ceStatus) !== filters.ces) return false
    if (!matchesPresence(filters.linked, row.linked)) return false
    if (!matchesPresence(filters.mty, voyagesWithMty.has(row.voyageId))) return false
    if (!matchesPresence(filters.rtw, (row.rtw ?? 0) > 0)) return false
    return true
  })
}

function matchesPresence(filter: LineUpPresenceFilter, has: boolean) {
  return filter === 'all' || (filter === 'with') === has
}

function isWithinPeriod(eta: string | null, dataInicio: string, dataFim: string) {
  if (!dataInicio && !dataFim) return true
  if (!eta) return false
  const date = eta.slice(0, 10)
  if (dataInicio && date < dataInicio) return false
  if (dataFim && date > dataFim) return false
  return true
}

function ceFilterStatus(status: LineUpRow['ceStatus']): LineUpCeFilter {
  if (status === 'waiting' || status === 'missing') return 'waiting'
  if (status === 'partial') return 'launching'
  return status
}

export function countActiveLineUpFilters(filters: LineUpFilters): number {
  let count = 0
  if (filters.search.trim() !== '') count += 1
  if (filters.status !== 'active') count += 1
  if (filters.periodo !== 'all') count += 1
  if (filters.vehicles !== 'all') count += 1
  if (filters.bb !== 'all') count += 1
  if (filters.ces !== 'all') count += 1
  if (filters.linked !== 'all') count += 1
  if (filters.mty !== 'all') count += 1
  if (filters.rtw !== 'all') count += 1
  return count
}

export function emptyLineUpFilters(): LineUpFilters {
  return {
    search: '', status: 'active', periodo: 'all', dataInicio: '', dataFim: '',
    vehicles: 'all', bb: 'all', ces: 'all', linked: 'all', mty: 'all', rtw: 'all',
  }
}
