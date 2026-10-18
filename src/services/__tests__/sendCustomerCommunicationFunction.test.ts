import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (file: string) => readFileSync(resolve(process.cwd(), 'supabase/functions', file), 'utf8')

describe('Edge Function send-customer-communication', () => {
  const source = read('send-customer-communication/index.ts')

  it('mantém autenticação interna, guarda de natureza e simulação sem Resend', () => {
    expect(source).toContain("caller.rpc('portal_current_role')")
    expect(source).toContain("if (!nature || !natureForKind(kind, nature))")
    expect(source).toContain("const enabled = Boolean")
    // Registro da tentativa: _shared/customerCommunicationAttempts.ts (testado com banco falso).
    expect(source).toContain('communicationAttemptRecorder(attemptStore, { communicationId: Number(communicationId), enabled })')
    expect(source).toContain("resendApiKey: enabled ? resendApiKey : null")
    expect(source).toContain("refresh_customer_communication_status")
    expect(source).toContain("replyTo: Deno.env.get('COMMUNICATIONS_REPLY_TO')")
    expect(source).not.toContain("replyTo: Deno.env.get('COMMUNICATIONS_REPLY_TO') ?? Deno.env.get('PORTAL_REPLY_TO')")
    expect(source).toContain("timingSafeEqual(providedAutomationSecret, automationSecret)")
  })

  it('confere contato, preferência, bounce/complaint e grava a operação pelo RPC atômico', () => {
    expect(source).toContain("from('customer_contacts')")
    expect(source).toContain("admin.rpc('customer_communication_recipient_allowed'")
    // A22: o público fixo é roteado pelo modelo; nenhuma caixa é forçada.
    expect(source).not.toMatch(/isFixedOperationalAudience\s*\?\s*'documentacao_operacao'/)
    expect(source).not.toContain("customer_contact_preferences")
    expect(source).toContain("from('customer_communication_suppressions')")
    expect(source).toContain("reason', 'bounce_permanente'")
    expect(source).toContain("admin.rpc('create_customer_communication_atomic'")
    // Escala, porto, B/L cancelado, Atracação e a regra do NOB (migration 243)
    // são conferidos pela mesma validação da RPC (migration 304).
    expect(source).toContain("admin.rpc('customer_communication_anchor_validation'")
    expect(source).not.toContain(".from('voyage_escala_operation_fronts')")
    expect(source).toContain("admin.from('customer_communication_attempts').insert(row)")
    expect(source).toContain("admin.rpc('customer_local_charges_communication_payload'")
    expect(source).toContain("admin.rpc('customer_local_charges_communication_dispatch_ready'")
    expect(source).toContain("admin.rpc('mark_customer_communication_dispatch_blocked'")
    expect(source).toContain('recordUnsentCommunicationAttempt(attemptStore')
    expect(source).toContain('renderCeMercanteTaxasTemplate')
    // Plano dos e-mails, 5.1: a chave da tentativa leva o hash do destinatário.
    expect(source).toContain('idempotencyKey: attemptKey,')
    expect(source).toContain('resolveCommunicationAttemptKey(')
    expect(source).toContain('Cobrança de Demurrage é enviada exclusivamente pela régua automática.')
    expect(source).toContain('if (isAutomation && existingCommunicationId == null)')
    expect(source).toContain('findExistingCommunicationId')
  })

  it('persiste anexos de forma privada, limitada e idempotente antes do envio com compatibilidade de automação', () => {
    expect(source).toContain("from('customer_communication_attachments')")
    expect(source).toMatch(/from\('customer-communications'\)[\s\S]*\.upload\(/)
    expect(source).toMatch(/from\('customer-communications'\)[\s\S]*\.remove\(/)
    expect(source).toContain('existing.length + newAttachments.length > 3')
    expect(source).toContain('existingBytes + newBytes > 10 * 1024 * 1024')
    expect(source).toContain('uploadedBy: string | null')
    expect(source).toContain('callerUser.user?.id ?? null')
  })

  it('lê a sigla do terminal do NOB em depots e nunca manda o UUID ao cliente', () => {
    expect(source).not.toContain('terminals(code)')
    // A sigla vem de voyage_terminal_code (depots) pela validação única da
    // âncora (migration 304); sem sigla, a validação recusa.
    expect(source).toContain('anchor?.terminal_code ?? null')
    expect(source).not.toContain('?? row.terminal_id')
    const migration = readFileSync(resolve(process.cwd(), 'supabase/migrations/304_escala_unica_dos_comunicados.sql'), 'utf8')
    expect(migration).toContain("'O terminal da Atracação está sem sigla cadastrada.'")
    expect(migration).toContain('public.voyage_terminal_code(t.terminal_id) AS terminal_code')
    // Auditoria run-2 (reforço): o histórico não aceita terminal vindo do navegador.
    expect(source).toContain('p_terminal_name: canonicalTerminalName,')
  })
})
