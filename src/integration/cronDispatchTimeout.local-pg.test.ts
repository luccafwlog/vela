import { execFileSync } from 'node:child_process'
import { expect, it } from 'vitest'
import { describeWithProbe } from './localTestData'

// Migration 165: o dispatcher dos jobs pg_cron passa a dar 30 s ao pg_net (o
// padrão de 5 s inclui DNS e perdia a rodada nos minutos de rajada) e os jobs
// de 15 min/hora saem dos minutos cheios sem perder comando nem estado ativo.

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

function psql(sql: string) {
  return execFileSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl], {
    input: sql,
    encoding: 'utf8',
  }).trim()
}

function migrationApplied() {
  if (!enabled) return false
  try {
    return psql(`SELECT pg_get_functiondef('ops.dispatch_edge_job(text,text,text,text)'::regprocedure)
      LIKE '%timeout_milliseconds%';`) === 't'
  } catch {
    return false
  }
}

const describeLocal = describeWithProbe(migrationApplied, 'migrationApplied')

describeLocal('165 — dispatcher dos jobs pg_cron fora da rajada', () => {
  it('envia a chamada com 30 s de timeout, URL e cabeçalho lidos do cofre', () => {
    // Tudo dentro de uma transação desfeita: o net.http_post de captura e os
    // segredos de teste não sobrevivem ao caso.
    const captured = psql(`
      BEGIN;
      CREATE TEMP TABLE captured_post (url text, headers jsonb, timeout_ms integer) ON COMMIT DROP;
      CREATE OR REPLACE FUNCTION net.http_post(url text, body jsonb DEFAULT '{}'::jsonb, params jsonb DEFAULT '{}'::jsonb, headers jsonb DEFAULT '{}'::jsonb, timeout_milliseconds integer DEFAULT 5000)
      RETURNS bigint LANGUAGE plpgsql AS $f$
      BEGIN
        INSERT INTO pg_temp.captured_post VALUES (url, headers, timeout_milliseconds);
        RETURN 42;
      END $f$;
      DELETE FROM vault.secrets WHERE name IN ('SUPABASE_URL', 'TESTE_165_SECRET');
      SELECT vault.create_secret('https://exemplo.supabase.co', 'SUPABASE_URL', '');
      SELECT vault.create_secret('segredo-165', 'TESTE_165_SECRET', '');
      SELECT ops.dispatch_edge_job('demurrage-dunning', 'TESTE_165_SECRET') IS NOT NULL;
      SELECT url || '|' || (headers ->> 'Authorization') || '|' || timeout_ms FROM pg_temp.captured_post;
      ROLLBACK;
    `)
    expect(captured.split('\n').at(-1)).toBe(
      'https://exemplo.supabase.co/functions/v1/demurrage-dunning|Bearer segredo-165|30000',
    )
  })

  it('com o cofre vazio, avisa e não dispara', () => {
    const result = psql(`
      BEGIN;
      DELETE FROM vault.secrets WHERE name = 'TESTE_165_AUSENTE';
      SELECT ops.dispatch_edge_job('demurrage-dunning', 'TESTE_165_AUSENTE') IS NULL;
      ROLLBACK;
    `)
    expect(result.split('\n').at(-1)).toBe('t')
  })

  it('tira os jobs de 15 min, 5 min e hora dos minutos cheios, preservando comando e estado', () => {
    const jobs = psql(`
      SELECT string_agg(jobname || '=' || schedule || '=' || active || '='
               || (command LIKE 'SELECT ops.dispatch_edge_job(%'), ';' ORDER BY jobname)
        FROM cron.job
       WHERE jobname IN ('alerts-foundation-detectors', 'customer-communication-auto-runner',
                         'demurrage-dunning', 'import-effects-runner', 'portal-daily-digest',
                         'portal-email-events-runner');
    `)
    expect(jobs.split(';')).toEqual([
      'alerts-foundation-detectors=2-59/15 * * * *=true=true',
      'customer-communication-auto-runner=4-59/15 * * * *=true=true',
      'demurrage-dunning=7 * * * *=true=true',
      'import-effects-runner=3-59/5 * * * *=true=true',
      'portal-daily-digest=0 11 * * *=true=true',
      'portal-email-events-runner=* * * * *=true=true',
    ])
  })

  it('o dispatcher continua fora do alcance do cliente', () => {
    expect(psql(`
      SELECT has_function_privilege('anon', 'ops.dispatch_edge_job(text,text,text,text)', 'EXECUTE')
          OR has_function_privilege('authenticated', 'ops.dispatch_edge_job(text,text,text,text)', 'EXECUTE');
    `)).toBe('f')
  })
})
