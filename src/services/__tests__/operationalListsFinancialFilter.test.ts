import { describe, expect, it } from 'vitest'
import { financialAndChargeArgs } from '../operationalLists'

describe('financialAndChargeArgs (filtro Faturamento › B/L cancelado)', () => {
  it('B/L cancelado busca pelo estado derivado do cancelamento, não por financial_status', () => {
    expect(financialAndChargeArgs({ financialStatus: 'cancelled', chargeStatus: '' }))
      .toEqual({ p_financial_status: null, p_charge_status: 'cancelled' })
  })

  it('B/L cancelado combinado com outro estado de taxas locais fica vazio', () => {
    expect(financialAndChargeArgs({ financialStatus: 'cancelled', chargeStatus: 'pending' }))
      .toEqual({ p_financial_status: 'cancelled', p_charge_status: 'pending' })
  })

  it('demais opções seguem como estão', () => {
    expect(financialAndChargeArgs({ financialStatus: 'invoiced', chargeStatus: 'issued' }))
      .toEqual({ p_financial_status: 'invoiced', p_charge_status: 'issued' })
    expect(financialAndChargeArgs({})).toEqual({ p_financial_status: null, p_charge_status: null })
  })
})
