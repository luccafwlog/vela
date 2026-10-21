-- 378: o preço das Taxas Locais fica fixo na importação, não no CE
-- (ADR 0094, decisões A1 a A4; plano "preço fixo na importação e respostas às
-- pendências").
--
-- Problema: a 355 congelava o preço só no registro do CE e sem o câmbio; até
-- lá o B/L seguia a tabela e a Condição do dia, a data de referência era a ETA
-- da escala (359) e a ETA alterada recalculava o provisório (372). A Condição
-- nova recalculava os B/Ls sem CE (354), a emissão e o recebível convertiam o
-- dólar pelo câmbio do dia, e a reimportação de um arquivo idêntico mudava o
-- valor do B/L.
--
-- Mudança:
--   1. O primeiro cálculo do B/L (normalmente a importação) fixa a data de
--      referência (dia de Brasília), o câmbio e, para cada tabela vinculada,
--      os preços dos itens e a Condição do Cliente nessa data. O CE não fixa
--      nada. Tabela vinculada depois (POD ou modo novo, tabela que faltava)
--      entra com os preços dela naquele momento e a data e o câmbio fixados.
--   2. A data de referência é a fixada (sem preço fixado, o dia de hoje): a
--      ETA deixa de ancorar a Condição, e a ETA alterada não recalcula nada.
--   3. Criar, ativar ou desativar Condição não recalcula B/L existente; editar
--      item ou Condição continua sendo correção (ADR 0093, decisão 2).
--   4. A emissão, o recebível e o COD convertem o dólar pelo câmbio fixado.
--   5. `refix_bl_local_charge_prices`: só com o pedido (aceite da reimportação)
--      o preço de B/L não faturado é refixado no dia; sem ele, nunca.
--   6. Backfill: depende da afirmação "Data status" do AGENTS.md (seção
--      Gotchas): os dados de produção são de teste. O preço fixado do B/L não
--      faturado é refeito pela data da importação (`bls.created_at`) e pelo
--      câmbio do recebível; o do faturado ganha o câmbio da fatura.

ALTER TABLE public.bl_price_freezes
  ADD COLUMN roe numeric(10,4),
  ADD COLUMN roe_effective_date date,
  ADD COLUMN reason text NOT NULL DEFAULT 'primeiro_calculo'
    CHECK (reason IN ('primeiro_calculo', 'importacao', 'refixado', 'faturado'));
COMMENT ON TABLE public.bl_price_freezes IS
  'Preço fixo do B/L (ADR 0094): data de referência, câmbio e, em bl_price_freeze_items, preço e Condição de cada item das tabelas vinculadas.';

-- Câmbio fixado do B/L; sem preço fixado, o do dia.
CREATE OR REPLACE FUNCTION public._bl_fixed_roe(p_bl_id text)
RETURNS TABLE(roe numeric, effective_date date)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT f.roe, f.roe_effective_date FROM public.bl_price_freezes f WHERE f.bl_id = p_bl_id AND f.roe IS NOT NULL
  UNION ALL
  SELECT r.roe, r.effective_date FROM public.exchange_rate_reference r
  WHERE r.id = 1 AND NOT EXISTS (SELECT 1 FROM public.bl_price_freezes f WHERE f.bl_id = p_bl_id AND f.roe IS NOT NULL)
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public._bl_fixed_roe(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.bl_local_charge_reference_date(p_bl_id text, p_pod text DEFAULT NULL::text)
RETURNS date
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  -- ADR 0094: a data de referência da Tarifa é a fixada no primeiro cálculo
  -- (dia de Brasília); sem preço fixado, hoje. A ETA não entra. p_pod fica
  -- por compatibilidade com os chamadores.
  SELECT coalesce(
    (SELECT f.reference_date FROM public.bl_price_freezes f WHERE f.bl_id = upper(btrim(p_bl_id))),
    (now() AT TIME ZONE 'America/Sao_Paulo')::date);
$$;

CREATE OR REPLACE FUNCTION public.freeze_bl_prices(p_bl_id text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_customer bigint;
  v_ref date;
BEGIN
  SELECT b.customer_id INTO v_customer FROM public.bls b WHERE b.id = p_bl_id;
  IF NOT FOUND THEN RETURN; END IF;
  INSERT INTO public.bl_price_freezes (bl_id, reference_date, roe, roe_effective_date, reason)
  SELECT p_bl_id, (now() AT TIME ZONE 'America/Sao_Paulo')::date, r.roe, r.effective_date, 'primeiro_calculo'
  FROM (SELECT 1) one LEFT JOIN public.exchange_rate_reference r ON r.id = 1
  ON CONFLICT (bl_id) DO NOTHING;
  -- O câmbio que faltava no primeiro cálculo entra quando existir.
  UPDATE public.bl_price_freezes f SET roe = r.roe, roe_effective_date = r.effective_date
    FROM public.exchange_rate_reference r
   WHERE f.bl_id = p_bl_id AND f.roe IS NULL AND r.id = 1 AND r.roe IS NOT NULL;
  SELECT reference_date INTO v_ref FROM public.bl_price_freezes WHERE bl_id = p_bl_id;
  INSERT INTO public.bl_price_freeze_items (bl_id, charge_item_id, unit_value_brl, unit_value_usd, override_value)
  SELECT p_bl_id, cti.id, cti.unit_value_brl, cti.unit_value_usd,
    public._customer_override_value(v_customer, cti.id, v_ref)
  FROM public.bl_charge_table_links l
  JOIN public.charge_table_items cti ON cti.charge_table_id = l.charge_table_id
  WHERE l.bl_id = p_bl_id
  ON CONFLICT DO NOTHING;
END;
$$;
REVOKE ALL ON FUNCTION public.freeze_bl_prices(text) FROM PUBLIC, anon, authenticated;

-- O CE não fixa nada; a ETA não recalcula nada.
DROP TRIGGER IF EXISTS freeze_bl_prices_on_ce ON public.bls;
DROP FUNCTION IF EXISTS public.freeze_bl_prices_on_ce();
DROP TRIGGER IF EXISTS recalculate_provisional_bls_on_eta ON public.voyages;
DROP FUNCTION IF EXISTS public.recalculate_provisional_bls_on_eta();

-- Refixar o preço só a pedido (aceite da reimportação, ADR 0094, A2).
CREATE OR REPLACE FUNCTION public.refix_bl_local_charge_prices(p_bl_ids text[], p_reason text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_bl record;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_refixed text[] := ARRAY[]::text[];
  v_skipped jsonb := '[]'::jsonb;
  v_before jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' AND (auth.uid() IS NULL OR NOT public.is_active_user()) THEN
    RAISE EXCEPTION 'Sem permissão para refixar o preço do B/L.' USING ERRCODE = '42501';
  END IF;
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'Informe o motivo de refixar o preço (aceite da reimportação).' USING ERRCODE = '22023';
  END IF;
  FOR v_bl IN
    SELECT b.id, b.cancelled_at, coalesce(b.financial_status, 'pending') AS fs
    FROM public.bls b WHERE b.id = ANY(coalesce(p_bl_ids, ARRAY[]::text[])) ORDER BY b.id FOR UPDATE
  LOOP
    IF v_bl.cancelled_at IS NOT NULL THEN
      v_skipped := v_skipped || jsonb_build_object('bl_id', v_bl.id, 'reason', 'cancelled');
      CONTINUE;
    END IF;
    -- B/L faturado segue a ADR 0093, decisão 4: o preço é o da fatura.
    IF v_bl.fs <> 'pending' OR cardinality(public._live_local_invoice_ids_for_bl(v_bl.id)) > 0 THEN
      v_skipped := v_skipped || jsonb_build_object('bl_id', v_bl.id, 'reason', 'billed');
      CONTINUE;
    END IF;
    SELECT to_jsonb(f) INTO v_before FROM public.bl_price_freezes f WHERE f.bl_id = v_bl.id;
    DELETE FROM public.bl_price_freeze_items WHERE bl_id = v_bl.id;
    DELETE FROM public.bl_price_freezes WHERE bl_id = v_bl.id;
    DELETE FROM public.bl_charge_table_links WHERE bl_id = v_bl.id;
    PERFORM public._calculate_bl_local_charges_impl_106(v_bl.id, auth.uid(), true);
    UPDATE public.bl_price_freezes SET reason = 'refixado' WHERE bl_id = v_bl.id;
    INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
    VALUES ('bl', v_bl.id, 'local_charge_prices_refixed', v_before::text,
      (SELECT to_jsonb(f)::text FROM public.bl_price_freezes f WHERE f.bl_id = v_bl.id), auth.uid(), v_reason);
    v_refixed := v_refixed || v_bl.id;
  END LOOP;
  RETURN jsonb_build_object('refixed', to_jsonb(v_refixed), 'skipped', v_skipped);
END;
$$;
REVOKE ALL ON FUNCTION public.refix_bl_local_charge_prices(text[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.refix_bl_local_charge_prices(text[], text) TO authenticated, service_role;

-- Condição nova não recalcula; correção sim.
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
  -- ADR 0094, A3: criar, ativar ou desativar Condição não mexe em B/L
  -- existente (vale para os que entrarem depois ou para a reimportação com
  -- aceite). Mudar valor ou vigência de Condição ativa é correção (decisão 2
  -- da ADR 0093): vale para todos os B/Ls na vigência antiga ou nova.
  v_correction := TG_OP = 'UPDATE' AND OLD.active AND NEW.active;
  IF NOT v_correction THEN
    RETURN NULL;
  END IF;
  IF v_correction AND OLD.override_value = NEW.override_value AND OLD.valid_from IS NOT DISTINCT FROM NEW.valid_from
     AND OLD.valid_to IS NOT DISTINCT FROM NEW.valid_to AND OLD.charge_item_id IS NOT DISTINCT FROM NEW.charge_item_id
     AND OLD.customer_id IS NOT DISTINCT FROM NEW.customer_id THEN
    RETURN NULL;
  END IF;

  -- Correção: o preço fixado dos B/Ls do Cliente acompanha.
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

-- O cálculo fixa o preço.
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

-- Recebível, COD e emissão pelo câmbio fixado.
CREATE OR REPLACE FUNCTION public._sync_local_charge_receivable_before_correction_123(p_bl_id text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bl RECORD;
  v_amount NUMERIC(14,2);
  v_roe NUMERIC(10,4);
  v_roe_effective_date DATE;
  v_paid_amount NUMERIC(14,2);
  v_receivable_id BIGINT;
  v_status TEXT;
BEGIN
  IF auth.uid() IS NOT NULL
     AND NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Credenciais invalidas ou sem permissao de faturamento.' USING ERRCODE = '42501';
  END IF;

  -- Igualdade em `id` usa a chave primária; a comparação sem caixa só roda
  -- quando o id exato não existe (migration 180, M07).
  SELECT id, customer_id, voyage_id, cargo_mode, pol, pod
  INTO v_bl
  FROM public.bls
  WHERE id = btrim(p_bl_id);
  IF NOT FOUND THEN
    SELECT id, customer_id, voyage_id, cargo_mode, pol, pod
    INTO v_bl
    FROM public.bls
    WHERE UPPER(id) = UPPER(btrim(p_bl_id))
    LIMIT 1;
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L % nao encontrado.', p_bl_id USING ERRCODE = 'P0002';
  END IF;

  -- Se o B/L ainda nao tem cliente vinculado, a sincronizacao de recebivel
  -- aguarda a conciliacao cadastral (reconcile/relink). O calculo das taxas
  -- locais permanece preservado.
  IF v_bl.customer_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- ADR 0094: o câmbio é o fixado no primeiro cálculo do B/L.
  SELECT r.roe, r.effective_date INTO v_roe, v_roe_effective_date
  FROM public._bl_fixed_roe(v_bl.id) r;

  IF v_roe IS NULL AND EXISTS (
    SELECT 1 FROM public.charge_calculations AS cc
    WHERE cc.bl_id = v_bl.id
      AND COALESCE(cc.total_value_usd, 0) > 0
      AND COALESCE(cc.status, 'calculated') IN ('calculated', 'reviewed', 'ready_for_billing')
  ) THEN
    RAISE EXCEPTION 'Cambio (ROE) nao configurado; nao e possivel calcular o saldo de linhas em USD.' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(SUM(
    COALESCE(cc.total_value_brl, CASE WHEN COALESCE(cc.total_value_usd, 0) > 0 THEN ROUND(cc.total_value_usd * v_roe, 2) END, 0)
  ), 0)
  INTO v_amount
  FROM public.charge_calculations AS cc
  WHERE cc.bl_id = v_bl.id
    AND COALESCE(cc.status, 'calculated') IN ('calculated', 'reviewed', 'ready_for_billing');

  SELECT COALESCE(SUM(p.amount_brl), 0)
  INTO v_paid_amount
  FROM public.invoice_bls ib
  JOIN public.invoices i ON i.id = ib.invoice_id
  JOIN public.payments p ON p.invoice_id = i.id
  WHERE ib.bl_id = v_bl.id
    AND COALESCE(i.status, 'issued') = 'paid'
    AND i.customer_id = v_bl.customer_id
    AND NOT EXISTS (SELECT 1 FROM public.invoice_customer_changes c
      WHERE c.bl_id = v_bl.id AND i.id = ANY(c.original_invoice_ids)
        AND c.status IN ('reissue_pending', 'completed'));

  v_paid_amount := LEAST(v_paid_amount, v_amount);
  v_status := CASE
    WHEN v_amount <= 0 THEN 'void'
    WHEN v_paid_amount >= v_amount THEN 'settled'
    WHEN v_paid_amount > 0 THEN 'partially_settled'
    ELSE 'open'
  END;

  INSERT INTO public.bl_receivables (
    bl_id, customer_id, source, original_amount_brl, settled_amount_brl, balance_brl,
    status, voyage_id, cargo_mode, pol, pod, roe_frozen, roe_effective_date_frozen, updated_at
  )
  VALUES (
    v_bl.id, v_bl.customer_id, 'local_charges', v_amount, v_paid_amount,
    GREATEST(v_amount - v_paid_amount, 0), v_status, v_bl.voyage_id,
    v_bl.cargo_mode, v_bl.pol, v_bl.pod, v_roe, v_roe_effective_date, now()
  )
  ON CONFLICT (source, bl_id)
  DO UPDATE SET
    customer_id = EXCLUDED.customer_id,
    original_amount_brl = EXCLUDED.original_amount_brl,
    settled_amount_brl = EXCLUDED.settled_amount_brl,
    balance_brl = EXCLUDED.balance_brl,
    status = EXCLUDED.status,
    voyage_id = EXCLUDED.voyage_id,
    cargo_mode = EXCLUDED.cargo_mode,
    pol = EXCLUDED.pol,
    pod = EXCLUDED.pod,
    roe_frozen = EXCLUDED.roe_frozen,
    roe_effective_date_frozen = EXCLUDED.roe_effective_date_frozen,
    updated_at = now()
  RETURNING id INTO v_receivable_id;

  RETURN v_receivable_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.apply_cod_financial_effect_legacy_130(p_bl_id text, p_omission_id bigint, p_previous_pod text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor UUID := auth.uid();
  v_bl RECORD;
  v_invoice_id BIGINT;
  v_invoice_snapshot_total NUMERIC(14,2) := 0;
  v_invoice_snapshot_count INTEGER := 0;
  v_previous_adjustment_total NUMERIC(14,2) := 0;
  v_previous_adjustment_count INTEGER := 0;
  v_original_total NUMERIC(14,2) := 0;
  v_new_total NUMERIC(14,2) := 0;
  v_manual_total NUMERIC(14,2) := 0;
  v_paid_amount NUMERIC(14,2) := 0;
  v_outstanding NUMERIC(14,2) := 0;
  v_difference NUMERIC(14,2) := 0;
  v_offset_amount NUMERIC(14,2) := 0;
  v_refund_amount NUMERIC(14,2) := 0;
  v_action TEXT;
  v_manual_review BOOLEAN := false;
  v_has_manual_lines BOOLEAN := false;
  v_roe NUMERIC(10,4);
  v_roe_effective_date DATE;
BEGIN
  IF v_actor IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa.' USING ERRCODE = '42501';
  END IF;

  SELECT b.id, b.pod, b.financial_status
  INTO v_bl
  FROM public.bls AS b
  WHERE b.id = p_bl_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L % nao encontrado', p_bl_id USING ERRCODE = 'P0002';
  END IF;

  -- ADR 0094: o COD muda a tabela (POD novo), não o câmbio fixado.
  SELECT r.roe, r.effective_date
  INTO v_roe, v_roe_effective_date
  FROM public._bl_fixed_roe(p_bl_id) r;

  IF v_roe IS NULL AND EXISTS (
    SELECT 1
    FROM public.charge_calculations AS cc
    WHERE cc.bl_id = p_bl_id
      AND COALESCE(cc.total_value_usd, 0) > 0
  ) THEN
    RAISE EXCEPTION 'Cambio (ROE) nao configurado; nao e possivel calcular linhas em USD.'
      USING ERRCODE = '22023';
  END IF;

  SELECT
    COALESCE(SUM(COALESCE(cc.total_value_brl,
      CASE WHEN COALESCE(cc.total_value_usd, 0) > 0
        THEN ROUND(cc.total_value_usd * v_roe, 2)
      END,
      0)), 0),
    BOOL_OR(COALESCE(cc.source, 'auto') = 'manual')
  INTO v_original_total, v_has_manual_lines
  FROM public.charge_calculations AS cc
  WHERE cc.bl_id = p_bl_id;

  v_original_total := ROUND(COALESCE(v_original_total, 0), 2);
  v_has_manual_lines := COALESCE(v_has_manual_lines, false);

  SELECT COALESCE(SUM(COALESCE(cc.total_value_brl,
    CASE WHEN COALESCE(cc.total_value_usd, 0) > 0
      THEN ROUND(cc.total_value_usd * v_roe, 2)
    END,
    0)), 0)
  INTO v_manual_total
  FROM public.charge_calculations AS cc
  WHERE cc.bl_id = p_bl_id
    AND COALESCE(cc.source, 'auto') = 'manual';
  v_manual_total := ROUND(COALESCE(v_manual_total, 0), 2);

  -- Pending/non-invoiced B/Ls use the existing writing calculator. Manual
  -- rows are source = manual, so calculate_bl_local_charges deletes only auto
  -- rows and preserves their operator-entered intent.
  IF COALESCE(v_bl.financial_status, 'pending') NOT IN ('invoiced', 'partially_paid', 'paid') THEN
    PERFORM public.calculate_bl_local_charges(
      p_bl_id => p_bl_id,
      p_actor => v_actor,
      p_recalculate => true
    );

    IF v_has_manual_lines THEN
      SELECT COALESCE(SUM(COALESCE(cc.total_value_brl, 0)), 0)
      INTO v_new_total
      FROM public.charge_calculations AS cc
      WHERE cc.bl_id = p_bl_id;
      v_new_total := ROUND(COALESCE(v_new_total, 0), 2);
      v_difference := ROUND(v_new_total - v_original_total, 2);
      v_action := 'manual_charge_review';
      v_manual_review := true;
    ELSE
      RETURN;
    END IF;
  ELSE
    -- Billed states must never call the writing calculator: it intentionally
    -- rejects these states. The 311 helper is the single price-resolution
    -- source for both the previous and already-updated destination PODs.
    -- A ponta nova é uma prévia do destino atual. Linhas em USD precisam do
    -- ROE autoritativo do evento; total_value_brl é nulo nessas linhas.
    SELECT roe, effective_date
    INTO v_roe, v_roe_effective_date
    FROM public.exchange_rate_reference
    WHERE id = 1;

    IF v_roe IS NULL AND EXISTS (
      SELECT 1
      FROM public.resolve_bl_local_charge_items(p_bl_id, v_bl.pod) AS item
      WHERE COALESCE(item.total_value_usd, 0) > 0
    ) THEN
      RAISE EXCEPTION 'Cambio (ROE) nao configurado; nao e possivel reprecificar linhas em USD.'
        USING ERRCODE = '22023';
    END IF;

    SELECT COALESCE(SUM(
      COALESCE(item.total_value_brl,
        CASE WHEN COALESCE(item.total_value_usd, 0) > 0
          THEN ROUND(item.total_value_usd * v_roe, 2)
        END,
        0)
    ), 0)
    INTO v_new_total
    FROM public.resolve_bl_local_charge_items(p_bl_id, v_bl.pod) AS item;
    v_new_total := ROUND(COALESCE(v_new_total, 0) + v_manual_total, 2);

    -- A ponta original não é a tabela vigente do POD antigo. O documento que
    -- efetivamente faturou o B/L (invoice_bls, inclusive consolidadas) é o
    -- snapshot monetário; invoice_items/invoices são fallbacks legados.
    SELECT i.id
    INTO v_invoice_id
    FROM public.invoices AS i
    WHERE COALESCE(i.status, 'issued') NOT IN ('cancelled', 'obsolete', 'covered')
      AND (i.bl_id = p_bl_id OR EXISTS (
        SELECT 1 FROM public.invoice_bls AS ib
        WHERE ib.invoice_id = i.id AND ib.bl_id = p_bl_id
      ))
    ORDER BY i.issued_at DESC NULLS LAST, i.id DESC
    LIMIT 1;

    IF v_invoice_id IS NOT NULL THEN
      SELECT COALESCE(SUM(ib.subtotal_brl), 0), COUNT(*)
      INTO v_invoice_snapshot_total, v_invoice_snapshot_count
      FROM public.invoice_bls AS ib
      WHERE ib.invoice_id = v_invoice_id AND ib.bl_id = p_bl_id;

      IF v_invoice_snapshot_count = 0 THEN
        SELECT COALESCE(SUM(COALESCE(
          ii.total_value_brl,
          CASE WHEN COALESCE(ii.total_value_usd, 0) > 0
            THEN ROUND(ii.total_value_usd * NULLIF(ii.snapshot_payload->>'roe', '')::NUMERIC, 2)
          END,
          0
        )), 0), COUNT(*)
        INTO v_invoice_snapshot_total, v_invoice_snapshot_count
        FROM public.invoice_items AS ii
        WHERE ii.invoice_id = v_invoice_id AND ii.bl_id = p_bl_id;
      END IF;

      IF v_invoice_snapshot_count = 0 THEN
        SELECT COALESCE(i.total_brl, 0), 1
        INTO v_invoice_snapshot_total, v_invoice_snapshot_count
        FROM public.invoices AS i
        WHERE i.id = v_invoice_id;
      END IF;
    END IF;

    -- F-18 (368): B/L coberto por consolidada paga (a individual saiu da
    -- busca por estar coberta): o documento é a consolidada, pelo vínculo.
    IF v_invoice_snapshot_count = 0 THEN
      SELECT coalesce(sum(l.subtotal_brl), 0), count(*)
      INTO v_invoice_snapshot_total, v_invoice_snapshot_count
      FROM public.invoice_receivable_links AS l
      WHERE l.bl_id = p_bl_id AND l.status IN ('active', 'settled_by_this_invoice')
        AND l.invoice_id = (
          SELECT i.id FROM public.invoice_receivable_links AS l2 JOIN public.invoices AS i ON i.id = l2.invoice_id
          WHERE l2.bl_id = p_bl_id AND l2.status IN ('active', 'settled_by_this_invoice')
            AND coalesce(i.status, 'issued') NOT IN ('cancelled', 'obsolete', 'covered')
          ORDER BY i.issued_at DESC NULLS LAST, i.id DESC LIMIT 1);
    END IF;

    IF v_invoice_snapshot_count = 0 THEN
      RAISE EXCEPTION 'Nao foi encontrado snapshot da fatura do B/L %.', p_bl_id
        USING ERRCODE = 'P0002';
    END IF;
    v_original_total := ROUND(COALESCE(v_invoice_snapshot_total, 0), 2);

    -- Em uma reversão COD → transbordo (ou nova ida ao COD), a comparação é
    -- contra o último destino efetivamente registrado, para que cada
    -- transição gere seu próprio evento mesmo quando o snapshot original da
    -- invoice permanece imutável.
    SELECT new_destination_value_brl, 1
    INTO v_previous_adjustment_total, v_previous_adjustment_count
    FROM public.cod_adjustments
    WHERE bl_id = p_bl_id AND omission_id = p_omission_id
    ORDER BY id DESC
    LIMIT 1;
    IF v_previous_adjustment_count > 0 THEN
      v_original_total := ROUND(v_previous_adjustment_total, 2);
    END IF;

    SELECT COALESCE(SUM(
      CASE
        WHEN ib.invoice_id IS NOT NULL
          AND COALESCE(i.total_brl, 0) > 0
          AND EXISTS (
            SELECT 1
            FROM public.invoice_bls AS ib_other
            WHERE ib_other.invoice_id = i.id
              AND ib_other.bl_id <> p_bl_id
          )
        THEN p.amount_brl * COALESCE(ib.subtotal_brl, 0) / i.total_brl
        ELSE p.amount_brl
      END
    ), 0)
    INTO v_paid_amount
    FROM public.payments AS p
    JOIN public.invoices AS i ON i.id = p.invoice_id
    LEFT JOIN public.invoice_bls AS ib
      ON ib.invoice_id = i.id AND ib.bl_id = p_bl_id
    WHERE COALESCE(i.status, 'issued') <> 'cancelled'
      AND (i.bl_id = p_bl_id OR ib.bl_id = p_bl_id);
    v_paid_amount := ROUND(GREATEST(COALESCE(v_paid_amount, 0), 0), 2);
    IF v_paid_amount = 0 THEN
      SELECT COALESCE(SUM(COALESCE(i.total_paid_brl, 0)), 0)
      INTO v_paid_amount
      FROM public.invoices AS i
      WHERE i.bl_id = p_bl_id
        AND COALESCE(i.status, 'issued') <> 'cancelled';
      v_paid_amount := ROUND(GREATEST(COALESCE(v_paid_amount, 0), 0), 2);
    END IF;
    -- F-18 (368): o pago pela consolidada está no recebível do B/L.
    SELECT greatest(v_paid_amount, coalesce(max(r.settled_amount_brl), 0)) INTO v_paid_amount
    FROM public.bl_receivables AS r WHERE r.bl_id = p_bl_id AND r.source = 'local_charges';
    v_paid_amount := ROUND(v_paid_amount, 2);
    v_outstanding := ROUND(GREATEST(v_original_total - v_paid_amount, 0), 2);
    v_difference := ROUND(v_new_total - v_original_total, 2);

    -- F-41 (368): sem diferença não há ajuste (antes, a fatura sem pagamento
    -- ganhava um "Cancelar e reemitir" que nunca se liquidava).
    IF v_difference = 0 THEN
      RETURN;
    END IF;

    -- An unpaid invoice is the only cancel/reissue branch. A B/L remains
    -- financial_status = invoiced while its invoice is partially paid, so
    -- payment money—not only the coarse B/L status—selects the next branch.
    IF v_paid_amount = 0 THEN
      v_action := 'cancel_and_reissue';
      v_manual_review := true;
    ELSIF v_difference > 0 THEN
      v_action := 'complementary_invoice';
    ELSIF v_difference < 0 THEN
      v_offset_amount := ROUND(LEAST(ABS(v_difference), v_outstanding), 2);
      v_refund_amount := ROUND(GREATEST(ABS(v_difference) - v_outstanding, 0), 2);
      v_action := CASE
        WHEN v_refund_amount > 0 THEN 'refund_overpayment'
        ELSE 'offset_open_balance'
      END;
    ELSE
      RETURN;
    END IF;
  END IF;

  INSERT INTO public.cod_adjustments (
    bl_id,
    omission_id,
    original_value_brl,
    new_destination_value_brl,
    difference_brl,
    paid_amount_brl,
    outstanding_balance_brl,
    offset_amount_brl,
    refund_amount_brl,
    action,
    status,
    manual_review_required,
    resulting_document_id,
    resulting_document_type,
    created_by
  )
  VALUES (
    p_bl_id,
    p_omission_id,
    ROUND(v_original_total, 2),
    ROUND(v_new_total, 2),
    ROUND(v_difference, 2),
    ROUND(v_paid_amount, 2),
    ROUND(v_outstanding, 2),
    ROUND(v_offset_amount, 2),
    ROUND(v_refund_amount, 2),
    v_action,
    'pending',
    v_manual_review,
    NULL,
    NULL,
    v_actor
  )
  ;
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_invoice_from_bls_core(p_bl_ids text[], p_customer_id bigint, p_notes text DEFAULT NULL::text, p_issue_now boolean DEFAULT true, p_actor uuid DEFAULT NULL::uuid, p_origin text DEFAULT 'internal'::text, p_portal_account_id bigint DEFAULT NULL::bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_requested_bls TEXT[];
  v_bl_count INTEGER;
  v_missing_bls TEXT;
  v_customer_id BIGINT;
  v_max_customer_id BIGINT;
  v_conflict_count INTEGER;
  v_usd_count INTEGER;
  v_invoice_id BIGINT;
  v_invoice_number TEXT;
  v_total_brl NUMERIC(14,2);
  v_item_count INTEGER;
  v_status TEXT;
  v_batch_id BIGINT;
  v_roe NUMERIC(10,4);
  v_roe_effective_date DATE;
BEGIN
  v_status := CASE WHEN COALESCE(p_issue_now, true) THEN 'issued' ELSE 'draft' END;

  SELECT ARRAY_AGG(DISTINCT UPPER(TRIM(bl_id)) ORDER BY UPPER(TRIM(bl_id)))
  INTO v_requested_bls
  FROM UNNEST(COALESCE(p_bl_ids, ARRAY[]::TEXT[])) AS input(bl_id)
  WHERE TRIM(COALESCE(bl_id, '')) <> '';

  IF COALESCE(ARRAY_LENGTH(v_requested_bls, 1), 0) = 0 THEN
    RAISE EXCEPTION 'Nenhum B/L informado para emissao.' USING ERRCODE = '22023';
  END IF;

  PERFORM 1
  FROM public.bls
  WHERE id = ANY(v_requested_bls)
  FOR UPDATE;

  SELECT COUNT(*) INTO v_bl_count
  FROM public.bls
  WHERE id = ANY(v_requested_bls);

  IF v_bl_count <> ARRAY_LENGTH(v_requested_bls, 1) THEN
    SELECT STRING_AGG(req.bl_id, ', ' ORDER BY req.bl_id)
    INTO v_missing_bls
    FROM UNNEST(v_requested_bls) AS req(bl_id)
    LEFT JOIN public.bls AS b ON b.id = req.bl_id
    WHERE b.id IS NULL;

    RAISE EXCEPTION 'B/L(s) nao encontrado(s): %', COALESCE(v_missing_bls, '-')
      USING ERRCODE = 'P0002';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.bls AS b
    WHERE b.id = ANY(v_requested_bls)
      AND COALESCE(b.charge_status, 'not_calculated') <> 'ready_for_billing'
  ) THEN
    RAISE EXCEPTION 'Todos os B/Ls devem estar como ready_for_billing.' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.bls AS b
    WHERE b.id = ANY(v_requested_bls)
      AND COALESCE(b.financial_status, 'pending') <> 'pending'
  ) THEN
    RAISE EXCEPTION 'Existe B/L ja faturado/pago/cancelado na selecao.' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.bls AS b
    WHERE b.id = ANY(v_requested_bls)
      AND (b.customer_id IS NULL OR COALESCE(b.customer_reconciliation_status, 'missing_customer') NOT IN ('matched_document', 'reconciled'))
  ) THEN
    RAISE EXCEPTION 'Todos os B/Ls precisam de cliente reconciliado para faturar.' USING ERRCODE = '22023';
  END IF;

  SELECT MIN(b.customer_id), MAX(b.customer_id)
  INTO v_customer_id, v_max_customer_id
  FROM public.bls AS b
  WHERE b.id = ANY(v_requested_bls);

  IF v_customer_id IS NULL OR v_customer_id <> v_max_customer_id THEN
    RAISE EXCEPTION 'Selecao contem B/Ls de clientes diferentes.' USING ERRCODE = '22023';
  END IF;

  IF p_customer_id IS NOT NULL AND p_customer_id <> v_customer_id THEN
    RAISE EXCEPTION 'Cliente informado nao corresponde aos B/Ls selecionados.' USING ERRCODE = '22023';
  END IF;

  IF NOT public.customer_billing_access_ready(v_customer_id) THEN
    RAISE EXCEPTION 'Emissao bloqueada: conta do Portal do cliente nao esta pronta para receber a fatura.' USING ERRCODE = 'P0003';
  END IF;

  SELECT COUNT(*)
  INTO v_conflict_count
  FROM public.invoice_bls AS ib
  JOIN public.invoices AS inv ON inv.id = ib.invoice_id
  WHERE ib.bl_id = ANY(v_requested_bls)
    AND COALESCE(inv.status, 'issued') IN ('draft', 'issued', 'partially_paid', 'overdue');

  IF v_conflict_count > 0 THEN
    RAISE EXCEPTION 'Existe B/L vinculado a invoice ativa.' USING ERRCODE = '23505';
  END IF;

  -- ADR 0094: cada B/L converte pelo câmbio fixado no primeiro cálculo; o do
  -- dia só vale para B/L sem câmbio fixado.
  SELECT COUNT(*)
  INTO v_usd_count
  FROM public.charge_calculations AS cc
  LEFT JOIN public.bl_price_freezes AS fz ON fz.bl_id = cc.bl_id
  WHERE cc.bl_id = ANY(v_requested_bls)
    AND fz.roe IS NULL
    AND COALESCE(cc.total_value_usd, 0) > 0
    AND COALESCE(cc.status, 'calculated') IN ('calculated', 'reviewed', 'ready_for_billing');

  IF v_usd_count > 0 THEN
    SELECT roe, effective_date INTO v_roe, v_roe_effective_date
    FROM public.exchange_rate_reference WHERE id = 1;

    IF v_roe IS NULL THEN
      RAISE EXCEPTION 'Cambio (ROE) nao configurado; nao e possivel converter linhas em USD para emitir a fatura.' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF ARRAY_LENGTH(v_requested_bls, 1) > 1 THEN
    INSERT INTO public.billing_batches (
      customer_id,
      origin,
      status,
      notes,
      requested_by,
      portal_account_id
    )
    VALUES (
      v_customer_id,
      COALESCE(p_origin, 'internal'),
      'requested',
      NULLIF(TRIM(COALESCE(p_notes, '')), ''),
      p_actor,
      p_portal_account_id
    )
    RETURNING id INTO v_batch_id;
  END IF;

  INSERT INTO public.invoices (
    customer_id,
    bl_id,
    issued_at,
    total_brl,
    status,
    notes,
    total_paid_brl,
    balance_brl,
    issued_by
  )
  VALUES (
    v_customer_id,
    CASE WHEN ARRAY_LENGTH(v_requested_bls, 1) = 1 THEN v_requested_bls[1] ELSE NULL END,
    CASE WHEN v_status = 'issued' THEN now() ELSE NULL END,
    0,
    v_status,
    NULLIF(TRIM(COALESCE(p_notes, '')), ''),
    0,
    0,
    p_actor
  )
  RETURNING id, invoice_number
  INTO v_invoice_id, v_invoice_number;

  INSERT INTO public.invoice_bls (
    invoice_id,
    bl_id,
    charge_status_snapshot,
    financial_status_snapshot,
    subtotal_brl,
    subtotal_usd
  )
  SELECT
    v_invoice_id,
    b.id,
    b.charge_status,
    b.financial_status,
    COALESCE(calc.total_brl, 0),
    COALESCE(calc.total_usd, 0)
  FROM public.bls AS b
  LEFT JOIN (
    -- Bug da review da PR 501 (achado 1): subtotal_brl precisa somar o MESMO
    -- valor convertido que alimenta invoice_items/invoices.total_brl (mesma
    -- conversao USD->BRL feita no INSERT de invoice_items abaixo), e nao
    -- apenas cc.total_value_brl -- que fica NULL para linhas em USD e
    -- deixava o subtotal do B/L zerado/nulo mesmo com fatura cobrando valor
    -- convertido. link_invoice_to_ledger usa esse subtotal para sobrescrever
    -- bl_receivables.original_amount_brl, entao um subtotal errado aqui
    -- zerava o receivable de B/Ls 100% em USD.
    SELECT
      cc.bl_id,
      SUM(COALESCE(cc.total_value_brl, CASE WHEN COALESCE(cti.currency, 'BRL') = 'USD' THEN ROUND(COALESCE(cc.total_value_usd, 0) * COALESCE(fz.roe, v_roe), 2) END, 0)) AS total_brl,
      SUM(COALESCE(cc.total_value_usd, 0)) AS total_usd
    FROM public.charge_calculations AS cc
    LEFT JOIN public.charge_table_items AS cti ON cti.id = cc.charge_item_id
    LEFT JOIN public.bl_price_freezes AS fz ON fz.bl_id = cc.bl_id
    WHERE cc.bl_id = ANY(v_requested_bls)
      AND COALESCE(cc.status, 'calculated') IN ('calculated', 'reviewed', 'ready_for_billing')
    GROUP BY cc.bl_id
  ) AS calc ON calc.bl_id = b.id
  WHERE b.id = ANY(v_requested_bls);

  INSERT INTO public.invoice_items (
    invoice_id,
    charge_calculation_id,
    description,
    quantity,
    unit_value_brl,
    total_value_brl,
    bl_id,
    manifest_id,
    charge_table_id,
    charge_item_id,
    source,
    currency,
    unit_value_usd,
    total_value_usd,
    pricing_rule_version_id,
    billing_run_id,
    calculation_key,
    snapshot_payload
  )
  SELECT
    v_invoice_id,
    cc.id,
    CONCAT('BL ', cc.bl_id, ' - ', COALESCE(cti.name, cc.calculation_key, 'Linha de taxa')),
    COALESCE(cc.quantity, 1),
    COALESCE(cc.unit_value_brl, CASE WHEN COALESCE(cti.currency, 'BRL') = 'USD' THEN ROUND(COALESCE(cc.unit_value_usd, 0) * COALESCE(fz.roe, v_roe), 2) END, 0),
    COALESCE(cc.total_value_brl, CASE WHEN COALESCE(cti.currency, 'BRL') = 'USD' THEN ROUND(COALESCE(cc.total_value_usd, 0) * COALESCE(fz.roe, v_roe), 2) END, 0),
    cc.bl_id,
    cc.manifest_id,
    cc.charge_table_id,
    cc.charge_item_id,
    cc.source,
    COALESCE(cti.currency, CASE WHEN COALESCE(cc.total_value_usd, 0) > 0 THEN 'USD' ELSE 'BRL' END),
    cc.unit_value_usd,
    cc.total_value_usd,
    cc.pricing_rule_version_id,
    cc.billing_run_id,
    cc.calculation_key,
    jsonb_build_object(
      'manifest_id', cc.manifest_id,
      'bl_id', cc.bl_id,
      'charge_table_id', cc.charge_table_id,
      'charge_item_id', cc.charge_item_id,
      'source', cc.source,
      'currency', COALESCE(cti.currency, CASE WHEN COALESCE(cc.total_value_usd, 0) > 0 THEN 'USD' ELSE 'BRL' END),
      'pricing_rule_version_id', cc.pricing_rule_version_id,
      'calculation_key', cc.calculation_key,
      'charge_name', cti.name,
      'shared_quantity_label', CASE
        WHEN cti.application_basis = 'container_distinct_voyage'
          AND cc.quantity > 0 AND cc.quantity < 1
        THEN CONCAT('1/', ROUND(1 / cc.quantity)::INTEGER)
        ELSE NULL
      END,
      'roe', CASE WHEN COALESCE(cti.currency, 'BRL') = 'USD' THEN COALESCE(fz.roe, v_roe) ELSE NULL END,
      'roe_effective_date', CASE WHEN COALESCE(cti.currency, 'BRL') = 'USD' THEN COALESCE(fz.roe_effective_date, v_roe_effective_date) ELSE NULL END
    )
  FROM public.charge_calculations AS cc
  LEFT JOIN public.charge_table_items AS cti ON cti.id = cc.charge_item_id
  LEFT JOIN public.bl_price_freezes AS fz ON fz.bl_id = cc.bl_id
  WHERE cc.bl_id = ANY(v_requested_bls)
    AND (COALESCE(cc.total_value_brl, 0) > 0 OR COALESCE(cc.total_value_usd, 0) > 0)
    AND COALESCE(cc.status, 'calculated') IN ('calculated', 'reviewed', 'ready_for_billing');

  GET DIAGNOSTICS v_item_count = ROW_COUNT;

  IF v_item_count = 0 THEN
    RAISE EXCEPTION 'Nenhuma linha BRL elegivel para faturamento.' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(SUM(total_value_brl), 0)
  INTO v_total_brl
  FROM public.invoice_items
  WHERE invoice_id = v_invoice_id;

  UPDATE public.invoices
  SET
    total_brl = v_total_brl,
    total_paid_brl = 0,
    balance_brl = v_total_brl
  WHERE id = v_invoice_id;

  IF v_status = 'issued' THEN
    UPDATE public.bls
    SET financial_status = 'invoiced'
    WHERE id = ANY(v_requested_bls);
  END IF;

  IF v_batch_id IS NOT NULL THEN
    UPDATE public.billing_batches
    SET
      status = CASE WHEN v_status = 'issued' THEN 'issued' ELSE 'requested' END,
      invoice_id = v_invoice_id,
      notes = NULLIF(TRIM(COALESCE(p_notes, '')), '')
    WHERE id = v_batch_id;
  END IF;

  INSERT INTO public.audit_logs (
    entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification
  )
  VALUES (
    'invoice',
    v_invoice_id::TEXT,
    'create_invoice',
    NULL,
    CONCAT('invoice=', v_invoice_number, ' | bl_count=', ARRAY_LENGTH(v_requested_bls, 1), ' | total=', v_total_brl),
    p_actor,
    now(),
    CASE WHEN COALESCE(p_origin, 'internal') = 'portal' THEN 'Emissao consolidada via portal do cliente' ELSE 'Emissao de invoice por B/L' END
  );

  RETURN jsonb_build_object(
    'invoice_id', v_invoice_id,
    'invoice_number', v_invoice_number,
    'status', v_status,
    'customer_id', v_customer_id,
    'bl_count', ARRAY_LENGTH(v_requested_bls, 1),
    'total_brl', v_total_brl,
    'balance_brl', v_total_brl,
    'billing_batch_id', v_batch_id
  );
END;
$function$;

-- Backfill (Data status): o preço fixado segue a data da importação.
DO $backfill_378$
DECLARE v_bl record;
BEGIN
  -- Faturados: o câmbio é o da fatura.
  UPDATE public.bl_price_freezes f SET reason = 'faturado',
    roe = coalesce(f.roe, (SELECT (ii.snapshot_payload->>'roe')::numeric FROM public.invoice_items ii
                             WHERE ii.bl_id = f.bl_id AND ii.snapshot_payload ? 'roe' AND ii.snapshot_payload->>'roe' IS NOT NULL
                             ORDER BY ii.id DESC LIMIT 1))
   WHERE EXISTS (SELECT 1 FROM public.bls b WHERE b.id = f.bl_id AND coalesce(b.financial_status, 'pending') <> 'pending');
  -- Não faturados com cálculo: preço refeito pela data da importação.
  FOR v_bl IN
    SELECT b.id, b.customer_id, (b.created_at AT TIME ZONE 'America/Sao_Paulo')::date AS imported_on
    FROM public.bls b
    WHERE b.cancelled_at IS NULL AND coalesce(b.financial_status, 'pending') = 'pending'
      AND EXISTS (SELECT 1 FROM public.charge_calculations cc WHERE cc.bl_id = b.id)
  LOOP
    DELETE FROM public.bl_price_freeze_items WHERE bl_id = v_bl.id;
    DELETE FROM public.bl_price_freezes WHERE bl_id = v_bl.id;
    INSERT INTO public.bl_price_freezes (bl_id, reference_date, roe, roe_effective_date, reason)
    SELECT v_bl.id, v_bl.imported_on,
      coalesce((SELECT r.roe_frozen FROM public.bl_receivables r WHERE r.bl_id = v_bl.id AND r.source = 'local_charges' ORDER BY r.id DESC LIMIT 1),
               (SELECT roe FROM public.exchange_rate_reference WHERE id = 1)),
      coalesce((SELECT r.roe_effective_date_frozen FROM public.bl_receivables r WHERE r.bl_id = v_bl.id AND r.source = 'local_charges' ORDER BY r.id DESC LIMIT 1),
               (SELECT effective_date FROM public.exchange_rate_reference WHERE id = 1)),
      'importacao';
    INSERT INTO public.bl_price_freeze_items (bl_id, charge_item_id, unit_value_brl, unit_value_usd, override_value)
    SELECT v_bl.id, cti.id, cti.unit_value_brl, cti.unit_value_usd,
      public._customer_override_value(v_bl.customer_id, cti.id, v_bl.imported_on)
    FROM public.bl_charge_table_links l
    JOIN public.charge_table_items cti ON cti.charge_table_id = l.charge_table_id
    WHERE l.bl_id = v_bl.id
    ON CONFLICT DO NOTHING;
  END LOOP;
END;
$backfill_378$;
