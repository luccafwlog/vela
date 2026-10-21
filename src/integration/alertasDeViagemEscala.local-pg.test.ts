import { execPsql, spawnPsql } from './localPsql'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { describeWithProbe } from './localTestData'

// Migration 346 (revisão dos alertas de 2026-10-21, docs/revisao-alertas-2026-10.md):
// - a exportação pós-ATD é decidida pela escala, não por terminal, e não pisca
//   com dois terminais no porto;
// - escala omitida e manifesto de Granito vinculado fecham a exportação, também
//   na viagem concluída;
// - viagem cancelada fecha os alertas dela, e o detector varre a viagem não
//   ativa que ainda tem alerta aberto;
// - incluir e cancelar B/L reconciliam "B/Ls esperados" e "CE Mercante
//   pendente", com porto normalizado (BRVIT × BRVIX) e sem B/L cancelado;
// - a data do terminal na mensagem é a de Brasília.

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
    return psql(`SELECT to_regprocedure('public.reconcile_voyage_export_alerts(bigint,text)') IS NOT NULL;`) === 't'
  } catch {
    return false
  }
}

const describeLocal = describeWithProbe(migrationApplied, 'migration 346 (reconcile_voyage_export_alerts)')

const ADMIN_ID = '34600000-0000-4000-8000-0000000000a1'
const OPS_ID = '34600000-0000-4000-8000-0000000000b1'
const T1 = '34600000-0000-4000-8000-0000000000d1'
const T2 = '34600000-0000-4000-8000-0000000000d2'
const CARRIER_ID = 3460001
const VESSEL_ID = 3460002
const V_EXP = 3460011
const V_DONE = 3460012
const V_CANCEL = 3460013
const V_BL = 3460014
const VOYAGES = [V_EXP, V_DONE, V_CANCEL, V_BL]
const BL = 'BL346-VIT'
const BL_DEFERRED = 'BL346-ADIADO'

// Gravações como o usuário na sessão (gatilhos com auth.uid() do Administrativo).
function asAdmin(sql: string) {
  return psql(`
    SELECT set_config('request.jwt.claims', '{"sub":"${ADMIN_ID}","role":"authenticated"}', false);
    ${sql}
  `)
}

function asAdminRpc(sql: string) {
  const run = spawnPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', `
    BEGIN;
    SELECT set_config('request.jwt.claims', '{"sub":"${ADMIN_ID}","role":"authenticated"}', true);
    SET LOCAL ROLE authenticated;
    ${sql}
    COMMIT;
  `], { encoding: 'utf8' })
  return run
}

function item(type: string, entityType: string, entityId: string) {
  return psql(`SELECT COALESCE((SELECT i.status FROM public.alert_items i JOIN public.alerts a ON a.id = i.alert_id
    WHERE i.item_type = '${type}' AND a.entity_type = '${entityType}' AND a.entity_id = '${entityId}'), 'sem item');`)
}

function events(type: string, entityId: string) {
  return psql(`SELECT COALESCE(string_agg(e.event_type, ',' ORDER BY e.id), '') FROM public.alert_item_events e
    JOIN public.alert_items i ON i.id = e.alert_item_id JOIN public.alerts a ON a.id = i.alert_id
    WHERE i.item_type = '${type}' AND a.entity_id = '${entityId}';`)
}

function voyageKeys() {
  return VOYAGES.map((id) => `(a.entity_type LIKE 'voyage%' AND (a.entity_id = '${id}' OR a.entity_id LIKE '${id}::%'))`).join(' OR ')
}

function cleanup() {
  psql(`DELETE FROM public.alerts a WHERE ${voyageKeys()} OR (a.entity_type = 'customer' AND a.entity_id = 'CONSIGNEE 346');`)
  psql(`
    SET session_replication_role = replica;
    DELETE FROM public.granite_manifests WHERE voyage_id IN (${VOYAGES.join(', ')});
    DELETE FROM public.voyage_export_schedules WHERE voyage_id IN (${VOYAGES.join(', ')});
    DELETE FROM public.voyage_escala_terminal_state WHERE voyage_id IN (${VOYAGES.join(', ')});
    DELETE FROM public.charge_calculations WHERE bl_id IN ('${BL}', '${BL_DEFERRED}');
    DELETE FROM public.bls WHERE id IN ('${BL}', '${BL_DEFERRED}');
    DELETE FROM public.audit_logs WHERE changed_by IN ('${ADMIN_ID}', '${OPS_ID}')
      OR ${VOYAGES.map((id) => `entity_id = '${id}' OR entity_id LIKE '${id}::%'`).join(' OR ')} OR entity_id IN ('${BL}', '${BL_DEFERRED}');
    DELETE FROM public.voyages WHERE id IN (${VOYAGES.join(', ')});
    DELETE FROM public.vessels WHERE id = ${VESSEL_ID};
    DELETE FROM public.carriers WHERE id = ${CARRIER_ID};
    DELETE FROM public.depots WHERE id IN ('${T1}', '${T2}');
    DELETE FROM public.internal_notifications WHERE recipient_id IN ('${ADMIN_ID}', '${OPS_ID}');
    DELETE FROM public.user_profiles WHERE id IN ('${ADMIN_ID}', '${OPS_ID}');
    DELETE FROM auth.users WHERE id IN ('${ADMIN_ID}', '${OPS_ID}');
    SET session_replication_role = origin;
  `)
}

describeLocal('346 — alertas de viagem acompanham escala, B/L, manifestos e status', () => {
  beforeAll(() => {
    cleanup()
    psql(`
      INSERT INTO auth.users (id, email, aud, role) VALUES
        ('${ADMIN_ID}', 'adm346@test.local', 'authenticated', 'authenticated'),
        ('${OPS_ID}', 'ops346@test.local', 'authenticated', 'authenticated');
      INSERT INTO public.user_profiles (id, full_name, role, active) VALUES
        ('${ADMIN_ID}', 'Administrativo 346', 'administrativo', true),
        ('${OPS_ID}', 'Operações 346', 'operacoes', true);
      SET session_replication_role = replica;
      INSERT INTO public.depots (id, code, name, tipo, port_id)
      SELECT x.id::uuid, x.code, x.name, 'terminal_portuario', p.id
      FROM (VALUES ('${T1}', 'T346A', 'Terminal 346 A'), ('${T2}', 'T346B', 'Terminal 346 B')) AS x(id, code, name)
      CROSS JOIN (SELECT id FROM public.ports WHERE locode = 'BRSSZ' ORDER BY id LIMIT 1) p;
      INSERT INTO public.carriers (id, name) VALUES (${CARRIER_ID}, 'Carrier 346');
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (${VESSEL_ID}, 'Vessel 346', ${CARRIER_ID});
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES
        (${V_EXP}, ${VESSEL_ID}, 'V346E', 'active'),
        (${V_DONE}, ${VESSEL_ID}, 'V346D', 'completed'),
        (${V_CANCEL}, ${VESSEL_ID}, 'V346C', 'active'),
        (${V_BL}, ${VESSEL_ID}, 'V346B', 'active');
      -- Exportação de Granito em Santos nas duas viagens; nenhuma tem manifesto.
      INSERT INTO public.voyage_export_schedules (voyage_id, pol, tem_exportacao, has_granite, has_empty) VALUES
        (${V_EXP}, 'BRSSZ', true, true, false),
        (${V_DONE}, 'BRSSZ', true, true, false);
      -- V_EXP: o navio saiu do T1 (ATD) e ainda vai atracar no T2.
      INSERT INTO public.voyage_escala_terminal_state (voyage_id, port, port_id, terminal_id, terminal_etb, terminal_atb, terminal_atd)
      SELECT v.voyage_id, 'BRSSZ', d.port_id, d.id, v.etb, v.atb, v.atd
      FROM (VALUES
        (${V_EXP}, '${T1}'::uuid, now() - interval '3 days', now() - interval '3 days', now() - interval '2 days'),
        (${V_EXP}, '${T2}'::uuid, timestamptz '2026-10-01 22:30:00-03', NULL::timestamptz, NULL::timestamptz),
        (${V_DONE}, '${T1}'::uuid, now() - interval '3 days', now() - interval '3 days', now() - interval '2 days')
      ) AS v(voyage_id, terminal_id, etb, atb, atd)
      JOIN public.depots d ON d.id = v.terminal_id;
      SET session_replication_role = origin;
    `)
  })

  afterAll(cleanup)

  it('dois terminais: a exportação pós-ATD fica aberta e não pisca a cada rodada', () => {
    const scale = `${V_EXP}::BRSSZ`
    asAdmin(`SELECT public.reconcile_voyage_operation_alerts(${V_EXP}, 'teste_346');`)
    asAdmin(`SELECT public.reconcile_voyage_operation_alerts(${V_EXP}, 'teste_346');`)
    expect(item('voyage_export_after_atd', 'voyage_pod_schedule', scale)).toBe('active')
    // Antes: "opened,resolved,opened,resolved" e uma Notificação Interna por rodada.
    expect(events('voyage_export_after_atd', scale)).toBe('opened')
    expect(psql(`SELECT count(*) FROM public.internal_notifications n JOIN public.alert_items i ON i.id = n.alert_item_id
      WHERE n.recipient_id = '${OPS_ID}' AND i.item_type = 'voyage_export_after_atd';`)).toBe('1')
    expect(psql(`SELECT i.metadata->>'terminal_code' FROM public.alert_items i JOIN public.alerts a ON a.id = i.alert_id
      WHERE i.item_type = 'voyage_export_after_atd' AND a.entity_id = '${scale}';`)).toBe('T346A')
  })

  it('a data do terminal na mensagem é a de Brasília', () => {
    // ETB 01/10 22:30 em Brasília é 02/10 01:30 UTC.
    expect(psql(`SELECT i.message FROM public.alert_items i JOIN public.alerts a ON a.id = i.alert_id
      WHERE i.item_type = 'voyage_terminal_date_pending' AND a.entity_id = '${V_EXP}::BRSSZ::T346B';`))
      .toBe('Terminal T346B: ETB de 01/10/2026 passou sem ATB registrada.')
  })

  it('escala omitida fecha a exportação pela entidade da escala, e ela não reabre', () => {
    const scale = `${V_EXP}::BRSSZ`
    expect(item('voyage_export_after_atd', 'voyage_pod_schedule', scale)).toBe('active')
    // A omissão grava o audit da escala; o gatilho de audit reconcilia a escala.
    asAdmin(`INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by)
      VALUES ('voyage_pod_schedule', '${scale}', 'omitted', 'false', 'true', '${ADMIN_ID}');`)
    expect(item('voyage_export_after_atd', 'voyage_pod_schedule', scale)).toBe('resolved')
    asAdmin(`SELECT public.reconcile_voyage_operation_alerts(${V_EXP}, 'teste_346');`)
    expect(item('voyage_export_after_atd', 'voyage_pod_schedule', scale)).toBe('resolved')
  })

  it('viagem concluída: o detector reavalia o alerta aberto e o manifesto de Granito o fecha', () => {
    const scale = `${V_DONE}::BRSSZ`
    asAdmin(`SELECT public.reconcile_voyage_export_alerts(${V_DONE}, 'teste_346');`)
    expect(item('voyage_export_after_atd', 'voyage_pod_schedule', scale)).toBe('active')

    // A varredura do detector reavalia a viagem concluída: o planejamento sem
    // Granito (gravado sem gatilho) fecha o item; antes ela ficava de fora.
    psql(`SET session_replication_role = replica;
      UPDATE public.voyage_export_schedules SET has_granite = false WHERE voyage_id = ${V_DONE};
      SET session_replication_role = origin;`)
    asAdmin(`SELECT public.detect_voyage_operation_alerts();`)
    expect(item('voyage_export_after_atd', 'voyage_pod_schedule', scale)).toBe('resolved')

    // Planejamento volta a pedir Granito (gatilho reabre); vincular o manifesto fecha.
    asAdmin(`UPDATE public.voyage_export_schedules SET has_granite = true WHERE voyage_id = ${V_DONE};`)
    expect(item('voyage_export_after_atd', 'voyage_pod_schedule', scale)).toBe('active')
    asAdmin(`INSERT INTO public.granite_manifests (voyage_id, vessel_voyage, loading_port, discharge_port, total_bls, total_weight_kg)
      VALUES (${V_DONE}, 'V346D', 'BRSSZ', 'CNSHA', 1, 1000);`)
    expect(item('voyage_export_after_atd', 'voyage_pod_schedule', scale)).toBe('resolved')
  })

  it('viagem cancelada fecha os alertas dela', () => {
    const eta = psql(`SELECT ((now() AT TIME ZONE 'America/Sao_Paulo')::date - 1)::text;`)
    // ETA de ontem sem ATA: abre a data pendente da escala pelo gatilho de audit.
    asAdmin(`INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by)
      VALUES ('voyage_pod_schedule', '${V_CANCEL}::BRVIX', 'eta', NULL, '${eta}', '${ADMIN_ID}');`)
    expect(item('voyage_schedule_date_pending', 'voyage_pod_schedule', `${V_CANCEL}::BRVIX`)).toBe('active')
    expect(item('voyage_bl_expected', 'voyage', `${V_CANCEL}`)).toBe('active')

    const run = asAdminRpc(`SELECT public.cancel_voyage(${V_CANCEL}, 'teste 346', '${ADMIN_ID}');`)
    expect(run.stderr).toBe('')
    expect(item('voyage_schedule_date_pending', 'voyage_pod_schedule', `${V_CANCEL}::BRVIX`)).toBe('resolved')
    expect(item('voyage_bl_expected', 'voyage', `${V_CANCEL}`)).toBe('resolved')
    asAdmin(`SELECT public.detect_voyage_operation_alerts();`)
    expect(psql(`SELECT count(*) FROM public.alert_items i JOIN public.alerts a ON a.id = i.alert_id
      WHERE i.status = 'active' AND (a.entity_id = '${V_CANCEL}' OR a.entity_id LIKE '${V_CANCEL}::%');`)).toBe('0')
  })

  it('incluir e cancelar B/L reconciliam B/Ls esperados e CE pendente, com porto normalizado', () => {
    const eta = psql(`SELECT ((now() AT TIME ZONE 'America/Sao_Paulo')::date + 3)::text;`)
    asAdmin(`INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by)
      VALUES ('voyage_pod_schedule', '${V_BL}::BRVIX', 'eta', NULL, '${eta}', '${ADMIN_ID}');`)
    expect(item('voyage_bl_expected', 'voyage', `${V_BL}`)).toBe('active')
    expect(item('voyage_ce_mercante_missing', 'voyage', `${V_BL}`)).toBe('sem item')

    // O B/L traz o porto como BRVIT; a escala é BRVIX.
    asAdmin(`INSERT INTO public.bls (id, voyage_id, pol, pod, cargo_mode, review_status, consignee) VALUES ('${BL}', ${V_BL}, 'CNSHA', 'BRVIT', 'container', 'ok', 'CONSIGNEE 346');`)
    expect(item('voyage_bl_expected', 'voyage', `${V_BL}`)).toBe('resolved')
    expect(item('voyage_ce_mercante_missing', 'voyage', `${V_BL}`)).toBe('active')

    const run = asAdminRpc(`SELECT public.cancel_bl('${BL}', 'teste 346');`)
    expect(run.stderr).toBe('')
    expect(item('voyage_bl_expected', 'voyage', `${V_BL}`)).toBe('active')
    expect(item('voyage_ce_mercante_missing', 'voyage', `${V_BL}`)).toBe('resolved')
  })

  it('a importação de B/L adia os gatilhos e reconcilia no fim, uma vez por viagem', () => {
    const before = events('voyage_bl_expected', `${V_BL}`)
    // Com o adiamento ligado, o B/L novo que cobriria a escala não reconcilia.
    asAdmin(`SELECT set_config('alerts.baplie_coverage_deferred', 'on', false);
      INSERT INTO public.bls (id, voyage_id, pol, pod, cargo_mode, review_status, consignee)
      VALUES ('${BL_DEFERRED}', ${V_BL}, 'CNSHA', 'BRVIX', 'container', 'ok', 'CONSIGNEE 346');
      SELECT set_config('alerts.baplie_coverage_deferred', 'off', false);`)
    expect(events('voyage_bl_expected', `${V_BL}`)).toBe(before)
    expect(item('voyage_bl_expected', 'voyage', `${V_BL}`)).toBe('active')
    expect(psql(`SELECT pg_get_functiondef('public.import_bl_freight_transactional_legacy_070(jsonb,uuid)'::regprocedure)
      LIKE '%_reconcile_voyage_bl_alerts(ARRAY[v_voyage_id], ''bl_import'')%';`)).toBe('t')
  })
})
