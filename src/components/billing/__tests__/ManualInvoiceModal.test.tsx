// @vitest-environment jsdom

import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  confirm: vi.fn(),
  blLookup: vi.fn(),
  listBlSuggestions: vi.fn(),
  mutateAsync: vi.fn(),
  onClose: vi.fn(),
  showToast: vi.fn(),
}))

const customers = [
  { id: 1, name: 'AC COMERCIAL IMPORTADORA E EXPORTADORA LTDA', cnpj_cpf: '07415554000956' },
]

vi.mock('../../../hooks/useBilling', () => ({
  useCreateManualInvoice: () => ({ mutateAsync: mocks.mutateAsync, isPending: false }),
}))

vi.mock('../../../hooks/useLocalCharges', () => ({
  useManualChargeItemsForBl: (blId?: string) => ({ data: blId ? [{ charge_item_id: 5, charge_item_name: 'Correction Letter', currency: 'BRL', effective_unit_value_brl: 600 }] : undefined, isLoading: false, error: null }),
  useManualInvoiceQuote: (blId: string, itemId: number) => ({ data: blId && itemId === 5 ? { charge_item_name: 'Correction Letter', quantity: 1, unit_value_brl: 600, total_brl: 600, currency: 'BRL' } : undefined, isFetching: false, error: null }),
}))

vi.mock('../../../services/billing', () => ({
  listBlSuggestions: mocks.listBlSuggestions,
  listBillingCustomers: async () => customers,
}))

vi.mock('../../../services/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: mocks.blLookup,
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
    onInputChange,
  }: {
    label: string
    disabled?: boolean
    onSelectOption?: (option: { value: string; label: string }) => void
    onInputChange?: (value: string) => void
  }) => (
    <div>
      <label>
        {label}
        {/* Só o evento imediato: o onValueChange real chega 300 ms depois, e um Enter pode vir antes. */}
        <input aria-label={label} disabled={disabled} onChange={(event) => onInputChange?.(event.target.value)} />
      </label>
      {label === 'Cliente' ? (
        <button type="button" onClick={() => onSelectOption?.({ value: '1', label: customers[0].name })}>Escolher {customers[0].name}</button>
      ) : (
        <button type="button" disabled={disabled} onClick={() => onSelectOption?.({ value: 'BL-1', label: 'BL-1' })}>BL-1</button>
      )}
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
  mocks.blLookup.mockReset().mockResolvedValue({ data: { voyage_id: 42 }, error: null })
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
  await user.click(screen.getByRole('button', { name: /Escolher AC COMERCIAL/ }))
}

async function fillRequiredFields(user: ReturnType<typeof userEvent.setup>) {
  await selectCustomer(user)
  await user.type(screen.getByLabelText(/^Nome do item/), 'Taxa especial')
  await user.clear(screen.getByLabelText(/^Quantidade/))
  await user.type(screen.getByLabelText(/^Quantidade/), '2')
  await user.clear(screen.getByLabelText(/^Valor unitário/))
  await user.type(screen.getByLabelText(/^Valor unitário/), '10,50')
}

describe('ManualInvoiceModal', () => {
  it('renderiza o formulário acessível quando aberto e desabilita B/L e Viagem sem cliente', async () => {
    const user = userEvent.setup()
    openModal()

    const dialog = screen.getByRole('dialog', { name: 'Nova fatura avulsa' })
    expect(within(dialog).getByLabelText('Cliente')).toBeTruthy()
    expect(within(dialog).getByLabelText(/^Nome do item/)).toBeTruthy()
    expect(within(dialog).getByLabelText(/^Descrição da cobrança/)).toBeTruthy()
    expect(within(dialog).getByLabelText(/^Quantidade/)).toBeTruthy()
    expect(within(dialog).getByLabelText(/^Valor unitário/)).toBeTruthy()
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

    expect(screen.getByRole('alert').textContent).toContain('Selecione o Cliente.')
    expect(mocks.mutateAsync).not.toHaveBeenCalled()
  })

  it('rejeita item, quantidade e valor inválidos antes da confirmação', async () => {
    const user = userEvent.setup()
    openModal()
    await selectCustomer(user)
    await user.click(screen.getByRole('button', { name: 'Emitir fatura avulsa' }))

    expect(screen.getAllByRole('alert').map((node) => node.textContent).join(' ')).toContain('Informe o nome do item.')
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
    await user.type(screen.getByLabelText(/^Descrição da cobrança/), ' Cobrança extraordinária ')
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
    expect(mocks.showToast).toHaveBeenCalledWith(expect.stringMatching(/^Avulsa INV-42 emitida \(R\$\s20,00\)\.$/), 'success')
  })
})

it('item de tabela exige B/L e congela preço/quantidade sem edição', async () => {
  const user = userEvent.setup()
  openModal()
  await selectCustomer(user)
  await user.click(screen.getByRole('radio', { name: 'Item da tabela' }))
  expect(screen.queryByLabelText(/^Valor unitário/)).toBeNull()
  expect((screen.getByLabelText(/^Item da tabela/) as HTMLSelectElement).disabled).toBe(true)
  await user.click(screen.getByRole('button', { name: 'Emitir fatura avulsa' }))
  expect(screen.getByRole('alert').textContent).toContain('Item da tabela exige o B/L')
  expect(mocks.mutateAsync).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'BL-1' }))
  await user.selectOptions(screen.getByLabelText(/^Item da tabela/), '5')
  expect(screen.getByText(/1 × R\$\s600,00/)).toBeTruthy()
  expect(screen.getByText('Total a emitir').nextElementSibling?.textContent?.replace(/\s/g, ' ')).toBe('R$ 600,00')
  await user.click(screen.getByRole('button', { name: 'Emitir fatura avulsa' }))
  expect(mocks.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ chargeItemId: 5, blId: 'BL-1', unitValueBrl: 600, voyageId: 42 }))
})

it('Outra mostra o total ao digitar e mantém a falha da emissão no formulário', async () => {
  const user = userEvent.setup()
  mocks.mutateAsync.mockRejectedValueOnce(new Error('B/L não pertence ao Cliente.'))
  openModal()
  await fillRequiredFields(user)
  expect(screen.getByText('Total a emitir').nextElementSibling?.textContent?.replace(/\s/g, ' ')).toBe('R$ 21,00')
  await user.click(screen.getByRole('button', { name: 'Emitir fatura avulsa' }))
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Nada foi emitido'))
  expect(mocks.onClose).not.toHaveBeenCalled()
  expect(screen.getByRole('dialog', { name: 'Nova fatura avulsa' })).toBeTruthy()
})

it('editar o Cliente já escolhido invalida a seleção antes do debounce da busca', async () => {
  const user = userEvent.setup()
  openModal()
  await fillRequiredFields(user)
  await user.type(screen.getByLabelText('Cliente'), 'GOLDEN')

  await user.click(screen.getByRole('button', { name: 'Emitir fatura avulsa' }))

  expect(screen.getByRole('alert').textContent).toContain('Selecione o Cliente.')
  expect(mocks.confirm).not.toHaveBeenCalled()
  expect(mocks.mutateAsync).not.toHaveBeenCalled()
})

it('trocar o tipo de cobrança descarta B/L e Viagem que ficariam invisíveis', async () => {
  const user = userEvent.setup()
  openModal()
  await fillRequiredFields(user)
  await user.click(screen.getByRole('button', { name: 'BL-1' }))
  await user.click(screen.getByRole('button', { name: 'Viagem 42' }))

  await user.click(screen.getByRole('radio', { name: 'Item da tabela' }))
  expect((screen.getByLabelText(/^Item da tabela/) as HTMLSelectElement).disabled).toBe(true)

  await user.click(screen.getByRole('radio', { name: 'Outra' }))
  await fillRequiredFields(user)
  await user.click(screen.getByRole('button', { name: 'Emitir fatura avulsa' }))

  await waitFor(() => expect(mocks.mutateAsync).toHaveBeenCalled())
  const input = mocks.mutateAsync.mock.calls[0][0]
  expect(input.blId).toBeUndefined()
  expect(input.voyageId).toBeUndefined()
})

it('trocar o B/L do item da tabela não emite com a Viagem do B/L anterior', async () => {
  const user = userEvent.setup()
  openModal()
  await selectCustomer(user)
  await user.click(screen.getByRole('radio', { name: 'Item da tabela' }))
  await user.click(screen.getByRole('button', { name: 'BL-1' }))
  await waitFor(() => expect(mocks.blLookup).toHaveBeenCalledOnce())

  // A consulta da Viagem do novo B/L ainda não voltou quando a pessoa emite.
  mocks.blLookup.mockReturnValueOnce(new Promise(() => {}))
  await user.type(screen.getByLabelText('B/L'), 'X')
  await user.click(screen.getByRole('button', { name: 'BL-1' }))
  await user.selectOptions(screen.getByLabelText(/^Item da tabela/), '5')
  await user.click(screen.getByRole('button', { name: 'Emitir fatura avulsa' }))

  await waitFor(() => expect(mocks.mutateAsync).toHaveBeenCalled())
  expect(mocks.mutateAsync.mock.calls[0][0].voyageId).toBeUndefined()
})
