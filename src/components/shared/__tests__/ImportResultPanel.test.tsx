// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'

const { useImportEffectsMock, confirmMock, retryMock } = vi.hoisted(() => ({
  useImportEffectsMock: vi.fn(),
  confirmMock: vi.fn(),
  retryMock: vi.fn(),
}))

vi.mock('../../../hooks/useImportEffects', () => ({ useImportEffects: useImportEffectsMock }))
vi.mock('../../ui/ConfirmDialog', () => ({ useConfirm: () => confirmMock }))

import { ImportResultPanel } from '../ImportResultPanel'

const blockedEffect = {
  id: 17,
  source_action_id: 'action-17',
  effect_kind: 'local_billing' as const,
  entity_id: 'BL-17',
  status: 'blocked' as const,
  attempts: 2,
  created_at: '2026-09-07T12:00:00Z',
  created_by: 'user-17',
  source_revision: 1,
  source_snapshot: {},
  depends_on_effect_id: null,
  next_attempt_at: '2026-09-07T12:00:00Z',
  lease_until: null,
  leased_by: null,
  last_error_code: 'effect_failed',
  last_error_message: 'Falha para contato@cliente.example',
  result: null,
  superseded_by_effect_id: null,
  updated_at: '2026-09-07T12:00:00Z',
}

beforeEach(() => {
  useImportEffectsMock.mockReset()
  confirmMock.mockReset()
  retryMock.mockReset()
  confirmMock.mockResolvedValue(true)
  retryMock.mockResolvedValue(undefined)
  useImportEffectsMock.mockReturnValue({
    data: [blockedEffect],
    isPending: false,
    error: null,
    retryMutation: { isPending: false, mutateAsync: retryMock },
  })
})

it('mostra o estado persistido, sanitiza a falha e permite retry auditado', async () => {
  render(<ImportResultPanel entityId="BL-17" />)

  expect(screen.getByTestId('import-result-panel')).toBeTruthy()
  expect(screen.getByText('Cálculo de taxas locais')).toBeTruthy()
  expect(screen.getByText('Bloqueado')).toBeTruthy()
  expect(screen.getByText('Falha para [email]')).toBeTruthy()

  fireEvent.click(screen.getByRole('button', { name: 'Reprocessar efeito' }))

  await waitFor(() => expect(retryMock).toHaveBeenCalledWith({
    effectId: 17,
    justification: 'Reprocessamento solicitado pelo painel de resultado da importação.',
  }))
})

it('não renderiza uma seção vazia para entidade sem efeito', () => {
  useImportEffectsMock.mockReturnValue({
    data: [],
    isPending: false,
    error: null,
    retryMutation: { isPending: false, mutateAsync: retryMock },
  })

  render(<ImportResultPanel entityId="BL-404" />)

  expect(screen.queryByTestId('import-result-panel')).toBeNull()
})

it('erro de consulta oferece Tentar novamente em vez de pedir para recarregar a página', () => {
  const refetch = vi.fn()
  useImportEffectsMock.mockReturnValue({
    data: undefined,
    isPending: false,
    error: new Error('falha'),
    refetch,
    retryMutation: { isPending: false, mutateAsync: retryMock },
  })

  render(<ImportResultPanel entityId="BL-17" />)

  expect(screen.getByRole('alert').textContent).toContain('A importação não é desfeita')
  fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
  expect(refetch).toHaveBeenCalled()
})
