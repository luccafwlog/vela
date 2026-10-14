import { Badge } from '../ui/Badge'
import { StatusText, type StatusTextTone } from '../ui/StatusText'
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

const INVOICE_TONES: Record<string, StatusTextTone> = {
  paid: 'paid',
  cancelled: 'muted',
  overdue: 'warning',
}

/**
 * Situação da fatura de Demurrage em texto (regra 5, tabela limpa de
 * 2026-10-14): Pago com o ✓ verde, Vencido em âmbar, Cancelado em cinza. O
 * vocabulário continua o de Demurrage ("Faturado", "Pago").
 */
export function InvoiceStatusBadge({ status }: { status: DemurrageInvoice['status'] }) {
  return (
    <StatusText tone={INVOICE_TONES[status ?? ''] ?? 'default'}>
      {statusLabel(DEMURRAGE_INVOICE_STATUS_LABELS, status, 'Faturado')}
    </StatusText>
  )
}
