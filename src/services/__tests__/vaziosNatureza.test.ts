import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  fetchVaziosImportacaoContainerIds,
  setContainerUnpackingLocation,
  setVazioImportacaoNatureza,
  setVaziosImportacaoNaturezaMany,
  unpackingReplacements,
} from '../vaziosNatureza'

const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }))

vi.mock('../supabase', () => ({ supabase: { from: mockFrom } }))

beforeEach(() => {
  mockFrom.mockReset()
})

describe('vaziosNatureza', () => {
  it('atualiza a natureza do vazio descarregado', async () => {
    const eq = vi.fn(() => Promise.resolve({ error: null }))
    const update = vi.fn(() => ({ eq }))
    mockFrom.mockReturnValue({ update })

    await setVazioImportacaoNatureza('empty-1', 'cover_plate')

    expect(mockFrom).toHaveBeenCalledWith('vazios_importacao_containers')
    expect(update).toHaveBeenCalledWith({ natureza: 'cover_plate' })
    expect(eq).toHaveBeenCalledWith('id', 'empty-1')
  })

  it('atualiza a natureza de múltiplos vazios em lote com chunking', async () => {
    const inMock = vi.fn(() => Promise.resolve({ error: null }))
    const update = vi.fn(() => ({ in: inMock }))
    mockFrom.mockReturnValue({ update })

    const ids = Array.from({ length: 250 }, (_, i) => `id-${i}`)
    await setVaziosImportacaoNaturezaMany(ids, 'cama')

    expect(mockFrom).toHaveBeenCalledWith('vazios_importacao_containers')
    expect(update).toHaveBeenCalledWith({ natureza: 'cama' })
    expect(inMock).toHaveBeenCalledTimes(2)
    expect(inMock).toHaveBeenNthCalledWith(1, 'id', ids.slice(0, 200))
    expect(inMock).toHaveBeenNthCalledWith(2, 'id', ids.slice(200))
  })

  it('não dispara queries se lista de IDs estiver vazia', async () => {
    await setVaziosImportacaoNaturezaMany([], 'cama')
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('atualiza o local de desova no container compartilhado', async () => {
    const eq = vi.fn(() => Promise.resolve({ error: null }))
    const update = vi.fn(() => ({ eq }))
    mockFrom.mockReturnValue({ update })

    await setContainerUnpackingLocation(42, 'Pátio 3')

    expect(mockFrom).toHaveBeenCalledWith('bl_containers')
    expect(update).toHaveBeenCalledWith({ unpacking_location: 'Pátio 3' })
    expect(eq).toHaveBeenCalledWith('id', 42)
  })

  it('propaga erro de persistência', async () => {
    mockFrom.mockReturnValue({
      update: () => ({ eq: () => Promise.resolve({ error: new Error('db down') }) }),
    })

    await expect(setVazioImportacaoNatureza('empty-1', 'cama')).rejects.toThrow('db down')
  })

  describe('fetchVaziosImportacaoContainerIds ("Selecionar os N do filtro")', () => {
    // Banco de mentira com o max_rows do PostgREST: nenhuma página passa de 1.000.
    function containerTable(total: number) {
      const all = Array.from({ length: total }, (_, i) => ({ id: `c-${String(i).padStart(5, '0')}` }))
      const calls = { order: [] as unknown[][], range: [] as Array<[number, number]>, in: [] as unknown[][] }
      const builder: Record<string, unknown> = {}
      let range: [number, number] = [0, 999]
      Object.assign(builder, {
        select: () => builder,
        or: () => builder,
        eq: () => builder,
        in: (...args: unknown[]) => { calls.in.push(args); return builder },
        order: (...args: unknown[]) => { calls.order.push(args); return builder },
        range: (from: number, to: number) => { range = [from, to]; calls.range.push([from, to]); return builder },
        then: (resolve: (value: unknown) => unknown) => {
          const [from, to] = range
          return resolve({ data: all.slice(from, Math.min(to, from + 999) + 1), error: null })
        },
      })
      return { all, calls, builder }
    }

    it('pagina além de 1.000 ids com ordem estável por id', async () => {
      const table = containerTable(2345)
      mockFrom.mockReturnValue(table.builder)

      const ids = await fetchVaziosImportacaoContainerIds({ pod: 'BRVIT' })

      expect(ids).toHaveLength(2345)
      expect(new Set(ids).size).toBe(2345)
      expect(table.calls.range).toEqual([[0, 999], [1000, 1999], [2000, 2999]])
      expect(table.calls.order.every(([column]) => column === 'id')).toBe(true)
      // POD pelo porto canônico: casa todas as grafias gravadas de Vitória.
      expect(table.calls.in).toContainEqual(['pod', expect.arrayContaining(['BRVIX', 'BRVIT', 'VIX'])])
    })

    it('falha da consulta dos manifestos da Viagem vira erro, não recorte vazio', async () => {
      mockFrom.mockImplementation((table: string) => {
        if (table === 'vazios_importacao_manifests') {
          return { select: () => ({ eq: () => Promise.resolve({ data: null, error: new Error('manifestos fora do ar') }) }) }
        }
        return containerTable(3).builder
      })

      await expect(fetchVaziosImportacaoContainerIds({ voyageId: '7' })).rejects.toThrow('manifestos fora do ar')
    })
  })
})

describe('um local de desova por container físico (ADR 0095, decisão 26)', () => {
  it('aponta o local diferente já gravado no mesmo container de outro B/L da Viagem', () => {
    const rows = [
      { id: 1, bl_id: 'BL-1', container_number: 'CXRU1234567', unpacking_location: null, bl: { voyage_id: 7 } },
      { id: 2, bl_id: 'BL-2', container_number: 'cxru 1234567', unpacking_location: 'Terminal Z', bl: { voyage_id: 7 } },
      { id: 3, bl_id: 'BL-3', container_number: 'CXRU1234567', unpacking_location: 'Terminal Q', bl: { voyage_id: 8 } },
      { id: 4, bl_id: 'BL-4', container_number: 'CXRU7654321', unpacking_location: 'Terminal Y', bl: { voyage_id: 7 } },
    ]
    expect(unpackingReplacements(rows, [1], 'Terminal A')).toEqual([{ containerNumber: 'CXRU1234567', blId: 'BL-2', current: 'Terminal Z' }])
    // O mesmo local (sem diferenciar maiúsculas) não é troca.
    expect(unpackingReplacements(rows, [1], 'terminal z')).toEqual([])
    // Apagar o local gravado também pede confirmação.
    expect(unpackingReplacements(rows, [1], null)).toHaveLength(1)
  })
})
