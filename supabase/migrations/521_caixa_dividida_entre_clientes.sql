-- 521: caixa dividida entre Clientes (lote 8 do plano da repaginação da
-- Demurrage; ADR 0112, D19, D22 e D23).
--
-- 1. Rateio (D19, D23): quando o mesmo container está em B/Ls ativos de
--    Clientes diferentes na mesma Viagem (`n` Clientes, contando o da
--    Invoice), cada Cliente calcula a caixa pela própria condição (B/L, acordo
--    ou tabela) e paga 1/n desse valor. `_calculate_demurrage_invoice_authoritative`
--    divide o subtotal, e o item guarda `n` em
--    `demurrage_invoice_items.box_share_count`. Item emitido antes da 521 fica
--    com a coluna vazia: foi cobrado cheio e não é comparado (sem efeito
--    retroativo nas Invoices já emitidas).
-- 2. Mudança de `n` depois da emissão (D22): o B/L de outro Cliente que chega
--    com a caixa, sai dela ou é cancelado torna o item diferente do que
--    valeria hoje, como uma data alterada. `_demurrage_item_stale(item)` reúne
--    as duas diferenças, e a reconciliação de datas, o estorno da baixa e a
--    retomada da Régua passam a usá-la. Gatilhos em `bl_containers` e `bls`
--    chamam a reconciliação para as Invoices vivas da caixa cujo `n` mudou:
--    sem pagamento, desconto ou disputa, a Invoice é cancelada e reemitida com
--    a parte nova; paga, com desconto ou em disputa, sai da Régua com o Alerta
--    `demurrage_invoice_dates_changed` ("A divisão das caixas entre Clientes …
--    mudou depois da emissão").
-- 3. A classificação da aba Containers e o detalhe do Portal mostram a parte
--    do Cliente (`box_share_count` em cada caixa e item).
--
-- Não reescreve nem apaga linhas existentes: a coluna nova nasce vazia.
--
-- Rollback: apagar os gatilhos `trg_bl_containers_box_share_*` e
-- `trg_bls_box_share` e as funções `_demurrage_box_share_count`,
-- `_demurrage_item_stale`, `_demurrage_reconcile_box_share_keys`,
-- `_bl_containers_box_share` e `_bls_box_share`; recriar
-- `_calculate_demurrage_invoice_authoritative` (191),
-- `create_demurrage_invoice_authoritative` (509), `_reconcile_demurrage_after_dates`
-- (484), `reconcile_demurrage_invoice_after_payment_reversal` (191),
-- `resume_demurrage_dunning_on_alert_resolved` (317),
-- `_demurrage_billing_board_core` (517) e `_portal_get_demurrage_invoice_detail_core`
-- (473); `ALTER TABLE public.demurrage_invoice_items DROP COLUMN box_share_count`.

ALTER TABLE public.demurrage_invoice_items
  ADD COLUMN IF NOT EXISTS box_share_count integer
  CONSTRAINT demurrage_invoice_items_box_share_count_chk CHECK (box_share_count IS NULL OR box_share_count >= 1);

COMMENT ON COLUMN public.demurrage_invoice_items.box_share_count IS
  'Clientes que dividem a caixa na Viagem quando o item foi emitido (migration 521, ADR 0112 D19); o item cobra 1/n. Vazio: emitido antes da 521, cobrado cheio.';

-- Clientes distintos com a caixa (número normalizado) em B/L ativo da Viagem,
-- contando o Cliente informado (o da Invoice ou do grupo) mesmo com o B/L
-- dele cancelado. Container SOC num B/L não conta aquele Cliente.
CREATE OR REPLACE FUNCTION public._demurrage_box_share_count(p_voyage_id bigint, p_container_key text, p_customer_id bigint DEFAULT NULL)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT GREATEST(1, count(DISTINCT holders.customer_id))::integer
    FROM (
      SELECT b.customer_id
        FROM public.bl_containers AS c
        JOIN public.bls AS b ON b.id = c.bl_id
       WHERE b.voyage_id = p_voyage_id AND b.cancelled_at IS NULL AND b.customer_id IS NOT NULL
         AND c.ownership IS DISTINCT FROM 'SOC'
         AND upper(btrim(c.container_number)) = p_container_key
      UNION ALL
      SELECT p_customer_id WHERE p_customer_id IS NOT NULL
    ) AS holders;
$function$;
REVOKE ALL ON FUNCTION public._demurrage_box_share_count(bigint, text, bigint) FROM PUBLIC, anon, authenticated;

-- O item não bate mais com o que valeria hoje: datas do container ou, desde a
-- 521, a divisão da caixa (só nos itens emitidos com ela).
CREATE OR REPLACE FUNCTION public._demurrage_item_stale(p_item_id bigint)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT c.discharge_date IS DISTINCT FROM item.discharge_date
      OR c.return_date IS DISTINCT FROM item.return_date
      OR (item.box_share_count IS NOT NULL
          AND item.box_share_count <> public._demurrage_box_share_count(b.voyage_id, upper(btrim(item.container_number)), di.customer_id))
    FROM public.demurrage_invoice_items AS item
    JOIN public.demurrage_invoices AS di ON di.id = item.invoice_id
    JOIN public.bl_containers AS c ON c.id = item.container_id
    JOIN public.bls AS b ON b.id = di.bl_id
   WHERE item.id = p_item_id;
$function$;
REVOKE ALL ON FUNCTION public._demurrage_item_stale(bigint) FROM PUBLIC, anon, authenticated;

-- ─── Cálculo e emissão: a parte do Cliente (corpo da 191; muda a divisão) ──

CREATE OR REPLACE FUNCTION public._calculate_demurrage_invoice_authoritative(p_bl_id text, p_container_ids bigint[], p_calculation_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_requested_count integer := COALESCE(array_length(p_container_ids, 1), 0);
  v_distinct_count integer;
  v_result jsonb;
BEGIN
  IF NULLIF(btrim(p_bl_id), '') IS NULL
     OR v_requested_count = 0
     OR p_calculation_date IS NULL THEN
    RAISE EXCEPTION 'B/L, containers e data de cálculo são obrigatórios.' USING ERRCODE = '22023';
  END IF;

  SELECT count(DISTINCT requested.id)::integer
    INTO v_distinct_count
  FROM unnest(p_container_ids) AS requested(id);
  IF v_distinct_count <> v_requested_count THEN
    RAISE EXCEPTION 'A emissão de Demurrage não aceita container duplicado.' USING ERRCODE = '22023';
  END IF;

  WITH requested AS (
    SELECT requested.id
    FROM unnest(p_container_ids) AS requested(id)
  ), base AS (
    SELECT
      container.id,
      container.bl_id,
      container.container_number,
      container.type,
      container.discharge_date,
      container.return_date,
      container.demurrage_status,
      bl.customer_id,
      bl.free_time_override,
      bl.demurrage_rate_override_p1_usd,
      bl.demurrage_rate_override_p2_usd,
      public._demurrage_canonical_type(container.type) AS canonical_type,
      -- 521 (ADR 0112, D19 e D23): Clientes com a caixa na Viagem.
      public._demurrage_box_share_count(bl.voyage_id, upper(btrim(container.container_number)), bl.customer_id) AS share_count
    FROM requested
    LEFT JOIN public.bl_containers AS container
      ON container.id = requested.id
     AND container.bl_id = ANY(public.demurrage_group_bl_ids(p_bl_id))
    LEFT JOIN public.bls AS bl ON bl.id = container.bl_id
  ), resolved AS (
    SELECT
      base.*,
      rate.free_days AS table_free_days,
      rate.p1_day_to,
      rate.p1_usd AS table_p1_usd,
      rate.p2_day_from,
      rate.p2_usd AS table_p2_usd,
      agreement.free_days AS agreement_free_days,
      agreement.p1_usd AS agreement_p1_usd,
      agreement.p2_usd AS agreement_p2_usd
    FROM base
    LEFT JOIN LATERAL (
      SELECT r.free_days, r.p1_day_to, r.p1_usd, r.p2_day_from, r.p2_usd
      FROM public._active_demurrage_rates(p_calculation_date) AS r
      WHERE r.active = true
        AND r.valid_from <= p_calculation_date
        AND (r.valid_to IS NULL OR r.valid_to >= p_calculation_date)
        AND public._demurrage_canonical_type(r.container_type) = base.canonical_type
      ORDER BY r.valid_from DESC, r.id DESC
      LIMIT 1
    ) AS rate ON true
    LEFT JOIN LATERAL (
      SELECT a.free_days, a.p1_usd, a.p2_usd
      FROM public.customer_demurrage_agreements AS a
      WHERE a.customer_id = base.customer_id
        AND a.active = true
        AND base.discharge_date >= a.valid_from
        AND (a.valid_to IS NULL OR base.discharge_date <= a.valid_to)
      ORDER BY a.valid_from DESC, a.id DESC
      LIMIT 1
    ) AS agreement ON true
  ), calculated AS (
    SELECT
      resolved.*,
      (resolved.return_date - resolved.discharge_date)::integer AS total_days,
      COALESCE(resolved.free_time_override, resolved.agreement_free_days, resolved.table_free_days) AS free_days,
      COALESCE(resolved.demurrage_rate_override_p1_usd, resolved.agreement_p1_usd, resolved.table_p1_usd) AS rate_p1_usd,
      COALESCE(resolved.demurrage_rate_override_p2_usd, resolved.agreement_p2_usd, resolved.table_p2_usd) AS rate_p2_usd
    FROM resolved
  ), valued AS (
    SELECT
      calculated.*,
      GREATEST(0, LEAST(calculated.total_days, calculated.p1_day_to) - calculated.free_days)::integer AS days_p1,
      GREATEST(
        0,
        calculated.total_days - GREATEST(calculated.p2_day_from, calculated.free_days + 1) + 1
      )::integer AS days_p2
    FROM calculated
  ), totals AS (
    SELECT
      valued.*,
      -- Cada Cliente paga a parte igual do valor pela própria condição (D23).
      round((valued.days_p1 * valued.rate_p1_usd + valued.days_p2 * valued.rate_p2_usd) / GREATEST(1, valued.share_count), 2) AS subtotal_usd,
      (
        valued.id IS NULL
        OR valued.bl_id IS NULL
        -- A devolução preenchida é o que vale; linha antiga pode ter
        -- `within_free_time` com devolução gravada (C11, migration 191).
        OR valued.discharge_date IS NULL
        OR valued.return_date IS NULL
        OR valued.return_date < valued.discharge_date
        OR valued.total_days < 0
        OR valued.free_days IS NULL
        OR valued.free_days < 0
        OR valued.p1_day_to IS NULL
        OR valued.p2_day_from IS NULL
        OR valued.rate_p1_usd IS NULL
        OR valued.rate_p2_usd IS NULL
        OR valued.rate_p1_usd < 0
        OR valued.rate_p2_usd < 0
      ) AS invalid
    FROM valued
  )
  SELECT jsonb_build_object(
    'items', COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'container_id', totals.id,
          'container_number', totals.container_number,
          'container_type', totals.type,
          'discharge_date', totals.discharge_date,
          'return_date', totals.return_date,
          'total_days', totals.total_days,
          'free_days', totals.free_days,
          'days_p1', totals.days_p1,
          'rate_p1_usd', totals.rate_p1_usd,
          'days_p2', totals.days_p2,
          'rate_p2_usd', totals.rate_p2_usd,
          'subtotal_usd', totals.subtotal_usd,
          'box_share_count', GREATEST(1, totals.share_count)
        ) ORDER BY totals.id
      ) FILTER (WHERE NOT totals.invalid AND totals.subtotal_usd >= 0),
      '[]'::jsonb
    ),
    'total_usd', COALESCE(sum(totals.subtotal_usd) FILTER (WHERE NOT totals.invalid AND totals.subtotal_usd >= 0), 0),
    'ready_at', CASE WHEN bool_and(totals.return_date IS NOT NULL) THEN max(totals.return_date) ELSE NULL END,
    'requested_count', count(*)::integer,
    'distinct_numbers', count(DISTINCT upper(btrim(totals.container_number)))::integer,
    'calculated_count', count(*) FILTER (WHERE NOT totals.invalid AND totals.subtotal_usd >= 0)::integer,
    'invalid_count', count(*) FILTER (WHERE totals.invalid)::integer
  )
    INTO v_result
  FROM totals;

  IF COALESCE((v_result->>'requested_count')::integer, 0) <> v_requested_count THEN
    RAISE EXCEPTION 'Um ou mais containers não pertencem ao B/L informado.' USING ERRCODE = '22023';
  END IF;
  IF COALESCE((v_result->>'invalid_count')::integer, 0) > 0 THEN
    RAISE EXCEPTION 'Dados insuficientes ou tarifa inválida para calcular a Demurrage.' USING ERRCODE = '22023';
  END IF;
  IF COALESCE((v_result->>'distinct_numbers')::integer, 0) <> v_requested_count THEN
    RAISE EXCEPTION 'A Invoice de Demurrage cobra cada caixa uma vez: container repetido no grupo.' USING ERRCODE = '22023';
  END IF;
  IF COALESCE((v_result->>'calculated_count')::integer, 0) <> v_requested_count THEN
    RAISE EXCEPTION 'Nenhum container faturável ou conjunto de containers desatualizado.' USING ERRCODE = '22023';
  END IF;

  RETURN v_result;
END;
$function$;


-- Corpo da 472/509; grava a divisão no item.

CREATE OR REPLACE FUNCTION public.create_demurrage_invoice_authoritative(p_doc_number text, p_bl_id text, p_customer_id bigint, p_container_ids bigint[], p_expected_updated_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
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
  v_block text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND current_setting('vela.demurrage_internal', true) IS DISTINCT FROM 'on'
     AND (auth.uid() IS NULL OR NOT public.is_active_user()) THEN
    RAISE EXCEPTION 'Usuário sem permissão de faturamento.' USING ERRCODE = '42501';
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

  -- 472 (DEM-D13): mesma trava das faturas (CE Mercante e Gate do Portal),
  -- depois das recusas da própria conta (grupo, caixa já cobrada, sobreestadia).
  v_block := public._demurrage_issue_block_reason(p_bl_id);
  IF v_block IS NOT NULL THEN
    RAISE EXCEPTION '%', v_block USING ERRCODE = 'P0003';
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
    days_p1, rate_p1_usd, days_p2, rate_p2_usd, subtotal_usd, box_share_count
  )
  SELECT
    v_invoice_id, item.container_id, item.container_number, item.container_type,
    item.discharge_date, item.return_date, item.total_days, item.free_days,
    item.days_p1, item.rate_p1_usd, item.days_p2, item.rate_p2_usd, item.subtotal_usd, COALESCE(item.box_share_count, 1)
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
    subtotal_usd numeric,
    box_share_count integer
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


-- ─── Reconciliação: a divisão que mudou é como uma data alterada (D22) ───
-- Corpos da 484, 191 e 317 com `_demurrage_item_stale` no lugar da comparação de datas.

CREATE OR REPLACE FUNCTION public._reconcile_demurrage_after_dates(p_bl_ids text[], p_actor uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_invoice public.demurrage_invoices%ROWTYPE;
  v_invoice_id bigint;
  v_result jsonb := '[]'::jsonb;
  v_reissue jsonb;
  v_previous text := current_setting('vela.demurrage_internal', true);
  v_paid boolean;
  v_negotiated boolean;
  v_voyage_id bigint;
  v_keys text[];
  v_tried text[];
  v_waiting text[];
  v_extra jsonb;
  v_next_bl text;
  v_attempt jsonb;
  v_unbilled text[];
  v_message text;
BEGIN
  FOR v_invoice_id IN
    SELECT DISTINCT di.id
    FROM unnest(p_bl_ids) AS changed(bl_id)
    JOIN public.demurrage_invoices AS di
      ON di.bl_id = ANY(public.demurrage_group_bl_ids(changed.bl_id) || changed.bl_id)
      -- A Invoice que cobra caixa deste B/L, mesmo ancorada fora do grupo de
      -- hoje (grupo que se dividiu depois da emissão, 214).
      OR EXISTS (
        SELECT 1 FROM public.demurrage_invoice_items AS own_item
        JOIN public.bl_containers AS own ON own.id = own_item.container_id
        WHERE own_item.invoice_id = di.id AND own.bl_id = changed.bl_id
      )
    WHERE di.status IN ('issued', 'overdue', 'paid')
      AND EXISTS (
        SELECT 1 FROM public.demurrage_invoice_items AS item
        JOIN public.bl_containers AS c ON c.id = item.container_id
        WHERE item.invoice_id = di.id
          AND public._demurrage_item_stale(item.id)
      )
    ORDER BY di.id
  LOOP
    -- A decisão vale para a linha travada (211): uma baixa que confirmou
    -- depois da leitura acima não tem a Invoice paga cancelada e reemitida.
    SELECT * INTO v_invoice FROM public.demurrage_invoices WHERE id = v_invoice_id FOR UPDATE;
    CONTINUE WHEN NOT FOUND OR v_invoice.status NOT IN ('issued', 'overdue', 'paid');
    CONTINUE WHEN NOT EXISTS (
      SELECT 1 FROM public.demurrage_invoice_items AS item
      JOIN public.bl_containers AS c ON c.id = item.container_id
      WHERE item.invoice_id = v_invoice.id
        AND public._demurrage_item_stale(item.id)
    );
    v_paid := v_invoice.status = 'paid' OR v_invoice.paid_at IS NOT NULL;
    -- Desconto ou disputa aberta (ADR 0079, decisão 1): houve negociação que o
    -- cálculo não refaz. Como a paga, a Invoice não é reemitida sozinha.
    v_negotiated := NOT v_paid
      AND (COALESCE(v_invoice.discount_value, 0) > 0 OR COALESCE(v_invoice.dispute_open, false));
    -- 521 (D22): sem data diferente, o que mudou foi a divisão da caixa.
    v_message := format(CASE WHEN EXISTS (
        SELECT 1 FROM public.demurrage_invoice_items AS item
        JOIN public.bl_containers AS c ON c.id = item.container_id
        WHERE item.invoice_id = v_invoice.id
          AND (c.discharge_date IS DISTINCT FROM item.discharge_date OR c.return_date IS DISTINCT FROM item.return_date))
      THEN 'As datas de container da Invoice de Demurrage %s mudaram depois da emissão%s.'
      ELSE 'A divisão das caixas entre Clientes da Invoice de Demurrage %s mudou depois da emissão%s.' END,
        v_invoice.doc_number, CASE
          WHEN v_paid THEN ' e ela já tem pagamento: a Régua suspendeu a cobrança'
          WHEN v_negotiated THEN ' e ela tem desconto ou disputa aberta: a Régua suspendeu a cobrança; cancele, gere de novo e refaça o desconto ou responda a disputa'
          ELSE '' END);

    IF v_paid OR v_negotiated THEN
      PERFORM public.upsert_alert_item(
        'demurrage_invoice_dates_changed', 'demurrage_invoice', v_invoice.id::text, v_message,
        'container-dates',
        jsonb_build_object('invoice_id', v_invoice.id, 'bl_id', v_invoice.bl_id, 'paid', v_paid, 'negotiated', v_negotiated),
        '/demurrage');
      UPDATE public.demurrage_invoices
         SET dunning_suspended_reason = CASE WHEN v_paid
           THEN 'Datas de container alteradas depois do pagamento; conferir a diferença.'
           ELSE 'Datas de container alteradas em Invoice com desconto ou disputa; reemitir à mão.' END
       WHERE id = v_invoice.id
         -- 317 (R5): a suspensão pela recusa do provedor (D6) fica; ao
         -- resolver o alerta, a retomada aplica a suspensão por datas.
         AND (dunning_suspended_reason IS NULL OR dunning_suspended_reason NOT LIKE 'Cobrança recusada pelo provedor%');
      v_result := v_result || jsonb_build_array(jsonb_build_object('invoice_id', v_invoice.id, 'status', 'suspended'));
      CONTINUE;
    END IF;

    -- Sem pagamento: cancela e reemite com as datas atuais (ou só cancela).
    UPDATE public.demurrage_invoices SET status = 'cancelled', updated_at = now()
     WHERE id = v_invoice.id AND status IN ('issued', 'overdue') AND paid_at IS NULL;
    CONTINUE WHEN NOT FOUND;
    INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification)
    VALUES ('demurrage_invoice', v_invoice.id::text, 'status', v_invoice.status, 'cancelled', p_actor, now(),
      'Datas de container alteradas: cancelada para reemissão automática.');
    v_extra := '[]'::jsonb;
    v_unbilled := ARRAY[]::text[];
    v_voyage_id := NULL;
    IF EXISTS (SELECT 1 FROM public.bls WHERE id = v_invoice.bl_id AND cancelled_at IS NOT NULL) THEN
      v_reissue := jsonb_build_object('status', 'bl_cancelled', 'bl_id', v_invoice.bl_id);
    -- Viagem Cancelada não recebe Invoice de Demurrage (211): só cancela.
    ELSIF EXISTS (
      SELECT 1 FROM public.bls AS b JOIN public.voyages AS v ON v.id = b.voyage_id
      WHERE b.id = v_invoice.bl_id AND v.status = 'cancelled'
    ) THEN
      v_reissue := jsonb_build_object('status', 'voyage_cancelled', 'bl_id', v_invoice.bl_id);
    ELSE
      -- Cada caixa uma vez (214): a reemissão cobra as caixas da Invoice
      -- cancelada que nenhuma outra Invoice viva cobre. Primeiro pelo grupo do
      -- B/L dela; a caixa que saiu desse grupo, pelo âncora do B/L ativo que
      -- ainda a tem. Cada âncora é tentado uma vez.
      SELECT voyage_id INTO v_voyage_id FROM public.bls WHERE id = v_invoice.bl_id;
      SELECT COALESCE(array_agg(DISTINCT upper(btrim(item.container_number))), ARRAY[]::text[]) INTO v_keys
      FROM public.demurrage_invoice_items AS item
      WHERE item.invoice_id = v_invoice.id AND NULLIF(btrim(item.container_number), '') IS NOT NULL;
      v_tried := ARRAY[]::text[];
      v_waiting := ARRAY[]::text[];
      v_next_bl := v_invoice.bl_id;
      PERFORM set_config('vela.demurrage_internal', 'on', true);
      -- 484 (decisão do dono, P7): o Cliente já via a Invoice cancelada; a
      -- substituta sai mesmo com o gate fechado.
      PERFORM set_config('vela.demurrage_reissue_visible', 'on', true);
      LOOP
        v_attempt := public.issue_demurrage_invoice_for_bl(v_next_bl, NULL);
        -- 472 (DEM-D08): a Invoice reemitida guarda qual cancelada ela substitui.
        IF v_attempt->>'status' = 'issued' AND (v_attempt->>'invoice_id') IS NOT NULL THEN
          UPDATE public.demurrage_invoices SET replaces_invoice_id = v_invoice.id
           WHERE id = (v_attempt->>'invoice_id')::bigint;
        END IF;
        IF cardinality(v_tried) = 0 THEN
          v_reissue := v_attempt;
        ELSE
          v_extra := v_extra || jsonb_build_array(v_attempt || jsonb_build_object('bl_id', v_next_bl));
        END IF;
        v_tried := array_append(v_tried, COALESCE(v_attempt->>'anchor_bl_id', v_next_bl));
        -- Sem sobreestadia ou aguardando devolução: as caixas do grupo ficam
        -- sem Invoice por regra, não por perda (a devolução enfileira de novo).
        IF v_attempt->>'status' IN ('no_overstay', 'waiting_return') THEN
          v_waiting := v_waiting || ARRAY(
            SELECT DISTINCT upper(btrim(c.container_number)) FROM public.bl_containers AS c
            WHERE c.bl_id = ANY(public.demurrage_group_bl_ids(COALESCE(v_attempt->>'anchor_bl_id', v_next_bl))));
        END IF;
        SELECT holder.id INTO v_next_bl
        FROM unnest(v_keys) AS k(container_key)
        JOIN public.bl_containers AS c ON upper(btrim(c.container_number)) = k.container_key
        JOIN public.bls AS holder ON holder.id = c.bl_id
        WHERE holder.voyage_id = v_voyage_id AND holder.customer_id = v_invoice.customer_id
          AND holder.cancelled_at IS NULL
          AND c.ownership IS DISTINCT FROM 'SOC'
          AND k.container_key <> ALL(v_waiting)
          AND NOT EXISTS (
            SELECT 1 FROM public._demurrage_billed_container_keys(v_voyage_id, v_invoice.customer_id) AS billed
            WHERE billed.container_key = k.container_key)
          AND public.demurrage_group_anchor(holder.id) <> ALL(v_tried)
        ORDER BY k.container_key, holder.id
        LIMIT 1;
        EXIT WHEN NOT FOUND;
      END LOOP;
      PERFORM set_config('vela.demurrage_internal', COALESCE(v_previous, ''), true);
      PERFORM set_config('vela.demurrage_reissue_visible', '', true);
      SELECT COALESCE(array_agg(k.container_key ORDER BY k.container_key), ARRAY[]::text[]) INTO v_unbilled
      FROM unnest(v_keys) AS k(container_key)
      WHERE k.container_key <> ALL(v_waiting)
        AND NOT EXISTS (
          SELECT 1 FROM public._demurrage_billed_container_keys(v_voyage_id, v_invoice.customer_id) AS billed
          WHERE billed.container_key = k.container_key);
    END IF;
    IF cardinality(v_unbilled) > 0 THEN
      -- Caixa da Invoice cancelada que ficou sem cobrança não é sucesso: o
      -- Alerta diz quais caixas conferir e fecha quando todas estiverem numa
      -- Invoice viva (349, resolve_demurrage_dates_changed_on_billing).
      PERFORM public.upsert_alert_item(
        'demurrage_invoice_dates_changed', 'demurrage_invoice', v_invoice.id::text,
        v_message || format(
          ' A reemissão automática não cobrou o(s) container(s) %s: %s',
          array_to_string(v_unbilled, ', '),
          CASE WHEN v_reissue->>'status' = 'blocked'
            THEN 'a emissão aguarda: ' || (v_reissue->>'reason') || ' A nova Invoice sai sozinha quando o motivo for resolvido.'
            ELSE 'confira o grupo e emita a Demurrage deles.' END),
        'container-dates',
        jsonb_build_object('invoice_id', v_invoice.id, 'bl_id', v_invoice.bl_id, 'paid', v_paid, 'negotiated', v_negotiated,
          'voyage_id', v_voyage_id, 'customer_id', v_invoice.customer_id,
          'unbilled_containers', to_jsonb(v_unbilled), 'reissue_status', v_reissue->>'status'),
        '/demurrage');
    ELSE
      -- 349 (P1): a reemissão cobriu todas as caixas, ou não havia o que
      -- cobrar (B/L ou Viagem cancelados, sem sobreestadia, aguardando
      -- devolução). Nada a conferir: o alerta não fica aberto.
      PERFORM public.resolve_alert_item(
        'demurrage_invoice_dates_changed', 'demurrage_invoice', v_invoice.id::text, 'container-dates',
        jsonb_build_object('resolution', 'reissue_complete', 'invoice_id', v_invoice.id,
          'reissue_status', v_reissue->>'status'));
    END IF;
    v_result := v_result || jsonb_build_array(jsonb_build_object(
      'invoice_id', v_invoice.id, 'status', 'cancelled', 'reissue', v_reissue,
      'reissue_extra', v_extra, 'unbilled_containers', to_jsonb(v_unbilled),
      'reissue_complete', cardinality(v_unbilled) = 0));
  END LOOP;

  -- Com as datas de volta às faturadas, a Invoice com desconto ou disputa sai
  -- da suspensão (a paga sai pelo estorno, como na 191).
  UPDATE public.demurrage_invoices AS di
     SET dunning_suspended_reason = NULL
    FROM unnest(p_bl_ids) AS changed(bl_id)
   WHERE di.bl_id = ANY(public.demurrage_group_bl_ids(changed.bl_id) || changed.bl_id)
     AND di.status IN ('issued', 'overdue')
     AND di.paid_at IS NULL
     AND di.dunning_suspended_reason = 'Datas de container alteradas em Invoice com desconto ou disputa; reemitir à mão.'
     AND NOT EXISTS (
       SELECT 1 FROM public.demurrage_invoice_items AS item
       JOIN public.bl_containers AS c ON c.id = item.container_id
       WHERE item.invoice_id = di.id
         AND public._demurrage_item_stale(item.id)
     );
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.reconcile_demurrage_invoice_after_payment_reversal()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.demurrage_invoice_items AS item
    JOIN public.bl_containers AS c ON c.id = item.container_id
    WHERE item.invoice_id = NEW.id
      AND public._demurrage_item_stale(item.id)
  ) THEN
    PERFORM public._reconcile_demurrage_after_dates(ARRAY[NEW.bl_id], auth.uid());
  ELSE
    -- 317 (R5): só tira a suspensão por datas; a recusa do provedor (D6) fica
    -- até a pessoa resolver o alerta.
    UPDATE public.demurrage_invoices SET dunning_suspended_reason = NULL
    WHERE id = NEW.id AND dunning_suspended_reason LIKE 'Datas de container alteradas%';
  END IF;
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.resume_demurrage_dunning_on_alert_resolved()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_entity_type text;
  v_entity_id text;
  v_invoice_id bigint;
BEGIN
  IF NEW.item_type IS DISTINCT FROM 'cobranca_demurrage_recusada'
     OR NEW.status IS DISTINCT FROM 'resolved'
     OR OLD.status IS NOT DISTINCT FROM 'resolved' THEN
    RETURN NEW;
  END IF;

  SELECT a.entity_type, a.entity_id INTO v_entity_type, v_entity_id
  FROM public.alerts AS a WHERE a.id = NEW.alert_id;
  IF v_entity_type IS DISTINCT FROM 'demurrage_invoice' OR v_entity_id !~ '^[0-9]+$' THEN
    RETURN NEW;
  END IF;
  v_invoice_id := v_entity_id::bigint;

  -- 317 (R5): as datas de container que mudam com a Invoice suspensa pela
  -- recusa não sobrescrevem o motivo (_reconcile_demurrage_after_dates). Ao
  -- retomar, a Invoice paga ou negociada com datas divergentes fica com a
  -- suspensão por datas, como a reconciliação teria gravado.
  UPDATE public.demurrage_invoices AS di
  SET dunning_suspended_reason = CASE
    WHEN NOT EXISTS (
      SELECT 1 FROM public.demurrage_invoice_items AS item
      JOIN public.bl_containers AS c ON c.id = item.container_id
      WHERE item.invoice_id = di.id
        AND public._demurrage_item_stale(item.id)
    ) THEN NULL
    WHEN di.status = 'paid' OR di.paid_at IS NOT NULL
      THEN 'Datas de container alteradas depois do pagamento; conferir a diferença.'
    WHEN COALESCE(di.discount_value, 0) > 0 OR COALESCE(di.dispute_open, false)
      THEN 'Datas de container alteradas em Invoice com desconto ou disputa; reemitir à mão.'
    ELSE NULL
  END
  WHERE di.id = v_invoice_id
    AND di.dunning_suspended_reason LIKE 'Cobrança recusada pelo provedor%';
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  -- Retoma no mesmo discriminador; a nova geração muda a chave de
  -- idempotência do e-mail e o Comunicado (317), para a tentativa recusada não
  -- ser reaproveitada. A contagem de falhas recomeça (317, R5): a recusa
  -- contou uma, e o alerta de falhas seguidas abria na 2ª falha da retomada.
  UPDATE public.demurrage_dunning_claims AS claim
  SET released_at = COALESCE(claim.released_at, now()),
      resume_generation = claim.resume_generation + 1,
      failure_count = 0
  WHERE claim.demurrage_invoice_id = v_invoice_id
    AND claim.attempt_discriminator = (
      SELECT max(latest.attempt_discriminator) FROM public.demurrage_dunning_claims AS latest
      WHERE latest.demurrage_invoice_id = v_invoice_id
    );
  RETURN NEW;
END;
$function$;


-- ─── Classificação: o previsto é a parte do Cliente (corpo da 517) ───────

CREATE OR REPLACE FUNCTION public._demurrage_billing_board_core(p_customer_id bigint DEFAULT NULL::bigint, p_voyage_id bigint DEFAULT NULL::bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_today date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_result jsonb;
BEGIN
  WITH candidate_bls AS (
    -- B/Ls com caixa não-SOC numa Viagem que não foi cancelada.
    SELECT DISTINCT b.id, b.voyage_id, b.customer_id, b.cancelled_at
      FROM public.bls AS b
      JOIN public.voyages AS v ON v.id = b.voyage_id
      JOIN public.bl_containers AS c ON c.bl_id = b.id
     WHERE v.status IS DISTINCT FROM 'cancelled'
       AND c.ownership IS DISTINCT FROM 'SOC'
       AND NULLIF(btrim(c.container_number), '') IS NOT NULL
       AND (p_voyage_id IS NULL OR b.voyage_id = p_voyage_id)
       AND (p_customer_id IS NULL OR b.customer_id = p_customer_id)
  ), grouped AS (
    -- B/L ativo: o grupo do banco (mesmo Cliente e Viagem, caixa dividida).
    -- B/L cancelado ou sem Cliente: ele sozinho.
    SELECT cb.id AS bl_id, cb.voyage_id, cb.customer_id, cb.cancelled_at,
           CASE
             WHEN cb.cancelled_at IS NOT NULL OR cb.customer_id IS NULL THEN ARRAY[cb.id]
             ELSE public.demurrage_group_bl_ids(cb.id)
           END AS group_ids
      FROM candidate_bls AS cb
  ), groups AS (
    SELECT DISTINCT ON (g.group_ids[1]) g.group_ids[1] AS anchor_bl_id, g.group_ids, g.voyage_id, g.customer_id,
           (g.cancelled_at IS NOT NULL) AS cancelled
      FROM grouped AS g
     ORDER BY g.group_ids[1], g.bl_id
  ), boxes AS (
    -- Uma linha por caixa (número) do grupo, a do âncora primeiro, como a emissão.
    SELECT DISTINCT ON (gr.anchor_bl_id, upper(btrim(c.container_number)))
           gr.anchor_bl_id, c.id AS container_id, c.bl_id, upper(btrim(c.container_number)) AS container_key,
           c.container_number, c.type, c.discharge_date, c.return_date,
           b.free_time_override, b.demurrage_rate_override_p1_usd, b.demurrage_rate_override_p2_usd,
           -- 521 (D19): o previsto é a parte do Cliente na caixa dividida.
           public._demurrage_box_share_count(gr.voyage_id, upper(btrim(c.container_number)), gr.customer_id) AS share_count
      FROM groups AS gr
      JOIN public.bl_containers AS c ON c.bl_id = ANY(gr.group_ids)
      JOIN public.bls AS b ON b.id = c.bl_id
     WHERE c.ownership IS DISTINCT FROM 'SOC'
       AND NULLIF(btrim(c.container_number), '') IS NOT NULL
     ORDER BY gr.anchor_bl_id, upper(btrim(c.container_number)), (c.bl_id = gr.anchor_bl_id) DESC, c.id
  ), resolved AS (
    SELECT bx.*, gr.customer_id, gr.voyage_id,
           public._demurrage_canonical_type(bx.type) AS rate_group,
           rate.free_days AS table_free_days, rate.p1_day_to, rate.p1_usd AS table_p1_usd,
           rate.p2_day_from, rate.p2_usd AS table_p2_usd,
           agreement.free_days AS agreement_free_days, agreement.p1_usd AS agreement_p1_usd,
           agreement.p2_usd AS agreement_p2_usd,
           covering.invoice_id AS covered_by,
           waiver.id AS waiver_id
      FROM boxes AS bx
      JOIN groups AS gr ON gr.anchor_bl_id = bx.anchor_bl_id
      LEFT JOIN LATERAL (
        SELECT r.free_days, r.p1_day_to, r.p1_usd, r.p2_day_from, r.p2_usd
          FROM public._active_demurrage_rates(v_today) AS r
         WHERE public._demurrage_canonical_type(r.container_type) = public._demurrage_canonical_type(bx.type)
         ORDER BY r.valid_from DESC, r.id DESC
         LIMIT 1
      ) AS rate ON true
      LEFT JOIN LATERAL (
        SELECT a.free_days, a.p1_usd, a.p2_usd
          FROM public.customer_demurrage_agreements AS a
         WHERE a.customer_id = gr.customer_id AND a.active
           AND bx.discharge_date IS NOT NULL
           AND bx.discharge_date >= a.valid_from
           AND (a.valid_to IS NULL OR bx.discharge_date <= a.valid_to)
         ORDER BY a.valid_from DESC, a.id DESC
         LIMIT 1
      ) AS agreement ON true
      -- 517: dispensa da cobrança da caixa (Viagem, Cliente, número).
      LEFT JOIN LATERAL (
        SELECT w.id FROM public.demurrage_box_waivers AS w
         WHERE gr.customer_id IS NOT NULL AND w.revoked_at IS NULL
           AND w.voyage_id = gr.voyage_id AND w.customer_id = gr.customer_id AND w.container_key = bx.container_key
         LIMIT 1
      ) AS waiver ON true
      LEFT JOIN LATERAL (
        SELECT max(billed.invoice_id) AS invoice_id
          FROM public._demurrage_billed_container_keys(gr.voyage_id, gr.customer_id) AS billed
         WHERE gr.customer_id IS NOT NULL AND billed.container_key = bx.container_key
      ) AS covering ON true
  ), calculated AS (
    SELECT r.*,
           CASE WHEN r.discharge_date IS NULL THEN NULL
                ELSE (COALESCE(r.return_date, v_today) - r.discharge_date)::integer END AS total_days,
           COALESCE(r.free_time_override, r.agreement_free_days, r.table_free_days) AS free_days,
           CASE WHEN r.free_time_override IS NOT NULL THEN 'bl'
                WHEN r.agreement_free_days IS NOT NULL THEN 'acordo'
                WHEN r.table_free_days IS NOT NULL THEN 'tabela' END AS free_source,
           COALESCE(r.demurrage_rate_override_p1_usd, r.agreement_p1_usd, r.table_p1_usd) AS rate_p1_usd,
           COALESCE(r.demurrage_rate_override_p2_usd, r.agreement_p2_usd, r.table_p2_usd) AS rate_p2_usd
      FROM resolved AS r
  ), valued AS (
    SELECT c.*,
           (c.p1_day_to IS NULL OR c.p2_day_from IS NULL OR c.rate_p1_usd IS NULL OR c.rate_p2_usd IS NULL) AS no_rate,
           CASE WHEN c.total_days IS NULL OR c.free_days IS NULL OR c.p1_day_to IS NULL THEN NULL
                ELSE GREATEST(0, LEAST(c.total_days, c.p1_day_to) - c.free_days)::integer END AS days_p1,
           CASE WHEN c.total_days IS NULL OR c.free_days IS NULL OR c.p2_day_from IS NULL THEN NULL
                ELSE GREATEST(0, c.total_days - GREATEST(c.p2_day_from, c.free_days + 1) + 1)::integer END AS days_p2
      FROM calculated AS c
  ), boxed AS (
    SELECT v.*,
           CASE WHEN v.no_rate OR v.days_p1 IS NULL THEN NULL
                ELSE round((v.days_p1 * v.rate_p1_usd + v.days_p2 * v.rate_p2_usd) / GREATEST(1, v.share_count), 2) END AS usd,
           CASE
             WHEN v.covered_by IS NOT NULL THEN 'covered'
             WHEN v.waiver_id IS NOT NULL THEN 'waived'
             WHEN v.discharge_date IS NULL THEN 'no_discharge'
             -- D27: sem tarifa e sem free time de B/L ou acordo, desde a descarga;
             -- com free time, quando ele vence (não há diária para valorar).
             WHEN v.no_rate AND (v.free_days IS NULL OR v.total_days > v.free_days) THEN 'no_rate'
             WHEN v.return_date IS NULL AND v.free_days IS NOT NULL AND v.total_days > v.free_days THEN 'running'
             WHEN v.return_date IS NULL THEN 'in_free_time'
             WHEN v.free_days IS NOT NULL AND v.total_days > v.free_days THEN 'returned_overstay'
             ELSE 'returned_free'
           END AS state
      FROM valued AS v
  ), group_flags AS (
    SELECT gr.anchor_bl_id, gr.group_ids, gr.voyage_id, gr.customer_id, gr.cancelled,
           bool_or(bx.state = 'no_rate') AS has_no_rate,
           bool_or(bx.state = 'running') AS has_running,
           bool_or(bx.state IN ('returned_overstay', 'no_rate') AND bx.return_date IS NOT NULL) AS has_returned_overstay,
           bool_or(bx.state IN ('running', 'returned_overstay', 'no_rate')) AS has_overstay,
           bool_or(bx.return_date IS NULL AND bx.state <> 'waived') AS has_out,
           bool_or(bx.state = 'returned_overstay' AND COALESCE(bx.usd, 0) > 0) AS has_to_issue,
           string_agg(DISTINCT CASE WHEN bx.state = 'no_rate' THEN COALESCE(NULLIF(upper(btrim(bx.type)), ''), '(vazio)') END, ', ') AS no_rate_types,
           COALESCE(sum(bx.usd) FILTER (WHERE bx.state IN ('running', 'returned_overstay')), 0) AS usd
      FROM groups AS gr
      JOIN boxed AS bx ON bx.anchor_bl_id = gr.anchor_bl_id
     GROUP BY gr.anchor_bl_id, gr.group_ids, gr.voyage_id, gr.customer_id, gr.cancelled
  ), blocked AS (
    SELECT gf.*,
           CASE WHEN gf.customer_id IS NOT NULL AND NOT gf.cancelled AND gf.has_overstay
                THEN public._demurrage_issue_block_reason(gf.anchor_bl_id) END AS block_reason,
           CASE WHEN gf.customer_id IS NOT NULL AND NOT gf.cancelled AND gf.has_overstay
                THEN NOT public.bl_has_portal_release(gf.anchor_bl_id) END AS missing_ce
      FROM group_flags AS gf
  ), classified AS (
    SELECT bl.*,
           CASE
             WHEN bl.has_no_rate THEN 'travado'
             WHEN bl.cancelled AND bl.has_overstay THEN 'travado'
             WHEN bl.customer_id IS NULL AND bl.has_overstay THEN 'travado'
             WHEN NOT bl.has_out AND bl.has_to_issue AND bl.block_reason IS NOT NULL THEN 'travado'
             WHEN bl.has_running THEN 'correndo'
             WHEN bl.has_out AND bl.has_returned_overstay THEN 'esperando'
             WHEN NOT bl.has_out AND bl.has_to_issue THEN 'a_emitir'
           END AS division,
           CASE
             WHEN bl.has_no_rate THEN 'sem_tarifa'
             WHEN bl.cancelled AND bl.has_overstay THEN 'bl_cancelado'
             WHEN bl.customer_id IS NULL AND bl.has_overstay THEN 'sem_cliente'
             WHEN NOT bl.has_out AND bl.has_to_issue AND bl.block_reason IS NOT NULL
               THEN CASE WHEN bl.missing_ce THEN 'sem_ce' ELSE 'portal' END
           END AS reason_code
      FROM blocked AS bl
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'anchor_bl_id', cl.anchor_bl_id,
           'bl_ids', to_jsonb(cl.group_ids),
           'voyage_id', cl.voyage_id,
           'voyage_label', (SELECT COALESCE(ve.name, '') || ' / ' || vo.voyage_number
                              FROM public.voyages AS vo LEFT JOIN public.vessels AS ve ON ve.id = vo.vessel_id
                             WHERE vo.id = cl.voyage_id),
           'customer_id', cl.customer_id,
           'customer_name', (SELECT cu.name FROM public.customers AS cu WHERE cu.id = cl.customer_id),
           'customer_cnpj', (SELECT cu.cnpj_cpf FROM public.customers AS cu WHERE cu.id = cl.customer_id),
           'division', cl.division,
           'reason_code', cl.reason_code,
           'reason', CASE cl.reason_code
             WHEN 'sem_tarifa' THEN format('Tipo %s sem tarifa de Demurrage.', cl.no_rate_types)
             WHEN 'bl_cancelado' THEN format('B/L %s cancelado com sobreestadia sem Invoice.', cl.anchor_bl_id)
             WHEN 'sem_cliente' THEN format('B/L %s sem Cliente vinculado.', cl.anchor_bl_id)
             ELSE cl.block_reason END,
           -- Em Correndo e Esperando, o que vai travar a emissão já aparece.
           'warning', CASE WHEN cl.division IN ('correndo', 'esperando') THEN cl.block_reason END,
           'no_rate_types', cl.no_rate_types,
           'usd', cl.usd,
           'boxes', (SELECT jsonb_agg(jsonb_build_object(
                       'container_id', bx.container_id, 'bl_id', bx.bl_id,
                       'container_number', bx.container_number, 'type', bx.type, 'rate_group', bx.rate_group,
                       'discharge_date', bx.discharge_date, 'return_date', bx.return_date,
                       'total_days', bx.total_days, 'free_days', bx.free_days, 'free_source', bx.free_source,
                       'last_free_day', CASE WHEN bx.discharge_date IS NOT NULL AND bx.free_days IS NOT NULL THEN bx.discharge_date + bx.free_days END,
                       'days_p1', bx.days_p1, 'rate_p1_usd', bx.rate_p1_usd,
                       'days_p2', bx.days_p2, 'rate_p2_usd', bx.rate_p2_usd,
                       'usd', CASE WHEN bx.state IN ('running', 'returned_overstay') THEN bx.usd END,
                       'state', bx.state,
                       'covered_by', bx.covered_by,
                       'covered_doc', (SELECT di.doc_number FROM public.demurrage_invoices AS di WHERE di.id = bx.covered_by),
                       'waiver_id', bx.waiver_id,
                       'box_share_count', GREATEST(1, bx.share_count)
                     ) ORDER BY bx.container_key)
                       FROM boxed AS bx WHERE bx.anchor_bl_id = cl.anchor_bl_id)
         ) ORDER BY cl.anchor_bl_id), '[]'::jsonb)
    INTO v_result
    FROM classified AS cl
   WHERE cl.division IS NOT NULL;
  RETURN v_result;
END;
$function$;


-- ─── Portal: o item traz a divisão (corpo da 473) ─────────────────────────

CREATE OR REPLACE FUNCTION public._portal_get_demurrage_invoice_detail_core(p_customer_id bigint, p_invoice_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_raw jsonb;
  v_invoice jsonb;
  v_items jsonb;
  v_refunds jsonb;
BEGIN
  v_raw := public._portal_get_demurrage_invoice_detail_core_unfiltered_20260920(p_customer_id, p_invoice_id);

  v_invoice := jsonb_build_object(
    'id', v_raw #> '{invoice,id}',
    'doc_number', v_raw #> '{invoice,doc_number}',
    'bl_id', v_raw #> '{invoice,bl_id}',
    'doc_date', v_raw #> '{invoice,doc_date}',
    'due_date', v_raw #> '{invoice,due_date}',
    'billed_at', v_raw #> '{invoice,billed_at}',
    'paid_at', v_raw #> '{invoice,paid_at}',
    'total_usd', v_raw #> '{invoice,total_usd}',
    'current_roe', v_raw #> '{invoice,current_roe}',
    'current_total_brl', v_raw #> '{invoice,current_total_brl}',
    'discount_type', v_raw #> '{invoice,discount_type}',
    'discount_value', v_raw #> '{invoice,discount_value}',
    'discount_mode', v_raw #> '{invoice,discount_mode}',
    'dispute_open', v_raw #> '{invoice,dispute_open}',
    'pix_payload', v_raw #> '{invoice,pix_payload}',
    'status', v_raw #> '{invoice,status}',
    'updated_at', v_raw #> '{invoice,updated_at}',
    'roe_source', v_raw #> '{invoice,roe_source}',
    'customer_name', v_raw #> '{invoice,customer_name}',
    'customer_cnpj_cpf', v_raw #> '{invoice,customer_cnpj_cpf}',
    'pol', v_raw #> '{invoice,pol}',
    'pod', v_raw #> '{invoice,pod}',
    'voyage_number', v_raw #> '{invoice,voyage_number}',
    'vessel_name', v_raw #> '{invoice,vessel_name}',
    -- 472 (DEM-D08): a Invoice reemitida diz qual cancelada ela substitui.
    'replaces_doc_number', (SELECT prev.doc_number FROM public.demurrage_invoices cur
      JOIN public.demurrage_invoices prev ON prev.id = cur.replaces_invoice_id
      WHERE cur.id = (v_raw #>> '{invoice,id}')::bigint)
  );

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', row->'id',
    'invoice_id', row->'invoice_id',
    'container_id', row->'container_id',
    'container_number', row->'container_number',
    'container_type', row->'container_type',
    'discharge_date', row->'discharge_date',
    'return_date', row->'return_date',
    'total_days', row->'total_days',
    'free_days', row->'free_days',
    'days_p1', row->'days_p1',
    'rate_p1_usd', row->'rate_p1_usd',
    'days_p2', row->'days_p2',
    'rate_p2_usd', row->'rate_p2_usd',
    'subtotal_usd', row->'subtotal_usd',
    'box_share_count', COALESCE(row->'box_share_count', '1'::jsonb),
    'created_at', row->'created_at'
  )), '[]'::jsonb)
  INTO v_items
  FROM jsonb_array_elements(COALESCE(v_raw->'items', '[]'::jsonb)) AS row;

  -- 298: restituições da Invoice (valor, situação e data), sem as anotações
  -- internas, para o detalhe e o recibo do Portal mostrarem o que foi devolvido.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', f.id,
    'amount_brl', f.amount_brl,
    'status', f.status,
    'purpose', f.purpose,
    'settled_at', f.settled_at,
    'notes', NULL,
    'bank_reference', NULL,
    'beneficiary', NULL
  ) ORDER BY f.id), '[]'::jsonb)
  INTO v_refunds
  FROM public.demurrage_refunds AS f
  WHERE f.invoice_id = p_invoice_id
    AND f.status <> 'cancelled'
    AND v_raw ? 'invoice'
    AND v_raw->'invoice' <> 'null'::jsonb;

  RETURN jsonb_build_object(
    'invoice', v_invoice,
    'items', v_items,
    'refund_summary', jsonb_build_object(
      'received_brl', CASE WHEN v_raw #>> '{invoice,status}' = 'paid'
        THEN COALESCE((v_raw #>> '{invoice,current_total_brl}')::numeric, 0) ELSE 0 END,
      'refunds', v_refunds
    )
  );
END;
$function$;

-- ─── Gatilhos: `n` da caixa mudou (D22) ──────────────────────────────────

-- Reconcilia as Invoices vivas com item de uma das caixas (Viagem, número)
-- cuja divisão não bate mais com a de hoje.
CREATE OR REPLACE FUNCTION public._demurrage_reconcile_box_share_keys(p_keys jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bl text;
  v_actor uuid := auth.uid();
  v_previous_role text := current_setting('request.jwt.claim.role', true);
  v_previous_sub text := current_setting('request.jwt.claim.sub', true);
  v_previous_claims text := current_setting('request.jwt.claims', true);
BEGIN
  -- Efeito do sistema, como o Alerta de Travado (516): o Alerta e a reemissão
  -- não dependem do perfil de quem gravou o B/L; a auditoria guarda quem foi.
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
  FOR v_bl IN
    SELECT DISTINCT di.bl_id
      FROM jsonb_to_recordset(p_keys) AS k(voyage_id bigint, container_key text)
      JOIN public.bls AS holder ON holder.voyage_id = k.voyage_id
      JOIN public.demurrage_invoices AS di ON di.bl_id = holder.id
      JOIN public.demurrage_invoice_items AS item ON item.invoice_id = di.id
     WHERE di.status IN ('issued', 'overdue', 'paid')
       AND upper(btrim(item.container_number)) = k.container_key
       AND item.box_share_count IS NOT NULL
       AND item.box_share_count <> public._demurrage_box_share_count(k.voyage_id, k.container_key, di.customer_id)
  LOOP
    PERFORM public._reconcile_demurrage_after_dates(ARRAY[v_bl], v_actor);
  END LOOP;
  PERFORM set_config('request.jwt.claim.role', COALESCE(v_previous_role, ''), true);
  PERFORM set_config('request.jwt.claim.sub', COALESCE(v_previous_sub, ''), true);
  PERFORM set_config('request.jwt.claims', COALESCE(v_previous_claims, ''), true);
END;
$function$;
REVOKE ALL ON FUNCTION public._demurrage_reconcile_box_share_keys(jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._bl_containers_box_share()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_keys jsonb;
BEGIN
  SELECT jsonb_agg(DISTINCT jsonb_build_object('voyage_id', b.voyage_id, 'container_key', upper(btrim(changed.container_number))))
    INTO v_keys
    FROM changed_rows AS changed
    JOIN public.bls AS b ON b.id = changed.bl_id
   WHERE b.voyage_id IS NOT NULL AND NULLIF(btrim(changed.container_number), '') IS NOT NULL;
  IF v_keys IS NOT NULL THEN
    PERFORM public._demurrage_reconcile_box_share_keys(v_keys);
  END IF;
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public._bl_containers_box_share() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_bl_containers_box_share_ins ON public.bl_containers;
DROP TRIGGER IF EXISTS trg_bl_containers_box_share_upd_new ON public.bl_containers;
DROP TRIGGER IF EXISTS trg_bl_containers_box_share_upd_old ON public.bl_containers;
DROP TRIGGER IF EXISTS trg_bl_containers_box_share_del ON public.bl_containers;
CREATE TRIGGER trg_bl_containers_box_share_ins
  AFTER INSERT ON public.bl_containers REFERENCING NEW TABLE AS changed_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public._bl_containers_box_share();
-- Troca de número, de B/L ou de SOC/COC: a caixa de antes e a de depois.
CREATE TRIGGER trg_bl_containers_box_share_upd_new
  AFTER UPDATE ON public.bl_containers REFERENCING NEW TABLE AS changed_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public._bl_containers_box_share();
CREATE TRIGGER trg_bl_containers_box_share_upd_old
  AFTER UPDATE ON public.bl_containers REFERENCING OLD TABLE AS changed_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public._bl_containers_box_share();
CREATE TRIGGER trg_bl_containers_box_share_del
  AFTER DELETE ON public.bl_containers REFERENCING OLD TABLE AS changed_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public._bl_containers_box_share();

-- B/L cancelado, reativado, com outro Cliente ou noutra Viagem: as caixas dele.
CREATE OR REPLACE FUNCTION public._bls_box_share()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_keys jsonb;
BEGIN
  SELECT jsonb_agg(DISTINCT jsonb_build_object('voyage_id', voyage_id, 'container_key', upper(btrim(c.container_number))))
    INTO v_keys
    FROM public.bl_containers AS c
    CROSS JOIN LATERAL (VALUES (NEW.voyage_id), (OLD.voyage_id)) AS v(voyage_id)
   WHERE c.bl_id = NEW.id AND v.voyage_id IS NOT NULL AND NULLIF(btrim(c.container_number), '') IS NOT NULL;
  IF v_keys IS NOT NULL THEN
    PERFORM public._demurrage_reconcile_box_share_keys(v_keys);
  END IF;
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public._bls_box_share() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_bls_box_share ON public.bls;
CREATE TRIGGER trg_bls_box_share
  AFTER UPDATE OF cancelled_at, customer_id, voyage_id ON public.bls
  FOR EACH ROW
  WHEN (OLD.cancelled_at IS DISTINCT FROM NEW.cancelled_at
     OR OLD.customer_id IS DISTINCT FROM NEW.customer_id
     OR OLD.voyage_id IS DISTINCT FROM NEW.voyage_id)
  EXECUTE FUNCTION public._bls_box_share();
