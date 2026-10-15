export const OPEN_INVOICE_STATUSES = ['issued', 'partially_paid', 'draft'] as const
export const CLOSED_DEMURRAGE_STATUSES = ['paid', 'covered', 'cancelled', 'obsolete'] as const

export const STATUS_GROUPS = {
  issued: [...OPEN_INVOICE_STATUSES],
  paid: ['paid', 'covered'],
  cancelled: ['cancelled', 'obsolete'],
} as const

export type PortalStatusFilter = '' | keyof typeof STATUS_GROUPS

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
