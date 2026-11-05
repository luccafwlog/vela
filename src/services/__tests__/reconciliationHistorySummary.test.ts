import { describe, expect, it } from 'vitest'
import { summarizeReconciliationHistory, type ReconciliationHistoryRow } from '../reconciliacao'

const row = (patch: Partial<ReconciliationHistoryRow>): ReconciliationHistoryRow => ({
  id: 'x', source: 'local', invoiceId: 1, docNumber: 'FAT-1', invoiceType: 'individual', customerName: 'Cliente',
  customerCnpj: '', blId: 'BL-1', blCount: 1, vesselName: null, voyageNumber: null, pod: null, blAmount: 100, totalAmount: 100,
  paymentId: 1, paidAt: '2026-10-01', amount: 100, paymentAmount: 100, method: 'manual', bankReference: null,
  balance: 0, status: 'paid', ...patch,
})

describe('summarizeReconciliationHistory', () => {
  it('caso do staging: conta cada baixa uma vez e soma o que cada uma pôs nos B/Ls', () => {
    const summary = summarizeReconciliationHistory([
      // Consolidada paga por um Pix de R$ 1,50: uma baixa, duas linhas de B/L.
      row({ id: 'c-A', invoiceId: 20, paymentId: 11, invoiceType: 'consolidated', blId: 'A', amount: 1, paymentAmount: 1.5 }),
      row({ id: 'c-B', invoiceId: 20, paymentId: 11, invoiceType: 'consolidated', blId: 'B', amount: 0.5, paymentAmount: 1.5 }),
      // Individuais cobertas pela consolidada: as baixas manuais parciais que receberam antes contam.
      row({ id: 'm-A', invoiceId: 17, paymentId: 9, status: 'covered', blId: 'A', amount: 2469, paymentAmount: 2469 }),
      row({ id: 'm-B', invoiceId: 18, paymentId: 10, status: 'covered', blId: 'B', amount: 2469.5, paymentAmount: 2469.5 }),
    ])
    expect(summary).toMatchObject({ payments: 3, received: 4940 })
  })

  it('a Invoice de Demurrage conta pela própria fatura, sem colidir com o id de uma baixa local', () => {
    const summary = summarizeReconciliationHistory([
      row({ id: 'l', paymentId: 10, amount: 200.005 }),
      row({ id: 'd', source: 'demurrage', invoiceId: 10, paymentId: null, amount: 50 }),
    ])
    expect(summary).toMatchObject({ payments: 2, received: 250.01 })
    expect(summary.local).toEqual({ payments: 1, received: 200.01 })
    expect(summary.demurrage).toEqual({ payments: 1, received: 50 })
  })

  it('cartões: separa Taxas Locais, Demurrage e a baixa automática do Itaú, cada baixa uma vez', () => {
    const summary = summarizeReconciliationHistory([
      row({ id: 'i-A', paymentId: 11, blId: 'A', amount: 1, method: 'itau' }),
      row({ id: 'i-B', paymentId: 11, blId: 'B', amount: 0.5, method: 'itau' }),
      row({ id: 'm', paymentId: 9, amount: 100, method: 'manual' }),
      row({ id: 'd', source: 'demurrage', invoiceId: 7, paymentId: null, amount: 30, method: 'extract' }),
    ])
    expect(summary).toEqual({
      payments: 3,
      received: 131.5,
      local: { payments: 2, received: 101.5 },
      demurrage: { payments: 1, received: 30 },
      itau: { payments: 1, received: 1.5 },
    })
  })
})
