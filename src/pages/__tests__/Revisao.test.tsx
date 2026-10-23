// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReviewQueueItem } from '../../hooks/useReview'

vi.mock('../../hooks/useReview', () => ({ useReviewQueue: vi.fn() }))
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' }, isAdmin: true, can: () => true }) }))
vi.mock('../../hooks/useCustomers', () => ({ useCustomerLookup: vi.fn() }))
vi.mock('../../hooks/useReviewCustomerGroup', () => ({ useReviewCustomerGroup: vi.fn() }))
vi.mock('../../components/ui/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }))
const mocks = vi.hoisted(() => ({ confirm: vi.fn(), sendInvite: vi.fn() }))
vi.mock('../../components/ui/ConfirmDialog', () => ({ useConfirm: () => mocks.confirm }))
vi.mock('../../hooks/usePortalProvisioning', () => ({
  usePortalProvisioningForCustomer: () => ({
    isLoading: false,
    isError: false,
    data: {
      customer_id: 7, account_situation: 'sem_conta', provisioning_decision: 'aguardando_analise',
      recovery_email: null, recovery_email_source: null, pending_invite_expires_at: null,
      recoveryEmailStatus: null, recoveryEmailSuppressed: false, latestDeliveryStatus: null,
      candidates: [{ email: 'contato@linked.com', purpose: 'geral', origin: 'Contato principal' }],
    },
  }),
  useSendPortalInvite: () => ({ mutateAsync: mocks.sendInvite, isPending: false }),
}))
vi.mock('../../services/charges/chargeOperationsService', () => ({ calculateBlLocalCharges: vi.fn() }))
vi.mock('../../services/operationalEvents', () => ({ logOperationalEvent: vi.fn() }))
vi.mock('../../services/review', async () => {
  const actual = await vi.importActual<typeof import('../../services/review')>('../../services/review')
  const resolvedResult = { resolved: true, pendencias: [], reviewStatus: 'reviewed', updatedAt: null }
  return {
    ...actual,
    applyInlineBlReviewFix: vi.fn().mockResolvedValue(resolvedResult),
    saveBlReview: vi.fn().mockResolvedValue(resolvedResult),
  }
})
vi.mock('../../services/reviewBillingAutomation', () => ({
  tryAutoIssueInvoice: vi.fn().mockResolvedValue({ status: 'invoiced', invoiceResult: { invoice_id: 55 } }),
}))

import { useCustomerLookup } from '../../hooks/useCustomers'
import { useReviewQueue } from '../../hooks/useReview'
import { useReviewCustomerGroup } from '../../hooks/useReviewCustomerGroup'
import { applyInlineBlReviewFix, saveBlReview } from '../../services/review'
import { tryAutoIssueInvoice } from '../../services/reviewBillingAutomation'
import { Revisao } from '../Revisao'

const mockedUseReviewQueue = vi.mocked(useReviewQueue)
const mockedUseCustomerLookup = vi.mocked(useCustomerLookup)
const mockedUseReviewCustomerGroup = vi.mocked(useReviewCustomerGroup)
const mockedSaveBlReview = vi.mocked(saveBlReview)
const mockedTryAutoIssueInvoice = vi.mocked(tryAutoIssueInvoice)
const mockedApplyInlineBlReviewFix = vi.mocked(applyInlineBlReviewFix)

function LocationProbe() {
  const location = useLocation()
  return <output data-testid="location">{location.search}</output>
}

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
        <LocationProbe />
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
  mocks.confirm.mockResolvedValue(true)
  mocks.sendInvite.mockResolvedValue(undefined)
  mockedUseReviewCustomerGroup.mockReturnValue({ mutateAsync: vi.fn().mockResolvedValue({ onboarding: { customer: { id: 99, cnpj_cpf: '11222333000181', name: 'Cliente Modelo' }, bls: [{ blId: 'BL1', resolved: true }, { blId: 'BL2', resolved: true }] }, portalInvite: 'not_requested' }) } as never)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

async function choosePortalLater(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('radio', { name: /Deixar para depois/ }))
}

describe('Revisao', () => {
  it('filtra por causa com cartões que contam os registros e guardam o recorte na URL', async () => {
    const user = userEvent.setup()
    mockedUseReviewQueue.mockReturnValue({
      data: [makeBl('BL1', 'AC Comercial'), makeLinkedBl('BL7', { emails: ['a@b.com'] })],
      isLoading: false,
      error: null,
    } as never)
    renderPage()

    const card = screen.getByRole('button', { name: /Sem cliente vinculado\s*1/ })
    expect(screen.getByRole('button', { name: /Portal não provisionado\s*1/ })).toBeTruthy()
    // "Outras pendências" é o quinto cartão e filtra como os demais.
    expect(screen.getByRole('button', { name: /Outras pendências\s*0/ })).toBeTruthy()
    await user.click(card)

    expect(card.getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('location').textContent).toBe('?causa=cliente')
    expect(screen.getByText('AC Comercial')).toBeTruthy()
    expect(screen.queryByText('Linked Co SA')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Limpar filtros' }))
    expect(screen.getByText('Linked Co SA')).toBeTruthy()
  })

  it('aceita o motivo bruto antigo em ?motivo= como filtro de causa', () => {
    mockedUseReviewQueue.mockReturnValue({
      data: [makeBl('BL1', 'AC Comercial'), makeLinkedBl('BL7', { emails: ['a@b.com'] })],
      isLoading: false,
      error: null,
    } as never)
    renderPage(['/revisao?motivo=Acesso%20ao%20portal%20nao%20provisionado'])

    expect(screen.getByRole('button', { name: /^Portal não provisionado\s*\d+$/ }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.queryByText('AC Comercial')).toBeNull()
  })

  it('mostra a fila em tabela, uma linha por Cliente, com o que se resolve na Revisão primeiro', () => {
    mockedUseReviewQueue.mockReturnValue({
      // "Linked Co SA" vem antes de "Zeta" no alfabeto, mas só espera o Portal.
      data: [makeLinkedBl('BL7', { emails: ['a@b.com'] }), makeBl('BL1', 'Zeta Importadora')],
      isLoading: false,
      error: null,
    } as never)
    const { container } = renderPage()

    const rows = [...container.querySelectorAll('tr[data-review-group]')].map((row) => row.textContent ?? '')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatch(/Zeta Importadora.*Identificar o cliente/)
    expect(rows[1]).toMatch(/Linked Co SA.*Ativar o Portal do Cliente/)
  })

  it('provisiona o Portal no próprio grupo quando o Cliente já está cadastrado', async () => {
    const user = userEvent.setup()
    mockedUseReviewQueue.mockReturnValue({ data: [makeLinkedBl('BL7', { emails: ['a@b.com'] })], isLoading: false, error: null } as never)
    renderPage()

    await user.click(screen.getByRole('button', { name: /Linked Co SA/ }))
    expect(screen.getByRole('heading', { name: 'Portal do Cliente' })).toBeTruthy()
    expect(screen.getByText('Sem conta')).toBeTruthy()
    expect(screen.getByText('contato@linked.com')).toBeTruthy()
    // A Liberação de faturamento sem Portal fica só na ficha do Cliente.
    expect(screen.queryByRole('button', { name: /Liberação/ })).toBeNull()
    expect(screen.getByRole('link', { name: 'Liberação na ficha do Cliente' }).getAttribute('href')).toBe('/clientes/11222333000181?tab=financeiro')

    await user.click(screen.getByRole('button', { name: 'Autorizar e enviar convite' }))
    await waitFor(() => expect(mocks.sendInvite).toHaveBeenCalledWith({ customerId: 7, recoveryEmail: 'contato@linked.com', source: 'candidato' }))
    expect(await screen.findByText(/Convite enviado para/)).toBeTruthy()
  })

  it('envia o convite para outro e-mail informado no grupo', async () => {
    const user = userEvent.setup()
    mockedUseReviewQueue.mockReturnValue({ data: [makeLinkedBl('BL7', { emails: ['a@b.com'] })], isLoading: false, error: null } as never)
    renderPage()

    await user.click(screen.getByRole('button', { name: /Linked Co SA/ }))
    await user.click(screen.getByRole('button', { name: 'Usar outro e-mail' }))
    await user.type(screen.getByLabelText('Outro e-mail para o convite'), 'Financeiro@Linked.com')
    await user.click(screen.getByRole('button', { name: 'Autorizar e enviar convite' }))
    await waitFor(() => expect(mocks.sendInvite).toHaveBeenCalledWith({ customerId: 7, recoveryEmail: 'financeiro@linked.com', source: 'informado_manualmente' }))
  })

  it('mostra erro de consulta com Tentar novamente, sem parecer fila vazia', async () => {
    const user = userEvent.setup()
    const refetch = vi.fn()
    mockedUseReviewQueue.mockReturnValue({ data: undefined, isLoading: false, error: new Error('rede'), refetch } as never)
    renderPage()

    expect(screen.getByText(/Não foi possível carregar a fila de revisão/)).toBeTruthy()
    expect(screen.queryByText('Nenhum B/L em revisão')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Tentar novamente' }))
    expect(refetch).toHaveBeenCalled()
  })

  it('agrupa os B/Ls por cliente/consignatario e inicia os grupos recolhidos', () => {
    renderPage()
    // grupos sao nomeados pelo consignatario quando nao ha cliente cadastrado
    expect(screen.getByText('AC Comercial')).toBeTruthy()
    expect(screen.getByText('Alma Trading')).toBeTruthy()
    expect(screen.queryByText('CNPJ pendente')).toBeNull()
    expect(screen.getByRole('button', { name: /AC Comercial/ }).getAttribute('aria-expanded')).toBe('false')
    expect(screen.getByRole('button', { name: /Alma Trading/ }).getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('BL1')).toBeNull()
    expect(screen.queryByText('BL2')).toBeNull()
    expect(screen.queryByText('BL3')).toBeNull()
  })

  it('caso A: mostra o texto bruto do B/L quando só o nome foi lido', async () => {
    const user = userEvent.setup()
    mockedUseReviewQueue.mockReturnValue({
      data: [{ ...makeBl('BL1', 'AC Comercial'), consignee_block: 'TO ORDER OF AC COMERCIAL LTDA' }],
      isLoading: false,
      error: null,
    } as never)
    renderPage()

    await user.click(screen.getByRole('button', { name: /AC Comercial/ }))
    expect(screen.getByRole('heading', { name: 'Identificar o cliente' })).toBeTruthy()
    expect(screen.getByText('TO ORDER OF AC COMERCIAL LTDA')).toBeTruthy()
    expect(screen.getByText('Carga de teste do B/L')).toBeTruthy()
    // Sem janela lateral: não há mais "Corrigir dados".
    expect(screen.queryByRole('button', { name: /Corrigir dados/ })).toBeNull()
  })

  it('só cadastra depois de escolher o que fazer com o Portal, e vincula todos os B/Ls do grupo', async () => {
    const user = userEvent.setup()
    renderPage()

    // o grupo "AC Comercial" (2 B/Ls) e o primeiro na ordem alfabetica
    await user.click(screen.getByRole('button', { name: /AC Comercial/ }))
    await user.type(screen.getByPlaceholderText('00.000.000/0000-00'), '11222333000181')
    await user.type(screen.getByPlaceholderText('financeiro@cliente.com.br'), 'financeiro@alfa.com')
    const submit = screen.getByRole('button', { name: 'Cadastrar e vincular' }) as HTMLButtonElement
    // Nenhuma opção do Portal vem marcada: o botão espera a escolha.
    expect(submit.disabled).toBe(true)
    expect(screen.getByText('Escolha o que fazer com o Portal do Cliente para continuar.')).toBeTruthy()

    await user.click(screen.getByRole('radio', { name: /Enviar o convite agora/ }))
    expect(screen.getByText(/Vai cadastrar/).textContent).toMatch(/vincular 2 B\/Ls e enviar o convite do Portal para financeiro@alfa\.com/)
    await user.click(submit)
    const mutateAsync = mockedUseReviewCustomerGroup.mock.results[0].value.mutateAsync
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ blIds: ['BL1', 'BL2'], cnpjCpf: '11222333000181', email: 'financeiro@alfa.com', changedBy: 'user-1', sendPortalInvite: true })))
    await waitFor(() => expect(mockedTryAutoIssueInvoice).toHaveBeenCalledWith(expect.objectContaining({ blId: 'BL1', customerId: 99 })))
    expect(mockedTryAutoIssueInvoice).toHaveBeenCalledWith(expect.objectContaining({ blId: 'BL2', customerId: 99 }))
  })

  it('caso F mostra o motivo registrado pelo gate em vez de "sem motivo"', async () => {
    const user = userEvent.setup()
    mockedUseReviewQueue.mockReturnValue({
      data: [{ ...makeLinkedBl('BLR', { emails: ['a@b.com'], portalActive: true }), review_reasons: ['CE Mercante não informado'] }],
      isLoading: false,
      error: null,
    } as never)
    renderPage()

    await user.click(screen.getByRole('button', { name: /Linked Co SA/ }))
    expect(screen.getAllByText(/CE Mercante não informado/).length).toBeGreaterThan(0)
    expect(screen.queryByText(/não tem motivo registrado/)).toBeNull()
  })

  it('B/L vinculado com outro CNPJ no documento aponta a ficha do B/L para trocar o cliente', async () => {
    const user = userEvent.setup()
    mockedUseReviewQueue.mockReturnValue({
      data: [{ ...makeLinkedBl('BLC', { emails: ['a@b.com'] }), manifest_customer_cnpj_cpf: '12345678000195' }],
      isLoading: false,
      error: null,
    } as never)
    renderPage()

    await user.click(screen.getByRole('button', { name: /Linked Co SA/ }))
    expect(screen.getByRole('heading', { name: 'CNPJ do B/L diferente do cliente vinculado' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Abrir ficha do B/L' }).getAttribute('href')).toBe('/bls/BLC')
  })

  it('caso F: confere e salva os dados do B/L no próprio grupo', async () => {
    const user = userEvent.setup()
    mockedUseReviewQueue.mockReturnValue({
      data: [{ ...makeLinkedBl('BLF', { emails: ['a@b.com'], portalActive: true }), cargo_mode: 'container', shipper: 'Sany', total_weight_kg: 24000, notes: 'Conferido com o armador\nPendencias de importacao: Pendente' }],
      isLoading: false,
      error: null,
    } as never)
    renderPage()

    await user.click(screen.getByRole('button', { name: /Linked Co SA/ }))
    expect(screen.getByRole('heading', { name: 'Conferir os dados do B/L' })).toBeTruthy()
    // Só as notas humanas: a linha técnica é regravada pelo gate.
    expect((screen.getByLabelText('Notas da revisão') as HTMLInputElement).value).toBe('Conferido com o armador')
    expect(screen.queryByLabelText('Peso carga solta (t)')).toBeNull()
    await user.clear(screen.getByLabelText('Shipper'))
    await user.type(screen.getByLabelText('Shipper'), 'Novo embarcador')
    await user.click(screen.getByRole('button', { name: 'Salvar revisão' }))

    await waitFor(() => expect(mockedSaveBlReview).toHaveBeenCalledTimes(1))
    expect(mocks.confirm.mock.calls[0][0].changes).toEqual([{ field: 'Shipper', before: 'Sany', after: 'Novo embarcador' }])
    expect(mockedSaveBlReview).toHaveBeenCalledWith(expect.objectContaining({ justification: 'Revisão manual', customerId: 7 }))
  })

  it('caso C: lista os CNPJs divergentes e vincula a um cliente cadastrado sem janela', async () => {
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
    expect(screen.getByRole('heading', { name: 'Confirmar o CNPJ do cliente' })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: /Usar este CNPJ 11\.222\.333\/0001-81/ }))
    await user.click(screen.getByRole('radio', { name: 'Vincular a um cliente cadastrado' }))
    await user.type(screen.getByLabelText('Cliente cadastrado'), 'Cliente')
    const option = screen.getByRole('option', { name: /Cliente Modelo/ })
    expect(option.textContent).toMatch(/CNPJ confere com o B\/L/)
    await user.click(option)
    await user.click(screen.getByRole('button', { name: 'Vincular 1 B/L' }))

    await waitFor(() => expect(mockedApplyInlineBlReviewFix).toHaveBeenCalledWith(expect.objectContaining({ blId: 'BL-CONFLICT', field: 'customer_id', value: 99 })))
  })

  it('caso C: leva o CNPJ escolhido para o cadastro', async () => {
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
    await user.click(screen.getByRole('button', { name: /Usar este CNPJ 11\.222\.333\/0001-81/ }))
    expect((screen.getByPlaceholderText('00.000.000/0000-00') as HTMLInputElement).value).toBe('11.222.333/0001-81')
    expect(screen.getByRole('button', { name: /Usar este CNPJ 11\.222\.333\/0001-81/ }).getAttribute('aria-pressed')).toBe('true')
    await user.type(screen.getByPlaceholderText('financeiro@cliente.com.br'), 'conflito@cliente.com')
    await choosePortalLater(user)
    await user.click(screen.getByRole('button', { name: 'Cadastrar e vincular' }))

    const mutateAsync = mockedUseReviewCustomerGroup.mock.results[0].value.mutateAsync
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ blIds: ['BL-CONFLICT-ONBOARD'], cnpjCpf: '11222333000181', sendPortalInvite: false })))
  })

  it('vincula a um cliente cadastrado num grupo sem CNPJ', async () => {
    const user = userEvent.setup()
    mockedUseReviewQueue.mockReturnValue({
      data: [
        { ...makeBl('BL-MIXED-NAME', 'Cliente sem documento'), manifest_customer_cnpj_cpf: null },
      ],
      isLoading: false,
      error: null,
    } as never)
    renderPage()

    await user.click(screen.getByRole('button', { name: /Cliente sem documento/ }))
    await user.click(screen.getByRole('radio', { name: 'Vincular a um cliente cadastrado' }))
    await user.type(screen.getByLabelText('Cliente cadastrado'), 'Cliente')
    await user.click(screen.getByRole('option', { name: /Cliente Modelo/ }))
    await user.click(screen.getByRole('button', { name: 'Vincular 1 B/L' }))

    await waitFor(() => expect(mockedApplyInlineBlReviewFix).toHaveBeenCalledWith(expect.objectContaining({ blId: 'BL-MIXED-NAME', value: 99 })))
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
    // O motivo legado de e-mail tem o próprio bloco; não abre também "Conferir os dados".
    expect(screen.queryByRole('heading', { name: 'Conferir os dados do B/L' })).toBeNull()
    await user.type(screen.getByLabelText('E-mail principal'), 'novo@cliente.com')
    await user.click(screen.getByRole('button', { name: 'Adicionar e-mail' }))

    const mutateAsync = mockedUseReviewCustomerGroup.mock.results[0].value.mutateAsync
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ blIds: ['BLX'], customerId: 7, email: 'novo@cliente.com', changedBy: 'user-1' })))
  })

  it('B16: exibe a sugestão por nome do B/L e a leva ao vínculo', async () => {
    const user = userEvent.setup()
    mockedUseReviewQueue.mockReturnValue({
      data: [{ ...makeBl('BLSUG1', 'Sugerido Ltda'), suggested_customer_id: 42, suggested_customer: { id: 42, name: 'Cliente Sugerido', cnpj_cpf: '11222333000181' } }],
      isLoading: false, error: null,
    } as never)
    renderPage()

    await user.click(screen.getByRole('button', { name: /Sugerido Ltda/ }))
    expect(screen.getAllByText(/Sugestão por nome/).length).toBeGreaterThan(0)
    await user.click(screen.getByRole('button', { name: 'Usar a sugestão' }))
    expect(screen.getByRole('radio', { name: 'Vincular a um cliente cadastrado' }).getAttribute('aria-checked')).toBe('true')
    await user.click(screen.getByRole('button', { name: 'Vincular 1 B/L' }))
    await waitFor(() => expect(mockedApplyInlineBlReviewFix).toHaveBeenCalledWith(expect.objectContaining({ blId: 'BLSUG1', value: 42 })))
  })

  it('B17: B/L com CNPJ de Cliente desativado mostra o motivo, não "Sugestão por nome"', async () => {
    const user = userEvent.setup()
    mockedUseReviewQueue.mockReturnValue({
      data: [{
        ...makeBl('BLINAT', 'Inativo Ltda'), suggested_customer_id: 7,
        customer_reconciliation_notes: 'Cliente desativado: reative o cliente ou escolha outro.',
        suggested_customer: { id: 7, name: 'Cliente Inativo', cnpj_cpf: '11222333000181' },
      }],
      isLoading: false, error: null,
    } as never)
    renderPage()

    await user.click(screen.getByRole('button', { name: /Inativo Ltda/ }))
    expect(screen.getAllByText(/Cliente desativado com este CNPJ/).length).toBeGreaterThan(0)
    expect(screen.queryByText(/Sugestão por nome/)).toBeNull()
    // O banco recusa o vínculo a Cliente desativado: a tela não oferece a ação.
    expect(screen.queryByRole('button', { name: 'Usar a sugestão' })).toBeNull()
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

    const searchInput = screen.getByPlaceholderText('B/L, cliente, consignatário ou CNPJ') as HTMLInputElement
    expect(searchInput.value).toBe('Linked')

    // Somente o grupo correspondente a 'Linked' deve estar visível e seus B/Ls auto-expandidos
    expect(screen.getByText('Linked Co SA')).toBeTruthy()
    expect(screen.getAllByText('BL2').length).toBeGreaterThan(0)
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

    const searchInput = screen.getByPlaceholderText('B/L, cliente, consignatário ou CNPJ') as HTMLInputElement
    expect(searchInput.value).toBe('BL2')

    // Grupo do B/L aberto, o B/L visivel e o resto da fila fora do caminho.
    expect(screen.getAllByText('BL2').length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: /Linked Co SA/ }).getAttribute('aria-expanded')).toBe('true')
    expect(screen.queryByText('Empresa Alpha')).toBeNull()
    expect(screen.queryByText('BL1')).toBeNull()
  })

  it('mostra no conteúdo o que foi gravado e o que ainda falta depois do cadastro', async () => {
    const user = userEvent.setup()
    mockedUseReviewCustomerGroup.mockReturnValue({ mutateAsync: vi.fn().mockResolvedValue({
      onboarding: {
        customer: { id: 99, cnpj_cpf: '11222333000181', name: 'Cliente Modelo' },
        bls: [
          { blId: 'BL1', resolved: false, pendencias: ['Acesso ao portal nao provisionado'] },
          { blId: 'BL2', resolved: false, pendencias: ['Acesso ao portal nao provisionado'] },
        ],
      },
      portalInvite: 'failed',
    }) } as never)
    renderPage()

    await user.click(screen.getByRole('button', { name: /AC Comercial/ }))
    await user.type(screen.getByPlaceholderText('00.000.000/0000-00'), '11222333000181')
    await user.type(screen.getByPlaceholderText('financeiro@cliente.com.br'), 'financeiro@alfa.com')
    await user.click(screen.getByRole('radio', { name: /Enviar o convite agora/ }))
    await user.click(screen.getByRole('button', { name: 'Cadastrar e vincular' }))

    const results = await screen.findByRole('region', { name: 'Resultados recentes' })
    expect(results.textContent).toMatch(/Cliente Modelo: cliente cadastrado em 2 B\/Ls/)
    expect(results.textContent).toMatch(/Continuam em revisão: Portal não provisionado \(2\)/)
    expect(results.textContent).toMatch(/convite do Portal não foi enviado; o cadastro foi concluído/)
    expect(mockedTryAutoIssueInvoice).not.toHaveBeenCalled()
  })

  it('avisa o recálculo pendente quando o faturamento do B/L liberado pelo cadastro é bloqueado', async () => {
    const user = userEvent.setup()
    mockedTryAutoIssueInvoice.mockResolvedValueOnce({ status: 'blocked', reason: 'review:no_table', message: 'Tabela de taxas locais ausente.' } as never)
    renderPage()

    await user.click(screen.getByRole('button', { name: /AC Comercial/ }))
    await user.type(screen.getByPlaceholderText('00.000.000/0000-00'), '11222333000181')
    await user.type(screen.getByPlaceholderText('financeiro@cliente.com.br'), 'financeiro@alfa.com')
    await choosePortalLater(user)
    await user.click(screen.getByRole('button', { name: 'Cadastrar e vincular' }))

    const results = await screen.findByRole('region', { name: 'Resultados recentes' })
    await waitFor(() => expect(results.textContent).toMatch(/B\/L BL1: taxas locais ainda por recalcular/))
    expect(results.textContent).toMatch(/1 fatura emitida automaticamente/)
  })

  it('caso E: valida o peso da carga solta junto do campo, sem gravar valor inválido', async () => {
    const user = userEvent.setup()
    mockedUseReviewQueue.mockReturnValue({
      data: [{ ...makeLinkedBl('BLW', { emails: ['a@b.com'], portalActive: true }), cargo_mode: 'carga_solta', bb_weight_ton: null, review_reasons: ['Peso BB ausente'] }],
      isLoading: false,
      error: null,
    } as never)
    renderPage()

    await user.click(screen.getByRole('button', { name: /Linked Co SA/ }))
    expect(screen.getByRole('heading', { name: 'Informar o peso da carga solta' })).toBeTruthy()
    const field = screen.getByRole('textbox', { name: /Peso da carga solta do B\/L BLW/ })
    await user.type(field, '0{Enter}')
    expect(screen.getByText('Informe o peso em toneladas, maior que zero.')).toBeTruthy()
    expect(field.getAttribute('aria-invalid')).toBe('true')
    expect(mockedApplyInlineBlReviewFix).not.toHaveBeenCalled()

    // Vírgula decimal, como se digita no Brasil.
    await user.clear(field)
    await user.type(field, '12,5{Enter}')
    await waitFor(() => expect(mockedApplyInlineBlReviewFix).toHaveBeenCalledWith(expect.objectContaining({ blId: 'BLW', field: 'bb_weight_ton', value: 12.5 })))
  })
})

// Revisão de 2026-10-22 (C3): filtro de navio/viagem na Revisão, pelo endereço.
it('filtra a fila pelo navio/viagem do endereço e limpa junto com os demais filtros', async () => {
  const otherVoyage = { ...makeBl('BL3', 'Alma Trading'), voyage_id: 2, voyage: { id: 2, voyage_number: '11', vessel: { id: 2, name: 'GREEN ITAJAI', carrier: null } } } as unknown as ReviewQueueItem
  mockedUseReviewQueue.mockReturnValue({
    data: [{ ...makeBl('BL1', 'AC Comercial'), voyage_id: 1 }, otherVoyage],
    isLoading: false,
    error: null,
  } as never)
  const user = userEvent.setup()
  renderPage(['/revisao?voyage=2'])

  expect(await screen.findByText('Alma Trading')).toBeTruthy()
  expect(screen.queryByText('AC Comercial')).toBeNull()
  await user.click(screen.getAllByRole('button', { name: 'Limpar filtros' })[0])
  await waitFor(() => expect(screen.getByTestId('location').textContent).toBe(''))
  expect(await screen.findByText('AC Comercial')).toBeTruthy()
})
