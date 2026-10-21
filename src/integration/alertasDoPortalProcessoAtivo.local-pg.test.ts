import { execPsql, spawnPsql } from './localPsql'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { describeWithProbe, syntheticCnpj } from './localTestData'

// Migration 350 (revisão dos alertas de 2026-10-21, docs/revisao-alertas-2026-10.md,
// decisão P3 e "fechar junto com o fato"): processo ativo do Portal é B/L vivo
// ainda não pago, ou Invoice de Demurrage em aberto; os quatro alertas do
// Portal abrem e fecham na hora em que o fato muda, sem esperar o detector.

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

// Sem papel nem usuário: o mesmo contexto de um job do pg_cron. Os gatilhos
// precisam autorizar o alerta sozinhos.
function psql(sql: string) {
  return execPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', sql], {
    encoding: 'utf8',
  }).trim()
}

function asAdmin(sql: string) {
  return psql(`BEGIN;
    SELECT set_config('request.jwt.claims', '{"sub":"${ADMIN_ID}","role":"authenticated"}', true);
    SET LOCAL ROLE authenticated;
    ${sql}
    COMMIT;`)
}

function migrationApplied() {
  if (!enabled) return false
  try {
    return psql(`SELECT to_regprocedure('public.reconcile_client_portal_alerts_for_customer(bigint,text)') IS NOT NULL;`) === 't'
  } catch {
    return false
  }
}

const describeLocal = describeWithProbe(migrationApplied, 'migration 350 (reconcile_client_portal_alerts_for_customer)')

const CARRIER = 99350001
const VESSEL = 99350002
const VOYAGE = 99350003
const ALFA = 99350011
const BETA = 99350012
const GAMA = 99350013
const CUSTOMERS = `${ALFA}, ${BETA}, ${GAMA}`
const PORTAL_USER = '35000000-0000-4000-8000-0000000000b1'
const ADMIN_ID = '35000000-0000-4000-8000-0000000000a1'
const EMAIL = 'gama350@cliente.test'

function items(customerId: number) {
  return psql(`SELECT COALESCE(string_agg(i.item_type || '=' || i.status, ',' ORDER BY i.item_type), 'nenhum')
    FROM public.alert_items i JOIN public.alerts a ON a.id = i.alert_id
    WHERE a.entity_type = 'customer' AND a.entity_id = '${customerId}' AND i.item_type LIKE 'portal\\_%';`)
}

function status(customerId: number, itemType: string) {
  return psql(`SELECT COALESCE((SELECT i.status FROM public.alert_items i JOIN public.alerts a ON a.id = i.alert_id
    WHERE a.entity_type = 'customer' AND a.entity_id = '${customerId}' AND i.item_type = '${itemType}'), 'nenhum');`)
}

function openings(customerId: number, itemType: string) {
  return psql(`SELECT count(*) FROM public.alert_item_events e JOIN public.alert_items i ON i.id = e.alert_item_id
    JOIN public.alerts a ON a.id = i.alert_id
    WHERE a.entity_type = 'customer' AND a.entity_id = '${customerId}' AND i.item_type = '${itemType}' AND e.event_type = 'opened';`)
}

function cleanup() {
  psql(`
    SET session_replication_role = replica;
    CREATE TEMP TABLE a350_alerts AS SELECT id FROM public.alerts
      WHERE entity_type = 'customer' AND entity_id IN ('${ALFA}', '${BETA}', '${GAMA}');
    DELETE FROM public.alert_item_events WHERE alert_item_id IN (SELECT id FROM public.alert_items WHERE alert_id IN (SELECT id FROM a350_alerts));
    DELETE FROM public.alert_item_dismissals WHERE alert_item_id IN (SELECT id FROM public.alert_items WHERE alert_id IN (SELECT id FROM a350_alerts));
    DELETE FROM public.internal_notifications WHERE alert_id IN (SELECT id FROM a350_alerts);
    DELETE FROM public.alert_items WHERE alert_id IN (SELECT id FROM a350_alerts);
    DELETE FROM public.alerts WHERE id IN (SELECT id FROM a350_alerts);
    DELETE FROM public.alerts WHERE type = 'portal_convite_expirado' AND entity_id IN ('${ALFA}', '${BETA}', '${GAMA}');
    DELETE FROM public.demurrage_invoices WHERE customer_id IN (${CUSTOMERS});
    DELETE FROM public.bls WHERE id LIKE 'BL350%';
    DELETE FROM public.portal_suppressed_emails WHERE email IN ('${EMAIL}', 'novo-${EMAIL}');
    DELETE FROM public.portal_invites WHERE account_id IN (SELECT id FROM public.customer_portal_accounts WHERE customer_id IN (${CUSTOMERS}));
    DELETE FROM public.portal_provisioning_events WHERE customer_id IN (${CUSTOMERS});
    DELETE FROM public.customer_billing_portal_releases WHERE customer_id IN (${CUSTOMERS});
    DELETE FROM public.customer_portal_accounts WHERE customer_id IN (${CUSTOMERS});
    DELETE FROM public.customers WHERE id IN (${CUSTOMERS});
    DELETE FROM public.voyages WHERE id = ${VOYAGE};
    DELETE FROM public.vessels WHERE id = ${VESSEL};
    DELETE FROM public.carriers WHERE id = ${CARRIER};
    DELETE FROM public.audit_logs WHERE changed_by = '${ADMIN_ID}';
    DELETE FROM public.user_profiles WHERE id = '${ADMIN_ID}';
    DELETE FROM auth.users WHERE id IN ('${PORTAL_USER}', '${ADMIN_ID}');
    SET session_replication_role = origin;
  `)
}

describeLocal('350 — alertas do Portal seguem o processo ativo e fecham na hora', () => {
  beforeAll(() => {
    cleanup()
    psql(`
      INSERT INTO auth.users (id, email, aud, role) VALUES ('${PORTAL_USER}', 'portal350@cliente.test', 'authenticated', 'authenticated');
      INSERT INTO public.carriers (id, name) VALUES (${CARRIER}, 'Armador 350');
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (${VESSEL}, 'Navio 350', ${CARRIER});
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES (${VOYAGE}, ${VESSEL}, 'V350', 'active');
      INSERT INTO public.customers (id, name, cnpj_cpf) VALUES
        (${ALFA}, 'TRANSPORTES ALFA 350', '${syntheticCnpj(350011)}'),
        (${BETA}, 'BETA 350', '${syntheticCnpj(350012)}'),
        (${GAMA}, 'GAMA 350', '${syntheticCnpj(350013)}');
      -- Liberação de faturamento sem Portal: o B/L pode chegar a faturado e pago
      -- sem a conta pronta (ADR 0070).
      INSERT INTO auth.users (id, email, aud, role) VALUES ('${ADMIN_ID}', 'adm350@test.local', 'authenticated', 'authenticated');
      INSERT INTO public.user_profiles (id, full_name, role, active) VALUES ('${ADMIN_ID}', 'Administrativo 350', 'administrativo', true);
      INSERT INTO public.customer_billing_portal_releases (customer_id, justification, granted_by, review_at)
      SELECT id, 'teste 350', '${ADMIN_ID}', now() + interval '10 days' FROM public.customers WHERE id IN (${CUSTOMERS});
    `)
  })

  afterAll(cleanup)

  it('Cliente só com B/L pago: o alerta do Portal fecha no pagamento e B/L novo reabre', () => {
    psql(`INSERT INTO public.bls (id, voyage_id, customer_id, pol, pod, financial_status)
      VALUES ('BL350ALFA1', ${VOYAGE}, ${ALFA}, 'CNSHA', 'BRVIX', 'invoiced');`)
    // A inclusão do B/L abre na hora, sem o detector.
    expect(status(ALFA, 'portal_pendencia_geral')).toBe('active')

    psql(`UPDATE public.bls SET financial_status = 'paid' WHERE id = 'BL350ALFA1';`)
    // Antes: ficava aberto para sempre (B/L pago contava como processo ativo).
    expect(status(ALFA, 'portal_pendencia_geral')).toBe('resolved')
    psql(`SELECT set_config('request.jwt.claim.role', 'service_role', false); SELECT public.reconcile_client_portal_alerts();`)
    expect(status(ALFA, 'portal_pendencia_geral')).toBe('resolved')

    psql(`INSERT INTO public.bls (id, voyage_id, customer_id, pol, pod, financial_status)
      VALUES ('BL350ALFA2', ${VOYAGE}, ${ALFA}, 'CNSHA', 'BRVIX', 'pending');`)
    expect(status(ALFA, 'portal_pendencia_geral')).toBe('active')
    expect(openings(ALFA, 'portal_pendencia_geral')).toBe('2')

    // Cancelar o B/L fecha na hora.
    asAdmin(`SELECT public.cancel_bl('BL350ALFA2', 'Carga não embarcou (teste 350)', false);`)
    expect(status(ALFA, 'portal_pendencia_geral')).toBe('resolved')
  })

  it('B/L pago com Invoice de Demurrage em aberto continua contando até a Invoice fechar', () => {
    psql(`INSERT INTO public.bls (id, voyage_id, customer_id, pol, pod, financial_status)
      VALUES ('BL350BETA', ${VOYAGE}, ${BETA}, 'CNSHA', 'BRVIX', 'invoiced');
      SET session_replication_role = replica;
      INSERT INTO public.demurrage_invoices (doc_number, bl_id, customer_id, total_usd, status)
      VALUES ('DEM-350-BETA', 'BL350BETA', ${BETA}, 100, 'issued');
      SET session_replication_role = origin;`)
    psql(`UPDATE public.bls SET financial_status = 'paid' WHERE id = 'BL350BETA';`)
    expect(status(BETA, 'portal_pendencia_geral')).toBe('active')

    psql(`UPDATE public.demurrage_invoices SET status = 'cancelled' WHERE doc_number = 'DEM-350-BETA';`)
    expect(status(BETA, 'portal_pendencia_geral')).toBe('resolved')
  })

  it('o console de Provisionamento usa o mesmo processo ativo', () => {
    const activeProcess = (customerId: number) => psql(`SELECT public.customer_has_active_portal_process(${customerId});`)
    expect(activeProcess(ALFA)).toBe('f')
    expect(activeProcess(BETA)).toBe('f')
    const definition = psql(`SELECT pg_get_functiondef('public.portal_list_provisioning_console(bigint)'::regprocedure);`)
    expect(definition).toContain("'has_active_process', public.customer_has_active_portal_process(c.id)")
  })

  it('conta, e-mail e lista de bloqueio fecham os alertas na hora', () => {
    psql(`INSERT INTO public.bls (id, voyage_id, customer_id, pol, pod, financial_status)
      VALUES ('BL350GAMA', ${VOYAGE}, ${GAMA}, 'CNSHA', 'BRVIX', 'pending');
      INSERT INTO public.customer_portal_accounts (customer_id) VALUES (${GAMA}) ON CONFLICT (customer_id) DO NOTHING;
      UPDATE public.customer_portal_accounts
         SET active = true, account_situation = 'ativo', auth_user_id = '${PORTAL_USER}',
             recovery_email = '${EMAIL}', recovery_email_status = 'ok'
       WHERE customer_id = ${GAMA};`)
    // Conta ativada: a pendência geral fecha na hora.
    expect(items(GAMA)).toBe('portal_pendencia_geral=resolved')

    // O endereço entra na lista de bloqueio: abre na hora; liberar fecha na hora.
    psql(`INSERT INTO public.portal_suppressed_emails (email, reason, suppressed_at) VALUES ('${EMAIL}', 'bounce_permanente', now());`)
    expect(status(GAMA, 'portal_email_suprimido')).toBe('active')
    expect(status(GAMA, 'portal_pendencia_geral')).toBe('active')
    psql(`DELETE FROM public.portal_suppressed_emails WHERE email = '${EMAIL}';`)
    expect(status(GAMA, 'portal_email_suprimido')).toBe('resolved')
    expect(status(GAMA, 'portal_pendencia_geral')).toBe('resolved')

    // Bounce no status da conta e correção do e-mail de recuperação.
    psql(`UPDATE public.customer_portal_accounts SET recovery_email_status = 'bounce_permanente' WHERE customer_id = ${GAMA};`)
    expect(status(GAMA, 'portal_email_suprimido')).toBe('active')
    psql(`UPDATE public.customer_portal_accounts SET recovery_email = 'novo-${EMAIL}', recovery_email_status = 'ok' WHERE customer_id = ${GAMA};`)
    expect(status(GAMA, 'portal_email_suprimido')).toBe('resolved')

    // Status 'ok' com o endereço ainda na lista de bloqueio: continua aberto.
    // O gatilho antigo da 002 fechava pelo status e só o detector reabria.
    psql(`INSERT INTO public.portal_suppressed_emails (email, reason, suppressed_at) VALUES ('novo-${EMAIL}', 'complaint', now());`)
    expect(status(GAMA, 'portal_email_suprimido')).toBe('active')
    psql(`UPDATE public.customer_portal_accounts SET recovery_email_status = 'bounce_permanente' WHERE customer_id = ${GAMA};
      UPDATE public.customer_portal_accounts SET recovery_email_status = 'ok' WHERE customer_id = ${GAMA};`)
    expect(status(GAMA, 'portal_email_suprimido')).toBe('active')
    psql(`DELETE FROM public.portal_suppressed_emails WHERE email = 'novo-${EMAIL}';`)
    expect(status(GAMA, 'portal_email_suprimido')).toBe('resolved')
  })

  it('convite expirado pelo job abre só com processo ativo e sem a linha antiga', () => {
    psql(`
      UPDATE public.customer_portal_accounts
         SET active = false, account_situation = 'convite_pendente', auth_user_id = NULL
       WHERE customer_id = ${GAMA};
      INSERT INTO public.customer_portal_accounts (customer_id) VALUES (${ALFA}) ON CONFLICT (customer_id) DO NOTHING;
      UPDATE public.customer_portal_accounts SET account_situation = 'convite_pendente' WHERE customer_id = ${ALFA};
      INSERT INTO public.portal_invites (account_id, purpose, status, expires_at, token_hash, sent_to_email)
      SELECT id, 'convite', 'pendente', now() - interval '1 hour', md5(random()::text), 'convite350@cliente.test'
      FROM public.customer_portal_accounts
      WHERE customer_id IN (${GAMA}, ${ALFA});`)
    const run = spawnPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c',
      'SELECT public.portal_mark_expired_invites();'], { encoding: 'utf8' })
    expect(run.stderr).toBe('')
    // Gama tem B/L a pagar: abre. Alfa só tem B/L pago e cancelado: não abre.
    expect(status(GAMA, 'portal_convite_expirado')).toBe('active')
    expect(status(ALFA, 'portal_convite_expirado')).toBe('nenhum')
    expect(psql(`SELECT count(*) FROM public.alerts WHERE type = 'portal_convite_expirado'
      AND entity_id IN ('${ALFA}', '${GAMA}');`)).toBe('0')

    // Gama paga o B/L: os alertas do Portal fecham na hora.
    psql(`UPDATE public.bls SET financial_status = 'paid' WHERE id = 'BL350GAMA';`)
    expect(status(GAMA, 'portal_convite_expirado')).toBe('resolved')
    expect(status(GAMA, 'portal_pendencia_geral')).toBe('resolved')
  })
})
