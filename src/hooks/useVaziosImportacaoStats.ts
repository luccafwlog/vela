import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../services/supabase'
import { normalizePortCode } from '../services/portCode'

export type VoyageVaziosImportacaoPodStat = {
  manifestos: number
  distinctContainers: number
  types: Array<{ label: string; count: number }>
}

export type VoyageVaziosImportacaoRoute = {
  pol: string
  pod: string
  containerCount: number
}

export type VoyageVaziosImportacaoStat = {
  totalManifests: number
  distinctContainers: number
  containerTypes: string
  destinations: string
  byPod: Record<string, VoyageVaziosImportacaoPodStat>
  unassigned?: VoyageVaziosImportacaoPodStat
  routes?: VoyageVaziosImportacaoRoute[]
}

// ponytail: `.in()` com todos os ids vai na URL; com milhares de manifestos o
// pedido pode exceder o limite de URL. Upgrade: RPC de agregação no banco.
const PAGE_SIZE = 1000

export function useVaziosImportacaoStats(voyageIds: number[]) {
  const normalizedIds = useMemo(
    () => Array.from(new Set(voyageIds)).filter((id) => Number.isFinite(id)).sort((a, b) => a - b),
    [voyageIds],
  )

  return useQuery({
    queryKey: ['vazios-importacao-stats', normalizedIds],
    enabled: normalizedIds.length > 0,
    staleTime: 2 * 60 * 1000,
    queryFn: async () => {
      const byVoyageId: Record<number, VoyageVaziosImportacaoStat> = {}

      // PostgREST devolve no máximo PAGE_SIZE linhas por pedido; sem paginar e
      // ordenar por id, Viagens além do limite ficariam com contagem parcial.
      const rows: Array<{ id: string; voyage_id: number | null }> = []
      for (let from = 0; ; from += PAGE_SIZE) {
        const { data: manifests, error: manifestError } = await supabase
          .from('vazios_importacao_manifests')
          .select('id, voyage_id')
          .in('voyage_id', normalizedIds)
          .order('id')
          .range(from, from + PAGE_SIZE - 1)
        if (manifestError) throw manifestError
        const page = (manifests ?? []) as Array<{ id: string; voyage_id: number | null }>
        rows.push(...page)
        if (page.length < PAGE_SIZE) break
      }

      const manifestToVoyage = new Map<string, number>()
      const manifestCountByVoyage = new Map<number, number>()
      for (const row of rows) {
        if (row.voyage_id == null) continue
        manifestToVoyage.set(row.id, row.voyage_id)
        manifestCountByVoyage.set(row.voyage_id, (manifestCountByVoyage.get(row.voyage_id) ?? 0) + 1)
      }

      const manifestIds = Array.from(manifestToVoyage.keys())
      const containersByVoyage = new Map<number, {
        numbers: Set<string>
        types: Map<string, number>
        pods: Set<string>
        byPod: Map<string, { manifestIds: Set<string>; numbers: Set<string>; types: Map<string, number> }>
        byRoute: Map<string, { pol: string; pod: string; numbers: Set<string> }>
        unassigned: { manifestIds: Set<string>; numbers: Set<string>; types: Map<string, number> }
      }>()

      if (manifestIds.length > 0) {
        let from = 0
        while (true) {
          const { data: containers, error: containerError } = await supabase
            .from('vazios_importacao_containers')
            .select('manifest_id, container_number, container_type, pol, pod')
            .in('manifest_id', manifestIds)
            .order('id')
            .range(from, from + PAGE_SIZE - 1)
          if (containerError) throw containerError
          const batch = (containers ?? []) as Array<{ manifest_id: string; container_number: string | null; container_type: string | null; pol?: string | null; pod?: string | null }>
          if (!batch.length) break
          for (const c of batch) {
            const voyageId = manifestToVoyage.get(c.manifest_id)
            if (voyageId == null) continue
            const entry = containersByVoyage.get(voyageId) ?? {
              numbers: new Set(),
              types: new Map(),
              pods: new Set(),
              byPod: new Map(),
              byRoute: new Map(),
              unassigned: { manifestIds: new Set(), numbers: new Set(), types: new Map() },
            }
            const num = String(c.container_number ?? '').trim().toUpperCase()
            if (num) entry.numbers.add(num)
            const type = String(c.container_type ?? '').trim() || 'Nao informado'
            entry.types.set(type, (entry.types.get(type) ?? 0) + 1)
            const pol = normalizePortCode(c.pol) ?? ''
            const pod = normalizePortCode(c.pod) ?? ''
            if (pod) {
              entry.pods.add(pod)
              const podEntry = entry.byPod.get(pod) ?? { manifestIds: new Set(), numbers: new Set(), types: new Map() }
              podEntry.manifestIds.add(c.manifest_id)
              if (num) podEntry.numbers.add(num)
              podEntry.types.set(type, (podEntry.types.get(type) ?? 0) + 1)
              entry.byPod.set(pod, podEntry)

              const routeKey = `${pol || '-'}__${pod}`
              const routeEntry = entry.byRoute.get(routeKey) ?? { pol: pol || '-', pod, numbers: new Set() }
              if (num) routeEntry.numbers.add(num)
              entry.byRoute.set(routeKey, routeEntry)
            } else {
              entry.unassigned.manifestIds.add(c.manifest_id)
              if (num) entry.unassigned.numbers.add(num)
              entry.unassigned.types.set(type, (entry.unassigned.types.get(type) ?? 0) + 1)
            }
            containersByVoyage.set(voyageId, entry)
          }
          if (batch.length < PAGE_SIZE) break
          from += PAGE_SIZE
        }
      }

      for (const voyageId of normalizedIds) {
        const entry = containersByVoyage.get(voyageId)
        const typeEntries = Array.from(entry?.types.entries() ?? [])
          .sort((a, b) => b[1] - a[1])
          .map(([label, count]) => `${label} (${count})`)
        const byPod = Object.fromEntries(
          Array.from(entry?.byPod.entries() ?? []).map(([pod, podEntry]) => [pod, {
            manifestos: podEntry.manifestIds.size,
            distinctContainers: podEntry.numbers.size,
            types: Array.from(podEntry.types.entries())
              .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'pt-BR'))
              .map(([label, count]) => ({ label, count })),
          }]),
        )

        const routes: VoyageVaziosImportacaoRoute[] = Array.from(entry?.byRoute.values() ?? []).map((r) => ({
          pol: r.pol,
          pod: r.pod,
          containerCount: r.numbers.size,
        }))

        const unassigned = entry && entry.unassigned.numbers.size > 0 ? {
          manifestos: entry.unassigned.manifestIds.size,
          distinctContainers: entry.unassigned.numbers.size,
          types: Array.from(entry.unassigned.types.entries())
            .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'pt-BR'))
            .map(([label, count]) => ({ label, count })),
        } : undefined

        byVoyageId[voyageId] = {
          totalManifests: manifestCountByVoyage.get(voyageId) ?? 0,
          distinctContainers: entry?.numbers.size ?? 0,
          containerTypes: typeEntries.join(' | '),
          destinations: Array.from(entry?.pods ?? []).sort((a, b) => a.localeCompare(b, 'pt-BR')).join(' | '),
          byPod,
          routes,
          unassigned,
        }
      }

      return { byVoyageId }
    },
  })
}
