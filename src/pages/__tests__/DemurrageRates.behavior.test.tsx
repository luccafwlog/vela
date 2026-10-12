// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const rates = [
  { id: 1, container_type: '20GP', free_days: 21, p1_day_from: 22, p1_day_to: 30, p1_usd: 100, p2_day_from: 31, p2_usd: 150, valid_from: null, valid_to: null, active: true, notes: null },
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
}))

const agreementSvc = vi.hoisted(() => ({
  listCustomerDemurrageAgreements: vi.fn(() => Promise.resolve(agreements)),
  saveCustomerDemurrageAgreement: vi.fn(() => Promise.resolve()),
  deleteCustomerDemurrageAgreement: vi.fn(() => Promise.resolve()),
  toggleCustomerDemurrageAgreementActive: vi.fn(() => Promise.resolve()),
}))

vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ isAdmin: true }) }))
vi.mock('../../components/ui/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }))
vi.mock('../../components/ui/ConfirmDialog', () => ({ useConfirm: () => vi.fn(() => Promise.resolve(true)), useConfirmWithReason: () => vi.fn(() => Promise.resolve('motivo')) }))
vi.mock('../../services/demurrage/demurrageRates', () => svc)
vi.mock('../../services/demurrage/customerDemurrageAgreements', () => agreementSvc)

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
  expect(await screen.findByText('20GP')).toBeTruthy()
  expect(screen.getByText('Ativa')).toBeTruthy()
  expect(screen.getByText('dias 22 a 30')).toBeTruthy()
  expect(screen.getByText('a partir do dia 31')).toBeTruthy()
})

it('US-052: cria uma nova tarifa pelo modal', async () => {
  const user = userEvent.setup()
  renderPage()

  await user.click(screen.getByRole('button', { name: /Nova tarifa/ }))
  await user.type(screen.getByPlaceholderText('20GP'), '40HC')
  const [p1Usd, p2Usd] = screen.getAllByLabelText(/Diária \(USD\)/)
  await user.type(p1Usd, '75,50')
  await user.type(p2Usd, '150')
  await user.click(screen.getByRole('button', { name: 'Cadastrar tarifa' }))

  await waitFor(() => expect(svc.upsertDemurrageRate).toHaveBeenCalled())
  expect((svc.upsertDemurrageRate.mock.calls[0] as unknown[])[0]).toMatchObject({ container_type: '40HC', p1_usd: 75.5, p2_usd: 150, free_days: 21, active: true })
})

it('mostra o erro junto do campo e não grava a tarifa sem diária', async () => {
  const user = userEvent.setup()
  renderPage()

  await user.click(screen.getByRole('button', { name: /Nova tarifa/ }))
  await user.type(screen.getByPlaceholderText('20GP'), '40HC')
  await user.click(screen.getByRole('button', { name: 'Cadastrar tarifa' }))

  expect(screen.getAllByRole('alert').map((node) => node.textContent)).toContain('Informe a diária de P1 em USD.')
  expect(svc.upsertDemurrageRate).not.toHaveBeenCalled()
})

it('US-053: ativa/desativa a tarifa pelo menu da linha', async () => {
  const user = userEvent.setup()
  renderPage()

  await user.click(await screen.findByRole('button', { name: 'Mais ações da tarifa 20GP' }))
  await user.click(screen.getByRole('menuitem', { name: 'Desativar tarifa' }))

  await waitFor(() => expect(svc.toggleDemurrageRateActive).toHaveBeenCalledWith(1, false))
})

it('US-054: exclui a tarifa', async () => {
  const user = userEvent.setup()
  renderPage()

  await user.click(await screen.findByRole('button', { name: 'Mais ações da tarifa 20GP' }))
  await user.click(screen.getByRole('menuitem', { name: 'Excluir tarifa' }))

  await waitFor(() => expect(svc.deleteDemurrageRate).toHaveBeenCalledWith(1, 'motivo'))
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
