-- 393 — Arquivo de B/L: rolagem só pela exclusão na Viagem antiga.
--
-- Decisão do responsável (2026-10-21, ADR 0095 decisão 5): o número do B/L é
-- único no sistema e o B/L cancelado continua com ele, então cancelar na
-- Viagem antiga não libera a importação na nova. A recusa de B/L ativo em
-- outra Viagem passa a mandar excluir, como já fazia para o cancelado. Só
-- redefine `import_bl_freight_file_atomic` (corpo da 392 com a mensagem nova).

CREATE OR REPLACE FUNCTION public.import_bl_freight_file_atomic(p_bls jsonb, p_changed_by uuid, p_batch jsonb DEFAULT NULL::jsonb)
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
    RAISE EXCEPTION 'Usuario sem permissao ativa.' USING ERRCODE = '42501';
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
