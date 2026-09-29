import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

// Plano docs/plans/2026-09-28-remediacao-auditoria-seguranca-run-2.md, Fase 2
// (migration 106). Cada caso reproduz um candidato da auditoria run-2 e falha
// no schema anterior à 106. Tudo roda numa transação descartada no fim.
const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const describeLocal = enabled ? describe : describe.skip
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const ADM = '10500000-0000-4000-8000-000000000001'
const FIN = '10500000-0000-4000-8000-000000000002'
const EQP = '10500000-0000-4000-8000-000000000003'
const PORTAL = '10500000-0000-4000-8000-000000000004'
const CUSTOMER = 99105001
const OTHER_CUSTOMER = 99105002
const BL_OTHER = 'R2-105-BL-OUTRO'
const INVOICE = 99105003
const DISPUTE = 99105004
const MESSAGE = 99105005

const FIXTURES = `
  INSERT INTO auth.users (id, email) VALUES
    ('${ADM}', 'adm-105@example.test'), ('${FIN}', 'fin-105@example.test'),
    ('${EQP}', 'eqp-105@example.test'), ('${PORTAL}', 'portal-105@example.test');
  INSERT INTO public.user_profiles (id, full_name, role, active) VALUES
    ('${ADM}', 'Administrativo 105', 'administrativo', true),
    ('${FIN}', 'Financeiro 105', 'financeiro', true),
    ('${EQP}', 'Equipamentos 105', 'equipamentos', true);
  INSERT INTO public.customers (id, cnpj_cpf, name) VALUES
    (${CUSTOMER}, '99105001000168', 'Cliente 105'),
    (${OTHER_CUSTOMER}, '99105002000102', 'Outro Cliente 105');
  UPDATE public.customer_portal_accounts SET auth_user_id = '${PORTAL}', active = true, account_situation = 'ativo'
    WHERE customer_id = ${CUSTOMER};
  INSERT INTO public.carriers (id, name) VALUES (99105010, 'Carrier 105');
  INSERT INTO public.vessels (id, name, carrier_id) VALUES (99105011, 'Vessel 105', 99105010);
  INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES (99105012, 99105011, 'V105', 'active');
  INSERT INTO public.bls (id, voyage_id, customer_id) VALUES ('${BL_OTHER}', 99105012, ${OTHER_CUSTOMER});
  INSERT INTO public.demurrage_invoices (id, doc_number, bl_id, customer_id, total_usd, status, dispute_open, dispute_status)
    VALUES (${INVOICE}, 'DEM-105', '${BL_OTHER}', ${CUSTOMER}, 100, 'issued', true, 'aberto');
  INSERT INTO public.demurrage_disputes (id, demurrage_invoice_id, customer_id, state, next_responder, subject, opened_by)
    VALUES (${DISPUTE}, ${INVOICE}, ${CUSTOMER}, 'aberta', 'equipamentos', 'Assunto 105', 'cliente');
  INSERT INTO public.demurrage_dispute_messages (id, dispute_id, author_id, author_type, body, next_responder)
    VALUES (${MESSAGE}, ${DISPUTE}, '${EQP}', 'equipamentos', 'Mensagem 105', 'cliente');
  CREATE FUNCTION pg_temp.try(q text) RETURNS text LANGUAGE plpgsql AS $f$
  BEGIN EXECUTE q; RETURN 'ok';
  EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE; END $f$;
  GRANT EXECUTE ON FUNCTION pg_temp.try(text) TO authenticated, service_role;
`

const as = (sub: string) => `RESET ROLE; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.role = 'authenticated'; SET LOCAL request.jwt.claim.sub = '${sub}';`
const asService = `RESET ROLE; SET LOCAL ROLE service_role; SET LOCAL request.jwt.claim.role = 'service_role'; SET LOCAL request.jwt.claim.sub = '';`
const try_ = (sql: string) => `SELECT pg_temp.try($q$${sql}$q$);`

/** Roda o cenário numa transação descartável e devolve uma linha por SELECT. */
function scenario(sql: string): string[] {
  return execFileSync('psql', [
    '-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl,
    '-c', `BEGIN; ${FIXTURES} ${sql} ROLLBACK;`,
  ], { encoding: 'utf8' }).trim().split(/\r?\n/)
}

describeLocal('migration 106 — remediação da auditoria run-2', () => {
  it('2.1 Financeiro não encerra a Dispute por UPDATE; Equipamentos encerra pela RPC', () => {
    expect(scenario(`
      ${as(FIN)}
      ${try_(`UPDATE public.demurrage_invoices SET dispute_status = 'resolvido', dispute_open = false WHERE id = ${INVOICE}`)}
      ${try_(`UPDATE public.demurrage_invoices SET dispute_subject = 'novo assunto' WHERE id = ${INVOICE}`)}
      ${as(EQP)}
      ${try_(`SELECT public.add_demurrage_dispute_message(${DISPUTE}, 'Resolvido.', 'ninguem')`)}
      RESET ROLE;
      SELECT state FROM public.demurrage_disputes WHERE id = ${DISPUTE};
    `)).toEqual(['42501', 'ok', 'ok', 'resolvida'])  })

  it('2.2 Financeiro não anexa; Equipamentos não anexa em Dispute resolvida; nome longo é recusado', () => {
    const path = `${CUSTOMER}/disputes/${DISPUTE}/${MESSAGE}/a.pdf`
    const attach = (name = 'a.pdf') => try_(`SELECT public.add_demurrage_dispute_attachment(${MESSAGE}, '${path}', '${name}', 'application/pdf', 10)`)
    expect(scenario(`
      ${as(FIN)} ${attach()}
      ${as(EQP)} ${attach('x'.repeat(300))}
      ${attach()}
      RESET ROLE; UPDATE public.demurrage_disputes SET state = 'resolvida', next_responder = 'ninguem', resolved_at = now() WHERE id = ${DISPUTE};
      ${as(EQP)} ${attach()}
    `)).toEqual(['42501', '22023', 'ok', '22023'])
  })

  it('2.3 Portal não chama check_portal_rate_limit; a função recusa janela zero e segue limitando', () => {
    expect(scenario(`
      ${as(PORTAL)}
      ${try_(`SELECT public.check_portal_rate_limit('create_consolidation', 3, 10)`)}
      RESET ROLE; SET LOCAL request.jwt.claim.sub = '${PORTAL}';
      ${try_(`SELECT public.check_portal_rate_limit('r2_105', 1, 0)`)}
      ${try_(`SELECT public.check_portal_rate_limit('r2_105', 1, 10)`)}
      ${try_(`SELECT public.check_portal_rate_limit('r2_105', 1, 10)`)}
    `)).toEqual(['42501', '22023', 'ok', 'P0429'])
  })

  it('2.4 quem não é admin só registra a si mesmo como autor', () => {
    expect(scenario(`
      ${as(FIN)}
      ${try_(`SELECT public.reject_customer_reconciliation(0, 'x', '${ADM}')`)}
      ${try_(`SELECT public.reject_customer_reconciliation(0, 'x', '${FIN}')`)}
      ${try_(`SELECT public.add_manual_bl_charge('R2-105-NADA', 0, 1, NULL, '${ADM}')`)}
      ${try_(`SELECT public.calculate_bl_local_charges('R2-105-NADA', '${ADM}')`)}
      ${try_(`SELECT public.run_billing_for_import_batch(0, '${ADM}')`)}
      ${as(ADM)}
      ${try_(`SELECT public.reject_customer_reconciliation(0, 'x', '${FIN}')`)}
    `)).toEqual(['42501', 'P0002', '42501', '42501', '42501', 'P0002'])
  })

  it('2.5 audit_logs grava departamento e data reais', () => {
    expect(scenario(`
      ${as(FIN)}
      INSERT INTO public.audit_logs (entity_type, entity_id, field_name, changed_by, changed_at, actor_role, actor_department)
      VALUES ('r2_105', '1', 'teste', '${FIN}', '2020-01-01', 'administrativo', 'Administrativo')
      RETURNING concat_ws('|', (changed_at > now() - interval '1 minute')::text, actor_role, actor_department);
    `)).toEqual(['true|financeiro|financeiro'])
  })

  it('2.6 save_bl_review responde igual para B/L alheio e inexistente', () => {
    const save = (bl: string) => try_(`SELECT public.save_bl_review('${bl}', now(), '{}'::jsonb, '[]'::jsonb, '${PORTAL}')`)
    expect(scenario(`${as(PORTAL)} ${save(BL_OTHER)} ${save('R2-105-NADA')}`)).toEqual(['42501', '42501'])
  })

  it('2.7 Administrativo não apaga Cliente nem contato por DELETE direto', () => {
    expect(scenario(`
      INSERT INTO public.customer_contacts (customer_id, name, email) VALUES (${OTHER_CUSTOMER}, 'Contato', 'c-105@example.test');
      ${as(ADM)}
      ${try_(`DELETE FROM public.customer_contacts WHERE customer_id = ${OTHER_CUSTOMER}`)}
      ${try_(`DELETE FROM public.customers WHERE id = ${OTHER_CUSTOMER}`)}
    `)).toEqual(['42501', '42501'])
  })

  it('2.8 e-mail novo do consignatário não derruba a captura (D2 = c: ativo e principal)', () => {
    expect(scenario(`
      ${as(FIN)}
      ${try_(`SELECT public.ensure_customer_contact_email(${CUSTOMER}, 'novo-105@example.test', 'Consignatario', 'financeiro', NULL)`)}
      RESET ROLE;
      SELECT concat_ws('|', c.is_primary::text, (c.deactivated_at IS NULL)::text,
        ((SELECT count(*) FROM public.customer_contact_box_links l WHERE l.contact_id = c.id)
          = (SELECT count(*) FROM public.customer_communication_boxes WHERE active))::text)
      FROM public.customer_contacts c WHERE c.customer_id = ${CUSTOMER} AND c.email_normalized = 'novo-105@example.test';
    `)).toEqual(['ok', 'true|true|true'])
  })

  it('2.9 service_role revoga sessões do usuário interno; authenticated não executa', () => {
    expect(scenario(`
      CREATE TABLE IF NOT EXISTS auth.sessions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid);
      CREATE TABLE IF NOT EXISTS auth.refresh_tokens (id bigserial PRIMARY KEY, user_id text);
      GRANT ALL ON auth.sessions, auth.refresh_tokens TO service_role;
      INSERT INTO auth.sessions (user_id) VALUES ('${FIN}');
      INSERT INTO auth.refresh_tokens (user_id) VALUES ('${FIN}');
      ${as(ADM)}
      ${try_(`SELECT public.internal_revoke_sessions('${FIN}')`)}
      ${asService}
      ${try_(`SELECT public.internal_revoke_sessions('${FIN}')`)}
      RESET ROLE;
      SELECT (SELECT count(*) FROM auth.sessions WHERE user_id = '${FIN}') + (SELECT count(*) FROM auth.refresh_tokens WHERE user_id = '${FIN}');
    `)).toEqual(['42501', 'ok', '0'])
  })

  it('reforços: papéis atuais em retry_import_effect e políticas que chamavam _portal_actor_role', () => {
    expect(scenario(`
      ${as(ADM)}
      ${try_(`SELECT public.retry_import_effect(0, 'justificativa')`)}
      ${as(FIN)}
      ${try_(`SELECT count(*) FROM public.exchange_rate_reference`)}
      RESET ROLE;
      SELECT count(*) FROM pg_policies WHERE policyname = 'app_settings_administrativo_update';
      SELECT has_function_privilege('authenticated', 'public.import_breakbulk_manifest_transactional_031(text,bigint,uuid,integer,jsonb,jsonb,jsonb)', 'EXECUTE');
      SELECT count(*) FROM information_schema.role_table_grants WHERE grantee = 'anon' AND table_schema = 'public';
    `)).toEqual(['P0002', 'ok', '0', 'f', '0'])
  })
})
