// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const cancelInvoice = vi.fn()
const confirm = vi.fn()
const showToast = vi.fn()
const registerLedgerPayment = vi.fn()
const reversePayment = vi.fn()

vi.mock('../../../hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'admin-1' }, isAdmin: true, can: () => true }),
}))
vi.mock('../../ui/Toast', () => ({ useToast: () => ({ showToast }) }))
vi.mock('../../ui/ConfirmDialog', () => ({ useConfirm: () => confirm }))
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}))
let mockReissueLinks: Record<string, unknown> | null = null
let mockDetailData: Record<string, unknown> | null = {
  invoice: {
    id: 9,
    invoice_number: 'INV-9',
    invoice_type: 'individual',
    status: 'issued',
    total_brl: 100,
    total_paid_brl: 0,
    balance_brl: 100,
    customer_name: 'Cliente',
    customer_cnpj_cpf: '123',
    issued_at: '2026-06-23',
  },
  bls: [],
  items: [{ id: 31, description: 'Taxa manual', quantity: 1, unit_value_brl: 25, total_brl: 25, source: 'manual' }],
  payments: [],
}

vi.mock('../../../hooks/useBilling', () => ({
  useInvoiceDetail: () => ({
    data: mockDetailData,
    isLoading: false,
    error: null,
  }),
  useRegisterInvoicePayment: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCancelInvoice: () => ({ mutateAsync: cancelInvoice, isPending: false }),
  useInvoiceReissueLinks: () => ({ data: mockReissueLinks }),
}))
vi.mock('../../../hooks/useBillingLedger', () => ({
  usePrepareBlFinancialCancellation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRetryInvoiceBasisChanges: () => ({ mutate: vi.fn(), isPending: false }),
  reverseLocalPaymentAndInvalidate: (...args: unknown[]) => reversePayment(...args),
  useInvoiceCorrectionSummary: () => ({ data: { receivables: [], corrections: [] } }),
  useInvoiceRefunds: () => ({ data: [] }),
  useRegisterLedgerInvoicePayment: () => ({ mutateAsync: registerLedgerPayment, isPending: false }),
  useSettleInvoiceRefund: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))
vi.mock('../FinancialRefundsPanel', () => ({ FinancialRefundsPanel: () => null }))
vi.mock('../StaleInvoiceResolutionPanel', () => ({ StaleInvoiceResolutionPanel: () => null }))
vi.mock('../InvoiceDocumentLocal', () => ({
  InvoiceDocumentLocal: () => <div data-testid="print-document">printable invoice</div>,
}))
vi.mock('../../../services/alerts', () => ({ createAlert: vi.fn() }))
vi.mock('../../../services/operationalEvents', () => ({ logOperationalEvent: vi.fn() }))

import { InvoiceDetailModal } from '../InvoiceDetailModal'

const initialDetail = mockDetailData
beforeEach(() => {
  vi.resetAllMocks()
  mockDetailData = initialDetail
  mockReissueLinks = null
})
afterEach(cleanup)

it('repetição após timeout mantém chave, valor e data da tentativa', async () => {
  mockDetailData = { invoice: { id: 9, invoice_number: 'INV-9', invoice_type: 'individual', status: 'issued', total_brl: 100, balance_brl: 100, total_paid_brl: 0 }, bls: [], items: [], payments: [] }
  confirm.mockResolvedValue(true)
  registerLedgerPayment.mockClear()
  registerLedgerPayment.mockRejectedValueOnce(new Error('Timeout')).mockResolvedValueOnce({})
  const user = userEvent.setup()
  render(<MemoryRouter><InvoiceDetailModal invoiceId={9} onClose={vi.fn()} /></MemoryRouter>)
  fireEvent.change(screen.getByLabelText('Data'), { target: { value: '2026-10-04' } })
  fireEvent.change(screen.getByLabelText('Referência do recebimento bancário'), { target: { value: 'BANCO-TESTE-9' } })
  await user.click(screen.getByRole('button', { name: 'Registrar pagamento' }))
  await user.click(screen.getByRole('button', { name: /Registrar pagamento|Tentar novamente/ }))
  const first = registerLedgerPayment.mock.calls[0][0]
  const second = registerLedgerPayment.mock.calls[1][0]
  expect(first.paidAt).toEqual(expect.any(String))
  expect(second).toEqual(first)
})

it('o Administrativo pode selecionar e cancelar uma baixa antiga com confirmação do valor', async () => {
  mockDetailData = { invoice: { id: 9, invoice_number: 'INV-9', invoice_type: 'individual', status: 'partially_paid', total_brl: 100, balance_brl: 50, total_paid_brl: 50 }, bls: [], items: [],
    payments: [{ id: 1, amount_brl: 20, paid_at: '2026-10-01', payment_method: 'ted' }, { id: 2, amount_brl: 30, paid_at: '2026-10-02', payment_method: 'ted' }] }
  confirm.mockClear()
  confirm.mockResolvedValue(true)
  reversePayment.mockResolvedValue({})
  const user = userEvent.setup()
  render(<MemoryRouter><InvoiceDetailModal invoiceId={9} onClose={vi.fn()} enablePaymentReversal paymentId={2} /></MemoryRouter>)
  await user.selectOptions(screen.getByLabelText('Baixa a cancelar'), '1')
  await user.type(screen.getByLabelText('Justificativa (obrigatória)'), 'Duplicada no extrato')
  await user.click(screen.getByRole('button', { name: 'Cancelar baixa' }))
  expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('20,00') }))
  expect(reversePayment).toHaveBeenCalledWith(expect.anything(), 1, 'Duplicada no extrato')
})

it('opens the printable invoice only after the user requests printing', async () => {
  const user = userEvent.setup()
  render(<MemoryRouter><InvoiceDetailModal invoiceId={9} onClose={vi.fn()} /></MemoryRouter>)

  expect(screen.queryByTestId('print-document')).toBeNull()
  await user.click(screen.getByRole('button', { name: /Imprimir PDF/ }))
  expect(screen.getByTestId('print-document')).toBeTruthy()
})

it('fatura emitida não oferece inclusão nem remoção de item manual', () => {
  render(<MemoryRouter><InvoiceDetailModal invoiceId={9} onClose={vi.fn()} /></MemoryRouter>)

  expect(screen.getByText('Taxa manual')).toBeTruthy()
  expect(screen.queryByText('Outras cobranças (manuais)')).toBeNull()
  expect(screen.queryByRole('button', { name: /Adicionar cobrança manual/ })).toBeNull()
  expect(screen.queryByRole('button', { name: /Remover/ })).toBeNull()
})

it('não oferece Cancelar e reemitir: a correção do B/L reemite sozinha', () => {
  render(<MemoryRouter><InvoiceDetailModal invoiceId={9} onClose={vi.fn()} /></MemoryRouter>)
  expect(screen.queryByRole('button', { name: /Cancelar e reemitir/ })).toBeNull()
})

it('mostra o vínculo com a fatura substituída', () => {
  mockReissueLinks = { replaces: { id: 7, invoice_number: 'INV-7' }, replaced_by: null, reissue_pending: false }
  render(<MemoryRouter><InvoiceDetailModal invoiceId={9} onClose={vi.fn()} /></MemoryRouter>)

  expect(screen.getByTestId('invoice-reissue-links').textContent).toContain('Substitui a fatura INV-7')
  mockReissueLinks = null
})

it('mostra por que a fatura cancelada não foi reemitida', () => {
  mockReissueLinks = { replaces: null, replaced_by: null, reissue_pending: false, reissue_closed_reason: 'Nao reemitida: B/L BL-1 cancelado.' }
  render(<MemoryRouter><InvoiceDetailModal invoiceId={9} onClose={vi.fn()} /></MemoryRouter>)

  expect(screen.getByTestId('invoice-reissue-links').textContent).toContain('B/L BL-1 cancelado')
  mockReissueLinks = null
})

it('explica as consequências da baixa parcial e aguarda confirmação antes de registrar', async () => {
  confirm.mockClear()
  registerLedgerPayment.mockClear()
  confirm.mockResolvedValueOnce(false)
  const user = userEvent.setup()
  render(<MemoryRouter><InvoiceDetailModal invoiceId={9} onClose={vi.fn()} /></MemoryRouter>)
  const amount = screen.getByLabelText('Valor BRL (aceita parcial)')
  await user.clear(amount)
  await user.type(amount, '40')
  expect(screen.getByText(/Após esta baixa/).textContent).toContain('60,00')
  fireEvent.change(screen.getByLabelText('Data'), { target: { value: '2026-10-01' } })
  expect(screen.getByText(/a correção do B\/L não reemite a fatura/)).toBeTruthy()
  fireEvent.change(screen.getByLabelText('Referência do recebimento bancário'), { target: { value: 'BANCO-TESTE-9' } })
  await user.click(screen.getByRole('button', { name: 'Registrar pagamento' }))
  expect(confirm).toHaveBeenCalledWith(expect.objectContaining({
    title: 'Registrar pagamento parcial?',
    message: expect.stringMatching(/40.*60/),
    consequence: expect.stringContaining('aumento vira fatura avulsa e redução abate o saldo'),
  }))
  expect(registerLedgerPayment).not.toHaveBeenCalled()
})

it('usa terminologia em português (fatura) no modal de detalhe e cancelamento', async () => {
  const user = userEvent.setup()
  cancelInvoice.mockRejectedValueOnce(new Error('PGRST116: row lock timeout'))
  render(<MemoryRouter><InvoiceDetailModal invoiceId={9} onClose={vi.fn()} /></MemoryRouter>)

  expect(screen.getByText('Detalhe da fatura INV-9')).toBeTruthy()
  expect(screen.getByText('Itens da fatura')).toBeTruthy()
  expect(screen.getByRole('heading', { name: 'Cancelar fatura' })).toBeTruthy()

  const reasonInput = screen.getByLabelText('Motivo')
  await user.type(reasonInput, 'Cancelamento operacional')
  await user.click(screen.getByRole('button', { name: 'Cancelar fatura' }))

  expect(showToast).toHaveBeenCalledWith('Falha ao cancelar fatura.', 'error')
})

it('omite B/Ls e Navio / Viagem para fatura avulsa sem contexto no detalhe', () => {
  mockDetailData = {
    invoice: {
      id: 10,
      invoice_number: 'INV-10',
      invoice_type: 'manual',
      status: 'issued',
      total_brl: 300,
      total_paid_brl: 0,
      balance_brl: 300,
      customer_name: 'Cliente Avulso',
      customer_cnpj_cpf: '456',
      issued_at: '2026-09-27',
      notes: 'Consultoria técnica',
      voyage_id: null,
      voyage_number: null,
      vessel_name: null,
    },
    bls: [],
    items: [{ id: 32, description: 'Consultoria', quantity: 1, unit_value_brl: 300, total_brl: 300, source: 'manual' }],
    payments: [],
  }

  render(<MemoryRouter><InvoiceDetailModal invoiceId={10} onClose={vi.fn()} /></MemoryRouter>)

  expect(screen.getByText('Detalhe da fatura INV-10')).toBeTruthy()
  expect(screen.getByText('Consultoria técnica')).toBeTruthy()
  expect(screen.queryByText('Navio / Viagem')).toBeNull()
  expect(screen.queryByText('B/Ls')).toBeNull()
})
