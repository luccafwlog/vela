import { beforeEach, describe, expect, it, vi } from 'vitest'
import { importCeMercanteEdi, importCeMercanteRows, parseCeMercanteBuffer, partitionRowsByVoyage, type CeMercanteRow } from '../ceMercanteImport'
import { jsonToBuffer } from './testWorkbook'

const { mockFrom, mockRpc } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  mockRpc: vi.fn(),
}))

vi.mock('../supabase', () => ({
  supabase: {
    from: mockFrom,
    rpc: mockRpc,
  },
}))

describe('ceMercanteImport', () => {
  beforeEach(() => {
    mockFrom.mockReset()
    mockRpc.mockReset()
  })

  it('parseia a planilha e rejeita BL duplicado', async () => {
    const buffer = jsonToBuffer([
      { BL: 'BL001', 'CE MERCANTE': '122605051526081' },
      { BL: 'BL001', 'CE MERCANTE': '122605051526082' },
    ])

    const parsed = await parseCeMercanteBuffer(buffer)

    expect(parsed.rows).toHaveLength(1)
    expect(parsed.rows[0]?.ce_mercante).toBe('122605051526081')
    expect(parsed.rowErrors).toHaveLength(1)
    expect(parsed.rowErrors[0]?.message).toContain('BL BL001 repetido')
  })

  it('rejeita CE Mercante com numero de digitos incorreto', async () => {
    const buffer = jsonToBuffer([
      { BL: 'BL001', 'CE MERCANTE': '12345' },
      { BL: 'BL002', 'CE MERCANTE': '122605051526081' },
    ])

    const parsed = await parseCeMercanteBuffer(buffer)

    expect(parsed.rows).toHaveLength(1)
    expect(parsed.rows[0]?.bl_id).toBe('BL002')
    expect(parsed.rowErrors).toHaveLength(1)
    expect(parsed.rowErrors[0]?.message).toContain('CE Mercante invalido para o BL BL001')
    expect(parsed.rowErrors[0]?.message).toContain('15 digitos')
  })

  it('atualiza apenas BLs existentes via RPC', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table !== 'bls') {
        throw new Error(`Tabela nao mockada: ${table}`)
      }

      return {
        select: () => ({
          in: async (_column: string, values: string[]) => ({
            data: values.filter((value) => value === 'BL001').map((value) => ({ id: value })),
            error: null,
          }),
        }),
      }
    })

    mockRpc.mockResolvedValue({ data: 'inserted', error: null })

    const rows: CeMercanteRow[] = [
      { rowNumber: 2, bl_id: 'BL001', ce_mercante: '122605051526081' },
      { rowNumber: 3, bl_id: 'BL999', ce_mercante: '122605051526082' },
    ]

    const result = await importCeMercanteRows(rows)

    expect(result.processed).toBe(2)
    expect(result.updated).toBe(1)
    expect(result.overwritten).toBe(0)
    expect(result.unchanged).toBe(0)
    expect(result.errorCount).toBe(1)
    expect(result.errors[0]?.message).toBe('BL BL999 nao encontrado no sistema.')

    expect(mockRpc).toHaveBeenCalledOnce()
    const [rpcName, rpcArgs] = mockRpc.mock.calls[0] as [string, Record<string, unknown>]
    expect(rpcName).toBe('apply_ce_mercante_update')
    expect(rpcArgs.p_bl_id).toBe('BL001')
    expect(rpcArgs.p_new_ce).toBe('122605051526081')
    expect(mockRpc).toHaveBeenCalledOnce()
  })

  it('resolve o numero do B/L de Granito para UUID e grava pela RPC auditavel sem auto-faturar', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table !== 'granite_bls') throw new Error(`Tabela nao mockada: ${table}`)
      return {
        select: () => ({
          in: async () => ({ data: [{ id: 'uuid-gr1', bl_number: 'GR1', manifest: { voyage_id: 7 } }], error: null }),
        }),
      }
    })
    mockRpc.mockResolvedValue({ data: 'inserted', error: null })

    const result = await importCeMercanteRows(
      [{ rowNumber: 2, bl_id: 'GR1', ce_mercante: '122605051526081' }],
      { changedBy: 'user-1', target: 'granite', voyageId: 7 },
    )

    expect(result).toMatchObject({ processed: 1, updated: 1, errorCount: 0 })
    expect(mockRpc).toHaveBeenCalledWith('apply_granite_ce_mercante_update', {
      p_bl_id: 'uuid-gr1', p_new_ce: '122605051526081', p_changed_by: 'user-1',
    })
  })

  it('conta CE de Granito unchanged sem incrementar updated', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table !== 'granite_bls') throw new Error(`Tabela nao mockada: ${table}`)
      return {
        select: () => ({
          in: async () => ({ data: [{ id: 'uuid-gr1', bl_number: 'GR1', manifest: { voyage_id: 7 } }], error: null }),
        }),
      }
    })
    mockRpc.mockResolvedValue({ data: 'unchanged', error: null })
    const result = await importCeMercanteRows(
      [{ rowNumber: 2, bl_id: 'GR1', ce_mercante: '122605051526081' }],
      { changedBy: null, target: 'granite', voyageId: 7 },
    )
    expect(result).toMatchObject({ processed: 1, updated: 0, unchanged: 1, overwritten: 0, errorCount: 0 })
  })

  it('reporta B/L de Granito inexistente e ambiguo sem derrubar o lote', async () => {
    mockFrom.mockImplementation(() => ({
      select: () => ({
        in: async () => ({ data: [
          { id: 'uuid-a', bl_number: 'AMB', manifest: { voyage_id: 7 } },
          { id: 'uuid-b', bl_number: 'AMB', manifest: { voyage_id: 7 } },
        ], error: null }),
      }),
    }))
    const result = await importCeMercanteRows([
      { rowNumber: 2, bl_id: 'MISSING', ce_mercante: '122605051526081' },
      { rowNumber: 3, bl_id: 'AMB', ce_mercante: '122605051526082' },
    ], { changedBy: null, target: 'granite', voyageId: 7 })
    expect(result.errorCount).toBe(2)
    expect(result.errors.map((error) => error.message)).toEqual(expect.arrayContaining([
      'B/L MISSING nao encontrado no manifesto de granito.',
      'B/L AMB ambiguo: mais de um B/L no manifesto de granito.',
    ]))
    expect(mockRpc).not.toHaveBeenCalled()
  })

  it('separa BLs de outra viagem sem antecipar o erro de BL inexistente', async () => {
    mockFrom.mockImplementation(() => ({
      select: () => ({
        in: async () => ({
          data: [
            { id: 'BL001', voyage_id: 7 },
            { id: 'BL002', voyage_id: 8 },
          ],
          error: null,
        }),
      }),
    }))
    const rows: CeMercanteRow[] = [
      { rowNumber: 2, bl_id: 'BL001', ce_mercante: '122605051526081' },
      { rowNumber: 3, bl_id: 'BL002', ce_mercante: '122605051526082' },
      { rowNumber: 4, bl_id: 'BL999', ce_mercante: '122605051526083' },
    ]

    await expect(partitionRowsByVoyage(rows, 7)).resolves.toEqual({
      rows: [rows[0], rows[2]],
      blocked: [{ row: 3, bl_id: 'BL002', message: 'B/L BL002 pertence a outra viagem' }],
    })
  })

  it('nao tenta uma segunda operacao quando a aplicacao do CE falha', async () => {
    mockFrom.mockImplementation(() => ({
      select: () => ({
        in: async () => ({ data: [{ id: 'BL001' }], error: null }),
      }),
    }))
    mockRpc.mockResolvedValue({ data: null, error: { message: 'CE invalido' } })

    const result = await importCeMercanteRows([
      { rowNumber: 2, bl_id: 'BL001', ce_mercante: '122605051526081' },
    ])

    expect(result.errorCount).toBe(1)
    expect(mockRpc).toHaveBeenCalledOnce()
  })

  it('deixa o efeito de billing persistido para o import CE por EDI', async () => {
    mockRpc.mockResolvedValue({
      data: { ok: true, batch_id: 10, processed: 2, inserted: 2, overwritten: 0, unchanged: 0 },
      error: null,
    })

    const result = await importCeMercanteEdi([
      { lineNumber: 1, bl_id: 'BL001', ce_mercante: '122605051526081' },
      { lineNumber: 2, bl_id: 'BL002', ce_mercante: '122605051526082' },
    ], { changedBy: 'user-1' })

    expect(result).toMatchObject({ ok: true, batchId: 10, processed: 2 })
    expect(mockRpc).toHaveBeenCalledOnce()
  })

  it('cria e vincula o manifesto Mercante informado aos BLs atualizados', async () => {
    const bl = {
      id: 'BL001',
      voyage_id: 7,
      pol: 'CNTAC',
      pod: 'BRVIX',
      manifesto_mercante_id: null,
    }
    const insertManifesto = vi.fn(() => ({
      select: vi.fn(() => ({
        single: vi.fn().mockResolvedValue({
          data: { ...bl, id: 'manifesto-1', numero: '26BR000001', natureza: 'carga' },
          error: null,
        }),
      })),
    }))
    const updateBls = vi.fn(() => ({ in: vi.fn().mockResolvedValue({ error: null }) }))

    mockFrom.mockImplementation((table: string) => {
      if (table === 'bls') {
        return {
          select: vi.fn((columns: string) => ({
            in: vi.fn().mockResolvedValue({
              data: columns === 'id' ? [{ id: 'BL001' }] : [bl],
              error: null,
            }),
          })),
          update: updateBls,
        }
      }
      if (table === 'manifestos_mercante') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({ maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) })),
          })),
          insert: insertManifesto,
        }
      }
      throw new Error(`Tabela nao mockada: ${table}`)
    })
    mockRpc.mockResolvedValue({ data: 'inserted', error: null })

    const result = await importCeMercanteRows(
      [{ rowNumber: 2, bl_id: 'BL001', ce_mercante: '122605051526081' }],
      { changedBy: 'user-1', voyageId: 7, manifestoNumero: '26BR000001' },
    )

    expect(result).toMatchObject({ updated: 1, errorCount: 0 })
    expect(insertManifesto).toHaveBeenCalledWith({
      voyage_id: 7,
      pol: 'CNTAC',
      pod: 'BRVIX',
      numero: '26BR000001',
      natureza: 'carga',
    })
    expect(updateBls).toHaveBeenCalledWith({ manifesto_mercante_id: 'manifesto-1' })
  })
})
