import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '../services/queryKeys'
import { afterLiberacaoFaturamentoPortal } from '../services/cacheEffects'
import { fetchLatestBillingPortalRelease, grantBillingPortalRelease, revokeBillingPortalRelease } from '../services/billingPortalRelease'

export function useBillingPortalRelease(customerId: number | null) {
  return useQuery({
    queryKey: queryKeys.customerFicha.billingPortalRelease(customerId ?? 0),
    enabled: customerId !== null,
    queryFn: () => fetchLatestBillingPortalRelease(customerId!),
  })
}

export function useGrantBillingPortalRelease() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: grantBillingPortalRelease,
    onSuccess: (_data, input) => afterLiberacaoFaturamentoPortal(queryClient, { customerId: input.customerId }),
  })
}

export function useRevokeBillingPortalRelease() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: revokeBillingPortalRelease,
    onSuccess: (_data, input) => afterLiberacaoFaturamentoPortal(queryClient, { customerId: input.customerId }),
  })
}
