import { afterEach, describe, expect, it, vi } from 'vitest'
import { isLoginRateLimited, isRateLimitBlocked } from '../../../supabase/functions/_shared/portalLoginRateLimit.ts'
import type { PortalDb } from '../../../supabase/functions/_shared/portalDb.ts'

const env: Record<string, string> = {
  UPSTASH_REDIS_REST_URL: 'https://example.upstash.io',
  UPSTASH_REDIS_REST_TOKEN: 'token',
  PORTAL_RATE_LIMIT_HMAC_SECRET: 'hmac',
}

function dbReturning(blocked: boolean, error: unknown = null): PortalDb {
  return { rpc: async () => ({ data: blocked, error }) } as unknown as PortalDb
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
    expect(await isLoginRateLimited(dbReturning(true), '12345678000195', { ip: '198.51.100.7' })).toBe(true)
    expect(await isLoginRateLimited(dbReturning(false, { message: 'rpc down' }), '12345678000195', { ip: '198.51.100.7' })).toBe(true)
    expect(await isLoginRateLimited(dbReturning(false), '12345678000195', { ip: '198.51.100.7' })).toBe(false)
  })
})
