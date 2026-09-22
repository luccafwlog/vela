import { describe, expect, it } from 'vitest'
import { isLoginRateLimited, registerLoginFailure, registerLoginSuccess, requestIp, shouldBlockRateLimit } from '../../../supabase/functions/_shared/portalLoginRateLimit.ts'
import type { DistributedRateLimitResult } from '../../../supabase/functions/_shared/rateLimit.ts'
import { createFakePortalDb } from './fakePortalDb'

describe('trava de tentativas do login do Portal', () => {
  it('bloqueia quando a RPC responde true', async () => {
    const { db, rpcCalls } = createFakePortalDb({ rpc: () => ({ data: true }) })
    expect(await isLoginRateLimited(db, '12ABC34501DE35')).toBe(true)
    expect(rpcCalls).toEqual([{ name: 'portal_login_check_rate_limit', params: { p_login: '12ABC34501DE35' } }])
  })

  it('libera quando a RPC responde false', async () => {
    const { db } = createFakePortalDb({ rpc: () => ({ data: false }) })
    expect(await isLoginRateLimited(db, '12345678000195')).toBe(false)
  })

  // Sem resposta do contador não há como saber se o orçamento acabou; liberar
  // nesse caso transformaria indisponibilidade do banco em janela sem trava.
  it('trata falha da RPC como bloqueio', async () => {
    const { db } = createFakePortalDb({ rpc: () => ({ error: new Error('indisponível') }) })
    expect(await isLoginRateLimited(db, '12345678000195')).toBe(true)
  })

  it('mantém o bloqueio persistido mesmo quando o Redis responde allowed', () => {
    expect(shouldBlockRateLimit(true, { state: 'allowed' })).toBe(true)
    expect(shouldBlockRateLimit(false, { state: 'allowed' })).toBe(false)
  })

  it('bloqueia se qualquer uma das duas camadas bloquear', () => {
    const states: DistributedRateLimitResult[] = [
      { state: 'blocked', retryAfterSeconds: 300 },
      { state: 'unavailable' },
      { state: 'allowed' },
    ]
    expect(states.map((state) => shouldBlockRateLimit(false, state))).toEqual([true, false, false])
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

  it('registra falha e sucesso no contador do login, não num terceiro balde', async () => {
    const { db, rpcCalls } = createFakePortalDb()
    await registerLoginFailure(db, '12345678000195')
    await registerLoginSuccess(db, '12345678000195')
    expect(rpcCalls.map((call) => call.name)).toEqual(['portal_login_register_failure', 'portal_login_register_success'])
    expect(rpcCalls.every((call) => call.params?.p_login === '12345678000195')).toBe(true)
  })
})
