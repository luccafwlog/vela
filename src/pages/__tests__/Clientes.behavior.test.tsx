// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  showToast: vi.fn(),
  confirm: vi.fn(),
  useCustomers: vi.fn(),
  createCustomer: vi.fn(),
  parseCustomerBaseFile: vi.fn(),
  compareCustomerBaseWithExisting: vi.fn(),
  importCustomerBaseRows: vi.fn(),
  checkCustomerDependencies: vi.fn(),
  deleteCustomers: vi.fn(),
  confirmWithReason: vi.fn(),
  supabaseFrom: vi.fn(),
  supabaseOr: vi.fn(),
  exportCustomerBaseWorkbook: vi.fn(),
}))

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return { ...actual, useNavigate: () => mocks.navigate }
})
vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({
    can: () => true,
    isAdmin: true,
    user: { id: 'user-1' },
    effectiveRole: 'administrativo',
  }),
}))
vi.mock('../../hooks/useCustomers', () => ({
  useCustomers: mocks.useCustomers,
  useCustomerSummary: () => ({
    data: { pendingBalance: 150, totalCustomers: 1, totalBls: 1, chargePending: 1, chargeReady: 0 },
  }),
  filterCustomerRowsByClientSideFilters: (rows: unknown[]) => rows,
}))
vi.mock('../../hooks/usePortalProvisioning', () => ({
  usePortalProvisioning: () => ({ data: [] }),
}))
vi.mock('../../components/ui/Toast', () => ({
  useToast: () => ({ showToast: mocks.showToast }),
}))
vi.mock('../../components/ui/ConfirmDialog', () => ({
  useConfirm: () => mocks.confirm,
  useConfirmWithReason: () => mocks.confirmWithReason,
}))
vi.mock('../../services/customers', () => ({
  createCustomer: mocks.createCustomer,
  checkCustomerDependencies: mocks.checkCustomerDependencies,
  deleteCustomers: mocks.deleteCustomers,
  fetchIssuedInvoiceBalanceByCustomer: vi.fn(() => Promise.resolve(new Map())),
  fetchCustomerPendingBalance: vi.fn(() => Promise.resolve({ localBrl: 0, demurrageBrl: 0, totalBrl: 0 })),
}))
vi.mock('../../services/customerBase', () => ({
  parseCustomerBaseFile: mocks.parseCustomerBaseFile,
  compareCustomerBaseWithExisting: mocks.compareCustomerBaseWithExisting,
  importCustomerBaseRows: mocks.importCustomerBaseRows,
}))
vi.mock('../../services/exports', () => ({ exportCustomerBaseWorkbook: mocks.exportCustomerBaseWorkbook }))
vi.mock('../../services/supabase', () => ({ supabase: { from: mocks.supabaseFrom } }))

import { Clientes } from '../Clientes'

const customer = {
  id: 42,
  name: 'Cliente Teste',
  cnpj_cpf: '12345678000195',
  trade_name: 'Teste',
  city: 'Vitoria',
  state: 'ES',
  pending_balance: 150,
  customer_contacts: [{ id: 7, email: 'financeiro@example.com', purpose: 'financeiro', is_primary: true }],
  bls: [{ id: 'BL-001', charge_status: 'pending' }],
}

const parsedBase = {
  rows: [{
    cnpj_cpf: '98765432000110',
    name: 'Cliente Importado',
    trade_name: null,
    emails: ['importado@example.com'],
    address: null,
    city: 'Santos',
    state: 'SP',
    zip: null,
  }],
  rowErrors: [],
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')
  const view = render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <Clientes />
      </QueryClientProvider>
    </MemoryRouter>,
  )
  return { ...view, invalidateQueries }
}

describe('Clientes page behaviours', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.useCustomers.mockImplementation(() => ({
      data: { rows: [customer], totalCount: 101 },
      isLoading: false,
      error: null,
    }))
    mocks.createCustomer.mockResolvedValue({ cnpj_cpf: '12345678000195' })
    mocks.parseCustomerBaseFile.mockResolvedValue(parsedBase)
    mocks.compareCustomerBaseWithExisting.mockResolvedValue(parsedBase)
    mocks.importCustomerBaseRows.mockResolvedValue({ imported: 1, updated: 0, contactsCreated: 1, blsLinked: 1 })
    mocks.checkCustomerDependencies.mockResolvedValue({ deletableIds: [42], blockedIds: [] })
    mocks.deleteCustomers.mockResolvedValue({ deletableIds: [42], blockedIds: [] })
    mocks.confirm.mockResolvedValue(true)
    mocks.confirmWithReason.mockResolvedValue('cadastro duplicado')
    mocks.exportCustomerBaseWorkbook.mockResolvedValue(undefined)
    const exportResult = Promise.resolve({ data: [customer], error: null })
    const exportQuery = {
      select: vi.fn(),
      order: vi.fn(),
      or: mocks.supabaseOr,
      // A exportação pagina em blocos de 1000 por `.range()`; devolver uma
      // página curta encerra o laço na primeira volta.
      range: vi.fn(() => Promise.resolve({ data: [customer], error: null })),
      then: exportResult.then.bind(exportResult),
    }
    exportQuery.select.mockReturnValue(exportQuery)
    exportQuery.order.mockReturnValue(exportQuery)
    exportQuery.or.mockReturnValue(exportQuery)
    mocks.supabaseFrom.mockReturnValue(exportQuery)
  })

  afterEach(cleanup)

  it('creates a customer, invalidates customer caches, closes and resets the modal', async () => {
    const user = userEvent.setup()
    const { invalidateQueries } = renderPage()

    await user.click(screen.getByRole('button', { name: 'Novo Cliente' }))
    await user.type(screen.getByLabelText('CNPJ'), '12345678000195')
    await user.type(screen.getByLabelText('Razao Social'), 'Cliente Novo')
    await user.type(screen.getByLabelText('Nome'), 'Financeiro')
    await user.type(screen.getByLabelText('Email'), 'novo@example.com')
    await user.click(screen.getByRole('button', { name: 'Cadastrar cliente' }))

    await waitFor(() => expect(mocks.createCustomer).toHaveBeenCalledWith(expect.objectContaining({
      cnpjCpf: '12345678000195',
      name: 'Cliente Novo',
      contacts: [expect.objectContaining({ name: 'Financeiro', email: 'novo@example.com' })],
    })))
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['customers'] })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['customer-lookup'] })
    expect(mocks.navigate).toHaveBeenCalledWith('/clientes/12345678000195')
    expect(screen.queryByRole('dialog', { name: 'Novo Cliente' })).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Novo Cliente' }))
    expect((screen.getByLabelText('CNPJ') as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText('Razao Social') as HTMLInputElement).value).toBe('')
  })

  it('normalizes a pasted alphanumeric CNPJ immediately', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: 'Novo Cliente' }))
    const input = screen.getByLabelText('CNPJ') as HTMLInputElement
    fireEvent.change(input, { target: { value: '12.ABC.345/01DE-35' } })

    expect(input.value).toBe('12ABC34501DE35')
  })

  it('imports the parsed customer base, invalidates dependent caches, closes and resets the modal', async () => {
    const user = userEvent.setup()
    const { invalidateQueries } = renderPage()
    const file = new File(['cnpj,nome'], 'clientes.csv', { type: 'text/csv' })

    await user.click(screen.getByRole('button', { name: 'Importar base' }))
    await user.upload(screen.getByLabelText('Arquivo .xlsx, .xls ou .csv'), file)

    expect(await screen.findByText('Cliente Importado')).toBeTruthy()
    expect(mocks.parseCustomerBaseFile).toHaveBeenCalledWith(file)
    expect(mocks.compareCustomerBaseWithExisting).toHaveBeenCalledWith(parsedBase)
    await user.click(within(screen.getByRole('dialog', { name: 'Importar Base de Clientes' })).getByRole('button', { name: 'Importar base' }))

    await waitFor(() => expect(mocks.importCustomerBaseRows).toHaveBeenCalledWith(parsedBase.rows, { changedBy: 'user-1' }))
    for (const queryKey of [['customers'], ['customer-lookup'], ['bls']]) {
      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey })
    }
    expect(screen.queryByRole('dialog', { name: 'Importar Base de Clientes' })).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Importar base' }))
    expect(screen.queryByText('Arquivo selecionado: clientes.csv')).toBeNull()
    expect(screen.queryByText('Cliente Importado')).toBeNull()
  })

  it('deletes a selected customer after dependency checks and clears selection', async () => {
    const user = userEvent.setup()
    const { invalidateQueries } = renderPage()

    await user.click(screen.getByRole('checkbox', { name: 'Selecionar cliente Cliente Teste' }))
    await user.click(screen.getByRole('button', { name: 'Excluir selecionados' }))

    await waitFor(() => expect(mocks.deleteCustomers).toHaveBeenCalledWith([42], 'cadastro duplicado'))
    expect(mocks.checkCustomerDependencies).toHaveBeenCalledWith([42])
    expect(mocks.confirmWithReason).toHaveBeenCalledWith(expect.objectContaining({
      tone: 'danger',
      confirmLabel: 'Excluir',
      affected: expect.objectContaining({ summary: '1 cliente(s) serão excluído(s).' }),
    }))
    for (const queryKey of [['customers'], ['customers-summary'], ['customer-lookup']]) {
      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey })
    }
    expect(screen.queryByText('1 cliente selecionado')).toBeNull()
    expect((screen.getByRole('checkbox', { name: 'Selecionar cliente Cliente Teste' }) as HTMLInputElement).checked).toBe(false)
  })

  it('delegates table sorting and row menu copy actions through the page state', async () => {
    const user = userEvent.setup()
    const writeText = vi.spyOn(navigator.clipboard, 'writeText')
    renderPage()

    await user.click(screen.getByRole('button', { name: 'Cliente' }))
    expect(mocks.useCustomers).toHaveBeenLastCalledWith(expect.objectContaining({
      sortKey: 'name',
      sortDirection: 'desc',
    }))

    await user.click(screen.getByRole('button', { name: 'Mais ações para Cliente Teste' }))
    await user.click(screen.getByRole('menuitem', { name: 'Copiar CNPJ' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('12.345.678/0001-95'))
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('escapes structural search terms when exporting the customer base', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: 'Filtros' }))
    await user.type(screen.getByPlaceholderText('Razao social, fantasia ou documento'), 'ACME,ME')
    await user.click(screen.getByRole('button', { name: 'Exportar base' }))

    await waitFor(() => expect(mocks.exportCustomerBaseWorkbook).toHaveBeenCalled())
    expect(mocks.supabaseOr).toHaveBeenCalledWith(
      'name.ilike.%ACME ME%,trade_name.ilike.%ACME ME%,cnpj_cpf.ilike.%ACME ME%',
    )
  })

  it('does not emit a match-all filter when export search sanitizes to empty', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: 'Filtros' }))
    await user.type(screen.getByPlaceholderText('Razao social, fantasia ou documento'), '%%')
    await user.click(screen.getByRole('button', { name: 'Exportar base' }))

    await waitFor(() => expect(mocks.exportCustomerBaseWorkbook).toHaveBeenCalled())
    expect(mocks.supabaseOr).not.toHaveBeenCalled()
  })
})
