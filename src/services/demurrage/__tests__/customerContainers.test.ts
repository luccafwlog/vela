import { afterEach, describe, expect, it } from 'vitest'
import { __setDemurrageRateGroupsForTest } from '../demurrageRates'
import { customerContainerView } from '../customerContainers'
import type { DemurrageContainerRow } from '../demurrageContainers'

afterEach(() => __setDemurrageRateGroupsForTest(null))

function row(overrides: Partial<DemurrageContainerRow>): DemurrageContainerRow {
  return {
    id: 1,
    bl_id: 'BL-1',
    container_number: 'TGHU0000001',
    type: '40HC',
    discharge_date: '2026-09-01',
    return_date: null,
    demurrage_status: 'overdue',
    ownership: 'COC',
    bl: { id: 'BL-1', pol: 'CNSHA', pod: 'BRSSZ', free_time_override: null, demurrage_rate_override_p1_usd: null, demurrage_rate_override_p2_usd: null, demurrage_roe_manual: null, demurrage_roe: null, voyage_id: 10, customer: { id: 7, name: 'Cliente', cnpj_cpf: '1' }, voyage: null },
    customer_agreement: null,
    billed_in: [],
    ...overrides,
  } as DemurrageContainerRow
}

describe('aba Contêineres da ficha do Cliente', () => {
  it('mostra dias, free time e a Demurrage em uma palavra, com o mesmo cálculo da tela Demurrage', () => {
    __setDemurrageRateGroupsForTest([{ aliases: ['40HC'], freeUntil: 21, p1: { range: [22, 30], usd: 70 }, p2: { range: [31, Infinity], usd: 140 } }])

    // Fora, passou do free time: valor em curso, até hoje.
    const running = customerContainerView(row({}), '2026-10-14')
    expect(running).toMatchObject({ days: 43, freeTimeDays: 21, freeTimeSourceLabel: 'tabela', overFreeTime: true })
    expect(running.demurrage).toEqual({ kind: 'running', usd: 9 * 70 + 13 * 140 })

    // Devolvido fora do free time e sem fatura: a faturar, até a devolução.
    const toBill = customerContainerView(row({ return_date: '2026-09-28' }), '2026-10-14')
    expect(toBill.days).toBe(27)
    expect(toBill.demurrage).toEqual({ kind: 'to_bill', usd: 6 * 70 })

    // Coberto por fatura viva: a fatura, não o valor previsto.
    const invoiced = customerContainerView(row({ return_date: '2026-09-28', billed_in: [{ id: 4, doc_number: 'DEM-2026-0004', status: 'paid', bl_id: 'BL-1' }] }), '2026-10-14')
    expect(invoiced.demurrage).toEqual({ kind: 'invoice', invoice: { id: 4, doc_number: 'DEM-2026-0004', status: 'paid', bl_id: 'BL-1' } })

    // Dentro do free time: nada; acordo do Cliente muda a origem.
    const inside = customerContainerView(row({ discharge_date: '2026-10-11', customer_agreement: { id: 1, free_days: 30, p1_usd: null, p2_usd: null } }), '2026-10-14')
    expect(inside).toMatchObject({ days: 3, freeTimeDays: 30, freeTimeSourceLabel: 'acordo do Cliente', overFreeTime: false, demurrage: { kind: 'none' } })
  })

  it('SOC entra na lista sem free time nem Demurrage; sem descarga, sem dias', () => {
    expect(customerContainerView(row({ ownership: 'SOC' }), '2026-10-14')).toMatchObject({ soc: true, freeTimeDays: null, demurrage: { kind: 'soc' } })
    expect(customerContainerView(row({ ownership: 'SOC', discharge_date: null }), '2026-10-14').days).toBeNull()
  })
})
