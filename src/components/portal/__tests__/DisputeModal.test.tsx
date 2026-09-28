// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { DisputeModal } from '../DisputeModal'
import { ConfirmDialogProvider } from '../../ui/ConfirmDialog'

const openDispute = vi.hoisted(() => vi.fn())

vi.mock('../../../hooks/usePortalDisputes', () => ({
  usePortalOpenDispute: () => ({ isPending: false, mutateAsync: openDispute }),
}))

afterEach(cleanup)

it('limpa motivo ao fechar e reabrir para outra fatura', async () => {
  const user = userEvent.setup()
  const onClose = vi.fn()
  const { rerender } = render(<ConfirmDialogProvider><DisputeModal demurrageInvoiceId={1} docNumber="DEM-A" onClose={onClose} /></ConfirmDialogProvider>)

  await user.type(screen.getByLabelText('Motivo da disputa'), 'Valor divergente')
  await user.click(screen.getByRole('button', { name: 'Voltar' }))
  rerender(<ConfirmDialogProvider><DisputeModal demurrageInvoiceId={null} docNumber="" onClose={onClose} /></ConfirmDialogProvider>)
  rerender(<ConfirmDialogProvider><DisputeModal demurrageInvoiceId={2} docNumber="DEM-B" onClose={onClose} /></ConfirmDialogProvider>)

  expect((screen.getByLabelText('Motivo da disputa') as HTMLTextAreaElement).value).toBe('')
})

it('confirma a fatura e o motivo antes de abrir a disputa', async () => {
  const user = userEvent.setup()
  openDispute.mockReset().mockResolvedValue(undefined)
  render(<ConfirmDialogProvider><DisputeModal demurrageInvoiceId={1} docNumber="DEM-A" onClose={vi.fn()} /></ConfirmDialogProvider>)

  await user.type(screen.getByLabelText('Motivo da disputa'), 'Valor divergente')
  await user.click(screen.getByRole('button', { name: 'Abrir disputa' }))

  const dialog = await screen.findByRole('dialog', { name: 'Confirmar abertura da disputa' })
  await user.click(within(dialog).getByRole('button', { name: 'Ver lista (2)' }))
  expect(within(dialog).getByText('Fatura: DEM-A')).toBeTruthy()
  expect(within(dialog).getByText('Motivo: Valor divergente')).toBeTruthy()
  expect(openDispute).not.toHaveBeenCalled()
  fireEvent.click(within(dialog).getByRole('button', { name: 'Voltar' }))
  expect(openDispute).not.toHaveBeenCalled()

  await user.click(screen.getByRole('button', { name: 'Abrir disputa' }))
  const repeatedDialog = await screen.findByRole('dialog', { name: 'Confirmar abertura da disputa' })
  await user.click(within(repeatedDialog).getByRole('button', { name: 'Abrir disputa' }))
  expect(openDispute).toHaveBeenCalledWith({ demurrageInvoiceId: 1, reason: 'Valor divergente' })
})
