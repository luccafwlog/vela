-- 238: alertas fecham pela origem; conferência sem fato se resolve com
-- justificativa (itens B27 e A23 do plano de correções; ADR 0053; ADR 0083,
-- item 23).
--
-- Problema:
-- * B27: `resolve_billing_alert` fechava `billing_auto_issue_failed` e
--   `billing_calculation_blocked` para qualquer usuário ativo, com a
--   conferência da origem feita só no navegador.
-- * A23: `comunicado_ce_reenvio_pendente`, `ce_trocado_com_desbloqueio`,
--   `bl_vehicles_changed_on_reimport` e `portal_abuso_login` não tinham
--   resolvedor e ficavam ativos até serem dispensados.
--
-- Mudança:
-- 1. `_billing_alert_origin_resolved(tipo, B/L)` recomputa a origem no
--    servidor: o B/L faturado (situação financeira ou fatura viva), cancelado
--    ou excluído resolve os dois tipos; o bloqueio de cálculo também se
--    resolve com o B/L isento ou com cálculo válido (sem retenção de
--    faturamento, sem linha em revisão e com valor). `resolve_billing_alert`
--    só fecha quando a origem está resolvida e, se não, devolve false sem
--    fechar.
-- 2. "Reenviar Comunicado de CE e Taxas" fecha com o reenvio: o gatilho
--    `resolve_ce_resend_alert_on_communication_sent` resolve
--    `comunicado_ce_reenvio_pendente` dos B/Ls de um Comunicado de CE e Taxas
--    que passa a `enviado` ou `parcial`, criado depois da última abertura do
--    alerta.
-- 3. `ce_trocado_com_desbloqueio` fecha quando a conciliação ZPT confere o
--    Desbloqueio do CE atual do B/L (gatilho
--    `resolve_ce_changed_unlock_alert_on_reconcile`).
-- 4. "Resolver com justificativa": a RPC
--    `resolve_alert_item_with_justification(item, motivo)` resolve, para
--    qualquer usuário interno ativo, os tipos de conferência sem fato de
--    origem (`portal_abuso_login`, `bl_vehicles_changed_on_reimport` e
--    `ce_trocado_com_desbloqueio`, cuja troca pode ter sido remoção do CE),
--    com motivo obrigatório gravado no histórico (`alert_item_events`). A
--    lista é `_alert_types_resolved_with_justification()`, espelhada em
--    `ALERT_TYPES_RESOLVED_WITH_JUSTIFICATION` (`src/services/alerts.ts`).
--
-- Só cria e redefine funções e gatilhos; não reescreve nem apaga linhas.
-- Alertas já abertos fecham no próximo fato de origem ou pela justificativa.
-- Rollback: reaplicar `resolve_billing_alert` da migration 002 e DROP dos
-- gatilhos e funções novos.

-- 1. Origem dos alertas de faturamento.
CREATE OR REPLACE FUNCTION public._billing_alert_origin_resolved(p_type text, p_bl_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE
    WHEN b.id IS NULL OR b.cancelled_at IS NOT NULL THEN true
    WHEN COALESCE(b.financial_status, 'pending') IN ('invoiced', 'partially_paid', 'paid')
      OR cardinality(public._bl_live_invoice_numbers(b.id)) > 0 THEN true
    WHEN p_type = 'billing_auto_issue_failed' THEN false
    WHEN b.charge_status = 'exempt' THEN true
    WHEN b.charge_status IN ('calculated', 'reviewed', 'ready_for_billing')
      AND NULLIF(btrim(COALESCE(b.billing_hold_reason, '')), '') IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.charge_calculations AS c
        WHERE c.bl_id = b.id AND c.status = 'review_required')
      AND EXISTS (
        SELECT 1 FROM public.charge_calculations AS c
        WHERE c.bl_id = b.id AND c.status IN ('calculated', 'reviewed', 'ready_for_billing')
          AND (COALESCE(c.total_value_brl, 0) > 0 OR COALESCE(c.total_value_usd, 0) > 0)) THEN true
    ELSE false
  END
  FROM (SELECT p_bl_id AS id) AS requested
  LEFT JOIN public.bls AS b ON b.id = requested.id;
$function$;

REVOKE ALL ON FUNCTION public._billing_alert_origin_resolved(text, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.resolve_billing_alert(p_type text, p_bl_id text, p_metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT public.is_active_user() THEN RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501'; END IF;
  IF p_type NOT IN ('billing_calculation_blocked', 'billing_auto_issue_failed') THEN
    RAISE EXCEPTION 'Tipo de faturamento inválido.' USING ERRCODE = '22023';
  END IF;
  -- A conferência do navegador não basta: a origem é recomputada aqui (B27).
  IF NOT public._billing_alert_origin_resolved(p_type, p_bl_id) THEN
    RETURN false;
  END IF;
  RETURN public.resolve_alert_item(p_type, 'bl', p_bl_id, 'billing_client_compatibility',
    COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object('origin_checked', true));
END;
$function$;

-- 2. Reenvio do Comunicado de CE e Taxas.
CREATE OR REPLACE FUNCTION public.resolve_ce_resend_alert_on_communication_sent()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bl_id text;
BEGIN
  IF NEW.kind <> 'ce_mercante_taxas' OR NEW.status NOT IN ('enviado', 'parcial')
     OR (TG_OP = 'UPDATE' AND OLD.status IN ('enviado', 'parcial'))
     OR NOT public.alert_actor_is_authorized() THEN
    RETURN NULL;
  END IF;
  FOR v_bl_id IN
    SELECT DISTINCT a.entity_id
    FROM public.customer_communication_bls AS cb
    JOIN public.alerts AS a ON a.entity_type = 'bl' AND a.entity_id = cb.bl_id
    JOIN public.alert_items AS i ON i.alert_id = a.id
    WHERE cb.communication_id = NEW.id
      AND i.item_type = 'comunicado_ce_reenvio_pendente' AND i.status = 'active'
      -- Só o Comunicado criado depois da última troca de CE vale como reenvio.
      AND i.updated_at <= NEW.created_at
  LOOP
    PERFORM public.resolve_alert_item('comunicado_ce_reenvio_pendente', 'bl', v_bl_id,
      'customer_communication_resend',
      jsonb_build_object('resolution', 'comunicado_reenviado', 'communication_id', NEW.id, 'status', NEW.status));
  END LOOP;
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.resolve_ce_resend_alert_on_communication_sent() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS resolve_ce_resend_alert_on_communication_sent ON public.customer_communications;
CREATE TRIGGER resolve_ce_resend_alert_on_communication_sent
  AFTER INSERT OR UPDATE OF status ON public.customer_communications
  FOR EACH ROW EXECUTE FUNCTION public.resolve_ce_resend_alert_on_communication_sent();

-- 3. Desbloqueio do CE novo conferido pela conciliação ZPT.
CREATE OR REPLACE FUNCTION public.resolve_ce_changed_unlock_alert_on_reconcile()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.status <> 'unlocked' OR NOT public.alert_actor_is_authorized() THEN
    RETURN NULL;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.bls AS b
    WHERE b.id = NEW.bl_id
      AND public.ce_mercante_key(b.ce_mercante) = public.ce_mercante_key(NEW.ce_mercante))
  AND EXISTS (
    SELECT 1 FROM public.alert_items AS i
    JOIN public.alerts AS a ON a.id = i.alert_id
    WHERE i.item_type = 'ce_trocado_com_desbloqueio' AND i.status = 'active'
      AND a.entity_type = 'bl' AND a.entity_id = NEW.bl_id) THEN
    PERFORM public.resolve_alert_item('ce_trocado_com_desbloqueio', 'bl', NEW.bl_id,
      'ce_unlock_reconcile',
      jsonb_build_object('resolution', 'desbloqueio_do_ce_atual_conferido', 'ce_mercante', NEW.ce_mercante));
  END IF;
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.resolve_ce_changed_unlock_alert_on_reconcile() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS resolve_ce_changed_unlock_alert_on_reconcile ON public.ce_unlock_zpt_status;
CREATE TRIGGER resolve_ce_changed_unlock_alert_on_reconcile
  AFTER INSERT OR UPDATE OF status, ce_mercante ON public.ce_unlock_zpt_status
  FOR EACH ROW EXECUTE FUNCTION public.resolve_ce_changed_unlock_alert_on_reconcile();

-- 4. Resolver com justificativa.
CREATE OR REPLACE FUNCTION public._alert_types_resolved_with_justification()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT ARRAY['portal_abuso_login', 'bl_vehicles_changed_on_reimport', 'ce_trocado_com_desbloqueio']::text[];
$function$;

CREATE OR REPLACE FUNCTION public.resolve_alert_item_with_justification(p_item_id bigint, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_item public.alert_items%ROWTYPE;
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
  IF NOT v_item.item_type = ANY (public._alert_types_resolved_with_justification()) THEN
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

REVOKE ALL ON FUNCTION public.resolve_alert_item_with_justification(bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_alert_item_with_justification(bigint, text) TO authenticated;
