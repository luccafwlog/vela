-- 381: carga solta faturada só muda com a confirmação de faturamento, e a
-- prévia mostra a fatura e o valor antes → depois (ADR 0094, B5; plano da
-- frente financeira, F-32 e 2f).
--
-- Problema: a reimportação do Manifesto BB travava só POL e POD do B/L
-- faturado; peso, CBM, volumes e máquinas entravam sem confirmação e a
-- correção reemitia a fatura na mesma transação (ADR 0077, item 2). `bb_cbm`,
-- volumes e máquinas mudados sozinhos trocavam a modalidade do B/L (container
-- → misto) sem disparar a correção: os gatilhos olhavam só `cargo_mode` na
-- lista de colunas do UPDATE. Quando a reemissão não podia sair (B/L misto com
-- terminais em conflito), a fatura era cancelada e ficava em reemissão
-- pendente.
--
-- Mudança:
--   1. Sem a confirmação (`override_billing`, conferida na gravação), o B/L
--      faturado mantém peso, CBM, volumes e máquinas; os campos voltam em
--      `billing_locked`.
--   2. `preview_breakbulk_billing_changes`: para cada B/L faturado que muda,
--      as faturas e o valor antes → depois, simulados numa subtransação
--      desfeita, e o bloqueio da reemissão, se houver.
--   3. Os gatilhos de correção e de recálculo em `bls` passam a olhar também
--      `bb_cbm`, `bb_packages_qty`, `bb_packages_total` e `bb_machine_qty`.
--   4. A correção que não pode reemitir (pendência de terminal do B/L misto)
--      não cancela a fatura: abre "Fatura desatualizada" com o motivo e fica
--      pendente para "Tentar aplicar correção".
--
-- Não altera nem apaga linhas existentes.

DROP TRIGGER capture_invoice_basis ON public.bls;
CREATE TRIGGER capture_invoice_basis
  BEFORE UPDATE OF voyage_id, pod, cargo_mode, customer_id, bb_weight_ton, total_weight_kg, movement_to, cancelled_at,
    bb_cbm, bb_packages_qty, bb_packages_total, bb_machine_qty
  ON public.bls FOR EACH ROW EXECUTE FUNCTION public.capture_invoice_basis();
DROP TRIGGER process_invoice_basis_changes ON public.bls;
CREATE CONSTRAINT TRIGGER process_invoice_basis_changes
  AFTER UPDATE OF voyage_id, pod, cargo_mode, customer_id, bb_weight_ton, total_weight_kg, movement_to, cancelled_at,
    bb_cbm, bb_packages_qty, bb_packages_total, bb_machine_qty
  ON public.bls DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.process_invoice_basis_changes_at_commit();
DROP TRIGGER refresh_unbilled_calculations ON public.bls;
CREATE CONSTRAINT TRIGGER refresh_unbilled_calculations
  AFTER UPDATE OF voyage_id, pod, cargo_mode, customer_id, bb_weight_ton, total_weight_kg, movement_to, cancelled_at,
    bb_cbm, bb_packages_qty, bb_packages_total, bb_machine_qty
  ON public.bls DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.refresh_unbilled_calculations_at_commit();

CREATE OR REPLACE FUNCTION public.preview_breakbulk_billing_changes(p_voyage_id bigint, p_bls jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row jsonb;
  v_bl public.bls%ROWTYPE;
  v_out jsonb := '[]'::jsonb;
  v_entry jsonb;
  v_roe numeric;
  v_before numeric;
  v_quote jsonb;
  v_block text[];
  v_invoices jsonb;
  v_cod boolean;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Sem permissão para conferir a reimportação.' USING ERRCODE = '42501';
  END IF;
  FOR v_row IN SELECT r FROM jsonb_array_elements(coalesce(p_bls, '[]'::jsonb)) r LOOP
    SELECT * INTO v_bl FROM public.bls WHERE id = v_row->>'id' AND voyage_id = p_voyage_id AND cancelled_at IS NULL;
    CONTINUE WHEN NOT FOUND;
    CONTINUE WHEN coalesce(v_bl.financial_status, 'pending') NOT IN ('invoiced', 'paid')
      AND cardinality(public._live_local_invoice_ids_for_bl(v_bl.id)) = 0;
    SELECT coalesce(jsonb_agg(i.invoice_number ORDER BY i.id), '[]'::jsonb) INTO v_invoices
    FROM public.invoices i WHERE i.id = ANY(public._live_local_invoice_ids_for_bl(v_bl.id));
    SELECT r.roe_frozen, r.original_amount_brl - r.correction_amount_brl INTO v_roe, v_before
    FROM public.bl_receivables r WHERE r.bl_id = v_bl.id AND r.source = 'local_charges';
    v_cod := EXISTS (SELECT 1 FROM public.bl_transshipments t JOIN public.voyage_omissions o ON o.id = t.omission_id
      WHERE t.bl_id = v_bl.id AND t.disposition = 'cod' AND o.reverted_at IS NULL);
    v_entry := NULL;
    -- Simula a gravação confirmada numa subtransação desfeita.
    BEGIN
      PERFORM set_config('vela.bl_terminal_override', 'on', true);
      UPDATE public.bls b SET
        pol = coalesce(nullif(btrim(v_row->>'pol'), ''), b.pol),
        pod = CASE WHEN v_cod THEN b.pod ELSE coalesce(nullif(btrim(v_row->>'pod'), ''), b.pod) END,
        terminal_id = CASE WHEN NOT v_cod AND coalesce(nullif(btrim(v_row->>'pod'), ''), b.pod) IS DISTINCT FROM b.pod THEN NULL ELSE b.terminal_id END,
        bb_weight_ton = coalesce(nullif(v_row->>'bb_weight_ton', '')::numeric, b.bb_weight_ton),
        bb_cbm = coalesce(nullif(v_row->>'bb_cbm', '')::numeric, b.bb_cbm),
        bb_packages_qty = coalesce(nullif(v_row->>'bb_packages_qty', '')::numeric, b.bb_packages_qty),
        bb_packages_total = coalesce(nullif(v_row->>'bb_packages_total', '')::numeric, b.bb_packages_total),
        bb_machine_qty = coalesce(nullif(v_row->>'bb_machine_qty', '')::numeric, b.bb_machine_qty)
      WHERE b.id = v_bl.id;
      v_quote := public._quote_bl_local_charges(v_bl.id, v_roe);
      v_block := public.check_bl_terminal_pendencies(v_bl.id);
      v_entry := jsonb_build_object('bl_id', v_bl.id, 'invoices', v_invoices, 'before_brl', v_before,
        'after_brl', CASE WHEN v_quote->>'status' IN ('ok', 'exempt') THEN (v_quote->>'total_brl')::numeric END,
        'status', CASE WHEN cardinality(v_block) > 0 THEN 'blocked' WHEN v_quote->>'status' IN ('ok', 'exempt') THEN 'ok' ELSE 'review' END,
        'reason', coalesce(nullif(array_to_string(v_block, ', '), ''), v_quote->>'reason'));
      RAISE EXCEPTION 'prévia desfeita' USING ERRCODE = 'VB381';
    EXCEPTION
      WHEN SQLSTATE 'VB381' THEN NULL;
      WHEN OTHERS THEN
        v_entry := jsonb_build_object('bl_id', v_bl.id, 'invoices', v_invoices, 'before_brl', v_before,
          'after_brl', NULL, 'status', 'error', 'reason', SQLERRM);
    END;
    v_out := v_out || jsonb_build_array(v_entry);
  END LOOP;
  RETURN v_out;
END;
$$;
REVOKE ALL ON FUNCTION public.preview_breakbulk_billing_changes(bigint, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.preview_breakbulk_billing_changes(bigint, jsonb) TO authenticated, service_role;

-- 1. Manifesto BB: B/L faturado sem confirmação mantém a cobrança.
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
    RAISE EXCEPTION 'Credenciais invalidas para importar carga solta.'
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
        'O B/L % ja esta na Viagem % e o arquivo foi importado na Viagem %. Nenhum B/L do lote foi gravado: confira a Viagem de destino ou corrija a Viagem do B/L pela ficha.',
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

-- 4. Correção que não pode reemitir não cancela.
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
    ELSIF cardinality(public.check_bl_terminal_pendencies(v_bl_id)) > 0 THEN
      -- 381 (ADR 0094, B5): a reemissão não sairia (B/L misto com terminais
      -- em conflito): a fatura não é cancelada; o alerta avisa e a correção
      -- fica pendente para "Tentar aplicar correção".
      FOR v_id IN SELECT unnest(v_invoices) LOOP
        PERFORM public.upsert_alert_item('fatura_desatualizada', 'invoice', v_id::text,
          'A correção do B/L ' || v_bl_id || ' não reemitiu a fatura: a nova emissão sairia bloqueada ('
            || array_to_string(public.check_bl_terminal_pendencies(v_bl_id), ', ')
            || '). A fatura continua valendo; resolva a pendência e use Tentar aplicar correção.',
          p_source, 'administrativo',
          jsonb_build_object('bl_id', v_bl_id, 'invoice_id', v_id, 'auto_reissue', 'blocked',
            'reason', array_to_string(public.check_bl_terminal_pendencies(v_bl_id), ', ')),
          '/taxas-locais?invoice=' || v_id);
      END LOOP;
      v_results := v_results || jsonb_build_object('bl_id', v_bl_id, 'status', 'blocked_review',
        'pending_reason', array_to_string(public.check_bl_terminal_pendencies(v_bl_id), ', '));
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

CREATE OR REPLACE FUNCTION public.process_invoice_basis_changes()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_map jsonb; v_changed text[] := ARRAY[]::text[]; v_id text; v_result jsonb := '[]'::jsonb; v_source text;
BEGIN
  IF current_setting('vela.invoice_basis_running', true) = 'on' THEN RETURN '[]'::jsonb; END IF;
  v_map := coalesce(nullif(current_setting('vela.invoice_basis_before', true), ''), '{}')::jsonb;
  IF v_map = '{}'::jsonb THEN RETURN '[]'::jsonb; END IF;
  PERFORM set_config('vela.invoice_basis_before', '{}', true);
  v_source := coalesce(nullif(current_setting('vela.invoice_basis_source', true), ''), 'bl_correction');
  FOR v_id IN SELECT jsonb_object_keys(v_map) ORDER BY 1 LOOP
    IF v_map->v_id IS DISTINCT FROM public.bl_invoice_basis_snapshot(v_id) THEN v_changed := v_changed || v_id; END IF;
  END LOOP;
  IF cardinality(v_changed) = 0 THEN RETURN '[]'::jsonb; END IF;

  PERFORM set_config('vela.invoice_basis_running', 'on', true);
  BEGIN
    v_result := public.apply_invoice_basis_changes(v_changed, v_source);
    -- 381: a correção que não reemitiu (bloqueio de revisão) fica pendente.
    DELETE FROM public.invoice_basis_pending_changes WHERE bl_id = ANY(v_changed)
      AND bl_id NOT IN (SELECT r->>'bl_id' FROM jsonb_array_elements(v_result) r WHERE r->>'status' = 'blocked_review');
    INSERT INTO public.invoice_basis_pending_changes(bl_id, source, error_message)
    SELECT r->>'bl_id', v_source, 'Reemissão bloqueada: ' || coalesce(r->>'pending_reason', 'pendência de revisão')
    FROM jsonb_array_elements(v_result) r WHERE r->>'status' = 'blocked_review'
    ON CONFLICT (bl_id) DO UPDATE SET source = excluded.source, error_message = excluded.error_message, updated_at = now();
  EXCEPTION WHEN OTHERS THEN
    -- A correção do B/L não é desfeita por falha financeira: o alerta explica.
    FOREACH v_id IN ARRAY v_changed LOOP
      INSERT INTO public.invoice_basis_pending_changes(bl_id, source, error_message, cod_adjustment_id)
        VALUES (v_id, v_source, SQLERRM,
          nullif(coalesce(nullif(current_setting('vela.cod_basis_events', true), ''), '{}')::jsonb->>v_id, '')::bigint) ON CONFLICT (bl_id) DO UPDATE
        SET source = excluded.source, error_message = excluded.error_message,
          cod_adjustment_id = coalesce(excluded.cod_adjustment_id, invoice_basis_pending_changes.cod_adjustment_id), updated_at = now();
      PERFORM public.alert_stale_invoice_for_bl(v_id, v_source);
    END LOOP;
    v_result := jsonb_build_array(jsonb_build_object('status', 'error', 'bl_ids', to_jsonb(v_changed), 'message', SQLERRM));
  END;
  PERFORM set_config('vela.invoice_basis_running', 'off', true);
  RETURN v_result;
END;
$function$;
