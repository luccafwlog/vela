import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  cancelInvoice,
  cancelInvoiceForReissue,
  createManualInvoice,
  getInvoiceReissueLinks,
  listPendingReissues,
  listBillingCustomers,
  listInvoiceDetails,
  listInvoiceLinksByBls,
  listInvoices,
  registerInvoicePayment,
  type InvoiceFilters,
} from '../services/billing'
import { queryKeys } from '../services/queryKeys'

export function useInvoices(filters: InvoiceFilters) {
  return useQuery({
    queryKey: queryKeys.invoices.list(filters),
    queryFn: () => listInvoices(filters),
  })
}

export function useInvoiceDetail(invoiceId?: number | null) {
  return useQuery({
    queryKey: queryKeys.invoices.detail(invoiceId),
    enabled: Boolean(invoiceId),
    queryFn: () => listInvoiceDetails(Number(invoiceId)),
  })
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

export function useInvoiceReissueLinks(invoiceId?: number | null) {
  return useQuery({
    queryKey: queryKeys.invoices.reissueLinks(invoiceId),
    enabled: Boolean(invoiceId),
    queryFn: () => getInvoiceReissueLinks(Number(invoiceId)),
  })
}

export function usePendingReissues() {
  return useQuery({
    queryKey: queryKeys.invoices.pendingReissues(),
    queryFn: listPendingReissues,
  })
}

export function useCancelInvoiceForReissue() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: cancelInvoiceForReissue,
    onSuccess: async (data) => {
      // queryKeys.invoices.all() cobre a lista e a Reemissão pendente; o detalhe
      // de cada fatura cancelada (inclusive individuais da consolidada) muda.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.invoices.all() }),
        ...data.cancelled_invoice_ids.map((id) => queryClient.invalidateQueries({ queryKey: queryKeys.invoices.detail(id) })),
        queryClient.invalidateQueries({ queryKey: queryKeys.invoices.links(data.bl_ids) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.billingReady.all() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.billingLedger.all() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.charges.operations() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.bls.all() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.customers.all() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.customers.detail() }),
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
