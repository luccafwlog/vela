-- Migration 089: B/L cancelado e Reativar; viagem cancelada por engano volta;
-- cancelar viagem com o Administrativo; CE só se apaga sem fatura (ADR 0071,
-- itens 5, 8 e 9; plano docs/plans/2026-09-24-politica-de-exclusao.md,
-- Fase 4b).
--
-- - bls ganha cancelled_at, cancelled_by e cancel_reason. cancel_bl e
--   reactivate_bl (Administrativo, motivo obrigatório) registram o estado e a
--   auditoria. Cancelar é recusado enquanto houver fatura, recebível ou fatura
--   de Demurrage em aberto do B/L: o Financeiro cancela ou estorna antes.
-- - B/L cancelado fica selado: não é editado nem entra em fatura nova
--   (triggers em bls, invoices e invoice_bls). A unicidade do CE não é
--   imposta pelo banco hoje; o B/L reemitido pode receber o mesmo CE.
-- - O Portal recebe cancelled_at em cada B/L listado, para mostrar Cancelado.
-- - reactivate_voyage devolve a viagem cancelada a ativa (Administrativo,
--   motivo) e recalcula o status pelas escalas; o selo de viagem cancelada
--   passa a aceitar só essa saída controlada.
-- - cancel_voyage passa a exigir o Administrativo.
-- - Apagar o CE Mercante de um B/L é recusado quando há fatura emitida dele.
--
-- Adiciona colunas vazias; não reescreve nem apaga linhas existentes.

ALTER TABLE public.bls
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS cancel_reason text;

CREATE OR REPLACE FUNCTION public.bl_open_financial_reasons(p_bl_id text)
RETURNS text[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_reasons text[] := ARRAY[]::text[];
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.invoices i
    WHERE i.status IN ('draft', 'issued', 'partially_paid')
      AND (i.bl_id = p_bl_id OR EXISTS (SELECT 1 FROM public.invoice_bls ib WHERE ib.invoice_id = i.id AND ib.bl_id = p_bl_id))
  ) THEN
    v_reasons := array_append(v_reasons, 'fatura em aberto');
  END IF;
  IF EXISTS (SELECT 1 FROM public.bl_receivables r WHERE r.bl_id = p_bl_id AND r.status IN ('open', 'partially_settled')) THEN
    v_reasons := array_append(v_reasons, 'recebível em aberto');
  END IF;
  IF EXISTS (SELECT 1 FROM public.demurrage_invoices d WHERE d.bl_id = p_bl_id AND d.status IN ('draft', 'issued', 'overdue')) THEN
    v_reasons := array_append(v_reasons, 'fatura de Demurrage em aberto');
  END IF;
  RETURN v_reasons;
END;
$function$;

REVOKE ALL ON FUNCTION public.bl_open_financial_reasons(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.cancel_bl(p_bl_id text, p_reason text, p_dry_run boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_bl record;
  v_block text[];
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Somente o Administrativo cancela B/L.' USING ERRCODE = '42501';
  END IF;
  SELECT id, cancelled_at INTO v_bl FROM public.bls WHERE id = p_bl_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L % não encontrado.', p_bl_id USING ERRCODE = 'P0002';
  END IF;
  IF v_bl.cancelled_at IS NOT NULL THEN
    RETURN jsonb_build_object('cancelled', false, 'reasons', jsonb_build_array('B/L já cancelado'));
  END IF;
  v_block := public.bl_open_financial_reasons(p_bl_id);
  IF cardinality(v_block) > 0 OR p_dry_run THEN
    RETURN jsonb_build_object('cancelled', false, 'reasons', to_jsonb(v_block), 'dry_run', p_dry_run);
  END IF;
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'Informe o motivo do cancelamento.' USING ERRCODE = '22023';
  END IF;

  PERFORM set_config('vela.allow_bl_state', 'on', true);
  UPDATE public.bls SET cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = v_reason WHERE id = p_bl_id;
  PERFORM set_config('vela.allow_bl_state', 'off', true);
  INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  VALUES ('bl', p_bl_id, 'cancelled', 'false', 'true', auth.uid(), v_reason);
  RETURN jsonb_build_object('cancelled', true, 'reasons', '[]'::jsonb);
END;
$function$;

CREATE OR REPLACE FUNCTION public.reactivate_bl(p_bl_id text, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Somente o Administrativo reativa B/L.' USING ERRCODE = '42501';
  END IF;
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'Informe o motivo da reativação.' USING ERRCODE = '22023';
  END IF;
  PERFORM set_config('vela.allow_bl_state', 'on', true);
  UPDATE public.bls SET cancelled_at = NULL, cancelled_by = NULL, cancel_reason = NULL
  WHERE id = p_bl_id AND cancelled_at IS NOT NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L % não está cancelado.', p_bl_id USING ERRCODE = 'P0002';
  END IF;
  PERFORM set_config('vela.allow_bl_state', 'off', true);
  INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  VALUES ('bl', p_bl_id, 'cancelled', 'true', 'false', auth.uid(), v_reason);
  RETURN jsonb_build_object('reactivated', true);
END;
$function$;

REVOKE ALL ON FUNCTION public.cancel_bl(text, text, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reactivate_bl(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_bl(text, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reactivate_bl(text, text) TO authenticated;

-- B/L cancelado fica selado; o estado muda só por cancel_bl/reactivate_bl.
-- Apagar o CE de B/L com fatura emitida é recusado (ADR 0071, item 5).
CREATE OR REPLACE FUNCTION public.guard_bl_state_and_ce()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_state_change boolean := (OLD.cancelled_at IS DISTINCT FROM NEW.cancelled_at)
    OR (OLD.cancelled_by IS DISTINCT FROM NEW.cancelled_by)
    OR (OLD.cancel_reason IS DISTINCT FROM NEW.cancel_reason);
BEGIN
  IF v_state_change AND current_setting('vela.allow_bl_state', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Use cancel_bl ou reactivate_bl para mudar o estado do B/L.' USING ERRCODE = '42501';
  END IF;
  IF OLD.cancelled_at IS NOT NULL AND NOT v_state_change THEN
    RAISE EXCEPTION 'B/L % cancelado: somente leitura. Reative para corrigir.', OLD.id USING ERRCODE = '42501';
  END IF;
  IF NULLIF(btrim(OLD.ce_mercante), '') IS NOT NULL AND NULLIF(btrim(NEW.ce_mercante), '') IS NULL
     AND EXISTS (
       SELECT 1 FROM public.invoices i
       WHERE i.status NOT IN ('draft', 'cancelled', 'obsolete')
         AND (i.bl_id = OLD.id OR EXISTS (SELECT 1 FROM public.invoice_bls ib WHERE ib.invoice_id = i.id AND ib.bl_id = OLD.id))
     ) THEN
    RAISE EXCEPTION 'O CE Mercante do B/L % não pode ser apagado: há fatura emitida. Corrija o número.', OLD.id USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_guard_bl_state_and_ce ON public.bls;
CREATE TRIGGER trg_guard_bl_state_and_ce
  BEFORE UPDATE ON public.bls
  FOR EACH ROW EXECUTE FUNCTION public.guard_bl_state_and_ce();

CREATE OR REPLACE FUNCTION public.guard_invoice_bl_not_cancelled()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NEW.bl_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.bls WHERE id = NEW.bl_id AND cancelled_at IS NOT NULL) THEN
    RAISE EXCEPTION 'B/L % cancelado não entra em fatura.', NEW.bl_id USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_guard_invoice_bl_not_cancelled ON public.invoices;
CREATE TRIGGER trg_guard_invoice_bl_not_cancelled
  BEFORE INSERT OR UPDATE OF bl_id ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.guard_invoice_bl_not_cancelled();

DROP TRIGGER IF EXISTS trg_guard_invoice_bls_not_cancelled ON public.invoice_bls;
CREATE TRIGGER trg_guard_invoice_bls_not_cancelled
  BEFORE INSERT OR UPDATE OF bl_id ON public.invoice_bls
  FOR EACH ROW EXECUTE FUNCTION public.guard_invoice_bl_not_cancelled();

CREATE OR REPLACE FUNCTION public.guard_voyage_row_cancelled()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF OLD.status IS DISTINCT FROM 'cancelled'
     AND NEW.status = 'cancelled'
     AND current_setting('vela.allow_voyage_cancel', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Use cancel_voyage para cancelar a viagem e registrar o motivo na mesma transação.' USING ERRCODE = '42501';
  END IF;
  IF OLD.status = 'cancelled' AND NEW.status IS DISTINCT FROM 'cancelled'
     AND current_setting('vela.allow_voyage_reactivate', true) = 'on' THEN
    RETURN NEW;
  END IF;
  IF OLD.status = 'cancelled' AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'Viagem % cancelada: operação selada e somente leitura.', OLD.id USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.reactivate_voyage(p_voyage_id bigint, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_status text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Somente o Administrativo reativa viagem.' USING ERRCODE = '42501';
  END IF;
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'Informe o motivo da reativação.' USING ERRCODE = '22023';
  END IF;
  SELECT status INTO v_status FROM public.voyages WHERE id = p_voyage_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Viagem % não encontrada.', p_voyage_id USING ERRCODE = 'P0002';
  END IF;
  IF v_status IS DISTINCT FROM 'cancelled' THEN
    RAISE EXCEPTION 'Viagem % não está cancelada.', p_voyage_id USING ERRCODE = '22023';
  END IF;

  PERFORM set_config('vela.allow_voyage_reactivate', 'on', true);
  UPDATE public.voyages SET status = 'active' WHERE id = p_voyage_id;
  PERFORM set_config('vela.allow_voyage_reactivate', 'off', true);
  PERFORM public.refresh_voyage_status_from_terminal_scales(p_voyage_id);

  INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  VALUES ('voyages', p_voyage_id::text, 'status', 'cancelled', 'active', auth.uid(), 'Reativação de viagem: ' || v_reason);
  RETURN jsonb_build_object('voyage_id', p_voyage_id, 'reactivated', true);
END;
$function$;

REVOKE ALL ON FUNCTION public.reactivate_voyage(bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reactivate_voyage(bigint, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.cancel_voyage(p_voyage_id bigint, p_reason text, p_changed_by uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_old_status text; v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin() OR p_changed_by IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'Somente o Administrativo cancela viagem.' USING ERRCODE = '42501'; END IF;
  IF v_reason IS NULL THEN RAISE EXCEPTION 'Informe o motivo do cancelamento.' USING ERRCODE = '22023'; END IF;
  SELECT status INTO v_old_status FROM public.voyages WHERE id = p_voyage_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Viagem % nao encontrada.', p_voyage_id USING ERRCODE = 'P0002'; END IF;
  IF v_old_status = 'cancelled' THEN RETURN jsonb_build_object('voyage_id', p_voyage_id, 'status', 'cancelled', 'changed', false); END IF;
  PERFORM set_config('vela.allow_voyage_cancel', 'on', true);
  UPDATE public.voyages SET status = 'cancelled' WHERE id = p_voyage_id;
  INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  VALUES ('voyages', p_voyage_id::text, 'status', v_old_status, 'cancelled', p_changed_by, 'Cancelamento de viagem: ' || v_reason);
  RETURN jsonb_build_object('voyage_id', p_voyage_id, 'status', 'cancelled', 'changed', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public._portal_list_operation_bls_core(p_customer_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_rows JSONB := public._portal_list_operation_bls_without_transshipment_core(p_customer_id);
BEGIN
  RETURN (
    SELECT COALESCE(jsonb_agg(
      item || jsonb_build_object(
        'cancelled_at', (SELECT b.cancelled_at FROM public.bls b WHERE b.id = item->>'bl_id'),
        'transshipment', CASE WHEN omission.id IS NULL THEN NULL ELSE jsonb_build_object(
          'omission_id', omission.id,
          'disposition', omission.disposition,
          'omitted_pod', omission.omitted_pod,
          'discharge_pod', omission.discharge_pod,
          'reason', omission.reason,
          'onward_vessel_name', omission.onward_vessel_name,
          'onward_carrier', omission.onward_carrier,
          'onward_voyage_number', omission.onward_voyage_number,
          'onward_etd', omission.onward_etd,
          'onward_eta', omission.onward_eta
        ) END
      ) ORDER BY ordinality
    ), '[]'::jsonb)
    FROM jsonb_array_elements(v_rows) WITH ORDINALITY AS rows(item, ordinality)
    LEFT JOIN LATERAL (
      SELECT vo.id, bt.disposition, vo.omitted_pod, vo.discharge_pod, vo.reason,
             vo.onward_vessel_name, vo.onward_carrier, vo.onward_voyage_number,
             vo.onward_etd, vo.onward_eta
      FROM public.bl_transshipments bt
      JOIN public.voyage_omissions vo ON vo.id = bt.omission_id
      WHERE bt.bl_id = item->>'bl_id'
      ORDER BY vo.omitted_at DESC, vo.id DESC
      LIMIT 1
    ) omission ON true
  );
END;
$function$;
