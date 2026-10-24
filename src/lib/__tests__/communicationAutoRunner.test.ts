import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { AUTO_RUNNER_MINUTES, nextAutoRunnerRun, queuedLabel } from '../communicationAutoRunner'

// Melhoria 10 (sessão de testes de 2026-10-20): "Na fila · próxima rodada às
// HH:MM (BRT)", calculado do cron do robô de Comunicados (`1-59/2 * * * *`
// desde a migration 456; antes `4-59/15`).
describe('próxima rodada do robô de Comunicados', () => {
  it('espelha o cron 1-59/2 da migration 456', () => {
    expect(AUTO_RUNNER_MINUTES).toEqual([1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23, 25, 27, 29,
      31, 33, 35, 37, 39, 41, 43, 45, 47, 49, 51, 53, 55, 57, 59])
    const migration = readFileSync(path.resolve('supabase/migrations/456_emails_automaticos_saem_pelo_evento.sql'), 'utf8')
    expect(migration).toMatch(/\('customer-communication-auto-runner',\s+'1-59\/2 \* \* \* \*'\)/)
  })

  it('é a próxima marca depois de agora, virando a hora depois do :59', () => {
    expect(nextAutoRunnerRun(new Date('2026-10-20T19:05:00Z')).toISOString()).toBe('2026-10-20T19:07:00.000Z')
    expect(nextAutoRunnerRun(new Date('2026-10-20T19:06:59Z')).toISOString()).toBe('2026-10-20T19:07:00.000Z')
    expect(nextAutoRunnerRun(new Date('2026-10-20T19:07:00Z')).toISOString()).toBe('2026-10-20T19:09:00.000Z')
    expect(nextAutoRunnerRun(new Date('2026-10-20T19:59:30Z')).toISOString()).toBe('2026-10-20T20:01:00.000Z')
    expect(nextAutoRunnerRun(new Date('2026-10-20T23:59:00Z')).toISOString()).toBe('2026-10-21T00:01:00.000Z')
  })

  it('mostra o horário de Brasília', () => {
    expect(queuedLabel(new Date('2026-10-20T19:05:00Z'))).toBe('Na fila · próxima rodada às 16:07 (BRT)')
  })
})
