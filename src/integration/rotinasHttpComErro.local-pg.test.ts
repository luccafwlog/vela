import { execPsql } from './localPsql'
import { expect, it } from 'vitest'
import { describeWithProbe } from './localTestData'

// Migration 310 (plano dos e-mails, 2.9): resposta não-2xx das rotinas HTTP em
// net._http_response abre o Alerta rotina_http_falhou; sem falha na última
// hora, fecha. O pg_net local é só um esboço de schema: a suíte cria uma
// tabela equivalente dentro de uma transação desfeita no fim, e chama a função
// sem claims, como o pg_cron.
const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

function psql(sql: string): string {
  return execPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', sql],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

const alertStatus = `SELECT 'status=' || COALESCE((SELECT i.status FROM public.alert_items i JOIN public.alerts a ON a.id = i.alert_id
  WHERE i.item_type = 'rotina_http_falhou' AND a.entity_type = 'cron_http' AND a.entity_id = 'net_http_response'
  ORDER BY i.id DESC LIMIT 1), 'none');`

function migration310Applied(): boolean {
  if (!enabled) return false
  try {
    return psql(`SELECT to_regprocedure('public.reconcile_http_job_failures_alert(interval)') IS NOT NULL
      AND to_regclass('net._http_response') IS NULL AND to_regclass('net.http_request_queue') IS NULL;`) === 't'
  } catch {
    return false
  }
}

const describeLocal = describeWithProbe(migration310Applied, 'migration310Applied (rotinas HTTP com erro; net._http_response ausente no banco local)')

describeLocal('310 — rotinas HTTP com erro', () => {
  it('abre o alerta com 401 na última hora e fecha quando só há 2xx', () => {
    const output = psql(`
      BEGIN;
      CREATE TABLE net._http_response (
        id bigint, status_code integer, content_type text, headers jsonb, content text,
        timed_out boolean, error_msg text, created timestamptz NOT NULL DEFAULT now()
      );
      INSERT INTO net._http_response (id, status_code, timed_out, error_msg, created) VALUES
        (1, 200, false, NULL, now() - interval '5 minutes'),
        (2, 401, false, NULL, now() - interval '10 minutes'),
        (3, NULL, true, 'Timeout of 30000 ms reached', now() - interval '20 minutes'),
        (4, 500, false, NULL, now() - interval '3 hours');
      SELECT 'run1=' || public.reconcile_http_job_failures_alert()::text;
      ${alertStatus}
      SELECT 'message=' || i.message FROM public.alert_items i JOIN public.alerts a ON a.id = i.alert_id
        WHERE i.item_type = 'rotina_http_falhou' AND i.status = 'active';
      SELECT 'department=' || i.department FROM public.alert_items i
        WHERE i.item_type = 'rotina_http_falhou' AND i.status = 'active';
      DELETE FROM net._http_response WHERE status_code IS DISTINCT FROM 200 AND created > now() - interval '1 hour';
      SELECT 'run2=' || public.reconcile_http_job_failures_alert()::text;
      ${alertStatus}
      ROLLBACK;
    `)
    const lines = output.split('\n')
    expect(lines).toContain('run1={"queued": 0, "failures": 1, "timeouts": 1, "responses": 3}')
    expect(lines).toContain('department=administrativo')
    const message = lines.find((line) => line.startsWith('message=')) ?? ''
    expect(message).toContain('2 de 3 chamada(s)')
    expect(message).toContain('HTTP 401')
    expect(message).toContain('tempo esgotado')
    expect(lines.filter((line) => line.startsWith('status='))).toEqual(['status=active', 'status=resolved'])
    expect(lines).toContain('run2={"queued": 0, "failures": 0, "timeouts": 0, "responses": 1}')
  })

  // Migration 316: o pg_net desiste aos 30 s, mas a rodada longa do runner continua.
  it('tempo esgotado isolado de uma rodada longa não abre; dez na hora (rotina de minuto travada) abrem', () => {
    const output = psql(`
      BEGIN;
      CREATE TABLE net._http_response (
        id bigint, status_code integer, content_type text, headers jsonb, content text,
        timed_out boolean, error_msg text, created timestamptz NOT NULL DEFAULT now()
      );
      INSERT INTO net._http_response (id, status_code, timed_out, error_msg, created) VALUES
        (1, NULL, true, 'Timeout of 30000 ms reached', now() - interval '5 minutes'),
        (2, 200, false, NULL, now() - interval '6 minutes');
      SELECT 'run1=' || public.reconcile_http_job_failures_alert()::text;
      ${alertStatus}
      INSERT INTO net._http_response (id, status_code, timed_out, error_msg, created)
        SELECT 10 + g, NULL, true, 'Timeout of 30000 ms reached', now() - (g || ' minutes')::interval FROM generate_series(1, 9) g;
      SELECT 'run2=' || public.reconcile_http_job_failures_alert()::text;
      ${alertStatus}
      ROLLBACK;
    `)
    const lines = output.split('\n')
    expect(lines).toContain('run1={"queued": 0, "failures": 0, "timeouts": 1, "responses": 2}')
    expect(lines).toContain('run2={"queued": 0, "failures": 0, "timeouts": 10, "responses": 11}')
    expect(lines.filter((line) => line.startsWith('status='))).toEqual(['status=none', 'status=active'])
  })

  it('fila do pg_net parada abre o alerta mesmo sem nenhuma resposta', () => {
    const output = psql(`
      BEGIN;
      CREATE TABLE net._http_response (
        id bigint, status_code integer, content_type text, headers jsonb, content text,
        timed_out boolean, error_msg text, created timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE net.http_request_queue (id bigint, method text, url text);
      INSERT INTO net.http_request_queue SELECT g, 'POST', 'https://edge' FROM generate_series(1, 30) g;
      SELECT 'run=' || public.reconcile_http_job_failures_alert()::text;
      ${alertStatus}
      SELECT 'message=' || i.message FROM public.alert_items i
        WHERE i.item_type = 'rotina_http_falhou' AND i.status = 'active';
      ROLLBACK;
    `)
    const lines = output.split('\n')
    expect(lines).toContain('run={"queued": 30, "failures": 0, "timeouts": 0, "responses": 0}')
    expect(lines).toContain('status=active')
    expect(lines.find((line) => line.startsWith('message=')) ?? '').toContain('30 chamada(s) paradas na fila do pg_net')
  })

  it('sem a tabela do pg_net não falha e não abre alerta', () => {
    expect(psql('SELECT public.reconcile_http_job_failures_alert()::text;')).toContain('ausente')
  })

  it('é server-only', () => {
    expect(psql(`SELECT has_function_privilege('authenticated', 'public.reconcile_http_job_failures_alert(interval)', 'EXECUTE');`)).toBe('f')
  })
})
