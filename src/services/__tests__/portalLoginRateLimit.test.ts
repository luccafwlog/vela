import { describe, expect, it, vi } from 'vitest'
import { confirmLoginFailure, confirmLoginSuccess, reserveLoginAttempt, voidLoginAttempt } from '../../../supabase/functions/_shared/portalLoginRateLimit.ts'
import { createFakePortalDb } from './fakePortalDb'

describe('trava de tentativas do login do Portal (reserva atômica, migration 413)', () => {
  it('reserva a tentativa e devolve o id', async () => {
    const { db, rpcCalls } = createFakePortalDb({ rpc: () => ({ data: 42 }) })
    expect(await reserveLoginAttempt(db, '12ABC34501DE35')).toBe(42)
    expect(rpcCalls).toEqual([{ name: 'portal_login_reserve_attempt', params: { p_login: '12ABC34501DE35' } }])
  })

  it('CNPJ no limite: a RPC devolve null e não há reserva', async () => {
    const { db } = createFakePortalDb({ rpc: () => ({ data: null }) })
    expect(await reserveLoginAttempt(db, '12345678000195')).toBeNull()
  })

  // Sem resposta do contador não há como saber se o orçamento acabou; liberar
  // nesse caso transformaria indisponibilidade do banco em janela sem trava.
  it('trata falha da RPC como bloqueio', async () => {
    const { db } = createFakePortalDb({ rpc: () => ({ error: new Error('indisponível') }) })
    expect(await reserveLoginAttempt(db, '12345678000195')).toBeNull()
  })

  it('fecha a reserva como sucesso ou a apaga, no balde do login', async () => {
    const { db, rpcCalls } = createFakePortalDb()
    await confirmLoginSuccess(db, 7, '12345678000195')
    await voidLoginAttempt(db, 8)
    await confirmLoginFailure('12345678000195')
    expect(rpcCalls).toEqual([
      { name: 'portal_login_settle_attempt', params: { p_attempt_id: 7, p_outcome: 'success' } },
      { name: 'portal_login_settle_attempt', params: { p_attempt_id: 8, p_outcome: 'void' } },
    ])
  })

  // O supabase-js devolve { error } sem lançar: o acerto não gravado deixaria a
  // senha certa contando como erro no balde.
  it('confere o erro ao gravar o acerto e tenta de novo uma vez', async () => {
    let calls = 0
    const { db, rpcCalls } = createFakePortalDb({ rpc: () => (calls++ === 0 ? { error: new Error('instável') } : { data: null }) })
    await confirmLoginSuccess(db, 7, '12345678000195')
    expect(rpcCalls.map((call) => call.params)).toEqual([
      { p_attempt_id: 7, p_outcome: 'success' }, { p_attempt_id: 7, p_outcome: 'success' },
    ])
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const failing = createFakePortalDb({ rpc: () => ({ error: new Error('fora') }) })
    await confirmLoginSuccess(failing.db, 9, '12345678000195')
    expect(failing.rpcCalls).toHaveLength(2)
    expect(log).toHaveBeenCalled()
    log.mockRestore()
  })
})
