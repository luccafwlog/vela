import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  calculateAgencyReportDeadlineAt,
  deriveAgencyReportDeadlineState,
  hoursSinceAtd,
} from '../agencyReportDeadline'

// Prazo do ADR: ATD + 72 horas corridas (decisão de 2026-10-15; ADR 0039).
describe('calculateAgencyReportDeadlineAt', () => {
  it('soma 72 horas exatas à hora do ATD, com fim de semana contando', () => {
    // Sexta 18:40 de Brasília → segunda 18:40 de Brasília.
    expect(calculateAgencyReportDeadlineAt('2026-10-16T18:40:00-03:00')).toBe('2026-10-19T21:40:00.000Z')
  })
  it('ATD antigo, só com a data, vale como 00:00 de Brasília', () => {
    expect(calculateAgencyReportDeadlineAt('2026-10-13')).toBe('2026-10-16T03:00:00.000Z')
  })
  it('retorna null para ATD inválido', () => {
    expect(calculateAgencyReportDeadlineAt('08/03/2026')).toBeNull()
  })
})

describe('deriveAgencyReportDeadlineState', () => {
  const atd = '2026-10-13T18:40:00-03:00' // prazo: 2026-10-16 18:40 de Brasília = 21:40Z
  it('ATD ausente ou escala omitida: sem prazo', () => {
    expect(deriveAgencyReportDeadlineState({ atd: null, omitted: false, signedAt: null, now: '2026-10-20T00:00:00Z' })).toBe('no-deadline')
    expect(deriveAgencyReportDeadlineState({ atd, omitted: true, signedAt: null, now: '2026-10-20T00:00:00Z' })).toBe('no-deadline')
  })
  it('assinado exatamente no instante do prazo: no prazo; um minuto depois: atrasado', () => {
    expect(deriveAgencyReportDeadlineState({ atd, omitted: false, signedAt: '2026-10-16T21:40:00Z', now: '2026-10-20T00:00:00Z' })).toBe('on-time')
    expect(deriveAgencyReportDeadlineState({ atd, omitted: false, signedAt: '2026-10-16T21:41:00Z', now: '2026-10-20T00:00:00Z' })).toBe('overdue')
  })
  it('sem assinatura, compara com agora', () => {
    expect(deriveAgencyReportDeadlineState({ atd, omitted: false, signedAt: null, now: '2026-10-16T21:00:00Z' })).toBe('on-time')
    expect(deriveAgencyReportDeadlineState({ atd, omitted: false, signedAt: null, now: '2026-10-16T22:00:00Z' })).toBe('overdue')
  })
  it('ADR fechado antes da regra mantém a data congelada, comparada pelo dia de Brasília', () => {
    // Prazo congelado (3 dias úteis) 2026-10-07; 22:30 BRT do dia 7 = 01:30Z do dia 8.
    expect(deriveAgencyReportDeadlineState({ atd: '2026-10-02', omitted: false, signedAt: '2026-10-08T01:30:00Z', now: '2026-10-09T12:00:00Z', frozenDeadlineDate: '2026-10-07' })).toBe('on-time')
    expect(deriveAgencyReportDeadlineState({ atd: '2026-10-02', omitted: false, signedAt: '2026-10-08T03:00:00Z', now: '2026-10-09T12:00:00Z', frozenDeadlineDate: '2026-10-07' })).toBe('overdue')
  })
})

describe('hoursSinceAtd', () => {
  it('conta horas inteiras do ATD até a assinatura', () => {
    expect(hoursSinceAtd('2026-10-13T18:40:00-03:00', '2026-10-14T10:32:00-03:00')).toBe(15)
  })
})

describe('alerta de prazo no banco', () => {
  it('compara o instante de agora com ATD + 72 horas, nos dois caminhos', () => {
    const sql = readFileSync(resolve(process.cwd(), 'supabase/migrations/289_prazo_do_adr_em_72_horas.sql'), 'utf8')
    expect(sql).toMatch(/interval '72 hours'/)
    expect(sql.match(/v_deadline_at < now\(\)/g)).toHaveLength(2)
  })
})
