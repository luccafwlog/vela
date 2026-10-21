-- 375: gate, recibo da coberta, cancelamento de avulsa, Pix sem TXID e em
-- duplicidade, reprocesso pelo e-mail de recuperação, ator de sistema e alertas
-- que fecham (plano da frente financeira, F-34 a F-40 e F-52; ADR 0093, decisões 16, 18 e 19).
--
-- Problema e mudança:
--   F-34. O gate do Portal barrava toda volta a "emitida" (estorno de baixa,
--     correção) quando fechado depois da emissão: agora vale só na emissão.
--   F-35. Confirmar o e-mail de recuperação abria o gate sem emitir as
--     retidas: a confirmação reprocessa o Cliente, como a ativação.
--   F-36. O recibo da individual Coberta omitia o pagamento feito direto
--     nela antes da cobertura: soma os dois.
--   F-37 (decisão 19). Autorizar "cancelamento com devolução integral" de
--     avulsa paga em parte não suspendia a cobrança: agora o Pix é cancelado
--     e a fatura não aceita baixa até a autorização ser cancelada; a fatura é
--     cancelada quando a devolução é confirmada (136).
--   F-38 (decisões 16 e 18). Pix sem TXID era descartado pela consulta: vira
--     "Pix recebido sem baixa" com Alerta (`itau_pix_record_untracked`, Edge
--     `itau-pix`). Pix em duplicidade em fatura de Taxas Locais paga, coberta
--     ou cancelada vira recebimento sem fatura aberta, ligado à fatura de
--     origem, com restituição pendente (origem `pix_duplicate`, fora do recibo
--     da fatura); o Pix sai da análise quando a devolução é confirmada.
--   F-52. O reprocessamento do Cliente gravava como emissor o primeiro
--     Administrativo ativo: passa a usar `app_settings.system_billing_actor`
--     (conta de sistema a configurar; sem ela, o primeiro Administrativo,
--     como antes) e grava o motivo no histórico.
--   F-39. `portal_reprocessamento_falhou` só fechava com outro
--     reprocessamento: fecha quando o B/L é faturado.
--   F-40. Restituição de Demurrage pendente não abria Alerta: abre
--     `restituicao_pendente` e fecha quando nada resta pendente.
--
-- Não altera nem apaga linhas existentes.

ALTER TABLE public.app_settings ADD COLUMN system_billing_actor uuid REFERENCES public.user_profiles(id);
COMMENT ON COLUMN public.app_settings.system_billing_actor IS
  'Conta de sistema que emite as faturas reprocessadas (ativação do Portal, e-mail de recuperação). Sem ela, o primeiro Administrativo ativo.';

ALTER TABLE public.invoice_refunds ADD COLUMN itau_end_to_end_id text;
ALTER TABLE public.invoice_refunds DROP CONSTRAINT invoice_refunds_origin_check;
ALTER TABLE public.invoice_refunds ADD CONSTRAINT invoice_refunds_origin_check CHECK (
  origin = 'existing' AND (payment_id IS NULL) <> (cod_adjustment_id IS NULL)
  OR origin = 'correction' AND payment_id IS NULL AND cod_adjustment_id IS NULL AND NULLIF(btrim(notes), '') IS NOT NULL
  OR origin = 'pix_duplicate' AND payment_id IS NULL AND cod_adjustment_id IS NULL AND itau_end_to_end_id IS NOT NULL);

CREATE OR REPLACE FUNCTION public._reprocess_customer_held_billing_as_system(p_customer_id bigint, p_source text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid;
  v_previous_sub text := current_setting('request.jwt.claim.sub', true);
  v_previous_role text := current_setting('request.jwt.claim.role', true);
  v_result jsonb;
BEGIN
  SELECT s.system_billing_actor INTO v_actor FROM public.app_settings s
  JOIN public.user_profiles p ON p.id = s.system_billing_actor AND p.active WHERE s.id = 1;
  IF v_actor IS NULL THEN
    SELECT id INTO v_actor FROM public.user_profiles WHERE active AND role IN ('admin', 'administrativo') ORDER BY created_at, id LIMIT 1;
  END IF;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Não há usuário Administrativo ativo para reprocessar faturamento.' USING ERRCODE = 'P0002'; END IF;
  PERFORM set_config('request.jwt.claim.sub', v_actor::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  v_result := public._reprocess_customer_held_billing(p_customer_id, v_actor, p_source);
  INSERT INTO public.audit_logs (entity_type, entity_id, field_name, new_value, changed_by, justification)
  VALUES ('customer', p_customer_id::text, 'held_billing_reprocessed', v_result::text, v_actor,
    'Reprocesso automático das faturas retidas (' || p_source || ') pela conta de sistema');
  PERFORM set_config('request.jwt.claim.sub', coalesce(v_previous_sub, ''), true);
  PERFORM set_config('request.jwt.claim.role', coalesce(v_previous_role, ''), true);
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public._reprocess_customer_held_billing_as_system(bigint, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._reprocess_customer_held_billing_as_system(bigint, text) TO service_role;

CREATE OR REPLACE FUNCTION public._manual_invoice_cancel_pending(p_invoice_id bigint)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (SELECT 1 FROM public.invoice_refunds r JOIN public.invoices i ON i.id = r.invoice_id
                 WHERE r.invoice_id = p_invoice_id AND i.invoice_type = 'manual' AND r.purpose = 'cancel' AND r.status = 'pending');
$$;
REVOKE ALL ON FUNCTION public._manual_invoice_cancel_pending(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._manual_invoice_cancel_pending(bigint) TO service_role;

-- F-37: a autorização (ou o cancelamento dela) refaz a cobrança Pix da avulsa.
CREATE OR REPLACE FUNCTION public.manual_invoice_cancel_refund_sync()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.purpose = 'cancel' THEN
    UPDATE public.invoices SET pix_payload = NULL WHERE id = NEW.invoice_id AND invoice_type = 'manual';
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.manual_invoice_cancel_refund_sync() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER manual_invoice_cancel_refund_sync
  AFTER INSERT OR UPDATE OF status ON public.invoice_refunds
  FOR EACH ROW EXECUTE FUNCTION public.manual_invoice_cancel_refund_sync();

CREATE OR REPLACE FUNCTION public.guard_payment_on_manual_cancel_pending()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF public._manual_invoice_cancel_pending(NEW.invoice_id) THEN
    RAISE EXCEPTION 'Fatura avulsa em cancelamento com devolução integral: não aceita baixa. Cancele a autorização antes.'
      USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_payment_on_manual_cancel_pending() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER guard_payment_on_manual_cancel_pending
  BEFORE INSERT ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.guard_payment_on_manual_cancel_pending();

-- F-38 (decisão 18): devolução confirmada tira o Pix da análise.
CREATE OR REPLACE FUNCTION public.close_duplicate_pix_on_refund()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.origin = 'pix_duplicate' AND NEW.status = 'settled' AND OLD.status IS DISTINCT FROM 'settled'
     AND EXISTS (SELECT 1 FROM public.itau_pix_receipts WHERE end_to_end_id = NEW.itau_end_to_end_id AND status = 'review') THEN
    PERFORM public._itau_pix_close_receipt(NEW.itau_end_to_end_id, 'Restituição do Pix em duplicidade confirmada.', auth.uid());
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.close_duplicate_pix_on_refund() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER close_duplicate_pix_on_refund
  AFTER UPDATE OF status ON public.invoice_refunds
  FOR EACH ROW EXECUTE FUNCTION public.close_duplicate_pix_on_refund();

-- F-38 (decisão 16): Pix sem TXID do Vela vira "Pix recebido sem baixa".
CREATE OR REPLACE FUNCTION public.itau_pix_record_untracked(p_end_to_end_id text, p_amount_brl numeric, p_paid_at timestamptz)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_existing text; v_previous_role text := current_setting('request.jwt.claim.role', true);
BEGIN
  IF p_end_to_end_id IS NULL OR p_amount_brl IS NULL OR p_amount_brl <= 0 OR p_paid_at IS NULL THEN
    RAISE EXCEPTION 'Recebimento Itaú incompleto.' USING ERRCODE = '22023';
  END IF;
  SELECT status INTO v_existing FROM public.itau_pix_receipts WHERE end_to_end_id = p_end_to_end_id;
  IF FOUND THEN RETURN v_existing; END IF;
  INSERT INTO public.itau_pix_receipts (end_to_end_id, txid, amount_brl, paid_at, status, reason)
  VALUES (p_end_to_end_id, '', round(p_amount_brl, 2), p_paid_at, 'review',
    'Pix sem TXID do Vela: dê a baixa manual na fatura certa ou marque como "não é do Vela".');
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM public.upsert_alert_item('pix_unreconciled', 'itau_pix_receipt', p_end_to_end_id,
    'Pix de R$ ' || to_char(round(p_amount_brl, 2), 'FM999G999G990D00') || ' recebido pelo Itaú sem TXID do Vela: '
      || 'dê a baixa manual na fatura certa ou marque como "não é do Vela".',
    'itau_pix', 'administrativo', jsonb_build_object('end_to_end_id', p_end_to_end_id, 'amount_brl', round(p_amount_brl, 2)),
    '/reconciliacao');
  PERFORM set_config('request.jwt.claim.role', coalesce(v_previous_role, ''), true);
  RETURN 'review';
END;
$$;
REVOKE ALL ON FUNCTION public.itau_pix_record_untracked(text, numeric, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.itau_pix_record_untracked(text, numeric, timestamptz) TO service_role;

-- F-34.
CREATE OR REPLACE FUNCTION public.enforce_portal_invoice_gate()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_gate jsonb;
  v_bl record;
BEGIN
  IF NEW.invoice_type = 'manual' THEN
    RETURN NEW;
  END IF;
  -- F-34 (375): o gate vale para a emissão (nova ou rascunho que vira
  -- emitida). Fatura que volta a emitida (estorno de baixa, correção) não é
  -- barrada pelo gate fechado depois da emissão.
  IF TG_OP = 'UPDATE' AND coalesce(OLD.status, 'draft') <> 'draft' THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'issued' THEN
    IF NEW.bl_id IS NOT NULL THEN
      v_gate := public.portal_billing_gate(NEW.bl_id);
      IF NOT COALESCE((v_gate->>'allowed')::boolean, false) THEN
        RAISE EXCEPTION 'Faturamento bloqueado pelo Portal: %', v_gate->>'reason'
          USING ERRCODE = 'P0003';
      END IF;
    END IF;

    FOR v_bl IN
      SELECT ib.bl_id FROM public.invoice_bls AS ib WHERE ib.invoice_id = NEW.id
    LOOP
      v_gate := public.portal_billing_gate(v_bl.bl_id);
      IF NOT COALESCE((v_gate->>'allowed')::boolean, false) THEN
        RAISE EXCEPTION 'Faturamento bloqueado pelo Portal para B/L %: %', v_bl.bl_id, v_gate->>'reason'
          USING ERRCODE = 'P0003';
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$function$;

-- F-34: a revisão (gate incluído) barra o faturamento, não a volta de "pago"
-- para "faturado" quando a baixa é estornada.
CREATE OR REPLACE FUNCTION public.prevent_pending_review_invoice()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_review_reasons TEXT[];
BEGIN
  IF NEW.financial_status = 'invoiced'
     AND (TG_OP = 'INSERT' OR coalesce(OLD.financial_status, 'pending') = 'pending') THEN
    v_review_reasons := public.compute_bl_review_pendencies(
      NEW.customer_id,
      NEW.cargo_mode,
      NEW.bb_weight_ton
    );

    IF NEW.review_status = 'pending_review'
       OR COALESCE(cardinality(v_review_reasons), 0) > 0 THEN
      RAISE EXCEPTION
        'B/L em revisao manual nao pode ser faturado: %',
        COALESCE(array_to_string(v_review_reasons, ', '), 'revisao pendente')
        USING ERRCODE = '22023';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- F-36 e F-38.
CREATE OR REPLACE FUNCTION public._invoice_financial_summary(p_invoice_id bigint)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
 WITH scope AS (SELECT * FROM public.invoices WHERE id = p_invoice_id), cash AS (
   SELECT coalesce(sum(p.amount_brl),0) received, max(p.paid_at) paid_at FROM public.payments p WHERE p.invoice_id = p_invoice_id
 ), covered AS (
   SELECT coalesce(sum(s.amount_brl),0) received, max(p.paid_at) paid_at FROM public.ledger_settlements s
   JOIN public.payments p ON p.id = s.payment_id JOIN scope i ON i.covered_by_invoice_id = s.invoice_id
   WHERE s.receivable_id IN (SELECT receivable_id FROM public.invoice_receivable_links WHERE invoice_id = p_invoice_id)
 ), refunds AS (
   SELECT coalesce(sum(r.amount_brl) FILTER (WHERE r.status = 'settled'),0) returned,
     coalesce(sum(r.amount_brl) FILTER (WHERE r.status = 'pending'),0) pending
   FROM public.invoice_refunds r JOIN scope i ON (r.invoice_id = i.id AND r.origin <> 'pix_duplicate') OR
    (i.status = 'covered' AND r.invoice_id = i.covered_by_invoice_id AND r.correction_receivable_id IN
      (SELECT receivable_id FROM public.invoice_receivable_links WHERE invoice_id = i.id))
 )
 SELECT jsonb_build_object('gross_received_brl', CASE WHEN i.status = 'covered' THEN covered.received + cash.received ELSE cash.received END,
  'offset_brl', coalesce((SELECT sum(c.offset_brl) FROM public.invoice_corrections c WHERE c.invoice_id = i.id OR c.receivable_id IN (SELECT receivable_id FROM public.invoice_receivable_links WHERE invoice_id = i.id)),0),
  'refunded_brl', refunds.returned, 'pending_refund_brl', refunds.pending,
  'net_received_brl', (CASE WHEN i.status = 'covered' THEN covered.received + cash.received ELSE cash.received END) - refunds.returned,
  'paid_at', CASE WHEN i.status = 'covered' THEN greatest(covered.paid_at, cash.paid_at) ELSE cash.paid_at END,
  'covered_by_invoice_number', (SELECT invoice_number FROM public.invoices WHERE id = i.covered_by_invoice_id))
 FROM scope i CROSS JOIN cash CROSS JOIN covered CROSS JOIN refunds;
$function$;

-- F-37.
CREATE OR REPLACE FUNCTION public.populate_local_invoice_pix_payload()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_txid text;
BEGIN
  IF coalesce(NEW.invoice_type, 'individual') IN ('individual', 'consolidated', 'manual')
     AND public._itau_pix_provider() = 'itau' THEN
    NEW.pix_payload := public._itau_pix_sync(NEW.id, NULL, coalesce(NEW.balance_brl, NEW.total_brl, 0),
      coalesce(NEW.status, 'issued') IN ('issued', 'partially_paid', 'overdue') AND coalesce(NEW.balance_brl, NEW.total_brl, 0) > 0
      -- F-37 (375): avulsa em cancelamento com devolução integral não cobra.
      AND NOT public._manual_invoice_cancel_pending(NEW.id));
    RETURN NEW;
  END IF;
  IF NEW.invoice_type = 'manual' THEN
    IF public._manual_invoice_cancel_pending(NEW.id) THEN
      NEW.pix_payload := NULL;
    ELSIF NEW.pix_payload IS NULL AND NEW.total_brl > 0 THEN
      NEW.pix_payload := public.build_transshipping_pix_payload(NEW.total_brl, NEW.invoice_number);
    END IF;
    RETURN NEW;
  END IF;
  IF coalesce(NEW.invoice_type, 'individual') NOT IN ('individual', 'consolidated') THEN RETURN NEW; END IF;
  IF coalesce(NEW.status, 'issued') NOT IN ('issued', 'partially_paid', 'overdue') OR coalesce(NEW.balance_brl, NEW.total_brl, 0) <= 0 THEN
    NEW.pix_payload := NULL;
  ELSIF TG_OP = 'INSERT' THEN
    NEW.pix_payload := coalesce(NEW.pix_payload, public.build_transshipping_pix_payload(coalesce(NEW.balance_brl, NEW.total_brl), NEW.invoice_number));
  ELSIF NEW.balance_brl IS DISTINCT FROM OLD.balance_brl OR NEW.status IS DISTINCT FROM OLD.status
      OR NEW.pix_payload IS NULL OR NEW.invoice_number IS DISTINCT FROM OLD.invoice_number THEN
    -- Cada apresentação tem identidade própria; pix_txid continua sendo o TXID recebido.
    v_txid := CASE WHEN NOT EXISTS (SELECT 1 FROM public.local_pix_charge_versions WHERE invoice_id = NEW.id)
      THEN left(upper(regexp_replace(NEW.invoice_number, '[^A-Za-z0-9]', '', 'g')), 25)
      ELSE 'VP' || upper(substr(md5(NEW.id::text || clock_timestamp()::text || random()::text), 1, 23)) END;
    NEW.pix_payload := public.build_transshipping_pix_payload(coalesce(NEW.balance_brl, NEW.total_brl), v_txid);
    INSERT INTO public.local_pix_charge_versions(invoice_id, txid, amount_brl, payload)
      VALUES (NEW.id, v_txid, coalesce(NEW.balance_brl, NEW.total_brl), NEW.pix_payload);
  END IF;
  RETURN NEW;
END;
$function$;

-- F-38 (decisão 18).
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
  v_duplicate boolean := false;
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
  -- ADR 0093, decisão 18 (375): Pix em duplicidade em fatura de Taxas Locais
  -- já paga, coberta ou cancelada vira recebimento sem fatura aberta, ligado à
  -- fatura de origem, com restituição pendente.
  ELSIF v_charge.invoice_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.invoices i WHERE i.id = v_charge.invoice_id
      AND i.invoice_type IN ('individual', 'consolidated') AND i.status IN ('paid', 'covered', 'cancelled')) THEN
    v_reason := 'Pix em duplicidade: a fatura de origem já estava paga, coberta ou cancelada. Restituição pendente registrada; o Pix sai da análise quando a devolução for confirmada.';
    v_duplicate := true;
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
  IF v_duplicate THEN
    INSERT INTO public.invoice_refunds (invoice_id, amount_brl, origin, notes, purpose, itau_end_to_end_id)
    VALUES (v_charge.invoice_id, round(p_amount_brl, 2), 'pix_duplicate',
      'Pix em duplicidade recebido pelo Itaú (endToEndId ' || p_end_to_end_id || ') depois de a fatura estar paga, coberta ou cancelada.',
      'correction', p_end_to_end_id);
  END IF;
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

-- F-35 e F-52.
CREATE OR REPLACE FUNCTION public.reprocess_customer_billing_after_portal_activation(p_customer_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Executor server-only.' USING ERRCODE = '42501'; END IF;
  RETURN public._reprocess_customer_held_billing_as_system(p_customer_id, 'portal_activation');
END;
$function$;

CREATE OR REPLACE FUNCTION public.portal_confirm_recovery_email(p_token_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE a public.customer_portal_accounts; i public.portal_invites;
BEGIN
  SELECT * INTO i FROM public.portal_invites WHERE token_hash=p_token_hash AND purpose='confirmacao_email';
  IF NOT FOUND THEN RETURN jsonb_build_object('outcome','link_invalido'); END IF;
  SELECT * INTO a FROM public.customer_portal_accounts WHERE id=i.account_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('outcome','link_invalido'); END IF;
  IF a.pending_recovery_email IS NULL THEN RETURN jsonb_build_object('outcome','pedido_ja_resolvido'); END IF;
  IF a.recovery_reset_invite_id IS NOT NULL THEN
    RAISE EXCEPTION 'Recuperação de senha em andamento. Tente novamente após sua conclusão.' USING ERRCODE='55000';
  END IF;
  UPDATE public.portal_invites SET status='consumido', consumed_at=clock_timestamp()
    WHERE id=i.id AND status='pendente' AND expires_at>clock_timestamp()
      AND lower(btrim(sent_to_email))=lower(btrim(a.pending_recovery_email)) RETURNING * INTO i;
  IF NOT FOUND THEN RETURN jsonb_build_object('outcome','link_invalido'); END IF;
  UPDATE public.customer_portal_accounts SET recovery_email=a.pending_recovery_email,
    pending_recovery_email=NULL,recovery_email_source='informado_manualmente',recovery_email_status='ok' WHERE id=a.id;
  IF a.auth_user_id IS NOT NULL THEN PERFORM public.portal_revoke_sessions(a.auth_user_id); END IF;
  -- F-35 (375): o e-mail confirmado pode abrir o gate; as faturas retidas
  -- saem agora, como na ativação do Portal.
  IF public.customer_billing_access_ready(a.customer_id) THEN
    PERFORM public._reprocess_customer_held_billing_as_system(a.customer_id, 'recovery_email');
  END IF;
  RETURN jsonb_build_object('outcome','aplicar','inviteId',i.id,'account',jsonb_build_object(
    'id',a.id,'customer_id',a.customer_id,'auth_user_id',a.auth_user_id,
    'pending_recovery_email',a.pending_recovery_email,
    'provisioning_decision',a.provisioning_decision,'account_situation',a.account_situation));
END $function$;

-- F-39: a falha de reprocessamento do Portal fecha quando o B/L é faturado
-- (individual ou consolidada), não só com outro reprocessamento.
CREATE OR REPLACE FUNCTION public.resolve_portal_reprocess_alert_on_billing()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_previous_role text := current_setting('request.jwt.claim.role', true);
BEGIN
  IF NEW.bl_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.alert_items ai JOIN public.alerts a ON a.id = ai.alert_id
    WHERE ai.item_type = 'portal_reprocessamento_falhou' AND ai.status = 'active' AND a.entity_type = 'bl' AND a.entity_id = NEW.bl_id) THEN
    -- O faturamento roda com o JWT de quem emite; o Alerta exige executor autorizado.
    PERFORM set_config('request.jwt.claim.role', 'service_role', true);
    PERFORM public.block521_resolve_alert('portal_reprocessamento_falhou', 'bl', NEW.bl_id, 'documentacao', 'bl_invoiced');
    PERFORM set_config('request.jwt.claim.role', coalesce(v_previous_role, ''), true);
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.resolve_portal_reprocess_alert_on_billing() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER resolve_portal_reprocess_alert_on_billing
  AFTER INSERT ON public.invoice_bls
  FOR EACH ROW EXECUTE FUNCTION public.resolve_portal_reprocess_alert_on_billing();
CREATE TRIGGER resolve_portal_reprocess_alert_on_billing
  AFTER INSERT ON public.invoice_receivable_links
  FOR EACH ROW EXECUTE FUNCTION public.resolve_portal_reprocess_alert_on_billing();

-- F-40: restituição de Demurrage pendente abre `restituicao_pendente`, como a
-- de Taxas Locais; fecha quando não resta nada pendente.
CREATE OR REPLACE FUNCTION public.sync_demurrage_refund_alert()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_pending numeric; v_doc text; v_bl text; v_previous_role text := current_setting('request.jwt.claim.role', true);
BEGIN
  SELECT coalesce(sum(amount_brl), 0) INTO v_pending FROM public.demurrage_refunds WHERE invoice_id = NEW.invoice_id AND status = 'pending';
  SELECT doc_number, bl_id INTO v_doc, v_bl FROM public.demurrage_invoices WHERE id = NEW.invoice_id;
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  IF v_pending > 0 THEN
    PERFORM public.upsert_alert_item('restituicao_pendente', 'demurrage_invoice', NEW.invoice_id::text,
      'Restitua R$ ' || to_char(v_pending, 'FM999G999G990D00') || ' ao Cliente: a Invoice de Demurrage ' || coalesce(v_doc, NEW.invoice_id::text)
        || ' tem restituição pendente. Confirme a restituição quando o dinheiro for devolvido.',
      'demurrage_refund', 'administrativo',
      jsonb_build_object('demurrage_invoice_id', NEW.invoice_id, 'bl_id', v_bl, 'pending_brl', v_pending),
      '/demurrage');
  ELSE
    PERFORM public.resolve_alert_item('restituicao_pendente', 'demurrage_invoice', NEW.invoice_id::text, 'refund_settled', '{}'::jsonb);
  END IF;
  PERFORM set_config('request.jwt.claim.role', coalesce(v_previous_role, ''), true);
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.sync_demurrage_refund_alert() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER sync_demurrage_refund_alert
  AFTER INSERT OR UPDATE OF status, amount_brl ON public.demurrage_refunds
  FOR EACH ROW EXECUTE FUNCTION public.sync_demurrage_refund_alert();
