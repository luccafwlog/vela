-- 472: Demurrage (decisões do dono de 2026-10-27, lote 4 do plano de
-- correções).
--
-- Problema e mudança, por seção:
--   1. DEM-D13 — a Invoice de Demurrage era emitida sem CE Mercante e sem o
--      Gate de faturamento do Portal; o Cliente recebia "Nova fatura de
--      demurrage" de uma fatura que não conseguia abrir. A emissão passa a
--      exigir os dois, como as faturas (ADR 0070):
--      `_demurrage_issue_block_reason` diz o motivo;
--      `issue_demurrage_invoice_for_bl` devolve `blocked` (a fila não falha) e
--      `create_demurrage_invoice_authoritative` recusa (P0003). A gravação do
--      CE e a abertura do gate (`_reprocess_customer_held_billing`) enfileiram
--      de novo a emissão (`_enqueue_held_demurrage_billing`). A reemissão por
--      datas alteradas que não pode sair diz o motivo no alerta.
--   2. DEM-D08 — a Invoice reemitida pela mudança de datas não citava a
--      cancelada: `demurrage_invoices.replaces_invoice_id`, gravado pela
--      reemissão e mostrado no Vela e no Portal ("Substitui a Invoice …").
--   3. DEM-D01 — a conversa interna da Disputa não trazia os anexos: a lista
--      passa a devolvê-los (o download usa o link temporário do Storage, com a
--      regra de leitura do bucket `demurrage-disputes` da migration `158`).
--   4. DEM-D09 — Invoices no estado antigo "vencida" (`overdue`) sumiam das
--      listas e dos totais: passam a emitidas.
--
-- Data status: a seção 4 reescreve `demurrage_invoices.status` de linhas
-- existentes (`overdue` → `issued`). Depende da afirmação "Data status" do
-- AGENTS.md (2026-09-18): a produção não tem dados reais de negócio.
--
-- Rollback: reaplicar `issue_demurrage_invoice_for_bl` da `294`,
-- `create_demurrage_invoice_authoritative` da `246`,
-- `_reconcile_demurrage_after_dates` da `349`,
-- `_list_demurrage_disputes_internal_impl_20260920` da `250`,
-- `_portal_get_demurrage_invoice_detail_core` e
-- `_reprocess_customer_held_billing` (definições anteriores na cadeia);
-- DROP TRIGGER trg_enqueue_demurrage_after_ce ON public.bls;
-- DROP FUNCTION public._enqueue_demurrage_after_ce(),
--   public._enqueue_held_demurrage_billing(text[], uuid),
--   public._demurrage_issue_block_reason(text);
-- ALTER TABLE public.demurrage_invoices DROP COLUMN replaces_invoice_id.
-- O estado `overdue` das Invoices convertidas não volta.

-- 1 --- Trava de emissão da Demurrage (DEM-D13) ------------------------------
CREATE OR REPLACE FUNCTION public._demurrage_issue_block_reason(p_bl_id text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_gate jsonb;
BEGIN
  IF NOT public.bl_has_portal_release(p_bl_id) THEN
    RETURN format('B/L %s sem CE Mercante. Cadastre o CE antes de faturar.', p_bl_id);
  END IF;
  v_gate := public.portal_billing_gate(p_bl_id);
  IF NOT coalesce((v_gate->>'allowed')::boolean, false) THEN
    RETURN 'Faturamento bloqueado pelo Portal: ' || coalesce(v_gate->>'reason', 'Portal do Cliente não está pronto.');
  END IF;
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public._demurrage_issue_block_reason(text) FROM PUBLIC, anon, authenticated;

-- Enfileira a emissão do grupo de cada B/L com CE, Cliente e caixa devolvida
-- ainda sem Invoice; a fila (`import-effects-runner`) decide o resto.
CREATE OR REPLACE FUNCTION public._enqueue_held_demurrage_billing(p_bl_ids text[], p_actor uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_anchor text;
  v_count integer := 0;
  v_request uuid := gen_random_uuid();
BEGIN
  FOR v_anchor IN
    SELECT DISTINCT public.demurrage_group_anchor(b.id)
    FROM public.bls b
    WHERE b.id = ANY(coalesce(p_bl_ids, ARRAY[]::text[]))
      AND b.cancelled_at IS NULL AND b.customer_id IS NOT NULL
      AND public.bl_has_portal_release(b.id)
      AND EXISTS (
        SELECT 1 FROM public.bl_containers c
        WHERE c.bl_id = b.id AND c.ownership IS DISTINCT FROM 'SOC' AND c.return_date IS NOT NULL
          AND NULLIF(btrim(c.container_number), '') IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM public._demurrage_billed_container_keys(b.voyage_id, b.customer_id) billed
            WHERE billed.container_key = upper(btrim(c.container_number))))
  LOOP
    INSERT INTO public.import_pending_effects(source_action_id, effect_kind, entity_id, created_by)
    VALUES (v_request, 'demurrage_billing', v_anchor, p_actor)
    ON CONFLICT (source_action_id, effect_kind, entity_id) DO NOTHING;
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$function$;
REVOKE ALL ON FUNCTION public._enqueue_held_demurrage_billing(text[], uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._enqueue_demurrage_after_ce()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  PERFORM public._enqueue_held_demurrage_billing(ARRAY[NEW.id], auth.uid());
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public._enqueue_demurrage_after_ce() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_enqueue_demurrage_after_ce ON public.bls;
CREATE TRIGGER trg_enqueue_demurrage_after_ce
  AFTER UPDATE OF ce_mercante ON public.bls
  FOR EACH ROW
  WHEN (NULLIF(btrim(coalesce(OLD.ce_mercante, '')), '') IS NULL AND NULLIF(btrim(coalesce(NEW.ce_mercante, '')), '') IS NOT NULL)
  EXECUTE FUNCTION public._enqueue_demurrage_after_ce();

-- 2 --- Invoice reemitida cita a cancelada (DEM-D08) -------------------------
ALTER TABLE public.demurrage_invoices
  ADD COLUMN IF NOT EXISTS replaces_invoice_id bigint REFERENCES public.demurrage_invoices(id);
CREATE INDEX IF NOT EXISTS idx_demurrage_invoices_replaces_invoice_id
  ON public.demurrage_invoices (replaces_invoice_id) WHERE replaces_invoice_id IS NOT NULL;

-- Funções redefinidas (seções 1 a 3): emissão, emissão autoritativa,
-- reemissão por datas, lista interna de Disputas, detalhe do Portal e
-- reprocessamento do gate.
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
  v_block text;
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

  -- 472 (DEM-D13): a Invoice de Demurrage segue a trava das faturas: CE
  -- Mercante e Gate de faturamento do Portal aberto. Sem eles, nada é emitido
  -- (a fila não falha); o CE ou a abertura do gate enfileira de novo.
  v_block := public._demurrage_issue_block_reason(v_anchor);
  IF v_block IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'blocked', 'reason', v_block, 'anchor_bl_id', v_anchor);
  END IF;

  v_doc := COALESCE(NULLIF(btrim(p_doc_number), ''), public.next_demurrage_doc_number());
  RETURN public.create_demurrage_invoice_authoritative(v_doc, v_anchor, v_customer_id, v_container_ids, NULL)
    || jsonb_build_object('status', 'issued', 'anchor_bl_id', v_anchor, 'group_bl_ids', to_jsonb(v_group),
         'complementary', COALESCE(cardinality(v_covering), 0) > 0,
         'covering_invoice_ids', to_jsonb(COALESCE(v_covering, ARRAY[]::bigint[])));
END;
$function$;

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
         AND (c.discharge_date IS DISTINCT FROM item.discharge_date OR c.return_date IS DISTINCT FROM item.return_date)
     );
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public._list_demurrage_disputes_internal_impl_20260920(p_state text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF public._portal_actor_role() IS NULL OR public._portal_actor_role() NOT IN ('administrativo', 'documentacao', 'financeiro', 'operacoes', 'equipamentos') THEN
    RAISE EXCEPTION 'Usuário interno ativo obrigatório para consultar as Disputes.' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', d.id, 'demurrage_invoice_id', d.demurrage_invoice_id,
      'doc_number', di.doc_number, 'customer_id', d.customer_id,
      'customer_name', c.name, 'state', d.state,
      'next_responder', d.next_responder, 'subject', d.subject,
      'created_at', d.created_at, 'updated_at', d.updated_at,
      'messages', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', m.id, 'author_type', m.author_type, 'body', m.body, 'next_responder', m.next_responder, 'created_at', m.created_at, 'attachments', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', a.id, 'file_name', a.file_name, 'mime_type', a.mime_type, 'size_bytes', a.size_bytes, 'storage_path', a.storage_path) ORDER BY a.id) FROM public.demurrage_dispute_attachments a WHERE a.message_id = m.id), '[]'::jsonb)) ORDER BY m.created_at) FROM public.demurrage_dispute_messages m WHERE m.dispute_id = d.id), '[]'::jsonb)
    ) ORDER BY d.updated_at DESC)
    FROM public.demurrage_disputes d
    JOIN public.demurrage_invoices di ON di.id = d.demurrage_invoice_id
    JOIN public.customers c ON c.id = d.customer_id
    WHERE p_state IS NULL OR d.state = p_state
  ), '[]'::jsonb);
END;
$function$;

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

CREATE OR REPLACE FUNCTION public._reprocess_customer_held_billing(p_customer_id bigint, p_actor uuid, p_source text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bl record;
  v_result jsonb;
  v_issued integer := 0;
  v_blocked integer := 0;
  v_failed integer := 0;
  v_sqlstate text;
BEGIN
  IF NOT public.customer_billing_access_ready(p_customer_id) THEN
    PERFORM public.reconcile_customer_bl_review_alerts(p_customer_id, NULL, p_source);
    RETURN jsonb_build_object('customer_id', p_customer_id, 'gate_open', false,
      'issued', 0, 'blocked', 0, 'failed', 0);
  END IF;

  -- 472 (DEM-D13): com o gate aberto, a Demurrage retida por ele volta à fila.
  PERFORM public._enqueue_held_demurrage_billing(
    ARRAY(SELECT b.id FROM public.bls b WHERE b.customer_id = p_customer_id AND b.cancelled_at IS NULL), p_actor);

  -- Com o gate aberto, a retenção do Portal deixa de ser verdadeira. Quem não
  -- emitir abaixo fica com o próprio bloqueio, não com um motivo velho.
  UPDATE public.bls
     SET billing_hold_reason = NULL
   WHERE customer_id = p_customer_id
     AND COALESCE(financial_status, 'pending') = 'pending'
     AND billing_hold_reason = 'Acesso ao portal nao provisionado';

  FOR v_bl IN
    SELECT b.id
    FROM public.bls b
    WHERE b.customer_id = p_customer_id
      AND COALESCE(b.financial_status, 'pending') = 'pending'
      AND b.customer_reconciliation_status IN ('matched_document', 'reconciled')
    ORDER BY b.id
  LOOP
    -- Reaproveita o cálculo do dia do CE (085); não recalcula pela tabela de hoje.
    v_result := public._auto_bill_bl_core(v_bl.id, p_actor, true);
    IF v_result->>'status' = 'invoiced' THEN
      v_issued := v_issued + 1;
      PERFORM public.block521_resolve_alert('portal_reprocessamento_falhou', 'bl', v_bl.id, 'documentacao', p_source);
    ELSIF v_result->>'status' IN ('already_invoiced', 'skipped') THEN
      NULL;
    ELSE
      v_sqlstate := v_result->>'sqlstate';
      -- Bloqueio de negócio (CE, revisão, tabela, gate) é esperado e fica na
      -- Validação; só falha técnica abre o Alerta de reprocessamento.
      IF v_result->>'reason' = 'auto_billing_failed'
         AND COALESCE(v_sqlstate, '') NOT IN ('P0003', '22023', 'P0002', 'P0004') THEN
        v_failed := v_failed + 1;
        PERFORM public.block521_upsert_alert('portal_reprocessamento_falhou', 'bl', v_bl.id,
          'Falha técnica ao reprocessar faturamento após abertura do gate do Portal.', p_source, 'documentacao',
          jsonb_build_object('sqlstate', v_sqlstate, 'error', v_result->>'message'),
          '/manifestos/' || v_bl.id || '?tab=faturamento');
      ELSE
        v_blocked := v_blocked + 1;
      END IF;
    END IF;
  END LOOP;

  PERFORM public.reconcile_customer_bl_review_alerts(p_customer_id, NULL, p_source);
  RETURN jsonb_build_object('customer_id', p_customer_id, 'gate_open', true,
    'issued', v_issued, 'blocked', v_blocked, 'failed', v_failed);
END;
$function$;

-- 4 --- Invoices "vencidas" passam a emitidas (DEM-D09) ----------------------
UPDATE public.demurrage_invoices SET status = 'issued' WHERE status = 'overdue';
