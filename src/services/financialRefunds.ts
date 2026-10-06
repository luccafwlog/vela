import { z } from 'zod'
import { supabase } from './supabase'

export type RefundSource = 'manual' | 'demurrage'
const refundSchema = z.object({
  request_id: z.string().nullable().optional(),
  id: z.number(), amount_brl: z.number(), status: z.enum(['pending', 'settled', 'cancelled']),
  notes: z.string().nullable(), purpose: z.enum(['correction', 'cancel']),
  bank_reference: z.string().nullable(), beneficiary: z.string().nullable(), settled_at: z.string().nullable(),
})
const summarySchema = z.object({ received_brl: z.number(), refunds: z.array(refundSchema) })
export type FinancialRefundSummary = z.infer<typeof summarySchema>
// Contratos novos ficam locais até a regeneração autorizada dos tipos do banco.
const rpc = supabase as unknown as { rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: unknown }> }

export async function listFinancialRefunds(source: RefundSource, invoiceId: number): Promise<FinancialRefundSummary> {
  const { data, error } = await rpc.rpc('list_financial_refunds', { p_source: source, p_invoice_id: invoiceId })
  if (error) throw error
  return summarySchema.parse(data)
}

export type RequestFinancialRefundInput = {
  source: RefundSource; invoiceId: number; amountBrl: number; reason: string
  purpose: 'correction' | 'cancel'; requestId: string
}
export async function requestFinancialRefund(input: RequestFinancialRefundInput): Promise<void> {
  const { error } = await rpc.rpc('request_financial_refund', {
    p_source: input.source, p_invoice_id: input.invoiceId, p_amount_brl: input.amountBrl,
    p_reason: input.reason.trim(), p_purpose: input.purpose, p_request_id: input.requestId,
  })
  if (error) throw error
}
export async function confirmDemurrageRefund(input: { refundId: number; bankReference: string; beneficiary: string; paidAt: string }): Promise<void> {
  const { error } = await rpc.rpc('confirm_demurrage_refund', {
    p_refund_id: input.refundId, p_bank_reference: input.bankReference.trim(), p_beneficiary: input.beneficiary.trim(), p_paid_at: input.paidAt,
  })
  if (error) throw error
}

export async function cancelFinancialRefundAuthorization(input: { source: RefundSource; refundId: number; reason: string }): Promise<void> {
  const { error } = await rpc.rpc('cancel_financial_refund_authorization', {
    p_source: input.source, p_refund_id: input.refundId, p_reason: input.reason.trim(),
  })
  if (error) throw error
}
