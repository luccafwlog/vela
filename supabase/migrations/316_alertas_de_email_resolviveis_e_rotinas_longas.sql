-- Migration 316: correções da revisão rigorosa do PR #973 no monitoramento
-- dos e-mails (plano de correção dos e-mails,
-- docs/plans/2026-10-17-correcao-dos-emails.md, itens 1F, 2.3 e 2.9).
--
-- 1. Evento de e-mail em investigação (portal_reprocessamento_falhou com
--    entity_type 'portal_email_event', migrations 109 e 309): o evento fica em
--    'investigate' para sempre e nenhuma rotina fecha o Alerta; o tipo não
--    estava entre os resolvidos com justificativa, então o Alerta só podia ser
--    dispensado e voltava na data de revisão. Passa a resolver com
--    justificativa só quando a entidade é o evento de e-mail: o mesmo tipo no
--    reprocessamento do faturamento por B/L (entity_type 'bl') continua
--    fechando sozinho pela origem. A regra fica em
--    _alert_item_resolved_with_justification(tipo, entidade), espelhada em
--    src/services/alerts.ts (canResolveWithJustification).
-- 2. Aviso do Desbloqueio de CE não enviado (desbloqueio_ce_aviso_nao_enviado,
--    migration 307): fecha quando um aviso seguinte do mesmo Cliente sai. Se a
--    solicitação já terminou, isso não acontece mais, e o catálogo já prometia
--    "resolver com justificativa". O tipo entra na lista.
-- 3. Rotina agendada com resposta de erro (rotina_http_falhou, migration 310):
--    o pg_net desiste da resposta aos 30 s (ops.dispatch_edge_job, migration
--    165), mas a Edge Function continua a rodada; o runner dos Comunicados e a
--    Régua de Cobrança passam disso num lote grande. Um tempo esgotado isolado
--    abria o Alerta crítico com a rodada concluída e o heartbeat verde. Agora
--    abrem o Alerta: resposta fora de 2xx, falha sem resposta que não é tempo
--    esgotado (conexão recusada, DNS) e 10 ou mais tempos esgotados na hora,
--    que só uma rotina de minuto travada produz (as rotinas de 15 min fazem no
--    máximo 4 chamadas por hora).
-- 4. Worker do pg_net parado: as chamadas ficam em net.http_request_queue sem
--    gerar resposta, e a contagem zerada fechava o Alerta. 30 ou mais chamadas
--    na fila (cerca de 10 min de rotinas de minuto) passam a abrir o Alerta.
--
-- ponytail: os limites (10 tempos esgotados, 30 na fila) são heurísticos; a
-- fila não guarda horário nem rotina. Caminho de melhoria: o dispatcher gravar
-- (request id, job, enviado_em) numa tabela própria, como no ponytail da 310.
--
-- Só troca funções; não altera nem apaga linhas.

-- ---------------------------------------------------------------------------
-- 1 e 2. Resolver com justificativa.
-- ---------------------------------------------------------------------------
-- Definição da migration 313 com o aviso do Desbloqueio de CE.
CREATE OR REPLACE FUNCTION public._alert_types_resolved_with_justification()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT ARRAY['portal_abuso_login', 'bl_vehicles_changed_on_reimport', 'ce_trocado_com_desbloqueio',
    'cobranca_demurrage_recusada', 'desbloqueio_ce_aviso_nao_enviado']::text[];
$function$;

CREATE OR REPLACE FUNCTION public._alert_item_resolved_with_justification(p_item_type text, p_entity_type text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT p_item_type = ANY (public._alert_types_resolved_with_justification())
    -- Evento de e-mail em investigação: nenhuma rotina o tira de 'investigate'.
    OR (p_item_type = 'portal_reprocessamento_falhou' AND p_entity_type = 'portal_email_event');
$function$;

REVOKE ALL ON FUNCTION public._alert_item_resolved_with_justification(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._alert_item_resolved_with_justification(text, text) TO authenticated, service_role;

-- Definição vigente (migration 238) com a checagem por tipo e entidade.
CREATE OR REPLACE FUNCTION public.resolve_alert_item_with_justification(p_item_id bigint, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_item public.alert_items%ROWTYPE;
  v_entity_type text;
  v_event_id bigint;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501';
  END IF;
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'Informe a justificativa da resolução.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_item FROM public.alert_items WHERE id = p_item_id AND status = 'active' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item de alerta não está ativo.' USING ERRCODE = 'P0002';
  END IF;
  SELECT a.entity_type INTO v_entity_type FROM public.alerts a WHERE a.id = v_item.alert_id;
  IF NOT public._alert_item_resolved_with_justification(v_item.item_type, v_entity_type) THEN
    RAISE EXCEPTION 'Este alerta fecha sozinho quando a origem é corrigida; não se resolve com justificativa.'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.alert_items
  SET status = 'resolved', updated_at = now(), resolved_at = now()
  WHERE id = v_item.id;
  INSERT INTO public.alert_item_events(
    alert_item_id, occurrence_id, event_type, previous_status, new_status, actor_id, metadata
  ) VALUES (
    v_item.id, v_item.occurrence_id, 'resolved', 'active', 'resolved', auth.uid(),
    jsonb_build_object('source', 'resolved_with_justification', 'reason', v_reason)
  ) RETURNING id INTO v_event_id;
  PERFORM public.refresh_alert_aggregate(v_item.alert_id);

  RETURN jsonb_build_object('item_id', v_item.id, 'event_id', v_event_id, 'reason', v_reason);
END;
$function$;

-- ---------------------------------------------------------------------------
-- 3 e 4. Rotinas agendadas com resposta de erro.
-- ---------------------------------------------------------------------------
-- Definição da migration 310 com a contagem separada de tempo esgotado e da
-- fila do pg_net.
CREATE OR REPLACE FUNCTION public.reconcile_http_job_failures_alert(p_window interval DEFAULT interval '1 hour')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  c_min_timeouts CONSTANT integer := 10;
  c_min_queued CONSTANT integer := 30;
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

  v_open := v_failures > 0 OR v_timeouts >= c_min_timeouts OR v_queued >= c_min_queued;

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
      format('%s de %s chamada(s) das rotinas agendadas à Edge Function na última hora não terminaram com sucesso (%s)%s. Confira a rotina pelo horário em cron.job_run_details e o segredo dela no Vault e na Edge Function.',
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

REVOKE ALL ON FUNCTION public.reconcile_http_job_failures_alert(interval) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_http_job_failures_alert(interval) TO service_role;
