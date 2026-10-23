import { useQuery } from '@tanstack/react-query'
import { usePagedQuery } from './usePagedQuery'
import { normalizeText } from '../lib/utils'
import { queryKeys } from '../services/queryKeys'
import { supabase } from '../services/supabase'
import {
  fetchOperationalFilterOptions,
  getOperationalBlSummary,
  listOperationalBls,
  listOperationalContainers,
  listOperationalVoyageSummaries,
  type OperationalFilterOptions,
  type OperationalVoyageSummary,
} from '../services/operationalLists'
import type { VoyageDetail } from '../services/voyageReadModels'
import type { AuditLog, BLDetail, BLListItem, ContainerListItem } from '../types/database'

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
    granite_bls(id)
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
    bl_containers(id, container_number, seal_number, type, tare_weight_kg, gross_weight_kg, cbm, is_oog, is_imo, imo_class, un_number, ownership),
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
  /** 'sem': só B/L sem Cliente vinculado (alerta da migration 452). */
  customerLink?: string
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
  const next = { ...filters, page: filters.page + 1 }
  return usePagedQuery({
    queryKey: queryKeys.bls.list(filters),
    queryFn: () => listOperationalBls(filters, filters.page, filters.pageSize),
    nextQueryKey: queryKeys.bls.list(next),
    nextQueryFn: () => listOperationalBls(next, next.page, next.pageSize),
    hasNext: (data) => filters.page * filters.pageSize < data.count,
  })
}

export function useContainers(filters: ContainerFilters) {
  const next = { ...filters, page: filters.page + 1 }
  return usePagedQuery({
    queryKey: queryKeys.bls.containers(filters),
    queryFn: () => listOperationalContainers(filters, filters.page, filters.pageSize),
    nextQueryKey: queryKeys.bls.containers(next),
    nextQueryFn: () => listOperationalContainers(next, next.page, next.pageSize),
    hasNext: (data) => filters.page * filters.pageSize < data.count,
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
 * Materializa lotes sucessivos exclusivamente para fluxos de exportação
 * explícita (CSV/XLSX) disparados manualmente pelo operador.
 *
 * Pagina a MESMA RPC que alimenta a tabela. A versão anterior reimplementava os
 * filtros contra `bls` com uma busca textual mais estreita (só `id` e
 * `consignee`, sem nome nem CNPJ do cliente): buscar por nome de cliente
 * mostrava N linhas na tela e exportava as que casassem por `consignee` —
 * possivelmente zero. Dois dialetos de filtro para o mesmo conjunto é uma
 * divergência que reaparece a cada mudança; agora há um só.
 */
export async function fetchAllBls(filters: BlFilters) {
  const rows: BLListItem[] = []
  // Teto de page_size da RPC, elevado de 100 para 1.000 pela migration 064: com
  // 100, uma viagem de 5.000 B/Ls custava 50 idas ao banco em série, cada uma
  // projetando os filhos inteiros do B/L. 1.000 é o mesmo lote que o caminho
  // antigo usava contra `bls`, antes de os dois dialetos de filtro virarem um.
  const pageSize = 1000

  for (let page = 1; ; page += 1) {
    const result = await listOperationalBls(filters, page, pageSize)
    rows.push(...result.rows)
    if (result.rows.length < pageSize || rows.length >= result.count) break
  }

  return rows
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
    pageSize: 1000,
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
          manifesto_mercante:manifestos_mercante!bls_manifesto_mercante_id_fkey(id, numero),
          bl_containers(*),
          bl_freight_lines(*),
          bl_breakbulk_items(*),
          vehicles(*, container:bl_containers(id, container_number, type, seal_number))
        `,
        )
        .eq('id', blId!)
        // maybeSingle: B/L inexistente é "não encontrado" (null), não erro 406.
        .maybeSingle()

      if (error) throw error
      return data ? supabaseValue<BLDetail>(data) : null
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

// POL, POD e tipos vêm juntos de uma RPC: antes os selects baixavam todos os
// B/Ls e contêineres em páginas de 1.000, uma após a outra (13 + 29 com 12 mil
// B/Ls). Os dois hooks leem a mesma entrada do cache.
function useOperationalFilterOptions<T>(select: (options: OperationalFilterOptions) => T) {
  return useQuery({
    queryKey: queryKeys.bls.portOptions(),
    // Códigos de porto e tipos mudam pouco: relê a cada 10 minutos.
    staleTime: 1000 * 60 * 10,
    queryFn: fetchOperationalFilterOptions,
    select,
  })
}

export function usePortOptions() {
  return useOperationalFilterOptions(({ pols, pods }) => ({ pols, pods }))
}

export function useContainerTypeOptions() {
  return useOperationalFilterOptions(({ containerTypes }) => containerTypes ?? [])
}

async function fetchOperationalVoyageSummaries() {
  const pageSize = 100
  // A primeira página traz o total; as demais vêm juntas, não uma após a outra.
  const first = await listOperationalVoyageSummaries(1, pageSize)
  if (first.rows.length < pageSize || first.rows.length >= first.count) return first.rows
  const rest = await Promise.all(
    Array.from({ length: Math.ceil(first.count / pageSize) - 1 }, (_, index) => listOperationalVoyageSummaries(index + 2, pageSize)),
  )
  return [first, ...rest].flatMap((page): OperationalVoyageSummary[] => page.rows)
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
        // Viagem inexistente ou excluída é "não encontrada" (null), não falha
        // de consulta: `.single()` devolvia 406 e a tela mostrava as duas.
        .maybeSingle()
      if (error) throw error
      return (data ?? null) as unknown as VoyageDetail | null
    },
  })
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
    if (filters.cargoProfile === 'standard' && (row.is_imo || row.is_oog)) return false
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
