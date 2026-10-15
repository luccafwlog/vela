import { normalizePortCode } from './portCode'
import { supabase } from './supabase'

export type VoyageVehicleStatSlice = {
  totalVehicles: number
  distinctContainerCount: number
  brandSummary: string
  vehicleByContainerTypeSummary: string
}

export type VoyageVehicleStat = VoyageVehicleStatSlice & {
  containerNumbers: string[]
  byPod: Record<string, VoyageVehicleStatSlice>
  unassigned?: VoyageVehicleStatSlice
}

/** [viagem, POD, marca, tipo do contêiner, veículos], valores como gravados. */
export type VoyageVehicleGroup = [number, string | null, string | null, string | null, number]
/** [viagem, POD, número do contêiner], distintos, valores como gravados. */
export type VoyageVehicleContainer = [number, string | null, string]

type Accumulator = {
  totalVehicles: number
  containers: Set<string>
  brands: Map<string, number>
  vehicleByContainerType: Map<string, number>
}

const emptyAccumulator = (): Accumulator => ({
  totalVehicles: 0,
  containers: new Set(),
  brands: new Map(),
  vehicleByContainerType: new Map(),
})

function addCount(target: Map<string, number>, label: string, count: number) {
  target.set(label, (target.get(label) ?? 0) + count)
}

function summarizeCounts(source: Map<string, number>) {
  if (source.size === 0) return '-'
  return Array.from(source.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], 'pt-BR'))
    .slice(0, 6)
    .map(([label, count]) => `${label}: ${count}`)
    .join(' | ')
}

function toSlice(source: Accumulator): VoyageVehicleStatSlice {
  return {
    totalVehicles: source.totalVehicles,
    distinctContainerCount: source.containers.size,
    brandSummary: summarizeCounts(source.brands),
    vehicleByContainerTypeSummary: summarizeCounts(source.vehicleByContainerType),
  }
}

/**
 * Monta os indicadores por viagem a partir dos grupos da migration 287. A
 * normalização (trim, caixa, código de porto) é a mesma que se aplicava a cada
 * veículo; como ela depende só do valor gravado, somar os grupos dá o mesmo
 * resultado que somar as linhas.
 */
export function buildVoyageVehicleStats(
  voyageIds: readonly number[],
  groups: readonly VoyageVehicleGroup[],
  containers: readonly VoyageVehicleContainer[],
): Record<number, VoyageVehicleStat> {
  const working = new Map<number, { all: Accumulator; byPod: Map<string, Accumulator>; unassigned: Accumulator }>()
  const entryFor = (voyageId: number, rawPod: string | null) => {
    const voyage = working.get(voyageId) ?? { all: emptyAccumulator(), byPod: new Map(), unassigned: emptyAccumulator() }
    working.set(voyageId, voyage)
    const pod = normalizePortCode(rawPod)
    if (!pod) return { voyage, slice: voyage.unassigned }
    const slice = voyage.byPod.get(pod) ?? emptyAccumulator()
    voyage.byPod.set(pod, slice)
    return { voyage, slice }
  }

  for (const [voyageId, rawPod, rawBrand, rawType, vehicles] of groups) {
    const count = Number(vehicles)
    const brand = String(rawBrand ?? '').trim() || 'Nao informado'
    const containerType = String(rawType ?? '').trim() || 'Nao informado'
    const { voyage, slice } = entryFor(Number(voyageId), rawPod)
    for (const target of [voyage.all, slice]) {
      target.totalVehicles += count
      addCount(target.brands, brand, count)
      addCount(target.vehicleByContainerType, containerType, count)
    }
  }

  for (const [voyageId, rawPod, rawNumber] of containers) {
    const containerNumber = String(rawNumber ?? '').trim().toUpperCase()
    if (!containerNumber) continue
    const { voyage, slice } = entryFor(Number(voyageId), rawPod)
    voyage.all.containers.add(containerNumber)
    slice.containers.add(containerNumber)
  }

  const byVoyageId: Record<number, VoyageVehicleStat> = {}
  for (const voyageId of voyageIds) {
    const current = working.get(voyageId)
    byVoyageId[voyageId] = {
      ...toSlice(current?.all ?? emptyAccumulator()),
      containerNumbers: Array.from(current?.all.containers ?? []).sort((left, right) => left.localeCompare(right, 'pt-BR')),
      byPod: Object.fromEntries(Array.from(current?.byPod ?? []).map(([pod, slice]) => [pod, toSlice(slice)])),
      unassigned: current && current.unassigned.totalVehicles > 0 ? toSlice(current.unassigned) : undefined,
    }
  }
  return byVoyageId
}

/**
 * Indicadores de veículos das viagens da faixa (Viagens, Veículos) numa
 * chamada só: antes o navegador baixava todo veículo do histórico em páginas
 * de 1.000 para contar (~1,8 MB com 14 mil veículos).
 */
export async function fetchVoyageVehicleStats(voyageIds: readonly number[]) {
  const { data, error } = await supabase.rpc('operational_voyage_vehicle_stats' as never, { p_voyage_ids: voyageIds } as never)
  if (error) throw error
  const payload = (data ?? {}) as { groups?: VoyageVehicleGroup[]; containers?: VoyageVehicleContainer[] }
  return { byVoyageId: buildVoyageVehicleStats(voyageIds, payload.groups ?? [], payload.containers ?? []) }
}
