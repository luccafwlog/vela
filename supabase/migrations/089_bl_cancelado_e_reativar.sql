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
--   (triggers em bls, invoices e invoice_bls). O selo vale para os campos que
--   a pessoa edita; os que o sistema mantém (status financeiro, run de
--   faturamento, manifesto e cliente sugerido zerados por FK SET NULL,
--   updated_at) continuam mudando, para Cancelar baixa, cancelar fatura e
--   excluir o registro referenciado não falharem por causa do B/L cancelado.
--   A importação da base de clientes não vincula B/L cancelado. A unicidade do CE não é
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
  -- Mantidos pelo sistema; mudam mesmo com o B/L cancelado.
  v_system_columns text[] := ARRAY['financial_status', 'updated_at', 'last_billing_run_id', 'manifesto_mercante_id', 'suggested_customer_id'];
BEGIN
  IF v_state_change AND current_setting('vela.allow_bl_state', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Use cancel_bl ou reactivate_bl para mudar o estado do B/L.' USING ERRCODE = '42501';
  END IF;
  IF OLD.cancelled_at IS NOT NULL AND NOT v_state_change
     AND (to_jsonb(NEW) - v_system_columns) IS DISTINCT FROM (to_jsonb(OLD) - v_system_columns) THEN
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

-- Importação da base de clientes: B/L cancelado não é vinculado (fica selado).
CREATE OR REPLACE FUNCTION public.apply_customer_base_row_atomic(p_cnpj text, p_name text, p_trade_name text, p_address text, p_city text, p_state text, p_zip text, p_emails jsonb, p_changed_by uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_cnpj text := NULLIF(btrim(COALESCE(p_cnpj, '')), '');
  v_name text := NULLIF(btrim(COALESCE(p_name, '')), '');
  v_customer_id bigint;
  v_created boolean := false;
  v_email text;
  v_norm text;
  v_seen text[] := ARRAY[]::text[];
  v_contacts_created integer := 0;
  v_bls_linked integer := 0;
BEGIN
  IF v_actor IS NULL OR NOT public.is_active_user() OR p_changed_by IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa.' USING ERRCODE = '42501';
  END IF;
  IF v_cnpj IS NULL OR v_name IS NULL THEN
    RAISE EXCEPTION 'CNPJ e razao social obrigatorios.' USING ERRCODE = '22023';
  END IF;
  IF p_emails IS NULL OR jsonb_typeof(p_emails) <> 'array' OR jsonb_array_length(p_emails) = 0 THEN
    RAISE EXCEPTION 'Ao menos um e-mail obrigatorio.' USING ERRCODE = '22023';
  END IF;

  -- Lock por cliente: serializa concorrentes do mesmo CNPJ.
  SELECT id INTO v_customer_id FROM public.customers WHERE cnpj_cpf = v_cnpj FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.customers(
      cnpj_cpf, name, trade_name, address, city, state, zip, notes, pending_balance
    ) VALUES (
      v_cnpj, v_name,
      NULLIF(btrim(COALESCE(p_trade_name, '')), ''),
      NULLIF(btrim(COALESCE(p_address, '')), ''),
      NULLIF(btrim(COALESCE(p_city, '')), ''),
      NULLIF(upper(btrim(COALESCE(p_state, ''))), ''),
      NULLIF(btrim(COALESCE(p_zip, '')), ''),
      NULL, 0
    ) RETURNING id INTO v_customer_id;
    v_created := true;
  ELSE
    UPDATE public.customers
      SET name = v_name,
          trade_name = COALESCE(NULLIF(btrim(COALESCE(p_trade_name, '')), ''), trade_name),
          address = COALESCE(NULLIF(btrim(COALESCE(p_address, '')), ''), address),
          city = COALESCE(NULLIF(btrim(COALESCE(p_city, '')), ''), city),
          state = COALESCE(NULLIF(upper(btrim(COALESCE(p_state, ''))), ''), state),
          zip = COALESCE(NULLIF(btrim(COALESCE(p_zip, '')), ''), zip),
          updated_at = now()
      WHERE id = v_customer_id;
  END IF;

  -- Bases anteriores podiam ter um principal sem e-mail. Ele não satisfaz o
  -- contrato atual; a transação só termina depois que algum e-mail elegível
  -- assume a principalidade.
  UPDATE public.customer_contacts AS cc
  SET is_primary = false,
      updated_at = now()
  WHERE cc.customer_id = v_customer_id
    AND cc.is_primary = true
    AND cc.deactivated_at IS NULL
    AND cc.email_normalized IS NULL;

  -- Contatos: valida formato e duplicata no envio; existente e no-op.
  -- O primeiro e-mail elegível assume a principalidade se ainda não houver
  -- um principal ativo com e-mail; a decisão é reavaliada a cada iteração.
  FOR v_email IN SELECT value #>> '{}' FROM jsonb_array_elements(p_emails)
  LOOP
    v_norm := lower(NULLIF(btrim(COALESCE(v_email, '')), ''));
    IF v_norm IS NULL OR v_norm !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
      RAISE EXCEPTION 'E-mail invalido para o cliente %: %', v_cnpj, COALESCE(v_email, '') USING ERRCODE = '22023';
    END IF;
    IF v_norm = ANY (v_seen) THEN
      RAISE EXCEPTION 'E-mail duplicado no envio: %', v_norm USING ERRCODE = '23505';
    END IF;
    v_seen := array_append(v_seen, v_norm);

    -- Se o endereço já existia como adicional, promovê-lo também corrige
    -- clientes antigos que chegaram sem principal na base cadastral. Um
    -- contato desativado com o mesmo e-mail deve ser reativado; deixá-lo
    -- fora do INSERT abaixo faria o índice único tratar a linha histórica
    -- como duplicata sem criar um principal ativo.
    UPDATE public.customer_contacts AS cc
    SET deactivated_at = NULL,
        is_primary = NOT EXISTS (
          SELECT 1
          FROM public.customer_contacts AS primary_contact
          WHERE primary_contact.customer_id = v_customer_id
            AND primary_contact.is_primary = true
            AND primary_contact.deactivated_at IS NULL
            AND primary_contact.email_normalized IS NOT NULL
        ),
        updated_at = now()
    WHERE cc.customer_id = v_customer_id
      AND cc.email_normalized = v_norm;

    INSERT INTO public.customer_contacts (customer_id, name, email, purpose, is_primary)
    SELECT
      v_customer_id,
      v_name,
      v_norm,
      'financeiro',
      NOT EXISTS (
        SELECT 1
        FROM public.customer_contacts AS cc
        WHERE cc.customer_id = v_customer_id
          AND cc.is_primary = true
          AND cc.deactivated_at IS NULL
          AND cc.email_normalized IS NOT NULL
      )
    WHERE NOT EXISTS (
      SELECT 1 FROM public.customer_contacts AS cc
      WHERE cc.customer_id = v_customer_id
        AND cc.deactivated_at IS NULL
        AND lower(btrim(COALESCE(cc.email, ''))) = v_norm
    );
    IF FOUND THEN
      v_contacts_created := v_contacts_created + 1;
    END IF;
  END LOOP;

  -- Vinculo retroativo: so B/Ls ainda sem cliente, mesmo CNPJ.
  UPDATE public.bls AS b
    SET customer_id = v_customer_id
    WHERE b.manifest_customer_cnpj_cpf = v_cnpj
      AND b.customer_id IS NULL
      AND b.cancelled_at IS NULL;
  GET DIAGNOSTICS v_bls_linked = ROW_COUNT;

  RETURN jsonb_build_object(
    'customer_id', v_customer_id,
    'created', v_created,
    'contacts_created', v_contacts_created,
    'bls_linked', v_bls_linked
  );
END;
$function$;
