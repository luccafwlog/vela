import { describe, expect, it } from 'vitest'
import { summarizeReconciliationHistory, type ReconciliationHistoryRow } from '../reconciliacao'

const row = (patch: Partial<ReconciliationHistoryRow>): ReconciliationHistoryRow => ({
  id: 'x', source: 'local', invoiceId: 1, docNumber: 'FAT-1', invoiceType: 'individual', customerName: 'Cliente',
  customerCnpj: '', blId: 'BL-1', vesselName: null, voyageNumber: null, pod: null, blAmount: 100, totalAmount: 100,
  paymentId: 1, totalPaid: 100, balance: 0, paidAt: '2026-10-01', status: 'paid', ...patch,
})

describe('summarizeReconciliationHistory', () => {
  it('conta cada fatura uma vez, soma o pago da consolidada uma vez e não soma a coberta', () => {
    const summary = summarizeReconciliationHistory([
      // Consolidada de 3 B/Ls paga por R$ 3.000: três linhas, uma fatura.
      ...['BL-1', 'BL-2', 'BL-3'].map((blId) => row({ id: `c-${blId}`, invoiceId: 10, invoiceType: 'consolidated', blId, blAmount: 1000, totalAmount: 3000, totalPaid: 3000 })),
      // Individual coberta pela consolidada: não recebeu dinheiro.
      row({ id: 'cov', invoiceId: 11, status: 'covered', totalPaid: 0 }),
      // Parcialmente paga: soma o total pago gravado.
      row({ id: 'part', invoiceId: 12, status: 'partially_paid', totalAmount: 500, totalPaid: 200.005, balance: 299.995 }),
      // Demurrage paga entra pelo total, mesmo id de outra origem.
      row({ id: 'dem', source: 'demurrage', invoiceId: 10, invoiceType: null, totalAmount: 50, totalPaid: null, balance: null }),
    ])
    expect(summary).toEqual({ invoices: 4, received: 3250.01 })
  })
})
