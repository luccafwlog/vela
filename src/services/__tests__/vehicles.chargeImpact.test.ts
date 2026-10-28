import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rows: [] as Array<{ id: number; bl_id: string | null }>, inCalls: [] as number[][] }))

vi.mock('../supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        in: async (_column: string, ids: number[]) => {
          mocks.inCalls.push(ids)
          return { data: mocks.rows.filter((row) => ids.includes(row.id)), error: null }
        },
      }),
    }),
  },
}))

import { vehicleChargeImpactChanges } from '../vehicles'

// ADR 0111, D6 (revisão da PR luccafwlog/vela#1080): a seleção da página
// Veículos passa das páginas da lista; a prévia da taxa alterada à mão precisa
// de todos os veículos selecionados, não só dos que estão na tela.
describe('vehicleChargeImpactChanges', () => {
  beforeEach(() => {
    mocks.inCalls = []
    // Veículos de três páginas, em dois B/Ls; um sem B/L.
    mocks.rows = [
      { id: 1, bl_id: 'BL-A' }, { id: 25, bl_id: 'BL-B' }, { id: 47, bl_id: 'BL-A' }, { id: 60, bl_id: null },
    ]
  })

  it('exclusão: agrupa pelo B/L de origem lido do banco', async () => {
    await expect(vehicleChargeImpactChanges([1, 25, 47, 60])).resolves.toEqual([
      { bl_id: 'BL-A', remove_vehicle_ids: [1, 47] },
      { bl_id: 'BL-B', remove_vehicle_ids: [25] },
    ])
    expect(mocks.inCalls).toEqual([[1, 25, 47, 60]])
  })

  it('mover: cada B/L de origem leva os seus veículos para o destino', async () => {
    await expect(vehicleChargeImpactChanges([25, 47], 'BL-C')).resolves.toEqual([
      { bl_id: 'BL-B', move_vehicles: [{ id: 25, to_bl_id: 'BL-C' }] },
      { bl_id: 'BL-A', move_vehicles: [{ id: 47, to_bl_id: 'BL-C' }] },
    ])
  })
})
