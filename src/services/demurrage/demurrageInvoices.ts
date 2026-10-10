import { supabase } from '../supabase'
import type { DemurrageInvoice, DemurrageInvoiceItem } from '../../types/database'

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

type IssueDemurrageResult = {
  status: 'issued' | 'existing' | 'waiting_return' | 'no_overstay' | 'no_containers'
  invoice_id?: number
  anchor_bl_id?: string
}

// Emissão pelo banco (migration 178): B/Ls do mesmo Cliente que dividem
// container na Viagem formam um grupo com uma única Invoice de Demurrage,
// emitida pelo B/L-âncora quando todos os containers não-SOC voltaram; o
// container devolvido no free time entra com valor zero.
async function issueDemurrageInvoiceForBl(blId: string): Promise<IssueDemurrageResult> {
  const { data, error } = await supabase.rpc('issue_demurrage_invoice_for_bl' as never, {
    p_bl_id: blId,
    p_doc_number: genDemurrageDocnum(blId),
  } as never)
  if (error) {
    if ((error as { code?: string }).code === '23505') {
      throw new Error('Já existe fatura de Demurrage emitida ou paga para este B/L. Cancele a fatura atual antes de reemitir.')
    }
    throw error
  }
  return (data ?? { status: 'no_containers' }) as IssueDemurrageResult
}

export async function createInvoiceForBL(blId: string): Promise<number> {
  const result = await issueDemurrageInvoiceForBl(blId)
  if (result.status === 'issued' && result.invoice_id) return result.invoice_id
  const group = result.anchor_bl_id && result.anchor_bl_id !== blId ? ` (grupo do B/L ${result.anchor_bl_id})` : ''
  if (result.status === 'existing') throw new Error(`Já existe Invoice de Demurrage para este B/L${group}.`)
  if (result.status === 'waiting_return') throw new Error(`Aguardando a devolução de todos os containers do B/L${group}.`)
  if (result.status === 'no_overstay') throw new Error(`Nenhum container com sobreestadia para este B/L${group}.`)
  throw new Error('Nenhum container para faturar neste B/L.')
}

export async function createInvoiceForReturnedBL(blId: string): Promise<number | null> {
  const result = await issueDemurrageInvoiceForBl(blId)
  return result.status === 'issued' && result.invoice_id ? result.invoice_id : null
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

  const { error } = await supabase.rpc('register_demurrage_payment', {
    p_request_id: crypto.randomUUID(),
    p_invoice_id: invoiceId,
    p_paid_at: paidAt,
    p_pix_txid: null,
    p_total_brl: null,
    p_ptax_used: null,
  })
  if (error) throw error
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

export async function updateDemurrageInvoice(invoiceId: number, patch: Partial<Pick<DemurrageInvoice, 'dispute_subject' | 'dispute_reason' | 'dispute_notes' | 'notes' | 'due_date'>>): Promise<void> {
  const { error } = await supabase.from('demurrage_invoices').update(patch).eq('id', invoiceId)
  if (error) throw error
}
