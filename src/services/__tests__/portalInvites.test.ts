import { describe, expect, it } from 'vitest'
import { findReusableRecoveryInvite, resolveEmailChangeConfirmation } from '../../../supabase/functions/_shared/portalInvites.ts'
import { createFakePortalDb, opArgs } from './fakePortalDb'

const NOW = Date.parse('2026-08-14T12:00:00.000Z')
const TOKEN_HASH = 'hash-do-token'

describe('confirmação transacional do Email de Recuperação', () => {
  it('delega a confirmação ao banco, sem segunda escrita fora da transação', async () => {
    const result = { outcome: 'aplicar', inviteId: 9, account: { id: 4 } }
    const { db, calls, rpcCalls } = createFakePortalDb({ rpc: () => ({ data: result }) })
    expect(await resolveEmailChangeConfirmation(db, TOKEN_HASH)).toEqual(result)
    expect(rpcCalls).toEqual([{ name: 'portal_confirm_recovery_email', params: { p_token_hash: TOKEN_HASH } }])
    expect(calls).toEqual([])
  })
  it('pede nova tentativa para reset em andamento e nega fechado em falha do banco', async () => {
    const busy = createFakePortalDb({ rpc: () => ({ error: { code: '55000' } }) })
    expect(await resolveEmailChangeConfirmation(busy.db, TOKEN_HASH)).toEqual({ outcome: 'recuperacao_em_andamento' })
    const failed = createFakePortalDb({ rpc: () => ({ error: { code: 'XX000' } }) })
    await expect(resolveEmailChangeConfirmation(failed.db, TOKEN_HASH)).rejects.toThrow()
    await expect(resolveEmailChangeConfirmation(createFakePortalDb().db, TOKEN_HASH)).rejects.toThrow()
  })
})

describe('convite de recuperação reusável', () => {
  const EMAIL = 'contato@example.com'

  function reusableDb(invite: Record<string, unknown> | null, attempt: Record<string, unknown> | null) {
    return createFakePortalDb({
      resolve: (call) => (call.table === 'portal_invites' ? invite : attempt),
    })
  }

  function liveInvite(overrides: Record<string, unknown> = {}) {
    return { id: 12, expires_at: new Date(NOW + 600_000).toISOString(), sent_to_email: EMAIL, created_at: new Date(NOW - 10 * 60_000).toISOString(), ...overrides }
  }

  it('procura por conta, propósito, status pendente e validade futura', async () => {
    const { db, calls } = reusableDb(liveInvite(), { status: 'aceito' })

    expect(await findReusableRecoveryInvite(db, 4, EMAIL, NOW)).toMatchObject({ id: 12 })

    const filters = calls[0].ops.filter((entry) => entry.op === 'eq').map((entry) => entry.args)
    expect(filters).toEqual([['account_id', 4], ['purpose', 'recuperacao'], ['status', 'pendente']])
    expect(opArgs(calls[0], 'gt')).toEqual(['expires_at', new Date(NOW).toISOString()])
  })

  it('devolve nulo quando não há convite vivo, liberando o envio de um link novo', async () => {
    const { db } = reusableDb(null, null)
    expect(await findReusableRecoveryInvite(db, 4, EMAIL, NOW)).toBeNull()
  })

  // Depois de uma troca de endereço, o convite pendente aponta para a caixa
  // anterior: reusá-lo responderia "enviamos" enquanto nada chega ao endereço
  // que o cliente acabou de passar a usar.
  it('não reusa convite endereçado a outro email, e a comparação ignora caixa', async () => {
    const { db } = reusableDb(liveInvite({ sent_to_email: 'antigo@example.com' }), { status: 'aceito' })
    expect(await findReusableRecoveryInvite(db, 4, EMAIL, NOW)).toBeNull()

    const { db: outroCaso } = reusableDb(liveInvite({ sent_to_email: 'Contato@Example.com' }), { status: 'aceito' })
    expect(await findReusableRecoveryInvite(outroCaso, 4, EMAIL, NOW)).toMatchObject({ id: 12 })
  })

  // A falha do Resend só vira console.error dentro do waitUntil e o convite
  // fica pendente do mesmo jeito; tratar pendente como enviado transformava
  // uma indisponibilidade passageira em uma hora sem recuperação de senha.
  it('não reusa convite cujo envio falhou', async () => {
    for (const status of ['falha_transitoria', 'falha_permanente']) {
      const { db, calls } = reusableDb(liveInvite(), { status })
      expect(await findReusableRecoveryInvite(db, 4, EMAIL, NOW)).toBeNull()
      expect(opArgs(calls[1], 'eq')).toEqual(['idempotency_key', 'recuperacao:12'])
    }
  })

  // O bounce brando (caixa cheia, servidor fora do ar) devolve a mensagem sem
  // suprimir o endereço nem marcar a conta: nenhum outro sinal do sistema
  // registra que o link não chegou. Reusá-lo prenderia o cliente por uma hora
  // atrás de uma tela dizendo que o email saiu.
  it('não reusa convite que o provedor devolveu, mesmo em bounce brando', async () => {
    const { db } = reusableDb(liveInvite(), { status: 'bounce' })
    expect(await findReusableRecoveryInvite(db, 4, EMAIL, NOW)).toBeNull()
  })

  // `complaint` é entrega seguida de "marcar como spam": a mensagem chegou, o
  // link está na caixa do cliente, e um reenvio iria para o mesmo lugar.
  it('reusa convite cujo envio saiu, foi entregue ou virou reclamação', async () => {
    for (const status of ['aceito', 'entregue', 'complaint']) {
      const { db } = reusableDb(liveInvite(), { status })
      expect(await findReusableRecoveryInvite(db, 4, EMAIL, NOW)).toMatchObject({ id: 12 })
    }
  })

  // Sem tentativa registrada há dois casos: o envio está em voo (o helper roda
  // em waitUntil e grava a tentativa no primeiro passo) ou nunca começou.
  it('segura o duplicado do envio em voo e libera o reenvio depois da janela', async () => {
    const emVoo = reusableDb(liveInvite({ created_at: new Date(NOW - 30_000).toISOString() }), null)
    expect(await findReusableRecoveryInvite(emVoo.db, 4, EMAIL, NOW)).toMatchObject({ id: 12 })

    const antigo = reusableDb(liveInvite({ created_at: new Date(NOW - 30 * 60_000).toISOString() }), null)
    expect(await findReusableRecoveryInvite(antigo.db, 4, EMAIL, NOW)).toBeNull()
  })
})
