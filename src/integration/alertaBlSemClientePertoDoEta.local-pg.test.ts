import { execPsql, spawnPsql } from './localPsql'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { describeWithProbe, syntheticCnpj } from './localTestData'

// Migration 352 (revisão dos alertas de 2026-10-21, docs/revisao-alertas-2026-10.md,
// sugestão S7 e decisão P4): "B/L sem Cliente perto do ETA" abre quando a
// escala do POD está a 5 dias ou menos do ETA e há B/L vivo sem Cliente; fecha
// na hora do fato (vínculo, cancelamento, ETA adiado, viagem cancelada). A
// passagem do tempo abre pelo detector próprio, nono da rodada (351).

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const ADMIN_ID = '35200000-0000-4000-8000-0000000000a1'
const CARRIER_ID = 3520001
const VESSEL_ID = 3520002
const VOYAGE_ID = 3520003
const CUSTOMER_ID = 3520011
const BLS = ['B352-A', 'B352-B', 'B352-C', 'B352-D', 'B352-E']
const SSZ = `${VOYAGE_ID}::BRSSZ`
const RIG = `${VOYAGE_ID}::BRRIG`

function psql(sql: string) {
  return execPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', sql], {
    encoding: 'utf8',
  }).trim()
}

function migrationApplied() {
  if (!enabled) return false
  try {
    return psql(`SELECT to_regprocedure('public.reconcile_bl_sem_cliente_perto_eta_alerts(bigint,text)') IS NOT NULL;`) === 't'
  } catch {
    return false
  }
}

const describeLocal = describeWithProbe(migrationApplied, 'migration 352 (reconcile_bl_sem_cliente_perto_eta_alerts)')

// Gravações da tela: sessão do Administrativo, como o PostgREST.
function asOwner(sql: string) {
  return psql(`
    SELECT set_config('request.jwt.claims', '{"sub":"${ADMIN_ID}","role":"authenticated"}', false);
    ${sql}
  `)
}

function asAdmin(sql: string) {
  const run = spawnPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', `
    BEGIN;
    SELECT set_config('request.jwt.claims', '{"sub":"${ADMIN_ID}","role":"authenticated"}', true);
    SET LOCAL ROLE authenticated;
    ${sql}
    COMMIT;
  `], { encoding: 'utf8' })
  expect(run.status, run.stderr).toBe(0)
  return run.stdout.trim()
}

function detector() {
  psql(`BEGIN; SELECT set_config('request.jwt.claim.role', 'service_role', true); SELECT public.detect_bl_sem_cliente_perto_eta_alerts(); COMMIT;`)
}

function day(offset: number) {
  return psql(`SELECT ((now() AT TIME ZONE 'America/Sao_Paulo')::date + ${offset})::text;`)
}

function setEta(port: string, offset: number) {
  asOwner(`INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by)
    VALUES ('voyage_pod_schedule', '${VOYAGE_ID}::${port}', 'eta', NULL, '${day(offset)}', '${ADMIN_ID}');`)
}

function insertBl(id: string, port: string, consignee: string) {
  asOwner(`INSERT INTO public.bls (id, voyage_id, customer_id, pol, pod, consignee, cargo_mode, financial_status, charge_status, review_status)
    VALUES ('${id}', ${VOYAGE_ID}, NULL, 'CNSHA', '${port}', '${consignee}', 'container', 'pending', 'not_calculated', 'pending_review');`)
}

function item(entityId: string) {
  return psql(`SELECT COALESCE((SELECT i.status || '|' || i.message FROM public.alert_items i JOIN public.alerts a ON a.id = i.alert_id
    WHERE i.item_type = 'bl_sem_cliente_perto_eta' AND a.entity_type = 'voyage_pod_schedule' AND a.entity_id = '${entityId}'), 'sem item');`)
}

const status = (entityId: string) => item(entityId).split('|')[0]

function cleanup() {
  psql(`DELETE FROM public.alerts a WHERE a.entity_type LIKE 'voyage%'
    AND (a.entity_id = '${VOYAGE_ID}' OR a.entity_id LIKE '${VOYAGE_ID}::%');`)
  psql(`DELETE FROM public.alerts a WHERE a.entity_type = 'customer'
    AND a.entity_id IN ('${CUSTOMER_ID}', ${BLS.map((_, i) => `'CONSIG 352 ${i}'`).join(', ')});`)
  psql(`
    SET session_replication_role = replica;
    DELETE FROM public.audit_logs WHERE changed_by = '${ADMIN_ID}'
      OR entity_id IN (${BLS.map((id) => `'${id}'`).join(', ')}, '${VOYAGE_ID}') OR entity_id LIKE '${VOYAGE_ID}::%';
    DELETE FROM public.bl_receivables WHERE bl_id IN (${BLS.map((id) => `'${id}'`).join(', ')});
    DELETE FROM public.bls WHERE id IN (${BLS.map((id) => `'${id}'`).join(', ')});
    DELETE FROM public.customers WHERE id = ${CUSTOMER_ID};
    DELETE FROM public.voyages WHERE id = ${VOYAGE_ID};
    DELETE FROM public.vessels WHERE id = ${VESSEL_ID};
    DELETE FROM public.carriers WHERE id = ${CARRIER_ID};
    DELETE FROM public.user_profiles WHERE id = '${ADMIN_ID}';
    DELETE FROM auth.users WHERE id = '${ADMIN_ID}';
    SET session_replication_role = origin;
  `)
}

describeLocal('352 — B/L sem Cliente perto do ETA', () => {
  beforeAll(() => {
    cleanup()
    psql(`
      INSERT INTO auth.users (id, email, aud, role) VALUES ('${ADMIN_ID}', 'adm352@test.local', 'authenticated', 'authenticated');
      INSERT INTO public.user_profiles (id, full_name, role, active) VALUES ('${ADMIN_ID}', 'Administrativo 352', 'administrativo', true)
        ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, active = true;
      SET session_replication_role = replica;
      INSERT INTO public.carriers (id, name) VALUES (${CARRIER_ID}, 'Carrier 352');
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (${VESSEL_ID}, 'Vessel 352', ${CARRIER_ID});
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES (${VOYAGE_ID}, ${VESSEL_ID}, 'V352', 'active');
      INSERT INTO public.customers (id, name, cnpj_cpf) VALUES (${CUSTOMER_ID}, 'CLIENTE 352', '${syntheticCnpj(352011)}');
      SET session_replication_role = origin;
    `)
    insertBl(BLS[0], 'BRSSZ', 'CONSIG 352 0')
    insertBl(BLS[1], 'BRSSZ', 'CONSIG 352 1')
  })

  afterAll(cleanup)

  it('ETA a 6 dias não abre, nem na gravação nem no detector', () => {
    setEta('BRSSZ', 6)
    expect(status(SSZ)).toBe('sem item')
    detector()
    expect(status(SSZ)).toBe('sem item')
  })

  it('o detector abre quando o ETA chega a 5 dias sem gravação nenhuma', () => {
    // O tempo passa sem evento: o ETA a 5 dias é gravado com os gatilhos
    // desligados, como se o dia tivesse virado.
    psql(`SET session_replication_role = replica;
      INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by)
      VALUES ('voyage_pod_schedule', '${SSZ}', 'eta', NULL, '${day(5)}', '${ADMIN_ID}');`)
    expect(status(SSZ)).toBe('sem item')
    detector()
    const [state, message] = item(SSZ).split('|')
    expect(state).toBe('active')
    // Ponto 15 (migration 452): a mensagem traz só a contagem e o ETA; a
    // lista fica no metadata (o link para /bls é calculado na tela).
    expect(message).toBe(`2 B/Ls sem Cliente com ETA em ${day(5).split('-').reverse().join('/')}.`)
    expect(psql(`SELECT (i.metadata->'bl_ids')::text FROM public.alert_items i JOIN public.alerts a ON a.id = i.alert_id
      WHERE i.item_type = 'bl_sem_cliente_perto_eta' AND a.entity_id = '${SSZ}';`)).toBe('["B352-A", "B352-B"]')
    expect(psql(`SELECT i.severity || '|' || i.department FROM public.alert_items i JOIN public.alerts a ON a.id = i.alert_id
      WHERE i.item_type = 'bl_sem_cliente_perto_eta' AND a.entity_id = '${SSZ}';`)).toBe('critical|documentacao')
  })

  it('vincular o Cliente tira o B/L da lista e fecha quando não sobra nenhum', () => {
    asOwner(`UPDATE public.bls SET customer_id = ${CUSTOMER_ID} WHERE id = '${BLS[0]}';`)
    const [state, message] = item(SSZ).split('|')
    expect(state).toBe('active')
    expect(message).toContain('1 B/L sem Cliente com ETA em')
    expect(psql(`SELECT (i.metadata->'bl_ids')::text FROM public.alert_items i JOIN public.alerts a ON a.id = i.alert_id
      WHERE i.item_type = 'bl_sem_cliente_perto_eta' AND a.entity_id = '${SSZ}';`)).toBe('["B352-B"]')
    // O destino do alerta: a lista de B/Ls com "Cliente: Sem Cliente vinculado"
    // mostra só o B/L que falta, e o resumo conta o mesmo recorte.
    const filtered = (fn: string, extra: string) => asAdmin(`SELECT public.${fn}(${extra}p_voyage_id => ${VOYAGE_ID}, p_pod => 'BRSSZ', p_without_customer => true)::text;`).split('\n').pop() ?? '{}'
    expect(JSON.parse(filtered('operational_list_bls', 'p_page => 1, p_page_size => 50, ')).rows.map((row: { id: string }) => row.id)).toEqual(['B352-B'])
    expect(JSON.parse(filtered('operational_list_bl_summary', '')).totalBls).toBe(1)
    expect(JSON.parse(asAdmin(`SELECT public.operational_list_bls(p_page => 1, p_page_size => 50, p_voyage_id => ${VOYAGE_ID}, p_pod => 'BRSSZ')::text;`).split('\n').pop() ?? '{}').count).toBe(2)
    asOwner(`UPDATE public.bls SET customer_id = ${CUSTOMER_ID} WHERE id = '${BLS[1]}';`)
    expect(status(SSZ)).toBe('resolved')
  })

  it('B/L novo sem Cliente na escala já no prazo abre na hora; cancelar o B/L fecha', () => {
    insertBl(BLS[2], 'BRSSZ', 'CONSIG 352 2')
    expect(status(SSZ)).toBe('active')
    expect(psql(`SELECT count(*) FROM public.alert_item_events e JOIN public.alert_items i ON i.id = e.alert_item_id
      JOIN public.alerts a ON a.id = i.alert_id
      WHERE i.item_type = 'bl_sem_cliente_perto_eta' AND a.entity_id = '${SSZ}' AND e.event_type = 'opened';`)).toBe('2')
    const run = asAdmin(`SELECT public.cancel_bl('${BLS[2]}', 'teste 352');`)
    expect(JSON.parse(run.split('\n').pop() ?? '{}')).toMatchObject({ cancelled: true })
    // O filtro "Sem Cliente vinculado" segue o recorte do alerta: B/L cancelado fica fora.
    expect(asAdmin(`SELECT public.operational_list_bl_summary(p_voyage_id => ${VOYAGE_ID}, p_pod => 'BRSSZ', p_without_customer => true)::text;`).split('\n').pop()).toContain('"totalBls": 0')
    expect(status(SSZ)).toBe('resolved')
  })

  it('ETA adiado para além de 5 dias fecha na hora', () => {
    insertBl(BLS[3], 'BRSSZ', 'CONSIG 352 3')
    expect(status(SSZ)).toBe('active')
    setEta('BRSSZ', 10)
    expect(status(SSZ)).toBe('resolved')
  })

  it('B/L novo sem Cliente numa escala a 3 dias abre na hora, por escala', () => {
    setEta('BRRIG', 3)
    expect(status(RIG)).toBe('sem item')
    insertBl(BLS[4], 'brrig', 'CONSIG 352 4')
    const [state, message] = item(RIG).split('|')
    expect(state).toBe('active')
    expect(message).toContain('1 B/L sem Cliente')
    expect(message).not.toContain('B352-E')
    // A outra escala, com ETA a 10 dias, continua fechada.
    expect(status(SSZ)).toBe('resolved')
  })

  it('viagem concluída não ganha escala nova; a aberta segue sendo reavaliada', () => {
    asOwner(`UPDATE public.voyages SET status = 'completed' WHERE id = ${VOYAGE_ID};`)
    expect(status(RIG)).toBe('active')
    // Ativa, a escala de Santos a 2 dias abriria (B352-D segue sem Cliente).
    setEta('BRSSZ', 2)
    expect(status(SSZ)).toBe('resolved')
    detector()
    expect(status(SSZ)).toBe('resolved')
    expect(status(RIG)).toBe('active')
    asOwner(`UPDATE public.voyages SET status = 'active' WHERE id = ${VOYAGE_ID};`)
    expect(status(SSZ)).toBe('active')
  })

  it('viagem que falha no detector entra em failed da rodada, sem desfazer as outras', () => {
    const out = psql(`BEGIN;
      SELECT set_config('request.jwt.claim.role', 'service_role', true);
      CREATE OR REPLACE FUNCTION public.reconcile_bl_sem_cliente_perto_eta_alerts(p_voyage_id bigint, p_source text DEFAULT 'bl_sem_cliente_perto_eta')
      RETURNS integer LANGUAGE plpgsql AS $f$
      BEGIN
        IF p_voyage_id = ${VOYAGE_ID} THEN RAISE EXCEPTION 'falha 352' USING ERRCODE = '22007'; END IF;
        RETURN 0;
      END $f$;
      SELECT r->>'failed' || '|' || (r->'failures'->0->>'detector') || '|' || (r->'failures'->0->>'sqlstate')
        || '|' || jsonb_typeof(r->'bl_review_pendencies')
      FROM public.run_alert_detectors() r;
      ROLLBACK;`)
    expect(out.split('\n').pop()).toBe('1|detect_bl_sem_cliente_perto_eta_alerts|22007|number')
  })

  it('cancelar a viagem fecha', () => {
    asAdmin(`SELECT public.cancel_voyage(${VOYAGE_ID}, 'teste 352', '${ADMIN_ID}');`)
    expect(status(RIG)).toBe('resolved')
    detector()
    expect(status(RIG)).toBe('resolved')
  })
})
