import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import {
  getInvoiceCorrectionSummary,
  retryInvoiceBasisChanges,
  resolveStaleInvoice,
  createConsolidatedInvoice,
  listConsolidatableReceivables,
  listInvoiceRefunds,
  listPendingCodAdjustments,
  registerLedgerInvoicePayment,
  settleCodAdjustment,
  settleInvoiceRefund,
  type ConsolidatableReceivableFilters,
} from '../services/billingLedger'
import { afterBlInvoiceBasisAlterada } from '../services/cacheEffects'
import { queryKeys } from '../services/queryKeys'
import { reverseLocalInvoicePayment } from '../services/reconciliacao'

export function useConsolidatableReceivables(filters: ConsolidatableReceivableFilters) {
  return useQuery({
    queryKey: queryKeys.billingLedger.consolidatableReceivables(filters),
    queryFn: () => listConsolidatableReceivables(filters),
    enabled: Boolean(filters.customerId),
  })
}

export function invalidateBillingLedgerQueries(qc: Pick<QueryClient, 'invalidateQueries'>) {
  return afterBlInvoiceBasisAlterada(qc)
}

export async function reverseLocalPaymentAndInvalidate(
  qc: Pick<QueryClient, 'invalidateQueries'>,
  paymentId: number,
  reason: string,
) {
  await reverseLocalInvoicePayment(paymentId, reason)
  await invalidateBillingLedgerQueries(qc)
}

function useLedgerInvalidation() {
  const qc = useQueryClient()
  return () => invalidateBillingLedgerQueries(qc)
}

export function useInvoiceRefunds(invoiceId?: number | null) {
  return useQuery({
    queryKey: ['invoice-refunds', invoiceId],
    enabled: Boolean(invoiceId),
    queryFn: () => listInvoiceRefunds(Number(invoiceId)),
  })
}

export function useSettleInvoiceRefund() {
  const invalidate = useLedgerInvalidation()
  return useMutation({
    mutationFn: settleInvoiceRefund,
    onSuccess: invalidate,
  })
}

export function usePendingCodAdjustments() {
  return useQuery({
    queryKey: ['cod-adjustments', 'pending'],
    queryFn: listPendingCodAdjustments,
  })
}

export function useSettleCodAdjustment() {
  const invalidate = useLedgerInvalidation()
  return useMutation({
    mutationFn: settleCodAdjustment,
    onSuccess: invalidate,
  })
}

export function useCreateConsolidatedInvoice() {
  const invalidate = useLedgerInvalidation()
  return useMutation({
    mutationFn: createConsolidatedInvoice,
    onSuccess: invalidate,
  })
}
export function useRegisterLedgerInvoicePayment() {
  const invalidate = useLedgerInvalidation()
  return useMutation({
    mutationFn: registerLedgerInvoicePayment,
    onSuccess: invalidate,
  })
}

export function useInvoiceCorrectionSummary(invoiceId?: number | null) {
  return useQuery({ queryKey: queryKeys.invoices.corrections(invoiceId), enabled: Boolean(invoiceId),
    queryFn: () => getInvoiceCorrectionSummary(Number(invoiceId)) })
}

export function useResolveStaleInvoice() {
  const invalidate = useLedgerInvalidation()
  return useMutation({ mutationFn: resolveStaleInvoice, onSuccess: invalidate })
}

export function useRetryInvoiceBasisChanges() {
  const invalidate = useLedgerInvalidation()
  return useMutation({ mutationFn: retryInvoiceBasisChanges, onSuccess: invalidate })
}
