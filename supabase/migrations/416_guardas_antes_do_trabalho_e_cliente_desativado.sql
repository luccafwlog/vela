-- 416: guardas de permissão antes do trabalho e cliente desativado fora do
-- Portal (auditoria de segurança run-3, notas de endurecimento).
--
-- 1. `register_ledger_invoice_payment` de 8 argumentos travava os B/Ls da
--    fatura (`bl:<id>`) antes de a guarda de Financeiro rodar na sobrecarga de
--    9 argumentos. A guarda passa a ser a primeira instrução, como na 412 para
--    as importações.
-- 2. `current_user_role()` devolvia o papel de um perfil desativado; nenhuma
--    função o usa hoje, mas uma guarda futura construída sobre ele admitiria a
--    equipe desativada. Passa a devolver NULL para perfil inativo.
-- 3. `deactivate_customer` deixava as sessões do Portal vivas e o marco
--    `credentials_revoked_at` vazio; agora revoga como a suspensão
--    (`portal_revoke_sessions`).
-- 4. Sete funções que só o `service_role` e o pg_cron chamam, e que elevam
--    `request.jwt.claim.role` ou agem como ator do sistema, dependiam só do
--    GRANT. Ganham um envelope com o mesmo nome que recusa (42501) qualquer
--    outro chamador antes do corpo (`*_core_416`, sem EXECUTE para a API).
--    `_reprocess_customer_held_billing_as_system` fica de fora: é chamada de
--    dentro de RPCs do Portal, na sessão do Cliente.
--
-- Só redefine funções; não reescreve nem apaga linhas.
-- Rollback: reaplicar as definições anteriores (247, 002, 092) e renomear os
-- `*_core_416` de volta, removendo os envelopes.

CREATE OR REPLACE FUNCTION public._assert_service_caller()
 RETURNS void
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- Sem JWT na transação não há requisição do PostgREST: pg_cron ou manutenção.
  IF NULLIF(current_setting('request.jwt.claims', true), '') IS NULL
     AND NULLIF(current_setting('request.jwt.claim.sub', true), '') IS NULL
     AND NULLIF(current_setting('request.jwt.claim.role', true), '') IS NULL THEN
    RETURN;
  END IF;
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Rotina reservada ao sistema.' USING ERRCODE = '42501';
  END IF;
END $function$;
REVOKE ALL ON FUNCTION public._assert_service_caller() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.register_ledger_invoice_payment(p_invoice_id bigint, p_amount_brl numeric, p_method text DEFAULT 'pix'::text, p_paid_at timestamp with time zone DEFAULT now(), p_pix_txid text DEFAULT NULL::text, p_source text DEFAULT 'manual'::text, p_notes text DEFAULT NULL::text, p_actor uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_bl_id text;
BEGIN
  -- O autor é quem está logado (ADR 0085, regra base 2; migration 241).
  PERFORM public._assert_actor_is_caller(p_actor);
  -- Mesma guarda da sobrecarga de 9 argumentos, antes de travar os B/Ls.
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_financeiro_user() THEN
    RAISE EXCEPTION 'Credenciais invalidas ou sem permissao de faturamento.' USING ERRCODE = '42501';
  END IF;
  FOR v_bl_id IN
    SELECT DISTINCT links.bl_id
    FROM (
      SELECT ib.bl_id FROM public.invoice_bls ib WHERE ib.invoice_id = p_invoice_id
      UNION
      SELECT r.bl_id FROM public.invoice_receivable_links l JOIN public.bl_receivables r ON r.id = l.receivable_id WHERE l.invoice_id = p_invoice_id
    ) links ORDER BY 1
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('bl:' || v_bl_id, 0));
  END LOOP;
  RETURN public.register_ledger_invoice_payment_legacy_070(p_invoice_id, p_amount_brl, p_method, p_paid_at, p_pix_txid, p_source, p_notes, p_actor);
END;
$function$;

CREATE OR REPLACE FUNCTION public.current_user_role()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT role FROM public.user_profiles WHERE id = auth.uid() AND active;
$function$;

CREATE OR REPLACE FUNCTION public.deactivate_customer(p_customer_id bigint, p_reason text, p_dry_run boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
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

  PERFORM set_config('vela.allow_customer_state', 'on', true);
  UPDATE public.customers
  SET deactivated_at = now(), deactivated_by = auth.uid(), deactivation_reason = v_reason
  WHERE id = p_customer_id;
  PERFORM set_config('vela.allow_customer_state', 'off', true);
  INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  VALUES ('customer', p_customer_id::text, 'deactivated', 'false', 'true', auth.uid(), v_reason);
  -- Cliente desativado sai do Portal na hora: sessões apagadas e tokens
  -- emitidos antes do marco recusados por current_portal_customer_id().
  PERFORM public.portal_revoke_sessions(a.auth_user_id)
  FROM public.customer_portal_accounts a
  WHERE a.customer_id = p_customer_id AND a.auth_user_id IS NOT NULL;
  RETURN jsonb_build_object('deactivated', true, 'reasons', '[]'::jsonb);
END;
$function$;

ALTER FUNCTION public.itau_pix_settle(text,text,numeric,timestamp with time zone) RENAME TO itau_pix_settle_core_416;
REVOKE ALL ON FUNCTION public.itau_pix_settle_core_416(text,text,numeric,timestamp with time zone) FROM PUBLIC, anon, authenticated, service_role;
CREATE FUNCTION public.itau_pix_settle(p_end_to_end_id text, p_txid text, p_amount_brl numeric, p_paid_at timestamp with time zone)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  PERFORM public._assert_service_caller();
  RETURN public.itau_pix_settle_core_416(p_end_to_end_id, p_txid, p_amount_brl, p_paid_at);
END;
$function$;
REVOKE ALL ON FUNCTION public.itau_pix_settle(text,text,numeric,timestamp with time zone) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.itau_pix_settle(text,text,numeric,timestamp with time zone) TO service_role;

ALTER FUNCTION public.itau_pix_receipt_failed(text,text,jsonb,text,boolean) RENAME TO itau_pix_receipt_failed_core_416;
REVOKE ALL ON FUNCTION public.itau_pix_receipt_failed_core_416(text,text,jsonb,text,boolean) FROM PUBLIC, anon, authenticated, service_role;
CREATE FUNCTION public.itau_pix_receipt_failed(p_end_to_end_id text, p_txid text, p_raw jsonb, p_error text, p_permanent boolean DEFAULT false)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  PERFORM public._assert_service_caller();
  RETURN public.itau_pix_receipt_failed_core_416(p_end_to_end_id, p_txid, p_raw, p_error, p_permanent);
END;
$function$;
REVOKE ALL ON FUNCTION public.itau_pix_receipt_failed(text,text,jsonb,text,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.itau_pix_receipt_failed(text,text,jsonb,text,boolean) TO service_role;

ALTER FUNCTION public.itau_pix_record_untracked(text,numeric,timestamp with time zone) RENAME TO itau_pix_record_untracked_core_416;
REVOKE ALL ON FUNCTION public.itau_pix_record_untracked_core_416(text,numeric,timestamp with time zone) FROM PUBLIC, anon, authenticated, service_role;
CREATE FUNCTION public.itau_pix_record_untracked(p_end_to_end_id text, p_amount_brl numeric, p_paid_at timestamp with time zone)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  PERFORM public._assert_service_caller();
  RETURN public.itau_pix_record_untracked_core_416(p_end_to_end_id, p_amount_brl, p_paid_at);
END;
$function$;
REVOKE ALL ON FUNCTION public.itau_pix_record_untracked(text,numeric,timestamp with time zone) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.itau_pix_record_untracked(text,numeric,timestamp with time zone) TO service_role;

ALTER FUNCTION public.reconcile_http_job_failures_alert(interval) RENAME TO reconcile_http_job_failures_alert_core_416;
REVOKE ALL ON FUNCTION public.reconcile_http_job_failures_alert_core_416(interval) FROM PUBLIC, anon, authenticated, service_role;
CREATE FUNCTION public.reconcile_http_job_failures_alert(p_window interval DEFAULT '01:00:00'::interval)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  PERFORM public._assert_service_caller();
  RETURN public.reconcile_http_job_failures_alert_core_416(p_window);
END;
$function$;
REVOKE ALL ON FUNCTION public.reconcile_http_job_failures_alert(interval) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_http_job_failures_alert(interval) TO service_role;

ALTER FUNCTION public.reconcile_import_effects_queue_alert() RENAME TO reconcile_import_effects_queue_alert_core_416;
REVOKE ALL ON FUNCTION public.reconcile_import_effects_queue_alert_core_416() FROM PUBLIC, anon, authenticated, service_role;
CREATE FUNCTION public.reconcile_import_effects_queue_alert()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  PERFORM public._assert_service_caller();
  RETURN public.reconcile_import_effects_queue_alert_core_416();
END;
$function$;
REVOKE ALL ON FUNCTION public.reconcile_import_effects_queue_alert() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_import_effects_queue_alert() TO service_role;

ALTER FUNCTION public.reconcile_itau_pix_checkpoint_alert(interval) RENAME TO reconcile_itau_pix_checkpoint_alert_core_416;
REVOKE ALL ON FUNCTION public.reconcile_itau_pix_checkpoint_alert_core_416(interval) FROM PUBLIC, anon, authenticated, service_role;
CREATE FUNCTION public.reconcile_itau_pix_checkpoint_alert(p_threshold interval DEFAULT '00:15:00'::interval)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  PERFORM public._assert_service_caller();
  RETURN public.reconcile_itau_pix_checkpoint_alert_core_416(p_threshold);
END;
$function$;
REVOKE ALL ON FUNCTION public.reconcile_itau_pix_checkpoint_alert(interval) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_itau_pix_checkpoint_alert(interval) TO service_role;

ALTER FUNCTION public.reevaluate_expired_billing_releases(interval) RENAME TO reevaluate_expired_billing_releases_core_416;
REVOKE ALL ON FUNCTION public.reevaluate_expired_billing_releases_core_416(interval) FROM PUBLIC, anon, authenticated, service_role;
CREATE FUNCTION public.reevaluate_expired_billing_releases(p_lookback interval DEFAULT '7 days'::interval)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  PERFORM public._assert_service_caller();
  RETURN public.reevaluate_expired_billing_releases_core_416(p_lookback);
END;
$function$;
REVOKE ALL ON FUNCTION public.reevaluate_expired_billing_releases(interval) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reevaluate_expired_billing_releases(interval) TO service_role;
