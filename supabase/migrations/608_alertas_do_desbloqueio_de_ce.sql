-- 608: alertas do Desbloqueio de CE (decisão D1 do dono de 2026-11-06; ADR
-- 0131, lote 5 do plano 2026-11-06-decisoes-da-revisao-dos-alertas).
--
-- A nova solicitação já avisa a Documentação e o Administrativo no sino (595,
-- 605), mas nada cobrava a análise nem o prazo de liberação (brechas B01 e
-- B02). Dois tipos novos, da Documentação, com o Administrativo na audiência:
--   1. "Solicitação de desbloqueio sem análise" (Crítico, por solicitação):
--      solicitação do Cliente enviada (`submitted` ou `in_review`) com B/L
--      ativo de Termo ou Procuração ainda não aprovado, 2 horas úteis depois
--      do último envio. Hora útil: 08h às 17h de Brasília, em dia útil
--      (`itau_pix_business_day`, que lê o calendário de feriados). Fecha
--      quando a análise termina, a solicitação volta ao Cliente, é cancelada
--      ou concluída.
--   2. "Prazo do desbloqueio vencendo" (por B/L): com o prazo correndo
--      (`sla_started_at` do item), abre Normal 2 horas depois do início e vira
--      Crítico (marco `prazo_critico`) 2 horas antes do vencimento
--      (`ce_unlock_private.sla_deadline`). Fecha quando o B/L é exportado para
--      a ZPT ou o prazo deixa de correr.
-- A rotina `ce-unlock-alerts` (5 minutos) abre, muda de marco e fecha os dois.
--
-- Plano de preservação: a migration só acrescenta dois tipos ao catálogo,
-- funções e uma rotina; não reescreve nem apaga linha existente. Conferir:
-- `SELECT type FROM alert_type_catalog WHERE type LIKE 'desbloqueio_%'`
-- mostra os dois tipos novos e nenhum outro tipo muda. Desfazer: o rollback
-- abaixo e `UPDATE alert_type_catalog SET active = false WHERE type IN
-- ('desbloqueio_solicitacao_sem_analise', 'desbloqueio_prazo_vencendo')`.
--
-- Rollback: `cron.unschedule('ce-unlock-alerts')` e remover as funções
-- `_add_business_hours`, `reconcile_ce_unlock_request_alert`,
-- `reconcile_ce_unlock_deadline_alert` e `reconcile_ce_unlock_alerts`.

INSERT INTO public.alert_type_catalog (type, severity, responsible_department, audience_departments, default_destination, active)
VALUES
  ('desbloqueio_solicitacao_sem_analise', 'critical', 'documentacao', ARRAY['documentacao', 'administrativo'], '/desbloqueio-ce', true),
  ('desbloqueio_prazo_vencendo', 'normal', 'documentacao', ARRAY['documentacao', 'administrativo'], '/desbloqueio-ce?aba=controle', true)
ON CONFLICT (type) DO NOTHING;

-- Soma horas úteis (08h às 17h de Brasília, dia útil) a um instante.
-- ponytail: laço por dia; cada volta consome um dia inteiro no máximo, então
-- poucas horas custam poucas voltas.
CREATE OR REPLACE FUNCTION public._add_business_hours(p_start timestamptz, p_hours numeric)
 RETURNS timestamptz
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_local timestamp := p_start AT TIME ZONE 'America/Sao_Paulo';
  v_left interval := make_interval(secs => p_hours * 3600);
  v_day date;
  v_end timestamp;
BEGIN
  IF p_start IS NULL OR p_hours IS NULL THEN RETURN NULL; END IF;
  FOR i IN 1..400 LOOP
    v_day := v_local::date;
    IF NOT public.itau_pix_business_day(v_day) OR v_local::time >= time '17:00' THEN
      v_local := (v_day + 1) + time '08:00';
      CONTINUE;
    END IF;
    IF v_local::time < time '08:00' THEN v_local := v_day + time '08:00'; END IF;
    v_end := v_day + time '17:00';
    IF v_local + v_left <= v_end THEN
      RETURN (v_local + v_left) AT TIME ZONE 'America/Sao_Paulo';
    END IF;
    v_left := v_left - (v_end - v_local);
    v_local := (v_day + 1) + time '08:00';
  END LOOP;
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public._add_business_hours(timestamptz, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._add_business_hours(timestamptz, numeric) TO service_role;

-- 1 --- Solicitação sem análise ---------------------------------------------
CREATE OR REPLACE FUNCTION public.reconcile_ce_unlock_request_alert(p_request_id uuid, p_source text DEFAULT 'ce_unlock_alerts')
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_request public.ce_unlock_requests;
  v_customer text;
  v_submitted timestamptz;
  v_due timestamptz;
  v_pending integer := 0;
BEGIN
  SELECT * INTO v_request FROM public.ce_unlock_requests WHERE id = p_request_id;
  IF FOUND AND v_request.source = 'request' AND v_request.state IN ('submitted', 'in_review') THEN
    SELECT count(*) INTO v_pending FROM public.ce_unlock_request_bls i
    WHERE i.request_id = p_request_id AND i.active AND NOT (i.termo_approved AND i.procuracao_approved);
    SELECT max(e.created_at) INTO v_submitted FROM public.ce_unlock_events e
    WHERE e.request_id = p_request_id AND e.action = 'submit';
    v_due := public._add_business_hours(v_submitted, 2);
  END IF;

  IF v_pending = 0 OR v_due IS NULL OR now() < v_due THEN
    PERFORM public.resolve_alert_item('desbloqueio_solicitacao_sem_analise', 'ce_unlock_request', p_request_id::text, p_source, '{}'::jsonb);
    RETURN;
  END IF;

  SELECT c.name INTO v_customer FROM public.customers c WHERE c.id = v_request.customer_id;
  PERFORM public.upsert_alert_item(
    'desbloqueio_solicitacao_sem_analise', 'ce_unlock_request', p_request_id::text,
    'Solicitação ' || v_request.protocol || COALESCE(' de ' || v_customer, '')
      || ' sem análise há mais de 2 horas úteis (enviada em '
      || to_char(v_submitted AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') || ').',
    p_source, 'documentacao',
    jsonb_build_object('protocol', v_request.protocol, 'request_id', p_request_id, 'customer_id', v_request.customer_id,
      'bls', v_pending, 'submitted_at', v_submitted, 'milestone', 'sem_analise_' || to_char(v_submitted, 'YYYYMMDDHH24MISS')),
    NULL);
END;
$function$;
REVOKE ALL ON FUNCTION public.reconcile_ce_unlock_request_alert(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_ce_unlock_request_alert(uuid, text) TO service_role;

-- 2 --- Prazo do desbloqueio, por B/L ----------------------------------------
CREATE OR REPLACE FUNCTION public.reconcile_ce_unlock_deadline_alert(p_bl_id text, p_source text DEFAULT 'ce_unlock_alerts')
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_item jsonb := ce_unlock_private.item(p_bl_id);
  v_start timestamptz := NULLIF(v_item->>'sla_started_at', '')::timestamptz;
  v_deadline timestamptz;
  v_critical boolean;
BEGIN
  IF v_start IS NULL OR NULLIF(v_item->>'exported_at', '') IS NOT NULL
     OR now() < v_start + interval '2 hours' AND now() < ce_unlock_private.sla_deadline(v_start) - interval '2 hours' THEN
    PERFORM public.resolve_alert_item('desbloqueio_prazo_vencendo', 'bl', p_bl_id, p_source, '{}'::jsonb);
    RETURN;
  END IF;

  v_deadline := ce_unlock_private.sla_deadline(v_start);
  v_critical := now() >= v_deadline - interval '2 hours';
  PERFORM public.upsert_alert_item(
    'desbloqueio_prazo_vencendo', 'bl', p_bl_id,
    'B/L ' || p_bl_id || ': o desbloqueio vence em '
      || to_char(v_deadline AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI')
      || CASE WHEN now() >= v_deadline THEN ' e já venceu.' WHEN v_critical THEN ' (faltam menos de 2 horas).' ELSE '.' END,
    p_source, 'documentacao',
    jsonb_build_object('sla_started_at', v_start, 'deadline', v_deadline)
      || CASE WHEN v_critical THEN jsonb_build_object('milestone', 'prazo_critico', 'severity', 'critical')
              ELSE jsonb_build_object('milestone', 'prazo_correndo') END,
    NULL);
END;
$function$;
REVOKE ALL ON FUNCTION public.reconcile_ce_unlock_deadline_alert(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_ce_unlock_deadline_alert(text, text) TO service_role;

-- Rotina: solicitações e B/Ls em andamento, mais os alertas ainda abertos.
CREATE OR REPLACE FUNCTION public.reconcile_ce_unlock_alerts(p_source text DEFAULT 'ce-unlock-alerts')
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  r record;
  v_count integer := 0;
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);

  FOR r IN
    SELECT q.id FROM public.ce_unlock_requests q
    WHERE q.source = 'request' AND q.state IN ('submitted', 'in_review')
    UNION
    SELECT a.entity_id::uuid FROM public.alert_items i JOIN public.alerts a ON a.id = i.alert_id
    WHERE i.item_type = 'desbloqueio_solicitacao_sem_analise' AND i.status = 'active'
  LOOP
    PERFORM public.reconcile_ce_unlock_request_alert(r.id, p_source);
    v_count := v_count + 1;
  END LOOP;

  FOR r IN
    SELECT i.bl_id FROM public.ce_unlock_request_bls i WHERE i.active AND i.exported_at IS NULL
    UNION
    SELECT d.bl_id FROM public.ce_unlock_direct_validations d
    WHERE NOT EXISTS (SELECT 1 FROM public.ce_unlock_direct_exports x WHERE x.bl_id = d.bl_id)
    UNION
    SELECT a.entity_id FROM public.alert_items i JOIN public.alerts a ON a.id = i.alert_id
    WHERE i.item_type = 'desbloqueio_prazo_vencendo' AND i.status = 'active'
  LOOP
    PERFORM public.reconcile_ce_unlock_deadline_alert(r.bl_id, p_source);
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$function$;
REVOKE ALL ON FUNCTION public.reconcile_ce_unlock_alerts(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_ce_unlock_alerts(text) TO service_role;

DO $schedule_608$
BEGIN
  IF to_regnamespace('cron') IS NULL THEN
    RAISE WARNING '608: pg_cron ausente; agende ce-unlock-alerts no ambiente de produção.';
    RETURN;
  END IF;
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'ce-unlock-alerts';
  PERFORM cron.schedule('ce-unlock-alerts', '3-59/5 * * * *',
    $cmd_608$SELECT public.reconcile_ce_unlock_alerts('ce-unlock-alerts');$cmd_608$);
END;
$schedule_608$;
