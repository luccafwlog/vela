// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
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
        onAddContact={vi.fn()}
        onRemoveContact={vi.fn()}
      />,
    )

    expect((screen.getByLabelText('CNPJ') as HTMLInputElement).maxLength).toBe(18)
  })
})
