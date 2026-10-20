import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockFrom, mockRpc } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  mockRpc: vi.fn(),
}))

vi.mock('../supabase', () => ({
  supabase: { from: mockFrom, rpc: mockRpc },
}))

import { buildVoyageCommunicationCoverage, fetchCustomerCommunicationHistory, fetchVoyageCommunicationCoverage } from '../customerCommunications'

function queryResult(data: unknown, error: unknown = null) {
  const chain: Record<string, unknown> = {}
  for (const method of ['select', 'order', 'limit', 'range', 'in', 'neq', 'not', 'ilike', 'eq', 'gte', 'lt']) {
    chain[method] = vi.fn(() => chain)
  }
  chain.overrideTypes = vi.fn(async () => ({ data, error }))
  chain.then = (resolve: (value: { data: unknown; error: unknown }) => unknown) => Promise.resolve({ data, error }).then(resolve)
  return chain
}

describe('fetchVoyageCommunicationCoverage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('escopa a busca de BLs, comunicados e estados pelos IDs das viagens limitadas', async () => {
    const voyagesMock = queryResult([
      { id: 10, voyage_number: 'V10', vessel: { name: 'Vessel 10' } },
      { id: 20, voyage_number: 'V20', vessel: { name: 'Vessel 20' } },
    ])
    const blsMock = queryResult([
      { id: 'BL-1', voyage_id: 10, customer_id: 1, pod: 'BRSSZ', ce_mercante: '123', financial_status: 'invoiced' },
      { id: 'BL-2', voyage_id: 10, customer_id: 1, pod: 'BRSSZ', ce_mercante: '456', financial_status: 'pending' },
      { id: 'BL-3', voyage_id: 10, customer_id: 2, pod: 'BRSSZ', ce_mercante: '789', financial_status: 'paid' },
    ])
    const commsMock = queryResult([
      { customer_id: 2, kind: 'ce_mercante_taxas', status: 'enviado', anchor_voyage_id: 10, anchor_port: 'BRSSZ', anchor_atracacao_id: null, created_at: '2026-09-01T10:00:00Z' },
    ])
    const terminalStatesMock = queryResult([])

    mockFrom.mockImplementation((table: string) => {
      if (table === 'voyages') return voyagesMock
      if (table === 'bls') return blsMock
      if (table === 'customer_communications') return commsMock
      if (table === 'voyage_escala_terminal_state') return terminalStatesMock
      throw new Error(`Tabela inesperada: ${table}`)
    })
    mockRpc.mockImplementation((_name: string, args: { p_customer_id: number }) => Promise.resolve({ data: { ready: args.p_customer_id === 2 }, error: null }))

    const result = await fetchVoyageCommunicationCoverage()

    expect(blsMock.in).toHaveBeenCalledWith('voyage_id', [10, 20])
    expect(commsMock.in).toHaveBeenCalledWith('anchor_voyage_id', [10, 20])
    expect(terminalStatesMock.in).toHaveBeenCalledWith('voyage_id', [10, 20])

    const rowV10 = result.find((r) => r.voyageId === 10)
    expect(rowV10).toBeDefined()
    expect(rowV10?.customers).toBe(2)
    // Cliente 1 tem BL-1 (invoiced) e BL-2 (pending) -> NÃO pronto.
    // Cliente 2 tem BL-3 (paid) -> Pronto.
    expect(rowV10?.finance.ready).toBe(1)
    expect(rowV10?.finance.pending).toBe(1)
    expect(rowV10?.finance.sent).toBe(1)
  })

  it('retorna vazio sem disparar consultas adicionais quando nenhuma viagem é encontrada', async () => {
    const voyagesMock = queryResult([])
    mockFrom.mockReturnValue(voyagesMock)

    const result = await fetchVoyageCommunicationCoverage({ voyage: 'INEXISTENTE' })
    expect(result).toEqual([])
    expect(mockFrom).toHaveBeenCalledTimes(1)
  })

  it('remove curingas de LIKE antes de filtrar viagem', async () => {
    const voyagesMock = queryResult([])
    mockFrom.mockReturnValue(voyagesMock)

    await fetchVoyageCommunicationCoverage({ voyage: ' V%_10 ' })

    expect(voyagesMock.ilike).toHaveBeenCalledWith('voyage_number', '%V10%')
  })

  it('remove curingas de LIKE antes de filtrar navio no histórico', async () => {
    const historyMock = queryResult([])
    mockFrom.mockReturnValue(historyMock)

    await fetchCustomerCommunicationHistory({ vessel: ' N%_AVIO ' })

    expect(historyMock.ilike).toHaveBeenCalledWith('vessel_name', '%NAVIO%')
  })
})

// Obs. 8 (sessão de testes de 2026-10-20): uma linha por viagem × porto, e o
// CE e Taxas nunca mostra mais enviados que devidos.
describe('buildVoyageCommunicationCoverage', () => {
  const voyage = { id: 62, voyage_number: '11', vessel: { name: 'GREEN ITAJAI' } }
  const bl = (id: string, customerId: number, pod = 'BRVIX', financial_status = 'invoiced') => ({ id, voyage_id: 62, customer_id: customerId, pod, ce_mercante: '1', financial_status })
  const ce = (customerId: number, anchor_port: string | null = 'BRVIX') => ({ customer_id: customerId, kind: 'ce_mercante_taxas', status: 'enviado', anchor_voyage_id: 62, anchor_port, anchor_atracacao_id: null, created_at: '2026-10-20T19:04:00Z' })

  it('cliente enviado que ganhou B/L novo sem fatura dá "4 de 5" com 1 reenvio pendente, nunca "5 de 4"', () => {
    const customers = [3, 4, 5, 6, 7]
    const readiness = new Map(customers.map((id) => [`62:${id}`, id !== 3] as const))
    const [row] = buildVoyageCommunicationCoverage({
      voyages: [voyage],
      bls: [...customers.map((id) => bl(`BL${id}`, id)), bl('CSC45320B02G00', 3, 'BRVIX', 'pending')],
      communications: customers.map((id) => ce(id)),
      terminalStates: [],
      readiness,
    })
    expect(row.finance).toMatchObject({ sent: 4, due: 5, resend: 1, ready: 4, pending: 1 })
    expect(row.finance.sent).toBeLessThanOrEqual(row.finance.due)
  })

  it('viagem com dois PODs gera duas linhas, com NOA, NOR e NOB contados por porto', () => {
    const rows = buildVoyageCommunicationCoverage({
      voyages: [voyage],
      bls: [bl('A', 1, 'BRVIX'), bl('B', 2, 'BRSSZ'), bl('C', 1, 'BRSSZ')],
      communications: [
        { customer_id: 1, kind: 'aviso_chegada_noa', status: 'enviado', anchor_voyage_id: 62, anchor_port: 'BRVIX', anchor_atracacao_id: null, created_at: '' },
        { customer_id: 2, kind: 'aviso_chegada_noa', status: 'enviado', anchor_voyage_id: 62, anchor_port: 'BRSSZ', anchor_atracacao_id: null, created_at: '' },
        { customer_id: 2, kind: 'aviso_atracacao_nob', status: 'enviado', anchor_voyage_id: 62, anchor_port: 'BRSSZ', anchor_atracacao_id: 'T-SSZ', created_at: '' },
        // CE e Taxas sem porto vale para as duas escalas do Cliente 1.
        ce(1, null),
      ],
      terminalStates: [{ id: 'T-SSZ', voyage_id: 62, port: 'BRSSZ', terminal_atb: '2026-10-25T10:00:00Z' }],
      readiness: new Map([['62:1', true], ['62:2', true]]),
    })
    expect(rows.map((row) => row.port)).toEqual(['BRSSZ', 'BRVIX'])
    const [ssz, vix] = rows
    expect(ssz).toMatchObject({ customers: 2, noa: { sent: 1, total: 2 }, nob: { sent: 1, total: 2 }, finance: { sent: 1, due: 2, resend: 0 } })
    expect(vix).toMatchObject({ customers: 1, noa: { sent: 1, total: 1 }, nob: { sent: 0, total: 0 }, finance: { sent: 1, due: 1 } })
  })

  it('viagem sem B/L com cliente fica numa linha sem porto e sem nada devido', () => {
    const [row] = buildVoyageCommunicationCoverage({ voyages: [voyage], bls: [], communications: [], terminalStates: [], readiness: new Map() })
    expect(row).toMatchObject({ port: null, customers: 0, finance: { sent: 0, due: 0 } })
  })
})
