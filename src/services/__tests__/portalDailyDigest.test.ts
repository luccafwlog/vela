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
    attemptExists: async () => false,
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

  // Rodada anterior ao deploy, no mesmo dia, gravou a chave com o e-mail: a
  // nova rodada reaproveita essa tentativa em vez de reenviar o resumo.
  it('reaproveita a chave antiga com o e-mail quando o resumo do dia já saiu com ela', async () => {
    const existing = new Set(['resumo:2026-10-18:ana@fwlog.com.br'])
    const { full, send } = deps({ attemptExists: async (key) => existing.has(key) })
    await runPortalDailyDigest(full)
    const keys = send.mock.calls.map(([input]) => (input as unknown as { idempotencyKey: string }).idempotencyKey)
    expect(keys).toEqual(['resumo:2026-10-18:ana@fwlog.com.br', 'resumo:2026-10-18:sha256:18', 'resumo:2026-10-18:sha256:16'])
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

  // Conta API ITAÚ (migration 440): o e-mail dela não é caixa real e a recusa
  // do provedor contava falha e deixava o heartbeat vermelho (23/10).
  it('conta de integração não recebe o resumo nem conta como falha', async () => {
    const { full, send } = deps({
      userEmail: async (id) => ({ u1: 'ana@fwlog.com.br', itau: 'falha-api-itau@fwlog.com.br' } as Record<string, string>)[id] ?? null,
    }, {
      users: Promise.resolve({ data: [{ id: 'u1', account_kind: 'pessoa' }, { id: 'itau', account_kind: 'integracao' }], error: null }),
    })
    expect((await runPortalDailyDigest(full)).body).toEqual({ sent: 1, failed: 0, suppressed: 0 })
    expect(send.mock.calls.map(([input]) => (input as unknown as { to: string }).to)).toEqual(['ana@fwlog.com.br'])
  })

  it('422 all_recipients_suppressed do provedor conta como suprimido, não como falha', async () => {
    type SendPortalEmail = (input: Record<string, unknown>) => Promise<{ ok: boolean; suppressed: boolean }>
    const portalEmailPath = '../../../supabase/functions/_shared/portalEmail.ts'
    const { sendPortalEmail } = await import(/* @vite-ignore */ portalEmailPath) as { sendPortalEmail: SendPortalEmail }
    const attemptUpdates: Array<Record<string, unknown>> = []
    const suppressions: Array<{ row: Record<string, unknown>; options: unknown }> = []
    const admin = {
      from: (table: string) => table === 'portal_suppressed_emails'
        ? {
            select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
            upsert: async (row: Record<string, unknown>, options: unknown) => { suppressions.push({ row, options }); return { error: null } },
          }
        : {
            insert: () => ({ select: () => ({ single: async () => ({ data: { id: 31 }, error: null }) }) }),
            update: (row: Record<string, unknown>) => { attemptUpdates.push(row); return { eq: async () => ({ error: null }) } },
          },
    }
    const env: Record<string, string> = { RESEND_API_KEY: 'resend-key', PORTAL_FROM_EMAIL: 'portal@fwlog.com.br', PORTAL_REPLY_TO: 'suporte@fwlog.com.br' }
    vi.stubGlobal('Deno', { env: { get: (name: string) => env[name] } })
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ name: 'all_recipients_suppressed' }), { status: 422 }))
    try {
      const { full } = deps({
        userEmail: async () => ' Sem.Caixa@Fwlog.com.br ',
        send: ({ to, idempotencyKey }) => sendPortalEmail({ admin, kind: 'resumo_diario', to, subject: 's', html: '<p>h</p>', text: 't', idempotencyKey }),
      }, { users: Promise.resolve({ data: [{ id: 'u1', account_kind: 'pessoa' }], error: null }) })

      expect(await runPortalDailyDigest(full)).toEqual({ status: 200, body: { sent: 0, failed: 0, suppressed: 1 } })
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(attemptUpdates).toEqual([expect.objectContaining({ status: 'bounce', last_error: 'HTTP 422 all_recipients_suppressed (endereço suprimido no provedor)' })])
      expect(suppressions).toEqual([{ row: { email: 'sem.caixa@fwlog.com.br', reason: 'bounce_permanente' }, options: { onConflict: 'email', ignoreDuplicates: true } }])
    } finally {
      fetchMock.mockRestore()
      vi.unstubAllGlobals()
    }
  })

  it('sem ocorrência não envia', async () => {
    const { full, send } = deps({}, { failures: ok(0), activity: ok(0) })
    expect((await runPortalDailyDigest(full)).body).toEqual({ sent: 0, failed: 0, suppressed: 0 })
    expect(send).not.toHaveBeenCalled()
  })
})
