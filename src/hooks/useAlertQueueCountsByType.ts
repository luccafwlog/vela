import { useQuery } from '@tanstack/react-query'
import { fetchAlertQueueCountsByType } from '../services/alerts'
import { queryKeys } from '../services/queryKeys'

/**
 * Alertas ativos por tipo que a pessoa vê na fila (migration 631): o número de
 * cada cartão do mapa das Regras de alertas. Fica sob o prefixo `alerts`, que
 * toda ação na fila já relê.
 */
export function useAlertQueueCountsByType() {
  return useQuery({
    queryKey: queryKeys.alerts.queueCountsByType(),
    queryFn: fetchAlertQueueCountsByType,
    staleTime: 60_000,
  })
}
