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
})
