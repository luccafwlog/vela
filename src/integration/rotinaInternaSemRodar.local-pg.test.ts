// Migration 628 (ADR 0134, decisão 8): rotina do agendador que termina com
// erro, ou que para de rodar no ritmo dela, abre "Rotina interna sem rodar"
// (Crítico, Administrativo); voltar a rodar bem fecha. O banco local não tem
// o histórico do pg_cron: cada cenário cria `cron.job_run_details` numa
// transação desfeita no fim.
//
// Namespace exclusivo: rotina 'a619-teste'.
import { execPsql } from './localPsql'
import { describe, expect, it } from 'vitest'

const db = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'
const local = process.env.LOCAL_PG_INTEGRATION === '1' ? describe : describe.skip
const JOB = 'a619-teste'

function sql(q: string): string[] {
  return execPsql(['-X', '-Atq', '-v', 'ON_ERROR_STOP=1', '-d', db, '-f', '-'], { input: q, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
    .replaceAll(String.fromCharCode(13), '').trim().split('\n').filter((line) => line.startsWith('>'))
}

/** `runs`: linhas `(status, minutos atrás, mensagem)` da rotina de teste. */
function scenario(runs: Array<[string, number, string?]>, after = ''): string[] {
  const values = runs.map(([status, ago, msg]) =>
    `((SELECT jobid FROM cron.job WHERE jobname = '${JOB}'), '${status}', now() - interval '${ago} minutes', ${msg ? `'${msg}'` : 'NULL'})`).join(', ')
  return sql(`BEGIN;
    DO $$ BEGIN
      IF to_regclass('cron.job_run_details') IS NULL THEN
        CREATE TABLE cron.job_run_details (jobid bigint, runid bigserial, status text, start_time timestamptz, end_time timestamptz, return_message text);
      END IF;
    END $$;
    UPDATE cron.job SET active = false WHERE jobname <> '${JOB}';
    INSERT INTO cron.job (jobname, schedule, command) VALUES ('${JOB}', '*/5 * * * *', 'SELECT 1');
    INSERT INTO cron.job_run_details (jobid, status, start_time, return_message) VALUES ${values};
    SELECT '>falhando|' || public.reconcile_internal_job_alerts('teste_628');
    ${after}
    SELECT '>' || i.status || '|' || i.severity || '|' || i.department || '|' || i.message
      FROM public.alert_items i JOIN public.alerts a ON a.id = i.alert_id
      WHERE i.item_type = 'rotina_interna_sem_rodar' AND a.entity_id = '${JOB}';
    ROLLBACK;`)
}

local('Rotina interna sem rodar (migration 628)', () => {
  it('rodando a cada 5 minutos sem erro: nada abre', () => {
    expect(scenario([['succeeded', 2], ['succeeded', 7], ['succeeded', 12], ['succeeded', 17]])).toEqual(['>falhando|0'])
  })

  it('última execução com erro: Crítico do Administrativo com a mensagem; a seguinte bem-sucedida fecha', () => {
    const lines = scenario([['failed', 2, 'ERROR: division by zero'], ['succeeded', 7], ['succeeded', 12]])
    expect(lines[0]).toBe('>falhando|1')
    expect(lines[1]).toMatch(/^>active\|critical\|administrativo\|A rotina a619-teste terminou com erro em .*: ERROR: division by zero$/)
    const fixed = scenario([['failed', 2, 'ERROR: division by zero'], ['succeeded', 7]],
      `INSERT INTO cron.job_run_details (jobid, status, start_time) VALUES ((SELECT jobid FROM cron.job WHERE jobname = '${JOB}'), 'succeeded', now());
       SELECT '>de novo|' || public.reconcile_internal_job_alerts('teste_628');`)
    expect(fixed.at(-1)).toMatch(/^>resolved\|/)
  })

  it('parada: não roda há mais de 3 vezes o intervalo habitual', () => {
    const lines = scenario([['succeeded', 120], ['succeeded', 125], ['succeeded', 130], ['succeeded', 135]])
    expect(lines[0]).toBe('>falhando|1')
    expect(lines[1]).toMatch(/^>active\|critical\|administrativo\|A rotina a619-teste não roda desde .*; o normal dela é rodar a cada 5 minuto\(s\)\.$/)
  })
})
