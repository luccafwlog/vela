import { describe, expect, it } from 'vitest'
import { buildFinancialNavItemsForCounts, financialNavItems, getNavIndicator, primaryNavItems } from '../appLayoutNav'

describe('financial navigation badges', () => {
  it('segrega os três processos e usa badge numérico para revisão de taxas', () => {
    const items = buildFinancialNavItemsForCounts({
      pendingReview: 0,
      chargeReviewRequired: 3,
      readyForBilling: 12,
      openAlerts: 0,
      blsWithoutCustomer: 0,
    })

    expect(items.map((item) => item.to)).toEqual(['/taxas-locais', '/demurrage', '/reconciliacao'])
    expect(financialNavItems.some((item) => item.to === '/relatorios')).toBe(false)
    expect(items.find((item) => item.to === '/taxas-locais')?.badge).toBe(3)
    expect(items.find((item) => item.to === '/taxas-locais')?.alert).toBeUndefined()
    expect(getNavIndicator(items)).toEqual({ type: 'badge', count: 3 })
  })
})

it('não expõe Portal do Cliente na navegação superior', () => {
  expect(primaryNavItems.some((item) => item.to === '/clientes/portal')).toBe(false)
})
