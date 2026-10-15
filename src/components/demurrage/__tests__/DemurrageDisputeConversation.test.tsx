// @vitest-environment jsdom
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { DemurrageDisputeConversation } from '../DemurrageDisputeConversation'
import { ConfirmDialogProvider } from '../../ui/ConfirmDialog'

const authState = vi.hoisted(() => ({ role: 'equipamentos', mutateAsync: vi.fn(), upload: vi.fn() }))

const mockDispute = {
  id: 1,
  demurrage_invoice_id: 1,
  doc_number: 'DEM-123',
  customer_id: 1,
  customer_name: 'Test Customer',
  state: 'aberta' as const,
  next_responder: 'equipamentos' as const,
  subject: 'Test Subject',
  created_at: '2023-01-01T00:00:00Z',
  updated_at: '2023-01-01T00:00:00Z',
  messages: [],
}

let mockState = 'aberta'

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: vi.fn(() => ({
    invalidateQueries: vi.fn(),
  })),
  useQuery: vi.fn(() => ({
    data: [{ ...mockDispute, state: mockState }],
    isLoading: false,
    error: null,
  })),
  useMutation: vi.fn(() => ({
    mutateAsync: authState.mutateAsync,
    isPending: false,
  })),
}))
vi.mock('../../../services/demurrage/demurrageDisputes', () => ({
  listDemurrageDisputes: vi.fn(),
  addDemurrageDisputeMessage: vi.fn(),
  reopenDemurrageDispute: vi.fn(),
  uploadDemurrageDisputeAttachment: authState.upload,
}))
vi.mock('../../../services/cacheEffects', () => ({ afterFaturaDemurrageAlterada: vi.fn() }))
vi.mock('../../../hooks/useAuth', () => ({
  useAuth: () => ({ effectiveRole: authState.role }),
}))

describe('DemurrageDisputeConversation', () => {
  function renderConversation() {
    return render(<ConfirmDialogProvider><DemurrageDisputeConversation /></ConfirmDialogProvider>)
  }

  beforeEach(() => {
    vi.clearAllMocks()
    authState.mutateAsync.mockReset().mockResolvedValue({ message_id: 12 })
    mockState = 'aberta'
    authState.role = 'equipamentos'
  })

  it('renders the dispute subject and status', () => {
    renderConversation()
    expect(screen.getByRole('heading', { name: 'DEM-123 · Test Customer' })).toBeTruthy()
    expect(screen.getByText('Aberta')).toBeTruthy()
    expect(screen.getByText('Aguarda a nossa resposta')).toBeTruthy()
  })

  it('renders a form for new messages when state is aberta', () => {
    renderConversation()
    expect(screen.getByPlaceholderText('Responder ao cliente...')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Enviar resposta/ })).toBeTruthy()
    // ensure fireEvent is used so TS doesn't complain
    fireEvent.change(screen.getByPlaceholderText('Responder ao cliente...'), { target: { value: 'Test' } })
    expect(screen.getByRole('combobox', { name: 'Próxima ação' })).toBeTruthy()
    expect(screen.getByRole('option', { name: 'Encerrar pendência (Ninguém)' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Enviar resposta/ })).toBeTruthy()
  })

  it('renders a reopen form when state is resolvida', () => {
    mockState = 'resolvida'
    renderConversation()
    expect(screen.getByPlaceholderText('Justifique a reabertura...')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Reabrir Disputa/ })).toBeTruthy()
  })

  it('mostra a conversa a qualquer Departamento, sem responder, reabrir ou anexar (ADR 0085, D12)', async () => {
    authState.role = 'documentacao'
    renderConversation()
    expect(await screen.findByText('Responder, reabrir e anexar são de Equipamentos e do Administrativo.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Enviar/ })).toBeNull()
  })

  it('mostra a conversa ao Administrativo, que responde como cobertura (migration 081)', () => {
    authState.role = 'administrativo'
    renderConversation()
    expect(screen.getByRole('button', { name: /Enviar/ })).toBeTruthy()
  })

  it('confirms the response and recipient state before recording a message', async () => {
    renderConversation()
    fireEvent.change(screen.getByPlaceholderText('Responder ao cliente...'), { target: { value: 'Documento corrigido.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar resposta' }))

    const dialog = await screen.findByRole('dialog', { name: 'Confirmar resposta ao cliente' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ver lista (4)' }))
    expect(within(dialog).getByText('Mensagem: Documento corrigido.')).toBeTruthy()
    expect(authState.mutateAsync).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Enviar resposta' }))
    await waitFor(() => expect(authState.mutateAsync).toHaveBeenCalledWith({ id: 1, body: 'Documento corrigido.', nextResponder: 'cliente' }))
  })
})

describe('DemurrageDisputeConversation — foco e andamento', () => {
  beforeEach(() => {
    authState.mutateAsync.mockReset().mockResolvedValue({ message_id: 12 })
    mockState = 'aberta'
    authState.role = 'equipamentos'
  })

  it('destaca a Disputa aberta pelo alerta (?dispute=)', () => {
    render(<ConfirmDialogProvider><DemurrageDisputeConversation focusDisputeId={1} /></ConfirmDialogProvider>)
    expect(document.getElementById('dispute-1')?.className).toContain('app-dem-dispute--focused')
  })

  it('pede a resposta junto do campo antes de confirmar', () => {
    render(<ConfirmDialogProvider><DemurrageDisputeConversation /></ConfirmDialogProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Enviar resposta' }))
    expect(screen.getByRole('alert').textContent).toContain('Escreva a resposta antes de enviar.')
    expect(authState.mutateAsync).not.toHaveBeenCalled()
  })

  it('anexo que falhou depois da mensagem gravada pode ser reenviado sozinho', async () => {
    authState.upload.mockReset().mockRejectedValueOnce(new Error('rede')).mockResolvedValueOnce(undefined)
    render(<ConfirmDialogProvider><DemurrageDisputeConversation /></ConfirmDialogProvider>)
    fireEvent.change(screen.getByPlaceholderText('Responder ao cliente...'), { target: { value: 'Segue o comprovante.' } })
    const file = new File(['x'], 'comprovante.pdf', { type: 'application/pdf' })
    fireEvent.change(screen.getByLabelText('Anexo da Disputa'), { target: { files: [file] } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar resposta' }))
    const dialog = await screen.findByRole('dialog', { name: 'Confirmar resposta ao cliente' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Enviar resposta' }))

    expect((await screen.findByRole('alert')).textContent).toContain('A resposta foi enviada, mas o anexo não')
    // O campo de arquivo volta vazio; o arquivo que falhou fica no botão de reenvio.
    expect((screen.getByLabelText('Anexo da Disputa') as HTMLInputElement).files?.length ?? 0).toBe(0)
    fireEvent.click(screen.getByRole('button', { name: /Reenviar o anexo comprovante.pdf/ }))
    await waitFor(() => expect(authState.upload).toHaveBeenLastCalledWith(12, 1, 1, file))
    await waitFor(() => expect(screen.queryByRole('button', { name: /Reenviar o anexo/ })).toBeNull())
    expect(authState.mutateAsync).toHaveBeenCalledTimes(1)
  })
})
