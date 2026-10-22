// Lote 3 da frente das importações (ADR 0095, decisão 12; revisão de
// 2026-10-21, achado F-08; migration 391): Navegantes (BRNVT) ≠ Itajaí (BRITJ)
// e Recife (BRREC) ≠ Suape (BRSUA) em toda comparação do banco, e os dados
// gravados com a forma juntada passam para o porto certo só com prova.
//
// Antes da 391 (`normalize_port_code` juntava os pares):
// - o Baplie com POD BRNVT numa Viagem com escala só em BRITJ era aceito;
// - o B/L de Navegantes cobria a escala de Itajaí em "B/Ls esperados" e
//   travava a exclusão da escala de Itajaí;
// - a tabela de Taxas Locais de Suape era escolhida para o B/L de Recife;
// - o Manifesto Mercante da rota CNSHA→BRNVT, o status "BLs e CEs" da escala e
//   a âncora do Comunicado ficavam em BRITJ.
//
// Namespace exclusivo: ids 99390xxx, B/Ls 'P390-*', containers 'PQCU390xxxx',
// usuário ...000390001, Nº de Manifesto '1226P3900000x', tabelas 'P390 *'.
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { execPsql, spawnPsql } from './localPsql'
import { describeWithProbe, syntheticCnpj } from './localTestData'

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const actorId = '00000000-0000-0000-0000-000000390001'
const carrierId = 99390001
const vesselId = 99390002
const voyageId = 99390003 // escala só em Itajaí, B/L de Navegantes
const repairVoyage = 99390004 // gravada como antes da 391: tudo de Navegantes
const mixedVoyage = 99390005 // Itajaí e Navegantes na mesma Viagem: sem prova, fica
const customerId = 99390006
const communicationId = 99390007
const suapeTable = 99390010
const recifeTable = 99390011
const voyages = [voyageId, repairVoyage, mixedVoyage]
const automaticReason = 'Atualização automática de BLs e CEs pela conciliação documental'
const claims = `SET LOCAL request.jwt.claim.role = 'authenticated'; SET LOCAL request.jwt.claim.sub = '${actorId}';`

/** Superusuário (fixture, inspeção e limpeza), com o ator na sessão. */
function psql(sql: string): string {
  return execPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', `BEGIN; ${claims} ${sql}; COMMIT;`],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

/** Papel `authenticated`, como o PostgREST executa a chamada da tela. */
function asUser(sql: string): { output: string; error: string | null } {
  const run = spawnPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c',
    `BEGIN; SET LOCAL ROLE authenticated; ${claims} ${sql}; COMMIT;`], { encoding: 'utf8' })
  const error = run.stderr.split('\n').find((line) => line.startsWith('ERROR:')) ?? null
  return { output: run.stdout.trim(), error: error?.trim() ?? null }
}

function probe(): boolean {
  if (!enabled) return false
  try {
    return psql(`SELECT public.normalize_port_code('BRNVT') = 'BRNVT'`) === 't'
  } catch {
    return false
  }
}

const describeLocal = describeWithProbe(probe, 'migration 391 aplicada')

/** Trecho de dados da migration, executado de novo sobre o cenário gravado como antes. */
function runRepair(): string {
  const sql = readFileSync('supabase/migrations/391_portos_navegantes_e_recife_separados.sql', 'utf8')
  const marker = '-- 3. Dados gravados'
  expect(sql.includes(marker)).toBe(true)
  return psql(sql.slice(sql.indexOf(marker)))
}

function cleanup() {
  const ids = voyages.join(',')
  psql(`
    SET LOCAL session_replication_role = replica;
    CREATE TEMP TABLE p390_bls ON COMMIT DROP AS SELECT id FROM public.bls WHERE id LIKE 'P390-%';
    DELETE FROM public.customer_communication_bls WHERE communication_id = ${communicationId};
    DELETE FROM public.customer_communications WHERE id = ${communicationId} OR customer_id = ${customerId};
    DELETE FROM public.bl_charge_table_links WHERE bl_id IN (SELECT id FROM p390_bls) OR charge_table_id IN (${suapeTable}, ${recifeTable});
    DELETE FROM public.charge_tables WHERE id IN (${suapeTable}, ${recifeTable});
    DELETE FROM public.baplie_containers WHERE voyage_id IN (${ids});
    DELETE FROM public.voyage_route_ce_master WHERE voyage_id IN (${ids});
    UPDATE public.bls SET manifesto_mercante_id = NULL WHERE id IN (SELECT id FROM p390_bls);
    DELETE FROM public.manifestos_mercante WHERE voyage_id IN (${ids});
    DELETE FROM public.import_effect_attempts WHERE effect_id IN (SELECT id FROM public.import_pending_effects
      WHERE entity_id IN (SELECT id FROM p390_bls) OR entity_id IN (${voyages.map((id) => `'${id}'`).join(',')}) OR created_by = '${actorId}');
    DELETE FROM public.import_pending_effects WHERE entity_id IN (SELECT id FROM p390_bls)
      OR entity_id IN (${voyages.map((id) => `'${id}'`).join(',')}) OR created_by = '${actorId}';
    DELETE FROM public.bl_containers WHERE bl_id IN (SELECT id FROM p390_bls);
    DELETE FROM public.bls WHERE id IN (SELECT id FROM p390_bls);
    DELETE FROM public.import_batches WHERE voyage_id IN (${ids});
    DELETE FROM public.internal_notifications WHERE entity_id IN (${voyages.map((id) => `'${id}'`).join(',')})
      OR ${voyages.map((id) => `entity_id LIKE '${id}::%'`).join(' OR ')};
    DELETE FROM public.alert_items WHERE metadata->>'voyage_id' IN (${voyages.map((id) => `'${id}'`).join(',')})
      OR alert_id IN (SELECT id FROM public.alerts WHERE entity_id IN (${voyages.map((id) => `'${id}'`).join(',')})
        OR ${voyages.map((id) => `entity_id LIKE '${id}::%'`).join(' OR ')});
    DELETE FROM public.alerts WHERE entity_id IN (${voyages.map((id) => `'${id}'`).join(',')})
      OR ${voyages.map((id) => `entity_id LIKE '${id}::%'`).join(' OR ')};
    DELETE FROM public.audit_logs WHERE changed_by = '${actorId}' OR entity_id IN (${voyages.map((id) => `'${id}'`).join(',')})
      OR ${voyages.map((id) => `entity_id LIKE '${id}::%'`).join(' OR ')}
      OR entity_id IN (SELECT id FROM p390_bls) OR entity_id IN ('${suapeTable}', '${recifeTable}');
    DELETE FROM public.voyage_documental_pending WHERE voyage_id IN (${ids});
    DELETE FROM public.voyage_documental_state WHERE voyage_id IN (${ids});
    DELETE FROM public.voyages WHERE id IN (${ids});
    DELETE FROM public.vessels WHERE id = ${vesselId};
    DELETE FROM public.carriers WHERE id = ${carrierId};
    DELETE FROM public.customers WHERE id = ${customerId};
    DELETE FROM public.user_profiles WHERE id = '${actorId}';
    DELETE FROM auth.users WHERE id = '${actorId}'
  `)
}

function insertBl(id: string, voyage: number, pod: string, container: string) {
  psql(`
    INSERT INTO public.bls (id, voyage_id, pol, pod, cargo_mode, financial_status, charge_status, customer_reconciliation_status, review_status)
    VALUES ('${id}', ${voyage}, 'CNSHA', '${pod}', 'container', 'pending', 'not_calculated', 'missing_customer', 'ok');
    INSERT INTO public.bl_containers (bl_id, container_number, type) VALUES ('${id}', '${container}', '40HC')
  `)
}

function alertStatus(itemType: string, entityId: string): string {
  return psql(`SELECT COALESCE((SELECT i.status FROM public.alert_items i JOIN public.alerts a ON a.id = i.alert_id
    WHERE a.entity_id = '${entityId}' AND i.item_type = '${itemType}' ORDER BY i.id DESC LIMIT 1), 'none')`)
}

describeLocal('Lote 3 das importações — Navegantes ≠ Itajaí e Recife ≠ Suape (391)', () => {
  beforeAll(() => {
    cleanup()
    const today = psql(`SELECT ((now() AT TIME ZONE 'America/Sao_Paulo')::date)::text`)
    psql(`
      INSERT INTO auth.users (id, email) VALUES ('${actorId}', 'p390@example.test');
      INSERT INTO public.user_profiles (id, full_name, role, active) VALUES ('${actorId}', 'P390 Administrativo', 'administrativo', true);
      INSERT INTO public.carriers (id, name) VALUES (${carrierId}, 'P390 Carrier');
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (${vesselId}, 'P390 NAVIO', ${carrierId});
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES
        (${voyageId}, ${vesselId}, 'P390V', 'active'),
        (${repairVoyage}, ${vesselId}, 'P390R', 'active'),
        (${mixedVoyage}, ${vesselId}, 'P390M', 'active');
      -- Escala só em Itajaí, com ETA hoje (prazo D-7 dos B/Ls esperados atingido).
      INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by) VALUES
        ('voyage_pod_schedule', '${voyageId}::BRITJ', 'eta', NULL, '${today}', '${actorId}')
    `)
    insertBl('P390-NVT', voyageId, 'BRNVT', 'PQCU3900001')
  })

  afterAll(() => { if (!process.env.P390_KEEP) cleanup() })

  it('normalize_port_code separa os quatro portos e conhece os apelidos do Baplie', () => {
    const values = ['BRNVT', 'NVT', 'Navegantes', 'BRITJ', 'ITJ', 'ITAJAÍ', 'BRREC', 'REC', 'Recife', 'BRSUA', 'SUA', 'SUAPE',
      'SEP', 'BRSPB', 'TCA', 'CNTCA', 'TAO', 'CNCAN']
    const literals = values.map((value) => `('${value}')`).join(', ')
    const result = psql(`SELECT string_agg(public.normalize_port_code(v) || '/' || public._baplie_port_key(v), ',' ORDER BY ord)
      FROM (SELECT v, row_number() OVER () AS ord FROM (VALUES ${literals}) t(v)) s`)
    expect(result.split(',')).toEqual([
      'BRNVT/BRNVT', 'BRNVT/BRNVT', 'BRNVT/BRNVT', 'BRITJ/BRITJ', 'BRITJ/BRITJ', 'BRITJ/BRITJ',
      'BRREC/BRREC', 'BRREC/BRREC', 'BRREC/BRREC', 'BRSUA/BRSUA', 'BRSUA/BRSUA', 'BRSUA/BRSUA',
      // 410: Sepetiba é apelido de Itaguaí (BRIGI).
      'BRIGI/BRIGI', 'BRIGI/BRIGI', 'CNTAC/CNTAC', 'CNTAC/CNTAC', 'CNTAO/CNTAO', 'CNNSA/CNNSA',
    ])
  })

  it('Baplie com POD de Navegantes numa Viagem com escala só em Itajaí é recusado', () => {
    const rows = [{
      container_number: 'PQCU3900001', size_type: '40HC', status: 'full', weight_kg: 3800, pol: 'CNSHA', pod: 'BRNVT',
      final_dest: null, bl_ref: null, slot: null, is_imo: false, imo_class: null, un_number: null, is_oog: false, ownership: null,
    }]
    const expected = psql(`SELECT public._baplie_staging_version(${voyageId})::text`)
    const result = asUser(`SELECT public.import_baplie_file_atomic(${voyageId}, $r$${JSON.stringify(rows)}$r$::jsonb,
      ARRAY['BRNVT']::text[], '${expected}'::jsonb, '{"voyage_number":"P390V"}'::jsonb)`)
    expect(result.error).toMatch(/fora das escalas da Viagem \(BRNVT\)/)
    expect(psql(`SELECT count(*) FROM public.baplie_containers WHERE voyage_id = ${voyageId}`)).toBe('0')
  })

  it('B/L de Navegantes não cobre a escala de Itajaí nem trava a exclusão dela', () => {
    psql(`SELECT public.reconcile_voyage_bl_expected_alerts(${voyageId}, 'teste_390')`)
    expect(alertStatus('voyage_bl_expected', String(voyageId))).toBe('active')

    const dryRun = asUser(`SELECT public.delete_escala(${voyageId}, 'BRITJ', true)`)
    expect(dryRun.error).toBeNull()
    expect(JSON.parse(dryRun.output).reasons).not.toContain('B/L vinculado à escala')
    // O mesmo B/L trava a escala do porto dele.
    const own = asUser(`SELECT public.delete_escala(${voyageId}, 'NVT', true)`)
    expect(JSON.parse(own.output).reasons).toContain('B/L vinculado à escala')
  })

  it('a tabela de Taxas Locais de Suape não é usada para B/L de Recife, nem pelo vínculo antigo', () => {
    psql(`
      INSERT INTO public.charge_tables (id, name, pod, valid_from, active, cargo_mode)
      VALUES (${suapeTable}, 'P390 Suape', 'BRSUA', '2026-01-01', true, 'container')
    `)
    insertBl('P390-REC', voyageId, 'BRREC', 'PQCU3900002')
    expect(psql(`SELECT COALESCE(public.resolve_local_charge_table_id('container', 'BRREC', NULL)::text, 'nenhuma')`)).toBe('nenhuma')
    expect(psql(`SELECT public.resolve_local_charge_table_id('container', 'SUAPE', NULL)`)).toBe(String(suapeTable))

    psql(`
      INSERT INTO public.charge_tables (id, name, pod, valid_from, active, cargo_mode)
      VALUES (${recifeTable}, 'P390 Recife', 'RECIFE', '2025-01-01', true, 'container');
      -- Vínculo gravado antes da 391, quando Recife caía no escopo de Suape.
      INSERT INTO public.bl_charge_table_links (bl_id, scope, charge_table_id) VALUES ('P390-REC', 'container', ${suapeTable})
    `)
    expect(psql(`SELECT public.resolve_local_charge_table_id('container', 'BRREC', NULL)`)).toBe(String(recifeTable))
    expect(psql(`SELECT public._bl_charge_table_for_scope('P390-REC', 'container', 'BRREC')`)).toBe(String(recifeTable))
    expect(psql(`SELECT table_id FROM public.resolve_bl_local_charge_table_ids('P390-REC')`)).toBe(String(recifeTable))
  })

  it('dados gravados com a forma juntada passam para Navegantes só com prova; a Viagem mista fica', () => {
    // Cenário gravado como antes da 391.
    insertBl('P390-R1', repairVoyage, 'BRNVT', 'PQCU3900011')
    insertBl('P390-R2', repairVoyage, 'NAVEGANTES', 'PQCU3900012')
    insertBl('P390-M1', mixedVoyage, 'BRITJ', 'PQCU3900021')
    insertBl('P390-M2', mixedVoyage, 'BRNVT', 'PQCU3900022')
    psql(`
      INSERT INTO public.manifestos_mercante (id, voyage_id, pol, pod, numero, natureza) VALUES
        ('00000000-0000-0000-0000-000099390101', ${repairVoyage}, 'CNSHA', 'BRITJ', '1226P39000001', 'carga'),
        ('00000000-0000-0000-0000-000099390102', ${mixedVoyage}, 'CNSHA', 'BRITJ', '1226P39000002', 'carga');
      -- O resto sem gatilhos: com a régua nova, a conciliação documental do
      -- próprio cenário reescreveria o status antes da migration.
      SET LOCAL session_replication_role = replica;
      UPDATE public.bls SET manifesto_mercante_id = '00000000-0000-0000-0000-000099390101' WHERE id IN ('P390-R1', 'P390-R2');
      UPDATE public.bls SET manifesto_mercante_id = '00000000-0000-0000-0000-000099390102' WHERE id IN ('P390-M1', 'P390-M2');
      INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification) VALUES
        ('voyage_pod_schedule', '${repairVoyage}::BRNVT', 'eta', NULL, '2026-12-01', '${actorId}', NULL),
        ('voyage_pod_schedule', '${repairVoyage}::BRITJ', 'ces', 'waiting', 'received', NULL, '${automaticReason}'),
        ('voyage_pod_schedule', '${mixedVoyage}::BRITJ', 'ces', 'waiting', 'received', NULL, '${automaticReason}');
      INSERT INTO public.voyage_documental_state (voyage_id, port, direction, status) VALUES
        (${repairVoyage}, 'BRITJ', 'import', 'received'),
        (${mixedVoyage}, 'BRITJ', 'import', 'received')
      ON CONFLICT (voyage_id, port, direction) DO UPDATE SET status = EXCLUDED.status;
      UPDATE public.voyages SET pod_schedule_snapshot = '{"BRNVT": {"eta": "2026-12-01"}, "BRITJ": {"ces": "received"}}'::jsonb
      WHERE id = ${repairVoyage};
      INSERT INTO public.customers (id, name, cnpj_cpf) VALUES (${customerId}, 'CLIENTE P390', '${syntheticCnpj(390006)}');
      INSERT INTO public.customer_communications (id, customer_id, kind, nature, status, anchor_voyage_id, anchor_port)
      VALUES (${communicationId}, ${customerId}, 'aviso_chegada_noa', 'documentacao', 'simulado', ${repairVoyage}, 'BRITJ');
      INSERT INTO public.customer_communication_bls (communication_id, bl_id) VALUES (${communicationId}, 'P390-R1')
    `)
    expect(psql(`SELECT pod_schedule_snapshot ? 'BRITJ' FROM public.voyages WHERE id = ${repairVoyage}`)).toBe('t')
    // O espelho da rota nasce do Manifesto (gatilho), com o mesmo porto juntado.
    expect(psql(`SELECT pod FROM public.voyage_route_ce_master WHERE voyage_id = ${repairVoyage}`)).toBe('BRITJ')

    runRepair()

    // Viagem só de Navegantes: Manifesto, espelho, Histórico do status, resumo e Comunicado.
    expect(psql(`SELECT pol || '>' || pod FROM public.manifestos_mercante WHERE numero = '1226P39000001'`)).toBe('CNSHA>BRNVT')
    expect(psql(`SELECT pod FROM public.voyage_route_ce_master WHERE voyage_id = ${repairVoyage}`)).toBe('BRNVT')
    expect(psql(`SELECT string_agg(entity_id || ':' || field_name, ',' ORDER BY id) FROM public.audit_logs
      WHERE entity_type = 'voyage_pod_schedule' AND entity_id LIKE '${repairVoyage}::%'`))
      .toBe(`${repairVoyage}::BRNVT:eta,${repairVoyage}::BRNVT:ces`)
    expect(psql(`SELECT (pod_schedule_snapshot ? 'BRITJ')::text || '/' || (pod_schedule_snapshot -> 'BRNVT' ->> 'ces')
      FROM public.voyages WHERE id = ${repairVoyage}`)).toBe('false/received')
    expect(psql(`SELECT string_agg(port, ',') FROM public.voyage_documental_state WHERE voyage_id = ${repairVoyage}`)).toBe('BRNVT')
    expect(psql(`SELECT anchor_port FROM public.customer_communications WHERE id = ${communicationId}`)).toBe('BRNVT')

    // Viagem com Itajaí e Navegantes: não há como saber de qual porto era; fica.
    expect(psql(`SELECT pod FROM public.manifestos_mercante WHERE numero = '1226P39000002'`)).toBe('BRITJ')
    expect(psql(`SELECT count(*) FROM public.audit_logs WHERE entity_id = '${mixedVoyage}::BRITJ' AND field_name = 'ces'`)).toBe('1')
    expect(psql(`SELECT string_agg(port, ',' ORDER BY port) FROM public.voyage_documental_state WHERE voyage_id = ${mixedVoyage}`))
      .toBe('BRITJ,BRNVT')

    // Executar de novo não muda nada.
    const before = psql(`SELECT md5(string_agg(entity_id || field_name, ',' ORDER BY id)) FROM public.audit_logs
      WHERE entity_type = 'voyage_pod_schedule' AND (entity_id LIKE '${repairVoyage}::%' OR entity_id LIKE '${mixedVoyage}::%')`)
    runRepair()
    expect(psql(`SELECT md5(string_agg(entity_id || field_name, ',' ORDER BY id)) FROM public.audit_logs
      WHERE entity_type = 'voyage_pod_schedule' AND (entity_id LIKE '${repairVoyage}::%' OR entity_id LIKE '${mixedVoyage}::%')`)).toBe(before)
    expect(psql(`SELECT pol || '>' || pod FROM public.manifestos_mercante WHERE numero = '1226P39000001'`)).toBe('CNSHA>BRNVT')
  })
})
