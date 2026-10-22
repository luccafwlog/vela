// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const { createVoyageMock, updateVoyageMock, findDuplicateMock, showOnPortalMock, setShowMock } = vi.hoisted(() => ({
  createVoyageMock: vi.fn(),
  updateVoyageMock: vi.fn(),
  findDuplicateMock: vi.fn(),
  showOnPortalMock: vi.fn(),
  setShowMock: vi.fn(),
}))

vi.mock('../../../services/voyages', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../services/voyages')>()),
  createVoyage: createVoyageMock,
  updateVoyage: updateVoyageMock,
  findDuplicateVoyage: findDuplicateMock,
  fetchVoyageShowOnPortal: showOnPortalMock,
  setVoyageShowOnPortal: setShowMock,
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
    findDuplicateMock.mockResolvedValue(null)
    showOnPortalMock.mockResolvedValue(false)
    setShowMock.mockResolvedValue(undefined)
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
      { origin: 'viagens', showOnPortal: false },
    )
  })

  // Revisão de 2026-10-22 (A2): a Viagem nova pode nascer em Chegadas e Saídas.
  it('liga a aparição em Chegadas e Saídas no cadastro', async () => {
    const user = userEvent.setup()
    renderModal()
    await user.type(screen.getByLabelText('Navio'), 'GREEN ITAJAI')
    await user.type(screen.getByLabelText('Numero da viagem'), '11')
    const toggle = screen.getByRole('switch', { name: 'Não aparece em Chegadas e Saídas' })
    await user.click(toggle)
    expect(screen.getByRole('switch', { name: 'Aparece em Chegadas e Saídas' }).getAttribute('aria-checked')).toBe('true')
    await user.click(screen.getByRole('button', { name: 'Cadastrar viagem' }))
    expect(createVoyageMock).toHaveBeenCalledWith(expect.objectContaining({ voyageNumber: '11' }), 'user-1', { origin: 'viagens', showOnPortal: true })
  })

  // Revisão de 2026-10-22 (A1): navio e número já cadastrados.
  it('recusa navio e número já cadastrados antes de gravar, com a viagem existente', async () => {
    const user = userEvent.setup()
    findDuplicateMock.mockResolvedValue({ id: 9, label: 'GREEN ITAJAI / 11', cancelled: false })
    renderModal()
    await user.type(screen.getByLabelText('Navio'), 'GREEN ITAJAI')
    await user.type(screen.getByLabelText('Numero da viagem'), '11')
    await user.click(screen.getByRole('button', { name: 'Cadastrar viagem' }))
    expect(await screen.findByText('Já existe a viagem GREEN ITAJAI / 11. Abra a viagem existente em vez de cadastrar outra.')).toBeTruthy()
    expect(findDuplicateMock).toHaveBeenCalledWith(expect.objectContaining({ vesselName: 'GREEN ITAJAI', voyageNumber: '11', excludeVoyageId: null }))
    expect(createVoyageMock).not.toHaveBeenCalled()
  })

  it('mostra a recusa do banco por duplicidade junto do número, não como falha genérica', async () => {
    const user = userEvent.setup()
    createVoyageMock.mockRejectedValue({ code: '23505', message: 'Já existe a viagem GREEN ITAJAI / 11, cancelada. Reative-a em Viagens em vez de cadastrar outra.' })
    renderModal()
    await user.type(screen.getByLabelText('Navio'), 'GREEN ITAJAI')
    await user.type(screen.getByLabelText('Numero da viagem'), '11')
    await user.click(screen.getByRole('button', { name: 'Cadastrar viagem' }))
    expect(await screen.findByText(/Reative-a em Viagens/)).toBeTruthy()
  })

  it('na edição, publica a viagem oculta e não oferece tirar a que já aparece', async () => {
    const user = userEvent.setup()
    renderModal({ voyageId: 101, initialValues: { vesselName: 'GREEN ITAJAI', voyageNumber: '11' } })
    const toggle = await screen.findByRole('switch', { name: 'Não aparece em Chegadas e Saídas' })
    await waitFor(() => expect((toggle as HTMLButtonElement).disabled).toBe(false))
    await user.click(toggle)
    await user.click(screen.getByRole('button', { name: 'Salvar viagem' }))
    await waitFor(() => expect(setShowMock).toHaveBeenCalledWith(101, true))
    // Mesmo navio e número: a edição não confere duplicidade.
    expect(findDuplicateMock).not.toHaveBeenCalled()

    cleanup()
    showOnPortalMock.mockResolvedValue(true)
    renderModal({ voyageId: 101, initialValues: { vesselName: 'GREEN ITAJAI', voyageNumber: '11' } })
    const shown = await screen.findByRole('switch', { name: 'Aparece em Chegadas e Saídas' })
    expect((shown as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(/sai sozinha com o último ATD, ou por Excluir ou Cancelar/)).toBeTruthy()
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
