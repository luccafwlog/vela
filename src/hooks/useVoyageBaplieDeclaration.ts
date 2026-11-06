import { useQuery } from '@tanstack/react-query'
import { fetchVoyageBaplieDeclaration } from '../services/baplieDeclaration'
import { queryKeys } from '../services/queryKeys'

/** Declaração "Viagem sem Baplie" da viagem escolhida (migration 610). */
export function useVoyageBaplieDeclaration(voyageId: number | null | undefined) {
  return useQuery({
    queryKey: queryKeys.baplie.declaration(voyageId ?? 0),
    enabled: voyageId != null && voyageId > 0,
    queryFn: () => fetchVoyageBaplieDeclaration(voyageId!),
  })
}
