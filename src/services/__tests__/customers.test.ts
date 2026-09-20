import { describe, expect, it } from 'vitest'
import { mapPendingBalancesByCustomer } from '../customers'

describe('mapPendingBalancesByCustomer', () => {
  it('usa o total canonico de recebiveis locais e demurrage', () => {
    const result = mapPendingBalancesByCustomer([
      { customer_id: 10, local_balance_brl: 40, demurrage_balance_brl: 15, total_balance_brl: 55 },
      { customer_id: 20, local_balance_brl: 75, demurrage_balance_brl: 0, total_balance_brl: 75 },
    ])

    expect(result.get(10)).toBe(55)
    expect(result.get(20)).toBe(75)
  })
})
