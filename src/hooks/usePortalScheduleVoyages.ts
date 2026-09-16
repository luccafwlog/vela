import { useQuery } from '@tanstack/react-query'
import { usePortalAuth } from './usePortalAuth'
import { usePortalScope } from './usePortalScope'
import { fetchPortalScheduleVoyages } from '../services/portalScheduleVoyages'
import { isPortalReadOnly } from '../services/portalScope'

export function usePortalScheduleVoyages() {
  const { isAuthenticated } = usePortalAuth()
  const scope = usePortalScope()
  const readOnly = isPortalReadOnly(scope)

  return useQuery({
    queryKey: ['portal-schedule-voyages', scope.mode, scope.customerId],
    enabled: isAuthenticated || readOnly,
    queryFn: () => fetchPortalScheduleVoyages(scope),
  })
}
