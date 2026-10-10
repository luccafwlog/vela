// Etapa 9 do plano de correção das importações (migration 182; ADR 0078,
// item 21): marcas físicas do Baplie em todos os B/Ls ativos que dividem o
// container, perfil manual protegido, Baplie completo (o que sai apaga as
// marcas vindas dele, com prévia) e "Vale o B/L" na divergência de SOC/COC.
//
// Namespace exclusivo: ids 99229xxx, B/Ls 'A229-*', usuário ...0000002290NN,
// containers 'ADCU229xxxx'.
import { execFileSync, spawnSync } from 'node:child_process'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const describeLocal = enabled ? describe : describe.skip
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const actorId = '00000000-0000-0000-0000-000000229001'
const carrierId = 99229001
const vesselId = 99229002
const voyageId = 99229003

function psql(sql: string): string {
  return execFileSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c',
    `SET request.jwt.claim.role = 'service_role'; SET request.jwt.claim.sub = '${actorId}'; ${sql}`],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function asAdmin(sql: string): { output: string; error: string | null } {
  const run = spawnSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c',
    `SET ROLE authenticated; SET request.jwt.claim.role = 'authenticated'; SET request.jwt.claim.sub = '${actorId}'; ${sql}`],
  { encoding: 'utf8' })
  const error = run.stderr.split('\n').find((line) => line.startsWith('ERROR:')) ?? null
  return { output: run.stdout.trim(), error: error?.trim() ?? null }
}

function json<T>(sql: string): T {
  const result = asAdmin(sql)
  if (result.error) throw new Error(result.error)
  return JSON.parse(result.output) as T
}

type Staged = { container_number: string; status?: string; is_imo?: boolean; imo_class?: string | null; un_number?: string | null; is_oog?: boolean; ownership?: string | null }

function stage(rows: Staged[]) {
  const payload = rows.map((row) => ({
    container_number: row.container_number, size_type: '40HC', status: row.status ?? 'full', weight_kg: 10000,
    pol: 'A229O', pod: 'A229P', final_dest: null, bl_ref: null, slot: null,
    is_imo: row.is_imo ?? false, imo_class: row.imo_class ?? null, un_number: row.un_number ?? null,
    is_oog: row.is_oog ?? false, ownership: row.ownership ?? null,
  }))
  expect(asAdmin(`SELECT public.import_baplie_staging_transactional(${voyageId}, $json$${JSON.stringify(payload)}$json$::jsonb);`).error).toBeNull()
  return payload
}

function apply() {
  return json<{ applied: number; applied_to: Array<{ container: string; bl_id: string }>; cleared: Array<{ container: string; bl_id: string }>; divergent_manual: Array<{ container: string; bl_id: string }> }>(
    `SELECT public.apply_baplie_physical_flags_atomic(${voyageId}, NULL, '${actorId}'::uuid);`)
}

function container(blId: string, number: string): { is_imo: boolean; is_oog: boolean; ownership: string | null; profile_source: string | null; ownership_source: string | null } {
  return JSON.parse(psql(`
    SELECT row_to_json(t) FROM (SELECT is_imo, is_oog, ownership, profile_source, ownership_source FROM public.bl_containers
    WHERE bl_id = '${blId}' AND container_number = '${number}') AS t;
  `))
}

function cleanup() {
  psql(`
    SET session_replication_role = replica;
    CREATE TEMP TABLE a229_bls AS SELECT id FROM public.bls WHERE id LIKE 'A229-%';
    DELETE FROM public.baplie_reconciliation_resolutions WHERE voyage_id = ${voyageId};
    DELETE FROM public.baplie_containers WHERE voyage_id = ${voyageId};
    DELETE FROM public.charge_calculations WHERE bl_id IN (SELECT id FROM a229_bls);
    DELETE FROM public.billing_run_logs WHERE bl_id IN (SELECT id FROM a229_bls);
    DELETE FROM public.import_effect_attempts WHERE effect_id IN (SELECT id FROM public.import_pending_effects WHERE entity_id IN (SELECT id FROM a229_bls) OR entity_id = '${voyageId}');
    DELETE FROM public.import_pending_effects WHERE entity_id IN (SELECT id FROM a229_bls) OR entity_id = '${voyageId}';
    DELETE FROM public.audit_logs WHERE entity_id IN (SELECT id FROM a229_bls) OR (entity_type IN ('voyage', 'voyages') AND entity_id = '${voyageId}') OR changed_by = '${actorId}';
    DELETE FROM public.alert_items WHERE alert_id IN (SELECT id FROM public.alerts WHERE entity_id IN ('${voyageId}') OR entity_id IN (SELECT id FROM a229_bls));
    DELETE FROM public.alerts WHERE entity_id IN ('${voyageId}') OR entity_id IN (SELECT id FROM a229_bls);
    DELETE FROM public.bl_containers WHERE bl_id IN (SELECT id FROM a229_bls);
    DELETE FROM public.customer_reconciliation_queue WHERE bl_id IN (SELECT id FROM a229_bls);
    DELETE FROM public.bls WHERE id IN (SELECT id FROM a229_bls);
    DELETE FROM public.voyage_documental_pending WHERE voyage_id = ${voyageId};
    DELETE FROM public.voyage_documental_state WHERE voyage_id = ${voyageId};
    DELETE FROM public.voyages WHERE id = ${voyageId};
    DELETE FROM public.vessels WHERE id = ${vesselId};
    DELETE FROM public.carriers WHERE id = ${carrierId};
    DELETE FROM public.user_profiles WHERE id = '${actorId}';
    DELETE FROM auth.users WHERE id = '${actorId}';
    SET session_replication_role = origin;
  `)
}

function insertBl(id: string, containers: Array<{ number: string; ownership?: 'SOC' | 'COC' }>) {
  psql(`
    INSERT INTO public.bls (id, voyage_id, pol, pod, cargo_mode, financial_status, charge_status, customer_reconciliation_status, review_status)
    VALUES ('${id}', ${voyageId}, 'A229O', 'A229P', 'container', 'pending', 'not_calculated', 'missing_customer', 'ok');
    INSERT INTO public.bl_containers (bl_id, container_number, type, ownership, ownership_source) VALUES
    ${containers.map((c) => `('${id}', '${c.number}', '40HC', ${c.ownership ? `'${c.ownership}', 'bl'` : 'NULL, NULL'})`).join(', ')};
  `)
}

describeLocal('Etapa 9 — Baplie em todos os B/Ls do container, perfil manual, Baplie completo e Vale o B/L (migration 182)', () => {
  beforeAll(() => {
    cleanup()
    psql(`
      INSERT INTO auth.users (id, email) VALUES ('${actorId}', 'a229-admin@example.test');
      INSERT INTO public.user_profiles (id, full_name, role, active) VALUES ('${actorId}', 'A229 Administrativo', 'administrativo', true);
      INSERT INTO public.carriers (id, name) VALUES (${carrierId}, 'A229 Carrier');
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (${vesselId}, 'A229 NAVIO', ${carrierId});
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES (${voyageId}, ${vesselId}, 'A229', 'active');
    `)
    insertBl('A229-S1', [{ number: 'ADCU2290001' }])
    insertBl('A229-S2', [{ number: 'ADCU2290001' }, { number: 'ADCU2290002' }])
    insertBl('A229-SX', [{ number: 'ADCU2290001' }])
    insertBl('A229-M1', [{ number: 'ADCU2290003' }])
    insertBl('A229-O1', [{ number: 'ADCU2290004', ownership: 'COC' }])
    expect(JSON.parse(asAdmin(`SELECT public.cancel_bl('A229-SX', 'Armador reemitiu (A229)', false);`).output)).toMatchObject({ cancelled: true })
  })

  afterAll(cleanup)

  it('a marca do Baplie vale para todos os B/Ls ativos que dividem o container; o cancelado fica de fora', () => {
    stage([
      { container_number: 'ADCU2290001', is_imo: true, imo_class: '3', un_number: '1263' },
      { container_number: 'ADCU2290002', is_oog: true },
      { container_number: 'ADCU2290003' },
      { container_number: 'ADCU2290004', ownership: 'SOC' },
    ])
    const result = apply()
    expect(result.applied_to.filter((item) => item.container === 'ADCU2290001').map((item) => item.bl_id).sort()).toEqual(['A229-S1', 'A229-S2'])
    expect(container('A229-S1', 'ADCU2290001')).toMatchObject({ is_imo: true, profile_source: 'baplie' })
    expect(container('A229-S2', 'ADCU2290001')).toMatchObject({ is_imo: true, profile_source: 'baplie' })
    expect(container('A229-SX', 'ADCU2290001')).toMatchObject({ is_imo: false })
    expect(container('A229-S2', 'ADCU2290002')).toMatchObject({ is_oog: true })
    // SOC/COC: vale o B/L; o Baplie não troca.
    expect(container('A229-O1', 'ADCU2290004')).toMatchObject({ ownership: 'COC', ownership_source: 'bl' })
  })

  it('perfil corrigido à mão não é sobrescrito: o Baplie diferente vira divergência', () => {
    expect(asAdmin(`SELECT public.set_bl_container_profile((SELECT id FROM public.bl_containers WHERE bl_id = 'A229-M1'), 'imo', 'Armador confirmou IMO fora do Baplie (A229)', '${actorId}'::uuid);`).error).toBeNull()
    expect(container('A229-M1', 'ADCU2290003')).toMatchObject({ is_imo: true, profile_source: 'manual' })
    const result = apply()
    expect(container('A229-M1', 'ADCU2290003')).toMatchObject({ is_imo: true, profile_source: 'manual' })
    expect(result.divergent_manual).toEqual([{ container: 'ADCU2290003', bl_id: 'A229-M1' }])
  })

  it('Baplie completo: a prévia lista o que cai e a gravação apaga só as marcas vindas do Baplie anterior', () => {
    const next = [
      { container_number: 'ADCU2290002', is_oog: true },
      { container_number: 'ADCU2290003' },
      { container_number: 'ADCU2290004', ownership: 'SOC' },
    ].map((row) => ({ ...row, status: 'full', is_imo: false, imo_class: null, un_number: null, is_oog: row.is_oog ?? false, ownership: row.ownership ?? null }))
    const preview = json<{ clear: Array<{ container: string; bl_id: string; before: string; after: string }> }>(
      `SELECT public.preview_baplie_physical_flags(${voyageId}, $json$${JSON.stringify(next)}$json$::jsonb);`)
    expect(preview.clear.map((item) => [item.container, item.bl_id, item.before, item.after])).toEqual([
      ['ADCU2290001', 'A229-S1', 'IMO', 'sem marca'],
      ['ADCU2290001', 'A229-S2', 'IMO', 'sem marca'],
    ])
    // A prévia não grava.
    expect(container('A229-S1', 'ADCU2290001')).toMatchObject({ is_imo: true })

    stage(next)
    const result = apply()
    expect(result.cleared.map((item) => item.bl_id).sort()).toEqual(['A229-S1', 'A229-S2'])
    expect(container('A229-S1', 'ADCU2290001')).toMatchObject({ is_imo: false, profile_source: null })
    // O manual continua.
    expect(container('A229-M1', 'ADCU2290003')).toMatchObject({ is_imo: true, profile_source: 'manual' })
  })

  it('Vale o B/L encerra a divergência de SOC/COC com motivo', () => {
    const id = psql(`SELECT id FROM public.bl_containers WHERE bl_id = 'A229-O1';`)
    expect(asAdmin(`SELECT public.resolve_baplie_divergence(${id}, 'ownership', NULL);`).error).toMatch(/motivo/)
    const resolved = json<{ baplie_value: string; bl_value: string }>(`SELECT public.resolve_baplie_divergence(${id}, 'ownership', 'B/L confirma COC (A229)');`)
    expect(resolved).toMatchObject({ baplie_value: 'SOC', bl_value: 'COC' })
    expect(container('A229-O1', 'ADCU2290004')).toMatchObject({ ownership: 'COC', ownership_source: 'manual' })
    expect(psql(`SELECT resolution || ':' || justification FROM public.baplie_reconciliation_resolutions WHERE bl_container_id = ${id};`))
      .toBe('vale_o_bl:B/L confirma COC (A229)')
  })
})
