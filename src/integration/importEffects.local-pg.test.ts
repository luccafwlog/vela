import { execFileSync } from 'node:child_process'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const describeLocal = enabled ? describe : describe.skip
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const actorId = '00000000-0000-0000-0000-000000017001'
const actionIds = [
  '00000000-0000-0000-0000-000000017101',
  '00000000-0000-0000-0000-000000017102',
  '00000000-0000-0000-0000-000000017103',
  '00000000-0000-0000-0000-000000017104',
  '00000000-0000-0000-0000-000000017105',
  '00000000-0000-0000-0000-000000017106',
  '00000000-0000-0000-0000-000000017107',
]
const graniteManifestId = '00000000-0000-0000-0000-000000017201'
const graniteBlId = '00000000-0000-0000-0000-000000017202'
const graniteRateId = '00000000-0000-0000-0000-000000017203'

function localPsql(sql: string, entityPrefix = 'S05-OUTBOX-%'): string {
  return execFileSync('psql', [
    '-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl,
    '-c', `SET request.jwt.claim.role = 'service_role'; SET request.jwt.claim.sub = '${actorId}'; SET import_effects.entity_prefix = '${entityPrefix}'; ${sql}`,
  ], { encoding: 'utf8' }).trim()
}

function authenticatedPsql(sql: string): string {
  return execFileSync('psql', [
    '-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl,
    '-c', `BEGIN; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.role = 'authenticated'; SET LOCAL request.jwt.claim.sub = '${actorId}'; ${sql} COMMIT;`,
  ], { encoding: 'utf8' }).trim()
}

function expectSqlFailure(sql: string, authenticated = false): void {
  expect(() => (authenticated ? authenticatedPsql(sql) : localPsql(sql))).toThrow()
}

type Effect = {
  id: number
  status: string
  attempts: number
  effect_kind: string
  entity_id: string
  source_revision: number
  leased_by: string | null
  depends_on_effect_id: number | null
}

function enqueue(actionId: string, kind: string, entity: string, revision = 1, dependency: number | null = null): { effect: Effect; idempotent: boolean } {
  return JSON.parse(localPsql(`
    SELECT public.enqueue_import_effect(
      '${actionId}'::uuid, '${kind}', '${entity}', '${actorId}'::uuid,
      ${revision}, ${dependency == null ? 'NULL' : dependency},
      jsonb_build_object('test', 'import-effects')
    );
  `)) as { effect: Effect; idempotent: boolean }
}

function cleanupTestData(): void {
  localPsql(`
    DELETE FROM public.alerts
    WHERE type = 'aggregate'
      AND entity_type = 'import_effect'
      AND entity_id IN (
        SELECT id::text
        FROM public.import_pending_effects
        WHERE source_action_id = ANY(ARRAY['${actionIds.join("','")}']::uuid[])
           OR entity_id LIKE 'S05-OUTBOX-%'
      );
    SET session_replication_role = replica;
    DELETE FROM public.import_effect_attempts
    WHERE effect_id IN (SELECT id FROM public.import_pending_effects
                        WHERE source_action_id = ANY(ARRAY['${actionIds.join("','")}']::uuid[])
                           OR entity_id LIKE 'S05-OUTBOX-%');
    DELETE FROM public.import_pending_effects
    WHERE source_action_id = ANY(ARRAY['${actionIds.join("','")}']::uuid[])
       OR entity_id LIKE 'S05-OUTBOX-%';
    SET session_replication_role = origin;
    DELETE FROM public.alert_item_events WHERE actor_id = '${actorId}';
    DELETE FROM public.audit_logs WHERE changed_by = '${actorId}';
  `)
}

function cleanupGraniteFixture(): void {
  localPsql(`
    DELETE FROM public.granite_bl_charges WHERE bl_id = '${graniteBlId}';
    DELETE FROM public.granite_bls WHERE id = '${graniteBlId}';
    DELETE FROM public.granite_manifests WHERE id = '${graniteManifestId}';
    DELETE FROM public.granite_rates WHERE id = '${graniteRateId}';
  `)
}

describeLocal('S05 — outbox duravel dos efeitos de import', () => {
  beforeAll(() => {
    cleanupGraniteFixture()
    cleanupTestData()
    localPsql(`
      DELETE FROM public.user_profiles WHERE id = '${actorId}';
      DELETE FROM auth.users WHERE id = '${actorId}';
      INSERT INTO auth.users (id, email) VALUES ('${actorId}', 's05-effects@example.test');
      INSERT INTO public.user_profiles (id, full_name, role, active)
      VALUES ('${actorId}', 'S05 Effects', 'admin', true);
    `)
  })

  afterAll(() => {
    cleanupGraniteFixture()
    cleanupTestData()
    localPsql(`
      DELETE FROM public.user_profiles WHERE id = '${actorId}';
      DELETE FROM auth.users WHERE id = '${actorId}';
    `)
  })

  it('mantem a identidade idempotente e supera a revisao antiga', () => {
    const first = enqueue(actionIds[0], 'physical_flags', 'S05-OUTBOX-REVISION')
    expect(first.idempotent).toBe(false)

    const repeat = enqueue(actionIds[0], 'physical_flags', 'S05-OUTBOX-REVISION')
    expect(repeat).toMatchObject({ idempotent: true, effect: { id: first.effect.id, status: 'pending' } })

    const newer = enqueue(actionIds[1], 'physical_flags', 'S05-OUTBOX-REVISION', 2)
    expect(newer.effect.id).not.toBe(first.effect.id)
    expect(localPsql(`SELECT status FROM public.import_pending_effects WHERE id = ${first.effect.id};`)).toBe('superseded')

    const claimed = JSON.parse(localPsql(`
      SELECT jsonb_agg(row_to_json(e))
      FROM public.claim_import_effects('revision-worker', 10, 300) AS e;
    `)) as Effect[]
    expect(claimed).toHaveLength(1)
    expect(claimed[0]).toMatchObject({ id: newer.effect.id, source_revision: 2, status: 'running' })

    const completed = JSON.parse(localPsql(`
      SELECT public.complete_import_effect(${newer.effect.id}, 'revision-worker', 'succeeded', '{"applied":1}'::jsonb);
    `)) as { effect: Effect; idempotent: boolean }
    expect(completed).toMatchObject({ idempotent: false, effect: { status: 'succeeded' } })

    const retryCompletion = JSON.parse(localPsql(`
      SELECT public.complete_import_effect(${newer.effect.id}, 'revision-worker', 'succeeded', '{"applied":1}'::jsonb);
    `)) as { effect: Effect; idempotent: boolean }
    expect(retryCompletion).toMatchObject({ idempotent: true, effect: { status: 'succeeded' } })
  })

  it('respeita dependencias e bloqueia descendentes de falha permanente', () => {
    const physical = enqueue(actionIds[2], 'physical_flags', 'S05-OUTBOX-DEPENDENCY')
    const provisional = enqueue(actionIds[3], 'provisional_charges', 'S05-OUTBOX-DEPENDENCY', 1, physical.effect.id)

    const claimed = JSON.parse(localPsql(`
      SELECT jsonb_agg(row_to_json(e))
      FROM public.claim_import_effects('dependency-worker', 10, 300) AS e;
    `)) as Effect[]
    expect(claimed).toHaveLength(1)
    expect(claimed[0].id).toBe(physical.effect.id)

    expectSqlFailure(`
      SELECT public.complete_import_effect(${physical.effect.id}, 'other-worker', 'succeeded');
    `)
    localPsql(`SELECT public.complete_import_effect(${physical.effect.id}, 'dependency-worker', 'blocked', NULL, 'invalid_payload', 'payload rejeitado');`)

    expect(localPsql(`SELECT count(*) FROM public.claim_import_effects('dependency-worker-2', 10, 300);`)).toBe('0')
    expect(localPsql(`SELECT status || ':' || COALESCE(last_error_code, '') FROM public.import_pending_effects WHERE id = ${provisional.effect.id};`)).toBe('blocked:dependency_blocked')
  })

  it('recupera lease vencida sem permitir dois workers simultaneos', () => {
    const queued = enqueue(actionIds[4], 'demurrage_billing', 'S05-OUTBOX-LEASE')
    const firstClaim = JSON.parse(localPsql(`
      SELECT row_to_json(e) FROM public.claim_import_effects('lease-worker-a', 10, 300) AS e;
    `)) as Effect
    expect(firstClaim.id).toBe(queued.effect.id)
    expect(localPsql(`SELECT count(*) FROM public.claim_import_effects('lease-worker-b', 10, 300);`)).toBe('0')

    localPsql(`UPDATE public.import_pending_effects SET lease_until = now() - interval '1 second' WHERE id = ${queued.effect.id};`)
    const recovered = JSON.parse(localPsql(`
      SELECT row_to_json(e) FROM public.claim_import_effects('lease-worker-b', 10, 300) AS e;
    `)) as Effect
    expect(recovered).toMatchObject({ id: queued.effect.id, status: 'running', attempts: 2, leased_by: 'lease-worker-b' })
    expect(localPsql(`SELECT count(*) FROM public.import_effect_attempts WHERE effect_id = ${queued.effect.id} AND event_kind = 'lease_expired';`)).toBe('1')

    localPsql(`SELECT public.complete_import_effect(${queued.effect.id}, 'lease-worker-b', 'succeeded');`)
    expect(localPsql(`SELECT count(*) FROM public.import_effect_attempts WHERE effect_id = ${queued.effect.id} AND event_kind = 'completed';`)).toBe('1')
  })

  it('fecha escrita do navegador e torna o historico append-only', () => {
    expectSqlFailure(`SELECT public.claim_import_effects('browser-worker', 1, 300);`, true)
    expectSqlFailure(`INSERT INTO public.import_pending_effects(source_action_id, effect_kind, entity_id) VALUES (gen_random_uuid(), 'physical_flags', 'S05-OUTBOX-UNAUTHORIZED');`, true)
    expectSqlFailure(`UPDATE public.import_effect_attempts SET error_message = 'alterado' WHERE effect_id IS NOT NULL;`, true)
  })

  it('processa erro de domínio como bloqueio auditável, sem deixar o efeito quente', () => {
    const queued = enqueue(actionIds[5], 'provisional_charges', 'S05-OUTBOX-MISSING')
    const claimed = JSON.parse(localPsql(`
      SELECT row_to_json(e) FROM public.claim_import_effects('process-worker', 10, 300) AS e;
    `)) as Effect
    expect(claimed.id).toBe(queued.effect.id)

    const processed = JSON.parse(localPsql(`
      SELECT public.process_import_effect(${queued.effect.id}, 'process-worker');
    `)) as { effect: Effect }
    expect(processed.effect).toMatchObject({ status: 'blocked', last_error_code: 'effect_domain_missing' })
    expect(localPsql(`SELECT count(*) FROM public.import_effect_attempts WHERE effect_id = ${queued.effect.id} AND event_kind = 'completed' AND status = 'blocked';`)).toBe('1')
    expect(localPsql(`
      SELECT count(*)
      FROM public.alert_items i
      JOIN public.alerts a ON a.id = i.alert_id
      WHERE i.item_type = 'import_effect_blocked'
        AND i.status = 'active'
        AND a.entity_type = 'import_effect'
        AND a.entity_id = '${queued.effect.id}';
    `)).toBe('1')
  })

  it('calcula Granito pelo consumidor SQL, preserva snapshot sem tarifa e reabre o resultado', () => {
    localPsql(`
      INSERT INTO public.granite_manifests(
        id, vessel_voyage, total_bls, total_weight_kg, imported_by
      ) VALUES (
        '${graniteManifestId}', 'S05 TEST / V001', 1, 2000, '${actorId}'
      );
      INSERT INTO public.granite_bls(
        id, manifest_id, sequence, bl_number, vessel_voyage,
        real_weight_kg, charge_status
      ) VALUES (
        '${graniteBlId}', '${graniteManifestId}', 1, 'S05-GRANITE-001',
        'S05 TEST / V001', 2000, 'not_calculated'
      );
      INSERT INTO public.granite_bl_charges(
        id, bl_id, description, charge_type, unit_value, quantity,
        subtotal, currency, calculated_at
      ) VALUES (
        gen_random_uuid(), '${graniteBlId}', 'snapshot anterior', 'fixed',
        10, 1, 10, 'BRL', now()
      );
    `)

    expectSqlFailure(`SELECT public.calculate_granite_bl_charges('${graniteBlId}'::uuid);`, false)
    expect(localPsql(`SELECT count(*) FROM public.granite_bl_charges WHERE bl_id = '${graniteBlId}';`)).toBe('1')

    localPsql(`
      INSERT INTO public.granite_rates(
        id, description, charge_type, unit_value, currency,
        valid_from, valid_to, active
      ) VALUES (
        '${graniteRateId}', 'S05 peso real', 'per_kg', 1, 'BRL',
        CURRENT_DATE, CURRENT_DATE, true
      );
    `)

    const queued = enqueue(actionIds[6], 'granite_billing', graniteBlId)
    const claimed = JSON.parse(localPsql(`
      SELECT row_to_json(e) FROM public.claim_import_effects('granite-worker', 10, 300) AS e;
    `, graniteBlId)) as Effect
    expect(claimed.id).toBe(queued.effect.id)

    const processed = JSON.parse(localPsql(`
      SELECT public.process_import_effect(${queued.effect.id}, 'granite-worker');
    `, graniteBlId)) as { effect: Effect }
    expect(processed.effect).toMatchObject({ status: 'succeeded', effect_kind: 'granite_billing' })
    expect(localPsql(`SELECT charge_status FROM public.granite_bls WHERE id = '${graniteBlId}';`)).toBe('calculated')
    expect(localPsql(`SELECT subtotal::text FROM public.granite_bl_charges WHERE bl_id = '${graniteBlId}';`)).toBe('2000.00')
  })
})
