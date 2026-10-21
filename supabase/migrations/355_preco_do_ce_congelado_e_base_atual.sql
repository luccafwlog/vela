-- 355: no dia do CE fica congelado só o preço; a base do B/L é a atual na
-- emissão (ADR 0093, decisão 3; plano da frente financeira, F-01 e F-02).
--
-- Depende do "Data status" do AGENTS.md: o backfill congela o preço dos B/Ls
-- que já têm CE pelo preço de hoje (não pelo do dia do CE, que não foi
-- guardado) e grava a base atual como base do último cálculo, sem plano de
-- preservação, porque as linhas de produção são de teste.
--
-- Problema:
--   F-01. A emissão que reaproveita o cálculo do CE (Liberação, ativação do
--     Portal, Retomar, efeito `local_billing`, Emitir) usava as linhas
--     gravadas no dia do CE, com o rateio do container daquele dia. Irmão que
--     chegou ou foi cancelado depois deixava o container cobrado 150% ou 50%,
--     porque o efeito `local_charges` não recalculava irmão com CE ou retido.
--     O ponytail da 176 ("refeito pela Liberação") não valia.
--   F-02. Correção da ficha entre o CE e a emissão (Movement To, veículos,
--     peso, containers) não entrava na fatura: a base não era recalculada.
--
-- Mudança:
--   1. `bl_price_freezes` e `bl_price_freeze_items` guardam, no registro do
--      CE, a data de referência e o preço de cada item das tabelas vinculadas
--      (com a Condição de Cliente daquele dia). O motor
--      (`resolve_bl_local_charge_items`) usa o preço congelado quando existe.
--      Correção de item ou de Condição (decisão 2, migration 354) atualiza o
--      preço congelado; Condição nova não.
--   2. `bl_charge_calculation_basis` guarda a base (`bl_invoice_basis_snapshot`,
--      que inclui os irmãos de cada container) de cada cálculo.
--   3. Gatilho de fim de transação recalcula o B/L não faturado cuja base
--      mudou (ficha, containers, veículos, irmão que chega, sai, é cancelado
--      ou excluído), inclusive com CE ou retido, com o preço congelado.
--   4. A emissão só reaproveita o cálculo cuja base ainda é a atual
--      (`_auto_bill_bl_core`); `mark_bl_ready_for_billing` recalcula antes
--      das checagens se a base mudou.
--   5. O efeito `local_charges` recalcula também os irmãos com CE ou retidos.

CREATE TABLE public.bl_price_freezes (
  bl_id text PRIMARY KEY REFERENCES public.bls(id) ON DELETE CASCADE,
  reference_date date NOT NULL,
  frozen_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.bl_price_freeze_items (
  bl_id text NOT NULL REFERENCES public.bl_price_freezes(bl_id) ON DELETE CASCADE,
  charge_item_id bigint NOT NULL REFERENCES public.charge_table_items(id),
  unit_value_brl numeric(12,2),
  unit_value_usd numeric(12,2),
  override_value numeric(12,2),
  PRIMARY KEY (bl_id, charge_item_id)
);
CREATE INDEX idx_bl_price_freeze_items_item ON public.bl_price_freeze_items (charge_item_id);
CREATE TABLE public.bl_charge_calculation_basis (
  bl_id text PRIMARY KEY REFERENCES public.bls(id) ON DELETE CASCADE,
  basis jsonb NOT NULL,
  calculated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.bl_price_freezes IS 'Preço do dia do CE (ADR 0093, decisão 3). Gravado só pelo servidor.';
COMMENT ON TABLE public.bl_charge_calculation_basis IS 'Base do B/L no último cálculo de Taxas Locais; a emissão só reaproveita o cálculo com a base atual.';
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['bl_price_freezes', 'bl_price_freeze_items', 'bl_charge_calculation_basis'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING ((SELECT public.is_active_read_user()))', t || '_select_read', t);
  END LOOP;
END $$;

-- Valor da Condição de Cliente do item na data.
CREATE OR REPLACE FUNCTION public._customer_override_value(p_customer_id bigint, p_item_id bigint, p_date date)
RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT cro.override_value
  FROM public.customer_rate_overrides AS cro
  WHERE cro.active AND cro.customer_id = p_customer_id AND cro.charge_item_id = p_item_id
    AND (cro.valid_from IS NULL OR cro.valid_from <= p_date)
    AND (cro.valid_to IS NULL OR cro.valid_to >= p_date)
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public._customer_override_value(bigint, bigint, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._customer_override_value(bigint, bigint, date) TO service_role;

-- Congela o preço do B/L (uma vez; idempotente).
CREATE OR REPLACE FUNCTION public.freeze_bl_prices(p_bl_id text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_bl record;
  v_ref date;
BEGIN
  SELECT b.id, b.pod, b.customer_id INTO v_bl FROM public.bls b WHERE b.id = p_bl_id;
  IF NOT FOUND OR EXISTS (SELECT 1 FROM public.bl_price_freezes WHERE bl_id = p_bl_id) THEN RETURN; END IF;
  PERFORM public.bind_bl_local_charge_tables(p_bl_id);
  v_ref := public.bl_local_charge_reference_date(p_bl_id, v_bl.pod);
  INSERT INTO public.bl_price_freezes (bl_id, reference_date) VALUES (p_bl_id, v_ref);
  INSERT INTO public.bl_price_freeze_items (bl_id, charge_item_id, unit_value_brl, unit_value_usd, override_value)
  SELECT p_bl_id, cti.id, cti.unit_value_brl, cti.unit_value_usd,
    public._customer_override_value(v_bl.customer_id, cti.id, v_ref)
  FROM public.bl_charge_table_links l
  JOIN public.charge_table_items cti ON cti.charge_table_id = l.charge_table_id
  WHERE l.bl_id = p_bl_id;
END;
$$;
REVOKE ALL ON FUNCTION public.freeze_bl_prices(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.freeze_bl_prices(text) TO service_role;

CREATE OR REPLACE FUNCTION public.freeze_bl_prices_on_ce()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.freeze_bl_prices(NEW.id);
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.freeze_bl_prices_on_ce() FROM PUBLIC, anon, authenticated;
-- O nome ordena antes de `trg_auto_bill_bl_after_ce_mercante`: o preço é
-- congelado antes da emissão do CE.
CREATE TRIGGER freeze_bl_prices_on_ce
  AFTER INSERT OR UPDATE OF ce_mercante ON public.bls
  FOR EACH ROW WHEN (nullif(btrim(NEW.ce_mercante), '') IS NOT NULL)
  EXECUTE FUNCTION public.freeze_bl_prices_on_ce();

-- A base ainda é a do último cálculo? Sem registro (nunca calculado), sim.
CREATE OR REPLACE FUNCTION public.bl_calculation_is_current(p_bl_id text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT coalesce((SELECT b.basis = public.bl_invoice_basis_snapshot(p_bl_id)
    FROM public.bl_charge_calculation_basis b WHERE b.bl_id = p_bl_id), true);
$$;
REVOKE ALL ON FUNCTION public.bl_calculation_is_current(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bl_calculation_is_current(text) TO authenticated, service_role;

-- Recalcula o B/L não faturado cuja base mudou desde o último cálculo.
CREATE OR REPLACE FUNCTION public._refresh_bl_calculation_if_stale(p_bl_id text, p_actor uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.bls b
    WHERE b.id = p_bl_id AND b.cancelled_at IS NULL
      AND coalesce(b.financial_status, 'pending') = 'pending'
      AND coalesce(b.charge_status, 'not_calculated') <> 'not_calculated')
     OR cardinality(public._live_local_invoice_ids_for_bl(p_bl_id)) > 0
     OR public.bl_calculation_is_current(p_bl_id) THEN
    RETURN false;
  END IF;
  PERFORM public._calculate_bl_local_charges_impl_106(p_bl_id, coalesce(p_actor, auth.uid()), true);
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public._refresh_bl_calculation_if_stale(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._refresh_bl_calculation_if_stale(text, uuid) TO service_role;

-- Fim da transação: B/L e irmãos de container cuja base mudou.
CREATE OR REPLACE FUNCTION public.refresh_unbilled_calculations_at_commit()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ids text[] := ARRAY[]::text[];
  v_numbers text[] := ARRAY[]::text[];
  v_voyages bigint[] := ARRAY[]::bigint[];
  v_id text;
BEGIN
  IF TG_TABLE_NAME = 'bls' THEN
    IF TG_OP <> 'INSERT' THEN v_ids := v_ids || OLD.id; v_voyages := v_voyages || OLD.voyage_id; END IF;
    IF TG_OP <> 'DELETE' THEN v_ids := v_ids || NEW.id; v_voyages := v_voyages || NEW.voyage_id; END IF;
    SELECT coalesce(array_agg(DISTINCT upper(btrim(c.container_number))), ARRAY[]::text[]) INTO v_numbers
    FROM public.bl_containers c WHERE c.bl_id = ANY(v_ids);
  ELSE
    IF TG_OP <> 'INSERT' THEN
      v_ids := v_ids || OLD.bl_id;
      IF TG_TABLE_NAME = 'bl_containers' THEN v_numbers := v_numbers || upper(btrim(OLD.container_number)); END IF;
    END IF;
    IF TG_OP <> 'DELETE' THEN
      v_ids := v_ids || NEW.bl_id;
      IF TG_TABLE_NAME = 'bl_containers' THEN v_numbers := v_numbers || upper(btrim(NEW.container_number)); END IF;
    END IF;
    SELECT coalesce(array_agg(DISTINCT b.voyage_id), ARRAY[]::bigint[]) INTO v_voyages FROM public.bls b WHERE b.id = ANY(v_ids);
  END IF;
  -- Irmãos de container da mesma Viagem. O B/L excluído some da conta (F-06).
  IF cardinality(v_numbers) > 0 THEN
    SELECT v_ids || coalesce(array_agg(DISTINCT c.bl_id), ARRAY[]::text[]) INTO v_ids
    FROM public.bl_containers c JOIN public.bls b ON b.id = c.bl_id
    WHERE upper(btrim(c.container_number)) = ANY(v_numbers)
      AND (cardinality(v_voyages) = 0 OR b.voyage_id = ANY(v_voyages));
  END IF;
  FOR v_id IN SELECT DISTINCT unnest(v_ids) ORDER BY 1 LOOP
    BEGIN
      PERFORM public._refresh_bl_calculation_if_stale(v_id, NULL);
    EXCEPTION WHEN OTHERS THEN
      -- O recálculo provisório não desfaz a alteração que o pediu; a emissão
      -- volta a conferir a base antes de faturar.
      INSERT INTO public.audit_logs (entity_type, entity_id, field_name, new_value, justification)
      VALUES ('bl', v_id, 'charge_recalculation_failed', left(SQLERRM, 500), 'Recálculo da base no fim da transação');
    END;
  END LOOP;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.refresh_unbilled_calculations_at_commit() FROM PUBLIC, anon, authenticated;

CREATE CONSTRAINT TRIGGER refresh_unbilled_calculations
  AFTER UPDATE OF voyage_id, pod, cargo_mode, customer_id, bb_weight_ton, total_weight_kg, movement_to, cancelled_at ON public.bls
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.refresh_unbilled_calculations_at_commit();
CREATE CONSTRAINT TRIGGER refresh_unbilled_calculations
  AFTER INSERT OR UPDATE OR DELETE ON public.bl_containers
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.refresh_unbilled_calculations_at_commit();
CREATE CONSTRAINT TRIGGER refresh_unbilled_calculations
  AFTER INSERT OR UPDATE OR DELETE ON public.vehicles
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.refresh_unbilled_calculations_at_commit();


-- O cálculo grava a base que usou.
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

  -- ADR 0093, decisão 1: o cálculo usa e grava a tabela vinculada ao B/L.
  PERFORM public.bind_bl_local_charge_tables(p_bl_id);
  -- ADR 0093, decisão 3: a base deste cálculo, para a emissão saber se ainda vale.
  INSERT INTO public.bl_charge_calculation_basis (bl_id, basis, calculated_at)
  VALUES (p_bl_id, public.bl_invoice_basis_snapshot(p_bl_id), now())
  ON CONFLICT (bl_id) DO UPDATE SET basis = EXCLUDED.basis, calculated_at = EXCLUDED.calculated_at;

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
$function$;

-- O motor usa o preço congelado no CE.
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

-- A emissão só reaproveita o cálculo com a base atual.
CREATE OR REPLACE FUNCTION public._auto_bill_bl_core(p_bl_id text, p_actor uuid, p_reuse_calculation boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bl public.bls%ROWTYPE;
  v_actor uuid := COALESCE(p_actor, auth.uid());
  v_calculation jsonb;
  v_ready jsonb;
  v_invoice jsonb;
  v_existing_invoice_id bigint;
  v_previous_context_table text := current_setting('vela.billing_context_table', true);
  v_previous_request_sub text := current_setting('request.jwt.claim.sub', true);
  v_context_table text := format('vela_auto_billing_%s', replace(gen_random_uuid()::text, '-', ''));
  v_impersonated boolean := false;
  v_context_created boolean := false;
  v_sqlstate text;
  v_error_message text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND (v_actor IS NULL OR v_actor IS DISTINCT FROM auth.uid() OR NOT public.is_active_user()) THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa para faturamento automatico.' USING ERRCODE = '42501';
  END IF;

  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Faturamento automatico sem ator validado.' USING ERRCODE = '42501';
  END IF;

  SELECT *
    INTO v_bl
  FROM public.bls
  WHERE id = p_bl_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'status', 'blocked',
      'reason', 'bl_not_found',
      'bl_id', p_bl_id
    );
  END IF;

  -- Repetir o save/import não pode criar uma segunda invoice. O status do B/L
  -- é a guarda rápida; o link ativo cobre estados antigos parcialmente gravados.
  IF COALESCE(v_bl.financial_status, 'pending') <> 'pending' THEN
    RETURN jsonb_build_object(
      'status', 'already_invoiced',
      'idempotent', true,
      'bl_id', v_bl.id,
      'financial_status', v_bl.financial_status
    );
  END IF;

  SELECT inv.id
    INTO v_existing_invoice_id
  FROM public.invoice_bls AS ib
  JOIN public.invoices AS inv ON inv.id = ib.invoice_id
  WHERE ib.bl_id = v_bl.id
    AND COALESCE(inv.status, 'issued') IN ('draft', 'issued', 'partially_paid', 'overdue')
  ORDER BY inv.id DESC
  LIMIT 1;

  IF v_existing_invoice_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'status', 'already_invoiced',
      'idempotent', true,
      'bl_id', v_bl.id,
      'invoice_id', v_existing_invoice_id
    );
  END IF;

  IF NULLIF(btrim(COALESCE(v_bl.ce_mercante, '')), '') IS NULL THEN
    RETURN jsonb_build_object(
      'status', 'blocked',
      'reason', 'ce_mercante_missing',
      'bl_id', v_bl.id
    );
  END IF;

  IF v_bl.customer_id IS NULL
     OR COALESCE(v_bl.customer_reconciliation_status, 'missing_customer') NOT IN ('matched_document', 'reconciled') THEN
    RETURN jsonb_build_object(
      'status', 'blocked',
      'reason', 'customer_reconciliation_pending',
      'bl_id', v_bl.id,
      'customer_id', v_bl.customer_id,
      'customer_reconciliation_status', v_bl.customer_reconciliation_status
    );
  END IF;

  -- O worker carrega o iniciador no GUC antes de chamar esta função. Em uma
  -- chamada server-side direta, o ator explícito recebe o mesmo tratamento.
  -- Só altere a identidade depois das saídas idempotentes acima e restaure-a
  -- em qualquer caminho, para não vazar o ator para o restante da sessão.
  IF auth.uid() IS DISTINCT FROM v_actor THEN
    PERFORM set_config('request.jwt.claim.sub', v_actor::text, true);
    v_impersonated := true;
  END IF;

  IF NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Ator inativo para faturamento automatico.' USING ERRCODE = '42501';
  END IF;

  -- O marcador é uma tabela temporária criada sob o owner do SECURITY
  -- DEFINER. O GUC só carrega o nome da tabela e é limpo antes de retornar.
  EXECUTE format(
    'CREATE TEMP TABLE pg_temp.%I (marker boolean NOT NULL) ON COMMIT DROP',
    v_context_table
  );
  v_context_created := true;
  EXECUTE format(
    'INSERT INTO pg_temp.%I(marker) VALUES (true)',
    v_context_table
  );
  PERFORM set_config('vela.billing_context_table', v_context_table, true);

  -- Taxas do dia do CE (decisão de 2026-09-24): ao abrir o gate, a fatura
  -- retida sai com o cálculo que a transição do CE já gravou. Só calcula
  -- quando o B/L nunca teve cálculo (não há cálculo do dia do CE a manter).
  -- `review_required` também é mantido: recalcular apagaria a revisão feita,
  -- e `mark_bl_ready_for_billing` recusa o B/L até a revisão terminar.
  -- ADR 0093, decisão 3: só o preço fica do dia do CE. Se a base mudou desde
  -- o cálculo (ficha, containers, irmão que chegou ou saiu), recalcula com o
  -- preço congelado.
  IF p_reuse_calculation
     AND v_bl.charge_status IN ('calculated', 'reviewed', 'ready_for_billing', 'review_required', 'exempt')
     AND public.bl_calculation_is_current(v_bl.id) THEN
    v_calculation := jsonb_build_object('bl_id', v_bl.id, 'status', v_bl.charge_status, 'reused', true);
  ELSE
    v_calculation := public.calculate_bl_local_charges(v_bl.id, v_actor, true);
  END IF;

  -- Isenção legítima não possui linha positiva para uma invoice. O CE foi
  -- processado corretamente, mas não há documento financeiro a emitir.
  IF v_calculation->>'status' = 'exempt' THEN
    EXECUTE format('DROP TABLE IF EXISTS pg_temp.%I', v_context_table);
    v_context_created := false;
    PERFORM set_config('vela.billing_context_table', COALESCE(v_previous_context_table, ''), true);
    IF v_impersonated THEN
      PERFORM set_config('request.jwt.claim.sub', COALESCE(v_previous_request_sub, ''), true);
    END IF;
    RETURN v_calculation || jsonb_build_object('status', 'skipped', 'reason', 'exempt');
  END IF;

  -- Trava universal do Portal (ADR 0070): sem Portal pronto e sem Liberação
  -- de faturamento vigente, o CE calcula mas não emite. A retenção fica no
  -- B/L e sai pela ativação do Portal ou pela concessão da Liberação, que
  -- reprocessam o Cliente. Não é falha: a fila de efeitos não é acionada.
  IF NOT public.customer_billing_access_ready(v_bl.customer_id) THEN
    EXECUTE format('DROP TABLE IF EXISTS pg_temp.%I', v_context_table);
    v_context_created := false;
    PERFORM set_config('vela.billing_context_table', COALESCE(v_previous_context_table, ''), true);
    UPDATE public.bls
       SET billing_hold_reason = COALESCE(NULLIF(btrim(billing_hold_reason), ''), 'Acesso ao portal nao provisionado')
     WHERE id = v_bl.id;
    PERFORM public.reconcile_customer_bl_review_alerts(v_bl.customer_id, NULL, 'portal_billing_hold');
    IF v_impersonated THEN
      PERFORM set_config('request.jwt.claim.sub', COALESCE(v_previous_request_sub, ''), true);
    END IF;
    RETURN jsonb_build_object(
      'status', 'held',
      'reason', 'portal_not_provisioned',
      'bl_id', v_bl.id,
      'customer_id', v_bl.customer_id,
      'calculation', v_calculation
    );
  END IF;

  v_ready := public.mark_bl_ready_for_billing(v_bl.id, v_actor);
  v_invoice := public.create_invoice_from_bls_core(
    ARRAY[v_bl.id],
    v_bl.customer_id,
    'Sistema — CE Mercante: fatura automática após o registro do CE.',
    true,
    v_actor,
    'internal',
    NULL
  );

  IF NULLIF(v_invoice->>'invoice_id', '') IS NULL THEN
    RAISE EXCEPTION 'Emissao automatica nao retornou invoice para o B/L %.', v_bl.id
      USING ERRCODE = 'P0001';
  END IF;

  EXECUTE format('DROP TABLE IF EXISTS pg_temp.%I', v_context_table);
  v_context_created := false;
  PERFORM set_config('vela.billing_context_table', COALESCE(v_previous_context_table, ''), true);
  PERFORM public.link_invoice_to_ledger((v_invoice->>'invoice_id')::bigint);

  IF v_impersonated THEN
    PERFORM set_config('request.jwt.claim.sub', COALESCE(v_previous_request_sub, ''), true);
  END IF;

  RETURN jsonb_build_object(
    'status', 'invoiced',
    'idempotent', false,
    'bl_id', v_bl.id,
    'calculation', v_calculation,
    'ready', v_ready,
    'invoice', v_invoice
  );
EXCEPTION
  WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS
      v_sqlstate = RETURNED_SQLSTATE,
      v_error_message = MESSAGE_TEXT;
    IF v_context_created THEN
      EXECUTE format('DROP TABLE IF EXISTS pg_temp.%I', v_context_table);
      v_context_created := false;
    END IF;
    PERFORM set_config('vela.billing_context_table', COALESCE(v_previous_context_table, ''), true);
    IF v_impersonated THEN
      PERFORM set_config('request.jwt.claim.sub', COALESCE(v_previous_request_sub, ''), true);
    END IF;

    -- A atualização documental não é desfeita porque o efeito recuperável
    -- será criado pelo trigger. O worker registrará o bloqueio com o erro
    -- original e poderá ser reprocessado depois da correção operacional.
    RETURN jsonb_build_object(
      'status', 'blocked',
      'reason', 'auto_billing_failed',
      'bl_id', p_bl_id,
      'sqlstate', v_sqlstate,
      'message', left(regexp_replace(COALESCE(v_error_message, ''), '[[:cntrl:]]', ' ', 'g'), 1000)
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.mark_bl_ready_for_billing(p_bl_id text, p_actor uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bl record;
  v_pending_count integer := 0;
  v_table_count integer := 0;
  v_invoiceable_count integer := 0;
  v_review_reasons text[];
  v_terminal_pendencies text[];
BEGIN
  -- O autor é quem está logado (ADR 0085, regra base 2; migration 241).
  PERFORM public._assert_actor_is_caller(p_actor);
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Acesso negado para marcar B/L como pronto para faturar.' USING ERRCODE = '42501';
  END IF;

  SELECT id, charge_status, pod, cargo_mode, customer_id, customer_reconciliation_status
  INTO v_bl FROM public.bls WHERE id = p_bl_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L "%" nao encontrado.', p_bl_id USING ERRCODE = 'P0002';
  END IF;

  -- ADR 0093, decisão 3: a emissão usa a base atual (preço do dia do CE).
  IF public._refresh_bl_calculation_if_stale(p_bl_id, p_actor) THEN
    SELECT id, charge_status, pod, cargo_mode, customer_id, customer_reconciliation_status
    INTO v_bl FROM public.bls WHERE id = p_bl_id;
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
$function$;

-- Irmãos com CE ou retidos entram no recálculo do efeito.
CREATE OR REPLACE FUNCTION public._run_import_effect_local_charges(p_entity_id text, p_actor uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_origin public.bls%ROWTYPE;
  v_voyage_id bigint;
  v_container_numbers text[];
  v_bl_ids text[] := ARRAY[]::text[];
  v_current_bl_id text;
  v_result jsonb := '[]'::jsonb;
  v_calculated integer := 0;
  v_one jsonb;
  v_sqlstate text;
BEGIN
  SELECT * INTO v_origin FROM public.bls WHERE id = NULLIF(btrim(p_entity_id), '') FOR UPDATE;

  IF FOUND THEN
    v_voyage_id := v_origin.voyage_id;
    IF COALESCE(v_origin.financial_status, 'pending') <> 'pending'
       OR cardinality(public._live_local_invoice_ids_for_bl(v_origin.id)) > 0 THEN
      RETURN jsonb_build_object('entity_id', p_entity_id, 'calculated', 0,
        'results', jsonb_build_array(jsonb_build_object('status', 'already_invoiced', 'idempotent', true,
          'bl_id', v_origin.id, 'financial_status', v_origin.financial_status)));
    END IF;

    IF NULLIF(btrim(COALESCE(v_origin.ce_mercante, '')), '') IS NOT NULL THEN
      -- CE gravado: o cálculo do dia do CE vale (ADR 0070, nota 2026-09-24 b).
      v_one := public._auto_bill_bl_core(v_origin.id, p_actor, true);
    ELSE
      v_one := public.calculate_bl_local_charges(v_origin.id, p_actor, true);
    END IF;
    v_result := jsonb_build_array(v_one);
    v_calculated := 1;

    -- Irmãos de container (o rateio muda): todos os não faturados, inclusive
    -- com CE ou retidos (ADR 0093, decisão 3: o preço do CE fica congelado, a
    -- base não). Carga solta não tem container e não toca a Viagem.
    SELECT COALESCE(array_agg(DISTINCT upper(btrim(c.container_number))), ARRAY[]::text[])
      INTO v_container_numbers
    FROM public.bl_containers AS c
    WHERE c.bl_id = v_origin.id AND NULLIF(btrim(c.container_number), '') IS NOT NULL;

    IF cardinality(v_container_numbers) > 0 THEN
      SELECT COALESCE(array_agg(DISTINCT b.id ORDER BY b.id), ARRAY[]::text[]) INTO v_bl_ids
      FROM public.bls AS b
      JOIN public.bl_containers AS c ON c.bl_id = b.id
      WHERE b.voyage_id = v_voyage_id
        AND b.id <> v_origin.id
        AND b.cancelled_at IS NULL
        AND COALESCE(b.financial_status, 'pending') = 'pending'
        AND cardinality(public._live_local_invoice_ids_for_bl(b.id)) = 0
        AND upper(btrim(c.container_number)) = ANY(v_container_numbers);
    END IF;
  ELSE
    IF NULLIF(btrim(p_entity_id), '') IS NULL OR p_entity_id !~ '^[0-9]+$' THEN
      RAISE EXCEPTION 'Entidade de efeito local desconhecida: %.', p_entity_id USING ERRCODE = 'P0002';
    END IF;
    SELECT v.id INTO v_voyage_id FROM public.voyages AS v WHERE v.id = p_entity_id::bigint;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Viagem de efeito local nao encontrada: %.', p_entity_id USING ERRCODE = 'P0002';
    END IF;
    -- Efeito da Viagem: só B/Ls provisórios (sem CE, sem retenção).
    SELECT COALESCE(array_agg(b.id ORDER BY b.id), ARRAY[]::text[]) INTO v_bl_ids
    FROM public.bls AS b
    WHERE b.voyage_id = v_voyage_id
      AND b.cancelled_at IS NULL
      AND COALESCE(b.cargo_mode, 'container') IN ('container', 'carga_solta', 'misto')
      AND COALESCE(b.financial_status, 'pending') = 'pending'
      AND NULLIF(btrim(COALESCE(b.ce_mercante, '')), '') IS NULL
      AND NULLIF(btrim(COALESCE(b.billing_hold_reason, '')), '') IS NULL;
  END IF;

  FOREACH v_current_bl_id IN ARRAY v_bl_ids LOOP
    v_result := v_result || jsonb_build_array(public.calculate_bl_local_charges(v_current_bl_id, p_actor, true));
    v_calculated := v_calculated + 1;
  END LOOP;

  IF v_one IS NOT NULL AND v_one->>'status' = 'blocked' AND v_one->>'reason' = 'auto_billing_failed' THEN
    -- O SQLSTATE original decide entre nova tentativa e bloqueio.
    v_sqlstate := COALESCE(NULLIF(v_one->>'sqlstate', ''), 'P0001');
    IF v_sqlstate !~ '^[0-9A-Z]{5}$' THEN v_sqlstate := 'P0001'; END IF;
    RAISE EXCEPTION 'Faturamento automatico do B/L % bloqueado: %', v_origin.id,
      COALESCE(v_one->>'message', 'falha desconhecida')
      USING ERRCODE = v_sqlstate;
  END IF;

  RETURN jsonb_build_object('entity_id', p_entity_id, 'calculated', v_calculated, 'results', v_result);
END;
$function$;

-- Correção de item e de Condição atualiza o preço congelado.
CREATE OR REPLACE FUNCTION public.reprice_bls_on_charge_item_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bls text[];
BEGIN
  IF TG_OP = 'UPDATE' AND (to_jsonb(NEW) - 'created_at' - 'sort_order') = (to_jsonb(OLD) - 'created_at' - 'sort_order') THEN
    RETURN NULL;
  END IF;
  -- O preço congelado no CE é corrigido junto (decisão 2 prevalece sobre a 3).
  IF TG_OP = 'UPDATE' THEN
    UPDATE public.bl_price_freeze_items
       SET unit_value_brl = NEW.unit_value_brl, unit_value_usd = NEW.unit_value_usd
     WHERE charge_item_id = NEW.id;
  END IF;
  SELECT array_agg(DISTINCT l.bl_id) INTO v_bls
  FROM public.bl_charge_table_links l
  WHERE l.charge_table_id IN (NEW.charge_table_id, CASE WHEN TG_OP = 'UPDATE' THEN OLD.charge_table_id END);
  IF v_bls IS NOT NULL THEN
    PERFORM public._reprice_bls_after_tariff_change(v_bls, true, true);
  END IF;
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.reprice_bls_on_customer_rate_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bls text[];
  v_correction boolean;
BEGIN
  -- Criar, ativar ou desativar é Condição nova (ou o fim dela): vale para os
  -- B/Ls não faturados e sem CE. Mudar valor ou vigência de Condição ativa é
  -- correção: vale para todos os B/Ls na vigência antiga ou nova.
  v_correction := TG_OP = 'UPDATE' AND OLD.active AND NEW.active;
  IF TG_OP = 'UPDATE' AND NOT v_correction AND OLD.active = NEW.active THEN
    RETURN NULL;
  END IF;
  IF v_correction AND OLD.override_value = NEW.override_value AND OLD.valid_from IS NOT DISTINCT FROM NEW.valid_from
     AND OLD.valid_to IS NOT DISTINCT FROM NEW.valid_to AND OLD.charge_item_id IS NOT DISTINCT FROM NEW.charge_item_id
     AND OLD.customer_id IS NOT DISTINCT FROM NEW.customer_id THEN
    RETURN NULL;
  END IF;

  -- Correção: o preço congelado no CE dos B/Ls do Cliente acompanha. Condição
  -- nova (criar, ativar, desativar) não mexe no preço congelado.
  IF v_correction THEN
    UPDATE public.bl_price_freeze_items fi
       SET override_value = public._customer_override_value(b.customer_id, fi.charge_item_id, f.reference_date)
      FROM public.bl_price_freezes f JOIN public.bls b ON b.id = f.bl_id
     WHERE fi.bl_id = f.bl_id AND b.customer_id IN (NEW.customer_id, OLD.customer_id)
       AND fi.charge_item_id IN (NEW.charge_item_id, OLD.charge_item_id);
  END IF;
  SELECT array_agg(DISTINCT b.id) INTO v_bls
  FROM public.bls b
  JOIN public.bl_charge_table_links l ON l.bl_id = b.id
  JOIN public.charge_table_items cti ON cti.charge_table_id = l.charge_table_id
  CROSS JOIN LATERAL (SELECT public.bl_local_charge_reference_date(b.id, b.pod) AS ref) r
  WHERE b.cancelled_at IS NULL
    AND (
      (b.customer_id = NEW.customer_id AND cti.id = NEW.charge_item_id
        AND (NOT v_correction OR (r.ref >= coalesce(NEW.valid_from, r.ref) AND r.ref <= coalesce(NEW.valid_to, r.ref))))
      OR (TG_OP = 'UPDATE' AND b.customer_id = OLD.customer_id AND cti.id = OLD.charge_item_id
        AND (NOT v_correction OR (r.ref >= coalesce(OLD.valid_from, r.ref) AND r.ref <= coalesce(OLD.valid_to, r.ref))))
    );
  IF v_bls IS NOT NULL THEN
    PERFORM public._reprice_bls_after_tariff_change(v_bls, v_correction, v_correction);
  END IF;
  RETURN NULL;
END;
$function$;

-- Base atual dos B/Ls já calculados; preço de hoje para os que têm CE.
INSERT INTO public.bl_charge_calculation_basis (bl_id, basis, calculated_at)
SELECT b.id, public.bl_invoice_basis_snapshot(b.id), coalesce(b.charges_calculated_at, now())
FROM public.bls b
WHERE coalesce(b.charge_status, 'not_calculated') <> 'not_calculated'
ON CONFLICT (bl_id) DO NOTHING;

DO $$
DECLARE v_id text;
BEGIN
  FOR v_id IN SELECT b.id FROM public.bls b WHERE nullif(btrim(b.ce_mercante), '') IS NOT NULL ORDER BY b.id LOOP
    PERFORM public.freeze_bl_prices(v_id);
  END LOOP;
END $$;

-- Cliente vinculado ou trocado depois do CE: a Condição congelada passa a ser
-- a do novo Cliente na data de referência congelada. O nome ordena antes de
-- `trg_sync_receivable_on_bl_customer_link`, que recalcula.
CREATE OR REPLACE FUNCTION public.freeze_follows_bl_customer()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.bl_price_freeze_items fi
     SET override_value = public._customer_override_value(NEW.customer_id, fi.charge_item_id, f.reference_date)
    FROM public.bl_price_freezes f
   WHERE f.bl_id = NEW.id AND fi.bl_id = f.bl_id;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.freeze_follows_bl_customer() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER freeze_follows_bl_customer
  AFTER UPDATE OF customer_id ON public.bls
  FOR EACH ROW WHEN (OLD.customer_id IS DISTINCT FROM NEW.customer_id)
  EXECUTE FUNCTION public.freeze_follows_bl_customer();

-- Preço congelado e base saem com o B/L também sem as FKs (ver 354).
CREATE OR REPLACE FUNCTION public.drop_bl_financial_bindings()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  DELETE FROM public.bl_charge_table_links WHERE bl_id = OLD.id;
  DELETE FROM public.bl_price_freeze_items WHERE bl_id = OLD.id;
  DELETE FROM public.bl_price_freezes WHERE bl_id = OLD.id;
  DELETE FROM public.bl_charge_calculation_basis WHERE bl_id = OLD.id;
  RETURN NULL;
END;
$$;
