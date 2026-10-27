-- 467: Taxas Locais e faturamento (decisões do dono de 2026-10-27, lote 2 do
-- plano de correções).
--
-- Problema e mudança, por seção:
--   1. FAT-D12 — a lista de Emitir consolidada mostrava como "Sim" o B/L com
--      saldo e sem CE Mercante, e só a emissão o recusava.
--      `list_consolidatable_receivables` passa a devolver esse B/L como não
--      elegível (`no_ce_mercante`, "sem CE Mercante.").
--   2. TAX-D13 — o POD e o modo de carga de tabela já usada (vínculo, cálculo
--      ou fatura, `charge_table_in_use`) mudavam livremente: os B/Ls deixavam
--      de usá-la no próximo cálculo, sem correção de fatura. O gatilho
--      `trg_guard_used_tariff_scope` recusa a mudança; para outro POD ou modo,
--      cadastra-se uma tabela nova.
--   3. TAX-D14 — no B/L misto sem taxa por B/L na tabela de container, só a
--      primeira taxa por B/L da carga solta era cobrada: a marca "já cobrou"
--      era ligada pela própria carga solta. Agora todas as da carga solta são
--      cobradas; com taxa por B/L no container, as da carga solta seguem fora
--      (ADR 0105).
--   4. TAX-D16 — a guarda de preço ausente (066) trocava o motivo da linha em
--      revisão ("Peso de carga solta ausente…") por "Tarifa BRL sem valor
--      unitário vigente.". A linha de revisão do cálculo guarda o motivo dela.
--   5. FAT-D15 — o resumo de correção da fatura não via a pendência do B/L que
--      está só em consolidada.
--   6. FAT-D15 — "Tentar aplicar correção" que voltava a travar apagava a
--      pendência: o alerta ficava e o botão sumia.
--   7. TAX-D17 — a troca de modalidade deixava as linhas antigas em "Não
--      calculado" até alguém calcular; o recálculo do fim da gravação passa a
--      alcançar esse B/L quando ele já tinha cálculo.
--   8. TAX-D08 — o Histórico do B/L perdia a exclusão de taxa e mostrava o
--      refixar como "Dado do B/L": os registros de taxa gravam o B/L, e o
--      refixar entra na família Taxas.
--
-- Data status: a seção 8 preenche `audit_logs.bl_id` em registros de taxa já
-- gravados (só a coluna do B/L, nada é apagado). Depende da afirmação "Data
-- status" do AGENTS.md (2026-09-18): a produção não tem dados reais de negócio.
-- Mesmo sem ela, o preenchimento só copia o B/L que o próprio registro já cita.
--
-- Rollback: reaplicar `list_consolidatable_receivables` da `002`,
-- `resolve_bl_local_charge_items` da `376`, `guard_missing_charge_price` da
-- `066`, `get_invoice_correction_summary_legacy_134` da `136`,
-- `retry_invoice_basis_changes_legacy_134` da `246`,
-- `_refresh_bl_calculation_if_stale` da `355` e `bl_timeline` da `404`;
-- DROP TRIGGER trg_guard_used_tariff_scope ON public.charge_tables;
-- DROP TRIGGER trg_audit_logs_fill_charge_bl_id ON public.audit_logs;
-- DROP FUNCTION public.guard_used_tariff_scope(), public.audit_logs_fill_charge_bl_id().

-- 1 --- Consolidada: B/L sem CE Mercante não é elegível (FAT-D12) -----------
CREATE OR REPLACE FUNCTION public.list_consolidatable_receivables(p_customer_id bigint, p_voyage_id bigint DEFAULT NULL::bigint, p_search text DEFAULT NULL::text)
 RETURNS TABLE(receivable_id bigint, bl_id text, customer_id bigint, customer_name text, customer_cnpj_cpf text, voyage_id bigint, vessel_name text, voyage_number text, individual_invoice_id bigint, individual_invoice_number text, balance_brl numeric, original_amount_brl numeric, receivable_status text, eligibility_status text, eligibility_reason text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_read_user() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa.' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH base AS (
    SELECT
      br.id AS receivable_id,
      br.bl_id,
      br.customer_id,
      c.name AS customer_name,
      c.cnpj_cpf AS customer_cnpj_cpf,
      br.voyage_id,
      v.voyage_number,
      ve.name AS vessel_name,
      br.balance_brl,
      br.original_amount_brl,
      br.status AS receivable_status,
      indiv.invoice_id AS individual_invoice_id,
      inv_ind.invoice_number AS individual_invoice_number,
      EXISTS (
        SELECT 1
        FROM public.invoice_receivable_links irl
        JOIN public.invoices inv ON inv.id = irl.invoice_id
        WHERE irl.receivable_id = br.id
          AND inv.invoice_type = 'consolidated'
          AND COALESCE(inv.status, 'issued') IN ('draft', 'issued', 'partially_paid', 'overdue')
      ) AS has_open_consolidated,
      NULLIF(btrim(COALESCE(b.ce_mercante, '')), '') IS NULL AS missing_ce_mercante
    FROM public.bl_receivables br
    JOIN public.customers c ON c.id = br.customer_id
    LEFT JOIN public.bls b ON b.id = br.bl_id
    LEFT JOIN public.voyages v ON v.id = br.voyage_id
    LEFT JOIN public.vessels ve ON ve.id = v.vessel_id
    LEFT JOIN LATERAL (
      SELECT irl.invoice_id
      FROM public.invoice_receivable_links irl
      JOIN public.invoices inv ON inv.id = irl.invoice_id
      WHERE irl.receivable_id = br.id
        AND inv.invoice_type = 'individual'
      ORDER BY inv.id DESC
      LIMIT 1
    ) indiv ON TRUE
    LEFT JOIN public.invoices inv_ind ON inv_ind.id = indiv.invoice_id
    WHERE br.customer_id = p_customer_id
      AND (p_voyage_id IS NULL OR br.voyage_id = p_voyage_id)
      AND (
        NULLIF(TRIM(COALESCE(p_search, '')), '') IS NULL
        OR br.bl_id ILIKE '%' || TRIM(p_search) || '%'
        OR EXISTS (SELECT 1 FROM unnest(public.search_term_tokens(p_search)) AS term WHERE br.bl_id ILIKE '%' || term || '%')
      )
  )
  SELECT
    base.receivable_id,
    base.bl_id,
    base.customer_id,
    base.customer_name,
    base.customer_cnpj_cpf,
    base.voyage_id,
    base.vessel_name,
    base.voyage_number,
    base.individual_invoice_id,
    base.individual_invoice_number,
    base.balance_brl,
    base.original_amount_brl,
    base.receivable_status,
    CASE
      WHEN base.receivable_status = 'settled' THEN 'paid'
      WHEN base.receivable_status = 'void' THEN 'no_balance'
      WHEN base.has_open_consolidated THEN 'open_consolidated'
      WHEN base.balance_brl <= 0 THEN 'no_balance'
      WHEN base.missing_ce_mercante THEN 'no_ce_mercante'
      ELSE 'eligible'
    END AS eligibility_status,
    CASE
      WHEN base.receivable_status = 'settled' THEN 'B/L ja liquidado.'
      WHEN base.receivable_status = 'void' THEN 'B/L sem saldo de taxas locais.'
      WHEN base.has_open_consolidated THEN 'B/L ja esta em consolidada aberta.'
      WHEN base.balance_brl <= 0 THEN 'B/L sem saldo aberto.'
      WHEN base.missing_ce_mercante THEN 'sem CE Mercante.'
      ELSE 'Elegivel para consolidacao.'
    END AS eligibility_reason
  FROM base
  ORDER BY base.voyage_id DESC NULLS LAST, base.bl_id ASC;
END;
$function$;

-- 2 --- Tabela já usada não muda POD nem modo de carga (TAX-D13) ------------
CREATE OR REPLACE FUNCTION public.guard_used_tariff_scope()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF (OLD.pod IS DISTINCT FROM NEW.pod OR OLD.cargo_mode IS DISTINCT FROM NEW.cargo_mode)
     AND public.charge_table_in_use(OLD.id) THEN
    RAISE EXCEPTION 'Tabela já usada por B/L: POD e modo de carga não mudam. Para outro POD ou modo, cadastre uma tabela nova.'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.guard_used_tariff_scope() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_used_tariff_scope ON public.charge_tables;
CREATE TRIGGER trg_guard_used_tariff_scope
  BEFORE UPDATE OF pod, cargo_mode ON public.charge_tables
  FOR EACH ROW EXECUTE FUNCTION public.guard_used_tariff_scope();

-- 3 --- B/L misto: todas as taxas por B/L da carga solta quando o container não
-- tem nenhuma (TAX-D14, opção B; ADR 0105). Definição vigente da 376; muda só a
-- marca "já cobrou taxa por B/L", que agora só a tabela de container liga.
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
      -- taxas por B/L da carga solta são cobradas (467, TAX-D14; ADR 0105).
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
        -- Só a taxa por B/L do lado container suprime a da carga solta (467, TAX-D14).
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
          notes := 'THD IMO e OOG: THD normal com 150% de majoracao';
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
    notes := 'Revisao manual obrigatoria';
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

-- 4 --- Linha em revisão mantém o motivo do cálculo (TAX-D16) ---------------
-- A guarda da 066 trocava todo motivo por "Tarifa BRL/USD sem valor unitário
-- vigente." porque a linha em revisão do cálculo é gravada sem valor unitário.
-- A linha de revisão do motor (`calculation_key` 'review:…') guarda o motivo
-- dela (peso ausente, perfil 'any', base não suportada); as demais seguem com
-- o texto da guarda. Status e totais continuam forçados à revisão.
CREATE OR REPLACE FUNCTION public.guard_missing_charge_price()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_currency text;
  v_keep_reason boolean;
BEGIN
  IF NEW.charge_item_id IS NULL THEN RETURN NEW; END IF;
  v_keep_reason := COALESCE(NEW.calculation_key, '') LIKE 'review:%' AND NULLIF(btrim(COALESCE(NEW.review_reason, '')), '') IS NOT NULL;
  SELECT upper(coalesce(currency, 'BRL')) INTO v_currency FROM public.charge_table_items WHERE id = NEW.charge_item_id;
  IF v_currency = 'USD' AND NEW.unit_value_usd IS NULL THEN
    NEW.status := 'review_required'; NEW.total_value_usd := NULL; NEW.total_value_brl := NULL;
    IF NOT v_keep_reason THEN
      NEW.review_reason := 'Tarifa USD sem valor unitário vigente.'; NEW.notes := 'Revisão manual obrigatória';
    END IF;
  ELSIF v_currency <> 'USD' AND NEW.unit_value_brl IS NULL THEN
    NEW.status := 'review_required'; NEW.total_value_usd := NULL; NEW.total_value_brl := NULL;
    IF NOT v_keep_reason THEN
      NEW.review_reason := 'Tarifa BRL sem valor unitário vigente.'; NEW.notes := 'Revisão manual obrigatória';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- 5 --- Correção pendente também do B/L que está só em consolidada (FAT-D15) -
-- A consolidada liga os B/Ls por `invoice_receivable_links`, sem
-- `invoice_bls`: a lista de correções pendentes do detalhe não os via e o
-- botão "Tentar aplicar correção" não aparecia.
CREATE OR REPLACE FUNCTION public.get_invoice_correction_summary_legacy_134(p_invoice_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_result jsonb;
BEGIN
  v_result := public.get_invoice_correction_summary_legacy_130(p_invoice_id);
  RETURN v_result || jsonb_build_object('pending_bl_ids', coalesce((SELECT jsonb_agg(p.bl_id ORDER BY p.bl_id)
    FROM public.invoice_basis_pending_changes p WHERE EXISTS
      (SELECT 1 FROM public.invoice_bls ib WHERE ib.invoice_id = p_invoice_id AND ib.bl_id = p.bl_id)
      OR EXISTS (SELECT 1 FROM public.invoice_receivable_links l JOIN public.bl_receivables r ON r.id = l.receivable_id
        WHERE l.invoice_id = p_invoice_id AND r.bl_id = p.bl_id AND COALESCE(l.status, '') <> 'obsolete')), '[]'::jsonb));
END;
$function$;

-- 6 --- "Tentar aplicar correção" que segue bloqueada continua pendente (FAT-D15)
-- Antes a tentativa apagava a pendência mesmo quando a reemissão voltava a
-- travar (`blocked_review`): o alerta ficava e o botão sumia. Mesma regra de
-- `process_invoice_basis_changes` (381).
CREATE OR REPLACE FUNCTION public.retry_invoice_basis_changes_legacy_134(p_bl_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_result jsonb; v_cod_id bigint; v_cod_map jsonb; v_blocked jsonb;
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
  SELECT r INTO v_blocked FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v_result) = 'array' THEN v_result ELSE '[]'::jsonb END) r
    WHERE r->>'bl_id' = p_bl_id AND r->>'status' = 'blocked_review' LIMIT 1;
  IF v_blocked IS NULL THEN
    DELETE FROM public.invoice_basis_pending_changes WHERE bl_id = p_bl_id;
  ELSE
    UPDATE public.invoice_basis_pending_changes
       SET error_message = 'Reemissão bloqueada: ' || coalesce(v_blocked->>'pending_reason', 'pendência de revisão'), updated_at = now()
     WHERE bl_id = p_bl_id;
  END IF;
  PERFORM set_config('vela.cod_basis_events', v_cod_map::text, true);
  PERFORM set_config('vela.invoice_basis_running', 'off', true);
  RETURN v_result;
END;
$function$;

-- 7 --- Troca de modalidade recalcula no fim da gravação (TAX-D17) ----------
-- A troca de modalidade põe as taxas em "Não calculado" (gatilho da 064) e o
-- recálculo do fim da transação pulava B/L "Não calculado": as linhas antigas
-- ficavam até alguém calcular. Sem esse filtro, a base gravada decide: B/L
-- nunca calculado não tem base (`bl_calculation_is_current` devolve true) e
-- continua sem cálculo automático.
CREATE OR REPLACE FUNCTION public._refresh_bl_calculation_if_stale(p_bl_id text, p_actor uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.bls b
    WHERE b.id = p_bl_id AND b.cancelled_at IS NULL
      AND coalesce(b.financial_status, 'pending') = 'pending')
     OR cardinality(public._live_local_invoice_ids_for_bl(p_bl_id)) > 0
     OR public.bl_calculation_is_current(p_bl_id) THEN
    RETURN false;
  END IF;
  PERFORM public._calculate_bl_local_charges_impl_106(p_bl_id, coalesce(p_actor, auth.uid()), true);
  RETURN true;
END;
$function$;

-- 8 --- Histórico do B/L guarda os eventos de taxa (TAX-D08) ------------------
-- O Histórico achava a taxa pela linha ainda existente: a exclusão de cobrança
-- manual sumia. O registro de taxa passa a gravar o B/L (`audit_logs.bl_id`) e
-- `bl_timeline` lê por ele; o refixar do preço entra em Taxas.
CREATE OR REPLACE FUNCTION public.audit_logs_fill_charge_bl_id()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.bl_id IS NULL AND NEW.entity_type IN ('charge_calculation', 'charge_calculations') THEN
    SELECT cc.bl_id INTO NEW.bl_id FROM public.charge_calculations cc WHERE cc.id::text = NEW.entity_id;
    IF NEW.bl_id IS NULL THEN
      -- Linha já excluída: o B/L do registro anterior da mesma taxa (a exclusão
      -- pelo gatilho genérico entra antes, com o JSON da linha).
      SELECT coalesce(a.bl_id, public._audit_json_field(a.old_value, 'bl_id')) INTO NEW.bl_id
        FROM public.audit_logs a
       WHERE a.entity_type IN ('charge_calculation', 'charge_calculations') AND a.entity_id = NEW.entity_id
         AND coalesce(a.bl_id, public._audit_json_field(a.old_value, 'bl_id')) IS NOT NULL
       ORDER BY a.id DESC LIMIT 1;
    END IF;
    IF NEW.bl_id IS NULL AND NEW.entity_type = 'charge_calculations' THEN
      NEW.bl_id := public._audit_json_field(coalesce(NEW.old_value, NEW.new_value), 'bl_id');
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.audit_logs_fill_charge_bl_id() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_audit_logs_fill_charge_bl_id ON public.audit_logs;
CREATE TRIGGER trg_audit_logs_fill_charge_bl_id
  BEFORE INSERT ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.audit_logs_fill_charge_bl_id();

-- Registros já gravados: o B/L da linha atual ou do JSON da exclusão.
UPDATE public.audit_logs a SET bl_id = cc.bl_id
  FROM public.charge_calculations cc
 WHERE a.bl_id IS NULL AND a.entity_type IN ('charge_calculation', 'charge_calculations') AND a.entity_id = cc.id::text;
UPDATE public.audit_logs a SET bl_id = j.bl_id
  FROM (SELECT DISTINCT ON (x.entity_id) x.entity_id, public._audit_json_field(x.old_value, 'bl_id') AS bl_id
          FROM public.audit_logs x
         WHERE x.entity_type = 'charge_calculations' AND x.field_name = 'excluido'
           AND public._audit_json_field(x.old_value, 'bl_id') IS NOT NULL
         ORDER BY x.entity_id, x.id DESC) j
 WHERE a.bl_id IS NULL AND a.entity_type IN ('charge_calculation', 'charge_calculations') AND a.entity_id = j.entity_id;

-- 9 --- bl_timeline da 404 com o `bl_id` da taxa e o refixar em Taxas (TAX-D08)
CREATE OR REPLACE FUNCTION public.bl_timeline(p_bl_id text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS TABLE(id bigint, family text, entity_type text, field_name text, old_value text, new_value text, changed_by uuid, changed_at timestamp with time zone, justification text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH bl_row AS (
    SELECT b.id, b.created_at FROM public.bls b WHERE b.id = p_bl_id
  ),
  -- Rastro de containers e veículos do B/L pelo `bl_id` gravado (404), mais as
  -- linhas em que o container ou veículo saiu deste B/L para outro.
  trail AS (
    SELECT a.* FROM public.audit_logs a
    WHERE a.bl_id = p_bl_id AND a.entity_type IN ('bl_containers', 'vehicles')
    UNION
    SELECT a.* FROM public.audit_logs a
    WHERE a.field_name = 'bl_id' AND a.entity_type IN ('bl_containers', 'vehicles')
      AND a.old_value = p_bl_id
  ),
  member_containers AS (
    SELECT c.id::text AS id FROM public.bl_containers c WHERE c.bl_id = p_bl_id
    UNION
    SELECT t.entity_id FROM trail t WHERE t.entity_type = 'bl_containers'
  ),
  -- Número do container (e chassi do veículo): o registro atual ou o JSON do
  -- rastro, para o container que já saiu.
  names AS (
    SELECT DISTINCT ON (k.entity_type, k.id) k.entity_type, k.id, k.label
    FROM (
      SELECT 'bl_containers'::text AS entity_type, c.id::text AS id, c.container_number AS label, 0 AS prio, NULL::timestamptz AS at
      FROM public.bl_containers c WHERE c.id::text IN (SELECT id FROM member_containers)
      UNION ALL
      SELECT 'vehicles', v.id::text, v.chassis, 0, NULL
      FROM public.vehicles v WHERE v.id::text IN (SELECT t.entity_id FROM trail t WHERE t.entity_type = 'vehicles')
      UNION ALL
      SELECT t.entity_type, t.entity_id,
             public._audit_json_field(COALESCE(t.new_value, t.old_value),
               CASE WHEN t.entity_type = 'vehicles' THEN 'chassis' ELSE 'container_number' END),
             1, t.changed_at
      FROM trail t WHERE t.field_name IN ('criado', 'excluido')
    ) k
    WHERE k.label IS NOT NULL
    ORDER BY k.entity_type, k.id, k.prio, k.at DESC NULLS LAST
  ),
  events AS (
    -- Linhas semânticas do B/L (RPCs e importações).
    SELECT
      a.id,
      CASE
        WHEN a.entity_type = 'invoice' THEN 'fatura'
        WHEN a.entity_type = 'charge_calculation' THEN 'taxas'
        WHEN a.entity_type = 'bl_container' THEN 'container'
        WHEN a.entity_type = 'system_event' THEN 'sistema'
        WHEN a.entity_type = 'bl' AND a.field_name IN ('charge_status', 'local_charge_prices_refixed') THEN 'taxas'
        WHEN a.entity_type = 'bl' AND a.field_name IN ('financial_status', 'billing_hold_reason', 'last_billing_run_id') THEN 'fatura'
        WHEN a.entity_type = 'bl' AND a.field_name IN ('container_ownership', 'container_profile', 'container_dates', 'container_dates_import') THEN 'container'
        ELSE 'edicao'
      END AS family,
      a.entity_type,
      CASE
        WHEN a.entity_type = 'bl_container' AND n.label IS NOT NULL AND position('|' IN a.field_name) = 0
          THEN a.field_name || '|' || n.label
        ELSE a.field_name
      END AS field_name,
      a.old_value,
      a.new_value,
      a.changed_by,
      a.changed_at,
      a.justification
    FROM public.audit_logs a
    LEFT JOIN names n ON n.entity_type = 'bl_containers' AND a.entity_type = 'bl_container' AND n.id = a.entity_id
    WHERE (
           (a.entity_type = 'bl' AND a.entity_id = p_bl_id
            AND a.changed_at IS DISTINCT FROM (SELECT created_at FROM bl_row))
        OR (a.entity_type = 'bl_container' AND a.entity_id IN (SELECT id FROM member_containers))
        -- 467 (TAX-D08): o `bl_id` gravado mantém a taxa excluída no Histórico.
        OR (a.entity_type = 'charge_calculation' AND (a.bl_id = p_bl_id OR a.entity_id IN (
              SELECT cc.id::text FROM public.charge_calculations cc WHERE cc.bl_id = p_bl_id)))
        OR (a.entity_type = 'invoice' AND a.entity_id IN (
              SELECT ib.invoice_id::text FROM public.invoice_bls ib WHERE ib.bl_id = p_bl_id))
        OR (a.entity_type = 'system_event' AND a.entity_id = p_bl_id)
      )
    UNION ALL
    -- Gatilho de `bls`: campos que a operação lê, sem repetir a linha
    -- semântica do mesmo campo no mesmo instante.
    SELECT a.id, 'edicao', 'bl', a.field_name, a.old_value, a.new_value, a.changed_by, a.changed_at, a.justification
    FROM public.audit_logs a
    WHERE a.entity_type = 'bls' AND a.entity_id = p_bl_id
      AND a.changed_at IS DISTINCT FROM (SELECT created_at FROM bl_row)
      AND a.field_name IN (
        'shipper', 'shipper_block', 'consignee', 'consignee_block', 'consignee_address', 'consignee_phone',
        'notify_party', 'notify_cnpj_cpf', 'notify_block', 'notify2_block',
        'customer_id', 'manifest_customer_cnpj_cpf', 'manifest_customer_name', 'manifest_customer_email',
        'voyage_id', 'pol', 'pod', 'place_of_delivery', 'place_of_receipt', 'movement_from', 'movement_to',
        'terminal_id', 'manifesto_mercante_id', 'cargo_description', 'ncm_codes',
        'total_weight_kg', 'total_cbm', 'total_packages', 'packages_unit',
        'bb_machine_qty', 'bb_packages_qty', 'bb_packages_total', 'bb_weight_ton', 'bb_cbm',
        'incoterm', 'payment_type', 'ce_mercante', 'bl_emission_date', 'issue_place', 'laden_on_board',
        'container_load_type', 'free_time_override', 'notes')
      AND NOT EXISTS (
        SELECT 1 FROM public.audit_logs s
        WHERE s.entity_type = 'bl' AND s.entity_id = a.entity_id
          AND s.field_name = a.field_name AND s.changed_at = a.changed_at)
    UNION ALL
    -- Rastro de `bl_containers` e `vehicles` do B/L.
    SELECT
      t.id,
      CASE WHEN t.entity_type = 'vehicles' THEN 'veiculo' ELSE 'container' END,
      CASE WHEN t.entity_type = 'vehicles' THEN 'vehicle' ELSE 'bl_container' END,
      t.field_name || '|' || COALESCE(n.label, ''),
      CASE WHEN t.field_name IN ('criado', 'excluido') THEN NULL ELSE t.old_value END,
      CASE WHEN t.field_name IN ('criado', 'excluido') THEN NULL ELSE t.new_value END,
      t.changed_by,
      t.changed_at,
      t.justification
    FROM trail t
    LEFT JOIN names n ON n.entity_type = t.entity_type AND n.id = t.entity_id
    WHERE (
            (t.entity_type = 'bl_containers' AND t.field_name IN (
              'criado', 'excluido', 'bl_id', 'container_number', 'seal_number', 'type',
              'gross_weight_kg', 'tare_weight_kg', 'cbm', 'is_oog', 'is_imo', 'imo_class', 'un_number',
              'discharge_date', 'return_date', 'unpacking_location', 'ownership'))
         OR (t.entity_type = 'vehicles' AND t.field_name IN (
              'criado', 'excluido', 'bl_id', 'chassis', 'brand', 'model', 'weight_kg', 'cbm', 'container_id'))
          )
      -- A transação que cria o B/L vira um só "B/L criado" (133).
      AND NOT (t.field_name = 'criado' AND t.changed_at IS NOT DISTINCT FROM (SELECT created_at FROM bl_row))
      -- Mesma mudança já registrada com motivo pela RPC (079).
      AND NOT EXISTS (
        SELECT 1 FROM public.audit_logs s
        WHERE s.entity_type = 'bl_container' AND s.entity_id = t.entity_id
          AND s.field_name = t.field_name AND s.changed_at = t.changed_at)
      AND NOT (t.field_name = 'ownership' AND EXISTS (
        SELECT 1 FROM public.audit_logs s
        WHERE s.entity_type = 'bl' AND s.entity_id = p_bl_id
          AND s.field_name = 'container_ownership' AND s.changed_at = t.changed_at))
      AND NOT (t.field_name = 'type' AND EXISTS (
        SELECT 1 FROM public.audit_logs s
        WHERE s.entity_type = 'bl' AND s.entity_id = p_bl_id
          AND s.field_name = 'container_profile' AND s.changed_at = t.changed_at))
    UNION ALL
    -- id 0 não colide: audit_logs.id é identity a partir de 1.
    SELECT 0::bigint, 'sistema', 'system_event', 'bl_created', NULL, 'B/L criado', NULL::uuid, r.created_at, NULL
    FROM bl_row r
    WHERE r.created_at IS NOT NULL
  )
  SELECT
    e.id,
    e.family,
    e.entity_type,
    e.field_name,
    public._bl_timeline_value(split_part(e.field_name, '|', 1), e.old_value),
    public._bl_timeline_value(split_part(e.field_name, '|', 1), e.new_value),
    e.changed_by,
    e.changed_at,
    e.justification
  FROM events e
  WHERE public.is_active_read_user()
  ORDER BY e.changed_at DESC, e.id DESC
  LIMIT GREATEST(COALESCE(p_limit, 50), 0)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
$function$;
