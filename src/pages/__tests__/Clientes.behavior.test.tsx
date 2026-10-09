// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Link, MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  showToast: vi.fn(),
  confirm: vi.fn(),
  useCustomers: vi.fn(),
  useCustomerSummary: vi.fn(),
  createCustomer: vi.fn(),
  parseCustomerBaseFile: vi.fn(),
  compareCustomerBaseWithExisting: vi.fn(),
  importCustomerBaseRows: vi.fn(),
  checkCustomerDependencies: vi.fn(),
  deleteCustomers: vi.fn(),
  deactivateCustomer: vi.fn(),
  reactivateCustomer: vi.fn(),
  confirmWithReason: vi.fn(),
  supabaseFrom: vi.fn(),
  supabaseOr: vi.fn(),
  exportCustomerBaseWorkbook: vi.fn(),
  fetchCustomerRows: vi.fn(),
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
  useCustomerSummary: mocks.useCustomerSummary,
  fetchCustomerRows: mocks.fetchCustomerRows,
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
  deactivateCustomer: mocks.deactivateCustomer,
  reactivateCustomer: mocks.reactivateCustomer,
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

function LocationProbe() {
  const location = useLocation()
  return <span data-testid="location">{location.pathname + location.search}</span>
}

function renderPage(initialEntry = '/clientes') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')
  const view = render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <QueryClientProvider client={queryClient}>
        <Link to="/clientes">Menu Clientes</Link>
        <LocationProbe />
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
      fetchStatus: 'idle',
      refetch: vi.fn(),
    }))
    mocks.useCustomerSummary.mockReturnValue({
      data: { pendingBalance: 150, totalCustomers: 1, totalBls: 1, chargePending: 1, chargeReady: 0, customersWithoutEmail: 0 },
    })
    mocks.createCustomer.mockResolvedValue({ cnpj_cpf: '12345678000195' })
    mocks.parseCustomerBaseFile.mockResolvedValue(parsedBase)
    mocks.compareCustomerBaseWithExisting.mockResolvedValue(parsedBase)
    mocks.importCustomerBaseRows.mockResolvedValue({ imported: 1, updated: 0, contactsCreated: 1, blsLinked: 1 })
    mocks.checkCustomerDependencies.mockResolvedValue({ deletableIds: [42], blockedIds: [] })
    mocks.deleteCustomers.mockResolvedValue({ deletableIds: [42], blockedIds: [] })
    mocks.confirm.mockResolvedValue(true)
    mocks.confirmWithReason.mockResolvedValue('cadastro duplicado')
    mocks.exportCustomerBaseWorkbook.mockResolvedValue(undefined)
    mocks.fetchCustomerRows.mockResolvedValue({ rows: [customer], count: 1, totalCount: 1 })
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

  afterEach(() => {
    cleanup()
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true })
  })

  it('does not present an uncached customer list as empty while offline', () => {
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: false })
    mocks.useCustomers.mockReturnValue({ data: undefined, isLoading: false, error: null, fetchStatus: 'paused', refetch: vi.fn() })
    mocks.useCustomerSummary.mockReturnValue({ data: undefined })

    renderPage()

    expect(screen.getByRole('status').textContent).toContain('Sem conexão no momento.')
    expect(screen.queryByText('Nenhum cliente encontrado.')).toBeNull()
    expect(screen.queryByRole('table', { name: 'Clientes filtrados' })).toBeNull()
  })

  it('keeps cached customer rows visible with an offline notice', () => {
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: false })
    mocks.useCustomers.mockReturnValue({
      data: { rows: [customer], totalCount: 1 },
      isLoading: false,
      error: null,
      fetchStatus: 'paused',
      refetch: vi.fn(),
    })

    renderPage()

    expect(screen.getByRole('status').textContent).toContain('Você está offline. Exibindo dados salvos')
    expect(screen.getByRole('row', { name: /Cliente Teste/ })).toBeTruthy()
  })

  it('creates a customer, invalidates customer caches, closes and resets the modal', async () => {
    const user = userEvent.setup()
    const { invalidateQueries } = renderPage()

    await user.click(screen.getByRole('button', { name: 'Novo cliente' }))
    await user.type(screen.getByLabelText(/^CNPJ/), '12345678000195')
    await user.type(screen.getByLabelText(/^Razão social/), 'Cliente Novo')
    await user.type(screen.getByLabelText('Nome'), 'Financeiro')
    await user.type(screen.getByLabelText(/^E-mail/), 'novo@example.com')
    await user.click(screen.getByRole('button', { name: 'Cadastrar cliente' }))

    await waitFor(() => expect(mocks.createCustomer).toHaveBeenCalledWith(expect.objectContaining({
      cnpjCpf: '12345678000195',
      name: 'Cliente Novo',
      contacts: [expect.objectContaining({ name: 'Financeiro', email: 'novo@example.com' })],
    })))
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['customers'] })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['customer-lookup'] })
    expect(mocks.navigate).toHaveBeenCalledWith('/clientes/12345678000195')
    expect(screen.queryByRole('dialog', { name: 'Novo cliente' })).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Novo cliente' }))
    expect((screen.getByLabelText(/^CNPJ/) as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText(/^Razão social/) as HTMLInputElement).value).toBe('')
  })

  it('normalizes a pasted alphanumeric CNPJ immediately', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: 'Novo cliente' }))
    const input = screen.getByLabelText(/^CNPJ/) as HTMLInputElement
    fireEvent.change(input, { target: { value: '12.ABC.345/01DE-35' } })

    expect(input.value).toBe('12ABC34501DE35')
  })

  it('imports the parsed customer base, invalidates dependent caches, closes and resets the modal', async () => {
    const user = userEvent.setup()
    const { invalidateQueries } = renderPage()
    const file = new File(['cnpj,nome'], 'clientes.csv', { type: 'text/csv' })

    await user.click(screen.getByRole('button', { name: 'Importar base' }))
    await user.upload(screen.getByLabelText('Arquivo (XLSX, XLS ou CSV)'), file)

    expect(await screen.findByText('Cliente Importado')).toBeTruthy()
    expect(mocks.parseCustomerBaseFile).toHaveBeenCalledWith(file)
    expect(mocks.compareCustomerBaseWithExisting).toHaveBeenCalledWith(parsedBase)
    await user.click(within(screen.getByRole('dialog', { name: 'Importar base de clientes' })).getByRole('button', { name: 'Importar base' }))

    await waitFor(() => expect(mocks.importCustomerBaseRows).toHaveBeenCalledWith(parsedBase.rows, { changedBy: 'user-1' }))
    for (const queryKey of [['customers'], ['customer-lookup'], ['bls']]) {
      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey })
    }
    expect(screen.queryByRole('dialog', { name: 'Importar base de clientes' })).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Importar base' }))
    expect(screen.queryByText('Arquivo selecionado: clientes.csv')).toBeNull()
    expect(screen.queryByText('Cliente Importado')).toBeNull()
  })

  it('falha ao gravar a base fica no modal, que continua aberto com a prévia', async () => {
    const user = userEvent.setup()
    mocks.importCustomerBaseRows.mockRejectedValue(new Error('Sem conexão com o servidor.'))
    renderPage()

    await user.click(screen.getByRole('button', { name: 'Importar base' }))
    await user.upload(screen.getByLabelText('Arquivo (XLSX, XLS ou CSV)'), new File(['cnpj,nome'], 'clientes.csv', { type: 'text/csv' }))
    expect(await screen.findByText('Cliente Importado')).toBeTruthy()
    const dialog = screen.getByRole('dialog', { name: 'Importar base de clientes' })
    await user.click(within(dialog).getByRole('button', { name: 'Importar base' }))

    expect(await within(dialog).findByText('Não foi possível gravar a base')).toBeTruthy()
    expect(within(dialog).getByText('Cliente Importado')).toBeTruthy()
    expect(mocks.showToast).not.toHaveBeenCalledWith(expect.stringContaining('Falha'), 'error')
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

  it('desativa o cliente pela prévia, com motivo (ADR 0073)', async () => {
    const user = userEvent.setup()
    mocks.deactivateCustomer.mockReset()
      .mockResolvedValueOnce({ deactivated: false, reasons: [] })
      .mockResolvedValueOnce({ deactivated: true, reasons: [] })
    renderPage()

    await user.click(screen.getByRole('button', { name: 'Mais ações para Cliente Teste' }))
    await user.click(screen.getByRole('menuitem', { name: 'Desativar cliente' }))

    await waitFor(() => expect(mocks.deactivateCustomer).toHaveBeenLastCalledWith(42, 'cadastro duplicado'))
    expect(mocks.deactivateCustomer).toHaveBeenNthCalledWith(1, 42, '', { dryRun: true })
    expect(mocks.confirmWithReason).toHaveBeenCalledWith(expect.objectContaining({ title: 'Desativar cliente' }))
  })

  it('não abre a confirmação quando há cobrança em aberto', async () => {
    const user = userEvent.setup()
    mocks.deactivateCustomer.mockReset().mockResolvedValueOnce({ deactivated: false, reasons: ['fatura em aberto'] })
    mocks.confirmWithReason.mockClear()
    renderPage()

    await user.click(screen.getByRole('button', { name: 'Mais ações para Cliente Teste' }))
    await user.click(screen.getByRole('menuitem', { name: 'Desativar cliente' }))

    await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith(expect.stringContaining('fatura em aberto'), 'error'))
    expect(mocks.confirmWithReason).not.toHaveBeenCalled()
  })

  it('mostra um aviso em diálogo quando o cliente não pode ser excluído', async () => {
    const user = userEvent.setup()
    mocks.checkCustomerDependencies.mockResolvedValueOnce({ deletableIds: [], blockedIds: [{ id: 42, reasons: ['possui B/Ls'] }] })
    mocks.confirm.mockClear()
    mocks.confirmWithReason.mockClear()
    renderPage()

    await user.click(screen.getByRole('button', { name: 'Mais ações para Cliente Teste' }))
    await user.click(screen.getByRole('menuitem', { name: 'Excluir cliente' }))

    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({
      noticeOnly: true,
      affected: expect.objectContaining({ blocked: [{ label: '42', reasons: ['possui B/Ls'] }] }),
    })))
    expect(mocks.confirmWithReason).not.toHaveBeenCalled()
    expect(mocks.deleteCustomers).not.toHaveBeenCalled()
  })

  it('delegates table sorting and row menu copy actions through the page state', async () => {
    const user = userEvent.setup()
    const writeText = vi.spyOn(navigator.clipboard, 'writeText')
    renderPage()

    expect(screen.getByRole('table', { name: 'Clientes filtrados' })).toBeTruthy()
    const clientColumn = screen.getByRole('columnheader', { name: 'Cliente' })
    expect(clientColumn.getAttribute('aria-sort')).toBe('ascending')
    await user.click(screen.getByRole('button', { name: 'Cliente' }))
    expect(clientColumn.getAttribute('aria-sort')).toBe('descending')
    expect(mocks.useCustomers).toHaveBeenLastCalledWith(expect.objectContaining({
      sortKey: 'name',
      sortDirection: 'desc',
    }))

    await user.click(screen.getByRole('button', { name: 'Mais ações para Cliente Teste' }))
    await user.click(screen.getByRole('menuitem', { name: 'Copiar CNPJ' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('12.345.678/0001-95'))
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('supports arrow navigation and restores focus when the customer actions menu closes with Escape', async () => {
    const user = userEvent.setup()
    renderPage()

    const trigger = screen.getByRole('button', { name: 'Mais ações para Cliente Teste' })
    await user.click(trigger)

    const menuItems = screen.getAllByRole('menuitem')
    expect(document.activeElement).toBe(menuItems[0])
    await user.keyboard('{ArrowDown}')
    expect(document.activeElement).toBe(menuItems[1])
    await user.keyboard('{Escape}')

    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('exporta exatamente o recorte da lista: busca, filtros e ordem, todas as páginas', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.type(screen.getByLabelText('Buscar cliente'), '12.345.678')
    await user.click(screen.getByRole('button', { name: /^Saldo pendente\s*R\$/ }))
    await waitFor(() => expect(mocks.useCustomers).toHaveBeenLastCalledWith(expect.objectContaining({ search: '12.345.678' })))
    await user.click(screen.getByRole('button', { name: 'Exportar base' }))

    await waitFor(() => expect(mocks.exportCustomerBaseWorkbook).toHaveBeenCalledWith([customer]))
    expect(mocks.fetchCustomerRows).toHaveBeenCalledWith(
      expect.objectContaining({ search: '12.345.678', pendingStatus: 'with', sortKey: 'name', page: 0 }),
      false,
    )
  })

  it('não gera arquivo vazio quando o recorte não tem clientes', async () => {
    const user = userEvent.setup()
    mocks.fetchCustomerRows.mockResolvedValue({ rows: [], count: 0, totalCount: 0 })
    renderPage()

    await user.click(screen.getByRole('button', { name: 'Exportar base' }))

    await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith('Nenhum cliente no recorte atual para exportar.', 'info'))
    expect(mocks.exportCustomerBaseWorkbook).not.toHaveBeenCalled()
  })

  it('card de saldo filtra a lista e fica marcado; vazio do filtro oferece Limpar filtros', async () => {
    const user = userEvent.setup()
    renderPage()

    const card = screen.getByRole('button', { name: /^Saldo pendente\s*R\$/ })
    await user.click(card)
    expect(card.getAttribute('aria-pressed')).toBe('true')
    expect(mocks.useCustomers).toHaveBeenLastCalledWith(expect.objectContaining({ pendingStatus: 'with', page: 0 }))

    mocks.useCustomers.mockImplementation(() => ({ data: { rows: [], totalCount: 0 }, isLoading: false, error: null, fetchStatus: 'idle', refetch: vi.fn() }))
    await user.type(screen.getByLabelText('Buscar cliente'), 'zzz')
    expect(await screen.findByText('Nenhum cliente com esses filtros')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Limpar filtros' }))
    expect((screen.getByLabelText('Buscar cliente') as HTMLInputElement).value).toBe('')
    expect(card.getAttribute('aria-pressed')).toBe('false')
  })

  it('cadastro com contato sem e-mail mostra o erro junto dos contatos, sem confirmar', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: 'Novo cliente' }))
    await user.type(screen.getByLabelText(/^CNPJ/), '12345678000195')
    await user.type(screen.getByLabelText(/^Razão social/), 'Cliente Novo')
    await user.type(screen.getByLabelText('Nome'), 'Financeiro')
    await user.click(screen.getByRole('button', { name: 'Cadastrar cliente' }))

    expect(screen.getByText('O contato principal precisa de um e-mail válido.')).toBeTruthy()
    expect(mocks.confirm).not.toHaveBeenCalled()
    expect(mocks.createCustomer).not.toHaveBeenCalled()
  })

  it('falha ao cadastrar fica no formulário, que continua aberto', async () => {
    const user = userEvent.setup()
    mocks.createCustomer.mockRejectedValue(new Error('duplicate key value violates unique constraint'))
    renderPage()

    await user.click(screen.getByRole('button', { name: 'Novo cliente' }))
    await user.type(screen.getByLabelText(/^CNPJ/), '12345678000195')
    await user.type(screen.getByLabelText(/^Razão social/), 'Cliente Novo')
    await user.type(screen.getByLabelText('Nome'), 'Financeiro')
    await user.type(screen.getByLabelText(/^E-mail/), 'novo@example.com')
    await user.click(screen.getByRole('button', { name: 'Cadastrar cliente' }))

    const dialog = await screen.findByRole('dialog', { name: 'Novo cliente' })
    await waitFor(() => expect(within(dialog).getAllByRole('alert').length).toBeGreaterThan(0))
    expect(mocks.navigate).not.toHaveBeenCalled()
  })

  it('link de fora para /clientes (menu, Alerta) troca o recorte em vez de ser desfeito', async () => {
    const user = userEvent.setup()
    renderPage('/clientes?saldo=com')

    const card = screen.getByRole('button', { name: /^Saldo pendente\s*R\$/ })
    expect(card.getAttribute('aria-pressed')).toBe('true')

    await user.click(screen.getByRole('link', { name: 'Menu Clientes' }))
    await waitFor(() => expect(card.getAttribute('aria-pressed')).toBe('false'))
    expect(screen.getByTestId('location').textContent).toBe('/clientes')
    expect(mocks.useCustomers).toHaveBeenLastCalledWith(expect.objectContaining({ pendingStatus: '' }))
  })

  it('o modal de cadastro não fecha enquanto grava', async () => {
    const user = userEvent.setup()
    mocks.confirm.mockResolvedValue(true)
    mocks.createCustomer.mockReturnValue(new Promise(() => {}))
    renderPage()

    await user.click(screen.getByRole('button', { name: 'Novo cliente' }))
    await user.type(screen.getByLabelText(/^CNPJ/), '12345678000195')
    await user.type(screen.getByLabelText(/^Razão social/), 'Cliente Novo')
    await user.type(screen.getByLabelText('Nome'), 'Financeiro')
    await user.type(screen.getByLabelText(/^E-mail/), 'novo@example.com')
    await user.click(screen.getByRole('button', { name: 'Cadastrar cliente' }))
    await waitFor(() => expect(mocks.createCustomer).toHaveBeenCalled())

    const dialog = screen.getByRole('dialog', { name: 'Novo cliente' })
    expect((within(dialog).getByRole('button', { name: 'Voltar' }) as HTMLButtonElement).disabled).toBe(true)
    await user.keyboard('{Escape}')
    expect(screen.getByRole('dialog', { name: 'Novo cliente' })).toBeTruthy()
  })
})
