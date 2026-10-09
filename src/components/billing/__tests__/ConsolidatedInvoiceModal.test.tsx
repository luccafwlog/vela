// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const mocks = vi.hoisted(() => ({
  receivables: [] as Array<Record<string, unknown>>,
  confirm: vi.fn(),
  create: vi.fn(),
  error: null as Error | null,
}))

// Hooks tocam Supabase/React Query no topo do modulo — mockados para isolar a UI.
const customers = [
  { id: 1, name: 'AC COMERCIAL IMPORTADORA E EXPORTADORA LTDA', cnpj_cpf: '07415554000956' },
  { id: 2, name: 'GOLDEN LOGISTICA INTERNACIONAL LTDA', cnpj_cpf: '21239198000130' },
]

vi.mock('../../../services/billing', () => ({
  listBillingCustomers: async (query: string) => customers.filter((customer) => customer.name.toLowerCase().includes(query.toLowerCase())),
}))

vi.mock('../../../hooks/useBillingLedger', () => ({
  useConsolidatableReceivables: () => ({ data: mocks.receivables, isLoading: false, error: mocks.error }),
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
  mocks.error = null
})

function openModal() {
  render(<ConsolidatedInvoiceModal open onClose={() => {}} />)
  return screen.getByRole('combobox', { name: 'Cliente' })
}

async function chooseCustomer(user: ReturnType<typeof userEvent.setup>, input: HTMLElement, typed: string, name: string) {
  await user.type(input, typed)
  await user.click(await screen.findByText(name))
}

describe('ConsolidatedInvoiceModal — seletor de cliente', () => {
  it('busca o Cliente pelo Combobox comum e mostra o CNPJ com máscara', async () => {
    const user = userEvent.setup()
    const input = openModal()
    await user.type(input, 'gol')
    expect(await screen.findByText('21.239.198/0001-30')).toBeTruthy()
    await user.click(screen.getByText('GOLDEN LOGISTICA INTERNACIONAL LTDA'))
    expect((input as HTMLInputElement).value).toBe('GOLDEN LOGISTICA INTERNACIONAL LTDA')
  })

  it('erro ao consultar os B/Ls do Cliente não aparece como lista vazia', async () => {
    mocks.error = new Error('falhou')
    const user = userEvent.setup()
    const input = openModal()
    await chooseCustomer(user, input, 'gol', 'GOLDEN LOGISTICA INTERNACIONAL LTDA')
    expect(screen.getByRole('alert').textContent).toContain('Não foi possível consultar os B/Ls')
    expect(screen.queryByText('Nenhum B/L para consolidar')).toBeNull()
  })

  it('falha na nova consulta dos B/Ls bloqueia a emissão com a seleção anterior', async () => {
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
    const user = userEvent.setup()
    const input = openModal()
    await chooseCustomer(user, input, 'gol', 'GOLDEN LOGISTICA INTERNACIONAL LTDA')
    await user.click(screen.getByRole('checkbox', { name: 'Selecionar B/L BL-91' }))

    // React Query mantém as linhas em cache quando a nova consulta falha.
    mocks.error = new Error('falhou')
    await user.type(screen.getByLabelText('Buscar B/L'), 'B')

    expect((screen.getByRole('button', { name: 'Emitir consolidada' }) as HTMLButtonElement).disabled).toBe(true)
    expect(mocks.create).not.toHaveBeenCalled()
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
    await chooseCustomer(user, input, 'gol', 'GOLDEN LOGISTICA INTERNACIONAL LTDA')
    await user.click(screen.getByRole('checkbox', { name: 'Selecionar B/L BL-91' }))
    await user.click(screen.getByRole('button', { name: 'Emitir consolidada' }))

    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledOnce())
    const options = mocks.confirm.mock.calls[0][0]
    const plain = (value: string) => value.replace(/\s/g, ' ')
    expect(plain(options.message)).toContain('R$ 1.250,00')
    expect(options.affected.items.map(plain)).toContain('B/L BL-91 · R$ 1.250,00 · Navio Azul V7')
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
    await chooseCustomer(user, input, 'gol', 'GOLDEN LOGISTICA INTERNACIONAL LTDA')
    await user.click(screen.getByRole('checkbox', { name: 'Selecionar B/L BL-91' }))
    await user.click(screen.getByRole('button', { name: 'Emitir consolidada' }))

    await waitFor(() => expect(mocks.create).toHaveBeenCalledWith({ customerId: 2, receivableIds: [91] }))
  })
})
