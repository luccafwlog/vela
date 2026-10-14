// Regra de `apply_demurrage_discount` (migration 012), sem dependências, para o
// navegador e para a Edge Function da Régua usarem o mesmo USD líquido: o
// desconto sai em USD antes da conversão (ADR 0014; ADR 0083, item 13).
export type DiscountPreview = { totalUsd: number; discountUsd: number; netUsd: number; exceedsTotal?: boolean }

/** Arredonda em centavos meio para cima, como `round(numeric, 2)` do Postgres. */
export function roundCents(value: number): number {
  // O epsilon corrige o binário (217,505 vira 217,50499…); fica muito abaixo de um centavo.
  return Math.sign(value) * Math.round(Math.abs(value) * 100 + 1e-7) / 100
}

/**
 * Desconto já lido como número: o valor é arredondado em centavos, o percentual
 * vira `round(total × % / 100, 2)` e o líquido é total − desconto. Valor fixo
 * acima do total a RPC recusa: `exceedsTotal`. Sem desconto positivo, `null`.
 */
export function discountFromValue(totalUsd: number, mode: string | null | undefined, parsed: number | null | undefined): DiscountPreview | null {
  if (parsed == null || !Number.isFinite(parsed) || parsed <= 0) return null
  const value = roundCents(parsed)
  if (mode === 'percent') {
    const discountUsd = roundCents(totalUsd * Math.min(100, value) / 100)
    return { totalUsd, discountUsd, netUsd: roundCents(totalUsd - discountUsd) }
  }
  if (value > totalUsd) return { totalUsd, discountUsd: value, netUsd: 0, exceedsTotal: true }
  return { totalUsd, discountUsd: value, netUsd: roundCents(totalUsd - value) }
}

/** USD a cobrar: `total_usd` é o total dos itens; o desconto sai antes da conversão. */
export function invoiceNetUsd(invoice: { total_usd: number | null | undefined; discount_mode?: string | null; discount_value?: number | string | null }): DiscountPreview {
  const totalUsd = Number(invoice.total_usd ?? 0)
  const value = invoice.discount_value == null ? null : Number(invoice.discount_value)
  return discountFromValue(totalUsd, invoice.discount_mode, value)
    ?? { totalUsd, discountUsd: 0, netUsd: totalUsd }
}
