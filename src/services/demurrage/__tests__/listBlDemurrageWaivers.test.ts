import { beforeEach, describe, expect, it, vi } from 'vitest'

// Registra a consulta montada: o filtro do Cliente é o que separa a dispensa
// do B/L sem Cliente (migration 530) da dispensa de um Cliente.
const query = vi.hoisted(() => ({ calls: [] as Array<[string, ...unknown[]]>, rows: [] as unknown[] }))

vi.mock('../../supabase', () => {
  const builder: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'is', 'in']) {
    builder[method] = (...args: unknown[]) => {
      query.calls.push([method, ...args])
      return builder
    }
  }
  builder.then = (resolve: (value: unknown) => unknown) => resolve({ data: query.rows, error: null })
  return { supabase: { from: (table: string) => { query.calls.push(['from', table]); return builder } } }
})

import { listBlDemurrageWaivers } from '../demurrageContainers'

beforeEach(() => {
  query.calls = []
  query.rows = []
})

describe('dispensas da ficha do B/L (migrations 517 e 530)', () => {
  it('o B/L sem Cliente lê a dispensa sem Cliente', async () => {
    query.rows = [{ id: 9, container_key: 'MSCU1234565', reason: 'B/L importado por engano, sem Cliente', created_at: '2026-10-30T12:00:00Z' }]
    const waivers = await listBlDemurrageWaivers({ voyage_id: 3, customer_id: null, bl_containers: [{ container_number: ' mscu1234565 ' }] })
    expect(query.calls).toContainEqual(['from', 'demurrage_box_waivers'])
    expect(query.calls).toContainEqual(['is', 'customer_id', null])
    expect(query.calls).toContainEqual(['in', 'container_key', ['MSCU1234565']])
    expect(waivers.get('MSCU1234565')?.id).toBe(9)
  })

  it('o B/L com Cliente lê só a dispensa daquele Cliente', async () => {
    await listBlDemurrageWaivers({ voyage_id: 3, customer_id: 7, bl_containers: [{ container_number: 'MSCU1234565' }] })
    expect(query.calls).toContainEqual(['eq', 'customer_id', 7])
    expect(query.calls).not.toContainEqual(['is', 'customer_id', null])
  })

  it('sem Viagem ou sem container, não consulta', async () => {
    expect((await listBlDemurrageWaivers({ voyage_id: null, customer_id: 7, bl_containers: [{ container_number: 'MSCU1234565' }] })).size).toBe(0)
    expect((await listBlDemurrageWaivers({ voyage_id: 3, customer_id: null, bl_containers: [] })).size).toBe(0)
    expect(query.calls).toEqual([])
  })
})
