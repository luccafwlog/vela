-- 622: B/L divergente na ZPT vira alerta Crítico, e o prazo do desbloqueio
-- perde o limite de idade (decisões 1 e 3 do dono de 2026-11-07; ADR 0134,
-- lote A do plano 2026-11-07-brechas-restantes-da-revisao-dos-alertas).
--
-- 1. Alerta novo `desbloqueio_divergente_zpt` (Crítico, Documentação, com o
--    Administrativo na audiência), por B/L: a conciliação da ZPT gravou o B/L
--    como divergente (`ce_unlock_zpt_status.status = 'divergent'`) no CE que
--    ele tem agora. A mensagem traz a situação e a descrição da ZPT e as
--    pendências. Fecha quando uma conciliação seguinte traz o B/L desbloqueado,
--    a linha da ZPT sai, o CE do B/L muda ou o B/L é cancelado. Abre e fecha
--    na hora da conciliação (gatilho em `ce_unlock_zpt_status`) e na rotina
--    `ce-unlock-alerts` (5 minutos), que pega a troca de CE.
-- 2. A rotina deixa de limitar a 30 dias o alerta **Prazo do desbloqueio
--    vencendo** (621): todo B/L com prazo e sem desbloqueio conferido entra.
--
-- Plano de preservação: a migration acrescenta um tipo ao catálogo, funções e
-- redefine a rotina e o gatilho da 621; não reescreve nem apaga linha
-- existente. Efeito no dia: a primeira rodada abre o alerta do prazo para os
-- B/Ls antigos com prazo e sem conciliação (decisão do dono) e o divergente
-- para os B/Ls já gravados como divergentes no CE atual. Conferir: `SELECT
-- item_type, status, count(*) FROM alert_items WHERE item_type LIKE
-- 'desbloqueio_%' GROUP BY 1, 2` depois da primeira rodada. Desfazer: o
-- rollback abaixo e `UPDATE alert_type_catalog SET active = false WHERE type =
-- 'desbloqueio_divergente_zpt'`.
--
-- Rollback: reaplicar `reconcile_ce_unlock_alerts` e
-- `_ce_unlock_deadline_alert_on_zpt` pela 621 e dropar
-- `reconcile_ce_unlock_zpt_divergent_alert`.

INSERT INTO public.alert_type_catalog (type, severity, responsible_department, audience_departments, default_destination, active)
VALUES ('desbloqueio_divergente_zpt', 'critical', 'documentacao', ARRAY['documentacao', 'administrativo'], '/desbloqueio-ce?aba=controle', true)
ON CONFLICT (type) DO NOTHING;

CREATE OR REPLACE FUNCTION public.reconcile_ce_unlock_zpt_divergent_alert(p_bl_id text, p_source text DEFAULT 'ce_unlock_alerts')
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_row record;
BEGIN
  SELECT z.zpt_status, z.description, z.pending, z.zpt_updated_at, z.reconciled_at, z.ce_mercante
  INTO v_row
  FROM public.ce_unlock_zpt_status z
  JOIN public.bls b ON b.id = z.bl_id
  WHERE z.bl_id = p_bl_id
    AND z.status = 'divergent'
    AND z.ce_mercante IS NOT DISTINCT FROM b.ce_mercante
    AND b.cancelled_at IS NULL;

  IF NOT FOUND THEN
    PERFORM public.resolve_alert_item('desbloqueio_divergente_zpt', 'bl', p_bl_id, p_source, '{}'::jsonb);
    RETURN;
  END IF;

  PERFORM public.upsert_alert_item(
    'desbloqueio_divergente_zpt', 'bl', p_bl_id,
    'B/L ' || p_bl_id || ': a conciliação da ZPT de '
      || to_char(v_row.reconciled_at AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI')
      || ' trouxe "' || COALESCE(NULLIF(btrim(v_row.zpt_status), ''), 'sem situação') || '"'
      || COALESCE(': ' || NULLIF(btrim(v_row.description), ''), '')
      || CASE WHEN cardinality(v_row.pending) > 0 THEN '. Pendências na ZPT: ' || array_to_string(v_row.pending, ', ') ELSE '' END
      || '. O B/L não está desbloqueado.',
    p_source, 'documentacao',
    jsonb_build_object('ce_mercante', v_row.ce_mercante, 'zpt_status', v_row.zpt_status,
      'zpt_updated_at', v_row.zpt_updated_at, 'reconciled_at', v_row.reconciled_at,
      -- Cada conciliação divergente nova é um marco: avisa de novo.
      'milestone', 'divergente_' || to_char(v_row.reconciled_at, 'YYYYMMDDHH24MISS')),
    NULL);
END;
$function$;
REVOKE ALL ON FUNCTION public.reconcile_ce_unlock_zpt_divergent_alert(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_ce_unlock_zpt_divergent_alert(text, text) TO service_role;

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

  -- 622: B/L com prazo e sem desbloqueio conferido, sem limite de idade.
  -- ponytail: `ce_unlock_private.item` por B/L candidato; com milhares de B/Ls
  -- antigos sem conciliação, a rodada fica mais lenta. Upgrade: guardar o
  -- início do prazo numa coluna.
  FOR r IN
    SELECT c.bl_id FROM (
      SELECT i.bl_id FROM public.ce_unlock_request_bls i WHERE i.active
      UNION
      SELECT d.bl_id FROM public.ce_unlock_direct_validations d
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

  FOR r IN
    SELECT z.bl_id FROM public.ce_unlock_zpt_status z WHERE z.status = 'divergent'
    UNION
    SELECT a.entity_id FROM public.alert_items i JOIN public.alerts a ON a.id = i.alert_id
    WHERE i.item_type = 'desbloqueio_divergente_zpt' AND i.status = 'active'
  LOOP
    PERFORM public.reconcile_ce_unlock_zpt_divergent_alert(r.bl_id, p_source);
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$function$;
REVOKE ALL ON FUNCTION public.reconcile_ce_unlock_alerts(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_ce_unlock_alerts(text) TO service_role;

-- A conciliação abre e fecha os dois alertas do B/L na hora.
CREATE OR REPLACE FUNCTION public._ce_unlock_deadline_alert_on_zpt()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bl text := CASE WHEN TG_OP = 'DELETE' THEN OLD.bl_id ELSE NEW.bl_id END;
BEGIN
  PERFORM set_config('alerts.foundation_trigger', 'on', true);
  PERFORM public.reconcile_ce_unlock_zpt_divergent_alert(v_bl, 'ce_unlock_reconcile');
  IF EXISTS (
    SELECT 1 FROM public.alert_items i JOIN public.alerts a ON a.id = i.alert_id
    WHERE i.item_type = 'desbloqueio_prazo_vencendo' AND i.status = 'active'
      AND a.entity_type = 'bl' AND a.entity_id = v_bl) THEN
    PERFORM public.reconcile_ce_unlock_deadline_alert(v_bl, 'ce_unlock_reconcile');
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Alertas do desbloqueio ignorados na conciliação da ZPT: %', SQLERRM;
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public._ce_unlock_deadline_alert_on_zpt() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_ce_unlock_deadline_alert_on_zpt ON public.ce_unlock_zpt_status;
CREATE TRIGGER trg_ce_unlock_deadline_alert_on_zpt
  AFTER INSERT OR DELETE OR UPDATE OF status, ce_mercante, reconciled_at ON public.ce_unlock_zpt_status
  FOR EACH ROW EXECUTE FUNCTION public._ce_unlock_deadline_alert_on_zpt();
