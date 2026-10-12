import { useQuery } from '@tanstack/react-query'
import { fetchBaplieVoyageContext } from '../services/baplieImport'
import { queryKeys } from '../services/queryKeys'

/**
 * Navio, viagem e escalas da Viagem escolhida, para as regras do Baplie (etapa 9).
 * Quem importa usa `baplieVoyageContextBlock`: sem este contexto, a importação
 * fica bloqueada.
 */
export function useBaplieVoyageContext(voyageId: number | null | undefined) {
  return useQuery({
    queryKey: queryKeys.baplie.voyageContext(voyageId ?? 0),
    enabled: voyageId != null && voyageId > 0,
    queryFn: () => fetchBaplieVoyageContext(voyageId!),
    staleTime: 60_000,
  })
}
