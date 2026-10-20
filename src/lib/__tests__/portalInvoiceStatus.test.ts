import { describe, expect, it } from 'vitest'
import { demurrageSituation, portalInvoicesInOpenBalance } from '../portalInvoiceStatus'

describe('demurrageSituation', () => {
  it('Demurrage não vence (B29): o estado legado overdue aparece como Emitida', () => {
    expect(demurrageSituation({ status: 'overdue' })).toEqual({ label: 'Emitida', tone: 'default' })
  })
  it('disputa aberta pede ação; paga e cancelada encerram', () => {
    expect(demurrageSituation({ status: 'overdue', dispute_open: true })).toEqual({ label: 'Em disputa', tone: 'warning' })
    expect(demurrageSituation({ status: 'covered' }).label).toBe('Paga')
    expect(demurrageSituation({ status: 'obsolete' }).tone).toBe('muted')
  })
})

// Obs. 6 (sessão de testes de 2026-10-20): a consolidada aberta conta no lugar
// das individuais que agrupa; o saldo não soma as duas.
describe('portalInvoicesInOpenBalance', () => {
  const ind = (n: string, bl: string, status = 'issued') => ({ invoice_number: n, invoice_type: 'individual', status, balance_brl: 100, bls: [bl] })
  it('duas individuais de R$ 100 e a consolidada de R$ 200 em aberto dão R$ 200', () => {
    const rows = [ind('I1', 'BL1'), ind('I2', 'BL2'), ind('I3', 'BL3'),
      { invoice_number: 'C1', invoice_type: 'consolidated', status: 'issued', balance_brl: 200, bls: ['BL1', 'BL2'] }]
    const counted = portalInvoicesInOpenBalance(rows)
    expect(counted.map((row) => row.invoice_number)).toEqual(['I3', 'C1'])
    expect(counted.reduce((sum, row) => sum + row.balance_brl, 0)).toBe(300)
  })
  it('consolidada paga ou cancelada devolve as individuais à soma conforme o status delas', () => {
    const paid = [ind('I1', 'BL1', 'covered'), { invoice_number: 'C1', invoice_type: 'consolidated', status: 'paid', balance_brl: 0, bls: ['BL1'] }]
    expect(portalInvoicesInOpenBalance(paid)).toEqual([])
    const undone = [ind('I1', 'BL1'), { invoice_number: 'C1', invoice_type: 'consolidated', status: 'obsolete', balance_brl: 100, bls: ['BL1'] }]
    expect(portalInvoicesInOpenBalance(undone).map((row) => row.invoice_number)).toEqual(['I1'])
  })
})
