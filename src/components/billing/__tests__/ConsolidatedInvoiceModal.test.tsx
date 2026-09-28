// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const mocks = vi.hoisted(() => ({
  receivables: [] as Array<Record<string, unknown>>,
  confirm: vi.fn(),
  create: vi.fn(),
}))

// Hooks tocam Supabase/React Query no topo do modulo — mockados para isolar a UI.
const customers = [
  { id: 1, name: 'AC COMERCIAL IMPORTADORA E EXPORTADORA LTDA', cnpj_cpf: '07415554000956' },
  { id: 2, name: 'GOLDEN LOGISTICA INTERNACIONAL LTDA', cnpj_cpf: '21239198000130' },
]

vi.mock('../../../hooks/useBilling', () => ({
  useBillingCustomers: () => ({ data: customers }),
}))

vi.mock('../../../hooks/useBillingLedger', () => ({
  useConsolidatableReceivables: () => ({ data: mocks.receivables, isLoading: false }),
  useCreateConsolidatedInvoice: () => ({ mutateAsync: mocks.create, isPending: false }),
}))

vi.mock('../../../hooks/useBls', () => ({
  useVoyageOptions: () => ({ data: [] }),
}))

vi.mock('../../ui/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }))
vi.mock('../../ui/ConfirmDialog', () => ({ useConfirm: () => mocks.confirm }))

import { ConsolidatedInvoiceModal } from '../ConsolidatedInvoiceModal'

afterEach(() => {
  cleanup()
  mocks.receivables = []
  mocks.confirm.mockReset().mockResolvedValue(false)
  mocks.create.mockReset()
})

function openModal() {
  render(<ConsolidatedInvoiceModal open onClose={() => {}} />)
  return screen.getByPlaceholderText('Buscar cliente...')
}

describe('ConsolidatedInvoiceModal — seletor de cliente', () => {
  it('abre o dropdown ao clicar e lista os clientes', async () => {
    const user = userEvent.setup()
    const input = openModal()

    expect(screen.queryByRole('listbox')).toBeNull()
    await user.click(input)

    const menu = screen.getByRole('listbox')
    const options = within(menu).getAllByRole('option')
    expect(options).toHaveLength(2)
    expect(options[0].textContent).toContain('AC COMERCIAL')
  })

  it('preenche o campo e fecha o dropdown ao selecionar', async () => {
    const user = userEvent.setup()
    const input = openModal()

    await user.click(input)
    await user.click(screen.getByText('GOLDEN LOGISTICA INTERNACIONAL LTDA'))

    expect((input as HTMLInputElement).value).toBe('GOLDEN LOGISTICA INTERNACIONAL LTDA')
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('permite trocar de cliente apos selecionado', async () => {
    const user = userEvent.setup()
    const input = openModal()

    await user.click(input)
    await user.click(screen.getByText('GOLDEN LOGISTICA INTERNACIONAL LTDA'))

    // Reabrir e escolher outro cliente — o dropdown deve voltar a aparecer.
    await user.click(input)
    const menu = screen.getByRole('listbox')
    await user.click(within(menu).getByText('AC COMERCIAL IMPORTADORA E EXPORTADORA LTDA'))

    expect((input as HTMLInputElement).value).toBe('AC COMERCIAL IMPORTADORA E EXPORTADORA LTDA')
  })

  it('limpa o cliente pelo botao x', async () => {
    const user = userEvent.setup()
    const input = openModal()

    await user.click(input)
    await user.click(screen.getByText('GOLDEN LOGISTICA INTERNACIONAL LTDA'))
    expect((input as HTMLInputElement).value).toBe('GOLDEN LOGISTICA INTERNACIONAL LTDA')

    await user.click(screen.getByLabelText('Limpar cliente'))
    expect((input as HTMLInputElement).value).toBe('')
    expect(screen.queryByLabelText('Limpar cliente')).toBeNull()
  })

  it('fecha o dropdown ao clicar fora', async () => {
    const user = userEvent.setup()
    const input = openModal()

    await user.click(input)
    expect(screen.getByRole('listbox')).toBeTruthy()

    // Clicar num campo fora do picker (label "Buscar B/L") fecha o dropdown.
    await user.click(screen.getByText('Buscar B/L'))
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('mostra o escopo e não cria a consolidada se a pessoa voltar', async () => {
    mocks.receivables = [{
      receivable_id: 91,
      bl_id: 'BL-91',
      balance_brl: 1250,
      eligibility_status: 'eligible',
      receivable_status: 'open',
      voyage_id: 7,
      vessel_name: 'Navio Azul',
      voyage_number: 'V7',
      individual_invoice_id: null,
      individual_invoice_number: null,
    }]
    const user = userEvent.setup()
    const input = openModal()
    await user.click(input)
    await user.click(screen.getByText('GOLDEN LOGISTICA INTERNACIONAL LTDA'))
    await user.click(screen.getByRole('checkbox', { name: 'Selecionar B/L BL-91' }))
    await user.click(screen.getByRole('button', { name: 'Emitir consolidada' }))

    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledOnce())
    const options = mocks.confirm.mock.calls[0][0]
    expect(options.message).toContain('R$ 1.250,00')
    expect(options.affected.items).toContain('B/L BL-91 · R$ 1.250,00 · Navio Azul V7')
    expect(options.consequence).toContain('recebíveis selecionados')
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('só emite a consolidada depois da confirmação', async () => {
    mocks.receivables = [{
      receivable_id: 91,
      bl_id: 'BL-91',
      balance_brl: 1250,
      eligibility_status: 'eligible',
      receivable_status: 'open',
      voyage_id: null,
      vessel_name: null,
      voyage_number: null,
      individual_invoice_id: null,
      individual_invoice_number: null,
    }]
    mocks.confirm.mockResolvedValue(true)
    mocks.create.mockResolvedValue({ invoice_number: 'CON-91', total_brl: 1250 })
    const user = userEvent.setup()
    const input = openModal()
    await user.click(input)
    await user.click(screen.getByText('GOLDEN LOGISTICA INTERNACIONAL LTDA'))
    await user.click(screen.getByRole('checkbox', { name: 'Selecionar B/L BL-91' }))
    await user.click(screen.getByRole('button', { name: 'Emitir consolidada' }))

    await waitFor(() => expect(mocks.create).toHaveBeenCalledWith({ customerId: 2, receivableIds: [91] }))
  })
})
