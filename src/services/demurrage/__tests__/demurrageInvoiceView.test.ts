import { describe, expect, it } from 'vitest'
import { daysOpen, daysToPay, destinationText, isOutOfDunning, paymentMethodLabel } from '../demurrageInvoiceView'

describe('dias da Invoice de Demurrage pelo dia de Brasília', () => {
  it('emitida às 22h de Brasília conta o dia de Brasília, não o de UTC', () => {
    // 2026-08-09 22:00 em Brasília é 2026-08-10 01:00 UTC.
    expect(daysOpen('2026-08-10T01:00:00Z', new Date('2026-08-10T12:00:00Z'))).toBe(1)
    expect(daysToPay('2026-08-10T01:00:00Z', '2026-08-19')).toBe(10)
  })

  it('sem data não inventa número', () => {
    expect(daysOpen(null)).toBeNull()
    expect(daysToPay('2026-08-10T12:00:00Z', null)).toBeNull()
  })
})

describe('rótulos', () => {
  it('meio de pagamento conhecido e desconhecido', () => {
    expect(paymentMethodLabel('extrato')).toBe('Extrato')
    expect(paymentMethodLabel('isencao')).toBe('Isenção (desconto integral)')
    expect(paymentMethodLabel('outro')).toBeNull()
  })

  it('destino nomeia a caixa ou conta as caixas', () => {
    expect(destinationText({ kind: 'cobrada', invoice_id: 9, doc_number: 'DEM-2026-0009', containers: ['MSCU1'] })).toBe('MSCU1: cobrada na DEM-2026-0009')
    expect(destinationText({ kind: 'aguardando', invoice_id: null, doc_number: null, containers: ['A', 'B'] })).toBe('2 caixas: aguardando nova Invoice')
  })
})

describe('Fora da Régua', () => {
  const base = { status: 'issued', dunning_suspended_reason: null, dispute_open: false, roe_source: 'bcb_live', paid_at: null } as never
  it('pausa da Régua conta; Régua encerrada não', () => {
    expect(isOutOfDunning(base, { pauseReason: 'sem contato de cobrança' } as never)).toBe(true)
    expect(isOutOfDunning(base, { pauseReason: 'liquidada' } as never)).toBe(false)
    expect(isOutOfDunning(base, undefined)).toBe(false)
    expect(isOutOfDunning({ ...(base as object), dunning_suspended_reason: 'Cliente pediu prazo' } as never, undefined)).toBe(true)
  })
})
