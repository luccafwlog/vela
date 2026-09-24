import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(resolve(process.cwd(), 'supabase/functions/demurrage-dunning/index.ts'), 'utf8')

describe('Edge Function demurrage-dunning', () => {
  it('usa segredo próprio, claim transacional e template financeiro', () => {
    expect(source).toContain('DEMURRAGE_DUNNING_SECRET')
    expect(source).toContain("admin.rpc('claim_demurrage_dunning_candidates'")
    expect(source).toContain("renderDemurrageTemplate")
    expect(source).toContain("kind: 'cobranca_demurrage'")
    expect(source).toContain("p_anchor_invoice_id: candidate.invoice_id")
    expect(source).toContain("admin.rpc('release_demurrage_dunning_claim'")
    expect(source).toContain('CLAIM_BATCH_SIZE')
    expect(source).toContain('idempotencyKey = `demurrage:${communicationId}:${contact.id}:${await recipientVersion(recipient)}`')
    expect(source).not.toContain('claimed_at}:${recipient}')
  })

  it('respeita a chave global, contatos/supressões e o reply-to dedicado', () => {
    expect(source).toContain("communications_enabled")
    expect(source).toContain("dispatch_mode: communicationsEnabled ? 'real' : 'simulado'")
		expect(source).toContain('recipient_key: recipientIdentity')
		expect(source).toContain(".eq('recipient_key', recipientIdentity)")
		expect(source).toContain('idempotencyKey: existing.idempotency_key')
    expect(source).toContain("existing.dispatch_mode === 'legado'")
    expect(source).toContain("refresh_customer_communication_status")
    expect(source).toContain("customer_communication_suppressions")
    expect(source).toContain("bounce_permanente")
    expect(source).toContain("Deno.env.get('DEMURRAGE_REPLY_TO')?.trim() || Deno.env.get('COMMUNICATIONS_REPLY_TO')")
    expect(source.match(/replyTo: demurrageReplyTo\(\)/g)).toHaveLength(2)
    expect(source).not.toContain("replyTo: Deno.env.get('COMMUNICATIONS_REPLY_TO')")
    expect(source).toContain('first_billed_at')
    expect(source).toContain('attempt_discriminator')
    expect(source).toContain('claimed_at')
    expect(source).toContain(".in('email', contactEmails)")
    expect(source).toContain('releaseClaimSafely')
    expect(source).toContain('revalidateInvoiceBeforeSend')
    expect(source).toContain("result === 'falha' || result === 'pausado'")
    expect(source).toContain("result === 'parcial'")
    expect(source).not.toContain("result === 'simulado') simulated")
  })

  it('S06/D11 — agrupa por cliente/ciclo com uma mensagem por destinatário', () => {
    expect(source).toContain('groupDunningCandidatesByCustomerCycle')
    expect(source).toContain('sendCandidateGroup')
    expect(source).toContain('createGroupedCommunication')
    expect(source).toContain("admin.rpc('create_customer_dunning_group_atomic'")
    expect(source).toContain('p_invoice_ids')
    expect(source).toContain('customer_communication_recipient_allowed')
    expect(source).toContain('demurrage:group:')
    // Sem consolidar faturas: cada identificador/valor segue individual.
    expect(source).toContain('sem consolidação')
    // Revalida quitação/disputa/supressão/caixa por fatura antes de compor.
    expect(source).toContain('revalidateInvoiceBeforeSend(admin, candidate.invoice_id)')
    // Chave global: sem envio real desligado não há RESEND, mas o grupo
    // simulado segue registrado; grupo unitário preserva o caminho por fatura.
    expect(source).toContain('group.length === 1')
  })
})
