-- Migration 091: tarifa usada só se desativa; override ganha Desativar;
-- desativar e reativar tarifas é do Administrativo (ADR 0073, itens 1-4;
-- plano docs/plans/2026-09-24-politica-de-exclusao.md, Fase 5a).
--
-- - customer_rate_overrides ganha active (padrão true). O cálculo
--   (resolve_bl_local_charge_items, add_manual_bl_charge,
--   list_manual_charge_items_for_bl) passa a ignorar override desativado. O
--   item de taxa já tinha active e já era respeitado.
-- - Override desativado sai da restrição de sobreposição de vigência.
-- - O rateio de container entre B/Ls ignora B/L cancelado (ADR 0071, item 9:
--   ele sai do faturamento).
-- - Excluir tarifa usada é recusado, com mensagem legível, por um trigger por
--   tabela. Usada = referenciada por cálculo, item de fatura ou versão de
--   regra de preço (tabela, item, override) ou por cobrança de Granito (tarifa
--   de Granito). Antes, excluir item zerava a referência nas faturas e
--   excluir tarifa de Granito zerava a das cobranças (SET NULL).
-- - ponytail: tarifa e acordo de Demurrage não guardam vínculo com o cálculo
--   (os valores entram por cópia no snapshot). Contam como usados quando já
--   entraram em vigor (valid_from nulo ou até hoje). Conservador: pode recusar
--   a exclusão de uma tarifa vigente que nenhum cálculo usou. Upgrade:
--   gravar o id da tarifa no snapshot de Demurrage.
-- - Mudar active em tabela, item, override, tarifa de Demurrage, acordo e
--   tarifa de Granito exige o Administrativo (trigger). Editar os demais campos
--   continua com quem já editava.
--
-- Adiciona coluna com padrão; não reescreve nem apaga linhas existentes.

ALTER TABLE public.customer_rate_overrides
  ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;

-- Override desativado não disputa período: um novo override do mesmo cliente
-- e item pode cobrir a vigência do desativado (que, usado, não se exclui).
ALTER TABLE public.customer_rate_overrides DROP CONSTRAINT IF EXISTS customer_rate_overrides_no_overlap;
ALTER TABLE public.customer_rate_overrides ADD CONSTRAINT customer_rate_overrides_no_overlap
  EXCLUDE USING gist (customer_id WITH =, charge_item_id WITH =, daterange(valid_from, valid_to, '[]') WITH &&)
  WHERE (active);

CREATE OR REPLACE FUNCTION public.resolve_bl_local_charge_items(p_bl_id text, p_pod text)
 RETURNS TABLE(charge_table_id bigint, charge_item_id bigint, quantity numeric, unit_value_brl numeric, unit_value_usd numeric, total_value_brl numeric, total_value_usd numeric, override_applied boolean, source text, status text, calculation_key text, review_reason text, notes text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
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
          AND b2.cancelled_at IS NULL
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
        WHERE cro.active
          AND cro.customer_id = v_bl.customer_id
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

CREATE OR REPLACE FUNCTION public.add_manual_bl_charge(p_bl_id text, p_charge_item_id bigint, p_quantity numeric DEFAULT 1, p_notes text DEFAULT NULL::text, p_actor uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bl record;
  v_item record;
  v_actor uuid;
  v_qty numeric(12,6);
  v_unit_brl numeric(12,2);
  v_unit_usd numeric(12,2);
  v_total_brl numeric(14,2);
  v_total_usd numeric(14,2);
  v_key text;
  v_calc_id bigint;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa' USING ERRCODE = '42501';
  END IF;
  v_actor := COALESCE(p_actor, auth.uid());

  SELECT b.id, b.customer_id, COALESCE(b.cargo_mode, 'container') AS cargo_mode,
    b.pod, b.charge_status, b.financial_status,
    COALESCE(ib.uploaded_at::date, b.created_at::date, CURRENT_DATE) AS reference_date
  INTO v_bl
  FROM public.bls AS b
  LEFT JOIN public.import_batches AS ib ON ib.id = b.batch_id
  WHERE b.id = upper(btrim(p_bl_id));
  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L % nao encontrado', p_bl_id USING ERRCODE = 'P0002';
  END IF;

  IF COALESCE(v_bl.financial_status, 'open') IN ('invoiced', 'partially_paid', 'paid') THEN
    RAISE EXCEPTION 'B/L % ja foi faturado (status financeiro=%); nao e permitido lancar taxa manual.',
      p_bl_id, v_bl.financial_status USING ERRCODE = '22023';
  END IF;

  SELECT cti.id, cti.name, COALESCE(cti.currency, 'BRL') AS currency,
    cti.unit_value_brl, cti.unit_value_usd, cti.value_brl,
    ct.id AS charge_table_id, ct.name AS charge_table_name, ct.cargo_mode, ct.pod,
    cro.override_value
  INTO v_item
  FROM public.charge_table_items AS cti
  JOIN public.charge_tables AS ct ON ct.id = cti.charge_table_id
    AND ct.active = true
    AND ct.id IN (
      SELECT resolved.table_id
      FROM public.resolve_bl_local_charge_table_ids(v_bl.id, v_bl.reference_date) AS resolved
    )
    AND (
      public.normalize_port_code(ct.pod) = public.normalize_port_code(v_bl.pod)
      OR upper(trim(coalesce(ct.pod, ''))) = 'ANY'
    )
    AND ct.valid_from <= v_bl.reference_date
    AND (ct.valid_to IS NULL OR ct.valid_to >= v_bl.reference_date)
  LEFT JOIN LATERAL (
    SELECT cro.override_value
    FROM public.customer_rate_overrides AS cro
    WHERE cro.active
          AND cro.customer_id = v_bl.customer_id
      AND cro.charge_item_id = cti.id
      AND (cro.valid_from IS NULL OR cro.valid_from <= v_bl.reference_date)
      AND (cro.valid_to IS NULL OR cro.valid_to >= v_bl.reference_date)
    ORDER BY cro.created_at DESC
    LIMIT 1
  ) AS cro ON true
  WHERE cti.id = p_charge_item_id
    AND COALESCE(cti.active, true) = true
    AND COALESCE(cti.manual_only, false) = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item manual % nao elegivel para este B/L', p_charge_item_id USING ERRCODE = '22023';
  END IF;

  v_qty := COALESCE(p_quantity, 1);
  IF v_qty <= 0 THEN
    RAISE EXCEPTION 'Quantidade deve ser maior que zero' USING ERRCODE = '22023';
  END IF;
  IF v_item.currency = 'USD' THEN
    v_unit_brl := NULL;
    v_unit_usd := COALESCE(v_item.override_value, v_item.unit_value_usd, 0);
    v_total_brl := NULL;
    v_total_usd := round(v_qty * COALESCE(v_unit_usd, 0), 2);
  ELSE
    v_unit_brl := COALESCE(v_item.override_value, v_item.unit_value_brl, v_item.value_brl, 0);
    v_unit_usd := NULL;
    v_total_brl := round(v_qty * COALESCE(v_unit_brl, 0), 2);
    v_total_usd := NULL;
  END IF;

  v_key := concat('manual:item:', p_charge_item_id, ':',
    extract(epoch FROM clock_timestamp())::bigint, ':', floor(random() * 100000)::int);

  INSERT INTO public.charge_calculations (
    bl_id, charge_table_id, charge_item_id, quantity, unit_value_brl, unit_value_usd,
    total_value_brl, total_value_usd, override_applied, source, status,
    calculation_key, notes, manual_reason, created_by, calculated_at
  ) VALUES (
    v_bl.id, v_item.charge_table_id, p_charge_item_id, v_qty, v_unit_brl, v_unit_usd,
    v_total_brl, v_total_usd, v_item.override_value IS NOT NULL, 'manual', 'reviewed',
    v_key, NULLIF(trim(coalesce(p_notes, '')), ''), 'other_charge_manual', v_actor, now()
  ) RETURNING id INTO v_calc_id;

  UPDATE public.bls
  SET charge_status = CASE WHEN charge_status IN ('not_calculated', 'exempt') THEN 'reviewed' ELSE charge_status END,
      charges_calculated_at = COALESCE(charges_calculated_at, now()),
      charges_reviewed_at = CASE WHEN charge_status IN ('not_calculated', 'exempt') THEN now() ELSE charges_reviewed_at END
  WHERE id = v_bl.id;

  INSERT INTO public.audit_logs (
    entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification
  ) VALUES (
    'charge_calculation', v_calc_id::text, 'manual_insert', NULL,
    concat(v_item.name, ' | qty=', v_qty, ' | total=', coalesce(v_total_brl::text, v_total_usd::text)),
    auth.uid(), now(), coalesce(nullif(trim(coalesce(p_notes, '')), ''), 'Lancamento manual de other charge')
  );

  RETURN jsonb_build_object(
    'id', v_calc_id, 'bl_id', v_bl.id, 'status', 'reviewed', 'currency', v_item.currency,
    'quantity', v_qty, 'unit_value_brl', v_unit_brl, 'unit_value_usd', v_unit_usd,
    'total_value_brl', v_total_brl, 'total_value_usd', v_total_usd
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.list_manual_charge_items_for_bl(p_bl_id text)
 RETURNS TABLE(charge_item_id bigint, charge_item_name text, charge_table_id bigint, charge_table_name text, cargo_mode text, pod text, currency text, default_unit_value_brl numeric, default_unit_value_usd numeric, effective_unit_value_brl numeric, effective_unit_value_usd numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_read_user() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH bl_ctx AS (
    SELECT b.id, b.customer_id, b.pod,
      COALESCE(ib.uploaded_at::date, b.created_at::date, CURRENT_DATE) AS reference_date
    FROM public.bls AS b
    LEFT JOIN public.import_batches AS ib ON ib.id = b.batch_id
    WHERE b.id = upper(btrim(p_bl_id))
  )
  SELECT cti.id, cti.name, ct.id, ct.name, ct.cargo_mode, ct.pod,
    COALESCE(cti.currency, 'BRL'), cti.unit_value_brl, cti.unit_value_usd,
    CASE WHEN COALESCE(cti.currency, 'BRL') = 'USD' THEN NULL
         ELSE COALESCE(cro.override_value, cti.unit_value_brl, cti.value_brl, 0) END,
    CASE WHEN COALESCE(cti.currency, 'BRL') = 'USD'
         THEN COALESCE(cro.override_value, cti.unit_value_usd, 0) ELSE NULL END
  FROM bl_ctx
  JOIN public.charge_tables AS ct ON ct.active = true
    AND ct.id IN (
      SELECT resolved.table_id
      FROM public.resolve_bl_local_charge_table_ids(bl_ctx.id, bl_ctx.reference_date) AS resolved
    )
    AND (
      public.normalize_port_code(ct.pod) = public.normalize_port_code(bl_ctx.pod)
      OR upper(trim(coalesce(ct.pod, ''))) = 'ANY'
    )
    AND ct.valid_from <= bl_ctx.reference_date
    AND (ct.valid_to IS NULL OR ct.valid_to >= bl_ctx.reference_date)
  JOIN public.charge_table_items AS cti ON cti.charge_table_id = ct.id
    AND COALESCE(cti.active, true) = true
    AND COALESCE(cti.manual_only, false) = true
  LEFT JOIN LATERAL (
    SELECT cro.override_value
    FROM public.customer_rate_overrides AS cro
    WHERE cro.active
          AND cro.customer_id = bl_ctx.customer_id
      AND cro.charge_item_id = cti.id
      AND (cro.valid_from IS NULL OR cro.valid_from <= bl_ctx.reference_date)
      AND (cro.valid_to IS NULL OR cro.valid_to >= bl_ctx.reference_date)
    ORDER BY cro.created_at DESC
    LIMIT 1
  ) AS cro ON true
  ORDER BY ct.valid_from DESC, ct.id DESC, COALESCE(cti.sort_order, 100), cti.id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.guard_used_tariff_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_used boolean := false;
BEGIN
  -- O seed de catálogo (supabase/seed.sql) substitui as tarifas de um banco
  -- novo: ele liga vela.seed_catalog na própria sessão, sem usuário. A API não
  -- consegue ligar essa marca.
  IF auth.uid() IS NULL AND current_setting('vela.seed_catalog', true) = 'on' THEN
    RETURN OLD;
  END IF;

  IF TG_TABLE_NAME = 'charge_table_items' THEN
    v_used := EXISTS (SELECT 1 FROM public.charge_calculations WHERE charge_item_id = OLD.id)
      OR EXISTS (SELECT 1 FROM public.invoice_items WHERE charge_item_id = OLD.id)
      OR EXISTS (SELECT 1 FROM public.pricing_rule_versions WHERE charge_item_id = OLD.id);
  ELSIF TG_TABLE_NAME = 'charge_tables' THEN
    v_used := EXISTS (SELECT 1 FROM public.charge_calculations WHERE charge_table_id = OLD.id)
      OR EXISTS (SELECT 1 FROM public.invoice_items WHERE charge_table_id = OLD.id)
      OR EXISTS (SELECT 1 FROM public.pricing_rule_versions WHERE charge_table_id = OLD.id);
  ELSIF TG_TABLE_NAME = 'customer_rate_overrides' THEN
    v_used := EXISTS (SELECT 1 FROM public.pricing_rule_versions WHERE customer_rate_override_id = OLD.id);
  ELSIF TG_TABLE_NAME = 'granite_rates' THEN
    v_used := EXISTS (SELECT 1 FROM public.granite_bl_charges WHERE rate_id = OLD.id);
  ELSIF TG_TABLE_NAME IN ('demurrage_rates', 'customer_demurrage_agreements') THEN
    v_used := OLD.valid_from IS NULL OR OLD.valid_from <= current_date;
  END IF;

  IF v_used THEN
    RAISE EXCEPTION 'Esta tarifa já foi usada (ou já está em vigor): desative em vez de excluir.'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN OLD;
END;
$function$;

CREATE OR REPLACE FUNCTION public.guard_tariff_active_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF OLD.active IS DISTINCT FROM NEW.active AND auth.uid() IS NOT NULL AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Somente o Administrativo desativa ou reativa tarifas.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.guard_used_tariff_delete() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_tariff_active_change() FROM PUBLIC, anon, authenticated;

DO $triggers$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['charge_table_items', 'charge_tables', 'customer_rate_overrides', 'granite_rates', 'demurrage_rates', 'customer_demurrage_agreements'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_guard_used_tariff_delete ON public.%I', v_table);
    EXECUTE format('CREATE TRIGGER trg_guard_used_tariff_delete BEFORE DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.guard_used_tariff_delete()', v_table);
    EXECUTE format('DROP TRIGGER IF EXISTS trg_guard_tariff_active_change ON public.%I', v_table);
    EXECUTE format('CREATE TRIGGER trg_guard_tariff_active_change BEFORE UPDATE OF active ON public.%I FOR EACH ROW EXECUTE FUNCTION public.guard_tariff_active_change()', v_table);
  END LOOP;
END;
$triggers$;
