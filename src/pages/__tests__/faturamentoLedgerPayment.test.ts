import { describe, expect, it } from 'vitest'

import { isLedgerInvoicePayable } from '../faturamentoLedgerPayment'

describe('isLedgerInvoicePayable', () => {
  const payable = { invoice_type: 'individual', status: 'issued', balance_brl: 100 }

  it('aceita invoice local do ledger com saldo e status pagável', () => {
    expect(isLedgerInvoicePayable(payable)).toBe(true)
    expect(isLedgerInvoicePayable({ ...payable, invoice_type: 'consolidated' })).toBe(true)
    expect(isLedgerInvoicePayable({ ...payable, status: 'partially_paid' })).toBe(true)
    expect(isLedgerInvoicePayable({ ...payable, status: 'overdue' })).toBe(true)
  })

  it('aceita saldo informado como string numérica', () => {
    expect(isLedgerInvoicePayable({ ...payable, balance_brl: '250.50' })).toBe(true)
  })

  it('rejeita null/undefined', () => {
    expect(isLedgerInvoicePayable(null)).toBe(false)
    expect(isLedgerInvoicePayable(undefined)).toBe(false)
  })

  it('rejeita tipo que não é do ledger local (ex.: demurrage/granito)', () => {
    expect(isLedgerInvoicePayable({ ...payable, invoice_type: 'demurrage' })).toBe(false)
    expect(isLedgerInvoicePayable({ ...payable, invoice_type: 'manual' })).toBe(false)
    expect(isLedgerInvoicePayable({ ...payable, invoice_type: null })).toBe(false)
  })

  it('rejeita status não pagável', () => {
    expect(isLedgerInvoicePayable({ ...payable, status: 'paid' })).toBe(false)
    expect(isLedgerInvoicePayable({ ...payable, status: 'cancelled' })).toBe(false)
    expect(isLedgerInvoicePayable({ ...payable, status: null })).toBe(false)
  })

  it('rejeita saldo zero, negativo, nulo ou não numérico', () => {
    expect(isLedgerInvoicePayable({ ...payable, balance_brl: 0 })).toBe(false)
    expect(isLedgerInvoicePayable({ ...payable, balance_brl: -10 })).toBe(false)
    expect(isLedgerInvoicePayable({ ...payable, balance_brl: null })).toBe(false)
    expect(isLedgerInvoicePayable({ ...payable, balance_brl: 'abc' })).toBe(false)
  })
})
