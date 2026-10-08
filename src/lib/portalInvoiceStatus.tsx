import { Badge } from '../components/ui/Badge'

export const OPEN_INVOICE_STATUSES = ['issued', 'partially_paid', 'draft'] as const
export const CLOSED_DEMURRAGE_STATUSES = ['paid', 'covered', 'cancelled', 'obsolete'] as const

export const STATUS_GROUPS = {
  issued: [...OPEN_INVOICE_STATUSES],
  paid: ['paid', 'covered'],
  cancelled: ['cancelled', 'obsolete'],
} as const

export type PortalStatusFilter = '' | keyof typeof STATUS_GROUPS

export function renderDemurrageBadge(status: string | null) {
  if (status === 'paid') return <Badge tone="green">Pago</Badge>
  if (status === 'overdue') return <Badge tone="red">Vencida</Badge>
  return <Badge tone="blue">Emitida</Badge>
}

// Coberta fica no filtro "Pagas", mas não é Paga: quem recebeu foi a consolidada.
export function renderInvoiceBadge(status: string | null) {
  if (status === 'paid') return <Badge tone="green">Pago</Badge>
  if (status === 'covered') return <Badge tone="slate">Coberta</Badge>
  if (status === 'partially_paid') return <Badge tone="blue">Parcial</Badge>
  if (status === 'cancelled') return <Badge tone="slate">Cancelada</Badge>
  if (status === 'obsolete') return <Badge tone="slate">Obsoleta</Badge>
  if (status === 'draft') return <Badge tone="yellow">Draft</Badge>
  return <Badge tone="blue">Emitida</Badge>
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
