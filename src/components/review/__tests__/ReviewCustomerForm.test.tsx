// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { roleHasPermission } from '../../../hooks/useAuth'
import type { UserProfileRole } from '../../../types/database'

const mocks = vi.hoisted(() => ({ role: 'documentacao' as string, cnpjLookup: vi.fn() }))

vi.mock('../../../hooks/useAuth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../hooks/useAuth')>()
  return { ...actual, useAuth: () => ({ can: (permission: Parameters<typeof actual.roleHasPermission>[1]) => actual.roleHasPermission(mocks.role as never, permission) }) }
})
vi.mock('../../../hooks/useCustomers', () => ({ useCustomerLookup: () => ({ data: [] }) }))
vi.mock('../../../hooks/useCnpjLookup', () => ({ useCnpjLookup: (cnpj: string | null) => mocks.cnpjLookup(cnpj) }))

import { ReviewCustomerForm } from '../ReviewCustomerForm'

function renderForm(role: UserProfileRole) {
  mocks.role = role
  const onOnboard = vi.fn()
  render(<ReviewCustomerForm blCount={1} expectedCnpjs={['11222333000181']} initialName="Alfa" initialCnpj="11222333000181" initialEmail="financeiro@alfa.test" saving={false} onOnboard={onOnboard} onLink={vi.fn()} />)
  return { onOnboard }
}

describe('ReviewCustomerForm — convite do Portal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.cnpjLookup.mockReturnValue({ data: undefined, isFetching: false })
  })

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

// ADR 0127: a Revisão grava só a razão social; a da Receita vem por sugestão.
describe('ReviewCustomerForm — razão social da Receita', () => {
  const receita = (razao: string, situacao = 'ATIVA', endereco = { nome_fantasia: '', cep: '', endereco: '', cidade: '', uf: '' }) => ({
    isFetching: false,
    data: { status: 'encontrado', data: { cnpj: '11222333000181', razao_social: razao, ...endereco, situacao } },
  })
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.cnpjLookup.mockReturnValue({ data: undefined, isFetching: false })
  })

  it('nome do manifesto diferente: mostra a da Receita e troca só no botão', async () => {
    const user = userEvent.setup()
    mocks.cnpjLookup.mockImplementation((cnpj: string | null) => (cnpj ? receita('ALFA COMERCIO E SERVICOS LTDA', 'INAPTA') : { data: undefined, isFetching: false }))
    const { onOnboard } = renderForm('equipamentos')

    expect(mocks.cnpjLookup).toHaveBeenLastCalledWith('11222333000181')
    expect(screen.getByRole('status').textContent).toBe('Na Receita: ALFA COMERCIO E SERVICOS LTDA. Situação na Receita: INAPTA. Usar a razão social da Receita')
    expect((screen.getByLabelText(/^Razão social/) as HTMLInputElement).value).toBe('Alfa')

    await user.click(screen.getByRole('button', { name: 'Usar a razão social da Receita' }))
    expect((screen.getByLabelText(/^Razão social/) as HTMLInputElement).value).toBe('ALFA COMERCIO E SERVICOS LTDA')
    expect(screen.getByRole('status').textContent).toBe('Razão social conferida na Receita. Situação na Receita: INAPTA.')
    await user.click(screen.getByRole('button', { name: 'Cadastrar e vincular' }))
    expect(onOnboard).toHaveBeenCalledWith(expect.objectContaining({ name: 'ALFA COMERCIO E SERVICOS LTDA', profile: null }))
  })

  // Migration 596: o endereço da Receita vai para o Cliente criado.
  it('mostra o endereço da Receita e o manda no cadastro', async () => {
    const user = userEvent.setup()
    const address = { nome_fantasia: 'ALFA', cep: '29010000', endereco: 'RUA A, 10 - CENTRO', cidade: 'VITORIA', uf: 'ES' }
    mocks.cnpjLookup.mockImplementation((cnpj: string | null) => (cnpj ? receita('ALFA', 'ATIVA', address) : { data: undefined, isFetching: false }))
    const { onOnboard } = renderForm('equipamentos')

    // Tudo o que vai no cadastro aparece antes (ADR 0127): o nome fantasia também.
    expect(screen.getByText('Nome fantasia da Receita, gravado no Cliente novo: ALFA.')).toBeTruthy()
    expect(screen.getByText('Endereço da Receita, gravado no Cliente novo: RUA A, 10 - CENTRO, VITORIA/ES, CEP 29010-000.')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Cadastrar e vincular' }))
    expect(onOnboard).toHaveBeenCalledWith(expect.objectContaining({
      profile: { trade_name: 'ALFA', address: 'RUA A, 10 - CENTRO', city: 'VITORIA', state: 'ES', zip: '29010000' },
    }))
  })

  it('mesmo nome com outra caixa ou acento não vira sugestão', () => {
    mocks.cnpjLookup.mockImplementation((cnpj: string | null) => (cnpj ? receita('ALFA') : { data: undefined, isFetching: false }))
    renderForm('equipamentos')
    expect(screen.getByRole('status').textContent).toBe('Razão social conferida na Receita.')
    expect(screen.queryByRole('button', { name: 'Usar a razão social da Receita' })).toBeNull()
  })

  it('razão social vazia recebe a da Receita uma vez; apagada depois, não volta', async () => {
    const user = userEvent.setup()
    mocks.cnpjLookup.mockImplementation((cnpj: string | null) => (cnpj ? receita('ALFA LTDA') : { data: undefined, isFetching: false }))
    render(<ReviewCustomerForm blCount={1} expectedCnpjs={['11222333000181']} initialName="" initialCnpj="11222333000181" initialEmail="financeiro@alfa.test" saving={false} onOnboard={vi.fn()} onLink={vi.fn()} />)

    const name = screen.getByLabelText(/^Razão social/) as HTMLInputElement
    expect(name.value).toBe('ALFA LTDA')
    await user.clear(name)
    expect(name.value).toBe('')
  })

  it('CNPJ fora dos lidos no B/L não é consultado; consulta indisponível avisa', async () => {
    const user = userEvent.setup()
    mocks.cnpjLookup.mockImplementation((cnpj: string | null) => (cnpj ? { isFetching: false, data: { status: 'indisponivel' } } : { data: undefined, isFetching: false }))
    renderForm('equipamentos')
    expect(screen.getByRole('status').textContent).toBe('Consulta à Receita indisponível agora. Confira a razão social à mão.')

    const cnpj = screen.getByLabelText(/^CNPJ/)
    await user.clear(cnpj)
    await user.type(cnpj, '12345678000195')
    expect(mocks.cnpjLookup).toHaveBeenLastCalledWith(null)
  })
})
