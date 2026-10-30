import { describe, expect, it } from 'vitest'
import { buildCustomerExposure, customerUnbilledBoxes } from '../demurrageCustomerExposure'
import { divisionTotals } from '../demurrageBoard'

const group = (customer: number | null, division: string, usd: number, boxes: unknown[] = []) => ({
  anchor_bl_id: `BL-${customer}-${division}`, bl_ids: [], voyage_id: 1, voyage_label: null,
  customer_id: customer, customer_name: customer ? `Cliente ${customer}` : null, customer_cnpj: null,
  division, reason_code: null, reason: null, warning: null, no_rate_types: null, usd, boxes,
}) as never

const box = (number: string, state: string, usd: number | null) => ({ container_id: number.length, bl_id: 'BL', container_number: number, state, usd }) as never

describe('Por Cliente (ADR 0112, D11)', () => {
  const groups = [
    group(1, 'correndo', 300), group(1, 'a_emitir', 200), group(2, 'travado', 50),
    group(3, 'correndo', 100), group(null, 'travado', 999), group(4, 'esperando', 70),
  ]
  const invoices = [{ customer_id: 2, customer_name: 'Cliente 2', cnpj_cpf: null, invoice_count: 2, total_usd: 1000, total_brl: 5500 }]

  it('entra o Cliente só com sobreestadia não faturada; o sem Cliente fica fora', () => {
    const rows = buildCustomerExposure(groups, invoices)
    expect(rows.map((row) => row.customer_id)).toEqual([2, 1, 3])
    expect(rows.find((row) => row.customer_id === 1)).toMatchObject({ correndo_usd: 300, a_emitir_usd: 200, travado_usd: 0, invoice_count: 0 })
    expect(rows.find((row) => row.customer_id === 2)).toMatchObject({ travado_usd: 50, invoice_count: 2, open_usd: 1000, open_brl: 5500 })
  })

  it('a soma da coluna Correndo bate com o cartão Correndo quando todo grupo tem Cliente', () => {
    const withCustomer = groups.filter((item) => (item as { customer_id: number | null }).customer_id != null)
    const rows = buildCustomerExposure(withCustomer, [])
    expect(rows.reduce((sum, row) => sum + row.correndo_usd, 0)).toBe(divisionTotals(withCustomer).correndo.usd)
  })

  it('extrato: só as caixas sem Invoice do Cliente', () => {
    const boxes = customerUnbilledBoxes([
      group(1, 'correndo', 300, [box('B', 'running', 300), box('A', 'in_free_time', null)]),
      group(1, 'a_emitir', 200, [box('C', 'returned_overstay', 200), box('D', 'covered', null), box('E', 'waived', null)]),
      group(2, 'correndo', 10, [box('F', 'running', 10)]),
    ], 1)
    expect(boxes.map((item) => item.container_number)).toEqual(['B', 'C'])
    expect(boxes[1].division).toBe('a_emitir')
  })
})
