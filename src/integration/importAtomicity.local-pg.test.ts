import { execFileSync } from 'node:child_process'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { syntheticCnpj } from './localTestData'

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const describeLocal = enabled ? describe : describe.skip
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const actorId = '00000000-0000-0000-0000-000000040401'
const otherActorId = '00000000-0000-0000-0000-000000040402'
const customerId = 99040401
const carrierId = 99040402
const vesselId = 99040403
const voyageId = 99040404
const blId = 'S04-ATOMIC-BL'
const containerIds = [99040405, 99040406]
const containerNumbers = ['SAAA1234567', 'SBBB1234567']
const requestId = '00000000-0000-0000-0000-000000040499'
const customerCnpj = syntheticCnpj(40401)

function localPsql(sql: string, actor = actorId): string {
  return execFileSync('psql', [
    '-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl,
    '-c', `SET request.jwt.claim.role = 'authenticated'; SET request.jwt.claim.sub = '${actor}'; ${sql}`,
  ], { encoding: 'utf8' }).trim()
}

function expectSqlFailure(sql: string, actor = actorId): void {
  expect(() => localPsql(sql, actor)).toThrow()
}

describeLocal('S04 — datas de container como unidade atômica', () => {
  beforeAll(() => {
    localPsql(`
      SET session_replication_role = replica;
      DELETE FROM public.import_pending_effects WHERE entity_id = '${blId}' OR entity_id = '${voyageId}';
      DELETE FROM public.audit_logs WHERE changed_by IN ('${actorId}', '${otherActorId}');
      DELETE FROM public.bl_containers WHERE id = ANY(ARRAY[${containerIds.join(',')}]::bigint[]);
      DELETE FROM public.bls WHERE id = '${blId}';
      DELETE FROM public.voyages WHERE id = ${voyageId};
      DELETE FROM public.vessels WHERE id = ${vesselId};
      DELETE FROM public.carriers WHERE id = ${carrierId};
      DELETE FROM public.customers WHERE id = ${customerId};
      SET session_replication_role = origin;
      DELETE FROM public.user_profiles WHERE id IN ('${actorId}', '${otherActorId}');
      DELETE FROM auth.users WHERE id IN ('${actorId}', '${otherActorId}');

      INSERT INTO auth.users (id, email) VALUES
        ('${actorId}', 's04-atomic@example.test'),
        ('${otherActorId}', 's04-other@example.test');
      INSERT INTO public.user_profiles (id, full_name, role, active) VALUES
        ('${actorId}', 'S04 Atomic', 'administrativo', true),
        ('${otherActorId}', 'S04 Other', 'administrativo', true);
      INSERT INTO public.customers (id, cnpj_cpf, name)
      VALUES (${customerId}, '${customerCnpj}', 'Cliente S04');
      INSERT INTO public.carriers (id, name) VALUES (${carrierId}, 'Carrier S04');
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (${vesselId}, 'Vessel S04', ${carrierId});
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status)
      VALUES (${voyageId}, ${vesselId}, 'S04', 'active');
      INSERT INTO public.bls (id, voyage_id, customer_id, cargo_mode)
      VALUES ('${blId}', ${voyageId}, ${customerId}, 'container');
      INSERT INTO public.bl_containers (id, bl_id, container_number)
      VALUES (${containerIds[0]}, '${blId}', '${containerNumbers[0]}'),
             (${containerIds[1]}, '${blId}', '${containerNumbers[1]}');
    `)
  })

  afterAll(() => {
    localPsql(`
      SET session_replication_role = replica;
      DELETE FROM public.import_pending_effects WHERE entity_id = '${blId}' OR entity_id = '${voyageId}';
      DELETE FROM public.audit_logs WHERE changed_by IN ('${actorId}', '${otherActorId}');
      DELETE FROM public.bl_containers WHERE id = ANY(ARRAY[${containerIds.join(',')}]::bigint[]);
      DELETE FROM public.bls WHERE id = '${blId}';
      DELETE FROM public.voyages WHERE id = ${voyageId};
      DELETE FROM public.vessels WHERE id = ${vesselId};
      DELETE FROM public.carriers WHERE id = ${carrierId};
      DELETE FROM public.customers WHERE id = ${customerId};
      SET session_replication_role = origin;
      DELETE FROM public.user_profiles WHERE id IN ('${actorId}', '${otherActorId}');
      DELETE FROM auth.users WHERE id IN ('${actorId}', '${otherActorId}');
    `)
  })

  it('desfaz todas as linhas quando a unidade contém container fora do B/L', () => {
    expectSqlFailure(`
      SELECT public.apply_container_dates_atomic(
        '${requestId}'::uuid, '${blId}',
        '[
          {"container_number":"${containerNumbers[0]}","discharge_date":"2026-01-10","return_date":"2026-01-12"},
          {"container_number":"S04MISSING","discharge_date":"2026-01-10","return_date":"2026-01-12"}
        ]'::jsonb, '${actorId}'::uuid
      );
    `)

    expect(localPsql(`
      SELECT count(*) FROM public.bl_containers
      WHERE id = ${containerIds[0]} AND discharge_date IS NULL AND return_date IS NULL;
    `)).toBe('1')
  })

  it('aplica a unidade válida, cria uma pendência e rejeita ator divergente', () => {
    const result = JSON.parse(localPsql(`
      SELECT public.apply_container_dates_atomic(
        '${requestId}'::uuid, '${blId}',
        '[
          {"container_number":"${containerNumbers[0]}","discharge_date":"2026-01-10","return_date":"2026-01-12"},
          {"container_number":"${containerNumbers[1]}","discharge_date":"2026-01-10","return_date":"2026-01-13"}
        ]'::jsonb, '${actorId}'::uuid
      );
    `)) as { updated_ids: number[]; billing_state: string }

    expect(result.updated_ids).toHaveLength(2)
    expect(result.billing_state).toBe('ready_for_billing')
    expect(localPsql(`SELECT count(*) FROM public.import_pending_effects WHERE entity_id = '${blId}';`)).toBe('1')
    expect(localPsql(`SELECT count(*) FROM public.bl_containers WHERE bl_id = '${blId}' AND return_date IS NOT NULL;`)).toBe('2')

    expectSqlFailure(`
      SELECT public.apply_container_dates_atomic(
        gen_random_uuid(), '${blId}',
        '[{"container_number":"${containerNumbers[0]}","discharge_date":"2026-01-11","return_date":"2026-01-14"}]'::jsonb,
        '${otherActorId}'::uuid
      );
    `, actorId)
    expect(localPsql(`SELECT discharge_date::text FROM public.bl_containers WHERE id = ${containerIds[0]};`)).toBe('2026-01-10')
  })
})
