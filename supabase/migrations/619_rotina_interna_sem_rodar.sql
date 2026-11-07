-- 619: rotina interna que falha ou para de rodar abre alerta, e o vigia manda
-- sinal ao Better Stack (decisão 8 do dono de 2026-11-07; ADR 0132, lote G do
-- plano 2026-11-07-brechas-restantes-da-revisao-dos-alertas).
--
-- Rotinas só de banco (situação da Demurrage, Demurrage travada, prazo da
-- Disputa, alertas do Desbloqueio, reforço por tempo...) podiam falhar toda vez
-- sem aviso: "Rotina agendada com resposta de erro" só lê as chamadas HTTP
-- (brecha B14). Agora:
--   1. Alerta `rotina_interna_sem_rodar` (Crítico, Administrativo), por rotina
--      (entidade `cron_job`, id = nome da rotina), lido do histórico do
--      agendador (`cron.job_run_details`):
--        - a última execução terminou com erro, nas últimas 2 horas, sem
--          nenhuma bem-sucedida depois; ou
--        - a rotina não roda há mais de 3 vezes o intervalo habitual dela
--          (mediana das últimas 10 execuções), e no mínimo 30 minutos.
--      Fecha quando a rotina volta a rodar bem. A mensagem traz o erro.
--      ponytail: o "intervalo habitual" vem do próprio histórico, não do
--      horário agendado; rotina diária precisa de 3 dias sem rodar para abrir.
--      Upgrade: ler o `schedule` do cron.
--   2. O vigia `internal-jobs-health` (15 minutos) roda a conferência e manda o
--      sinal ao Better Stack pela URL do cofre
--      `BETTERSTACK_HEARTBEAT_INTERNAL_JOBS_URL` (com `/fail` quando há rotina
--      com problema). Se o próprio vigia, ou o banco, parar, o Better Stack
--      avisa por e-mail. Sem a URL no cofre, só o alerta funciona.
--
-- Plano de preservação: a migration só acrescenta um tipo ao catálogo,
-- funções e uma rotina; não reescreve nem apaga linha existente. Conferir:
-- `SELECT entity_id, status FROM alert_items i JOIN alerts a ON a.id =
-- i.alert_id WHERE item_type = 'rotina_interna_sem_rodar'` depois da primeira
-- rodada. Desfazer: o rollback abaixo e `UPDATE alert_type_catalog SET
-- active = false WHERE type = 'rotina_interna_sem_rodar'`.
--
-- Rollback: `cron.unschedule('internal-jobs-health')` e dropar
-- `reconcile_internal_job_alerts`.

INSERT INTO public.alert_type_catalog (type, severity, responsible_department, audience_departments, default_destination, active)
VALUES ('rotina_interna_sem_rodar', 'critical', 'administrativo', ARRAY['administrativo'], '/alertas', true)
ON CONFLICT (type) DO NOTHING;

CREATE OR REPLACE FUNCTION public.reconcile_internal_job_alerts(p_source text DEFAULT 'internal-jobs-health')
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  r record;
  v_failing integer := 0;
  v_url text;
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);

  -- Sem o histórico do agendador (banco local sem pg_cron), não há o que ler.
  IF to_regclass('cron.job_run_details') IS NULL OR to_regclass('cron.job') IS NULL THEN
    RETURN 0;
  END IF;

  FOR r IN EXECUTE $q$
    WITH runs AS (
      SELECT d.jobid, d.status, d.start_time, d.return_message,
             row_number() OVER (PARTITION BY d.jobid ORDER BY d.start_time DESC) AS rn
      FROM cron.job_run_details d
      WHERE d.start_time >= now() - interval '30 days'
        AND d.status IN ('succeeded', 'failed')
    ), gaps AS (
      SELECT jobid, percentile_cont(0.5) WITHIN GROUP (ORDER BY gap) AS median_gap, count(*) AS n
      FROM (
        SELECT jobid, start_time - lead(start_time) OVER (PARTITION BY jobid ORDER BY start_time DESC) AS gap
        FROM runs WHERE rn <= 11
      ) g
      WHERE gap IS NOT NULL
      GROUP BY jobid
    )
    SELECT j.jobname,
           last.status AS last_status, last.start_time AS last_start, last.return_message,
           g.median_gap, COALESCE(g.n, 0) AS gap_count
    FROM cron.job j
    LEFT JOIN runs last ON last.jobid = j.jobid AND last.rn = 1
    LEFT JOIN gaps g ON g.jobid = j.jobid
    WHERE j.active AND j.jobname IS NOT NULL AND j.jobname <> 'internal-jobs-health'
  $q$
  LOOP
    IF r.last_status = 'failed' AND r.last_start >= now() - interval '2 hours' THEN
      v_failing := v_failing + 1;
      PERFORM public.upsert_alert_item(
        'rotina_interna_sem_rodar', 'cron_job', r.jobname,
        format('A rotina %s terminou com erro em %s: %s',
          r.jobname, to_char(r.last_start AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI'),
          left(COALESCE(NULLIF(btrim(r.return_message), ''), 'sem mensagem'), 300)),
        p_source,
        jsonb_build_object('job', r.jobname, 'reason', 'falhou', 'last_start', r.last_start, 'milestone', 'falhou'),
        '/alertas');
    ELSIF r.last_start IS NOT NULL AND r.gap_count >= 3
          AND now() - r.last_start > GREATEST(r.median_gap * 3, interval '30 minutes') THEN
      v_failing := v_failing + 1;
      PERFORM public.upsert_alert_item(
        'rotina_interna_sem_rodar', 'cron_job', r.jobname,
        format('A rotina %s não roda desde %s; o normal dela é rodar a cada %s.',
          r.jobname, to_char(r.last_start AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI'),
          CASE WHEN r.median_gap >= interval '1 day' THEN round(extract(epoch FROM r.median_gap) / 86400) || ' dia(s)'
               WHEN r.median_gap >= interval '1 hour' THEN round(extract(epoch FROM r.median_gap) / 3600) || ' hora(s)'
               ELSE greatest(1, round(extract(epoch FROM r.median_gap) / 60)) || ' minuto(s)' END),
        p_source,
        jsonb_build_object('job', r.jobname, 'reason', 'parada', 'last_start', r.last_start, 'milestone', 'parada'),
        '/alertas');
    ELSE
      PERFORM public.resolve_alert_item('rotina_interna_sem_rodar', 'cron_job', r.jobname, p_source, '{}'::jsonb);
    END IF;
  END LOOP;

  -- Alerta de rotina que saiu da agenda (desativada ou removida) fecha.
  FOR r IN
    SELECT a.entity_id AS jobname FROM public.alert_items i JOIN public.alerts a ON a.id = i.alert_id
    WHERE i.item_type = 'rotina_interna_sem_rodar' AND i.status = 'active'
  LOOP
    IF NOT EXISTS (SELECT 1 FROM cron.job j WHERE j.jobname = r.jobname AND j.active) THEN
      PERFORM public.resolve_alert_item('rotina_interna_sem_rodar', 'cron_job', r.jobname, p_source, '{}'::jsonb);
    END IF;
  END LOOP;

  -- Sinal externo: o Better Stack avisa se ele parar de chegar.
  IF to_regnamespace('vault') IS NOT NULL AND to_regprocedure('net.http_get(text,jsonb,jsonb,integer)') IS NOT NULL THEN
    EXECUTE $v$SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'BETTERSTACK_HEARTBEAT_INTERNAL_JOBS_URL'$v$ INTO v_url;
    IF NULLIF(btrim(COALESCE(v_url, '')), '') IS NOT NULL THEN
      PERFORM net.http_get(url := rtrim(v_url, '/') || CASE WHEN v_failing > 0 THEN '/fail' ELSE '' END,
                           timeout_milliseconds := 10000);
    END IF;
  END IF;
  RETURN v_failing;
END;
$function$;
REVOKE ALL ON FUNCTION public.reconcile_internal_job_alerts(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_internal_job_alerts(text) TO service_role;

DO $schedule_619$
BEGIN
  IF to_regnamespace('cron') IS NULL THEN
    RAISE WARNING '619: pg_cron ausente; agende internal-jobs-health no ambiente de produção.';
    RETURN;
  END IF;
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'internal-jobs-health';
  PERFORM cron.schedule('internal-jobs-health', '6-59/15 * * * *',
    $cmd_619$SELECT public.reconcile_internal_job_alerts('internal-jobs-health');$cmd_619$);
END;
$schedule_619$;
