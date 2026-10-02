-- 123: itens da tabela em avulsas e restituição por correção (ADR 0077).
-- Não reescreve linhas existentes. A avulsa continua sem recebível local.
CREATE FUNCTION public.quote_manual_invoice_charge(p_bl_id text, p_charge_item_id bigint)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
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
    RAISE EXCEPTION 'Usuario sem permissao ativa.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_item FROM public.list_manual_charge_items_for_bl(p_bl_id)
    WHERE charge_item_id = p_charge_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item manual nao elegivel para este B/L.' USING ERRCODE = '22023';
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
    LEFT JOIN public.import_batches ib ON ib.id = b.batch_id
    WHERE b.id = upper(btrim(p_bl_id)) AND cro.charge_item_id = p_charge_item_id AND cro.active
      AND (cro.valid_from IS NULL OR cro.valid_from <= coalesce(ib.uploaded_at::date, b.created_at::date, current_date))
      AND (cro.valid_to IS NULL OR cro.valid_to >= coalesce(ib.uploaded_at::date, b.created_at::date, current_date))
    ORDER BY cro.created_at DESC LIMIT 1;
  IF v_item.currency = 'USD' THEN
    SELECT roe, effective_date INTO v_roe, v_roe_date FROM public.exchange_rate_reference WHERE id = 1;
    IF v_roe IS NULL OR v_roe <= 0 THEN
      RAISE EXCEPTION 'Cambio (ROE) nao configurado.' USING ERRCODE = '22023';
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
$$;
REVOKE ALL ON FUNCTION public.quote_manual_invoice_charge(text, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.quote_manual_invoice_charge(text, bigint) TO authenticated;

ALTER FUNCTION public.create_manual_invoice(bigint, text, numeric, numeric, text, text, bigint, uuid)
  RENAME TO _create_manual_invoice_custom_122;
REVOKE ALL ON FUNCTION public._create_manual_invoice_custom_122(bigint, text, numeric, numeric, text, text, bigint, uuid)
  FROM PUBLIC, anon, authenticated;
CREATE FUNCTION public.create_manual_invoice(
  p_customer_id bigint, p_item_name text, p_quantity numeric, p_unit_value_brl numeric,
  p_description text DEFAULT NULL, p_bl_id text DEFAULT NULL, p_voyage_id bigint DEFAULT NULL,
  p_actor uuid DEFAULT NULL, p_charge_item_id bigint DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_quote jsonb; v_result jsonb; v_invoice bigint; v_pricing_version bigint;
BEGIN
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
    total_value_brl = (v_quote->>'total_brl')::numeric
    WHERE invoice_id = v_invoice;
  UPDATE public.invoices SET total_brl = (v_quote->>'total_brl')::numeric,
    balance_brl = (v_quote->>'total_brl')::numeric WHERE id = v_invoice;
  RETURN v_result || jsonb_build_object('total_brl', v_quote->'total_brl', 'balance_brl', v_quote->'total_brl');
END;
$$;
REVOKE ALL ON FUNCTION public.create_manual_invoice(bigint, text, numeric, numeric, text, text, bigint, uuid, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_manual_invoice(bigint, text, numeric, numeric, text, text, bigint, uuid, bigint) TO authenticated;

ALTER TABLE public.invoice_refunds ADD COLUMN origin text NOT NULL DEFAULT 'existing';
ALTER TABLE public.invoice_refunds DROP CONSTRAINT invoice_refunds_origin_check;
ALTER TABLE public.invoice_refunds ADD CONSTRAINT invoice_refunds_origin_check CHECK (
  (origin = 'existing' AND ((payment_id IS NULL) <> (cod_adjustment_id IS NULL))) OR
  (origin = 'correction' AND payment_id IS NULL AND cod_adjustment_id IS NULL AND nullif(btrim(notes), '') IS NOT NULL)
);
CREATE FUNCTION public.register_invoice_correction_refund(p_invoice_id bigint, p_amount_brl numeric, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_invoice record; v_available numeric; v_refund bigint;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_financeiro_user() THEN
    RAISE EXCEPTION 'Sem permissao para registrar restituicao.' USING ERRCODE = '42501';
  END IF;
  IF p_amount_brl IS NULL OR p_amount_brl::text IN ('NaN', 'Infinity', '-Infinity') OR round(p_amount_brl, 2) <= 0
     OR nullif(btrim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'Informe valor positivo e motivo da correcao.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_invoice FROM public.invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND OR v_invoice.invoice_type NOT IN ('individual', 'consolidated')
    OR v_invoice.status NOT IN ('paid', 'partially_paid') THEN
    RAISE EXCEPTION 'Restituicao por correcao exige fatura de Taxas Locais paga ou parcialmente paga.' USING ERRCODE = '22023';
  END IF;
  SELECT coalesce(v_invoice.total_paid_brl, 0) - coalesce(sum(amount_brl), 0)
    INTO v_available FROM public.invoice_refunds WHERE invoice_id = p_invoice_id AND status <> 'cancelled';
  IF round(p_amount_brl, 2) > v_available THEN
    RAISE EXCEPTION 'Restituicao excede o total pago disponivel (%).', v_available USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.invoice_refunds(invoice_id, amount_brl, origin, notes, registered_by)
    VALUES (p_invoice_id, round(p_amount_brl, 2), 'correction', btrim(p_reason), auth.uid()) RETURNING id INTO v_refund;
  INSERT INTO public.audit_logs(entity_type, entity_id, field_name, new_value, changed_by, justification)
    VALUES ('invoice_refund', v_refund::text, 'correction', p_amount_brl::text, auth.uid(), btrim(p_reason));
  RETURN jsonb_build_object('refund_id', v_refund, 'invoice_id', p_invoice_id, 'status', 'pending');
END;
$$;
REVOKE ALL ON FUNCTION public.register_invoice_correction_refund(bigint, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_invoice_correction_refund(bigint, numeric, text) TO authenticated;
