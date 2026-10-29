// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { roleHasPermission } from '../../../hooks/useAuth'
import type { UserProfileRole } from '../../../types/database'

const mocks = vi.hoisted(() => ({ role: 'documentacao' as string }))

vi.mock('../../../hooks/useAuth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../hooks/useAuth')>()
  return { ...actual, useAuth: () => ({ can: (permission: Parameters<typeof actual.roleHasPermission>[1]) => actual.roleHasPermission(mocks.role as never, permission) }) }
})
vi.mock('../../../hooks/useCustomers', () => ({ useCustomerLookup: () => ({ data: [] }) }))

import { ReviewCustomerForm } from '../ReviewCustomerForm'

function renderForm(role: UserProfileRole) {
  mocks.role = role
  const onOnboard = vi.fn()
  render(<ReviewCustomerForm blCount={1} expectedCnpjs={['11222333000181']} initialName="Alfa" initialCnpj="11222333000181" initialEmail="financeiro@alfa.test" saving={false} onOnboard={onOnboard} onLink={vi.fn()} />)
  return { onOnboard }
}

describe('ReviewCustomerForm — convite do Portal', () => {
  beforeEach(() => vi.clearAllMocks())

  // O servidor (`portal-invite-send`) só aceita Administrativo e Documentação:
  // a tela oferece o convite exatamente a quem tem `portal_provisioning`.
  it('a permissão da tela acompanha a Edge Function', () => {
    expect(roleHasPermission('equipamentos', 'edit_customer_contacts')).toBe(true)
    expect(roleHasPermission('equipamentos', 'portal_provisioning')).toBe(false)
    expect(roleHasPermission('documentacao', 'portal_provisioning')).toBe(true)
    expect(roleHasPermission('administrativo', 'portal_provisioning')).toBe(true)
  })

  it('Equipamentos inclui o e-mail, não vê o convite e cadastra sem convidar', async () => {
    const user = userEvent.setup()
    const { onOnboard } = renderForm('equipamentos')
    expect(screen.getByText('E-mail principal')).toBeTruthy()
    expect(screen.queryByText('Enviar o convite agora')).toBeNull()
    expect(screen.queryByText('Deixar para depois')).toBeNull()
    expect(screen.getByRole('note').textContent).toMatch(/O convite do Portal fica com a Documentação ou o Administrativo/)
    await user.click(screen.getByRole('button', { name: 'Cadastrar e vincular' }))
    expect(onOnboard).toHaveBeenCalledWith(expect.objectContaining({ email: 'financeiro@alfa.test', sendPortalInvite: false }))
  })

  it('Documentação escolhe o Portal antes de cadastrar e pode convidar', async () => {
    const user = userEvent.setup()
    const { onOnboard } = renderForm('documentacao')
    expect((screen.getByRole('button', { name: 'Cadastrar e vincular' }) as HTMLButtonElement).disabled).toBe(true)
    await user.click(screen.getByText('Enviar o convite agora'))
    await user.click(screen.getByRole('button', { name: 'Cadastrar e vincular' }))
    expect(onOnboard).toHaveBeenCalledWith(expect.objectContaining({ email: 'financeiro@alfa.test', sendPortalInvite: true }))
  })
})
