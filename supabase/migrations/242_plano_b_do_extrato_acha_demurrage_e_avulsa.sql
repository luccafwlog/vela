-- 242: o plano B pelo extrato acha a Invoice de Demurrage e a fatura avulsa
-- pelo TXID da cobrança (item A16 do plano de correções; ADR 0083, item 16).
--
-- Problema: o matching do extrato e "Escolher fatura…" só achavam a fatura
-- individual e a consolidada com versão de cobrança
-- (`local_pix_charge_versions`) ou documento com o TXID já gravado na baixa
-- (`pix_txid`). A Invoice de Demurrage aberta (QR estático, cujo TXID é o
-- número do documento, ou QR Itaú, cujo TXID `VELA…` fica em
-- `itau_pix_charges`) e a avulsa cobrada pelo QR Itaú viravam "Sem
-- documento" quando a consulta do Itaú parava.
--
-- Mudança:
-- 1. `_pix_txid_open_candidates(txid)` é a resolução única do TXID nas
--    faturas abertas: versão de cobrança local (`resolve_local_pix_charge`);
--    fatura local com o TXID gravado; avulsa pelo número (QR estático) ou pela
--    cobrança Itaú; Invoice de Demurrage emitida pelo número do documento (QR
--    estático), pela cobrança Itaú ou pelo TXID gravado.
-- 2. `list_pix_txid_candidates(txids)` devolve essa resolução para o matching
--    do extrato (`matchUnifiedPixTransactions`), no lugar de
--    `list_local_pix_candidates` e das leituras diretas de `pix_txid`.
-- 3. `list_pix_reconciliation_candidates` ("Escolher fatura…") lista as
--    faturas abertas da mesma resolução.
-- 4. `link_pix_reconciliation_candidate` aceita a candidata da mesma
--    resolução (inclusive avulsa e Invoice de Demurrage sem TXID gravado).
-- 5. A baixa da avulsa por TXID (`reconcile_invoice_payment_by_txid_legacy_130`)
--    também acha a avulsa pela cobrança Itaú.
-- A guarda de cada RPC é a vigente (o P5 abre a Conciliação ao Financeiro).
--
-- Só cria e redefine funções; não reescreve nem apaga linhas.
-- Rollback: reaplicar as definições anteriores das três RPCs (migrations
-- 002 e 130) e DROP das duas funções novas.

-- 1. Resolução única do TXID nas faturas abertas.
CREATE OR REPLACE FUNCTION public._pix_txid_open_candidates(p_txid text)
RETURNS TABLE(source text, invoice_id bigint, doc_number text, amount_brl numeric, customer_id bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH t AS (SELECT public.normalize_pix_txid(p_txid) AS txid),
  local_candidates AS (
    -- Versão de cobrança (individual e consolidada, migration 130).
    SELECT i.id, COALESCE(i.invoice_number, i.id::text) AS doc_number, r.expected_brl AS amount_brl, i.customer_id
    FROM t CROSS JOIN LATERAL public.resolve_local_pix_charge(t.txid) AS r
    JOIN public.invoices AS i ON i.id = r.invoice_id
    UNION ALL
    -- Fatura aberta com o TXID gravado, ou avulsa pelo número (QR estático)
    -- ou pela cobrança Itaú.
    SELECT i.id, COALESCE(i.invoice_number, i.id::text), COALESCE(i.balance_brl, i.total_brl, 0), i.customer_id
    FROM t JOIN public.invoices AS i ON true
    WHERE t.txid <> ''
      AND i.invoice_type IN ('individual', 'consolidated', 'manual')
      AND COALESCE(i.status, 'issued') IN ('issued', 'partially_paid', 'overdue')
      AND NOT EXISTS (SELECT 1 FROM public.local_pix_charge_versions AS v WHERE v.txid = t.txid)
      AND (public.normalize_pix_txid(i.pix_txid) = t.txid
        OR (i.invoice_type = 'manual' AND (
          upper(left(regexp_replace(COALESCE(i.invoice_number, ''), '[^A-Za-z0-9]', '', 'g'), 25)) = t.txid
          OR EXISTS (SELECT 1 FROM public.itau_pix_charges AS c
                     WHERE c.invoice_id = i.id AND public.normalize_pix_txid(c.txid) = t.txid))))
  ),
  demurrage_candidates AS (
    SELECT d.id, d.doc_number, COALESCE(d.current_total_brl, 0) AS amount_brl, d.customer_id
    FROM t JOIN public.demurrage_invoices AS d ON true
    WHERE t.txid <> ''
      AND COALESCE(d.status, 'issued') IN ('issued', 'overdue')
      AND (upper(left(regexp_replace(COALESCE(d.doc_number, ''), '[^A-Za-z0-9]', '', 'g'), 25)) = t.txid
        OR public.normalize_pix_txid(d.pix_txid) = t.txid
        OR EXISTS (SELECT 1 FROM public.itau_pix_charges AS c
                   WHERE c.demurrage_invoice_id = d.id AND public.normalize_pix_txid(c.txid) = t.txid))
  )
  SELECT DISTINCT ON (source, id) source, id, doc_number, amount_brl, customer_id
  FROM (
    SELECT 'local'::text AS source, id, doc_number, amount_brl, customer_id FROM local_candidates
    UNION ALL
    SELECT 'demurrage'::text, id, doc_number, amount_brl, customer_id FROM demurrage_candidates
  ) AS all_candidates
  ORDER BY source, id;
$function$;

REVOKE ALL ON FUNCTION public._pix_txid_open_candidates(text) FROM PUBLIC, anon, authenticated;

-- 2. Candidatas do matching do extrato.
CREATE OR REPLACE FUNCTION public.list_pix_txid_candidates(p_txids text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin() THEN
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

REVOKE ALL ON FUNCTION public.list_pix_txid_candidates(text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_pix_txid_candidates(text[]) TO authenticated;


-- 3. Escolher fatura… lista as faturas abertas da resolução única.
CREATE OR REPLACE FUNCTION public.list_pix_reconciliation_candidates(p_exception_id bigint)
 RETURNS TABLE(source text, invoice_id bigint, doc_number text, amount_brl numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_exception public.pix_reconciliation_exceptions%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin() THEN
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

-- 4. O vínculo aceita a candidata da resolução única.
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
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin() THEN
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

-- 5. Baixa da avulsa pelo TXID da cobrança Itaú.
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
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin() THEN
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
