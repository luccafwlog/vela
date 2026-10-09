import { describe, expect, it, vi } from 'vitest'

const ranges = vi.hoisted(() => [] as Array<[number, number]>)

// Simula o PostgREST com 120 Clientes: offset além do total responde 416
// (PGRST103) sem linhas nem contagem; qualquer outro intervalo devolve o total.
vi.mock('../../services/supabase', () => {
  const builder: Record<string, unknown> = {}
  let current: [number, number] = [0, 0]
  Object.assign(builder, {
    select: () => builder, order: () => builder, or: () => builder,
    range: (from: number, to: number) => { current = [from, to]; ranges.push(current); return builder },
    then: (resolve: (value: unknown) => unknown) => resolve(
      current[0] > 120
        ? { data: null, count: null, error: { code: 'PGRST103', message: 'Requested range not satisfiable' } }
        : { data: [], count: 120, error: null },
    ),
  })
  return { supabase: { from: () => builder } }
})

import { fetchCustomerRows, type CustomerFilters } from '../useCustomers'

const filters: CustomerFilters = { search: '', contactEmail: '', emailStatus: '', blStatus: '', pendingStatus: '', sortKey: 'name', sortDirection: 'asc', page: 4, pageSize: 50 }

describe('fetchCustomerRows - página além do total', () => {
  it('devolve o total em vez de erro, para a lista recuar à última página', async () => {
    const result = await fetchCustomerRows(filters, true)
    expect(result).toEqual({ rows: [], count: 0, totalCount: 120 })
    expect(ranges).toEqual([[200, 249], [0, 0]])
  })
})
