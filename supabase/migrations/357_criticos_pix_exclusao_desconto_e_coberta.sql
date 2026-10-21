-- 357: críticos restantes do lote 1 da frente financeira (F-05 a F-08) e a
-- data de São Paulo na foto do desconto de Demurrage (F-22, no mesmo corpo).
--
-- Problema e mudança:
--   F-05. O mesmo Pix de avulsa era baixado duas vezes: pelo extrato (ou
--     baixa manual com o endToEndId na referência) e depois pelo Itaú, com
--     restituição falsa. `itau_pix_settle` passa a mandar para análise o Pix
--     cujo endToEndId já é referência de uma baixa ou cujo TXID já conciliou a
--     avulsa; o extrato que baixa avulsa cobrada pelo QR Itaú marca a cobrança
--     como concluída.
--   F-06. Excluir o B/L irmão de container compartilhado não corrigia o
--     vizinho faturado: a captura da base procurava a Viagem em `bls`, já
--     apagado. A captura passa a rodar antes da exclusão do B/L e a correção
--     roda no fim da transação (ADR 0078, item 11).
--   F-07. Revogar o desconto de Demurrage deixava o valor com desconto quitar
--     a Invoice: a janela de fotos aceitava a anterior à revogação. Agora a
--     janela começa na última mudança de desconto (foto cujo desconto
--     difere da anterior).
--   F-08. Individual coberta podia ser cancelada, e o B/L era faturado de
--     novo. O cancelamento recusa fatura coberta e fatura cujos recebíveis
--     já têm baixa por outro documento.
--   F-22. A foto do desconto usava a data UTC; passa a usar a de Brasília,
--     como a isenção.

-- F-05: Itaú não baixa de novo o Pix já baixado.
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

-- F-05: extrato de avulsa conclui a cobrança Itaú.
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

-- F-22: foto do desconto na data de Brasília.
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

-- F-06: base dos vizinhos capturada antes de o B/L sair; correção no fim da transação.
CREATE TRIGGER capture_invoice_basis_on_delete
  BEFORE DELETE ON public.bls
  FOR EACH ROW EXECUTE FUNCTION public.capture_invoice_basis();
CREATE CONSTRAINT TRIGGER process_invoice_basis_changes_on_delete
  AFTER DELETE ON public.bls
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.process_invoice_basis_changes_at_commit();

-- F-07: a janela de fotos começa na última mudança de desconto até a data
-- (a foto cujo desconto difere da anterior).
CREATE OR REPLACE FUNCTION public.get_demurrage_recent_values(p_invoice_id bigint, p_date date)
RETURNS TABLE(total_brl numeric, event_date date, ptax_used numeric)
LANGUAGE sql STABLE
SET search_path = public, pg_temp
AS $$
  WITH h AS (
    SELECT x.id, x.total_brl, x.event_date, x.ptax_used, x.discount_usd,
      lag(x.discount_usd) OVER (ORDER BY x.id) AS previous_discount
    FROM public.demurrage_invoice_history x
    WHERE x.invoice_id = p_invoice_id AND x.event_date <= p_date
  )
  SELECT h.total_brl, h.event_date, h.ptax_used
  FROM h
  WHERE h.id >= coalesce((SELECT max(c.id) FROM h c WHERE c.previous_discount IS DISTINCT FROM c.discount_usd
                            AND c.previous_discount IS NOT NULL), 0)
  ORDER BY h.event_date DESC, h.id DESC
  LIMIT 2;
$$;

-- F-08: fatura coberta ou com recebível baixado por outro documento não se cancela.
CREATE OR REPLACE FUNCTION public.guard_cancel_settled_elsewhere()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled' THEN
    IF OLD.status = 'covered' THEN
      RAISE EXCEPTION 'Fatura % coberta por outro documento pago: o B/L ja foi pago e ela nao pode ser cancelada.',
        coalesce(OLD.invoice_number, OLD.id::text) USING ERRCODE = '22023';
    END IF;
    -- A individual cancelada soltaria o B/L para nova fatura; a consolidada
    -- cancelada devolve o B/L às individuais, que continuam.
    IF OLD.invoice_type = 'individual' AND EXISTS (
      SELECT 1 FROM public.invoice_receivable_links l
      JOIN public.ledger_settlements s ON s.receivable_id = l.receivable_id AND s.invoice_id <> OLD.id
      WHERE l.invoice_id = OLD.id AND l.status IN ('active', 'settled_elsewhere')) THEN
      RAISE EXCEPTION 'Fatura % tem B/L com baixa em outro documento; cancele a baixa naquele documento antes.',
        coalesce(OLD.invoice_number, OLD.id::text) USING ERRCODE = '22023';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_cancel_settled_elsewhere() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER guard_cancel_settled_elsewhere
  BEFORE UPDATE OF status ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.guard_cancel_settled_elsewhere();
