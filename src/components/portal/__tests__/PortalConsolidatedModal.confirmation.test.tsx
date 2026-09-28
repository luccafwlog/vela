// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  receivables: [] as Array<Record<string, unknown>>,
  confirm: vi.fn(),
  create: vi.fn(),
  onClose: vi.fn(),
  onCreated: vi.fn(),
}))

vi.mock('../../../hooks/usePortalBilling', () => ({
  usePortalConsolidatableReceivables: () => ({ data: mocks.receivables, isLoading: false }),
  usePortalCreateConsolidation: () => ({ mutateAsync: mocks.create, isPending: false }),
}))
vi.mock('../../../hooks/usePortalScope', () => ({ usePortalScope: () => ({ mode: 'client', customerId: 9, overview: null, basePath: '/portal' }) }))
vi.mock('../../ui/ConfirmDialog', () => ({ useConfirm: () => mocks.confirm }))
vi.mock('../../ui/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }))

import { PortalConsolidatedModal } from '../PortalConsolidatedModal'

function renderModal() {
  render(<PortalConsolidatedModal open onClose={mocks.onClose} onCreated={mocks.onCreated} />)
}

beforeEach(() => {
  mocks.receivables = [{
    receivable_id: 41,
    bl_id: 'BL-PORTAL-41',
    balance_brl: 670,
    eligibility_status: 'eligible',
    receivable_status: 'open',
    voyage_id: 8,
    vessel_name: 'Navio Sul',
    voyage_number: 'V8',
    individual_invoice_id: null,
    individual_invoice_number: null,
    eligibility_reason: null,
  }]
  mocks.confirm.mockReset().mockResolvedValue(false)
  mocks.create.mockReset().mockResolvedValue({ invoice_id: 14 })
  mocks.onClose.mockReset()
  mocks.onCreated.mockReset()
})

afterEach(cleanup)

describe('PortalConsolidatedModal — confirmação da consolidação', () => {
  it('mostra o saldo e o B/L e não grava quando a pessoa volta', async () => {
    const user = userEvent.setup()
    renderModal()

    await user.click(screen.getByRole('checkbox', { name: 'Selecionar B/L BL-PORTAL-41' }))
    await user.click(screen.getByRole('button', { name: 'Consolidar e emitir' }))

    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledOnce())
    const options = mocks.confirm.mock.calls[0][0]
    expect(options.affected.items[0]).toContain('BL-PORTAL-41')
    expect(options.affected.items[0]).toMatch(/R\$\s*670,00/)
    expect(options.consequence).toContain('disponível no Portal')
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('emite somente após confirmação', async () => {
    mocks.confirm.mockResolvedValue(true)
    const user = userEvent.setup()
    renderModal()
    await user.click(screen.getByRole('checkbox', { name: 'Selecionar B/L BL-PORTAL-41' }))
    await user.click(screen.getByRole('button', { name: 'Consolidar e emitir' }))

    await waitFor(() => expect(mocks.create).toHaveBeenCalledWith({ receivableIds: [41] }))
    expect(mocks.onCreated).toHaveBeenCalledWith(14)
  })
})
