import { beforeEach, expect, it, vi } from 'vitest'

const { fromMock, rpcMock, captureMock } = vi.hoisted(() => ({ fromMock: vi.fn(), rpcMock: vi.fn(), captureMock: vi.fn() }))
vi.mock('../../supabase', () => ({ supabase: { from: fromMock, rpc: rpcMock } }))
vi.mock('../../../lib/featureFlags', () => ({
  featureFlags: { capture: captureMock },
  PRODUCT_EVENTS: { INVOICE_PAID: 'invoice_paid' },
}))
vi.mock('../demurrageRates', () => ({
  ensureDemurrageRatesLoaded: vi.fn(() => Promise.resolve()),
  ensureDemurrageRatesFresh: vi.fn(() => Promise.resolve()),
  invalidateDemurrageRatesCache: vi.fn(),
  calculateDemurrage: vi.fn(),
}))

import {
  markInvoicePaid,
  cancelDemurrageInvoice,
  updateDemurrageInvoice,
  getInvoiceDetail,
} from '../demurrageInvoices'
import { listDemurrageContainers } from '../demurrageContainers'
import { fetchDemurrageKPIs } from '../demurrageKpis'

type Result = { data?: unknown; error: unknown; count?: number }
let results: Record<string, Result>
let builders: Map<string, Record<string, ReturnType<typeof vi.fn>>>

function makeBuilder(result: Result) {
  const b: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'update', 'order', 'gte', 'lte', 'not', 'neq', 'insert', 'delete', 'upsert', 'range', 'in']) {
    b[m] = vi.fn(() => b)
  }
  b.single = vi.fn(() => b)
  b.overrideTypes = vi.fn(() => Promise.resolve(result))
  b.then = (resolve: (r: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject)
  return b as Record<string, ReturnType<typeof vi.fn>>
}

function builderFor(table: string) {
  if (!builders.has(table)) builders.set(table, makeBuilder(results[table] ?? { data: [], error: null }))
  return builders.get(table)!
}

function lastUpdate(table: string) {
  const calls = builderFor(table).update.mock.calls
  return calls[calls.length - 1]?.[0] as Record<string, unknown>
}

beforeEach(() => {
  results = {}
  builders = new Map()
  fromMock.mockReset()
  fromMock.mockImplementation((table: string) => builderFor(table))
  rpcMock.mockReset()
  captureMock.mockReset()
  rpcMock.mockResolvedValue({ data: {}, error: null })
})

it('US-043: marca como paga uma invoice emitida', async () => {
  results.demurrage_invoices = { data: { status: 'issued', current_roe: 5, current_total_brl: 500, total_usd: 100, doc_number: 'DEM-1' }, error: null }
  await markInvoicePaid(5, '2026-06-23')
  expect(rpcMock).toHaveBeenCalledWith('register_demurrage_payment', expect.objectContaining({
    p_invoice_id: 5,
    p_paid_at: '2026-06-23',
    p_total_brl: null,
    p_ptax_used: null,
  }))
})

it('emite invoice_paid sem identificador somente depois de confirmação da RPC de Demurrage', async () => {
  results.demurrage_invoices = { data: { status: 'issued', current_roe: 5, current_total_brl: 500, total_usd: 100, doc_number: 'DEM-1' }, error: null }
  rpcMock.mockResolvedValueOnce({ data: { invoice_id: 5, status: 'paid' }, error: null })

  await markInvoicePaid(5, '2026-06-23')

  expect(captureMock).toHaveBeenCalledWith('invoice_paid', { surface: 'internal', invoice_type: 'demurrage' })
})

it('US-043: rejeita marcar paga uma invoice em draft', async () => {
  results.demurrage_invoices = { data: { status: 'draft', doc_number: 'DEM-1' }, error: null }
  await expect(markInvoicePaid(5, '2026-06-23')).rejects.toThrow(/status atual/)
})

it('US-045: cancela a invoice', async () => {
  results.demurrage_invoices = { data: null, error: null }
  await cancelDemurrageInvoice(5)
  expect(rpcMock).toHaveBeenCalledWith('cancel_demurrage_invoice', expect.objectContaining({ p_invoice_id: 5 }))
})

it('US-047: abre/atualiza disputa via patch', async () => {
  results.demurrage_invoices = { data: null, error: null }
  await updateDemurrageInvoice(5, { dispute_open: true, dispute_subject: 'Cobranca indevida', dispute_status: 'aberto' })
  expect(lastUpdate('demurrage_invoices')).toMatchObject({ dispute_open: true, dispute_subject: 'Cobranca indevida' })
})

it('US-040: abre o detalhe da invoice com header e itens', async () => {
  results.demurrage_invoices = { data: { id: 5, doc_number: 'DEM-1', current_total_brl: 100, pix_payload: null }, error: null }
  results.demurrage_invoice_items = { data: [{ id: 1, container_number: 'C1' }], error: null }
  const detail = await getInvoiceDetail(5)
  expect(detail.invoice).toMatchObject({ id: 5 })
  expect(detail.invoice.pix_payload).toBeNull()
  expect(detail.items).toHaveLength(1)
})

it('US-030: lista os containers em tracking e filtra por cliente', async () => {
  results.bl_containers = { data: [{ id: 1, bl: { customer: { id: 9 }, voyage_id: 2 } }, { id: 2, bl: { customer: { id: 7 }, voyage_id: 3 } }], error: null }
  const all = await listDemurrageContainers()
  expect(all).toHaveLength(2)
  const filtered = await listDemurrageContainers({ customerId: 9 })
  expect(filtered).toHaveLength(1)
})

it('US-031: calcula os KPIs de demurrage', async () => {
  results.bl_containers = { data: [], count: 3, error: null }
  results.demurrage_invoices = { data: [{ total_usd: 50, current_total_brl: 200 }], error: null }
  const kpis = await fetchDemurrageKPIs()
  expect(kpis.overdueContainers).toBe(3)
  expect(kpis.draftInvoicesTotalUsd).toBe(50)
  expect(kpis.issuedInvoicesTotalBrl).toBe(200)
})
