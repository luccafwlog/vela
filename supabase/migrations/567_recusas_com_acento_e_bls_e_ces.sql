-- 567: recusas do banco com acento e com "B/Ls e CEs", como as telas.
--
-- Achado da sincronização do Manual do Operador de 2026-11-02 (PR #1087): a
-- 509 trocou o acento de várias recusas, mas a família "B/L … ja foi
-- faturado …" ficou de fora, e a #1151 passou as telas a "B/Ls e CEs"
-- enquanto o banco continuou recusando com "BLs e CEs". A tela da escala já
-- recusa antes com "Informe a justificativa para alterar B/Ls e CEs."; o
-- banco, que protege o mesmo caso, dizia "BLs".
--
-- Cada função abaixo é a definição vigente (lida com pg_get_functiondef no
-- Postgres local com toda a cadeia aplicada) com SÓ o texto dos RAISE
-- EXCEPTION trocado; lógica, ERRCODE, assinatura, SECURITY DEFINER e
-- search_path ficam iguais. CREATE OR REPLACE preserva dono, grants e
-- comentários. Nenhuma função compara estes textos por SQLERRM, e a Revisão
-- (Revisao.tsx) já reconhece "já" e "ja".
--
-- Textos trocados:
--   Status de BLs e CEs inválido.                  -> Status de B/Ls e CEs inválido.
--   Informe a justificativa para alterar BLs e CEs. -> … alterar B/Ls e CEs.
--   B/L % ja foi faturado …                        -> B/L % já foi faturado …
--     e, nas mesmas frases: nao e permitido lancar/remover/editar -> não é
--     permitido lançar/remover/editar; remover conteudo -> remover conteúdo;
--     (transicao=%) -> (transição=%); a importacao removeria -> a importação
--     removeria.
--
-- Fora: o prefixo "Atualização automática de BLs e CEs pela conciliação
-- documental" de sync_voyage_documental_status. É a marca que a linha do
-- tempo da Viagem reconhece nas justificativas já gravadas
-- (DOCUMENTAL_AUTOMATIC_REASON em voyageSummaries.ts) e a tela não o mostra.
--
-- Só redefine funções; não grava nem reescreve linhas existentes.
-- Rollback: o mais simples é desfazer só a troca de texto em cada função.
-- Reaplicar a migration anterior também serve, com estas origens:
-- guard_manual_documental_status: 135; delete_manual_bl_charge(bigint,uuid):
-- 241 (a versão de três argumentos, da 491/493, não muda aqui);
-- _recalculate_bl_cargo_mode e trg_sync_bl_weight_cargo_mode: 064;
-- _add_manual_bl_charge_impl_106, _update_manual_bl_charge_impl_491 e
-- _calculate_bl_local_charges_impl_491: 509;
-- import_breakbulk_manifest_transactional_legacy_189: 509 com os remendos da
-- 511 e da 551 (reaplicar só a 509 desfaria as duas correções).
--
-- Funções redefinidas:
--   guard_manual_documental_status()
--   _add_manual_bl_charge_impl_106(text,bigint,numeric,text,uuid)
--   _update_manual_bl_charge_impl_491(bigint,numeric,text,uuid)
--   delete_manual_bl_charge(bigint,uuid)
--   _calculate_bl_local_charges_impl_491(text,uuid,boolean)
--   _recalculate_bl_cargo_mode(text,text)
--   trg_sync_bl_weight_cargo_mode()
--   import_breakbulk_manifest_transactional_legacy_189(text,bigint,uuid,integer,jsonb,jsonb,jsonb)

CREATE OR REPLACE FUNCTION public.guard_manual_documental_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_reason text; v_current text;
BEGIN
  IF TG_TABLE_NAME = 'audit_logs' THEN
    IF NEW.entity_type <> 'voyage_pod_schedule' OR NEW.field_name <> 'ces' THEN RETURN NEW; END IF;
    IF coalesce(NEW.new_value, 'waiting') NOT IN ('waiting', 'received', 'launching', 'approving', 'approved', 'missing', 'partial') THEN
      RAISE EXCEPTION 'Status de B/Ls e CEs inválido.' USING ERRCODE = '22023';
    END IF;
    SELECT new_value INTO v_current FROM public.audit_logs
    WHERE entity_type = 'voyage_pod_schedule' AND entity_id = NEW.entity_id AND field_name = 'ces'
    ORDER BY changed_at DESC, id DESC LIMIT 1;
    -- Mesma normalização do editor para estados legados: abrir/salvar não é override.
    v_current := CASE v_current WHEN 'partial' THEN 'launching' WHEN 'missing' THEN 'waiting' ELSE v_current END;
    IF coalesce(v_current, 'waiting') IS DISTINCT FROM coalesce(NEW.new_value, 'waiting')
      AND nullif(btrim(NEW.justification), '') IS NULL THEN
      RAISE EXCEPTION 'Informe a justificativa para alterar B/Ls e CEs.' USING ERRCODE = '22023';
    END IF;
    RETURN NEW;
  END IF;

  -- INSERT ... ON CONFLICT sobre linha existente: quem julga é o BEFORE UPDATE
  -- disparado pelo DO UPDATE, que enxerga o valor anterior real.
  IF TG_OP = 'INSERT' AND EXISTS (
    SELECT 1 FROM public.voyage_export_schedules
    WHERE voyage_id = NEW.voyage_id AND pol = NEW.pol
  ) THEN
    RETURN NEW;
  END IF;

  IF coalesce(CASE WHEN TG_OP = 'INSERT' THEN 'waiting' ELSE OLD.ce_status END, 'waiting')
     IS DISTINCT FROM coalesce(NEW.ce_status, 'waiting') THEN
    v_reason := nullif(btrim(current_setting('vela.documental_justification', true)), '');
    IF v_reason IS NULL THEN RAISE EXCEPTION 'Informe a justificativa para alterar B/Ls e CEs.' USING ERRCODE = '22023'; END IF;
    INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification)
    VALUES ('voyage_pod_schedule', NEW.voyage_id::text || '::' || public.normalize_port_code(NEW.pol), 'export_ces', CASE WHEN TG_OP = 'INSERT' THEN 'waiting' ELSE OLD.ce_status END, NEW.ce_status, auth.uid(), clock_timestamp(), v_reason);
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public._add_manual_bl_charge_impl_106(p_bl_id text, p_charge_item_id bigint, p_quantity numeric DEFAULT 1, p_notes text DEFAULT NULL::text, p_actor uuid DEFAULT NULL::uuid)
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
    RAISE EXCEPTION 'Usuário sem permissão ativa' USING ERRCODE = '42501';
  END IF;
  v_actor := COALESCE(p_actor, auth.uid());

  SELECT b.id, b.customer_id, COALESCE(b.cargo_mode, 'container') AS cargo_mode,
    b.pod, b.charge_status, b.financial_status, b.cancelled_at,
    public.bl_local_charge_reference_date(b.id) AS reference_date
  INTO v_bl
  FROM public.bls AS b
  WHERE b.id = upper(btrim(p_bl_id));
  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L % nao encontrado', p_bl_id USING ERRCODE = 'P0002';
  END IF;

  IF v_bl.cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION 'B/L % cancelado e somente leitura; nao e permitido lancar taxa manual.', p_bl_id USING ERRCODE = '22023';
  END IF;

  IF COALESCE(v_bl.financial_status, 'open') IN ('invoiced', 'partially_paid', 'paid') THEN
    RAISE EXCEPTION 'B/L % já foi faturado (status financeiro=%); não é permitido lançar taxa manual.',
      p_bl_id, v_bl.financial_status USING ERRCODE = '22023';
  END IF;

  SELECT cti.id, cti.name, COALESCE(cti.currency, 'BRL') AS currency,
    cti.unit_value_brl, cti.unit_value_usd, cti.value_brl,
    ct.id AS charge_table_id, ct.name AS charge_table_name, ct.cargo_mode, ct.pod,
    cro.override_value,
    fi.charge_item_id AS frozen_item, fi.unit_value_brl AS frozen_brl,
    fi.unit_value_usd AS frozen_usd, fi.override_value AS frozen_override
  INTO v_item
  FROM public.charge_table_items AS cti
  JOIN public.charge_tables AS ct ON ct.id = cti.charge_table_id
    AND ct.id IN (
      SELECT resolved.table_id
      FROM public.resolve_bl_local_charge_table_ids(v_bl.id, v_bl.reference_date) AS resolved
    )
    AND (
      public.normalize_port_code(ct.pod) = public.normalize_port_code(v_bl.pod)
      OR upper(trim(coalesce(ct.pod, ''))) = 'ANY'
    )
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
  LEFT JOIN public.bl_price_freeze_items AS fi ON fi.bl_id = v_bl.id AND fi.charge_item_id = cti.id
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
    v_unit_usd := CASE WHEN v_item.frozen_item IS NOT NULL THEN COALESCE(v_item.frozen_override, v_item.frozen_usd, 0)
      ELSE COALESCE(v_item.override_value, v_item.unit_value_usd, 0) END;
    v_total_brl := NULL;
    v_total_usd := round(v_qty * COALESCE(v_unit_usd, 0), 2);
  ELSE
    v_unit_brl := CASE WHEN v_item.frozen_item IS NOT NULL THEN COALESCE(v_item.frozen_override, v_item.frozen_brl, v_item.value_brl, 0)
      ELSE COALESCE(v_item.override_value, v_item.unit_value_brl, v_item.value_brl, 0) END;
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
    v_total_brl, v_total_usd, (CASE WHEN v_item.frozen_item IS NOT NULL THEN v_item.frozen_override ELSE v_item.override_value END) IS NOT NULL, 'manual', 'reviewed',
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

CREATE OR REPLACE FUNCTION public._update_manual_bl_charge_impl_491(p_charge_calculation_id bigint, p_quantity numeric, p_notes text DEFAULT NULL::text, p_actor uuid DEFAULT NULL::uuid)
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
    RAISE EXCEPTION 'Usuário sem permissão ativa' USING ERRCODE = '42501';
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
    RAISE EXCEPTION 'B/L % já foi faturado; não é permitido editar taxa manual.', v_row.bl_id
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

CREATE OR REPLACE FUNCTION public.delete_manual_bl_charge(p_charge_calculation_id bigint, p_actor uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_row RECORD;
  v_bl_id TEXT;
BEGIN
  -- O autor é quem está logado (ADR 0085, regra base 2; migration 241).
  PERFORM public._assert_actor_is_caller(p_actor);
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Somente o Administrativo exclui taxa manual do B/L.' USING ERRCODE = '42501';
  END IF;

  SELECT
    cc.id,
    cc.bl_id,
    cc.source,
    cc.charge_item_id,
    cc.quantity,
    cc.total_value_brl,
    cc.total_value_usd,
    b.financial_status AS bl_financial_status
  INTO v_row
  FROM public.charge_calculations AS cc
  LEFT JOIN public.bls AS b ON b.id = cc.bl_id
  WHERE cc.id = p_charge_calculation_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Linha de calculo % nao encontrada', p_charge_calculation_id USING ERRCODE = 'P0002';
  END IF;

  IF COALESCE(v_row.source, '') <> 'manual' THEN
    RAISE EXCEPTION 'Somente linhas manuais podem ser removidas' USING ERRCODE = '22023';
  END IF;

  IF COALESCE(v_row.bl_financial_status, 'open') IN ('invoiced', 'partially_paid', 'paid') THEN
    RAISE EXCEPTION 'B/L % já foi faturado; não é permitido remover taxa manual.', v_row.bl_id
      USING ERRCODE = '22023';
  END IF;

  v_bl_id := v_row.bl_id;

  DELETE FROM public.charge_calculations
  WHERE id = p_charge_calculation_id;

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
    'manual_delete',
    CONCAT('charge_item_id=', COALESCE(v_row.charge_item_id::TEXT, '-'), ' | qty=', COALESCE(v_row.quantity::TEXT, '0')),
    NULL,
    auth.uid(),
    NOW(),
    'Remocao manual de other charge'
  );

  RETURN jsonb_build_object(
    'deleted', true,
    'id', p_charge_calculation_id,
    'bl_id', v_bl_id
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public._calculate_bl_local_charges_impl_491(p_bl_id text, p_actor uuid DEFAULT NULL::uuid, p_recalculate boolean DEFAULT true)
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
    RAISE EXCEPTION 'Usuário sem permissão ativa' USING ERRCODE = '42501';
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
    RAISE EXCEPTION 'B/L % já foi faturado (status financeiro=%): o recálculo manual não altera a fatura. Corrija os dados do B/L, que a fatura é corrigida automaticamente.', p_bl_id, v_bl.financial_status USING ERRCODE = '22023';
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

CREATE OR REPLACE FUNCTION public._recalculate_bl_cargo_mode(p_bl_id text, p_transition text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
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

  -- A8: maquinas e cubagem sao carga solta declarada tanto quanto peso e
  -- volumes. Um manifesto parcial pode trazer so esses dois, e sem eles no
  -- sinal qualquer UPDATE reclassificava o B/L como 'container' em silencio.
  SELECT EXISTS (
    SELECT 1 FROM public.bl_breakbulk_items WHERE bl_id = p_bl_id
  ) OR EXISTS (
    SELECT 1 FROM public.bls
    WHERE id = p_bl_id
      AND (
        COALESCE(bb_weight_ton, 0) > 0
        OR COALESCE(bb_packages_qty, 0) > 0
        OR COALESCE(bb_machine_qty, 0) > 0
        OR COALESCE(bb_cbm, 0) > 0
      )
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
      'B/L % já foi faturado (status financeiro=%); remover conteúdo exige estorno/refaturamento (transição=%).',
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
 SET search_path TO 'public', 'pg_temp'
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

  -- A8: ver comentario em _recalculate_bl_cargo_mode.
  v_has_bb := (
    COALESCE(NEW.bb_weight_ton, 0) > 0 OR
    COALESCE(NEW.bb_packages_qty, 0) > 0 OR
    COALESCE(NEW.bb_machine_qty, 0) > 0 OR
    COALESCE(NEW.bb_cbm, 0) > 0 OR
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
      'B/L % já foi faturado (status financeiro=%); remover conteúdo exige estorno/refaturamento.',
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

CREATE OR REPLACE FUNCTION public.import_breakbulk_manifest_transactional_legacy_189(p_filename text, p_voyage_id bigint, p_uploaded_by uuid, p_total_bls integer, p_bls jsonb, p_items jsonb, p_errors jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bls jsonb := COALESCE(p_bls, '[]'::jsonb);
  v_items jsonb := COALESCE(p_items, '[]'::jsonb);
  v_row record;
  v_item jsonb;
  v_before public.bls%ROWTYPE;
  v_after public.bls%ROWTYPE;
  v_bl_id text;
  v_bl_ids text[];
  v_existing_ids text[] := ARRAY[]::text[];
  v_inserted_ids text[] := ARRAY[]::text[];
  v_updated_ids text[] := ARRAY[]::text[];
  v_effect_ids text[];
  v_existing_bb boolean;
  v_incoming_bb boolean;
  v_batch_id bigint;
  v_action_id uuid := gen_random_uuid();
  v_previous_replacement text := current_setting('vela.breakbulk_import_replacement', true);
  v_previous_basis_source text := current_setting('vela.invoice_basis_source', true);
  v_previous_terminal text := current_setting('vela.bl_terminal_override', true);
  v_voyage_label text;
  v_other_label text;
  v_billed boolean;
  v_override boolean;
  v_cod boolean;
  v_in_customer bigint;
  v_customer_mode text;
  v_new_pol text;
  v_new_pod text;
  v_route_locked text[];
  v_relink jsonb;
  v_relinks jsonb := '[]'::jsonb;
  v_customer_ignored jsonb := '[]'::jsonb;
  v_billing_locked jsonb := '[]'::jsonb;
  v_cod_kept jsonb := '[]'::jsonb;
  v_ce_ignored text[];
  v_items_changed boolean;
  v_changed_fields text[];
  v_reasons text[];
  v_human_notes text;
  v_notes text;
  v_review text;
  v_has_live_invoice boolean;
  v_reissues jsonb;
  v_file_document text;
  v_bl_items jsonb;
  v_tracked_fields text[] := ARRAY[
    'shipper', 'consignee', 'notify_party', 'cargo_description', 'pol', 'pod',
    'customer_id', 'manifest_customer_cnpj_cpf', 'manifest_customer_name',
    'bb_machine_qty', 'bb_packages_qty', 'bb_packages_total', 'bb_weight_ton',
    'bb_cbm', 'ncm_codes', 'manifesto_mercante_id'
  ];
BEGIN
  IF auth.uid() IS NULL
     OR NOT public.is_active_user()
     OR p_uploaded_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Usuário sem permissão para importar carga solta.'
      USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(v_bls) IS DISTINCT FROM 'array' OR jsonb_typeof(v_items) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Payload de carga solta invalido.' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(array_agg(source.row->>'id'), ARRAY[]::text[])
    INTO v_bl_ids
  FROM jsonb_array_elements(v_bls) AS source(row);

  SELECT concat_ws(' / ', NULLIF(btrim(ve.name), ''), NULLIF(btrim(v.voyage_number), ''))
    INTO v_voyage_label
  FROM public.voyages AS v
  LEFT JOIN public.vessels AS ve ON ve.id = v.vessel_id
  WHERE v.id = p_voyage_id;

  -- 1. Trava os B/Ls existentes e recusa o lote antes de gravar qualquer coisa.
  FOR v_row IN
    SELECT b.id, b.voyage_id, b.financial_status, b.bb_weight_ton, b.bb_packages_qty,
      source.row AS incoming
    FROM public.bls AS b
    JOIN jsonb_array_elements(v_bls) AS source(row) ON b.id = source.row->>'id'
    ORDER BY b.id
    FOR UPDATE OF b
  LOOP
    v_existing_ids := v_existing_ids || v_row.id;

    IF v_row.voyage_id IS DISTINCT FROM p_voyage_id THEN
      SELECT concat_ws(' / ', NULLIF(btrim(ve.name), ''), NULLIF(btrim(v.voyage_number), ''))
        INTO v_other_label
      FROM public.voyages AS v
      LEFT JOIN public.vessels AS ve ON ve.id = v.vessel_id
      WHERE v.id = v_row.voyage_id;
      RAISE EXCEPTION
        'O B/L % já está na Viagem % e o arquivo foi importado na Viagem %. Nenhum B/L do lote foi gravado: exclua o B/L lá (se tiver CE Mercante, tire o CE antes) e importe de novo (cancelar não libera o número).',
        v_row.id, COALESCE(v_other_label, v_row.voyage_id::text), COALESCE(v_voyage_label, p_voyage_id::text)
        USING ERRCODE = 'P0005';
    END IF;

    v_existing_bb := COALESCE(v_row.bb_weight_ton, 0) > 0
      OR COALESCE(v_row.bb_packages_qty, 0) > 0
      OR EXISTS (SELECT 1 FROM public.bl_breakbulk_items WHERE bl_id = v_row.id);
    v_incoming_bb := COALESCE(NULLIF(v_row.incoming->>'bb_weight_ton', '')::numeric, 0) > 0
      OR COALESCE(NULLIF(v_row.incoming->>'bb_packages_qty', '')::numeric, 0) > 0
      OR EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_items) AS item(row)
        WHERE item.row->>'bl_id' = v_row.id
      );

    IF v_row.financial_status IN ('invoiced', 'paid') AND v_existing_bb AND NOT v_incoming_bb THEN
      RAISE EXCEPTION
        'B/L % já foi faturado (status financeiro=%); a importação removeria carga solta. Estorne/refature antes de substituir o manifesto.',
        v_row.id, v_row.financial_status
        USING ERRCODE = 'P0003';
    END IF;
  END LOOP;

  SELECT COALESCE(array_agg(source.row->>'id'), ARRAY[]::text[])
    INTO v_ce_ignored
  FROM jsonb_array_elements(v_bls) AS source(row)
  WHERE NULLIF(btrim(source.row->>'ce_mercante'), '') IS NOT NULL;

  PERFORM set_config('vela.breakbulk_import_replacement', 'on', true);
  PERFORM set_config('vela.invoice_basis_source', 'bl_reimport_correction', true);
  v_batch_id := public.import_manifest_transactional_legacy_165(
    p_filename, p_voyage_id, p_uploaded_by, 'carga_solta', NULL, p_total_bls, 0,
    '[]'::jsonb, '[]'::jsonb, COALESCE(p_errors, '[]'::jsonb)
  );

  -- 2. B/Ls novos: o que o arquivo traz, sem CE.
  WITH inserted AS (
    INSERT INTO public.bls (
      id, voyage_id, batch_id, cargo_mode, shipper, consignee, cargo_description,
      customer_id, suggested_customer_id, pol, pod, total_weight_kg, review_status,
      financial_status, notes, manifest_customer_cnpj_cpf, manifest_customer_name,
      manifest_customer_email, customer_reconciliation_status,
      customer_reconciliation_notes, billing_hold_reason, notify_party,
      bb_machine_qty, bb_packages_qty, bb_packages_total, bb_weight_ton, bb_cbm, ncm_codes
    )
    SELECT
      source.row->>'id',
      p_voyage_id,
      v_batch_id,
      'carga_solta',
      NULLIF(source.row->>'shipper', ''),
      source.row->>'consignee',
      NULLIF(source.row->>'cargo_description', ''),
      NULLIF(source.row->>'customer_id', '')::bigint,
      CASE WHEN NULLIF(source.row->>'customer_id', '') IS NULL
        THEN NULLIF(source.row->>'suggested_customer_id', '')::bigint END,
      NULLIF(source.row->>'pol', ''),
      NULLIF(source.row->>'pod', ''),
      NULLIF(source.row->>'total_weight_kg', '')::numeric,
      COALESCE(NULLIF(source.row->>'review_status', ''), 'ok'),
      'pending',
      NULLIF(source.row->>'notes', ''),
      public.normalize_document_text(source.row->>'manifest_customer_cnpj_cpf'),
      COALESCE(NULLIF(source.row->>'manifest_customer_name', ''), source.row->>'consignee'),
      NULLIF(source.row->>'manifest_customer_email', ''),
      COALESCE(NULLIF(source.row->>'customer_reconciliation_status', ''), 'missing_customer'),
      NULLIF(source.row->>'customer_reconciliation_notes', ''),
      NULLIF(source.row->>'billing_hold_reason', ''),
      NULLIF(source.row->>'notify_party', ''),
      NULLIF(source.row->>'bb_machine_qty', '')::numeric,
      NULLIF(source.row->>'bb_packages_qty', '')::numeric,
      NULLIF(source.row->>'bb_packages_total', '')::numeric,
      NULLIF(source.row->>'bb_weight_ton', '')::numeric,
      NULLIF(source.row->>'bb_cbm', '')::numeric,
      COALESCE(public.normalize_ncm_codes(source.row->'ncm_codes'), '{}'::text[])
    FROM jsonb_array_elements(v_bls) AS source(row)
    WHERE NOT (source.row->>'id' = ANY(v_existing_ids))
    RETURNING id
  )
  SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::text[]) INTO v_inserted_ids FROM inserted;

  -- 3. B/Ls existentes: só o que o arquivo traz, B/L a B/L.
  FOR v_item IN
    SELECT source.row FROM jsonb_array_elements(v_bls) AS source(row)
    WHERE source.row->>'id' = ANY(v_existing_ids)
    ORDER BY source.row->>'id'
  LOOP
    v_bl_id := v_item->>'id';
    SELECT * INTO v_before FROM public.bls WHERE id = v_bl_id;

    -- Faturado = fatura viva ou status financeiro faturado/pago. Cálculo sem
    -- fatura não trava a rota: a tela recalcula o B/L alterado.
    v_billed := COALESCE(v_before.financial_status, 'pending') IN ('invoiced', 'paid')
      OR cardinality(public._live_local_invoice_ids_for_bl(v_bl_id)) > 0;
    v_override := COALESCE(NULLIF(v_item->>'override_billing', '')::boolean, false);
    v_cod := EXISTS (
      SELECT 1 FROM public.bl_transshipments AS t
      JOIN public.voyage_omissions AS o ON o.id = t.omission_id
      WHERE t.bl_id = v_bl_id AND t.disposition = 'cod' AND o.reverted_at IS NULL
    );
    v_in_customer := NULLIF(v_item->>'customer_id', '')::bigint;
    v_file_document := public.normalize_document_text(v_item->>'manifest_customer_cnpj_cpf');
    v_customer_mode := CASE
      -- 213 (fix 2): CNPJ do arquivo diferente do gravado e do Cliente
      -- vinculado, sem Cliente cadastrado (consignatário não cadastrado), é
      -- Troca de Consignatário: só com o aceite; sem ele, o consignatário fica.
      WHEN v_in_customer IS NULL
        AND v_before.customer_id IS NOT NULL
        AND v_file_document IS NOT NULL
        AND v_file_document IS DISTINCT FROM public.normalize_document_text(v_before.manifest_customer_cnpj_cpf)
        AND v_file_document IS DISTINCT FROM (
          SELECT public.normalize_document_text(c.cnpj_cpf) FROM public.customers AS c WHERE c.id = v_before.customer_id
        )
        THEN CASE WHEN COALESCE(NULLIF(v_item->>'relink_customer', '')::boolean, false) THEN 'relink' ELSE 'ignored' END
      WHEN v_in_customer IS NULL THEN 'keep'
      WHEN v_before.customer_id IS NULL THEN 'link'
      WHEN v_before.customer_id = v_in_customer THEN 'same'
      WHEN COALESCE(NULLIF(v_item->>'relink_customer', '')::boolean, false) THEN 'relink'
      ELSE 'ignored'
    END;

    v_route_locked := ARRAY[]::text[];
    v_new_pol := COALESCE(NULLIF(btrim(v_item->>'pol'), ''), v_before.pol);
    v_new_pod := COALESCE(NULLIF(btrim(v_item->>'pod'), ''), v_before.pod);
    IF v_new_pod IS DISTINCT FROM v_before.pod AND v_cod THEN
      v_cod_kept := v_cod_kept || jsonb_build_object('bl_id', v_bl_id, 'pod', v_before.pod, 'file_pod', v_new_pod);
      v_new_pod := v_before.pod;
    END IF;
    IF v_billed AND NOT v_override THEN
      IF v_new_pol IS DISTINCT FROM v_before.pol THEN
        v_route_locked := v_route_locked || 'pol'::text;
        v_new_pol := v_before.pol;
      END IF;
      IF v_new_pod IS DISTINCT FROM v_before.pod THEN
        v_route_locked := v_route_locked || 'pod'::text;
        v_new_pod := v_before.pod;
      END IF;
      -- 381 (ADR 0094, B5): sem a confirmação de faturamento, nada que afete a
      -- cobrança muda no B/L faturado: peso, CBM, volumes e máquinas ficam.
      IF NULLIF(v_item->>'bb_weight_ton', '')::numeric IS DISTINCT FROM v_before.bb_weight_ton AND NULLIF(v_item->>'bb_weight_ton', '') IS NOT NULL THEN
        v_route_locked := v_route_locked || 'peso'::text;
      END IF;
      IF NULLIF(v_item->>'bb_cbm', '')::numeric IS DISTINCT FROM v_before.bb_cbm AND NULLIF(v_item->>'bb_cbm', '') IS NOT NULL THEN
        v_route_locked := v_route_locked || 'cbm'::text;
      END IF;
      IF (NULLIF(v_item->>'bb_packages_qty', '')::numeric IS DISTINCT FROM v_before.bb_packages_qty AND NULLIF(v_item->>'bb_packages_qty', '') IS NOT NULL)
         OR (NULLIF(v_item->>'bb_packages_total', '')::numeric IS DISTINCT FROM v_before.bb_packages_total AND NULLIF(v_item->>'bb_packages_total', '') IS NOT NULL) THEN
        v_route_locked := v_route_locked || 'volumes'::text;
      END IF;
      IF NULLIF(v_item->>'bb_machine_qty', '')::numeric IS DISTINCT FROM v_before.bb_machine_qty AND NULLIF(v_item->>'bb_machine_qty', '') IS NOT NULL THEN
        v_route_locked := v_route_locked || 'maquinas'::text;
      END IF;
      v_item := v_item || jsonb_build_object('bb_weight_ton', NULL, 'bb_cbm', NULL, 'bb_packages_qty', NULL,
        'bb_packages_total', NULL, 'bb_machine_qty', NULL);
      IF cardinality(v_route_locked) > 0 THEN
        v_billing_locked := v_billing_locked || jsonb_build_object('bl_id', v_bl_id, 'fields', to_jsonb(v_route_locked));
      END IF;
    END IF;

    IF v_customer_mode = 'ignored' THEN
      v_customer_ignored := v_customer_ignored || jsonb_build_object(
        'bl_id', v_bl_id,
        'customer_id', v_before.customer_id,
        'file_customer_id', v_in_customer,
        'file_document', v_file_document,
        'file_consignee', NULLIF(v_item->>'consignee', '')
      );
    END IF;

    IF v_new_pod IS DISTINCT FROM v_before.pod
       AND (v_before.terminal_id IS NOT NULL OR v_before.pod_port_id IS NOT NULL) THEN
      PERFORM set_config('vela.bl_terminal_override', 'on', true);
    END IF;

    UPDATE public.bls AS b
    SET
      batch_id = v_batch_id,
      shipper = COALESCE(NULLIF(v_item->>'shipper', ''), b.shipper),
      -- B5 (192): na Troca de Consignatário o Consignee novo só entra se a troca
      -- for aplicada (UPDATE depois de `relink_bl_customer`).
      consignee = CASE WHEN v_customer_mode IN ('ignored', 'relink') THEN b.consignee
        ELSE COALESCE(NULLIF(v_item->>'consignee', ''), b.consignee) END,
      notify_party = COALESCE(NULLIF(v_item->>'notify_party', ''), b.notify_party),
      cargo_description = COALESCE(NULLIF(v_item->>'cargo_description', ''), b.cargo_description),
      pol = v_new_pol,
      pod = v_new_pod,
      -- 213 (fix 6): o desvínculo do Manifesto Mercante é do gatilho
      -- `unlink_manifesto_on_route_change` (207), que compara os portos
      -- normalizados e grava o Histórico legível.
      terminal_id = CASE WHEN v_new_pod IS DISTINCT FROM b.pod THEN NULL ELSE b.terminal_id END,
      pod_port_id = CASE WHEN v_new_pod IS DISTINCT FROM b.pod THEN NULL ELSE b.pod_port_id END,
      customer_id = CASE WHEN v_customer_mode = 'link' THEN v_in_customer ELSE b.customer_id END,
      suggested_customer_id = CASE
        WHEN v_customer_mode = 'link' THEN NULL
        WHEN b.customer_id IS NULL AND v_in_customer IS NULL AND v_item ? 'suggested_customer_id'
          THEN NULLIF(v_item->>'suggested_customer_id', '')::bigint
        ELSE b.suggested_customer_id
      END,
      customer_reconciliation_status = CASE
        WHEN v_customer_mode = 'link' THEN COALESCE(NULLIF(v_item->>'customer_reconciliation_status', ''), 'matched_document')
        WHEN v_customer_mode = 'same'
          AND COALESCE(b.customer_reconciliation_status, 'missing_customer') IN ('missing_customer', 'matched_name')
          AND v_item->>'customer_reconciliation_status' = 'matched_document'
          THEN 'matched_document'
        WHEN b.customer_id IS NULL AND v_in_customer IS NULL
          AND COALESCE(b.customer_reconciliation_status, 'missing_customer') IN ('missing_customer', 'matched_name')
          AND v_item->>'customer_reconciliation_status' IN ('missing_customer', 'matched_name')
          THEN v_item->>'customer_reconciliation_status'
        ELSE b.customer_reconciliation_status
      END,
      customer_reconciliation_notes = CASE
        WHEN v_customer_mode = 'link'
          OR (v_customer_mode = 'same'
            AND COALESCE(b.customer_reconciliation_status, 'missing_customer') IN ('missing_customer', 'matched_name')
            AND v_item->>'customer_reconciliation_status' = 'matched_document')
          OR (b.customer_id IS NULL AND v_in_customer IS NULL
            AND COALESCE(b.customer_reconciliation_status, 'missing_customer') IN ('missing_customer', 'matched_name')
            AND v_item->>'customer_reconciliation_status' IN ('missing_customer', 'matched_name'))
          THEN COALESCE(NULLIF(v_item->>'customer_reconciliation_notes', ''), b.customer_reconciliation_notes)
        ELSE b.customer_reconciliation_notes
      END,
      -- B6 (192): com o mesmo Cliente a retenção gravada (ex.: "Acesso ao portal
      -- nao provisionado") fica; só a reconciliação que sobe para documento
      -- troca a retenção pela do arquivo, como no B/L de container (175).
      billing_hold_reason = CASE
        WHEN v_customer_mode = 'link' THEN NULLIF(v_item->>'billing_hold_reason', '')
        WHEN v_customer_mode = 'same'
          AND COALESCE(b.customer_reconciliation_status, 'missing_customer') IN ('missing_customer', 'matched_name')
          AND v_item->>'customer_reconciliation_status' = 'matched_document'
          THEN NULLIF(v_item->>'billing_hold_reason', '')
        ELSE b.billing_hold_reason
      END,
      manifest_customer_cnpj_cpf = CASE
        WHEN v_customer_mode IN ('link', 'same') OR (b.customer_id IS NULL AND v_in_customer IS NULL)
          THEN COALESCE(public.normalize_document_text(v_item->>'manifest_customer_cnpj_cpf'), b.manifest_customer_cnpj_cpf)
        ELSE b.manifest_customer_cnpj_cpf
      END,
      manifest_customer_name = CASE
        WHEN v_customer_mode IN ('link', 'same') OR (b.customer_id IS NULL AND v_in_customer IS NULL)
          THEN COALESCE(NULLIF(v_item->>'manifest_customer_name', ''), b.manifest_customer_name)
        ELSE b.manifest_customer_name
      END,
      manifest_customer_email = CASE WHEN v_customer_mode IN ('ignored', 'relink') THEN b.manifest_customer_email
        ELSE COALESCE(NULLIF(v_item->>'manifest_customer_email', ''), b.manifest_customer_email) END,
      bb_machine_qty = COALESCE(NULLIF(v_item->>'bb_machine_qty', '')::numeric, b.bb_machine_qty),
      bb_packages_qty = COALESCE(NULLIF(v_item->>'bb_packages_qty', '')::numeric, b.bb_packages_qty),
      bb_packages_total = COALESCE(NULLIF(v_item->>'bb_packages_total', '')::numeric, b.bb_packages_total),
      bb_weight_ton = COALESCE(NULLIF(v_item->>'bb_weight_ton', '')::numeric, b.bb_weight_ton),
      bb_cbm = COALESCE(NULLIF(v_item->>'bb_cbm', '')::numeric, b.bb_cbm),
      ncm_codes = CASE
        WHEN cardinality(public.normalize_ncm_codes(v_item->'ncm_codes')) > 0
          THEN public.normalize_ncm_codes(v_item->'ncm_codes')
        ELSE b.ncm_codes
      END
    WHERE b.id = v_bl_id;

    PERFORM set_config('vela.bl_terminal_override', COALESCE(v_previous_terminal, 'off'), true);

    IF v_customer_mode = 'relink' THEN
      v_relink := public.relink_bl_customer(v_bl_id, v_in_customer, p_uploaded_by,
        'Troca de Consignatario aceita na reimportacao de carga solta');
      v_relinks := v_relinks || jsonb_build_array(v_relink || jsonb_build_object('bl_id', v_bl_id));
      IF COALESCE((v_relink->>'applied')::boolean, false) THEN
        UPDATE public.bls
        SET consignee = COALESCE(NULLIF(v_item->>'consignee', ''), consignee),
            manifest_customer_cnpj_cpf = COALESCE(public.normalize_document_text(v_item->>'manifest_customer_cnpj_cpf'), manifest_customer_cnpj_cpf),
            manifest_customer_name = COALESCE(NULLIF(v_item->>'manifest_customer_name', ''), manifest_customer_name),
            manifest_customer_email = COALESCE(NULLIF(v_item->>'manifest_customer_email', ''), manifest_customer_email)
        WHERE id = v_bl_id;
      END IF;
    END IF;

    -- Itens só são substituídos quando o arquivo os traz e eles mudaram.
    -- 213 (fix 4): com um item gravado e um no arquivo (B/L avulso PDF/DOCX e
    -- Manifesto BB do armador), o valor que o documento não traz (null ou
    -- vazio) fica o gravado: "Valor vazio no arquivo não apaga o valor gravado".
    -- ponytail: com mais de um item não há como parear as linhas; null vira 0
    -- como antes. Só o layout legado traz vários itens, sempre com os números.
    v_items_changed := false;
    SELECT jsonb_agg(item.row) INTO v_bl_items
    FROM jsonb_array_elements(v_items) AS item(row)
    WHERE item.row->>'bl_id' = v_bl_id;
    IF jsonb_array_length(COALESCE(v_bl_items, '[]'::jsonb)) = 1
       AND (SELECT count(*) FROM public.bl_breakbulk_items WHERE bl_id = v_bl_id) = 1 THEN
      SELECT jsonb_build_array(jsonb_build_object(
          'bl_id', v_bl_id,
          'item_description', COALESCE(NULLIF(v_bl_items->0->>'item_description', ''), i.item_description),
          'package_qty', COALESCE(NULLIF(v_bl_items->0->>'package_qty', '')::numeric, i.package_qty),
          'package_unit', COALESCE(NULLIF(v_bl_items->0->>'package_unit', ''), i.package_unit),
          'gross_weight_kg', COALESCE(NULLIF(v_bl_items->0->>'gross_weight_kg', '')::numeric, i.gross_weight_kg),
          'cbm', COALESCE(NULLIF(v_bl_items->0->>'cbm', '')::numeric, i.cbm),
          'marks', COALESCE(NULLIF(v_bl_items->0->>'marks', ''), i.marks)
        ))
        INTO v_bl_items
      FROM public.bl_breakbulk_items AS i
      WHERE i.bl_id = v_bl_id;
    END IF;
    IF v_bl_items IS NOT NULL THEN
      SELECT
        COALESCE((
          SELECT jsonb_agg(jsonb_build_array(i.item_description, i.package_qty, i.package_unit, i.gross_weight_kg, i.cbm, i.marks)
            ORDER BY i.item_description, i.package_qty, i.gross_weight_kg, i.cbm, i.package_unit, i.marks)
          FROM public.bl_breakbulk_items AS i WHERE i.bl_id = v_bl_id
        ), '[]'::jsonb)
        IS DISTINCT FROM
        COALESCE((
          SELECT jsonb_agg(jsonb_build_array(n.item_description, n.package_qty, n.package_unit, n.gross_weight_kg, n.cbm, n.marks)
            ORDER BY n.item_description, n.package_qty, n.gross_weight_kg, n.cbm, n.package_unit, n.marks)
          FROM (
            SELECT
              item.row->>'item_description' AS item_description,
              COALESCE(NULLIF(item.row->>'package_qty', '')::numeric, 0) AS package_qty,
              NULLIF(item.row->>'package_unit', '') AS package_unit,
              COALESCE(NULLIF(item.row->>'gross_weight_kg', '')::numeric, 0) AS gross_weight_kg,
              COALESCE(NULLIF(item.row->>'cbm', '')::numeric, 0) AS cbm,
              NULLIF(item.row->>'marks', '') AS marks
            FROM jsonb_array_elements(v_bl_items) AS item(row)
          ) AS n
        ), '[]'::jsonb)
      INTO v_items_changed;

      IF v_items_changed AND v_billed AND NOT v_override
         AND EXISTS (SELECT 1 FROM public.bl_breakbulk_items AS i WHERE i.bl_id = v_bl_id)
             IS DISTINCT FROM (jsonb_array_length(v_bl_items) > 0) THEN
        v_items_changed := false;
        v_billing_locked := v_billing_locked || jsonb_build_object('bl_id', v_bl_id, 'fields', jsonb_build_array('itens'));
      END IF;
      IF v_items_changed THEN
        DELETE FROM public.bl_breakbulk_items WHERE bl_id = v_bl_id;
        INSERT INTO public.bl_breakbulk_items (bl_id, item_description, package_qty, package_unit, gross_weight_kg, cbm, marks)
        SELECT v_bl_id, item.row->>'item_description',
          COALESCE(NULLIF(item.row->>'package_qty', '')::numeric, 0),
          NULLIF(item.row->>'package_unit', ''),
          COALESCE(NULLIF(item.row->>'gross_weight_kg', '')::numeric, 0),
          COALESCE(NULLIF(item.row->>'cbm', '')::numeric, 0),
          NULLIF(item.row->>'marks', '')
        FROM jsonb_array_elements(v_bl_items) AS item(row);
      END IF;
    END IF;

    SELECT * INTO v_after FROM public.bls WHERE id = v_bl_id;
    SELECT COALESCE(array_agg(f ORDER BY f), ARRAY[]::text[]) INTO v_changed_fields
    FROM unnest(v_tracked_fields) AS f
    WHERE to_jsonb(v_before)->f IS DISTINCT FROM to_jsonb(v_after)->f;
    IF v_items_changed THEN v_changed_fields := v_changed_fields || 'itens_carga_solta'::text; END IF;

    -- Revisão: a pendência de importação é refeita; sem pendência, o status
    -- humano fica e só a pendência antiga sai.
    v_has_live_invoice := EXISTS (
      SELECT 1 FROM public.invoice_bls AS ib JOIN public.invoices AS i ON i.id = ib.invoice_id
      WHERE ib.bl_id = v_bl_id AND i.status NOT IN ('cancelled', 'obsolete')
    );
    IF COALESCE(v_after.financial_status, 'pending') NOT IN ('invoiced', 'paid') AND NOT v_has_live_invoice THEN
      v_reasons := public.compute_bl_review_pendencies(v_bl_id);
      v_human_notes := btrim(regexp_replace(COALESCE(v_after.notes, ''), E'(^|\\n)Pendencias de importacao:[^\\n]*', '', 'gi'));
      v_notes := CASE
        WHEN COALESCE(cardinality(v_reasons), 0) > 0 THEN concat_ws(E'\n', NULLIF(v_human_notes, ''),
          'Pendencias de importacao: ' || array_to_string(v_reasons, ', '))
        ELSE NULLIF(v_human_notes, '')
      END;
      v_review := CASE
        WHEN COALESCE(cardinality(v_reasons), 0) > 0 THEN 'pending_review'
        WHEN v_after.review_status = 'pending_review' THEN 'ok'
        ELSE v_after.review_status
      END;
      IF v_review IS DISTINCT FROM v_after.review_status OR v_notes IS DISTINCT FROM v_after.notes THEN
        UPDATE public.bls SET review_status = v_review, notes = v_notes WHERE id = v_bl_id;
      END IF;
    END IF;

    IF cardinality(v_changed_fields) > 0 THEN
      v_updated_ids := v_updated_ids || v_bl_id;
      INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
      VALUES (
        'bl', v_bl_id, 'reimportacao_carga_solta', NULL,
        jsonb_build_object(
          'tipo', 'reimportacao_carga_solta',
          'viagem', COALESCE(v_voyage_label, p_voyage_id::text),
          'rota', concat_ws(' -> ', v_after.pol, v_after.pod),
          'campos', to_jsonb(v_changed_fields)
        )::text,
        p_uploaded_by,
        'Reimportacao de carga solta na Viagem ' || COALESCE(v_voyage_label, p_voyage_id::text)
          || ' (rota ' || concat_ws(' -> ', COALESCE(v_after.pol, '?'), COALESCE(v_after.pod, '?')) || ')'
      );
    END IF;
  END LOOP;

  -- 4. Itens dos B/Ls novos.
  INSERT INTO public.bl_breakbulk_items (bl_id, item_description, package_qty, package_unit, gross_weight_kg, cbm, marks)
  SELECT item.row->>'bl_id', item.row->>'item_description',
    COALESCE(NULLIF(item.row->>'package_qty', '')::numeric, 0),
    NULLIF(item.row->>'package_unit', ''),
    COALESCE(NULLIF(item.row->>'gross_weight_kg', '')::numeric, 0),
    COALESCE(NULLIF(item.row->>'cbm', '')::numeric, 0),
    NULLIF(item.row->>'marks', '')
  FROM jsonb_array_elements(v_items) AS item(row)
  WHERE item.row->>'bl_id' = ANY(v_inserted_ids);

  IF cardinality(v_bl_ids) > 0 THEN
    PERFORM public.apply_bl_review_gate_after_import(v_bl_ids, p_uploaded_by);
  END IF;
  -- B3 (192): a fila de Reconciliação de Cliente acompanha todo B/L do arquivo
  -- (inseridos e atualizados, inclusive os da Troca de Consignatário), como no
  -- B/L de container (175). O B/L que passa a ter Cliente por CNPJ não deixa
  -- item `pending` velho na fila.
  FOREACH v_bl_id IN ARRAY v_bl_ids LOOP
    PERFORM public.sync_customer_reconciliation_queue_for_bl(v_bl_id);
  END LOOP;

  -- Efeito de taxas locais só para o que entrou ou mudou: reimportar o mesmo
  -- arquivo não enfileira trabalho.
  v_effect_ids := v_inserted_ids || v_updated_ids;
  FOREACH v_bl_id IN ARRAY v_effect_ids LOOP
    INSERT INTO public.import_pending_effects(
      source_action_id, effect_kind, entity_id, created_by, source_snapshot
    ) VALUES (
      v_action_id, 'local_billing', v_bl_id, p_uploaded_by,
      jsonb_build_object('filename', p_filename, 'voyage_id', p_voyage_id, 'cargo_mode', 'carga_solta')
    )
    ON CONFLICT (source_action_id, effect_kind, entity_id) DO NOTHING;
  END LOOP;

  v_reissues := COALESCE(public.process_invoice_basis_changes(), '[]'::jsonb);
  PERFORM set_config('vela.invoice_basis_source', COALESCE(v_previous_basis_source, ''), true);
  PERFORM set_config('vela.breakbulk_import_replacement', COALESCE(v_previous_replacement, 'off'), true);

  RETURN jsonb_build_object(
    'batch_id', v_batch_id,
    'breakbulk_bl_ids', to_jsonb(v_bl_ids),
    'inserted_bl_ids', to_jsonb(v_inserted_ids),
    'updated_bl_ids', to_jsonb(v_updated_ids),
    'unchanged_bl_ids', to_jsonb(ARRAY(
      SELECT existing.id FROM unnest(v_existing_ids) AS existing(id)
      WHERE NOT (existing.id = ANY(v_updated_ids)) ORDER BY existing.id
    )),
    'customer_changes_ignored', v_customer_ignored,
    'customer_relinks', v_relinks,
    'billing_locked', v_billing_locked,
    'cod_pod_kept', v_cod_kept,
    'ce_ignored', to_jsonb(v_ce_ignored),
    'invoice_reissues', v_reissues
  );
END;
$function$;
