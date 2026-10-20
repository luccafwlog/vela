import { StatusText } from '../ui/StatusText'
import { REPORT_LOCAL_CHARGES_STATE_LABELS, reportLocalChargesState, localChargesListState } from '../../lib/chargeStatus'

/**
 * Taxas Locais do B/L em três estados para lista (lista de BLs e aba BLs da
 * ficha do Cliente): Pendente em âmbar, Emitida em tinta normal e Isenta em
 * cinza. B/L cancelado diz só isso. Com `showPaid` (relatório Operacional),
 * o B/L já pago aparece como "Paga" com o ✓ verde.
 */
export function LocalChargesStatus({ bl, showPaid = false }: {
  bl: { charge_status?: string | null; financial_status?: string | null; cancelled_at?: string | null }
  showPaid?: boolean
}) {
  const state = showPaid
    ? reportLocalChargesState(bl.charge_status, bl.financial_status, bl.cancelled_at)
    : localChargesListState(bl.charge_status, bl.financial_status, bl.cancelled_at)
  const label = REPORT_LOCAL_CHARGES_STATE_LABELS[state]
  if (state === 'cancelled') return <StatusText tone="muted">{label}</StatusText>
  if (state === 'pending') return <StatusText tone="warning">{label}</StatusText>
  if (state === 'exempt') return <StatusText tone="muted">{label}</StatusText>
  if (state === 'paid') return <StatusText tone="paid">{label}</StatusText>
  return <StatusText>{label}</StatusText>
}
