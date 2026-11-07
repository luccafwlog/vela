import { execPsql, spawnPsql } from './localPsql'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { describeWithProbe } from './localTestData'

// Migration 597 (decisão do dono de 2026-11-05/06): Equipamentos responde em
// D-7 se a viagem terá veículos; sem resposta, o alerta passa ao crítico de
// D-5. "Terá veículos" trava o primeiro CE Mercante dos B/Ls de container até
// o primeiro veículo importado; "não terá" libera e cala os alertas.

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
    return psql(`SELECT to_regprocedure('public.voyage_ce_mercante_vehicle_lock(bigint)') IS NOT NULL;`) === 't'
  } catch {
    return false
  }
}

const describeLocal = describeWithProbe(migrationApplied, 'migration 597 (voyage_ce_mercante_vehicle_lock)')

const ADMIN_ID = '59500000-0000-4000-8000-0000000000a1'
const EQP_ID = '59500000-0000-4000-8000-0000000000e1'
const DOC_ID = '59500000-0000-4000-8000-0000000000d1'
const CARRIER_ID = 5950001
const VESSEL_ID = 5950002
// V_MAIN: o caminho inteiro; V_DONE: viagem concluída; V_NO: "não terá".
const V_MAIN = 5950011
const V_DONE = 5950012
const V_NO = 5950013
const VOYAGES = [V_MAIN, V_DONE, V_NO]
const BL_CNTR = 'BL595-CNTR'
const BL_CNTR2 = 'BL595-CNTR2'
const BL_BB = 'BL595-BB'
const BL_DONE = 'BL595-DONE'
const BL_NO = 'BL595-NO'
const BLS = [BL_CNTR, BL_CNTR2, BL_BB, BL_DONE, BL_NO]
const DECL = 'voyage_vehicle_declaration_pending'
const SHEET = 'voyage_vehicle_sheet_pending'
const MANIFESTO = 'M595000000001'

function as(userId: string, sql: string) {
  return psql(`
    SELECT set_config('request.jwt.claims', '{"sub":"${userId}","role":"authenticated"}', false);
    ${sql}
  `)
}

function asTry(userId: string, sql: string) {
  return spawnPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', `
    SELECT set_config('request.jwt.claims', '{"sub":"${userId}","role":"authenticated"}', false);
    ${sql}
  `], { encoding: 'utf8' })
}

function rpcAs(userId: string, sql: string) {
  return spawnPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', `
    BEGIN;
    SET LOCAL "request.jwt.claims" = '{"sub":"${userId}","role":"authenticated"}';
    SET LOCAL ROLE authenticated;
    ${sql}
    COMMIT;
  `], { encoding: 'utf8' })
}

function item(type: string, voyageId: number) {
  return psql(`SELECT COALESCE((SELECT i.status || '|' || i.severity || '|' || i.department FROM public.alert_items i
    JOIN public.alerts a ON a.id = i.alert_id
    WHERE i.item_type = '${type}' AND a.entity_type = 'voyage' AND a.entity_id = '${voyageId}'), 'sem item');`)
}

function message(type: string, voyageId: number) {
  return psql(`SELECT i.message FROM public.alert_items i JOIN public.alerts a ON a.id = i.alert_id
    WHERE i.item_type = '${type}' AND a.entity_id = '${voyageId}';`)
}

function setEta(voyageId: number, daysFromToday: number) {
  const eta = psql(`SELECT ((now() AT TIME ZONE 'America/Sao_Paulo')::date + ${daysFromToday})::text;`)
  as(ADMIN_ID, `INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by)
    VALUES ('voyage_pod_schedule', '${voyageId}::BRVIX', 'eta', NULL, '${eta}', '${ADMIN_ID}');`)
}

// Erros da prévia da planilha de CE Mercante, como o importador os mostra.
function previewErrors(voyageId: number, blId: string, ce: string) {
  const run = rpcAs(EQP_ID, `SELECT public.preview_ce_mercante_rows('${JSON.stringify([{ row: 2, bl_id: blId, ce }])}'::jsonb, '${MANIFESTO}', ${voyageId})->'errors';`)
  expect(run.stderr).toBe('')
  return JSON.parse(String(run.stdout).trim()) as { message: string }[]
}

// Vincular o CE como a porta única faz, só com a trava nova em jogo.
function linkCe(blId: string, ce: string) {
  return asTry(ADMIN_ID, `UPDATE public.bls SET ce_mercante = '${ce}' WHERE id = '${blId}';`)
}

function insertVehicle(voyageId: number, blId: string, chassis: string) {
  as(ADMIN_ID, `INSERT INTO public.vehicles (voyage_id, container_id, bl_id, chassis, brand, model, weight_kg, cbm)
    SELECT ${voyageId}, c.id, '${blId}', '${chassis}', 'MARCA', 'MODELO', 1500, 10
    FROM public.bl_containers c WHERE c.bl_id = '${blId}' LIMIT 1;`)
}

function audit(voyageId: number) {
  return psql(`SELECT COALESCE(string_agg(field_name || ':' || new_value || ':' || COALESCE(justification, ''), ',' ORDER BY id), '')
    FROM public.audit_logs WHERE entity_type = 'voyage' AND entity_id = '${voyageId}' AND field_name IN ('sem_veiculos', 'com_veiculos');`)
}

// Vincular CE em BRVIT calcula as Taxas Locais pelas tabelas semente de Vitória:
// as versões de preço que o cálculo cria saem na limpeza, como em
// containerProfile.local-pg.test.ts (a bateria financeira confere o seed).
let firstRuleVersionId: number | null = null

function cleanup() {
  const voyageKeys = VOYAGES.map((id) => `(a.entity_type LIKE 'voyage%' AND (a.entity_id = '${id}' OR a.entity_id LIKE '${id}::%'))`).join(' OR ')
  psql(`DELETE FROM public.alerts a WHERE ${voyageKeys};`)
  psql(`
    SET session_replication_role = replica;
    DELETE FROM public.vehicles WHERE voyage_id IN (${VOYAGES.join(', ')});
    DELETE FROM public.bl_containers WHERE bl_id IN ('${BLS.join("', '")}');
    DELETE FROM public.charge_calculations WHERE bl_id IN ('${BLS.join("', '")}');
    ${firstRuleVersionId === null ? '' : `DELETE FROM public.pricing_rule_versions WHERE id > ${firstRuleVersionId};`}
    DELETE FROM public.bls WHERE id IN ('${BLS.join("', '")}');
    DELETE FROM public.voyage_vehicle_declarations WHERE voyage_id IN (${VOYAGES.join(', ')});
    DELETE FROM public.voyage_baplie_declarations WHERE voyage_id IN (${VOYAGES.join(', ')});
    DELETE FROM public.audit_logs WHERE changed_by IN ('${ADMIN_ID}', '${EQP_ID}', '${DOC_ID}')
      OR ${VOYAGES.map((id) => `entity_id = '${id}' OR entity_id LIKE '${id}::%'`).join(' OR ')} OR entity_id IN ('${BLS.join("', '")}');
    DELETE FROM public.voyages WHERE id IN (${VOYAGES.join(', ')});
    DELETE FROM public.vessels WHERE id = ${VESSEL_ID};
    DELETE FROM public.carriers WHERE id = ${CARRIER_ID};
    DELETE FROM public.internal_notifications WHERE recipient_id IN ('${ADMIN_ID}', '${EQP_ID}', '${DOC_ID}');
    DELETE FROM public.user_profiles WHERE id IN ('${ADMIN_ID}', '${EQP_ID}', '${DOC_ID}');
    DELETE FROM auth.users WHERE id IN ('${ADMIN_ID}', '${EQP_ID}', '${DOC_ID}');
    SET session_replication_role = origin;
  `)
}

describeLocal('597 — resposta de veículos em D-7 e CE Mercante travado', () => {
  beforeAll(() => {
    cleanup()
    firstRuleVersionId = Number(psql('SELECT COALESCE(max(id), 0) FROM public.pricing_rule_versions;'))
    psql(`
      INSERT INTO auth.users (id, email, aud, role) VALUES
        ('${ADMIN_ID}', 'adm595@test.local', 'authenticated', 'authenticated'),
        ('${EQP_ID}', 'eqp595@test.local', 'authenticated', 'authenticated'),
        ('${DOC_ID}', 'doc595@test.local', 'authenticated', 'authenticated');
      INSERT INTO public.user_profiles (id, full_name, role, active) VALUES
        ('${ADMIN_ID}', 'Administrativo 597', 'administrativo', true),
        ('${EQP_ID}', 'Equipamentos 597', 'equipamentos', true),
        ('${DOC_ID}', 'Documentação 597', 'documentacao', true);
      SET session_replication_role = replica;
      INSERT INTO public.carriers (id, name) VALUES (${CARRIER_ID}, 'Carrier 597');
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (${VESSEL_ID}, 'Vessel 597', ${CARRIER_ID});
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES
        (${V_MAIN}, ${VESSEL_ID}, 'V595M', 'active'),
        (${V_DONE}, ${VESSEL_ID}, 'V595D', 'completed'),
        (${V_NO}, ${VESSEL_ID}, 'V595N', 'active');
      -- 619: esta suíte mede só a trava dos veículos; o Baplie fica declarado.
      INSERT INTO public.voyage_baplie_declarations (voyage_id, reason) VALUES
        (${V_MAIN}, 'fixture de teste'), (${V_DONE}, 'fixture de teste'), (${V_NO}, 'fixture de teste');
      SET session_replication_role = origin;
    `)
    as(ADMIN_ID, `
      INSERT INTO public.bls (id, voyage_id, pol, pod, cargo_mode, review_status, consignee) VALUES
        ('${BL_CNTR}', ${V_MAIN}, 'CNSHA', 'BRVIT', 'container', 'ok', 'CONSIGNEE 597'),
        ('${BL_CNTR2}', ${V_MAIN}, 'CNSHA', 'BRVIT', 'container', 'ok', 'CONSIGNEE 597'),
        ('${BL_BB}', ${V_MAIN}, 'CNSHA', 'BRVIT', 'carga_solta', 'ok', 'CONSIGNEE 597'),
        ('${BL_NO}', ${V_NO}, 'CNSHA', 'BRVIX', 'container', 'ok', 'CONSIGNEE 597');
      INSERT INTO public.bl_containers (bl_id, container_number, type) VALUES
        ('${BL_CNTR}', 'MSCU5950001', '40HC'),
        ('${BL_CNTR2}', 'MSCU5950002', '40HC'),
        ('${BL_NO}', 'MSCU5950003', '40HC');
    `)
    // B/L da viagem concluída entra sem gatilhos: a viagem já não é ativa.
    psql(`
      SET session_replication_role = replica;
      INSERT INTO public.bls (id, voyage_id, pol, pod, cargo_mode, review_status, consignee)
      VALUES ('${BL_DONE}', ${V_DONE}, 'CNSHA', 'BRVIX', 'container', 'ok', 'CONSIGNEE 597');
      SET session_replication_role = origin;
    `)
  })

  afterAll(cleanup)

  it('D-7 abre "Declaração de veículos pendente" (Normal, Equipamentos); antes de D-7, nada', () => {
    setEta(V_MAIN, 8)
    expect(item(DECL, V_MAIN)).toBe('sem item')
    setEta(V_MAIN, 6)
    expect(item(DECL, V_MAIN)).toBe('active|normal|equipamentos')
    expect(item(SHEET, V_MAIN)).toBe('sem item')
    expect(message(DECL, V_MAIN)).toMatch(/^Declare se a viagem terá veículos; ETA em \d{2}\/\d{2}\/\d{4}\. Sem a resposta, o CE Mercante dos B\/Ls de container fica travado e o alerta passa a crítico em D-5\.$/)
  })

  it('sem resposta, o CE de container é recusado na prévia e no banco; carga solta passa', () => {
    const errors = previewErrors(V_MAIN, BL_CNTR, '152659500000001')
    expect(errors.map((e) => e.message)).toEqual([
      'CE Mercante travado na viagem Vessel 597 V595M: Equipamentos ainda não respondeu se a viagem terá veículos. O CE de B/L de container só é vinculado depois da resposta na tela Veículos.',
    ])
    expect(linkCe(BL_CNTR, '152659500000001').stderr).toContain('Equipamentos ainda não respondeu se a viagem terá veículos')
    expect(linkCe(BL_BB, '152659500000009').stderr).toBe('')
  })

  // 598: a Documentação não solta a própria trava respondendo por Equipamentos.
  it('a Documentação não responde nem desfaz a resposta de veículos; o Administrativo responde', () => {
    for (const call of [`public.declare_voyage_without_vehicles(${V_MAIN})`, `public.declare_voyage_with_vehicles(${V_MAIN})`]) {
      expect(rpcAs(DOC_ID, `SELECT ${call};`).stderr).toContain('Apenas Equipamentos ou Administrativo responde se a viagem terá veículos.')
    }
    expect(psql(`SELECT public.voyage_ce_mercante_vehicle_lock(${V_MAIN});`)).toBe('sem_resposta')
    expect(rpcAs(ADMIN_ID, `SELECT public.declare_voyage_without_vehicles(${V_MAIN});`).stderr).toBe('')
    expect(rpcAs(DOC_ID, `SELECT public.undo_voyage_vehicle_declaration(${V_MAIN}, 'teste');`).stderr)
      .toContain('Apenas Equipamentos ou Administrativo desfaz a resposta de veículos da viagem.')
    expect(rpcAs(ADMIN_ID, `SELECT public.undo_voyage_vehicle_declaration(${V_MAIN}, 'Teste da 598');`).stderr).toBe('')
    psql(`DELETE FROM public.audit_logs WHERE entity_type = 'voyage' AND entity_id = '${V_MAIN}' AND field_name IN ('sem_veiculos', 'com_veiculos');`)
  })

  it('em D-5 sem resposta, o alerta de D-7 fecha e o crítico cobra a resposta', () => {
    setEta(V_MAIN, 3)
    expect(item(DECL, V_MAIN)).toBe('resolved|normal|equipamentos')
    expect(item(SHEET, V_MAIN)).toBe('active|critical|equipamentos')
    expect(message(SHEET, V_MAIN)).toMatch(/^Declare se a viagem terá veículos ou importe a planilha de Veículos; ETA em .*O CE Mercante dos B\/Ls de container está travado até a resposta\.$/)
  })

  it('"terá veículos" mantém a trava e vira "Planilha de Veículos ausente"', () => {
    const run = rpcAs(EQP_ID, `SELECT public.declare_voyage_with_vehicles(${V_MAIN})->>'has_vehicles';`)
    expect(run.stderr).toBe('')
    expect(String(run.stdout).trim()).toBe('true')
    expect(item(SHEET, V_MAIN)).toBe('active|critical|equipamentos')
    expect(message(SHEET, V_MAIN)).toMatch(/^Planilha de Veículos ausente: a viagem foi declarada com veículos e nenhum veículo foi importado; ETA em .*travado até a importação\.$/)
    expect(previewErrors(V_MAIN, BL_CNTR, '152659500000001').map((e) => e.message)).toEqual([
      'CE Mercante travado na viagem Vessel 597 V595M: Equipamentos declarou que a viagem terá veículos e a planilha de Veículos ainda não foi importada. O CE de B/L de container só é vinculado depois da importação.',
    ])
    expect(linkCe(BL_CNTR, '152659500000001').stderr).toContain('a planilha de Veículos ainda não foi importada')
  })

  it('trocar "terá" por "não terá" exige motivo, e o Histórico guarda as duas respostas', () => {
    const noReason = rpcAs(EQP_ID, `SELECT public.declare_voyage_without_vehicles(${V_MAIN});`)
    expect(noReason.stderr).toContain('A viagem já foi declarada com veículos: para trocar a resposta, informe o motivo.')
    expect(rpcAs(EQP_ID, `SELECT public.declare_voyage_without_vehicles(${V_MAIN}, 'Armador confirmou que não vem veículo');`).stderr).toBe('')
    expect(item(SHEET, V_MAIN)).toBe('resolved|critical|equipamentos')
    expect(rpcAs(EQP_ID, `SELECT public.declare_voyage_with_vehicles(${V_MAIN}, 'Armador corrigiu: vêm veículos');`).stderr).toBe('')
    expect(item(SHEET, V_MAIN)).toBe('active|critical|equipamentos')
    // Repetir a mesma resposta não grava de novo.
    expect(rpcAs(EQP_ID, `SELECT public.declare_voyage_with_vehicles(${V_MAIN});`).stderr).toBe('')
    expect(audit(V_MAIN)).toBe([
      'com_veiculos:declarada:',
      'com_veiculos:desfeita:Armador confirmou que não vem veículo',
      'sem_veiculos:declarada:Armador confirmou que não vem veículo',
      'sem_veiculos:desfeita:Armador corrigiu: vêm veículos',
      'com_veiculos:declarada:Armador corrigiu: vêm veículos',
    ].join(','))
  })

  it('um veículo importado libera o CE de todos os B/Ls de container e fecha o alerta; a resposta fica', () => {
    insertVehicle(V_MAIN, BL_CNTR, 'CHASSI595A')
    expect(item(SHEET, V_MAIN)).toBe('resolved|critical|equipamentos')
    expect(psql(`SELECT has_vehicles FROM public.voyage_vehicle_declarations WHERE voyage_id = ${V_MAIN};`)).toBe('t')
    expect(previewErrors(V_MAIN, BL_CNTR2, '152659500000002')).toEqual([])
    expect(linkCe(BL_CNTR2, '152659500000002').stderr).toBe('')
  })

  it('corrigir um CE já vinculado não é travado, mesmo sem veículo', () => {
    as(ADMIN_ID, `DELETE FROM public.vehicles WHERE voyage_id = ${V_MAIN};`)
    expect(psql(`SELECT public.voyage_ce_mercante_vehicle_lock(${V_MAIN});`)).toBe('aguardando_planilha')
    expect(linkCe(BL_CNTR2, '152659500000003').stderr).toBe('')
  })

  // Revisão da release 2026-11-06: o manual manda trocar o CE da viagem
  // travada pelo Corrigir CE, porque remover e vincular de novo é primeiro CE.
  it('na viagem travada, Corrigir CE troca o número; Remover CE e vincular de novo é recusado', () => {
    expect(psql(`SELECT public.voyage_ce_mercante_vehicle_lock(${V_MAIN});`)).toBe('aguardando_planilha')
    const corrected = rpcAs(DOC_ID, `SELECT public.correct_bl_ce_mercante('${BL_CNTR2}', '152659500000006', 'Número digitado errado', '152659500000003');`)
    expect(corrected.stderr).toBe('')
    expect(psql(`SELECT ce_mercante FROM public.bls WHERE id = '${BL_CNTR2}';`)).toBe('152659500000006')

    const removed = rpcAs(DOC_ID, `SELECT public.remove_bl_ce_mercante('${BL_CNTR2}', 'CE de outro B/L', '152659500000006');`)
    expect(removed.stderr).toBe('')
    expect(psql(`SELECT COALESCE(ce_mercante, '') FROM public.bls WHERE id = '${BL_CNTR2}';`)).toBe('')
    // Sem CE, o Corrigir CE não vincula (573): o CE volta só pela planilha, e a prévia trava.
    expect(rpcAs(DOC_ID, `SELECT public.correct_bl_ce_mercante('${BL_CNTR2}', '152659500000007', 'Vincular de novo', NULL);`).stderr)
      .toContain('o CE entra pela planilha de CE Mercante')
    expect(previewErrors(V_MAIN, BL_CNTR2, '152659500000007').map((e) => e.message)).toEqual([
      'CE Mercante travado na viagem Vessel 597 V595M: Equipamentos declarou que a viagem terá veículos e a planilha de Veículos ainda não foi importada. O CE de B/L de container só é vinculado depois da importação.',
    ])
  })

  it('"não terá veículos" libera o CE e não abre alerta nenhum', () => {
    setEta(V_NO, 6)
    expect(item(DECL, V_NO)).toBe('active|normal|equipamentos')
    expect(rpcAs(EQP_ID, `SELECT public.declare_voyage_without_vehicles(${V_NO});`).stderr).toBe('')
    expect(item(DECL, V_NO)).toBe('resolved|normal|equipamentos')
    setEta(V_NO, 3)
    expect(item(SHEET, V_NO)).toBe('sem item')
    expect(previewErrors(V_NO, BL_NO, '152659500000004')).toEqual([])
    expect(linkCe(BL_NO, '152659500000004').stderr).toBe('')
  })

  // 627 (ADR 0134, decisão 11): a Viagem concluída também trava; a recusa pede a
  // resposta a Equipamentos na hora, mesmo sem o D-7.
  it('viagem concluída também trava; a recusa abre a Declaração para Equipamentos e a conferência não a fecha', () => {
    expect(psql(`SELECT public.voyage_ce_mercante_vehicle_lock(${V_DONE});`)).toBe('sem_resposta')
    expect(linkCe(BL_DONE, '152659500000005').stderr).toContain('Equipamentos ainda não respondeu')
    expect(item(DECL, V_DONE)).toBe('sem item')
    const preview = rpcAs(EQP_ID, `SELECT public.preview_ce_mercante_rows('${JSON.stringify([{ row: 2, bl_id: BL_DONE, ce: '152659500000005' }])}'::jsonb, '${MANIFESTO}', ${V_DONE})->'vehicle_answer_voyages';`)
    expect(JSON.parse(String(preview.stdout).trim())).toEqual([V_DONE])
    const asked = rpcAs(DOC_ID, `SELECT public.request_voyage_vehicle_answer(${V_DONE});`)
    expect(String(asked.stderr)).toBe('')
    expect(String(asked.stdout).trim()).toBe('t')
    expect(item(DECL, V_DONE)).toBe('active|normal|equipamentos')
    expect(message(DECL, V_DONE)).toContain('A Documentação tentou vincular o CE Mercante')
    // A conferência fora do D-7 mantém o pedido aberto até a resposta.
    as(ADMIN_ID, `SELECT public.reconcile_voyage_vehicle_sheet_alerts(${V_DONE}, 'teste_627');`)
    expect(item(DECL, V_DONE)).toBe('active|normal|equipamentos')
    expect(rpcAs(EQP_ID, `SELECT public.declare_voyage_without_vehicles(${V_DONE});`).stderr).toBe('')
    expect(item(DECL, V_DONE)).toMatch(/^resolved\|/)
    expect(linkCe(BL_DONE, '152659500000005').stderr).toBe('')
  })

  it('só usuário interno ativo responde; a trava e a gravação interna não são expostas', () => {
    expect(psql(`SELECT has_function_privilege('authenticated', 'public.voyage_ce_mercante_vehicle_lock(bigint)', 'EXECUTE');`)).toBe('f')
    expect(psql(`SELECT has_function_privilege('authenticated', 'public._declare_voyage_vehicle_presence(bigint,boolean,text)', 'EXECUTE');`)).toBe('f')
    expect(psql(`SELECT has_function_privilege('anon', 'public.declare_voyage_with_vehicles(bigint,text)', 'EXECUTE');`)).toBe('f')
    const anonymous = spawnPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', `
      BEGIN; SET LOCAL ROLE authenticated; SELECT public.declare_voyage_with_vehicles(${V_MAIN}); COMMIT;`], { encoding: 'utf8' })
    expect(anonymous.stderr).toContain('Somente usuário interno ativo responde se a viagem terá veículos.')
  })

  // 599: com todo B/L de container já com CE, nada está travado: o alerta
  // continua cobrando a planilha, sem a frase da trava, e não avisa de novo.
  it('com todos os CEs de container vinculados, o crítico de D-5 não diz "travado"', () => {
    expect(item(SHEET, V_MAIN)).toBe('active|critical|equipamentos')
    expect(message(SHEET, V_MAIN)).toMatch(/travado até a importação\.$/)
    const notified = () => psql(`SELECT count(*) FROM public.internal_notifications n
      JOIN public.alert_items i ON i.id = n.alert_item_id JOIN public.alerts a ON a.id = i.alert_id
      WHERE i.item_type = '${SHEET}' AND a.entity_id = '${V_MAIN}';`)
    const before = notified()
    // Manutenção (superusuário sem usuário na sessão) passa pela trava, como na 597.
    psql(`UPDATE public.bls SET ce_mercante = CASE id WHEN '${BL_CNTR}' THEN '152659500000011' ELSE '152659500000012' END
      WHERE id IN ('${BL_CNTR}', '${BL_CNTR2}');`)
    as(ADMIN_ID, `SELECT public.reconcile_voyage_vehicle_sheet_alerts(${V_MAIN});`)
    expect(item(SHEET, V_MAIN)).toBe('active|critical|equipamentos')
    expect(message(SHEET, V_MAIN)).toMatch(/^Planilha de Veículos ausente: a viagem foi declarada com veículos e nenhum veículo foi importado; ETA em \d{2}\/\d{2}\/\d{4}, prazo D-5 atingido\.$/)
    expect(notified()).toBe(before)
  })
})
