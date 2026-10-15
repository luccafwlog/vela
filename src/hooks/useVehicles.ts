import { useMemo } from 'react'
import { useQuery, type QueryClient } from '@tanstack/react-query'
import { supabase } from '../services/supabase'
import { queryKeys } from '../services/queryKeys'
import { mapChunks, sanitizeLikeTerm } from '../lib/utils'
import type { BLContainer, VehicleListItem } from '../types/database'
import { normalizePortCode } from '../services/portCode'

type VehicleListItemWithUnpackingLocation = Omit<VehicleListItem, 'container'> & {
  container?: Pick<BLContainer, 'id' | 'container_number' | 'type' | 'seal_number' | 'unpacking_location'> | null
}

/**
 * Aplica no cache da lista de veículos o local de desova já gravado, antes da
 * releitura. O cache guarda as linhas cruas da viagem (página e filtros locais
 * saem do `select` de `useVehicles`), então quem escreve nele precisa passar
 * por aqui, não pelo formato que a tela recebe.
 */
export function cacheUnpackingLocation(queryClient: QueryClient, containerIds: readonly number[], value: string | null) {
  const ids = new Set(containerIds)
  queryClient.setQueriesData<VehicleListItemWithUnpackingLocation[]>({ queryKey: queryKeys.vehicles.all() }, (cached) => (
    Array.isArray(cached)
      ? cached.map((row) => row.container && ids.has(row.container.id)
        ? { ...row, container: { ...row.container, unpacking_location: value } }
        : row)
      : cached
  ))
}

/** Filtro de desova que pede os containers ainda sem local. */
export const UNPACKING_LOCATION_NONE = '__none__'

/**
 * Veículos por Local de desova, com "Nao informado" para container sem local.
 * O local é do container: veículo sem container não tem local a informar e fica
 * fora da contagem, como no filtro UNPACKING_LOCATION_NONE.
 */
export function countVehiclesByUnpackingLocation(
  rows: readonly { container?: { unpacking_location?: string | null } | null }[],
): { label: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const row of rows) {
    if (!row.container) continue
    const label = String(row.container.unpacking_location ?? '').trim() || 'Nao informado'
    counts.set(label, (counts.get(label) ?? 0) + 1)
  }
  return Array.from(counts, ([label, count]) => ({ label, count }))
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label, 'pt-BR'))
}

export type VehiclePageFilters = {
  search: string
  brand: string
  model: string
  container: string
  containerType: string
  seal: string
  bl: string
  unpackingLocation: string
  page: number
  pageSize: number
}

export type VoyageVehicleStat = {
  totalVehicles: number
  distinctContainerCount: number
  containerNumbers: string[]
  brandSummary: string
  vehicleByContainerTypeSummary: string
  byPod: Record<string, {
    totalVehicles: number
    distinctContainerCount: number
    brandSummary: string
    vehicleByContainerTypeSummary: string
  }>
  unassigned?: {
    totalVehicles: number
    distinctContainerCount: number
    brandSummary: string
    vehicleByContainerTypeSummary: string
  }
}

export function useVehicleOptions() {
  return useQuery({
    queryKey: ['vehicle-voyage-options'],
    queryFn: async () => {
      const voyages: Array<{ id: number; voyage_number: string; vessel?: { id: number; name: string } | null }> = []
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase
          .from('voyages')
          .select('id, voyage_number, vessel:vessels(id, name)')
          .order('created_at', { ascending: false })
          .range(from, from + 999)
        if (error) throw error
        voyages.push(...((data ?? []) as unknown as Array<{ id: number; voyage_number: string; vessel?: { id: number; name: string } | null }>))
        if (!data || data.length < 1000) break
      }

      const normalizedVoyages = voyages as Array<{
        id: number
        voyage_number: string
        vessel?: { id: number; name: string } | null
      }>

      const vesselMap = new Map<number, { id: number; name: string }>()
      for (const voyage of normalizedVoyages) {
        if (voyage.vessel?.id && voyage.vessel.name) {
          vesselMap.set(voyage.vessel.id, { id: voyage.vessel.id, name: voyage.vessel.name })
        }
      }

      return {
        vessels: Array.from(vesselMap.values()).sort((left, right) => left.name.localeCompare(right.name, 'pt-BR')),
        voyages: normalizedVoyages,
      }
    },
  })
}

export function useVehicles(voyageId: number | null, filters: VehiclePageFilters) {
  // A leitura traz todos os veículos da viagem que passam nos filtros do
  // servidor. Página e filtros de container, B/L e local de desova são
  // recortados do cache em `select`: trocar de página ou digitar nesses campos
  // não refaz a leitura (antes cada "Próxima" rebaixava a viagem inteira).
  const { search, brand, model, containerType, seal } = filters
  const serverFilters = { search, brand, model, containerType, seal }
  const listQuery = useQuery({
    queryKey: ['vehicles', voyageId, serverFilters],
    enabled: Boolean(voyageId),
    // Mantém as linhas na troca de filtro; outra viagem começa do esqueleto.
    placeholderData: (previous, previousQuery) => (previousQuery?.queryKey[1] === voyageId ? previous : undefined),
    queryFn: async () => {
      let q = supabase
        .from('vehicles')
        .select(
          `
          *,
          container:bl_containers!inner(id, container_number, type, seal_number, unpacking_location),
          bl:bls(id, voyage_id, voyage:voyages(id, voyage_number, vessel:vessels(id, name)))
        `,
        )
        .eq('voyage_id', voyageId!)
        .order('created_at', { ascending: false })

      if (search) {
        const term = sanitizeLikeTerm(search)
        if (term) q = q.ilike('chassis', `%${term}%`)
      }
      if (brand) {
        const term = sanitizeLikeTerm(brand)
        if (term) q = q.ilike('brand', `%${term}%`)
      }
      if (model) {
        const term = sanitizeLikeTerm(model)
        if (term) q = q.ilike('model', `%${term}%`)
      }
      if (containerType) {
        const term = sanitizeLikeTerm(containerType)
        if (term) q = q.ilike('container.type', `%${term}%`)
      }
      if (seal) {
        const term = sanitizeLikeTerm(seal)
        if (term) q = q.ilike('container.seal_number', `%${term}%`)
      }

      const allData: unknown[] = []
      for (let from = 0; ; from += 1000) {
        const { data, error } = await q.range(from, from + 999)
        if (error) throw error
        allData.push(...(data ?? []))
        if (!data || data.length < 1000) break
      }
      return allData as VehicleListItemWithUnpackingLocation[]
    },
    // PostgREST não aplica ilike em colunas de joins aninhados; esses filtros
    // rodam sobre as linhas já carregadas.
    select: (allRows) => {
      let rows = allRows
      if (filters.container) {
        const term = filters.container.toLowerCase()
        rows = rows.filter((r) => (r.container?.container_number ?? '').toLowerCase().includes(term))
      }
      if (filters.bl) {
        const term = filters.bl.toLowerCase()
        rows = rows.filter((r) => (r.bl?.id ?? '').toLowerCase().includes(term))
      }
      if (filters.unpackingLocation === UNPACKING_LOCATION_NONE) {
        rows = rows.filter((r) => r.container && !(r.container.unpacking_location ?? '').trim())
      } else if (filters.unpackingLocation) {
        const term = filters.unpackingLocation.toLowerCase()
        rows = rows.filter((r) => (r.container?.unpacking_location ?? '').toLowerCase().includes(term))
      }

      const rangeFrom = (filters.page - 1) * filters.pageSize
      return {
        rows: rows.slice(rangeFrom, rangeFrom + filters.pageSize),
        count: rows.length,
        allIds: rows.map((row) => row.id),
        containerIdByVehicleId: Object.fromEntries(rows.map((row) => [row.id, row.container?.id ?? null])),
      }
    },
  })

  // Estatísticas ignoram os filtros da lista para alimentar os cards de resumo.
  const statsQuery = useQuery({
    queryKey: ['vehicle-stats', voyageId],
    enabled: Boolean(voyageId),
    queryFn: async () => {
      const batchSize = 1000
      const rows: VehicleListItem[] = []
      let from = 0

      while (true) {
        const { data, error } = await supabase
          .from('vehicles')
          .select('id, brand, model, weight_kg, cbm, container:bl_containers(id, container_number, type, unpacking_location), bl:bls(id)')
          .eq('voyage_id', voyageId!)
          .order('id', { ascending: true })
          .range(from, from + batchSize - 1)

        if (error) throw error
        const batch = (data ?? []) as unknown as VehicleListItem[]
        if (!batch.length) break
        rows.push(...batch)
        if (batch.length < batchSize) break
        from += batchSize
      }

      return rows
    },
  })

  const stats = useMemo(() => {
    const all = statsQuery.data ?? []
    const brandMap = new Map<string, number>()
    const modelMap = new Map<string, number>()
    const vehicleTypeMap = new Map<string, number>()
    const containerTypeMap = new Map<string, Set<string>>()

    for (const row of all) {
      const brand = String(row.brand ?? '').trim() || 'Nao informado'
      brandMap.set(brand, (brandMap.get(brand) ?? 0) + 1)

      const model = String(row.model ?? '').trim() || 'Nao informado'
      modelMap.set(model, (modelMap.get(model) ?? 0) + 1)

      const containerType = String(row.container?.type ?? '').trim() || 'Nao informado'
      vehicleTypeMap.set(containerType, (vehicleTypeMap.get(containerType) ?? 0) + 1)

      const containerNumber = String(row.container?.container_number ?? '').trim().toUpperCase()
      const currentSet = containerTypeMap.get(containerType) ?? new Set<string>()
      if (containerNumber) currentSet.add(containerNumber)
      containerTypeMap.set(containerType, currentSet)
    }

    return {
      totalWeightKg: all.reduce((sum, row) => sum + Number(row.weight_kg ?? 0), 0),
      totalCbm: all.reduce((sum, row) => sum + Number(row.cbm ?? 0), 0),
      distinctContainerCount: new Set(all.map((row) => row.container?.container_number).filter(Boolean)).size,
      distinctBlCount: new Set(all.map((row) => row.bl?.id).filter(Boolean)).size,
      vehiclesByBrand: Array.from(brandMap.entries())
        .map(([label, count]) => ({ label, count }))
        .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label, 'pt-BR')),
      vehiclesByModel: Array.from(modelMap.entries())
        .map(([label, count]) => ({ label, count }))
        .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label, 'pt-BR')),
      vehiclesByContainerType: Array.from(vehicleTypeMap.entries())
        .map(([label, count]) => ({ label, count }))
        .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label, 'pt-BR')),
      // A consulta de estatísticas lê `unpacking_location`; o tipo de lista não o nomeia.
      unpackingLocations: countVehiclesByUnpackingLocation(all as VehicleListItemWithUnpackingLocation[]),
      containersByContainerType: Array.from(containerTypeMap.entries())
        .map(([label, numbers]) => ({ label, count: numbers.size }))
        .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label, 'pt-BR')),
      vehicleCountByContainerId: all.reduce<Record<number, number>>((counts, row) => {
        if (row.container?.id != null) counts[row.container.id] = (counts[row.container.id] ?? 0) + 1
        return counts
      }, {}),
    }
  }, [statsQuery.data])

  return {
    isLoading: listQuery.isLoading || statsQuery.isLoading,
    error: listQuery.error ?? statsQuery.error,
    data: {
      rows: listQuery.data?.rows ?? [],
      count: listQuery.data?.count ?? 0,
      filteredIds: listQuery.data?.allIds ?? [],
      containerIdByVehicleId: listQuery.data?.containerIdByVehicleId ?? {},
      ...stats,
    },
  }
}

export function useVoyageVehicleStats(voyageIds: number[]) {
  const normalizedVoyageIds = useMemo(
    () => Array.from(new Set(voyageIds)).filter((id) => Number.isFinite(id)).sort((left, right) => left - right),
    [voyageIds],
  )

  return useQuery({
    queryKey: ['voyage-vehicle-stats', normalizedVoyageIds],
    enabled: normalizedVoyageIds.length > 0,
    queryFn: async () => {
      const batchSize = 1000
      const byVoyageId: Record<number, VoyageVehicleStat> = {}
      const working = new Map<
        number,
        {
          totalVehicles: number
          containers: Set<string>
          brands: Map<string, number>
          vehicleByContainerType: Map<string, number>
          byPod: Map<string, { totalVehicles: number; containers: Set<string>; brands: Map<string, number>; vehicleByContainerType: Map<string, number> }>
          unassigned: { totalVehicles: number; containers: Set<string>; brands: Map<string, number>; vehicleByContainerType: Map<string, number> }
        }
      >()

      type VehicleStatRow = {
        id: number
        voyage_id: number
        brand: string | null
        container?: { container_number?: string | null; type?: string | null } | null
        bl?: { pod?: string | null } | null
      }
      const readPage = async (voyageChunk: number[], from: number, withCount = false) => {
        const { data, error, count } = await supabase
          .from('vehicles')
          .select('id, voyage_id, brand, container:bl_containers(container_number, type), bl:bls!inner(pod)', withCount ? { count: 'exact' } : undefined)
          .in('voyage_id', voyageChunk)
          .order('id', { ascending: true })
          .range(from, from + batchSize - 1)
        if (error) throw error
        return { rows: (data ?? []) as VehicleStatRow[], count: count ?? 0 }
      }
      // O total da primeira página dá as demais, lidas juntas em vez de uma
      // após a outra (14 mil veículos eram 15 esperas em série).
      const allRows = await mapChunks(normalizedVoyageIds, 200, async (voyageChunk) => {
        const first = await readPage(voyageChunk, 0, true)
        const pageCount = Math.ceil(first.count / batchSize)
        const pages = [first, ...await Promise.all(
          Array.from({ length: Math.max(0, pageCount - 1) }, (_, index) => readPage(voyageChunk, (index + 1) * batchSize)),
        )]
        // Veículo gravado depois da contagem: segue lendo até a página curta.
        for (let from = pageCount * batchSize; pages[pages.length - 1].rows.length === batchSize; from += batchSize) {
          pages.push(await readPage(voyageChunk, from))
        }
        return pages.flatMap((page) => page.rows)
      })

      for (const row of allRows) {
        const current =
          working.get(row.voyage_id) ??
          {
            totalVehicles: 0,
            containers: new Set<string>(),
            brands: new Map<string, number>(),
            vehicleByContainerType: new Map<string, number>(),
            byPod: new Map(),
            unassigned: {
              totalVehicles: 0,
              containers: new Set<string>(),
              brands: new Map<string, number>(),
              vehicleByContainerType: new Map<string, number>(),
            },
          }

        current.totalVehicles += 1

        const brand = String(row.brand ?? '').trim() || 'Nao informado'
        current.brands.set(brand, (current.brands.get(brand) ?? 0) + 1)

        const containerType = String(row.container?.type ?? '').trim() || 'Nao informado'
        current.vehicleByContainerType.set(
          containerType,
          (current.vehicleByContainerType.get(containerType) ?? 0) + 1,
        )

        const containerNumber = String(row.container?.container_number ?? '').trim().toUpperCase()
        if (containerNumber) {
          current.containers.add(containerNumber)
        }

        const pod = normalizePortCode(row.bl?.pod)
        if (pod) {
          const podEntry = current.byPod.get(pod) ?? {
            totalVehicles: 0,
            containers: new Set<string>(),
            brands: new Map<string, number>(),
            vehicleByContainerType: new Map<string, number>(),
          }
          podEntry.totalVehicles += 1
          podEntry.brands.set(brand, (podEntry.brands.get(brand) ?? 0) + 1)
          podEntry.vehicleByContainerType.set(containerType, (podEntry.vehicleByContainerType.get(containerType) ?? 0) + 1)
          if (containerNumber) podEntry.containers.add(containerNumber)
          current.byPod.set(pod, podEntry)
        } else {
          current.unassigned.totalVehicles += 1
          current.unassigned.brands.set(brand, (current.unassigned.brands.get(brand) ?? 0) + 1)
          current.unassigned.vehicleByContainerType.set(containerType, (current.unassigned.vehicleByContainerType.get(containerType) ?? 0) + 1)
          if (containerNumber) current.unassigned.containers.add(containerNumber)
        }

        working.set(row.voyage_id, current)
      }

      for (const voyageId of normalizedVoyageIds) {
        const current = working.get(voyageId)
        const byPod = Object.fromEntries(
          Array.from(current?.byPod.entries() ?? []).map(([pod, podEntry]) => [pod, {
            totalVehicles: podEntry.totalVehicles,
            distinctContainerCount: podEntry.containers.size,
            brandSummary: summarizeCounts(podEntry.brands),
            vehicleByContainerTypeSummary: summarizeCounts(podEntry.vehicleByContainerType),
          }]),
        )

        const unassigned = current && current.unassigned.totalVehicles > 0 ? {
          totalVehicles: current.unassigned.totalVehicles,
          distinctContainerCount: current.unassigned.containers.size,
          brandSummary: summarizeCounts(current.unassigned.brands),
          vehicleByContainerTypeSummary: summarizeCounts(current.unassigned.vehicleByContainerType),
        } : undefined

        byVoyageId[voyageId] = {
          totalVehicles: current?.totalVehicles ?? 0,
          distinctContainerCount: current?.containers.size ?? 0,
          containerNumbers: current ? Array.from(current.containers).sort((left, right) => left.localeCompare(right, 'pt-BR')) : [],
          brandSummary: summarizeCounts(current?.brands),
          vehicleByContainerTypeSummary: summarizeCounts(current?.vehicleByContainerType),
          byPod,
          unassigned,
        }
      }

      return { byVoyageId }
    },
  })
}

function summarizeCounts(source?: Map<string, number>) {
  if (!source || source.size === 0) return '-'

  return Array.from(source.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], 'pt-BR'))
    .slice(0, 6)
    .map(([label, count]) => `${label}: ${count}`)
    .join(' | ')
}
