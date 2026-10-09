import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { cancelFinancialRefundAuthorization, listFinancialRefunds, type RefundSource } from '../services/financialRefunds'
import { afterBlInvoiceBasisAlterada } from '../services/cacheEffects'
import { queryKeys } from '../services/queryKeys'
export function useFinancialRefunds(source: RefundSource, invoiceId?: number | null) {
  return useQuery({ queryKey: queryKeys.financialRefunds.byInvoice(source, invoiceId), enabled: Boolean(invoiceId),
    queryFn: () => listFinancialRefunds(source, Number(invoiceId)) })
}

/** Cancela uma autorização de restituição excepcional ainda não devolvida. */
export function useCancelFinancialRefundAuthorization() {
  const queryClient = useQueryClient()
  return useMutation({ mutationFn: cancelFinancialRefundAuthorization, onSuccess: () => afterBlInvoiceBasisAlterada(queryClient) })
}
