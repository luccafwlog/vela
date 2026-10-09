// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CreateCustomerModal } from '../CreateCustomerModal'
import { emptyCreateCustomerForm } from '../customerCreateForm'

describe('CreateCustomerModal', () => {
  it('aceita a colagem de um CNPJ formatado completo', () => {
    render(
      <CreateCustomerModal
        open
        form={emptyCreateCustomerForm}
        errors={{}}
        saving={false}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        onFieldChange={vi.fn()}
        onContactChange={vi.fn()}
        onSetPrimary={vi.fn()}
        onAddContact={vi.fn()}
        onRemoveContact={vi.fn()}
      />,
    )

    expect((screen.getByLabelText(/^CNPJ/) as HTMLInputElement).maxLength).toBe(18)
  })

  it('o principal é único (rádio) e recebe todas as caixas', () => {
    const onSetPrimary = vi.fn()
    const form = { ...emptyCreateCustomerForm, contacts: [emptyCreateCustomerForm.contacts[0], { ...emptyCreateCustomerForm.contacts[0], _id: 'b', is_primary: false, box_codes: ['documentacao_operacao' as const] }] }
    render(
      <CreateCustomerModal
        open
        form={form}
        errors={{ contacts: 'O contato principal precisa de um e-mail válido.' }}
        saving={false}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        onFieldChange={vi.fn()}
        onContactChange={vi.fn()}
        onSetPrimary={onSetPrimary}
        onAddContact={vi.fn()}
        onRemoveContact={vi.fn()}
      />,
    )
    const radios = screen.getAllByRole('radio', { name: 'Contato principal' }) as HTMLInputElement[]
    expect(radios.map((radio) => radio.checked)).toEqual([true, false])
    fireEvent.click(radios[1])
    expect(onSetPrimary).toHaveBeenCalledWith(1)
    // As caixas do principal ficam marcadas e travadas; o erro aparece junto dos contatos.
    const primaryBoxes = screen.getAllByRole('checkbox').slice(0, 3) as HTMLInputElement[]
    expect(primaryBoxes.every((box) => box.checked && box.disabled)).toBe(true)
    expect(screen.getByRole('alert').textContent).toContain('O contato principal precisa de um e-mail válido.')
  })
})
