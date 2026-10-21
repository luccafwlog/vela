import { execPsql } from './localPsql'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { describeWithProbe, syntheticCnpj } from './localTestData'

// Migration 353 (revisão dos alertas de 2026-10-21, docs/revisao-alertas-2026-10.md):
// alertas que só fechavam na rodada de 15 minutos fecham na hora do fato. Cada
// caso abre o alerta (detector ou reconciliação) e depois grava só o fato, sem
// rodar o detector: antes da 353 o item continuava 'active' (menos em B/Ls
// esperados; ver o caso).
const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const CARRIER_ID = 99353001
const VESSEL_ID = 99353002
const VOYAGE_ID = 99353003
const VOYAGE_ETA = 99353004
const VOYAGE_POL = 99353005
const PORT_ID = 99353006
const PORT = 'BRQ53'
const PORT_ETA = 'BRQ54'
const CUSTOMER = 99353011
const CONTACT = 99353021
const CONTACT_EMAIL = 'docs-r353@example.test'
const TERMINAL = '35335300-0000-4000-8000-0000000000a1'
const TERMINAL_CODE = 'T353A'
const BERTH = '35335300-0000-4000-8000-0000000000b1'
const BL = 'B353-SOLTA'
const BL_ETA = 'B353-ETA'
const BL_POL = 'B353-POL'
const OPERATOR_ID = '00000000-0000-4000-8000-000000353002'
const USER_ID = '00000000-0000-4000-8000-000000353001'
const USER_EMAIL = 'r353-usuario@example.test'
const USER_EMAIL_NEW = 'r353-usuario-novo@example.test'

function psql(sql: string, sub?: string): string {
  const claims = sub
    ? `SET request.jwt.claim.sub = '${sub}'; SET request.jwt.claim.role = 'authenticated';`
    : `SET request.jwt.claim.role = 'service_role';`
  return execPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c',
    `${claims} ${sql}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function itemStatus(type: string, entityType: string, entityId: string): string {
  return psql(`SELECT COALESCE((SELECT i.status FROM public.alert_items i JOIN public.alerts a ON a.id = i.alert_id
    WHERE i.item_type = '${type}' AND a.entity_type = '${entityType}' AND a.entity_id = '${entityId}'
    ORDER BY i.id DESC LIMIT 1), 'none');`)
}

function deliver(kind: string, voyageId: number, port: string, berth: string | null, bl: string, key: string): void {
  const id = psql(`SELECT public.create_customer_communication_atomic(${CUSTOMER}, '${kind}', 'avisos_operacionais',
    ${voyageId}, '${port}', ${berth ? `'${berth}'` : 'NULL'}, NULL, 0, NULL, NULL, NULL, ${berth ? `'${TERMINAL_CODE}'` : 'NULL'}, NULL, ARRAY['${bl}']::text[]);`)
  psql(`INSERT INTO public.customer_communication_attempts
      (communication_id, recipient_masked, recipient_key, status, provider_message_id, idempotency_key, dispatch_mode)
    VALUES (${id}, 'd***@e***.test', public.customer_communication_recipient_key('${CONTACT_EMAIL}'), 'aceito',
      'prov-${key}', 'r353:${key}', 'real');`)
}

function cleanup() {
  psql(`
    SET session_replication_role = replica;
    CREATE TEMP TABLE r353_alerts AS SELECT id FROM public.alerts
      WHERE (entity_type LIKE 'voyage%' AND (entity_id IN ('${VOYAGE_ID}', '${VOYAGE_ETA}', '${VOYAGE_POL}')
          OR entity_id LIKE '${VOYAGE_ID}::%' OR entity_id LIKE '${VOYAGE_ETA}::%' OR entity_id LIKE '${VOYAGE_POL}::%'))
         OR (entity_type = 'customer' AND entity_id = '${CUSTOMER}')
         OR (entity_type = 'user_profile' AND entity_id = '${USER_ID}');
    DELETE FROM public.alert_item_events WHERE alert_item_id IN (SELECT id FROM public.alert_items WHERE alert_id IN (SELECT id FROM r353_alerts));
    DELETE FROM public.internal_notifications WHERE alert_id IN (SELECT id FROM r353_alerts);
    DELETE FROM public.alert_items WHERE alert_id IN (SELECT id FROM r353_alerts);
    DELETE FROM public.alerts WHERE id IN (SELECT id FROM r353_alerts);
    DELETE FROM public.customer_communication_automation_claims WHERE claim_key LIKE '%:${CUSTOMER}:%';
    DELETE FROM public.customer_communication_attempts WHERE idempotency_key LIKE 'r353:%';
    DELETE FROM public.customer_communication_bls WHERE bl_id IN ('${BL}', '${BL_ETA}', '${BL_POL}');
    DELETE FROM public.customer_communications WHERE customer_id = ${CUSTOMER};
    DELETE FROM public.customer_contact_box_links WHERE contact_id = ${CONTACT};
    DELETE FROM public.customer_contacts WHERE customer_id = ${CUSTOMER};
    DELETE FROM public.audit_logs WHERE entity_id IN ('${BL}', '${BL_ETA}', '${BL_POL}') OR changed_by IN ('${USER_ID}', '${OPERATOR_ID}')
      OR (entity_type IN ('voyage_pod_schedule', 'voyage_pol_schedule')
        AND (entity_id LIKE '${VOYAGE_ID}::%' OR entity_id LIKE '${VOYAGE_ETA}::%' OR entity_id LIKE '${VOYAGE_POL}::%'));
    DELETE FROM public.bls WHERE id IN ('${BL}', '${BL_ETA}', '${BL_POL}');
    DELETE FROM public.voyage_escala_operation_fronts WHERE voyage_id = ${VOYAGE_ID};
    DELETE FROM public.voyage_escala_terminal_state WHERE voyage_id = ${VOYAGE_ID};
    DELETE FROM public.depots WHERE id = '${TERMINAL}';
    DELETE FROM public.customers WHERE id = ${CUSTOMER};
    DELETE FROM public.voyages WHERE id IN (${VOYAGE_ID}, ${VOYAGE_ETA}, ${VOYAGE_POL});
    DELETE FROM public.vessels WHERE id = ${VESSEL_ID};
    DELETE FROM public.carriers WHERE id = ${CARRIER_ID};
    DELETE FROM public.ports WHERE id = ${PORT_ID};
    DELETE FROM public.portal_suppressed_emails WHERE email IN ('${USER_EMAIL}', '${USER_EMAIL_NEW}');
    DELETE FROM public.customer_communication_suppressions WHERE email IN ('${USER_EMAIL}', '${USER_EMAIL_NEW}');
    DELETE FROM public.user_profiles WHERE id IN ('${USER_ID}', '${OPERATOR_ID}');
    DELETE FROM auth.users WHERE id IN ('${USER_ID}', '${OPERATOR_ID}');
    SET session_replication_role = origin;
  `)
}

function migration353Applied(): boolean {
  if (!enabled) return false
  try {
    return psql(`SELECT to_regprocedure('public.resolve_customer_communication_pending_alerts(bigint, text, uuid, text)') IS NOT NULL;`) === 't'
  } catch {
    return false
  }
}

const describeLocal = describeWithProbe(migration353Applied, 'migration353Applied (alertas fecham na hora do fato)')

describeLocal('353 — alertas fecham na hora do fato, sem esperar o detector', () => {
  beforeAll(() => {
    cleanup()
    psql(`
      SET session_replication_role = replica;
      INSERT INTO public.ports (id, name, locode) VALUES (${PORT_ID}, 'Porto R353', '${PORT}');
      INSERT INTO public.depots (id, code, name, tipo, port_id) VALUES ('${TERMINAL}', '${TERMINAL_CODE}', 'Terminal R353', 'terminal_portuario', ${PORT_ID});
      INSERT INTO public.carriers (id, name) VALUES (${CARRIER_ID}, 'Armador R353');
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (${VESSEL_ID}, 'Navio R353', ${CARRIER_ID});
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES
        (${VOYAGE_ID}, ${VESSEL_ID}, 'R353V', 'active'),
        (${VOYAGE_ETA}, ${VESSEL_ID}, 'R353E', 'active'),
        (${VOYAGE_POL}, ${VESSEL_ID}, 'R353P', 'active');
      INSERT INTO public.customers (id, name, cnpj_cpf) VALUES (${CUSTOMER}, 'CLIENTE R353', '${syntheticCnpj(353011)}');
      INSERT INTO public.customer_contacts (id, customer_id, name, email, is_primary) VALUES
        (${CONTACT}, ${CUSTOMER}, 'Contato R353', '${CONTACT_EMAIL}', true);
      INSERT INTO public.customer_contact_box_links (contact_id, box_code) VALUES (${CONTACT}, 'documentacao_operacao');
      INSERT INTO public.voyage_escala_terminal_state (id, voyage_id, port, port_id, terminal_id, terminal_atb)
      VALUES ('${BERTH}', ${VOYAGE_ID}, '${PORT}', ${PORT_ID}, '${TERMINAL}', now() - interval '2 days');
      INSERT INTO public.voyage_escala_operation_fronts (voyage_id, port, port_id, terminal_id, sentido, modalidade, source) VALUES
        (${VOYAGE_ID}, '${PORT}', ${PORT_ID}, '${TERMINAL}', 'importacao', 'carga_solta', 'operational_data');
      INSERT INTO public.bls (id, voyage_id, customer_id, pol, pod, cargo_mode, financial_status, charge_status, review_status) VALUES
        ('${BL}', ${VOYAGE_ID}, ${CUSTOMER}, 'CNSHA', '${PORT}', 'carga_solta', 'pending', 'calculated', 'ok'),
        ('${BL_ETA}', ${VOYAGE_ETA}, ${CUSTOMER}, 'CNSHA', '${PORT_ETA}', 'carga_solta', 'pending', 'calculated', 'ok'),
        ('${BL_POL}', ${VOYAGE_POL}, ${CUSTOMER}, 'CNSHA', 'BRSSZ', 'carga_solta', 'pending', 'calculated', 'ok');
      -- ETA daqui a 2 dias: NOA devido. ATB de 2 dias atrás: NOB devido.
      INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_at) VALUES
        ('voyage_pod_schedule', '${VOYAGE_ID}::${PORT}', 'eta', NULL, to_char(now() + interval '2 days', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), now() - interval '1 hour'),
        ('voyage_pod_schedule', '${VOYAGE_ETA}::${PORT_ETA}', 'eta', NULL, to_char(now() + interval '2 days', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), now() - interval '1 hour'),
        ('voyage_pod_schedule', '${VOYAGE_POL}::BRSSZ', 'eta', NULL, to_char(now() + interval '2 days', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), now() - interval '1 hour');
      SET session_replication_role = origin;
      -- O auth.users local é um esboço; monitoramentoDosEmails.local-pg faz o mesmo.
      INSERT INTO auth.users (id, email) VALUES ('${USER_ID}', '${USER_EMAIL}'), ('${OPERATOR_ID}', 'r353-operacoes@example.test');
      INSERT INTO public.user_profiles (id, full_name, role, active) VALUES
        ('${USER_ID}', 'R353 Usuário', 'documentacao', true),
        ('${OPERATOR_ID}', 'R353 Operações', 'operacoes', true);
    `)
    psql(`SELECT public.detect_customer_communication_alerts();`)
  })
  afterAll(cleanup)

  it('NOA pendente fecha quando o NOA é entregue; o NOB da mesma escala continua', () => {
    expect(itemStatus('comunicado_noa_pendente', 'voyage_pod_schedule', `${VOYAGE_ID}::${PORT}`)).toBe('active')
    expect(itemStatus('comunicado_nob_pendente', 'voyage_escala_terminal', `${VOYAGE_ID}::${PORT}::${TERMINAL_CODE}`)).toBe('active')
    deliver('aviso_chegada_noa', VOYAGE_ID, PORT, null, BL, 'noa')
    expect(itemStatus('comunicado_noa_pendente', 'voyage_pod_schedule', `${VOYAGE_ID}::${PORT}`)).toBe('resolved')
    expect(itemStatus('comunicado_nob_pendente', 'voyage_escala_terminal', `${VOYAGE_ID}::${PORT}::${TERMINAL_CODE}`)).toBe('active')
  })

  it('NOB pendente fecha quando o NOB da Atracação é entregue', () => {
    deliver('aviso_atracacao_nob', VOYAGE_ID, PORT, BERTH, BL, 'nob')
    expect(itemStatus('comunicado_nob_pendente', 'voyage_escala_terminal', `${VOYAGE_ID}::${PORT}::${TERMINAL_CODE}`)).toBe('resolved')
  })

  it('NOA pendente fecha quando o ETA da escala sai da janela de 5 dias', () => {
    expect(itemStatus('comunicado_noa_pendente', 'voyage_pod_schedule', `${VOYAGE_ETA}::${PORT_ETA}`)).toBe('active')
    psql(`INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_at) VALUES
      ('voyage_pod_schedule', '${VOYAGE_ETA}::${PORT_ETA}', 'eta', NULL, to_char(now() + interval '10 days', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), now());`)
    expect(itemStatus('comunicado_noa_pendente', 'voyage_pod_schedule', `${VOYAGE_ETA}::${PORT_ETA}`)).toBe('resolved')
  })

  // Este já fechava na hora antes da 353 (audit do POL → snapshot da viagem →
  // audit `voyages` → reconciliação da viagem, 341); o relatório o listava como
  // só do detector. O caso fica como guarda desse caminho.
  it('B/Ls esperados fecha quando o ETD do porto de origem sem B/L sai do planejamento', () => {
    // POL CNNGB planejado (ETD) e sem B/L: a viagem em D-7 fica sem os B/Ls
    // esperados. Quem grava o ETD é a pessoa na aba Rotas e Manifestos.
    psql(`INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at) VALUES
      ('voyage_pol_schedule', '${VOYAGE_POL}::CNNGB', 'etd', NULL, '2026-10-10', '${OPERATOR_ID}', now() - interval '1 minute');
      SELECT public.reconcile_voyage_bl_expected_alerts(${VOYAGE_POL}, 'teste_353');`, OPERATOR_ID)
    expect(itemStatus('voyage_bl_expected', 'voyage', String(VOYAGE_POL))).toBe('active')
    psql(`INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at) VALUES
      ('voyage_pol_schedule', '${VOYAGE_POL}::CNNGB', 'etd', '2026-10-10', '', '${OPERATOR_ID}', now());`, OPERATOR_ID)
    expect(itemStatus('voyage_bl_expected', 'voyage', String(VOYAGE_POL))).toBe('resolved')
  })

  it('e-mail devolvido fecha quando a supressão sai', () => {
    psql(`INSERT INTO public.portal_suppressed_emails (email, reason) VALUES ('${USER_EMAIL}', 'bounce_permanente');
      SELECT public.detect_email_monitoring_alerts();`)
    expect(itemStatus('usuario_email_devolvido', 'user_profile', USER_ID)).toBe('active')
    psql(`DELETE FROM public.portal_suppressed_emails WHERE email = '${USER_EMAIL}';`)
    expect(itemStatus('usuario_email_devolvido', 'user_profile', USER_ID)).toBe('resolved')
  })

  it('e-mail devolvido fecha quando o e-mail é salvo em Editar acesso, mesmo com o antigo suprimido por ser de Cliente', () => {
    psql(`INSERT INTO public.customer_communication_suppressions (email, reason) VALUES ('${USER_EMAIL}', 'complaint');
      SELECT public.detect_email_monitoring_alerts();`)
    expect(itemStatus('usuario_email_devolvido', 'user_profile', USER_ID)).toBe('active')
    // O endereço antigo também é contato de Cliente: a RPC não o libera.
    psql(`UPDATE public.customer_contacts SET email = '${USER_EMAIL}' WHERE id = ${CONTACT};`)
    try {
      // O que a Edge admin-users faz: grava o e-mail novo no Auth e chama a RPC.
      psql(`UPDATE auth.users SET email = '${USER_EMAIL_NEW}' WHERE id = '${USER_ID}';`)
      expect(psql(`SELECT public.release_internal_user_email_suppression('${USER_EMAIL}');`)).toBe('0')
      expect(psql(`SELECT count(*) FROM public.customer_communication_suppressions WHERE email = '${USER_EMAIL}';`)).toBe('1')
      expect(itemStatus('usuario_email_devolvido', 'user_profile', USER_ID)).toBe('resolved')
    } finally {
      psql(`UPDATE public.customer_contacts SET email = '${CONTACT_EMAIL}' WHERE id = ${CONTACT};
        UPDATE auth.users SET email = '${USER_EMAIL}' WHERE id = '${USER_ID}';`)
    }
  })

  it('e-mail devolvido fecha quando o usuário é desativado', () => {
    psql(`SELECT public.detect_email_monitoring_alerts();`)
    expect(itemStatus('usuario_email_devolvido', 'user_profile', USER_ID)).toBe('active')
    psql(`UPDATE public.user_profiles SET active = false WHERE id = '${USER_ID}';`)
    expect(itemStatus('usuario_email_devolvido', 'user_profile', USER_ID)).toBe('resolved')
  })

  it('provedor sem retorno fecha quando chega o primeiro evento novo', () => {
    // Numa transação desfeita, como em monitoramentoDosEmails: o detector olha o
    // último evento da tabela inteira e as tentativas dos últimos 7 dias.
    const silentAlert = `SELECT COALESCE((SELECT i.status FROM public.alert_items i JOIN public.alerts a ON a.id = i.alert_id
      WHERE i.item_type = 'email_retorno_provedor_silencioso' AND a.entity_type = 'email_provider' AND a.entity_id = 'webhook'
      ORDER BY i.id DESC LIMIT 1), 'none');`
    const output = psql(`BEGIN;
      SET LOCAL vela.retention = 'on';
      DELETE FROM public.portal_email_event_attempts;
      DELETE FROM public.portal_email_events;
      SET LOCAL session_replication_role = replica;
      UPDATE public.portal_email_attempts SET created_at = created_at - interval '30 days' WHERE created_at >= now() - interval '7 days';
      UPDATE public.customer_communication_attempts SET created_at = created_at - interval '30 days' WHERE created_at >= now() - interval '7 days';
      SET LOCAL session_replication_role = origin;
      INSERT INTO public.portal_email_attempts (kind, idempotency_key, provider_message_id, recipient_masked, status, created_at, updated_at)
        VALUES ('convite', 'r353-s1', 'r353-msg-s1', 'r***@example.test', 'aceito', now() - interval '3 hours', now() - interval '3 hours'),
               ('convite', 'r353-s2', 'r353-msg-s2', 'r***@example.test', 'aceito', now() - interval '3 hours', now() - interval '3 hours'),
               ('convite', 'r353-s3', 'r353-msg-s3', 'r***@example.test', 'aceito', now() - interval '3 hours', now() - interval '3 hours');
      SELECT public.detect_email_monitoring_alerts() IS NOT NULL;
      ${silentAlert}
      INSERT INTO public.portal_email_events (provider_event_id, provider_message_id, event_type, payload, status, received_at)
        VALUES ('r353-evt-volta', 'r353-msg-outro', 'email.delivered', '{}'::jsonb, 'pending', now());
      ${silentAlert}
      ROLLBACK;`).split('\n')
    expect(output).toEqual(['t', 'active', 'resolved'])
  })
})
