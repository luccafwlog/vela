-- Migration 246: emissão de faturas por qualquer Departamento (itens A9 e P4
-- do plano docs/plans/2026-10-14-correcoes-decididas-na-revisao-geral.md;
-- ADR 0083, item 9; ADR 0085, D3).
--
-- Todo usuário interno ativo emite a fatura avulsa e as faturas fora do
-- automático (ficha do B/L, Validação, consolidada, Invoice de Demurrage) e
-- aplica as correções da fatura emitida (Tentar reemitir, Tentar aplicar
-- correção, Tentar emitir para o novo Cliente, Resolver fatura desatualizada).
-- As RPCs abaixo trocam a guarda is_admin() por usuário interno ativo; o resto
-- do corpo é o vigente. O autor continua conferido (_assert_actor_is_caller,
-- migration 241) e cada emissão grava o rastro de sempre (invoice_lifecycle_events
-- e audit_logs); a avulsa exige o nome do item, que é o motivo da cobrança.
-- "Preparar cancelamento financeiro", cancelar fatura e cancelar baixa seguem
-- só do Administrativo. Não altera nem apaga linhas.

CREATE OR REPLACE FUNCTION public.create_invoice_from_bls(p_bl_ids text[], p_customer_id bigint DEFAULT NULL, p_notes text DEFAULT NULL, p_issue_now boolean DEFAULT true, p_actor uuid DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- O autor é quem está logado (ADR 0085, regra base 2; migration 241).
  PERFORM public._assert_actor_is_caller(p_actor);
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Credenciais invalidas ou sem permissao de faturamento.' USING ERRCODE = '42501';
  END IF;

  RETURN public.create_invoice_from_bls_core(
    p_bl_ids,
    p_customer_id,
    p_notes,
    p_issue_now,
    COALESCE(p_actor, auth.uid()),
    'internal',
    NULL
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_invoice_from_bls_with_ledger(p_bl_ids text[], p_customer_id bigint DEFAULT NULL, p_notes text DEFAULT NULL, p_issue_now boolean DEFAULT true, p_actor uuid DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_result JSONB;
  v_invoice_id BIGINT;
BEGIN
  -- O autor é quem está logado (ADR 0085, regra base 2; migration 241).
  PERFORM public._assert_actor_is_caller(p_actor);
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Credenciais invalidas ou sem permissao de faturamento.' USING ERRCODE = '42501';
  END IF;

  v_result := public.create_invoice_from_bls_core(
    p_bl_ids,
    p_customer_id,
    p_notes,
    p_issue_now,
    COALESCE(p_actor, auth.uid()),
    'internal',
    NULL
  );

  v_invoice_id := (v_result->>'invoice_id')::BIGINT;
  IF v_invoice_id IS NULL THEN
    RAISE EXCEPTION 'Falha ao criar invoice para B/Ls.' USING ERRCODE = 'P0001';
  END IF;

  PERFORM public.link_invoice_to_ledger(v_invoice_id);

  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.mark_bl_ready_and_create_invoice(p_bl_id text, p_customer_id bigint DEFAULT NULL, p_notes text DEFAULT NULL, p_actor uuid DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bl_id TEXT := upper(trim(p_bl_id));
  v_customer_id BIGINT;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Credenciais invalidas ou sem permissao de faturamento.' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(p_customer_id, b.customer_id)
  INTO v_customer_id
  FROM public.bls b
  WHERE b.id = v_bl_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L % nao encontrado.', p_bl_id USING ERRCODE = 'P0002';
  END IF;

  IF v_customer_id IS NULL THEN
    RAISE EXCEPTION 'B/L % sem cliente vinculado.', v_bl_id USING ERRCODE = '22023';
  END IF;

  PERFORM public.mark_bl_ready_for_billing(v_bl_id, p_actor);

  RETURN public.create_invoice_from_bls_with_ledger(
    ARRAY[v_bl_id],
    v_customer_id,
    p_notes,
    true,
    p_actor
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.mark_bls_ready_and_create_invoice(p_bl_ids text[], p_customer_id bigint, p_notes text DEFAULT NULL, p_actor uuid DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bl_ids TEXT[];
  v_bl RECORD;
  v_bl_id TEXT;
  v_found_count INTEGER := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Credenciais invalidas ou sem permissao de faturamento.' USING ERRCODE = '42501';
  END IF;

  SELECT ARRAY_AGG(DISTINCT upper(trim(value)) ORDER BY upper(trim(value)))
  INTO v_bl_ids
  FROM unnest(COALESCE(p_bl_ids, ARRAY[]::TEXT[])) AS value
  WHERE NULLIF(trim(value), '') IS NOT NULL;

  IF COALESCE(cardinality(v_bl_ids), 0) = 0 OR p_customer_id IS NULL THEN
    RAISE EXCEPTION 'Informe ao menos um B/L e um cliente para faturar.' USING ERRCODE = '22023';
  END IF;

  FOR v_bl IN
    SELECT b.id, b.customer_id
    FROM public.bls b
    WHERE b.id = ANY(v_bl_ids)
    ORDER BY b.id
    FOR UPDATE
  LOOP
    v_found_count := v_found_count + 1;
    IF v_bl.customer_id IS DISTINCT FROM p_customer_id THEN
      RAISE EXCEPTION 'B/L % nao pertence ao cliente informado.', v_bl.id USING ERRCODE = '22023';
    END IF;
  END LOOP;

  IF v_found_count <> cardinality(v_bl_ids) THEN
    RAISE EXCEPTION 'Um ou mais B/Ls nao foram encontrados.' USING ERRCODE = 'P0002';
  END IF;

  FOREACH v_bl_id IN ARRAY v_bl_ids
  LOOP
    PERFORM public.mark_bl_ready_for_billing(v_bl_id, p_actor);
  END LOOP;

  RETURN public.create_invoice_from_bls_with_ledger(
    v_bl_ids,
    p_customer_id,
    p_notes,
    true,
    p_actor
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_local_consolidated_invoice(p_customer_id bigint, p_receivable_ids bigint[], p_notes text DEFAULT NULL, p_actor uuid DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor UUID;
BEGIN
  -- O autor é quem está logado (ADR 0085, regra base 2; migration 241).
  PERFORM public._assert_actor_is_caller(p_actor);
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Credenciais invalidas ou sem permissao de faturamento.' USING ERRCODE = '42501';
  END IF;

  v_actor := COALESCE(p_actor, auth.uid());

  RETURN public.create_local_consolidated_invoice_core(
    p_customer_id,
    p_receivable_ids,
    v_actor,
    'internal'
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_manual_invoice(p_customer_id bigint, p_item_name text, p_quantity numeric, p_unit_value_brl numeric, p_description text DEFAULT NULL, p_bl_id text DEFAULT NULL, p_voyage_id bigint DEFAULT NULL, p_actor uuid DEFAULT NULL, p_charge_item_id bigint DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
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
$function$;

CREATE OR REPLACE FUNCTION public._create_manual_invoice_custom_122(p_customer_id bigint, p_item_name text, p_quantity numeric, p_unit_value_brl numeric, p_description text DEFAULT NULL, p_bl_id text DEFAULT NULL, p_voyage_id bigint DEFAULT NULL, p_actor uuid DEFAULT NULL)
 RETURNS jsonb
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
     OR NOT public.is_active_user() THEN
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

CREATE OR REPLACE FUNCTION public.create_demurrage_invoice_authoritative(p_doc_number text, p_bl_id text, p_customer_id bigint, p_container_ids bigint[], p_expected_updated_at timestamp with time zone DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bl public.bls%ROWTYPE;
  v_reference public.exchange_rate_reference%ROWTYPE;
  v_calculation jsonb;
  v_items jsonb;
  v_invoice_id bigint;
  v_total_usd numeric(12,2);
  v_current_roe numeric(10,4);
  v_ptax numeric(10,4);
  v_roe_source text;
  v_total_brl numeric(14,2);
  v_pix_payload text;
  v_business_date date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_ready_at date;
  v_billed_box text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND current_setting('vela.demurrage_internal', true) IS DISTINCT FROM 'on'
     AND (auth.uid() IS NULL OR NOT public.is_active_user()) THEN
    RAISE EXCEPTION 'Credenciais invalidas ou sem permissao de faturamento.' USING ERRCODE = '42501';
  END IF;
  IF NULLIF(btrim(p_doc_number), '') IS NULL
     OR NULLIF(btrim(p_bl_id), '') IS NULL
     OR p_customer_id IS NULL THEN
    RAISE EXCEPTION 'Documento, B/L e cliente são obrigatórios.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_bl
  FROM public.bls
  WHERE id = p_bl_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L % não encontrado.', p_bl_id USING ERRCODE = 'P0002';
  END IF;
  IF v_bl.cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION 'O B/L % está cancelado: a Invoice de Demurrage não é emitida para B/L cancelado.', p_bl_id
      USING ERRCODE = '22023';
  END IF;
  IF v_bl.customer_id IS DISTINCT FROM p_customer_id THEN
    RAISE EXCEPTION 'Cliente informado não corresponde ao cliente do B/L %.', p_bl_id USING ERRCODE = '22023';
  END IF;
  IF p_expected_updated_at IS NOT NULL AND v_bl.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'Prévia de Demurrage desatualizada; recalcule antes de emitir.' USING ERRCODE = '40001';
  END IF;
  -- Grupo de container compartilhado: uma Invoice, pelo B/L-âncora.
  IF public.demurrage_group_anchor(p_bl_id) IS DISTINCT FROM p_bl_id THEN
    RAISE EXCEPTION 'O B/L % divide container com o B/L %: a Invoice de Demurrage do grupo é emitida pelo B/L %.',
      p_bl_id, public.demurrage_group_anchor(p_bl_id), public.demurrage_group_anchor(p_bl_id)
      USING ERRCODE = '22023';
  END IF;
  -- Cada caixa uma vez (214): recusa a caixa pedida que outra Invoice viva da
  -- Viagem e do Cliente já cobra, mesmo ancorada em B/L de fora do grupo.
  PERFORM public._lock_demurrage_box_billing(v_bl.voyage_id, p_customer_id);
  SELECT upper(btrim(c.container_number)) INTO v_billed_box
  FROM public.bl_containers AS c
  JOIN public._demurrage_billed_container_keys(v_bl.voyage_id, p_customer_id) AS billed
    ON billed.container_key = upper(btrim(c.container_number))
  WHERE c.id = ANY(p_container_ids)
  ORDER BY 1
  LIMIT 1;
  IF v_billed_box IS NOT NULL THEN
    RAISE EXCEPTION 'Já existe fatura de Demurrage emitida ou paga para o container % do B/L %. Cancele a fatura atual antes de reemitir.', v_billed_box, p_bl_id
      USING ERRCODE = '23505';
  END IF;

  IF COALESCE(v_bl.demurrage_roe_manual, false) THEN
    IF v_bl.demurrage_roe IS NULL OR v_bl.demurrage_roe <= 0 OR v_bl.demurrage_roe::text = 'NaN' THEN
      RAISE EXCEPTION 'ROE manual inválido no B/L %.', p_bl_id USING ERRCODE = '22023';
    END IF;
    v_current_roe := round(v_bl.demurrage_roe, 4);
    v_roe_source := 'manual';
    v_ptax := NULL;
  ELSE
    SELECT * INTO v_reference
    FROM public.exchange_rate_reference
    WHERE id = 1
    FOR SHARE;
    IF NOT FOUND OR v_reference.roe IS NULL OR v_reference.roe <= 0 THEN
      RAISE EXCEPTION 'Referência cambial vigente indisponível para emitir Demurrage.' USING ERRCODE = 'P0001';
    END IF;
    v_current_roe := round(v_reference.roe, 4);
    v_roe_source := COALESCE(NULLIF(v_reference.source, ''), 'manual');
    v_ptax := v_reference.ptax;
    IF v_roe_source IN ('bcb_live', 'cached') AND (v_ptax IS NULL OR v_ptax <= 0) THEN
      RAISE EXCEPTION 'Referência cambial sem PTAX factual para a origem %.', v_roe_source USING ERRCODE = 'P0001';
    END IF;
  END IF;

  v_calculation := public._calculate_demurrage_invoice_authoritative(
    p_bl_id,
    p_container_ids,
    v_business_date
  );
  v_items := v_calculation->'items';
  v_total_usd := round((v_calculation->>'total_usd')::numeric, 2);
  v_ready_at := NULLIF(v_calculation->>'ready_at', '')::date;
  IF v_total_usd IS NULL OR v_total_usd <= 0 OR jsonb_array_length(v_items) = 0 THEN
    RAISE EXCEPTION 'Nenhum container com sobreestadia para este B/L.' USING ERRCODE = '22023';
  END IF;

  v_total_brl := round(v_total_usd * v_current_roe, 2);
  v_pix_payload := CASE
    WHEN v_total_brl > 0 THEN public.build_transshipping_pix_payload(v_total_brl, trim(p_doc_number))
    ELSE NULL
  END;

  INSERT INTO public.demurrage_invoices (
    doc_number, bl_id, customer_id, total_usd, ready_at,
    roe_manual, roe, status, billed_at, first_billed_at,
    current_roe, current_total_brl, roe_source, pix_payload
  ) VALUES (
    trim(p_doc_number), p_bl_id, p_customer_id, v_total_usd, v_ready_at,
    COALESCE(v_bl.demurrage_roe_manual, false), v_bl.demurrage_roe, 'issued',
    v_business_date, v_business_date, v_current_roe, v_total_brl, v_roe_source, v_pix_payload
  ) RETURNING id INTO v_invoice_id;

  INSERT INTO public.demurrage_invoice_items (
    invoice_id, container_id, container_number, container_type,
    discharge_date, return_date, total_days, free_days,
    days_p1, rate_p1_usd, days_p2, rate_p2_usd, subtotal_usd
  )
  SELECT
    v_invoice_id, item.container_id, item.container_number, item.container_type,
    item.discharge_date, item.return_date, item.total_days, item.free_days,
    item.days_p1, item.rate_p1_usd, item.days_p2, item.rate_p2_usd, item.subtotal_usd
  FROM jsonb_to_recordset(v_items) AS item(
    container_id bigint,
    container_number text,
    container_type text,
    discharge_date date,
    return_date date,
    total_days integer,
    free_days integer,
    days_p1 integer,
    rate_p1_usd numeric,
    days_p2 integer,
    rate_p2_usd numeric,
    subtotal_usd numeric
  );

  INSERT INTO public.demurrage_invoice_history
    (invoice_id, event_date, ptax_used, roe_used, total_usd, total_brl, discount_usd, source)
  VALUES
    (v_invoice_id, v_business_date, v_ptax, v_current_roe, v_total_usd, v_total_brl, 0, v_roe_source);

  RETURN jsonb_build_object(
    'invoice_id', v_invoice_id,
    'total_usd', v_total_usd,
    'current_total_brl', v_total_brl,
    'current_roe', v_current_roe,
    'roe_source', v_roe_source,
    'calculation_version', 1
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_demurrage_invoice_for_bl(p_bl_id text, p_doc_number text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_group text[] := public.demurrage_group_bl_ids(p_bl_id);
  v_anchor text := v_group[1];
  v_customer_id bigint;
  v_voyage_id bigint;
  v_covering bigint[];
  v_uncovered integer;
  v_container_ids bigint[];
  v_calculation jsonb;
  v_doc text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND current_setting('vela.demurrage_internal', true) IS DISTINCT FROM 'on'
     AND (auth.uid() IS NULL OR NOT public.is_active_user()) THEN
    RAISE EXCEPTION 'Credenciais invalidas ou sem permissao de faturamento.' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.bls WHERE id = p_bl_id AND cancelled_at IS NOT NULL) THEN
    RAISE EXCEPTION 'O B/L % está cancelado: a Invoice de Demurrage não é emitida para B/L cancelado.', p_bl_id
      USING ERRCODE = '22023';
  END IF;

  SELECT customer_id, voyage_id INTO v_customer_id, v_voyage_id FROM public.bls WHERE id = v_anchor;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L % nao encontrado.', p_bl_id USING ERRCODE = 'P0002';
  END IF;
  IF v_customer_id IS NULL THEN
    RAISE EXCEPTION 'B/L % sem cliente para emissão de Demurrage.', v_anchor USING ERRCODE = '22023';
  END IF;

  -- Cada caixa uma vez (214): a cobertura é por caixa na Viagem e no Cliente,
  -- não pelo grupo de hoje. A trava vale até o fim da transação.
  PERFORM public._lock_demurrage_box_billing(v_voyage_id, v_customer_id);
  WITH boxes AS (
    SELECT DISTINCT upper(btrim(c.container_number)) AS container_key
    FROM public.bl_containers AS c
    WHERE c.bl_id = ANY(v_group) AND c.ownership IS DISTINCT FROM 'SOC'
      AND NULLIF(btrim(c.container_number), '') IS NOT NULL
  ), billed AS (
    SELECT * FROM public._demurrage_billed_container_keys(v_voyage_id, v_customer_id)
  )
  SELECT
    (SELECT array_agg(DISTINCT billed.invoice_id ORDER BY billed.invoice_id)
       FROM billed JOIN boxes USING (container_key)),
    (SELECT count(*) FROM boxes
      WHERE NOT EXISTS (SELECT 1 FROM billed WHERE billed.container_key = boxes.container_key))
  INTO v_covering, v_uncovered;
  IF cardinality(v_covering) > 0 AND v_uncovered = 0 THEN
    RETURN jsonb_build_object('status', 'existing', 'invoice_id', v_covering[cardinality(v_covering)],
      'invoice_ids', to_jsonb(v_covering), 'anchor_bl_id', v_anchor, 'idempotent', true);
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.bl_containers
    WHERE bl_id = ANY(v_group) AND ownership IS DISTINCT FROM 'SOC' AND return_date IS NULL
  ) THEN
    RETURN jsonb_build_object('status', 'waiting_return', 'anchor_bl_id', v_anchor, 'group_bl_ids', to_jsonb(v_group));
  END IF;

  SELECT COALESCE(array_agg(pick.id ORDER BY pick.id), ARRAY[]::bigint[]) INTO v_container_ids
  FROM (
    SELECT DISTINCT ON (upper(btrim(c.container_number))) c.id
    FROM public.bl_containers AS c
    WHERE c.bl_id = ANY(v_group) AND c.ownership IS DISTINCT FROM 'SOC'
      AND NULLIF(btrim(c.container_number), '') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public._demurrage_billed_container_keys(v_voyage_id, v_customer_id) AS billed
        WHERE billed.container_key = upper(btrim(c.container_number))
      )
    ORDER BY upper(btrim(c.container_number)), (c.bl_id = v_anchor) DESC, c.id
  ) AS pick;
  IF cardinality(v_container_ids) = 0 THEN
    RETURN jsonb_build_object('status', 'no_containers', 'anchor_bl_id', v_anchor);
  END IF;

  v_calculation := public._calculate_demurrage_invoice_authoritative(
    v_anchor, v_container_ids, (now() AT TIME ZONE 'America/Sao_Paulo')::date);
  IF COALESCE((v_calculation->>'total_usd')::numeric, 0) <= 0 THEN
    RETURN jsonb_build_object('status', 'no_overstay', 'anchor_bl_id', v_anchor);
  END IF;

  v_doc := COALESCE(NULLIF(btrim(p_doc_number), ''),
    format('DEM-%s-%s', v_anchor, to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS')));
  RETURN public.create_demurrage_invoice_authoritative(v_doc, v_anchor, v_customer_id, v_container_ids, NULL)
    || jsonb_build_object('status', 'issued', 'anchor_bl_id', v_anchor, 'group_bl_ids', to_jsonb(v_group),
         'complementary', COALESCE(cardinality(v_covering), 0) > 0,
         'covering_invoice_ids', to_jsonb(COALESCE(v_covering, ARRAY[]::bigint[])));
END;
$function$;

CREATE OR REPLACE FUNCTION public.retry_pending_consolidated_reissue(p_invoice_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_status text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Credenciais invalidas ou sem permissao de faturamento.' USING ERRCODE = '42501';
  END IF;
  v_status := public._try_recreate_consolidated(p_invoice_id, auth.uid());
  RETURN jsonb_build_object('invoice_id', p_invoice_id, 'status', v_status,
    'replaced_by', (SELECT id FROM public.invoices WHERE replaces_invoice_id = p_invoice_id));
END;
$function$;

CREATE OR REPLACE FUNCTION public.retry_invoice_basis_changes(p_bl_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE change_id bigint;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_active_user() THEN RAISE EXCEPTION 'Sem permissão.' USING ERRCODE='42501'; END IF;
 SELECT id INTO change_id FROM public.invoice_customer_changes WHERE bl_id = p_bl_id AND status <> 'completed' ORDER BY id DESC LIMIT 1;
 IF change_id IS NOT NULL THEN RETURN public._finish_invoice_customer_change(change_id); END IF;
 RETURN public.retry_invoice_basis_changes_legacy_134(p_bl_id);
END $function$;

CREATE OR REPLACE FUNCTION public.retry_invoice_basis_changes_legacy_134(p_bl_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_result jsonb; v_cod_id bigint; v_cod_map jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Sem permissao de faturamento.' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.bls WHERE id = p_bl_id FOR UPDATE;
  SELECT cod_adjustment_id INTO v_cod_id FROM public.invoice_basis_pending_changes WHERE bl_id = p_bl_id FOR UPDATE;
  v_cod_map := coalesce(nullif(current_setting('vela.cod_basis_events', true), ''), '{}')::jsonb;
  IF v_cod_id IS NOT NULL THEN
    PERFORM set_config('vela.cod_basis_events', (v_cod_map || jsonb_build_object(p_bl_id, v_cod_id))::text, true);
  END IF;
  PERFORM set_config('vela.invoice_basis_running', 'on', true);
  v_result := public.apply_invoice_basis_changes(ARRAY[p_bl_id], 'financial_retry');
  DELETE FROM public.invoice_basis_pending_changes WHERE bl_id = p_bl_id;
  PERFORM set_config('vela.cod_basis_events', v_cod_map::text, true);
  PERFORM set_config('vela.invoice_basis_running', 'off', true);
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.resolve_stale_invoice(p_invoice_id bigint, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_customer bigint;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Sem permissao para resolver alerta.' USING ERRCODE = '42501';
  END IF;
  IF length(btrim(coalesce(p_reason, ''))) < 3 THEN
    RAISE EXCEPTION 'Informe a justificativa da resolucao (avulsa emitida ou correcao registrada).' USING ERRCODE = '22023';
  END IF;
  SELECT customer_id INTO v_customer FROM public.invoices WHERE id = p_invoice_id;
  IF v_customer IS NULL THEN RAISE EXCEPTION 'Fatura nao encontrada.' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.resolve_alert_item('fatura_desatualizada', 'invoice', p_invoice_id::text, 'manual_correction_resolution',
    jsonb_build_object('reason', btrim(p_reason), 'actor', auth.uid()));
  INSERT INTO public.audit_logs(entity_type, entity_id, field_name, new_value, changed_by, justification)
    VALUES ('invoice', p_invoice_id::text, 'stale_invoice_resolved', 'resolved', auth.uid(), btrim(p_reason));
END;
$function$;
