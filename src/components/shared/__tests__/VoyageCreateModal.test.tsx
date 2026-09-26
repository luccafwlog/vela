// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const { createVoyageMock, updateVoyageMock } = vi.hoisted(() => ({
  createVoyageMock: vi.fn(),
  updateVoyageMock: vi.fn(),
}))

vi.mock('../../../services/voyages', () => ({
  createVoyage: createVoyageMock,
  updateVoyage: updateVoyageMock,
}))

vi.mock('../../../hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'user-1' } }),
}))

vi.mock('../../ui/Toast', () => ({
  useToast: () => ({ showToast: vi.fn() }),
}))

import { VoyageCreateModal } from '../VoyageCreateModal'
import { ConfirmDialogProvider } from '../../ui/ConfirmDialog'

function renderModal(props: Partial<Parameters<typeof VoyageCreateModal>[0]> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <ConfirmDialogProvider>
        <VoyageCreateModal
          open={true}
          onClose={vi.fn()}
          {...props}
        />
      </ConfirmDialogProvider>
    </QueryClientProvider>,
  )
}

describe('VoyageCreateModal', () => {
  afterEach(cleanup)
  beforeEach(() => {
    vi.clearAllMocks()
    createVoyageMock.mockResolvedValue({ id: 101 })
    updateVoyageMock.mockResolvedValue({ id: 101 })
  })

  it('renderiza o formulário padrão com indicação desativada', () => {
    renderModal()
    expect(screen.getByLabelText('Armador')).toBeTruthy()
    expect(screen.getByLabelText('Navio')).toBeTruthy()
    expect(screen.getByLabelText('Numero da viagem')).toBeTruthy()
    const checkbox = screen.getByLabelText('Indicar outro 1º porto brasileiro') as HTMLInputElement
    expect(checkbox.checked).toBe(false)
    expect(screen.queryByLabelText('Porto indicado')).toBeNull()
    expect(screen.queryByLabelText('ETA indicado')).toBeNull()
  })

  it('mantém o toggle de 1º porto desabilitado na criação', () => {
    renderModal()
    expect((screen.getByLabelText('Indicar outro 1º porto brasileiro') as HTMLInputElement).disabled).toBe(true)
    expect(screen.getByText('Disponível depois que a viagem tiver ao menos uma escala.')).toBeTruthy()
  })

  it('limpa os campos indicados ao desativar o toggle', async () => {
    const user = userEvent.setup()
    renderModal({
      voyageId: 101,
      initialValues: {
        indicatedFirstBrazilianPort: 'BRSSZ',
        indicatedFirstBrazilianEta: '2026-07-01',
      },
    })

    const checkbox = screen.getByLabelText('Indicar outro 1º porto brasileiro') as HTMLInputElement
    expect(checkbox.checked).toBe(true)
    expect((screen.getByLabelText('Porto indicado') as HTMLInputElement).value).toBe('BRSSZ')

    await user.click(checkbox)
    expect(checkbox.checked).toBe(false)
    expect(screen.queryByLabelText('Porto indicado')).toBeNull()
  })

  it('envia dados indicados no salvamento de nova viagem', async () => {
    const user = userEvent.setup()
    const onSaved = vi.fn()
    renderModal({ onSaved })

    await user.type(screen.getByLabelText('Navio'), 'COSCO SHIPPING PLAN')
    await user.type(screen.getByLabelText('Numero da viagem'), '045E')

    await user.click(screen.getByRole('button', { name: 'Cadastrar viagem' }))

    expect(createVoyageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        vesselName: 'COSCO SHIPPING PLAN',
        voyageNumber: '045E',
      }),
      'user-1',
    )
  })

  it('pede confirmação antes de descartar alterações não salvas', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    renderModal({ onClose })

    await user.type(screen.getByLabelText('Navio'), 'QA SCRATCH')
    await user.click(screen.getByRole('button', { name: 'Voltar' }))

    expect(screen.getByRole('heading', { name: 'Descartar alterações?' })).toBeTruthy()
    expect(onClose).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Descartar alterações' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('fecha diretamente sem confirmação quando o formulário permanece limpo', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    renderModal({ onClose })

    await user.click(screen.getByRole('button', { name: 'Voltar' }))

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('heading', { name: 'Descartar alterações?' })).toBeNull()
  })
})
