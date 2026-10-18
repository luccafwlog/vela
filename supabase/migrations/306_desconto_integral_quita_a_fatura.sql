-- Migration 306: desconto de 100% quita a Invoice de Demurrage (isenta).
--
-- Plano de correção dos e-mails (docs/plans/2026-10-17-correcao-dos-emails.md),
-- item 1E.3, decisão D7. Uma Invoice com desconto igual ao total ficava
-- `issued` com USD líquido zero: não podia ser baixada (register_demurrage_payment
-- exige valor positivo), continuava nas pendências do Cliente no Vela e no
-- Portal e a Régua de Cobrança a recusava em loop por "Dados incompletos".
--
-- Não há status próprio de isenção; o mínimo coerente é a quitação que já
-- existe: apply_demurrage_discount, quando o desconto zera o USD líquido, grava
-- a Invoice como `paid` na data do desconto (Brasília), com BRL zero, sem PIX,
-- e a foto `source = 'payment'` com o valor zero. A justificativa do desconto
-- fica em audit_logs (`discount` e `discount_exemption`). Para desfazer, o
-- Administrativo usa "Cancelar baixa…" (a Invoice volta a `issued` com o
-- desconto) e altera o desconto.
--
-- A definição abaixo é a vigente (migration 264) com essa única mudança.
-- Não reescreve nem apaga linhas na aplicação da migration.

CREATE OR REPLACE FUNCTION public.apply_demurrage_discount(p_request_id uuid, p_invoice_id bigint, p_discount_mode text, p_discount_value numeric, p_discount_type text DEFAULT NULL::text, p_discount_justification text DEFAULT NULL::text, p_discount_approver text DEFAULT NULL::text)
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
  v_exempt boolean := false;
  v_exempt_date date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
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

  -- D7: desconto que zera o USD líquido de uma Invoice emitida quita a Invoice.
  v_exempt := v_mode IS NOT NULL
    AND v_invoice.total_usd > 0
    AND v_discount_usd >= v_invoice.total_usd
    AND COALESCE(v_invoice.status, 'issued') IN ('issued', 'overdue');

  IF v_invoice.current_roe IS NOT NULL AND v_invoice.current_roe > 0 THEN
    v_total_brl := round(greatest(v_invoice.total_usd - v_discount_usd, 0) * v_invoice.current_roe, 2);
    v_pix_payload := CASE WHEN v_total_brl > 0 THEN public.build_transshipping_pix_payload(v_total_brl, v_invoice.doc_number) ELSE NULL END;
  ELSE
    v_total_brl := NULL;
    v_pix_payload := NULL;
  END IF;
  IF v_exempt THEN
    v_total_brl := 0;
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
      status = CASE WHEN v_exempt THEN 'paid' ELSE status END,
      paid_at = CASE WHEN v_exempt THEN v_exempt_date ELSE paid_at END,
      updated_at = now()
  WHERE id = p_invoice_id;

  IF v_invoice.current_roe IS NOT NULL AND v_invoice.current_roe > 0 THEN
    INSERT INTO public.demurrage_invoice_history
      (invoice_id, event_date, ptax_used, roe_used, total_usd, total_brl, discount_usd, source)
    VALUES
      (p_invoice_id, CASE WHEN v_exempt THEN v_exempt_date ELSE CURRENT_DATE END,
       public._demurrage_ptax_from_roe(v_invoice.current_roe), v_invoice.current_roe,
       v_invoice.total_usd, v_total_brl, v_discount_usd, CASE WHEN v_exempt THEN 'payment' ELSE 'manual' END);
  END IF;

  INSERT INTO public.audit_logs(
    entity_type, entity_id, field_name, old_value, new_value,
    changed_by, changed_at, justification
  ) VALUES (
    'demurrage_invoice', p_invoice_id::text, 'discount',
    jsonb_build_object('mode', v_invoice.discount_mode, 'value', v_invoice.discount_value)::text,
    v_payload::text, auth.uid(), now(), v_justification
  );

  IF v_exempt THEN
    INSERT INTO public.audit_logs(
      entity_type, entity_id, field_name, old_value, new_value,
      changed_by, changed_at, justification
    ) VALUES (
      'demurrage_invoice', p_invoice_id::text, 'discount_exemption',
      v_invoice.status,
      jsonb_build_object('status', 'paid', 'paid_at', v_exempt_date, 'total_brl', 0)::text,
      auth.uid(), now(), v_justification
    );
  END IF;

  v_result := jsonb_build_object(
    'invoice_id', p_invoice_id,
    'discount_usd', v_discount_usd,
    'current_total_brl', v_total_brl,
    'pix_payload', v_pix_payload,
    'status', CASE WHEN v_exempt THEN 'paid' ELSE v_invoice.status END,
    'exempted', v_exempt,
    'idempotent', false
  );
  INSERT INTO public.demurrage_mutation_requests(request_id, operation, invoice_id, request_payload, result, created_by)
  VALUES (p_request_id, 'discount', p_invoice_id, v_payload, v_result, auth.uid())
  ON CONFLICT (request_id) DO NOTHING;
  RETURN v_result;
END;
$function$;
