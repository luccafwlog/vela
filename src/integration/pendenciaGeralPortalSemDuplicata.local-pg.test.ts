import { readFileSync } from 'node:fs'
import { execPsql } from './localPsql'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { describeWithProbe, syntheticCnpj } from './localTestData'

// Migration 321: a pendência geral do Portal existe só como item agrupado do
// reconciliador; o job antigo, que abria um segundo alerta "Sem setor" para o
// mesmo Cliente, saiu.
const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const CARRIER_ID = 99321001
const VESSEL_ID = 99321002
const VOYAGE_ID = 99321003
const CUSTOMER_ID = 99321004
const BL_ID = 'A321-BL'
const MIGRATION = readFileSync(new URL('../../supabase/migrations/321_remove_job_pendencia_geral_portal_duplicada.sql', import.meta.url), 'utf8')

function psql(sql: string): string {
  return execPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c',
    `SET request.jwt.claim.role = 'service_role'; ${sql}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function openAlerts(): string {
  return psql(`SELECT string_agg(a.type || ':' || COALESCE(i.item_type, '-'), ',' ORDER BY a.type)
    FROM public.alerts a LEFT JOIN public.alert_items i ON i.alert_id = a.id AND i.status = 'active'
    WHERE a.entity_type = 'customer' AND a.entity_id = '${CUSTOMER_ID}' AND a.status <> 'closed'
      AND (a.type = 'portal_pendencia_geral' OR i.item_type = 'portal_pendencia_geral');`)
}

function cleanup() {
  psql(`
    SET session_replication_role = replica;
    CREATE TEMP TABLE a321_alerts AS SELECT id FROM public.alerts WHERE entity_type = 'customer' AND entity_id = '${CUSTOMER_ID}';
    DELETE FROM public.alert_item_events WHERE alert_item_id IN (SELECT id FROM public.alert_items WHERE alert_id IN (SELECT id FROM a321_alerts));
    DELETE FROM public.alert_item_dismissals WHERE alert_item_id IN (SELECT id FROM public.alert_items WHERE alert_id IN (SELECT id FROM a321_alerts));
    DELETE FROM public.internal_notifications WHERE alert_id IN (SELECT id FROM a321_alerts);
    DELETE FROM public.alert_items WHERE alert_id IN (SELECT id FROM a321_alerts);
    DELETE FROM public.alerts WHERE id IN (SELECT id FROM a321_alerts);
    DELETE FROM public.bls WHERE id = '${BL_ID}';
    DELETE FROM public.customers WHERE id = ${CUSTOMER_ID};
    DELETE FROM public.voyages WHERE id = ${VOYAGE_ID};
    DELETE FROM public.vessels WHERE id = ${VESSEL_ID};
    DELETE FROM public.carriers WHERE id = ${CARRIER_ID};
    SET session_replication_role = origin;
  `)
}

function migration321Applied(): boolean {
  if (!enabled) return false
  try {
    return psql(`SELECT count(*) FROM pg_proc WHERE proname = 'portal_refresh_general_pendencies';`) === '0'
  } catch {
    return false
  }
}

const describeLocal = describeWithProbe(migration321Applied, 'migration321Applied (pendência geral do Portal sem duplicata)')

describeLocal('321 — pendência geral do Portal sem alerta duplicado', () => {
  beforeAll(() => {
    cleanup()
    psql(`
      SET session_replication_role = replica;
      INSERT INTO public.carriers (id, name) VALUES (${CARRIER_ID}, 'Armador A321');
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (${VESSEL_ID}, 'Navio A321', ${CARRIER_ID});
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES (${VOYAGE_ID}, ${VESSEL_ID}, 'A321V', 'active');
      INSERT INTO public.customers (id, name, cnpj_cpf) VALUES (${CUSTOMER_ID}, 'CLIENTE A321 LTDA', '${syntheticCnpj(321004)}');
      INSERT INTO public.bls (id, voyage_id, customer_id, pol, pod, cargo_mode, financial_status, charge_status, review_status)
      VALUES ('${BL_ID}', ${VOYAGE_ID}, ${CUSTOMER_ID}, 'A321O', 'A321P', 'container', 'pending', 'calculated', 'ok');
      -- Alerta antigo que o job removido deixou aberto.
      INSERT INTO public.alerts (type, entity_type, entity_id, message, status)
      VALUES ('portal_pendencia_geral', 'customer', '${CUSTOMER_ID}', 'Alerta antigo A321', 'open');
      SET session_replication_role = origin;
    `)
  })
  afterAll(cleanup)

  it('o job sai, o alerta antigo fecha e o reconciliador deixa um único agrupado', () => {
    psql(MIGRATION)
    psql('SELECT public.reconcile_client_portal_alerts();')
    psql('SELECT public.reconcile_client_portal_alerts();')

    expect(openAlerts()).toBe('aggregate:portal_pendencia_geral')
    expect(psql(`SELECT count(*) FROM pg_namespace n JOIN pg_class c ON c.relnamespace = n.oid
      WHERE n.nspname = 'cron' AND c.relname = 'job'`) === '0'
      || psql(`SELECT count(*) FROM cron.job WHERE jobname = 'portal-refresh-general-pendencies'`) === '0').toBe(true)
  })
})
