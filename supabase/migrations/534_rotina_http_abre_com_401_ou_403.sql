-- 534: o Alerta "Rotina agendada com resposta de erro" (`rotina_http_falhou`)
-- abre com uma única resposta 401 ou 403 na última hora.
--
-- Decisão do dono de 2026-10-30, na revisão da PR: a 533 passou a exigir duas
-- falhas na hora, somando todas as rotinas (o pg_net não guarda o job). Rotina
-- diária como `ce-unlock-cleanup` ou `recalc-demurrage-ptax` nunca chega a duas
-- e, com o segredo trocado no Vault e não na Edge Function, responderia 403
-- todo dia sem aviso. 401/403 vem de segredo divergente e não se resolve
-- sozinho; o ruído da itau-pix vem como 500/502 e continua pedindo duas.
--
-- Muda só a contagem e a linha `v_open` do corpo vigente (533); mensagem,
-- janela, limites de tempo esgotado e fila, permissões e fechamento iguais.
-- Não reescreve nem apaga linhas.
-- Rollback: reaplicar o corpo da 533.

CREATE OR REPLACE FUNCTION public.reconcile_http_job_failures_alert_core_425(p_window interval DEFAULT '01:00:00'::interval)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  c_min_timeouts CONSTANT integer := 10;
  c_min_queued CONSTANT integer := 30;
  -- 533: uma falha isolada de rotina de minuto se resolve na rodada seguinte.
  c_min_failures CONSTANT integer := 2;
  v_window interval := COALESCE(p_window, interval '1 hour');
  v_failures integer := 0;
  v_auth integer := 0;
  v_timeouts integer := 0;
  v_total integer := 0;
  v_queued integer := 0;
  v_last timestamptz;
  v_examples jsonb := '[]'::jsonb;
  v_summary text;
  v_open boolean;
BEGIN
  -- Chamado pelo pg_cron como dono, sem claims de requisição: o Alerta exige
  -- executor autorizado (alert_actor_is_authorized), como no runner dos
  -- detectores.
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);

  IF to_regclass('net._http_response') IS NULL THEN
    RETURN jsonb_build_object('skipped', 'net._http_response ausente');
  END IF;

  -- SQL dinâmico: o banco local e as branches sem pg_net não têm a tabela.
  -- Tempo esgotado conta à parte: o pg_net desiste aos 30 s, a Edge Function
  -- não.
  EXECUTE $sql$
    WITH recent AS (
      SELECT r.id, r.status_code, COALESCE(r.timed_out, false) AS timed_out, r.error_msg, r.created
      FROM net._http_response r
      WHERE r.created >= now() - $1
    ), failed AS (
      SELECT * FROM recent
      WHERE NOT timed_out AND (status_code IS NULL OR status_code NOT BETWEEN 200 AND 299)
    ), shown AS (
      SELECT * FROM recent
      WHERE timed_out OR status_code IS NULL OR status_code NOT BETWEEN 200 AND 299
    )
    SELECT
      (SELECT count(*) FROM failed)::integer,
      (SELECT count(*) FROM failed WHERE status_code IN (401, 403))::integer,
      (SELECT count(*) FROM recent WHERE timed_out)::integer,
      (SELECT count(*) FROM recent)::integer,
      (SELECT max(created) FROM shown),
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'request_id', f.id,
          'status_code', f.status_code,
          'timed_out', f.timed_out,
          'error', left(f.error_msg, 200),
          'at', f.created
        ) ORDER BY f.created DESC)
        FROM (SELECT * FROM shown ORDER BY created DESC LIMIT 5) f
      ), '[]'::jsonb)
  $sql$
  INTO v_failures, v_auth, v_timeouts, v_total, v_last, v_examples
  USING v_window;

  IF to_regclass('net.http_request_queue') IS NOT NULL THEN
    EXECUTE 'SELECT count(*)::integer FROM net.http_request_queue' INTO v_queued;
  END IF;

  -- 534: 401/403 é segredo divergente e não se resolve sozinho: uma basta,
  -- também na rotina diária, que nunca chega a duas falhas na hora.
  v_open := v_failures >= c_min_failures OR v_auth >= 1 OR v_timeouts >= c_min_timeouts OR v_queued >= c_min_queued;

  IF v_open THEN
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
      format('%s de %s chamada(s) das rotinas à Edge Function (agendadas ou pelo evento) na última hora não terminaram com sucesso (%s)%s. Confira a rotina pelo horário em cron.job_run_details ou, na chamada pelo evento, pelo id do pedido em ops.edge_job_kicks (last_request_id), e o segredo dela no Vault e na Edge Function.',
        v_failures + v_timeouts, v_total, COALESCE(v_summary, 'sem resposta registrada'),
        CASE WHEN v_queued >= c_min_queued
          THEN format('; %s chamada(s) paradas na fila do pg_net, sem resposta', v_queued)
          ELSE '' END),
      'http-job-failures',
      jsonb_build_object('failures', v_failures, 'timeouts', v_timeouts, 'queued', v_queued,
        'responses', v_total, 'last_failure_at', v_last, 'examples', v_examples),
      '/alertas'
    );
  ELSE
    PERFORM public.resolve_alert_item('rotina_http_falhou', 'cron_http', 'net_http_response', 'http-job-failures',
      jsonb_build_object('responses', v_total, 'timeouts', v_timeouts, 'queued', v_queued));
  END IF;

  RETURN jsonb_build_object('failures', v_failures, 'timeouts', v_timeouts, 'queued', v_queued, 'responses', v_total);
END;
$function$;
