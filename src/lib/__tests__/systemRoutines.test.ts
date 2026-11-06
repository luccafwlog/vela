import { describe, expect, it } from 'vitest'
import { describeCronSchedule, routineLabel } from '../systemRoutines'

// Os horários são os das 21 rotinas de produção em 2026-11-06 (UTC no pg_cron).
describe('rotinas automáticas na aba Sistema', () => {
  it('quando roda, em horário de Brasília', () => {
    expect(describeCronSchedule('* * * * *')).toBe('a cada minuto')
    expect(describeCronSchedule('1-59/2 * * * *')).toBe('a cada 2 min')
    expect(describeCronSchedule('*/5 * * * *')).toBe('a cada 5 min')
    expect(describeCronSchedule('7 * * * *')).toBe('de hora em hora')
    expect(describeCronSchedule('0 11 * * *')).toBe('todo dia 08:00')
    expect(describeCronSchedule('30 6 * * *')).toBe('todo dia 03:30')
    expect(describeCronSchedule('0 17 * * 1-5')).toBe('dias úteis 14:00')
    expect(describeCronSchedule('0 0 1 * *')).toBe('horário próprio')
  })

  it('nome em português, e o técnico só para rotina nova', () => {
    expect(routineLabel('itau-pix-queue')).toBe('Leitura do Pix Itaú')
    expect(routineLabel('rotina-nova')).toBe('Rotina rotina-nova')
  })
})
