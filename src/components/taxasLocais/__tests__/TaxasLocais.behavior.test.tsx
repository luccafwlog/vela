// @vitest-environment jsdom

import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChargeOverridesTab } from '../ChargeOverridesTab'
import { ChargeTablesTab } from '../ChargeTablesTab'

const mocks = vi.hoisted(() => ({
  showToast: vi.fn(),
  confirm: vi.fn(),
  saveTable: vi.fn(),
  toggleTable: vi.fn(),
  toggleItem: vi.fn(),
  toggleOverride: vi.fn(),
  saveItem: vi.fn(),
  deleteItem: vi.fn(),
  saveOverride: vi.fn(),
  deleteOverride: vi.fn(),
  lookupCustomers: vi.fn(),
  activeConditions: { value: 0 },
}))

const item = (over: Record<string, unknown>) => ({
  id: 10,
  name: 'THD',
  category: 'base',
  application_basis: 'container_distinct_voyage',
  cargo_profile: 'standard',
  currency: 'BRL',
  unit_value_brl: 100,
  unit_value_usd: null,
  manual_only: false,
  applies_to_soc: true,
  active: true,
  sort_order: 10,
  ...over,
})

const tables = [
  {
    id: 1,
    name: 'Tabela Vitória',
    cargo_mode: 'container' as const,
    pod: 'BRVIT',
    valid_from: '2026-01-01',
    valid_to: null,
    active: true,
    notes: 'vigente',
    charge_table_items: [
      item({}),
      item({ id: 11, name: 'THD antigo', cargo_profile: 'any', sort_order: 20 }),
      item({ id: 12, name: 'Correction Letter', application_basis: 'bl', cargo_profile: 'any', manual_only: true, sort_order: 30 }),
      item({ id: 13, name: 'Booking (legado)', application_basis: 'teu', cargo_profile: 'any', manual_only: true, currency: 'USD', unit_value_brl: null, unit_value_usd: 150, sort_order: 40 }),
    ],
  },
  {
    id: 2,
    name: 'Tabela Vitória 2025',
    cargo_mode: 'container' as const,
    // Grafia diferente do mesmo porto: o motor agrupa BRVIT com BRVIX.
    pod: 'BRVIX',
    valid_from: '2025-01-01',
    valid_to: '2025-12-31',
    active: true,
    notes: null,
    charge_table_items: [item({ id: 20, name: 'B/L Fee', application_basis: 'bl', cargo_profile: 'any' })],
  },
  {
    id: 3,
    name: 'Salvador Carga Solta 2027',
    cargo_mode: 'carga_solta' as const,
    pod: 'BRSSA',
    valid_from: '2027-01-01',
    valid_to: null,
    active: true,
    notes: null,
    charge_table_items: [],
  },
]

const chargeTableRef = (table: typeof tables[number]) => ({
  id: table.id,
  name: table.name,
  cargo_mode: table.cargo_mode,
  pod: table.pod,
  valid_from: table.valid_from,
  valid_to: table.valid_to,
  active: table.active,
})

const overrides = [
  {
    id: 20,
    customer_id: 2,
    charge_item_id: 10,
    override_value: 80,
    valid_from: '2026-01-01',
    valid_to: null,
    notes: 'acordo',
    created_at: '2026-01-01T00:00:00Z',
    active: true,
    customer: { id: 2, name: 'Cliente A', cnpj_cpf: '12345678000190' },
    charge_item: { id: 10, name: 'THD', currency: 'BRL', unit_value_brl: 100, unit_value_usd: null, active: true, application_basis: 'container_distinct_voyage', charge_table: chargeTableRef(tables[0]) },
  },
  {
    id: 21,
    customer_id: 3,
    charge_item_id: 20,
    override_value: 50,
    valid_from: '2026-01-01',
    valid_to: null,
    notes: null,
    created_at: '2026-01-02T00:00:00Z',
    active: true,
    customer: { id: 3, name: 'Cliente B', cnpj_cpf: '23456789000101' },
    charge_item: { id: 20, name: 'B/L Fee', currency: 'BRL', unit_value_brl: 100, unit_value_usd: null, active: true, application_basis: 'bl', charge_table: chargeTableRef(tables[1]) },
  },
  {
    id: 22,
    customer_id: 4,
    charge_item_id: 30,
    override_value: 30,
    valid_from: '2099-01-01',
    valid_to: null,
    notes: null,
    created_at: '2026-01-03T00:00:00Z',
    active: true,
    customer: { id: 4, name: 'Cliente C', cnpj_cpf: '34567890000112' },
    charge_item: { id: 30, name: 'Documentação', currency: 'USD', unit_value_brl: null, unit_value_usd: 35, active: true, application_basis: 'bl', charge_table: chargeTableRef(tables[0]) },
  },
]

const overrideItems = [
  { id: 10, name: 'THD', currency: 'BRL', unit_value_brl: 100, unit_value_usd: null, cargo_profile: 'standard', application_basis: 'container_distinct_voyage', charge_table: chargeTableRef(tables[0]) },
]

vi.mock('../../ui/Toast', () => ({
  useToast: () => ({ showToast: mocks.showToast }),
}))
vi.mock('../../ui/ConfirmDialog', () => ({
  useConfirm: () => mocks.confirm,
  useConfirmWithReason: () => async (o: unknown) => ((await mocks.confirm(o)) ? 'motivo' : null),
}))
vi.mock('../../../hooks/useLocalCharges', () => ({
  useLocalChargeTables: () => ({ data: tables, isLoading: false, error: null, refetch: vi.fn(), isFetching: false }),
  useSaveChargeTable: () => ({ mutateAsync: mocks.saveTable, isPending: false }),
  useSetChargeTableActive: () => ({ mutateAsync: mocks.toggleTable, isPending: false }),
  useSetChargeTableItemActive: () => ({ mutateAsync: mocks.toggleItem, isPending: false }),
  useSetCustomerRateOverrideActive: () => ({ mutateAsync: mocks.toggleOverride, isPending: false }),
  useSaveChargeTableItem: () => ({ mutateAsync: mocks.saveItem, isPending: false }),
  useDeleteChargeTableItem: () => ({ mutateAsync: mocks.deleteItem, isPending: false }),
  useCustomerRateOverrides: () => ({ data: overrides, isLoading: false, error: null, refetch: vi.fn(), isFetching: false }),
  useOverrideChargeItems: () => ({ data: overrideItems, isLoading: false, error: null }),
  useOverrideCustomerLookup: () => mocks.lookupCustomers,
  useActiveConditionCount: (id: number | null) => ({ data: id == null ? undefined : mocks.activeConditions.value }),
  useSaveCustomerRateOverride: () => ({ mutateAsync: mocks.saveOverride, isPending: false }),
  useDeleteCustomerRateOverride: () => ({ mutateAsync: mocks.deleteOverride, isPending: false }),
}))

const filterProps = {
  cargoModeFilter: '' as const,
  setCargoModeFilter: vi.fn(),
  podFilter: '',
  setPodFilter: vi.fn(),
}

function renderTables(props: Partial<Parameters<typeof ChargeTablesTab>[0]> = {}) {
  return render(<ChargeTablesTab {...filterProps} lens="todas" setLens={vi.fn()} canEdit canDelete {...props} />)
}

function renderConditions(props: Partial<Parameters<typeof ChargeOverridesTab>[0]> = {}) {
  return render(
    <ChargeOverridesTab {...filterProps} lens="todas" setLens={vi.fn()} customerSearch="" setCustomerSearch={vi.fn()} canEdit canDelete {...props} />,
  )
}

async function openMenu(user: ReturnType<typeof userEvent.setup>, name: RegExp | string) {
  await user.click(screen.getByRole('button', { name }))
  return screen.getByRole('menu')
}

describe('Tabelas de Taxas Locais', () => {
  afterEach(cleanup)

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.confirm.mockResolvedValue(true)
    mocks.saveTable.mockResolvedValue(9)
    mocks.saveItem.mockResolvedValue(11)
    mocks.saveOverride.mockResolvedValue(21)
    mocks.activeConditions.value = 0
  })

  it('agrupa pelo escopo do motor e diz qual tabela vale e por que a outra não', () => {
    renderTables()

    const vitoria = screen.getByRole('region', { name: 'Container · BRVIX' })
    expect(within(vitoria).getByText('Tabela Vitória', { selector: 'strong' })).toBeTruthy()
    // BRVIX caiu no mesmo escopo e perde o desempate pela vigência inicial.
    expect(within(vitoria).getByText('Não aplicada')).toBeTruthy()
    expect(within(vitoria).getByText(/"Tabela Vitória" tem vigência inicial mais recente/)).toBeTruthy()
    // A perdedora não está no cálculo: sem o aviso "continua no cálculo".
    expect(within(vitoria).queryByText(/Vigência encerrada em 31\/12\/2025/)).toBeNull()

    const salvador = screen.getByRole('region', { name: 'Carga solta · BRSSA' })
    expect(within(salvador).getByText('Aplicada no cálculo')).toBeTruthy()
    expect(within(salvador).getByText(/Vigência começa em 01\/01\/2027, mas já está no cálculo/)).toBeTruthy()
    expect(within(salvador).getByText('Sem item automático: o cálculo deste escopo não gera taxa.')).toBeTruthy()
  })

  it('abre os itens com unidade, perfil e o que o motor faz com cada um', async () => {
    const user = userEvent.setup()
    renderTables()

    const toggle = screen.getByRole('button', { name: /^Tabela Vitória, ver itens/ })
    expect(toggle.getAttribute('aria-controls')).toBe('charge-table-items-1')
    await user.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')

    const items = screen.getByRole('region', { name: 'Itens da tabela Tabela Vitória' })
    expect(within(items).getAllByText('por container').length).toBeGreaterThan(0)
    expect(within(items).getByText(/Também é a base do container IMO e OOG/)).toBeTruthy()
    expect(within(items).getByText(/THD com perfil "Todos" não é calculado/)).toBeTruthy()
    expect(within(items).getAllByText('Só manual').length).toBe(2)
  })

  it('cadastra tabela no modal, mostrando antes de gravar que ela passa a valer no escopo', async () => {
    const user = userEvent.setup()
    renderTables()

    await user.click(screen.getByRole('button', { name: 'Nova tabela' }))
    const dialog = screen.getByRole('dialog', { name: 'Nova tabela de taxas' })
    await user.type(within(dialog).getByLabelText(/Nome da tabela/), 'Vitória 2027')
    await user.type(within(dialog).getByLabelText(/^POD/), 'brvit')
    await user.type(within(dialog).getByLabelText(/Vigência inicial/), '2027-01-01')

    expect(within(dialog).getByText(/Passa a ser a tabela aplicada em Container · BRVIX, no lugar de "Tabela Vitória"/)).toBeTruthy()
    await user.click(within(dialog).getByRole('button', { name: 'Cadastrar tabela' }))

    expect(mocks.confirm).not.toHaveBeenCalled()
    expect(mocks.saveTable).toHaveBeenCalledWith(expect.objectContaining({ name: 'Vitória 2027', pod: 'BRVIT', validFrom: '2027-01-01', active: true }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('mostra o erro junto do campo e não grava tabela sem nome', async () => {
    const user = userEvent.setup()
    renderTables()

    await user.click(screen.getByRole('button', { name: 'Nova tabela' }))
    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Cadastrar tabela' }))

    expect(within(dialog).getByText('Informe o nome da tabela.')).toBeTruthy()
    expect(within(dialog).getByLabelText(/Nome da tabela/).getAttribute('aria-invalid')).toBe('true')
    expect(mocks.saveTable).not.toHaveBeenCalled()
  })

  it('na edição lista as alterações antes de salvar e mantém o modal aberto se a gravação falhar', async () => {
    const user = userEvent.setup()
    mocks.saveTable.mockRejectedValueOnce(Object.assign(new Error('Somente o Administrativo desativa ou reativa tarifas.'), { code: '42501' }))
    renderTables()

    await user.click(screen.getByRole('button', { name: 'Editar tabela Tabela Vitória' }))
    const dialog = screen.getByRole('dialog')
    expect((within(dialog).getByRole('button', { name: 'Nenhuma alteração' }) as HTMLButtonElement).disabled).toBe(true)

    const name = within(dialog).getByLabelText(/Nome da tabela/)
    await user.clear(name)
    await user.type(name, 'Tabela Vitória Atualizada')
    const changes = within(dialog).getByRole('status', { name: 'Alterações a salvar' })
    expect(within(changes).getByText('Tabela Vitória Atualizada')).toBeTruthy()

    await user.click(within(dialog).getByRole('button', { name: 'Salvar 1 alteração' }))
    expect(mocks.saveTable).toHaveBeenCalledWith(expect.objectContaining({ id: 1, name: 'Tabela Vitória Atualizada' }))
    expect(await within(dialog).findByText(/Somente o Administrativo/)).toBeTruthy()
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('desativa a tabela aplicada pelo menu, com a consequência para o escopo', async () => {
    const user = userEvent.setup()
    renderTables()

    const menu = await openMenu(user, 'Mais ações da tabela Tabela Vitória')
    await user.click(within(menu).getByRole('menuitem', { name: 'Desativar tabela' }))

    expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Desativar tabela de taxas',
      tone: 'danger',
      consequence: expect.stringContaining('Sai do cálculo de Container · BRVIX'),
    }))
    expect(mocks.toggleTable).toHaveBeenCalledWith({ id: 1, active: false })
  })

  it('cadastra item com valor em formato brasileiro e exclui item só depois da confirmação', async () => {
    const user = userEvent.setup()
    renderTables()

    await user.click(screen.getByRole('button', { name: /^Tabela Vitória, ver itens/ }))
    await user.click(screen.getByRole('button', { name: 'Adicionar item' }))
    const dialog = screen.getByRole('dialog', { name: 'Novo item de taxa' })
    expect(within(dialog).getByText('Tabela Vitória', { selector: 'strong' })).toBeTruthy()
    await user.type(within(dialog).getByLabelText(/Nome do item/), 'ISPS')
    await user.type(within(dialog).getByLabelText(/Valor unitário/), '1.420,50')
    await user.click(within(dialog).getByRole('button', { name: 'Cadastrar item' }))
    expect(mocks.saveItem).toHaveBeenCalledWith(expect.objectContaining({ chargeTableId: 1, name: 'ISPS', unitValue: 1420.5, manualOnly: false }))

    const menu = await openMenu(user, 'Mais ações do item THD antigo')
    await user.click(within(menu).getByRole('menuitem', { name: 'Excluir item' }))
    expect(mocks.deleteItem).toHaveBeenCalledWith({ id: 11, reason: 'motivo' })
  })

  it('item legado em TEU abre com a opção desativada, sem o select ficar em branco', async () => {
    const user = userEvent.setup()
    renderTables()

    await user.click(screen.getByRole('button', { name: /^Tabela Vitória, ver itens/ }))
    await user.click(screen.getByRole('button', { name: 'Editar item Booking (legado)' }))
    const option = screen.getByRole('option', { name: /TEU/ }) as HTMLOptionElement
    expect(option.disabled).toBe(true)
    expect(option.closest('select')?.value).toBe('teu')
  })

  it('item com condição de Cliente ativa não troca de moeda (migration 172)', async () => {
    mocks.activeConditions.value = 2
    const user = userEvent.setup()
    renderTables()

    await user.click(screen.getByRole('button', { name: /^Tabela Vitória, ver itens/ }))
    await user.click(screen.getByRole('button', { name: 'Editar item Booking (legado)' }))
    const dialog = screen.getByRole('dialog')
    const usd = within(dialog).getByRole('radio', { name: 'Dólar (US$)' }) as HTMLButtonElement
    const brl = within(dialog).getByRole('radio', { name: 'Real (R$)' }) as HTMLButtonElement
    // O item é em dólar: real fica travado.
    expect(brl.disabled).toBe(true)
    expect(usd.disabled).toBe(false)
    expect(within(dialog).getByText(/2 condições de Cliente ativas usam o valor nesta moeda/)).toBeTruthy()
  })

  it('sem permissão de escrita, mostra as tabelas sem ações', () => {
    renderTables({ canEdit: false, canDelete: false })

    expect(screen.getAllByText('Tabela Vitória').length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: 'Nova tabela' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Editar tabela/ })).toBeNull()
  })

  it('quem edita mas não é Administrativo não recebe desativar no menu', async () => {
    const user = userEvent.setup()
    renderTables({ canDelete: false })

    const menu = await openMenu(user, 'Mais ações da tabela Tabela Vitória')
    expect(within(menu).getByRole('menuitem', { name: 'Adicionar item' })).toBeTruthy()
    expect(within(menu).queryByRole('menuitem', { name: 'Desativar tabela' })).toBeNull()
  })

  it('lente "Com aviso" e recorte vazio oferecem Limpar filtros', async () => {
    const user = userEvent.setup()
    const setLens = vi.fn()
    const setPodFilter = vi.fn()
    renderTables({ lens: 'inativas', setLens, setPodFilter })

    expect(screen.getByText('Nenhuma tabela neste recorte')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Limpar filtros' }))
    expect(setLens).toHaveBeenCalledWith('todas')
    expect(setPodFilter).toHaveBeenCalledWith('')
  })
})

describe('Condições de Cliente', () => {
  afterEach(cleanup)

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.confirm.mockResolvedValue(true)
    mocks.saveOverride.mockResolvedValue(21)
    mocks.lookupCustomers.mockResolvedValue([{ id: 2, name: 'Cliente A', cnpj_cpf: '12345678000190' }])
  })

  it('mostra vigência de hoje, valor da tabela e quando a condição não muda a cobrança', () => {
    renderConditions()

    const rowA = screen.getByText('Cliente A').closest('tr') as HTMLElement
    expect(within(rowA).getByText('Vigente hoje')).toBeTruthy()
    expect(within(rowA).getByText(/−20% em relação|−20%/)).toBeTruthy()

    const rowB = screen.getByText('Cliente B').closest('tr') as HTMLElement
    expect(within(rowB).getByText(/não é a aplicada \("Tabela Vitória" vence\)/)).toBeTruthy()

    const rowC = screen.getByText('Cliente C').closest('tr') as HTMLElement
    expect(within(rowC).getByText('Começa em 01/01/2099')).toBeTruthy()
    // Migration 171: condição em item USD muda a cobrança, então não há aviso.
    expect(within(rowC).queryByText(/dólar/)).toBeNull()

    expect(screen.getByText('vigentes sem efeito no cálculo')).toBeTruthy()
  })

  it('cadastra condição escolhendo Cliente e item pela busca', async () => {
    const user = userEvent.setup()
    renderConditions()

    await user.click(screen.getByRole('button', { name: 'Nova condição' }))
    const dialog = screen.getByRole('dialog', { name: 'Nova condição de Cliente' })

    await user.type(within(dialog).getByRole('combobox', { name: /Cliente/ }), 'Clie')
    await user.click(await screen.findByRole('option', { name: /Cliente A/ }, { timeout: 2000 }))
    expect(mocks.lookupCustomers).toHaveBeenCalledWith('Clie')

    await user.type(within(dialog).getByRole('combobox', { name: /Item de taxa/ }), 'THD')
    await user.click(await screen.findByRole('option', { name: /THD · Padrão — Tabela Vitória/ }, { timeout: 2000 }))
    expect(within(dialog).getByText(/Valor da tabela:/)).toBeTruthy()

    await user.type(within(dialog).getByLabelText(/Valor negociado/), '75,50')
    expect(within(dialog).getByText('−24,5% em relação à tabela')).toBeTruthy()
    await user.type(within(dialog).getByLabelText(/Vigência inicial/), '2026-06-01')
    await user.click(within(dialog).getByRole('button', { name: 'Cadastrar condição' }))

    expect(mocks.saveOverride).toHaveBeenCalledWith(expect.objectContaining({
      id: null,
      customerId: 2,
      chargeItemId: 10,
      overrideValue: 75.5,
      validFrom: '2026-06-01',
    }))
  })

  it('não grava sem Cliente e mostra o motivo junto do campo', async () => {
    const user = userEvent.setup()
    renderConditions()

    await user.click(screen.getByRole('button', { name: 'Nova condição' }))
    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Cadastrar condição' }))
    expect(within(dialog).getByText('Selecione o Cliente da condição.')).toBeTruthy()
    expect(mocks.saveOverride).not.toHaveBeenCalled()
  })

  it('edita o valor com Cliente e item fixos e mostra o conflito de vigência no modal', async () => {
    const user = userEvent.setup()
    mocks.saveOverride.mockRejectedValueOnce(new Error('Já existe uma condição para este cliente e item com vigência a partir de 2025-01-01 (id 9).'))
    renderConditions()

    await user.click(screen.getByRole('button', { name: 'Editar condição Cliente A · THD' }))
    const dialog = screen.getByRole('dialog', { name: 'Editar condição de Cliente' })
    expect(within(dialog).queryByRole('combobox')).toBeNull()
    const value = within(dialog).getByLabelText(/Valor negociado/) as HTMLInputElement
    expect(value.value).toBe('80')
    await user.clear(value)
    await user.type(value, '85')
    await user.click(within(dialog).getByRole('button', { name: 'Salvar 1 alteração' }))

    expect(mocks.saveOverride).toHaveBeenCalledWith(expect.objectContaining({ id: 20, overrideValue: 85 }))
    expect(await within(dialog).findByText(/Já existe uma condição para este cliente/)).toBeTruthy()
  })

  it('Administrativo desativa e exclui pelo menu, com confirmação (ADR 0073)', async () => {
    const user = userEvent.setup()
    renderConditions()

    let menu = await openMenu(user, 'Mais ações da condição Cliente A · THD')
    await user.click(within(menu).getByRole('menuitem', { name: 'Desativar condição' }))
    expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Desativar condição de Cliente', consequence: expect.any(String) }))
    expect(mocks.toggleOverride).toHaveBeenCalledWith({ id: 20, active: false })

    menu = await openMenu(user, 'Mais ações da condição Cliente A · THD')
    await user.click(within(menu).getByRole('menuitem', { name: 'Excluir condição' }))
    expect(mocks.deleteOverride).toHaveBeenCalledWith({ id: 20, reason: 'motivo' })
  })

  it('quem edita mas não é Administrativo não vê o menu; sem escrita, nenhuma ação', () => {
    const { unmount } = renderConditions({ canDelete: false })
    expect(screen.getByRole('button', { name: 'Editar condição Cliente A · THD' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Mais ações da condição/ })).toBeNull()
    unmount()

    renderConditions({ canEdit: false, canDelete: false })
    expect(screen.getByText('Cliente A')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Nova condição' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Editar condição/ })).toBeNull()
  })

  it('a lente filtra pela vigência de hoje', () => {
    renderConditions({ lens: 'futuras' })
    expect(screen.getByText('Cliente C')).toBeTruthy()
    expect(screen.queryByText('Cliente A')).toBeNull()
  })
})
