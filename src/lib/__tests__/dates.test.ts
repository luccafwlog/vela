import { describe, expect, it } from 'vitest'
import { formatBrasiliaDateTime, isWithinNextCalendarDays, saoPauloTodayIso } from '../dates'

describe('isWithinNextCalendarDays', () => {
  const today = new Date('2026-06-15T15:30:00-03:00')

  it('inclui vencimentos na data atual', () => {
    expect(isWithinNextCalendarDays('2026-06-15', 7, today)).toBe(true)
  })

  it('inclui vencimentos ate sete dias corridos', () => {
    expect(isWithinNextCalendarDays('2026-06-22', 7, today)).toBe(true)
  })

  it('exclui vencimentos apos a janela de sete dias', () => {
    expect(isWithinNextCalendarDays('2026-06-23', 7, today)).toBe(false)
  })

  it('exclui datas nulas, invalidas e passadas', () => {
    expect(isWithinNextCalendarDays(null, 7, today)).toBe(false)
    expect(isWithinNextCalendarDays('data-invalida', 7, today)).toBe(false)
    expect(isWithinNextCalendarDays('2026-06-14', 7, today)).toBe(false)
  })
})

describe('saoPauloTodayIso', () => {
  it('usa o dia de Brasília, não o de UTC, depois das 21h', () => {
    // 23h30 em Brasília de 13/10 = 02h30 UTC de 14/10.
    expect(saoPauloTodayIso(new Date('2026-10-14T02:30:00Z'))).toBe('2026-10-13')
    expect(saoPauloTodayIso(new Date('2026-10-14T03:00:00Z'))).toBe('2026-10-14')
  })
})

describe('formatBrasiliaDateTime', () => {
  it('mostra a hora de Brasília, não a UTC nem a do computador', () => {
    expect(formatBrasiliaDateTime(new Date('2026-10-23T17:32:09Z'))).toBe('23/10/2026 às 14:32')
    // 01:10 UTC ainda é o dia anterior em Brasília.
    expect(formatBrasiliaDateTime(Date.parse('2026-10-24T01:10:00Z'))).toBe('23/10/2026 às 22:10')
    expect(formatBrasiliaDateTime(new Date('2026-01-01T03:00:00Z'))).toBe('01/01/2026 às 00:00')
  })
})
