-- 382: o ROE manual da Invoice de Demurrage prevalece sobre a PTAX
-- (ADR 0094, B10; plano da frente financeira, F-54).
--
-- Problema: a Invoice emitida com o ROE manual do B/L (`roe_manual`) tinha o
-- câmbio sobrescrito pelo recálculo diário da PTAX (`recalculate_demurrage_invoices`,
-- job `recalc-demurrage-ptax` e recálculo manual), e o valor em R$ mudava
-- sem ninguém pedir.
--
-- Mudança: a Invoice com ROE manual fica fora do recálculo automático até
-- alguém tirar o ROE manual pela RPC `release_demurrage_invoice_manual_roe`
-- (Financeiro ou Administrativo, com motivo), que volta a Invoice ao câmbio
-- de referência do dia, grava o histórico e o rastro em `audit_logs`. É regra
-- da Demurrage: o preço fixo das Taxas Locais (378) não se aplica a ela.
--
-- Não altera nem apaga linhas existentes.

CREATE OR REPLACE FUNCTION public.recalculate_demurrage_invoices(p_ptax numeric, p_quote_date date, p_source text DEFAULT 'bcb_live'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_roe numeric; v_updated integer := 0; v_inv record; v_total_brl numeric(14,2); v_pix_payload text; v_discount_usd numeric(12,2);
BEGIN
  IF p_ptax IS NULL OR p_ptax <= 0 OR p_ptax > 1000 OR p_ptax::text = 'NaN' OR p_quote_date IS NULL THEN
    RAISE EXCEPTION 'PTAX e data de cotacao sao obrigatorias.' USING ERRCODE = '22023';
  END IF;
  IF p_source NOT IN ('bcb_live', 'cached', 'manual') THEN RAISE EXCEPTION 'Origem de PTAX invalida: %.', p_source USING ERRCODE = '22023'; END IF;
  v_roe := public._demurrage_roe_from_ptax(p_ptax);
  PERFORM public.save_exchange_rate_reference_v2(p_ptax, v_roe, p_quote_date, p_source, p_quote_date);
  FOR v_inv IN
    SELECT id, total_usd, coalesce(discount_value, 0) AS discount_value, discount_mode, doc_number, current_roe
    FROM public.demurrage_invoices WHERE status = 'issued' AND paid_at IS NULL
      -- 382 (ADR 0094, B10): Invoice com ROE manual fica fora do recálculo
      -- pela PTAX até alguém tirar o ROE manual.
      AND NOT coalesce(roe_manual, false)
    FOR UPDATE
  LOOP
    CONTINUE WHEN v_inv.current_roe IS NOT NULL AND v_inv.current_roe = v_roe;
    v_discount_usd := 0;
    IF v_inv.discount_value > 0 THEN
      v_discount_usd := CASE WHEN v_inv.discount_mode = 'percent' THEN round(v_inv.total_usd * (v_inv.discount_value / 100), 2) ELSE v_inv.discount_value END;
    END IF;
    v_total_brl := round(greatest(v_inv.total_usd - v_discount_usd, 0) * v_roe, 2);
    v_pix_payload := CASE WHEN v_total_brl > 0 THEN public.build_transshipping_pix_payload(v_total_brl, v_inv.doc_number) ELSE NULL END;
    UPDATE public.demurrage_invoices SET current_roe = v_roe, current_total_brl = v_total_brl, roe_source = p_source, pix_payload = v_pix_payload, updated_at = now() WHERE id = v_inv.id;
    INSERT INTO public.demurrage_invoice_history(invoice_id, event_date, ptax_used, roe_used, total_usd, total_brl, discount_usd, source)
    VALUES (v_inv.id, p_quote_date, p_ptax, v_roe, v_inv.total_usd, v_total_brl, v_discount_usd, p_source);
    v_updated := v_updated + 1;
  END LOOP;
  RETURN jsonb_build_object('updated', v_updated, 'roe', v_roe, 'quote_date', p_quote_date, 'source', p_source);
END;
$function$;

CREATE OR REPLACE FUNCTION public.release_demurrage_invoice_manual_roe(p_invoice_id bigint, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_inv public.demurrage_invoices%ROWTYPE;
  v_ref record;
  v_roe numeric;
  v_discount_usd numeric(12,2) := 0;
  v_total_brl numeric(14,2);
  v_quote_date date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_financeiro_user() THEN
    RAISE EXCEPTION 'Tirar o ROE manual é do Financeiro ou do Administrativo.' USING ERRCODE = '42501';
  END IF;
  IF v_reason IS NULL OR char_length(v_reason) < 10 THEN
    RAISE EXCEPTION 'Informe o motivo de tirar o ROE manual (mínimo de 10 caracteres).' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_inv FROM public.demurrage_invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invoice de Demurrage não encontrada.' USING ERRCODE = 'P0002'; END IF;
  IF NOT coalesce(v_inv.roe_manual, false) THEN
    RAISE EXCEPTION 'A Invoice % não tem ROE manual.', v_inv.doc_number USING ERRCODE = '22023';
  END IF;
  IF v_inv.status <> 'issued' OR v_inv.paid_at IS NOT NULL THEN
    RAISE EXCEPTION 'Só a Invoice emitida e não paga troca de câmbio.' USING ERRCODE = '22023';
  END IF;
  SELECT ptax, roe, source INTO v_ref FROM public.exchange_rate_reference WHERE id = 1;
  IF NOT FOUND OR v_ref.roe IS NULL OR v_ref.roe <= 0 THEN
    RAISE EXCEPTION 'Câmbio de referência não configurado: grave a PTAX antes de tirar o ROE manual.' USING ERRCODE = '22023';
  END IF;
  v_roe := round(v_ref.roe, 4);
  IF coalesce(v_inv.discount_value, 0) > 0 THEN
    v_discount_usd := CASE WHEN v_inv.discount_mode = 'percent' THEN round(v_inv.total_usd * (v_inv.discount_value / 100), 2) ELSE v_inv.discount_value END;
  END IF;
  v_total_brl := round(greatest(v_inv.total_usd - v_discount_usd, 0) * v_roe, 2);
  UPDATE public.demurrage_invoices
     SET roe_manual = false, current_roe = v_roe, current_total_brl = v_total_brl,
         roe_source = CASE WHEN v_ref.source IN ('bcb_live', 'cached', 'manual') THEN v_ref.source ELSE 'manual' END,
         pix_payload = CASE WHEN v_total_brl > 0 THEN public.build_transshipping_pix_payload(v_total_brl, v_inv.doc_number) END,
         updated_at = now()
   WHERE id = v_inv.id;
  INSERT INTO public.demurrage_invoice_history(invoice_id, event_date, ptax_used, roe_used, total_usd, total_brl, discount_usd, source)
  VALUES (v_inv.id, v_quote_date, v_ref.ptax, v_roe, v_inv.total_usd, v_total_brl, v_discount_usd,
    CASE WHEN v_ref.source IN ('bcb_live', 'cached', 'manual') THEN v_ref.source ELSE 'manual' END);
  INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  VALUES ('demurrage_invoice', v_inv.id::text, 'roe_manual_removed',
    jsonb_build_object('roe', v_inv.current_roe, 'total_brl', v_inv.current_total_brl)::text,
    jsonb_build_object('roe', v_roe, 'total_brl', v_total_brl)::text, auth.uid(), v_reason);
  RETURN jsonb_build_object('invoice_id', v_inv.id, 'roe', v_roe, 'total_brl', v_total_brl);
END;
$$;
REVOKE ALL ON FUNCTION public.release_demurrage_invoice_manual_roe(bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.release_demurrage_invoice_manual_roe(bigint, text) TO authenticated;
