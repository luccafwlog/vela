import type { InvoiceItem } from '../types/database'
import { formatBRL, formatUSD } from './utils'

/**
 * Unitário da linha da fatura. A linha em dólar da avulsa não tem unitário em
 * R$ (ADR 0094, B13; migration 383): o total em R$ é o total em US$ convertido
 * de uma vez, e o unitário aparece em US$. Sem nenhum dos dois, `null`.
 */
export function invoiceItemUnit(item: Pick<InvoiceItem, 'unit_value_brl' | 'unit_value_usd' | 'currency'>): string | null {
  if (item.unit_value_brl != null) return formatBRL(item.unit_value_brl)
  if (item.currency === 'USD' && item.unit_value_usd != null) return formatUSD(item.unit_value_usd)
  return null
}

/**
 * Origem da linha no detalhe da fatura do Vela. A linha calculada cujo valor o
 * operador alterou leva a marca no `snapshot_payload` (ADR 0111, D9; migration
 * 493) e aparece como Alterado; o Portal não recebe a marca.
 */
export function invoiceItemOrigin(item: Pick<InvoiceItem, 'source' | 'snapshot_payload'>): 'Manual' | 'Alterado' | 'Calculado' {
  if (item.source === 'manual') return 'Manual'
  const payload = item.snapshot_payload
  if (payload && typeof payload === 'object' && !Array.isArray(payload) && 'charge_adjustment' in payload) return 'Alterado'
  return 'Calculado'
}

/** Texto da marca do item cobrado pelo valor mínimo (ADR 0125). */
export const INVOICE_ITEM_MINIMUM_LABEL = 'Valor mínimo aplicado'

/**
 * O item cobrado pelo valor mínimo por B/L (THD por tonelada da carga solta de
 * Vitória, ADR 0125): o servidor marca `minimum_value` no `snapshot_payload`
 * na emissão (migration 602), e o total não é quantidade × unitário. Vale no
 * Vela, no Portal e no documento impresso.
 */
export function invoiceItemMinimumApplied(item: Pick<InvoiceItem, 'snapshot_payload'>): boolean {
  const payload = item.snapshot_payload
  return Boolean(payload && typeof payload === 'object' && !Array.isArray(payload) && 'minimum_value' in payload)
}
