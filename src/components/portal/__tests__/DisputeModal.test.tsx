// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { DisputeModal } from '../DisputeModal'
import { ConfirmDialogProvider } from '../../ui/ConfirmDialog'

const openDispute = vi.hoisted(() => vi.fn())
const uploadAttachment = vi.hoisted(() => vi.fn())

vi.mock('../../../hooks/usePortalDisputes', () => ({
  usePortalOpenDispute: () => ({ isPending: false, mutateAsync: openDispute }),
  usePortalUploadDisputeAttachment: () => ({ isPending: false, mutateAsync: uploadAttachment }),
}))

function chooseFile(file: File) {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement
  fireEvent.change(input, { target: { files: [file] } })
}

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

it('anexa o arquivo escolhido na abertura à primeira mensagem da disputa', async () => {
  const user = userEvent.setup()
  const onClose = vi.fn()
  openDispute.mockReset().mockResolvedValue({ dispute_id: 7, message_id: 70 })
  uploadAttachment.mockReset().mockResolvedValue({ id: 1 })
  render(<ConfirmDialogProvider><DisputeModal demurrageInvoiceId={1} docNumber="DEM-A" onClose={onClose} /></ConfirmDialogProvider>)

  expect(screen.getByRole('button', { name: /Anexar arquivo/ })).toBeTruthy()
  const file = new File(['%PDF'], 'eir.pdf', { type: 'application/pdf' })
  chooseFile(file)
  expect(screen.getByText('eir.pdf')).toBeTruthy()
  await user.type(screen.getByLabelText('Motivo da disputa'), 'Dias a mais')
  await user.click(screen.getByRole('button', { name: 'Abrir disputa' }))

  const dialog = await screen.findByRole('dialog', { name: 'Confirmar abertura da disputa' })
  await user.click(within(dialog).getByRole('button', { name: 'Ver lista (3)' }))
  expect(within(dialog).getByText('Anexo: eir.pdf (1 KB)')).toBeTruthy()
  await user.click(within(dialog).getByRole('button', { name: 'Abrir disputa' }))

  expect(openDispute).toHaveBeenCalledWith({ demurrageInvoiceId: 1, reason: 'Dias a mais' })
  expect(uploadAttachment).toHaveBeenCalledWith({ disputeId: 7, messageId: 70, file })
  expect(onClose).toHaveBeenCalled()
})

it('recusa o tipo de arquivo antes de abrir a disputa', async () => {
  const user = userEvent.setup()
  openDispute.mockReset()
  render(<ConfirmDialogProvider><DisputeModal demurrageInvoiceId={1} docNumber="DEM-A" onClose={vi.fn()} /></ConfirmDialogProvider>)

  chooseFile(new File(['x'], 'planilha.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
  await user.type(screen.getByLabelText('Motivo da disputa'), 'Dias a mais')
  await user.click(screen.getByRole('button', { name: 'Abrir disputa' }))

  expect(screen.getByText('Tipo de anexo não permitido. Use PDF, JPG, PNG ou TXT.')).toBeTruthy()
  expect(screen.queryByRole('dialog', { name: 'Confirmar abertura da disputa' })).toBeNull()
  expect(openDispute).not.toHaveBeenCalled()
})

it('com a disputa aberta e o anexo recusado, reenvia só o anexo', async () => {
  const user = userEvent.setup()
  const onClose = vi.fn()
  openDispute.mockReset().mockResolvedValue({ dispute_id: 7, message_id: 70 })
  uploadAttachment.mockReset().mockRejectedValueOnce(new Error('falha de rede')).mockResolvedValueOnce({ id: 1 })
  render(<ConfirmDialogProvider><DisputeModal demurrageInvoiceId={1} docNumber="DEM-A" onClose={onClose} /></ConfirmDialogProvider>)

  const file = new File(['%PDF'], 'eir.pdf', { type: 'application/pdf' })
  chooseFile(file)
  await user.type(screen.getByLabelText('Motivo da disputa'), 'Dias a mais')
  await user.click(screen.getByRole('button', { name: 'Abrir disputa' }))
  await user.click(within(await screen.findByRole('dialog', { name: 'Confirmar abertura da disputa' })).getByRole('button', { name: 'Abrir disputa' }))

  expect(await screen.findByText(/A disputa foi aberta, mas o anexo não pôde ser enviado/)).toBeTruthy()
  expect(onClose).not.toHaveBeenCalled()
  expect((screen.getByLabelText('Motivo da disputa') as HTMLTextAreaElement).disabled).toBe(true)

  await user.click(screen.getByRole('button', { name: 'Reenviar anexo' }))
  await user.click(within(await screen.findByRole('dialog', { name: 'Confirmar envio do anexo' })).getByRole('button', { name: 'Enviar anexo' }))

  expect(openDispute).toHaveBeenCalledTimes(1)
  expect(uploadAttachment).toHaveBeenLastCalledWith({ disputeId: 7, messageId: 70, file })
  expect(onClose).toHaveBeenCalled()
})
