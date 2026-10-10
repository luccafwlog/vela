// @vitest-environment jsdom

import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { BlDemurrageSection } from '../BlDemurrageSection'
import type { BLDetail } from '../../../types/database'

const mocks = vi.hoisted(() => ({
  confirm: vi.fn(),
  confirmWithReason: vi.fn(),
  showToast: vi.fn(),
  saveBlDemurrageConfig: vi.fn(),
  updateContainerReturnDate: vi.fn(),
}))

vi.mock('../../../hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'user-1' } }),
}))

vi.mock('../../../hooks/useCustomerDemurrageAgreements', () => ({
  useCustomerDemurrageAgreements: () => ({ data: [] }),
}))

vi.mock('../../../services/blDemurrageConfig', () => ({
  saveBlDemurrageConfig: (args: unknown) => mocks.saveBlDemurrageConfig(args),
}))

vi.mock('../../../services/demurrage/demurrageRates', () => ({
  ensureDemurrageRatesLoaded: () => Promise.resolve(),
  calculateDemurrage: () => ({
    status: 'within_free_time',
    total_days: 10,
    free_days: 10,
    days_p1: 0,
    rate_p1_usd: 50,
    days_p2: 0,
    rate_p2_usd: 80,
    total_usd: 0,
  }),
}))

vi.mock('../../../services/demurrage/demurrageContainers', () => ({
  updateContainerReturnDate: (id: number, date: string | null, reason?: string | null) =>
    mocks.updateContainerReturnDate(id, date, ...(reason ? [reason] : [])),
}))

vi.mock('../../ui/Toast', () => ({
  useToast: () => ({ showToast: mocks.showToast }),
}))

vi.mock('../../ui/ConfirmDialog', () => ({
  useConfirm: () => mocks.confirm,
  useConfirmWithReason: () => mocks.confirmWithReason,
}))

const mockContainer = {
  id: 101,
  container_number: 'MSCU1234567',
  container_type: '40HC',
  discharge_date: '2026-05-01',
  return_date: '2026-05-10',
}

const mockBl: BLDetail = {
  id: 'bl-123',
  bl_number: 'BL123456',
  customer_id: 1,
  free_time_override: 10,
  demurrage_rate_override_p1_usd: 50,
  demurrage_rate_override_p2_usd: 80,
  containers: [mockContainer as never],
  bl_containers: [mockContainer as never],
} as unknown as BLDetail

function renderComponent(bl = mockBl) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter><BlDemurrageSection bl={bl} /></MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('BlDemurrageSection - confirmação com diff antes/depois (ADR 0072)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.confirm.mockResolvedValue(true)
    mocks.saveBlDemurrageConfig.mockResolvedValue(undefined)
    mocks.updateContainerReturnDate.mockResolvedValue(undefined)
  })

  it('exibe diálogo de confirmação com diff ao alterar overrides de Demurrage', async () => {
    const user = userEvent.setup()
    renderComponent()

    const freeTimeInput = screen.getByDisplayValue('10')
    await user.clear(freeTimeInput)
    await user.type(freeTimeInput, '15')

    const saveBtn = screen.getByRole('button', { name: /salvar condições/i })
    await user.click(saveBtn)

    expect(mocks.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Salvar condições de Demurrage',
        changes: expect.arrayContaining([
          expect.objectContaining({
            field: 'Free Time',
            before: '10 dias',
            after: '15 dias',
          }),
        ]),
      }),
    )
    expect(mocks.saveBlDemurrageConfig).toHaveBeenCalled()
  })

  it('não executa saveBlDemurrageConfig se o usuário fechar no Voltar', async () => {
    mocks.confirm.mockResolvedValue(false)
    const user = userEvent.setup()
    renderComponent()

    const freeTimeInput = screen.getByDisplayValue('10')
    await user.clear(freeTimeInput)
    await user.type(freeTimeInput, '20')

    const saveBtn = screen.getByRole('button', { name: /salvar condições/i })
    await user.click(saveBtn)

    expect(mocks.confirm).toHaveBeenCalled()
    expect(mocks.saveBlDemurrageConfig).not.toHaveBeenCalled()
  })

  it('devolução salva acompanha a data de uma importação seguinte', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    try {
      const view = render(<QueryClientProvider client={client}><MemoryRouter><BlDemurrageSection bl={mockBl} /></MemoryRouter></QueryClientProvider>)
      fireEvent.change(screen.getByDisplayValue('2026-05-10'), { target: { value: '2026-05-20' } })
      fireEvent.click(screen.getByRole('button', { name: /Salvar devolução/ }))
      await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith('Data de devolução salva.', 'success'))
      const imported = { ...mockBl, bl_containers: [{ ...mockContainer, return_date: '2026-05-25' }] } as unknown as BLDetail
      view.rerender(<QueryClientProvider client={client}><MemoryRouter><BlDemurrageSection bl={imported} /></MemoryRouter></QueryClientProvider>)
      expect(screen.getByDisplayValue('2026-05-25')).toBeTruthy()
      expect(screen.queryByDisplayValue('2026-05-20')).toBeNull()
    } finally { client.clear() }
  })

  it('mantém a data confirmada quando a releitura da ficha falha', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
    function Detail() {
      const { data } = useQuery({ queryKey: ['bl-detail', mockBl.id], initialData: mockBl, queryFn: async (): Promise<BLDetail> => { throw new Error('Falha na consulta') } })
      return <BlDemurrageSection bl={data} />
    }
    try {
      render(<QueryClientProvider client={client}><MemoryRouter><Detail /></MemoryRouter></QueryClientProvider>)
      fireEvent.change(screen.getByDisplayValue('2026-05-10'), { target: { value: '2026-05-20' } })
      fireEvent.click(screen.getByRole('button', { name: /Salvar devolução/ }))
      await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith('Data de devolução salva.', 'success'))
      expect(screen.getByDisplayValue('2026-05-20')).toBeTruthy()
      expect(client.getQueryState(['bl-detail', mockBl.id])?.status).toBe('error')
    } finally { client.clear() }
  })

  it('preserva a próxima edição enquanto a devolução anterior é salva', async () => {
    let finish!: () => void
    mocks.updateContainerReturnDate.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve }))
    const client = new QueryClient()
    try {
      render(<QueryClientProvider client={client}><MemoryRouter><BlDemurrageSection bl={mockBl} /></MemoryRouter></QueryClientProvider>)
      fireEvent.change(screen.getByDisplayValue('2026-05-10'), { target: { value: '2026-05-20' } })
      fireEvent.click(screen.getByRole('button', { name: /Salvar devolução/ }))
      await waitFor(() => expect(mocks.updateContainerReturnDate).toHaveBeenCalled())
      fireEvent.change(screen.getByDisplayValue('2026-05-20'), { target: { value: '2026-05-25' } })
      await act(async () => { finish() })
      await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith('Data de devolução salva.', 'success'))
      expect(screen.getByDisplayValue('2026-05-25')).toBeTruthy()
    } finally { client.clear() }
  })

  it('exibe diálogo de confirmação com diff ao salvar data de devolução do container', async () => {
    const user = userEvent.setup()
    renderComponent()

    const dateInput = screen.getByDisplayValue('2026-05-10')
    await user.clear(dateInput)
    await user.type(dateInput, '2026-05-20')

    const saveBtn = screen.getByRole('button', { name: /Salvar devolução/ })
    await user.click(saveBtn)

    expect(mocks.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Salvar data de devolução',
        changes: expect.arrayContaining([
          expect.objectContaining({
            field: 'Data de devolução',
            before: '10/05/2026',
            after: '20/05/2026',
          }),
        ]),
      }),
    )
    expect(mocks.updateContainerReturnDate).toHaveBeenCalledWith(101, '2026-05-20')
  })

  it('remover a devolução gravada pede motivo e o envia ao banco', async () => {
    mocks.confirmWithReason.mockResolvedValue('Devolução lançada no container errado')
    renderComponent()

    fireEvent.change(screen.getByDisplayValue('2026-05-10'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: /Salvar devolução/ }))

    await waitFor(() => expect(mocks.updateContainerReturnDate).toHaveBeenCalledWith(101, null, 'Devolução lançada no container errado'))
    expect(mocks.confirm).not.toHaveBeenCalledWith(expect.objectContaining({ title: 'Salvar data de devolução' }))
    expect(mocks.confirmWithReason).toHaveBeenCalledWith(expect.objectContaining({ title: 'Remover data de devolução' }))
  })
})
