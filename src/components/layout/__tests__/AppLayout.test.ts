import { describe, expect, it } from 'vitest'
import { buildFinancialNavItemsForCounts, buildNavGroups, financialNavItems, getNavIndicator, painelNavItem, reportsNavItem, adminNavItem } from '../appLayoutNav'

const COUNTS = {
  pendingReview: 0,
  chargeReviewRequired: 3,
  readyForBilling: 12,
  openAlerts: 0,
  blsWithoutCustomer: 0,
}

describe('financial navigation badges', () => {
  it('segrega os processos, com Tabelas e Tarifas ao lado das telas que as usam, e badge numérico para revisão de taxas', () => {
    const items = buildFinancialNavItemsForCounts(COUNTS)

    expect(items.map((item) => item.to)).toEqual(['/taxas-locais', '/taxas-locais/tabelas', '/demurrage', '/demurrage/taxas', '/reconciliacao'])
    expect(financialNavItems.some((item) => item.to === '/relatorios')).toBe(false)
    expect(items.find((item) => item.to === '/taxas-locais')?.badge).toBe(3)
    expect(items.find((item) => item.to === '/taxas-locais')?.alert).toBeUndefined()
    expect(getNavIndicator(items)).toEqual({ type: 'badge', count: 3 })
  })
})

it('Provisionamento do Portal fica no grupo Clientes, não como link solto da barra', () => {
  const topLinks = [painelNavItem, reportsNavItem, adminNavItem]
  expect(topLinks.some((item) => item.to === '/clientes/portal')).toBe(false)
  const clientes = buildNavGroups(COUNTS).find((group) => group.id === 'clientes')
  expect(clientes?.items.map((item) => item.to)).toContain('/clientes/portal')
})

it('o número de Alertas abertos aparece no item e no grupo Alertas', () => {
  const alertas = buildNavGroups({ ...COUNTS, openAlerts: 5 }).find((group) => group.id === 'alertas')
  expect(alertas?.items.find((item) => item.to === '/alertas')?.badge).toBe(5)
  expect(getNavIndicator(alertas?.items ?? [])).toEqual({ type: 'badge', count: 5 })
})
