// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReviewQueueItem } from '../../hooks/useReview'

vi.mock('../../hooks/useReview', () => ({ useReviewQueue: vi.fn() }))
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' }, isAdmin: true }) }))
vi.mock('../../hooks/useCustomers', () => ({ useCustomerLookup: vi.fn() }))
vi.mock('../../hooks/useReviewCustomerGroup', () => ({ useReviewCustomerGroup: vi.fn() }))
vi.mock('../../components/ui/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }))
vi.mock('../../components/ui/ConfirmDialog', () => ({ useConfirm: () => vi.fn().mockResolvedValue(true) }))
vi.mock('../../services/charges/chargeOperationsService', () => ({ calculateBlLocalCharges: vi.fn() }))
vi.mock('../../services/operationalEvents', () => ({ logOperationalEvent: vi.fn() }))
vi.mock('../../services/review', async () => {
  const actual = await vi.importActual<typeof import('../../services/review')>('../../services/review')
  const resolvedResult = { resolved: true, pendencias: [], reviewStatus: 'reviewed', updatedAt: null }
  return {
    ...actual,
    applyInlineBlReviewFix: vi.fn().mockResolvedValue(resolvedResult),
    saveBlReview: vi.fn().mockResolvedValue(resolvedResult),
    saveGraniteBlReview: vi.fn(),
    recomputeBlReviewGate: vi.fn().mockResolvedValue(resolvedResult),
  }
})
vi.mock('../../services/reviewBillingAutomation', () => ({
  tryAutoIssueInvoice: vi.fn().mockResolvedValue({ status: 'invoiced', invoiceResult: { invoice_id: 55 } }),
}))

import { useCustomerLookup } from '../../hooks/useCustomers'
import { useReviewQueue } from '../../hooks/useReview'
import { useReviewCustomerGroup } from '../../hooks/useReviewCustomerGroup'
import { saveBlReview, saveGraniteBlReview } from '../../services/review'
import { tryAutoIssueInvoice } from '../../services/reviewBillingAutomation'
import { Revisao } from '../Revisao'

const mockedUseReviewQueue = vi.mocked(useReviewQueue)
const mockedUseCustomerLookup = vi.mocked(useCustomerLookup)
const mockedUseReviewCustomerGroup = vi.mocked(useReviewCustomerGroup)
const mockedSaveBlReview = vi.mocked(saveBlReview)
const mockedSaveGraniteBlReview = vi.mocked(saveGraniteBlReview)
const mockedTryAutoIssueInvoice = vi.mocked(tryAutoIssueInvoice)

function makeBl(id: string, consignee: string): ReviewQueueItem {
  return {
    id,
    source: 'bl',
    consignee,
    shipper: 'Shipper',
    customer_id: null,
    customer: null,
    charge_status: 'review_required',
    review_reasons: ['Cliente nao vinculado'],
    cargo_mode: 'container',
    cargo_description: 'Carga de teste do B/L',
    voyage: { id: 1, voyage_number: '14', vessel: { id: 1, name: 'GREEN SANTOS', carrier: null } },
    updated_at: `2026-06-10T12:00:00.${id.slice(-1)}Z`,
  } as unknown as ReviewQueueItem
}

// B/L com cliente vinculado mas faltando e-mail e/ou portal (travas de nivel-cliente).
function makeLinkedBl(
  id: string,
  opts: { emails?: string[]; portalActive?: boolean } = {},
): ReviewQueueItem {
  const reviewReasons = [
    ...((opts.emails ?? []).length === 0 ? ['Cliente sem e-mail cadastrado'] : []),
    ...(opts.portalActive ? [] : ['Acesso ao portal nao provisionado']),
  ]

  return {
    id,
    source: 'bl',
    consignee: 'Linked Co',
    shipper: 'Shipper',
    customer_id: 7,
    customer: {
      id: 7,
      name: 'Linked Co SA',
      cnpj_cpf: '11222333000181',
      customer_contacts: (opts.emails ?? []).map((email) => ({ email })),
    },
    charge_status: 'review_required',
    review_reasons: reviewReasons,
    voyage: { id: 1, voyage_number: '14', vessel: { id: 1, name: 'GREEN SANTOS', carrier: null } },
    updated_at: `2026-06-11T12:00:00.${id.slice(-1)}Z`,
  } as unknown as ReviewQueueItem
}

function renderPage(initialEntries = ['/revisao']) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={initialEntries}>
        <Revisao />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  mockedUseReviewQueue.mockReturnValue({
    data: [makeBl('BL1', 'AC Comercial'), makeBl('BL2', 'AC Comercial'), makeBl('BL3', 'Alma Trading')],
    isLoading: false,
    error: null,
  } as never)
  mockedUseCustomerLookup.mockImplementation((search: string) => ({
    data: search.trim().length >= 2 ? [{ id: 99, name: 'Cliente Modelo', cnpj_cpf: '11222333000181' }] : [],
  } as never))
  mockedUseReviewCustomerGroup.mockReturnValue({ mutateAsync: vi.fn().mockResolvedValue({ onboarding: { customer: { id: 99, cnpj_cpf: '11222333000181', name: 'Cliente Modelo' }, bls: [{ blId: 'BL1', resolved: true }, { blId: 'BL2', resolved: true }] }, portalInvite: 'not_requested' }) } as never)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('Revisao', () => {
  it('oferece os motivos disponíveis em um seletor de inconsistências', async () => {
    const user = userEvent.setup()
    renderPage()

    const filter = screen.getByRole('combobox', { name: 'Filtrar por inconsistência' })
    expect(screen.getByRole('option', { name: 'Todas as inconsistências' })).toBeTruthy()
    expect(screen.getByRole('option', { name: 'Cadastro de cliente pendente' })).toBeTruthy()

    await user.selectOptions(filter, 'Cliente nao vinculado')
    expect((filter as HTMLSelectElement).value).toBe('Cliente nao vinculado')
  })

  it('agrupa os B/Ls por cliente/consignatario e inicia os processos recolhidos', () => {
    renderPage()
    // grupos sao nomeados pelo consignatario quando nao ha cliente cadastrado
    expect(screen.getByText('AC Comercial')).toBeTruthy()
    expect(screen.getByText('Alma Trading')).toBeTruthy()
    expect(screen.getAllByText('Cadastro de cliente pendente').length).toBeGreaterThan(0)
    expect(screen.queryByText('CNPJ pendente')).toBeNull()
    // A fila inicia expandida para expor imediatamente as ações de cada B/L.
    expect(screen.getByRole('button', { name: /AC Comercial/ }).getAttribute('aria-expanded')).toBe('false')
    expect(screen.getByRole('button', { name: /Alma Trading/ }).getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('BL1')).toBeNull()
    expect(screen.queryByText('BL2')).toBeNull()
    expect(screen.queryByText('BL3')).toBeNull()
  })

  it('cria e vincula todos os B/Ls do grupo após confirmar CNPJ e e-mail', async () => {
    const user = userEvent.setup()
    renderPage()

    // o grupo "AC Comercial" (2 B/Ls) e o primeiro na ordem alfabetica
    await user.click(screen.getByRole('button', { name: /AC Comercial/ }))
    expect(screen.getAllByText('Contêiner').length).toBeGreaterThan(0)
    expect(screen.queryByText('Tratada no cadastro do grupo')).toBeNull()
    await user.type(screen.getByPlaceholderText('00.000.000/0000-00'), '11222333000181')
    await user.type(screen.getByPlaceholderText('financeiro@cliente.com.br'), 'financeiro@alfa.com')
    await user.click(screen.getByRole('button', { name: /criar cliente e vincular 2 b\/ls/i }))
    const mutateAsync = mockedUseReviewCustomerGroup.mock.results[0].value.mutateAsync
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ blIds: ['BL1', 'BL2'], cnpjCpf: '11222333000181', email: 'financeiro@alfa.com', changedBy: 'user-1' })))
    await waitFor(() => expect(mockedTryAutoIssueInvoice).toHaveBeenCalledWith(expect.objectContaining({ blId: 'BL1', customerId: 99 })))
    expect(mockedTryAutoIssueInvoice).toHaveBeenCalledWith(expect.objectContaining({ blId: 'BL2', customerId: 99 }))
  })

  it('mantém o drawer para exceções operacionais do B/L sem cadastrar cliente', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: /AC Comercial/ }))
    await user.click(screen.getAllByRole('button', { name: 'Corrigir Dados' })[0])
    expect(screen.getByDisplayValue('Carga de teste do B/L')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Marcar como revisado' }))

    await waitFor(() => expect(mockedSaveBlReview).toHaveBeenCalledTimes(1))
    expect(mockedSaveBlReview).toHaveBeenCalledWith(
      expect.objectContaining({ justification: 'Revisão manual' }),
    )
  })

  it('permite vincular individualmente um B/L com CNPJs conflitantes', async () => {
    const user = userEvent.setup()
    mockedUseReviewQueue.mockReturnValue({
      data: [{
        ...makeBl('BL-CONFLICT', 'Conflito SA'),
        manifest_customer_cnpj_cpf: null,
        consignee_block: 'Conflito SA CNPJ: 11.222.333/0001-81',
        cargo_description: 'Carga CNPJ: 06.352.972/0001-21',
      }],
      isLoading: false,
      error: null,
    } as never)
    renderPage()

    await user.click(screen.getByRole('button', { name: /Conflito SA/ }))
    await user.click(screen.getByRole('button', { name: 'Corrigir Dados' }))
    const drawerCustomerSearch = screen.getAllByPlaceholderText('Digite ao menos 2 caracteres').at(-1)!
    await user.type(drawerCustomerSearch, 'Cliente')
    await user.click(screen.getByRole('button', { name: /Cliente Modelo/ }))
    await user.click(screen.getByRole('button', { name: 'Marcar como revisado' }))

    await waitFor(() => expect(mockedSaveBlReview).toHaveBeenCalledWith(expect.objectContaining({ customerId: 99 })))
  })

  it('permite confirmar um dos CNPJs evidenciados no cartão do conflito', async () => {
    const user = userEvent.setup()
    mockedUseReviewQueue.mockReturnValue({
      data: [{
        ...makeBl('BL-CONFLICT-ONBOARD', 'Conflito Cadastro SA'),
        manifest_customer_cnpj_cpf: null,
        consignee_block: 'Conflito Cadastro SA CNPJ: 11.222.333/0001-81',
        cargo_description: 'Carga CNPJ: 06.352.972/0001-21',
      }],
      isLoading: false,
      error: null,
    } as never)
    renderPage()

    await user.click(screen.getByRole('button', { name: /Conflito Cadastro SA/ }))
    await user.type(screen.getByPlaceholderText('00.000.000/0000-00'), '11222333000181')
    await user.type(screen.getByPlaceholderText('financeiro@cliente.com.br'), 'conflito@cliente.com')
    await user.click(screen.getByRole('button', { name: /criar cliente e vincular 1 b\/ls/i }))

    const mutateAsync = mockedUseReviewCustomerGroup.mock.results[0].value.mutateAsync
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ blIds: ['BL-CONFLICT-ONBOARD'], cnpjCpf: '11222333000181' })))
  })

  it('vincula também as linhas de Granito quando compartilham o grupo do B/L', async () => {
    const user = userEvent.setup()
    mockedUseReviewQueue.mockReturnValue({
      data: [
        { ...makeBl('BL-MIXED', 'Cliente misto'), manifest_customer_cnpj_cpf: '11222333000181' },
        {
          id: 'GR-MIXED', source: 'granite', bl_number: 'GR-MIXED', consignee: 'Cliente misto',
          manifest_customer_cnpj_cpf: '11222333000181', customer_id: null, customer: null,
          review_reasons: ['Cliente nao vinculado (Granito)'],
        },
      ],
      isLoading: false,
      error: null,
    } as never)
    renderPage()

    await user.click(screen.getByRole('button', { name: /Cliente misto/ }))
    await user.type(screen.getByPlaceholderText('00.000.000/0000-00'), '11222333000181')
    await user.type(screen.getByPlaceholderText('financeiro@cliente.com.br'), 'misto@cliente.com')
    await user.click(screen.getByRole('button', { name: /criar cliente e vincular 1 b\/ls/i }))

    await waitFor(() => expect(mockedSaveGraniteBlReview).toHaveBeenCalledWith({ graniteBlId: 'GR-MIXED', clientId: 99, changedBy: 'user-1' }))
  })

  it('mantém onboarding e vínculo existente em grupo misto sem CNPJ', async () => {
    const user = userEvent.setup()
    mockedUseReviewQueue.mockReturnValue({
      data: [
        { ...makeBl('BL-MIXED-NAME', 'Cliente sem documento'), manifest_customer_cnpj_cpf: null },
        {
          id: 'GR-MIXED-NAME', source: 'granite', bl_number: 'GR-MIXED-NAME', consignee: null,
          shipper: 'Cliente sem documento', manifest_customer_cnpj_cpf: null, customer_id: null, customer: null,
          review_reasons: ['Cliente nao vinculado (Granito)'],
        },
      ],
      isLoading: false,
      error: null,
    } as never)
    renderPage()

    await user.click(screen.getByRole('button', { name: /Cliente sem documento/ }))
    expect(screen.getByText('Cadastrar ou vincular cliente')).toBeTruthy()
    expect(screen.getByPlaceholderText('Vincular cliente...')).toBeTruthy()
  })

  it('adiciona e-mail ao cliente do grupo direto da fila', async () => {
    const user = userEvent.setup()
    mockedUseReviewQueue.mockReturnValue({
      data: [makeLinkedBl('BLX')],
      isLoading: false,
      error: null,
    } as never)
    renderPage()

    await user.click(screen.getByRole('button', { name: /Linked Co/ }))
    await user.type(screen.getByPlaceholderText('financeiro@cliente.com.br'), 'novo@cliente.com')
    await user.click(screen.getByRole('button', { name: /adicionar e-mail e vincular 1 b\/ls/i }))

    const mutateAsync = mockedUseReviewCustomerGroup.mock.results[0].value.mutateAsync
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ blIds: ['BLX'], customerId: 7, email: 'novo@cliente.com', changedBy: 'user-1' })))
  })

  it('exibe sugestao de Granito sem trata-la como vinculo automatico', async () => {
    const user = userEvent.setup()
    mockedUseReviewQueue.mockReturnValue({
      data: [{
        id: 'granite-1', source: 'granite', bl_number: 'G-001', client_id: null,
        suggested_client_id: 42, suggested_customer: { id: 42, name: 'Cliente Sugerido', cnpj_cpf: '11222333000181' },
        customer: null, review_reasons: ['Cliente nao vinculado (Granito)', 'Sugerido: Cliente Sugerido'],
      }], isLoading: false, error: null,
    } as never)
    renderPage()

    expect(screen.getAllByText('Sugerido: Cliente Sugerido').length).toBeGreaterThan(0)
    expect(screen.queryByText('Vinculado')).toBeNull()
    await user.click(screen.getByRole('button', { name: /G-001/ }))
    await user.click(screen.getByRole('button', { name: /Corrigir Dados/ }))
    await user.click(screen.getByRole('button', { name: 'Marcar como revisado' }))

    expect(mockedSaveGraniteBlReview).not.toHaveBeenCalled()
  })

  it('inicializa com busca pré-preenchida e auto-expande o grupo quando passado query param ?cliente=...', async () => {
    mockedUseReviewQueue.mockReturnValue({
      data: [
        makeBl('BL1', 'Empresa Alpha'),
        makeLinkedBl('BL2', { emails: ['alpha@test.com'], portalActive: true }),
      ],
      isLoading: false,
      error: null,
    } as never)

    renderPage(['/revisao?cliente=Linked'])

    const searchInput = screen.getByPlaceholderText('Buscar B/L, cliente, consignatário...') as HTMLInputElement
    expect(searchInput.value).toBe('Linked')

    // Somente o grupo correspondente a 'Linked' deve estar visível e seus B/Ls auto-expandidos
    expect(screen.getByText('Linked Co SA')).toBeTruthy()
    expect(screen.getByText('BL2')).toBeTruthy()
    expect(screen.queryByText('Empresa Alpha')).toBeNull()
  })

  // A Validacao aponta para ca por B/L (ADR 0061). Sem ler `?bl=`, o link levava
  // o operador para a fila inteira, para procurar o B/L a mao.
  it('abre no B/L endereçado quando passado query param ?bl=...', () => {
    mockedUseReviewQueue.mockReturnValue({
      data: [
        makeBl('BL1', 'Empresa Alpha'),
        makeLinkedBl('BL2', { emails: ['alpha@test.com'], portalActive: true }),
      ],
      isLoading: false,
      error: null,
    } as never)

    renderPage(['/revisao?bl=BL2'])

    const searchInput = screen.getByPlaceholderText('Buscar B/L, cliente, consignatário...') as HTMLInputElement
    expect(searchInput.value).toBe('BL2')

    // Grupo do B/L aberto, o B/L visivel e o resto da fila fora do caminho.
    expect(screen.getByText('BL2')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Linked Co SA/ }).getAttribute('aria-expanded')).toBe('true')
    expect(screen.queryByText('Empresa Alpha')).toBeNull()
    expect(screen.queryByText('BL1')).toBeNull()
  })

})
