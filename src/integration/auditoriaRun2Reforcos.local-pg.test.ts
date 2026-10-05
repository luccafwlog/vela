import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Plano docs/plans/2026-09-28-remediacao-auditoria-seguranca-run-2.md,
// "Reforços adicionais (D4 = b)", migration 109. Cada caso falha no schema
// anterior à 109. Tudo roda numa transação descartada no fim.
const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const describeLocal = enabled ? describe : describe.skip
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const ADM = '10900000-0000-4000-8000-000000000001'
const FIN = '10900000-0000-4000-8000-000000000002'
const OPS = '10900000-0000-4000-8000-000000000003'
const EQP = '10900000-0000-4000-8000-000000000005'
const PORTAL = '10900000-0000-4000-8000-000000000004'
const CUSTOMER = 99109001
const BL_NO_RELEASE = 'R2-109-BL-SEM-CE'
const DEM_INVOICE = 99109003
const LOCAL_INVOICE = 99109004
const CONSOLIDATED = 99109005
const DISPUTE = 99109006
const VOYAGE = 99109012

const FIXTURES = `
  SET LOCAL request.jwt.claim.role = 'service_role';
  INSERT INTO auth.users (id, email) VALUES
    ('${ADM}', 'adm-109@example.test'), ('${FIN}', 'fin-109@example.test'),
    ('${OPS}', 'ops-109@example.test'), ('${PORTAL}', 'portal-109@example.test'), ('${EQP}', 'eqp-109@example.test');
  INSERT INTO public.user_profiles (id, full_name, role, active) VALUES
    ('${ADM}', 'Administrativo 109', 'administrativo', true),
    ('${FIN}', 'Financeiro 109', 'financeiro', true),
    ('${OPS}', 'Operações 109', 'operacoes', true),
    ('${EQP}', 'Equipamentos 109', 'equipamentos', true);
  INSERT INTO public.customers (id, cnpj_cpf, name) VALUES (${CUSTOMER}, '99109001000136', 'Cliente 109');
  UPDATE public.customer_portal_accounts
     SET auth_user_id = '${PORTAL}', active = true, account_situation = 'ativo', recovery_email = 'rec-109@example.test', recovery_email_status = 'ok'
   WHERE customer_id = ${CUSTOMER};
  INSERT INTO public.carriers (id, name) VALUES (99109010, 'Carrier 109');
  INSERT INTO public.vessels (id, name, carrier_id) VALUES (99109011, 'Vessel 109', 99109010);
  INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES (${VOYAGE}, 99109011, 'V109', 'active');
  INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES (99109013, 99109011, 'V109-VAZIA', 'active');
  INSERT INTO public.bls (id, voyage_id, customer_id, ce_mercante) VALUES ('${BL_NO_RELEASE}', ${VOYAGE}, ${CUSTOMER}, 'CE109');
  INSERT INTO public.demurrage_invoices (id, doc_number, bl_id, customer_id, total_usd, status)
    VALUES (${DEM_INVOICE}, 'DEM-109', '${BL_NO_RELEASE}', ${CUSTOMER}, 100, 'issued');
  INSERT INTO public.demurrage_disputes (id, demurrage_invoice_id, customer_id, state, next_responder, subject, opened_by)
    VALUES (${DISPUTE}, ${DEM_INVOICE}, ${CUSTOMER}, 'aberta', 'cliente', 'Assunto 109', 'cliente');
  INSERT INTO public.demurrage_dispute_messages (dispute_id, author_id, author_type, body, next_responder)
    VALUES (${DISPUTE}, '${ADM}', 'administrativo', 'Mensagem 109', 'cliente');
  INSERT INTO public.invoices (id, invoice_number, customer_id, bl_id, total_brl, status, pix_payload)
    VALUES (${LOCAL_INVOICE}, 'R2-109-INV', ${CUSTOMER}, NULL, 50.00, 'issued', 'R2-109');
  INSERT INTO public.invoice_bls (invoice_id, bl_id) VALUES (${LOCAL_INVOICE}, '${BL_NO_RELEASE}');
  INSERT INTO public.invoices (id, invoice_number, customer_id, total_brl, status, pix_payload, invoice_type)
    VALUES (${CONSOLIDATED}, 'R2-109-CONS', ${CUSTOMER}, 50.00, 'issued', 'R2-109C', 'consolidated');
  -- A fatura exige CE na emissão e o gatilho impede apagá-lo depois; a trava
  -- do Portal é defesa em profundidade, então o cenário desliga o gatilho
  -- dentro da transação descartada.
  SET CONSTRAINTS ALL IMMEDIATE;
  ALTER TABLE public.bls DISABLE TRIGGER trg_guard_bl_state_and_ce;
  UPDATE public.bls SET ce_mercante = NULL WHERE id = '${BL_NO_RELEASE}';
  ALTER TABLE public.bls ENABLE TRIGGER trg_guard_bl_state_and_ce;
  SET CONSTRAINTS ALL DEFERRED;
  CREATE FUNCTION pg_temp.try(q text) RETURNS text LANGUAGE plpgsql AS $f$
  BEGIN EXECUTE q; RETURN 'ok';
  EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE; END $f$;
  GRANT EXECUTE ON FUNCTION pg_temp.try(text) TO authenticated, service_role;
`

const as = (sub: string) => `RESET ROLE; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.role = 'authenticated'; SET LOCAL request.jwt.claim.sub = '${sub}';`
const asOwner = `RESET ROLE; SET LOCAL request.jwt.claim.role = 'service_role'; SET LOCAL request.jwt.claim.sub = '';`
const try_ = (sql: string) => `SELECT pg_temp.try($q$${sql}$q$);`

function scenario(sql: string): string[] {
  return execFileSync('psql', [
    '-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl,
    '-c', `BEGIN; ${FIXTURES} ${sql} ROLLBACK;`,
  ], { encoding: 'utf8' }).trim().split(/\r?\n/)
}

describeLocal('migration 109 — reforços adicionais da auditoria run-2', () => {
  it('recálculo manual por PTAX só para Financeiro, Administrativo e Equipamentos (109 + 110)', () => {
    expect(scenario(`
      ${as(OPS)} ${try_(`SELECT public.recalculate_demurrage_invoices_manual(5.5)`)}
      ${as(FIN)} ${try_(`SELECT public.recalculate_demurrage_invoices_manual(5.5)`)}
      ${as(EQP)} ${try_(`SELECT public.recalculate_demurrage_invoices_manual(5.5)`)}
    `)).toEqual(['42501', 'ok', 'ok'])
  })

  it('Portal não abre Dispute nem lê detalhe de fatura de B/L sem liberação', () => {
    expect(scenario(`
      ${as(PORTAL)}
      ${try_(`SELECT public.portal_add_dispute_message(${DEM_INVOICE}, 'Contesto.')`)}
      ${try_(`SELECT public.portal_invoice_details(${LOCAL_INVOICE})`)}
      ${asOwner} UPDATE public.bls SET ce_mercante = 'CE109' WHERE id = '${BL_NO_RELEASE}';
      ${as(PORTAL)}
      ${try_(`SELECT public.portal_invoice_details(${LOCAL_INVOICE})`)}
    `)).toEqual(['P0002', 'P0002', 'ok'])
  })

  it('Portal não lê author_id das mensagens de Dispute por SELECT direto', () => {
    expect(scenario(`
      ${as(PORTAL)}
      SELECT count(*) FROM public.demurrage_dispute_messages WHERE dispute_id = ${DISPUTE};
      SELECT jsonb_array_length(public.portal_list_disputes()->0->'messages');
    `)).toEqual(['0', '1'])
  })

  it('bounce temporário não marca o Email de Recuperação como bounce_permanente', () => {
    const event = (type: string) => `
      INSERT INTO public.portal_email_attempts (account_id, kind, idempotency_key, provider_message_id, recipient_masked)
      SELECT id, 'recuperacao', 'r2-109-${type}', 'r2-109-msg-${type}', 'r***@example.test' FROM public.customer_portal_accounts WHERE customer_id = ${CUSTOMER};
      INSERT INTO public.portal_email_events (provider_event_id, provider_message_id, event_type, payload, status, leased_by, lease_until, attempt_count)
      VALUES ('r2-109-ev-${type}', 'r2-109-msg-${type}', 'email.bounced',
        '{"type":"email.bounced","data":{"email_id":"r2-109-msg-${type}","to":["rec-109@example.test"],"bounce":{"type":"${type}"}}}'::jsonb,
        'processing', 'r2-109-worker', now() + interval '5 minutes', 1);
      SELECT (public.process_portal_email_event((SELECT id FROM public.portal_email_events WHERE provider_event_id = 'r2-109-ev-${type}'), 'r2-109-worker')->>'permanent_bounce');
      SELECT recovery_email_status FROM public.customer_portal_accounts WHERE customer_id = ${CUSTOMER};`
    expect(scenario(`${event('transient')} ${event('permanent')}`)).toEqual(['false', 'ok', 'true', 'bounce_permanente'])
  })

  it('viagem vazia não sai por DELETE direto', () => {
    expect(scenario(`
      ${as(ADM)} ${try_(`DELETE FROM public.voyages WHERE id = 99109013`)}
    `)).toEqual(['42501'])
  })

  it('estorno de baixa local: a implementação não é executável direto e o envelope exige admin', () => {
    expect(scenario(`
      ${as(ADM)} ${try_(`SELECT public._reverse_invoice_payment_impl_109(0, 'x', NULL)`)}
      ${try_(`SELECT public.reverse_invoice_payment(0, 'x', NULL)`)}
      ${as(FIN)} ${try_(`SELECT public.reverse_invoice_payment(0, 'x', NULL)`)}
    `)).toEqual(['42501', 'P0002', '42501'])
  })

  it('consolidada com PIX em conciliação não é desfeita pelo Portal', () => {
    expect(scenario(`
      INSERT INTO public.pix_reconciliation_exceptions (import_key, line_number, txid, normalized_txid, amount_brl, reason)
      VALUES ('r2-109-pix', 1, 'R2-109-CONS', public.normalize_pix_txid('R2-109-CONS'), 50, 'ambiguous');
      ${as(PORTAL)}
      ${try_(`SELECT public.portal_obsolete_consolidation(${CONSOLIDATED})`)}
      ${asOwner} UPDATE public.pix_reconciliation_exceptions SET status = 'resolved', resolved_at = now(), resolution_source = 'local' WHERE import_key = 'r2-109-pix';
      ${as(PORTAL)}
      ${try_(`SELECT public.portal_obsolete_consolidation(${CONSOLIDATED})`)}
    `)).toEqual(['55000', 'ok'])
  })
})

describe('migration 109 — contrato textual', () => {
  const sql = readFileSync('supabase/migrations/109_reforcos_auditoria_run_2.sql', 'utf8')
  it('notificação de consolidada conta os recebíveis deduplicados', () => {
    expect(sql).toContain("COALESCE(array_length(v_ids, 1), 0) || ' B/L(s).'")
    expect(sql).not.toContain('array_length(p_receivable_ids, 1)')
  })
  it('estorno pega o advisory por B/L antes das travas de linha', () => {
    const body = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.reverse_invoice_payment'))
    expect(body.indexOf("pg_advisory_xact_lock(hashtextextended('bl:' || v_bl_id, 0))")).toBeLessThan(body.indexOf('FOR UPDATE'))
  })
})
