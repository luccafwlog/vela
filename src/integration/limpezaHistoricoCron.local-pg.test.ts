import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { execPsql } from './localPsql'
import { describe, expect, it } from 'vitest'

// Migration 586: `cleanup-cron-run-details` apaga do histórico do pg_cron só as
// execuções terminadas há mais de 14 dias, e reaplicar a migration não duplica
// o job. O shim local de pg_cron não tem `cron.job_run_details`; o teste cria
// uma réplica mínima dentro da transação e roda o comando que ficou agendado.
const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const describeLocal = enabled ? describe : describe.skip
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'
const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/586_limpeza_do_historico_de_execucao_do_cron.sql'),
  'utf8',
)

function psql(sql: string): string {
  return execPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', sql], { encoding: 'utf8' }).trim()
}

describeLocal('migration 586 — limpeza do histórico de execução do pg_cron', () => {
  it('agenda um único job às 06:45 UTC, também depois de reaplicada', () => {
    const result = psql(`
      BEGIN;
      ${migration}
      SELECT concat_ws('|', count(*), min(schedule), bool_and(active))
        FROM cron.job WHERE jobname = 'cleanup-cron-run-details';
      ROLLBACK;
    `)
    expect(result.split('\n').at(-1)).toBe('1|45 6 * * *|t')
  })

  it('apaga só execuções terminadas há mais de 14 dias e mantém as em andamento', () => {
    const result = psql(`
      BEGIN;
      CREATE TABLE IF NOT EXISTS cron.job_run_details (
        runid bigserial PRIMARY KEY, jobid bigint, status text,
        start_time timestamptz, end_time timestamptz
      );
      INSERT INTO cron.job_run_details (jobid, status, start_time, end_time) VALUES
        (-586, 'velha', now() - interval '20 days', now() - interval '20 days'),
        (-586, 'limite', now() - interval '13 days 23 hours', now() - interval '13 days 23 hours'),
        (-586, 'recente', now() - interval '1 hour', now() - interval '1 hour'),
        (-586, 'em_andamento', now() - interval '30 days', NULL);
      DO $run$ BEGIN
        EXECUTE (SELECT command FROM cron.job WHERE jobname = 'cleanup-cron-run-details');
      END $run$;
      SELECT string_agg(status, ',' ORDER BY status) FROM cron.job_run_details WHERE jobid = -586;
      ROLLBACK;
    `)
    expect(result.split('\n').at(-1)).toBe('em_andamento,limite,recente')
  })
})
