// Lote 6 das correções decididas pelo dono em 2026-10-27 (migration 471):
// quem inclui contatos pela Base de Clientes, pela Revisão e pela RPC direta
// (D10, ACE-D04), a origem do e-mail digitado na Revisão (D07), a Base diante
// de Cliente desativado (D15), o CNPJ de caractere repetido (D08) e o alerta
// "Cliente sem contato alternativo" que contava contato desativado (D18).
//
// Namespace exclusivo: ids 99471xxx, B/Ls 'A471-*', usuários ...000000471NNN.
import { execPsql, spawnPsql } from './localPsql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const describeLocal = enabled ? describe : describe.skip
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const DOC = '00000000-0000-0000-0000-000000471001'
const FIN = '00000000-0000-0000-0000-000000471002'
const carrierId = 99471001
const vesselId = 99471002
const voyageId = 99471003
const deactivatedId = 99471004
const bouncedId = 99471005
const CNPJ_FIN_BASE = '99471001000181'
const CNPJ_REVIEW_FIN = '99471002000126'
const CNPJ_DEACTIVATED = '99471003000170'
const CNPJ_BOUNCED = '99471004000115'
const CNPJS = [CNPJ_FIN_BASE, CNPJ_REVIEW_FIN, CNPJ_DEACTIVATED, CNPJ_BOUNCED]
const cnpjList = CNPJS.map((value) => `'${value}'`).join(', ')
const BL_REVIEW_FIN = 'A471-REVFIN'
const BL_REVIEW_DOC = 'A471-REVDOC'
const BL_DEACTIVATED = 'A471-DESAT'
const bls = [BL_REVIEW_FIN, BL_REVIEW_DOC, BL_DEACTIVATED]
const blList = bls.map((id) => `'${id}'`).join(', ')
const BOUNCED_EMAIL = 'a471-bounce@example.test'
const customersOf = `SELECT id FROM public.customers WHERE cnpj_cpf IN (${cnpjList})`

function psql(sql: string): string {
  return execPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', sql],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function asUser(user: string, sql: string): { stdout: string; stderr: string } {
  const run = spawnPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c',
    `SET ROLE authenticated; SET request.jwt.claim.role = 'authenticated'; SET request.jwt.claim.sub = '${user}'; ${sql}`],
  { encoding: 'utf8' })
  return { stdout: run.stdout.trim(), stderr: run.stderr }
}

function baseBatch(user: string, rows: unknown[]) {
  return asUser(user, `SELECT public.apply_customer_base_batch_atomic('${JSON.stringify(rows)}'::jsonb, '${user}');`)
}

function cleanup() {
  psql(`
    SET session_replication_role = replica;
    DELETE FROM public.customer_reconciliation_queue WHERE bl_id IN (${blList});
    DELETE FROM public.billing_run_logs WHERE bl_id IN (${blList});
    DELETE FROM public.charge_calculations WHERE bl_id IN (${blList});
    DELETE FROM public.bls WHERE id IN (${blList});
    DELETE FROM public.audit_logs WHERE entity_id IN (${blList}) OR changed_by IN ('${DOC}', '${FIN}');
    DELETE FROM public.alert_item_events WHERE alert_item_id IN (SELECT i.id FROM public.alert_items i JOIN public.alerts a ON a.id = i.alert_id
      WHERE a.entity_type = 'customer' AND a.entity_id IN (SELECT id::text FROM public.customers WHERE cnpj_cpf IN (${cnpjList})));
    DELETE FROM public.internal_notifications WHERE alert_id IN (SELECT id FROM public.alerts WHERE entity_type = 'customer'
      AND entity_id IN (SELECT id::text FROM public.customers WHERE cnpj_cpf IN (${cnpjList})));
    DELETE FROM public.alert_items WHERE alert_id IN (SELECT id FROM public.alerts WHERE entity_type = 'customer'
      AND entity_id IN (SELECT id::text FROM public.customers WHERE cnpj_cpf IN (${cnpjList})));
    DELETE FROM public.alerts WHERE entity_type = 'customer' AND entity_id IN (SELECT id::text FROM public.customers WHERE cnpj_cpf IN (${cnpjList}));
    DELETE FROM public.portal_suppressed_emails WHERE email = '${BOUNCED_EMAIL}';
    DELETE FROM public.customer_contact_change_events WHERE customer_id IN (${customersOf});
    DELETE FROM public.customer_contact_box_links WHERE contact_id IN (SELECT id FROM public.customer_contacts WHERE customer_id IN (${customersOf}));
    DELETE FROM public.customer_contact_preferences WHERE contact_id IN (SELECT id FROM public.customer_contacts WHERE customer_id IN (${customersOf}));
    DELETE FROM public.customer_contacts WHERE customer_id IN (${customersOf});
    DELETE FROM public.customer_portal_accounts WHERE customer_id IN (${customersOf});
    DELETE FROM public.customers WHERE cnpj_cpf IN (${cnpjList});
    DELETE FROM public.voyages WHERE id = ${voyageId};
    DELETE FROM public.vessels WHERE id = ${vesselId};
    DELETE FROM public.carriers WHERE id = ${carrierId};
    DELETE FROM public.user_profiles WHERE id IN ('${DOC}', '${FIN}');
    DELETE FROM auth.users WHERE id IN ('${DOC}', '${FIN}');
    SET session_replication_role = origin;
  `)
}

describeLocal('Clientes, contatos e Comunicados decididos pelo dono (migration 471)', () => {
  beforeAll(() => {
    cleanup()
    psql(`
      INSERT INTO auth.users (id, email) VALUES ('${DOC}', 'a471-doc@example.test'), ('${FIN}', 'a471-fin@example.test');
      INSERT INTO public.user_profiles (id, full_name, role, active) VALUES
        ('${DOC}', 'A471 Documentação', 'documentacao', true),
        ('${FIN}', 'A471 Financeiro', 'financeiro', true);
      INSERT INTO public.carriers (id, name) VALUES (${carrierId}, 'A471 Carrier');
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (${vesselId}, 'A471 NAVIO', ${carrierId});
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES (${voyageId}, ${vesselId}, 'A471', 'active');
      INSERT INTO public.customers (id, cnpj_cpf, name, city) VALUES
        (${deactivatedId}, '${CNPJ_DEACTIVATED}', 'A471 DESATIVADA LTDA', 'Santos'),
        (${bouncedId}, '${CNPJ_BOUNCED}', 'A471 BOUNCE LTDA', NULL);
      INSERT INTO public.bls (id, voyage_id, pol, pod, cargo_mode, consignee, manifest_customer_cnpj_cpf, customer_reconciliation_status, review_status) VALUES
        ('${BL_REVIEW_FIN}', ${voyageId}, 'A471O', 'A471P', 'container', 'A471 REVISAO FIN', '${CNPJ_REVIEW_FIN}', 'missing_customer', 'pending_review'),
        ('${BL_REVIEW_DOC}', ${voyageId}, 'A471O', 'A471P', 'container', 'A471 REVISAO FIN', '${CNPJ_REVIEW_FIN}', 'missing_customer', 'pending_review'),
        ('${BL_DEACTIVATED}', ${voyageId}, 'A471O', 'A471P', 'container', 'A471 DESATIVADA', '${CNPJ_DEACTIVATED}', 'missing_customer', 'pending_review');
      SET request.jwt.claim.role = 'authenticated'; SET request.jwt.claim.sub = '${DOC}';
      INSERT INTO public.customer_contacts (customer_id, name, email, is_primary, origin) VALUES
        (${deactivatedId}, 'Antigo', 'a471-antigo@example.test', true, 'interno');
      SET session_replication_role = replica;
      UPDATE public.customers SET deactivated_at = now() WHERE id = ${deactivatedId};
    `)
  })

  afterAll(cleanup)

  it('D08: CNPJ de caractere repetido é inválido', () => {
    expect(psql(`SELECT public.is_valid_cnpj('00000000000000')::text || '|' || public.is_valid_cnpj('${CNPJ_FIN_BASE}')::text;`)).toBe('false|true')
    expect(asUser(DOC, `INSERT INTO public.customers (cnpj_cpf, name) VALUES ('00.000.000/0000-00', 'A471 ZEROS');`).stderr).toMatch(/CNPJ inválido/)
  })

  it('ACE-D04: a RPC direta de contato recusa quem não edita contatos', () => {
    const fin = asUser(FIN, `SELECT public.ensure_customer_contact_email(${bouncedId}, 'a471-fin@example.test');`)
    expect(fin.stderr).toMatch(/Permissão negada para editar contatos do cliente/)
    expect(psql(`SELECT count(*) FROM public.customer_contacts WHERE email_normalized = 'a471-fin@example.test';`)).toBe('0')
    expect(asUser(DOC, `SELECT public.ensure_customer_contact_email(${bouncedId}, 'a471-doc-direto@example.test');`).stdout).toBe('t')
    expect(psql(`SELECT has_function_privilege('authenticated', 'public._ensure_customer_contact_email(bigint, text, text, text, text, text)', 'EXECUTE');`)).toBe('f')
  })

  it('D10: o Financeiro importa só o cadastro pela Base; a Documentação inclui os contatos', () => {
    const row = { cnpj: CNPJ_FIN_BASE, name: 'A471 BASE FIN LTDA', emails: ['a471-base@example.test'] }
    const fin = baseBatch(FIN, [row])
    expect(fin.stderr).toBe('')
    expect(JSON.parse(fin.stdout)).toMatchObject({ ok: true, imported: 1, contacts_created: 0, contacts_skipped: true })
    expect(psql(`SELECT count(*) FROM public.customer_contacts WHERE customer_id IN (SELECT id FROM public.customers WHERE cnpj_cpf = '${CNPJ_FIN_BASE}');`)).toBe('0')
    const doc = baseBatch(DOC, [row])
    expect(JSON.parse(doc.stdout)).toMatchObject({ ok: true, updated: 1, contacts_created: 1, contacts_skipped: false })
  })

  it('D10 e D07: pela Revisão, o Financeiro cadastra o Cliente sem contato; a Documentação grava o e-mail como Cadastrado pela equipe', () => {
    const fin = asUser(FIN, `SELECT public.complete_review_customer_group(ARRAY['${BL_REVIEW_FIN}'], NULL, '${CNPJ_REVIEW_FIN}', 'A471 REVISAO LTDA', 'a471-fin-revisao@example.test', '${FIN}');`)
    expect(fin.stderr).toBe('')
    expect(JSON.parse(fin.stdout)).toMatchObject({ contact_saved: false })
    expect(psql(`SELECT count(*) FROM public.customer_contacts WHERE customer_id IN (SELECT id FROM public.customers WHERE cnpj_cpf = '${CNPJ_REVIEW_FIN}');`)).toBe('0')
    expect(psql(`SELECT customer_id IS NOT NULL FROM public.bls WHERE id = '${BL_REVIEW_FIN}';`)).toBe('t')

    const doc = asUser(DOC, `SELECT public.complete_review_customer_group(ARRAY['${BL_REVIEW_DOC}'], NULL, '${CNPJ_REVIEW_FIN}', 'A471 REVISAO LTDA', 'A471-Revisao@Example.test', '${DOC}');`)
    expect(doc.stderr).toBe('')
    expect(JSON.parse(doc.stdout)).toMatchObject({ contact_saved: true })
    expect(psql(`SELECT origin || '|' || name FROM public.customer_contacts WHERE email_normalized = 'a471-revisao@example.test';`)).toBe('interno|A471 REVISAO LTDA')
    expect(psql(`SELECT source || '|' || (change_summary->>'action') FROM public.customer_contact_change_events
      WHERE customer_id IN (SELECT id FROM public.customers WHERE cnpj_cpf = '${CNPJ_REVIEW_FIN}');`)).toBe('interno|review_contact_added')
  })

  it('D15: a Base não muda Cliente desativado e não conta a sugestão como vínculo', () => {
    const result = baseBatch(DOC, [{ cnpj: CNPJ_DEACTIVATED, name: 'A471 NOVO NOME SA', city: 'Vitória', emails: ['a471-antigo@example.test', 'a471-novo@example.test'] }])
    expect(result.stderr).toBe('')
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, bls_linked: 0, bls_suggested: 1, deactivated_skipped: 1, contacts_created: 0 })
    expect(psql(`SELECT name || '|' || city FROM public.customers WHERE id = ${deactivatedId};`)).toBe('A471 DESATIVADA LTDA|Santos')
    expect(psql(`SELECT count(*) FILTER (WHERE deactivated_at IS NULL) || '|' || count(*) FROM public.customer_contacts WHERE customer_id = ${deactivatedId};`)).toBe('1|1')
    expect(psql(`SELECT COALESCE(customer_id::text, 'sem') || '|' || suggested_customer_id || '|' || customer_reconciliation_status FROM public.bls WHERE id = '${BL_DEACTIVATED}';`))
      .toBe(`sem|${deactivatedId}|matched_name`)
    expect(psql(`SELECT count(*) FROM public.audit_logs WHERE entity_id = '${BL_DEACTIVATED}' AND justification = 'Vínculo por documento pela Base de Clientes';`)).toBe('0')
  })

  it('D18: contato desativado não fecha o alerta "Cliente sem contato alternativo"', () => {
    psql(`
      SET request.jwt.claim.role = 'authenticated'; SET request.jwt.claim.sub = '${DOC}';
      DELETE FROM public.customer_contacts WHERE customer_id = ${bouncedId};
      INSERT INTO public.customer_contacts (customer_id, name, email, is_primary, origin, deactivated_at) VALUES
        (${bouncedId}, 'Principal', '${BOUNCED_EMAIL}', true, 'interno', NULL),
        (${bouncedId}, 'Antigo', 'a471-desativado@example.test', false, 'interno', now());
      INSERT INTO public.portal_suppressed_emails (email, reason) VALUES ('${BOUNCED_EMAIL}', 'bounce_permanente');
    `)
    const openItems = `SELECT count(*) FROM public.alert_items i JOIN public.alerts a ON a.id = i.alert_id
      WHERE a.entity_type = 'customer' AND a.entity_id = '${bouncedId}' AND i.item_type = 'cliente_contato_bounced_sem_alternativa' AND i.status = 'active';`
    psql(`SET request.jwt.claim.role = 'service_role'; SELECT public.detect_customer_communication_alerts();`)
    expect(psql(openItems)).toBe('1')
    // Trocar o e-mail do contato desativado não fecha o alerta; reativá-lo fecha na hora.
    psql(`SET request.jwt.claim.role = 'authenticated'; SET request.jwt.claim.sub = '${DOC}';
      UPDATE public.customer_contacts SET email = 'a471-desativado-novo@example.test' WHERE customer_id = ${bouncedId} AND email = 'a471-desativado@example.test';`)
    expect(psql(openItems)).toBe('1')
    psql(`SET request.jwt.claim.role = 'service_role'; SELECT public.detect_customer_communication_alerts();`)
    expect(psql(openItems)).toBe('1')
    psql(`SET request.jwt.claim.role = 'authenticated'; SET request.jwt.claim.sub = '${DOC}';
      UPDATE public.customer_contacts SET deactivated_at = NULL WHERE customer_id = ${bouncedId} AND email = 'a471-desativado-novo@example.test';`)
    expect(psql(openItems)).toBe('0')
  })
})
