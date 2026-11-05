import { describe, expect, it } from 'vitest'

import { combineBrasiliaDateTime, formatPaymentDate, paymentDateParts, splitIsoDateTime, toNumber } from '../utils'

describe('toNumber', () => {
  it.each([
    ['1.5', 1.5],
    ['1.234,56', 1234.56],
    ['1,5', 1.5],
    ['10 KGS', 10],
    ['', null],
    [42.7, 42.7],
  ])('parses %p as %p', (value, expected) => {
    expect(toNumber(value)).toBe(expected)
  })
})

describe('atracação no fuso de Brasília', () => {
  it('grava a hora digitada com -03:00 e mantém a data sozinha', () => {
    expect(combineBrasiliaDateTime('2026-10-16', '18:40')).toBe('2026-10-16T18:40:00-03:00')
    expect(combineBrasiliaDateTime('2026-10-16', '')).toBe('2026-10-16')
  })
  it('exibe o instante do banco na hora de Brasília', () => {
    expect(splitIsoDateTime('2026-10-16T21:40:00+00:00')).toEqual({ date: '2026-10-16', time: '18:40' })
    expect(splitIsoDateTime('2026-10-17T01:30:00Z')).toEqual({ date: '2026-10-16', time: '22:30' })
    expect(splitIsoDateTime('2026-10-09 03:00:00+00')).toEqual({ date: '2026-10-09', time: '00:00' })
    expect(splitIsoDateTime('2026-10-16T18:40:00')).toEqual({ date: '2026-10-16', time: '18:40' })
  })
})

describe('formatPaymentDate (Pago em do Histórico de baixas)', () => {
  it('mostra a hora de Brasília quando a baixa guarda a hora', () => {
    expect(formatPaymentDate('2026-11-04T19:04:31.512+00:00')).toBe('04/11/2026 16:04')
    // Pix das 22:30 fica no próprio dia, não no seguinte do UTC.
    expect(paymentDateParts('2026-11-05T01:30:12+00:00')).toEqual({ date: '2026-11-04', time: '22:30' })
  })

  it('a baixa informada com o dia não ganha hora inventada', () => {
    // Extrato: o dia gravado como meia-noite UTC continua o mesmo dia.
    expect(formatPaymentDate('2026-11-04T00:00:00+00:00')).toBe('04/11/2026')
    // Manual do Vela: meio-dia de Brasília em ponto.
    expect(formatPaymentDate('2026-11-04T15:00:00+00:00')).toBe('04/11/2026')
    // Demurrage guarda a data pura.
    expect(formatPaymentDate('2026-11-04')).toBe('04/11/2026')
    expect(formatPaymentDate(null)).toBe('')
  })
})
