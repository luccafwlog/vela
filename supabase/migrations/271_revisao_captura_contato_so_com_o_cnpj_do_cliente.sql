-- 271: o vínculo de Cliente pela Revisão só captura o e-mail do manifesto
-- quando o CNPJ do documento é o do Cliente (decisão do dono de 2026-10-15 na
-- revisão da PR 954; item B28; ADR 0064, item 6).
--
-- Problema: "Vincular cliente ao grupo" e o vínculo de um B/L na Revisão
-- gravam por `save_bl_review`, cujo corpo (`save_bl_review_legacy_070`, o da
-- migration 002 renomeado na 070) capturava o e-mail do manifesto como contato
-- do Cliente escolhido sem comparar o CNPJ. Exemplo: o B/L traz o CNPJ e o
-- e-mail da trading ABC, o operador vincula ao Cliente XYZ apesar do aviso de
-- CNPJ divergente, e financeiro@abc passava a receber o Comunicado de CE e
-- Taxas e as cobranças de XYZ. A importação já seguia a regra M14 (migrations
-- 175 e 194): o e-mail do arquivo só vira contato do Cliente cujo CNPJ é o do
-- arquivo.
--
-- Mudança: a mesma regra M14 vale na Revisão, comparando o CNPJ do manifesto
-- gravado no B/L (`manifest_customer_cnpj_cpf`) com o do Cliente pela mesma
-- normalização (`normalize_document_text`). O corpo é a definição vigente
-- (`pg_get_functiondef` do replay), só com essa condição.
--
-- Só redefine uma função; não reescreve nem apaga linhas.
-- Rollback: reaplicar o corpo sem a condição (captura incondicional).

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
    RAISE EXCEPTION 'Usuario sem permissao ativa para revisar B/L.'
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

REVOKE ALL ON FUNCTION public.save_bl_review_legacy_070(text, timestamptz, jsonb, jsonb, uuid) FROM PUBLIC, anon, authenticated;
