import { supabase } from '../supabase'
import { extractErrorText } from '../../lib/errors'
import type { DemurrageInvoice, DemurrageInvoiceItem } from '../../types/database'
import { featureFlags, PRODUCT_EVENTS } from '../../lib/featureFlags'

export type DemurrageInvoiceFilters = {
  status?: DemurrageInvoice['status'] | null
  customerId?: number | null
  blId?: string | null
  dateFrom?: string | null
  dateTo?: string | null
}

export type DemurrageInvoiceListItem = DemurrageInvoice & {
  customer?: { id: number; name: string; cnpj_cpf: string } | null
  bl?: { id: string; pol: string | null; pod: string | null; voyage?: { id: number; voyage_number: string; vessel?: { id: number; name: string } | null } | null } | null
}

/**
 * Aplica o desconto da fatura de demurrage em USD, antes da conversão para BRL
 * (ADR 0014). Fonte única usada por todos os caminhos que congelam ou recalculam
 * o valor, evitando divergência entre eles. Percentual é limitado a 0–100 e o
 * valor fixo nunca leva o subtotal abaixo de zero.
 */
export function applyDemurrageUsdDiscount(
  totalUsd: number,
  discountMode: string | null | undefined,
  discountValue: number | null | undefined,
): number {
  let discounted = totalUsd ?? 0
  if (discountValue && discountValue > 0) {
    if (discountMode === 'percent') discounted = discounted * (1 - Math.min(100, discountValue) / 100)
    else discounted = Math.max(0, discounted - discountValue)
  }
  return discounted
}

function genDemurrageDocnum(blId: string): string {
  const year = new Date().getFullYear()
  const ts = Date.now().toString(36).slice(-4).toUpperCase()
  const s = String(blId || '').toUpperCase()
  let hash = 0
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) - hash) + s.charCodeAt(i)
    hash |= 0
  }
  const suffix = (Math.abs(hash) % 1000).toString().padStart(3, '0')
  return `DEM-${year}-${ts}${suffix}`
}

async function createDemurrageInvoiceAuthoritative(input: {
  docNumber: string
  blId: string
  customerId: number
  containerIds: number[]
}): Promise<number> {
  const { data, error } = await supabase.rpc('create_demurrage_invoice_authoritative', {
    p_doc_number: input.docNumber,
    p_bl_id: input.blId,
    p_customer_id: input.customerId,
    p_container_ids: input.containerIds,
  })
  if (error) {
    const text = extractErrorText(error).toLowerCase()
    if (text.includes('23505')) {
      throw new Error('Já existe fatura de Demurrage emitida ou paga para este B/L. Cancele a fatura atual antes de reemitir.')
    }
    throw error
  }

  const invoiceId = Number((data as { invoice_id?: number } | null)?.invoice_id)
  if (!Number.isFinite(invoiceId) || invoiceId <= 0) {
    throw new Error('RPC de Demurrage nao retornou uma invoice valida.')
  }
  return invoiceId
}

/**
 * Sob recálculo diário, uma fatura emitida e não paga não é sobrescrita pela
 * reimportação (ADR 0014). Detecta se já há fatura ativa (issued/paid) para o B/L.
 */
async function hasActiveInvoiceForBL(blId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('demurrage_invoices')
    .select('id')
    .eq('bl_id', blId)
    .in('status', ['issued', 'paid'])
    .limit(1)
  if (error) throw error
  return (data?.length ?? 0) > 0
}

export async function createInvoiceForBL(blId: string): Promise<number> {
  const { data: bl, error: blErr } = await supabase
    .from('bls')
    .select('id, customer_id')
    .eq('id', blId)
    .single()
  if (blErr) throw blErr
  if (!bl.customer_id) throw new Error('BL não possui cliente vinculado')

  const { data: containers, error: cErr } = await supabase
    .from('bl_containers')
    .select('id')
    .eq('bl_id', blId)
    .eq('demurrage_status', 'overdue')
  if (cErr) throw cErr
  if (!containers?.length) throw new Error('Nenhum container em atraso para este BL')

  const doc_number = genDemurrageDocnum(blId)
  return createDemurrageInvoiceAuthoritative({
    docNumber: doc_number,
    blId,
    customerId: bl.customer_id,
    containerIds: containers.map((container) => container.id),
  })
}

export async function createInvoiceForReturnedBL(blId: string): Promise<number | null> {
  const { data: bl, error: blErr } = await supabase
    .from('bls')
    .select('id, customer_id')
    .eq('id', blId)
    .single()
  if (blErr) throw blErr
  if (!bl.customer_id) return null

  const { data: containers, error: cErr } = await supabase
    .from('bl_containers')
    .select('id')
    .eq('bl_id', blId)
    .eq('demurrage_status', 'returned')
    .not('discharge_date', 'is', null)
    .not('return_date', 'is', null)
  if (cErr) throw cErr
  if (!containers?.length) return null

  if (await hasActiveInvoiceForBL(blId)) return null

  const doc_number = genDemurrageDocnum(blId)
  return createDemurrageInvoiceAuthoritative({
    docNumber: doc_number,
    blId,
    customerId: bl.customer_id,
    containerIds: containers.map((container) => container.id),
  })
}

export async function markInvoicePaid(invoiceId: number, paidAt: string): Promise<void> {
  const { data: inv, error: fetchErr } = await supabase
    .from('demurrage_invoices')
    .select('status')
    .eq('id', invoiceId)
    .single()
  if (fetchErr) throw fetchErr

  if (inv.status !== 'issued' && inv.status !== 'overdue') {
    throw new Error(`Fatura não pode ser marcada como paga no status atual: ${inv.status}`)
  }

  const { data, error } = await supabase.rpc('register_demurrage_payment', {
    p_request_id: crypto.randomUUID(),
    p_invoice_id: invoiceId,
    p_paid_at: paidAt,
    p_pix_txid: null,
    p_total_brl: null,
    p_ptax_used: null,
  })
  if (error) throw error
  const status = typeof data === 'object' && data !== null && !Array.isArray(data) ? data.status : undefined
  if (status === 'paid') {
    featureFlags.capture(PRODUCT_EVENTS.INVOICE_PAID, { surface: 'internal', invoice_type: 'demurrage' })
  }
}

/**
 * Recalcula o current_total_brl e o QR PIX de uma fatura emitida e não paga após
 * mudança de desconto, aplicando o desconto em USD antes da conversão pelo ROE
 * vigente (ADR 0014). A foto de histórico do desconto é gravada no próximo
 * recálculo diário (Fase 1).
 */
export async function recomputeDiscountedBrl(invoiceId: number): Promise<void> {
  const { data: inv, error: fetchErr } = await supabase
    .from('demurrage_invoices')
    .select('total_usd, discount_mode, discount_value, current_roe, doc_number, status, paid_at')
    .eq('id', invoiceId)
    .single()
  if (fetchErr) throw fetchErr
  if (inv.status !== 'issued' || inv.paid_at != null || inv.current_roe == null) return

  const { error } = await supabase.rpc('apply_demurrage_discount', {
    p_request_id: crypto.randomUUID(),
    p_invoice_id: invoiceId,
    p_discount_mode: inv.discount_mode,
    p_discount_value: inv.discount_value,
    p_discount_type: null,
    p_discount_justification: 'Recalculo do valor apos alteracao de desconto.',
    p_discount_approver: null,
  })
  if (error) throw error
}

export async function unmarkInvoicePaid(invoiceId: number): Promise<void> {
  const { error } = await supabase.rpc('reopen_demurrage_invoice', {
    p_request_id: crypto.randomUUID(),
    p_invoice_id: invoiceId,
    p_reason: 'Reabertura manual da baixa de Demurrage.',
  })
  if (error) throw error
}

export async function cancelDemurrageInvoice(invoiceId: number): Promise<void> {
  const { error } = await supabase.rpc('cancel_demurrage_invoice', {
    p_request_id: crypto.randomUUID(),
    p_invoice_id: invoiceId,
    p_reason: 'Cancelamento confirmado pelo operador.',
  })
  if (error) throw error
}

export async function listDemurrageInvoices(filters?: DemurrageInvoiceFilters): Promise<DemurrageInvoiceListItem[]> {
  let query = supabase
    .from('demurrage_invoices')
    .select(`*, customer:customers(id,name,cnpj_cpf,address,city,state,zip), bl:bls(id,pol,pod,voyage:voyages(id,voyage_number,vessel:vessels(id,name)))`)
    .order('created_at', { ascending: false })

  if (filters?.status) query = query.eq('status', filters.status)
  if (filters?.customerId) query = query.eq('customer_id', filters.customerId)
  if (filters?.blId) query = query.eq('bl_id', filters.blId)
  if (filters?.dateFrom) query = query.gte('doc_date', filters.dateFrom)
  if (filters?.dateTo) query = query.lte('doc_date', filters.dateTo)

  const { data, error } = await query.overrideTypes<DemurrageInvoiceListItem[], { merge: false }>()
  if (error) throw error
  return data ?? []
}

export async function getInvoiceDetail(invoiceId: number) {
  const [invRes, itemsRes] = await Promise.all([
    supabase
      .from('demurrage_invoices')
      .select(`*, customer:customers(id,name,cnpj_cpf,address,city,state,zip), bl:bls(id,pol,pod,voyage:voyages(id,voyage_number,vessel:vessels(id,name)))`)
      .eq('id', invoiceId)
      .single()
      .overrideTypes<DemurrageInvoiceListItem, { merge: false }>(),
    supabase
      .from('demurrage_invoice_items')
      .select('*')
      .eq('invoice_id', invoiceId)
      .order('container_number')
      .overrideTypes<DemurrageInvoiceItem[], { merge: false }>(),
  ])
  if (invRes.error) throw invRes.error
  if (itemsRes.error) throw itemsRes.error
  return {
    invoice: {
      ...invRes.data!,
    },
    items: itemsRes.data ?? [],
  }
}

export async function applyDemurrageDiscount(input: {
  invoiceId: number
  discountType: DemurrageInvoice['discount_type']
  discountValue: number | null
  discountMode: DemurrageInvoice['discount_mode']
  justification: string | null
  approver: string | null
}): Promise<void> {
  const { error } = await supabase.rpc('apply_demurrage_discount', {
    p_request_id: crypto.randomUUID(),
    p_invoice_id: input.invoiceId,
    p_discount_mode: input.discountMode,
    p_discount_value: input.discountValue,
    p_discount_type: input.discountType,
    p_discount_justification: input.justification,
    p_discount_approver: input.approver,
  })
  if (error) throw error
}

export async function updateDemurrageInvoice(invoiceId: number, patch: Partial<Pick<DemurrageInvoice, 'dispute_open' | 'dispute_subject' | 'dispute_reason' | 'dispute_status' | 'dispute_notes' | 'notes' | 'due_date'>>): Promise<void> {
  const { error } = await supabase.from('demurrage_invoices').update(patch).eq('id', invoiceId)
  if (error) throw error
}
