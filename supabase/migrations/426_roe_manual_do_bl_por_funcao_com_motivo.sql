-- 426: ROE manual do B/L só por função, com motivo e histórico (auditoria de
-- segurança run-3, decisão do dono em 2026-10-22).
--
-- `bls.demurrage_roe` e `bls.demurrage_roe_manual` tinham UPDATE de coluna
-- para `authenticated` (366): qualquer usuário interno gravava o ROE manual do
-- B/L direto pela API, sem motivo, e a Invoice de Demurrage emitida depois
-- saía com esse câmbio, fora do recálculo pela PTAX (ADR 0094, B10). Nenhuma
-- tela grava essas colunas.
--
-- Decisão do dono: Financeiro, Administrativo e Equipamentos põem e tiram o
-- ROE manual, sempre com motivo.
--
-- 1. O UPDATE de coluna sai de `authenticated`.
-- 2. `set_bl_manual_roe(p_bl_id, p_roe, p_reason)` põe (`p_roe` preenchido) ou
--    tira (`p_roe` nulo) o ROE manual do B/L. Motivo de 10 caracteres ou mais;
--    o histórico do B/L (`audit_bls`) grava a mudança com o motivo. Vale para a
--    próxima Invoice emitida; a Invoice já emitida segue o ROE dela e tem o
--    "Tirar ROE manual" próprio.
-- 3. `release_demurrage_invoice_manual_roe` passa a aceitar Equipamentos.
--
-- Só redefine funções e permissões; não reescreve nem apaga linhas.
-- Rollback: `GRANT UPDATE (demurrage_roe, demurrage_roe_manual) ON public.bls
-- TO authenticated`, remover `set_bl_manual_roe` e reaplicar a definição de
-- `release_demurrage_invoice_manual_roe` da 385.

REVOKE UPDATE (demurrage_roe, demurrage_roe_manual) ON public.bls FROM authenticated;

CREATE OR REPLACE FUNCTION public.set_bl_manual_roe(p_bl_id text, p_roe numeric, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_bl public.bls%ROWTYPE;
  v_roe numeric(10,4);
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user()
     OR public.current_actor_role() NOT IN ('financeiro', 'administrativo', 'equipamentos') THEN
    RAISE EXCEPTION 'O ROE manual do B/L é do Financeiro, do Administrativo ou de Equipamentos.' USING ERRCODE = '42501';
  END IF;
  IF v_reason IS NULL OR char_length(v_reason) < 10 THEN
    RAISE EXCEPTION 'Informe o motivo do ROE manual (mínimo de 10 caracteres).' USING ERRCODE = '22023';
  END IF;
  IF p_roe IS NOT NULL AND (p_roe::text = 'NaN' OR p_roe <= 0 OR p_roe > 1000) THEN
    RAISE EXCEPTION 'ROE manual inválido.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_bl FROM public.bls WHERE id = p_bl_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'B/L não encontrado.' USING ERRCODE = 'P0002'; END IF;
  v_roe := round(p_roe, 4);
  IF p_roe IS NULL AND NOT coalesce(v_bl.demurrage_roe_manual, false) THEN
    RAISE EXCEPTION 'O B/L % não tem ROE manual.', p_bl_id USING ERRCODE = '22023';
  END IF;
  IF p_roe IS NOT NULL AND coalesce(v_bl.demurrage_roe_manual, false) AND v_bl.demurrage_roe = v_roe THEN
    RAISE EXCEPTION 'O B/L % já tem esse ROE manual.', p_bl_id USING ERRCODE = '22023';
  END IF;

  -- O histórico do B/L (`audit_bls`) leva o motivo na justificativa.
  PERFORM set_config('vela.import_context', 'ROE manual: ' || v_reason, true);
  UPDATE public.bls
     SET demurrage_roe_manual = (v_roe IS NOT NULL), demurrage_roe = v_roe
   WHERE id = p_bl_id;
  PERFORM set_config('vela.import_context', '', true);

  RETURN jsonb_build_object('bl_id', p_bl_id, 'roe', v_roe, 'manual', v_roe IS NOT NULL);
END;
$function$;

REVOKE ALL ON FUNCTION public.set_bl_manual_roe(text, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_bl_manual_roe(text, numeric, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.release_demurrage_invoice_manual_roe(p_invoice_id bigint, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_inv public.demurrage_invoices%ROWTYPE;
  v_ref record;
  v_roe numeric;
  v_discount_usd numeric(12,2) := 0;
  v_total_brl numeric(14,2);
  v_quote_date date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  -- 426: Equipamentos também tira o ROE manual (decisão do dono, 2026-10-22).
  IF auth.uid() IS NULL OR NOT public.is_active_user()
     OR public.current_actor_role() NOT IN ('financeiro', 'administrativo', 'equipamentos') THEN
    RAISE EXCEPTION 'Tirar o ROE manual é do Financeiro, do Administrativo ou de Equipamentos.' USING ERRCODE = '42501';
  END IF;
  IF v_reason IS NULL OR char_length(v_reason) < 10 THEN
    RAISE EXCEPTION 'Informe o motivo de tirar o ROE manual (mínimo de 10 caracteres).' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_inv FROM public.demurrage_invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invoice de Demurrage não encontrada.' USING ERRCODE = 'P0002'; END IF;
  IF NOT coalesce(v_inv.roe_manual, false) THEN
    RAISE EXCEPTION 'A Invoice % não tem ROE manual.', v_inv.doc_number USING ERRCODE = '22023';
  END IF;
  IF v_inv.status NOT IN ('issued', 'overdue') OR v_inv.paid_at IS NOT NULL THEN
    RAISE EXCEPTION 'Só a Invoice emitida e não paga troca de câmbio.' USING ERRCODE = '22023';
  END IF;
  SELECT ptax, roe, source, quote_date, effective_date INTO v_ref FROM public.exchange_rate_reference WHERE id = 1;
  IF NOT FOUND OR v_ref.roe IS NULL OR v_ref.roe <= 0 THEN
    RAISE EXCEPTION 'Câmbio de referência não configurado: grave a PTAX antes de tirar o ROE manual.' USING ERRCODE = '22023';
  END IF;
  v_roe := round(v_ref.roe, 4);
  v_quote_date := coalesce(v_ref.quote_date, v_ref.effective_date, v_quote_date);
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
$function$;
