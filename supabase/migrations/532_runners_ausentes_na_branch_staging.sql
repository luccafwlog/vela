-- 532: agenda `import-effects-runner` e `portal-email-events-runner` onde eles
-- não existem (branch Supabase `staging`, ref `uvgqfpleiyfythkhutlj`).
--
-- Sintoma (staging, 2026-10-29 e 30): Alerta crítico "Fila de efeitos de
-- importação parada", aberto às 19:07 UTC de 29/10 e atualizado de hora em
-- hora: 15 efeitos `vehicle_followup` da importação das 17:33 UTC pendentes,
-- `attempts = 0` e nenhum efeito concluído na fila (`last_completed_at` nulo).
-- Em produção, os efeitos da mesma importação concluíram em ~25 s.
--
-- Causa (conferida em `cron.job` e `supabase_migrations.schema_migrations` da
-- staging em 2026-10-30): na staging, a linha da 007 do histórico é só o
-- comentário de cabeçalho. A branch nasceu em 2026-10-19, antes do reparo
-- `supabase/scripts/reparo_schema_migrations_007_135.sql` (2026-10-20), e a
-- 107 rodou sem `ops.dispatch_edge_job`: caiu no RAISE WARNING e não agendou
-- os dois jobs. A 218 achou `import-effects-runner` ausente e só avisou. O
-- dispatcher e os quatro jobs da 007 entraram depois (jobids 12 a 15, logo
-- após `data-retention` da 094), mas nada voltou à 107. A fila ficou só com o
-- disparo pela importação (218), sem a rede de segurança de cada minuto.
--
-- Mudança: agenda os dois jobs com o nome, o horário e o comando de produção,
-- só onde o nome não existe. Onde já existem (produção), não toca: preserva
-- jobid, horário e estado ativo. Sem pg_cron ou dispatcher, avisa e não agenda,
-- como a 107. Sem o par no Vault, o job agendado fica inerte com o WARNING do
-- dispatcher.
--
-- O job não liga o consumo: o `import-effects-runner` responde `200 paused`
-- enquanto a Edge Function não tiver `IMPORT_EFFECTS_RUNNER_ENABLED=true`
-- (docs/operations/segredos-cron.md).
--
-- Não reescreve nem apaga linhas.
-- Rollback (só onde a 532 criou o job):
--   SELECT cron.unschedule('import-effects-runner');
--   SELECT cron.unschedule('portal-email-events-runner');

DO $schedule_532$
BEGIN
  IF to_regclass('cron.job') IS NULL
     OR to_regprocedure('ops.dispatch_edge_job(text,text,text,text)') IS NULL THEN
    RAISE WARNING '532: pg_cron/ops.dispatch_edge_job ausente; import-effects-runner e portal-email-events-runner não agendados.';
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'import-effects-runner') THEN
    PERFORM cron.schedule(
      'import-effects-runner',
      '* * * * *',
      $job_532a$SELECT ops.dispatch_edge_job('import-effects-runner', 'IMPORT_EFFECTS_CRON_SECRET');$job_532a$
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'portal-email-events-runner') THEN
    PERFORM cron.schedule(
      'portal-email-events-runner',
      '* * * * *',
      $job_532b$SELECT ops.dispatch_edge_job('portal-email-events-runner', 'PORTAL_EMAIL_EVENTS_CRON_SECRET');$job_532b$
    );
  END IF;
END;
$schedule_532$;
