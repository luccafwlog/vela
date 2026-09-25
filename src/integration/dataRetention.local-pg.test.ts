import { execFileSync } from 'node:child_process'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// Migration 094 (ADR 0074): a rotina de guarda apaga auditoria com mais de 5
// anos (menos as marcas de escala, que são dado operacional) e eventos do
// Portal com mais de 1 ano; fora dela, esses eventos continuam imutáveis.

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

function psql(sql: string) {
  return execFileSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', sql], {
    encoding: 'utf8',
  }).trim()
}

function functionPresent() {
  if (!enabled) return false
  try {
    return psql(`SELECT to_regprocedure('public.run_retention()') IS NOT NULL;`) === 't'
  } catch {
    return false
  }
}

const describeLocal = functionPresent() ? describe : describe.skip

const CUSTOMER_ID = 9400001
const TAG = 'ret094'

function cleanup() {
  psql(`
    SET session_replication_role = replica;
    DELETE FROM public.audit_logs WHERE entity_id LIKE '${TAG}%' OR entity_id LIKE '9400001::%';
    DELETE FROM public.portal_provisioning_events WHERE customer_id = ${CUSTOMER_ID};
    DELETE FROM public.portal_login_attempts WHERE cnpj_hash LIKE '${TAG}%';
    DELETE FROM public.customer_portal_accounts WHERE customer_id = ${CUSTOMER_ID};
    DELETE FROM public.customers WHERE id = ${CUSTOMER_ID};
    SET session_replication_role = origin;
  `)
}

describeLocal('094 — rotina de guarda de dados', () => {
  beforeAll(() => {
    cleanup()
    psql(`
      SET session_replication_role = replica;
      INSERT INTO public.customers (id, name, cnpj_cpf) VALUES (${CUSTOMER_ID}, 'Cliente 094', '09400000000194');
      INSERT INTO public.audit_logs (entity_type, entity_id, field_name, new_value, changed_at) VALUES
        ('bl', '${TAG}-old', 'pod', 'x', now() - interval '6 years'),
        ('bl', '${TAG}-new', 'pod', 'x', now() - interval '4 years'),
        ('voyage_pod_schedule', '9400001::BRSSZ', 'eta', '2020-01-01', now() - interval '6 years'),
        ('voyages', '${TAG}-voyage', 'indicated_first_brazilian_port', 'BRSSZ', now() - interval '6 years');
      INSERT INTO public.portal_provisioning_events (customer_id, actor_type, created_at) VALUES
        (${CUSTOMER_ID}, 'sistema', now() - interval '2 years'),
        (${CUSTOMER_ID}, 'sistema', now() - interval '6 months');
      INSERT INTO public.portal_login_attempts (cnpj_hash, attempted_at) VALUES
        ('${TAG}-old', now() - interval '2 years'),
        ('${TAG}-new', now() - interval '1 month');
      SET session_replication_role = origin;
    `)
  })

  afterAll(cleanup)

  it('fora da rotina, eventos do Portal continuam imutáveis', () => {
    expect(() => psql(`DELETE FROM public.portal_provisioning_events WHERE customer_id = ${CUSTOMER_ID};`))
      .toThrow(/somente inclusão/)
  })

  it('apaga só o que passou do prazo e preserva as marcas de escala', () => {
    const result = JSON.parse(psql(`SELECT public.run_retention();`))
    expect(result.audit_logs).toBeGreaterThanOrEqual(1)

    expect(psql(`SELECT string_agg(entity_id, ',' ORDER BY entity_id) FROM public.audit_logs
      WHERE entity_id LIKE '${TAG}%' OR entity_id = '9400001::BRSSZ';`)).toBe(`9400001::BRSSZ,${TAG}-new,${TAG}-voyage`)
    expect(psql(`SELECT count(*) FROM public.portal_provisioning_events WHERE customer_id = ${CUSTOMER_ID};`)).toBe('1')
    expect(psql(`SELECT string_agg(cnpj_hash, ',') FROM public.portal_login_attempts WHERE cnpj_hash LIKE '${TAG}%';`)).toBe(`${TAG}-new`)
  })

  it('a rotina está agendada todo dia onde há pg_cron', () => {
    // O Postgres do CI (scripts/setup-local-pg.sh) pode não ter pg_cron; a
    // migration então só avisa. Com a extensão, o job tem de existir.
    const hasCron = psql(`SELECT to_regclass('cron.job') IS NOT NULL;`) === 't'
    if (!hasCron) return
    expect(psql(`SELECT schedule FROM cron.job WHERE jobname = 'data-retention';`)).toBe('30 6 * * *')
  })
})
