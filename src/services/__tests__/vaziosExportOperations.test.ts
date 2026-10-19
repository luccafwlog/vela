import { describe, expect, it, vi } from 'vitest'

const pages = vi.hoisted(() => ({ rows: {} as Record<string, unknown[]>, ranges: [] as Array<[string, number, number]> }))
vi.mock('../supabase', () => ({
  supabase: {
    from: (table: string) => {
      const builder = {
        select: () => builder,
        order: () => builder,
        range: (from: number, to: number) => {
          pages.ranges.push([table, from, to])
          return Promise.resolve({ data: (pages.rows[table] ?? []).slice(from, to + 1), error: null })
        },
      }
      return builder
    },
  },
}))

import { computeStorageTotals, listVaziosExportOperationsWithUnits, summarizeVaziosOperations } from '../vaziosExportOperations'

describe('computeStorageTotals', () => {
  it('soma containers e dias derivados de hand-in/hand-out', () => {
    expect(computeStorageTotals([{ local_id: 'd1', condition: 'vazio', hand_in_date: '2026-07-01', hand_out_date: '2026-07-05' }, { local_id: 'd1', condition: 'vazio', hand_in_date: '2026-07-02', hand_out_date: '2026-07-02' }, { local_id: 'd1', condition: 'vazio', hand_in_date: null, hand_out_date: null }], [{ id: 'd1', tipo: 'depot', free_time_vazio_days: 0, free_time_material_days: 0 }])).toEqual({ containers: 2, days: 6 })
  })
  it('ignora datas inválidas ou negativas', () => {
    expect(computeStorageTotals([{ local_id: 'd1', condition: 'vazio', hand_in_date: 'x', hand_out_date: '2026-07-05' }, { local_id: 'd1', condition: 'vazio', hand_in_date: '2026-07-05', hand_out_date: '2026-07-01' }, { local_id: 'd1', condition: 'vazio', hand_in_date: '2026-07-01', hand_out_date: '2026-07-03' }], [{ id: 'd1', tipo: 'depot' }])).toEqual({ containers: 1, days: 3 })
  })
})

describe('summarizeVaziosOperations (lista de embarques)', () => {
  const depots = [
    { id: 'd1', tipo: 'depot', free_time_vazio_days: 2, free_time_material_days: 0 },
    { id: 'd2', tipo: 'depot', free_time_vazio_days: 30, free_time_material_days: 30 },
  ]
  const operation = (id: string, updated: string, linhas: Array<Record<string, unknown>> = []) => ({
    id, voyage_id: 1, embark_port: 'BRVIX', created_at: updated, updated_at: updated, voyage: null,
    linhas: linhas as never,
  })

  it('conta unidades, soma os serviços e os locais com armazenagem a lançar (sem 0 dia), do mais recente para o mais antigo', () => {
    const summary = summarizeVaziosOperations(
      [
        operation('antigo', '2026-09-01T00:00:00Z'),
        operation('novo', '2026-10-01T00:00:00Z', [{ local_id: 'd1', condition: null, quantidade: 3, valor_unitario: 10, quantidade_manual: true, service: { natureza: 'geral' } }]),
      ],
      [
        { operation_id: 'novo', local_id: 'd1', condition: 'vazio', hand_in_date: '2026-09-01', hand_out_date: '2026-09-05', created_at: null },
        // Dentro do free time: 0 dia, não conta como armazenagem a lançar.
        { operation_id: 'novo', local_id: 'd2', condition: 'vazio', hand_in_date: '2026-09-01', hand_out_date: '2026-09-05', created_at: null },
        { operation_id: 'antigo', local_id: 'd2', condition: 'vazio', hand_in_date: '2026-09-01', hand_out_date: '2026-09-05', created_at: '2026-10-10T00:00:00Z' },
      ],
      depots,
    )
    // A unidade gravada em 10/10 torna o embarque "antigo" o mais recente.
    expect(summary.map((item) => item.id)).toEqual(['antigo', 'novo'])
    expect(summary[1]).toMatchObject({ unidades: 2, servicos: 30, armazenagemLocais: 1 })
    expect(summary[0]).toMatchObject({ unidades: 1, servicos: 0, armazenagemLocais: 0, atualizadoEm: '2026-10-10T00:00:00Z' })
  })
})

describe('listVaziosExportOperationsWithUnits', () => {
  it('lê os embarques em páginas, sem perder os além de 1.000', async () => {
    pages.rows.vazios_export_operations = Array.from({ length: 1001 }, (_, index) => ({ id: `op-${index}` }))
    pages.rows.vazios_bookings = []
    const { operations } = await listVaziosExportOperationsWithUnits()
    expect(operations).toHaveLength(1001)
    expect(operations.at(-1)).toMatchObject({ id: 'op-1000' })
    expect(pages.ranges.filter(([table]) => table === 'vazios_export_operations')).toEqual([
      ['vazios_export_operations', 0, 999],
      ['vazios_export_operations', 1000, 1999],
    ])
  })
})
