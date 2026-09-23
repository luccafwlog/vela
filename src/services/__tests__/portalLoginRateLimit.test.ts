import { describe, expect, it, vi } from 'vitest'
import { beginPortalRateLimitAttempt, completePortalRateLimitAttempt, requestIp } from '../../../supabase/functions/_shared/portalLoginRateLimit.ts'
import type { DistributedRateLimiter } from '../../../supabase/functions/_shared/rateLimit.ts'
import { createFakePortalDb } from './fakePortalDb'

describe('trava de tentativas do login do Portal', () => {
  it('deixa o Redis saudável decidir o par mesmo se o contador persistido CNPJ retornar true', async () => {
    const { db, rpcCalls } = createFakePortalDb({ rpc: () => ({ data: true }) })
    const redis = createFakeLimiter({ state: 'reserved', reservationId: 'r-1' })
    const attempt = await beginPortalRateLimitAttempt(db, 'login', '12ABC34501DE35', { ip: '203.0.113.10' }, redis)
    expect(attempt.blocked).toBe(false)
    expect(attempt.reservationId).toBe('r-1')
    expect(rpcCalls).toEqual([])
  })

  it('bloqueia pelo Redis saudável sem consultar o contador persistido', async () => {
    const { db, rpcCalls } = createFakePortalDb({ rpc: () => ({ data: false }) })
    const attempt = await beginPortalRateLimitAttempt(db, 'login', '12345678000195', { ip: '203.0.113.10' }, createFakeLimiter({ state: 'blocked', retryAfterSeconds: 300 }))
    expect(attempt.blocked).toBe(true)
    expect(rpcCalls).toEqual([])
  })

  it('usa o contador persistido somente se Redis estiver indisponível', async () => {
    const { db, rpcCalls } = createFakePortalDb({ rpc: () => ({ data: true }) })
    const attempt = await beginPortalRateLimitAttempt(db, 'login', '12345678000195', { ip: '203.0.113.10' }, createFakeLimiter({ state: 'unavailable' }))
    expect(attempt.blocked).toBe(true)
    expect(rpcCalls.map(({ name }) => name)).toEqual(['portal_login_check_rate_limit'])
  })

  it('falha fechado se Redis e o contador persistido estiverem indisponíveis', async () => {
    const { db } = createFakePortalDb({ rpc: () => ({ error: new Error('indisponível') }) })
    const attempt = await beginPortalRateLimitAttempt(db, 'login', '12345678000195', undefined, createFakeLimiter({ state: 'unavailable' }))
    expect(attempt.blocked).toBe(true)
  })

  it('remove do orçamento a reserva de uma tentativa de senha válida', async () => {
    const redis = createFakeLimiter({ state: 'reserved', reservationId: 'r-success' })
    const { db, rpcCalls } = createFakePortalDb()
    const attempt = await beginPortalRateLimitAttempt(db, 'login', '12345678000195', { ip: '203.0.113.10' }, redis)
    await completePortalRateLimitAttempt(db, 'login', '12345678000195', attempt, 'success')
    expect(redis.rollback).toHaveBeenCalledWith({ action: 'login', ip: '203.0.113.10', cnpj: '12345678000195' }, 'r-success')
    expect(redis.commitFailure).not.toHaveBeenCalled()
    expect(rpcCalls.map(({ name }) => name)).toEqual(['portal_login_register_success'])
  })

  it('usa somente o IP definido pelo gateway Cloudflare e não cabeçalhos encaminhados pelo cliente', () => {
    expect(requestIp(new Request('https://example.test', {
      headers: {
        'CF-Connecting-IP': '203.0.113.10',
        'X-Forwarded-For': '198.51.100.10',
        'X-Real-IP': '192.0.2.10',
      },
    }))).toBe('203.0.113.10')

    expect(requestIp(new Request('https://example.test', {
      headers: {
        'X-Forwarded-For': '198.51.100.10',
        'X-Real-IP': '192.0.2.10',
      },
    }))).toBe('unknown')
  })

})

function createFakeLimiter(reservation: { state: 'reserved'; reservationId: string } | { state: 'blocked'; retryAfterSeconds: number } | { state: 'unavailable' }): DistributedRateLimiter & { rollback: ReturnType<typeof vi.fn>; commitFailure: ReturnType<typeof vi.fn> } {
  return {
    reserve: vi.fn(async () => reservation),
    commitFailure: vi.fn(async () => {}),
    rollback: vi.fn(async () => {}),
  }
}
