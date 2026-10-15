import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '../services/queryKeys'
import { fetchActorNames, fetchFullBlTimeline } from '../services/blTimeline'

/** Histórico do B/L inteiro, com o nome de quem fez cada evento. */
export function useBlTimeline(blId?: string) {
  return useQuery({
    queryKey: blId ? queryKeys.bls.timeline(blId) : queryKeys.bls.timeline('nil'),
    enabled: Boolean(blId),
    queryFn: async () => {
      const events = await fetchFullBlTimeline(blId!)
      const actorNames = await fetchActorNames(events.map((event) => event.changed_by))
      return { events, actorNames }
    },
  })
}

/** Nomes de quem criou os comunicados do B/L, para a coluna "Por". */
export function useActorNames(ids: Array<string | null | undefined>) {
  const unique = Array.from(new Set(ids.filter((id): id is string => Boolean(id)))).sort()
  return useQuery({
    queryKey: ['actor-names', ...unique],
    enabled: unique.length > 0,
    queryFn: () => fetchActorNames(unique),
  })
}
