import { beforeEach, describe, expect, it, vi } from 'vitest'

const calls = vi.hoisted(() => ({ select: vi.fn() }))

vi.mock('../../services/supabase', () => {
  const builder: Record<string, unknown> = {}
  Object.assign(builder, {
    select: (arg: string) => { calls.select(arg); return builder },
    range: () => builder, order: () => builder, eq: () => builder, in: () => builder, or: () => builder,
    then: (resolve: (value: { data: unknown[]; error: null; count: number }) => unknown) => resolve({ data: [], error: null, count: 0 }),
  })
  return { supabase: { from: () => builder } }
})

import { customerSummaryFilters, fetchCustomerRows, type CustomerFilters } from '../useCustomers'

const baseFilters: CustomerFilters = { search: '', contactEmail: '', emailStatus: '', blStatus: '', pendingStatus: '', chargeStatus: '', sortKey: 'name', sortDirection: 'asc', page: 0, pageSize: 20 }

/**
 * `bls` aponta duas vezes para `customers` (`customer_id` e
 * `suggested_customer_id`, esta ultima criada na migration 285). Sem nomear a
 * FK, o PostgREST responde `300 Multiple Choices` (PGRST201) e a listagem
 * inteira falha com "Erro ao carregar clientes".
 */
describe('fetchCustomerRows - embed de bls', () => {
  beforeEach(() => calls.select.mockReset())

  it('nomeia a foreign key do cliente efetivo no embed de B/Ls', async () => {
    await fetchCustomerRows(baseFilters, true)
    const select = String(calls.select.mock.calls[0][0])
    expect(select).toContain('bls!bls_customer_id_fkey(id, charge_status)')
    expect(select).not.toMatch(/(?<![\w!])bls\(/)
  })

  it('mantem a foreign key nomeada no INNER JOIN do filtro "com B/Ls"', async () => {
    await fetchCustomerRows({ ...baseFilters, blStatus: 'with' }, true)
    const select = String(calls.select.mock.calls[0][0])
    expect(select).toContain('bls!bls_customer_id_fkey!inner(id, charge_status)')
  })
})

describe('customerSummaryFilters', () => {
  it('ignora paginacao e ordenacao, que nao mudam os KPIs', () => {
    const a = customerSummaryFilters({ ...baseFilters, search: 'acme', page: 3, pageSize: 50, sortKey: 'pendingBalance', sortDirection: 'desc' })
    const b = customerSummaryFilters({ ...baseFilters, search: 'acme', page: 0, pageSize: 20, sortKey: 'name', sortDirection: 'asc' })
    expect(a).toEqual(b)
  })

  it('preserva os filtros que realmente mudam o conjunto somado', () => {
    const scope = customerSummaryFilters({ ...baseFilters, search: 'acme', contactEmail: 'a@b.c', emailStatus: 'with', blStatus: 'without', pendingStatus: 'with' })
    expect(scope).toMatchObject({ search: 'acme', contactEmail: 'a@b.c', emailStatus: 'with', blStatus: 'without', pendingStatus: 'with' })
  })
})
