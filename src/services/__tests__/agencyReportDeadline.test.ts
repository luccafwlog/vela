import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  calculateAgencyReportDeadlineDate,
  countBusinessDaysBetween,
  deriveAgencyReportDeadlineState,
} from '../agencyReportDeadline'

describe('calculateAgencyReportDeadlineDate', () => {
  it('ATD na segunda: prazo vence na quinta (ter, qua, qui)', () => {
    // 2026-08-03 é segunda-feira.
    expect(calculateAgencyReportDeadlineDate('2026-08-03')).toBe('2026-08-06')
  })

  it('ATD na sexta: prazo vence na quarta seguinte (fim de semana nao conta)', () => {
    // 2026-08-07 é sexta-feira.
    expect(calculateAgencyReportDeadlineDate('2026-08-07')).toBe('2026-08-12')
  })

  it('ATD no sabado: prazo vence na quarta (conta a partir da segunda seguinte)', () => {
    // 2026-08-08 é sabado.
    expect(calculateAgencyReportDeadlineDate('2026-08-08')).toBe('2026-08-12')
  })

  it('retorna null para ATD em formato invalido', () => {
    expect(calculateAgencyReportDeadlineDate('08/03/2026')).toBeNull()
    expect(calculateAgencyReportDeadlineDate('not-a-date')).toBeNull()
  })
})

describe('deriveAgencyReportDeadlineState', () => {
  it('ATD ausente: sem prazo', () => {
    expect(
      deriveAgencyReportDeadlineState({ atd: null, omitted: false, signedAt: null, now: '2026-08-06T12:00:00Z' }),
    ).toBe('no-deadline')
  })

  it('escala omitida: sem prazo mesmo com ATD presente', () => {
    expect(
      deriveAgencyReportDeadlineState({
        atd: '2026-08-03',
        omitted: true,
        signedAt: null,
        now: '2026-08-06T12:00:00Z',
      }),
    ).toBe('no-deadline')
  })

  it('assinatura anterior ao ATD conta como no prazo assim que o ATD existe', () => {
    expect(
      deriveAgencyReportDeadlineState({
        atd: '2026-08-03',
        omitted: false,
        signedAt: '2026-07-30T09:00:00Z',
        now: '2026-08-06T12:00:00Z',
      }),
    ).toBe('on-time')
  })

  it('assinado exatamente no dia do prazo: no prazo (limite inclusivo)', () => {
    // ATD 2026-08-03 (segunda) -> prazo 2026-08-06 (quinta).
    expect(
      deriveAgencyReportDeadlineState({
        atd: '2026-08-03',
        omitted: false,
        signedAt: '2026-08-06T23:59:00Z',
        now: '2026-08-06T23:59:00Z',
      }),
    ).toBe('on-time')
  })

  it('assinado um dia apos o prazo: vencido', () => {
    expect(
      deriveAgencyReportDeadlineState({
        atd: '2026-08-03',
        omitted: false,
        signedAt: '2026-08-07T08:00:00Z',
        now: '2026-08-07T08:00:00Z',
      }),
    ).toBe('overdue')
  })

  it('nao assinado e "agora" ainda dentro do prazo: no prazo', () => {
    expect(
      deriveAgencyReportDeadlineState({
        atd: '2026-08-03',
        omitted: false,
        signedAt: null,
        now: '2026-08-06T10:00:00Z',
      }),
    ).toBe('on-time')
  })

  it('ADR nascido vencido: ATD registrado depois que o prazo ja passou, sem assinatura', () => {
    expect(
      deriveAgencyReportDeadlineState({
        atd: '2026-08-03',
        omitted: false,
        signedAt: null,
        now: '2026-08-10T10:00:00Z',
      }),
    ).toBe('overdue')
  })
})

describe('countBusinessDaysBetween', () => {
  it('conta os dias uteis entre segunda e quinta da mesma semana', () => {
    // 2026-08-03 (seg) -> 2026-08-06 (qui): ter, qua, qui = 3 dias uteis.
    expect(countBusinessDaysBetween('2026-08-03', '2026-08-06')).toBe(3)
  })

  it('fim de semana nao conta, mesmo quando o alvo cai num sabado', () => {
    // 2026-08-03 (seg) -> 2026-08-08 (sab): ter, qua, qui, sex = 4 dias
    // uteis; sabado (o proprio alvo) e domingo nao contam. Regressao do
    // bug em que um helper "pula direto para o proximo dia util" faria o
    // cursor ultrapassar um alvo em fim de semana antes de parar.
    expect(countBusinessDaysBetween('2026-08-03', '2026-08-08')).toBe(4)
  })

  it('alvo no mesmo dia da partida: zero dias uteis', () => {
    expect(countBusinessDaysBetween('2026-08-03', '2026-08-03')).toBe(0)
  })

  it('alvo anterior a partida: zero dias uteis (curto-circuito)', () => {
    expect(countBusinessDaysBetween('2026-08-06', '2026-08-03')).toBe(0)
  })

  it('retorna null para data em formato invalido', () => {
    expect(countBusinessDaysBetween('03/08/2026', '2026-08-06')).toBeNull()
    expect(countBusinessDaysBetween('2026-08-03', 'not-a-date')).toBeNull()
  })
})

// O ATD do ADR terminalizado nasce da Atracacao (TIMESTAMPTZ, migration 306) e
// chega com sufixo de hora. Antes disto o prazo simplesmente nao existia: a
// aba mostrava o ATD e, logo abaixo, "Aguardando a saída do navio."
describe('ATD com componente de hora (Atracação, TIMESTAMPTZ)', () => {
  it('calcula o prazo a partir de um ATD ISO com hora', () => {
    expect(calculateAgencyReportDeadlineDate('2026-08-03T00:00:00+00:00')).toBe('2026-08-06')
    expect(calculateAgencyReportDeadlineDate('2026-08-03T15:42:00Z')).toBe('2026-08-06')
    expect(calculateAgencyReportDeadlineDate('2026-08-03 00:00:00+00')).toBe('2026-08-06')
  })

  it('deriva o estado de prazo com ATD ISO com hora', () => {
    expect(
      deriveAgencyReportDeadlineState({
        atd: '2026-08-03T00:00:00+00:00',
        omitted: false,
        signedAt: '2026-08-05T10:00:00Z',
        now: '2026-08-05T10:00:00Z',
      }),
    ).toBe('on-time')
    expect(
      deriveAgencyReportDeadlineState({
        atd: '2026-08-03T00:00:00+00:00',
        omitted: false,
        signedAt: '2026-08-10T10:00:00Z',
        now: '2026-08-10T10:00:00Z',
      }),
    ).toBe('overdue')
  })

  it('conta dias úteis a partir de um ATD ISO com hora', () => {
    expect(countBusinessDaysBetween('2026-08-03T00:00:00+00:00', '2026-08-06')).toBe(3)
  })

  it('continua recusando data ambígua em formato não-ISO', () => {
    expect(calculateAgencyReportDeadlineDate('08/03/2026')).toBeNull()
    expect(countBusinessDaysBetween('03/08/2026', '2026-08-06')).toBeNull()
  })
})

// B9 (ADR 0039; migration 258): o prazo vence ao fim do dia em Brasília, não em UTC.
describe('B9 — prazo do ADR no dia de Brasília', () => {
  it('assinar às 22h30 de Brasília do último dia ainda é no prazo', () => {
    // ATD sexta 2026-10-02 → prazo quarta 2026-10-07; 22:30 BRT = 01:30Z do dia 8.
    expect(calculateAgencyReportDeadlineDate('2026-10-02')).toBe('2026-10-07')
    expect(deriveAgencyReportDeadlineState({ atd: '2026-10-02', omitted: false, signedAt: '2026-10-08T01:30:00Z', now: '2026-10-09T12:00:00Z' })).toBe('on-time')
    expect(deriveAgencyReportDeadlineState({ atd: '2026-10-02', omitted: false, signedAt: null, now: '2026-10-08T02:59:00Z' })).toBe('on-time')
    expect(deriveAgencyReportDeadlineState({ atd: '2026-10-02', omitted: false, signedAt: null, now: '2026-10-08T03:00:00Z' })).toBe('overdue')
  })

  it('o alerta compara com o dia de Brasília, nos dois caminhos', () => {
    const sql = readFileSync(resolve(process.cwd(), 'supabase/migrations/258_prazo_do_adr_no_dia_de_brasilia.sql'), 'utf8')
    expect(sql.match(/v_deadline < \(now\(\) AT TIME ZONE 'America\/Sao_Paulo'\)::date/g)).toHaveLength(2)
    expect(sql).not.toMatch(/v_deadline < CURRENT_DATE/)
  })
})
