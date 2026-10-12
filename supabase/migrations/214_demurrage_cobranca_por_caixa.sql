-- 214 — Demurrage: cada caixa uma vez, pela caixa e não pelo grupo de hoje.
--
-- Decisão do dono de 2026-10-12 (revisão final da PR 929). Até a 213, "já
-- faturado" era decidido pela participação do B/L no grupo ATUAL
-- (`invoice.bl_id = ANY(demurrage_group_bl_ids(...))`), recalculado a cada
-- chamada, enquanto os itens da Invoice apontam para linhas de `bl_containers`.
-- Consequências verificadas: (a) o grupo que se divide depois da emissão
-- cobrava a mesma caixa duas vezes; (b) com o B/L-âncora cancelado e a Invoice
-- do grupo paga, o B/L que restou era cobrado de novo pela mesma caixa; (c) um
-- irmão que chega depois com uma caixa nova recebia 'existing' e a caixa nunca
-- era cobrada; (d) um irmão que liga dois grupos fazia a reemissão depois de
-- uma correção de datas devolver a Invoice do outro grupo como 'existing', e a
-- Demurrage da caixa corrigida se perdia como se a reemissão tivesse dado certo.
--
-- Regra: uma caixa (número normalizado, não-SOC) que já é item de Invoice de
-- Demurrage emitida, vencida ou paga (`issued`, `overdue`, `paid`) da MESMA
-- Viagem e do MESMO Cliente — inclusive Invoice ancorada em B/L hoje cancelado
-- — não é cobrada de novo. `draft` não conta: nenhum caminho atual cria
-- rascunho de Demurrage, rascunho não é cobrança, e o rascunho que passar a
-- emitido é recusado se tiver caixa já cobrada (item 4).
--
-- 1. `_demurrage_billed_container_keys(voyage, customer, exclude)`: as caixas
--    já cobradas e a Invoice que cobre cada uma. Sem EXECUTE para public, anon
--    e authenticated. `_lock_demurrage_box_billing(voyage, customer)` serializa
--    a emissão por Viagem e Cliente (advisory lock da transação).
-- 2. `issue_demurrage_invoice_for_bl`: grupo com todas as caixas não-SOC
--    cobertas devolve 'existing' com `invoice_ids` (as Invoices que cobrem);
--    com caixa descoberta, emite no âncora atual uma Invoice COMPLEMENTAR só
--    com as caixas descobertas, pelo mesmo cálculo
--    (`_calculate_demurrage_invoice_authoritative`) e a mesma regra de
--    completude (todas as caixas não-SOC do grupo devolvidas).
-- 3. `create_demurrage_invoice_authoritative`: a recusa de duplicidade (23505)
--    passa a ser por caixa pedida, não por Invoice no grupo.
-- 4. `assert_demurrage_invoice_complete` (gatilho adiado da emissão): a Invoice
--    traz exatamente as caixas não-SOC do grupo que nenhuma OUTRA Invoice viva
--    da Viagem e do Cliente cobre, e nenhuma caixa dela é cobrada por outra.
--    Toma o mesmo advisory lock, então duas emissões concorrentes não cobram a
--    mesma caixa. O índice único `uq_demurrage_invoices_active_bl` (uma Invoice
--    emitida/paga por B/L) sai: a complementar nasce no mesmo âncora, e a
--    exclusividade agora é por caixa.
-- 5. `_after_container_dates`: enfileira `demurrage_billing` quando o grupo
--    tem caixa não-SOC descoberta (antes: quando o grupo não tinha Invoice).
-- 6. `_reconcile_demurrage_after_dates`: acha também a Invoice que cobra
--    caixa do B/L alterado ancorada fora do grupo de hoje (grupo que se
--    dividiu). Depois de cancelar a Invoice sem pagamento, a reemissão cobra as caixas que ela cobria e que nenhuma outra
--    cobre — pelo âncora do B/L dela e, para a caixa que saiu desse grupo,
--    pelo âncora do B/L ativo que ainda a tem. Resultado diferente de emitida,
--    sem sobreestadia, aguardando devolução ou 'existing' que de fato cobre as
--    caixas deixa o Alerta `demurrage_invoice_dates_changed` dizendo quais
--    caixas ficaram sem cobrança (`reissue_complete = false` no retorno).
--
-- `bl_open_financial_reasons` (191) segue igual: cancelar B/L com item em
-- Invoice viva continua recusado, e a Invoice paga de âncora cancelado
-- continua cobrindo as caixas dele.
--
-- Não reescreve nem apaga linhas existentes. Rollback: reaplicar as definições
-- de `issue_demurrage_invoice_for_bl` e `create_demurrage_invoice_authoritative`
-- (191), `assert_demurrage_invoice_complete` (191), `_after_container_dates`
-- (191) e `_reconcile_demurrage_after_dates` (211); recriar
-- `uq_demurrage_invoices_active_bl` (falha se já houver complementar emitida);
-- remover `_demurrage_billed_container_keys` e `_lock_demurrage_box_billing`.

-- 1. Caixas já cobradas por Viagem e Cliente, e a trava da emissão.
CREATE OR REPLACE FUNCTION public._demurrage_billed_container_keys(
  p_voyage_id bigint, p_customer_id bigint, p_exclude_invoice_id bigint DEFAULT NULL)
 RETURNS TABLE(container_key text, invoice_id bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  -- A Viagem vem do B/L da Invoice (cancelado ou não) e o Cliente, da Invoice:
  -- a Invoice paga de âncora cancelado continua cobrindo as caixas dela.
  SELECT DISTINCT upper(btrim(item.container_number)), di.id
  FROM public.demurrage_invoices AS di
  JOIN public.bls AS b ON b.id = di.bl_id
  JOIN public.demurrage_invoice_items AS item ON item.invoice_id = di.id
  WHERE di.status IN ('issued', 'overdue', 'paid')
    AND di.customer_id = p_customer_id
    AND b.voyage_id = p_voyage_id
    AND di.id IS DISTINCT FROM p_exclude_invoice_id
    AND NULLIF(btrim(item.container_number), '') IS NOT NULL;
$function$;

CREATE OR REPLACE FUNCTION public._lock_demurrage_box_billing(p_voyage_id bigint, p_customer_id bigint)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  -- ponytail: trava por (Viagem, Cliente) com hashtext, que pode colidir entre
  -- pares diferentes; a colisão só serializa emissões sem relação, nunca
  -- libera duas emissões da mesma caixa. Trocar por trava em linha de tabela
  -- se a contenção aparecer.
  SELECT pg_advisory_xact_lock(hashtext('vela.demurrage_box_billing'),
    hashtext(COALESCE(p_voyage_id::text, '-') || ':' || COALESCE(p_customer_id::text, '-')));
$function$;

REVOKE ALL ON FUNCTION public._demurrage_billed_container_keys(bigint, bigint, bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._lock_demurrage_box_billing(bigint, bigint) FROM PUBLIC, anon, authenticated;

-- 2. Emissão do grupo: 'existing' só com todas as caixas cobertas; senão a
--    complementar com as caixas descobertas.
CREATE OR REPLACE FUNCTION public.issue_demurrage_invoice_for_bl(p_bl_id text, p_doc_number text DEFAULT NULL::text)
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
     AND (auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin()) THEN
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

-- 3. Criação: a duplicidade é por caixa pedida.
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
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND current_setting('vela.demurrage_internal', true) IS DISTINCT FROM 'on'
     AND (auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin()) THEN
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

-- 4. Completude na emissão: as caixas descobertas do grupo, sem repetir caixa
--    de outra Invoice viva. A exclusividade por caixa substitui o índice único
--    por B/L.
CREATE OR REPLACE FUNCTION public.assert_demurrage_invoice_complete(p_invoice_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bl_id text;
  v_customer_id bigint;
  v_voyage_id bigint;
  v_group text[];
  v_expected integer;
  v_items integer;
BEGIN
  SELECT di.bl_id, di.customer_id, b.voyage_id INTO v_bl_id, v_customer_id, v_voyage_id
  FROM public.demurrage_invoices AS di
  LEFT JOIN public.bls AS b ON b.id = di.bl_id
  WHERE di.id = p_invoice_id;
  IF NOT FOUND THEN RETURN; END IF;

  IF EXISTS (SELECT 1 FROM public.demurrage_invoices WHERE id = p_invoice_id AND status IN ('issued', 'paid')) THEN
    -- Mesma trava da emissão (214): duas transações não cobram a mesma caixa.
    PERFORM public._lock_demurrage_box_billing(v_voyage_id, v_customer_id);
    v_group := public.demurrage_group_bl_ids(v_bl_id);
    -- Caixas que esta Invoice deve trazer: as não-SOC do grupo que nenhuma
    -- outra Invoice viva da Viagem e do Cliente cobre (complementar, 214).
    SELECT count(DISTINCT upper(btrim(c.container_number))) INTO v_expected
    FROM public.bl_containers AS c
    WHERE c.bl_id = ANY(v_group) AND c.ownership IS DISTINCT FROM 'SOC'
      AND NOT EXISTS (
        SELECT 1 FROM public._demurrage_billed_container_keys(v_voyage_id, v_customer_id, p_invoice_id) AS billed
        WHERE billed.container_key = upper(btrim(c.container_number))
      );
    IF v_expected = 0 THEN
      IF EXISTS (SELECT 1 FROM public.demurrage_invoice_items WHERE invoice_id = p_invoice_id) THEN
        RAISE EXCEPTION 'Demurrage do B/L % possui itens sem containers físicos correspondentes ou já cobrados em outra Invoice.', v_bl_id USING ERRCODE = '23514';
      END IF;
      RETURN;
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.bl_containers
      WHERE bl_id = ANY(v_group) AND return_date IS NULL AND ownership IS DISTINCT FROM 'SOC'
    ) OR EXISTS (
      SELECT 1 FROM public.demurrage_invoice_items AS item
      WHERE item.invoice_id = p_invoice_id AND item.return_date IS NULL
    ) THEN
      RAISE EXCEPTION 'Demurrage só pode ser emitida após a devolução de todos os containers do B/L %.', v_bl_id USING ERRCODE = '23514';
    END IF;

    SELECT count(DISTINCT upper(btrim(item.container_number))) INTO v_items
    FROM public.demurrage_invoice_items AS item WHERE item.invoice_id = p_invoice_id;
    IF v_items <> v_expected OR EXISTS (
      SELECT 1 FROM public.demurrage_invoice_items AS item
      WHERE item.invoice_id = p_invoice_id
      GROUP BY upper(btrim(item.container_number))
      HAVING count(*) > 1
    ) OR EXISTS (
      SELECT 1 FROM public.demurrage_invoice_items AS item
      WHERE item.invoice_id = p_invoice_id
        AND NOT EXISTS (
          SELECT 1 FROM public.bl_containers AS bc
          WHERE bc.id = item.container_id AND bc.bl_id = ANY(v_group) AND bc.ownership IS DISTINCT FROM 'SOC'
        )
    ) OR EXISTS (
      SELECT 1 FROM public.demurrage_invoice_items AS item
      JOIN public._demurrage_billed_container_keys(v_voyage_id, v_customer_id, p_invoice_id) AS billed
        ON billed.container_key = upper(btrim(item.container_number))
      WHERE item.invoice_id = p_invoice_id
    ) THEN
      RAISE EXCEPTION 'Demurrage do B/L % não contém o conjunto completo e exclusivo de containers.', v_bl_id USING ERRCODE = '23514';
    END IF;
  END IF;
END;
$function$;

DROP INDEX IF EXISTS public.uq_demurrage_invoices_active_bl;

-- 5. Emissão enfileirada quando o grupo devolvido tem caixa descoberta.
CREATE OR REPLACE FUNCTION public._after_container_dates(p_request_id uuid, p_bl_ids text[], p_actor uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bl text;
  v_anchor text;
  v_enqueued text[] := ARRAY[]::text[];
BEGIN
  FOREACH v_bl IN ARRAY COALESCE(p_bl_ids, ARRAY[]::text[]) LOOP
    v_anchor := public.demurrage_group_anchor(v_bl);
    CONTINUE WHEN v_anchor IS NULL OR v_anchor = ANY(v_enqueued);
    IF NOT EXISTS (
      SELECT 1 FROM public.bl_containers
      WHERE bl_id = ANY(public.demurrage_group_bl_ids(v_anchor))
        AND ownership IS DISTINCT FROM 'SOC' AND return_date IS NULL
    ) AND EXISTS (
      -- Caixa não-SOC do grupo ainda sem Invoice viva da Viagem e do Cliente
      -- (214): o irmão que chega depois com caixa nova também é cobrado.
      SELECT 1
      FROM public.bls AS anchor
      JOIN public.bl_containers AS c ON c.bl_id = ANY(public.demurrage_group_bl_ids(v_anchor))
      WHERE anchor.id = v_anchor
        AND c.ownership IS DISTINCT FROM 'SOC'
        AND NULLIF(btrim(c.container_number), '') IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM public._demurrage_billed_container_keys(anchor.voyage_id, anchor.customer_id) AS billed
          WHERE billed.container_key = upper(btrim(c.container_number))
        )
    ) THEN
      INSERT INTO public.import_pending_effects(source_action_id, effect_kind, entity_id, created_by)
      VALUES (p_request_id, 'demurrage_billing', v_anchor, p_actor)
      ON CONFLICT (source_action_id, effect_kind, entity_id) DO NOTHING;
      v_enqueued := array_append(v_enqueued, v_anchor);
    END IF;
  END LOOP;
  RETURN jsonb_build_object(
    'demurrage_effects', to_jsonb(v_enqueued),
    'demurrage_invoices', public._reconcile_demurrage_after_dates(p_bl_ids, p_actor)
  );
END;
$function$;

-- 6. Reemissão depois da correção de datas cobra as caixas da Invoice
--    cancelada que ninguém mais cobre; o que sobrar fica no Alerta.
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
          AND (c.discharge_date IS DISTINCT FROM item.discharge_date OR c.return_date IS DISTINCT FROM item.return_date)
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
        AND (c.discharge_date IS DISTINCT FROM item.discharge_date OR c.return_date IS DISTINCT FROM item.return_date)
    );
    v_paid := v_invoice.status = 'paid' OR v_invoice.paid_at IS NOT NULL;
    -- Desconto ou disputa aberta (ADR 0079, decisão 1): houve negociação que o
    -- cálculo não refaz. Como a paga, a Invoice não é reemitida sozinha.
    v_negotiated := NOT v_paid
      AND (COALESCE(v_invoice.discount_value, 0) > 0 OR COALESCE(v_invoice.dispute_open, false));
    v_message := format('As datas de container da Invoice de Demurrage %s mudaram depois da emissão%s.',
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
       WHERE id = v_invoice.id;
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
      LOOP
        v_attempt := public.issue_demurrage_invoice_for_bl(v_next_bl, NULL);
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
      SELECT COALESCE(array_agg(k.container_key ORDER BY k.container_key), ARRAY[]::text[]) INTO v_unbilled
      FROM unnest(v_keys) AS k(container_key)
      WHERE k.container_key <> ALL(v_waiting)
        AND NOT EXISTS (
          SELECT 1 FROM public._demurrage_billed_container_keys(v_voyage_id, v_invoice.customer_id) AS billed
          WHERE billed.container_key = k.container_key);
    END IF;
    -- Caixa da Invoice cancelada que ficou sem cobrança não é sucesso: o
    -- Alerta diz quais caixas conferir.
    PERFORM public.upsert_alert_item(
      'demurrage_invoice_dates_changed', 'demurrage_invoice', v_invoice.id::text,
      v_message || CASE WHEN cardinality(v_unbilled) > 0 THEN format(
        ' A reemissão automática não cobrou o(s) container(s) %s: confira o grupo e emita a Demurrage deles.',
        array_to_string(v_unbilled, ', ')) ELSE '' END,
      'container-dates',
      jsonb_build_object('invoice_id', v_invoice.id, 'bl_id', v_invoice.bl_id, 'paid', v_paid, 'negotiated', v_negotiated)
        || CASE WHEN cardinality(v_unbilled) > 0
             THEN jsonb_build_object('unbilled_containers', to_jsonb(v_unbilled), 'reissue_status', v_reissue->>'status')
             ELSE '{}'::jsonb END,
      '/demurrage');
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
         AND (c.discharge_date IS DISTINCT FROM item.discharge_date OR c.return_date IS DISTINCT FROM item.return_date)
     );
  RETURN v_result;
END;
$function$;
