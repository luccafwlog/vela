// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

const mocks = vi.hoisted(() => ({
  invalidateQueries: vi.fn(),
  markBlReadyAndCreateInvoice: vi.fn(),
  showToast: vi.fn(),
  lines: vi.fn(),
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
  useBlLocalChargeLines: mocks.lines,
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
  mocks.lines.mockReturnValue({ data: [], isLoading: false })
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

  it('abre a fatura ativa pela URL esperada', () => {
    render(
      <MemoryRouter>
        <BlCobrancasSection bl={bl} activeInvoice={{ id: 77, invoice_number: 'INV-077' } as never} />
      </MemoryRouter>,
    )

    expect(screen.getByRole('link', { name: /Fatura ativa: INV-077/i }).getAttribute('href'))
      .toBe('/taxas-locais?invoice=77')
  })
})

it('não anuncia divergência de fatura enquanto as taxas estão indisponíveis', () => {
  mocks.lines.mockReturnValue({ data: undefined, isLoading: true })
  const { rerender } = render(<MemoryRouter><BlCobrancasSection bl={bl} activeInvoice={{ id: 77, status: 'issued', total_brl: 100 } as never} /></MemoryRouter>)
  expect(screen.getByText('Carregando taxas…')).toBeTruthy()
  expect(screen.queryByText(/As taxas mudaram depois da emissão/)).toBeNull()
  mocks.lines.mockReturnValue({ data: [{ total_value_brl: 100 }], isLoading: false })
  rerender(<MemoryRouter><BlCobrancasSection bl={bl} activeInvoice={{ id: 77, status: 'issued', total_brl: 100 } as never} /></MemoryRouter>)
  expect(screen.queryByText(/As taxas mudaram depois da emissão/)).toBeNull()
})
