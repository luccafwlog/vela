import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { usePortalAuth } from './usePortalAuth'
import { usePortalScope } from './usePortalScope'
import {
  portalListNotifications,
  portalMarkAllNotificationsRead,
  portalMarkNotificationRead,
  portalNotificationUnreadCount,
} from '../services/portalBilling'
import { isPortalReadOnly } from '../services/portalScope'

export function usePortalUnreadCount() {
  const { isAuthenticated } = usePortalAuth()
  const scope = usePortalScope()
  const readOnly = isPortalReadOnly(scope)

  return useQuery({
    queryKey: ['portal-unread-count', scope.mode, scope.customerId],
    enabled: Boolean(isAuthenticated || readOnly),
    refetchInterval: 30_000,
    queryFn: () => portalNotificationUnreadCount(scope),
  })
}

export function usePortalNotifications(enabled = true) {
  const { isAuthenticated } = usePortalAuth()
  const scope = usePortalScope()
  const readOnly = isPortalReadOnly(scope)

  return useQuery({
    queryKey: ['portal-notifications', scope.mode, scope.customerId],
    enabled: Boolean((isAuthenticated || readOnly) && enabled),
    refetchInterval: 30_000,
    queryFn: () => portalListNotifications(scope),
  })
}

export function usePortalMarkRead() {
  const queryClient = useQueryClient()
  const scope = usePortalScope()
  return useMutation({
    mutationFn: (id: number) => portalMarkNotificationRead(id, scope),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['portal-notifications'] })
      queryClient.invalidateQueries({ queryKey: ['portal-unread-count'] })
    },
  })
}

export function usePortalMarkAllRead() {
  const queryClient = useQueryClient()
  const scope = usePortalScope()
  return useMutation({
    mutationFn: () => portalMarkAllNotificationsRead(scope),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['portal-notifications'] })
      queryClient.invalidateQueries({ queryKey: ['portal-unread-count'] })
    },
  })
}
