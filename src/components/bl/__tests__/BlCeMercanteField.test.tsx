// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn() }) }))
vi.mock('../../ui/ConfirmDialog', () => ({ useConfirmWithReason: () => vi.fn() }))
vi.mock('../../ui/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }))

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
