-- 509: mensagens de recusa das RPCs em português com acento e no
-- vocabulário do operador. Conferência do Manual do Operador (Apêndice B e
-- matriz de cobertura, 2026-10-29): recusas como "Usuario sem permissao
-- ativa.", "Credenciais invalidas para importar frete do BL." e "O CE Mercante
-- do B/L … nao pode ser removido: ha fatura emitida" chegavam à tela sem acento
-- ou com termo técnico ("Credenciais" para falta de permissão).
--
-- Cada função abaixo é a definição vigente (a da migration mais recente que a
-- redefiniu, lida com pg_get_functiondef no Postgres local com toda a cadeia
-- aplicada) com SÓ o texto dos `RAISE EXCEPTION` trocado; lógica, ERRCODE,
-- assinatura, SECURITY DEFINER e search_path ficam iguais. `CREATE OR REPLACE`
-- preserva dono, grants e comentários. Os ERRCODEs não mudam, então o front
-- (`classifyDbError`) classifica as recusas como antes.
--
-- Textos trocados:
--   Usuario sem permissao[ ativa][…]  -> Usuário sem permissão[ ativa][…]
--   Credenciais invalidas [ou sem permissao ]para … -> Usuário sem permissão para …
--     (fora: "Credenciais invalidas para o portal do cliente.", que é o login
--     do Portal, e "Credenciais invalidas para importar manifesto Granito.",
--     comparado por SQLERRM em import_granite_manifest_transactional_core_405)
--   Credenciais invalidas para importar frete do BL.
--     -> Usuário sem permissão para importar o frete do B/L.
--   Credenciais invalidas para editar cliente.
--     -> Usuário sem permissão para editar o Cliente.
--   Credenciais invalidas ou sem permissao[ de faturamento | para reconciliacao PIX].
--     -> Usuário sem permissão[ de faturamento | para a conciliação de Pix].
--   Sem permissao[ de faturamento].  -> Sem permissão[ de faturamento].
--   … nao pode ser removido: ha fatura emitida -> … não pode ser removido: há fatura emitida
--   Somente usuario interno ativo pode reverter omissao, com o proprio usuario autenticado.
--     -> Somente usuário interno ativo pode reverter a omissão, em nome do próprio usuário.
--   E, só com acento: B/L em revisão manual não pode ser faturado; Câmbio (ROE)
--   não configurado[; não é possível …]; fatura já paga / não é uma
--   consolidada / não pode ser desfeita / não encontrada; Limite de tentativas
--   … esta ação; já está / já estão em consolidada aberta; já foi faturado: não
--   se desvincula; não pode ser reativado …; Omissão … não encontrada / já foi
--   revertida.
--
-- Só redefine funções; não reescreve nem apaga linhas (textos já gravados em
-- alertas e efeitos ficam como estão).
-- Rollback: reaplicar cada função pela migration anterior que a definiu.
--
-- Funções redefinidas:
--   _add_manual_bl_charge_impl_106(text,bigint,numeric,text,uuid)
--   _apply_baplie_physical_flags_before_reissue_126(bigint,jsonb,uuid)
--   _assert_import_caller()
--   _auto_bill_bl_core(text,uuid,boolean)
--   _calculate_bl_local_charges_impl_491(text,uuid,boolean)
--   _create_manual_invoice_core_272(bigint,text,numeric,numeric,text,text,bigint,uuid,bigint)
--   _create_manual_invoice_custom_122(bigint,text,numeric,numeric,text,text,bigint,uuid)
--   _import_bl_freight_before_invoice_alert_123(jsonb,uuid)
--   _list_invoice_details_legacy_134(bigint)
--   _list_invoice_details_legacy_20260926(bigint)
--   _reject_customer_reconciliation_impl_106(bigint,text,uuid)
--   _reverse_invoice_payment_impl_109(bigint,text,uuid)
--   _run_billing_for_import_batch_impl_106(bigint,uuid,boolean)
--   _sync_local_charge_receivable_before_correction_123(text)
--   _update_manual_bl_charge_impl_491(bigint,numeric,text,uuid)
--   add_manual_bl_charge(text,bigint,numeric,text,uuid)
--   add_manual_invoice_charge(bigint,text,numeric,numeric,text,uuid)
--   apply_baplie_physical_flags_atomic(bigint,jsonb,uuid)
--   apply_baplie_physical_flags_atomic_legacy_189(bigint,jsonb,uuid)
--   apply_bl_review_gate_after_import(text[],uuid)
--   apply_ce_mercante_rows_atomic(jsonb,uuid,text,text,bigint,boolean,text,boolean)
--   apply_ce_mercante_rows_atomic_legacy_189(jsonb,uuid,text,text,bigint,boolean,text,boolean)
--   apply_ce_mercante_update(text,text,uuid)
--   apply_cod_financial_effect_legacy_130(text,bigint,text)
--   apply_container_dates_atomic_legacy_189(uuid,text,jsonb,uuid)
--   apply_container_dates_batch_atomic(uuid,jsonb,uuid)
--   apply_customer_base_batch_atomic(jsonb,uuid)
--   apply_customer_base_row_atomic_legacy_189(text,text,text,text,text,text,text,jsonb,uuid,boolean)
--   apply_demurrage_discount(uuid,bigint,text,numeric,text,text,text)
--   approve_customer_reconciliation(bigint,bigint,text,uuid)
--   assert_voyage_escala_ready_for_report_close(bigint,text,uuid)
--   backfill_invoice_receivable_links(integer)
--   backfill_local_charge_receivables(integer)
--   bl_file_import_preview(bigint,text[])
--   calculate_bl_local_charges_batch(text[],uuid,boolean)
--   cancel_demurrage_invoice(uuid,bigint,text)
--   cancel_invoice(bigint,text,uuid)
--   charge_tables_in_use(bigint[])
--   check_portal_rate_limit(text,integer,integer)
--   close_agency_departure_report(bigint,text,jsonb)
--   close_agency_departure_report_by_report_id(uuid,bigint,text,jsonb)
--   confirm_demurrage_pix_matches(jsonb)
--   confirm_unified_pix_matches(jsonb)
--   correct_bl_ce_mercante(text,text,text,text)
--   create_customer_from_bl_manifest(text)
--   create_customer_with_contacts(jsonb,jsonb)
--   create_demurrage_invoice_authoritative(text,text,bigint,bigint[],timestamp with time zone)
--   create_demurrage_invoice_with_items(text,text,bigint,numeric,date,boolean,numeric,numeric,text,jsonb)
--   create_invoice_from_bls(text[],bigint,text,boolean,uuid)
--   create_invoice_from_bls_core(text[],bigint,text,boolean,uuid,text,bigint)
--   create_invoice_from_bls_with_ledger(text[],bigint,text,boolean,uuid)
--   create_local_consolidated_invoice(bigint,bigint[],text,uuid)
--   create_local_consolidated_invoice_core(bigint,bigint[],uuid,text)
--   create_manual_invoice(bigint,text,numeric,numeric,text,text,bigint,uuid,bigint,text)
--   delete_manual_invoice_charge(bigint,uuid)
--   delete_manual_vazios_booking(uuid,text)
--   detect_agency_report_deadline_missed()
--   detect_agency_report_department_pending()
--   detect_agency_report_pending()
--   emit_ce_mercante_billing(text[])
--   enqueue_import_effect(uuid,text,text,uuid,bigint,bigint,jsonb)
--   ensure_agency_departure_report(bigint,text)
--   get_agency_report_actor_names(bigint,text)
--   get_agency_report_actor_names_by_report_id(uuid)
--   get_agency_report_closer_name(bigint,text)
--   get_billing_run_details(bigint)
--   get_bl_portal_status(text)
--   get_customer_pending_balances(bigint[])
--   get_customer_portal_account(bigint)
--   get_customer_receivables(bigint)
--   get_invoice_reissue_links(bigint)
--   get_user_display_names(uuid[])
--   guard_bl_customer_unlink()
--   guard_ce_mercante_unique()
--   guard_single_open_consolidated()
--   import_baplie_file_atomic(bigint,jsonb,text[],jsonb,jsonb)
--   import_bl_freight_file_atomic_core_405(jsonb,uuid,jsonb)
--   import_bl_freight_transactional_legacy_070(jsonb,uuid)
--   import_bl_freight_transactional_legacy_189(jsonb,uuid)
--   import_bl_freight_transactional_legacy_205(jsonb,uuid)
--   import_bl_freight_with_metadata_legacy_189(jsonb,uuid,jsonb)
--   import_breakbulk_manifest_transactional(text,bigint,uuid,integer,jsonb,jsonb,jsonb,text)
--   import_breakbulk_manifest_transactional_031(text,bigint,uuid,integer,jsonb,jsonb,jsonb)
--   import_breakbulk_manifest_transactional_legacy_189(text,bigint,uuid,integer,jsonb,jsonb,jsonb)
--   import_file_previous_upload(text,bigint,text)
--   import_manifest_transactional(text,bigint,uuid,text,text,integer,integer,jsonb,jsonb,jsonb,boolean)
--   import_vazios_bookings_transactional_core_405(bigint,text,uuid,jsonb)
--   import_vazios_bookings_transactional_legacy_189(bigint,text,uuid,jsonb)
--   import_vazios_importacao_transactional_core_405(bigint,text,uuid,jsonb,jsonb)
--   import_vazios_importacao_transactional_legacy_189(bigint,text,uuid,jsonb,jsonb)
--   import_vehicle_rows_transactional(jsonb)
--   import_vehicle_rows_transactional_legacy_189(jsonb)
--   issue_demurrage_invoice_for_bl(text,text)
--   link_pix_reconciliation_candidate(bigint,text,bigint,bigint)
--   list_bl_charge_adjustment_summaries(text[],bigint)
--   list_bl_charge_history(text)
--   list_bl_local_charge_lines(text)
--   list_consolidatable_receivables(bigint,bigint,text)
--   list_customer_reconciliation_queue(text,integer)
--   list_import_effects(text,text,integer)
--   list_local_pix_candidates(text[])
--   list_manual_charge_items_for_bl(text)
--   list_payment_registrar_names(bigint[])
--   list_pending_reissues()
--   list_pix_reconciliation_candidates(bigint)
--   list_pix_reconciliation_exceptions(text)
--   list_pix_txid_candidates(text[])
--   list_voyage_eligible_pods(bigint)
--   mark_bl_charges_reviewed(text,uuid)
--   mark_bl_ready_and_create_invoice(text,bigint,text,uuid)
--   mark_bls_ready_and_create_invoice(text[],bigint,text,uuid)
--   move_bls_to_manifesto_mercante(text[],text,text,jsonb)
--   obsolete_consolidated_invoice(bigint,text,uuid)
--   omit_voyage_escala(bigint,text,text,text,uuid,text,text,text,timestamp with time zone,timestamp with time zone)
--   portal_obsolete_consolidation(bigint)
--   preflight_depots_terminal_port_mapping()
--   prevent_pending_review_invoice()
--   preview_baplie_physical_flags(bigint,jsonb,text[])
--   preview_bl_charge_adjustment_impact(jsonb)
--   preview_ce_mercante_rows(jsonb,text,bigint)
--   quote_manual_invoice_charge(text,bigint)
--   recalculate_demurrage_invoices_manual(numeric)
--   reconcile_invoice_payment_by_txid(text,numeric,timestamp with time zone)
--   reconcile_invoice_payment_by_txid_legacy_130(text,numeric,timestamp with time zone)
--   register_demurrage_payment(uuid,bigint,date,text,numeric,numeric)
--   register_invoice_payment(bigint,numeric,text,timestamp with time zone,text,uuid)
--   register_ledger_invoice_payment(bigint,numeric,text,timestamp with time zone,text,text,text,uuid,uuid)
--   register_ledger_invoice_payment(bigint,numeric,text,timestamp with time zone,text,text,text,uuid)
--   register_ledger_invoice_payment_legacy_052(bigint,numeric,text,timestamp with time zone,text,text,text,uuid)
--   register_ledger_invoice_payment_legacy_066(bigint,numeric,text,timestamp with time zone,text,text,text,uuid)
--   remove_bl_ce_mercante(text,text,text)
--   reopen_agency_departure_report(bigint,text,text)
--   reopen_agency_departure_report_by_report_id(uuid,bigint,text,text)
--   reopen_demurrage_invoice(uuid,bigint,text)
--   reorder_vessel_schedules(jsonb)
--   replace_vazios_from_baplie_transactional(bigint,text,uuid,boolean)
--   resolve_baplie_divergence(bigint,text,text)
--   resolve_pix_reconciliation_exception(bigint,text,bigint,bigint,text)
--   resolve_stale_invoice(bigint,text)
--   retry_import_effect(bigint,text)
--   retry_invoice_basis_changes_legacy_134(text)
--   retry_pending_consolidated_reissue(bigint)
--   reverse_demurrage_payment(bigint,text,uuid)
--   reverse_invoice_payment_legacy_134(bigint,text,uuid)
--   revert_voyage_omission(bigint,text,uuid)
--   save_bl_demurrage_config(text,timestamp with time zone,integer,numeric,numeric,uuid)
--   save_bl_review(text,timestamp with time zone,jsonb,jsonb,uuid)
--   save_bl_review_legacy_070(text,timestamp with time zone,jsonb,jsonb,uuid)
--   save_granite_bl_review_legacy_148(uuid,bigint,uuid)
--   set_agency_report_department_signoff(bigint,text,text,boolean,text)
--   set_agency_report_department_signoff_by_report_id(uuid,bigint,text,text,boolean,text)
--   set_agency_report_section_observation(bigint,text,text,text)
--   set_agency_report_section_observation_by_report_id(uuid,bigint,text,text,text)
--   set_agency_report_signoff(bigint,text,text,text,text)
--   set_agency_report_signoff_by_report_id(uuid,bigint,text,text,text,text)
--   set_bl_cod(text,bigint,text,uuid)
--   set_bl_transshipment(text,bigint,text,uuid)
--   set_container_dates(bigint,date,date,text,boolean)
--   set_import_batch_ce_master(bigint,text,uuid)
--   set_voyage_route_ce_master(bigint,text,text,text,uuid,text)
--   sync_local_charge_receivable(text)
--   unlink_bls_from_manifesto_mercante(text[],text,jsonb)
--   update_customer_with_audit(bigint,jsonb,uuid,text)
--   update_manual_bl_charge(bigint,numeric,text,uuid)
--   update_voyage_omission(bigint,text,text,text,timestamp with time zone,timestamp with time zone,text,uuid)
--   upsert_pix_reconciliation_exceptions(text,jsonb)
--   vazios_export_adr_locked(bigint,text)

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
    RAISE EXCEPTION 'B/L % ja foi faturado (status financeiro=%); nao e permitido lancar taxa manual.',
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

CREATE OR REPLACE FUNCTION public._apply_baplie_physical_flags_before_reissue_126(p_voyage_id bigint, p_changes jsonb, p_changed_by uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_role text;
  v_filter text[] := NULL;
  v_item jsonb;
  v_num text;
  v_updated bigint[] := ARRAY[]::bigint[];
  v_cleared jsonb := '[]'::jsonb;
  v_applied_to jsonb := '[]'::jsonb;
  v_divergent jsonb := '[]'::jsonb;
  v_plan record;
  v_row public.bl_containers%ROWTYPE;
  v_profile_ok boolean;
  v_own_ok boolean;
  v_is_imo boolean;
  v_imo_class text;
  v_un_number text;
  v_is_oog boolean;
  v_profile_source text;
  v_ownership text;
  v_ownership_source text;
  v_bl_id text;
  v_action_id uuid := gen_random_uuid();
  v_recalculated integer := 0;
  v_calc_errors jsonb := '[]'::jsonb;
BEGIN
  IF v_actor IS NULL OR NOT public.is_active_user() OR p_changed_by IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'Usuário sem permissão ativa.' USING ERRCODE = '42501';
  END IF;
  IF p_voyage_id IS NULL THEN
    RAISE EXCEPTION 'Viagem obrigatoria.' USING ERRCODE = '22023';
  END IF;

  PERFORM 1 FROM public.voyages WHERE id = p_voyage_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Viagem % nao encontrada', p_voyage_id USING ERRCODE = 'P0002';
  END IF;

  IF p_changes IS NOT NULL THEN
    IF jsonb_typeof(p_changes) <> 'array' THEN
      RAISE EXCEPTION 'Filtro de flags invalido.' USING ERRCODE = '22023';
    END IF;
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_changes) LOOP
      v_num := CASE WHEN jsonb_typeof(v_item) = 'string' THEN upper(btrim(v_item #>> '{}'))
                    ELSE upper(btrim(COALESCE(v_item->>'container_number', ''))) END;
      IF NULLIF(v_num, '') IS NOT NULL THEN v_filter := array_append(v_filter, v_num); END IF;
    END LOOP;
  END IF;

  FOR v_plan IN
    SELECT * FROM public._baplie_flag_plan(p_voyage_id, NULL) AS p
    WHERE p.action IN ('apply', 'clear', 'divergent_manual', 'source_only')
      AND (v_filter IS NULL OR upper(btrim(p.container_number)) = ANY(v_filter))
    ORDER BY p.bl_container_id
  LOOP
    IF v_plan.action = 'divergent_manual' THEN
      v_divergent := v_divergent || jsonb_build_array(jsonb_build_object('container', v_plan.container_number, 'bl_id', v_plan.bl_id));
    END IF;

    SELECT * INTO v_row FROM public.bl_containers WHERE id = v_plan.bl_container_id FOR UPDATE;
    CONTINUE WHEN NOT FOUND;
    v_profile_ok := v_row.profile_source IS DISTINCT FROM 'manual';
    v_own_ok := v_row.ownership_source IS DISTINCT FROM 'manual'
      AND v_row.ownership IS NOT DISTINCT FROM v_plan.old_ownership;

    IF v_profile_ok THEN
      v_is_imo := v_plan.new_is_imo;
      v_imo_class := v_plan.new_imo_class;
      v_un_number := v_plan.new_un_number;
      v_is_oog := v_plan.new_is_oog;
      v_profile_source := v_plan.new_profile_source;
    ELSE
      v_is_imo := v_row.is_imo;
      v_imo_class := v_row.imo_class;
      v_un_number := v_row.un_number;
      v_is_oog := v_row.is_oog;
      v_profile_source := v_row.profile_source;
    END IF;
    IF v_own_ok THEN
      v_ownership := v_plan.new_ownership;
      v_ownership_source := v_plan.new_ownership_source;
    ELSE
      v_ownership := v_row.ownership;
      v_ownership_source := v_row.ownership_source;
    END IF;

    UPDATE public.bl_containers AS c
       SET is_imo = v_is_imo,
           imo_class = v_imo_class,
           un_number = v_un_number,
           is_oog = v_is_oog,
           ownership = v_ownership,
           ownership_source = v_ownership_source,
           profile_source = v_profile_source
     WHERE c.id = v_row.id
       AND (c.is_imo IS DISTINCT FROM v_is_imo OR c.imo_class IS DISTINCT FROM v_imo_class
            OR c.un_number IS DISTINCT FROM v_un_number OR c.is_oog IS DISTINCT FROM v_is_oog
            OR c.ownership IS DISTINCT FROM v_ownership OR c.ownership_source IS DISTINCT FROM v_ownership_source
            OR c.profile_source IS DISTINCT FROM v_profile_source);

    IF COALESCE(v_row.is_imo, false) IS DISTINCT FROM COALESCE(v_is_imo, false)
       OR COALESCE(v_row.is_oog, false) IS DISTINCT FROM COALESCE(v_is_oog, false)
       OR v_row.imo_class IS DISTINCT FROM v_imo_class
       OR v_row.un_number IS DISTINCT FROM v_un_number
       OR v_row.ownership IS DISTINCT FROM v_ownership THEN
      v_updated := array_append(v_updated, v_row.id);
      IF v_plan.action = 'clear' THEN
        v_cleared := v_cleared || jsonb_build_array(jsonb_build_object('container', v_plan.container_number, 'bl_id', v_plan.bl_id));
      ELSE
        v_applied_to := v_applied_to || jsonb_build_array(jsonb_build_object('container', v_plan.container_number, 'bl_id', v_plan.bl_id,
          'flags', public._baplie_flags_label(COALESCE(v_is_imo, false), COALESCE(v_is_oog, false), v_ownership)));
      END IF;
    END IF;
  END LOOP;

  IF cardinality(v_updated) = 0 THEN
    RETURN jsonb_build_object('voyage_id', p_voyage_id, 'updated_ids', ARRAY[]::bigint[], 'applied', 0,
      'applied_to', v_applied_to, 'cleared', v_cleared, 'divergent_manual', v_divergent,
      'recalculated', 0, 'calculation_errors', '[]'::jsonb);
  END IF;

  v_role := public.current_actor_role();
  INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by, justification, actor_role, actor_department)
  VALUES ('voyage', p_voyage_id::text, 'baplie_physical_flags',
    jsonb_build_object('voyage_id', p_voyage_id)::text,
    jsonb_build_object('voyage_id', p_voyage_id, 'updated_ids', v_updated, 'applied', cardinality(v_updated),
      'cleared', jsonb_array_length(v_cleared))::text,
    v_actor, 'Baplie: marcas físicas aplicadas a todos os B/Ls ativos do container (conjunto atômico)', v_role, v_role);

  FOR v_bl_id IN
    SELECT DISTINCT c.bl_id FROM public.bl_containers AS c JOIN public.bls AS b ON b.id = c.bl_id
    WHERE c.id = ANY (v_updated) AND COALESCE(b.financial_status, 'pending') NOT IN ('invoiced', 'partially_paid', 'paid')
    ORDER BY 1
  LOOP
    BEGIN
      PERFORM public.calculate_bl_local_charges(v_bl_id, v_actor, true);
      v_recalculated := v_recalculated + 1;
    EXCEPTION WHEN OTHERS THEN
      v_calc_errors := v_calc_errors || jsonb_build_array(jsonb_build_object('bl_id', v_bl_id, 'message', SQLERRM));
      INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification)
      VALUES ('bl', v_bl_id, 'local_charges_auto_calc_error', NULL, SQLERRM, v_actor, now(),
        'Falha no recalculo de taxas locais apos aplicar flags fisicas do Baplie');
      PERFORM public.enqueue_import_effect(v_action_id, 'provisional_charges', v_bl_id, v_actor, 1, NULL,
        jsonb_build_object('voyage_id', p_voyage_id, 'source', 'baplie_physical_flags'));
    END;
  END LOOP;

  RETURN jsonb_build_object('voyage_id', p_voyage_id, 'updated_ids', v_updated, 'applied', cardinality(v_updated),
    'applied_to', v_applied_to, 'cleared', v_cleared, 'divergent_manual', v_divergent,
    'recalculated', v_recalculated, 'calculation_errors', v_calc_errors);
END;
$function$;

CREATE OR REPLACE FUNCTION public._assert_import_caller()
 RETURNS void
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- Sem JWT na transação não há requisição do PostgREST: é o próprio banco.
  IF NULLIF(current_setting('request.jwt.claims', true), '') IS NULL
     AND NULLIF(current_setting('request.jwt.claim.sub', true), '') IS NULL THEN
    RETURN;
  END IF;
  IF auth.role() = 'service_role' THEN
    RETURN;
  END IF;
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuário sem permissão ativa.' USING ERRCODE = '42501';
  END IF;
END $function$;

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
    RAISE EXCEPTION 'Usuário sem permissão ativa para o faturamento automático.' USING ERRCODE = '42501';
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

  -- ADR 0093, decisão 12 (362): fatura cancelada pela pessoa solta o B/L; a
  -- nova sai só pelo Emitir, nunca sozinha (Liberação, ativação do Portal, CE,
  -- planilha de CE, vínculo de Cliente, reprocessamento de efeito). A
  -- reemissão automática da correção (cancelada com `reissue_requested_at`)
  -- continua.
  IF EXISTS (
    SELECT 1 FROM (
      SELECT inv.status, inv.reissue_requested_at
      FROM public.invoices AS inv
      WHERE (inv.invoice_type = 'individual'
             AND EXISTS (SELECT 1 FROM public.invoice_bls AS ib WHERE ib.invoice_id = inv.id AND ib.bl_id = v_bl.id))
         OR (inv.invoice_type = 'consolidated'
             AND EXISTS (SELECT 1 FROM public.invoice_receivable_links AS l WHERE l.invoice_id = inv.id AND l.bl_id = v_bl.id)
             AND NOT EXISTS (SELECT 1 FROM public.invoice_bls AS ib2 WHERE ib2.bl_id = v_bl.id))
      ORDER BY inv.id DESC LIMIT 1) AS last_invoice
    WHERE last_invoice.status = 'cancelled' AND last_invoice.reissue_requested_at IS NULL
  ) THEN
    RETURN jsonb_build_object(
      'status', 'skipped',
      'reason', 'invoice_cancelled_awaiting_emitir',
      'bl_id', v_bl.id
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
    -- 385: a falha de cálculo sai marcada; o gatilho do CE a recusa (B3).
    BEGIN
      v_calculation := public.calculate_bl_local_charges(v_bl.id, v_actor, true);
    EXCEPTION WHEN OTHERS THEN
      PERFORM public._raise_local_charge_failure(v_bl.id, SQLSTATE, SQLERRM);
    END;
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

CREATE OR REPLACE FUNCTION public._create_manual_invoice_core_272(p_customer_id bigint, p_item_name text, p_quantity numeric, p_unit_value_brl numeric, p_description text DEFAULT NULL::text, p_bl_id text DEFAULT NULL::text, p_voyage_id bigint DEFAULT NULL::bigint, p_actor uuid DEFAULT NULL::uuid, p_charge_item_id bigint DEFAULT NULL::bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_quote jsonb; v_result jsonb; v_invoice bigint; v_pricing_version bigint; v_total numeric(14,2);
BEGIN
  -- O autor é quem está logado (ADR 0085, regra base 2; migration 241).
  PERFORM public._assert_actor_is_caller(p_actor);
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuário sem permissão de faturamento.' USING ERRCODE = '42501';
  END IF;
  IF p_charge_item_id IS NULL THEN
    RETURN public._create_manual_invoice_custom_122(p_customer_id, p_item_name, p_quantity, p_unit_value_brl,
      p_description, p_bl_id, p_voyage_id, p_actor);
  END IF;
  IF nullif(btrim(p_bl_id), '') IS NULL THEN
    RAISE EXCEPTION 'B/L obrigatorio para item da tabela.' USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM public.bls WHERE id = upper(btrim(p_bl_id)) AND customer_id = p_customer_id FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L nao pertence ao cliente selecionado.' USING ERRCODE = '42501';
  END IF;
  v_quote := public.quote_manual_invoice_charge(p_bl_id, p_charge_item_id);
  v_total := (v_quote->>'total_brl')::numeric;
  v_result := public._create_manual_invoice_custom_122(p_customer_id, v_quote->>'charge_item_name',
    (v_quote->>'quantity')::numeric, (v_quote->>'unit_value_brl')::numeric,
    p_description, upper(btrim(p_bl_id)), p_voyage_id, p_actor);
  v_invoice := (v_result->>'invoice_id')::bigint;
  INSERT INTO public.pricing_rule_versions(version_key, charge_table_id, charge_item_id, customer_id, customer_rate_override_id, metadata)
    VALUES ('manual_invoice:' || v_invoice, (v_quote->>'charge_table_id')::bigint, p_charge_item_id,
      p_customer_id, (v_quote->>'override_id')::bigint, v_quote) RETURNING id INTO v_pricing_version;
  UPDATE public.invoice_items SET charge_item_id = p_charge_item_id, pricing_rule_version_id = v_pricing_version,
    charge_table_id = (v_quote->>'charge_table_id')::bigint,
    snapshot_payload = v_quote, currency = v_quote->>'currency',
    unit_value_usd = (v_quote->>'effective_unit_value_usd')::numeric,
    -- 383 (ADR 0094, B13): a linha em dólar mostra o unitário só em US$; o
    -- total em R$ é o total em US$ convertido de uma vez, como na taxa local.
    unit_value_brl = CASE WHEN v_quote->>'currency' = 'USD' THEN NULL ELSE unit_value_brl END,
    total_value_usd = (v_quote->>'total_usd')::numeric,
    total_value_brl = v_total
    WHERE invoice_id = v_invoice;
  -- O trigger do Pix só preenche payload vazio; montar com o total final.
  UPDATE public.invoices SET total_brl = v_total, balance_brl = v_total,
    pix_payload = public.build_transshipping_pix_payload(v_total, invoice_number)
    WHERE id = v_invoice;
  UPDATE public.invoice_lifecycle_events SET payload = payload || jsonb_build_object('total_brl', v_total, 'charge_item_id', p_charge_item_id)
    WHERE invoice_id = v_invoice AND event_type = 'issued';
  RETURN v_result || jsonb_build_object('total_brl', v_total, 'balance_brl', v_total);
END;
$function$;

CREATE OR REPLACE FUNCTION public._create_manual_invoice_custom_122(p_customer_id bigint, p_item_name text, p_quantity numeric, p_unit_value_brl numeric, p_description text DEFAULT NULL::text, p_bl_id text DEFAULT NULL::text, p_voyage_id bigint DEFAULT NULL::bigint, p_actor uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := COALESCE(p_actor, auth.uid());
  v_item_name text := NULLIF(btrim(COALESCE(p_item_name, '')), '');
  v_description text := NULLIF(btrim(COALESCE(p_description, '')), '');
  v_bl_id text := NULLIF(btrim(COALESCE(p_bl_id, '')), '');
  v_bl_customer_id bigint;
  v_bl_voyage_id bigint;
  v_voyage_id bigint := p_voyage_id;
  v_quantity numeric(10,3);
  v_unit_value_brl numeric(12,2);
  v_total_brl numeric(14,2);
  v_invoice_id bigint;
  v_invoice_number text;
BEGIN
  IF auth.uid() IS NULL
     OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuário sem permissão de faturamento.'
      USING ERRCODE = '42501';
  END IF;

  IF p_actor IS NOT NULL AND p_actor IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'O ator da emissão deve ser o usuário autenticado.'
      USING ERRCODE = '42501';
  END IF;

  IF v_item_name IS NULL THEN
    RAISE EXCEPTION 'Nome do item é obrigatório.' USING ERRCODE = '22023';
  END IF;

  IF p_quantity IS NULL
     OR p_quantity <= 0
     OR p_quantity::text IN ('NaN', 'Infinity', '-Infinity') THEN
    RAISE EXCEPTION 'Quantidade deve ser maior que zero.' USING ERRCODE = '22023';
  END IF;

  IF p_unit_value_brl IS NULL
     OR p_unit_value_brl <= 0
     OR p_unit_value_brl::text IN ('NaN', 'Infinity', '-Infinity') THEN
    RAISE EXCEPTION 'Valor unitário deve ser maior que zero.' USING ERRCODE = '22023';
  END IF;

  SELECT 1
  INTO STRICT v_bl_customer_id
  FROM public.customers
  WHERE id = p_customer_id;

  v_quantity := round(p_quantity, 3);
  v_unit_value_brl := round(p_unit_value_brl, 2);
  v_total_brl := round(v_quantity * v_unit_value_brl, 2);

  IF v_quantity <= 0 OR v_unit_value_brl <= 0 OR v_total_brl <= 0 THEN
    RAISE EXCEPTION 'Quantidade e valor unitário devem gerar um total positivo.'
      USING ERRCODE = '22023';
  END IF;

  IF v_bl_id IS NOT NULL THEN
    SELECT b.customer_id, b.voyage_id
    INTO v_bl_customer_id, v_bl_voyage_id
    FROM public.bls AS b
    WHERE b.id = v_bl_id
    FOR SHARE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'B/L % não encontrado.', v_bl_id USING ERRCODE = 'P0002';
    END IF;

    IF v_bl_customer_id IS DISTINCT FROM p_customer_id THEN
      RAISE EXCEPTION 'B/L % não pertence ao cliente selecionado.', v_bl_id
        USING ERRCODE = '42501';
    END IF;

    IF p_voyage_id IS NOT NULL AND p_voyage_id IS DISTINCT FROM v_bl_voyage_id THEN
      RAISE EXCEPTION 'A viagem informada não pertence ao B/L %.', v_bl_id
        USING ERRCODE = '22023';
    END IF;

    v_voyage_id := v_bl_voyage_id;
  END IF;

  IF v_voyage_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.voyages WHERE id = v_voyage_id) THEN
    RAISE EXCEPTION 'Viagem % não encontrada.', v_voyage_id USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.invoices (
    customer_id,
    bl_id,
    voyage_id,
    issued_at,
    total_brl,
    status,
    notes,
    total_paid_brl,
    balance_brl,
    issued_by,
    invoice_type
  )
  VALUES (
    p_customer_id,
    v_bl_id,
    v_voyage_id,
    now(),
    v_total_brl,
    'issued',
    v_description,
    0,
    v_total_brl,
    v_actor,
    'manual'
  )
  RETURNING id, invoice_number
  INTO v_invoice_id, v_invoice_number;

  INSERT INTO public.invoice_items (
    invoice_id,
    description,
    quantity,
    unit_value_brl,
    total_value_brl,
    bl_id,
    source,
    currency
  )
  VALUES (
    v_invoice_id,
    v_item_name,
    v_quantity,
    v_unit_value_brl,
    v_total_brl,
    v_bl_id,
    'manual',
    'BRL'
  );

  INSERT INTO public.invoice_lifecycle_events (invoice_id, event_type, actor, payload)
  VALUES (
    v_invoice_id,
    'issued',
    v_actor,
    jsonb_build_object(
      'invoice_type', 'manual',
      'source', 'manual_invoice',
      'bl_id', v_bl_id,
      'voyage_id', v_voyage_id,
      'total_brl', v_total_brl
    )
  );

  INSERT INTO public.audit_logs (
    entity_type,
    entity_id,
    field_name,
    old_value,
    new_value,
    changed_by,
    justification
  )
  VALUES (
    'invoice',
    v_invoice_id::text,
    'manual_issue',
    NULL,
    jsonb_build_object('invoice_number', v_invoice_number, 'total_brl', v_total_brl)::text,
    v_actor,
    'Emissão de fatura avulsa'
  );

  RETURN jsonb_build_object(
    'invoice_id', v_invoice_id,
    'invoice_number', v_invoice_number,
    'invoice_type', 'manual',
    'status', 'issued',
    'total_brl', v_total_brl,
    'balance_brl', v_total_brl,
    'bl_id', v_bl_id,
    'voyage_id', v_voyage_id
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public._import_bl_freight_before_invoice_alert_123(p_bls jsonb, p_changed_by uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bl_id text;
  v_result jsonb;
BEGIN
  -- A entrada precisa negar uma sessão Portal antes de inspecionar o payload;
  -- além de preservar a fronteira do núcleo legado, isso evita vazar erros de
  -- estrutura para chamadores sem autorização.
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR p_changed_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Usuário sem permissão para importar o frete do B/L.' USING ERRCODE = '42501';
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
$function$;

CREATE OR REPLACE FUNCTION public._list_invoice_details_legacy_134(p_invoice_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_invoice_type text;
  v_invoice jsonb;
  v_bls jsonb;
  v_items jsonb;
  v_containers jsonb;
  v_payments jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_active_read_user() THEN
    RAISE EXCEPTION 'Usuário sem permissão de faturamento.' USING ERRCODE = '42501';
  END IF;

  SELECT invoice_type INTO v_invoice_type
  FROM public.invoices
  WHERE id = p_invoice_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice % nao encontrada.', p_invoice_id USING ERRCODE = 'P0002';
  END IF;

  IF v_invoice_type IS DISTINCT FROM 'manual' THEN
    RETURN public._list_invoice_details_legacy_20260926(p_invoice_id);
  END IF;

  SELECT to_jsonb(i.*) || jsonb_build_object(
    'customer_name', c.name,
    'customer_cnpj_cpf', c.cnpj_cpf,
    'voyage_number', v.voyage_number,
    'vessel_name', vs.name
  )
  INTO v_invoice
  FROM public.invoices AS i
  LEFT JOIN public.customers AS c ON c.id = i.customer_id
  LEFT JOIN public.bls AS b ON b.id = i.bl_id
  LEFT JOIN public.voyages AS v ON v.id = COALESCE(i.voyage_id, b.voyage_id)
  LEFT JOIN public.vessels AS vs ON vs.id = v.vessel_id
  WHERE i.id = p_invoice_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', NULL::bigint,
    'invoice_id', p_invoice_id,
    'bl_id', b.id,
    'charge_status_snapshot', b.charge_status,
    'financial_status_snapshot', b.financial_status,
    'subtotal_brl', COALESCE((SELECT SUM(ii.total_value_brl) FROM public.invoice_items AS ii WHERE ii.invoice_id = p_invoice_id AND ii.bl_id = b.id), 0),
    'subtotal_usd', 0,
    'created_at', NULL,
    'charge_status', b.charge_status,
    'financial_status', b.financial_status,
    'pol', b.pol,
    'pod', b.pod,
    'voyage_number', v.voyage_number,
    'vessel_name', vs.name
  )), '[]'::jsonb)
  INTO v_bls
  FROM public.invoices AS i
  JOIN public.bls AS b ON b.id = i.bl_id
  LEFT JOIN public.voyages AS v ON v.id = COALESCE(i.voyage_id, b.voyage_id)
  LEFT JOIN public.vessels AS vs ON vs.id = v.vessel_id
  WHERE i.id = p_invoice_id;

  SELECT COALESCE(jsonb_agg(to_jsonb(ii.*) ORDER BY ii.id), '[]'::jsonb)
  INTO v_items
  FROM public.invoice_items AS ii
  WHERE ii.invoice_id = p_invoice_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', c.id,
    'bl_id', c.bl_id,
    'container_number', c.container_number,
    'type', c.type,
    'seal_number', c.seal_number,
    'gross_weight_kg', c.gross_weight_kg
  ) ORDER BY c.container_number), '[]'::jsonb)
  INTO v_containers
  FROM public.bl_containers AS c
  JOIN public.invoices AS i ON i.bl_id = c.bl_id
  WHERE i.id = p_invoice_id;

  SELECT COALESCE(jsonb_agg(to_jsonb(p.*) ORDER BY p.paid_at DESC, p.id DESC), '[]'::jsonb)
  INTO v_payments
  FROM public.payments AS p
  WHERE p.invoice_id = p_invoice_id;

  RETURN jsonb_build_object(
    'invoice', v_invoice,
    'bls', v_bls,
    'items', v_items,
    'containers', v_containers,
    'payments', v_payments
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public._list_invoice_details_legacy_20260926(p_invoice_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_invoice JSONB;
  v_bls JSONB;
  v_items JSONB;
  v_payments JSONB;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_active_read_user() THEN
    RAISE EXCEPTION 'Usuário sem permissão de faturamento.' USING ERRCODE = '42501';
  END IF;

  SELECT TO_JSONB(i.*) || jsonb_build_object(
    'customer_name', c.name,
    'customer_cnpj_cpf', c.cnpj_cpf
  )
  INTO v_invoice
  FROM public.invoices AS i
  LEFT JOIN public.customers AS c ON c.id = i.customer_id
  WHERE i.id = p_invoice_id;

  IF v_invoice IS NULL THEN
    RAISE EXCEPTION 'Invoice % nao encontrada.', p_invoice_id USING ERRCODE = 'P0002';
  END IF;

  SELECT COALESCE(JSONB_AGG(
    TO_JSONB(ib.*) || jsonb_build_object(
      'charge_status', b.charge_status,
      'financial_status', b.financial_status,
      'pol', b.pol,
      'pod', b.pod,
      'voyage_number', v.voyage_number,
      'vessel_name', vs.name
    )
    ORDER BY ib.id
  ), '[]'::JSONB)
  INTO v_bls
  FROM public.invoice_bls AS ib
  JOIN public.bls AS b ON b.id = ib.bl_id
  LEFT JOIN public.voyages AS v ON v.id = b.voyage_id
  LEFT JOIN public.vessels AS vs ON vs.id = v.vessel_id
  WHERE ib.invoice_id = p_invoice_id;

  SELECT COALESCE(JSONB_AGG(TO_JSONB(ii.*) ORDER BY ii.id), '[]'::JSONB)
  INTO v_items
  FROM public.invoice_items AS ii
  WHERE ii.invoice_id = p_invoice_id;

  SELECT COALESCE(JSONB_AGG(TO_JSONB(p.*) ORDER BY p.paid_at DESC, p.id DESC), '[]'::JSONB)
  INTO v_payments
  FROM public.payments AS p
  WHERE p.invoice_id = p_invoice_id;

  RETURN jsonb_build_object(
    'invoice', v_invoice,
    'bls', v_bls,
    'items', v_items,
    'payments', v_payments
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public._reject_customer_reconciliation_impl_106(p_queue_id bigint, p_notes text DEFAULT NULL::text, p_actor uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_queue RECORD;
  v_actor UUID;
  v_reason TEXT;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuário sem permissão ativa' USING ERRCODE = '42501';
  END IF;

  v_actor := COALESCE(p_actor, auth.uid());
  v_reason := COALESCE(NULLIF(TRIM(COALESCE(p_notes, '')), ''), 'Reconciliacao rejeitada; revisar cliente/manualmente.');

  SELECT *
  INTO v_queue
  FROM public.customer_reconciliation_queue
  WHERE id = p_queue_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item de reconciliacao % nao encontrado.', p_queue_id USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.bls
  SET
    customer_reconciliation_status = 'rejected',
    customer_reconciliation_notes = v_reason,
    billing_hold_reason = v_reason,
    charge_status = CASE
      WHEN financial_status = 'pending' THEN 'not_calculated'
      ELSE charge_status
    END
  WHERE id = v_queue.bl_id;

  UPDATE public.customer_reconciliation_queue
  SET
    status = 'rejected',
    resolution_notes = v_reason,
    rejected_by = v_actor,
    rejected_at = now(),
    approved_by = NULL,
    approved_at = NULL
  WHERE id = p_queue_id;

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
    'bl',
    v_queue.bl_id,
    'customer_reconciliation_status',
    COALESCE(v_queue.status, 'pending'),
    'rejected',
    v_actor,
    now(),
    v_reason
  );

  RETURN jsonb_build_object(
    'queue_id', p_queue_id,
    'bl_id', v_queue.bl_id,
    'status', 'rejected'
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public._reverse_invoice_payment_impl_109(p_payment_id bigint, p_reason text DEFAULT NULL::text, p_actor uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_payment RECORD;
  v_invoice RECORD;
  v_settlement RECORD;
  v_unsettled_invoice_ids BIGINT[];
  v_total_paid NUMERIC(14,2);
  v_balance NUMERIC(14,2);
  v_actor UUID;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Usuário sem permissão.' USING ERRCODE = '42501';
  END IF;

  -- Justificativa obrigatoria para cancelar a baixa.
  IF NULLIF(TRIM(COALESCE(p_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Informe a justificativa para cancelar a baixa.' USING ERRCODE = '22023';
  END IF;

  v_actor := COALESCE(p_actor, auth.uid());

  SELECT * INTO v_payment
  FROM public.payments
  WHERE id = p_payment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pagamento % nao encontrado.', p_payment_id USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_invoice
  FROM public.invoices
  WHERE id = v_payment.invoice_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice % nao encontrada.', v_payment.invoice_id USING ERRCODE = 'P0002';
  END IF;

  -- Reverte cada settlement, restaurando o receivable
  FOR v_settlement IN
    SELECT * FROM public.ledger_settlements
    WHERE payment_id = p_payment_id
    ORDER BY id
  LOOP
    UPDATE public.bl_receivables
    SET
      settled_amount_brl = GREATEST(COALESCE(settled_amount_brl, 0) - v_settlement.amount_brl, 0),
      balance_brl = COALESCE(balance_brl, 0) + v_settlement.amount_brl,
      status = CASE
        WHEN GREATEST(COALESCE(balance_brl, 0) + v_settlement.amount_brl, 0) >= original_amount_brl THEN 'open'
        ELSE 'partially_settled'
      END,
      updated_at = now()
    WHERE id = v_settlement.receivable_id;
  END LOOP;

  DELETE FROM public.ledger_settlements WHERE payment_id = p_payment_id;

  -- Restaura invoice_receivable_links que foram afetados por este pagamento
  UPDATE public.invoice_receivable_links irl
  SET status = 'active'
  WHERE irl.invoice_id = v_payment.invoice_id
    AND irl.status = 'settled_by_this_invoice'
    AND COALESCE(v_invoice.status, '') <> 'obsolete'
    AND EXISTS (
      SELECT 1 FROM public.bl_receivables br
      WHERE br.id = irl.receivable_id
        AND br.balance_brl > 0
    );

  -- Recalcula totais da invoice
  SELECT COALESCE(SUM(COALESCE(balance_brl, 0)), 0)
  INTO v_balance
  FROM public.bl_receivables
  WHERE id IN (
    SELECT receivable_id FROM public.invoice_receivable_links
    WHERE invoice_id = v_payment.invoice_id
  );

  SELECT COALESCE(SUM(amount_brl), 0)
  INTO v_total_paid
  FROM public.payments
  WHERE invoice_id = v_payment.invoice_id
    AND id <> p_payment_id;

  UPDATE public.invoices
  SET
    total_paid_brl = v_total_paid,
    balance_brl = CASE WHEN COALESCE(v_invoice.status, '') = 'obsolete' THEN 0 ELSE GREATEST(v_balance, 0) END,
    -- Libera o TXID conciliado para que o mesmo PIX possa ser reconciliado de novo.
    pix_txid = NULL,
    conciliated_by_extract = false,
    status = CASE
      WHEN COALESCE(v_invoice.status, '') = 'covered' THEN 'covered'
      WHEN COALESCE(v_invoice.status, '') = 'obsolete' THEN 'obsolete'
      WHEN v_total_paid <= 0 AND GREATEST(v_balance, 0) >= (SELECT COALESCE(SUM(original_amount_brl), 0) FROM public.bl_receivables WHERE id IN (SELECT receivable_id FROM public.invoice_receivable_links WHERE invoice_id = v_payment.invoice_id)) THEN 'issued'
      WHEN v_total_paid <= 0 THEN 'issued'
      WHEN GREATEST(v_balance, 0) <= 0 THEN 'paid'
      ELSE 'partially_paid'
    END
  WHERE id = v_payment.invoice_id;

  -- F-04 (migration 356): desfaz só o que este documento causou.
  IF COALESCE(v_invoice.status, '') IN ('paid', 'partially_paid') THEN
    -- Individuais cobertas por esta fatura: só os vínculos delas.
    UPDATE public.invoice_receivable_links irl
    SET status = 'active'
    WHERE irl.status = 'settled_elsewhere'
      AND irl.invoice_id IN (SELECT ind.id FROM public.invoices ind
                             WHERE ind.covered_by_invoice_id = v_payment.invoice_id AND ind.status = 'covered')
      AND EXISTS (SELECT 1 FROM public.bl_receivables br WHERE br.id = irl.receivable_id AND br.balance_brl > 0);
    UPDATE public.invoices ind
    SET status = 'issued', covered_by_invoice_id = NULL
    WHERE ind.covered_by_invoice_id = v_payment.invoice_id
      AND ind.status = 'covered'
      AND EXISTS (SELECT 1 FROM public.invoice_receivable_links l WHERE l.invoice_id = ind.id AND l.status = 'active');

    -- Consolidada obsoletada por este pagamento, sem sucessora e sem B/L em
    -- outra consolidada aberta.
    FOR v_settlement IN
      SELECT DISTINCT c.id
      FROM public.invoice_lifecycle_events e
      JOIN public.invoices c ON c.id = e.invoice_id
      WHERE e.event_type = 'obsolete'
        AND e.payload->>'paid_invoice_id' = v_payment.invoice_id::text
        AND c.status = 'obsolete'
        AND NOT EXISTS (SELECT 1 FROM public.invoices s WHERE s.replaces_invoice_id = c.id)
    LOOP
      IF NOT EXISTS (
        SELECT 1 FROM public.invoice_receivable_links l
        JOIN public.invoice_receivable_links l2 ON l2.receivable_id = l.receivable_id AND l2.status = 'active'
        JOIN public.invoices o ON o.id = l2.invoice_id
        WHERE l.invoice_id = v_settlement.id AND o.id <> v_settlement.id
          AND o.invoice_type = 'consolidated' AND coalesce(o.status, 'issued') IN ('draft', 'issued', 'partially_paid')
      ) THEN
        UPDATE public.invoices SET status = 'issued', obsolete_reason = NULL WHERE id = v_settlement.id;
        UPDATE public.invoice_receivable_links SET status = 'active'
         WHERE invoice_id = v_settlement.id AND status = 'obsolete';
      END IF;
    END LOOP;
  END IF;

  -- 385: documentos vivos dos mesmos recebíveis mostram o saldo que voltou.
  UPDATE public.invoices i SET balance_brl = s.balance
  FROM (
    SELECT l.invoice_id, COALESCE(SUM(r.balance_brl), 0) AS balance
    FROM public.invoice_receivable_links l JOIN public.bl_receivables r ON r.id = l.receivable_id
    WHERE l.status = 'active'
      AND l.invoice_id IN (
        SELECT l2.invoice_id FROM public.invoice_receivable_links l2
        WHERE l2.receivable_id IN (SELECT receivable_id FROM public.invoice_receivable_links WHERE invoice_id = v_payment.invoice_id)
          AND l2.invoice_id <> v_payment.invoice_id)
    GROUP BY l.invoice_id
  ) s
  WHERE i.id = s.invoice_id
    AND i.invoice_type IN ('individual', 'consolidated')
    AND COALESCE(i.status, 'issued') IN ('issued', 'partially_paid', 'overdue')
    AND i.balance_brl IS DISTINCT FROM s.balance;

  -- Atualiza financial_status dos BLs vinculados.
  -- bls.financial_status so aceita 'pending','invoiced','paid','cancelled'
  -- (constraint bls_financial_status_check). Ao cancelar a baixa, o BL volta a
  -- 'invoiced' quando ainda ha saldo, ou 'paid' se tudo continua liquidado.
  UPDATE public.bls b
  SET financial_status = (
    SELECT CASE
      WHEN COUNT(*) FILTER (WHERE br.balance_brl > 0) = 0 THEN 'paid'
      ELSE 'invoiced'
    END
    FROM public.bl_receivables br
    WHERE br.bl_id = b.id
  )
  WHERE b.id IN (
    SELECT br.bl_id FROM public.bl_receivables br
    WHERE br.id IN (
      SELECT receivable_id FROM public.invoice_receivable_links
      WHERE invoice_id = v_payment.invoice_id
    )
  );

  INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification)
  VALUES (
    'invoice', v_payment.invoice_id::TEXT, 'payment_reversed',
    COALESCE(v_invoice.status, '?') || ' total_paid=' || COALESCE(v_invoice.total_paid_brl::TEXT, '?'),
    (SELECT COALESCE(status, '?') || ' total_paid=' || COALESCE(total_paid_brl::TEXT, '?') FROM public.invoices WHERE id = v_payment.invoice_id),
    v_actor, now(),
    TRIM(p_reason)
  );

  DELETE FROM public.payments WHERE id = p_payment_id;

  -- Saldos das demais faturas ligadas voltam com o recebível (decisão 6).
  PERFORM public._reproject_invoices_for_receivables(v_payment.invoice_id,
    ARRAY(SELECT receivable_id FROM public.invoice_receivable_links WHERE invoice_id = v_payment.invoice_id), v_actor);

  RETURN jsonb_build_object(
    'payment_id', p_payment_id,
    'invoice_id', v_payment.invoice_id,
    'new_status', (SELECT status FROM public.invoices WHERE id = v_payment.invoice_id)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public._run_billing_for_import_batch_impl_106(p_batch_id bigint, p_actor uuid DEFAULT NULL::uuid, p_recalculate boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_batch RECORD;
  v_run_id BIGINT;
  v_actor UUID;
  v_bl RECORD;
  v_result JSONB;
  v_hold_reason TEXT;
  v_total_bls INTEGER := 0;
  v_eligible_bls INTEGER := 0;
  v_blocked_bls INTEGER := 0;
  v_calculated_bls INTEGER := 0;
  v_total_brl NUMERIC(14,2) := 0;
  v_total_usd NUMERIC(14,2) := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuário sem permissão ativa' USING ERRCODE = '42501';
  END IF;

  v_actor := COALESCE(p_actor, auth.uid());

  SELECT *
  INTO v_batch
  FROM public.import_batches
  WHERE id = p_batch_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Manifesto/lote % nao encontrado.', p_batch_id USING ERRCODE = 'P0002';
  END IF;

  IF COALESCE(v_batch.status, 'processing') NOT IN ('completed', 'partial') THEN
    RAISE EXCEPTION 'Manifesto % ainda nao esta pronto para faturamento automatico.', p_batch_id USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.billing_runs (
    manifest_id,
    trigger_source,
    status,
    requested_by,
    input_hash,
    total_bls,
    summary
  )
  VALUES (
    p_batch_id,
    CASE WHEN COALESCE(p_recalculate, true) THEN 'manifest_import' ELSE 'manual_reprocess' END,
    'running',
    v_actor,
    v_batch.file_hash,
    COALESCE(v_batch.total_bls, 0),
    jsonb_build_object('filename', v_batch.filename, 'cargo_mode', v_batch.cargo_mode)
  )
  RETURNING id INTO v_run_id;

  FOR v_bl IN
    SELECT
      b.id,
      b.customer_id,
      b.customer_reconciliation_status,
      b.manifest_customer_cnpj_cpf,
      b.manifest_customer_name,
      b.manifest_customer_email
    FROM public.bls AS b
    WHERE b.batch_id = p_batch_id
    ORDER BY b.id
  LOOP
    v_total_bls := v_total_bls + 1;

    UPDATE public.bls
    SET last_billing_run_id = v_run_id
    WHERE id = v_bl.id;

    PERFORM public.sync_customer_reconciliation_queue_for_bl(v_bl.id);

    IF v_bl.customer_id IS NULL OR COALESCE(v_bl.customer_reconciliation_status, 'missing_customer') NOT IN ('matched_document', 'reconciled') THEN
      v_blocked_bls := v_blocked_bls + 1;
      v_hold_reason := CASE COALESCE(v_bl.customer_reconciliation_status, 'missing_customer')
        WHEN 'matched_name' THEN 'Cliente vinculado apenas por nome; requer reconciliacao manual.'
        WHEN 'rejected' THEN 'Reconciliacao de cliente rejeitada; revisar cadastro.'
        ELSE 'Cliente inexistente ou nao reconciliado.'
      END;

      UPDATE public.bls
      SET
        billing_hold_reason = v_hold_reason,
        charge_status = CASE
          WHEN financial_status = 'pending' THEN 'not_calculated'
          ELSE charge_status
        END
      WHERE id = v_bl.id;

      PERFORM public.insert_billing_run_log(
        v_run_id,
        p_batch_id,
        v_bl.id,
        'warning',
        'customer_reconciliation_blocked',
        v_hold_reason,
        jsonb_build_object(
          'customer_id', v_bl.customer_id,
          'customer_reconciliation_status', v_bl.customer_reconciliation_status,
          'manifest_customer_cnpj_cpf', v_bl.manifest_customer_cnpj_cpf,
          'manifest_customer_name', v_bl.manifest_customer_name,
          'manifest_customer_email', v_bl.manifest_customer_email
        )
      );

      CONTINUE;
    END IF;

    v_eligible_bls := v_eligible_bls + 1;
    v_result := public.calculate_bl_local_charges(v_bl.id, v_actor, COALESCE(p_recalculate, true));

    UPDATE public.charge_calculations
    SET
      billing_run_id = v_run_id,
      manifest_id = COALESCE(manifest_id, p_batch_id)
    WHERE bl_id = v_bl.id
      AND COALESCE(source, 'auto') = 'auto';

    v_hold_reason := CASE
      WHEN EXISTS (
        SELECT 1
        FROM public.charge_calculations
        WHERE bl_id = v_bl.id
          AND COALESCE(total_value_usd, 0) > 0
      ) THEN 'Linhas em USD exigem ajuste manual antes do faturamento.'
      WHEN COALESCE(v_result->>'status', '') = 'review_required' THEN 'Pendencia de revisao nas taxas locais.'
      ELSE NULL
    END;

    UPDATE public.bls
    SET billing_hold_reason = v_hold_reason
    WHERE id = v_bl.id;

    v_calculated_bls := v_calculated_bls + 1;

    PERFORM public.insert_billing_run_log(
      v_run_id,
      p_batch_id,
      v_bl.id,
      CASE WHEN v_hold_reason IS NULL THEN 'info' ELSE 'warning' END,
      'charges_calculated',
      COALESCE(v_result->>'reason', 'Calculo executado com sucesso.'),
      jsonb_build_object(
        'status', v_result->>'status',
        'line_count', COALESCE((v_result->>'line_count')::INT, 0),
        'total_brl', COALESCE((v_result->>'total_brl')::NUMERIC, 0),
        'total_usd', COALESCE((v_result->>'total_usd')::NUMERIC, 0),
        'billing_hold_reason', v_hold_reason
      )
    );
  END LOOP;

  SELECT
    COALESCE(SUM(total_value_brl), 0),
    COALESCE(SUM(total_value_usd), 0)
  INTO
    v_total_brl,
    v_total_usd
  FROM public.charge_calculations
  WHERE billing_run_id = v_run_id;

  UPDATE public.billing_runs
  SET
    completed_at = now(),
    status = CASE
      WHEN v_blocked_bls > 0 THEN 'completed_with_blocks'
      ELSE 'completed'
    END,
    total_bls = v_total_bls,
    eligible_bls = v_eligible_bls,
    blocked_bls = v_blocked_bls,
    calculated_bls = v_calculated_bls,
    total_brl = v_total_brl,
    total_usd = v_total_usd,
    summary = jsonb_build_object(
      'filename', v_batch.filename,
      'cargo_mode', v_batch.cargo_mode,
      'eligible_bls', v_eligible_bls,
      'blocked_bls', v_blocked_bls,
      'calculated_bls', v_calculated_bls
    )
  WHERE id = v_run_id;

  RETURN jsonb_build_object(
    'billing_run_id', v_run_id,
    'manifest_id', p_batch_id,
    'status', CASE WHEN v_blocked_bls > 0 THEN 'completed_with_blocks' ELSE 'completed' END,
    'total_bls', v_total_bls,
    'eligible_bls', v_eligible_bls,
    'blocked_bls', v_blocked_bls,
    'calculated_bls', v_calculated_bls,
    'total_brl', v_total_brl,
    'total_usd', v_total_usd
  );
EXCEPTION
  WHEN OTHERS THEN
    IF v_run_id IS NOT NULL THEN
      UPDATE public.billing_runs
      SET
        completed_at = now(),
        status = 'failed',
        summary = COALESCE(summary, '{}'::JSONB) || jsonb_build_object(
          'error', SQLERRM,
          'failed_at', now()
        )
      WHERE id = v_run_id;

      PERFORM public.insert_billing_run_log(
        v_run_id,
        p_batch_id,
        NULL,
        'error',
        'billing_run_failed',
        SQLERRM,
        jsonb_build_object('sqlstate', SQLSTATE)
      );
    END IF;
    RAISE;
END;
$function$;

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
    RAISE EXCEPTION 'Usuário sem permissão de faturamento.' USING ERRCODE = '42501';
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
    RAISE EXCEPTION 'Câmbio (ROE) não configurado; não é possível calcular o saldo de linhas em USD.' USING ERRCODE = '22023';
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

CREATE OR REPLACE FUNCTION public.add_manual_bl_charge(p_bl_id text, p_charge_item_id bigint, p_quantity numeric DEFAULT 1, p_notes text DEFAULT NULL::text, p_actor uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  PERFORM public._assert_actor_is_caller(p_actor);
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuário sem permissão ativa' USING ERRCODE = '42501';
  END IF;
  PERFORM public._assert_bl_not_manually_exempt(upper(btrim(COALESCE(p_bl_id, ''))));
  RETURN public._add_manual_bl_charge_impl_106(p_bl_id, p_charge_item_id, p_quantity, p_notes, p_actor);
END;
$function$;

CREATE OR REPLACE FUNCTION public.add_manual_invoice_charge(p_invoice_id bigint, p_description text, p_quantity numeric, p_unit_value_brl numeric, p_notes text DEFAULT NULL::text, p_actor uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_invoice RECORD;
  v_actor UUID;
  v_desc TEXT;
  v_qty NUMERIC;
  v_unit NUMERIC;
  v_total NUMERIC;
  v_item_id BIGINT;
  v_payment_count INTEGER;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Usuário sem permissão de faturamento.' USING ERRCODE = '42501';
  END IF;

  v_actor := COALESCE(p_actor, auth.uid());

  v_desc := NULLIF(TRIM(COALESCE(p_description, '')), '');
  IF v_desc IS NULL THEN
    RAISE EXCEPTION 'Descricao do item e obrigatoria.' USING ERRCODE = '22023';
  END IF;

  v_qty := COALESCE(p_quantity, 0);
  v_unit := COALESCE(p_unit_value_brl, 0);
  IF v_qty <= 0 THEN
    RAISE EXCEPTION 'Quantidade deve ser maior que zero.' USING ERRCODE = '22023';
  END IF;
  IF v_unit <= 0 THEN
    RAISE EXCEPTION 'Valor unitario deve ser maior que zero.' USING ERRCODE = '22023';
  END IF;
  v_total := ROUND(v_qty * v_unit, 2);

  SELECT * INTO v_invoice FROM public.invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice % nao encontrada.', p_invoice_id USING ERRCODE = 'P0002';
  END IF;

  IF COALESCE(v_invoice.invoice_type, 'individual') = 'consolidated' THEN
    RAISE EXCEPTION 'Nao e permitido adicionar itens manuais em fatura consolidada.' USING ERRCODE = '22023';
  END IF;

  IF COALESCE(v_invoice.status, 'issued') NOT IN ('issued', 'overdue', 'draft') THEN
    RAISE EXCEPTION 'So e permitido adicionar itens em faturas em aberto (status atual: %).',
      COALESCE(v_invoice.status, 'issued') USING ERRCODE = '22023';
  END IF;

  SELECT COUNT(*) INTO v_payment_count FROM public.payments WHERE invoice_id = p_invoice_id;
  IF v_payment_count > 0 THEN
    RAISE EXCEPTION 'Nao e permitido adicionar itens em fatura com pagamentos registrados.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.invoice_items (
    invoice_id, description, quantity, unit_value_brl, total_value_brl, source, currency, snapshot_payload
  )
  VALUES (
    p_invoice_id, v_desc, v_qty, v_unit, v_total, 'manual', 'BRL',
    jsonb_build_object(
      'manual', true,
      'notes', NULLIF(TRIM(COALESCE(p_notes, '')), ''),
      'added_by', v_actor,
      'added_at', now()
    )
  )
  RETURNING id INTO v_item_id;

  UPDATE public.invoices
  SET
    total_brl = COALESCE(total_brl, 0) + v_total,
    balance_brl = GREATEST(COALESCE(total_brl, 0) + v_total - COALESCE(total_paid_brl, 0), 0),
    pix_payload = NULL
  WHERE id = p_invoice_id;

  INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  VALUES (
    'invoice', p_invoice_id::text, 'manual_charge_added',
    NULL, format('%s: %s x %s = %s BRL', v_desc, v_qty, v_unit, v_total), v_actor,
    NULLIF(TRIM(COALESCE(p_notes, '')), '')
  );

  RETURN jsonb_build_object('invoice_id', p_invoice_id, 'item_id', v_item_id, 'total_value_brl', v_total);
END;
$function$;

CREATE OR REPLACE FUNCTION public.apply_baplie_physical_flags_atomic(p_voyage_id bigint, p_changes jsonb, p_changed_by uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuário sem permissão ativa.' USING ERRCODE = '42501';
  END IF;
  PERFORM public._lock_import_voyages(ARRAY[p_voyage_id]);
  PERFORM public._set_import_context('Baplie (marcas)', p_voyage_id, NULL);
  RETURN public.apply_baplie_physical_flags_atomic_legacy_189(p_voyage_id, p_changes, p_changed_by);
END $function$;

CREATE OR REPLACE FUNCTION public.apply_baplie_physical_flags_atomic_legacy_189(p_voyage_id bigint, p_changes jsonb, p_changed_by uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_result jsonb; v_reissues jsonb;
  v_previous text := current_setting('vela.invoice_basis_source', true);
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR p_changed_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Usuário sem permissão ativa.' USING ERRCODE = '42501';
  END IF;
  PERFORM set_config('vela.invoice_basis_source', 'baplie_correction', true);
  v_result := public._apply_baplie_physical_flags_before_reissue_126(p_voyage_id, p_changes, p_changed_by);
  v_reissues := public.process_invoice_basis_changes();
  PERFORM set_config('vela.invoice_basis_source', coalesce(v_previous, ''), true);
  IF jsonb_typeof(v_result) = 'object' THEN
    RETURN v_result || jsonb_build_object('invoice_reissues', v_reissues);
  END IF;
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.apply_bl_review_gate_after_import(p_bl_ids text[], p_changed_by uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bl RECORD;
  v_reason TEXT;
  v_reasons TEXT[];
  v_notes TEXT;
  v_changed INTEGER := 0;
BEGIN
  IF auth.uid() IS NULL
     OR NOT public.is_active_user()
     OR p_changed_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Usuário sem permissão ativa para aplicar o gate de importação.'
      USING ERRCODE = '42501';
  END IF;

  IF COALESCE(cardinality(p_bl_ids), 0) = 0 THEN
    RETURN 0;
  END IF;

  -- Captura do contato do manifesto na importacao. A regra e a mesma funcao
  -- unica da 370, chamada tambem pela Revisao e pelo Aprovar da Validacao.
  --
  -- Roda ANTES do laco de pendencias, e nao dentro dele, porque o laco faz
  -- CONTINUE quando o B/L nao tem pendencia nenhuma — que e exatamente o caso
  -- do B/L auto-vinculado por CNPJ (`matched_document`), o que mais precisa
  -- desta captura: ninguem abre a Revisao para ele, entao esta e a unica
  -- oportunidade de registrar o contato.
  --
  -- DISTINCT porque um manifesto traz varios B/Ls do mesmo cliente com o mesmo
  -- e-mail: sem ele, as chamadas da mesma instrucao nao enxergam a linha que a
  -- anterior acabou de inserir e o NOT EXISTS interno deixaria passar duplicata.
  PERFORM public.capture_manifest_financial_contact(alvo.customer_id, alvo.email)
  FROM (
    SELECT DISTINCT b.customer_id, lower(btrim(b.manifest_customer_email)) AS email
    FROM public.bls AS b
    JOIN public.customers AS c ON c.id = b.customer_id
    WHERE b.id = ANY(p_bl_ids)
      AND b.customer_id IS NOT NULL
      AND NULLIF(btrim(COALESCE(b.manifest_customer_email, '')), '') IS NOT NULL
      -- M14 (migration 175): só quando o CNPJ do documento é o do Cliente.
      -- Migration 194 (A4): com as letras do CNPJ alfanumérico.
      AND public.normalize_document_text(b.manifest_customer_cnpj_cpf)
        = public.normalize_document_text(c.cnpj_cpf)
  ) AS alvo;

  FOR v_bl IN
    SELECT b.id, b.review_status, b.notes, b.financial_status
    FROM public.bls b
    WHERE b.id = ANY(p_bl_ids)
    ORDER BY b.id
  LOOP
    IF v_bl.financial_status = 'invoiced'
       OR EXISTS (
         SELECT 1
         FROM public.invoice_bls ib
         JOIN public.invoices i ON i.id = ib.invoice_id
         WHERE ib.bl_id = v_bl.id
           AND i.status NOT IN ('cancelled', 'obsolete')
       ) THEN
      CONTINUE;
    END IF;

    v_reasons := public.compute_bl_review_pendencies(v_bl.id);
    IF COALESCE(cardinality(v_reasons), 0) = 0 THEN
      CONTINUE;
    END IF;

    v_notes := v_bl.notes;
    FOREACH v_reason IN ARRAY v_reasons
    LOOP
      IF COALESCE(v_notes, '') NOT ILIKE '%' || v_reason || '%' THEN
        IF COALESCE(v_notes, '') ILIKE '%Pendencias de importacao:%' THEN
          v_notes := v_notes || ', ' || v_reason;
        ELSE
          v_notes := concat_ws(
            E'\n',
            NULLIF(btrim(COALESCE(v_notes, '')), ''),
            'Pendencias de importacao: ' || v_reason
          );
        END IF;
      END IF;
    END LOOP;

    UPDATE public.bls
    SET
      review_status = 'pending_review',
      notes = v_notes
    WHERE id = v_bl.id;

    IF v_bl.review_status IS DISTINCT FROM 'pending_review' THEN
      INSERT INTO public.audit_logs (
        entity_type,
        entity_id,
        field_name,
        old_value,
        new_value,
        changed_by,
        justification
      )
      VALUES (
        'bl',
        v_bl.id,
        'review_status',
        v_bl.review_status,
        'pending_review',
        p_changed_by,
        'Gate canonico aplicado apos importacao'
      );
    END IF;

    PERFORM public.sync_customer_reconciliation_queue_for_bl(v_bl.id);
    v_changed := v_changed + 1;
  END LOOP;

  RETURN v_changed;
END;
$function$;

CREATE OR REPLACE FUNCTION public.apply_ce_mercante_rows_atomic(p_rows jsonb, p_changed_by uuid, p_target text DEFAULT 'bls'::text, p_manifesto_numero text DEFAULT NULL::text, p_voyage_id bigint DEFAULT NULL::bigint, p_confirm_changes boolean DEFAULT false, p_reason text DEFAULT NULL::text, p_defer_billing boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET statement_timeout TO '60s'
AS $function$
BEGIN
  -- 408 (R-11): a guarda antes da trava da Viagem, como a 389 fez nas outras.
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR p_changed_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Usuário sem permissão ativa.' USING ERRCODE = '42501';
  END IF;
  IF p_target = 'granite' THEN
    RAISE EXCEPTION 'A planilha de CE Mercante não se aplica ao Granito: o Granito só totaliza a carga do navio.'
      USING ERRCODE = '22023';
  END IF;
  PERFORM public._lock_import_voyages_of_bls(ARRAY[p_voyage_id], public._import_payload_texts(p_rows, 'bl_id'));
  PERFORM public._set_import_context('CE Mercante', p_voyage_id, p_manifesto_numero);
  RETURN public.apply_ce_mercante_rows_atomic_legacy_189(p_rows, p_changed_by, p_target, p_manifesto_numero, p_voyage_id, p_confirm_changes, p_reason, p_defer_billing);
END $function$;

CREATE OR REPLACE FUNCTION public.apply_ce_mercante_rows_atomic_legacy_189(p_rows jsonb, p_changed_by uuid, p_target text DEFAULT 'bls'::text, p_manifesto_numero text DEFAULT NULL::text, p_voyage_id bigint DEFAULT NULL::bigint, p_confirm_changes boolean DEFAULT false, p_reason text DEFAULT NULL::text, p_defer_billing boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_row jsonb;
  v_result text;
  v_errors jsonb := '[]'::jsonb;
  v_analysis jsonb;
  v_inserted integer := 0;
  v_overwritten integer := 0;
  v_unchanged integer := 0;
  v_numero text := public.canonical_manifesto_numero(p_manifesto_numero);
  v_bl_ids text[];
  v_active text[];
  v_voyage bigint;
  v_manifesto public.manifestos_mercante%ROWTYPE;
  v_created boolean := false;
  v_pending text[] := ARRAY[]::text[];
  v_previous_deferred text := current_setting('vela.ce_billing_deferred', true);
  v_message text;
  v_state text;
  v_justification text;
  v_route_pol text;
  v_route_pod text;
BEGIN
  IF v_actor IS NULL OR NOT public.is_active_user() OR p_changed_by IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'Usuário sem permissão ativa.' USING ERRCODE = '42501';
  END IF;
  IF p_target NOT IN ('bls', 'granite') THEN
    RAISE EXCEPTION 'Destino de CE Mercante inválido: %', p_target USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(COALESCE(p_rows, 'null'::jsonb)) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'errors', jsonb_build_array(jsonb_build_object('message', 'Nenhuma linha para importar.')));
  END IF;

  IF p_target = 'granite' THEN
    BEGIN
      FOR v_row IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
        BEGIN
          v_result := public.apply_granite_ce_mercante_update((v_row->>'bl_id')::uuid, v_row->>'ce', p_changed_by);
          CASE v_result
            WHEN 'overwritten' THEN v_overwritten := v_overwritten + 1;
            WHEN 'unchanged' THEN v_unchanged := v_unchanged + 1;
            ELSE v_inserted := v_inserted + 1;
          END CASE;
        EXCEPTION WHEN OTHERS THEN
          GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_message = MESSAGE_TEXT;
          v_errors := v_errors || jsonb_build_array(jsonb_build_object('row', v_row->'row', 'bl_id', v_row->>'bl_id',
            'message', public._ce_row_error_message(v_state, v_message)));
        END;
      END LOOP;
      IF jsonb_array_length(v_errors) > 0 THEN
        RAISE EXCEPTION USING ERRCODE = 'P0099', MESSAGE = 'ce_rows_rollback';
      END IF;
    EXCEPTION WHEN SQLSTATE 'P0099' THEN
      RETURN jsonb_build_object('ok', false, 'errors', v_errors);
    END;
    RETURN jsonb_build_object('ok', true, 'processed', jsonb_array_length(p_rows),
      'inserted', v_inserted, 'overwritten', v_overwritten, 'unchanged', v_unchanged);
  END IF;

  -- Trava a Viagem antes dos B/Ls: duas planilhas da mesma Viagem não se
  -- cruzam travando os B/Ls em ordens diferentes (deadlock, ADR 0078 item 9).
  SELECT array_agg(DISTINCT btrim(value->>'bl_id')) INTO v_bl_ids FROM jsonb_array_elements(p_rows);
  SELECT COALESCE(p_voyage_id, (SELECT b.voyage_id FROM public.bls AS b WHERE b.id = ANY(v_bl_ids) ORDER BY b.id LIMIT 1)) INTO v_voyage;
  IF v_voyage IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('ce_mercante_voyage:' || v_voyage, 180));
  END IF;
  PERFORM 1 FROM public.bls WHERE id = ANY(v_bl_ids) ORDER BY id FOR UPDATE;

  v_analysis := public._analyze_ce_mercante_rows(p_rows, p_manifesto_numero, p_voyage_id);
  IF jsonb_array_length(v_analysis->'errors') > 0 THEN
    RETURN jsonb_build_object('ok', false, 'errors', v_analysis->'errors', 'warnings', v_analysis->'warnings');
  END IF;
  IF (v_analysis->>'needs_confirmation')::boolean AND (NOT p_confirm_changes OR v_reason IS NULL) THEN
    RETURN jsonb_build_object('ok', false, 'needs_confirmation', true, 'warnings', v_analysis->'warnings',
      'errors', jsonb_build_array(jsonb_build_object('message', format(
        'A planilha troca o CE de %s B/L(s) e muda o Manifesto de %s B/L(s): confirme na prévia, com motivo.',
        v_analysis->>'changes', v_analysis->>'moves'))));
  END IF;
  v_active := ARRAY(SELECT jsonb_array_elements_text(v_analysis->'active_bl_ids'));

  -- Rastro (ADR 0078, item 9; K8): o invólucro da 189 define o contexto com a
  -- Viagem informada; sem Viagem na tela, vale a dos B/Ls. O Histórico do CE,
  -- do Manifesto criado e do vínculo leva o contexto, a rota e o motivo. A
  -- planilha de CE refina o contexto que o próprio invólucro gravou (a 190 faz
  -- o primeiro contexto da transação valer até o fim; aqui ele é o mesmo, só
  -- mais completo).
  PERFORM set_config('vela.import_context', '', true);
  PERFORM public._set_import_context('CE Mercante',
    COALESCE((v_analysis->'manifesto'->>'voyage_id')::bigint, v_voyage), COALESCE(v_numero, p_manifesto_numero));
  v_route_pol := NULLIF(v_analysis->'manifesto'->>'pol', '');
  v_route_pod := NULLIF(v_analysis->'manifesto'->>'pod', '');
  v_justification := concat_ws(' · ',
    COALESCE(NULLIF(btrim(current_setting('vela.import_context', true)), ''), 'Importação de CE Mercante'),
    CASE WHEN v_route_pol IS NOT NULL AND v_route_pod IS NOT NULL THEN
      'Rota ' || COALESCE(public.normalize_port_code(v_route_pol), upper(v_route_pol))
        || ' → ' || COALESCE(public.normalize_port_code(v_route_pod), upper(v_route_pod)) END,
    CASE WHEN v_reason IS NOT NULL THEN 'Motivo: ' || v_reason END);

  IF cardinality(v_active) > 0 THEN
    SELECT * INTO v_manifesto FROM public.manifestos_mercante WHERE numero = v_numero;
    v_created := NOT FOUND;
  END IF;

  IF p_defer_billing THEN
    PERFORM set_config('vela.ce_billing_deferred', 'on', true);
  END IF;

  BEGIN
    FOR v_row IN
      SELECT value FROM jsonb_array_elements(v_analysis->'rows')
      WHERE value->>'status' IN ('new', 'same', 'change')
    LOOP
      BEGIN
        -- A troca com Desbloqueio conferido abre o alerta na porta única
        -- (`_set_bl_ce_mercante`, migration 195).
        v_result := public._set_bl_ce_mercante(v_row->>'bl_id', v_row->>'new_ce', v_actor, v_justification, 'ce_mercante_planilha');
        CASE v_result
          WHEN 'overwritten' THEN v_overwritten := v_overwritten + 1;
          WHEN 'unchanged' THEN v_unchanged := v_unchanged + 1;
          ELSE v_inserted := v_inserted + 1;
        END CASE;
        IF v_result <> 'unchanged' THEN
          -- Rede da emissão: o efeito revalida e não refatura (migration 178).
          INSERT INTO public.import_pending_effects(source_action_id, effect_kind, entity_id, created_by)
          VALUES (gen_random_uuid(), 'local_billing', v_row->>'bl_id', v_actor)
          ON CONFLICT (source_action_id, effect_kind, entity_id) DO NOTHING;
          v_pending := array_append(v_pending, v_row->>'bl_id');
        -- Mesma planilha de novo (212): o B/L que a emissão interrompida
        -- deixou sem fatura volta ao lote; o faturado não.
        ELSIF EXISTS (
          SELECT 1 FROM public.bls AS b
          WHERE b.id = v_row->>'bl_id' AND b.cancelled_at IS NULL
            AND NULLIF(btrim(COALESCE(b.ce_mercante, '')), '') IS NOT NULL
            AND COALESCE(b.financial_status, 'pending') = 'pending')
          AND cardinality(public._live_local_invoice_ids_for_bl(v_row->>'bl_id')) = 0 THEN
          v_pending := array_append(v_pending, v_row->>'bl_id');
        END IF;
      EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_message = MESSAGE_TEXT;
        v_errors := v_errors || jsonb_build_array(jsonb_build_object('row', v_row->'row', 'bl_id', v_row->>'bl_id',
          'message', public._ce_row_error_message(v_state, v_message)));
      END;
    END LOOP;

    IF jsonb_array_length(v_errors) > 0 THEN
      RAISE EXCEPTION USING ERRCODE = 'P0099', MESSAGE = 'ce_rows_rollback';
    END IF;

    IF cardinality(v_active) > 0 THEN
      PERFORM public._upsert_route_manifesto((v_analysis->'manifesto'->>'voyage_id')::bigint,
        v_analysis->'manifesto'->>'pol', v_analysis->'manifesto'->>'pod', 'carga', v_numero);
      SELECT * INTO v_manifesto FROM public.manifestos_mercante WHERE numero = v_numero;
      IF v_created THEN
        INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
        VALUES ('voyage', v_manifesto.voyage_id::text, 'manifesto_mercante_created', NULL, v_numero, v_actor, v_justification);
      END IF;
      PERFORM public._link_bls_to_manifesto(v_active, v_manifesto.id, v_actor, v_justification);
    END IF;
  EXCEPTION WHEN SQLSTATE 'P0099' THEN
    PERFORM set_config('vela.ce_billing_deferred', COALESCE(v_previous_deferred, ''), true);
    RETURN jsonb_build_object('ok', false, 'errors', v_errors, 'warnings', v_analysis->'warnings');
  END;
  PERFORM set_config('vela.ce_billing_deferred', COALESCE(v_previous_deferred, ''), true);

  RETURN jsonb_build_object(
    'ok', true,
    'processed', jsonb_array_length(p_rows),
    'inserted', v_inserted,
    'overwritten', v_overwritten,
    'unchanged', v_unchanged,
    'ignored', (SELECT count(*) FROM jsonb_array_elements(v_analysis->'rows') WHERE value->>'status' = 'cancelled'),
    'warnings', v_analysis->'warnings',
    'manifesto_mercante_id', v_manifesto.id,
    'manifesto_created', v_created,
    'billing_pending_bl_ids', CASE WHEN p_defer_billing THEN to_jsonb(v_pending) ELSE '[]'::jsonb END
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.apply_ce_mercante_update(p_bl_id text, p_new_ce text, p_changed_by uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_result text;
BEGIN
  IF v_actor IS NULL OR NOT public.is_active_user() OR p_changed_by IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'Usuário sem permissão ativa.' USING ERRCODE = '42501';
  END IF;
  IF NULLIF(btrim(COALESCE(p_new_ce, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Linha sem CE Mercante para o B/L %: a planilha nao remove CE (use Remover CE Mercante na ficha).', p_bl_id
      USING ERRCODE = '22023';
  END IF;

  v_result := public._set_bl_ce_mercante(p_bl_id, p_new_ce, v_actor, 'Importacao CE Mercante', 'ce_mercante_planilha');
  IF v_result = 'unchanged' THEN RETURN v_result; END IF;

  INSERT INTO public.import_pending_effects(source_action_id, effect_kind, entity_id, created_by)
  VALUES (gen_random_uuid(), 'local_billing', p_bl_id, v_actor)
  ON CONFLICT (source_action_id, effect_kind, entity_id) DO NOTHING;

  RETURN v_result;
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
    RAISE EXCEPTION 'Usuário sem permissão ativa.' USING ERRCODE = '42501';
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
    RAISE EXCEPTION 'Câmbio (ROE) não configurado; não é possível calcular linhas em USD.'
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
      SELECT COALESCE(SUM(COALESCE(cc.total_value_brl,
        CASE WHEN COALESCE(cc.total_value_usd, 0) > 0 THEN ROUND(cc.total_value_usd * v_roe, 2) END, 0)), 0)
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
    SELECT r.roe, r.effective_date
    INTO v_roe, v_roe_effective_date
    FROM public._bl_fixed_roe(p_bl_id) r;

    IF v_roe IS NULL AND EXISTS (
      SELECT 1
      FROM public.resolve_bl_local_charge_items(p_bl_id, v_bl.pod) AS item
      WHERE COALESCE(item.total_value_usd, 0) > 0
    ) THEN
      RAISE EXCEPTION 'Câmbio (ROE) não configurado; não é possível reprecificar linhas em USD.'
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

CREATE OR REPLACE FUNCTION public.apply_container_dates_atomic_legacy_189(p_request_id uuid, p_bl_id text, p_rows jsonb, p_changed_by uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_role text;
  v_bl_id text := NULLIF(btrim(COALESCE(p_bl_id, '')), '');
  v_count integer := 0;
  v_item jsonb;
  v_num text;
  v_discharge text;
  v_return text;
  v_exp_discharge text;
  v_exp_return text;
  v_updated bigint[] := ARRAY[]::bigint[];
  v_unchanged bigint[] := ARRAY[]::bigint[];
  v_touched text[] := ARRAY[]::text[];
  v_billing_state text := 'pending';
  v_after jsonb := '{}'::jsonb;
  r record;
BEGIN
  IF v_actor IS NULL OR NOT public.is_active_user() OR p_changed_by IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'Usuário sem permissão ativa.' USING ERRCODE = '42501';
  END IF;
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'request_id obrigatorio.' USING ERRCODE = '22023';
  END IF;
  IF v_bl_id IS NULL THEN
    RAISE EXCEPTION 'B/L obrigatorio.' USING ERRCODE = '22023';
  END IF;
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'Lote de datas invalido.' USING ERRCODE = '22023';
  END IF;
  v_count := jsonb_array_length(p_rows);
  IF v_count = 0 OR v_count > 500 THEN
    RAISE EXCEPTION 'Lote deve ter entre 1 e 500 linhas.' USING ERRCODE = '22023';
  END IF;

  PERFORM 1 FROM public.bls WHERE id = v_bl_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L % nao encontrado', v_bl_id USING ERRCODE = 'P0002';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_rows)
  LOOP
    IF jsonb_typeof(v_item) <> 'object' THEN
      RAISE EXCEPTION 'Linha de datas invalida.' USING ERRCODE = '22023';
    END IF;
    v_num := upper(btrim(COALESCE(v_item->>'container_number', '')));
    v_discharge := NULLIF(btrim(COALESCE(v_item->>'discharge_date', '')), '');
    v_return := NULLIF(btrim(COALESCE(v_item->>'return_date', '')), '');
    IF v_num = '' THEN
      RAISE EXCEPTION 'Container obrigatorio no B/L %.', v_bl_id USING ERRCODE = '22023';
    END IF;
    IF v_discharge IS NULL OR v_discharge !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR v_discharge::date IS NULL THEN
      RAISE EXCEPTION 'Data de descarga invalida para % no B/L %.', v_num, v_bl_id USING ERRCODE = '22023';
    END IF;
    IF v_return IS NOT NULL AND (v_return !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR v_return::date IS NULL) THEN
      RAISE EXCEPTION 'Data de devolucao invalida para % no B/L %.', v_num, v_bl_id USING ERRCODE = '22023';
    END IF;
    IF v_return IS NOT NULL AND v_return::date < v_discharge::date THEN
      RAISE EXCEPTION 'Devolucao anterior a descarga para % no B/L %.', v_num, v_bl_id USING ERRCODE = '22023';
    END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_to_recordset(p_rows) AS t(container_number text, discharge_date text, return_date text)
      WHERE upper(btrim(COALESCE(t.container_number, ''))) = v_num
        AND (btrim(COALESCE(t.discharge_date, '')) IS DISTINCT FROM v_discharge
             OR NULLIF(btrim(COALESCE(t.return_date, '')), '') IS DISTINCT FROM v_return)
    ) THEN
      RAISE EXCEPTION 'Container % duplicado com datas conflitantes no B/L %.', v_num, v_bl_id USING ERRCODE = '22023';
    END IF;
  END LOOP;

  -- Todos os conjuntos do arquivo, em ordem de id, antes da trava por linha
  -- abaixo (211): duas planilhas de B/Ls que dividem containers não se travam.
  PERFORM public._lock_container_date_sets(ARRAY(
    SELECT c.id FROM public.bl_containers AS c
    WHERE c.bl_id = v_bl_id
      AND upper(btrim(c.container_number)) IN (
        SELECT upper(btrim(COALESCE(row_item->>'container_number', '')))
        FROM jsonb_array_elements(p_rows) AS row_item)));

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_rows)
  LOOP
    v_num := upper(btrim(COALESCE(v_item->>'container_number', '')));
    v_discharge := NULLIF(btrim(COALESCE(v_item->>'discharge_date', '')), '');
    v_return := NULLIF(btrim(COALESCE(v_item->>'return_date', '')), '');
    v_exp_discharge := NULLIF(btrim(COALESCE(v_item->>'expected_discharge_date', '')), '');
    v_exp_return := NULLIF(btrim(COALESCE(v_item->>'expected_return_date', '')), '');

    SELECT c.id, c.discharge_date::text, c.return_date::text INTO r
    FROM public.bl_containers AS c
    WHERE c.bl_id = v_bl_id AND upper(btrim(c.container_number)) = v_num
    ORDER BY c.id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Container % nao pertence ao B/L %.', v_num, v_bl_id USING ERRCODE = 'P0002';
    END IF;

    -- Devolução vazia na planilha não mexe na data gravada (ADR 0078, item 19).
    -- Vem antes da checagem de prévia obsoleta: o container que já está no
    -- valor pedido não é escrito, e a data que outro B/L do mesmo arquivo
    -- acabou de propagar a este (container compartilhado) não é conflito.
    IF r.discharge_date IS NOT DISTINCT FROM v_discharge
       AND (v_return IS NULL OR r.return_date IS NOT DISTINCT FROM v_return) THEN
      v_unchanged := array_append(v_unchanged, r.id);
      CONTINUE;
    END IF;

    -- A prévia que viu a descarga vazia também conta: a chave presente com
    -- valor nulo é conferida, como a da devolução (201).
    IF (v_item ? 'expected_discharge_date') AND (r.discharge_date IS DISTINCT FROM v_exp_discharge) THEN
      RAISE EXCEPTION 'Preview obsoleto para % no B/L %: recarregue e reconfira.', v_num, v_bl_id USING ERRCODE = '22023';
    END IF;
    IF (v_item ? 'expected_return_date') AND (r.return_date IS DISTINCT FROM v_exp_return) THEN
      RAISE EXCEPTION 'Preview obsoleto para % no B/L %: recarregue e reconfira.', v_num, v_bl_id USING ERRCODE = '22023';
    END IF;

    v_touched := v_touched || public._apply_container_dates_core(r.id, v_discharge::date, v_return::date, v_return IS NULL);
    v_updated := array_append(v_updated, r.id);
  END LOOP;

  -- SOC não tem devolução a esperar (ADR 0014; migration 121).
  IF NOT EXISTS (
    SELECT 1 FROM public.bl_containers AS c
    WHERE c.bl_id = v_bl_id AND c.return_date IS NULL AND c.ownership IS DISTINCT FROM 'SOC'
  ) THEN
    v_billing_state := 'ready_for_billing';
  END IF;

  v_role := public.current_actor_role();

  IF cardinality(v_updated) > 0 THEN
    v_touched := ARRAY(SELECT DISTINCT unnest(v_touched || ARRAY[v_bl_id]));
    INSERT INTO public.audit_logs(
      entity_type, entity_id, field_name, old_value, new_value,
      changed_by, justification, actor_role, actor_department
    ) VALUES (
      'bl', v_bl_id, 'container_dates_import',
      jsonb_build_object('request_id', p_request_id, 'bl_id', v_bl_id)::text,
      jsonb_build_object(
        'request_id', p_request_id, 'bl_id', v_bl_id,
        'updated_ids', v_updated, 'unchanged_ids', v_unchanged,
        'billing_state', v_billing_state, 'propagated_bl_ids', v_touched
      )::text,
      v_actor, 'Importacao de datas por B/L (atomica)', v_role, v_role
    );
    v_after := public._after_container_dates(p_request_id, v_touched, v_actor);
  END IF;

  RETURN jsonb_build_object(
    'request_id', p_request_id,
    'bl_id', v_bl_id,
    'updated_ids', v_updated,
    'unchanged_ids', v_unchanged,
    'billing_state', v_billing_state,
    'propagated_bl_ids', to_jsonb(v_touched),
    'demurrage', v_after
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.apply_container_dates_batch_atomic(p_request_id uuid, p_batches jsonb, p_changed_by uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET statement_timeout TO '60s'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_batch jsonb;
  v_bl_id text;
  v_result jsonb;
  v_errors jsonb := '[]'::jsonb;
  v_updated integer := 0;
  v_unchanged integer := 0;
  v_bls integer := 0;
BEGIN
  IF v_actor IS NULL OR NOT public.is_active_user() OR p_changed_by IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'Usuário sem permissão ativa.' USING ERRCODE = '42501';
  END IF;
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'request_id obrigatorio.' USING ERRCODE = '22023';
  END IF;
  IF p_batches IS NULL OR jsonb_typeof(p_batches) <> 'array' OR jsonb_array_length(p_batches) = 0 THEN
    RAISE EXCEPTION 'Planilha de datas vazia.' USING ERRCODE = '22023';
  END IF;
  -- 499: sem teto de B/Ls nem de linhas; o limite é o tempo da chamada.
  FOR v_batch IN SELECT * FROM jsonb_array_elements(p_batches) LOOP
    IF jsonb_typeof(v_batch) <> 'object' OR jsonb_typeof(v_batch->'rows') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'Lote de datas invalido.' USING ERRCODE = '22023';
    END IF;
  END LOOP;

  -- 387: a trava das Viagens vem antes de qualquer outra (ADR 0095, decisão 6).
  PERFORM public._lock_import_voyages_of_bls(NULL, public._import_payload_texts(p_batches, 'bl_id'));

  -- Todos os conjuntos do arquivo, em ordem de id, antes do primeiro B/L.
  PERFORM public._lock_container_date_sets(ARRAY(
    SELECT c.id
    FROM jsonb_array_elements(p_batches) AS b(item)
    CROSS JOIN LATERAL jsonb_array_elements(b.item->'rows') AS r(item)
    JOIN public.bl_containers AS c
      ON c.bl_id = btrim(COALESCE(b.item->>'bl_id', ''))
     AND upper(btrim(c.container_number)) = upper(btrim(COALESCE(r.item->>'container_number', '')))));

  BEGIN
    -- Em ordem de B/L: arquivos simultâneos travam na mesma ordem.
    FOR v_batch IN
      SELECT b.item FROM jsonb_array_elements(p_batches) AS b(item)
      ORDER BY btrim(COALESCE(b.item->>'bl_id', ''))
    LOOP
      v_bl_id := NULLIF(btrim(COALESCE(v_batch->>'bl_id', '')), '');
      BEGIN
        v_result := public.apply_container_dates_atomic(p_request_id, v_bl_id, v_batch->'rows', p_changed_by);
        v_updated := v_updated + COALESCE(jsonb_array_length(v_result->'updated_ids'), 0);
        v_unchanged := v_unchanged + COALESCE(jsonb_array_length(v_result->'unchanged_ids'), 0);
        v_bls := v_bls + 1;
      EXCEPTION WHEN OTHERS THEN
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'bl_id', COALESCE(v_bl_id, ''), 'code', SQLSTATE, 'message', SQLERRM));
      END;
    END LOOP;

    IF jsonb_array_length(v_errors) > 0 THEN
      -- Desfaz o que os B/Ls aceitos gravaram: o arquivo é recusado inteiro.
      RAISE EXCEPTION 'planilha de datas recusada' USING ERRCODE = 'VB333';
    END IF;
  EXCEPTION WHEN SQLSTATE 'VB333' THEN
    RETURN jsonb_build_object('ok', false, 'request_id', p_request_id, 'errors', v_errors);
  END;

  RETURN jsonb_build_object(
    'ok', true,
    'request_id', p_request_id,
    'updated', v_updated,
    'unchanged', v_unchanged,
    'bls', v_bls
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.apply_customer_base_batch_atomic(p_rows jsonb, p_changed_by uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET statement_timeout TO '60s'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_row jsonb;
  v_cnpj text;
  v_expected text;
  v_current text;
  v_result jsonb;
  v_errors jsonb := '[]'::jsonb;
  v_imported integer := 0;
  v_updated integer := 0;
  v_contacts integer := 0;
  v_bls integer := 0;
  v_suggested integer := 0;
  v_deactivated integer := 0;
  v_linked jsonb := '[]'::jsonb;
BEGIN
  IF v_actor IS NULL OR NOT public.is_active_user() OR p_changed_by IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'Usuário sem permissão ativa.' USING ERRCODE = '42501';
  END IF;
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION 'Base de Clientes vazia.' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_rows) > 3000 THEN
    RAISE EXCEPTION 'Base com mais de 3000 Clientes: divida o arquivo.' USING ERRCODE = '22023';
  END IF;

  BEGIN
    -- Em ordem de CNPJ: bases simultâneas travam os Clientes na mesma ordem.
    FOR v_row IN
      SELECT r.item FROM jsonb_array_elements(p_rows) AS r(item)
      ORDER BY btrim(COALESCE(r.item->>'cnpj', ''))
    LOOP
      v_cnpj := NULLIF(btrim(COALESCE(v_row->>'cnpj', '')), '');
      BEGIN
        IF jsonb_typeof(v_row) <> 'object' THEN
          RAISE EXCEPTION 'Linha da base invalida.' USING ERRCODE = '22023';
        END IF;
        -- O aceite da troca vale para o nome que a prévia mostrou.
        IF COALESCE((v_row->>'confirm_name_change')::boolean, false) THEN
          -- Comparação exata: a tela manda o nome como o leu (sem trim).
          v_expected := v_row->>'expected_current_name';
          SELECT name INTO v_current
          FROM public.customers WHERE cnpj_cpf = v_cnpj FOR UPDATE;
          IF v_expected IS NULL OR NOT FOUND OR v_current IS DISTINCT FROM v_expected THEN
            RAISE EXCEPTION 'A razão social do Cliente % mudou depois da prévia: leia o arquivo de novo.', v_cnpj
              USING ERRCODE = 'P0001';
          END IF;
        END IF;

        v_result := public.apply_customer_base_row_atomic(
          v_cnpj,
          v_row->>'name',
          v_row->>'trade_name',
          v_row->>'address',
          v_row->>'city',
          v_row->>'state',
          v_row->>'zip',
          COALESCE(v_row->'emails', '[]'::jsonb),
          p_changed_by,
          COALESCE((v_row->>'confirm_name_change')::boolean, false)
        );
        IF COALESCE((v_result->>'created')::boolean, false) THEN
          v_imported := v_imported + 1;
        ELSE
          v_updated := v_updated + 1;
        END IF;
        v_contacts := v_contacts + COALESCE((v_result->>'contacts_created')::integer, 0);
        v_bls := v_bls + COALESCE((v_result->>'bls_linked')::integer, 0);
        v_suggested := v_suggested + COALESCE((v_result->>'bls_suggested')::integer, 0);
        IF COALESCE((v_result->>'customer_deactivated')::boolean, false) THEN
          v_deactivated := v_deactivated + 1;
        END IF;
        v_linked := v_linked || COALESCE(v_result->'linked_bl_ids', '[]'::jsonb);
      EXCEPTION WHEN OTHERS THEN
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'cnpj', COALESCE(v_cnpj, ''), 'code', SQLSTATE, 'message', SQLERRM));
      END;
    END LOOP;

    IF jsonb_array_length(v_errors) > 0 THEN
      -- Desfaz os Clientes aceitos: a base é recusada inteira.
      RAISE EXCEPTION 'base de clientes recusada' USING ERRCODE = 'VB334';
    END IF;
  EXCEPTION WHEN SQLSTATE 'VB334' THEN
    RETURN jsonb_build_object('ok', false, 'errors', v_errors);
  END;

  RETURN jsonb_build_object(
    'ok', true,
    'imported', v_imported,
    'updated', v_updated,
    'contacts_created', v_contacts,
    'bls_linked', v_bls,
    'linked_bl_ids', v_linked,
    'bls_suggested', v_suggested,
    'deactivated_skipped', v_deactivated,
    'contacts_skipped', NOT public._can_edit_customer_contacts()
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.apply_customer_base_row_atomic_legacy_189(p_cnpj text, p_name text, p_trade_name text, p_address text, p_city text, p_state text, p_zip text, p_emails jsonb, p_changed_by uuid, p_confirm_name_change boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_cnpj text := NULLIF(btrim(COALESCE(p_cnpj, '')), '');
  v_name text := NULLIF(btrim(COALESCE(p_name, '')), '');
  v_customer_id bigint;
  v_created boolean := false;
  v_email text;
  v_norm text;
  v_seen text[] := ARRAY[]::text[];
  v_contacts_created integer := 0;
  v_bls_linked integer := 0;
  v_current_name text;
  v_linked text[];
  v_bl text;
  v_consignees text[];
  v_consignee text;
  v_previous_batch text;
  -- 474 (D10): só quem edita contatos inclui ou muda contatos pela Base.
  v_can_contacts boolean := public._can_edit_customer_contacts();
  -- 474 (D15): Cliente desativado não muda pela Base.
  v_deactivated boolean := false;
  v_suggested text[];
BEGIN
  IF v_actor IS NULL OR NOT public.is_active_user() OR p_changed_by IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'Usuário sem permissão ativa.' USING ERRCODE = '42501';
  END IF;
  IF v_cnpj IS NULL OR v_name IS NULL THEN
    RAISE EXCEPTION 'CNPJ e razao social obrigatorios.' USING ERRCODE = '22023';
  END IF;
  IF p_emails IS NULL OR jsonb_typeof(p_emails) <> 'array' OR jsonb_array_length(p_emails) = 0 THEN
    RAISE EXCEPTION 'Ao menos um e-mail obrigatorio.' USING ERRCODE = '22023';
  END IF;

  -- Lock por cliente: serializa concorrentes do mesmo CNPJ.
  SELECT id INTO v_customer_id FROM public.customers WHERE cnpj_cpf = v_cnpj FOR UPDATE;

  -- Razão social diferente da gravada pede confirmação (ADR 0078, item 24).
  IF FOUND THEN
    SELECT name, deactivated_at IS NOT NULL INTO v_current_name, v_deactivated FROM public.customers WHERE id = v_customer_id;
    IF upper(btrim(regexp_replace(COALESCE(v_current_name, ''), '[^[:alnum:]]+', ' ', 'g'))) <> upper(btrim(regexp_replace(v_name, '[^[:alnum:]]+', ' ', 'g')))
       AND NOT COALESCE(p_confirm_name_change, false) AND NOT v_deactivated THEN
      RAISE EXCEPTION 'Razão social diferente da cadastrada (% → %): confirme a troca.', btrim(v_current_name), v_name
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers(
      cnpj_cpf, name, trade_name, address, city, state, zip, notes, pending_balance
    ) VALUES (
      v_cnpj, v_name,
      NULLIF(btrim(COALESCE(p_trade_name, '')), ''),
      NULLIF(btrim(COALESCE(p_address, '')), ''),
      NULLIF(btrim(COALESCE(p_city, '')), ''),
      NULLIF(upper(btrim(COALESCE(p_state, ''))), ''),
      NULLIF(btrim(COALESCE(p_zip, '')), ''),
      NULL, 0
    ) RETURNING id INTO v_customer_id;
    v_created := true;
  ELSIF NOT v_deactivated THEN
    UPDATE public.customers
      SET name = v_name,
          trade_name = COALESCE(NULLIF(btrim(COALESCE(p_trade_name, '')), ''), trade_name),
          address = COALESCE(NULLIF(btrim(COALESCE(p_address, '')), ''), address),
          city = COALESCE(NULLIF(btrim(COALESCE(p_city, '')), ''), city),
          state = COALESCE(NULLIF(upper(btrim(COALESCE(p_state, ''))), ''), state),
          zip = COALESCE(NULLIF(btrim(COALESCE(p_zip, '')), ''), zip),
          updated_at = now()
      WHERE id = v_customer_id;
  END IF;

  -- Bases anteriores podiam ter um principal sem e-mail. Ele não satisfaz o
  -- contrato atual; a transação só termina depois que algum e-mail elegível
  -- assume a principalidade.
  IF v_can_contacts AND NOT v_deactivated THEN
  UPDATE public.customer_contacts AS cc
  SET is_primary = false,
      updated_at = now()
  WHERE cc.customer_id = v_customer_id
    AND cc.is_primary = true
    AND cc.deactivated_at IS NULL
    AND cc.email_normalized IS NULL;
  END IF;

  -- Contatos: valida formato e duplicata no envio; existente e no-op.
  -- O primeiro e-mail elegível assume a principalidade se ainda não houver
  -- um principal ativo com e-mail; a decisão é reavaliada a cada iteração.
  FOR v_email IN SELECT value #>> '{}' FROM jsonb_array_elements(p_emails)
  LOOP
    v_norm := lower(NULLIF(btrim(COALESCE(v_email, '')), ''));
    IF v_norm IS NULL OR v_norm !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
      RAISE EXCEPTION 'E-mail invalido para o cliente %: %', v_cnpj, COALESCE(v_email, '') USING ERRCODE = '22023';
    END IF;
    IF v_norm = ANY (v_seen) THEN
      RAISE EXCEPTION 'E-mail duplicado no envio: %', v_norm USING ERRCODE = '23505';
    END IF;
    v_seen := array_append(v_seen, v_norm);
    CONTINUE WHEN NOT v_can_contacts OR v_deactivated;

    -- Se o endereço já existia como adicional, promovê-lo também corrige
    -- clientes antigos que chegaram sem principal na base cadastral. Um
    -- contato desativado com o mesmo e-mail deve ser reativado; deixá-lo
    -- fora do INSERT abaixo faria o índice único tratar a linha histórica
    -- como duplicata sem criar um principal ativo.
    UPDATE public.customer_contacts AS cc
    SET deactivated_at = NULL,
        is_primary = NOT EXISTS (
          SELECT 1
          FROM public.customer_contacts AS primary_contact
          WHERE primary_contact.customer_id = v_customer_id
            AND primary_contact.is_primary = true
            AND primary_contact.deactivated_at IS NULL
            AND primary_contact.email_normalized IS NOT NULL
        ),
        updated_at = now()
    WHERE cc.customer_id = v_customer_id
      AND cc.email_normalized = v_norm;

    INSERT INTO public.customer_contacts (customer_id, name, email, purpose, is_primary)
    SELECT
      v_customer_id,
      v_name,
      v_norm,
      'financeiro',
      NOT EXISTS (
        SELECT 1
        FROM public.customer_contacts AS cc
        WHERE cc.customer_id = v_customer_id
          AND cc.is_primary = true
          AND cc.deactivated_at IS NULL
          AND cc.email_normalized IS NOT NULL
      )
    WHERE NOT EXISTS (
      SELECT 1 FROM public.customer_contacts AS cc
      WHERE cc.customer_id = v_customer_id
        AND cc.deactivated_at IS NULL
        AND lower(btrim(COALESCE(cc.email, ''))) = v_norm
    );
    IF FOUND THEN
      v_contacts_created := v_contacts_created + 1;
    END IF;
  END LOOP;

  -- Vínculo retroativo (ADR 0078, item 24): só B/Ls pendentes de Cliente com o
  -- mesmo CNPJ, nunca o rejeitado na Revisão (que recebe o Cliente à mão) nem o
  -- de Viagem cancelada, que é somente leitura: o UPDATE cairia em
  -- `trg_guard_voyage_cancelled_bls` (42501) e derrubaria a linha do Cliente
  -- (V9). A prévia (`compareCustomerBaseWithExisting`) usa o mesmo filtro.
  --
  -- Lote (170): o gatilho de linha dos Alertas fica calado enquanto o vínculo e
  -- a Revisão mudam; o Alerta é reconciliado uma vez no fim.
  v_previous_batch := current_setting('vela.bl_review_batch', true);
  PERFORM set_config('vela.bl_review_batch', 'on', true);
  WITH linked AS (
    UPDATE public.bls AS b
      SET customer_id = v_customer_id,
          customer_reconciliation_status = 'matched_document'
      WHERE b.manifest_customer_cnpj_cpf = v_cnpj
        AND b.customer_id IS NULL
        AND b.cancelled_at IS NULL
        AND COALESCE(b.customer_reconciliation_status, 'missing_customer') <> 'rejected'
        AND NOT EXISTS (
          SELECT 1 FROM public.voyages AS v
          WHERE v.id = b.voyage_id AND v.status = 'cancelled'
        )
      RETURNING b.id, b.consignee, b.customer_id
  )
  -- D15: com Cliente desativado, `guard_bl_link_to_deactivated_customer`
  -- transforma o vínculo em sugestão (customer_id volta nulo): não é vínculo.
  SELECT array_agg(id ORDER BY id) FILTER (WHERE customer_id IS NOT NULL),
         array_agg(DISTINCT consignee) FILTER (WHERE customer_id IS NOT NULL),
         array_agg(id ORDER BY id) FILTER (WHERE customer_id IS NULL)
    INTO v_linked, v_consignees, v_suggested
  FROM linked;
  IF v_suggested IS NOT NULL THEN
    FOREACH v_bl IN ARRAY v_suggested LOOP
      PERFORM public.recompute_bl_review_status(v_bl);
      PERFORM public.sync_customer_reconciliation_queue_for_bl(v_bl);
    END LOOP;
  END IF;
  v_bls_linked := COALESCE(cardinality(v_linked), 0);

  IF v_bls_linked > 0 THEN
    FOREACH v_bl IN ARRAY v_linked LOOP
      INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
      VALUES ('bl', v_bl, 'customer_id', NULL, v_customer_id::text, v_actor, 'Vínculo por documento pela Base de Clientes');
    END LOOP;
    -- O gate da importação captura o contato do manifesto, mas só acrescenta
    -- pendências. Quem libera a Revisão é a dona da regra (V1):
    -- `recompute_bl_review_status` (168) tira a nota "Pendencias de
    -- importacao" velha e devolve o B/L a `reviewed` quando não sobra
    -- pendência real; com pendência real (ex.: Portal não provisionado), fica
    -- só ela. A fila de Reconciliação de Cliente acompanha o vínculo.
    PERFORM public.apply_bl_review_gate_after_import(v_linked, v_actor);
    FOREACH v_bl IN ARRAY v_linked LOOP
      PERFORM public.recompute_bl_review_status(v_bl);
      PERFORM public.sync_customer_reconciliation_queue_for_bl(v_bl);
    END LOOP;
  END IF;
  PERFORM set_config('vela.bl_review_batch', COALESCE(NULLIF(v_previous_batch, ''), 'off'), true);

  IF v_bls_linked > 0 THEN
    -- Um Alerta por Cliente e um por consignatário que deixou de estar sem
    -- Cliente, já com a contagem final (como a 168 e a 170).
    PERFORM public.reconcile_customer_bl_review_alerts(v_customer_id, NULL, 'customer_base_link');
    FOREACH v_consignee IN ARRAY v_consignees LOOP
      PERFORM public.reconcile_customer_bl_review_alerts(NULL, v_consignee, 'customer_base_link');
    END LOOP;
    -- O faturamento segue: com o Cliente, as Taxas Locais são calculadas.
    FOREACH v_bl IN ARRAY v_linked LOOP
      BEGIN
        PERFORM public.calculate_bl_local_charges(v_bl, v_actor, true);
      EXCEPTION WHEN OTHERS THEN
        -- ADR 0094, B3: a linha da Base é recusada inteira.
        PERFORM public._raise_local_charge_failure(v_bl, SQLSTATE, SQLERRM);
      END;
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'customer_id', v_customer_id,
    'created', v_created,
    'contacts_created', v_contacts_created,
    'bls_linked', v_bls_linked,
    'linked_bl_ids', to_jsonb(COALESCE(v_linked, ARRAY[]::text[])),
    'bls_suggested', COALESCE(cardinality(v_suggested), 0),
    'customer_deactivated', v_deactivated,
    'contacts_skipped', NOT v_can_contacts
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.apply_demurrage_discount(p_request_id uuid, p_invoice_id bigint, p_discount_mode text, p_discount_value numeric, p_discount_type text DEFAULT NULL::text, p_discount_justification text DEFAULT NULL::text, p_discount_approver text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_payload jsonb;
  v_previous jsonb;
  v_invoice public.demurrage_invoices%ROWTYPE;
  v_mode text := NULLIF(btrim(p_discount_mode), '');
  v_type text := NULLIF(btrim(p_discount_type), '');
  v_value numeric(12,2) := CASE WHEN p_discount_value IS NULL THEN NULL ELSE round(p_discount_value, 2) END;
  v_discount_usd numeric(12,2) := 0;
  v_total_brl numeric(14,2);
  v_pix_payload text;
  v_result jsonb;
  v_justification text := NULLIF(btrim(p_discount_justification), '');
  v_exempt boolean := false;
  v_exempt_date date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND (auth.uid() IS NULL OR NOT public.is_active_user()) THEN
    RAISE EXCEPTION 'Usuário sem permissão para aplicar desconto de Demurrage.' USING ERRCODE = '42501';
  END IF;
  IF p_invoice_id IS NULL THEN
    RAISE EXCEPTION 'Fatura obrigatoria.' USING ERRCODE = '22023';
  END IF;
  IF v_mode IS NOT NULL AND v_mode NOT IN ('percent', 'fixed') THEN
    RAISE EXCEPTION 'Modo de desconto invalido.' USING ERRCODE = '22023';
  END IF;
  IF v_type IS NOT NULL AND v_type NOT IN ('comercial', 'datas', 'cortesia', 'acordo', 'erro') THEN
    RAISE EXCEPTION 'Tipo de desconto invalido.' USING ERRCODE = '22023';
  END IF;
  IF v_value IS NOT NULL AND v_value < 0 THEN
    RAISE EXCEPTION 'Desconto nao pode ser negativo.' USING ERRCODE = '22003';
  END IF;
  IF v_value IS NOT NULL AND v_mode IS NULL THEN
    RAISE EXCEPTION 'Modo de desconto obrigatorio.' USING ERRCODE = '22023';
  END IF;
  IF v_justification IS NULL THEN
    RAISE EXCEPTION 'Justificativa obrigatoria para alterar desconto.' USING ERRCODE = '22023';
  END IF;

  v_payload := jsonb_build_object(
    'invoice_id', p_invoice_id,
    'discount_mode', v_mode,
    'discount_value', v_value,
    'discount_type', v_type,
    'discount_justification', v_justification,
    'discount_approver', NULLIF(btrim(p_discount_approver), '')
  );
  v_previous := public._demurrage_mutation_request(p_request_id, 'discount', p_invoice_id, v_payload);
  IF v_previous IS NOT NULL THEN
    RETURN v_previous;
  END IF;

  SELECT * INTO v_invoice
  FROM public.demurrage_invoices
  WHERE id = p_invoice_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Demurrage invoice % nao encontrada.', p_invoice_id USING ERRCODE = 'P0002';
  END IF;
  IF v_invoice.status IN ('paid', 'cancelled') OR v_invoice.paid_at IS NOT NULL THEN
    RAISE EXCEPTION 'Desconto nao pode alterar fatura paga ou cancelada.' USING ERRCODE = '22023';
  END IF;

  IF v_value IS NULL THEN
    v_discount_usd := 0;
    v_mode := NULL;
  ELSIF v_mode = 'percent' THEN
    IF v_value > 100 THEN
      RAISE EXCEPTION 'Percentual de desconto deve ficar entre 0 e 100.' USING ERRCODE = '22003';
    END IF;
    v_discount_usd := round(v_invoice.total_usd * v_value / 100, 2);
  ELSE
    IF v_value > v_invoice.total_usd THEN
      RAISE EXCEPTION 'Desconto fixo nao pode exceder o total USD da fatura.' USING ERRCODE = '22003';
    END IF;
    v_discount_usd := v_value;
  END IF;

  -- D7: desconto que zera o USD líquido de uma Invoice emitida quita a Invoice.
  v_exempt := v_mode IS NOT NULL
    AND v_invoice.total_usd > 0
    AND v_discount_usd >= v_invoice.total_usd
    AND COALESCE(v_invoice.status, 'issued') IN ('issued', 'overdue');

  IF v_invoice.current_roe IS NOT NULL AND v_invoice.current_roe > 0 THEN
    v_total_brl := round(greatest(v_invoice.total_usd - v_discount_usd, 0) * v_invoice.current_roe, 2);
    v_pix_payload := CASE WHEN v_total_brl > 0 THEN public.build_transshipping_pix_payload(v_total_brl, v_invoice.doc_number) ELSE NULL END;
  ELSE
    v_total_brl := NULL;
    v_pix_payload := NULL;
  END IF;
  IF v_exempt THEN
    v_total_brl := 0;
    v_pix_payload := NULL;
  END IF;

  UPDATE public.demurrage_invoices
  SET discount_type = v_type,
      discount_value = CASE WHEN v_value IS NULL THEN NULL ELSE v_value END,
      discount_mode = v_mode,
      discount_justification = v_justification,
      discount_approver = NULLIF(btrim(p_discount_approver), ''),
      current_total_brl = v_total_brl,
      pix_payload = v_pix_payload,
      status = CASE WHEN v_exempt THEN 'paid' ELSE status END,
      paid_at = CASE WHEN v_exempt THEN v_exempt_date ELSE paid_at END,
      updated_at = now()
  WHERE id = p_invoice_id;

  IF v_invoice.current_roe IS NOT NULL AND v_invoice.current_roe > 0 THEN
    INSERT INTO public.demurrage_invoice_history
      (invoice_id, event_date, ptax_used, roe_used, total_usd, total_brl, discount_usd, source)
    VALUES
      (p_invoice_id, v_exempt_date,
       public._demurrage_ptax_from_roe(v_invoice.current_roe), v_invoice.current_roe,
       v_invoice.total_usd, v_total_brl, v_discount_usd, CASE WHEN v_exempt THEN 'payment' ELSE 'manual' END);
  END IF;

  INSERT INTO public.audit_logs(
    entity_type, entity_id, field_name, old_value, new_value,
    changed_by, changed_at, justification
  ) VALUES (
    'demurrage_invoice', p_invoice_id::text, 'discount',
    jsonb_build_object('mode', v_invoice.discount_mode, 'value', v_invoice.discount_value)::text,
    v_payload::text, auth.uid(), now(), v_justification
  );

  IF v_exempt THEN
    INSERT INTO public.audit_logs(
      entity_type, entity_id, field_name, old_value, new_value,
      changed_by, changed_at, justification
    ) VALUES (
      'demurrage_invoice', p_invoice_id::text, 'discount_exemption',
      v_invoice.status,
      jsonb_build_object('status', 'paid', 'paid_at', v_exempt_date, 'total_brl', 0)::text,
      auth.uid(), now(), v_justification
    );
  END IF;

  v_result := jsonb_build_object(
    'invoice_id', p_invoice_id,
    'discount_usd', v_discount_usd,
    'current_total_brl', v_total_brl,
    'pix_payload', v_pix_payload,
    'status', CASE WHEN v_exempt THEN 'paid' ELSE v_invoice.status END,
    'exempted', v_exempt,
    'idempotent', false
  );
  INSERT INTO public.demurrage_mutation_requests(request_id, operation, invoice_id, request_payload, result, created_by)
  VALUES (p_request_id, 'discount', p_invoice_id, v_payload, v_result, auth.uid())
  ON CONFLICT (request_id) DO NOTHING;
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.approve_customer_reconciliation(p_queue_id bigint, p_customer_id bigint DEFAULT NULL::bigint, p_notes text DEFAULT NULL::text, p_actor uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_queue RECORD;
  v_actor UUID;
  v_target_customer_id BIGINT;
  v_financial_status TEXT;
  v_calculation_error TEXT;
BEGIN
  -- O autor é quem está logado (ADR 0085, regra base 2; migration 241).
  PERFORM public._assert_actor_is_caller(p_actor);
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuário sem permissão ativa' USING ERRCODE = '42501';
  END IF;

  IF NOT public.is_admin() AND p_actor IS NOT NULL AND p_actor IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'O ator informado deve ser o usuario autenticado.' USING ERRCODE = '42501';
  END IF;
  v_actor := CASE WHEN public.is_admin() THEN COALESCE(p_actor, auth.uid()) ELSE auth.uid() END;

  SELECT * INTO v_queue
  FROM public.customer_reconciliation_queue
  WHERE id = p_queue_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item de reconciliacao % nao encontrado.', p_queue_id USING ERRCODE = 'P0002';
  END IF;

  v_target_customer_id := COALESCE(p_customer_id, v_queue.customer_id);
  IF v_target_customer_id IS NULL THEN
    RAISE EXCEPTION 'Informe um cliente para aprovar a reconciliacao.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.bls
  SET
    customer_id = v_target_customer_id,
    suggested_customer_id = NULL,
    customer_reconciliation_status = 'reconciled',
    customer_reconciliation_notes = COALESCE(NULLIF(TRIM(COALESCE(p_notes, '')), ''), 'Cliente reconciliado manualmente.'),
    billing_hold_reason = NULL
  WHERE id = v_queue.bl_id;

  UPDATE public.customer_reconciliation_queue
  SET
    customer_id = v_target_customer_id,
    status = 'approved',
    resolution_notes = COALESCE(NULLIF(TRIM(COALESCE(p_notes, '')), ''), 'Cliente reconciliado manualmente.'),
    approved_by = v_actor,
    approved_at = now(),
    rejected_by = NULL,
    rejected_at = NULL
  WHERE id = p_queue_id;

  PERFORM public.capture_manifest_financial_contact(
    v_target_customer_id,
    v_queue.manifest_customer_email
  );

  PERFORM public.sync_customer_reconciliation_queue_for_bl(v_queue.bl_id);

  -- Se o B/L ainda nao foi faturado, recalcula as taxas locais com as condicoes
  -- especiais do novo cliente vinculado e gera o recebivel no ledger (bl_receivables)
  SELECT financial_status INTO v_financial_status
  FROM public.bls
  WHERE id = v_queue.bl_id;

  IF v_financial_status IS NULL OR v_financial_status = 'pending' THEN
    BEGIN
      PERFORM public.calculate_bl_local_charges(v_queue.bl_id, v_actor, true);
    EXCEPTION WHEN OTHERS THEN
      PERFORM public._raise_local_charge_failure(v_queue.bl_id, SQLSTATE, SQLERRM);
    END;
  END IF;

  INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification)
  VALUES (
    'bl', v_queue.bl_id, 'customer_reconciliation_status', COALESCE(v_queue.status, 'pending'), 'reconciled',
    v_actor, now(), COALESCE(NULLIF(TRIM(COALESCE(p_notes, '')), ''), 'Cliente reconciliado manualmente.')
  );

  RETURN jsonb_build_object(
    'queue_id', p_queue_id,
    'bl_id', v_queue.bl_id,
    'customer_id', v_target_customer_id,
    'status', 'approved',
    'calculation_error', v_calculation_error
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.assert_voyage_escala_ready_for_report_close(p_voyage_id bigint, p_port text, p_report_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_port TEXT := upper(btrim(COALESCE(p_port, '')));
  v_port_id BIGINT;
  v_report RECORD;
  v_terminal_code TEXT;
  v_terminal_tipo TEXT;
  v_terminal_port_id BIGINT;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_read_user() THEN
    RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501';
  END IF;

  SELECT p.id
  INTO v_port_id
  FROM public.ports AS p
  WHERE upper(btrim(p.locode)) = v_port
    AND upper(btrim(p.locode)) LIKE 'BR%'
  ORDER BY p.id
  LIMIT 1;
  IF v_port_id IS NULL THEN
    RAISE EXCEPTION 'Porto brasileiro % nao encontrado.', v_port USING ERRCODE = 'P0002';
  END IF;

  PERFORM 1 FROM public.voyages WHERE id = p_voyage_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Viagem nao encontrada.' USING ERRCODE = 'P0002';
  END IF;

  SELECT r.id, r.voyage_id, r.port, r.terminal_id, r.terminal_port_id
  INTO v_report
  FROM public.agency_departure_reports AS r
  WHERE r.id = p_report_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'report_id nao pertence a escala %::%.', p_voyage_id, v_port
      USING ERRCODE = '23514';
  END IF;
  IF v_report.voyage_id <> p_voyage_id
     OR upper(btrim(v_report.port)) <> v_port THEN
    RAISE EXCEPTION 'report_id nao pertence a escala %::%.', p_voyage_id, v_port
      USING ERRCODE = '23514';
  END IF;

  SELECT d.code, d.tipo, d.port_id
  INTO v_terminal_code, v_terminal_tipo, v_terminal_port_id
  FROM public.depots AS d
  WHERE d.id = v_report.terminal_id;
  IF v_report.terminal_id IS NULL OR v_report.terminal_port_id IS NULL THEN
    RAISE EXCEPTION 'report_id deve referenciar ADR terminalizado do porto %.', v_port
      USING ERRCODE = '23514';
  END IF;
  IF v_terminal_tipo IS DISTINCT FROM 'terminal_portuario'
     OR v_terminal_port_id IS DISTINCT FROM v_port_id
     OR v_report.terminal_port_id IS DISTINCT FROM v_port_id THEN
    RAISE EXCEPTION 'report_id deve referenciar ADR terminalizado do porto %.', v_port
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.voyage_escala_operation_fronts AS f
    WHERE f.voyage_id = p_voyage_id AND f.port = v_port AND f.terminal_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Frente TBC impede o fechamento do ADR.'
      USING ERRCODE = '23514', DETAIL = 'Atribua todas as frentes a um terminal antes do fechamento.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.voyage_escala_operation_fronts AS f
    WHERE f.voyage_id = p_voyage_id AND f.port = v_port
      AND f.terminal_id = v_report.terminal_id
  ) THEN
    RAISE EXCEPTION 'ADR % nao corresponde a terminal atribuido na escala.', v_terminal_code
      USING ERRCODE = '23514';
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.backfill_invoice_receivable_links(p_limit integer DEFAULT 5000)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_inserted INTEGER := 0;
  v_missing_receivables INTEGER := 0;
  v_total_mismatches INTEGER := 0;
  v_exceptions JSONB := '[]'::jsonb;
  v_mismatch_examples JSONB := '[]'::jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Usuário sem permissão de faturamento.' USING ERRCODE = '42501';
  END IF;

  WITH invoice_bl_counts AS (
    SELECT invoice_id, COUNT(*) AS bl_count
    FROM public.invoice_bls
    GROUP BY invoice_id
  )
  UPDATE public.invoices i
  SET invoice_type = CASE WHEN COALESCE(c.bl_count, 1) > 1 THEN 'consolidated' ELSE 'individual' END
  FROM invoice_bl_counts c
  WHERE c.invoice_id = i.id
    AND i.invoice_type = 'individual';

  SELECT COUNT(*)
  INTO v_missing_receivables
  FROM public.invoice_bls ib
  LEFT JOIN public.bl_receivables br ON br.source = 'local_charges' AND br.bl_id = ib.bl_id
  WHERE br.id IS NULL;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'invoice_id', missing.invoice_id,
    'bl_id', missing.bl_id,
    'error', 'missing_receivable'
  )), '[]'::jsonb)
  INTO v_exceptions
  FROM (
    SELECT ib.invoice_id, ib.bl_id
    FROM public.invoice_bls ib
    LEFT JOIN public.bl_receivables br ON br.source = 'local_charges' AND br.bl_id = ib.bl_id
    WHERE br.id IS NULL
    ORDER BY ib.id DESC
    LIMIT 50
  ) AS missing;

  WITH inserted AS (
    INSERT INTO public.invoice_receivable_links (
      invoice_id,
      receivable_id,
      bl_id,
      subtotal_brl,
      status,
      bl_snapshot
    )
    SELECT
      ib.invoice_id,
      br.id,
      ib.bl_id,
      COALESCE(ib.subtotal_brl, br.original_amount_brl, 0),
      CASE
        WHEN COALESCE(i.status, 'issued') = 'paid' THEN 'settled_by_this_invoice'
        WHEN COALESCE(i.status, 'issued') = 'cancelled' THEN 'obsolete'
        ELSE 'active'
      END,
      jsonb_build_object(
        'bl_id', b.id,
        'voyage_id', b.voyage_id,
        'cargo_mode', b.cargo_mode,
        'pol', b.pol,
        'pod', b.pod
      )
    FROM public.invoice_bls ib
    JOIN public.invoices i ON i.id = ib.invoice_id
    JOIN public.bl_receivables br ON br.source = 'local_charges' AND br.bl_id = ib.bl_id
    JOIN public.bls b ON b.id = ib.bl_id
    ORDER BY ib.id DESC
    LIMIT GREATEST(COALESCE(p_limit, 5000), 1)
    ON CONFLICT (invoice_id, receivable_id)
    DO UPDATE SET
      subtotal_brl = EXCLUDED.subtotal_brl,
      status = EXCLUDED.status,
      bl_snapshot = EXCLUDED.bl_snapshot
    RETURNING id
  )
  SELECT COUNT(*) INTO v_inserted FROM inserted;

  SELECT COUNT(*)
  INTO v_total_mismatches
  FROM public.invoice_receivable_links irl
  JOIN public.invoice_bls ib ON ib.invoice_id = irl.invoice_id AND ib.bl_id = irl.bl_id
  WHERE ABS(COALESCE(irl.subtotal_brl, 0) - COALESCE(ib.subtotal_brl, 0)) > 0.01;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'invoice_id', mismatch.invoice_id,
    'bl_id', mismatch.bl_id,
    'error', 'total_mismatch',
    'invoice_bl_subtotal_brl', mismatch.invoice_bl_subtotal_brl,
    'link_subtotal_brl', mismatch.link_subtotal_brl
  )), '[]'::jsonb)
  INTO v_mismatch_examples
  FROM (
    SELECT
      irl.invoice_id,
      irl.bl_id,
      COALESCE(ib.subtotal_brl, 0) AS invoice_bl_subtotal_brl,
      COALESCE(irl.subtotal_brl, 0) AS link_subtotal_brl
    FROM public.invoice_receivable_links irl
    JOIN public.invoice_bls ib ON ib.invoice_id = irl.invoice_id AND ib.bl_id = irl.bl_id
    WHERE ABS(COALESCE(irl.subtotal_brl, 0) - COALESCE(ib.subtotal_brl, 0)) > 0.01
    ORDER BY irl.id DESC
    LIMIT 50
  ) AS mismatch;

  v_exceptions := v_exceptions || v_mismatch_examples;

  RETURN jsonb_build_object(
    'links_upserted', v_inserted,
    'missing_receivables', v_missing_receivables,
    'total_mismatches', v_total_mismatches,
    'exceptions', v_exceptions
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.backfill_local_charge_receivables(p_limit integer DEFAULT 5000)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_row RECORD;
  v_receivable_id BIGINT;
  v_actual_amount NUMERIC(14,2);
  v_synced INTEGER := 0;
  v_skipped INTEGER := 0;
  v_total_mismatches INTEGER := 0;
  v_exceptions JSONB := '[]'::jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Usuário sem permissão de faturamento.' USING ERRCODE = '42501';
  END IF;

  FOR v_row IN
    SELECT
      b.id,
      COALESCE(SUM(COALESCE(cc.total_value_brl, 0)), 0)::NUMERIC(14,2) AS expected_amount
    FROM public.bls b
    JOIN public.charge_calculations cc ON cc.bl_id = b.id
    WHERE b.customer_id IS NOT NULL
      AND COALESCE(cc.total_value_brl, 0) > 0
      AND COALESCE(cc.status, 'calculated') IN ('calculated', 'reviewed', 'ready_for_billing', 'exempt')
    GROUP BY b.id, b.created_at
    ORDER BY b.created_at DESC
    LIMIT GREATEST(COALESCE(p_limit, 5000), 1)
  LOOP
    BEGIN
      v_receivable_id := public.sync_local_charge_receivable(v_row.id);
      SELECT original_amount_brl INTO v_actual_amount
      FROM public.bl_receivables
      WHERE id = v_receivable_id;

      v_synced := v_synced + 1;

      IF ABS(COALESCE(v_actual_amount, 0) - COALESCE(v_row.expected_amount, 0)) > 0.01 THEN
        v_total_mismatches := v_total_mismatches + 1;
        v_exceptions := v_exceptions || jsonb_build_array(jsonb_build_object(
          'bl_id', v_row.id,
          'error', 'total_mismatch',
          'expected_amount_brl', v_row.expected_amount,
          'actual_amount_brl', v_actual_amount
        ));
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_skipped := v_skipped + 1;
      v_exceptions := v_exceptions || jsonb_build_array(jsonb_build_object(
        'bl_id', v_row.id,
        'error', SQLERRM,
        'sqlstate', SQLSTATE
      ));
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'synced', v_synced,
    'skipped', v_skipped,
    'total_mismatches', v_total_mismatches,
    'exceptions', v_exceptions
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.bl_file_import_preview(p_voyage_id bigint, p_bl_ids text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET statement_timeout TO '60s'
AS $function$
DECLARE
  v_bl record;
  v_rows jsonb := '[]'::jsonb;
  v_invoiced boolean;
  v_before jsonb;
  v_after jsonb;
  v_refix jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuário sem permissão ativa.' USING ERRCODE = '42501';
  END IF;
  FOR v_bl IN
    SELECT b.id, b.voyage_id, b.cancelled_at FROM public.bls b
    WHERE b.id = ANY(COALESCE(p_bl_ids, ARRAY[]::text[])) ORDER BY b.id
  LOOP
    v_invoiced := public._bl_has_emitted_local_invoice(v_bl.id);
    v_refix := NULL;
    IF v_bl.voyage_id = p_voyage_id AND v_bl.cancelled_at IS NULL AND NOT v_invoiced
       AND EXISTS (SELECT 1 FROM public.bl_price_freezes f WHERE f.bl_id = v_bl.id) THEN
      v_before := public._bl_price_snapshot(v_bl.id);
      v_after := NULL;
      BEGIN
        DELETE FROM public.bl_price_freeze_items WHERE bl_id = v_bl.id;
        DELETE FROM public.bl_price_freezes WHERE bl_id = v_bl.id;
        DELETE FROM public.bl_charge_table_links WHERE bl_id = v_bl.id;
        PERFORM public._calculate_bl_local_charges_impl_106(v_bl.id, auth.uid(), true);
        v_after := public._bl_price_snapshot(v_bl.id);
        RAISE EXCEPTION 'probe' USING ERRCODE = 'VL392';
      EXCEPTION
        WHEN SQLSTATE 'VL392' THEN NULL;
        WHEN OTHERS THEN v_after := jsonb_build_object('error', SQLERRM);
      END;
      IF v_after ? 'error' THEN
        v_refix := jsonb_build_object('before', v_before, 'after', v_after, 'differs', false);
      ELSE
        v_refix := jsonb_build_object('before', v_before, 'after', v_after,
          'differs', (v_before->'tables') IS DISTINCT FROM (v_after->'tables')
            OR (v_before->'condition_items') IS DISTINCT FROM (v_after->'condition_items')
            OR (v_before->'roe') IS DISTINCT FROM (v_after->'roe')
            OR (v_before->'total_brl') IS DISTINCT FROM (v_after->'total_brl'));
      END IF;
    END IF;
    v_rows := v_rows || jsonb_build_object(
      'bl_id', v_bl.id,
      'voyage_id', v_bl.voyage_id,
      'voyage_label', public._voyage_label(v_bl.voyage_id),
      'cancelled', v_bl.cancelled_at IS NOT NULL,
      'invoiced', v_invoiced,
      'refix', v_refix);
  END LOOP;
  RETURN v_rows;
END;
$function$;

CREATE OR REPLACE FUNCTION public.calculate_bl_local_charges_batch(p_bl_ids text[], p_actor uuid DEFAULT NULL::uuid, p_recalculate boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bl_id text;
  v_actor uuid;
  v_results jsonb := '[]'::jsonb;
  v_total integer := 0;
  v_success_count integer := 0;
  v_error_count integer := 0;
  v_errors jsonb := '[]'::jsonb;
  v_res jsonb;
BEGIN
  -- O autor é quem está logado (ADR 0085, regra base 2; migration 241).
  PERFORM public._assert_actor_is_caller(p_actor);
  IF auth.uid() IS NOT NULL AND NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuário sem permissão ativa' USING ERRCODE = '42501';
  END IF;

  IF auth.uid() IS NOT NULL
     AND NOT public.is_admin()
     AND p_actor IS NOT NULL
     AND p_actor IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'O ator informado deve ser o usuario autenticado.' USING ERRCODE = '42501';
  END IF;
  v_actor := CASE WHEN auth.uid() IS NOT NULL AND NOT public.is_admin() THEN auth.uid() ELSE COALESCE(p_actor, auth.uid()) END;

  IF p_bl_ids IS NULL OR cardinality(p_bl_ids) = 0 THEN
    RETURN jsonb_build_object(
      'total', 0,
      'success_count', 0,
      'error_count', 0,
      'results', '[]'::jsonb,
      'errors', '[]'::jsonb
    );
  END IF;

  IF cardinality(p_bl_ids) > 100 THEN
    RAISE EXCEPTION 'O lote de calculo aceita no maximo 100 B/Ls por chamada.'
      USING ERRCODE = '22023';
  END IF;

  FOREACH v_bl_id IN ARRAY p_bl_ids LOOP
    v_bl_id := btrim(v_bl_id);
    CONTINUE WHEN v_bl_id IS NULL OR v_bl_id = '';
    v_total := v_total + 1;
    BEGIN
      v_res := public.calculate_bl_local_charges(v_bl_id, v_actor, p_recalculate);
      v_results := v_results || jsonb_build_array(v_res);
      v_success_count := v_success_count + 1;
    EXCEPTION WHEN OTHERS THEN
      v_error_count := v_error_count + 1;
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'bl_id', v_bl_id,
        'message', SQLERRM
      ));
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'total', v_total,
    'success_count', v_success_count,
    'error_count', v_error_count,
    'results', v_results,
    'errors', v_errors
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.cancel_demurrage_invoice(p_request_id uuid, p_invoice_id bigint, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_payload jsonb := jsonb_build_object('invoice_id', p_invoice_id, 'reason', NULLIF(btrim(p_reason), ''));
  v_previous jsonb;
  v_invoice public.demurrage_invoices%ROWTYPE;
  v_result jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND (auth.uid() IS NULL OR NOT public.is_admin()) THEN
    RAISE EXCEPTION 'Usuário sem permissão para cancelar Demurrage.' USING ERRCODE = '42501';
  END IF;
  IF NULLIF(btrim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'Justificativa obrigatoria para cancelar a fatura.' USING ERRCODE = '22023';
  END IF;
  v_previous := public._demurrage_mutation_request(p_request_id, 'cancel', p_invoice_id, v_payload);
  IF v_previous IS NOT NULL THEN RETURN v_previous; END IF;

  SELECT * INTO v_invoice FROM public.demurrage_invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Demurrage invoice % nao encontrada.', p_invoice_id USING ERRCODE = 'P0002'; END IF;
  IF v_invoice.status = 'paid' THEN RAISE EXCEPTION 'Fatura paga deve ser estornada antes do cancelamento.' USING ERRCODE = '22023'; END IF;
  IF v_invoice.status = 'cancelled' THEN RETURN jsonb_build_object('invoice_id', p_invoice_id, 'status', 'cancelled', 'idempotent', true); END IF;

  UPDATE public.demurrage_invoices SET status = 'cancelled', updated_at = now() WHERE id = p_invoice_id;
  INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification)
  VALUES ('demurrage_invoice', p_invoice_id::text, 'status', v_invoice.status, 'cancelled', auth.uid(), now(), btrim(p_reason));
  v_result := jsonb_build_object('invoice_id', p_invoice_id, 'status', 'cancelled', 'idempotent', false);
  INSERT INTO public.demurrage_mutation_requests(request_id, operation, invoice_id, request_payload, result, created_by)
  VALUES (p_request_id, 'cancel', p_invoice_id, v_payload, v_result, auth.uid()) ON CONFLICT (request_id) DO NOTHING;
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.cancel_invoice(p_invoice_id bigint, p_reason text, p_actor uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_effect_consumer boolean := auth.role() = 'service_role'
    AND current_setting('import_effects.consumer', true) = 'vehicle_followup';
  v_consolidated text;
BEGIN
  -- O autor é quem está logado (ADR 0085, regra base 2; migration 241).
  PERFORM public._assert_actor_is_caller(p_actor);
  IF NOT v_effect_consumer
     AND (auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin()) THEN
    RAISE EXCEPTION 'Usuário sem permissão de faturamento.'
      USING ERRCODE = '42501';
  END IF;

  IF NULLIF(TRIM(COALESCE(p_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Informe a justificativa para cancelar a invoice.'
      USING ERRCODE = '22023';
  END IF;

  -- Individual coberta por consolidada aberta: cancelar só a individual deixaria
  -- a consolidada cobrando o valor antigo e o B/L livre para nova fatura.
  SELECT inv.invoice_number INTO v_consolidated
  FROM public.invoices own_inv
  JOIN public.invoice_receivable_links own ON own.invoice_id = own_inv.id
  JOIN public.invoice_receivable_links l ON l.receivable_id = own.receivable_id AND l.invoice_id <> own.invoice_id
  JOIN public.invoices inv ON inv.id = l.invoice_id
  WHERE own_inv.id = p_invoice_id
    AND COALESCE(own_inv.invoice_type, 'individual') = 'individual'
    AND COALESCE(own_inv.status, 'issued') <> 'cancelled'
    AND inv.invoice_type = 'consolidated'
    AND COALESCE(inv.status, 'issued') IN ('draft', 'issued', 'partially_paid', 'overdue')
  ORDER BY inv.id DESC
  LIMIT 1;
  IF v_consolidated IS NOT NULL THEN
    RAISE EXCEPTION 'Este B/L esta na consolidada %; cancele ou reemita pela consolidada.', v_consolidated
      USING ERRCODE = '22023';
  END IF;

  RETURN public._cancel_invoice_core(p_invoice_id, p_reason, COALESCE(p_actor, auth.uid()));
END;
$function$;

CREATE OR REPLACE FUNCTION public.charge_tables_in_use(p_table_ids bigint[])
 RETURNS bigint[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_read_user() THEN
    RAISE EXCEPTION 'Usuário sem permissão ativa.' USING ERRCODE = '42501';
  END IF;
  IF cardinality(COALESCE(p_table_ids, ARRAY[]::bigint[])) > 500 THEN
    RAISE EXCEPTION 'Tabelas demais numa consulta: peça até 500.' USING ERRCODE = '22023';
  END IF;
  RETURN ARRAY(
    SELECT DISTINCT t.id
    FROM unnest(COALESCE(p_table_ids, ARRAY[]::bigint[])) AS t(id)
    WHERE t.id IS NOT NULL AND public.charge_table_in_use(t.id)
    ORDER BY t.id
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.check_portal_rate_limit(p_action_name text, p_max_attempts integer DEFAULT 5, p_window_minutes integer DEFAULT 5)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_customer_id BIGINT := public.current_portal_customer_id();
  v_cutoff TIMESTAMPTZ;
  v_count INT;
BEGIN
  IF p_max_attempts IS NULL OR p_max_attempts <= 0 OR p_window_minutes IS NULL OR p_window_minutes <= 0 THEN
    RAISE EXCEPTION 'Limite de tentativas inválido.' USING ERRCODE = '22023';
  END IF;
  v_cutoff := now() - (p_window_minutes * INTERVAL '1 minute');

  -- Limpa entradas antigas
  DELETE FROM public.portal_rate_limits
  WHERE customer_id = v_customer_id
    AND action_name = p_action_name
    AND attempted_at < v_cutoff;

  -- Conta tentativas na janela
  SELECT COUNT(*) INTO v_count
  FROM public.portal_rate_limits
  WHERE customer_id = v_customer_id
    AND action_name = p_action_name
    AND attempted_at >= v_cutoff;

  IF v_count >= p_max_attempts THEN
    RAISE EXCEPTION 'Limite de tentativas excedido para esta ação. Aguarde % minuto(s) antes de tentar novamente.', p_window_minutes
      USING ERRCODE = 'P0429';
  END IF;

  -- Registra tentativa
  INSERT INTO public.portal_rate_limits (customer_id, action_name)
  VALUES (v_customer_id, p_action_name);

  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.close_agency_departure_report(p_voyage_id bigint, p_port text, p_snapshot jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_report_id UUID;
  v_signed_departments INTEGER;
  v_unknown_sections TEXT[];
  v_unknown_top_level TEXT[];
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501';
  END IF;
  IF p_snapshot IS NULL OR jsonb_typeof(p_snapshot) <> 'object'
     OR jsonb_typeof(p_snapshot->'header') <> 'object'
     OR jsonb_typeof(p_snapshot->'sections') <> 'object'
     OR jsonb_typeof(p_snapshot->'occurrences') <> 'array'
     OR jsonb_typeof(p_snapshot->'signoffs') <> 'array'
     OR octet_length(p_snapshot::text) > 8388608 THEN
    RAISE EXCEPTION 'Snapshot invalido: esperado objeto com header, sections, occurrences e signoffs (maximo 8 MiB).' USING ERRCODE = '22023';
  END IF;

  SELECT array_agg(key ORDER BY key) INTO v_unknown_top_level
  FROM jsonb_object_keys(p_snapshot) AS key
  WHERE key NOT IN ('header', 'sections', 'occurrences', 'signoffs', 'departmentSignoffs');
  IF v_unknown_top_level IS NOT NULL THEN
    RAISE EXCEPTION 'Snapshot possui chaves de topo desconhecidas: %.', array_to_string(v_unknown_top_level, ', ')
      USING ERRCODE = '22023';
  END IF;

  SELECT array_agg(key ORDER BY key) INTO v_unknown_sections
  FROM jsonb_object_keys(p_snapshot->'sections') AS key
  WHERE key NOT IN (
    'cargaDescarregada', 'cargaSolta', 'vaziosDescarregados', 'veiculos',
    'vaziosEmbarcados', 'vaziosUnidades', 'vehicleLocations', 'vehicleBreakdown',
    'depots', 'directEmbarkCount', 'granito', 'storage', 'operation', 'costs'
  );
  IF v_unknown_sections IS NOT NULL THEN
    RAISE EXCEPTION 'Snapshot possui secoes desconhecidas: %.', array_to_string(v_unknown_sections, ', ')
      USING ERRCODE = '22023';
  END IF;

  v_report_id := public.ensure_agency_departure_report(p_voyage_id, p_port);
  SELECT id INTO v_report_id
  FROM public.agency_departure_reports
  WHERE id = v_report_id
  FOR UPDATE;

  SELECT COUNT(*) INTO v_signed_departments
  FROM public.agency_departure_report_department_signoffs
  WHERE report_id = v_report_id AND signed_at IS NOT NULL;
  IF v_signed_departments <> 3 THEN
    RAISE EXCEPTION 'Fechamento exige os 3 departamentos assinados (% pendentes).', 3 - v_signed_departments
      USING ERRCODE = '23514';
  END IF;

  UPDATE public.agency_departure_reports
  SET status = 'closed', closed_at = now(), closed_by = auth.uid(), closed_snapshot = p_snapshot
  WHERE id = v_report_id AND status = 'open';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ADR ja fechado.' USING ERRCODE = '23505';
  END IF;

  -- 'agency_report_section_pending' e obsoleto (migration 225 introduz
  -- 'agency_report_department_pending', ja fechado por departamento no
  -- signoff); mantido aqui so para alertas legados pre-0029.
  UPDATE public.alerts
  SET status = 'closed', closed_at = now()
  WHERE type = 'agency_report_section_pending'
    AND entity_type = 'agency_departure_report'
    -- Prefixo literal: '%' e '_' no porto não viram curinga.
    AND starts_with(entity_id, p_voyage_id::text || '::' || upper(btrim(p_port)) || '::')
    AND status <> 'closed';

  -- ADR 0039: fecha os alertas de vencimento do prazo junto com o Fechamento.
  -- Chegar aqui exige os 3 departamentos assinados, entao todo alerta de
  -- vencimento desta escala ja deveria estar sem motivo; este UPDATE e uma
  -- rede de seguranca (ex.: alerta detectado entre o ultimo sign-off e o
  -- clique de Fechar).
  UPDATE public.alerts
  SET status = 'closed', closed_at = now()
  WHERE type = 'agency_report_deadline_missed'
    AND entity_type = 'agency_departure_report'
    -- Prefixo literal: '%' e '_' no porto não viram curinga.
    AND starts_with(entity_id, p_voyage_id::text || '::' || upper(btrim(p_port)) || '::')
    AND status <> 'closed';

  RETURN jsonb_build_object('report_id', v_report_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.close_agency_departure_report_by_report_id(p_report_id uuid, p_voyage_id bigint, p_port text, p_snapshot jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_report RECORD;
  v_signed INTEGER;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501'; END IF;
  PERFORM public.assert_voyage_escala_ready_for_report_close(p_voyage_id, p_port, p_report_id);
  SELECT * INTO v_report FROM public.agency_departure_reports WHERE id = p_report_id FOR UPDATE;
  IF v_report.voyage_id <> p_voyage_id OR upper(btrim(v_report.port)) <> upper(btrim(p_port)) OR v_report.terminal_id IS NULL THEN
    RAISE EXCEPTION 'report_id nao pertence a ADR terminalizado da escala %::%.', p_voyage_id, upper(btrim(p_port)) USING ERRCODE = '23514';
  END IF;
  IF p_snapshot IS NULL OR jsonb_typeof(p_snapshot) <> 'object' OR jsonb_typeof(p_snapshot->'header') <> 'object'
     OR jsonb_typeof(p_snapshot->'sections') <> 'object' OR jsonb_typeof(p_snapshot->'occurrences') <> 'array'
     OR jsonb_typeof(p_snapshot->'signoffs') <> 'array' OR octet_length(p_snapshot::TEXT) > 8388608 THEN
    RAISE EXCEPTION 'Snapshot invalido.' USING ERRCODE = '22023';
  END IF;
  SELECT COUNT(*) INTO v_signed FROM public.agency_departure_report_department_signoffs
  WHERE report_id = p_report_id AND signed_at IS NOT NULL;
  IF v_signed <> 3 THEN RAISE EXCEPTION 'Fechamento exige os 3 departamentos assinados (% pendentes).', 3 - v_signed USING ERRCODE = '23514'; END IF;
  UPDATE public.agency_departure_reports SET status = 'closed', closed_at = now(), closed_by = auth.uid(), closed_snapshot = p_snapshot
  WHERE id = p_report_id AND status = 'open';
  IF NOT FOUND THEN RAISE EXCEPTION 'ADR ja fechado.' USING ERRCODE = '23505'; END IF;
  UPDATE public.alerts SET status = 'closed', closed_at = now()
  WHERE type IN ('agency_report_section_pending', 'agency_report_department_pending', 'agency_report_deadline_missed')
    AND entity_type = 'agency_departure_report'
    AND entity_id LIKE public.agency_report_alert_entity_prefix(
      v_report.voyage_id,
      v_report.port,
      (SELECT d.code FROM public.depots AS d WHERE d.id = v_report.terminal_id)
    ) || '%'
    AND status <> 'closed';
  RETURN jsonb_build_object('report_id', p_report_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.confirm_demurrage_pix_matches(p_matches jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  r record;
  v_count integer := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_financeiro_user() THEN
    RAISE EXCEPTION 'Usuário sem permissão para conciliar Demurrage.' USING ERRCODE = '42501';
  END IF;
  IF p_matches IS NULL OR jsonb_typeof(p_matches) <> 'array' THEN
    RAISE EXCEPTION 'Lista de conciliacao invalida.' USING ERRCODE = '22023';
  END IF;
  FOR r IN SELECT * FROM jsonb_to_recordset(p_matches) AS x(invoice_id bigint, paid_at date, pix_txid text, total_brl numeric, ptax_used numeric)
  LOOP
    PERFORM public.register_demurrage_payment(gen_random_uuid(), r.invoice_id, r.paid_at, r.pix_txid, r.total_brl, r.ptax_used);
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.confirm_unified_pix_matches(p_matches jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_item RECORD;
  v_result JSONB;
  v_items JSONB := '[]'::jsonb;
  v_local_count INTEGER := 0;
  v_demurrage_count INTEGER := 0;
  v_demurrage_updates JSONB := '[]'::jsonb;
  v_updated_demurrage INTEGER := 0;
  v_paid_date DATE;
  v_match_brl NUMERIC;
  v_match_ptax NUMERIC;
BEGIN
  -- Conciliar é do Financeiro e do Administrativo (ADR 0085, D5).
  IF auth.uid() IS NULL OR NOT public.is_financeiro_user() THEN
    RAISE EXCEPTION 'Usuário sem permissão para a conciliação de Pix.' USING ERRCODE = '42501';
  END IF;
  FOR v_item IN
    SELECT *
    FROM jsonb_to_recordset(p_matches) AS row(
      source TEXT,
      invoice_id BIGINT,
      doc_number TEXT,
      txid TEXT,
      amount NUMERIC,
      expected_amount NUMERIC,
      paid_at TIMESTAMPTZ
    )
  LOOP
    IF v_item.paid_at IS NULL THEN
      RAISE EXCEPTION 'Data do extrato nao parseada para %.', COALESCE(v_item.doc_number, v_item.txid, v_item.invoice_id::TEXT)
        USING ERRCODE = '22007';
    END IF;

    IF v_item.source = 'local' THEN
      v_result := public.reconcile_invoice_payment_by_txid(v_item.txid, v_item.amount, v_item.paid_at);
      IF COALESCE((v_result->>'matched')::BOOLEAN, false) IS NOT TRUE
         OR COALESCE((v_result->>'settled')::BOOLEAN, false) IS NOT TRUE THEN
        RAISE EXCEPTION 'Falha ao conciliar fatura local %: %.',
          COALESCE(v_item.doc_number, v_item.txid),
          COALESCE(v_result->>'reason', 'erro desconhecido')
          USING ERRCODE = 'P0001';
      END IF;
      v_local_count := v_local_count + 1;
      v_items := v_items || jsonb_build_array(jsonb_build_object(
        'source', 'local', 'invoice_id', v_item.invoice_id, 'doc_number', v_item.doc_number, 'status', 'ok'));

    ELSIF v_item.source = 'demurrage' THEN
      v_paid_date := (v_item.paid_at AT TIME ZONE 'UTC')::date;

      -- Janela das duas PTAX mais recentes com event_date <= data do pagamento.
      SELECT w.total_brl, w.ptax_used
      INTO v_match_brl, v_match_ptax
      FROM public.get_demurrage_recent_values(v_item.invoice_id, v_paid_date) AS w
      WHERE ABS(w.total_brl - COALESCE(v_item.amount, 0)) <= 0.01
      ORDER BY w.event_date DESC
      LIMIT 1;

      IF NOT FOUND THEN
        -- Fallback: sem histórico (legado) compara com o valor corrente.
        SELECT d.current_total_brl, public._demurrage_ptax_from_roe(d.current_roe)
        INTO v_match_brl, v_match_ptax
        FROM public.demurrage_invoices d
        WHERE d.id = v_item.invoice_id
        FOR UPDATE;

        IF NOT FOUND THEN
          RAISE EXCEPTION 'Demurrage % nao encontrada.', v_item.doc_number USING ERRCODE = 'P0002';
        END IF;
        IF v_match_brl IS NULL OR ABS(v_match_brl - COALESCE(v_item.amount, 0)) > 0.01 THEN
          RAISE EXCEPTION 'Valor divergente para demurrage %.', v_item.doc_number USING ERRCODE = '22003';
        END IF;
      END IF;

      v_demurrage_updates := v_demurrage_updates || jsonb_build_array(jsonb_build_object(
        'invoice_id', v_item.invoice_id,
        'paid_at', v_paid_date,
        'pix_txid', v_item.txid,
        'total_brl', v_match_brl,
        'ptax_used', v_match_ptax));
      v_demurrage_count := v_demurrage_count + 1;
      v_items := v_items || jsonb_build_array(jsonb_build_object(
        'source', 'demurrage', 'invoice_id', v_item.invoice_id, 'doc_number', v_item.doc_number, 'status', 'ok'));
    ELSE
      RAISE EXCEPTION 'Origem de conciliacao PIX invalida: %.', v_item.source USING ERRCODE = '22023';
    END IF;
  END LOOP;

  IF v_demurrage_count > 0 THEN
    v_updated_demurrage := public.confirm_demurrage_pix_matches(v_demurrage_updates);
    IF v_updated_demurrage <> v_demurrage_count THEN
      RAISE EXCEPTION 'Conciliacao de demurrage atualizou % de % faturas.', v_updated_demurrage, v_demurrage_count
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN jsonb_build_object('local', v_local_count, 'demurrage', v_demurrage_count, 'items', v_items);
END;
$function$;

CREATE OR REPLACE FUNCTION public.correct_bl_ce_mercante(p_bl_id text, p_ce text, p_reason text, p_expected_ce text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_old text;
  v_result text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuário sem permissão ativa.' USING ERRCODE = '42501';
  END IF;
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'Informe o motivo da correcao do CE Mercante.' USING ERRCODE = '22023';
  END IF;
  SELECT ce_mercante INTO v_old FROM public.bls WHERE id = p_bl_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L % nao encontrado.', p_bl_id USING ERRCODE = 'P0002';
  END IF;
  IF p_expected_ce IS NOT NULL
     AND public.ce_mercante_key(v_old) IS DISTINCT FROM public.ce_mercante_key(p_expected_ce) THEN
    RAISE EXCEPTION 'O CE Mercante do B/L % mudou depois que a ficha foi aberta (agora: %). Recarregue a ficha e confira antes de corrigir.',
      p_bl_id, COALESCE(NULLIF(btrim(COALESCE(v_old, '')), ''), 'sem CE')
      USING ERRCODE = '22023';
  END IF;
  IF NULLIF(btrim(COALESCE(v_old, '')), '') IS NULL THEN
    RAISE EXCEPTION 'O B/L % ainda nao tem CE Mercante: o CE entra pela planilha de CE Mercante, que tambem vincula o Manifesto Mercante.', p_bl_id
      USING ERRCODE = '22023';
  END IF;
  IF NULLIF(btrim(COALESCE(p_ce, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Informe o CE Mercante correto (15 digitos). Para tirar o CE, use Remover CE Mercante.' USING ERRCODE = '22023';
  END IF;
  v_result := public._set_bl_ce_mercante(p_bl_id, p_ce, auth.uid(), 'Correcao do CE Mercante pela ficha: ' || v_reason, 'ce_mercante_ficha');
  RETURN jsonb_build_object('status', v_result, 'bl_id', p_bl_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_customer_from_bl_manifest(p_bl_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_bl public.bls%ROWTYPE;
  v_cnpj text;
  v_email text;
  v_existing public.customers%ROWTYPE;
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuário sem permissão para criar cliente.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_bl FROM public.bls WHERE id = p_bl_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L % nao encontrado.', p_bl_id USING ERRCODE = 'P0002';
  END IF;
  v_cnpj := public.normalize_cnpj(v_bl.manifest_customer_cnpj_cpf);
  v_email := NULLIF(lower(btrim(COALESCE(v_bl.manifest_customer_email, ''))), '');
  IF v_cnpj IS NULL OR NULLIF(btrim(COALESCE(v_bl.manifest_customer_name, '')), '') IS NULL THEN
    RAISE EXCEPTION 'O manifesto do B/L % não traz o Cliente (razão social e CNPJ).', p_bl_id USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_existing FROM public.customers WHERE cnpj_cpf = v_cnpj;
  IF FOUND THEN
    RETURN to_jsonb(v_existing);
  END IF;
  IF v_email IS NULL OR position('@' IN v_email) = 0 THEN
    RAISE EXCEPTION 'O cliente do manifesto não está cadastrado e o manifesto não traz e-mail. Cadastre-o em Clientes e vincule pela busca.' USING ERRCODE = '22023';
  END IF;
  PERFORM set_config('vela.customer_from_manifest', 'on', true);
  v_result := public.create_customer_with_contacts(
    jsonb_build_object('cnpj_cpf', v_cnpj, 'name', btrim(v_bl.manifest_customer_name)),
    jsonb_build_array(jsonb_build_object('name', 'Contato manifesto', 'email', v_email, 'purpose', 'geral',
      'is_primary', true, 'box_codes', jsonb_build_array('documentacao_operacao', 'financeiro', 'demurrage'))));
  PERFORM set_config('vela.customer_from_manifest', '', true);
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_customer_with_contacts(p_customer jsonb, p_contacts jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_customer public.customers%ROWTYPE;
  v_contact jsonb;
  v_has_primary boolean := false;
  v_primary_email text;
  v_contact_id bigint;
  v_box_codes jsonb;
  v_box_code text;
  v_email text;
  v_is_primary boolean;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuário sem permissão para criar cliente.' USING ERRCODE = '42501';
  END IF;
  -- 486 (decisão do dono, P10): o Novo cliente grava contatos, que só
  -- Administrativo, Documentação e Equipamentos incluem (ACE-D04, D10). O
  -- Cliente do manifesto, cadastrado pela ficha do B/L com o e-mail do
  -- documento, vem por `create_customer_from_bl_manifest`, aberto a todos.
  IF NOT public._can_edit_customer_contacts()
     AND current_setting('vela.customer_from_manifest', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Novo cliente é de Administrativo, Documentação e Equipamentos, porque grava os contatos. Traga o Cliente pela Base de Clientes ou pela Revisão.' USING ERRCODE = '42501';
  END IF;

  IF jsonb_typeof(p_customer) <> 'object'
     OR jsonb_typeof(p_contacts) <> 'array'
     OR NULLIF(btrim(p_customer->>'cnpj_cpf'), '') IS NULL
     OR NULLIF(btrim(p_customer->>'name'), '') IS NULL THEN
    RAISE EXCEPTION 'Cadastro de cliente invalido.' USING ERRCODE = '22023';
  END IF;

  -- Exige pelo menos um contato que seja principal e tenha e-mail
  FOR v_contact IN SELECT * FROM jsonb_array_elements(p_contacts)
  LOOP
    IF COALESCE((v_contact->>'is_primary')::boolean, false) = true THEN
      v_has_primary := true;
      v_primary_email := NULLIF(lower(btrim(COALESCE(v_contact->>'email', ''))), '');
    END IF;
  END LOOP;

  IF NOT v_has_primary OR v_primary_email IS NULL THEN
    RAISE EXCEPTION 'Criação de cliente exige ao menos um contato principal com e-mail válido.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.customers (
    cnpj_cpf, name, trade_name, address, city, state, zip, notes
  )
  VALUES (
    btrim(p_customer->>'cnpj_cpf'),
    btrim(p_customer->>'name'),
    NULLIF(btrim(p_customer->>'trade_name'), ''),
    NULLIF(btrim(p_customer->>'address'), ''),
    NULLIF(btrim(p_customer->>'city'), ''),
    NULLIF(btrim(p_customer->>'state'), ''),
    NULLIF(btrim(p_customer->>'zip'), ''),
    NULLIF(btrim(p_customer->>'notes'), '')
  )
  RETURNING * INTO v_customer;

  -- Inserir contatos e vincular caixas
  FOR v_contact IN SELECT * FROM jsonb_array_elements(p_contacts)
  LOOP
    v_email := NULLIF(lower(btrim(COALESCE(v_contact->>'email', ''))), '');
    v_is_primary := COALESCE((v_contact->>'is_primary')::boolean, false);
    v_box_codes := v_contact->'box_codes';

    IF v_email IS NOT NULL THEN
      INSERT INTO public.customer_contacts (
        customer_id, name, email, phone, purpose, is_primary, origin
      )
      VALUES (
        v_customer.id,
        COALESCE(NULLIF(btrim(v_contact->>'name'), ''), 'Contato'),
        v_email,
        NULLIF(btrim(v_contact->>'phone'), ''),
        COALESCE(NULLIF(btrim(v_contact->>'purpose'), ''), 'geral'),
        v_is_primary,
        'interno'
      )
      RETURNING id INTO v_contact_id;

      IF v_is_primary THEN
        -- Principal recebe as 3 caixas
        INSERT INTO public.customer_contact_box_links (contact_id, box_code)
        SELECT v_contact_id, code
        FROM public.customer_communication_boxes
        WHERE active = true
        ON CONFLICT DO NOTHING;
      ELSE
        -- Adicionais recebem as caixas informadas ou documentacao_operacao
        IF v_box_codes IS NOT NULL AND jsonb_array_length(v_box_codes) > 0 THEN
          FOR v_box_code IN SELECT jsonb_array_elements_text(v_box_codes)
          LOOP
            INSERT INTO public.customer_contact_box_links (contact_id, box_code)
            VALUES (v_contact_id, v_box_code)
            ON CONFLICT DO NOTHING;
          END LOOP;
        ELSE
          INSERT INTO public.customer_contact_box_links (contact_id, box_code)
          VALUES (v_contact_id, 'documentacao_operacao')
          ON CONFLICT DO NOTHING;
        END IF;
      END IF;
    END IF;
  END LOOP;

  -- Registrar evento inicial
  INSERT INTO public.customer_contact_change_events (
    customer_id, source, actor_id, after_snapshot, change_summary
  )
  VALUES (
    v_customer.id,
    'interno',
    auth.uid(),
    (public._build_customer_contact_configuration(v_customer.id))->'contacts',
    jsonb_build_object('action', 'customer_created')
  );

  RETURN to_jsonb(v_customer);
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_demurrage_invoice_authoritative(p_doc_number text, p_bl_id text, p_customer_id bigint, p_container_ids bigint[], p_expected_updated_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bl public.bls%ROWTYPE;
  v_reference public.exchange_rate_reference%ROWTYPE;
  v_calculation jsonb;
  v_items jsonb;
  v_invoice_id bigint;
  v_total_usd numeric(12,2);
  v_current_roe numeric(10,4);
  v_ptax numeric(10,4);
  v_roe_source text;
  v_total_brl numeric(14,2);
  v_pix_payload text;
  v_business_date date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_ready_at date;
  v_billed_box text;
  v_block text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND current_setting('vela.demurrage_internal', true) IS DISTINCT FROM 'on'
     AND (auth.uid() IS NULL OR NOT public.is_active_user()) THEN
    RAISE EXCEPTION 'Usuário sem permissão de faturamento.' USING ERRCODE = '42501';
  END IF;
  IF NULLIF(btrim(p_doc_number), '') IS NULL
     OR NULLIF(btrim(p_bl_id), '') IS NULL
     OR p_customer_id IS NULL THEN
    RAISE EXCEPTION 'Documento, B/L e cliente são obrigatórios.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_bl
  FROM public.bls
  WHERE id = p_bl_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L % não encontrado.', p_bl_id USING ERRCODE = 'P0002';
  END IF;
  IF v_bl.cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION 'O B/L % está cancelado: a Invoice de Demurrage não é emitida para B/L cancelado.', p_bl_id
      USING ERRCODE = '22023';
  END IF;
  IF v_bl.customer_id IS DISTINCT FROM p_customer_id THEN
    RAISE EXCEPTION 'Cliente informado não corresponde ao cliente do B/L %.', p_bl_id USING ERRCODE = '22023';
  END IF;
  IF p_expected_updated_at IS NOT NULL AND v_bl.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'Prévia de Demurrage desatualizada; recalcule antes de emitir.' USING ERRCODE = '40001';
  END IF;
  -- Grupo de container compartilhado: uma Invoice, pelo B/L-âncora.
  IF public.demurrage_group_anchor(p_bl_id) IS DISTINCT FROM p_bl_id THEN
    RAISE EXCEPTION 'O B/L % divide container com o B/L %: a Invoice de Demurrage do grupo é emitida pelo B/L %.',
      p_bl_id, public.demurrage_group_anchor(p_bl_id), public.demurrage_group_anchor(p_bl_id)
      USING ERRCODE = '22023';
  END IF;
  -- Cada caixa uma vez (214): recusa a caixa pedida que outra Invoice viva da
  -- Viagem e do Cliente já cobra, mesmo ancorada em B/L de fora do grupo.
  PERFORM public._lock_demurrage_box_billing(v_bl.voyage_id, p_customer_id);
  SELECT upper(btrim(c.container_number)) INTO v_billed_box
  FROM public.bl_containers AS c
  JOIN public._demurrage_billed_container_keys(v_bl.voyage_id, p_customer_id) AS billed
    ON billed.container_key = upper(btrim(c.container_number))
  WHERE c.id = ANY(p_container_ids)
  ORDER BY 1
  LIMIT 1;
  IF v_billed_box IS NOT NULL THEN
    RAISE EXCEPTION 'Já existe fatura de Demurrage emitida ou paga para o container % do B/L %. Cancele a fatura atual antes de reemitir.', v_billed_box, p_bl_id
      USING ERRCODE = '23505';
  END IF;

  IF COALESCE(v_bl.demurrage_roe_manual, false) THEN
    IF v_bl.demurrage_roe IS NULL OR v_bl.demurrage_roe <= 0 OR v_bl.demurrage_roe::text = 'NaN' THEN
      RAISE EXCEPTION 'ROE manual inválido no B/L %.', p_bl_id USING ERRCODE = '22023';
    END IF;
    v_current_roe := round(v_bl.demurrage_roe, 4);
    v_roe_source := 'manual';
    v_ptax := NULL;
  ELSE
    SELECT * INTO v_reference
    FROM public.exchange_rate_reference
    WHERE id = 1
    FOR SHARE;
    IF NOT FOUND OR v_reference.roe IS NULL OR v_reference.roe <= 0 THEN
      RAISE EXCEPTION 'Referência cambial vigente indisponível para emitir Demurrage.' USING ERRCODE = 'P0001';
    END IF;
    v_current_roe := round(v_reference.roe, 4);
    v_roe_source := COALESCE(NULLIF(v_reference.source, ''), 'manual');
    v_ptax := v_reference.ptax;
    IF v_roe_source IN ('bcb_live', 'cached') AND (v_ptax IS NULL OR v_ptax <= 0) THEN
      RAISE EXCEPTION 'Referência cambial sem PTAX factual para a origem %.', v_roe_source USING ERRCODE = 'P0001';
    END IF;
  END IF;

  v_calculation := public._calculate_demurrage_invoice_authoritative(
    p_bl_id,
    p_container_ids,
    v_business_date
  );
  v_items := v_calculation->'items';
  v_total_usd := round((v_calculation->>'total_usd')::numeric, 2);
  v_ready_at := NULLIF(v_calculation->>'ready_at', '')::date;
  IF v_total_usd IS NULL OR v_total_usd <= 0 OR jsonb_array_length(v_items) = 0 THEN
    RAISE EXCEPTION 'Nenhum container com sobreestadia para este B/L.' USING ERRCODE = '22023';
  END IF;

  -- 472 (DEM-D13): mesma trava das faturas (CE Mercante e Gate do Portal),
  -- depois das recusas da própria conta (grupo, caixa já cobrada, sobreestadia).
  v_block := public._demurrage_issue_block_reason(p_bl_id);
  IF v_block IS NOT NULL THEN
    RAISE EXCEPTION '%', v_block USING ERRCODE = 'P0003';
  END IF;

  v_total_brl := round(v_total_usd * v_current_roe, 2);
  v_pix_payload := CASE
    WHEN v_total_brl > 0 THEN public.build_transshipping_pix_payload(v_total_brl, trim(p_doc_number))
    ELSE NULL
  END;

  INSERT INTO public.demurrage_invoices (
    doc_number, bl_id, customer_id, total_usd, ready_at,
    roe_manual, roe, status, billed_at, first_billed_at,
    current_roe, current_total_brl, roe_source, pix_payload
  ) VALUES (
    trim(p_doc_number), p_bl_id, p_customer_id, v_total_usd, v_ready_at,
    COALESCE(v_bl.demurrage_roe_manual, false), v_bl.demurrage_roe, 'issued',
    v_business_date, v_business_date, v_current_roe, v_total_brl, v_roe_source, v_pix_payload
  ) RETURNING id INTO v_invoice_id;

  INSERT INTO public.demurrage_invoice_items (
    invoice_id, container_id, container_number, container_type,
    discharge_date, return_date, total_days, free_days,
    days_p1, rate_p1_usd, days_p2, rate_p2_usd, subtotal_usd
  )
  SELECT
    v_invoice_id, item.container_id, item.container_number, item.container_type,
    item.discharge_date, item.return_date, item.total_days, item.free_days,
    item.days_p1, item.rate_p1_usd, item.days_p2, item.rate_p2_usd, item.subtotal_usd
  FROM jsonb_to_recordset(v_items) AS item(
    container_id bigint,
    container_number text,
    container_type text,
    discharge_date date,
    return_date date,
    total_days integer,
    free_days integer,
    days_p1 integer,
    rate_p1_usd numeric,
    days_p2 integer,
    rate_p2_usd numeric,
    subtotal_usd numeric
  );

  INSERT INTO public.demurrage_invoice_history
    (invoice_id, event_date, ptax_used, roe_used, total_usd, total_brl, discount_usd, source)
  VALUES
    (v_invoice_id, v_business_date, v_ptax, v_current_roe, v_total_usd, v_total_brl, 0, v_roe_source);

  RETURN jsonb_build_object(
    'invoice_id', v_invoice_id,
    'total_usd', v_total_usd,
    'current_total_brl', v_total_brl,
    'current_roe', v_current_roe,
    'roe_source', v_roe_source,
    'calculation_version', 1
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_demurrage_invoice_with_items(p_doc_number text, p_bl_id text, p_customer_id bigint, p_total_usd numeric, p_ready_at date, p_roe_manual boolean, p_roe numeric, p_current_roe numeric, p_roe_source text, p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_invoice_id bigint;
  v_customer_id bigint;
  v_item_count integer;
  v_invalid_container_count integer;
  v_inconsistent_item_count integer;
  v_item_total numeric(14,2);
  v_total_brl numeric(14,2);
  v_pix_payload text;
  v_ptax numeric(10,4);
  v_business_date date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Usuário sem permissão de faturamento.' USING ERRCODE = '42501';
  END IF;

  IF NULLIF(TRIM(COALESCE(p_doc_number, '')), '') IS NULL
     OR NULLIF(TRIM(COALESCE(p_bl_id, '')), '') IS NULL
     OR p_customer_id IS NULL
     OR COALESCE(p_total_usd, 0) <= 0
     OR p_current_roe IS NULL OR p_current_roe <= 0
     OR p_roe_source NOT IN ('bcb_live', 'cached', 'manual')
     OR jsonb_typeof(p_items) <> 'array'
     OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Dados invalidos para criar invoice de Demurrage.' USING ERRCODE = '22023';
  END IF;

  SELECT b.customer_id
    INTO v_customer_id
    FROM public.bls b
   WHERE b.id = p_bl_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L % nao encontrado.', p_bl_id USING ERRCODE = 'P0002';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.demurrage_invoices di
    WHERE di.bl_id = p_bl_id AND di.status IN ('issued', 'paid')
  ) THEN
    RAISE EXCEPTION 'Ja existe fatura de Demurrage emitida ou paga para o B/L %. Cancele a fatura atual antes de reemitir.', p_bl_id
      USING ERRCODE = '23505';
  END IF;

  IF v_customer_id IS DISTINCT FROM p_customer_id THEN
    RAISE EXCEPTION 'Cliente informado nao corresponde ao cliente do B/L %.', p_bl_id USING ERRCODE = '22023';
  END IF;

  SELECT
    COUNT(*)::integer,
    COUNT(*) FILTER (WHERE bc.id IS NULL OR bc.bl_id IS DISTINCT FROM p_bl_id)::integer,
    COUNT(*) FILTER (
      WHERE item.discharge_date IS NULL
         OR item.return_date IS NULL
         OR item.return_date < item.discharge_date
         OR COALESCE(item.total_days, -1) <> (item.return_date - item.discharge_date)
         OR COALESCE(item.free_days, -1) < 0
         OR COALESCE(item.days_p1, -1) < 0
         OR COALESCE(item.days_p2, -1) < 0
         OR COALESCE(item.rate_p1_usd, -1) < 0
         OR COALESCE(item.rate_p2_usd, -1) < 0
         OR item.days_p1 + item.days_p2 > GREATEST(item.total_days - item.free_days, 0)
         OR ABS(COALESCE(item.subtotal_usd, -1)
                - (item.days_p1 * item.rate_p1_usd + item.days_p2 * item.rate_p2_usd)) > 0.01
    )::integer,
    COALESCE(SUM(item.subtotal_usd), 0)
    INTO v_item_count, v_invalid_container_count, v_inconsistent_item_count, v_item_total
    FROM jsonb_to_recordset(p_items) AS item(
      container_id bigint,
      container_number text,
      container_type text,
      discharge_date date,
      return_date date,
      total_days integer,
      free_days integer,
      days_p1 integer,
      rate_p1_usd numeric,
      days_p2 integer,
      rate_p2_usd numeric,
      subtotal_usd numeric
    )
    LEFT JOIN public.bl_containers bc ON bc.id = item.container_id;

  IF v_item_count = 0 OR v_invalid_container_count > 0 THEN
    RAISE EXCEPTION 'Itens de Demurrage invalidos para o B/L %.', p_bl_id USING ERRCODE = '22023';
  END IF;

  IF v_inconsistent_item_count > 0 THEN
    RAISE EXCEPTION 'Calculo de Demurrage inconsistente em % item(ns) do B/L %.', v_inconsistent_item_count, p_bl_id
      USING ERRCODE = '22023';
  END IF;

  IF ABS(v_item_total - p_total_usd) > 0.01 THEN
    RAISE EXCEPTION 'Total dos itens diverge do total da invoice de Demurrage.' USING ERRCODE = '22023';
  END IF;

  IF p_roe_source IN ('bcb_live', 'cached') THEN
    SELECT reference.ptax
      INTO v_ptax
      FROM public.exchange_rate_reference AS reference
     WHERE reference.id = 1
       AND reference.source = p_roe_source
       AND reference.roe = p_current_roe
       AND reference.ptax IS NOT NULL
     FOR SHARE;
    IF v_ptax IS NULL THEN
      RAISE EXCEPTION 'Snapshot cambial sem PTAX registrada para a origem %.', p_roe_source
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- Sem desconto na criacao (descontos sao aplicados depois, em USD).
  v_total_brl := ROUND(p_total_usd * p_current_roe, 2);
  v_pix_payload := public.build_transshipping_pix_payload(v_total_brl, TRIM(p_doc_number));

  INSERT INTO public.demurrage_invoices (
    doc_number, bl_id, customer_id, total_usd, ready_at,
    roe_manual, roe, status, billed_at, first_billed_at,
    current_roe, current_total_brl, roe_source, pix_payload
  ) VALUES (
    TRIM(p_doc_number), p_bl_id, p_customer_id, p_total_usd, p_ready_at,
    COALESCE(p_roe_manual, false), p_roe, 'issued', v_business_date, v_business_date,
    p_current_roe, v_total_brl, p_roe_source, v_pix_payload
  ) RETURNING id INTO v_invoice_id;

  INSERT INTO public.demurrage_invoice_items (
    invoice_id, container_id, container_number, container_type,
    discharge_date, return_date, total_days, free_days,
    days_p1, rate_p1_usd, days_p2, rate_p2_usd, subtotal_usd
  )
  SELECT
    v_invoice_id, item.container_id, item.container_number, item.container_type,
    item.discharge_date, item.return_date, item.total_days, item.free_days,
    item.days_p1, item.rate_p1_usd, item.days_p2, item.rate_p2_usd, item.subtotal_usd
    FROM jsonb_to_recordset(p_items) AS item(
      container_id bigint,
      container_number text,
      container_type text,
      discharge_date date,
      return_date date,
      total_days integer,
      free_days integer,
      days_p1 integer,
      rate_p1_usd numeric,
      days_p2 integer,
      rate_p2_usd numeric,
      subtotal_usd numeric
    );

  INSERT INTO public.demurrage_invoice_history
    (invoice_id, event_date, ptax_used, roe_used, total_usd, total_brl, discount_usd, source)
  VALUES
    (v_invoice_id, v_business_date, v_ptax, p_current_roe, p_total_usd, v_total_brl, 0, p_roe_source);

  RETURN jsonb_build_object('invoice_id', v_invoice_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_invoice_from_bls(p_bl_ids text[], p_customer_id bigint DEFAULT NULL::bigint, p_notes text DEFAULT NULL::text, p_issue_now boolean DEFAULT true, p_actor uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- O autor é quem está logado (ADR 0085, regra base 2; migration 241).
  PERFORM public._assert_actor_is_caller(p_actor);
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuário sem permissão de faturamento.' USING ERRCODE = '42501';
  END IF;

  RETURN public.create_invoice_from_bls_core(
    p_bl_ids,
    p_customer_id,
    p_notes,
    p_issue_now,
    COALESCE(p_actor, auth.uid()),
    'internal',
    NULL
  );
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
      RAISE EXCEPTION 'Câmbio (ROE) não configurado; não é possível converter linhas em USD para emitir a fatura.' USING ERRCODE = '22023';
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

CREATE OR REPLACE FUNCTION public.create_invoice_from_bls_with_ledger(p_bl_ids text[], p_customer_id bigint DEFAULT NULL::bigint, p_notes text DEFAULT NULL::text, p_issue_now boolean DEFAULT true, p_actor uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_result JSONB;
  v_invoice_id BIGINT;
  v_bl TEXT;
BEGIN
  -- O autor é quem está logado (ADR 0085, regra base 2; migration 241).
  PERFORM public._assert_actor_is_caller(p_actor);
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuário sem permissão de faturamento.' USING ERRCODE = '42501';
  END IF;

  -- F-16 (366): as mesmas checagens do Emitir (Revisão, CE, Cliente,
  -- pendências, terminal, linhas faturáveis), B/L por B/L.
  FOREACH v_bl IN ARRAY coalesce(p_bl_ids, ARRAY[]::text[]) LOOP
    PERFORM public.mark_bl_ready_for_billing(v_bl, auth.uid());
  END LOOP;

  v_result := public.create_invoice_from_bls_core(
    p_bl_ids,
    p_customer_id,
    p_notes,
    p_issue_now,
    COALESCE(p_actor, auth.uid()),
    'internal',
    NULL
  );

  v_invoice_id := (v_result->>'invoice_id')::BIGINT;
  IF v_invoice_id IS NULL THEN
    RAISE EXCEPTION 'Falha ao criar invoice para B/Ls.' USING ERRCODE = 'P0001';
  END IF;

  PERFORM public.link_invoice_to_ledger(v_invoice_id);

  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_local_consolidated_invoice(p_customer_id bigint, p_receivable_ids bigint[], p_notes text DEFAULT NULL::text, p_actor uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor UUID;
BEGIN
  -- O autor é quem está logado (ADR 0085, regra base 2; migration 241).
  PERFORM public._assert_actor_is_caller(p_actor);
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuário sem permissão de faturamento.' USING ERRCODE = '42501';
  END IF;

  v_actor := COALESCE(p_actor, auth.uid());

  RETURN public.create_local_consolidated_invoice_core(
    p_customer_id,
    p_receivable_ids,
    v_actor,
    'internal'
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_local_consolidated_invoice_core(p_customer_id bigint, p_receivable_ids bigint[], p_actor uuid DEFAULT NULL::uuid, p_origin text DEFAULT 'internal'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_ids BIGINT[];
  v_count INTEGER;
  v_invoice_id BIGINT;
  v_invoice_number TEXT;
  v_total NUMERIC(14,2);
  v_missing_roe_count INTEGER;
  v_bl_without_individual TEXT;
BEGIN
  SELECT ARRAY_AGG(DISTINCT id ORDER BY id)
  INTO v_ids
  FROM UNNEST(COALESCE(p_receivable_ids, ARRAY[]::BIGINT[])) AS u(id)
  WHERE id IS NOT NULL;

  IF COALESCE(ARRAY_LENGTH(v_ids, 1), 0) < 1 THEN
    RAISE EXCEPTION 'Nenhum receivable informado para consolidar.' USING ERRCODE = '22023';
  END IF;

  IF NOT public.customer_billing_access_ready(p_customer_id) THEN
    RAISE EXCEPTION 'Emissao consolidada bloqueada: conta do Portal do cliente nao esta pronta para receber a fatura.' USING ERRCODE = 'P0003';
  END IF;

  PERFORM 1 FROM public.bl_receivables WHERE id = ANY(v_ids) ORDER BY id FOR UPDATE;

  -- ADR 0093, decisão 9 (365): B/L sem individual viva entra na consolidada
  -- como faturamento dele: passa pelas checagens do Emitir (Revisão, CE,
  -- gate) e fica "faturado"; nenhuma individual sai por cima enquanto ela
  -- estiver aberta (gatilho trg_single_open_local_document).
  FOR v_bl_without_individual IN
    SELECT br.bl_id FROM public.bl_receivables br
    WHERE br.id = ANY(v_ids)
      AND NOT EXISTS (
        SELECT 1 FROM public.invoice_receivable_links l JOIN public.invoices i ON i.id = l.invoice_id
        WHERE l.receivable_id = br.id AND l.status = 'active' AND i.invoice_type = 'individual'
          AND coalesce(i.status, 'issued') IN ('draft', 'issued', 'partially_paid'))
    ORDER BY br.bl_id
  LOOP
    PERFORM public.mark_bl_ready_for_billing(v_bl_without_individual, p_actor);
    UPDATE public.bls SET financial_status = 'invoiced'
     WHERE id = v_bl_without_individual AND coalesce(financial_status, 'pending') = 'pending';
  END LOOP;

  SELECT COUNT(*) INTO v_count FROM public.bl_receivables WHERE id = ANY(v_ids);
  IF v_count <> ARRAY_LENGTH(v_ids, 1) THEN
    RAISE EXCEPTION 'Receivable(s) inexistente(s) na selecao.' USING ERRCODE = 'P0002';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.bl_receivables WHERE id = ANY(v_ids) AND customer_id <> p_customer_id
  ) THEN
    RAISE EXCEPTION 'Selecao contem receivables de clientes diferentes.' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.bl_receivables
    WHERE id = ANY(v_ids) AND (status NOT IN ('open', 'partially_settled') OR balance_brl <= 0)
  ) THEN
    RAISE EXCEPTION 'Todos os receivables precisam estar abertos com saldo positivo.' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.invoice_receivable_links l
    JOIN public.invoices inv ON inv.id = l.invoice_id
    WHERE l.receivable_id = ANY(v_ids)
      AND inv.invoice_type = 'consolidated'
      AND COALESCE(inv.status, 'issued') IN ('draft', 'issued', 'partially_paid', 'overdue')
  ) THEN
    RAISE EXCEPTION 'Um ou mais B/Ls já estão em consolidada aberta.' USING ERRCODE = '23505';
  END IF;

  SELECT COALESCE(SUM(balance_brl), 0) INTO v_total
  FROM public.bl_receivables WHERE id = ANY(v_ids);

  INSERT INTO public.invoices (
    customer_id, bl_id, issued_at, total_brl, status, invoice_type,
    notes, total_paid_brl, balance_brl, issued_by
  )
  VALUES (
    p_customer_id, NULL, now(), v_total, 'issued', 'consolidated',
    NULL, 0, v_total, p_actor
  )
  RETURNING id, invoice_number INTO v_invoice_id, v_invoice_number;

  INSERT INTO public.invoice_receivable_links (invoice_id, receivable_id, bl_id, subtotal_brl, status, bl_snapshot)
  SELECT
    v_invoice_id, br.id, br.bl_id, br.balance_brl, 'active',
    jsonb_build_object('bl_id', br.bl_id, 'voyage_id', br.voyage_id, 'cargo_mode', br.cargo_mode, 'pol', br.pol, 'pod', br.pod)
  FROM public.bl_receivables br
  WHERE br.id = ANY(v_ids);

  -- Achado 4 da review da PR 501: garante que todo receivable USD selecionado
  -- tem ROE congelado antes de montar o detalhamento (evita usar um ROE
  -- global "current" como fallback silencioso).
  SELECT COUNT(*)
  INTO v_missing_roe_count
  FROM public.bl_receivables br
  JOIN public.charge_calculations cc ON cc.bl_id = br.bl_id
  LEFT JOIN public.charge_table_items cti ON cti.id = cc.charge_item_id
  WHERE br.id = ANY(v_ids)
    AND br.roe_frozen IS NULL
    AND COALESCE(cti.currency, 'BRL') = 'USD'
    AND COALESCE(cc.total_value_usd, 0) > 0
    AND COALESCE(cc.status, 'calculated') IN ('calculated', 'reviewed', 'ready_for_billing');

  IF v_missing_roe_count > 0 THEN
    RAISE EXCEPTION 'Um ou mais receivables selecionados nao tem ROE congelado para linhas em USD; recalcule/atualize o B/L antes de consolidar.' USING ERRCODE = '22023';
  END IF;

  WITH links AS (
    SELECT l.bl_id, l.subtotal_brl, br.roe_frozen, br.roe_effective_date_frozen
    FROM public.invoice_receivable_links l
    JOIN public.bl_receivables br ON br.id = l.receivable_id
    WHERE l.invoice_id = v_invoice_id
  ),
  calcs AS (
    SELECT
      cc.bl_id, cc.id AS charge_calculation_id, cc.charge_table_id, cc.charge_item_id,
      cc.quantity,
      COALESCE(cc.unit_value_brl, CASE WHEN COALESCE(cti.currency, 'BRL') = 'USD' THEN ROUND(COALESCE(cc.unit_value_usd, 0) * links.roe_frozen, 2) END) AS unit_value_brl,
      COALESCE(cc.total_value_brl, CASE WHEN COALESCE(cti.currency, 'BRL') = 'USD' THEN ROUND(COALESCE(cc.total_value_usd, 0) * links.roe_frozen, 2) END, 0) AS total_value_brl,
      cti.currency, cti.application_basis,
      cc.unit_value_usd, cc.total_value_usd, cc.calculation_key, cti.name AS charge_name,
      links.roe_frozen, links.roe_effective_date_frozen
    FROM public.charge_calculations cc
    JOIN links ON links.bl_id = cc.bl_id
    LEFT JOIN public.charge_table_items cti ON cti.id = cc.charge_item_id
    WHERE (COALESCE(cc.total_value_brl, 0) > 0 OR COALESCE(cc.total_value_usd, 0) > 0)
      AND COALESCE(cc.status, 'calculated') IN ('calculated', 'reviewed', 'ready_for_billing')
  ),
  bl_recon AS (
    SELECT links.bl_id, links.subtotal_brl,
      COUNT(calcs.charge_calculation_id) AS calc_count,
      COALESCE(SUM(calcs.total_value_brl), 0) AS detailed_sum
    FROM links
    LEFT JOIN calcs ON calcs.bl_id = links.bl_id
    GROUP BY links.bl_id, links.subtotal_brl
  )
  INSERT INTO public.invoice_items (
    invoice_id, charge_calculation_id, description, quantity, unit_value_brl,
    total_value_brl, bl_id, charge_table_id, charge_item_id, source, currency,
    unit_value_usd, total_value_usd, calculation_key, snapshot_payload
  )
  SELECT
    v_invoice_id, calcs.charge_calculation_id,
    CONCAT('BL ', calcs.bl_id, ' - ', COALESCE(calcs.charge_name, calcs.calculation_key, 'Linha de taxa')),
    COALESCE(calcs.quantity, 1), calcs.unit_value_brl, calcs.total_value_brl,
    calcs.bl_id, calcs.charge_table_id, calcs.charge_item_id, 'ledger',
    COALESCE(calcs.currency, 'BRL'), calcs.unit_value_usd, calcs.total_value_usd,
    calcs.calculation_key,
    jsonb_build_object(
      'reconciled', true,
      'shared_quantity_label', CASE
        WHEN calcs.application_basis = 'container_distinct_voyage'
          AND calcs.quantity > 0 AND calcs.quantity < 1
        THEN CONCAT('1/', ROUND(1 / calcs.quantity)::INTEGER)
        ELSE NULL
      END,
      'roe', CASE WHEN COALESCE(calcs.currency, 'BRL') = 'USD' THEN calcs.roe_frozen ELSE NULL END,
      'roe_effective_date', CASE WHEN COALESCE(calcs.currency, 'BRL') = 'USD' THEN calcs.roe_effective_date_frozen ELSE NULL END
    )
  FROM calcs
  JOIN bl_recon ON bl_recon.bl_id = calcs.bl_id
  WHERE bl_recon.calc_count > 0 AND ABS(bl_recon.detailed_sum - bl_recon.subtotal_brl) < 0.01
  UNION ALL
  SELECT
    v_invoice_id, NULL, CONCAT('BL ', bl_recon.bl_id, ' - Taxas locais'),
    1, bl_recon.subtotal_brl, bl_recon.subtotal_brl,
    bl_recon.bl_id, NULL, NULL, 'ledger', 'BRL', NULL, NULL, NULL,
    jsonb_build_object('reconciled', false)
  FROM bl_recon
  WHERE NOT (bl_recon.calc_count > 0 AND ABS(bl_recon.detailed_sum - bl_recon.subtotal_brl) < 0.01);

  INSERT INTO public.invoice_lifecycle_events (invoice_id, event_type, actor, payload)
  VALUES (v_invoice_id, 'issued', p_actor,
    jsonb_build_object('invoice_type', 'consolidated', 'receivable_count', ARRAY_LENGTH(v_ids, 1), 'total_brl', v_total, 'origin', COALESCE(p_origin, 'internal')));

  INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification)
  VALUES ('invoice', v_invoice_id::TEXT, 'create_consolidated', NULL,
    CONCAT('invoice=', v_invoice_number, ' | receivables=', ARRAY_LENGTH(v_ids, 1), ' | total=', v_total),
    p_actor, now(),
    CASE WHEN COALESCE(p_origin, 'internal') = 'portal' THEN 'Emissao de consolidada via portal do cliente' ELSE 'Emissao de consolidada via ledger' END);

  RETURN jsonb_build_object(
    'invoice_id', v_invoice_id,
    'invoice_number', v_invoice_number,
    'status', 'issued',
    'invoice_type', 'consolidated',
    'receivable_count', ARRAY_LENGTH(v_ids, 1),
    'total_brl', v_total
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_manual_invoice(p_customer_id bigint, p_item_name text, p_quantity numeric, p_unit_value_brl numeric, p_description text DEFAULT NULL::text, p_bl_id text DEFAULT NULL::text, p_voyage_id bigint DEFAULT NULL::bigint, p_actor uuid DEFAULT NULL::uuid, p_charge_item_id bigint DEFAULT NULL::bigint, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_result jsonb;
  v_invoice bigint;
BEGIN
  -- O autor é quem está logado (ADR 0085, regra base 2; migration 241).
  PERFORM public._assert_actor_is_caller(p_actor);
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuário sem permissão de faturamento.' USING ERRCODE = '42501';
  END IF;
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'Informe o motivo da fatura avulsa.' USING ERRCODE = '22023';
  END IF;
  -- F-46 (376): Cliente desativado não recebe fatura nova (ADR 0073, item 6).
  IF EXISTS (SELECT 1 FROM public.customers WHERE id = p_customer_id AND deactivated_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Cliente desativado não recebe fatura avulsa. Reative o Cliente antes.' USING ERRCODE = '22023';
  END IF;

  v_result := public._create_manual_invoice_core_272(p_customer_id, p_item_name, p_quantity, p_unit_value_brl,
    p_description, p_bl_id, p_voyage_id, p_actor, p_charge_item_id);
  v_invoice := (v_result->>'invoice_id')::bigint;

  UPDATE public.invoice_lifecycle_events
  SET payload = COALESCE(payload, '{}'::jsonb) || jsonb_build_object('reason', v_reason)
  WHERE invoice_id = v_invoice AND event_type = 'issued';

  INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  VALUES ('invoice', v_invoice::text, 'manual_invoice_reason', NULL, v_reason, auth.uid(), v_reason);

  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_manual_invoice_charge(p_item_id bigint, p_actor uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_item RECORD;
  v_invoice RECORD;
  v_actor UUID;
  v_payment_count INTEGER;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Usuário sem permissão de faturamento.' USING ERRCODE = '42501';
  END IF;

  v_actor := COALESCE(p_actor, auth.uid());

  SELECT * INTO v_item FROM public.invoice_items WHERE id = p_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item % nao encontrado.', p_item_id USING ERRCODE = 'P0002';
  END IF;

  IF COALESCE(v_item.source, '') <> 'manual' THEN
    RAISE EXCEPTION 'Apenas itens manuais podem ser removidos.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_invoice FROM public.invoices WHERE id = v_item.invoice_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice nao encontrada para o item %.', p_item_id USING ERRCODE = 'P0002';
  END IF;

  IF COALESCE(v_invoice.status, 'issued') NOT IN ('issued', 'overdue', 'draft') THEN
    RAISE EXCEPTION 'So e permitido remover itens de faturas em aberto (status atual: %).',
      COALESCE(v_invoice.status, 'issued') USING ERRCODE = '22023';
  END IF;

  SELECT COUNT(*) INTO v_payment_count FROM public.payments WHERE invoice_id = v_invoice.id;
  IF v_payment_count > 0 THEN
    RAISE EXCEPTION 'Nao e permitido remover itens em fatura com pagamentos registrados.' USING ERRCODE = '22023';
  END IF;

  DELETE FROM public.invoice_items WHERE id = p_item_id;

  UPDATE public.invoices
  SET
    total_brl = GREATEST(COALESCE(total_brl, 0) - COALESCE(v_item.total_value_brl, 0), 0),
    balance_brl = GREATEST(COALESCE(total_brl, 0) - COALESCE(v_item.total_value_brl, 0) - COALESCE(total_paid_brl, 0), 0),
    pix_payload = NULL
  WHERE id = v_invoice.id;

  INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by)
  VALUES (
    'invoice', v_invoice.id::text, 'manual_charge_removed',
    format('%s = %s BRL', v_item.description, v_item.total_value_brl), NULL, v_actor
  );

  RETURN jsonb_build_object('invoice_id', v_invoice.id, 'item_id', p_item_id, 'removed', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_manual_vazios_booking(p_booking_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_booking RECORD;
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuário sem permissão ativa para excluir unidade.' USING ERRCODE = '42501';
  END IF;
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'Informe o motivo da exclusao.' USING ERRCODE = '22023';
  END IF;

  SELECT b.id, b.manifest_id, b.voyage_id, COALESCE(op.embark_port, b.pol) AS port
    INTO v_booking
  FROM public.vazios_bookings AS b
  LEFT JOIN public.vazios_export_operations AS op ON op.id = b.operation_id
  WHERE b.id = p_booking_id;
  IF v_booking.id IS NULL THEN
    RAISE EXCEPTION 'Unidade embarcada nao encontrada.' USING ERRCODE = 'P0002';
  END IF;
  IF public._vazios_export_locked_by_adr(v_booking.voyage_id, v_booking.port) THEN
    RAISE EXCEPTION 'ADR de Saida fechado: reabra o ADR para excluir a unidade.' USING ERRCODE = '23514';
  END IF;

  PERFORM set_config('vela.delete_reason', v_reason, true);
  DELETE FROM public.vazios_bookings WHERE id = p_booking_id;
  PERFORM set_config('vela.delete_reason', '', true);

  DELETE FROM public.vazios_manifests manifest
  WHERE manifest.id = v_booking.manifest_id
    AND manifest.description = 'Inclusao manual no Embarque de Vazios'
    AND NOT EXISTS (
      SELECT 1 FROM public.vazios_bookings booking
      WHERE booking.manifest_id = manifest.id
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.detect_agency_report_deadline_missed()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_report RECORD; v_result JSONB; v_count INTEGER := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501'; END IF;
  FOR v_report IN SELECT id FROM public.agency_departure_reports WHERE status = 'open' LOOP
    v_result := public.reconcile_agency_report_alerts(v_report.id, FALSE, TRUE);
    v_count := v_count + COALESCE((v_result->>'created')::integer, 0);
  END LOOP;
  RETURN v_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.detect_agency_report_department_pending()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_scale RECORD;
  v_report RECORD;
  v_result JSONB;
  v_count INTEGER := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501';
  END IF;
  FOR v_scale IN
    WITH latest_atd AS (
      SELECT DISTINCT ON (a.entity_type, a.entity_id)
        a.entity_type, a.entity_id, a.new_value, a.changed_at
      FROM public.audit_logs a
      WHERE a.entity_type IN ('voyage_pod_schedule', 'voyage_pol_schedule')
        AND a.field_name = 'atd'
        AND a.entity_id ~ '^[0-9]+::[^:]+$'
      ORDER BY a.entity_type, a.entity_id, a.changed_at DESC, a.id DESC
    ), source_atd AS (
      SELECT
        split_part(entity_id, '::', 1)::BIGINT AS voyage_id,
        upper(btrim(split_part(entity_id, '::', 2))) AS port,
        entity_type,
        CASE WHEN NULLIF(btrim(new_value), '') ~ '^\d{4}-\d{2}-\d{2}$'
          THEN NULLIF(btrim(new_value), '')::DATE END AS atd,
        changed_at
      FROM latest_atd
      WHERE NULLIF(btrim(new_value), '') IS NOT NULL
    ), scales AS (
      SELECT voyage_id, port,
        COALESCE(MAX(atd) FILTER (WHERE entity_type = 'voyage_pod_schedule'),
                 MAX(atd) FILTER (WHERE entity_type = 'voyage_pol_schedule')) AS atd,
        MAX(changed_at) FILTER (WHERE entity_type = 'voyage_pod_schedule') AS pod_changed_at,
        MAX(changed_at) FILTER (WHERE entity_type = 'voyage_pol_schedule') AS pol_changed_at
      FROM source_atd
      WHERE port LIKE 'BR%'
      GROUP BY voyage_id, port
    )
    SELECT s.voyage_id, s.port, s.atd,
      (s.pod_changed_at >= TIMESTAMPTZ '2026-07-19 00:00:00+00'
       OR s.pol_changed_at >= (
         SELECT captured_at FROM public.agency_report_pending_baselines
         WHERE baseline_key = 'voyage_pol_schedule_atd'
       )) AS pending_eligible,
      COALESCE((SELECT a.new_value = 'true' FROM public.audit_logs a
        WHERE a.entity_type = 'voyage_pod_schedule'
          AND a.entity_id = s.voyage_id || '::' || s.port AND a.field_name = 'omitted'
        ORDER BY a.changed_at DESC, a.id DESC LIMIT 1), false) AS omitted,
      COALESCE((SELECT a.new_value = 'true' FROM public.audit_logs a
        WHERE a.entity_type = 'voyage_pod_schedule'
          AND a.entity_id = s.voyage_id || '::' || s.port AND a.field_name = 'deleted'
        ORDER BY a.changed_at DESC, a.id DESC LIMIT 1), false) AS deleted
    FROM scales s
    WHERE s.atd IS NOT NULL
      AND (s.pod_changed_at >= TIMESTAMPTZ '2026-07-19 00:00:00+00'
        OR s.pol_changed_at >= (
          SELECT captured_at FROM public.agency_report_pending_baselines
          WHERE baseline_key = 'voyage_pol_schedule_atd'
        ))
  LOOP
    IF EXISTS (
      SELECT 1 FROM public.agency_departure_reports r
      WHERE r.voyage_id = v_scale.voyage_id AND r.port = v_scale.port
    ) THEN
      FOR v_report IN
        SELECT id FROM public.agency_departure_reports
        WHERE voyage_id = v_scale.voyage_id AND port = v_scale.port
      LOOP
        v_result := public.reconcile_agency_report_alerts(v_report.id, TRUE, FALSE);
        v_count := v_count + COALESCE((v_result->>'created')::INTEGER, 0);
      END LOOP;
    ELSE
      v_result := public.reconcile_agency_report_alerts_for_scale(
        v_scale.voyage_id, v_scale.port, v_scale.atd,
        v_scale.pending_eligible, FALSE, v_scale.omitted, v_scale.deleted
      );
      v_count := v_count + COALESCE((v_result->>'created')::INTEGER, 0);
    END IF;
  END LOOP;
  RETURN v_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.detect_agency_report_pending()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_report RECORD; v_result JSONB; v_count INTEGER := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501'; END IF;
  FOR v_report IN SELECT id FROM public.agency_departure_reports WHERE status = 'open' LOOP
    v_result := public.reconcile_agency_report_alerts(v_report.id, TRUE, FALSE);
    v_count := v_count + COALESCE((v_result->>'created')::integer, 0);
  END LOOP;
  RETURN v_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.emit_ce_mercante_billing(p_bl_ids text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_bl_id text;
  v_bl public.bls%ROWTYPE;
  v_one jsonb;
  v_wait jsonb;
  v_gate_refusal boolean;
  v_results jsonb := '[]'::jsonb;
  v_status text;
  v_state text;
  v_message text;
  v_pod text;
BEGIN
  IF v_actor IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuário sem permissão ativa.' USING ERRCODE = '42501';
  END IF;
  IF cardinality(COALESCE(p_bl_ids, ARRAY[]::text[])) > 50 THEN
    RAISE EXCEPTION 'No máximo 50 B/Ls por lote de emissão.' USING ERRCODE = '22023';
  END IF;

  FOREACH v_bl_id IN ARRAY COALESCE(p_bl_ids, ARRAY[]::text[]) LOOP
    BEGIN
      PERFORM 1 FROM public.bls WHERE id = v_bl_id FOR UPDATE;
      IF NOT FOUND THEN
        v_one := jsonb_build_object('status', 'blocked', 'reason', 'not_found', 'message', 'B/L não encontrado.');
      ELSIF EXISTS (SELECT 1 FROM public.bls WHERE id = v_bl_id AND (cancelled_at IS NOT NULL OR NULLIF(btrim(COALESCE(ce_mercante, '')), '') IS NULL)) THEN
        v_one := jsonb_build_object('status', 'skipped', 'reason', 'no_ce_or_cancelled');
      ELSIF EXISTS (SELECT 1 FROM public.bls WHERE id = v_bl_id AND COALESCE(financial_status, 'pending') <> 'pending')
            OR cardinality(public._live_local_invoice_ids_for_bl(v_bl_id)) > 0 THEN
        v_one := jsonb_build_object('status', 'already_invoiced');
      ELSE
        -- Tabela cadastrada depois da espera (decisão 4): o cálculo cuja única
        -- revisão era "nenhuma tabela ativa" é refeito antes da emissão. Outra
        -- linha em revisão é revisão de pessoa e fica.
        IF EXISTS (SELECT 1 FROM public.bls WHERE id = v_bl_id AND charge_status = 'review_required')
           AND EXISTS (
             SELECT 1 FROM public.charge_calculations AS c
             WHERE c.bl_id = v_bl_id AND c.status = 'review_required'
               AND COALESCE(c.review_reason, '') LIKE 'Nenhuma tabela de taxas ativa%')
           AND NOT EXISTS (
             SELECT 1 FROM public.charge_calculations AS c
             WHERE c.bl_id = v_bl_id AND c.status = 'review_required'
               AND COALESCE(c.review_reason, '') NOT LIKE 'Nenhuma tabela de taxas ativa%')
           AND EXISTS (SELECT 1 FROM public.resolve_bl_local_charge_table_ids(v_bl_id)) THEN
          PERFORM public.calculate_bl_local_charges(v_bl_id, v_actor, true);
        END IF;
        v_one := public._auto_bill_bl_core(v_bl_id, v_actor, true);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_message = MESSAGE_TEXT;
      v_one := jsonb_build_object('status', 'blocked', 'reason', 'auto_billing_failed',
        'message', public._ce_row_error_message(v_state, v_message), 'sqlstate', v_state);
    END;

    -- Esperas de negócio (K1): Cliente não conciliado e Revisão pendente não
    -- são falha. A recusa das travas de faturamento chega como 22023/P0003
    -- (`mark_bl_ready_for_billing`, `prevent_pending_review_invoice`); o
    -- estado do B/L diz qual espera é.
    v_wait := NULL;
    IF v_one->>'status' = 'blocked' THEN
      SELECT * INTO v_bl FROM public.bls WHERE id = v_bl_id;
      IF FOUND THEN
        v_gate_refusal := v_one->>'reason' = 'auto_billing_failed'
          AND COALESCE(v_one->>'sqlstate', '') IN ('22023', 'P0003');
        IF v_one->>'reason' = 'customer_reconciliation_pending'
           OR (v_gate_refusal AND (v_bl.customer_id IS NULL
             OR COALESCE(v_bl.customer_reconciliation_status, 'missing_customer') NOT IN ('matched_document', 'reconciled'))) THEN
          v_wait := jsonb_build_object('reason', 'customer_reconciliation_pending', 'waiting', true,
            'message', 'Aguardando conciliação do Cliente: a fatura sai quando o Cliente do B/L for conciliado.');
        -- Tabela de cobrança faltando para o POD e a modalidade (ADR 0079,
        -- decisão 4): espera de cadastro, não falha técnica nem Revisão. Vem da
        -- recusa da emissão (P0004) ou do cálculo que ficou em revisão por não
        -- achar tabela ativa. Um Alerta por POD e modalidade lista os B/Ls e
        -- fecha quando as faturas saem.
        ELSIF (v_one->>'reason' = 'auto_billing_failed'
               AND COALESCE(v_one->>'sqlstate', '') = 'P0004'
               AND COALESCE(v_one->>'message', '') ~* 'tabela de cobran')
           OR (v_gate_refusal
               AND EXISTS (
                 SELECT 1 FROM public.charge_calculations AS c
                 WHERE c.bl_id = v_bl_id AND c.status = 'review_required'
                   AND COALESCE(c.review_reason, '') LIKE 'Nenhuma tabela de taxas ativa%')
               AND NOT EXISTS (SELECT 1 FROM public.resolve_bl_local_charge_table_ids(v_bl_id))) THEN
          v_pod := COALESCE(public.normalize_port_code(v_bl.pod), NULLIF(upper(btrim(COALESCE(v_bl.pod, ''))), ''), '—');
          v_wait := jsonb_build_object('reason', 'charge_table_missing', 'waiting', true,
            'message', format('Aguardando tabela de cobrança: cadastre a tabela do POD %s (%s) em Taxas Locais › Tabelas; a fatura sai na próxima emissão.',
              v_pod, public._cargo_mode_label(v_bl.cargo_mode)));
          PERFORM public._note_charge_table_gap(v_pod, v_bl.cargo_mode, v_bl_id);
        ELSIF v_gate_refusal AND (
          v_bl.review_status = 'pending_review'
          OR v_bl.charge_status = 'review_required'
          OR EXISTS (SELECT 1 FROM public.charge_calculations AS c WHERE c.bl_id = v_bl_id AND c.status = 'review_required')
          OR COALESCE(cardinality(public.compute_bl_review_pendencies(v_bl_id)), 0) > 0
          OR COALESCE(cardinality(public.check_bl_terminal_pendencies(v_bl_id)), 0) > 0
          OR COALESCE(v_one->>'message', '') ~* '(revis|terminal)'
        ) THEN
          v_wait := jsonb_build_object('reason', 'review_pending', 'waiting', true,
            'message', 'Aguardando Revisão do B/L: a fatura sai quando a Revisão terminar.');
        -- Cálculo feito e nenhuma taxa com valor (decisão 4): nada a faturar,
        -- sem Alerta. Sem cálculo, continua falha.
        ELSIF v_one->>'reason' = 'auto_billing_failed'
              AND COALESCE(v_one->>'message', '') ~* 'sem linhas fatur'
              AND EXISTS (
                SELECT 1 FROM public.charge_calculations AS c
                WHERE c.bl_id = v_bl_id AND COALESCE(c.status, 'calculated') IN ('calculated', 'reviewed', 'ready_for_billing')
              ) THEN
          v_one := jsonb_build_object('status', 'skipped', 'reason', 'nothing_to_bill',
            'message', 'Nada a faturar: o cálculo do B/L não tem taxa com valor.');
        END IF;
      END IF;
      IF v_wait IS NOT NULL THEN
        v_one := v_one || v_wait;
      END IF;
    END IF;

    v_status := CASE
      WHEN v_one->>'status' IN ('invoiced', 'already_invoiced') THEN 'invoiced'
      WHEN v_one->>'status' = 'held' THEN 'held'
      WHEN v_one->>'status' = 'skipped' THEN 'skipped'
      ELSE 'blocked'
    END;
    IF v_status = 'blocked' AND v_wait IS NULL THEN
      -- Alerta por B/L (ADR 0041): a falha técnica não fica escondida no lote.
      BEGIN
        PERFORM public.upsert_billing_alert('billing_auto_issue_failed', v_bl_id,
          format('A emissão automática do B/L %s pelo CE Mercante falhou: %s', v_bl_id,
            COALESCE(NULLIF(btrim(v_one->>'message'), ''), 'erro sem mensagem (' || COALESCE(v_one->>'reason', 'desconhecido') || ')')),
          jsonb_build_object('bl_id', v_bl_id, 'reason', v_one->>'reason', 'sqlstate', v_one->>'sqlstate', 'source', 'ce_mercante_planilha'));
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'Alerta de emissão do B/L % não registrado: %', v_bl_id, SQLERRM;
      END;
    ELSIF v_status = 'invoiced' THEN
      -- A fatura saiu: a falha anterior deixa de valer.
      BEGIN
        PERFORM public.resolve_alert_item('billing_auto_issue_failed', 'bl', v_bl_id, 'ce_mercante_planilha',
          jsonb_build_object('resolution', 'invoiced'));
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'Alerta de emissão do B/L % não resolvido: %', v_bl_id, SQLERRM;
      END;
    ELSIF v_status = 'skipped' THEN
      -- Nada a faturar, isento, sem CE ou cancelado (212): o B/L não espera
      -- mais fatura. Sai da lista de tabela faltando e a falha anterior fecha,
      -- como quando a fatura sai.
      BEGIN
        PERFORM public.resolve_alert_item('billing_auto_issue_failed', 'bl', v_bl_id, 'ce_mercante_planilha',
          jsonb_build_object('resolution', 'no_longer_billable', 'reason', v_one->>'reason'));
        PERFORM public._drop_bls_from_charge_table_gaps(ARRAY[v_bl_id],
          'bl_' || COALESCE(NULLIF(v_one->>'reason', ''), 'skipped'));
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'Alertas do B/L % sem fatura a emitir não atualizados: %', v_bl_id, SQLERRM;
      END;
    END IF;
    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'bl_id', v_bl_id,
      'status', v_status,
      'reason', COALESCE(v_one->>'reason', v_one->>'status'),
      'message', v_one->>'message',
      'waiting', v_wait IS NOT NULL,
      'invoice_number', (SELECT i.invoice_number FROM public.invoices AS i
        WHERE i.id = ANY(public._live_local_invoice_ids_for_bl(v_bl_id)) ORDER BY i.id DESC LIMIT 1)
    ));
  END LOOP;

  RETURN jsonb_build_object('results', v_results);
END;
$function$;

CREATE OR REPLACE FUNCTION public.enqueue_import_effect(p_source_action_id uuid, p_effect_kind text, p_entity_id text, p_created_by uuid, p_source_revision bigint DEFAULT 1, p_depends_on_effect_id bigint DEFAULT NULL::bigint, p_source_snapshot jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_existing public.import_pending_effects%ROWTYPE;
  v_new public.import_pending_effects%ROWTYPE;
  v_entity text := NULLIF(btrim(COALESCE(p_entity_id, '')), '');
  v_snapshot jsonb := COALESCE(p_source_snapshot, '{}'::jsonb);
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND (auth.uid() IS NULL OR p_created_by IS DISTINCT FROM auth.uid() OR NOT public.is_active_user()) THEN
    RAISE EXCEPTION 'Usuário sem permissão ativa.' USING ERRCODE = '42501';
  END IF;
  IF p_source_action_id IS NULL OR p_effect_kind IS NULL OR v_entity IS NULL THEN
    RAISE EXCEPTION 'Identidade do efeito incompleta.' USING ERRCODE = '22023';
  END IF;
  IF p_source_revision IS NULL OR p_source_revision < 1 THEN
    RAISE EXCEPTION 'Revisao de origem invalida.' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(v_snapshot) <> 'object' THEN
    RAISE EXCEPTION 'Snapshot de origem invalido.' USING ERRCODE = '22023';
  END IF;
  IF p_depends_on_effect_id IS NOT NULL THEN
    PERFORM 1 FROM public.import_pending_effects WHERE id = p_depends_on_effect_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Dependencia de efeito inexistente.' USING ERRCODE = '22023';
    END IF;
  END IF;

  SELECT * INTO v_existing
  FROM public.import_pending_effects
  WHERE source_action_id = p_source_action_id
    AND effect_kind = p_effect_kind
    AND entity_id = v_entity
  FOR UPDATE;
  IF FOUND THEN
    RETURN jsonb_build_object('effect', to_jsonb(v_existing), 'idempotent', true);
  END IF;

  INSERT INTO public.import_pending_effects(
    source_action_id, effect_kind, entity_id, status, attempts, created_by,
    source_revision, source_snapshot, depends_on_effect_id, next_attempt_at, updated_at
  ) VALUES (
    p_source_action_id, p_effect_kind, v_entity, 'pending', 0, p_created_by,
    p_source_revision, v_snapshot, p_depends_on_effect_id, now(), now()
  ) RETURNING * INTO v_new;

  UPDATE public.import_pending_effects AS old
     SET status = 'superseded',
         superseded_by_effect_id = v_new.id,
         lease_until = NULL,
         leased_by = NULL,
         result = COALESCE(old.result, '{}'::jsonb)
           || jsonb_build_object('superseded_by_effect_id', v_new.id),
         updated_at = now()
   WHERE old.id <> v_new.id
     AND old.entity_id = v_entity
     AND old.effect_kind = p_effect_kind
     AND (
       -- O efeito novo substitui o que ainda não rodou, qualquer revisão.
       (old.status IN ('pending', 'retry_wait') AND old.source_revision <= p_source_revision)
       OR (old.status = 'running' AND old.source_revision < p_source_revision)
     );

  RETURN jsonb_build_object('effect', to_jsonb(v_new), 'idempotent', false);
END;
$function$;

CREATE OR REPLACE FUNCTION public.ensure_agency_departure_report(p_voyage_id bigint, p_port text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_report_id UUID;
  v_port TEXT := upper(btrim(COALESCE(p_port, '')));
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_read_user() THEN
    RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501';
  END IF;
  IF v_port = '' THEN
    RAISE EXCEPTION 'Porto obrigatorio.' USING ERRCODE = '22023';
  END IF;

  PERFORM 1 FROM public.voyages WHERE id = p_voyage_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Viagem nao encontrada.' USING ERRCODE = 'P0002';
  END IF;

  SELECT id INTO v_report_id
  FROM public.agency_departure_reports
  WHERE voyage_id = p_voyage_id AND port = v_port AND terminal_id IS NULL
  FOR UPDATE;
  IF FOUND THEN
    RETURN v_report_id;
  END IF;

  -- B6: escala com frente de operação (gravada ou derivada dos dados, como na
  -- aba ADR) é do modelo terminalizado. Sem terminal atribuído (frentes TBC)
  -- não há ADR a abrir; o ADR legado por porto só continua para as escalas sem
  -- frente e para os relatórios que já existem.
  IF public._escala_has_operation_fronts(p_voyage_id, v_port) THEN
    RAISE EXCEPTION 'Escala com frentes de operacao: atribua o terminal as frentes para abrir o ADR do terminal.'
      USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.agency_departure_reports (voyage_id, port)
  VALUES (p_voyage_id, v_port)
  RETURNING id INTO v_report_id;
  RETURN v_report_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_agency_report_actor_names(p_voyage_id bigint, p_port text)
 RETURNS TABLE(user_id uuid, full_name text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_report_id UUID;
  v_prefix TEXT := p_voyage_id || '::' || upper(btrim(p_port)) || '::';
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_read_user() THEN
    RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501';
  END IF;
  SELECT id INTO v_report_id
  FROM public.agency_departure_reports
  WHERE voyage_id = p_voyage_id
    AND port = upper(btrim(p_port))
    AND terminal_id IS NULL;
  IF v_report_id IS NULL THEN RETURN; END IF;
  RETURN QUERY SELECT up.id, up.full_name FROM public.user_profiles AS up
  WHERE up.id IN (
    SELECT r.closed_by FROM public.agency_departure_reports AS r WHERE r.id = v_report_id AND r.closed_by IS NOT NULL
    UNION SELECT so.signed_by FROM public.agency_departure_report_signoffs AS so WHERE so.report_id = v_report_id AND so.signed_by IS NOT NULL
    UNION SELECT dso.signed_by FROM public.agency_departure_report_department_signoffs AS dso WHERE dso.report_id = v_report_id AND dso.signed_by IS NOT NULL
    UNION SELECT oc.author_id FROM public.agency_departure_report_occurrences AS oc WHERE oc.report_id = v_report_id
    UNION SELECT al.changed_by FROM public.audit_logs AS al
      WHERE al.entity_type IN ('agency_departure_report_signoff', 'agency_departure_report_department_signoff')
        AND al.entity_id LIKE v_prefix || '%' AND al.changed_by IS NOT NULL
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_agency_report_actor_names_by_report_id(p_report_id uuid)
 RETURNS TABLE(user_id uuid, full_name text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_read_user() THEN
    RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT up.id, up.full_name FROM public.user_profiles AS up
  WHERE up.id IN (
    SELECT r.closed_by FROM public.agency_departure_reports AS r WHERE r.id = p_report_id AND r.closed_by IS NOT NULL
    UNION SELECT so.signed_by FROM public.agency_departure_report_signoffs AS so WHERE so.report_id = p_report_id AND so.signed_by IS NOT NULL
    UNION SELECT dso.signed_by FROM public.agency_departure_report_department_signoffs AS dso WHERE dso.report_id = p_report_id AND dso.signed_by IS NOT NULL
    UNION SELECT oc.author_id FROM public.agency_departure_report_occurrences AS oc WHERE oc.report_id = p_report_id
    UNION SELECT al.changed_by FROM public.audit_logs AS al
      WHERE al.entity_type IN ('agency_departure_report_signoff', 'agency_departure_report_department_signoff')
        AND al.entity_id LIKE p_report_id::TEXT || '::%' AND al.changed_by IS NOT NULL
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_agency_report_closer_name(p_voyage_id bigint, p_port text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_closed_by UUID;
  v_closer_name TEXT;
BEGIN
  -- Espelha a policy SELECT de agency_departure_reports: quem nao pode ler o
  -- ADR tambem nao pode resolver o perfil do seu autor.
  IF auth.uid() IS NULL OR NOT public.is_active_read_user() THEN
    RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501';
  END IF;

  SELECT closed_by INTO v_closed_by
  FROM public.agency_departure_reports
  WHERE voyage_id = p_voyage_id
    AND port = upper(btrim(p_port));

  IF v_closed_by IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT full_name INTO v_closer_name
  FROM public.user_profiles
  WHERE id = v_closed_by;

  RETURN v_closer_name;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_billing_run_details(p_billing_run_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_run JSONB;
  v_logs JSONB;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_read_user() THEN
    RAISE EXCEPTION 'Usuário sem permissão ativa' USING ERRCODE = '42501';
  END IF;

  SELECT to_jsonb(br.*) || jsonb_build_object('filename', ib.filename)
  INTO v_run
  FROM public.billing_runs AS br
  JOIN public.import_batches AS ib ON ib.id = br.manifest_id
  WHERE br.id = p_billing_run_id;

  IF v_run IS NULL THEN
    RAISE EXCEPTION 'Billing run % nao encontrado.', p_billing_run_id USING ERRCODE = 'P0002';
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(log_row) ORDER BY log_row.created_at DESC), '[]'::JSONB)
  INTO v_logs
  FROM (
    SELECT *
    FROM public.billing_run_logs
    WHERE billing_run_id = p_billing_run_id
    ORDER BY created_at DESC
    LIMIT 300
  ) AS log_row;

  RETURN jsonb_build_object('run', v_run, 'logs', v_logs);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_bl_portal_status(p_bl_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_customer_id BIGINT;
  v_ce_mercante TEXT;
  v_account_situation TEXT;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_read_user() THEN
    RAISE EXCEPTION 'Usuário sem permissão ativa.' USING ERRCODE = '42501';
  END IF;

  SELECT b.customer_id, b.ce_mercante
  INTO v_customer_id, v_ce_mercante
  FROM public.bls b
  WHERE b.id = p_bl_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L % nao encontrado', p_bl_id USING ERRCODE = 'P0002';
  END IF;

  SELECT a.account_situation
  INTO v_account_situation
  FROM public.customer_portal_accounts a
  WHERE a.customer_id = v_customer_id;

  RETURN jsonb_build_object(
    'customer_id', v_customer_id,
    'ce_mercante', v_ce_mercante,
    'account_situation', v_account_situation,
    'portal_access_ready', public.customer_portal_access_ready(v_customer_id),
    'billing_access_ready', public.customer_billing_access_ready(v_customer_id),
    'notifications', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', n.id,
        'type', n.type,
        'title', n.title,
        'created_at', n.created_at,
        'read_at', n.read_at
      ) ORDER BY n.created_at DESC)
      FROM (
        SELECT id, type, title, created_at, read_at
        FROM public.portal_notifications
        WHERE bl_id = p_bl_id
        ORDER BY created_at DESC
        LIMIT 10
      ) n
    ), '[]'::JSONB),
    'open_disputes', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', d.id,
        'doc_number', d.doc_number,
        'dispute_status', d.dispute_status
      ) ORDER BY d.id DESC)
      FROM public.demurrage_invoices d
      WHERE d.bl_id = p_bl_id
        AND d.dispute_open = true
    ), '[]'::JSONB)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_customer_pending_balances(p_customer_ids bigint[] DEFAULT NULL::bigint[])
 RETURNS TABLE(customer_id bigint, local_balance_brl numeric, demurrage_balance_brl numeric, total_balance_brl numeric, invoiced_open_brl numeric, to_invoice_brl numeric, manual_balance_brl numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_read_user() THEN
    RAISE EXCEPTION 'Usuário sem permissão para consultar saldos.' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH receivables AS (
    SELECT r.customer_id, r.balance_brl,
      EXISTS (
        SELECT 1 FROM public.invoice_receivable_links l JOIN public.invoices i ON i.id = l.invoice_id
        WHERE l.receivable_id = r.id AND l.status = 'active'
          AND i.invoice_type IN ('individual', 'consolidated')
          AND coalesce(i.status, 'issued') IN ('issued', 'partially_paid')
      ) AS invoiced
    FROM public.bl_receivables r
    WHERE r.status IN ('open', 'partially_settled')
      AND (p_customer_ids IS NULL OR r.customer_id = ANY(p_customer_ids))
  ), local_totals AS (
    SELECT x.customer_id,
      sum(x.balance_brl) AS amount,
      sum(x.balance_brl) FILTER (WHERE x.invoiced) AS invoiced_amount,
      sum(x.balance_brl) FILTER (WHERE NOT x.invoiced) AS to_invoice_amount
    FROM receivables x
    GROUP BY x.customer_id
  ), demurrage_totals AS (
    SELECT d.customer_id, sum(greatest(coalesce(d.current_total_brl, 0), 0)) AS amount
    FROM public.demurrage_invoices d
    WHERE d.status IN ('issued', 'overdue')
      AND (p_customer_ids IS NULL OR d.customer_id = ANY(p_customer_ids))
    GROUP BY d.customer_id
  ), manual_totals AS (
    SELECT m.customer_id, sum(greatest(coalesce(m.balance_brl, 0), 0)) AS amount
    FROM public.invoices m
    WHERE m.invoice_type = 'manual' AND coalesce(m.status, 'issued') IN ('issued', 'partially_paid')
      AND (p_customer_ids IS NULL OR m.customer_id = ANY(p_customer_ids))
    GROUP BY m.customer_id
  ), customers_with_balance AS (
    SELECT lt.customer_id FROM local_totals lt
    UNION SELECT dt.customer_id FROM demurrage_totals dt
    UNION SELECT mt.customer_id FROM manual_totals mt
  )
  SELECT c.customer_id,
    coalesce(l.amount, 0),
    coalesce(d.amount, 0),
    coalesce(l.invoiced_amount, 0) + coalesce(d.amount, 0) + coalesce(m.amount, 0) + coalesce(l.to_invoice_amount, 0),
    coalesce(l.invoiced_amount, 0) + coalesce(d.amount, 0) + coalesce(m.amount, 0),
    coalesce(l.to_invoice_amount, 0),
    coalesce(m.amount, 0)
  FROM customers_with_balance c
  LEFT JOIN local_totals l ON l.customer_id = c.customer_id
  LEFT JOIN demurrage_totals d ON d.customer_id = c.customer_id
  LEFT JOIN manual_totals m ON m.customer_id = c.customer_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_customer_portal_account(p_customer_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_result JSONB;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_read_user() THEN
    RAISE EXCEPTION 'Usuário sem permissão.' USING ERRCODE = '42501';
  END IF;
  SELECT to_jsonb(t.*) INTO v_result
  FROM (SELECT a.id, a.customer_id, a.contact_email, a.active, a.auth_user_id, a.portal_email, a.login_cnpj, a.created_by, a.last_login_at, a.created_at, a.updated_at
        FROM public.customer_portal_accounts a WHERE a.customer_id = p_customer_id) t;
  RETURN COALESCE(v_result, '{}'::jsonb);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_customer_receivables(p_customer_id bigint)
 RETURNS TABLE(id bigint, bl_id text, original_amount_brl numeric, settled_amount_brl numeric, balance_brl numeric, status text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuário sem permissão ativa.' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT r.id, r.bl_id, r.original_amount_brl, r.settled_amount_brl, r.balance_brl, r.status
  FROM public.bl_receivables r
  WHERE r.customer_id = p_customer_id
  ORDER BY r.updated_at DESC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_invoice_reissue_links(p_invoice_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_invoice record;
  v_replaces jsonb;
  v_replaced_by jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_read_user() THEN
    RAISE EXCEPTION 'Usuário sem permissão ativa.' USING ERRCODE = '42501';
  END IF;

  SELECT id, status, replaces_invoice_id, reissue_requested_at, reissue_closed_at, reissue_closed_reason INTO v_invoice
  FROM public.invoices WHERE id = p_invoice_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice % nao encontrada.', p_invoice_id USING ERRCODE = 'P0002';
  END IF;

  SELECT jsonb_build_object('id', p.id, 'invoice_number', p.invoice_number) INTO v_replaces
  FROM public.invoices p WHERE p.id = v_invoice.replaces_invoice_id;

  SELECT jsonb_build_object('id', s.id, 'invoice_number', s.invoice_number) INTO v_replaced_by
  FROM public.invoices s WHERE s.replaces_invoice_id = p_invoice_id;

  RETURN jsonb_build_object(
    'replaces', v_replaces,
    'replaced_by', v_replaced_by,
    'reissue_pending', v_invoice.reissue_requested_at IS NOT NULL AND v_invoice.reissue_closed_at IS NULL AND v_replaced_by IS NULL,
    'reissue_closed_reason', v_invoice.reissue_closed_reason
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_user_display_names(p_user_ids uuid[])
 RETURNS TABLE(user_id uuid, full_name text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_read_user() THEN
    RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(cardinality(p_user_ids), 0) > 500 THEN
    RAISE EXCEPTION 'No máximo 500 autores por consulta.' USING ERRCODE = '22023';
  END IF;
  -- Só o nome: e-mail, setor e situação continuam do Administrativo. Usuário
  -- desativado mantém o nome, porque o Histórico é do que já aconteceu.
  RETURN QUERY
  SELECT up.id, up.full_name
  FROM public.user_profiles AS up
  WHERE up.id = ANY(COALESCE(p_user_ids, ARRAY[]::uuid[]));
END;
$function$;

CREATE OR REPLACE FUNCTION public.guard_bl_customer_unlink()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF OLD.customer_id IS NOT NULL AND NEW.customer_id IS NULL AND NEW.cancelled_at IS NULL
     AND (coalesce(NEW.financial_status, 'pending') IN ('invoiced', 'partially_paid', 'paid')
          OR cardinality(public._live_local_invoice_ids_for_bl(NEW.id)) > 0) THEN
    RAISE EXCEPTION 'O B/L % já foi faturado: não se desvincula o Cliente. Use Trocar Cliente.', NEW.id
      USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.guard_ce_mercante_unique()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_key text := public.ce_mercante_key(NEW.ce_mercante);
  v_holder text;
  v_new jsonb := to_jsonb(NEW);
  v_old jsonb := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) END;
  v_self text := NEW.id::text;
  v_reactivation boolean;
BEGIN
  -- Granito não tem cancelamento; o jsonb evita ler coluna inexistente.
  v_reactivation := TG_TABLE_NAME = 'bls' AND TG_OP = 'UPDATE'
    AND v_old->>'cancelled_at' IS NOT NULL AND v_new->>'cancelled_at' IS NULL;
  IF v_key IS NULL THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME = 'bls' AND v_new->>'cancelled_at' IS NOT NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NOT v_reactivation
     AND public.ce_mercante_key(v_old->>'ce_mercante') IS NOT DISTINCT FROM v_key THEN
    RETURN NEW;
  END IF;

  -- Serializa o mesmo CE: a segunda transação espera e vê o B/L da primeira.
  PERFORM pg_advisory_xact_lock(hashtextextended('ce_mercante:' || v_key, 0));

  SELECT holder INTO v_holder FROM (
    SELECT 'B/L ' || b.id AS holder
    FROM public.bls AS b
    WHERE b.cancelled_at IS NULL
      AND public.ce_mercante_key(b.ce_mercante) = v_key
      AND (TG_TABLE_NAME <> 'bls' OR b.id <> v_self)
    UNION ALL
    SELECT 'B/L de Granito ' || g.bl_number
    FROM public.granite_bls AS g
    WHERE public.ce_mercante_key(g.ce_mercante) = v_key
      AND (TG_TABLE_NAME <> 'granite_bls' OR g.id::text <> v_self)
  ) AS holders
  ORDER BY holder
  LIMIT 1;

  IF v_holder IS NOT NULL THEN
    IF v_reactivation THEN
      RAISE EXCEPTION 'O B/L % não pode ser reativado: o CE Mercante % dele está agora no %. Um CE só pode estar em um B/L não cancelado.',
        v_self, NEW.ce_mercante, v_holder USING ERRCODE = 'P0010';
    END IF;
    RAISE EXCEPTION 'O CE Mercante % ja esta no %. Um CE so pode estar em um B/L nao cancelado: confira o numero ou cancele o outro B/L.',
      NEW.ce_mercante, v_holder USING ERRCODE = 'P0010';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.guard_single_open_consolidated()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.status <> 'active' THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM public.invoices i WHERE i.id = NEW.invoice_id AND i.invoice_type = 'consolidated'
               AND coalesce(i.status, 'issued') IN ('draft', 'issued', 'partially_paid'))
     AND EXISTS (SELECT 1 FROM public.invoice_receivable_links l JOIN public.invoices o ON o.id = l.invoice_id
               WHERE l.receivable_id = NEW.receivable_id AND l.invoice_id <> NEW.invoice_id AND l.status = 'active'
                 AND o.invoice_type = 'consolidated' AND coalesce(o.status, 'issued') IN ('draft', 'issued', 'partially_paid')) THEN
    RAISE EXCEPTION 'O B/L % já está em outra consolidada aberta.', NEW.bl_id USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.import_baplie_file_atomic(p_voyage_id bigint, p_rows jsonb, p_pods text[], p_expected jsonb, p_file jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET statement_timeout TO '60s'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_voyage public.voyages%ROWTYPE;
  v_codes text[];
  v_rows jsonb;
  v_other_carrier integer;
  v_pod_keys text[];
  v_incoming text[];
  v_eligible text[];
  v_omitted text[];
  v_sem_escala text[] := '{}';
  v_list text;
  v_count integer;
  v_current jsonb;
  v_previous_total integer;
  v_replaced integer;
  v_staged integer;
  v_total integer;
  v_empties_before text;
  v_empties_after text;
  v_role text;
  v_flags jsonb;
  v_vazios jsonb;
  v_manifest jsonb;
BEGIN
  IF v_actor IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuário sem permissão para importar Baplie.' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(COALESCE(p_rows, 'null'::jsonb)) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION 'O Baplie não tem nenhum container: confira o arquivo antes de importar. O Baplie anterior da viagem foi mantido.'
      USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_rows) AS r(value) WHERE jsonb_typeof(r.value) <> 'object') THEN
    RAISE EXCEPTION 'Linha do Baplie inválida: nada foi gravado.' USING ERRCODE = '22023';
  END IF;
  IF p_pods IS NULL THEN
    RAISE EXCEPTION 'Informe os portos de descarga que este Baplie substitui: nada foi gravado.' USING ERRCODE = '22023';
  END IF;

  PERFORM public._lock_import_voyages(ARRAY[p_voyage_id]);
  PERFORM public._set_import_context('Baplie', p_voyage_id, NULL);

  SELECT * INTO v_voyage FROM public.voyages WHERE id = p_voyage_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Viagem de destino não encontrada.' USING ERRCODE = 'P0002';
  END IF;

  -- 409 (ADR 0096, decisão 2): o número de viagem do Baplie não é conferido
  -- com o da Viagem (o armador não usa o mesmo número); navio, armador e
  -- escalas continuam conferidos. `p_file` segue aceito por compatibilidade.

  -- 403 (decisão 14): container de outro armador (pelos códigos do armador da
  -- Viagem) não entra no staging, nas marcas nem na conciliação; só é contado.
  v_codes := public._baplie_carrier_codes(p_voyage_id);
  SELECT COALESCE(jsonb_agg(r.value) FILTER (WHERE NOT public._baplie_other_carrier(r.value->>'operator', v_codes)), '[]'::jsonb),
         count(*) FILTER (WHERE public._baplie_other_carrier(r.value->>'operator', v_codes))
    INTO v_rows, v_other_carrier
  FROM jsonb_array_elements(p_rows) AS r(value);
  IF jsonb_array_length(v_rows) = 0 THEN
    RAISE EXCEPTION 'Nenhum container a importar: os % container(s) do arquivo são de outro armador (códigos do armador da Viagem: %). O Baplie anterior da viagem foi mantido.',
      v_other_carrier, array_to_string(v_codes, ', ')
      USING ERRCODE = '22023';
  END IF;

  SELECT string_agg(n, ', ' ORDER BY n), count(*) INTO v_list, v_count FROM (
    SELECT upper(btrim(r.value->>'container_number')) AS n
    FROM jsonb_array_elements(v_rows) AS r(value)
    GROUP BY 1 HAVING count(*) > 1 ORDER BY 1 LIMIT 20
  ) AS d;
  IF v_count > 0 THEN
    RAISE EXCEPTION 'Container repetido no Baplie (%): nada foi gravado. Confira o arquivo.', v_list USING ERRCODE = '22023';
  END IF;

  v_pod_keys := ARRAY(SELECT DISTINCT public._baplie_port_key(p) FROM unnest(p_pods) AS p WHERE NULLIF(btrim(COALESCE(p, '')), '') IS NOT NULL);
  SELECT string_agg(DISTINCT r.value->>'pod', ', '), count(*) INTO v_list, v_count
  FROM jsonb_array_elements(v_rows) AS r(value)
  WHERE NULLIF(btrim(COALESCE(r.value->>'pod', '')), '') IS NOT NULL
    AND NOT (public._baplie_port_key(r.value->>'pod') = ANY(v_pod_keys));
  IF v_count > 0 THEN
    RAISE EXCEPTION '% container(s) com porto de descarga fora dos portos marcados (%): nada foi gravado.', v_count, v_list
      USING ERRCODE = '22023';
  END IF;

  SELECT string_agg(k, ', ' ORDER BY k), count(*) INTO v_list, v_count
  FROM unnest(v_pod_keys) AS k
  WHERE NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_rows) AS r(value)
    WHERE NULLIF(btrim(COALESCE(r.value->>'pod', '')), '') IS NOT NULL
      AND public._baplie_port_key(r.value->>'pod') = k
  );
  IF v_count > 0 THEN
    RAISE EXCEPTION 'Porto(s) marcado(s) sem nenhum container no arquivo (%): gravar apagaria o Baplie, as marcas e os vazios já gravados desse(s) porto(s). Desmarque o porto ou confira o arquivo. Nada foi gravado.', v_list
      USING ERRCODE = '22023';
  END IF;

  v_eligible := ARRAY(SELECT DISTINCT public._baplie_port_key(e.pod) FROM public.get_voyage_eligible_pods(p_voyage_id) AS e);
  IF cardinality(v_eligible) > 0 THEN
    -- 418 (D1 revisado pelo dono em 2026-10-23): o Baplie nunca cria escala nem
    -- depende dela. Porto brasileiro marcado que não é escala da Viagem entra
    -- sem escala; os containers ficam no Baplie, pendentes de conciliação com
    -- B/L, até a escala ser criada (Chegadas e Saídas, programação ou à mão).
    -- Porto estrangeiro fora das escalas continua fora (a prévia o ignora).
    SELECT string_agg(DISTINCT r.value->>'pod', ', '), count(*) INTO v_list, v_count
    FROM jsonb_array_elements(v_rows) AS r(value)
    WHERE NULLIF(btrim(COALESCE(r.value->>'pod', '')), '') IS NOT NULL
      AND NOT (public._baplie_port_key(r.value->>'pod') = ANY(v_eligible))
      AND public._baplie_port_key(r.value->>'pod') !~ '^BR[A-Z0-9]{3}$';
    IF v_count > 0 THEN
      RAISE EXCEPTION '% container(s) descarregam em porto estrangeiro fora das escalas da Viagem (%): a prévia os deixa de fora. Nada foi gravado.', v_count, v_list
        USING ERRCODE = '22023';
    END IF;

    -- Escala omitida é a declaração de que o navio não passa no porto: o Baplie
    -- não a contradiz (a omissão é revertida na Viagem).
    v_omitted := ARRAY(
      SELECT DISTINCT public.normalize_port_code(split_part(l.entity_id, '::', 2))
      FROM (
        SELECT DISTINCT ON (a.entity_id) a.entity_id, a.new_value
        FROM public.audit_logs a
        WHERE a.entity_type = 'voyage_pod_schedule'
          AND a.entity_id LIKE p_voyage_id::text || '::%'
          AND a.field_name = 'omitted'
        ORDER BY a.entity_id, a.changed_at DESC, a.id DESC
      ) l
      WHERE l.new_value = 'true');
    SELECT string_agg(k, ', ' ORDER BY k) INTO v_list
    FROM unnest(v_pod_keys) AS k
    WHERE NOT (k = ANY(v_eligible)) AND public.normalize_port_code(k) = ANY(v_omitted);
    IF v_list IS NOT NULL THEN
      RAISE EXCEPTION 'A escala de % foi omitida: reverta a omissão na Viagem antes de importar containers para ela. Nada foi gravado.', v_list
        USING ERRCODE = '22023';
    END IF;

    v_sem_escala := ARRAY(SELECT k FROM unnest(v_pod_keys) AS k WHERE NOT (k = ANY(v_eligible)) ORDER BY k);
  END IF;

  v_current := public._baplie_staging_version(p_voyage_id);
  IF jsonb_typeof(p_expected) IS DISTINCT FROM 'object'
     OR (p_expected->'count') IS DISTINCT FROM (v_current->'count')
     OR (p_expected->'max_id') IS DISTINCT FROM (v_current->'max_id') THEN
    RAISE EXCEPTION 'O Baplie desta viagem mudou depois da prévia (outra importação foi gravada). Escolha o arquivo de novo para conferir a diferença. Nada foi gravado.'
      USING ERRCODE = '22023';
  END IF;

  v_manifest := public._baplie_vazios_manifest_version(p_voyage_id);
  IF (p_expected->'vazios_manifest') IS DISTINCT FROM v_manifest THEN
    RAISE EXCEPTION 'Os vazios de importação do Baplie desta viagem mudaram depois da prévia (outra sessão recadastrou, alterou ou apagou o manifesto de vazios). Escolha o arquivo de novo para conferir a diferença. Nada foi gravado.'
      USING ERRCODE = '22023';
  END IF;
  v_previous_total := (v_current->>'count')::integer;

  v_incoming := ARRAY(SELECT DISTINCT upper(btrim(r.value->>'container_number')) FROM jsonb_array_elements(v_rows) AS r(value));
  -- Vazio em transbordo não é vazio de importação (decisão 15).
  SELECT COALESCE(string_agg(upper(btrim(container_number)) || '|' || COALESCE(pol, '') || '|' || COALESCE(pod, ''), ',' ORDER BY 1), '')
    INTO v_empties_before
  FROM public.baplie_containers WHERE voyage_id = p_voyage_id AND status = 'empty' AND NOT is_transshipment;

  PERFORM set_config('alerts.baplie_coverage_deferred', 'on', true);
  DELETE FROM public.baplie_containers AS b
  WHERE b.voyage_id = p_voyage_id
    AND public._baplie_row_replaced(b.pod, b.container_number, v_pod_keys, v_incoming);
  GET DIAGNOSTICS v_replaced = ROW_COUNT;

  INSERT INTO public.baplie_containers (
    voyage_id, container_number, size_type, status, weight_kg, pol, pod, final_dest, bl_ref, slot,
    is_imo, imo_class, un_number, is_oog, ownership, is_transshipment, imported_by
  )
  SELECT
    p_voyage_id, row.container_number, row.size_type, row.status, row.weight_kg, row.pol, row.pod,
    row.final_dest, row.bl_ref, row.slot, row.is_imo, row.imo_class, row.un_number, row.is_oog,
    CASE WHEN upper(btrim(row.ownership)) IN ('SOC', 'COC') THEN upper(btrim(row.ownership)) END,
    COALESCE(row.is_transshipment, false),
    v_actor
  FROM jsonb_to_recordset(v_rows) AS row(
    container_number text, size_type text, status text, weight_kg numeric, pol text, pod text,
    final_dest text, bl_ref text, slot text, is_imo boolean, imo_class text, un_number text,
    is_oog boolean, ownership text, is_transshipment boolean
  );
  GET DIAGNOSTICS v_staged = ROW_COUNT;

  SELECT count(*) INTO v_total FROM public.baplie_containers WHERE voyage_id = p_voyage_id;
  v_role := public.current_actor_role();
  INSERT INTO public.audit_logs(
    entity_type, entity_id, field_name, old_value, new_value,
    changed_by, justification, actor_role, actor_department
  ) VALUES (
    'voyage', p_voyage_id::text, 'baplie_import',
    v_previous_total::text, v_total::text,
    v_actor,
    CASE WHEN v_previous_total > 0 THEN 'Baplie substituído' ELSE 'Baplie importado' END
      || COALESCE(' (portos ' || NULLIF(array_to_string(ARRAY(SELECT unnest(v_pod_keys) ORDER BY 1), ', '), '') || ')', '')
      || CASE WHEN v_other_carrier > 0 THEN '; ' || v_other_carrier || ' container(s) de outro armador fora' ELSE '' END,
    v_role, v_role
  );

  PERFORM set_config('alerts.baplie_coverage_deferred', 'off', true);
  PERFORM public.reconcile_voyage_baplie_coverage_alerts(p_voyage_id, 'baplie_coverage_import');
  PERFORM public.reconcile_voyage_baplie_missing_alerts(p_voyage_id, 'baplie_import');

  v_flags := public.apply_baplie_physical_flags_atomic(p_voyage_id, NULL, v_actor);

  SELECT COALESCE(string_agg(upper(btrim(container_number)) || '|' || COALESCE(pol, '') || '|' || COALESCE(pod, ''), ',' ORDER BY 1), '')
    INTO v_empties_after
  FROM public.baplie_containers WHERE voyage_id = p_voyage_id AND status = 'empty' AND NOT is_transshipment;
  IF v_empties_after IS DISTINCT FROM v_empties_before
     AND EXISTS (SELECT 1 FROM public.vazios_importacao_manifests WHERE voyage_id = p_voyage_id AND source = 'baplie') THEN
    v_vazios := public.replace_vazios_from_baplie_transactional(p_voyage_id, NULL, v_actor, true);
  END IF;

  RETURN jsonb_build_object(
    'voyage_id', p_voyage_id,
    'staged', v_staged,
    'replaced', v_replaced,
    'previous_total', v_previous_total,
    'total', v_total,
    'pods', to_jsonb(v_pod_keys),
    'other_carrier', v_other_carrier,
    'flags', v_flags,
    'vazios', v_vazios,
    'portos_sem_escala', to_jsonb(v_sem_escala)
  );
END $function$;

CREATE OR REPLACE FUNCTION public.import_bl_freight_file_atomic_core_405(p_bls jsonb, p_changed_by uuid, p_batch jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET statement_timeout TO '60s'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_result jsonb;
  v_item jsonb;
  v_items jsonb := '[]'::jsonb;
  v_id text;
  v_bl record;
  v_exists boolean;
  v_invoiced boolean;
  v_file_voyage bigint;
  v_doc text;
  v_given bigint;
  v_resolved bigint;
  v_customer_doc text;
  v_texts text;
  v_skipped jsonb := '[]'::jsonb;
  v_refix text[] := ARRAY[]::text[];
  v_refixed jsonb := '[]'::jsonb;
BEGIN
  IF v_actor IS NULL OR NOT public.is_active_user() OR p_changed_by IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'Usuário sem permissão ativa.' USING ERRCODE = '42501';
  END IF;
  IF p_bls IS NULL OR jsonb_typeof(p_bls) <> 'array' OR jsonb_array_length(p_bls) = 0 THEN
    RAISE EXCEPTION 'Nenhum B/L informado.' USING ERRCODE = '22023';
  END IF;

  -- 387: trava das Viagens antes da primeira escrita (ADR 0095, decisão 6).
  PERFORM public._lock_import_voyages_of_bls(
    public._import_payload_voyage_ids(p_bls, 'voyage_id')
      || public._import_payload_voyage_ids(jsonb_build_array(COALESCE(p_batch, '{}'::jsonb)), 'voyage_id'),
    public._import_payload_texts(p_bls, 'id'));

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_bls) LOOP
    v_id := NULLIF(btrim(COALESCE(v_item->>'id', '')), '');
    IF v_id IS NULL THEN
      RAISE EXCEPTION 'B/L sem número no arquivo.' USING ERRCODE = '22023';
    END IF;
    v_file_voyage := NULLIF(v_item->>'voyage_id', '')::bigint;

    SELECT b.voyage_id, b.cancelled_at INTO v_bl FROM public.bls b WHERE b.id = v_id;
    v_exists := FOUND;
    v_invoiced := false;
    IF v_exists THEN
      -- Decisão 5: a importação não move B/L entre Viagens.
      IF v_bl.voyage_id IS DISTINCT FROM v_file_voyage THEN
        IF v_bl.cancelled_at IS NOT NULL THEN
          RAISE EXCEPTION 'O B/L % está cancelado na Viagem %: o número continua lá. Exclua o B/L na Viagem % e importe de novo.',
            v_id, public._voyage_label(v_bl.voyage_id), public._voyage_label(v_bl.voyage_id) USING ERRCODE = '22023';
        END IF;
        RAISE EXCEPTION 'O B/L % já está na Viagem %: exclua o B/L lá e importe de novo (cancelar não libera o número).',
          v_id, public._voyage_label(v_bl.voyage_id) USING ERRCODE = '22023';
      END IF;
      -- Decisão 8 (ADR 0092): B/L cancelado é aviso e não é tocado.
      IF v_bl.cancelled_at IS NOT NULL THEN
        v_skipped := v_skipped || jsonb_build_object('bl_id', v_id, 'message',
          format('B/L %s está cancelado e não foi alterado: para importar, reative o B/L pela ficha (Administrativo) e importe de novo.', v_id));
        CONTINUE;
      END IF;
      v_invoiced := public._bl_has_emitted_local_invoice(v_id);
    END IF;

    -- Decisão 26: a aba VIN não é fonte de veículos.
    v_item := v_item - 'vehicles' - 'confirm_vehicle_changes';

    -- Decisão 10 (F-05): a confirmação de faturamento só vale para B/L com
    -- fatura emitida e com o impacto que a prévia mostrou.
    IF COALESCE(NULLIF(v_item->>'override_billing', '')::boolean, false) THEN
      IF NOT v_invoiced THEN
        RAISE EXCEPTION 'B/L %: a confirmação de faturamento só vale para B/L com fatura emitida. Refaça a prévia e importe de novo.', v_id
          USING ERRCODE = '22023';
      END IF;
      IF NOT COALESCE(NULLIF(v_item->>'billing_impact', '')::boolean, false) THEN
        RAISE EXCEPTION 'B/L %: a confirmação de faturamento chegou sem o impacto mostrado na prévia. Refaça a prévia e importe de novo.', v_id
          USING ERRCODE = '22023';
      END IF;
    END IF;
    IF NOT v_invoiced THEN
      v_item := v_item || jsonb_build_object('override_billing', false, 'billing_impact', false);
    END IF;

    -- F-15: o Cliente sai do CNPJ normalizado do consignatário.
    v_doc := public.normalize_document_text(v_item->>'manifest_customer_cnpj_cpf');
    v_given := NULLIF(v_item->>'customer_id', '')::bigint;
    v_resolved := NULL;
    IF v_doc IS NOT NULL THEN
      SELECT min(c.id) INTO v_resolved FROM public.customers c
      WHERE c.deactivated_at IS NULL AND public.normalize_document_text(c.cnpj_cpf) = v_doc
      HAVING count(*) = 1;
    END IF;
    IF v_given IS NOT NULL AND v_resolved IS DISTINCT FROM v_given THEN
      -- Sem CNPJ do consignatário, a prévia aceita o único CNPJ lido no bloco
      -- do consignatário ou na descrição da carga (customerReconciliation.ts).
      -- ponytail: confere por substring do texto normalizado; um CNPJ colado
      -- a outros dígitos também casa. Upgrade: extrair os CNPJs do texto.
      SELECT public.normalize_document_text(c.cnpj_cpf) INTO v_customer_doc
      FROM public.customers c WHERE c.id = v_given AND c.deactivated_at IS NULL;
      v_texts := COALESCE(public.normalize_document_text(concat_ws(' ', v_item->>'consignee_block', v_item->>'cargo_description')), '');
      IF v_resolved IS NOT NULL OR v_doc IS NOT NULL OR v_customer_doc IS NULL OR position(v_customer_doc IN v_texts) = 0 THEN
        RAISE EXCEPTION 'B/L %: o Cliente enviado não é o do CNPJ do consignatário no arquivo. Refaça a prévia e importe de novo.', v_id
          USING ERRCODE = '22023';
      END IF;
      v_resolved := v_given;
    END IF;
    IF v_resolved IS NOT NULL THEN
      v_item := v_item || jsonb_build_object(
        'customer_id', v_resolved, 'suggested_customer_id', NULL,
        'customer_reconciliation_status', 'matched_document',
        'customer_reconciliation_notes', 'Cliente reconciliado automaticamente por CNPJ.',
        'billing_hold_reason', NULL);
    ELSIF COALESCE(v_item->>'customer_reconciliation_status', '') = 'matched_name' THEN
      v_item := v_item || jsonb_build_object('customer_id', NULL);
    ELSE
      v_item := v_item || jsonb_build_object(
        'customer_id', NULL, 'customer_reconciliation_status', 'missing_customer',
        'customer_reconciliation_notes', 'Cliente nao encontrado na base cadastral.',
        'billing_hold_reason', 'Aguardando reconciliacao de cliente antes do faturamento.');
    END IF;

    -- Decisão 9 (ADR 0094, A2): refixar só com o aceite, em B/L gravado e
    -- não faturado.
    IF COALESCE(NULLIF(v_item->>'refix_prices', '')::boolean, false) THEN
      IF NOT v_exists THEN
        RAISE EXCEPTION 'B/L %: B/L novo não tem preço a refixar. Refaça a prévia e importe de novo.', v_id USING ERRCODE = '22023';
      END IF;
      IF v_invoiced THEN
        RAISE EXCEPTION 'B/L % já faturado: o preço é o da fatura e não é refixado.', v_id USING ERRCODE = '22023';
      END IF;
      v_refix := v_refix || v_id;
    END IF;
    v_item := v_item - 'refix_prices';

    v_items := v_items || jsonb_build_array(v_item);
  END LOOP;

  IF jsonb_array_length(v_items) = 0 THEN
    RETURN jsonb_build_object('result', jsonb_build_object('container_changes', '[]'::jsonb),
      'batch_id', NULL, 'calculation_errors', '[]'::jsonb,
      'cancelled_skipped', v_skipped, 'prices_refixed', '[]'::jsonb);
  END IF;

  IF p_batch IS NULL THEN
    v_result := public.import_bl_freight_transactional(v_items, p_changed_by);
  ELSE
    v_result := public.import_bl_freight_with_metadata(v_items, p_changed_by, p_batch);
  END IF;

  IF cardinality(v_refix) > 0 THEN
    v_refixed := COALESCE(public.refix_bl_local_charge_prices(v_refix,
      'Reimportação do arquivo de B/L: o operador aceitou o preço de hoje na prévia')->'refixed', '[]'::jsonb);
  END IF;

  RETURN v_result || jsonb_build_object('cancelled_skipped', v_skipped, 'prices_refixed', v_refixed);
END;
$function$;

CREATE OR REPLACE FUNCTION public.import_bl_freight_transactional_legacy_070(p_bls jsonb, p_changed_by uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_result jsonb;
  v_item jsonb;
  v_bl_id text;
  v_next text[];
  v_current text[];
  v_voyage_ids bigint[] := ARRAY[]::bigint[];
  v_voyage_id bigint;
  v_pol text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR p_changed_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Usuário sem permissão para importar o frete do B/L.' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(array_agg(DISTINCT b.voyage_id ORDER BY b.voyage_id), ARRAY[]::bigint[])
    INTO v_voyage_ids
  FROM public.bls AS b
  WHERE b.id IN (
    SELECT item->>'id'
    FROM jsonb_array_elements(COALESCE(p_bls, '[]'::jsonb)) AS item
    WHERE item->>'id' IS NOT NULL
  ) AND b.voyage_id IS NOT NULL;

  PERFORM set_config('alerts.baplie_coverage_deferred', 'on', true);
  v_result := public.import_bl_freight_transactional_legacy_357(p_bls, p_changed_by);

  FOR v_item IN SELECT item FROM jsonb_array_elements(COALESCE(p_bls, '[]'::jsonb)) AS item LOOP
    v_bl_id := v_item->>'id';
    CONTINUE WHEN v_bl_id IS NULL;

    -- Preserva o fato já cadastrado quando um payload antigo não possui a chave
    -- e quando o Laden on Board do arquivo é ilegível ou vazio (ADR 0078, item 17).
    IF v_item ? 'laden_on_board' AND NULLIF(btrim(v_item->>'laden_on_board'), '') IS NOT NULL THEN
      UPDATE public.bls
      SET laden_on_board = NULLIF(v_item->>'laden_on_board', '')::date,
          updated_at = now()
      WHERE id = v_bl_id;
    END IF;

    v_next := public.normalize_ncm_codes(v_item->'ncm_codes');
    CONTINUE WHEN cardinality(v_next) = 0;
    SELECT ncm_codes INTO v_current FROM public.bls WHERE id = v_bl_id;
    CONTINUE WHEN NOT FOUND OR v_current = v_next;
    UPDATE public.bls SET ncm_codes = v_next WHERE id = v_bl_id;
    INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
    VALUES ('bl', v_bl_id, 'ncm_codes', array_to_string(COALESCE(v_current, ARRAY[]::text[]), ', '), array_to_string(v_next, ', '), p_changed_by, 'NCM declarado no documento reimportado');
  END LOOP;

  PERFORM set_config('alerts.baplie_coverage_deferred', 'off', true);

  SELECT v_voyage_ids || COALESCE(array_agg(DISTINCT b.voyage_id ORDER BY b.voyage_id), ARRAY[]::bigint[])
    INTO v_voyage_ids
  FROM public.bls AS b
  WHERE b.id IN (
    SELECT item->>'id'
    FROM jsonb_array_elements(COALESCE(p_bls, '[]'::jsonb)) AS item
    WHERE item->>'id' IS NOT NULL
  ) AND b.voyage_id IS NOT NULL;

  FOR v_voyage_id IN
    SELECT DISTINCT ids.voyage_id FROM unnest(v_voyage_ids) AS ids(voyage_id)
    WHERE ids.voyage_id IS NOT NULL ORDER BY ids.voyage_id
  LOOP
    PERFORM public.reconcile_voyage_baplie_coverage_alerts(v_voyage_id, 'baplie_coverage_import');
    -- O adiamento também segura os gatilhos de B/Ls esperados e CE pendente
    -- (346): reconcilia os dois aqui, uma vez por viagem.
    PERFORM public._reconcile_voyage_bl_alerts(ARRAY[v_voyage_id], 'bl_import');

    -- 401 (ADR 0095, decisão 23): o ATD de cada POL sai do helper, que conta
    -- só B/Ls ativos e não toca o ATD corrigido à mão.
    FOR v_pol IN
      SELECT DISTINCT upper(btrim(b.pol))
      FROM public.bls AS b
      WHERE b.voyage_id = v_voyage_id AND NULLIF(btrim(b.pol), '') IS NOT NULL
    LOOP
      PERFORM public._recompute_voyage_pol_atd(
        v_voyage_id, v_pol, p_changed_by,
        'ATD derivado do menor Laden on Board dos B/Ls ativos, na importação do B/L (ADR 0025; ADR 0095, decisão 23)'
      );
    END LOOP;
  END LOOP;

  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.import_bl_freight_transactional_legacy_189(p_bls jsonb, p_changed_by uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_result jsonb; v_reissues jsonb;
  v_previous text := current_setting('vela.invoice_basis_source', true);
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR p_changed_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Usuário sem permissão ativa.' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_bls) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Payload de B/L invalido.' USING ERRCODE = '22023';
  END IF;
  PERFORM set_config('vela.invoice_basis_source', 'bl_reimport_correction', true);
  v_result := public._import_bl_freight_before_invoice_alert_123(p_bls, p_changed_by);
  PERFORM public.assert_no_fcl_shared_between_customers(
    ARRAY(SELECT item->>'id' FROM jsonb_array_elements(p_bls) AS item WHERE NULLIF(item->>'id', '') IS NOT NULL)
  );
  v_reissues := public.process_invoice_basis_changes();
  PERFORM set_config('vela.invoice_basis_source', coalesce(v_previous, ''), true);
  IF jsonb_typeof(v_result) = 'object' THEN
    RETURN v_result || jsonb_build_object('invoice_reissues', v_reissues);
  END IF;
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.import_bl_freight_transactional_legacy_205(p_bls jsonb, p_changed_by uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_total_bls INTEGER := COALESCE(jsonb_array_length(p_bls), 0);
  v_inserted_freight_lines INTEGER := 0;
  v_locked_bls TEXT[] := ARRAY[]::TEXT[];
  v_unlocked_bls TEXT[] := ARRAY[]::TEXT[];
  v_container_bls TEXT[] := ARRAY[]::TEXT[];
  v_vehicle_bls TEXT[] := ARRAY[]::TEXT[];
  v_weight_locked_bls TEXT[] := ARRAY[]::TEXT[];
  v_billing_hold_bls TEXT[] := ARRAY[]::TEXT[];
  v_imported_bl_ids TEXT[] := ARRAY[]::TEXT[];
  v_bl_id TEXT;
  v_inserted_vehicles INTEGER := 0;
    v_vehicles_skipped INTEGER := 0;
  v_blocked_container TEXT;
  v_blocked_bl TEXT;
  v_blocked_doc TEXT;
  v_blocked_chassis TEXT;
  v_vehicles_discarded JSONB := '[]'::JSONB;
  v_vehicle_pending_bls TEXT[] := ARRAY[]::TEXT[];
  v_vehicle_summary JSONB;
  v_previous_delete_reason TEXT := current_setting('vela.delete_reason', true);
  -- 213: Troca de Consignatário sem aceite e exceção de terminal do POD antigo.
  v_customer_protected TEXT[] := ARRAY[]::TEXT[];
  v_customer_ignored JSONB := '[]'::JSONB;
  v_terminal_cleared TEXT[] := ARRAY[]::TEXT[];
  v_previous_terminal TEXT := current_setting('vela.bl_terminal_override', true);
  v_audited_fields TEXT[] := ARRAY[
    'voyage_id',
    'cargo_mode',
    'container_load_type',
    'shipper',
    'consignee',
    'notify_party',
    'customer_id',
    'customer_reconciliation_status',
    'customer_reconciliation_notes',
    'billing_hold_reason',
    'pol',
    'pod',
    'place_of_delivery',
    'place_of_receipt',
    'movement_from',
    'movement_to',
    'issue_place',
    'cargo_description',
    'total_packages',
    'packages_unit',
    'consignee_phone',
    'total_weight_kg',
    'total_cbm',
    'incoterm',
    'payment_type',
    'bl_emission_date',
    'manifest_customer_cnpj_cpf',
    'manifest_customer_name',
    'manifest_customer_email',
    'notes'
  ];
BEGIN
  IF auth.uid() IS NULL
     OR NOT public.is_active_user()
     OR p_changed_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Usuário sem permissão para importar o frete do B/L.'
      USING ERRCODE = '42501';
  END IF;

  IF p_bls IS NULL OR jsonb_typeof(p_bls) <> 'array' THEN
    RAISE EXCEPTION 'Payload de B/Ls invalido.'
      USING ERRCODE = '22023';
  END IF;

  CREATE TEMP TABLE pg_temp.tmp_bl_freight_import (
    id TEXT PRIMARY KEY,
    payload JSONB NOT NULL,
    voyage_id BIGINT,
    batch_id BIGINT,
    cargo_mode TEXT,
    container_load_type TEXT,
    shipper TEXT,
    consignee TEXT,
    notify_party TEXT,
    consignee_block TEXT,
    shipper_block TEXT,
    notify_block TEXT,
    notify2_block TEXT,
    notify_cnpj_cpf TEXT,
    customer_id BIGINT,
    customer_reconciliation_status TEXT,
    customer_reconciliation_notes TEXT,
    billing_hold_reason TEXT,
    pol TEXT,
    pod TEXT,
    place_of_delivery TEXT,
    place_of_receipt TEXT,
    movement_from TEXT,
    movement_to TEXT,
    issue_place TEXT,
    cargo_description TEXT,
    total_packages INTEGER,
    packages_unit TEXT,
    consignee_phone TEXT,
    total_weight_kg NUMERIC,
    total_cbm NUMERIC,
    incoterm TEXT,
    payment_type TEXT,
    bl_emission_date DATE,
    manifest_customer_cnpj_cpf TEXT,
    manifest_customer_name TEXT,
    manifest_customer_email TEXT,
    notes TEXT,
    billing_locked BOOLEAN NOT NULL DEFAULT false,
    override_billing BOOLEAN NOT NULL DEFAULT false,
    billing_impact BOOLEAN NOT NULL DEFAULT false,
    relink_customer BOOLEAN NOT NULL DEFAULT false
  ) ON COMMIT DROP;

  INSERT INTO pg_temp.tmp_bl_freight_import (
    id,
    payload,
    voyage_id,
    batch_id,
    cargo_mode,
    container_load_type,
    shipper,
    consignee,
    notify_party,
    consignee_block,
    shipper_block,
    notify_block,
    notify2_block,
    notify_cnpj_cpf,
    customer_id,
    customer_reconciliation_status,
    customer_reconciliation_notes,
    billing_hold_reason,
    pol,
    pod,
    place_of_delivery,
    place_of_receipt,
    movement_from,
    movement_to,
    issue_place,
    cargo_description,
    total_packages,
    packages_unit,
    consignee_phone,
    total_weight_kg,
    total_cbm,
    incoterm,
    payment_type,
    bl_emission_date,
    manifest_customer_cnpj_cpf,
    manifest_customer_name,
    manifest_customer_email,
    notes,
    override_billing,
    billing_impact,
    relink_customer
  )
  SELECT
    NULLIF(bl->>'id', ''),
    bl,
    NULLIF(bl->>'voyage_id', '')::BIGINT,
    NULLIF(bl->>'batch_id', '')::BIGINT,
    NULLIF(bl->>'cargo_mode', ''),
    CASE WHEN upper(btrim(bl->>'container_load_type')) IN ('FCL', 'LCL') THEN upper(btrim(bl->>'container_load_type')) END,
    NULLIF(bl->>'shipper', ''),
    NULLIF(bl->>'consignee', ''),
    NULLIF(bl->>'notify_party', ''),
    NULLIF(bl->>'consignee_block', ''),
    NULLIF(bl->>'shipper_block', ''),
    NULLIF(bl->>'notify_block', ''),
    NULLIF(bl->>'notify2_block', ''),
    NULLIF(bl->>'notify_cnpj_cpf', ''),
    NULLIF(bl->>'customer_id', '')::BIGINT,
    reconciliation.status,
    COALESCE(
      NULLIF(bl->>'customer_reconciliation_notes', ''),
      CASE
        WHEN reconciliation.status = 'matched_document' THEN 'Cliente reconciliado automaticamente por CNPJ/CPF.'
        WHEN reconciliation.status = 'matched_name' THEN 'Cliente sugerido por nome; validar documento.'
        ELSE 'Cliente nao encontrado na base cadastral.'
      END
    ),
    COALESCE(
      NULLIF(bl->>'billing_hold_reason', ''),
      CASE
        WHEN reconciliation.status = 'matched_document' THEN NULL
        ELSE 'Aguardando reconciliacao de cliente antes do faturamento.'
      END
    ),
    NULLIF(bl->>'pol', ''),
    NULLIF(bl->>'pod', ''),
    NULLIF(bl->>'place_of_delivery', ''),
    NULLIF(bl->>'place_of_receipt', ''),
    NULLIF(bl->>'movement_from', ''),
    NULLIF(bl->>'movement_to', ''),
    NULLIF(bl->>'issue_place', ''),
    NULLIF(bl->>'cargo_description', ''),
    NULLIF(bl->>'total_packages', '')::INTEGER,
    NULLIF(bl->>'packages_unit', ''),
    NULLIF(bl->>'consignee_phone', ''),
    NULLIF(bl->>'total_weight_kg', '')::NUMERIC,
    NULLIF(bl->>'total_cbm', '')::NUMERIC,
    NULLIF(bl->>'incoterm', ''),
    NULLIF(bl->>'payment_type', ''),
    NULLIF(bl->>'bl_emission_date', '')::DATE,
    public.normalize_document_text(bl->>'manifest_customer_cnpj_cpf'),
    NULLIF(bl->>'manifest_customer_name', ''),
    NULLIF(bl->>'manifest_customer_email', ''),
    NULLIF(bl->>'notes', ''),
    COALESCE(NULLIF(bl->>'override_billing', '')::BOOLEAN, false),
    COALESCE(NULLIF(bl->>'billing_impact', '')::BOOLEAN, false),
    COALESCE(NULLIF(bl->>'relink_customer', '')::BOOLEAN, false)
  FROM jsonb_array_elements(p_bls) AS bl
  CROSS JOIN LATERAL (
    SELECT COALESCE(
      NULLIF(bl->>'customer_reconciliation_status', ''),
      CASE
        WHEN NULLIF(bl->>'customer_id', '') IS NOT NULL THEN 'matched_document'
        ELSE 'missing_customer'
      END
    ) AS status
  ) AS reconciliation;

  IF EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import WHERE id IS NULL) THEN
    RAISE EXCEPTION 'B/L sem identificador no payload de frete.'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_temp.tmp_bl_freight_import
    WHERE customer_reconciliation_status NOT IN ('matched_document', 'matched_name', 'missing_customer', 'reconciled')
  ) THEN
    RAISE EXCEPTION 'Status de reconciliacao de cliente invalido no payload de frete.'
      USING ERRCODE = '22023';
  END IF;

  -- 392 (ADR 0095, decisão 10): a confirmação de faturamento só existe com
  -- fatura emitida. B/L calculado e não faturado recebe a base nova e é
  -- recalculado com o preço fixo (ADR 0094).
  UPDATE pg_temp.tmp_bl_freight_import AS t
  SET billing_locked = public._bl_has_emitted_local_invoice(t.id)
  WHERE EXISTS (
    SELECT 1
    FROM public.bls AS b
    WHERE b.id = t.id
  );

  SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::TEXT[])
  INTO v_locked_bls
  FROM pg_temp.tmp_bl_freight_import
  WHERE billing_locked;

  SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::TEXT[])
  INTO v_unlocked_bls
  FROM pg_temp.tmp_bl_freight_import
  WHERE NOT billing_locked;

  SELECT COALESCE(array_agg(t.id ORDER BY t.id), ARRAY[]::TEXT[])
  INTO v_weight_locked_bls
  FROM pg_temp.tmp_bl_freight_import AS t
  JOIN public.bls AS b ON b.id = t.id
  WHERE t.billing_locked
    AND NOT t.override_billing
    AND b.cargo_mode = 'carga_solta';

  SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::TEXT[])
  INTO v_billing_hold_bls
  FROM pg_temp.tmp_bl_freight_import
  WHERE billing_locked
    AND NOT override_billing;

  -- 213 (fix 1): Troca de Consignatário. B/L que já tem Cliente e cujo arquivo
  -- aponta outro Cliente, ou um CNPJ diferente do gravado e do Cliente
  -- vinculado (consignatário não cadastrado), mantém Consignee, bloco do
  -- consignatário, CNPJ, razão social e e-mail. Com o aceite
  -- (`relink_customer`), eles entram só depois de `relink_bl_customer` aplicar
  -- a troca (legacy_357), como na carga solta (192, B5); sem o aceite a troca
  -- ignorada volta em `customer_changes_ignored`.
  SELECT
    COALESCE(array_agg(t.id ORDER BY t.id), ARRAY[]::TEXT[]),
    COALESCE(jsonb_agg(jsonb_build_object(
      'bl_id', t.id,
      'customer_id', b.customer_id,
      'file_customer_id', t.customer_id,
      'file_document', t.manifest_customer_cnpj_cpf,
      'file_consignee', t.consignee
    ) ORDER BY t.id) FILTER (WHERE NOT t.relink_customer), '[]'::JSONB)
  INTO v_customer_protected, v_customer_ignored
  FROM pg_temp.tmp_bl_freight_import AS t
  JOIN public.bls AS b ON b.id = t.id
  WHERE b.customer_id IS NOT NULL
    AND (
      (t.customer_id IS NOT NULL AND t.customer_id <> b.customer_id)
      OR (
        t.customer_id IS NULL
        AND t.manifest_customer_cnpj_cpf IS NOT NULL
        AND t.manifest_customer_cnpj_cpf IS DISTINCT FROM public.normalize_document_text(b.manifest_customer_cnpj_cpf)
        AND t.manifest_customer_cnpj_cpf IS DISTINCT FROM (
          SELECT public.normalize_document_text(c.cnpj_cpf) FROM public.customers AS c WHERE c.id = b.customer_id
        )
      )
    );

  -- 213 (fix 5): a exceção de terminal é do POD anterior. O POD corrigido pelo
  -- arquivo limpa terminal e porto da exceção, como na carga solta (174/192) e
  -- no COD. B/L em COD mantém o POD e a exceção (`_guard_cod_pod_on_reimport`).
  SELECT COALESCE(array_agg(t.id ORDER BY t.id), ARRAY[]::TEXT[])
  INTO v_terminal_cleared
  FROM pg_temp.tmp_bl_freight_import AS t
  JOIN public.bls AS b ON b.id = t.id
  WHERE t.id = ANY(v_unlocked_bls)
    AND t.payload ? 'pod'
    AND public.normalize_port_code(t.pod) IS DISTINCT FROM public.normalize_port_code(b.pod)
    AND (b.terminal_id IS NOT NULL OR b.pod_port_id IS NOT NULL);
  IF cardinality(v_terminal_cleared) > 0 THEN
    PERFORM set_config('vela.bl_terminal_override', 'on', true);
  END IF;

  CREATE TEMP TABLE pg_temp.tmp_old_bl_values ON COMMIT DROP AS
  SELECT
    b.id,
    to_jsonb(b) AS old_row,
    to_jsonb(t) AS new_row,
    t.billing_locked
  FROM public.bls AS b
  JOIN pg_temp.tmp_bl_freight_import AS t ON t.id = b.id;

  INSERT INTO public.bls (
    id,
    voyage_id,
    batch_id,
    cargo_mode,
    container_load_type,
    shipper,
    consignee,
    notify_party,
    consignee_block,
    shipper_block,
    notify_block,
    notify2_block,
    notify_cnpj_cpf,
    customer_id,
    customer_reconciliation_status,
    customer_reconciliation_notes,
    billing_hold_reason,
    pol,
    pod,
    place_of_delivery,
    place_of_receipt,
    movement_from,
    movement_to,
    issue_place,
    cargo_description,
    total_packages,
    packages_unit,
    consignee_phone,
    total_weight_kg,
    total_cbm,
    incoterm,
    payment_type,
    bl_emission_date,
    manifest_customer_cnpj_cpf,
    manifest_customer_name,
    manifest_customer_email,
    notes
  )
  SELECT
    id,
    voyage_id,
    batch_id,
    COALESCE(cargo_mode, 'container'),
    container_load_type,
    shipper,
    consignee,
    notify_party,
    consignee_block,
    shipper_block,
    notify_block,
    notify2_block,
    notify_cnpj_cpf,
    customer_id,
    customer_reconciliation_status,
    customer_reconciliation_notes,
    billing_hold_reason,
    pol,
    pod,
    place_of_delivery,
    place_of_receipt,
    movement_from,
    movement_to,
    issue_place,
    cargo_description,
    total_packages,
    packages_unit,
    consignee_phone,
    total_weight_kg,
    total_cbm,
    incoterm,
    payment_type,
    bl_emission_date,
    manifest_customer_cnpj_cpf,
    COALESCE(manifest_customer_name, consignee),
    manifest_customer_email,
    notes
  FROM pg_temp.tmp_bl_freight_import
  ON CONFLICT (id) DO UPDATE SET
    -- 392 (ADR 0095, decisão 5): a importação não move B/L entre Viagens.
    voyage_id = bls.voyage_id,
    batch_id = CASE WHEN EXCLUDED.id = ANY(v_unlocked_bls) AND EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'batch_id') THEN EXCLUDED.batch_id ELSE bls.batch_id END,
    cargo_mode = CASE WHEN EXCLUDED.id = ANY(v_unlocked_bls) AND EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'cargo_mode') THEN EXCLUDED.cargo_mode ELSE bls.cargo_mode END,
    -- 392 (ADR 0095, decisão 27): FCL/LCL lido do Type of Movement; o arquivo
    -- sem a modalidade mantém a gravada.
    container_load_type = COALESCE(EXCLUDED.container_load_type, bls.container_load_type),
    shipper = CASE WHEN EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'shipper') THEN EXCLUDED.shipper ELSE bls.shipper END,
    consignee = CASE WHEN EXCLUDED.id = ANY(v_customer_protected) THEN bls.consignee WHEN EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'consignee') THEN EXCLUDED.consignee ELSE bls.consignee END,
    notify_party = CASE WHEN EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'notify_party') THEN EXCLUDED.notify_party ELSE bls.notify_party END,
    consignee_block = CASE WHEN EXCLUDED.id = ANY(v_customer_protected) THEN bls.consignee_block WHEN EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'consignee_block') THEN EXCLUDED.consignee_block ELSE bls.consignee_block END,
    shipper_block = CASE WHEN EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'shipper_block') THEN EXCLUDED.shipper_block ELSE bls.shipper_block END,
    notify_block = CASE WHEN EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'notify_block') THEN EXCLUDED.notify_block ELSE bls.notify_block END,
    notify2_block = CASE WHEN EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'notify2_block') THEN EXCLUDED.notify2_block ELSE bls.notify2_block END,
    notify_cnpj_cpf = CASE WHEN EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'notify_cnpj_cpf') THEN EXCLUDED.notify_cnpj_cpf ELSE bls.notify_cnpj_cpf END,
    customer_id = CASE
      WHEN bls.customer_id IS NULL
        AND EXCLUDED.customer_id IS NOT NULL
        AND EXCLUDED.id <> ALL(v_billing_hold_bls)
        THEN EXCLUDED.customer_id
      ELSE bls.customer_id
    END,
    customer_reconciliation_status = CASE
      WHEN bls.customer_id IS NULL
        AND EXCLUDED.customer_id IS NOT NULL
        AND EXCLUDED.id <> ALL(v_billing_hold_bls)
        THEN EXCLUDED.customer_reconciliation_status
      WHEN bls.customer_id = EXCLUDED.customer_id
        AND EXCLUDED.customer_id IS NOT NULL
        AND COALESCE(bls.customer_reconciliation_status, 'missing_customer') IN ('missing_customer', 'matched_name')
        AND EXCLUDED.customer_reconciliation_status IN ('matched_document', 'matched_name')
        AND EXCLUDED.id <> ALL(v_billing_hold_bls)
        THEN EXCLUDED.customer_reconciliation_status
      WHEN COALESCE(bls.customer_reconciliation_status, '') = ''
        AND EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'customer_reconciliation_status')
        THEN EXCLUDED.customer_reconciliation_status
      ELSE bls.customer_reconciliation_status
    END,
    customer_reconciliation_notes = CASE
      -- 213: a Troca de Consignatário sem aplicar não traz a retenção nem a
      -- nota de reconciliação do consignatário do arquivo.
      WHEN EXCLUDED.id = ANY(v_customer_protected) THEN bls.customer_reconciliation_notes
      WHEN bls.customer_id IS NULL
        AND EXCLUDED.customer_id IS NOT NULL
        AND EXCLUDED.id <> ALL(v_billing_hold_bls)
        THEN EXCLUDED.customer_reconciliation_notes
      WHEN bls.customer_id = EXCLUDED.customer_id
        AND EXCLUDED.customer_id IS NOT NULL
        AND COALESCE(bls.customer_reconciliation_status, 'missing_customer') IN ('missing_customer', 'matched_name')
        AND EXCLUDED.customer_reconciliation_status IN ('matched_document', 'matched_name')
        AND EXCLUDED.id <> ALL(v_billing_hold_bls)
        THEN EXCLUDED.customer_reconciliation_notes
      WHEN COALESCE(bls.customer_reconciliation_notes, '') = ''
        AND EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'customer_reconciliation_notes')
        THEN EXCLUDED.customer_reconciliation_notes
      ELSE bls.customer_reconciliation_notes
    END,
    billing_hold_reason = CASE
      -- 213: a Troca de Consignatário sem aplicar não traz a retenção nem a
      -- nota de reconciliação do consignatário do arquivo.
      WHEN EXCLUDED.id = ANY(v_customer_protected) THEN bls.billing_hold_reason
      WHEN bls.customer_id IS NULL
        AND EXCLUDED.customer_id IS NOT NULL
        AND EXCLUDED.id <> ALL(v_billing_hold_bls)
        THEN EXCLUDED.billing_hold_reason
      WHEN bls.customer_id = EXCLUDED.customer_id
        AND EXCLUDED.customer_id IS NOT NULL
        AND COALESCE(bls.customer_reconciliation_status, 'missing_customer') IN ('missing_customer', 'matched_name')
        AND EXCLUDED.customer_reconciliation_status IN ('matched_document', 'matched_name')
        AND EXCLUDED.id <> ALL(v_billing_hold_bls)
        THEN EXCLUDED.billing_hold_reason
      WHEN COALESCE(bls.billing_hold_reason, '') = ''
        AND EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'billing_hold_reason')
        THEN EXCLUDED.billing_hold_reason
      ELSE bls.billing_hold_reason
    END,
    pol = CASE WHEN EXCLUDED.id = ANY(v_unlocked_bls) AND EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'pol') THEN EXCLUDED.pol ELSE bls.pol END,
    pod = CASE WHEN EXCLUDED.id = ANY(v_unlocked_bls) AND EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'pod') THEN EXCLUDED.pod ELSE bls.pod END,
    terminal_id = CASE WHEN EXCLUDED.id = ANY(v_terminal_cleared) THEN NULL ELSE bls.terminal_id END,
    pod_port_id = CASE WHEN EXCLUDED.id = ANY(v_terminal_cleared) THEN NULL ELSE bls.pod_port_id END,
    -- 392 (F-27): sem a confirmação, o Place of Delivery fica com o POD.
    place_of_delivery = CASE WHEN EXCLUDED.id = ANY(v_billing_hold_bls) THEN bls.place_of_delivery WHEN EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'place_of_delivery') THEN EXCLUDED.place_of_delivery ELSE bls.place_of_delivery END,
    place_of_receipt = CASE WHEN EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'place_of_receipt') THEN EXCLUDED.place_of_receipt ELSE bls.place_of_receipt END,
    movement_from = CASE WHEN EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'movement_from') THEN EXCLUDED.movement_from ELSE bls.movement_from END,
    movement_to = CASE WHEN EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'movement_to') THEN EXCLUDED.movement_to ELSE bls.movement_to END,
    issue_place = CASE WHEN EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'issue_place') THEN EXCLUDED.issue_place ELSE bls.issue_place END,
    cargo_description = CASE WHEN EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'cargo_description') THEN EXCLUDED.cargo_description ELSE bls.cargo_description END,
    total_packages = CASE WHEN EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'total_packages') THEN EXCLUDED.total_packages ELSE bls.total_packages END,
    packages_unit = CASE WHEN EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'packages_unit') THEN EXCLUDED.packages_unit ELSE bls.packages_unit END,
    consignee_phone = CASE WHEN EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'consignee_phone') THEN EXCLUDED.consignee_phone ELSE bls.consignee_phone END,
    -- 392 (F-27): sem a confirmação, os containers não mudam e os totais que
    -- vêm deles (peso e cubagem) também não.
    total_weight_kg = CASE WHEN EXCLUDED.id <> ALL(v_billing_hold_bls) AND EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'total_weight_kg') THEN EXCLUDED.total_weight_kg ELSE bls.total_weight_kg END,
    total_cbm = CASE WHEN EXCLUDED.id <> ALL(v_billing_hold_bls) AND EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'total_cbm') THEN EXCLUDED.total_cbm ELSE bls.total_cbm END,
    incoterm = CASE WHEN EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'incoterm') THEN EXCLUDED.incoterm ELSE bls.incoterm END,
    payment_type = CASE WHEN EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'payment_type') THEN EXCLUDED.payment_type ELSE bls.payment_type END,
    bl_emission_date = CASE WHEN EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'bl_emission_date') THEN EXCLUDED.bl_emission_date ELSE bls.bl_emission_date END,
    manifest_customer_cnpj_cpf = CASE WHEN EXCLUDED.id = ANY(v_customer_protected) THEN bls.manifest_customer_cnpj_cpf WHEN EXCLUDED.id <> ALL(v_billing_hold_bls) AND EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'manifest_customer_cnpj_cpf') THEN EXCLUDED.manifest_customer_cnpj_cpf ELSE bls.manifest_customer_cnpj_cpf END,
    manifest_customer_name = CASE WHEN EXCLUDED.id = ANY(v_customer_protected) THEN bls.manifest_customer_name WHEN EXCLUDED.id <> ALL(v_billing_hold_bls) AND EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'manifest_customer_name') THEN EXCLUDED.manifest_customer_name ELSE bls.manifest_customer_name END,
    -- M14: o e-mail anda com o documento do consignatário; protegido junto
    -- com o CNPJ, ele não vira contato do Cliente antigo.
    manifest_customer_email = CASE WHEN EXCLUDED.id = ANY(v_customer_protected) THEN bls.manifest_customer_email WHEN EXCLUDED.id <> ALL(v_billing_hold_bls) AND EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'manifest_customer_email') THEN EXCLUDED.manifest_customer_email ELSE bls.manifest_customer_email END,
    notes = CASE WHEN EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'notes') THEN EXCLUDED.notes ELSE bls.notes END,
    updated_at = now();

  IF cardinality(v_terminal_cleared) > 0 THEN
    PERFORM set_config('vela.bl_terminal_override', COALESCE(v_previous_terminal, 'off'), true);
  END IF;

  SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::TEXT[])
  INTO v_imported_bl_ids
  FROM pg_temp.tmp_bl_freight_import;

  INSERT INTO public.audit_logs (
    entity_type,
    entity_id,
    field_name,
    old_value,
    new_value,
    changed_by,
    justification
  )
  SELECT
    'bl',
    old_values.id,
    field_name,
    old_values.old_row->>field_name,
    to_jsonb(b)->>field_name,
    p_changed_by,
    CASE
      WHEN old_values.billing_locked THEN 'Importacao automatica de frete do BL; campos operacionais protegidos por faturamento existente'
      ELSE 'Importacao automatica de frete do BL'
    END
  FROM pg_temp.tmp_old_bl_values AS old_values
  JOIN public.bls AS b ON b.id = old_values.id
  CROSS JOIN unnest(v_audited_fields) AS audited(field_name)
  WHERE COALESCE(old_values.old_row->>field_name, '') IS DISTINCT FROM COALESCE(to_jsonb(b)->>field_name, '');

  DELETE FROM public.bl_freight_lines
  WHERE bl_id IN (
    SELECT id
    FROM pg_temp.tmp_bl_freight_import
    WHERE payload ? 'freight_lines'
       OR payload ? 'freightLines'
  );

  INSERT INTO public.bl_freight_lines (
    bl_id,
    seq,
    description,
    category,
    mercante_code,
    currency,
    amount,
    payment
  )
  SELECT
    t.id,
    COALESCE(NULLIF(line.item->>'seq', '')::INTEGER, line.ordinality::INTEGER),
    NULLIF(line.item->>'description', ''),
    NULLIF(line.item->>'category', ''),
    NULLIF(line.item->>'mercante_code', ''),
    NULLIF(line.item->>'currency', ''),
    NULLIF(line.item->>'amount', '')::NUMERIC,
    NULLIF(line.item->>'payment', '')
  FROM pg_temp.tmp_bl_freight_import AS t
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE
      WHEN jsonb_typeof(COALESCE(t.payload->'freight_lines', t.payload->'freightLines')) = 'array'
        THEN COALESCE(t.payload->'freight_lines', t.payload->'freightLines')
      ELSE '[]'::jsonb
    END
  ) WITH ORDINALITY AS line(item, ordinality);

  GET DIAGNOSTICS v_inserted_freight_lines = ROW_COUNT;

  SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::TEXT[])
  INTO v_container_bls
  FROM pg_temp.tmp_bl_freight_import
  WHERE (NOT billing_locked OR override_billing)
    AND payload ? 'containers';


  -- Containers: reconciliação por número (migration 175, M02). O id, a data de
  -- descarga, a devolução, o status de Demurrage, o local de desova e o perfil
  -- IMO/OOG do container que continua no arquivo ficam; só as colunas do
  -- documento mudam, e só quando mudam. Container ausente do arquivo sai apenas
  -- quando a prévia mostrou a remoção (`remove_containers`); payload sem a
  -- chave mantém a semântica anterior (sai todo ausente).
  CREATE TEMP TABLE pg_temp.tmp_new_containers (
    id BIGINT,
    bl_id TEXT,
    container_number TEXT
  ) ON COMMIT DROP;

  CREATE TEMP TABLE pg_temp.tmp_container_changes (
    bl_id TEXT,
    container_number TEXT,
    change TEXT
  ) ON COMMIT DROP;

  CREATE TEMP TABLE pg_temp.tmp_incoming_containers ON COMMIT DROP AS
  SELECT DISTINCT ON (t.id, upper(btrim(c.item->>'container_number')))
    t.id AS bl_id,
    upper(btrim(c.item->>'container_number')) AS container_number,
    NULLIF(c.item->>'seal_number', '') AS seal_number,
    NULLIF(c.item->>'type', '') AS type,
    NULLIF(c.item->>'tare_weight_kg', '')::NUMERIC AS tare_weight_kg,
    NULLIF(c.item->>'gross_weight_kg', '')::NUMERIC AS gross_weight_kg,
    NULLIF(c.item->>'cbm', '')::NUMERIC AS cbm,
    COALESCE(NULLIF(c.item->>'is_oog', '')::BOOLEAN, false) AS is_oog,
    COALESCE(NULLIF(c.item->>'is_imo', '')::BOOLEAN, false) AS is_imo,
    NULLIF(c.item->>'imo_class', '') AS imo_class,
    NULLIF(c.item->>'un_number', '') AS un_number,
    CASE WHEN upper(btrim(c.item->>'ownership')) IN ('SOC', 'COC') THEN upper(btrim(c.item->>'ownership')) END AS ownership,
    c.ord
  FROM pg_temp.tmp_bl_freight_import AS t
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(t.payload->'containers') = 'array' THEN t.payload->'containers' ELSE '[]'::jsonb END
  ) WITH ORDINALITY AS c(item, ord)
  WHERE t.id = ANY(v_container_bls)
    AND NULLIF(btrim(c.item->>'container_number'), '') IS NOT NULL
  ORDER BY t.id, upper(btrim(c.item->>'container_number')), c.ord;

  CREATE TEMP TABLE pg_temp.tmp_removed_containers ON COMMIT DROP AS
  SELECT bc.id, bc.bl_id, upper(btrim(bc.container_number)) AS container_number
  FROM public.bl_containers AS bc
  JOIN pg_temp.tmp_bl_freight_import AS t ON t.id = bc.bl_id
  WHERE t.id = ANY(v_container_bls)
    AND NOT EXISTS (
      SELECT 1 FROM pg_temp.tmp_incoming_containers AS i
      WHERE i.bl_id = bc.bl_id AND i.container_number = upper(btrim(bc.container_number))
    )
    AND (
      NOT (t.payload ? 'remove_containers')
      OR upper(btrim(bc.container_number)) IN (
        SELECT upper(btrim(listed.value))
        FROM jsonb_array_elements_text(
          CASE WHEN jsonb_typeof(t.payload->'remove_containers') = 'array' THEN t.payload->'remove_containers' ELSE '[]'::jsonb END
        ) AS listed(value)
      )
    );

  SELECT r.container_number, r.bl_id, d.doc_number
    INTO v_blocked_container, v_blocked_bl, v_blocked_doc
  FROM pg_temp.tmp_removed_containers AS r
  JOIN public.demurrage_invoice_items AS di ON di.container_id = r.id
  JOIN public.demurrage_invoices AS d ON d.id = di.invoice_id
  ORDER BY r.bl_id, r.container_number
  LIMIT 1;
  IF v_blocked_container IS NOT NULL THEN
    -- Migration 194 (A2): o item da Invoice de Demurrage trava o container
    -- (ADR 0071, item 3) com a invoice em qualquer situação: cancelar não
    -- destrava (os itens ficam), então a mensagem não manda cancelar.
    RAISE EXCEPTION
      'O container % do B/L % tem a Invoice de Demurrage % e não sai por reimportação.',
      v_blocked_container, v_blocked_bl, v_blocked_doc
      USING ERRCODE = 'P0006';
  END IF;

  WITH updated AS (
    UPDATE public.bl_containers AS bc
    SET
      seal_number = i.seal_number,
      type = i.type,
      tare_weight_kg = i.tare_weight_kg,
      gross_weight_kg = i.gross_weight_kg,
      cbm = i.cbm,
      ownership = CASE
        WHEN i.ownership IS NOT NULL AND bc.ownership_source IS DISTINCT FROM 'manual' THEN i.ownership
        ELSE bc.ownership
      END,
      ownership_source = CASE
        WHEN i.ownership IS NOT NULL AND bc.ownership_source IS DISTINCT FROM 'manual' THEN 'bl'
        ELSE bc.ownership_source
      END
    FROM pg_temp.tmp_incoming_containers AS i
    WHERE i.bl_id = bc.bl_id
      AND i.container_number = upper(btrim(bc.container_number))
      AND (
        bc.seal_number IS DISTINCT FROM i.seal_number
        OR bc.type IS DISTINCT FROM i.type
        OR bc.tare_weight_kg IS DISTINCT FROM i.tare_weight_kg
        OR bc.gross_weight_kg IS DISTINCT FROM i.gross_weight_kg
        OR bc.cbm IS DISTINCT FROM i.cbm
        OR (i.ownership IS NOT NULL AND bc.ownership_source IS DISTINCT FROM 'manual' AND bc.ownership IS DISTINCT FROM i.ownership)
      )
    RETURNING bc.bl_id, upper(btrim(bc.container_number)) AS container_number
  )
  INSERT INTO pg_temp.tmp_container_changes (bl_id, container_number, change)
  SELECT bl_id, container_number, 'updated' FROM updated;

  WITH inserted AS (
    -- Migration 194 (E9-07): IMO/OOG declarado no B/L nasce com origem `bl`,
    -- protegido do Baplie completo (ADR 0078, item 21).
    INSERT INTO public.bl_containers (
      bl_id, container_number, seal_number, type, tare_weight_kg, gross_weight_kg,
      cbm, is_oog, is_imo, imo_class, un_number, profile_source
    )
    SELECT
      i.bl_id, i.container_number, i.seal_number, i.type, i.tare_weight_kg, i.gross_weight_kg,
      i.cbm, i.is_oog, i.is_imo, i.imo_class, i.un_number,
      CASE WHEN i.is_imo OR i.is_oog THEN 'bl' END
    FROM pg_temp.tmp_incoming_containers AS i
    WHERE NOT EXISTS (
      SELECT 1 FROM public.bl_containers AS bc
      WHERE bc.bl_id = i.bl_id AND upper(btrim(bc.container_number)) = i.container_number
    )
    ORDER BY i.bl_id, i.ord
    RETURNING bl_id, upper(btrim(container_number)) AS container_number
  )
  INSERT INTO pg_temp.tmp_container_changes (bl_id, container_number, change)
  SELECT bl_id, container_number, 'inserted' FROM inserted;

  INSERT INTO pg_temp.tmp_new_containers (id, bl_id, container_number)
  SELECT bc.id, bc.bl_id, upper(btrim(bc.container_number))
  FROM public.bl_containers AS bc
  WHERE bc.bl_id IN (
    SELECT id FROM pg_temp.tmp_bl_freight_import
    WHERE id = ANY(v_container_bls)
  );


  -- 392 (ADR 0095, decisão 26): a aba VIN não é lida; veículos entram e saem
  -- só pela planilha de Veículos. Container com veículo não sai pelo arquivo.
  SELECT r.container_number, r.bl_id, ev.chassis INTO v_blocked_container, v_blocked_bl, v_blocked_chassis
  FROM pg_temp.tmp_removed_containers AS r
  JOIN public.vehicles AS ev ON ev.container_id = r.id
  ORDER BY r.bl_id, r.container_number, ev.chassis
  LIMIT 1;
  IF v_blocked_container IS NOT NULL THEN
    RAISE EXCEPTION
      'O container % do B/L % sai pelo arquivo, mas tem o veículo %: mova ou exclua os veículos dele (planilha de Veículos ou ficha) antes de tirar o container.',
      v_blocked_container, v_blocked_bl, v_blocked_chassis
      USING ERRCODE = 'P0006';
  END IF;

  PERFORM set_config('vela.delete_reason', 'Reimportacao de B/L: container ausente do arquivo, remocao mostrada na previa', true);
  WITH removed AS (
    DELETE FROM public.bl_containers AS bc
    USING pg_temp.tmp_removed_containers AS r
    WHERE bc.id = r.id
    RETURNING bc.bl_id, upper(btrim(bc.container_number)) AS container_number
  )
  INSERT INTO pg_temp.tmp_container_changes (bl_id, container_number, change)
  SELECT bl_id, container_number, 'removed' FROM removed;
  PERFORM set_config('vela.delete_reason', COALESCE(v_previous_delete_reason, ''), true);

  INSERT INTO public.audit_logs (
    entity_type,
    entity_id,
    field_name,
    old_value,
    new_value,
    changed_by,
    justification
  )
  SELECT
    'bl',
    t.id,
    'ALTERACAO_OPERACIONAL_BLOQUEADA',
    NULL,
    'billing_locked',
    p_changed_by,
    'Importacao de frete do BL: alteracao com impacto em faturamento bloqueada (sem override do operador)'
  FROM pg_temp.tmp_bl_freight_import AS t
  WHERE t.billing_locked
    AND t.billing_impact
    AND NOT t.override_billing;

  INSERT INTO public.audit_logs (
    entity_type,
    entity_id,
    field_name,
    old_value,
    new_value,
    changed_by,
    justification
  )
  SELECT
    'bl',
    t.id,
    'FATURAMENTO_SOBRESCRITO',
    NULL,
    'override_billing',
    p_changed_by,
    'Importacao de frete do BL: alteracao com impacto em faturamento aplicada por override do operador'
  FROM pg_temp.tmp_bl_freight_import AS t
  WHERE t.billing_locked
    AND t.billing_impact
    AND t.override_billing;

  PERFORM public.apply_bl_review_gate_after_import(v_imported_bl_ids, p_changed_by);

  UPDATE public.bls AS b
  SET
    review_status = 'pending_review',
    billing_hold_reason = COALESCE(NULLIF(b.billing_hold_reason, ''), 'Aguardando reconciliacao de cliente antes do faturamento.'),
    notes = CASE
      WHEN COALESCE(b.notes, '') ILIKE '%Cliente vinculado por nome; validar CNPJ%' THEN b.notes
      WHEN COALESCE(b.notes, '') ILIKE '%Pendencias de importacao:%'
        THEN b.notes || ', Cliente vinculado por nome; validar CNPJ'
      ELSE CONCAT_WS(E'\n', NULLIF(BTRIM(COALESCE(b.notes, '')), ''), 'Pendencias de importacao: Cliente vinculado por nome; validar CNPJ')
    END
  WHERE b.id = ANY(v_imported_bl_ids)
    AND b.customer_reconciliation_status = 'matched_name'
    AND COALESCE(b.financial_status, 'pending') <> 'invoiced';

  FOREACH v_bl_id IN ARRAY v_imported_bl_ids LOOP
    PERFORM public.sync_customer_reconciliation_queue_for_bl(v_bl_id);
  END LOOP;

  RETURN jsonb_build_object(
    'bls_received', v_total_bls,
    'freight_lines_inserted', v_inserted_freight_lines,
    'billing_locked', v_locked_bls,
    'operational_updated', v_unlocked_bls,
    'container_changes', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'bl_id', grouped.bl_id,
        'inserted', grouped.inserted,
        'updated', grouped.updated,
        'removed', grouped.removed
      ) ORDER BY grouped.bl_id), '[]'::jsonb)
      FROM (
        SELECT bl_id,
          COALESCE(jsonb_agg(container_number ORDER BY container_number) FILTER (WHERE change = 'inserted'), '[]'::jsonb) AS inserted,
          COALESCE(jsonb_agg(container_number ORDER BY container_number) FILTER (WHERE change = 'updated'), '[]'::jsonb) AS updated,
          COALESCE(jsonb_agg(container_number ORDER BY container_number) FILTER (WHERE change = 'removed'), '[]'::jsonb) AS removed
        FROM pg_temp.tmp_container_changes
        GROUP BY bl_id
      ) AS grouped
    ),
    'customer_changes_ignored', v_customer_ignored
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.import_bl_freight_with_metadata_legacy_189(p_bls jsonb, p_changed_by uuid, p_batch jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_result jsonb;
  v_batch_id bigint := NULL;
  v_filename text;
  v_voyage_id bigint;
  v_cargo_mode text := 'container';
  v_total_bls integer;
  v_bl_id text;
  v_mismatch integer := 0;
  v_updated integer := 0;
  v_action_id uuid := gen_random_uuid();
  v_item jsonb;
  v_physical_effect jsonb;
  v_physical_effect_id bigint;
  v_calc_errors jsonb := '[]'::jsonb;
  v_batch_containers jsonb;
BEGIN
  IF v_actor IS NULL OR NOT public.is_active_user() OR p_changed_by IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'Usuário sem permissão ativa.' USING ERRCODE = '42501';
  END IF;
  IF p_bls IS NULL OR jsonb_typeof(p_bls) <> 'array' OR jsonb_array_length(p_bls) = 0 THEN
    RAISE EXCEPTION 'Nenhum B/L informado.' USING ERRCODE = '22023';
  END IF;

  v_result := public.import_bl_freight_transactional(p_bls, p_changed_by);

  -- O batch e opcional (ADR 0017): mesmo no B/L avulso o calculo inicial
  -- deve acontecer nesta mesma operacao, sem depender de worker offline.
  IF p_batch IS NOT NULL THEN
    v_filename := NULLIF(btrim(COALESCE(p_batch->>'filename', '')), '');
    v_voyage_id := NULLIF(btrim(COALESCE(p_batch->>'voyage_id', '')), '')::bigint;
    v_cargo_mode := COALESCE(NULLIF(btrim(COALESCE(p_batch->>'cargo_mode', '')), ''), 'container');
    IF v_filename IS NULL OR v_voyage_id IS NULL THEN
      RAISE EXCEPTION 'Batch invalido: filename e voyage_id obrigatorios.' USING ERRCODE = '22023';
    END IF;
    IF v_cargo_mode NOT IN ('container', 'carga_solta') THEN
      RAISE EXCEPTION 'cargo_mode de batch invalido.' USING ERRCODE = '22023';
    END IF;

    PERFORM 1 FROM public.voyages WHERE id = v_voyage_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Viagem % nao encontrada', v_voyage_id USING ERRCODE = 'P0002';
    END IF;

    SELECT count(*) INTO v_mismatch
    FROM jsonb_array_elements(p_bls) AS item
    WHERE (item->>'voyage_id')::bigint IS DISTINCT FROM v_voyage_id;
    IF v_mismatch > 0 THEN
      RAISE EXCEPTION 'Batch da viagem % com B/L de outra viagem.', v_voyage_id USING ERRCODE = '22023';
    END IF;

    v_total_bls := jsonb_array_length(p_bls);

    INSERT INTO public.import_batches(
      filename, voyage_id, cargo_mode, uploaded_by, status, total_bls, total_containers
    ) VALUES (
      v_filename, v_voyage_id, v_cargo_mode, v_actor, 'completed', v_total_bls, NULL
    ) RETURNING id INTO v_batch_id;

    UPDATE public.bls AS b
      SET batch_id = v_batch_id
      FROM jsonb_array_elements(p_bls) AS item
      WHERE b.id = item->>'id' AND b.voyage_id = v_voyage_id;
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated <> v_total_bls THEN
      RAISE EXCEPTION 'Vinculo de batch falhou: % de % B/Ls vinculados.', v_updated, v_total_bls USING ERRCODE = 'P0002';
    END IF;

    -- Migration 178: sem efeito `physical_flags`; as flags do lote são
    -- aplicadas logo abaixo, na mesma transação.

    -- Baplie soberano em qualquer ordem (migration 118): se o Baplie da
    -- viagem ja existe, as flags fisicas valem antes do calculo inicial
    -- abaixo; o runner do efeito acima nao e pre-requisito.
    -- Migration 150: só os contêineres deste lote (sem filtro a função varre
    -- a viagem inteira, ~3 s numa viagem de ~500 B/Ls).
    SELECT jsonb_agg(DISTINCT upper(btrim(container->>'container_number')))
      INTO v_batch_containers
      FROM jsonb_array_elements(p_bls) AS item,
           jsonb_array_elements(COALESCE(item->'containers', '[]'::jsonb)) AS container
      WHERE NULLIF(btrim(COALESCE(container->>'container_number', '')), '') IS NOT NULL;
    IF v_batch_containers IS NOT NULL THEN
      PERFORM public.apply_baplie_physical_flags_atomic(v_voyage_id, v_batch_containers, v_actor);
    END IF;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_bls)
  LOOP
    -- Preserva o ID exato que foi persistido em public.bls
    v_bl_id := v_item->>'id';
    CONTINUE WHEN v_bl_id IS NULL OR btrim(v_bl_id) = '';
    -- B/L faturado não é recalculado aqui (migration 175, M02): a fatura
    -- emitida segue a ADR 0077 pela base capturada na própria importação.
    -- Recalcular só devolvia "recalculo bloqueado" e enfileirava
    -- provisional_charges em toda reimportação idêntica.
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM public.bls
      WHERE id = v_bl_id AND COALESCE(financial_status, 'pending') IN ('invoiced', 'paid')
    ) OR cardinality(public._live_local_invoice_ids_for_bl(v_bl_id)) > 0;

    -- ADR 0094, B3: falha de cálculo recusa o arquivo inteiro, com o B/L e o
    -- que falta (antes: rastro e efeito `provisional_charges` de recuperação).
    BEGIN
      PERFORM public.calculate_bl_local_charges(v_bl_id, v_actor, true);
    EXCEPTION WHEN OTHERS THEN
      PERFORM public._raise_local_charge_failure(v_bl_id, SQLSTATE, SQLERRM);
    END;
  END LOOP;

  RETURN jsonb_build_object('result', v_result, 'batch_id', v_batch_id, 'calculation_errors', v_calc_errors);
END;
$function$;

CREATE OR REPLACE FUNCTION public.import_breakbulk_manifest_transactional(p_filename text, p_voyage_id bigint, p_uploaded_by uuid, p_total_bls integer, p_bls jsonb, p_items jsonb, p_errors jsonb, p_file_hash text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  -- 408 (R-11): a guarda antes da trava da Viagem (o corpo a pega primeiro).
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR p_uploaded_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Usuário sem permissão para importar carga solta.' USING ERRCODE = '42501';
  END IF;
  PERFORM public._declare_import_file(p_filename, p_file_hash);
  v_result := public.import_breakbulk_manifest_transactional_core_405(
    p_filename, p_voyage_id, p_uploaded_by, p_total_bls, p_bls, p_items, p_errors);
  PERFORM public._declare_import_file(NULL, NULL);
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.import_breakbulk_manifest_transactional_031(p_filename text, p_voyage_id bigint, p_uploaded_by uuid, p_total_bls integer, p_bls jsonb, p_items jsonb, p_errors jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_batch_id bigint;
  v_bl_ids text[];
  v_bl_id text;
  v_action_id uuid := gen_random_uuid();
BEGIN
  IF auth.uid() IS NULL
     OR NOT public.is_active_user()
     OR p_uploaded_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Usuário sem permissão para importar carga solta.'
      USING ERRCODE = '42501';
  END IF;

  v_batch_id := public.import_manifest_transactional(
    p_filename,
    p_voyage_id,
    p_uploaded_by,
    'carga_solta',
    NULL,
    p_total_bls,
    0,
    COALESCE(p_bls, '[]'::jsonb),
    '[]'::jsonb,
    COALESCE(p_errors, '[]'::jsonb)
  );

  UPDATE public.bls AS target
  SET
    ce_mercante = CASE
      WHEN source.row ? 'ce_mercante' THEN NULLIF(source.row->>'ce_mercante', '')
      ELSE target.ce_mercante
    END,
    notify_party = NULLIF(source.row->>'notify_party', ''),
    bb_machine_qty = NULLIF(source.row->>'bb_machine_qty', '')::numeric,
    bb_packages_qty = NULLIF(source.row->>'bb_packages_qty', '')::numeric,
    bb_packages_total = NULLIF(source.row->>'bb_packages_total', '')::numeric,
    bb_weight_ton = NULLIF(source.row->>'bb_weight_ton', '')::numeric,
    ncm_codes = CASE
      WHEN cardinality(public.normalize_ncm_codes(source.row->'ncm_codes')) > 0
        THEN public.normalize_ncm_codes(source.row->'ncm_codes')
      ELSE target.ncm_codes
    END
  FROM jsonb_array_elements(COALESCE(p_bls, '[]'::jsonb)) AS source(row)
  WHERE target.id = source.row->>'id';

  SELECT COALESCE(array_agg(source.row->>'id'), ARRAY[]::text[])
  INTO v_bl_ids
  FROM jsonb_array_elements(COALESCE(p_bls, '[]'::jsonb)) AS source(row);

  IF cardinality(v_bl_ids) > 0 THEN
    DELETE FROM public.bl_breakbulk_items
    WHERE bl_id = ANY(v_bl_ids);
  END IF;

  INSERT INTO public.bl_breakbulk_items (
    bl_id, item_description, package_qty, package_unit,
    gross_weight_kg, cbm, marks
  )
  SELECT
    source.row->>'bl_id',
    source.row->>'item_description',
    COALESCE(NULLIF(source.row->>'package_qty', '')::numeric, 0),
    NULLIF(source.row->>'package_unit', ''),
    COALESCE(NULLIF(source.row->>'gross_weight_kg', '')::numeric, 0),
    COALESCE(NULLIF(source.row->>'cbm', '')::numeric, 0),
    NULLIF(source.row->>'marks', '')
  FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) AS source(row);

  IF cardinality(v_bl_ids) > 0 THEN
    PERFORM public.apply_bl_review_gate_after_import(v_bl_ids, p_uploaded_by);

    FOREACH v_bl_id IN ARRAY v_bl_ids LOOP
      INSERT INTO public.import_pending_effects(
        source_action_id, effect_kind, entity_id, created_by,
        source_snapshot
      ) VALUES (
        v_action_id, 'local_billing', v_bl_id, p_uploaded_by,
        jsonb_build_object(
          'filename', p_filename,
          'voyage_id', p_voyage_id,
          'cargo_mode', 'carga_solta'
        )
      )
      ON CONFLICT (source_action_id, effect_kind, entity_id) DO NOTHING;
    END LOOP;
  END IF;

  RETURN jsonb_build_object('batch_id', v_batch_id);
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
        'O B/L % ja esta na Viagem % e o arquivo foi importado na Viagem %. Nenhum B/L do lote foi gravado: exclua o B/L la e importe de novo (cancelar nao libera o numero).',
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
        'B/L % ja foi faturado (status financeiro=%); a importacao removeria carga solta. Estorne/refature antes de substituir o manifesto.',
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

CREATE OR REPLACE FUNCTION public.import_file_previous_upload(p_kind text, p_voyage_id bigint, p_file_hash text)
 RETURNS TABLE(uploaded_at timestamp with time zone, uploaded_by_name text, filename text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_hash text := lower(btrim(COALESCE(p_file_hash, '')));
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_read_user() THEN
    RAISE EXCEPTION 'Usuário sem permissão ativa.' USING ERRCODE = '42501';
  END IF;
  IF v_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Assinatura do arquivo inválida: escolha o arquivo de novo.' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH previous AS (
    SELECT b.uploaded_at AS at, b.uploaded_by AS who, b.filename AS name
    FROM public.import_batches b
    WHERE p_kind IN ('arquivo_bl', 'manifesto_bb')
      AND b.voyage_id = p_voyage_id AND b.file_hash = v_hash
      AND b.cargo_mode = CASE p_kind WHEN 'manifesto_bb' THEN 'carga_solta' ELSE 'container' END
    UNION ALL
    SELECT g.imported_at, g.imported_by, g.filename
    FROM public.granite_manifests g
    WHERE p_kind = 'granito' AND g.voyage_id = p_voyage_id AND g.file_hash = v_hash
    UNION ALL
    SELECT m.imported_at, m.imported_by, m.filename
    FROM public.vazios_manifests m
    WHERE p_kind = 'vazios_exportacao' AND m.voyage_id = p_voyage_id AND m.file_hash = v_hash
    UNION ALL
    SELECT m.imported_at, m.imported_by, m.filename
    FROM public.vazios_importacao_manifests m
    WHERE p_kind = 'vazios_importacao' AND m.voyage_id = p_voyage_id AND m.file_hash = v_hash
  )
  SELECT p.at, COALESCE(NULLIF(btrim(u.full_name), ''), 'usuário sem nome'), p.name
  FROM previous p
  LEFT JOIN public.user_profiles u ON u.id = p.who
  ORDER BY p.at DESC NULLS LAST
  LIMIT 1;
END;
$function$;

CREATE OR REPLACE FUNCTION public.import_manifest_transactional(p_filename text, p_voyage_id bigint, p_uploaded_by uuid, p_cargo_mode text, p_file_hash text, p_total_bls integer, p_total_containers integer, p_bls jsonb, p_containers jsonb, p_errors jsonb, p_apply_overwrites boolean DEFAULT false)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_result BIGINT;
BEGIN
  IF auth.uid() IS NULL
     OR NOT public.is_active_user()
     OR p_uploaded_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Usuário sem permissão ativa para importar manifesto.'
      USING ERRCODE = '42501';
  END IF;

  v_result := public.import_manifest_transactional_legacy_165(
    p_filename,
    p_voyage_id,
    p_uploaded_by,
    p_cargo_mode,
    p_file_hash,
    p_total_bls,
    p_total_containers,
    p_bls,
    p_containers,
    p_errors,
    p_apply_overwrites
  );

  UPDATE public.bls AS b
  SET
    suggested_customer_id = CASE
      WHEN item ? 'suggested_customer_id' THEN NULLIF(item->>'suggested_customer_id', '')::BIGINT
      ELSE b.suggested_customer_id
    END,
    customer_reconciliation_status = COALESCE(
      NULLIF(item->>'customer_reconciliation_status', ''),
      CASE
        WHEN NULLIF(item->>'customer_id', '') IS NOT NULL THEN 'reconciled'
        ELSE 'missing_customer'
      END
    )
  FROM jsonb_array_elements(COALESCE(p_bls, '[]'::jsonb)) AS item
  WHERE b.id = item->>'id';

  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.import_vazios_bookings_transactional_core_405(p_voyage_id bigint, p_port text, p_uploaded_by uuid, p_bookings jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user()
     OR p_uploaded_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Usuário sem permissão ativa para importar unidades.' USING ERRCODE = '42501';
  END IF;
  PERFORM public._lock_import_voyages(ARRAY[p_voyage_id]);
  IF public._vazios_export_locked_by_adr(p_voyage_id, p_port) THEN
    RAISE EXCEPTION 'O ADR de Saída deste porto está fechado: reabra o ADR para mudar as unidades embarcadas.'
      USING ERRCODE = '23514';
  END IF;
  PERFORM public._set_import_context('Embarque de Vazios', p_voyage_id, NULL);
  RETURN public.import_vazios_bookings_transactional_legacy_189(p_voyage_id, p_port, p_uploaded_by, p_bookings);
END $function$;

CREATE OR REPLACE FUNCTION public.import_vazios_bookings_transactional_legacy_189(p_voyage_id bigint, p_port text, p_uploaded_by uuid, p_bookings jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_manifest_id UUID;
  v_operation_id UUID;
  v_total INTEGER := jsonb_array_length(COALESCE(p_bookings, '[]'::JSONB));
  v_updated INTEGER := 0;
  v_inserted INTEGER := 0;
  v_removed INTEGER := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user()
     OR p_uploaded_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Usuário sem permissão ativa para importar unidades.' USING ERRCODE = '42501';
  END IF;
  IF NULLIF(btrim(p_port), '') IS NULL THEN
    RAISE EXCEPTION 'Porto de embarque obrigatorio.' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.voyages WHERE id = p_voyage_id) THEN
    RAISE EXCEPTION 'Viagem nao encontrada.' USING ERRCODE = 'P0002';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(COALESCE(p_bookings, '[]'::JSONB)) AS item(container_number TEXT)
    GROUP BY upper(btrim(container_number))
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Planilha invalida: Container duplicado na planilha.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.vazios_export_operations (voyage_id, embark_port, updated_at)
  VALUES (p_voyage_id, upper(btrim(p_port)), now())
  ON CONFLICT (voyage_id, embark_port) DO UPDATE SET updated_at = EXCLUDED.updated_at
  RETURNING id INTO v_operation_id;

  -- ponytail: validacao no RPC e tudo-ou-nada para nao subestimar pagamento por erro de uma linha.
  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(COALESCE(p_bookings, '[]'::JSONB)) AS r(
      container_number TEXT, container_type TEXT, local_code TEXT, condition TEXT,
      hand_in_date DATE, hand_out_date DATE, movement_date DATE
    )
    LEFT JOIN public.depots d ON lower(d.code) = lower(btrim(r.local_code))
    WHERE NULLIF(btrim(r.container_number), '') IS NULL
       OR r.container_number !~ '^[A-Za-z]{4}[0-9]{7}$'
       OR NULLIF(btrim(r.local_code), '') IS NULL
       OR d.id IS NULL
       OR (d.id IS NOT NULL AND NOT d.active)
       OR (COALESCE(d.tipo, 'depot') = 'depot' AND (r.hand_in_date IS NULL OR r.hand_out_date IS NULL))
       OR (COALESCE(d.tipo, 'depot') = 'depot' AND r.hand_out_date < r.hand_in_date)
       OR (d.id IS NOT NULL AND d.tipo = 'terminal_portuario' AND (r.hand_in_date IS NOT NULL OR r.hand_out_date IS NOT NULL))
       OR r.condition IS NULL OR r.condition NOT IN ('vazio', 'material')
  ) THEN
    RAISE EXCEPTION 'Planilha invalida: corrija todas as linhas e importe novamente.' USING ERRCODE = '22023';
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS pg_temp.vazios_bookings_in (
    container_number text, container_type text, local_id uuid, condition text,
    hand_in_date date, hand_out_date date, movement_date date
  ) ON COMMIT DROP;
  TRUNCATE pg_temp.vazios_bookings_in;
  INSERT INTO pg_temp.vazios_bookings_in
  SELECT upper(btrim(r.container_number)), r.container_type, d.id, r.condition, r.hand_in_date, r.hand_out_date, r.movement_date
  FROM jsonb_to_recordset(COALESCE(p_bookings, '[]'::JSONB)) AS r(
    container_number TEXT, container_type TEXT, local_code TEXT, condition TEXT,
    hand_in_date DATE, hand_out_date DATE, movement_date DATE
  )
  JOIN public.depots d ON lower(d.code) = lower(btrim(r.local_code)) AND d.active;

  INSERT INTO public.vazios_manifests (voyage_id, description, total_bookings, imported_by)
  VALUES (p_voyage_id, p_port, v_total, p_uploaded_by) RETURNING id INTO v_manifest_id;

  -- Atualiza por container (o mesmo id), inclusive a unidade incluída à mão.
  UPDATE public.vazios_bookings b
  SET container_type = i.container_type, local_id = i.local_id, condition = i.condition,
      hand_in_date = i.hand_in_date, hand_out_date = i.hand_out_date, movement_date = i.movement_date
  FROM pg_temp.vazios_bookings_in i
  WHERE b.operation_id = v_operation_id AND upper(btrim(b.container_number)) = i.container_number;
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  INSERT INTO public.vazios_bookings (
    voyage_id, operation_id, manifest_id, container_number, container_type,
    local_id, condition, hand_in_date, hand_out_date, movement_date
  )
  SELECT p_voyage_id, v_operation_id, v_manifest_id, i.container_number, i.container_type, i.local_id,
         i.condition, i.hand_in_date, i.hand_out_date, i.movement_date
  FROM pg_temp.vazios_bookings_in i
  WHERE NOT EXISTS (SELECT 1 FROM public.vazios_bookings b
                    WHERE b.operation_id = v_operation_id AND upper(btrim(b.container_number)) = i.container_number);
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  -- Unidade de planilha anterior que o arquivo novo não traz sai; a incluída à
  -- mão (manifesto de inclusão manual) fica.
  -- ponytail: a unidade manual é reconhecida pela descrição do manifesto que
  -- `create_manual_vazios_booking` grava; uma coluna de origem seria o upgrade.
  DELETE FROM public.vazios_bookings b
  USING public.vazios_manifests vm
  WHERE vm.id = b.manifest_id AND b.operation_id = v_operation_id
    AND vm.description IS DISTINCT FROM 'Inclusao manual no Embarque de Vazios'
    AND NOT EXISTS (SELECT 1 FROM pg_temp.vazios_bookings_in i WHERE i.container_number = upper(btrim(b.container_number)));
  GET DIAGNOSTICS v_removed = ROW_COUNT;

  -- Manifestos sem unidade não ficam órfãos.
  DELETE FROM public.vazios_manifests vm
  WHERE vm.voyage_id = p_voyage_id
    AND NOT EXISTS (SELECT 1 FROM public.vazios_bookings b WHERE b.manifest_id = vm.id);
  -- Os totais lidos pelos cards contam as unidades que ficaram em cada manifesto.
  UPDATE public.vazios_manifests vm
  SET total_bookings = (SELECT count(*) FROM public.vazios_bookings b WHERE b.manifest_id = vm.id)
  WHERE vm.voyage_id = p_voyage_id;

  RETURN jsonb_build_object(
    'manifest_id', CASE WHEN EXISTS (SELECT 1 FROM public.vazios_manifests WHERE id = v_manifest_id) THEN v_manifest_id END,
    'operation_id', v_operation_id,
    'total', v_total,
    'updated', v_updated,
    'inserted', v_inserted,
    'removed', v_removed,
    'replaced', FALSE
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.import_vazios_importacao_transactional_core_405(p_voyage_id bigint, p_description text, p_uploaded_by uuid, p_containers jsonb, p_manifestos jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_conflict record;
  v_from_baplie integer := 0;
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR p_uploaded_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Usuário sem permissão ativa para importar vazios.' USING ERRCODE = '42501';
  END IF;
  PERFORM public._lock_import_voyages(ARRAY[p_voyage_id]);
  PERFORM public._set_import_context('Vazios de Importação', p_voyage_id, (SELECT string_agg(m->>'numero', ', ') FROM jsonb_array_elements(COALESCE(p_manifestos, '[]'::jsonb)) AS m));
  PERFORM pg_advisory_xact_lock(hashtextextended('vazios_importacao:' || p_voyage_id::text, 0));

  CREATE TEMP TABLE IF NOT EXISTS pg_temp.vazios_398_planilha (container_key text, container_number text, pol text, pod text) ON COMMIT DROP;
  TRUNCATE pg_temp.vazios_398_planilha;
  IF jsonb_typeof(p_containers) = 'array' THEN
    INSERT INTO pg_temp.vazios_398_planilha
    SELECT upper(regexp_replace(COALESCE(item.container_number, ''), '[^A-Za-z0-9]', '', 'g')),
           upper(btrim(item.container_number)),
           public.normalize_port_code(item.pol), public.normalize_port_code(item.pod)
    FROM jsonb_to_recordset(p_containers) AS item(container_number text, pol text, pod text);
  END IF;

  -- O mesmo container duas vezes no arquivo.
  SELECT p.container_number,
         string_agg(COALESCE(p.pol, '?') || ' → ' || COALESCE(p.pod, '?'), ' e ' ORDER BY p.pol, p.pod) AS rotas
    INTO v_conflict
  FROM pg_temp.vazios_398_planilha AS p
  WHERE p.container_key <> ''
  GROUP BY p.container_key, p.container_number
  HAVING count(*) > 1
  ORDER BY p.container_number
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'O container % aparece mais de uma vez na planilha (%): um vazio de importação existe uma vez por Viagem. Deixe uma linha só e escolha o arquivo de novo. Nada foi gravado.',
      v_conflict.container_number, v_conflict.rotas USING ERRCODE = '23505';
  END IF;

  -- Já está na Viagem, vindo de outra planilha, numa rota que esta planilha
  -- não traz (a planilha só substitui as rotas que traz).
  SELECT c.container_number, c.pol, c.pod INTO v_conflict
  FROM public.vazios_importacao_containers AS c
  JOIN public.vazios_importacao_manifests AS m ON m.id = c.manifest_id
  JOIN pg_temp.vazios_398_planilha AS p ON p.container_key = c.container_key
  WHERE c.voyage_id = p_voyage_id AND m.source <> 'baplie'
    AND NOT EXISTS (
      SELECT 1 FROM pg_temp.vazios_398_planilha AS r
      WHERE r.pol = public.normalize_port_code(c.pol) AND r.pod = public.normalize_port_code(c.pod)
    )
  ORDER BY c.container_number
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'O container % já está nos Vazios de importação desta Viagem na rota % → %, de outra planilha: um vazio de importação existe uma vez por Viagem. Tire o container desta planilha ou traga nela a rota % → % inteira, que a planilha substitui. Nada foi gravado.',
      v_conflict.container_number, COALESCE(v_conflict.pol, '?'), COALESCE(v_conflict.pod, '?'),
      COALESCE(v_conflict.pol, '?'), COALESCE(v_conflict.pod, '?') USING ERRCODE = '23505';
  END IF;

  -- A natureza digitada no vazio do Baplie que a planilha vai substituir.
  CREATE TEMP TABLE IF NOT EXISTS pg_temp.vazios_400_natureza_baplie (container_key text PRIMARY KEY, natureza text) ON COMMIT DROP;
  TRUNCATE pg_temp.vazios_400_natureza_baplie;
  INSERT INTO pg_temp.vazios_400_natureza_baplie
  SELECT DISTINCT ON (c.container_key) c.container_key, c.natureza
  FROM public.vazios_importacao_containers AS c
  JOIN public.vazios_importacao_manifests AS m ON m.id = c.manifest_id
  WHERE m.source = 'baplie' AND c.voyage_id = p_voyage_id AND c.natureza IS NOT NULL
    AND EXISTS (SELECT 1 FROM pg_temp.vazios_398_planilha AS p WHERE p.container_key = c.container_key)
  ORDER BY c.container_key, c.created_at DESC NULLS LAST;

  -- A planilha vale sobre o Baplie: o container que ela traz sai do Baplie,
  -- em qualquer rota.
  DELETE FROM public.vazios_importacao_containers AS c
  USING public.vazios_importacao_manifests AS m
  WHERE m.id = c.manifest_id AND m.source = 'baplie' AND c.voyage_id = p_voyage_id
    AND EXISTS (SELECT 1 FROM pg_temp.vazios_398_planilha AS p WHERE p.container_key = c.container_key);
  GET DIAGNOSTICS v_from_baplie = ROW_COUNT;

  v_result := public.import_vazios_importacao_transactional_legacy_189(p_voyage_id, p_description, p_uploaded_by, p_containers, p_manifestos);

  -- A linha nova da planilha sem natureza recebe a do Baplie substituído.
  UPDATE public.vazios_importacao_containers AS c
  SET natureza = n.natureza
  FROM pg_temp.vazios_400_natureza_baplie AS n,
       public.vazios_importacao_manifests AS m
  WHERE n.container_key = c.container_key AND m.id = c.manifest_id
    AND c.voyage_id = p_voyage_id AND m.source <> 'baplie' AND c.natureza IS NULL;

  RETURN v_result || jsonb_build_object('replaced_from_baplie', v_from_baplie);
END $function$;

CREATE OR REPLACE FUNCTION public.import_vazios_importacao_transactional_legacy_189(p_voyage_id bigint, p_description text, p_uploaded_by uuid, p_containers jsonb, p_manifestos jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_manifest_id uuid;
  v_containers jsonb := COALESCE(p_containers, '[]'::jsonb);
  v_manifestos jsonb := COALESCE(p_manifestos, '[]'::jsonb);
  v_total integer;
  v_sem_rota integer;
  v_rotas_sem_numero text;
  v_rotas_com_dois_numeros text;
  v_numero_repetido text;
  v_numero_cadastrado text;
  v_route record;
  v_existing record;
  v_mercante_id uuid;
  v_mercante_ids uuid[] := ARRAY[]::uuid[];
  v_previous_mirror text := current_setting('vela.route_manifest_mirror', true);
  v_replaced integer := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR p_uploaded_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Usuário sem permissão ativa para importar vazios.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.voyages WHERE id = p_voyage_id) THEN
    RAISE EXCEPTION 'Viagem nao encontrada.' USING ERRCODE = 'P0002';
  END IF;
  IF jsonb_typeof(v_manifestos) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Número do manifesto Mercante é obrigatório.' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('vazios_importacao:' || p_voyage_id::text, 0));

  SELECT count(*),
         count(*) FILTER (WHERE NULLIF(btrim(item.pol), '') IS NULL OR NULLIF(btrim(item.pod), '') IS NULL)
    INTO v_total, v_sem_rota
    FROM jsonb_to_recordset(v_containers) AS item(pol text, pod text);

  IF v_total = 0 THEN
    RAISE EXCEPTION 'Nenhum container na planilha.' USING ERRCODE = '22023';
  END IF;
  IF v_sem_rota > 0 THEN
    RAISE EXCEPTION 'POL e POD são obrigatórios em todas as linhas: o Nº de manifesto Mercante pertence ao porto de origem.' USING ERRCODE = '22023';
  END IF;

  -- Rota e Nº na forma do cadastro; dois códigos do mesmo porto com o mesmo
  -- Nº viram uma rota só.
  CREATE TEMP TABLE IF NOT EXISTS pg_temp.vazios_import_manifestos (pol text, pod text, numero text) ON COMMIT DROP;
  TRUNCATE pg_temp.vazios_import_manifestos;
  INSERT INTO pg_temp.vazios_import_manifestos
  SELECT DISTINCT public.normalize_port_code(m.pol), public.normalize_port_code(m.pod),
         public.canonical_manifesto_numero(m.numero)
  FROM jsonb_to_recordset(v_manifestos) AS m(pol text, pod text, numero text);

  SELECT string_agg(r.pol || ' → ' || r.pod, ', ' ORDER BY r.pol, r.pod)
    INTO v_rotas_sem_numero
    FROM (
      SELECT DISTINCT public.normalize_port_code(item.pol) AS pol, public.normalize_port_code(item.pod) AS pod
      FROM jsonb_to_recordset(v_containers) AS item(pol text, pod text)
    ) r
    WHERE NOT EXISTS (SELECT 1 FROM pg_temp.vazios_import_manifestos m
                      WHERE m.pol = r.pol AND m.pod = r.pod AND m.numero IS NOT NULL);
  IF v_rotas_sem_numero IS NOT NULL THEN
    RAISE EXCEPTION 'Informe um Nº de manifesto Mercante para cada porto de origem: falta em %.', v_rotas_sem_numero USING ERRCODE = '22023';
  END IF;
  SELECT string_agg(d.pol || ' → ' || d.pod, ', ' ORDER BY d.pol, d.pod)
    INTO v_rotas_com_dois_numeros
    FROM (
      SELECT pol, pod FROM pg_temp.vazios_import_manifestos
      WHERE numero IS NOT NULL GROUP BY pol, pod HAVING count(*) > 1
    ) d;
  IF v_rotas_com_dois_numeros IS NOT NULL THEN
    RAISE EXCEPTION 'A rota % recebeu mais de um Nº de manifesto Mercante (o mesmo porto aparece com códigos diferentes na planilha): informe um só.', v_rotas_com_dois_numeros USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_temp.vazios_import_manifestos m
    WHERE m.numero IS NULL OR NOT EXISTS (
      SELECT 1 FROM jsonb_to_recordset(v_containers) AS item(pol text, pod text)
      WHERE public.normalize_port_code(item.pol) = m.pol AND public.normalize_port_code(item.pod) = m.pod
    )
  ) THEN
    RAISE EXCEPTION 'Há Nº de manifesto Mercante para uma rota que não está na planilha.' USING ERRCODE = '22023';
  END IF;

  SELECT min(numero) INTO v_numero_repetido
    FROM (SELECT numero FROM pg_temp.vazios_import_manifestos GROUP BY numero HAVING count(*) > 1) d;
  IF v_numero_repetido IS NOT NULL THEN
    RAISE EXCEPTION 'O número de manifesto Mercante "%" foi informado para mais de um porto de origem.', v_numero_repetido USING ERRCODE = '22023';
  END IF;

  -- O número da mesma rota de vazios nesta Viagem é reaproveitado; em qualquer
  -- outro lugar, recusa.
  SELECT min(m.numero) INTO v_numero_cadastrado
    FROM pg_temp.vazios_import_manifestos m
    JOIN public.manifestos_mercante mm ON mm.numero = m.numero
    WHERE NOT (mm.voyage_id = p_voyage_id AND mm.natureza = 'vazio'
               AND public.normalize_port_code(mm.pol) = m.pol
               AND public.normalize_port_code(mm.pod) = m.pod);
  IF v_numero_cadastrado IS NOT NULL THEN
    RAISE EXCEPTION 'O número de manifesto Mercante "%" já foi cadastrado no sistema.', v_numero_cadastrado USING ERRCODE = '23505';
  END IF;

  -- Natureza digitada antes da substituição.
  CREATE TEMP TABLE IF NOT EXISTS pg_temp.vazios_natureza (container_number text, natureza text) ON COMMIT DROP;
  TRUNCATE pg_temp.vazios_natureza;
  INSERT INTO pg_temp.vazios_natureza SELECT * FROM public._vazios_importacao_natureza_map(p_voyage_id);

  -- A planilha nova substitui os containers das rotas que ela traz.
  DELETE FROM public.vazios_importacao_containers c
  USING public.vazios_importacao_manifests m
  WHERE m.id = c.manifest_id AND m.voyage_id = p_voyage_id
    AND EXISTS (SELECT 1 FROM pg_temp.vazios_import_manifestos r
                WHERE r.pol = public.normalize_port_code(c.pol) AND r.pod = public.normalize_port_code(c.pod));
  GET DIAGNOSTICS v_replaced = ROW_COUNT;

  -- Nº de Manifesto da rota: corrige o existente ou cadastra; o espelho da
  -- rota acompanha.
  PERFORM set_config('vela.route_manifest_mirror', 'on', true);
  FOR v_route IN
    SELECT r.pol, r.pod, r.numero FROM pg_temp.vazios_import_manifestos r
    WHERE r.numero IS NOT NULL ORDER BY r.numero
  LOOP
    SELECT mm.id, mm.numero INTO v_existing
    FROM public.manifestos_mercante mm
    WHERE mm.voyage_id = p_voyage_id AND mm.natureza = 'vazio'
      AND public.normalize_port_code(mm.pol) = v_route.pol
      AND public.normalize_port_code(mm.pod) = v_route.pod
    ORDER BY mm.created_at, mm.id
    LIMIT 1
    FOR UPDATE;
    IF FOUND THEN
      v_mercante_id := v_existing.id;
      IF v_existing.numero IS DISTINCT FROM v_route.numero THEN
        UPDATE public.manifestos_mercante SET numero = v_route.numero WHERE id = v_mercante_id;
      END IF;
    ELSE
      INSERT INTO public.manifestos_mercante (voyage_id, pol, pod, numero, natureza)
      VALUES (p_voyage_id, v_route.pol, v_route.pod, v_route.numero, 'vazio')
      RETURNING id INTO v_mercante_id;
    END IF;
    v_mercante_ids := v_mercante_ids || v_mercante_id;

    UPDATE public.voyage_route_ce_master AS cm
    SET ce_master = v_route.numero, updated_by = p_uploaded_by, updated_at = now()
    WHERE cm.voyage_id = p_voyage_id AND cm.cargo_mode = 'vazios'
      AND public.normalize_port_code(cm.pol) = v_route.pol
      AND public.normalize_port_code(cm.pod) = v_route.pod
      AND cm.ce_master IS DISTINCT FROM v_route.numero;
    INSERT INTO public.voyage_route_ce_master (voyage_id, pol, pod, cargo_mode, ce_master, updated_by, updated_at)
    SELECT p_voyage_id, v_route.pol, v_route.pod, 'vazios', v_route.numero, p_uploaded_by, now()
    WHERE NOT EXISTS (
      SELECT 1 FROM public.voyage_route_ce_master AS cm
      WHERE cm.voyage_id = p_voyage_id AND cm.cargo_mode = 'vazios'
        AND public.normalize_port_code(cm.pol) = v_route.pol
        AND public.normalize_port_code(cm.pod) = v_route.pod
    );
  END LOOP;
  PERFORM set_config('vela.route_manifest_mirror', COALESCE(NULLIF(v_previous_mirror, ''), 'off'), true);

  INSERT INTO public.vazios_importacao_manifests (
    voyage_id, description, total_containers, imported_by, source
  )
  VALUES (p_voyage_id, p_description, v_total, p_uploaded_by, 'manual')
  RETURNING id INTO v_manifest_id;

  INSERT INTO public.vazios_importacao_containers (
    manifest_id, container_number, container_type, tare_kg, pol, pod, natureza
  )
  SELECT v_manifest_id, item.container_number, item.container_type, item.tare_kg, item.pol, item.pod, n.natureza
  FROM jsonb_to_recordset(v_containers) AS item(
    container_number text,
    container_type text,
    tare_kg numeric,
    pol text,
    pod text
  )
  LEFT JOIN pg_temp.vazios_natureza n ON n.container_number = upper(btrim(item.container_number));

  PERFORM public._vazios_importacao_prune(p_voyage_id);

  RETURN jsonb_build_object('manifest_id', v_manifest_id, 'mercante_manifest_ids', to_jsonb(v_mercante_ids),
    'replaced_containers', v_replaced);
END;
$function$;

CREATE OR REPLACE FUNCTION public.import_vehicle_rows_transactional(p_rows jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuário sem permissão ativa.' USING ERRCODE = '42501';
  END IF;
  PERFORM public._lock_import_voyages_of_bls(public._import_payload_voyage_ids(p_rows, 'voyage_id'), public._import_payload_texts(p_rows, 'bl_id'));
  PERFORM public._set_import_context('Veículos', (p_rows->0->>'voyage_id')::bigint, NULL);
  RETURN public.import_vehicle_rows_transactional_legacy_189(p_rows);
END $function$;

CREATE OR REPLACE FUNCTION public.import_vehicle_rows_transactional_legacy_189(p_rows jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_count integer := COALESCE(jsonb_array_length(p_rows), 0);
  v_action_id uuid := gen_random_uuid();
  v_bl_id text;
  v_problem text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuário sem permissão para importar veículos.'
      USING ERRCODE = '42501';
  END IF;
  IF v_count = 0 THEN RETURN 0; END IF;

  CREATE TEMP TABLE IF NOT EXISTS tmp_vehicle_import (
    voyage_id bigint, container_id bigint, bl_id text, chassis text, brand text, model text,
    weight_kg numeric, cbm numeric, unpacking_location text, unpacking_confirmed boolean
  ) ON COMMIT DROP;
  TRUNCATE tmp_vehicle_import;
  INSERT INTO tmp_vehicle_import
  SELECT row.voyage_id, row.container_id, upper(btrim(row.bl_id)), upper(btrim(row.chassis)), row.brand, row.model,
         row.weight_kg, row.cbm, NULLIF(btrim(row.unpacking_location), ''), COALESCE(row.unpacking_confirmed, false)
  FROM jsonb_to_recordset(p_rows) AS row(
    voyage_id bigint, container_id bigint, bl_id text, chassis text, brand text, model text,
    weight_kg numeric, cbm numeric, unpacking_location text, unpacking_confirmed boolean
  );

  -- B/L da Viagem, ativo; sem busca de B/L "parecido".
  SELECT 'B/L ' || t.bl_id || ' não encontrado na Viagem ou cancelado.' INTO v_problem
  FROM tmp_vehicle_import t
  LEFT JOIN public.bls b ON b.id = t.bl_id AND b.voyage_id = t.voyage_id AND b.cancelled_at IS NULL
  WHERE b.id IS NULL LIMIT 1;
  IF v_problem IS NOT NULL THEN RAISE EXCEPTION '%', v_problem USING ERRCODE = '22023'; END IF;

  -- Mesmo chassi em outra Viagem ativa.
  SELECT 'Chassi ' || t.chassis || ' já cadastrado na Viagem ' || COALESCE(v.voyage_number, v.id::text) || '.' INTO v_problem
  FROM tmp_vehicle_import t
  JOIN public.vehicles ve ON ve.chassis = t.chassis AND ve.voyage_id <> t.voyage_id
  JOIN public.bls b ON b.id = ve.bl_id AND b.cancelled_at IS NULL
  JOIN public.voyages v ON v.id = ve.voyage_id AND v.status IS DISTINCT FROM 'cancelled'
  LIMIT 1;
  IF v_problem IS NOT NULL THEN RAISE EXCEPTION '%', v_problem USING ERRCODE = '23505'; END IF;

  -- Local de desova diferente para o mesmo container no arquivo.
  SELECT 'Local de desova diferente para o container ' || c.container_number || ' no mesmo arquivo.' INTO v_problem
  FROM tmp_vehicle_import t JOIN public.bl_containers c ON c.id = t.container_id
  WHERE t.unpacking_location IS NOT NULL
  GROUP BY c.container_number
  HAVING count(DISTINCT upper(t.unpacking_location)) > 1
  LIMIT 1;
  IF v_problem IS NOT NULL THEN RAISE EXCEPTION '%', v_problem USING ERRCODE = '22023'; END IF;

  INSERT INTO public.vehicles(voyage_id, container_id, bl_id, chassis, brand, model, weight_kg, cbm)
  SELECT voyage_id, container_id, bl_id, chassis, brand, model, weight_kg, cbm FROM tmp_vehicle_import;

  -- Só preenche vazio; troca o gravado apenas com confirmação. 408 (R-16): o
  -- gravado é o do container físico (406 propaga o local aos outros B/Ls
  -- ativos da Viagem), não só o da linha do B/L da planilha.
  UPDATE public.bl_containers AS c
  SET unpacking_location = t.unpacking_location
  FROM (SELECT DISTINCT ON (container_id) container_id, voyage_id, unpacking_location, unpacking_confirmed
        FROM tmp_vehicle_import WHERE unpacking_location IS NOT NULL ORDER BY container_id) AS t
  WHERE c.id = t.container_id
    AND c.unpacking_location IS DISTINCT FROM t.unpacking_location
    AND (t.unpacking_confirmed OR NOT EXISTS (
      SELECT 1
      FROM public.bl_containers AS s
      JOIN public.bls AS sb ON sb.id = s.bl_id AND sb.cancelled_at IS NULL
      WHERE sb.voyage_id = t.voyage_id
        AND upper(btrim(s.container_number)) = upper(btrim(c.container_number))
        AND NULLIF(btrim(COALESCE(s.unpacking_location, '')), '') IS NOT NULL
        AND upper(btrim(s.unpacking_location)) <> upper(btrim(t.unpacking_location))));

  FOR v_bl_id IN SELECT DISTINCT bl_id FROM tmp_vehicle_import ORDER BY 1 LOOP
    INSERT INTO public.import_pending_effects(source_action_id, effect_kind, entity_id, created_by, source_snapshot)
    VALUES (v_action_id, 'vehicle_followup', v_bl_id, auth.uid(),
      jsonb_build_object('row_count', v_count, 'voyage_ids',
        (SELECT jsonb_agg(DISTINCT voyage_id ORDER BY voyage_id) FROM tmp_vehicle_import)))
    ON CONFLICT (source_action_id, effect_kind, entity_id) DO NOTHING;
    PERFORM public._vehicle_charges_follow(v_bl_id, auth.uid());
  END LOOP;

  RETURN v_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_demurrage_invoice_for_bl(p_bl_id text, p_doc_number text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_group text[] := public.demurrage_group_bl_ids(p_bl_id);
  v_anchor text := v_group[1];
  v_customer_id bigint;
  v_voyage_id bigint;
  v_covering bigint[];
  v_uncovered integer;
  v_container_ids bigint[];
  v_calculation jsonb;
  v_doc text;
  v_block text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND current_setting('vela.demurrage_internal', true) IS DISTINCT FROM 'on'
     AND (auth.uid() IS NULL OR NOT public.is_active_user()) THEN
    RAISE EXCEPTION 'Usuário sem permissão de faturamento.' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.bls WHERE id = p_bl_id AND cancelled_at IS NOT NULL) THEN
    RAISE EXCEPTION 'O B/L % está cancelado: a Invoice de Demurrage não é emitida para B/L cancelado.', p_bl_id
      USING ERRCODE = '22023';
  END IF;

  SELECT customer_id, voyage_id INTO v_customer_id, v_voyage_id FROM public.bls WHERE id = v_anchor;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L % nao encontrado.', p_bl_id USING ERRCODE = 'P0002';
  END IF;
  IF v_customer_id IS NULL THEN
    RAISE EXCEPTION 'B/L % sem cliente para emissão de Demurrage.', v_anchor USING ERRCODE = '22023';
  END IF;

  -- Cada caixa uma vez (214): a cobertura é por caixa na Viagem e no Cliente,
  -- não pelo grupo de hoje. A trava vale até o fim da transação.
  PERFORM public._lock_demurrage_box_billing(v_voyage_id, v_customer_id);
  WITH boxes AS (
    SELECT DISTINCT upper(btrim(c.container_number)) AS container_key
    FROM public.bl_containers AS c
    WHERE c.bl_id = ANY(v_group) AND c.ownership IS DISTINCT FROM 'SOC'
      AND NULLIF(btrim(c.container_number), '') IS NOT NULL
  ), billed AS (
    SELECT * FROM public._demurrage_billed_container_keys(v_voyage_id, v_customer_id)
  )
  SELECT
    (SELECT array_agg(DISTINCT billed.invoice_id ORDER BY billed.invoice_id)
       FROM billed JOIN boxes USING (container_key)),
    (SELECT count(*) FROM boxes
      WHERE NOT EXISTS (SELECT 1 FROM billed WHERE billed.container_key = boxes.container_key))
  INTO v_covering, v_uncovered;
  IF cardinality(v_covering) > 0 AND v_uncovered = 0 THEN
    RETURN jsonb_build_object('status', 'existing', 'invoice_id', v_covering[cardinality(v_covering)],
      'invoice_ids', to_jsonb(v_covering), 'anchor_bl_id', v_anchor, 'idempotent', true);
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.bl_containers
    WHERE bl_id = ANY(v_group) AND ownership IS DISTINCT FROM 'SOC' AND return_date IS NULL
  ) THEN
    RETURN jsonb_build_object('status', 'waiting_return', 'anchor_bl_id', v_anchor, 'group_bl_ids', to_jsonb(v_group));
  END IF;

  SELECT COALESCE(array_agg(pick.id ORDER BY pick.id), ARRAY[]::bigint[]) INTO v_container_ids
  FROM (
    SELECT DISTINCT ON (upper(btrim(c.container_number))) c.id
    FROM public.bl_containers AS c
    WHERE c.bl_id = ANY(v_group) AND c.ownership IS DISTINCT FROM 'SOC'
      AND NULLIF(btrim(c.container_number), '') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public._demurrage_billed_container_keys(v_voyage_id, v_customer_id) AS billed
        WHERE billed.container_key = upper(btrim(c.container_number))
      )
    ORDER BY upper(btrim(c.container_number)), (c.bl_id = v_anchor) DESC, c.id
  ) AS pick;
  IF cardinality(v_container_ids) = 0 THEN
    RETURN jsonb_build_object('status', 'no_containers', 'anchor_bl_id', v_anchor);
  END IF;

  v_calculation := public._calculate_demurrage_invoice_authoritative(
    v_anchor, v_container_ids, (now() AT TIME ZONE 'America/Sao_Paulo')::date);
  IF COALESCE((v_calculation->>'total_usd')::numeric, 0) <= 0 THEN
    RETURN jsonb_build_object('status', 'no_overstay', 'anchor_bl_id', v_anchor);
  END IF;

  -- 472 (DEM-D13): a Invoice de Demurrage segue a trava das faturas: CE
  -- Mercante e Gate de faturamento do Portal aberto. Sem eles, nada é emitido
  -- (a fila não falha); o CE ou a abertura do gate enfileira de novo.
  v_block := public._demurrage_issue_block_reason(v_anchor);
  IF v_block IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'blocked', 'reason', v_block, 'anchor_bl_id', v_anchor);
  END IF;

  v_doc := COALESCE(NULLIF(btrim(p_doc_number), ''), public.next_demurrage_doc_number());
  RETURN public.create_demurrage_invoice_authoritative(v_doc, v_anchor, v_customer_id, v_container_ids, NULL)
    || jsonb_build_object('status', 'issued', 'anchor_bl_id', v_anchor, 'group_bl_ids', to_jsonb(v_group),
         'complementary', COALESCE(cardinality(v_covering), 0) > 0,
         'covering_invoice_ids', to_jsonb(COALESCE(v_covering, ARRAY[]::bigint[])));
END;
$function$;

CREATE OR REPLACE FUNCTION public.link_pix_reconciliation_candidate(p_exception_id bigint, p_resolution_source text, p_invoice_id bigint DEFAULT NULL::bigint, p_demurrage_invoice_id bigint DEFAULT NULL::bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_exception public.pix_reconciliation_exceptions%ROWTYPE;
  v_candidate RECORD;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_financeiro_user() THEN
    RAISE EXCEPTION 'Usuário sem permissão para a conciliação de Pix.' USING ERRCODE = '42501';
  END IF;
  IF p_resolution_source NOT IN ('local', 'demurrage') THEN
    RAISE EXCEPTION 'Origem de resolucao PIX invalida.' USING ERRCODE = '22023';
  END IF;
  IF (p_resolution_source = 'local' AND (p_invoice_id IS NULL OR p_demurrage_invoice_id IS NOT NULL))
     OR (p_resolution_source = 'demurrage' AND (p_demurrage_invoice_id IS NULL OR p_invoice_id IS NOT NULL)) THEN
    RAISE EXCEPTION 'Vinculo PIX exige exatamente uma candidata da origem escolhida.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_exception
  FROM public.pix_reconciliation_exceptions
  WHERE id = p_exception_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Excecao PIX % nao encontrada.', p_exception_id USING ERRCODE = 'P0002';
  END IF;
  IF v_exception.status = 'resolved' THEN
    RETURN jsonb_build_object('id', v_exception.id, 'status', 'resolved');
  END IF;
  IF v_exception.normalized_txid = '' THEN
    RAISE EXCEPTION 'Linha sem TXID nao possui candidata segura para vinculo manual.' USING ERRCODE = 'P0001';
  END IF;

  -- A candidata precisa ser uma fatura aberta que aceita o TXID pela
  -- resolução única (migration 242): individual, consolidada, avulsa ou
  -- Invoice de Demurrage, pelo TXID da cobrança.
  SELECT c.invoice_id AS id, c.doc_number, c.amount_brl
  INTO v_candidate
  FROM public._pix_txid_open_candidates(v_exception.normalized_txid) AS c
  WHERE c.source = p_resolution_source
    AND c.invoice_id = CASE WHEN p_resolution_source = 'local' THEN p_invoice_id ELSE p_demurrage_invoice_id END;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Candidata nao corresponde exatamente ao TXID persistido.' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.pix_reconciliation_exceptions
  SET metadata = metadata || jsonb_build_object(
        'manual_candidate', jsonb_build_object(
          'source', p_resolution_source,
          'invoice_id', CASE WHEN p_resolution_source = 'local' THEN p_invoice_id ELSE NULL END,
          'demurrage_invoice_id', CASE WHEN p_resolution_source = 'demurrage' THEN p_demurrage_invoice_id ELSE NULL END,
          'doc_number', v_candidate.doc_number,
          'linked_at', now()
        )
      ),
      updated_at = now()
  WHERE id = v_exception.id;

  RETURN jsonb_build_object('id', v_exception.id, 'status', 'active', 'candidate', v_candidate.doc_number);
END;
$function$;

CREATE OR REPLACE FUNCTION public.list_bl_charge_adjustment_summaries(p_bl_ids text[] DEFAULT NULL::text[], p_customer_id bigint DEFAULT NULL::bigint)
 RETURNS TABLE(bl_id text, voyage_id bigint, voyage_label text, manual_exempt boolean, exemption_justification text, items jsonb, last_actor_name text, last_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_read_user() THEN
    RAISE EXCEPTION 'Usuário sem permissão ativa' USING ERRCODE = '42501';
  END IF;
  IF p_bl_ids IS NULL AND p_customer_id IS NULL THEN
    RAISE EXCEPTION 'Informe os B/Ls ou o Cliente.' USING ERRCODE = '22023';
  END IF;
  -- ponytail: a lista do Cliente varre os B/Ls dele; com volume grande, um
  -- índice parcial por B/L com alteração em vigor resolve.
  RETURN QUERY
  WITH scope AS (
    SELECT b.id, b.voyage_id FROM public.bls b
     WHERE b.cancelled_at IS NULL
       AND (p_bl_ids IS NULL OR b.id = ANY(p_bl_ids))
       AND (p_customer_id IS NULL OR b.customer_id = p_customer_id)
  ),
  lines AS (
    SELECT cc.bl_id,
           jsonb_agg(jsonb_build_object(
             'charge_name', COALESCE(a.charge_name, cti.name, '[Sistema]'),
             'source', cc.source,
             'excluded', cc.status = 'excluded',
             'kind', a.kind,
             'currency', x.currency,
             'application_basis', COALESCE(a.application_basis, cti.application_basis),
             'quantity', cc.quantity,
             'table_unit', CASE WHEN x.currency = 'USD' THEN COALESCE(cc.table_unit_value_usd, cc.unit_value_usd)
                                ELSE COALESCE(cc.table_unit_value_brl, cc.unit_value_brl) END,
             'table_total', CASE WHEN x.currency = 'USD' THEN COALESCE(cc.table_total_value_usd, cc.total_value_usd)
                                 ELSE COALESCE(cc.table_total_value_brl, cc.total_value_brl) END,
             'unit', CASE WHEN x.currency = 'USD' THEN cc.unit_value_usd ELSE cc.unit_value_brl END,
             'total', CASE WHEN x.currency = 'USD' THEN cc.total_value_usd ELSE cc.total_value_brl END,
             'adjusted_value', a.value
           ) ORDER BY COALESCE(a.charge_name, cti.name), cc.calculation_key) AS items
      FROM public.charge_calculations cc
      JOIN scope s ON s.id = cc.bl_id
      LEFT JOIN public.bl_charge_adjustments a ON a.id = cc.adjustment_id
      LEFT JOIN public.charge_table_items cti ON cti.id = cc.charge_item_id
      CROSS JOIN LATERAL (SELECT upper(COALESCE(cti.currency,
        CASE WHEN cc.unit_value_usd IS NOT NULL OR cc.total_value_usd IS NOT NULL THEN 'USD' ELSE 'BRL' END)) AS currency) x
     WHERE cc.adjustment_id IS NOT NULL OR cc.status = 'excluded'
     GROUP BY cc.bl_id
  ),
  last_event AS (
    SELECT DISTINCT ON (e.bl_id) e.bl_id, up.full_name, e.created_at
      FROM public.bl_charge_adjustment_events e
      JOIN scope s ON s.id = e.bl_id
      LEFT JOIN public.user_profiles up ON up.id = e.actor
     ORDER BY e.bl_id, e.created_at DESC, e.id DESC
  )
  SELECT s.id, s.voyage_id,
         NULLIF(concat_ws(' / ', vs.name, v.voyage_number), ''),
         ex.bl_id IS NOT NULL, ex.justification,
         COALESCE(l.items, '[]'::jsonb), le.full_name, le.created_at
    FROM scope s
    LEFT JOIN lines l ON l.bl_id = s.id
    LEFT JOIN public.bl_local_charge_exemptions ex ON ex.bl_id = s.id
    LEFT JOIN last_event le ON le.bl_id = s.id
    LEFT JOIN public.voyages v ON v.id = s.voyage_id
    LEFT JOIN public.vessels vs ON vs.id = v.vessel_id
   WHERE l.bl_id IS NOT NULL OR ex.bl_id IS NOT NULL
   ORDER BY le.created_at DESC NULLS LAST, s.id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.list_bl_charge_history(p_bl_id text)
 RETURNS TABLE(id bigint, created_at timestamp with time zone, event text, line_key text, charge_name text, before jsonb, after jsonb, justification text, actor uuid, actor_name text, invoice_effect jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_read_user() THEN
    RAISE EXCEPTION 'Usuário sem permissão ativa' USING ERRCODE = '42501';
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

CREATE OR REPLACE FUNCTION public.list_bl_local_charge_lines(p_bl_id text)
 RETURNS TABLE(id bigint, bl_id text, charge_table_id bigint, charge_item_id bigint, charge_name text, charge_table_name text, charge_table_pod text, application_basis text, source text, status text, quantity numeric, currency text, unit_value_brl numeric, unit_value_usd numeric, total_value_brl numeric, total_value_usd numeric, override_applied boolean, calculation_key text, notes text, review_reason text, calculated_at timestamp with time zone, adjustment_id bigint, adjustment_kind text, adjustment_value numeric, adjustment_justification text, adjusted_by uuid, adjusted_by_name text, adjusted_at timestamp with time zone, table_unit_value_brl numeric, table_unit_value_usd numeric, table_total_value_brl numeric, table_total_value_usd numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_read_user() THEN
    RAISE EXCEPTION 'Usuário sem permissão ativa' USING ERRCODE = '42501';
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

CREATE OR REPLACE FUNCTION public.list_consolidatable_receivables(p_customer_id bigint, p_voyage_id bigint DEFAULT NULL::bigint, p_search text DEFAULT NULL::text)
 RETURNS TABLE(receivable_id bigint, bl_id text, customer_id bigint, customer_name text, customer_cnpj_cpf text, voyage_id bigint, vessel_name text, voyage_number text, individual_invoice_id bigint, individual_invoice_number text, balance_brl numeric, original_amount_brl numeric, receivable_status text, eligibility_status text, eligibility_reason text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_read_user() THEN
    RAISE EXCEPTION 'Usuário sem permissão ativa.' USING ERRCODE = '42501';
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

CREATE OR REPLACE FUNCTION public.list_customer_reconciliation_queue(p_status text DEFAULT NULL::text, p_limit integer DEFAULT 200)
 RETURNS TABLE(id bigint, manifest_id bigint, bl_id text, customer_id bigint, current_customer_name text, cnpj_cpf text, manifest_customer_name text, manifest_customer_email text, detection_type text, status text, notes text, resolution_notes text, charge_status text, financial_status text, billing_hold_reason text, created_at timestamp with time zone, approved_at timestamp with time zone, rejected_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_read_user() THEN
    RAISE EXCEPTION 'Usuário sem permissão ativa' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    q.id,
    q.manifest_id,
    q.bl_id,
    q.customer_id,
    c.name AS current_customer_name,
    q.cnpj_cpf,
    q.manifest_customer_name,
    q.manifest_customer_email,
    q.detection_type,
    q.status,
    q.notes,
    q.resolution_notes,
    b.charge_status,
    b.financial_status,
    b.billing_hold_reason,
    q.created_at,
    q.approved_at,
    q.rejected_at
  FROM public.customer_reconciliation_queue AS q
  LEFT JOIN public.customers AS c ON c.id = q.customer_id
  JOIN public.bls AS b ON b.id = q.bl_id
  WHERE p_status IS NULL OR q.status = p_status
  ORDER BY q.created_at DESC
  LIMIT GREATEST(COALESCE(p_limit, 200), 1);
END;
$function$;

CREATE OR REPLACE FUNCTION public.list_import_effects(p_entity_id text DEFAULT NULL::text, p_status text DEFAULT NULL::text, p_limit integer DEFAULT 100)
 RETURNS SETOF import_pending_effects
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' AND NOT public.is_active_read_user() THEN
    RAISE EXCEPTION 'Usuário sem permissão de leitura.' USING ERRCODE = '42501';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 500 THEN
    RAISE EXCEPTION 'Limite de consulta invalido.' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  SELECT e.*
  FROM public.import_pending_effects AS e
  WHERE (p_entity_id IS NULL OR e.entity_id = p_entity_id)
    AND (p_status IS NULL OR e.status = p_status)
  ORDER BY e.updated_at DESC, e.id DESC
  LIMIT p_limit;
END;
$function$;

CREATE OR REPLACE FUNCTION public.list_local_pix_candidates(p_txids text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Sem permissão de faturamento.' USING ERRCODE = '42501';
  END IF;
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('txid', t.txid, 'id', i.id,
    'invoice_number', i.invoice_number, 'amount_brl', r.expected_brl,
    'customer', jsonb_build_object('name', c.name, 'cnpj_cpf', c.cnpj_cpf)))
    FROM unnest(p_txids) t(txid) CROSS JOIN LATERAL public.resolve_local_pix_charge(t.txid) r
    JOIN public.invoices i ON i.id = r.invoice_id JOIN public.customers c ON c.id = i.customer_id), '[]'::jsonb);
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
    RAISE EXCEPTION 'Usuário sem permissão ativa' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH bl_ctx AS (
    SELECT b.id, b.customer_id, b.pod,
      public.bl_local_charge_reference_date(b.id) AS reference_date
    FROM public.bls AS b
    LEFT JOIN public.import_batches AS ib ON ib.id = b.batch_id
    WHERE b.id = upper(btrim(p_bl_id))
  )
  SELECT cti.id, cti.name, ct.id, ct.name, ct.cargo_mode, ct.pod,
    COALESCE(cti.currency, 'BRL'), cti.unit_value_brl, cti.unit_value_usd,
    CASE WHEN COALESCE(cti.currency, 'BRL') = 'USD' THEN NULL
         WHEN fi.charge_item_id IS NOT NULL THEN COALESCE(fi.override_value, fi.unit_value_brl, cti.value_brl, 0)
         ELSE COALESCE(cro.override_value, cti.unit_value_brl, cti.value_brl, 0) END,
    CASE WHEN COALESCE(cti.currency, 'BRL') <> 'USD' THEN NULL
         WHEN fi.charge_item_id IS NOT NULL THEN COALESCE(fi.override_value, fi.unit_value_usd, 0)
         ELSE COALESCE(cro.override_value, cti.unit_value_usd, 0) END
  FROM bl_ctx
  JOIN public.charge_tables AS ct ON ct.id IN (
      SELECT resolved.table_id
      FROM public.resolve_bl_local_charge_table_ids(bl_ctx.id, bl_ctx.reference_date) AS resolved
    )
    AND (
      public.normalize_port_code(ct.pod) = public.normalize_port_code(bl_ctx.pod)
      OR upper(trim(coalesce(ct.pod, ''))) = 'ANY'
    )
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
  LEFT JOIN public.bl_price_freeze_items AS fi ON fi.bl_id = bl_ctx.id AND fi.charge_item_id = cti.id
  ORDER BY ct.valid_from DESC, ct.id DESC, COALESCE(cti.sort_order, 100), cti.id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.list_payment_registrar_names(p_payment_ids bigint[])
 RETURNS TABLE(payment_id bigint, registered_by_name text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_read_user() THEN
    RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT p.id, up.full_name
  FROM public.payments AS p
  JOIN public.user_profiles AS up ON up.id = p.registered_by
  WHERE p.id = ANY(p_payment_ids);
END;
$function$;

CREATE OR REPLACE FUNCTION public.list_pending_reissues()
 RETURNS TABLE(invoice_id bigint, invoice_number text, invoice_type text, customer_id bigint, customer_name text, cancelled_at timestamp with time zone, cancel_reason text, bl_ids text[], receivable_ids bigint[])
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_read_user() THEN
    RAISE EXCEPTION 'Usuário sem permissão ativa.' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    inv.id,
    inv.invoice_number,
    inv.invoice_type,
    inv.customer_id,
    c.name,
    inv.cancelled_at,
    inv.cancel_reason,
    CASE WHEN inv.invoice_type = 'consolidated'
      THEN (SELECT COALESCE(ARRAY_AGG(DISTINCT l.bl_id ORDER BY l.bl_id), ARRAY[]::text[]) FROM public.invoice_receivable_links l WHERE l.invoice_id = inv.id)
      ELSE (SELECT COALESCE(ARRAY_AGG(DISTINCT ib.bl_id ORDER BY ib.bl_id), ARRAY[]::text[]) FROM public.invoice_bls ib WHERE ib.invoice_id = inv.id)
    END,
    (SELECT COALESCE(ARRAY_AGG(DISTINCT l.receivable_id ORDER BY l.receivable_id), ARRAY[]::bigint[]) FROM public.invoice_receivable_links l WHERE l.invoice_id = inv.id)
  FROM public.invoices inv
  LEFT JOIN public.customers c ON c.id = inv.customer_id
  WHERE inv.status = 'cancelled'
    AND inv.reissue_requested_at IS NOT NULL
    AND inv.reissue_closed_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM public.invoices s WHERE s.replaces_invoice_id = inv.id)
  ORDER BY inv.cancelled_at DESC NULLS LAST, inv.id DESC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.list_pix_reconciliation_candidates(p_exception_id bigint)
 RETURNS TABLE(source text, invoice_id bigint, doc_number text, amount_brl numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_exception public.pix_reconciliation_exceptions%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuário sem permissão para a conciliação de Pix.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_exception
  FROM public.pix_reconciliation_exceptions
  WHERE id = p_exception_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Excecao PIX % nao encontrada.', p_exception_id USING ERRCODE = 'P0002';
  END IF;

  IF v_exception.normalized_txid = '' THEN
    RETURN;
  END IF;

  -- Faturas abertas que aceitam o TXID, pela resolução única (migration 242).
  RETURN QUERY
  SELECT c.source, c.invoice_id, c.doc_number, c.amount_brl
  FROM public._pix_txid_open_candidates(v_exception.normalized_txid) AS c
  ORDER BY 1, 3;
END;
$function$;

CREATE OR REPLACE FUNCTION public.list_pix_reconciliation_exceptions(p_status text DEFAULT 'active'::text)
 RETURNS SETOF pix_reconciliation_exceptions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuário sem permissão para a conciliação de Pix.' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(p_status, 'active') NOT IN ('active', 'resolved', 'all') THEN
    RAISE EXCEPTION 'Status de excecao PIX invalido.' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT e.*
  FROM public.pix_reconciliation_exceptions e
  WHERE COALESCE(p_status, 'active') = 'all' OR e.status = COALESCE(p_status, 'active')
  ORDER BY e.created_at DESC, e.line_number DESC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.list_pix_txid_candidates(p_txids text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Sem permissão de faturamento.' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'txid', t.txid, 'source', c.source, 'id', c.invoice_id, 'doc_number', c.doc_number,
      'amount_brl', c.amount_brl,
      'customer', jsonb_build_object('name', cu.name, 'cnpj_cpf', cu.cnpj_cpf)))
    FROM (SELECT DISTINCT unnest(p_txids) AS txid) AS t
    CROSS JOIN LATERAL public._pix_txid_open_candidates(t.txid) AS c
    LEFT JOIN public.customers AS cu ON cu.id = c.customer_id
  ), '[]'::jsonb);
END;
$function$;

CREATE OR REPLACE FUNCTION public.list_voyage_eligible_pods(p_voyage_id bigint)
 RETURNS TABLE(pod text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuário sem permissão ativa.' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT e.pod FROM public.get_voyage_eligible_pods(p_voyage_id) AS e;
END;
$function$;

CREATE OR REPLACE FUNCTION public.mark_bl_charges_reviewed(p_bl_id text, p_actor uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bl RECORD;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuário sem permissão ativa' USING ERRCODE = '42501';
  END IF;

  SELECT id, charge_status
  INTO v_bl
  FROM public.bls
  WHERE id = p_bl_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L % nao encontrado', p_bl_id USING ERRCODE = 'P0002';
  END IF;

  IF v_bl.charge_status = 'ready_for_billing' THEN
    RETURN jsonb_build_object('bl_id', p_bl_id, 'status', v_bl.charge_status, 'changed', false);
  END IF;

  UPDATE public.charge_calculations
  SET status = 'reviewed'
  WHERE bl_id = p_bl_id
    AND status IN ('calculated', 'review_required');

  UPDATE public.bls
  SET
    charge_status = 'reviewed',
    charges_reviewed_at = NOW()
  WHERE id = p_bl_id;

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
    'bl',
    p_bl_id,
    'charge_status',
    COALESCE(v_bl.charge_status, 'null'),
    'reviewed',
    auth.uid(),
    NOW(),
    'Marcado como revisado no modulo de Taxas Locais'
  );

  RETURN jsonb_build_object('bl_id', p_bl_id, 'status', 'reviewed', 'changed', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.mark_bl_ready_and_create_invoice(p_bl_id text, p_customer_id bigint DEFAULT NULL::bigint, p_notes text DEFAULT NULL::text, p_actor uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bl_id TEXT := upper(trim(p_bl_id));
  v_customer_id BIGINT;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuário sem permissão de faturamento.' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(p_customer_id, b.customer_id)
  INTO v_customer_id
  FROM public.bls b
  WHERE b.id = v_bl_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L % nao encontrado.', p_bl_id USING ERRCODE = 'P0002';
  END IF;

  IF v_customer_id IS NULL THEN
    RAISE EXCEPTION 'B/L % sem cliente vinculado.', v_bl_id USING ERRCODE = '22023';
  END IF;

  PERFORM public.mark_bl_ready_for_billing(v_bl_id, p_actor);

  RETURN public.create_invoice_from_bls_with_ledger(
    ARRAY[v_bl_id],
    v_customer_id,
    p_notes,
    true,
    p_actor
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.mark_bls_ready_and_create_invoice(p_bl_ids text[], p_customer_id bigint, p_notes text DEFAULT NULL::text, p_actor uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bl_ids TEXT[];
  v_bl RECORD;
  v_bl_id TEXT;
  v_found_count INTEGER := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuário sem permissão de faturamento.' USING ERRCODE = '42501';
  END IF;

  SELECT ARRAY_AGG(DISTINCT upper(trim(value)) ORDER BY upper(trim(value)))
  INTO v_bl_ids
  FROM unnest(COALESCE(p_bl_ids, ARRAY[]::TEXT[])) AS value
  WHERE NULLIF(trim(value), '') IS NOT NULL;

  IF COALESCE(cardinality(v_bl_ids), 0) = 0 OR p_customer_id IS NULL THEN
    RAISE EXCEPTION 'Informe ao menos um B/L e um cliente para faturar.' USING ERRCODE = '22023';
  END IF;

  FOR v_bl IN
    SELECT b.id, b.customer_id
    FROM public.bls b
    WHERE b.id = ANY(v_bl_ids)
    ORDER BY b.id
    FOR UPDATE
  LOOP
    v_found_count := v_found_count + 1;
    IF v_bl.customer_id IS DISTINCT FROM p_customer_id THEN
      RAISE EXCEPTION 'B/L % nao pertence ao cliente informado.', v_bl.id USING ERRCODE = '22023';
    END IF;
  END LOOP;

  IF v_found_count <> cardinality(v_bl_ids) THEN
    RAISE EXCEPTION 'Um ou mais B/Ls nao foram encontrados.' USING ERRCODE = 'P0002';
  END IF;

  FOREACH v_bl_id IN ARRAY v_bl_ids
  LOOP
    PERFORM public.mark_bl_ready_for_billing(v_bl_id, p_actor);
  END LOOP;

  RETURN public.create_invoice_from_bls_with_ledger(
    v_bl_ids,
    p_customer_id,
    p_notes,
    true,
    p_actor
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.move_bls_to_manifesto_mercante(p_bl_ids text[], p_numero text, p_reason text, p_expected jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_numero text := public.canonical_manifesto_numero(p_numero);
  v_ids text[];
  v_route record;
  v_routes integer;
  v_target public.manifestos_mercante%ROWTYPE;
  v_created boolean := false;
  v_moved integer;
BEGIN
  IF v_actor IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuário sem permissão ativa.' USING ERRCODE = '42501';
  END IF;
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'Informe o motivo da mudança de Manifesto Mercante.' USING ERRCODE = '22023';
  END IF;
  IF v_numero IS NULL OR v_numero !~ '^[A-Z0-9]{13}$' THEN
    RAISE EXCEPTION 'Nº de Manifesto Mercante inválido: "%". O número tem 13 caracteres, letras ou dígitos (ex.: 1226501860578).', p_numero
      USING ERRCODE = 'P0012';
  END IF;

  v_ids := public._lock_bls_for_manifesto(p_bl_ids);
  -- 478 (CEB-D01): o B/L fica no Manifesto Mercante só com CE (ADR 0095, decisão 19).
  IF EXISTS (SELECT 1 FROM public.bls AS b WHERE b.id = ANY(v_ids) AND NULLIF(btrim(COALESCE(b.ce_mercante, '')), '') IS NULL) THEN
    RAISE EXCEPTION 'B/L sem CE Mercante não entra em Manifesto: %. O CE entra pela planilha de CE Mercante, que também vincula o Manifesto.',
      (SELECT string_agg(b.id, ', ' ORDER BY b.id) FROM public.bls AS b WHERE b.id = ANY(v_ids) AND NULLIF(btrim(COALESCE(b.ce_mercante, '')), '') IS NULL)
      USING ERRCODE = '22023';
  END IF;
  PERFORM public._check_expected_manifestos(v_ids, p_expected);
  SELECT count(DISTINCT (b.voyage_id, public.normalize_port_code(b.pol), public.normalize_port_code(b.pod))) INTO v_routes
  FROM public.bls AS b WHERE b.id = ANY(v_ids);
  IF v_routes > 1 THEN
    RAISE EXCEPTION 'Os B/Ls selecionados são de mais de uma viagem ou rota (POL → POD); um Manifesto tem uma única rota.' USING ERRCODE = '22023';
  END IF;
  SELECT b.voyage_id, btrim(b.pol) AS pol, btrim(b.pod) AS pod INTO v_route FROM public.bls AS b WHERE b.id = ANY(v_ids) LIMIT 1;
  IF NULLIF(v_route.pol, '') IS NULL OR NULLIF(v_route.pod, '') IS NULL THEN
    RAISE EXCEPTION 'Os B/Ls selecionados não têm POL e POD cadastrados; sem rota não há Manifesto.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_target FROM public.manifestos_mercante WHERE numero = v_numero;
  v_created := NOT FOUND;
  PERFORM public._upsert_route_manifesto(v_route.voyage_id, v_route.pol, v_route.pod, 'carga', v_numero);
  SELECT * INTO v_target FROM public.manifestos_mercante WHERE numero = v_numero;
  IF v_created THEN
    INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
    VALUES ('voyage', v_route.voyage_id::text, 'manifesto_mercante_created', NULL, v_numero, v_actor, v_reason);
  END IF;

  v_moved := public._link_bls_to_manifesto(v_ids, v_target.id, v_actor, v_reason);
  RETURN jsonb_build_object(
    'manifesto_mercante_id', v_target.id, 'numero', v_numero, 'created', v_created,
    'moved', v_moved, 'unchanged', cardinality(v_ids) - v_moved);
END;
$function$;

CREATE OR REPLACE FUNCTION public.obsolete_consolidated_invoice(p_invoice_id bigint, p_reason text DEFAULT NULL::text, p_actor uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_invoice RECORD;
  v_actor UUID;
  v_reason TEXT;
BEGIN
  -- O autor é quem está logado (ADR 0085, regra base 2; migration 241).
  PERFORM public._assert_actor_is_caller(p_actor);
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Usuário sem permissão de faturamento.' USING ERRCODE = '42501';
  END IF;

  v_actor := COALESCE(p_actor, auth.uid());
  v_reason := COALESCE(NULLIF(TRIM(COALESCE(p_reason, '')), ''), 'Marcada obsoleta manualmente');

  SELECT * INTO v_invoice FROM public.invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice % nao encontrada.', p_invoice_id USING ERRCODE = 'P0002';
  END IF;

  IF COALESCE(v_invoice.invoice_type, 'individual') <> 'consolidated' THEN
    RAISE EXCEPTION 'Apenas consolidadas podem ser marcadas obsoletas por esta rotina.' USING ERRCODE = '22023';
  END IF;

  IF COALESCE(v_invoice.status, 'issued') NOT IN ('issued', 'partially_paid', 'overdue') THEN
    RAISE EXCEPTION 'Invoice % nao esta em estado obsoletavel (status=%).', p_invoice_id, v_invoice.status
      USING ERRCODE = '22023';
  END IF;

  -- F-51 (376): consolidada com baixa ou Pix recebido não vira obsoleta à mão.
  IF coalesce(v_invoice.total_paid_brl, 0) > 0
     OR EXISTS (SELECT 1 FROM public.payments WHERE invoice_id = p_invoice_id)
     OR EXISTS (SELECT 1 FROM public.itau_pix_receipts r JOIN public.itau_pix_charges c ON c.id = r.charge_id WHERE c.invoice_id = p_invoice_id) THEN
    RAISE EXCEPTION 'Consolidada com pagamento ou Pix recebido não pode ser marcada obsoleta. Cancele a baixa ou trate o Pix antes.'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.invoices SET status = 'obsolete', obsolete_reason = v_reason WHERE id = p_invoice_id;

  UPDATE public.invoice_receivable_links SET status = 'obsolete'
  WHERE invoice_id = p_invoice_id AND status = 'active';

  INSERT INTO public.invoice_lifecycle_events (invoice_id, event_type, actor, payload)
  VALUES (p_invoice_id, 'obsolete', v_actor, jsonb_build_object('reason', v_reason));

  INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification)
  VALUES ('invoice', p_invoice_id::TEXT, 'obsolete_consolidated', COALESCE(v_invoice.status, 'issued'), 'obsolete', auth.uid(), now(), v_reason);

  RETURN jsonb_build_object('invoice_id', p_invoice_id, 'status', 'obsolete', 'reason', v_reason);
END;
$function$;

CREATE OR REPLACE FUNCTION public.omit_voyage_escala(p_voyage_id bigint, p_omitted_pod text, p_discharge_pod text, p_reason text, p_changed_by uuid, p_onward_vessel_name text DEFAULT NULL::text, p_onward_carrier text DEFAULT NULL::text, p_onward_voyage_number text DEFAULT NULL::text, p_onward_etd timestamp with time zone DEFAULT NULL::timestamp with time zone, p_onward_eta timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_omitted TEXT := upper(btrim(COALESCE(p_omitted_pod, '')));
  v_discharge TEXT := upper(btrim(COALESCE(p_discharge_pod, '')));
  v_entity_id TEXT := p_voyage_id::text || '::' || v_omitted;
  v_omission_id BIGINT;
  v_constraint TEXT;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR p_changed_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Usuário sem permissão ativa.' USING ERRCODE = '42501';
  END IF;

  IF v_omitted = '' OR v_discharge = '' THEN
    RAISE EXCEPTION 'POD omitido/descarga invalidos' USING ERRCODE = '22023';
  END IF;
  -- 477 (02-viagens-adr:15): a carga é descarregada em outro porto da viagem.
  IF COALESCE(public.normalize_port_code(v_discharge), v_discharge) = COALESCE(public.normalize_port_code(v_omitted), v_omitted) THEN
    RAISE EXCEPTION 'O Porto de Transbordo precisa ser outro porto da viagem, não o porto omitido. Cadastre antes a escala onde a carga será descarregada.'
      USING ERRCODE = '22023';
  END IF;

  -- Serializa concorrentes da mesma viagem (por viagem/escala via lock + unique).
  PERFORM 1 FROM public.voyages WHERE id = p_voyage_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Viagem % nao encontrada', p_voyage_id USING ERRCODE = 'P0002';
  END IF;

  BEGIN
    INSERT INTO public.voyage_omissions(
      voyage_id, omitted_pod, discharge_pod, reason, omitted_by,
      onward_vessel_name, onward_carrier, onward_voyage_number, onward_etd, onward_eta
    )
    VALUES (
      p_voyage_id, v_omitted, v_discharge,
      NULLIF(btrim(COALESCE(p_reason, '')), ''),
      p_changed_by,
      NULLIF(btrim(COALESCE(p_onward_vessel_name, '')), ''),
      NULLIF(btrim(COALESCE(p_onward_carrier, '')), ''),
      NULLIF(btrim(COALESCE(p_onward_voyage_number, '')), ''),
      p_onward_etd, p_onward_eta
    )
    RETURNING id INTO v_omission_id;
  EXCEPTION
    WHEN unique_violation THEN
      GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
      -- So a constraint de omissao esperada vira duplicidade amigavel;
      -- qualquer outra unique_violation propaga (nao esconde outra constraint).
      IF v_constraint = 'voyage_omissions_voyage_id_omitted_pod_key' THEN
        RAISE EXCEPTION 'A escala da viagem % ja foi omitida para o POD %.', p_voyage_id, v_omitted
          USING ERRCODE = '23505';
      END IF;
      RAISE;
  END;

  INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  VALUES (
    'voyage_pod_schedule', v_entity_id, 'omitted', 'false', 'true', p_changed_by,
    'Escala omitida pelo armador; carga descarregada em ' || v_discharge
  );

  INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  VALUES (
    'voyage', p_voyage_id::text, 'escala_omitida', v_omitted, v_discharge, p_changed_by,
    COALESCE(NULLIF(btrim(COALESCE(p_reason, '')), ''), 'Omissao de escala')
  );

  INSERT INTO public.bl_transshipments(bl_id, omission_id, disposition, created_by)
  SELECT b.id, v_omission_id, 'transshipment', p_changed_by
  FROM public.bls b
  WHERE b.voyage_id = p_voyage_id
    AND upper(btrim(COALESCE(b.pod, ''))) = v_omitted
  ON CONFLICT (bl_id, omission_id) DO NOTHING;

  INSERT INTO public.portal_notifications(customer_id, bl_id, type, title, message, link)
  SELECT
    b.customer_id, b.id, 'transshipment', 'Escala omitida',
    'A escala de ' || v_omitted || ' foi omitida. A carga do B/L ' || b.id ||
      ' foi descarregada em ' || v_discharge || ' e seguira em transbordo para ' || v_omitted || '.',
    NULL
  FROM public.bls b
  WHERE b.voyage_id = p_voyage_id
    AND upper(btrim(COALESCE(b.pod, ''))) = v_omitted
    AND b.customer_id IS NOT NULL;

  RETURN v_omission_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.portal_obsolete_consolidation(p_invoice_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_customer_id BIGINT := public.current_portal_customer_id();
  v_invoice RECORD;
BEGIN
  PERFORM public.check_portal_rate_limit('obsolete_consolidation', 3, 15);
  SELECT i.id, i.status, i.invoice_type, i.customer_id, i.invoice_number INTO v_invoice
  FROM public.invoices i WHERE i.id = p_invoice_id AND i.customer_id = v_customer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Fatura não encontrada.' USING ERRCODE = 'P0002'; END IF;
  IF v_invoice.invoice_type != 'consolidated' THEN RAISE EXCEPTION 'Esta fatura não é uma consolidada.' USING ERRCODE = 'P0002'; END IF;
  -- Só a consolidada emitida e ainda a pagar (documentado em portal-cliente.md);
  -- rascunho e demais estados não são desfeitos pelo Portal.
  IF v_invoice.status NOT IN ('issued', 'partially_paid', 'overdue') THEN RAISE EXCEPTION 'Esta fatura já foi paga ou cancelada e não pode ser desfeita.' USING ERRCODE = 'P0002'; END IF;
  IF EXISTS (SELECT 1 FROM public.payments WHERE invoice_id = p_invoice_id) THEN RAISE EXCEPTION 'Fatura com pagamento registrado não pode ser desfeita.' USING ERRCODE = 'P0002'; END IF;
  IF v_invoice.invoice_number IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.pix_reconciliation_exceptions e
    WHERE e.status = 'active'
      AND e.normalized_txid = public.normalize_pix_txid(v_invoice.invoice_number)
  ) THEN
    RAISE EXCEPTION 'Há um PIX desta fatura em conciliação; aguarde antes de desfazer.' USING ERRCODE = '55000';
  END IF;
  -- F-51 (376): Pix recebido pelo Itaú na cobrança desta consolidada também segura.
  IF EXISTS (SELECT 1 FROM public.itau_pix_receipts r JOIN public.itau_pix_charges c ON c.id = r.charge_id WHERE c.invoice_id = p_invoice_id) THEN
    RAISE EXCEPTION 'Há um PIX desta fatura recebido pelo banco; aguarde a baixa antes de desfazer.' USING ERRCODE = '55000';
  END IF;
  INSERT INTO public.invoice_lifecycle_events (invoice_id, event_type, actor, payload)
  VALUES (p_invoice_id, 'obsolete', NULL, jsonb_build_object('reason', 'obsoleted_by_customer', 'origin', 'portal', 'customer_id', v_customer_id));
  UPDATE public.invoices SET status = 'obsolete', obsolete_reason = 'Desfeita pelo cliente pelo portal.', updated_at = now() WHERE id = p_invoice_id;
  UPDATE public.invoice_receivable_links SET status = 'obsolete' WHERE invoice_id = p_invoice_id AND status = 'active';
  INSERT INTO public.portal_notifications (customer_id, type, title, message, link)
  VALUES (v_customer_id, 'system', 'Consolidacao desfeita',
    'A fatura ' || COALESCE(v_invoice.invoice_number, '#' || p_invoice_id) || ' foi desfeita. Os B/Ls estao disponiveis para nova consolidacao.', '/portal/billing');
  RETURN jsonb_build_object('success', true, 'invoice_id', p_invoice_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.preflight_depots_terminal_port_mapping()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_read_user() THEN
    RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object(
    'pending_count', (
      SELECT count(*)
      FROM public.depots AS d
      WHERE d.tipo = 'terminal_portuario' AND d.port_id IS NULL
    ),
    'codes', COALESCE((
      SELECT jsonb_agg(d.code ORDER BY d.code)
      FROM public.depots AS d
      WHERE d.tipo = 'terminal_portuario' AND d.port_id IS NULL
    ), '[]'::JSONB)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.prevent_pending_review_invoice()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_review_reasons TEXT[];
BEGIN
  IF NEW.financial_status = 'invoiced'
     AND (TG_OP = 'INSERT' OR coalesce(OLD.financial_status, 'pending') = 'pending') THEN
    v_review_reasons := public.compute_bl_review_pendencies(
      NEW.customer_id,
      NEW.cargo_mode,
      NEW.bb_weight_ton
    );

    IF NEW.review_status = 'pending_review'
       OR COALESCE(cardinality(v_review_reasons), 0) > 0 THEN
      RAISE EXCEPTION
        'B/L em revisão manual não pode ser faturado: %',
        COALESCE(array_to_string(v_review_reasons, ', '), 'revisao pendente')
        USING ERRCODE = '22023';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.preview_baplie_physical_flags(p_voyage_id bigint, p_rows jsonb, p_pods text[] DEFAULT NULL::text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_codes text[] := public._baplie_carrier_codes(p_voyage_id);
  v_rows jsonb;
  v_pod_keys text[] := CASE WHEN p_pods IS NULL THEN NULL
    ELSE ARRAY(SELECT DISTINCT public._baplie_port_key(p) FROM unnest(p_pods) AS p WHERE NULLIF(btrim(COALESCE(p, '')), '') IS NOT NULL) END;
  v_incoming text[];
  v_staged jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuário sem permissão ativa.' USING ERRCODE = '42501';
  END IF;
  SELECT COALESCE(jsonb_agg(r.value), '[]'::jsonb) INTO v_rows
  FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_rows) = 'array' THEN p_rows ELSE '[]'::jsonb END) AS r(value)
  WHERE NOT public._baplie_other_carrier(r.value->>'operator', v_codes);
  v_incoming := ARRAY(SELECT DISTINCT upper(btrim(r.value->>'container_number')) FROM jsonb_array_elements(v_rows) AS r(value));
  SELECT COALESCE(jsonb_agg(to_jsonb(b)), '[]'::jsonb) INTO v_staged
  FROM public.baplie_containers AS b
  WHERE b.voyage_id = p_voyage_id
    AND NOT public._baplie_row_replaced(b.pod, b.container_number, v_pod_keys, v_incoming);
  v_staged := v_staged || v_rows;
  RETURN (
    SELECT jsonb_build_object(
      'apply', COALESCE(jsonb_agg(jsonb_build_object('container', p.container_number, 'bl_id', p.bl_id,
        'before', public._baplie_flags_label(p.old_is_imo, p.old_is_oog, p.old_ownership),
        'after', public._baplie_flags_label(p.new_is_imo, p.new_is_oog, p.new_ownership)) ORDER BY p.container_number, p.bl_id)
        FILTER (WHERE p.action = 'apply'), '[]'::jsonb),
      'clear', COALESCE(jsonb_agg(jsonb_build_object('container', p.container_number, 'bl_id', p.bl_id,
        'before', public._baplie_flags_label(p.old_is_imo, p.old_is_oog, p.old_ownership),
        'after', public._baplie_flags_label(p.new_is_imo, p.new_is_oog, p.new_ownership)) ORDER BY p.container_number, p.bl_id)
        FILTER (WHERE p.action = 'clear'), '[]'::jsonb),
      'divergent_manual', COALESCE(jsonb_agg(jsonb_build_object('container', p.container_number, 'bl_id', p.bl_id)
        ORDER BY p.container_number, p.bl_id) FILTER (WHERE p.action = 'divergent_manual'), '[]'::jsonb)
    )
    FROM public._baplie_flag_plan(p_voyage_id, v_staged) AS p
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.preview_bl_charge_adjustment_impact(p_changes jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_changes jsonb := CASE WHEN jsonb_typeof(p_changes) = 'array' THEN p_changes ELSE '[]'::jsonb END;
  v_targets text[];
  v_candidates text[];
  v_before jsonb := '{}'::jsonb;
  v_after_lines jsonb := '{}'::jsonb;
  v_gone jsonb := '{}'::jsonb;
  v_events jsonb := '[]'::jsonb;
  v_max_event bigint;
  v_change jsonb;
  v_bl text;
  v_bl_row record;
  v_out jsonb := '[]'::jsonb;
  v_items jsonb;
  v_adj jsonb;
  v_event jsonb;
  v_after_qty numeric;
  v_outcome text;
  v_error text;
BEGIN
  -- A simulação trava linhas até o rollback: só quem grava pode rodá-la.
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuário sem permissão ativa' USING ERRCODE = '42501';
  END IF;

  SELECT array_agg(DISTINCT btrim(c->>'bl_id')) INTO v_targets
    FROM jsonb_array_elements(v_changes) c WHERE NULLIF(btrim(c->>'bl_id'), '') IS NOT NULL;
  IF v_targets IS NULL THEN RETURN '[]'::jsonb; END IF;

  -- Irmãos de container: o rateio muda a quantidade deles também.
  SELECT array_agg(DISTINCT x.id) INTO v_candidates FROM (
    SELECT unnest(v_targets) AS id
    UNION
    SELECT c2.bl_id FROM public.bl_containers c1
      JOIN public.bls b1 ON b1.id = c1.bl_id
      JOIN public.bl_containers c2 ON upper(c2.container_number) = upper(c1.container_number) AND c2.bl_id <> c1.bl_id
      JOIN public.bls b2 ON b2.id = c2.bl_id AND b2.voyage_id = b1.voyage_id
     WHERE c1.bl_id = ANY(v_targets)
    UNION
    -- 497: o container acrescentado que já está em outro B/L da Viagem passa a
    -- ser dividido, e o rateio desse B/L muda na gravação.
    SELECT c2.bl_id FROM jsonb_array_elements(v_changes) c
      CROSS JOIN LATERAL jsonb_array_elements(COALESCE(c->'add_containers', '[]'::jsonb)) n
      JOIN public.bls b1 ON b1.id = btrim(c->>'bl_id')
      JOIN public.bl_containers c2 ON upper(c2.container_number) = upper(btrim(n->>'container_number')) AND c2.bl_id <> b1.id
      JOIN public.bls b2 ON b2.id = c2.bl_id AND b2.voyage_id = b1.voyage_id
    UNION
    SELECT btrim(m->>'to_bl_id') FROM jsonb_array_elements(v_changes) c,
      jsonb_array_elements(COALESCE(c->'move_vehicles', '[]'::jsonb)) m
  ) x
  JOIN public.bls b ON b.id = x.id AND b.cancelled_at IS NULL
  WHERE EXISTS (SELECT 1 FROM public.bl_charge_adjustments a WHERE a.bl_id = x.id AND a.ended_at IS NULL)
     OR EXISTS (SELECT 1 FROM public.bl_local_charge_exemptions e WHERE e.bl_id = x.id);
  IF v_candidates IS NULL THEN RETURN '[]'::jsonb; END IF;

  FOREACH v_bl IN ARRAY v_candidates LOOP
    v_before := v_before || jsonb_build_object(v_bl, public._bl_charge_adjustment_snapshot(v_bl));
  END LOOP;
  SELECT COALESCE(max(id), 0) INTO v_max_event FROM public.bl_charge_adjustment_events;

  BEGIN
    PERFORM set_config('vela.bl_charge_simulation', 'on', true);
    FOR v_change IN SELECT * FROM jsonb_array_elements(v_changes) LOOP
      PERFORM public._apply_bl_charge_simulation_change(v_change);
    END LOOP;
    FOREACH v_bl IN ARRAY v_candidates LOOP
      SELECT b.id, b.pod, COALESCE(b.financial_status, 'pending') AS financial_status INTO v_bl_row
        FROM public.bls b WHERE b.id = v_bl;
      IF v_bl_row.financial_status NOT IN ('invoiced', 'partially_paid', 'paid') THEN
        PERFORM public.bind_bl_local_charge_tables(v_bl);
        PERFORM public._reconcile_bl_charge_adjustments(v_bl);
      END IF;
      v_after_lines := v_after_lines || jsonb_build_object(v_bl, (
        SELECT COALESCE(jsonb_object_agg(r.calculation_key, r.quantity), '{}'::jsonb)
          FROM public._resolve_bl_local_charge_items_charged(v_bl, v_bl_row.pod) r
         WHERE r.calculation_key IS NOT NULL));
      -- 498: alteração cuja taxa sai da cobrança (quantidade a zero).
      v_gone := v_gone || jsonb_build_object(v_bl, COALESCE((
        SELECT jsonb_agg(g) FROM public._bl_charge_adjustments_out_of_charge(v_bl,
          ARRAY(SELECT jsonb_object_keys(v_after_lines->v_bl))) g), '[]'::jsonb));
    END LOOP;
    SELECT COALESCE(jsonb_agg(jsonb_build_object('bl_id', e.bl_id, 'event', e.event, 'line_key', e.line_key,
             'after', e.after) ORDER BY e.id), '[]'::jsonb)
      INTO v_events
      FROM public.bl_charge_adjustment_events e
     WHERE e.id > v_max_event AND e.bl_id = ANY(v_candidates) AND e.event IN ('discarded', 'remapped');
    PERFORM set_config('vela.bl_charge_simulation', 'off', true);
    RAISE EXCEPTION 'simulação desfeita' USING ERRCODE = 'VB495';
  EXCEPTION
    WHEN SQLSTATE 'VB495' THEN NULL;
    WHEN OTHERS THEN
      v_error := SQLERRM;
  END;
  PERFORM set_config('vela.bl_charge_simulation', 'off', true);

  IF v_error IS NOT NULL THEN
    RETURN jsonb_build_array(jsonb_build_object('error', v_error));
  END IF;

  FOREACH v_bl IN ARRAY v_candidates LOOP
    v_items := '[]'::jsonb;
    FOR v_adj IN SELECT * FROM jsonb_array_elements(v_before->v_bl) LOOP
      SELECT ev INTO v_event FROM jsonb_array_elements(v_events) ev
       WHERE ev->>'bl_id' = v_bl AND ev->>'line_key' = v_adj->>'line_key' LIMIT 1;
      v_after_qty := NULLIF(v_after_lines->v_bl->>(v_adj->>'line_key'), '')::numeric;
      IF v_event->>'event' = 'discarded' THEN
        v_outcome := 'discarded';
      ELSIF v_event->>'event' = 'remapped' THEN
        v_outcome := 'remapped';
      ELSIF (v_gone->v_bl) @> to_jsonb((v_adj->>'id')::bigint) AND COALESCE((v_adj->>'quantity')::numeric, 0) > 0 THEN
        v_outcome := CASE WHEN v_adj->>'kind' = 'total' THEN 'removed' ELSE 'quantity' END;
        v_after_qty := 0;
      ELSIF v_adj->>'kind' IN ('unit', 'total') AND v_adj->>'source' = 'auto' AND v_after_qty IS NOT NULL
            AND v_after_qty IS DISTINCT FROM (v_adj->>'quantity')::numeric THEN
        v_outcome := CASE WHEN v_adj->>'kind' = 'total' THEN 'total_kept' ELSE 'quantity' END;
      ELSE
        v_outcome := 'kept';
      END IF;
      v_items := v_items || jsonb_build_array(v_adj || jsonb_build_object(
        'outcome', v_outcome,
        'after_quantity', COALESCE(v_after_qty, (v_adj->>'quantity')::numeric),
        'after_total', CASE
          WHEN v_outcome = 'quantity' THEN round((v_adj->>'value')::numeric * v_after_qty, 2)
          WHEN v_outcome IN ('discarded', 'removed') THEN NULL
          ELSE (v_adj->>'total')::numeric END,
        'reason', v_event->'after'->>'reason',
        'table_name', v_event->'after'->>'table_name',
        'pod', v_event->'after'->>'pod',
        'needs_confirmation', v_outcome IN ('discarded', 'total_kept', 'removed')));
      v_event := NULL;
    END LOOP;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'bl_id', v_bl,
      'manual_exempt', EXISTS (SELECT 1 FROM public.bl_local_charge_exemptions e WHERE e.bl_id = v_bl),
      'items', v_items));
  END LOOP;
  RETURN v_out;
END;
$function$;

CREATE OR REPLACE FUNCTION public.preview_ce_mercante_rows(p_rows jsonb, p_manifesto_numero text, p_voyage_id bigint DEFAULT NULL::bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuário sem permissão ativa.' USING ERRCODE = '42501';
  END IF;
  RETURN public._analyze_ce_mercante_rows(p_rows, p_manifesto_numero, p_voyage_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.quote_manual_invoice_charge(p_bl_id text, p_charge_item_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_item record;
  v_basis text;
  v_quantity numeric := 1;
  v_unit numeric;
  v_roe numeric;
  v_roe_date date;
  v_override bigint;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_read_user() THEN
    RAISE EXCEPTION 'Usuário sem permissão ativa.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_item FROM public.list_manual_charge_items_for_bl(p_bl_id)
    WHERE charge_item_id = p_charge_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item manual nao elegivel para este B/L.' USING ERRCODE = '22023';
  END IF;
  SELECT application_basis INTO v_basis FROM public.charge_table_items WHERE id = p_charge_item_id;
  IF v_basis = 'teu' THEN
    SELECT sum(CASE WHEN normalized ~ '^45' THEN 2.25 WHEN normalized ~ '^(40|42)' THEN 2
      WHEN normalized ~ '^(20|22)' THEN 1 ELSE NULL END)
    INTO v_quantity FROM (SELECT regexp_replace(upper(coalesce(type, '')), '[[:space:]-]', '', 'g') normalized
      FROM public.bl_containers WHERE bl_id = upper(btrim(p_bl_id))) c;
    IF EXISTS (SELECT 1 FROM public.bl_containers WHERE bl_id = upper(btrim(p_bl_id))
      AND regexp_replace(upper(coalesce(type, '')), '[[:space:]-]', '', 'g') !~ '^(45|40|42|20|22)') THEN
      RAISE EXCEPTION 'Tipo de container desconhecido; confira os TEUs do B/L.' USING ERRCODE = '22023';
    END IF;
  ELSIF v_basis IS DISTINCT FROM 'bl' THEN
    RAISE EXCEPTION 'Base de cobranca nao suportada na avulsa: %.', v_basis USING ERRCODE = '22023';
  END IF;
  IF coalesce(v_quantity, 0) <= 0 THEN
    RAISE EXCEPTION 'B/L sem quantidade faturavel.' USING ERRCODE = '22023';
  END IF;
  SELECT cro.id INTO v_override FROM public.customer_rate_overrides cro
    JOIN public.bls b ON b.customer_id = cro.customer_id
    WHERE b.id = upper(btrim(p_bl_id)) AND cro.charge_item_id = p_charge_item_id AND cro.active
      AND (cro.valid_from IS NULL OR cro.valid_from <= public.bl_local_charge_reference_date(b.id))
      AND (cro.valid_to IS NULL OR cro.valid_to >= public.bl_local_charge_reference_date(b.id))
    ORDER BY cro.created_at DESC LIMIT 1;
  IF v_item.currency = 'USD' THEN
    SELECT roe, effective_date INTO v_roe, v_roe_date FROM public.exchange_rate_reference WHERE id = 1;
    IF v_roe IS NULL OR v_roe <= 0 THEN
      RAISE EXCEPTION 'Câmbio (ROE) não configurado.' USING ERRCODE = '22023';
    END IF;
    v_unit := round(v_item.effective_unit_value_usd * v_roe, 2);
  ELSE
    v_unit := v_item.effective_unit_value_brl;
  END IF;
  RETURN to_jsonb(v_item) || jsonb_build_object('quantity', v_quantity, 'application_basis', v_basis,
    'unit_value_brl', v_unit, 'total_brl', CASE WHEN v_item.currency = 'USD'
      THEN round(round(v_quantity * v_item.effective_unit_value_usd, 2) * v_roe, 2) ELSE round(v_quantity * v_unit, 2) END,
    'total_usd', CASE WHEN v_item.currency = 'USD' THEN round(v_quantity * v_item.effective_unit_value_usd, 2) END,
    'roe', v_roe, 'roe_effective_date', v_roe_date, 'override_id', v_override);
END;
$function$;

CREATE OR REPLACE FUNCTION public.recalculate_demurrage_invoices_manual(p_ptax numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user()
     OR public.current_actor_role() NOT IN ('financeiro', 'administrativo', 'equipamentos') THEN
    RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501';
  END IF;
  RETURN public.recalculate_demurrage_invoices(
    p_ptax,
    (now() AT TIME ZONE 'America/Sao_Paulo')::date,
    'manual'
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.reconcile_invoice_payment_by_txid(p_txid text, p_amount_brl numeric, p_paid_at timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_norm text; v_count integer; v_id bigint; v_original bigint; v_expected numeric; v_result jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_financeiro_user() THEN
    RAISE EXCEPTION 'Sem permissão de faturamento.' USING ERRCODE = '42501';
  END IF;
  v_norm := upper(regexp_replace(coalesce(p_txid, ''), '[^A-Za-z0-9]', '', 'g'));
  PERFORM pg_advisory_xact_lock(hashtextextended('local_pix:' || v_norm, 0));
  IF EXISTS (SELECT 1 FROM public.ledger_settlements WHERE upper(regexp_replace(pix_txid, '[^A-Za-z0-9]', '', 'g')) = v_norm) THEN
    RETURN jsonb_build_object('matched', false, 'reason', 'already_reconciled');
  END IF;
  -- Lock the historical invoice as well as its chain. Cancellation uses the same row locks.
  PERFORM 1 FROM public.invoices WHERE id IN
    (SELECT invoice_id FROM public.local_pix_charge_versions WHERE txid = v_norm) ORDER BY id FOR UPDATE;
  SELECT count(*), min(invoice_id), min(charge_invoice_id), min(expected_brl)
    INTO v_count, v_id, v_original, v_expected FROM public.resolve_local_pix_charge(v_norm);
  IF v_count = 0 THEN
    IF EXISTS (SELECT 1 FROM public.local_pix_charge_versions WHERE txid = v_norm) THEN
      RETURN jsonb_build_object('matched', false, 'reason', 'historical_charge_requires_review');
    END IF;
    RETURN public.reconcile_invoice_payment_by_txid_legacy_130(p_txid, p_amount_brl, p_paid_at);
  ELSIF v_count <> 1 THEN
    RETURN jsonb_build_object('matched', false, 'reason', 'ambiguous');
  END IF;
  PERFORM 1 FROM public.invoices WHERE id = v_id FOR UPDATE;
  -- Revalidate after waiting for a concurrent successor cancellation/payment.
  IF NOT EXISTS (SELECT 1 FROM public.resolve_local_pix_charge(v_norm) WHERE invoice_id = v_id) THEN
    RETURN jsonb_build_object('matched', false, 'reason', 'historical_charge_requires_review');
  END IF;
  IF p_amount_brl IS NULL OR round(p_amount_brl, 2) <> v_expected OR p_amount_brl <> round(p_amount_brl, 2) THEN
    RETURN jsonb_build_object('matched', true, 'invoice_id', v_id, 'settled', false, 'reason', 'charge_amount_mismatch');
  END IF;
  BEGIN
    -- Only this authenticated, exact historical-charge path may use the existing
    -- overpayment allocator. It allocates current balance and creates a refund.
    v_result := public.register_ledger_invoice_payment(v_id, p_amount_brl, 'pix', coalesce(p_paid_at, now()), p_txid,
      'manual', 'Pix de cobranca historica validada; fatura de origem ' || v_original, auth.uid());
    -- The manual allocator may have copied the TXID onto several allocations.
    -- Keep it on one row per payment before entering the unique Pix index.
    UPDATE public.ledger_settlements SET source = 'pix_extract',
      pix_txid = CASE WHEN id = (SELECT min(id) FROM public.ledger_settlements
        WHERE payment_id = (v_result->>'payment_id')::bigint) THEN p_txid ELSE NULL END
      WHERE payment_id = (v_result->>'payment_id')::bigint;
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('matched', true, 'invoice_id', v_id, 'settled', false, 'reason', SQLERRM);
  END;
  UPDATE public.invoices SET pix_txid = p_txid, conciliated_by_extract = true WHERE id = v_id;
  INSERT INTO public.invoice_lifecycle_events(invoice_id, event_type, actor, payload)
  VALUES (v_id, 'reconciled_by_txid', auth.uid(), jsonb_build_object('txid', p_txid, 'amount_brl', p_amount_brl,
    'charge_invoice_id', v_original, 'source', 'pix_extract'));
  RETURN jsonb_build_object('matched', true, 'invoice_id', v_id, 'settled', true, 'payment', v_result);
END;
$function$;

CREATE OR REPLACE FUNCTION public.reconcile_invoice_payment_by_txid_legacy_130(p_txid text, p_amount_brl numeric, p_paid_at timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_norm text;
  v_invoice_id bigint;
  v_invoice_type text;
  v_match_count integer;
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_financeiro_user() THEN
    RAISE EXCEPTION 'Usuário sem permissão de faturamento.' USING ERRCODE = '42501';
  END IF;

  v_norm := upper(regexp_replace(COALESCE(p_txid, ''), '[^A-Za-z0-9]', '', 'g'));
  IF v_norm = '' THEN
    RETURN jsonb_build_object('matched', false, 'reason', 'empty_txid');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.ledger_settlements
    WHERE pix_txid IS NOT NULL
      AND upper(regexp_replace(pix_txid, '[^A-Za-z0-9]', '', 'g')) = v_norm
  ) OR EXISTS (
    SELECT 1
    FROM public.invoices
    WHERE invoice_type = 'manual'
      AND pix_txid IS NOT NULL
      AND upper(regexp_replace(pix_txid, '[^A-Za-z0-9]', '', 'g')) = v_norm
  ) THEN
    RETURN jsonb_build_object('matched', false, 'reason', 'already_reconciled');
  END IF;

  SELECT COUNT(*), MIN(id), MIN(invoice_type)
  INTO v_match_count, v_invoice_id, v_invoice_type
  FROM public.invoices
  WHERE invoice_type IN ('individual', 'consolidated', 'manual')
    AND COALESCE(status, 'issued') IN ('issued', 'partially_paid', 'overdue')
    AND (upper(regexp_replace(COALESCE(invoice_number, ''), '[^A-Za-z0-9]', '', 'g')) = v_norm
      -- Avulsa cobrada pelo QR Itaú: o TXID é o da cobrança (migration 242).
      OR (invoice_type = 'manual' AND EXISTS (
        SELECT 1 FROM public.itau_pix_charges AS c
        WHERE c.invoice_id = invoices.id AND public.normalize_pix_txid(c.txid) = v_norm)));

  IF v_match_count = 0 THEN
    RETURN jsonb_build_object('matched', false, 'reason', 'no_match');
  ELSIF v_match_count > 1 THEN
    RETURN jsonb_build_object('matched', false, 'reason', 'ambiguous');
  END IF;

  BEGIN
    IF v_invoice_type = 'manual' THEN
      -- Manual uses the generic payments path, never ledger_settlements.
      v_result := public.register_invoice_payment(
        p_invoice_id := v_invoice_id,
        p_amount_brl := p_amount_brl,
        p_payment_method := 'pix',
        p_paid_at := COALESCE(p_paid_at, now()),
        p_notes := 'Conciliacao automatica por TXID',
        p_actor := auth.uid()
      );

      UPDATE public.invoices
      SET pix_txid = p_txid, conciliated_by_extract = true
      WHERE id = v_invoice_id;

      -- F-05: a cobrança Itaú da avulsa foi paga por este Pix.
      UPDATE public.itau_pix_charges
      SET status = 'concluded', updated_at = now()
      WHERE invoice_id = v_invoice_id
        AND public.normalize_pix_txid(txid) = v_norm
        AND status NOT IN ('concluded', 'cancelled', 'expired');

      INSERT INTO public.invoice_lifecycle_events (invoice_id, event_type, actor, payload)
      VALUES (
        v_invoice_id,
        'reconciled_by_txid',
        auth.uid(),
        jsonb_build_object('txid', p_txid, 'amount_brl', p_amount_brl, 'source', 'manual')
      );

      RETURN jsonb_build_object('matched', true, 'invoice_id', v_invoice_id, 'settled', true, 'payment', v_result);
    END IF;

    v_result := public.register_ledger_invoice_payment(
      p_invoice_id := v_invoice_id,
      p_amount_brl := p_amount_brl,
      p_method := 'pix',
      p_paid_at := COALESCE(p_paid_at, now()),
      p_pix_txid := p_txid,
      p_source := 'pix_extract',
      p_notes := 'Conciliacao automatica por TXID',
      p_actor := auth.uid()
    );
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('matched', true, 'invoice_id', v_invoice_id, 'settled', false, 'reason', SQLERRM);
  END;

  UPDATE public.invoices
  SET pix_txid = p_txid, conciliated_by_extract = true
  WHERE id = v_invoice_id;

  RETURN jsonb_build_object('matched', true, 'invoice_id', v_invoice_id, 'settled', true, 'payment', v_result);
END;
$function$;

CREATE OR REPLACE FUNCTION public.register_demurrage_payment(p_request_id uuid, p_invoice_id bigint, p_paid_at date, p_pix_txid text DEFAULT NULL::text, p_total_brl numeric DEFAULT NULL::numeric, p_ptax_used numeric DEFAULT NULL::numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_payload jsonb;
  v_previous jsonb;
  v_invoice public.demurrage_invoices%ROWTYPE;
  v_match record;
  v_has_history boolean;
  v_total_brl numeric(14,2);
  v_ptax numeric(10,4);
  v_roe numeric(10,4);
  v_discount numeric(12,2);
  v_result jsonb;
  v_txid text := NULLIF(btrim(p_pix_txid), '');
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND (auth.uid() IS NULL OR NOT public.is_financeiro_user()) THEN
    RAISE EXCEPTION 'Usuário sem permissão para registrar baixa de Demurrage.' USING ERRCODE = '42501';
  END IF;
  IF p_invoice_id IS NULL OR p_paid_at IS NULL THEN
    RAISE EXCEPTION 'Fatura e data de pagamento sao obrigatorias.' USING ERRCODE = '22023';
  END IF;
  IF v_txid IS NOT NULL AND char_length(v_txid) > 140 THEN
    RAISE EXCEPTION 'Identificador PIX invalido.' USING ERRCODE = '22023';
  END IF;
  IF p_total_brl IS NOT NULL AND p_total_brl < 0 THEN
    RAISE EXCEPTION 'Valor pago nao pode ser negativo.' USING ERRCODE = '22003';
  END IF;

  v_payload := jsonb_build_object(
    'invoice_id', p_invoice_id,
    'paid_at', p_paid_at,
    'pix_txid', v_txid,
    'total_brl', CASE WHEN p_total_brl IS NULL THEN NULL ELSE round(p_total_brl, 2) END
  );
  v_previous := public._demurrage_mutation_request(p_request_id, 'payment', p_invoice_id, v_payload);
  IF v_previous IS NOT NULL THEN
    RETURN v_previous;
  END IF;

  SELECT * INTO v_invoice
  FROM public.demurrage_invoices
  WHERE id = p_invoice_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Demurrage invoice % nao encontrada.', p_invoice_id USING ERRCODE = 'P0002';
  END IF;

  IF v_invoice.status = 'paid' THEN
    IF v_txid IS NOT NULL AND v_invoice.pix_txid = v_txid THEN
      RETURN jsonb_build_object('invoice_id', p_invoice_id, 'status', 'paid', 'idempotent', true);
    END IF;
    RAISE EXCEPTION 'Demurrage invoice % ja esta paga.', p_invoice_id USING ERRCODE = '22023';
  END IF;
  IF v_invoice.status NOT IN ('issued', 'overdue') OR v_invoice.paid_at IS NOT NULL THEN
    RAISE EXCEPTION 'Demurrage invoice % nao pode ser baixada no status atual.', p_invoice_id USING ERRCODE = '22023';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.demurrage_invoice_history AS h
    WHERE h.invoice_id = p_invoice_id AND h.event_date <= p_paid_at
  ) INTO v_has_history;

  IF v_has_history THEN
    -- A prova financeira vem da foto persistida, e a janela e a mesma do
    -- reconciliador: as DUAS fotos mais recentes ate a data do extrato.
    -- Uma cotacao mais antiga que isso e divergencia, nao quitacao.
    SELECT w.total_brl, w.ptax_used
      INTO v_match
    FROM public.get_demurrage_recent_values(p_invoice_id, p_paid_at) AS w
    WHERE p_total_brl IS NULL OR abs(w.total_brl - round(p_total_brl, 2)) <= 0.01
    ORDER BY w.event_date DESC
    LIMIT 1;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Valor divergente das duas ultimas fotos financeiras da Demurrage %.', p_invoice_id
        USING ERRCODE = '22003';
    END IF;

    v_total_brl := round(COALESCE(p_total_brl, v_match.total_brl), 2);
    v_ptax := v_match.ptax_used;
    -- O ROE da foto casada; get_demurrage_recent_values nao o projeta, entao
    -- ele vem da mesma linha pela chave (invoice, data, total).
    SELECT h.roe_used INTO v_roe
    FROM public.demurrage_invoice_history AS h
    WHERE h.invoice_id = p_invoice_id
      AND h.event_date <= p_paid_at
      AND h.total_brl = v_total_brl
    ORDER BY h.event_date DESC, h.id DESC
    LIMIT 1;
    v_roe := COALESCE(v_roe, v_invoice.current_roe);
  ELSE
    -- Legado sem foto: a propria fatura e a unica referencia disponivel. O ROE
    -- aplicado e conhecido; a PTAX que o originou, nao. Registrar NULL em vez
    -- de deduzir mantem o historico honesto (#658 F9).
    v_total_brl := round(COALESCE(p_total_brl, v_invoice.current_total_brl), 2);
    v_roe := v_invoice.current_roe;
    v_ptax := NULL;
    IF v_invoice.current_total_brl IS NULL
       OR p_total_brl IS NULL
       OR abs(v_invoice.current_total_brl - p_total_brl) > 0.01 THEN
      RAISE EXCEPTION 'Valor divergente da foto financeira da Demurrage %.', p_invoice_id USING ERRCODE = '22003';
    END IF;
  END IF;

  -- ptax_used e procedencia e pode faltar; o par (total_brl, roe_used) e que
  -- precisa ser pagavel. Uma PTAX presente, porem, tem de ser positiva.
  IF v_total_brl IS NULL OR v_total_brl <= 0 OR v_roe IS NULL OR v_roe <= 0 THEN
    RAISE EXCEPTION 'Fatura % nao possui uma foto financeira pagavel.', p_invoice_id USING ERRCODE = '22023';
  END IF;
  IF v_ptax IS NOT NULL AND v_ptax <= 0 THEN
    RAISE EXCEPTION 'Fatura % tem cotacao invalida na foto financeira.', p_invoice_id USING ERRCODE = '22023';
  END IF;
  IF v_txid IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.demurrage_invoices d
    WHERE btrim(d.pix_txid) = v_txid AND d.id <> p_invoice_id
  ) THEN
    RAISE EXCEPTION 'PIX % ja esta associado a outra fatura.', v_txid USING ERRCODE = '23505';
  END IF;

  v_discount := greatest(0, round(v_invoice.total_usd - v_total_brl / v_roe, 2));

  UPDATE public.demurrage_invoices
  SET status = 'paid',
      paid_at = p_paid_at,
      pix_txid = v_txid,
      conciliated_by_extract = (v_txid IS NOT NULL),
      current_total_brl = v_total_brl,
      current_roe = v_roe,
      updated_at = now()
  WHERE id = p_invoice_id;

  INSERT INTO public.demurrage_invoice_history
    (invoice_id, event_date, ptax_used, roe_used, total_usd, total_brl, discount_usd, source)
  VALUES
    (p_invoice_id, p_paid_at, v_ptax, v_roe, v_invoice.total_usd, v_total_brl, v_discount, 'payment');

  INSERT INTO public.audit_logs(
    entity_type, entity_id, field_name, old_value, new_value,
    changed_by, changed_at, justification
  ) VALUES (
    'demurrage_invoice', p_invoice_id::text, 'payment_registered',
    v_invoice.status,
    jsonb_build_object('status', 'paid', 'paid_at', p_paid_at, 'pix_txid', v_txid)::text,
    auth.uid(), now(), 'Baixa de Demurrage por contrato financeiro.'
  );

  v_result := jsonb_build_object(
    'invoice_id', p_invoice_id,
    'status', 'paid',
    'paid_at', p_paid_at,
    'total_brl', v_total_brl,
    'idempotent', false
  );
  INSERT INTO public.demurrage_mutation_requests(request_id, operation, invoice_id, request_payload, result, created_by)
  VALUES (p_request_id, 'payment', p_invoice_id, v_payload, v_result, auth.uid())
  ON CONFLICT (request_id) DO NOTHING;
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.register_invoice_payment(p_invoice_id bigint, p_amount_brl numeric, p_payment_method text DEFAULT 'pix'::text, p_paid_at timestamp with time zone DEFAULT now(), p_notes text DEFAULT NULL::text, p_actor uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_invoice RECORD;
  v_actor UUID;
  v_total_paid NUMERIC(14,2);
  v_balance NUMERIC(14,2);
  v_remaining NUMERIC(14,2);
  v_next_status TEXT;
BEGIN
  -- O autor é quem está logado (ADR 0085, regra base 2; migration 241).
  PERFORM public._assert_actor_is_caller(p_actor);
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_financeiro_user() THEN
    RAISE EXCEPTION 'Usuário sem permissão de faturamento.' USING ERRCODE = '42501';
  END IF;

  v_actor := COALESCE(p_actor, auth.uid());

  IF COALESCE(p_amount_brl, 0) <= 0 THEN
    INSERT INTO public.audit_logs (
      entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification
    )
    VALUES (
      'system_event',
      'billing',
      'invoice_payment_invalid',
      NULL,
      CONCAT('invoice=', p_invoice_id, ' | amount=', COALESCE(p_amount_brl, 0)),
      auth.uid(),
      now(),
      'Valor de pagamento menor ou igual a zero'
    );
    RAISE EXCEPTION 'Valor de pagamento deve ser maior que zero.' USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO v_invoice
  FROM public.invoices
  WHERE id = p_invoice_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice % nao encontrada.', p_invoice_id USING ERRCODE = 'P0002';
  END IF;

  IF COALESCE(v_invoice.status, 'issued') = 'cancelled' THEN
    INSERT INTO public.audit_logs (
      entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification
    )
    VALUES (
      'system_event',
      'billing',
      'invoice_payment_invalid',
      NULL,
      CONCAT('invoice=', p_invoice_id, ' cancelada'),
      auth.uid(),
      now(),
      'Tentativa de pagamento em invoice cancelada'
    );
    RAISE EXCEPTION 'Invoice cancelada nao aceita pagamento.' USING ERRCODE = '22023';
  END IF;

  IF COALESCE(v_invoice.status, 'issued') = 'paid' THEN
    INSERT INTO public.audit_logs (
      entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification
    )
    VALUES (
      'system_event',
      'billing',
      'invoice_payment_invalid',
      NULL,
      CONCAT('invoice=', p_invoice_id, ' ja paga'),
      auth.uid(),
      now(),
      'Tentativa de pagamento em invoice ja quitada'
    );
    RAISE EXCEPTION 'Invoice ja esta paga.' USING ERRCODE = '22023';
  END IF;

  v_remaining := GREATEST(COALESCE(v_invoice.balance_brl, COALESCE(v_invoice.total_brl, 0)), 0);
  IF p_amount_brl > v_remaining THEN
    INSERT INTO public.audit_logs (
      entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification
    )
    VALUES (
      'system_event',
      'billing',
      'invoice_payment_invalid',
      NULL,
      CONCAT('invoice=', p_invoice_id, ' | amount=', p_amount_brl, ' | remaining=', v_remaining),
      auth.uid(),
      now(),
      'Tentativa de pagamento acima do saldo da invoice'
    );
    RAISE EXCEPTION 'Pagamento acima do saldo em aberto da invoice.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.payments (
    invoice_id,
    amount_brl,
    payment_method,
    paid_at,
    registered_by,
    notes
  )
  VALUES (
    p_invoice_id,
    p_amount_brl,
    COALESCE(NULLIF(TRIM(COALESCE(p_payment_method, '')), ''), 'pix'),
    COALESCE(p_paid_at, now()),
    v_actor,
    NULLIF(TRIM(COALESCE(p_notes, '')), '')
  );

  SELECT COALESCE(SUM(amount_brl), 0)
  INTO v_total_paid
  FROM public.payments
  WHERE invoice_id = p_invoice_id;

  v_balance := GREATEST(COALESCE(v_invoice.total_brl, 0) - v_total_paid, 0);

  IF v_balance = 0 THEN
    v_next_status := 'paid';
  ELSIF v_total_paid > 0 THEN
    v_next_status := 'partially_paid';
  ELSE
    v_next_status := 'issued';
  END IF;

  UPDATE public.invoices
  SET
    total_paid_brl = v_total_paid,
    balance_brl = v_balance,
    status = v_next_status
  WHERE id = p_invoice_id;

  IF v_next_status = 'paid' THEN
    UPDATE public.bls AS b
    SET financial_status = CASE
      WHEN EXISTS (
        SELECT 1
        FROM public.invoice_bls AS ib2
        JOIN public.invoices AS inv2 ON inv2.id = ib2.invoice_id
        WHERE ib2.bl_id = b.id
          AND inv2.id <> p_invoice_id
          AND COALESCE(inv2.status, 'issued') IN ('draft', 'issued', 'partially_paid', 'overdue')
      ) THEN 'invoiced'
      ELSE 'paid'
    END
    WHERE b.id IN (
      SELECT ib.bl_id
      FROM public.invoice_bls AS ib
      WHERE ib.invoice_id = p_invoice_id
    );
  ELSE
    UPDATE public.bls
    SET financial_status = 'invoiced'
    WHERE id IN (
      SELECT ib.bl_id
      FROM public.invoice_bls AS ib
      WHERE ib.invoice_id = p_invoice_id
    );
  END IF;

  INSERT INTO public.audit_logs (
    entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification
  )
  VALUES (
    'invoice',
    p_invoice_id::TEXT,
    'register_payment',
    COALESCE(v_invoice.total_paid_brl::TEXT, '0'),
    v_total_paid::TEXT,
    auth.uid(),
    now(),
    'Registro de pagamento'
  );

  RETURN jsonb_build_object(
    'invoice_id', p_invoice_id,
    'status', v_next_status,
    'total_paid_brl', v_total_paid,
    'balance_brl', v_balance
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.register_ledger_invoice_payment(p_invoice_id bigint, p_amount_brl numeric, p_method text, p_paid_at timestamp with time zone, p_pix_txid text, p_source text, p_notes text, p_actor uuid, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bl_id text;
  v_request_id uuid := COALESCE(p_request_id, gen_random_uuid());
  v_hash text := md5(jsonb_build_object('invoice_id', p_invoice_id, 'amount_brl', round(p_amount_brl::numeric, 2), 'method', p_method, 'paid_at', p_paid_at, 'pix_txid', p_pix_txid, 'source', p_source, 'notes', p_notes, 'actor', p_actor)::text);
  v_existing public.ledger_payment_requests%ROWTYPE;
  v_result jsonb;
BEGIN
  -- O autor é quem está logado (ADR 0085, regra base 2; migration 241).
  PERFORM public._assert_actor_is_caller(p_actor);
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_financeiro_user() THEN
    RAISE EXCEPTION 'Usuário sem permissão de faturamento.' USING ERRCODE = '42501';
  END IF;

  FOR v_bl_id IN
    SELECT DISTINCT links.bl_id
    FROM (
      SELECT ib.bl_id FROM public.invoice_bls ib WHERE ib.invoice_id = p_invoice_id
      UNION
      SELECT r.bl_id FROM public.invoice_receivable_links l JOIN public.bl_receivables r ON r.id = l.receivable_id WHERE l.invoice_id = p_invoice_id
    ) links ORDER BY 1
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('bl:' || v_bl_id, 0));
  END LOOP;

  INSERT INTO public.ledger_payment_requests(request_id, payload_hash, created_by)
  VALUES (v_request_id, v_hash, COALESCE(p_actor, auth.uid()))
  ON CONFLICT (request_id) DO NOTHING;
  SELECT * INTO v_existing FROM public.ledger_payment_requests WHERE request_id = v_request_id FOR UPDATE;
  IF v_existing.payload_hash IS DISTINCT FROM v_hash THEN
    RAISE EXCEPTION 'Request de pagamento % já foi usado com outro payload.', v_request_id USING ERRCODE = '22023';
  END IF;
  IF v_existing.result IS NOT NULL THEN
    -- Mesma regra da baixa verificada: a baixa cancelada não volta como sucesso.
    IF (v_existing.result->>'payment_id') IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.payments p WHERE p.id = (v_existing.result->>'payment_id')::bigint) THEN
      RAISE EXCEPTION 'Esta baixa foi cancelada. Confira o extrato e inicie uma nova operação.' USING ERRCODE = '22023';
    END IF;
    RETURN v_existing.result;
  END IF;

  PERFORM public.assert_ledger_invoice_payment_allocation(p_invoice_id, p_amount_brl);
  v_result := public.register_ledger_invoice_payment_legacy_066(
    p_invoice_id, p_amount_brl, p_method, p_paid_at, p_pix_txid, p_source, p_notes, p_actor
  );
  UPDATE public.ledger_payment_requests SET result = v_result WHERE request_id = v_request_id;
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.register_ledger_invoice_payment(p_invoice_id bigint, p_amount_brl numeric, p_method text DEFAULT 'pix'::text, p_paid_at timestamp with time zone DEFAULT now(), p_pix_txid text DEFAULT NULL::text, p_source text DEFAULT 'manual'::text, p_notes text DEFAULT NULL::text, p_actor uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_bl_id text;
BEGIN
  -- O autor é quem está logado (ADR 0085, regra base 2; migration 241).
  PERFORM public._assert_actor_is_caller(p_actor);
  -- Mesma guarda da sobrecarga de 9 argumentos, antes de travar os B/Ls.
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_financeiro_user() THEN
    RAISE EXCEPTION 'Usuário sem permissão de faturamento.' USING ERRCODE = '42501';
  END IF;
  FOR v_bl_id IN
    SELECT DISTINCT links.bl_id
    FROM (
      SELECT ib.bl_id FROM public.invoice_bls ib WHERE ib.invoice_id = p_invoice_id
      UNION
      SELECT r.bl_id FROM public.invoice_receivable_links l JOIN public.bl_receivables r ON r.id = l.receivable_id WHERE l.invoice_id = p_invoice_id
    ) links ORDER BY 1
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('bl:' || v_bl_id, 0));
  END LOOP;
  RETURN public.register_ledger_invoice_payment_legacy_070(p_invoice_id, p_amount_brl, p_method, p_paid_at, p_pix_txid, p_source, p_notes, p_actor);
END;
$function$;

CREATE OR REPLACE FUNCTION public.register_ledger_invoice_payment_legacy_052(p_invoice_id bigint, p_amount_brl numeric, p_method text DEFAULT 'pix'::text, p_paid_at timestamp with time zone DEFAULT now(), p_pix_txid text DEFAULT NULL::text, p_source text DEFAULT 'manual'::text, p_notes text DEFAULT NULL::text, p_actor uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_invoice RECORD;
  v_actor UUID;
  v_payment_amount NUMERIC(14,2);
  v_open NUMERIC(14,2);
  v_excess NUMERIC(14,2) := 0;
  v_remaining NUMERIC(14,2);
  v_remaining_open NUMERIC(14,2);
  v_allocation NUMERIC(14,2);
  v_payment_id BIGINT;
  v_total_paid NUMERIC(14,2);
  v_all_receivable_ids BIGINT[];
  v_receivable_ids BIGINT[];
  v_receivable RECORD;
  v_next_status TEXT;
  v_covered INTEGER := 0;
  v_obsoleted INTEGER := 0;
  v_receivables_settled INTEGER := 0;
  v_cross JSONB;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_financeiro_user() THEN
    RAISE EXCEPTION 'Usuário sem permissão de faturamento.' USING ERRCODE = '42501';
  END IF;

  v_actor := COALESCE(p_actor, auth.uid());

  IF COALESCE(p_source, 'manual') NOT IN ('manual', 'pix_extract') THEN
    RAISE EXCEPTION 'Origem de pagamento invalida.' USING ERRCODE = '22023';
  END IF;

  v_payment_amount := ROUND(COALESCE(p_amount_brl, 0)::NUMERIC, 2);
  IF v_payment_amount <= 0 THEN
    RAISE EXCEPTION 'Valor de pagamento deve ser maior que zero.' USING ERRCODE = '22023';
  END IF;

  IF NULLIF(TRIM(COALESCE(p_pix_txid, '')), '') IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public.ledger_settlements
       WHERE pix_txid IS NOT NULL
         AND UPPER(REGEXP_REPLACE(pix_txid, '[^A-Za-z0-9]', '', 'g'))
           = UPPER(REGEXP_REPLACE(p_pix_txid, '[^A-Za-z0-9]', '', 'g'))
     ) THEN
    RAISE EXCEPTION 'TXID % ja foi conciliado.', p_pix_txid USING ERRCODE = '23505';
  END IF;

  SELECT * INTO v_invoice
  FROM public.invoices
  WHERE id = p_invoice_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice % nao encontrada.', p_invoice_id USING ERRCODE = 'P0002';
  END IF;

  IF COALESCE(v_invoice.status, 'issued') NOT IN ('issued', 'partially_paid', 'overdue') THEN
    RAISE EXCEPTION 'Invoice % nao esta em estado pagavel (status=%).', p_invoice_id, v_invoice.status
      USING ERRCODE = '22023';
  END IF;

  SELECT ARRAY_AGG(irl.receivable_id ORDER BY irl.receivable_id)
  INTO v_all_receivable_ids
  FROM public.invoice_receivable_links irl
  WHERE irl.invoice_id = p_invoice_id;

  SELECT ARRAY_AGG(irl.receivable_id ORDER BY irl.receivable_id)
  INTO v_receivable_ids
  FROM public.invoice_receivable_links irl
  WHERE irl.invoice_id = p_invoice_id
    AND irl.status = 'active';

  IF v_receivable_ids IS NULL OR ARRAY_LENGTH(v_receivable_ids, 1) = 0 THEN
    RAISE EXCEPTION 'Invoice % sem receivables ativos vinculados no ledger.', p_invoice_id
      USING ERRCODE = '22023';
  END IF;

  PERFORM 1 FROM public.bl_receivables WHERE id = ANY(v_receivable_ids) ORDER BY id FOR UPDATE;

  SELECT COALESCE(SUM(balance_brl), 0)
  INTO v_open
  FROM public.bl_receivables
  WHERE id = ANY(v_receivable_ids)
    AND status IN ('open', 'partially_settled');

  IF COALESCE(v_open, 0) <= 0 THEN
    RAISE EXCEPTION 'Invoice % nao possui saldo em aberto no ledger.', p_invoice_id USING ERRCODE = '22023';
  END IF;

  -- Pagamentos manuais e PIX podem liquidar parcialmente.
  -- Qualquer excedente continua proibido para PIX e gera restituição somente
  -- no caminho manual.
  v_excess := ROUND(GREATEST(v_payment_amount - v_open, 0)::NUMERIC, 2);
  IF v_excess > 0 AND COALESCE(p_source, 'manual') <> 'manual' THEN
    RAISE EXCEPTION 'Valor (%) excede o saldo em aberto do documento (%).',
      v_payment_amount, v_open USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.payments (invoice_id, amount_brl, payment_method, paid_at, registered_by, notes)
  VALUES (
    p_invoice_id,
    v_payment_amount,
    COALESCE(NULLIF(TRIM(COALESCE(p_method, '')), ''), 'pix'),
    COALESCE(p_paid_at, now()),
    v_actor,
    NULLIF(TRIM(COALESCE(p_notes, '')), '')
  )
  RETURNING id INTO v_payment_id;

  -- Aloca no maximo o saldo aberto; o que passar disso e excedente (restituicao).
  v_remaining := ROUND(LEAST(v_payment_amount, v_open)::NUMERIC, 2);

  FOR v_receivable IN
    SELECT id, balance_brl
    FROM public.bl_receivables
    WHERE id = ANY(v_receivable_ids)
      AND status IN ('open', 'partially_settled')
      AND balance_brl > 0
    ORDER BY id
  LOOP
    EXIT WHEN v_remaining <= 0;

    v_allocation := ROUND(LEAST(v_receivable.balance_brl, v_remaining)::NUMERIC, 2);
    IF v_allocation <= 0 THEN
      CONTINUE;
    END IF;

    INSERT INTO public.ledger_settlements (
      payment_id, receivable_id, invoice_id, amount_brl, settled_at, method, pix_txid, source
    )
    VALUES (
      v_payment_id,
      v_receivable.id,
      p_invoice_id,
      v_allocation,
      COALESCE(p_paid_at, now()),
      COALESCE(NULLIF(TRIM(COALESCE(p_method, '')), ''), 'pix'),
      NULLIF(TRIM(COALESCE(p_pix_txid, '')), ''),
      COALESCE(p_source, 'manual')
    );

    UPDATE public.bl_receivables
    SET
      settled_amount_brl = LEAST(original_amount_brl, COALESCE(settled_amount_brl, 0) + v_allocation),
      balance_brl = GREATEST(COALESCE(balance_brl, 0) - v_allocation, 0),
      status = CASE
        WHEN GREATEST(COALESCE(balance_brl, 0) - v_allocation, 0) <= 0 THEN 'settled'
        ELSE 'partially_settled'
      END,
      updated_at = now()
    WHERE id = v_receivable.id;

    v_remaining := ROUND((v_remaining - v_allocation)::NUMERIC, 2);
  END LOOP;

  IF v_remaining > 0 THEN
    RAISE EXCEPTION 'Falha ao alocar pagamento: saldo residual %.', v_remaining USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.invoice_receivable_links irl
  SET status = 'settled_by_this_invoice'
  WHERE irl.invoice_id = p_invoice_id
    AND irl.status = 'active'
    AND EXISTS (
      SELECT 1
      FROM public.bl_receivables br
      WHERE br.id = irl.receivable_id
        AND br.balance_brl <= 0
    );

  SELECT COALESCE(SUM(balance_brl), 0)
  INTO v_remaining_open
  FROM public.bl_receivables
  WHERE id = ANY(v_receivable_ids)
    AND status IN ('open', 'partially_settled');

  SELECT COALESCE(SUM(amount_brl), 0)
  INTO v_total_paid
  FROM public.payments
  WHERE invoice_id = p_invoice_id;

  v_next_status := CASE WHEN v_remaining_open <= 0 THEN 'paid' ELSE 'partially_paid' END;

  UPDATE public.invoices
  SET
    total_paid_brl = v_total_paid,
    balance_brl = GREATEST(v_remaining_open, 0),
    status = v_next_status
  WHERE id = p_invoice_id;

  -- Excedente da baixa manual: registra restituicao pendente ao cliente.
  IF v_excess > 0 THEN
    INSERT INTO public.invoice_refunds (invoice_id, payment_id, amount_brl, status, registered_by, notes)
    VALUES (p_invoice_id, v_payment_id, v_excess, 'pending', v_actor, NULLIF(TRIM(COALESCE(p_notes, '')), ''));
  END IF;

  UPDATE public.bls b
  SET financial_status = 'paid'
  WHERE b.id IN (
    SELECT br.bl_id
    FROM public.bl_receivables br
    WHERE br.id = ANY(v_receivable_ids)
      AND br.balance_brl <= 0
  );

  SELECT COUNT(*)
  INTO v_receivables_settled
  FROM public.bl_receivables
  WHERE id = ANY(v_all_receivable_ids)
    AND balance_brl <= 0;

  -- ADR 0093, decisões 6 a 8 (migration 356): toda fatura aberta ligada aos
  -- recebíveis desta baixa é reprojetada, parcial ou não.
  v_cross := public._reproject_invoices_for_receivables(p_invoice_id, v_receivable_ids, v_actor);
  v_covered := (v_cross->>'covered')::integer;
  v_obsoleted := (v_cross->>'obsoleted')::integer;

  INSERT INTO public.invoice_lifecycle_events (invoice_id, event_type, receivable_id, actor, payload)
  VALUES (
    p_invoice_id,
    CASE
      WHEN COALESCE(p_source, 'manual') = 'pix_extract' THEN 'reconciled_by_txid'
      WHEN v_next_status = 'paid' THEN 'paid'
      ELSE 'partially_paid'
    END,
    NULL,
    v_actor,
    jsonb_build_object(
      'amount_brl', v_payment_amount,
      'source', COALESCE(p_source, 'manual'),
      'pix_txid', NULLIF(TRIM(COALESCE(p_pix_txid, '')), ''),
      'status', v_next_status,
      'refund_due_brl', v_excess
    )
  );

  INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification)
  VALUES (
    'invoice', p_invoice_id::TEXT, 'ledger_payment',
    COALESCE(v_invoice.balance_brl::TEXT, '0'), v_remaining_open::TEXT, auth.uid(), now(),
    'Baixa via ledger (' || COALESCE(p_source, 'manual') || ')'
  );

  RETURN jsonb_build_object(
    'invoice_id', p_invoice_id,
    'payment_id', v_payment_id,
    'status', v_next_status,
    'amount_brl', v_payment_amount,
    'balance_brl', GREATEST(v_remaining_open, 0),
    'refund_due_brl', v_excess,
    'receivables_settled', v_receivables_settled,
    'individuals_covered', v_covered,
    'consolidated_obsoleted', v_obsoleted
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.register_ledger_invoice_payment_legacy_066(p_invoice_id bigint, p_amount_brl numeric, p_method text DEFAULT 'pix'::text, p_paid_at timestamp with time zone DEFAULT now(), p_pix_txid text DEFAULT NULL::text, p_source text DEFAULT 'manual'::text, p_notes text DEFAULT NULL::text, p_actor uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_financeiro_user() THEN
    RAISE EXCEPTION 'Usuário sem permissão de faturamento.'
      USING ERRCODE = '42501';
  END IF;

  PERFORM public.assert_ledger_invoice_payment_allocation(p_invoice_id, p_amount_brl);

  RETURN public.register_ledger_invoice_payment_legacy_052(
    p_invoice_id, p_amount_brl, p_method, p_paid_at, p_pix_txid,
    p_source, p_notes, p_actor
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.remove_bl_ce_mercante(p_bl_id text, p_reason text, p_expected_ce text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_invoices text;
  v_result text;
  v_old text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuário sem permissão ativa.' USING ERRCODE = '42501';
  END IF;
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'Informe o motivo da remocao do CE Mercante.' USING ERRCODE = '22023';
  END IF;
  SELECT ce_mercante INTO v_old FROM public.bls WHERE id = p_bl_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L % nao encontrado.', p_bl_id USING ERRCODE = 'P0002';
  END IF;
  IF p_expected_ce IS NOT NULL
     AND public.ce_mercante_key(v_old) IS DISTINCT FROM public.ce_mercante_key(p_expected_ce) THEN
    RAISE EXCEPTION 'O CE Mercante do B/L % mudou depois que a ficha foi aberta (agora: %). Recarregue a ficha e confira antes de remover.',
      p_bl_id, COALESCE(NULLIF(btrim(COALESCE(v_old, '')), ''), 'sem CE')
      USING ERRCODE = '22023';
  END IF;
  v_invoices := NULLIF(array_to_string(public._bl_live_invoice_numbers(p_bl_id), ', '), '');
  IF v_invoices IS NOT NULL THEN
    RAISE EXCEPTION 'O CE Mercante do B/L % não pode ser removido: há fatura emitida (%). O Administrativo precisa cancelar a fatura antes.', p_bl_id, v_invoices
      USING ERRCODE = 'P0011';
  END IF;
  v_result := public._set_bl_ce_mercante(p_bl_id, NULL, auth.uid(), 'Remocao do CE Mercante pela ficha: ' || v_reason, 'ce_mercante_ficha');
  RETURN jsonb_build_object('status', v_result, 'bl_id', p_bl_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.reopen_agency_departure_report(p_voyage_id bigint, p_port text, p_justification text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_report_id UUID;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501';
  END IF;
  IF btrim(COALESCE(p_justification, '')) = '' THEN
    RAISE EXCEPTION 'Reabertura exige justificativa.' USING ERRCODE = '22023';
  END IF;
  SELECT id INTO v_report_id
  FROM public.agency_departure_reports
  WHERE voyage_id = p_voyage_id
    AND port = upper(btrim(p_port))
    AND status = 'closed'
    AND terminal_id IS NULL
  FOR UPDATE;
  IF v_report_id IS NULL THEN
    RAISE EXCEPTION 'ADR nao esta fechado.' USING ERRCODE = 'P0002';
  END IF;
  UPDATE public.agency_departure_reports
  SET status = 'open', closed_at = NULL, closed_by = NULL, closed_snapshot = NULL
  WHERE id = v_report_id;
  INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  VALUES ('agency_departure_report', p_voyage_id || '::' || upper(btrim(p_port)),
          'status', 'closed', 'open', auth.uid(), btrim(p_justification));
  RETURN jsonb_build_object('report_id', v_report_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.reopen_agency_departure_report_by_report_id(p_report_id uuid, p_voyage_id bigint, p_port text, p_justification text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_report RECORD;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501'; END IF;
  IF btrim(COALESCE(p_justification, '')) = '' THEN RAISE EXCEPTION 'Reabertura exige justificativa.' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_report FROM public.agency_departure_reports WHERE id = p_report_id FOR UPDATE;
  IF NOT FOUND OR v_report.voyage_id <> p_voyage_id OR upper(btrim(v_report.port)) <> upper(btrim(p_port))
     OR v_report.terminal_id IS NULL THEN RAISE EXCEPTION 'report_id nao pertence a ADR terminalizado da escala %::%.', p_voyage_id, upper(btrim(p_port)) USING ERRCODE = '23514'; END IF;
  IF v_report.status <> 'closed' THEN RAISE EXCEPTION 'ADR nao esta fechado.' USING ERRCODE = 'P0002'; END IF;
  UPDATE public.agency_departure_reports SET status = 'open', closed_at = NULL, closed_by = NULL, closed_snapshot = NULL WHERE id = p_report_id;
  -- Reabrir destrava a edição sem apagar decisões, assinaturas ou histórico.
  INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  VALUES ('agency_departure_report', p_report_id::TEXT, 'status', 'closed', 'open', auth.uid(), btrim(p_justification));
  RETURN jsonb_build_object('report_id', p_report_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.reopen_demurrage_invoice(p_request_id uuid, p_invoice_id bigint, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_payload jsonb := jsonb_build_object('invoice_id', p_invoice_id, 'reason', NULLIF(btrim(p_reason), ''));
  v_previous jsonb;
  v_invoice public.demurrage_invoices%ROWTYPE;
  v_result jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND (auth.uid() IS NULL OR NOT public.is_admin()) THEN
    RAISE EXCEPTION 'Usuário sem permissão para reabrir Demurrage.' USING ERRCODE = '42501';
  END IF;
  IF NULLIF(btrim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'Justificativa obrigatoria para reabrir a fatura.' USING ERRCODE = '22023';
  END IF;
  v_previous := public._demurrage_mutation_request(p_request_id, 'reopen', p_invoice_id, v_payload);
  IF v_previous IS NOT NULL THEN RETURN v_previous; END IF;
  SELECT * INTO v_invoice FROM public.demurrage_invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Demurrage invoice % nao encontrada.', p_invoice_id USING ERRCODE = 'P0002'; END IF;
  IF v_invoice.status <> 'paid' THEN RAISE EXCEPTION 'Apenas uma fatura paga pode ser reaberta.' USING ERRCODE = '22023'; END IF;

  UPDATE public.demurrage_invoices
  SET status = 'issued', paid_at = NULL, pix_txid = NULL, conciliated_by_extract = false, updated_at = now()
  WHERE id = p_invoice_id;
  INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification)
  VALUES ('demurrage_invoice', p_invoice_id::text, 'status', 'paid', 'issued', auth.uid(), now(), btrim(p_reason));
  v_result := jsonb_build_object('invoice_id', p_invoice_id, 'status', 'issued', 'idempotent', false);
  INSERT INTO public.demurrage_mutation_requests(request_id, operation, invoice_id, request_payload, result, created_by)
  VALUES (p_request_id, 'reopen', p_invoice_id, v_payload, v_result, auth.uid()) ON CONFLICT (request_id) DO NOTHING;
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.reorder_vessel_schedules(p_order jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_requested_count INTEGER;
  v_locked_count INTEGER;
  v_updated_count INTEGER;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuário sem permissão para reordenar navios.'
      USING ERRCODE = '42501';
  END IF;

  IF jsonb_typeof(p_order) <> 'array' OR jsonb_array_length(p_order) = 0 THEN
    RAISE EXCEPTION 'Ordem de navios invalida.' USING ERRCODE = '22023';
  END IF;

  SELECT COUNT(*), COUNT(DISTINCT item.id), COUNT(DISTINCT item.display_order)
  INTO v_requested_count, v_locked_count, v_updated_count
  FROM jsonb_to_recordset(p_order) AS item(id UUID, display_order INTEGER);

  IF v_requested_count <> v_locked_count
     OR v_requested_count <> v_updated_count THEN
    RAISE EXCEPTION 'A ordem contem navios ou posicoes duplicadas.'
      USING ERRCODE = '22023';
  END IF;

  PERFORM vessel.id
  FROM public.vessel_schedules AS vessel
  JOIN jsonb_to_recordset(p_order) AS item(id UUID, display_order INTEGER)
    ON item.id = vessel.id
  FOR UPDATE OF vessel;

  GET DIAGNOSTICS v_locked_count = ROW_COUNT;
  IF v_locked_count <> v_requested_count THEN
    RAISE EXCEPTION 'A lista de navios mudou; recarregue antes de reordenar.'
      USING ERRCODE = '40001';
  END IF;

  UPDATE public.vessel_schedules AS vessel
  SET display_order = item.display_order
  FROM jsonb_to_recordset(p_order) AS item(id UUID, display_order INTEGER)
  WHERE vessel.id = item.id;

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  IF v_updated_count <> v_requested_count THEN
    RAISE EXCEPTION 'Nem todos os navios foram reordenados.'
      USING ERRCODE = '40001';
  END IF;

  RETURN v_updated_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.replace_vazios_from_baplie_transactional(p_voyage_id bigint, p_description text, p_uploaded_by uuid, p_replace_existing boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_manifest_id uuid;
  v_empty integer;
  v_total integer;
  v_planilha integer;
  v_pruned integer;
  v_removed integer;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR p_uploaded_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Usuário sem permissão ativa para importar vazios Baplie.' USING ERRCODE = '42501';
  END IF;
  PERFORM public._lock_import_voyages(ARRAY[p_voyage_id]);
  PERFORM public._set_import_context('Vazios pelo Baplie', p_voyage_id, NULL);
  PERFORM pg_advisory_xact_lock(hashtextextended('vazios_importacao:' || p_voyage_id::text, 0));

  SELECT count(*)::integer INTO v_empty
  FROM public.baplie_containers
  WHERE voyage_id = p_voyage_id AND status = 'empty' AND NOT is_transshipment;

  IF v_empty = 0 THEN
    IF NOT p_replace_existing THEN
      RAISE EXCEPTION 'Nenhum container vazio encontrado no Baplie desta viagem.'
        USING ERRCODE = 'P0002';
    END IF;
    DELETE FROM public.vazios_importacao_manifests
    WHERE voyage_id = p_voyage_id AND source = 'baplie';
    GET DIAGNOSTICS v_removed = ROW_COUNT;
    v_pruned := public._vazios_importacao_prune(p_voyage_id);
    RETURN jsonb_build_object('manifest_id', NULL, 'total', 0, 'planilha', 0, 'pruned', v_pruned, 'removed', v_removed > 0);
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS pg_temp.vazios_natureza (container_number text, natureza text) ON COMMIT DROP;
  TRUNCATE pg_temp.vazios_natureza;
  INSERT INTO pg_temp.vazios_natureza SELECT * FROM public._vazios_importacao_natureza_map(p_voyage_id);

  IF p_replace_existing THEN
    DELETE FROM public.vazios_importacao_manifests
    WHERE voyage_id = p_voyage_id AND source = 'baplie';
  ELSIF EXISTS (
    SELECT 1 FROM public.vazios_importacao_manifests
    WHERE voyage_id = p_voyage_id AND source = 'baplie'
  ) THEN
    RAISE EXCEPTION 'Ja existe manifesto Baplie para esta viagem.'
      USING ERRCODE = '23505';
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS pg_temp.vazios_398_baplie (container_number text, size_type text, weight_kg numeric, pol text, pod text) ON COMMIT DROP;
  TRUNCATE pg_temp.vazios_398_baplie;
  INSERT INTO pg_temp.vazios_398_baplie
  SELECT DISTINCT ON (upper(regexp_replace(b.container_number, '[^A-Za-z0-9]', '', 'g')))
         b.container_number, b.size_type, b.weight_kg, b.pol, b.pod
  FROM public.baplie_containers AS b
  WHERE b.voyage_id = p_voyage_id AND b.status = 'empty' AND NOT b.is_transshipment
    AND NOT EXISTS (
      SELECT 1 FROM public.vazios_importacao_containers AS c
      WHERE c.voyage_id = p_voyage_id
        AND c.container_key = upper(regexp_replace(b.container_number, '[^A-Za-z0-9]', '', 'g'))
    )
  ORDER BY upper(regexp_replace(b.container_number, '[^A-Za-z0-9]', '', 'g')), b.id;
  SELECT count(*)::integer INTO v_total FROM pg_temp.vazios_398_baplie;
  v_planilha := v_empty - v_total;

  IF v_total > 0 THEN
    INSERT INTO public.vazios_importacao_manifests (
      voyage_id, description, total_containers, imported_by, source
    )
    VALUES (
      p_voyage_id, COALESCE(p_description, 'Importado via Baplie EDI'),
      v_total, p_uploaded_by, 'baplie'
    )
    RETURNING id INTO v_manifest_id;

    INSERT INTO public.vazios_importacao_containers (
      manifest_id, container_number, container_type, tare_kg, pol, pod, natureza
    )
    SELECT v_manifest_id, b.container_number, b.size_type, b.weight_kg, b.pol, b.pod, n.natureza
    FROM pg_temp.vazios_398_baplie AS b
    LEFT JOIN pg_temp.vazios_natureza n ON n.container_number = upper(btrim(b.container_number));
  END IF;

  v_pruned := public._vazios_importacao_prune(p_voyage_id);

  RETURN jsonb_build_object('manifest_id', v_manifest_id, 'total', v_total, 'planilha', v_planilha,
    'pruned', v_pruned, 'removed', false);
END $function$;

CREATE OR REPLACE FUNCTION public.resolve_baplie_divergence(p_bl_container_id bigint, p_field text, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_container public.bl_containers%ROWTYPE;
  v_voyage bigint;
  v_cancelled_at timestamptz;
  v_number text;
  v_baplie text;
  v_bl_value text;
  v_target record;
  v_resolved jsonb := '[]'::jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuário sem permissão ativa.' USING ERRCODE = '42501';
  END IF;
  IF p_field IS NULL OR p_field NOT IN ('ownership', 'profile') THEN
    RAISE EXCEPTION 'Divergência inválida: %.', p_field USING ERRCODE = '22023';
  END IF;
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'Informe o motivo de valer o B/L.' USING ERRCODE = '22023';
  END IF;

  SELECT b.voyage_id, b.cancelled_at, upper(btrim(c.container_number))
    INTO v_voyage, v_cancelled_at, v_number
  FROM public.bl_containers AS c
  JOIN public.bls AS b ON b.id = c.bl_id
  WHERE c.id = p_bl_container_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Container % não encontrado.', p_bl_container_id USING ERRCODE = 'P0002';
  END IF;
  IF v_cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION 'O B/L do container % está cancelado: não há divergência a resolver.', v_number USING ERRCODE = '22023';
  END IF;

  -- Trava o container em todos os B/Ls ativos da Viagem, na ordem do id (a
  -- mesma da aplicação do Baplie).
  PERFORM 1
  FROM public.bl_containers AS c
  JOIN public.bls AS b ON b.id = c.bl_id
  WHERE b.voyage_id = v_voyage AND b.cancelled_at IS NULL AND upper(btrim(c.container_number)) = v_number
  ORDER BY c.id
  FOR UPDATE OF c;
  SELECT * INTO v_container FROM public.bl_containers WHERE id = p_bl_container_id;

  IF p_field = 'ownership' THEN
    SELECT max(s.ownership) INTO v_baplie
    FROM public.baplie_containers AS s
    WHERE s.voyage_id = v_voyage AND s.status = 'full' AND upper(btrim(s.container_number)) = v_number;
    v_bl_value := v_container.ownership;
  ELSE
    SELECT public._baplie_flags_label(bool_or(COALESCE(s.is_imo, false)), bool_or(COALESCE(s.is_oog, false)), NULL)
      INTO v_baplie
    FROM public.baplie_containers AS s
    WHERE s.voyage_id = v_voyage AND s.status = 'full' AND upper(btrim(s.container_number)) = v_number
    HAVING count(*) > 0;
    v_bl_value := public._baplie_flags_label(COALESCE(v_container.is_imo, false), COALESCE(v_container.is_oog, false), NULL);
  END IF;

  IF v_baplie IS NULL OR v_bl_value IS NULL OR v_baplie = v_bl_value THEN
    RAISE EXCEPTION 'Não há divergência de % entre o B/L e o Baplie no container %.',
      CASE WHEN p_field = 'ownership' THEN 'SOC/COC' ELSE 'perfil IMO/OOG' END, v_number
      USING ERRCODE = '22023';
  END IF;

  FOR v_target IN
    SELECT c.id, c.bl_id, c.container_number
    FROM public.bl_containers AS c
    JOIN public.bls AS b ON b.id = c.bl_id
    WHERE b.voyage_id = v_voyage AND b.cancelled_at IS NULL AND upper(btrim(c.container_number)) = v_number
      AND (
        c.id = v_container.id
        OR CASE WHEN p_field = 'ownership' THEN c.ownership IS NOT DISTINCT FROM v_bl_value
                ELSE public._baplie_flags_label(COALESCE(c.is_imo, false), COALESCE(c.is_oog, false), NULL) = v_bl_value END
      )
    ORDER BY c.id
  LOOP
    -- O perfil que vale o B/L passa a correção manual (o Baplie não o troca);
    -- SOC/COC não muda de origem.
    IF p_field = 'profile' THEN
      UPDATE public.bl_containers SET profile_source = 'manual'
      WHERE id = v_target.id AND profile_source IS DISTINCT FROM 'manual';
    END IF;

    INSERT INTO public.baplie_reconciliation_resolutions
      (voyage_id, bl_container_id, field_name, baplie_value, manifest_value, resolution, resolved_by, justification)
    VALUES (v_voyage, v_target.id, p_field, v_baplie, v_bl_value, 'vale_o_bl', auth.uid(), v_reason)
    ON CONFLICT (voyage_id, bl_container_id, field_name, baplie_value, manifest_value, resolution)
    DO UPDATE SET resolved_by = EXCLUDED.resolved_by, resolved_at = now(), justification = EXCLUDED.justification;

    INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
    VALUES ('bl', v_target.bl_id, 'baplie_divergence_' || p_field,
      jsonb_build_object('container', v_target.container_number, 'baplie', v_baplie)::text,
      jsonb_build_object('container', v_target.container_number, 'vale', v_bl_value)::text,
      auth.uid(), 'Vale o B/L: ' || v_reason);

    v_resolved := v_resolved || jsonb_build_array(jsonb_build_object('bl_container_id', v_target.id, 'bl_id', v_target.bl_id));
  END LOOP;

  RETURN jsonb_build_object('bl_container_id', v_container.id, 'field', p_field, 'baplie_value', v_baplie,
    'bl_value', v_bl_value, 'resolved', v_resolved);
END;
$function$;

CREATE OR REPLACE FUNCTION public.resolve_pix_reconciliation_exception(p_exception_id bigint, p_resolution_source text, p_invoice_id bigint DEFAULT NULL::bigint, p_demurrage_invoice_id bigint DEFAULT NULL::bigint, p_txid text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_exception public.pix_reconciliation_exceptions%ROWTYPE;
  v_normalized_txid TEXT := public.normalize_pix_txid(p_txid);
  v_authoritative BOOLEAN := false;
  v_paid_date DATE;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_financeiro_user() THEN
    RAISE EXCEPTION 'Usuário sem permissão para a conciliação de Pix.' USING ERRCODE = '42501';
  END IF;
  IF p_resolution_source NOT IN ('local', 'demurrage') THEN
    RAISE EXCEPTION 'Origem de resolucao PIX invalida.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_exception
  FROM public.pix_reconciliation_exceptions
  WHERE id = p_exception_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Excecao PIX % nao encontrada.', p_exception_id USING ERRCODE = 'P0002';
  END IF;
  IF v_exception.status = 'resolved' THEN
    RETURN jsonb_build_object('id', v_exception.id, 'status', 'resolved');
  END IF;
  IF v_normalized_txid IS DISTINCT FROM v_exception.normalized_txid THEN
    RAISE EXCEPTION 'TXID informado nao corresponde exatamente ao TXID persistido na excecao.' USING ERRCODE = '22023';
  END IF;

  IF p_resolution_source = 'local' THEN
    IF p_invoice_id IS NULL OR p_demurrage_invoice_id IS NOT NULL OR v_normalized_txid = '' THEN
      RAISE EXCEPTION 'Resolucao local exige invoice local e TXID persistido.' USING ERRCODE = '22023';
    END IF;
    SELECT EXISTS (
      SELECT 1
      FROM public.invoices i
      JOIN public.ledger_settlements first_settlement
        ON first_settlement.invoice_id = i.id
       AND first_settlement.source = 'pix_extract'
       AND public.normalize_pix_txid(first_settlement.pix_txid) = v_exception.normalized_txid
      WHERE i.id = p_invoice_id
        AND i.invoice_type IN ('individual', 'consolidated')
        AND ABS((
          SELECT COALESCE(SUM(all_settlements.amount_brl), 0)
          FROM public.ledger_settlements all_settlements
          WHERE all_settlements.payment_id = first_settlement.payment_id
        ) - v_exception.amount_brl) <= 0.01
        AND (
          public.normalize_pix_txid(i.pix_txid) = v_exception.normalized_txid
          OR v_exception.normalized_txid <> ''
        )
    ) OR EXISTS (
      -- Avulsa (migration 242): a baixa por TXID vai por `payments`, nunca por
      -- `ledger_settlements`; a prova é o TXID gravado na fatura e o evento
      -- `reconciled_by_txid` com o mesmo valor da exceção.
      SELECT 1
      FROM public.invoices i
      JOIN public.invoice_lifecycle_events e
        ON e.invoice_id = i.id
       AND e.event_type = 'reconciled_by_txid'
       AND public.normalize_pix_txid(e.payload->>'txid') = v_exception.normalized_txid
      WHERE i.id = p_invoice_id
        AND i.invoice_type = 'manual'
        AND i.conciliated_by_extract = true
        AND public.normalize_pix_txid(i.pix_txid) = v_exception.normalized_txid
        AND ABS(COALESCE((e.payload->>'amount_brl')::numeric, 0) - v_exception.amount_brl) <= 0.01
    ) INTO v_authoritative;
  ELSE
    IF p_demurrage_invoice_id IS NULL OR p_invoice_id IS NOT NULL OR v_exception.paid_at IS NULL THEN
      RAISE EXCEPTION 'Resolucao Demurrage exige invoice e data paga persistida.' USING ERRCODE = '22023';
    END IF;
    v_paid_date := (v_exception.paid_at AT TIME ZONE 'UTC')::DATE;
    SELECT EXISTS (
      SELECT 1
      FROM public.demurrage_invoices d
      WHERE d.id = p_demurrage_invoice_id
        AND d.status = 'paid'
        AND d.conciliated_by_extract = true
        AND d.paid_at = v_paid_date
        AND public.normalize_pix_txid(d.pix_txid) = v_exception.normalized_txid
        AND EXISTS (
          SELECT 1
          FROM public.get_demurrage_recent_values(d.id, v_paid_date) w
          WHERE ABS(w.total_brl - v_exception.amount_brl) <= 0.01
        )
    ) INTO v_authoritative;
  END IF;

  IF NOT v_authoritative THEN
    RAISE EXCEPTION 'Nenhuma baixa/settlement autoritativa corresponde a excecao PIX %.', p_exception_id USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.pix_reconciliation_exceptions
  SET status = 'resolved', resolved_at = now(), resolved_by = auth.uid(),
      resolution_source = p_resolution_source,
      resolved_invoice_id = p_invoice_id,
      resolved_demurrage_invoice_id = p_demurrage_invoice_id,
      updated_at = now()
  WHERE id = v_exception.id;

  PERFORM set_config('alerts.foundation_trigger', 'on', true);
  PERFORM public.resolve_alert_item(
    'pix_unreconciled', 'pix_transaction', v_exception.id::TEXT,
    'pix_reconciliation_authoritative', jsonb_build_object(
      'exception_id', v_exception.id,
      'resolution_source', p_resolution_source,
      'invoice_id', COALESCE(p_invoice_id, p_demurrage_invoice_id),
      'txid', NULLIF(p_txid, '')
    )
  );
  PERFORM set_config('alerts.foundation_trigger', 'off', true);

  RETURN jsonb_build_object('id', v_exception.id, 'status', 'resolved');
END;
$function$;

CREATE OR REPLACE FUNCTION public.resolve_stale_invoice(p_invoice_id bigint, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_customer bigint;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Sem permissao para resolver alerta.' USING ERRCODE = '42501';
  END IF;
  IF length(btrim(coalesce(p_reason, ''))) < 15 THEN
    RAISE EXCEPTION 'Informe a justificativa da resolução (mínimo de 15 caracteres): qual avulsa foi emitida ou por que a diferença não é cobrada.' USING ERRCODE = '22023';
  END IF;
  SELECT customer_id INTO v_customer FROM public.invoices WHERE id = p_invoice_id;
  IF v_customer IS NULL THEN RAISE EXCEPTION 'Fatura não encontrada.' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.resolve_alert_item('fatura_desatualizada', 'invoice', p_invoice_id::text, 'manual_correction_resolution',
    jsonb_build_object('reason', btrim(p_reason), 'actor', auth.uid()));
  INSERT INTO public.audit_logs(entity_type, entity_id, field_name, new_value, changed_by, justification)
    VALUES ('invoice', p_invoice_id::text, 'stale_invoice_resolved', 'resolved', auth.uid(), btrim(p_reason));
END;
$function$;

CREATE OR REPLACE FUNCTION public.retry_import_effect(p_effect_id bigint, p_justification text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_row public.import_pending_effects%ROWTYPE;
  v_actor uuid := auth.uid();
  v_role text := public.current_actor_role();
  v_justification text := NULLIF(btrim(COALESCE(p_justification, '')), '');
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND (v_actor IS NULL OR NOT public.is_active_user()
          OR v_role NOT IN ('administrativo', 'financeiro', 'operacoes', 'documentacao', 'equipamentos')) THEN
    RAISE EXCEPTION 'Usuário sem permissão para reabrir efeito.' USING ERRCODE = '42501';
  END IF;
  IF v_justification IS NULL OR char_length(v_justification) > 500 THEN
    RAISE EXCEPTION 'Justificativa obrigatoria para retry.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_row
  FROM public.import_pending_effects
  WHERE id = p_effect_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Efeito % nao encontrado.', p_effect_id USING ERRCODE = 'P0002';
  END IF;
  IF v_row.status IS DISTINCT FROM 'blocked' THEN
    RAISE EXCEPTION 'Somente efeitos bloqueados podem ser reabertos.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.import_pending_effects
     SET status = 'retry_wait',
         attempts = 0,
         next_attempt_at = now(),
         lease_until = NULL,
         leased_by = NULL,
         last_error_code = NULL,
         last_error_message = NULL,
         result = COALESCE(result, '{}'::jsonb)
           || jsonb_build_object('manual_retry_justification', v_justification),
         updated_at = now()
   WHERE id = v_row.id;

  INSERT INTO public.audit_logs(
    entity_type, entity_id, field_name, old_value, new_value,
    changed_by, justification, actor_role, actor_department
  ) VALUES (
    'import_effect', v_row.id::text, 'retry',
    jsonb_build_object('status', 'blocked', 'attempts', v_row.attempts)::text,
    jsonb_build_object('status', 'retry_wait', 'attempts', 0)::text,
    v_actor, v_justification, COALESCE(v_role, 'sistema'), COALESCE(v_role, 'sistema')
  );

  SELECT * INTO v_row FROM public.import_pending_effects WHERE id = p_effect_id;
  RETURN jsonb_build_object('effect', to_jsonb(v_row), 'idempotent', false);
END;
$function$;

CREATE OR REPLACE FUNCTION public.retry_invoice_basis_changes_legacy_134(p_bl_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_result jsonb; v_cod_id bigint; v_cod_map jsonb; v_blocked jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Sem permissão de faturamento.' USING ERRCODE = '42501';
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

CREATE OR REPLACE FUNCTION public.retry_pending_consolidated_reissue(p_invoice_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_status text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuário sem permissão de faturamento.' USING ERRCODE = '42501';
  END IF;
  v_status := public._try_recreate_consolidated(p_invoice_id, auth.uid());
  RETURN jsonb_build_object('invoice_id', p_invoice_id, 'status', v_status,
    'replaced_by', (SELECT id FROM public.invoices WHERE replaces_invoice_id = p_invoice_id));
END;
$function$;

CREATE OR REPLACE FUNCTION public.reverse_demurrage_payment(p_invoice_id bigint, p_reason text DEFAULT NULL::text, p_actor uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor UUID;
  v_old_status TEXT;
  v_pix_txid TEXT;
  v_e2e TEXT;
BEGIN
  -- O autor é quem está logado (ADR 0085, regra base 2; migration 241).
  PERFORM public._assert_actor_is_caller(p_actor);
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Usuário sem permissão.' USING ERRCODE = '42501';
  END IF;

  IF NULLIF(TRIM(COALESCE(p_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Informe a justificativa para cancelar a baixa.' USING ERRCODE = '22023';
  END IF;

  v_actor := COALESCE(p_actor, auth.uid());

  SELECT status, NULLIF(btrim(pix_txid), '') INTO v_old_status, v_pix_txid
  FROM public.demurrage_invoices
  WHERE id = p_invoice_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Demurrage invoice % nao encontrada.', p_invoice_id USING ERRCODE = 'P0002';
  END IF;

  IF COALESCE(v_old_status, '') <> 'paid' THEN
    RAISE EXCEPTION 'Demurrage invoice % nao esta paga (status=%).', p_invoice_id, COALESCE(v_old_status, '?')
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.demurrage_invoices
  SET
    status = 'issued',
    paid_at = NULL,
    pix_txid = NULL,
    conciliated_by_extract = false
  WHERE id = p_invoice_id;

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
    'demurrage_invoice',
    p_invoice_id::TEXT,
    'payment_reversed',
    v_old_status,
    'issued',
    v_actor,
    now(),
    TRIM(p_reason)
  );

  -- Baixa automática Itaú cancelada: o Pix volta para análise do Financeiro.
  -- A baixa automática grava o TXID da cobrança; a manual, o identificador do Pix.
  IF v_pix_txid IS NOT NULL THEN
    SELECT r.end_to_end_id INTO v_e2e
    FROM public.itau_pix_receipts r
    WHERE (upper(r.end_to_end_id) = upper(v_pix_txid) AND r.status IN ('settled', 'handled'))
       OR (r.status = 'settled' AND public._itau_pix_origin(v_pix_txid) = 'vela'
           AND public.normalize_pix_txid(r.txid) = public.normalize_pix_txid(v_pix_txid))
    ORDER BY r.created_at DESC
    LIMIT 1;
    IF v_e2e IS NOT NULL THEN
      UPDATE public.itau_pix_receipts
      SET status = 'review', reason = 'Baixa cancelada: ' || btrim(p_reason),
          handled_at = NULL, handled_by = NULL, handled_note = NULL
      WHERE end_to_end_id = v_e2e;
      PERFORM set_config('request.jwt.claim.role', 'service_role', true);
      PERFORM public.upsert_alert_item('pix_unreconciled', 'itau_pix_receipt', v_e2e,
        'A baixa automática do Pix ' || v_e2e || ' foi cancelada (' || btrim(p_reason) || '): dê a baixa na fatura certa ou registre a devolução.',
        'itau_pix', 'administrativo', jsonb_build_object('end_to_end_id', v_e2e, 'demurrage_invoice_id', p_invoice_id), '/reconciliacao');
      PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'invoice_id', p_invoice_id,
    'new_status', 'issued'
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.reverse_invoice_payment_legacy_134(p_payment_id bigint, p_reason text DEFAULT NULL::text, p_actor uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_invoice_id bigint;
  v_bl_id text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Usuário sem permissão.' USING ERRCODE = '42501';
  END IF;
  SELECT invoice_id INTO v_invoice_id FROM public.payments WHERE id = p_payment_id;
  IF v_invoice_id IS NOT NULL THEN
    FOR v_bl_id IN
      SELECT DISTINCT links.bl_id
      FROM (
        SELECT ib.bl_id FROM public.invoice_bls ib WHERE ib.invoice_id = v_invoice_id
        UNION
        SELECT r.bl_id FROM public.invoice_receivable_links l JOIN public.bl_receivables r ON r.id = l.receivable_id WHERE l.invoice_id = v_invoice_id
      ) links ORDER BY 1
    LOOP
      PERFORM pg_advisory_xact_lock(hashtextextended('bl:' || v_bl_id, 0));
    END LOOP;
    PERFORM 1 FROM public.bl_receivables r
    WHERE r.id IN (SELECT s.receivable_id FROM public.ledger_settlements s WHERE s.payment_id = p_payment_id)
    ORDER BY r.id
    FOR UPDATE;
  END IF;
  RETURN public._reverse_invoice_payment_impl_109(p_payment_id, p_reason, p_actor);
END;
$function$;

CREATE OR REPLACE FUNCTION public.revert_voyage_omission(p_omission_id bigint, p_justification text, p_changed_by uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_omission RECORD;
  v_justification TEXT := NULLIF(btrim(COALESCE(p_justification, '')), '');
  v_cod_count INTEGER;
  v_entity_id TEXT;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR p_changed_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Somente usuário interno ativo pode reverter a omissão, em nome do próprio usuário.'
      USING ERRCODE = '42501';
  END IF;

  IF v_justification IS NULL THEN
    RAISE EXCEPTION 'Reversao de omissao exige justificativa.' USING ERRCODE = '22023';
  END IF;

  SELECT o.id, o.voyage_id, o.omitted_pod, o.discharge_pod, o.reverted_at
  INTO v_omission
  FROM public.voyage_omissions AS o
  WHERE o.id = p_omission_id
  FOR UPDATE OF o;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Omissão % não encontrada.', p_omission_id USING ERRCODE = 'P0002';
  END IF;
  IF v_omission.reverted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Omissão % já foi revertida.', p_omission_id USING ERRCODE = '22023';
  END IF;

  SELECT COUNT(*)::INTEGER
  INTO v_cod_count
  FROM public.bl_transshipments AS t
  WHERE t.omission_id = p_omission_id
    AND t.disposition = 'cod';

  IF v_cod_count > 0 THEN
    RAISE EXCEPTION 'Nao e possivel reverter a omissao: % B/L(s) afetado(s) estao em COD.', v_cod_count
      USING ERRCODE = '22023';
  END IF;

  v_entity_id := v_omission.voyage_id::TEXT || '::' || upper(btrim(v_omission.omitted_pod));

  -- Este audit row é obrigatório: voyageRouteSchedules deriva omitted dele e,
  -- desde a 306, os consumidores de estado terminalizado e de alertas de ADR
  -- contam a escala ativa pela mesma decisão mais recente.
  INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  VALUES (
    'voyage_pod_schedule',
    v_entity_id,
    'omitted',
    'true',
    'false',
    p_changed_by,
    v_justification
  );

  INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  VALUES (
    'voyage',
    v_omission.voyage_id::TEXT,
    'omissao_revertida',
    v_omission.omitted_pod,
    v_omission.discharge_pod,
    p_changed_by,
    v_justification
  );

  INSERT INTO public.portal_notifications(customer_id, bl_id, type, title, message, link)
  SELECT
    b.customer_id,
    b.id,
    'transshipment',
    'Correção de omissão de escala',
    'A omissão da escala de ' || v_omission.omitted_pod || ' foi revertida. O B/L ' || b.id ||
      ' voltou a seguir a programação original da viagem.',
    NULL
  FROM public.bl_transshipments AS t
  JOIN public.bls AS b ON b.id = t.bl_id
  WHERE t.omission_id = p_omission_id
    AND b.customer_id IS NOT NULL;

  UPDATE public.voyage_omissions
  SET reverted_at = now(),
      reverted_by = p_changed_by,
      revert_justification = v_justification
  WHERE id = p_omission_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.save_bl_demurrage_config(p_bl_id text, p_expected_updated_at timestamp with time zone, p_free_time_override integer, p_rate_p1_usd numeric, p_rate_p2_usd numeric, p_changed_by uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bl public.bls%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR p_changed_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Usuário sem permissão ativa para configurar demurrage.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_bl FROM public.bls WHERE id = p_bl_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BL % nao encontrado', p_bl_id USING ERRCODE = 'P0002';
  END IF;
  IF p_expected_updated_at IS NOT NULL AND v_bl.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'BL % foi alterado por outro usuario; recarregue antes de salvar', p_bl_id
      USING ERRCODE = 'PT409';
  END IF;

  UPDATE public.bls
  SET
    free_time_override = p_free_time_override,
    demurrage_rate_override_p1_usd = p_rate_p1_usd,
    demurrage_rate_override_p2_usd = p_rate_p2_usd
  WHERE id = p_bl_id;

  INSERT INTO public.audit_logs (
    entity_type, entity_id, field_name, old_value, new_value, changed_by, justification
  )
  SELECT 'bl', p_bl_id, change.field_name, change.old_value, change.new_value,
         p_changed_by, 'Config de demurrage (Faturamento).'
  FROM (VALUES
    ('free_time_override', v_bl.free_time_override::TEXT, p_free_time_override::TEXT),
    ('demurrage_rate_override_p1_usd', v_bl.demurrage_rate_override_p1_usd::TEXT, p_rate_p1_usd::TEXT),
    ('demurrage_rate_override_p2_usd', v_bl.demurrage_rate_override_p2_usd::TEXT, p_rate_p2_usd::TEXT)
  ) AS change(field_name, old_value, new_value)
  WHERE change.old_value IS DISTINCT FROM change.new_value;
END;
$function$;

CREATE OR REPLACE FUNCTION public.save_bl_review(p_bl_id text, p_expected_updated_at timestamp with time zone, p_update_payload jsonb, p_audit_rows jsonb, p_changed_by uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_current_updated_at timestamptz;
  v_result jsonb;
  v_reason text;
  v_previous_context text := current_setting('vela.import_context', true);
BEGIN
  IF auth.uid() IS NULL
     OR NOT public.is_active_user()
     OR p_changed_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Usuário sem permissão ativa para revisar B/L.'
      USING ERRCODE = '42501';
  END IF;

  IF p_expected_updated_at IS NULL THEN
    RAISE EXCEPTION 'updated_at obrigatorio; recarregue o B/L antes de salvar'
      USING ERRCODE = 'PT409';
  END IF;

  SELECT updated_at INTO v_current_updated_at
  FROM public.bls WHERE id = p_bl_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BL % nao encontrado', p_bl_id USING ERRCODE = 'P0002';
  END IF;
  IF v_current_updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'BL % foi alterado por outro usuario; recarregue antes de salvar', p_bl_id
      USING ERRCODE = 'PT409';
  END IF;

  -- 502: das linhas do navegador vale só a justificativa; o antes e o depois
  -- vêm dos gatilhos, que leem o motivo de `vela.import_context`.
  IF jsonb_typeof(p_audit_rows) = 'array' THEN
    SELECT NULLIF(btrim(a->>'justification'), '')
      INTO v_reason
    FROM jsonb_array_elements(p_audit_rows) AS a
    WHERE NULLIF(btrim(a->>'justification'), '') IS NOT NULL
    LIMIT 1;
  END IF;
  IF v_reason IS NOT NULL THEN
    PERFORM set_config('vela.import_context', v_reason, true);
  END IF;

  -- A cubagem breakbulk faltava na funcao legada. Persistimos primeiro sob o
  -- mesmo lock e repassamos a nova versao.
  IF p_update_payload ? 'bb_cbm' THEN
    UPDATE public.bls
    SET bb_cbm = NULLIF(p_update_payload->>'bb_cbm', '')::numeric
    WHERE id = p_bl_id
    RETURNING updated_at INTO v_current_updated_at;
  END IF;

  SELECT public.save_bl_review_legacy_070(
    p_bl_id,
    v_current_updated_at,
    -- O CE Mercante não muda pela edição da ficha: só por Corrigir/Remover
    -- CE Mercante (migration 177; ADR 0078, itens 1, 2 e 5).
    p_update_payload - 'bb_cbm' - 'ce_mercante',
    -- A legada grava as linhas recebidas, menos as de `review_status`, e usa
    -- a justificativa da primeira na linha da situação da Revisão. Uma linha
    -- de `review_status` leva o motivo sem gravar nada vindo do navegador.
    CASE WHEN v_reason IS NULL THEN '[]'::jsonb
         ELSE jsonb_build_array(jsonb_build_object('field_name', 'review_status', 'justification', v_reason))
    END,
    p_changed_by
  ) INTO v_result;

  IF v_reason IS NOT NULL THEN
    PERFORM set_config('vela.import_context', COALESCE(v_previous_context, ''), true);
  END IF;
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.save_bl_review_legacy_070(p_bl_id text, p_expected_updated_at timestamp with time zone, p_update_payload jsonb, p_audit_rows jsonb, p_changed_by uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_new_updated_at TIMESTAMPTZ;
  v_current_updated_at TIMESTAMPTZ;
  v_next_customer_id BIGINT;
  v_previous_status TEXT;
  v_input_notes TEXT;
  v_human_notes TEXT;
  v_rowcount INT;
  v_reasons TEXT[];
  v_status TEXT;
  v_notes TEXT;
  v_justification TEXT := 'Revisao manual';
  v_manifest_email TEXT;
BEGIN
  IF auth.uid() IS NULL
     OR NOT public.is_active_user()
     OR p_changed_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Usuário sem permissão ativa para revisar B/L.'
      USING ERRCODE = '42501';
  END IF;

  IF p_bl_id IS NULL OR p_bl_id = '' THEN
    RAISE EXCEPTION 'bl_id obrigatorio' USING ERRCODE = '22004';
  END IF;

  SELECT updated_at
  INTO v_current_updated_at
  FROM public.bls
  WHERE id = p_bl_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BL % nao encontrado', p_bl_id USING ERRCODE = 'P0002';
  END IF;

  IF p_expected_updated_at IS NOT NULL
     AND v_current_updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'BL % foi alterado por outro usuario; recarregue antes de salvar', p_bl_id
      USING ERRCODE = 'PT409';
  END IF;

  v_next_customer_id := CASE
    WHEN p_update_payload ? 'customer_id'
      THEN NULLIF(p_update_payload->>'customer_id', '')::BIGINT
    ELSE NULL
  END;

  UPDATE public.bls AS b
  SET
    shipper            = CASE WHEN p_update_payload ? 'shipper' THEN p_update_payload->>'shipper' ELSE b.shipper END,
    consignee          = CASE WHEN p_update_payload ? 'consignee' THEN p_update_payload->>'consignee' ELSE b.consignee END,
    notify_party       = CASE WHEN p_update_payload ? 'notify_party' THEN p_update_payload->>'notify_party' ELSE b.notify_party END,
    ce_mercante        = CASE WHEN p_update_payload ? 'ce_mercante' THEN p_update_payload->>'ce_mercante' ELSE b.ce_mercante END,
    pol                = CASE WHEN p_update_payload ? 'pol' THEN p_update_payload->>'pol' ELSE b.pol END,
    pod                = CASE WHEN p_update_payload ? 'pod' THEN p_update_payload->>'pod' ELSE b.pod END,
    place_of_delivery  = CASE WHEN p_update_payload ? 'place_of_delivery' THEN p_update_payload->>'place_of_delivery' ELSE b.place_of_delivery END,
    place_of_receipt   = CASE WHEN p_update_payload ? 'place_of_receipt' THEN p_update_payload->>'place_of_receipt' ELSE b.place_of_receipt END,
    movement_from      = CASE WHEN p_update_payload ? 'movement_from' THEN p_update_payload->>'movement_from' ELSE b.movement_from END,
    movement_to        = CASE WHEN p_update_payload ? 'movement_to' THEN p_update_payload->>'movement_to' ELSE b.movement_to END,
    issue_place        = CASE WHEN p_update_payload ? 'issue_place' THEN p_update_payload->>'issue_place' ELSE b.issue_place END,
    bl_emission_date   = CASE WHEN p_update_payload ? 'bl_emission_date' THEN NULLIF(p_update_payload->>'bl_emission_date', '')::DATE ELSE b.bl_emission_date END,
    cargo_description  = CASE WHEN p_update_payload ? 'cargo_description' THEN p_update_payload->>'cargo_description' ELSE b.cargo_description END,
    total_weight_kg    = CASE WHEN p_update_payload ? 'total_weight_kg' THEN NULLIF(p_update_payload->>'total_weight_kg', '')::NUMERIC ELSE b.total_weight_kg END,
    total_cbm          = CASE WHEN p_update_payload ? 'total_cbm' THEN NULLIF(p_update_payload->>'total_cbm', '')::NUMERIC ELSE b.total_cbm END,
    bb_machine_qty     = CASE WHEN p_update_payload ? 'bb_machine_qty' THEN NULLIF(p_update_payload->>'bb_machine_qty', '')::NUMERIC ELSE b.bb_machine_qty END,
    bb_packages_qty    = CASE WHEN p_update_payload ? 'bb_packages_qty' THEN NULLIF(p_update_payload->>'bb_packages_qty', '')::NUMERIC ELSE b.bb_packages_qty END,
    bb_packages_total  = CASE WHEN p_update_payload ? 'bb_packages_total' THEN NULLIF(p_update_payload->>'bb_packages_total', '')::NUMERIC ELSE b.bb_packages_total END,
    bb_weight_ton      = CASE WHEN p_update_payload ? 'bb_weight_ton' THEN NULLIF(p_update_payload->>'bb_weight_ton', '')::NUMERIC ELSE b.bb_weight_ton END,
    incoterm           = CASE WHEN p_update_payload ? 'incoterm' THEN p_update_payload->>'incoterm' ELSE b.incoterm END,
    payment_type       = CASE WHEN p_update_payload ? 'payment_type' THEN NULLIF(p_update_payload->>'payment_type', '') ELSE b.payment_type END,
    free_time_override = CASE WHEN p_update_payload ? 'free_time_override' THEN NULLIF(p_update_payload->>'free_time_override', '')::INT ELSE b.free_time_override END,
    notes              = CASE WHEN p_update_payload ? 'notes' THEN p_update_payload->>'notes' ELSE b.notes END,
    -- NCM cadastrado a mão na ficha (migration 358). Chega como array JSON de
    -- códigos; `[]` é uma decisão do operador de limpar, não um valor ausente.
    ncm_codes          = CASE
      WHEN p_update_payload ? 'ncm_codes'
        THEN public.normalize_ncm_codes(p_update_payload->'ncm_codes')
      ELSE b.ncm_codes
    END,
    customer_id        = CASE WHEN p_update_payload ? 'customer_id' THEN v_next_customer_id ELSE b.customer_id END,
    customer_reconciliation_status = CASE
      WHEN p_update_payload ? 'customer_reconciliation_status'
        THEN p_update_payload->>'customer_reconciliation_status'
      WHEN p_update_payload ? 'customer_id'
        THEN CASE WHEN v_next_customer_id IS NULL THEN 'missing_customer' ELSE 'reconciled' END
      ELSE b.customer_reconciliation_status
    END,
    customer_reconciliation_notes = CASE
      WHEN p_update_payload ? 'customer_reconciliation_notes'
        THEN NULLIF(p_update_payload->>'customer_reconciliation_notes', '')
      WHEN p_update_payload ? 'customer_id'
        THEN CASE
          WHEN v_next_customer_id IS NULL THEN 'Cliente removido manualmente do B/L.'
          ELSE 'Cliente reconciliado manualmente na revisao do B/L.'
        END
      ELSE b.customer_reconciliation_notes
    END,
    billing_hold_reason = CASE
      WHEN p_update_payload ? 'billing_hold_reason'
        THEN NULLIF(p_update_payload->>'billing_hold_reason', '')
      WHEN p_update_payload ? 'customer_id'
        THEN CASE
          WHEN v_next_customer_id IS NULL
            THEN COALESCE(b.billing_hold_reason, 'Cliente sem reconciliacao aprovada.')
          ELSE NULL
        END
      ELSE b.billing_hold_reason
    END
  WHERE b.id = p_bl_id
    AND (p_expected_updated_at IS NULL OR b.updated_at = p_expected_updated_at)
  RETURNING b.review_status, b.notes
  INTO v_previous_status, v_input_notes;

  GET DIAGNOSTICS v_rowcount = ROW_COUNT;
  IF v_rowcount = 0 THEN
    RAISE EXCEPTION 'BL % foi alterado por outro usuario; recarregue antes de salvar', p_bl_id
      USING ERRCODE = 'PT409';
  END IF;

  v_reasons := public.compute_bl_review_pendencies(p_bl_id);
  v_status := CASE
    WHEN COALESCE(cardinality(v_reasons), 0) = 0 THEN 'reviewed'
    ELSE 'pending_review'
  END;

  -- The machine-owned line always stays at the end. Human notes remain intact.
  v_human_notes := btrim(
    regexp_replace(
      COALESCE(v_input_notes, ''),
      E'(^|\\n)Pendencias de importacao:[^\\n]*$',
      '',
      'i'
    )
  );

  v_notes := CASE
    WHEN COALESCE(cardinality(v_reasons), 0) > 0 THEN concat_ws(
      E'\n',
      NULLIF(v_human_notes, ''),
      'Pendencias de importacao: ' || array_to_string(v_reasons, ', ')
    )
    ELSE NULLIF(v_human_notes, '')
  END;

  UPDATE public.bls AS b
  SET
    review_status = v_status,
    notes = v_notes
  WHERE b.id = p_bl_id
  RETURNING b.updated_at INTO v_new_updated_at;

  IF p_audit_rows IS NOT NULL
     AND jsonb_typeof(p_audit_rows) = 'array'
     AND jsonb_array_length(p_audit_rows) > 0 THEN
    SELECT COALESCE(NULLIF(a->>'justification', ''), v_justification)
    INTO v_justification
    FROM jsonb_array_elements(p_audit_rows) AS a
    LIMIT 1;

    INSERT INTO public.audit_logs (
      entity_type,
      entity_id,
      field_name,
      old_value,
      new_value,
      changed_by,
      justification
    )
    SELECT
      COALESCE(a->>'entity_type', 'bl'),
      COALESCE(a->>'entity_id', p_bl_id),
      a->>'field_name',
      a->>'old_value',
      a->>'new_value',
      p_changed_by,
      COALESCE(NULLIF(a->>'justification', ''), v_justification)
    FROM jsonb_array_elements(p_audit_rows) AS a
    WHERE a->>'field_name' IS DISTINCT FROM 'review_status';
  END IF;

  IF v_previous_status IS DISTINCT FROM v_status THEN
    INSERT INTO public.audit_logs (
      entity_type,
      entity_id,
      field_name,
      old_value,
      new_value,
      changed_by,
      justification
    )
    VALUES (
      'bl',
      p_bl_id,
      'review_status',
      v_previous_status,
      v_status,
      p_changed_by,
      v_justification
    );
  END IF;

  PERFORM public.sync_customer_reconciliation_queue_for_bl(p_bl_id);

  -- ADR 0061: a conciliacao de cliente tem casa unica na Revisao, e por isso a
  -- Revisao precisa produzir aqui o efeito completo que a Validacao produzia —
  -- vincular o cliente E capturar o e-mail do manifesto como contato
  -- financeiro. Sem isto, remover os botoes da Validacao seria regressao.
  --
  -- Roda depois do sync porque e ele quem fecha a fila (`status = 'approved'`)
  -- para o B/L recem-vinculado; a fila e tambem quem guarda o e-mail do
  -- manifesto que a Validacao usava. `approved_by` fica com o revisor: quem
  -- resolveu foi quem salvou a revisao, e o sync nao conhece o ator (roda
  -- tambem na importacao, sem revisor humano).
  IF p_update_payload ? 'customer_id' AND v_next_customer_id IS NOT NULL THEN
    UPDATE public.customer_reconciliation_queue AS q
    SET approved_by = COALESCE(q.approved_by, p_changed_by)
    WHERE q.bl_id = p_bl_id
      AND q.status = 'approved'
    RETURNING q.manifest_customer_email INTO v_manifest_email;

    -- M14 também na Revisão (decisão do dono de 2026-10-15, migration 271): o
    -- e-mail do manifesto só vira contato do Cliente cujo CNPJ é o do
    -- documento, como na importação (migrations 175 e 194). Com CNPJ
    -- divergente, o vínculo é feito e o contato não.
    IF EXISTS (
      SELECT 1
      FROM public.bls AS b
      JOIN public.customers AS c ON c.id = v_next_customer_id
      WHERE b.id = p_bl_id
        AND NULLIF(public.normalize_document_text(b.manifest_customer_cnpj_cpf), '') IS NOT NULL
        AND public.normalize_document_text(c.cnpj_cpf) = public.normalize_document_text(b.manifest_customer_cnpj_cpf)
    ) THEN
      PERFORM public.capture_manifest_financial_contact(v_next_customer_id, v_manifest_email);
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'updated_at', v_new_updated_at,
    'review_status', v_status,
    'pendencias', to_jsonb(v_reasons)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.save_granite_bl_review_legacy_148(p_granite_bl_id uuid, p_client_id bigint, p_changed_by uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_previous_client_id BIGINT;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR p_changed_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Usuário sem permissão ativa para revisar B/L de Granito.' USING ERRCODE = '42501';
  END IF;

  SELECT client_id
  INTO v_previous_client_id
  FROM public.granite_bls
  WHERE id = p_granite_bl_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L Granite % nao encontrado', p_granite_bl_id USING ERRCODE = 'P0002';
  END IF;

  IF v_previous_client_id IS NOT DISTINCT FROM p_client_id THEN
    RETURN;
  END IF;

  UPDATE public.granite_bls
  SET client_id = p_client_id
  WHERE id = p_granite_bl_id;

  INSERT INTO public.audit_logs (
    entity_type, entity_id, field_name, old_value, new_value, changed_by, justification
  )
  VALUES (
    'granite_bl', p_granite_bl_id::TEXT, 'client_id',
    v_previous_client_id::TEXT, p_client_id::TEXT, p_changed_by,
    'Cliente vinculado via fila de revisao'
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_agency_report_department_signoff(p_voyage_id bigint, p_port text, p_department text, p_signed boolean, p_justification text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_role TEXT;
  v_report_id UUID;
  v_currently_signed BOOLEAN;
  v_justification TEXT := NULLIF(btrim(p_justification), '');
BEGIN
  SELECT role INTO v_role FROM public.user_profiles
  WHERE id = auth.uid() AND active = TRUE;
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501';
  END IF;
  v_role := CASE v_role WHEN 'admin' THEN 'administrativo'
                        WHEN 'operator' THEN 'documentacao'
                        ELSE v_role END;

  IF p_department NOT IN ('operacoes', 'documentacao', 'equipamentos') THEN
    RAISE EXCEPTION 'Departamento invalido: %.', p_department USING ERRCODE = '22023';
  END IF;
  IF v_role NOT IN ('administrativo', p_department) THEN
    RAISE EXCEPTION 'Sign-off pertence ao departamento %.', p_department USING ERRCODE = '42501';
  END IF;

  v_report_id := public.ensure_agency_departure_report(p_voyage_id, p_port);

  IF EXISTS (
    SELECT 1 FROM public.agency_departure_reports
    WHERE id = v_report_id AND status = 'closed'
  ) THEN
    RAISE EXCEPTION 'ADR fechado: reabra antes de alterar o sign-off departamental.' USING ERRCODE = '42501';
  END IF;

  SELECT signed_at IS NOT NULL INTO v_currently_signed
  FROM public.agency_departure_report_department_signoffs
  WHERE report_id = v_report_id AND department = p_department
  FOR UPDATE;
  v_currently_signed := COALESCE(v_currently_signed, FALSE);

  -- Sem mudanca: idempotente, sem evento nem exigencia de justificativa.
  IF v_currently_signed = p_signed THEN
    RETURN jsonb_build_object('report_id', v_report_id, 'unchanged', TRUE);
  END IF;

  IF p_signed THEN
    -- Assinar exige todas as secoes do departamento resolvidas.
    IF EXISTS (
      SELECT 1 FROM (VALUES
        ('datas'), ('carga_descarregada'), ('carga_carregada'), ('veiculos'),
        ('vazios_embarcados'), ('vazios_descarregados')
      ) AS all_sections(section)
      WHERE public.agency_report_section_owner(all_sections.section) = p_department
        AND COALESCE((
          SELECT so.state FROM public.agency_departure_report_signoffs so
          WHERE so.report_id = v_report_id AND so.section = all_sections.section
        ), 'pending') = 'pending'
    ) THEN
      RAISE EXCEPTION 'Departamento % tem secoes pendentes: resolva-as antes de assinar.', p_department
        USING ERRCODE = '23514';
    END IF;
  ELSE
    -- Reabrir um sign-off ja dado exige justificativa.
    IF v_justification IS NULL THEN
      RAISE EXCEPTION 'Reabrir o sign-off departamental exige justificativa.' USING ERRCODE = '22023';
    END IF;
  END IF;

  INSERT INTO public.agency_departure_report_department_signoffs
    (report_id, department, signed_by, signed_at)
  VALUES (v_report_id, p_department, auth.uid(), CASE WHEN p_signed THEN now() ELSE NULL END)
  ON CONFLICT (report_id, department) DO UPDATE SET
    signed_by = EXCLUDED.signed_by,
    signed_at = EXCLUDED.signed_at;

  INSERT INTO public.audit_logs
    (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  VALUES ('agency_departure_report_department_signoff',
          p_voyage_id || '::' || upper(btrim(p_port)) || '::' || p_department,
          'signed', v_currently_signed::TEXT, p_signed::TEXT, auth.uid(), v_justification);

  IF p_signed THEN
    UPDATE public.alerts
    SET status = 'closed', closed_at = now()
    WHERE type = 'agency_report_department_pending'
      AND entity_type = 'agency_departure_report'
      AND entity_id = p_voyage_id || '::' || upper(btrim(p_port)) || '::' || p_department
      AND status <> 'closed';
  END IF;

  RETURN jsonb_build_object('report_id', v_report_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_agency_report_department_signoff_by_report_id(p_report_id uuid, p_voyage_id bigint, p_port text, p_department text, p_signed boolean, p_justification text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_role TEXT;
  v_report RECORD;
  v_current BOOLEAN;
  v_justification TEXT := NULLIF(btrim(COALESCE(p_justification, '')), '');
BEGIN
  SELECT role INTO v_role FROM public.user_profiles WHERE id = auth.uid() AND active = TRUE;
  IF v_role IS NULL THEN RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501'; END IF;
  v_role := CASE v_role WHEN 'admin' THEN 'administrativo' WHEN 'operator' THEN 'documentacao' ELSE v_role END;
  IF p_department NOT IN ('operacoes', 'documentacao', 'equipamentos') THEN RAISE EXCEPTION 'Departamento invalido.' USING ERRCODE = '22023'; END IF;
  IF v_role NOT IN ('administrativo', p_department) THEN RAISE EXCEPTION 'Sign-off pertence ao departamento %.', p_department USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_report FROM public.agency_departure_reports WHERE id = p_report_id FOR UPDATE;
  IF NOT FOUND OR v_report.voyage_id <> p_voyage_id OR upper(btrim(v_report.port)) <> upper(btrim(p_port))
     OR v_report.terminal_id IS NULL THEN
    RAISE EXCEPTION 'report_id nao pertence a ADR terminalizado da escala %::%.', p_voyage_id, upper(btrim(p_port)) USING ERRCODE = '23514';
  END IF;
  IF v_report.status = 'closed' THEN RAISE EXCEPTION 'ADR fechado: reabra antes de alterar o sign-off departamental.' USING ERRCODE = '42501'; END IF;
  SELECT signed_at IS NOT NULL INTO v_current FROM public.agency_departure_report_department_signoffs
  WHERE report_id = p_report_id AND department = p_department FOR UPDATE;
  v_current := COALESCE(v_current, FALSE);
  IF v_current = p_signed THEN RETURN jsonb_build_object('report_id', p_report_id, 'unchanged', TRUE); END IF;
  -- B5: assinar exige todas as seções do departamento resolvidas, como no
  -- caminho legado; antes a trava existia só na tela.
  IF p_signed AND EXISTS (
    SELECT 1 FROM (VALUES
      ('datas'), ('carga_descarregada'), ('carga_carregada'), ('veiculos'),
      ('vazios_embarcados'), ('vazios_descarregados')
    ) AS all_sections(section)
    WHERE public.agency_report_section_owner(all_sections.section) = p_department
      AND COALESCE((
        SELECT so.state FROM public.agency_departure_report_signoffs so
        WHERE so.report_id = p_report_id AND so.section = all_sections.section
      ), 'pending') = 'pending'
  ) THEN
    RAISE EXCEPTION 'Departamento % tem secoes pendentes: resolva-as antes de assinar.', p_department
      USING ERRCODE = '23514';
  END IF;
  IF NOT p_signed AND v_current AND v_justification IS NULL THEN
    RAISE EXCEPTION 'Reabrir o sign-off departamental exige justificativa.' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.agency_departure_report_department_signoffs (report_id, department, signed_by, signed_at)
  VALUES (p_report_id, p_department, auth.uid(), CASE WHEN p_signed THEN now() ELSE NULL END)
  ON CONFLICT (report_id, department) DO UPDATE SET signed_by = EXCLUDED.signed_by, signed_at = EXCLUDED.signed_at;
  INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  VALUES ('agency_departure_report_department_signoff', p_report_id::TEXT || '::' || p_department, 'signed', v_current::TEXT, p_signed::TEXT, auth.uid(), v_justification);
  IF p_signed THEN
    UPDATE public.alerts
    SET status = 'closed', closed_at = now()
    WHERE type = 'agency_report_department_pending'
      AND entity_type = 'agency_departure_report'
      AND entity_id = public.agency_report_alert_entity_id(
        v_report.voyage_id,
        v_report.port,
        (SELECT d.code FROM public.depots AS d WHERE d.id = v_report.terminal_id),
        p_department
      )
      AND status <> 'closed';
  END IF;
  RETURN jsonb_build_object('report_id', p_report_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_agency_report_section_observation(p_voyage_id bigint, p_port text, p_section text, p_observation text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_role TEXT;
  v_owner TEXT;
  v_report_id UUID;
  v_observation TEXT := NULLIF(btrim(COALESCE(p_observation, '')), '');
BEGIN
  SELECT role INTO v_role FROM public.user_profiles
  WHERE id = auth.uid() AND active = TRUE;
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501';
  END IF;
  v_role := CASE v_role WHEN 'admin' THEN 'administrativo'
                        WHEN 'operator' THEN 'documentacao'
                        ELSE v_role END;

  v_owner := public.agency_report_section_owner(p_section);
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Secao invalida.' USING ERRCODE = '22023';
  END IF;
  IF v_role NOT IN ('administrativo', v_owner) THEN
    RAISE EXCEPTION 'Secao pertence ao departamento %.', v_owner USING ERRCODE = '42501';
  END IF;

  v_report_id := public.ensure_agency_departure_report(p_voyage_id, p_port);
  IF EXISTS (
    SELECT 1 FROM public.agency_departure_reports
    WHERE id = v_report_id AND status = 'closed'
  ) THEN
    RAISE EXCEPTION 'ADR fechado: reabra antes de alterar a observacao.' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.agency_departure_report_signoffs (report_id, section, department, observation)
  VALUES (v_report_id, p_section, v_owner, v_observation)
  ON CONFLICT (report_id, section) DO UPDATE SET
    observation = EXCLUDED.observation;

  RETURN jsonb_build_object('report_id', v_report_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_agency_report_section_observation_by_report_id(p_report_id uuid, p_voyage_id bigint, p_port text, p_section text, p_observation text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_role TEXT;
  v_owner TEXT;
  v_report RECORD;
BEGIN
  SELECT role INTO v_role FROM public.user_profiles WHERE id = auth.uid() AND active = TRUE;
  IF v_role IS NULL THEN RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501'; END IF;
  v_role := CASE v_role WHEN 'admin' THEN 'administrativo' WHEN 'operator' THEN 'documentacao' ELSE v_role END;
  v_owner := public.agency_report_section_owner(p_section);
  IF v_owner IS NULL THEN RAISE EXCEPTION 'Secao invalida.' USING ERRCODE = '22023'; END IF;
  IF v_role NOT IN ('administrativo', v_owner) THEN RAISE EXCEPTION 'Secao pertence ao departamento %.', v_owner USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_report FROM public.agency_departure_reports WHERE id = p_report_id FOR UPDATE;
  IF NOT FOUND OR v_report.voyage_id <> p_voyage_id OR upper(btrim(v_report.port)) <> upper(btrim(p_port))
     OR v_report.terminal_id IS NULL THEN
    RAISE EXCEPTION 'report_id nao pertence a ADR terminalizado da escala %::%.', p_voyage_id, upper(btrim(p_port)) USING ERRCODE = '23514';
  END IF;
  IF v_report.status = 'closed' THEN RAISE EXCEPTION 'ADR fechado: reabra antes de alterar a observacao.' USING ERRCODE = '42501'; END IF;
  INSERT INTO public.agency_departure_report_signoffs (report_id, section, department, observation)
  VALUES (p_report_id, p_section, v_owner, NULLIF(btrim(COALESCE(p_observation, '')), ''))
  ON CONFLICT (report_id, section) DO UPDATE SET observation = EXCLUDED.observation;
  RETURN jsonb_build_object('report_id', p_report_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_agency_report_signoff(p_voyage_id bigint, p_port text, p_section text, p_state text, p_justification text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_role TEXT;
  v_owner TEXT;
  v_report_id UUID;
  v_current TEXT;
  v_justification TEXT := NULLIF(btrim(COALESCE(p_justification, '')), '');
BEGIN
  SELECT role INTO v_role FROM public.user_profiles
  WHERE id = auth.uid() AND active = TRUE;
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501';
  END IF;
  v_role := CASE v_role WHEN 'admin' THEN 'administrativo'
                        WHEN 'operator' THEN 'documentacao'
                        ELSE v_role END;

  v_owner := public.agency_report_section_owner(p_section);
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Secao invalida.' USING ERRCODE = '22023';
  END IF;
  IF v_role NOT IN ('administrativo', v_owner) THEN
    RAISE EXCEPTION 'Secao pertence ao departamento %.', v_owner USING ERRCODE = '42501';
  END IF;
  IF p_state NOT IN ('pending', 'confirmed', 'nothing_to_declare') THEN
    RAISE EXCEPTION 'Estado invalido.' USING ERRCODE = '22023';
  END IF;

  v_report_id := public.ensure_agency_departure_report(p_voyage_id, p_port);

  IF EXISTS (
    SELECT 1 FROM public.agency_departure_reports
    WHERE id = v_report_id AND status = 'closed'
  ) THEN
    RAISE EXCEPTION 'ADR fechado: reabra antes de alterar sign-offs.' USING ERRCODE = '42501';
  END IF;

  -- Estado atual da secao: decide se ha transicao e se exige justificativa.
  SELECT state INTO v_current
  FROM public.agency_departure_report_signoffs
  WHERE report_id = v_report_id AND section = p_section
  FOR UPDATE;
  v_current := COALESCE(v_current, 'pending');

  -- Sem mudanca: nao grava evento nem exige justificativa (idempotente).
  IF v_current = p_state THEN
    RETURN jsonb_build_object('report_id', v_report_id, 'unchanged', TRUE);
  END IF;

  -- Alterar uma decisao ja registrada exige justificativa; a primeira saida de
  -- "pending" nao (a UI faz a confirmacao explicita).
  IF v_current <> 'pending' AND v_justification IS NULL THEN
    RAISE EXCEPTION 'Alterar uma decisao ja registrada exige justificativa.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.agency_departure_report_signoffs
    (report_id, section, state, department, signed_by, signed_at)
  VALUES (v_report_id, p_section, p_state, v_owner, auth.uid(),
          CASE WHEN p_state = 'pending' THEN NULL ELSE now() END)
  ON CONFLICT (report_id, section) DO UPDATE SET
    state = EXCLUDED.state,
    department = EXCLUDED.department,
    signed_by = EXCLUDED.signed_by,
    signed_at = EXCLUDED.signed_at;

  -- Historico da transicao (de->para + justificativa quando aplicavel).
  INSERT INTO public.audit_logs
    (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  VALUES ('agency_departure_report_signoff',
          p_voyage_id || '::' || upper(btrim(p_port)) || '::' || p_section,
          'state', v_current, p_state, auth.uid(), v_justification);

  RETURN jsonb_build_object('report_id', v_report_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_agency_report_signoff_by_report_id(p_report_id uuid, p_voyage_id bigint, p_port text, p_section text, p_state text, p_justification text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_role TEXT;
  v_owner TEXT;
  v_current TEXT;
  v_report RECORD;
  v_justification TEXT := NULLIF(btrim(COALESCE(p_justification, '')), '');
BEGIN
  SELECT role INTO v_role FROM public.user_profiles WHERE id = auth.uid() AND active = TRUE;
  IF v_role IS NULL THEN RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501'; END IF;
  v_role := CASE v_role WHEN 'admin' THEN 'administrativo' WHEN 'operator' THEN 'documentacao' ELSE v_role END;
  v_owner := public.agency_report_section_owner(p_section);
  IF v_owner IS NULL OR p_state NOT IN ('pending', 'confirmed', 'nothing_to_declare') THEN
    RAISE EXCEPTION 'Secao ou estado invalido.' USING ERRCODE = '22023';
  END IF;
  IF v_role NOT IN ('administrativo', v_owner) THEN
    RAISE EXCEPTION 'Secao pertence ao departamento %.', v_owner USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_report FROM public.agency_departure_reports WHERE id = p_report_id FOR UPDATE;
  IF NOT FOUND OR v_report.voyage_id <> p_voyage_id OR upper(btrim(v_report.port)) <> upper(btrim(p_port))
     OR v_report.terminal_id IS NULL THEN
    RAISE EXCEPTION 'report_id nao pertence a ADR terminalizado da escala %::%.', p_voyage_id, upper(btrim(p_port)) USING ERRCODE = '23514';
  END IF;
  IF v_report.status = 'closed' THEN RAISE EXCEPTION 'ADR fechado: reabra antes de alterar sign-offs.' USING ERRCODE = '42501'; END IF;

  SELECT state INTO v_current FROM public.agency_departure_report_signoffs
  WHERE report_id = p_report_id AND section = p_section FOR UPDATE;
  v_current := COALESCE(v_current, 'pending');
  IF v_current = p_state THEN RETURN jsonb_build_object('report_id', p_report_id, 'unchanged', TRUE); END IF;
  IF v_current <> 'pending' AND v_justification IS NULL THEN
    RAISE EXCEPTION 'Alterar uma decisao ja registrada exige justificativa.' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.agency_departure_report_signoffs
    (report_id, section, state, department, signed_by, signed_at)
  VALUES (p_report_id, p_section, p_state, v_owner, auth.uid(), CASE WHEN p_state = 'pending' THEN NULL ELSE now() END)
  ON CONFLICT (report_id, section) DO UPDATE SET state = EXCLUDED.state, department = EXCLUDED.department,
    signed_by = EXCLUDED.signed_by, signed_at = EXCLUDED.signed_at;
  INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  VALUES ('agency_departure_report_signoff', p_report_id::TEXT || '::' || p_section, 'state', v_current, p_state, auth.uid(), v_justification);
  RETURN jsonb_build_object('report_id', p_report_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_bl_cod(p_bl_id text, p_omission_id bigint, p_justification text, p_changed_by uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_discharge text;
  v_omitted text;
  v_old_pod text;
  v_customer bigint;
  v_old_terminal uuid;
  v_old_pod_port_id bigint;
  v_justification text := NULLIF(btrim(COALESCE(p_justification, '')), '');
  v_previous_override text := current_setting('vela.bl_terminal_override', true);
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR p_changed_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Usuário sem permissão ativa.' USING ERRCODE = '42501';
  END IF;
  IF v_justification IS NULL THEN RAISE EXCEPTION 'Marcar COD exige justificativa.' USING ERRCODE = '22023'; END IF;

  SELECT o.discharge_pod, o.omitted_pod INTO v_discharge, v_omitted
  FROM public.bl_transshipments AS t
  JOIN public.voyage_omissions AS o ON o.id = t.omission_id
  WHERE t.bl_id = p_bl_id AND t.omission_id = p_omission_id
  FOR UPDATE OF o;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transbordo do B/L % nao encontrado', p_bl_id USING ERRCODE = 'P0002';
  END IF;

  SELECT pod, customer_id, terminal_id, pod_port_id
    INTO v_old_pod, v_customer, v_old_terminal, v_old_pod_port_id
  FROM public.bls
  WHERE id = p_bl_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L % nao encontrado', p_bl_id USING ERRCODE = 'P0002';
  END IF;

  -- Retry do mesmo COD não repete efeito financeiro, auditoria ou notificação;
  -- inclusive quando a reprecificação concluiu que não havia diferença.
  IF EXISTS (
    SELECT 1
    FROM public.bl_transshipments
    WHERE bl_id = p_bl_id AND omission_id = p_omission_id AND disposition = 'cod'
  ) THEN
    RETURN;
  END IF;

  UPDATE public.bl_transshipments
  SET disposition = 'cod', updated_at = now()
  WHERE bl_id = p_bl_id AND omission_id = p_omission_id;

  -- A exceção terminal é específica do POD anterior. COD deve limpar os dois
  -- campos como uma operação atômica; deixar a dupla antiga seria herdar um
  -- terminal incompatível no destino novo.
  PERFORM set_config('vela.bl_terminal_override', 'on', true);
  UPDATE public.bls
  SET pod = v_discharge,
      manifesto_mercante_id = NULL,
      terminal_id = NULL,
      pod_port_id = NULL,
      updated_at = now()
  WHERE id = p_bl_id;
  PERFORM set_config('vela.bl_terminal_override', COALESCE(v_previous_override, 'off'), true);

  IF to_regprocedure('public.apply_cod_financial_effect(text,bigint,text)') IS NOT NULL THEN
    PERFORM public.apply_cod_financial_effect(p_bl_id, p_omission_id, v_old_pod);
  END IF;

  INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  VALUES ('bls', p_bl_id, 'pod', v_old_pod, v_discharge, p_changed_by,
    'COD apos omissao da escala de ' || v_omitted || ': ' || v_justification);

  IF v_old_terminal IS NOT NULL OR v_old_pod_port_id IS NOT NULL THEN
    INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
    VALUES (
      'bls', p_bl_id, 'terminal_override',
      jsonb_build_object('terminal_id', v_old_terminal, 'pod_port_id', v_old_pod_port_id)::text,
      jsonb_build_object('terminal_id', NULL, 'pod_port_id', NULL)::text,
      p_changed_by,
      'Excecao de terminal limpa por COD: ' || v_justification
    );
  END IF;

  IF v_customer IS NOT NULL THEN
    INSERT INTO public.portal_notifications(customer_id, bl_id, type, title, message, link)
    VALUES (v_customer, p_bl_id, 'transshipment', 'Destino alterado (COD)',
      'A pedido, o destino final do B/L ' || p_bl_id || ' foi alterado para ' || v_discharge ||
        ' (COD), apos a omissao da escala de ' || v_omitted || '.', NULL);
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_bl_transshipment(p_bl_id text, p_omission_id bigint, p_justification text, p_changed_by uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_was TEXT;
  v_original_pod TEXT;
  v_old_pod TEXT;
  v_customer BIGINT;
  v_justification TEXT := NULLIF(btrim(COALESCE(p_justification, '')), '');
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR p_changed_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Usuário sem permissão ativa.' USING ERRCODE = '42501';
  END IF;

  SELECT t.disposition, o.omitted_pod INTO v_was, v_original_pod
  FROM public.bl_transshipments AS t
  JOIN public.voyage_omissions AS o ON o.id = t.omission_id
  WHERE t.bl_id = p_bl_id AND t.omission_id = p_omission_id
  FOR UPDATE OF o;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transbordo do B/L % nao encontrado', p_bl_id USING ERRCODE = 'P0002';
  END IF;

  SELECT pod, customer_id INTO v_old_pod, v_customer
  FROM public.bls WHERE id = p_bl_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L % nao encontrado', p_bl_id USING ERRCODE = 'P0002';
  END IF;

  IF v_was = 'cod' AND v_justification IS NULL THEN
    RAISE EXCEPTION 'Reverter COD exige justificativa.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.bl_transshipments
  SET disposition = 'transshipment', updated_at = now()
  WHERE bl_id = p_bl_id AND omission_id = p_omission_id;

  IF v_was = 'cod' THEN
    UPDATE public.bls SET pod = v_original_pod, updated_at = now() WHERE id = p_bl_id;

    IF to_regprocedure('public.apply_cod_financial_effect(text,bigint,text)') IS NOT NULL THEN
      PERFORM public.apply_cod_financial_effect(p_bl_id, p_omission_id, v_old_pod);
    END IF;

    INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
    VALUES ('bls', p_bl_id, 'pod', v_old_pod, v_original_pod, p_changed_by,
      'Reversao de COD para transbordo: ' || v_justification);

    IF v_customer IS NOT NULL THEN
      INSERT INTO public.portal_notifications(customer_id, bl_id, type, title, message, link)
      VALUES (
        v_customer, p_bl_id, 'transshipment', 'Correção de destino (COD)',
        'O destino final do B/L ' || p_bl_id || ' foi restaurado para ' || v_original_pod ||
          ' após a reversão do COD.', NULL
      );
    END IF;
  END IF;

  INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  VALUES ('bls', p_bl_id, 'transbordo', v_was, 'transshipment', p_changed_by,
    'Definicao de transbordo (navio de terceiros)');
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_container_dates(p_container_id bigint, p_discharge_date date, p_return_date date, p_reason text DEFAULT NULL::text, p_keep_discharge boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_old record;
  v_touched text[];
  v_request uuid := gen_random_uuid();
  v_role text := public.current_actor_role();
  v_discharge date := p_discharge_date;
BEGIN
  IF v_actor IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuário sem permissão ativa.' USING ERRCODE = '42501';
  END IF;
  -- O conjunto do container compartilhado antes da linha (211).
  PERFORM public._lock_container_date_sets(ARRAY[p_container_id]);
  SELECT c.id, c.bl_id, c.container_number, c.discharge_date, c.return_date INTO v_old
  FROM public.bl_containers AS c WHERE c.id = p_container_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Container % nao encontrado.', p_container_id USING ERRCODE = 'P0002';
  END IF;
  -- 504 (ADR 0094, B4): o B/L cancelado é somente leitura. Sem esta recusa, a
  -- data ia só aos B/Ls irmãos ativos (380) e a ficha dizia que salvou.
  IF EXISTS (SELECT 1 FROM public.bls WHERE id = v_old.bl_id AND cancelled_at IS NOT NULL) THEN
    RAISE EXCEPTION 'B/L % cancelado: somente leitura. Reative para corrigir.', v_old.bl_id USING ERRCODE = '42501';
  END IF;
  -- Só a devolução muda (210): a descarga é a gravada, lida sob a trava.
  IF p_keep_discharge THEN
    v_discharge := v_old.discharge_date;
  END IF;
  IF p_return_date IS NOT NULL AND v_discharge IS NOT NULL AND p_return_date < v_discharge THEN
    RAISE EXCEPTION 'Devolução anterior à descarga.' USING ERRCODE = '22023';
  END IF;
  IF p_return_date IS NOT NULL AND v_discharge IS NULL THEN
    RAISE EXCEPTION 'Informe a descarga antes da devolução.' USING ERRCODE = '22023';
  END IF;
  IF ((v_old.discharge_date IS NOT NULL AND v_discharge IS NULL)
      OR (v_old.return_date IS NOT NULL AND p_return_date IS NULL))
     AND v_reason IS NULL THEN
    RAISE EXCEPTION 'Informe o motivo para remover a data.' USING ERRCODE = '22023';
  END IF;

  v_touched := public._apply_container_dates_core(p_container_id, v_discharge, p_return_date, false);

  IF cardinality(v_touched) > 0 THEN
    INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by, justification, actor_role, actor_department)
    VALUES ('bl', v_old.bl_id, 'container_dates',
      jsonb_build_object('container', v_old.container_number, 'discharge_date', v_old.discharge_date, 'return_date', v_old.return_date)::text,
      jsonb_build_object('container', v_old.container_number, 'discharge_date', v_discharge, 'return_date', p_return_date, 'propagated_bl_ids', v_touched)::text,
      v_actor, COALESCE(v_reason, 'Edição das datas do container'), v_role, v_role);
  END IF;

  RETURN jsonb_build_object(
    'container_id', p_container_id,
    'propagated_bl_ids', to_jsonb(v_touched),
    'demurrage', CASE WHEN cardinality(v_touched) > 0 THEN public._after_container_dates(v_request, v_touched, v_actor) ELSE '{}'::jsonb END
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_import_batch_ce_master(p_batch_id bigint, p_ce_master text, p_changed_by uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_batch public.import_batches%ROWTYPE;
  v_normalized text := public.canonical_manifesto_numero(p_ce_master);
  v_old_value text;
BEGIN
  IF auth.uid() IS NULL
     OR NOT public.is_active_user()
     OR p_changed_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Usuário sem permissão ativa para editar CE Master.'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_batch FROM public.import_batches WHERE id = p_batch_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lote de importacao % nao encontrado', p_batch_id
      USING ERRCODE = 'P0002';
  END IF;

  v_old_value := NULLIF(btrim(COALESCE(v_batch.ce_master, '')), '');
  IF v_old_value IS NOT DISTINCT FROM v_normalized THEN
    RETURN;
  END IF;

  -- 396 (F-49): o lote guarda só o Nº que a rota aceitou.
  IF v_normalized IS NOT NULL THEN
    IF v_normalized !~ '^[A-Z0-9]{13}$' THEN
      RAISE EXCEPTION 'Nº de Manifesto Mercante inválido: "%". O número tem 13 caracteres, letras ou dígitos (ex.: 1226501860578).', p_ce_master
        USING ERRCODE = 'P0012';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.manifestos_mercante m
                   WHERE m.numero = v_normalized AND m.voyage_id = v_batch.voyage_id) THEN
      RAISE EXCEPTION 'O Nº de Manifesto Mercante % não está cadastrado em uma rota desta Viagem: informe-o na rota antes.', v_normalized
        USING ERRCODE = '22023';
    END IF;
  ELSIF EXISTS (SELECT 1 FROM public.manifestos_mercante m
                WHERE m.numero = public.canonical_manifesto_numero(v_old_value) AND m.voyage_id = v_batch.voyage_id) THEN
    RAISE EXCEPTION 'O Nº de Manifesto Mercante % continua cadastrado na rota: tire o número da rota antes.', v_old_value
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.import_batches SET ce_master = v_normalized WHERE id = p_batch_id;

  -- 404 (F-24): `import_batch` (singular) é a linha semântica com o id da
  -- Viagem; `import_batches` fica só para o gatilho, com o id do lote.
  INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  VALUES ('import_batch', COALESCE(v_batch.voyage_id::text, p_batch_id::text), 'ce_master',
    v_old_value, v_normalized, p_changed_by, 'Atualizacao manual de CE Master');
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_voyage_route_ce_master(p_voyage_id bigint, p_pol text, p_pod text, p_ce_master text, p_changed_by uuid, p_cargo_mode text DEFAULT 'container'::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_norm text := public.canonical_manifesto_numero(p_ce_master);
  v_pol text := upper(btrim(COALESCE(p_pol, '')));
  v_pod text := upper(btrim(COALESCE(p_pod, '')));
  v_mode text := lower(btrim(COALESCE(p_cargo_mode, 'container')));
  v_old text;
  v_old_manifesto public.manifestos_mercante%ROWTYPE;
  v_linked integer;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR p_changed_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Usuário sem permissão ativa para editar o Nº de Manifesto Mercante.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.voyages WHERE id = p_voyage_id) THEN
    RAISE EXCEPTION 'Viagem % nao encontrada', p_voyage_id USING ERRCODE = 'P0002';
  END IF;
  IF v_norm IS NOT NULL AND v_norm !~ '^[A-Z0-9]{13}$' THEN
    RAISE EXCEPTION 'Nº de Manifesto Mercante inválido: "%". O número tem 13 caracteres, letras ou dígitos (ex.: 1226501860578).', p_ce_master
      USING ERRCODE = 'P0012';
  END IF;

  -- 396 (F-49): a mesma trava das importações da Viagem (387). "Informar"
  -- espera a planilha de CE da mesma Viagem em vez de cruzar com ela (23505).
  PERFORM public._lock_import_voyages(ARRAY[p_voyage_id]);
  -- 217: a rota é travada antes de ler o número antigo.
  PERFORM pg_advisory_xact_lock(hashtextextended(
    format('route_ce_master:%s:%s:%s:%s', p_voyage_id, v_pol, v_pod, v_mode), 0));

  SELECT ce_master INTO v_old FROM public.voyage_route_ce_master
    WHERE voyage_id = p_voyage_id AND pol = v_pol AND pod = v_pod AND cargo_mode = v_mode
    FOR UPDATE;

  -- Troca ou limpeza (215): o Manifesto antigo com B/L não muda por aqui.
  IF public.canonical_manifesto_numero(v_old) IS NOT NULL
     AND public.canonical_manifesto_numero(v_old) IS DISTINCT FROM v_norm THEN
    SELECT * INTO v_old_manifesto FROM public.manifestos_mercante
      WHERE numero = public.canonical_manifesto_numero(v_old) AND voyage_id = p_voyage_id
      FOR UPDATE;
    IF FOUND THEN
      SELECT count(*) INTO v_linked FROM public.bls WHERE manifesto_mercante_id = v_old_manifesto.id;
      IF v_linked > 0 THEN
        RAISE EXCEPTION 'O Manifesto Mercante % tem % B/L(s) vinculado(s): para trocar o número, use Ver B/Ls → Mover; para tirar o número, Ver B/Ls → Desvincular.',
          v_old_manifesto.numero, v_linked USING ERRCODE = '22023';
      END IF;
      DELETE FROM public.manifestos_mercante WHERE id = v_old_manifesto.id;
    END IF;
  END IF;

  -- Fonte única (ADR 0078, item 6): o Manifesto da rota.
  IF v_norm IS NOT NULL THEN
    PERFORM public._upsert_route_manifesto(p_voyage_id, v_pol, v_pod,
      CASE WHEN v_mode = 'vazios' THEN 'vazio' ELSE 'carga' END, v_norm);
  END IF;

  PERFORM set_config('vela.route_manifest_mirror', 'on', true);
  INSERT INTO public.voyage_route_ce_master(voyage_id, pol, pod, cargo_mode, ce_master, updated_by, updated_at)
  VALUES (p_voyage_id, v_pol, v_pod, v_mode, v_norm, p_changed_by, now())
  ON CONFLICT (voyage_id, pol, pod, cargo_mode)
  DO UPDATE SET ce_master = EXCLUDED.ce_master, updated_by = EXCLUDED.updated_by, updated_at = now();
  PERFORM set_config('vela.route_manifest_mirror', 'off', true);

  IF COALESCE(v_old, '') IS DISTINCT FROM COALESCE(v_norm, '') THEN
    INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
    VALUES ('voyage', p_voyage_id::text, 'ce_master', NULLIF(v_old, ''), v_norm, p_changed_by,
            CASE WHEN v_mode = 'vazios' THEN 'Nº de Manifesto Mercante por rota (vazios)'
                 ELSE 'Nº de Manifesto Mercante por rota' END);
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.sync_local_charge_receivable(p_bl_id text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_id bigint;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuário sem permissão de faturamento.' USING ERRCODE = '42501';
  END IF;
  SELECT br.id INTO v_id FROM public.bl_receivables br WHERE br.bl_id = upper(btrim(p_bl_id))
    AND br.source = 'local_charges' AND EXISTS (SELECT 1 FROM public.invoice_receivable_links l
      JOIN public.invoices i ON i.id = l.invoice_id WHERE l.receivable_id = br.id
      AND i.status IN ('issued', 'overdue', 'partially_paid', 'paid', 'covered'));
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  RETURN public._sync_local_charge_receivable_before_correction_123(p_bl_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.unlink_bls_from_manifesto_mercante(p_bl_ids text[], p_reason text, p_expected jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_ids text[];
  v_count integer;
BEGIN
  IF v_actor IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuário sem permissão ativa.' USING ERRCODE = '42501';
  END IF;
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'Informe o motivo do desvínculo do Manifesto Mercante.' USING ERRCODE = '22023';
  END IF;
  v_ids := public._lock_bls_for_manifesto(p_bl_ids);
  PERFORM public._check_expected_manifestos(v_ids, p_expected);
  v_count := public._link_bls_to_manifesto(v_ids, NULL, v_actor, v_reason);
  RETURN jsonb_build_object('unlinked', v_count, 'unchanged', cardinality(v_ids) - v_count);
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_customer_with_audit(p_customer_id bigint, p_updates jsonb, p_changed_by uuid, p_justification text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_before public.customers%ROWTYPE;
  v_after public.customers%ROWTYPE;
  v_invalid_key TEXT;
BEGIN
  IF auth.uid() IS NULL
     OR NOT public.is_active_user()
     OR p_changed_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Usuário sem permissão para editar o Cliente.' USING ERRCODE = '42501';
  END IF;

  IF NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuário sem permissão para editar cliente.' USING ERRCODE = '42501';
  END IF;

  IF NULLIF(BTRIM(COALESCE(p_justification, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Justificativa obrigatoria para editar cliente.' USING ERRCODE = '22023';
  END IF;

  IF jsonb_typeof(p_updates) <> 'object' OR p_updates = '{}'::JSONB THEN
    RETURN FALSE;
  END IF;

  SELECT key INTO v_invalid_key
  FROM jsonb_object_keys(p_updates) AS key
  WHERE key NOT IN ('name', 'trade_name', 'address', 'city', 'state', 'zip', 'notes', 'cnpj_cpf')
  LIMIT 1;

  IF v_invalid_key IS NOT NULL THEN
    RAISE EXCEPTION 'Campo de cliente nao editavel: %.', v_invalid_key USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_before FROM public.customers WHERE id = p_customer_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cliente % nao encontrado.', p_customer_id USING ERRCODE = 'P0002';
  END IF;

  -- 436: o CNPJ só muda por aqui, com justificativa. O gatilho
  -- `portal_protect_customer_cnpj` segue recusando o Cliente com convite ou
  -- Conta de Portal (esse vai por `portal_admin_change_cnpj`), e
  -- `canonicalize_customer_cnpj` normaliza e valida o documento.
  UPDATE public.customers SET
    cnpj_cpf = CASE WHEN p_updates ? 'cnpj_cpf' THEN p_updates->>'cnpj_cpf' ELSE cnpj_cpf END,
    name = CASE WHEN p_updates ? 'name' THEN p_updates->>'name' ELSE name END,
    trade_name = CASE WHEN p_updates ? 'trade_name' THEN NULLIF(p_updates->>'trade_name', '') ELSE trade_name END,
    address = CASE WHEN p_updates ? 'address' THEN NULLIF(p_updates->>'address', '') ELSE address END,
    city = CASE WHEN p_updates ? 'city' THEN NULLIF(p_updates->>'city', '') ELSE city END,
    state = CASE WHEN p_updates ? 'state' THEN NULLIF(p_updates->>'state', '') ELSE state END,
    zip = CASE WHEN p_updates ? 'zip' THEN NULLIF(p_updates->>'zip', '') ELSE zip END,
    notes = CASE WHEN p_updates ? 'notes' THEN NULLIF(p_updates->>'notes', '') ELSE notes END
  WHERE id = p_customer_id
  RETURNING * INTO v_after;

  INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  SELECT 'customer', p_customer_id::TEXT, changed.field_name, changed.old_value, changed.new_value,
    p_changed_by, BTRIM(p_justification)
  FROM (VALUES
    ('cnpj_cpf', v_before.cnpj_cpf, v_after.cnpj_cpf),
    ('name', v_before.name, v_after.name),
    ('trade_name', v_before.trade_name, v_after.trade_name),
    ('address', v_before.address, v_after.address),
    ('city', v_before.city, v_after.city),
    ('state', v_before.state, v_after.state),
    ('zip', v_before.zip, v_after.zip),
    ('notes', v_before.notes, v_after.notes)
  ) AS changed(field_name, old_value, new_value)
  WHERE p_updates ? changed.field_name
    AND changed.old_value IS DISTINCT FROM changed.new_value;

  RETURN TRUE;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_manual_bl_charge(p_charge_calculation_id bigint, p_quantity numeric, p_notes text DEFAULT NULL::text, p_actor uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bl_id text;
BEGIN
  PERFORM public._assert_actor_is_caller(p_actor);
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuário sem permissão ativa' USING ERRCODE = '42501';
  END IF;
  SELECT cc.bl_id INTO v_bl_id FROM public.charge_calculations cc WHERE cc.id = p_charge_calculation_id;
  IF v_bl_id IS NOT NULL THEN
    PERFORM public._assert_bl_not_manually_exempt(v_bl_id);
  END IF;
  RETURN public._update_manual_bl_charge_impl_491(p_charge_calculation_id, p_quantity, p_notes, p_actor);
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_voyage_omission(p_omission_id bigint, p_onward_vessel_name text, p_onward_carrier text, p_onward_voyage_number text, p_onward_etd timestamp with time zone, p_onward_eta timestamp with time zone, p_reason text, p_changed_by uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_old RECORD;
  v_new_vessel TEXT;
  v_new_carrier TEXT;
  v_new_voyage TEXT;
  v_new_etd TIMESTAMPTZ;
  v_new_eta TIMESTAMPTZ;
  v_reason TEXT;
  v_changed BOOLEAN := false;
  v_justification TEXT := 'Informacoes de Transbordo complementadas';
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR p_changed_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Usuário sem permissão ativa.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_old FROM public.voyage_omissions WHERE id = p_omission_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Omissão % não encontrada', p_omission_id USING ERRCODE = 'P0002';
  END IF;

  v_reason := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_new_vessel := NULLIF(btrim(COALESCE(p_onward_vessel_name, '')), '');
  v_new_carrier := NULLIF(btrim(COALESCE(p_onward_carrier, '')), '');
  v_new_voyage := NULLIF(btrim(COALESCE(p_onward_voyage_number, '')), '');
  v_new_etd := p_onward_etd;
  v_new_eta := p_onward_eta;

  v_changed := v_old.onward_vessel_name IS DISTINCT FROM v_new_vessel
    OR v_old.onward_carrier IS DISTINCT FROM v_new_carrier
    OR v_old.onward_voyage_number IS DISTINCT FROM v_new_voyage
    OR v_old.onward_etd IS DISTINCT FROM v_new_etd
    OR v_old.onward_eta IS DISTINCT FROM v_new_eta
    OR (v_reason IS NOT NULL AND v_old.reason IS DISTINCT FROM v_reason);

  UPDATE public.voyage_omissions SET
    onward_vessel_name = v_new_vessel,
    onward_carrier = v_new_carrier,
    onward_voyage_number = v_new_voyage,
    onward_etd = v_new_etd,
    onward_eta = v_new_eta,
    reason = COALESCE(v_reason, v_old.reason)
  WHERE id = p_omission_id;

  IF NOT v_changed THEN
    RETURN;
  END IF;

  INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  VALUES ('voyage', v_old.voyage_id::TEXT, 'transshipment_info', NULL,
    v_justification, p_changed_by, v_justification);
  INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  SELECT 'bls', bt.bl_id, 'transshipment_info', NULL, v_justification, p_changed_by, v_justification
  FROM public.bl_transshipments AS bt
  WHERE bt.omission_id = p_omission_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.upsert_pix_reconciliation_exceptions(p_import_key text, p_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_row RECORD;
  v_exception public.pix_reconciliation_exceptions%ROWTYPE;
  v_alert JSONB;
  v_items JSONB := '[]'::jsonb;
  v_import_key TEXT := NULLIF(btrim(COALESCE(p_import_key, '')), '');
  v_normalized_txid TEXT;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_financeiro_user() THEN
    RAISE EXCEPTION 'Usuário sem permissão para a conciliação de Pix.' USING ERRCODE = '42501';
  END IF;
  IF v_import_key IS NULL OR char_length(v_import_key) < 8 THEN
    RAISE EXCEPTION 'Identificador do import PIX invalido.' USING ERRCODE = '22023';
  END IF;

  FOR v_row IN
    SELECT *
    FROM jsonb_to_recordset(COALESCE(p_rows, '[]'::jsonb)) AS row(
      line_number INTEGER,
      txid TEXT,
      cnpj TEXT,
      paid_at TIMESTAMPTZ,
      amount_brl NUMERIC,
      reason TEXT,
      candidate_count INTEGER,
      metadata JSONB
    )
  LOOP
    IF v_row.line_number IS NULL OR v_row.line_number <= 0
       OR v_row.reason NOT IN ('unmatched', 'ambiguous')
       OR COALESCE(v_row.amount_brl, 0) < 0 THEN
      RAISE EXCEPTION 'Linha de excecao PIX invalida.' USING ERRCODE = '22023';
    END IF;

    v_normalized_txid := UPPER(REGEXP_REPLACE(COALESCE(v_row.txid, ''), '[^A-Za-z0-9]', '', 'g'));
    INSERT INTO public.pix_reconciliation_exceptions (
      import_key, line_number, txid, normalized_txid, cnpj, paid_at,
      amount_brl, reason, candidate_count, metadata, status, updated_at
    )
    VALUES (
      v_import_key, v_row.line_number, COALESCE(v_row.txid, ''), v_normalized_txid,
      COALESCE(v_row.cnpj, ''), v_row.paid_at, ROUND(COALESCE(v_row.amount_brl, 0), 2),
      v_row.reason, GREATEST(COALESCE(v_row.candidate_count, 0), 0),
      COALESCE(v_row.metadata, '{}'::jsonb), 'active', now()
    )
    ON CONFLICT (import_key, line_number) DO UPDATE
      SET txid = EXCLUDED.txid,
          normalized_txid = EXCLUDED.normalized_txid,
          cnpj = EXCLUDED.cnpj,
          paid_at = EXCLUDED.paid_at,
          amount_brl = EXCLUDED.amount_brl,
          reason = EXCLUDED.reason,
          candidate_count = EXCLUDED.candidate_count,
          metadata = EXCLUDED.metadata,
          status = CASE
            WHEN public.pix_reconciliation_exceptions.status = 'resolved' THEN 'resolved'
            ELSE 'active'
          END,
          updated_at = now()
      -- Exceção resolvida guarda a evidência da resolução: não é reescrita.
      WHERE public.pix_reconciliation_exceptions.status <> 'resolved'
    RETURNING * INTO v_exception;
    IF NOT FOUND THEN
      SELECT * INTO v_exception FROM public.pix_reconciliation_exceptions
       WHERE import_key = v_import_key AND line_number = v_row.line_number;
    END IF;

    v_alert := NULL;
    PERFORM set_config('alerts.foundation_trigger', 'on', true);
    IF v_exception.status = 'active' THEN
      v_alert := public.upsert_alert_item(
        'pix_unreconciled', 'pix_transaction', v_exception.id::TEXT,
        CASE WHEN v_exception.reason = 'ambiguous'
          THEN format('PIX ambiguo na linha %s do import %s.', v_exception.line_number, v_exception.import_key)
          ELSE format('PIX sem conciliacao na linha %s do import %s.', v_exception.line_number, v_exception.import_key)
        END,
        'pix_extract_import',
        jsonb_build_object(
          'exception_id', v_exception.id,
          'import_key', v_exception.import_key,
          'line_number', v_exception.line_number,
          'normalized_txid', v_exception.normalized_txid,
          'reason', v_exception.reason,
          'candidate_count', v_exception.candidate_count
        ) || v_exception.metadata,
        '/reconciliacao'
      );
    ELSE
      PERFORM public.resolve_alert_item(
        'pix_unreconciled', 'pix_transaction', v_exception.id::TEXT,
        'pix_exception_already_resolved', jsonb_build_object('exception_id', v_exception.id)
      );
    END IF;
    PERFORM set_config('alerts.foundation_trigger', 'off', true);

    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'id', v_exception.id, 'line_number', v_exception.line_number,
      'status', v_exception.status, 'alert_id', v_alert->>'alert_id'
    ));
  END LOOP;

  RETURN jsonb_build_object('items', v_items);
END;
$function$;

CREATE OR REPLACE FUNCTION public.vazios_export_adr_locked(p_voyage_id bigint, p_port text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_read_user() THEN
    RAISE EXCEPTION 'Usuário sem permissão ativa.' USING ERRCODE = '42501';
  END IF;
  RETURN public._vazios_export_locked_by_adr(p_voyage_id, p_port);
END $function$;
