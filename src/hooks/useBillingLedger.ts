import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import {
  getInvoiceCorrectionSummary,
  registerInvoiceCorrection,
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
  qc.invalidateQueries({ queryKey: queryKeys.billingLedger.all() })
  qc.invalidateQueries({ queryKey: queryKeys.invoices.all() })
  qc.invalidateQueries({ queryKey: queryKeys.bls.all() })
  qc.invalidateQueries({ queryKey: queryKeys.customers.all() })
  qc.invalidateQueries({ queryKey: queryKeys.customers.detail() })
  qc.invalidateQueries({ queryKey: ['invoice-detail'] })
  qc.invalidateQueries({ queryKey: ['invoice-refunds'] })
  qc.invalidateQueries({ queryKey: queryKeys.invoices.corrections() })
  qc.invalidateQueries({ queryKey: ['cod-adjustments'] })
  qc.invalidateQueries({ queryKey: ['financial-alerts'] })
  qc.invalidateQueries({ queryKey: ['alerts'] })
  qc.invalidateQueries({ queryKey: ['portal-invoice-detail'] })
  qc.invalidateQueries({ queryKey: ['portal-invoices'] })
  qc.invalidateQueries({ queryKey: ['portal-invoices-page'] })
  qc.invalidateQueries({ queryKey: ['op-count'] })
  qc.invalidateQueries({ queryKey: ['reconciliation-history'] })
}

export async function reverseLocalPaymentAndInvalidate(
  qc: Pick<QueryClient, 'invalidateQueries'>,
  paymentId: number,
  reason: string,
) {
  await reverseLocalInvoicePayment(paymentId, reason)
  invalidateBillingLedgerQueries(qc)
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
export function useRegisterInvoiceCorrection() {
  const invalidate = useLedgerInvalidation()
  return useMutation({ mutationFn: registerInvoiceCorrection, onSuccess: invalidate })
}

export function useResolveStaleInvoice() {
  const invalidate = useLedgerInvalidation()
  return useMutation({ mutationFn: resolveStaleInvoice, onSuccess: invalidate })
}
