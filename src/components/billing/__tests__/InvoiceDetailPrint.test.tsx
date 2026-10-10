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

const auth = vi.hoisted(() => ({ isAdmin: true }))
vi.mock('../../../hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'admin-1' }, isAdmin: auth.isAdmin, can: () => auth.isAdmin }),
}))
let mockRefunds: Array<Record<string, unknown>> = []
const settleRefund = vi.fn()
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
  useInvoiceRefunds: () => ({ data: mockRefunds }),
  useRegisterLedgerInvoicePayment: () => ({ mutateAsync: registerLedgerPayment, isPending: false }),
  useSettleInvoiceRefund: () => ({ mutateAsync: settleRefund, isPending: false }),
}))
vi.mock('../../../hooks/useFinancialRefunds', () => ({
  useFinancialRefunds: () => ({ data: undefined }),
  useCancelFinancialRefundAuthorization: () => ({ mutateAsync: vi.fn(), isPending: false }),
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
  mockRefunds = []
  auth.isAdmin = true
})
afterEach(cleanup)

it('repetição após timeout mantém chave, valor e data da tentativa', async () => {
  mockDetailData = { invoice: { id: 9, invoice_number: 'INV-9', invoice_type: 'individual', status: 'issued', total_brl: 100, balance_brl: 100, total_paid_brl: 0 }, bls: [], items: [], payments: [] }
  confirm.mockResolvedValue(true)
  registerLedgerPayment.mockClear()
  registerLedgerPayment.mockRejectedValueOnce(new Error('Timeout')).mockResolvedValueOnce({})
  const user = userEvent.setup()
  render(<MemoryRouter><InvoiceDetailModal invoiceId={9} onClose={vi.fn()} /></MemoryRouter>)
  fireEvent.change(screen.getByLabelText(/Data do recebimento/), { target: { value: '2026-10-04' } })
  fireEvent.change(screen.getByLabelText(/Referência do recebimento bancário/), { target: { value: 'BANCO-TESTE-9' } })
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
  await user.selectOptions(screen.getByLabelText(/Baixa a cancelar/), '1')
  await user.type(screen.getByLabelText(/^Justificativa/), 'Duplicada no extrato')
  await user.click(screen.getByRole('button', { name: 'Cancelar baixa' }))
  expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('20,00') }))
  expect(reversePayment).toHaveBeenCalledWith(expect.anything(), 1, 'Duplicada no extrato')
})

it('opens the printable invoice only after the user requests printing', async () => {
  const user = userEvent.setup()
  render(<MemoryRouter><InvoiceDetailModal invoiceId={9} onClose={vi.fn()} /></MemoryRouter>)

  expect(screen.queryByTestId('print-document')).toBeNull()
  await user.click(screen.getByRole('button', { name: /Imprimir fatura/ }))
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
  const amount = screen.getByLabelText(/Valor recebido/)
  await user.clear(amount)
  await user.type(amount, '40')
  expect(screen.getByText(/Após esta baixa/).textContent).toContain('60,00')
  fireEvent.change(screen.getByLabelText(/Data do recebimento/), { target: { value: '2026-10-01' } })
  expect(screen.getByText(/a correção do B\/L não reemite a fatura/)).toBeTruthy()
  fireEvent.change(screen.getByLabelText(/Referência do recebimento bancário/), { target: { value: 'BANCO-TESTE-9' } })
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
  confirm.mockResolvedValue(true)
  cancelInvoice.mockRejectedValueOnce(new Error('PGRST116: row lock timeout'))
  render(<MemoryRouter><InvoiceDetailModal invoiceId={9} onClose={vi.fn()} /></MemoryRouter>)

  expect(screen.getByText('Fatura INV-9')).toBeTruthy()
  expect(screen.getByText('Itens da fatura')).toBeTruthy()
  expect(screen.getByRole('heading', { name: 'Cancelar fatura' })).toBeTruthy()

  const reasonInput = screen.getByLabelText(/^Motivo/)
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

  expect(screen.getByText('Fatura INV-10')).toBeTruthy()
  expect(screen.getByText('Consultoria técnica')).toBeTruthy()
  expect(screen.queryByText('Navio / Viagem')).toBeNull()
  expect(screen.queryByText('B/Ls')).toBeNull()
})

// VELA-15: a avulsa 11 estava cancelada e o modal ainda oferecia a baixa;
// register_verified_invoice_payment recusava com 22023.
it('avulsa cancelada não oferece registro de pagamento nem novo cancelamento', () => {
  mockDetailData = { invoice: { id: 11, invoice_number: 'AV-11', invoice_type: 'manual', status: 'cancelled', total_brl: 0.07, balance_brl: 0.07, total_paid_brl: 0 }, bls: [], items: [], payments: [] }
  render(<MemoryRouter><InvoiceDetailModal invoiceId={11} onClose={vi.fn()} /></MemoryRouter>)

  expect(screen.queryByRole('button', { name: 'Registrar pagamento' })).toBeNull()
  expect(screen.queryByLabelText(/Referência do recebimento bancário/)).toBeNull()
  expect(screen.getByText('Esta fatura não aceita registro de pagamento no status atual.')).toBeTruthy()
  expect(screen.queryByRole('button', { name: /Cancelar fatura/ })).toBeNull()
})

it('avulsa emitida continua oferecendo o registro de pagamento', () => {
  mockDetailData = { invoice: { id: 12, invoice_number: 'AV-12', invoice_type: 'manual', status: 'issued', total_brl: 10, balance_brl: 10, total_paid_brl: 0 }, bls: [], items: [], payments: [] }
  render(<MemoryRouter><InvoiceDetailModal invoiceId={12} onClose={vi.fn()} /></MemoryRouter>)

  expect(screen.getByRole('button', { name: 'Registrar pagamento' })).toBeTruthy()
})

it('distingue total emitido, recebido, a devolver e saldo da avulsa paga a maior', () => {
  mockDetailData = {
    invoice: { id: 13, invoice_number: 'AV-13', invoice_type: 'manual', status: 'paid', total_brl: 750, total_paid_brl: 800, balance_brl: 0, issued_at: '2026-10-09' },
    financial_summary: { gross_received_brl: 800, offset_brl: 0, refunded_brl: 0, pending_refund_brl: 50, net_received_brl: 800, paid_at: '2026-10-08' },
    bls: [], items: [], payments: [{ id: 5, amount_brl: 800, paid_at: '2026-10-08', payment_method: 'ted' }],
  }
  render(<MemoryRouter><InvoiceDetailModal invoiceId={13} onClose={vi.fn()} /></MemoryRouter>)
  const amounts = document.querySelector('[aria-label="Valores da fatura"]')
  const text = (amounts?.textContent ?? '').replace(/\s/g, ' ')
  expect(text).toContain('Total emitidoR$ 750,00')
  expect(text).toContain('RecebidoR$ 800,00')
  expect(text).toContain('A devolverR$ 50,00')
  expect(text).toContain('Saldo em abertoR$ 0,00Quitada')
})

it('sem Administrativo, mostra o motivo no lugar dos formulários de baixa e cancelamento', () => {
  auth.isAdmin = false
  render(<MemoryRouter><InvoiceDetailModal invoiceId={9} onClose={vi.fn()} /></MemoryRouter>)
  expect(screen.queryByRole('button', { name: 'Registrar pagamento' })).toBeNull()
  expect(screen.getByText(/Somente o Administrativo registra recebimentos/)).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Cancelar fatura' })).toBeNull()
  expect(screen.getByText('Somente o Administrativo cancela faturas.')).toBeTruthy()
})

it('fatura com pagamento explica por que não é cancelada e abre a baixa pela linha', async () => {
  mockDetailData = { invoice: { id: 9, invoice_number: 'INV-9', invoice_type: 'individual', status: 'partially_paid', total_brl: 100, balance_brl: 60, total_paid_brl: 40 }, bls: [], items: [],
    payments: [{ id: 7, amount_brl: 40, paid_at: '2026-10-01', payment_method: 'pix' }] }
  const user = userEvent.setup()
  render(<MemoryRouter><InvoiceDetailModal invoiceId={9} onClose={vi.fn()} /></MemoryRouter>)
  expect(screen.getByText(/Fatura com pagamento não é cancelada aqui/)).toBeTruthy()
  expect(screen.queryByLabelText(/Baixa a cancelar/)).toBeNull()
  await user.click(screen.getByRole('button', { name: /Cancelar baixa de R\$\s40,00/ }))
  expect((screen.getByLabelText(/Baixa a cancelar/) as HTMLSelectElement).value).toBe('7')
  await user.click(screen.getByRole('button', { name: 'Voltar' }))
  expect(screen.queryByLabelText(/Baixa a cancelar/)).toBeNull()
})

it('a impressão troca o conteúdo do mesmo diálogo e volta ao detalhe', async () => {
  const user = userEvent.setup()
  render(<MemoryRouter><InvoiceDetailModal invoiceId={9} onClose={vi.fn()} /></MemoryRouter>)
  await user.click(screen.getByRole('button', { name: /Imprimir fatura/ }))
  expect(screen.getAllByRole('dialog')).toHaveLength(1)
  expect(screen.getByText('Imprimir fatura INV-9')).toBeTruthy()
  await user.click(screen.getByRole('button', { name: /Voltar ao detalhe/ }))
  expect(screen.queryByTestId('print-document')).toBeNull()
  expect(screen.getByText('Fatura INV-9')).toBeTruthy()
})

it('confirma a devolução dentro da seção de restituições, com evidência e conferência', async () => {
  mockRefunds = [{ id: 3, amount_brl: 50, status: 'pending', created_at: '2026-10-08', settled_at: null, notes: 'Excedente' }]
  confirm.mockResolvedValue(true)
  settleRefund.mockResolvedValue({})
  const user = userEvent.setup()
  render(<MemoryRouter><InvoiceDetailModal invoiceId={9} onClose={vi.fn()} /></MemoryRouter>)
  await user.click(screen.getByRole('button', { name: 'Confirmar devolução…' }))
  expect(screen.getAllByRole('dialog')).toHaveLength(1)
  fireEvent.change(screen.getByLabelText(/Referência do comprovante bancário/), { target: { value: 'COMPROVANTE-1' } })
  fireEvent.change(screen.getByLabelText(/Favorecido/), { target: { value: 'Cliente original' } })
  fireEvent.change(screen.getByLabelText(/Data da devolução/), { target: { value: '2026-10-09' } })
  await user.click(screen.getByRole('button', { name: 'Confirmar devolução realizada' }))
  expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Confirmar devolução realizada?' }))
  expect(settleRefund).toHaveBeenCalledWith(expect.objectContaining({ refundId: 3, bankReference: 'COMPROVANTE-1' }))
})
