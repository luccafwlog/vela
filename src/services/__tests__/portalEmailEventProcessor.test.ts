import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'

// Import dinâmico por caminho não literal, como em portalEmailSend.test.ts: o
// processador importa o cliente Supabase do esm.sh e usa Deno pelo portalEmail.ts,
// então fica fora do typecheck do app; o Vitest carrega o módulo em execução.
type ProcessPortalEmailEvent = (admin: unknown, eventId: number, workerId: string) => Promise<{ status: string }>
const processorPath = '../../../supabase/functions/_shared/portalEmailEventProcessor.ts'
const { processPortalEmailEvent } = await import(/* @vite-ignore */ processorPath) as { processPortalEmailEvent: ProcessPortalEmailEvent }

// Cascata do bounce com o cliente Supabase simulado: cada consulta é uma
// cadeia registrada e respondida pela tabela (auditoria run-3).
type Op = { op: string; args: unknown[] }
type Call = { table: string; ops: Op[] }

function fakeAdmin(options: { deactivatedAt: string | null }) {
  const calls: Call[] = []
  const rows = (call: Call): unknown => {
    switch (call.table) {
      case 'app_settings': return { communications_enabled: true }
      case 'customers': return { deactivated_at: options.deactivatedAt, cnpj_cpf: '12345678000190' }
      case 'customer_contacts': return [
        { id: 7, email: 'Devolvido@Cliente.test', is_primary: true, deactivated_at: null },
        { id: 8, email: 'alternativo@cliente.test', is_primary: false, deactivated_at: null },
      ]
      case 'portal_suppressed_emails': return call.ops.some((entry) => entry.op === 'in')
        ? [{ email: 'devolvido@cliente.test', reason: 'bounce_permanente' }]
        : null
      case 'portal_email_attempts': return { id: 55 }
      default: return null
    }
  }
  const admin = {
    rpc: vi.fn(async (fn: string) => fn === 'process_portal_email_event'
      ? { data: { status: 'processing', processed: true, should_cascade: true, email: 'devolvido@cliente.test', customer_ids: [3] }, error: null }
      : { data: { status: 'processed' }, error: null }),
    from(table: string) {
      const call: Call = { table, ops: [] }
      calls.push(call)
      const settle = () => Promise.resolve({ data: rows(call), error: null })
      const chain: Record<string, unknown> = new Proxy({}, {
        get(_target, prop: string) {
          if (prop === 'then') return (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => settle().then(resolve, reject)
          if (prop === 'maybeSingle' || prop === 'single') return settle
          return (...args: unknown[]) => { call.ops.push({ op: prop, args }); return chain }
        },
      })
      return chain
    },
  }
  return { admin, calls }
}

const attemptInserts = (calls: Call[]) => calls
  .filter((call) => call.table === 'portal_email_attempts')
  .flatMap((call) => call.ops.filter((entry) => entry.op === 'insert').map((entry) => entry.args[0] as Record<string, unknown>))

describe('aviso de bounce ao Cliente (auditoria run-3)', () => {
  afterEach(() => vi.restoreAllMocks())

  it('a chave de idempotência leva o hash do endereço devolvido, nunca o endereço', async () => {
    const { admin, calls } = fakeAdmin({ deactivatedAt: null })
    await processPortalEmailEvent(admin, 1, 'worker-1')
    const [attempt] = attemptInserts(calls)
    const hash = createHash('sha256').update('devolvido@cliente.test').digest('hex')
    expect(attempt).toMatchObject({ kind: 'contato_bounced_notificacao', idempotency_key: `contato_bounced_notificacao:3:sha256:${hash}:8` })
    expect(JSON.stringify(attemptInserts(calls))).not.toContain('devolvido@')
  })

  it('Cliente desativado não recebe o aviso e o evento conclui', async () => {
    const { admin, calls } = fakeAdmin({ deactivatedAt: '2026-10-01T00:00:00Z' })
    const result = await processPortalEmailEvent(admin, 1, 'worker-1')
    expect(attemptInserts(calls)).toEqual([])
    expect(result.status).toBe('processed')
  })
})
