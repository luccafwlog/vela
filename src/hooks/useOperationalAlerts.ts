import { useQuery } from '@tanstack/react-query'
import { countDemurrageRunningBoxes } from '../services/demurrage/demurrageBoard'

export interface OperationalAlerts {
  demurrageOverdue: number
}

export function useOperationalAlerts(): OperationalAlerts {
  // Caixas de Correndo na classificação do banco (ADR 0112, D6; migration 515),
  // as mesmas do cartão Correndo da Demurrage.
  const demurrageOverdue = useQuery({
    queryKey: ['header-alert', 'demurrage-overdue'],
    queryFn: async () => {
      try {
        return await countDemurrageRunningBoxes()
      } catch {
        return 0
      }
    },
    staleTime: 5 * 60_000,
  })

  return {
    demurrageOverdue: demurrageOverdue.data ?? 0,
  }
}
