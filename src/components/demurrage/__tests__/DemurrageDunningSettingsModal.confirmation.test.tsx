// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ mutateAsync: vi.fn(), role: 'administrativo' }))

vi.mock('../../../hooks/useAuth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../hooks/useAuth')>()
  return { useAuth: () => ({ effectiveRole: mocks.role, can: (permission: Parameters<typeof actual.roleHasPermission>[1]) => actual.roleHasPermission(mocks.role as 'administrativo', permission) }) }
})

vi.mock('../../../hooks/useAppSettings', () => ({
  useAppSettings: () => ({ data: { demurrage_dunning_interval_days: 7 } }),
  useSetDemurrageDunningIntervalDays: () => ({ mutateAsync: mocks.mutateAsync, isPending: false }),
}))

import { ConfirmDialogProvider } from '../../ui/ConfirmDialog'
import { DemurrageDunningSettingsModal } from '../DemurrageDunningSettingsModal'

beforeEach(() => mocks.mutateAsync.mockReset().mockResolvedValue(undefined))

it('previews the interval change and writes only after confirmation', async () => {
  render(<ConfirmDialogProvider><DemurrageDunningSettingsModal open onClose={vi.fn()} /></ConfirmDialogProvider>)

  fireEvent.change(screen.getByRole('spinbutton', { name: /intervalo entre cobranças/i }), { target: { value: '3' } })
  fireEvent.click(screen.getByRole('button', { name: 'Salvar intervalo' }))

  const dialog = await screen.findByRole('dialog', { name: 'Confirmar intervalo da régua de cobrança' })
  const table = within(dialog).getByRole('table', { name: 'Campos alterados' })
  expect(within(table).getByText('7 dias')).toBeTruthy()
  expect(within(table).getByText('3 dias')).toBeTruthy()
  expect(mocks.mutateAsync).not.toHaveBeenCalled()

  fireEvent.click(within(dialog).getByRole('button', { name: 'Voltar' }))
  expect(mocks.mutateAsync).not.toHaveBeenCalled()
})

it('persists the interval after the displayed change is confirmed', async () => {
  render(<ConfirmDialogProvider><DemurrageDunningSettingsModal open onClose={vi.fn()} /></ConfirmDialogProvider>)

  fireEvent.change(screen.getByRole('spinbutton', { name: /intervalo entre cobranças/i }), { target: { value: '3' } })
  fireEvent.click(screen.getByRole('button', { name: 'Salvar intervalo' }))
  const dialog = await screen.findByRole('dialog', { name: 'Confirmar intervalo da régua de cobrança' })
  fireEvent.click(within(dialog).getByRole('button', { name: 'Salvar intervalo' }))

  await waitFor(() => expect(mocks.mutateAsync).toHaveBeenCalledWith(3))
})

it('mostra o intervalo e o motivo, sem formulário, para quem a RPC recusa', () => {
  mocks.role = 'operacoes'
  render(<ConfirmDialogProvider><DemurrageDunningSettingsModal open onClose={vi.fn()} /></ConfirmDialogProvider>)
  expect(screen.queryByRole('spinbutton')).toBeNull()
  expect(screen.queryByRole('button', { name: 'Salvar intervalo' })).toBeNull()
  expect(screen.getByText(/Só o Administrativo, o Financeiro e Equipamentos alteram o intervalo/)).toBeTruthy()
  mocks.role = 'administrativo'
})

it.each(['financeiro', 'equipamentos'])('%s também altera o intervalo da Régua (migration 583)', (role) => {
  mocks.role = role
  render(<ConfirmDialogProvider><DemurrageDunningSettingsModal open onClose={vi.fn()} /></ConfirmDialogProvider>)
  expect(screen.getAllByRole('spinbutton').length).toBeGreaterThan(0)
  mocks.role = 'administrativo'
})
