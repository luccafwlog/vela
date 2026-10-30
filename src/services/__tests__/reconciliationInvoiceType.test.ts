import { expect, it } from 'vitest'
import { normalizeReconciliationInvoiceTypeFilter } from '../reconciliacao'

it('maps the Único BL UI value to the persisted individual invoice type', () => {
  expect(normalizeReconciliationInvoiceTypeFilter('single')).toBe('individual')
  expect(normalizeReconciliationInvoiceTypeFilter('consolidated')).toBe('consolidated')
  expect(normalizeReconciliationInvoiceTypeFilter('manual')).toBe('manual')
  expect(normalizeReconciliationInvoiceTypeFilter('')).toBe('')
})
