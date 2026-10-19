// @vitest-environment jsdom
import { fireEvent, render as renderBase, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactElement } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CustomerCommunicationConference } from '../../services/customerCommunications'
import { ClientesComunicacao } from '../ClientesComunicacao'

// O disparo em lote e o reenvio do CE usam os hooks reais; só o envio à Edge
// e o reenvio do CE (serviços) são falsos.
const { mockDispatch, mockCeDispatch, mockFetchConference, mockFetchHistory, mockConfirm } = vi.hoisted(() => ({
  mockDispatch: vi.fn(),
  mockCeDispatch: vi.fn(),
  mockFetchConference: vi.fn(),
  mockFetchHistory: vi.fn(),
  mockConfirm: vi.fn(),
}))
vi.mock('../../services/customerCommunicationDispatches', async () => ({
  ...(await vi.importActual<typeof import('../../services/customerCommunicationDispatches')>('../../services/customerCommunicationDispatches')),
  dispatchCustomerCommunication: mockDispatch,
}))
vi.mock('../../services/customerFinanceCommunications', () => ({
  dispatchCeMercanteTaxasCommunication: mockCeDispatch,
}))
vi.mock('../../services/customerCommunications', async () => ({
  ...(await vi.importActual<typeof import('../../services/customerCommunications')>('../../services/customerCommunications')),
  fetchCustomerCommunicationConference: mockFetchConference,
  fetchCustomerCommunicationHistory: mockFetchHistory,
}))

function render(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return renderBase(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

const mockSetCommunicationsMutation = {
  mutateAsync: vi.fn(),
  isPending: false,
}

const mockCoverage = [
  {
    voyageId: 101,
    vesselName: 'COSCO SHIPPING XING WANG',
    voyageNumber: '2401E',
    customers: 3,
    noa: { sent: 3, total: 3 },
    nor: { sent: 2, total: 3 },
    nob: { sent: 1, total: 2 },
    finance: { sent: 2, ready: 3, total: 3, pending: 0 },
  },
]
const blockedCustomerRow = {
  key: 'aviso_chegada_noa:2',
  customerId: 2,
  customerName: 'Cliente Bloqueado S/A',
  customerCnpj: '22.222.222/0001-22',
  terminalId: null,
  terminalName: null,
  bls: [{ id: 'BL-99', customerId: 2 }],
  sourceBls: [{ id: 'BL-99', customerId: 2 }],
  eligibleRecipients: [],
  excludedRecipients: [{ contact: { id: 2, name: 'João', email: 'j@ex.com' }, reason: 'preferencia_desligada' as const }],
  blocked: true,
  selected: false,
  nextAttemptDiscriminator: 0,
  renderInput: {
    customerId: 2,
    customerName: 'Cliente Bloqueado S/A',
    vesselName: 'COSCO SHIPPING XING WANG',
    voyageNumber: '2401E',
    port: 'Santos',
    milestoneAt: '2026-09-10T12:00:00Z',
    bls: [{ id: 'BL-99', customerId: 2 }],
  },
}

const acmeRow = {
  key: 'aviso_chegada_noa:1',
  customerId: 1,
  customerName: 'ACME Importadora',
  customerCnpj: '11.111.111/0001-11',
  terminalId: null,
  terminalName: null,
  bls: [{ id: 'BL-01', customerId: 1 }],
  sourceBls: [{ id: 'BL-01', customerId: 1 }],
  eligibleRecipients: [
    { id: 10, email: 'contato@acme.com', name: 'Contato ACME' },
    { id: 11, email: 'financeiro@acme.com', name: 'Financeiro ACME' },
  ],
  excludedRecipients: [],
  blocked: false,
  selected: true,
  nextAttemptDiscriminator: 1, // Já enviado antes!
  renderInput: {
    customerId: 1,
    customerName: 'ACME Importadora',
    vesselName: 'COSCO SHIPPING XING WANG',
    voyageNumber: '2401E',
    port: 'Santos',
    milestoneAt: '2026-09-10T12:00:00Z',
    bls: [{ id: 'BL-01', customerId: 1 }],
  },
}

const mockConference = {
  kind: 'aviso_chegada_noa',
  nature: 'avisos_operacionais',
  mode: 'carga',
  totalCustomers: 2,
  totalEligibleEmails: 3,
  totalExcludedEmails: 1,
  excludedReasonCounts: {
    preferencia_desligada: 1,
    email_ausente: 0,
    suprimido_complaint: 0,
    suprimido_bounce: 0,
  },
  blockedCustomers: [blockedCustomerRow],
  rows: [acmeRow, blockedCustomerRow],
}

let mockHistory: unknown[] = []
const historyCalls: Array<{ filters: unknown; enabled?: boolean }> = []
const coverageEnabled: Array<boolean | undefined> = []
const defaultHistory = [
  {
    id: 501,
    kind: 'aviso_chegada_noa',
    status: 'simulado',
    customer_id: 1,
    customer: { name: 'ACME Importadora', cnpj_cpf: '11111111000111' },
    vessel_name: 'COSCO SHIPPING XING WANG',
    voyage_number: '2401E',
    anchor_port: 'Santos',
    terminal_name: null,
    created_at: '2026-09-01T10:00:00Z',
    attempt_discriminator: 0,
    origin: 'manual',
    bl_links: [],
    attempts: [],
    attachments: [],
  },
]

type MockAppSettings = { communications_enabled: boolean }

let mockAppSettings: MockAppSettings | null = { communications_enabled: false }
let mockAppSettingsLoading = false
let mockAppSettingsError: Error | null = null
const mockRefetchSettings = vi.fn()

vi.mock('../../components/customers/ClientesTabs', () => ({ ClientesTabs: () => null }))
vi.mock('../../hooks/useAppSettings', () => ({
  useAppSettings: () => ({
    data: mockAppSettings,
    isLoading: mockAppSettingsLoading,
    error: mockAppSettingsError,
    refetch: mockRefetchSettings,
  }),
  useSetCommunicationsEnabled: () => mockSetCommunicationsMutation,
}))

vi.mock('../../hooks/useBls', () => ({
  useVoyageOptions: () => ({ data: [{ id: 1, voyage_number: '123', vessel: { name: 'COSCO SHIPPING XING WANG' } }] }),
}))

const authState = vi.hoisted(() => ({ canSend: true }))
vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({
    effectiveRole: authState.canSend ? 'administrativo' : 'financeiro',
    isAdmin: authState.canSend,
    can: () => authState.canSend,
  }),
}))

let activeMockConference: CustomerCommunicationConference | null | undefined = undefined

vi.mock('../../hooks/useCustomerCommunications', async () => ({
  ...(await vi.importActual<typeof import('../../hooks/useCustomerCommunications')>('../../hooks/useCustomerCommunications')),
  useCustomerCommunicationConference: () => ({
    data: activeMockConference !== undefined ? activeMockConference : mockConference,
    isFetching: false,
    isError: false,
  }),
  useCustomerCommunicationHistory: (filters: unknown, options?: { enabled?: boolean }) => {
    historyCalls.push({ filters, enabled: options?.enabled })
    return {
    data: mockHistory,
    isLoading: false,
    isError: false,
  }
  },
  useCustomerCommunicationSavedTemplates: () => ({
    data: [],
    isLoading: false,
  }),
  useSaveCustomerCommunicationSavedTemplate: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
  useVoyageCommunicationCoverage: (_filters: unknown, options?: { enabled?: boolean }) => (coverageEnabled.push(options?.enabled), {
    data: mockCoverage,
    isLoading: false,
    isError: false,
  }),
}))
vi.mock('../../components/ui/ConfirmDialog', () => ({
  useConfirm: () => mockConfirm,
}))

/** O modo e o modelo viraram escolhas visíveis: rádios, não selects. */
function escolher(nome: RegExp) {
  fireEvent.click(screen.getByRole('radio', { name: nome }))
}

describe('Página ClientesComunicacao (UI e fluxos)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockConfirm.mockResolvedValue(true)
    mockFetchHistory.mockResolvedValue([])
    mockHistory = defaultHistory
    activeMockConference = undefined
    mockAppSettings = { communications_enabled: false }
    mockAppSettingsLoading = false
    mockAppSettingsError = null
    authState.canSend = true
  })

  it('quem não envia consulta cobertura e histórico, sem a aba Disparo (ADR 0085, D19)', () => {
    authState.canSend = false
    render(
      <MemoryRouter initialEntries={['/clientes/comunicacao?tab=disparo']}>
        <ClientesComunicacao />
      </MemoryRouter>,
    )
    expect(screen.queryByRole('radio', { name: /Disparo/ })).toBeNull()
    expect(screen.getByRole('radio', { name: /Histórico/ })).toBeTruthy()
    expect(screen.getByText('Painel de cobertura')).toBeTruthy()
  })

  it('exibe o banner permanente de simulação quando communications_enabled é false', () => {
    mockAppSettings = { communications_enabled: false }
    render(
      <MemoryRouter initialEntries={['/clientes/comunicacao']}>
        <ClientesComunicacao />
      </MemoryRouter>,
    )

    expect(screen.getByText('Modo de simulação permanente')).toBeTruthy()
    expect(screen.getByText(/A chave global está desligada/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Ativar envio real' })).toBeTruthy()
  })

  it('exibe o banner de canal ativo quando communications_enabled é true', () => {
    mockAppSettings = { communications_enabled: true }
    render(
      <MemoryRouter initialEntries={['/clientes/comunicacao']}>
        <ClientesComunicacao />
      </MemoryRouter>,
    )

    expect(screen.getByText('Canal de envio real ativo')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Desativar envio real' })).toBeTruthy()
  })


  it('exibe o banner de simulação como fallback seguro quando settings é nulo ou indefinido', () => {
    mockAppSettings = null
    render(
      <MemoryRouter initialEntries={['/clientes/comunicacao']}>
        <ClientesComunicacao />
      </MemoryRouter>,
    )

    expect(screen.getByText('Modo de simulação permanente')).toBeTruthy()
  })

  it('exibe o estado de carregamento da chave sem ocultar o painel', () => {
    mockAppSettings = null
    mockAppSettingsLoading = true

    render(
      <MemoryRouter initialEntries={['/clientes/comunicacao']}>
        <ClientesComunicacao />
      </MemoryRouter>,
    )

    expect(screen.getByRole('status')).toBeTruthy()
    expect(screen.queryByText('Modo de simulação permanente')).toBeNull()
  })

  it('exibe erro da chave e permite tentar novamente', () => {
    mockAppSettings = null
    mockAppSettingsError = new Error('falha de rede')

    render(
      <MemoryRouter initialEntries={['/clientes/comunicacao']}>
        <ClientesComunicacao />
      </MemoryRouter>,
    )

    expect(screen.getByRole('alert')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
    expect(mockRefetchSettings).toHaveBeenCalledTimes(1)
  })

  it('renderiza o painel de cobertura na aba padrão com viagens e contadores', () => {
    render(
      <MemoryRouter initialEntries={['/clientes/comunicacao?tab=cobertura']}>
        <ClientesComunicacao />
      </MemoryRouter>,
    )

    expect(screen.getByText('Painel de cobertura')).toBeTruthy()
    expect(screen.getByText('COSCO SHIPPING XING WANG · 2401E')).toBeTruthy()
    expect(screen.getByText('3/3')).toBeTruthy() // NOA 3/3
    expect(screen.getByText('2/3')).toBeTruthy() // NOR 2/3

    const table = screen.getByRole('table')
    const scroll = table.closest('.app-table-scroll')
    expect(table.classList.contains('app-table')).toBe(true)
    expect(scroll).not.toBeNull()
    expect(scroll?.classList.contains('overflow-hidden')).toBe(false)
  })

  it('mantém a matriz de cobertura na ordem operacional documentada', () => {
    render(
      <MemoryRouter initialEntries={['/clientes/comunicacao?tab=cobertura']}>
        <ClientesComunicacao />
      </MemoryRouter>,
    )

    expect(screen.getAllByRole('columnheader').map((header) => header.textContent?.trim())).toEqual([
      'Viagem', 'Clientes', 'CE / Taxas', 'NOA', 'NOR', 'NOB',
    ])
  })

  it('na aba de disparo, valida filtros e exibe a conferência de destinatários com aviso de reenvio', () => {
    render(
      <MemoryRouter initialEntries={['/clientes/comunicacao?tab=disparo']}>
        <ClientesComunicacao />
      </MemoryRouter>,
    )

    expect(screen.getByText('O que será enviado')).toBeTruthy()
    expect(screen.getAllByText('NOA · Chegada Próxima').length).toBeGreaterThanOrEqual(1)

    fireEvent.change(screen.getByLabelText('Navio / Viagem'), { target: { value: 'COSCO SHIPPING XING WANG' } })
    fireEvent.click(screen.getByRole('button', { name: /Conferir destinatários/i }))

    // Detalhes da conferência renderizada
    expect(screen.getByText('Destinatários conferidos')).toBeTruthy()
    expect(screen.getByText('ACME Importadora')).toBeTruthy()
    expect(screen.getByText(/contato@acme.com/i)).toBeTruthy()

    // Cliente bloqueado por preferência desligada
    expect(screen.getByText('Cliente Bloqueado S/A')).toBeTruthy()
    expect(screen.getByText('Bloqueado')).toBeTruthy()

    // Alerta de reenvio com discriminador > 0
    expect(screen.getByText('Reenvio 1')).toBeTruthy()
    expect(screen.getByText(/Confirmo o reenvio\./i)).toBeTruthy()
  })

  it('abre o modal de pré-visualização do comunicado com a identidade visual e o assunto correto', () => {
    render(
      <MemoryRouter initialEntries={['/clientes/comunicacao?tab=disparo']}>
        <ClientesComunicacao />
      </MemoryRouter>,
    )

    const previewBtn = screen.getByRole('button', { name: 'Ver prévia do e-mail' })
    fireEvent.click(previewBtn)

    expect(screen.getByText(/Pré-visualização do Comunicado/i)).toBeTruthy()
    expect(screen.getByText(/Destinatário:/i)).toBeTruthy()
    expect(screen.getByText(/Assunto:/i)).toBeTruthy()
  })

  it('renderiza a prévia institucional sem B/Ls quando ainda não há conferência', () => {
    activeMockConference = null
    render(
      <MemoryRouter initialEntries={['/clientes/comunicacao?tab=disparo']}>
        <ClientesComunicacao />
      </MemoryRouter>,
    )

    escolher(/^Institucional/)
    fireEvent.change(screen.getByLabelText(/^Assunto/), { target: { value: 'Aviso importante' } })
    fireEvent.change(screen.getByLabelText(/^Mensagem/), { target: { value: 'Mensagem institucional de teste.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ver prévia do e-mail' }))

    expect(screen.getAllByText('Mensagem institucional de teste.')).toHaveLength(2)
    expect(screen.queryByText('Não foi possível renderizar a prévia deste comunicado.')).toBeNull()
  })

  it('cada modo oferece apenas os modelos do seu recorte de destinatários', () => {
    render(
      <MemoryRouter initialEntries={['/clientes/comunicacao?tab=disparo']}>
        <ClientesComunicacao />
      </MemoryRouter>,
    )

    // Os modelos do modo Carga ficam todos visíveis, cada um com a sua descrição.
    const modelos = screen.getAllByRole('radio', { name: /Texto fixo|escreve assunto/ })
    expect(modelos.map((radio) => (radio as HTMLInputElement).name)).toEqual(Array(4).fill('comunicacao-modelo'))
    expect(screen.getByRole('radio', { name: /NOA · Chegada Próxima/ })).toBeTruthy()
    expect(screen.getByRole('radio', { name: /NOR · Aviso de Chegada/ })).toBeTruthy()
    expect(screen.getByRole('radio', { name: /NOB · Aviso de Atracação/ })).toBeTruthy()
    expect(screen.getByRole('radio', { name: /Comunicado livre/ })).toBeTruthy()

    // O modo Institucional resolve modelo e público sozinho: em vez de uma lista
    // de uma opção só e dois hints repetindo o rótulo do Modo, uma frase resume.
    escolher(/^Institucional/)
    expect(screen.queryByRole('radio', { name: /NOA · Chegada Próxima/ })).toBeNull()
    expect(screen.queryByLabelText(/^Público/)).toBeNull()
    expect(screen.getByText(/Modelo único neste modo/)).toBeTruthy()
    // E o editor continua abrindo, porque o modelo segue sendo o institucional.
    expect(screen.getByLabelText(/^Assunto/)).toBeTruthy()
  })

  it('o modelo Livre abre o editor de mensagem sem sair do modo Carga', () => {
    render(
      <MemoryRouter initialEntries={['/clientes/comunicacao?tab=disparo']}>
        <ClientesComunicacao />
      </MemoryRouter>,
    )

    expect(screen.queryByLabelText(/^Mensagem/)).toBeNull()

    escolher(/Comunicado livre/)

    expect((screen.getByRole('radio', { name: /^Carga/ }) as HTMLInputElement).checked).toBe(true)
    expect(screen.getByLabelText(/^Assunto/)).toBeTruthy()
    expect(screen.getByLabelText(/^Mensagem/)).toBeTruthy()
    // O filtro da viagem continua ativo: o livre é ancorado na carga.
    expect(screen.getByLabelText('Navio / Viagem')).toBeTruthy()
  })

  it('só o modelo Livre deixa o operador escolher o público', () => {
    render(
      <MemoryRouter initialEntries={['/clientes/comunicacao?tab=disparo']}>
        <ClientesComunicacao />
      </MemoryRouter>,
    )

    // NOA: público imposto pelo modelo, exibido como texto e não como select.
    // Aparece duas vezes de propósito: na faixa que o declara e na frase do
    // painel da direita, que resume o disparo inteiro.
    expect(screen.getAllByText('Documentação e Operação').length).toBe(2)
    expect(screen.queryByLabelText(/^Público/)).toBeNull()

    escolher(/Comunicado livre/)
    const publico = screen.getByLabelText(/^Público/) as HTMLSelectElement
    expect(publico.value).toBe('todos')
    expect([...publico.options].map((option) => option.value)).toEqual([
      'todos',
      'documentacao_operacao',
      'financeiro',
      'demurrage',
    ])
  })

  it('bloqueia a conferência do modo carga enquanto nenhum filtro operacional for informado', () => {
    render(
      <MemoryRouter initialEntries={['/clientes/comunicacao?tab=disparo']}>
        <ClientesComunicacao />
      </MemoryRouter>,
    )

    const conferir = screen.getByRole('button', { name: /Conferir destinatários/i }) as HTMLButtonElement
    expect(conferir.disabled).toBe(true)

    fireEvent.change(screen.getByLabelText('Navio / Viagem'), { target: { value: 'COSCO SHIPPING XING WANG' } })
    expect((screen.getByRole('button', { name: /Conferir destinatários/i }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('o CNPJ sozinho não libera a conferência, e a frase do recorte não finge o contrário', () => {
    render(
      <MemoryRouter initialEntries={['/clientes/comunicacao?tab=disparo']}>
        <ClientesComunicacao />
      </MemoryRouter>,
    )

    fireEvent.change(screen.getByLabelText(/^CNPJ do Cliente/), { target: { value: '12.345.678/0001-90' } })

    // `validateCustomerCommunicationFilters` aceita só navio/viagem, POL ou POD.
    expect((screen.getByRole('button', { name: /Conferir destinatários/i }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(/informe navio\/viagem, POL ou POD/i)).toBeTruthy()
  })

  it('não deixa conferir sem mensagem, porque a conferência desmonta o editor', () => {
    render(
      <MemoryRouter initialEntries={['/clientes/comunicacao?tab=disparo']}>
        <ClientesComunicacao />
      </MemoryRouter>,
    )

    escolher(/Comunicado livre/)
    fireEvent.change(screen.getByLabelText('Navio / Viagem'), { target: { value: 'COSCO SHIPPING XING WANG' } })

    const conferir = () => screen.getByRole('button', { name: /Conferir destinatários/i }) as HTMLButtonElement
    expect(conferir().disabled).toBe(true)
    expect(screen.getByText(/Escreva o assunto e a mensagem para conferir/i)).toBeTruthy()

    fireEvent.change(screen.getByLabelText(/^Assunto/), { target: { value: 'Recesso' } })
    fireEvent.change(screen.getByLabelText(/^Mensagem/), { target: { value: 'Comunicamos o recesso.' } })
    expect(conferir().disabled).toBe(false)
  })

  it('o alerta de alcance máximo do institucional cala quando um CNPJ restringe o disparo', () => {
    render(
      <MemoryRouter initialEntries={['/clientes/comunicacao?tab=disparo']}>
        <ClientesComunicacao />
      </MemoryRouter>,
    )

    escolher(/^Institucional/)
    expect(screen.getByText(/atinge a base inteira/i)).toBeTruthy()

    fireEvent.change(screen.getByLabelText(/^CNPJ do Cliente/), { target: { value: '12.345.678/0001-90' } })
    expect(screen.queryByText(/atinge a base inteira/i)).toBeNull()
  })

  it('cabe numa linha: um campo de navio/viagem, POL, POD e CNPJ', () => {
    render(
      <MemoryRouter initialEntries={['/clientes/comunicacao?tab=disparo']}>
        <ClientesComunicacao />
      </MemoryRouter>,
    )

    // Navio e viagem viraram um campo só, como no Line-up.
    expect(screen.queryByLabelText('Navio')).toBeNull()
    expect(screen.queryByLabelText('Viagem')).toBeNull()
    expect(screen.getByLabelText('Navio / Viagem')).toBeTruthy()

    // POL antes de POD, sem o rótulo por extenso e com os placeholders corretos.
    const rotulos = screen.getAllByText(/^(POL|POD)$/).map((el) => el.textContent)
    expect(rotulos).toEqual(['POL', 'POD'])
    expect(screen.getByPlaceholderText('CNSHA')).toBeTruthy()
    expect(screen.getByPlaceholderText('BRSSZ')).toBeTruthy()

    // O painel da direita nomeia o recorte em vez de repetir a lista de campos.
    expect(screen.getByText(/informe navio\/viagem, POL ou POD/i)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Navio / Viagem'), { target: { value: 'COSCO SHIPPING XING WANG' } })
    expect(screen.getByText('COSCO SHIPPING XING WANG')).toBeTruthy()

    // O filtro de escala saiu de vez.
    expect(screen.queryByLabelText(/Escala/)).toBeNull()
  })

  it('exibe mensagem explicativa quando a conferência de NOB é vazia por falta de Frente de Operação', () => {
    activeMockConference = {
      kind: 'aviso_atracacao_nob',
      nature: 'avisos_operacionais',
      mode: 'carga',
      totalCustomers: 0,
      totalEligibleEmails: 0,
      totalExcludedEmails: 0,
      excludedReasonCounts: {
        preferencia_desligada: 0,
        email_ausente: 0,
        suprimido_complaint: 0,
        suprimido_bounce: 0,
      },
      blockedCustomers: [],
      rows: [],
      unassignedOperationFronts: true,
    }

    render(
      <MemoryRouter initialEntries={['/clientes/comunicacao?tab=disparo']}>
        <ClientesComunicacao />
      </MemoryRouter>,
    )

    escolher(/NOB · Aviso de Atracação/)
    fireEvent.change(screen.getByLabelText('Navio / Viagem'), { target: { value: 'COSCO SHIPPING XING WANG' } })
    fireEvent.click(screen.getByRole('button', { name: /Conferir destinatários/i }))

    expect(screen.getByText('Nenhuma carga disponível para envio de NOB')).toBeTruthy()
    expect(screen.getByText(/Atracação TBC/i)).toBeTruthy()
  })

  it('depois de conferir, a composição colapsa numa faixa-resumo e o Editar a devolve', () => {
    render(
      <MemoryRouter initialEntries={['/clientes/comunicacao?tab=disparo']}>
        <ClientesComunicacao />
      </MemoryRouter>,
    )

    fireEvent.change(screen.getByLabelText('Navio / Viagem'), { target: { value: 'COSCO SHIPPING XING WANG' } })
    fireEvent.click(screen.getByRole('button', { name: /Conferir destinatários/i }))

    // A lista assume a tela: o formulário que a produziu vira uma linha só.
    expect(screen.queryByLabelText('Navio / Viagem')).toBeNull()
    expect(screen.getByText('Destinatários conferidos')).toBeTruthy()
    expect(screen.getByText('Pronto para disparar')).toBeTruthy()
    expect(screen.getByText('Modo Carga')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /Editar composição/i }))

    // E volta inteiro, com o filtro preservado — sair da conferência não é refazer.
    expect((screen.getByLabelText('Navio / Viagem') as HTMLInputElement).value).toBe('COSCO SHIPPING XING WANG')
    expect(screen.queryByText('Destinatários conferidos')).toBeNull()
    expect(screen.getByText('O que será enviado')).toBeTruthy()
  })

  it('a seleção em massa da conferência nunca alcança um cliente bloqueado', () => {
    render(
      <MemoryRouter initialEntries={['/clientes/comunicacao?tab=disparo']}>
        <ClientesComunicacao />
      </MemoryRouter>,
    )

    fireEvent.change(screen.getByLabelText('Navio / Viagem'), { target: { value: 'COSCO SHIPPING XING WANG' } })
    fireEvent.click(screen.getByRole('button', { name: /Conferir destinatários/i }))

    fireEvent.click(screen.getByRole('button', { name: 'Desmarcar' }))
    expect(screen.getByRole('button', { name: /Disparar para 0 cliente/i })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Marcar todos' }))
    const bloqueado = screen.getByLabelText('Selecionar Cliente Bloqueado S/A') as HTMLInputElement
    expect(bloqueado.checked).toBe(false)
    expect(bloqueado.disabled).toBe(true)
    expect(screen.getByRole('button', { name: /Disparar para 1 cliente/i })).toBeTruthy()
  })

  it('renderiza o histórico de disparos na aba historico', () => {
    render(
      <MemoryRouter initialEntries={['/clientes/comunicacao?tab=historico']}>
        <ClientesComunicacao />
      </MemoryRouter>,
    )

    expect(screen.getByText('Histórico de Comunicados')).toBeTruthy()
    expect(screen.getByText('ACME Importadora')).toBeTruthy()
    expect(screen.getAllByText('Simulado').length).toBeGreaterThanOrEqual(1)
  })
})

function noaRow(customerId: number, name: string, emails: string[]) {
  return {
    key: `aviso_chegada_noa:${customerId}:1:BRSSZ`,
    customerId,
    customerName: name,
    customerCnpj: `${customerId}${customerId}.111.111/0001-11`,
    terminalId: null,
    terminalName: null,
    bls: [{ id: `BL-${customerId}`, customerId, voyageId: 1, pod: 'BRSSZ' }],
    sourceBls: [{ id: `BL-${customerId}`, customerId, voyageId: 1, pod: 'BRSSZ' }],
    eligibleRecipients: emails.map((email, index) => ({ id: customerId * 10 + index, email, name: email })),
    excludedRecipients: [],
    blocked: false,
    selected: true,
    nextAttemptDiscriminator: 0,
    recipientSnapshot: `snap-${customerId}`,
    renderInput: {
      customerId,
      customerName: name,
      vesselName: 'COSCO SHIPPING XING WANG',
      voyageNumber: '2401E',
      port: 'BRSSZ',
      milestoneAt: '2026-09-10T12:00:00Z',
      bls: [{ id: `BL-${customerId}`, customerId }],
    },
  }
}

function conferenceOf(kind: string, rows: unknown[]) {
  return {
    kind,
    nature: kind === 'livre' ? 'avisos_gerais' : 'avisos_operacionais',
    mode: 'carga',
    totalCustomers: rows.length,
    totalEligibleEmails: 3,
    totalExcludedEmails: 0,
    excludedReasonCounts: { preferencia_desligada: 0, email_ausente: 0, suprimido_complaint: 0, suprimido_bounce: 0 },
    blockedCustomers: [],
    rows,
  } as unknown as CustomerCommunicationConference
}

function conferir() {
  fireEvent.change(screen.getByLabelText('Navio / Viagem'), { target: { value: 'COSCO SHIPPING XING WANG' } })
  fireEvent.click(screen.getByRole('button', { name: /Conferir destinatários/i }))
}

describe('Disparo em lote, confirmação e Histórico (plano dos e-mails, Fase 3)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockConfirm.mockResolvedValue(true)
    mockFetchHistory.mockResolvedValue([])
    mockHistory = defaultHistory
    mockAppSettings = { communications_enabled: false }
    mockAppSettingsLoading = false
    mockAppSettingsError = null
    authState.canSend = true
  })

  it('lote com falha no 2º de 3: os 3 são chamados, o resumo aparece, a seleção fica e repetir envia só a falha com o mesmo item', async () => {
    activeMockConference = conferenceOf('aviso_chegada_noa', [
      noaRow(1, 'ACME Importadora', ['a@acme.com', 'b@acme.com']),
      noaRow(2, 'Beta Comércio', ['c@beta.com']),
    ])
    mockFetchConference.mockResolvedValue(activeMockConference)
    mockDispatch
      .mockResolvedValueOnce({ communicationId: 1, status: 'simulado' })
      .mockRejectedValueOnce(new Error('Contato desativado para esta caixa ou modelo.'))
      .mockResolvedValueOnce({ communicationId: 2, status: 'simulado' })

    render(
      <MemoryRouter initialEntries={['/clientes/comunicacao?tab=disparo']}>
        <ClientesComunicacao />
      </MemoryRouter>,
    )
    conferir()
    fireEvent.click(screen.getByRole('button', { name: /Disparar para 2 cliente/i }))

    const resultado = await screen.findByText('Resultado do disparo')
    const painel = resultado.closest('[role="status"]') as HTMLElement
    expect(mockDispatch).toHaveBeenCalledTimes(3)
    expect(mockDispatch.mock.calls.map(([input]) => input.recipient)).toEqual(['a@acme.com', 'b@acme.com', 'c@beta.com'])
    expect(within(painel).getByText(/2 simulado\(s\)/)).toBeTruthy()
    expect(within(painel).getByText('1 falha(s)')).toBeTruthy()
    expect(within(painel).getByText(/b@acme.com: Contato desativado para esta caixa ou modelo\./)).toBeTruthy()
    // A conferência continua na tela, com a seleção de antes.
    expect(screen.getByText('Destinatários conferidos')).toBeTruthy()
    expect((screen.getByLabelText('Selecionar ACME Importadora') as HTMLInputElement).checked).toBe(true)
    expect((screen.getByLabelText('Selecionar Beta Comércio') as HTMLInputElement).checked).toBe(true)

    mockDispatch.mockResolvedValueOnce({ communicationId: 1, status: 'simulado' })
    fireEvent.click(within(painel).getByRole('button', { name: /Repetir só as falhas \(1\)/ }))

    await waitFor(() => expect(within(painel).getByText(/3 simulado\(s\)/)).toBeTruthy())
    // D16 também na repetição: a chave pode ter mudado depois do lote.
    expect(mockConfirm.mock.calls.at(-1)?.[0]).toMatchObject({ title: 'Repetir em simulação' })
    expect(mockConfirm.mock.calls.at(-1)?.[0].message).toMatch(/^1 destinatário\(s\) de 1 Cliente\(s\)/)
    expect(mockDispatch).toHaveBeenCalledTimes(4)
    expect(mockDispatch.mock.calls[3][0]).toEqual(mockDispatch.mock.calls[1][0])
    expect(within(painel).getByText(/nenhuma falha/)).toBeTruthy()
  })

  it('confirma antes de disparar, dizendo se é simulação e para quantos destinatários; Cancelar não envia nada', async () => {
    activeMockConference = conferenceOf('aviso_chegada_noa', [
      noaRow(1, 'ACME Importadora', ['a@acme.com', 'b@acme.com']),
      noaRow(2, 'Beta Comércio', ['c@beta.com']),
    ])
    mockConfirm.mockResolvedValue(false)

    render(
      <MemoryRouter initialEntries={['/clientes/comunicacao?tab=disparo']}>
        <ClientesComunicacao />
      </MemoryRouter>,
    )
    conferir()
    fireEvent.click(screen.getByRole('button', { name: /Disparar para 2 cliente/i }))

    await waitFor(() => expect(mockConfirm).toHaveBeenCalledTimes(1))
    expect(mockConfirm.mock.calls[0][0]).toMatchObject({
      title: 'Registrar em simulação',
      message: expect.stringContaining('3 destinatário(s) de 2 Cliente(s)'),
      confirmLabel: 'Confirmar',
      cancelLabel: 'Cancelar',
    })
    expect(mockFetchConference).not.toHaveBeenCalled()
    expect(mockDispatch).not.toHaveBeenCalled()
  })

  it('com a chave ligada, a confirmação é "Enviar de verdade"', async () => {
    mockAppSettings = { communications_enabled: true }
    activeMockConference = conferenceOf('aviso_chegada_noa', [noaRow(1, 'ACME Importadora', ['a@acme.com'])])
    mockConfirm.mockResolvedValue(false)

    render(
      <MemoryRouter initialEntries={['/clientes/comunicacao?tab=disparo']}>
        <ClientesComunicacao />
      </MemoryRouter>,
    )
    conferir()
    fireEvent.click(screen.getByRole('button', { name: /Disparar para 1 cliente/i }))

    await waitFor(() => expect(mockConfirm).toHaveBeenCalledTimes(1))
    expect(mockConfirm.mock.calls[0][0]).toMatchObject({ title: 'Enviar de verdade', message: expect.stringContaining('1 destinatário(s) de 1 Cliente(s)') })
  })

  it('o livre leva a Viagem na identidade e repete com o mesmo dispatchId enquanto a conferência não muda', async () => {
    const livre = { ...noaRow(1, 'ACME Importadora', ['a@acme.com']), key: 'livre:1:1' }
    activeMockConference = conferenceOf('livre', [livre])
    mockFetchConference.mockResolvedValue(activeMockConference)
    mockDispatch.mockResolvedValue({ communicationId: 9, status: 'simulado' })

    render(
      <MemoryRouter initialEntries={['/clientes/comunicacao?tab=disparo']}>
        <ClientesComunicacao />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('radio', { name: /Comunicado livre/ }))
    fireEvent.change(screen.getByLabelText(/^Assunto/), { target: { value: 'Recesso' } })
    fireEvent.change(screen.getByLabelText(/^Mensagem/), { target: { value: 'Comunicamos o recesso.' } })
    conferir()

    fireEvent.click(screen.getByRole('button', { name: /Disparar para 1 cliente/i }))
    await screen.findByText('Resultado do disparo')
    fireEvent.click(screen.getByRole('button', { name: /Disparar para 1 cliente/i }))
    await waitFor(() => expect(mockDispatch).toHaveBeenCalledTimes(2))

    const [first, second] = mockDispatch.mock.calls.map(([input]) => input)
    expect(first.dispatchId).toEqual(expect.any(String))
    expect(second.dispatchId).toBe(first.dispatchId)
    expect(second.attemptDiscriminator).toBe(first.attemptDiscriminator)
    expect(first.anchorVoyageId).toBe(1)
    expect(first.anchorPort).toBeNull()
  })

  it('no livre, o rótulo de envios anteriores conta os da Viagem, não o discriminador do Cliente', () => {
    const livre = { ...noaRow(1, 'ACME Importadora', ['a@acme.com']), key: 'livre:1:1', nextAttemptDiscriminator: 5, previousDispatchCount: 2 }
    activeMockConference = conferenceOf('livre', [livre])

    render(
      <MemoryRouter initialEntries={['/clientes/comunicacao?tab=disparo']}>
        <ClientesComunicacao />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('radio', { name: /Comunicado livre/ }))
    fireEvent.change(screen.getByLabelText(/^Assunto/), { target: { value: 'Recesso' } })
    fireEvent.change(screen.getByLabelText(/^Mensagem/), { target: { value: 'Comunicamos o recesso.' } })
    conferir()

    expect(screen.getByText('2 envio(s) anterior(es)')).toBeTruthy()
    expect(screen.queryByText('5 envio(s) anterior(es)')).toBeNull()
  })

  it('disparar de novo depois do lote, com Comunicados novos, recusa e pede para conferir de novo', async () => {
    activeMockConference = conferenceOf('aviso_chegada_noa', [noaRow(1, 'ACME Importadora', ['a@acme.com'])])
    // A reconferência do 1º disparo vê a mesma conferência; a do 2º já vê o
    // Comunicado do 1º (discriminador seguinte), e a tela continua com a velha.
    mockFetchConference
      .mockResolvedValueOnce(activeMockConference)
      .mockResolvedValueOnce(conferenceOf('aviso_chegada_noa', [{ ...noaRow(1, 'ACME Importadora', ['a@acme.com']), nextAttemptDiscriminator: 1 }]))
    mockDispatch.mockResolvedValue({ communicationId: 9, status: 'enviado' })

    render(
      <MemoryRouter initialEntries={['/clientes/comunicacao?tab=disparo']}>
        <ClientesComunicacao />
      </MemoryRouter>,
    )
    conferir()
    fireEvent.click(screen.getByRole('button', { name: /Disparar para 1 cliente/i }))
    await screen.findByText('Resultado do disparo')
    expect(mockDispatch).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: /Disparar para 1 cliente/i }))

    expect(await screen.findByText('Há Comunicados novos desde a conferência. Confira de novo.')).toBeTruthy()
    expect(mockFetchConference).toHaveBeenCalledTimes(2)
    expect(mockDispatch).toHaveBeenCalledTimes(1)
  })

  it('recusa definitiva aparece como "não adianta repetir" e fica fora de "Repetir só as falhas"', async () => {
    const { CustomerCommunicationDispatchError } = await import('../../services/customerCommunicationDispatches')
    activeMockConference = conferenceOf('aviso_chegada_noa', [noaRow(1, 'ACME Importadora', ['a@acme.com', 'b@acme.com', 'c@acme.com'])])
    mockFetchConference.mockResolvedValue(activeMockConference)
    mockDispatch
      .mockRejectedValueOnce(new CustomerCommunicationDispatchError('O provedor recusou a mensagem (endereço ou conteúdo inválido).', { permanent: true, communicationId: 9 }))
      .mockRejectedValueOnce(new CustomerCommunicationDispatchError('Provedor de e-mail indisponível no momento; a mensagem pode ser reenviada.', { communicationId: 9 }))
      .mockResolvedValueOnce({ communicationId: 9, status: 'simulado' })

    render(
      <MemoryRouter initialEntries={['/clientes/comunicacao?tab=disparo']}>
        <ClientesComunicacao />
      </MemoryRouter>,
    )
    conferir()
    fireEvent.click(screen.getByRole('button', { name: /Disparar para 1 cliente/i }))

    const painel = (await screen.findByText('Resultado do disparo')).closest('[role="status"]') as HTMLElement
    expect(within(painel).getByText('2 falha(s)')).toBeTruthy()
    expect(within(painel).getByText(/a@acme.com: O provedor recusou a mensagem \(endereço ou conteúdo inválido\)\./)).toBeTruthy()
    expect(within(painel).getAllByText('Não adianta repetir; corrija o contato.')).toHaveLength(1)

    mockDispatch.mockResolvedValueOnce({ communicationId: 9, status: 'simulado' })
    fireEvent.click(within(painel).getByRole('button', { name: /Repetir só as falhas \(1\)/ }))

    await waitFor(() => expect(mockDispatch).toHaveBeenCalledTimes(4))
    expect(mockDispatch.mock.calls[3][0].recipient).toBe('b@acme.com')
    expect(await within(painel).findByText('1 falha(s)')).toBeTruthy()
    // Sobra só a recusa definitiva: não há o que repetir.
    expect(within(painel).queryByRole('button', { name: /Repetir só as falhas/ })).toBeNull()
  })

  it('mostra na conferência o NOB bloqueado pelo terminal sem sigla, com o motivo', () => {
    activeMockConference = conferenceOf('aviso_atracacao_nob', [
      { ...noaRow(1, 'ACME Importadora', ['a@acme.com']), blocked: true, selected: false, blockedReason: 'Terminal da Atracação sem sigla cadastrada.' },
    ])

    render(
      <MemoryRouter initialEntries={['/clientes/comunicacao?tab=disparo']}>
        <ClientesComunicacao />
      </MemoryRouter>,
    )
    conferir()

    expect(screen.getByText('Terminal da Atracação sem sigla cadastrada.')).toBeTruthy()
    expect((screen.getByLabelText('Selecionar ACME Importadora') as HTMLInputElement).disabled).toBe(true)
  })

  it('o Histórico mostra cada destinatário mascarado, real ou simulado, a situação e o motivo traduzido', () => {
    mockHistory = [{
      ...defaultHistory[0],
      status: 'parcial',
      attempts: [
        { id: 1, recipient_masked: 'a***@a***.com', dispatch_mode: 'real', status: 'aceito', retry_count: 0, provider_message_id: 'msg-1', last_error: null, created_at: '', updated_at: '' },
        { id: 2, recipient_masked: 'b***@a***.com', dispatch_mode: 'real', status: 'falha_permanente', retry_count: 0, provider_message_id: null, last_error: 'HTTP 422 validation_error', created_at: '', updated_at: '' },
      ],
    }]

    render(
      <MemoryRouter initialEntries={['/clientes/comunicacao?tab=historico']}>
        <ClientesComunicacao />
      </MemoryRouter>,
    )

    const tabela = screen.getByRole('table', { name: 'Destinatários do Comunicado 501' })
    expect(within(tabela).getByText('a***@a***.com')).toBeTruthy()
    expect(within(tabela).getByText('Aceito pelo provedor')).toBeTruthy()
    expect(within(tabela).getByText('Recusado pelo provedor')).toBeTruthy()
    const motivo = within(tabela).getByText('O provedor recusou a mensagem (endereço ou conteúdo inválido).')
    expect(motivo.getAttribute('title')).toBe('HTTP 422 validation_error')
    expect(within(tabela).getAllByText('Real')).toHaveLength(2)
  })

  it('os filtros do Histórico têm todos os modelos e o status "Em envio"', () => {
    render(
      <MemoryRouter initialEntries={['/clientes/comunicacao?tab=historico']}>
        <ClientesComunicacao />
      </MemoryRouter>,
    )

    const modelos = [...(screen.getByLabelText('Modelo') as HTMLSelectElement).options].map((option) => option.textContent)
    expect(modelos).toContain('CE Mercante · Taxas Locais')
    expect(modelos).toContain('Cobrança de Demurrage')
    const status = [...(screen.getByLabelText('Status') as HTMLSelectElement).options].map((option) => option.value)
    expect(status).toEqual(['', 'pendente', 'enviado', 'simulado', 'parcial', 'falha'])
    expect(screen.getByRole('option', { name: 'Em envio' })).toBeTruthy()
  })

  it('"Reenviar CE e Taxas" no último CE do Cliente × Viagem chama o serviço com forceRetry e mostra o resultado', async () => {
    const ce = { ...defaultHistory[0], kind: 'ce_mercante_taxas', anchor_voyage_id: 7, status: 'simulado' }
    mockHistory = [{ ...ce, id: 900 }, { ...ce, id: 800, attempt_discriminator: 0 }]
    mockCeDispatch.mockResolvedValue({ status: 'simulado', attemptDiscriminator: 2, sentCount: 0, simulatedCount: 1, communicationIds: [901], reason: null })

    render(
      <MemoryRouter initialEntries={['/clientes/comunicacao?tab=historico']}>
        <ClientesComunicacao />
      </MemoryRouter>,
    )

    const botoes = screen.getAllByRole('button', { name: /Reenviar CE e Taxas/ })
    expect(botoes).toHaveLength(1)
    fireEvent.click(botoes[0])

    await waitFor(() => expect(mockCeDispatch).toHaveBeenCalledWith(7, 1, { forceRetry: true }))
    expect(mockConfirm.mock.calls[0][0]).toMatchObject({ title: 'Reenviar CE e Taxas', cancelLabel: 'Cancelar' })
    expect(mockConfirm.mock.calls[0][0].message).not.toContain('mais recente')
    expect(await screen.findByText(/Reenvio registrado em simulação \(tentativa 2\)/)).toBeTruthy()
  })

  it('com o Histórico filtrado, o diálogo do reenvio do CE avisa o envio mais recente da viagem', async () => {
    const ce = { ...defaultHistory[0], kind: 'ce_mercante_taxas', anchor_voyage_id: 7, status: 'falha' }
    mockHistory = [{ ...ce, id: 800 }]
    mockFetchHistory.mockResolvedValue([{ ...ce, id: 900, status: 'enviado', created_at: '2026-10-18T13:00:00Z' }, { ...ce, id: 800 }])
    mockConfirm.mockResolvedValueOnce(false)

    render(
      <MemoryRouter initialEntries={['/clientes/comunicacao?tab=historico']}>
        <ClientesComunicacao />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: /Reenviar CE e Taxas/ }))
    await waitFor(() => expect(mockConfirm).toHaveBeenCalled())
    expect(mockFetchHistory).toHaveBeenCalledWith({ customerId: 1, voyageId: 7, kind: 'ce_mercante_taxas' })
    expect(mockConfirm.mock.calls[0][0].message).toContain('Há um envio mais recente desta viagem: Enviado')
    expect(mockCeDispatch).not.toHaveBeenCalled()
  })

  it('quem não envia não vê o reenvio do CE', () => {
    authState.canSend = false
    mockHistory = [{ ...defaultHistory[0], kind: 'ce_mercante_taxas', anchor_voyage_id: 7 }]

    render(
      <MemoryRouter initialEntries={['/clientes/comunicacao?tab=historico']}>
        <ClientesComunicacao />
      </MemoryRouter>,
    )

    expect(screen.queryByRole('button', { name: /Reenviar CE e Taxas/ })).toBeNull()
  })

  it('o link do alerta abre o Histórico filtrado pelos CE e Taxas do B/L, e a Cobertura só carrega na aba dela', () => {
    historyCalls.length = 0
    coverageEnabled.length = 0
    render(
      <MemoryRouter initialEntries={['/clientes/comunicacao?tab=historico&kind=ce_mercante_taxas&bl=BL-77']}>
        <ClientesComunicacao />
      </MemoryRouter>,
    )

    expect(screen.getByText('BL-77')).toBeTruthy()
    expect((screen.getByLabelText('Modelo') as HTMLSelectElement).value).toBe('ce_mercante_taxas')
    expect(historyCalls.at(-1)).toMatchObject({ filters: { blId: 'BL-77', kind: 'ce_mercante_taxas' }, enabled: true })
    // Fora da aba Cobertura, a cobertura não é consultada.
    expect(coverageEnabled.length).toBeGreaterThan(0)
    expect(coverageEnabled.every((enabled) => enabled === false)).toBe(true)
  })
})
