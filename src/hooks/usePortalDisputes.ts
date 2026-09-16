import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { usePortalAuth } from './usePortalAuth'
import { usePortalScope } from './usePortalScope'
import { portalAddDisputeMessage, portalListDisputes, portalOpenDemurrageDispute, portalRequestDisputeReopen } from '../services/portalBilling'
import { isPortalReadOnly } from '../services/portalScope'

export function usePortalDisputes() {
  const { isAuthenticated } = usePortalAuth()
  const scope = usePortalScope()
  const readOnly = isPortalReadOnly(scope)
  return useQuery({
    queryKey: ['portal-disputes', scope.mode, scope.customerId],
    queryFn: () => portalListDisputes(scope),
    enabled: isAuthenticated || readOnly,
    staleTime: 30_000,
  })
}

export function usePortalOpenDispute() {
  const queryClient = useQueryClient()
  const scope = usePortalScope()
  return useMutation({
    mutationFn: (input: { demurrageInvoiceId: number; reason: string }) =>
      portalOpenDemurrageDispute(input.demurrageInvoiceId, input.reason, scope),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['portal-demurrage-invoices'] })
      queryClient.invalidateQueries({ queryKey: ['portal-demurrage-invoices-page'] })
      queryClient.invalidateQueries({ queryKey: ['portal-disputes'] })
    },
  })
}

export function usePortalAddDisputeMessage() {
  const queryClient = useQueryClient()
  const scope = usePortalScope()
  return useMutation({
    mutationFn: (input: { demurrageInvoiceId: number; body: string }) => portalAddDisputeMessage(input.demurrageInvoiceId, input.body, scope),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['portal-disputes'] })
      void queryClient.invalidateQueries({ queryKey: ['portal-demurrage-invoices'] })
      void queryClient.invalidateQueries({ queryKey: ['portal-demurrage-invoices-page'] })
    },
  })
}

export function usePortalRequestDisputeReopen() {
  const queryClient = useQueryClient()
  const scope = usePortalScope()
  return useMutation({
    mutationFn: (input: { disputeId: number; body: string }) => portalRequestDisputeReopen(input.disputeId, input.body, scope),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['portal-disputes'] }),
  })
}
