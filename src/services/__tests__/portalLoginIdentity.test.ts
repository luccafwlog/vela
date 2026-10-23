import { describe, expect, it } from 'vitest'
import { authenticatePortalLoginIdentity } from '../../../supabase/functions/_shared/portalLoginIdentity'
import { derivePortalAuthPassword } from '../../../supabase/functions/_shared/portalPasswordSecret'

type Session = { access_token: string }

// `stored` é o que o GoTrue guarda para o usuário real: a senha derivada ou,
// numa conta legada que não passou pela recuperação, a senha pura.
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

  it('conta legada não entra mais com a senha pura (auditoria run-3)', async () => {
    const events: string[] = []
    const result = await authenticatePortalLoginIdentity<Session>(real, 'dummy-user', 'Senha1', dependencies(events, 'Senha1'))

    expect(events).toEqual(['lookup:real-user', 'signin:real@technical.invalid:H(Senha1)'])
    expect(result).toEqual({ accepted: false, session: null })
  })

  it('senha errada e CNPJ inexistente fazem a mesma tentativa única', async () => {
    const wrong: string[] = []
    await authenticatePortalLoginIdentity<Session>(real, 'dummy-user', 'Errada1', dependencies(wrong, 'H(Senha1)'))
    const missing: string[] = []
    const result = await authenticatePortalLoginIdentity<Session>(null, 'dummy-user', 'Senha1', dependencies(missing, 'H(Senha1)'))

    expect(wrong.filter((event) => event.startsWith('signin:'))).toEqual(['signin:real@technical.invalid:H(Errada1)'])
    expect(missing).toEqual(['lookup:dummy-user', 'signin:dummy@technical.invalid:H(Senha1)'])
    expect(result).toEqual({ accepted: false, session: null })
  })

  it('a troca do Email de Recuperação também só confere a senha derivada', async () => {
    const { readFileSync } = await import('node:fs')
    const recovery = readFileSync('supabase/functions/portal-recovery-email-change/index.ts', 'utf8')
    expect(recovery.match(/signInWithPassword\(/g)).toHaveLength(1)
    expect(recovery).toContain('password: await derivePortalAuthPassword(body.current_password')
    expect(readFileSync('supabase/functions/portal-login/index.ts', 'utf8')).not.toContain('migrateLegacyPassword')
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

  it('a falha do Auth atravessa o login sem virar recusa', async () => {
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
    // Falha do Auth apaga a reserva (migration 422), no login e na troca.
    expect(login).toContain('await voidLoginAttempt(admin, attemptId)')
    expect(recovery).toContain('await voidLoginAttempt(admin, attemptId)')
  })
})

describe('captcha do Auth (auditoria run-3, decisão do dono de 2026-10-22)', () => {
  it('a conferência de senha das Edges do Portal vai com a credencial de administrador, que o captcha dispensa', async () => {
    const { readFileSync } = await import('node:fs')
    const helper = readFileSync('supabase/functions/_shared/passwordCheckClient.ts', 'utf8')
    expect(helper).toContain('createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })')
    const login = readFileSync('supabase/functions/portal-login/index.ts', 'utf8')
    const recovery = readFileSync('supabase/functions/portal-recovery-email-change/index.ts', 'utf8')
    expect(login).toContain('const authClient = createPasswordCheckClient(url, serviceKey)')
    expect(recovery).toContain("const verifier = createPasswordCheckClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)")
    for (const source of [login, recovery]) expect(source).not.toMatch(/createClient\(url, (anonKey|Deno\.env\.get\('SUPABASE_ANON_KEY'\)!)\)\s*\n/)
  })
})
