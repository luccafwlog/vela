import { useQuery } from '@tanstack/react-query'
import { usePortalAuth } from './usePortalAuth'
import { usePortalScope } from './usePortalScope'
import { portalListOperationBls } from '../services/portalOperation'
import { isPortalReadOnly } from '../services/portalScope'

export function usePortalOperationBls() {
  const { isAuthenticated } = usePortalAuth()
  const scope = usePortalScope()
  const readOnly = isPortalReadOnly(scope)

  return useQuery({
    queryKey: ['portal-operation-bls', scope.mode, scope.customerId],
    enabled: isAuthenticated || readOnly,
    queryFn: () => portalListOperationBls(scope),
  })
}
