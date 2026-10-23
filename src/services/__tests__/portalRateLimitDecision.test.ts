import { afterEach, describe, expect, it, vi } from 'vitest'
import { isRateLimitBlocked, reserveLoginAttempt } from '../../../supabase/functions/_shared/portalLoginRateLimit.ts'
import type { PortalDb } from '../../../supabase/functions/_shared/portalDb.ts'

const env: Record<string, string> = {
  UPSTASH_REDIS_REST_URL: 'https://example.upstash.io',
  UPSTASH_REDIS_REST_TOKEN: 'token',
  PORTAL_RATE_LIMIT_HMAC_SECRET: 'hmac',
}

// A reserva devolve o id (CNPJ abaixo do limite) ou null (no limite).
function dbReturning(blocked: boolean, error: unknown = null): PortalDb {
  return { rpc: async () => ({ data: blocked ? null : 1, error }) } as unknown as PortalDb
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('decisão combinada do rate limit do Portal (ADR 0049)', () => {
  it('o Redis só acrescenta bloqueio', () => {
    expect(isRateLimitBlocked(true, { state: 'allowed' })).toBe(true)
    expect(isRateLimitBlocked(false, { state: 'blocked', retryAfterSeconds: 10 })).toBe(true)
    expect(isRateLimitBlocked(false, { state: 'allowed' })).toBe(false)
    expect(isRateLimitBlocked(false, null)).toBe(false)
  })

  it('CNPJ travado no Supabase continua travado mesmo com o Redis liberando o IP', async () => {
    vi.stubGlobal('Deno', { env: { get: (name: string) => env[name] } })
    // Redis sem contador para este IP+CNPJ: "allowed".
    const fetcher = vi.fn(async () => new Response(JSON.stringify([{ result: [0, 0] }])))
    vi.stubGlobal('fetch', fetcher)
    expect(await reserveLoginAttempt(dbReturning(true), '12345678000195', { ip: '198.51.100.7' })).toBeNull()
    expect(await reserveLoginAttempt(dbReturning(false, { message: 'rpc down' }), '12345678000195', { ip: '198.51.100.7' })).toBeNull()
    expect(await reserveLoginAttempt(dbReturning(false), '12345678000195', { ip: '198.51.100.7' })).toBe(1)
  })

  it('bloqueio do Redis cancela a reserva conferindo o erro e tentando de novo', async () => {
    // Token próprio: o limitador fica em cache por configuração e guardaria o
    // fetch do teste anterior.
    const blockedEnv: Record<string, string> = { ...env, UPSTASH_REDIS_REST_TOKEN: 'token-bloqueio' }
    vi.stubGlobal('Deno', { env: { get: (name: string) => blockedEnv[name] } })
    // IP+CNPJ no teto do Redis (10 em 5 min): "blocked".
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([{ result: [10, 120] }]))))
    const calls: Array<{ name: string; params: unknown }> = []
    let settles = 0
    const db = {
      rpc: async (name: string, params: unknown) => {
        calls.push({ name, params })
        if (name === 'portal_login_reserve_attempt') return { data: 5, error: null }
        return settles++ === 0 ? { data: null, error: { message: 'instável' } } : { data: null, error: null }
      },
    } as unknown as PortalDb
    expect(await reserveLoginAttempt(db, '12345678000195', { ip: '198.51.100.7' })).toBeNull()
    expect(calls.slice(1)).toEqual([
      { name: 'portal_login_settle_attempt', params: { p_attempt_id: 5, p_outcome: 'void' } },
      { name: 'portal_login_settle_attempt', params: { p_attempt_id: 5, p_outcome: 'void' } },
    ])
  })
})
