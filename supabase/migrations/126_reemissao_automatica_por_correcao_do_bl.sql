-- 126: reemissão automática quando a correção do B/L muda a base faturada
-- (ADR 0077, decisão do dono em 2026-10-01).
--
-- Reimportação do B/L com override ou flags do Baplie que alteram a base
-- faturada de um B/L com fatura de Taxas Locais viva e sem pagamento:
--   1. cancela a individual do B/L e a consolidada que cobre o recebível dele;
--   2. recalcula e reemite a individual pelo mesmo núcleo da emissão
--      automática do CE (`_auto_bill_bl_core`), com as mesmas travas;
--   3. recria a consolidada com os mesmos recebíveis.
-- A reemissão aponta para a cancelada (`replaces_invoice_id`, 122). Se uma
-- trava impedir a emissão (Portal não pronto, revisão de cálculo, isenção),
-- as faturas ficam em Reemissão pendente e o alerta Fatura desatualizada
-- explica o motivo. Com pagamento ou correção registrada, nada é cancelado:
-- segue o alerta com o caminho da avulsa/correção (124).
--
-- Também: o recálculo depois de um cancelamento deixa de esbarrar nos itens
-- da fatura cancelada (FK de invoice_items), e o cancelamento manual de uma individual cujo recebível está numa
-- consolidada aberta passa a ser recusado (a consolidada continuaria cobrando
-- o valor antigo e o B/L poderia ser faturado duas vezes).
--
-- Não reescreve nem apaga linhas existentes.

-- ---------------------------------------------------------------------------
-- 1. Núcleo do cancelamento sem checagem de papel, para o fluxo automático
-- ---------------------------------------------------------------------------
-- Corpo da cancel_invoice (052) sem a permissão do chamador; quem chama
-- (cancel_invoice e a reemissão automática) já validou o ator.
CREATE OR REPLACE FUNCTION public._cancel_invoice_core(
  p_invoice_id bigint,
  p_reason text,
  p_actor uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_invoice record;
  v_payment_count integer;
BEGIN
  IF NULLIF(TRIM(COALESCE(p_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Informe a justificativa para cancelar a invoice.'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_invoice
  FROM public.invoices
  WHERE id = p_invoice_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice % nao encontrada.', p_invoice_id USING ERRCODE = 'P0002';
  END IF;

  IF COALESCE(v_invoice.status, 'issued') = 'cancelled' THEN
    RETURN jsonb_build_object('invoice_id', p_invoice_id, 'status', 'cancelled', 'changed', false);
  END IF;

  SELECT COUNT(*) INTO v_payment_count
  FROM public.payments
  WHERE invoice_id = p_invoice_id;

  IF v_payment_count > 0 THEN
    RAISE EXCEPTION 'Nao e permitido cancelar invoice com pagamentos registrados.'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.invoices
  SET
    status = 'cancelled',
    cancelled_at = now(),
    cancelled_by = p_actor,
    cancel_reason = TRIM(p_reason),
    balance_brl = GREATEST(COALESCE(total_brl, 0) - COALESCE(total_paid_brl, 0), 0)
  WHERE id = p_invoice_id;

  UPDATE public.billing_batches
  SET status = 'cancelled'
  WHERE invoice_id = p_invoice_id;

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
    WHEN EXISTS (
      SELECT 1
      FROM public.invoice_bls AS ib3
      JOIN public.invoices AS inv3 ON inv3.id = ib3.invoice_id
      WHERE ib3.bl_id = b.id
        AND inv3.id <> p_invoice_id
        AND COALESCE(inv3.status, 'issued') = 'paid'
    ) THEN 'paid'
    ELSE 'pending'
  END
  WHERE b.id IN (
    SELECT ib.bl_id
    FROM public.invoice_bls AS ib
    WHERE ib.invoice_id = p_invoice_id
  );

  UPDATE public.granite_bls AS gb
  SET charge_status = CASE
    WHEN EXISTS (
      SELECT 1
      FROM public.invoice_granite_bls AS igb2
      JOIN public.invoices AS inv2 ON inv2.id = igb2.invoice_id
      WHERE igb2.granite_bl_id = gb.id
        AND inv2.id <> p_invoice_id
        AND COALESCE(inv2.status, 'issued') IN ('draft', 'issued', 'partially_paid', 'overdue', 'paid')
    ) THEN 'invoiced'
    ELSE 'ready_for_billing'
  END
  WHERE gb.id IN (
    SELECT igb.granite_bl_id
    FROM public.invoice_granite_bls AS igb
    WHERE igb.invoice_id = p_invoice_id
  );

  INSERT INTO public.audit_logs(
    entity_type, entity_id, field_name, old_value, new_value,
    changed_by, changed_at, justification
  ) VALUES (
    'invoice', p_invoice_id::text, 'cancel_invoice',
    COALESCE(v_invoice.status, 'issued'), 'cancelled', p_actor, now(),
    TRIM(p_reason)
  );

  RETURN jsonb_build_object('invoice_id', p_invoice_id, 'status', 'cancelled', 'changed', true);
END;
$$;
REVOKE ALL ON FUNCTION public._cancel_invoice_core(bigint, text, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.cancel_invoice(
  p_invoice_id bigint,
  p_reason text,
  p_actor uuid DEFAULT NULL::uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_effect_consumer boolean := auth.role() = 'service_role'
    AND current_setting('import_effects.consumer', true) = 'vehicle_followup';
  v_consolidated text;
BEGIN
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
$$;
REVOKE ALL ON FUNCTION public.cancel_invoice(bigint, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_invoice(bigint, text, uuid) TO authenticated, service_role;

-- cancel_invoice_for_reissue cancela a consolidada antes das individuais
-- marcadas, então a trava acima não a impede. Para a individual sozinha, a
-- 125 já recusa com a mesma orientação.

-- ---------------------------------------------------------------------------
-- 1b. Recálculo depois do cancelamento
-- ---------------------------------------------------------------------------
-- O recálculo apaga as linhas automáticas do B/L, mas os itens da fatura
-- cancelada ainda as referenciavam e a FK abortava o recálculo que a própria
-- mensagem de bloqueio manda fazer ("Cancele e reemita"). O item cancelado
-- guarda descrição, valores e snapshot; perde só o ponteiro. Fatura viva
-- continua protegida pela FK.
CREATE OR REPLACE FUNCTION public.detach_cancelled_invoice_items_from_calculation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE public.invoice_items ii
     SET charge_calculation_id = NULL
    FROM public.invoices i
   WHERE ii.charge_calculation_id = OLD.id
     AND i.id = ii.invoice_id
     AND i.status = 'cancelled';
  RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION public.detach_cancelled_invoice_items_from_calculation() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS detach_cancelled_invoice_items_from_calculation ON public.charge_calculations;
CREATE TRIGGER detach_cancelled_invoice_items_from_calculation BEFORE DELETE ON public.charge_calculations
  FOR EACH ROW EXECUTE FUNCTION public.detach_cancelled_invoice_items_from_calculation();

-- ---------------------------------------------------------------------------
-- 2. Reemissão automática por B/L
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.auto_reissue_invoices_for_bl(p_bl_id text, p_source text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_bl_id text := upper(btrim(p_bl_id));
  v_reason text;
  v_invoices bigint[];
  v_consolidated record;
  v_consolidated_list jsonb := '[]'::jsonb;
  v_item jsonb;
  v_bill jsonb;
  v_reissued jsonb := '[]'::jsonb;
  v_new jsonb;
  v_individual_ok boolean;
  v_pending_reason text;
  v_id bigint;
BEGIN
  IF v_actor IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa.' USING ERRCODE = '42501';
  END IF;

  v_reason := CASE p_source
    WHEN 'baplie_correction' THEN 'Reemissao automatica: flags do Baplie alteraram a base faturada do B/L ' || v_bl_id
    ELSE 'Reemissao automatica: reimportacao alterou a base faturada do B/L ' || v_bl_id
  END;

  -- Faturas de Taxas Locais vivas que cobram este B/L: a individual (invoice_bls)
  -- e qualquer consolidada sobre o recebível dele.
  SELECT COALESCE(ARRAY_AGG(DISTINCT inv.id ORDER BY inv.id), ARRAY[]::bigint[]) INTO v_invoices
  FROM public.invoices inv
  WHERE inv.invoice_type IN ('individual', 'consolidated')
    AND COALESCE(inv.status, 'issued') IN ('draft', 'issued', 'overdue', 'partially_paid', 'paid')
    AND (
      EXISTS (SELECT 1 FROM public.invoice_bls ib WHERE ib.invoice_id = inv.id AND ib.bl_id = v_bl_id)
      OR EXISTS (SELECT 1 FROM public.invoice_receivable_links l WHERE l.invoice_id = inv.id AND l.bl_id = v_bl_id
        AND l.status IN ('active', 'settled_by_this_invoice'))
    );

  IF COALESCE(ARRAY_LENGTH(v_invoices, 1), 0) = 0 THEN
    RETURN jsonb_build_object('status', 'no_invoice', 'bl_id', v_bl_id);
  END IF;

  -- Dinheiro recebido ou correção registrada: a fatura não é cancelada.
  IF EXISTS (SELECT 1 FROM public.payments p WHERE p.invoice_id = ANY(v_invoices))
     OR EXISTS (SELECT 1 FROM public.invoices i WHERE i.id = ANY(v_invoices) AND i.status IN ('partially_paid', 'paid'))
     OR EXISTS (SELECT 1 FROM public.invoice_corrections c JOIN public.bl_receivables br ON br.id = c.receivable_id
                WHERE br.bl_id = v_bl_id) THEN
    PERFORM public.alert_stale_invoice_for_bl(v_bl_id, p_source);
    RETURN jsonb_build_object('status', 'has_payment', 'bl_id', v_bl_id, 'invoice_ids', to_jsonb(v_invoices));
  END IF;

  -- Consolidadas primeiro: guardam os recebíveis para a recriação.
  FOR v_consolidated IN
    SELECT inv.id, inv.customer_id,
      (SELECT ARRAY_AGG(l.receivable_id ORDER BY l.receivable_id) FROM public.invoice_receivable_links l WHERE l.invoice_id = inv.id) AS receivable_ids
    FROM public.invoices inv
    WHERE inv.id = ANY(v_invoices) AND inv.invoice_type = 'consolidated'
    ORDER BY inv.id
  LOOP
    PERFORM public._cancel_invoice_core(v_consolidated.id, v_reason, v_actor);
    UPDATE public.invoices SET reissue_requested_at = now() WHERE id = v_consolidated.id;
    v_consolidated_list := v_consolidated_list || jsonb_build_object(
      'invoice_id', v_consolidated.id, 'customer_id', v_consolidated.customer_id,
      'receivable_ids', to_jsonb(v_consolidated.receivable_ids));
  END LOOP;

  FOR v_id IN SELECT unnest(v_invoices) LOOP
    IF EXISTS (SELECT 1 FROM public.invoices WHERE id = v_id AND invoice_type = 'individual') THEN
      PERFORM public._cancel_invoice_core(v_id, v_reason, v_actor);
      UPDATE public.invoices SET reissue_requested_at = now() WHERE id = v_id;
    END IF;
  END LOOP;

  -- A mutação de carga em B/L faturado (062) marca "revisar e refaturar".
  -- Com override confirmado na reimportação, a reemissão é esse refaturamento:
  -- a marca sai quando não há pendência real de revisão; senão, fica pendente.
  -- ponytail: reconhece a marca pelo texto gravado pela 062; se essa função
  -- ganhar um código próprio para o motivo, comparar pelo código.
  UPDATE public.bls
     SET review_status = 'ok', billing_hold_reason = NULL
   WHERE id = v_bl_id
     AND review_status = 'pending_review'
     AND billing_hold_reason LIKE 'Carga % após faturamento;%'
     AND COALESCE(cardinality(public.compute_bl_review_pendencies(v_bl_id)), 0) = 0;

  -- Recalcula e emite como a emissão automática do CE; travas não abortam a
  -- importação, deixam a Reemissão pendente.
  v_bill := public._auto_bill_bl_core(v_bl_id, v_actor, false);
  v_individual_ok := v_bill->>'status' = 'invoiced';
  IF v_individual_ok THEN
    v_reissued := v_reissued || jsonb_build_object('type', 'individual', 'invoice_id', (v_bill->'invoice'->>'invoice_id')::bigint);
  ELSE
    v_pending_reason := COALESCE(v_bill->>'reason', v_bill->>'status')
      || COALESCE(': ' || NULLIF(v_bill->>'message', ''), '');
  END IF;

  IF v_individual_ok THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(v_consolidated_list) LOOP
      BEGIN
        v_new := public.create_local_consolidated_invoice_core(
          (v_item->>'customer_id')::bigint,
          ARRAY(SELECT jsonb_array_elements_text(v_item->'receivable_ids')::bigint),
          v_actor, 'internal');
        v_reissued := v_reissued || jsonb_build_object('type', 'consolidated', 'invoice_id', (v_new->>'invoice_id')::bigint);
      EXCEPTION WHEN OTHERS THEN
        v_pending_reason := COALESCE(v_pending_reason, 'consolidada: ' || SQLERRM);
      END;
    END LOOP;
  END IF;

  IF v_pending_reason IS NOT NULL THEN
    -- A fatura cancelada some do Portal; o alerta aponta para ela e resolve
    -- sozinho quando a reemissão vier (resolve_stale_invoice_on_reissue).
    FOR v_id IN
      SELECT inv.id FROM public.invoices inv
      WHERE inv.id = ANY(v_invoices)
        AND NOT EXISTS (SELECT 1 FROM public.invoices s WHERE s.replaces_invoice_id = inv.id)
    LOOP
      PERFORM public.upsert_alert_item('fatura_desatualizada', 'invoice', v_id::text,
        'Fatura cancelada para reemissao automatica do B/L ' || v_bl_id || ', mas a nova emissao nao saiu (' || v_pending_reason
          || '). Resolva o motivo e emita a fatura; ela segue em Reemissao pendente.',
        p_source, 'administrativo',
        jsonb_build_object('bl_id', v_bl_id, 'invoice_id', v_id, 'auto_reissue', 'pending', 'reason', v_pending_reason),
        '/taxas-locais?invoice=' || v_id);
    END LOOP;
  END IF;

  INSERT INTO public.audit_logs(entity_type, entity_id, field_name, new_value, changed_by, justification)
  VALUES ('bl', v_bl_id, 'auto_reissue_invoices',
    jsonb_build_object('cancelled', to_jsonb(v_invoices), 'reissued', v_reissued, 'pending_reason', v_pending_reason)::text,
    v_actor, v_reason);

  RETURN jsonb_build_object(
    'status', CASE WHEN v_pending_reason IS NULL THEN 'reissued' ELSE 'pending' END,
    'bl_id', v_bl_id,
    'cancelled_invoice_ids', to_jsonb(v_invoices),
    'reissued', v_reissued,
    'pending_reason', v_pending_reason
  );
END;
$$;
REVOKE ALL ON FUNCTION public.auto_reissue_invoices_for_bl(text, text) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Reimportação: reemite em vez de só alertar
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.import_bl_freight_transactional(p_bls jsonb, p_changed_by uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_before jsonb := '{}'::jsonb; v_item jsonb; v_id text; v_result jsonb; v_reissues jsonb := '[]'::jsonb;
  v_previous text := current_setting('vela.invoice_correction_import', true);
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR p_changed_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa.' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_bls) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Payload de B/L invalido.' USING ERRCODE = '22023';
  END IF;
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_bls) LOOP
    v_id := upper(btrim(coalesce(v_item->>'bl_id', v_item->>'id')));
    IF v_id IS NOT NULL THEN v_before := v_before || jsonb_build_object(v_id, public.bl_invoice_basis_snapshot(v_id)); END IF;
  END LOOP;
  PERFORM set_config('vela.invoice_correction_import', 'on', true);
  v_result := public._import_bl_freight_before_invoice_alert_123(p_bls, p_changed_by);
  PERFORM set_config('vela.invoice_correction_import', coalesce(v_previous, 'off'), true);
  FOR v_id IN SELECT jsonb_object_keys(v_before) LOOP
    IF v_before->v_id IS DISTINCT FROM 'null'::jsonb AND v_before->v_id IS DISTINCT FROM public.bl_invoice_basis_snapshot(v_id) THEN
      v_reissues := v_reissues || public.auto_reissue_invoices_for_bl(v_id, 'bl_reimport_correction');
    END IF;
  END LOOP;
  IF jsonb_typeof(v_result) = 'object' THEN
    RETURN v_result || jsonb_build_object('invoice_reissues', v_reissues);
  END IF;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.import_bl_freight_transactional(jsonb, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_bl_freight_transactional(jsonb, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. Baplie: mesmo tratamento para os B/Ls faturados da viagem
-- ---------------------------------------------------------------------------
ALTER FUNCTION public.apply_baplie_physical_flags_atomic(bigint, jsonb, uuid)
  RENAME TO _apply_baplie_physical_flags_before_reissue_126;
REVOKE ALL ON FUNCTION public._apply_baplie_physical_flags_before_reissue_126(bigint, jsonb, uuid) FROM PUBLIC, anon, authenticated;

-- ponytail: wrapper mantém a função do Baplie intacta; o snapshot cobre só os
-- B/Ls da viagem com fatura local viva, que são os únicos a reemitir.
CREATE FUNCTION public.apply_baplie_physical_flags_atomic(p_voyage_id bigint, p_changes jsonb, p_changed_by uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_before jsonb := '{}'::jsonb; v_id text; v_result jsonb; v_reissues jsonb := '[]'::jsonb;
  v_previous text := current_setting('vela.invoice_correction_import', true);
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR p_changed_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa.' USING ERRCODE = '42501';
  END IF;
  FOR v_id IN
    SELECT DISTINCT b.id FROM public.bls b
    WHERE b.voyage_id = p_voyage_id
      AND EXISTS (
        SELECT 1 FROM public.invoices inv
        WHERE inv.invoice_type IN ('individual', 'consolidated')
          AND COALESCE(inv.status, 'issued') IN ('draft', 'issued', 'overdue', 'partially_paid', 'paid')
          AND (EXISTS (SELECT 1 FROM public.invoice_bls ib WHERE ib.invoice_id = inv.id AND ib.bl_id = b.id)
            OR EXISTS (SELECT 1 FROM public.invoice_receivable_links l WHERE l.invoice_id = inv.id AND l.bl_id = b.id)))
  LOOP
    v_before := v_before || jsonb_build_object(v_id, public.bl_invoice_basis_snapshot(v_id));
  END LOOP;
  PERFORM set_config('vela.invoice_correction_import', 'on', true);
  v_result := public._apply_baplie_physical_flags_before_reissue_126(p_voyage_id, p_changes, p_changed_by);
  PERFORM set_config('vela.invoice_correction_import', coalesce(v_previous, 'off'), true);
  FOR v_id IN SELECT jsonb_object_keys(v_before) LOOP
    IF v_before->v_id IS DISTINCT FROM public.bl_invoice_basis_snapshot(v_id) THEN
      v_reissues := v_reissues || public.auto_reissue_invoices_for_bl(v_id, 'baplie_correction');
    END IF;
  END LOOP;
  IF jsonb_typeof(v_result) = 'object' THEN
    RETURN v_result || jsonb_build_object('invoice_reissues', v_reissues);
  END IF;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.apply_baplie_physical_flags_atomic(bigint, jsonb, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_baplie_physical_flags_atomic(bigint, jsonb, uuid) TO authenticated;
