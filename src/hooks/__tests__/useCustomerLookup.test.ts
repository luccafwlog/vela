import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  or: vi.fn(),
}))

vi.mock('../../services/supabase', () => ({
  supabase: { from: mocks.from },
}))

import { fetchCustomerLookup } from '../useCustomers'

describe('fetchCustomerLookup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    const result = Promise.resolve({ data: [], error: null })
    const query = {
      select: vi.fn(),
      or: mocks.or,
      order: vi.fn(),
      range: vi.fn(),
      is: vi.fn(),
      then: result.then.bind(result),
    }
    query.select.mockReturnValue(query)
    query.or.mockReturnValue(query)
    query.order.mockReturnValue(query)
    query.range.mockReturnValue(query)
    query.is.mockReturnValue(query)
    mocks.from.mockReturnValue(query)
  })

  it('does not query Supabase when structural input sanitizes to an empty term', async () => {
    await expect(fetchCustomerLookup('%%')).resolves.toEqual([])

    expect(mocks.from).not.toHaveBeenCalled()
    expect(mocks.or).not.toHaveBeenCalled()
  })

  it('escapes structural input before building the PostgREST filter', async () => {
    await fetchCustomerLookup('ACME,ME')

    expect(mocks.or).toHaveBeenCalledWith('name.ilike.%ACME ME%,cnpj_cpf.ilike.%ACME ME%')
    expect(mocks.from.mock.results[0]?.value.select).toHaveBeenCalledWith('id, cnpj_cpf, name, city, state, customer_contacts(email)')
  })
})
