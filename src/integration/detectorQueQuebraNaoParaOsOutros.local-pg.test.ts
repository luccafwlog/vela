import { execPsql } from './localPsql'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { describeWithProbe, syntheticCnpj } from './localTestData'

// Migration 351 (revisão dos alertas de 2026-10-21, docs/revisao-alertas-2026-10.md;
// achado A1 e decisão P5): um detector que quebra não desfaz a rodada. Antes, a
// exceção de um detector desfazia os oito e `run_alert_detectors` devolvia erro:
// nenhum alerta abria nem fechava (VELA-24/25).

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const ADMIN_ID = '35100000-0000-4000-8000-0000000000a1'
const CARRIER_ID = 99351001
const VESSEL_ID = 99351002
const VOYAGE_ID = 99351003
const CUSTOMER_ID = 99351004
const BL_PORTAL = 'A351-PORTAL'
const BL_REVIEW = 'A351-REVISAO'
const CONSIGNEE = 'CONSIGNATARIO A351'
const STALE_CONSIGNEE = 'CONSIGNATARIO A351 SEM PENDENCIA'

function psql(sql: string): string {
  return execPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', sql], {
    encoding: 'utf8',
  }).trim()
}

function runnerExists(): boolean {
  if (!enabled) return false
  try {
    return psql(`SELECT to_regprocedure('public.run_alert_detectors()') IS NOT NULL;`) === 't'
  } catch {
    return false
  }
}

const describeLocal = describeWithProbe(runnerExists, 'run_alert_detectors')

function itemStatus(itemType: string, entityId: string): string {
  return `COALESCE((SELECT i.status FROM public.alert_items i JOIN public.alerts a ON a.id = i.alert_id
    WHERE i.item_type = '${itemType}' AND a.entity_type = 'customer' AND a.entity_id = '${entityId}'), 'sem item')`
}

function cleanup() {
  psql(`
    SET session_replication_role = replica;
    CREATE TEMP TABLE a351_alerts AS SELECT id FROM public.alerts
      WHERE entity_type = 'customer' AND entity_id IN ('${CUSTOMER_ID}', '${CONSIGNEE}', '${STALE_CONSIGNEE}');
    DELETE FROM public.alert_item_events WHERE alert_item_id IN (SELECT id FROM public.alert_items WHERE alert_id IN (SELECT id FROM a351_alerts));
    DELETE FROM public.alert_item_dismissals WHERE alert_item_id IN (SELECT id FROM public.alert_items WHERE alert_id IN (SELECT id FROM a351_alerts));
    DELETE FROM public.internal_notifications WHERE alert_id IN (SELECT id FROM a351_alerts);
    DELETE FROM public.alert_items WHERE alert_id IN (SELECT id FROM a351_alerts);
    DELETE FROM public.alerts WHERE id IN (SELECT id FROM a351_alerts);
    DELETE FROM public.bls WHERE id IN ('${BL_PORTAL}', '${BL_REVIEW}');
    DELETE FROM public.customers WHERE id = ${CUSTOMER_ID};
    DELETE FROM public.voyages WHERE id = ${VOYAGE_ID};
    DELETE FROM public.vessels WHERE id = ${VESSEL_ID};
    DELETE FROM public.carriers WHERE id = ${CARRIER_ID};
    DELETE FROM public.audit_logs WHERE changed_by = '${ADMIN_ID}';
    DELETE FROM public.user_profiles WHERE id = '${ADMIN_ID}';
    DELETE FROM auth.users WHERE id = '${ADMIN_ID}';
    SET session_replication_role = origin;
  `)
}

describeLocal('351 — um detector que quebra não para os outros', () => {
  beforeAll(() => {
    cleanup()
    // Gatilhos desligados: os alertas abaixo só abrem ou fecham pela rodada.
    psql(`
      INSERT INTO auth.users (id, email, aud, role) VALUES ('${ADMIN_ID}', 'adm351@test.local', 'authenticated', 'authenticated');
      INSERT INTO public.user_profiles (id, full_name, role, active) VALUES ('${ADMIN_ID}', 'Administrativo 351', 'administrativo', true);
      SET session_replication_role = replica;
      INSERT INTO public.carriers (id, name) VALUES (${CARRIER_ID}, 'Armador A351');
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (${VESSEL_ID}, 'Navio A351', ${CARRIER_ID});
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES (${VOYAGE_ID}, ${VESSEL_ID}, 'A351V', 'active');
      INSERT INTO public.customers (id, name, cnpj_cpf) VALUES (${CUSTOMER_ID}, 'CLIENTE A351 LTDA', '${syntheticCnpj(351004)}');
      -- Cliente com B/L vivo e sem conta no Portal: o detector do Portal abre a pendência.
      INSERT INTO public.bls (id, voyage_id, customer_id, pol, pod, cargo_mode, financial_status, charge_status, review_status)
      VALUES ('${BL_PORTAL}', ${VOYAGE_ID}, ${CUSTOMER_ID}, 'A351O', 'A351P', 'container', 'pending', 'calculated', 'ok');
      -- B/L em revisão sem Cliente: o detector da Revisão abre "B/L sem Cliente".
      INSERT INTO public.bls (id, voyage_id, consignee, pol, pod, cargo_mode, financial_status, charge_status, review_status)
      VALUES ('${BL_REVIEW}', ${VOYAGE_ID}, '${CONSIGNEE}', 'A351O', 'A351P', 'container', 'pending', 'calculated', 'pending_review');
      SET session_replication_role = origin;
    `)
    // Alerta de um consignatário que já não tem B/L pendente: a rodada fecha.
    psql(`BEGIN; SELECT set_config('request.jwt.claim.role', 'service_role', true);
      SELECT public.upsert_alert_item('review_customer_unlinked', 'customer', '${STALE_CONSIGNEE}',
        'B/L sem Cliente (teste 351)', 'teste_351', '{}'::jsonb, '/revisao');
      COMMIT;`)
  })

  afterAll(cleanup)

  it('o detector de viagem quebra; a Revisão e o Portal abrem e fecham os alertas deles', () => {
    // Tudo numa transação desfeita no fim: a redefinição do detector não vaza
    // para as suítes seguintes, nem se o teste falhar no meio.
    const [result, failures, review, stale, portal] = psql(`
      BEGIN;
      CREATE OR REPLACE FUNCTION public.detect_voyage_operation_alerts() RETURNS integer LANGUAGE plpgsql AS $fn$
      BEGIN
        RAISE EXCEPTION 'invalid input syntax for type date: "31/12/2026"' USING ERRCODE = '22007';
      END
      $fn$;
      SET LOCAL request.jwt.claim.role = 'service_role';
      CREATE TEMP TABLE a351_run ON COMMIT DROP AS SELECT public.run_alert_detectors() AS result;
      SELECT jsonb_build_object(
        'failed', result->'failed',
        'voyage_operation_alerts', result->'voyage_operation_alerts',
        'has_portal_result', result ? 'client_portal',
        'has_review_result', result->'bl_review_pendencies' IS NOT NULL AND result->'bl_review_pendencies' <> 'null'::jsonb
      ) FROM a351_run;
      SELECT f->>'detector' || ':' || (f->>'sqlstate') || ':' || (f->>'message')
        FROM a351_run, jsonb_array_elements(result->'failures') f
        WHERE f->>'detector' = 'detect_voyage_operation_alerts';
      SELECT ${itemStatus('review_customer_unlinked', CONSIGNEE)};
      SELECT ${itemStatus('review_customer_unlinked', STALE_CONSIGNEE)};
      SELECT ${itemStatus('portal_pendencia_geral', String(CUSTOMER_ID))};
      ROLLBACK;
    `).split('\n')

    // Antes da 351 a rodada inteira levantava o 22007 e nada abaixo acontecia.
    expect(JSON.parse(result)).toMatchObject({
      voyage_operation_alerts: null,
      has_portal_result: true,
      has_review_result: true,
    })
    // Outras suítes deixam dado que nenhum detector quebra hoje; o detector de
    // viagem é o único que falha.
    expect(JSON.parse(result).failed).toBe(1)
    expect(failures).toBe('detect_voyage_operation_alerts:22007:invalid input syntax for type date: "31/12/2026"')
    // Detector anterior ao que quebrou: abriu um alerta e fechou outro.
    expect(review).toBe('active')
    expect(stale).toBe('resolved')
    // Detector posterior: abriu a pendência do Portal.
    expect(portal).toBe('active')
  })

  it('a redefinição do teste não ficou no banco', () => {
    expect(psql(`SELECT prosrc NOT LIKE '%31/12/2026%' FROM pg_proc
      WHERE oid = 'public.detect_voyage_operation_alerts()'::regprocedure;`)).toBe('t')
  })

  it('rodada sem falha devolve failed = 0 e lista vazia', () => {
    const run = psql(`BEGIN; SET LOCAL request.jwt.claim.role = 'service_role';
      SELECT (r->>'failed') || '|' || jsonb_array_length(r->'failures')
        FROM (SELECT public.run_alert_detectors() AS r) s;
      ROLLBACK;`)
    expect(run).toBe('0|0')
  })
})
