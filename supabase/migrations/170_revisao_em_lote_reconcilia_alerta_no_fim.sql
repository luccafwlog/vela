-- Migration 170: reavaliações em lote da Revisão reconciliam o Alerta do
-- Cliente uma vez, no fim, e não a cada B/L.
--
-- Antes: o gatilho de linha `trg_reconcile_bl_review_alerts` (002) em `bls`
-- reconciliava o Alerta do Cliente a cada mudança de `review_status`. Nos
-- lotes — o gatilho de Portal, contatos e Liberação
-- (`trg_reconcile_bl_review_on_portal_change`, 002/167) e o job da Liberação
-- vencida (168) — isso:
--   - recontava todos os B/Ls do Cliente por B/L (quadrático; o gatilho de
--     Portal ainda chamava `reconcile_bl_review_alerts` por B/L, de novo
--     reconciliando o Cliente inteiro);
--   - abria o Alerta no primeiro B/L e notificava com a contagem parcial; as
--     iterações seguintes atualizavam o Alerta, mas não notificavam de novo.
--
-- Agora:
--   - o gatilho de linha não faz nada enquanto `vela.bl_review_batch = 'on'`
--     (GUC local da transação);
--   - o gatilho de Portal/contatos/Liberação e o job da 168 ligam o GUC só em
--     volta de `recompute_bl_review_status` e reconciliam o Alerta do Cliente
--     uma vez, no fim, com `reconcile_customer_bl_review_alerts`. A
--     notificação sai com a contagem final;
--   - o gatilho de Portal deixa de selecionar B/L cancelado (já não muda nada
--     desde a 168, que tornou `recompute_bl_review_status` inerte para ele).
--
-- O gatilho de Portal deixa de chamar `reconcile_bl_review_alerts`, que
-- também resolvia os itens legados por B/L (`entity_type = 'bl'`). Esses itens
-- são anteriores à consolidação por Cliente; o gatilho de linha continua
-- tratando cada B/L fora de lote.
--
-- Não reescreve nem apaga linhas; só redefine funções.
--
-- Rollback: reaplicar `trg_reconcile_bl_review_alerts` e
--   `trg_reconcile_bl_review_on_portal_change` da 002 e
--   `reevaluate_expired_billing_releases` da 168.

BEGIN;

CREATE OR REPLACE FUNCTION public.trg_reconcile_bl_review_alerts() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  -- Lote (170): quem muda vários B/Ls de uma vez reconcilia o Alerta do Cliente
  -- uma vez no fim. Reconciliar aqui a cada linha recontaria o Cliente por B/L
  -- e notificaria com a contagem parcial do primeiro.
  IF current_setting('vela.bl_review_batch', true) = 'on' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  PERFORM set_config('alerts.foundation_trigger', 'on', true);

  IF TG_OP = 'DELETE' THEN
    PERFORM public.reconcile_customer_bl_review_alerts(OLD.customer_id, OLD.consignee, 'bl_deleted');
    RETURN OLD;
  ELSIF TG_OP = 'INSERT' THEN
    PERFORM public.reconcile_customer_bl_review_alerts(NEW.customer_id, NEW.consignee, 'bl_inserted');
    RETURN NEW;
  ELSE
    IF OLD.review_status IS DISTINCT FROM NEW.review_status
       OR OLD.customer_id IS DISTINCT FROM NEW.customer_id
       OR OLD.consignee IS DISTINCT FROM NEW.consignee
       OR OLD.cargo_mode IS DISTINCT FROM NEW.cargo_mode
       OR OLD.bb_weight_ton IS DISTINCT FROM NEW.bb_weight_ton THEN
      PERFORM public.reconcile_customer_bl_review_alerts(NEW.customer_id, NEW.consignee, 'bl_updated');
      IF OLD.customer_id IS DISTINCT FROM NEW.customer_id
         OR OLD.consignee IS DISTINCT FROM NEW.consignee THEN
        PERFORM public.reconcile_customer_bl_review_alerts(OLD.customer_id, OLD.consignee, 'bl_customer_changed');
      END IF;
    END IF;
    RETURN NEW;
  END IF;
  PERFORM set_config('alerts.foundation_trigger', 'off', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_reconcile_bl_review_on_portal_change() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_customer_id BIGINT;
  v_bl_id TEXT;
BEGIN
  v_customer_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.customer_id ELSE NEW.customer_id END;
  PERFORM set_config('alerts.foundation_trigger', 'on', true);
  PERFORM set_config('vela.bl_review_batch', 'on', true);
  FOR v_bl_id IN
    SELECT id FROM public.bls
    WHERE customer_id = v_customer_id
      AND review_status IN ('pending_review', 'reviewed')
      AND COALESCE(financial_status, '') NOT IN ('invoiced', 'partially_paid', 'paid')
      AND cancelled_at IS NULL
  LOOP
    PERFORM public.recompute_bl_review_status(v_bl_id);
  END LOOP;
  PERFORM set_config('vela.bl_review_batch', 'off', true);
  IF v_customer_id IS NOT NULL THEN
    PERFORM public.reconcile_customer_bl_review_alerts(v_customer_id, NULL, 'portal_account_change');
  END IF;
  PERFORM set_config('alerts.foundation_trigger', 'off', true);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.reevaluate_expired_billing_releases(
  p_lookback interval DEFAULT interval '7 days'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn_170$
DECLARE
  v_previous_role text := current_setting('request.jwt.claim.role', true);
  v_customer_id bigint;
  v_bl_id text;
  v_customers integer := 0;
  v_bls integer := 0;
BEGIN
  IF p_lookback IS NULL OR p_lookback <= interval '0' THEN
    RAISE EXCEPTION 'Janela de vencimento inválida.' USING ERRCODE = '22023';
  END IF;

  -- Chamada pelo pg_cron, sem JWT. A reconciliação de Alertas exige um ator
  -- autorizado; o papel de serviço vale só até o fim desta função.
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('alerts.foundation_trigger', 'on', true);

  FOR v_customer_id IN
    SELECT DISTINCT r.customer_id
    FROM public.customer_billing_portal_releases AS r
    WHERE r.revoked_at IS NULL
      AND r.review_at <= now()
      AND r.review_at > now() - p_lookback
      AND NOT public.customer_billing_access_ready(r.customer_id)
  LOOP
    v_customers := v_customers + 1;
    FOR v_bl_id IN
      SELECT b.id
      FROM public.bls AS b
      WHERE b.customer_id = v_customer_id
        AND b.review_status IN ('pending_review', 'reviewed')
        AND b.cancelled_at IS NULL
        AND COALESCE(b.financial_status, '') NOT IN ('invoiced', 'partially_paid', 'paid')
    LOOP
      PERFORM set_config('vela.bl_review_batch', 'on', true);
      PERFORM public.recompute_bl_review_status(v_bl_id);
      PERFORM set_config('vela.bl_review_batch', 'off', true);
      v_bls := v_bls + 1;
    END LOOP;
    -- Um Alerta por Cliente, depois do lote: o gatilho de linha fica calado
    -- durante o recálculo (170) e, com Cliente vinculado, o consignatário não
    -- entra na conta.
    PERFORM public.reconcile_customer_bl_review_alerts(v_customer_id, NULL, 'billing_release_expired');
  END LOOP;

  PERFORM set_config('alerts.foundation_trigger', 'off', true);
  PERFORM set_config('request.jwt.claim.role', COALESCE(v_previous_role, ''), true);

  RETURN jsonb_build_object('customers', v_customers, 'bls', v_bls);
END;
$fn_170$;

COMMIT;
