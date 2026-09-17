import { useQuery } from '@tanstack/react-query'
import { escapeFilterTerm, normalizeText } from '../lib/utils'
import { queryKeys } from '../services/queryKeys'
import { supabase } from '../services/supabase'
import {
  getOperationalBlSummary,
  listOperationalBls,
  listOperationalContainers,
  listOperationalVoyageSummaries,
  type OperationalVoyageSummary,
} from '../services/operationalLists'
import type { VoyageDetail } from '../services/voyageReadModels'
import type { AuditLog, BL, BLDetail, BLListItem, ContainerListItem } from '../types/database'

const blSelect = `
  *,
  customer:customers!bls_customer_id_fkey(id, cnpj_cpf, name),
  voyage:voyages(id, voyage_number, eta, ata, status, vessel:vessels(id, name, imo, carrier:carriers(id, name, scac))),
  bl_containers(id, bl_id, container_number, seal_number, type, tare_weight_kg, gross_weight_kg, cbm, is_oog, is_imo, imo_class, un_number, created_at),
  bl_freight_lines(bl_id, seq, description, category, mercante_code, currency, amount, payment),
  bl_breakbulk_items(id, bl_id, item_description, package_qty, package_unit, gross_weight_kg, cbm, marks, created_at)
`

const exportBatchSize = 1000

const voyageDetailSelect = `
  *,
  vessel:vessels(id, name, imo, carrier:carriers(id, name, scac)),
  pol:ports!voyages_pol_id_fkey(id, name, locode, country),
  pod:ports!voyages_pod_id_fkey(id, name, locode, country),
  import_batches(
    id,
    voyage_id,
    cargo_mode,
    filename,
    uploaded_at,
    status,
    total_bls,
    ce_master
  ),
  granite_manifests(
    id,
    voyage_id,
    loading_port,
    discharge_port,
    total_bls,
    total_weight_kg,
    granite_bls(id, charge_status)
  ),
  vazios_manifests(
    id,
    voyage_id,
    description,
    total_bookings,
    vazios_bookings(
      id,
      container_number,
      container_type,
      local_id,
      condition,
      operation_id,
      operation:vazios_export_operations(id, embark_port),
      local:depots(id, code, name, tipo)
    )
  ),
  bls(
    *,
    bl_containers(id, container_number, seal_number, type, tare_weight_kg, gross_weight_kg, cbm, is_oog, is_imo, imo_class, un_number),
    bl_breakbulk_items(id, gross_weight_kg, cbm)
  )
`

function supabaseRows<T>(data: unknown): T[] {
  return Array.isArray(data) ? (data as T[]) : []
}

function supabaseValue<T>(data: unknown): T {
  return data as T
}

export type BlFilters = {
  search: string
  voyageId: string
  cargoMode?: 'container' | 'carga_solta' | 'misto' | ''
  pol: string
  pod: string
  reviewStatus: string
  financialStatus: string
  chargeStatus: string
  cargoProfile: string
  page: number
  pageSize: number
}

export type ContainerFilters = {
  search: string
  voyageId: string
  cargoMode?: 'container' | 'carga_solta' | 'misto' | ''
  pol: string
  pod: string
  reviewStatus: string
  financialStatus: string
  chargeStatus: string
  cargoProfile: string
  containerType?: string
  vehicleContainer: '' | 'true' | 'false'
  page: number
  pageSize: number
}

export function useBls(filters: BlFilters) {
  return useQuery({
    queryKey: queryKeys.bls.list(filters),
    queryFn: () => listOperationalBls(filters, filters.page, filters.pageSize),
  })
}

export function useContainers(filters: ContainerFilters) {
  return useQuery({
    queryKey: queryKeys.bls.containers(filters),
    queryFn: () => listOperationalContainers(filters, filters.page, filters.pageSize),
  })
}

export function useBlSummary(filters: BlFilters) {
  return useQuery({
    queryKey: queryKeys.bls.summary(toSummaryFilters(filters)),
    queryFn: () => getOperationalBlSummary(filters),
  })
}

/**
 * @deprecated Não utilizar para navegação ou renderização de rails/listas operacionais.
 * Materializa lotes sucessivos de 1.000 linhas exclusivamente para fluxos de
 * exportação explícita (CSV/XLSX) disparados manualmente pelo operador.
 */
export async function fetchAllBls(filters: BlFilters) {
  const rows: BLListItem[] = []
  let from = 0
  const chargeStatusFilter = normalizeChargeStatus(filters.chargeStatus)
  const dbFilters = chargeStatusFilter ? { ...filters, chargeStatus: '' } : filters

  while (true) {
    const to = from + exportBatchSize - 1
    let query = supabase.from('bls').select(blSelect).order('created_at', { ascending: false }).range(from, to)
    query = applyBlFilters(query, dbFilters)

    const { data, error } = await query
    if (error) throw error

    const batch = supabaseRows<BLListItem>(data)
    rows.push(...batch)

    if (batch.length < exportBatchSize) {
      break
    }

    from += exportBatchSize
  }

  const profileFiltered = applyCargoProfile(rows, filters.cargoProfile)
  if (!chargeStatusFilter) return profileFiltered
  return profileFiltered.filter((row) => normalizeChargeStatus(row.charge_status) === chargeStatusFilter)
}

/**
 * @deprecated Não utilizar para navegação ou renderização de rails/listas operacionais.
 * Materializa lotes sucessivos de 1.000 linhas exclusivamente para fluxos de
 * exportação explícita (CSV/XLSX) disparados manualmente pelo operador.
 */
export async function fetchAllContainers(filters: ContainerFilters) {
  const rows = await fetchAllBls({
    search: '',
    voyageId: filters.voyageId,
    cargoMode: filters.cargoMode ?? 'container',
    pol: filters.pol,
    pod: filters.pod,
    reviewStatus: filters.reviewStatus,
    financialStatus: filters.financialStatus,
    chargeStatus: filters.chargeStatus,
    cargoProfile: '',
    page: 1,
    pageSize: exportBatchSize,
  })

  const flattenedRows = rows.flatMap((bl) =>
    (bl.bl_containers ?? []).map(
      (container) =>
        ({
          ...container,
          bl,
        }) as ContainerListItem,
    ),
  )

  let vehicleContainerSet: Set<number> | undefined
  if (filters.vehicleContainer) {
    const ids = flattenedRows.map((r) => r.id).filter(Boolean)
    const { data: vehicles } = await supabase
      .from('vehicles')
      .select('container_id')
      .in('container_id', ids.length ? ids : [0])
    vehicleContainerSet = new Set((vehicles ?? []).map((v: { container_id: number }) => v.container_id))
  }

  return applyContainerFilters(flattenedRows, filters, vehicleContainerSet)
}

export function useBlDetail(blId?: string) {
  return useQuery({
    queryKey: queryKeys.bls.detail(blId),
    enabled: Boolean(blId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bls')
        .select(
          `
          *,
          customer:customers!bls_customer_id_fkey(*),
          voyage:voyages(*, vessel:vessels(*, carrier:carriers(*))),
          terminal:depots!bls_terminal_pod_port_fk(id, name),
          bl_containers(*),
          bl_freight_lines(*),
          bl_breakbulk_items(*),
          vehicles(*, container:bl_containers(id, container_number, type, seal_number))
        `,
        )
        .eq('id', blId!)
        .single()

      if (error) throw error
      return supabaseValue<BLDetail>(data)
    },
  })
}

export function useAuditLogs(entityType: string, entityId?: string) {
  return useQuery({
    queryKey: queryKeys.auditLogs.detail(entityType, entityId),
    enabled: Boolean(entityId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('audit_logs')
        .select('*')
        .eq('entity_type', entityType)
        .eq('entity_id', entityId!)
        .order('changed_at', { ascending: false })
        .range(0, 199)

      if (error) throw error
      return (data ?? []) as AuditLog[]
    },
  })
}

export function useVoyageOptions() {
  return useQuery({
    queryKey: queryKeys.voyages.options(),
    queryFn: async () => {
      const query = supabase
        .from('voyages')
        .select('id, voyage_number, vessel:vessels(name)')
        .order('created_at', { ascending: false })
      const allRows: unknown[] = []
      for (let from = 0; ; from += 1000) {
        const { data, error } = await query.range(from, from + 999)
        if (error) throw error
        allRows.push(...(data ?? []))
        if (!data || data.length < 1000) break
      }
      return supabaseRows<{ id: number; voyage_number: string; vessel?: { name: string } | null }>(allRows)
    },
  })
}

export function usePortOptions() {
  return useQuery({
    queryKey: queryKeys.bls.portOptions(),
    // Port codes are stable — refresh only once every 10 minutes
    staleTime: 1000 * 60 * 10,
    queryFn: async () => {
      const pols = new Set<string>()
      const pods = new Set<string>()
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase.from('bls').select('pol, pod').range(from, from + 999)
        if (error) throw error
        for (const row of data ?? []) {
          const pol = String(row.pol ?? '').trim()
          const pod = String(row.pod ?? '').trim()
          if (pol) pols.add(pol)
          if (pod) pods.add(pod)
        }
        if (!data || data.length < 1000) break
      }

      return {
        pols: Array.from(pols).sort((left, right) => left.localeCompare(right, 'pt-BR')),
        pods: Array.from(pods).sort((left, right) => left.localeCompare(right, 'pt-BR')),
      }
    },
  })
}

export function useContainerTypeOptions() {
  return useQuery({
    queryKey: ['container-type-options'],
    staleTime: 1000 * 60 * 10,
    queryFn: async () => {
      const types = new Set<string>()
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase.from('bl_containers').select('type').range(from, from + 999)
        if (error) throw error
        for (const row of data ?? []) {
          const t = String(row.type ?? '').trim().toUpperCase()
          if (t) types.add(t)
        }
        if (!data || data.length < 1000) break
      }

      return Array.from(types).sort((left, right) => left.localeCompare(right, 'pt-BR'))
    },
  })
}

async function fetchOperationalVoyageSummaries() {
  const pageSize = 100
  const rows: OperationalVoyageSummary[] = []
  for (let page = 1; ; page += 1) {
    const result = await listOperationalVoyageSummaries(page, pageSize)
    rows.push(...result.rows)
    if (rows.length >= result.count || result.rows.length < pageSize) break
  }
  return rows
}

export function useVoyages() {
  return useQuery<OperationalVoyageSummary[]>({
    queryKey: ['voyages'],
    queryFn: fetchOperationalVoyageSummaries,
  })
}

export function useVoyageDetail(voyageId?: number | null) {
  return useQuery<VoyageDetail | null>({
    queryKey: queryKeys.voyages.detail(voyageId),
    enabled: Number.isInteger(voyageId) && Number(voyageId) > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('voyages')
        .select(voyageDetailSelect)
        .eq('id', Number(voyageId))
        .single()
      if (error) throw error
      return data as unknown as VoyageDetail
    },
  })
}

function applyBlFilters(query: ReturnType<typeof supabase.from>, filters: BlFilters) {
  let nextQuery = query

  if (filters.search) {
    const term = escapeFilterTerm(filters.search)
    if (term) {
      nextQuery = nextQuery.or(`id.ilike.%${term}%,consignee.ilike.%${term}%`)
    }
  }

  if (filters.voyageId) nextQuery = nextQuery.eq('voyage_id', Number(filters.voyageId))
  if (filters.cargoMode === 'container') nextQuery = nextQuery.in('cargo_mode', ['container', 'misto'])
  else if (filters.cargoMode === 'carga_solta') nextQuery = nextQuery.in('cargo_mode', ['carga_solta', 'misto'])
  else if (filters.cargoMode) nextQuery = nextQuery.eq('cargo_mode', filters.cargoMode)
  if (filters.pol) {
    const pol = escapeFilterTerm(filters.pol)
    if (pol) nextQuery = nextQuery.ilike('pol', `%${pol}%`)
  }
  if (filters.pod) {
    const pod = escapeFilterTerm(filters.pod)
    if (pod) nextQuery = nextQuery.ilike('pod', `%${pod}%`)
  }
  if (filters.reviewStatus) nextQuery = nextQuery.eq('review_status', filters.reviewStatus as NonNullable<BL['review_status']>)
  if (filters.financialStatus) {
    nextQuery = nextQuery.eq('financial_status', filters.financialStatus as NonNullable<BL['financial_status']>)
  }
  if (filters.chargeStatus) {
    nextQuery = nextQuery.eq('charge_status', filters.chargeStatus as NonNullable<BL['charge_status']>)
  }

  return nextQuery
}

function applyCargoProfile(rows: BLListItem[], cargoProfile: string) {
  if (!cargoProfile) {
    return rows
  }

  if (cargoProfile === 'standard') {
    return rows.filter((row) =>
      !(row.bl_containers ?? []).some((container) => container.is_imo || container.is_oog),
    )
  }

  return rows.filter((row) =>
    row.bl_containers?.some((container) => (cargoProfile === 'oog' ? container.is_oog : container.is_imo)),
  )
}

function normalizeChargeStatus(value: string | null | undefined) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
}

function applyContainerFilters(
  rows: ContainerListItem[],
  filters: ContainerFilters,
  vehicleContainerSet?: Set<number>,
) {
  const searchTerm = normalizeText(filters.search)

  return rows.filter((row) => {
    if (filters.cargoProfile === 'oog' && !row.is_oog) return false
    if (filters.cargoProfile === 'imo' && !row.is_imo) return false
    if (filters.containerType && String(row.type ?? '').trim().toUpperCase() !== filters.containerType.trim().toUpperCase()) return false
    if (filters.vehicleContainer === 'true' && !vehicleContainerSet?.has(row.id)) return false
    if (filters.vehicleContainer === 'false' && vehicleContainerSet?.has(row.id)) return false

    if (!searchTerm) return true

    const values = [
      row.container_number,
      row.seal_number,
      row.type,
      row.imo_class,
      row.un_number,
      row.bl?.id,
      row.bl?.consignee,
      row.bl?.customer?.name,
      row.bl?.customer?.cnpj_cpf,
      row.bl?.voyage?.vessel?.name,
      row.bl?.voyage?.vessel?.carrier?.name,
    ]

    return values.some((value) => normalizeText(String(value ?? '')).includes(searchTerm))
  })
}

function toSummaryFilters<TFilters extends { page: number; pageSize: number }>(filters: TFilters) {
  const { page, pageSize, ...summaryFilters } = filters
  void page
  void pageSize
  return summaryFilters
}
