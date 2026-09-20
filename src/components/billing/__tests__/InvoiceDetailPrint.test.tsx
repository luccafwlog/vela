// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'

const deleteCharge = vi.fn()
const cancelInvoice = vi.fn()
const confirm = vi.fn()
const showToast = vi.fn()

vi.mock('../../../hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'admin-1' }, isAdmin: true, can: () => true }),
}))
vi.mock('../../ui/Toast', () => ({ useToast: () => ({ showToast }) }))
vi.mock('../../ui/ConfirmDialog', () => ({ useConfirm: () => confirm }))
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}))
vi.mock('../../../hooks/useBilling', () => ({
  useInvoiceDetail: () => ({
    data: {
      invoice: {
        id: 9,
        invoice_number: 'INV-9',
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
    },
    isLoading: false,
    error: null,
  }),
  useRegisterInvoicePayment: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCancelInvoice: () => ({ mutateAsync: cancelInvoice, isPending: false }),
  useAddManualInvoiceCharge: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteManualInvoiceCharge: () => ({ mutateAsync: deleteCharge, isPending: false }),
}))
vi.mock('../../../hooks/useBillingLedger', () => ({
  useInvoiceRefunds: () => ({ data: [] }),
  useRegisterLedgerInvoicePayment: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSettleInvoiceRefund: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))
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

it('pede confirmação antes de excluir uma cobrança manual', async () => {
  confirm.mockResolvedValueOnce(false)
  const user = userEvent.setup()
  render(<MemoryRouter><InvoiceDetailModal invoiceId={9} onClose={vi.fn()} /></MemoryRouter>)

  await user.click(screen.getByRole('button', { name: /Remover Taxa manual/ }))

  expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ tone: 'danger' }))
  expect(deleteCharge).not.toHaveBeenCalled()
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
