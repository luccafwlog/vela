// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  detail: { data: null as Record<string, unknown> | null, isLoading: false, error: null as Error | null },
  showToast: vi.fn(),
  confirm: vi.fn(),
  invalidateQueries: vi.fn(),
  upsertContact: vi.fn(),
  deleteContact: vi.fn(),
  can: vi.fn(() => true),
}))

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return { ...actual, useParams: () => ({ cnpj: '12345678000195' }) }
})
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
  useQuery: () => ({ data: null, error: null, isPending: false }),
  useMutation: (options: Record<string, unknown>) => ({
    mutateAsync: options.mutationFn,
    isPending: false,
  }),
}))
vi.mock('../../hooks/useCustomers', () => ({
  useCustomerDetail: () => mocks.detail,
}))
vi.mock('../../hooks/useCustomerFicha', () => ({
  useCustomerDemurrageInvoices: () => ({ data: { rows: [], denied: false } }),
  useCustomerPendingReconciliation: () => ({ data: [{ id: 'BL1', consignee: 'Consignatário', customer_reconciliation_status: 'matched_name' }] }),
  useCustomerRunningDemurrage: () => ({ data: [] }),
  useCustomerTimeline: () => ({ data: [] }),
  useCustomerReceivables: () => ({ data: { rows: [], denied: false } }),
  useCustomerPayments: () => ({ data: { rows: [], denied: false } }),
  useCustomerRateOverrides: () => ({ data: [] }),
  useCustomerManualChargeBls: () => ({ data: [] }),
}))
vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'admin-1' }, isAdmin: true, can: mocks.can }),
}))
vi.mock('../../components/ui/Toast', () => ({
  useToast: () => ({ showToast: mocks.showToast }),
}))
vi.mock('../../components/ui/ConfirmDialog', () => ({
  useConfirm: () => mocks.confirm,
}))
vi.mock('../../components/clientes/CustomerContactConfiguration', () => ({
  CustomerContactConfiguration: ({ customerId, canEdit, onSaved }: { customerId: number; canEdit?: boolean; onSaved?: () => void }) => (
    <div data-testid="customer-contact-configuration">
      <span>Contatos do cliente {customerId}</span>
      {canEdit && (
        <button type="button" onClick={onSaved}>
          Salvar contatos mock
        </button>
      )}
    </div>
  ),
}))
vi.mock('../../services/customers', () => ({
  upsertCustomerContact: mocks.upsertContact,
  deleteCustomerContact: mocks.deleteContact,
  updateCustomerWithAudit: vi.fn(),
}))

import { ClienteFicha } from '../ClienteFicha'

const customer = {
  id: 42,
  cnpj_cpf: '12345678000195',
  name: 'Cliente Teste',
  trade_name: null,
  address: null,
  city: 'Vitoria',
  state: 'ES',
  zip: null,
  notes: null,
  customer_contacts: [{
    id: 7,
    customer_id: 42,
    name: 'Contato Atual',
    email: 'atual@example.com',
    phone: null,
    purpose: 'geral',
    is_primary: false,
    created_at: null,
  }],
  bls: [],
  invoices: [],
  pending_balance: 0,
  invoices_access_denied: false,
}

function renderPage(initialEntry = '/clientes/12345678000195?tab=cadastro') {
  return render(<MemoryRouter initialEntries={[initialEntry]}><ClienteFicha /></MemoryRouter>)
}

describe('ClienteFicha user behaviours', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.detail = { data: customer, isLoading: false, error: null }
    mocks.confirm.mockResolvedValue(true)
    mocks.upsertContact.mockResolvedValue({ id: 7 })
    mocks.deleteContact.mockResolvedValue(undefined)
    mocks.can.mockReturnValue(true)
  })

  afterEach(cleanup)

  it('abre na Visão Geral por padrão e troca de aba via clique', async () => {
    const user = userEvent.setup()
    renderPage('/clientes/12345678000195')
    expect(screen.getByRole('tab', { name: 'Visão geral' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe('cliente-tab-visao-geral')
    await user.click(screen.getByRole('tab', { name: 'Cadastro e contatos' }))
    expect(screen.getByRole('heading', { name: 'Dados cadastrais' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Acesso ao Portal' })).toBeTruthy()
  })

  it('Visão Geral mostra saldo consolidado e pendência de reconciliação navegável', async () => {
    const user = userEvent.setup()
    renderPage('/clientes/12345678000195')

    expect(screen.getByRole('heading', { name: 'Saldo pendente' })).toBeTruthy()
    expect(screen.getByText(/B\/L vinculado por nome, aguardando confirmação/)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: /Ver os B\/Ls na aba Operacional/ }))
    expect(screen.getByRole('tab', { name: /^Operacional/ }).getAttribute('aria-selected')).toBe('true')
  })

  it('renders CustomerContactConfiguration and invalidates customer detail on save', async () => {
    const user = userEvent.setup()
    renderPage()

    expect(screen.getByTestId('customer-contact-configuration')).toBeTruthy()
    expect(screen.getByText('Contatos do cliente 42')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Salvar contatos mock' }))

    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['customer-detail', '12345678000195'],
    })
  })

  it('shows a not-found state for an unknown customer', () => {
    mocks.detail = {
      data: null,
      isLoading: false,
      error: Object.assign(new Error('JSON object requested, multiple (or no) rows returned'), { code: 'PGRST116' }),
    }

    renderPage()
    expect(screen.getByRole('heading', { name: 'Cliente não encontrado' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Voltar para Clientes' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Tentar novamente' })).toBeNull()
  })

  it('shows an infrastructure error separately from not found', () => {
    mocks.detail = {
      data: null,
      isLoading: false,
      error: Object.assign(new Error('database unavailable'), { code: '08006' }),
    }

    renderPage()
    expect(screen.getByRole('heading', { name: 'Não foi possível abrir este Cliente' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Tentar novamente' })).toBeTruthy()
  })

  it('documentacao vê e opera as ações de cliente e portal', async () => {
    mocks.can.mockReturnValue(true)
    renderPage()

    expect(screen.getByLabelText(/Razão social/)).not.toHaveProperty('disabled', true)
    expect(screen.getByRole('link', { name: /Abrir no Provisionamento do Portal/ }).getAttribute('href')).toBe('/clientes/portal?cliente=42')
  })

  it('Financeiro vê e pode operar a ficha no modelo de escrita global, sem a aba CE/VIP', () => {
    mocks.can.mockReturnValue(false)
    renderPage('/clientes/12345678000195?tab=desbloqueio-ce')

    // Sem leitura do Desbloqueio de CE, a aba some e o link antigo cai na Visão geral.
    expect(screen.queryByRole('tab', { name: 'Desbloqueio de CE e VIP' })).toBeNull()
    expect(screen.getByRole('tab', { name: 'Visão geral' }).getAttribute('aria-selected')).toBe('true')
  })

  it('cabeçalho dá identidade e caminhos sem repetir o breadcrumb', async () => {
    const user = userEvent.setup()
    renderPage('/clientes/12345678000195')
    expect(screen.getByRole('heading', { level: 1, name: 'Cliente Teste' })).toBeTruthy()
    expect(screen.getByText('12.345.678/0001-95')).toBeTruthy()
    expect(screen.queryByRole('link', { name: /Voltar para clientes/i })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Mais ações do Cliente' }))
    expect(screen.getByRole('menuitem', { name: 'Ver faturas em Taxas Locais' }).getAttribute('href')).toContain('/taxas-locais?tab=invoices&customer=42')
    expect(screen.getByRole('menuitem', { name: 'Ver os B/Ls na lista de BLs' }).getAttribute('href')).toBe('/bls?q=12345678000195')
  })

  it('cliente desativado avisa data, efeito e motivo', () => {
    mocks.detail = { data: { ...customer, deactivated_at: '2026-10-06T12:00:00Z', deactivation_reason: 'Encerrou as atividades' }, isLoading: false, error: null }
    renderPage('/clientes/12345678000195')
    expect(screen.getByRole('status').textContent).toContain('Cliente desativado em 06/10/2026')
    expect(screen.getByText('Motivo: Encerrou as atividades')).toBeTruthy()
  })
})
