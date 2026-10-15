-- Item 38 (B24) do plano 2026-10-14: o markup do ROE (1,065) fica num ponto
-- canônico só no banco, como manda a ADR 0014. A ida (PTAX → ROE) e a volta
-- (ROE → PTAX de referência, usada no desconto e na Conciliação PIX) derivam
-- de _demurrage_roe_markup(); a referência cambial calcula o ROE a partir da
-- PTAX quando quem chama manda só a PTAX (a Edge recalc-demurrage-ptax).
-- Só cria e redefine funções; não reescreve nem apaga linhas.

CREATE OR REPLACE FUNCTION public._demurrage_roe_markup()
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT 1.065::numeric;
$function$;

CREATE OR REPLACE FUNCTION public._demurrage_roe_from_ptax(p_ptax numeric)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT round(p_ptax * public._demurrage_roe_markup(), 4);
$function$;

CREATE OR REPLACE FUNCTION public._demurrage_ptax_from_roe(p_roe numeric)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT round(p_roe / public._demurrage_roe_markup(), 4);
$function$;

REVOKE ALL ON FUNCTION public._demurrage_roe_markup() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._demurrage_ptax_from_roe(numeric) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.save_exchange_rate_reference_v2(p_ptax numeric, p_roe numeric, p_effective_date date, p_source text, p_quote_date date DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_source text := NULLIF(btrim(COALESCE(p_source, '')), '');
  v_quote_date date := COALESCE(p_quote_date, p_effective_date);
  v_spread_version integer := public._demurrage_spread_version();
  v_actor uuid := auth.uid();
  -- B24 (ADR 0014): o ROE da PTAX vem do ponto canônico do banco; quem chama
  -- pode mandar só a PTAX (p_roe nulo), e o ROE informado é conferido.
  v_roe numeric := COALESCE(p_roe, CASE WHEN p_ptax IS NOT NULL AND p_ptax > 0 THEN public._demurrage_roe_from_ptax(p_ptax) END);
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' AND NOT public.is_active_user() THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE = '42501';
  END IF;
  IF v_source NOT IN ('bcb_live', 'cached', 'manual')
     OR p_effective_date IS NULL
     OR v_roe IS NULL OR v_roe <= 0 OR v_roe > 1000
     OR v_roe::text = 'NaN'
     OR v_quote_date IS NULL THEN
    RAISE EXCEPTION 'Referencia cambial invalida.' USING ERRCODE = '22023';
  END IF;
  IF v_source IN ('bcb_live', 'cached')
     AND (p_ptax IS NULL OR p_ptax <= 0 OR p_ptax > 1000 OR p_ptax::text = 'NaN') THEN
    RAISE EXCEPTION 'PTAX obrigatoria para origem %.', v_source USING ERRCODE = '22023';
  END IF;
  IF p_ptax IS NOT NULL AND (p_ptax <= 0 OR p_ptax > 1000 OR p_ptax::text = 'NaN') THEN
    RAISE EXCEPTION 'PTAX invalida.' USING ERRCODE = '22023';
  END IF;
  IF v_source IN ('bcb_live', 'cached')
     AND v_roe IS DISTINCT FROM public._demurrage_roe_from_ptax(p_ptax) THEN
    RAISE EXCEPTION 'ROE divergente da PTAX e do spread vigente.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.exchange_rate_reference_history(
    source, ptax, roe, effective_date, quote_date, spread_version, recorded_by
  ) VALUES (
    v_source, p_ptax, v_roe, p_effective_date, v_quote_date, v_spread_version, v_actor
  ) ON CONFLICT DO NOTHING;

  INSERT INTO public.exchange_rate_reference(
    id, ptax, roe, effective_date, updated_at, source, quote_date, spread_version
  ) VALUES (
    1, p_ptax, v_roe, p_effective_date, now(), v_source, v_quote_date, v_spread_version
  )
  ON CONFLICT (id) DO UPDATE
  SET ptax = EXCLUDED.ptax,
      roe = EXCLUDED.roe,
      effective_date = EXCLUDED.effective_date,
      updated_at = now(),
      source = EXCLUDED.source,
      quote_date = EXCLUDED.quote_date,
      spread_version = EXCLUDED.spread_version;

  RETURN jsonb_build_object(
    'source', v_source,
    'ptax', p_ptax,
    'roe', v_roe,
    'effective_date', p_effective_date,
    'quote_date', v_quote_date,
    'spread_version', v_spread_version
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.apply_demurrage_discount(p_request_id uuid, p_invoice_id bigint, p_discount_mode text, p_discount_value numeric, p_discount_type text DEFAULT NULL, p_discount_justification text DEFAULT NULL, p_discount_approver text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_payload jsonb;
  v_previous jsonb;
  v_invoice public.demurrage_invoices%ROWTYPE;
  v_mode text := NULLIF(btrim(p_discount_mode), '');
  v_type text := NULLIF(btrim(p_discount_type), '');
  v_value numeric(12,2) := CASE WHEN p_discount_value IS NULL THEN NULL ELSE round(p_discount_value, 2) END;
  v_discount_usd numeric(12,2) := 0;
  v_total_brl numeric(14,2);
  v_pix_payload text;
  v_result jsonb;
  v_justification text := NULLIF(btrim(p_discount_justification), '');
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND (auth.uid() IS NULL OR NOT public.is_active_user()) THEN
    RAISE EXCEPTION 'Usuario sem permissao para aplicar desconto de Demurrage.' USING ERRCODE = '42501';
  END IF;
  IF p_invoice_id IS NULL THEN
    RAISE EXCEPTION 'Fatura obrigatoria.' USING ERRCODE = '22023';
  END IF;
  IF v_mode IS NOT NULL AND v_mode NOT IN ('percent', 'fixed') THEN
    RAISE EXCEPTION 'Modo de desconto invalido.' USING ERRCODE = '22023';
  END IF;
  IF v_type IS NOT NULL AND v_type NOT IN ('comercial', 'datas', 'cortesia', 'acordo', 'erro') THEN
    RAISE EXCEPTION 'Tipo de desconto invalido.' USING ERRCODE = '22023';
  END IF;
  IF v_value IS NOT NULL AND v_value < 0 THEN
    RAISE EXCEPTION 'Desconto nao pode ser negativo.' USING ERRCODE = '22003';
  END IF;
  IF v_value IS NOT NULL AND v_mode IS NULL THEN
    RAISE EXCEPTION 'Modo de desconto obrigatorio.' USING ERRCODE = '22023';
  END IF;
  IF v_justification IS NULL THEN
    RAISE EXCEPTION 'Justificativa obrigatoria para alterar desconto.' USING ERRCODE = '22023';
  END IF;

  v_payload := jsonb_build_object(
    'invoice_id', p_invoice_id,
    'discount_mode', v_mode,
    'discount_value', v_value,
    'discount_type', v_type,
    'discount_justification', v_justification,
    'discount_approver', NULLIF(btrim(p_discount_approver), '')
  );
  v_previous := public._demurrage_mutation_request(p_request_id, 'discount', p_invoice_id, v_payload);
  IF v_previous IS NOT NULL THEN
    RETURN v_previous;
  END IF;

  SELECT * INTO v_invoice
  FROM public.demurrage_invoices
  WHERE id = p_invoice_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Demurrage invoice % nao encontrada.', p_invoice_id USING ERRCODE = 'P0002';
  END IF;
  IF v_invoice.status IN ('paid', 'cancelled') OR v_invoice.paid_at IS NOT NULL THEN
    RAISE EXCEPTION 'Desconto nao pode alterar fatura paga ou cancelada.' USING ERRCODE = '22023';
  END IF;

  IF v_value IS NULL THEN
    v_discount_usd := 0;
    v_mode := NULL;
  ELSIF v_mode = 'percent' THEN
    IF v_value > 100 THEN
      RAISE EXCEPTION 'Percentual de desconto deve ficar entre 0 e 100.' USING ERRCODE = '22003';
    END IF;
    v_discount_usd := round(v_invoice.total_usd * v_value / 100, 2);
  ELSE
    IF v_value > v_invoice.total_usd THEN
      RAISE EXCEPTION 'Desconto fixo nao pode exceder o total USD da fatura.' USING ERRCODE = '22003';
    END IF;
    v_discount_usd := v_value;
  END IF;

  IF v_invoice.current_roe IS NOT NULL AND v_invoice.current_roe > 0 THEN
    v_total_brl := round(greatest(v_invoice.total_usd - v_discount_usd, 0) * v_invoice.current_roe, 2);
    v_pix_payload := CASE WHEN v_total_brl > 0 THEN public.build_transshipping_pix_payload(v_total_brl, v_invoice.doc_number) ELSE NULL END;
  ELSE
    v_total_brl := NULL;
    v_pix_payload := NULL;
  END IF;

  UPDATE public.demurrage_invoices
  SET discount_type = v_type,
      discount_value = CASE WHEN v_value IS NULL THEN NULL ELSE v_value END,
      discount_mode = v_mode,
      discount_justification = v_justification,
      discount_approver = NULLIF(btrim(p_discount_approver), ''),
      current_total_brl = v_total_brl,
      pix_payload = v_pix_payload,
      updated_at = now()
  WHERE id = p_invoice_id;

  IF v_total_brl IS NOT NULL THEN
    INSERT INTO public.demurrage_invoice_history
      (invoice_id, event_date, ptax_used, roe_used, total_usd, total_brl, discount_usd, source)
    VALUES
      (p_invoice_id, CURRENT_DATE, public._demurrage_ptax_from_roe(v_invoice.current_roe), v_invoice.current_roe,
       v_invoice.total_usd, v_total_brl, v_discount_usd, 'manual');
  END IF;

  INSERT INTO public.audit_logs(
    entity_type, entity_id, field_name, old_value, new_value,
    changed_by, changed_at, justification
  ) VALUES (
    'demurrage_invoice', p_invoice_id::text, 'discount',
    jsonb_build_object('mode', v_invoice.discount_mode, 'value', v_invoice.discount_value)::text,
    v_payload::text, auth.uid(), now(), v_justification
  );

  v_result := jsonb_build_object(
    'invoice_id', p_invoice_id,
    'discount_usd', v_discount_usd,
    'current_total_brl', v_total_brl,
    'pix_payload', v_pix_payload,
    'idempotent', false
  );
  INSERT INTO public.demurrage_mutation_requests(request_id, operation, invoice_id, request_payload, result, created_by)
  VALUES (p_request_id, 'discount', p_invoice_id, v_payload, v_result, auth.uid())
  ON CONFLICT (request_id) DO NOTHING;
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.confirm_unified_pix_matches(p_matches jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_item RECORD;
  v_result JSONB;
  v_items JSONB := '[]'::jsonb;
  v_local_count INTEGER := 0;
  v_demurrage_count INTEGER := 0;
  v_demurrage_updates JSONB := '[]'::jsonb;
  v_updated_demurrage INTEGER := 0;
  v_paid_date DATE;
  v_match_brl NUMERIC;
  v_match_ptax NUMERIC;
BEGIN
  -- Conciliar é do Financeiro e do Administrativo (ADR 0085, D5).
  IF auth.uid() IS NULL OR NOT public.is_financeiro_user() THEN
    RAISE EXCEPTION 'Credenciais invalidas ou sem permissao para reconciliacao PIX.' USING ERRCODE = '42501';
  END IF;
  FOR v_item IN
    SELECT *
    FROM jsonb_to_recordset(p_matches) AS row(
      source TEXT,
      invoice_id BIGINT,
      doc_number TEXT,
      txid TEXT,
      amount NUMERIC,
      expected_amount NUMERIC,
      paid_at TIMESTAMPTZ
    )
  LOOP
    IF v_item.paid_at IS NULL THEN
      RAISE EXCEPTION 'Data do extrato nao parseada para %.', COALESCE(v_item.doc_number, v_item.txid, v_item.invoice_id::TEXT)
        USING ERRCODE = '22007';
    END IF;

    IF v_item.source = 'local' THEN
      v_result := public.reconcile_invoice_payment_by_txid(v_item.txid, v_item.amount, v_item.paid_at);
      IF COALESCE((v_result->>'matched')::BOOLEAN, false) IS NOT TRUE
         OR COALESCE((v_result->>'settled')::BOOLEAN, false) IS NOT TRUE THEN
        RAISE EXCEPTION 'Falha ao conciliar fatura local %: %.',
          COALESCE(v_item.doc_number, v_item.txid),
          COALESCE(v_result->>'reason', 'erro desconhecido')
          USING ERRCODE = 'P0001';
      END IF;
      v_local_count := v_local_count + 1;
      v_items := v_items || jsonb_build_array(jsonb_build_object(
        'source', 'local', 'invoice_id', v_item.invoice_id, 'doc_number', v_item.doc_number, 'status', 'ok'));

    ELSIF v_item.source = 'demurrage' THEN
      v_paid_date := (v_item.paid_at AT TIME ZONE 'UTC')::date;

      -- Janela das duas PTAX mais recentes com event_date <= data do pagamento.
      SELECT w.total_brl, w.ptax_used
      INTO v_match_brl, v_match_ptax
      FROM public.get_demurrage_recent_values(v_item.invoice_id, v_paid_date) AS w
      WHERE ABS(w.total_brl - COALESCE(v_item.amount, 0)) <= 0.01
      ORDER BY w.event_date DESC
      LIMIT 1;

      IF NOT FOUND THEN
        -- Fallback: sem histórico (legado) compara com o valor corrente.
        SELECT d.current_total_brl, public._demurrage_ptax_from_roe(d.current_roe)
        INTO v_match_brl, v_match_ptax
        FROM public.demurrage_invoices d
        WHERE d.id = v_item.invoice_id
        FOR UPDATE;

        IF NOT FOUND THEN
          RAISE EXCEPTION 'Demurrage % nao encontrada.', v_item.doc_number USING ERRCODE = 'P0002';
        END IF;
        IF v_match_brl IS NULL OR ABS(v_match_brl - COALESCE(v_item.amount, 0)) > 0.01 THEN
          RAISE EXCEPTION 'Valor divergente para demurrage %.', v_item.doc_number USING ERRCODE = '22003';
        END IF;
      END IF;

      v_demurrage_updates := v_demurrage_updates || jsonb_build_array(jsonb_build_object(
        'invoice_id', v_item.invoice_id,
        'paid_at', v_paid_date,
        'pix_txid', v_item.txid,
        'total_brl', v_match_brl,
        'ptax_used', v_match_ptax));
      v_demurrage_count := v_demurrage_count + 1;
      v_items := v_items || jsonb_build_array(jsonb_build_object(
        'source', 'demurrage', 'invoice_id', v_item.invoice_id, 'doc_number', v_item.doc_number, 'status', 'ok'));
    ELSE
      RAISE EXCEPTION 'Origem de conciliacao PIX invalida: %.', v_item.source USING ERRCODE = '22023';
    END IF;
  END LOOP;

  IF v_demurrage_count > 0 THEN
    v_updated_demurrage := public.confirm_demurrage_pix_matches(v_demurrage_updates);
    IF v_updated_demurrage <> v_demurrage_count THEN
      RAISE EXCEPTION 'Conciliacao de demurrage atualizou % de % faturas.', v_updated_demurrage, v_demurrage_count
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN jsonb_build_object('local', v_local_count, 'demurrage', v_demurrage_count, 'items', v_items);
END;
$function$;
