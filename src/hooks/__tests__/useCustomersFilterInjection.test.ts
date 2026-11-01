import { beforeEach, describe, expect, it, vi } from 'vitest'

const calls = vi.hoisted(() => ({ or: vi.fn() }))

vi.mock('../../services/supabase', () => {
  const builder: Record<string, unknown> = {}
  Object.assign(builder, {
    select: () => builder, range: () => builder, order: () => builder, eq: () => builder, in: () => builder,
    or: (arg: string) => { calls.or(arg); return builder },
    then: (resolve: (value: { data: unknown[]; error: null; count: number }) => unknown) => resolve({ data: [], error: null, count: 0 }),
  })
  return { supabase: { from: () => builder } }
})

import { fetchCustomerRows, type CustomerFilters } from '../useCustomers'

const baseFilters: CustomerFilters = { search: 'ACME,ME', contactEmail: '', emailStatus: '', blStatus: '', pendingStatus: '', chargeStatus: '', sortKey: 'name', sortDirection: 'asc', page: 0, pageSize: 20 }

describe('fetchCustomerRows - injeção de filtro PostgREST', () => {
  beforeEach(() => calls.or.mockReset())
  it('escapa metacaracteres de filtro no termo de busca', async () => {
    await fetchCustomerRows(baseFilters, true)
    expect(calls.or).toHaveBeenCalledWith('name.ilike.%ACME ME%,trade_name.ilike.%ACME ME%,cnpj_cpf.ilike.%ACME ME%')
  })
  it('não adiciona filtro quando o termo vira vazio', async () => {
    await fetchCustomerRows({ ...baseFilters, search: '%%' }, true)
    expect(calls.or).not.toHaveBeenCalled()
  })
})
