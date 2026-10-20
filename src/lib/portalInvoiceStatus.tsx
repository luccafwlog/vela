import { formatDate, splitIsoDateTime } from './utils'

export const OPEN_INVOICE_STATUSES =['issued', 'partially_paid', 'draft'] as const
export const CLOSED_DEMURRAGE_STATUSES = ['paid', 'covered', 'cancelled', 'obsolete'] as const

export const STATUS_GROUPS = {
  issued: [...OPEN_INVOICE_STATUSES],
  paid: ['paid', 'covered'],
  cancelled: ['cancelled', 'obsolete'],
} as const

export type PortalStatusFilter = '' | keyof typeof STATUS_GROUPS

type OpenBalanceRow = { status?: string | null; invoice_type?: string | null; balance_brl?: number | null; bls?: readonly string[] | null }

/**
 * Faturas que contam no saldo em aberto do Portal: a consolidada aberta conta
 * no lugar das individuais que ela agrupa (cada B/L uma vez). As individuais
 * só viram "coberta" quando a consolidada é paga; até lá ficam emitidas e a
 * soma simples cobrava em dobro. Mesma regra de `_portal_customer_pending_balance`
 * (migration 344). A lista continua mostrando as duas.
 */
export function portalInvoicesInOpenBalance<T extends OpenBalanceRow>(invoices: readonly T[]): T[] {
  const open = invoices.filter((invoice) => (OPEN_INVOICE_STATUSES as readonly string[]).includes(invoice.status ?? 'issued'))
  const consolidatedBls = new Set(open.filter((invoice) => invoice.invoice_type === 'consolidated').flatMap((invoice) => invoice.bls ?? []))
  // Só a individual é substituída; a avulsa (`manual`) é outra cobrança.
  return open.filter((invoice) => invoice.invoice_type !== 'individual'
    || !(invoice.bls?.length && invoice.bls.every((bl) => consolidatedBls.has(bl))))
}

/**
 * "Recebido em" de um pagamento da fatura no Portal (lote 4): dia e hora de
 * Brasília quando o pagamento guarda a hora (Pix conciliado); só o dia
 * quando a baixa foi informada com o dia, sem inventar uma hora.
 */
// ponytail: o Portal não recebe a origem da baixa; o dia sem hora chega como
// 00:00 ou como o meio-dia em ponto que a baixa manual do Vela grava. Upgrade:
// `portal_invoice_details` devolver se a baixa foi manual ou conciliada.
export function formatPortalPaymentDate(paidAt: string | null | undefined): string {
  const { date, time } = splitIsoDateTime(paidAt)
  if (!date) return ''
  const instant = new Date(paidAt ?? '')
  const onTheMinute = Number.isNaN(instant.getTime()) || (instant.getUTCSeconds() === 0 && instant.getUTCMilliseconds() === 0)
  const dayOnly = !time || time === '00:00' || (time === '12:00' && onTheMinute)
  return dayOnly ? formatDate(date) : `${formatDate(date)} ${time}`
}

export function portalInvoiceStatusLabel(status: string | null) {
  if (status === 'partially_paid') return 'Parcial'
  if (status === 'cancelled') return 'Cancelada'
  if (status === 'obsolete') return 'Obsoleta'
  if (status === 'covered') return 'Coberta'
  if (status === 'paid') return 'Paga'
  if (status === 'draft') return 'Draft'
  return 'Emitida'
}

type DemurrageSituationInput = { status: string | null; dispute_open?: boolean | null }

/** Fatura de Demurrage que ainda pede pagamento: nem paga, nem coberta, nem cancelada. */
export function isDemurragePayable(invoice: DemurrageSituationInput) {
  return !(CLOSED_DEMURRAGE_STATUSES as readonly string[]).includes(invoice.status ?? '')
}

/**
 * Situação da fatura de Demurrage no Portal em texto (regra 5): Em disputa em
 * âmbar (pede ação), Paga com o ✓, Cancelada em cinza. A disputa aberta é a
 * situação, sem selo ao lado. Demurrage não vence (B29, ADR 0014): o estado
 * legado `overdue` aparece como Emitida, igual à ficha do Cliente.
 */
export function demurrageSituation(invoice: DemurrageSituationInput): { label: string; tone: 'default' | 'warning' | 'paid' | 'muted' } {
  if (invoice.status === 'paid' || invoice.status === 'covered') return { label: 'Paga', tone: 'paid' }
  if (invoice.status === 'cancelled' || invoice.status === 'obsolete') return { label: 'Cancelada', tone: 'muted' }
  if (invoice.dispute_open) return { label: 'Em disputa', tone: 'warning' }
  return { label: 'Emitida', tone: 'default' }
}

/** Dólar escrito "US$ 180,00". */
export function formatUsd(value: number | null | undefined) {
  return `US$ ${Number(value ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
