import type { BLListItem, ContainerListItem } from '../types/database'
import { supabase } from './supabase'

export type OperationalListFilters = {
  search?: string
  voyageId?: string | number
  cargoMode?: 'container' | 'carga_solta' | 'misto' | '' | null
  pol?: string
  pod?: string
  reviewStatus?: string
  financialStatus?: string
  chargeStatus?: string
  cargoProfile?: string
}

export type OperationalBlPage = {
  rows: BLListItem[]
  count: number
}

export type OperationalBlSummary = {
  totalBls: number
  totalDistinctContainers: number
  pendingReview: number
  pendingFinancial: number
  chargePending: number
  chargeReady: number
  chargeExempt: number
  totalMachines: number
  totalPackages: number
  totalWeightTon: number
  totalCbm: number
}

export type OperationalContainerFilters = OperationalListFilters & {
  containerType?: string
  vehicleContainer?: '' | 'true' | 'false' | null
}

export type OperationalContainerPage = {
  rows: ContainerListItem[]
  count: number
  distinctCount: number
  oogDistinctCount: number
  imoDistinctCount: number
  blCount: number
  typeSummary: Array<{ type: string; distinctCount: number }>
}

export type OperationalVoyageRouteSummary = {
  pol: string | null
  pod: string | null
  blCount: number
  containerBlCount?: number
  breakbulkBlCount?: number
  ceFilled?: number
  ceTotal?: number
}

export type OperationalVoyageSummary = {
  id: number
  voyage_number: string
  etd: string | null
  eta: string | null
  ata: string | null
  status: string | null
  created_at?: string | null
  vessel?: {
    id?: number
    name: string | null
    imo?: string | null
    carrier?: { id?: number; name: string | null; scac?: string | null } | null
  } | null
  pol?: { id?: number; name: string | null; locode?: string | null; country?: string | null } | null
  pod?: { id?: number; name: string | null; locode?: string | null; country?: string | null } | null
  blCount: number
  containerBlCount?: number
  breakbulkBlCount?: number
  containerCount: number
  baplieCount: number
  ceCoverage: { filled: number; total: number }
  routes: OperationalVoyageRouteSummary[]
}

export type OperationalVoyageSummaryPage = {
  rows: OperationalVoyageSummary[]
  count: number
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function asNumber(value: unknown, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function asNullableString(value: unknown) {
  return typeof value === 'string' ? value : value == null ? null : String(value)
}

function parseVoyageRouteSummary(value: unknown): OperationalVoyageRouteSummary | null {
  const row = asRecord(value)
  if (row.blCount == null && row.bl_count == null) return null
  return {
    pol: asNullableString(row.pol),
    pod: asNullableString(row.pod),
    blCount: asNumber(row.blCount ?? row.bl_count),
    containerBlCount: asNumber(row.containerBlCount ?? row.container_bl_count),
    breakbulkBlCount: asNumber(row.breakbulkBlCount ?? row.breakbulk_bl_count),
    ceFilled: asNumber(row.ceFilled ?? row.ce_filled),
    ceTotal: asNumber(row.ceTotal ?? row.ce_total ?? row.blCount ?? row.bl_count),
  }
}

function parseOperationalVoyageSummary(value: unknown): OperationalVoyageSummary | null {
  const row = asRecord(value)
  const id = asNumber(row.id, NaN)
  if (!Number.isInteger(id)) return null
  const coverage = asRecord(row.ceCoverage ?? row.ce_coverage)
  const routes = Array.isArray(row.routes)
    ? row.routes.flatMap((route) => {
        const parsed = parseVoyageRouteSummary(route)
        return parsed ? [parsed] : []
      })
    : []
  const vessel = asRecord(row.vessel)
  const carrier = asRecord(vessel.carrier)
  const pol = asRecord(row.pol)
  const pod = asRecord(row.pod)
  return {
    id,
    voyage_number: String(row.voyage_number ?? ''),
    etd: asNullableString(row.etd),
    eta: asNullableString(row.eta),
    ata: asNullableString(row.ata),
    status: asNullableString(row.status),
    created_at: asNullableString(row.created_at),
    vessel: row.vessel == null ? null : {
      id: Number.isInteger(asNumber(vessel.id, NaN)) ? asNumber(vessel.id) : undefined,
      name: asNullableString(vessel.name),
      imo: asNullableString(vessel.imo),
      carrier: vessel.carrier == null ? null : {
        id: Number.isInteger(asNumber(carrier.id, NaN)) ? asNumber(carrier.id) : undefined,
        name: asNullableString(carrier.name),
        scac: asNullableString(carrier.scac),
      },
    },
    pol: row.pol == null ? null : {
      id: Number.isInteger(asNumber(pol.id, NaN)) ? asNumber(pol.id) : undefined,
      name: asNullableString(pol.name),
      locode: asNullableString(pol.locode),
      country: asNullableString(pol.country),
    },
    pod: row.pod == null ? null : {
      id: Number.isInteger(asNumber(pod.id, NaN)) ? asNumber(pod.id) : undefined,
      name: asNullableString(pod.name),
      locode: asNullableString(pod.locode),
      country: asNullableString(pod.country),
    },
    blCount: asNumber(row.blCount ?? row.bl_count),
    containerBlCount: asNumber(row.containerBlCount ?? row.container_bl_count),
    breakbulkBlCount: asNumber(row.breakbulkBlCount ?? row.breakbulk_bl_count),
    containerCount: asNumber(row.containerCount ?? row.container_count),
    baplieCount: asNumber(row.baplieCount ?? row.baplie_count),
    ceCoverage: {
      filled: asNumber(coverage.filled ?? row.ceFilled ?? row.ce_filled),
      total: asNumber(coverage.total ?? row.ceTotal ?? row.ce_total ?? row.blCount ?? row.bl_count),
    },
    routes,
  }
}

function baseArgs(filters: OperationalListFilters) {
  return {
    p_search: filters.search?.trim() || null,
    p_voyage_id: filters.voyageId ? Number(filters.voyageId) : null,
    p_cargo_mode: filters.cargoMode || null,
    p_pol: filters.pol?.trim() || null,
    p_pod: filters.pod?.trim() || null,
    p_review_status: filters.reviewStatus || null,
    p_financial_status: filters.financialStatus || null,
    p_charge_status: filters.chargeStatus || null,
    p_cargo_profile: filters.cargoProfile || null,
  }
}

export async function listOperationalBls(
  filters: OperationalListFilters,
  page: number,
  pageSize: number,
): Promise<OperationalBlPage> {
  const { data, error } = await supabase.rpc('operational_list_bls', {
    p_page: page,
    p_page_size: pageSize,
    ...baseArgs(filters),
  })
  if (error) throw error
  const payload = asRecord(data)
  return {
    rows: Array.isArray(payload.rows) ? payload.rows as BLListItem[] : [],
    count: asNumber(payload.count),
  }
}

export async function getOperationalBlSummary(filters: OperationalListFilters): Promise<OperationalBlSummary> {
  const { data, error } = await supabase.rpc('operational_list_bl_summary', baseArgs(filters))
  if (error) throw error
  const payload = asRecord(data)
  return {
    totalBls: asNumber(payload.totalBls),
    totalDistinctContainers: asNumber(payload.totalDistinctContainers),
    pendingReview: asNumber(payload.pendingReview),
    pendingFinancial: asNumber(payload.pendingFinancial),
    chargePending: asNumber(payload.chargePending),
    chargeReady: asNumber(payload.chargeReady),
    chargeExempt: asNumber(payload.chargeExempt),
    totalMachines: asNumber(payload.totalMachines),
    totalPackages: asNumber(payload.totalPackages),
    totalWeightTon: asNumber(payload.totalWeightTon),
    totalCbm: asNumber(payload.totalCbm),
  }
}

export async function listOperationalContainers(
  filters: OperationalContainerFilters,
  page: number,
  pageSize: number,
): Promise<OperationalContainerPage> {
  const vehicleContainer = filters.vehicleContainer === 'true'
    ? true
    : filters.vehicleContainer === 'false'
      ? false
      : null
  const { data, error } = await supabase.rpc('operational_list_containers', {
    p_page: page,
    p_page_size: pageSize,
    ...baseArgs(filters),
    p_container_type: filters.containerType?.trim() || null,
    p_vehicle_container: vehicleContainer,
  })
  if (error) throw error
  const payload = asRecord(data)
  return {
    rows: Array.isArray(payload.rows) ? payload.rows as ContainerListItem[] : [],
    count: asNumber(payload.count),
    distinctCount: asNumber(payload.distinctCount),
    oogDistinctCount: asNumber(payload.oogDistinctCount),
    imoDistinctCount: asNumber(payload.imoDistinctCount),
    blCount: asNumber(payload.blCount),
    typeSummary: Array.isArray(payload.typeSummary)
      ? payload.typeSummary.flatMap((value) => {
        const row = asRecord(value)
        return typeof row.type === 'string' ? [{ type: row.type, distinctCount: asNumber(row.distinctCount) }] : []
      })
      : [],
  }
}

export async function listOperationalVoyageSummaries(
  page = 1,
  pageSize = 100,
): Promise<OperationalVoyageSummaryPage> {
  const { data, error } = await supabase.rpc('operational_list_voyage_summaries', {
    p_page: page,
    p_page_size: pageSize,
  })
  if (error) throw error
  const payload = asRecord(data)
  return {
    rows: Array.isArray(payload.rows)
      ? payload.rows.flatMap((row) => {
          const parsed = parseOperationalVoyageSummary(row)
          return parsed ? [parsed] : []
        })
      : [],
    count: asNumber(payload.count),
  }
}

/**
 * Rotas declaradas nos B/Ls de uma viagem. É um read-model pequeno e paginado
 * compartilhado pelas telas que só precisam montar opções de escala; não
 * devem duplicar um `select('*')` nem materializar o B/L completo.
 */
export async function listVoyageRoutePorts(voyageId: number) {
  const ports = new Set<string>()
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('bls')
      .select('pol, pod')
      .eq('voyage_id', voyageId)
      .range(from, from + 999)
    if (error) throw error
    for (const row of (data ?? []) as Array<{ pol: string | null; pod: string | null }>) {
      for (const port of [row.pol, row.pod]) {
        if (port) ports.add(port)
      }
    }
    if (!data || data.length < 1000) break
  }
  return Array.from(ports)
}
