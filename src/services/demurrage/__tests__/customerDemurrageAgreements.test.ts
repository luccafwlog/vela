import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
}))

vi.mock('../../supabase', () => ({ supabase: { from: mocks.from, rpc: mocks.rpc } }))

import {
  deleteCustomerDemurrageAgreement,
  findActiveAgreementForCustomer,
  listCustomerDemurrageAgreements,
  saveCustomerDemurrageAgreement,
  toggleCustomerDemurrageAgreementActive,
} from '../customerDemurrageAgreements'

describe('customerDemurrageAgreements service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  function createMockQuery(result: { data?: unknown; error?: unknown }) {
    const builder = {
      select: vi.fn(() => builder),
      eq: vi.fn(() => builder),
      in: vi.fn(() => builder),
      lte: vi.fn(() => builder),
      or: vi.fn(() => builder),
      order: vi.fn(() => builder),
      limit: vi.fn(() => builder),
      upsert: vi.fn(() => Promise.resolve(result)),
      delete: vi.fn(() => builder),
      update: vi.fn(() => builder),
      then: (resolve: (v: unknown) => unknown, reject?: (v: unknown) => unknown) =>
        Promise.resolve(result).then(resolve, reject),
    }
    return builder
  }

  it('lists customer demurrage agreements with order and filters', async () => {
    const mockData = [
      { id: 1, customer_id: 10, free_days: 28, valid_from: '2026-01-01', active: true },
    ]
    const builder = createMockQuery({ data: mockData, error: null })
    mocks.from.mockReturnValue(builder)

    const res = await listCustomerDemurrageAgreements({ customerId: 10, activeOnly: true })
    expect(res).toEqual(mockData)
    expect(mocks.from).toHaveBeenCalledWith('customer_demurrage_agreements')
    expect(builder.eq).toHaveBeenCalledWith('customer_id', 10)
    expect(builder.eq).toHaveBeenCalledWith('active', true)
  })

  it('finds active agreement for customer covering discharge date', async () => {
    const mockAgreement = { id: 1, customer_id: 10, free_days: 28, valid_from: '2026-01-01', valid_to: null, active: true }
    const builder = createMockQuery({ data: [mockAgreement], error: null })
    mocks.from.mockReturnValue(builder)

    const res = await findActiveAgreementForCustomer(10, '2026-02-15')
    expect(res).toEqual(mockAgreement)
    expect(builder.eq).toHaveBeenCalledWith('customer_id', 10)
    expect(builder.eq).toHaveBeenCalledWith('active', true)
    expect(builder.lte).toHaveBeenCalledWith('valid_from', '2026-02-15')
  })

  it('validates required fields before saving', async () => {
    await expect(
      saveCustomerDemurrageAgreement({
        customer_id: 0,
        free_days: 21,
        valid_from: '2026-01-01',
      }),
    ).rejects.toThrow(/Cliente obrigatorio/)

    await expect(
      saveCustomerDemurrageAgreement({
        customer_id: 10,
        free_days: -1,
        valid_from: '2026-01-01',
      }),
    ).rejects.toThrow(/Free time/)

    await expect(
      saveCustomerDemurrageAgreement({
        customer_id: 10,
        free_days: 21,
        valid_from: '',
      }),
    ).rejects.toThrow(/Data de inicio/)

    await expect(
      saveCustomerDemurrageAgreement({
        customer_id: 10,
        free_days: 21,
        valid_from: '2026-05-01',
        valid_to: '2026-04-01',
      }),
    ).rejects.toThrow(/Data de termino da vigencia nao pode ser anterior/)
  })

  it('upserts customer demurrage agreement payload', async () => {
    const builder = createMockQuery({ error: null })
    mocks.from.mockReturnValue(builder)

    await saveCustomerDemurrageAgreement({
      customer_id: 10,
      free_days: 28,
      p1_usd: 20,
      p2_usd: 40,
      valid_from: '2026-01-01',
      valid_to: '2026-12-31',
      active: true,
      notes: 'Contrato comercial 2026',
    })

    expect(builder.upsert).toHaveBeenCalledWith({
      customer_id: 10,
      free_days: 28,
      p1_usd: 20,
      p2_usd: 40,
      valid_from: '2026-01-01',
      valid_to: '2026-12-31',
      active: true,
      notes: 'Contrato comercial 2026',
    })
  })

  it('handles overlap constraint violation error with user-friendly message', async () => {
    const builder = createMockQuery({
      error: { message: 'conflicting key value violates exclusion constraint "customer_demurrage_agreements_no_overlap"' },
    })
    mocks.from.mockReturnValue(builder)

    await expect(
      saveCustomerDemurrageAgreement({
        customer_id: 10,
        free_days: 28,
        valid_from: '2026-01-01',
      }),
    ).rejects.toThrow(/Ja existe um acordo ativo para este cliente com vigencia sobreposta/)
  })

  it('deletes and toggles active status of agreements', async () => {
    const builder = createMockQuery({ data: [{ id: 5 }], error: null })
    mocks.from.mockReturnValue(builder)

    mocks.rpc.mockResolvedValue({ data: null, error: null })
    await deleteCustomerDemurrageAgreement(5, 'acordo encerrado')
    expect(mocks.rpc).toHaveBeenCalledWith('delete_catalog_row', {
      p_table: 'customer_demurrage_agreements',
      p_id: '5',
      p_reason: 'acordo encerrado',
    })

    await toggleCustomerDemurrageAgreementActive(5, false)
    expect(builder.update).toHaveBeenCalledWith({ active: false })
    expect(builder.eq).toHaveBeenCalledWith('id', 5)
  })
})
