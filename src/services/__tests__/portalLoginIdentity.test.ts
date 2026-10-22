import { describe, expect, it, vi } from 'vitest'
import { authenticatePortalLoginIdentity } from '../../../supabase/functions/_shared/portalLoginIdentity'
import { derivePortalAuthPassword } from '../../../supabase/functions/_shared/portalPasswordSecret'

type Session = { access_token: string }

// `stored` é o que o GoTrue guarda para o usuário real: a senha derivada
// (conta migrada) ou a senha pura (conta legada).
function dependencies(events: string[], stored: string) {
  return {
    lookupEmail: async (userId: string) => {
      events.push(`lookup:${userId}`)
      return userId === 'real-user' ? 'real@technical.invalid' : 'dummy@technical.invalid'
    },
    signIn: async (email: string, password: string): Promise<Session | null> => {
      events.push(`signin:${email}:${password}`)
      return email.startsWith('real@') && password === stored ? { access_token: 'real-session' } : null
    },
    derivePassword: async (password: string) => `H(${password})`,
    migrateLegacyPassword: vi.fn(async (userId: string, derived: string) => {
      events.push(`migrate:${userId}:${derived}`)
    }),
  }
}

const real = { auth_user_id: 'real-user', account_situation: 'ativo', active: true }

describe('authenticatePortalLoginIdentity', () => {
  it('conta migrada entra com a senha derivada numa única tentativa', async () => {
    const events: string[] = []
    const result = await authenticatePortalLoginIdentity<Session>(real, 'dummy-user', 'Senha1', dependencies(events, 'H(Senha1)'))

    expect(events).toEqual(['lookup:real-user', 'signin:real@technical.invalid:H(Senha1)'])
    expect(result).toEqual({ accepted: true, session: { access_token: 'real-session' } })
  })

  it('conta legada entra com a senha pura e migra para a derivada', async () => {
    const events: string[] = []
    const result = await authenticatePortalLoginIdentity<Session>(real, 'dummy-user', 'Senha1', dependencies(events, 'Senha1'))

    expect(events).toEqual([
      'lookup:real-user',
      'signin:real@technical.invalid:H(Senha1)',
      'signin:real@technical.invalid:Senha1',
      'migrate:real-user:H(Senha1)',
    ])
    expect(result.accepted).toBe(true)
  })

  it('senha errada e CNPJ inexistente fazem as mesmas duas tentativas, sem migrar', async () => {
    const wrong: string[] = []
    await authenticatePortalLoginIdentity<Session>(real, 'dummy-user', 'Errada1', dependencies(wrong, 'H(Senha1)'))
    const missing: string[] = []
    const result = await authenticatePortalLoginIdentity<Session>(null, 'dummy-user', 'Senha1', dependencies(missing, 'H(Senha1)'))

    expect(wrong.filter((event) => event.startsWith('signin:'))).toHaveLength(2)
    expect(missing).toEqual([
      'lookup:dummy-user',
      'signin:dummy@technical.invalid:H(Senha1)',
      'signin:dummy@technical.invalid:Senha1',
    ])
    expect(result).toEqual({ accepted: false, session: null })
  })

  it('nunca aceita a sessão dummy mesmo se a senha coincidir', async () => {
    const result = await authenticatePortalLoginIdentity<Session>(
      { auth_user_id: null, account_situation: 'sem_conta', active: false },
      'dummy-user',
      'SenhaDummy1',
      {
        lookupEmail: async () => 'dummy@technical.invalid',
        signIn: async () => ({ access_token: 'dummy-session' }),
        derivePassword: async (password) => password,
        migrateLegacyPassword: async () => { throw new Error('não deve migrar') },
      },
    )

    expect(result).toEqual({ accepted: false, session: null })
  })
})

describe('derivePortalAuthPassword', () => {
  const pepper = 'p'.repeat(32)

  it('é determinística, depende do pepper e cabe no limite do bcrypt', async () => {
    const a = await derivePortalAuthPassword('Senha1', pepper)
    expect(await derivePortalAuthPassword('Senha1', pepper)).toBe(a)
    expect(await derivePortalAuthPassword('Senha1', 'q'.repeat(32))).not.toBe(a)
    expect(a).not.toContain('Senha1')
    expect(a.startsWith('p1.')).toBe(true)
    expect(new TextEncoder().encode(a).length).toBeLessThanOrEqual(72)
  })
})

describe('conta inativa (auditoria run-2, reforço)', () => {
  it('conta ativo mas com active = false não entra, com as mesmas tentativas da conta inexistente', async () => {
    const events: string[] = []
    const result = await authenticatePortalLoginIdentity<Session>(
      { auth_user_id: 'real-user', account_situation: 'ativo', active: false },
      'dummy-user',
      'Senha1',
      dependencies(events, 'H(Senha1)'),
    )
    expect(result).toEqual({ accepted: false, session: null })
    expect(events[0]).toBe('lookup:dummy-user')
  })
})

describe('falha do Auth não é senha errada (auditoria run-3, P2)', () => {
  it('só invalid_credentials é recusa; 429, 5xx e rede viram AuthUpstreamError', async () => {
    const { AuthUpstreamError, isInvalidCredentials, sessionOrRefusal } = await import('../../../supabase/functions/_shared/authRefusal')
    expect(isInvalidCredentials({ status: 400, code: 'invalid_credentials', message: 'Invalid login credentials' })).toBe(true)
    expect(isInvalidCredentials({ status: 400, message: 'Invalid login credentials' })).toBe(true)
    expect(sessionOrRefusal({ session: null }, { status: 400, code: 'invalid_credentials' })).toBeNull()
    expect(sessionOrRefusal({ session: { access_token: 'ok' } }, null)).toEqual({ access_token: 'ok' })
    for (const error of [
      { status: 429, code: 'over_request_rate_limit', message: 'Request rate limit reached' },
      { status: 503, message: 'Service Unavailable' },
      { status: 0, message: 'Failed to fetch' },
    ]) {
      expect(isInvalidCredentials(error)).toBe(false)
      expect(() => sessionOrRefusal({ session: null }, error)).toThrow(AuthUpstreamError)
    }
  })

  it('a falha do Auth atravessa o login sem virar recusa, nas duas tentativas', async () => {
    const { AuthUpstreamError } = await import('../../../supabase/functions/_shared/authRefusal')
    const events: string[] = []
    const deps = { ...dependencies(events, 'H(Senha1)'), signIn: async () => { throw new AuthUpstreamError(429, 'over_request_rate_limit') } }
    await expect(authenticatePortalLoginIdentity<Session>(real, 'dummy-user', 'Senha1', deps)).rejects.toBeInstanceOf(AuthUpstreamError)
  })

  it('portal-login e a troca do Email de Recuperação só cobram o balde por credencial recusada', async () => {
    const { readFileSync } = await import('node:fs')
    const login = readFileSync('supabase/functions/portal-login/index.ts', 'utf8')
    expect(login).toContain('return sessionOrRefusal(data, error)')
    expect(login).toContain('if (err instanceof AuthUpstreamError)')
    const recovery = readFileSync('supabase/functions/portal-recovery-email-change/index.ts', 'utf8')
    expect(recovery.indexOf('!isInvalidCredentials(verified.error)')).toBeLessThan(recovery.indexOf('await confirmLoginFailure('))
    // Falha do Auth apaga a reserva (migration 413), no login e na troca.
    expect(login).toContain('await voidLoginAttempt(admin, attemptId)')
    expect(recovery).toContain('await voidLoginAttempt(admin, attemptId)')
  })
})
