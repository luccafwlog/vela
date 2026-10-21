// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

// ADR 0095, decisão 25 (migration 394): o alerta "Efeito de importação
// bloqueado" tem Reprocessar, com justificativa, mostrando o B/L e o motivo.

const blocked = {
  id: 9, item_id: 109, status: 'open', severity: 'critical', type: 'import_effect_blocked', item_type: 'import_effect_blocked',
  message: 'O faturamento pelo CE do B/L BL-394 está bloqueado: falha técnica', entity_type: 'import_effect', entity_id: '4242',
  department: 'documentacao', created_at: '2026-10-21T00:00:00Z',
  metadata: { effect_id: 4242, effect_kind: 'local_billing', entity_id: 'BL-394', bl_id: 'BL-394', error_code: 'effect_failed', error_message: 'falha técnica' },
}

vi.mock('@tanstack/react-query', () => ({
  useQuery: ({ queryKey }: { queryKey: unknown[] }) => {
    if (queryKey[0] === 'alert-department-summary') return { data: [], isLoading: false, error: null }
    if (queryKey[1] === 'entity-labels') return { data: {}, isLoading: false, error: null }
    return { data: queryKey[1] === 'dismissed' ? [] : [blocked], isLoading: false, error: null }
  },
  useMutation: ({ mutationFn }: { mutationFn: (input: unknown) => Promise<unknown> }) => ({
    mutate: (input: unknown) => void mutationFn(input),
    isPending: false,
  }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}))
vi.mock('../../components/ui/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }))
const confirmWithReason = vi.hoisted(() => vi.fn())
vi.mock('../../components/ui/ConfirmDialog', () => ({ useConfirmWithReason: () => confirmWithReason }))
const retryImportEffect = vi.hoisted(() => vi.fn().mockResolvedValue({}))
vi.mock('../../services/importEffects', () => ({ retryImportEffect }))
const resolveAlertItemWithJustification = vi.hoisted(() => vi.fn())
vi.mock('../../services/alerts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/alerts')>()
  return { ...actual, listAlerts: vi.fn(), resolveAlertItemWithJustification }
})

import { Alertas } from '../Alertas'

afterEach(cleanup)
beforeEach(() => vi.clearAllMocks())

it('Reprocessar mostra o B/L e o motivo e reprocessa o efeito com a justificativa', async () => {
  confirmWithReason.mockResolvedValue('Tabela corrigida')
  render(<MemoryRouter><Alertas /></MemoryRouter>)

  const row = screen.getByText(blocked.message).closest('tr') as HTMLElement
  expect(within(row).queryByRole('button', { name: /^Resolver/ })).toBeNull()
  fireEvent.click(within(row).getByRole('button', { name: /^Reprocessar/ }))

  await waitFor(() => expect(retryImportEffect).toHaveBeenCalledWith(4242, 'Tabela corrigida'))
  const dialog = confirmWithReason.mock.calls[0][0]
  expect(dialog.message).toContain('BL-394')
  expect(dialog.affected.items).toEqual(['falha técnica'])
  expect(resolveAlertItemWithJustification).not.toHaveBeenCalled()
})

it('sem justificativa (diálogo cancelado), nada é reprocessado', async () => {
  confirmWithReason.mockResolvedValue(null)
  render(<MemoryRouter><Alertas /></MemoryRouter>)

  const row = screen.getByText(blocked.message).closest('tr') as HTMLElement
  fireEvent.click(within(row).getByRole('button', { name: /^Reprocessar/ }))
  await waitFor(() => expect(confirmWithReason).toHaveBeenCalled())
  expect(retryImportEffect).not.toHaveBeenCalled()
})
