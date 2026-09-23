import { describe, expect, it } from 'vitest'
import { createUpstashRateLimiter } from '../../../supabase/functions/_shared/rateLimit.ts'

describe('reservas atomicas do rate limit distribuido', () => {
  it('serializa concorrencia no limite e rollback de sucesso nao consome falha', async () => {
    const state = { failures: 0, pending: new Set<string>() }
    const limiter = createUpstashRateLimiter({ url: 'https://redis.test', token: 'test', hmacSecret: 'h'.repeat(32), threshold: 10, windowSeconds: 300 }, {
      log: () => {},
      fetcher: async (_input, init) => {
        const command = (JSON.parse(String(init?.body)) as string[][])[0]
        const script = command[1]
        const args = command.slice(4)
        const operation = script.includes('-- reserve-v2') ? 'reserve' : script.includes('-- commit-v2') ? 'commit' : 'rollback'
        const token = args.at(-1)!
        let result: number[]
        if (operation === 'reserve') {
          if (state.failures + state.pending.size >= 10) result = [0, 300]
          else { state.pending.add(token); result = [1, 300] }
        } else if (operation === 'commit') {
          if (state.pending.delete(token)) state.failures += 1
          result = [state.failures, 300]
        } else {
          state.pending.delete(token)
          result = [state.failures, 300]
        }
        return new Response(JSON.stringify([{ result }]), { status: 200 })
      },
    })
    const identity = { action: 'login' as const, ip: '203.0.113.10', cnpj: '12345678000195' }

    const concurrent = await Promise.all(Array.from({ length: 25 }, () => limiter.reserve(identity)))
    const reservations = concurrent.filter((result) => result.state === 'reserved')
    expect(reservations).toHaveLength(10)
    expect(concurrent.filter((result) => result.state === 'blocked')).toHaveLength(15)

    await Promise.all(reservations.slice(0, 4).map((result) => result.state === 'reserved' && limiter.commitFailure(identity, result.reservationId)))
    await Promise.all(reservations.slice(4).map((result) => result.state === 'reserved' && limiter.rollback(identity, result.reservationId)))
    expect(state.failures).toBe(4)
    expect(state.pending.size).toBe(0)

    const remainingCapacity = await Promise.all(Array.from({ length: 7 }, () => limiter.reserve(identity)))
    expect(remainingCapacity.filter((result) => result.state === 'reserved')).toHaveLength(6)
    expect(remainingCapacity.filter((result) => result.state === 'blocked')).toHaveLength(1)
  })
})
