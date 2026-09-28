// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ mutateAsync: vi.fn() }))

vi.mock('../../../hooks/useAppSettings', () => ({
  useAppSettings: () => ({ data: { demurrage_dunning_interval_days: 7 } }),
  useSetDemurrageDunningIntervalDays: () => ({ mutateAsync: mocks.mutateAsync, isPending: false }),
}))

import { ConfirmDialogProvider } from '../../ui/ConfirmDialog'
import { DemurrageDunningSettingsModal } from '../DemurrageDunningSettingsModal'

beforeEach(() => mocks.mutateAsync.mockReset().mockResolvedValue(undefined))

it('previews the interval change and writes only after confirmation', async () => {
  render(<ConfirmDialogProvider><DemurrageDunningSettingsModal open onClose={vi.fn()} /></ConfirmDialogProvider>)

  fireEvent.change(screen.getByRole('spinbutton', { name: /intervalo em dias/i }), { target: { value: '3' } })
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

  fireEvent.change(screen.getByRole('spinbutton', { name: /intervalo em dias/i }), { target: { value: '3' } })
  fireEvent.click(screen.getByRole('button', { name: 'Salvar intervalo' }))
  const dialog = await screen.findByRole('dialog', { name: 'Confirmar intervalo da régua de cobrança' })
  fireEvent.click(within(dialog).getByRole('button', { name: 'Salvar intervalo' }))

  await waitFor(() => expect(mocks.mutateAsync).toHaveBeenCalledWith(3))
})
