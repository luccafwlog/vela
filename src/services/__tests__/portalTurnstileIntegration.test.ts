import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(path, 'utf8')
const login = read('supabase/functions/portal-login/index.ts')
const recovery = read('supabase/functions/portal-password-recovery/index.ts')
const activation = read('supabase/functions/portal-invite-activate/index.ts')
const reset = read('supabase/functions/portal-password-reset/index.ts')

function position(source: string, text: string): number {
  const result = source.indexOf(text)
  expect(result, `trecho não encontrado: ${text}`).toBeGreaterThanOrEqual(0)
  return result
}

describe('Turnstile protege as Edge Functions públicas antes do trabalho privilegiado', () => {
  it('login verifica action/hostname antes do cliente Admin, rate limit ou Auth', () => {
    const validation = position(login, "verifyTurnstileRequest(req, body.turnstile_token, 'portal_login')")
    expect(validation).toBeLessThan(position(login, 'const admin = createClient('))
    expect(validation).toBeLessThan(position(login, 'beginPortalRateLimitAttempt('))
    expect(validation).toBeLessThan(position(login, 'authenticatePortalLoginIdentity('))
  })

  it('recuperação valida o token antes de criar identidade administrativa ou procurar conta', () => {
    const validation = position(recovery, "verifyTurnstileRequest(req, body.turnstile_token, 'portal_recovery')")
    expect(validation).toBeLessThan(position(recovery, 'const admin = createClient('))
    expect(validation).toBeLessThan(position(recovery, 'processRecoveryInBackground('))
  })

  it('inspeção e ativação usam o mesmo token de uso único antes de consultar convite', () => {
    const validation = position(activation, "verifyTurnstileRequest(req, body.turnstile_token, 'portal_activation')")
    expect(validation).toBeLessThan(position(activation, 'const tokenHash = await hashToken('))
    expect(validation).toBeLessThan(position(activation, 'admin.auth.admin.createUser('))
  })

  it('redefinição valida o token antes de consultar/consumir link e alterar senha', () => {
    const validation = position(reset, "verifyTurnstileRequest(req, body.turnstile_token, 'portal_password_reset')")
    expect(validation).toBeLessThan(position(reset, 'const admin = createClient('))
    expect(validation).toBeLessThan(position(reset, 'resetPortalPasswordFailClosed('))
  })
})
