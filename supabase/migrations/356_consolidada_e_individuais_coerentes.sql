-- 356: consolidada e individuais coerentes depois de cada baixa e estorno
-- (ADR 0093, decisões 6, 7 e 8; plano da frente financeira, F-03, F-04, F-11
-- no núcleo e F-44).
--
-- Problema:
--   F-03. Pagamento parcial só reprojetava a fatura paga. Parcial na
--     consolidada deixava as individuais com saldo e QR cheios; parcial na
--     individual deixava a consolidada com o QR antigo, e o Cliente pagava a
--     mais.
--   F-11. Pagar a individual inteira só obsoletava a consolidada; nada era
--     reemitido e a obsoleta sumia do Portal.
--   F-04. "Cancelar baixa" revivia todas as consolidadas obsoletas que
--     tinham algum recebível da fatura, inclusive as de outro pagamento, e
--     reabria vínculos de outras faturas.
--   F-44. O evento `obsolete` era inserido de novo em consolidadas que já
--     estavam obsoletas.
--
-- Mudança:
--   1. `_reproject_invoices_for_receivables` roda depois de cada alocação e
--      de cada estorno, para toda fatura aberta ligada aos recebíveis
--      alterados: a individual mostra o saldo restante do seu B/L (sem saldo,
--      fica Coberta); a consolidada com B/L quitado por fora fica obsoleta e é
--      reemitida com os B/Ls restantes (`replaces_invoice_id`, aviso no Portal);
--      sem B/L quitado, mostra o saldo restante com o mesmo número. O saldo
--      novo regera o QR pelo gatilho de Pix.
--   2. O estorno revive só a consolidada obsoletada por aquele pagamento
--      (evento `obsolete` com `paid_invoice_id`), sem sucessora e sem B/L em
--      outra consolidada aberta; desfaz a cobertura só das individuais
--      cobertas pela própria fatura.
--   3. Um recebível fica em no máximo uma consolidada aberta (gatilho em
--      `invoice_receivable_links`).

CREATE OR REPLACE FUNCTION public._reproject_invoices_for_receivables(p_source_invoice bigint, p_receivable_ids bigint[], p_actor uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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
          UPDATE public.invoices SET obsolete_reason = 'Substituida pela ' || coalesce(v_new_number, v_new_id::text)
           WHERE id = v_inv.id;
          INSERT INTO public.portal_notifications (customer_id, type, title, message, link)
          VALUES (v_inv.customer_id, 'system', 'Fatura consolidada substituída',
            'A fatura ' || coalesce(v_inv.invoice_number, '#' || v_inv.id) || ' foi substituída pela '
              || coalesce(v_new_number, '#' || v_new_id) || ', sem o B/L já pago.', '/portal/billing');
          v_reissued := v_reissued + 1;
        EXCEPTION WHEN OTHERS THEN
          PERFORM public.upsert_alert_item('fatura_desatualizada', 'invoice', v_inv.id::text,
            'Consolidada ' || coalesce(v_inv.invoice_number, v_inv.id::text) || ' ficou obsoleta porque um B/L foi pago na individual, mas a nova consolidada dos B/Ls restantes nao saiu ('
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
$$;
REVOKE ALL ON FUNCTION public._reproject_invoices_for_receivables(bigint, bigint[], uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._reproject_invoices_for_receivables(bigint, bigint[], uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.guard_single_open_consolidated()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status <> 'active' THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM public.invoices i WHERE i.id = NEW.invoice_id AND i.invoice_type = 'consolidated'
               AND coalesce(i.status, 'issued') IN ('draft', 'issued', 'partially_paid'))
     AND EXISTS (SELECT 1 FROM public.invoice_receivable_links l JOIN public.invoices o ON o.id = l.invoice_id
               WHERE l.receivable_id = NEW.receivable_id AND l.invoice_id <> NEW.invoice_id AND l.status = 'active'
                 AND o.invoice_type = 'consolidated' AND coalesce(o.status, 'issued') IN ('draft', 'issued', 'partially_paid')) THEN
    RAISE EXCEPTION 'O B/L % ja esta em outra consolidada aberta.', NEW.bl_id USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_single_open_consolidated() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER guard_single_open_consolidated
  BEFORE INSERT OR UPDATE OF status ON public.invoice_receivable_links
  FOR EACH ROW EXECUTE FUNCTION public.guard_single_open_consolidated();


-- A baixa reprojeta as faturas ligadas (F-03, F-11, F-44).
CREATE OR REPLACE FUNCTION public.register_ledger_invoice_payment_legacy_052(p_invoice_id bigint, p_amount_brl numeric, p_method text DEFAULT 'pix'::text, p_paid_at timestamp with time zone DEFAULT now(), p_pix_txid text DEFAULT NULL::text, p_source text DEFAULT 'manual'::text, p_notes text DEFAULT NULL::text, p_actor uuid DEFAULT NULL::uuid)
 RETURNS jsonb
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
$function$
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp';

-- O estorno desfaz só o que o pagamento causou (F-04).
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
    RAISE EXCEPTION 'Credenciais invalidas ou sem permissao.' USING ERRCODE = '42501';
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
    balance_brl = GREATEST(v_balance, 0),
    -- Libera o TXID conciliado para que o mesmo PIX possa ser reconciliado de novo.
    pix_txid = NULL,
    conciliated_by_extract = false,
    status = CASE
      WHEN COALESCE(v_invoice.status, '') = 'covered' THEN 'covered'
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
