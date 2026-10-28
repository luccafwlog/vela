-- 491: Alterar e excluir taxa calculada do B/L (lote 1 do plano
-- `2026-10-28-alterar-taxa-calculada-do-bl`; spec aprovada pelo dono em
-- 2026-10-28; ADR 0111, decisões D1 a D7, D10, D11, D13 e D14).
--
-- Na ficha do B/L, bloco Taxas Locais, qualquer setor altera o valor de uma
-- taxa (por unidade ou pelo total), exclui uma taxa calculada e desfaz cada
-- ação, sempre com justificativa. A alteração é uma decisão do B/L sobre a
-- taxa (`bl_charge_adjustments`), não uma edição da linha: o resolvedor das
-- linhas aplica as alterações ativas, e com isso o cálculo, todo recálculo, a
-- cotação da correção automática, o COD e o Desbloqueio de CE veem o mesmo
-- valor. A alteração só se perde quando a tabela da taxa sai do B/L (POD novo
-- ou modalidade sem aquela tabela; R1) ou passa para a taxa equivalente da
-- tabela nova do mesmo escopo (preço refixado; R2). Cada ação e cada descarte
-- ficam em `bl_charge_adjustment_events` (Histórico das taxas) e em
-- `audit_logs` (aba Histórico do B/L, família Taxas).
--
-- A exclusão de cobrança manual deixa de ser só do Administrativo (supersede
-- a ADR 0071, item 11) e passa a pedir justificativa: nova assinatura
-- `delete_manual_bl_charge(bigint, text, uuid)`; a antiga perde o EXECUTE.
--
-- B/L faturado ainda é recusado aqui; o lote 3 (migration 493) leva a
-- alteração pela correção automática da fatura.
--
-- Não reescreve nem apaga linha existente: só acrescenta tabelas, colunas, a
-- situação `excluded` no CHECK de `charge_calculations` e funções. Sem
-- alteração ativa, o resolvedor devolve exatamente o resultado de antes.
--
-- Rollback: recriar `resolve_bl_local_charge_items`,
-- `_calculate_bl_local_charges_impl_106` (378), `list_bl_local_charge_lines`
-- (369), `update_manual_bl_charge` e `delete_manual_bl_charge` (241, com o
-- GRANT a authenticated) nas definições anteriores; as tabelas novas ficam sem
-- uso.

-- 1. Dados -------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.bl_charge_adjustments (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  bl_id text NOT NULL REFERENCES public.bls(id) ON DELETE CASCADE,
  -- Chave da linha do cálculo: `auto:item:<item>`, `auto:item:<item>:imo_oog`
  -- ou a chave da cobrança manual.
  line_key text NOT NULL,
  source text NOT NULL CHECK (source IN ('auto', 'manual')),
  -- Sem FK: o item e a tabela podem ser excluídos do cadastro; a alteração
  -- fica dormente e o histórico guarda o nome.
  charge_item_id bigint,
  charge_table_id bigint,
  scope text,
  pod_key text,
  -- Assinatura da taxa para o remapeamento do R2.
  charge_name text NOT NULL,
  application_basis text,
  cargo_profile text,
  currency text NOT NULL CHECK (currency IN ('BRL', 'USD')),
  kind text NOT NULL CHECK (kind IN ('unit', 'total', 'excluded')),
  value numeric(14,2),
  reference_quantity numeric(12,6),
  justification text NOT NULL CHECK (length(btrim(justification)) >= 10),
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  ended_by uuid REFERENCES auth.users(id),
  end_reason text CHECK (end_reason IN ('replaced', 'restored', 'reincluded', 'discarded', 'remapped', 'line_deleted')),
  end_justification text,
  CONSTRAINT bl_charge_adjustments_value_check CHECK (
    (kind = 'excluded' AND value IS NULL) OR (kind <> 'excluded' AND value > 0)),
  CONSTRAINT bl_charge_adjustments_manual_check CHECK (source = 'auto' OR kind <> 'excluded'),
  CONSTRAINT bl_charge_adjustments_end_check CHECK ((ended_at IS NULL) = (end_reason IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_bl_charge_adjustments_active
  ON public.bl_charge_adjustments (bl_id, line_key) WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_bl_charge_adjustments_bl
  ON public.bl_charge_adjustments (bl_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bl_charge_adjustments_created_by ON public.bl_charge_adjustments (created_by);
CREATE INDEX IF NOT EXISTS idx_bl_charge_adjustments_ended_by ON public.bl_charge_adjustments (ended_by);

CREATE TABLE IF NOT EXISTS public.bl_charge_adjustment_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  bl_id text NOT NULL REFERENCES public.bls(id) ON DELETE CASCADE,
  adjustment_id bigint REFERENCES public.bl_charge_adjustments(id) ON DELETE SET NULL,
  event text NOT NULL CHECK (event IN (
    'altered', 'excluded', 'restored', 'reincluded', 'manual_deleted',
    'exempted', 'exemption_removed', 'discarded', 'quantity_changed', 'remapped')),
  line_key text,
  charge_name text,
  before jsonb,
  after jsonb,
  justification text,
  -- Nulo: o Sistema (recálculo, descarte, remapeamento).
  actor uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  -- O que a correção da fatura fez (lote 3).
  invoice_effect jsonb
);
CREATE INDEX IF NOT EXISTS idx_bl_charge_adjustment_events_bl
  ON public.bl_charge_adjustment_events (bl_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_bl_charge_adjustment_events_adjustment ON public.bl_charge_adjustment_events (adjustment_id);
CREATE INDEX IF NOT EXISTS idx_bl_charge_adjustment_events_actor ON public.bl_charge_adjustment_events (actor);

-- Leitura interna; nenhuma escrita direta pela API (só pelas RPCs abaixo).
ALTER TABLE public.bl_charge_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bl_charge_adjustment_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bl_charge_adjustments_select_read ON public.bl_charge_adjustments;
CREATE POLICY bl_charge_adjustments_select_read ON public.bl_charge_adjustments
  FOR SELECT TO authenticated USING ((SELECT public.is_active_read_user()));
DROP POLICY IF EXISTS bl_charge_adjustment_events_select_read ON public.bl_charge_adjustment_events;
CREATE POLICY bl_charge_adjustment_events_select_read ON public.bl_charge_adjustment_events
  FOR SELECT TO authenticated USING ((SELECT public.is_active_read_user()));
REVOKE ALL ON TABLE public.bl_charge_adjustments, public.bl_charge_adjustment_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.bl_charge_adjustments, public.bl_charge_adjustment_events TO authenticated;
GRANT ALL ON TABLE public.bl_charge_adjustments, public.bl_charge_adjustment_events TO service_role;

-- A linha guarda a alteração aplicada e o valor da tabela, para a tela.
ALTER TABLE public.charge_calculations
  ADD COLUMN IF NOT EXISTS adjustment_id bigint REFERENCES public.bl_charge_adjustments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS table_unit_value_brl numeric(12,2),
  ADD COLUMN IF NOT EXISTS table_unit_value_usd numeric(12,2),
  ADD COLUMN IF NOT EXISTS table_total_value_brl numeric(14,2),
  ADD COLUMN IF NOT EXISTS table_total_value_usd numeric(14,2);
CREATE INDEX IF NOT EXISTS idx_charge_calculations_adjustment_id
  ON public.charge_calculations (adjustment_id) WHERE adjustment_id IS NOT NULL;

-- Taxa excluída: continua na ficha, riscada, com total zero. Toda leitura que
-- soma totais ou filtra as situações cobradas segue certa sem mudar.
ALTER TABLE public.charge_calculations DROP CONSTRAINT IF EXISTS charge_calculations_status_check;
ALTER TABLE public.charge_calculations ADD CONSTRAINT charge_calculations_status_check
  CHECK (status = ANY (ARRAY['calculated'::text, 'review_required'::text, 'reviewed'::text,
    'ready_for_billing'::text, 'exempt'::text, 'excluded'::text]));

-- 2. Histórico das taxas -----------------------------------------------------

-- Um evento vai para o Histórico das taxas e, com o mesmo conteúdo, para a aba
-- Histórico do B/L (família Taxas: `charge_calculation` com `bl_id`, 470).
CREATE OR REPLACE FUNCTION public._record_bl_charge_event(
  p_bl_id text, p_adjustment_id bigint, p_event text, p_line_key text, p_charge_name text,
  p_before jsonb, p_after jsonb, p_justification text, p_actor uuid, p_invoice_effect jsonb DEFAULT NULL)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_id bigint;
BEGIN
  INSERT INTO public.bl_charge_adjustment_events (
    bl_id, adjustment_id, event, line_key, charge_name, before, after, justification, actor, invoice_effect)
  VALUES (p_bl_id, p_adjustment_id, p_event, p_line_key, p_charge_name, p_before, p_after,
    NULLIF(btrim(COALESCE(p_justification, '')), ''), p_actor, p_invoice_effect)
  RETURNING id INTO v_id;

  INSERT INTO public.audit_logs (
    entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification, bl_id)
  VALUES (
    'charge_calculation', concat('adjustment-event:', v_id), 'charge_adjustment', NULL,
    jsonb_build_object('event', p_event, 'charge_name', p_charge_name, 'line_key', p_line_key,
      'before', p_before, 'after', p_after, 'invoice_effect', p_invoice_effect)::text,
    p_actor, now(), NULLIF(btrim(COALESCE(p_justification, '')), ''), p_bl_id);
  RETURN v_id;
END;
$function$;
REVOKE ALL ON FUNCTION public._record_bl_charge_event(text, bigint, text, text, text, jsonb, jsonb, text, uuid, jsonb) FROM PUBLIC, anon, authenticated;

-- 3. Descarte, remapeamento e quantidade -------------------------------------

-- R1/R2 (aprovados pelo dono no plano): a alteração cuja tabela saiu do B/L é
-- descartada; com POD igual e tabela nova no mesmo escopo (preço refixado),
-- passa para a taxa de mesmo nome, incidência, perfil e moeda da tabela nova.
-- Roda no cálculo, depois do vínculo das tabelas (ADR 0093, decisão 1).
CREATE OR REPLACE FUNCTION public._reconcile_bl_charge_adjustments(p_bl_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bl record;
  a record;
  v_link bigint;
  v_old_table text;
  v_new_table record;
  v_new_item bigint;
  v_new_id bigint;
  v_reason text;
BEGIN
  SELECT b.id, b.pod, COALESCE(b.cargo_mode, 'container') AS cargo_mode,
         public.normalize_port_code(b.pod) AS pod_key
  INTO v_bl FROM public.bls b WHERE b.id = p_bl_id;
  IF NOT FOUND THEN RETURN; END IF;

  -- Cobrança manual apagada fora das RPCs (cancelamento do B/L): a alteração
  -- dela encerra sem evento; a cobrança manual se perde no cancelamento (D14.4).
  UPDATE public.bl_charge_adjustments m
     SET ended_at = now(), end_reason = 'line_deleted'
   WHERE m.bl_id = p_bl_id AND m.ended_at IS NULL AND m.source = 'manual'
     AND NOT EXISTS (SELECT 1 FROM public.charge_calculations cc
                      WHERE cc.bl_id = m.bl_id AND cc.calculation_key = m.line_key);

  FOR a IN
    SELECT * FROM public.bl_charge_adjustments x
    WHERE x.bl_id = p_bl_id AND x.ended_at IS NULL AND x.source = 'auto'
    ORDER BY x.id
    FOR UPDATE
  LOOP
    v_link := NULL;
    SELECT l.charge_table_id INTO v_link
      FROM public.bl_charge_table_links l WHERE l.bl_id = p_bl_id AND l.scope = a.scope;
    IF v_link IS NOT DISTINCT FROM a.charge_table_id AND a.pod_key IS NOT DISTINCT FROM v_bl.pod_key THEN
      CONTINUE;
    END IF;

    SELECT ct.name INTO v_old_table FROM public.charge_tables ct WHERE ct.id = a.charge_table_id;
    v_new_table := NULL;
    SELECT ct.id, ct.name, ct.pod INTO v_new_table FROM public.charge_tables ct WHERE ct.id = v_link;
    v_new_item := NULL;
    IF a.pod_key IS NOT DISTINCT FROM v_bl.pod_key AND v_link IS NOT NULL THEN
      SELECT cti.id INTO v_new_item
        FROM public.charge_table_items cti
       WHERE cti.charge_table_id = v_link
         AND COALESCE(cti.active, true) AND NOT COALESCE(cti.manual_only, false)
         AND upper(btrim(cti.name)) = upper(btrim(a.charge_name))
         AND cti.application_basis IS NOT DISTINCT FROM a.application_basis
         AND COALESCE(cti.cargo_profile, 'any') = COALESCE(a.cargo_profile, 'any')
         AND COALESCE(cti.currency, 'BRL') = a.currency
       ORDER BY COALESCE(cti.sort_order, 100), cti.id
       LIMIT 1;
    END IF;

    UPDATE public.bl_charge_adjustments
       SET ended_at = now(), end_reason = CASE WHEN v_new_item IS NULL THEN 'discarded' ELSE 'remapped' END
     WHERE id = a.id;

    IF v_new_item IS NOT NULL THEN
      INSERT INTO public.bl_charge_adjustments (
        bl_id, line_key, source, charge_item_id, charge_table_id, scope, pod_key, charge_name,
        application_basis, cargo_profile, currency, kind, value, reference_quantity,
        justification, created_by, created_at)
      VALUES (
        a.bl_id,
        concat('auto:item:', v_new_item, CASE WHEN a.line_key LIKE '%:imo_oog' THEN ':imo_oog' ELSE '' END),
        a.source, v_new_item, v_link, a.scope, a.pod_key, a.charge_name,
        a.application_basis, a.cargo_profile, a.currency, a.kind, a.value, a.reference_quantity,
        a.justification, a.created_by, a.created_at)
      RETURNING id INTO v_new_id;
      PERFORM public._record_bl_charge_event(p_bl_id, v_new_id, 'remapped', a.line_key, a.charge_name,
        jsonb_build_object('table_name', v_old_table),
        jsonb_build_object('table_name', v_new_table.name, 'pod', v_new_table.pod),
        NULL, NULL);
    ELSE
      v_reason := CASE
        WHEN a.pod_key IS DISTINCT FROM v_bl.pod_key THEN 'pod'
        WHEN v_link IS NULL THEN 'modalidade'
        ELSE 'tabela' END;
      PERFORM public._record_bl_charge_event(p_bl_id, a.id, 'discarded', a.line_key, a.charge_name,
        jsonb_build_object('kind', a.kind, 'value', a.value, 'currency', a.currency, 'basis', a.application_basis,
          'table_name', v_old_table),
        jsonb_build_object('reason', v_reason, 'table_name', v_new_table.name, 'pod', v_bl.pod,
          'cargo_mode', v_bl.cargo_mode),
        NULL, NULL);
    END IF;
  END LOOP;
END;
$function$;
REVOKE ALL ON FUNCTION public._reconcile_bl_charge_adjustments(text) FROM PUBLIC, anon, authenticated;

-- D7: o valor total alterado se mantém quando a quantidade muda; a mudança
-- fica no Histórico das taxas. A quantidade de referência acompanha o B/L.
CREATE OR REPLACE FUNCTION public._track_bl_charge_adjustment_quantities(p_bl_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT a.id, a.kind, a.value, a.currency, a.line_key, a.charge_name, a.reference_quantity, cc.quantity
      FROM public.bl_charge_adjustments a
      JOIN public.charge_calculations cc
        ON cc.bl_id = a.bl_id AND cc.calculation_key = a.line_key AND cc.adjustment_id = a.id
     WHERE a.bl_id = p_bl_id AND a.ended_at IS NULL AND a.kind IN ('unit', 'total')
       AND a.reference_quantity IS DISTINCT FROM cc.quantity
     ORDER BY a.id
  LOOP
    IF r.kind = 'total' AND r.reference_quantity IS NOT NULL THEN
      PERFORM public._record_bl_charge_event(p_bl_id, r.id, 'quantity_changed', r.line_key, r.charge_name,
        jsonb_build_object('quantity', r.reference_quantity),
        jsonb_build_object('quantity', r.quantity, 'total', r.value, 'currency', r.currency),
        NULL, NULL);
    END IF;
    UPDATE public.bl_charge_adjustments SET reference_quantity = r.quantity WHERE id = r.id;
  END LOOP;
END;
$function$;
REVOKE ALL ON FUNCTION public._track_bl_charge_adjustment_quantities(text) FROM PUBLIC, anon, authenticated;

-- 4. Resolvedor ---------------------------------------------------------------

-- O corpo da 470 continua igual, agora como as linhas pela tabela.
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
      notes := 'Revisao manual obrigatoria';

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
REVOKE ALL ON FUNCTION public._resolve_bl_local_charge_items_table(text, text) FROM PUBLIC, anon, authenticated;

-- As linhas com o valor cobrado: a alteração à mão ativa da taxa (por
-- unidade, total ou excluída) e, ao lado, o valor da tabela. A alteração só
-- vale para a linha calculada da mesma taxa, na mesma moeda e com o POD de
-- quando foi feita; linha em revisão ou item desativado deixam a alteração
-- dormente (spec, casos de borda).
-- ponytail: a alteração por unidade arredonda o total no B/L (quantidade ×
-- valor), não container a container; o rateio do container compartilhado que
-- fecha o valor cheio entre os B/Ls irmãos só vale para as linhas não
-- alteradas.
CREATE OR REPLACE FUNCTION public._resolve_bl_local_charge_items_charged(p_bl_id text, p_pod text)
 RETURNS TABLE(charge_table_id bigint, charge_item_id bigint, quantity numeric, unit_value_brl numeric,
   unit_value_usd numeric, total_value_brl numeric, total_value_usd numeric, override_applied boolean,
   source text, status text, calculation_key text, review_reason text, notes text,
   table_unit_value_brl numeric, table_unit_value_usd numeric, table_total_value_brl numeric,
   table_total_value_usd numeric, adjustment_id bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH bl AS (
    SELECT public.normalize_port_code(b.pod) AS pod_key FROM public.bls b WHERE b.id = p_bl_id
  ),
  r AS (
    SELECT t.*, (t.unit_value_usd IS NOT NULL OR t.total_value_usd IS NOT NULL) AS is_usd,
           row_number() OVER () AS ord
    FROM public._resolve_bl_local_charge_items_table(p_bl_id, p_pod) t
  )
  SELECT
    r.charge_table_id, r.charge_item_id, r.quantity,
    CASE WHEN a.id IS NULL OR r.is_usd THEN r.unit_value_brl ELSE v.unit END,
    CASE WHEN a.id IS NULL OR NOT r.is_usd THEN r.unit_value_usd ELSE v.unit END,
    CASE WHEN a.id IS NULL OR r.is_usd THEN r.total_value_brl ELSE v.total END,
    CASE WHEN a.id IS NULL OR NOT r.is_usd THEN r.total_value_usd ELSE v.total END,
    r.override_applied, r.source,
    CASE WHEN a.kind = 'excluded' THEN 'excluded' ELSE r.status END,
    r.calculation_key, r.review_reason, r.notes,
    r.unit_value_brl, r.unit_value_usd, r.total_value_brl, r.total_value_usd,
    a.id
  FROM r
  LEFT JOIN LATERAL (
    SELECT x.id, x.kind, x.value
    FROM public.bl_charge_adjustments x
    WHERE x.bl_id = p_bl_id AND x.ended_at IS NULL AND x.source = 'auto'
      AND r.status = 'calculated'
      AND x.line_key = r.calculation_key
      AND x.charge_item_id = r.charge_item_id
      AND x.pod_key IS NOT DISTINCT FROM (SELECT bl.pod_key FROM bl)
      AND (x.currency = 'USD') = r.is_usd
    LIMIT 1
  ) a ON true
  LEFT JOIN LATERAL (
    SELECT
      CASE a.kind
        WHEN 'unit' THEN a.value
        WHEN 'total' THEN round(a.value / NULLIF(r.quantity, 0), 2)
        ELSE CASE WHEN r.is_usd THEN r.unit_value_usd ELSE r.unit_value_brl END
      END AS unit,
      CASE a.kind
        WHEN 'unit' THEN round(r.quantity * a.value, 2)
        WHEN 'total' THEN a.value
        ELSE 0::numeric
      END AS total
  ) v ON true
  ORDER BY r.ord;
$function$;
REVOKE ALL ON FUNCTION public._resolve_bl_local_charge_items_charged(text, text) FROM PUBLIC, anon, authenticated;

-- Mesma assinatura de sempre, agora com o valor cobrado: a cotação da correção
-- (`_quote_bl_local_charges`), o COD e o Desbloqueio de CE leem por aqui.
CREATE OR REPLACE FUNCTION public.resolve_bl_local_charge_items(p_bl_id text, p_pod text)
 RETURNS TABLE(charge_table_id bigint, charge_item_id bigint, quantity numeric, unit_value_brl numeric, unit_value_usd numeric, total_value_brl numeric, total_value_usd numeric, override_applied boolean, source text, status text, calculation_key text, review_reason text, notes text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT c.charge_table_id, c.charge_item_id, c.quantity, c.unit_value_brl, c.unit_value_usd,
         c.total_value_brl, c.total_value_usd, c.override_applied, c.source, c.status,
         c.calculation_key, c.review_reason, c.notes
  FROM public._resolve_bl_local_charge_items_charged(p_bl_id, p_pod) c;
$function$;
REVOKE ALL ON FUNCTION public.resolve_bl_local_charge_items(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_bl_local_charge_items(text, text) TO service_role;

-- 5. Cálculo -----------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._calculate_bl_local_charges_impl_106(p_bl_id text, p_actor uuid DEFAULT NULL::uuid, p_recalculate boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
    b.financial_status,
    b.cancelled_at
  INTO v_bl
  FROM public.bls AS b
  WHERE b.id = p_bl_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L % nao encontrado', p_bl_id USING ERRCODE = 'P0002';
  END IF;

  -- F-28 (372): B/L cancelado é somente leitura também para o cálculo.
  IF v_bl.cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION 'B/L % cancelado e somente leitura; reative o B/L para calcular.', p_bl_id USING ERRCODE = '22023';
  END IF;

  IF v_bl.financial_status IN ('invoiced', 'partially_paid', 'paid') THEN
    RAISE EXCEPTION 'B/L % ja foi faturado (status financeiro=%): o recálculo manual não altera a fatura. Corrija os dados do B/L, que a fatura é corrigida automaticamente.', p_bl_id, v_bl.financial_status USING ERRCODE = '22023';
  END IF;

  v_actor := COALESCE(p_actor, auth.uid());

  -- ADR 0093, decisão 1: o cálculo usa e grava a tabela vinculada ao B/L.
  PERFORM public.bind_bl_local_charge_tables(p_bl_id);
  -- ADR 0094: o preço (tabela, Condição, data e câmbio) fica fixo no primeiro
  -- cálculo; itens de tabela vinculada depois entram com a data e o câmbio dele.
  PERFORM public.freeze_bl_prices(p_bl_id);
  -- ADR 0093, decisão 3: a base deste cálculo, para a emissão saber se ainda vale.
  INSERT INTO public.bl_charge_calculation_basis (bl_id, basis, calculated_at)
  VALUES (p_bl_id, public.bl_invoice_basis_snapshot(p_bl_id), now())
  ON CONFLICT (bl_id) DO UPDATE SET basis = EXCLUDED.basis, calculated_at = EXCLUDED.calculated_at;
  -- 491 (ADR 0111): alteração à mão cuja tabela saiu do B/L é descartada (POD
  -- novo, modalidade sem aquela tabela) ou passa para a tabela nova do mesmo
  -- escopo (preço refixado), com evento no Histórico das taxas.
  PERFORM public._reconcile_bl_charge_adjustments(p_bl_id);

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

    -- F-26 (372): o B/L que ficou isento anula o recebível em aberto.
    PERFORM public.sync_local_charge_receivable(p_bl_id);

    RETURN jsonb_build_object(
      'bl_id', p_bl_id, 'status', 'exempt', 'table_id', NULL,
      'line_count', 1, 'total_brl', 0, 'total_usd', 0,
      'review_required', false, 'exempt', true, 'reason', v_reason
    );
  END IF;

  -- Checagem de B/L de container sem containers
  IF v_bl.cargo_mode IN ('container', 'misto') THEN
    SELECT COUNT(*)
    INTO v_qty_dual
    FROM (
      SELECT 1 FROM public.bl_containers bc
      WHERE bc.bl_id = p_bl_id AND COALESCE(bc.is_imo, false) AND COALESCE(bc.is_oog, false)
    ) s;

    -- IMO e OOG ao mesmo tempo é cobrado pelo motor (THD normal + 150%, migration 129).

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
  -- 491: as linhas já vêm com as alterações à mão aplicadas e com o valor da
  -- tabela ao lado, para a tela.
  FOR item IN SELECT * FROM public._resolve_bl_local_charge_items_charged(p_bl_id, v_bl.pod) LOOP
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
        created_by, calculated_at,
        adjustment_id, table_unit_value_brl, table_unit_value_usd, table_total_value_brl, table_total_value_usd
      )
      VALUES (
        p_bl_id, item.charge_table_id, item.charge_item_id, item.quantity,
        item.unit_value_brl, item.unit_value_usd, item.total_value_brl, item.total_value_usd,
        item.override_applied, item.source, item.status, item.calculation_key,
        v_actor, NOW(),
        item.adjustment_id, item.table_unit_value_brl, item.table_unit_value_usd, item.table_total_value_brl, item.table_total_value_usd
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
            calculated_at = NOW(),
            adjustment_id = EXCLUDED.adjustment_id,
            table_unit_value_brl = EXCLUDED.table_unit_value_brl,
            table_unit_value_usd = EXCLUDED.table_unit_value_usd,
            table_total_value_brl = EXCLUDED.table_total_value_brl,
            table_total_value_usd = EXCLUDED.table_total_value_usd;
    END IF;
  END LOOP;

  -- 491 (D7): taxa com valor total alterado cuja quantidade mudou mantém o
  -- total e ganha o evento no Histórico das taxas.
  PERFORM public._track_bl_charge_adjustment_quantities(p_bl_id);

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
$function$;
REVOKE ALL ON FUNCTION public._calculate_bl_local_charges_impl_106(text, uuid, boolean) FROM PUBLIC, anon, authenticated;

-- 6. Ações do bloco Taxas Locais --------------------------------------------

-- Regras comuns às ações: usuário interno ativo e autor = quem está logado
-- (D3), justificativa de ao menos 10 caracteres (D4), B/L e Viagem não
-- cancelados (D14.4 e D14.7). O B/L fica travado até o fim da transação.
CREATE OR REPLACE FUNCTION public._lock_bl_for_charge_change(p_bl_id text, p_justification text, p_actor uuid)
 RETURNS public.bls
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bl public.bls;
  v_voyage text;
BEGIN
  PERFORM public._assert_actor_is_caller(p_actor);
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Somente usuário interno ativo altera as taxas do B/L.' USING ERRCODE = '42501';
  END IF;
  IF length(btrim(COALESCE(p_justification, ''))) < 10 THEN
    RAISE EXCEPTION 'Justificativa obrigatória: escreva ao menos 10 caracteres.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_bl FROM public.bls b WHERE b.id = upper(btrim(COALESCE(p_bl_id, ''))) FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L % não encontrado.', p_bl_id USING ERRCODE = 'P0002';
  END IF;
  IF v_bl.cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION 'B/L % cancelado e somente leitura; reative o B/L para alterar as taxas.', v_bl.id USING ERRCODE = '22023';
  END IF;
  SELECT COALESCE(NULLIF(btrim(v.voyage_number), ''), v.id::text) INTO v_voyage
    FROM public.voyages v WHERE v.id = v_bl.voyage_id AND v.status = 'cancelled';
  IF FOUND THEN
    RAISE EXCEPTION 'Viagem % cancelada: operação selada e somente leitura.', v_voyage USING ERRCODE = '42501';
  END IF;
  -- Lote 3 (migration 493) leva a alteração pela correção automática da fatura.
  IF COALESCE(v_bl.financial_status, 'pending') IN ('invoiced', 'partially_paid', 'paid') THEN
    RAISE EXCEPTION 'B/L faturado: a alteração na fatura entra no lote seguinte.' USING ERRCODE = '22023';
  END IF;
  RETURN v_bl;
END;
$function$;
REVOKE ALL ON FUNCTION public._lock_bl_for_charge_change(text, text, uuid) FROM PUBLIC, anon, authenticated;

-- A linha da taxa no cálculo atual do B/L, com o que a tela e o histórico
-- precisam: nome, incidência, perfil, moeda, escopo e os valores cobrados.
CREATE OR REPLACE FUNCTION public._bl_charge_line_for_change(p_bl_id text, p_line_key text)
 RETURNS TABLE(id bigint, source text, status text, charge_item_id bigint, charge_table_id bigint,
   charge_name text, application_basis text, cargo_profile text, currency text, scope text,
   quantity numeric, unit_value numeric, total_value numeric, table_unit_value numeric,
   table_total_value numeric, adjustment_id bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT cc.id, cc.source, cc.status, cc.charge_item_id, cc.charge_table_id,
         COALESCE(cti.name, '[Sistema]'), cti.application_basis, COALESCE(cti.cargo_profile, 'any'),
         x.currency, ct.cargo_mode, cc.quantity,
         CASE WHEN x.currency = 'USD' THEN cc.unit_value_usd ELSE cc.unit_value_brl END,
         CASE WHEN x.currency = 'USD' THEN cc.total_value_usd ELSE cc.total_value_brl END,
         CASE WHEN x.currency = 'USD' THEN COALESCE(cc.table_unit_value_usd, cc.unit_value_usd)
              ELSE COALESCE(cc.table_unit_value_brl, cc.unit_value_brl) END,
         CASE WHEN x.currency = 'USD' THEN COALESCE(cc.table_total_value_usd, cc.total_value_usd)
              ELSE COALESCE(cc.table_total_value_brl, cc.total_value_brl) END,
         cc.adjustment_id
  FROM public.charge_calculations cc
  LEFT JOIN public.charge_table_items cti ON cti.id = cc.charge_item_id
  LEFT JOIN public.charge_tables ct ON ct.id = cc.charge_table_id
  CROSS JOIN LATERAL (SELECT upper(COALESCE(cti.currency,
    CASE WHEN cc.unit_value_usd IS NOT NULL OR cc.total_value_usd IS NOT NULL THEN 'USD' ELSE 'BRL' END)) AS currency) x
  WHERE cc.bl_id = p_bl_id AND cc.calculation_key = p_line_key;
$function$;
REVOKE ALL ON FUNCTION public._bl_charge_line_for_change(text, text) FROM PUBLIC, anon, authenticated;

-- D12: só há um caminho para não cobrar nada (Isentar Taxas Locais).
CREATE OR REPLACE FUNCTION public._assert_bl_keeps_a_charge(p_bl_id text, p_leaving_line_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.charge_calculations cc
    WHERE cc.bl_id = p_bl_id AND cc.id <> p_leaving_line_id
      AND COALESCE(cc.status, 'calculated') IN ('calculated', 'reviewed', 'ready_for_billing')
  ) THEN
    RAISE EXCEPTION 'Esta é a última taxa cobrada do B/L. Para não cobrar nada, use Isentar Taxas Locais.' USING ERRCODE = '22023';
  END IF;
END;
$function$;
REVOKE ALL ON FUNCTION public._assert_bl_keeps_a_charge(text, bigint) FROM PUBLIC, anon, authenticated;

-- Linha que a ação pode tocar: existe no cálculo, tem taxa e não está em revisão.
CREATE OR REPLACE FUNCTION public._assert_bl_charge_line_changeable(p_found boolean, p_status text, p_charge_item_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT p_found OR p_charge_item_id IS NULL THEN
    RAISE EXCEPTION 'Esta taxa não está mais no cálculo do B/L; atualize a página.' USING ERRCODE = 'P0002';
  END IF;
  IF p_status = 'review_required' THEN
    RAISE EXCEPTION 'Taxa em revisão não se altera: corrija o B/L e recalcule.' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(p_status, 'calculated') NOT IN ('calculated', 'reviewed', 'ready_for_billing', 'excluded') THEN
    RAISE EXCEPTION 'Esta taxa não se altera na situação atual do B/L; atualize a página.' USING ERRCODE = '22023';
  END IF;
END;
$function$;
REVOKE ALL ON FUNCTION public._assert_bl_charge_line_changeable(boolean, text, bigint) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._bl_charge_value_snapshot(p_kind text, p_unit numeric, p_total numeric,
  p_quantity numeric, p_currency text, p_basis text)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT jsonb_build_object('kind', p_kind, 'unit', p_unit, 'total', p_total, 'quantity', p_quantity,
    'currency', p_currency, 'basis', p_basis);
$function$;
REVOKE ALL ON FUNCTION public._bl_charge_value_snapshot(text, numeric, numeric, numeric, text, text) FROM PUBLIC, anon, authenticated;

-- Alterar valor da taxa (D2): por unidade (total = quantidade × valor) ou pelo
-- total (Unitário = total ÷ quantidade, arredondado), na moeda da taxa.
CREATE OR REPLACE FUNCTION public.alter_bl_charge_value(
  p_bl_id text, p_line_key text, p_kind text, p_value numeric, p_justification text, p_actor uuid DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bl public.bls;
  v_line record;
  v_found boolean;
  v_adj public.bl_charge_adjustments;
  v_kind text := lower(btrim(COALESCE(p_kind, '')));
  v_value numeric(14,2);
  v_justification text := btrim(COALESCE(p_justification, ''));
  v_new_id bigint;
  v_after record;
BEGIN
  v_bl := public._lock_bl_for_charge_change(p_bl_id, p_justification, p_actor);
  IF v_kind NOT IN ('unit', 'total') THEN
    RAISE EXCEPTION 'Escolha Por unidade ou Total da taxa.' USING ERRCODE = '22023';
  END IF;
  v_value := round(p_value, 2);
  IF v_value IS NULL OR v_value <= 0 THEN
    RAISE EXCEPTION 'Informe um valor maior que zero. Para não cobrar a taxa, use Excluir taxa.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_line FROM public._bl_charge_line_for_change(v_bl.id, p_line_key);
  v_found := FOUND;
  PERFORM public._assert_bl_charge_line_changeable(v_found, v_line.status, v_line.charge_item_id);
  IF v_line.status = 'excluded' THEN
    RAISE EXCEPTION 'Taxa excluída: use Incluir taxa de novo antes de alterar o valor.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_adj FROM public.bl_charge_adjustments a
   WHERE a.bl_id = v_bl.id AND a.line_key = p_line_key AND a.ended_at IS NULL FOR UPDATE;
  IF (v_kind = 'unit' AND v_value = v_line.unit_value AND COALESCE(v_adj.kind, 'unit') = 'unit')
     OR (v_kind = 'total' AND v_value = v_line.total_value AND (v_adj.id IS NULL OR v_adj.kind = 'total')) THEN
    RAISE EXCEPTION 'O valor é igual ao atual: nada a alterar.' USING ERRCODE = '22023';
  END IF;

  IF v_adj.id IS NOT NULL THEN
    UPDATE public.bl_charge_adjustments
       SET ended_at = now(), ended_by = auth.uid(), end_reason = 'replaced', end_justification = v_justification
     WHERE id = v_adj.id;
  END IF;
  INSERT INTO public.bl_charge_adjustments (
    bl_id, line_key, source, charge_item_id, charge_table_id, scope, pod_key, charge_name,
    application_basis, cargo_profile, currency, kind, value, reference_quantity, justification, created_by)
  VALUES (
    v_bl.id, p_line_key, v_line.source, v_line.charge_item_id, v_line.charge_table_id, v_line.scope,
    public.normalize_port_code(v_bl.pod), v_line.charge_name, v_line.application_basis, v_line.cargo_profile,
    v_line.currency, v_kind, v_value, v_line.quantity, v_justification, auth.uid())
  RETURNING id INTO v_new_id;

  IF v_line.source = 'manual' THEN
    -- A cobrança manual sobrevive ao recálculo: o valor cobrado fica na própria
    -- linha, e o da tabela (o do lançamento) nas colunas novas.
    UPDATE public.charge_calculations cc
       SET table_unit_value_brl = CASE WHEN v_line.currency = 'USD' THEN NULL ELSE COALESCE(cc.table_unit_value_brl, cc.unit_value_brl) END,
           table_unit_value_usd = CASE WHEN v_line.currency = 'USD' THEN COALESCE(cc.table_unit_value_usd, cc.unit_value_usd) END,
           table_total_value_brl = CASE WHEN v_line.currency = 'USD' THEN NULL ELSE round(cc.quantity * COALESCE(cc.table_unit_value_brl, cc.unit_value_brl, 0), 2) END,
           table_total_value_usd = CASE WHEN v_line.currency = 'USD' THEN round(cc.quantity * COALESCE(cc.table_unit_value_usd, cc.unit_value_usd, 0), 2) END,
           unit_value_brl = CASE WHEN v_line.currency = 'USD' THEN NULL
             WHEN v_kind = 'unit' THEN v_value ELSE round(v_value / NULLIF(cc.quantity, 0), 2) END,
           unit_value_usd = CASE WHEN v_line.currency <> 'USD' THEN NULL
             WHEN v_kind = 'unit' THEN v_value ELSE round(v_value / NULLIF(cc.quantity, 0), 2) END,
           total_value_brl = CASE WHEN v_line.currency = 'USD' THEN NULL
             WHEN v_kind = 'unit' THEN round(cc.quantity * v_value, 2) ELSE v_value END,
           total_value_usd = CASE WHEN v_line.currency <> 'USD' THEN NULL
             WHEN v_kind = 'unit' THEN round(cc.quantity * v_value, 2) ELSE v_value END,
           adjustment_id = v_new_id,
           calculated_at = now()
     WHERE cc.id = v_line.id;
  ELSE
    PERFORM public._calculate_bl_local_charges_impl_106(v_bl.id, auth.uid(), true);
  END IF;

  SELECT * INTO v_after FROM public._bl_charge_line_for_change(v_bl.id, p_line_key);
  PERFORM public._record_bl_charge_event(v_bl.id, v_new_id, 'altered', p_line_key, v_line.charge_name,
    public._bl_charge_value_snapshot(COALESCE(v_adj.kind, 'table'), v_line.unit_value, v_line.total_value,
      v_line.quantity, v_line.currency, v_line.application_basis),
    public._bl_charge_value_snapshot(v_kind, v_after.unit_value, v_after.total_value, v_after.quantity,
      v_line.currency, v_line.application_basis),
    v_justification, auth.uid());

  RETURN jsonb_build_object('bl_id', v_bl.id, 'line_key', p_line_key, 'adjustment_id', v_new_id,
    'kind', v_kind, 'currency', v_line.currency, 'unit_value', v_after.unit_value,
    'total_value', v_after.total_value, 'applied', v_after.adjustment_id IS NOT DISTINCT FROM v_new_id);
END;
$function$;
REVOKE ALL ON FUNCTION public.alter_bl_charge_value(text, text, text, numeric, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.alter_bl_charge_value(text, text, text, numeric, text, uuid) TO authenticated;

-- Excluir taxa (D2): a linha calculada fica na ficha, riscada, com total zero.
-- A cobrança manual se exclui pela `delete_manual_bl_charge`.
CREATE OR REPLACE FUNCTION public.exclude_bl_charge(
  p_bl_id text, p_line_key text, p_justification text, p_actor uuid DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bl public.bls;
  v_line record;
  v_found boolean;
  v_adj public.bl_charge_adjustments;
  v_justification text := btrim(COALESCE(p_justification, ''));
  v_new_id bigint;
BEGIN
  v_bl := public._lock_bl_for_charge_change(p_bl_id, p_justification, p_actor);
  SELECT * INTO v_line FROM public._bl_charge_line_for_change(v_bl.id, p_line_key);
  v_found := FOUND;
  PERFORM public._assert_bl_charge_line_changeable(v_found, v_line.status, v_line.charge_item_id);
  IF v_line.source = 'manual' THEN
    RAISE EXCEPTION 'Cobrança manual sai com Excluir cobrança manual.' USING ERRCODE = '22023';
  END IF;
  IF v_line.status = 'excluded' THEN
    RAISE EXCEPTION 'A taxa já está excluída da cobrança.' USING ERRCODE = '22023';
  END IF;
  PERFORM public._assert_bl_keeps_a_charge(v_bl.id, v_line.id);

  SELECT * INTO v_adj FROM public.bl_charge_adjustments a
   WHERE a.bl_id = v_bl.id AND a.line_key = p_line_key AND a.ended_at IS NULL FOR UPDATE;
  IF v_adj.id IS NOT NULL THEN
    UPDATE public.bl_charge_adjustments
       SET ended_at = now(), ended_by = auth.uid(), end_reason = 'replaced', end_justification = v_justification
     WHERE id = v_adj.id;
  END IF;
  INSERT INTO public.bl_charge_adjustments (
    bl_id, line_key, source, charge_item_id, charge_table_id, scope, pod_key, charge_name,
    application_basis, cargo_profile, currency, kind, value, reference_quantity, justification, created_by)
  VALUES (
    v_bl.id, p_line_key, 'auto', v_line.charge_item_id, v_line.charge_table_id, v_line.scope,
    public.normalize_port_code(v_bl.pod), v_line.charge_name, v_line.application_basis, v_line.cargo_profile,
    v_line.currency, 'excluded', NULL, v_line.quantity, v_justification, auth.uid())
  RETURNING id INTO v_new_id;

  PERFORM public._calculate_bl_local_charges_impl_106(v_bl.id, auth.uid(), true);

  PERFORM public._record_bl_charge_event(v_bl.id, v_new_id, 'excluded', p_line_key, v_line.charge_name,
    public._bl_charge_value_snapshot(COALESCE(v_adj.kind, 'table'), v_line.unit_value, v_line.total_value,
      v_line.quantity, v_line.currency, v_line.application_basis),
    NULL, v_justification, auth.uid());
  RETURN jsonb_build_object('bl_id', v_bl.id, 'line_key', p_line_key, 'adjustment_id', v_new_id, 'kind', 'excluded');
END;
$function$;
REVOKE ALL ON FUNCTION public.exclude_bl_charge(text, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.exclude_bl_charge(text, text, text, uuid) TO authenticated;

-- Voltar ao valor da tabela (taxa alterada) ou Incluir taxa de novo (taxa
-- excluída).
CREATE OR REPLACE FUNCTION public.restore_bl_charge(
  p_bl_id text, p_line_key text, p_justification text, p_actor uuid DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bl public.bls;
  v_line record;
  v_adj public.bl_charge_adjustments;
  v_justification text := btrim(COALESCE(p_justification, ''));
  v_event text;
  v_after record;
BEGIN
  v_bl := public._lock_bl_for_charge_change(p_bl_id, p_justification, p_actor);
  SELECT * INTO v_adj FROM public.bl_charge_adjustments a
   WHERE a.bl_id = v_bl.id AND a.line_key = p_line_key AND a.ended_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Esta taxa não tem alteração à mão para desfazer; atualize a página.' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO v_line FROM public._bl_charge_line_for_change(v_bl.id, p_line_key);
  IF FOUND AND v_line.status = 'review_required' THEN
    RAISE EXCEPTION 'Taxa em revisão não se altera: corrija o B/L e recalcule.' USING ERRCODE = '22023';
  END IF;

  v_event := CASE WHEN v_adj.kind = 'excluded' THEN 'reincluded' ELSE 'restored' END;
  UPDATE public.bl_charge_adjustments
     SET ended_at = now(), ended_by = auth.uid(), end_reason = v_event, end_justification = v_justification
   WHERE id = v_adj.id;

  IF v_adj.source = 'manual' THEN
    UPDATE public.charge_calculations cc
       SET unit_value_brl = CASE WHEN v_adj.currency = 'USD' THEN NULL ELSE COALESCE(cc.table_unit_value_brl, cc.unit_value_brl) END,
           unit_value_usd = CASE WHEN v_adj.currency = 'USD' THEN COALESCE(cc.table_unit_value_usd, cc.unit_value_usd) END,
           total_value_brl = CASE WHEN v_adj.currency = 'USD' THEN NULL ELSE round(cc.quantity * COALESCE(cc.table_unit_value_brl, cc.unit_value_brl, 0), 2) END,
           total_value_usd = CASE WHEN v_adj.currency = 'USD' THEN round(cc.quantity * COALESCE(cc.table_unit_value_usd, cc.unit_value_usd, 0), 2) END,
           adjustment_id = NULL,
           calculated_at = now()
     WHERE cc.bl_id = v_bl.id AND cc.calculation_key = p_line_key;
  ELSE
    PERFORM public._calculate_bl_local_charges_impl_106(v_bl.id, auth.uid(), true);
  END IF;

  SELECT * INTO v_after FROM public._bl_charge_line_for_change(v_bl.id, p_line_key);
  PERFORM public._record_bl_charge_event(v_bl.id, v_adj.id, v_event, p_line_key, v_adj.charge_name,
    public._bl_charge_value_snapshot(v_adj.kind, v_line.unit_value, v_line.total_value, v_line.quantity,
      v_adj.currency, v_adj.application_basis),
    public._bl_charge_value_snapshot('table', v_after.unit_value, v_after.total_value, v_after.quantity,
      v_adj.currency, v_adj.application_basis),
    v_justification, auth.uid());
  RETURN jsonb_build_object('bl_id', v_bl.id, 'line_key', p_line_key, 'event', v_event,
    'unit_value', v_after.unit_value, 'total_value', v_after.total_value, 'currency', v_adj.currency);
END;
$function$;
REVOKE ALL ON FUNCTION public.restore_bl_charge(text, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.restore_bl_charge(text, text, text, uuid) TO authenticated;

-- Excluir cobrança manual (D3, D14.1): todos os setores, com justificativa.
-- Supersede a ADR 0071, item 11 (era só do Administrativo). A assinatura antiga
-- perde o EXECUTE.
CREATE OR REPLACE FUNCTION public.delete_manual_bl_charge(
  p_charge_calculation_id bigint, p_justification text, p_actor uuid DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bl_id text;
  v_bl public.bls;
  v_line record;
  v_justification text := btrim(COALESCE(p_justification, ''));
BEGIN
  PERFORM public._assert_actor_is_caller(p_actor);
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Somente usuário interno ativo altera as taxas do B/L.' USING ERRCODE = '42501';
  END IF;
  SELECT cc.bl_id INTO v_bl_id FROM public.charge_calculations cc WHERE cc.id = p_charge_calculation_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Esta taxa não está mais no cálculo do B/L; atualize a página.' USING ERRCODE = 'P0002';
  END IF;
  v_bl := public._lock_bl_for_charge_change(v_bl_id, p_justification, p_actor);

  SELECT l.* INTO v_line FROM public.charge_calculations cc
    CROSS JOIN LATERAL public._bl_charge_line_for_change(cc.bl_id, cc.calculation_key) l
   WHERE cc.id = p_charge_calculation_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Esta taxa não está mais no cálculo do B/L; atualize a página.' USING ERRCODE = 'P0002';
  END IF;
  IF v_line.source IS DISTINCT FROM 'manual' THEN
    RAISE EXCEPTION 'Somente cobrança manual se exclui assim; para a taxa calculada use Excluir taxa.' USING ERRCODE = '22023';
  END IF;
  -- Com taxa calculada excluída no B/L, apagar a última cobrança manual levaria
  -- o B/L a zero por outro caminho que não a isenção (D12).
  IF EXISTS (SELECT 1 FROM public.charge_calculations cc WHERE cc.bl_id = v_bl.id AND cc.status = 'excluded') THEN
    PERFORM public._assert_bl_keeps_a_charge(v_bl.id, v_line.id);
  END IF;

  UPDATE public.bl_charge_adjustments
     SET ended_at = now(), ended_by = auth.uid(), end_reason = 'line_deleted', end_justification = v_justification
   WHERE bl_id = v_bl.id AND line_key = (SELECT calculation_key FROM public.charge_calculations WHERE id = p_charge_calculation_id)
     AND ended_at IS NULL;

  PERFORM public._record_bl_charge_event(v_bl.id, v_line.adjustment_id, 'manual_deleted',
    (SELECT calculation_key FROM public.charge_calculations WHERE id = p_charge_calculation_id), v_line.charge_name,
    public._bl_charge_value_snapshot(CASE WHEN v_line.adjustment_id IS NULL THEN 'table' ELSE 'adjusted' END,
      v_line.unit_value, v_line.total_value, v_line.quantity, v_line.currency, v_line.application_basis),
    NULL, v_justification, auth.uid());

  DELETE FROM public.charge_calculations WHERE id = p_charge_calculation_id;

  RETURN jsonb_build_object('deleted', true, 'id', p_charge_calculation_id, 'bl_id', v_bl.id);
END;
$function$;
REVOKE ALL ON FUNCTION public.delete_manual_bl_charge(bigint, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_manual_bl_charge(bigint, text, uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.delete_manual_bl_charge(bigint, uuid) FROM PUBLIC, anon, authenticated;

-- Editar cobrança manual (quantidade e observação): com o valor total alterado,
-- o total se mantém e o Unitário passa a total ÷ quantidade (D7, casos de
-- borda); com o valor por unidade alterado, o total segue a quantidade.
CREATE OR REPLACE FUNCTION public.update_manual_bl_charge(p_charge_calculation_id bigint, p_quantity numeric, p_notes text DEFAULT NULL::text, p_actor uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_row RECORD;
  v_adj public.bl_charge_adjustments;
  v_qty NUMERIC(12,6);
  v_unit_brl NUMERIC(12,2);
  v_unit_usd NUMERIC(12,2);
  v_total_brl NUMERIC(14,2);
  v_total_usd NUMERIC(14,2);
  v_name text;
BEGIN
  -- O autor é quem está logado (ADR 0085, regra base 2; migration 241).
  PERFORM public._assert_actor_is_caller(p_actor);
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa' USING ERRCODE = '42501';
  END IF;

  SELECT
    cc.id, cc.bl_id, cc.source, cc.quantity, cc.unit_value_brl, cc.unit_value_usd,
    cc.total_value_brl, cc.total_value_usd, cc.notes, cc.calculation_key, cc.adjustment_id,
    cc.table_unit_value_brl, cc.table_unit_value_usd, cc.charge_item_id,
    b.financial_status AS bl_financial_status
  INTO v_row
  FROM public.charge_calculations AS cc
  LEFT JOIN public.bls AS b ON b.id = cc.bl_id
  WHERE cc.id = p_charge_calculation_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Linha de calculo % nao encontrada', p_charge_calculation_id USING ERRCODE = 'P0002';
  END IF;

  IF COALESCE(v_row.source, '') <> 'manual' THEN
    RAISE EXCEPTION 'Somente linhas manuais podem ser editadas' USING ERRCODE = '22023';
  END IF;

  IF COALESCE(v_row.bl_financial_status, 'open') IN ('invoiced', 'partially_paid', 'paid') THEN
    RAISE EXCEPTION 'B/L % ja foi faturado; nao e permitido editar taxa manual.', v_row.bl_id
      USING ERRCODE = '22023';
  END IF;

  v_qty := COALESCE(p_quantity, v_row.quantity, 1);
  IF v_qty <= 0 THEN
    RAISE EXCEPTION 'Quantidade deve ser maior que zero' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_adj FROM public.bl_charge_adjustments a
   WHERE a.bl_id = v_row.bl_id AND a.line_key = v_row.calculation_key AND a.ended_at IS NULL FOR UPDATE;

  v_unit_brl := v_row.unit_value_brl;
  v_unit_usd := v_row.unit_value_usd;
  IF v_adj.kind = 'total' THEN
    v_total_brl := CASE WHEN v_adj.currency = 'USD' THEN NULL ELSE v_adj.value END;
    v_total_usd := CASE WHEN v_adj.currency = 'USD' THEN v_adj.value END;
    v_unit_brl := CASE WHEN v_adj.currency = 'USD' THEN NULL ELSE round(v_adj.value / v_qty, 2) END;
    v_unit_usd := CASE WHEN v_adj.currency = 'USD' THEN round(v_adj.value / v_qty, 2) END;
  ELSE
    v_total_brl := CASE WHEN v_row.unit_value_brl IS NULL THEN NULL ELSE ROUND(v_qty * v_row.unit_value_brl, 2) END;
    v_total_usd := CASE WHEN v_row.unit_value_usd IS NULL THEN NULL ELSE ROUND(v_qty * v_row.unit_value_usd, 2) END;
  END IF;

  UPDATE public.charge_calculations
  SET
    quantity = v_qty,
    unit_value_brl = v_unit_brl,
    unit_value_usd = v_unit_usd,
    total_value_brl = v_total_brl,
    total_value_usd = v_total_usd,
    table_total_value_brl = CASE WHEN table_unit_value_brl IS NULL THEN table_total_value_brl ELSE round(v_qty * table_unit_value_brl, 2) END,
    table_total_value_usd = CASE WHEN table_unit_value_usd IS NULL THEN table_total_value_usd ELSE round(v_qty * table_unit_value_usd, 2) END,
    notes = NULLIF(TRIM(COALESCE(p_notes, '')), ''),
    calculated_at = NOW()
  WHERE id = p_charge_calculation_id;

  IF v_adj.id IS NOT NULL AND v_adj.reference_quantity IS DISTINCT FROM v_qty THEN
    IF v_adj.kind = 'total' THEN
      SELECT cti.name INTO v_name FROM public.charge_table_items cti WHERE cti.id = v_row.charge_item_id;
      PERFORM public._record_bl_charge_event(v_row.bl_id, v_adj.id, 'quantity_changed', v_row.calculation_key,
        COALESCE(v_name, v_adj.charge_name),
        jsonb_build_object('quantity', v_adj.reference_quantity),
        jsonb_build_object('quantity', v_qty, 'total', v_adj.value, 'currency', v_adj.currency),
        NULLIF(TRIM(COALESCE(p_notes, '')), ''), auth.uid());
    END IF;
    UPDATE public.bl_charge_adjustments SET reference_quantity = v_qty WHERE id = v_adj.id;
  END IF;

  INSERT INTO public.audit_logs (
    entity_type,
    entity_id,
    field_name,
    old_value,
    new_value,
    changed_by,
    changed_at,
    justification
  )
  VALUES (
    'charge_calculation',
    p_charge_calculation_id::TEXT,
    'manual_update',
    CONCAT('qty=', COALESCE(v_row.quantity::TEXT, '0'), ' | note=', COALESCE(v_row.notes, '')),
    CONCAT('qty=', v_qty, ' | note=', COALESCE(NULLIF(TRIM(COALESCE(p_notes, '')), ''), '')),
    auth.uid(),
    NOW(),
    COALESCE(NULLIF(TRIM(COALESCE(p_notes, '')), ''), 'Atualizacao manual de other charge')
  );

  RETURN jsonb_build_object(
    'id', p_charge_calculation_id,
    'bl_id', v_row.bl_id,
    'quantity', v_qty,
    'total_value_brl', v_total_brl,
    'total_value_usd', v_total_usd
  );
END;
$function$;

-- 7. Leituras ------------------------------------------------------------------

-- Histórico das taxas, logo abaixo da tabela (D3, D10).
CREATE OR REPLACE FUNCTION public.list_bl_charge_history(p_bl_id text)
 RETURNS TABLE(id bigint, created_at timestamptz, event text, line_key text, charge_name text,
   before jsonb, after jsonb, justification text, actor uuid, actor_name text, invoice_effect jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_read_user() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT e.id, e.created_at, e.event, e.line_key, e.charge_name, e.before, e.after, e.justification,
         e.actor, up.full_name, e.invoice_effect
  FROM public.bl_charge_adjustment_events e
  LEFT JOIN public.user_profiles up ON up.id = e.actor
  WHERE e.bl_id = p_bl_id
  ORDER BY e.created_at DESC, e.id DESC;
END;
$function$;
REVOKE ALL ON FUNCTION public.list_bl_charge_history(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_bl_charge_history(text) TO authenticated;

-- Linhas do bloco Taxas Locais, agora com a alteração à mão (marca, valor da
-- tabela, quem, quando e justificativa).
DROP FUNCTION IF EXISTS public.list_bl_local_charge_lines(text);
CREATE FUNCTION public.list_bl_local_charge_lines(p_bl_id text)
 RETURNS TABLE(id bigint, bl_id text, charge_table_id bigint, charge_item_id bigint, charge_name text,
   charge_table_name text, charge_table_pod text, application_basis text, source text, status text,
   quantity numeric, currency text, unit_value_brl numeric, unit_value_usd numeric, total_value_brl numeric,
   total_value_usd numeric, override_applied boolean, calculation_key text, notes text, review_reason text,
   calculated_at timestamp with time zone,
   adjustment_id bigint, adjustment_kind text, adjustment_value numeric, adjustment_justification text,
   adjusted_by uuid, adjusted_by_name text, adjusted_at timestamp with time zone,
   table_unit_value_brl numeric, table_unit_value_usd numeric, table_total_value_brl numeric,
   table_total_value_usd numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_read_user() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    cc.id,
    cc.bl_id,
    cc.charge_table_id,
    cc.charge_item_id,
    COALESCE(cti.name, '[Sistema]') AS charge_name,
    ct.name AS charge_table_name,
    ct.pod AS charge_table_pod,
    cti.application_basis,
    cc.source,
    cc.status,
    cc.quantity,
    COALESCE(cti.currency, CASE WHEN cc.unit_value_usd IS NOT NULL THEN 'USD' ELSE 'BRL' END) AS currency,
    cc.unit_value_brl,
    cc.unit_value_usd,
    cc.total_value_brl,
    cc.total_value_usd,
    cc.override_applied,
    cc.calculation_key,
    cc.notes,
    cc.review_reason,
    cc.calculated_at,
    a.id,
    a.kind,
    a.value,
    a.justification,
    a.created_by,
    up.full_name,
    a.created_at,
    cc.table_unit_value_brl,
    cc.table_unit_value_usd,
    cc.table_total_value_brl,
    cc.table_total_value_usd
  FROM public.charge_calculations AS cc
  LEFT JOIN public.charge_table_items AS cti ON cti.id = cc.charge_item_id
  -- A tabela vem da linha, não do item: a linha guarda a tabela vigente no
  -- momento do cálculo, e é essa que o operador precisa conferir.
  LEFT JOIN public.charge_tables AS ct ON ct.id = cc.charge_table_id
  LEFT JOIN public.bl_charge_adjustments AS a ON a.id = cc.adjustment_id
  LEFT JOIN public.user_profiles AS up ON up.id = a.created_by
  WHERE cc.bl_id = p_bl_id
  ORDER BY cc.source DESC, cc.id ASC;
END;
$function$;
REVOKE ALL ON FUNCTION public.list_bl_local_charge_lines(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_bl_local_charge_lines(text) TO authenticated;
