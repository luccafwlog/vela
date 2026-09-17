-- 056: Resolucao compartilhada de duas tabelas de taxas e faturamento de BL misto (ADR 0069)
--
-- Conforme ADR 0069 e spec docs/spec/2026-09-16-unificacao-bls-carga-mista-design.md:
--   1. charge_tables permanece com container, carga_solta e granito (sem 'misto').
--   2. Funcao compartilhada resolve_bl_local_charge_table_ids devolve 1 tabela para modalidade unica e 2 para misto.
--   3. BL misto cobra exatamente 1 taxa documental (do container), suprimindo itens com application_basis = 'bl' da carga solta.
--   4. mark_bl_ready_for_billing consome a funcao compartilhada e desbloqueia BLs mistos.
--   5. calculate_bl_local_charges e resolve_bl_local_charge_items sao unificados sob o mesmo contrato.

-- 1. Funcao unica compartilhada de resolucao de tabelas de taxas
CREATE OR REPLACE FUNCTION public.resolve_bl_local_charge_table_ids(
  p_bl_id text,
  p_reference_date date DEFAULT NULL::date
)
RETURNS TABLE(table_id bigint, cargo_mode text)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_bl record;
  v_ref_date date := p_reference_date;
  v_cntr_table_id bigint;
  v_bb_table_id bigint;
BEGIN
  SELECT b.id, b.pod, b.cargo_mode, b.voyage_id
  INTO v_bl
  FROM public.bls b
  WHERE b.id = p_bl_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_ref_date IS NULL THEN
    SELECT v.eta::date INTO v_ref_date
    FROM public.voyages v
    WHERE v.id = v_bl.voyage_id AND v.eta IS NOT NULL;
  END IF;
  v_ref_date := COALESCE(v_ref_date, CURRENT_DATE);

  IF v_bl.cargo_mode = 'container' THEN
    v_cntr_table_id := public.resolve_local_charge_table_id('container', v_bl.pod, v_ref_date);
    IF v_cntr_table_id IS NOT NULL THEN
      table_id := v_cntr_table_id;
      cargo_mode := 'container';
      RETURN NEXT;
    END IF;

  ELSIF v_bl.cargo_mode = 'carga_solta' THEN
    v_bb_table_id := public.resolve_local_charge_table_id('carga_solta', v_bl.pod, v_ref_date);
    IF v_bb_table_id IS NOT NULL THEN
      table_id := v_bb_table_id;
      cargo_mode := 'carga_solta';
      RETURN NEXT;
    END IF;

  ELSIF v_bl.cargo_mode = 'misto' THEN
    v_cntr_table_id := public.resolve_local_charge_table_id('container', v_bl.pod, v_ref_date);
    IF v_cntr_table_id IS NOT NULL THEN
      table_id := v_cntr_table_id;
      cargo_mode := 'container';
      RETURN NEXT;
    END IF;

    v_bb_table_id := public.resolve_local_charge_table_id('carga_solta', v_bl.pod, v_ref_date);
    IF v_bb_table_id IS NOT NULL THEN
      table_id := v_bb_table_id;
      cargo_mode := 'carga_solta';
      RETURN NEXT;
    END IF;
  END IF;

  RETURN;
END;
$$;

-- Resolver interno: a API expõe apenas mark_bl_ready_for_billing/calculate_bl_local_charges.
-- Mantém a superfície de leitura de tabelas de preço fora do papel autenticado;
-- service_role pode usá-lo em diagnósticos/consumidores server-only.
REVOKE ALL ON FUNCTION public.resolve_bl_local_charge_table_ids(text, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_bl_local_charge_table_ids(text, date) TO service_role;

-- 2. Atualizacao de mark_bl_ready_for_billing consumindo resolve_bl_local_charge_table_ids e preservando todos os gates de 047
CREATE OR REPLACE FUNCTION public.mark_bl_ready_for_billing(p_bl_id text, p_actor uuid DEFAULT NULL::uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_bl record;
  v_pending_count integer := 0;
  v_table_count integer := 0;
  v_invoiceable_count integer := 0;
  v_review_reasons text[];
  v_terminal_pendencies text[];
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Acesso negado para marcar B/L como pronto para faturar.' USING ERRCODE = '42501';
  END IF;

  SELECT id, charge_status, pod, cargo_mode, customer_id, customer_reconciliation_status
  INTO v_bl FROM public.bls WHERE id = p_bl_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L "%" nao encontrado.', p_bl_id USING ERRCODE = 'P0002';
  END IF;

  -- Gate 1: Assertiva universal de CE Mercante (migration 047)
  PERFORM public.assert_bl_ce_mercante(p_bl_id);

  -- Gate 2: Vinculo de cliente (migration 047)
  IF v_bl.customer_id IS NULL THEN
    RAISE EXCEPTION 'B/L % nao possui cliente vinculado. Vincule um cliente antes de marcar como pronto para faturar.', p_bl_id USING ERRCODE = 'P0003';
  END IF;

  -- Gate 3: Status de reconciliacao (migration 047)
  IF COALESCE(v_bl.customer_reconciliation_status, 'missing_customer') NOT IN ('matched_document', 'reconciled') THEN
    RAISE EXCEPTION 'B/L exige reconciliacao manual antes do faturamento.' USING ERRCODE = '22023';
  END IF;

  -- Gate 4: Pendencias no gate de revisao (migration 047)
  v_review_reasons := public.compute_bl_review_pendencies(p_bl_id);
  IF COALESCE(cardinality(v_review_reasons), 0) > 0 THEN
    RAISE EXCEPTION 'B/L possui pendencias no gate de revisao: %', array_to_string(v_review_reasons, ', ') USING ERRCODE = '22023';
  END IF;

  -- Gate 5: Linhas com review_required (migration 047)
  SELECT COUNT(*) INTO v_pending_count FROM public.charge_calculations WHERE bl_id = p_bl_id AND status = 'review_required';
  IF v_pending_count > 0 THEN
    RAISE EXCEPTION 'Ainda existem linhas com pendencia de revisao' USING ERRCODE = '22023';
  END IF;

  -- Gate 6: Terminal de descarga (ADR 0068 / migration 055)
  v_terminal_pendencies := public.check_bl_terminal_pendencies(p_bl_id);
  IF array_length(v_terminal_pendencies, 1) > 0 THEN
    RAISE EXCEPTION 'B/L com pendencia de terminal: %', array_to_string(v_terminal_pendencies, ', ')
      USING ERRCODE = '22023';
  END IF;

  -- Gate 7: Linhas faturaveis (migration 047)
  SELECT COUNT(*) INTO v_invoiceable_count
  FROM public.charge_calculations
  WHERE bl_id = p_bl_id
    AND (COALESCE(total_value_brl, 0) > 0 OR COALESCE(total_value_usd, 0) > 0)
    AND COALESCE(status, 'calculated') IN ('calculated', 'reviewed', 'ready_for_billing');
  
  IF v_invoiceable_count = 0 THEN
    RAISE EXCEPTION 'B/L sem linhas faturaveis.' USING ERRCODE = '22023';
  END IF;

  -- Gate 8: Resolucao de tabelas de taxas compartilhada (ADR 0069)
  SELECT COUNT(*) INTO v_table_count
  FROM public.resolve_bl_local_charge_table_ids(p_bl_id);

  IF (v_bl.cargo_mode = 'misto' AND v_table_count < 2) OR (v_bl.cargo_mode <> 'misto' AND v_table_count = 0) THEN
    RAISE EXCEPTION
      'Tabela de cobranca incompleta ou inativa para POD "%" (modo: %). Configure em /taxas-locais/tabelas antes de prosseguir.',
      v_bl.pod, v_bl.cargo_mode USING ERRCODE = 'P0004';
  END IF;

  UPDATE public.charge_calculations 
  SET status = 'ready_for_billing' 
  WHERE bl_id = p_bl_id AND status IN ('calculated', 'reviewed');

  UPDATE public.bls 
  SET charge_status = 'ready_for_billing', billing_hold_reason = NULL 
  WHERE id = p_bl_id;

  PERFORM public.sync_local_charge_receivable(p_bl_id);

  INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification)
  VALUES ('bl', p_bl_id, 'charge_status', COALESCE(v_bl.charge_status, 'null'), 'ready_for_billing', auth.uid(), NOW(), 'Marcado como pronto para faturar no modulo de Taxas Locais');

  RETURN jsonb_build_object('bl_id', p_bl_id, 'status', 'ready_for_billing', 'changed', true);
END;
$$;

-- Limpar eventuais sobrecargas incorretas de versoes anteriores
DROP FUNCTION IF EXISTS public.calculate_bl_local_charges(bigint, uuid);
DROP FUNCTION IF EXISTS public.resolve_bl_local_charge_items(bigint, text, date);

-- 3. resolve_bl_local_charge_items alinhado com ADR 0069 e charge_table_items
CREATE OR REPLACE FUNCTION public.resolve_bl_local_charge_items(
  p_bl_id text,
  p_pod text
)
RETURNS TABLE (
  charge_table_id bigint,
  charge_item_id bigint,
  quantity numeric(12,6),
  unit_value_brl numeric(12,2),
  unit_value_usd numeric(12,2),
  total_value_brl numeric(14,2),
  total_value_usd numeric(14,2),
  override_applied boolean,
  source text,
  status text,
  calculation_key text,
  review_reason text,
  notes text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_bl record;
  v_ref_date date;
  v_tbl record;
  v_table_count integer := 0;
  v_has_container_table boolean := false;
  v_has_bb_table boolean := false;
  v_qty_total numeric(12,6) := 0;
  v_qty_std numeric(12,6) := 0;
  v_qty_imo numeric(12,6) := 0;
  v_qty_oog numeric(12,6) := 0;
  v_qty_dual numeric(12,6) := 0;
  v_container_shares jsonb;
  v_weight_ton numeric(12,3);
  v_qty numeric(12,6);
  v_unit_brl numeric(12,2);
  v_unit_usd numeric(12,2);
  v_total_line_brl numeric(14,2);
  v_total_line_usd numeric(14,2);
  v_is_thd boolean;
  v_override boolean;
  item record;
BEGIN
  SELECT
    b.id,
    b.voyage_id,
    COALESCE(b.cargo_mode, 'container') AS cargo_mode,
    b.customer_id,
    NULLIF((to_jsonb(b)->>'bb_weight_ton'), '')::numeric AS bb_weight_ton,
    b.total_weight_kg
  INTO v_bl
  FROM public.bls AS b
  WHERE b.id = p_bl_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT v_eta_raw.eta_text::date
  INTO v_ref_date
  FROM public.voyages AS v
  CROSS JOIN LATERAL (
    SELECT NULLIF(TRIM(v.pod_schedule_snapshot -> p_pod ->> 'eta'), '') AS eta_text
  ) AS v_eta_raw
  WHERE v.id = v_bl.voyage_id
    AND v_eta_raw.eta_text ~ '^\d{4}-\d{2}-\d{2}$';

  IF v_ref_date IS NULL THEN
    SELECT v.eta::date
    INTO v_ref_date
    FROM public.voyages AS v
    WHERE v.id = v_bl.voyage_id
      AND v.eta IS NOT NULL;
  END IF;

  v_ref_date := COALESCE(v_ref_date, CURRENT_DATE);

  -- 1. Contêineres e rateios se container ou misto
  IF v_bl.cargo_mode IN ('container', 'misto') THEN
    WITH current_containers AS (
      SELECT
        UPPER(TRIM(bc.container_number)) AS cn,
        BOOL_OR(COALESCE(bc.is_imo, false)) AS has_imo,
        BOOL_OR(COALESCE(bc.is_oog, false)) AS has_oog
      FROM public.bl_containers AS bc
      WHERE bc.bl_id = p_bl_id
        AND TRIM(COALESCE(bc.container_number, '')) <> ''
      GROUP BY UPPER(TRIM(bc.container_number))
    ),
    shares AS (
      SELECT
        cc.cn,
        cc.has_imo,
        cc.has_oog,
        sh.share_count,
        sh.last_bl_id
      FROM current_containers AS cc
      JOIN LATERAL (
        SELECT
          COUNT(DISTINCT b2.id)::numeric AS share_count,
          MAX(b2.id) AS last_bl_id
        FROM public.bls AS b2
        JOIN public.bl_containers AS bc2 ON bc2.bl_id = b2.id
        WHERE b2.voyage_id = v_bl.voyage_id
          AND COALESCE(b2.cargo_mode, 'container') IN ('container', 'misto')
          AND UPPER(TRIM(COALESCE(bc2.container_number, ''))) = cc.cn
      ) AS sh ON TRUE
    )
    SELECT
      COALESCE(SUM(CASE WHEN share_count > 0 THEN 1 / share_count ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN NOT has_imo AND NOT has_oog AND share_count > 0 THEN 1 / share_count ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN has_imo AND NOT has_oog AND share_count > 0 THEN 1 / share_count ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN has_oog AND NOT has_imo AND share_count > 0 THEN 1 / share_count ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN has_imo AND has_oog AND share_count > 0 THEN 1 / share_count ELSE 0 END), 0),
      jsonb_agg(jsonb_build_object(
        'has_imo', has_imo,
        'has_oog', has_oog,
        'share_count', share_count,
        'is_last', (p_bl_id = last_bl_id)
      )) FILTER (WHERE share_count > 0)
    INTO v_qty_total, v_qty_std, v_qty_imo, v_qty_oog, v_qty_dual, v_container_shares
    FROM shares;
  END IF;

  -- 2. Resolver tabelas (ADR 0069)
  FOR v_tbl IN SELECT table_id, cargo_mode FROM public.resolve_bl_local_charge_table_ids(p_bl_id, v_ref_date) LOOP
    v_table_count := v_table_count + 1;
    IF v_tbl.cargo_mode = 'container' THEN v_has_container_table := true; END IF;
    IF v_tbl.cargo_mode = 'carga_solta' THEN v_has_bb_table := true; END IF;

    -- Iterar itens da tabela ativa
    FOR item IN
      SELECT
        cti.id,
        cti.name,
        cti.application_basis,
        COALESCE(cti.cargo_profile, 'any') AS cargo_profile,
        COALESCE(cti.currency, 'BRL') AS currency,
        cti.unit_value_brl,
        cti.unit_value_usd,
        ov.override_value
      FROM public.charge_table_items AS cti
      LEFT JOIN LATERAL (
        SELECT cro.override_value
        FROM public.customer_rate_overrides AS cro
        WHERE cro.customer_id = v_bl.customer_id
          AND cro.charge_item_id = cti.id
          AND (cro.valid_from IS NULL OR cro.valid_from <= v_ref_date)
          AND (cro.valid_to IS NULL OR cro.valid_to >= v_ref_date)
        LIMIT 1
      ) AS ov ON TRUE
      WHERE cti.charge_table_id = v_tbl.table_id
        AND COALESCE(cti.active, true)
        AND NOT COALESCE(cti.manual_only, false)
      ORDER BY COALESCE(cti.sort_order, 100), cti.id
    LOOP
      -- Regra ADR 0069: em BL misto, suprimir itens de base 'bl' da tabela de carga solta
      IF v_bl.cargo_mode = 'misto' AND v_tbl.cargo_mode = 'carga_solta' AND item.application_basis = 'bl' THEN
        CONTINUE;
      END IF;

      charge_table_id := v_tbl.table_id;
      charge_item_id := item.id;
      quantity := 0;
      unit_value_brl := NULL;
      unit_value_usd := NULL;
      total_value_brl := 0;
      total_value_usd := NULL;
      override_applied := false;
      source := 'auto';
      status := 'review_required';
      calculation_key := NULL;
      review_reason := NULL;
      notes := 'Revisao manual obrigatoria';

      v_qty := 0;
      v_is_thd := UPPER(COALESCE(item.name, '')) LIKE 'THD%';

      IF item.application_basis = 'bl' THEN
        v_qty := 1;
      ELSIF item.application_basis = 'weight_ton' THEN
        v_weight_ton := COALESCE(
          v_bl.bb_weight_ton,
          CASE WHEN v_bl.total_weight_kg IS NULL THEN NULL ELSE v_bl.total_weight_kg / 1000 END,
          0
        );
        IF v_weight_ton <= 0 THEN
          calculation_key := CONCAT('review:weight_missing:', item.id);
          review_reason := 'Weight ton ausente/invalido para calculo';
          RETURN NEXT;
          CONTINUE;
        END IF;
        v_qty := v_weight_ton;
      ELSIF item.application_basis = 'container_distinct_voyage' THEN
        IF v_bl.cargo_mode IN ('container', 'misto') THEN
          IF v_is_thd THEN
            IF item.cargo_profile = 'standard' THEN
              v_qty := v_qty_std;
            ELSIF item.cargo_profile = 'imo' THEN
              v_qty := v_qty_imo;
            ELSIF item.cargo_profile = 'oog' THEN
              v_qty := v_qty_oog;
            ELSE
              calculation_key := CONCAT('review:thd_any_profile:', item.id);
              review_reason := 'Item THD cadastrado com perfil de carga ''any''; motor so calcula standard/imo/oog';
              notes := 'Revisao manual obrigatoria';
              RETURN NEXT;
              CONTINUE;
            END IF;
          ELSE
            v_qty := v_qty_total;
          END IF;
        END IF;
      ELSE
        calculation_key := CONCAT('review:unsupported_basis:', item.id);
        review_reason := CONCAT('Base de aplicacao nao suportada pelo motor: ', COALESCE(item.application_basis, '(vazia)'));
        RETURN NEXT;
        CONTINUE;
      END IF;

      IF COALESCE(v_qty, 0) <= 0 THEN
        CONTINUE;
      END IF;

      status := 'calculated';
      notes := NULL;
      calculation_key := CONCAT('auto:item:', item.id);
      v_override := item.override_value IS NOT NULL;
      override_applied := v_override;
      v_unit_brl := COALESCE(item.override_value, item.unit_value_brl, 0);
      v_unit_usd := item.unit_value_usd;
      quantity := v_qty;
      unit_value_brl := CASE WHEN item.currency = 'USD' THEN NULL ELSE v_unit_brl END;
      unit_value_usd := CASE WHEN item.currency = 'USD' THEN v_unit_usd ELSE NULL END;

      IF item.application_basis = 'container_distinct_voyage' AND v_bl.cargo_mode IN ('container', 'misto') THEN
        IF item.currency = 'USD' THEN
          SELECT COALESCE(SUM(
            CASE WHEN (elem->>'is_last')::boolean
              THEN COALESCE(v_unit_usd, 0) - ((elem->>'share_count')::numeric - 1) * ROUND(COALESCE(v_unit_usd, 0) / (elem->>'share_count')::numeric, 2)
              ELSE ROUND(COALESCE(v_unit_usd, 0) / (elem->>'share_count')::numeric, 2)
            END
          ), 0)
          INTO v_total_line_usd
          FROM jsonb_array_elements(COALESCE(v_container_shares, '[]'::jsonb)) AS elem
          WHERE
            NOT v_is_thd
            OR (item.cargo_profile = 'standard' AND NOT (elem->>'has_imo')::boolean AND NOT (elem->>'has_oog')::boolean)
            OR (item.cargo_profile = 'imo' AND (elem->>'has_imo')::boolean AND NOT (elem->>'has_oog')::boolean)
            OR (item.cargo_profile = 'oog' AND (elem->>'has_oog')::boolean AND NOT (elem->>'has_imo')::boolean);
          v_total_line_brl := NULL;
        ELSE
          SELECT COALESCE(SUM(
            CASE WHEN (elem->>'is_last')::boolean
              THEN COALESCE(v_unit_brl, 0) - ((elem->>'share_count')::numeric - 1) * ROUND(COALESCE(v_unit_brl, 0) / (elem->>'share_count')::numeric, 2)
              ELSE ROUND(COALESCE(v_unit_brl, 0) / (elem->>'share_count')::numeric, 2)
            END
          ), 0)
          INTO v_total_line_brl
          FROM jsonb_array_elements(COALESCE(v_container_shares, '[]'::jsonb)) AS elem
          WHERE
            NOT v_is_thd
            OR (item.cargo_profile = 'standard' AND NOT (elem->>'has_imo')::boolean AND NOT (elem->>'has_oog')::boolean)
            OR (item.cargo_profile = 'imo' AND (elem->>'has_imo')::boolean AND NOT (elem->>'has_oog')::boolean)
            OR (item.cargo_profile = 'oog' AND (elem->>'has_oog')::boolean AND NOT (elem->>'has_imo')::boolean);
          v_total_line_usd := NULL;
        END IF;
      ELSE
        v_total_line_brl := CASE WHEN item.currency = 'USD' THEN NULL ELSE ROUND(v_qty * COALESCE(v_unit_brl, 0), 2) END;
        v_total_line_usd := CASE WHEN item.currency = 'USD' THEN ROUND(v_qty * COALESCE(v_unit_usd, 0), 2) ELSE NULL END;
      END IF;

      total_value_brl := v_total_line_brl;
      total_value_usd := v_total_line_usd;
      RETURN NEXT;
    END LOOP;
  END LOOP;

  -- 3. Tratar ausencias de tabelas conforme ADR 0069 (eliminando retorno silencioso)
  IF v_table_count = 0 THEN
    charge_table_id := NULL;
    charge_item_id := NULL;
    quantity := 1;
    unit_value_brl := NULL;
    unit_value_usd := NULL;
    total_value_brl := 0;
    total_value_usd := NULL;
    override_applied := false;
    source := 'auto';
    status := 'review_required';
    calculation_key := 'review:no_table';
    review_reason := 'Nenhuma tabela de taxas ativa encontrada para o porto de descarga';
    notes := 'Revisao manual obrigatoria';
    RETURN NEXT;

  ELSIF v_bl.cargo_mode = 'misto' AND v_table_count = 1 THEN
    charge_table_id := NULL;
    charge_item_id := NULL;
    quantity := 1;
    unit_value_brl := NULL;
    unit_value_usd := NULL;
    total_value_brl := 0;
    total_value_usd := NULL;
    override_applied := false;
    source := 'auto';
    status := 'review_required';
    calculation_key := CASE WHEN NOT v_has_container_table THEN 'review:missing_charge_table:container' ELSE 'review:missing_charge_table:carga_solta' END;
    review_reason := 'Tabela de taxas parcial em B/L misto: falta tabela complementar';
    notes := 'Revisao manual obrigatoria';
    RETURN NEXT;
  END IF;

  RETURN;
END;
$function$;

-- 4. calculate_bl_local_charges atualizado para delegar a resolve_bl_local_charge_items
CREATE OR REPLACE FUNCTION public.calculate_bl_local_charges(
  p_bl_id text,
  p_actor uuid DEFAULT NULL::uuid,
  p_recalculate boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_bl record;
  v_actor uuid;
  v_has_vehicles boolean := false;
  v_is_exempt boolean := false;
  v_is_lcl_movement boolean := false;
  v_auto_review boolean := false;
  v_line_count integer := 0;
  v_total_brl numeric(14,2) := 0;
  v_total_usd numeric(14,2) := 0;
  v_status text := 'calculated';
  v_reason text := NULL;
  v_no_containers boolean := false;
  v_qty_dual numeric(12,6) := 0;
  item record;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa' USING ERRCODE = '42501';
  END IF;

  SELECT
    b.id,
    b.voyage_id,
    b.batch_id,
    COALESCE(b.cargo_mode, 'container') AS cargo_mode,
    b.customer_id,
    b.pod,
    NULLIF((to_jsonb(b)->>'bb_weight_ton'), '')::numeric AS bb_weight_ton,
    b.total_weight_kg,
    b.movement_to,
    b.financial_status
  INTO v_bl
  FROM public.bls AS b
  WHERE b.id = p_bl_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L % nao encontrado', p_bl_id USING ERRCODE = 'P0002';
  END IF;

  IF v_bl.financial_status IN ('invoiced', 'partially_paid', 'paid') THEN
    RAISE EXCEPTION 'B/L % ja foi faturado (status financeiro=%); recalculo bloqueado. Cancele e reemita a fatura para corrigir.', p_bl_id, v_bl.financial_status USING ERRCODE = '22023';
  END IF;

  v_actor := COALESCE(p_actor, auth.uid());

  IF p_recalculate THEN
    DELETE FROM public.charge_calculations
    WHERE bl_id = p_bl_id
      AND COALESCE(source, 'auto') = 'auto';
  END IF;

  -- Checar isencao LCL de veiculos
  SELECT EXISTS(SELECT 1 FROM public.vehicles WHERE bl_id = p_bl_id)
  INTO v_has_vehicles;

  v_is_lcl_movement := v_bl.movement_to IS NOT NULL AND (
    UPPER(TRIM(v_bl.movement_to)) LIKE '%LCL%' OR UPPER(TRIM(v_bl.movement_to)) LIKE '%CFS%'
  );

  IF v_bl.cargo_mode = 'container' AND v_has_vehicles AND v_is_lcl_movement THEN
    v_is_exempt := true;
    v_reason := 'Carga de veiculos / LCL no destino (movement_to=' || v_bl.movement_to || ') com taxas pagas na origem';

    INSERT INTO public.charge_calculations (
      bl_id, source, status, calculation_key, quantity,
      unit_value_brl, total_value_brl, notes, review_reason, created_by, calculated_at
    )
    VALUES (
      p_bl_id, 'auto', 'exempt', 'exempt:lcl_vehicle', 1,
      0, 0, 'Linha sintetica de isencao', v_reason, v_actor, NOW()
    )
    ON CONFLICT (bl_id, calculation_key) DO UPDATE
      SET status = EXCLUDED.status,
          quantity = EXCLUDED.quantity,
          unit_value_brl = EXCLUDED.unit_value_brl,
          total_value_brl = EXCLUDED.total_value_brl,
          notes = EXCLUDED.notes,
          review_reason = EXCLUDED.review_reason,
          created_by = EXCLUDED.created_by,
          calculated_at = NOW();

    UPDATE public.bls
    SET charge_status = 'exempt',
        charges_calculated_at = NOW(),
        charge_exemption_reason = v_reason,
        billing_hold_reason = NULL
    WHERE id = p_bl_id;

    RETURN jsonb_build_object(
      'bl_id', p_bl_id, 'status', 'exempt', 'table_id', NULL,
      'line_count', 1, 'total_brl', 0, 'total_usd', 0,
      'review_required', false, 'exempt', true, 'reason', v_reason
    );
  END IF;

  -- Checagens de conteineres para revisao (IMO+OOG ou sem containers)
  IF v_bl.cargo_mode IN ('container', 'misto') THEN
    SELECT COUNT(*)
    INTO v_qty_dual
    FROM (
      SELECT 1 FROM public.bl_containers bc
      WHERE bc.bl_id = p_bl_id AND COALESCE(bc.is_imo, false) AND COALESCE(bc.is_oog, false)
    ) s;

    IF v_qty_dual > 0 THEN
      v_auto_review := true;
      INSERT INTO public.charge_calculations (
        bl_id, source, status, calculation_key, quantity,
        total_value_brl, review_reason, notes, created_by, calculated_at
      )
      VALUES (
        p_bl_id, 'auto', 'review_required', 'review:imo_oog_thd', v_qty_dual,
        0, 'Container com IMO e OOG ao mesmo tempo exige revisao manual de THD', 'THD nao calculado automaticamente', v_actor, NOW()
      )
      ON CONFLICT (bl_id, calculation_key) DO UPDATE
        SET status = EXCLUDED.status, quantity = EXCLUDED.quantity,
            total_value_brl = EXCLUDED.total_value_brl, review_reason = EXCLUDED.review_reason,
            notes = EXCLUDED.notes, created_by = EXCLUDED.created_by, calculated_at = NOW();
    END IF;

    IF v_bl.cargo_mode = 'container' THEN
      SELECT NOT EXISTS(
        SELECT 1 FROM public.bl_containers AS bc
        WHERE bc.bl_id = p_bl_id AND TRIM(COALESCE(bc.container_number, '')) <> ''
      ) INTO v_no_containers;

      IF v_no_containers THEN
        v_auto_review := true;
        INSERT INTO public.charge_calculations (
          bl_id, source, status, calculation_key, quantity,
          total_value_brl, review_reason, notes, created_by, calculated_at
        )
        VALUES (
          p_bl_id, 'auto', 'review_required', 'review:no_containers', 1,
          0, 'B/L de container sem containers cadastrados', 'Revisao manual obrigatoria', v_actor, NOW()
        )
        ON CONFLICT (bl_id, calculation_key) DO UPDATE
          SET status = EXCLUDED.status, quantity = EXCLUDED.quantity,
              total_value_brl = EXCLUDED.total_value_brl, review_reason = EXCLUDED.review_reason,
              notes = EXCLUDED.notes, created_by = EXCLUDED.created_by, calculated_at = NOW();
      END IF;
    END IF;
  END IF;

  -- Iterar linhas resolvidas por resolve_bl_local_charge_items (ADR 0069)
  FOR item IN SELECT * FROM public.resolve_bl_local_charge_items(p_bl_id, v_bl.pod) LOOP
    IF item.status = 'review_required' THEN
      v_auto_review := true;
      INSERT INTO public.charge_calculations (
        bl_id, charge_table_id, charge_item_id, source, status, calculation_key, quantity,
        total_value_brl, review_reason, notes, created_by, calculated_at
      )
      VALUES (
        p_bl_id, item.charge_table_id, item.charge_item_id, item.source, item.status, item.calculation_key,
        item.quantity, item.total_value_brl, item.review_reason, item.notes, v_actor, NOW()
      )
      ON CONFLICT (bl_id, calculation_key) DO UPDATE
        SET status = EXCLUDED.status,
            quantity = EXCLUDED.quantity,
            total_value_brl = EXCLUDED.total_value_brl,
            review_reason = EXCLUDED.review_reason,
            notes = EXCLUDED.notes,
            created_by = EXCLUDED.created_by,
            calculated_at = NOW();
    ELSE
      INSERT INTO public.charge_calculations (
        bl_id, charge_table_id, charge_item_id, quantity,
        unit_value_brl, unit_value_usd, total_value_brl, total_value_usd,
        override_applied, source, status, calculation_key,
        created_by, calculated_at
      )
      VALUES (
        p_bl_id, item.charge_table_id, item.charge_item_id, item.quantity,
        item.unit_value_brl, item.unit_value_usd, item.total_value_brl, item.total_value_usd,
        item.override_applied, item.source, item.status, item.calculation_key,
        v_actor, NOW()
      )
      ON CONFLICT (bl_id, calculation_key) DO UPDATE
        SET charge_table_id = EXCLUDED.charge_table_id,
            charge_item_id = EXCLUDED.charge_item_id,
            quantity = EXCLUDED.quantity,
            unit_value_brl = EXCLUDED.unit_value_brl,
            unit_value_usd = EXCLUDED.unit_value_usd,
            total_value_brl = EXCLUDED.total_value_brl,
            total_value_usd = EXCLUDED.total_value_usd,
            override_applied = EXCLUDED.override_applied,
            source = EXCLUDED.source,
            status = EXCLUDED.status,
            created_by = EXCLUDED.created_by,
            calculated_at = NOW();
    END IF;
  END LOOP;

  SELECT COUNT(*),
         COALESCE(SUM(COALESCE(total_value_brl, 0)), 0),
         COALESCE(SUM(COALESCE(total_value_usd, 0)), 0)
  INTO v_line_count, v_total_brl, v_total_usd
  FROM public.charge_calculations
  WHERE bl_id = p_bl_id;

  IF v_is_exempt THEN
    v_status := 'exempt';
  ELSIF v_auto_review THEN
    v_status := 'review_required';
  ELSIF v_line_count > 0 THEN
    v_status := 'calculated';
  ELSE
    v_status := 'not_calculated';
  END IF;

  UPDATE public.bls
  SET charge_status = v_status,
      charges_calculated_at = NOW(),
      charge_exemption_reason = CASE WHEN v_status = 'exempt' THEN v_reason ELSE NULL END,
      billing_hold_reason = CASE
        WHEN v_status = 'review_required' THEN 'Pendencia de revisao nas taxas locais.'
        WHEN v_status = 'not_calculated' THEN 'Nenhuma tabela de preco ou tarifa encontrada. Adicione os precos e recalcule.'
        ELSE NULL
      END
  WHERE id = p_bl_id;

  PERFORM public.sync_local_charge_receivable(p_bl_id);

  RETURN jsonb_build_object(
    'bl_id', p_bl_id,
    'status', v_status,
    'line_count', v_line_count,
    'total_brl', v_total_brl,
    'total_usd', v_total_usd,
    'review_required', v_auto_review,
    'exempt', (v_status = 'exempt'),
    'reason', COALESCE(v_reason, '')
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.calculate_bl_local_charges(text, uuid, boolean) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.resolve_bl_local_charge_items(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_bl_local_charge_items(text, text) TO service_role;

-- 5. Atualizar worker _run_import_effect_local_charges para nao filtrar out 'misto' e 'carga_solta'
CREATE OR REPLACE FUNCTION public._run_import_effect_local_charges(
  p_entity_id text,
  p_actor uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_origin_bl_id text;
  v_current_bl_id text;
  v_voyage_id bigint;
  v_container_numbers text[];
  v_bl_ids text[];
  v_result jsonb := '[]'::jsonb;
  v_calculated integer := 0;
  v_financial_status text;
  v_ce_mercante text;
  v_one jsonb;
BEGIN
  SELECT b.id, b.voyage_id, b.financial_status, b.ce_mercante
    INTO v_origin_bl_id, v_voyage_id, v_financial_status, v_ce_mercante
  FROM public.bls AS b
  WHERE b.id = NULLIF(btrim(p_entity_id), '');

  IF v_origin_bl_id IS NOT NULL THEN
    IF COALESCE(v_financial_status, 'pending') <> 'pending' THEN
      RETURN jsonb_build_object(
        'entity_id', p_entity_id,
        'calculated', 0,
        'results', jsonb_build_array(jsonb_build_object(
          'status', 'already_invoiced',
          'idempotent', true,
          'bl_id', v_origin_bl_id,
          'financial_status', v_financial_status
        ))
      );
    END IF;

    SELECT COALESCE(array_agg(DISTINCT upper(btrim(c.container_number))), ARRAY[]::text[])
      INTO v_container_numbers
    FROM public.bl_containers AS c
    WHERE c.bl_id = v_origin_bl_id
      AND NULLIF(btrim(c.container_number), '') IS NOT NULL;

    IF cardinality(v_container_numbers) = 0 THEN
      v_container_numbers := NULL;
    END IF;
  ELSE
    IF NULLIF(btrim(p_entity_id), '') IS NULL OR p_entity_id !~ '^[0-9]+$' THEN
      RAISE EXCEPTION 'Entidade de efeito local desconhecida: %.', p_entity_id
        USING ERRCODE = 'P0002';
    END IF;

    SELECT v.id
      INTO v_voyage_id
    FROM public.voyages AS v
    WHERE v.id = p_entity_id::bigint;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Viagem de efeito local nao encontrada: %.', p_entity_id
        USING ERRCODE = 'P0002';
    END IF;
  END IF;

  SELECT COALESCE(array_agg(DISTINCT b.id ORDER BY b.id), ARRAY[]::text[])
    INTO v_bl_ids
  FROM public.bls AS b
  WHERE b.voyage_id = v_voyage_id
    AND COALESCE(b.cargo_mode, 'container') IN ('container', 'carga_solta', 'misto')
    AND COALESCE(b.financial_status, 'pending') = 'pending'
    AND (
      COALESCE(b.charge_status, '') <> 'ready_for_billing'
      OR NULLIF(btrim(b.ce_mercante), '') IS NOT NULL
    )
    AND (
      v_container_numbers IS NULL
      OR EXISTS (
        SELECT 1
        FROM public.bl_containers AS c
        WHERE c.bl_id = b.id
          AND upper(btrim(c.container_number)) = ANY(v_container_numbers)
      )
    );

  IF v_origin_bl_id IS NOT NULL AND cardinality(v_bl_ids) = 0 THEN
    v_bl_ids := ARRAY[v_origin_bl_id];
  END IF;

  IF cardinality(v_bl_ids) = 0 THEN
    RETURN jsonb_build_object('entity_id', p_entity_id, 'calculated', 0, 'results', v_result);
  END IF;

  FOREACH v_current_bl_id IN ARRAY v_bl_ids LOOP
    SELECT b.financial_status, b.ce_mercante
      INTO v_financial_status, v_ce_mercante
    FROM public.bls AS b
    WHERE b.id = v_current_bl_id;

    IF COALESCE(v_financial_status, 'pending') <> 'pending' THEN
      v_one := jsonb_build_object(
        'status', 'already_invoiced',
        'idempotent', true,
        'bl_id', v_current_bl_id,
        'financial_status', v_financial_status
      );
    ELSIF v_current_bl_id = v_origin_bl_id
      AND NULLIF(btrim(COALESCE(v_ce_mercante, '')), '') IS NOT NULL THEN
      v_one := public.auto_bill_bl_after_ce_mercante(v_current_bl_id, p_actor);
    ELSE
      v_one := public.calculate_bl_local_charges(v_current_bl_id, p_actor, true);
    END IF;

    v_result := v_result || jsonb_build_array(v_one);
    v_calculated := v_calculated + 1;

    IF v_one->>'status' = 'blocked'
       AND v_one->>'reason' = 'auto_billing_failed' THEN
      RAISE EXCEPTION 'Faturamento automatico do B/L % bloqueado: %',
        v_current_bl_id,
        COALESCE(v_one->>'message', 'falha desconhecida')
        USING ERRCODE = '22023';
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'entity_id', p_entity_id,
    'calculated', v_calculated,
    'results', v_result
  );
END;
$$;

REVOKE ALL ON FUNCTION public._run_import_effect_local_charges(text, uuid) FROM PUBLIC, anon, authenticated;
