import { z } from 'zod'
import { supabase } from './supabase'
import type {
  ConsolidatableReceivable,
  ConsolidatedInvoiceResult,
  LedgerPaymentResult,
  ReconcileByTxidResult,
} from '../types/database'

export type ConsolidatableReceivableFilters = {
  customerId?: number | null
  voyageId?: number | null
  search?: string | null
}

const consolidatedInvoiceResultSchema: z.ZodType<ConsolidatedInvoiceResult> = z.object({
  invoice_id: z.number(),
  invoice_number: z.string().nullable(),
  status: z.literal('issued'),
  invoice_type: z.literal('consolidated'),
  receivable_count: z.number(),
  total_brl: z.number(),
})

const ledgerPaymentResultSchema: z.ZodType<LedgerPaymentResult> = z.object({
  invoice_id: z.number(),
  payment_id: z.number(),
  status: z.enum(['paid', 'partially_paid']),
  amount_brl: z.number(),
  balance_brl: z.number(),
  refund_due_brl: z.number(),
  receivables_settled: z.number(),
  individuals_covered: z.number(),
  consolidated_obsoleted: z.number(),
})

const reconcileByTxidResultSchema: z.ZodType<ReconcileByTxidResult> = z.union([
  z.object({
    matched: z.literal(false),
    reason: z.string(),
  }),
  z.object({
    matched: z.literal(true),
    invoice_id: z.number(),
    settled: z.literal(false),
    reason: z.string(),
  }),
  z.object({
    matched: z.literal(true),
    invoice_id: z.number(),
    settled: z.literal(true),
    payment: ledgerPaymentResultSchema,
  }),
])

function parseRpcResult<T>(schema: z.ZodType<T>, data: unknown, rpcName: string): T {
  const parsed = schema.safeParse(data)
  if (!parsed.success) throw new Error(`Resposta inválida de ${rpcName}: ${parsed.error.message}`)
  return parsed.data
}

function parseReceivableStatus(value: string): ConsolidatableReceivable['receivable_status'] {
  if (value === 'open' || value === 'partially_settled' || value === 'settled' || value === 'void') return value
  throw new Error(`Status de recebível inválido: ${value}`)
}

function parseEligibilityStatus(value: string): ConsolidatableReceivable['eligibility_status'] {
  if (value === 'eligible' || value === 'paid' || value === 'no_balance' || value === 'open_consolidated') return value
  throw new Error(`Elegibilidade de recebível inválida: ${value}`)
}

export async function listConsolidatableReceivables(
  filters: ConsolidatableReceivableFilters,
): Promise<ConsolidatableReceivable[]> {
  if (!filters.customerId) return [] as ConsolidatableReceivable[]

  const { data, error } = await supabase.rpc('list_consolidatable_receivables', {
    p_customer_id: filters.customerId,
    ...(filters.voyageId == null ? {} : { p_voyage_id: filters.voyageId }),
    ...(filters.search?.trim() ? { p_search: filters.search.trim() } : {}),
  })

  if (error) throw error

  return (data ?? []).map((row) => ({
    ...row,
    receivable_id: Number(row.receivable_id),
    customer_id: Number(row.customer_id),
    voyage_id: row.voyage_id == null ? null : Number(row.voyage_id),
    individual_invoice_id: row.individual_invoice_id == null ? null : Number(row.individual_invoice_id),
    balance_brl: Number(row.balance_brl ?? 0),
    original_amount_brl: Number(row.original_amount_brl ?? 0),
    receivable_status: parseReceivableStatus(row.receivable_status),
    eligibility_status: parseEligibilityStatus(row.eligibility_status),
  }))
}

export async function createConsolidatedInvoice(input: {
  customerId: number
  receivableIds: number[]
}) {
  const { data, error } = await supabase.rpc('create_local_consolidated_invoice', {
    p_customer_id: input.customerId,
    p_receivable_ids: input.receivableIds,
  })
  if (error) throw error
  return parseRpcResult(consolidatedInvoiceResultSchema, data, 'create_local_consolidated_invoice')
}
export async function registerLedgerInvoicePayment(input: {
  invoiceId: number
  amountBrl: number
  method?: string
  paidAt?: string | null
  pixTxid?: string | null
  source?: 'manual' | 'pix_extract'
  notes?: string | null
  actorId?: string | null
  /** Stable key reused by the UI when a network retry follows a timeout. */
  requestId?: string
}) {
  const requestId = input.requestId ?? crypto.randomUUID()
  const { data, error } = await supabase.rpc('register_ledger_invoice_payment', {
    p_invoice_id: input.invoiceId,
    p_amount_brl: input.amountBrl,
    p_method: input.method ?? 'pix',
    p_paid_at: input.paidAt ?? new Date().toISOString(),
    p_pix_txid: input.pixTxid ?? null,
    p_source: input.source ?? 'manual',
    p_notes: input.notes?.trim() || null,
    p_actor: input.actorId ?? null,
    p_request_id: requestId,
  })
  if (error) throw error
  return parseRpcResult(ledgerPaymentResultSchema, data, 'register_ledger_invoice_payment')
}
export type InvoiceRefund = {
  id: number
  amount_brl: number
  status: 'pending' | 'settled' | 'cancelled'
  created_at: string
  settled_at: string | null
  notes: string | null
  payment_id?: number | null
  cod_adjustment_id?: number | null
}

export async function listInvoiceRefunds(invoiceId: number): Promise<InvoiceRefund[]> {
  const { data, error } = await supabase.rpc('list_invoice_refunds', {
    p_invoice_id: invoiceId,
  })
  if (error) throw error
  return ((data ?? []) as InvoiceRefund[]).map((row) => ({
    ...row,
    id: Number(row.id),
    amount_brl: Number(row.amount_brl ?? 0),
    payment_id: row.payment_id == null ? null : Number(row.payment_id),
    cod_adjustment_id: row.cod_adjustment_id == null ? null : Number(row.cod_adjustment_id),
  }))
}

export async function settleInvoiceRefund(refundId: number): Promise<void> {
  const { error } = await supabase.rpc('settle_invoice_refund', {
    p_refund_id: refundId,
  })
  if (error) throw error
}

export type CodAdjustment = {
  id: number
  bl_id: string
  omission_id: number
  original_value_brl: number
  new_destination_value_brl: number
  difference_brl: number
  paid_amount_brl: number
  outstanding_balance_brl: number
  offset_amount_brl: number
  refund_amount_brl: number
  action: 'complementary_invoice' | 'cancel_and_reissue' | 'manual_charge_review' | 'offset_open_balance' | 'refund_overpayment'
  status: 'pending' | 'settled' | 'cancelled'
  manual_review_required: boolean
  resulting_document_id: number | null
  resulting_document_type: 'invoice' | 'refund' | null
  created_at: string
}

export async function listPendingCodAdjustments(): Promise<CodAdjustment[]> {
  const { data, error } = await supabase
    .from('cod_adjustments')
    .select('id, bl_id, omission_id, original_value_brl, new_destination_value_brl, difference_brl, paid_amount_brl, outstanding_balance_brl, offset_amount_brl, refund_amount_brl, action, status, manual_review_required, resulting_document_id, resulting_document_type, created_at')
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .overrideTypes<CodAdjustment[], { merge: false }>()
  if (error) throw error
  return (data ?? []).map((row) => ({
    ...row,
    id: Number(row.id),
    omission_id: Number(row.omission_id),
    original_value_brl: Number(row.original_value_brl ?? 0),
    new_destination_value_brl: Number(row.new_destination_value_brl ?? 0),
    difference_brl: Number(row.difference_brl ?? 0),
    paid_amount_brl: Number(row.paid_amount_brl ?? 0),
    outstanding_balance_brl: Number(row.outstanding_balance_brl ?? 0),
    offset_amount_brl: Number(row.offset_amount_brl ?? 0),
    refund_amount_brl: Number(row.refund_amount_brl ?? 0),
    resulting_document_id: row.resulting_document_id == null ? null : Number(row.resulting_document_id),
  }))
}

export type SettleCodAdjustmentInput = number | {
  adjustmentId: number
  resultingDocumentId?: number | null
  resultingDocumentType?: 'invoice' | 'refund' | null
}

export async function settleCodAdjustment(input: SettleCodAdjustmentInput): Promise<unknown> {
  const normalized = typeof input === 'number' ? { adjustmentId: input } : input
  const { data, error } = await supabase.rpc('settle_cod_adjustment', {
    p_adjustment_id: normalized.adjustmentId,
    ...(normalized.resultingDocumentId == null ? {} : { p_resulting_document_id: normalized.resultingDocumentId }),
    ...(normalized.resultingDocumentType == null ? {} : { p_resulting_document_type: normalized.resultingDocumentType }),
  })
  if (error) throw error
  return data
}
export async function reconcileInvoicePaymentByTxid(input: {
  txid: string
  amountBrl: number
  paidAt?: string | null
}) {
  const { data, error } = await supabase.rpc('reconcile_invoice_payment_by_txid', {
    p_txid: input.txid,
    p_amount_brl: input.amountBrl,
    ...(input.paidAt == null ? {} : { p_paid_at: input.paidAt }),
  })
  if (error) throw error
  return parseRpcResult(reconcileByTxidResultSchema, data, 'reconcile_invoice_payment_by_txid')
}
