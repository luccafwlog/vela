// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GraniteRates } from '../GraniteRates'

const mockRates = [
  {
    id: 'rate-1',
    description: 'Taxa de Escaneamento',
    charge_type: 'per_ton',
    unit_value: 12.5,
    currency: 'BRL',
    valid_from: '2026-01-01',
    valid_to: '2026-12-31',
    active: true,
  },
]

const mocks = vi.hoisted(() => ({
  confirm: vi.fn(),
  confirmWithReason: vi.fn(),
  showToast: vi.fn(),
  listGraniteRates: vi.fn(),
  upsertGraniteRate: vi.fn(),
  deleteGraniteRate: vi.fn(),
}))

vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ isAdmin: true, profile: { role: 'administrativo' } }),
}))

vi.mock('../../components/ui/Toast', () => ({
  useToast: () => ({ showToast: mocks.showToast }),
}))

vi.mock('../../components/ui/ConfirmDialog', () => ({
  useConfirm: () => mocks.confirm,
  useConfirmWithReason: () => mocks.confirmWithReason,
}))

vi.mock('../../services/graniteCharges', () => ({
  listGraniteRates: () => mocks.listGraniteRates(),
  upsertGraniteRate: (form: unknown) => mocks.upsertGraniteRate(form),
  deleteGraniteRate: (id: string, reason: string) => mocks.deleteGraniteRate(id, reason),
}))

function renderComponent() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <GraniteRates />
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

describe('GraniteRates - confirmação com diff antes/depois (ADR 0072)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.listGraniteRates.mockResolvedValue([...mockRates])
    mocks.confirm.mockResolvedValue(true)
    mocks.upsertGraniteRate.mockResolvedValue({ id: 'rate-1' })
  })

  it('exibe diálogo de confirmação com diff antes/depois ao editar taxa existente', async () => {
    const user = userEvent.setup()
    renderComponent()

    await waitFor(() => {
      expect(screen.getByText('Taxa de Escaneamento')).toBeTruthy()
    })

    const editBtn = screen.getByRole('button', { name: 'Editar' })
    await user.click(editBtn)

    expect(screen.getByText('Editar taxa')).toBeTruthy()

    const inputDesc = screen.getByPlaceholderText('Ex: Taxa de agenciamento')
    await user.clear(inputDesc)
    await user.type(inputDesc, 'Taxa de Escaneamento Atualizada')

    const saveBtn = screen.getByRole('button', { name: /^salvar$/i })
    await user.click(saveBtn)

    expect(mocks.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Salvar taxa de Granito',
        confirmLabel: 'Salvar alterações',
        changes: expect.arrayContaining([
          expect.objectContaining({
            field: 'Descrição',
            before: 'Taxa de Escaneamento',
            after: 'Taxa de Escaneamento Atualizada',
          }),
        ]),
      }),
    )
    expect(mocks.upsertGraniteRate).toHaveBeenCalled()
    expect(mocks.showToast).toHaveBeenCalledWith('Taxa salva.', 'success')
  })

  it('não executa mutação se usuário fechar no Voltar', async () => {
    mocks.confirm.mockResolvedValue(false)
    const user = userEvent.setup()
    renderComponent()

    await waitFor(() => {
      expect(screen.getByText('Taxa de Escaneamento')).toBeTruthy()
    })

    const editBtn = screen.getByRole('button', { name: 'Editar' })
    await user.click(editBtn)

    const inputDesc = screen.getByPlaceholderText('Ex: Taxa de agenciamento')
    await user.clear(inputDesc)
    await user.type(inputDesc, 'Nome Novo')

    const saveBtn = screen.getByRole('button', { name: /^salvar$/i })
    await user.click(saveBtn)

    expect(mocks.confirm).toHaveBeenCalled()
    expect(mocks.upsertGraniteRate).not.toHaveBeenCalled()
  })

  it('exibe diálogo de confirmação ao alternar status ativo/inativo', async () => {
    const user = userEvent.setup()
    renderComponent()

    await waitFor(() => {
      expect(screen.getByText('Taxa de Escaneamento')).toBeTruthy()
    })

    const toggleBtn = screen.getByRole('button', { name: 'Ativa' })
    await user.click(toggleBtn)

    expect(mocks.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Desativar taxa de Granito',
        confirmLabel: 'Desativar',
        tone: 'danger',
      }),
    )
    expect(mocks.upsertGraniteRate).toHaveBeenCalledWith(
      expect.objectContaining({ active: false }),
    )
  })
})
