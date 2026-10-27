import { execPsql, spawnPsql } from './localPsql'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { describeWithProbe } from './localTestData'

// Migration 468 (reunião de testes de 2026-10-26): "Planilha de Veículos
// pendente" para Equipamentos em D-5 do primeiro ETA brasileiro, na viagem com
// B/L de container sem veículo; fecha com a planilha (veículo importado) ou com
// a declaração "Esta viagem não terá veículos", que pode ser desfeita com
// motivo e é desfeita sozinha quando um veículo entra na viagem.

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
    return psql(`SELECT to_regprocedure('public.reconcile_voyage_vehicle_sheet_alerts(bigint,text)') IS NOT NULL;`) === 't'
  } catch {
    return false
  }
}

const describeLocal = describeWithProbe(migrationApplied, 'migration 468 (reconcile_voyage_vehicle_sheet_alerts)')

const ADMIN_ID = '46800000-0000-4000-8000-0000000000a1'
const EQP_ID = '46800000-0000-4000-8000-0000000000e1'
const CARRIER_ID = 4680001
const VESSEL_ID = 4680002
const V_CNTR = 4680011
const V_BB = 4680012
const V_FAR = 4680013
const VOYAGES = [V_CNTR, V_BB, V_FAR]
const BL_CNTR = 'BL468-CNTR'
const BL_BB = 'BL468-BB'
const BL_FAR = 'BL468-FAR'
const BLS = [BL_CNTR, BL_BB, BL_FAR]
const TYPE = 'voyage_vehicle_sheet_pending'

// Gravações como o usuário na sessão (gatilhos com auth.uid()).
function as(userId: string, sql: string) {
  return psql(`
    SELECT set_config('request.jwt.claims', '{"sub":"${userId}","role":"authenticated"}', false);
    ${sql}
  `)
}

// Chamada de RPC como o navegador: papel authenticated e o usuário no JWT.
function rpcAs(userId: string, sql: string) {
  return spawnPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', `
    BEGIN;
    SET LOCAL "request.jwt.claims" = '{"sub":"${userId}","role":"authenticated"}';
    SET LOCAL ROLE authenticated;
    ${sql}
    COMMIT;
  `], { encoding: 'utf8' })
}

function item(voyageId: number) {
  return psql(`SELECT COALESCE((SELECT i.status FROM public.alert_items i JOIN public.alerts a ON a.id = i.alert_id
    WHERE i.item_type = '${TYPE}' AND a.entity_type = 'voyage' AND a.entity_id = '${voyageId}'), 'sem item');`)
}

function declarationAudit(voyageId: number) {
  return psql(`SELECT COALESCE(string_agg(new_value || ':' || COALESCE(justification, ''), ',' ORDER BY id), '')
    FROM public.audit_logs WHERE entity_type = 'voyage' AND entity_id = '${voyageId}' AND field_name = 'sem_veiculos';`)
}

function setEta(voyageId: number, daysFromToday: number) {
  const eta = psql(`SELECT ((now() AT TIME ZONE 'America/Sao_Paulo')::date + ${daysFromToday})::text;`)
  // O gatilho de audit da escala reconcilia os alertas da viagem.
  as(ADMIN_ID, `INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by)
    VALUES ('voyage_pod_schedule', '${voyageId}::BRVIX', 'eta', NULL, '${eta}', '${ADMIN_ID}');`)
}

function insertVehicle(chassis: string) {
  as(ADMIN_ID, `INSERT INTO public.vehicles (voyage_id, container_id, bl_id, chassis, brand, model, weight_kg, cbm)
    SELECT ${V_CNTR}, c.id, '${BL_CNTR}', '${chassis}', 'MARCA', 'MODELO', 1500, 10
    FROM public.bl_containers c WHERE c.bl_id = '${BL_CNTR}' LIMIT 1;`)
}

function cleanup() {
  const voyageKeys = VOYAGES.map((id) => `(a.entity_type LIKE 'voyage%' AND (a.entity_id = '${id}' OR a.entity_id LIKE '${id}::%'))`).join(' OR ')
  psql(`DELETE FROM public.alerts a WHERE ${voyageKeys};`)
  psql(`
    SET session_replication_role = replica;
    DELETE FROM public.vehicles WHERE voyage_id IN (${VOYAGES.join(', ')});
    DELETE FROM public.bl_containers WHERE bl_id IN ('${BLS.join("', '")}');
    DELETE FROM public.charge_calculations WHERE bl_id IN ('${BLS.join("', '")}');
    DELETE FROM public.bls WHERE id IN ('${BLS.join("', '")}');
    DELETE FROM public.voyage_vehicle_declarations WHERE voyage_id IN (${VOYAGES.join(', ')});
    DELETE FROM public.audit_logs WHERE changed_by IN ('${ADMIN_ID}', '${EQP_ID}')
      OR ${VOYAGES.map((id) => `entity_id = '${id}' OR entity_id LIKE '${id}::%'`).join(' OR ')} OR entity_id IN ('${BLS.join("', '")}');
    DELETE FROM public.voyages WHERE id IN (${VOYAGES.join(', ')});
    DELETE FROM public.vessels WHERE id = ${VESSEL_ID};
    DELETE FROM public.carriers WHERE id = ${CARRIER_ID};
    DELETE FROM public.internal_notifications WHERE recipient_id IN ('${ADMIN_ID}', '${EQP_ID}');
    DELETE FROM public.user_profiles WHERE id IN ('${ADMIN_ID}', '${EQP_ID}');
    DELETE FROM auth.users WHERE id IN ('${ADMIN_ID}', '${EQP_ID}');
    SET session_replication_role = origin;
  `)
}

describeLocal('468 — Planilha de Veículos pendente e viagem sem veículos', () => {
  beforeAll(() => {
    cleanup()
    psql(`
      INSERT INTO auth.users (id, email, aud, role) VALUES
        ('${ADMIN_ID}', 'adm468@test.local', 'authenticated', 'authenticated'),
        ('${EQP_ID}', 'eqp468@test.local', 'authenticated', 'authenticated');
      INSERT INTO public.user_profiles (id, full_name, role, active) VALUES
        ('${ADMIN_ID}', 'Administrativo 468', 'administrativo', true),
        ('${EQP_ID}', 'Equipamentos 468', 'equipamentos', true);
      SET session_replication_role = replica;
      INSERT INTO public.carriers (id, name) VALUES (${CARRIER_ID}, 'Carrier 468');
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (${VESSEL_ID}, 'Vessel 468', ${CARRIER_ID});
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES
        (${V_CNTR}, ${VESSEL_ID}, 'V468C', 'active'),
        (${V_BB}, ${VESSEL_ID}, 'V468B', 'active'),
        (${V_FAR}, ${VESSEL_ID}, 'V468F', 'active');
      SET session_replication_role = origin;
    `)
    as(ADMIN_ID, `
      INSERT INTO public.bls (id, voyage_id, pol, pod, cargo_mode, review_status, consignee) VALUES
        ('${BL_CNTR}', ${V_CNTR}, 'CNSHA', 'BRVIT', 'container', 'ok', 'CONSIGNEE 468'),
        ('${BL_BB}', ${V_BB}, 'CNSHA', 'BRVIX', 'carga_solta', 'ok', 'CONSIGNEE 468'),
        ('${BL_FAR}', ${V_FAR}, 'CNSHA', 'BRVIX', 'container', 'ok', 'CONSIGNEE 468');
      INSERT INTO public.bl_containers (bl_id, container_number, type) VALUES
        ('${BL_CNTR}', 'MSCU4680001', '40HC'),
        ('${BL_FAR}', 'MSCU4680002', '40HC');
    `)
  })

  afterAll(cleanup)

  it('abre em D-5 para Equipamentos, crítico, com o ETA na mensagem e a Notificação Interna', () => {
    expect(item(V_CNTR)).toBe('sem item')
    // ETA em 3 dias: dentro de D-5. O B/L traz BRVIT; a escala é BRVIX.
    setEta(V_CNTR, 3)
    expect(item(V_CNTR)).toBe('active')
    // O destino por item é derivado na tela (alertEntityLink), não gravado: o gatilho do catálogo o limpa.
    expect(psql(`SELECT i.severity || '|' || i.department FROM public.alert_items i
      JOIN public.alerts a ON a.id = i.alert_id WHERE i.item_type = '${TYPE}' AND a.entity_id = '${V_CNTR}';`))
      .toBe('critical|equipamentos')
    expect(psql(`SELECT i.message FROM public.alert_items i JOIN public.alerts a ON a.id = i.alert_id
      WHERE i.item_type = '${TYPE}' AND a.entity_id = '${V_CNTR}';`)).toMatch(/^Importe a planilha de Veículos ou declare que a viagem não terá veículos; ETA em \d{2}\/\d{2}\/\d{4}, prazo D-5 atingido\.$/)
    expect(psql(`SELECT count(*) FROM public.internal_notifications n JOIN public.alert_items i ON i.id = n.alert_item_id
      WHERE n.recipient_id = '${EQP_ID}' AND i.item_type = '${TYPE}';`)).toBe('1')
  })

  it('não abre antes de D-5 nem em viagem só de carga solta', () => {
    setEta(V_FAR, 10)
    setEta(V_BB, 2)
    expect(item(V_FAR)).toBe('sem item')
    expect(item(V_BB)).toBe('sem item')
  })

  it('a declaração "sem veículos" fecha o alerta, grava o Histórico uma vez e mostra quem declarou', () => {
    const run = rpcAs(EQP_ID, `SELECT public.declare_voyage_without_vehicles(${V_CNTR})->>'declared_by_name';`)
    expect(run.stderr).toBe('')
    expect(String(run.stdout).trim()).toBe('Equipamentos 468')
    expect(item(V_CNTR)).toBe('resolved')
    // Declarar de novo não repete o Histórico.
    expect(rpcAs(EQP_ID, `SELECT public.declare_voyage_without_vehicles(${V_CNTR});`).stderr).toBe('')
    expect(declarationAudit(V_CNTR)).toBe('declarada:')
    // O detector não reabre a viagem declarada.
    as(ADMIN_ID, `SELECT public.reconcile_voyage_operation_alerts(${V_CNTR}, 'teste_468');`)
    expect(item(V_CNTR)).toBe('resolved')
  })

  it('desfazer a declaração exige motivo e reabre o alerta', () => {
    const empty = rpcAs(EQP_ID, `SELECT public.undo_voyage_vehicle_declaration(${V_CNTR}, '  ');`)
    expect(empty.stderr).toContain('Desfazer a declaração exige motivo.')
    expect(rpcAs(EQP_ID, `SELECT public.undo_voyage_vehicle_declaration(${V_CNTR}, 'Armador avisou que vêm veículos');`).stderr).toBe('')
    expect(item(V_CNTR)).toBe('active')
    expect(declarationAudit(V_CNTR)).toBe('declarada:,desfeita:Armador avisou que vêm veículos')
    expect(rpcAs(EQP_ID, `SELECT public.voyage_vehicle_declaration(${V_CNTR}) IS NULL;`).stdout.trim()).toBe('t')
  })

  it('o veículo importado fecha o alerta e desfaz sozinho a declaração da viagem', () => {
    expect(rpcAs(EQP_ID, `SELECT public.declare_voyage_without_vehicles(${V_CNTR});`).stderr).toBe('')
    insertVehicle('CHASSI468A')
    expect(psql(`SELECT count(*) FROM public.voyage_vehicle_declarations WHERE voyage_id = ${V_CNTR};`)).toBe('0')
    expect(declarationAudit(V_CNTR)).toBe('declarada:,desfeita:Armador avisou que vêm veículos,declarada:,desfeita:Veículos importados na viagem')
    expect(item(V_CNTR)).toBe('resolved')
  })

  it('com veículo na viagem, a declaração é recusada; excluir os veículos reabre o alerta', () => {
    const refused = rpcAs(EQP_ID, `SELECT public.declare_voyage_without_vehicles(${V_CNTR});`)
    expect(refused.stderr).toContain('A viagem já tem 1 veículo(s) importado(s)')
    as(ADMIN_ID, `DELETE FROM public.vehicles WHERE voyage_id = ${V_CNTR};`)
    expect(item(V_CNTR)).toBe('active')
  })

  it('viagem cancelada fecha o alerta e não aceita a declaração', () => {
    const run = rpcAs(ADMIN_ID, `SELECT public.cancel_voyage(${V_CNTR}, 'teste 468', '${ADMIN_ID}');`)
    expect(run.stderr).toBe('')
    expect(item(V_CNTR)).toBe('resolved')
    expect(rpcAs(EQP_ID, `SELECT public.declare_voyage_without_vehicles(${V_CNTR});`).stderr)
      .toContain('Viagem cancelada não recebe a declaração de veículos.')
  })

  it('só usuário autenticado ativo usa as funções da declaração; o reconciliador não é exposto', () => {
    expect(psql(`SELECT has_function_privilege('authenticated', 'public.reconcile_voyage_vehicle_sheet_alerts(bigint,text)', 'EXECUTE');`)).toBe('f')
    expect(psql(`SELECT has_function_privilege('anon', 'public.declare_voyage_without_vehicles(bigint)', 'EXECUTE');`)).toBe('f')
    expect(psql(`SELECT has_table_privilege('authenticated', 'public.voyage_vehicle_declarations', 'SELECT');`)).toBe('f')
    const anonymous = spawnPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', `
      BEGIN; SET LOCAL ROLE authenticated; SELECT public.declare_voyage_without_vehicles(${V_FAR}); COMMIT;`], { encoding: 'utf8' })
    expect(anonymous.stderr).toContain('Somente usuário interno ativo declara a viagem sem veículos.')
  })
})
