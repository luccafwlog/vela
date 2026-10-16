// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const baseRow = {
  id: 'local-1',
  source: 'local',
  invoiceId: 11,
  paymentId: 21,
  blId: 'BL1',
  docNumber: 'INV-11',
  invoiceType: 'individual',
  customerName: 'Cliente',
  customerCnpj: '12345678000190',
  blAmount: 10,
  totalAmount: 10,
  totalPaid: 10,
  balance: 0,
  vesselName: 'Navio',
  voyageNumber: 'V1',
  pod: 'BRVIX',
  paidAt: '2026-06-23',
  status: 'paid',
}

const mocks = vi.hoisted(() => ({
  exportExcel: vi.fn(),
  showToast: vi.fn(),
  onLocal: vi.fn(),
  onDemurrage: vi.fn(),
  refetch: vi.fn(),
  lastQuery: null as null | { queryKey: unknown[] },
  queryState: {
    data: null as null | { rows: unknown[]; totalCount: number; summary?: { invoices: number; received: number } },
    isLoading: false,
    error: null as Error | null,
  },
}))

vi.mock('@tanstack/react-query', () => ({
  useQuery: (options: { queryKey: unknown[] }) => {
    mocks.lastQuery = options
    return { ...mocks.queryState, refetch: mocks.refetch }
  },
}))
vi.mock('../../../services/reconciliacao', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/reconciliacao')>()
  return {
    listReconciliationHistory: vi.fn(),
    exportReconciliationHistoryExcel: mocks.exportExcel,
    historyPaidAmount: actual.historyPaidAmount,
    historyBalance: actual.historyBalance,
  }
})
vi.mock('../../../services/billing', () => ({
  listBillingCustomers: vi.fn().mockResolvedValue([]),
  invoiceTypeLabel: (invoiceType: string | null) => invoiceType === 'consolidated' ? 'Consolidada' : invoiceType === 'manual' ? 'Avulsa' : 'Individual',
}))
vi.mock('../../ui/Combobox', () => ({ Combobox: ({ initialValue }: { initialValue: string }) => <span>Cliente: {initialValue || 'vazio'}</span> }))
vi.mock('../../ui/Toast', () => ({
  useToast: () => ({ showToast: mocks.showToast }),
}))

import { ReconciliationHistoryTable } from '../ReconciliationHistoryTable'

function Search() {
  return <output data-testid="search">{useLocation().search}</output>
}

function renderTable(path = '/reconciliacao?tab=historico') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ReconciliationHistoryTable onSelectLocalInvoice={mocks.onLocal} onSelectDemurrageInvoice={mocks.onDemurrage} />
      <Search />
    </MemoryRouter>,
  )
}

function lastFilters() {
  return mocks.lastQuery?.queryKey[1] as Record<string, unknown>
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.queryState.data = {
    rows: [
      baseRow,
      { ...baseRow, id: 'local-2', invoiceId: 12, paymentId: 22, docNumber: 'INV-12', blId: 'BL2', status: 'partially_paid', blAmount: 300, totalAmount: 500, totalPaid: 200, balance: 300, invoiceType: 'consolidated' },
      { ...baseRow, id: 'demurrage-31', source: 'demurrage', invoiceId: 31, paymentId: null, docNumber: 'DEM-31', invoiceType: null },
    ],
    totalCount: 3,
    summary: { invoices: 3, received: 220 },
  }
  mocks.queryState.isLoading = false
  mocks.queryState.error = null
})
afterEach(cleanup)

it('nomeia a tabela, anuncia a ordenação e leva a ordem para a URL', async () => {
  const user = userEvent.setup()
  renderTable()

  expect(screen.getByRole('table', { name: 'Histórico de baixas' })).toBeTruthy()
  const paidAt = screen.getByRole('columnheader', { name: 'Pago em' })
  expect(paidAt.getAttribute('aria-sort')).toBe('descending')

  await user.click(screen.getByRole('button', { name: 'B/L' }))
  expect(screen.getByRole('columnheader', { name: 'B/L' }).getAttribute('aria-sort')).toBe('descending')
  expect(screen.getByRole('columnheader', { name: 'Pago em' }).getAttribute('aria-sort')).toBeNull()
  expect(screen.getByTestId('search').textContent).toBe('?tab=historico&ordem=blId')
})

it('o número da fatura abre o detalhe da baixa escolhida, local ou de Demurrage', async () => {
  const user = userEvent.setup()
  renderTable()

  await user.click(screen.getByRole('button', { name: 'INV-11' }))
  expect(mocks.onLocal).toHaveBeenCalledWith(11, 21)
  await user.click(screen.getByRole('button', { name: 'DEM-31' }))
  expect(mocks.onDemurrage).toHaveBeenCalledWith(31)
  expect(screen.queryByTitle('Detalhes')).toBeNull()
})

it('tabela limpa: colunas da tela, valor pago, saldo em âmbar e situação em texto', () => {
  renderTable()
  const headers = screen.getAllByRole('columnheader').map((th) => th.textContent)
  expect(headers).toEqual(['Fatura', 'Origem', 'B/L', 'Cliente', 'Navio / Viagem', 'Pago em', 'Valor do B/L', 'Valor pago', 'Saldo', 'Situação'])
  const partial = screen.getByRole('button', { name: 'INV-12' }).closest('tr')!
  const cells = Array.from(partial.querySelectorAll('td')).map((td) => td.textContent?.replace(/\s/g, ' '))
  expect(cells).toEqual(['INV-12', 'Taxas Locais', 'BL2', 'Cliente', 'Navio / V1', '23/06/2026', 'R$ 300,00', 'R$ 200,00', 'R$ 300,00', 'Parcialmente paga'])
  // Saldo a receber em âmbar; consolidada com o ícone de pilha.
  expect(partial.querySelector('.app-status-text--warning')?.textContent?.replace(/\s/g, ' ')).toBe('R$ 300,00')
  expect(partial.querySelector('[aria-label="Consolidada"]')).toBeTruthy()
  expect(screen.getAllByText('Paga')).toHaveLength(2)
  expect(screen.getByRole('button', { name: 'DEM-31' }).closest('tr')!.textContent).toContain('Demurrage')
  // Nada escrito embaixo da célula: sai o CNPJ sob o Cliente e o "de R$ X na fatura".
  expect(screen.queryByText(/na fatura/)).toBeNull()
  expect(screen.queryByText('12.345.678/0001-90')).toBeNull()
  // Resumo do recorte na faixa do bloco.
  expect(screen.getByText((text) => text.replace(/\s/g, ' ') === '3 faturas · R$ 220,00 pagos')).toBeTruthy()
  expect(screen.getByText('Exibindo 1–3 de 3')).toBeTruthy()
})

it('filtros vão para a URL, voltam à primeira página e são os da exportação', async () => {
  mocks.queryState.data = { ...mocks.queryState.data!, totalCount: 60 }
  const user = userEvent.setup()
  renderTable('/reconciliacao?tab=historico&pagina=2')
  expect(lastFilters()).toEqual(expect.objectContaining({ page: 2 }))

  // Pago de, Pago até, Origem, Cliente e B/L ficam abertos.
  await user.type(screen.getByLabelText('B/L'), 'BL99')
  await user.selectOptions(screen.getByLabelText('Origem'), 'local')
  expect(screen.getByTestId('search').textContent).toBe('?tab=historico&bl=BL99&origem=local')
  expect(lastFilters()).toEqual(expect.objectContaining({ blSearch: 'BL99', source: 'local', page: 1 }))

  await user.click(screen.getByRole('button', { name: 'Exportar planilha' }))
  expect(mocks.exportExcel).toHaveBeenCalledWith(expect.objectContaining({ blSearch: 'BL99', source: 'local', page: 1, pageSize: 50 }))
})

it('o Cliente vem da URL com o nome e Tipo de fatura (em Mais filtros) não vale para Demurrage', async () => {
  // Com filtros ativos, a barra já abre.
  renderTable('/reconciliacao?tab=historico&cliente=7&clienteNome=ACME%20LTDA&origem=demurrage')
  expect(screen.getByText('Cliente: ACME LTDA')).toBeTruthy()
  await userEvent.setup().click(screen.getByRole('button', { name: /Mais filtros/ }))
  expect((screen.getByLabelText(/Tipo de fatura/) as HTMLSelectElement).disabled).toBe(true)
  expect(lastFilters()).toEqual(expect.objectContaining({ customerId: '7', source: 'demurrage' }))
})

it('trocar a Origem para Demurrage tira o Tipo de fatura em vez de prendê-lo no filtro', async () => {
  const user = userEvent.setup()
  renderTable('/reconciliacao?tab=historico&tipo=manual')

  await user.selectOptions(screen.getByLabelText('Origem'), 'demurrage')
  const type = screen.getByLabelText(/Tipo de fatura/) as HTMLSelectElement
  expect(type.disabled).toBe(true)
  expect(type.value).toBe('')
  expect(screen.getByTestId('search').textContent).toBe('?tab=historico&origem=demurrage')
  expect(lastFilters()).toEqual(expect.objectContaining({ source: 'demurrage', invoiceTypeFilter: '' }))
})

it('página além do fim vai para a última existente sem dizer que não há baixas', () => {
  renderTable('/reconciliacao?tab=historico&pagina=999')

  expect(screen.getByTestId('search').textContent).toBe('?tab=historico')
  expect(screen.queryByText('Nenhuma baixa registrada ainda')).toBeNull()
  expect(screen.getByText('Exibindo 1–3 de 3')).toBeTruthy()
})

it('erro de consulta não vira lista vazia nem "Nenhum registro"', async () => {
  mocks.queryState.data = null
  mocks.queryState.error = new Error('history unavailable')
  const user = userEvent.setup()
  renderTable()

  expect(screen.getByText(/Não foi possível carregar o histórico de baixas: history unavailable/)).toBeTruthy()
  expect(screen.queryByText(/Nenhuma baixa/)).toBeNull()
  expect(screen.queryByText('Nenhum registro')).toBeNull()
  expect((screen.getByRole('button', { name: 'Exportar planilha' }) as HTMLButtonElement).disabled).toBe(true)
  await user.click(screen.getByRole('button', { name: 'Tentar novamente' }))
  expect(mocks.refetch).toHaveBeenCalled()
})

it('vazio com filtro oferece Limpar filtros; sem filtro explica o que aparece aqui', async () => {
  mocks.queryState.data = { rows: [], totalCount: 0, summary: { invoices: 0, received: 0 } }
  const user = userEvent.setup()
  const { unmount } = renderTable('/reconciliacao?tab=historico&bl=XX')
  expect(screen.getByText('Nenhuma baixa neste recorte')).toBeTruthy()
  // Um ao lado dos filtros abertos, outro no vazio.
  await user.click(screen.getAllByRole('button', { name: 'Limpar filtros' }).at(-1)!)
  expect(screen.getByTestId('search').textContent).toBe('?tab=historico')
  unmount()

  renderTable()
  expect(screen.getByText('Nenhuma baixa registrada ainda')).toBeTruthy()
  expect((screen.getByRole('button', { name: 'Exportar planilha' }) as HTMLButtonElement).disabled).toBe(true)
})

it('falha da exportação avisa sem rejeição solta', async () => {
  mocks.exportExcel.mockRejectedValueOnce(new Error('write failed'))
  const user = userEvent.setup()
  renderTable()

  await user.click(screen.getByRole('button', { name: 'Exportar planilha' }))
  expect(mocks.showToast).toHaveBeenCalledWith('Falha ao exportar o histórico de baixas.', 'error')
})
