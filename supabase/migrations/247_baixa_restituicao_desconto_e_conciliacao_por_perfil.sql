-- Migration 247: baixa, Restituição, desconto e Conciliação PIX por perfil
-- (item P5 do plano docs/plans/2026-10-14-correcoes-decididas-na-revisao-geral.md;
-- ADR 0085, base, D2, D4, D5 e D18).
--
-- Baixa manual local (register_verified_invoice_payment, register_invoice_payment,
-- register_ledger_invoice_payment e os núcleos legados que ela chama): Financeiro
-- e Administrativo (is_financeiro_user). Autorizar restituição excepcional e
-- cancelar a autorização pendente: qualquer Departamento, com a justificativa
-- que as RPCs já exigem. Desconto de Demurrage: qualquer Departamento.
-- Conciliação PIX: ler (list_*, itau_pix_monitor) é de todos; conciliar
-- (vincular, confirmar, tratar exceção, marcar recebimento Itaú, baixa por TXID)
-- é do Financeiro e do Administrativo, e confirm_unified_pix_matches, que roda
-- com o usuário (INVOKER), ganha guarda própria. O corpo de cada função é o
-- vigente; muda só a guarda. Cancelar baixa e cancelar fatura seguem só do
-- Administrativo.
--
-- Os alertas "Pix não conciliado", "Fatura desatualizada" e "Restituição
-- pendente" passam a incluir o Financeiro na audiência; o Administrativo
-- continua, e o Pix não conciliado mantém Documentação e Equipamentos. Reescreve
-- essas três linhas de alert_type_catalog (configuração, não dado de negócio);
-- apoia-se na afirmação "Data status" do AGENTS.md, como exige a regra de
-- migrations que reescrevem linhas.

CREATE OR REPLACE FUNCTION public.confirm_unified_pix_matches(p_matches jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
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
    RAISE EXCEPTION 'Credenciais invalidas ou sem permissao para reconciliacao PIX.' USING ERRCODE = '42501';
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
        SELECT d.current_total_brl, ROUND(d.current_roe / 1.065, 4)
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

CREATE OR REPLACE FUNCTION public.link_pix_reconciliation_candidate(p_exception_id bigint, p_resolution_source text, p_invoice_id bigint DEFAULT NULL, p_demurrage_invoice_id bigint DEFAULT NULL)
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
    RAISE EXCEPTION 'Credenciais invalidas ou sem permissao para reconciliacao PIX.' USING ERRCODE = '42501';
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
    RAISE EXCEPTION 'Credenciais invalidas ou sem permissao para reconciliacao PIX.' USING ERRCODE = '42501';
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
    RAISE EXCEPTION 'Credenciais invalidas ou sem permissao para reconciliacao PIX.' USING ERRCODE = '42501';
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
    RAISE EXCEPTION 'Credenciais invalidas ou sem permissao de faturamento.' USING ERRCODE = '42501';
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

CREATE OR REPLACE FUNCTION public.register_invoice_payment(p_invoice_id bigint, p_amount_brl numeric, p_payment_method text DEFAULT 'pix'::text, p_paid_at timestamp with time zone DEFAULT now(), p_notes text DEFAULT NULL, p_actor uuid DEFAULT NULL)
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
    RAISE EXCEPTION 'Credenciais invalidas ou sem permissao de faturamento.' USING ERRCODE = '42501';
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

CREATE OR REPLACE FUNCTION public.register_ledger_invoice_payment_legacy_052(p_invoice_id bigint, p_amount_brl numeric, p_method text DEFAULT 'pix'::text, p_paid_at timestamp with time zone DEFAULT now(), p_pix_txid text DEFAULT NULL, p_source text DEFAULT 'manual'::text, p_notes text DEFAULT NULL, p_actor uuid DEFAULT NULL)
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
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_financeiro_user() THEN
    RAISE EXCEPTION 'Credenciais invalidas ou sem permissao de faturamento.' USING ERRCODE = '42501';
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

  IF v_next_status = 'paid' THEN
    IF COALESCE(v_invoice.invoice_type, 'individual') = 'consolidated' THEN
      WITH covered AS (
        UPDATE public.invoices ind
        SET status = 'covered', covered_by_invoice_id = p_invoice_id
        WHERE ind.id <> p_invoice_id
          AND ind.invoice_type = 'individual'
          AND COALESCE(ind.status, 'issued') IN ('issued', 'partially_paid', 'overdue')
          AND EXISTS (
            SELECT 1
            FROM public.invoice_receivable_links l
            WHERE l.invoice_id = ind.id
              AND l.receivable_id = ANY(v_all_receivable_ids)
          )
        RETURNING ind.id
      )
      SELECT COUNT(*) INTO v_covered FROM covered;

      UPDATE public.invoice_receivable_links
      SET status = 'settled_elsewhere'
      WHERE invoice_id <> p_invoice_id
        AND receivable_id = ANY(v_all_receivable_ids)
        AND status = 'active';

      INSERT INTO public.invoice_lifecycle_events (invoice_id, event_type, related_invoice_id, actor, payload)
      SELECT ind.id, 'covered', p_invoice_id, v_actor,
        jsonb_build_object('reason', 'Coberta por consolidada', 'consolidated_invoice_id', p_invoice_id)
      FROM public.invoices ind
      WHERE ind.covered_by_invoice_id = p_invoice_id
        AND ind.status = 'covered';
    ELSE
      WITH obsoleted AS (
        UPDATE public.invoices con
        SET status = 'obsolete',
            obsolete_reason = 'B/L liquidado por invoice individual ' || COALESCE(v_invoice.invoice_number, p_invoice_id::TEXT)
        WHERE con.id <> p_invoice_id
          AND con.invoice_type = 'consolidated'
          AND COALESCE(con.status, 'issued') IN ('issued', 'partially_paid', 'overdue')
          AND EXISTS (
            SELECT 1
            FROM public.invoice_receivable_links l
            WHERE l.invoice_id = con.id
              AND l.receivable_id = ANY(v_all_receivable_ids)
          )
        RETURNING con.id
      )
      SELECT COUNT(*) INTO v_obsoleted FROM obsoleted;

      UPDATE public.invoice_receivable_links
      SET status = 'obsolete'
      WHERE invoice_id <> p_invoice_id
        AND receivable_id = ANY(v_all_receivable_ids)
        AND invoice_id IN (
          SELECT id FROM public.invoices WHERE invoice_type = 'consolidated' AND status = 'obsolete'
        )
        AND status = 'active';

      INSERT INTO public.invoice_lifecycle_events (invoice_id, event_type, related_invoice_id, actor, payload)
      SELECT con.id, 'obsolete', p_invoice_id, v_actor,
        jsonb_build_object('reason', con.obsolete_reason, 'paid_invoice_id', p_invoice_id)
      FROM public.invoices con
      WHERE con.invoice_type = 'consolidated'
        AND con.status = 'obsolete'
        AND EXISTS (
          SELECT 1
          FROM public.invoice_receivable_links l
          WHERE l.invoice_id = con.id
            AND l.receivable_id = ANY(v_all_receivable_ids)
        );
    END IF;
  END IF;

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

CREATE OR REPLACE FUNCTION public.resolve_pix_reconciliation_exception(p_exception_id bigint, p_resolution_source text, p_invoice_id bigint DEFAULT NULL, p_demurrage_invoice_id bigint DEFAULT NULL, p_txid text DEFAULT NULL)
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
    RAISE EXCEPTION 'Credenciais invalidas ou sem permissao para reconciliacao PIX.' USING ERRCODE = '42501';
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
    RAISE EXCEPTION 'Credenciais invalidas ou sem permissao para reconciliacao PIX.' USING ERRCODE = '42501';
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
    RETURNING * INTO v_exception;

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

CREATE OR REPLACE FUNCTION public.apply_demurrage_discount(p_request_id uuid, p_invoice_id bigint, p_discount_mode text, p_discount_value numeric, p_discount_type text DEFAULT NULL, p_discount_justification text DEFAULT NULL, p_discount_approver text DEFAULT NULL)
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
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND (auth.uid() IS NULL OR NOT public.is_active_user()) THEN
    RAISE EXCEPTION 'Usuario sem permissao para aplicar desconto de Demurrage.' USING ERRCODE = '42501';
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

  IF v_invoice.current_roe IS NOT NULL AND v_invoice.current_roe > 0 THEN
    v_total_brl := round(greatest(v_invoice.total_usd - v_discount_usd, 0) * v_invoice.current_roe, 2);
    v_pix_payload := CASE WHEN v_total_brl > 0 THEN public.build_transshipping_pix_payload(v_total_brl, v_invoice.doc_number) ELSE NULL END;
  ELSE
    v_total_brl := NULL;
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
      updated_at = now()
  WHERE id = p_invoice_id;

  IF v_total_brl IS NOT NULL THEN
    INSERT INTO public.demurrage_invoice_history
      (invoice_id, event_date, ptax_used, roe_used, total_usd, total_brl, discount_usd, source)
    VALUES
      (p_invoice_id, CURRENT_DATE, round(v_invoice.current_roe / 1.065, 4), v_invoice.current_roe,
       v_invoice.total_usd, v_total_brl, v_discount_usd, 'manual');
  END IF;

  INSERT INTO public.audit_logs(
    entity_type, entity_id, field_name, old_value, new_value,
    changed_by, changed_at, justification
  ) VALUES (
    'demurrage_invoice', p_invoice_id::text, 'discount',
    jsonb_build_object('mode', v_invoice.discount_mode, 'value', v_invoice.discount_value)::text,
    v_payload::text, auth.uid(), now(), v_justification
  );

  v_result := jsonb_build_object(
    'invoice_id', p_invoice_id,
    'discount_usd', v_discount_usd,
    'current_total_brl', v_total_brl,
    'pix_payload', v_pix_payload,
    'idempotent', false
  );
  INSERT INTO public.demurrage_mutation_requests(request_id, operation, invoice_id, request_payload, result, created_by)
  VALUES (p_request_id, 'discount', p_invoice_id, v_payload, v_result, auth.uid())
  ON CONFLICT (request_id) DO NOTHING;
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.register_ledger_invoice_payment_legacy_066(p_invoice_id bigint, p_amount_brl numeric, p_method text DEFAULT 'pix'::text, p_paid_at timestamp with time zone DEFAULT now(), p_pix_txid text DEFAULT NULL, p_source text DEFAULT 'manual'::text, p_notes text DEFAULT NULL, p_actor uuid DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_financeiro_user() THEN
    RAISE EXCEPTION 'Credenciais invalidas ou sem permissao de faturamento.'
      USING ERRCODE = '42501';
  END IF;

  PERFORM public.assert_ledger_invoice_payment_allocation(p_invoice_id, p_amount_brl);

  RETURN public.register_ledger_invoice_payment_legacy_052(
    p_invoice_id, p_amount_brl, p_method, p_paid_at, p_pix_txid,
    p_source, p_notes, p_actor
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

CREATE OR REPLACE FUNCTION public.list_local_pix_candidates(p_txids text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Sem permissao de faturamento.' USING ERRCODE = '42501';
  END IF;
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('txid', t.txid, 'id', i.id,
    'invoice_number', i.invoice_number, 'amount_brl', r.expected_brl,
    'customer', jsonb_build_object('name', c.name, 'cnpj_cpf', c.cnpj_cpf)))
    FROM unnest(p_txids) t(txid) CROSS JOIN LATERAL public.resolve_local_pix_charge(t.txid) r
    JOIN public.invoices i ON i.id = r.invoice_id JOIN public.customers c ON c.id = i.customer_id), '[]'::jsonb);
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
    RAISE EXCEPTION 'Sem permissao de faturamento.' USING ERRCODE = '42501';
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

CREATE OR REPLACE FUNCTION public.register_verified_invoice_payment(p_invoice_id bigint, p_amount_brl numeric, p_method text, p_paid_at timestamp with time zone, p_notes text, p_request_id uuid, p_bank_reference text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE h text; attempt public.financial_payment_attempts%ROWTYPE; v_result jsonb; v_payment_id bigint; bl_id text; manual_invoice record; paid numeric; excess numeric;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_financeiro_user() THEN RAISE EXCEPTION 'Sem permissão para registrar pagamento.' USING ERRCODE = '42501'; END IF;
 IF p_amount_brl IS NULL OR p_amount_brl::text IN ('NaN','Infinity','-Infinity') OR p_amount_brl<=0 OR p_amount_brl<>round(p_amount_brl,2) THEN RAISE EXCEPTION 'Informe valor positivo com até duas casas decimais.' USING ERRCODE='22023'; END IF;
 IF p_request_id IS NULL OR length(btrim(coalesce(p_bank_reference,''))) < 3 THEN RAISE EXCEPTION 'Informe a referência do recebimento bancário.' USING ERRCODE = '22023'; END IF;
 -- Ordem compartilhada com importação e conciliação: B/Ls antes das linhas financeiras.
 FOR bl_id IN SELECT DISTINCT l.bl_id FROM public.invoice_receivable_links l WHERE l.invoice_id=p_invoice_id
 UNION SELECT ib.bl_id FROM public.invoice_bls ib WHERE ib.invoice_id=p_invoice_id ORDER BY 1 LOOP
   PERFORM pg_advisory_xact_lock(hashtextextended('bl:'||bl_id,0)); END LOOP;
 h := md5(jsonb_build_object('invoice',p_invoice_id,'amount',round(p_amount_brl,2),'method',p_method,'paid_at',p_paid_at,'notes',p_notes,'reference',lower(btrim(p_bank_reference)))::text);
 INSERT INTO public.financial_payment_attempts(request_id,payload_hash,created_by) VALUES(p_request_id,h,auth.uid()) ON CONFLICT DO NOTHING;
 SELECT * INTO attempt FROM public.financial_payment_attempts WHERE request_id=p_request_id FOR UPDATE;
 IF attempt.payload_hash <> h OR attempt.created_by <> auth.uid() THEN RAISE EXCEPTION 'Tentativa reutilizada com dados diferentes.' USING ERRCODE='22023'; END IF;
 IF attempt.result IS NOT NULL THEN
   IF NOT EXISTS(SELECT 1 FROM public.payments p WHERE p.id=attempt.payment_id) THEN RAISE EXCEPTION 'Esta baixa foi cancelada. Confira o extrato e inicie uma nova operação.' USING ERRCODE='22023'; END IF;
   RETURN attempt.result; END IF;
 IF (SELECT invoice_type FROM public.invoices WHERE id=p_invoice_id) = 'manual' THEN
   SELECT * INTO manual_invoice FROM public.invoices WHERE id=p_invoice_id AND status IN ('issued','overdue','partially_paid','paid') FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'Fatura avulsa não está disponível para receber pagamento.' USING ERRCODE='22023'; END IF;
   excess := greatest(p_amount_brl-manual_invoice.balance_brl,0);
   INSERT INTO public.payments(invoice_id,amount_brl,payment_method,paid_at,registered_by,notes)
     VALUES(p_invoice_id,p_amount_brl,p_method,coalesce(p_paid_at,now()),auth.uid(),p_notes) RETURNING id INTO v_payment_id;
   SELECT sum(amount_brl) INTO paid FROM public.payments WHERE invoice_id=p_invoice_id;
   UPDATE public.invoices SET total_paid_brl=paid,balance_brl=greatest(manual_invoice.balance_brl-p_amount_brl,0),
     status=CASE WHEN manual_invoice.balance_brl-p_amount_brl<=0 THEN 'paid' ELSE 'partially_paid' END WHERE id=p_invoice_id;
   IF excess>0 THEN
     INSERT INTO public.invoice_refunds(invoice_id,payment_id,amount_brl,notes,registered_by)
       VALUES(p_invoice_id,v_payment_id,excess,'Excedente de recebimento da fatura avulsa',auth.uid()); END IF;
   v_result := jsonb_build_object('invoice_id',p_invoice_id,'payment_id',v_payment_id,'refund_due_brl',excess);
 ELSE
   v_result := public.register_ledger_invoice_payment(p_invoice_id,p_amount_brl,p_method,p_paid_at,NULL,'manual',p_notes,auth.uid(),p_request_id);
 END IF;
 v_payment_id := (v_result->>'payment_id')::bigint;
 IF v_payment_id IS NULL THEN RAISE EXCEPTION 'Pagamento não retornou identificador.'; END IF;
 UPDATE public.payments SET bank_reference=btrim(p_bank_reference) WHERE id=v_payment_id;
 UPDATE public.financial_payment_attempts SET payment_id=v_payment_id,result=v_result WHERE request_id=p_request_id;
 RETURN v_result;
END $function$;

CREATE OR REPLACE FUNCTION public.request_financial_refund(p_source text, p_invoice_id bigint, p_amount_brl numeric, p_reason text, p_purpose text, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE received numeric; reserved numeric; existing record; refund_id bigint;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_active_user() THEN RAISE EXCEPTION 'Sem permissão para autorizar restituição excepcional.' USING ERRCODE='42501'; END IF;
 IF p_source NOT IN ('manual','demurrage') OR p_source IS NULL OR p_purpose NOT IN ('correction','cancel') OR p_purpose IS NULL OR
    p_request_id IS NULL OR coalesce(round(p_amount_brl,2),0)<=0 OR length(btrim(coalesce(p_reason,'')))<10 THEN
    RAISE EXCEPTION 'Informe origem, valor positivo, finalidade e justificativa detalhada.' USING ERRCODE='22023'; END IF;
 IF p_source='manual' THEN
   SELECT total_paid_brl INTO received FROM public.invoices WHERE id=p_invoice_id AND invoice_type='manual' AND status IN ('paid','partially_paid') FOR UPDATE;
   SELECT id,invoice_id,amount_brl,notes,purpose,status INTO existing FROM public.invoice_refunds WHERE request_id=p_request_id;
   SELECT coalesce(sum(amount_brl),0) INTO reserved FROM public.invoice_refunds WHERE invoice_id=p_invoice_id AND status<>'cancelled';
 ELSE
   SELECT current_total_brl INTO received FROM public.demurrage_invoices WHERE id=p_invoice_id AND status='paid' FOR UPDATE;
   SELECT id,invoice_id,amount_brl,notes,purpose,status INTO existing FROM public.demurrage_refunds WHERE request_id=p_request_id;
   SELECT coalesce(sum(amount_brl),0) INTO reserved FROM public.demurrage_refunds WHERE invoice_id=p_invoice_id AND status<>'cancelled';
 END IF;
 IF existing.id IS NOT NULL THEN
   IF existing.status='cancelled' THEN RAISE EXCEPTION 'Autorização cancelada: inicie nova solicitação.' USING ERRCODE='22023'; END IF;
   IF existing.invoice_id<>p_invoice_id OR existing.amount_brl<>round(p_amount_brl,2) OR existing.notes<>btrim(p_reason) OR existing.purpose<>p_purpose THEN
     RAISE EXCEPTION 'Solicitação reutilizada com outros dados.' USING ERRCODE='22023'; END IF;
   RETURN jsonb_build_object('refund_id',existing.id,'idempotent',true); END IF;
 IF received IS NULL OR round(p_amount_brl,2)>received-reserved THEN RAISE EXCEPTION 'Restituição excede o recebimento disponível ou fatura não está paga.' USING ERRCODE='22023'; END IF;
 IF p_purpose='cancel' AND round(p_amount_brl,2)<>received-reserved THEN RAISE EXCEPTION 'Cancelamento exige devolver todo o recebido ainda disponível.' USING ERRCODE='22023'; END IF;
 IF p_source='manual' THEN
   INSERT INTO public.invoice_refunds(invoice_id,amount_brl,origin,notes,registered_by,purpose,request_id)
    VALUES(p_invoice_id,round(p_amount_brl,2),'correction',btrim(p_reason),auth.uid(),p_purpose,p_request_id) RETURNING id INTO refund_id;
 ELSE
   INSERT INTO public.demurrage_refunds(invoice_id,amount_brl,notes,registered_by,purpose,request_id)
    VALUES(p_invoice_id,round(p_amount_brl,2),btrim(p_reason),auth.uid(),p_purpose,p_request_id) RETURNING id INTO refund_id;
 END IF;
 INSERT INTO public.audit_logs(entity_type,entity_id,field_name,new_value,changed_by,justification)
 VALUES(p_source||'_invoice',p_invoice_id::text,'refund_requested',jsonb_build_object('refund_id',refund_id,'amount_brl',round(p_amount_brl,2),'purpose',p_purpose)::text,auth.uid(),btrim(p_reason));
 RETURN jsonb_build_object('refund_id',refund_id,'status','pending');
END $function$;

CREATE OR REPLACE FUNCTION public.cancel_financial_refund_authorization(p_source text, p_refund_id bigint, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE affected integer;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_active_user() THEN RAISE EXCEPTION 'Sem permissão para cancelar autorização de restituição.' USING ERRCODE='42501'; END IF;
 IF length(btrim(coalesce(p_reason,'')))<10 THEN RAISE EXCEPTION 'Informe justificativa detalhada.' USING ERRCODE='22023'; END IF;
 IF p_source='manual' THEN
   UPDATE public.invoice_refunds SET status='cancelled',notes=notes||E'\nAutorização cancelada: '||btrim(p_reason)
    WHERE id=p_refund_id AND status='pending' AND request_id IS NOT NULL;
 ELSIF p_source='demurrage' THEN
   UPDATE public.demurrage_refunds SET status='cancelled',notes=notes||E'\nAutorização cancelada: '||btrim(p_reason) WHERE id=p_refund_id AND status='pending';
 ELSE RAISE EXCEPTION 'Origem inválida.' USING ERRCODE='22023'; END IF;
 GET DIAGNOSTICS affected=ROW_COUNT;
 IF affected<>1 THEN RAISE EXCEPTION 'Autorização não está pendente ou foi gerada pela correção do B/L.' USING ERRCODE='22023'; END IF;
 INSERT INTO public.audit_logs(entity_type,entity_id,field_name,new_value,changed_by,justification)
 VALUES(p_source||'_refund',p_refund_id::text,'authorization_cancelled','cancelled',auth.uid(),btrim(p_reason));
END $function$;

CREATE OR REPLACE FUNCTION public.itau_pix_mark_receipt_handled(p_end_to_end_id text, p_note text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_financeiro_user() THEN
    RAISE EXCEPTION 'Sem permissao para tratar o Pix Itau.' USING ERRCODE = '42501';
  END IF;
  IF char_length(btrim(coalesce(p_note, ''))) < 5 THEN
    RAISE EXCEPTION 'Informe o motivo (mínimo de 5 caracteres).' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.itau_pix_receipts WHERE end_to_end_id = p_end_to_end_id AND status = 'review') THEN
    RAISE EXCEPTION 'Pix Itaú não está em análise.' USING ERRCODE = '22023';
  END IF;
  PERFORM public._itau_pix_close_receipt(p_end_to_end_id, left(btrim(p_note), 500), auth.uid());
END;
$function$;

CREATE OR REPLACE FUNCTION public.itau_pix_monitor()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Sem permissao para monitorar o Pix Itau.' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'provider', public._itau_pix_provider(),
    'polled_until', (SELECT itau_pix_polled_until FROM public.app_settings WHERE id = 1),
    'counts', coalesce((SELECT jsonb_object_agg(status, n) FROM (
      SELECT status, count(*) AS n FROM public.itau_pix_charges GROUP BY status) s), '{}'::jsonb),
    -- ponytail: até 200 linhas por lista; paginar se o volume pedir.
    'charges', coalesce((SELECT jsonb_agg(row_to_json(c) ORDER BY c.updated_at) FROM (
      SELECT ch.id, ch.txid, ch.status, ch.uncertain, ch.attempts, ch.last_error, ch.amount_brl,
             ch.next_attempt_at, ch.updated_at,
             CASE WHEN ch.invoice_id IS NOT NULL THEN 'local' ELSE 'demurrage' END AS source,
             coalesce(i.id, d.id) AS invoice_id, coalesce(i.invoice_number, d.doc_number) AS doc_number
      FROM public.itau_pix_charges ch
      LEFT JOIN public.invoices i ON i.id = ch.invoice_id
      LEFT JOIN public.demurrage_invoices d ON d.id = ch.demurrage_invoice_id
      -- Só o que ainda aguarda o banco: cobrança encerrada com erro antigo não pede atenção.
      WHERE ch.status IN ('pending_create', 'pending_update', 'pending_expire_check', 'pending_cancel')
      ORDER BY ch.updated_at LIMIT 200) c), '[]'::jsonb),
    'receipts', coalesce((SELECT jsonb_agg(row_to_json(r) ORDER BY r.paid_at DESC) FROM (
      SELECT end_to_end_id, txid, amount_brl, paid_at, reason
      FROM public.itau_pix_receipts WHERE status = 'review'
      ORDER BY paid_at DESC LIMIT 200) r), '[]'::jsonb));
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
    RAISE EXCEPTION 'Sem permissao de faturamento.' USING ERRCODE = '42501';
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

UPDATE public.alert_type_catalog SET audience_departments = ARRAY['administrativo', 'financeiro', 'documentacao', 'equipamentos'] WHERE type = 'pix_unreconciled';
UPDATE public.alert_type_catalog SET audience_departments = ARRAY['administrativo', 'financeiro'] WHERE type = 'fatura_desatualizada';
UPDATE public.alert_type_catalog SET audience_departments = ARRAY['administrativo', 'financeiro'] WHERE type = 'restituicao_pendente';
