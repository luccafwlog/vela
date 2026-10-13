import { describe, expect, it, vi } from 'vitest'

const rows = vi.hoisted(() => ({ data: [] as unknown[] }))

vi.mock('../../supabase', () => {
  const builder: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'is', 'order']) builder[method] = () => builder
  builder.then = (resolve: (value: unknown) => unknown) => resolve({ data: rows.data, error: null })
  return { supabase: { from: () => builder } }
})

import { fetchCustomerDemurrageDetail, fetchCustomerDemurrageSummary } from '../demurrageKpis'

describe('Por Cliente soma o USD a cobrar, como a aba Faturas', () => {
  it('tira o desconto do USD; o BRL do banco já vem líquido', async () => {
    rows.data = [
      { customer_id: 7, total_usd: 1000, discount_mode: 'percent', discount_value: 20, current_total_brl: 4400, customer: { id: 7, name: 'ACME', cnpj_cpf: null } },
      { customer_id: 7, total_usd: 500, discount_mode: null, discount_value: null, current_total_brl: 2750, customer: { id: 7, name: 'ACME', cnpj_cpf: null } },
    ]
    const [summary] = await fetchCustomerDemurrageSummary()
    expect(summary).toMatchObject({ invoice_count: 2, total_usd: 1300, total_brl: 7150 })
  })

  it('a Invoice do Cliente também mostra o líquido', async () => {
    rows.data = [{ id: 21, doc_number: 'DEM-1', bl_id: 'BL-1', billed_at: null, total_usd: 1000, discount_mode: 'fixed', discount_value: 150, current_total_brl: 4675, current_roe: 5.5 }]
    const [invoice] = await fetchCustomerDemurrageDetail(7)
    expect(invoice.total_usd).toBe(850)
    expect(invoice).not.toHaveProperty('discount_mode')
  })
})
