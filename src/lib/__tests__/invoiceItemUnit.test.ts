import { describe, expect, it } from 'vitest'
import { invoiceItemOrigin, invoiceItemUnit } from '../invoiceItemUnit'

describe('invoiceItemUnit (ADR 0094, B13)', () => {
  it('linha em dólar sem unitário em R$ mostra o unitário em US$', () => {
    expect(invoiceItemUnit({ currency: 'USD', unit_value_brl: null, unit_value_usd: 33.33 })).toMatch(/US\$\s?33,33/)
  })
  it('linha com unitário em R$ mostra R$, também na taxa local em dólar', () => {
    expect(invoiceItemUnit({ currency: 'USD', unit_value_brl: 181.05, unit_value_usd: 33.33 })).toMatch(/R\$\s181,05/)
    expect(invoiceItemUnit({ currency: 'BRL', unit_value_brl: 100, unit_value_usd: null })).toMatch(/R\$\s100,00/)
  })
  it('sem unitário nenhum, null', () => {
    expect(invoiceItemUnit({ currency: 'BRL', unit_value_brl: null, unit_value_usd: null })).toBeNull()
  })
})

describe('invoiceItemOrigin (ADR 0111, D9)', () => {
  it('linha com a marca de alteração aparece como Alterado; manual e calculada como antes', () => {
    expect(invoiceItemOrigin({ source: 'auto', snapshot_payload: { charge_adjustment: { kind: 'unit', value: 250 } } })).toBe('Alterado')
    expect(invoiceItemOrigin({ source: 'auto', snapshot_payload: { foo: 1 } })).toBe('Calculado')
    expect(invoiceItemOrigin({ source: 'ledger', snapshot_payload: null })).toBe('Calculado')
    expect(invoiceItemOrigin({ source: 'manual', snapshot_payload: { charge_adjustment: { kind: 'total' } } })).toBe('Manual')
  })
})
