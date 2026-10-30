-- 515: o Alerta "Rotina agendada com resposta de erro" (`rotina_http_falhou`)
-- abre com 2 ou mais respostas de erro na última hora, não com uma.
--
-- Decisão do dono de 2026-10-30. Evidência: a `itau-pix` roda a cada minuto
-- (~1.440 chamadas por dia) e falhou isolada 11 vezes em 7 dias em produção
-- (Sentry VELA-26; uma delas um 403 "Certificado inválido" do Itaú), sempre
-- com a rodada seguinte bem-sucedida. Cada falha isolada abria o Alerta
-- crítico por pelo menos uma hora.
--
-- Muda só o limiar de abertura no corpo vigente (`_core_425`, que o envelope
-- da 425 chama): tempo esgotado (10) e fila do pg_net (30) continuam como
-- estavam. Com 2 ou mais falhas, a mensagem e o metadata são os mesmos.
-- Não reescreve nem apaga linhas.
-- Rollback: reaplicar o corpo com `v_failures > 0`.

CREATE OR REPLACE FUNCTION public.reconcile_http_job_failures_alert_core_425(p_window interval DEFAULT '01:00:00'::interval)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  c_min_timeouts CONSTANT integer := 10;
  c_min_queued CONSTANT integer := 30;
  -- 515: uma falha isolada de rotina de minuto se resolve na rodada seguinte.
  c_min_failures CONSTANT integer := 2;
  v_window interval := COALESCE(p_window, interval '1 hour');
  v_failures integer := 0;
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
  INTO v_failures, v_timeouts, v_total, v_last, v_examples
  USING v_window;

  IF to_regclass('net.http_request_queue') IS NOT NULL THEN
    EXECUTE 'SELECT count(*)::integer FROM net.http_request_queue' INTO v_queued;
  END IF;

  v_open := v_failures >= c_min_failures OR v_timeouts >= c_min_timeouts OR v_queued >= c_min_queued;

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
