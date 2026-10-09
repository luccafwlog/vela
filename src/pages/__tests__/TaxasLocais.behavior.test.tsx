// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  detailInvoiceId: vi.fn(),
  invalidateQueries: vi.fn(),
  detectOverdueInvoices: vi.fn(),
}))

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: [], isLoading: false, error: null }),
  useMutation: () => ({ mutateAsync: vi.fn(), isPending: false, variables: null }),
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
}))
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' }, can: () => false }) }))
vi.mock('../../components/ui/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }))
vi.mock('../../components/ui/ConfirmDialog', () => ({ useConfirm: () => vi.fn().mockResolvedValue(false) }))
vi.mock('../../hooks/useBilling', () => ({
  useInvoices: () => ({ data: { rows: [], count: 0 }, isLoading: false, error: null }),
  useBillingCustomers: () => ({ data: [] }),
  usePendingReissues: () => ({ data: [] }),
  useRetryPendingConsolidatedReissue: () => ({ mutateAsync: vi.fn(), isPending: false, variables: undefined }),
  useCreateManualInvoice: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))
vi.mock('../../services/alerts', () => ({
  listFinancialAlerts: vi.fn().mockResolvedValue([]),
  detectOverdueInvoices: mocks.detectOverdueInvoices,
}))
vi.mock('../../components/billing/InvoiceDetailModal', () => ({
  InvoiceDetailModal: ({ invoiceId }: { invoiceId: number | null }) => {
    mocks.detailInvoiceId(invoiceId)
    return <div data-testid="invoice-id">{String(invoiceId)}</div>
  },
}))
vi.mock('../../components/billing/ValidacaoTab', () => ({ ValidacaoTab: () => null }))
vi.mock('../../components/billing/FinancialAlertsPanel', () => ({ FinancialAlertsPanel: () => null }))
vi.mock('../../components/billing/InvoiceFiltersBar', () => ({ InvoiceFiltersBar: () => null }))
vi.mock('../../components/billing/InvoicesTable', () => ({ InvoicesTable: () => null }))
vi.mock('../../components/billing/ConsolidatedInvoiceModal', () => ({ ConsolidatedInvoiceModal: () => null }))

import { TaxasLocais } from '../TaxasLocais'

function LocationProbe() {
  const location = useLocation()
  return <output data-testid="location">{location.pathname}{location.search}</output>
}

beforeEach(() => {
  vi.clearAllMocks()
})
afterEach(cleanup)

it('opens the invoice supplied by the canonical URL query string', () => {
  render(<MemoryRouter initialEntries={['/taxas-locais?invoice=73']}><TaxasLocais /></MemoryRouter>)
  expect(screen.getByTestId('invoice-id').textContent).toBe('73')
})

it('preserves non-tab query parameters when redirecting demurrage', async () => {
  render(
    <MemoryRouter initialEntries={['/taxas-locais?tab=demurrage&busca=X']}>
      <TaxasLocais />
      <LocationProbe />
    </MemoryRouter>,
  )

  await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/demurrage?busca=X'))
})

it('não executa detector de vencimento ao abrir Faturamento', () => {
  render(<MemoryRouter><TaxasLocais /></MemoryRouter>)
  expect(mocks.detectOverdueInvoices).not.toHaveBeenCalled()
})

it('a aba ativa fica na URL e mantém o recorte ao voltar para Faturas', async () => {
  const { default: userEvent } = await import('@testing-library/user-event')
  const user = userEvent.setup()
  render(
    <MemoryRouter initialEntries={['/taxas-locais?customer=7&customerName=ACME']}>
      <TaxasLocais />
      <LocationProbe />
    </MemoryRouter>,
  )
  await user.click(screen.getByRole('tab', { name: 'Validação' }))
  expect(screen.getByTestId('location').textContent).toBe('/taxas-locais?customer=7&customerName=ACME&tab=validacao')
  await user.click(screen.getByRole('tab', { name: 'Faturas' }))
  expect(screen.getByTestId('location').textContent).toBe('/taxas-locais?customer=7&customerName=ACME')
})
