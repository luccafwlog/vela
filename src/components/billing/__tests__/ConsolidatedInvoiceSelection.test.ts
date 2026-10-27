import { describe, expect, it } from 'vitest'
import {
  isReceivableSelectable,
  listReceivableVoyageOptions,
  summarizeConsolidation,
} from '../consolidatedInvoiceSelection'
import type { ConsolidatableReceivable } from '../../../types/database'

function makeRow(over: Partial<ConsolidatableReceivable>): ConsolidatableReceivable {
  return {
    receivable_id: 1,
    bl_id: 'BL1',
    customer_id: 10,
    customer_name: 'Cliente',
    customer_cnpj_cpf: '00000000000000',
    voyage_id: null,
    vessel_name: null,
    voyage_number: null,
    individual_invoice_id: null,
    individual_invoice_number: null,
    balance_brl: 100,
    original_amount_brl: 100,
    receivable_status: 'open',
    eligibility_status: 'eligible',
    eligibility_reason: 'Elegivel para consolidacao.',
    ...over,
  }
}

describe('consolidatedInvoiceSelection', () => {
  it('only eligible receivables are selectable', () => {
    expect(isReceivableSelectable(makeRow({ eligibility_status: 'eligible' }))).toBe(true)
    expect(isReceivableSelectable(makeRow({ eligibility_status: 'paid' }))).toBe(false)
    expect(isReceivableSelectable(makeRow({ eligibility_status: 'no_balance' }))).toBe(false)
    expect(isReceivableSelectable(makeRow({ eligibility_status: 'open_consolidated' }))).toBe(false)
    // FAT-D12 (migration 467): B/L com saldo e sem CE Mercante não entra.
    expect(isReceivableSelectable(makeRow({ eligibility_status: 'no_ce_mercante' }))).toBe(false)
  })

  it('summarizes only the selected receivables and counts eligible rows', () => {
    const rows = [
      makeRow({ receivable_id: 1, balance_brl: 100, eligibility_status: 'eligible' }),
      makeRow({ receivable_id: 2, balance_brl: 250.5, eligibility_status: 'eligible' }),
      makeRow({ receivable_id: 3, balance_brl: 999, eligibility_status: 'open_consolidated' }),
    ]

    const summary = summarizeConsolidation(rows, [1, 2])
    expect(summary.selectedCount).toBe(2)
    expect(summary.eligibleCount).toBe(2)
    expect(summary.total).toBeCloseTo(350.5, 2)
  })

  it('ignores selected ids that are not in the current rows', () => {
    const rows = [makeRow({ receivable_id: 1, balance_brl: 100 })]
    const summary = summarizeConsolidation(rows, [1, 42])
    expect(summary.selectedCount).toBe(1)
    expect(summary.total).toBeCloseTo(100, 2)
  })

  it('returns zeros for an empty selection', () => {
    const rows = [makeRow({ receivable_id: 1 })]
    const summary = summarizeConsolidation(rows, [])
    expect(summary).toEqual({ selectedCount: 0, eligibleCount: 1, total: 0 })
  })

  it('lists unique voyages with open receivable balances', () => {
    const rows = [
      makeRow({
        receivable_id: 1,
        voyage_id: 10,
        vessel_name: 'Atlas',
        voyage_number: '001',
        receivable_status: 'open',
        balance_brl: 100,
      }),
      makeRow({
        receivable_id: 2,
        voyage_id: 10,
        vessel_name: 'Atlas',
        voyage_number: '001',
        receivable_status: 'partially_settled',
        balance_brl: 40,
      }),
      makeRow({
        receivable_id: 3,
        voyage_id: 20,
        vessel_name: 'Bravo',
        voyage_number: '002',
        receivable_status: 'settled',
        balance_brl: 0,
      }),
      makeRow({
        receivable_id: 4,
        voyage_id: null,
        receivable_status: 'open',
        balance_brl: 75,
      }),
    ]

    expect(listReceivableVoyageOptions(rows)).toEqual([
      { id: 10, label: 'Atlas / 001' },
    ])
  })
})
