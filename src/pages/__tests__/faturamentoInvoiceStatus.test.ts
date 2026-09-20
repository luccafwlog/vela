import { describe, expect, it } from 'vitest'
import {
  INVOICE_STATUS_FILTER_OPTIONS,
  invoiceStatusLabel,
  invoiceStatusTone,
} from '../faturamentoInvoiceStatus'

describe('invoiceStatusLabel', () => {
  it('agrupa status de "em aberto" como Emitida', () => {
    for (const s of ['issued', 'partially_paid', 'overdue', 'draft', null, 'qualquer']) {
      expect(invoiceStatusLabel(s)).toBe('Emitida')
    }
  })

  it('agrupa status quitados como Paga', () => {
    expect(invoiceStatusLabel('paid')).toBe('Paga')
    expect(invoiceStatusLabel('covered')).toBe('Paga')
  })

  it('agrupa status cancelados/obsoletos como Cancelada', () => {
    expect(invoiceStatusLabel('cancelled')).toBe('Cancelada')
    expect(invoiceStatusLabel('obsolete')).toBe('Cancelada')
  })
})

describe('invoiceStatusTone', () => {
  it('mapeia tom de cor coerente com o rótulo', () => {
    expect(invoiceStatusTone('paid')).toBe('green')
    expect(invoiceStatusTone('cancelled')).toBe('red')
    expect(invoiceStatusTone('issued')).toBe('blue')
    expect(invoiceStatusTone(null)).toBe('blue')
  })
})

describe('INVOICE_STATUS_FILTER_OPTIONS', () => {
  it('expõe exatamente os 3 estados operacionais', () => {
    expect(INVOICE_STATUS_FILTER_OPTIONS.map((o) => o.value)).toEqual([
      'issued',
      'paid',
      'cancelled',
    ])
  })
})
