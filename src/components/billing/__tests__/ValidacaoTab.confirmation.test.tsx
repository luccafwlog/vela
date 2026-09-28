// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  confirm: vi.fn(),
  calculate: vi.fn(),
  issue: vi.fn(),
  showToast: vi.fn(),
}))

const row = {
  id: 'BL-LOCAL-77',
  cargo_mode: 'container',
  pol: 'BRVIX',
  pod: 'BRSSA',
  charge_status: 'ready_for_billing',
  financial_status: 'pending',
  ce_mercante: 'CE-77',
  review_status: 'reviewed',
  notes: null,
  customer_reconciliation_status: 'reconciled',
  customer_reconciliation_notes: null,
  billing_hold_reason: null,
  last_billing_run_id: null,
  charge_exemption_reason: null,
  charges_calculated_at: null,
  charges_reviewed_at: null,
  created_at: null,
  voyage: { id: 7, voyage_number: 'V7', vessel: { name: 'Navio Azul' } },
  customer: { id: 9, name: 'Cliente Sul', cnpj_cpf: null },
  totals: { total_brl: 880, total_usd: 15, line_count: 2, review_required_count: 0 },
  trail: { last_event_at: null, last_event_by: null, last_event_field: null, last_event_message: null },
}

vi.mock('../../../hooks/useLocalCharges', () => ({
  useBatchCalculateLocalCharges: () => ({ mutateAsync: mocks.calculate, isPending: false }),
  useCustomerReconciliationQueue: () => ({ data: [] }),
  useLocalChargeOperations: () => ({ data: { rows: mocks.rows, truncated: false }, isLoading: false, error: null }),
}))
vi.mock('../../../services/graniteBillingWorkflow', () => ({ runGraniteBatch: vi.fn() }))
vi.mock('../../../services/billing', () => ({ createInvoiceFromBls: mocks.issue }))
vi.mock('../../ui/ConfirmDialog', () => ({ useConfirm: () => mocks.confirm }))
vi.mock('../../ui/Toast', () => ({ useToast: () => ({ showToast: mocks.showToast }) }))
vi.mock('../ValidacaoControls', () => ({
  ValidacaoControls: ({ onUpdateFilter, onRunBatchOperation }: {
    onUpdateFilter: (field: string, value: unknown) => void
    onRunBatchOperation: (action: 'recalculate') => void
  }) => (
    <div>
      <button type="button" onClick={() => onUpdateFilter('includeResolved', true)}>Incluir resolvidos</button>
      <button type="button" onClick={() => onRunBatchOperation('recalculate')}>Recalcular seleção</button>
    </div>
  ),
}))
vi.mock('../ValidacaoOperationsTable', () => ({
  ValidacaoOperationsTable: ({ rows: visibleRows, onIssueSingleInvoice, onToggleRow }: {
    rows: Array<typeof row>
    onIssueSingleInvoice: (value: typeof row) => void
    onToggleRow: (id: string) => void
  }) => visibleRows.length ? (
    <div>
      {visibleRows.map((visibleRow) => <button type="button" key={visibleRow.id} onClick={() => onToggleRow(visibleRow.id)}>Selecionar {visibleRow.id}</button>)}
      <button type="button" onClick={() => onIssueSingleInvoice(visibleRows[0])}>Emitir teste</button>
    </div>
  ) : null,
}))

import { ValidacaoTab } from '../ValidacaoTab'

function renderTab() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}><ValidacaoTab userId="user-1" /></QueryClientProvider>)
}

beforeEach(() => {
  mocks.rows = [row, { ...row, id: 'BL-ISSUED', financial_status: 'invoiced' }]
  mocks.confirm.mockReset().mockResolvedValue(false)
  mocks.calculate.mockReset().mockResolvedValue({ total: 1, successCount: 1, errorCount: 0, errors: [] })
  mocks.issue.mockReset().mockResolvedValue(undefined)
  mocks.showToast.mockReset()
})

afterEach(cleanup)

describe('ValidacaoTab — confirmação de gravações financeiras', () => {
  it('mostra B/Ls e informa que os faturados serão ignorados no recálculo', async () => {
    const user = userEvent.setup()
    renderTab()
    await user.click(screen.getByRole('button', { name: 'Incluir resolvidos' }))
    await user.click(screen.getByRole('button', { name: 'Selecionar BL-LOCAL-77' }))
    await user.click(screen.getByRole('button', { name: 'Selecionar BL-ISSUED' }))
    await user.click(screen.getByRole('button', { name: 'Recalcular seleção' }))

    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledOnce())
    const options = mocks.confirm.mock.calls[0][0]
    expect(options.affected.items[0]).toContain('BL-LOCAL-77')
    expect(options.affected.items[0]).toMatch(/R\$\s*880,00/)
    expect(options.affected.blocked[0]).toEqual({ label: 'B/L BL-ISSUED', reasons: ['já faturado; não será recalculado'] })
    expect(options.consequence).toContain('não antecipa o novo cálculo')
    expect(mocks.calculate).not.toHaveBeenCalled()
  })

  it('emite a fatura individual somente após confirmar', async () => {
    mocks.confirm.mockResolvedValue(true)
    const user = userEvent.setup()
    renderTab()
    await user.click(screen.getByRole('button', { name: 'Incluir resolvidos' }))
    await user.click(screen.getByRole('button', { name: 'Emitir teste' }))

    await waitFor(() => expect(mocks.issue).toHaveBeenCalledWith({
      blIds: ['BL-LOCAL-77'], customerId: 9, issueNow: true, actorId: 'user-1',
    }))
    expect(mocks.confirm.mock.calls[0][0].reversibility).toContain('não pode ser apagada')
  })
})
