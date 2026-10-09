// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ReviewCustomerOnboarding } from '../ReviewCustomerOnboarding'
import type { ReviewGroup } from '../../../pages/revisaoHelpers'

const reviewOnboardingMocks = vi.hoisted(() => ({
  lookupCustomer: { id: 7, name: 'Cliente Existente', cnpj_cpf: '11222333000181', customer_contacts: [{ email: 'financeiro@existente.com' }] },
}))
vi.mock('../../../hooks/useCustomers', () => ({ useCustomerLookup: () => ({ data: [reviewOnboardingMocks.lookupCustomer] }) }))

const group = { key: 'document:11222333000181', cnpj: '11222333000181', displayName: 'Alfa', identityKind: 'document', candidateCnpjs: ['11222333000181'], canBulkOnboard: true, items: [{ id: 'BL1', source: 'bl', customer_id: null }] } as never as ReviewGroup

function renderForm(onSubmit = vi.fn()) {
  return { onSubmit, ...render(<ReviewCustomerOnboarding group={group} existingCustomerId={null} existingCustomer={null} initialName="Alfa" initialCnpj="11222333000181" initialEmail="" saving={false} onSelectExistingCustomer={vi.fn()} onSubmit={onSubmit} />) }
}

describe('ReviewCustomerOnboarding', () => {
  it('exige e-mail e mantém o convite desmarcado por padrão', () => {
    renderForm()
    expect(screen.getByText('E-mail principal do cliente')).toBeTruthy()
    expect(screen.getByText(/Opcional — você poderá iniciar o convite depois/)).toBeTruthy()
    expect(screen.queryByText('Informe um CNPJ válido para liberar o vínculo.')).toBeNull()
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false)
    expect((screen.getByRole('button', { name: /criar cliente e vincular 1 b\/l$/i }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('envia o convite somente após a seleção explícita, para o mesmo e-mail', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderForm()
    await user.type(screen.getByPlaceholderText('financeiro@cliente.com.br'), ' Financeiro@Example.com ')
    expect((screen.getByRole('button', { name: /criar cliente e vincular 1 b\/l$/i }) as HTMLButtonElement).disabled).toBe(false)
    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: /criar cliente e vincular 1 b\/l$/i }))
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ email: 'financeiro@example.com', sendPortalInvite: true }))
  })

  it('preenche o e-mail conhecido ao selecionar um cliente existente', async () => {
    const user = userEvent.setup()
    renderForm()
    await user.type(screen.getByLabelText('Buscar cliente cadastrado'), 'Cliente')
    const option = screen.getByRole('option', { name: /Cliente Existente/ })
    expect(option.textContent).toMatch(/CNPJ confere com o B\/L/)
    await user.click(option)

    expect((screen.getByPlaceholderText('financeiro@cliente.com.br') as HTMLInputElement).value).toBe('financeiro@existente.com')
    expect(screen.getByRole('button', { name: /adicionar e-mail e vincular 1 b\/l$/i })).toBeTruthy()
    expect(screen.getByText(/O B\/L passa a Cliente Existente/)).toBeTruthy()
  })

  it('diz por que não deixa salvar e o efeito de criar um cliente novo', async () => {
    const user = userEvent.setup()
    renderForm()
    const submit = screen.getByRole('button', { name: /criar cliente e vincular 1 b\/l$/i })
    expect(submit.getAttribute('aria-describedby')).toBeTruthy()
    expect(screen.getByText('Informe um e-mail válido.')).toBeTruthy()
    expect(screen.getByText(/Cliente novo ainda não tem Portal ativo/)).toBeTruthy()

    // CNPJ fora das evidências: o erro fica junto do campo.
    const cnpj = screen.getByPlaceholderText('00.000.000/0000-00')
    await user.clear(cnpj)
    await user.type(cnpj, '06352972000121')
    expect(screen.getByText(/06\.352\.972\/0001-21 não aparece no B\/L/)).toBeTruthy()
    expect(screen.getByText('O CNPJ precisa ser um dos lidos no B/L.')).toBeTruthy()
  })

  it('aplica o CNPJ escolhido nas evidências', () => {
    const { rerender } = renderForm()
    const conflict = { ...group, identityKind: 'conflict', candidateCnpjs: ['11222333000181', '06352972000121'] } as never as ReviewGroup
    rerender(<ReviewCustomerOnboarding group={conflict} existingCustomerId={null} existingCustomer={null} initialName="Alfa" initialCnpj="" initialEmail="" saving={false} proposedCnpj={{ cnpj: '06352972000121', seq: 1 }} onSelectExistingCustomer={vi.fn()} onSubmit={vi.fn()} />)
    expect((screen.getByPlaceholderText('00.000.000/0000-00') as HTMLInputElement).value).toBe('06.352.972/0001-21')
  })
})
