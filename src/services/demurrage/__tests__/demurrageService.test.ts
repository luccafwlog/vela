import { beforeEach, expect, it, vi } from 'vitest'

const { fromMock, rpcMock } = vi.hoisted(() => ({ fromMock: vi.fn(), rpcMock: vi.fn() }))
vi.mock('../../supabase', () => ({ supabase: { from: fromMock, rpc: rpcMock } }))
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

it('US-043: rejeita marcar paga uma invoice em draft', async () => {
  results.demurrage_invoices = { data: { status: 'draft', doc_number: 'DEM-1' }, error: null }
  await expect(markInvoicePaid(5, '2026-06-23')).rejects.toThrow(/status atual/)
})

it('US-045: cancela a invoice', async () => {
  results.demurrage_invoices = { data: null, error: null }
  await cancelDemurrageInvoice(5, ' Cliente pagou por outra Invoice ')
  expect(rpcMock).toHaveBeenCalledWith('cancel_demurrage_invoice', expect.objectContaining({ p_invoice_id: 5, p_reason: 'Cliente pagou por outra Invoice' }))
})

it('US-045: cancelar sem motivo não chama a RPC', async () => {
  rpcMock.mockClear()
  await expect(cancelDemurrageInvoice(5, '  ')).rejects.toThrow(/motivo/)
  expect(rpcMock).not.toHaveBeenCalledWith('cancel_demurrage_invoice', expect.anything())
})

it('US-047: atualiza assunto da disputa via patch, sem mexer no estado', async () => {
  results.demurrage_invoices = { data: null, error: null }
  await updateDemurrageInvoice(5, { dispute_subject: 'Cobranca indevida' })
  expect(lastUpdate('demurrage_invoices')).toEqual({ dispute_subject: 'Cobranca indevida' })
})

it('US-040: abre o detalhe da invoice com header e itens', async () => {
  results.demurrage_invoices = { data: { id: 5, doc_number: 'DEM-1', current_total_brl: 100, pix_payload: null }, error: null }
  results.demurrage_invoice_items = { data: [{ id: 1, container_number: 'C1' }], error: null }
  const detail = await getInvoiceDetail(5)
  expect(detail.invoice).toMatchObject({ id: 5 })
  expect(detail.invoice.pix_payload).toBeNull()
  expect(detail.items).toHaveLength(1)
})

it('DEM-D08: o detalhe busca a Invoice cancelada pelo replaces_invoice_id, sem embed da tabela nela mesma', async () => {
  const header = makeBuilder({ data: { id: 7, doc_number: 'DEM-2026-0002', replaces_invoice_id: 6 }, error: null })
  const previous = makeBuilder({ data: null, error: null })
  previous.maybeSingle = vi.fn(() => Promise.resolve({ data: { id: 6, doc_number: 'DEM-2026-0001' }, error: null }))
  const invoiceBuilders = [header, previous]
  fromMock.mockImplementation((table: string) => (table === 'demurrage_invoices' ? invoiceBuilders.shift()! : builderFor(table)))

  const detail = await getInvoiceDetail(7)

  expect(header.select.mock.calls[0][0]).not.toContain('replaces')
  expect(previous.eq).toHaveBeenCalledWith('id', 6)
  expect(detail.invoice.replaces).toEqual({ id: 6, doc_number: 'DEM-2026-0001' })
})

it('DEM-D08: Invoice que não substitui outra fica sem a citação', async () => {
  results.demurrage_invoices = { data: { id: 5, doc_number: 'DEM-1', replaces_invoice_id: null }, error: null }
  const detail = await getInvoiceDetail(5)
  expect(detail.invoice.replaces).toBeNull()
  expect(fromMock.mock.calls.filter(([table]) => table === 'demurrage_invoices')).toHaveLength(1)
})

it('US-031: calcula os KPIs de demurrage', async () => {
  results.bl_containers = { data: [], count: 3, error: null }
  results.demurrage_invoices = { data: [{ total_usd: 50, current_total_brl: 200 }], error: null }
  const kpis = await fetchDemurrageKPIs()
  expect(kpis.overdueContainers).toBe(3)
  expect(kpis.issuedInvoicesTotalBrl).toBe(200)
})
