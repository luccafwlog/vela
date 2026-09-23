// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { PortalDisputeConversation } from '../PortalDisputeConversation'

const mutateAddMessageMock = vi.fn()
const checkEligibilityMock = vi.fn()
const uploadAttachmentMock = vi.fn()

vi.mock('../../../hooks/usePortalDisputes', () => ({
  usePortalAddDisputeMessage: vi.fn(() => ({
    mutateAsync: (...args: unknown[]) => mutateAddMessageMock(...args),
    isPending: false,
  })),
  usePortalRequestDisputeReopen: vi.fn(() => ({
    mutateAsync: vi.fn(),
    isPending: false,
  })),
}))

vi.mock('../../../services/portalBilling', () => ({
  portalCheckDisputeAttachmentEligibility: (...args: unknown[]) => checkEligibilityMock(...args),
  portalUploadDisputeAttachment: (...args: unknown[]) => uploadAttachmentMock(...args),
}))

describe('PortalDisputeConversation', () => {
  const mockDispute = {
    id: 1,
    demurrage_invoice_id: 1,
    doc_number: 'DEM-123',
    state: 'aberta' as const,
    next_responder: 'cliente' as const,
    subject: 'Test Subject',
    created_at: '2023-01-01T00:00:00Z',
    updated_at: '2023-01-01T00:00:00Z',
    messages: [],
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the dispute doc_number and status', () => {
    render(<PortalDisputeConversation disputes={[mockDispute]} />)
    expect(screen.getByText('DEM-123')).toBeTruthy()
    expect(screen.getByText('Aberta')).toBeTruthy()
  })

  it('renders a form for new messages when state is aberta', () => {
    render(<PortalDisputeConversation disputes={[mockDispute]} />)
    expect(screen.getByPlaceholderText('Responda à conversa...')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Enviar/ })).toBeTruthy()
  })

  it('renders a reopen request form when state is resolvida', () => {
    const resolvedDispute = { ...mockDispute, state: 'resolvida' as const }
    render(<PortalDisputeConversation disputes={[resolvedDispute]} />)
    expect(screen.getByPlaceholderText('Explique por que a disputa deve ser reaberta...')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Solicitar reabertura/ })).toBeTruthy()
  })

  it('V-A2: pré-validação bloqueia envio e não grava mensagem quando cota é excedida', async () => {
    checkEligibilityMock.mockRejectedValueOnce(new Error('Quota de armazenamento de anexos de 100 MB excedida.'))
    render(<PortalDisputeConversation disputes={[mockDispute]} />)

    const textarea = screen.getByPlaceholderText('Responda à conversa...')
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['conteudo'], 'doc.pdf', { type: 'application/pdf' })

    fireEvent.change(textarea, { target: { value: 'Segue anexo' } })
    fireEvent.change(input, { target: { files: [file] } })

    const sendBtn = screen.getByRole('button', { name: /Enviar mensagem/ })
    fireEvent.click(sendBtn)

    expect(await screen.findByText('Quota de armazenamento de anexos de 100 MB excedida.')).toBeTruthy()
    // A mensagem NÃO foi gravada na conversa
    expect(mutateAddMessageMock).not.toHaveBeenCalled()
  })

  it('V-A2: se o upload falhar após a mensagem ser gravada, permite reenviar o anexo retido', async () => {
    checkEligibilityMock.mockResolvedValueOnce(true)
    mutateAddMessageMock.mockResolvedValueOnce({ message_id: 456 })
    uploadAttachmentMock.mockRejectedValueOnce(new Error('Falha de rede ao transferir anexo.'))

    render(<PortalDisputeConversation disputes={[mockDispute]} />)

    const textarea = screen.getByPlaceholderText('Responda à conversa...')
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['conteudo'], 'doc.pdf', { type: 'application/pdf' })

    fireEvent.change(textarea, { target: { value: 'Segue anexo' } })
    fireEvent.change(input, { target: { files: [file] } })

    const sendBtn = screen.getByRole('button', { name: /Enviar mensagem/ })
    fireEvent.click(sendBtn)

    expect(await screen.findByText(/Sua mensagem foi registrada, mas o anexo não pôde ser enviado/)).toBeTruthy()

    // O botão agora oferece reenvio do anexo
    const retryBtn = screen.getByRole('button', { name: 'Reenviar anexo' })
    expect(retryBtn).toBeTruthy()

    uploadAttachmentMock.mockResolvedValueOnce({ id: 999 })
    fireEvent.click(retryBtn)

    // O segundo upload foi chamado com o mesmo message_id da mensagem já gravada, sem criar duplicata
    expect(uploadAttachmentMock).toHaveBeenCalledWith(456, 1, file, expect.anything())
    expect(mutateAddMessageMock).toHaveBeenCalledTimes(1)
  })
})
