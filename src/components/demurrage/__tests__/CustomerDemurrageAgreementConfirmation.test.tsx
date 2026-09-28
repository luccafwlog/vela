// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  confirm: vi.fn(),
  confirmWithReason: vi.fn(),
  save: vi.fn(),
  toggle: vi.fn(),
  remove: vi.fn(),
  showToast: vi.fn(),
}))

const agreement = {
  id: 12,
  customer_id: 9,
  free_days: 21,
  p1_usd: 50,
  p2_usd: 70,
  valid_from: '2026-01-01',
  valid_to: '2026-12-31',
  active: true,
  notes: 'Acordo 2026',
  created_at: '2025-12-01T00:00:00Z',
  updated_at: '2025-12-01T00:00:00Z',
  customer: { id: 9, name: 'Cliente Sul', cnpj_cpf: '11222333000181' },
}

vi.mock('../../../hooks/useCustomerDemurrageAgreements', () => ({
  useSaveCustomerDemurrageAgreement: () => ({ mutateAsync: mocks.save, isPending: false }),
  useCustomerDemurrageAgreements: () => ({ data: [agreement], isLoading: false, error: null }),
  useDeleteCustomerDemurrageAgreement: () => ({ mutate: mocks.remove, isPending: false }),
  useToggleCustomerDemurrageAgreementActive: () => ({ mutate: mocks.toggle, isPending: false }),
}))
vi.mock('../../../services/charges/chargeRateService', () => ({ listOverrideCustomers: vi.fn().mockResolvedValue([]) }))
vi.mock('../../ui/ConfirmDialog', () => ({
  useConfirm: () => mocks.confirm,
  useConfirmWithReason: () => mocks.confirmWithReason,
}))
vi.mock('../../ui/Toast', () => ({ useToast: () => ({ showToast: mocks.showToast }) }))

import { CustomerDemurrageAgreementsTab } from '../CustomerDemurrageAgreementsTab'
import { CustomerDemurrageAgreementModal } from '../CustomerDemurrageAgreementModal'

beforeEach(() => {
  mocks.confirm.mockReset().mockResolvedValue(false)
  mocks.confirmWithReason.mockReset().mockResolvedValue('correção')
  mocks.save.mockReset().mockResolvedValue(undefined)
  mocks.toggle.mockReset()
  mocks.remove.mockReset()
  mocks.showToast.mockReset()
})

afterEach(cleanup)

describe('Acordos de Demurrage — confirmação', () => {
  it('mostra o diff de edição e não salva quando a pessoa volta', async () => {
    const user = userEvent.setup()
    render(<CustomerDemurrageAgreementModal open onClose={vi.fn()} initialAgreement={agreement} />)

    await user.clear(screen.getByLabelText('Free Time (dias) *'))
    await user.type(screen.getByLabelText('Free Time (dias) *'), '25')
    await user.click(screen.getByRole('button', { name: 'Salvar Alterações' }))

    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledOnce())
    expect(mocks.confirm.mock.calls[0][0].changes).toContainEqual({
      field: 'Free Time (dias)', before: '21', after: '25',
    })
    expect(mocks.confirm.mock.calls[0][0].consequence).toContain('data de descarga')
    expect(mocks.save).not.toHaveBeenCalled()
  })

  it('salva os valores confirmados', async () => {
    mocks.confirm.mockResolvedValue(true)
    const user = userEvent.setup()
    render(<CustomerDemurrageAgreementModal open onClose={vi.fn()} initialAgreement={agreement} />)
    await user.clear(screen.getByLabelText('Free Time (dias) *'))
    await user.type(screen.getByLabelText('Free Time (dias) *'), '25')
    await user.click(screen.getByRole('button', { name: 'Salvar Alterações' }))

    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ id: 12, customer_id: 9, free_days: 25 })))
  })

  it('confirma a ativação antes de gravar o status', async () => {
    const user = userEvent.setup()
    render(<CustomerDemurrageAgreementsTab canEdit />)
    await user.click(screen.getByRole('button', { name: 'Ativo' }))

    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledOnce())
    expect(mocks.confirm.mock.calls[0][0].changes).toEqual([{ field: 'Status', before: 'Ativo', after: 'Inativo' }])
    expect(mocks.toggle).not.toHaveBeenCalled()
  })
})
