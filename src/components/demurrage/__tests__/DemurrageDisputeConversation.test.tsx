// @vitest-environment jsdom
import { cleanup, render, screen, fireEvent, within, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest'

afterEach(cleanup)
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
  invoice_status: 'issued',
  invoice_total_usd: 1000,
  invoice_discount_mode: 'fixed',
  invoice_discount_value: 100,
  invoice_current_total_brl: 4950,
  waiting_since: '2023-01-01T00:00:00Z',
  due_at: '2023-01-02T00:00:00Z',
  overdue: false,
}

let mockState = 'aberta'
let mockOverrides: Record<string, unknown> = {}

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: vi.fn(() => ({
    invalidateQueries: vi.fn(),
  })),
  useQuery: vi.fn(() => ({
    data: [{ ...mockDispute, state: mockState, ...mockOverrides }],
    isLoading: false,
    error: null,
  })),
  useMutation: vi.fn(() => ({
    mutateAsync: authState.mutateAsync,
    isPending: false,
  })),
}))
vi.mock('../../../services/demurrage/demurrageDisputes', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../services/demurrage/demurrageDisputes')>()),
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
  function renderConversation(props: Parameters<typeof DemurrageDisputeConversation>[0] = {}) {
    return render(<ConfirmDialogProvider><DemurrageDisputeConversation {...props} /></ConfirmDialogProvider>)
  }
  function openConversation() {
    fireEvent.click(screen.getByRole('button', { name: /DEM-123/ }))
  }

  beforeEach(() => {
    vi.clearAllMocks()
    authState.mutateAsync.mockReset().mockResolvedValue({ message_id: 12 })
    mockState = 'aberta'
    mockOverrides = {}
    authState.role = 'equipamentos'
  })

  it('uma linha por Disputa: Invoice, situação da Invoice, Cliente, valor em disputa, aberta há e a vez (D15)', () => {
    renderConversation()
    const table = screen.getByRole('table', { name: 'Disputas de Demurrage' })
    const [row] = within(table).getAllByRole('row').slice(1)
    expect(within(row).getByText('DEM-123')).toBeTruthy()
    expect(within(row).getByText('Test Customer')).toBeTruthy()
    expect(within(row).getByText('US$ 900,00')).toBeTruthy()
    expect(within(row).getByText(/4\.950,00/)).toBeTruthy()
    expect(within(row).getByText('Aberta')).toBeTruthy()
    expect(within(row).getByText('Aguarda a nossa resposta')).toBeTruthy()
    expect(within(row).getByText(/Responder até/)).toBeTruthy()
    expect(screen.getByRole('radio', { name: /Canceladas/ })).toBeTruthy()
  })

  it('a conversa abre embaixo da linha, com Responder quando a vez é nossa', () => {
    renderConversation()
    expect(screen.queryByPlaceholderText('Responder ao cliente...')).toBeNull()
    openConversation()
    expect(screen.getByPlaceholderText('Responder ao cliente...')).toBeTruthy()
    expect(screen.getByRole('combobox', { name: 'Próxima ação' })).toBeTruthy()
    expect(screen.getByRole('option', { name: 'Encerrar pendência (Ninguém)' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Responder/ })).toBeTruthy()
  })

  it('o botão da linha só aponta para a conversa quando ela está aberta (aria-controls)', () => {
    renderConversation()
    const toggle = screen.getByRole('button', { name: /DEM-123/ })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(toggle.hasAttribute('aria-controls')).toBe(false)
    openConversation()
    const panelId = toggle.getAttribute('aria-controls')
    expect(panelId).toBeTruthy()
    expect(document.getElementById(panelId!)).toBeTruthy()
  })

  it('sem a vez nossa não há Responder nem campo de resposta', () => {
    mockOverrides = { next_responder: 'cliente', waiting_since: null, due_at: null }
    renderConversation()
    openConversation()
    expect(screen.queryByPlaceholderText('Responder ao cliente...')).toBeNull()
    expect(screen.getByText('A vez é do Cliente: a resposta volta a aparecer quando ele escrever.')).toBeTruthy()
  })

  it('Reabrir só em Invoice emitida ou paga (D17)', () => {
    mockState = 'resolvida'
    renderConversation()
    openConversation()
    expect(screen.getByPlaceholderText('Justifique a reabertura...')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Reabrir Disputa/ })).toBeTruthy()
    cleanup()
    mockOverrides = { invoice_status: 'cancelled' }
    renderConversation()
    openConversation()
    expect(screen.queryByRole('button', { name: /Reabrir Disputa/ })).toBeNull()
    expect(screen.getByText('A Invoice desta disputa está cancelada: a disputa não reabre.')).toBeTruthy()
  })

  it('prazo vencido deixa a linha em âmbar e diz quando venceu (D18)', () => {
    mockOverrides = { overdue: true }
    renderConversation()
    expect(document.getElementById('dispute-1')?.className).toContain('app-dem-row--late')
    expect(screen.getByText(/Prazo venceu em/)).toBeTruthy()
  })

  it('mostra a conversa a qualquer Departamento, sem responder, reabrir ou anexar (ADR 0085, D12)', async () => {
    authState.role = 'documentacao'
    renderConversation()
    openConversation()
    expect(await screen.findByText('Responder, reabrir e anexar são de Equipamentos e do Administrativo.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Responder$/ })).toBeNull()
  })

  it('mostra a conversa ao Administrativo, que responde como cobertura (migration 081)', () => {
    authState.role = 'administrativo'
    renderConversation()
    openConversation()
    expect(screen.getByRole('button', { name: 'Responder' })).toBeTruthy()
  })

  it('confirma a resposta e o próximo responsável antes de gravar', async () => {
    renderConversation()
    openConversation()
    fireEvent.change(screen.getByPlaceholderText('Responder ao cliente...'), { target: { value: 'Documento corrigido.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Responder' }))

    const dialog = await screen.findByRole('dialog', { name: 'Confirmar resposta ao cliente' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ver lista (4)' }))
    expect(within(dialog).getByText('Mensagem: Documento corrigido.')).toBeTruthy()
    expect(authState.mutateAsync).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Enviar resposta' }))
    await waitFor(() => expect(authState.mutateAsync).toHaveBeenCalledWith({ id: 1, body: 'Documento corrigido.', nextResponder: 'cliente' }))
  })

  it('a Disputa do alerta (?dispute=) abre com a conversa', () => {
    renderConversation({ focusDisputeId: 1 })
    expect(screen.getByRole('button', { name: /DEM-123/ }).getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByPlaceholderText('Responder ao cliente...')).toBeTruthy()
  })

  it('pede a resposta junto do campo antes de confirmar', () => {
    renderConversation()
    openConversation()
    fireEvent.click(screen.getByRole('button', { name: 'Responder' }))
    expect(screen.getByRole('alert').textContent).toContain('Escreva a resposta antes de enviar.')
    expect(authState.mutateAsync).not.toHaveBeenCalled()
  })

  it('anexo que falhou depois da mensagem gravada pode ser reenviado sozinho', async () => {
    authState.upload.mockReset().mockRejectedValueOnce(new Error('rede')).mockResolvedValueOnce(undefined)
    renderConversation()
    openConversation()
    fireEvent.change(screen.getByPlaceholderText('Responder ao cliente...'), { target: { value: 'Segue o comprovante.' } })
    const file = new File(['x'], 'comprovante.pdf', { type: 'application/pdf' })
    fireEvent.change(screen.getByLabelText('Anexo da Disputa'), { target: { files: [file] } })
    fireEvent.click(screen.getByRole('button', { name: 'Responder' }))
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
