// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CustomerContactConfiguration } from '../CustomerContactConfiguration'

const fetchConfig = vi.hoisted(() => vi.fn())
const saveConfig = vi.hoisted(() => vi.fn())
const confirmOk = vi.hoisted(() => vi.fn(async () => true))

vi.mock('../../../services/customerContactConfiguration', () => ({
  fetchCustomerContactConfiguration: fetchConfig,
  internalSaveCustomerContactConfiguration: saveConfig,
}))

vi.mock('../../ui/Toast', () => ({
  useToast: () => ({ showToast: vi.fn() }),
}))

vi.mock('../../ui/ConfirmDialog', () => ({
  useConfirm: () => confirmOk,
}))

const BOXES = [
  { code: 'documentacao_operacao', label: 'Documentação e Operação', description: 'CE e Taxas', sort_order: 1, active: true },
  { code: 'financeiro', label: 'Financeiro', description: 'Taxas e Demurrage', sort_order: 2, active: true },
  { code: 'demurrage', label: 'Demurrage', description: 'Demurrage', sort_order: 3, active: true },
]

function primaryContact(overrides = {}) {
  return {
    id: 1,
    customer_id: 10,
    name: 'Principal',
    email: 'principal@cliente.com',
    phone: null,
    is_primary: true,
    active: true,
    origin: 'interno',
    box_codes: ['documentacao_operacao', 'financeiro', 'demurrage'],
    suppression_reason: null,
    sendable: true,
    ...overrides,
  }
}

describe('CustomerContactConfiguration (behavior)', () => {
  beforeEach(() => {
    fetchConfig.mockReset()
    saveConfig.mockReset()
    saveConfig.mockResolvedValue({ boxes: BOXES, contacts: [] })
  })

  it('save fails when a box would be left empty (no RPC)', async () => {
    const user = userEvent.setup()
    fetchConfig.mockResolvedValueOnce({
      boxes: BOXES,
      contacts: [primaryContact({ sendable: false })],
    })
    render(<CustomerContactConfiguration customerId={10} canEdit />)
    await screen.findByDisplayValue('principal@cliente.com')

    // Remove the only link → financeiro and demurrage lose coverage.
    const checkboxes = screen.getAllByRole('checkbox')
    // First checkbox is documentacao_operacao (checked); uncheck it.
    await user.click(checkboxes[0])
    await user.click(screen.getByRole('button', { name: 'Salvar alterações de contatos' }))

    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(saveConfig).not.toHaveBeenCalled()
  })

  it('duplicate identifies the existing contact (branded message surfaces)', async () => {
    const user = userEvent.setup()
    fetchConfig.mockResolvedValueOnce({
      boxes: BOXES,
      contacts: [primaryContact()],
    })
    saveConfig.mockRejectedValueOnce(
      Object.assign(new Error('E-mail novo@cliente.com já cadastrado para o contato "Principal" (ID 1).'), { code: '23505' }),
    )
    render(<CustomerContactConfiguration customerId={10} canEdit />)
    await screen.findByDisplayValue('principal@cliente.com')

    await user.click(screen.getByRole('button', { name: '+ Novo contato' }))
    const emailInputs = screen.getAllByPlaceholderText('email@empresa.com')
    await user.type(emailInputs[emailInputs.length - 1], 'novo@cliente.com')
    // Give the new contact a box so client-side validation passes and the
    // server-side duplicate is what fails.
    const boxes = screen.getAllByRole('checkbox')
    await user.click(boxes[boxes.length - 3])
    await user.click(screen.getByRole('button', { name: 'Salvar alterações de contatos' }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/já cadastrado para o contato/)
    expect(alert.textContent).toMatch(/ID 1/)
  })

  it('without permission shows fallback copy and no save', async () => {
    fetchConfig.mockResolvedValueOnce({
      boxes: BOXES,
      contacts: [primaryContact()],
    })
    render(<CustomerContactConfiguration customerId={10} canEdit={false} />)
    await screen.findByDisplayValue('principal@cliente.com')

    expect(screen.getByText(/não possui permissão para editar/i)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Salvar alterações de contatos' })).toBeNull()
    expect(screen.queryByRole('button', { name: '+ Novo contato' })).toBeNull()
  })
  it('principal sem vínculos carrega com as três caixas marcadas', async () => {
    fetchConfig.mockResolvedValueOnce({ boxes: BOXES, contacts: [primaryContact({ box_codes: [] })] })
    render(<CustomerContactConfiguration customerId={10} canEdit />)
    await screen.findByDisplayValue('principal@cliente.com')
    expect((screen.getAllByRole('checkbox') as HTMLInputElement[]).every((box) => box.checked)).toBe(true)
  })

  it('não desmarca caixa do principal sem substituto', async () => {
    const user = userEvent.setup()
    fetchConfig.mockResolvedValueOnce({ boxes: BOXES, contacts: [primaryContact()] })
    render(<CustomerContactConfiguration customerId={10} canEdit />)
    await screen.findByDisplayValue('principal@cliente.com')
    const checkbox = screen.getAllByRole('checkbox')[1] as HTMLInputElement
    await user.click(checkbox)
    expect(checkbox.checked).toBe(true)
    expect(screen.getByRole('alert').textContent).toContain('selecione outro e-mail')
  })

  it.each([{ active: false }, { sendable: false }, { suppression_reason: 'suprimido_bounce' }, { email: '' }])(
    'não aceita substituto inelegível: %j', async (override) => {
      const user = userEvent.setup()
      fetchConfig.mockResolvedValueOnce({ boxes: BOXES, contacts: [primaryContact(), primaryContact({
        id: 2, is_primary: false, email: 'outro@cliente.com', box_codes: ['financeiro'], ...override,
      })] })
      render(<CustomerContactConfiguration customerId={10} canEdit />)
      await screen.findByDisplayValue('principal@cliente.com')
      const checkbox = screen.getAllByRole('checkbox')[1] as HTMLInputElement
      await user.click(checkbox)
      expect(checkbox.checked).toBe(true)
    },
  )

  it('permite delegar caixa a outro contato ativo e elegível', async () => {
    const user = userEvent.setup()
    fetchConfig.mockResolvedValueOnce({ boxes: BOXES, contacts: [primaryContact(), primaryContact({
      id: 2, is_primary: false, email: 'outro@cliente.com', box_codes: ['financeiro'],
    })] })
    render(<CustomerContactConfiguration customerId={10} canEdit />)
    await screen.findByDisplayValue('principal@cliente.com')
    const checkbox = screen.getAllByRole('checkbox')[1] as HTMLInputElement
    await user.click(checkbox)
    expect(checkbox.checked).toBe(false)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('mantém vínculos armazenados para usuário sem permissão de edição', async () => {
    fetchConfig.mockResolvedValueOnce({ boxes: BOXES, contacts: [primaryContact({ box_codes: [] })] })
    render(<CustomerContactConfiguration customerId={10} canEdit={false} />)
    await screen.findByDisplayValue('principal@cliente.com')
    expect((screen.getAllByRole('checkbox') as HTMLInputElement[]).every((box) => !box.checked && box.disabled)).toBe(true)
  })

})
