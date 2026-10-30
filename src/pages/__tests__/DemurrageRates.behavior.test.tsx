// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const rates = [
  { id: 1, container_type: '20GP', free_days: 21, p1_day_from: 22, p1_day_to: 30, p1_usd: 100, p2_day_from: 31, p2_usd: 150, valid_from: null, valid_to: null, active: true, notes: null },
  { id: 2, container_type: '45HC', free_days: 21, p1_day_from: 22, p1_day_to: 30, p1_usd: 110, p2_day_from: 31, p2_usd: 160, valid_from: '2099-01-01', valid_to: null, active: true, notes: null },
  { id: 3, container_type: '40RF', free_days: 21, p1_day_from: 22, p1_day_to: 30, p1_usd: 120, p2_day_from: 31, p2_usd: 170, valid_from: null, valid_to: null, active: false, notes: null },
]

const agreements = [
  {
    id: 101,
    customer_id: 5,
    free_days: 28,
    p1_usd: 20,
    p2_usd: 40,
    valid_from: '2026-01-01',
    valid_to: null,
    active: true,
    notes: 'Acordo VIP',
    customer: { id: 5, name: 'ACME LOGISTICA', cnpj_cpf: '12345678000199' },
  },
]

// Mock na interface do módulo de tarifas — não no query builder do supabase.
const svc = vi.hoisted(() => ({
  listDemurrageRates: vi.fn(() => Promise.resolve(rates)),
  upsertDemurrageRate: vi.fn(() => Promise.resolve()),
  deleteDemurrageRate: vi.fn(() => Promise.resolve()),
  toggleDemurrageRateActive: vi.fn(() => Promise.resolve()),
  invalidateDemurrageRatesCache: vi.fn(),
}))

// Uma tarifa por grupo (ADR 0112, D28): a linha mostra o grupo e os tipos que ele cobre.
const typesSvc = vi.hoisted(() => ({
  listDemurrageRateGroups: vi.fn(() => Promise.resolve([
    { code: '20GP', name: "20' dry", sort_order: 1 },
    { code: '40GP', name: "40' dry", sort_order: 2 },
    { code: '40RF', name: "40' reefer", sort_order: 6 },
  ])),
  listContainerTypes: vi.fn(() => Promise.resolve([
    { id: 1, code: '20GP', description: "20' dry", rate_group: '20GP', active: true },
    { id: 2, code: '20HC', description: "20' high cube", rate_group: '20GP', active: true },
    { id: 3, code: '40HC', description: "40' high cube", rate_group: '40GP', active: true },
    { id: 4, code: '40G1', description: "40' dry", rate_group: '40GP', active: false },
  ])),
  saveContainerType: vi.fn(() => Promise.resolve()),
  toggleContainerTypeActive: vi.fn(() => Promise.resolve()),
  deleteContainerType: vi.fn(() => Promise.resolve()),
  normalizeContainerTypeCode: (value: unknown) => String(value ?? '').trim().toUpperCase(),
}))

const agreementSvc = vi.hoisted(() => ({
  listCustomerDemurrageAgreements: vi.fn(() => Promise.resolve(agreements)),
  saveCustomerDemurrageAgreement: vi.fn(() => Promise.resolve()),
  deleteCustomerDemurrageAgreement: vi.fn(() => Promise.resolve()),
  toggleCustomerDemurrageAgreementActive: vi.fn(() => Promise.resolve()),
}))

vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ isAdmin: true, effectiveRole: 'administrativo' }) }))
vi.mock('../../components/ui/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }))
vi.mock('../../components/ui/ConfirmDialog', () => ({ useConfirm: () => vi.fn(() => Promise.resolve(true)), useConfirmWithReason: () => vi.fn(() => Promise.resolve('motivo')) }))
vi.mock('../../services/demurrage/demurrageRates', () => svc)
vi.mock('../../services/demurrage/customerDemurrageAgreements', () => agreementSvc)
vi.mock('../../services/demurrage/containerTypes', () => typesSvc)

import { DemurrageRates } from '../DemurrageRates'

function renderPage(initialEntries = ['/demurrage/taxas']) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <QueryClientProvider client={client}>
        <DemurrageRates />
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => vi.clearAllMocks())
afterEach(cleanup)

it('US-051: lista as tarifas de demurrage', async () => {
  renderPage()
  expect(await screen.findByText("20' dry")).toBeTruthy()
  // Os tipos ativos que cada grupo cobre aparecem na linha.
  expect(await screen.findByText('20GP, 20HC')).toBeTruthy()
  expect(screen.getAllByText('Ativa')).toHaveLength(2)
  expect(screen.getAllByText('dias 22 a 30').length).toBeGreaterThan(0)
  expect(screen.getAllByText('a partir do dia 31').length).toBeGreaterThan(0)
})

it('US-052: cria uma nova tarifa pelo modal', async () => {
  const user = userEvent.setup()
  renderPage()

  await user.click(screen.getByRole('button', { name: /Nova tarifa/ }))
  await user.selectOptions(await screen.findByRole('combobox', { name: /Grupo de tarifa/ }), '40GP')
  const [p1Usd, p2Usd] = screen.getAllByLabelText(/Diária \(USD\)/)
  await user.type(p1Usd, '75,50')
  await user.type(p2Usd, '150')
  await user.click(screen.getByRole('button', { name: 'Cadastrar tarifa' }))

  await waitFor(() => expect(svc.upsertDemurrageRate).toHaveBeenCalled())
  expect((svc.upsertDemurrageRate.mock.calls[0] as unknown[])[0]).toMatchObject({ container_type: '40GP', p1_usd: 75.5, p2_usd: 150, free_days: 21, active: true })
})

it('mostra o erro junto do campo e não grava a tarifa sem diária', async () => {
  const user = userEvent.setup()
  renderPage()

  await user.click(screen.getByRole('button', { name: /Nova tarifa/ }))
  await user.selectOptions(await screen.findByRole('combobox', { name: /Grupo de tarifa/ }), '40GP')
  await user.click(screen.getByRole('button', { name: 'Cadastrar tarifa' }))

  expect(screen.getAllByRole('alert').map((node) => node.textContent)).toContain('Informe a diária de P1 em USD.')
  expect(svc.upsertDemurrageRate).not.toHaveBeenCalled()
})

it('US-053: ativa/desativa a tarifa pelo menu da linha', async () => {
  const user = userEvent.setup()
  renderPage()

  await user.click(await screen.findByRole('button', { name: "Mais ações da tarifa 20' dry" }))
  await user.click(screen.getByRole('menuitem', { name: 'Desativar tarifa' }))

  await waitFor(() => expect(svc.toggleDemurrageRateActive).toHaveBeenCalledWith(1, false, ''))
})

it('B13: reativar a tarifa pede motivo e diz Reativar', async () => {
  const user = userEvent.setup()
  renderPage()

  // A tarifa inativa só aparece com "Mostrar inativas" (decisão de 2026-10-16), em cinza.
  await screen.findByRole('button', { name: "Mais ações da tarifa 20' dry" })
  expect(screen.queryByRole('button', { name: "Mais ações da tarifa 40' reefer" })).toBeNull()
  await user.click(screen.getByRole('checkbox', { name: /Mostrar inativas/ }))
  expect(screen.getByText("40' reefer").closest('tr')!.className).toContain('app-table__row--muted')
  await user.click(await screen.findByRole('button', { name: "Mais ações da tarifa 40' reefer" }))
  await user.click(screen.getByRole('menuitem', { name: 'Reativar tarifa' }))

  await waitFor(() => expect(svc.toggleDemurrageRateActive).toHaveBeenCalledWith(3, true, 'motivo'))
})

it('US-054: exclui a tarifa que ainda não entrou em vigor', async () => {
  const user = userEvent.setup()
  renderPage()

  await user.click(await screen.findByRole('button', { name: 'Mais ações da tarifa 45HC' }))
  await user.click(screen.getByRole('menuitem', { name: 'Excluir tarifa' }))

  await waitFor(() => expect(svc.deleteDemurrageRate).toHaveBeenCalledWith(2, 'motivo'))
})

it('tarifa em vigor não oferece excluir, que o banco sempre recusa (migration 091)', async () => {
  const user = userEvent.setup()
  renderPage()

  await user.click(await screen.findByRole('button', { name: "Mais ações da tarifa 20' dry" }))
  const item = screen.getByRole('menuitem', { name: 'Excluir tarifa (já em vigor: desative)' })
  expect(item.hasAttribute('disabled') || item.getAttribute('aria-disabled') === 'true').toBe(true)
  await user.click(item)
  expect(svc.deleteDemurrageRate).not.toHaveBeenCalled()
})

it('P2 começando dentro de P1 é recusado junto do campo, como a constraint do banco', async () => {
  const user = userEvent.setup()
  renderPage()

  await user.click(screen.getByRole('button', { name: /Nova tarifa/ }))
  await user.selectOptions(await screen.findByRole('combobox', { name: /Grupo de tarifa/ }), '40GP')
  const [p1Usd, p2Usd] = screen.getAllByLabelText(/Diária \(USD\)/)
  await user.type(p1Usd, '75')
  await user.type(p2Usd, '150')
  const p2From = screen.getByLabelText(/A partir do dia/)
  await user.clear(p2From)
  await user.type(p2From, '30')
  await user.click(screen.getByRole('button', { name: 'Cadastrar tarifa' }))

  expect(screen.getAllByRole('alert').map((node) => node.textContent)).toContain('P2 começa depois do fim de P1 (dia 31 ou depois).')
  expect(svc.upsertDemurrageRate).not.toHaveBeenCalled()
})

it('recusa de constraint do banco aparece legível, sem o texto cru do Postgres', async () => {
  svc.upsertDemurrageRate.mockImplementationOnce(() => Promise.reject({ code: '23514', message: 'new row for relation "demurrage_rates" violates check constraint "demurrage_rates_intrinsic_sanity_chk"' }))
  const user = userEvent.setup()
  renderPage()

  await user.click(screen.getByRole('button', { name: /Nova tarifa/ }))
  await user.selectOptions(await screen.findByRole('combobox', { name: /Grupo de tarifa/ }), '40GP')
  const [p1Usd, p2Usd] = screen.getAllByLabelText(/Diária \(USD\)/)
  await user.type(p1Usd, '75')
  await user.type(p2Usd, '150')
  await user.click(screen.getByRole('button', { name: 'Cadastrar tarifa' }))

  const alert = await screen.findByText(/A tarifa não foi salva/)
  expect(alert.textContent).toContain('Dados fora das regras do cadastro.')
  expect(alert.textContent).not.toContain('violates')
})

it('lista os acordos de clientes na aba correspondente, refletida na URL', async () => {
  const user = userEvent.setup()
  renderPage()

  await user.click(screen.getByRole('tab', { name: /Acordos de Clientes/ }))

  expect(await screen.findByText('ACME LOGISTICA')).toBeTruthy()
  expect(screen.getByText('28 dias')).toBeTruthy()
  expect(screen.getByText('Acordo VIP')).toBeTruthy()
  expect(screen.getByText('Vigente')).toBeTruthy()
})

it('abre os acordos filtrados pelo Cliente vindo da ficha', async () => {
  renderPage(['/demurrage/taxas?tab=acordos&cliente=ACME'])
  expect(await screen.findByText('ACME LOGISTICA')).toBeTruthy()
  expect((screen.getByLabelText('Buscar acordo por Cliente ou CNPJ') as HTMLInputElement).value).toBe('ACME')
})

it('aba Tipos de container lista o cadastro e abre o tipo vindo de Cadastrar tipo (ADR 0112, D29)', async () => {
  const user = userEvent.setup()
  renderPage(['/demurrage/taxas?tab=tipos&tipo=45hc'])
  // O tipo do link abre o cadastro já preenchido; falta escolher o grupo.
  expect(await screen.findByDisplayValue('45HC')).toBeTruthy()
  await screen.findByRole('option', { name: "40' dry" })
  await user.selectOptions(screen.getByRole('combobox', { name: /Grupo de tarifa/ }), '40GP')
  await user.type(screen.getByLabelText('Descrição'), "45' high cube")
  await user.click(screen.getByRole('button', { name: 'Cadastrar tipo' }))
  await waitFor(() => expect(typesSvc.saveContainerType).toHaveBeenCalledWith({ id: undefined, code: '45HC', description: "45' high cube", rate_group: '40GP' }))

  // Inativo fica escondido até Mostrar inativos.
  expect(await screen.findByText('40HC')).toBeTruthy()
  expect(screen.queryByText('40G1')).toBeNull()
})

it('o tipo do atalho já cadastrado e desativado não abre o cadastro novo: mostra os desativados (526)', async () => {
  renderPage(['/demurrage/taxas?tab=tipos&tipo=40G1'])
  expect(await screen.findByText('40G1')).toBeTruthy()
  expect(screen.queryByText('Novo tipo de container')).toBeNull()
})

it('editar um tipo não muda o código; o tipo com código de grupo não muda de grupo (528)', async () => {
  const user = userEvent.setup()
  renderPage(['/demurrage/taxas?tab=tipos'])
  await screen.findByText('40HC')
  await user.click(screen.getByRole('button', { name: 'Editar tipo 40HC' }))
  expect((screen.getByDisplayValue('40HC') as HTMLInputElement).readOnly).toBe(true)
})
