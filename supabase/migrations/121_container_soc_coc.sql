-- 121: propriedade do container (SOC/COC).
--
-- COC (carrier owned) e o container do armador; SOC (shipper owned) pertence
-- ao proprio cliente. O dado vem do B/L (coluna de propriedade na linha do
-- container) e do Baplie (EQD elemento 4, 8077: 1 = shipper supplied,
-- 2 = carrier supplied). O B/L e soberano; o Baplie so preenche o que o B/L
-- nao declarou, e a divergencia entre os dois aparece na conciliacao.
-- Sem informacao em nenhuma fonte, o container e tratado como COC.
--
-- Efeitos:
-- 1. bl_containers.ownership/ownership_source e baplie_containers.ownership.
-- 2. charge_table_items.applies_to_soc: item com false nao conta container
--    SOC no motor de taxas locais. Drop Off Fee e Damage Protection Fee ja
--    existentes passam a false.
-- 3. Container SOC nunca volta ao estoque: nao entra em fatura de Demurrage,
--    nunca fica "overdue" e nao conta no conjunto "todos os containers
--    devolvidos" do B/L.
-- 4. set_bl_container_ownership: correcao manual com justificativa e
--    recalculo de taxas (mesmo contrato de set_bl_container_profile, 115).
--
-- Data status (AGENTS.md, secao Gotchas): o UPDATE de charge_table_items abaixo
-- reescreve linhas existentes e depende da afirmacao de que o banco de
-- producao so tem dados de teste.

ALTER TABLE public.bl_containers
  ADD COLUMN IF NOT EXISTS ownership text,
  ADD COLUMN IF NOT EXISTS ownership_source text;
ALTER TABLE public.bl_containers
  DROP CONSTRAINT IF EXISTS bl_containers_ownership_check,
  ADD CONSTRAINT bl_containers_ownership_check CHECK (ownership IS NULL OR ownership IN ('SOC', 'COC')),
  DROP CONSTRAINT IF EXISTS bl_containers_ownership_source_check,
  ADD CONSTRAINT bl_containers_ownership_source_check CHECK (
    (ownership IS NULL AND ownership_source IS NULL)
    OR (ownership IS NOT NULL AND ownership_source IN ('bl', 'baplie', 'manual'))
  );
COMMENT ON COLUMN public.bl_containers.ownership IS 'SOC (do cliente) ou COC (do armador). NULL = nao informado, tratado como COC.';
COMMENT ON COLUMN public.bl_containers.ownership_source IS 'Origem do valor: bl (soberano), baplie (preenchimento) ou manual (justificado).';

ALTER TABLE public.baplie_containers
  ADD COLUMN IF NOT EXISTS ownership text;
ALTER TABLE public.baplie_containers
  DROP CONSTRAINT IF EXISTS baplie_containers_ownership_check,
  ADD CONSTRAINT baplie_containers_ownership_check CHECK (ownership IS NULL OR ownership IN ('SOC', 'COC'));

ALTER TABLE public.charge_table_items
  ADD COLUMN IF NOT EXISTS applies_to_soc boolean NOT NULL DEFAULT true;
COMMENT ON COLUMN public.charge_table_items.applies_to_soc IS 'false: o motor de taxas locais nao conta containers SOC para este item.';

UPDATE public.charge_table_items
SET applies_to_soc = false
WHERE applies_to_soc
  AND (name ILIKE '%drop%off%' OR name ILIKE '%damage%protection%');

-- Staging do Baplie grava a propriedade lida do EQD.
CREATE OR REPLACE FUNCTION public.import_baplie_staging_transactional(p_voyage_id bigint, p_rows jsonb) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_count INTEGER := COALESCE(jsonb_array_length(p_rows), 0);
  v_actor UUID := auth.uid();
  v_previous INTEGER := 0;
  v_role TEXT;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Credenciais invalidas ou sem permissao para importar Baplie.' USING ERRCODE = '42501';
  END IF;

  PERFORM set_config('alerts.baplie_coverage_deferred', 'on', true);

  SELECT count(*) INTO v_previous
  FROM public.baplie_containers
  WHERE voyage_id = p_voyage_id;

  DELETE FROM public.baplie_containers
  WHERE voyage_id = p_voyage_id;

  IF v_count > 0 THEN
    INSERT INTO public.baplie_containers (
      voyage_id,
      container_number,
      size_type,
      status,
      weight_kg,
      pol,
      pod,
      final_dest,
      bl_ref,
      slot,
      is_imo,
      imo_class,
      un_number,
      is_oog,
      ownership,
      imported_by
    )
    SELECT
      p_voyage_id,
      row.container_number,
      row.size_type,
      row.status,
      row.weight_kg,
      row.pol,
      row.pod,
      row.final_dest,
      row.bl_ref,
      row.slot,
      row.is_imo,
      row.imo_class,
      row.un_number,
      row.is_oog,
      CASE WHEN upper(btrim(row.ownership)) IN ('SOC', 'COC') THEN upper(btrim(row.ownership)) END,
      v_actor
    FROM jsonb_to_recordset(p_rows) AS row(
      container_number TEXT,
      size_type TEXT,
      status TEXT,
      weight_kg NUMERIC,
      pol TEXT,
      pod TEXT,
      final_dest TEXT,
      bl_ref TEXT,
      slot TEXT,
      is_imo BOOLEAN,
      imo_class TEXT,
      un_number TEXT,
      is_oog BOOLEAN,
      ownership TEXT
    );
  END IF;

  v_role := public.current_actor_role();
  INSERT INTO public.audit_logs(
    entity_type, entity_id, field_name, old_value, new_value,
    changed_by, justification, actor_role, actor_department
  ) VALUES (
    'voyage', p_voyage_id::text, 'baplie_import',
    v_previous::text, v_count::text,
    v_actor,
    CASE WHEN v_previous > 0 THEN 'Baplie substituído' ELSE 'Baplie importado' END,
    v_role, v_role
  );

  PERFORM set_config('alerts.baplie_coverage_deferred', 'off', true);
  PERFORM public.reconcile_voyage_baplie_coverage_alerts(p_voyage_id, 'baplie_coverage_import');
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.import_baplie_staging_transactional(bigint, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_baplie_staging_transactional(bigint, jsonb) TO authenticated;

-- Import de B/L: a propriedade declarada no documento vale para as linhas que
-- o import acabou de recriar (created_at = now(), mesma transacao). B/L travado
-- sem override mantem os containers e a propriedade que ja tinha.
CREATE OR REPLACE FUNCTION public.import_bl_freight_transactional(p_bls jsonb, p_changed_by uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_bl_id text;
  v_result jsonb;
BEGIN
  -- A entrada precisa negar uma sessão Portal antes de inspecionar o payload;
  -- além de preservar a fronteira do núcleo legado, isso evita vazar erros de
  -- estrutura para chamadores sem autorização.
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR p_changed_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Credenciais invalidas para importar frete do BL.' USING ERRCODE = '42501';
  END IF;

  FOR v_bl_id IN SELECT DISTINCT value->>'id' FROM jsonb_array_elements(coalesce(p_bls, '[]'::jsonb)) ORDER BY 1
  LOOP
    IF nullif(v_bl_id, '') IS NOT NULL THEN
      PERFORM pg_advisory_xact_lock(hashtextextended('bl:' || v_bl_id, 0));
    END IF;
  END LOOP;

  v_result := public.import_bl_freight_transactional_legacy_070(p_bls, p_changed_by);

  UPDATE public.bl_containers AS c
  SET ownership = declared.ownership,
      ownership_source = 'bl'
  FROM (
    SELECT DISTINCT ON (bl.value->>'id', upper(btrim(cont.value->>'container_number')))
      bl.value->>'id' AS bl_id,
      upper(btrim(cont.value->>'container_number')) AS container_number,
      upper(btrim(cont.value->>'ownership')) AS ownership
    FROM jsonb_array_elements(coalesce(p_bls, '[]'::jsonb)) AS bl
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(bl.value->'containers') = 'array' THEN bl.value->'containers' ELSE '[]'::jsonb END
    ) AS cont
    WHERE upper(btrim(cont.value->>'ownership')) IN ('SOC', 'COC')
  ) AS declared
  WHERE c.bl_id = declared.bl_id
    AND upper(btrim(c.container_number)) = declared.container_number
    AND c.created_at = now();

  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.import_bl_freight_transactional(jsonb, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_bl_freight_transactional(jsonb, uuid) TO authenticated;

-- Baplie: alem das flags fisicas (118), preenche a propriedade onde o B/L
-- nao declarou nem houve correcao manual.
CREATE OR REPLACE FUNCTION public.apply_baplie_physical_flags_atomic(
  p_voyage_id bigint,
  p_changes jsonb,
  p_changed_by uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_role text;
  v_filter text[] := NULL;
  v_item jsonb;
  v_num text;
  v_updated bigint[] := ARRAY[]::bigint[];
  v_staged_imo boolean;
  v_staged_class text;
  v_staged_un text;
  v_staged_oog boolean;
  v_staged_ownership text;
  v_ownership text;
  v_ownership_source text;
  v_matches bigint[];
  v_current record;
  v_bl_id text;
  v_action_id uuid := gen_random_uuid();
  v_recalculated integer := 0;
  v_calc_errors jsonb := '[]'::jsonb;
BEGIN
  IF v_actor IS NULL OR NOT public.is_active_user() OR p_changed_by IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa.' USING ERRCODE = '42501';
  END IF;
  IF p_voyage_id IS NULL THEN
    RAISE EXCEPTION 'Viagem obrigatoria.' USING ERRCODE = '22023';
  END IF;

  -- Serializa o conjunto fisico por viagem.
  PERFORM 1 FROM public.voyages WHERE id = p_voyage_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Viagem % nao encontrada', p_voyage_id USING ERRCODE = 'P0002';
  END IF;

  -- p_changes e so filtro opcional; valores/previous do browser sao ignorados:
  -- o desejado deriva do restaging no servidor abaixo.
  IF p_changes IS NOT NULL THEN
    IF jsonb_typeof(p_changes) <> 'array' THEN
      RAISE EXCEPTION 'Filtro de flags invalido.' USING ERRCODE = '22023';
    END IF;
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_changes)
    LOOP
      IF jsonb_typeof(v_item) = 'string' THEN
        v_num := upper(btrim(v_item #>> '{}'));
      ELSE
        v_num := upper(btrim(COALESCE(v_item->>'container_number', '')));
      END IF;
      IF v_num IS NOT NULL AND v_num <> '' THEN
        v_filter := array_append(v_filter, v_num);
      END IF;
    END LOOP;
  END IF;

  -- Deriva do staging: full prevalece, IMO/OOG por OR, ultima classe/ONU nao
  -- nula. Sem IMO, classe/ONU zeram (regra do reconciliador).
  FOR v_num, v_staged_imo, v_staged_class, v_staged_un, v_staged_oog, v_staged_ownership IN
    SELECT
      upper(btrim(s.container_number)),
      bool_or(COALESCE(s.is_imo, false)),
      max(s.imo_class) FILTER (WHERE s.imo_class IS NOT NULL),
      max(s.un_number) FILTER (WHERE s.un_number IS NOT NULL),
      bool_or(COALESCE(s.is_oog, false)),
      max(s.ownership) FILTER (WHERE s.ownership IS NOT NULL)
    FROM public.baplie_containers AS s
    WHERE s.voyage_id = p_voyage_id
      AND s.status = 'full'
      AND upper(btrim(s.container_number)) ~ '^[A-Z]{4}[0-9]{7}$'
    GROUP BY upper(btrim(s.container_number))
    ORDER BY 1
  LOOP
    IF v_filter IS NOT NULL AND NOT (v_num = ANY (v_filter)) THEN
      CONTINUE;
    END IF;
    IF NOT v_staged_imo THEN
      v_staged_class := NULL;
      v_staged_un := NULL;
    END IF;

    -- Casa com exatamente um bl_container da viagem; 0 ou 2+ viram
    -- divergencia de existencia, nao update arbitrario.
    SELECT COALESCE(array_agg(c.id ORDER BY c.id), ARRAY[]::bigint[])
      INTO v_matches
      FROM public.bl_containers AS c
      JOIN public.bls AS b ON b.id = c.bl_id
      WHERE b.voyage_id = p_voyage_id
        AND upper(btrim(c.container_number)) = v_num;

    IF cardinality(v_matches) <> 1 THEN
      CONTINUE;
    END IF;

    SELECT c.is_imo, c.imo_class, c.un_number, c.is_oog, c.ownership, c.ownership_source
      INTO v_current
      FROM public.bl_containers AS c
      WHERE c.id = v_matches[1]
      FOR UPDATE;

    -- B/L (soberano) e correcao manual nao sao sobrescritos pelo Baplie.
    IF v_current.ownership_source IN ('bl', 'manual') THEN
      v_ownership := v_current.ownership;
      v_ownership_source := v_current.ownership_source;
    ELSE
      v_ownership := v_staged_ownership;
      v_ownership_source := CASE WHEN v_staged_ownership IS NULL THEN NULL ELSE 'baplie' END;
    END IF;

    IF v_staged_imo IS NOT DISTINCT FROM COALESCE(v_current.is_imo, false)
       AND v_staged_oog IS NOT DISTINCT FROM COALESCE(v_current.is_oog, false)
       AND upper(COALESCE(v_staged_class, '')) IS NOT DISTINCT FROM upper(COALESCE(v_current.imo_class, ''))
       AND upper(COALESCE(v_staged_un, '')) IS NOT DISTINCT FROM upper(COALESCE(v_current.un_number, ''))
       AND v_ownership IS NOT DISTINCT FROM v_current.ownership THEN
      CONTINUE;
    END IF;

    UPDATE public.bl_containers AS c
      SET is_imo = v_staged_imo,
          imo_class = v_staged_class,
          un_number = v_staged_un,
          is_oog = v_staged_oog,
          ownership = v_ownership,
          ownership_source = v_ownership_source
      WHERE c.id = v_matches[1];
    v_updated := array_append(v_updated, v_matches[1]);
  END LOOP;

  -- No-op nao cria mudanca ficticia nem evento.
  IF cardinality(v_updated) = 0 THEN
    RETURN jsonb_build_object(
      'voyage_id', p_voyage_id,
      'updated_ids', ARRAY[]::bigint[],
      'applied', 0,
      'recalculated', 0,
      'calculation_errors', '[]'::jsonb
    );
  END IF;

  v_role := public.current_actor_role();

  -- Um unico evento de intencao por viagem, mesma transacao. A trilha por
  -- coluna do trigger audit_row_changes continua (legitima, correlacionada).
  INSERT INTO public.audit_logs(
    entity_type, entity_id, field_name, old_value, new_value,
    changed_by, justification, actor_role, actor_department
  ) VALUES (
    'voyage', p_voyage_id::text, 'baplie_physical_flags',
    jsonb_build_object('voyage_id', p_voyage_id)::text,
    jsonb_build_object(
      'voyage_id', p_voyage_id,
      'updated_ids', v_updated,
      'applied', cardinality(v_updated)
    )::text,
    v_actor, 'Baplie soberano: flags fisicas aplicadas (conjunto atomico)', v_role, v_role
  );

  -- resolve_bl_local_charge_items escolhe tarifa por is_imo/is_oog e conta
  -- SOC conforme o item: o perfil mudou, a taxa recalcula agora (mesma regra
  -- da migration 115). Falha de calculo nao desfaz as flags; vira auditoria e
  -- efeito recuperavel.
  FOR v_bl_id IN
    SELECT DISTINCT c.bl_id
    FROM public.bl_containers AS c
    JOIN public.bls AS b ON b.id = c.bl_id
    WHERE c.id = ANY (v_updated)
      AND COALESCE(b.financial_status, 'pending') NOT IN ('invoiced', 'partially_paid', 'paid')
    ORDER BY 1
  LOOP
    BEGIN
      PERFORM public.calculate_bl_local_charges(v_bl_id, v_actor, true);
      v_recalculated := v_recalculated + 1;
    EXCEPTION WHEN OTHERS THEN
      v_calc_errors := v_calc_errors || jsonb_build_array(jsonb_build_object(
        'bl_id', v_bl_id,
        'message', SQLERRM
      ));
      INSERT INTO public.audit_logs (
        entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification
      ) VALUES (
        'bl', v_bl_id, 'local_charges_auto_calc_error', NULL, SQLERRM, v_actor, now(),
        'Falha no recalculo de taxas locais apos aplicar flags fisicas do Baplie'
      );
      PERFORM public.enqueue_import_effect(
        v_action_id, 'provisional_charges', v_bl_id, v_actor, 1, NULL,
        jsonb_build_object('voyage_id', p_voyage_id, 'source', 'baplie_physical_flags')
      );
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'voyage_id', p_voyage_id,
    'updated_ids', v_updated,
    'applied', cardinality(v_updated),
    'recalculated', v_recalculated,
    'calculation_errors', v_calc_errors
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_baplie_physical_flags_atomic(bigint, jsonb, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_baplie_physical_flags_atomic(bigint, jsonb, uuid) TO authenticated;

-- Motor de taxas locais (base: 091) com containers SOC fora dos itens
-- applies_to_soc = false.
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
        cti.unit_value_brl,
        cti.unit_value_usd,
        COALESCE(cti.applies_to_soc, true) AS applies_to_soc,
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

-- Container SOC e do cliente e nunca volta ao estoque: nao ha devolucao a
-- esperar nem Demurrage a cobrar. A guarda fica no item da fatura, por onde
-- todo caminho de emissao passa.
CREATE OR REPLACE FUNCTION public.guard_demurrage_item_not_soc()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE
  v_number text;
BEGIN
  SELECT bc.container_number INTO v_number
  FROM public.bl_containers AS bc
  WHERE bc.id = NEW.container_id AND bc.ownership = 'SOC';
  IF FOUND THEN
    RAISE EXCEPTION 'Container % é SOC (do cliente): não gera Demurrage.', v_number USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.guard_demurrage_item_not_soc() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_demurrage_item_not_soc ON public.demurrage_invoice_items;
CREATE TRIGGER trg_guard_demurrage_item_not_soc
BEFORE INSERT OR UPDATE OF container_id ON public.demurrage_invoice_items
FOR EACH ROW EXECUTE FUNCTION public.guard_demurrage_item_not_soc();

-- SOC nunca fica "em atraso": todo contador de Demurrage em atraso (cabeçalho,
-- KPIs, ficha do cliente) lê demurrage_status = 'overdue' direto da tabela.
CREATE OR REPLACE FUNCTION public.soc_container_never_overdue()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp' AS $function$
BEGIN
  IF NEW.ownership = 'SOC' AND NEW.demurrage_status = 'overdue' THEN
    NEW.demurrage_status := 'within_free_time';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.soc_container_never_overdue() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_soc_container_never_overdue ON public.bl_containers;
CREATE TRIGGER trg_soc_container_never_overdue
BEFORE INSERT OR UPDATE OF ownership, demurrage_status ON public.bl_containers
FOR EACH ROW EXECUTE FUNCTION public.soc_container_never_overdue();

-- Conjunto completo da fatura de Demurrage (base: 066) sem os containers SOC:
-- eles nao sao devolvidos e nao entram na fatura.
CREATE OR REPLACE FUNCTION public.assert_demurrage_invoice_complete(p_invoice_id bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bl_id text;
  v_expected integer;
  v_items integer;
BEGIN
  SELECT bl_id INTO v_bl_id FROM public.demurrage_invoices WHERE id = p_invoice_id;
  IF NOT FOUND THEN RETURN; END IF;

  IF EXISTS (SELECT 1 FROM public.demurrage_invoices WHERE id = p_invoice_id AND status IN ('issued', 'paid')) THEN
    SELECT count(*) INTO v_expected
    FROM public.bl_containers
    WHERE bl_id = v_bl_id AND ownership IS DISTINCT FROM 'SOC';
    -- Há invoices históricas para B/Ls que ainda não materializaram
    -- containers (e também cargas não conteinerizadas). Nesses casos não há
    -- conjunto físico a conferir; se vier item mesmo assim, rejeite-o.
    IF v_expected = 0 THEN
      IF EXISTS (
        SELECT 1 FROM public.demurrage_invoice_items WHERE invoice_id = p_invoice_id
      ) THEN
        RAISE EXCEPTION 'Demurrage do B/L % possui itens sem containers físicos correspondentes.', v_bl_id USING ERRCODE = '23514';
      END IF;
      RETURN;
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.bl_containers
      WHERE bl_id = v_bl_id AND return_date IS NULL AND ownership IS DISTINCT FROM 'SOC'
    ) OR EXISTS (
      SELECT 1
      FROM public.demurrage_invoice_items AS item
      WHERE item.invoice_id = p_invoice_id AND item.return_date IS NULL
    ) THEN
      RAISE EXCEPTION 'Demurrage só pode ser emitida após a devolução de todos os containers do B/L %.' , v_bl_id USING ERRCODE = '23514';
    END IF;

    SELECT count(DISTINCT item.container_id) INTO v_items
    FROM public.demurrage_invoice_items AS item WHERE item.invoice_id = p_invoice_id;
    IF v_items <> v_expected OR EXISTS (
      SELECT 1
      FROM public.demurrage_invoice_items AS item
      WHERE item.invoice_id = p_invoice_id
      GROUP BY item.container_id
      HAVING count(*) > 1
    ) OR EXISTS (
      SELECT 1
      FROM public.demurrage_invoice_items AS item
      WHERE item.invoice_id = p_invoice_id
        AND NOT EXISTS (
          SELECT 1 FROM public.bl_containers AS bc
          WHERE bc.id = item.container_id AND bc.bl_id = v_bl_id AND bc.ownership IS DISTINCT FROM 'SOC'
        )
    ) OR EXISTS (
      SELECT 1 FROM public.bl_containers AS bc
      WHERE bc.bl_id = v_bl_id
        AND bc.ownership IS DISTINCT FROM 'SOC'
        AND NOT EXISTS (SELECT 1 FROM public.demurrage_invoice_items AS item WHERE item.invoice_id = p_invoice_id AND item.container_id = bc.id)
    ) THEN
      RAISE EXCEPTION 'Demurrage do B/L % não contém o conjunto completo e exclusivo de containers.', v_bl_id USING ERRCODE = '23514';
    END IF;
  END IF;
END;
$function$;

-- Correcao manual de SOC/COC: mesma forma de set_bl_container_profile (115).
CREATE OR REPLACE FUNCTION public.set_bl_container_ownership(
  p_container_id bigint,
  p_ownership text,
  p_justification text,
  p_changed_by uuid DEFAULT NULL::uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_container public.bl_containers%ROWTYPE;
  v_financial_status text;
  v_actor uuid := COALESCE(p_changed_by, auth.uid());
  v_ownership text := upper(btrim(COALESCE(p_ownership, '')));
  v_justification text := NULLIF(btrim(COALESCE(p_justification, '')), '');
  v_charges jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuário interno ativo é obrigatório.' USING ERRCODE = '42501';
  END IF;
  IF p_changed_by IS NOT NULL AND p_changed_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'O autor da alteração deve ser o usuário autenticado.' USING ERRCODE = '42501';
  END IF;
  IF v_ownership NOT IN ('SOC', 'COC') THEN
    RAISE EXCEPTION 'Propriedade do container inválida: %.', p_ownership USING ERRCODE = '22023';
  END IF;
  IF v_justification IS NULL THEN
    RAISE EXCEPTION 'A justificativa da alteração de SOC/COC é obrigatória.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_container FROM public.bl_containers WHERE id = p_container_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Container % não encontrado.', p_container_id USING ERRCODE = 'P0002';
  END IF;

  SELECT financial_status INTO v_financial_status FROM public.bls WHERE id = v_container.bl_id FOR UPDATE;
  IF v_financial_status IN ('invoiced', 'partially_paid', 'paid') THEN
    RAISE EXCEPTION 'B/L % já foi faturado; SOC/COC não pode mudar porque as taxas não podem ser recalculadas.', v_container.bl_id
      USING ERRCODE = '55000';
  END IF;

  IF v_container.ownership IS NOT DISTINCT FROM v_ownership THEN
    RAISE EXCEPTION 'O container já está como %.', v_ownership USING ERRCODE = '22023';
  END IF;

  UPDATE public.bl_containers
  SET ownership = v_ownership,
      ownership_source = 'manual'
  WHERE id = v_container.id;

  INSERT INTO public.audit_logs (
    entity_type, entity_id, field_name, old_value, new_value,
    changed_by, changed_at, justification
  ) VALUES (
    'bl', v_container.bl_id, 'container_ownership',
    jsonb_build_object('container', v_container.container_number, 'ownership', v_container.ownership, 'source', v_container.ownership_source)::text,
    jsonb_build_object('container', v_container.container_number, 'ownership', v_ownership, 'source', 'manual')::text,
    v_actor, now(), v_justification
  );

  v_charges := public.calculate_bl_local_charges(v_container.bl_id, v_actor, true);

  RETURN jsonb_build_object(
    'bl_id', v_container.bl_id,
    'container_id', v_container.id,
    'ownership', v_ownership,
    'charges', v_charges
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.set_bl_container_ownership(bigint, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_bl_container_ownership(bigint, text, text, uuid) TO authenticated, service_role;

-- Portal do cliente (base: 058): SOC nao tem devolucao nem dias de Demurrage;
-- aparece com status proprio em vez de "em_demurrage".
CREATE OR REPLACE FUNCTION public._portal_list_operation_bls_without_transshipment_core(p_customer_id bigint) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  RETURN (
    WITH active_rates AS (
      SELECT DISTINCT ON (upper(trim(container_type)))
        upper(trim(container_type)) AS container_type,
        free_days
      FROM public.demurrage_rates
      WHERE active = true
        AND (valid_from IS NULL OR valid_from <= CURRENT_DATE)
        AND (valid_to IS NULL OR valid_to >= CURRENT_DATE)
      ORDER BY upper(trim(container_type)), valid_from DESC NULLS LAST, id DESC
    ),
    bl_rows AS (
      SELECT
        b.id AS bl_id,
        b.ce_mercante,
        b.pol,
        b.pod,
        b.voyage_id,
        v.voyage_number,
        vs.name AS vessel_name,
        b.free_time_override,
        b.cargo_mode,
        b.bb_weight_ton,
        b.bb_packages_qty
      FROM public.bls AS b
      LEFT JOIN public.voyages AS v ON v.id = b.voyage_id
      LEFT JOIN public.vessels AS vs ON vs.id = v.vessel_id
      WHERE b.customer_id = p_customer_id AND public.bl_has_portal_release(b.id)
    )
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'bl_id', bl.bl_id,
          'ce_mercante', bl.ce_mercante,
          'pol', bl.pol,
          'pod', bl.pod,
          'voyage_id', bl.voyage_id,
          'voyage_number', bl.voyage_number,
          'vessel_name', bl.vessel_name,
          'container_count', container_summary.container_count,
          'containers_in_demurrage', container_summary.containers_in_demurrage,
          'containers_returned', container_summary.containers_returned,
          'containers', container_summary.containers,
          'cargo_mode', bl.cargo_mode,
          'bb_weight_ton', bl.bb_weight_ton,
          'bb_packages_qty', bl.bb_packages_qty
        )
        ORDER BY bl.voyage_id DESC NULLS LAST, bl.bl_id
      ),
      '[]'::jsonb
    )
    FROM bl_rows AS bl
    LEFT JOIN LATERAL (
      WITH calculated AS (
        SELECT
          c.id,
          c.container_number,
          c.type,
          c.discharge_date,
          c.return_date,
          c.ownership,
          CASE
            WHEN c.discharge_date IS NULL THEN NULL
            ELSE GREATEST(COALESCE(c.return_date, CURRENT_DATE) - c.discharge_date, 0)
          END AS usage_days,
          CASE
            WHEN c.discharge_date IS NULL THEN NULL
            ELSE COALESCE(
              bl.free_time_override,
              ar.free_days,
              CASE
                WHEN upper(trim(COALESCE(c.type, ''))) IN ('20RF', '20RQ', '20R1', '40RF', '40RQ', '40R1', '45R1')
                  THEN 10
                ELSE 21
              END
            )
          END AS free_time_days
        FROM public.bl_containers AS c
        LEFT JOIN active_rates AS ar
          ON ar.container_type = upper(trim(COALESCE(c.type, '')))
        WHERE c.bl_id = bl.bl_id
      ),
      with_demurrage AS (
        SELECT
          calculated.*,
          CASE
            WHEN ownership = 'SOC' OR usage_days IS NULL OR free_time_days IS NULL THEN NULL
            ELSE GREATEST(usage_days - free_time_days, 0)
          END AS demurrage_days
        FROM calculated
      ),
      with_status AS (
        SELECT
          with_demurrage.*,
          CASE
            WHEN discharge_date IS NULL THEN 'sem_descarga'
            WHEN ownership = 'SOC' THEN 'soc'
            WHEN return_date IS NOT NULL THEN 'devolvido'
            WHEN COALESCE(demurrage_days, 0) > 0 THEN 'em_demurrage'
            ELSE 'dentro_free_time'
          END AS status
        FROM with_demurrage
      )
      SELECT
        COUNT(*)::int AS container_count,
        COUNT(*) FILTER (WHERE status = 'em_demurrage')::int AS containers_in_demurrage,
        COUNT(*) FILTER (WHERE status = 'devolvido')::int AS containers_returned,
        COALESCE(
          jsonb_agg(
            jsonb_build_object(
              'id', id,
              'container_number', container_number,
              'type', type,
              'discharge_date', discharge_date,
              'return_date', return_date,
              'usage_days', usage_days,
              'free_time_days', free_time_days,
              'demurrage_days', demurrage_days,
              'status', status,
              'ownership', ownership
            )
            ORDER BY container_number
          ),
          '[]'::jsonb
        ) AS containers
      FROM with_status
    ) AS container_summary ON true
  );
END;
$$;

REVOKE ALL ON FUNCTION public._portal_list_operation_bls_without_transshipment_core(bigint) FROM PUBLIC, anon, authenticated;
