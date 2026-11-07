-- 621: o alerta "Prazo do desbloqueio vencendo" fecha pela conciliação da ZPT
-- (correção do dono de 2026-11-06 à decisão D1; ADR 0133).
--
-- Na 617 o alerta fechava com a exportação para a ZPT. A exportação só manda a
-- planilha: o desbloqueio só está feito quando a conciliação da ZPT traz o B/L
-- como "Desbloqueado" para o CE atual (`ce_unlock_zpt_status.status =
-- 'unlocked'` com o CE do B/L). Agora:
--   1. O alerta continua aberto depois da exportação e fecha quando a
--      conciliação marca o B/L desbloqueado no CE atual, quando o prazo deixa
--      de correr ou quando o B/L é cancelado. Depois do vencimento, segue
--      Crítico até a conciliação.
--   2. A mensagem diz se o B/L já foi exportado e espera a ZPT.
--   3. A conciliação fecha o alerta na hora (gatilho
--      `trg_ce_unlock_deadline_alert_on_zpt`), sem esperar a rotina.
--   4. A rotina `ce-unlock-alerts` passa a olhar os B/Ls com prazo e sem
--      desbloqueio conferido, e não mais os não exportados.
--   ponytail: a rotina só abre alerta para prazo que começou nos últimos 30
--   dias, para não abrir de uma vez para B/Ls antigos que nunca passaram pela
--   conciliação; um alerta já aberto é reavaliado até fechar. Upgrade: uma
--   data de corte própria, se o dono quiser cobrar os antigos.
--
-- Plano de preservação: a migration só redefine funções e acrescenta um
-- gatilho; não reescreve nem apaga linha existente. Itens já abertos de
-- `desbloqueio_prazo_vencendo` passam a fechar pela nova regra na rodada
-- seguinte da rotina (5 minutos), registrando `origin_cleared` no histórico do
-- item. Conferir: `SELECT status, count(*) FROM alert_items WHERE item_type =
-- 'desbloqueio_prazo_vencendo' GROUP BY 1` antes e depois. Desfazer: o
-- rollback abaixo.
--
-- Rollback: `DROP TRIGGER trg_ce_unlock_deadline_alert_on_zpt ON
-- ce_unlock_zpt_status`, dropar `_ce_unlock_deadline_alert_on_zpt` e
-- `_ce_unlock_zpt_unlocked`, e reaplicar `reconcile_ce_unlock_deadline_alert`
-- e `reconcile_ce_unlock_alerts` pela 617.

-- Desbloqueio conferido: a conciliação da ZPT trouxe o B/L como desbloqueado
-- no CE que ele tem agora (o mesmo critério do `ce_unlock_private.item`).
CREATE OR REPLACE FUNCTION public._ce_unlock_zpt_unlocked(p_bl_id text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.ce_unlock_zpt_status z
    JOIN public.bls b ON b.id = z.bl_id
    WHERE z.bl_id = p_bl_id
      AND z.status = 'unlocked'
      AND z.ce_mercante IS NOT DISTINCT FROM b.ce_mercante);
$function$;
REVOKE ALL ON FUNCTION public._ce_unlock_zpt_unlocked(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._ce_unlock_zpt_unlocked(text) TO service_role;

CREATE OR REPLACE FUNCTION public.reconcile_ce_unlock_deadline_alert(p_bl_id text, p_source text DEFAULT 'ce_unlock_alerts')
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_item jsonb;
  v_start timestamptz;
  v_exported boolean;
  v_deadline timestamptz;
  v_critical boolean;
BEGIN
  IF public._ce_unlock_zpt_unlocked(p_bl_id)
     OR NOT EXISTS (SELECT 1 FROM public.bls b WHERE b.id = p_bl_id AND b.cancelled_at IS NULL) THEN
    PERFORM public.resolve_alert_item('desbloqueio_prazo_vencendo', 'bl', p_bl_id, p_source, '{}'::jsonb);
    RETURN;
  END IF;

  v_item := ce_unlock_private.item(p_bl_id);
  v_start := NULLIF(v_item->>'sla_started_at', '')::timestamptz;
  IF v_start IS NULL THEN
    PERFORM public.resolve_alert_item('desbloqueio_prazo_vencendo', 'bl', p_bl_id, p_source, '{}'::jsonb);
    RETURN;
  END IF;

  v_deadline := ce_unlock_private.sla_deadline(v_start);
  IF now() < v_start + interval '2 hours' AND now() < v_deadline - interval '2 hours' THEN
    PERFORM public.resolve_alert_item('desbloqueio_prazo_vencendo', 'bl', p_bl_id, p_source, '{}'::jsonb);
    RETURN;
  END IF;

  v_exported := NULLIF(v_item->>'exported_at', '') IS NOT NULL;
  v_critical := now() >= v_deadline - interval '2 hours';
  PERFORM public.upsert_alert_item(
    'desbloqueio_prazo_vencendo', 'bl', p_bl_id,
    'B/L ' || p_bl_id || ': o desbloqueio vence em '
      || to_char(v_deadline AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI')
      || CASE WHEN now() >= v_deadline THEN ' e já venceu' WHEN v_critical THEN ' (faltam menos de 2 horas)' ELSE '' END
      || CASE WHEN v_exported THEN '. Exportado para a ZPT; falta a conciliação trazer o B/L desbloqueado.'
              ELSE '. Ainda não exportado para a ZPT.' END,
    p_source, 'documentacao',
    jsonb_build_object('sla_started_at', v_start, 'deadline', v_deadline, 'exported', v_exported)
      || CASE WHEN v_critical THEN jsonb_build_object('milestone', 'prazo_critico', 'severity', 'critical')
              ELSE jsonb_build_object('milestone', 'prazo_correndo') END,
    NULL);
END;
$function$;
REVOKE ALL ON FUNCTION public.reconcile_ce_unlock_deadline_alert(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_ce_unlock_deadline_alert(text, text) TO service_role;

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

  -- 621: B/L com prazo e sem desbloqueio conferido pela ZPT, exportado ou não.
  FOR r IN
    SELECT c.bl_id FROM (
      SELECT i.bl_id FROM public.ce_unlock_request_bls i
      WHERE i.active AND (i.exported_at IS NULL OR i.exported_at >= now() - interval '30 days')
      UNION
      SELECT d.bl_id FROM public.ce_unlock_direct_validations d
      WHERE d.validated_at >= now() - interval '30 days'
    ) c
    JOIN public.bls b ON b.id = c.bl_id AND b.cancelled_at IS NULL
    WHERE NOT public._ce_unlock_zpt_unlocked(c.bl_id)
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

-- A conciliação da ZPT fecha (ou reabre, se o B/L deixa de estar
-- desbloqueado) o alerta do prazo na hora.
CREATE OR REPLACE FUNCTION public._ce_unlock_deadline_alert_on_zpt()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bl text := CASE WHEN TG_OP = 'DELETE' THEN OLD.bl_id ELSE NEW.bl_id END;
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.alert_items i JOIN public.alerts a ON a.id = i.alert_id
    WHERE i.item_type = 'desbloqueio_prazo_vencendo' AND i.status = 'active'
      AND a.entity_type = 'bl' AND a.entity_id = v_bl) THEN
    PERFORM set_config('alerts.foundation_trigger', 'on', true);
    PERFORM public.reconcile_ce_unlock_deadline_alert(v_bl, 'ce_unlock_reconcile');
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Alerta do prazo do desbloqueio ignorado na conciliação da ZPT: %', SQLERRM;
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public._ce_unlock_deadline_alert_on_zpt() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_ce_unlock_deadline_alert_on_zpt ON public.ce_unlock_zpt_status;
CREATE TRIGGER trg_ce_unlock_deadline_alert_on_zpt
  AFTER INSERT OR UPDATE OF status, ce_mercante ON public.ce_unlock_zpt_status
  FOR EACH ROW EXECUTE FUNCTION public._ce_unlock_deadline_alert_on_zpt();
