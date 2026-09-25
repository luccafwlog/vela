-- Migration 092: cliente desativado (ADR 0073, itens 5 e 6; plano
-- docs/plans/2026-09-24-politica-de-exclusao.md, Fase 5b).
--
-- - customers ganha deactivated_at, deactivated_by e deactivation_reason.
--   deactivate_customer e reactivate_customer (Administrativo, motivo) mudam
--   o estado; desativar é recusado enquanto houver fatura, recebível ou fatura
--   de Demurrage em aberto do cliente.
-- - Cliente desativado perde o Portal: current_portal_customer_id recusa a
--   sessão, e com ela todas as RPCs do Portal.
-- - B/L com o CNPJ de cliente desativado não se vincula sozinho: o vínculo
--   automático por documento vira sugestão (matched_name) com a nota
--   "cliente desativado", e o B/L aparece na Revisão. Vínculo manual a
--   cliente desativado é recusado.
--
-- Adiciona colunas vazias; não reescreve nem apaga linhas existentes.

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS deactivated_at timestamptz,
  ADD COLUMN IF NOT EXISTS deactivated_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS deactivation_reason text;

CREATE OR REPLACE FUNCTION public.customer_open_financial_reasons(p_customer_id bigint)
RETURNS text[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_reasons text[] := ARRAY[]::text[];
BEGIN
  IF EXISTS (SELECT 1 FROM public.invoices WHERE customer_id = p_customer_id AND status IN ('draft', 'issued', 'partially_paid')) THEN
    v_reasons := array_append(v_reasons, 'fatura em aberto');
  END IF;
  IF EXISTS (SELECT 1 FROM public.bl_receivables WHERE customer_id = p_customer_id AND status IN ('open', 'partially_settled')) THEN
    v_reasons := array_append(v_reasons, 'recebível em aberto');
  END IF;
  IF EXISTS (SELECT 1 FROM public.demurrage_invoices WHERE customer_id = p_customer_id AND status IN ('draft', 'issued', 'overdue')) THEN
    v_reasons := array_append(v_reasons, 'fatura de Demurrage em aberto');
  END IF;
  RETURN v_reasons;
END;
$function$;

REVOKE ALL ON FUNCTION public.customer_open_financial_reasons(bigint) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.deactivate_customer(p_customer_id bigint, p_reason text, p_dry_run boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_block text[];
  v_current timestamptz;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Somente o Administrativo desativa cliente.' USING ERRCODE = '42501';
  END IF;
  SELECT deactivated_at INTO v_current FROM public.customers WHERE id = p_customer_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cliente % não encontrado.', p_customer_id USING ERRCODE = 'P0002';
  END IF;
  IF v_current IS NOT NULL THEN
    RETURN jsonb_build_object('deactivated', false, 'reasons', jsonb_build_array('cliente já desativado'));
  END IF;
  v_block := public.customer_open_financial_reasons(p_customer_id);
  IF cardinality(v_block) > 0 OR p_dry_run THEN
    RETURN jsonb_build_object('deactivated', false, 'reasons', to_jsonb(v_block), 'dry_run', p_dry_run);
  END IF;
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'Informe o motivo da desativação.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.customers
  SET deactivated_at = now(), deactivated_by = auth.uid(), deactivation_reason = v_reason
  WHERE id = p_customer_id;
  INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  VALUES ('customer', p_customer_id::text, 'deactivated', 'false', 'true', auth.uid(), v_reason);
  RETURN jsonb_build_object('deactivated', true, 'reasons', '[]'::jsonb);
END;
$function$;

CREATE OR REPLACE FUNCTION public.reactivate_customer(p_customer_id bigint, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Somente o Administrativo reativa cliente.' USING ERRCODE = '42501';
  END IF;
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'Informe o motivo da reativação.' USING ERRCODE = '22023';
  END IF;
  UPDATE public.customers
  SET deactivated_at = NULL, deactivated_by = NULL, deactivation_reason = NULL
  WHERE id = p_customer_id AND deactivated_at IS NOT NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cliente % não está desativado.', p_customer_id USING ERRCODE = 'P0002';
  END IF;
  INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  VALUES ('customer', p_customer_id::text, 'deactivated', 'true', 'false', auth.uid(), v_reason);
  RETURN jsonb_build_object('reactivated', true);
END;
$function$;

REVOKE ALL ON FUNCTION public.deactivate_customer(bigint, text, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reactivate_customer(bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.deactivate_customer(bigint, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reactivate_customer(bigint, text) TO authenticated;

-- Estado de desativação só pelas RPCs.
CREATE OR REPLACE FUNCTION public.guard_customer_deactivation_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF (OLD.deactivated_at IS DISTINCT FROM NEW.deactivated_at
      OR OLD.deactivated_by IS DISTINCT FROM NEW.deactivated_by
      OR OLD.deactivation_reason IS DISTINCT FROM NEW.deactivation_reason)
     AND auth.uid() IS NOT NULL
     AND current_user NOT IN ('postgres', 'supabase_admin') THEN
    RAISE EXCEPTION 'Use deactivate_customer ou reactivate_customer.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_guard_customer_deactivation_columns ON public.customers;
CREATE TRIGGER trg_guard_customer_deactivation_columns
  BEFORE UPDATE ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.guard_customer_deactivation_columns();

-- Vínculo a cliente desativado: o automático vira sugestão para a Revisão; o
-- manual é recusado (reative antes).
CREATE OR REPLACE FUNCTION public.guard_bl_link_to_deactivated_customer()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NEW.customer_id IS NULL
     OR (TG_OP = 'UPDATE' AND OLD.customer_id IS NOT DISTINCT FROM NEW.customer_id)
     OR NOT EXISTS (SELECT 1 FROM public.customers WHERE id = NEW.customer_id AND deactivated_at IS NOT NULL) THEN
    RETURN NEW;
  END IF;

  IF NEW.customer_reconciliation_status = 'matched_document' THEN
    NEW.suggested_customer_id := NEW.customer_id;
    NEW.customer_id := NULL;
    NEW.customer_reconciliation_status := 'matched_name';
    NEW.customer_reconciliation_notes := 'Cliente desativado: reative o cliente ou escolha outro.';
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Cliente % desativado: reative antes de vincular.', NEW.customer_id USING ERRCODE = '42501';
END;
$function$;

DROP TRIGGER IF EXISTS trg_guard_bl_link_to_deactivated_customer ON public.bls;
CREATE TRIGGER trg_guard_bl_link_to_deactivated_customer
  BEFORE INSERT OR UPDATE OF customer_id ON public.bls
  FOR EACH ROW EXECUTE FUNCTION public.guard_bl_link_to_deactivated_customer();

CREATE OR REPLACE FUNCTION public.current_portal_customer_id()
 RETURNS bigint
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_customer_id bigint;
  v_revoked_at timestamptz;
  v_issued_at timestamptz;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sessao do portal invalida ou expirada.' USING ERRCODE = '28000';
  END IF;

  SELECT a.customer_id, a.credentials_revoked_at
  INTO v_customer_id, v_revoked_at
  FROM public.customer_portal_accounts AS a
  WHERE a.auth_user_id = auth.uid()
    AND a.active = true;

  IF v_customer_id IS NULL THEN
    RAISE EXCEPTION 'Sessao do portal invalida ou expirada.' USING ERRCODE = '28000';
  END IF;

  IF EXISTS (SELECT 1 FROM public.customers WHERE id = v_customer_id AND deactivated_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Acesso ao Portal encerrado: cliente desativado.' USING ERRCODE = '28000';
  END IF;

  IF v_revoked_at IS NOT NULL THEN
    -- Sem iat confiável não há como provar emissão pós-revogação.
    BEGIN
      v_issued_at := to_timestamp(NULLIF(auth.jwt() ->> 'iat', '')::double precision);
    EXCEPTION WHEN OTHERS THEN
      v_issued_at := NULL;
    END;

    IF v_issued_at IS NULL OR v_issued_at < v_revoked_at THEN
      RAISE EXCEPTION 'Sessao do portal invalida ou expirada.' USING ERRCODE = '28000';
    END IF;
  END IF;

  RETURN v_customer_id;
END;
$function$;
