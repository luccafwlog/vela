// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  invalidateQueries: vi.fn(),
  markBlReadyAndCreateInvoice: vi.fn(),
  showToast: vi.fn(),
  confirm: vi.fn(),
  isAdmin: true,
  lines: vi.fn(),
}))

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
}))
vi.mock('../../../hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'user-1' }, isAdmin: mocks.isAdmin }),
}))
vi.mock('../../ui/ConfirmDialog', () => ({
  useConfirm: () => mocks.confirm,
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
  useCalculateBlLocalCharges: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))
vi.mock('../../../services/billing', () => ({
  markBlReadyAndCreateInvoice: mocks.markBlReadyAndCreateInvoice,
}))

import { BlCobrancasSection } from '../BlCobrancasTab'

const bl = {
  id: 'BL-1',
  customer_id: 1,
  charge_status: 'calculated',
  financial_status: 'pending',
  ce_mercante: '123456789012345',
} as never

afterEach(cleanup)

beforeEach(() => {
  vi.clearAllMocks()
  mocks.isAdmin = true
  mocks.lines.mockReturnValue({ data: [], isLoading: false })
  mocks.confirm.mockResolvedValue(true)
  mocks.markBlReadyAndCreateInvoice.mockRejectedValue({
    code: 'P0003',
    message: 'Faturamento bloqueado pelo Portal: Portal do Cliente não está ativo.',
  })
})

describe('cobranças do B/L', () => {
  it('não oferece Marcar revisado nem Pronto para faturar', () => {
    render(<BlCobrancasSection bl={bl} />)
    expect(screen.queryByRole('button', { name: 'Marcar revisado' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Pronto para faturar' })).toBeNull()
  })

  it('Emitir fatura pede confirmação e exibe a razão operacional do backend ao falhar', async () => {
    render(<BlCobrancasSection bl={bl} />)

    fireEvent.click(screen.getByRole('button', { name: 'Emitir fatura' }))

    await waitFor(() => {
      expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Emitir fatura' }))
      expect(mocks.markBlReadyAndCreateInvoice).toHaveBeenCalledWith({ blId: 'BL-1', customerId: 1, actorId: 'user-1' })
      expect(mocks.showToast).toHaveBeenCalledWith(
        'Falha ao emitir a fatura: Faturamento bloqueado pelo Portal: Portal do Cliente não está ativo.',
        'error',
      )
    })
  })

  it('não emite sem confirmação', async () => {
    mocks.confirm.mockResolvedValue(false)
    render(<BlCobrancasSection bl={bl} />)
    fireEvent.click(screen.getByRole('button', { name: 'Emitir fatura' }))
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalled())
    expect(mocks.markBlReadyAndCreateInvoice).not.toHaveBeenCalled()
  })

  it('só o Administrativo vê Emitir fatura, e só com CE Mercante', () => {
    mocks.isAdmin = false
    render(<BlCobrancasSection bl={bl} />)
    expect(screen.queryByRole('button', { name: 'Emitir fatura' })).toBeNull()
    cleanup()
    mocks.isAdmin = true
    render(<BlCobrancasSection bl={{ ...(bl as object), ce_mercante: null } as never} />)
    expect(screen.queryByRole('button', { name: 'Emitir fatura' })).toBeNull()
  })

  it('linha que precisa de revisão bloqueia a emissão', () => {
    mocks.lines.mockReturnValue({ data: [{ status: 'review_required' }], isLoading: false })
    render(<BlCobrancasSection bl={bl} />)
    expect((screen.getByRole('button', { name: 'Emitir fatura' }) as HTMLButtonElement).disabled).toBe(true)
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
