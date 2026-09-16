-- 052: guards descobertos pela bateria financeira adversarial.
--
-- Esta migration fecha quatro invariantes que não podem depender da UI:
--   1. um receivable pode receber mais de uma baixa (pagamento parcial);
--   2. cancelamento exige justificativa explícita;
--   3. uma disputa aberta pausa recálculo cambial e cobrança;
--   4. uma mensagem originada por um usuário válido do Portal pode abrir o
--      alerta interno correspondente, sem abrir a escrita de alertas para o
--      papel authenticated.

-- ---------------------------------------------------------------------------
-- 1. O ledger precisa representar cada pagamento parcial separadamente.
-- ---------------------------------------------------------------------------
-- O índice anterior impedia a segunda baixa do mesmo receivable, embora o RPC
-- já calculasse corretamente o saldo residual. A identidade de uma alocação
-- é o par pagamento/receivable; pagamentos distintos para a mesma conta são
-- legítimos e devem permanecer auditáveis.
DROP INDEX IF EXISTS public.idx_ledger_settlements_one_live_receivable;

CREATE UNIQUE INDEX IF NOT EXISTS idx_ledger_settlements_payment_receivable
  ON public.ledger_settlements(payment_id, receivable_id)
  WHERE payment_id IS NOT NULL;

-- NULL nao participa da unicidade do indice acima. Uma alocacao sem
-- pagamento vinculado (backfill/importacao) continua sendo uma por
-- receivable, como era no contrato anterior.
CREATE UNIQUE INDEX IF NOT EXISTS idx_ledger_settlements_one_unpaid_receivable
  ON public.ledger_settlements(receivable_id)
  WHERE payment_id IS NULL;

-- O saldo da UI e do RPC nao e uma barreira suficiente: INSERT/UPDATE direto
-- por um papel autorizado tambem precisa respeitar o teto do receivable.
CREATE OR REPLACE FUNCTION public.guard_ledger_settlement_allocation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_original numeric(14,2);
  v_allocated numeric(14,2);
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.receivable_id IS DISTINCT FROM NEW.receivable_id THEN
    PERFORM 1
    FROM public.bl_receivables
    WHERE id = OLD.receivable_id
    FOR UPDATE;
  END IF;

  SELECT original_amount_brl
    INTO v_original
  FROM public.bl_receivables
  WHERE id = NEW.receivable_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Receivable % nao encontrado.', NEW.receivable_id
      USING ERRCODE = 'P0002';
  END IF;

  SELECT COALESCE(SUM(s.amount_brl), 0)
    INTO v_allocated
  FROM public.ledger_settlements AS s
  WHERE s.receivable_id = NEW.receivable_id
    AND (TG_OP <> 'UPDATE' OR s.id <> OLD.id);

  IF ROUND(v_allocated + COALESCE(NEW.amount_brl, 0), 2)
     > ROUND(COALESCE(v_original, 0) + 0.01, 2) THEN
    RAISE EXCEPTION 'Alocacao do receivable % excede o valor original (%).',
      NEW.receivable_id, v_original
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_ledger_settlement_allocation() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_ledger_settlement_allocation ON public.ledger_settlements;
CREATE TRIGGER trg_guard_ledger_settlement_allocation
BEFORE INSERT OR UPDATE ON public.ledger_settlements
FOR EACH ROW
EXECUTE FUNCTION public.guard_ledger_settlement_allocation();

-- O RPC calcula a alocacao antes de inserir o pagamento. Fazer a mesma
-- verificacao explicitamente preserva a fronteira mesmo se a ordem interna
-- do RPC mudar; o trigger acima continua sendo a ultima linha de defesa.
CREATE OR REPLACE FUNCTION public.assert_ledger_invoice_payment_allocation(
  p_invoice_id bigint,
  p_amount_brl numeric
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_open numeric(14,2);
  v_remaining numeric(14,2);
  v_allocation numeric(14,2);
  v_allocated numeric(14,2);
  v_receivable record;
BEGIN
  IF COALESCE(p_amount_brl, 0) <= 0 THEN
    RETURN;
  END IF;

  SELECT COALESCE(SUM(br.balance_brl), 0)
    INTO v_open
  FROM public.bl_receivables AS br
  JOIN public.invoice_receivable_links AS link
    ON link.receivable_id = br.id
   AND link.invoice_id = p_invoice_id
   AND link.status = 'active'
  WHERE br.status IN ('open', 'partially_settled')
    AND br.balance_brl > 0;

  v_remaining := ROUND(LEAST(ROUND(p_amount_brl::numeric, 2), v_open), 2);

  FOR v_receivable IN
    SELECT br.id, br.balance_brl, br.original_amount_brl
    FROM public.bl_receivables AS br
    JOIN public.invoice_receivable_links AS link
      ON link.receivable_id = br.id
     AND link.invoice_id = p_invoice_id
     AND link.status = 'active'
    WHERE br.status IN ('open', 'partially_settled')
      AND br.balance_brl > 0
    ORDER BY br.id
    FOR UPDATE OF br
  LOOP
    EXIT WHEN v_remaining <= 0;
    v_allocation := ROUND(LEAST(v_receivable.balance_brl, v_remaining), 2);
    CONTINUE WHEN v_allocation <= 0;

    SELECT COALESCE(SUM(s.amount_brl), 0)
      INTO v_allocated
    FROM public.ledger_settlements AS s
    WHERE s.receivable_id = v_receivable.id;

    IF ROUND(v_allocated + v_allocation, 2)
       > ROUND(COALESCE(v_receivable.original_amount_brl, 0) + 0.01, 2) THEN
      RAISE EXCEPTION 'Alocacao do receivable % excede o valor original (%).',
        v_receivable.id, v_receivable.original_amount_brl
        USING ERRCODE = '23514';
    END IF;
    v_remaining := ROUND(v_remaining - v_allocation, 2);
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_ledger_invoice_payment_allocation(bigint, numeric) FROM PUBLIC, anon, authenticated;

-- A implementação de 019 continua sendo a fonte do comportamento de
-- liquidação; este wrapper adiciona a guarda explícita antes de delegar.
DO $$
BEGIN
  IF to_regprocedure('public.register_ledger_invoice_payment_legacy_052(bigint,numeric,text,timestamptz,text,text,text,uuid)') IS NULL
     AND to_regprocedure('public.register_ledger_invoice_payment(bigint,numeric,text,timestamptz,text,text,text,uuid)') IS NOT NULL THEN
    ALTER FUNCTION public.register_ledger_invoice_payment(
      bigint, numeric, text, timestamptz, text, text, text, uuid
    ) RENAME TO register_ledger_invoice_payment_legacy_052;
  END IF;
END
$$;

REVOKE ALL ON FUNCTION public.register_ledger_invoice_payment_legacy_052(
  bigint, numeric, text, timestamptz, text, text, text, uuid
) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.register_ledger_invoice_payment(
  p_invoice_id bigint,
  p_amount_brl numeric,
  p_method text DEFAULT 'pix'::text,
  p_paid_at timestamptz DEFAULT now(),
  p_pix_txid text DEFAULT NULL::text,
  p_source text DEFAULT 'manual'::text,
  p_notes text DEFAULT NULL::text,
  p_actor uuid DEFAULT NULL::uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Credenciais invalidas ou sem permissao de faturamento.'
      USING ERRCODE = '42501';
  END IF;

  PERFORM public.assert_ledger_invoice_payment_allocation(p_invoice_id, p_amount_brl);

  RETURN public.register_ledger_invoice_payment_legacy_052(
    p_invoice_id, p_amount_brl, p_method, p_paid_at, p_pix_txid,
    p_source, p_notes, p_actor
  );
END;
$$;

REVOKE ALL ON FUNCTION public.register_ledger_invoice_payment(
  bigint, numeric, text, timestamptz, text, text, text, uuid
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_ledger_invoice_payment(
  bigint, numeric, text, timestamptz, text, text, text, uuid
) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Alertas de sistema podem ser materializados por um RPC Portal legítimo.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.alert_actor_is_authorized()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT auth.role() IS NOT DISTINCT FROM 'service_role'
    OR (pg_trigger_depth() > 0 AND current_setting('alerts.foundation_trigger', true) = 'on')
    OR (auth.uid() IS NOT NULL AND public.is_active_user())
    OR EXISTS (
      SELECT 1
      FROM pg_catalog.pg_class AS c
      JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
      WHERE n.oid = pg_catalog.pg_my_temp_schema()
        AND c.relname = current_setting('alerts.portal_dispute_context_table', true)
        AND c.relpersistence = 't'
        AND c.relkind = 'r'
        AND c.relowner = (
          SELECT r.oid
          FROM pg_catalog.pg_roles AS r
          WHERE r.rolname = current_user
        )
    );
$$;

REVOKE ALL ON FUNCTION public.alert_actor_is_authorized() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.alert_actor_is_authorized() TO authenticated, service_role;

-- O Portal pode materializar somente o alerta de disputa correspondente ao
-- cliente autenticado. A autorização é marcada por uma tabela temporária
-- criada dentro deste SECURITY DEFINER, nunca por um GUC fornecido pelo
-- chamador; assim, a mesma guarda também continua fechando os RPCs de alerta
-- de criação/resolução para qualquer outro usuário authenticated.
CREATE OR REPLACE FUNCTION public.block521_upsert_alert(
  p_type text,
  p_entity_type text,
  p_entity_id text,
  p_message text,
  p_source text,
  p_department text,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_destination text DEFAULT NULL::text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_result jsonb;
  v_portal_context boolean := false;
  v_context_created boolean := false;
  v_context_table text := format('vela_portal_dispute_alert_%s', replace(gen_random_uuid()::text, '-', ''));
  v_previous_context_table text := current_setting('alerts.portal_dispute_context_table', true);
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND NOT public.is_active_user() THEN
    IF auth.uid() IS NULL
       OR p_type IS DISTINCT FROM 'portal_dispute_opened'
       OR p_entity_type IS DISTINCT FROM 'demurrage_invoice'
       OR p_entity_id IS NULL
       OR p_entity_id !~ '^[0-9]+$'
       OR p_source IS NULL
       OR p_source NOT IN ('portal_dispute_message', 'portal_dispute_reopen_request')
       OR p_department IS DISTINCT FROM 'equipamentos' THEN
      RAISE EXCEPTION 'Portal nao pode criar este alerta.' USING ERRCODE = '42501';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM public.demurrage_invoices AS invoice
      WHERE invoice.id = p_entity_id::bigint
        AND invoice.customer_id = public.current_portal_customer_id()
    ) THEN
      RAISE EXCEPTION 'Portal nao pode criar este alerta.' USING ERRCODE = '42501';
    END IF;
    v_portal_context := true;
  END IF;

  IF v_portal_context THEN
    EXECUTE format(
      'CREATE TEMP TABLE pg_temp.%I (marker boolean NOT NULL) ON COMMIT DROP',
      v_context_table
    );
    v_context_created := true;
    EXECUTE format('INSERT INTO pg_temp.%I(marker) VALUES (true)', v_context_table);
    PERFORM set_config('alerts.portal_dispute_context_table', v_context_table, true);
  END IF;

  IF to_regprocedure('public.upsert_alert_item(text,text,text,text,text,text,jsonb,text)') IS NOT NULL THEN
    EXECUTE 'SELECT public.upsert_alert_item($1,$2,$3,$4,$5,$6,$7,$8)'
      INTO v_result
      USING p_type, p_entity_type, p_entity_id, p_message, p_source,
        p_department, COALESCE(p_metadata, '{}'::jsonb), p_destination;
  ELSE
    EXECUTE 'SELECT public.upsert_alert_item($1,$2,$3,$4,$5,$6,$7)'
      INTO v_result
      USING p_type, p_entity_type, p_entity_id, p_message, p_source,
        COALESCE(p_metadata, '{}'::jsonb), p_destination;
  END IF;

  IF v_context_created THEN
    EXECUTE format('DROP TABLE IF EXISTS pg_temp.%I', v_context_table);
    v_context_created := false;
    PERFORM set_config('alerts.portal_dispute_context_table', COALESCE(v_previous_context_table, ''), true);
  END IF;
  RETURN v_result;
EXCEPTION
  WHEN OTHERS THEN
    IF v_context_created THEN
      EXECUTE format('DROP TABLE IF EXISTS pg_temp.%I', v_context_table);
      v_context_created := false;
    END IF;
    PERFORM set_config('alerts.portal_dispute_context_table', COALESCE(v_previous_context_table, ''), true);
    RAISE;
END;
$$;

REVOKE ALL ON FUNCTION public.block521_upsert_alert(
  text, text, text, text, text, text, jsonb, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.block521_upsert_alert(
  text, text, text, text, text, text, jsonb, text
) TO service_role;

-- ---------------------------------------------------------------------------
-- 3. Cancelamento exige motivo, inclusive quando chamado diretamente.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancel_invoice(
  p_invoice_id bigint,
  p_reason text,
  p_actor uuid DEFAULT NULL::uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_invoice record;
  v_actor uuid;
  v_payment_count integer;
  v_effect_consumer boolean := auth.role() = 'service_role'
    AND current_setting('import_effects.consumer', true) = 'vehicle_followup';
BEGIN
  IF NOT v_effect_consumer
     AND (auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin()) THEN
    RAISE EXCEPTION 'Credenciais invalidas ou sem permissao de faturamento.'
      USING ERRCODE = '42501';
  END IF;

  IF NULLIF(TRIM(COALESCE(p_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Informe a justificativa para cancelar a invoice.'
      USING ERRCODE = '22023';
  END IF;

  v_actor := COALESCE(p_actor, auth.uid());

  SELECT * INTO v_invoice
  FROM public.invoices
  WHERE id = p_invoice_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice % nao encontrada.', p_invoice_id USING ERRCODE = 'P0002';
  END IF;

  IF COALESCE(v_invoice.status, 'issued') = 'cancelled' THEN
    RETURN jsonb_build_object('invoice_id', p_invoice_id, 'status', 'cancelled', 'changed', false);
  END IF;

  SELECT COUNT(*) INTO v_payment_count
  FROM public.payments
  WHERE invoice_id = p_invoice_id;

  IF v_payment_count > 0 THEN
    RAISE EXCEPTION 'Nao e permitido cancelar invoice com pagamentos registrados.'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.invoices
  SET
    status = 'cancelled',
    cancelled_at = now(),
    cancelled_by = v_actor,
    cancel_reason = TRIM(p_reason),
    balance_brl = GREATEST(COALESCE(total_brl, 0) - COALESCE(total_paid_brl, 0), 0)
  WHERE id = p_invoice_id;

  UPDATE public.billing_batches
  SET status = 'cancelled'
  WHERE invoice_id = p_invoice_id;

  UPDATE public.bls AS b
  SET financial_status = CASE
    WHEN EXISTS (
      SELECT 1
      FROM public.invoice_bls AS ib2
      JOIN public.invoices AS inv2 ON inv2.id = ib2.invoice_id
      WHERE ib2.bl_id = b.id
        AND inv2.id <> p_invoice_id
        AND COALESCE(inv2.status, 'issued') IN ('draft', 'issued', 'partially_paid', 'overdue')
    ) THEN 'invoiced'
    WHEN EXISTS (
      SELECT 1
      FROM public.invoice_bls AS ib3
      JOIN public.invoices AS inv3 ON inv3.id = ib3.invoice_id
      WHERE ib3.bl_id = b.id
        AND inv3.id <> p_invoice_id
        AND COALESCE(inv3.status, 'issued') = 'paid'
    ) THEN 'paid'
    ELSE 'pending'
  END
  WHERE b.id IN (
    SELECT ib.bl_id
    FROM public.invoice_bls AS ib
    WHERE ib.invoice_id = p_invoice_id
  );

  UPDATE public.granite_bls AS gb
  SET charge_status = CASE
    WHEN EXISTS (
      SELECT 1
      FROM public.invoice_granite_bls AS igb2
      JOIN public.invoices AS inv2 ON inv2.id = igb2.invoice_id
      WHERE igb2.granite_bl_id = gb.id
        AND inv2.id <> p_invoice_id
        AND COALESCE(inv2.status, 'issued') IN ('draft', 'issued', 'partially_paid', 'overdue', 'paid')
    ) THEN 'invoiced'
    ELSE 'ready_for_billing'
  END
  WHERE gb.id IN (
    SELECT igb.granite_bl_id
    FROM public.invoice_granite_bls AS igb
    WHERE igb.invoice_id = p_invoice_id
  );

  INSERT INTO public.audit_logs(
    entity_type, entity_id, field_name, old_value, new_value,
    changed_by, changed_at, justification
  ) VALUES (
    'invoice', p_invoice_id::text, 'cancel_invoice',
    COALESCE(v_invoice.status, 'issued'), 'cancelled', v_actor, now(),
    TRIM(p_reason)
  );

  RETURN jsonb_build_object('invoice_id', p_invoice_id, 'status', 'cancelled', 'changed', true);
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_invoice(bigint, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_invoice(bigint, text, uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. PTAX não altera invoice em disputa; a régua de dunning já tem o mesmo
--    gate em 041. Depois da resolução, o próximo recálculo volta a ser elegível.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.recalculate_demurrage_invoices(
  p_ptax numeric,
  p_quote_date date,
  p_source text DEFAULT 'bcb_live'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_roe numeric;
  v_updated integer := 0;
  v_inv record;
  v_total_brl numeric(14,2);
  v_pix_payload text;
  v_discount_usd numeric(12,2);
BEGIN
  IF p_ptax IS NULL OR p_ptax <= 0 OR p_ptax > 1000 OR p_ptax::text = 'NaN'
     OR p_quote_date IS NULL THEN
    RAISE EXCEPTION 'PTAX e data de cotacao sao obrigatorias.' USING ERRCODE = '22023';
  END IF;
  IF p_source NOT IN ('bcb_live', 'cached', 'manual') THEN
    RAISE EXCEPTION 'Origem de PTAX invalida: %.', p_source USING ERRCODE = '22023';
  END IF;

  v_roe := public._demurrage_roe_from_ptax(p_ptax);
  PERFORM public.save_exchange_rate_reference_v2(
    p_ptax, v_roe, p_quote_date, p_source, p_quote_date
  );

  FOR v_inv IN
    SELECT id, total_usd, COALESCE(discount_value, 0) AS discount_value,
           discount_mode, doc_number, current_roe
    FROM public.demurrage_invoices
    WHERE status = 'issued'
      AND paid_at IS NULL
      AND COALESCE(dispute_open, false) = false
    FOR UPDATE
  LOOP
    CONTINUE WHEN v_inv.current_roe IS NOT NULL AND v_inv.current_roe = v_roe;

    v_discount_usd := 0;
    IF v_inv.discount_value > 0 THEN
      IF v_inv.discount_mode = 'percent' THEN
        v_discount_usd := round(v_inv.total_usd * (v_inv.discount_value / 100), 2);
      ELSE
        v_discount_usd := v_inv.discount_value;
      END IF;
    END IF;

    v_total_brl := round(greatest(v_inv.total_usd - v_discount_usd, 0) * v_roe, 2);
    v_pix_payload := CASE
      WHEN v_total_brl > 0 THEN public.build_transshipping_pix_payload(v_total_brl, v_inv.doc_number)
      ELSE NULL
    END;

    UPDATE public.demurrage_invoices
       SET current_roe = v_roe,
           current_total_brl = v_total_brl,
           roe_source = p_source,
           pix_payload = v_pix_payload,
           updated_at = now()
     WHERE id = v_inv.id;

    INSERT INTO public.demurrage_invoice_history(
      invoice_id, event_date, ptax_used, roe_used, total_usd, total_brl, discount_usd, source
    ) VALUES (
      v_inv.id, p_quote_date, p_ptax, v_roe, v_inv.total_usd, v_total_brl, v_discount_usd, p_source
    );
    v_updated := v_updated + 1;
  END LOOP;

  RETURN jsonb_build_object('updated', v_updated, 'roe', v_roe, 'quote_date', p_quote_date, 'source', p_source);
END;
$$;

REVOKE ALL ON FUNCTION public.recalculate_demurrage_invoices(numeric, date, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recalculate_demurrage_invoices(numeric, date, text) TO service_role;
