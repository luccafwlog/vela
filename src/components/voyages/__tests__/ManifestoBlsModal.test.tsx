// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  move: vi.fn(),
  unlink: vi.fn(),
  confirmWithReason: vi.fn(),
  showToast: vi.fn(),
}))

const bls = [
  { id: 'BL-1', pol: 'CNSHA', pod: 'BRVIX', cancelled: false, manifestoNumero: '1226501860578' },
  { id: 'BL-2', pol: 'CNSHA', pod: 'BRVIX', cancelled: false, manifestoNumero: '1226501860578' },
  { id: 'BL-3', pol: 'CNSHA', pod: 'BRVIX', cancelled: false, manifestoNumero: null },
  { id: 'BL-4', pol: 'CNSHA', pod: 'BRVIX', cancelled: true, manifestoNumero: null },
  { id: 'BL-9', pol: 'CNSHA', pod: 'BRSSZ', cancelled: false, manifestoNumero: null },
]

vi.mock('../../../hooks/useManifestosMercante', () => ({
  useVoyageBlsForManifesto: () => ({ data: bls, isLoading: false }),
  useMoveBlsToManifestoMercante: () => ({ mutateAsync: mocks.move, isPending: false }),
  useUnlinkBlsFromManifestoMercante: () => ({ mutateAsync: mocks.unlink, isPending: false }),
}))
vi.mock('../../ui/ConfirmDialog', () => ({ useConfirmWithReason: () => mocks.confirmWithReason }))
vi.mock('../../ui/Toast', () => ({ useToast: () => ({ showToast: mocks.showToast }) }))

import { ManifestoBlsModal } from '../ManifestoBlsModal'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function renderModal() {
  return render(<ManifestoBlsModal open voyageId={7} route={{ pol: 'CNSHA', pod: 'BRVIX', label: 'Xangai → Vitória' }} onClose={vi.fn()} />)
}

it('lista só os B/Ls da rota e Shift seleciona o intervalo, sem o cancelado', () => {
  renderModal()
  expect(screen.queryByText('BL-9')).toBeNull()
  fireEvent.click(screen.getByLabelText('Selecionar BL-1'))
  fireEvent.click(screen.getByLabelText('Selecionar BL-3'), { shiftKey: true })
  expect((screen.getByLabelText('Selecionar BL-2') as HTMLInputElement).checked).toBe(true)
  expect((screen.getByLabelText('Selecionar BL-3') as HTMLInputElement).checked).toBe(true)
  // O cancelado não muda de Manifesto e não é selecionável.
  expect((screen.getByLabelText('Selecionar BL-4') as HTMLInputElement).disabled).toBe(true)
})

it('Colar lista seleciona os B/Ls da rota e aponta os que não estão nela', () => {
  renderModal()
  fireEvent.change(screen.getByLabelText(/Lista de B\/Ls/), { target: { value: 'bl-2, BL-3\nBL-9' } })
  fireEvent.click(screen.getByRole('button', { name: 'Selecionar da lista' }))
  expect((screen.getByLabelText('Selecionar BL-2') as HTMLInputElement).checked).toBe(true)
  expect((screen.getByLabelText('Selecionar BL-3') as HTMLInputElement).checked).toBe(true)
  expect(screen.getByText(/Fora desta rota ou cancelados: BL-9/)).toBeTruthy()
})

it('Mover confirma "N B/Ls sairão de … e irão para …" e envia o número canônico com o motivo', async () => {
  mocks.confirmWithReason.mockResolvedValue('Manifesto reemitido')
  mocks.move.mockResolvedValue({ numero: '1226B01849909', created: true, moved: 3, unchanged: 0 })
  renderModal()
  fireEvent.change(screen.getByLabelText(/Buscar/), { target: { value: 'BL-' } })
  fireEvent.click(screen.getByRole('button', { name: 'Selecionar todos os filtrados' }))
  fireEvent.change(screen.getByLabelText(/Mover para/), { target: { value: '1226 b01-849.909' } })
  fireEvent.click(screen.getByRole('button', { name: /^Mover/ }))

  await waitFor(() => expect(mocks.move).toHaveBeenCalledWith({ blIds: ['BL-1', 'BL-2', 'BL-3'], numero: '1226B01849909', reason: 'Manifesto reemitido' }))
  expect(mocks.confirmWithReason).toHaveBeenCalledWith(expect.objectContaining({
    message: '3 B/L(s) sairão de 1226501860578, sem Manifesto e irão para 1226B01849909.',
  }))
})

it('número fora do formato não habilita Mover', () => {
  renderModal()
  fireEvent.click(screen.getByLabelText('Selecionar BL-1'))
  fireEvent.change(screen.getByLabelText(/Mover para/), { target: { value: '123' } })
  expect((screen.getByRole('button', { name: /^Mover/ }) as HTMLButtonElement).disabled).toBe(true)
  expect(screen.getByText('O número tem 13 caracteres, letras ou dígitos.')).toBeTruthy()
})
