import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { usePortalAuth } from './usePortalAuth'
import { usePortalScope } from './usePortalScope'
import {
  portalCreateConsolidation,
  portalGetCurrentRoe,
  portalGetDemurrageInvoiceDetail,
  portalInvoiceDetails,
  portalListConsolidatableReceivables,
  portalListDemurrageInvoices,
  portalListDemurrageInvoicesPage,
  portalListInvoices,
  portalListInvoicesPage,
  portalObsoleteConsolidation,
} from '../services/portalBilling'
import { EMPTY_PORTAL_BILLING_FILTERS, type PortalBillingFilters } from '../lib/portalBillingFilters'
import { queryKeys } from '../services/queryKeys'
import { isPortalReadOnly } from '../services/portalScope'

export function usePortalCurrentRoe() {
  const { isAuthenticated } = usePortalAuth()
  const scope = usePortalScope()
  const readOnly = isPortalReadOnly(scope)
  return useQuery({
    queryKey: queryKeys.portal.currentRoe(),
    enabled: isAuthenticated || readOnly,
    queryFn: () => portalGetCurrentRoe(scope),
    staleTime: 60 * 60 * 1000,
  })
}

export function usePortalConsolidatableReceivables() {
  const { isAuthenticated } = usePortalAuth()
  const scope = usePortalScope()
  const readOnly = isPortalReadOnly(scope)

  return useQuery({
    queryKey: ['portal-consolidatable-receivables', scope.mode, scope.customerId],
    enabled: isAuthenticated || readOnly,
    queryFn: () => portalListConsolidatableReceivables(scope),
  })
}

export function usePortalInvoices() {
  const { isAuthenticated } = usePortalAuth()
  const scope = usePortalScope()
  const readOnly = isPortalReadOnly(scope)

  return useQuery({
    queryKey: ['portal-invoices', scope.mode, scope.customerId],
    enabled: isAuthenticated || readOnly,
    queryFn: () => portalListInvoices(scope),
  })
}

export function usePortalInvoicesPage(filters: PortalBillingFilters = EMPTY_PORTAL_BILLING_FILTERS, page = 0, pageSize = 25) {
  const { isAuthenticated } = usePortalAuth()
  const scope = usePortalScope()
  const readOnly = isPortalReadOnly(scope)

  return useQuery({
    queryKey: ['portal-invoices-page', scope.mode, scope.customerId, filters, page, pageSize],
    enabled: isAuthenticated || readOnly,
    queryFn: () => portalListInvoicesPage(filters, page, pageSize, scope),
    placeholderData: (previous) => previous,
  })
}

// Fatura aberta na tela e ainda pagável: a baixa automática do Pix Itaú (até
// cerca de 1 min) aparece sem o cliente recarregar a página.
export function refreshWhilePayable(status: string | null | undefined, payable: string[]): number | false {
  return status && payable.includes(status) ? 20_000 : false
}

export function usePortalInvoiceDetail(invoiceId?: number | null) {
  const { isAuthenticated } = usePortalAuth()
  const scope = usePortalScope()
  const readOnly = isPortalReadOnly(scope)

  return useQuery({
    queryKey: ['portal-invoice-detail', scope.mode, scope.customerId, invoiceId],
    enabled: Boolean((isAuthenticated || readOnly) && invoiceId),
    queryFn: () => portalInvoiceDetails(Number(invoiceId), scope),
    refetchInterval: (query) => refreshWhilePayable(query.state.data?.invoice?.status, ['issued', 'partially_paid', 'overdue']),
  })
}

export function usePortalDemurrageInvoices() {
  const { isAuthenticated } = usePortalAuth()
  const scope = usePortalScope()
  const readOnly = isPortalReadOnly(scope)
  // ponytail: refresh is governed by query lifecycle; re-enable Realtime only
  // after demurrage_invoices is explicitly added to supabase_realtime.

  return useQuery({
    queryKey: ['portal-demurrage-invoices', scope.mode, scope.customerId],
    enabled: isAuthenticated || readOnly,
    queryFn: () => portalListDemurrageInvoices(scope),
  })
}

export function usePortalDemurrageInvoicesPage(filters: PortalBillingFilters = EMPTY_PORTAL_BILLING_FILTERS, page = 0, pageSize = 25) {
  const { isAuthenticated } = usePortalAuth()
  const scope = usePortalScope()
  const readOnly = isPortalReadOnly(scope)

  return useQuery({
    queryKey: ['portal-demurrage-invoices-page', scope.mode, scope.customerId, filters, page, pageSize],
    enabled: isAuthenticated || readOnly,
    queryFn: () => portalListDemurrageInvoicesPage(filters, page, pageSize, scope),
    placeholderData: (previous) => previous,
  })
}

export function usePortalDemurrageInvoiceDetail(invoiceId?: number | null) {
  const { isAuthenticated } = usePortalAuth()
  const scope = usePortalScope()
  const readOnly = isPortalReadOnly(scope)
  return useQuery({
    queryKey: ['portal-demurrage-invoice-detail', scope.mode, scope.customerId, invoiceId],
    enabled: Boolean((isAuthenticated || readOnly) && invoiceId),
    queryFn: () => portalGetDemurrageInvoiceDetail(Number(invoiceId), scope),
    refetchInterval: (query) => refreshWhilePayable(query.state.data?.invoice?.status, ['issued', 'overdue']),
  })
}

export function usePortalCreateConsolidation() {
  const queryClient = useQueryClient()
  const { refreshOverview } = usePortalAuth()
  const scope = usePortalScope()

  return useMutation({
    mutationFn: (payload: { receivableIds: number[] }) => portalCreateConsolidation(payload, scope),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['portal-consolidatable-receivables'] }),
        queryClient.invalidateQueries({ queryKey: ['portal-invoices'] }),
        queryClient.invalidateQueries({ queryKey: ['portal-invoices-page'] }),
      ])
      await refreshOverview()
    },
  })
}

export function usePortalObsoleteConsolidation() {
  const queryClient = useQueryClient()
  const { refreshOverview } = usePortalAuth()
  const scope = usePortalScope()

  return useMutation({
    mutationFn: (invoiceId: number) => portalObsoleteConsolidation(invoiceId, scope),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['portal-consolidatable-receivables'] }),
        queryClient.invalidateQueries({ queryKey: ['portal-invoices'] }),
        queryClient.invalidateQueries({ queryKey: ['portal-invoices-page'] }),
      ])
      await refreshOverview()
    },
  })
}
