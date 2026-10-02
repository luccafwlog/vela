import { beforeEach, expect, it, vi } from 'vitest'
import { invalidateBillingLedgerQueries, reverseLocalPaymentAndInvalidate } from '../useBillingLedger'

const { reverseLocalInvoicePayment } = vi.hoisted(() => ({
  reverseLocalInvoicePayment: vi.fn(),
}))

vi.mock('../../services/reconciliacao', () => ({
  reverseLocalInvoicePayment,
}))

beforeEach(() => {
  reverseLocalInvoicePayment.mockReset()
  reverseLocalInvoicePayment.mockResolvedValue(undefined)
})

it('invalidates every financial consumer after a local payment reversal', () => {
  const invalidateQueries = vi.fn()

  invalidateBillingLedgerQueries({ invalidateQueries } as never)

  expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['billing-ledger'] })
  expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['invoices'] })
  expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['bls'] })
  expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['customer-detail'] })
  expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['invoice-detail'] })
  expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['invoice-refunds'] })
  expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['invoice-links'] })
  expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['customer-ficha'] })
  expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['financial-alerts'] })
  expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['op-count'] })
  expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['reconciliation-history'] })
})

it('invalida todos os consumidores somente depois de reverter a baixa local', async () => {
  const invalidateQueries = vi.fn()

  await reverseLocalPaymentAndInvalidate(
    { invalidateQueries } as never,
    41,
    'Pagamento duplicado',
  )

  expect(reverseLocalInvoicePayment).toHaveBeenCalledWith(41, 'Pagamento duplicado')
  expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['reconciliation-history'] })
  expect(reverseLocalInvoicePayment.mock.invocationCallOrder[0]).toBeLessThan(
    invalidateQueries.mock.invocationCallOrder[0],
  )
})
