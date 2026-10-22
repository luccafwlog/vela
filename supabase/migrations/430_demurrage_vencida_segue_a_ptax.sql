-- 430: a Invoice de Demurrage vencida (`overdue`) e não paga também segue o
-- recálculo diário pela PTAX (ADR 0094, B10; correção da 382/385).
--
-- Problema: a 385 passou a aceitar a Invoice vencida em
-- `release_demurrage_invoice_manual_roe` (a tela mostra "Tirar ROE manual"
-- para a emitida e para a vencida), mas `recalculate_demurrage_invoices` (382)
-- ainda só recalculava `status = 'issued'`. A Invoice vencida tirada do ROE
-- manual ficava parada no câmbio do clique e nunca voltava à PTAX.
--
-- Mudança: o recálculo considera aberta a Invoice `issued` ou `overdue` sem
-- pagamento, o mesmo critério da RPC de tirar o ROE manual e da rotina do
-- Pix (385). A Invoice com ROE manual continua fora do recálculo.
--
-- Só redefine a função; não altera nem apaga linhas existentes.

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
    FROM public.demurrage_invoices
    -- 430: a vencida e não paga é tão aberta quanto a emitida.
    WHERE status IN ('issued', 'overdue') AND paid_at IS NULL
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
