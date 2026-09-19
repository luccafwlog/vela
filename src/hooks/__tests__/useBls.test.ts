// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchAllBls, useBls, useVoyages, type BlFilters } from '../useBls'

const { mockFrom } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
}))
const { mockRpc } = vi.hoisted(() => ({
  mockRpc: vi.fn(),
}))

vi.mock('../../services/supabase', () => ({
  supabase: {
    from: mockFrom,
    rpc: mockRpc,
  },
}))

const baseFilters: BlFilters = {
  search: '',
  voyageId: '24',
  cargoMode: 'container',
  pol: '',
  pod: '',
  reviewStatus: '',
  financialStatus: '',
  chargeStatus: '',
  cargoProfile: '',
  page: 1,
  pageSize: 20,
}

function makeBl(id: string, containers: Array<{ is_imo?: boolean; is_oog?: boolean }>) {
  return {
    id,
    voyage_id: 24,
    cargo_mode: 'container',
    bl_containers: containers,
  }
}

function createBlQuery(rows: unknown[]) {
  let selectedRange: [number, number] = [0, rows.length - 1]
  const builder = {
    order: vi.fn(() => builder),
    range: vi.fn((from: number, to: number) => {
      selectedRange = [from, to]
      return builder
    }),
    eq: vi.fn(() => builder),
    in: vi.fn(() => builder),
    ilike: vi.fn(() => builder),
    or: vi.fn(() => builder),
    then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve({ data: rows.slice(selectedRange[0], selectedRange[1] + 1), error: null }).then(resolve, reject),
  }
  return builder
}

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: queryClient }, children)
  }
}

describe('fetchAllBls', () => {
  beforeEach(() => {
    mockFrom.mockReset()
    mockRpc.mockReset()
  })

  it('exporta pela mesma RPC da tabela, repassando todos os filtros', async () => {
    // O export reimplementava os filtros contra `bls`, com busca textual mais
    // estreita que a da RPC (sem nome nem CNPJ do cliente): buscar por nome de
    // cliente mostrava linhas na tela e exportava zero. Agora há um dialeto só,
    // e o perfil de carga é resolvido no servidor.
    const rows = [makeBl('BL-STANDARD', [{ is_imo: false, is_oog: false }])]
    mockRpc.mockResolvedValue({ data: { rows, count: rows.length }, error: null })

    const result = await fetchAllBls({ ...baseFilters, search: 'TIMBRO', cargoProfile: 'standard' })

    expect(result.map((row) => row.id)).toEqual(['BL-STANDARD'])
    expect(mockFrom).not.toHaveBeenCalled()
    expect(mockRpc).toHaveBeenCalledWith('operational_list_bls', expect.objectContaining({
      p_search: 'TIMBRO',
      p_cargo_profile: 'standard',
      p_voyage_id: 24,
      p_cargo_mode: 'container',
    }))
  })

  it('pagina a RPC até completar a contagem do envelope', async () => {
    // O lote é o teto de `p_page_size` da RPC, elevado para 1.000 pela
    // migration 064: uma página cheia significa que pode haver mais.
    const firstPage = Array.from({ length: 1000 }, (_, index) => makeBl(`BL-${index}`, []))
    const secondPage = [makeBl('BL-1000', [])]
    mockRpc
      .mockResolvedValueOnce({ data: { rows: firstPage, count: 1001 }, error: null })
      .mockResolvedValueOnce({ data: { rows: secondPage, count: 1001 }, error: null })

    const result = await fetchAllBls(baseFilters)

    expect(result).toHaveLength(1001)
    expect(mockRpc).toHaveBeenCalledTimes(2)
    expect(mockRpc).toHaveBeenCalledWith('operational_list_bls', expect.objectContaining({ p_page_size: 1000 }))
    expect(mockRpc).toHaveBeenLastCalledWith('operational_list_bls', expect.objectContaining({ p_page: 2 }))
  })

  it('retorna contagem paginada filtrada quando useBls recebe perfil Standard', async () => {
    const rows = [
      makeBl('BL-STANDARD', [{ is_imo: false, is_oog: false }]),
      makeBl('BL-IMO', [{ is_imo: true, is_oog: false }]),
    ]

    mockFrom.mockImplementation((table: string) => {
      if (table === 'bls') {
        return { select: vi.fn(() => createBlQuery(rows)) }
      }
      throw new Error(`Tabela nao mockada: ${table}`)
    })
    mockRpc.mockResolvedValue({
      data: { rows: [rows[0]], count: 1 },
      error: null,
    })

    const { result } = renderHook(() => useBls({ ...baseFilters, cargoProfile: 'standard' }), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.data?.count).toBe(1))
    expect(result.current.data?.rows.map((row) => row.id)).toEqual(['BL-STANDARD'])
  })
})

describe('useVoyages', () => {
  beforeEach(() => {
    mockFrom.mockReset()
    mockRpc.mockReset()
  })

  it('consulta somente o envelope paginado do rail, sem embeds de detalhe', async () => {
    mockRpc.mockResolvedValue({
      data: { rows: [], count: 0 },
      error: null,
    })

    const { result } = renderHook(() => useVoyages(), { wrapper: createWrapper() })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mockRpc).toHaveBeenCalledWith('operational_list_voyage_summaries', {
      p_page: 1,
      p_page_size: 100,
    })
  })

  it('continua buscando páginas até o total do envelope', async () => {
    mockRpc
      .mockResolvedValueOnce({
        data: {
          rows: Array.from({ length: 100 }, (_value, index) => ({
            id: index + 1,
            voyage_number: `V-${index + 1}`,
            status: 'active',
            blCount: 0,
            containerCount: 0,
            baplieCount: 0,
            ceCoverage: { filled: 0, total: 0 },
            routes: [],
          })),
          count: 101,
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { rows: [], count: 101 },
        error: null,
      })

    const { result } = renderHook(() => useVoyages(), { wrapper: createWrapper() })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mockRpc).toHaveBeenCalledTimes(2)
    expect(mockRpc).toHaveBeenLastCalledWith('operational_list_voyage_summaries', {
      p_page: 2,
      p_page_size: 100,
    })
  })
})
