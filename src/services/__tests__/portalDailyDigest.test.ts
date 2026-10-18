import { describe, expect, it, vi } from 'vitest'
import { runPortalDailyDigest, type DailyDigestDeps } from '../../../supabase/functions/_shared/portalDailyDigest.ts'

const ok = (count: number) => Promise.resolve({ data: Array.from({ length: count }, (_, id) => ({ id })), error: null })

function deps(patch: Partial<DailyDigestDeps> = {}, queries: Partial<DailyDigestDeps['queries']> = {}) {
  const send = vi.fn(async ({ to }: { to: string }) => (to.startsWith('falha') ? { ok: false, suppressed: false } : to.startsWith('sup') ? { ok: false, suppressed: true } : { ok: true, suppressed: false }))
  const full: DailyDigestDeps = {
    queries: {
      failures: ok(1), activity: ok(2), pending: ok(0), criticalOpened: ok(0), criticalClosed: ok(0),
      users: Promise.resolve({ data: [{ id: 'u1' }, { id: 'u2' }, { id: 'u3' }], error: null }),
      ...queries,
    },
    userEmail: async (id) => ({ u1: 'Ana@Fwlog.com.br', u2: 'falha@fwlog.com.br', u3: 'sup@fwlog.com.br' } as Record<string, string>)[id] ?? null,
    recipientKey: async (email) => `sha256:${email.toLowerCase().length}`,
    send,
    today: () => '2026-10-18',
    ...patch,
  }
  return { full, send }
}

describe('Resumo diário do Portal', () => {
  it('devolve enviados, falhas e suprimidos reais, não o número de usuários', async () => {
    const { full } = deps()
    expect(await runPortalDailyDigest(full)).toEqual({ status: 200, body: { sent: 1, failed: 1, suppressed: 1 } })
  })

  it('usa o hash do destinatário na chave idempotente, nunca o e-mail', async () => {
    const { full, send } = deps()
    await runPortalDailyDigest(full)
    const keys = send.mock.calls.map(([input]) => (input as unknown as { idempotencyKey: string }).idempotencyKey)
    expect(keys[0]).toBe('resumo:2026-10-18:sha256:16')
    expect(keys.join(' ')).not.toContain('@')
  })

  it('consulta com erro devolve 500 e não envia resumo zerado', async () => {
    const { full, send } = deps({}, { activity: Promise.resolve({ data: null, error: { message: 'timeout' } }) })
    const result = await runPortalDailyDigest(full)
    expect(result.status).toBe(500)
    expect(result.body).toMatchObject({ queries: ['activity'] })
    expect(send).not.toHaveBeenCalled()
  })

  it('erro ao ler o e-mail de um usuário conta como falha e segue para os demais', async () => {
    const { full } = deps({ userEmail: async (id) => { if (id === 'u1') throw new Error('auth'); return 'ok@fwlog.com.br' } })
    expect((await runPortalDailyDigest(full)).body).toEqual({ sent: 2, failed: 1, suppressed: 0 })
  })

  it('sem ocorrência não envia', async () => {
    const { full, send } = deps({}, { failures: ok(0), activity: ok(0) })
    expect((await runPortalDailyDigest(full)).body).toEqual({ sent: 0, failed: 0, suppressed: 0 })
    expect(send).not.toHaveBeenCalled()
  })
})
