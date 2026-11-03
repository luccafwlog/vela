-- 574: decisões do dono de 2026-11-03, depois da revisão do Manual do Operador
-- (PRs luccafwlog/vela#1183 a #1185). Cada bloco abaixo traz o seu próprio
-- cabeçalho com o que muda, por quê e o rollback:
--   a. Revisão de B/L faturado com a carga alterada (decisão 1) e cancelar B/L
--      sem CE Mercante (decisão 4);
--   b. consulta de Pix parada também com o QR estático (decisão 2);
--   c. alertas do ADR de Viagem cancelada (decisão 3);
--   d. disputa fora da vez do Cliente e recusa do Desbloqueio de CE exportado
--      (decisões 8 e 10);
--   e. "Disputa" nas recusas e textos do servidor com acento (decisões 11 e 13).
--
-- Data status: o bloco c fecha alertas já abertos de Viagens canceladas, isto
-- é, grava linhas existentes. Isso se apoia no "Data status" do AGENTS.md
-- (asserted 2026-09-18): a produção não tem dados reais de negócio e toda
-- linha é fixture de teste.

-- a. Revisão do B/L faturado com carga alterada e Cancelar B/L sem CE.
--
-- Decisões do dono de 2026-11-03 (depois da revisão do Manual do Operador):
--
-- 1. B/L faturado ou pago (bls.financial_status 'invoiced' ou 'paid') que
--    voltou à Revisão com a retenção "Carga … após faturamento" (gravada por
--    _recalculate_bl_cargo_mode e trg_sync_bl_weight_cargo_mode) não sai da
--    Revisão por Salvar revisão: antes, a legada o marcava Revisado e a tela
--    dizia "fatura emitida automaticamente", com a fatura antiga.
--    - save_bl_review: recusa (P0003, a trava pós-faturamento que a ficha e o
--      tradutor de erros já mostram) a gravação desse B/L que não muda nenhum
--      dado, com a orientação: correção automática; travada, Tentar aplicar
--      correção ou, com a diferença em fatura avulsa, Resolver com
--      justificativa (ADR 0077; Faturamento, "Correção após emissão").
--    - save_bl_review_legacy_070: a gravação que muda dado é correção do B/L
--      (ADR 0077, item 2) e passa, mas o B/L fica Pendente enquanto a retenção
--      existir, inclusive a que a própria gravação acendeu; a retenção volta
--      em `pendencias` (não na linha técnica das notas). Assim a correção no
--      fim da transação a limpa (_clear_post_billing_hold exige Pendente).
--    - resolve_stale_invoice: resolver a Fatura desatualizada com justificativa
--      também tira da Revisão os B/Ls da fatura retidos por essa trava, como a
--      reemissão e o abatimento já faziam; sem isso, o B/L pago com valor
--      maior ficaria na Revisão para sempre.
-- 4. cancel_bl recusa o B/L sem CE Mercante (22023, como as outras recusas de
--    negócio da função), também na prévia: "B/L <nº> sem CE Mercante não se
--    cancela: exclua-o na lista de B/Ls." Nenhuma função, rotina ou Edge
--    Function chama cancel_bl; a tela só oferece Cancelar B/L com CE.
--    Exceção: o B/L sem CE cuja exclusão é travada (bl_delete_lock_reasons:
--    fatura, mesmo cancelada, recebível com baixa ou Invoice de Demurrage)
--    continua cancelável; sem ela, o B/L com CE removido depois de cancelar
--    a fatura não teria saída (nem excluir nem cancelar).
--
-- Cada função parte da definição vigente (pg_get_functiondef no Postgres local
-- com a cadeia até a 573); assinatura, SECURITY DEFINER, search_path e grants
-- ficam iguais. Nenhum texto trocado é comparado por outro código.
-- Só redefine funções; não grava nem reescreve linhas.
-- Rollback: voltar save_bl_review, save_bl_review_legacy_070 e
-- resolve_stale_invoice às definições da 573, e cancel_bl à da 372.

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
  v_financial_status text;
  v_hold_reason text;
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

  SELECT updated_at, financial_status, billing_hold_reason
    INTO v_current_updated_at, v_financial_status, v_hold_reason
  FROM public.bls WHERE id = p_bl_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BL % não encontrado', p_bl_id USING ERRCODE = 'P0002';
  END IF;
  IF v_current_updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'BL % foi alterado por outro usuário; recarregue antes de salvar', p_bl_id
      USING ERRCODE = 'PT409';
  END IF;

  -- 574 (a): B/L faturado ou pago que voltou à Revisão porque a carga mudou
  -- depois da fatura só sai dela com a fatura corrigida (decisão do dono de
  -- 2026-11-03). Salvar sem mudar nenhum dado era só "tirar da fila": é
  -- recusado. Salvar com dado mudado é correção do B/L (ADR 0077, item 2) e
  -- passa, mas a legada mantém o B/L Pendente enquanto a retenção existir.
  -- ponytail: reconhece a retenção pelo texto, como _clear_post_billing_hold.
  IF v_financial_status IN ('invoiced', 'paid')
     AND v_hold_reason LIKE 'Carga % após faturamento;%'
     AND COALESCE(p_update_payload, '{}'::jsonb) - 'ce_mercante' = '{}'::jsonb THEN
    RAISE EXCEPTION 'B/L % faturado com a carga alterada depois da fatura: a revisão só termina com a fatura corrigida, e então o B/L sai da Revisão sozinho. Se a correção automática não saiu, abra a fatura pelo alerta Fatura desatualizada e use Tentar aplicar correção ou, com a diferença cobrada por fatura avulsa, Resolver com justificativa.', p_bl_id
      USING ERRCODE = 'P0003';
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
  v_post_billing_hold TEXT;
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
    RAISE EXCEPTION 'BL % não encontrado', p_bl_id USING ERRCODE = 'P0002';
  END IF;

  IF p_expected_updated_at IS NOT NULL
     AND v_current_updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'BL % foi alterado por outro usuário; recarregue antes de salvar', p_bl_id
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
    RAISE EXCEPTION 'BL % foi alterado por outro usuário; recarregue antes de salvar', p_bl_id
      USING ERRCODE = 'PT409';
  END IF;

  v_reasons := public.compute_bl_review_pendencies(p_bl_id);
  -- 574 (a): a retenção "Carga … após faturamento" do B/L faturado ou pago
  -- segura a Revisão até a fatura ser corrigida (_clear_post_billing_hold);
  -- vale também para a retenção que esta mesma gravação acendeu. Ela volta
  -- nas pendências da resposta, mas não na linha técnica das notas.
  SELECT b.billing_hold_reason INTO v_post_billing_hold
  FROM public.bls AS b
  WHERE b.id = p_bl_id
    AND b.financial_status IN ('invoiced', 'paid')
    AND b.billing_hold_reason LIKE 'Carga % após faturamento;%';
  v_status := CASE
    WHEN COALESCE(cardinality(v_reasons), 0) = 0 AND v_post_billing_hold IS NULL THEN 'reviewed'
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
    'pendencias', to_jsonb(CASE
      WHEN v_post_billing_hold IS NULL THEN COALESCE(v_reasons, ARRAY[]::text[])
      ELSE COALESCE(v_reasons, ARRAY[]::text[]) || v_post_billing_hold
    END)
  );
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
    RAISE EXCEPTION 'Sem permissão para resolver alerta.' USING ERRCODE = '42501';
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
  -- 574 (a): a diferença tratada à mão é a correção da fatura; o B/L dela
  -- retido por "Carga … após faturamento" sai da Revisão, como na reemissão.
  PERFORM public._clear_post_billing_hold(ib.bl_id)
  FROM public.invoice_bls AS ib
  WHERE ib.invoice_id = p_invoice_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.cancel_bl(p_bl_id text, p_reason text, p_dry_run boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_bl record;
  v_block text[];
  v_voided integer := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Somente o Administrativo cancela B/L.' USING ERRCODE = '42501';
  END IF;
  SELECT id, cancelled_at, ce_mercante INTO v_bl FROM public.bls WHERE id = p_bl_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L % não encontrado.', p_bl_id USING ERRCODE = 'P0002';
  END IF;
  IF v_bl.cancelled_at IS NOT NULL THEN
    RETURN jsonb_build_object('cancelled', false, 'reasons', jsonb_build_array('B/L já cancelado'));
  END IF;
  -- 574 (a): Cancelar é para o B/L com CE Mercante (ADR 0071, item 9); o B/L
  -- sem CE se exclui (decisão do dono de 2026-11-03). Vale também para a
  -- prévia (p_dry_run). Nenhuma outra função chama cancel_bl.
  -- ponytail: o B/L sem CE que a exclusão trava (fatura, ainda que cancelada,
  -- ou Invoice de Demurrage: bl_delete_lock_reasons) continua cancelável, para
  -- não ficar sem saída; ex.: CE removido depois de cancelar a fatura.
  IF NULLIF(btrim(COALESCE(v_bl.ce_mercante, '')), '') IS NULL
     AND COALESCE(cardinality(public.bl_delete_lock_reasons(p_bl_id)), 0) = 0 THEN
    RAISE EXCEPTION 'B/L % sem CE Mercante não se cancela: exclua-o na lista de B/Ls.', p_bl_id
      USING ERRCODE = '22023';
  END IF;
  v_block := public.bl_open_financial_reasons(p_bl_id);
  IF cardinality(v_block) > 0 OR p_dry_run THEN
    RETURN jsonb_build_object('cancelled', false, 'reasons', to_jsonb(v_block), 'dry_run', p_dry_run);
  END IF;
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'Informe o motivo do cancelamento.' USING ERRCODE = '22023';
  END IF;

  -- Recebível sem fatura e o cálculo que o gerou são anulados (ADR 0078).
  v_voided := public._void_unbilled_bl_receivables(p_bl_id, auth.uid(), 'Cancelamento do B/L: ' || v_reason);
  DELETE FROM public.charge_calculations AS cc
  WHERE cc.bl_id = p_bl_id
    AND NOT EXISTS (SELECT 1 FROM public.invoice_items AS ii WHERE ii.charge_calculation_id = cc.id);

  PERFORM set_config('vela.allow_bl_state', 'on', true);
  -- F-30 (372): sem linhas, o B/L não fica "calculado".
  UPDATE public.bls SET cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = v_reason,
    charge_status = 'not_calculated', billing_hold_reason = NULL
  WHERE id = p_bl_id;
  PERFORM set_config('vela.allow_bl_state', 'off', true);
  INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  VALUES ('bl', p_bl_id, 'cancelled', 'false', 'true', auth.uid(), v_reason);
  RETURN jsonb_build_object('cancelled', true, 'reasons', '[]'::jsonb);
END;
$function$;


-- b. Alerta "Consulta de Pix do Itaú parada" também com o QR estático.
--
-- Decisão do dono de 2026-11-03 (revisão do Manual do Operador): desde a
-- migration 552 (ADR 0115) o Pix do QR estático do Vela dá baixa automática
-- pela mesma consulta de recebimentos do Itaú, que a Edge itau-pix roda a cada
-- minuto com qualquer valor de app_settings.pix_provider. Até aqui o Alerta
-- crítico itau_pix_consulta_parada só abria com pix_provider = 'itau'; com
-- 'static' (caso do staging) a consulta podia parar sem aviso. Agora o Alerta
-- abre quando o checkpoint (itau_pix_polled_until) está parado há mais de 15
-- minutos ou nunca andou, com as duas chaves, e fecha quando a consulta anda.
-- Com 'itau' nada muda. A frase de "nunca rodou" perde o "com a cobrança Itaú
-- ligada" (nenhum código compara esse texto).
--
-- reconcile_itau_pix_checkpoint_alert_core_425 é a definição vigente (lida com
-- pg_get_functiondef no Postgres local com toda a cadeia até a 573) com só a
-- condição do provedor retirada e a frase ajustada; assinatura, SECURITY
-- DEFINER, search_path e grants ficam iguais. O estado devolvido continua
-- trazendo o provedor. Não grava nem apaga linha: o job
-- itau-pix-checkpoint-health (a cada 5 min) aplica a regra na próxima rodada.
--
-- Rollback: recriar a função com a definição da migration 425 (condição
-- "v_provider = 'itau' AND (...)" e a frase "A consulta de recebimentos do Itaú
-- nunca rodou com a cobrança Itaú ligada.").

CREATE OR REPLACE FUNCTION public.reconcile_itau_pix_checkpoint_alert_core_425(p_threshold interval DEFAULT '00:15:00'::interval)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_previous_role text := current_setting('request.jwt.claim.role', true);
  v_provider text;
  v_until timestamptz;
  v_minutes integer;
  v_state jsonb;
BEGIN
  SELECT pix_provider, itau_pix_polled_until INTO v_provider, v_until FROM public.app_settings WHERE id = 1;
  v_minutes := CASE WHEN v_until IS NULL THEN NULL ELSE floor(extract(epoch FROM now() - v_until) / 60)::integer END;
  v_state := jsonb_build_object('provider', v_provider, 'polled_until', v_until, 'minutes', v_minutes);
  -- Chamada pelo pg_cron, sem JWT: o Alerta exige executor autorizado.
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  -- Com 'itau' ou 'static': o Pix do QR estático também dá baixa por esta consulta (migration 552).
  IF v_until IS NULL OR now() - v_until > coalesce(p_threshold, interval '15 minutes') THEN
    PERFORM public.upsert_alert_item('itau_pix_consulta_parada', 'itau_pix_checkpoint', 'itau_pix_polled_until',
      CASE WHEN v_until IS NULL THEN 'A consulta de recebimentos do Itaú nunca rodou.'
        ELSE format('A consulta de recebimentos do Itaú não avança há %s minutos: Pix pagos depois de %s não são baixados.',
          v_minutes, to_char(v_until AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI')) END
        || ' Use o plano B (Conciliar extrato) e avise o suporte.',
      'itau-pix-checkpoint-health', 'administrativo', v_state, '/reconciliacao');
  ELSE
    PERFORM public.resolve_alert_item('itau_pix_consulta_parada', 'itau_pix_checkpoint', 'itau_pix_polled_until',
      'itau-pix-checkpoint-health', v_state);
  END IF;
  PERFORM set_config('request.jwt.claim.role', coalesce(v_previous_role, ''), true);
  RETURN v_state;
END;
$function$;


-- c. Alertas do ADR de Viagem cancelada fecham (decisão 3 do dono, 2026-11-03).
--
-- Antes: a reconciliação do ADR (reconcile_agency_report_alerts, chamada pela
-- rodada de alertas a cada 15 minutos, pelos sign-offs e pela auditoria da
-- escala) não olhava a situação da Viagem, e cancel_voyage não mexia em
-- alertas. Os alertas "ADR — departamento pendente" e "ADR — prazo vencido"
-- de uma Viagem cancelada nunca fechavam: ninguém assina ADR de Viagem
-- cancelada e ela não se exclui.
--
-- Agora:
--   1. reconcile_agency_report_alerts e reconcile_agency_report_alerts_for_scale
--      (caminho da escala sem ADR por terminal) tratam a Viagem cancelada como
--      não elegível: fecham os itens ativos (resolve_alert_item_for_department,
--      origem 'agency_report_reconcile', motivo 'voyage_cancelled', como nos
--      alertas de operação da Viagem cancelada) e não abrem item novo.
--      Reativada a Viagem, a rodada volta a avaliar normalmente e reabre o que
--      ainda valer.
--   2. cancel_voyage fecha na hora os itens ativos dos dois tipos do ADR da
--      Viagem, pelo mesmo caminho e motivo.
--   3. Dados: fecha os itens já abertos dos dois tipos em Viagens canceladas.
--
-- Grava linhas existentes (item 3: alert_items, alert_item_events, alerts).
-- Apoia-se na afirmação "Data status" do AGENTS.md (seção Gotchas): os dados
-- de produção são de teste.
--
-- Cada função é a definição vigente (pg_get_functiondef no Postgres local com
-- a cadeia até a 573) com só essa mudança; assinatura, SECURITY DEFINER,
-- search_path e grants ficam iguais.
--
-- Rollback: reaplicar as definições vigentes até a 573 de
-- reconcile_agency_report_alerts, reconcile_agency_report_alerts_for_scale e
-- cancel_voyage. Os itens fechados pelo item 3 não voltam sozinhos (a rodada só
-- reabre ADR de Viagem ativa); reabri-los exigiria reativar cada Viagem.

CREATE OR REPLACE FUNCTION public.reconcile_agency_report_alerts(p_report_id uuid, p_pending boolean DEFAULT true, p_deadline boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_report RECORD;
  v_atd DATE;
  v_atd_at TIMESTAMPTZ;
  v_atd_updated_at TIMESTAMPTZ;
  v_deadline DATE;
  v_deadline_at TIMESTAMPTZ;
  v_deadline_baseline DATE;
  v_pending_baseline TIMESTAMPTZ := TIMESTAMPTZ '2026-07-19 00:00:00+00';
  v_pending_eligible BOOLEAN := false;
  v_deadline_eligible BOOLEAN := false;
  v_omitted BOOLEAN := false;
  v_deleted BOOLEAN := false;
  v_voyage_cancelled BOOLEAN := false;
  v_entity_id TEXT;
  v_department TEXT;
  v_pending BOOLEAN;
  v_signed BOOLEAN;
  v_deadline_missed BOOLEAN;
  v_metadata JSONB;
  v_message TEXT;
  v_upsert_result JSONB;
  v_changed INTEGER := 0;
  v_created INTEGER := 0;
BEGIN
  IF NOT public.alert_actor_is_authorized() THEN RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501'; END IF;

  SELECT r.*, d.code AS terminal_code INTO v_report
  FROM public.agency_departure_reports r
  LEFT JOIN public.depots d ON d.id = r.terminal_id
  WHERE r.id = p_report_id FOR UPDATE OF r;
  IF NOT FOUND THEN RETURN jsonb_build_object('report_id', p_report_id, 'eligible', false, 'changed', 0); END IF;

  SELECT (terminal_atd AT TIME ZONE 'America/Sao_Paulo')::date, terminal_atd, updated_at INTO v_atd, v_atd_at, v_atd_updated_at
  FROM public.voyage_escala_terminal_state
  WHERE voyage_id = v_report.voyage_id AND port = upper(btrim(v_report.port)) AND terminal_id = v_report.terminal_id;

  SELECT COALESCE((SELECT a.new_value = 'true' FROM public.audit_logs a WHERE a.entity_type = 'voyage_pod_schedule' AND a.entity_id = v_report.voyage_id || '::' || upper(btrim(v_report.port)) AND a.field_name = 'omitted' ORDER BY a.changed_at DESC, a.id DESC LIMIT 1), false) INTO v_omitted;
  SELECT COALESCE((SELECT a.new_value = 'true' FROM public.audit_logs a WHERE a.entity_type = 'voyage_pod_schedule' AND a.entity_id = v_report.voyage_id || '::' || upper(btrim(v_report.port)) AND a.field_name = 'deleted' ORDER BY a.changed_at DESC, a.id DESC LIMIT 1), false) INTO v_deleted;
  -- 574: Viagem cancelada não cobra ADR; os itens abertos fecham e a rodada
  -- não os abre. Reativada, a Viagem volta a ser avaliada normalmente.
  SELECT COALESCE((SELECT v.status = 'cancelled' FROM public.voyages v WHERE v.id = v_report.voyage_id), false) INTO v_voyage_cancelled;
  SELECT captured_at::date INTO v_deadline_baseline FROM public.agency_report_pending_baselines WHERE baseline_key = 'agency_report_deadline_missed';

  v_pending_eligible := v_report.status = 'open' AND v_report.terminal_id IS NOT NULL AND v_atd IS NOT NULL AND v_atd_updated_at >= v_pending_baseline AND NOT v_omitted AND NOT v_deleted AND NOT v_voyage_cancelled AND upper(btrim(v_report.port)) LIKE 'BR%';
  v_deadline_eligible := v_report.status = 'open' AND v_report.terminal_id IS NOT NULL AND v_atd IS NOT NULL AND NOT v_omitted AND NOT v_deleted AND NOT v_voyage_cancelled AND upper(btrim(v_report.port)) LIKE 'BR%' AND (v_deadline_baseline IS NULL OR v_atd >= v_deadline_baseline);
  v_entity_id := public.agency_report_alert_entity_key(v_report.voyage_id, v_report.port, v_report.terminal_code);
  v_deadline_at := v_atd_at + interval '72 hours';
  v_deadline := (v_deadline_at AT TIME ZONE 'America/Sao_Paulo')::date;

  FOR v_department IN SELECT unnest(ARRAY['operacoes', 'documentacao', 'equipamentos']) LOOP
    v_metadata := jsonb_build_object('report_id', v_report.id, 'voyage_id', v_report.voyage_id, 'port', upper(btrim(v_report.port)), 'terminal_code', v_report.terminal_code, 'department', v_department, 'deadline_date', v_deadline, 'deadline_at', v_deadline_at)
      || CASE WHEN v_voyage_cancelled THEN jsonb_build_object('reason', 'voyage_cancelled') ELSE '{}'::jsonb END;
    IF p_pending THEN
      SELECT EXISTS (
        SELECT 1 FROM (VALUES ('datas'), ('carga_descarregada'), ('carga_carregada'), ('veiculos'), ('vazios_embarcados'), ('vazios_descarregados')) AS sections(section)
        LEFT JOIN public.agency_departure_report_signoffs so ON so.report_id = v_report.id AND so.section = sections.section
        WHERE public.agency_report_section_owner(sections.section) = v_department AND COALESCE(so.state, 'pending') = 'pending'
      ) INTO v_pending;
      v_message := 'ADR ' || upper(btrim(v_report.port)) || ' / ' || COALESCE(v_report.terminal_code, 'terminal') || ': departamento "' || public.agency_report_department_label(v_department) || '" pendente.';
      IF v_pending_eligible AND v_pending THEN
        v_upsert_result := public.upsert_alert_item('agency_report_department_pending', 'agency_departure_report', v_entity_id, v_message, 'agency_report_reconcile', v_department, v_metadata, '/viagens');
        IF COALESCE((v_upsert_result->>'created')::boolean, false) OR COALESCE((v_upsert_result->>'reopened')::boolean, false) THEN v_changed := v_changed + 1; v_created := v_created + 1; END IF;
      ELSE
        IF public.resolve_alert_item_for_department('agency_report_department_pending', 'agency_departure_report', v_entity_id, v_department, 'agency_report_reconcile', v_metadata) THEN v_changed := v_changed + 1; END IF;
      END IF;
    END IF;
    IF p_deadline THEN
      SELECT COALESCE((SELECT signed_at IS NOT NULL FROM public.agency_departure_report_department_signoffs ds WHERE ds.report_id = v_report.id AND ds.department = v_department), false) INTO v_signed;
      -- 290: ATD + 72 horas, comparado ao instante de agora.
      v_deadline_missed := v_deadline_eligible AND v_deadline_at < now() AND NOT v_signed;
      v_message := 'ADR ' || upper(btrim(v_report.port)) || ' / ' || COALESCE(v_report.terminal_code, 'terminal') || ': prazo de conclusão vencido para "' || public.agency_report_department_label(v_department) || '".';
      IF v_deadline_missed THEN
        v_upsert_result := public.upsert_alert_item('agency_report_deadline_missed', 'agency_departure_report', v_entity_id, v_message, 'agency_report_reconcile', v_department, v_metadata, '/viagens');
        IF COALESCE((v_upsert_result->>'created')::boolean, false) OR COALESCE((v_upsert_result->>'reopened')::boolean, false) THEN v_changed := v_changed + 1; v_created := v_created + 1; END IF;
      ELSE
        IF public.resolve_alert_item_for_department('agency_report_deadline_missed', 'agency_departure_report', v_entity_id, v_department, 'agency_report_reconcile', v_metadata) THEN v_changed := v_changed + 1; END IF;
      END IF;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('report_id', v_report.id, 'entity_id', v_entity_id, 'eligible', v_deadline_eligible, 'pending_eligible', v_pending_eligible, 'atd', v_atd, 'deadline_date', v_deadline, 'deadline_at', v_deadline_at, 'changed', v_changed, 'created', v_created);
END;
$function$;

CREATE OR REPLACE FUNCTION public.reconcile_agency_report_alerts_for_scale(p_voyage_id bigint, p_port text, p_atd date, p_pending_eligible boolean, p_deadline_eligible boolean, p_omitted boolean DEFAULT false, p_deleted boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_department TEXT;
  v_pending BOOLEAN;
  v_deadline_missed BOOLEAN;
  -- Caminho legado: o ATD é uma data, que vale 00:00 de Brasília.
  v_deadline_at TIMESTAMPTZ := (p_atd::timestamp AT TIME ZONE 'America/Sao_Paulo') + interval '72 hours';
  v_deadline DATE := (v_deadline_at AT TIME ZONE 'America/Sao_Paulo')::date;
  v_entity_id TEXT := public.agency_report_alert_entity_key(p_voyage_id, p_port);
  v_metadata JSONB;
  v_message TEXT;
  v_upsert_result JSONB;
  v_changed INTEGER := 0;
  v_created INTEGER := 0;
  v_voyage_cancelled BOOLEAN;
BEGIN
  IF NOT public.alert_actor_is_authorized() THEN
    RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501';
  END IF;
  IF upper(btrim(p_port)) NOT LIKE 'BR%' THEN
    RETURN jsonb_build_object('entity_id', v_entity_id, 'created', 0, 'changed', 0);
  END IF;

  -- 574: Viagem cancelada não cobra ADR (ver reconcile_agency_report_alerts).
  v_voyage_cancelled := COALESCE((SELECT v.status = 'cancelled' FROM public.voyages v WHERE v.id = p_voyage_id), false);

  FOR v_department IN SELECT unnest(ARRAY['operacoes', 'documentacao', 'equipamentos'])
  LOOP
    v_metadata := jsonb_build_object(
      'report_id', NULL,
      'voyage_id', p_voyage_id,
      'port', upper(btrim(p_port)),
      'terminal_code', NULL,
      'department', v_department,
      'deadline_date', v_deadline,
      'deadline_at', v_deadline_at
    ) || CASE WHEN v_voyage_cancelled THEN jsonb_build_object('reason', 'voyage_cancelled') ELSE '{}'::jsonb END;
    v_message := 'Departamento ' || public.agency_report_department_label(v_department) || ' pendente.';
    v_pending := p_pending_eligible AND NOT p_omitted AND NOT p_deleted AND NOT v_voyage_cancelled;
    IF v_pending THEN
      v_upsert_result := public.upsert_alert_item(
        'agency_report_department_pending', 'agency_departure_report', v_entity_id,
        v_message, 'agency_report_reconcile', v_department, v_metadata, '/viagens'
      );
      IF COALESCE((v_upsert_result->>'created')::BOOLEAN, false)
         OR COALESCE((v_upsert_result->>'reopened')::BOOLEAN, false) THEN
        v_changed := v_changed + 1;
        v_created := v_created + 1;
      END IF;
    ELSE
      IF public.resolve_alert_item_for_department(
        'agency_report_department_pending', 'agency_departure_report', v_entity_id,
        v_department, 'agency_report_reconcile', v_metadata
      ) THEN
        v_changed := v_changed + 1;
      END IF;
    END IF;

    v_deadline_missed := p_deadline_eligible AND NOT p_omitted AND NOT p_deleted AND NOT v_voyage_cancelled
      AND v_deadline_at < now();
    v_message := 'Prazo de conclusão vencido para o departamento ' || public.agency_report_department_label(v_department) || '.';
    IF v_deadline_missed THEN
      v_upsert_result := public.upsert_alert_item(
        'agency_report_deadline_missed', 'agency_departure_report', v_entity_id,
        v_message, 'agency_report_reconcile', v_department, v_metadata, '/viagens'
      );
      IF COALESCE((v_upsert_result->>'created')::BOOLEAN, false)
         OR COALESCE((v_upsert_result->>'reopened')::BOOLEAN, false) THEN
        v_changed := v_changed + 1;
        v_created := v_created + 1;
      END IF;
    ELSE
      IF public.resolve_alert_item_for_department(
        'agency_report_deadline_missed', 'agency_departure_report', v_entity_id,
        v_department, 'agency_report_reconcile', v_metadata
      ) THEN
        v_changed := v_changed + 1;
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('entity_id', v_entity_id, 'created', v_created, 'changed', v_changed);
END;
$function$;

CREATE OR REPLACE FUNCTION public.cancel_voyage(p_voyage_id bigint, p_reason text, p_changed_by uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_old_status text; v_blocking text; v_bl text; v_voided integer := 0; v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), ''); v_closed integer := 0; v_adr_item record;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin() OR p_changed_by IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'Somente o Administrativo cancela viagem.' USING ERRCODE = '42501'; END IF;
  IF v_reason IS NULL THEN RAISE EXCEPTION 'Informe o motivo do cancelamento.' USING ERRCODE = '22023'; END IF;
  SELECT status INTO v_old_status FROM public.voyages WHERE id = p_voyage_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Viagem % não encontrada.', p_voyage_id USING ERRCODE = 'P0002'; END IF;
  IF v_old_status = 'cancelled' THEN RETURN jsonb_build_object('voyage_id', p_voyage_id, 'status', 'cancelled', 'changed', false); END IF;
  -- ADR 0093, decisão 14 (363): com fatura viva ou baixa em algum B/L, o
  -- Administrativo resolve cada B/L antes.
  SELECT string_agg(DISTINCT x.bl_id || ' (' || x.what || ')', ', ' ORDER BY x.bl_id || ' (' || x.what || ')') INTO v_blocking FROM (
    SELECT b.id AS bl_id, 'fatura ' || coalesce(i.invoice_number, i.id::text) AS what
    FROM public.bls b
    JOIN public.invoices i ON i.bl_id = b.id OR EXISTS (SELECT 1 FROM public.invoice_bls ib WHERE ib.invoice_id = i.id AND ib.bl_id = b.id)
      OR EXISTS (SELECT 1 FROM public.invoice_receivable_links l WHERE l.invoice_id = i.id AND l.bl_id = b.id AND l.status <> 'obsolete')
    WHERE b.voyage_id = p_voyage_id AND coalesce(i.status, 'issued') NOT IN ('cancelled', 'obsolete')
    UNION ALL
    SELECT b.id, 'Invoice de Demurrage ' || coalesce(d.doc_number, d.id::text)
    FROM public.bls b JOIN public.demurrage_invoices d ON d.bl_id = b.id
    WHERE b.voyage_id = p_voyage_id AND coalesce(d.status, 'issued') NOT IN ('cancelled')
    UNION ALL
    SELECT r.bl_id, 'baixa no recebível'
    FROM public.bl_receivables r JOIN public.bls b ON b.id = r.bl_id
    WHERE b.voyage_id = p_voyage_id AND (r.settled_amount_brl > 0 OR EXISTS (SELECT 1 FROM public.ledger_settlements s WHERE s.receivable_id = r.id))
  ) x;
  IF v_blocking IS NOT NULL THEN
    RAISE EXCEPTION 'A Viagem tem fatura viva ou baixa: %. Resolva cada B/L antes de cancelar a Viagem.', v_blocking
      USING ERRCODE = '22023';
  END IF;

  -- Recebíveis sem fatura saem do saldo.
  FOR v_bl IN SELECT b.id FROM public.bls b WHERE b.voyage_id = p_voyage_id ORDER BY b.id LOOP
    v_voided := v_voided + public._void_unbilled_bl_receivables(v_bl, p_changed_by, 'Cancelamento da Viagem: ' || v_reason);
  END LOOP;

  PERFORM set_config('vela.allow_voyage_cancel', 'on', true);
  UPDATE public.voyages SET status = 'cancelled' WHERE id = p_voyage_id;
  INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  VALUES ('voyages', p_voyage_id::text, 'status', v_old_status, 'cancelled', p_changed_by, 'Cancelamento de viagem: ' || v_reason);

  UPDATE public.import_pending_effects AS e
     SET status = 'superseded', lease_until = NULL, leased_by = NULL,
         result = COALESCE(e.result, '{}'::jsonb) || jsonb_build_object('reason', 'voyage_cancelled', 'voyage_id', p_voyage_id),
         updated_at = now()
   WHERE e.status IN ('pending', 'retry_wait')
     AND public._import_effect_voyage_id(e.effect_kind, e.entity_id) = p_voyage_id;
  GET DIAGNOSTICS v_closed = ROW_COUNT;

  -- 574: os alertas do ADR da Viagem (ADR — departamento pendente e ADR —
  -- prazo vencido, por terminal e da escala antiga) fecham com o cancelamento,
  -- pelo mesmo caminho e motivo da reconciliação do ADR.
  FOR v_adr_item IN
    SELECT DISTINCT i.item_type, a.entity_id, i.department
    FROM public.alerts a
    JOIN public.alert_items i ON i.alert_id = a.id
    WHERE a.entity_type = 'agency_departure_report'
      AND a.entity_id LIKE p_voyage_id::text || '::%'
      AND i.item_type IN ('agency_report_department_pending', 'agency_report_deadline_missed')
      AND i.status = 'active'
      AND i.department IS NOT NULL
  LOOP
    PERFORM public.resolve_alert_item_for_department(v_adr_item.item_type, 'agency_departure_report', v_adr_item.entity_id,
      v_adr_item.department, 'agency_report_reconcile', jsonb_build_object('reason', 'voyage_cancelled', 'voyage_id', p_voyage_id));
  END LOOP;

  RETURN jsonb_build_object('voyage_id', p_voyage_id, 'status', 'cancelled', 'changed', true, 'closed_effects', v_closed, 'voided_receivables', v_voided);
END;
$function$;

-- Item 3: alertas do ADR já abertos em Viagens canceladas.
DO $adr_cancelada_574$
DECLARE
  v_item record;
  v_previous_role text := current_setting('request.jwt.claim.role', true);
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  FOR v_item IN
    SELECT DISTINCT i.item_type, a.entity_id, i.department, v.id AS voyage_id
    FROM public.alerts a
    JOIN public.alert_items i ON i.alert_id = a.id
    JOIN public.voyages v ON a.entity_id LIKE v.id::text || '::%'
    WHERE a.entity_type = 'agency_departure_report'
      AND i.item_type IN ('agency_report_department_pending', 'agency_report_deadline_missed')
      AND i.status = 'active'
      AND i.department IS NOT NULL
      AND v.status = 'cancelled'
  LOOP
    PERFORM public.resolve_alert_item_for_department(v_item.item_type, 'agency_departure_report', v_item.entity_id,
      v_item.department, 'agency_report_reconcile', jsonb_build_object('reason', 'voyage_cancelled', 'voyage_id', v_item.voyage_id));
  END LOOP;
  PERFORM set_config('request.jwt.claim.role', coalesce(v_previous_role, ''), true);
END;
$adr_cancelada_574$;


-- d. Duas recusas do servidor com o texto que a tela usa (decisões 8 e 10 do
-- dono, 2026-11-03).
--
-- 1. public.portal_add_dispute_message: fora da vez do Cliente, a recusa
--    "Aguarde a resposta de Equipamentos." passa a "Aguarde a resposta da
--    Equipe de Containers.", o nome que a conversa do Portal dá à equipe. A
--    tela do Portal agora desliga o campo e o envio fora da vez, então a
--    recusa só aparece em corrida (duas abas, conversa desatualizada).
-- 2. ce_unlock_private.command (ação cancel, no Vela): a recusa "Pedido com
--    B/L já exportado para a ZPT: confirme o tratamento externo antes de
--    cancelar" mandava uma ação que não existe; passa ao texto da janela da
--    solicitação, "A solicitação não pode ser cancelada depois de exportada
--    para a ZPT.". A recusa do Portal no mesmo ponto ("Pedido não pode ser
--    cancelado pelo cliente. Contate a agência.") não muda.
--
-- Cada função é a definição vigente (pg_get_functiondef no Postgres local com
-- a cadeia até a 573) com só o texto trocado; lógica, ERRCODE, assinatura,
-- SECURITY DEFINER, search_path e grants ficam iguais (CREATE OR REPLACE
-- preserva os grants). Nenhum código compara os textos antigos (conferido em
-- src/, supabase/functions/ e no corpo das funções; só testes de banco, que
-- foram ajustados).
--
-- Só redefine funções; não grava nem reescreve linhas.
-- Rollback: recolocar os dois textos antigos nas mesmas funções.

CREATE OR REPLACE FUNCTION public.portal_add_dispute_message(p_demurrage_invoice_id bigint, p_body text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_customer_id BIGINT := public.current_portal_customer_id();
  v_invoice RECORD;
  v_dispute RECORD;
  v_dispute_id BIGINT;
  v_message_id BIGINT;
BEGIN
  IF NULLIF(btrim(p_body), '') IS NULL THEN RAISE EXCEPTION 'Informe a mensagem da disputa.' USING ERRCODE = '22023'; END IF;
  PERFORM public.check_portal_rate_limit('open_dispute', 3, 30);
  -- Mesmo recorte de _portal_list_demurrage_invoices_core (auditoria run-2).
  SELECT id, customer_id, doc_number, status INTO v_invoice
  FROM public.demurrage_invoices
  WHERE id = p_demurrage_invoice_id AND customer_id = v_customer_id
    AND status IN ('issued', 'overdue', 'paid')
    AND public.bl_has_portal_release(bl_id)
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Fatura de demurrage não encontrada.' USING ERRCODE = 'P0002'; END IF;

  SELECT * INTO v_dispute
  FROM public.demurrage_disputes
  WHERE demurrage_invoice_id = v_invoice.id AND customer_id = v_customer_id AND state = 'aberta'
  ORDER BY id DESC LIMIT 1 FOR UPDATE;
  -- Fatura paga não abre Disputa nova (434); a conversa já aberta segue.
  IF v_dispute.id IS NULL AND v_invoice.status = 'paid' THEN
    RAISE EXCEPTION 'Fatura de demurrage paga não aceita nova disputa.' USING ERRCODE = '22023';
  END IF;
  -- 520 (ADR 0112, D17): uma conversa por Invoice. Depois de resolvida, o
  -- Cliente contesta de novo só pela reabertura, que Equipamentos decide.
  IF v_dispute.id IS NULL AND EXISTS (
    SELECT 1 FROM public.demurrage_disputes
     WHERE demurrage_invoice_id = v_invoice.id AND customer_id = v_customer_id AND state = 'resolvida'
  ) THEN
    RAISE EXCEPTION 'Esta Invoice já teve uma disputa resolvida. Para contestar de novo, use Solicitar reabertura na conversa da disputa.' USING ERRCODE = '22023';
  END IF;
  IF v_dispute.id IS NOT NULL AND v_dispute.next_responder <> 'cliente' THEN
    RAISE EXCEPTION 'Aguarde a resposta da Equipe de Containers.' USING ERRCODE = '42501';
  END IF;
  v_dispute_id := COALESCE(v_dispute.id, public.ensure_demurrage_dispute(v_invoice.id, v_customer_id, 'cliente', NULL));

  INSERT INTO public.demurrage_dispute_messages(dispute_id, author_id, author_type, body, next_responder, metadata)
  VALUES (v_dispute_id, auth.uid(), 'cliente', btrim(p_body), 'equipamentos', jsonb_build_object('channel', 'portal'))
  RETURNING id INTO v_message_id;
  UPDATE public.demurrage_disputes SET state = 'aberta', next_responder = 'equipamentos', resolved_at = NULL, cancelled_at = NULL WHERE id = v_dispute_id;
  UPDATE public.demurrage_invoices SET dispute_open = true, dispute_status = 'aberto', dispute_reason = COALESCE(dispute_reason, btrim(p_body)) WHERE id = v_invoice.id;
  INSERT INTO public.portal_notifications(customer_id, bl_id, type, title, message, link)
  SELECT v_customer_id, NULL, 'dispute_opened', 'Disputa registrada', 'Sua disputa de demurrage foi registrada.', '/portal/billing?tab=demurrage&disputas=1&disputa=' || v_dispute_id
  WHERE NOT EXISTS (
    SELECT 1 FROM public.portal_notifications n
    WHERE n.customer_id = v_customer_id AND n.type = 'dispute_opened'
      AND n.created_at > now() - interval '30 minutes'
      AND n.message = 'Sua disputa de demurrage foi registrada.'
  );
  PERFORM public.block521_upsert_alert('portal_dispute_opened', 'demurrage_invoice', v_invoice.id::text,
    'Cliente enviou mensagem na Disputa ' || v_invoice.doc_number || '; resposta de Equipamentos pendente.',
    'portal_dispute_message', 'equipamentos', jsonb_build_object('dispute_id', v_dispute_id, 'message_id', v_message_id),
    '/demurrage?dispute=' || v_dispute_id);
  RETURN jsonb_build_object('dispute_id', v_dispute_id, 'message_id', v_message_id);
END;
$function$;

CREATE OR REPLACE FUNCTION ce_unlock_private.command(p_action text, p_payload jsonb, p_portal boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE cid bigint; r public.ce_unlock_requests; old_ids uuid[]; q record; d public.ce_unlock_documents; bid text; ids text[]; v jsonb; result jsonb; rid uuid; ev_reason text;
 key uuid; saved ce_unlock_private.receipts; v_version bigint; delivery public.ce_unlock_bl_deliveries; t uuid; p uuid; ex public.ce_unlock_exports; item jsonb;
BEGIN
 IF p_portal THEN cid:=public.current_portal_customer_id(); IF p_action NOT IN('draft','submit','cancel') THEN RAISE EXCEPTION '42501: Ação não autorizada.' USING ERRCODE='42501'; END IF;
 ELSE PERFORM ce_unlock_private.actor(true); END IF;
 key:=(p_payload->>'request_key')::uuid; IF key IS NULL THEN RAISE EXCEPTION 'Chave de operação obrigatória'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_action||key::text,0));
 SELECT * INTO saved FROM ce_unlock_private.receipts WHERE actor_id=auth.uid() AND action=p_action AND request_key=key;
 IF saved.actor_id IS NOT NULL THEN
   IF saved.payload<>p_payload THEN RAISE EXCEPTION 'Chave já utilizada para outra operação'; END IF;
   IF p_portal AND jsonb_typeof(saved.result->'events')='array' THEN
     RETURN jsonb_set(saved.result,'{events}',coalesce((
       SELECT jsonb_agg(CASE WHEN event->>'action'='confirm' THEN event||jsonb_build_object('reason',NULL) ELSE event END ORDER BY position)
       FROM jsonb_array_elements(saved.result->'events') WITH ORDINALITY AS events(event,position)
     ),'[]'::jsonb));
   END IF;
   RETURN saved.result;
 END IF;
 IF p_payload ? 'request_id' THEN
 SELECT * INTO r FROM public.ce_unlock_requests WHERE id=(p_payload->>'request_id')::uuid AND (NOT p_portal OR customer_id=cid) FOR UPDATE;
 IF r.id IS NULL THEN RAISE EXCEPTION '42501: Solicitação não autorizada.' USING ERRCODE='42501'; END IF;
 IF r.version IS DISTINCT FROM (p_payload->>'expected_version')::bigint THEN RAISE EXCEPTION 'Solicitação alterada; atualize a página.' USING ERRCODE='40001'; END IF;
 cid:=r.customer_id;
 ELSE cid:=coalesce(cid,(p_payload->>'customer_id')::bigint); END IF;
 -- O Portal só rascunha B/L próprio e liberado: confere antes de travar
 -- solicitações e B/Ls (a conferência sob trava, abaixo, continua valendo).
 IF p_portal AND p_action='draft' AND EXISTS(SELECT 1 FROM jsonb_array_elements_text(coalesce(p_payload->'bl_ids','[]'::jsonb)) x(bl_id)
   WHERE NOT EXISTS(SELECT 1 FROM public.bls b WHERE b.id=x.bl_id AND b.customer_id=cid AND public.bl_has_portal_release(b.id))) THEN
   RAISE EXCEPTION '42501: B/L não autorizado.' USING ERRCODE='42501';
 END IF;
 -- 299: o B/L pode sair de outra solicitação ainda não validada (caminho A).
 -- Pedido antes do Cliente e do B/L, a mesma ordem dos demais comandos.
 IF p_action='draft' THEN
 PERFORM 1 FROM public.ce_unlock_requests WHERE id IN(SELECT x.request_id FROM public.ce_unlock_request_bls x
 WHERE x.active AND x.bl_id IN(SELECT jsonb_array_elements_text(p_payload->'bl_ids'))) ORDER BY id FOR UPDATE;
 SELECT array_agg(DISTINCT x.request_id) INTO old_ids FROM public.ce_unlock_request_bls x
 WHERE x.active AND x.bl_id IN(SELECT jsonb_array_elements_text(p_payload->'bl_ids'));
 END IF;
 IF cid IS NOT NULL THEN PERFORM 1 FROM public.customers WHERE id=cid FOR NO KEY UPDATE; END IF;
 CASE p_action
 WHEN 'draft' THEN
 SELECT array_agg(DISTINCT value ORDER BY value) INTO ids FROM jsonb_array_elements_text(p_payload->'bl_ids');
 IF coalesce(cardinality(ids),0) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Selecione de 1 a 100 B/Ls'; END IF;
 PERFORM 1 FROM public.bls WHERE id=ANY(ids) ORDER BY id FOR UPDATE;
 FOREACH bid IN ARRAY ids LOOP
 IF NOT EXISTS(SELECT 1 FROM public.bls WHERE id=bid AND customer_id=cid AND public.bl_has_portal_release(id)) THEN RAISE EXCEPTION '42501: B/L não autorizado.' USING ERRCODE='42501'; END IF;
 item:=ce_unlock_private.item(bid);
 IF NOT (item->>'can_submit')::boolean THEN RAISE EXCEPTION 'B/L % não pode ser solicitado: %',bid,item->'reasons'; END IF;
 END LOOP;
 -- 449: VIP usa os anuais só se eles cobrem todos os B/Ls (importados no Vela
 -- dentro da vigência); senão o pedido segue com termo e procuração dele.
 INSERT INTO public.ce_unlock_requests(customer_id,source,created_by,model_id)
 VALUES(cid,CASE WHEN coalesce((SELECT enabled FROM public.ce_unlock_vip_customers WHERE customer_id=cid),false)
 AND NOT EXISTS(SELECT 1 FROM unnest(ids) x(bl_id) WHERE ce_unlock_private.annual_for_bl(cid,'termo',x.bl_id) IS NULL OR ce_unlock_private.annual_for_bl(cid,'procuracao',x.bl_id) IS NULL)
 THEN 'vip_annual' ELSE 'request' END,auth.uid(),
 (SELECT id FROM public.ce_unlock_documents WHERE source='model' AND status='approved' ORDER BY created_at DESC LIMIT 1)) RETURNING * INTO r;
 -- 299: B/L de solicitação ainda não validada muda para a nova. A antiga
 -- registra a saída; sem nenhum B/L, é cancelada. Documentos não passam.
 FOR q IN SELECT x.request_id,array_agg(x.bl_id ORDER BY x.bl_id) AS bls FROM public.ce_unlock_request_bls x
 WHERE x.bl_id=ANY(ids) AND x.active GROUP BY x.request_id ORDER BY x.request_id LOOP
 IF old_ids IS NULL OR NOT q.request_id=ANY(old_ids) THEN RAISE EXCEPTION 'Solicitação alterada; atualize a página.' USING ERRCODE='40001'; END IF;
 UPDATE public.ce_unlock_request_bls SET active=false WHERE request_id=q.request_id AND bl_id=ANY(q.bls);
 INSERT INTO public.ce_unlock_events(customer_id,request_id,bl_id,action,reason,actor_id,payload)
 SELECT cid,q.request_id,moved,'bl_moved','B/L passou para a solicitação '||r.protocol,auth.uid(),jsonb_build_object('to_request',r.id,'to_protocol',r.protocol)
 FROM unnest(q.bls) AS moved;
 IF EXISTS(SELECT 1 FROM public.ce_unlock_request_bls WHERE request_id=q.request_id AND active) THEN
 UPDATE public.ce_unlock_requests SET version=version+1,updated_at=now() WHERE id=q.request_id;
 PERFORM ce_unlock_private.refresh_completion(q.request_id);
 ELSE
 UPDATE public.ce_unlock_requests SET state='cancelled',version=version+1,updated_at=now() WHERE id=q.request_id;
 INSERT INTO public.ce_unlock_events(customer_id,request_id,action,reason,actor_id,payload)
 VALUES(cid,q.request_id,'cancel','Todos os B/Ls passaram para a solicitação '||r.protocol,auth.uid(),jsonb_build_object('to_request',r.id,'to_protocol',r.protocol));
 END IF;
 END LOOP;
 INSERT INTO public.ce_unlock_request_bls(request_id,bl_id,ce_at_request) SELECT r.id,id,ce_mercante FROM public.bls WHERE id=ANY(ids);
 result:=ce_unlock_private.request_json(r.id,cid);
 WHEN 'submit' THEN
 IF r.state NOT IN('draft','changes_requested') THEN RAISE EXCEPTION 'Pedido não aceita envio'; END IF;
 PERFORM 1 FROM public.bls WHERE id IN(SELECT bl_id FROM public.ce_unlock_request_bls WHERE request_id=r.id AND active AND confirmed_at IS NULL) ORDER BY id FOR UPDATE;
 PERFORM 1 FROM public.bl_receivables WHERE bl_id IN(SELECT bl_id FROM public.ce_unlock_request_bls WHERE request_id=r.id AND active AND confirmed_at IS NULL) ORDER BY id FOR UPDATE;
 PERFORM 1 FROM public.ce_unlock_vip_customers WHERE customer_id=cid FOR UPDATE;
 PERFORM 1 FROM public.ce_unlock_documents WHERE request_id=r.id OR (customer_id=cid AND source='vip_annual') ORDER BY id FOR UPDATE;
 IF r.source='vip_annual' THEN
 IF NOT coalesce((SELECT enabled FROM public.ce_unlock_vip_customers WHERE customer_id=cid),false) THEN RAISE EXCEPTION 'Condição VIP revogada'; END IF;
 IF EXISTS(SELECT 1 FROM public.ce_unlock_request_bls x WHERE x.request_id=r.id AND x.active AND x.confirmed_at IS NULL
 AND (ce_unlock_private.annual_for_bl(cid,'termo',x.bl_id) IS NULL OR ce_unlock_private.annual_for_bl(cid,'procuracao',x.bl_id) IS NULL)) THEN RAISE EXCEPTION 'Regularize os documentos anuais VIP'; END IF;
 ELSE
 SELECT id INTO t FROM public.ce_unlock_documents WHERE request_id=r.id AND type='termo' AND status<>'uploading' AND hash IS NOT NULL ORDER BY created_at DESC LIMIT 1;
 SELECT id INTO p FROM public.ce_unlock_documents WHERE request_id=r.id AND type='procuracao' AND status<>'uploading' AND hash IS NOT NULL ORDER BY created_at DESC LIMIT 1;
 IF t IS NULL OR p IS NULL OR NOT EXISTS(SELECT 1 FROM public.ce_unlock_documents WHERE id=t AND status IN('uploaded','approved') AND purged_at IS NULL AND cleanup_claimed_at IS NULL) OR NOT EXISTS(SELECT 1 FROM public.ce_unlock_documents WHERE id=p AND status IN('uploaded','approved') AND purged_at IS NULL AND cleanup_claimed_at IS NULL) THEN RAISE EXCEPTION 'Anexe versões atuais de termo de devolução e procuração'; END IF;
 END IF;
 FOR bid IN SELECT bl_id FROM public.ce_unlock_request_bls WHERE request_id=r.id AND active AND confirmed_at IS NULL LOOP
 item:=ce_unlock_private.item(bid,r.id);
 IF NOT (item->>'paid')::boolean OR NOT EXISTS(SELECT 1 FROM public.bls b WHERE b.id=bid AND b.customer_id=cid AND b.cancelled_at IS NULL AND b.ce_mercante=(SELECT ce_at_request FROM public.ce_unlock_request_bls WHERE request_id=r.id AND bl_id=bid)) THEN RAISE EXCEPTION 'B/L % perdeu elegibilidade',bid; END IF;
 END LOOP;
 -- 449: no VIP, cada B/L aponta o anual que cobre a data de importação dele.
 UPDATE public.ce_unlock_request_bls x SET
 termo_approved=CASE WHEN x.termo_document_id=CASE WHEN r.source='vip_annual' THEN ce_unlock_private.annual_for_bl(cid,'termo',x.bl_id) ELSE t END THEN x.termo_approved ELSE false END,
 procuracao_approved=CASE WHEN x.procuracao_document_id=CASE WHEN r.source='vip_annual' THEN ce_unlock_private.annual_for_bl(cid,'procuracao',x.bl_id) ELSE p END THEN x.procuracao_approved ELSE false END,
 termo_document_id=CASE WHEN r.source='vip_annual' THEN ce_unlock_private.annual_for_bl(cid,'termo',x.bl_id) ELSE t END,
 procuracao_document_id=CASE WHEN r.source='vip_annual' THEN ce_unlock_private.annual_for_bl(cid,'procuracao',x.bl_id) ELSE p END
 WHERE x.request_id=r.id AND x.active AND x.confirmed_at IS NULL;
 UPDATE public.ce_unlock_requests SET state='submitted',version=version+1,updated_at=now() WHERE id=r.id;
 -- O evento entra antes da conclusão para que o prazo (SLA) parta do envio.
 INSERT INTO public.ce_unlock_events(customer_id,request_id,action,actor_id,payload) VALUES(cid,r.id,'submit',auth.uid(),p_payload);
 PERFORM ce_unlock_private.refresh_completion(r.id);
 result:=ce_unlock_private.request_json(r.id,cid);
 INSERT INTO ce_unlock_private.receipts(actor_id,action,request_key,payload,result) VALUES(auth.uid(),p_action,key,p_payload,result);
 RETURN result;
 WHEN 'set_vip' THEN
 IF trim(coalesce(p_payload->>'reason',''))='' THEN RAISE EXCEPTION 'Motivo obrigatório'; END IF;
 INSERT INTO public.ce_unlock_vip_customers(customer_id) VALUES(cid) ON CONFLICT DO NOTHING;
 SELECT c.version INTO v_version FROM public.ce_unlock_vip_customers c WHERE customer_id=cid FOR UPDATE;
 IF p_payload ? 'expected_version' AND v_version<>(p_payload->>'expected_version')::bigint THEN RAISE EXCEPTION 'Condição VIP alterada' USING ERRCODE='40001'; END IF;
 UPDATE public.ce_unlock_vip_customers SET enabled=(p_payload->>'enabled')::boolean,version=version+1,updated_at=now() WHERE customer_id=cid;
 result:=ce_unlock_private.vip_json(cid);
 WHEN 'review' THEN
 SELECT * INTO d FROM public.ce_unlock_documents WHERE id=(p_payload->>'document_id')::uuid FOR UPDATE;
 IF d.id IS NULL OR d.status='uploading' OR d.purged_at IS NOT NULL OR d.cleanup_claimed_at IS NOT NULL THEN RAISE EXCEPTION 'Documento indisponível'; END IF;
 IF d.version IS DISTINCT FROM (p_payload->>'expected_document_version')::bigint THEN RAISE EXCEPTION 'Documento alterado; atualize a página' USING ERRCODE='40001'; END IF;
 IF p_payload->>'decision' NOT IN('approved','changes_requested','revoked') THEN RAISE EXCEPTION 'Decisão inválida'; END IF;
 IF p_payload->>'decision'<>'approved' AND trim(coalesce(p_payload->>'reason',''))='' THEN RAISE EXCEPTION 'Motivo obrigatório'; END IF;
 cid:=d.customer_id;
 IF d.source='request' THEN
 IF r.id IS DISTINCT FROM d.request_id OR r.source<>'request' OR r.state NOT IN('submitted','in_review','changes_requested','completed') THEN RAISE EXCEPTION 'Documento não pertence à análise atual'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.ce_unlock_documents z WHERE z.id=d.id AND z.created_at=(SELECT max(created_at) FROM public.ce_unlock_documents WHERE request_id=r.id AND type=d.type AND status<>'uploading' AND hash IS NOT NULL)) THEN RAISE EXCEPTION 'Documento substituído'; END IF;
 -- A decisão vale para a solicitação inteira: todos os B/Ls ainda abertos.
 SELECT array_agg(bl_id) INTO ids FROM public.ce_unlock_request_bls WHERE request_id=r.id AND active AND confirmed_at IS NULL;
 IF coalesce(cardinality(ids),0)=0 THEN RAISE EXCEPTION 'Solicitação sem B/Ls abertos'; END IF;
 IF EXISTS(SELECT 1 FROM public.ce_unlock_request_bls i WHERE i.request_id=r.id AND i.bl_id=ANY(ids) AND (CASE WHEN d.type='termo' THEN i.termo_document_id ELSE i.procuracao_document_id END) IS DISTINCT FROM d.id) THEN RAISE EXCEPTION 'Documento ainda não reenviado pelo cliente'; END IF;
 UPDATE public.ce_unlock_request_bls SET termo_approved=CASE WHEN d.type='termo' THEN p_payload->>'decision'='approved' ELSE termo_approved END,
 procuracao_approved=CASE WHEN d.type='procuracao' THEN p_payload->>'decision'='approved' ELSE procuracao_approved END
 WHERE request_id=r.id AND bl_id=ANY(ids);
 UPDATE public.ce_unlock_requests SET state=CASE WHEN p_payload->>'decision'<>'approved' OR EXISTS(SELECT 1 FROM public.ce_unlock_documents z WHERE z.request_id=r.id AND z.id<>d.id AND z.status='changes_requested' AND NOT EXISTS(SELECT 1 FROM public.ce_unlock_documents newer WHERE newer.request_id=r.id AND newer.type=z.type AND newer.status<>'uploading' AND newer.hash IS NOT NULL AND newer.created_at>z.created_at)) THEN 'changes_requested' ELSE 'in_review' END,version=version+1,updated_at=now() WHERE id=r.id;
 ELSE
 IF d.source='vip_annual' AND p_payload->>'decision'='approved' THEN
 IF d.coverage_year IS NOT NULL AND (d.coverage_year IS DISTINCT FROM (p_payload->>'coverage_year')::int OR d.valid_from IS DISTINCT FROM (p_payload->>'valid_from')::date OR d.valid_until IS DISTINCT FROM (p_payload->>'valid_until')::date) THEN RAISE EXCEPTION 'Vigência registrada é imutável; apresente novo documento para renovar'; END IF;
 IF (p_payload->>'valid_until')::date IS DISTINCT FROM make_date((p_payload->>'coverage_year')::int,12,31) OR (p_payload->>'valid_from')::date IS NULL THEN RAISE EXCEPTION 'Validade anual deve terminar em 31/12 do ano informado'; END IF;
 END IF;
 END IF;
 UPDATE public.ce_unlock_documents SET version=version+1,status=p_payload->>'decision',reason=p_payload->>'reason',reviewed_by=auth.uid(),reviewed_at=now(),
 valid_from=CASE WHEN source='vip_annual' AND p_payload->>'decision'='approved' THEN (p_payload->>'valid_from')::date ELSE valid_from END,
 valid_until=CASE WHEN source='vip_annual' AND p_payload->>'decision'='approved' THEN (p_payload->>'valid_until')::date ELSE valid_until END,
 coverage_year=CASE WHEN source='vip_annual' AND p_payload->>'decision'='approved' THEN (p_payload->>'coverage_year')::int ELSE coverage_year END WHERE id=d.id;
 IF r.id IS NOT NULL AND d.source='request' THEN
 IF p_payload->>'decision'<>'approved' THEN PERFORM ce_unlock_private.notify(r.id,'changes_requested',(CASE d.type WHEN 'termo' THEN 'Termo de devolução: ' ELSE 'Procuração: ' END)||trim(p_payload->>'reason')); END IF;
 PERFORM ce_unlock_private.refresh_completion(r.id);
 END IF;
 result:=CASE WHEN r.id IS NOT NULL THEN ce_unlock_private.request_json(r.id) ELSE ce_unlock_private.vip_json(cid) END;
 WHEN 'apply_vip' THEN
 PERFORM 1 FROM public.ce_unlock_vip_customers WHERE customer_id=cid FOR UPDATE;
 PERFORM 1 FROM public.ce_unlock_documents WHERE customer_id=cid AND source='vip_annual' ORDER BY id FOR UPDATE;
 IF r.source<>'vip_annual' OR r.state IN('cancelled','completed') OR NOT coalesce((SELECT enabled FROM public.ce_unlock_vip_customers WHERE customer_id=cid),false) THEN RAISE EXCEPTION 'Cobertura VIP indisponível'; END IF;
 IF EXISTS(SELECT 1 FROM public.ce_unlock_request_bls x WHERE x.request_id=r.id AND x.active AND x.confirmed_at IS NULL
 AND (ce_unlock_private.annual_for_bl(cid,'termo',x.bl_id) IS NULL OR ce_unlock_private.annual_for_bl(cid,'procuracao',x.bl_id) IS NULL)) THEN RAISE EXCEPTION 'Cobertura anual incompleta'; END IF;
 UPDATE public.ce_unlock_request_bls x SET termo_document_id=ce_unlock_private.annual_for_bl(cid,'termo',x.bl_id),procuracao_document_id=ce_unlock_private.annual_for_bl(cid,'procuracao',x.bl_id) WHERE x.request_id=r.id AND x.active AND x.confirmed_at IS NULL;
 UPDATE public.ce_unlock_requests SET version=version+1,updated_at=now() WHERE id=r.id;
 PERFORM ce_unlock_private.refresh_completion(r.id);
 result:=ce_unlock_private.request_json(r.id);
 WHEN 'delivery' THEN
 bid:=p_payload->>'bl_id';
 -- Mesma ordem de locks dos demais comandos: pedido antes do B/L.
 SELECT request_id INTO rid FROM public.ce_unlock_request_bls WHERE bl_id=bid AND active LIMIT 1;
 IF rid IS NOT NULL THEN PERFORM 1 FROM public.ce_unlock_requests WHERE id=rid FOR UPDATE; END IF;
 SELECT customer_id INTO cid FROM public.bls WHERE id=bid FOR UPDATE;
 IF cid IS NULL THEN RAISE EXCEPTION 'B/L não encontrado'; END IF;
 INSERT INTO public.ce_unlock_bl_deliveries(bl_id) VALUES(bid) ON CONFLICT DO NOTHING;
 SELECT * INTO delivery FROM public.ce_unlock_bl_deliveries WHERE bl_id=bid FOR UPDATE;
 IF delivery.version IS DISTINCT FROM (p_payload->>'expected_version')::bigint THEN RAISE EXCEPTION 'Entrega alterada; atualize a página' USING ERRCODE='40001'; END IF;
 IF NOT (p_payload->>'delivered')::boolean AND trim(coalesce(p_payload->>'reason',''))='' THEN RAISE EXCEPTION 'Motivo obrigatório'; END IF;
 UPDATE public.ce_unlock_bl_deliveries SET delivered=(p_payload->>'delivered')::boolean,version=version+1,updated_by=auth.uid(),updated_at=now() WHERE bl_id=bid;
 IF rid IS NOT NULL THEN PERFORM ce_unlock_private.refresh_completion(rid); END IF;
 result:=ce_unlock_private.item(bid);
 WHEN 'cancel' THEN
 IF p_portal THEN
 IF r.state NOT IN('draft','changes_requested') THEN RAISE EXCEPTION 'Pedido não pode ser cancelado pelo cliente. Contate a agência.'; END IF;
 ev_reason:=coalesce(nullif(trim(p_payload->>'reason'),''),'Cancelado pelo cliente');
 ELSE
 IF r.state='completed' THEN RAISE EXCEPTION 'Documentação validada: a solicitação não pode mais ser cancelada'; END IF;
 IF trim(coalesce(p_payload->>'reason',''))='' OR r.state='cancelled' THEN RAISE EXCEPTION 'Cancelamento exige pedido ativo e motivo'; END IF;
 END IF;
 IF EXISTS(SELECT 1 FROM public.ce_unlock_request_bls WHERE request_id=r.id AND (exported_at IS NOT NULL OR export_id IS NOT NULL)) THEN
 RAISE EXCEPTION '%',CASE WHEN p_portal THEN 'Pedido não pode ser cancelado pelo cliente. Contate a agência.' ELSE 'A solicitação não pode ser cancelada depois de exportada para a ZPT.' END; END IF;
 UPDATE public.ce_unlock_requests SET state='cancelled',version=version+1,updated_at=now() WHERE id=r.id;
 UPDATE public.ce_unlock_request_bls SET active=false WHERE request_id=r.id;
 -- Portal recebe a projeção do cliente, nunca a do desk.
 result:=ce_unlock_private.request_json(r.id,CASE WHEN p_portal THEN cid END);
 WHEN 'reconfirm_ce' THEN
 bid:=p_payload->>'bl_id'; IF trim(coalesce(p_payload->>'reason',''))='' THEN RAISE EXCEPTION 'Motivo obrigatório'; END IF;
 -- export_id fica: lembra que o B/L já foi à ZPT (trava de cancelamento); exported_at volta à fila.
 UPDATE public.ce_unlock_request_bls SET ce_at_request=(SELECT ce_mercante FROM public.bls WHERE id=bid),termo_approved=false,procuracao_approved=false,exported_at=NULL,exported_by=NULL
 WHERE request_id=r.id AND bl_id=bid AND active AND confirmed_at IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'B/L não pertence ao pedido'; END IF;
 UPDATE public.ce_unlock_requests SET version=version+1,updated_at=now() WHERE id=r.id;
 PERFORM ce_unlock_private.refresh_completion(r.id);
 result:=ce_unlock_private.request_json(r.id);
 WHEN 'export' THEN
 SELECT array_agg(DISTINCT value ORDER BY value) INTO ids FROM jsonb_array_elements_text(p_payload->'bl_ids');
 IF coalesce(cardinality(ids),0) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Seleção inválida'; END IF;
 PERFORM 1 FROM public.ce_unlock_requests WHERE id IN(SELECT request_id FROM public.ce_unlock_request_bls WHERE bl_id=ANY(ids) AND active) ORDER BY id FOR UPDATE;
 PERFORM 1 FROM public.bls WHERE id=ANY(ids) ORDER BY id FOR UPDATE;
 PERFORM 1 FROM public.bl_receivables WHERE bl_id=ANY(ids) ORDER BY id FOR UPDATE;
 PERFORM 1 FROM public.ce_unlock_vip_customers WHERE customer_id IN(SELECT customer_id FROM public.bls WHERE id=ANY(ids)) ORDER BY customer_id FOR UPDATE;
 PERFORM 1 FROM public.ce_unlock_documents WHERE id IN(SELECT termo_document_id FROM public.ce_unlock_request_bls WHERE bl_id=ANY(ids) AND active UNION SELECT procuracao_document_id FROM public.ce_unlock_request_bls WHERE bl_id=ANY(ids) AND active) ORDER BY id FOR UPDATE;
 PERFORM 1 FROM public.ce_unlock_bl_deliveries WHERE bl_id=ANY(ids) ORDER BY bl_id FOR UPDATE;
 PERFORM 1 FROM public.invoices WHERE bl_id=ANY(ids) AND invoice_type='manual' ORDER BY id FOR UPDATE;
 v:='[]'; FOREACH bid IN ARRAY ids LOOP item:=ce_unlock_private.item(bid); IF NOT coalesce((item->>'can_export')::boolean,false) THEN RAISE EXCEPTION 'B/L % não apto: %',bid,item->'reasons'; END IF; v:=v||jsonb_build_array(item || jsonb_build_object('documents',(SELECT jsonb_build_object('termo_id',i.termo_document_id,'procuracao_id',i.procuracao_document_id,'termo',ce_unlock_private.doc_json(i.termo_document_id),'procuracao',ce_unlock_private.doc_json(i.procuracao_document_id)) FROM public.ce_unlock_request_bls i WHERE i.bl_id=bid AND i.active)));  END LOOP;
 INSERT INTO public.ce_unlock_exports(layout_version,rows,snapshot,created_by,reexport_of)
 VALUES('zpt-5-v2',(SELECT jsonb_agg(jsonb_build_object('bl_id',x->>'bl_id','termo',x->'termo','procuracao',x->'procuracao','delivered',x->'delivered','paid',x->'paid')) FROM jsonb_array_elements(v) x),
 v,auth.uid(),(p_payload->>'reexport_of')::uuid) RETURNING * INTO ex;
 -- Exportar é o registro do envio à ZPT. Divergência anterior fica limpa até nova conciliação.
 UPDATE public.ce_unlock_request_bls SET exported_at=now(),exported_by=auth.uid(),export_id=ex.id WHERE bl_id=ANY(ids) AND active;
 DELETE FROM public.ce_unlock_zpt_status WHERE bl_id=ANY(ids) AND status='divergent';
 result:=to_jsonb(ex);
 bid:=NULL; -- o lote não pertence a um B/L só; os B/Ls ficam no payload do evento.
 ELSE RAISE EXCEPTION 'Ação inválida'; END CASE;
 INSERT INTO public.ce_unlock_events(customer_id,request_id,bl_id,action,reason,actor_id,payload) VALUES(cid,r.id,bid,p_action,coalesce(ev_reason,p_payload->>'reason'),auth.uid(),p_payload);
 INSERT INTO ce_unlock_private.receipts(actor_id,action,request_key,payload,result) VALUES(auth.uid(),p_action,key,p_payload,result);
 RETURN result;
END $function$;


-- e. "Disputa" nas recusas da Disputa de Demurrage e acento nos textos do
-- servidor que a pessoa ou o Cliente leem e que não são recusa.
--
-- Decisões do dono de 2026-11-03 (revisão do Manual do Operador), itens 11 e 13.
--
-- Item 11. As recusas e os avisos da Disputa de Demurrage diziam "Dispute"
-- ("Dispute não está aberta.", "A Dispute aguarda manifestação do cliente.",
-- "Apenas Equipamentos ou Administrativo pode responder a Dispute.", "…consultar
-- as Disputes.", "Mensagens de Dispute são imutáveis.", "Dispute não está
-- disponível para solicitação de reabertura."). Passam a dizer "Disputa"
-- (feminino; as frases já concordavam). O texto do Alerta de Disputa que essas
-- funções gravam também troca ("Nova resposta na Disputa; …", "Cliente
-- solicitou reabertura de uma Disputa; …"). Funções: add_demurrage_dispute_message,
-- _add_demurrage_dispute_message_impl_20260920, list_demurrage_disputes_internal,
-- _list_demurrage_disputes_internal_impl_20260920, portal_request_dispute_reopen,
-- demurrage_dispute_messages_immutable. portal_add_dispute_message ("Cliente
-- enviou mensagem na Dispute …") fica com a frente D.
--
-- Item 13. Textos gravados ou devolvidos sem acento, só a acentuação muda:
--   - motivos de revisão e observações das Taxas Locais
--     (_resolve_bl_local_charge_items_table, _calculate_bl_local_charges_impl_491,
--     guard_container_bl_without_containers): "Revisão manual obrigatória",
--     "Base de aplicação não suportada pelo motor: …", "Peso de carga solta
--     ausente; o peso conteinerizado não substitui o peso solto", "Item THD …;
--     motor só calcula standard/imo/oog", "THD … 150% de majoração",
--     "B/L container sem container vinculado para cálculo de taxas locais",
--     "Carga de veículos / LCL no destino …" (isenção pelo veículo),
--     "Linha sintética de isenção", "Pendência de revisão nas taxas locais." e
--     "Nenhuma tabela de preço ou tarifa encontrada. Adicione os preços e
--     recalcule." (motivo de bloqueio da emissão);
--   - Pode consolidar (list_consolidatable_receivables): "B/L já liquidado.",
--     "B/L já está em consolidada aberta.", "Elegível para consolidação.";
--   - avisos ao Cliente no sino do Portal: "Consolidação desfeita" / "…Os B/Ls
--     estão disponíveis para nova consolidação." (portal_obsolete_consolidation),
--     "…e seguirá em transbordo para …" (omit_voyage_escala), "…(COD), após a
--     omissão da escala de …" (set_bl_cod); e o motivo do Histórico dessas
--     duas ("Omissão de escala", "COD após omissão da escala de …", "Exceção de
--     terminal limpa por COD: …");
--   - mensagens de Alerta e motivos de fatura: Restituição pendente
--     (_sync_refund_alert), Fatura desatualizada (_try_recreate_consolidated,
--     _reproject_invoices_for_receivables, alert_stale_invoice_for_bl,
--     apply_invoice_basis_changes_legacy_130), Pix sem conciliação
--     (upsert_pix_reconciliation_exceptions, reopen_pix_reconciliation_exception),
--     motivo do cancelamento pela reemissão automática e pela carga de veículos e
--     "Não reemitida: …" (apply_invoice_basis_changes_legacy_130,
--     _run_import_effect_vehicle_followup, close_pending_reissue_on_bl_end),
--     "Substituída pela …" (_reproject_invoices_for_receivables).
--
-- Comparadores. Os textos antigos ficam gravados nas linhas já existentes e
-- nenhuma linha é reescrita. Quem compara esses textos passa a aceitar os dois:
-- _import_effect_was_business_wait reconhece "pendência de revisão",
-- "reconciliação manual", "gate de revisão" e "Tabela de cobrança incompleta"
-- com e sem acento (desde a 573 a recusa "B/L exige reconciliação manual antes
-- do faturamento." e "Ainda existem linhas com pendência de revisão" saem com
-- acento e o padrão sem acento deixava de reconhecê-las como espera de
-- negócio); na tela, o Histórico da Viagem (src/services/voyageSummaries.ts)
-- trata "Omissao de escala" e "Omissão de escala" como motivo padrão. Os demais
-- textos trocados não têm comparador (conferido em src/, supabase/functions/
-- e no corpo das funções).
--
-- Ficam sem acento, por serem chave de comparação em várias funções e na tela:
-- "Pendencias de importacao: …" (nota da Revisão), "Acesso ao portal nao
-- provisionado" e "Cliente nao vinculado" (motivos da Revisão e do bloqueio),
-- "Aguardando reconciliacao de cliente antes do faturamento.", "Cliente nao
-- encontrado na base cadastral." e "Conciliacao automatica por TXID".
--
-- Cada função é a definição vigente (pg_get_functiondef no Postgres local com
-- toda a cadeia até a 573) com só esses textos trocados; lógica, ERRCODE,
-- assinatura, SECURITY DEFINER, search_path e grants ficam iguais.
-- Só redefine funções; não grava nem reescreve linhas.
-- Rollback: desfazer só as trocas de texto em cada função (e voltar o padrão
-- de _import_effect_was_business_wait ao sem acento).

-- add_demurrage_dispute_message
CREATE OR REPLACE FUNCTION public.add_demurrage_dispute_message(p_dispute_id bigint, p_body text, p_next_responder text DEFAULT 'cliente'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF public._portal_actor_role() IS NULL OR public._portal_actor_role() NOT IN ('equipamentos', 'administrativo') THEN
    RAISE EXCEPTION 'Apenas Equipamentos ou Administrativo pode responder a Disputa.' USING ERRCODE = '42501';
  END IF;
  RETURN public._add_demurrage_dispute_message_impl_20260920(p_dispute_id, p_body, p_next_responder);
END;
$function$;

-- _add_demurrage_dispute_message_impl_20260920
CREATE OR REPLACE FUNCTION public._add_demurrage_dispute_message_impl_20260920(p_dispute_id bigint, p_body text, p_next_responder text DEFAULT 'cliente'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_role TEXT := public._portal_actor_role();
  v_dispute public.demurrage_disputes%ROWTYPE;
  v_message_id BIGINT;
  v_resolved BOOLEAN := p_next_responder = 'ninguem';
BEGIN
  IF v_role IS NULL OR v_role NOT IN ('equipamentos', 'administrativo') THEN RAISE EXCEPTION 'Apenas Equipamentos ou Administrativo pode responder a Disputa.' USING ERRCODE = '42501'; END IF;
  IF NULLIF(btrim(p_body), '') IS NULL THEN RAISE EXCEPTION 'Informe a mensagem da disputa.' USING ERRCODE = '22023'; END IF;
  IF p_next_responder NOT IN ('cliente', 'equipamentos', 'ninguem') THEN RAISE EXCEPTION 'Responsável inválido.' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_dispute FROM public.demurrage_disputes WHERE id = p_dispute_id FOR UPDATE;
  IF NOT FOUND OR v_dispute.state <> 'aberta' THEN RAISE EXCEPTION 'Disputa não está aberta.' USING ERRCODE = '42501'; END IF;
  IF v_dispute.next_responder <> 'equipamentos' THEN RAISE EXCEPTION 'A Disputa aguarda manifestação do cliente.' USING ERRCODE = '42501'; END IF;

  INSERT INTO public.demurrage_dispute_messages(dispute_id, author_id, author_type, body, next_responder, metadata)
  VALUES (p_dispute_id, auth.uid(), v_role, btrim(p_body), p_next_responder, jsonb_build_object('channel', 'internal'))
  RETURNING id INTO v_message_id;
  IF v_resolved THEN
    UPDATE public.demurrage_disputes SET state = 'resolvida', next_responder = 'ninguem', resolved_at = now() WHERE id = p_dispute_id;
    UPDATE public.demurrage_invoices SET dispute_open = false, dispute_status = 'resolvido' WHERE id = v_dispute.demurrage_invoice_id;
  ELSE
    UPDATE public.demurrage_disputes SET state = 'aberta', next_responder = p_next_responder WHERE id = p_dispute_id;
    UPDATE public.demurrage_invoices SET dispute_open = true, dispute_status = 'aberto' WHERE id = v_dispute.demurrage_invoice_id;
  END IF;
  IF p_next_responder = 'cliente' THEN
    INSERT INTO public.portal_notifications(customer_id, bl_id, type, title, message, link)
    SELECT v_dispute.customer_id, NULL, 'dispute_responded', 'Disputa respondida', CASE WHEN v_role = 'administrativo' THEN 'Administrativo respondeu à sua disputa.' ELSE 'Equipamentos respondeu à sua disputa.' END, '/portal/billing?tab=demurrage&disputas=1&disputa=' || v_dispute.id;
    PERFORM public.block521_resolve_alert('portal_dispute_opened', 'demurrage_invoice', v_dispute.demurrage_invoice_id::text, 'equipamentos', 'portal_dispute_message');
  ELSIF p_next_responder = 'equipamentos' THEN
    PERFORM public.block521_upsert_alert(
      'portal_dispute_opened', 'demurrage_invoice', v_dispute.demurrage_invoice_id::text,
      'Nova resposta na Disputa; ação de Equipamentos pendente.', 'portal_dispute_message', 'equipamentos',
      jsonb_build_object('dispute_id', p_dispute_id, 'message_id', v_message_id), '/demurrage?dispute=' || p_dispute_id
    );
  ELSE
    PERFORM public.block521_resolve_alert('portal_dispute_opened', 'demurrage_invoice', v_dispute.demurrage_invoice_id::text, 'equipamentos', 'portal_dispute_message');
  END IF;
  RETURN jsonb_build_object('dispute_id', p_dispute_id, 'message_id', v_message_id, 'state', CASE WHEN v_resolved THEN 'resolvida' ELSE 'aberta' END);
END;
$function$;

-- list_demurrage_disputes_internal
CREATE OR REPLACE FUNCTION public.list_demurrage_disputes_internal(p_state text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF public._portal_actor_role() IS NULL OR public._portal_actor_role() NOT IN ('administrativo', 'documentacao', 'financeiro', 'operacoes', 'equipamentos') THEN
    RAISE EXCEPTION 'Usuário interno ativo obrigatório para consultar as Disputas.' USING ERRCODE = '42501';
  END IF;
  RETURN public._list_demurrage_disputes_internal_impl_20260920(p_state);
END;
$function$;

-- _list_demurrage_disputes_internal_impl_20260920
CREATE OR REPLACE FUNCTION public._list_demurrage_disputes_internal_impl_20260920(p_state text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF public._portal_actor_role() IS NULL OR public._portal_actor_role() NOT IN ('administrativo', 'documentacao', 'financeiro', 'operacoes', 'equipamentos') THEN
    RAISE EXCEPTION 'Usuário interno ativo obrigatório para consultar as Disputas.' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(row_json ORDER BY waiting_us DESC, updated_at DESC)
    FROM (
      SELECT (d.state = 'aberta' AND d.next_responder = 'equipamentos') AS waiting_us, d.updated_at,
        jsonb_build_object(
          'id', d.id, 'demurrage_invoice_id', d.demurrage_invoice_id,
          'doc_number', di.doc_number, 'customer_id', d.customer_id,
          'customer_name', c.name, 'state', d.state,
          'next_responder', d.next_responder, 'subject', d.subject,
          'created_at', d.created_at, 'updated_at', d.updated_at,
          'resolved_at', d.resolved_at, 'cancelled_at', d.cancelled_at,
          'invoice_status', di.status, 'invoice_total_usd', di.total_usd,
          'invoice_discount_mode', di.discount_mode, 'invoice_discount_value', di.discount_value,
          'invoice_current_total_brl', di.current_total_brl,
          'waiting_since', w.since,
          'due_at', public._demurrage_dispute_due_at(w.since),
          'overdue', COALESCE(now() > public._demurrage_dispute_due_at(w.since), false),
          'messages', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', m.id, 'author_type', m.author_type, 'body', m.body, 'next_responder', m.next_responder, 'created_at', m.created_at, 'attachments', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', a.id, 'file_name', a.file_name, 'mime_type', a.mime_type, 'size_bytes', a.size_bytes, 'storage_path', a.storage_path) ORDER BY a.id) FROM public.demurrage_dispute_attachments a WHERE a.message_id = m.id), '[]'::jsonb)) ORDER BY m.created_at) FROM public.demurrage_dispute_messages m WHERE m.dispute_id = d.id), '[]'::jsonb)
        ) AS row_json
      FROM public.demurrage_disputes d
      JOIN public.demurrage_invoices di ON di.id = d.demurrage_invoice_id
      JOIN public.customers c ON c.id = d.customer_id
      CROSS JOIN LATERAL (SELECT public._demurrage_dispute_waiting_since(d.id) AS since) AS w
      WHERE p_state IS NULL OR d.state = p_state
    ) AS listed
  ), '[]'::jsonb);
END;
$function$;

-- portal_request_dispute_reopen
CREATE OR REPLACE FUNCTION public.portal_request_dispute_reopen(p_dispute_id bigint, p_body text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_customer_id BIGINT := public.current_portal_customer_id();
  v_dispute public.demurrage_disputes%ROWTYPE;
BEGIN
  IF NULLIF(btrim(p_body), '') IS NULL THEN RAISE EXCEPTION 'Justificativa é obrigatória.' USING ERRCODE = '22023'; END IF;
  -- Cada pedido grava mensagem imutável e Alerta: mesmo teto da abertura.
  PERFORM public.check_portal_rate_limit('dispute_reopen_request', 3, 30);
  SELECT * INTO v_dispute FROM public.demurrage_disputes WHERE id = p_dispute_id AND customer_id = v_customer_id;
  IF NOT FOUND OR v_dispute.state <> 'resolvida' THEN RAISE EXCEPTION 'Disputa não está disponível para solicitação de reabertura.' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.demurrage_dispute_messages(dispute_id, author_id, author_type, body, next_responder, metadata)
  VALUES (p_dispute_id, auth.uid(), 'cliente', btrim(p_body), 'equipamentos', jsonb_build_object('action', 'reopen_request'));
  PERFORM public.block521_upsert_alert('portal_dispute_opened', 'demurrage_invoice', v_dispute.demurrage_invoice_id::text, 'Cliente solicitou reabertura de uma Disputa; decisão de Equipamentos pendente.', 'portal_dispute_reopen_request', 'equipamentos', jsonb_build_object('dispute_id', p_dispute_id), '/demurrage?dispute=' || p_dispute_id);
END;
$function$;

-- demurrage_dispute_messages_immutable
CREATE OR REPLACE FUNCTION public.demurrage_dispute_messages_immutable()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN RAISE EXCEPTION 'Mensagens de Disputa são imutáveis.' USING ERRCODE = '42501'; END;
$function$;

-- _resolve_bl_local_charge_items_table
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
      notes := 'Revisão manual obrigatória';

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
          review_reason := 'Peso de carga solta ausente; o peso conteinerizado não substitui o peso solto';
          status := 'review_required';
          notes := 'Revisão manual obrigatória';
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
              review_reason := 'Item THD cadastrado com perfil de carga ''any''; motor só calcula standard/imo/oog';
              notes := 'Revisão manual obrigatória';
              RETURN NEXT;
              CONTINUE;
            END IF;
          ELSE
            v_qty := v_qty_total;
          END IF;
        END IF;
      ELSE
        calculation_key := CONCAT('review:unsupported_basis:', item.id);
        review_reason := CONCAT('Base de aplicação não suportada pelo motor: ', COALESCE(item.application_basis, '(vazia)'));
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
          notes := 'THD IMO e OOG: THD normal com 150% de majoração';
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
    notes := 'Revisão manual obrigatória';
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
    notes := 'Revisão manual obrigatória';
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
    notes := 'Revisão manual obrigatória';
    RETURN NEXT;
  END IF;

  RETURN;
END;
$function$;

-- _calculate_bl_local_charges_impl_491
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
    RAISE EXCEPTION 'B/L % não encontrado', p_bl_id USING ERRCODE = 'P0002';
  END IF;

  -- F-28 (372): B/L cancelado é somente leitura também para o cálculo.
  IF v_bl.cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION 'B/L % cancelado é somente leitura; reative o B/L para calcular.', p_bl_id USING ERRCODE = '22023';
  END IF;

  IF v_bl.financial_status IN ('invoiced', 'partially_paid', 'paid') THEN
    RAISE EXCEPTION 'B/L % já foi faturado (situação financeira: %): o recálculo manual não altera a fatura. Corrija os dados do B/L, que a fatura é corrigida automaticamente.', p_bl_id, public._financial_status_label(v_bl.financial_status) USING ERRCODE = '22023';
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
    v_reason := 'Carga de veículos / LCL no destino (movement_to=' || v_bl.movement_to || ') com taxas pagas na origem';

    INSERT INTO public.charge_calculations (
      bl_id, source, status, calculation_key, quantity,
      unit_value_brl, total_value_brl, notes, review_reason, created_by, calculated_at
    )
    VALUES (
      p_bl_id, 'auto', 'exempt', 'exempt:lcl_vehicle', 1,
      0, 0, 'Linha sintética de isenção', v_reason, v_actor, NOW()
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
          0, 'B/L de container sem containers cadastrados', 'Revisão manual obrigatória', v_actor, NOW()
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
        WHEN v_status = 'review_required' THEN 'Pendência de revisão nas taxas locais.'
        WHEN v_status = 'not_calculated' THEN 'Nenhuma tabela de preço ou tarifa encontrada. Adicione os preços e recalcule.'
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

-- guard_container_bl_without_containers
CREATE OR REPLACE FUNCTION public.guard_container_bl_without_containers()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_reason TEXT := 'B/L container sem container vinculado para cálculo de taxas locais';
BEGIN
  IF COALESCE(NEW.cargo_mode, 'container') = 'container'
     AND COALESCE(NEW.charge_status, 'not_calculated') IN ('calculated', 'reviewed', 'ready_for_billing')
     AND NOT EXISTS (
       SELECT 1
       FROM public.bl_containers bc
       WHERE bc.bl_id = NEW.id
         AND TRIM(COALESCE(bc.container_number, '')) <> ''
     ) THEN
    INSERT INTO public.charge_calculations (
      bl_id,
      source,
      status,
      calculation_key,
      quantity,
      total_value_brl,
      review_reason,
      notes,
      created_by,
      calculated_at
    )
    VALUES (
      NEW.id,
      'auto',
      'review_required',
      'review:no_container',
      1,
      0,
      v_reason,
      'Revisão manual obrigatória',
      auth.uid(),
      NOW()
    )
    ON CONFLICT (bl_id, calculation_key) DO UPDATE
      SET status = EXCLUDED.status,
          quantity = EXCLUDED.quantity,
          total_value_brl = EXCLUDED.total_value_brl,
          review_reason = EXCLUDED.review_reason,
          notes = EXCLUDED.notes,
          created_by = EXCLUDED.created_by,
          calculated_at = NOW();

    UPDATE public.bls
    SET
      charge_status = 'review_required',
      billing_hold_reason = v_reason
    WHERE id = NEW.id
      AND COALESCE(charge_status, 'not_calculated') <> 'review_required';
  END IF;

  RETURN NULL;
END;
$function$;

-- _import_effect_was_business_wait
CREATE OR REPLACE FUNCTION public._import_effect_was_business_wait(p_code text, p_message text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COALESCE(p_code, '') IN ('invalid_effect_payload', 'effect_domain_refused')
     AND COALESCE(p_message, '') ~* '(gate de revis[aã]o|pend[eê]ncia de revis[aã]o|reconcilia[cç][aã]o manual|cliente vinculado|Tabela de cobran[cç]a incompleta)';
$function$;

-- list_consolidatable_receivables
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
      WHEN base.receivable_status = 'settled' THEN 'B/L já liquidado.'
      WHEN base.receivable_status = 'void' THEN 'B/L sem saldo de taxas locais.'
      WHEN base.has_open_consolidated THEN 'B/L já está em consolidada aberta.'
      WHEN base.balance_brl <= 0 THEN 'B/L sem saldo aberto.'
      WHEN base.missing_ce_mercante THEN 'sem CE Mercante.'
      ELSE 'Elegível para consolidação.'
    END AS eligibility_reason
  FROM base
  ORDER BY base.voyage_id DESC NULLS LAST, base.bl_id ASC;
END;
$function$;

-- portal_obsolete_consolidation
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
  VALUES (v_customer_id, 'system', 'Consolidação desfeita',
    'A fatura ' || COALESCE(v_invoice.invoice_number, '#' || p_invoice_id) || ' foi desfeita. Os B/Ls estão disponíveis para nova consolidação.', '/portal/billing');
  RETURN jsonb_build_object('success', true, 'invoice_id', p_invoice_id);
END;
$function$;

-- omit_voyage_escala
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
    RAISE EXCEPTION 'Viagem % não encontrada', p_voyage_id USING ERRCODE = 'P0002';
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
        RAISE EXCEPTION 'A escala da viagem % já foi omitida para o POD %.', p_voyage_id, v_omitted
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
    COALESCE(NULLIF(btrim(COALESCE(p_reason, '')), ''), 'Omissão de escala')
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
      ' foi descarregada em ' || v_discharge || ' e seguirá em transbordo para ' || v_omitted || '.',
    NULL
  FROM public.bls b
  WHERE b.voyage_id = p_voyage_id
    AND upper(btrim(COALESCE(b.pod, ''))) = v_omitted
    AND b.customer_id IS NOT NULL;

  RETURN v_omission_id;
END;
$function$;

-- set_bl_cod
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
    RAISE EXCEPTION 'Transbordo do B/L % não encontrado', p_bl_id USING ERRCODE = 'P0002';
  END IF;

  SELECT pod, customer_id, terminal_id, pod_port_id
    INTO v_old_pod, v_customer, v_old_terminal, v_old_pod_port_id
  FROM public.bls
  WHERE id = p_bl_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L % não encontrado', p_bl_id USING ERRCODE = 'P0002';
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
    'COD após omissão da escala de ' || v_omitted || ': ' || v_justification);

  IF v_old_terminal IS NOT NULL OR v_old_pod_port_id IS NOT NULL THEN
    INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
    VALUES (
      'bls', p_bl_id, 'terminal_override',
      jsonb_build_object('terminal_id', v_old_terminal, 'pod_port_id', v_old_pod_port_id)::text,
      jsonb_build_object('terminal_id', NULL, 'pod_port_id', NULL)::text,
      p_changed_by,
      'Exceção de terminal limpa por COD: ' || v_justification
    );
  END IF;

  IF v_customer IS NOT NULL THEN
    INSERT INTO public.portal_notifications(customer_id, bl_id, type, title, message, link)
    VALUES (v_customer, p_bl_id, 'transshipment', 'Destino alterado (COD)',
      'A pedido, o destino final do B/L ' || p_bl_id || ' foi alterado para ' || v_discharge ||
        ' (COD), após a omissão da escala de ' || v_omitted || '.', NULL);
  END IF;
END;
$function$;

-- _sync_refund_alert
CREATE OR REPLACE FUNCTION public._sync_refund_alert(p_invoice_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_pending numeric; v_number text; v_bls text;
BEGIN
  SELECT coalesce(sum(r.amount_brl), 0) INTO v_pending FROM public.invoice_refunds r
  WHERE r.invoice_id = p_invoice_id AND r.status = 'pending';
  IF v_pending > 0 THEN
    SELECT invoice_number INTO v_number FROM public.invoices WHERE id = p_invoice_id;
    SELECT string_agg(DISTINCT br.bl_id, ', ') INTO v_bls FROM public.invoice_refunds r
      JOIN public.bl_receivables br ON br.id = r.correction_receivable_id WHERE r.invoice_id = p_invoice_id;
    PERFORM public.upsert_alert_item('restituicao_pendente', 'invoice', p_invoice_id::text,
      'Restitua R$ ' || to_char(v_pending, 'FM999G999G990D00') || ' ao Cliente: a fatura ' || coalesce(v_number, p_invoice_id::text)
        || ' tem restituição financeira pendente. Confirme a restituição quando o dinheiro for devolvido.',
      'invoice_correction', 'administrativo',
      jsonb_build_object('invoice_id', p_invoice_id, 'bl_id', v_bls, 'pending_brl', v_pending),
      '/taxas-locais?invoice=' || p_invoice_id);
  ELSE
    PERFORM public.resolve_alert_item('restituicao_pendente', 'invoice', p_invoice_id::text, 'refund_settled', '{}'::jsonb);
  END IF;
END;
$function$;

-- _try_recreate_consolidated
CREATE OR REPLACE FUNCTION public._try_recreate_consolidated(p_invoice_id bigint, p_actor uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_inv record; v_ids bigint[]; v_mismatch text; v_waiting text;
BEGIN
  SELECT * INTO v_inv FROM public.invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND OR v_inv.invoice_type IS DISTINCT FROM 'consolidated' OR v_inv.status IS DISTINCT FROM 'cancelled'
     OR v_inv.reissue_requested_at IS NULL OR v_inv.reissue_closed_at IS NOT NULL
     OR EXISTS (SELECT 1 FROM public.invoices s WHERE s.replaces_invoice_id = p_invoice_id) THEN
    RETURN 'not_pending';
  END IF;

  SELECT array_agg(l.receivable_id ORDER BY l.receivable_id) INTO v_ids
  FROM public.invoice_receivable_links l WHERE l.invoice_id = p_invoice_id;

  SELECT string_agg(x.bl_id || ': ' || x.reason, '; ' ORDER BY x.bl_id) INTO v_mismatch FROM (
    SELECT br.bl_id, CASE
      WHEN b.cancelled_at IS NOT NULL THEN 'B/L cancelado'
      -- 365: B/L que ficou isento não volta para a consolidada.
      WHEN b.charge_status = 'exempt' THEN 'B/L isento'
      WHEN br.customer_id IS DISTINCT FROM v_inv.customer_id THEN 'B/L passou para outro Cliente'
      WHEN br.status NOT IN ('open', 'partially_settled') OR br.balance_brl <= 0 THEN 'sem saldo a cobrar (quitado ou isento)'
    END AS reason
    FROM public.invoice_receivable_links l
    JOIN public.bl_receivables br ON br.id = l.receivable_id
    JOIN public.bls b ON b.id = br.bl_id
    WHERE l.invoice_id = p_invoice_id) x
  WHERE x.reason IS NOT NULL;
  IF v_mismatch IS NOT NULL THEN
    PERFORM public._close_pending_reissue(p_invoice_id, 'Consolidada não reemitida: os B/Ls já não são os mesmos (' || v_mismatch || ').');
    RETURN 'closed';
  END IF;

  SELECT string_agg(DISTINCT ib.bl_id, ', ') INTO v_waiting
  FROM public.invoice_receivable_links l
  JOIN public.invoice_bls ib ON ib.bl_id = l.bl_id
  JOIN public.invoices i ON i.id = ib.invoice_id
  WHERE l.invoice_id = p_invoice_id AND i.invoice_type = 'individual' AND i.status = 'cancelled'
    AND i.reissue_requested_at IS NOT NULL AND i.reissue_closed_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM public.invoices s WHERE s.replaces_invoice_id = i.id)
    AND NOT EXISTS (SELECT 1 FROM public.invoice_bls ib2 JOIN public.invoices i2 ON i2.id = ib2.invoice_id
      WHERE ib2.bl_id = ib.bl_id AND i2.invoice_type = 'individual'
        AND coalesce(i2.status, 'issued') IN ('draft', 'issued', 'overdue', 'partially_paid', 'paid', 'covered'));
  IF v_waiting IS NOT NULL THEN
    PERFORM public.upsert_alert_item('fatura_desatualizada', 'invoice', p_invoice_id::text,
      'Consolidada ' || v_inv.invoice_number || ' cancelada para correção; volta sozinha quando sair a fatura individual do B/L ' || v_waiting || '.',
      'invoice_reissue', 'administrativo', jsonb_build_object('invoice_id', p_invoice_id, 'bl_id', v_waiting, 'auto_reissue', 'waiting'),
      '/taxas-locais?invoice=' || p_invoice_id);
    RETURN 'waiting';
  END IF;

  IF p_actor IS NULL THEN RETURN 'pending'; END IF;
  BEGIN
    PERFORM public.create_local_consolidated_invoice_core(v_inv.customer_id, v_ids, p_actor, 'internal');
    RETURN 'reissued';
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.upsert_alert_item('fatura_desatualizada', 'invoice', p_invoice_id::text,
      'Consolidada ' || v_inv.invoice_number || ' cancelada para correção, mas a nova emissão não saiu (' || SQLERRM
        || '). Resolva o motivo e use Tentar reemitir em Reemissão pendente.',
      'invoice_reissue', 'administrativo', jsonb_build_object('invoice_id', p_invoice_id, 'auto_reissue', 'pending', 'reason', SQLERRM),
      '/taxas-locais?invoice=' || p_invoice_id);
    RETURN 'pending';
  END;
END;
$function$;

-- _reproject_invoices_for_receivables
CREATE OR REPLACE FUNCTION public._reproject_invoices_for_receivables(p_source_invoice bigint, p_receivable_ids bigint[], p_actor uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_source record;
  v_inv record;
  v_remaining bigint[];
  v_settled bigint[];
  v_balance numeric(14,2);
  v_new jsonb;
  v_new_id bigint;
  v_new_number text;
  v_covered integer := 0;
  v_obsoleted integer := 0;
  v_reissued integer := 0;
  v_updated integer := 0;
BEGIN
  SELECT id, invoice_number INTO v_source FROM public.invoices WHERE id = p_source_invoice;
  FOR v_inv IN
    SELECT DISTINCT i.id, i.invoice_type, i.invoice_number, i.customer_id, i.balance_brl
    FROM public.invoices i
    JOIN public.invoice_receivable_links l ON l.invoice_id = i.id
    WHERE l.receivable_id = ANY(coalesce(p_receivable_ids, ARRAY[]::bigint[])) AND l.status = 'active'
      AND i.id <> p_source_invoice
      AND i.invoice_type IN ('individual', 'consolidated')
      AND coalesce(i.status, 'issued') IN ('issued', 'partially_paid')
    ORDER BY i.id
  LOOP
    PERFORM 1 FROM public.invoices WHERE id = v_inv.id FOR UPDATE;
    SELECT
      coalesce(array_agg(l.receivable_id ORDER BY l.receivable_id) FILTER (WHERE r.status IN ('open', 'partially_settled') AND r.balance_brl > 0), ARRAY[]::bigint[]),
      coalesce(array_agg(l.receivable_id ORDER BY l.receivable_id) FILTER (WHERE NOT (r.status IN ('open', 'partially_settled') AND r.balance_brl > 0)), ARRAY[]::bigint[]),
      coalesce(sum(r.balance_brl) FILTER (WHERE r.status IN ('open', 'partially_settled') AND r.balance_brl > 0), 0)
    INTO v_remaining, v_settled, v_balance
    FROM public.invoice_receivable_links l
    JOIN public.bl_receivables r ON r.id = l.receivable_id
    WHERE l.invoice_id = v_inv.id AND l.status = 'active';

    IF v_inv.invoice_type = 'individual' THEN
      UPDATE public.invoice_receivable_links SET status = 'settled_elsewhere'
       WHERE invoice_id = v_inv.id AND status = 'active' AND receivable_id = ANY(v_settled);
      IF cardinality(v_remaining) = 0 THEN
        -- B/L quitado por outro documento: Coberta, sem QR (decisão 6).
        UPDATE public.invoices SET status = 'covered', covered_by_invoice_id = p_source_invoice, balance_brl = 0
         WHERE id = v_inv.id;
        INSERT INTO public.invoice_lifecycle_events (invoice_id, event_type, related_invoice_id, actor, payload)
        VALUES (v_inv.id, 'covered', p_source_invoice, p_actor,
          jsonb_build_object('reason', 'Coberta por outro documento', 'paid_invoice_id', p_source_invoice));
        v_covered := v_covered + 1;
      ELSIF v_inv.balance_brl IS DISTINCT FROM v_balance THEN
        UPDATE public.invoices SET balance_brl = v_balance WHERE id = v_inv.id;
        v_updated := v_updated + 1;
      END IF;

    ELSIF cardinality(v_settled) > 0 THEN
      -- Consolidada com B/L quitado pela individual: sai e volta sem ele
      -- (decisões 7 e 8).
      UPDATE public.invoices
         SET status = 'obsolete',
             obsolete_reason = 'B/L liquidado por invoice individual ' || coalesce(v_source.invoice_number, p_source_invoice::text)
       WHERE id = v_inv.id;
      UPDATE public.invoice_receivable_links SET status = 'obsolete' WHERE invoice_id = v_inv.id AND status = 'active';
      INSERT INTO public.invoice_lifecycle_events (invoice_id, event_type, related_invoice_id, actor, payload)
      VALUES (v_inv.id, 'obsolete', p_source_invoice, p_actor,
        jsonb_build_object('reason', 'B/L liquidado por invoice individual', 'paid_invoice_id', p_source_invoice));
      v_obsoleted := v_obsoleted + 1;
      IF cardinality(v_remaining) > 0 THEN
        BEGIN
          v_new := public.create_local_consolidated_invoice_core(v_inv.customer_id, v_remaining, p_actor, 'internal');
          v_new_id := (v_new->>'invoice_id')::bigint;
          SELECT invoice_number INTO v_new_number FROM public.invoices WHERE id = v_new_id;
          UPDATE public.invoices SET replaces_invoice_id = v_inv.id WHERE id = v_new_id;
          UPDATE public.invoices SET obsolete_reason = 'Substituída pela ' || coalesce(v_new_number, v_new_id::text)
           WHERE id = v_inv.id;
          INSERT INTO public.portal_notifications (customer_id, type, title, message, link)
          VALUES (v_inv.customer_id, 'system', 'Fatura consolidada substituída',
            'A fatura ' || coalesce(v_inv.invoice_number, '#' || v_inv.id) || ' foi substituída pela '
              || coalesce(v_new_number, '#' || v_new_id) || ', sem o B/L já pago.', '/portal/billing');
          v_reissued := v_reissued + 1;
        EXCEPTION WHEN OTHERS THEN
          PERFORM public.upsert_alert_item('fatura_desatualizada', 'invoice', v_inv.id::text,
            'Consolidada ' || coalesce(v_inv.invoice_number, v_inv.id::text) || ' ficou obsoleta porque um B/L foi pago na individual, mas a nova consolidada dos B/Ls restantes não saiu ('
              || SQLERRM || '). Emita a consolidada dos B/Ls restantes.',
            'consolidated_reissue', 'administrativo',
            jsonb_build_object('invoice_id', v_inv.id, 'auto_reissue', 'pending', 'reason', SQLERRM),
            '/taxas-locais?invoice=' || v_inv.id);
        END;
      END IF;

    ELSIF v_inv.balance_brl IS DISTINCT FROM v_balance THEN
      -- Pagamento parcial da individual: a consolidada mostra o saldo
      -- restante, com o mesmo número e QR novo (decisão 6).
      UPDATE public.invoices SET balance_brl = v_balance WHERE id = v_inv.id;
      v_updated := v_updated + 1;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('covered', v_covered, 'obsoleted', v_obsoleted, 'reissued', v_reissued, 'updated', v_updated);
END;
$function$;

-- alert_stale_invoice_for_bl
CREATE OR REPLACE FUNCTION public.alert_stale_invoice_for_bl(p_bl_id text, p_source text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_invoice record; v_path text;
BEGIN
  FOR v_invoice IN SELECT DISTINCT i.id, i.invoice_number, i.status, i.total_paid_brl FROM public.invoices i
    WHERE i.invoice_type IN ('individual', 'consolidated') AND i.status IN ('issued', 'overdue', 'partially_paid', 'paid')
    AND (EXISTS (SELECT 1 FROM public.invoice_bls b WHERE b.invoice_id = i.id AND b.bl_id = p_bl_id)
      OR EXISTS (SELECT 1 FROM public.invoice_receivable_links l WHERE l.invoice_id = i.id AND l.bl_id = p_bl_id
        AND l.status IN ('active', 'settled_by_this_invoice')))
  LOOP
    v_path := CASE WHEN coalesce(v_invoice.total_paid_brl, 0) > 0
      THEN 'Valor maior: emita Fatura Avulsa com a diferença e resolva este alerta com a justificativa. Valor menor é abatido automaticamente.'
      ELSE 'Conclua a revisão do cálculo e use Emitir fatura na ficha do B/L.' END;
    PERFORM public.upsert_alert_item('fatura_desatualizada', 'invoice', v_invoice.id::text,
      'Fatura ' || v_invoice.invoice_number || ' desatualizada pela correção do B/L ' || p_bl_id || '. ' || v_path,
      p_source, 'administrativo', jsonb_build_object('bl_id', p_bl_id, 'invoice_id', v_invoice.id, 'guidance', v_path),
      '/taxas-locais?invoice=' || v_invoice.id);
  END LOOP;
END;
$function$;

-- apply_invoice_basis_changes_legacy_130
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
    WHEN 'baplie_correction' THEN 'Reemissão automática: flags do Baplie alteraram a base faturada'
    WHEN 'bl_reimport_correction' THEN 'Reemissão automática: reimportação alterou a base faturada'
    WHEN 'tariff_correction' THEN 'Reemissão automática: correção da tabela de taxas ou da Condição de Cliente'
    ELSE 'Reemissão automática: alteração do B/L mudou a base faturada' END;

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
    ELSIF coalesce(v_quote->>'status', '') NOT IN ('ok', 'exempt')
       OR NOT public.customer_billing_access_ready((SELECT b.customer_id FROM public.bls b WHERE b.id = v_bl_id)) THEN
      v_pending := CASE WHEN coalesce(v_quote->>'status', '') NOT IN ('ok', 'exempt')
        THEN 'valor novo a revisar: ' || coalesce(v_quote->>'reason', v_quote->>'status', 'sem cotação')
        ELSE 'Portal do Cliente não está pronto e não há Liberação de faturamento vigente' END;
      FOR v_id IN SELECT unnest(v_invoices) LOOP
        PERFORM public.upsert_alert_item('fatura_desatualizada', 'invoice', v_id::text,
          'A correção do B/L ' || v_bl_id || ' não reemitiu a fatura: a nova emissão não sairia (' || v_pending
            || '). A fatura continua valendo; resolva o motivo e use Tentar aplicar correção.',
          p_source, 'administrativo',
          jsonb_build_object('bl_id', v_bl_id, 'invoice_id', v_id, 'auto_reissue', 'blocked', 'reason', v_pending),
          '/taxas-locais?invoice=' || v_id);
      END LOOP;
      v_results := v_results || jsonb_build_object('bl_id', v_bl_id, 'status', 'blocked_review', 'pending_reason', v_pending);
      v_pending := NULL;
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
          'Fatura cancelada para reemissão automática do B/L ' || v_bl_id || ', mas a nova emissão não saiu (' || v_pending
            || '). Resolva o motivo e use Emitir fatura na ficha do B/L; ela segue em Reemissão pendente.',
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

-- _run_import_effect_vehicle_followup
CREATE OR REPLACE FUNCTION public._run_import_effect_vehicle_followup(p_entity_id text, p_actor uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bl_id text := NULLIF(btrim(COALESCE(p_entity_id, '')), '');
  v_live bigint[];
  v_quote jsonb;
  v_invoice_id bigint;
  v_cancelled_ids bigint[] := ARRAY[]::bigint[];
  v_cancel_results jsonb := '[]'::jsonb;
  v_charge jsonb;
  v_voided integer := 0;
BEGIN
  IF v_bl_id IS NULL THEN
    RAISE EXCEPTION 'B/L inválido no efeito de veículos.' USING ERRCODE = '22023';
  END IF;

  PERFORM 1 FROM public.bls WHERE id = v_bl_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L % nao encontrado para efeito de veículos.', v_bl_id USING ERRCODE = 'P0002';
  END IF;

  v_live := public._live_local_invoice_ids_for_bl(v_bl_id);
  v_quote := public._quote_bl_local_charges(v_bl_id, NULL);

  -- Fatura viva de B/L que continua cobrado: o valor e o Cliente já foram
  -- tratados no commit da importação de veículos (ADR 0077). Nada é cancelado.
  IF cardinality(v_live) > 0 AND COALESCE(v_quote->>'status', '') <> 'exempt' THEN
    RETURN jsonb_build_object(
      'entity_id', v_bl_id,
      'status', 'skipped',
      'reason', 'live_invoice_follows_adr_0077',
      'live_invoice_ids', to_jsonb(v_live)
    );
  END IF;

  IF cardinality(v_live) > 0 THEN
    -- Isenção confirmada agora (veículo com desova LCL/CFS): a fatura sai.
    PERFORM set_config('import_effects.consumer', 'vehicle_followup', true);

    -- A consolidada que cobra este B/L sai junto: não pode voltar com os mesmos
    -- B/Ls, então é encerrada sem reemissão (decisão de 2026-10-02).
    FOR v_invoice_id IN
      SELECT DISTINCT inv.id
      FROM public.invoice_receivable_links AS l
      JOIN public.invoices AS inv ON inv.id = l.invoice_id
      WHERE l.bl_id = v_bl_id
        AND l.status IN ('active', 'settled_by_this_invoice')
        AND inv.invoice_type = 'consolidated'
        AND COALESCE(inv.status, 'issued') IN ('draft', 'issued', 'overdue')
        AND NOT EXISTS (SELECT 1 FROM public.payments AS p WHERE p.invoice_id = inv.id)
      ORDER BY inv.id
    LOOP
      v_cancel_results := v_cancel_results || jsonb_build_array(
        public._cancel_invoice_core(v_invoice_id, 'Carga de veículos: BL ' || v_bl_id || ' isento de taxas locais.', p_actor));
      UPDATE public.invoices
      SET reissue_requested_at = now(), reissue_closed_at = now(),
          reissue_closed_reason = 'Não reemitida: B/L ' || v_bl_id || ' isento por carga de veículos.'
      WHERE id = v_invoice_id;
      v_cancelled_ids := array_append(v_cancelled_ids, v_invoice_id);
    END LOOP;

    FOR v_invoice_id IN
      SELECT DISTINCT inv.id
      FROM public.invoice_bls AS link
      JOIN public.invoices AS inv ON inv.id = link.invoice_id
      WHERE link.bl_id = v_bl_id
        AND COALESCE(inv.status, 'issued') IN ('draft', 'issued', 'overdue')
        AND NOT EXISTS (SELECT 1 FROM public.payments AS p WHERE p.invoice_id = inv.id)
      ORDER BY inv.id
    LOOP
      v_cancel_results := v_cancel_results || jsonb_build_array(
        public.cancel_invoice(v_invoice_id, 'Carga de veículos: BL isento de taxas locais.', p_actor));
      v_cancelled_ids := array_append(v_cancelled_ids, v_invoice_id);
    END LOOP;

    -- Fatura com pagamento não é cancelada: a diferença já foi tratada no
    -- commit da importação pelo item 4 da ADR 0077 (abatimento e restituição).
    -- cancel_invoice recusaria e o efeito viraria bloqueio com Alerta.
    v_live := public._live_local_invoice_ids_for_bl(v_bl_id);
    IF cardinality(v_live) > 0 THEN
      RETURN jsonb_build_object(
        'entity_id', v_bl_id,
        'status', 'skipped',
        'reason', 'paid_invoice_follows_adr_0077',
        'cancelled_invoice_ids', v_cancelled_ids,
        'cancel_results', v_cancel_results,
        'live_invoice_ids', to_jsonb(v_live)
      );
    END IF;
  END IF;

  v_charge := public.calculate_bl_local_charges(v_bl_id, p_actor, true);
  -- B/L isento sem fatura: o Recebível aberto é anulado (M15).
  IF COALESCE(public._quote_bl_local_charges(v_bl_id, NULL)->>'status', '') = 'exempt' THEN
    v_voided := public._void_unbilled_bl_receivables(v_bl_id, p_actor, 'B/L isento de taxas locais (carga de veículos)');
  END IF;
  RETURN jsonb_build_object(
    'entity_id', v_bl_id,
    'status', CASE WHEN cardinality(v_cancelled_ids) > 0 THEN 'exempt_invoices_cancelled' ELSE 'recalculated' END,
    'cancelled_invoice_ids', v_cancelled_ids,
    'cancel_results', v_cancel_results,
    'voided_receivables', v_voided,
    'charge_result', v_charge
  );
END;
$function$;

-- close_pending_reissue_on_bl_end
CREATE OR REPLACE FUNCTION public.close_pending_reissue_on_bl_end()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_id bigint; v_reason text;
BEGIN
  IF NEW.cancelled_at IS NOT NULL AND OLD.cancelled_at IS NULL THEN
    v_reason := 'Não reemitida: B/L ' || NEW.id || ' cancelado.';
  ELSIF NEW.charge_status = 'exempt' AND OLD.charge_status IS DISTINCT FROM 'exempt' THEN
    v_reason := 'Não reemitida: B/L ' || NEW.id || ' isento de Taxas Locais.';
  ELSE
    RETURN NEW;
  END IF;
  FOR v_id IN SELECT DISTINCT i.id FROM public.invoice_bls ib JOIN public.invoices i ON i.id = ib.invoice_id
    WHERE ib.bl_id = NEW.id AND i.invoice_type = 'individual' LOOP
    PERFORM public._close_pending_reissue(v_id, v_reason);
  END LOOP;
  FOR v_id IN SELECT DISTINCT i.id FROM public.invoice_receivable_links l JOIN public.invoices i ON i.id = l.invoice_id
    WHERE l.bl_id = NEW.id AND i.invoice_type = 'consolidated' AND i.status = 'cancelled' AND i.reissue_closed_at IS NULL LOOP
    PERFORM public._try_recreate_consolidated(v_id, auth.uid());
  END LOOP;
  RETURN NEW;
END;
$function$;

-- upsert_pix_reconciliation_exceptions
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
          THEN format('PIX ambíguo na linha %s do import %s.', v_exception.line_number, v_exception.import_key)
          ELSE format('PIX sem conciliação na linha %s do import %s.', v_exception.line_number, v_exception.import_key)
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

-- reopen_pix_reconciliation_exception
CREATE OR REPLACE FUNCTION public.reopen_pix_reconciliation_exception(p_exception_id bigint, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_exception public.pix_reconciliation_exceptions%ROWTYPE;
BEGIN
  SELECT * INTO v_exception
  FROM public.pix_reconciliation_exceptions
  WHERE id = p_exception_id
  FOR UPDATE;
  IF NOT FOUND OR v_exception.status <> 'resolved' THEN
    RETURN;
  END IF;
  IF public.pix_reconciliation_authority_holds(p_exception_id) THEN
    RETURN;
  END IF;

  UPDATE public.pix_reconciliation_exceptions
  SET status = 'active', resolved_at = NULL, resolved_by = NULL,
      resolution_source = NULL, resolved_invoice_id = NULL,
      resolved_demurrage_invoice_id = NULL,
      metadata = metadata || jsonb_build_object('reopened_reason', COALESCE(p_reason, 'authority_invalidated')),
      updated_at = now()
  WHERE id = v_exception.id;

  PERFORM set_config('alerts.foundation_trigger', 'on', true);
  PERFORM public.upsert_alert_item(
    'pix_unreconciled', 'pix_transaction', v_exception.id::TEXT,
    format('PIX sem conciliação na linha %s do import %s.', v_exception.line_number, v_exception.import_key),
    'pix_authority_invalidated',
    jsonb_build_object('exception_id', v_exception.id, 'reason', COALESCE(p_reason, 'authority_invalidated')) || v_exception.metadata,
    '/reconciliacao'
  );
  PERFORM set_config('alerts.foundation_trigger', 'off', true);
END;
$function$;


