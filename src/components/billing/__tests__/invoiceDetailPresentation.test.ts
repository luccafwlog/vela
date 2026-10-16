import { describe, expect, it } from 'vitest'
import { describeInvoiceBalance, describeInvoiceRowAmount, invoiceStatusTag } from '../invoiceDetailPresentation'

const base = { id: 1, invoice_number: 'F-1', invoice_type: 'individual', total_brl: 600, total_paid_brl: 0, balance_brl: 600, status: 'issued' }
const read = (lead: ReturnType<typeof describeInvoiceBalance>) => lead ? `${lead.paid ? '✓ ' : ''}${lead.value} | ${lead.detail} | ${lead.tone}`.replace(/\s/g, ' ') : null
const summary = (extra: object) => ({ gross_received_brl: 0, offset_brl: 0, refunded_brl: 0, pending_refund_brl: 0, net_received_brl: 0, paid_at: null, ...extra })

describe('describeInvoiceBalance', () => {
  it('em aberto: o que falta receber em âmbar, com total e recebido na linha de apoio', () => {
    expect(read(describeInvoiceBalance({ invoice: base } as never))).toBe('R$ 600,00 em aberto | de R$ 600,00 | warning')
    expect(read(describeInvoiceBalance({ invoice: { ...base, status: 'partially_paid', total_paid_brl: 100, balance_brl: 500 } } as never)))
      .toBe('R$ 500,00 em aberto | de R$ 600,00 · recebido R$ 100,00 | warning')
  })

  it('paga com correção: abatimento, devolução e pendência ficam no apoio, separados do recebido', () => {
    const lead = describeInvoiceBalance({
      invoice: { ...base, status: 'paid', total_paid_brl: 550, balance_brl: 0 },
      financial_summary: summary({ gross_received_brl: 550, offset_brl: 50, refunded_brl: 20, pending_refund_brl: 30, paid_at: '2026-10-14T12:00:00Z' }),
    } as never)
    expect(read(lead)).toBe('✓ Paga | R$ 550,00 recebidos em 14/10/2026 · total R$ 600,00 · abatido pela correção do B/L R$ 50,00 · devolvido ao Cliente R$ 20,00 · a devolver R$ 30,00 | default')
  })

  it('sem resumo do servidor, usa as restituições listadas', () => {
    const lead = describeInvoiceBalance({ invoice: { ...base, status: 'paid', total_paid_brl: 650, balance_brl: 0 } } as never, [
      { amount_brl: 50, status: 'pending' }, { amount_brl: 10, status: 'cancelled' },
    ])
    expect(lead?.detail).toContain('a devolver R$')
    expect(lead?.detail).not.toContain('devolvido')
  })

  it('cancelada, obsoleta e coberta não aparecem como dívida', () => {
    expect(read(describeInvoiceBalance({ invoice: { ...base, status: 'cancelled', cancel_reason: 'Cliente pediu faturas separadas' } } as never)))
      .toBe('Cancelada | não cobrada · motivo: Cliente pediu faturas separadas | muted')
    expect(describeInvoiceBalance({ invoice: { ...base, status: 'obsolete' } } as never)).toMatchObject({ value: 'Cancelada', tone: 'muted' })
    expect(read(describeInvoiceBalance({ invoice: { ...base, status: 'covered', balance_brl: 0 }, financial_summary: summary({ covered_by_invoice_number: 'FAT-9' }) } as never)))
      .toBe('Coberta | pela consolidada FAT-9 · total R$ 600,00 | muted')
  })
})

describe('invoiceStatusTag', () => {
  it('mostra a situação exata em vez do grupo do filtro', () => {
    expect(invoiceStatusTag('partially_paid')).toEqual({ label: 'Parcialmente paga', tone: 'default' })
    expect(invoiceStatusTag('paid')).toEqual({ label: 'Paga', tone: 'paid' })
    expect(invoiceStatusTag('covered').label).toBe('Coberta')
    expect(invoiceStatusTag('overdue').label).toBe('Emitida')
    expect(invoiceStatusTag('obsolete').label).toBe('Obsoleta')
  })
})

describe('describeInvoiceRowAmount', () => {
  const row = (status: string, paid: number, balance: number) => describeInvoiceRowAmount({ status, total_brl: 3010, total_paid_brl: paid, balance_brl: balance })
  const plain = (value: { main: string; detail: string }) => `${value.main} | ${value.detail}`.replace(/\s/g, ' ')
  it('em aberto mostra o saldo; parcial diz quanto já entrou', () => {
    expect(plain(row('issued', 0, 3010))).toBe('R$ 3.010,00 | em aberto')
    expect(plain(row('partially_paid', 1500, 1510))).toBe('R$ 1.510,00 | em aberto de R$ 3.010,00')
  })
  it('paga, coberta e cancelada não aparecem como dívida', () => {
    expect(plain(row('paid', 3010, 0))).toBe('R$ 3.010,00 | recebido R$ 3.010,00')
    expect(plain(row('covered', 0, 0))).toBe('R$ 0,00 | coberta · total R$ 3.010,00')
    expect(row('cancelled', 0, 3010)).toMatchObject({ detail: 'não cobrado', tone: 'muted' })
  })
})
