import { describe, expect, it } from 'vitest'
import { customersNavItems, painelNavItem, reportsNavItem } from '../../components/layout/appLayoutNav'

describe('entrada do provisionamento no contexto de Clientes', () => {
  it('fica no grupo Clientes do menu, não como link solto da barra', () => {
    expect([painelNavItem, reportsNavItem].some((item) => item.to === '/clientes/portal')).toBe(false)
    expect(customersNavItems.some((item) => item.to === '/clientes/portal')).toBe(true)
  })
})
