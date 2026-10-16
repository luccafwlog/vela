// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
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

const authMock = vi.hoisted(() => ({ isAdmin: true }))
vi.mock('../../../hooks/useAuth', () => ({ useAuth: () => authMock }))
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
  authMock.isAdmin = true
})

afterEach(cleanup)

describe('Acordos de Demurrage — confirmação', () => {
  it('fora do Administrativo edita o acordo sem o controle de ativo e sem o menu de ativar e excluir (P9)', () => {
    authMock.isAdmin = false
    render(<CustomerDemurrageAgreementModal open onClose={vi.fn()} initialAgreement={agreement} />)
    expect(screen.getByLabelText('Free Time (dias) *')).toBeTruthy()
    expect(screen.queryByText('Acordo ativo')).toBeNull()
    cleanup()
    render(<MemoryRouter><CustomerDemurrageAgreementsTab canEdit canManage={false} /></MemoryRouter>)
    expect(screen.getAllByRole('button', { name: /Editar acordo de/ }).length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: /Mais ações/ })).toBeNull()
  })

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

  it('B13: Administrativo edita acordo inativo sem o controle de ativo e sem enviar active', async () => {
    mocks.confirm.mockResolvedValue(true)
    const user = userEvent.setup()
    render(<CustomerDemurrageAgreementModal open onClose={vi.fn()} initialAgreement={{ ...agreement, active: false }} />)
    expect(screen.queryByText('Acordo ativo')).toBeNull()
    await user.clear(screen.getByLabelText('Free Time (dias) *'))
    await user.type(screen.getByLabelText('Free Time (dias) *'), '25')
    await user.click(screen.getByRole('button', { name: 'Salvar Alterações' }))
    await waitFor(() => expect(mocks.save).toHaveBeenCalled())
    expect(mocks.save.mock.calls[0][0]).not.toHaveProperty('active')
  })

  it('confirma a ativação antes de gravar o status', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter><CustomerDemurrageAgreementsTab canEdit canManage /></MemoryRouter>)
    await user.click(screen.getByRole('button', { name: 'Mais ações do acordo de Cliente Sul' }))
    await user.click(screen.getByRole('menuitem', { name: 'Desativar acordo' }))

    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledOnce())
    expect(mocks.confirm.mock.calls[0][0].changes).toEqual([{ field: 'Status', before: 'Ativo', after: 'Inativo' }])
    expect(mocks.toggle).not.toHaveBeenCalled()
  })
})

describe('Acordos de Demurrage — lista e formulário', () => {
  it('abre filtrada pelo Cliente que veio da ficha (?cliente=)', () => {
    render(<MemoryRouter initialEntries={['/demurrage/taxas?tab=acordos&cliente=Norte']}><CustomerDemurrageAgreementsTab canEdit canManage /></MemoryRouter>)
    expect(screen.getByText('Nenhum acordo nesta busca')).toBeTruthy()
  })

  it('mostra a situação do acordo hoje e as diárias herdadas', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      // 31/12 às 22h em Brasília já é 01/01 em UTC: o acordo ainda está vigente.
      vi.setSystemTime(new Date('2027-01-01T01:00:00Z'))
      render(<MemoryRouter><CustomerDemurrageAgreementsTab canEdit={false} canManage={false} /></MemoryRouter>)
      expect(screen.getByText('Vigente')).toBeTruthy()
      expect(screen.getByText('US$ 50,00')).toBeTruthy()
      expect(screen.getByText('US$ 70,00')).toBeTruthy()
      expect(screen.queryByRole('button', { name: /Mais ações/ })).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('free time acima de 365 dias é recusado junto do campo, como a tabela', async () => {
    const user = userEvent.setup()
    render(<CustomerDemurrageAgreementModal open onClose={vi.fn()} initialAgreement={agreement} />)
    await user.clear(screen.getByLabelText('Free Time (dias) *'))
    await user.type(screen.getByLabelText('Free Time (dias) *'), '400')
    await user.click(screen.getByRole('button', { name: 'Salvar Alterações' }))
    expect(screen.getByRole('alert').textContent).toContain('vai até 365 dias')
    expect(mocks.confirm).not.toHaveBeenCalled()
  })

  it('leva o erro para junto do campo, sem confirmar', async () => {
    const user = userEvent.setup()
    render(<CustomerDemurrageAgreementModal open onClose={vi.fn()} initialAgreement={agreement} />)
    await user.clear(screen.getByLabelText('Free Time (dias) *'))
    await user.click(screen.getByRole('button', { name: 'Salvar Alterações' }))
    expect(screen.getByRole('alert').textContent).toContain('Informe os dias de free time')
    expect(mocks.confirm).not.toHaveBeenCalled()
  })
})
