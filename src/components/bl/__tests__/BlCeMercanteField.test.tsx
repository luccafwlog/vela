// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ confirm: vi.fn(), correct: vi.fn() }))

vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn() }) }))
vi.mock('../../ui/ConfirmDialog', () => ({ useConfirmWithReason: () => mocks.confirm }))
vi.mock('../../ui/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }))
vi.mock('../../../services/cacheEffects', () => ({ afterBlEstadoAlterado: vi.fn() }))
vi.mock('../../../services/blCeMercante', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../services/blCeMercante')>()),
  correctBlCeMercante: mocks.correct,
}))

import { BlCeMercanteField } from '../BlCeMercanteField'

afterEach(cleanup)

// Revisão da PR 929 (achado da revisão automática): o primeiro CE entra pela
// planilha de CE Mercante, que também vincula o Manifesto; `correct_bl_ce_mercante`
// recusa B/L sem CE, então a ficha não oferece Corrigir nesse estado.
it('B/L sem CE não oferece Corrigir e aponta a importação de CE Mercante', () => {
  render(<BlCeMercanteField blId="BL-1" voyageId={7} ce={null} />)

  expect(screen.queryByRole('button', { name: 'Corrigir' })).toBeNull()
  expect(screen.queryByLabelText('CE Mercante novo')).toBeNull()
  expect(screen.getByText('O CE entra pela importação de CE Mercante, que também vincula o Manifesto.')).toBeTruthy()
})

it('B/L com CE oferece Corrigir e Remover', () => {
  render(<BlCeMercanteField blId="BL-1" voyageId={7} ce="123456789012345" />)

  expect(screen.getByRole('button', { name: 'Corrigir' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Remover' })).toBeTruthy()
})

// Migration 207 (achado da revisão automática): a correção leva o CE exibido,
// para o banco recusar se outra sessão o trocou com o diálogo aberto.
it('Corrigir manda o CE que a ficha exibia', async () => {
  mocks.confirm.mockResolvedValue('CE digitado errado')
  mocks.correct.mockResolvedValue(undefined)
  render(<BlCeMercanteField blId="BL-1" voyageId={7} ce="123456789012345" />)

  fireEvent.change(screen.getByLabelText('CE Mercante novo'), { target: { value: '123456789012346' } })
  fireEvent.click(screen.getByRole('button', { name: 'Corrigir' }))

  await waitFor(() => expect(mocks.correct).toHaveBeenCalledWith({
    blId: 'BL-1', ce: '123456789012346', reason: 'CE digitado errado', expectedCe: '123456789012345',
  }))
})
