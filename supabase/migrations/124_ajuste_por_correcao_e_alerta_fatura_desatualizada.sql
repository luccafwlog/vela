-- 124: redução após pagamento abate saldo antes de restituir (ADR 0077).
-- Não reescreve dados existentes. Total/itens emitidos e valores recebidos são preservados.
ALTER TABLE public.bl_receivables ADD COLUMN correction_amount_brl numeric(14,2) NOT NULL DEFAULT 0
  CHECK (correction_amount_brl >= 0 AND correction_amount_brl <= original_amount_brl);
CREATE TABLE public.invoice_corrections (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  invoice_id bigint NOT NULL REFERENCES public.invoices(id),
  receivable_id bigint NOT NULL REFERENCES public.bl_receivables(id),
  amount_brl numeric(14,2) NOT NULL CHECK (amount_brl > 0),
  offset_brl numeric(14,2) NOT NULL CHECK (offset_brl >= 0),
  refund_brl numeric(14,2) NOT NULL CHECK (refund_brl >= 0),
  corrected_total_brl numeric(14,2) NOT NULL CHECK (corrected_total_brl >= 0),
  reason text NOT NULL CHECK (length(btrim(reason)) >= 3),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES auth.users(id),
  CHECK (amount_brl = offset_brl + refund_brl)
);
ALTER TABLE public.invoice_corrections ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.invoice_corrections TO authenticated;
CREATE POLICY invoice_corrections_internal_read ON public.invoice_corrections FOR SELECT TO authenticated
  USING (public.is_active_read_user());

-- Reversão de pagamento e pagamentos seguintes sempre derivam do mesmo saldo.
CREATE FUNCTION public.guard_corrected_receivable_balance() RETURNS trigger LANGUAGE plpgsql
SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.correction_amount_brl > 0 THEN
    NEW.balance_brl := greatest(NEW.original_amount_brl - NEW.settled_amount_brl - NEW.correction_amount_brl, 0);
    NEW.status := CASE WHEN NEW.balance_brl = 0 THEN 'settled'
      WHEN NEW.settled_amount_brl > 0 THEN 'partially_settled' ELSE 'open' END;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_corrected_receivable_balance() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER guard_corrected_receivable_balance BEFORE UPDATE ON public.bl_receivables
  FOR EACH ROW EXECUTE FUNCTION public.guard_corrected_receivable_balance();

CREATE FUNCTION public.register_invoice_correction(
  p_invoice_id bigint, p_receivable_id bigint, p_corrected_total_brl numeric, p_reason text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_invoice record; v_receivable record; v_difference numeric; v_offset numeric;
  v_refund numeric; v_result jsonb; v_id bigint; v_link record; v_balance numeric;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_financeiro_user() THEN
    RAISE EXCEPTION 'Sem permissao para registrar correcao.' USING ERRCODE = '42501';
  END IF;
  IF p_corrected_total_brl IS NULL OR p_corrected_total_brl::text IN ('NaN', 'Infinity', '-Infinity')
    OR p_corrected_total_brl < 0 OR length(btrim(coalesce(p_reason, ''))) < 3 THEN
    RAISE EXCEPTION 'Informe valor corrigido valido e motivo da correcao.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_invoice FROM public.invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND OR v_invoice.invoice_type NOT IN ('individual', 'consolidated')
    OR v_invoice.status NOT IN ('paid', 'partially_paid') OR coalesce(v_invoice.total_paid_brl, 0) <= 0 THEN
    RAISE EXCEPTION 'Correcao exige fatura de Taxas Locais com pagamento.' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.invoice_receivable_links WHERE invoice_id = p_invoice_id
    AND receivable_id = p_receivable_id AND status IN ('active', 'settled_by_this_invoice')) THEN
    RAISE EXCEPTION 'Recebivel nao pertence a esta fatura vigente.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_receivable FROM public.bl_receivables WHERE id = p_receivable_id FOR UPDATE;
  v_difference := round(v_receivable.original_amount_brl - v_receivable.correction_amount_brl - p_corrected_total_brl, 2);
  IF v_difference <= 0 THEN
    RAISE EXCEPTION 'Informe um valor menor que a cobranca vigente; aumentos exigem fatura avulsa.' USING ERRCODE = '22023';
  END IF;
  v_offset := least(v_difference, v_receivable.balance_brl);
  v_refund := v_difference - v_offset;
  IF v_refund > 0 THEN
    v_result := public.register_invoice_correction_refund(p_invoice_id, v_refund, p_reason);
  END IF;
  INSERT INTO public.invoice_corrections(invoice_id, receivable_id, amount_brl, offset_brl, refund_brl,
    corrected_total_brl, reason, created_by) VALUES (p_invoice_id, p_receivable_id, v_difference, v_offset,
    v_refund, round(p_corrected_total_brl, 2), btrim(p_reason), auth.uid()) RETURNING id INTO v_id;
  UPDATE public.bl_receivables SET correction_amount_brl = correction_amount_brl + v_difference,
    updated_at = now() WHERE id = p_receivable_id;
  FOR v_link IN SELECT DISTINCT i.id FROM public.invoices i JOIN public.invoice_receivable_links l ON l.invoice_id = i.id
    WHERE l.receivable_id = p_receivable_id AND i.status IN ('issued', 'overdue', 'partially_paid', 'paid') ORDER BY i.id
  LOOP
    SELECT coalesce(sum(br.balance_brl), 0) INTO v_balance FROM public.invoice_receivable_links l
      JOIN public.bl_receivables br ON br.id = l.receivable_id WHERE l.invoice_id = v_link.id
      AND l.status IN ('active', 'settled_by_this_invoice');
    UPDATE public.invoices SET balance_brl = v_balance,
      status = CASE WHEN v_balance = 0 AND v_invoice.invoice_type = 'consolidated' AND v_link.id <> p_invoice_id THEN 'covered' WHEN v_balance = 0 THEN 'paid' WHEN total_paid_brl > 0 THEN 'partially_paid' ELSE status END,
      covered_by_invoice_id = CASE WHEN v_balance = 0 AND v_invoice.invoice_type = 'consolidated' AND v_link.id <> p_invoice_id THEN p_invoice_id ELSE covered_by_invoice_id END
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
      'offset_brl', v_offset, 'refund_brl', v_refund)::text, auth.uid(), btrim(p_reason));
  RETURN jsonb_build_object('correction_id', v_id, 'offset_brl', v_offset, 'refund_brl', v_refund,
    'balance_brl', greatest(v_receivable.balance_brl - v_offset, 0));
END;
$$;
REVOKE ALL ON FUNCTION public.register_invoice_correction(bigint, bigint, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_invoice_correction(bigint, bigint, numeric, text) TO authenticated;
-- Uma restituição isolada não deve contornar o abatimento obrigatório do saldo.
REVOKE EXECUTE ON FUNCTION public.register_invoice_correction_refund(bigint, numeric, text) FROM authenticated;

CREATE FUNCTION public.get_invoice_correction_summary(p_invoice_id bigint) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_read_user() THEN
    RAISE EXCEPTION 'Sem permissao para consultar correcao.' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object('stale', EXISTS (SELECT 1 FROM public.alert_items ai JOIN public.alerts a ON a.id = ai.alert_id WHERE ai.item_type = 'fatura_desatualizada' AND ai.status = 'active' AND a.entity_type = 'invoice' AND a.entity_id = p_invoice_id::text), 'receivables', (SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', br.id, 'bl_id', br.bl_id, 'original_brl', br.original_amount_brl,
    'corrected_brl', br.original_amount_brl - br.correction_amount_brl,
    'paid_brl', br.settled_amount_brl, 'balance_brl', br.balance_brl)), '[]'::jsonb)
    FROM public.bl_receivables br JOIN public.invoice_receivable_links l ON l.receivable_id = br.id
    WHERE l.invoice_id = p_invoice_id AND l.status IN ('active', 'settled_by_this_invoice')),
    'corrections', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'amount_brl', c.amount_brl,
      'offset_brl', c.offset_brl, 'refund_brl', c.refund_brl, 'corrected_total_brl', c.corrected_total_brl,
      'reason', c.reason, 'created_at', c.created_at, 'bl_id', br.bl_id) ORDER BY c.id), '[]'::jsonb)
      FROM public.invoice_corrections c JOIN public.bl_receivables br ON br.id = c.receivable_id
      WHERE c.receivable_id IN (SELECT receivable_id FROM public.invoice_receivable_links WHERE invoice_id = p_invoice_id)));
END;
$$;
REVOKE ALL ON FUNCTION public.get_invoice_correction_summary(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_invoice_correction_summary(bigint) TO authenticated;

INSERT INTO public.alert_type_catalog(type, severity, responsible_department, audience_departments, default_destination)
VALUES ('fatura_desatualizada', 'normal', 'administrativo', ARRAY['administrativo'], '/taxas-locais');
CREATE FUNCTION public.alert_stale_invoice_for_bl(p_bl_id text, p_source text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_invoice record; v_path text;
BEGIN
  FOR v_invoice IN SELECT DISTINCT i.id, i.invoice_number, i.status, i.total_paid_brl FROM public.invoices i
    WHERE i.invoice_type IN ('individual', 'consolidated') AND i.status IN ('issued', 'overdue', 'partially_paid', 'paid')
    AND (EXISTS (SELECT 1 FROM public.invoice_bls b WHERE b.invoice_id = i.id AND b.bl_id = p_bl_id)
      OR EXISTS (SELECT 1 FROM public.invoice_receivable_links l WHERE l.invoice_id = i.id AND l.bl_id = p_bl_id
        AND l.status IN ('active', 'settled_by_this_invoice')))
  LOOP
    v_path := CASE WHEN coalesce(v_invoice.total_paid_brl, 0) > 0
      THEN 'Valor maior: emita fatura avulsa. Valor menor: registre correcao; o sistema abate o saldo antes de restituir.'
      ELSE 'Cancele e reemita a fatura de Taxas Locais.' END;
    PERFORM public.upsert_alert_item('fatura_desatualizada', 'invoice', v_invoice.id::text,
      'Fatura ' || v_invoice.invoice_number || ' desatualizada pela correcao do B/L ' || p_bl_id || '. ' || v_path,
      p_source, 'administrativo', jsonb_build_object('bl_id', p_bl_id, 'invoice_id', v_invoice.id, 'guidance', v_path),
      '/taxas-locais?invoice=' || v_invoice.id);
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.alert_stale_invoice_for_bl(text, text) FROM PUBLIC, anon, authenticated;

-- O dono da escrita já verifica override e permissões. Os triggers capturam
-- mudanças efetivas, também no caminho Baplie, sem confiar no preview do browser.
CREATE FUNCTION public.track_stale_invoice_on_bl_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF current_setting('vela.invoice_correction_import', true) = 'on' THEN RETURN NEW; END IF;
  IF (NEW.voyage_id, NEW.pol, NEW.pod, NEW.cargo_mode, NEW.total_weight_kg, NEW.customer_id, NEW.manifest_customer_cnpj_cpf)
    IS DISTINCT FROM (OLD.voyage_id, OLD.pol, OLD.pod, OLD.cargo_mode, OLD.total_weight_kg, OLD.customer_id, OLD.manifest_customer_cnpj_cpf) THEN
    PERFORM public.alert_stale_invoice_for_bl(NEW.id, 'bl_correction');
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER track_stale_invoice_on_bl_change AFTER UPDATE ON public.bls
  FOR EACH ROW EXECUTE FUNCTION public.track_stale_invoice_on_bl_change();
CREATE FUNCTION public.track_stale_invoice_on_cargo_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_bl text;
BEGIN
  IF current_setting('vela.invoice_correction_import', true) = 'on' THEN RETURN coalesce(NEW, OLD); END IF;
  IF TG_OP = 'UPDATE' AND to_jsonb(NEW) - ARRAY['updated_at', 'seal_number', 'imo_class', 'un_number']
    IS NOT DISTINCT FROM to_jsonb(OLD) - ARRAY['updated_at', 'seal_number', 'imo_class', 'un_number'] THEN RETURN NEW; END IF;
  v_bl := CASE WHEN TG_OP = 'DELETE' THEN OLD.bl_id ELSE NEW.bl_id END;
  PERFORM public.alert_stale_invoice_for_bl(v_bl, 'cargo_correction');
  IF TG_OP = 'UPDATE' AND OLD.bl_id IS DISTINCT FROM NEW.bl_id THEN
    PERFORM public.alert_stale_invoice_for_bl(OLD.bl_id, 'cargo_correction');
  END IF;
  RETURN coalesce(NEW, OLD);
END;
$$;
CREATE TRIGGER track_stale_invoice_on_container_change AFTER INSERT OR UPDATE OR DELETE ON public.bl_containers
  FOR EACH ROW EXECUTE FUNCTION public.track_stale_invoice_on_cargo_change();
CREATE TRIGGER track_stale_invoice_on_vehicle_change AFTER INSERT OR UPDATE OR DELETE ON public.vehicles
  FOR EACH ROW EXECUTE FUNCTION public.track_stale_invoice_on_cargo_change();
REVOKE ALL ON FUNCTION public.track_stale_invoice_on_bl_change() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.track_stale_invoice_on_cargo_change() FROM PUBLIC, anon, authenticated;
CREATE FUNCTION public.resolve_stale_invoice_on_reissue() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.replaces_invoice_id IS NOT NULL AND NEW.replaces_invoice_id IS DISTINCT FROM OLD.replaces_invoice_id THEN
    PERFORM public.resolve_alert_item('fatura_desatualizada', 'invoice', NEW.replaces_invoice_id::text,
      'invoice_reissue', jsonb_build_object('replacement_invoice_id', NEW.id));
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.resolve_stale_invoice_on_reissue() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER resolve_stale_invoice_on_reissue AFTER UPDATE OF replaces_invoice_id ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.resolve_stale_invoice_on_reissue();

ALTER FUNCTION public._portal_invoice_details_core(bigint, bigint) RENAME TO _portal_invoice_details_before_correction_123;
REVOKE ALL ON FUNCTION public._portal_invoice_details_before_correction_123(bigint, bigint) FROM PUBLIC, anon, authenticated;
CREATE FUNCTION public._portal_invoice_details_core(p_customer_id bigint, p_invoice_id bigint) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_raw jsonb; v_corrections jsonb;
BEGIN
  v_raw := public._portal_invoice_details_before_correction_123(p_customer_id, p_invoice_id);
  -- O núcleo anterior confirma o escopo antes de qualquer leitura adicional.
  SELECT coalesce(jsonb_agg(jsonb_build_object('amount_brl', c.amount_brl, 'offset_brl', c.offset_brl,
    'refund_brl', c.refund_brl, 'bl_id', b.bl_id, 'created_at', c.created_at) ORDER BY c.id), '[]'::jsonb)
  INTO v_corrections FROM public.invoice_corrections c JOIN public.bl_receivables b ON b.id = c.receivable_id
    WHERE c.receivable_id IN (SELECT receivable_id FROM public.invoice_receivable_links WHERE invoice_id = p_invoice_id);
  RETURN v_raw || jsonb_build_object('corrections', v_corrections);
END;
$$;
REVOKE ALL ON FUNCTION public._portal_invoice_details_core(bigint, bigint) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.resolve_stale_invoice(p_invoice_id bigint, p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_customer bigint;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Sem permissao para resolver alerta.' USING ERRCODE = '42501';
  END IF;
  IF length(btrim(coalesce(p_reason, ''))) < 3 THEN
    RAISE EXCEPTION 'Informe a justificativa da resolucao (avulsa emitida ou correcao registrada).' USING ERRCODE = '22023';
  END IF;
  SELECT customer_id INTO v_customer FROM public.invoices WHERE id = p_invoice_id;
  IF v_customer IS NULL THEN RAISE EXCEPTION 'Fatura nao encontrada.' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.resolve_alert_item('fatura_desatualizada', 'invoice', p_invoice_id::text, 'manual_correction_resolution',
    jsonb_build_object('reason', btrim(p_reason), 'actor', auth.uid()));
  INSERT INTO public.audit_logs(entity_type, entity_id, field_name, new_value, changed_by, justification)
    VALUES ('invoice', p_invoice_id::text, 'stale_invoice_resolved', 'resolved', auth.uid(), btrim(p_reason));
END;
$$;
REVOKE ALL ON FUNCTION public.resolve_stale_invoice(bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_stale_invoice(bigint, text) TO authenticated;

-- Inserção/remoção de carga chama sync mesmo depois da emissão. O recebível
-- deve permanecer congelado até cancelar a fatura ou registrar uma correção.
ALTER FUNCTION public.sync_local_charge_receivable(text) RENAME TO _sync_local_charge_receivable_before_correction_123;
REVOKE ALL ON FUNCTION public._sync_local_charge_receivable_before_correction_123(text) FROM PUBLIC, anon, authenticated;
CREATE FUNCTION public.sync_local_charge_receivable(p_bl_id text) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_id bigint;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Credenciais invalidas ou sem permissao de faturamento.' USING ERRCODE = '42501';
  END IF;
  SELECT br.id INTO v_id FROM public.bl_receivables br WHERE br.bl_id = upper(btrim(p_bl_id))
    AND br.source = 'local_charges' AND EXISTS (SELECT 1 FROM public.invoice_receivable_links l
      JOIN public.invoices i ON i.id = l.invoice_id WHERE l.receivable_id = br.id
      AND i.status IN ('issued', 'overdue', 'partially_paid', 'paid', 'covered'));
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  RETURN public._sync_local_charge_receivable_before_correction_123(p_bl_id);
END;
$$;
REVOKE ALL ON FUNCTION public.sync_local_charge_receivable(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_local_charge_receivable(text) TO authenticated;

CREATE FUNCTION public.bl_invoice_basis_snapshot(p_bl_id text) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object('voyage_id', b.voyage_id, 'pol', b.pol, 'pod', b.pod, 'cargo_mode', b.cargo_mode,
    'customer_id', b.customer_id,
    'weight', CASE WHEN b.cargo_mode IN ('carga_solta', 'misto') THEN b.total_weight_kg END,
    'containers', (SELECT coalesce(jsonb_agg(jsonb_build_array(c.container_number, c.type, coalesce(c.is_imo, false), coalesce(c.is_oog, false))
      ORDER BY c.container_number), '[]'::jsonb) FROM public.bl_containers c WHERE c.bl_id = b.id),
    'vehicles', (SELECT coalesce(jsonb_agg(v.chassis ORDER BY v.chassis), '[]'::jsonb) FROM public.vehicles v WHERE v.bl_id = b.id))
  FROM public.bls b WHERE b.id = p_bl_id;
$$;
REVOKE ALL ON FUNCTION public.bl_invoice_basis_snapshot(text) FROM PUBLIC, anon, authenticated;
ALTER FUNCTION public.import_bl_freight_transactional(jsonb, uuid) RENAME TO _import_bl_freight_before_invoice_alert_123;
REVOKE ALL ON FUNCTION public._import_bl_freight_before_invoice_alert_123(jsonb, uuid) FROM PUBLIC, anon, authenticated;
-- ponytail: wrapper mantém a cadeia histórica de importação intacta; ao
-- consolidar o importador, incorporar este snapshot ao núcleo transacional.
CREATE FUNCTION public.import_bl_freight_transactional(p_bls jsonb, p_changed_by uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_before jsonb := '{}'::jsonb; v_item jsonb; v_id text; v_result jsonb;
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
      PERFORM public.alert_stale_invoice_for_bl(v_id, 'bl_reimport_correction');
    END IF;
  END LOOP;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.import_bl_freight_transactional(jsonb, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_bl_freight_transactional(jsonb, uuid) TO authenticated;

-- Uma baixa não pode ser desfeita se a correção já comprometeu esse dinheiro
-- como restituição. Sem restituição, o trigger do recebível preserva o abatimento.
CREATE FUNCTION public.guard_payment_reversal_after_correction() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_refunds numeric; v_paid numeric;
BEGIN
  PERFORM 1 FROM public.invoices WHERE id = OLD.invoice_id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.invoice_corrections WHERE invoice_id = OLD.invoice_id) THEN
    SELECT coalesce(sum(amount_brl), 0) INTO v_refunds FROM public.invoice_refunds
      WHERE invoice_id = OLD.invoice_id AND status <> 'cancelled';
    SELECT coalesce(sum(amount_brl), 0) INTO v_paid FROM public.payments
      WHERE invoice_id = OLD.invoice_id AND id <> OLD.id;
    IF v_refunds > v_paid THEN
      RAISE EXCEPTION 'Esta baixa financia restituicao por correcao. Confira a restituicao antes de cancelar a baixa.' USING ERRCODE = '22023';
    END IF;
  END IF;
  RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_payment_reversal_after_correction() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER guard_payment_reversal_after_correction BEFORE DELETE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.guard_payment_reversal_after_correction();
