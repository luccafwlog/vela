-- 354: o B/L fica vinculado à tabela de taxas do primeiro cálculo
-- (ADR 0093, decisões 1 e 2; plano docs/plans/2026-10-21-correcoes-frente-financeira.md, lote 0).
--
-- Depende do "Data status" do AGENTS.md: o backfill grava o vínculo dos B/Ls
-- existentes pela tabela do último cálculo, sem plano de preservação, porque
-- as linhas de produção são de teste.
--
-- Problema: cada recálculo escolhia de novo a tabela ativa do escopo
-- (`resolve_bl_local_charge_table_ids`, 056). Ativar uma tabela nova mudava o
-- preço de B/Ls antigos no próximo evento, e editar um item de tabela usada
-- não tinha efeito nenhum até o próximo recálculo.
--
-- Mudança:
--   1. `bl_charge_table_links` guarda, por B/L e escopo (container e carga
--      solta), a tabela vinculada. Só o servidor grava; a API só lê.
--   2. `bind_bl_local_charge_tables` vincula no cálculo: mantém o vínculo que
--      ainda serve ao modo de carga e ao POD do B/L, vincula a tabela ativa do
--      escopo quando falta ou deixou de servir, e solta o escopo que o B/L
--      não usa mais. Desativar a tabela não desvincula.
--   3. `resolve_bl_local_charge_table_ids` (usado pelo motor, pela cotação da
--      correção, pelo lançamento manual e pela emissão) lê o vínculo; sem ele,
--      cai na tabela ativa, como antes.
--   4. Item de tabela já usada (vínculo, cálculo ou fatura) e Condição de
--      Cliente só são editados pelo Administrativo. Criar tabela, incluir
--      item em tabela ainda não usada e criar Condição continuam com todos.
--   5. Editar item ou Condição é correção (decisão 2): recalcula os B/Ls não
--      faturados vinculados, inclusive com CE, e passa os faturados pela
--      correção automática (`apply_invoice_basis_changes`, fonte
--      `tariff_correction`): sem pagamento cancela e reemite; com pagamento
--      abate e restitui ou abre Fatura desatualizada. Criar, ativar ou
--      desativar Condição recalcula só os B/Ls não faturados e sem CE do
--      Cliente.
--   6. Excluir tabela vinculada a B/L é recusado como as demais tarifas usadas.

CREATE TABLE public.bl_charge_table_links (
  bl_id text NOT NULL REFERENCES public.bls(id) ON DELETE CASCADE,
  scope text NOT NULL CHECK (scope IN ('container', 'carga_solta')),
  charge_table_id bigint NOT NULL REFERENCES public.charge_tables(id),
  bound_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (bl_id, scope)
);
CREATE INDEX idx_bl_charge_table_links_table ON public.bl_charge_table_links (charge_table_id);
COMMENT ON TABLE public.bl_charge_table_links IS
  'Tabela de Taxas Locais vinculada ao B/L por escopo (ADR 0093, decisão 1). Gravada só pelo servidor no cálculo.';
ALTER TABLE public.bl_charge_table_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.bl_charge_table_links FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.bl_charge_table_links TO authenticated;
GRANT ALL ON public.bl_charge_table_links TO service_role;
CREATE POLICY bl_charge_table_links_select_read ON public.bl_charge_table_links
  FOR SELECT TO authenticated USING ((SELECT public.is_active_read_user()));

-- Escopos que o modo de carga usa.
CREATE OR REPLACE FUNCTION public._bl_charge_scopes(p_cargo_mode text)
RETURNS text[]
LANGUAGE sql IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE coalesce(p_cargo_mode, 'container')
    WHEN 'container' THEN ARRAY['container']
    WHEN 'carga_solta' THEN ARRAY['carga_solta']
    WHEN 'misto' THEN ARRAY['container', 'carga_solta']
    ELSE ARRAY[]::text[] END;
$$;
REVOKE ALL ON FUNCTION public._bl_charge_scopes(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._bl_charge_scopes(text) TO service_role;

-- Tabela do escopo para o B/L: a vinculada, se ainda serve ao escopo e ao
-- POD (ativa ou não); senão a ativa de vigência mais recente.
CREATE OR REPLACE FUNCTION public._bl_charge_table_for_scope(p_bl_id text, p_scope text, p_pod text)
RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT coalesce(
    (SELECT l.charge_table_id
       FROM public.bl_charge_table_links l
       JOIN public.charge_tables ct ON ct.id = l.charge_table_id
      WHERE l.bl_id = p_bl_id AND l.scope = p_scope
        AND ct.cargo_mode = p_scope
        AND public.normalize_port_code(ct.pod) = public.normalize_port_code(p_pod)),
    public.resolve_local_charge_table_id(p_scope, p_pod, NULL));
$$;
REVOKE ALL ON FUNCTION public._bl_charge_table_for_scope(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._bl_charge_table_for_scope(text, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.resolve_bl_local_charge_table_ids(p_bl_id text, p_reference_date date DEFAULT NULL::date)
RETURNS TABLE(table_id bigint, cargo_mode text)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_bl record;
  v_scope text;
BEGIN
  -- p_reference_date fica por compatibilidade: a vigência não escolhe a
  -- tabela (ADR 0040); o vínculo do B/L escolhe (ADR 0093, decisão 1).
  SELECT b.id, b.pod, b.cargo_mode INTO v_bl FROM public.bls b WHERE b.id = p_bl_id;
  IF NOT FOUND THEN RETURN; END IF;
  FOREACH v_scope IN ARRAY public._bl_charge_scopes(v_bl.cargo_mode) LOOP
    table_id := public._bl_charge_table_for_scope(p_bl_id, v_scope, v_bl.pod);
    cargo_mode := v_scope;
    IF table_id IS NOT NULL THEN RETURN NEXT; END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.bind_bl_local_charge_tables(p_bl_id text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_bl record;
  v_scope text;
  v_table bigint;
BEGIN
  SELECT b.id, b.pod, b.cargo_mode INTO v_bl FROM public.bls b WHERE b.id = p_bl_id;
  IF NOT FOUND THEN RETURN; END IF;
  DELETE FROM public.bl_charge_table_links
   WHERE bl_id = p_bl_id AND NOT (scope = ANY(public._bl_charge_scopes(v_bl.cargo_mode)));
  FOREACH v_scope IN ARRAY public._bl_charge_scopes(v_bl.cargo_mode) LOOP
    v_table := public._bl_charge_table_for_scope(p_bl_id, v_scope, v_bl.pod);
    IF v_table IS NULL THEN
      DELETE FROM public.bl_charge_table_links WHERE bl_id = p_bl_id AND scope = v_scope;
    ELSE
      INSERT INTO public.bl_charge_table_links (bl_id, scope, charge_table_id)
      VALUES (p_bl_id, v_scope, v_table)
      ON CONFLICT (bl_id, scope) DO UPDATE
        SET charge_table_id = EXCLUDED.charge_table_id, bound_at = now()
        WHERE bl_charge_table_links.charge_table_id IS DISTINCT FROM EXCLUDED.charge_table_id;
    END IF;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.bind_bl_local_charge_tables(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bind_bl_local_charge_tables(text) TO service_role;


-- O cálculo vincula antes de resolver os itens.
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

-- Motivo da reemissão pela correção de tarifa.
CREATE OR REPLACE FUNCTION public.apply_invoice_basis_changes_legacy_130(p_bl_ids text[], p_source text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_bl_id text;
  v_invoices bigint[];
  v_receivable record;
  v_quote jsonb;
  v_customer_changed boolean;
  v_reissue text[] := ARRAY[]::text[];
  v_cancelled bigint[] := ARRAY[]::bigint[];
  v_consolidated bigint[] := ARRAY[]::bigint[];
  v_results jsonb := '[]'::jsonb;
  v_reason text;
  v_bill jsonb;
  v_pending text;
  v_id bigint;
  v_reissued jsonb;
BEGIN
  v_reason := CASE p_source
    WHEN 'baplie_correction' THEN 'Reemissao automatica: flags do Baplie alteraram a base faturada'
    WHEN 'bl_reimport_correction' THEN 'Reemissao automatica: reimportacao alterou a base faturada'
    WHEN 'tariff_correction' THEN 'Reemissao automatica: correcao da tabela de taxas ou da Condicao de Cliente'
    ELSE 'Reemissao automatica: alteracao do B/L mudou a base faturada' END;

  FOREACH v_bl_id IN ARRAY p_bl_ids LOOP
    v_invoices := public._live_local_invoice_ids_for_bl(v_bl_id);
    IF cardinality(v_invoices) = 0 THEN CONTINUE; END IF;
    v_receivable := NULL;
    SELECT * INTO v_receivable FROM public.bl_receivables WHERE bl_id = v_bl_id AND source = 'local_charges';
    v_quote := public._quote_bl_local_charges(v_bl_id, v_receivable.roe_frozen);
    v_customer_changed := EXISTS (SELECT 1 FROM public.invoices i JOIN public.bls b ON b.id = v_bl_id
      WHERE i.id = ANY(v_invoices) AND i.customer_id IS DISTINCT FROM b.customer_id);

    IF v_receivable.id IS NOT NULL AND NOT v_customer_changed AND v_quote->>'status' IN ('ok', 'exempt')
       AND (v_quote->>'total_brl')::numeric = v_receivable.original_amount_brl - v_receivable.correction_amount_brl THEN
      PERFORM public._clear_post_billing_hold(v_bl_id);
      CONTINUE;  -- a mudança não altera o valor nem o Cliente
    END IF;

    IF EXISTS (SELECT 1 FROM public.payments p WHERE p.invoice_id = ANY(v_invoices))
       OR EXISTS (SELECT 1 FROM public.invoices i WHERE i.id = ANY(v_invoices) AND i.status IN ('partially_paid', 'paid'))
       OR EXISTS (SELECT 1 FROM public.invoice_corrections c WHERE c.receivable_id = v_receivable.id) THEN
      IF v_receivable.id IS NULL THEN
        PERFORM public.alert_stale_invoice_for_bl(v_bl_id, p_source);
        v_results := v_results || jsonb_build_object('bl_id', v_bl_id, 'status', 'has_payment', 'pending_reason', NULL);
      ELSE
        v_results := v_results || public._apply_paid_basis_change(v_bl_id, v_receivable.id, v_quote, v_customer_changed, p_source, v_actor);
      END IF;
    ELSIF v_actor IS NULL THEN
      PERFORM public.alert_stale_invoice_for_bl(v_bl_id, p_source);
      v_results := v_results || jsonb_build_object('bl_id', v_bl_id, 'status', 'pending', 'pending_reason', 'sem usuario para reemitir');
    ELSE
      v_reissue := v_reissue || v_bl_id;
    END IF;
  END LOOP;

  IF cardinality(v_reissue) = 0 THEN RETURN v_results; END IF;

  -- Cancela tudo antes de emitir: a consolidada volta uma vez só.
  FOR v_id IN
    SELECT DISTINCT inv.id FROM public.invoices inv JOIN public.invoice_receivable_links l ON l.invoice_id = inv.id
    WHERE l.bl_id = ANY(v_reissue) AND l.status IN ('active', 'settled_by_this_invoice')
      AND inv.invoice_type = 'consolidated' AND coalesce(inv.status, 'issued') IN ('draft', 'issued', 'overdue')
    ORDER BY inv.id
  LOOP
    PERFORM public._cancel_invoice_core(v_id, v_reason || ' (B/L ' || array_to_string(v_reissue, ', ') || ').', v_actor);
    UPDATE public.invoices SET reissue_requested_at = now() WHERE id = v_id;
    v_cancelled := v_cancelled || v_id;
    v_consolidated := v_consolidated || v_id;
  END LOOP;
  FOR v_id IN
    SELECT DISTINCT inv.id FROM public.invoices inv JOIN public.invoice_bls ib ON ib.invoice_id = inv.id
    WHERE ib.bl_id = ANY(v_reissue) AND inv.invoice_type = 'individual'
      AND coalesce(inv.status, 'issued') IN ('draft', 'issued', 'overdue')
    ORDER BY inv.id
  LOOP
    PERFORM public._cancel_invoice_core(v_id, v_reason || '.', v_actor);
    UPDATE public.invoices SET reissue_requested_at = now() WHERE id = v_id;
    v_cancelled := v_cancelled || v_id;
  END LOOP;

  FOREACH v_bl_id IN ARRAY v_reissue LOOP
    PERFORM public._clear_post_billing_hold(v_bl_id);
    v_bill := public._auto_bill_bl_core(v_bl_id, v_actor, false);
    v_pending := NULL;
    IF v_bill->>'status' <> 'invoiced' AND coalesce(v_bill->>'reason', '') <> 'exempt' THEN
      -- Isento: o gatilho do B/L encerra a pendência. Demais travas: alerta.
      v_pending := coalesce(v_bill->>'reason', v_bill->>'status') || coalesce(': ' || nullif(v_bill->>'message', ''), '');
      FOR v_id IN SELECT i.id FROM public.invoices i JOIN public.invoice_bls ib ON ib.invoice_id = i.id
        WHERE ib.bl_id = v_bl_id AND i.id = ANY(v_cancelled)
          AND NOT EXISTS (SELECT 1 FROM public.invoices s WHERE s.replaces_invoice_id = i.id) LOOP
        PERFORM public.upsert_alert_item('fatura_desatualizada', 'invoice', v_id::text,
          'Fatura cancelada para reemissao automatica do B/L ' || v_bl_id || ', mas a nova emissao nao saiu (' || v_pending
            || '). Resolva o motivo e use Emitir fatura na ficha do B/L; ela segue em Reemissao pendente.',
          p_source, 'administrativo',
          jsonb_build_object('bl_id', v_bl_id, 'invoice_id', v_id, 'auto_reissue', 'pending', 'reason', v_pending),
          '/taxas-locais?invoice=' || v_id);
      END LOOP;
    END IF;
    v_results := v_results || jsonb_build_object('bl_id', v_bl_id,
      'status', CASE WHEN v_pending IS NULL THEN 'reissued' ELSE 'pending' END, 'pending_reason', v_pending);
  END LOOP;

  -- Quem não foi puxado pela individual (B/L isento, cancelado ou travado)
  -- é encerrado ou fica aguardando com o motivo.
  FOREACH v_id IN ARRAY v_consolidated LOOP
    PERFORM public._try_recreate_consolidated(v_id, v_actor);
  END LOOP;

  -- Sucessoras de cada fatura cancelada, para o retorno.
  SELECT coalesce(jsonb_agg(jsonb_build_object('type', s.invoice_type, 'invoice_id', s.id, 'replaces', s.replaces_invoice_id) ORDER BY s.id), '[]'::jsonb)
  INTO v_reissued FROM public.invoices s WHERE s.replaces_invoice_id = ANY(v_cancelled);
  SELECT coalesce(jsonb_agg(CASE WHEN r->>'status' IN ('reissued', 'pending') AND NOT (r ? 'cancelled_invoice_ids') THEN r || jsonb_build_object(
      'cancelled_invoice_ids', to_jsonb(v_cancelled), 'reissued', v_reissued) ELSE r END), '[]'::jsonb)
  INTO v_results FROM jsonb_array_elements(v_results) r;

  INSERT INTO public.audit_logs(entity_type, entity_id, field_name, new_value, changed_by, justification)
  VALUES ('bl', array_to_string(v_reissue, ','), 'auto_reissue_invoices',
    jsonb_build_object('cancelled', to_jsonb(v_cancelled), 'reissued', v_reissued)::text, v_actor, v_reason);
  RETURN v_results;
END;
$function$;

-- Tabela vinculada a B/L também é tarifa usada.
CREATE OR REPLACE FUNCTION public.guard_used_tariff_delete()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
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
      OR EXISTS (SELECT 1 FROM public.pricing_rule_versions WHERE charge_table_id = OLD.id)
      OR EXISTS (SELECT 1 FROM public.bl_charge_table_links WHERE charge_table_id = OLD.id);
  ELSIF TG_TABLE_NAME = 'customer_rate_overrides' THEN
    v_used := EXISTS (SELECT 1 FROM public.pricing_rule_versions WHERE customer_rate_override_id = OLD.id);
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

-- Vínculo dos B/Ls existentes: a tabela do último cálculo de cada escopo; sem
-- cálculo, a das linhas de fatura viva. Sem nenhum dos dois, no próximo
-- cálculo.
INSERT INTO public.bl_charge_table_links (bl_id, scope, charge_table_id, bound_at)
SELECT DISTINCT ON (src.bl_id, ct.cargo_mode) src.bl_id, ct.cargo_mode, ct.id, now()
FROM (
  SELECT cc.bl_id, cc.charge_table_id, cc.calculated_at AS at, 1 AS rank
  FROM public.charge_calculations cc WHERE cc.charge_table_id IS NOT NULL
  UNION ALL
  SELECT ib.bl_id, ii.charge_table_id, i.created_at, 2
  FROM public.invoice_items ii
  JOIN public.invoices i ON i.id = ii.invoice_id
  JOIN public.invoice_bls ib ON ib.invoice_id = i.id
  WHERE ii.charge_table_id IS NOT NULL AND coalesce(i.status, 'issued') <> 'cancelled'
    AND i.invoice_type IN ('individual', 'consolidated')
) src
JOIN public.charge_tables ct ON ct.id = src.charge_table_id
JOIN public.bls b ON b.id = src.bl_id
WHERE ct.cargo_mode = ANY(public._bl_charge_scopes(b.cargo_mode))
ORDER BY src.bl_id, ct.cargo_mode, src.rank, src.at DESC NULLS LAST, ct.id DESC
ON CONFLICT (bl_id, scope) DO NOTHING;

-- Tabela "usada": vinculada a B/L, calculada ou faturada.
CREATE OR REPLACE FUNCTION public.charge_table_in_use(p_table_id bigint)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (SELECT 1 FROM public.bl_charge_table_links WHERE charge_table_id = p_table_id)
    OR EXISTS (SELECT 1 FROM public.charge_calculations WHERE charge_table_id = p_table_id)
    OR EXISTS (SELECT 1 FROM public.invoice_items WHERE charge_table_id = p_table_id);
$$;
REVOKE ALL ON FUNCTION public.charge_table_in_use(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.charge_table_in_use(bigint) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.guard_tariff_correction_admin()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR public.is_admin() THEN
    RETURN NEW;
  END IF;
  -- Ativar e desativar já são do Administrativo, com a mensagem própria
  -- (`guard_tariff_active_change`).
  IF TG_OP = 'UPDATE' AND (to_jsonb(NEW) - 'active') = (to_jsonb(OLD) - 'active') THEN
    RETURN NEW;
  END IF;
  IF TG_TABLE_NAME = 'charge_table_items' THEN
    IF public.charge_table_in_use(NEW.charge_table_id)
       OR (TG_OP = 'UPDATE' AND public.charge_table_in_use(OLD.charge_table_id)) THEN
      RAISE EXCEPTION 'Só o Administrativo corrige item de tabela já usada: a correção reemite as faturas. Para reajuste de preço, crie uma tabela nova.'
        USING ERRCODE = '42501';
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Só o Administrativo edita Condição de Cliente: a correção reemite as faturas. Para reajuste, crie uma Condição nova com vigência nova.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_tariff_correction_admin() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER guard_tariff_correction_admin
  BEFORE INSERT OR UPDATE ON public.charge_table_items
  FOR EACH ROW EXECUTE FUNCTION public.guard_tariff_correction_admin();
CREATE TRIGGER guard_tariff_correction_admin
  BEFORE UPDATE ON public.customer_rate_overrides
  FOR EACH ROW EXECUTE FUNCTION public.guard_tariff_correction_admin();

-- Recalcula os B/Ls afetados por uma correção de tarifa. Não faturados:
-- recálculo (com ou sem CE, conforme p_with_ce). Faturados (p_billed):
-- correção automática da fatura pelo preço novo.
CREATE OR REPLACE FUNCTION public._reprice_bls_after_tariff_change(p_bl_ids text[], p_with_ce boolean, p_billed boolean)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_bl text;
  v_billed text[] := ARRAY[]::text[];
  v_recalculated integer := 0;
  v_result jsonb := '[]'::jsonb;
BEGIN
  FOR v_bl IN
    SELECT b.id FROM public.bls b
    WHERE b.id = ANY(coalesce(p_bl_ids, ARRAY[]::text[])) AND b.cancelled_at IS NULL
    ORDER BY b.id
  LOOP
    IF EXISTS (SELECT 1 FROM public.bls b WHERE b.id = v_bl
               AND coalesce(b.financial_status, 'pending') IN ('invoiced', 'partially_paid', 'paid')) THEN
      IF p_billed THEN v_billed := v_billed || v_bl; END IF;
    ELSIF p_with_ce OR EXISTS (SELECT 1 FROM public.bls b WHERE b.id = v_bl AND nullif(btrim(b.ce_mercante), '') IS NULL) THEN
      PERFORM public._calculate_bl_local_charges_impl_106(v_bl, auth.uid(), true);
      v_recalculated := v_recalculated + 1;
    END IF;
  END LOOP;

  IF cardinality(v_billed) > 0 AND current_setting('vela.invoice_basis_running', true) IS DISTINCT FROM 'on' THEN
    PERFORM set_config('vela.invoice_basis_running', 'on', true);
    PERFORM set_config('vela.invoice_basis_reprice', 'on', true);
    v_result := public.apply_invoice_basis_changes(v_billed, 'tariff_correction');
    PERFORM set_config('vela.invoice_basis_reprice', 'off', true);
    PERFORM set_config('vela.invoice_basis_running', 'off', true);
  END IF;
  RETURN jsonb_build_object('recalculated', v_recalculated, 'billed', to_jsonb(v_billed), 'invoices', v_result);
END;
$$;
REVOKE ALL ON FUNCTION public._reprice_bls_after_tariff_change(text[], boolean, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._reprice_bls_after_tariff_change(text[], boolean, boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.reprice_bls_on_charge_item_change()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_bls text[];
BEGIN
  IF TG_OP = 'UPDATE' AND (to_jsonb(NEW) - 'created_at' - 'sort_order') = (to_jsonb(OLD) - 'created_at' - 'sort_order') THEN
    RETURN NULL;
  END IF;
  SELECT array_agg(DISTINCT l.bl_id) INTO v_bls
  FROM public.bl_charge_table_links l
  WHERE l.charge_table_id IN (NEW.charge_table_id, CASE WHEN TG_OP = 'UPDATE' THEN OLD.charge_table_id END);
  IF v_bls IS NOT NULL THEN
    PERFORM public._reprice_bls_after_tariff_change(v_bls, true, true);
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.reprice_bls_on_charge_item_change() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER reprice_bls_on_charge_item_change
  AFTER INSERT OR UPDATE ON public.charge_table_items
  FOR EACH ROW EXECUTE FUNCTION public.reprice_bls_on_charge_item_change();

CREATE OR REPLACE FUNCTION public.reprice_bls_on_customer_rate_change()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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
$$;
REVOKE ALL ON FUNCTION public.reprice_bls_on_customer_rate_change() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER reprice_bls_on_customer_rate_change
  AFTER INSERT OR UPDATE ON public.customer_rate_overrides
  FOR EACH ROW EXECUTE FUNCTION public.reprice_bls_on_customer_rate_change();

-- O vínculo sai com o B/L também quando a exclusão roda sem as FKs
-- (`session_replication_role = replica`, usado em manutenção e nas suítes):
-- um B/L recriado com o mesmo número não herda a tabela do anterior.
CREATE OR REPLACE FUNCTION public.drop_bl_financial_bindings()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  DELETE FROM public.bl_charge_table_links WHERE bl_id = OLD.id;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.drop_bl_financial_bindings() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER drop_bl_financial_bindings
  AFTER DELETE ON public.bls
  FOR EACH ROW EXECUTE FUNCTION public.drop_bl_financial_bindings();
ALTER TABLE public.bls ENABLE ALWAYS TRIGGER drop_bl_financial_bindings;
