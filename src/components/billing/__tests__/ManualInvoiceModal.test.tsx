// @vitest-environment jsdom

import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  confirm: vi.fn(),
  listBlSuggestions: vi.fn(),
  mutateAsync: vi.fn(),
  onClose: vi.fn(),
  showToast: vi.fn(),
}))

const customers = [
  { id: 1, name: 'AC COMERCIAL IMPORTADORA E EXPORTADORA LTDA', cnpj_cpf: '07415554000956' },
]

vi.mock('../../../hooks/useBilling', () => ({
  useBillingCustomers: () => ({ data: customers }),
  useCreateManualInvoice: () => ({ mutateAsync: mocks.mutateAsync, isPending: false }),
}))

vi.mock('../../../services/billing', () => ({
  listBlSuggestions: mocks.listBlSuggestions,
}))

vi.mock('../../../services/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: vi.fn().mockResolvedValue({ data: { voyage_id: 42 }, error: null }),
        }),
      }),
    }),
  },
}))

vi.mock('../../ui/Toast', () => ({
  useToast: () => ({ showToast: mocks.showToast }),
}))

vi.mock('../../ui/ConfirmDialog', () => ({
  useConfirm: () => mocks.confirm,
}))

vi.mock('../../ui/Combobox', () => ({
  Combobox: ({
    label,
    disabled,
    onSelectOption,
    onValueChange,
  }: {
    label: string
    disabled?: boolean
    onSelectOption?: (option: { value: string; label: string }) => void
    onValueChange: (value: string) => void
  }) => (
    <div>
      <label>
        {label}
        <input
          aria-label={label}
          disabled={disabled}
          onChange={(event) => onValueChange(event.target.value)}
        />
      </label>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onSelectOption?.({ value: 'BL-1', label: 'BL-1' })}
      >
        BL-1
      </button>
    </div>
  ),
}))

vi.mock('../../shared/VoyageCombobox', () => ({
  VoyageCombobox: ({ onSelect }: { onSelect: (voyageId: number | null) => void }) => (
    <div>
      <label>
        Navio / Viagem
        <input aria-label="Navio / Viagem" />
      </label>
      <button type="button" onClick={() => onSelect(42)}>Viagem 42</button>
    </div>
  ),
}))

import { ManualInvoiceModal } from '../ManualInvoiceModal'

afterEach(cleanup)

beforeEach(() => {
  mocks.confirm.mockReset().mockResolvedValue(true)
  mocks.listBlSuggestions.mockReset().mockResolvedValue([])
  mocks.mutateAsync.mockReset().mockResolvedValue({
    invoice_id: 42,
    invoice_number: 'INV-42',
    invoice_type: 'manual',
    status: 'issued',
    total_brl: 20,
    balance_brl: 20,
    bl_id: null,
    voyage_id: null,
  })
  mocks.onClose.mockReset()
  mocks.showToast.mockReset()
})

function openModal() {
  render(<ManualInvoiceModal open onClose={mocks.onClose} />)
}

async function selectCustomer(user: ReturnType<typeof userEvent.setup>) {
  const customerInput = screen.getByPlaceholderText('Buscar cliente...')
  await user.click(customerInput)
  await user.click(screen.getByRole('option', { name: /AC COMERCIAL/ }))
}

async function fillRequiredFields(user: ReturnType<typeof userEvent.setup>) {
  await selectCustomer(user)
  await user.type(screen.getByLabelText('Nome do item'), 'Taxa especial')
  await user.clear(screen.getByLabelText('Quantidade'))
  await user.type(screen.getByLabelText('Quantidade'), '2')
  await user.clear(screen.getByLabelText('Valor unitário (BRL)'))
  await user.type(screen.getByLabelText('Valor unitário (BRL)'), '10,50')
}

describe('ManualInvoiceModal', () => {
  it('renderiza o formulário acessível quando aberto e desabilita B/L e Viagem sem cliente', async () => {
    const user = userEvent.setup()
    openModal()

    const dialog = screen.getByRole('dialog', { name: 'Nova fatura avulsa' })
    expect(within(dialog).getByLabelText('Cliente')).toBeTruthy()
    expect(within(dialog).getByLabelText('Nome do item')).toBeTruthy()
    expect(within(dialog).getByLabelText('Descrição da cobrança')).toBeTruthy()
    expect(within(dialog).getByLabelText('Quantidade')).toBeTruthy()
    expect(within(dialog).getByLabelText('Valor unitário (BRL)')).toBeTruthy()
    const blInput = within(dialog).getByLabelText('B/L (opcional)') as HTMLInputElement
    expect(blInput.disabled).toBe(true)

    await selectCustomer(user)
    const updatedBlInput = within(dialog).getByLabelText('B/L (opcional)') as HTMLInputElement
    expect(updatedBlInput.disabled).toBe(false)
  })

  it('exige cliente e não chama a mutation sem ele', async () => {
    const user = userEvent.setup()
    openModal()

    await user.click(screen.getByRole('button', { name: 'Emitir fatura avulsa' }))

    expect(screen.getByRole('alert').textContent).toContain('Cliente obrigatorio.')
    expect(mocks.mutateAsync).not.toHaveBeenCalled()
  })

  it('rejeita item, quantidade e valor inválidos antes da confirmação', async () => {
    const user = userEvent.setup()
    openModal()
    await selectCustomer(user)
    await user.click(screen.getByRole('button', { name: 'Emitir fatura avulsa' }))

    expect(screen.getByRole('alert').textContent).toContain('Nome do item obrigatorio.')
    expect(mocks.confirm).not.toHaveBeenCalled()
    expect(mocks.mutateAsync).not.toHaveBeenCalled()
  })

  it('envia apenas os campos obrigatórios quando não há BL nem viagem', async () => {
    const user = userEvent.setup()
    openModal()
    await fillRequiredFields(user)

    await user.click(screen.getByRole('button', { name: 'Emitir fatura avulsa' }))

    await waitFor(() => expect(mocks.mutateAsync).toHaveBeenCalledWith({
      customerId: 1,
      itemName: 'Taxa especial',
      quantity: 2,
      unitValueBrl: 10.5,
    }))
  })

  it('envia descrição, BL e viagem quando o operador os informa', async () => {
    const user = userEvent.setup()
    openModal()
    await fillRequiredFields(user)
    await user.type(screen.getByLabelText('Descrição da cobrança'), ' Cobrança extraordinária ')
    await user.click(screen.getByRole('button', { name: 'BL-1' }))
    await user.click(screen.getByRole('button', { name: 'Viagem 42' }))

    await user.click(screen.getByRole('button', { name: 'Emitir fatura avulsa' }))

    await waitFor(() => expect(mocks.mutateAsync).toHaveBeenCalledWith({
      customerId: 1,
      itemName: 'Taxa especial',
      description: 'Cobrança extraordinária',
      quantity: 2,
      unitValueBrl: 10.5,
      blId: 'BL-1',
      voyageId: 42,
    }))
  })

  it('não emite quando a confirmação é recusada', async () => {
    const user = userEvent.setup()
    mocks.confirm.mockResolvedValueOnce(false)
    openModal()
    await fillRequiredFields(user)

    await user.click(screen.getByRole('button', { name: 'Emitir fatura avulsa' }))

    await waitFor(() => expect(mocks.confirm).toHaveBeenCalled())
    expect(mocks.mutateAsync).not.toHaveBeenCalled()
  })

  it('mostra sucesso e fecha após a emissão', async () => {
    const user = userEvent.setup()
    openModal()
    await fillRequiredFields(user)

    await user.click(screen.getByRole('button', { name: 'Emitir fatura avulsa' }))

    await waitFor(() => expect(mocks.onClose).toHaveBeenCalled())
    expect(mocks.showToast).toHaveBeenCalledWith('Avulsa INV-42 emitida (R$ 20,00).', 'success')
  })
})
