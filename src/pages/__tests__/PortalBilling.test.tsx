// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import type { PortalDemurrageInvoice, PortalInvoiceSummary } from '../../services/portalBilling'

const localInvoices: PortalInvoiceSummary[] = [
  {
    id: 1,
    invoice_number: 'INV-001',
    issued_at: '2026-06-01',
    total_brl: 100,
    total_paid_brl: 0,
    balance_brl: 100,
    status: 'issued',
    invoice_type: 'individual',
    vessels: ['NAVIO A'],
    voyages: ['001W'],
    vessel_voyages: ['NAVIO A / 001W'],
    bls: ['BL-EXPORTADO'],
    pods: ['BRVIX'],
  },
  {
    id: 2,
    invoice_number: 'INV-002',
    issued_at: '2026-06-02',
    total_brl: 200,
    total_paid_brl: 0,
    balance_brl: 200,
    status: 'issued',
    invoice_type: 'individual',
    vessels: ['NAVIO B'],
    voyages: ['002W'],
    vessel_voyages: ['NAVIO B / 002W'],
    bls: ['BL-OCULTO'],
    pods: ['BRSSZ'],
  },
]

const demurrageInvoices: PortalDemurrageInvoice[] = [
  {
    id: 10,
    doc_number: 'DEM-001',
    doc_date: '2026-06-03',
    due_date: '2026-06-30',
    billed_at: '2026-06-03',
    paid_at: null,
    total_usd: 50,
    current_roe: 5,
    current_total_brl: 250,
    roe_source: 'bcb_live',
    updated_at: '2026-06-03T12:00:00Z',
    status: 'issued',
    pix_payload: null,
    dispute_open: false,
    discount_type: null,
    discount_value: null,
    discount_mode: null,
    bl_id: 'BL-DEM',
    pol: 'CNSHA',
    pod: 'BRVIX',
    voyage_number: '003W',
    vessel_name: 'NAVIO C',
  },
]

const exportLocal = vi.fn()
const exportDemurrage = vi.fn()
const portalExport = vi.hoisted(() => ({
  local: vi.fn(),
  demurrage: vi.fn(),
}))
portalExport.local.mockImplementation((filters: { bl?: string }) => Promise.resolve(
  filters?.bl ? localInvoices.filter((invoice) => invoice.bls.includes(filters.bl!)) : localInvoices,
))
portalExport.demurrage.mockResolvedValue(demurrageInvoices)

const mocks = vi.hoisted(() => ({
  confirm: vi.fn(),
  obsolete: vi.fn(),
  detail: null as unknown,
  demurrageError: null as Error | null,
  currentRoe: { roe: 5.4288, updatedAt: '2026-07-16T12:00:00Z' } as { roe: number; updatedAt: string } | null,
}))

const portalScope = vi.hoisted(() => ({
  mode: 'client' as 'client' | 'inspect',
  customerId: 42 as number | null,
  overview: null,
  basePath: '/portal',
}))

vi.mock('../../components/ui/Toast', () => ({
  useToast: () => ({ showToast: vi.fn() }),
}))

vi.mock('../../components/ui/ConfirmDialog', () => ({ useConfirm: () => mocks.confirm }))

vi.mock('../../components/portal/PortalConsolidatedModal', () => ({
  PortalConsolidatedModal: () => null,
}))

vi.mock('../../components/portal/DisputeModal', () => ({
  DisputeModal: () => null,
}))

vi.mock('../../components/billing/InvoiceDocumentLocal', () => ({
  InvoiceDocumentLocal: () => null,
}))

// `usePortalScope` le `PortalAuthContext` direto (sem Provider, o default do
// contexto e o valor entregue), entao o mock parcial precisa exportar os dois.
const portalAuth = vi.hoisted(() => ({
  overview: { pending_balance: 300, customer_name: 'Cliente Teste' },
  refreshOverview: vi.fn(),
}))
vi.mock('../../hooks/usePortalAuth', async () => ({
  usePortalAuth: () => portalAuth,
  PortalAuthContext: (await vi.importActual<typeof import('react')>('react')).createContext(portalAuth),
}))

vi.mock('../../hooks/usePortalScope', () => ({
  usePortalScope: () => portalScope,
}))

vi.mock('../../hooks/usePortalBilling', () => ({
  usePortalConsolidatableReceivables: () => ({ data: [] }),
  usePortalInvoices: () => ({ data: localInvoices, isLoading: false, error: null }),
  usePortalInvoicesPage: (filters: { bl?: string }) => {
    const rows = filters?.bl ? localInvoices.filter((invoice) => invoice.bls.includes(filters.bl!)) : localInvoices
    return {
    data: {
      rows,
      totalCount: rows.length,
      vesselOptions: ['NAVIO A / 001W', 'NAVIO B / 002W'],
      pods: ['BRVIX', 'BRSSZ'],
    },
    isLoading: false,
    error: null,
    }
  },
  usePortalDemurrageInvoices: () => ({ data: mocks.demurrageError ? undefined : demurrageInvoices, isLoading: false, error: mocks.demurrageError }),
  usePortalDemurrageInvoicesPage: () => ({
    data: mocks.demurrageError ? undefined : {
      rows: demurrageInvoices,
      totalCount: demurrageInvoices.length,
      vesselOptions: ['NAVIO C / 003W'],
      pods: ['BRVIX'],
    },
    isLoading: false,
    error: mocks.demurrageError,
  }),
  usePortalCurrentRoe: () => ({ data: mocks.currentRoe }),
  usePortalInvoiceDetail: () => ({ data: mocks.detail, isLoading: false, error: null }),
  usePortalDemurrageInvoiceDetail: () => ({ data: null, isLoading: false, error: null }),
  usePortalObsoleteConsolidation: () => ({ isPending: false, mutateAsync: mocks.obsolete }),
}))

vi.mock('../../hooks/usePortalDisputes', () => ({
  usePortalDisputes: () => ({ data: [] }),
  usePortalOpenDispute: () => ({ isPending: false, mutateAsync: vi.fn() }),
  usePortalAddDisputeMessage: () => ({ isPending: false, mutateAsync: vi.fn() }),
  usePortalRequestDisputeReopen: () => ({ isPending: false, mutateAsync: vi.fn() }),
}))

vi.mock('../../services/exports', () => ({
  exportPortalLocalInvoicesWorkbook: (...args: unknown[]) => exportLocal(...args),
  exportPortalDemurrageWorkbook: (...args: unknown[]) => exportDemurrage(...args),
}))

vi.mock('../../services/portalBilling', () => ({
  portalListInvoicesForExport: (...args: unknown[]) => portalExport.local(...args),
  portalListDemurrageInvoicesForExport: (...args: unknown[]) => portalExport.demurrage(...args),
}))

import { PortalBilling } from '../PortalBilling'

function renderBilling() {
  return render(
    <MemoryRouter initialEntries={['/portal/billing']}>
      <PortalBilling />
    </MemoryRouter>,
  )
}

afterEach(() => {
  cleanup()
  exportLocal.mockClear()
  exportDemurrage.mockClear()
  portalExport.local.mockReset().mockImplementation((filters: { bl?: string }) => Promise.resolve(
    filters?.bl ? localInvoices.filter((invoice) => invoice.bls.includes(filters.bl!)) : localInvoices,
  ))
  portalExport.demurrage.mockReset().mockResolvedValue(demurrageInvoices)
  mocks.confirm.mockReset()
  mocks.obsolete.mockReset()
  mocks.detail = null
  mocks.demurrageError = null
  mocks.currentRoe = { roe: 5.4288, updatedAt: '2026-07-16T12:00:00Z' }
  portalScope.mode = 'client'
})

const consolidatedDetail = {
  invoice: {
    id: 1,
    invoice_number: 'INV-001',
    invoice_type: 'consolidated',
    status: 'issued',
    total_brl: 100,
    total_paid_brl: 0,
    balance_brl: 100,
  },
  payments: [],
  bls: ['BL-A', 'BL-B'],
}

async function openConsolidatedDetail(user: ReturnType<typeof userEvent.setup>) {
  mocks.detail = consolidatedDetail
  renderBilling()
  await user.click(screen.getAllByRole('button', { name: 'Detalhes' })[0])
  return screen.getByRole('button', { name: /Refazer consolidada/ })
}

describe('PortalBilling', () => {
  it('exibe abas Taxas Locais e Demurrage e oculta o filtro Cliente', async () => {
    const user = userEvent.setup()
    renderBilling()

    expect(screen.getByRole('tab', { name: 'Taxas Locais' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Demurrage' })).toBeTruthy()

    await user.click(screen.getByRole('button', { name: /Filtros/i }))
    expect(screen.queryByLabelText('Cliente')).toBeNull()
  })

  it('exporta Excel de taxas locais usando apenas as faturas filtradas', async () => {
    const user = userEvent.setup()
    renderBilling()

    await user.click(screen.getByRole('button', { name: /Filtros/i }))
    await user.type(screen.getByLabelText('B/L'), 'BL-EXPORTADO')
    await user.click(screen.getByRole('button', { name: /Exportar Excel/i }))

    expect(exportLocal).toHaveBeenCalledTimes(1)
    expect(exportDemurrage).not.toHaveBeenCalled()
    const rows = exportLocal.mock.calls[0]?.[0] as PortalInvoiceSummary[]
    expect(rows).toHaveLength(1)
    expect(rows[0].invoice_number).toBe('INV-001')
  })

  it('exporta Excel de demurrage quando a aba Demurrage esta ativa', async () => {
    const user = userEvent.setup()
    renderBilling()

    await user.click(screen.getByRole('tab', { name: 'Demurrage' }))
    await user.click(screen.getByRole('button', { name: /Exportar Excel/i }))

    expect(exportDemurrage).toHaveBeenCalledTimes(1)
    const rows = exportDemurrage.mock.calls[0]?.[0] as PortalDemurrageInvoice[]
    expect(rows).toHaveLength(1)
    expect(rows[0].doc_number).toBe('DEM-001')
  })

  it('exibe apenas na aba Demurrage o ROE vigente persistido', async () => {
    const user = userEvent.setup()
    renderBilling()

    expect(screen.queryByText('ROE vigente: R$ 5,4288 · atualizado em 16/07/2026')).toBeNull()
    await user.click(screen.getByRole('tab', { name: 'Demurrage' }))
    expect(screen.getByText('ROE vigente: R$ 5,4288 · atualizado em 16/07/2026')).toBeTruthy()
  })

  it('nao exibe erro cambial ao cliente quando o ROE vigente esta indisponivel', async () => {
    const user = userEvent.setup()
    mocks.currentRoe = null
    renderBilling()

    await user.click(screen.getByRole('tab', { name: 'Demurrage' }))
    expect(screen.queryByText(/ROE vigente/)).toBeNull()
  })

  it('mantem a emissão de consolidada indisponivel no Modo Inspeção', () => {
    portalScope.mode = 'inspect'
    renderBilling()

    expect((screen.getByRole('button', { name: 'Gerar fatura consolidada' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('mostra erro da aba Demurrage em vez de estado vazio', async () => {
    const user = userEvent.setup()
    mocks.demurrageError = new Error('rpc indisponivel')
    renderBilling()

    await user.click(screen.getByRole('tab', { name: 'Demurrage' }))

    expect(screen.getByText('Falha ao consultar faturas de demurrage.')).toBeTruthy()
    expect(screen.queryByText('Nenhuma fatura de demurrage para os filtros atuais.')).toBeNull()
  })

  it('Task 10: desfazer consolidada usa ConfirmDialog e so executa apos confirmar', async () => {
    const user = userEvent.setup()
    mocks.confirm.mockResolvedValue(true)
    const obsoleteButton = await openConsolidatedDetail(user)

    await user.click(obsoleteButton)

    expect(mocks.confirm).toHaveBeenCalledTimes(1)
    expect(mocks.obsolete).toHaveBeenCalledWith(1)
  })

  it('Task 10: cancelar a confirmacao nao desfaz a fatura', async () => {
    const user = userEvent.setup()
    mocks.confirm.mockResolvedValue(false)
    const obsoleteButton = await openConsolidatedDetail(user)

    await user.click(obsoleteButton)

    expect(mocks.confirm).toHaveBeenCalledTimes(1)
    expect(mocks.obsolete).not.toHaveBeenCalled()
  })
})
