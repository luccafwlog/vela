// @vitest-environment jsdom

import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
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
  return render(<MemoryRouter><ChargeTablesTab {...filterProps} lens="todas" setLens={vi.fn()} canEdit canDelete {...props} /></MemoryRouter>)
}

function renderConditions(props: Partial<Parameters<typeof ChargeOverridesTab>[0]> = {}) {
  return render(
    <MemoryRouter>
      <ChargeOverridesTab {...filterProps} lens="todas" setLens={vi.fn()} customerSearch="" setCustomerSearch={vi.fn()} canEdit canDelete {...props} />
    </MemoryRouter>,
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

  it('agrupa pelo escopo do motor e diz qual tabela está em uso e por que a outra não', async () => {
    const user = userEvent.setup()
    renderTables()

    const vitoria = screen.getByRole('region', { name: 'Container · BRVIX' })
    expect(within(vitoria).getByText('Tabela Vitória', { selector: '.app-lead__value' })).toBeTruthy()
    expect(within(vitoria).getByText('em uso no cálculo')).toBeTruthy()
    expect(within(vitoria).queryByText(/ADR 0040/)).toBeNull()
    // BRVIX caiu no mesmo escopo e perde o desempate pela vigência inicial.
    expect(within(vitoria).getByText('Ativa, mas não usada')).toBeTruthy()
    expect(within(vitoria).getByTitle(/"Tabela Vitória" começou depois e é a usada/)).toBeTruthy()
    // Aviso nos itens: o THD "Todos" da tabela em uso.
    expect(within(vitoria).getByText('1 item')).toBeTruthy()

    const salvador = screen.getByRole('region', { name: 'Carga solta · BRSSA' })
    expect(within(salvador).getByText('Em uso no cálculo')).toBeTruthy()
    await user.click(within(salvador).getByRole('button', { name: 'Salvador Carga Solta 2027' }))
    expect(within(salvador).getByText(/Vigência começa em 01\/01\/2027, mas já está no cálculo/)).toBeTruthy()
    expect(within(salvador).getByText(/Enquanto ela estiver em uso no cálculo/)).toBeTruthy()
  })

  it('a tabela em uso sem item automático e com vigência fora do período avisa na linha fechada e entra em "Com aviso"', () => {
    renderTables({ lens: 'aviso' })
    const salvador = screen.getByRole('region', { name: 'Carga solta · BRSSA' })
    const row = within(salvador).getByRole('button', { name: 'Salvador Carga Solta 2027' }).closest('tr') as HTMLElement
    expect(within(row).getByText('Sem item automático').closest('.app-status-text--warning')).toBeTruthy()
    expect(within(row).getByTitle(/Vigência começa em 01\/01\/2027/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /^Com aviso/ }).textContent).toContain('2')
  })

  it('a "Ativa, mas não usada" tem Desativar na linha para o Administrativo', async () => {
    const user = userEvent.setup()
    renderTables()

    await user.click(screen.getByRole('button', { name: 'Desativar tabela Tabela Vitória 2025' }))
    expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({ consequence: expect.stringContaining('já não era a usada') }))
    expect(mocks.toggleTable).toHaveBeenCalledWith({ id: 2, active: false, reason: '' })
    expect(screen.queryByRole('button', { name: 'Mais ações da tabela Tabela Vitória 2025' })).toBeNull()
  })

  it('os cartões contam pelos nomes novos e filtram pela lente', async () => {
    const user = userEvent.setup()
    const setLens = vi.fn()
    const { unmount } = renderTables({ setLens })

    const card = screen.getByRole('button', { name: /Ativas, mas não usadas/ })
    expect(card.textContent).toContain('1')
    expect(card.className).toContain('app-metric-tile--warning')
    await user.click(card)
    expect(setLens).toHaveBeenCalledWith('nao-usadas')
    unmount()

    renderTables({ lens: 'nao-usadas' })
    expect(screen.getByRole('button', { name: /Ativas, mas não usadas/ }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getAllByText('Tabela Vitória 2025').length).toBeGreaterThan(0)
    expect(screen.queryByRole('region', { name: 'Carga solta · BRSSA' })).toBeNull()
    // A lente esconde a tabela em uso, mas o escopo continua dizendo qual é.
    expect(screen.getByText('Tabela Vitória', { selector: '.app-lead__value' })).toBeTruthy()
  })

  it('abre os itens com unidade, perfil e o que o motor faz com cada um', async () => {
    const user = userEvent.setup()
    renderTables()

    const toggle = screen.getByRole('button', { name: 'Tabela Vitória' })
    await user.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('button', { name: 'Recolher os itens da tabela Tabela Vitória' }).getAttribute('aria-controls')).toBe('charge-table-items-1')

    const items = screen.getByRole('region', { name: 'Itens da tabela Tabela Vitória' })
    expect(within(items).getAllByText('por container').length).toBeGreaterThan(0)
    expect(within(items).getByText(/Também é a base do container IMO e OOG/)).toBeTruthy()
    expect(within(items).getByText(/THD com perfil "Todos" não é calculado/)).toBeTruthy()
    expect(within(items).getByTitle(/THD com perfil "Todos"/).textContent).toContain('THD sem perfil')
    expect(within(items).getAllByText('Só manual').length).toBe(2)
    expect(within(items).getByText('vigente')).toBeTruthy()
    expect(within(items).getAllByRole('button', { name: 'Adicionar item' })).toHaveLength(1)
  })

  it('cadastra tabela no modal, mostrando antes de gravar que ela passa a valer no escopo', async () => {
    const user = userEvent.setup()
    const onCreateDone = vi.fn()
    renderTables({ creating: true, onCreateDone })

    const dialog = screen.getByRole('dialog', { name: 'Nova tabela de taxas' })
    await user.type(within(dialog).getByLabelText(/Nome da tabela/), 'Vitória 2027')
    await user.type(within(dialog).getByLabelText(/^POD/), 'brvit')
    await user.type(within(dialog).getByLabelText(/Vigência inicial/), '2027-01-01')

    expect(within(dialog).getByText(/Passa a ser a tabela em uso no cálculo de Container · BRVIX, no lugar de "Tabela Vitória"/)).toBeTruthy()
    await user.click(within(dialog).getByRole('button', { name: 'Cadastrar tabela' }))

    expect(mocks.confirm).not.toHaveBeenCalled()
    expect(mocks.saveTable).toHaveBeenCalledWith(expect.objectContaining({ name: 'Vitória 2027', pod: 'BRVIT', validFrom: '2027-01-01', active: true }))
    expect(onCreateDone).toHaveBeenCalled()
  })

  it('mostra o erro junto do campo e não grava tabela sem nome', async () => {
    const user = userEvent.setup()
    renderTables({ creating: true })

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

    // Ação de linha da tabela: só o ícone, com o nome no title (regra 9).
    const editTable = screen.getByRole('button', { name: 'Editar tabela Tabela Vitória' })
    expect(editTable.textContent).toBe('')
    expect(editTable.getAttribute('title')).toBe('Editar tabela Tabela Vitória')
    await user.click(editTable)
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
      consequence: expect.stringContaining('Deixa de valer para B/Ls novos de Container · BRVIX'),
    }))
    expect(mocks.toggleTable).toHaveBeenCalledWith({ id: 1, active: false, reason: '' })
  })

  it('cadastra item com valor em formato brasileiro e exclui item só depois da confirmação', async () => {
    const user = userEvent.setup()
    renderTables()

    await user.click(screen.getByRole('button', { name: 'Tabela Vitória' }))
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

    await user.click(screen.getByRole('button', { name: 'Tabela Vitória' }))
    // A tabela de itens fica no painel da linha aberta, mas cada item é linha de tabela: ícone.
    const editItem = screen.getByRole('button', { name: 'Editar item Booking (legado)' })
    expect(editItem.textContent).toBe('')
    await user.click(editItem)
    const option = screen.getByRole('option', { name: /TEU/ }) as HTMLOptionElement
    expect(option.disabled).toBe(true)
    expect(option.closest('select')?.value).toBe('teu')
  })

  it('item com condição de Cliente ativa não troca de moeda (migration 172)', async () => {
    mocks.activeConditions.value = 2
    const user = userEvent.setup()
    renderTables()

    await user.click(screen.getByRole('button', { name: 'Tabela Vitória' }))
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

  it('quem edita mas não é Administrativo não recebe desativar nem o menu ⋮', async () => {
    const user = userEvent.setup()
    renderTables({ canDelete: false })

    expect(screen.queryByRole('button', { name: 'Mais ações da tabela Tabela Vitória' })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Desativar tabela/ })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Tabela Vitória' }))
    expect(screen.getByRole('button', { name: 'Adicionar item' })).toBeTruthy()
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
    expect(within(rowA).getByText('Vigente')).toBeTruthy()
    expect(within(rowA).getByText('R$ 100,00 (−20%)')).toBeTruthy()
    expect(within(rowA).getByText('R$ 80,00 por container')).toBeTruthy()
    expect(within(rowA).getByRole('link', { name: 'Cliente A' }).getAttribute('href')).toBe('/clientes/12345678000190')
    expect(within(rowA).queryByText(/12\.345\.678/)).toBeNull()
    expect(within(rowA).getByTitle('acordo')).toBeTruthy()

    const rowB = screen.getByText('Cliente B').closest('tr') as HTMLElement
    expect(within(rowB).getByText('Sem efeito no cálculo')).toBeTruthy()
    expect(within(rowB).getByTitle(/está ativa, mas não usada \("Tabela Vitória" está em uso no cálculo\)/)).toBeTruthy()

    const rowC = screen.getByText('Cliente C').closest('tr') as HTMLElement
    expect(within(rowC).getByText('Começa em 01/01/2099')).toBeTruthy()
    // Migration 171: condição em item USD muda a cobrança, então não há aviso.
    expect(within(rowC).queryByText(/dólar/)).toBeNull()

    const card = screen.getByRole('button', { name: /Sem efeito no cálculo/ })
    expect(card.textContent).toContain('1')
    expect(card.className).toContain('app-metric-tile--warning')
  })

  it('condição futura em tabela que não está em uso já avisa que fica sem efeito', () => {
    const future = { ...overrides[1], id: 23, valid_from: '2099-01-01', customer: { id: 5, name: 'Cliente D', cnpj_cpf: '45678901000123' } }
    overrides.push(future)
    try {
      renderConditions()
      const rowD = screen.getByText('Cliente D').closest('tr') as HTMLElement
      expect(rowD.textContent).toContain('Começa em 01/01/2099 · sem efeito no cálculo')
      expect(within(rowD).getByTitle(/está ativa, mas não usada/)).toBeTruthy()
      // O cartão conta só as vigentes.
      expect(screen.getByRole('button', { name: /Sem efeito no cálculo/ }).textContent).toContain('1')
    } finally {
      overrides.pop()
    }
  })

  it('cadastra condição escolhendo Cliente e item pela busca', async () => {
    const user = userEvent.setup()
    renderConditions({ creating: true })

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
    renderConditions({ creating: true })

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
    expect(mocks.toggleOverride).toHaveBeenCalledWith({ id: 20, active: false, reason: '' })

    menu = await openMenu(user, 'Mais ações da condição Cliente A · THD')
    await user.click(within(menu).getByRole('menuitem', { name: 'Excluir condição' }))
    expect(mocks.deleteOverride).toHaveBeenCalledWith({ id: 20, reason: 'motivo' })
  })

  it('quem edita mas não é Administrativo cria condição, mas não edita nem vê o menu; sem escrita, nenhuma ação', () => {
    // Editar Condição é correção de faturas: só o Administrativo (ADR 0093, decisão 2).
    const { unmount } = renderConditions({ canDelete: false })
    expect(screen.queryByRole('button', { name: 'Editar condição Cliente A · THD' })).toBeNull()
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

  it('o cartão "Sem efeito no cálculo" filtra só as vigentes que não mudam a cobrança', () => {
    renderConditions({ lens: 'sem-efeito' })
    expect(screen.getByText('Cliente B')).toBeTruthy()
    expect(screen.queryByText('Cliente A')).toBeNull()
    expect(screen.queryByText('Cliente C')).toBeNull()
  })
})
