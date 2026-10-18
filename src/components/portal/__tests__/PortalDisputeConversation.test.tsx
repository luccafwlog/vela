// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { PortalDisputeConversation, PortalDisputesScreen } from '../PortalDisputeConversation'
import { ConfirmDialogProvider } from '../../ui/ConfirmDialog'

const mutateAddMessageMock = vi.fn()
const checkEligibilityMock = vi.fn()
const uploadAttachmentMock = vi.fn()

function renderConversation(disputes: Array<ComponentProps<typeof PortalDisputeConversation>['dispute']>) {
  return render(<ConfirmDialogProvider><PortalDisputeConversation dispute={disputes[0]} /></ConfirmDialogProvider>)
}

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

  it('mostra a conversa com a situação na faixa, sem o campo de arquivo do navegador à vista', () => {
    renderConversation([{ ...mockDispute, next_responder: 'equipamentos' as const }])
    expect(screen.getByRole('heading', { name: 'Conversa' })).toBeTruthy()
    expect(screen.getByText('aberta em 01/01/2023 · aguarda a equipe de Containers')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Anexar arquivo/ })).toBeTruthy()
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    expect(input.className).toContain('hidden')
    expect(document.body.textContent).not.toMatch(/Dispute/)
  })

  it('mostra o nome do arquivo escolhido ao lado de "Anexar arquivo"', () => {
    renderConversation([mockDispute])
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [new File(['x'], 'eir.pdf', { type: 'application/pdf' })] } })
    expect(screen.getByText('eir.pdf')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Tirar o anexo eir.pdf' }))
    expect(screen.queryByText('eir.pdf')).toBeNull()
  })

  it('renders a form for new messages when state is aberta', () => {
    renderConversation([mockDispute])
    expect(screen.getByPlaceholderText('Responda à conversa…')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Enviar/ })).toBeTruthy()
  })

  it('renders a reopen request form when state is resolvida', () => {
    const resolvedDispute = { ...mockDispute, state: 'resolvida' as const }
    renderConversation([resolvedDispute])
    expect(screen.getByPlaceholderText('Explique por que a disputa deve ser reaberta…')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Solicitar reabertura/ })).toBeTruthy()
  })

  it('V-A2: pré-validação bloqueia envio e não grava mensagem quando cota é excedida', async () => {
    checkEligibilityMock.mockRejectedValueOnce(new Error('Quota de armazenamento de anexos de 100 MB excedida.'))
    renderConversation([mockDispute])

    const textarea = screen.getByPlaceholderText('Responda à conversa…')
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

    renderConversation([mockDispute])

    const textarea = screen.getByPlaceholderText('Responda à conversa…')
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['conteudo'], 'doc.pdf', { type: 'application/pdf' })

    fireEvent.change(textarea, { target: { value: 'Segue anexo' } })
    fireEvent.change(input, { target: { files: [file] } })

    const sendBtn = screen.getByRole('button', { name: /Enviar mensagem/ })
    fireEvent.click(sendBtn)
    const sendDialog = await screen.findByRole('dialog', { name: 'Confirmar envio da mensagem' })
    fireEvent.click(within(sendDialog).getByRole('button', { name: 'Enviar mensagem' }))

    expect(await screen.findByText(/Sua mensagem foi registrada, mas o anexo não pôde ser enviado/)).toBeTruthy()

    // O botão agora oferece reenvio do anexo
    const retryBtn = screen.getByRole('button', { name: 'Reenviar anexo' })
    expect(retryBtn).toBeTruthy()

    uploadAttachmentMock.mockResolvedValueOnce({ id: 999 })
    fireEvent.click(retryBtn)
    const retryDialog = await screen.findByRole('dialog', { name: 'Confirmar envio do anexo' })
    fireEvent.click(within(retryDialog).getByRole('button', { name: 'Enviar anexo' }))

    // O segundo upload foi chamado com o mesmo message_id da mensagem já gravada, sem criar duplicata
    expect(uploadAttachmentMock).toHaveBeenCalledWith(456, 1, file, expect.anything())
    expect(mutateAddMessageMock).toHaveBeenCalledTimes(1)
  })

  it('does not record a customer message until the customer confirms its contents', async () => {
    renderConversation([mockDispute])
    fireEvent.change(screen.getByPlaceholderText('Responda à conversa…'), { target: { value: 'Vamos enviar o comprovante.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar mensagem' }))

    const dialog = await screen.findByRole('dialog', { name: 'Confirmar envio da mensagem' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ver lista (2)' }))
    expect(within(dialog).getByText('Mensagem: Vamos enviar o comprovante.')).toBeTruthy()
    expect(mutateAddMessageMock).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Voltar' }))
    expect(mutateAddMessageMock).not.toHaveBeenCalled()
  })

  describe('PortalDisputesScreen', () => {
    const closed = { ...mockDispute, id: 2, demurrage_invoice_id: 2, doc_number: 'DEM-200', state: 'resolvida' as const, next_responder: 'ninguem' as const }
    const open = {
      ...mockDispute,
      next_responder: 'equipamentos' as const,
      messages: [{ id: 5, author_type: 'cliente' as const, body: 'Segue o EIR do depot.', next_responder: 'equipamentos' as const, created_at: '2023-01-08T12:00:00Z', attachments: [] }],
    }
    const invoices = [{ id: 1, bl_id: 'BL-123' }] as ComponentProps<typeof PortalDisputesScreen>['invoices']

    function renderScreen(props: Partial<ComponentProps<typeof PortalDisputesScreen>> = {}) {
      const handlers = { onOpenDispute: vi.fn(), onBackToList: vi.fn(), onBackToInvoices: vi.fn(), onOpenInvoice: vi.fn() }
      render(
        <ConfirmDialogProvider>
          <PortalDisputesScreen disputes={[open, closed]} loading={false} error={false} invoices={invoices} selectedDisputeId={null} {...handlers} {...props} />
        </ConfirmDialogProvider>,
      )
      return handlers
    }

    it('lista as em aberto com B/L, última mensagem e quem aguarda; encerradas começam fechadas', () => {
      const handlers = renderScreen()
      expect(screen.getByRole('heading', { name: 'Disputas de Demurrage' })).toBeTruthy()
      expect(screen.getAllByText('BL-123').length).toBeGreaterThan(0)
      expect(screen.getAllByText('Você, 08/01/2023: “Segue o EIR do depot.”').length).toBeGreaterThan(0)
      expect(screen.getAllByText('Equipe de Containers').length).toBeGreaterThan(0)
      expect(screen.queryByText('DEM-200')).toBeNull()
      fireEvent.click(screen.getByRole('button', { name: 'Mostrar' }))
      expect(screen.getAllByText('DEM-200').length).toBeGreaterThan(0)
      fireEvent.click(screen.getAllByRole('button', { name: 'Abrir a disputa da DEM-123' })[0])
      expect(handlers.onOpenDispute).toHaveBeenCalledWith(1)
      fireEvent.click(screen.getByRole('button', { name: /Voltar às faturas/ }))
      expect(handlers.onBackToInvoices).toHaveBeenCalled()
    })

    it('sem disputa em aberto, o histórico das encerradas já vem aberto', () => {
      renderScreen({ disputes: [closed] })
      expect(screen.getByText('Nenhuma disputa em aberto.', { selector: 'td' })).toBeTruthy()
      expect(screen.getAllByText('DEM-200').length).toBeGreaterThan(0)
      expect(screen.getByRole('button', { name: 'Ocultar' })).toBeTruthy()
    })

    it('com a disputa na URL, abre a conversa com "Abrir DEM-…" e "Voltar às disputas"', () => {
      const handlers = renderScreen({ selectedDisputeId: 1 })
      expect(screen.getByRole('heading', { name: 'Disputa da DEM-123' })).toBeTruthy()
      expect(screen.getByText('Segue o EIR do depot.')).toBeTruthy()
      fireEvent.click(screen.getByRole('button', { name: 'Abrir DEM-123' }))
      expect(handlers.onOpenInvoice).toHaveBeenCalledWith(1)
      fireEvent.click(screen.getByRole('button', { name: /Voltar às disputas/ }))
      expect(handlers.onBackToList).toHaveBeenCalled()
    })
  })
})
