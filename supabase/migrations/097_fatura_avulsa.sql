-- Migration 097: fatura avulsa flexível.
--
-- O tipo `manual` reutiliza invoices/invoice_items, mas não representa uma
-- cobrança do ledger local. O contexto operacional é apenas referencial:
-- nunca são criados invoice_bls, invoice_receivable_links ou recebíveis.
--
-- Sem backfill: as linhas existentes permanecem inalteradas. A coluna nova é
-- nullable e o check de invoice_type conserva todos os valores anteriores.
-- ROLLBACK (manual e somente se esta migration ainda não tiver sido usada):
--   DROP FUNCTION public.create_manual_invoice(bigint, text, numeric, numeric, text, text, bigint, uuid);
--   ALTER TABLE public.invoices DROP COLUMN IF EXISTS voyage_id;
--   -- restaurar o check histórico somente após remover qualquer invoice_type
--   -- manual criada por esta feature.

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS voyage_id bigint;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.invoices'::regclass
      AND conname = 'invoices_voyage_id_fkey'
  ) THEN
    ALTER TABLE public.invoices
      ADD CONSTRAINT invoices_voyage_id_fkey
      FOREIGN KEY (voyage_id) REFERENCES public.voyages(id) ON DELETE RESTRICT;
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_invoices_voyage_id
  ON public.invoices(voyage_id);

ALTER TABLE public.invoices
  DROP CONSTRAINT IF EXISTS invoices_invoice_type_check;

ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_invoice_type_check
  CHECK (invoice_type IN ('individual', 'consolidated', 'granite', 'manual'));

CREATE OR REPLACE FUNCTION public.create_manual_invoice(
  p_customer_id bigint,
  p_item_name text,
  p_quantity numeric,
  p_unit_value_brl numeric,
  p_description text DEFAULT NULL,
  p_bl_id text DEFAULT NULL,
  p_voyage_id bigint DEFAULT NULL,
  p_actor uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := COALESCE(p_actor, auth.uid());
  v_item_name text := NULLIF(btrim(COALESCE(p_item_name, '')), '');
  v_description text := NULLIF(btrim(COALESCE(p_description, '')), '');
  v_bl_id text := NULLIF(btrim(COALESCE(p_bl_id, '')), '');
  v_bl_customer_id bigint;
  v_bl_voyage_id bigint;
  v_voyage_id bigint := p_voyage_id;
  v_quantity numeric(10,3);
  v_unit_value_brl numeric(12,2);
  v_total_brl numeric(14,2);
  v_invoice_id bigint;
  v_invoice_number text;
BEGIN
  IF auth.uid() IS NULL
     OR NOT public.is_active_user()
     OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Credenciais invalidas ou sem permissao de faturamento.'
      USING ERRCODE = '42501';
  END IF;

  IF p_actor IS NOT NULL AND p_actor IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'O ator da emissão deve ser o usuário autenticado.'
      USING ERRCODE = '42501';
  END IF;

  IF v_item_name IS NULL THEN
    RAISE EXCEPTION 'Nome do item é obrigatório.' USING ERRCODE = '22023';
  END IF;

  IF p_quantity IS NULL
     OR p_quantity <= 0
     OR p_quantity::text IN ('NaN', 'Infinity', '-Infinity') THEN
    RAISE EXCEPTION 'Quantidade deve ser maior que zero.' USING ERRCODE = '22023';
  END IF;

  IF p_unit_value_brl IS NULL
     OR p_unit_value_brl <= 0
     OR p_unit_value_brl::text IN ('NaN', 'Infinity', '-Infinity') THEN
    RAISE EXCEPTION 'Valor unitário deve ser maior que zero.' USING ERRCODE = '22023';
  END IF;

  SELECT 1
  INTO STRICT v_bl_customer_id
  FROM public.customers
  WHERE id = p_customer_id;

  v_quantity := round(p_quantity, 3);
  v_unit_value_brl := round(p_unit_value_brl, 2);
  v_total_brl := round(v_quantity * v_unit_value_brl, 2);

  IF v_quantity <= 0 OR v_unit_value_brl <= 0 OR v_total_brl <= 0 THEN
    RAISE EXCEPTION 'Quantidade e valor unitário devem gerar um total positivo.'
      USING ERRCODE = '22023';
  END IF;

  IF v_bl_id IS NOT NULL THEN
    SELECT b.customer_id, b.voyage_id
    INTO v_bl_customer_id, v_bl_voyage_id
    FROM public.bls AS b
    WHERE b.id = v_bl_id
    FOR SHARE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'B/L % não encontrado.', v_bl_id USING ERRCODE = 'P0002';
    END IF;

    IF v_bl_customer_id IS DISTINCT FROM p_customer_id THEN
      RAISE EXCEPTION 'B/L % não pertence ao cliente selecionado.', v_bl_id
        USING ERRCODE = '42501';
    END IF;

    IF p_voyage_id IS NOT NULL AND p_voyage_id IS DISTINCT FROM v_bl_voyage_id THEN
      RAISE EXCEPTION 'A viagem informada não pertence ao B/L %.', v_bl_id
        USING ERRCODE = '22023';
    END IF;

    v_voyage_id := v_bl_voyage_id;
  END IF;

  IF v_voyage_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.voyages WHERE id = v_voyage_id) THEN
    RAISE EXCEPTION 'Viagem % não encontrada.', v_voyage_id USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.invoices (
    customer_id,
    bl_id,
    voyage_id,
    issued_at,
    total_brl,
    status,
    notes,
    total_paid_brl,
    balance_brl,
    issued_by,
    invoice_type
  )
  VALUES (
    p_customer_id,
    v_bl_id,
    v_voyage_id,
    now(),
    v_total_brl,
    'issued',
    v_description,
    0,
    v_total_brl,
    v_actor,
    'manual'
  )
  RETURNING id, invoice_number
  INTO v_invoice_id, v_invoice_number;

  INSERT INTO public.invoice_items (
    invoice_id,
    description,
    quantity,
    unit_value_brl,
    total_value_brl,
    bl_id,
    source,
    currency
  )
  VALUES (
    v_invoice_id,
    v_item_name,
    v_quantity,
    v_unit_value_brl,
    v_total_brl,
    v_bl_id,
    'manual',
    'BRL'
  );

  INSERT INTO public.invoice_lifecycle_events (invoice_id, event_type, actor, payload)
  VALUES (
    v_invoice_id,
    'issued',
    v_actor,
    jsonb_build_object(
      'invoice_type', 'manual',
      'source', 'manual_invoice',
      'bl_id', v_bl_id,
      'voyage_id', v_voyage_id,
      'total_brl', v_total_brl
    )
  );

  INSERT INTO public.audit_logs (
    entity_type,
    entity_id,
    field_name,
    old_value,
    new_value,
    changed_by,
    justification
  )
  VALUES (
    'invoice',
    v_invoice_id::text,
    'manual_issue',
    NULL,
    jsonb_build_object('invoice_number', v_invoice_number, 'total_brl', v_total_brl)::text,
    v_actor,
    'Emissão de fatura avulsa'
  );

  RETURN jsonb_build_object(
    'invoice_id', v_invoice_id,
    'invoice_number', v_invoice_number,
    'invoice_type', 'manual',
    'status', 'issued',
    'total_brl', v_total_brl,
    'balance_brl', v_total_brl,
    'bl_id', v_bl_id,
    'voyage_id', v_voyage_id
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.create_manual_invoice(bigint, text, numeric, numeric, text, text, bigint, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_manual_invoice(bigint, text, numeric, numeric, text, text, bigint, uuid)
  TO authenticated;

-- A fatura avulsa usa o pagamento genérico e nunca o settlement do ledger.
-- `register_invoice_payment` já atualiza invoices/payments sem consultar
-- recebíveis; a referência direta ao BL manual não entra em invoice_bls.
-- O cancel_invoice existente também só recalcula BLs por invoice_bls, portanto
-- cancelar manual altera a invoice sem alterar o status financeiro do BL.

CREATE OR REPLACE FUNCTION public.populate_local_invoice_pix_payload()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.pix_payload IS NULL
     AND COALESCE(NEW.invoice_type, 'individual') IN ('individual', 'consolidated', 'manual')
     AND NULLIF(TRIM(COALESCE(NEW.invoice_number, '')), '') IS NOT NULL
     AND COALESCE(NEW.total_brl, 0) > 0 THEN
    NEW.pix_payload := public.build_transshipping_pix_payload(NEW.total_brl, NEW.invoice_number);
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.enforce_invoice_ce_on_issue()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bl RECORD;
  v_scan_links boolean := false;
BEGIN
  IF NEW.invoice_type = 'manual' THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'issued' THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.bl_id IS NOT NULL THEN
        PERFORM public.assert_bl_ce_mercante(NEW.bl_id);
      END IF;
      v_scan_links := true;
    ELSE
      IF OLD.status IS DISTINCT FROM NEW.status THEN
        IF NEW.bl_id IS NOT NULL THEN
          PERFORM public.assert_bl_ce_mercante(NEW.bl_id);
        END IF;
        v_scan_links := true;
      ELSIF OLD.bl_id IS DISTINCT FROM NEW.bl_id THEN
        IF NEW.bl_id IS NOT NULL THEN
          PERFORM public.assert_bl_ce_mercante(NEW.bl_id);
        END IF;
        RETURN NEW;
      ELSE
        RETURN NEW;
      END IF;
    END IF;

    IF v_scan_links THEN
      FOR v_bl IN
        SELECT ib.bl_id FROM public.invoice_bls AS ib WHERE ib.invoice_id = NEW.id
      LOOP
        PERFORM public.assert_bl_ce_mercante(v_bl.bl_id);
      END LOOP;

      FOR v_bl IN
        SELECT irl.bl_id
        FROM public.invoice_receivable_links AS irl
        WHERE irl.invoice_id = NEW.id AND irl.status = 'active'
      LOOP
        PERFORM public.assert_bl_ce_mercante(v_bl.bl_id);
      END LOOP;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.enforce_portal_invoice_bl_gate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_invoice_type text;
  v_status text;
  v_gate jsonb;
BEGIN
  SELECT i.invoice_type, i.status
  INTO v_invoice_type, v_status
  FROM public.invoices AS i
  WHERE i.id = NEW.invoice_id;

  IF v_invoice_type = 'manual' THEN
    RETURN NEW;
  END IF;

  IF v_status = 'issued' THEN
    v_gate := public.portal_billing_gate(NEW.bl_id);
    IF NOT COALESCE((v_gate->>'allowed')::boolean, false) THEN
      RAISE EXCEPTION 'Faturamento bloqueado pelo Portal para B/L %: %', NEW.bl_id, v_gate->>'reason'
        USING ERRCODE = 'P0003';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.enforce_portal_invoice_gate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_gate jsonb;
  v_bl record;
BEGIN
  IF NEW.invoice_type = 'manual' THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'issued' THEN
    IF NEW.bl_id IS NOT NULL THEN
      v_gate := public.portal_billing_gate(NEW.bl_id);
      IF NOT COALESCE((v_gate->>'allowed')::boolean, false) THEN
        RAISE EXCEPTION 'Faturamento bloqueado pelo Portal: %', v_gate->>'reason'
          USING ERRCODE = 'P0003';
      END IF;
    END IF;

    FOR v_bl IN
      SELECT ib.bl_id FROM public.invoice_bls AS ib WHERE ib.invoice_id = NEW.id
    LOOP
      v_gate := public.portal_billing_gate(v_bl.bl_id);
      IF NOT COALESCE((v_gate->>'allowed')::boolean, false) THEN
        RAISE EXCEPTION 'Faturamento bloqueado pelo Portal para B/L %: %', v_bl.bl_id, v_gate->>'reason'
          USING ERRCODE = 'P0003';
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$function$;

-- Keep the existing detail implementation private and add a small public
-- dispatcher for manual invoices. Local/consolidated/granite details retain
-- their historical fallback reconstruction unchanged.
ALTER FUNCTION public.list_invoice_details(bigint)
  RENAME TO _list_invoice_details_legacy_20260926;

CREATE OR REPLACE FUNCTION public.list_invoice_details(p_invoice_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_invoice_type text;
  v_invoice jsonb;
  v_bls jsonb;
  v_items jsonb;
  v_containers jsonb;
  v_payments jsonb;
BEGIN
  SELECT invoice_type INTO v_invoice_type
  FROM public.invoices
  WHERE id = p_invoice_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice % nao encontrada.', p_invoice_id USING ERRCODE = 'P0002';
  END IF;

  IF v_invoice_type IS DISTINCT FROM 'manual' THEN
    RETURN public._list_invoice_details_legacy_20260926(p_invoice_id);
  END IF;

  SELECT to_jsonb(i.*) || jsonb_build_object(
    'customer_name', c.name,
    'customer_cnpj_cpf', c.cnpj_cpf
  )
  INTO v_invoice
  FROM public.invoices AS i
  LEFT JOIN public.customers AS c ON c.id = i.customer_id
  WHERE i.id = p_invoice_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', NULL::bigint,
    'invoice_id', p_invoice_id,
    'bl_id', b.id,
    'charge_status_snapshot', b.charge_status,
    'financial_status_snapshot', b.financial_status,
    'subtotal_brl', COALESCE((SELECT SUM(ii.total_value_brl) FROM public.invoice_items AS ii WHERE ii.invoice_id = p_invoice_id AND ii.bl_id = b.id), 0),
    'subtotal_usd', 0,
    'created_at', NULL,
    'charge_status', b.charge_status,
    'financial_status', b.financial_status,
    'pol', b.pol,
    'pod', b.pod,
    'voyage_number', v.voyage_number,
    'vessel_name', vs.name
  )), '[]'::jsonb)
  INTO v_bls
  FROM public.invoices AS i
  JOIN public.bls AS b ON b.id = i.bl_id
  LEFT JOIN public.voyages AS v ON v.id = COALESCE(i.voyage_id, b.voyage_id)
  LEFT JOIN public.vessels AS vs ON vs.id = v.vessel_id
  WHERE i.id = p_invoice_id;

  SELECT COALESCE(jsonb_agg(to_jsonb(ii.*) ORDER BY ii.id), '[]'::jsonb)
  INTO v_items
  FROM public.invoice_items AS ii
  WHERE ii.invoice_id = p_invoice_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', c.id,
    'bl_id', c.bl_id,
    'container_number', c.container_number,
    'type', c.type,
    'seal_number', c.seal_number,
    'gross_weight_kg', c.gross_weight_kg
  ) ORDER BY c.container_number), '[]'::jsonb)
  INTO v_containers
  FROM public.bl_containers AS c
  JOIN public.invoices AS i ON i.bl_id = c.bl_id
  WHERE i.id = p_invoice_id;

  SELECT COALESCE(jsonb_agg(to_jsonb(p.*) ORDER BY p.paid_at DESC, p.id DESC), '[]'::jsonb)
  INTO v_payments
  FROM public.payments AS p
  WHERE p.invoice_id = p_invoice_id;

  RETURN jsonb_build_object(
    'invoice', v_invoice,
    'bls', v_bls,
    'items', v_items,
    'containers', v_containers,
    'payments', v_payments
  );
END;
$function$;

REVOKE ALL ON FUNCTION public._list_invoice_details_legacy_20260926(bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_invoice_details(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_invoice_details(bigint) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_pix_reconciliation_candidates(p_exception_id bigint)
RETURNS TABLE(source text, invoice_id bigint, doc_number text, amount_brl numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_exception public.pix_reconciliation_exceptions%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Credenciais invalidas ou sem permissao para reconciliacao PIX.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_exception
  FROM public.pix_reconciliation_exceptions
  WHERE id = p_exception_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Excecao PIX % nao encontrada.', p_exception_id USING ERRCODE = 'P0002';
  END IF;

  IF v_exception.normalized_txid = '' THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT 'local', i.id, COALESCE(i.invoice_number, i.id::text), COALESCE(i.balance_brl, i.total_brl, 0)
  FROM public.invoices AS i
  WHERE i.invoice_type IN ('individual', 'consolidated', 'manual')
    AND COALESCE(i.status, 'issued') IN ('issued', 'partially_paid', 'overdue')
    AND public.normalize_pix_txid(i.pix_txid) = v_exception.normalized_txid
  UNION ALL
  SELECT 'demurrage', d.id, d.doc_number, COALESCE(d.current_total_brl, 0)
  FROM public.demurrage_invoices AS d
  WHERE COALESCE(d.status, 'issued') IN ('issued', 'paid')
    AND public.normalize_pix_txid(d.pix_txid) = v_exception.normalized_txid
  ORDER BY 1, 3;
END;
$function$;

REVOKE ALL ON FUNCTION public.list_pix_reconciliation_candidates(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_pix_reconciliation_candidates(bigint) TO authenticated;

CREATE OR REPLACE FUNCTION public.reconcile_invoice_payment_by_txid(
  p_txid text,
  p_amount_brl numeric,
  p_paid_at timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_norm text;
  v_invoice_id bigint;
  v_invoice_type text;
  v_match_count integer;
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Credenciais invalidas ou sem permissao de faturamento.' USING ERRCODE = '42501';
  END IF;

  v_norm := upper(regexp_replace(COALESCE(p_txid, ''), '[^A-Za-z0-9]', '', 'g'));
  IF v_norm = '' THEN
    RETURN jsonb_build_object('matched', false, 'reason', 'empty_txid');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.ledger_settlements
    WHERE pix_txid IS NOT NULL
      AND upper(regexp_replace(pix_txid, '[^A-Za-z0-9]', '', 'g')) = v_norm
  ) OR EXISTS (
    SELECT 1
    FROM public.invoices
    WHERE invoice_type = 'manual'
      AND pix_txid IS NOT NULL
      AND upper(regexp_replace(pix_txid, '[^A-Za-z0-9]', '', 'g')) = v_norm
  ) THEN
    RETURN jsonb_build_object('matched', false, 'reason', 'already_reconciled');
  END IF;

  SELECT COUNT(*), MIN(id), MIN(invoice_type)
  INTO v_match_count, v_invoice_id, v_invoice_type
  FROM public.invoices
  WHERE invoice_type IN ('individual', 'consolidated', 'manual')
    AND COALESCE(status, 'issued') IN ('issued', 'partially_paid', 'overdue')
    AND upper(regexp_replace(COALESCE(invoice_number, ''), '[^A-Za-z0-9]', '', 'g')) = v_norm;

  IF v_match_count = 0 THEN
    RETURN jsonb_build_object('matched', false, 'reason', 'no_match');
  ELSIF v_match_count > 1 THEN
    RETURN jsonb_build_object('matched', false, 'reason', 'ambiguous');
  END IF;

  BEGIN
    IF v_invoice_type = 'manual' THEN
      -- Manual uses the generic payments path, never ledger_settlements.
      v_result := public.register_invoice_payment(
        p_invoice_id := v_invoice_id,
        p_amount_brl := p_amount_brl,
        p_payment_method := 'pix',
        p_paid_at := COALESCE(p_paid_at, now()),
        p_notes := 'Conciliacao automatica por TXID',
        p_actor := auth.uid()
      );

      UPDATE public.invoices
      SET pix_txid = p_txid, conciliated_by_extract = true
      WHERE id = v_invoice_id;

      INSERT INTO public.invoice_lifecycle_events (invoice_id, event_type, actor, payload)
      VALUES (
        v_invoice_id,
        'reconciled_by_txid',
        auth.uid(),
        jsonb_build_object('txid', p_txid, 'amount_brl', p_amount_brl, 'source', 'manual')
      );

      RETURN jsonb_build_object('matched', true, 'invoice_id', v_invoice_id, 'settled', true, 'payment', v_result);
    END IF;

    v_result := public.register_ledger_invoice_payment(
      p_invoice_id := v_invoice_id,
      p_amount_brl := p_amount_brl,
      p_method := 'pix',
      p_paid_at := COALESCE(p_paid_at, now()),
      p_pix_txid := p_txid,
      p_source := 'pix_extract',
      p_notes := 'Conciliacao automatica por TXID',
      p_actor := auth.uid()
    );
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('matched', true, 'invoice_id', v_invoice_id, 'settled', false, 'reason', SQLERRM);
  END;

  UPDATE public.invoices
  SET pix_txid = p_txid, conciliated_by_extract = true
  WHERE id = v_invoice_id;

  RETURN jsonb_build_object('matched', true, 'invoice_id', v_invoice_id, 'settled', true, 'payment', v_result);
END;
$function$;

REVOKE ALL ON FUNCTION public.reconcile_invoice_payment_by_txid(text, numeric, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reconcile_invoice_payment_by_txid(text, numeric, timestamptz) TO authenticated;

CREATE OR REPLACE FUNCTION public._portal_list_invoices_core(p_customer_id bigint)
RETURNS TABLE(
  id bigint,
  invoice_number text,
  issued_at timestamptz,
  total_brl numeric,
  total_paid_brl numeric,
  balance_brl numeric,
  status text,
  invoice_type text,
  vessels text[],
  voyages text[],
  vessel_voyages text[],
  bls text[],
  pods text[]
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  RETURN QUERY
  WITH linked_invoice_bls AS (
    SELECT ib.invoice_id, ib.bl_id
    FROM public.invoice_bls AS ib
    UNION
    SELECT irl.invoice_id, irl.bl_id
    FROM public.invoice_receivable_links AS irl
    WHERE irl.status = 'active'
  ),
  manual_context AS (
    SELECT
      i.id AS invoice_id,
      i.bl_id,
      b.pod,
      v.voyage_number,
      vs.name AS vessel_name
    FROM public.invoices AS i
    LEFT JOIN public.bls AS b ON b.id = i.bl_id
    LEFT JOIN public.voyages AS v ON v.id = COALESCE(i.voyage_id, b.voyage_id)
    LEFT JOIN public.vessels AS vs ON vs.id = v.vessel_id
    WHERE i.customer_id = p_customer_id
      AND i.invoice_type = 'manual'
  ),
  eligible_invoices AS (
    SELECT i.id AS invoice_id
    FROM public.invoices AS i
    WHERE i.customer_id = p_customer_id
      AND (
        i.invoice_type = 'manual'
        OR (
          EXISTS (
            SELECT 1 FROM linked_invoice_bls AS linked
            WHERE linked.invoice_id = i.id
          )
          AND NOT EXISTS (
            SELECT 1 FROM linked_invoice_bls AS linked
            WHERE linked.invoice_id = i.id
              AND NOT public.bl_has_portal_release(linked.bl_id)
          )
        )
      )
  ),
  bl_info AS (
    SELECT ib.invoice_id, ib.bl_id, b.pod, v.voyage_number, vs.name AS vessel_name
    FROM public.invoice_bls AS ib
    JOIN public.bls AS b ON b.id = ib.bl_id
    LEFT JOIN public.voyages AS v ON v.id = b.voyage_id
    LEFT JOIN public.vessels AS vs ON vs.id = v.vessel_id
    UNION ALL
    SELECT irl.invoice_id, irl.bl_id, irl.bl_snapshot->>'pod', v.voyage_number, vs.name
    FROM public.invoice_receivable_links AS irl
    LEFT JOIN public.voyages AS v ON v.id = (irl.bl_snapshot->>'voyage_id')::bigint
    LEFT JOIN public.vessels AS vs ON vs.id = v.vessel_id
    WHERE irl.status = 'active'
    UNION ALL
    SELECT invoice_id, bl_id, pod, voyage_number, vessel_name
    FROM manual_context
  ),
  agg AS (
    SELECT
      bl_info.invoice_id,
      array_agg(DISTINCT bl_info.vessel_name) FILTER (WHERE bl_info.vessel_name IS NOT NULL) AS vessels,
      array_agg(DISTINCT bl_info.voyage_number) FILTER (WHERE bl_info.voyage_number IS NOT NULL) AS voyages,
      array_agg(DISTINCT CASE
        WHEN bl_info.voyage_number IS NOT NULL AND bl_info.vessel_name IS NOT NULL
          THEN bl_info.vessel_name || ' / ' || bl_info.voyage_number
        ELSE bl_info.vessel_name
      END) FILTER (WHERE bl_info.vessel_name IS NOT NULL) AS vessel_voyages,
      array_agg(DISTINCT bl_info.bl_id) FILTER (WHERE bl_info.bl_id IS NOT NULL) AS bls,
      array_agg(DISTINCT bl_info.pod) FILTER (WHERE bl_info.pod IS NOT NULL) AS pods
    FROM bl_info
    GROUP BY bl_info.invoice_id
  )
  SELECT
    i.id,
    i.invoice_number,
    i.issued_at,
    i.total_brl,
    i.total_paid_brl,
    CASE
      WHEN i.invoice_type IN ('individual', 'consolidated') AND ledger.link_count > 0
        THEN ledger.balance_brl
      ELSE i.balance_brl
    END AS balance_brl,
    i.status,
    i.invoice_type,
    COALESCE(agg.vessels, '{}'::text[]),
    COALESCE(agg.voyages, '{}'::text[]),
    COALESCE(agg.vessel_voyages, '{}'::text[]),
    COALESCE(agg.bls, '{}'::text[]),
    COALESCE(agg.pods, '{}'::text[])
  FROM public.invoices AS i
  JOIN eligible_invoices AS eligible ON eligible.invoice_id = i.id
  LEFT JOIN agg ON agg.invoice_id = i.id
  LEFT JOIN LATERAL (
    SELECT
      COUNT(*) AS link_count,
      COALESCE(SUM(COALESCE(br.balance_brl, 0)), 0) AS balance_brl
    FROM public.invoice_receivable_links AS irl
    JOIN public.bl_receivables AS br ON br.id = irl.receivable_id
    WHERE irl.invoice_id = i.id AND irl.status = 'active'
  ) AS ledger ON true
  WHERE i.customer_id = p_customer_id
  ORDER BY i.created_at DESC;
END;
$function$;

-- `_portal_list_invoices_page_core` intentionally remains the pagination
-- adapter over `_portal_list_invoices_core`; manual rows therefore inherit
-- the same scoped list, vessel, voyage and BL filters without a second query.

CREATE OR REPLACE FUNCTION public._portal_invoice_details_core(p_customer_id bigint, p_invoice_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_raw jsonb;
  v_invoice jsonb;
  v_bls jsonb;
  v_items jsonb;
  v_containers jsonb;
  v_payments jsonb;
  v_voyage jsonb;
BEGIN
  v_raw := public._portal_invoice_details_core_unfiltered_20260920(p_customer_id, p_invoice_id);

  SELECT jsonb_build_object(
    'voyage_number', v.voyage_number,
    'vessel_name', vs.name
  )
  INTO v_voyage
  FROM public.voyages AS v
  LEFT JOIN public.vessels AS vs ON vs.id = v.vessel_id
  WHERE v.id = (v_raw #>> '{invoice,voyage_id}')::bigint;

  v_invoice := jsonb_build_object(
    'id', v_raw #> '{invoice,id}',
    'invoice_number', v_raw #> '{invoice,invoice_number}',
    'customer_id', v_raw #> '{invoice,customer_id}',
    'bl_id', v_raw #> '{invoice,bl_id}',
    'voyage_id', v_raw #> '{invoice,voyage_id}',
    'issued_at', v_raw #> '{invoice,issued_at}',
    'total_brl', v_raw #> '{invoice,total_brl}',
    'status', v_raw #> '{invoice,status}',
    'pix_payload', v_raw #> '{invoice,pix_payload}',
    'created_at', v_raw #> '{invoice,created_at}',
    'total_paid_brl', v_raw #> '{invoice,total_paid_brl}',
    'balance_brl', v_raw #> '{invoice,balance_brl}',
    'invoice_type', v_raw #> '{invoice,invoice_type}',
    'notes', v_raw #> '{invoice,notes}',
    'updated_at', v_raw #> '{invoice,updated_at}',
    'customer_name', v_raw #> '{invoice,customer_name}',
    'customer_cnpj_cpf', v_raw #> '{invoice,customer_cnpj_cpf}',
    'voyage_number', v_voyage->'voyage_number',
    'vessel_name', v_voyage->'vessel_name'
  );

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', row->'id',
    'invoice_id', row->'invoice_id',
    'bl_id', row->'bl_id',
    'charge_status_snapshot', row->'charge_status_snapshot',
    'financial_status_snapshot', row->'financial_status_snapshot',
    'subtotal_brl', row->'subtotal_brl',
    'subtotal_usd', row->'subtotal_usd',
    'created_at', row->'created_at',
    'charge_status', row->'charge_status',
    'financial_status', row->'financial_status',
    'pol', row->'pol',
    'pod', row->'pod',
    'voyage_number', row->'voyage_number',
    'vessel_name', row->'vessel_name'
  )), '[]'::jsonb)
  INTO v_bls
  FROM jsonb_array_elements(COALESCE(v_raw->'bls', '[]'::jsonb)) AS row;

  IF v_invoice->>'invoice_type' = 'manual'
     AND NULLIF(v_invoice->>'bl_id', '') IS NOT NULL
     AND v_bls = '[]'::jsonb THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', NULL::bigint,
      'invoice_id', p_invoice_id,
      'bl_id', b.id,
      'charge_status_snapshot', b.charge_status,
      'financial_status_snapshot', b.financial_status,
      'subtotal_brl', COALESCE((SELECT SUM(ii.total_value_brl) FROM public.invoice_items AS ii WHERE ii.invoice_id = p_invoice_id AND ii.bl_id = b.id), 0),
      'subtotal_usd', 0,
      'created_at', NULL,
      'charge_status', b.charge_status,
      'financial_status', b.financial_status,
      'pol', b.pol,
      'pod', b.pod,
      'voyage_number', v.voyage_number,
      'vessel_name', vs.name
    )), '[]'::jsonb)
    INTO v_bls
    FROM public.bls AS b
    LEFT JOIN public.voyages AS v ON v.id = b.voyage_id
    LEFT JOIN public.vessels AS vs ON vs.id = v.vessel_id
    WHERE b.id = v_invoice->>'bl_id';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', row->'id',
    'invoice_id', row->'invoice_id',
    'description', row->'description',
    'quantity', row->'quantity',
    'unit_value_brl', row->'unit_value_brl',
    'total_value_brl', row->'total_value_brl',
    'bl_id', row->'bl_id',
    'source', row->'source',
    'currency', row->'currency',
    'unit_value_usd', row->'unit_value_usd',
    'total_value_usd', row->'total_value_usd'
  )), '[]'::jsonb)
  INTO v_items
  FROM jsonb_array_elements(COALESCE(v_raw->'items', '[]'::jsonb)) AS row;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', row->'id',
    'bl_id', row->'bl_id',
    'container_number', row->'container_number',
    'type', row->'type',
    'seal_number', row->'seal_number',
    'gross_weight_kg', row->'gross_weight_kg'
  )), '[]'::jsonb)
  INTO v_containers
  FROM jsonb_array_elements(COALESCE(v_raw->'containers', '[]'::jsonb)) AS row;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', row->'id',
    'invoice_id', row->'invoice_id',
    'amount_brl', row->'amount_brl',
    'payment_method', row->'payment_method',
    'paid_at', row->'paid_at',
    'created_at', row->'created_at'
  )), '[]'::jsonb)
  INTO v_payments
  FROM jsonb_array_elements(COALESCE(v_raw->'payments', '[]'::jsonb)) AS row;

  RETURN jsonb_build_object(
    'invoice', v_invoice,
    'bls', v_bls,
    'items', v_items,
    'containers', v_containers,
    'payments', v_payments
  );
END;
$function$;

-- `confirm_unified_pix_matches` already routes source=local through
-- reconcile_invoice_payment_by_txid; that function now dispatches manual to
-- register_invoice_payment and keeps ledger_settlements untouched.
