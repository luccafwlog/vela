// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// O módulo importa useCustomers (que puxa o cliente Supabase). Mockamos o hook
// para controlar o lookup e evitar dependência de rede/Supabase no teste.
vi.mock('../../../hooks/useCustomers', () => ({ useCustomerLookup: vi.fn() }))

import { useCustomerLookup } from '../../../hooks/useCustomers'
import { InlineCustomerPicker, InlineFieldEditor } from '../ReviewInlineEditors'

const mockedLookup = vi.mocked(useCustomerLookup)

beforeEach(() => mockedLookup.mockReturnValue({ data: [] } as never))
afterEach(cleanup)

describe('InlineFieldEditor', () => {
  it('inicia com o valor informado e salva o valor atual', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(<InlineFieldEditor type="text" placeholder="CE" initial="ABC" saving={false} onSave={onSave} />)

    const input = screen.getByPlaceholderText('CE') as HTMLInputElement
    expect(input.value).toBe('ABC')
    await user.type(input, '123')
    await user.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(onSave).toHaveBeenCalledWith('ABC123')
  })

  it('valida junto do campo, salva com Enter e desfaz com Escape', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(<InlineFieldEditor type="number" label="Peso" placeholder="Peso (t)" initial="" saving={false} validate={(value) => (Number(value) > 0 ? null : 'Maior que zero.')} onSave={onSave} />)
    const input = screen.getByRole('spinbutton', { name: 'Peso' })
    await user.type(input, '0{Enter}')
    expect(screen.getByRole('alert').textContent).toBe('Maior que zero.')
    expect(onSave).not.toHaveBeenCalled()
    await user.type(input, '{Escape}')
    expect((input as HTMLInputElement).value).toBe('')
    await user.type(input, '3{Enter}')
    expect(onSave).toHaveBeenCalledWith('3')
  })

  it('desabilita o input quando saving', () => {
    render(<InlineFieldEditor type="number" placeholder="Peso" initial="" saving onSave={() => {}} />)
    expect((screen.getByPlaceholderText('Peso') as HTMLInputElement).disabled).toBe(true)
  })
})

describe('InlineCustomerPicker', () => {
  it('não mostra dropdown quando não há resultados', () => {
    mockedLookup.mockReturnValue({ data: [] } as never)
    render(<InlineCustomerPicker saving={false} onSelect={() => {}} />)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('lista resultados e devolve o cliente selecionado', async () => {
    const user = userEvent.setup()
    mockedLookup.mockReturnValue({
      data: [
        { id: 7, name: 'ACME', cnpj_cpf: '11222333000181' },
        { id: 9, name: 'Beta', cnpj_cpf: '99888777000166' },
      ],
    } as never)
    const onSelect = vi.fn()
    render(<InlineCustomerPicker saving={false} onSelect={onSelect} />)

    expect(screen.getByText('ACME')).toBeTruthy()
    await user.click(screen.getByText('Beta'))
    expect(onSelect).toHaveBeenCalledWith({ id: 9, name: 'Beta', cnpj_cpf: '99888777000166' })
  })

  it('navega pelas sugestões com o teclado e compara o CNPJ com o B/L', async () => {
    const user = userEvent.setup()
    mockedLookup.mockReturnValue({
      data: [
        { id: 7, name: 'ACME', cnpj_cpf: '11222333000181' },
        { id: 9, name: 'Beta', cnpj_cpf: '06352972000121' },
      ],
    } as never)
    const onSelect = vi.fn()
    render(<InlineCustomerPicker saving={false} onSelect={onSelect} label="Cliente" expectedCnpjs={['11222333000181']} />)

    expect(screen.getByRole('option', { name: /ACME/ }).textContent).toMatch(/CNPJ confere com o B\/L/)
    expect(screen.getByRole('option', { name: /Beta/ }).textContent).toMatch(/CNPJ diferente do B\/L/)
    const input = screen.getByRole('combobox', { name: 'Cliente' })
    await user.type(input, 'a{ArrowDown}{ArrowDown}{Enter}')
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 9 }))
  })
})
