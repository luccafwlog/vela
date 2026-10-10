import { useQuery } from '@tanstack/react-query'
import { fetchBaplieVoyageContext } from '../services/baplieImport'

/** Navio, viagem e escalas da Viagem escolhida, para as regras do Baplie (etapa 9). */
export function useBaplieVoyageContext(voyageId: number | null | undefined) {
  return useQuery({
    queryKey: ['baplie-voyage-context', voyageId ?? 0],
    enabled: voyageId != null && voyageId > 0,
    queryFn: () => fetchBaplieVoyageContext(voyageId!),
    staleTime: 60_000,
  })
}
