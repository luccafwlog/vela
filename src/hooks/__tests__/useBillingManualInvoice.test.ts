import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createManualInvoice: vi.fn(),
  invalidateQueries: vi.fn(),
  useMutation: vi.fn((options: Record<string, unknown>) => options),
}))

vi.mock('../../services/billing', () => ({
  cancelInvoice: vi.fn(),
  cancelInvoiceForReissue: vi.fn(),
  createManualInvoice: mocks.createManualInvoice,
  getInvoiceReissueLinks: vi.fn(),
  listPendingReissues: vi.fn(),
  listBillingCustomers: vi.fn(),
  listInvoiceDetails: vi.fn(),
  listInvoiceLinksByBls: vi.fn(),
  listInvoices: vi.fn(),
  registerInvoicePayment: vi.fn(),
}))

vi.mock('@tanstack/react-query', () => ({
  useMutation: mocks.useMutation,
  useQuery: vi.fn(),
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
}))

import { useCreateManualInvoice } from '../useBilling'

describe('useCreateManualInvoice', () => {
  beforeEach(() => {
    mocks.createManualInvoice.mockReset()
    mocks.invalidateQueries.mockReset()
    mocks.useMutation.mockClear()
  })

  it('invalida lista, detalhe, reconciliacao e contextos apos emitir', async () => {
    const mutation = useCreateManualInvoice() as unknown as {
      onSuccess: (data: { invoice_id: number }, variables: { blId?: string | null }) => Promise<void>
    }

    await mutation.onSuccess({ invoice_id: 42 }, { blId: 'BL-1' })

    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['invoices'] })
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['invoice-detail', 42] })
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['reconciliation-history'] })
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['bls'] })
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['customers'] })
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['customer-detail'] })
  })
})
