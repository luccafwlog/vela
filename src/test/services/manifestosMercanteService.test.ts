import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockFrom = vi.fn()

vi.mock('../../services/supabase', () => ({
  supabase: {
    from: (table: string) => mockFrom(table),
  },
}))

import {
  createManifestoMercante,
  deleteManifestoMercante,
  linkBlToManifestoMercante,
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
        numero: '26BR0001',
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
        numero: '26BR0001',
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
      numero: '26BR0001',
      natureza: 'carga',
    }

    const result = await createManifestoMercante(input)
    expect(mockFrom).toHaveBeenCalledWith('manifestos_mercante')
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        voyage_id: 10,
        pol: 'CNSHA',
        pod: 'BRVIX',
        numero: '26BR0001',
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
        numero: '26BR0001',
        natureza: 'carga',
        created_at: '2026-06-01T10:00:00Z',
      },
      {
        id: 'man-2',
        voyage_id: 10,
        pol: 'CNSHA',
        pod: 'BRVIX',
        numero: '26BR0002',
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

  it('vincula B/L ao manifesto mercante e permite desvinculo', async () => {
    const eqMock = vi.fn().mockResolvedValue({ error: null })
    const updateMock = vi.fn().mockReturnValue({ eq: eqMock })
    mockFrom.mockReturnValue({ update: updateMock })

    await linkBlToManifestoMercante('BL-001', 'uuid-man-01')
    expect(mockFrom).toHaveBeenCalledWith('bls')
    expect(updateMock).toHaveBeenCalledWith({ manifesto_mercante_id: 'uuid-man-01' })
    expect(eqMock).toHaveBeenCalledWith('id', 'BL-001')

    // Desvinculo (passando null)
    await linkBlToManifestoMercante('BL-001', null)
    expect(updateMock).toHaveBeenCalledWith({ manifesto_mercante_id: null })
  })

  it('exclui manifesto mercante por id', async () => {
    const eqMock = vi.fn().mockResolvedValue({ error: null })
    const deleteMock = vi.fn().mockReturnValue({ eq: eqMock })
    mockFrom.mockReturnValue({ delete: deleteMock })

    await deleteManifestoMercante('uuid-man-01')
    expect(mockFrom).toHaveBeenCalledWith('manifestos_mercante')
    expect(deleteMock).toHaveBeenCalled()
    expect(eqMock).toHaveBeenCalledWith('id', 'uuid-man-01')
  })
})
