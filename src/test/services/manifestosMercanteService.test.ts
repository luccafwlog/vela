import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockFrom = vi.fn()
const mockRpc = vi.fn()

vi.mock('../../services/supabase', () => ({
  supabase: {
    from: (table: string) => mockFrom(table),
    rpc: (name: string, args: unknown) => mockRpc(name, args),
  },
}))

import {
  canonicalManifestoNumero,
  isStaleScreenRefusal,
  listVoyageBlsForManifesto,
  VOYAGE_BLS_PAGE_SIZE,
  moveBlsToManifestoMercante,
  unlinkBlsFromManifestoMercante,
  listManifestosMercanteByRota,
  listManifestosMercanteByVoyage,
} from '../../services/manifestosMercanteService'

describe('manifestosMercanteService', () => {
  beforeEach(() => {
    mockFrom.mockReset()
  })

  it('lista N manifestos para a mesma viagem e par de portos', async () => {
    const manifestosMock = [
      {
        id: 'man-1',
        voyage_id: 10,
        pol: 'CNSHA',
        pod: 'BRVIX',
        numero: '26BR000000001',
        natureza: 'carga',
        created_at: '2026-06-01T10:00:00Z',
      },
      {
        id: 'man-2',
        voyage_id: 10,
        pol: 'CNSHA',
        pod: 'BRVIX',
        numero: '26BR000000002',
        natureza: 'vazio',
        created_at: '2026-06-01T11:00:00Z',
      },
    ]

    const orderMock = vi.fn().mockResolvedValue({ data: manifestosMock, error: null })
    const eqPodMock = vi.fn().mockReturnValue({ order: orderMock })
    const eqPolMock = vi.fn().mockReturnValue({ eq: eqPodMock })
    const eqVoyageMock = vi.fn().mockReturnValue({ eq: eqPolMock, order: orderMock })
    const selectMock = vi.fn().mockReturnValue({ eq: eqVoyageMock })
    mockFrom.mockReturnValue({ select: selectMock })

    const results = await listManifestosMercanteByRota(10, 'CNSHA', 'BRVIX')
    expect(mockFrom).toHaveBeenCalledWith('manifestos_mercante')
    expect(results).toHaveLength(2)
    expect(results[0].natureza).toBe('carga')
    expect(results[1].natureza).toBe('vazio')
  })

  it('lista manifestos de uma viagem inteira', async () => {
    const orderMock = vi.fn().mockResolvedValue({ data: [{ id: 'man-1', voyage_id: 10, numero: '26BR000000001' }], error: null })
    const eqVoyageMock = vi.fn().mockReturnValue({ order: orderMock })
    const selectMock = vi.fn().mockReturnValue({ eq: eqVoyageMock })
    mockFrom.mockReturnValue({ select: selectMock })

    const results = await listManifestosMercanteByVoyage(10)
    expect(mockFrom).toHaveBeenCalledWith('manifestos_mercante')
    expect(results).toHaveLength(1)
  })

  // Mover / Desvincular passam pelas RPCs da migration 181: tudo ou nada e
  // com motivo no Histórico (o UPDATE direto em bls saiu).
  it('move e desvincula B/Ls pelas RPCs, com motivo', async () => {
    mockRpc.mockResolvedValue({ data: { moved: 2 }, error: null })
    await moveBlsToManifestoMercante(['BL-001', 'BL-002'], '1226501860578', 'Reemissão', { 'BL-001': null, 'BL-002': '1226B01849909' })
    expect(mockRpc).toHaveBeenCalledWith('move_bls_to_manifesto_mercante', {
      p_bl_ids: ['BL-001', 'BL-002'], p_numero: '1226501860578', p_reason: 'Reemissão', p_expected: { 'BL-001': null, 'BL-002': '1226B01849909' },
    })
    await unlinkBlsFromManifestoMercante(['BL-001'], 'B/L de outro manifesto', { 'BL-001': '1226501860578' })
    expect(mockRpc).toHaveBeenCalledWith('unlink_bls_from_manifesto_mercante', { p_bl_ids: ['BL-001'], p_reason: 'B/L de outro manifesto', p_expected: { 'BL-001': '1226501860578' } })
    expect(mockFrom).not.toHaveBeenCalled()
  })

  // PostgREST devolve no máximo `max_rows` linhas: a lista de Ver B/Ls da
  // rota pagina até a página incompleta, sem perder os B/Ls além do teto.
  it('lista os B/Ls da Viagem em páginas até a última', async () => {
    const bl = (index: number) => ({ id: `BL-${String(index).padStart(5, '0')}`, pol: 'CNSHA', pod: 'BRVIX', cancelled_at: null, manifesto: null })
    const pages = [
      Array.from({ length: VOYAGE_BLS_PAGE_SIZE }, (_, index) => bl(index)),
      [{ ...bl(VOYAGE_BLS_PAGE_SIZE), cancelled_at: '2026-10-01T00:00:00Z', manifesto: { numero: '1226501860578' } }],
    ]
    const rangeMock = vi.fn((from: number) => Promise.resolve({ data: pages[from / VOYAGE_BLS_PAGE_SIZE] ?? [], error: null }))
    const orderMock = vi.fn().mockReturnValue({ range: rangeMock })
    const eqMock = vi.fn().mockReturnValue({ order: orderMock })
    mockFrom.mockReturnValue({ select: vi.fn().mockReturnValue({ eq: eqMock }) })

    const results = await listVoyageBlsForManifesto(10)

    expect(mockFrom).toHaveBeenCalledWith('bls')
    expect(eqMock).toHaveBeenCalledWith('voyage_id', 10)
    expect(rangeMock.mock.calls).toEqual([[0, VOYAGE_BLS_PAGE_SIZE - 1], [VOYAGE_BLS_PAGE_SIZE, 2 * VOYAGE_BLS_PAGE_SIZE - 1]])
    expect(results).toHaveLength(VOYAGE_BLS_PAGE_SIZE + 1)
    expect(results.at(-1)).toEqual({ id: bl(VOYAGE_BLS_PAGE_SIZE).id, pol: 'CNSHA', pod: 'BRVIX', cancelled: true, manifestoNumero: '1226501860578' })
  })

  it('reconhece a recusa por estado visto na tela (migration 209)', () => {
    expect(isStaleScreenRefusal({ code: '22023', message: 'O Manifesto Mercante mudou depois da tela: BL-1 está em X.' })).toBe(true)
    expect(isStaleScreenRefusal({ code: '22023', message: 'O CE Mercante do B/L BL-1 mudou depois que a ficha foi aberta (agora: 1).' })).toBe(true)
    expect(isStaleScreenRefusal({ code: '22023', message: 'Informe o motivo da mudança de Manifesto Mercante.' })).toBe(false)
    expect(isStaleScreenRefusal({ code: 'P0001', message: 'mudou depois da tela' })).toBe(false)
    expect(isStaleScreenRefusal(null)).toBe(false)
  })

  it('normaliza o Nº de Manifesto para a forma canônica', () => {
    expect(canonicalManifestoNumero(' 1226 b01-849.909 ')).toBe('1226B01849909')
  })

})
