import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { usePortalScope } from './usePortalScope'
import { usePortalAuth } from './usePortalAuth'
import { queryKeys } from '../services/queryKeys'
import { internalGetPortalInformation, internalGetReturnGuidance, internalSavePortalInformation, portalGetInformation, portalGetReturnGuidance, setContainerReturnInstruction, type InformationKind } from '../services/portalInformation'

export function usePortalInformation() {
  const scope = usePortalScope()
  const { isAuthenticated } = usePortalAuth()
  return useQuery({ queryKey: queryKeys.portalInformation.catalog(scope.mode, scope.customerId), queryFn: () => portalGetInformation(scope), refetchOnWindowFocus: true, refetchOnReconnect: true, staleTime: 0, enabled: isAuthenticated || scope.mode === 'inspect' })
}
export function usePortalReturnGuidance(containerId: number | null) {
  const scope = usePortalScope()
  const { isAuthenticated } = usePortalAuth()
  return useQuery({ queryKey: queryKeys.portalInformation.guidance(scope.mode, scope.customerId, containerId), queryFn: () => portalGetReturnGuidance(containerId!, scope), refetchOnWindowFocus: true, refetchOnReconnect: true, staleTime: 0, enabled: containerId != null && (isAuthenticated || scope.mode === 'inspect') })
}
export function useInternalPortalInformation() {
  return useQuery({ queryKey: queryKeys.portalInformation.internal(), queryFn: internalGetPortalInformation, refetchOnWindowFocus: true, refetchOnReconnect: true, staleTime: 0 })
}
export function useInternalReturnGuidance(containerId: number | null) {
  return useQuery({ queryKey: queryKeys.portalInformation.internalGuidance(containerId), queryFn: () => internalGetReturnGuidance(containerId!), refetchOnWindowFocus: true, refetchOnReconnect: true, staleTime: 0, enabled: containerId != null })
}
function useInformationInvalidation() {
  const client = useQueryClient()
  return async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: queryKeys.portalInformation.all() }),
      client.invalidateQueries({ queryKey: ['depots'] }),
      client.invalidateQueries({ queryKey: ['portal-operation-bls'] }),
    ])
  }
}
export function useSavePortalInformation() {
  const invalidate = useInformationInvalidation()
  return useMutation({ mutationFn: ({ kind, data }: { kind: InformationKind; data: Record<string, unknown> }) => internalSavePortalInformation(kind, data), onSuccess: invalidate })
}
export function useSetContainerReturnInstruction() {
  const invalidate = useInformationInvalidation()
  return useMutation({ mutationFn: ({ containerId, depotIds, reason }: { containerId: number; depotIds: string[]; reason: string }) => setContainerReturnInstruction(containerId, depotIds, reason), onSuccess: invalidate })
}
