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
  p_bl_id bigint, 
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
  SELECT id, pod, cargo_mode, voyage_id
  INTO v_bl
  FROM public.bls
  WHERE id = p_bl_id;

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

GRANT EXECUTE ON FUNCTION public.resolve_bl_local_charge_table_ids(bigint, date) TO authenticated, service_role;

-- 2. Atualizacao de mark_bl_ready_for_billing consumindo resolve_bl_local_charge_table_ids
CREATE OR REPLACE FUNCTION public.mark_bl_ready_for_billing(p_bl_id text, p_actor uuid DEFAULT NULL::uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_bl record;
  v_bl_bigint bigint;
  v_invoiceable_count integer := 0;
  v_table_count integer := 0;
  v_terminal_pendencies text[];
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Acesso negado para marcar B/L como pronto para faturar.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_bl FROM public.bls WHERE id = p_bl_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L "%" nao encontrado.', p_bl_id USING ERRCODE = '22023';
  END IF;
  v_bl_bigint := v_bl.id;

  -- 1. Validacao de terminal de descarga (ADR 0068)
  v_terminal_pendencies := public.check_bl_terminal_pendencies(v_bl_bigint);
  IF array_length(v_terminal_pendencies, 1) > 0 THEN
    RAISE EXCEPTION 'B/L com pendencia de terminal: %', array_to_string(v_terminal_pendencies, ', ')
      USING ERRCODE = '22023';
  END IF;

  -- 2. Linhas faturaveis
  SELECT COUNT(*) INTO v_invoiceable_count
  FROM public.charge_calculations
  WHERE bl_id = v_bl_bigint
    AND (COALESCE(total_value_brl, 0) > 0 OR COALESCE(total_value_usd, 0) > 0)
    AND COALESCE(status, 'calculated') IN ('calculated', 'reviewed', 'ready_for_billing');
  
  IF v_invoiceable_count = 0 THEN
    RAISE EXCEPTION 'B/L sem linhas faturaveis.' USING ERRCODE = '22023';
  END IF;

  -- 3. Resolucao de tabelas de taxas compartilhada (ADR 0069)
  SELECT COUNT(*) INTO v_table_count
  FROM public.resolve_bl_local_charge_table_ids(v_bl_bigint);

  IF (v_bl.cargo_mode = 'misto' AND v_table_count < 2) OR (v_bl.cargo_mode <> 'misto' AND v_table_count = 0) THEN
    RAISE EXCEPTION
      'Tabela de cobranca incompleta ou inativa para POD "%" (modo: %). Configure em /taxas-locais/tabelas antes de prosseguir.',
      v_bl.pod, v_bl.cargo_mode USING ERRCODE = 'P0004';
  END IF;

  UPDATE public.charge_calculations 
  SET status = 'ready_for_billing' 
  WHERE bl_id = v_bl_bigint AND status IN ('calculated', 'reviewed');

  UPDATE public.bls 
  SET charge_status = 'ready_for_billing', billing_hold_reason = NULL 
  WHERE id = v_bl_bigint;

  PERFORM public.sync_local_charge_receivable(v_bl_bigint);

  INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification)
  VALUES ('bl', p_bl_id, 'charge_status', COALESCE(v_bl.charge_status, 'null'), 'ready_for_billing', auth.uid(), NOW(), 'Marcado como pronto para faturar no modulo de Taxas Locais');

  RETURN jsonb_build_object('bl_id', p_bl_id, 'status', 'ready_for_billing', 'changed', true);
END;
$$;

-- 3. calculate_bl_local_charges atualizado para duas tabelas e eliminando ramo silencioso
CREATE OR REPLACE FUNCTION public.calculate_bl_local_charges(
  p_bl_id bigint,
  p_actor uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_bl record;
  v_actor uuid := COALESCE(p_actor, auth.uid());
  v_ref_date date;
  v_tbl record;
  v_table_count integer := 0;
  v_item record;
  v_qty numeric;
  v_total_brl numeric;
  v_auto_review boolean := false;
  v_review_reason text;
  v_has_container_table boolean := false;
  v_has_bb_table boolean := false;
  v_qty_total numeric := 0;
  v_qty_std numeric := 0;
  v_qty_imo numeric := 0;
  v_qty_oog numeric := 0;
  v_qty_dual numeric := 0;
  v_container_shares jsonb;
  v_calc_count integer := 0;
BEGIN
  SELECT * INTO v_bl FROM public.bls WHERE id = p_bl_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L % nao encontrado', p_bl_id;
  END IF;

  -- 1. Calcular contêineres e rateios
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
      SELECT cc.cn, cc.has_imo, cc.has_oog, sh.share_count, sh.last_bl_id
      FROM current_containers AS cc
      JOIN LATERAL (
        SELECT COUNT(DISTINCT b2.id)::NUMERIC AS share_count, MAX(b2.id) AS last_bl_id
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
      jsonb_agg(jsonb_build_object('has_imo', has_imo, 'has_oog', has_oog, 'share_count', share_count, 'is_last', (p_bl_id = last_bl_id))) FILTER (WHERE share_count > 0)
    INTO v_qty_total, v_qty_std, v_qty_imo, v_qty_oog, v_qty_dual, v_container_shares
    FROM shares;
  END IF;

  -- 2. Resolver tabelas do B/L
  FOR v_tbl IN SELECT table_id, cargo_mode FROM public.resolve_bl_local_charge_table_ids(p_bl_id) LOOP
    v_table_count := v_table_count + 1;
    IF v_tbl.cargo_mode = 'container' THEN v_has_container_table := true; END IF;
    IF v_tbl.cargo_mode = 'carga_solta' THEN v_has_bb_table := true; END IF;

    -- Iterar itens da tabela
    FOR v_item IN 
      SELECT * FROM public.charge_items 
      WHERE charge_table_id = v_tbl.table_id AND active = true 
    LOOP
      -- Regra ADR 0069: em B/L misto, suprimir itens de base 'bl' da tabela de carga solta
      IF v_bl.cargo_mode = 'misto' AND v_tbl.cargo_mode = 'carga_solta' AND v_item.application_basis = 'bl' THEN
        CONTINUE;
      END IF;

      -- Definir quantidade por base de aplicacao
      IF v_item.application_basis = 'bl' THEN
        v_qty := 1;
      ELSIF v_item.application_basis = 'container' THEN
        v_qty := v_qty_total;
      ELSIF v_item.application_basis IN ('ton', 'weight') THEN
        v_qty := COALESCE(v_bl.bb_weight_ton, 0);
      ELSE
        v_qty := 1;
      END IF;

      IF v_qty > 0 THEN
        v_total_brl := ROUND(v_qty * COALESCE(v_item.amount_brl, 0), 2);
        
        INSERT INTO public.charge_calculations (
          bl_id, charge_table_id, charge_item_id, source, status,
          calculation_key, quantity, unit_value_brl, total_value_brl,
          created_by, calculated_at
        )
        VALUES (
          p_bl_id, v_tbl.table_id, v_item.id, 'auto', 'calculated',
          'auto:item:' || v_item.id::text, v_qty, v_item.amount_brl, v_total_brl,
          v_actor, NOW()
        )
        ON CONFLICT (bl_id, calculation_key) DO UPDATE
          SET quantity = EXCLUDED.quantity,
              unit_value_brl = EXCLUDED.unit_value_brl,
              total_value_brl = EXCLUDED.total_value_brl,
              calculated_at = NOW();

        v_calc_count := v_calc_count + 1;
      END IF;
    END LOOP;
  END LOOP;

  -- 3. Tratar ausencias de tabelas conforme ADR 0069 (pendencias explicitas)
  IF v_table_count = 0 THEN
    v_auto_review := true;
    INSERT INTO public.charge_calculations (
      bl_id, source, status, calculation_key, quantity, total_value_brl,
      review_reason, notes, created_by, calculated_at
    )
    VALUES (
      p_bl_id, 'auto', 'review_required', 'review:no_table', 1, 0,
      'Nenhuma tabela de taxas ativa encontrada para o porto de descarga',
      'Revisao manual obrigatoria', v_actor, NOW()
    )
    ON CONFLICT (bl_id, calculation_key) DO UPDATE
      SET status = EXCLUDED.status, review_reason = EXCLUDED.review_reason, calculated_at = NOW();

  ELSIF v_bl.cargo_mode = 'misto' AND v_table_count = 1 THEN
    v_auto_review := true;
    IF NOT v_has_container_table THEN
      v_review_reason := 'review:missing_charge_table:container';
    ELSE
      v_review_reason := 'review:missing_charge_table:carga_solta';
    END IF;

    INSERT INTO public.charge_calculations (
      bl_id, source, status, calculation_key, quantity, total_value_brl,
      review_reason, notes, created_by, calculated_at
    )
    VALUES (
      p_bl_id, 'auto', 'review_required', v_review_reason, 1, 0,
      'Tabela de taxas parcial em B/L misto: falta tabela complementar',
      'Revisao manual obrigatoria', v_actor, NOW()
    )
    ON CONFLICT (bl_id, calculation_key) DO UPDATE
      SET status = EXCLUDED.status, review_reason = EXCLUDED.review_reason, calculated_at = NOW();
  END IF;

  -- 4. Atualizar charge_status do BL
  IF v_auto_review THEN
    UPDATE public.bls SET charge_status = 'review_required', updated_at = now() WHERE id = p_bl_id;
  ELSE
    UPDATE public.bls SET charge_status = 'calculated', updated_at = now() WHERE id = p_bl_id;
  END IF;

  PERFORM public.sync_local_charge_receivable(p_bl_id);

  RETURN jsonb_build_object(
    'bl_id', p_bl_id,
    'status', CASE WHEN v_auto_review THEN 'review_required' ELSE 'calculated' END,
    'calculations_count', v_calc_count
  );
END;
$$;

-- 4. resolve_bl_local_charge_items alinhado
CREATE OR REPLACE FUNCTION public.resolve_bl_local_charge_items(
  p_bl_id bigint,
  p_pod text,
  p_reference_date date DEFAULT CURRENT_DATE
)
RETURNS TABLE (
  charge_table_id bigint,
  charge_item_id bigint,
  item_name text,
  currency text,
  amount numeric,
  application_basis text,
  calculation_key text,
  quantity numeric,
  total_value numeric
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_bl record;
  v_tbl record;
  v_item record;
  v_qty numeric;
  v_total numeric;
BEGIN
  SELECT * INTO v_bl FROM public.bls WHERE id = p_bl_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  FOR v_tbl IN SELECT t.table_id, t.cargo_mode FROM public.resolve_bl_local_charge_table_ids(p_bl_id, p_reference_date) t LOOP
    FOR v_item IN 
      SELECT * FROM public.charge_items 
      WHERE charge_items.charge_table_id = v_tbl.table_id AND active = true 
    LOOP
      IF v_bl.cargo_mode = 'misto' AND v_tbl.cargo_mode = 'carga_solta' AND v_item.application_basis = 'bl' THEN
        CONTINUE;
      END IF;

      IF v_item.application_basis = 'bl' THEN
        v_qty := 1;
      ELSIF v_item.application_basis = 'container' THEN
        SELECT COUNT(*) INTO v_qty FROM public.bl_containers WHERE bl_id = p_bl_id;
      ELSIF v_item.application_basis IN ('ton', 'weight') THEN
        v_qty := COALESCE(v_bl.bb_weight_ton, 0);
      ELSE
        v_qty := 1;
      END IF;

      v_total := ROUND(v_qty * COALESCE(v_item.amount_brl, 0), 2);

      charge_table_id := v_tbl.table_id;
      charge_item_id := v_item.id;
      item_name := v_item.name;
      currency := COALESCE(v_item.currency, 'BRL');
      amount := v_item.amount_brl;
      application_basis := v_item.application_basis;
      calculation_key := 'auto:item:' || v_item.id::text;
      quantity := v_qty;
      total_value := v_total;
      RETURN NEXT;
    END LOOP;
  END LOOP;
  RETURN;
END;
$$;

-- 5. Atualizar worker _run_import_effect_local_charges para nao filtrar out 'misto'
CREATE OR REPLACE FUNCTION public._run_import_effect_local_charges(
  p_batch_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_bl record;
  v_calc_res jsonb;
  v_count integer := 0;
BEGIN
  FOR v_bl IN 
    SELECT b.id, b.cargo_mode
    FROM public.bls b
    WHERE b.import_batch_id = p_batch_id
      AND COALESCE(b.cargo_mode, 'container') IN ('container', 'carga_solta', 'misto')
  LOOP
    v_calc_res := public.calculate_bl_local_charges(v_bl.id);
    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object('processed_bls', v_count);
END;
$$;
