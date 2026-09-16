// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CustomerCommunicationConference } from '../../services/customerCommunications'
import { ClientesComunicacao } from '../ClientesComunicacao'

const mockSetCommunicationsMutation = {
  mutateAsync: vi.fn(),
  isPending: false,
}

const mockDispatchMutation = {
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

const mockHistory = [
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

let mockAppSettings = { communications_enabled: false }

vi.mock('../../hooks/useAppSettings', () => ({
  useAppSettings: () => ({ data: mockAppSettings }),
  useSetCommunicationsEnabled: () => mockSetCommunicationsMutation,
}))

vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({
    effectiveRole: 'administrativo',
    isAdmin: true,
    can: () => true,
  }),
}))

let activeMockConference: CustomerCommunicationConference | null | undefined = undefined

vi.mock('../../hooks/useCustomerCommunications', () => ({
  useCustomerCommunicationConference: () => ({
    data: activeMockConference !== undefined ? activeMockConference : mockConference,
    isFetching: false,
    isError: false,
  }),
  useCustomerCommunicationHistory: () => ({
    data: mockHistory,
    isLoading: false,
    isError: false,
  }),
  useCustomerCommunicationSavedTemplates: () => ({
    data: [],
    isLoading: false,
  }),
  useSaveCustomerCommunicationSavedTemplate: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
  useDispatchCustomerCommunication: () => mockDispatchMutation,
  useVoyageCommunicationCoverage: () => ({
    data: mockCoverage,
    isLoading: false,
    isError: false,
  }),
}))
vi.mock('../../components/ui/ConfirmDialog', () => ({
  useConfirm: () => vi.fn().mockResolvedValue(true),
}))

/** O modo e o modelo viraram escolhas visíveis: rádios, não selects. */
function escolher(nome: RegExp) {
  fireEvent.click(screen.getByRole('radio', { name: nome }))
}

describe('Página ClientesComunicacao (UI e fluxos)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    activeMockConference = undefined
    mockAppSettings = { communications_enabled: false }
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
