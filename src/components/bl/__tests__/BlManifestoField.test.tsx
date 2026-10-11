// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  move: vi.fn(),
  unlink: vi.fn(),
  confirmWithReason: vi.fn(),
  showToast: vi.fn(),
  invalidateQueries: vi.fn(),
}))

vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }) }))
vi.mock('../../../hooks/useManifestosMercante', () => ({
  useMoveBlsToManifestoMercante: () => ({ mutateAsync: mocks.move, isPending: false }),
  useUnlinkBlsFromManifestoMercante: () => ({ mutateAsync: mocks.unlink, isPending: false }),
}))
vi.mock('../../ui/ConfirmDialog', () => ({ useConfirmWithReason: () => mocks.confirmWithReason }))
vi.mock('../../ui/Toast', () => ({ useToast: () => ({ showToast: mocks.showToast }) }))

import { BlManifestoField } from '../BlManifestoField'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function invalidatedKeys(): string[] {
  return mocks.invalidateQueries.mock.calls.map(([input]) => JSON.stringify((input as { queryKey: unknown[] }).queryKey))
}

it('Mover de Manifesto atualiza a ficha e o Histórico do B/L (bl-timeline)', async () => {
  mocks.confirmWithReason.mockResolvedValue('Manifesto reemitido')
  mocks.move.mockResolvedValue({ numero: '1226B01849909', created: false, moved: 1, unchanged: 0 })
  render(<BlManifestoField blId="BL-1" voyageId={7} numero="1226501860578" />)

  fireEvent.change(screen.getByLabelText('Mover para o Nº de Manifesto Mercante'), { target: { value: '1226B01849909' } })
  fireEvent.click(screen.getByRole('button', { name: 'Mover' }))

  await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith('B/L movido para o Manifesto 1226B01849909.', 'success'))
  expect(invalidatedKeys()).toEqual(expect.arrayContaining(['["bl-timeline"]', '["audit-logs","bl","BL-1"]']))
})

it('Desvincular também atualiza o Histórico do B/L', async () => {
  mocks.confirmWithReason.mockResolvedValue('B/L de outro Manifesto')
  mocks.unlink.mockResolvedValue({ unlinked: 1 })
  render(<BlManifestoField blId="BL-1" voyageId={7} numero="1226501860578" />)

  fireEvent.click(screen.getByRole('button', { name: 'Desvincular' }))

  await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith('B/L desvinculado do Manifesto Mercante.', 'success'))
  expect(invalidatedKeys()).toContain('["bl-timeline"]')
})
