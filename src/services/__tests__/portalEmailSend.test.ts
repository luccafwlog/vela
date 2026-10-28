import { describe, expect, it, vi } from 'vitest'

// Import dinâmico por caminho não literal: portalEmail.ts importa o cliente Supabase do esm.sh
// e usa Deno, então fica fora do typecheck do app; o Vitest carrega o módulo em tempo de execução.
type SendPortalEmail = (input: Record<string, unknown>) => Promise<{ ok: boolean; suppressed: boolean }>
const portalEmailPath = '../../../supabase/functions/_shared/portalEmail.ts'
const { sendPortalEmail } = await import(/* @vite-ignore */ portalEmailPath) as { sendPortalEmail: SendPortalEmail }

// Cliente Supabase falso: só as chamadas que sendPortalEmail faz.
function fakeAdmin(suppressed: boolean, communicationsEnabled = true) {
  const inserts: Array<Record<string, unknown>> = []
  const updates: Array<Record<string, unknown>> = []
  const from = vi.fn((table: string) => {
    if (table === 'app_settings') {
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { communications_enabled: communicationsEnabled }, error: null }) }) }) }
    }
    if (table === 'portal_suppressed_emails') {
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: suppressed ? { id: 1 } : null, error: null }) }) }) }
    }
    return {
      insert: (row: Record<string, unknown>) => {
        inserts.push(row)
        return { select: () => ({ single: async () => ({ data: { id: 99 }, error: null }) }) }
      },
      update: (row: Record<string, unknown>) => {
        updates.push(row)
        return { eq: async () => ({ error: null }) }
      },
    }
  })
  return { admin: { from } as never, inserts, updates }
}

const base = { kind: 'ce_unlock_notificacao' as const, to: 'a@c.com', subject: 's', html: '<p>h</p>', text: 't', idempotencyKey: 'ce-unlock:1:k' }

describe('sendPortalEmail', () => {
  it('distingue endereço suprimido de falha de envio, sem registrar tentativa', async () => {
    const { admin, inserts } = fakeAdmin(true)
    expect(await sendPortalEmail({ ...base, admin })).toEqual({ ok: false, suppressed: true })
    expect(inserts).toHaveLength(0)
  })

  it('em modo simulado registra a tentativa sem chamar o provedor', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const { admin, inserts, updates } = fakeAdmin(false)
    expect(await sendPortalEmail({ ...base, admin, simulate: true })).toEqual({ ok: true, suppressed: false })
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(inserts[0]).toMatchObject({ kind: 'ce_unlock_notificacao', idempotency_key: 'ce-unlock:1:k', recipient_masked: 'a***@c***.com' })
    expect(updates[0]).toMatchObject({ status: 'aceito', provider_message_id: null })
    fetchSpy.mockRestore()
  })

  it('e-mail de Cliente lê a chave: desligada, vai pelo caminho do suporte', async () => {
    const { admin, inserts, updates } = fakeAdmin(false, false)
    expect(await sendPortalEmail({ ...base, kind: 'convite', admin })).toEqual({ ok: true, suppressed: false })
    expect((admin as unknown as { from: ReturnType<typeof vi.fn> }).from).toHaveBeenCalledWith('app_settings')
    expect(inserts[0]).toMatchObject({ kind: 'convite' })
    // Sem credencial do provedor no teste, a chave desligada só registra.
    expect(updates[0]).toMatchObject({ status: 'aceito', provider_message_id: null })
  })

  it('e-mail da equipe não lê a chave', async () => {
    const { admin } = fakeAdmin(false, false)
    await sendPortalEmail({ ...base, kind: 'resumo_diario', admin })
    expect((admin as unknown as { from: ReturnType<typeof vi.fn> }).from).not.toHaveBeenCalledWith('app_settings')
  })
})
