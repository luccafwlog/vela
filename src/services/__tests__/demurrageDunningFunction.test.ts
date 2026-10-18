import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Contrato textual da Edge Function. O comportamento da rodada (status,
// posições e contadores) é testado com banco e provedor falsos em
// demurrageDunningRunner.test.ts.
const entry = readFileSync(resolve(process.cwd(), 'supabase/functions/demurrage-dunning/index.ts'), 'utf8')
const runner = readFileSync(resolve(process.cwd(), 'supabase/functions/_shared/demurrageDunningRunner.ts'), 'utf8')

describe('Edge Function demurrage-dunning', () => {
  it('usa segredo próprio, claim transacional e desfecho gravado por fatura', () => {
    expect(entry).toContain('DEMURRAGE_DUNNING_SECRET')
    expect(entry).toContain("admin.rpc('claim_demurrage_dunning_candidates'")
    expect(entry).toContain("admin.rpc('settle_demurrage_dunning_claim'")
    expect(entry).toContain('p_anchor_invoice_id: first.invoice_id')
    expect(entry).toContain("p_kind: 'cobranca_demurrage'")
    expect(runner).toContain('CLAIM_BATCH_SIZE')
    expect(runner).toContain('renderDemurrageTemplate')
    expect(runner).toContain('renderDemurrageGroupTemplate')
    expect(runner).toContain("const prefix = mode === 'group' ? `demurrage:group:${communicationId}:` : `demurrage:${communicationId}:`")
  })

  it('respeita a chave global, contatos/supressões e o reply-to dedicado', () => {
    expect(entry).toContain('communications_enabled')
    expect(entry).toContain("dispatch_mode: communicationsEnabled ? 'real' : 'simulado'")
    expect(entry).toContain('recipient_key: recipientIdentity')
    expect(entry).toContain(".eq('recipient_key', recipientIdentity)")
    expect(entry).toContain('idempotencyKey: existing.idempotency_key')
    expect(entry).toContain("existing.dispatch_mode === 'legado'")
    expect(entry).toContain('refresh_customer_communication_status')
    expect(entry).toContain('customer_communication_suppressions')
    expect(entry).toContain('bounce_permanente')
    expect(entry).toContain("Deno.env.get('DEMURRAGE_REPLY_TO')?.trim() || Deno.env.get('COMMUNICATIONS_REPLY_TO')")
    expect(entry).toContain('replyTo: demurrageReplyTo()')
    expect(entry).not.toContain("replyTo: Deno.env.get('COMMUNICATIONS_REPLY_TO')")
    expect(runner).toContain('Revalida')
    expect(runner).toContain('isSendable(')
  })

  it('1E.6 — destinatário pelo critério do banco, sem caixas fixas no código', () => {
    expect(entry).toContain("admin.rpc('customer_communication_recipient_allowed'")
    expect(entry).not.toContain("['financeiro', 'demurrage']")
    expect(entry).not.toContain("'box_code'")
  })

  it('S06/D11 — agrupa por cliente/ciclo com uma mensagem por destinatário', () => {
    expect(runner).toContain('groupDunningCandidatesByCustomerCycle')
    expect(entry).toContain("admin.rpc('create_customer_dunning_group_atomic'")
    expect(entry).toContain('p_invoice_ids')
    expect(runner).toContain("group.length === 1 ? 'single' : 'group'")
  })

  it('A13: o e-mail informa o USD líquido do desconto, coerente com o BRL e a tela', () => {
    expect(runner).toContain("import { invoiceNetUsd } from './demurrageNetUsd.ts'")
    expect(entry).toContain('total_usd, discount_mode, discount_value, current_total_brl')
    expect(runner).toContain('const netUsd = invoiceNetUsd(context).netUsd')
    expect(runner).toContain('totalUsd: netUsd,')
    expect(runner).not.toContain('totalUsd: candidate.total_usd')
  })

  it('5.1 — e-mail mascarado em todo log da rodada', () => {
    expect(runner).toContain('to: maskEmail(recipient)')
    expect(runner).not.toMatch(/console\.(?:warn|error)\([^)]*recipient[,)]/)
    expect(entry).not.toMatch(/console\./)
  })
})
