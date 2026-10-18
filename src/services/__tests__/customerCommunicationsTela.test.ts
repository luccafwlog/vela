import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockFrom, mockRpc } = vi.hoisted(() => ({ mockFrom: vi.fn(), mockRpc: vi.fn() }))
vi.mock('../supabase', () => ({ supabase: { from: mockFrom, rpc: mockRpc } }))

import {
  brasiliaMonthRange,
  buildCustomerCommunicationConference,
  customerCommunicationAttemptReason,
  customerCommunicationAttemptStatusLabel,
  fetchCommunicationBlRows,
  fetchCustomerCommunicationHistory,
  fetchVoyageCommunicationCoverage,
  toBaseCandidate,
  type CustomerCommunicationBlCandidate,
  type RawCommunicationBlRow,
} from '../customerCommunications'
import {
  CustomerCommunicationDispatchError,
  mergeCustomerCommunicationBatchRetry,
  runCustomerCommunicationBatch,
  summarizeCustomerCommunicationBatch,
  type CustomerCommunicationBatchItem,
} from '../customerCommunicationDispatches'
import { renderCustomerCommunicationTemplate } from '../customerCommunicationTemplates'
import type { CustomerContact } from '../../types/database'

// Testes da Fase 3 do plano dos e-mails (tela /clientes/comunicacao).

function queryResult(data: unknown, error: unknown = null) {
  const chain: Record<string, unknown> = {}
  for (const method of ['select', 'order', 'limit', 'range', 'in', 'is', 'neq', 'not', 'ilike', 'eq', 'gte', 'lt']) {
    chain[method] = vi.fn(() => chain)
  }
  chain.overrideTypes = vi.fn(async () => ({ data, error }))
  chain.then = (resolve: (value: { data: unknown; error: unknown }) => unknown) => Promise.resolve({ data, error }).then(resolve)
  return chain as Record<string, ReturnType<typeof vi.fn>>
}

function raw(overrides: Partial<RawCommunicationBlRow> = {}): RawCommunicationBlRow {
  return {
    id: 'BL-1',
    voyage_id: 7,
    customer_id: 99,
    pod: 'BRSSZ',
    pol: 'CNSHA',
    cargo_mode: 'container',
    cancelled_at: null,
    financial_status: 'pending',
    customer: { id: 99, name: 'Cliente 99', cnpj_cpf: '12345678000195', deactivated_at: null },
    voyage: { id: 7, voyage_number: 'V7', eta: null, ata: null, status: 'active', vessel: { name: 'Navio 7' } },
    ...overrides,
  }
}

function candidate(overrides: Partial<CustomerCommunicationBlCandidate> = {}): CustomerCommunicationBlCandidate {
  return {
    id: 'BL-1', customerId: 99, customerName: 'Cliente 99', customerCnpj: '12.345.678/0001-95',
    voyageId: 7, vesselName: 'Navio 7', voyageNumber: 'V7', pod: 'BRSSZ', pol: 'CNSHA', cargoMode: 'container',
    eta: '2026-09-01T12:00:00Z', ata: null, terminalId: 'terminal-1', terminalName: 'BTP', terminalStateId: 'state-1',
    milestoneAt: '2026-09-01T12:00:00Z', ...overrides,
  }
}

const contact = { id: 1, customer_id: 99, name: 'Contato', email: 'c@cliente.com', is_primary: true, deactivated_at: null } as unknown as CustomerContact

describe('3.4 — conferência manual com a elegibilidade da régua', () => {
  it('B/L cancelado, Cliente desativado e Viagem cancelada não viram candidatos', () => {
    expect(toBaseCandidate(raw())).not.toBeNull()
    expect(toBaseCandidate(raw({ cancelled_at: '2026-10-01T00:00:00Z' }))).toBeNull()
    expect(toBaseCandidate(raw({ financial_status: 'cancelled' }))).toBeNull()
    expect(toBaseCandidate(raw({ customer: { id: 99, name: 'C', cnpj_cpf: '1', deactivated_at: '2026-10-01T00:00:00Z' } }))).toBeNull()
    expect(toBaseCandidate(raw({ voyage: { id: 7, voyage_number: 'V7', eta: null, ata: null, status: 'cancelled', vessel: null } }))).toBeNull()
  })
})

describe('3.7 — recorte dos B/Ls no servidor', () => {
  beforeEach(() => vi.clearAllMocks())

  it('no modo carga, filtra B/L cancelado, viagens do navio e POD na consulta', async () => {
    const voyages = queryResult([
      { id: 7, voyage_number: '2401E', vessel: { name: 'XING WANG' } },
      { id: 8, voyage_number: '2402E', vessel: { name: 'CMA VEGA' } },
    ])
    const bls = queryResult([raw()])
    mockFrom.mockImplementation((table: string) => (table === 'voyages' ? voyages : bls))

    const rows = await fetchCommunicationBlRows({ mode: 'carga', vesselVoyage: 'xing wang', pol: '', pod: ' BR%SSZ ', cnpj: '' })

    expect(rows).toHaveLength(1)
    expect(bls.is).toHaveBeenCalledWith('cancelled_at', null)
    expect(bls.in).toHaveBeenCalledWith('voyage_id', [7])
    expect(bls.ilike).toHaveBeenCalledWith('pod', '%BRSSZ%')
  })

  it('sem viagem que case com o navio, não lê B/Ls', async () => {
    mockFrom.mockImplementation(() => queryResult([{ id: 8, voyage_number: '2402E', vessel: { name: 'CMA VEGA' } }]))
    expect(await fetchCommunicationBlRows({ mode: 'carga', vesselVoyage: 'XING', pol: '', pod: '', cnpj: '' })).toEqual([])
    expect(mockFrom).toHaveBeenCalledTimes(1)
  })
})

describe('3.2 e 3.8 — agrupamento da conferência', () => {
  it('o livre sai um por Cliente e Viagem', () => {
    const conference = buildCustomerCommunicationConference({
      kind: 'livre',
      mode: 'carga',
      candidates: [candidate({ id: 'BL-1' }), candidate({ id: 'BL-2' }), candidate({ id: 'BL-3', voyageId: 8, voyageNumber: 'V8' })],
      contactsByCustomer: new Map([[99, [contact]]]),
      preferences: [],
    })
    expect(conference.rows.map((row) => [row.renderInput.voyageNumber, row.bls.map((bl) => bl.id)])).toEqual([
      ['V7', ['BL-1', 'BL-2']],
      ['V8', ['BL-3']],
    ])
  })

  it('no livre, "envios anteriores" conta só os da mesma Viagem; o discriminador segue por Cliente', () => {
    const history = [
      { customerId: 99, kind: 'livre', anchorVoyageId: 7, anchorPort: null, anchorAtracacaoId: null, anchorInvoiceId: null, attemptDiscriminator: 0 },
      { customerId: 99, kind: 'livre', anchorVoyageId: 8, anchorPort: null, anchorAtracacaoId: null, anchorInvoiceId: null, attemptDiscriminator: 1 },
      { customerId: 99, kind: 'livre', anchorVoyageId: 8, anchorPort: null, anchorAtracacaoId: null, anchorInvoiceId: null, attemptDiscriminator: 2 },
    ]
    const conference = buildCustomerCommunicationConference({
      kind: 'livre',
      mode: 'carga',
      candidates: [candidate({ id: 'BL-1' }), candidate({ id: 'BL-3', voyageId: 9, voyageNumber: 'V9' })],
      contactsByCustomer: new Map([[99, [contact]]]),
      preferences: [],
      history,
    })
    expect(conference.rows.map((row) => [row.renderInput.voyageNumber, row.previousDispatchCount, row.nextAttemptDiscriminator])).toEqual([
      ['V7', 1, 3],
      ['V9', 0, 3],
    ])
  })

  it('o NOB de terminal sem sigla fica bloqueado com o motivo', () => {
    const conference = buildCustomerCommunicationConference({
      kind: 'aviso_atracacao_nob',
      mode: 'carga',
      candidates: [candidate({ terminalName: null })],
      contactsByCustomer: new Map([[99, [contact]]]),
      preferences: [],
    })
    expect(conference.rows[0]).toMatchObject({ blocked: true, selected: false, blockedReason: 'Terminal da Atracação sem sigla cadastrada.' })
    expect(conference.rows[0]?.eligibleRecipients).toHaveLength(1)
  })
})

describe('3.2 — lote que continua depois de um erro', () => {
  function item(key: string): CustomerCommunicationBatchItem {
    return { key, customerName: `Cliente ${key}`, input: { customerId: 1, kind: 'livre', recipient: `${key}@x.com`, subject: 's', html: 'h', text: 't', dispatchId: 'd-1' } }
  }

  it('chama todos, guarda o motivo da falha e repete só ela com o mesmo item', async () => {
    const dispatch = vi.fn()
      .mockResolvedValueOnce({ communicationId: 1, status: 'enviado' })
      .mockRejectedValueOnce(new Error('Endereço suprimido para Comunicados.'))
      .mockResolvedValueOnce({ communicationId: 1, status: 'simulado' })
    const outcomes = await runCustomerCommunicationBatch([item('a'), item('b'), item('c')], dispatch)

    expect(dispatch).toHaveBeenCalledTimes(3)
    const summary = summarizeCustomerCommunicationBatch(outcomes)
    expect([summary.sent, summary.simulated, summary.failed.map((outcome) => [outcome.key, outcome.reason])]).toEqual([
      1, 1, [['b', 'Endereço suprimido para Comunicados.']],
    ])

    dispatch.mockResolvedValueOnce({ communicationId: 1, status: 'enviado' })
    const retried = await runCustomerCommunicationBatch(summary.failed, dispatch)
    expect(dispatch.mock.calls[3][0]).toBe(dispatch.mock.calls[1][0])
    const merged = summarizeCustomerCommunicationBatch(mergeCustomerCommunicationBatchRetry(outcomes, retried))
    expect([merged.sent, merged.simulated, merged.failed]).toEqual([2, 1, []])
  })

  it('recusa definitiva fica fora de "Repetir só as falhas", com o motivo e o Comunicado', async () => {
    const dispatch = vi.fn()
      .mockRejectedValueOnce(new CustomerCommunicationDispatchError('O provedor recusou a mensagem (endereço ou conteúdo inválido).', { permanent: true, communicationId: 4 }))
      .mockRejectedValueOnce(new CustomerCommunicationDispatchError('Provedor de e-mail indisponível no momento; a mensagem pode ser reenviada.', { communicationId: 4 }))
    const summary = summarizeCustomerCommunicationBatch(await runCustomerCommunicationBatch([item('a'), item('b')], dispatch))

    expect(summary.failed.map((outcome) => [outcome.key, outcome.permanent, outcome.communicationId])).toEqual([['a', true, 4], ['b', false, 4]])
    expect(summary.retryable.map((outcome) => outcome.key)).toEqual(['b'])
  })

  it('resposta com status falha conta como falha', async () => {
    const outcomes = await runCustomerCommunicationBatch([item('a')], vi.fn().mockResolvedValue({ communicationId: 3, status: 'falha', message: 'Falha no envio do comunicado.' }))
    expect(outcomes[0]).toMatchObject({ result: 'falha', reason: 'Falha no envio do comunicado.', communicationId: 3 })
  })
})

describe('3.3 — motivo da tentativa traduzido', () => {
  it('traduz o last_error do envio comum', () => {
    expect(customerCommunicationAttemptReason('Tempo esgotado na chamada ao provedor')).toMatch(/não respondeu a tempo/)
    expect(customerCommunicationAttemptReason('Falha de rede na chamada ao provedor (TypeError)')).toMatch(/Falha de rede/)
    expect(customerCommunicationAttemptReason('HTTP 403 (configuração do provedor)')).toMatch(/credencial/)
    expect(customerCommunicationAttemptReason('HTTP 422 validation_error')).toBe('O provedor recusou a mensagem (endereço ou conteúdo inválido).')
    expect(customerCommunicationAttemptReason('HTTP 503')).toMatch(/indisponível/)
    expect(customerCommunicationAttemptReason('HTTP 429 rate_limit_exceeded')).toMatch(/Limite/)
    expect(customerCommunicationAttemptReason('RESEND_API_KEY não está configurada; email não enviado.')).toMatch(/sem a chave/)
    expect(customerCommunicationAttemptReason(null)).toBeNull()
  })

  it('diferencia simulado, aceito e em envio', () => {
    expect(customerCommunicationAttemptStatusLabel({ status: 'aceito', dispatch_mode: 'simulado', provider_message_id: null })).toBe('Registrado em simulação')
    expect(customerCommunicationAttemptStatusLabel({ status: 'aceito', dispatch_mode: 'real', provider_message_id: 'm-1' })).toBe('Aceito pelo provedor')
    expect(customerCommunicationAttemptStatusLabel({ status: 'aceito', dispatch_mode: 'real', provider_message_id: null })).toBe('Em envio')
  })
})

describe('3.5 — filtros', () => {
  beforeEach(() => vi.clearAllMocks())

  it('o Mês da Cobertura filtra as viagens pelo ETA no fuso de Brasília', async () => {
    expect(brasiliaMonthRange('2026-12')).toEqual({ start: '2026-12-01T00:00:00-03:00', end: '2027-01-01T00:00:00-03:00' })
    expect(brasiliaMonthRange('')).toBeNull()
    const voyages = queryResult([])
    mockFrom.mockReturnValue(voyages)
    await fetchVoyageCommunicationCoverage({ month: '2026-10' })
    expect(voyages.gte).toHaveBeenCalledWith('eta', '2026-10-01T00:00:00-03:00')
    expect(voyages.lt).toHaveBeenCalledWith('eta', '2026-11-01T00:00:00-03:00')
  })

  it('o Mês do Histórico usa o fuso de Brasília: 31/10 às 22h é outubro', async () => {
    const history = queryResult([])
    mockFrom.mockReturnValue(history)
    await fetchCustomerCommunicationHistory({ month: '2026-10' })
    expect(history.gte).toHaveBeenCalledWith('created_at', '2026-10-01T00:00:00-03:00')
    expect(history.lt).toHaveBeenCalledWith('created_at', '2026-11-01T00:00:00-03:00')

    // 31/10 22h em Brasília é 01/11 01h em UTC: dentro do intervalo de outubro.
    const createdAt = new Date('2026-10-31T22:00:00-03:00').getTime()
    const [start, end] = [history.gte.mock.calls[0][1], history.lt.mock.calls[0][1]].map((value) => new Date(value as string).getTime())
    expect(createdAt >= start && createdAt < end).toBe(true)
    expect(new Date('2026-10-01T01:00:00Z').getTime() < start).toBe(true)
  })

  it('o Histórico filtra pelos Comunicados vinculados a um B/L', async () => {
    const links = queryResult([{ communication_id: 5 }, { communication_id: 6 }])
    const history = queryResult([])
    mockFrom.mockImplementation((table: string) => (table === 'customer_communication_bls' ? links : history))
    await fetchCustomerCommunicationHistory({ blId: 'BL-1' })
    expect(links.eq).toHaveBeenCalledWith('bl_id', 'BL-1')
    expect(history.in).toHaveBeenCalledWith('id', [5, 6])
  })
})

describe('3.8 — Comunicado livre com os dados da carga', () => {
  it('leva Navio, Viagem e B/Ls, escapados', () => {
    const rendered = renderCustomerCommunicationTemplate('livre', {
      customerId: 99, customerName: 'Cliente', vesselName: 'NAVIO <X>', voyageNumber: 'V&7', port: 'BRSSZ', milestoneAt: '',
      subject: 'Aviso', body: 'Texto', bls: [{ id: 'BL"1', customerId: 99 }, { id: 'BL-2', customerId: 99 }],
    })
    expect(rendered.html).toContain('NAVIO &lt;X&gt;')
    expect(rendered.html).toContain('V&amp;7')
    expect(rendered.html).toContain('BL&quot;1, BL-2')
    expect(rendered.text).toContain('Navio: NAVIO <X>\nViagem: V&7\nB/Ls: BL"1, BL-2')
  })

  it('o institucional continua sem bloco de carga', () => {
    const rendered = renderCustomerCommunicationTemplate('institucional', {
      customerId: 99, customerName: 'Cliente', vesselName: '', voyageNumber: '', port: '', milestoneAt: '', subject: 'A', body: 'B', bls: [],
    })
    expect(rendered.text).not.toContain('Navio:')
  })
})
