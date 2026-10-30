import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { afterReferenciaDemurrageAlterada } from '../services/cacheEffects'
import { queryKeys } from '../services/queryKeys'
import {
  deleteDemurrageRate,
  invalidateDemurrageRatesCache,
  listDemurrageRates,
  toggleDemurrageRateActive,
  upsertDemurrageRate,
} from '../services/demurrage/demurrageRates'
import type { DemurrageRateUpsertInput } from '../services/demurrage/demurrageRateUpsertPayload'
import {
  deleteContainerType,
  listContainerTypes,
  listDemurrageRateGroups,
  saveContainerType,
  toggleContainerTypeActive,
  type ContainerTypeInput,
} from '../services/demurrage/containerTypes'

export function useDemurrageRates() {
  return useQuery({ queryKey: queryKeys.demurrage.rates(), queryFn: listDemurrageRates })
}

export function useDemurrageRateGroups() {
  return useQuery({ queryKey: queryKeys.demurrage.rateGroups(), queryFn: listDemurrageRateGroups, staleTime: 5 * 60 * 1000 })
}

export function useContainerTypes() {
  return useQuery({ queryKey: queryKeys.demurrage.containerTypes(), queryFn: listContainerTypes })
}

function useInvalidateRates() {
  const queryClient = useQueryClient()
  return async () => {
    // O cadastro de tipos muda o grupo de tarifa do cálculo em memória.
    invalidateDemurrageRatesCache()
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.demurrage.rates() }),
      afterReferenciaDemurrageAlterada(queryClient),
    ])
  }
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
    mutationFn: ({ id, active, reason }: { id: number; active: boolean; reason?: string }) => toggleDemurrageRateActive(id, active, reason),
    onSuccess: invalidate,
  })
}

export function useSaveContainerType() {
  const invalidate = useInvalidateRates()
  return useMutation({
    mutationFn: (input: ContainerTypeInput) => saveContainerType(input),
    onSuccess: invalidate,
  })
}

export function useToggleContainerTypeActive() {
  const invalidate = useInvalidateRates()
  return useMutation({
    mutationFn: ({ id, active, reason }: { id: number; active: boolean; reason?: string }) => toggleContainerTypeActive(id, active, reason),
    onSuccess: invalidate,
  })
}

export function useDeleteContainerType() {
  const invalidate = useInvalidateRates()
  return useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) => deleteContainerType(id, reason),
    onSuccess: invalidate,
  })
}
