import { resolve } from 'node:path'
import { execPsql, spawnPsql } from './localPsql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// Migration 325 (lote 5b da identidade, frente Granito; regra decidida em
// 2026-10-19): o Granito não tem Cliente nem cálculo de taxas. A importação
// ignora o vínculo e a sugestão de Cliente do arquivo e não deixa efeito de
// cálculo na fila; o alerta "Revisão de Granito — cliente não vinculado" sai
// do catálogo e os abertos são fechados; a planilha de CE Mercante recusa o
// alvo Granito; cálculo e revisão do Granito perdem o EXECUTE de
// `authenticated`.
//
// Migration 329 (decisão do responsável de 2026-10-19): as tarifas
// (`granite_rates`) e o cálculo (`calculate_granite_bl_charges`) saem do banco;
// os snapshots antigos de `granite_bl_charges` ficam, e a exclusão e a
// reativação de cadastro seguem valendo para os outros cadastros.
//
// Namespace exclusivo: ids 99325xxx, B/Ls 'A325-*', usuário ...000000325001;
// 329: B/L 'A329-*', usuário ...000000329001, tarifas e Local 'A329*'.
const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const describeLocal = enabled ? describe : describe.skip
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'
const migrationPath = resolve(process.cwd(), 'supabase/migrations/325_granito_sem_cliente_e_sem_calculo.sql')
const migration329Path = resolve(process.cwd(), 'supabase/migrations/329_granito_sem_tarifas_e_baixa_por_txid_fechada.sql')

const userId = '00000000-0000-0000-0000-000000325001'
const carrierId = 99325001
const vesselId = 99325002
const voyageId = 99325003
const customerId = 99325004
const legacyBlId = '00000000-0000-0000-0000-000000325010'
const legacyManifestId = '00000000-0000-0000-0000-000000325011'

function psql(sql: string): string {
  return execPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', sql],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function asUser(sql: string): { stdout: string; stderr: string } {
  const run = spawnPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c',
    `SET ROLE authenticated; SET request.jwt.claim.role = 'authenticated'; SET request.jwt.claim.sub = '${userId}'; ${sql}`],
  { encoding: 'utf8' })
  return { stdout: run.stdout.trim(), stderr: run.stderr }
}

const voyageBls = `(SELECT g.id FROM public.granite_bls g JOIN public.granite_manifests m ON m.id = g.manifest_id WHERE m.voyage_id = ${voyageId})`

function cleanup() {
  psql(`
    SET session_replication_role = replica;
    DELETE FROM public.alerts WHERE entity_type = 'granite_bl' AND entity_id = '${legacyBlId}';
    DELETE FROM public.alerts WHERE entity_type = 'import_effect' AND entity_id IN (
      SELECT id::text FROM public.import_pending_effects WHERE entity_id IN (SELECT id::text FROM ${voyageBls} AS x) OR created_by = '${userId}');
    DELETE FROM public.import_effect_attempts WHERE effect_id IN (
      SELECT id FROM public.import_pending_effects WHERE entity_id IN (SELECT id::text FROM ${voyageBls} AS x) OR created_by = '${userId}');
    DELETE FROM public.import_pending_effects WHERE entity_id IN (SELECT id::text FROM ${voyageBls} AS x) OR created_by = '${userId}';
    DELETE FROM public.granite_bls WHERE id IN ${voyageBls};
    DELETE FROM public.granite_manifests WHERE voyage_id = ${voyageId};
    DELETE FROM public.audit_logs WHERE changed_by = '${userId}' OR entity_id LIKE 'A325-%';
    DELETE FROM public.voyages WHERE id = ${voyageId};
    DELETE FROM public.vessels WHERE id = ${vesselId};
    DELETE FROM public.carriers WHERE id = ${carrierId};
    DELETE FROM public.customer_portal_accounts WHERE customer_id = ${customerId};
    DELETE FROM public.customers WHERE id = ${customerId};
    DELETE FROM public.user_profiles WHERE id = '${userId}';
    DELETE FROM auth.users WHERE id = '${userId}';
    SET session_replication_role = origin;
  `)
}

function bl(number: string) {
  return {
    bl_number: number, client_id: customerId, suggested_client_id: customerId, sequence: 1,
    real_weight_kg: 1000, blocks_qty: 3, vessel_voyage: 'A325 NAVIO/A325', loading_port: 'BRVIX', discharge_port: 'CNXMN',
  }
}

function importFile(bls: unknown[]) {
  return asUser(`SELECT public.import_granite_manifest_transactional(${voyageId}, 'A325 NAVIO/A325', 'BRVIX', 'CNXMN',
    ${bls.length}, 1000, '${userId}', '${JSON.stringify(bls)}'::jsonb, NULL);`)
}

// A 325 revoga o EXECUTE de `calculate_granite_bl_charges`, que a 329 apagou.
// Para reaplicá-la sobre o banco atual, a função volta como casca vazia só
// dentro da mesma transação, e sai no fim (num banco sem a 329, nada muda).
const STUB_MARK = 'casca-a325-reaplicacao'
const stubCalculate = `DO $stub$ BEGIN
  IF to_regprocedure('public.calculate_granite_bl_charges(uuid,uuid)') IS NULL THEN
    CREATE FUNCTION public.calculate_granite_bl_charges(uuid, uuid) RETURNS void
      LANGUAGE sql SET search_path = '' AS $f$ SELECT NULL::void /* ${STUB_MARK} */ $f$;
  END IF;
END $stub$;`
const dropStub = `DO $stub$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE oid = to_regprocedure('public.calculate_granite_bl_charges(uuid,uuid)') AND prosrc LIKE '%${STUB_MARK}%') THEN
    DROP FUNCTION public.calculate_granite_bl_charges(uuid, uuid);
  END IF;
END $stub$;`

function reapplyMigration() {
  execPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-q', '-1', '-d', databaseUrl, '-c', stubCalculate, '-f', migrationPath, '-c', dropStub], { encoding: 'utf8' })
}

describeLocal('Granito sem Cliente e sem cálculo de taxas (migration 325)', () => {
  beforeAll(() => {
    cleanup()
    psql(`
      INSERT INTO auth.users (id, email) VALUES ('${userId}', 'a325-doc@example.test');
      INSERT INTO public.user_profiles (id, full_name, role, active) VALUES ('${userId}', 'A325 Documentação', 'documentacao', true);
      INSERT INTO public.customers (id, cnpj_cpf, name) VALUES (${customerId}, '99325004000107', 'A325 CLIENTE');
      INSERT INTO public.carriers (id, name) VALUES (${carrierId}, 'A325 Carrier');
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (${vesselId}, 'A325 NAVIO', ${carrierId});
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES (${voyageId}, ${vesselId}, 'A325', 'active');
    `)
  })

  afterAll(cleanup)

  it('a importação grava o B/L sem Cliente nem sugestão, mesmo que o arquivo traga', () => {
    const first = importFile([bl('A325-1'), bl('A325-2')])
    expect(first.stderr).toBe('')
    expect(JSON.parse(first.stdout)).toMatchObject({ new_manifest: true, inserted_bls: 2 })
    expect(psql(`SELECT string_agg(bl_number || ':' || COALESCE(client_id::text, '-') || ':' || COALESCE(suggested_client_id::text, '-'), ',' ORDER BY bl_number)
      FROM public.granite_bls WHERE id IN ${voyageBls};`)).toBe('A325-1:-:-,A325-2:-:-')

    // Reimportação com B/L novo: também sem vínculo.
    const again = importFile([bl('A325-1'), bl('A325-2'), bl('A325-3')])
    expect(again.stderr).toBe('')
    expect(JSON.parse(again.stdout)).toMatchObject({ new_manifest: false, inserted_bls: 1 })
    expect(psql(`SELECT count(*) FROM public.granite_bls WHERE id IN ${voyageBls} AND (client_id IS NOT NULL OR suggested_client_id IS NOT NULL);`)).toBe('0')
  })

  it('a importação não deixa efeito de cálculo na fila nem abre alerta de Cliente', () => {
    expect(psql(`SELECT count(*) FROM public.import_pending_effects WHERE effect_kind = 'granite_billing' AND entity_id IN (SELECT id::text FROM ${voyageBls} AS x);`)).toBe('0')
    expect(psql(`SELECT count(*) FROM public.alerts a JOIN public.alert_items i ON i.alert_id = a.id
      WHERE a.entity_type = 'granite_bl' AND a.entity_id IN (SELECT id::text FROM ${voyageBls} AS x);`)).toBe('0')
    expect(psql(`SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.granite_bls'::regclass AND tgname = 'trg_reconcile_granite_bl_review_alerts';`)).toBe('0')
  })

  it('a recusa da importação chega em português, sem o texto cru do banco (G7)', () => {
    const missingVoyage = asUser(`SELECT public.import_granite_manifest_transactional(99325999, 'A325 NAVIO/A325', 'BRVIX', 'CNXMN',
      1, 1000, '${userId}', '${JSON.stringify([bl('A325-X')])}'::jsonb, NULL);`)
    expect(missingVoyage.stderr).toContain('Viagem de destino não encontrada.')
  })

  it('o alerta sai do catálogo, e o aberto é fechado pela migration', () => {
    expect(psql(`SELECT active FROM public.alert_type_catalog WHERE type = 'review_granite_customer_unlinked';`)).toBe('f')
    psql(`
      SET session_replication_role = replica;
      INSERT INTO public.granite_manifests (id, voyage_id, vessel_voyage) VALUES ('${legacyManifestId}', ${voyageId}, 'A325 NAVIO/A325');
      INSERT INTO public.granite_bls (id, manifest_id, bl_number) VALUES ('${legacyBlId}', '${legacyManifestId}', 'A325-L');
      WITH a AS (
        INSERT INTO public.alerts (type, entity_type, entity_id, message, status)
        VALUES ('aggregate', 'granite_bl', '${legacyBlId}', 'Vincule o Cliente na Revisão.', 'open') RETURNING id)
      INSERT INTO public.alert_items (alert_id, item_type, source, severity, department, message, status)
      SELECT id, 'review_granite_customer_unlinked', 'granite_review_gate', 'normal', 'documentacao', 'Vincule o Cliente na Revisão.', 'active' FROM a;
      SET session_replication_role = origin;
    `)

    reapplyMigration()

    expect(psql(`SELECT i.status || ':' || a.status FROM public.alert_items i JOIN public.alerts a ON a.id = i.alert_id
      WHERE a.entity_type = 'granite_bl' AND a.entity_id = '${legacyBlId}';`)).toBe('resolved:closed')
    expect(psql(`SELECT count(*) FROM public.alert_item_events e JOIN public.alert_items i ON i.id = e.alert_item_id
      JOIN public.alerts a ON a.id = i.alert_id WHERE a.entity_id = '${legacyBlId}' AND e.event_type = 'resolved';`)).toBe('1')
    // O tipo inativo não abre mais: o detector não acha pendência e o upsert recusa.
    expect(psql(`SELECT public.detect_granite_bl_review_pendencies();`)).toBe('0')
    expect(() => psql(`BEGIN; SELECT set_config('request.jwt.claim.role', 'service_role', true);
      SELECT public.upsert_alert_item('review_granite_customer_unlinked', 'granite_bl', '${legacyBlId}', 'x', 'a325', '{}'::jsonb, NULL); COMMIT;`))
      .toThrow(/fora do catálogo/)
  })

  it('o efeito de cálculo que estava na fila termina sem agir', () => {
    psql(`INSERT INTO public.import_pending_effects (source_action_id, effect_kind, entity_id, created_by)
      VALUES (gen_random_uuid(), 'granite_billing', '${legacyBlId}', '${userId}');`)
    reapplyMigration()
    expect(psql(`SELECT status || ':' || (result->>'reason') FROM public.import_pending_effects
      WHERE effect_kind = 'granite_billing' AND entity_id = '${legacyBlId}';`)).toBe('superseded:granito_sem_calculo')
    expect(psql(`SELECT public._run_import_effect_granite_billing('${legacyBlId}', '${userId}')->>'skipped';`)).toBe('granito_sem_calculo')
    expect(psql(`SELECT count(*) FROM public.granite_bl_charges WHERE bl_id = '${legacyBlId}';`)).toBe('0')
  })

  it('a planilha de CE Mercante recusa o alvo Granito', () => {
    const refused = asUser(`SELECT public.apply_ce_mercante_rows_atomic('[{"row":2,"bl_id":"${legacyBlId}","ce":"993250000000001"}]'::jsonb, '${userId}'::uuid, 'granite');`)
    expect(refused.stderr).toContain('não se aplica ao Granito')
    expect(psql(`SELECT COALESCE(ce_mercante, '-') FROM public.granite_bls WHERE id = '${legacyBlId}';`)).toBe('-')
  })

  it('cálculo e revisão do Granito não são executáveis pela API', () => {
    // O cálculo saiu do banco na 329; a revisão segue sem EXECUTE da API.
    expect(psql(`SELECT to_regprocedure('public.calculate_granite_bl_charges(uuid,uuid)') IS NULL;`)).toBe('t')
    const fn = 'public.save_granite_bl_review(uuid,bigint,uuid)'
    expect(psql(`SELECT has_function_privilege('authenticated', '${fn}', 'EXECUTE');`)).toBe('f')
    expect(psql(`SELECT has_function_privilege('anon', '${fn}', 'EXECUTE');`)).toBe('f')
    expect(psql(`SELECT has_function_privilege('authenticated', 'public.import_granite_manifest_transactional(bigint,text,text,text,integer,numeric,uuid,jsonb,text[])', 'EXECUTE');`)).toBe('t')
  })
})

const adminId = '00000000-0000-0000-0000-000000329001'
const a329ManifestId = '00000000-0000-0000-0000-000000329010'
const a329BlId = '00000000-0000-0000-0000-000000329011'
const a329RateId = '00000000-0000-0000-0000-000000329012'
const a329ChargeId = '00000000-0000-0000-0000-000000329013'
const a329DepotId = '00000000-0000-0000-0000-000000329020'

function asAdmin(sql: string): { stdout: string; stderr: string } {
  const run = spawnPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c',
    `SET ROLE authenticated; SET request.jwt.claim.role = 'authenticated'; SET request.jwt.claim.sub = '${adminId}'; ${sql}`],
  { encoding: 'utf8' })
  return { stdout: run.stdout.trim(), stderr: run.stderr }
}

function cleanup329() {
  psql(`
    SET session_replication_role = replica;
    DELETE FROM public.granite_bl_charges WHERE id = '${a329ChargeId}';
    DELETE FROM public.granite_bls WHERE id = '${a329BlId}';
    DELETE FROM public.granite_manifests WHERE id = '${a329ManifestId}';
    DELETE FROM public.demurrage_rates WHERE notes LIKE 'A329%';
    DELETE FROM public.depots WHERE id = '${a329DepotId}';
    DELETE FROM public.audit_logs WHERE changed_by = '${adminId}' OR entity_id = '${a329DepotId}';
    DELETE FROM public.user_profiles WHERE id = '${adminId}';
    DELETE FROM auth.users WHERE id = '${adminId}';
    SET session_replication_role = origin;
  `)
}

function demurrageRate(note: string, validFrom: string, active = true): string {
  return psql(`INSERT INTO public.demurrage_rates (container_type, p1_day_from, p1_day_to, p1_usd, p2_day_from, p2_usd, valid_from, active, notes)
    VALUES ('A329', 1, 5, 10, 6, 20, ${validFrom}, ${active}, '${note}') RETURNING id;`)
}

describeLocal('Granito sem tarifas nem cálculo no banco (migration 329)', () => {
  beforeAll(() => {
    cleanup329()
    psql(`
      INSERT INTO auth.users (id, email) VALUES ('${adminId}', 'a329-adm@example.test');
      INSERT INTO public.user_profiles (id, full_name, role, active) VALUES ('${adminId}', 'A329 Administrativo', 'administrativo', true);
    `)
  })

  afterAll(cleanup329)

  it('a tabela de tarifas, a FK do snapshot e o cálculo saíram do banco', () => {
    expect(psql(`SELECT to_regclass('public.granite_rates') IS NULL;`)).toBe('t')
    expect(psql(`SELECT to_regprocedure('public.calculate_granite_bl_charges(uuid,uuid)') IS NULL;`)).toBe('t')
    expect(psql(`SELECT count(*) FROM pg_constraint WHERE conname = 'granite_bl_charges_rate_id_fkey';`)).toBe('0')
    expect(psql(`SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND prosrc LIKE '%granite_rates%';`)).toBe('0')
  })

  it('apagar as tarifas preserva o snapshot antigo com o id histórico da tarifa', () => {
    // Monta o estado anterior à 329 (tabela, FK e snapshot que aponta para a
    // tarifa) e reaplica a migration.
    psql(`
      CREATE TABLE public.granite_rates (id uuid PRIMARY KEY, description text NOT NULL);
      INSERT INTO public.granite_rates (id, description) VALUES ('${a329RateId}', 'A329 THC');
      ALTER TABLE public.granite_bl_charges ADD CONSTRAINT granite_bl_charges_rate_id_fkey
        FOREIGN KEY (rate_id) REFERENCES public.granite_rates(id) ON DELETE SET NULL;
      INSERT INTO public.granite_manifests (id, vessel_voyage) VALUES ('${a329ManifestId}', 'A329 NAVIO/A329');
      INSERT INTO public.granite_bls (id, manifest_id, bl_number) VALUES ('${a329BlId}', '${a329ManifestId}', 'A329-1');
      INSERT INTO public.granite_bl_charges (id, bl_id, rate_id, description, charge_type, unit_value, quantity, subtotal, currency)
      VALUES ('${a329ChargeId}', '${a329BlId}', '${a329RateId}', 'A329 THC', 'per_bl', 45, 1, 45, 'BRL');
    `)
    execPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-q', '-1', '-d', databaseUrl, '-f', migration329Path], { encoding: 'utf8' })

    expect(psql(`SELECT to_regclass('public.granite_rates') IS NULL;`)).toBe('t')
    expect(psql(`SELECT rate_id || ':' || subtotal FROM public.granite_bl_charges WHERE id = '${a329ChargeId}';`)).toBe(`${a329RateId}:45.00`)
  })

  it('a exclusão e a reativação de cadastro seguem valendo para os outros cadastros', () => {
    // Tarifa de Demurrage em vigor: a trava de tarifa usada continua.
    const inForce = demurrageRate('A329 em vigor', 'CURRENT_DATE - 1')
    expect(asAdmin(`SELECT public.delete_catalog_row('demurrage_rates', '${inForce}', 'Teste A329')`).stderr).toContain('já foi usada')
    // Tarifa futura: exclui com motivo.
    const future = demurrageRate('A329 futura', 'CURRENT_DATE + 30')
    expect(asAdmin(`SELECT public.delete_catalog_row('demurrage_rates', '${future}', 'Teste A329')`).stderr).toBe('')
    expect(psql(`SELECT count(*) FROM public.demurrage_rates WHERE id = ${future};`)).toBe('0')
    // Reativação de tarifa e de Local inativos.
    const inactive = demurrageRate('A329 inativa', 'CURRENT_DATE - 1', false)
    expect(asAdmin(`SELECT public.reactivate_catalog_row('demurrage_rates', '${inactive}', 'Volta A329')`).stderr).toBe('')
    expect(psql(`SELECT active FROM public.demurrage_rates WHERE id = ${inactive};`)).toBe('t')
    psql(`INSERT INTO public.depots (id, code, name, active) VALUES ('${a329DepotId}', 'A329', 'A329 Local', false);`)
    expect(asAdmin(`SELECT public.reactivate_catalog_row('depots', '${a329DepotId}', 'Volta A329')`).stderr).toBe('')
    expect(psql(`SELECT active FROM public.depots WHERE id = '${a329DepotId}';`)).toBe('t')
    expect(asAdmin(`SELECT public.delete_catalog_row('depots', '${a329DepotId}', 'Teste A329')`).stderr).toBe('')
    expect(psql(`SELECT count(*) FROM public.depots WHERE id = '${a329DepotId}';`)).toBe('0')
  })

  it('a tarifa de Granito saiu da exclusão e da reativação de cadastro', () => {
    expect(asAdmin(`SELECT public.delete_catalog_row('granite_rates', '${a329RateId}', 'Teste A329')`).stderr).toContain('Tabela fora da exclusão de cadastro')
    expect(asAdmin(`SELECT public.reactivate_catalog_row('granite_rates', '${a329RateId}', 'Teste A329')`).stderr).toContain('Tabela fora da reativação de cadastro')
  })
})
