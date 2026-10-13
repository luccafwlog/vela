import { Badge } from '../ui/Badge'
import { DEMURRAGE_INVOICE_STATUS_LABELS, statusLabel } from '../../lib/statusLabels'
import type { DemurrageInvoice } from '../../types/database'

/**
 * Status de Demurrage do container como o banco grava (migrations 197 e 200):
 * Em atraso não vale para SOC nem para B/L ou Viagem Cancelados.
 */
export function DemurrageStatusBadge({ status }: { status: string | null }) {
  if (status === 'returned') return <Badge tone="neutral">Devolvido</Badge>
  if (status === 'overdue') return <Badge tone="danger">Em atraso</Badge>
  return <Badge tone="success">No free time</Badge>
}

const INVOICE_TONES: Record<string, 'success' | 'neutral' | 'warning' | 'info'> = {
  paid: 'success',
  cancelled: 'neutral',
  draft: 'warning',
  issued: 'info',
}

export function InvoiceStatusBadge({ status }: { status: DemurrageInvoice['status'] }) {
  return (
    <Badge tone={INVOICE_TONES[status ?? ''] ?? 'info'}>
      {statusLabel(DEMURRAGE_INVOICE_STATUS_LABELS, status, 'Faturado')}
    </Badge>
  )
}
