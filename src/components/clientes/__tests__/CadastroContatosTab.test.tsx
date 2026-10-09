// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  invalidateQueries: vi.fn(),
  showToast: vi.fn(),
  confirm: vi.fn(),
  updateCustomerWithAudit: vi.fn(() => Promise.resolve(true)),
  lastOnSaved: null as (() => void) | null,
}))

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
}))
vi.mock('../../../hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'user-1' }, isAdmin: true, can: () => true }),
}))
vi.mock('../../../hooks/usePortalProvisioning', () => ({
  usePortalProvisioningForCustomer: () => ({ data: undefined }),
}))
vi.mock('../../ui/Toast', () => ({ useToast: () => ({ showToast: mocks.showToast }) }))
vi.mock('../../ui/ConfirmDialog', () => ({
  useConfirm: () => mocks.confirm,
}))
vi.mock('../../../services/customers', () => ({
  updateCustomerWithAudit: mocks.updateCustomerWithAudit,
}))
vi.mock('../CustomerContactConfiguration', () => ({
  CustomerContactConfiguration: ({ customerId, onSaved }: { customerId: number; onSaved?: () => void }) => {
    mocks.lastOnSaved = onSaved ?? null
    return (
      <div data-testid="customer-contact-configuration">
        <span>Configuração de contatos do cliente {customerId}</span>
        <button type="button" onClick={onSaved}>
          Simular Salvo
        </button>
      </div>
    )
  },
}))

import { CadastroContatosTab } from '../CadastroContatosTab'

const baseData = {
  id: 101,
  name: 'ACME',
  trade_name: null,
  address: null,
  city: null,
  state: null,
  zip: null,
  notes: null,
  customer_contacts: [{ id: 5, name: 'Contato X', email: 'x@acme.com', phone: null, purpose: 'geral', is_primary: true }],
} as never

afterEach(() => {
  cleanup()
  mocks.invalidateQueries.mockClear()
  mocks.showToast.mockClear()
  mocks.confirm.mockClear()
  mocks.lastOnSaved = null
})

describe('CadastroContatosTab', () => {
  it('renderiza CustomerContactConfiguration e invalida customer-detail e timeline ao salvar contatos', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <CadastroContatosTab data={baseData} cnpj="12345678000195" />
      </MemoryRouter>,
    )

    expect(screen.getByTestId('customer-contact-configuration')).toBeTruthy()
    expect(screen.getByText('Configuração de contatos do cliente 101')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Simular Salvo' }))

    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['customer-detail', '12345678000195'] })
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['customers'] })
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['customer-ficha', 'timeline', 101] })
  })

  it('salva cadastro do cliente com diff antes/depois e justificativa', async () => {
    mocks.confirm.mockResolvedValue(true)
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <CadastroContatosTab data={baseData} cnpj="12345678000195" />
      </MemoryRouter>,
    )

    const tradeNameInput = screen.getByLabelText(/Nome fantasia/i)
    await user.type(tradeNameInput, 'ACME Brasil')

    await user.type(screen.getByLabelText(/justificativa/i), 'Atualização de nome fantasia')
    await user.click(screen.getByRole('button', { name: 'Salvar cadastro' }))

    expect(mocks.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Salvar cadastro do cliente',
        changes: expect.arrayContaining([
          expect.objectContaining({
            field: 'Nome fantasia',
            before: '',
            after: 'ACME Brasil',
          }),
        ]),
        consequence: expect.stringContaining('faturas emitidas'),
        reversibility: expect.stringContaining('justificativa'),
      }),
    )

    expect(mocks.updateCustomerWithAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: 101,
        values: expect.objectContaining({ trade_name: 'ACME Brasil' }),
        justification: 'Atualização de nome fantasia',
      }),
    )
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['customer-detail', '12345678000195'] })
    expect(mocks.showToast).toHaveBeenCalledWith('Cadastro do cliente atualizado.', 'success')
  })

  it('não executa atualização se usuário cancelar no Voltar do diálogo de confirmação', async () => {
    mocks.confirm.mockResolvedValue(false)
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <CadastroContatosTab data={baseData} cnpj="12345678000195" />
      </MemoryRouter>,
    )

    await user.type(screen.getByLabelText(/Nome fantasia/i), 'ACME Brasil')
    await user.type(screen.getByLabelText(/justificativa/i), 'Atualização')
    await user.click(screen.getByRole('button', { name: 'Salvar cadastro' }))

    expect(mocks.confirm).toHaveBeenCalled()
    expect(mocks.updateCustomerWithAudit).not.toHaveBeenCalled()
  })

  it('sem alteração não oferece salvar; com alteração mostra o que mudou e Descartar volta ao gravado', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <CadastroContatosTab data={baseData} cnpj="12345678000195" />
      </MemoryRouter>,
    )

    expect(screen.queryByRole('button', { name: 'Salvar cadastro' })).toBeNull()
    expect(screen.queryByLabelText(/justificativa/i)).toBeNull()

    await user.type(screen.getByLabelText(/CEP/), '11010-000')
    expect(screen.getByText(/1 alteração não salva/).parentElement?.textContent).toContain('CEP')

    await user.click(screen.getByRole('button', { name: 'Descartar' }))
    expect((screen.getByLabelText(/CEP/) as HTMLInputElement).value).toBe('')
    expect(screen.queryByRole('button', { name: 'Salvar cadastro' })).toBeNull()
  })

  it('pede a justificativa junto do campo, sem abrir a confirmação', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <CadastroContatosTab data={baseData} cnpj="12345678000195" />
      </MemoryRouter>,
    )

    await user.type(screen.getByLabelText(/Nome fantasia/i), 'ACME Brasil')
    await user.click(screen.getByRole('button', { name: 'Salvar cadastro' }))

    expect(screen.getByText(/Informe a justificativa/)).toBeTruthy()
    expect(mocks.confirm).not.toHaveBeenCalled()
    expect(mocks.updateCustomerWithAudit).not.toHaveBeenCalled()
  })
})
