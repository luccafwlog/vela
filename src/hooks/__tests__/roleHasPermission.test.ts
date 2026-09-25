import { describe, expect, it } from 'vitest'
import { roleHasPermission, type Permission } from '../useAuth'

const ALL: Permission[] = ['admin_panel', 'manage_users', 'portal_provisioning', 'settle_financial_adjustments', 'customer_communications']
const NAVIGATION: Permission[] = ['admin_panel', 'manage_users', 'portal_provisioning']

describe('matriz RBAC de exceções', () => {
  it('Administrativo mantém painel, usuários e provisionamento', () => {
    for (const permission of ALL) expect(roleHasPermission('administrativo', permission)).toBe(true)
  })
  it('Documentação mantém provisionamento do Portal e Comunicados', () => {
    expect(roleHasPermission('documentacao', 'portal_provisioning')).toBe(true)
    expect(roleHasPermission('documentacao', 'customer_communications')).toBe(true)
    expect(roleHasPermission('documentacao', 'admin_panel')).toBe(false)
    expect(roleHasPermission('documentacao', 'manage_users')).toBe(false)
  })
  it('Administrativo e Financeiro podem liquidar ajustes financeiros', () => {
    expect(roleHasPermission('administrativo', 'settle_financial_adjustments')).toBe(true)
    expect(roleHasPermission('financeiro', 'settle_financial_adjustments')).toBe(true)
  })
  it('Financeiro e Operações não recebem Comunicados; Equipamentos recebe', () => {
    expect(roleHasPermission('financeiro', 'customer_communications')).toBe(false)
    expect(roleHasPermission('operacoes', 'customer_communications')).toBe(false)
    expect(roleHasPermission('equipamentos', 'customer_communications')).toBe(true)
  })
  it('os demais departamentos não recebem exceções de navegação', () => {
    for (const role of ['financeiro', 'operacoes', 'equipamentos'] as const) {
      for (const permission of NAVIGATION) expect(roleHasPermission(role, permission)).toBe(false)
    }
  })
  it('mapeia os papéis legados', () => {
    // O papel `admin` saiu da lista aceita (migration 093); nao herda mais permissao.
    expect(roleHasPermission('admin' as never, 'manage_users')).toBe(false)
    expect(roleHasPermission('operator', 'portal_provisioning')).toBe(true)
  })
})
