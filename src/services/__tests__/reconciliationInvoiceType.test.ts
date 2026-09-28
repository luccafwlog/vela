import { expect, it } from 'vitest'
import { normalizeReconciliationInvoiceTypeFilter, selectLatestPayment } from '../reconciliacao'

it('maps the Único BL UI value to the persisted individual invoice type', () => {
  expect(normalizeReconciliationInvoiceTypeFilter('single')).toBe('individual')
  expect(normalizeReconciliationInvoiceTypeFilter('consolidated')).toBe('consolidated')
  expect(normalizeReconciliationInvoiceTypeFilter('manual')).toBe('manual')
  expect(normalizeReconciliationInvoiceTypeFilter('')).toBe('')
})

it('associa a data mais recente ao paymentId da mesma baixa', () => {
  expect(selectLatestPayment([
    { id: 22, paid_at: '2026-06-01T10:00:00Z' },
    { id: 11, paid_at: '2026-06-03T10:00:00Z' },
    { id: 33, paid_at: '2026-06-02T10:00:00Z' },
  ])).toEqual({ id: 11, paid_at: '2026-06-03T10:00:00Z' })
})
