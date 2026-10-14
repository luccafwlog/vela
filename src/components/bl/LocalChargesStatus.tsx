import { StatusText } from '../ui/StatusText'
import { LOCAL_CHARGES_LIST_STATE_LABELS, localChargesListState } from '../../lib/chargeStatus'

/**
 * Taxas Locais do B/L em três estados para lista (lista de BLs e aba BLs da
 * ficha do Cliente): Pendente em âmbar, Emitida em tinta normal e Isenta em
 * cinza. B/L cancelado diz só isso.
 */
export function LocalChargesStatus({ bl }: { bl: { charge_status?: string | null; financial_status?: string | null; cancelled_at?: string | null } }) {
  if (bl.cancelled_at) return <StatusText tone="muted">B/L cancelado</StatusText>
  const state = localChargesListState(bl.charge_status, bl.financial_status)
  const label = LOCAL_CHARGES_LIST_STATE_LABELS[state]
  if (state === 'pending') return <StatusText tone="warning">{label}</StatusText>
  if (state === 'exempt') return <StatusText tone="muted">{label}</StatusText>
  return <StatusText>{label}</StatusText>
}
