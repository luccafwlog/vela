import { useQuery } from '@tanstack/react-query'
import { fetchEscalasSemTerminal } from '../services/escalaTerminalPendente'
import { queryKeys } from '../services/queryKeys'

/**
 * Frentes sem terminal das escalas destas Viagens (migration 584). Gravar
 * Editar escala (`afterEscalaAlterada`) e importar carga (efeitos de carga)
 * invalidam a família.
 */
export function useEscalasSemTerminal(voyageIds: readonly number[]) {
  const ids = [...new Set(voyageIds)].sort((a, b) => a - b)
  return useQuery({
    queryKey: queryKeys.voyages.escalasSemTerminal(ids),
    enabled: ids.length > 0,
    staleTime: 30_000,
    queryFn: () => fetchEscalasSemTerminal(ids),
  })
}
