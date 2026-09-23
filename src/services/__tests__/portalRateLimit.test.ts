import { describe, expect, it } from 'vitest'
import {
  buildRateLimitKey,
  createUpstashRateLimiter,
  readUpstashRateLimitConfig,
} from '../../../supabase/functions/_shared/rateLimit.ts'

const identity = { action: 'login' as const, ip: '203.0.113.10', cnpj: '12345678000195' }

describe('adaptador distribuído de rate limit do Portal', () => {
  it('não coloca IP nem CNPJ na chave persistida', async () => {
    const key = await buildRateLimitKey('segredo-de-teste', identity)
    expect(key).not.toContain(identity.ip)
    expect(key).not.toContain(identity.cnpj)
    expect(key).toMatch(/^vela:portal-rate:v2:login:[0-9a-f]{64}:[0-9a-f]{64}$/)
  })

  it('lê os padrões aprovados e exige os três segredos server-side', () => {
    expect(readUpstashRateLimitConfig(() => undefined)).toBeNull()
    const values: Record<string, string> = {
      UPSTASH_REDIS_REST_URL: 'https://example.upstash.io/',
      UPSTASH_REDIS_REST_TOKEN: 'token-for-test',
      PORTAL_RATE_LIMIT_HMAC_SECRET: 'hmac-for-test',
    }
    expect(readUpstashRateLimitConfig((name) => values[name])).toMatchObject({ threshold: 10, windowSeconds: 300, timeoutMs: 750 })
  })

  it('reserva atomicamente a décima tentativa e bloqueia a seguinte com TTL', async () => {
    let pending = 0
    let failures = 0
    const limiter = createUpstashRateLimiter({ url: 'https://example.upstash.io', token: 'token', hmacSecret: 'hmac', threshold: 10 }, {
      fetcher: async (_url, init) => {
        const [, script] = (JSON.parse(String(init?.body)) as string[][])[0]
        if (script.includes('-- reserve-v2')) {
          if (pending + failures >= 10) return new Response(JSON.stringify([{ result: [0, 300] }]))
          pending += 1
          return new Response(JSON.stringify([{ result: [1, 300] }]))
        }
        const args = (JSON.parse(String(init?.body)) as string[][])[0].slice(4)
        if (script.includes('-- commit-v2')) { pending -= 1; failures += 1 }
        else pending -= 1
        return new Response(JSON.stringify([{ result: [failures, Number(args[0]) || 300] }]))
      },
      log: () => undefined,
    })

    const attempts = await Promise.all(Array.from({ length: 10 }, () => limiter.reserve(identity)))
    expect(attempts.every((attempt) => attempt.state === 'reserved')).toBe(true)
    for (const attempt of attempts) if (attempt.state === 'reserved') await limiter.commitFailure(identity, attempt.reservationId)
    expect(await limiter.reserve(identity)).toEqual({ state: 'blocked', retryAfterSeconds: 300 })
  })

  it('degrada após falhas do provedor e abre o circuito local', async () => {
    let fetchCalls = 0
    const limiter = createUpstashRateLimiter({ url: 'https://example.upstash.io', token: 'token', hmacSecret: 'hmac' }, {
      fetcher: async () => { fetchCalls += 1; throw new Error('provider down') },
      log: () => undefined,
    })
    expect((await limiter.reserve(identity)).state).toBe('unavailable')
    expect((await limiter.reserve(identity)).state).toBe('unavailable')
    expect((await limiter.reserve(identity)).state).toBe('unavailable')
    expect((await limiter.reserve(identity)).state).toBe('unavailable')
    expect(fetchCalls).toBe(3)
  })
})
