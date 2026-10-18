-- Migration 310: resposta de erro das rotinas HTTP abre Alerta (plano de
-- correção dos e-mails, item 2.9, INF-12).
--
-- O pg_cron marca o job 'succeeded' só por ter enfileirado o POST no pg_net
-- (ops.dispatch_edge_job, migrations 007 e 165); a resposta da Edge Function
-- fica em net._http_response por cerca de 6 h e ninguém a lê. Um 401 depois de
-- trocar um segredo, um 500 ou um tempo esgotado passavam em silêncio.
--
-- 1. Tipo novo rotina_http_falhou (Administrativo, D21).
-- 2. reconcile_http_job_failures_alert(): lê net._http_response da última
--    hora; resposta fora de 2xx, sem status ou com tempo esgotado abre (ou
--    atualiza) um único Alerta com a contagem e os exemplos mais recentes;
--    sem nenhuma na última hora, o Alerta fecha sozinho.
-- 3. Job SQL puro 'http-job-failures', a cada 15 min em :09/:24/:39/:54
--    (fora dos minutos das outras rotinas, migration 165). Não passa pelo
--    pg_net nem por Edge Function: se o próprio disparo HTTP estiver falhando,
--    o aviso ainda sai.
--
-- ponytail: net._http_response não guarda a URL nem o nome do job; o Alerta
-- diz quantas respostas falharam, quando e com que status, mas não qual
-- rotina. Para saber qual, cruzar o horário com cron.job_run_details (ver
-- docs/operations/observabilidade.md). Caminho de melhoria: o dispatcher gravar
-- (request id, job) numa tabela própria. A ausência de linha também não prova
-- ausência de chamada: a tabela é expurgada pelo pg_net depois de ~6 h.
--
-- Não altera nem apaga linhas existentes.

INSERT INTO public.alert_type_catalog (type, severity, responsible_department, audience_departments, default_destination)
VALUES ('rotina_http_falhou', 'critical', 'administrativo', ARRAY['administrativo'], '/alertas')
ON CONFLICT (type) DO NOTHING;

CREATE OR REPLACE FUNCTION public.reconcile_http_job_failures_alert(p_window interval DEFAULT interval '1 hour')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_window interval := COALESCE(p_window, interval '1 hour');
  v_failures integer := 0;
  v_total integer := 0;
  v_last timestamptz;
  v_examples jsonb := '[]'::jsonb;
  v_summary text;
BEGIN
  -- Chamado pelo pg_cron como dono, sem claims de requisição: o Alerta exige
  -- executor autorizado (alert_actor_is_authorized), como no runner dos
  -- detectores.
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);

  IF to_regclass('net._http_response') IS NULL THEN
    RETURN jsonb_build_object('skipped', 'net._http_response ausente');
  END IF;

  -- SQL dinâmico: o banco local e as branches sem pg_net não têm a tabela.
  EXECUTE $sql$
    WITH recent AS (
      SELECT r.id, r.status_code, COALESCE(r.timed_out, false) AS timed_out, r.error_msg, r.created
      FROM net._http_response r
      WHERE r.created >= now() - $1
    ), failed AS (
      SELECT * FROM recent
      WHERE timed_out OR status_code IS NULL OR status_code NOT BETWEEN 200 AND 299
    )
    SELECT
      (SELECT count(*) FROM failed)::integer,
      (SELECT count(*) FROM recent)::integer,
      (SELECT max(created) FROM failed),
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'request_id', f.id,
          'status_code', f.status_code,
          'timed_out', f.timed_out,
          'error', left(f.error_msg, 200),
          'at', f.created
        ) ORDER BY f.created DESC)
        FROM (SELECT * FROM failed ORDER BY created DESC LIMIT 5) f
      ), '[]'::jsonb)
  $sql$
  INTO v_failures, v_total, v_last, v_examples
  USING v_window;

  IF v_failures > 0 THEN
    SELECT string_agg(
      CASE
        WHEN (e->>'timed_out')::boolean THEN 'tempo esgotado'
        WHEN e->>'status_code' IS NULL THEN 'sem resposta'
        ELSE 'HTTP ' || (e->>'status_code')
      END || ' às ' || to_char((e->>'at')::timestamptz AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI'),
      ', ')
      INTO v_summary
    FROM jsonb_array_elements(v_examples) e;

    PERFORM public.upsert_alert_item(
      'rotina_http_falhou',
      'cron_http',
      'net_http_response',
      format('%s de %s chamada(s) das rotinas agendadas à Edge Function na última hora não terminaram com sucesso (%s). Confira a rotina pelo horário em cron.job_run_details e o segredo dela no Vault e na Edge Function.',
        v_failures, v_total, v_summary),
      'http-job-failures',
      jsonb_build_object('failures', v_failures, 'responses', v_total, 'last_failure_at', v_last, 'examples', v_examples),
      '/alertas'
    );
  ELSE
    PERFORM public.resolve_alert_item('rotina_http_falhou', 'cron_http', 'net_http_response', 'http-job-failures',
      jsonb_build_object('responses', v_total));
  END IF;

  RETURN jsonb_build_object('failures', v_failures, 'responses', v_total);
END;
$function$;

REVOKE ALL ON FUNCTION public.reconcile_http_job_failures_alert(interval) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_http_job_failures_alert(interval) TO service_role;

DO $cron_310$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'http-job-failures') THEN
      PERFORM cron.unschedule('http-job-failures');
    END IF;
    PERFORM cron.schedule('http-job-failures', '9-59/15 * * * *', $cmd_311$SELECT public.reconcile_http_job_failures_alert();$cmd_311$);
  ELSE
    RAISE WARNING '311: pg_cron ausente; agende public.reconcile_http_job_failures_alert() a cada 15 minutos neste ambiente.';
  END IF;
END;
$cron_310$;
