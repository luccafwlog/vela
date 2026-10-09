import { describe, expect, it } from 'vitest'
import { describeInvoiceAmounts, describeInvoiceRowAmount, invoiceStatusTag } from '../invoiceDetailPresentation'

const base = { id: 1, invoice_number: 'F-1', invoice_type: 'individual', total_brl: 600, total_paid_brl: 0, balance_brl: 600, status: 'issued' }
const read = (lines: ReturnType<typeof describeInvoiceAmounts>) => lines.map((line) => `${line.label}=${line.value.replace(/\s/g, ' ')}${line.note ? ` (${line.note})` : ''}`)

describe('describeInvoiceAmounts', () => {
  it('fatura emitida sem recebimento: total, recebido zero e saldo a cobrar', () => {
    expect(read(describeInvoiceAmounts({ invoice: base } as never))).toEqual(['Total emitido=R$ 600,00', 'Recebido=R$ 0,00', 'Saldo em aberto=R$ 600,00'])
  })

  it('correção após pagamento: abatimento, devolução e pendência aparecem separados do total original', () => {
    const lines = describeInvoiceAmounts({
      invoice: { ...base, status: 'paid', total_paid_brl: 550, balance_brl: 0 },
      financial_summary: { gross_received_brl: 550, offset_brl: 50, refunded_brl: 20, pending_refund_brl: 30, net_received_brl: 530, paid_at: null },
    } as never)
    expect(read(lines)).toEqual([
      'Total emitido=R$ 600,00',
      'Recebido=R$ 550,00',
      'Abatido pela correção do B/L=R$ 50,00',
      'Devolvido ao Cliente=R$ 20,00',
      'A devolver=R$ 30,00 (Ainda não devolvido no banco)',
      'Saldo em aberto=R$ 0,00 (Quitada)',
    ])
  })

  it('sem resumo do servidor, usa as restituições listadas', () => {
    const lines = describeInvoiceAmounts({ invoice: { ...base, status: 'paid', total_paid_brl: 650, balance_brl: 0 } } as never, [
      { amount_brl: 50, status: 'pending' }, { amount_brl: 10, status: 'cancelled' },
    ])
    expect(read(lines)).toContain('A devolver=R$ 50,00 (Ainda não devolvido no banco)')
    expect(read(lines).some((line) => line.startsWith('Devolvido'))).toBe(false)
  })

  it('cancelada e obsoleta não mostram o saldo antigo como dívida; coberta nomeia a consolidada', () => {
    expect(read(describeInvoiceAmounts({ invoice: { ...base, status: 'cancelled' } } as never)).at(-1)).toBe('Saldo=Não cobrado (Fatura cancelada)')
    expect(read(describeInvoiceAmounts({ invoice: { ...base, status: 'obsolete' } } as never)).at(-1)).toMatch(/^Saldo=Não cobrado \(Obsoleta/)
    expect(read(describeInvoiceAmounts({ invoice: { ...base, status: 'covered', balance_brl: 0 }, financial_summary: { gross_received_brl: 0, offset_brl: 0, refunded_brl: 0, pending_refund_brl: 0, net_received_brl: 0, paid_at: null, covered_by_invoice_number: 'FAT-9' } } as never)).at(-1))
      .toBe('Saldo=R$ 0,00 (Coberta pela consolidada FAT-9)')
  })
})

describe('invoiceStatusTag', () => {
  it('mostra a situação exata em vez do grupo do filtro', () => {
    expect(invoiceStatusTag('partially_paid')).toEqual({ label: 'Parcialmente paga', tone: 'warning' })
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
