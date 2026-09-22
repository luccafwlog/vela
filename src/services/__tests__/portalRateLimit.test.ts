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
    expect(key).toMatch(/^vela:portal-rate:login:[0-9a-f]{64}:[0-9a-f]{64}$/)
  })

  it('lê os padrões aprovados e exige os três segredos server-side', () => {
    expect(readUpstashRateLimitConfig(() => undefined)).toBeNull()
    const values: Record<string, string> = {
      UPSTASH_REDIS_REST_URL: 'https://example.upstash.io/',
      UPSTASH_REDIS_REST_TOKEN: 'token-for-test',
      PORTAL_RATE_LIMIT_HMAC_SECRET: 'hmac-for-test',
    }
    expect(readUpstashRateLimitConfig((name) => values[name])).toMatchObject({
      threshold: 10,
      windowSeconds: 300,
      timeoutMs: 750,
    })
  })

  it('bloqueia a décima primeira tentativa e informa o TTL', async () => {
    let count = 0
    const limiter = createUpstashRateLimiter(
      { url: 'https://example.upstash.io', token: 'token', hmacSecret: 'hmac' },
      {
        fetcher: async (_url, init) => {
          const command = (JSON.parse(String(init?.body)) as string[][])[0]
          const script = command[1]
          if (script.includes('INCR')) {
            count += 1
            return new Response(JSON.stringify([{ result: [count, 300] }]))
          }
          if (script.includes("GET")) return new Response(JSON.stringify([{ result: [count, 300] }]))
          return new Response(JSON.stringify([{ result: 1 }]))
        },
        log: () => undefined,
      },
    )

    await Promise.all(Array.from({ length: 10 }, () => limiter.registerFailure(identity)))
    expect(await limiter.check(identity)).toEqual({ state: 'blocked', retryAfterSeconds: 300 })
  })

  it('degrada sem liberar uma segunda barreira como se o provedor estivesse saudável', async () => {
    let fetchCalls = 0
    const limiter = createUpstashRateLimiter(
      { url: 'https://example.upstash.io', token: 'token', hmacSecret: 'hmac' },
      {
        fetcher: async () => {
          fetchCalls += 1
          throw new Error('provider down')
        },
        log: () => undefined,
      },
    )

    expect((await limiter.check(identity)).state).toBe('unavailable')
    expect((await limiter.check(identity)).state).toBe('unavailable')
    expect((await limiter.check(identity)).state).toBe('unavailable')
    expect((await limiter.check(identity)).state).toBe('unavailable')
    expect(fetchCalls).toBe(3)
  })
})
