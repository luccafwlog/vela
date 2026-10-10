import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  ensureRates: vi.fn(),
  calculate: vi.fn(),
  fetchROE: vi.fn(),
}))

vi.mock('../../supabase', () => ({
  supabase: { from: mocks.from, rpc: mocks.rpc },
}))
vi.mock('../demurrageRates', () => ({
  ensureDemurrageRatesLoaded: mocks.ensureRates,
  ensureDemurrageRatesFresh: mocks.ensureRates,
  calculateDemurrage: mocks.calculate,
}))
vi.mock('../demurrageKpis', () => ({
  fetchROE: mocks.fetchROE,
}))

import { createInvoiceForBL } from '../demurrageInvoices'

function singleQuery(result: unknown) {
  return {
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        single: vi.fn().mockResolvedValue(result),
      })),
    })),
  }
}

function listQuery(result: unknown) {
  const builder = {
    select: vi.fn(),
    eq: vi.fn(),
    or: vi.fn(),
    in: vi.fn(),
    limit: vi.fn(),
    then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  }
  builder.select.mockReturnValue(builder)
  builder.eq.mockReturnValue(builder)
  builder.or.mockReturnValue(builder)
  builder.in.mockReturnValue(builder)
  builder.limit.mockReturnValue(builder)
  return builder
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.ensureRates.mockResolvedValue(undefined)
  mocks.fetchROE.mockResolvedValue({ roe: 5.5, offline: false, cachedAt: null, source: 'bcb_live' })
  mocks.calculate.mockReturnValue({
    total_days: 12,
    free_days: 7,
    days_p1: 5,
    rate_p1_usd: 100,
    days_p2: 0,
    rate_p2_usd: 200,
    total_usd: 500,
  })

  mocks.from.mockImplementation((table: string) => {
    if (table === 'bls') {
      return singleQuery({
        data: {
          id: 'BL-1',
          customer_id: 9,
          free_time_override: null,
          demurrage_rate_override_p1_usd: null,
          demurrage_rate_override_p2_usd: null,
          demurrage_roe_manual: false,
          demurrage_roe: null,
        },
        error: null,
      })
    }
    if (table === 'bl_containers') {
      return listQuery({
        data: [{
          id: 4,
          container_number: 'ABCD1234567',
          type: '40HC',
          discharge_date: '2026-06-01',
          return_date: '2026-06-13',
          demurrage_status: 'overdue',
        }],
        error: null,
      })
    }
    if (table === 'demurrage_invoices') {
      // Guard de duplicidade: nenhuma fatura ativa para o B/L.
      return listQuery({ data: [], error: null }) as unknown as Record<string, unknown>
    }
    if (table === 'customer_demurrage_agreements') {
      return listQuery({ data: [], error: null }) as unknown as Record<string, unknown>
    }
    throw new Error(`Unexpected table: ${table}`)
  })
  mocks.rpc.mockResolvedValue({ data: { invoice_id: 321 }, error: null })
})

describe('authoritative Demurrage invoice creation', () => {
  it('sends only the identity inputs to the server authority', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { status: 'issued', invoice_id: 321, anchor_bl_id: 'BL-1' }, error: null })
    const invoiceId = await createInvoiceForBL('BL-1')

    expect(mocks.rpc).toHaveBeenCalledWith('issue_demurrage_invoice_for_bl', {
      p_bl_id: 'BL-1',
      p_doc_number: expect.stringMatching(/^DEM-\d{4}-/),
    })
    expect(mocks.from).not.toHaveBeenCalled()
    expect(mocks.calculate).not.toHaveBeenCalled()
    expect(mocks.fetchROE).not.toHaveBeenCalled()
    expect(invoiceId).toBe(321)
  })

  it('maps database uniqueness violations to the friendly duplicate invoice message', async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: '23505', message: 'duplicate key value violates unique constraint' },
    })

    await expect(createInvoiceForBL('BL-1')).rejects.toThrow('Já existe fatura de Demurrage emitida ou paga para este B/L. Cancele a fatura atual antes de reemitir.')
  })

  it('explica por que o grupo ainda não fatura', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { status: 'waiting_return', anchor_bl_id: 'BL-0' }, error: null })
    await expect(createInvoiceForBL('BL-1')).rejects.toThrow('Aguardando a devolução de todos os containers do B/L (grupo do B/L BL-0).')
    mocks.rpc.mockResolvedValueOnce({ data: { status: 'no_overstay', anchor_bl_id: 'BL-1' }, error: null })
    await expect(createInvoiceForBL('BL-1')).rejects.toThrow('Nenhum container com sobreestadia para este B/L.')
  })
})
