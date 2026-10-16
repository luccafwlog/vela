import { describe, expect, it } from 'vitest'
import {
  fmtBRL,
  fmtUSD,
  buildInvoiceFileBaseName,
} from '../invoiceFormat'

describe('fmtBRL and fmtUSD formatting', () => {
  it('retorna traço para valores ausentes ou nulos (DOC-01, DOC-02)', () => {
    expect(fmtBRL(null)).toBe('—')
    expect(fmtBRL(undefined)).toBe('—')
    expect(fmtBRL(NaN)).toBe('—')
    expect(fmtUSD(null)).toBe('—')
    expect(fmtUSD(undefined)).toBe('—')
    expect(fmtUSD(NaN)).toBe('—')
  })

  it('formata zero genuíno corretamente', () => {
    expect(fmtBRL(0)).toBe('R$ 0,00')
    expect(fmtUSD(0)).toBe('US$ 0,00')
  })

  it('formata valores positivos com separador pt-BR', () => {
    expect(fmtBRL(1234.56)).toBe('R$ 1.234,56')
    expect(fmtUSD(1234.56)).toBe('US$ 1.234,56')
  })

  it('formata valores negativos com sinal de menos no início (DOC-05)', () => {
    expect(fmtBRL(-100)).toBe('-R$ 100,00')
    expect(fmtUSD(-50.25)).toBe('-US$ 50,25')
  })
})

describe('buildInvoiceFileBaseName', () => {
  it('gera nome para fatura individual', () => {
    const name = buildInvoiceFileBaseName({
      invoice: {
        id: 1,
        invoice_number: 'INV-2026-001',
        customer_name: 'Empresa Teste',
      },
      bls: [{ bl_id: 'BL123' }],
      items: [],
      payments: [],
    } as unknown as Parameters<typeof buildInvoiceFileBaseName>[0])
    expect(name).toContain('INV-2026-001')
    expect(name).toContain('Empresa')
    expect(name).toContain('BL123')
  })

  it('resume lista de B/Ls quando há mais de 3 itens (DOC-04)', () => {
    const manyBls = Array.from({ length: 50 }, (_, i) => ({ bl_id: `BL-${i + 1}` }))
    const name = buildInvoiceFileBaseName({
      invoice: {
        id: 2,
        invoice_number: 'INV-CONS-001',
        customer_name: 'Cliente com muitos BLs',
      },
      bls: manyBls,
      items: [],
      payments: [],
    } as unknown as Parameters<typeof buildInvoiceFileBaseName>[0])
    expect(name).toContain('e mais 47')
    expect(name.length).toBeLessThanOrEqual(200)
  })

  it('usa FATURA AVULSA no nome de arquivo sem inventar B/L', () => {
    const name = buildInvoiceFileBaseName({
      invoice: {
        id: 3,
        invoice_number: 'INV-AV-003',
        invoice_type: 'manual',
        customer_name: 'Cliente Avulso',
      },
      bls: [],
      items: [],
      payments: [],
    } as unknown as Parameters<typeof buildInvoiceFileBaseName>[0])

    expect(name).toBe('INV-AV-003 - FATURA AVULSA - Cliente')
  })
})
