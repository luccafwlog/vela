-- Migration 169: B/L cancelado deixa de contar nos Alertas de revisão do
-- Cliente.
--
-- Antes: `cancel_bl` (089) preenche `cancelled_at` e mantém `review_status`.
-- `reconcile_customer_bl_review_alerts` (085) contava os B/Ls `pending_review`
-- e os retidos por falta de Portal sem olhar `cancelled_at`. Um B/L cancelado
-- em revisão abria ou mantinha sozinho `review_portal_not_ready`,
-- `review_breakbulk_weight_missing` ou `review_customer_unlinked`, e inflava
-- `pending_count`/`held_count`. Todo chamador herdava isso: o gatilho de linha
-- em `bls`, os gatilhos de Portal, contatos e Liberação (002/167), o
-- reprocessamento do Portal e os detectores.
--
-- Agora as três contagens filtram `cancelled_at IS NULL`. O resto da função é
-- o da 085, sem mudança. Cancelar e reativar passam a reconciliar o Alerta do
-- Cliente na hora: o gatilho de linha da 002 só olha `review_status`, Cliente,
-- consignatário, modo de carga e peso BB, e `cancelled_at` não está entre
-- eles. Um gatilho próprio, em `UPDATE OF cancelled_at`, cobre isso sem
-- redefinir o da 002. O bloco final reconcilia, uma vez, os Clientes e
-- consignatários que têm B/L cancelado em revisão ou retido, para fechar os
-- Alertas abertos só por eles.
--
-- Não reescreve nem apaga linhas de `bls`; o bloco final só resolve ou
-- atualiza itens de Alerta pelas funções de Alerta.
--
-- Rollback: reaplicar `reconcile_customer_bl_review_alerts` da 085;
--   DROP TRIGGER trg_reconcile_bl_review_alerts_on_cancel ON public.bls;
--   DROP FUNCTION public.trg_reconcile_bl_review_alerts_on_cancel();

BEGIN;

CREATE OR REPLACE FUNCTION public.reconcile_customer_bl_review_alerts(
  p_customer_id bigint,
  p_consignee text,
  p_source text DEFAULT 'bl_review_gate'::text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_source text := COALESCE(NULLIF(btrim(p_source), ''), 'bl_review_gate');
  v_customer_name text;
  v_customer_label text;
  v_entity_id text;
  v_consignee_key text;
  v_portal_ready boolean := false;
  v_portal_held integer := 0;
  v_total_pending integer := 0;
  v_bb_pending integer := 0;
  v_msg text;
BEGIN
  IF p_customer_id IS NOT NULL THEN
    SELECT name INTO v_customer_name FROM public.customers WHERE id = p_customer_id;
    v_customer_label := COALESCE(v_customer_name, 'Cliente #' || p_customer_id::text);
    v_entity_id := p_customer_id::text;

    -- A Liberação de faturamento sem Portal satisfaz o mesmo gate da emissão.
    v_portal_ready := public.customer_billing_access_ready(p_customer_id);
    -- B/Ls cuja fatura o CE reteve por falta de Portal (ADR 0070) contam junto
    -- com os pendentes de revisão: é o que o Portal está segurando.
    SELECT count(*) INTO v_portal_held
    FROM public.bls
    WHERE customer_id = p_customer_id
      AND COALESCE(financial_status, 'pending') = 'pending'
      AND review_status IS DISTINCT FROM 'pending_review'
      AND billing_hold_reason = 'Acesso ao portal nao provisionado'
      AND cancelled_at IS NULL;

    SELECT count(*), count(*) FILTER (
      WHERE cargo_mode IN ('carga_solta', 'misto')
        AND (bb_weight_ton IS NULL OR bb_weight_ton <= 0)
    ) INTO v_total_pending, v_bb_pending
    FROM public.bls
    WHERE customer_id = p_customer_id AND review_status = 'pending_review'
      AND cancelled_at IS NULL;

    -- Desde a 085 o e-mail de contato não é condição de faturamento: a fatura
    -- não é enviada por e-mail. O tipo foi aposentado; só fecha item antigo.
    PERFORM public.resolve_alert_item('review_customer_email_missing', 'customer', v_entity_id, v_source, '{}'::jsonb);

    IF v_total_pending + v_portal_held > 0 AND NOT v_portal_ready THEN
      v_msg := 'Cliente ' || v_customer_label || ': ' || (v_total_pending + v_portal_held) ||
        CASE WHEN v_total_pending + v_portal_held = 1 THEN ' B/L pendente (Conta de Portal não provisionada)'
             ELSE ' B/Ls pendentes (Conta de Portal não provisionada)' END;
      PERFORM public.upsert_alert_item(
        'review_portal_not_ready', 'customer', v_entity_id, v_msg, v_source,
        jsonb_build_object('customer_id', p_customer_id, 'pending_count', v_total_pending, 'held_count', v_portal_held),
        '/clientes/portal?cliente=' || p_customer_id::text
      );
    ELSE
      PERFORM public.resolve_alert_item('review_portal_not_ready', 'customer', v_entity_id, v_source, '{}'::jsonb);
    END IF;

    IF v_bb_pending > 0 THEN
      v_msg := 'Cliente ' || v_customer_label || ': ' || v_bb_pending ||
        CASE WHEN v_bb_pending = 1 THEN ' B/L pendente de revisão (peso BB ausente)'
             ELSE ' B/Ls pendentes de revisão (peso BB ausente)' END;
      PERFORM public.upsert_alert_item(
        'review_breakbulk_weight_missing', 'customer', v_entity_id, v_msg, v_source,
        jsonb_build_object('customer_id', p_customer_id, 'pending_count', v_bb_pending), '/revisao'
      );
    ELSE
      PERFORM public.resolve_alert_item('review_breakbulk_weight_missing', 'customer', v_entity_id, v_source, '{}'::jsonb);
    END IF;
    PERFORM public.resolve_alert_item('review_customer_unlinked', 'customer', v_entity_id, v_source, '{}'::jsonb);
  ELSE
    v_consignee_key := COALESCE(NULLIF(btrim(p_consignee), ''), 'sem_cliente');
    v_entity_id := v_consignee_key;

    SELECT count(*), count(*) FILTER (
      WHERE cargo_mode IN ('carga_solta', 'misto')
        AND (bb_weight_ton IS NULL OR bb_weight_ton <= 0)
    ) INTO v_total_pending, v_bb_pending
    FROM public.bls
    WHERE customer_id IS NULL
      AND review_status = 'pending_review'
      AND COALESCE(NULLIF(btrim(consignee), ''), 'sem_cliente') = v_consignee_key
      AND cancelled_at IS NULL;

    IF v_total_pending > 0 THEN
      v_msg := 'Cliente ' || v_consignee_key || ': ' || v_total_pending ||
        CASE WHEN v_total_pending = 1 THEN ' B/L pendente de vínculo com cliente'
             ELSE ' B/Ls pendentes de vínculo com cliente' END;
      PERFORM public.upsert_alert_item(
        'review_customer_unlinked', 'customer', v_entity_id, v_msg, v_source,
        jsonb_build_object('consignee', v_consignee_key, 'pending_count', v_total_pending), '/revisao'
      );
    ELSE
      PERFORM public.resolve_alert_item('review_customer_unlinked', 'customer', v_entity_id, v_source, '{}'::jsonb);
    END IF;

    IF v_bb_pending > 0 THEN
      v_msg := 'Cliente ' || v_consignee_key || ': ' || v_bb_pending ||
        CASE WHEN v_bb_pending = 1 THEN ' B/L pendente de revisão (peso BB ausente)'
             ELSE ' B/Ls pendentes de revisão (peso BB ausente)' END;
      PERFORM public.upsert_alert_item(
        'review_breakbulk_weight_missing', 'customer', v_entity_id, v_msg, v_source,
        jsonb_build_object('consignee', v_consignee_key, 'pending_count', v_bb_pending), '/revisao'
      );
    ELSE
      PERFORM public.resolve_alert_item('review_breakbulk_weight_missing', 'customer', v_entity_id, v_source, '{}'::jsonb);
    END IF;
    PERFORM public.resolve_alert_item('review_customer_email_missing', 'customer', v_entity_id, v_source, '{}'::jsonb);
    PERFORM public.resolve_alert_item('review_portal_not_ready', 'customer', v_entity_id, v_source, '{}'::jsonb);
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.trg_reconcile_bl_review_alerts_on_cancel()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  PERFORM set_config('alerts.foundation_trigger', 'on', true);
  PERFORM public.reconcile_customer_bl_review_alerts(NEW.customer_id, NEW.consignee, 'bl_cancel_state');
  PERFORM set_config('alerts.foundation_trigger', 'off', true);
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.trg_reconcile_bl_review_alerts_on_cancel() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_reconcile_bl_review_alerts_on_cancel ON public.bls;
CREATE TRIGGER trg_reconcile_bl_review_alerts_on_cancel
  AFTER UPDATE OF cancelled_at ON public.bls
  FOR EACH ROW
  WHEN (OLD.cancelled_at IS DISTINCT FROM NEW.cancelled_at)
  EXECUTE FUNCTION public.trg_reconcile_bl_review_alerts_on_cancel();

DO $backfill_169$
DECLARE
  v_row record;
BEGIN
  -- A migration roda sem JWT. A reconciliação de Alertas exige um ator
  -- autorizado; o papel de serviço vale só até o fim desta transação.
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  FOR v_row IN
    SELECT DISTINCT b.customer_id,
      CASE WHEN b.customer_id IS NULL THEN b.consignee END AS consignee
    FROM public.bls AS b
    WHERE b.cancelled_at IS NOT NULL
      AND (b.review_status = 'pending_review'
        OR b.billing_hold_reason = 'Acesso ao portal nao provisionado')
  LOOP
    PERFORM public.reconcile_customer_bl_review_alerts(v_row.customer_id, v_row.consignee, 'bl_cancelled_backfill');
  END LOOP;
  PERFORM set_config('request.jwt.claim.role', '', true);
END;
$backfill_169$;

COMMIT;
