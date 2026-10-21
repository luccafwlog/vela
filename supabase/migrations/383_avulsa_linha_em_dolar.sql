-- 383: a linha em dólar da Fatura Avulsa mostra o unitário só em US$ (ADR
-- 0094, B13; plano da frente financeira, F-46).
--
-- Problema: a avulsa de item da tabela em dólar gravava o unitário em R$
-- convertido à parte, e quantidade × unitário em R$ não fechava com o total,
-- que é o total em US$ convertido de uma vez (como a taxa local em dólar).
--
-- Mudança: o valor cobrado não muda. A linha em dólar grava o unitário em US$
-- e o total em R$, sem unitário em R$; o detalhe, o impresso e o Portal
-- mostram o unitário em US$ (`src/lib/invoiceItemUnit.ts`).
--
-- Não altera nem apaga linhas existentes.

CREATE OR REPLACE FUNCTION public._create_manual_invoice_core_272(p_customer_id bigint, p_item_name text, p_quantity numeric, p_unit_value_brl numeric, p_description text DEFAULT NULL::text, p_bl_id text DEFAULT NULL::text, p_voyage_id bigint DEFAULT NULL::bigint, p_actor uuid DEFAULT NULL::uuid, p_charge_item_id bigint DEFAULT NULL::bigint)
 RETURNS jsonb
AS $function$
DECLARE v_quote jsonb; v_result jsonb; v_invoice bigint; v_pricing_version bigint; v_total numeric(14,2);
BEGIN
  -- O autor é quem está logado (ADR 0085, regra base 2; migration 241).
  PERFORM public._assert_actor_is_caller(p_actor);
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
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
    -- 383 (ADR 0094, B13): a linha em dólar mostra o unitário só em US$; o
    -- total em R$ é o total em US$ convertido de uma vez, como na taxa local.
    unit_value_brl = CASE WHEN v_quote->>'currency' = 'USD' THEN NULL ELSE unit_value_brl END,
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
$function$
LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp';
