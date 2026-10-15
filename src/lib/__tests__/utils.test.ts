import { describe, expect, it } from 'vitest'

import { combineBrasiliaDateTime, splitIsoDateTime, toNumber } from '../utils'

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
