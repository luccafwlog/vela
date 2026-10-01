import { describe, expect, it } from 'vitest'
import { previewInvoiceCorrection } from '../invoiceCorrection'

describe('correção após pagamento', () => {
  it('abate saldo sem inventar restituição quando o recebido é menor que a cobrança corrigida', () => {
    expect(previewInvoiceCorrection(1000, 600, 800)).toEqual({ difference: 200, offset: 200, refund: 0, balance: 400 })
  })
  it('abate o restante e restitui somente o excedente recebido', () => {
    expect(previewInvoiceCorrection(1000, 100, 800)).toEqual({ difference: 200, offset: 100, refund: 100, balance: 0 })
    expect(previewInvoiceCorrection(1000, 0, 800)?.refund).toBe(200)
  })
  it('usa centavos e rejeita aumento/entrada inválida', () => {
    expect(previewInvoiceCorrection(100, 0.02, 99.97)).toEqual({ difference: 0.03, offset: 0.02, refund: 0.01, balance: 0 })
    expect(previewInvoiceCorrection(100, 50, 110)).toBeNull()
    expect(previewInvoiceCorrection(100, 50, NaN)).toBeNull()
  })
})
