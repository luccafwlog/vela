-- 072: Calculo automatico de taxas locais na importacao de B/L e desacoplamento
-- de cliente na sincronizacao do recebivel.
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

  IF v_roe IS NULL AND EXISTS (
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
  v_actor uuid := COALESCE(p_actor, auth.uid());
  v_results jsonb := '[]'::jsonb;
  v_success_count integer := 0;
  v_error_count integer := 0;
  v_errors jsonb := '[]'::jsonb;
  v_res jsonb;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa' USING ERRCODE = '42501';
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
    'total', cardinality(p_bl_ids),
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
    v_bl_id := UPPER(TRIM(COALESCE(v_item->>'id', '')));
    CONTINUE WHEN v_bl_id = '';

    -- Disparo imediato do calculo inicial das taxas locais com base nas tabelas cadastradas
    BEGIN
      PERFORM public.calculate_bl_local_charges(v_bl_id, v_actor, true);
    EXCEPTION WHEN OTHERS THEN
      -- Se houver inconsistencia especifica em um B/L, nao aborta a importacao do lote.
      NULL;
    END;

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

  RETURN jsonb_build_object('result', v_result, 'batch_id', v_batch_id);
END;
$$;

REVOKE ALL ON FUNCTION public.import_bl_freight_with_metadata(jsonb, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_bl_freight_with_metadata(jsonb, uuid, jsonb) TO authenticated, service_role;
