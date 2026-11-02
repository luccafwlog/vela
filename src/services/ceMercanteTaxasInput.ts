import {
  CUSTOMER_PORTAL_BILLING_URL,
  type CustomerCommunicationCeMercanteRow,
  type CustomerCommunicationTemplateInput,
} from './customerCommunicationTemplates'
import {
  customerCommunicationReadinessReasonLabel,
  fetchCustomerLocalChargesCommunicationReadiness,
  type CustomerLocalChargesCommunicationReadiness,
} from './customerCommunicationReadiness'
import { supabase } from './supabase'
import { portalPageUrl } from '../config/portalUrl'

/**
 * Dados do Comunicado de CE e Taxas de um Cliente numa Viagem, lidos pelo
 * navegador: os B/Ls ativos, o CE de cada um e o valor das Taxas Locais
 * faturadas. Servem à prévia e à conferência — o reenvio do Histórico e o
 * modelo CE e Taxas do Disparo. O conteúdo que sai no e-mail é sempre o que a
 * Edge `send-customer-communication` recalcula no servidor
 * (`customer_local_charges_communication_payload`), depois de reconferir a
 * prontidão; esta leitura não decide o envio.
 */

export type FinanceBlRow = {
  id: string
  voyage_id: number
  customer_id: number
  ce_mercante: string | null
  financial_status: string | null
  cancelled_at?: string | null
  pod: string | null
  customer: { id: number; name: string; cnpj_cpf: string } | null
  voyage: { id: number; voyage_number: string; eta: string | null; vessel: { name: string } | null } | null
}

type InvoiceBlRow = {
  bl_id: string | null
  subtotal_brl: number | null
  status?: string | null
  invoice: { id: number; status: string | null } | null
}

const ACTIVE_LOCAL_INVOICE_STATUSES = new Set(['issued', 'partially_paid', 'paid', 'covered'])

// Configuração única do endereço do Portal (src/config/portalUrl.ts, ponto 4 de 2026-10-23).
function configuredPortalBillingUrl(): string {
  const configured = String(import.meta.env.VITE_PORTAL_BILLING_URL ?? '').trim() || String(import.meta.env.VITE_PORTAL_URL ?? '').trim()
  return configured ? portalPageUrl('billing', configured) : CUSTOMER_PORTAL_BILLING_URL
}

function normalizeNested<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

/** O primeiro motivo do bloqueio da prontidão, em português; null quando pronto. */
export function ceMercanteReadinessReason(readiness: CustomerLocalChargesCommunicationReadiness): string | null {
  const reason = readiness.reasons[0] ?? readiness.bls.flatMap((bl) => bl.blocked_reasons)[0]
  return reason ? customerCommunicationReadinessReasonLabel(reason) : null
}

export async function fetchFinanceBls(voyageId: number, customerId: number): Promise<FinanceBlRow[]> {
  const { data, error } = await supabase
    .from('bls')
    .select('id, voyage_id, customer_id, ce_mercante, financial_status, cancelled_at, pod, customer:customers!bls_customer_id_fkey(id, name, cnpj_cpf), voyage:voyages(id, voyage_number, eta, vessel:vessels(name))')
    .eq('voyage_id', voyageId)
    .eq('customer_id', customerId)
    .overrideTypes<FinanceBlRow[], { merge: false }>()
  if (error) throw error
  return (data ?? [])
    .filter((row) => row.financial_status !== 'cancelled' && !row.cancelled_at)
    .sort((left, right) => left.id.localeCompare(right.id))
}

export async function fetchInvoiceBls(blIds: readonly string[]): Promise<InvoiceBlRow[]> {
  if (!blIds.length) return []
  const { data: directData, error: directError } = await supabase
    .from('invoice_bls')
    .select('bl_id, subtotal_brl, invoice:invoices(id, status)')
    .in('bl_id', [...blIds])
    .overrideTypes<InvoiceBlRow[], { merge: false }>()
  if (directError) throw directError
  const directRows = (directData ?? []).map((row) => ({
    ...row,
    invoice: normalizeNested(row.invoice),
  })).filter((row) => row.bl_id && row.invoice && ACTIVE_LOCAL_INVOICE_STATUSES.has(row.invoice.status ?? ''))
  const directBlIds = new Set(directRows.map((row) => row.bl_id as string))
  const missingBlIds = blIds.filter((blId) => !directBlIds.has(blId))
  if (!missingBlIds.length) return directRows

  // Individual invoices are present in invoice_bls and are mirrored into the
  // ledger. Consolidated invoices only have invoice_receivable_links; prefer
  // the direct source per B/L so the mirror is never counted twice.
  const { data: ledgerData, error: ledgerError } = await supabase
    .from('invoice_receivable_links')
    .select('bl_id, subtotal_brl, status, invoice:invoices(id, status)')
    .in('bl_id', missingBlIds)
    .overrideTypes<InvoiceBlRow[], { merge: false }>()
  if (ledgerError) throw ledgerError
  const ledgerRows = (ledgerData ?? []).map((row) => ({
    ...row,
    invoice: normalizeNested(row.invoice),
  })).filter((row) => row.bl_id && row.status !== 'obsolete' && row.invoice && ACTIVE_LOCAL_INVOICE_STATUSES.has(row.invoice.status ?? ''))
  return [...directRows, ...ledgerRows]
}

export function buildCeMercanteInput(
  bls: readonly FinanceBlRow[],
  invoiceBls: readonly InvoiceBlRow[],
): CustomerCommunicationTemplateInput {
  const first = bls[0]
  if (!first?.customer || !first.voyage) throw new Error('Dados de cliente ou viagem ausentes para o comunicado financeiro.')
  const totals = new Map<string, number>()
  for (const link of invoiceBls) {
    const invoice = normalizeNested(link.invoice)
    if (!link.bl_id || !invoice || !ACTIVE_LOCAL_INVOICE_STATUSES.has(invoice.status ?? '')) continue
    totals.set(link.bl_id, (totals.get(link.bl_id) ?? 0) + Number(link.subtotal_brl ?? 0))
  }
  const ceMercanteRows: CustomerCommunicationCeMercanteRow[] = bls.map((bl) => ({
    blId: bl.id,
    ceMercante: bl.ce_mercante?.trim() ?? '',
    totalBrl: totals.get(bl.id) ?? 0,
  }))
  return {
    customerId: first.customer_id,
    customerName: first.customer.name,
    vesselName: first.voyage.vessel?.name ?? '',
    voyageNumber: first.voyage.voyage_number,
    port: first.pod ?? '—',
    milestoneAt: first.voyage.eta ?? '',
    bls: bls.map((bl) => ({ id: bl.id, customerId: bl.customer_id })),
    portalUrl: configuredPortalBillingUrl(),
    ceMercanteRows,
    totalBrl: ceMercanteRows.reduce((sum, row) => sum + row.totalBrl, 0),
  }
}

export type CeMercanteTaxasConferenceData = {
  /** Prontidão do Cliente na Viagem (`customer_local_charges_communication_readiness`). */
  ready: boolean
  /** Motivo do bloqueio, em português; null quando pronto. */
  reason: string | null
  /** Entrada da prévia; null sem B/L ativo. */
  renderInput: CustomerCommunicationTemplateInput | null
}

/**
 * Prontidão e prévia do CE e Taxas de um Cliente numa Viagem, para a
 * conferência do Disparo. A prévia só é montada com a prontidão em dia: antes
 * disso falta CE ou fatura, e o e-mail sairia com valores errados.
 */
export async function fetchCeMercanteTaxasConferenceData(voyageId: number, customerId: number): Promise<CeMercanteTaxasConferenceData> {
  const readiness = await fetchCustomerLocalChargesCommunicationReadiness(voyageId, customerId)
  if (!readiness.ready) return { ready: false, reason: ceMercanteReadinessReason(readiness), renderInput: null }
  const bls = await fetchFinanceBls(voyageId, customerId)
  if (!bls.length) return { ready: false, reason: customerCommunicationReadinessReasonLabel('no_bls'), renderInput: null }
  const invoiceBls = await fetchInvoiceBls(bls.map((bl) => bl.id))
  return { ready: true, reason: null, renderInput: buildCeMercanteInput(bls, invoiceBls) }
}
