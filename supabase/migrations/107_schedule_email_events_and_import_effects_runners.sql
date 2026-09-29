-- Migration 107: agenda os jobs que 022 e 025 nunca criaram.
--
-- 022 (portal-email-events-runner) e 025 (import-effects-runner) testavam a
-- função de disparo passando a assinatura completa para `to_regproc`.
-- `to_regproc` recebe só o nome; com a assinatura entre parênteses devolve
-- NULL mesmo com a função presente, então as duas caíram no RAISE WARNING e
-- os jobs não existem em produção. Efeito visível: eventos da Resend
-- (entregue, bounce, complaint) ficam `pending` em `portal_email_events` e o
-- Vela nunca atualiza o status das tentativas nem suprime endereços que
-- voltaram. `to_regprocedure` é a função que aceita assinatura.
--
-- Os jobs só disparam depois que PORTAL_EMAIL_EVENTS_CRON_SECRET e
-- IMPORT_EFFECTS_CRON_SECRET existirem no Vault e nos Edge Function Secrets
-- (docs/operations/segredos-cron.md); até lá `ops.dispatch_edge_job` só avisa.
-- Não reescreve nem apaga linhas existentes.

DO $schedule_107$
BEGIN
  IF to_regclass('cron.job') IS NOT NULL
     AND to_regprocedure('ops.dispatch_edge_job(text,text,text,text)') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'portal-email-events-runner') THEN
      PERFORM cron.unschedule('portal-email-events-runner');
    END IF;
    PERFORM cron.schedule(
      'portal-email-events-runner',
      '* * * * *',
      $job_107a$SELECT ops.dispatch_edge_job('portal-email-events-runner', 'PORTAL_EMAIL_EVENTS_CRON_SECRET');$job_107a$
    );

    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'import-effects-runner') THEN
      PERFORM cron.unschedule('import-effects-runner');
    END IF;
    PERFORM cron.schedule(
      'import-effects-runner',
      '*/5 * * * *',
      $job_107b$SELECT ops.dispatch_edge_job('import-effects-runner', 'IMPORT_EFFECTS_CRON_SECRET');$job_107b$
    );
  ELSE
    RAISE WARNING '107: pg_cron/ops.dispatch_edge_job ausente; agende portal-email-events-runner e import-effects-runner no ambiente de produção.';
  END IF;
END;
$schedule_107$;
