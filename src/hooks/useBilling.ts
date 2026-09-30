import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  addManualInvoiceCharge,
  cancelInvoice,
  createManualInvoice,
  deleteManualInvoiceCharge,
  listBillingCustomers,
  listInvoiceDetails,
  listInvoiceLinksByBls,
  listInvoices,
  registerInvoicePayment,
  type InvoiceFilters,
} from '../services/billing'
import { queryKeys } from '../services/queryKeys'
import { pixSimulationRefetchInterval, usePixSimulationRefresh } from './usePixSimulationRefresh'

export function useInvoices(filters: InvoiceFilters) {
  return useQuery({
    queryKey: queryKeys.invoices.list(filters),
    queryFn: () => listInvoices(filters),
  })
}

export function useInvoiceDetail(invoiceId?: number | null) {
  const query = useQuery({
    queryKey: queryKeys.invoices.detail(invoiceId),
    enabled: Boolean(invoiceId),
    queryFn: () => listInvoiceDetails(Number(invoiceId)),
    refetchInterval: (current) => pixSimulationRefetchInterval(current.state.data?.invoice?.pix_integration_state),
  })
  usePixSimulationRefresh(query.data?.invoice)
  return query
}
export function useInvoiceLinks(blIds: string[]) {
  return useQuery({
    queryKey: queryKeys.invoices.links(blIds),
    enabled: blIds.length > 0,
    queryFn: () => listInvoiceLinksByBls(blIds),
  })
}

export function useBillingCustomers(search: string) {
  return useQuery({
    queryKey: queryKeys.billingReady.customers(search),
    queryFn: () => listBillingCustomers(search),
  })
}

export function useCreateManualInvoice() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: createManualInvoice,
    onSuccess: async (data, variables) => {
      const invalidations = [
        queryClient.invalidateQueries({ queryKey: queryKeys.invoices.all() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.invoices.detail(data.invoice_id) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.reconciliation.history() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.bls.all() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.customers.all() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.customers.detail() }),
      ]

      if (variables.blId) {
        invalidations.push(queryClient.invalidateQueries({ queryKey: queryKeys.invoices.links([variables.blId]) }))
      }
      if (variables.customerId) {
        invalidations.push(queryClient.invalidateQueries({ queryKey: queryKeys.customerFicha.receivables(variables.customerId) }))
      }

      await Promise.all(invalidations)
    },
  })
}

export function useRegisterInvoicePayment() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: registerInvoicePayment,
    onSuccess: async (_data, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.invoices.all() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.invoices.detail(variables.invoiceId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.bls.all() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.customers.all() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.customers.detail() }),
      ])
    },
  })
}

export function useAddManualInvoiceCharge() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: addManualInvoiceCharge,
    onSuccess: async (_data, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.invoices.all() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.invoices.detail(variables.invoiceId) }),
      ])
    },
  })
}

export function useDeleteManualInvoiceCharge(invoiceId?: number | null) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: deleteManualInvoiceCharge,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.invoices.all() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.invoices.detail(invoiceId) }),
      ])
    },
  })
}

export function useCancelInvoice() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: cancelInvoice,
    onSuccess: async (_data, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.invoices.all() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.invoices.detail(variables.invoiceId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.billingReady.all() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.bls.all() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.customers.all() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.customers.detail() }),
      ])
    },
  })
}
