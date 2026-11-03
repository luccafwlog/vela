-- 571: recusas restantes com acento, situação financeira em português e a
-- dispensa da Demurrage no assunto Container do Histórico do B/L.
--
-- Pendências da revisão do Manual do Operador de 2026-11-03 (PR #1087):
--   1. Recusas sem acento que ficaram fora da 567, agora em TODAS as funções
--      vigentes que as levam (não sobra variante sem acento):
--        B/L % cancelado e somente leitura; nao e permitido lancar taxa manual.
--        B/L % nao encontrado          -> B/L % não encontrado
--        Item manual [%] nao elegivel… -> Item manual [%] não elegível…
--        Linha de calculo % nao encontrada -> Linha de cálculo % não encontrada
--        Payload de carga solta invalido.  -> … inválido.
--   2. "(status financeiro=invoiced)" mostrava o código em inglês. As cinco
--      recusas "B/L … já foi faturado (status financeiro=%) …" passam a
--      "(situação financeira: Faturado)", pelo rótulo da tela
--      (FINANCIAL_STATUS_LABELS em src/lib/statusLabels.ts), via a função nova
--      _financial_status_label.
--   3. bl_timeline (470): a linha `demurrage_dispensa` (dispensa da cobrança de
--      Demurrage) passa da família 'edicao' para 'container', o assunto que o
--      Histórico do B/L mostra.
--
-- Cada função é a definição vigente (lida com pg_get_functiondef no Postgres
-- local com toda a cadeia aplicada) com só esses trechos trocados; lógica,
-- ERRCODE, assinatura, SECURITY DEFINER, search_path e grants ficam iguais.
-- Nenhuma função compara esses textos por SQLERRM. Fora: "Transbordo do B/L %
-- nao encontrado" e "Lote de datas invalido." (outra rodada).
--
-- Só cria e redefine funções; não grava nem reescreve linhas.
-- Rollback: desfazer só as trocas de texto (e a linha da família em
-- bl_timeline) em cada função, e apagar _financial_status_label.

CREATE OR REPLACE FUNCTION public._financial_status_label(p_status text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE p_status
    WHEN 'pending' THEN 'Pendente'
    WHEN 'invoiced' THEN 'Faturado'
    WHEN 'partially_paid' THEN 'Parcialmente pago'
    WHEN 'paid' THEN 'Pago'
    WHEN 'cancelled' THEN 'Cancelado'
    ELSE COALESCE(p_status, 'sem situação')
  END
$function$;

REVOKE ALL ON FUNCTION public._financial_status_label(text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public._add_manual_bl_charge_impl_106(p_bl_id text, p_charge_item_id bigint, p_quantity numeric DEFAULT 1, p_notes text DEFAULT NULL::text, p_actor uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bl record;
  v_item record;
  v_actor uuid;
  v_qty numeric(12,6);
  v_unit_brl numeric(12,2);
  v_unit_usd numeric(12,2);
  v_total_brl numeric(14,2);
  v_total_usd numeric(14,2);
  v_key text;
  v_calc_id bigint;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuário sem permissão ativa' USING ERRCODE = '42501';
  END IF;
  v_actor := COALESCE(p_actor, auth.uid());

  SELECT b.id, b.customer_id, COALESCE(b.cargo_mode, 'container') AS cargo_mode,
    b.pod, b.charge_status, b.financial_status, b.cancelled_at,
    public.bl_local_charge_reference_date(b.id) AS reference_date
  INTO v_bl
  FROM public.bls AS b
  WHERE b.id = upper(btrim(p_bl_id));
  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L % não encontrado', p_bl_id USING ERRCODE = 'P0002';
  END IF;

  IF v_bl.cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION 'B/L % cancelado e somente leitura; não é permitido lançar taxa manual.', p_bl_id USING ERRCODE = '22023';
  END IF;

  IF COALESCE(v_bl.financial_status, 'open') IN ('invoiced', 'partially_paid', 'paid') THEN
    RAISE EXCEPTION 'B/L % já foi faturado (situação financeira: %); não é permitido lançar taxa manual.',
      p_bl_id, public._financial_status_label(v_bl.financial_status) USING ERRCODE = '22023';
  END IF;

  SELECT cti.id, cti.name, COALESCE(cti.currency, 'BRL') AS currency,
    cti.unit_value_brl, cti.unit_value_usd, cti.value_brl,
    ct.id AS charge_table_id, ct.name AS charge_table_name, ct.cargo_mode, ct.pod,
    cro.override_value,
    fi.charge_item_id AS frozen_item, fi.unit_value_brl AS frozen_brl,
    fi.unit_value_usd AS frozen_usd, fi.override_value AS frozen_override
  INTO v_item
  FROM public.charge_table_items AS cti
  JOIN public.charge_tables AS ct ON ct.id = cti.charge_table_id
    AND ct.id IN (
      SELECT resolved.table_id
      FROM public.resolve_bl_local_charge_table_ids(v_bl.id, v_bl.reference_date) AS resolved
    )
    AND (
      public.normalize_port_code(ct.pod) = public.normalize_port_code(v_bl.pod)
      OR upper(trim(coalesce(ct.pod, ''))) = 'ANY'
    )
  LEFT JOIN LATERAL (
    SELECT cro.override_value
    FROM public.customer_rate_overrides AS cro
    WHERE cro.active
          AND cro.customer_id = v_bl.customer_id
      AND cro.charge_item_id = cti.id
      AND (cro.valid_from IS NULL OR cro.valid_from <= v_bl.reference_date)
      AND (cro.valid_to IS NULL OR cro.valid_to >= v_bl.reference_date)
    ORDER BY cro.created_at DESC
    LIMIT 1
  ) AS cro ON true
  LEFT JOIN public.bl_price_freeze_items AS fi ON fi.bl_id = v_bl.id AND fi.charge_item_id = cti.id
  WHERE cti.id = p_charge_item_id
    AND COALESCE(cti.active, true) = true
    AND COALESCE(cti.manual_only, false) = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item manual % não elegível para este B/L', p_charge_item_id USING ERRCODE = '22023';
  END IF;

  v_qty := COALESCE(p_quantity, 1);
  IF v_qty <= 0 THEN
    RAISE EXCEPTION 'Quantidade deve ser maior que zero' USING ERRCODE = '22023';
  END IF;
  IF v_item.currency = 'USD' THEN
    v_unit_brl := NULL;
    v_unit_usd := CASE WHEN v_item.frozen_item IS NOT NULL THEN COALESCE(v_item.frozen_override, v_item.frozen_usd, 0)
      ELSE COALESCE(v_item.override_value, v_item.unit_value_usd, 0) END;
    v_total_brl := NULL;
    v_total_usd := round(v_qty * COALESCE(v_unit_usd, 0), 2);
  ELSE
    v_unit_brl := CASE WHEN v_item.frozen_item IS NOT NULL THEN COALESCE(v_item.frozen_override, v_item.frozen_brl, v_item.value_brl, 0)
      ELSE COALESCE(v_item.override_value, v_item.unit_value_brl, v_item.value_brl, 0) END;
    v_unit_usd := NULL;
    v_total_brl := round(v_qty * COALESCE(v_unit_brl, 0), 2);
    v_total_usd := NULL;
  END IF;

  v_key := concat('manual:item:', p_charge_item_id, ':',
    extract(epoch FROM clock_timestamp())::bigint, ':', floor(random() * 100000)::int);

  INSERT INTO public.charge_calculations (
    bl_id, charge_table_id, charge_item_id, quantity, unit_value_brl, unit_value_usd,
    total_value_brl, total_value_usd, override_applied, source, status,
    calculation_key, notes, manual_reason, created_by, calculated_at
  ) VALUES (
    v_bl.id, v_item.charge_table_id, p_charge_item_id, v_qty, v_unit_brl, v_unit_usd,
    v_total_brl, v_total_usd, (CASE WHEN v_item.frozen_item IS NOT NULL THEN v_item.frozen_override ELSE v_item.override_value END) IS NOT NULL, 'manual', 'reviewed',
    v_key, NULLIF(trim(coalesce(p_notes, '')), ''), 'other_charge_manual', v_actor, now()
  ) RETURNING id INTO v_calc_id;

  UPDATE public.bls
  SET charge_status = CASE WHEN charge_status IN ('not_calculated', 'exempt') THEN 'reviewed' ELSE charge_status END,
      charges_calculated_at = COALESCE(charges_calculated_at, now()),
      charges_reviewed_at = CASE WHEN charge_status IN ('not_calculated', 'exempt') THEN now() ELSE charges_reviewed_at END
  WHERE id = v_bl.id;

  INSERT INTO public.audit_logs (
    entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification
  ) VALUES (
    'charge_calculation', v_calc_id::text, 'manual_insert', NULL,
    concat(v_item.name, ' | qty=', v_qty, ' | total=', coalesce(v_total_brl::text, v_total_usd::text)),
    auth.uid(), now(), coalesce(nullif(trim(coalesce(p_notes, '')), ''), 'Lancamento manual de other charge')
  );

  RETURN jsonb_build_object(
    'id', v_calc_id, 'bl_id', v_bl.id, 'status', 'reviewed', 'currency', v_item.currency,
    'quantity', v_qty, 'unit_value_brl', v_unit_brl, 'unit_value_usd', v_unit_usd,
    'total_value_brl', v_total_brl, 'total_value_usd', v_total_usd
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_bl_transshipment(p_bl_id text, p_omission_id bigint, p_justification text, p_changed_by uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_was TEXT;
  v_original_pod TEXT;
  v_old_pod TEXT;
  v_customer BIGINT;
  v_justification TEXT := NULLIF(btrim(COALESCE(p_justification, '')), '');
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR p_changed_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Usuário sem permissão ativa.' USING ERRCODE = '42501';
  END IF;

  SELECT t.disposition, o.omitted_pod INTO v_was, v_original_pod
  FROM public.bl_transshipments AS t
  JOIN public.voyage_omissions AS o ON o.id = t.omission_id
  WHERE t.bl_id = p_bl_id AND t.omission_id = p_omission_id
  FOR UPDATE OF o;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transbordo do B/L % nao encontrado', p_bl_id USING ERRCODE = 'P0002';
  END IF;

  SELECT pod, customer_id INTO v_old_pod, v_customer
  FROM public.bls WHERE id = p_bl_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L % não encontrado', p_bl_id USING ERRCODE = 'P0002';
  END IF;

  IF v_was = 'cod' AND v_justification IS NULL THEN
    RAISE EXCEPTION 'Reverter COD exige justificativa.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.bl_transshipments
  SET disposition = 'transshipment', updated_at = now()
  WHERE bl_id = p_bl_id AND omission_id = p_omission_id;

  IF v_was = 'cod' THEN
    UPDATE public.bls SET pod = v_original_pod, updated_at = now() WHERE id = p_bl_id;

    IF to_regprocedure('public.apply_cod_financial_effect(text,bigint,text)') IS NOT NULL THEN
      PERFORM public.apply_cod_financial_effect(p_bl_id, p_omission_id, v_old_pod);
    END IF;

    INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
    VALUES ('bls', p_bl_id, 'pod', v_old_pod, v_original_pod, p_changed_by,
      'Reversao de COD para transbordo: ' || v_justification);

    IF v_customer IS NOT NULL THEN
      INSERT INTO public.portal_notifications(customer_id, bl_id, type, title, message, link)
      VALUES (
        v_customer, p_bl_id, 'transshipment', 'Correção de destino (COD)',
        'O destino final do B/L ' || p_bl_id || ' foi restaurado para ' || v_original_pod ||
          ' após a reversão do COD.', NULL
      );
    END IF;
  END IF;

  INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  VALUES ('bls', p_bl_id, 'transbordo', v_was, 'transshipment', p_changed_by,
    'Definicao de transbordo (navio de terceiros)');
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
    RAISE EXCEPTION 'Linha de cálculo % não encontrada', p_charge_calculation_id USING ERRCODE = 'P0002';
  END IF;

  IF COALESCE(v_row.source, '') <> 'manual' THEN
    RAISE EXCEPTION 'Somente linhas manuais podem ser removidas' USING ERRCODE = '22023';
  END IF;

  IF COALESCE(v_row.bl_financial_status, 'open') IN ('invoiced', 'partially_paid', 'paid') THEN
    RAISE EXCEPTION 'B/L % já foi faturado; não é permitido remover taxa manual.', v_row.bl_id
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

CREATE OR REPLACE FUNCTION public.mark_bl_charges_reviewed(p_bl_id text, p_actor uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bl RECORD;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuário sem permissão ativa' USING ERRCODE = '42501';
  END IF;

  SELECT id, charge_status
  INTO v_bl
  FROM public.bls
  WHERE id = p_bl_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L % não encontrado', p_bl_id USING ERRCODE = 'P0002';
  END IF;

  IF v_bl.charge_status = 'ready_for_billing' THEN
    RETURN jsonb_build_object('bl_id', p_bl_id, 'status', v_bl.charge_status, 'changed', false);
  END IF;

  UPDATE public.charge_calculations
  SET status = 'reviewed'
  WHERE bl_id = p_bl_id
    AND status IN ('calculated', 'review_required');

  UPDATE public.bls
  SET
    charge_status = 'reviewed',
    charges_reviewed_at = NOW()
  WHERE id = p_bl_id;

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
    'bl',
    p_bl_id,
    'charge_status',
    COALESCE(v_bl.charge_status, 'null'),
    'reviewed',
    auth.uid(),
    NOW(),
    'Marcado como revisado no modulo de Taxas Locais'
  );

  RETURN jsonb_build_object('bl_id', p_bl_id, 'status', 'reviewed', 'changed', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.apply_cod_financial_effect_legacy_130(p_bl_id text, p_omission_id bigint, p_previous_pod text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor UUID := auth.uid();
  v_bl RECORD;
  v_invoice_id BIGINT;
  v_invoice_snapshot_total NUMERIC(14,2) := 0;
  v_invoice_snapshot_count INTEGER := 0;
  v_previous_adjustment_total NUMERIC(14,2) := 0;
  v_previous_adjustment_count INTEGER := 0;
  v_original_total NUMERIC(14,2) := 0;
  v_new_total NUMERIC(14,2) := 0;
  v_manual_total NUMERIC(14,2) := 0;
  v_paid_amount NUMERIC(14,2) := 0;
  v_outstanding NUMERIC(14,2) := 0;
  v_difference NUMERIC(14,2) := 0;
  v_offset_amount NUMERIC(14,2) := 0;
  v_refund_amount NUMERIC(14,2) := 0;
  v_action TEXT;
  v_manual_review BOOLEAN := false;
  v_has_manual_lines BOOLEAN := false;
  v_roe NUMERIC(10,4);
  v_roe_effective_date DATE;
BEGIN
  IF v_actor IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuário sem permissão ativa.' USING ERRCODE = '42501';
  END IF;

  SELECT b.id, b.pod, b.financial_status
  INTO v_bl
  FROM public.bls AS b
  WHERE b.id = p_bl_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L % não encontrado', p_bl_id USING ERRCODE = 'P0002';
  END IF;

  -- ADR 0094: o COD muda a tabela (POD novo), não o câmbio fixado.
  SELECT r.roe, r.effective_date
  INTO v_roe, v_roe_effective_date
  FROM public._bl_fixed_roe(p_bl_id) r;

  IF v_roe IS NULL AND EXISTS (
    SELECT 1
    FROM public.charge_calculations AS cc
    WHERE cc.bl_id = p_bl_id
      AND COALESCE(cc.total_value_usd, 0) > 0
  ) THEN
    RAISE EXCEPTION 'Câmbio (ROE) não configurado; não é possível calcular linhas em USD.'
      USING ERRCODE = '22023';
  END IF;

  SELECT
    COALESCE(SUM(COALESCE(cc.total_value_brl,
      CASE WHEN COALESCE(cc.total_value_usd, 0) > 0
        THEN ROUND(cc.total_value_usd * v_roe, 2)
      END,
      0)), 0),
    BOOL_OR(COALESCE(cc.source, 'auto') = 'manual')
  INTO v_original_total, v_has_manual_lines
  FROM public.charge_calculations AS cc
  WHERE cc.bl_id = p_bl_id;

  v_original_total := ROUND(COALESCE(v_original_total, 0), 2);
  v_has_manual_lines := COALESCE(v_has_manual_lines, false);

  SELECT COALESCE(SUM(COALESCE(cc.total_value_brl,
    CASE WHEN COALESCE(cc.total_value_usd, 0) > 0
      THEN ROUND(cc.total_value_usd * v_roe, 2)
    END,
    0)), 0)
  INTO v_manual_total
  FROM public.charge_calculations AS cc
  WHERE cc.bl_id = p_bl_id
    AND COALESCE(cc.source, 'auto') = 'manual';
  v_manual_total := ROUND(COALESCE(v_manual_total, 0), 2);

  -- Pending/non-invoiced B/Ls use the existing writing calculator. Manual
  -- rows are source = manual, so calculate_bl_local_charges deletes only auto
  -- rows and preserves their operator-entered intent.
  IF COALESCE(v_bl.financial_status, 'pending') NOT IN ('invoiced', 'partially_paid', 'paid') THEN
    PERFORM public.calculate_bl_local_charges(
      p_bl_id => p_bl_id,
      p_actor => v_actor,
      p_recalculate => true
    );

    IF v_has_manual_lines THEN
      SELECT COALESCE(SUM(COALESCE(cc.total_value_brl,
        CASE WHEN COALESCE(cc.total_value_usd, 0) > 0 THEN ROUND(cc.total_value_usd * v_roe, 2) END, 0)), 0)
      INTO v_new_total
      FROM public.charge_calculations AS cc
      WHERE cc.bl_id = p_bl_id;
      v_new_total := ROUND(COALESCE(v_new_total, 0), 2);
      v_difference := ROUND(v_new_total - v_original_total, 2);
      v_action := 'manual_charge_review';
      v_manual_review := true;
    ELSE
      RETURN;
    END IF;
  ELSE
    -- Billed states must never call the writing calculator: it intentionally
    -- rejects these states. The 311 helper is the single price-resolution
    -- source for both the previous and already-updated destination PODs.
    -- A ponta nova é uma prévia do destino atual. Linhas em USD precisam do
    -- ROE autoritativo do evento; total_value_brl é nulo nessas linhas.
    SELECT r.roe, r.effective_date
    INTO v_roe, v_roe_effective_date
    FROM public._bl_fixed_roe(p_bl_id) r;

    IF v_roe IS NULL AND EXISTS (
      SELECT 1
      FROM public.resolve_bl_local_charge_items(p_bl_id, v_bl.pod) AS item
      WHERE COALESCE(item.total_value_usd, 0) > 0
    ) THEN
      RAISE EXCEPTION 'Câmbio (ROE) não configurado; não é possível reprecificar linhas em USD.'
        USING ERRCODE = '22023';
    END IF;

    SELECT COALESCE(SUM(
      COALESCE(item.total_value_brl,
        CASE WHEN COALESCE(item.total_value_usd, 0) > 0
          THEN ROUND(item.total_value_usd * v_roe, 2)
        END,
        0)
    ), 0)
    INTO v_new_total
    FROM public.resolve_bl_local_charge_items(p_bl_id, v_bl.pod) AS item;
    v_new_total := ROUND(COALESCE(v_new_total, 0) + v_manual_total, 2);

    -- A ponta original não é a tabela vigente do POD antigo. O documento que
    -- efetivamente faturou o B/L (invoice_bls, inclusive consolidadas) é o
    -- snapshot monetário; invoice_items/invoices são fallbacks legados.
    SELECT i.id
    INTO v_invoice_id
    FROM public.invoices AS i
    WHERE COALESCE(i.status, 'issued') NOT IN ('cancelled', 'obsolete', 'covered')
      AND (i.bl_id = p_bl_id OR EXISTS (
        SELECT 1 FROM public.invoice_bls AS ib
        WHERE ib.invoice_id = i.id AND ib.bl_id = p_bl_id
      ))
    ORDER BY i.issued_at DESC NULLS LAST, i.id DESC
    LIMIT 1;

    IF v_invoice_id IS NOT NULL THEN
      SELECT COALESCE(SUM(ib.subtotal_brl), 0), COUNT(*)
      INTO v_invoice_snapshot_total, v_invoice_snapshot_count
      FROM public.invoice_bls AS ib
      WHERE ib.invoice_id = v_invoice_id AND ib.bl_id = p_bl_id;

      IF v_invoice_snapshot_count = 0 THEN
        SELECT COALESCE(SUM(COALESCE(
          ii.total_value_brl,
          CASE WHEN COALESCE(ii.total_value_usd, 0) > 0
            THEN ROUND(ii.total_value_usd * NULLIF(ii.snapshot_payload->>'roe', '')::NUMERIC, 2)
          END,
          0
        )), 0), COUNT(*)
        INTO v_invoice_snapshot_total, v_invoice_snapshot_count
        FROM public.invoice_items AS ii
        WHERE ii.invoice_id = v_invoice_id AND ii.bl_id = p_bl_id;
      END IF;

      IF v_invoice_snapshot_count = 0 THEN
        SELECT COALESCE(i.total_brl, 0), 1
        INTO v_invoice_snapshot_total, v_invoice_snapshot_count
        FROM public.invoices AS i
        WHERE i.id = v_invoice_id;
      END IF;
    END IF;

    -- F-18 (368): B/L coberto por consolidada paga (a individual saiu da
    -- busca por estar coberta): o documento é a consolidada, pelo vínculo.
    IF v_invoice_snapshot_count = 0 THEN
      SELECT coalesce(sum(l.subtotal_brl), 0), count(*)
      INTO v_invoice_snapshot_total, v_invoice_snapshot_count
      FROM public.invoice_receivable_links AS l
      WHERE l.bl_id = p_bl_id AND l.status IN ('active', 'settled_by_this_invoice')
        AND l.invoice_id = (
          SELECT i.id FROM public.invoice_receivable_links AS l2 JOIN public.invoices AS i ON i.id = l2.invoice_id
          WHERE l2.bl_id = p_bl_id AND l2.status IN ('active', 'settled_by_this_invoice')
            AND coalesce(i.status, 'issued') NOT IN ('cancelled', 'obsolete', 'covered')
          ORDER BY i.issued_at DESC NULLS LAST, i.id DESC LIMIT 1);
    END IF;

    IF v_invoice_snapshot_count = 0 THEN
      RAISE EXCEPTION 'Nao foi encontrado snapshot da fatura do B/L %.', p_bl_id
        USING ERRCODE = 'P0002';
    END IF;
    v_original_total := ROUND(COALESCE(v_invoice_snapshot_total, 0), 2);

    -- Em uma reversão COD → transbordo (ou nova ida ao COD), a comparação é
    -- contra o último destino efetivamente registrado, para que cada
    -- transição gere seu próprio evento mesmo quando o snapshot original da
    -- invoice permanece imutável.
    SELECT new_destination_value_brl, 1
    INTO v_previous_adjustment_total, v_previous_adjustment_count
    FROM public.cod_adjustments
    WHERE bl_id = p_bl_id AND omission_id = p_omission_id
    ORDER BY id DESC
    LIMIT 1;
    IF v_previous_adjustment_count > 0 THEN
      v_original_total := ROUND(v_previous_adjustment_total, 2);
    END IF;

    SELECT COALESCE(SUM(
      CASE
        WHEN ib.invoice_id IS NOT NULL
          AND COALESCE(i.total_brl, 0) > 0
          AND EXISTS (
            SELECT 1
            FROM public.invoice_bls AS ib_other
            WHERE ib_other.invoice_id = i.id
              AND ib_other.bl_id <> p_bl_id
          )
        THEN p.amount_brl * COALESCE(ib.subtotal_brl, 0) / i.total_brl
        ELSE p.amount_brl
      END
    ), 0)
    INTO v_paid_amount
    FROM public.payments AS p
    JOIN public.invoices AS i ON i.id = p.invoice_id
    LEFT JOIN public.invoice_bls AS ib
      ON ib.invoice_id = i.id AND ib.bl_id = p_bl_id
    WHERE COALESCE(i.status, 'issued') <> 'cancelled'
      AND (i.bl_id = p_bl_id OR ib.bl_id = p_bl_id);
    v_paid_amount := ROUND(GREATEST(COALESCE(v_paid_amount, 0), 0), 2);
    IF v_paid_amount = 0 THEN
      SELECT COALESCE(SUM(COALESCE(i.total_paid_brl, 0)), 0)
      INTO v_paid_amount
      FROM public.invoices AS i
      WHERE i.bl_id = p_bl_id
        AND COALESCE(i.status, 'issued') <> 'cancelled';
      v_paid_amount := ROUND(GREATEST(COALESCE(v_paid_amount, 0), 0), 2);
    END IF;
    -- F-18 (368): o pago pela consolidada está no recebível do B/L.
    SELECT greatest(v_paid_amount, coalesce(max(r.settled_amount_brl), 0)) INTO v_paid_amount
    FROM public.bl_receivables AS r WHERE r.bl_id = p_bl_id AND r.source = 'local_charges';
    v_paid_amount := ROUND(v_paid_amount, 2);
    v_outstanding := ROUND(GREATEST(v_original_total - v_paid_amount, 0), 2);
    v_difference := ROUND(v_new_total - v_original_total, 2);

    -- F-41 (368): sem diferença não há ajuste (antes, a fatura sem pagamento
    -- ganhava um "Cancelar e reemitir" que nunca se liquidava).
    IF v_difference = 0 THEN
      RETURN;
    END IF;

    -- An unpaid invoice is the only cancel/reissue branch. A B/L remains
    -- financial_status = invoiced while its invoice is partially paid, so
    -- payment money—not only the coarse B/L status—selects the next branch.
    IF v_paid_amount = 0 THEN
      v_action := 'cancel_and_reissue';
      v_manual_review := true;
    ELSIF v_difference > 0 THEN
      v_action := 'complementary_invoice';
    ELSIF v_difference < 0 THEN
      v_offset_amount := ROUND(LEAST(ABS(v_difference), v_outstanding), 2);
      v_refund_amount := ROUND(GREATEST(ABS(v_difference) - v_outstanding, 0), 2);
      v_action := CASE
        WHEN v_refund_amount > 0 THEN 'refund_overpayment'
        ELSE 'offset_open_balance'
      END;
    ELSE
      RETURN;
    END IF;
  END IF;

  INSERT INTO public.cod_adjustments (
    bl_id,
    omission_id,
    original_value_brl,
    new_destination_value_brl,
    difference_brl,
    paid_amount_brl,
    outstanding_balance_brl,
    offset_amount_brl,
    refund_amount_brl,
    action,
    status,
    manual_review_required,
    resulting_document_id,
    resulting_document_type,
    created_by
  )
  VALUES (
    p_bl_id,
    p_omission_id,
    ROUND(v_original_total, 2),
    ROUND(v_new_total, 2),
    ROUND(v_difference, 2),
    ROUND(v_paid_amount, 2),
    ROUND(v_outstanding, 2),
    ROUND(v_offset_amount, 2),
    ROUND(v_refund_amount, 2),
    v_action,
    'pending',
    v_manual_review,
    NULL,
    NULL,
    v_actor
  )
  ;
END;
$function$;

CREATE OR REPLACE FUNCTION public._calculate_bl_local_charges_impl_491(p_bl_id text, p_actor uuid DEFAULT NULL::uuid, p_recalculate boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bl record;
  v_actor uuid;
  v_has_vehicles boolean := false;
  v_is_exempt boolean := false;
  v_is_lcl_movement boolean := false;
  v_auto_review boolean := false;
  v_line_count integer := 0;
  v_total_brl numeric(14,2) := 0;
  v_total_usd numeric(14,2) := 0;
  v_status text := 'calculated';
  v_reason text := NULL;
  v_no_containers boolean := false;
  v_qty_dual numeric(12,6) := 0;
  item record;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuário sem permissão ativa' USING ERRCODE = '42501';
  END IF;

  SELECT
    b.id,
    b.voyage_id,
    b.batch_id,
    COALESCE(b.cargo_mode, 'container') AS cargo_mode,
    b.customer_id,
    b.pod,
    NULLIF((to_jsonb(b)->>'bb_weight_ton'), '')::numeric AS bb_weight_ton,
    b.total_weight_kg,
    b.movement_to,
    b.financial_status,
    b.cancelled_at
  INTO v_bl
  FROM public.bls AS b
  WHERE b.id = p_bl_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L % não encontrado', p_bl_id USING ERRCODE = 'P0002';
  END IF;

  -- F-28 (372): B/L cancelado é somente leitura também para o cálculo.
  IF v_bl.cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION 'B/L % cancelado e somente leitura; reative o B/L para calcular.', p_bl_id USING ERRCODE = '22023';
  END IF;

  IF v_bl.financial_status IN ('invoiced', 'partially_paid', 'paid') THEN
    RAISE EXCEPTION 'B/L % já foi faturado (situação financeira: %): o recálculo manual não altera a fatura. Corrija os dados do B/L, que a fatura é corrigida automaticamente.', p_bl_id, public._financial_status_label(v_bl.financial_status) USING ERRCODE = '22023';
  END IF;

  v_actor := COALESCE(p_actor, auth.uid());

  -- ADR 0093, decisão 1: o cálculo usa e grava a tabela vinculada ao B/L.
  PERFORM public.bind_bl_local_charge_tables(p_bl_id);
  -- ADR 0094: o preço (tabela, Condição, data e câmbio) fica fixo no primeiro
  -- cálculo; itens de tabela vinculada depois entram com a data e o câmbio dele.
  PERFORM public.freeze_bl_prices(p_bl_id);
  -- ADR 0093, decisão 3: a base deste cálculo, para a emissão saber se ainda vale.
  INSERT INTO public.bl_charge_calculation_basis (bl_id, basis, calculated_at)
  VALUES (p_bl_id, public.bl_invoice_basis_snapshot(p_bl_id), now())
  ON CONFLICT (bl_id) DO UPDATE SET basis = EXCLUDED.basis, calculated_at = EXCLUDED.calculated_at;
  -- 491 (ADR 0111): alteração à mão cuja tabela saiu do B/L é descartada (POD
  -- novo, modalidade sem aquela tabela) ou passa para a tabela nova do mesmo
  -- escopo (preço refixado), com evento no Histórico das taxas.
  PERFORM public._reconcile_bl_charge_adjustments(p_bl_id);

  IF p_recalculate THEN
    DELETE FROM public.charge_calculations
    WHERE bl_id = p_bl_id
      AND COALESCE(source, 'auto') = 'auto';
  END IF;

  -- Checar isencao LCL de veiculos
  SELECT EXISTS(SELECT 1 FROM public.vehicles WHERE bl_id = p_bl_id)
  INTO v_has_vehicles;

  v_is_lcl_movement := v_bl.movement_to IS NOT NULL AND (
    UPPER(TRIM(v_bl.movement_to)) LIKE '%LCL%' OR UPPER(TRIM(v_bl.movement_to)) LIKE '%CFS%'
  );

  IF v_bl.cargo_mode = 'container' AND v_has_vehicles AND v_is_lcl_movement THEN
    v_is_exempt := true;
    v_reason := 'Carga de veiculos / LCL no destino (movement_to=' || v_bl.movement_to || ') com taxas pagas na origem';

    INSERT INTO public.charge_calculations (
      bl_id, source, status, calculation_key, quantity,
      unit_value_brl, total_value_brl, notes, review_reason, created_by, calculated_at
    )
    VALUES (
      p_bl_id, 'auto', 'exempt', 'exempt:lcl_vehicle', 1,
      0, 0, 'Linha sintetica de isencao', v_reason, v_actor, NOW()
    )
    ON CONFLICT (bl_id, calculation_key) DO UPDATE
      SET status = EXCLUDED.status,
          quantity = EXCLUDED.quantity,
          unit_value_brl = EXCLUDED.unit_value_brl,
          total_value_brl = EXCLUDED.total_value_brl,
          notes = EXCLUDED.notes,
          review_reason = EXCLUDED.review_reason,
          created_by = EXCLUDED.created_by,
          calculated_at = NOW();

    UPDATE public.bls
    SET charge_status = 'exempt',
        charges_calculated_at = NOW(),
        charge_exemption_reason = v_reason,
        billing_hold_reason = NULL
    WHERE id = p_bl_id;

    -- F-26 (372): o B/L que ficou isento anula o recebível em aberto.
    PERFORM public.sync_local_charge_receivable(p_bl_id);

    RETURN jsonb_build_object(
      'bl_id', p_bl_id, 'status', 'exempt', 'table_id', NULL,
      'line_count', 1, 'total_brl', 0, 'total_usd', 0,
      'review_required', false, 'exempt', true, 'reason', v_reason
    );
  END IF;

  -- Checagem de B/L de container sem containers
  IF v_bl.cargo_mode IN ('container', 'misto') THEN
    SELECT COUNT(*)
    INTO v_qty_dual
    FROM (
      SELECT 1 FROM public.bl_containers bc
      WHERE bc.bl_id = p_bl_id AND COALESCE(bc.is_imo, false) AND COALESCE(bc.is_oog, false)
    ) s;

    -- IMO e OOG ao mesmo tempo é cobrado pelo motor (THD normal + 150%, migration 129).

    IF v_bl.cargo_mode = 'container' THEN
      SELECT NOT EXISTS(
        SELECT 1 FROM public.bl_containers AS bc
        WHERE bc.bl_id = p_bl_id AND TRIM(COALESCE(bc.container_number, '')) <> ''
      ) INTO v_no_containers;

      IF v_no_containers THEN
        v_auto_review := true;
        INSERT INTO public.charge_calculations (
          bl_id, source, status, calculation_key, quantity,
          total_value_brl, review_reason, notes, created_by, calculated_at
        )
        VALUES (
          p_bl_id, 'auto', 'review_required', 'review:no_containers', 1,
          0, 'B/L de container sem containers cadastrados', 'Revisao manual obrigatoria', v_actor, NOW()
        )
        ON CONFLICT (bl_id, calculation_key) DO UPDATE
          SET status = EXCLUDED.status, quantity = EXCLUDED.quantity,
              total_value_brl = EXCLUDED.total_value_brl, review_reason = EXCLUDED.review_reason,
              notes = EXCLUDED.notes, created_by = EXCLUDED.created_by, calculated_at = NOW();
      END IF;
    END IF;
  END IF;

  -- Iterar linhas resolvidas por resolve_bl_local_charge_items (ADR 0069)
  -- 491: as linhas já vêm com as alterações à mão aplicadas e com o valor da
  -- tabela ao lado, para a tela.
  FOR item IN SELECT * FROM public._resolve_bl_local_charge_items_charged(p_bl_id, v_bl.pod) LOOP
    IF item.status = 'review_required' THEN
      v_auto_review := true;
      INSERT INTO public.charge_calculations (
        bl_id, charge_table_id, charge_item_id, source, status, calculation_key, quantity,
        total_value_brl, review_reason, notes, created_by, calculated_at
      )
      VALUES (
        p_bl_id, item.charge_table_id, item.charge_item_id, item.source, item.status, item.calculation_key,
        item.quantity, item.total_value_brl, item.review_reason, item.notes, v_actor, NOW()
      )
      ON CONFLICT (bl_id, calculation_key) DO UPDATE
        SET status = EXCLUDED.status,
            quantity = EXCLUDED.quantity,
            total_value_brl = EXCLUDED.total_value_brl,
            review_reason = EXCLUDED.review_reason,
            notes = EXCLUDED.notes,
            created_by = EXCLUDED.created_by,
            calculated_at = NOW();
    ELSE
      INSERT INTO public.charge_calculations (
        bl_id, charge_table_id, charge_item_id, quantity,
        unit_value_brl, unit_value_usd, total_value_brl, total_value_usd,
        override_applied, source, status, calculation_key,
        created_by, calculated_at,
        adjustment_id, table_unit_value_brl, table_unit_value_usd, table_total_value_brl, table_total_value_usd
      )
      VALUES (
        p_bl_id, item.charge_table_id, item.charge_item_id, item.quantity,
        item.unit_value_brl, item.unit_value_usd, item.total_value_brl, item.total_value_usd,
        item.override_applied, item.source, item.status, item.calculation_key,
        v_actor, NOW(),
        item.adjustment_id, item.table_unit_value_brl, item.table_unit_value_usd, item.table_total_value_brl, item.table_total_value_usd
      )
      ON CONFLICT (bl_id, calculation_key) DO UPDATE
        SET charge_table_id = EXCLUDED.charge_table_id,
            charge_item_id = EXCLUDED.charge_item_id,
            quantity = EXCLUDED.quantity,
            unit_value_brl = EXCLUDED.unit_value_brl,
            unit_value_usd = EXCLUDED.unit_value_usd,
            total_value_brl = EXCLUDED.total_value_brl,
            total_value_usd = EXCLUDED.total_value_usd,
            override_applied = EXCLUDED.override_applied,
            source = EXCLUDED.source,
            status = EXCLUDED.status,
            created_by = EXCLUDED.created_by,
            calculated_at = NOW(),
            adjustment_id = EXCLUDED.adjustment_id,
            table_unit_value_brl = EXCLUDED.table_unit_value_brl,
            table_unit_value_usd = EXCLUDED.table_unit_value_usd,
            table_total_value_brl = EXCLUDED.table_total_value_brl,
            table_total_value_usd = EXCLUDED.table_total_value_usd;
    END IF;
  END LOOP;

  -- 491 (D7): taxa com valor total alterado cuja quantidade mudou mantém o
  -- total e ganha o evento no Histórico das taxas.
  PERFORM public._track_bl_charge_adjustment_quantities(p_bl_id);

  SELECT COUNT(*),
         COALESCE(SUM(COALESCE(total_value_brl, 0)), 0),
         COALESCE(SUM(COALESCE(total_value_usd, 0)), 0)
  INTO v_line_count, v_total_brl, v_total_usd
  FROM public.charge_calculations
  WHERE bl_id = p_bl_id;

  IF v_is_exempt THEN
    v_status := 'exempt';
  ELSIF v_auto_review THEN
    v_status := 'review_required';
  ELSIF v_line_count > 0 THEN
    v_status := 'calculated';
  ELSE
    v_status := 'not_calculated';
  END IF;

  UPDATE public.bls
  SET charge_status = v_status,
      charges_calculated_at = NOW(),
      charge_exemption_reason = CASE WHEN v_status = 'exempt' THEN v_reason ELSE NULL END,
      billing_hold_reason = CASE
        WHEN v_status = 'review_required' THEN 'Pendencia de revisao nas taxas locais.'
        WHEN v_status = 'not_calculated' THEN 'Nenhuma tabela de preco ou tarifa encontrada. Adicione os precos e recalcule.'
        ELSE NULL
      END
  WHERE id = p_bl_id;

  PERFORM public.sync_local_charge_receivable(p_bl_id);

  RETURN jsonb_build_object(
    'bl_id', p_bl_id,
    'status', v_status,
    'line_count', v_line_count,
    'total_brl', v_total_brl,
    'total_usd', v_total_usd,
    'review_required', v_auto_review,
    'exempt', (v_status = 'exempt'),
    'reason', COALESCE(v_reason, '')
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.apply_container_dates_atomic_legacy_189(p_request_id uuid, p_bl_id text, p_rows jsonb, p_changed_by uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_role text;
  v_bl_id text := NULLIF(btrim(COALESCE(p_bl_id, '')), '');
  v_count integer := 0;
  v_item jsonb;
  v_num text;
  v_discharge text;
  v_return text;
  v_exp_discharge text;
  v_exp_return text;
  v_updated bigint[] := ARRAY[]::bigint[];
  v_unchanged bigint[] := ARRAY[]::bigint[];
  v_touched text[] := ARRAY[]::text[];
  v_billing_state text := 'pending';
  v_after jsonb := '{}'::jsonb;
  r record;
BEGIN
  IF v_actor IS NULL OR NOT public.is_active_user() OR p_changed_by IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'Usuário sem permissão ativa.' USING ERRCODE = '42501';
  END IF;
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'request_id obrigatorio.' USING ERRCODE = '22023';
  END IF;
  IF v_bl_id IS NULL THEN
    RAISE EXCEPTION 'B/L obrigatorio.' USING ERRCODE = '22023';
  END IF;
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'Lote de datas invalido.' USING ERRCODE = '22023';
  END IF;
  v_count := jsonb_array_length(p_rows);
  IF v_count = 0 OR v_count > 500 THEN
    RAISE EXCEPTION 'Lote deve ter entre 1 e 500 linhas.' USING ERRCODE = '22023';
  END IF;

  PERFORM 1 FROM public.bls WHERE id = v_bl_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L % não encontrado', v_bl_id USING ERRCODE = 'P0002';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_rows)
  LOOP
    IF jsonb_typeof(v_item) <> 'object' THEN
      RAISE EXCEPTION 'Linha de datas invalida.' USING ERRCODE = '22023';
    END IF;
    v_num := upper(btrim(COALESCE(v_item->>'container_number', '')));
    v_discharge := NULLIF(btrim(COALESCE(v_item->>'discharge_date', '')), '');
    v_return := NULLIF(btrim(COALESCE(v_item->>'return_date', '')), '');
    IF v_num = '' THEN
      RAISE EXCEPTION 'Container obrigatorio no B/L %.', v_bl_id USING ERRCODE = '22023';
    END IF;
    IF v_discharge IS NULL OR v_discharge !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR v_discharge::date IS NULL THEN
      RAISE EXCEPTION 'Data de descarga invalida para % no B/L %.', v_num, v_bl_id USING ERRCODE = '22023';
    END IF;
    IF v_return IS NOT NULL AND (v_return !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR v_return::date IS NULL) THEN
      RAISE EXCEPTION 'Data de devolucao invalida para % no B/L %.', v_num, v_bl_id USING ERRCODE = '22023';
    END IF;
    IF v_return IS NOT NULL AND v_return::date < v_discharge::date THEN
      RAISE EXCEPTION 'Devolucao anterior a descarga para % no B/L %.', v_num, v_bl_id USING ERRCODE = '22023';
    END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_to_recordset(p_rows) AS t(container_number text, discharge_date text, return_date text)
      WHERE upper(btrim(COALESCE(t.container_number, ''))) = v_num
        AND (btrim(COALESCE(t.discharge_date, '')) IS DISTINCT FROM v_discharge
             OR NULLIF(btrim(COALESCE(t.return_date, '')), '') IS DISTINCT FROM v_return)
    ) THEN
      RAISE EXCEPTION 'Container % duplicado com datas conflitantes no B/L %.', v_num, v_bl_id USING ERRCODE = '22023';
    END IF;
  END LOOP;

  -- Todos os conjuntos do arquivo, em ordem de id, antes da trava por linha
  -- abaixo (211): duas planilhas de B/Ls que dividem containers não se travam.
  PERFORM public._lock_container_date_sets(ARRAY(
    SELECT c.id FROM public.bl_containers AS c
    WHERE c.bl_id = v_bl_id
      AND upper(btrim(c.container_number)) IN (
        SELECT upper(btrim(COALESCE(row_item->>'container_number', '')))
        FROM jsonb_array_elements(p_rows) AS row_item)));

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_rows)
  LOOP
    v_num := upper(btrim(COALESCE(v_item->>'container_number', '')));
    v_discharge := NULLIF(btrim(COALESCE(v_item->>'discharge_date', '')), '');
    v_return := NULLIF(btrim(COALESCE(v_item->>'return_date', '')), '');
    v_exp_discharge := NULLIF(btrim(COALESCE(v_item->>'expected_discharge_date', '')), '');
    v_exp_return := NULLIF(btrim(COALESCE(v_item->>'expected_return_date', '')), '');

    SELECT c.id, c.discharge_date::text, c.return_date::text INTO r
    FROM public.bl_containers AS c
    WHERE c.bl_id = v_bl_id AND upper(btrim(c.container_number)) = v_num
    ORDER BY c.id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Container % nao pertence ao B/L %.', v_num, v_bl_id USING ERRCODE = 'P0002';
    END IF;

    -- Devolução vazia na planilha não mexe na data gravada (ADR 0078, item 19).
    -- Vem antes da checagem de prévia obsoleta: o container que já está no
    -- valor pedido não é escrito, e a data que outro B/L do mesmo arquivo
    -- acabou de propagar a este (container compartilhado) não é conflito.
    IF r.discharge_date IS NOT DISTINCT FROM v_discharge
       AND (v_return IS NULL OR r.return_date IS NOT DISTINCT FROM v_return) THEN
      v_unchanged := array_append(v_unchanged, r.id);
      CONTINUE;
    END IF;

    -- A prévia que viu a descarga vazia também conta: a chave presente com
    -- valor nulo é conferida, como a da devolução (201).
    IF (v_item ? 'expected_discharge_date') AND (r.discharge_date IS DISTINCT FROM v_exp_discharge) THEN
      RAISE EXCEPTION 'Preview obsoleto para % no B/L %: recarregue e reconfira.', v_num, v_bl_id USING ERRCODE = '22023';
    END IF;
    IF (v_item ? 'expected_return_date') AND (r.return_date IS DISTINCT FROM v_exp_return) THEN
      RAISE EXCEPTION 'Preview obsoleto para % no B/L %: recarregue e reconfira.', v_num, v_bl_id USING ERRCODE = '22023';
    END IF;

    v_touched := v_touched || public._apply_container_dates_core(r.id, v_discharge::date, v_return::date, v_return IS NULL);
    v_updated := array_append(v_updated, r.id);
  END LOOP;

  -- SOC não tem devolução a esperar (ADR 0014; migration 121).
  IF NOT EXISTS (
    SELECT 1 FROM public.bl_containers AS c
    WHERE c.bl_id = v_bl_id AND c.return_date IS NULL AND c.ownership IS DISTINCT FROM 'SOC'
  ) THEN
    v_billing_state := 'ready_for_billing';
  END IF;

  v_role := public.current_actor_role();

  IF cardinality(v_updated) > 0 THEN
    v_touched := ARRAY(SELECT DISTINCT unnest(v_touched || ARRAY[v_bl_id]));
    INSERT INTO public.audit_logs(
      entity_type, entity_id, field_name, old_value, new_value,
      changed_by, justification, actor_role, actor_department
    ) VALUES (
      'bl', v_bl_id, 'container_dates_import',
      jsonb_build_object('request_id', p_request_id, 'bl_id', v_bl_id)::text,
      jsonb_build_object(
        'request_id', p_request_id, 'bl_id', v_bl_id,
        'updated_ids', v_updated, 'unchanged_ids', v_unchanged,
        'billing_state', v_billing_state, 'propagated_bl_ids', v_touched
      )::text,
      v_actor, 'Importacao de datas por B/L (atomica)', v_role, v_role
    );
    v_after := public._after_container_dates(p_request_id, v_touched, v_actor);
  END IF;

  RETURN jsonb_build_object(
    'request_id', p_request_id,
    'bl_id', v_bl_id,
    'updated_ids', v_updated,
    'unchanged_ids', v_unchanged,
    'billing_state', v_billing_state,
    'propagated_bl_ids', to_jsonb(v_touched),
    'demurrage', v_after
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.import_breakbulk_manifest_transactional_legacy_189(p_filename text, p_voyage_id bigint, p_uploaded_by uuid, p_total_bls integer, p_bls jsonb, p_items jsonb, p_errors jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bls jsonb := COALESCE(p_bls, '[]'::jsonb);
  v_items jsonb := COALESCE(p_items, '[]'::jsonb);
  v_row record;
  v_item jsonb;
  v_before public.bls%ROWTYPE;
  v_after public.bls%ROWTYPE;
  v_bl_id text;
  v_bl_ids text[];
  v_existing_ids text[] := ARRAY[]::text[];
  v_inserted_ids text[] := ARRAY[]::text[];
  v_updated_ids text[] := ARRAY[]::text[];
  v_effect_ids text[];
  v_existing_bb boolean;
  v_incoming_bb boolean;
  v_batch_id bigint;
  v_action_id uuid := gen_random_uuid();
  v_previous_replacement text := current_setting('vela.breakbulk_import_replacement', true);
  v_previous_basis_source text := current_setting('vela.invoice_basis_source', true);
  v_previous_terminal text := current_setting('vela.bl_terminal_override', true);
  v_voyage_label text;
  v_other_label text;
  v_billed boolean;
  v_override boolean;
  v_cod boolean;
  v_in_customer bigint;
  v_customer_mode text;
  v_new_pol text;
  v_new_pod text;
  v_route_locked text[];
  v_relink jsonb;
  v_relinks jsonb := '[]'::jsonb;
  v_customer_ignored jsonb := '[]'::jsonb;
  v_billing_locked jsonb := '[]'::jsonb;
  v_cod_kept jsonb := '[]'::jsonb;
  v_ce_ignored text[];
  v_items_changed boolean;
  v_changed_fields text[];
  v_reasons text[];
  v_human_notes text;
  v_notes text;
  v_review text;
  v_has_live_invoice boolean;
  v_reissues jsonb;
  v_file_document text;
  v_bl_items jsonb;
  v_tracked_fields text[] := ARRAY[
    'shipper', 'consignee', 'notify_party', 'cargo_description', 'pol', 'pod',
    'customer_id', 'manifest_customer_cnpj_cpf', 'manifest_customer_name',
    'bb_machine_qty', 'bb_packages_qty', 'bb_packages_total', 'bb_weight_ton',
    'bb_cbm', 'ncm_codes', 'manifesto_mercante_id'
  ];
BEGIN
  IF auth.uid() IS NULL
     OR NOT public.is_active_user()
     OR p_uploaded_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Usuário sem permissão para importar carga solta.'
      USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(v_bls) IS DISTINCT FROM 'array' OR jsonb_typeof(v_items) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Payload de carga solta inválido.' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(array_agg(source.row->>'id'), ARRAY[]::text[])
    INTO v_bl_ids
  FROM jsonb_array_elements(v_bls) AS source(row);

  SELECT concat_ws(' / ', NULLIF(btrim(ve.name), ''), NULLIF(btrim(v.voyage_number), ''))
    INTO v_voyage_label
  FROM public.voyages AS v
  LEFT JOIN public.vessels AS ve ON ve.id = v.vessel_id
  WHERE v.id = p_voyage_id;

  -- 1. Trava os B/Ls existentes e recusa o lote antes de gravar qualquer coisa.
  FOR v_row IN
    SELECT b.id, b.voyage_id, b.financial_status, b.bb_weight_ton, b.bb_packages_qty,
      source.row AS incoming
    FROM public.bls AS b
    JOIN jsonb_array_elements(v_bls) AS source(row) ON b.id = source.row->>'id'
    ORDER BY b.id
    FOR UPDATE OF b
  LOOP
    v_existing_ids := v_existing_ids || v_row.id;

    IF v_row.voyage_id IS DISTINCT FROM p_voyage_id THEN
      SELECT concat_ws(' / ', NULLIF(btrim(ve.name), ''), NULLIF(btrim(v.voyage_number), ''))
        INTO v_other_label
      FROM public.voyages AS v
      LEFT JOIN public.vessels AS ve ON ve.id = v.vessel_id
      WHERE v.id = v_row.voyage_id;
      RAISE EXCEPTION
        'O B/L % já está na Viagem % e o arquivo foi importado na Viagem %. Nenhum B/L do lote foi gravado: exclua o B/L lá (se tiver CE Mercante, tire o CE antes) e importe de novo (cancelar não libera o número).',
        v_row.id, COALESCE(v_other_label, v_row.voyage_id::text), COALESCE(v_voyage_label, p_voyage_id::text)
        USING ERRCODE = 'P0005';
    END IF;

    v_existing_bb := COALESCE(v_row.bb_weight_ton, 0) > 0
      OR COALESCE(v_row.bb_packages_qty, 0) > 0
      OR EXISTS (SELECT 1 FROM public.bl_breakbulk_items WHERE bl_id = v_row.id);
    v_incoming_bb := COALESCE(NULLIF(v_row.incoming->>'bb_weight_ton', '')::numeric, 0) > 0
      OR COALESCE(NULLIF(v_row.incoming->>'bb_packages_qty', '')::numeric, 0) > 0
      OR EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_items) AS item(row)
        WHERE item.row->>'bl_id' = v_row.id
      );

    IF v_row.financial_status IN ('invoiced', 'paid') AND v_existing_bb AND NOT v_incoming_bb THEN
      RAISE EXCEPTION
        'B/L % já foi faturado (situação financeira: %); a importação removeria carga solta. Estorne/refature antes de substituir o manifesto.',
        v_row.id, public._financial_status_label(v_row.financial_status)
        USING ERRCODE = 'P0003';
    END IF;
  END LOOP;

  SELECT COALESCE(array_agg(source.row->>'id'), ARRAY[]::text[])
    INTO v_ce_ignored
  FROM jsonb_array_elements(v_bls) AS source(row)
  WHERE NULLIF(btrim(source.row->>'ce_mercante'), '') IS NOT NULL;

  PERFORM set_config('vela.breakbulk_import_replacement', 'on', true);
  PERFORM set_config('vela.invoice_basis_source', 'bl_reimport_correction', true);
  v_batch_id := public.import_manifest_transactional_legacy_165(
    p_filename, p_voyage_id, p_uploaded_by, 'carga_solta', NULL, p_total_bls, 0,
    '[]'::jsonb, '[]'::jsonb, COALESCE(p_errors, '[]'::jsonb)
  );

  -- 2. B/Ls novos: o que o arquivo traz, sem CE.
  WITH inserted AS (
    INSERT INTO public.bls (
      id, voyage_id, batch_id, cargo_mode, shipper, consignee, cargo_description,
      customer_id, suggested_customer_id, pol, pod, total_weight_kg, review_status,
      financial_status, notes, manifest_customer_cnpj_cpf, manifest_customer_name,
      manifest_customer_email, customer_reconciliation_status,
      customer_reconciliation_notes, billing_hold_reason, notify_party,
      bb_machine_qty, bb_packages_qty, bb_packages_total, bb_weight_ton, bb_cbm, ncm_codes
    )
    SELECT
      source.row->>'id',
      p_voyage_id,
      v_batch_id,
      'carga_solta',
      NULLIF(source.row->>'shipper', ''),
      source.row->>'consignee',
      NULLIF(source.row->>'cargo_description', ''),
      NULLIF(source.row->>'customer_id', '')::bigint,
      CASE WHEN NULLIF(source.row->>'customer_id', '') IS NULL
        THEN NULLIF(source.row->>'suggested_customer_id', '')::bigint END,
      NULLIF(source.row->>'pol', ''),
      NULLIF(source.row->>'pod', ''),
      NULLIF(source.row->>'total_weight_kg', '')::numeric,
      COALESCE(NULLIF(source.row->>'review_status', ''), 'ok'),
      'pending',
      NULLIF(source.row->>'notes', ''),
      public.normalize_document_text(source.row->>'manifest_customer_cnpj_cpf'),
      COALESCE(NULLIF(source.row->>'manifest_customer_name', ''), source.row->>'consignee'),
      NULLIF(source.row->>'manifest_customer_email', ''),
      COALESCE(NULLIF(source.row->>'customer_reconciliation_status', ''), 'missing_customer'),
      NULLIF(source.row->>'customer_reconciliation_notes', ''),
      NULLIF(source.row->>'billing_hold_reason', ''),
      NULLIF(source.row->>'notify_party', ''),
      NULLIF(source.row->>'bb_machine_qty', '')::numeric,
      NULLIF(source.row->>'bb_packages_qty', '')::numeric,
      NULLIF(source.row->>'bb_packages_total', '')::numeric,
      NULLIF(source.row->>'bb_weight_ton', '')::numeric,
      NULLIF(source.row->>'bb_cbm', '')::numeric,
      COALESCE(public.normalize_ncm_codes(source.row->'ncm_codes'), '{}'::text[])
    FROM jsonb_array_elements(v_bls) AS source(row)
    WHERE NOT (source.row->>'id' = ANY(v_existing_ids))
    RETURNING id
  )
  SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::text[]) INTO v_inserted_ids FROM inserted;

  -- 3. B/Ls existentes: só o que o arquivo traz, B/L a B/L.
  FOR v_item IN
    SELECT source.row FROM jsonb_array_elements(v_bls) AS source(row)
    WHERE source.row->>'id' = ANY(v_existing_ids)
    ORDER BY source.row->>'id'
  LOOP
    v_bl_id := v_item->>'id';
    SELECT * INTO v_before FROM public.bls WHERE id = v_bl_id;

    -- Faturado = fatura viva ou status financeiro faturado/pago. Cálculo sem
    -- fatura não trava a rota: a tela recalcula o B/L alterado.
    v_billed := COALESCE(v_before.financial_status, 'pending') IN ('invoiced', 'paid')
      OR cardinality(public._live_local_invoice_ids_for_bl(v_bl_id)) > 0;
    v_override := COALESCE(NULLIF(v_item->>'override_billing', '')::boolean, false);
    v_cod := EXISTS (
      SELECT 1 FROM public.bl_transshipments AS t
      JOIN public.voyage_omissions AS o ON o.id = t.omission_id
      WHERE t.bl_id = v_bl_id AND t.disposition = 'cod' AND o.reverted_at IS NULL
    );
    v_in_customer := NULLIF(v_item->>'customer_id', '')::bigint;
    v_file_document := public.normalize_document_text(v_item->>'manifest_customer_cnpj_cpf');
    v_customer_mode := CASE
      -- 213 (fix 2): CNPJ do arquivo diferente do gravado e do Cliente
      -- vinculado, sem Cliente cadastrado (consignatário não cadastrado), é
      -- Troca de Consignatário: só com o aceite; sem ele, o consignatário fica.
      WHEN v_in_customer IS NULL
        AND v_before.customer_id IS NOT NULL
        AND v_file_document IS NOT NULL
        AND v_file_document IS DISTINCT FROM public.normalize_document_text(v_before.manifest_customer_cnpj_cpf)
        AND v_file_document IS DISTINCT FROM (
          SELECT public.normalize_document_text(c.cnpj_cpf) FROM public.customers AS c WHERE c.id = v_before.customer_id
        )
        THEN CASE WHEN COALESCE(NULLIF(v_item->>'relink_customer', '')::boolean, false) THEN 'relink' ELSE 'ignored' END
      WHEN v_in_customer IS NULL THEN 'keep'
      WHEN v_before.customer_id IS NULL THEN 'link'
      WHEN v_before.customer_id = v_in_customer THEN 'same'
      WHEN COALESCE(NULLIF(v_item->>'relink_customer', '')::boolean, false) THEN 'relink'
      ELSE 'ignored'
    END;

    v_route_locked := ARRAY[]::text[];
    v_new_pol := COALESCE(NULLIF(btrim(v_item->>'pol'), ''), v_before.pol);
    v_new_pod := COALESCE(NULLIF(btrim(v_item->>'pod'), ''), v_before.pod);
    IF v_new_pod IS DISTINCT FROM v_before.pod AND v_cod THEN
      v_cod_kept := v_cod_kept || jsonb_build_object('bl_id', v_bl_id, 'pod', v_before.pod, 'file_pod', v_new_pod);
      v_new_pod := v_before.pod;
    END IF;
    IF v_billed AND NOT v_override THEN
      IF v_new_pol IS DISTINCT FROM v_before.pol THEN
        v_route_locked := v_route_locked || 'pol'::text;
        v_new_pol := v_before.pol;
      END IF;
      IF v_new_pod IS DISTINCT FROM v_before.pod THEN
        v_route_locked := v_route_locked || 'pod'::text;
        v_new_pod := v_before.pod;
      END IF;
      -- 381 (ADR 0094, B5): sem a confirmação de faturamento, nada que afete a
      -- cobrança muda no B/L faturado: peso, CBM, volumes e máquinas ficam.
      IF NULLIF(v_item->>'bb_weight_ton', '')::numeric IS DISTINCT FROM v_before.bb_weight_ton AND NULLIF(v_item->>'bb_weight_ton', '') IS NOT NULL THEN
        v_route_locked := v_route_locked || 'peso'::text;
      END IF;
      IF NULLIF(v_item->>'bb_cbm', '')::numeric IS DISTINCT FROM v_before.bb_cbm AND NULLIF(v_item->>'bb_cbm', '') IS NOT NULL THEN
        v_route_locked := v_route_locked || 'cbm'::text;
      END IF;
      IF (NULLIF(v_item->>'bb_packages_qty', '')::numeric IS DISTINCT FROM v_before.bb_packages_qty AND NULLIF(v_item->>'bb_packages_qty', '') IS NOT NULL)
         OR (NULLIF(v_item->>'bb_packages_total', '')::numeric IS DISTINCT FROM v_before.bb_packages_total AND NULLIF(v_item->>'bb_packages_total', '') IS NOT NULL) THEN
        v_route_locked := v_route_locked || 'volumes'::text;
      END IF;
      IF NULLIF(v_item->>'bb_machine_qty', '')::numeric IS DISTINCT FROM v_before.bb_machine_qty AND NULLIF(v_item->>'bb_machine_qty', '') IS NOT NULL THEN
        v_route_locked := v_route_locked || 'maquinas'::text;
      END IF;
      v_item := v_item || jsonb_build_object('bb_weight_ton', NULL, 'bb_cbm', NULL, 'bb_packages_qty', NULL,
        'bb_packages_total', NULL, 'bb_machine_qty', NULL);
      IF cardinality(v_route_locked) > 0 THEN
        v_billing_locked := v_billing_locked || jsonb_build_object('bl_id', v_bl_id, 'fields', to_jsonb(v_route_locked));
      END IF;
    END IF;

    IF v_customer_mode = 'ignored' THEN
      v_customer_ignored := v_customer_ignored || jsonb_build_object(
        'bl_id', v_bl_id,
        'customer_id', v_before.customer_id,
        'file_customer_id', v_in_customer,
        'file_document', v_file_document,
        'file_consignee', NULLIF(v_item->>'consignee', '')
      );
    END IF;

    IF v_new_pod IS DISTINCT FROM v_before.pod
       AND (v_before.terminal_id IS NOT NULL OR v_before.pod_port_id IS NOT NULL) THEN
      PERFORM set_config('vela.bl_terminal_override', 'on', true);
    END IF;

    UPDATE public.bls AS b
    SET
      batch_id = v_batch_id,
      shipper = COALESCE(NULLIF(v_item->>'shipper', ''), b.shipper),
      -- B5 (192): na Troca de Consignatário o Consignee novo só entra se a troca
      -- for aplicada (UPDATE depois de `relink_bl_customer`).
      consignee = CASE WHEN v_customer_mode IN ('ignored', 'relink') THEN b.consignee
        ELSE COALESCE(NULLIF(v_item->>'consignee', ''), b.consignee) END,
      notify_party = COALESCE(NULLIF(v_item->>'notify_party', ''), b.notify_party),
      cargo_description = COALESCE(NULLIF(v_item->>'cargo_description', ''), b.cargo_description),
      pol = v_new_pol,
      pod = v_new_pod,
      -- 213 (fix 6): o desvínculo do Manifesto Mercante é do gatilho
      -- `unlink_manifesto_on_route_change` (207), que compara os portos
      -- normalizados e grava o Histórico legível.
      terminal_id = CASE WHEN v_new_pod IS DISTINCT FROM b.pod THEN NULL ELSE b.terminal_id END,
      pod_port_id = CASE WHEN v_new_pod IS DISTINCT FROM b.pod THEN NULL ELSE b.pod_port_id END,
      customer_id = CASE WHEN v_customer_mode = 'link' THEN v_in_customer ELSE b.customer_id END,
      suggested_customer_id = CASE
        WHEN v_customer_mode = 'link' THEN NULL
        WHEN b.customer_id IS NULL AND v_in_customer IS NULL AND v_item ? 'suggested_customer_id'
          THEN NULLIF(v_item->>'suggested_customer_id', '')::bigint
        ELSE b.suggested_customer_id
      END,
      customer_reconciliation_status = CASE
        WHEN v_customer_mode = 'link' THEN COALESCE(NULLIF(v_item->>'customer_reconciliation_status', ''), 'matched_document')
        WHEN v_customer_mode = 'same'
          AND COALESCE(b.customer_reconciliation_status, 'missing_customer') IN ('missing_customer', 'matched_name')
          AND v_item->>'customer_reconciliation_status' = 'matched_document'
          THEN 'matched_document'
        WHEN b.customer_id IS NULL AND v_in_customer IS NULL
          AND COALESCE(b.customer_reconciliation_status, 'missing_customer') IN ('missing_customer', 'matched_name')
          AND v_item->>'customer_reconciliation_status' IN ('missing_customer', 'matched_name')
          THEN v_item->>'customer_reconciliation_status'
        ELSE b.customer_reconciliation_status
      END,
      customer_reconciliation_notes = CASE
        WHEN v_customer_mode = 'link'
          OR (v_customer_mode = 'same'
            AND COALESCE(b.customer_reconciliation_status, 'missing_customer') IN ('missing_customer', 'matched_name')
            AND v_item->>'customer_reconciliation_status' = 'matched_document')
          OR (b.customer_id IS NULL AND v_in_customer IS NULL
            AND COALESCE(b.customer_reconciliation_status, 'missing_customer') IN ('missing_customer', 'matched_name')
            AND v_item->>'customer_reconciliation_status' IN ('missing_customer', 'matched_name'))
          THEN COALESCE(NULLIF(v_item->>'customer_reconciliation_notes', ''), b.customer_reconciliation_notes)
        ELSE b.customer_reconciliation_notes
      END,
      -- B6 (192): com o mesmo Cliente a retenção gravada (ex.: "Acesso ao portal
      -- nao provisionado") fica; só a reconciliação que sobe para documento
      -- troca a retenção pela do arquivo, como no B/L de container (175).
      billing_hold_reason = CASE
        WHEN v_customer_mode = 'link' THEN NULLIF(v_item->>'billing_hold_reason', '')
        WHEN v_customer_mode = 'same'
          AND COALESCE(b.customer_reconciliation_status, 'missing_customer') IN ('missing_customer', 'matched_name')
          AND v_item->>'customer_reconciliation_status' = 'matched_document'
          THEN NULLIF(v_item->>'billing_hold_reason', '')
        ELSE b.billing_hold_reason
      END,
      manifest_customer_cnpj_cpf = CASE
        WHEN v_customer_mode IN ('link', 'same') OR (b.customer_id IS NULL AND v_in_customer IS NULL)
          THEN COALESCE(public.normalize_document_text(v_item->>'manifest_customer_cnpj_cpf'), b.manifest_customer_cnpj_cpf)
        ELSE b.manifest_customer_cnpj_cpf
      END,
      manifest_customer_name = CASE
        WHEN v_customer_mode IN ('link', 'same') OR (b.customer_id IS NULL AND v_in_customer IS NULL)
          THEN COALESCE(NULLIF(v_item->>'manifest_customer_name', ''), b.manifest_customer_name)
        ELSE b.manifest_customer_name
      END,
      manifest_customer_email = CASE WHEN v_customer_mode IN ('ignored', 'relink') THEN b.manifest_customer_email
        ELSE COALESCE(NULLIF(v_item->>'manifest_customer_email', ''), b.manifest_customer_email) END,
      bb_machine_qty = COALESCE(NULLIF(v_item->>'bb_machine_qty', '')::numeric, b.bb_machine_qty),
      bb_packages_qty = COALESCE(NULLIF(v_item->>'bb_packages_qty', '')::numeric, b.bb_packages_qty),
      bb_packages_total = COALESCE(NULLIF(v_item->>'bb_packages_total', '')::numeric, b.bb_packages_total),
      bb_weight_ton = COALESCE(NULLIF(v_item->>'bb_weight_ton', '')::numeric, b.bb_weight_ton),
      bb_cbm = COALESCE(NULLIF(v_item->>'bb_cbm', '')::numeric, b.bb_cbm),
      ncm_codes = CASE
        WHEN cardinality(public.normalize_ncm_codes(v_item->'ncm_codes')) > 0
          THEN public.normalize_ncm_codes(v_item->'ncm_codes')
        ELSE b.ncm_codes
      END
    WHERE b.id = v_bl_id;

    PERFORM set_config('vela.bl_terminal_override', COALESCE(v_previous_terminal, 'off'), true);

    IF v_customer_mode = 'relink' THEN
      v_relink := public.relink_bl_customer(v_bl_id, v_in_customer, p_uploaded_by,
        'Troca de Consignatario aceita na reimportacao de carga solta');
      v_relinks := v_relinks || jsonb_build_array(v_relink || jsonb_build_object('bl_id', v_bl_id));
      IF COALESCE((v_relink->>'applied')::boolean, false) THEN
        UPDATE public.bls
        SET consignee = COALESCE(NULLIF(v_item->>'consignee', ''), consignee),
            manifest_customer_cnpj_cpf = COALESCE(public.normalize_document_text(v_item->>'manifest_customer_cnpj_cpf'), manifest_customer_cnpj_cpf),
            manifest_customer_name = COALESCE(NULLIF(v_item->>'manifest_customer_name', ''), manifest_customer_name),
            manifest_customer_email = COALESCE(NULLIF(v_item->>'manifest_customer_email', ''), manifest_customer_email)
        WHERE id = v_bl_id;
      END IF;
    END IF;

    -- Itens só são substituídos quando o arquivo os traz e eles mudaram.
    -- 213 (fix 4): com um item gravado e um no arquivo (B/L avulso PDF/DOCX e
    -- Manifesto BB do armador), o valor que o documento não traz (null ou
    -- vazio) fica o gravado: "Valor vazio no arquivo não apaga o valor gravado".
    -- ponytail: com mais de um item não há como parear as linhas; null vira 0
    -- como antes. Só o layout legado traz vários itens, sempre com os números.
    v_items_changed := false;
    SELECT jsonb_agg(item.row) INTO v_bl_items
    FROM jsonb_array_elements(v_items) AS item(row)
    WHERE item.row->>'bl_id' = v_bl_id;
    IF jsonb_array_length(COALESCE(v_bl_items, '[]'::jsonb)) = 1
       AND (SELECT count(*) FROM public.bl_breakbulk_items WHERE bl_id = v_bl_id) = 1 THEN
      SELECT jsonb_build_array(jsonb_build_object(
          'bl_id', v_bl_id,
          'item_description', COALESCE(NULLIF(v_bl_items->0->>'item_description', ''), i.item_description),
          'package_qty', COALESCE(NULLIF(v_bl_items->0->>'package_qty', '')::numeric, i.package_qty),
          'package_unit', COALESCE(NULLIF(v_bl_items->0->>'package_unit', ''), i.package_unit),
          'gross_weight_kg', COALESCE(NULLIF(v_bl_items->0->>'gross_weight_kg', '')::numeric, i.gross_weight_kg),
          'cbm', COALESCE(NULLIF(v_bl_items->0->>'cbm', '')::numeric, i.cbm),
          'marks', COALESCE(NULLIF(v_bl_items->0->>'marks', ''), i.marks)
        ))
        INTO v_bl_items
      FROM public.bl_breakbulk_items AS i
      WHERE i.bl_id = v_bl_id;
    END IF;
    IF v_bl_items IS NOT NULL THEN
      SELECT
        COALESCE((
          SELECT jsonb_agg(jsonb_build_array(i.item_description, i.package_qty, i.package_unit, i.gross_weight_kg, i.cbm, i.marks)
            ORDER BY i.item_description, i.package_qty, i.gross_weight_kg, i.cbm, i.package_unit, i.marks)
          FROM public.bl_breakbulk_items AS i WHERE i.bl_id = v_bl_id
        ), '[]'::jsonb)
        IS DISTINCT FROM
        COALESCE((
          SELECT jsonb_agg(jsonb_build_array(n.item_description, n.package_qty, n.package_unit, n.gross_weight_kg, n.cbm, n.marks)
            ORDER BY n.item_description, n.package_qty, n.gross_weight_kg, n.cbm, n.package_unit, n.marks)
          FROM (
            SELECT
              item.row->>'item_description' AS item_description,
              COALESCE(NULLIF(item.row->>'package_qty', '')::numeric, 0) AS package_qty,
              NULLIF(item.row->>'package_unit', '') AS package_unit,
              COALESCE(NULLIF(item.row->>'gross_weight_kg', '')::numeric, 0) AS gross_weight_kg,
              COALESCE(NULLIF(item.row->>'cbm', '')::numeric, 0) AS cbm,
              NULLIF(item.row->>'marks', '') AS marks
            FROM jsonb_array_elements(v_bl_items) AS item(row)
          ) AS n
        ), '[]'::jsonb)
      INTO v_items_changed;

      IF v_items_changed AND v_billed AND NOT v_override
         AND EXISTS (SELECT 1 FROM public.bl_breakbulk_items AS i WHERE i.bl_id = v_bl_id)
             IS DISTINCT FROM (jsonb_array_length(v_bl_items) > 0) THEN
        v_items_changed := false;
        v_billing_locked := v_billing_locked || jsonb_build_object('bl_id', v_bl_id, 'fields', jsonb_build_array('itens'));
      END IF;
      IF v_items_changed THEN
        DELETE FROM public.bl_breakbulk_items WHERE bl_id = v_bl_id;
        INSERT INTO public.bl_breakbulk_items (bl_id, item_description, package_qty, package_unit, gross_weight_kg, cbm, marks)
        SELECT v_bl_id, item.row->>'item_description',
          COALESCE(NULLIF(item.row->>'package_qty', '')::numeric, 0),
          NULLIF(item.row->>'package_unit', ''),
          COALESCE(NULLIF(item.row->>'gross_weight_kg', '')::numeric, 0),
          COALESCE(NULLIF(item.row->>'cbm', '')::numeric, 0),
          NULLIF(item.row->>'marks', '')
        FROM jsonb_array_elements(v_bl_items) AS item(row);
      END IF;
    END IF;

    SELECT * INTO v_after FROM public.bls WHERE id = v_bl_id;
    SELECT COALESCE(array_agg(f ORDER BY f), ARRAY[]::text[]) INTO v_changed_fields
    FROM unnest(v_tracked_fields) AS f
    WHERE to_jsonb(v_before)->f IS DISTINCT FROM to_jsonb(v_after)->f;
    IF v_items_changed THEN v_changed_fields := v_changed_fields || 'itens_carga_solta'::text; END IF;

    -- Revisão: a pendência de importação é refeita; sem pendência, o status
    -- humano fica e só a pendência antiga sai.
    v_has_live_invoice := EXISTS (
      SELECT 1 FROM public.invoice_bls AS ib JOIN public.invoices AS i ON i.id = ib.invoice_id
      WHERE ib.bl_id = v_bl_id AND i.status NOT IN ('cancelled', 'obsolete')
    );
    IF COALESCE(v_after.financial_status, 'pending') NOT IN ('invoiced', 'paid') AND NOT v_has_live_invoice THEN
      v_reasons := public.compute_bl_review_pendencies(v_bl_id);
      v_human_notes := btrim(regexp_replace(COALESCE(v_after.notes, ''), E'(^|\\n)Pendencias de importacao:[^\\n]*', '', 'gi'));
      v_notes := CASE
        WHEN COALESCE(cardinality(v_reasons), 0) > 0 THEN concat_ws(E'\n', NULLIF(v_human_notes, ''),
          'Pendencias de importacao: ' || array_to_string(v_reasons, ', '))
        ELSE NULLIF(v_human_notes, '')
      END;
      v_review := CASE
        WHEN COALESCE(cardinality(v_reasons), 0) > 0 THEN 'pending_review'
        WHEN v_after.review_status = 'pending_review' THEN 'ok'
        ELSE v_after.review_status
      END;
      IF v_review IS DISTINCT FROM v_after.review_status OR v_notes IS DISTINCT FROM v_after.notes THEN
        UPDATE public.bls SET review_status = v_review, notes = v_notes WHERE id = v_bl_id;
      END IF;
    END IF;

    IF cardinality(v_changed_fields) > 0 THEN
      v_updated_ids := v_updated_ids || v_bl_id;
      INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
      VALUES (
        'bl', v_bl_id, 'reimportacao_carga_solta', NULL,
        jsonb_build_object(
          'tipo', 'reimportacao_carga_solta',
          'viagem', COALESCE(v_voyage_label, p_voyage_id::text),
          'rota', concat_ws(' -> ', v_after.pol, v_after.pod),
          'campos', to_jsonb(v_changed_fields)
        )::text,
        p_uploaded_by,
        'Reimportacao de carga solta na Viagem ' || COALESCE(v_voyage_label, p_voyage_id::text)
          || ' (rota ' || concat_ws(' -> ', COALESCE(v_after.pol, '?'), COALESCE(v_after.pod, '?')) || ')'
      );
    END IF;
  END LOOP;

  -- 4. Itens dos B/Ls novos.
  INSERT INTO public.bl_breakbulk_items (bl_id, item_description, package_qty, package_unit, gross_weight_kg, cbm, marks)
  SELECT item.row->>'bl_id', item.row->>'item_description',
    COALESCE(NULLIF(item.row->>'package_qty', '')::numeric, 0),
    NULLIF(item.row->>'package_unit', ''),
    COALESCE(NULLIF(item.row->>'gross_weight_kg', '')::numeric, 0),
    COALESCE(NULLIF(item.row->>'cbm', '')::numeric, 0),
    NULLIF(item.row->>'marks', '')
  FROM jsonb_array_elements(v_items) AS item(row)
  WHERE item.row->>'bl_id' = ANY(v_inserted_ids);

  IF cardinality(v_bl_ids) > 0 THEN
    PERFORM public.apply_bl_review_gate_after_import(v_bl_ids, p_uploaded_by);
  END IF;
  -- B3 (192): a fila de Reconciliação de Cliente acompanha todo B/L do arquivo
  -- (inseridos e atualizados, inclusive os da Troca de Consignatário), como no
  -- B/L de container (175). O B/L que passa a ter Cliente por CNPJ não deixa
  -- item `pending` velho na fila.
  FOREACH v_bl_id IN ARRAY v_bl_ids LOOP
    PERFORM public.sync_customer_reconciliation_queue_for_bl(v_bl_id);
  END LOOP;

  -- Efeito de taxas locais só para o que entrou ou mudou: reimportar o mesmo
  -- arquivo não enfileira trabalho.
  v_effect_ids := v_inserted_ids || v_updated_ids;
  FOREACH v_bl_id IN ARRAY v_effect_ids LOOP
    INSERT INTO public.import_pending_effects(
      source_action_id, effect_kind, entity_id, created_by, source_snapshot
    ) VALUES (
      v_action_id, 'local_billing', v_bl_id, p_uploaded_by,
      jsonb_build_object('filename', p_filename, 'voyage_id', p_voyage_id, 'cargo_mode', 'carga_solta')
    )
    ON CONFLICT (source_action_id, effect_kind, entity_id) DO NOTHING;
  END LOOP;

  v_reissues := COALESCE(public.process_invoice_basis_changes(), '[]'::jsonb);
  PERFORM set_config('vela.invoice_basis_source', COALESCE(v_previous_basis_source, ''), true);
  PERFORM set_config('vela.breakbulk_import_replacement', COALESCE(v_previous_replacement, 'off'), true);

  RETURN jsonb_build_object(
    'batch_id', v_batch_id,
    'breakbulk_bl_ids', to_jsonb(v_bl_ids),
    'inserted_bl_ids', to_jsonb(v_inserted_ids),
    'updated_bl_ids', to_jsonb(v_updated_ids),
    'unchanged_bl_ids', to_jsonb(ARRAY(
      SELECT existing.id FROM unnest(v_existing_ids) AS existing(id)
      WHERE NOT (existing.id = ANY(v_updated_ids)) ORDER BY existing.id
    )),
    'customer_changes_ignored', v_customer_ignored,
    'customer_relinks', v_relinks,
    'billing_locked', v_billing_locked,
    'cod_pod_kept', v_cod_kept,
    'ce_ignored', to_jsonb(v_ce_ignored),
    'invoice_reissues', v_reissues
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public._recalculate_bl_cargo_mode(p_bl_id text, p_transition text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_curr_mode text;
  v_new_mode text;
  v_has_cntr boolean;
  v_has_bb boolean;
  v_financial_status text;
  v_old_rank integer;
  v_new_rank integer;
  v_locked boolean;
  v_locked_addition boolean;
  v_replacement boolean := COALESCE(current_setting('vela.breakbulk_import_replacement', true), 'off') = 'on';
BEGIN
  IF p_bl_id IS NULL THEN
    RETURN;
  END IF;

  SELECT COALESCE(cargo_mode, 'container'), COALESCE(financial_status, 'pending')
    INTO v_curr_mode, v_financial_status
  FROM public.bls
  WHERE id = p_bl_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.bl_containers WHERE bl_id = p_bl_id
  ) INTO v_has_cntr;

  -- A8: maquinas e cubagem sao carga solta declarada tanto quanto peso e
  -- volumes. Um manifesto parcial pode trazer so esses dois, e sem eles no
  -- sinal qualquer UPDATE reclassificava o B/L como 'container' em silencio.
  SELECT EXISTS (
    SELECT 1 FROM public.bl_breakbulk_items WHERE bl_id = p_bl_id
  ) OR EXISTS (
    SELECT 1 FROM public.bls
    WHERE id = p_bl_id
      AND (
        COALESCE(bb_weight_ton, 0) > 0
        OR COALESCE(bb_packages_qty, 0) > 0
        OR COALESCE(bb_machine_qty, 0) > 0
        OR COALESCE(bb_cbm, 0) > 0
      )
  ) INTO v_has_bb;

  v_new_mode := CASE
    WHEN v_has_cntr AND v_has_bb THEN 'misto'
    WHEN v_has_bb THEN 'carga_solta'
    ELSE 'container'
  END;

  v_old_rank := CASE v_curr_mode
    WHEN 'misto' THEN 2
    WHEN 'carga_solta' THEN 1
    ELSE 0
  END;
  v_new_rank := CASE v_new_mode
    WHEN 'misto' THEN 2
    WHEN 'carga_solta' THEN 1
    ELSE 0
  END;
  v_locked := v_financial_status IN ('invoiced', 'paid');

  -- Se a modalidade não mudou, mas o B/L está faturado e houve mutação de itens filhos:
  IF v_curr_mode IS NOT DISTINCT FROM v_new_mode THEN
    IF v_locked AND NOT v_replacement THEN
      IF p_transition = 'delete' THEN
        UPDATE public.bls
        SET charge_status = 'not_calculated',
            review_status = 'pending_review',
            billing_hold_reason = 'Carga removida após faturamento; estorno/refaturamento necessário.',
            updated_at = now()
        WHERE id = p_bl_id;
        IF EXISTS (
          SELECT 1 FROM public.bl_receivables
          WHERE bl_id = p_bl_id AND source = 'local_charges'
        ) THEN
          PERFORM public.sync_local_charge_receivable(p_bl_id);
        END IF;
      ELSIF p_transition = 'insert' THEN
        UPDATE public.bls
        SET charge_status = 'not_calculated',
            review_status = 'pending_review',
            billing_hold_reason = 'Carga adicionada após faturamento; revisar e refaturar.',
            updated_at = now()
        WHERE id = p_bl_id;
        IF EXISTS (
          SELECT 1 FROM public.bl_receivables
          WHERE bl_id = p_bl_id AND source = 'local_charges'
        ) THEN
          PERFORM public.sync_local_charge_receivable(p_bl_id);
        END IF;
      ELSIF p_transition = 'update' THEN
        UPDATE public.bls
        SET charge_status = 'not_calculated',
            review_status = 'pending_review',
            billing_hold_reason = 'Carga alterada após faturamento; estorno/refaturamento necessário.',
            updated_at = now()
        WHERE id = p_bl_id;
        IF EXISTS (
          SELECT 1 FROM public.bl_receivables
          WHERE bl_id = p_bl_id AND source = 'local_charges'
        ) THEN
          PERFORM public.sync_local_charge_receivable(p_bl_id);
        END IF;
      END IF;
    END IF;
    RETURN;
  END IF;

  -- Remover conteúdo de um B/L faturado é uma perda material e precisa de
  -- estorno/refaturamento. Adicionar conteúdo é permitido, mas reabre revisão
  -- e billing hold. O importador usa o GUC transacional abaixo para atravessar
  -- a remoção intermediária da substituição atômica, após o preflight validar
  -- que o resultado final não remove carga BB faturada.
  IF v_locked AND v_old_rank > v_new_rank AND NOT v_replacement THEN
    RAISE EXCEPTION
      'B/L % já foi faturado (situação financeira: %); remover conteúdo exige estorno/refaturamento (transição=%).',
      p_bl_id, public._financial_status_label(v_financial_status), COALESCE(p_transition, 'recalculo')
      USING ERRCODE = 'P0003';
  END IF;

  v_locked_addition := v_locked AND v_new_rank > v_old_rank;

  UPDATE public.bls
  SET cargo_mode = v_new_mode,
      charge_status = 'not_calculated',
      review_status = CASE WHEN v_locked_addition THEN 'pending_review' ELSE review_status END,
      billing_hold_reason = CASE
        WHEN v_locked_addition THEN 'Carga adicionada após faturamento; revisar e refaturar.'
        ELSE billing_hold_reason
      END,
      updated_at = now()
  WHERE id = p_bl_id;

  IF v_new_mode <> 'container' OR v_has_cntr THEN
    DELETE FROM public.charge_calculations
    WHERE bl_id = p_bl_id
      AND source = 'auto'
      AND calculation_key IN ('review:no_container', 'review:no_containers');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.bl_receivables
    WHERE bl_id = p_bl_id AND source = 'local_charges'
  ) THEN
    PERFORM public.sync_local_charge_receivable(p_bl_id);
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_bl_cod(p_bl_id text, p_omission_id bigint, p_justification text, p_changed_by uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_discharge text;
  v_omitted text;
  v_old_pod text;
  v_customer bigint;
  v_old_terminal uuid;
  v_old_pod_port_id bigint;
  v_justification text := NULLIF(btrim(COALESCE(p_justification, '')), '');
  v_previous_override text := current_setting('vela.bl_terminal_override', true);
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR p_changed_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Usuário sem permissão ativa.' USING ERRCODE = '42501';
  END IF;
  IF v_justification IS NULL THEN RAISE EXCEPTION 'Marcar COD exige justificativa.' USING ERRCODE = '22023'; END IF;

  SELECT o.discharge_pod, o.omitted_pod INTO v_discharge, v_omitted
  FROM public.bl_transshipments AS t
  JOIN public.voyage_omissions AS o ON o.id = t.omission_id
  WHERE t.bl_id = p_bl_id AND t.omission_id = p_omission_id
  FOR UPDATE OF o;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transbordo do B/L % nao encontrado', p_bl_id USING ERRCODE = 'P0002';
  END IF;

  SELECT pod, customer_id, terminal_id, pod_port_id
    INTO v_old_pod, v_customer, v_old_terminal, v_old_pod_port_id
  FROM public.bls
  WHERE id = p_bl_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L % não encontrado', p_bl_id USING ERRCODE = 'P0002';
  END IF;

  -- Retry do mesmo COD não repete efeito financeiro, auditoria ou notificação;
  -- inclusive quando a reprecificação concluiu que não havia diferença.
  IF EXISTS (
    SELECT 1
    FROM public.bl_transshipments
    WHERE bl_id = p_bl_id AND omission_id = p_omission_id AND disposition = 'cod'
  ) THEN
    RETURN;
  END IF;

  UPDATE public.bl_transshipments
  SET disposition = 'cod', updated_at = now()
  WHERE bl_id = p_bl_id AND omission_id = p_omission_id;

  -- A exceção terminal é específica do POD anterior. COD deve limpar os dois
  -- campos como uma operação atômica; deixar a dupla antiga seria herdar um
  -- terminal incompatível no destino novo.
  PERFORM set_config('vela.bl_terminal_override', 'on', true);
  UPDATE public.bls
  SET pod = v_discharge,
      manifesto_mercante_id = NULL,
      terminal_id = NULL,
      pod_port_id = NULL,
      updated_at = now()
  WHERE id = p_bl_id;
  PERFORM set_config('vela.bl_terminal_override', COALESCE(v_previous_override, 'off'), true);

  IF to_regprocedure('public.apply_cod_financial_effect(text,bigint,text)') IS NOT NULL THEN
    PERFORM public.apply_cod_financial_effect(p_bl_id, p_omission_id, v_old_pod);
  END IF;

  INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  VALUES ('bls', p_bl_id, 'pod', v_old_pod, v_discharge, p_changed_by,
    'COD apos omissao da escala de ' || v_omitted || ': ' || v_justification);

  IF v_old_terminal IS NOT NULL OR v_old_pod_port_id IS NOT NULL THEN
    INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
    VALUES (
      'bls', p_bl_id, 'terminal_override',
      jsonb_build_object('terminal_id', v_old_terminal, 'pod_port_id', v_old_pod_port_id)::text,
      jsonb_build_object('terminal_id', NULL, 'pod_port_id', NULL)::text,
      p_changed_by,
      'Excecao de terminal limpa por COD: ' || v_justification
    );
  END IF;

  IF v_customer IS NOT NULL THEN
    INSERT INTO public.portal_notifications(customer_id, bl_id, type, title, message, link)
    VALUES (v_customer, p_bl_id, 'transshipment', 'Destino alterado (COD)',
      'A pedido, o destino final do B/L ' || p_bl_id || ' foi alterado para ' || v_discharge ||
        ' (COD), apos a omissao da escala de ' || v_omitted || '.', NULL);
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.bl_timeline(p_bl_id text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS TABLE(id bigint, family text, entity_type text, field_name text, old_value text, new_value text, changed_by uuid, changed_at timestamp with time zone, justification text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH bl_row AS (
    SELECT b.id, b.created_at FROM public.bls b WHERE b.id = p_bl_id
  ),
  -- Rastro de containers e veículos do B/L pelo `bl_id` gravado (404), mais as
  -- linhas em que o container ou veículo saiu deste B/L para outro.
  trail AS (
    SELECT a.* FROM public.audit_logs a
    WHERE a.bl_id = p_bl_id AND a.entity_type IN ('bl_containers', 'vehicles')
    UNION
    SELECT a.* FROM public.audit_logs a
    WHERE a.field_name = 'bl_id' AND a.entity_type IN ('bl_containers', 'vehicles')
      AND a.old_value = p_bl_id
  ),
  member_containers AS (
    SELECT c.id::text AS id FROM public.bl_containers c WHERE c.bl_id = p_bl_id
    UNION
    SELECT t.entity_id FROM trail t WHERE t.entity_type = 'bl_containers'
  ),
  -- Número do container (e chassi do veículo): o registro atual ou o JSON do
  -- rastro, para o container que já saiu.
  names AS (
    SELECT DISTINCT ON (k.entity_type, k.id) k.entity_type, k.id, k.label
    FROM (
      SELECT 'bl_containers'::text AS entity_type, c.id::text AS id, c.container_number AS label, 0 AS prio, NULL::timestamptz AS at
      FROM public.bl_containers c WHERE c.id::text IN (SELECT id FROM member_containers)
      UNION ALL
      SELECT 'vehicles', v.id::text, v.chassis, 0, NULL
      FROM public.vehicles v WHERE v.id::text IN (SELECT t.entity_id FROM trail t WHERE t.entity_type = 'vehicles')
      UNION ALL
      SELECT t.entity_type, t.entity_id,
             public._audit_json_field(COALESCE(t.new_value, t.old_value),
               CASE WHEN t.entity_type = 'vehicles' THEN 'chassis' ELSE 'container_number' END),
             1, t.changed_at
      FROM trail t WHERE t.field_name IN ('criado', 'excluido')
    ) k
    WHERE k.label IS NOT NULL
    ORDER BY k.entity_type, k.id, k.prio, k.at DESC NULLS LAST
  ),
  events AS (
    -- Linhas semânticas do B/L (RPCs e importações).
    SELECT
      a.id,
      CASE
        WHEN a.entity_type = 'invoice' THEN 'fatura'
        WHEN a.entity_type = 'charge_calculation' THEN 'taxas'
        WHEN a.entity_type = 'bl_container' THEN 'container'
        WHEN a.entity_type = 'system_event' THEN 'sistema'
        WHEN a.entity_type = 'bl' AND a.field_name IN ('charge_status', 'local_charge_prices_refixed') THEN 'taxas'
        WHEN a.entity_type = 'bl' AND a.field_name IN ('financial_status', 'billing_hold_reason', 'last_billing_run_id') THEN 'fatura'
        WHEN a.entity_type = 'bl' AND a.field_name IN ('container_ownership', 'container_profile', 'container_dates', 'container_dates_import') THEN 'container'
        -- 571: a dispensa da Demurrage é de um container (antes caía em 'edicao').
        WHEN a.entity_type = 'bl' AND a.field_name = 'demurrage_dispensa' THEN 'container'
        ELSE 'edicao'
      END AS family,
      a.entity_type,
      CASE
        WHEN a.entity_type = 'bl_container' AND n.label IS NOT NULL AND position('|' IN a.field_name) = 0
          THEN a.field_name || '|' || n.label
        ELSE a.field_name
      END AS field_name,
      a.old_value,
      a.new_value,
      a.changed_by,
      a.changed_at,
      a.justification
    FROM public.audit_logs a
    LEFT JOIN names n ON n.entity_type = 'bl_containers' AND a.entity_type = 'bl_container' AND n.id = a.entity_id
    WHERE (
           (a.entity_type = 'bl' AND a.entity_id = p_bl_id
            AND a.changed_at IS DISTINCT FROM (SELECT created_at FROM bl_row))
        OR (a.entity_type = 'bl_container' AND a.entity_id IN (SELECT id FROM member_containers))
        -- 470 (TAX-D08): o `bl_id` gravado mantém a taxa excluída no Histórico.
        OR (a.entity_type = 'charge_calculation' AND (a.bl_id = p_bl_id OR a.entity_id IN (
              SELECT cc.id::text FROM public.charge_calculations cc WHERE cc.bl_id = p_bl_id)))
        OR (a.entity_type = 'invoice' AND a.entity_id IN (
              SELECT ib.invoice_id::text FROM public.invoice_bls ib WHERE ib.bl_id = p_bl_id))
        OR (a.entity_type = 'system_event' AND a.entity_id = p_bl_id)
      )
    UNION ALL
    -- Gatilho de `bls`: campos que a operação lê, sem repetir a linha
    -- semântica do mesmo campo no mesmo instante.
    SELECT a.id, 'edicao', 'bl', a.field_name, a.old_value, a.new_value, a.changed_by, a.changed_at, a.justification
    FROM public.audit_logs a
    WHERE a.entity_type = 'bls' AND a.entity_id = p_bl_id
      AND a.changed_at IS DISTINCT FROM (SELECT created_at FROM bl_row)
      AND a.field_name IN (
        'shipper', 'shipper_block', 'consignee', 'consignee_block', 'consignee_address', 'consignee_phone',
        'notify_party', 'notify_cnpj_cpf', 'notify_block', 'notify2_block',
        'customer_id', 'manifest_customer_cnpj_cpf', 'manifest_customer_name', 'manifest_customer_email',
        'voyage_id', 'pol', 'pod', 'place_of_delivery', 'place_of_receipt', 'movement_from', 'movement_to',
        'terminal_id', 'manifesto_mercante_id', 'cargo_description', 'ncm_codes',
        'total_weight_kg', 'total_cbm', 'total_packages', 'packages_unit',
        'bb_machine_qty', 'bb_packages_qty', 'bb_packages_total', 'bb_weight_ton', 'bb_cbm',
        'incoterm', 'payment_type', 'ce_mercante', 'bl_emission_date', 'issue_place', 'laden_on_board',
        'container_load_type', 'free_time_override', 'notes')
      AND NOT EXISTS (
        SELECT 1 FROM public.audit_logs s
        WHERE s.entity_type = 'bl' AND s.entity_id = a.entity_id
          AND s.field_name = a.field_name AND s.changed_at = a.changed_at)
    UNION ALL
    -- Rastro de `bl_containers` e `vehicles` do B/L.
    SELECT
      t.id,
      CASE WHEN t.entity_type = 'vehicles' THEN 'veiculo' ELSE 'container' END,
      CASE WHEN t.entity_type = 'vehicles' THEN 'vehicle' ELSE 'bl_container' END,
      t.field_name || '|' || COALESCE(n.label, ''),
      CASE WHEN t.field_name IN ('criado', 'excluido') THEN NULL ELSE t.old_value END,
      CASE WHEN t.field_name IN ('criado', 'excluido') THEN NULL ELSE t.new_value END,
      t.changed_by,
      t.changed_at,
      t.justification
    FROM trail t
    LEFT JOIN names n ON n.entity_type = t.entity_type AND n.id = t.entity_id
    WHERE (
            (t.entity_type = 'bl_containers' AND t.field_name IN (
              'criado', 'excluido', 'bl_id', 'container_number', 'seal_number', 'type',
              'gross_weight_kg', 'tare_weight_kg', 'cbm', 'is_oog', 'is_imo', 'imo_class', 'un_number',
              'discharge_date', 'return_date', 'unpacking_location', 'ownership'))
         OR (t.entity_type = 'vehicles' AND t.field_name IN (
              'criado', 'excluido', 'bl_id', 'chassis', 'brand', 'model', 'weight_kg', 'cbm', 'container_id'))
          )
      -- A transação que cria o B/L vira um só "B/L criado" (133).
      AND NOT (t.field_name = 'criado' AND t.changed_at IS NOT DISTINCT FROM (SELECT created_at FROM bl_row))
      -- Mesma mudança já registrada com motivo pela RPC (079).
      AND NOT EXISTS (
        SELECT 1 FROM public.audit_logs s
        WHERE s.entity_type = 'bl_container' AND s.entity_id = t.entity_id
          AND s.field_name = t.field_name AND s.changed_at = t.changed_at)
      AND NOT (t.field_name = 'ownership' AND EXISTS (
        SELECT 1 FROM public.audit_logs s
        WHERE s.entity_type = 'bl' AND s.entity_id = p_bl_id
          AND s.field_name = 'container_ownership' AND s.changed_at = t.changed_at))
      AND NOT (t.field_name = 'type' AND EXISTS (
        SELECT 1 FROM public.audit_logs s
        WHERE s.entity_type = 'bl' AND s.entity_id = p_bl_id
          AND s.field_name = 'container_profile' AND s.changed_at = t.changed_at))
    UNION ALL
    -- id 0 não colide: audit_logs.id é identity a partir de 1.
    SELECT 0::bigint, 'sistema', 'system_event', 'bl_created', NULL, 'B/L criado', NULL::uuid, r.created_at, NULL
    FROM bl_row r
    WHERE r.created_at IS NOT NULL
  )
  SELECT
    e.id,
    e.family,
    e.entity_type,
    e.field_name,
    public._bl_timeline_value(split_part(e.field_name, '|', 1), e.old_value),
    public._bl_timeline_value(split_part(e.field_name, '|', 1), e.new_value),
    e.changed_by,
    e.changed_at,
    e.justification
  FROM events e
  WHERE public.is_active_read_user()
  ORDER BY e.changed_at DESC, e.id DESC
  LIMIT GREATEST(COALESCE(p_limit, 50), 0)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
$function$;

CREATE OR REPLACE FUNCTION public._update_manual_bl_charge_impl_491(p_charge_calculation_id bigint, p_quantity numeric, p_notes text DEFAULT NULL::text, p_actor uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_row RECORD;
  v_adj public.bl_charge_adjustments;
  v_qty NUMERIC(12,6);
  v_unit_brl NUMERIC(12,2);
  v_unit_usd NUMERIC(12,2);
  v_total_brl NUMERIC(14,2);
  v_total_usd NUMERIC(14,2);
  v_name text;
BEGIN
  -- O autor é quem está logado (ADR 0085, regra base 2; migration 241).
  PERFORM public._assert_actor_is_caller(p_actor);
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuário sem permissão ativa' USING ERRCODE = '42501';
  END IF;

  SELECT
    cc.id, cc.bl_id, cc.source, cc.quantity, cc.unit_value_brl, cc.unit_value_usd,
    cc.total_value_brl, cc.total_value_usd, cc.notes, cc.calculation_key, cc.adjustment_id,
    cc.table_unit_value_brl, cc.table_unit_value_usd, cc.charge_item_id,
    b.financial_status AS bl_financial_status
  INTO v_row
  FROM public.charge_calculations AS cc
  LEFT JOIN public.bls AS b ON b.id = cc.bl_id
  WHERE cc.id = p_charge_calculation_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Linha de cálculo % não encontrada', p_charge_calculation_id USING ERRCODE = 'P0002';
  END IF;

  IF COALESCE(v_row.source, '') <> 'manual' THEN
    RAISE EXCEPTION 'Somente linhas manuais podem ser editadas' USING ERRCODE = '22023';
  END IF;

  IF COALESCE(v_row.bl_financial_status, 'open') IN ('invoiced', 'partially_paid', 'paid') THEN
    RAISE EXCEPTION 'B/L % já foi faturado; não é permitido editar taxa manual.', v_row.bl_id
      USING ERRCODE = '22023';
  END IF;

  v_qty := COALESCE(p_quantity, v_row.quantity, 1);
  IF v_qty <= 0 THEN
    RAISE EXCEPTION 'Quantidade deve ser maior que zero' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_adj FROM public.bl_charge_adjustments a
   WHERE a.bl_id = v_row.bl_id AND a.line_key = v_row.calculation_key AND a.ended_at IS NULL FOR UPDATE;

  v_unit_brl := v_row.unit_value_brl;
  v_unit_usd := v_row.unit_value_usd;
  IF v_adj.kind = 'total' THEN
    v_total_brl := CASE WHEN v_adj.currency = 'USD' THEN NULL ELSE v_adj.value END;
    v_total_usd := CASE WHEN v_adj.currency = 'USD' THEN v_adj.value END;
    v_unit_brl := CASE WHEN v_adj.currency = 'USD' THEN NULL ELSE round(v_adj.value / v_qty, 2) END;
    v_unit_usd := CASE WHEN v_adj.currency = 'USD' THEN round(v_adj.value / v_qty, 2) END;
  ELSE
    v_total_brl := CASE WHEN v_row.unit_value_brl IS NULL THEN NULL ELSE ROUND(v_qty * v_row.unit_value_brl, 2) END;
    v_total_usd := CASE WHEN v_row.unit_value_usd IS NULL THEN NULL ELSE ROUND(v_qty * v_row.unit_value_usd, 2) END;
  END IF;

  UPDATE public.charge_calculations
  SET
    quantity = v_qty,
    unit_value_brl = v_unit_brl,
    unit_value_usd = v_unit_usd,
    total_value_brl = v_total_brl,
    total_value_usd = v_total_usd,
    table_total_value_brl = CASE WHEN table_unit_value_brl IS NULL THEN table_total_value_brl ELSE round(v_qty * table_unit_value_brl, 2) END,
    table_total_value_usd = CASE WHEN table_unit_value_usd IS NULL THEN table_total_value_usd ELSE round(v_qty * table_unit_value_usd, 2) END,
    notes = NULLIF(TRIM(COALESCE(p_notes, '')), ''),
    calculated_at = NOW()
  WHERE id = p_charge_calculation_id;

  IF v_adj.id IS NOT NULL AND v_adj.reference_quantity IS DISTINCT FROM v_qty THEN
    IF v_adj.kind = 'total' THEN
      SELECT cti.name INTO v_name FROM public.charge_table_items cti WHERE cti.id = v_row.charge_item_id;
      PERFORM public._record_bl_charge_event(v_row.bl_id, v_adj.id, 'quantity_changed', v_row.calculation_key,
        COALESCE(v_name, v_adj.charge_name),
        jsonb_build_object('quantity', v_adj.reference_quantity),
        jsonb_build_object('quantity', v_qty, 'total', v_adj.value, 'currency', v_adj.currency),
        NULLIF(TRIM(COALESCE(p_notes, '')), ''), auth.uid());
    END IF;
    UPDATE public.bl_charge_adjustments SET reference_quantity = v_qty WHERE id = v_adj.id;
  END IF;

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

CREATE OR REPLACE FUNCTION public.quote_manual_invoice_charge(p_bl_id text, p_charge_item_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_item record;
  v_basis text;
  v_quantity numeric := 1;
  v_unit numeric;
  v_roe numeric;
  v_roe_date date;
  v_override bigint;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_read_user() THEN
    RAISE EXCEPTION 'Usuário sem permissão ativa.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_item FROM public.list_manual_charge_items_for_bl(p_bl_id)
    WHERE charge_item_id = p_charge_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item manual não elegível para este B/L.' USING ERRCODE = '22023';
  END IF;
  SELECT application_basis INTO v_basis FROM public.charge_table_items WHERE id = p_charge_item_id;
  IF v_basis = 'teu' THEN
    SELECT sum(CASE WHEN normalized ~ '^45' THEN 2.25 WHEN normalized ~ '^(40|42)' THEN 2
      WHEN normalized ~ '^(20|22)' THEN 1 ELSE NULL END)
    INTO v_quantity FROM (SELECT regexp_replace(upper(coalesce(type, '')), '[[:space:]-]', '', 'g') normalized
      FROM public.bl_containers WHERE bl_id = upper(btrim(p_bl_id))) c;
    IF EXISTS (SELECT 1 FROM public.bl_containers WHERE bl_id = upper(btrim(p_bl_id))
      AND regexp_replace(upper(coalesce(type, '')), '[[:space:]-]', '', 'g') !~ '^(45|40|42|20|22)') THEN
      RAISE EXCEPTION 'Tipo de container desconhecido; confira os TEUs do B/L.' USING ERRCODE = '22023';
    END IF;
  ELSIF v_basis IS DISTINCT FROM 'bl' THEN
    RAISE EXCEPTION 'Base de cobranca nao suportada na avulsa: %.', v_basis USING ERRCODE = '22023';
  END IF;
  IF coalesce(v_quantity, 0) <= 0 THEN
    RAISE EXCEPTION 'B/L sem quantidade faturavel.' USING ERRCODE = '22023';
  END IF;
  SELECT cro.id INTO v_override FROM public.customer_rate_overrides cro
    JOIN public.bls b ON b.customer_id = cro.customer_id
    WHERE b.id = upper(btrim(p_bl_id)) AND cro.charge_item_id = p_charge_item_id AND cro.active
      AND (cro.valid_from IS NULL OR cro.valid_from <= public.bl_local_charge_reference_date(b.id))
      AND (cro.valid_to IS NULL OR cro.valid_to >= public.bl_local_charge_reference_date(b.id))
    ORDER BY cro.created_at DESC LIMIT 1;
  IF v_item.currency = 'USD' THEN
    SELECT roe, effective_date INTO v_roe, v_roe_date FROM public.exchange_rate_reference WHERE id = 1;
    IF v_roe IS NULL OR v_roe <= 0 THEN
      RAISE EXCEPTION 'Câmbio (ROE) não configurado.' USING ERRCODE = '22023';
    END IF;
    v_unit := round(v_item.effective_unit_value_usd * v_roe, 2);
  ELSE
    v_unit := v_item.effective_unit_value_brl;
  END IF;
  RETURN to_jsonb(v_item) || jsonb_build_object('quantity', v_quantity, 'application_basis', v_basis,
    'unit_value_brl', v_unit, 'total_brl', CASE WHEN v_item.currency = 'USD'
      THEN round(round(v_quantity * v_item.effective_unit_value_usd, 2) * v_roe, 2) ELSE round(v_quantity * v_unit, 2) END,
    'total_usd', CASE WHEN v_item.currency = 'USD' THEN round(v_quantity * v_item.effective_unit_value_usd, 2) END,
    'roe', v_roe, 'roe_effective_date', v_roe_date, 'override_id', v_override);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_bl_portal_status(p_bl_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_customer_id BIGINT;
  v_ce_mercante TEXT;
  v_account_situation TEXT;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_read_user() THEN
    RAISE EXCEPTION 'Usuário sem permissão ativa.' USING ERRCODE = '42501';
  END IF;

  SELECT b.customer_id, b.ce_mercante
  INTO v_customer_id, v_ce_mercante
  FROM public.bls b
  WHERE b.id = p_bl_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L % não encontrado', p_bl_id USING ERRCODE = 'P0002';
  END IF;

  SELECT a.account_situation
  INTO v_account_situation
  FROM public.customer_portal_accounts a
  WHERE a.customer_id = v_customer_id;

  RETURN jsonb_build_object(
    'customer_id', v_customer_id,
    'ce_mercante', v_ce_mercante,
    'account_situation', v_account_situation,
    'portal_access_ready', public.customer_portal_access_ready(v_customer_id),
    'billing_access_ready', public.customer_billing_access_ready(v_customer_id),
    'notifications', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', n.id,
        'type', n.type,
        'title', n.title,
        'created_at', n.created_at,
        'read_at', n.read_at
      ) ORDER BY n.created_at DESC)
      FROM (
        SELECT id, type, title, created_at, read_at
        FROM public.portal_notifications
        WHERE bl_id = p_bl_id
        ORDER BY created_at DESC
        LIMIT 10
      ) n
    ), '[]'::JSONB),
    'open_disputes', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', d.id,
        'doc_number', d.doc_number,
        'dispute_status', d.dispute_status
      ) ORDER BY d.id DESC)
      FROM public.demurrage_invoices d
      WHERE d.bl_id = p_bl_id
        AND d.dispute_open = true
    ), '[]'::JSONB)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.trg_sync_bl_weight_cargo_mode()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_has_cntr boolean;
  v_has_bb boolean;
  v_new_mode text;
  v_old_mode text := COALESCE(OLD.cargo_mode, 'container');
  v_old_rank integer;
  v_new_rank integer;
  v_financial_status text := COALESCE(OLD.financial_status, 'pending');
  v_replacement boolean := COALESCE(current_setting('vela.breakbulk_import_replacement', true), 'off') = 'on';
  v_weight_decreased boolean := false;
  v_weight_increased boolean := false;
BEGIN
  IF TG_OP = 'UPDATE' AND (
    NEW.id IS DISTINCT FROM OLD.id OR
    NEW.voyage_id IS DISTINCT FROM OLD.voyage_id OR
    NEW.customer_id IS DISTINCT FROM OLD.customer_id
  ) THEN
    NEW.charge_status := 'not_calculated';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.bl_containers WHERE bl_id = NEW.id
  ) INTO v_has_cntr;

  -- A8: ver comentario em _recalculate_bl_cargo_mode.
  v_has_bb := (
    COALESCE(NEW.bb_weight_ton, 0) > 0 OR
    COALESCE(NEW.bb_packages_qty, 0) > 0 OR
    COALESCE(NEW.bb_machine_qty, 0) > 0 OR
    COALESCE(NEW.bb_cbm, 0) > 0 OR
    EXISTS (SELECT 1 FROM public.bl_breakbulk_items WHERE bl_id = NEW.id)
  );

  IF TG_OP = 'INSERT' AND NOT v_has_cntr AND NOT v_has_bb THEN
    NEW.cargo_mode := COALESCE(NULLIF(btrim(NEW.cargo_mode), ''), 'container');
    NEW.charge_status := COALESCE(NEW.charge_status, 'not_calculated');
    RETURN NEW;
  END IF;

  v_new_mode := CASE
    WHEN v_has_cntr AND v_has_bb THEN 'misto'
    WHEN v_has_bb THEN 'carga_solta'
    ELSE 'container'
  END;
  v_old_rank := CASE v_old_mode WHEN 'misto' THEN 2 WHEN 'carga_solta' THEN 1 ELSE 0 END;
  v_new_rank := CASE v_new_mode WHEN 'misto' THEN 2 WHEN 'carga_solta' THEN 1 ELSE 0 END;

  IF TG_OP = 'UPDATE'
     AND v_financial_status IN ('invoiced', 'paid')
     AND v_old_rank > v_new_rank
     AND NOT v_replacement THEN
    RAISE EXCEPTION
      'B/L % já foi faturado (situação financeira: %); remover conteúdo exige estorno/refaturamento.',
      NEW.id, public._financial_status_label(v_financial_status)
      USING ERRCODE = 'P0003';
  END IF;

  IF TG_OP = 'UPDATE' AND v_financial_status IN ('invoiced', 'paid')
     AND COALESCE(NEW.financial_status, 'pending') = 'pending' THEN
    NEW.financial_status := OLD.financial_status;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.cargo_mode IS DISTINCT FROM v_new_mode THEN
    NEW.charge_status := 'not_calculated';
  ELSE
    NEW.charge_status := COALESCE(NEW.charge_status, 'not_calculated');
  END IF;

  IF TG_OP = 'UPDATE' AND v_financial_status IN ('invoiced', 'paid') THEN
    IF v_new_rank > v_old_rank THEN
      NEW.review_status := 'pending_review';
      NEW.billing_hold_reason := 'Carga adicionada após faturamento; revisar e refaturar.';
    ELSIF (OLD.bb_weight_ton IS DISTINCT FROM NEW.bb_weight_ton)
       OR (OLD.total_weight_kg IS DISTINCT FROM NEW.total_weight_kg)
       OR (OLD.bb_packages_qty IS DISTINCT FROM NEW.bb_packages_qty) THEN
      v_weight_decreased := (
        COALESCE(NEW.bb_weight_ton, 0) < COALESCE(OLD.bb_weight_ton, 0) OR
        COALESCE(NEW.total_weight_kg, 0) < COALESCE(OLD.total_weight_kg, 0) OR
        COALESCE(NEW.bb_packages_qty, 0) < COALESCE(OLD.bb_packages_qty, 0)
      );
      v_weight_increased := (
        COALESCE(NEW.bb_weight_ton, 0) > COALESCE(OLD.bb_weight_ton, 0) OR
        COALESCE(NEW.total_weight_kg, 0) > COALESCE(OLD.total_weight_kg, 0) OR
        COALESCE(NEW.bb_packages_qty, 0) > COALESCE(OLD.bb_packages_qty, 0)
      );
      IF v_weight_decreased THEN
        NEW.review_status := 'pending_review';
        NEW.billing_hold_reason := 'Carga reduzida após faturamento; estorno/refaturamento necessário.';
        NEW.charge_status := 'not_calculated';
      ELSIF v_weight_increased THEN
        NEW.review_status := 'pending_review';
        NEW.billing_hold_reason := 'Carga adicionada após faturamento; revisar e refaturar.';
        NEW.charge_status := 'not_calculated';
      END IF;
    END IF;
  END IF;

  NEW.cargo_mode := v_new_mode;
  RETURN NEW;
END;
$function$;
