import { beforeEach, describe, expect, it, vi } from 'vitest'

// Uma resposta por tabela; a classificação do banco vem pela RPC. O grupo todo
// dispensado nem volta da classificação (migration 531), por isso a ficha do
// Cliente lê `demurrage_box_waivers` direto.
const db = vi.hoisted(() => ({ tables: {} as Record<string, unknown[]>, filters: [] as Array<[string, string, ...unknown[]]> }))

vi.mock('../../supabase', () => {
  const builderFor = (table: string) => {
    const builder: Record<string, unknown> = {}
    for (const method of ['select', 'eq', 'is', 'in', 'order', 'range']) {
      builder[method] = (...args: unknown[]) => {
        db.filters.push([table, method, ...args])
        return builder
      }
    }
    builder.then = (resolve: (value: unknown) => unknown) => resolve({ data: db.tables[table] ?? [], error: null })
    return builder
  }
  return { supabase: { from: builderFor, rpc: async () => ({ data: [], error: null }) } }
})

vi.mock('../demurrageRates', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../demurrageRates')>()),
  ensureDemurrageRatesLoaded: async () => undefined,
}))

import { listCustomerContainers } from '../customerContainers'

const container = (id: number, number: string, voyageId: number) => ({
  id, bl_id: `BL-${id}`, container_number: number, type: '40HC', discharge_date: '2026-09-01', return_date: '2026-09-28', demurrage_status: 'returned', ownership: 'COC',
  bl: { id: `BL-${id}`, voyage_id: voyageId, customer_id: 7, cancelled_at: null, voyage: null, customer: null },
})

beforeEach(() => {
  db.tables = {}
  db.filters = []
})

describe('aba Contêineres da ficha do Cliente lê a dispensa da cobrança', () => {
  it('marca a caixa dispensada pela Viagem e pelo número, só a do Cliente e viva', async () => {
    db.tables.bl_containers = [container(1, ' mscu1234565 ', 3), container(2, 'MSCU1234565', 4), container(3, 'TGHU7654321', 3)]
    db.tables.demurrage_box_waivers = [{ voyage_id: 3, container_key: 'MSCU1234565' }]
    const rows = await listCustomerContainers(7)
    expect(rows.map((row) => [row.id, row.waived])).toEqual([[1, true], [2, false], [3, false]])
    expect(db.filters).toContainEqual(['demurrage_box_waivers', 'eq', 'customer_id', 7])
    expect(db.filters).toContainEqual(['demurrage_box_waivers', 'is', 'revoked_at', null])
  })
})
