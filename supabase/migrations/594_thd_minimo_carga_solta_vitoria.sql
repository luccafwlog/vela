-- 594: THD por tonelada da carga solta de Vitória com mínimo de R$ 380,00 por
-- B/L (decisão do dono de 2026-11-05, ADR 0125).
--
-- Regra: na tabela de Taxas Locais de carga solta de Vitória (porto da tabela
-- normalizado para BRVIX), o item THD (nome começa com "THD") em R$ com base
-- "por tonelada" cobra, por B/L, o maior entre toneladas × valor unitário e
-- R$ 380,00. Exemplo: 2 t × R$ 62,50 = R$ 125,00 → cobra R$ 380,00. Vale
-- também com Condição do Cliente no THD e na parte de carga solta do B/L
-- misto. Quantidade e unitário da linha continuam os da tabela; só o total
-- sobe (2 t × R$ 62,50 = R$ 380,00 na linha). A linha resolvida leva em
-- `notes` "THD com valor mínimo de R$ 380,00 por B/L"; como a nota do THD IMO
-- e OOG, ela não é gravada em `charge_calculations` (a 574 só grava `notes`
-- de linha em revisão).
--
-- Função nova: `_thd_weight_ton_minimum_brl(cargo_mode, pod_key)`, dona do
-- valor e do escopo. Redefinida (mesma assinatura; CREATE OR REPLACE preserva
-- dono e grants): `_resolve_bl_local_charge_items_table`, a partir da
-- definição vigente (574; pg_get_functiondef no Postgres local com a cadeia
-- até a 593). Todo leitor do cálculo (cálculo do B/L, cotação da correção,
-- COD, Desbloqueio de CE) passa por ela.
--
-- ponytail: valor e porto fixos em função, sem campo no cadastro do item.
-- Mudar o valor ou estender a outro porto pede nova migration; o caminho de
-- evolução é um "valor mínimo por B/L" no item da tabela (ADR 0125).
--
-- Só redefine funções; não grava nem reescreve linhas. Os B/Ls já calculados
-- mudam no próximo recálculo (Recalcular ou mudança de dado do B/L); faturas
-- emitidas não mudam.
-- Rollback: reaplicar `_resolve_bl_local_charge_items_table` pela 574 e
-- remover `_thd_weight_ton_minimum_brl(text, text)`.

CREATE OR REPLACE FUNCTION public._thd_weight_ton_minimum_brl(p_table_cargo_mode text, p_table_pod_key text)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  -- Mínimo por B/L do THD por tonelada (decisão do dono de 2026-11-05):
  -- só a tabela de carga solta de Vitória; nas outras, NULL (sem mínimo).
  SELECT CASE WHEN p_table_cargo_mode = 'carga_solta' AND p_table_pod_key = 'BRVIX'
    THEN 380.00::numeric END;
$function$;
REVOKE ALL ON FUNCTION public._thd_weight_ton_minimum_brl(text, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._resolve_bl_local_charge_items_table(p_bl_id text, p_pod text)
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
  v_dual_thd_seen boolean := false;
  v_dual_qty numeric(12,6);
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
  v_tbl_pod_key text;
  v_thd_minimum_brl numeric(12,2);
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

  -- Regra única com o lançamento manual e a avulsa (migration 248).
  -- ADR 0093, decisão 3: depois do CE vale a data e o preço congelados.
  v_ref_date := coalesce((SELECT f.reference_date FROM public.bl_price_freezes f WHERE f.bl_id = p_bl_id),
    public.bl_local_charge_reference_date(p_bl_id, p_pod));

  -- 1. Contêineres e rateios se container ou misto
  IF v_bl.cargo_mode IN ('container', 'misto') THEN
    WITH current_containers AS (
      SELECT
        UPPER(TRIM(bc.container_number)) AS cn,
        BOOL_OR(COALESCE(bc.is_imo, false)) AS has_imo,
        BOOL_OR(COALESCE(bc.is_oog, false)) AS has_oog,
        BOOL_OR(COALESCE(bc.ownership, 'COC') = 'SOC') AS is_soc
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
        cc.is_soc,
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
        'is_soc', is_soc,
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
    -- 594 (ADR 0125): o porto da tabela decide o mínimo do THD por tonelada.
    SELECT public.normalize_port_code(ct.pod) INTO v_tbl_pod_key
      FROM public.charge_tables AS ct WHERE ct.id = v_tbl.table_id;
    v_thd_minimum_brl := public._thd_weight_ton_minimum_brl(v_tbl.cargo_mode, v_tbl_pod_key);

    -- Iterar itens da tabela ativa
    FOR item IN
      SELECT
        cti.id,
        cti.name,
        cti.application_basis,
        COALESCE(cti.cargo_profile, 'any') AS cargo_profile,
        COALESCE(cti.currency, 'BRL') AS currency,
        CASE WHEN fz.bl_id IS NULL THEN cti.unit_value_brl ELSE fz.unit_value_brl END AS unit_value_brl,
        CASE WHEN fz.bl_id IS NULL THEN cti.unit_value_usd ELSE fz.unit_value_usd END AS unit_value_usd,
        COALESCE(cti.applies_to_soc, true) AS applies_to_soc,
        CASE WHEN fz.bl_id IS NULL THEN ov.override_value ELSE fz.override_value END AS override_value
      FROM public.charge_table_items AS cti
      LEFT JOIN public.bl_price_freeze_items AS fz ON fz.bl_id = p_bl_id AND fz.charge_item_id = cti.id
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
      -- se a tabela de container já forneceu taxa de base 'bl'. Se não forneceu, todas as
      -- taxas por B/L da carga solta são cobradas (470, TAX-D14; ADR 0105).
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
      notes := 'Revisão manual obrigatória';

      v_qty := 0;
      v_is_thd := UPPER(COALESCE(item.name, '')) LIKE 'THD%';

      IF item.application_basis = 'bl' THEN
        v_qty := 1;
        -- Só a taxa por B/L do lado container suprime a da carga solta (470, TAX-D14).
        IF v_tbl.cargo_mode = 'container' THEN
          v_has_bl_basis_item := true;
        END IF;
      ELSIF item.application_basis = 'weight_ton' THEN
        -- P0: Para carga solta e misto, usar estritamente bb_weight_ton.
        -- O peso conteinerizado (total_weight_kg) NÃO substitui o peso solto.
        v_weight_ton := CASE
          WHEN v_bl.cargo_mode IN ('carga_solta', 'misto') THEN v_bl.bb_weight_ton
          ELSE COALESCE(v_bl.bb_weight_ton, CASE WHEN v_bl.total_weight_kg IS NULL THEN NULL ELSE v_bl.total_weight_kg / 1000 END, 0)
        END;
        IF COALESCE(v_weight_ton, 0) <= 0 THEN
          calculation_key := CONCAT('review:weight_missing:', item.id);
          review_reason := 'Peso de carga solta ausente; o peso conteinerizado não substitui o peso solto';
          status := 'review_required';
          notes := 'Revisão manual obrigatória';
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
              review_reason := 'Item THD cadastrado com perfil de carga ''any''; motor só calcula standard/imo/oog';
              notes := 'Revisão manual obrigatória';
              RETURN NEXT;
              CONTINUE;
            END IF;
          ELSE
            v_qty := v_qty_total;
          END IF;
        END IF;
      ELSE
        calculation_key := CONCAT('review:unsupported_basis:', item.id);
        review_reason := CONCAT('Base de aplicação não suportada pelo motor: ', COALESCE(item.application_basis, '(vazia)'));
        RETURN NEXT;
        CONTINUE;
      END IF;

      -- 121: item que nao cobra de SOC (Drop Off, Damage Protection) conta
      -- so os containers COC, com o mesmo rateio e o mesmo filtro de perfil.
      IF item.application_basis = 'container_distinct_voyage'
         AND v_bl.cargo_mode IN ('container', 'misto')
         AND NOT item.applies_to_soc THEN
        SELECT COALESCE(SUM(1 / (elem->>'share_count')::numeric), 0)
        INTO v_qty
        FROM jsonb_array_elements(COALESCE(v_container_shares, '[]'::jsonb)) AS elem
        WHERE NOT (elem->>'is_soc')::boolean
          AND (
            NOT v_is_thd
            OR (item.cargo_profile = 'standard' AND NOT (elem->>'has_imo')::boolean AND NOT (elem->>'has_oog')::boolean)
            OR (item.cargo_profile = 'imo' AND (elem->>'has_imo')::boolean AND NOT (elem->>'has_oog')::boolean)
            OR (item.cargo_profile = 'oog' AND (elem->>'has_oog')::boolean AND NOT (elem->>'has_imo')::boolean)
          );
      END IF;

      -- ADR 0077 (decisão de 2026-10-02): container IMO e OOG ao mesmo tempo
      -- paga o THD normal com 150% de majoração (50% IMO + 100% OOG). Deriva
      -- do item standard, respeitando Condição do Cliente, rateio e SOC.
      IF v_is_thd AND item.cargo_profile = 'standard' AND item.application_basis = 'container_distinct_voyage'
         AND v_bl.cargo_mode IN ('container', 'misto') AND COALESCE(v_qty_dual, 0) > 0 THEN
        v_dual_thd_seen := true;
        SELECT COALESCE(SUM(1 / (elem->>'share_count')::numeric), 0)
        INTO v_dual_qty
        FROM jsonb_array_elements(COALESCE(v_container_shares, '[]'::jsonb)) AS elem
        WHERE (elem->>'has_imo')::boolean AND (elem->>'has_oog')::boolean
          AND (item.applies_to_soc OR NOT (elem->>'is_soc')::boolean);
        IF v_dual_qty > 0 THEN
          -- 171: a condição vale na moeda do item.
          v_unit_brl := ROUND(COALESCE(CASE WHEN item.currency = 'USD' THEN NULL ELSE item.override_value END, item.unit_value_brl, 0) * 2.5, 2);
          v_unit_usd := ROUND(COALESCE(CASE WHEN item.currency = 'USD' THEN item.override_value END, item.unit_value_usd, 0) * 2.5, 2);
          status := 'calculated';
          review_reason := NULL;
          notes := 'THD IMO e OOG: THD normal com 150% de majoração';
          calculation_key := CONCAT('auto:item:', item.id, ':imo_oog');
          override_applied := item.override_value IS NOT NULL;
          quantity := v_dual_qty;
          unit_value_brl := CASE WHEN item.currency = 'USD' THEN NULL ELSE v_unit_brl END;
          unit_value_usd := CASE WHEN item.currency = 'USD' THEN v_unit_usd ELSE NULL END;
          SELECT COALESCE(SUM(
            CASE WHEN (elem->>'is_last')::boolean
              THEN u.unit - ((elem->>'share_count')::numeric - 1) * ROUND(u.unit / (elem->>'share_count')::numeric, 2)
              ELSE ROUND(u.unit / (elem->>'share_count')::numeric, 2)
            END
          ), 0)
          INTO v_total_line_brl
          FROM jsonb_array_elements(COALESCE(v_container_shares, '[]'::jsonb)) AS elem
          CROSS JOIN LATERAL (SELECT CASE WHEN item.currency = 'USD' THEN v_unit_usd ELSE v_unit_brl END AS unit) AS u
          WHERE (elem->>'has_imo')::boolean AND (elem->>'has_oog')::boolean
            AND (item.applies_to_soc OR NOT (elem->>'is_soc')::boolean);
          total_value_brl := CASE WHEN item.currency = 'USD' THEN NULL ELSE v_total_line_brl END;
          total_value_usd := CASE WHEN item.currency = 'USD' THEN v_total_line_brl ELSE NULL END;
          RETURN NEXT;
        END IF;
      END IF;

      IF COALESCE(v_qty, 0) <= 0 THEN
        CONTINUE;
      END IF;

      status := 'calculated';
      notes := NULL;
      calculation_key := CONCAT('auto:item:', item.id);
      v_override := item.override_value IS NOT NULL;
      override_applied := v_override;
      -- 171: a condição vale na moeda do item.
      v_unit_brl := COALESCE(CASE WHEN item.currency = 'USD' THEN NULL ELSE item.override_value END, item.unit_value_brl, 0);
      v_unit_usd := CASE WHEN item.currency = 'USD' THEN COALESCE(item.override_value, item.unit_value_usd) ELSE item.unit_value_usd END;
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
          WHERE (
            NOT v_is_thd
            OR (item.cargo_profile = 'standard' AND NOT (elem->>'has_imo')::boolean AND NOT (elem->>'has_oog')::boolean)
            OR (item.cargo_profile = 'imo' AND (elem->>'has_imo')::boolean AND NOT (elem->>'has_oog')::boolean)
            OR (item.cargo_profile = 'oog' AND (elem->>'has_oog')::boolean AND NOT (elem->>'has_imo')::boolean)
          )
            AND (item.applies_to_soc OR NOT (elem->>'is_soc')::boolean);
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
          WHERE (
            NOT v_is_thd
            OR (item.cargo_profile = 'standard' AND NOT (elem->>'has_imo')::boolean AND NOT (elem->>'has_oog')::boolean)
            OR (item.cargo_profile = 'imo' AND (elem->>'has_imo')::boolean AND NOT (elem->>'has_oog')::boolean)
            OR (item.cargo_profile = 'oog' AND (elem->>'has_oog')::boolean AND NOT (elem->>'has_imo')::boolean)
          )
            AND (item.applies_to_soc OR NOT (elem->>'is_soc')::boolean);
          v_total_line_usd := NULL;
        END IF;
      ELSE
        v_total_line_brl := CASE WHEN item.currency = 'USD' THEN NULL ELSE ROUND(v_qty * COALESCE(v_unit_brl, 0), 2) END;
        v_total_line_usd := CASE WHEN item.currency = 'USD' THEN ROUND(v_qty * COALESCE(v_unit_usd, 0), 2) ELSE NULL END;
        -- 594 (ADR 0125): THD por tonelada da tabela de carga solta de Vitória
        -- cobra no mínimo o valor fixo por B/L, também com Condição do Cliente.
        -- Quantidade e unitário ficam os da tabela; só o total sobe, e a nota
        -- explica a diferença. A linha mantém a chave `auto:item:<id>`, então
        -- a taxa alterada à mão (ADR 0111) continua presa a ela.
        IF v_is_thd AND item.application_basis = 'weight_ton' AND item.currency <> 'USD'
           AND v_thd_minimum_brl IS NOT NULL AND v_total_line_brl < v_thd_minimum_brl THEN
          v_total_line_brl := v_thd_minimum_brl;
          notes := CONCAT('THD com valor mínimo de R$ ', replace(to_char(v_thd_minimum_brl, 'FM999999990.00'), '.', ','), ' por B/L');
        END IF;
      END IF;

      total_value_brl := v_total_line_brl;
      total_value_usd := v_total_line_usd;
      RETURN NEXT;
    END LOOP;
  END LOOP;

  -- F-55 (376): container IMO e OOG sem item THD standard na tabela não fica
  -- sem cobrança em silêncio: o cálculo vai para revisão.
  IF v_table_count > 0 AND COALESCE(v_qty_dual, 0) > 0 AND v_bl.cargo_mode IN ('container', 'misto') AND NOT v_dual_thd_seen THEN
    charge_table_id := NULL;
    charge_item_id := NULL;
    quantity := v_qty_dual;
    unit_value_brl := NULL;
    unit_value_usd := NULL;
    total_value_brl := 0;
    total_value_usd := NULL;
    override_applied := false;
    source := 'auto';
    status := 'review_required';
    calculation_key := 'review:thd_imo_oog_without_standard';
    review_reason := 'Container IMO e OOG sem item THD standard na tabela: cadastre o THD standard ou cobre por Fatura Avulsa';
    notes := 'Revisão manual obrigatória';
    RETURN NEXT;
  END IF;

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
    notes := 'Revisão manual obrigatória';
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
    notes := 'Revisão manual obrigatória';
    RETURN NEXT;
  END IF;

  RETURN;
END;
$function$;
