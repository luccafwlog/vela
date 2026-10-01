// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'

const cancelForReissue = vi.fn()
const cancelInvoice = vi.fn()
const confirm = vi.fn()
const showToast = vi.fn()
const registerLedgerPayment = vi.fn()

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
  useCancelInvoiceForReissue: () => ({ mutateAsync: cancelForReissue, isPending: false }),
  useInvoiceReissueLinks: () => ({ data: mockReissueLinks }),
}))
vi.mock('../../../hooks/useBillingLedger', () => ({
  useInvoiceCorrectionSummary: () => ({ data: { receivables: [], corrections: [] } }),
  useRegisterInvoiceCorrection: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useInvoiceRefunds: () => ({ data: [] }),
  useRegisterLedgerInvoicePayment: () => ({ mutateAsync: registerLedgerPayment, isPending: false }),
  useSettleInvoiceRefund: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))
vi.mock('../StaleInvoiceResolutionPanel', () => ({ StaleInvoiceResolutionPanel: () => null }))
vi.mock('../InvoiceDocumentLocal', () => ({
  InvoiceDocumentLocal: () => <div data-testid="print-document">printable invoice</div>,
}))
vi.mock('../../../services/alerts', () => ({ createAlert: vi.fn() }))
vi.mock('../../../services/operationalEvents', () => ({ logOperationalEvent: vi.fn() }))

import { InvoiceDetailModal } from '../InvoiceDetailModal'

afterEach(cleanup)

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

it('cancela e reemite fatura sem pagamento depois da confirmação com os B/Ls afetados', async () => {
  confirm.mockResolvedValueOnce(true)
  cancelForReissue.mockResolvedValueOnce({ cancelled_invoice_ids: [9], bl_ids: [] })
  const user = userEvent.setup()
  render(<MemoryRouter><InvoiceDetailModal invoiceId={9} onClose={vi.fn()} /></MemoryRouter>)

  const button = screen.getByRole('button', { name: /Cancelar e reemitir/ })
  expect((button as HTMLButtonElement).disabled).toBe(true)
  await user.type(screen.getByLabelText('Motivo da correção'), 'Peso corrigido')
  await user.click(button)

  expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Cancelar e reemitir', affected: expect.any(Object) }))
  expect(cancelForReissue).toHaveBeenCalledWith({ invoiceId: 9, reason: 'Peso corrigido', correctBlIds: [] })
})

it('mostra o vínculo com a fatura substituída', () => {
  mockReissueLinks = { replaces: { id: 7, invoice_number: 'INV-7' }, replaced_by: null, reissue_pending: false }
  render(<MemoryRouter><InvoiceDetailModal invoiceId={9} onClose={vi.fn()} /></MemoryRouter>)

  expect(screen.getByTestId('invoice-reissue-links').textContent).toContain('Substitui a fatura INV-7')
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
  fireEvent.change(screen.getByLabelText('Data'), { target: { value: '2026-10-01' } })
  expect(screen.getByText(/Pagamento parcial impede cancelar e reemitir/)).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'Registrar pagamento' }))
  expect(confirm).toHaveBeenCalledWith(expect.objectContaining({
    title: 'Registrar pagamento parcial?',
    message: expect.stringMatching(/40.*60/),
    consequence: expect.stringContaining('Taxas adicionais usam fatura avulsa; reduções usam Correção após pagamento'),
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
