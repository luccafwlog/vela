import { supabase } from '../supabase'
import { readAllPages } from './demurragePages'
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
  /** Coluna da migration 472 (DEM-D08), ainda fora dos tipos gerados. */
  replaces_invoice_id?: number | null
  /** Meio da baixa (migration 519, ADR 0112 D9): pix_itau, extrato, manual ou isencao. */
  payment_method?: string | null
  /** Invoice cancelada que esta reemissão substitui (migration 472, DEM-D08); só no detalhe. */
  replaces?: { id: number; doc_number: string } | null
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

type IssueDemurrageResult = {
  /** `waived` (migration 548): todas as caixas do grupo com a cobrança dispensada, nenhuma em Invoice. */
  status: 'issued' | 'existing' | 'waived' | 'waiting_return' | 'no_overstay' | 'no_containers' | 'blocked'
  invoice_id?: number
  /** `blocked` (migration 472, DEM-D13): CE Mercante ou Gate de faturamento do Portal. */
  reason?: string
  anchor_bl_id?: string
}

// Emissão pelo banco (migrations 179 e 214): B/Ls do mesmo Cliente que dividem
// container na Viagem formam um grupo, emitido pelo B/L-âncora quando todos os
// containers não-SOC voltaram; o container devolvido no free time entra com
// valor zero. Cada caixa é cobrada uma vez: a que já está em Invoice emitida ou
// paga fica fora, e a nova sai numa Invoice complementar (ADR 0080).
async function issueDemurrageInvoiceForBl(blId: string): Promise<IssueDemurrageResult> {
  const { data, error } = await supabase.rpc('issue_demurrage_invoice_for_bl' as never, {
    // Sem número: o banco gera o do ano, `DEM-AAAA-NNNN` (migrations 293 e
    // 294), e pula o que já existe; o TXID do QR é esse número sem hífens.
    p_bl_id: blId,
  } as never)
  if (error) {
    // 23505 (migration 214): a caixa já está numa Invoice emitida ou paga da
    // mesma Viagem e Cliente; a mensagem do banco nomeia o container.
    if ((error as { code?: string }).code === '23505') {
      const message = (error as { message?: string }).message?.trim() ?? ''
      // 23505 do índice da 278: o TXID repetiu o de outra Invoice gravada ao
      // mesmo tempo; emitir de novo pega o número seguinte, sem cancelar nada.
      if (message.includes('demurrage_invoices_pix_txid_unique')) {
        throw new Error('O número da Invoice coincidiu com o de outra. Emita de novo.')
      }
      throw new Error(message.startsWith('Já existe fatura de Demurrage')
        ? message
        : 'Já existe fatura de Demurrage emitida ou paga para este B/L. Cancele a fatura atual antes de reemitir.')
    }
    throw error
  }
  return (data ?? { status: 'no_containers' }) as IssueDemurrageResult
}

export async function createInvoiceForBL(blId: string): Promise<number> {
  const result = await issueDemurrageInvoiceForBl(blId)
  if (result.status === 'issued' && result.invoice_id) return result.invoice_id
  const group = result.anchor_bl_id && result.anchor_bl_id !== blId ? ` (grupo do B/L ${result.anchor_bl_id})` : ''
  if (result.status === 'existing') throw new Error(`Todos os containers deste B/L${group} já estão em Invoice de Demurrage emitida ou paga.`)
  if (result.status === 'waived') throw new Error(`A cobrança de todos os containers deste B/L${group} foi dispensada: não há Invoice a emitir.`)
  if (result.status === 'waiting_return') throw new Error(`Aguardando a devolução de todos os containers do B/L${group}.`)
  if (result.status === 'no_overstay') throw new Error(`Nenhum container com sobreestadia para este B/L${group}.`)
  if (result.status === 'blocked') throw new Error(result.reason?.trim() || `A Invoice deste B/L${group} aguarda o CE Mercante e o Portal do Cliente.`)
  throw new Error('Nenhum container para faturar neste B/L.')
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

// O motivo vai para a auditoria do cancelamento (`audit_logs`); a RPC o exige,
// então não há motivo padrão que o contorne.
export async function cancelDemurrageInvoice(invoiceId: number, reason: string): Promise<void> {
  const text = reason.trim()
  if (!text) throw new Error('Informe o motivo do cancelamento.')
  const { error } = await supabase.rpc('cancel_demurrage_invoice', {
    p_request_id: crypto.randomUUID(),
    p_invoice_id: invoiceId,
    p_reason: text,
  })
  if (error) throw error
}

// ADR 0094, B10 (migration 382): a Invoice com ROE manual fica fora do
// recálculo pela PTAX; tirar o ROE manual volta ao câmbio do dia, com motivo.
export async function releaseDemurrageManualRoe(invoiceId: number, reason: string): Promise<void> {
  const text = reason.trim()
  if (text.length < 10) throw new Error('Informe o motivo de tirar o ROE manual (mínimo de 10 caracteres).')
  const { error } = await supabase.rpc('release_demurrage_invoice_manual_roe' as never, { p_invoice_id: invoiceId, p_reason: text } as never)
  if (error) throw error
}

export async function listDemurrageInvoices(filters?: DemurrageInvoiceFilters): Promise<DemurrageInvoiceListItem[]> {
  // Todas as páginas: o PostgREST corta em 1000 linhas.
  return readAllPages<DemurrageInvoiceListItem>((from, to) => {
    let query = supabase
      .from('demurrage_invoices')
      .select(`*, customer:customers(id,name,cnpj_cpf,address,city,state,zip), bl:bls(id,pol,pod,voyage:voyages(id,voyage_number,vessel:vessels(id,name)))`)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })

    if (filters?.status) query = query.eq('status', filters.status)
    if (filters?.customerId) query = query.eq('customer_id', filters.customerId)
    if (filters?.blId) query = query.eq('bl_id', filters.blId)
    if (filters?.dateFrom) query = query.gte('doc_date', filters.dateFrom)
    if (filters?.dateTo) query = query.lte('doc_date', filters.dateTo)

    return query.range(from, to).overrideTypes<DemurrageInvoiceListItem[], { merge: false }>()
  })
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
  // A Invoice cancelada que esta substitui vem numa leitura própria: o embed
  // da tabela nela mesma (`demurrage_invoices!replaces_invoice_id`) o PostgREST
  // resolve no sentido inverso (as que substituem esta, em lista).
  let replaces: DemurrageInvoiceListItem['replaces'] = null
  const replacesId = invRes.data?.replaces_invoice_id
  if (replacesId != null) {
    const prevRes = await supabase
      .from('demurrage_invoices')
      .select('id, doc_number')
      .eq('id', replacesId)
      .maybeSingle()
    if (prevRes.error) throw prevRes.error
    replaces = prevRes.data ? { id: prevRes.data.id, doc_number: prevRes.data.doc_number } : null
  }
  return {
    invoice: {
      ...invRes.data!,
      replaces,
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
