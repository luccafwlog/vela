-- Data status: a atualização da projeção Pix existente depende da afirmação do AGENTS.md.
-- Totais, itens e recebimentos históricos permanecem intactos.
-- Corrige F1–F6 da revisão da PR 839. Não altera snapshots monetários emitidos.
-- Histórico de cobranças locais não equivale ao cancelamento de uma cobrança bancária.
BEGIN;
ALTER TABLE public.invoice_refunds ADD COLUMN correction_receivable_id bigint REFERENCES public.bl_receivables(id);
ALTER TABLE public.cod_adjustments ADD COLUMN applied_correction_id bigint REFERENCES public.invoice_corrections(id);
CREATE INDEX invoice_refunds_correction_receivable ON public.invoice_refunds(correction_receivable_id);

CREATE TABLE public.local_pix_charge_versions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  invoice_id bigint NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  txid text NOT NULL,
  amount_brl numeric(14,2) NOT NULL CHECK (amount_brl > 0),
  payload text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (invoice_id, txid)
);
CREATE INDEX local_pix_charge_versions_txid ON public.local_pix_charge_versions(txid);
ALTER TABLE public.local_pix_charge_versions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.local_pix_charge_versions FROM anon, authenticated;
-- Guarda cobranças existentes antes de mudar a projeção. Não reescreve faturas.
INSERT INTO public.local_pix_charge_versions(invoice_id, txid, amount_brl, payload)
SELECT id, left(upper(regexp_replace(invoice_number, '[^A-Za-z0-9]', '', 'g')), 25), total_brl, pix_payload
FROM public.invoices WHERE invoice_type IN ('individual', 'consolidated')
AND pix_payload IS NOT NULL AND total_brl > 0 AND invoice_number IS NOT NULL;

CREATE OR REPLACE FUNCTION public.populate_local_invoice_pix_payload() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_txid text;
BEGIN
  IF NEW.invoice_type = 'manual' THEN
    IF NEW.pix_payload IS NULL AND NEW.total_brl > 0 THEN
      NEW.pix_payload := public.build_transshipping_pix_payload(NEW.total_brl, NEW.invoice_number);
    END IF;
    RETURN NEW;
  END IF;
  IF coalesce(NEW.invoice_type, 'individual') NOT IN ('individual', 'consolidated') THEN RETURN NEW; END IF;
  IF coalesce(NEW.status, 'issued') NOT IN ('issued', 'partially_paid', 'overdue') OR coalesce(NEW.balance_brl, NEW.total_brl, 0) <= 0 THEN
    NEW.pix_payload := NULL;
  ELSIF TG_OP = 'INSERT' THEN
    NEW.pix_payload := coalesce(NEW.pix_payload, public.build_transshipping_pix_payload(coalesce(NEW.balance_brl, NEW.total_brl), NEW.invoice_number));
  ELSIF NEW.balance_brl IS DISTINCT FROM OLD.balance_brl OR NEW.status IS DISTINCT FROM OLD.status
      OR NEW.pix_payload IS NULL OR NEW.invoice_number IS DISTINCT FROM OLD.invoice_number THEN
    -- Cada apresentação tem identidade própria; pix_txid continua sendo o TXID recebido.
    v_txid := CASE WHEN NOT EXISTS (SELECT 1 FROM public.local_pix_charge_versions WHERE invoice_id = NEW.id)
      THEN left(upper(regexp_replace(NEW.invoice_number, '[^A-Za-z0-9]', '', 'g')), 25)
      ELSE 'VP' || upper(substr(md5(NEW.id::text || clock_timestamp()::text || random()::text), 1, 23)) END;
    NEW.pix_payload := public.build_transshipping_pix_payload(coalesce(NEW.balance_brl, NEW.total_brl), v_txid);
    INSERT INTO public.local_pix_charge_versions(invoice_id, txid, amount_brl, payload)
      VALUES (NEW.id, v_txid, coalesce(NEW.balance_brl, NEW.total_brl), NEW.pix_payload);
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER trg_populate_local_invoice_pix_payload ON public.invoices;
CREATE TRIGGER trg_populate_local_invoice_pix_payload BEFORE INSERT OR UPDATE OF invoice_number, total_brl, balance_brl, status, invoice_type, pix_payload
ON public.invoices FOR EACH ROW EXECUTE FUNCTION public.populate_local_invoice_pix_payload();
CREATE FUNCTION public.capture_initial_local_pix_charge() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.invoice_type IN ('individual', 'consolidated') AND NEW.pix_payload IS NOT NULL THEN
    INSERT INTO public.local_pix_charge_versions(invoice_id, txid, amount_brl, payload)
    VALUES (NEW.id, left(upper(regexp_replace(NEW.invoice_number, '[^A-Za-z0-9]', '', 'g')), 25), coalesce(NEW.balance_brl, NEW.total_brl), NEW.pix_payload)
    ON CONFLICT (invoice_id, txid) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.capture_initial_local_pix_charge() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER capture_initial_local_pix_charge AFTER INSERT ON public.invoices FOR EACH ROW EXECUTE FUNCTION public.capture_initial_local_pix_charge();

CREATE OR REPLACE FUNCTION public._register_invoice_correction_core(
  p_invoice_id bigint, p_receivable_id bigint, p_corrected_total_brl numeric, p_reason text, p_actor uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_invoice record; v_receivable record; v_difference numeric; v_offset numeric;
  v_refund numeric; v_refund_id bigint; v_id bigint; v_link record; v_balance numeric; v_available numeric;
BEGIN
  SELECT * INTO v_invoice FROM public.invoices WHERE id = p_invoice_id FOR UPDATE;
  SELECT * INTO v_receivable FROM public.bl_receivables WHERE id = p_receivable_id FOR UPDATE;
  PERFORM 1 FROM public.invoices WHERE id IN
    (SELECT invoice_id FROM public.ledger_settlements WHERE receivable_id = p_receivable_id)
    ORDER BY id FOR UPDATE;
  v_difference := round(v_receivable.original_amount_brl - v_receivable.correction_amount_brl - p_corrected_total_brl, 2);
  IF v_difference <= 0 THEN
    RAISE EXCEPTION 'Correcao exige valor menor que a cobranca vigente.' USING ERRCODE = '22023';
  END IF;
  v_offset := least(v_difference, v_receivable.balance_brl);
  v_refund := v_difference - v_offset;
  IF v_refund > 0 THEN
    -- Restitua somente recebimentos que financiaram este recebível. Uma
    -- consolidada pode conter outros B/Ls e não pode emprestar seu pagamento.
    v_available := v_refund;
    FOR v_link IN
      SELECT s.invoice_id, sum(s.amount_brl) - coalesce((SELECT sum(r.amount_brl)
        FROM public.invoice_refunds r WHERE r.invoice_id = s.invoice_id AND r.status <> 'cancelled'
        AND (r.correction_receivable_id = p_receivable_id
          OR (r.correction_receivable_id IS NULL AND r.origin = 'correction')
          OR EXISTS (SELECT 1 FROM public.cod_adjustments ca WHERE ca.id = r.cod_adjustment_id AND ca.bl_id = v_receivable.bl_id))), 0) AS available
      FROM public.ledger_settlements s WHERE s.receivable_id = p_receivable_id
      GROUP BY s.invoice_id ORDER BY s.invoice_id
    LOOP
      PERFORM 1 FROM public.invoices WHERE id = v_link.invoice_id FOR UPDATE;
      SELECT coalesce(i.total_paid_brl, 0) - coalesce((SELECT sum(r.amount_brl) FROM public.invoice_refunds r
        WHERE r.invoice_id = i.id AND r.status <> 'cancelled'), 0) INTO v_balance FROM public.invoices i WHERE i.id = v_link.invoice_id;
      -- Overpayments never funded a settlement. They reduce cash available at
      -- invoice level, not the receivable's allocated principal.
      v_balance := least(v_available, greatest(v_link.available, 0), greatest(v_balance, 0));
      IF v_balance > 0 THEN
        INSERT INTO public.invoice_refunds(invoice_id, amount_brl, origin, notes, registered_by, correction_receivable_id)
          VALUES (v_link.invoice_id, v_balance, 'correction', btrim(p_reason), p_actor, p_receivable_id)
          RETURNING id INTO v_refund_id;
        v_available := v_available - v_balance;
      END IF;
      EXIT WHEN v_available = 0;
    END LOOP;
    IF v_available > 0 THEN
      RAISE EXCEPTION 'Restituicao excede os recebimentos disponiveis do recebivel (%).', v_available USING ERRCODE = '22023';
    END IF;
  END IF;
  INSERT INTO public.invoice_corrections(invoice_id, receivable_id, amount_brl, offset_brl, refund_brl,
    corrected_total_brl, reason, created_by) VALUES (p_invoice_id, p_receivable_id, v_difference, v_offset,
    v_refund, round(p_corrected_total_brl, 2), btrim(p_reason), p_actor) RETURNING id INTO v_id;
  UPDATE public.bl_receivables SET correction_amount_brl = correction_amount_brl + v_difference,
    updated_at = now() WHERE id = p_receivable_id;
  -- Fatura que zera sem ter recebido nada fica coberta pela que recebeu.
  FOR v_link IN SELECT DISTINCT i.id FROM public.invoices i JOIN public.invoice_receivable_links l ON l.invoice_id = i.id
    WHERE l.receivable_id = p_receivable_id AND i.status IN ('issued', 'overdue', 'partially_paid', 'paid') ORDER BY i.id
  LOOP
    SELECT coalesce(sum(br.balance_brl), 0) INTO v_balance FROM public.invoice_receivable_links l
      JOIN public.bl_receivables br ON br.id = l.receivable_id WHERE l.invoice_id = v_link.id
      AND l.status IN ('active', 'settled_by_this_invoice');
    UPDATE public.invoices SET balance_brl = v_balance,
      status = CASE WHEN v_balance = 0 AND coalesce(total_paid_brl, 0) = 0 AND id <> p_invoice_id THEN 'covered'
        WHEN v_balance = 0 THEN 'paid' WHEN total_paid_brl > 0 THEN 'partially_paid' ELSE status END,
      covered_by_invoice_id = CASE WHEN v_balance = 0 AND coalesce(total_paid_brl, 0) = 0 AND id <> p_invoice_id
        THEN p_invoice_id ELSE covered_by_invoice_id END
      WHERE id = v_link.id;
  END LOOP;
  UPDATE public.invoice_receivable_links SET status = 'settled_by_this_invoice'
    WHERE invoice_id = p_invoice_id AND receivable_id = p_receivable_id AND v_receivable.balance_brl - v_offset = 0;
  UPDATE public.invoice_receivable_links SET status = 'settled_elsewhere'
    WHERE invoice_id <> p_invoice_id AND receivable_id = p_receivable_id AND status = 'active' AND v_receivable.balance_brl - v_offset = 0;
  UPDATE public.bls SET financial_status = 'paid'
    WHERE id = v_receivable.bl_id AND v_receivable.balance_brl - v_offset = 0;
  INSERT INTO public.audit_logs(entity_type, entity_id, field_name, new_value, changed_by, justification)
    VALUES ('invoice', p_invoice_id::text, 'correction', jsonb_build_object('correction_id', v_id,
      'offset_brl', v_offset, 'refund_brl', v_refund, 'refund_id', v_refund_id)::text, p_actor, btrim(p_reason));
  UPDATE public.cod_adjustments SET status = 'settled', applied_correction_id = v_id,
    resulting_document_id = coalesce(v_refund_id, p_invoice_id),
    resulting_document_type = CASE WHEN v_refund_id IS NULL THEN 'invoice' ELSE 'refund' END
    WHERE id = nullif(coalesce(nullif(current_setting('vela.cod_basis_events', true), ''), '{}')::jsonb->>v_receivable.bl_id, '')::bigint
      AND status = 'pending' AND action IN ('refund_overpayment', 'offset_open_balance');
  RETURN jsonb_build_object('correction_id' , v_id, 'offset_brl', v_offset, 'refund_brl', v_refund,
    'refund_id', v_refund_id, 'balance_brl', greatest(v_receivable.balance_brl - v_offset, 0));
END;
$$;
CREATE OR REPLACE FUNCTION public.bl_invoice_basis_snapshot(p_bl_id text) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object(
    'voyage_id', b.voyage_id, 'pod', b.pod, 'cargo_mode', b.cargo_mode, 'customer_id', b.customer_id,
    'bb_weight_ton', b.bb_weight_ton, 'total_weight_kg', b.total_weight_kg, 'movement_to', b.movement_to,
    'cancelled', b.cancelled_at IS NOT NULL,
    'containers', (SELECT coalesce(jsonb_agg(x.c ORDER BY x.c::text), '[]'::jsonb) FROM (
      SELECT jsonb_build_array(upper(btrim(c.container_number)), coalesce(c.is_imo, false), coalesce(c.is_oog, false),
        coalesce(c.ownership, 'COC'), (SELECT coalesce(jsonb_agg(neighbor.bl_id ORDER BY neighbor.bl_id), '[]'::jsonb)
          FROM public.bl_containers neighbor JOIN public.bls nb ON nb.id = neighbor.bl_id
          WHERE upper(btrim(neighbor.container_number)) = upper(btrim(c.container_number))
          AND nb.voyage_id = b.voyage_id AND nb.cancelled_at IS NULL
          AND coalesce(nb.cargo_mode, 'container') IN ('container', 'misto'))) AS c
      FROM public.bl_containers c WHERE c.bl_id = b.id) x),
    'vehicles', (SELECT coalesce(jsonb_agg(v.chassis ORDER BY v.chassis), '[]'::jsonb) FROM public.vehicles v WHERE v.bl_id = b.id))
  FROM public.bls b WHERE b.id = p_bl_id;
$$;
CREATE OR REPLACE FUNCTION public.process_invoice_basis_changes() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_map jsonb; v_changed text[] := ARRAY[]::text[]; v_id text; v_result jsonb := '[]'::jsonb; v_source text;
BEGIN
  IF current_setting('vela.invoice_basis_running', true) = 'on' THEN RETURN '[]'::jsonb; END IF;
  v_map := coalesce(nullif(current_setting('vela.invoice_basis_before', true), ''), '{}')::jsonb;
  IF v_map = '{}'::jsonb THEN RETURN '[]'::jsonb; END IF;
  PERFORM set_config('vela.invoice_basis_before', '{}', true);
  v_source := coalesce(nullif(current_setting('vela.invoice_basis_source', true), ''), 'bl_correction');
  FOR v_id IN SELECT jsonb_object_keys(v_map) ORDER BY 1 LOOP
    IF v_map->v_id IS DISTINCT FROM public.bl_invoice_basis_snapshot(v_id) THEN v_changed := v_changed || v_id; END IF;
  END LOOP;
  IF cardinality(v_changed) = 0 THEN RETURN '[]'::jsonb; END IF;

  PERFORM set_config('vela.invoice_basis_running', 'on', true);
  BEGIN
    v_result := public.apply_invoice_basis_changes(v_changed, v_source);
    DELETE FROM public.invoice_basis_pending_changes WHERE bl_id = ANY(v_changed);
  EXCEPTION WHEN OTHERS THEN
    -- A correção do B/L não é desfeita por falha financeira: o alerta explica.
    FOREACH v_id IN ARRAY v_changed LOOP
      INSERT INTO public.invoice_basis_pending_changes(bl_id, source, error_message, cod_adjustment_id)
        VALUES (v_id, v_source, SQLERRM,
          nullif(coalesce(nullif(current_setting('vela.cod_basis_events', true), ''), '{}')::jsonb->>v_id, '')::bigint) ON CONFLICT (bl_id) DO UPDATE
        SET source = excluded.source, error_message = excluded.error_message,
          cod_adjustment_id = coalesce(excluded.cod_adjustment_id, invoice_basis_pending_changes.cod_adjustment_id), updated_at = now();
      PERFORM public.alert_stale_invoice_for_bl(v_id, v_source);
    END LOOP;
    v_result := jsonb_build_array(jsonb_build_object('status', 'error', 'bl_ids', to_jsonb(v_changed), 'message', SQLERRM));
  END;
  PERFORM set_config('vela.invoice_basis_running', 'off', true);
  RETURN v_result;
END;
$$;

-- A resolução é compartilhada pela prévia e pela baixa, nunca por nome/CNPJ aproximado.
CREATE FUNCTION public.resolve_local_pix_charge(p_txid text)
RETURNS TABLE(invoice_id bigint, charge_invoice_id bigint, expected_brl numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH RECURSIVE versions AS (
    SELECT v.invoice_id, v.amount_brl FROM public.local_pix_charge_versions v
    WHERE v.txid = upper(regexp_replace(coalesce(p_txid, ''), '[^A-Za-z0-9]', '', 'g'))
  ), chain AS (
    SELECT i.id, i.customer_id, i.status, v.invoice_id AS original_id, v.amount_brl, 0 AS depth
    FROM versions v JOIN public.invoices i ON i.id = v.invoice_id
    UNION ALL
    SELECT s.id, s.customer_id, s.status, c.original_id, c.amount_brl, c.depth + 1
    FROM chain c JOIN public.invoices s ON s.replaces_invoice_id = c.id
    JOIN public.invoices original ON original.id = c.original_id
    WHERE c.depth < 100 AND s.customer_id = original.customer_id
    AND (SELECT array_agg(bl_id ORDER BY bl_id) FROM public.invoice_bls WHERE invoice_id = s.id)
      IS NOT DISTINCT FROM (SELECT array_agg(bl_id ORDER BY bl_id) FROM public.invoice_bls WHERE invoice_id = original.id)
  )
  SELECT c.id, c.original_id, c.amount_brl FROM chain c
  WHERE c.status IN ('issued', 'overdue', 'partially_paid')
  AND NOT EXISTS (SELECT 1 FROM public.invoices s WHERE s.replaces_invoice_id = c.id);
$$;
REVOKE ALL ON FUNCTION public.resolve_local_pix_charge(text) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.list_local_pix_candidates(p_txids text[]) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Sem permissao de faturamento.' USING ERRCODE = '42501';
  END IF;
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('txid', t.txid, 'id', i.id,
    'invoice_number', i.invoice_number, 'amount_brl', r.expected_brl,
    'customer', jsonb_build_object('name', c.name, 'cnpj_cpf', c.cnpj_cpf)))
    FROM unnest(p_txids) t(txid) CROSS JOIN LATERAL public.resolve_local_pix_charge(t.txid) r
    JOIN public.invoices i ON i.id = r.invoice_id JOIN public.customers c ON c.id = i.customer_id), '[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.list_local_pix_candidates(text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_local_pix_candidates(text[]) TO authenticated;

ALTER FUNCTION public.reconcile_invoice_payment_by_txid(text, numeric, timestamptz) RENAME TO reconcile_invoice_payment_by_txid_legacy_130;
REVOKE ALL ON FUNCTION public.reconcile_invoice_payment_by_txid_legacy_130(text, numeric, timestamptz) FROM PUBLIC, anon, authenticated;
CREATE FUNCTION public.reconcile_invoice_payment_by_txid(p_txid text, p_amount_brl numeric, p_paid_at timestamptz DEFAULT now()) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_norm text; v_count integer; v_id bigint; v_original bigint; v_expected numeric; v_result jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Sem permissao de faturamento.' USING ERRCODE = '42501';
  END IF;
  v_norm := upper(regexp_replace(coalesce(p_txid, ''), '[^A-Za-z0-9]', '', 'g'));
  PERFORM pg_advisory_xact_lock(hashtextextended('local_pix:' || v_norm, 0));
  IF EXISTS (SELECT 1 FROM public.ledger_settlements WHERE upper(regexp_replace(pix_txid, '[^A-Za-z0-9]', '', 'g')) = v_norm) THEN
    RETURN jsonb_build_object('matched', false, 'reason', 'already_reconciled');
  END IF;
  -- Lock the historical invoice as well as its chain. Cancellation uses the same row locks.
  PERFORM 1 FROM public.invoices WHERE id IN
    (SELECT invoice_id FROM public.local_pix_charge_versions WHERE txid = v_norm) ORDER BY id FOR UPDATE;
  SELECT count(*), min(invoice_id), min(charge_invoice_id), min(expected_brl)
    INTO v_count, v_id, v_original, v_expected FROM public.resolve_local_pix_charge(v_norm);
  IF v_count = 0 THEN
    IF EXISTS (SELECT 1 FROM public.local_pix_charge_versions WHERE txid = v_norm) THEN
      RETURN jsonb_build_object('matched', false, 'reason', 'historical_charge_requires_review');
    END IF;
    RETURN public.reconcile_invoice_payment_by_txid_legacy_130(p_txid, p_amount_brl, p_paid_at);
  ELSIF v_count <> 1 THEN
    RETURN jsonb_build_object('matched', false, 'reason', 'ambiguous');
  END IF;
  PERFORM 1 FROM public.invoices WHERE id = v_id FOR UPDATE;
  -- Revalidate after waiting for a concurrent successor cancellation/payment.
  IF NOT EXISTS (SELECT 1 FROM public.resolve_local_pix_charge(v_norm) WHERE invoice_id = v_id) THEN
    RETURN jsonb_build_object('matched', false, 'reason', 'historical_charge_requires_review');
  END IF;
  IF p_amount_brl IS NULL OR round(p_amount_brl, 2) <> v_expected OR p_amount_brl <> round(p_amount_brl, 2) THEN
    RETURN jsonb_build_object('matched', true, 'invoice_id', v_id, 'settled', false, 'reason', 'charge_amount_mismatch');
  END IF;
  BEGIN
    -- Only this authenticated, exact historical-charge path may use the existing
    -- overpayment allocator. It allocates current balance and creates a refund.
    v_result := public.register_ledger_invoice_payment(v_id, p_amount_brl, 'pix', coalesce(p_paid_at, now()), p_txid,
      'manual', 'Pix de cobranca historica validada; fatura de origem ' || v_original, auth.uid());
    -- The manual allocator may have copied the TXID onto several allocations.
    -- Keep it on one row per payment before entering the unique Pix index.
    UPDATE public.ledger_settlements SET source = 'pix_extract',
      pix_txid = CASE WHEN id = (SELECT min(id) FROM public.ledger_settlements
        WHERE payment_id = (v_result->>'payment_id')::bigint) THEN p_txid ELSE NULL END
      WHERE payment_id = (v_result->>'payment_id')::bigint;
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('matched', true, 'invoice_id', v_id, 'settled', false, 'reason', SQLERRM);
  END;
  UPDATE public.invoices SET pix_txid = p_txid, conciliated_by_extract = true WHERE id = v_id;
  INSERT INTO public.invoice_lifecycle_events(invoice_id, event_type, actor, payload)
  VALUES (v_id, 'reconciled_by_txid', auth.uid(), jsonb_build_object('txid', p_txid, 'amount_brl', p_amount_brl,
    'charge_invoice_id', v_original, 'source', 'pix_extract'));
  RETURN jsonb_build_object('matched', true, 'invoice_id', v_id, 'settled', true, 'payment', v_result);
END;
$$;
REVOKE ALL ON FUNCTION public.reconcile_invoice_payment_by_txid(text, numeric, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reconcile_invoice_payment_by_txid(text, numeric, timestamptz) TO authenticated;

-- COD keeps its operation/audit record but delegates local-ledger money to
-- the basis correction performed at commit. Bind only the event from this call.
ALTER FUNCTION public.apply_cod_financial_effect(text, bigint, text) RENAME TO apply_cod_financial_effect_legacy_130;
REVOKE ALL ON FUNCTION public.apply_cod_financial_effect_legacy_130(text, bigint, text) FROM PUBLIC, anon, authenticated;
CREATE FUNCTION public.apply_cod_financial_effect(p_bl_id text, p_omission_id bigint, p_previous_pod text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_before bigint; v_id bigint; v_map jsonb;
BEGIN
  SELECT coalesce(max(id), 0) INTO v_before FROM public.cod_adjustments WHERE bl_id = p_bl_id;
  PERFORM public.apply_cod_financial_effect_legacy_130(p_bl_id, p_omission_id, p_previous_pod);
  SELECT id INTO v_id FROM public.cod_adjustments WHERE bl_id = p_bl_id AND id > v_before ORDER BY id DESC LIMIT 1;
  IF v_id IS NOT NULL THEN
    v_map := coalesce(nullif(current_setting('vela.cod_basis_events', true), ''), '{}')::jsonb;
    PERFORM set_config('vela.cod_basis_events', (v_map || jsonb_build_object(p_bl_id, v_id))::text, true);
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.apply_cod_financial_effect(text, bigint, text) FROM PUBLIC, anon, authenticated;

ALTER FUNCTION public.settle_cod_adjustment(bigint, uuid, bigint, text) RENAME TO settle_cod_adjustment_legacy_130;
REVOKE ALL ON FUNCTION public.settle_cod_adjustment_legacy_130(bigint, uuid, bigint, text) FROM PUBLIC, anon, authenticated;
CREATE FUNCTION public.settle_cod_adjustment(p_adjustment_id bigint, p_actor uuid DEFAULT NULL, p_resulting_document_id bigint DEFAULT NULL, p_resulting_document_type text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_adjustment record;
BEGIN
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
$$;
REVOKE ALL ON FUNCTION public.settle_cod_adjustment(bigint, uuid, bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.settle_cod_adjustment(bigint, uuid, bigint, text) TO authenticated;

ALTER FUNCTION public.apply_invoice_basis_changes(text[], text) RENAME TO apply_invoice_basis_changes_legacy_130;
REVOKE ALL ON FUNCTION public.apply_invoice_basis_changes_legacy_130(text[], text) FROM PUBLIC, anon, authenticated;
CREATE FUNCTION public.apply_invoice_basis_changes(p_bl_ids text[], p_source text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_result jsonb; v_id bigint;
BEGIN
  v_result := public.apply_invoice_basis_changes_legacy_130(p_bl_ids, p_source);
  -- One alert may represent several B/Ls. Resolve it only if every obligation
  -- now agrees with its current quote and customer; preserve genuine increases.
  FOR v_id IN SELECT DISTINCT l.invoice_id FROM public.invoice_receivable_links l JOIN public.invoices i ON i.id = l.invoice_id
    WHERE l.bl_id = ANY(p_bl_ids) AND i.status IN ('issued', 'overdue', 'partially_paid', 'paid') LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.invoice_receivable_links l JOIN public.bl_receivables r ON r.id = l.receivable_id
      JOIN public.bls b ON b.id = l.bl_id JOIN public.invoices i ON i.id = l.invoice_id
      CROSS JOIN LATERAL public._quote_bl_local_charges(b.id, r.roe_frozen) q
      WHERE l.invoice_id = v_id AND l.status IN ('active', 'settled_by_this_invoice')
      AND (i.customer_id IS DISTINCT FROM b.customer_id OR q->>'status' NOT IN ('ok', 'exempt')
        OR (q->>'total_brl')::numeric IS DISTINCT FROM r.original_amount_brl - r.correction_amount_brl)
    ) THEN
      PERFORM public.resolve_alert_item('fatura_desatualizada', 'invoice', v_id::text, 'basis_agrees', '{}'::jsonb);
    END IF;
  END LOOP;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.apply_invoice_basis_changes(text[], text) FROM PUBLIC, anon, authenticated;

CREATE TABLE public.invoice_basis_pending_changes (
  bl_id text PRIMARY KEY REFERENCES public.bls(id) ON DELETE CASCADE,
  source text NOT NULL,
  error_message text NOT NULL,
  cod_adjustment_id bigint REFERENCES public.cod_adjustments(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.invoice_basis_pending_changes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.invoice_basis_pending_changes FROM anon, authenticated;
CREATE FUNCTION public.retry_invoice_basis_changes(p_bl_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_result jsonb; v_cod_id bigint; v_cod_map jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Sem permissao de faturamento.' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.bls WHERE id = p_bl_id FOR UPDATE;
  SELECT cod_adjustment_id INTO v_cod_id FROM public.invoice_basis_pending_changes WHERE bl_id = p_bl_id FOR UPDATE;
  v_cod_map := coalesce(nullif(current_setting('vela.cod_basis_events', true), ''), '{}')::jsonb;
  IF v_cod_id IS NOT NULL THEN
    PERFORM set_config('vela.cod_basis_events', (v_cod_map || jsonb_build_object(p_bl_id, v_cod_id))::text, true);
  END IF;
  PERFORM set_config('vela.invoice_basis_running', 'on', true);
  v_result := public.apply_invoice_basis_changes(ARRAY[p_bl_id], 'financial_retry');
  DELETE FROM public.invoice_basis_pending_changes WHERE bl_id = p_bl_id;
  PERFORM set_config('vela.cod_basis_events', v_cod_map::text, true);
  PERFORM set_config('vela.invoice_basis_running', 'off', true);
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.retry_invoice_basis_changes(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.retry_invoice_basis_changes(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.capture_invoice_basis() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_bl text; v_numbers text[] := ARRAY[]::text[]; v_bls text[] := ARRAY[]::text[]; v_voyages bigint[] := ARRAY[]::bigint[];
BEGIN
  IF TG_TABLE_NAME = 'bls' THEN
    PERFORM public._capture_invoice_basis(OLD.id);
    SELECT array_agg(upper(btrim(container_number))) INTO v_numbers FROM public.bl_containers WHERE bl_id = OLD.id;
    v_bls := ARRAY[OLD.id];
    v_voyages := ARRAY[OLD.voyage_id, NEW.voyage_id];
  ELSE
    IF TG_OP IN ('UPDATE', 'DELETE') THEN
      PERFORM public._capture_invoice_basis(OLD.bl_id); v_bls := v_bls || OLD.bl_id;
      IF TG_TABLE_NAME = 'bl_containers' THEN v_numbers := v_numbers || upper(btrim(OLD.container_number)); END IF;
    END IF;
    IF TG_OP IN ('UPDATE', 'INSERT') THEN
      PERFORM public._capture_invoice_basis(NEW.bl_id); v_bls := v_bls || NEW.bl_id;
      IF TG_TABLE_NAME = 'bl_containers' THEN v_numbers := v_numbers || upper(btrim(NEW.container_number)); END IF;
    END IF;
  END IF;
  IF cardinality(v_numbers) > 0 THEN
    FOR v_bl IN SELECT DISTINCT n.bl_id FROM public.bl_containers n JOIN public.bls nb ON nb.id = n.bl_id
      WHERE upper(btrim(n.container_number)) = ANY(v_numbers)
      AND (nb.voyage_id IN (SELECT voyage_id FROM public.bls WHERE id = ANY(v_bls))
        OR nb.voyage_id = ANY(v_voyages)) ORDER BY n.bl_id LOOP
      PERFORM public._capture_invoice_basis(v_bl);
    END LOOP;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_payment_reversal_after_correction() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_refunds numeric; v_paid numeric;
BEGIN
  PERFORM 1 FROM public.invoices WHERE id = OLD.invoice_id FOR UPDATE;
  IF EXISTS (
    SELECT 1 FROM public.invoice_refunds r
    WHERE r.invoice_id = OLD.invoice_id AND r.status <> 'cancelled' AND r.correction_receivable_id IS NOT NULL
    GROUP BY r.correction_receivable_id
    HAVING sum(r.amount_brl) > coalesce((SELECT sum(s.amount_brl) FROM public.ledger_settlements s
      WHERE s.invoice_id = OLD.invoice_id AND s.receivable_id = r.correction_receivable_id AND s.payment_id <> OLD.id), 0)
  ) THEN
    RAISE EXCEPTION 'Esta baixa financia restituicao por correcao deste recebivel. Confira a restituicao antes de cancelar a baixa.' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.invoice_corrections WHERE invoice_id = OLD.invoice_id)
     OR EXISTS (SELECT 1 FROM public.invoice_refunds WHERE invoice_id = OLD.invoice_id AND status <> 'cancelled') THEN
    SELECT coalesce(sum(amount_brl), 0) INTO v_refunds FROM public.invoice_refunds WHERE invoice_id = OLD.invoice_id AND status <> 'cancelled';
    SELECT coalesce(sum(amount_brl), 0) INTO v_paid FROM public.payments WHERE invoice_id = OLD.invoice_id AND id <> OLD.id;
    IF v_refunds > v_paid THEN
      RAISE EXCEPTION 'Esta baixa financia restituicao. Confira a restituicao antes de cancelar a baixa.' USING ERRCODE = '22023';
    END IF;
  END IF;
  RETURN OLD;
END;
$$;

ALTER FUNCTION public.get_invoice_correction_summary(bigint) RENAME TO get_invoice_correction_summary_legacy_130;
REVOKE ALL ON FUNCTION public.get_invoice_correction_summary_legacy_130(bigint) FROM PUBLIC, anon, authenticated;
CREATE FUNCTION public.get_invoice_correction_summary(p_invoice_id bigint) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_result jsonb;
BEGIN
  v_result := public.get_invoice_correction_summary_legacy_130(p_invoice_id);
  RETURN v_result || jsonb_build_object('pending_bl_ids', coalesce((SELECT jsonb_agg(p.bl_id ORDER BY p.bl_id)
    FROM public.invoice_basis_pending_changes p WHERE EXISTS
      (SELECT 1 FROM public.invoice_bls ib WHERE ib.invoice_id = p_invoice_id AND ib.bl_id = p.bl_id)), '[]'::jsonb));
END;
$$;
REVOKE ALL ON FUNCTION public.get_invoice_correction_summary(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_invoice_correction_summary(bigint) TO authenticated;
CREATE OR REPLACE FUNCTION public._sync_refund_alert(p_invoice_id bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_pending numeric; v_number text; v_bls text;
BEGIN
  SELECT coalesce(sum(r.amount_brl), 0) INTO v_pending FROM public.invoice_refunds r
  WHERE r.invoice_id = p_invoice_id AND r.status = 'pending';
  IF v_pending > 0 THEN
    SELECT invoice_number INTO v_number FROM public.invoices WHERE id = p_invoice_id;
    SELECT string_agg(DISTINCT br.bl_id, ', ') INTO v_bls FROM public.invoice_refunds r
      JOIN public.bl_receivables br ON br.id = r.correction_receivable_id WHERE r.invoice_id = p_invoice_id;
    PERFORM public.upsert_alert_item('restituicao_pendente', 'invoice', p_invoice_id::text,
      'Restitua R$ ' || to_char(v_pending, 'FM999G999G990D00') || ' ao Cliente: a fatura ' || coalesce(v_number, p_invoice_id::text)
        || ' tem restituicao financeira pendente. Confirme a restituicao quando o dinheiro for devolvido.',
      'invoice_correction', 'administrativo',
      jsonb_build_object('invoice_id', p_invoice_id, 'bl_id', v_bls, 'pending_brl', v_pending),
      '/taxas-locais?invoice=' || p_invoice_id);
  ELSE
    PERFORM public.resolve_alert_item('restituicao_pendente', 'invoice', p_invoice_id::text, 'refund_settled', '{}'::jsonb);
  END IF;
END;
$$;
CREATE OR REPLACE FUNCTION public.sync_refund_alert_on_refund_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM public._sync_refund_alert(NEW.invoice_id);
  RETURN NEW;
END;
$$;

-- Existing issued documents also receive the corrected payable projection.
UPDATE public.invoices SET pix_payload = NULL
WHERE invoice_type IN ('individual', 'consolidated') AND (pix_payload IS NOT NULL OR coalesce(balance_brl, 0) > 0);
COMMIT;
