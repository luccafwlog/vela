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
