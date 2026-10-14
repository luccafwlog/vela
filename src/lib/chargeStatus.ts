// Predicados canônicos de charge_status do B/L. Fonte única do agrupamento
// Pendente / Pronto para faturar / Isento usado em resumos, filtros e métricas.
// Nunca reimplemente estas comparações inline nas páginas.

export function isChargePending(status: string | null | undefined) {
  return status === 'review_required' || status === 'not_calculated'
}

export function isChargeReady(status: string | null | undefined) {
  return status === 'ready_for_billing'
}

export function isChargeExempt(status: string | null | undefined) {
  return status === 'exempt'
}

// B/L cujo financial_status já avançou para faturado: recalculo bloqueado
// (etapa 2 do plano de faturamento, ADR 0038 achado 6). Fonte única para o
// serviço que chama a RPC e para as telas que decidem se oferecem a ação.
export function isBlFinanciallyLocked(financialStatus: string | null | undefined) {
  return financialStatus === 'invoiced' || financialStatus === 'partially_paid' || financialStatus === 'paid'
}

export function summarizeChargeStatuses(rows: Array<{ charge_status?: string | null }>) {
  return {
    pending: rows.filter((row) => isChargePending(row.charge_status)).length,
    ready: rows.filter((row) => isChargeReady(row.charge_status)).length,
    exempt: rows.filter((row) => isChargeExempt(row.charge_status)).length,
  }
}

export type LocalChargesListState = 'pending' | 'issued' | 'exempt'

/**
 * Taxas Locais do B/L em três estados para lista (lista de BLs, aba BLs da
 * ficha do Cliente): Pendente é qualquer impeditivo à emissão da fatura ao
 * Cliente, Emitida é fatura emitida e Isenta é o B/L que nunca terá essa
 * fatura. Espelho de `public.bl_local_charges_state` (migration 222), que
 * conta e filtra os mesmos estados no banco.
 */
export function localChargesListState(chargeStatus: string | null | undefined, financialStatus: string | null | undefined): LocalChargesListState {
  if (isChargeExempt(chargeStatus?.trim().toLowerCase())) return 'exempt'
  if (isBlFinanciallyLocked(financialStatus)) return 'issued'
  return 'pending'
}

export const LOCAL_CHARGES_LIST_STATE_LABELS: Record<LocalChargesListState, string> = {
  pending: 'Pendente',
  issued: 'Emitida',
  exempt: 'Isenta',
}
