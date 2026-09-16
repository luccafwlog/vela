// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  invalidateQueries: vi.fn(),
  markBlReadyAndCreateInvoice: vi.fn(),
  showToast: vi.fn(),
}))

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
}))
vi.mock('../../../hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'user-1' } }),
}))
vi.mock('../../ui/ConfirmDialog', () => ({
  useConfirm: () => vi.fn(),
}))
vi.mock('../../ui/Toast', () => ({
  useToast: () => ({ showToast: mocks.showToast }),
}))
vi.mock('../../../hooks/useLocalCharges', () => ({
  useBlLocalChargeLines: () => ({ data: [], isLoading: false }),
  useManualChargeItemsForBl: () => ({ data: [], isLoading: false }),
  useAddManualBlCharge: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateManualBlCharge: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteManualBlCharge: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useMarkBlChargesReviewed: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useMarkBlReadyForBilling: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCalculateBlLocalCharges: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))
vi.mock('../../../services/billing', () => ({
  markBlReadyAndCreateInvoice: mocks.markBlReadyAndCreateInvoice,
}))

import { BlCobrancasSection } from '../BlCobrancasTab'

const bl = {
  id: 'BL-1',
  customer_id: 1,
  charge_status: 'reviewed',
  financial_status: 'pending',
} as never

afterEach(cleanup)

beforeEach(() => {
  vi.clearAllMocks()
  mocks.markBlReadyAndCreateInvoice.mockRejectedValue({
    code: 'P0003',
    message: 'Faturamento bloqueado pelo Portal: Portal do Cliente não está ativo.',
  })
})

describe('cobranças do B/L', () => {
  it('exibe a razão operacional retornada pelo backend ao falhar a emissão automática', async () => {
    render(<BlCobrancasSection bl={bl} />)

    fireEvent.click(screen.getByRole('button', { name: 'Pronto para faturar' }))

    await waitFor(() => {
      expect(mocks.showToast).toHaveBeenCalledWith(
        'Faturamento bloqueado pelo Portal: Portal do Cliente não está ativo.',
        'error',
      )
    })
  })
})
