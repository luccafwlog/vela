// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  exportExcel: vi.fn(),
  showToast: vi.fn(),
  onLocal: vi.fn(),
  onDemurrage: vi.fn(),
  queryState: {
    data: {
      rows: [{
        id: 'local-1',
        source: 'local',
        invoiceId: 11,
        paymentId: 21,
        blId: 'BL1',
        docNumber: 'INV-11',
        invoiceType: 'individual',
        customerName: 'Cliente',
        customerCnpj: '123',
        blAmount: 10,
        totalAmount: 10,
        vesselName: 'Navio',
        voyageNumber: 'V1',
        pod: 'BRVIX',
        paidAt: '2026-06-23',
      }],
      totalCount: 1,
    },
    isLoading: false,
    error: null as Error | null,
  },
}))

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => mocks.queryState,
}))
vi.mock('../../../services/reconciliacao', () => ({
  listReconciliationHistory: vi.fn(),
  exportReconciliationHistoryExcel: mocks.exportExcel,
}))
vi.mock('../../../services/billing', () => ({
  listBillingCustomers: vi.fn().mockResolvedValue([]),
  invoiceTypeLabel: (invoiceType: string | null) => invoiceType === 'consolidated' ? 'Consolidada' : invoiceType === 'manual' ? 'Avulsa' : 'Única BL',
}))
vi.mock('../../ui/Combobox', () => ({ Combobox: () => null }))
vi.mock('../../ui/Toast', () => ({
  useToast: () => ({ showToast: mocks.showToast }),
}))

import { ReconciliationHistoryTable } from '../ReconciliationHistoryTable'

beforeEach(() => vi.clearAllMocks())
afterEach(cleanup)

it('opens the local invoice detail selected from history', async () => {
  const user = userEvent.setup()
  render(<ReconciliationHistoryTable onSelectLocalInvoice={mocks.onLocal} onSelectDemurrageInvoice={mocks.onDemurrage} />)

  await user.click(screen.getByTitle('Detalhes'))
  expect(mocks.onLocal).toHaveBeenCalledWith(11, 21)
  expect(mocks.onDemurrage).not.toHaveBeenCalled()
})

it('exports using the filters currently entered by the user', async () => {
  const user = userEvent.setup()
  render(<ReconciliationHistoryTable />)

  await user.click(screen.getByRole('button', { name: 'Filtros do histórico' }))
  await user.type(screen.getByLabelText('B/L'), 'BL99')
  await user.selectOptions(screen.getByLabelText('Tipo'), 'local')
  await user.click(screen.getByRole('button', { name: 'Exportar Excel' }))

  expect(mocks.exportExcel).toHaveBeenCalledWith(expect.objectContaining({
    blSearch: 'BL99',
    source: 'local',
    page: 1,
    pageSize: 50,
  }))
})

it('renders a dedicated query error state', () => {
  mocks.queryState.error = new Error('history unavailable')
  render(<ReconciliationHistoryTable />)
  expect(screen.getByText('Erro ao carregar histórico de conciliação.')).toBeTruthy()
  mocks.queryState.error = null
})

it('reports export failures without leaving an unhandled rejection', async () => {
  mocks.exportExcel.mockRejectedValueOnce(new Error('write failed'))
  const user = userEvent.setup()
  render(<ReconciliationHistoryTable />)

  await user.click(screen.getByRole('button', { name: 'Exportar Excel' }))

  expect(mocks.showToast).toHaveBeenCalledWith('Falha ao exportar o histórico de conciliação.', 'error')
})
