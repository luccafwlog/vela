import { describe, expect, it } from 'vitest'
import { PORTAL_SCHEDULE_LANES, formatScheduleDate, portalLaneCode } from '../portalScheduleLanes'

describe('portas-vitrine do Portal', () => {
  it('lista os 9 portos do servico na ordem das colunas (Suape desde a ADR 0114)', () => {
    expect(PORTAL_SCHEDULE_LANES.map((lane) => lane.label)).toEqual([
      'QINGDAO',
      'SHANGHAI',
      'TAICANG',
      'NINGBO',
      'NANSHA',
      'SALVADOR',
      'VITÓRIA',
      'PECÉM',
      'SUAPE',
    ])
  })

  it('classifica origem como POL e destino como POD', () => {
    const byLabel = Object.fromEntries(PORTAL_SCHEDULE_LANES.map((lane) => [lane.label, lane.kind]))
    expect(byLabel.QINGDAO).toBe('pol')
    expect(byLabel.SALVADOR).toBe('pod')
  })

  it('deriva o code canonico via normalizePortCode', () => {
    expect(portalLaneCode(PORTAL_SCHEDULE_LANES[0])).toBe('CNTAO')
    expect(portalLaneCode(PORTAL_SCHEDULE_LANES[5])).toBe('BRSSA')
    expect(portalLaneCode(PORTAL_SCHEDULE_LANES[8])).toBe('BRSUA')
  })
})

describe('formatScheduleDate', () => {
  it('converte ISO em DD/MM/AAAA sem usar Date (sem bug de fuso)', () => {
    expect(formatScheduleDate('2026-01-22')).toBe('22/01/2026')
  })

  it('mantem X e valores nao-ISO como estao', () => {
    expect(formatScheduleDate('X')).toBe('X')
    expect(formatScheduleDate('')).toBe('')
    expect(formatScheduleDate('22/01/2026')).toBe('22/01/2026')
  })
})
