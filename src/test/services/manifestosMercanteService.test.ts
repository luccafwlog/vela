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
  createManifestoMercante,
  moveBlsToManifestoMercante,
  unlinkBlsFromManifestoMercante,
  listManifestosMercanteByRota,
  listManifestosMercanteByVoyage,
  type CreateManifestoMercanteInput,
} from '../../services/manifestosMercanteService'

describe('manifestosMercanteService', () => {
  beforeEach(() => {
    mockFrom.mockReset()
  })

  it('valida campos obrigatorios ao criar manifesto mercante', async () => {
    await expect(
      createManifestoMercante({
        voyage_id: 10,
        pol: '',
        pod: 'BRVIX',
        numero: '26BR000000001',
        natureza: 'carga',
      }),
    ).rejects.toThrow('Portos de origem (POL) e destino (POD) são obrigatórios')

    await expect(
      createManifestoMercante({
        voyage_id: 10,
        pol: 'CNSHA',
        pod: 'BRVIX',
        numero: '  ',
        natureza: 'carga',
      }),
    ).rejects.toThrow('Número do manifesto Mercante é obrigatório')
  })

  it('cria manifesto mercante de carga ou de vazio com sucesso', async () => {
    const singleMock = vi.fn().mockResolvedValue({
      data: {
        id: 'uuid-man-01',
        voyage_id: 10,
        pol: 'CNSHA',
        pod: 'BRVIX',
        numero: '26BR000000001',
        natureza: 'carga',
        created_at: '2026-06-01T10:00:00Z',
        updated_at: '2026-06-01T10:00:00Z',
      },
      error: null,
    })

    const selectMock = vi.fn().mockReturnValue({ single: singleMock })
    const insertMock = vi.fn().mockReturnValue({ select: selectMock })
    mockFrom.mockReturnValue({ insert: insertMock })

    const input: CreateManifestoMercanteInput = {
      voyage_id: 10,
      pol: 'CNSHA',
      pod: 'BRVIX',
      numero: '26BR000000001',
      natureza: 'carga',
    }

    const result = await createManifestoMercante(input)
    expect(mockFrom).toHaveBeenCalledWith('manifestos_mercante')
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        voyage_id: 10,
        pol: 'CNSHA',
        pod: 'BRVIX',
        numero: '26BR000000001',
        natureza: 'carga',
      }),
    )
    expect(result.id).toBe('uuid-man-01')
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

  // Mover / Desvincular passam pelas RPCs da migration 180: tudo ou nada e
  // com motivo no Histórico (o UPDATE direto em bls saiu).
  it('move e desvincula B/Ls pelas RPCs, com motivo', async () => {
    mockRpc.mockResolvedValue({ data: { moved: 2 }, error: null })
    await moveBlsToManifestoMercante(['BL-001', 'BL-002'], '1226501860578', 'Reemissão')
    expect(mockRpc).toHaveBeenCalledWith('move_bls_to_manifesto_mercante', { p_bl_ids: ['BL-001', 'BL-002'], p_numero: '1226501860578', p_reason: 'Reemissão' })
    await unlinkBlsFromManifestoMercante(['BL-001'], 'B/L de outro manifesto')
    expect(mockRpc).toHaveBeenCalledWith('unlink_bls_from_manifesto_mercante', { p_bl_ids: ['BL-001'], p_reason: 'B/L de outro manifesto' })
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('normaliza o Nº de Manifesto para a forma canônica', () => {
    expect(canonicalManifestoNumero(' 1226 b01-849.909 ')).toBe('1226B01849909')
  })

})
