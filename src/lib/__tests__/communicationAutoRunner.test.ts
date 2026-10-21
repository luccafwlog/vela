import { describe, expect, it } from 'vitest'
import { AUTO_RUNNER_MINUTES, nextAutoRunnerRun, queuedLabel } from '../communicationAutoRunner'

// Melhoria 10 (sessão de testes de 2026-10-20): "Na fila · próxima rodada às
// HH:MM (BRT)", calculado do cron `4-59/15 * * * *` do robô de Comunicados.
describe('próxima rodada do robô de Comunicados', () => {
  it('espelha o cron 4-59/15', () => {
    expect(AUTO_RUNNER_MINUTES).toEqual([4, 19, 34, 49])
  })

  it('é a próxima marca depois de agora, virando a hora depois do :49', () => {
    expect(nextAutoRunnerRun(new Date('2026-10-20T19:05:00Z')).toISOString()).toBe('2026-10-20T19:19:00.000Z')
    expect(nextAutoRunnerRun(new Date('2026-10-20T19:19:00Z')).toISOString()).toBe('2026-10-20T19:34:00.000Z')
    expect(nextAutoRunnerRun(new Date('2026-10-20T19:50:30Z')).toISOString()).toBe('2026-10-20T20:04:00.000Z')
    expect(nextAutoRunnerRun(new Date('2026-10-20T23:55:00Z')).toISOString()).toBe('2026-10-21T00:04:00.000Z')
  })

  it('mostra o horário de Brasília', () => {
    expect(queuedLabel(new Date('2026-10-20T19:05:00Z'))).toBe('Na fila · próxima rodada às 16:19 (BRT)')
  })
})
