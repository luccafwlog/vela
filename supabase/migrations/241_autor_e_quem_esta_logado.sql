-- 241: o autor é quem está logado (item P11 do plano de correções; ADR 0085,
-- regra base 2).
--
-- Problema (Postgres local, relatório de 2026-10-14):
-- * `_assert_actor_is_caller` (migration 106) aceitava outro autor quando o
--   chamador era Administrativo, nas quatro RPCs que o usam
--   (`add_manual_bl_charge`, `calculate_bl_local_charges`,
--   `run_billing_for_import_batch` e `reject_customer_reconciliation`).
-- * As RPCs de faturamento que gravam `COALESCE(p_actor, auth.uid())` não
--   conferiam o autor: o Administrativo assinava emissão, baixa,
--   cancelamento e correção em nome de outro usuário.
--
-- Mudança:
-- 1. `_assert_actor_is_caller` recusa qualquer `p_actor` diferente do usuário
--    da sessão, inclusive para o Administrativo. Sem usuário na sessão
--    (`service_role`: Edge Functions, jobs e a fila de efeitos), o autor
--    informado segue valendo, e os jobs continuam assinando `sistema`.
-- 2. Toda RPC executável por `authenticated` que recebe `p_actor` e ainda não
--    conferia passa a chamar `_assert_actor_is_caller(p_actor)` no início:
--    a lista abaixo foi gerada do catálogo (`pg_proc`, `p_actor` entre os
--    argumentos, EXECUTE para `authenticated`) no Postgres local montado
--    pelas migrations, e o corpo de cada uma é a definição vigente com a
--    conferência inserida logo depois do BEGIN. Inclui as que o P4 e o P5
--    abrem a outros Departamentos. Ficam de fora as `SECURITY INVOKER`
--    `mark_bl_ready_and_create_invoice` e `mark_bls_ready_and_create_invoice`,
--    que não executam a guarda (fechada a `authenticated`) e repassam
--    `p_actor` a `mark_bl_ready_for_billing` e
--    `create_invoice_from_bls_with_ledger`, que conferem. A tela já passa o próprio usuário ou nada
--    (`src/services/billing.ts`, `billingLedger.ts`,
--    `charges/chargeOperationsService.ts`); os chamadores internos passam
--    `auth.uid()` ou ajustam a sessão para o autor (`_auto_bill_bl_core`).
--
-- Só redefine funções; não reescreve nem apaga linhas.
-- Rollback: reaplicar `_assert_actor_is_caller` da migration 106 (com a
-- exceção `NOT public.is_admin()`) e as definições anteriores das funções
-- listadas (sem a linha `PERFORM public._assert_actor_is_caller(p_actor)`).

CREATE OR REPLACE FUNCTION public._assert_actor_is_caller(p_actor uuid)
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF p_actor IS NOT NULL AND auth.uid() IS NOT NULL
     AND p_actor IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Autor informado difere do usuário da sessão.' USING ERRCODE = '42501';
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.approve_customer_reconciliation(p_queue_id bigint, p_customer_id bigint DEFAULT NULL::bigint, p_notes text DEFAULT NULL::text, p_actor uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_queue RECORD;
  v_actor UUID;
  v_target_customer_id BIGINT;
  v_financial_status TEXT;
  v_calculation_error TEXT;
BEGIN
  -- O autor é quem está logado (ADR 0085, regra base 2; migration 241).
  PERFORM public._assert_actor_is_caller(p_actor);
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa' USING ERRCODE = '42501';
  END IF;

  IF NOT public.is_admin() AND p_actor IS NOT NULL AND p_actor IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'O ator informado deve ser o usuario autenticado.' USING ERRCODE = '42501';
  END IF;
  v_actor := CASE WHEN public.is_admin() THEN COALESCE(p_actor, auth.uid()) ELSE auth.uid() END;

  SELECT * INTO v_queue
  FROM public.customer_reconciliation_queue
  WHERE id = p_queue_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item de reconciliacao % nao encontrado.', p_queue_id USING ERRCODE = 'P0002';
  END IF;

  v_target_customer_id := COALESCE(p_customer_id, v_queue.customer_id);
  IF v_target_customer_id IS NULL THEN
    RAISE EXCEPTION 'Informe um cliente para aprovar a reconciliacao.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.bls
  SET
    customer_id = v_target_customer_id,
    suggested_customer_id = NULL,
    customer_reconciliation_status = 'reconciled',
    customer_reconciliation_notes = COALESCE(NULLIF(TRIM(COALESCE(p_notes, '')), ''), 'Cliente reconciliado manualmente.'),
    billing_hold_reason = NULL
  WHERE id = v_queue.bl_id;

  UPDATE public.customer_reconciliation_queue
  SET
    customer_id = v_target_customer_id,
    status = 'approved',
    resolution_notes = COALESCE(NULLIF(TRIM(COALESCE(p_notes, '')), ''), 'Cliente reconciliado manualmente.'),
    approved_by = v_actor,
    approved_at = now(),
    rejected_by = NULL,
    rejected_at = NULL
  WHERE id = p_queue_id;

  PERFORM public.capture_manifest_financial_contact(
    v_target_customer_id,
    v_queue.manifest_customer_email
  );

  PERFORM public.sync_customer_reconciliation_queue_for_bl(v_queue.bl_id);

  -- Se o B/L ainda nao foi faturado, recalcula as taxas locais com as condicoes
  -- especiais do novo cliente vinculado e gera o recebivel no ledger (bl_receivables)
  SELECT financial_status INTO v_financial_status
  FROM public.bls
  WHERE id = v_queue.bl_id;

  IF v_financial_status IS NULL OR v_financial_status = 'pending' THEN
    BEGIN
      PERFORM public.calculate_bl_local_charges(v_queue.bl_id, v_actor, true);
    EXCEPTION WHEN OTHERS THEN
      v_calculation_error := SQLERRM;
      INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification)
      VALUES (
        'bl', v_queue.bl_id, 'local_charges_reconciliation_calc_error', NULL, v_calculation_error,
        v_actor, now(), 'Falha no recalculo de taxas locais apos aprovacao de reconciliacao de cliente.'
      );
    END;
  END IF;

  INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification)
  VALUES (
    'bl', v_queue.bl_id, 'customer_reconciliation_status', COALESCE(v_queue.status, 'pending'), 'reconciled',
    v_actor, now(), COALESCE(NULLIF(TRIM(COALESCE(p_notes, '')), ''), 'Cliente reconciliado manualmente.')
  );

  RETURN jsonb_build_object(
    'queue_id', p_queue_id,
    'bl_id', v_queue.bl_id,
    'customer_id', v_target_customer_id,
    'status', 'approved',
    'calculation_error', v_calculation_error
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.calculate_bl_local_charges_batch(p_bl_ids text[], p_actor uuid DEFAULT NULL::uuid, p_recalculate boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bl_id text;
  v_actor uuid;
  v_results jsonb := '[]'::jsonb;
  v_total integer := 0;
  v_success_count integer := 0;
  v_error_count integer := 0;
  v_errors jsonb := '[]'::jsonb;
  v_res jsonb;
BEGIN
  -- O autor é quem está logado (ADR 0085, regra base 2; migration 241).
  PERFORM public._assert_actor_is_caller(p_actor);
  IF auth.uid() IS NOT NULL AND NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa' USING ERRCODE = '42501';
  END IF;

  IF auth.uid() IS NOT NULL
     AND NOT public.is_admin()
     AND p_actor IS NOT NULL
     AND p_actor IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'O ator informado deve ser o usuario autenticado.' USING ERRCODE = '42501';
  END IF;
  v_actor := CASE WHEN auth.uid() IS NOT NULL AND NOT public.is_admin() THEN auth.uid() ELSE COALESCE(p_actor, auth.uid()) END;

  IF p_bl_ids IS NULL OR cardinality(p_bl_ids) = 0 THEN
    RETURN jsonb_build_object(
      'total', 0,
      'success_count', 0,
      'error_count', 0,
      'results', '[]'::jsonb,
      'errors', '[]'::jsonb
    );
  END IF;

  IF cardinality(p_bl_ids) > 100 THEN
    RAISE EXCEPTION 'O lote de calculo aceita no maximo 100 B/Ls por chamada.'
      USING ERRCODE = '22023';
  END IF;

  FOREACH v_bl_id IN ARRAY p_bl_ids LOOP
    v_bl_id := btrim(v_bl_id);
    CONTINUE WHEN v_bl_id IS NULL OR v_bl_id = '';
    v_total := v_total + 1;
    BEGIN
      v_res := public.calculate_bl_local_charges(v_bl_id, v_actor, p_recalculate);
      v_results := v_results || jsonb_build_array(v_res);
      v_success_count := v_success_count + 1;
    EXCEPTION WHEN OTHERS THEN
      v_error_count := v_error_count + 1;
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'bl_id', v_bl_id,
        'message', SQLERRM
      ));
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'total', v_total,
    'success_count', v_success_count,
    'error_count', v_error_count,
    'results', v_results,
    'errors', v_errors
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.calculate_granite_bl_charges(p_bl_id uuid, p_actor uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bl public.granite_bls%ROWTYPE;
  v_actor uuid;
  v_rate record;
  v_quantity numeric(14,6);
  v_subtotal numeric(14,2);
  v_line_count integer := 0;
  v_total numeric(14,2) := 0;
  v_charges jsonb := '[]'::jsonb;
BEGIN
  -- O autor é quem está logado (ADR 0085, regra base 2; migration 241).
  PERFORM public._assert_actor_is_caller(p_actor);
  IF auth.uid() IS NULL
     OR NOT public.is_active_user()
     OR (p_actor IS NOT NULL AND p_actor IS DISTINCT FROM auth.uid()) THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa para calcular taxas de Granito.'
      USING ERRCODE = '42501';
  END IF;

  v_actor := COALESCE(p_actor, auth.uid());

  SELECT * INTO v_bl
  FROM public.granite_bls
  WHERE id = p_bl_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L Granito % nao encontrado.', p_bl_id
      USING ERRCODE = 'P0002';
  END IF;

  IF v_bl.real_weight_kg IS NULL OR v_bl.real_weight_kg <= 0 THEN
    RAISE EXCEPTION 'B/L Granito % sem peso real positivo.', p_bl_id
      USING ERRCODE = '22023';
  END IF;

  -- A ausência de tarifa é uma pendência operacional, não uma tabela vazia.
  -- O teste ocorre antes do DELETE para preservar um snapshot anterior
  -- quando o cálculo novo não pode ser concluído.
  IF NOT EXISTS (
    SELECT 1
    FROM public.granite_rates
    WHERE active = true
      AND (valid_from IS NULL OR valid_from <= CURRENT_DATE)
      AND (valid_to IS NULL OR valid_to >= CURRENT_DATE)
  ) THEN
    RAISE EXCEPTION 'Nenhuma tarifa ativa de Granito para a data %.', CURRENT_DATE
      USING ERRCODE = 'P0002';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.granite_rates
    WHERE active = true
      AND (valid_from IS NULL OR valid_from <= CURRENT_DATE)
      AND (valid_to IS NULL OR valid_to >= CURRENT_DATE)
      AND unit_value < 0
  ) THEN
    RAISE EXCEPTION 'Existe tarifa ativa de Granito com valor negativo.'
      USING ERRCODE = '22023';
  END IF;

  DELETE FROM public.granite_bl_charges
  WHERE bl_id = p_bl_id;

  FOR v_rate IN
    SELECT id, description, charge_type, unit_value, currency
    FROM public.granite_rates
    WHERE active = true
      AND (valid_from IS NULL OR valid_from <= CURRENT_DATE)
      AND (valid_to IS NULL OR valid_to >= CURRENT_DATE)
    ORDER BY id
  LOOP
    v_quantity := CASE v_rate.charge_type
      WHEN 'per_kg' THEN v_bl.real_weight_kg
      WHEN 'per_ton' THEN v_bl.real_weight_kg / 1000
      WHEN 'per_bl' THEN 1
      WHEN 'fixed' THEN 1
      ELSE NULL
    END;

    IF v_quantity IS NULL THEN
      RAISE EXCEPTION 'Tipo de tarifa de Granito nao suportado: %.', v_rate.charge_type
        USING ERRCODE = '22023';
    END IF;

    v_subtotal := round(v_quantity * v_rate.unit_value, 2);

    INSERT INTO public.granite_bl_charges(
      bl_id, rate_id, description, charge_type, unit_value, quantity,
      subtotal, currency, calculated_at
    ) VALUES (
      p_bl_id, v_rate.id, v_rate.description, v_rate.charge_type,
      v_rate.unit_value, v_quantity, v_subtotal, v_rate.currency, now()
    );

    v_line_count := v_line_count + 1;
    v_total := v_total + v_subtotal;
    v_charges := v_charges || jsonb_build_array(jsonb_build_object(
      'bl_id', p_bl_id,
      'rate_id', v_rate.id,
      'description', v_rate.description,
      'charge_type', v_rate.charge_type,
      'unit_value', v_rate.unit_value,
      'quantity', v_quantity,
      'subtotal', v_subtotal,
      'currency', v_rate.currency
    ));
  END LOOP;

  UPDATE public.granite_bls
  SET charge_status = 'calculated'
  WHERE id = p_bl_id;

  RETURN jsonb_build_object(
    'granite_bl_id', p_bl_id,
    'status', 'calculated',
    'line_count', v_line_count,
    'total', v_total,
    'charges', v_charges,
    'actor_id', v_actor
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.cancel_invoice(p_invoice_id bigint, p_reason text, p_actor uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_effect_consumer boolean := auth.role() = 'service_role'
    AND current_setting('import_effects.consumer', true) = 'vehicle_followup';
  v_consolidated text;
BEGIN
  -- O autor é quem está logado (ADR 0085, regra base 2; migration 241).
  PERFORM public._assert_actor_is_caller(p_actor);
  IF NOT v_effect_consumer
     AND (auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin()) THEN
    RAISE EXCEPTION 'Credenciais invalidas ou sem permissao de faturamento.'
      USING ERRCODE = '42501';
  END IF;

  IF NULLIF(TRIM(COALESCE(p_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Informe a justificativa para cancelar a invoice.'
      USING ERRCODE = '22023';
  END IF;

  -- Individual coberta por consolidada aberta: cancelar só a individual deixaria
  -- a consolidada cobrando o valor antigo e o B/L livre para nova fatura.
  SELECT inv.invoice_number INTO v_consolidated
  FROM public.invoices own_inv
  JOIN public.invoice_receivable_links own ON own.invoice_id = own_inv.id
  JOIN public.invoice_receivable_links l ON l.receivable_id = own.receivable_id AND l.invoice_id <> own.invoice_id
  JOIN public.invoices inv ON inv.id = l.invoice_id
  WHERE own_inv.id = p_invoice_id
    AND COALESCE(own_inv.invoice_type, 'individual') = 'individual'
    AND COALESCE(own_inv.status, 'issued') <> 'cancelled'
    AND inv.invoice_type = 'consolidated'
    AND COALESCE(inv.status, 'issued') IN ('draft', 'issued', 'partially_paid', 'overdue')
  ORDER BY inv.id DESC
  LIMIT 1;
  IF v_consolidated IS NOT NULL THEN
    RAISE EXCEPTION 'Este B/L esta na consolidada %; cancele ou reemita pela consolidada.', v_consolidated
      USING ERRCODE = '22023';
  END IF;

  RETURN public._cancel_invoice_core(p_invoice_id, p_reason, COALESCE(p_actor, auth.uid()));
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_invoice_from_bls(p_bl_ids text[], p_customer_id bigint DEFAULT NULL::bigint, p_notes text DEFAULT NULL::text, p_issue_now boolean DEFAULT true, p_actor uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- O autor é quem está logado (ADR 0085, regra base 2; migration 241).
  PERFORM public._assert_actor_is_caller(p_actor);
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Credenciais invalidas ou sem permissao de faturamento.' USING ERRCODE = '42501';
  END IF;

  RETURN public.create_invoice_from_bls_core(
    p_bl_ids,
    p_customer_id,
    p_notes,
    p_issue_now,
    COALESCE(p_actor, auth.uid()),
    'internal',
    NULL
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_invoice_from_bls_with_ledger(p_bl_ids text[], p_customer_id bigint DEFAULT NULL::bigint, p_notes text DEFAULT NULL::text, p_issue_now boolean DEFAULT true, p_actor uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_result JSONB;
  v_invoice_id BIGINT;
BEGIN
  -- O autor é quem está logado (ADR 0085, regra base 2; migration 241).
  PERFORM public._assert_actor_is_caller(p_actor);
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Credenciais invalidas ou sem permissao de faturamento.' USING ERRCODE = '42501';
  END IF;

  v_result := public.create_invoice_from_bls_core(
    p_bl_ids,
    p_customer_id,
    p_notes,
    p_issue_now,
    COALESCE(p_actor, auth.uid()),
    'internal',
    NULL
  );

  v_invoice_id := (v_result->>'invoice_id')::BIGINT;
  IF v_invoice_id IS NULL THEN
    RAISE EXCEPTION 'Falha ao criar invoice para B/Ls.' USING ERRCODE = 'P0001';
  END IF;

  PERFORM public.link_invoice_to_ledger(v_invoice_id);

  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_local_consolidated_invoice(p_customer_id bigint, p_receivable_ids bigint[], p_notes text DEFAULT NULL::text, p_actor uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor UUID;
BEGIN
  -- O autor é quem está logado (ADR 0085, regra base 2; migration 241).
  PERFORM public._assert_actor_is_caller(p_actor);
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Credenciais invalidas ou sem permissao de faturamento.' USING ERRCODE = '42501';
  END IF;

  v_actor := COALESCE(p_actor, auth.uid());

  RETURN public.create_local_consolidated_invoice_core(
    p_customer_id,
    p_receivable_ids,
    v_actor,
    'internal'
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_manual_invoice(p_customer_id bigint, p_item_name text, p_quantity numeric, p_unit_value_brl numeric, p_description text DEFAULT NULL, p_bl_id text DEFAULT NULL, p_voyage_id bigint DEFAULT NULL, p_actor uuid DEFAULT NULL, p_charge_item_id bigint DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_quote jsonb; v_result jsonb; v_invoice bigint; v_pricing_version bigint; v_total numeric(14,2);
BEGIN
  -- O autor é quem está logado (ADR 0085, regra base 2; migration 241).
  PERFORM public._assert_actor_is_caller(p_actor);
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Credenciais invalidas ou sem permissao de faturamento.' USING ERRCODE = '42501';
  END IF;
  IF p_charge_item_id IS NULL THEN
    RETURN public._create_manual_invoice_custom_122(p_customer_id, p_item_name, p_quantity, p_unit_value_brl,
      p_description, p_bl_id, p_voyage_id, p_actor);
  END IF;
  IF nullif(btrim(p_bl_id), '') IS NULL THEN
    RAISE EXCEPTION 'B/L obrigatorio para item da tabela.' USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM public.bls WHERE id = upper(btrim(p_bl_id)) AND customer_id = p_customer_id FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L nao pertence ao cliente selecionado.' USING ERRCODE = '42501';
  END IF;
  v_quote := public.quote_manual_invoice_charge(p_bl_id, p_charge_item_id);
  v_total := (v_quote->>'total_brl')::numeric;
  v_result := public._create_manual_invoice_custom_122(p_customer_id, v_quote->>'charge_item_name',
    (v_quote->>'quantity')::numeric, (v_quote->>'unit_value_brl')::numeric,
    p_description, upper(btrim(p_bl_id)), p_voyage_id, p_actor);
  v_invoice := (v_result->>'invoice_id')::bigint;
  INSERT INTO public.pricing_rule_versions(version_key, charge_table_id, charge_item_id, customer_id, customer_rate_override_id, metadata)
    VALUES ('manual_invoice:' || v_invoice, (v_quote->>'charge_table_id')::bigint, p_charge_item_id,
      p_customer_id, (v_quote->>'override_id')::bigint, v_quote) RETURNING id INTO v_pricing_version;
  UPDATE public.invoice_items SET charge_item_id = p_charge_item_id, pricing_rule_version_id = v_pricing_version,
    charge_table_id = (v_quote->>'charge_table_id')::bigint,
    snapshot_payload = v_quote, currency = v_quote->>'currency',
    unit_value_usd = (v_quote->>'effective_unit_value_usd')::numeric,
    total_value_usd = (v_quote->>'total_usd')::numeric,
    total_value_brl = v_total
    WHERE invoice_id = v_invoice;
  -- O trigger do Pix só preenche payload vazio; montar com o total final.
  UPDATE public.invoices SET total_brl = v_total, balance_brl = v_total,
    pix_payload = public.build_transshipping_pix_payload(v_total, invoice_number)
    WHERE id = v_invoice;
  UPDATE public.invoice_lifecycle_events SET payload = payload || jsonb_build_object('total_brl', v_total, 'charge_item_id', p_charge_item_id)
    WHERE invoice_id = v_invoice AND event_type = 'issued';
  RETURN v_result || jsonb_build_object('total_brl', v_total, 'balance_brl', v_total);
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_manual_bl_charge(p_charge_calculation_id bigint, p_actor uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_row RECORD;
  v_bl_id TEXT;
BEGIN
  -- O autor é quem está logado (ADR 0085, regra base 2; migration 241).
  PERFORM public._assert_actor_is_caller(p_actor);
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Somente o Administrativo exclui taxa manual do B/L.' USING ERRCODE = '42501';
  END IF;

  SELECT
    cc.id,
    cc.bl_id,
    cc.source,
    cc.charge_item_id,
    cc.quantity,
    cc.total_value_brl,
    cc.total_value_usd,
    b.financial_status AS bl_financial_status
  INTO v_row
  FROM public.charge_calculations AS cc
  LEFT JOIN public.bls AS b ON b.id = cc.bl_id
  WHERE cc.id = p_charge_calculation_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Linha de calculo % nao encontrada', p_charge_calculation_id USING ERRCODE = 'P0002';
  END IF;

  IF COALESCE(v_row.source, '') <> 'manual' THEN
    RAISE EXCEPTION 'Somente linhas manuais podem ser removidas' USING ERRCODE = '22023';
  END IF;

  IF COALESCE(v_row.bl_financial_status, 'open') IN ('invoiced', 'partially_paid', 'paid') THEN
    RAISE EXCEPTION 'B/L % ja foi faturado; nao e permitido remover taxa manual.', v_row.bl_id
      USING ERRCODE = '22023';
  END IF;

  v_bl_id := v_row.bl_id;

  DELETE FROM public.charge_calculations
  WHERE id = p_charge_calculation_id;

  INSERT INTO public.audit_logs (
    entity_type,
    entity_id,
    field_name,
    old_value,
    new_value,
    changed_by,
    changed_at,
    justification
  )
  VALUES (
    'charge_calculation',
    p_charge_calculation_id::TEXT,
    'manual_delete',
    CONCAT('charge_item_id=', COALESCE(v_row.charge_item_id::TEXT, '-'), ' | qty=', COALESCE(v_row.quantity::TEXT, '0')),
    NULL,
    auth.uid(),
    NOW(),
    'Remocao manual de other charge'
  );

  RETURN jsonb_build_object(
    'deleted', true,
    'id', p_charge_calculation_id,
    'bl_id', v_bl_id
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.mark_bl_ready_for_billing(p_bl_id text, p_actor uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bl record;
  v_pending_count integer := 0;
  v_table_count integer := 0;
  v_invoiceable_count integer := 0;
  v_review_reasons text[];
  v_terminal_pendencies text[];
BEGIN
  -- O autor é quem está logado (ADR 0085, regra base 2; migration 241).
  PERFORM public._assert_actor_is_caller(p_actor);
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Acesso negado para marcar B/L como pronto para faturar.' USING ERRCODE = '42501';
  END IF;

  SELECT id, charge_status, pod, cargo_mode, customer_id, customer_reconciliation_status
  INTO v_bl FROM public.bls WHERE id = p_bl_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L "%" nao encontrado.', p_bl_id USING ERRCODE = 'P0002';
  END IF;

  -- Gate 1: Assertiva universal de CE Mercante (migration 047)
  PERFORM public.assert_bl_ce_mercante(p_bl_id);

  -- Gate 2: Vinculo de cliente (migration 047)
  IF v_bl.customer_id IS NULL THEN
    RAISE EXCEPTION 'B/L % nao possui cliente vinculado. Vincule um cliente antes de marcar como pronto para faturar.', p_bl_id USING ERRCODE = 'P0003';
  END IF;

  -- Gate 3: Status de reconciliacao (migration 047)
  IF COALESCE(v_bl.customer_reconciliation_status, 'missing_customer') NOT IN ('matched_document', 'reconciled') THEN
    RAISE EXCEPTION 'B/L exige reconciliacao manual antes do faturamento.' USING ERRCODE = '22023';
  END IF;

  -- Gate 4: Pendencias no gate de revisao (migration 047)
  v_review_reasons := public.compute_bl_review_pendencies(p_bl_id);
  IF COALESCE(cardinality(v_review_reasons), 0) > 0 THEN
    RAISE EXCEPTION 'B/L possui pendencias no gate de revisao: %', array_to_string(v_review_reasons, ', ') USING ERRCODE = '22023';
  END IF;

  -- Gate 5: Linhas com review_required (migration 047)
  SELECT COUNT(*) INTO v_pending_count FROM public.charge_calculations WHERE bl_id = p_bl_id AND status = 'review_required';
  IF v_pending_count > 0 THEN
    RAISE EXCEPTION 'Ainda existem linhas com pendencia de revisao' USING ERRCODE = '22023';
  END IF;

  -- Gate 6: Terminal de descarga (ADR 0068 / migration 055)
  v_terminal_pendencies := public.check_bl_terminal_pendencies(p_bl_id);
  IF array_length(v_terminal_pendencies, 1) > 0 THEN
    RAISE EXCEPTION 'B/L com pendencia de terminal: %', array_to_string(v_terminal_pendencies, ', ')
      USING ERRCODE = '22023';
  END IF;

  -- Gate 7: Linhas faturaveis (migration 047)
  SELECT COUNT(*) INTO v_invoiceable_count
  FROM public.charge_calculations
  WHERE bl_id = p_bl_id
    AND (COALESCE(total_value_brl, 0) > 0 OR COALESCE(total_value_usd, 0) > 0)
    AND COALESCE(status, 'calculated') IN ('calculated', 'reviewed', 'ready_for_billing');
  
  IF v_invoiceable_count = 0 THEN
    RAISE EXCEPTION 'B/L sem linhas faturaveis.' USING ERRCODE = '22023';
  END IF;

  -- Gate 8: Resolucao de tabelas de taxas compartilhada (ADR 0069)
  SELECT COUNT(*) INTO v_table_count
  FROM public.resolve_bl_local_charge_table_ids(p_bl_id);

  IF (v_bl.cargo_mode = 'misto' AND v_table_count < 2) OR (v_bl.cargo_mode <> 'misto' AND v_table_count = 0) THEN
    RAISE EXCEPTION
      'Tabela de cobranca incompleta ou inativa para POD "%" (modo: %). Configure em /taxas-locais/tabelas antes de prosseguir.',
      v_bl.pod, v_bl.cargo_mode USING ERRCODE = 'P0004';
  END IF;

  UPDATE public.charge_calculations 
  SET status = 'ready_for_billing' 
  WHERE bl_id = p_bl_id AND status IN ('calculated', 'reviewed');

  UPDATE public.bls 
  SET charge_status = 'ready_for_billing', billing_hold_reason = NULL 
  WHERE id = p_bl_id;

  PERFORM public.sync_local_charge_receivable(p_bl_id);

  INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification)
  VALUES ('bl', p_bl_id, 'charge_status', COALESCE(v_bl.charge_status, 'null'), 'ready_for_billing', auth.uid(), NOW(), 'Marcado como pronto para faturar no modulo de Taxas Locais');

  RETURN jsonb_build_object('bl_id', p_bl_id, 'status', 'ready_for_billing', 'changed', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.obsolete_consolidated_invoice(p_invoice_id bigint, p_reason text DEFAULT NULL::text, p_actor uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_invoice RECORD;
  v_actor UUID;
  v_reason TEXT;
BEGIN
  -- O autor é quem está logado (ADR 0085, regra base 2; migration 241).
  PERFORM public._assert_actor_is_caller(p_actor);
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Credenciais invalidas ou sem permissao de faturamento.' USING ERRCODE = '42501';
  END IF;

  v_actor := COALESCE(p_actor, auth.uid());
  v_reason := COALESCE(NULLIF(TRIM(COALESCE(p_reason, '')), ''), 'Marcada obsoleta manualmente');

  SELECT * INTO v_invoice FROM public.invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice % nao encontrada.', p_invoice_id USING ERRCODE = 'P0002';
  END IF;

  IF COALESCE(v_invoice.invoice_type, 'individual') <> 'consolidated' THEN
    RAISE EXCEPTION 'Apenas consolidadas podem ser marcadas obsoletas por esta rotina.' USING ERRCODE = '22023';
  END IF;

  IF COALESCE(v_invoice.status, 'issued') NOT IN ('issued', 'partially_paid', 'overdue') THEN
    RAISE EXCEPTION 'Invoice % nao esta em estado obsoletavel (status=%).', p_invoice_id, v_invoice.status
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.invoices SET status = 'obsolete', obsolete_reason = v_reason WHERE id = p_invoice_id;

  UPDATE public.invoice_receivable_links SET status = 'obsolete'
  WHERE invoice_id = p_invoice_id AND status = 'active';

  INSERT INTO public.invoice_lifecycle_events (invoice_id, event_type, actor, payload)
  VALUES (p_invoice_id, 'obsolete', v_actor, jsonb_build_object('reason', v_reason));

  INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification)
  VALUES ('invoice', p_invoice_id::TEXT, 'obsolete_consolidated', COALESCE(v_invoice.status, 'issued'), 'obsolete', auth.uid(), now(), v_reason);

  RETURN jsonb_build_object('invoice_id', p_invoice_id, 'status', 'obsolete', 'reason', v_reason);
END;
$function$;

CREATE OR REPLACE FUNCTION public.register_invoice_payment(p_invoice_id bigint, p_amount_brl numeric, p_payment_method text DEFAULT 'pix'::text, p_paid_at timestamp with time zone DEFAULT now(), p_notes text DEFAULT NULL::text, p_actor uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_invoice RECORD;
  v_actor UUID;
  v_total_paid NUMERIC(14,2);
  v_balance NUMERIC(14,2);
  v_remaining NUMERIC(14,2);
  v_next_status TEXT;
BEGIN
  -- O autor é quem está logado (ADR 0085, regra base 2; migration 241).
  PERFORM public._assert_actor_is_caller(p_actor);
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Credenciais invalidas ou sem permissao de faturamento.' USING ERRCODE = '42501';
  END IF;

  v_actor := COALESCE(p_actor, auth.uid());

  IF COALESCE(p_amount_brl, 0) <= 0 THEN
    INSERT INTO public.audit_logs (
      entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification
    )
    VALUES (
      'system_event',
      'billing',
      'invoice_payment_invalid',
      NULL,
      CONCAT('invoice=', p_invoice_id, ' | amount=', COALESCE(p_amount_brl, 0)),
      auth.uid(),
      now(),
      'Valor de pagamento menor ou igual a zero'
    );
    RAISE EXCEPTION 'Valor de pagamento deve ser maior que zero.' USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO v_invoice
  FROM public.invoices
  WHERE id = p_invoice_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice % nao encontrada.', p_invoice_id USING ERRCODE = 'P0002';
  END IF;

  IF COALESCE(v_invoice.status, 'issued') = 'cancelled' THEN
    INSERT INTO public.audit_logs (
      entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification
    )
    VALUES (
      'system_event',
      'billing',
      'invoice_payment_invalid',
      NULL,
      CONCAT('invoice=', p_invoice_id, ' cancelada'),
      auth.uid(),
      now(),
      'Tentativa de pagamento em invoice cancelada'
    );
    RAISE EXCEPTION 'Invoice cancelada nao aceita pagamento.' USING ERRCODE = '22023';
  END IF;

  IF COALESCE(v_invoice.status, 'issued') = 'paid' THEN
    INSERT INTO public.audit_logs (
      entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification
    )
    VALUES (
      'system_event',
      'billing',
      'invoice_payment_invalid',
      NULL,
      CONCAT('invoice=', p_invoice_id, ' ja paga'),
      auth.uid(),
      now(),
      'Tentativa de pagamento em invoice ja quitada'
    );
    RAISE EXCEPTION 'Invoice ja esta paga.' USING ERRCODE = '22023';
  END IF;

  v_remaining := GREATEST(COALESCE(v_invoice.balance_brl, COALESCE(v_invoice.total_brl, 0)), 0);
  IF p_amount_brl > v_remaining THEN
    INSERT INTO public.audit_logs (
      entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification
    )
    VALUES (
      'system_event',
      'billing',
      'invoice_payment_invalid',
      NULL,
      CONCAT('invoice=', p_invoice_id, ' | amount=', p_amount_brl, ' | remaining=', v_remaining),
      auth.uid(),
      now(),
      'Tentativa de pagamento acima do saldo da invoice'
    );
    RAISE EXCEPTION 'Pagamento acima do saldo em aberto da invoice.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.payments (
    invoice_id,
    amount_brl,
    payment_method,
    paid_at,
    registered_by,
    notes
  )
  VALUES (
    p_invoice_id,
    p_amount_brl,
    COALESCE(NULLIF(TRIM(COALESCE(p_payment_method, '')), ''), 'pix'),
    COALESCE(p_paid_at, now()),
    v_actor,
    NULLIF(TRIM(COALESCE(p_notes, '')), '')
  );

  SELECT COALESCE(SUM(amount_brl), 0)
  INTO v_total_paid
  FROM public.payments
  WHERE invoice_id = p_invoice_id;

  v_balance := GREATEST(COALESCE(v_invoice.total_brl, 0) - v_total_paid, 0);

  IF v_balance = 0 THEN
    v_next_status := 'paid';
  ELSIF v_total_paid > 0 THEN
    v_next_status := 'partially_paid';
  ELSE
    v_next_status := 'issued';
  END IF;

  UPDATE public.invoices
  SET
    total_paid_brl = v_total_paid,
    balance_brl = v_balance,
    status = v_next_status
  WHERE id = p_invoice_id;

  IF v_next_status = 'paid' THEN
    UPDATE public.bls AS b
    SET financial_status = CASE
      WHEN EXISTS (
        SELECT 1
        FROM public.invoice_bls AS ib2
        JOIN public.invoices AS inv2 ON inv2.id = ib2.invoice_id
        WHERE ib2.bl_id = b.id
          AND inv2.id <> p_invoice_id
          AND COALESCE(inv2.status, 'issued') IN ('draft', 'issued', 'partially_paid', 'overdue')
      ) THEN 'invoiced'
      ELSE 'paid'
    END
    WHERE b.id IN (
      SELECT ib.bl_id
      FROM public.invoice_bls AS ib
      WHERE ib.invoice_id = p_invoice_id
    );
  ELSE
    UPDATE public.bls
    SET financial_status = 'invoiced'
    WHERE id IN (
      SELECT ib.bl_id
      FROM public.invoice_bls AS ib
      WHERE ib.invoice_id = p_invoice_id
    );
  END IF;

  INSERT INTO public.audit_logs (
    entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification
  )
  VALUES (
    'invoice',
    p_invoice_id::TEXT,
    'register_payment',
    COALESCE(v_invoice.total_paid_brl::TEXT, '0'),
    v_total_paid::TEXT,
    auth.uid(),
    now(),
    'Registro de pagamento'
  );

  RETURN jsonb_build_object(
    'invoice_id', p_invoice_id,
    'status', v_next_status,
    'total_paid_brl', v_total_paid,
    'balance_brl', v_balance
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.register_ledger_invoice_payment(p_invoice_id bigint, p_amount_brl numeric, p_method text DEFAULT 'pix'::text, p_paid_at timestamp with time zone DEFAULT now(), p_pix_txid text DEFAULT NULL, p_source text DEFAULT 'manual'::text, p_notes text DEFAULT NULL, p_actor uuid DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_bl_id text;
BEGIN
  -- O autor é quem está logado (ADR 0085, regra base 2; migration 241).
  PERFORM public._assert_actor_is_caller(p_actor);
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

CREATE OR REPLACE FUNCTION public.register_ledger_invoice_payment(p_invoice_id bigint, p_amount_brl numeric, p_method text, p_paid_at timestamp with time zone, p_pix_txid text, p_source text, p_notes text, p_actor uuid, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bl_id text;
  v_request_id uuid := COALESCE(p_request_id, gen_random_uuid());
  v_hash text := md5(jsonb_build_object('invoice_id', p_invoice_id, 'amount_brl', round(p_amount_brl::numeric, 2), 'method', p_method, 'paid_at', p_paid_at, 'pix_txid', p_pix_txid, 'source', p_source, 'notes', p_notes, 'actor', p_actor)::text);
  v_existing public.ledger_payment_requests%ROWTYPE;
  v_result jsonb;
BEGIN
  -- O autor é quem está logado (ADR 0085, regra base 2; migration 241).
  PERFORM public._assert_actor_is_caller(p_actor);
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin() THEN
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

  INSERT INTO public.ledger_payment_requests(request_id, payload_hash, created_by)
  VALUES (v_request_id, v_hash, COALESCE(p_actor, auth.uid()))
  ON CONFLICT (request_id) DO NOTHING;
  SELECT * INTO v_existing FROM public.ledger_payment_requests WHERE request_id = v_request_id FOR UPDATE;
  IF v_existing.payload_hash IS DISTINCT FROM v_hash THEN
    RAISE EXCEPTION 'Request de pagamento % já foi usado com outro payload.', v_request_id USING ERRCODE = '22023';
  END IF;
  IF v_existing.result IS NOT NULL THEN RETURN v_existing.result; END IF;

  PERFORM public.assert_ledger_invoice_payment_allocation(p_invoice_id, p_amount_brl);
  v_result := public.register_ledger_invoice_payment_legacy_066(
    p_invoice_id, p_amount_brl, p_method, p_paid_at, p_pix_txid, p_source, p_notes, p_actor
  );
  UPDATE public.ledger_payment_requests SET result = v_result WHERE request_id = v_request_id;
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.reverse_demurrage_payment(p_invoice_id bigint, p_reason text DEFAULT NULL::text, p_actor uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor UUID;
  v_old_status TEXT;
BEGIN
  -- O autor é quem está logado (ADR 0085, regra base 2; migration 241).
  PERFORM public._assert_actor_is_caller(p_actor);
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Credenciais invalidas ou sem permissao.' USING ERRCODE = '42501';
  END IF;

  IF NULLIF(TRIM(COALESCE(p_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Informe a justificativa para cancelar a baixa.' USING ERRCODE = '22023';
  END IF;

  v_actor := COALESCE(p_actor, auth.uid());

  SELECT status INTO v_old_status
  FROM public.demurrage_invoices
  WHERE id = p_invoice_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Demurrage invoice % nao encontrada.', p_invoice_id USING ERRCODE = 'P0002';
  END IF;

  IF COALESCE(v_old_status, '') <> 'paid' THEN
    RAISE EXCEPTION 'Demurrage invoice % nao esta paga (status=%).', p_invoice_id, COALESCE(v_old_status, '?')
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.demurrage_invoices
  SET
    status = 'issued',
    paid_at = NULL,
    pix_txid = NULL,
    conciliated_by_extract = false
  WHERE id = p_invoice_id;

  INSERT INTO public.audit_logs (
    entity_type,
    entity_id,
    field_name,
    old_value,
    new_value,
    changed_by,
    changed_at,
    justification
  )
  VALUES (
    'demurrage_invoice',
    p_invoice_id::TEXT,
    'payment_reversed',
    v_old_status,
    'issued',
    v_actor,
    now(),
    TRIM(p_reason)
  );

  RETURN jsonb_build_object(
    'invoice_id', p_invoice_id,
    'new_status', 'issued'
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.reverse_invoice_payment(p_payment_id bigint, p_reason text DEFAULT NULL::text, p_actor uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_invoice_id bigint; bl_id text; refund record; result jsonb;
BEGIN
  -- O autor é quem está logado (ADR 0085, regra base 2; migration 241).
  PERFORM public._assert_actor_is_caller(p_actor);
 IF auth.uid() IS NULL OR NOT public.is_admin() OR p_actor IS NOT NULL AND p_actor<>auth.uid() THEN RAISE EXCEPTION 'Sem permissão para cancelar baixa.' USING ERRCODE='42501'; END IF;
 IF length(btrim(coalesce(p_reason,'')))=0 THEN RAISE EXCEPTION 'Informe o motivo do cancelamento da baixa.' USING ERRCODE='22023'; END IF;
 SELECT p.invoice_id INTO v_invoice_id FROM public.payments p WHERE p.id=p_payment_id;
 FOR bl_id IN SELECT l.bl_id FROM public.invoice_receivable_links l WHERE l.invoice_id=v_invoice_id
 UNION SELECT ib.bl_id FROM public.invoice_bls ib WHERE ib.invoice_id=v_invoice_id ORDER BY 1 LOOP
   PERFORM pg_advisory_xact_lock(hashtextextended('bl:'||bl_id,0)); END LOOP;
 PERFORM 1 FROM public.invoices i WHERE i.id=v_invoice_id FOR UPDATE;
 PERFORM 1 FROM public.payments WHERE id=p_payment_id FOR UPDATE;
 -- Só excedente automático que nunca foi devolvido pode acompanhar baixa falsa.
 -- Restituição por correção/COD/autorizações independentes permanece protegida.
 FOR refund IN SELECT * FROM public.invoice_refunds WHERE payment_id=p_payment_id AND status='pending'
   AND origin='existing' AND cod_adjustment_id IS NULL AND correction_receivable_id IS NULL FOR UPDATE LOOP
   UPDATE public.invoice_refunds SET status='cancelled',notes=concat_ws(E'\n',notes,'Baixa sem recebimento cancelada: '||btrim(p_reason)) WHERE id=refund.id;
   INSERT INTO public.audit_logs(entity_type,entity_id,field_name,old_value,new_value,changed_by,justification)
    VALUES('invoice_refund',refund.id::text,'pending_excess_cancelled',to_jsonb(refund)::text,'cancelled',auth.uid(),btrim(p_reason));
 END LOOP;
 result := public.reverse_invoice_payment_legacy_134(p_payment_id,p_reason,auth.uid());
 -- Avulsa não tem recebível de B/L; sua dívida é o total emitido menos baixas.
 UPDATE public.invoices SET balance_brl=greatest(total_brl-total_paid_brl,0),
   status=CASE WHEN total_paid_brl=0 THEN 'issued' WHEN total_brl-total_paid_brl<=0 THEN 'paid' ELSE 'partially_paid' END
 WHERE id=v_invoice_id AND invoice_type='manual' AND status<>'cancelled';
 RETURN result || jsonb_build_object('new_status',(SELECT status FROM public.invoices WHERE id=v_invoice_id));
END $function$;

CREATE OR REPLACE FUNCTION public.settle_cod_adjustment(p_adjustment_id bigint, p_actor uuid DEFAULT NULL::uuid, p_resulting_document_id bigint DEFAULT NULL::bigint, p_resulting_document_type text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_adjustment record;
BEGIN
  -- O autor é quem está logado (ADR 0085, regra base 2; migration 241).
  PERFORM public._assert_actor_is_caller(p_actor);
  IF auth.uid() IS NULL OR NOT public.is_financeiro_user() OR (p_actor IS NOT NULL AND p_actor <> auth.uid()) THEN
    RAISE EXCEPTION 'Sem permissao para liquidar ajuste de COD.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_adjustment FROM public.cod_adjustments WHERE id = p_adjustment_id FOR UPDATE;
  IF v_adjustment.applied_correction_id IS NOT NULL AND v_adjustment.status = 'settled' THEN
    RETURN jsonb_build_object('adjustment_id', p_adjustment_id, 'status', 'settled', 'offset_amount_brl', 0,
      'correction_id', v_adjustment.applied_correction_id, 'refund_id', CASE WHEN v_adjustment.resulting_document_type = 'refund' THEN v_adjustment.resulting_document_id END);
  END IF;
  IF v_adjustment.status = 'pending' AND v_adjustment.action IN ('refund_overpayment', 'offset_open_balance')
    AND EXISTS (SELECT 1 FROM public.bl_receivables r JOIN public.invoice_corrections c ON c.receivable_id = r.id
      WHERE r.bl_id = v_adjustment.bl_id AND r.source = 'local_charges'
      AND c.created_at >= v_adjustment.created_at
      AND c.corrected_total_brl <= v_adjustment.new_destination_value_brl) THEN
    RAISE EXCEPTION 'A correcao do B/L ja tratou este valor. Revise o ajuste de COD e a restituicao existente.' USING ERRCODE = '22023';
  END IF;
  RETURN public.settle_cod_adjustment_legacy_130(p_adjustment_id, p_actor, p_resulting_document_id, p_resulting_document_type);
END;
$function$;

CREATE OR REPLACE FUNCTION public.settle_invoice_refund(p_refund_id bigint, p_actor uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- O autor é quem está logado (ADR 0085, regra base 2; migration 241).
  PERFORM public._assert_actor_is_caller(p_actor);
  IF auth.uid() IS NULL OR NOT public.is_financeiro_user() THEN
    RAISE EXCEPTION 'Sem permissão para confirmar restituição.' USING ERRCODE='42501';
  END IF;
  RAISE EXCEPTION 'Use a confirmação de devolução com referência bancária, favorecido e data.' USING ERRCODE='22023';
END $function$;

CREATE OR REPLACE FUNCTION public.update_manual_bl_charge(p_charge_calculation_id bigint, p_quantity numeric, p_notes text DEFAULT NULL::text, p_actor uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_row RECORD;
  v_qty NUMERIC(12,6);
  v_total_brl NUMERIC(14,2);
  v_total_usd NUMERIC(14,2);
BEGIN
  -- O autor é quem está logado (ADR 0085, regra base 2; migration 241).
  PERFORM public._assert_actor_is_caller(p_actor);
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa' USING ERRCODE = '42501';
  END IF;

  SELECT
    cc.id,
    cc.bl_id,
    cc.source,
    cc.quantity,
    cc.unit_value_brl,
    cc.unit_value_usd,
    cc.total_value_brl,
    cc.total_value_usd,
    cc.notes,
    b.financial_status AS bl_financial_status
  INTO v_row
  FROM public.charge_calculations AS cc
  LEFT JOIN public.bls AS b ON b.id = cc.bl_id
  WHERE cc.id = p_charge_calculation_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Linha de calculo % nao encontrada', p_charge_calculation_id USING ERRCODE = 'P0002';
  END IF;

  IF COALESCE(v_row.source, '') <> 'manual' THEN
    RAISE EXCEPTION 'Somente linhas manuais podem ser editadas' USING ERRCODE = '22023';
  END IF;

  IF COALESCE(v_row.bl_financial_status, 'open') IN ('invoiced', 'partially_paid', 'paid') THEN
    RAISE EXCEPTION 'B/L % ja foi faturado; nao e permitido editar taxa manual.', v_row.bl_id
      USING ERRCODE = '22023';
  END IF;

  v_qty := COALESCE(p_quantity, v_row.quantity, 1);
  IF v_qty <= 0 THEN
    RAISE EXCEPTION 'Quantidade deve ser maior que zero' USING ERRCODE = '22023';
  END IF;

  v_total_brl := CASE WHEN v_row.unit_value_brl IS NULL THEN NULL ELSE ROUND(v_qty * v_row.unit_value_brl, 2) END;
  v_total_usd := CASE WHEN v_row.unit_value_usd IS NULL THEN NULL ELSE ROUND(v_qty * v_row.unit_value_usd, 2) END;

  UPDATE public.charge_calculations
  SET
    quantity = v_qty,
    total_value_brl = v_total_brl,
    total_value_usd = v_total_usd,
    notes = NULLIF(TRIM(COALESCE(p_notes, '')), ''),
    calculated_at = NOW()
  WHERE id = p_charge_calculation_id;

  INSERT INTO public.audit_logs (
    entity_type,
    entity_id,
    field_name,
    old_value,
    new_value,
    changed_by,
    changed_at,
    justification
  )
  VALUES (
    'charge_calculation',
    p_charge_calculation_id::TEXT,
    'manual_update',
    CONCAT('qty=', COALESCE(v_row.quantity::TEXT, '0'), ' | note=', COALESCE(v_row.notes, '')),
    CONCAT('qty=', v_qty, ' | note=', COALESCE(NULLIF(TRIM(COALESCE(p_notes, '')), ''), '')),
    auth.uid(),
    NOW(),
    COALESCE(NULLIF(TRIM(COALESCE(p_notes, '')), ''), 'Atualizacao manual de other charge')
  );

  RETURN jsonb_build_object(
    'id', p_charge_calculation_id,
    'bl_id', v_row.bl_id,
    'quantity', v_qty,
    'total_value_brl', v_total_brl,
    'total_value_usd', v_total_usd
  );
END;
$function$;
