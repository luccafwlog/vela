// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  confirm: vi.fn(),
  settle: vi.fn(),
  showToast: vi.fn(),
}))

const rows = [{
  id: 17,
  bl_id: 'BL-COD-17',
  omission_id: 4,
  original_value_brl: 100,
  new_destination_value_brl: 70,
  difference_brl: -30,
  paid_amount_brl: 100,
  outstanding_balance_brl: 0,
  offset_amount_brl: 0,
  refund_amount_brl: 30,
  action: 'refund_overpayment',
  status: 'pending',
  manual_review_required: false,
  resulting_document_id: null,
  resulting_document_type: null,
  created_at: '2026-09-28T12:00:00Z',
}]

vi.mock('../../../hooks/useAuth', () => ({ useAuth: () => ({ can: () => true }) }))
vi.mock('../../../hooks/useBillingLedger', () => ({
  usePendingCodAdjustments: () => ({ data: rows, isSuccess: true, isLoading: false, error: null }),
  useSettleCodAdjustment: () => ({ mutateAsync: mocks.settle, isPending: false, variables: null }),
}))
vi.mock('../../ui/ConfirmDialog', () => ({ useConfirm: () => mocks.confirm }))
vi.mock('../../ui/Toast', () => ({ useToast: () => ({ showToast: mocks.showToast }) }))

import { CodAdjustmentsPanel } from '../CodAdjustmentsPanel'

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter><CodAdjustmentsPanel /></MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  mocks.confirm.mockReset().mockResolvedValue(false)
  mocks.settle.mockReset().mockResolvedValue(undefined)
  mocks.showToast.mockReset()
})

afterEach(cleanup)

describe('CodAdjustmentsPanel — confirmação de liquidação', () => {
  it('mostra os valores e não liquida se a pessoa voltar', async () => {
    const user = userEvent.setup()
    renderPanel()

    await user.click(screen.getByRole('button', { name: 'Registrar restituição' }))

    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledOnce())
    const options = mocks.confirm.mock.calls[0][0]
    expect(options.affected.summary).toContain('BL-COD-17')
    expect(options.affected.items.join('\n')).toMatch(/Restituição a registrar: R\$\s*30,00/)
    expect(options.consequence).toContain('Esta ação não transfere dinheiro')
    expect(mocks.settle).not.toHaveBeenCalled()
  })

  it('liquida apenas depois da confirmação', async () => {
    mocks.confirm.mockResolvedValue(true)
    const user = userEvent.setup()
    renderPanel()

    await user.click(screen.getByRole('button', { name: 'Registrar restituição' }))

    await waitFor(() => expect(mocks.settle).toHaveBeenCalledWith(17))
  })
})
