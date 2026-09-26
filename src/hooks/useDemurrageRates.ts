import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '../services/queryKeys'
import {
  deleteDemurrageRate,
  listDemurrageRates,
  toggleDemurrageRateActive,
  upsertDemurrageRate,
} from '../services/demurrage/demurrageRates'
import type { DemurrageRateUpsertInput } from '../services/demurrage/demurrageRateUpsertPayload'

export function useDemurrageRates() {
  return useQuery({ queryKey: queryKeys.demurrage.rates(), queryFn: listDemurrageRates })
}

function useInvalidateRates() {
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries({ queryKey: queryKeys.demurrage.rates() })
}

export function useSaveDemurrageRate() {
  const invalidate = useInvalidateRates()
  return useMutation({
    mutationFn: (rate: DemurrageRateUpsertInput) => upsertDemurrageRate(rate),
    onSuccess: invalidate,
  })
}

export function useDeleteDemurrageRate() {
  const invalidate = useInvalidateRates()
  return useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) => deleteDemurrageRate(id, reason),
    onSuccess: invalidate,
  })
}

export function useToggleDemurrageRateActive() {
  const invalidate = useInvalidateRates()
  return useMutation({
    mutationFn: ({ id, active }: { id: number; active: boolean }) => toggleDemurrageRateActive(id, active),
    onSuccess: invalidate,
  })
}
