import { describe, expect, it } from 'vitest'
import { roleHasPermission, type Permission } from '../useAuth'

const ALL: Permission[] = ['admin_panel', 'manage_users', 'portal_provisioning', 'settle_financial_adjustments', 'cancel_invoices', 'cancel_demurrage_invoices', 'customer_communications', 'edit_customer_contacts']
const EVERY: Permission[] = [...ALL, 'manage_payments', 'ce_unlock_read', 'ce_unlock_manage', 'ce_unlock_documents']
const NAVIGATION: Permission[] = ['admin_panel', 'manage_users', 'portal_provisioning']

describe('matriz RBAC de exceções', () => {
  it('Administrativo mantém painel, usuários e provisionamento', () => {
    for (const permission of ALL) expect(roleHasPermission('administrativo', permission)).toBe(true)
  })
  it('Documentação mantém provisionamento do Portal e Comunicados', () => {
    expect(roleHasPermission('documentacao', 'portal_provisioning')).toBe(true)
    expect(roleHasPermission('documentacao', 'customer_communications')).toBe(true)
    expect(roleHasPermission('documentacao', 'edit_customer_contacts')).toBe(true)
    expect(roleHasPermission('documentacao', 'admin_panel')).toBe(false)
    expect(roleHasPermission('documentacao', 'manage_users')).toBe(false)
  })
  it('Administrativo e Financeiro podem liquidar ajustes financeiros', () => {
    expect(roleHasPermission('administrativo', 'settle_financial_adjustments')).toBe(true)
    expect(roleHasPermission('financeiro', 'settle_financial_adjustments')).toBe(true)
  })
  it('baixa, cancelar baixa, Restituição e Conciliação Pix: só o Financeiro e a conta Dev (migration 583)', () => {
    expect(roleHasPermission('financeiro', 'manage_payments')).toBe(true)
    expect(roleHasPermission('administrativo', 'manage_payments')).toBe(false)
    expect(roleHasPermission('administrativo', 'manage_payments', true)).toBe(true)
    for (const role of ['documentacao', 'operacoes', 'equipamentos'] as const) expect(roleHasPermission(role, 'manage_payments')).toBe(false)
  })
  it('cancelar fatura: Administrativo e Financeiro; cancelar Invoice de Demurrage e Régua: também Equipamentos (migration 583)', () => {
    expect(roleHasPermission('administrativo', 'cancel_invoices')).toBe(true)
    expect(roleHasPermission('financeiro', 'cancel_invoices')).toBe(true)
    expect(roleHasPermission('equipamentos', 'cancel_invoices')).toBe(false)
    for (const role of ['administrativo', 'financeiro', 'equipamentos'] as const) expect(roleHasPermission(role, 'cancel_demurrage_invoices')).toBe(true)
    for (const role of ['documentacao', 'operacoes'] as const) expect(roleHasPermission(role, 'cancel_demurrage_invoices')).toBe(false)
  })
  it('a conta Dev pode tudo; a marca só vale no Administrativo (ADR 0104)', () => {
    for (const permission of EVERY) expect(roleHasPermission('administrativo', permission, true), permission).toBe(true)
    expect(roleHasPermission('documentacao', 'manage_payments', true)).toBe(false)
    expect(roleHasPermission('financeiro', 'admin_panel', true)).toBe(false)
  })
  it('todos disparam Comunicado; só Administrativo, Documentação e Equipamentos editam contatos (ACE-D01, opção A)', () => {
    for (const role of ['administrativo', 'documentacao', 'financeiro', 'operacoes', 'equipamentos'] as const) {
      expect(roleHasPermission(role, 'customer_communications')).toBe(true)
    }
    expect(roleHasPermission('financeiro', 'edit_customer_contacts')).toBe(false)
    expect(roleHasPermission('operacoes', 'edit_customer_contacts')).toBe(false)
    expect(roleHasPermission('equipamentos', 'edit_customer_contacts')).toBe(true)
  })
  it('os demais departamentos não recebem exceções de navegação', () => {
    for (const role of ['financeiro', 'operacoes', 'equipamentos'] as const) {
      for (const permission of NAVIGATION) expect(roleHasPermission(role, permission)).toBe(false)
    }
  })
  it('todos os Departamentos leem o Desbloqueio de CE e os documentos; gerir é de Administrativo e Documentação (ADR 0085, D11)', () => {
    for (const role of ['administrativo', 'documentacao', 'financeiro', 'operacoes', 'equipamentos'] as const) {
      expect(roleHasPermission(role, 'ce_unlock_read')).toBe(true)
      expect(roleHasPermission(role, 'ce_unlock_documents')).toBe(true)
    }
    expect(roleHasPermission('equipamentos', 'ce_unlock_manage')).toBe(false)
    expect(roleHasPermission('documentacao', 'ce_unlock_manage')).toBe(true)
  })
  it('mapeia os papéis legados', () => {
    // O papel `admin` saiu da lista aceita (migration 093); nao herda mais permissao.
    expect(roleHasPermission('admin' as never, 'manage_users')).toBe(false)
    expect(roleHasPermission('operator', 'portal_provisioning')).toBe(true)
  })
})
