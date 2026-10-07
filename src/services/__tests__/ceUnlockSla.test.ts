import { describe, expect, it } from 'vitest'
import { ceUnlockDeadline, ceUnlockSlaState } from '../ceUnlockSla'

// Horários em Brasília (-03:00). 2026-10-07 é quarta-feira.
const br = (iso: string) => new Date(`${iso}-03:00`)
const at = (d: Date) => d.toISOString()

describe('prazo de desbloqueio de CE', () => {
  it('antes das 12:00 vence às 17:00 do mesmo dia, inclusive antes das 08:30', () => {
    expect(at(ceUnlockDeadline(br('2026-10-07T07:50:00')))).toBe(at(br('2026-10-07T17:00:00')))
    expect(at(ceUnlockDeadline(br('2026-10-07T11:59:59')))).toBe(at(br('2026-10-07T17:00:00')))
  })
  it('a partir das 12:00 vence às 12:30 do próximo dia útil', () => {
    expect(at(ceUnlockDeadline(br('2026-10-07T12:00:00')))).toBe(at(br('2026-10-08T12:30:00')))
    expect(at(ceUnlockDeadline(br('2026-10-07T18:30:00')))).toBe(at(br('2026-10-08T12:30:00')))
  })
  it('sexta à tarde vence na segunda às 12:30', () => {
    expect(at(ceUnlockDeadline(br('2026-10-09T14:00:00')))).toBe(at(br('2026-10-12T12:30:00')))
  })
  it('sábado e domingo vencem segunda às 12:00', () => {
    expect(at(ceUnlockDeadline(br('2026-10-10T15:00:00')))).toBe(at(br('2026-10-12T12:00:00')))
    expect(at(ceUnlockDeadline(br('2026-10-11T09:00:00')))).toBe(at(br('2026-10-12T12:00:00')))
  })
  it('classifica vencido, vence hoje e no prazo', () => {
    const start = '2026-10-07T10:00:00-03:00'
    expect(ceUnlockSlaState(start, br('2026-10-07T16:59:00')).state).toBe('today')
    expect(ceUnlockSlaState(start, br('2026-10-07T17:01:00')).state).toBe('overdue')
    expect(ceUnlockSlaState('2026-10-07T13:00:00-03:00', br('2026-10-07T13:30:00')).state).toBe('ok')
    expect(ceUnlockSlaState(null).state).toBe('none')
  })
})
