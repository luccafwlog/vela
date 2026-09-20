-- Remedia achados de consistencia em Clientes/Revisao: saldo canonico,
-- optimistic lock obrigatorio e serializacao da troca de cliente com o ledger.

CREATE OR REPLACE FUNCTION public.get_customer_pending_balances(p_customer_ids bigint[] DEFAULT NULL)
RETURNS TABLE(customer_id bigint, local_balance_brl numeric, demurrage_balance_brl numeric, total_balance_brl numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_read_user() THEN
    RAISE EXCEPTION 'Usuario sem permissao para consultar saldos.' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH local_totals AS (
    SELECT r.customer_id, sum(r.balance_brl) AS amount
    FROM public.bl_receivables r
    WHERE r.status IN ('open', 'partially_settled')
      AND (p_customer_ids IS NULL OR r.customer_id = ANY(p_customer_ids))
    GROUP BY r.customer_id
  ), demurrage_totals AS (
    SELECT d.customer_id, sum(greatest(coalesce(d.current_total_brl, 0), 0)) AS amount
    FROM public.demurrage_invoices d
    WHERE d.status IN ('issued', 'overdue')
      AND (p_customer_ids IS NULL OR d.customer_id = ANY(p_customer_ids))
    GROUP BY d.customer_id
  )
  SELECT coalesce(l.customer_id, d.customer_id), coalesce(l.amount, 0), coalesce(d.amount, 0),
         coalesce(l.amount, 0) + coalesce(d.amount, 0)
  FROM local_totals l FULL JOIN demurrage_totals d USING (customer_id);
END;
$$;

REVOKE ALL ON FUNCTION public.get_customer_pending_balances(bigint[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_customer_pending_balances(bigint[]) TO authenticated;

ALTER FUNCTION public.save_bl_review(text, timestamptz, jsonb, jsonb, uuid)
  RENAME TO save_bl_review_legacy_068;
REVOKE ALL ON FUNCTION public.save_bl_review_legacy_068(text, timestamptz, jsonb, jsonb, uuid) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.save_bl_review(
  p_bl_id text,
  p_expected_updated_at timestamptz,
  p_update_payload jsonb,
  p_audit_rows jsonb,
  p_changed_by uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_current_updated_at timestamptz;
  v_result jsonb;
BEGIN
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

  -- A cubagem breakbulk faltava na funcao legada. Persistimos primeiro sob o
  -- mesmo lock e repassamos a nova versao. Audit rows do navegador sao
  -- deliberadamente descartadas: os triggers registram os valores reais.
  IF p_update_payload ? 'bb_cbm' THEN
    UPDATE public.bls
    SET bb_cbm = NULLIF(p_update_payload->>'bb_cbm', '')::numeric
    WHERE id = p_bl_id
    RETURNING updated_at INTO v_current_updated_at;
  END IF;

  SELECT public.save_bl_review_legacy_068(
    p_bl_id,
    v_current_updated_at,
    p_update_payload - 'bb_cbm',
    '[]'::jsonb,
    p_changed_by
  ) INTO v_result;
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.save_bl_review(text, timestamptz, jsonb, jsonb, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_bl_review(text, timestamptz, jsonb, jsonb, uuid) TO authenticated;

ALTER FUNCTION public.relink_bl_customer(text, bigint, uuid, text)
  RENAME TO relink_bl_customer_legacy_068;
REVOKE ALL ON FUNCTION public.relink_bl_customer_legacy_068(text, bigint, uuid, text) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.relink_bl_customer(
  p_bl_id text,
  p_customer_id bigint,
  p_changed_by uuid,
  p_reason text DEFAULT 'Troca de consignatario na reimportacao do B/L'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('bl:' || p_bl_id, 0));
  -- O wrapper segura todas as linhas financeiras ate a funcao legada terminar.
  -- Uma baixa concorrente termina antes da rechecagem ou espera a troca inteira.
  PERFORM i.id
  FROM public.invoice_bls ib JOIN public.invoices i ON i.id = ib.invoice_id
  WHERE ib.bl_id = p_bl_id ORDER BY i.id FOR UPDATE OF i;
  PERFORM r.id FROM public.bl_receivables r WHERE r.bl_id = p_bl_id ORDER BY r.id FOR UPDATE;
  PERFORM d.id FROM public.demurrage_invoices d WHERE d.bl_id = p_bl_id ORDER BY d.id FOR UPDATE;
  RETURN public.relink_bl_customer_legacy_068(p_bl_id, p_customer_id, p_changed_by, p_reason);
END;
$$;

REVOKE ALL ON FUNCTION public.relink_bl_customer(text, bigint, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.relink_bl_customer(text, bigint, uuid, text) TO authenticated;

-- Importacao e baixa entram pelo mesmo mutex por B/L antes de adquirir locks
-- de linha. Assim todos os caminhos seguem advisory -> invoice -> receivable ->
-- demurrage -> B/L, evitando o ciclo B/L <-> invoice do fluxo anterior.
ALTER FUNCTION public.import_bl_freight_transactional(jsonb, uuid)
  RENAME TO import_bl_freight_transactional_legacy_068;
REVOKE ALL ON FUNCTION public.import_bl_freight_transactional_legacy_068(jsonb, uuid) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.import_bl_freight_transactional(p_bls jsonb, p_changed_by uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_bl_id text;
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
  RETURN public.import_bl_freight_transactional_legacy_068(p_bls, p_changed_by);
END;
$$;
REVOKE ALL ON FUNCTION public.import_bl_freight_transactional(jsonb, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_bl_freight_transactional(jsonb, uuid) TO authenticated;

ALTER FUNCTION public.register_ledger_invoice_payment(bigint, numeric, text, timestamptz, text, text, text, uuid)
  RENAME TO register_ledger_invoice_payment_legacy_068;
REVOKE ALL ON FUNCTION public.register_ledger_invoice_payment_legacy_068(bigint, numeric, text, timestamptz, text, text, text, uuid) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.register_ledger_invoice_payment(
  p_invoice_id bigint, p_amount_brl numeric, p_method text DEFAULT 'pix',
  p_paid_at timestamptz DEFAULT now(), p_pix_txid text DEFAULT NULL,
  p_source text DEFAULT 'manual', p_notes text DEFAULT NULL, p_actor uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_bl_id text;
BEGIN
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
  RETURN public.register_ledger_invoice_payment_legacy_068(p_invoice_id, p_amount_brl, p_method, p_paid_at, p_pix_txid, p_source, p_notes, p_actor);
END;
$$;
REVOKE ALL ON FUNCTION public.register_ledger_invoice_payment(bigint, numeric, text, timestamptz, text, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_ledger_invoice_payment(bigint, numeric, text, timestamptz, text, text, text, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.register_ledger_invoice_payment(
  p_invoice_id bigint,
  p_amount_brl numeric,
  p_method text,
  p_paid_at timestamptz,
  p_pix_txid text,
  p_source text,
  p_notes text,
  p_actor uuid,
  p_request_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_bl_id text;
  v_request_id uuid := COALESCE(p_request_id, gen_random_uuid());
  v_hash text := md5(jsonb_build_object('invoice_id', p_invoice_id, 'amount_brl', round(p_amount_brl::numeric, 2), 'method', p_method, 'paid_at', p_paid_at, 'pix_txid', p_pix_txid, 'source', p_source, 'notes', p_notes, 'actor', p_actor)::text);
  v_existing public.ledger_payment_requests%ROWTYPE;
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Credenciais invalidas ou sem permissao de faturamento.' USING ERRCODE = '42501';
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
  IF v_existing.result IS NOT NULL THEN RETURN v_existing.result; END IF;

  PERFORM public.assert_ledger_invoice_payment_allocation(p_invoice_id, p_amount_brl);
  v_result := public.register_ledger_invoice_payment_legacy_066(
    p_invoice_id, p_amount_brl, p_method, p_paid_at, p_pix_txid, p_source, p_notes, p_actor
  );
  UPDATE public.ledger_payment_requests SET result = v_result WHERE request_id = v_request_id;
  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.register_ledger_invoice_payment(bigint, numeric, text, timestamptz, text, text, text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_ledger_invoice_payment(bigint, numeric, text, timestamptz, text, text, text, uuid, uuid) TO authenticated;

-- A criação do comunicado precisa validar e congelar a âncora na mesma
-- transação que grava o snapshot. O RPC legado continua sendo o escritor,
-- mas recebe somente valores derivados sob locks dos B/Ls/escala.
ALTER FUNCTION public.create_customer_communication_atomic(bigint, text, text, bigint, text, uuid, bigint, integer, uuid, text, text, text, uuid, text[])
  RENAME TO create_customer_communication_atomic_legacy_068;
REVOKE ALL ON FUNCTION public.create_customer_communication_atomic_legacy_068(bigint, text, text, bigint, text, uuid, bigint, integer, uuid, text, text, text, uuid, text[]) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.create_customer_communication_atomic(
  p_customer_id bigint, p_kind text, p_nature text,
  p_anchor_voyage_id bigint DEFAULT NULL, p_anchor_port text DEFAULT NULL,
  p_anchor_atracacao_id uuid DEFAULT NULL, p_anchor_invoice_id bigint DEFAULT NULL,
  p_attempt_discriminator integer DEFAULT 0, p_dispatch_id uuid DEFAULT NULL,
  p_vessel_name text DEFAULT NULL, p_voyage_number text DEFAULT NULL,
  p_terminal_name text DEFAULT NULL, p_created_by uuid DEFAULT NULL,
  p_bl_ids text[] DEFAULT '{}'
) RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_bl public.bls%ROWTYPE;
  v_count integer := 0;
  v_voyage_id bigint := p_anchor_voyage_id;
  v_port text := nullif(btrim(p_anchor_port), '');
  v_vessel_name text := nullif(btrim(p_vessel_name), '');
  v_voyage_number text := nullif(btrim(p_voyage_number), '');
  v_terminal_name text := nullif(btrim(p_terminal_name), '');
  v_schedule jsonb;
  v_milestone text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Executor server-only.' USING ERRCODE = '42501';
  END IF;

  IF p_kind IN ('aviso_chegada_noa', 'aviso_prontidao_nor', 'aviso_atracacao_nob', 'ce_mercante_taxas') THEN
    IF coalesce(cardinality(p_bl_ids), 0) = 0 THEN
      RAISE EXCEPTION 'Comunicado operacional exige B/L.' USING ERRCODE = '22023';
    END IF;
    FOR v_bl IN SELECT b.* FROM public.bls b WHERE b.id = ANY(p_bl_ids) ORDER BY b.id FOR UPDATE
    LOOP
      v_count := v_count + 1;
      IF v_bl.customer_id IS DISTINCT FROM p_customer_id THEN
        RAISE EXCEPTION 'B/L fora do cliente do comunicado.' USING ERRCODE = '42501';
      END IF;
      IF v_voyage_id IS NULL THEN v_voyage_id := v_bl.voyage_id; END IF;
      IF v_port IS NULL THEN v_port := nullif(btrim(v_bl.pod), ''); END IF;
      IF v_bl.voyage_id IS DISTINCT FROM v_voyage_id OR upper(btrim(v_bl.pod)) IS DISTINCT FROM upper(v_port) THEN
        RAISE EXCEPTION 'B/Ls não compartilham a âncora operacional.' USING ERRCODE = '22023';
      END IF;
      SELECT v.pod_schedule_snapshot -> v_bl.pod INTO v_schedule FROM public.voyages v WHERE v.id = v_bl.voyage_id FOR UPDATE;
      IF p_kind IN ('aviso_chegada_noa', 'aviso_prontidao_nor') THEN
        IF coalesce((v_schedule->>'deleted')::boolean, false) OR coalesce((v_schedule->>'omitted')::boolean, false) THEN
          RAISE EXCEPTION 'Escala omitida ou excluída.' USING ERRCODE = '22023';
        END IF;
        v_milestone := nullif(v_schedule ->> CASE WHEN p_kind = 'aviso_prontidao_nor' THEN 'ata' ELSE 'eta' END, '');
        IF v_milestone IS NULL THEN RAISE EXCEPTION 'Marco operacional ausente.' USING ERRCODE = '22023'; END IF;
      END IF;
      IF p_kind = 'aviso_atracacao_nob' THEN
        IF p_anchor_atracacao_id IS NULL OR NOT EXISTS (
          SELECT 1 FROM public.voyage_escala_terminal_state t
          WHERE t.id = p_anchor_atracacao_id AND t.voyage_id = v_bl.voyage_id
            AND upper(t.port) = upper(v_bl.pod) AND t.terminal_atb IS NOT NULL
        ) OR NOT EXISTS (
          SELECT 1 FROM public.voyage_escala_operation_fronts f
          WHERE f.voyage_id = v_bl.voyage_id AND upper(f.port) = upper(v_bl.pod)
            AND f.terminal_id = (SELECT terminal_id FROM public.voyage_escala_terminal_state WHERE id = p_anchor_atracacao_id)
            AND f.sentido = 'importacao' AND f.modalidade = public.bl_operation_front_modalidade(v_bl.cargo_mode)
        ) THEN
          RAISE EXCEPTION 'Atracação não corresponde à Frente de Operação do B/L.' USING ERRCODE = '22023';
        END IF;
      END IF;
      SELECT v.voyage_number, vs.name INTO v_voyage_number, v_vessel_name
      FROM public.voyages v LEFT JOIN public.vessels vs ON vs.id = v.vessel_id WHERE v.id = v_bl.voyage_id;
    END LOOP;
    IF v_count <> cardinality(p_bl_ids) THEN RAISE EXCEPTION 'B/L inexistente no comunicado.' USING ERRCODE = '42501'; END IF;
  ELSIF p_kind = 'institucional' AND coalesce(cardinality(p_bl_ids), 0) > 0 THEN
    RAISE EXCEPTION 'Comunicado institucional não pode conter B/Ls.' USING ERRCODE = '22023';
  END IF;

  IF p_kind = 'ce_mercante_taxas' AND v_port IS NULL THEN
    RAISE EXCEPTION 'Porto obrigatório para comunicado financeiro.' USING ERRCODE = '22023';
  END IF;
  RETURN public.create_customer_communication_atomic_legacy_068(
    p_customer_id, p_kind, p_nature, v_voyage_id, v_port, p_anchor_atracacao_id,
    p_anchor_invoice_id, p_attempt_discriminator, p_dispatch_id, v_vessel_name,
    v_voyage_number, v_terminal_name, p_created_by, p_bl_ids
  );
END;
$$;
REVOKE ALL ON FUNCTION public.create_customer_communication_atomic(bigint, text, text, bigint, text, uuid, bigint, integer, uuid, text, text, text, uuid, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_customer_communication_atomic(bigint, text, text, bigint, text, uuid, bigint, integer, uuid, text, text, text, uuid, text[]) TO service_role;
