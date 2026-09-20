import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockFrom, mockRpc } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  mockRpc: vi.fn(),
}))

vi.mock('../supabase', () => ({
  supabase: { from: mockFrom, rpc: mockRpc },
}))

import { fetchCustomerCommunicationHistory, fetchVoyageCommunicationCoverage } from '../customerCommunications'

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
