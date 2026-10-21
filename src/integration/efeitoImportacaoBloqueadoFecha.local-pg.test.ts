import { readFileSync } from 'node:fs'
import { execPsql, spawnPsql } from './localPsql'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { describeWithProbe } from './localTestData'

// Migration 348 (revisão dos alertas de 2026-10-21, docs/revisao-alertas-2026-10.md;
// L8 do estudo de 2026-10-20): o alerta "Efeito de importação bloqueado" fecha
// quando o efeito sai de bloqueado (reabertura pelo operador, conclusão ou
// descarte) e reabre com nova ocorrência se o efeito bloquear de novo; o
// acerto da migration fecha os itens de efeitos que já tinham saído.

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

function psql(sql: string) {
  return execPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', sql], {
    encoding: 'utf8',
  }).trim()
}

function migrationApplied() {
  if (!enabled) return false
  try {
    return psql(`SELECT to_regprocedure('public.resolve_import_effect_blocked_alert_on_exit()') IS NOT NULL;`) === 't'
  } catch {
    return false
  }
}

const describeLocal = describeWithProbe(migrationApplied, 'migration 348 (resolve_import_effect_blocked_alert_on_exit)')

const ADMIN_ID = '34800000-0000-4000-8000-0000000000a1'
const ENTITY = 'BL348-EFEITO'

function asAdmin(sql: string) {
  return spawnPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', `
    BEGIN;
    SELECT set_config('request.jwt.claims', '{"sub":"${ADMIN_ID}","role":"authenticated"}', true);
    SET LOCAL ROLE authenticated;
    ${sql}
    COMMIT;
  `], { encoding: 'utf8' })
}

function asServer(sql: string) {
  return psql(`BEGIN; SELECT set_config('request.jwt.claim.role', 'service_role', true); ${sql}; COMMIT;`)
}

let effectId = ''

function block() {
  // O executor marca o efeito como bloqueado e abre o alerta (process_import_effect).
  psql(`UPDATE public.import_pending_effects SET status = 'blocked', last_error_code = 'teste_348' WHERE id = ${effectId};`)
  asServer(`SELECT public._record_import_effect_blocked_alert(${effectId}, 'local_billing', '${ENTITY}', 'teste_348', 'falha de teste')`)
}

function alertStatus() {
  return psql(`SELECT COALESCE((SELECT i.status FROM public.alert_items i JOIN public.alerts a ON a.id = i.alert_id
    WHERE i.item_type = 'import_effect_blocked' AND a.entity_type = 'import_effect' AND a.entity_id = '${effectId}'), 'sem item');`)
}

function openedEvents() {
  return psql(`SELECT count(*) FROM public.alert_item_events e JOIN public.alert_items i ON i.id = e.alert_item_id
    JOIN public.alerts a ON a.id = i.alert_id
    WHERE i.item_type = 'import_effect_blocked' AND a.entity_id = '${effectId}' AND e.event_type = 'opened';`)
}

function cleanup() {
  psql(`DELETE FROM public.alerts WHERE entity_type = 'import_effect'
    AND entity_id IN (SELECT id::text FROM public.import_pending_effects WHERE entity_id = '${ENTITY}');`)
  psql(`
    SET session_replication_role = replica;
    DELETE FROM public.import_effect_attempts WHERE effect_id IN (SELECT id FROM public.import_pending_effects WHERE entity_id = '${ENTITY}');
    DELETE FROM public.import_pending_effects WHERE entity_id = '${ENTITY}';
    DELETE FROM public.audit_logs WHERE changed_by = '${ADMIN_ID}';
    DELETE FROM public.user_profiles WHERE id = '${ADMIN_ID}';
    DELETE FROM auth.users WHERE id = '${ADMIN_ID}';
    SET session_replication_role = origin;
  `)
}

describeLocal('348 — efeito de importação bloqueado fecha quando o efeito sai de bloqueado', () => {
  beforeAll(() => {
    cleanup()
    psql(`
      INSERT INTO auth.users (id, email, aud, role) VALUES ('${ADMIN_ID}', 'adm348@test.local', 'authenticated', 'authenticated');
      INSERT INTO public.user_profiles (id, full_name, role, active) VALUES ('${ADMIN_ID}', 'Administrativo 348', 'administrativo', true);
      SET session_replication_role = replica;
      INSERT INTO public.import_pending_effects (source_action_id, effect_kind, entity_id, created_by)
      VALUES (gen_random_uuid(), 'local_billing', '${ENTITY}', '${ADMIN_ID}');
      SET session_replication_role = origin;
    `)
    effectId = psql(`SELECT id FROM public.import_pending_effects WHERE entity_id = '${ENTITY}';`)
  })

  afterAll(cleanup)

  it('reabrir o efeito com justificativa fecha o alerta', () => {
    block()
    expect(alertStatus()).toBe('active')
    const run = asAdmin(`SELECT public.retry_import_effect(${effectId}, 'conferido no teste 348');`)
    expect(run.stderr).toBe('')
    // Antes: o efeito voltava para a fila e o alerta ficava aberto para sempre.
    expect(alertStatus()).toBe('resolved')
  })

  it('bloquear de novo reabre com nova ocorrência; descartar fecha', () => {
    block()
    expect(alertStatus()).toBe('active')
    expect(openedEvents()).toBe('2')
    psql(`UPDATE public.import_pending_effects SET status = 'superseded' WHERE id = ${effectId};`)
    expect(alertStatus()).toBe('resolved')
  })
  it('o acerto da migration fecha o item de efeito que já tinha saído de bloqueado', () => {
    block()
    // Estado de antes da 348: o efeito foi reaberto sem o gatilho que fecha.
    psql(`SET session_replication_role = replica;
      UPDATE public.import_pending_effects SET status = 'retry_wait' WHERE id = ${effectId};
      SET session_replication_role = origin;`)
    expect(alertStatus()).toBe('active')
    const sql = readFileSync('supabase/migrations/348_efeito_de_importacao_bloqueado_fecha_ao_sair_de_bloqueado.sql', 'utf8')
    psql(sql.slice(sql.indexOf('-- Acerto dos alertas já abertos (depende')))
    expect(alertStatus()).toBe('resolved')
  })
})
