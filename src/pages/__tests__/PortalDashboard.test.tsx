// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { PortalDemurrageInvoice, PortalInvoiceSummary } from '../../services/portalBilling'
import type { PortalOperationBL } from '../../services/portalOperation'

const localInvoices: PortalInvoiceSummary[] = [
  { id: 1, invoice_number: 'INV-1', issued_at: '2026-06-01', total_brl: 100, total_paid_brl: 0, balance_brl: 100, status: 'issued', invoice_type: 'individual', vessels: [], voyages: [], vessel_voyages: [], bls: ['BL1'], pods: [] },
  { id: 2, invoice_number: 'INV-2', issued_at: '2026-06-02', total_brl: 50, total_paid_brl: 50, balance_brl: 0, status: 'paid', invoice_type: 'individual', vessels: [], voyages: [], vessel_voyages: [], bls: ['BL2'], pods: [] },
]

const demurrageInvoices: PortalDemurrageInvoice[] = [
  { id: 11, doc_number: 'DEM-2', doc_date: '2026-06-03', due_date: null, billed_at: '2026-06-03', paid_at: '2026-06-10', total_usd: 70, current_roe: 5, current_total_brl: 350, roe_source: 'bcb_live', updated_at: null, status: 'paid', pix_payload: null, dispute_open: false, discount_type: null, discount_value: null, discount_mode: null, bl_id: 'BL1', pol: null, pod: null, voyage_number: null, vessel_name: null },
  { id: 10, doc_number: 'DEM-1', doc_date: '2026-06-03', due_date: '2026-06-30', billed_at: '2026-06-03', paid_at: null, total_usd: 50, current_roe: 5, current_total_brl: 250, roe_source: 'bcb_live', updated_at: '2026-06-03T12:00:00Z', status: 'issued', pix_payload: null, dispute_open: false, discount_type: null, discount_value: null, discount_mode: null, bl_id: 'BL1', pol: null, pod: null, voyage_number: null, vessel_name: null },
]

const operationBls: PortalOperationBL[] = [
  {
    bl_id: 'BL1', ce_mercante: null, pol: null, pod: null, voyage_id: null, voyage_number: null, vessel_name: null,
    container_count: 3, containers_in_demurrage: 1, containers_returned: 1,
    containers: [
      { id: 1, container_number: 'C1', type: null, discharge_date: null, return_date: '2026-06-10', usage_days: null, free_time_days: null, demurrage_days: 0, status: 'devolvido' },
      { id: 2, container_number: 'C2', type: null, discharge_date: null, return_date: null, usage_days: null, free_time_days: null, demurrage_days: 0, status: 'dentro_free_time' },
      { id: 3, container_number: 'C3', type: null, discharge_date: null, return_date: null, usage_days: null, free_time_days: null, demurrage_days: 5, status: 'em_demurrage' },
    ],
  },
]

const hookState = vi.hoisted(() => ({
  localError: null as Error | null,
  demurrageError: null as Error | null,
  operationError: null as Error | null,
}))

vi.mock('../../hooks/usePortalBilling', () => ({
  usePortalInvoices: () => ({ data: hookState.localError ? undefined : localInvoices, isLoading: false, error: hookState.localError }),
  usePortalDemurrageInvoices: () => ({ data: hookState.demurrageError ? undefined : demurrageInvoices, isLoading: false, error: hookState.demurrageError }),
}))

vi.mock('../../hooks/usePortalOperation', () => ({
  usePortalOperationBls: () => ({ data: hookState.operationError ? undefined : operationBls, isLoading: false, error: hookState.operationError }),
}))

const ceRequests = vi.hoisted(() => ({
  fail: false,
  items: [
    { id: 'a', protocol: 'CE-A', state: 'draft' },
    { id: 'b', protocol: 'CE-B', state: 'changes_requested' },
    { id: 'c', protocol: 'CE-C', state: 'in_review' },
    { id: 'd', protocol: 'CE-D', state: 'completed' },
    { id: 'e', protocol: 'CE-E', state: 'cancelled' },
  ],
}))
vi.mock('../../services/ceUnlockService', () => ({
  listPortalCeUnlockRequests: async () => {
    if (ceRequests.fail) throw new Error('rpc indisponivel')
    return { items: ceRequests.items, total: ceRequests.items.length, page: 1, page_size: 25 }
  },
}))

vi.mock('../../hooks/usePortalScheduleVoyages', () => ({
  usePortalScheduleVoyages: () => ({ data: [], isLoading: false }),
}))


import { PortalDashboard } from '../PortalDashboard'

function LocationProbe() {
  const loc = useLocation()
  return <div data-testid="location">{loc.pathname + loc.search}</div>
}

function renderPainel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/portal']}>
        <Routes>
          <Route path="/portal" element={<PortalDashboard />} />
          <Route path="*" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

afterEach(cleanup)

describe('PortalDashboard (Painel)', () => {
  afterEach(() => {
    hookState.localError = null
    hookState.demurrageError = null
    hookState.operationError = null
  })

  it('mostra os quatro cartões com valores derivados e plural certo', async () => {
    renderPainel()
    expect(screen.getByRole('heading', { name: 'Painel' })).toBeTruthy()

    // Taxas Locais em aberto: só INV-1 (issued), em âmbar.
    const local = screen.getByRole('button', { name: /Taxas Locais em aberto/ })
    expect(local.textContent).toMatch(/R\$\s100,00/)
    expect(local.textContent).toContain('1 fatura')
    expect(local.textContent).not.toContain('fatura(s)')
    expect(local.className).toContain('app-metric-tile--warning')

    // Demurrage em dólar, com o valor em reais de hoje; a paga não entra.
    const demurrage = screen.getByRole('button', { name: /Demurrage em aberto/ })
    expect(demurrage.textContent).toContain('US$ 50,00')
    expect(demurrage.textContent).toMatch(/1 fatura · R\$\s250,00 hoje/)

    // Containers sem devolução: C2 e C3; C3 já em demurrage.
    const containers = screen.getByRole('button', { name: /Containers sem devolução/ })
    expect(containers.textContent).toContain('2')
    expect(containers.textContent).toContain('1 já em demurrage')
    expect(screen.queryByText('Containers em demurrage')).toBeNull()

    // Desbloqueio de CE: rascunho, em análise e pede correção contam; concluída e cancelada não.
    await waitFor(() => expect(screen.getByRole('button', { name: /Desbloqueio de CE em aberto/ }).textContent).toContain('3 solicitações'))
    expect(screen.getByText('1 pede correção')).toBeTruthy()

    // Consultas: os seis atalhos da Central de Informações, no lugar do cartão.
    const consultas = screen.getByRole('navigation', { name: 'Consultas na Central de Informações' })
    expect(within(consultas).getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual([
      '/portal/informacoes/taxas', '/portal/informacoes/devolucao', '/portal/informacoes/demurrage',
      '/portal/informacoes/agentes', '/portal/informacoes/atendimento', '/portal/informacoes/tracking',
    ])
    expect(screen.queryByText('Chegadas e Saídas')).toBeNull()
    expect(screen.getByRole('heading', { name: 'Programação de navios' })).toBeTruthy()
  })

  it('navega para Containers filtrado ao clicar no cartão de containers', async () => {
    const user = userEvent.setup()
    renderPainel()
    await user.click(screen.getByRole('button', { name: /Containers sem devolução/ }))
    expect(screen.getByTestId('location').textContent).toBe('/portal/operacao?tab=containers&devolucao=sem_devolucao')
  })

  it('cartão do Desbloqueio de CE diz quando a lista falha', async () => {
    ceRequests.fail = true
    renderPainel()
    await waitFor(() => expect(screen.getByRole('button', { name: /Desbloqueio de CE em aberto/ }).textContent).toContain('Não foi possível carregar.'))
    ceRequests.fail = false
  })

  it('mostra falha honesta em vez de R$ 0,00 quando indicadores financeiros falham', () => {
    hookState.localError = new Error('rpc indisponivel')

    renderPainel()

    expect(screen.getByText('Falha ao carregar indicadores financeiros. Tente novamente em instantes.')).toBeTruthy()
    expect(screen.queryByText('R$ 0,00')).toBeNull()
  })
})
