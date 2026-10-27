import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(process.cwd())
const read = (file: string) => readFileSync(resolve(root, file), 'utf8')
const webhook = read('supabase/functions/portal-email-webhook/index.ts')
const processor = read('supabase/functions/_shared/portalEmailEventProcessor.ts')
const portalEmail = read('supabase/functions/_shared/portalEmail.ts')

describe('webhook de email para Portal e Comunicados', () => {
  it('persiste o envelope mínimo antes do ACK e não confunde deduplicação com conclusão', () => {
    expect(webhook).toContain("provider_message_id: providerMessageId")
    expect(webhook).toContain('payload: eventPayload')
    expect(webhook).toContain("status: 'pending'")
    expect(webhook).toContain("return json(202")
    expect(webhook).toContain("inbox_persist_failed")
    expect(webhook).toContain("existing.status === 'processed' ? 200 : 202")
    expect(webhook).not.toContain("from('portal_email_attempts')")
    expect(webhook).not.toContain('ignoreDuplicates')
  })

  it('resolve tentativa, estado e supressão em RPC privado antes dos efeitos secundários', () => {
    expect(processor).toContain("admin.rpc('process_portal_email_event'")
    expect(processor).toContain("admin.rpc('complete_portal_email_event'")
    expect(processor).toContain('resolveBounceCascade')
    expect(processor).toContain('sendPortalEmail')
    expect(processor).toContain('should_cascade')
  })

  it('separa complaint por canal e preserva bounce permanente sem regressão', () => {
    expect(read('supabase/migrations/022_email_inbox_and_dispatch_state.sql')).toContain("ON CONFLICT (email) DO NOTHING")
    expect(read('supabase/migrations/022_email_inbox_and_dispatch_state.sql')).toContain("reason = 'bounce_permanente'")
    expect(read('supabase/migrations/022_email_inbox_and_dispatch_state.sql')).toContain("older.received_at > v_event.received_at")
    expect(read('supabase/migrations/022_email_inbox_and_dispatch_state.sql')).toContain("'stale_transition_ignored'")
  })

  it('S06/D04 — aviso de bounce respeita a chave global pelo envio do Portal; reparo/alerta interno seguem no banco', () => {
    // Desligada, o aviso vai ao suporte (ADR 0104): a chave é lida em sendPortalEmail.
    expect(processor).not.toContain('isCommunicationsEnabled')
    expect(processor).toMatch(/if\s*\(!recipient\.email\)\s*return true/)
    expect(portalEmail).toContain("from('app_settings').select('communications_enabled')")
    expect(portalEmail).toContain("const INTERNAL_KINDS: ReadonlySet<PortalEmailKind> = new Set(['resumo_diario', 'alerta_critico'])")
    expect(read('supabase/migrations/022_email_inbox_and_dispatch_state.sql')).toContain('repair_customer_contact_box_fallbacks')
    expect(read('supabase/migrations/022_email_inbox_and_dispatch_state.sql')).toContain("'portal_email_suprimido'")
  })

  it('reusa tentativa de bounce quando o efeito secundário é repetido', () => {
    expect(portalEmail).toContain("if (error?.code === '23505')")
    expect(portalEmail).toContain(".eq('idempotency_key', idempotencyKey)")
    expect(portalEmail).toContain('existing: true')
  })
})
