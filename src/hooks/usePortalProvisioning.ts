import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { listPortalProvisioningEvents, listPortalProvisioningQueue, assistedPortalEmailChange, releaseSuppressedEmail, returnToAnalysis, sendPortalInvite, suspendPortalAccount, type RecoveryEmailSource } from '../services/portalProvisioning'
import { supabase } from '../services/supabase'
import { queryKeys } from '../services/queryKeys'

export const PORTAL_PROVISIONING_QUERY_KEY = ['portal-provisioning'] as const

export function usePortalProvisioning(enabled = true) {
  return useQuery({ queryKey: PORTAL_PROVISIONING_QUERY_KEY, queryFn: () => listPortalProvisioningQueue(), enabled })
}

export function usePortalProvisioningForCustomer(customerId: number | null) {
  return useQuery({
    queryKey: [...PORTAL_PROVISIONING_QUERY_KEY, 'customer', customerId],
    enabled: customerId !== null,
    queryFn: () => listPortalProvisioningQueue(customerId!),
    select: (rows) => rows[0],
  })
}

export function usePortalEvents(customerId: number | null, enabled = true) {
  return useQuery({
    queryKey: [...PORTAL_PROVISIONING_QUERY_KEY, 'events', customerId],
    enabled: Boolean(customerId) && enabled,
    queryFn: () => listPortalProvisioningEvents(customerId!),
  })
}

export function useReturnToAnalysis() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ customerId, reason }: { customerId: number; reason: string }) => returnToAnalysis(customerId, reason),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: PORTAL_PROVISIONING_QUERY_KEY }),
  })
}

function invalidatePortalQueries(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: PORTAL_PROVISIONING_QUERY_KEY })
  void queryClient.invalidateQueries({ queryKey: ['customer-detail'] })
  // A ficha do B/L lê o gate do Portal do status do Portal (migration 501), e a
  // Revisão mostra a pendência de acesso: a conta mudou, os dois releem.
  void queryClient.invalidateQueries({ queryKey: queryKeys.portal.blStatus() })
  void queryClient.invalidateQueries({ queryKey: ['review-queue'] })
}

export function useSendPortalInvite() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ customerId, recoveryEmail, source }: { customerId: number; recoveryEmail: string; source: RecoveryEmailSource }) => {
      await sendPortalInvite(customerId, recoveryEmail, source)
    },
    onSuccess: () => invalidatePortalQueries(queryClient),
  })
}

export function useCancelPortalInvite() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ customerId, reason }: { customerId: number; reason: string }) => { const { error } = await supabase.rpc('portal_cancel_invite', { p_customer_id: customerId, p_reason: reason }); if (error) throw error },
    onSuccess: () => invalidatePortalQueries(queryClient),
  })
}

export function useSuspendPortalAccount() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ customerId, action, reason }: { customerId: number; action: 'suspend' | 'reactivate'; reason: string }) => suspendPortalAccount(customerId, action, reason),
    onSuccess: () => invalidatePortalQueries(queryClient),
  })
}

export function useAssistedEmailChange() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ customerId, email, reason }: { customerId: number; email: string; reason: string }) => assistedPortalEmailChange(customerId, email, reason),
    onSuccess: () => invalidatePortalQueries(queryClient),
  })
}

export function useReleaseSuppressedEmail() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ customerId, email, reason }: { customerId: number; email: string; reason: string }) => releaseSuppressedEmail(customerId, email, reason),
    onSuccess: () => invalidatePortalQueries(queryClient),
  })
}

export function useAdminChangeCnpj() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ customerId, cnpj, reason }: { customerId: number; cnpj: string; reason: string }) => { const { error } = await supabase.rpc('portal_admin_change_cnpj', { p_customer_id: customerId, p_new_cnpj: cnpj, p_reason: reason }); if (error) throw error },
    onSuccess: () => invalidatePortalQueries(queryClient),
  })
}
