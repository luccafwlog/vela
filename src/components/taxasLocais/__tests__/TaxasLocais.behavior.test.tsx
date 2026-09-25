// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChargeOverridesTab } from '../ChargeOverridesTab'
import { ChargeTablesTab } from '../ChargeTablesTab'

const mocks = vi.hoisted(() => ({
  showToast: vi.fn(),
  confirm: vi.fn(),
  saveTable: vi.fn(),
  toggleTable: vi.fn(),
  saveItem: vi.fn(),
  deleteItem: vi.fn(),
  saveOverride: vi.fn(),
  deleteOverride: vi.fn(),
}))

const tables = [{
  id: 1,
  name: 'Tabela Vitória',
  cargo_mode: 'container' as const,
  pod: 'BRVIT',
  valid_from: '2026-01-01',
  valid_to: null,
  active: true,
  notes: 'vigente',
  charge_table_items: [{
    id: 10,
    name: 'THD',
    category: 'base',
    application_basis: 'bl',
    cargo_profile: 'any',
    currency: 'BRL',
    unit_value_brl: 100,
    unit_value_usd: null,
    manual_only: false,
    active: true,
    sort_order: 10,
  }],
}]

const overrides = [{
  id: 20,
  customer_id: 2,
  charge_item_id: 10,
  override_value: 80,
  valid_from: '2026-01-01',
  valid_to: null,
  notes: 'acordo',
  created_at: '2026-01-01T00:00:00Z',
  customer: { id: 2, name: 'Cliente A', cnpj_cpf: '123' },
  charge_item: {
    id: 10,
    name: 'THD',
    currency: 'BRL',
    unit_value_brl: 100,
    unit_value_usd: null,
    charge_table: {
      id: 1,
      name: 'Tabela Vitória',
      cargo_mode: 'container' as const,
      pod: 'BRVIT',
      valid_from: '2026-01-01',
      valid_to: null,
      active: true,
    },
  },
}]

vi.mock('../../ui/Toast', () => ({
  useToast: () => ({ showToast: mocks.showToast }),
}))
vi.mock('../../ui/ConfirmDialog', () => ({
  useConfirm: () => mocks.confirm,
}))
vi.mock('../../../hooks/useLocalCharges', () => ({
  useLocalChargeTables: () => ({ data: tables, isLoading: false, error: null }),
  useSaveChargeTable: () => ({ mutateAsync: mocks.saveTable, isPending: false }),
  useSetChargeTableActive: () => ({ mutateAsync: mocks.toggleTable, isPending: false }),
  useSaveChargeTableItem: () => ({ mutateAsync: mocks.saveItem, isPending: false }),
  useDeleteChargeTableItem: () => ({ mutateAsync: mocks.deleteItem, isPending: false }),
  useCustomerRateOverrides: () => ({ data: overrides, isLoading: false, error: null }),
  useOverrideChargeItems: () => ({ data: [overrides[0].charge_item] }),
  useOverrideCustomers: () => ({ data: [overrides[0].customer] }),
  useSaveCustomerRateOverride: () => ({ mutateAsync: mocks.saveOverride, isPending: false }),
  useDeleteCustomerRateOverride: () => ({ mutateAsync: mocks.deleteOverride, isPending: false }),
}))

describe('Taxas Locais user behaviours', () => {
  afterEach(cleanup)

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.confirm.mockResolvedValue(true)
    mocks.saveTable.mockResolvedValue(2)
    mocks.saveItem.mockResolvedValue(11)
    mocks.saveOverride.mockResolvedValue(21)
  })

  it('cria uma tabela valida e normaliza o POD na interface', async () => {
    const user = userEvent.setup()
    render(
      <ChargeTablesTab
        cargoModeFilter=""
        setCargoModeFilter={vi.fn()}
        podFilter=""
        setPodFilter={vi.fn()}
        canEdit
        canDelete
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Nova tabela / Novo item' }))
    await user.type(screen.getByLabelText('Nome da tabela'), 'Tabela Santos')
    await user.type(screen.getByLabelText('POD'), 'brssz')
    await user.type(screen.getByLabelText('Vigencia inicial'), '2026-06-01')
    await user.click(screen.getByRole('button', { name: 'Criar tabela' }))

    expect(mocks.saveTable).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Tabela Santos',
      pod: 'BRSSZ',
      validFrom: '2026-06-01',
    }))
  })

  it('inativa tabela e exclui item somente apos confirmacao', async () => {
    const user = userEvent.setup()
    render(
      <ChargeTablesTab
        cargoModeFilter=""
        setCargoModeFilter={vi.fn()}
        podFilter=""
        setPodFilter={vi.fn()}
        canEdit
        canDelete
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Desativar tabela' }))
    const disclosure = screen.getByTitle('Ver itens')
    expect(disclosure.getAttribute('aria-expanded')).toBe('false')
    expect(disclosure.getAttribute('aria-controls')).toBe('charge-table-items-1')
    await user.click(disclosure)
    expect(disclosure.getAttribute('aria-expanded')).toBe('true')
    expect(document.getElementById('charge-table-items-1')).not.toBeNull()
    await user.click(screen.getByTitle('Excluir item'))

    expect(mocks.toggleTable).toHaveBeenCalledWith({ id: 1, active: false })
    expect(mocks.confirm).toHaveBeenCalled()
    expect(mocks.deleteItem).toHaveBeenCalledWith(10)
  })

  it('cria override com cliente, item e vigencia selecionados', async () => {
    const user = userEvent.setup()
    render(
      <ChargeOverridesTab
        cargoModeFilter=""
        setCargoModeFilter={vi.fn()}
        podFilter=""
        setPodFilter={vi.fn()}
        canEdit
        canDelete
      />,
    )

    await user.selectOptions(screen.getByLabelText('Cliente'), '2')
    await user.selectOptions(screen.getByLabelText('Item de taxa'), '10')
    await user.type(screen.getByLabelText('Valor override'), '75,50')
    await user.type(screen.getByLabelText('Vigencia inicial'), '2026-06-01')
    await user.click(screen.getByRole('button', { name: 'Criar override' }))

    expect(mocks.saveOverride).toHaveBeenCalledWith(expect.objectContaining({
      customerId: 2,
      chargeItemId: 10,
      overrideValue: 75.5,
      validFrom: '2026-06-01',
    }))
  })

  it('quem edita mas nao e Administrativo nao ve Excluir override', () => {
    render(
      <ChargeOverridesTab
        cargoModeFilter=""
        setCargoModeFilter={vi.fn()}
        podFilter=""
        setPodFilter={vi.fn()}
        canEdit
        canDelete={false}
      />,
    )

    expect(screen.getByRole('button', { name: 'Editar override' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Excluir override' })).toBeNull()
  })

  it('carrega override para edicao e confirma sua exclusao', async () => {
    const user = userEvent.setup()
    render(
      <ChargeOverridesTab
        cargoModeFilter=""
        setCargoModeFilter={vi.fn()}
        podFilter=""
        setPodFilter={vi.fn()}
        canEdit
        canDelete
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Editar override' }))
    expect(screen.getByRole('button', { name: 'Salvar override' })).toBeTruthy()
    expect((screen.getByLabelText('Valor override') as HTMLInputElement).value).toBe('80')

    await user.click(screen.getByRole('button', { name: 'Excluir override' }))
    expect(mocks.confirm).toHaveBeenCalled()
    expect(mocks.deleteOverride).toHaveBeenCalledWith(20)
  })

  it('mostra a tabela de tabelas sem controles de escrita quando canEdit e falso', () => {
    render(
      <ChargeTablesTab
        cargoModeFilter=""
        setCargoModeFilter={vi.fn()}
        podFilter=""
        setPodFilter={vi.fn()}
        canEdit={false}
        canDelete={false}
      />,
    )

    expect(screen.getByText('Tabela Vitória')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Nova tabela / Novo item' })).toBeNull()
    expect(screen.queryByLabelText('Editar tabela')).toBeNull()
  })

  it('mostra os overrides sem formulario nem acoes de escrita quando canEdit e falso', () => {
    render(
      <ChargeOverridesTab
        cargoModeFilter=""
        setCargoModeFilter={vi.fn()}
        podFilter=""
        setPodFilter={vi.fn()}
        canEdit={false}
        canDelete={false}
      />,
    )

    expect(screen.getByText('Cliente A')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Criar override' })).toBeNull()
    expect(screen.queryByLabelText('Editar override')).toBeNull()
  })
})
