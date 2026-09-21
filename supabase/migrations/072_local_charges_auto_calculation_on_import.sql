-- 072: Calculo automatico de taxas locais na importacao de B/L, recalculo no
-- vinculo posterior de cliente e desacoplamento na sincronizacao do recebivel.
-- Esta migration depende da afirmacao "Data status" do AGENTS.md: a base de
-- producao ainda contem apenas fixtures e as linhas existentes podem ser
-- normalizadas.

-- ---------------------------------------------------------------------------
-- 1. sync_local_charge_receivable: nao abortar quando o B/L nao tiver cliente
-- ---------------------------------------------------------------------------
-- O calculo automatico de taxas locais precisa ocorrer logo no import do B/L,
-- independentemente de o cliente ter sido previamente conciliado ou nao.
-- Um B/L sem cliente (customer_id IS NULL) tem seu subtotal e itens tarifarios
-- calculados com base na tabela da rota/porto, mas nao gera registro no ledger
-- (bl_receivables) ate que o cliente seja vinculado no fluxo de reconciliacao.
CREATE OR REPLACE FUNCTION public.sync_local_charge_receivable(p_bl_id text) RETURNS bigint
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_bl RECORD;
  v_amount NUMERIC(14,2);
  v_roe NUMERIC(10,4);
  v_roe_effective_date DATE;
  v_paid_amount NUMERIC(14,2);
  v_receivable_id BIGINT;
  v_status TEXT;
BEGIN
  IF auth.uid() IS NOT NULL
     AND NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Credenciais invalidas ou sem permissao de faturamento.' USING ERRCODE = '42501';
  END IF;

  SELECT id, customer_id, voyage_id, cargo_mode, pol, pod
  INTO v_bl
  FROM public.bls
  WHERE id = UPPER(TRIM(p_bl_id));

  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L % nao encontrado.', p_bl_id USING ERRCODE = 'P0002';
  END IF;

  -- Se o B/L ainda nao tem cliente vinculado, a sincronizacao de recebivel
  -- aguarda a conciliacao cadastral (reconcile/relink). O calculo das taxas
  -- locais permanece preservado.
  IF v_bl.customer_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT roe, effective_date INTO v_roe, v_roe_effective_date
  FROM public.exchange_rate_reference WHERE id = 1;

  IF v_roe IS NULL AND EXISTS (\
    SELECT 1 FROM public.charge_calculations AS cc
    WHERE cc.bl_id = v_bl.id
      AND COALESCE(cc.total_value_usd, 0) > 0
      AND COALESCE(cc.status, 'calculated') IN ('calculated', 'reviewed', 'ready_for_billing')
  ) THEN
    RAISE EXCEPTION 'Cambio (ROE) nao configurado; nao e possivel calcular o saldo de linhas em USD.' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(SUM(
    COALESCE(cc.total_value_brl, CASE WHEN COALESCE(cc.total_value_usd, 0) > 0 THEN ROUND(cc.total_value_usd * v_roe, 2) END, 0)
  ), 0)
  INTO v_amount
  FROM public.charge_calculations AS cc
  WHERE cc.bl_id = v_bl.id
    AND COALESCE(cc.status, 'calculated') IN ('calculated', 'reviewed', 'ready_for_billing');

  SELECT COALESCE(SUM(p.amount_brl), 0)
  INTO v_paid_amount
  FROM public.invoice_bls ib
  JOIN public.invoices i ON i.id = ib.invoice_id
  JOIN public.payments p ON p.invoice_id = i.id
  WHERE ib.bl_id = v_bl.id
    AND COALESCE(i.status, 'issued') = 'paid';

  v_paid_amount := LEAST(v_paid_amount, v_amount);
  v_status := CASE
    WHEN v_amount <= 0 THEN 'void'
    WHEN v_paid_amount >= v_amount THEN 'settled'
    WHEN v_paid_amount > 0 THEN 'partially_settled'
    ELSE 'open'
  END;

  INSERT INTO public.bl_receivables (
    bl_id, customer_id, source, original_amount_brl, settled_amount_brl, balance_brl,
    status, voyage_id, cargo_mode, pol, pod, roe_frozen, roe_effective_date_frozen, updated_at
  )
  VALUES (
    v_bl.id, v_bl.customer_id, 'local_charges', v_amount, v_paid_amount,
    GREATEST(v_amount - v_paid_amount, 0), v_status, v_bl.voyage_id,
    v_bl.cargo_mode, v_bl.pol, v_bl.pod, v_roe, v_roe_effective_date, now()
  )
  ON CONFLICT (source, bl_id)
  DO UPDATE SET
    customer_id = EXCLUDED.customer_id,
    original_amount_brl = EXCLUDED.original_amount_brl,
    settled_amount_brl = EXCLUDED.settled_amount_brl,
    balance_brl = EXCLUDED.balance_brl,
    status = EXCLUDED.status,
    voyage_id = EXCLUDED.voyage_id,
    cargo_mode = EXCLUDED.cargo_mode,
    pol = EXCLUDED.pol,
    pod = EXCLUDED.pod,
    roe_frozen = EXCLUDED.roe_frozen,
    roe_effective_date_frozen = EXCLUDED.roe_effective_date_frozen,
    updated_at = now()
  RETURNING id INTO v_receivable_id;

  RETURN v_receivable_id;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_local_charge_receivable(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_local_charge_receivable(text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. calculate_bl_local_charges_batch: recalculo rapido e isolado em lote
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.calculate_bl_local_charges_batch(
  p_bl_ids text[],
  p_actor uuid DEFAULT NULL::uuid,
  p_recalculate boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_bl_id text;
  v_actor uuid;
  v_results jsonb := '[]'::jsonb;
  v_total integer := 0;
  v_success_count integer := 0;
  v_error_count integer := 0;
  v_errors jsonb := '[]'::jsonb;
  v_res jsonb;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa' USING ERRCODE = '42501';
  END IF;

  IF p_actor IS NOT NULL AND auth.uid() IS NOT NULL AND NOT public.is_admin() THEN
    v_actor := auth.uid();
  ELSE
    v_actor := COALESCE(p_actor, auth.uid());
  END IF;

  IF p_bl_ids IS NULL OR cardinality(p_bl_ids) = 0 THEN
    RETURN jsonb_build_object(
      'total', 0,
      'success_count', 0,
      'error_count', 0,
      'results', '[]'::jsonb,
      'errors', '[]'::jsonb
    );
  END IF;

  FOREACH v_bl_id IN ARRAY p_bl_ids LOOP
    v_bl_id := UPPER(TRIM(v_bl_id));
    CONTINUE WHEN v_bl_id IS NULL OR v_bl_id = '';
    v_total := v_total + 1;
    BEGIN
      v_res := public.calculate_bl_local_charges(v_bl_id, v_actor, p_recalculate);
      v_results := v_results || jsonb_build_array(v_res);
      v_success_count := v_success_count + 1;
    EXCEPTION WHEN OTHERS THEN
      v_error_count := v_error_count + 1;
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'bl_id', v_bl_id,
        'message', SQLERRM
      ));
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'total', v_total,
    'success_count', v_success_count,
    'error_count', v_error_count,
    'results', v_results,
    'errors', v_errors
  );
END;
$$;

REVOKE ALL ON FUNCTION public.calculate_bl_local_charges_batch(text[], uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.calculate_bl_local_charges_batch(text[], uuid, boolean) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. import_bl_freight_with_metadata: disparo imediato do calculo inicial
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.import_bl_freight_with_metadata(
  p_bls jsonb,
  p_changed_by uuid,
  p_batch jsonb DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_result jsonb;
  v_batch_id bigint := NULL;
  v_filename text;
  v_voyage_id bigint;
  v_cargo_mode text := 'container';
  v_total_bls integer;
  v_bl_id text;
  v_mismatch integer := 0;
  v_updated integer := 0;
  v_action_id uuid := gen_random_uuid();
  v_item jsonb;
  v_physical_effect jsonb;
  v_physical_effect_id bigint;
  v_calc_errors jsonb := '[]'::jsonb;
BEGIN
  IF v_actor IS NULL OR NOT public.is_active_user() OR p_changed_by IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa.' USING ERRCODE = '42501';
  END IF;
  IF p_bls IS NULL OR jsonb_typeof(p_bls) <> 'array' OR jsonb_array_length(p_bls) = 0 THEN
    RAISE EXCEPTION 'Nenhum B/L informado.' USING ERRCODE = '22023';
  END IF;

  v_result := public.import_bl_freight_transactional(p_bls, p_changed_by);

  IF p_batch IS NULL THEN
    RETURN jsonb_build_object('result', v_result, 'batch_id', NULL);
  END IF;

  v_filename := NULLIF(btrim(COALESCE(p_batch->>'filename', '')), '');
  v_voyage_id := NULLIF(btrim(COALESCE(p_batch->>'voyage_id', '')), '')::bigint;
  v_cargo_mode := COALESCE(NULLIF(btrim(COALESCE(p_batch->>'cargo_mode', '')), ''), 'container');
  IF v_filename IS NULL OR v_voyage_id IS NULL THEN
    RAISE EXCEPTION 'Batch invalido: filename e voyage_id obrigatorios.' USING ERRCODE = '22023';
  END IF;
  IF v_cargo_mode NOT IN ('container', 'carga_solta') THEN
    RAISE EXCEPTION 'cargo_mode de batch invalido.' USING ERRCODE = '22023';
  END IF;

  PERFORM 1 FROM public.voyages WHERE id = v_voyage_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Viagem % nao encontrada', v_voyage_id USING ERRCODE = 'P0002';
  END IF;

  SELECT count(*) INTO v_mismatch
  FROM jsonb_array_elements(p_bls) AS item
  WHERE (item->>'voyage_id')::bigint IS DISTINCT FROM v_voyage_id;
  IF v_mismatch > 0 THEN
    RAISE EXCEPTION 'Batch da viagem % com B/L de outra viagem.', v_voyage_id USING ERRCODE = '22023';
  END IF;

  v_total_bls := jsonb_array_length(p_bls);

  INSERT INTO public.import_batches(
    filename, voyage_id, cargo_mode, uploaded_by, status, total_bls, total_containers
  ) VALUES (
    v_filename, v_voyage_id, v_cargo_mode, v_actor, 'completed', v_total_bls, NULL
  ) RETURNING id INTO v_batch_id;

  UPDATE public.bls AS b
    SET batch_id = v_batch_id
    FROM jsonb_array_elements(p_bls) AS item
    WHERE b.id = item->>'id' AND b.voyage_id = v_voyage_id;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated <> v_total_bls THEN
    RAISE EXCEPTION 'Vinculo de batch falhou: % de % B/Ls vinculados.', v_updated, v_total_bls USING ERRCODE = 'P0002';
  END IF;

  v_physical_effect := public.enqueue_import_effect(
    v_action_id,
    'physical_flags',
    v_voyage_id::text,
    v_actor,
    1,
    NULL,
    jsonb_build_object(
      'filename', v_filename,
      'voyage_id', v_voyage_id,
      'cargo_mode', v_cargo_mode,
      'bl_count', v_total_bls
    )
  );
  v_physical_effect_id := NULLIF(v_physical_effect->'effect'->>'id', '')::bigint;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_bls)
  LOOP
    -- Preserva o ID exato que foi persistido em public.bls
    v_bl_id := v_item->>'id';
    CONTINUE WHEN v_bl_id IS NULL OR btrim(v_bl_id) = '';

    -- Disparo imediato do calculo inicial das taxas locais com base nas tabelas cadastradas
    BEGIN
      PERFORM public.calculate_bl_local_charges(v_bl_id, v_actor, true);
    EXCEPTION WHEN OTHERS THEN
      -- Registra rastro detalhado do erro em audit_logs e acumula no retorno do batch
      v_calc_errors := v_calc_errors || jsonb_build_array(jsonb_build_object(
        'bl_id', v_bl_id,
        'message', SQLERRM
      ));
      INSERT INTO public.audit_logs (
        entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification
      ) VALUES (
        'bl', v_bl_id, 'local_charges_auto_calc_error', NULL, SQLERRM, v_actor, now(),
        'Falha no calculo automatico de taxas locais na importacao do B/L'
      );
    END;

    -- Mantem provisional_charges enfileirado como contingencia assincrona / recuperacao idempotente
    PERFORM public.enqueue_import_effect(
      v_action_id,
      'provisional_charges',
      v_bl_id,
      v_actor,
      1,
      v_physical_effect_id,
      jsonb_build_object(
        'filename', v_filename,
        'voyage_id', v_voyage_id,
        'cargo_mode', v_cargo_mode
      )
    );
  END LOOP;

  RETURN jsonb_build_object('result', v_result, 'batch_id', v_batch_id, 'calculation_errors', v_calc_errors);
END;
$$;

REVOKE ALL ON FUNCTION public.import_bl_freight_with_metadata(jsonb, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_bl_freight_with_metadata(jsonb, uuid, jsonb) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. approve_customer_reconciliation: recalcular taxas ao aprovar conciliacao
-- ---------------------------------------------------------------------------
-- Quando o cliente e conciliado posteriormente, o B/L deve recalcular suas
-- taxas locais com as condicoes especiais do cliente aprovado e gerar/atualizar
-- o recebivel no ledger (bl_receivables).
CREATE OR REPLACE FUNCTION public.approve_customer_reconciliation(
  p_queue_id bigint,
  p_customer_id bigint DEFAULT NULL::bigint,
  p_notes text DEFAULT NULL::text,
  p_actor uuid DEFAULT NULL::uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_queue RECORD;
  v_actor UUID;
  v_target_customer_id BIGINT;
  v_financial_status TEXT;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa' USING ERRCODE = '42501';
  END IF;

  v_actor := COALESCE(p_actor, auth.uid());

  SELECT * INTO v_queue
  FROM public.customer_reconciliation_queue
  WHERE id = p_queue_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item de reconciliacao % nao encontrado.', p_queue_id USING ERRCODE = 'P0002';
  END IF;

  v_target_customer_id := COALESCE(p_customer_id, v_queue.customer_id);
  IF v_target_customer_id IS NULL THEN
    RAISE EXCEPTION 'Informe um cliente para aprovar a reconciliacao.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.bls
  SET
    customer_id = v_target_customer_id,
    suggested_customer_id = NULL,
    customer_reconciliation_status = 'reconciled',
    customer_reconciliation_notes = COALESCE(NULLIF(TRIM(COALESCE(p_notes, '')), ''), 'Cliente reconciliado manualmente.'),
    billing_hold_reason = NULL
  WHERE id = v_queue.bl_id;

  UPDATE public.customer_reconciliation_queue
  SET
    customer_id = v_target_customer_id,
    status = 'approved',
    resolution_notes = COALESCE(NULLIF(TRIM(COALESCE(p_notes, '')), ''), 'Cliente reconciliado manualmente.'),
    approved_by = v_actor,
    approved_at = now(),
    rejected_by = NULL,
    rejected_at = NULL
  WHERE id = p_queue_id;

  PERFORM public.capture_manifest_financial_contact(
    v_target_customer_id,
    v_queue.manifest_customer_email
  );

  PERFORM public.sync_customer_reconciliation_queue_for_bl(v_queue.bl_id);

  -- Se o B/L ainda nao foi faturado, recalcula as taxas locais com as condicoes
  -- especiais do novo cliente vinculado e gera o recebivel no ledger (bl_receivables)
  SELECT financial_status INTO v_financial_status
  FROM public.bls
  WHERE id = v_queue.bl_id;

  IF v_financial_status IS NULL OR v_financial_status = 'pending' THEN
    BEGIN
      PERFORM public.calculate_bl_local_charges(v_queue.bl_id, v_actor, true);
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification)
      VALUES (
        'bl', v_queue.bl_id, 'local_charges_reconciliation_calc_error', NULL, SQLERRM,
        v_actor, now(), 'Falha no recalculo de taxas locais apos aprovacao de reconciliacao de cliente.'
      );
    END;
  END IF;

  INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification)
  VALUES (
    'bl', v_queue.bl_id, 'customer_reconciliation_status', COALESCE(v_queue.status, 'pending'), 'reconciled',
    v_actor, now(), COALESCE(NULLIF(TRIM(COALESCE(p_notes, '')), ''), 'Cliente reconciliado manualmente.')
  );

  RETURN jsonb_build_object('queue_id', p_queue_id, 'bl_id', v_queue.bl_id, 'customer_id', v_target_customer_id, 'status', 'approved');
END;
$$;

REVOKE ALL ON FUNCTION public.approve_customer_reconciliation(bigint, bigint, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_customer_reconciliation(bigint, bigint, text, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. relink_bl_customer_legacy_070: recalcular taxas ao relinkar cliente
-- ---------------------------------------------------------------------------
-- Se a troca de consignatario/cliente for aceita e o B/L estiver pendente de
-- faturamento, as linhas de calculo sao recalculadas com as regras do novo
-- cliente e o recebivel no ledger e atualizado.
CREATE OR REPLACE FUNCTION public.relink_bl_customer_legacy_070(
  p_bl_id text,
  p_customer_id bigint,
  p_changed_by uuid,
  p_reason text DEFAULT 'Troca de consignatario na reimportacao do B/L'::text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_bl public.bls%ROWTYPE;
  v_blockers TEXT[] := ARRAY[]::TEXT[];
  v_invoice RECORD;
  v_moved_invoices TEXT[] := ARRAY[]::TEXT[];
  v_has_financials BOOLEAN;
  v_settled_receivables INTEGER;
  v_status TEXT;
BEGIN
  SELECT * INTO v_bl FROM public.bls WHERE id = p_bl_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('bl_id', p_bl_id, 'applied', false, 'blockers', ARRAY['B/L nao encontrado.']);
  END IF;

  IF v_bl.customer_id IS NOT DISTINCT FROM p_customer_id THEN
    RETURN jsonb_build_object('bl_id', p_bl_id, 'applied', false, 'blockers', ARRAY[]::TEXT[], 'unchanged', true);
  END IF;

  IF p_customer_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.customers WHERE id = p_customer_id) THEN
    RETURN jsonb_build_object(
      'bl_id', p_bl_id,
      'applied', false,
      'blockers', ARRAY['Cliente de destino nao existe.']
    );
  END IF;

  FOR v_invoice IN
    SELECT
      i.id,
      i.invoice_number,
      i.status,
      i.total_paid_brl,
      (SELECT COUNT(*) FROM public.invoice_bls AS ib2 WHERE ib2.invoice_id = i.id) AS bl_count
    FROM public.invoice_bls AS ib
    JOIN public.invoices AS i ON i.id = ib.invoice_id
    WHERE ib.bl_id = p_bl_id
      AND i.status NOT IN ('cancelled', 'obsolete')
    ORDER BY i.id
  LOOP
    IF v_invoice.bl_count > 1 THEN
      v_blockers := array_append(
        v_blockers,
        format('Fatura %s e consolidada com outros B/Ls.', v_invoice.invoice_number)
      );
    ELSIF COALESCE(v_invoice.total_paid_brl, 0) > 0 OR v_invoice.status = 'paid' THEN
      v_blockers := array_append(
        v_blockers,
        format('Fatura %s ja tem pagamento registrado.', v_invoice.invoice_number)
      );
    END IF;
  END LOOP;

  FOR v_invoice IN
    SELECT id, doc_number, status
    FROM public.demurrage_invoices
    WHERE bl_id = p_bl_id
      AND COALESCE(status, '') NOT IN ('cancelled', 'obsolete')
    ORDER BY id
  LOOP
    IF v_invoice.status = 'paid' THEN
      v_blockers := array_append(
        v_blockers,
        format('Demurrage %s ja esta quitada.', v_invoice.doc_number)
      );
    END IF;
  END LOOP;

  SELECT COUNT(*) INTO v_settled_receivables
  FROM public.bl_receivables
  WHERE bl_id = p_bl_id
    AND status <> 'void'
    AND COALESCE(settled_amount_brl, 0) > 0;

  IF v_settled_receivables > 0 THEN
    v_blockers := array_append(
      v_blockers,
      'Recebivel do B/L ja tem baixa registrada; estorne no razao antes de trocar o cliente.'
    );
  END IF;

  v_has_financials :=
    EXISTS (
      SELECT 1
      FROM public.invoice_bls AS ib
      JOIN public.invoices AS i ON i.id = ib.invoice_id
      WHERE ib.bl_id = p_bl_id AND i.status NOT IN ('cancelled', 'obsolete')
    )
    OR EXISTS (SELECT 1 FROM public.bl_receivables WHERE bl_id = p_bl_id AND status <> 'void')
    OR EXISTS (
      SELECT 1 FROM public.demurrage_invoices
      WHERE bl_id = p_bl_id AND COALESCE(status, '') NOT IN ('cancelled', 'obsolete')
    );

  IF p_customer_id IS NULL AND v_has_financials THEN
    v_blockers := array_append(
      v_blockers,
      'Novo consignatario nao esta cadastrado como cliente; cadastre-o antes de trocar o B/L faturado.'
    );
  END IF;

  IF cardinality(v_blockers) > 0 THEN
    RETURN jsonb_build_object('bl_id', p_bl_id, 'applied', false, 'blockers', v_blockers);
  END IF;

  UPDATE public.bls
  SET
    customer_id = p_customer_id,
    customer_reconciliation_status = CASE WHEN p_customer_id IS NULL THEN 'missing_customer' ELSE 'reconciled' END,
    customer_reconciliation_notes = CASE
      WHEN p_customer_id IS NULL THEN 'Consignatario reimportado ainda sem cliente cadastrado.'
      ELSE 'Cliente trocado pela reimportacao do B/L (novo consignatario).'
    END,
    billing_hold_reason = CASE
      WHEN p_customer_id IS NULL THEN 'Aguardando reconciliacao de cliente antes do faturamento.'
      ELSE NULL
    END
  WHERE id = p_bl_id;

  INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  VALUES ('bl', p_bl_id, 'customer_id', v_bl.customer_id::TEXT, p_customer_id::TEXT, p_changed_by, p_reason);

  IF p_customer_id IS NOT NULL THEN
    FOR v_invoice IN
      SELECT i.id, i.invoice_number, i.customer_id
      FROM public.invoice_bls AS ib
      JOIN public.invoices AS i ON i.id = ib.invoice_id
      WHERE ib.bl_id = p_bl_id
        AND i.status NOT IN ('cancelled', 'obsolete')
        AND i.customer_id IS DISTINCT FROM p_customer_id
      ORDER BY i.id
    LOOP
      UPDATE public.invoices SET customer_id = p_customer_id, updated_at = now() WHERE id = v_invoice.id;
      v_moved_invoices := array_append(v_moved_invoices, v_invoice.invoice_number);

      INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
      VALUES ('invoice', v_invoice.id::TEXT, 'customer_id', v_invoice.customer_id::TEXT, p_customer_id::TEXT, p_changed_by, p_reason);
    END LOOP;

    FOR v_invoice IN
      SELECT id, doc_number, customer_id
      FROM public.demurrage_invoices
      WHERE bl_id = p_bl_id
        AND COALESCE(status, '') NOT IN ('cancelled', 'obsolete')
        AND customer_id IS DISTINCT FROM p_customer_id
      ORDER BY id
    LOOP
      UPDATE public.demurrage_invoices SET customer_id = p_customer_id, updated_at = now() WHERE id = v_invoice.id;
      v_moved_invoices := array_append(v_moved_invoices, v_invoice.doc_number);

      INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
      VALUES ('bl', p_bl_id, format('demurrage_%s_customer_id', v_invoice.doc_number), v_invoice.customer_id::TEXT, p_customer_id::TEXT, p_changed_by, p_reason);
    END LOOP;

    UPDATE public.bl_receivables
    SET customer_id = p_customer_id, updated_at = now()
    WHERE bl_id = p_bl_id
      AND status <> 'void'
      AND customer_id IS DISTINCT FROM p_customer_id;
  END IF;

  PERFORM public.sync_customer_reconciliation_queue_for_bl(p_bl_id);

  -- Se o cliente foi alterado e o B/L ainda esta pendente de faturamento,
  -- recalcula as taxas locais com as condicoes especiais do novo cliente
  -- e atualiza o recebivel correspondente em bl_receivables.
  IF p_customer_id IS NOT NULL AND (v_bl.financial_status IS NULL OR v_bl.financial_status = 'pending') THEN
    BEGIN
      PERFORM public.calculate_bl_local_charges(p_bl_id, p_changed_by, true);
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
      VALUES ('bl', p_bl_id, 'local_charges_relink_calc_error', NULL, SQLERRM, p_changed_by, 'Falha no recalculo de taxas apos relink de cliente');
    END;
  END IF;

  SELECT review_status INTO v_status FROM public.bls WHERE id = p_bl_id;

  RETURN jsonb_build_object(
    'bl_id', p_bl_id,
    'applied', true,
    'blockers', ARRAY[]::TEXT[],
    'from_customer_id', v_bl.customer_id,
    'to_customer_id', p_customer_id,
    'moved_invoices', to_jsonb(v_moved_invoices),
    'review_status', v_status
  );
END;
$$;

REVOKE ALL ON FUNCTION public.relink_bl_customer_legacy_070(text, bigint, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.relink_bl_customer_legacy_070(text, bigint, uuid, text) TO service_role;

-- ---------------------------------------------------------------------------
-- 6. Backfill idempotente: calculo inicial para B/Ls pendentes sem taxas
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_rec RECORD;
BEGIN
  FOR v_rec IN
    SELECT b.id
    FROM public.bls b
    WHERE b.financial_status = 'pending'
      AND NOT EXISTS (
        SELECT 1 FROM public.charge_calculations cc WHERE cc.bl_id = b.id
      )
    ORDER BY b.created_at ASC
  LOOP
    BEGIN
      PERFORM public.calculate_bl_local_charges(v_rec.id, NULL, false);
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END LOOP;
END;
$$;
