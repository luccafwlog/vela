import { applicationBasisLabel } from './applicationBasis'
import { formatBRL, formatUSD } from './utils'

/** Uma taxa alterada ou excluída à mão, como `list_bl_charge_adjustment_summaries` (migration 494) devolve. */
export type ChargeAdjustmentItem = {
  charge_name: string
  source: string | null
  excluded: boolean
  kind: 'unit' | 'total' | 'excluded' | null
  currency: string | null
  application_basis: string | null
  quantity: number | null
  table_unit: number | null
  table_total: number | null
  unit: number | null
  total: number | null
}

export type ChargeAdjustmentSummary = {
  bl_id: string
  voyage_id: number | null
  voyage_label: string | null
  manual_exempt: boolean
  exemption_justification: string | null
  items: ChargeAdjustmentItem[]
  last_actor_name: string | null
  last_at: string | null
}

const money = (value: number | null | undefined, currency: string | null | undefined) =>
  currency === 'USD' ? formatUSD(Number(value ?? 0)) : formatBRL(Number(value ?? 0))

/**
 * Frase da taxa alterada à mão (ADR 0111, spec seções 2 e 6): "THD: R$ 1.420,00
 * → R$ 1.200,00 por container"; total alterado compara os totais; a excluída é
 * "Taxa X: excluída".
 */
export function describeChargeAdjustment(item: ChargeAdjustmentItem) {
  if (item.excluded) return `${item.charge_name}: excluída`
  if (item.kind === 'total') return `${item.charge_name}: ${money(item.table_total, item.currency)} → ${money(item.total, item.currency)} no total`
  const basis = applicationBasisLabel(item.application_basis)
  return `${item.charge_name}: ${money(item.table_unit, item.currency)} → ${money(item.unit, item.currency)}${basis ? ` ${basis}` : ''}`
}

/** "THD: R$ 1.420,00 → R$ 1.200,00 por container; Taxa X: excluída; Isento à mão". */
export function describeChargeAdjustments(summary: Pick<ChargeAdjustmentSummary, 'items' | 'manual_exempt'> | null | undefined) {
  if (!summary) return ''
  const parts = summary.items.map(describeChargeAdjustment)
  if (summary.manual_exempt) parts.push('Isento à mão')
  return parts.join('; ')
}

/** Quantas taxas do B/L estão alteradas ou excluídas à mão (a isenção conta à parte). */
export function adjustedChargeCount(summary: Pick<ChargeAdjustmentSummary, 'items'> | null | undefined) {
  return summary?.items.length ?? 0
}
