-- 361: consolidada substituída visível no Portal e QR antigo quita a
-- sucessora (ADR 0093, decisão 8; plano da frente financeira, F-11, parte do
-- Portal e do Pix).
--
-- Problema: a consolidada obsoleta sumia do Portal (os vínculos `obsolete`
-- não contavam na visibilidade, 298), e o Pix do QR antigo pago depois da
-- substituição ia para análise.
--
-- Mudança:
--   1. `_portal_invoice_visible` e `_portal_list_invoices_core` contam os
--      vínculos da consolidada obsoleta: ela aparece no filtro "Cancelada",
--      com saldo zero; o detalhe abre sem QR e traz a sucessora
--      (`replaced_by_invoice_id`/`_number`); a lista também.
--   2. `itau_pix_settle`: Pix de cobrança da consolidada obsoleta baixa na
--      sucessora aberta; o que passar do saldo vira restituição pendente (o
--      alocador manual já faz isso).
--
-- Não altera nem apaga linhas existentes.

-- 1. Visibilidade.
CREATE OR REPLACE FUNCTION public._portal_invoice_visible(p_customer_id bigint, p_invoice_id bigint)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH linked AS (
    SELECT ib.bl_id FROM public.invoice_bls ib WHERE ib.invoice_id = p_invoice_id
    UNION
    SELECT irl.bl_id FROM public.invoice_receivable_links irl
    JOIN public.invoices own ON own.id = irl.invoice_id
    WHERE irl.invoice_id = p_invoice_id
      AND (irl.status IN ('active', 'settled_by_this_invoice')
        -- 361: a consolidada substituída continua visível (decisão 8).
        OR (irl.status = 'obsolete' AND own.status = 'obsolete'))
  )
  SELECT EXISTS (
    SELECT 1 FROM public.invoices i
    WHERE i.id = p_invoice_id
      AND i.customer_id = p_customer_id
      AND i.status <> 'draft'
      AND (
        i.invoice_type = 'manual'
        OR (EXISTS (SELECT 1 FROM linked)
            AND NOT EXISTS (SELECT 1 FROM linked WHERE NOT public.bl_has_portal_release(linked.bl_id)))
      )
  );
$function$;

CREATE OR REPLACE FUNCTION public._portal_list_invoices_core(p_customer_id bigint)
 RETURNS TABLE(id bigint, invoice_number text, issued_at timestamp with time zone, total_brl numeric, total_paid_brl numeric, balance_brl numeric, status text, invoice_type text, vessels text[], voyages text[], vessel_voyages text[], bls text[], pods text[])
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  RETURN QUERY
  WITH linked_invoice_bls AS (
    SELECT ib.invoice_id, ib.bl_id
    FROM public.invoice_bls AS ib
    UNION
    SELECT irl.invoice_id, irl.bl_id
    FROM public.invoice_receivable_links AS irl
    JOIN public.invoices AS own ON own.id = irl.invoice_id
    WHERE irl.status IN ('active', 'settled_by_this_invoice')
      -- 361: a consolidada substituída continua visível (decisão 8).
      OR (irl.status = 'obsolete' AND own.status = 'obsolete')
  ),
  manual_context AS (
    SELECT
      i.id AS invoice_id,
      i.bl_id,
      b.pod,
      v.voyage_number,
      vs.name AS vessel_name
    FROM public.invoices AS i
    LEFT JOIN public.bls AS b ON b.id = i.bl_id
    LEFT JOIN public.voyages AS v ON v.id = COALESCE(i.voyage_id, b.voyage_id)
    LEFT JOIN public.vessels AS vs ON vs.id = v.vessel_id
    WHERE i.customer_id = p_customer_id
      AND i.invoice_type = 'manual'
  ),
  eligible_invoices AS (
    SELECT i.id AS invoice_id
    FROM public.invoices AS i
    WHERE i.customer_id = p_customer_id
      -- 298: rascunho não é fatura emitida; o Portal só vê o que foi emitido.
      AND i.status <> 'draft'
      AND (
        i.invoice_type = 'manual'
        OR (
          EXISTS (
            SELECT 1 FROM linked_invoice_bls AS linked
            WHERE linked.invoice_id = i.id
          )
          AND NOT EXISTS (
            SELECT 1 FROM linked_invoice_bls AS linked
            WHERE linked.invoice_id = i.id
              AND NOT public.bl_has_portal_release(linked.bl_id)
          )
        )
      )
  ),
  bl_info AS (
    SELECT ib.invoice_id, ib.bl_id, b.pod, v.voyage_number, vs.name AS vessel_name
    FROM public.invoice_bls AS ib
    JOIN public.bls AS b ON b.id = ib.bl_id
    LEFT JOIN public.voyages AS v ON v.id = b.voyage_id
    LEFT JOIN public.vessels AS vs ON vs.id = v.vessel_id
    UNION ALL
    SELECT irl.invoice_id, irl.bl_id, irl.bl_snapshot->>'pod', v.voyage_number, vs.name
    FROM public.invoice_receivable_links AS irl
    JOIN public.invoices AS own ON own.id = irl.invoice_id
    LEFT JOIN public.voyages AS v ON v.id = (irl.bl_snapshot->>'voyage_id')::bigint
    LEFT JOIN public.vessels AS vs ON vs.id = v.vessel_id
    WHERE irl.status IN ('active', 'settled_by_this_invoice')
      OR (irl.status = 'obsolete' AND own.status = 'obsolete')
    UNION ALL
    SELECT invoice_id, bl_id, pod, voyage_number, vessel_name
    FROM manual_context
  ),
  agg AS (
    SELECT
      bl_info.invoice_id,
      array_agg(DISTINCT bl_info.vessel_name) FILTER (WHERE bl_info.vessel_name IS NOT NULL) AS vessels,
      array_agg(DISTINCT bl_info.voyage_number) FILTER (WHERE bl_info.voyage_number IS NOT NULL) AS voyages,
      array_agg(DISTINCT CASE
        WHEN bl_info.voyage_number IS NOT NULL AND bl_info.vessel_name IS NOT NULL
          THEN bl_info.vessel_name || ' / ' || bl_info.voyage_number
        ELSE bl_info.vessel_name
      END) FILTER (WHERE bl_info.vessel_name IS NOT NULL) AS vessel_voyages,
      array_agg(DISTINCT bl_info.bl_id) FILTER (WHERE bl_info.bl_id IS NOT NULL) AS bls,
      array_agg(DISTINCT bl_info.pod) FILTER (WHERE bl_info.pod IS NOT NULL) AS pods
    FROM bl_info
    GROUP BY bl_info.invoice_id
  )
  SELECT
    i.id,
    i.invoice_number,
    i.issued_at,
    i.total_brl,
    i.total_paid_brl,
    CASE
      WHEN i.status IN ('covered', 'obsolete') THEN 0::numeric
      WHEN i.invoice_type IN ('individual', 'consolidated') AND ledger.link_count > 0
        THEN ledger.balance_brl
      ELSE i.balance_brl
    END AS balance_brl,
    i.status,
    i.invoice_type,
    COALESCE(agg.vessels, '{}'::text[]),
    COALESCE(agg.voyages, '{}'::text[]),
    COALESCE(agg.vessel_voyages, '{}'::text[]),
    COALESCE(agg.bls, '{}'::text[]),
    COALESCE(agg.pods, '{}'::text[])
  FROM public.invoices AS i
  JOIN eligible_invoices AS eligible ON eligible.invoice_id = i.id
  LEFT JOIN agg ON agg.invoice_id = i.id
  LEFT JOIN LATERAL (
    SELECT
      COUNT(*) AS link_count,
      COALESCE(SUM(COALESCE(br.balance_brl, 0)), 0) AS balance_brl
    FROM public.invoice_receivable_links AS irl
    JOIN public.bl_receivables AS br ON br.id = irl.receivable_id
    WHERE irl.invoice_id = i.id AND irl.status = 'active'
  ) AS ledger ON true
  WHERE i.customer_id = p_customer_id
  ORDER BY i.created_at DESC;
END;
$function$;

CREATE OR REPLACE FUNCTION public._portal_list_invoices_page_core(p_customer_id bigint, p_limit integer DEFAULT 25, p_offset integer DEFAULT 0, p_status text DEFAULT NULL::text, p_vessel text DEFAULT NULL::text, p_bl text DEFAULT NULL::text, p_pod text DEFAULT NULL::text, p_date_from date DEFAULT NULL::date, p_date_to date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_limit INTEGER := LEAST(GREATEST(COALESCE(p_limit, 25), 1), 100);
  v_offset INTEGER := GREATEST(COALESCE(p_offset, 0), 0);
BEGIN
  RETURN (
    WITH all_rows AS MATERIALIZED (
      SELECT r.*
      FROM public._portal_list_invoices_core(p_customer_id) AS r
    ),
    filtered AS MATERIALIZED (
      SELECT r.*
      FROM all_rows AS r
      WHERE (
        (NULLIF(BTRIM(p_status), '') IS NULL AND r.status NOT IN ('cancelled', 'obsolete'))
        OR (p_status = 'issued' AND r.status IN ('issued', 'partially_paid', 'draft'))
        OR (p_status = 'paid' AND r.status IN ('paid', 'covered'))
        OR (p_status = 'cancelled' AND r.status IN ('cancelled', 'obsolete'))
      )
      AND (
        NULLIF(BTRIM(p_vessel), '') IS NULL
        OR EXISTS (
          SELECT 1
          FROM unnest(COALESCE(r.vessel_voyages, '{}'::TEXT[])) AS value
          WHERE POSITION(LOWER(BTRIM(p_vessel)) IN LOWER(value)) > 0
        )
      )
      AND (
        NULLIF(BTRIM(p_bl), '') IS NULL
        OR EXISTS (
          SELECT 1
          FROM unnest(COALESCE(r.bls, '{}'::TEXT[])) AS value
          WHERE POSITION(LOWER(BTRIM(p_bl)) IN LOWER(value)) > 0
        )
      )
      AND (NULLIF(BTRIM(p_pod), '') IS NULL OR BTRIM(p_pod) = ANY(COALESCE(r.pods, '{}'::TEXT[])))
      AND (p_date_from IS NULL OR r.issued_at::DATE >= p_date_from)
      AND (p_date_to IS NULL OR r.issued_at::DATE <= p_date_to)
    ),
    page_rows AS (
      SELECT f.*, cov.invoice_number AS covered_by_invoice_number,
        rep.id AS replaced_by_invoice_id, rep.invoice_number AS replaced_by_invoice_number
      FROM filtered AS f
      JOIN public.invoices AS inv ON inv.id = f.id
      LEFT JOIN public.invoices AS cov ON cov.id = inv.covered_by_invoice_id
        AND f.status = 'covered'
        AND public._portal_invoice_visible(p_customer_id, cov.id)
      -- 361: a substituída mostra a sucessora (decisão 8).
      LEFT JOIN LATERAL (
        SELECT s.id, s.invoice_number FROM public.invoices AS s
        WHERE s.replaces_invoice_id = inv.id AND f.status = 'obsolete'
          AND public._portal_invoice_visible(p_customer_id, s.id)
        ORDER BY s.id DESC LIMIT 1
      ) AS rep ON true
      ORDER BY f.issued_at DESC NULLS LAST, f.id DESC
      LIMIT v_limit OFFSET v_offset
    )
    SELECT jsonb_build_object(
      'rows', COALESCE((SELECT jsonb_agg(to_jsonb(page_rows) ORDER BY page_rows.issued_at DESC NULLS LAST, page_rows.id DESC) FROM page_rows), '[]'::JSONB),
      'total_count', (SELECT COUNT(*) FROM filtered),
      'vessel_options', COALESCE((
        SELECT jsonb_agg(value ORDER BY value)
        FROM (
          SELECT DISTINCT value
          FROM all_rows AS r, unnest(COALESCE(r.vessel_voyages, '{}'::TEXT[])) AS value
          WHERE value IS NOT NULL AND value <> ''
        ) AS options
      ), '[]'::JSONB),
      'pods', COALESCE((
        SELECT jsonb_agg(value ORDER BY value)
        FROM (
          SELECT DISTINCT value
          FROM all_rows AS r, unnest(COALESCE(r.pods, '{}'::TEXT[])) AS value
          WHERE value IS NOT NULL AND value <> ''
        ) AS options
      ), '[]'::JSONB)
    )
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public._portal_invoice_details_legacy_183(p_customer_id bigint, p_invoice_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  result jsonb;
  v_covered_by bigint;
  v_covered_by_number text;
BEGIN
  result := public._portal_invoice_details_legacy_134(p_customer_id, p_invoice_id);
  result := result || jsonb_build_object('financial_summary', public._invoice_financial_summary(p_invoice_id));

  IF result #>> '{invoice,status}' = 'covered' THEN
    SELECT cov.id, cov.invoice_number INTO v_covered_by, v_covered_by_number
    FROM public.invoices AS i
    JOIN public.invoices AS cov ON cov.id = i.covered_by_invoice_id
    WHERE i.id = p_invoice_id
      AND public._portal_invoice_visible(p_customer_id, cov.id);
    -- A coberta não cobra mais nada: o saldo do B/L foi quitado pela consolidada.
    result := jsonb_set(result, '{invoice}', (result->'invoice') || jsonb_build_object(
      'balance_brl', 0,
      'covered_by_invoice_id', v_covered_by,
      'covered_by_invoice_number', v_covered_by_number
    ));
  END IF;

  -- 361: a consolidada substituída abre sem QR e aponta a sucessora (decisão 8).
  IF result #>> '{invoice,status}' = 'obsolete' THEN
    SELECT s.id, s.invoice_number INTO v_covered_by, v_covered_by_number
    FROM public.invoices AS s
    WHERE s.replaces_invoice_id = p_invoice_id
      AND public._portal_invoice_visible(p_customer_id, s.id)
    ORDER BY s.id DESC LIMIT 1;
    result := jsonb_set(result, '{invoice}', (result->'invoice') || jsonb_build_object(
      'balance_brl', 0,
      'pix_payload', NULL,
      'replaced_by_invoice_id', v_covered_by,
      'replaced_by_invoice_number', v_covered_by_number
    ));
  END IF;

  RETURN result;
END
$function$;

-- 2. QR antigo quita a sucessora.
CREATE OR REPLACE FUNCTION public.itau_pix_settle(p_end_to_end_id text, p_txid text, p_amount_brl numeric, p_paid_at timestamp with time zone)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_existing text;
  v_charge public.itau_pix_charges%ROWTYPE;
  v_invoice_type text;
  v_successor bigint;
  v_actor uuid;
  v_previous_sub text := current_setting('request.jwt.claim.sub', true);
  v_result jsonb;
  v_reason text;
  v_request uuid := md5('itau-pix:' || p_end_to_end_id)::uuid;
BEGIN
  IF p_end_to_end_id IS NULL OR p_txid IS NULL OR p_amount_brl IS NULL OR p_paid_at IS NULL THEN
    RAISE EXCEPTION 'Recebimento Itaú incompleto.' USING ERRCODE = '22023';
  END IF;
  -- Mesma ordem de lock para o mesmo Pix: execuções concorrentes esperam.
  PERFORM pg_advisory_xact_lock(hashtextextended('itau_pix_e2e:' || p_end_to_end_id, 0));
  SELECT status INTO v_existing FROM public.itau_pix_receipts WHERE end_to_end_id = p_end_to_end_id;
  IF FOUND THEN RETURN v_existing; END IF;

  SELECT * INTO v_charge FROM public.itau_pix_charges WHERE txid = p_txid FOR UPDATE;
  IF FOUND THEN
    -- O Pix existe no banco: a cobrança está paga, haja baixa ou análise.
    -- Marcar antes da baixa evita que o gatilho do QR a veja como aberta e
    -- tente cancelá-la no Itaú.
    UPDATE public.itau_pix_charges SET status = 'concluded', updated_at = now() WHERE id = v_charge.id;
  END IF;
  IF v_charge.id IS NULL THEN
    v_reason := 'TXID do Vela sem cobrança registrada.';
  -- Demurrage: a cobrança guarda a revisão mais nova; o pagamento da revisão
  -- anterior é válido e register_demurrage_payment confere a janela de PTAX.
  ELSIF v_charge.invoice_id IS NOT NULL AND round(p_amount_brl, 2) <> v_charge.amount_brl THEN
    v_reason := 'Valor recebido difere do valor da cobrança.';
  ELSE
    BEGIN
      -- F-05: o mesmo Pix não é baixado duas vezes (extrato ou baixa manual
      -- com o endToEndId na referência).
      IF v_charge.invoice_id IS NOT NULL AND (
           EXISTS (SELECT 1 FROM public.payments p
                   WHERE upper(btrim(coalesce(p.bank_reference, ''))) = upper(btrim(p_end_to_end_id)))
           OR EXISTS (SELECT 1 FROM public.invoices i
                      WHERE i.id = v_charge.invoice_id AND i.invoice_type = 'manual'
                        AND public.normalize_pix_txid(i.pix_txid) = public.normalize_pix_txid(p_txid))) THEN
        RAISE EXCEPTION 'Pix ja baixado nesta fatura (mesmo TXID ou endToEndId): confira antes de baixar de novo.'
          USING ERRCODE = 'P0001';
      END IF;
      IF v_charge.demurrage_invoice_id IS NOT NULL THEN
        v_result := public.register_demurrage_payment(v_request, v_charge.demurrage_invoice_id,
          (p_paid_at AT TIME ZONE 'America/Sao_Paulo')::date, p_txid, round(p_amount_brl, 2), NULL);
      ELSE
        SELECT itau_pix_settlement_actor INTO v_actor FROM public.app_settings WHERE id = 1;
        IF v_actor IS NULL THEN
          RAISE EXCEPTION 'Usuário de baixa automática Itaú não configurado.';
        END IF;
        PERFORM set_config('request.jwt.claim.sub', v_actor::text, true);
        SELECT invoice_type INTO v_invoice_type FROM public.invoices WHERE id = v_charge.invoice_id;
        IF v_invoice_type = 'manual' THEN
          v_result := public.register_verified_invoice_payment(v_charge.invoice_id, round(p_amount_brl, 2), 'pix',
            p_paid_at, 'Baixa automática Itaú Pix', v_request, p_end_to_end_id);
        ELSIF EXISTS (SELECT 1 FROM public.invoices WHERE id = v_charge.invoice_id AND status = 'obsolete') THEN
          -- 361 (decisão 8): QR da consolidada substituída quita a sucessora
          -- aberta; o excedente vira restituição pendente.
          WITH RECURSIVE chain AS (
            SELECT s.id, s.status, 1 AS depth FROM public.invoices s WHERE s.replaces_invoice_id = v_charge.invoice_id
            UNION ALL
            SELECT s.id, s.status, c.depth + 1 FROM chain c JOIN public.invoices s ON s.replaces_invoice_id = c.id
            WHERE c.depth < 50
          )
          SELECT id INTO v_successor FROM chain WHERE status IN ('issued', 'partially_paid') ORDER BY depth DESC LIMIT 1;
          IF v_successor IS NULL THEN
            RAISE EXCEPTION 'Consolidada substituída sem sucessora aberta para receber o Pix.';
          END IF;
          v_result := public.register_ledger_invoice_payment(v_successor, round(p_amount_brl, 2), 'pix', p_paid_at, NULL,
            'manual', 'Pix do QR da consolidada substituída ' || v_charge.invoice_id || ' (baixa automática Itaú Pix)', v_actor);
          UPDATE public.payments SET bank_reference = p_end_to_end_id WHERE id = (v_result->>'payment_id')::bigint;
        ELSE
          v_result := public.reconcile_invoice_payment_by_txid(p_txid, round(p_amount_brl, 2), p_paid_at);
          IF coalesce((v_result->>'settled')::boolean, false) IS NOT TRUE THEN
            RAISE EXCEPTION 'Conciliação recusou: %', coalesce(v_result->>'reason', 'sem motivo');
          END IF;
          UPDATE public.payments SET bank_reference = p_end_to_end_id,
            notes = coalesce(notes || ' · ', '') || 'Baixa automática Itaú Pix'
          WHERE id = (v_result->'payment'->>'payment_id')::bigint;
        END IF;
        PERFORM set_config('request.jwt.claim.sub', coalesce(v_previous_sub, ''), true);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      -- Mesma regra da 152: erro passageiro falha a chamada para nova tentativa.
      IF left(SQLSTATE, 2) IN ('08', '40', '53', '55', '57', 'XX') THEN RAISE; END IF;
      -- Desfaz só a baixa; a cobrança continua 'concluded' (paga no banco).
      PERFORM set_config('request.jwt.claim.sub', coalesce(v_previous_sub, ''), true);
      v_reason := left(SQLERRM, 300);
    END;
  END IF;

  INSERT INTO public.itau_pix_receipts(end_to_end_id, txid, charge_id, amount_brl, paid_at, status, reason, result)
  VALUES (p_end_to_end_id, p_txid, v_charge.id, round(p_amount_brl, 2), p_paid_at,
    CASE WHEN v_reason IS NULL THEN 'settled' ELSE 'review' END, v_reason, v_result);
  IF v_reason IS NOT NULL THEN
    PERFORM public.upsert_alert_item('pix_unreconciled', 'itau_pix_receipt', p_end_to_end_id,
      'Pix de R$ ' || to_char(round(p_amount_brl, 2), 'FM999G999G990D00') || ' recebido pelo Itaú (TXID ' || p_txid
        || ') não foi baixado automaticamente: ' || v_reason,
      'itau_pix', 'administrativo',
      jsonb_build_object('end_to_end_id', p_end_to_end_id, 'txid', p_txid, 'amount_brl', round(p_amount_brl, 2),
        'invoice_id', v_charge.invoice_id, 'demurrage_invoice_id', v_charge.demurrage_invoice_id),
      '/reconciliacao');
    RETURN 'review';
  END IF;
  RETURN 'settled';
END;
$function$;
