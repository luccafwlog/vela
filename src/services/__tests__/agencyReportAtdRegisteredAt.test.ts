import { describe, expect, it } from 'vitest'
import { atdRegisteredAtFromAudit } from '../agencyDepartureReport'

// B8: a Linha do Tempo do ADR mostra quando o ATD da Atracação foi registrado.
const TERMINAL = 'term-1'
const row = (changedAt: string, next: Record<string, unknown>, previous: Record<string, unknown> | null) => ({
  changed_at: changedAt,
  new_value: JSON.stringify(next),
  old_value: previous ? JSON.stringify(previous) : null,
})

describe('atdRegisteredAtFromAudit', () => {
  it('acha a gravação que trouxe o ATD vigente, ignorando edições posteriores de outras datas', () => {
    const rows = [
      row('2026-10-03T10:00:00Z', { terminal_id: TERMINAL, terminal_atb: '2026-09-29', terminal_atd: '2026-10-01T15:00:00+00:00', terminal_rtw: '2026-10-02T08:30:00+00:00' }, { terminal_id: TERMINAL, terminal_atb: '2026-09-29', terminal_atd: '2026-10-01T15:00:00+00:00', terminal_rtw: null }),
      row('2026-10-01T22:15:00Z', { terminal_id: TERMINAL, terminal_atb: '2026-09-29', terminal_atd: '2026-10-01T15:00:00+00:00' }, { terminal_id: TERMINAL, terminal_atb: '2026-09-29', terminal_atd: null }),
      row('2026-10-01T23:00:00Z', { terminal_id: 'outro', terminal_atd: '2026-10-01T15:00:00+00:00' }, null),
    ]
    expect(atdRegisteredAtFromAudit(rows, TERMINAL, '2026-10-01T15:00:00.000Z')).toBe('2026-10-01T22:15:00Z')
  })

  it('ATD corrigido conta a partir da correção; sem rastro, null', () => {
    const rows = [
      row('2026-10-05T09:00:00Z', { terminal_id: TERMINAL, terminal_atd: '2026-10-02T08:30:00+00:00' }, { terminal_id: TERMINAL, terminal_atd: '2026-10-01T15:00:00+00:00' }),
      row('2026-10-01T22:15:00Z', { terminal_id: TERMINAL, terminal_atd: '2026-10-01T15:00:00+00:00' }, null),
    ]
    expect(atdRegisteredAtFromAudit(rows, TERMINAL, '2026-10-02T08:30:00+00:00')).toBe('2026-10-05T09:00:00Z')
    expect(atdRegisteredAtFromAudit([], TERMINAL, '2026-10-02T08:30:00+00:00')).toBeNull()
  })
})
