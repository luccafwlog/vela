import { supabase } from '../supabase'
import { saoPauloTodayIso } from '../../lib/dates'
import { fetchUserDisplayNames } from '../userNames'
import { demurrageInvoiceNotices, type DemurrageInvoiceRow } from './demurragePresentation'
import type { DemurrageInvoiceListItem } from './demurrageInvoices'
import type { DemurrageDunningDisplay } from '../demurrageDunning'

/** Meio da baixa gravado pelo banco (migration 519, ADR 0112 D9). */
export type DemurragePaymentMethod = 'pix_itau' | 'extrato' | 'manual' | 'isencao'

export const PAYMENT_METHOD_LABEL: Record<DemurragePaymentMethod, string> = {
  pix_itau: 'Pix Itaú',
  extrato: 'Extrato',
  manual: 'Registro manual',
  isencao: 'Isenção (desconto integral)',
}

export function paymentMethodLabel(method: string | null | undefined): string | null {
  return method && method in PAYMENT_METHOD_LABEL ? PAYMENT_METHOD_LABEL[method as DemurragePaymentMethod] : null
}

/** Dia de Brasília (aaaa-mm-dd) de um instante ou de uma data. */
function brasiliaDay(value: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : saoPauloTodayIso(new Date(value))
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
}

/** Em aberto há: dias desde a emissão, pelo dia de Brasília (D8). */
export function daysOpen(billedAt: string | null | undefined, now = new Date()): number | null {
  if (!billedAt) return null
  return Math.max(0, daysBetween(brasiliaDay(billedAt), saoPauloTodayIso(now)))
}

/** Dias até pagar: data do pagamento menos o dia de Brasília da emissão (D9). */
export function daysToPay(billedAt: string | null | undefined, paidAt: string | null | undefined): number | null {
  if (!billedAt || !paidAt) return null
  return Math.max(0, daysBetween(brasiliaDay(billedAt), brasiliaDay(paidAt)))
}

export type InvoiceQuickFilters = {
  dispute: boolean
  outOfDunning: boolean
  discount: boolean
  customerId: number | null
  voyageId: number | null
}

export const EMPTY_INVOICE_FILTERS: InvoiceQuickFilters = { dispute: false, outOfDunning: false, discount: false, customerId: null, voyageId: null }

export function activeInvoiceFilterCount(filters: InvoiceQuickFilters): number {
  return [filters.dispute, filters.outOfDunning, filters.discount, filters.customerId != null, filters.voyageId != null].filter(Boolean).length
}

/**
 * Fora da Régua: suspensa pelo banco (`dunning_suspended_reason`) ou com a
 * Régua pausada agora (sem contato, disputa, ROE…). Liquidada e cancelada não
 * contam: a Régua acabou, não está fora.
 */
export function isOutOfDunning(invoice: DemurrageInvoiceListItem, dunning: DemurrageDunningDisplay | undefined): boolean {
  if (demurrageInvoiceNotices(invoice as DemurrageInvoiceRow).some((notice) => notice.key !== 'roe-cache' && notice.key !== 'dispute')) return true
  const pause = dunning?.pauseReason
  return Boolean(pause && pause !== 'liquidada' && pause !== 'cancelada')
}

export function matchesInvoiceFilters(
  invoice: DemurrageInvoiceListItem,
  filters: InvoiceQuickFilters,
  dunning: DemurrageDunningDisplay | undefined,
): boolean {
  if (filters.dispute && !invoice.dispute_open) return false
  if (filters.discount && !(Number(invoice.discount_value ?? 0) > 0)) return false
  if (filters.outOfDunning && !isOutOfDunning(invoice, dunning)) return false
  if (filters.customerId != null && invoice.customer_id !== filters.customerId) return false
  if (filters.voyageId != null && invoice.bl?.voyage?.id !== filters.voyageId) return false
  return true
}

export function voyageLabel(invoice: DemurrageInvoiceListItem): string | null {
  const voyage = invoice.bl?.voyage
  if (!voyage) return null
  return [voyage.vessel?.name, voyage.voyage_number].filter(Boolean).join(' / ') || null
}

/** Opções dos filtros Cliente e Navio / Viagem, das Invoices da aba, por nome. */
export function invoiceFilterOptions(invoices: readonly DemurrageInvoiceListItem[]) {
  const customers = new Map<number, string>()
  const voyages = new Map<number, string>()
  for (const invoice of invoices) {
    if (invoice.customer_id != null) customers.set(invoice.customer_id, invoice.customer?.name ?? `Cliente ${invoice.customer_id}`)
    const voyage = invoice.bl?.voyage
    const label = voyageLabel(invoice)
    if (voyage && label) voyages.set(voyage.id, label)
  }
  const byLabel = (left: [number, string], right: [number, string]) => left[1].localeCompare(right[1], 'pt-BR')
  return {
    customers: Array.from(customers).sort(byLabel).map(([id, label]) => ({ id, label })),
    voyages: Array.from(voyages).sort(byLabel).map(([id, label]) => ({ id, label })),
  }
}

export type BoxDestination = {
  kind: 'reemitida' | 'cobrada' | 'dispensada' | 'aguardando'
  invoice_id: number | null
  doc_number: string | null
  containers: string[]
}

export type DemurrageInvoiceDetails = {
  paymentRoe: number | null
  cancelReason: string | null
  cancelledBy: string | null
  cancelledAt: string | null
  destinations: BoxDestination[]
}

type DetailsRow = {
  invoice_id: number
  payment_roe: number | string | null
  cancel_reason: string | null
  cancelled_by: string | null
  cancelled_at: string | null
  box_destinations: BoxDestination[] | null
}

const DETAILS_CHUNK = 200

/**
 * ROE do pagamento, motivo e autor do cancelamento e destino das caixas
 * (`list_demurrage_invoice_details`, migration 519), por Invoice. O autor vem
 * com o nome; sem autor, o cancelamento foi do sistema.
 */
export async function fetchDemurrageInvoiceDetails(invoiceIds: readonly number[]): Promise<Map<number, DemurrageInvoiceDetails>> {
  const rows: DetailsRow[] = []
  for (let start = 0; start < invoiceIds.length; start += DETAILS_CHUNK) {
    const { data, error } = await supabase.rpc('list_demurrage_invoice_details' as never, { p_invoice_ids: invoiceIds.slice(start, start + DETAILS_CHUNK) } as never)
    if (error) throw error
    rows.push(...((data ?? []) as DetailsRow[]))
  }
  const names = await fetchUserDisplayNames(rows.map((row) => row.cancelled_by))
  return new Map(rows.map((row) => [row.invoice_id, {
    paymentRoe: row.payment_roe == null ? null : Number(row.payment_roe),
    cancelReason: row.cancel_reason,
    cancelledBy: row.cancelled_at == null ? null : row.cancelled_by ? (names.get(row.cancelled_by) ?? 'Pessoa sem cadastro') : 'Sistema',
    cancelledAt: row.cancelled_at,
    destinations: row.box_destinations ?? [],
  }]))
}

export function destinationText(destination: BoxDestination): string {
  const boxes = destination.containers.length === 1 ? destination.containers[0] : `${destination.containers.length} caixas`
  switch (destination.kind) {
    case 'reemitida': return `${boxes}: reemitida na ${destination.doc_number}`
    case 'cobrada': return `${boxes}: cobrada na ${destination.doc_number}`
    case 'dispensada': return `${boxes}: cobrança dispensada`
    default: return `${boxes}: aguardando nova Invoice`
  }
}
