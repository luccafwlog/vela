import { describe, expect, it } from 'vitest'
import { invoiceNetUsd } from '../demurrageNetUsd'

// A13: a Régua e a tela usam o mesmo USD líquido (regra de apply_demurrage_discount).
describe('invoiceNetUsd', () => {
  it('tira o desconto percentual e o fixo antes da conversão', () => {
    expect(invoiceNetUsd({ total_usd: 1000, discount_mode: 'percent', discount_value: 10 }).netUsd).toBe(900)
    expect(invoiceNetUsd({ total_usd: 435.01, discount_mode: 'percent', discount_value: 50 })).toEqual({ totalUsd: 435.01, discountUsd: 217.51, netUsd: 217.5 })
    expect(invoiceNetUsd({ total_usd: 1000, discount_mode: 'fixed', discount_value: 250.5 }).netUsd).toBe(749.5)
  })

  it('lê o numeric do PostgREST como texto e trata ausência de desconto', () => {
    expect(invoiceNetUsd({ total_usd: 1000, discount_mode: 'fixed', discount_value: '100.00' as unknown as number }).netUsd).toBe(900)
    expect(invoiceNetUsd({ total_usd: 1000, discount_mode: null, discount_value: null }).netUsd).toBe(1000)
  })
})
