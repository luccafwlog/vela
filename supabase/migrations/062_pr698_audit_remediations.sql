-- 062: Remediações da Auditoria da PR 698 (PR 702)
--
-- 1. P0: Motor financeiro (resolve_bl_local_charge_items) — elimina o fallback
--    proibido de peso em B/Ls carga solta e mistos. Sem peso solto declarado,
--    a linha vai para status = 'review_required' e não tarifa peso de contêiner.
-- 2. P1: Motor financeiro — supressão anti-bitributação da taxa com base 'bl'
--    na tabela de carga solta somente quando a tabela de contêiner já produziu
--    uma taxa de base 'bl'.
-- 3. P1: Guardas pós-faturamento — _recalculate_bl_cargo_mode e trg_sync_bl_weight_cargo_mode
--    sinalizam billing_hold_reason e pending_review em B/Ls faturados mesmo quando
--    a mutação de carga não altera a modalidade (ex.: misto -> misto, container -> container).
-- 4. P2: Segurança e Auditoria de manifestos_mercante — adiciona trigger de
--    auditoria (audit_row_changes), trigger de updated_at, e restringe DELETE
--    a administradores (is_admin).
-- 5. P3: NOB — clientes sem contatos ativos na caixa documentacao_operacao geram
--    alerta nob_sem_destinatario em vez de desaparecerem silenciosamente da composição.

-- ---------------------------------------------------------------------------
-- 1. P0 e P1: resolve_bl_local_charge_items
-- ---------------------------------------------------------------------------

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
  v_has_bl_basis_item boolean := false;
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
      -- se a tabela de container já forneceu taxa de base 'bl'. Se não forneceu, a taxa
      -- da tabela de carga solta é preservada para evitar perda de receita.
      IF v_bl.cargo_mode = 'misto' AND v_tbl.cargo_mode = 'carga_solta' AND item.application_basis = 'bl' THEN
        IF v_has_bl_basis_item THEN
          CONTINUE;
        END IF;
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
        v_has_bl_basis_item := true;
      ELSIF item.application_basis = 'weight_ton' THEN
        -- P0: Para carga solta e misto, usar estritamente bb_weight_ton.
        -- O peso conteinerizado (total_weight_kg) NÃO substitui o peso solto.
        v_weight_ton := CASE
          WHEN v_bl.cargo_mode IN ('carga_solta', 'misto') THEN v_bl.bb_weight_ton
          ELSE COALESCE(v_bl.bb_weight_ton, CASE WHEN v_bl.total_weight_kg IS NULL THEN NULL ELSE v_bl.total_weight_kg / 1000 END, 0)
        END;
        IF COALESCE(v_weight_ton, 0) <= 0 THEN
          calculation_key := CONCAT('review:weight_missing:', item.id);
          review_reason := 'Peso de carga solta ausente; o peso conteinerizado nao substitui o peso solto';
          status := 'review_required';
          notes := 'Revisao manual obrigatoria';
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

-- ---------------------------------------------------------------------------
-- 2. P1: Guardas pós-faturamento de conteúdo
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._recalculate_bl_cargo_mode(
  p_bl_id text,
  p_transition text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_curr_mode text;
  v_new_mode text;
  v_has_cntr boolean;
  v_has_bb boolean;
  v_financial_status text;
  v_old_rank integer;
  v_new_rank integer;
  v_locked boolean;
  v_locked_addition boolean;
  v_replacement boolean := COALESCE(current_setting('vela.breakbulk_import_replacement', true), 'off') = 'on';
BEGIN
  IF p_bl_id IS NULL THEN
    RETURN;
  END IF;

  SELECT COALESCE(cargo_mode, 'container'), COALESCE(financial_status, 'pending')
    INTO v_curr_mode, v_financial_status
  FROM public.bls
  WHERE id = p_bl_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.bl_containers WHERE bl_id = p_bl_id
  ) INTO v_has_cntr;

  SELECT EXISTS (
    SELECT 1 FROM public.bl_breakbulk_items WHERE bl_id = p_bl_id
  ) OR EXISTS (
    SELECT 1 FROM public.bls
    WHERE id = p_bl_id
      AND (COALESCE(bb_weight_ton, 0) > 0 OR COALESCE(bb_packages_qty, 0) > 0)
  ) INTO v_has_bb;

  v_new_mode := CASE
    WHEN v_has_cntr AND v_has_bb THEN 'misto'
    WHEN v_has_bb THEN 'carga_solta'
    ELSE 'container'
  END;

  v_old_rank := CASE v_curr_mode
    WHEN 'misto' THEN 2
    WHEN 'carga_solta' THEN 1
    ELSE 0
  END;
  v_new_rank := CASE v_new_mode
    WHEN 'misto' THEN 2
    WHEN 'carga_solta' THEN 1
    ELSE 0
  END;
  v_locked := v_financial_status IN ('invoiced', 'paid');

  -- Se a modalidade não mudou, mas o B/L está faturado e houve mutação de itens filhos:
  IF v_curr_mode IS NOT DISTINCT FROM v_new_mode THEN
    IF v_locked AND NOT v_replacement THEN
      IF p_transition = 'delete' THEN
        UPDATE public.bls
        SET charge_status = 'not_calculated',
            review_status = 'pending_review',
            billing_hold_reason = 'Carga removida após faturamento; estorno/refaturamento necessário.',
            updated_at = now()
        WHERE id = p_bl_id;
        IF EXISTS (
          SELECT 1 FROM public.bl_receivables
          WHERE bl_id = p_bl_id AND source = 'local_charges'
        ) THEN
          PERFORM public.sync_local_charge_receivable(p_bl_id);
        END IF;
      ELSIF p_transition = 'insert' THEN
        UPDATE public.bls
        SET charge_status = 'not_calculated',
            review_status = 'pending_review',
            billing_hold_reason = 'Carga adicionada após faturamento; revisar e refaturar.',
            updated_at = now()
        WHERE id = p_bl_id;
        IF EXISTS (
          SELECT 1 FROM public.bl_receivables
          WHERE bl_id = p_bl_id AND source = 'local_charges'
        ) THEN
          PERFORM public.sync_local_charge_receivable(p_bl_id);
        END IF;
      ELSIF p_transition = 'update' THEN
        UPDATE public.bls
        SET charge_status = 'not_calculated',
            review_status = 'pending_review',
            billing_hold_reason = 'Carga alterada após faturamento; estorno/refaturamento necessário.',
            updated_at = now()
        WHERE id = p_bl_id;
        IF EXISTS (
          SELECT 1 FROM public.bl_receivables
          WHERE bl_id = p_bl_id AND source = 'local_charges'
        ) THEN
          PERFORM public.sync_local_charge_receivable(p_bl_id);
        END IF;
      END IF;
    END IF;
    RETURN;
  END IF;

  -- Remover conteúdo de um B/L faturado é uma perda material e precisa de
  -- estorno/refaturamento. Adicionar conteúdo é permitido, mas reabre revisão
  -- e billing hold. O importador usa o GUC transacional abaixo para atravessar
  -- a remoção intermediária da substituição atômica, após o preflight validar
  -- que o resultado final não remove carga BB faturada.
  IF v_locked AND v_old_rank > v_new_rank AND NOT v_replacement THEN
    RAISE EXCEPTION
      'B/L % ja foi faturado (status financeiro=%); remover conteudo exige estorno/refaturamento (transicao=%).',
      p_bl_id, v_financial_status, COALESCE(p_transition, 'recalculo')
      USING ERRCODE = 'P0003';
  END IF;

  v_locked_addition := v_locked AND v_new_rank > v_old_rank;

  UPDATE public.bls
  SET cargo_mode = v_new_mode,
      charge_status = 'not_calculated',
      review_status = CASE WHEN v_locked_addition THEN 'pending_review' ELSE review_status END,
      billing_hold_reason = CASE
        WHEN v_locked_addition THEN 'Carga adicionada após faturamento; revisar e refaturar.'
        ELSE billing_hold_reason
      END,
      updated_at = now()
  WHERE id = p_bl_id;

  IF v_new_mode <> 'container' OR v_has_cntr THEN
    DELETE FROM public.charge_calculations
    WHERE bl_id = p_bl_id
      AND source = 'auto'
      AND calculation_key IN ('review:no_container', 'review:no_containers');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.bl_receivables
    WHERE bl_id = p_bl_id AND source = 'local_charges'
  ) THEN
    PERFORM public.sync_local_charge_receivable(p_bl_id);
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.trg_sync_bl_weight_cargo_mode()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_has_cntr boolean;
  v_has_bb boolean;
  v_new_mode text;
  v_old_mode text := COALESCE(OLD.cargo_mode, 'container');
  v_old_rank integer;
  v_new_rank integer;
  v_financial_status text := COALESCE(OLD.financial_status, 'pending');
  v_replacement boolean := COALESCE(current_setting('vela.breakbulk_import_replacement', true), 'off') = 'on';
  v_weight_decreased boolean := false;
  v_weight_increased boolean := false;
BEGIN
  IF TG_OP = 'UPDATE' AND (
    NEW.id IS DISTINCT FROM OLD.id OR
    NEW.voyage_id IS DISTINCT FROM OLD.voyage_id OR
    NEW.customer_id IS DISTINCT FROM OLD.customer_id
  ) THEN
    NEW.charge_status := 'not_calculated';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.bl_containers WHERE bl_id = NEW.id
  ) INTO v_has_cntr;

  v_has_bb := (
    COALESCE(NEW.bb_weight_ton, 0) > 0 OR
    COALESCE(NEW.bb_packages_qty, 0) > 0 OR
    EXISTS (SELECT 1 FROM public.bl_breakbulk_items WHERE bl_id = NEW.id)
  );

  IF TG_OP = 'INSERT' AND NOT v_has_cntr AND NOT v_has_bb THEN
    NEW.cargo_mode := COALESCE(NULLIF(btrim(NEW.cargo_mode), ''), 'container');
    NEW.charge_status := COALESCE(NEW.charge_status, 'not_calculated');
    RETURN NEW;
  END IF;

  v_new_mode := CASE
    WHEN v_has_cntr AND v_has_bb THEN 'misto'
    WHEN v_has_bb THEN 'carga_solta'
    ELSE 'container'
  END;
  v_old_rank := CASE v_old_mode WHEN 'misto' THEN 2 WHEN 'carga_solta' THEN 1 ELSE 0 END;
  v_new_rank := CASE v_new_mode WHEN 'misto' THEN 2 WHEN 'carga_solta' THEN 1 ELSE 0 END;

  IF TG_OP = 'UPDATE'
     AND v_financial_status IN ('invoiced', 'paid')
     AND v_old_rank > v_new_rank
     AND NOT v_replacement THEN
    RAISE EXCEPTION
      'B/L % ja foi faturado (status financeiro=%); remover conteudo exige estorno/refaturamento.',
      NEW.id, v_financial_status
      USING ERRCODE = 'P0003';
  END IF;

  IF TG_OP = 'UPDATE' AND v_financial_status IN ('invoiced', 'paid')
     AND COALESCE(NEW.financial_status, 'pending') = 'pending' THEN
    NEW.financial_status := OLD.financial_status;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.cargo_mode IS DISTINCT FROM v_new_mode THEN
    NEW.charge_status := 'not_calculated';
  ELSE
    NEW.charge_status := COALESCE(NEW.charge_status, 'not_calculated');
  END IF;

  IF TG_OP = 'UPDATE' AND v_financial_status IN ('invoiced', 'paid') THEN
    IF v_new_rank > v_old_rank THEN
      NEW.review_status := 'pending_review';
      NEW.billing_hold_reason := 'Carga adicionada após faturamento; revisar e refaturar.';
    ELSIF (OLD.bb_weight_ton IS DISTINCT FROM NEW.bb_weight_ton)
       OR (OLD.total_weight_kg IS DISTINCT FROM NEW.total_weight_kg)
       OR (OLD.bb_packages_qty IS DISTINCT FROM NEW.bb_packages_qty) THEN
      v_weight_decreased := (
        COALESCE(NEW.bb_weight_ton, 0) < COALESCE(OLD.bb_weight_ton, 0) OR
        COALESCE(NEW.total_weight_kg, 0) < COALESCE(OLD.total_weight_kg, 0) OR
        COALESCE(NEW.bb_packages_qty, 0) < COALESCE(OLD.bb_packages_qty, 0)
      );
      v_weight_increased := (
        COALESCE(NEW.bb_weight_ton, 0) > COALESCE(OLD.bb_weight_ton, 0) OR
        COALESCE(NEW.total_weight_kg, 0) > COALESCE(OLD.total_weight_kg, 0) OR
        COALESCE(NEW.bb_packages_qty, 0) > COALESCE(OLD.bb_packages_qty, 0)
      );
      IF v_weight_decreased THEN
        NEW.review_status := 'pending_review';
        NEW.billing_hold_reason := 'Carga reduzida após faturamento; estorno/refaturamento necessário.';
        NEW.charge_status := 'not_calculated';
      ELSIF v_weight_increased THEN
        NEW.review_status := 'pending_review';
        NEW.billing_hold_reason := 'Carga adicionada após faturamento; revisar e refaturar.';
        NEW.charge_status := 'not_calculated';
      END IF;
    END IF;
  END IF;

  NEW.cargo_mode := v_new_mode;
  RETURN NEW;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 3. P2: Trilha de auditoria e RLS de manifestos_mercante
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS manifestos_mercante_write_policy ON public.manifestos_mercante;
DROP POLICY IF EXISTS manifestos_mercante_insert_policy ON public.manifestos_mercante;
DROP POLICY IF EXISTS manifestos_mercante_update_policy ON public.manifestos_mercante;
DROP POLICY IF EXISTS manifestos_mercante_delete_policy ON public.manifestos_mercante;

CREATE POLICY manifestos_mercante_insert_policy ON public.manifestos_mercante
  FOR INSERT TO authenticated WITH CHECK (public.is_active_user());

CREATE POLICY manifestos_mercante_update_policy ON public.manifestos_mercante
  FOR UPDATE TO authenticated USING (public.is_active_user()) WITH CHECK (public.is_active_user());

CREATE POLICY manifestos_mercante_delete_policy ON public.manifestos_mercante
  FOR DELETE TO authenticated USING (public.is_admin());

DROP TRIGGER IF EXISTS audit_manifestos_mercante ON public.manifestos_mercante;
CREATE TRIGGER audit_manifestos_mercante
  AFTER DELETE OR UPDATE ON public.manifestos_mercante
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_changes('id');

CREATE OR REPLACE FUNCTION public.trg_manifestos_mercante_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_manifestos_mercante_updated_at ON public.manifestos_mercante;
CREATE TRIGGER trg_manifestos_mercante_updated_at
  BEFORE UPDATE ON public.manifestos_mercante
  FOR EACH ROW EXECUTE FUNCTION public.trg_manifestos_mercante_updated_at();

-- ---------------------------------------------------------------------------
-- 4. P3: NOB — clientes sem contato geram alerta nob_sem_destinatario
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.evaluate_and_dispatch_automatic_communications(
  p_as_of timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_schedule record;
  v_customer_bl record;
  v_candidates jsonb := '[]'::jsonb;
  v_as_of timestamptz := coalesce(p_as_of, now());
  v_kind text;
  v_milestone timestamptz;
  v_key text;
  v_voyage_id bigint;
  v_vessel_name text;
  v_voyage_number text;
  v_port text;
  v_atracacao record;
  v_nob_suppressed boolean;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Executor server-only.' USING ERRCODE = '42501';
  END IF;

  -- NOA/NOR: somente D-5 até antes do ETA; NOR a partir do ATA no dia do marco.
  FOR v_schedule IN
    WITH entities AS (
      SELECT DISTINCT entity_id
      FROM public.audit_logs
      WHERE entity_type = 'voyage_pod_schedule'
        AND entity_id ~ '^[0-9]+::[^:]+$'
    ), latest AS (
      SELECT e.entity_id,
        public.customer_communication_safe_timestamptz((SELECT a.new_value FROM public.audit_logs a WHERE a.entity_type = 'voyage_pod_schedule' AND a.entity_id = e.entity_id AND a.field_name = 'eta' ORDER BY a.changed_at DESC, a.id DESC LIMIT 1)) AS eta,
        public.customer_communication_safe_timestamptz((SELECT a.new_value FROM public.audit_logs a WHERE a.entity_type = 'voyage_pod_schedule' AND a.entity_id = e.entity_id AND a.field_name = 'ata' ORDER BY a.changed_at DESC, a.id DESC LIMIT 1)) AS ata,
        COALESCE((SELECT lower(a.new_value) = 'true' FROM public.audit_logs a WHERE a.entity_type = 'voyage_pod_schedule' AND a.entity_id = e.entity_id AND a.field_name = 'deleted' ORDER BY a.changed_at DESC, a.id DESC LIMIT 1), false) AS deleted,
        COALESCE((SELECT lower(a.new_value) = 'true' FROM public.audit_logs a WHERE a.entity_type = 'voyage_pod_schedule' AND a.entity_id = e.entity_id AND a.field_name = 'omitted' ORDER BY a.changed_at DESC, a.id DESC LIMIT 1), false) AS omitted
      FROM entities e
    )
    SELECT
      split_part(l.entity_id, '::', 1)::bigint AS voyage_id,
      split_part(l.entity_id, '::', 2) AS port,
      l.eta, l.ata, v.voyage_number, vs.name AS vessel_name
    FROM latest l
    JOIN public.voyages v ON v.id = split_part(l.entity_id, '::', 1)::bigint
    LEFT JOIN public.vessels vs ON vs.id = v.vessel_id
    WHERE NOT l.deleted AND NOT l.omitted
      AND ((l.ata IS NULL AND l.eta IS NOT NULL
            AND v_as_of >= l.eta - interval '5 days' AND v_as_of < l.eta)
        OR (l.ata IS NOT NULL AND l.ata BETWEEN v_as_of - interval '30 days' AND v_as_of))
  LOOP
    v_voyage_id := v_schedule.voyage_id;
    v_vessel_name := v_schedule.vessel_name;
    v_voyage_number := v_schedule.voyage_number;
    v_port := v_schedule.port;
    v_kind := CASE WHEN v_schedule.ata IS NOT NULL THEN 'aviso_prontidao_nor' ELSE 'aviso_chegada_noa' END;
    v_milestone := CASE WHEN v_kind = 'aviso_prontidao_nor' THEN v_schedule.ata ELSE v_schedule.eta END;

    FOR v_customer_bl IN
      SELECT b.customer_id,
        array_agg(DISTINCT b.id ORDER BY b.id) AS bl_ids,
        c.name AS customer_name,
        c.cnpj_cpf,
        array_agg(DISTINCT NULLIF(btrim(cc.email), '') ORDER BY NULLIF(btrim(cc.email), ''))
          FILTER (WHERE NULLIF(btrim(cc.email), '') IS NOT NULL
            AND NULLIF(btrim(cc.email), '') ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') AS emails
      FROM public.bls b
      JOIN public.customers c ON c.id = b.customer_id
      JOIN public.customer_contacts cc ON cc.customer_id = b.customer_id
      JOIN public.customer_contact_box_links ccb ON ccb.contact_id = cc.id
      WHERE b.voyage_id = v_schedule.voyage_id
        AND public.normalize_port_code(b.pod) = public.normalize_port_code(v_schedule.port)
        AND b.customer_id IS NOT NULL
        AND COALESCE(b.financial_status, 'pending') <> 'cancelled'
        AND cc.deactivated_at IS NULL
        AND ccb.box_code = 'documentacao_operacao'
        AND NULLIF(btrim(cc.email), '') IS NOT NULL
        AND NULLIF(btrim(cc.email), '') ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
        AND NOT EXISTS (
          SELECT 1 FROM public.customer_contact_preferences cp
          WHERE cp.contact_id = cc.id AND cp.nature = 'avisos_operacionais' AND cp.enabled = false
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.portal_suppressed_emails pse
          WHERE lower(btrim(pse.email)) = lower(btrim(cc.email)) AND pse.reason = 'bounce_permanente'
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.customer_communication_suppressions ccs
          WHERE lower(btrim(ccs.email)) = lower(btrim(cc.email))
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.customer_communications sent
          WHERE sent.customer_id = b.customer_id
            AND sent.kind = v_kind
            AND sent.nature = 'avisos_operacionais'
            AND sent.status IN ('enviado', 'simulado')
            AND sent.anchor_voyage_id = v_schedule.voyage_id
            AND public.normalize_port_code(sent.anchor_port) = public.normalize_port_code(v_schedule.port)
        )
      GROUP BY b.customer_id, c.name, c.cnpj_cpf
    LOOP
      v_key := v_kind || ':' || v_customer_bl.customer_id || ':' || v_schedule.voyage_id || ':' || public.normalize_port_code(v_schedule.port);
      INSERT INTO public.customer_communication_automation_claims (claim_key)
      VALUES (v_key)
      ON CONFLICT (claim_key) DO UPDATE
        SET claimed_at = now(), released_at = NULL
        WHERE customer_communication_automation_claims.released_at IS NOT NULL
           OR customer_communication_automation_claims.claimed_at < v_as_of - interval '30 minutes';
      IF FOUND THEN
        v_candidates := v_candidates || jsonb_build_array(jsonb_build_object(
          'claim_key', v_key, 'kind', v_kind, 'nature', 'avisos_operacionais',
          'customer_id', v_customer_bl.customer_id, 'customer_name', v_customer_bl.customer_name,
          'customer_cnpj', v_customer_bl.cnpj_cpf, 'voyage_id', v_schedule.voyage_id,
          'vessel_name', v_schedule.vessel_name, 'voyage_number', v_schedule.voyage_number,
          'port', v_schedule.port, 'milestone_at', v_milestone,
          'bl_ids', to_jsonb(v_customer_bl.bl_ids), 'emails', to_jsonb(v_customer_bl.emails)
        ));
      END IF;
    END LOOP;
  END LOOP;

  -- CE Mercante: produtor server-side durável, independente da tela de B/L.
  FOR v_customer_bl IN
    SELECT b.voyage_id, b.customer_id, c.name AS customer_name, c.cnpj_cpf,
      v.voyage_number, vs.name AS vessel_name, min(b.pod) AS port,
      v.eta AS milestone_at, array_agg(DISTINCT b.id ORDER BY b.id) AS bl_ids,
      array_agg(DISTINCT NULLIF(btrim(cc.email), '') ORDER BY NULLIF(btrim(cc.email), '')) AS emails
    FROM public.bls b
    JOIN public.customers c ON c.id = b.customer_id
    JOIN public.voyages v ON v.id = b.voyage_id
    LEFT JOIN public.vessels vs ON vs.id = v.vessel_id
    JOIN public.customer_contacts cc ON cc.customer_id = b.customer_id
    JOIN public.customer_contact_box_links ccb ON ccb.contact_id = cc.id
    WHERE b.customer_id IS NOT NULL
      AND COALESCE(b.financial_status, 'pending') <> 'cancelled'
      AND cc.deactivated_at IS NULL
      AND ccb.box_code IN ('documentacao_operacao', 'financeiro')
      AND NULLIF(btrim(cc.email), '') IS NOT NULL
      AND NULLIF(btrim(cc.email), '') ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
      AND NOT EXISTS (SELECT 1 FROM public.customer_contact_preferences cp WHERE cp.contact_id = cc.id AND cp.nature = 'documentacao' AND cp.enabled = false)
      AND NOT EXISTS (SELECT 1 FROM public.portal_suppressed_emails pse WHERE lower(btrim(pse.email)) = lower(btrim(cc.email)) AND pse.reason = 'bounce_permanente')
      AND NOT EXISTS (SELECT 1 FROM public.customer_communication_suppressions ccs WHERE lower(btrim(ccs.email)) = lower(btrim(cc.email)))
      AND (public.customer_local_charges_communication_readiness(b.voyage_id, b.customer_id)->>'ready')::boolean
      AND NOT EXISTS (
        SELECT 1 FROM public.customer_communications sent
        WHERE sent.customer_id = b.customer_id AND sent.kind = 'ce_mercante_taxas'
          AND sent.nature = 'documentacao' AND sent.status IN ('enviado', 'simulado')
          AND sent.anchor_voyage_id = b.voyage_id AND sent.attempt_discriminator = 0
      )
    GROUP BY b.voyage_id, b.customer_id, c.name, c.cnpj_cpf, v.voyage_number, vs.name, v.eta
  LOOP
    v_key := 'ce_mercante_taxas:' || v_customer_bl.customer_id || ':' || v_customer_bl.voyage_id;
    INSERT INTO public.customer_communication_automation_claims (claim_key)
      VALUES (v_key)
      ON CONFLICT (claim_key) DO UPDATE
        SET claimed_at = now(), released_at = NULL
        WHERE customer_communication_automation_claims.released_at IS NOT NULL
           OR customer_communication_automation_claims.claimed_at < v_as_of - interval '30 minutes';
    IF FOUND THEN
      v_candidates := v_candidates || jsonb_build_array(jsonb_build_object(
        'claim_key', v_key, 'kind', 'ce_mercante_taxas', 'nature', 'documentacao',
        'customer_id', v_customer_bl.customer_id, 'customer_name', v_customer_bl.customer_name,
        'customer_cnpj', v_customer_bl.cnpj_cpf, 'voyage_id', v_customer_bl.voyage_id,
        'vessel_name', v_customer_bl.vessel_name, 'voyage_number', v_customer_bl.voyage_number,
        'port', COALESCE(v_customer_bl.port, '—'), 'milestone_at', v_customer_bl.milestone_at,
        'bl_ids', to_jsonb(v_customer_bl.bl_ids), 'emails', to_jsonb(v_customer_bl.emails)
      ));
    END IF;
  END LOOP;

  -- NOB: o agrupamento já contém todos os B/Ls elegíveis do cliente para a
  -- atracação. A claim só é criada depois da composição, evitando que um B/L
  -- puro consuma a claim antes que o B/L misto entre no mesmo envio.
  -- P3: clientes sem contatos válidos disparam alerta nob_sem_destinatario.
  FOR v_atracacao IN
    SELECT ts.id AS state_id, ts.voyage_id, upper(btrim(ts.port)) AS port,
      ts.terminal_id, ts.terminal_atb,
      public.voyage_terminal_code(ts.terminal_id) AS terminal_code,
      v.voyage_number, vs.name AS vessel_name
    FROM public.voyage_escala_terminal_state ts
    JOIN public.voyages v ON v.id = ts.voyage_id
    LEFT JOIN public.vessels vs ON vs.id = v.vessel_id
    WHERE ts.terminal_id IS NOT NULL
      AND ts.terminal_atb IS NOT NULL
      AND ts.terminal_atb <= v_as_of
      AND ts.terminal_atb >= v_as_of - interval '30 days'
      AND public.voyage_terminal_code(ts.terminal_id) IS NOT NULL
  LOOP
    SELECT COALESCE((
      SELECT lower(btrim(a.new_value)) = 'true'
      FROM public.audit_logs a
      WHERE a.entity_type = 'voyage_pod_schedule'
        AND a.entity_id = v_atracacao.voyage_id || '::' || v_atracacao.port
        AND a.field_name = 'deleted'
      ORDER BY a.changed_at DESC, a.id DESC LIMIT 1
    ), false) INTO v_nob_suppressed;
    v_nob_suppressed := v_nob_suppressed OR COALESCE((
      SELECT lower(btrim(a.new_value)) = 'true'
      FROM public.audit_logs a
      WHERE a.entity_type = 'voyage_pod_schedule'
        AND a.entity_id = v_atracacao.voyage_id || '::' || v_atracacao.port
        AND a.field_name = 'omitted'
      ORDER BY a.changed_at DESC, a.id DESC LIMIT 1
    ), false);
    CONTINUE WHEN v_nob_suppressed;

    FOR v_customer_bl IN
      SELECT b.customer_id,
        array_agg(DISTINCT b.id ORDER BY b.id) AS bl_ids,
        c.name AS customer_name,
        c.cnpj_cpf,
        array_agg(DISTINCT NULLIF(btrim(cc.email), '') ORDER BY NULLIF(btrim(cc.email), ''))
          FILTER (WHERE NULLIF(btrim(cc.email), '') IS NOT NULL
            AND NULLIF(btrim(cc.email), '') ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') AS emails
      FROM public.bls b
      JOIN public.customers c ON c.id = b.customer_id
      LEFT JOIN (
        public.customer_contacts cc
        JOIN public.customer_contact_box_links ccb
          ON ccb.contact_id = cc.id
         AND ccb.box_code = 'documentacao_operacao'
      ) ON cc.customer_id = b.customer_id
       AND cc.deactivated_at IS NULL
       AND NULLIF(btrim(cc.email), '') IS NOT NULL
       AND NULLIF(btrim(cc.email), '') ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
       AND NOT EXISTS (
         SELECT 1 FROM public.customer_contact_preferences cp
         WHERE cp.contact_id = cc.id AND cp.nature = 'avisos_operacionais' AND cp.enabled = false
       )
       AND NOT EXISTS (
         SELECT 1 FROM public.portal_suppressed_emails pse
         WHERE lower(btrim(pse.email)) = lower(btrim(cc.email)) AND pse.reason = 'bounce_permanente'
       )
       AND NOT EXISTS (
         SELECT 1 FROM public.customer_communication_suppressions ccs
         WHERE lower(btrim(ccs.email)) = lower(btrim(cc.email))
       )
      WHERE b.voyage_id = v_atracacao.voyage_id
        AND public.normalize_port_code(b.pod) = public.normalize_port_code(v_atracacao.port)
        AND b.customer_id IS NOT NULL
        AND COALESCE(b.financial_status, 'pending') <> 'cancelled'
        AND public.resolve_bl_terminal_id(b.id) = v_atracacao.terminal_id
        AND (
          -- A exceção auditada já identifica o terminal escolhido. Ela não
          -- pode ser invalidada pela ausência de uma frente nesse terminal;
          -- sem exceção, a frente continua obrigatória.
          b.terminal_id IS NOT NULL
          OR (
            b.cargo_mode = 'misto'
            AND EXISTS (
              SELECT 1 FROM public.voyage_escala_operation_fronts f
              WHERE f.voyage_id = b.voyage_id
                AND public.normalize_port_code(f.port) = public.normalize_port_code(v_atracacao.port)
                AND f.terminal_id = v_atracacao.terminal_id
                AND f.sentido = 'importacao' AND f.modalidade = 'carga_cheia'
            )
            AND EXISTS (
              SELECT 1 FROM public.voyage_escala_operation_fronts f
              WHERE f.voyage_id = b.voyage_id
                AND public.normalize_port_code(f.port) = public.normalize_port_code(v_atracacao.port)
                AND f.terminal_id = v_atracacao.terminal_id
                AND f.sentido = 'importacao' AND f.modalidade = 'carga_solta'
            )
          )
          OR (
            b.cargo_mode <> 'misto'
            AND EXISTS (
              SELECT 1 FROM public.voyage_escala_operation_fronts f
              WHERE f.voyage_id = b.voyage_id
                AND public.normalize_port_code(f.port) = public.normalize_port_code(v_atracacao.port)
                AND f.terminal_id = v_atracacao.terminal_id
                AND f.sentido = 'importacao'
                AND f.modalidade = public.bl_operation_front_modalidade(b.cargo_mode)
            )
          )
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.customer_communications sent
          WHERE sent.customer_id = b.customer_id
            AND sent.kind = 'aviso_atracacao_nob'
            AND sent.nature = 'avisos_operacionais'
            AND sent.status IN ('enviado', 'simulado')
            AND sent.anchor_atracacao_id = v_atracacao.state_id
        )
      GROUP BY b.customer_id, c.name, c.cnpj_cpf
    LOOP
      IF COALESCE(cardinality(v_customer_bl.emails), 0) = 0 THEN
        PERFORM public.upsert_alert_item(
          'nob_sem_destinatario',
          'customer',
          v_customer_bl.customer_id::text,
          'Cliente ' || v_customer_bl.customer_name || ': possui carga na atracação mas sem contato ativo na caixa documentacao_operacao para envio do NOB.',
          'nob_automacao',
          jsonb_build_object('customer_id', v_customer_bl.customer_id, 'bl_ids', v_customer_bl.bl_ids, 'atracacao_id', v_atracacao.state_id),
          '/clientes'
        );
        CONTINUE;
      ELSE
        PERFORM public.resolve_alert_item('nob_sem_destinatario', 'customer', v_customer_bl.customer_id::text, 'nob_automacao', '{}'::jsonb);
      END IF;

      v_key := 'aviso_atracacao_nob:' || v_customer_bl.customer_id || ':' || v_atracacao.state_id;
      INSERT INTO public.customer_communication_automation_claims (claim_key)
      VALUES (v_key)
      ON CONFLICT (claim_key) DO UPDATE
        SET claimed_at = now(), released_at = NULL
        WHERE customer_communication_automation_claims.released_at IS NOT NULL
           OR customer_communication_automation_claims.claimed_at < v_as_of - interval '30 minutes';
      IF FOUND THEN
        v_candidates := v_candidates || jsonb_build_array(jsonb_build_object(
          'claim_key', v_key,
          'kind', 'aviso_atracacao_nob',
          'nature', 'avisos_operacionais',
          'customer_id', v_customer_bl.customer_id,
          'customer_name', v_customer_bl.customer_name,
          'customer_cnpj', v_customer_bl.cnpj_cpf,
          'voyage_id', v_atracacao.voyage_id,
          'vessel_name', v_atracacao.vessel_name,
          'voyage_number', v_atracacao.voyage_number,
          'port', v_atracacao.port,
          'milestone_at', v_atracacao.terminal_atb,
          'anchor_atracacao_id', v_atracacao.state_id,
          'terminal_id', v_atracacao.terminal_id,
          'terminal_name', v_atracacao.terminal_code,
          'bl_ids', to_jsonb(v_customer_bl.bl_ids),
          'emails', to_jsonb(v_customer_bl.emails)
        ));
      END IF;
    END LOOP;
  END LOOP;

  RETURN v_candidates;
END;
$function$;

REVOKE ALL ON FUNCTION public.evaluate_and_dispatch_automatic_communications(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.evaluate_and_dispatch_automatic_communications(timestamptz) TO service_role;
