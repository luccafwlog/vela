import { execPsql, spawnPsql } from './localPsql'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { describeWithProbe } from './localTestData'

// Migration 341 (sessão de testes de 2026-10-20):
// - Obs. 2: excluir a viagem leva os alertas dela, sem tocar em viagem de
//   prefixo parecido (62 × 620), e a prévia conta o que vai junto;
// - Obs. 3: importar só o Baplie fecha o "Baplie ausente" na mesma transação;
// - Obs. 1: reimportar o Baplie substitui o anterior (uma linha por container).

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

function psql(sql: string) {
  return execPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', sql], {
    encoding: 'utf8',
  }).trim()
}

function functionPresent() {
  if (!enabled) return false
  try {
    return psql(`SELECT to_regprocedure('public.delete_voyage_alerts(bigint)') IS NOT NULL;`) === 't'
  } catch {
    return false
  }
}

const describeLocal = describeWithProbe(functionPresent, 'functionPresent')

const ADMIN_ID = '34100000-0000-4000-8000-0000000000a1'
const CARRIER_ID = 3410001
const VESSEL_ID = 3410002
// 34162 e 341620: a segunda começa com os dígitos da primeira.
const V_DEL = 34162
const V_OTHER = 341620
const V_BAPLIE = 3410003
const VOYAGES = `${V_DEL}, ${V_OTHER}, ${V_BAPLIE}`

function as(userId: string, sql: string) {
  const run = spawnPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', `
    BEGIN;
    SELECT set_config('request.jwt.claims', '{"sub":"${userId}","role":"authenticated"}', true);
    SET LOCAL ROLE authenticated;
    ${sql}
    COMMIT;
  `], { encoding: 'utf8' })
  const last = run.stdout.trim().split('\n').pop() ?? ''
  return { ...run, json: run.status === 0 && last.startsWith('{') ? JSON.parse(last) : null }
}

// Reconciliadores rodam como dono, com a sessão do usuário (como os triggers).
function asOwner(sql: string) {
  return psql(`
    SELECT set_config('request.jwt.claims', '{"sub":"${ADMIN_ID}","role":"authenticated"}', false);
    ${sql}
  `)
}

function voyageAlertKeys(voyageId: number) {
  return `(a.entity_type LIKE 'voyage%' AND (a.entity_id = '${voyageId}' OR a.entity_id LIKE '${voyageId}::%'))`
}

function cleanup() {
  // Fora do modo replica: o DELETE dos alertas precisa do CASCADE para
  // itens, eventos e Notificações Internas.
  psql(`
    DELETE FROM public.alerts a WHERE ${voyageAlertKeys(V_DEL)} OR ${voyageAlertKeys(V_OTHER)} OR ${voyageAlertKeys(V_BAPLIE)};
    DELETE FROM public.alerts a WHERE a.entity_type = 'customer' AND a.entity_id IN ('341-test', '341-solo');
  `)
  psql(`
    SET session_replication_role = replica;
    DELETE FROM public.baplie_containers WHERE voyage_id IN (${VOYAGES});
    DELETE FROM public.import_batches WHERE voyage_id IN (${VOYAGES});
    DELETE FROM public.audit_logs WHERE changed_by = '${ADMIN_ID}'
      OR entity_id IN ('${V_DEL}', '${V_OTHER}', '${V_BAPLIE}')
      OR entity_id LIKE '${V_DEL}::%' OR entity_id LIKE '${V_OTHER}::%' OR entity_id LIKE '${V_BAPLIE}::%';
    DELETE FROM public.voyages WHERE id IN (${VOYAGES});
    DELETE FROM public.vessels WHERE id = ${VESSEL_ID};
    DELETE FROM public.carriers WHERE id = ${CARRIER_ID};
    DELETE FROM public.user_profiles WHERE id = '${ADMIN_ID}';
    DELETE FROM auth.users WHERE id = '${ADMIN_ID}';
    SET session_replication_role = origin;
  `)
}

function openAlert(type: string, entityType: string, entityId: string, metadata = '{}') {
  psql(`SET request.jwt.claim.role = 'service_role'; SELECT public.upsert_alert_item('${type}', '${entityType}', '${entityId}', 'teste 341', 'alerts_341_test', 'operacoes', '${metadata}'::jsonb, NULL);`)
}

const baplieRow = (container: string) => ({
  container_number: container, size_type: '45G1', status: 'full', weight_kg: 20000,
  pol: 'CNTAO', pod: 'BRVIX', final_dest: 'BRVIX', bl_ref: null, slot: '0010282',
  is_imo: false, imo_class: null, un_number: null, is_oog: false, ownership: null,
})

describeLocal('341 — alertas acompanham a viagem e o Baplie', () => {
  beforeAll(() => {
    cleanup()
    psql(`
      INSERT INTO auth.users (id, email, aud, role) VALUES ('${ADMIN_ID}', 'adm341@test.local', 'authenticated', 'authenticated');
      INSERT INTO public.user_profiles (id, full_name, role, active) VALUES ('${ADMIN_ID}', 'Administrativo 341', 'administrativo', true)
        ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, active = true;
      INSERT INTO public.carriers (id, name) VALUES (${CARRIER_ID}, 'Carrier 341');
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (${VESSEL_ID}, 'Vessel 341', ${CARRIER_ID});
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES
        (${V_DEL}, ${VESSEL_ID}, 'V341D', 'active'),
        (${V_OTHER}, ${VESSEL_ID}, 'V341O', 'active'),
        (${V_BAPLIE}, ${VESSEL_ID}, 'V341B', 'active');
    `)
  })

  afterAll(cleanup)

  it('Obs. 2: excluir a viagem sem carga apaga os alertas dela e a prévia os conta', () => {
    for (const voyageId of [V_DEL, V_OTHER]) {
      openAlert('voyage_baplie_missing', 'voyage', `${voyageId}`, `{"voyage_id":${voyageId}}`)
      openAlert('voyage_schedule_date_pending', 'voyage_pod_schedule', `${voyageId}::BRVIX`, '{"milestone":"etb"}')
      openAlert('voyage_terminal_date_pending', 'voyage_escala_terminal', `${voyageId}::BRVIX::TVV`, '{"milestone":"etd"}')
    }
    // Item de outro alerta que diz ser da viagem (metadata.voyage_id).
    openAlert('review_customer_unlinked', 'customer', '341-test', `{"voyage_id":${V_DEL}}`)
    openAlert('cliente_sem_contato_principal', 'customer', '341-test', `{"voyage_id":${V_OTHER}}`)
    // Alerta de outra entidade cujo único item é da viagem: fecha, não fica vazio na fila.
    openAlert('review_customer_unlinked', 'customer', '341-solo', `{"voyage_id":${V_DEL}}`)
    const before = psql(`SELECT count(*) FROM public.alert_items i JOIN public.alerts a ON a.id = i.alert_id WHERE ${voyageAlertKeys(V_DEL)};`)
    expect(before).toBe('3')
    psql(`UPDATE public.internal_notifications SET read_at = NULL WHERE entity_id LIKE '${V_DEL}%';`)

    const preview = as(ADMIN_ID, `SELECT public.voyage_delete_preview(${V_DEL});`)
    expect(preview.stderr).toBe('')
    const alerts = preview.json.items.find((item: { table: string }) => item.table === 'alerts')
    expect(alerts).toMatchObject({ action: 'delete', count: 5 })

    const run = as(ADMIN_ID, `SELECT public.delete_records('voyage', ARRAY['${V_DEL}'], false, 'teste 341');`)
    expect(run.json.deleted).toEqual([`${V_DEL}`])

    expect(psql(`SELECT count(*) FROM public.alerts a WHERE ${voyageAlertKeys(V_DEL)};`)).toBe('0')
    console.log(psql(`SELECT i.id, i.alert_id, i.item_type, i.metadata FROM public.alert_items i WHERE i.metadata->>'voyage_id' = '${V_DEL}';`), 'X', psql(`SELECT i.id, a.entity_type, a.entity_id, i.item_type, i.metadata FROM public.alert_items i JOIN public.alerts a ON a.id = i.alert_id WHERE i.metadata->>'voyage_id' = '${V_DEL}';`))
    expect(psql(`SELECT count(*) FROM public.alert_items WHERE metadata->>'voyage_id' = '${V_DEL}';`)).toBe('0')
    expect(psql(`SELECT count(*) FROM public.internal_notifications WHERE entity_id = '${V_DEL}' OR entity_id LIKE '${V_DEL}::%';`)).toBe('0')
    expect(psql(`SELECT status FROM public.alerts WHERE entity_type = 'customer' AND entity_id = '341-solo';`)).toBe('closed')
    expect(psql(`SELECT status FROM public.alerts WHERE entity_type = 'customer' AND entity_id = '341-test';`)).toBe('open')
    // A viagem de prefixo parecido continua com os três alertas e o item.
    expect(psql(`SELECT count(*) FROM public.alert_items i JOIN public.alerts a ON a.id = i.alert_id WHERE ${voyageAlertKeys(V_OTHER)} AND i.status = 'active';`)).toBe('3')
    expect(psql(`SELECT count(*) FROM public.alert_items WHERE metadata->>'voyage_id' = '${V_OTHER}';`)).toBe('2')
  })

  it('Obs. 3: importar só o Baplie fecha o "Baplie ausente" na mesma transação', () => {
    const eta = psql(`SELECT ((now() AT TIME ZONE 'America/Sao_Paulo')::date + 3)::text;`)
    // Gravar o ETA dentro de D-7 já abre o alerta pelo trigger de audit (341, L3).
    asOwner(`INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by)
      VALUES ('voyage_pod_schedule', '${V_BAPLIE}::BRVIX', 'eta', NULL, '${eta}', '${ADMIN_ID}');`)
    const status = () => psql(`SELECT i.status FROM public.alert_items i JOIN public.alerts a ON a.id = i.alert_id
      WHERE a.entity_type = 'voyage' AND a.entity_id = '${V_BAPLIE}' AND i.item_type = 'voyage_baplie_missing';`)
    expect(status()).toBe('active')

    const rows = JSON.stringify([baplieRow('TEST3410001'), baplieRow('TEST3410002')])
    const run = as(ADMIN_ID, `SELECT public.import_baplie_staging_transactional(${V_BAPLIE}, '${rows}'::jsonb);`)
    expect(run.stderr).toBe('')
    expect(status()).toBe('resolved')
  })

  it('Obs. 1: reimportar o Baplie substitui o anterior, uma linha por container', () => {
    const first = JSON.stringify([baplieRow('TEST3410001'), baplieRow('TEST3410002')])
    const second = JSON.stringify([{ ...baplieRow('TEST3410001'), size_type: '4510' }, baplieRow('TEST3410003')])
    expect(as(ADMIN_ID, `SELECT public.import_baplie_staging_transactional(${V_BAPLIE}, '${first}'::jsonb);`).stderr).toBe('')
    expect(as(ADMIN_ID, `SELECT public.import_baplie_staging_transactional(${V_BAPLIE}, '${second}'::jsonb);`).stderr).toBe('')
    expect(psql(`SELECT string_agg(container_number || ':' || size_type, ',' ORDER BY container_number)
      FROM public.baplie_containers WHERE voyage_id = ${V_BAPLIE};`)).toBe('TEST3410001:4510,TEST3410003:45G1')
  })
})
