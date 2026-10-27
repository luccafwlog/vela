-- 468: Recebimento e Pix (decisões do dono de 2026-10-27, lote 3 do plano de
-- correções).
--
-- Problema e mudança, por seção:
--   1. 10-recebimento:3 — o Pix que falhava três vezes ao ser gravado só abria o
--      alerta "PIX sem conciliação segura": não aparecia em Pix em análise nem
--      em Pix recebidos, e o Pix de fora do Vela também abria alerta (contra a
--      ADR 0100). Na terceira falha o Pix passa a ser gravado em
--      `itau_pix_receipts`: o do Vela em análise (com o motivo e o alerta do Pix
--      em análise, que fecha pela baixa ou por Marcar como tratado); o de fora,
--      como recebido, sem alerta. Retorno sem valor ou horário legível segue só
--      na fila de falhas, com alerta se for do Vela.
--   2. 10-recebimento:12 — a devolução do Pix em duplicidade era recusada
--      ("Restituição sem lastro no valor recebido.") quando a fatura não tinha
--      recebido nada (cancelada, coberta, substituída, avulsa em cancelamento).
--      O lastro dela passa a ser o próprio Pix, e ela deixa de consumir o
--      lastro das outras restituições da fatura.
--   3. 10-recebimento:11 — o extrato quitava a fatura de Taxas Locais e só
--      depois gravava o identificador da cobrança: a conferência que tira o Pix
--      da análise rodava sem ele e não rodava de novo. Um gatilho na gravação do
--      identificador em fatura paga roda a mesma conferência (como na Demurrage,
--      que grava tudo junto).
--
-- Não altera nem apaga linhas existentes.
--
-- Rollback: reaplicar `itau_pix_receipt_failed_core_425` da `425` (corpo da
-- `358`) e `confirm_invoice_refund` da `136`;
-- DROP TRIGGER itau_pix_close_receipts_on_extract_txid ON public.invoices.

-- 1 --- Pix que falha ao ser gravado vai para Pix recebidos (10-recebimento:3)
CREATE OR REPLACE FUNCTION public.itau_pix_receipt_failed_core_425(p_end_to_end_id text, p_txid text, p_raw jsonb, p_error text, p_permanent boolean DEFAULT false)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_key text := coalesce(nullif(btrim(p_end_to_end_id), ''), 'raw:' || md5(coalesce(p_raw, '{}'::jsonb)::text));
  v_row public.itau_pix_receipt_failures%ROWTYPE;
  v_previous_role text := current_setting('request.jwt.claim.role', true);
  v_e2e text := nullif(btrim(p_end_to_end_id), '');
  v_txid text := coalesce(btrim(p_txid), '');
  v_origin text := public._itau_pix_origin(btrim(p_txid));
  v_amount numeric;
  v_paid_at timestamptz;
  v_horario text;
  v_reason text;
BEGIN
  INSERT INTO public.itau_pix_receipt_failures (failure_key, end_to_end_id, txid, raw, last_error)
  VALUES (v_key, v_e2e, nullif(v_txid, ''), coalesce(p_raw, '{}'::jsonb), left(coalesce(p_error, 'sem motivo'), 500))
  ON CONFLICT (failure_key) DO UPDATE
    SET attempts = itau_pix_receipt_failures.attempts + 1,
        last_error = EXCLUDED.last_error,
        raw = EXCLUDED.raw,
        updated_at = now()
  RETURNING * INTO v_row;

  IF v_row.status <> 'retrying' THEN RETURN 'review'; END IF;
  IF NOT coalesce(p_permanent, false) AND v_row.attempts < 3 THEN RETURN 'retry'; END IF;

  -- Valor e horário do retorno do Itaú; horário sem fuso é o de Brasília, como
  -- na consulta (`itauTimeToUtc`). Retorno ilegível fica só na fila de falhas.
  BEGIN
    v_amount := round((p_raw->>'valor')::numeric, 2);
    v_horario := btrim(p_raw->>'horario');
    v_paid_at := CASE WHEN v_horario ~ '(Z|[+-][0-9]{2}:?[0-9]{2})$' THEN v_horario::timestamptz
                      ELSE (v_horario || '-03:00')::timestamptz END;
  EXCEPTION WHEN OTHERS THEN
    v_amount := NULL; v_paid_at := NULL;
  END;

  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  IF v_e2e ~ '^[A-Za-z0-9]{1,64}$' AND v_amount > 0 AND v_paid_at IS NOT NULL THEN
    -- Mesmo lock da baixa e do recebimento do mesmo Pix.
    PERFORM pg_advisory_xact_lock(hashtextextended('itau_pix_e2e:' || v_e2e, 0));
    v_reason := CASE WHEN v_origin = 'vela' THEN left('Não foi gravado depois de ' || v_row.attempts || ' tentativa(s): '
      || v_row.last_error || '. Confira no extrato e dê a baixa manual com o identificador do Pix.', 500) END;
    -- A cobrança do Vela liga o Pix à fatura: a baixa dela tira o Pix da análise.
    INSERT INTO public.itau_pix_receipts (end_to_end_id, txid, charge_id, amount_brl, paid_at, status, reason, raw)
    VALUES (v_e2e, v_txid, (SELECT ch.id FROM public.itau_pix_charges ch WHERE ch.txid = v_txid), v_amount, v_paid_at, CASE WHEN v_origin = 'vela' THEN 'review' ELSE 'received' END, v_reason, p_raw)
    ON CONFLICT (end_to_end_id) DO NOTHING;
    UPDATE public.itau_pix_receipt_failures SET status = 'handled', updated_at = now() WHERE failure_key = v_key;
    IF v_origin = 'vela' AND FOUND THEN
      PERFORM public.upsert_alert_item('pix_unreconciled', 'itau_pix_receipt', v_e2e,
        'Pix de R$ ' || to_char(v_amount, 'FM999G999G990D00') || ' recebido pelo Itaú (TXID ' || v_txid
          || ') não foi baixado automaticamente: ' || v_reason,
        'itau_pix', 'administrativo',
        jsonb_build_object('end_to_end_id', v_e2e, 'txid', v_txid, 'amount_brl', v_amount, 'error', v_row.last_error),
        '/reconciliacao');
    END IF;
  ELSE
    UPDATE public.itau_pix_receipt_failures SET status = 'review', updated_at = now() WHERE failure_key = v_key;
    -- Pix de fora do Vela não abre alerta (ADR 0100).
    IF v_origin = 'vela' THEN
      PERFORM public.upsert_alert_item('pix_unreconciled', 'itau_pix_receipt_failure', v_key,
        'Recebimento Itaú (TXID ' || coalesce(nullif(v_txid, ''), 'desconhecido')
          || ') não foi baixado depois de ' || v_row.attempts || ' tentativa(s): ' || v_row.last_error
          || '. Confira no extrato e dê a baixa manual; a consulta seguiu para os próximos.',
        'itau_pix', 'administrativo',
        jsonb_build_object('end_to_end_id', p_end_to_end_id, 'txid', p_txid, 'raw', p_raw, 'error', v_row.last_error),
        '/reconciliacao');
    END IF;
  END IF;
  PERFORM set_config('request.jwt.claim.role', coalesce(v_previous_role, ''), true);
  RETURN 'review';
END;
$function$;

-- 2 --- Devolução do Pix em duplicidade tem o próprio Pix como lastro (10-recebimento:12)
CREATE OR REPLACE FUNCTION public.confirm_invoice_refund(p_refund_id bigint, p_bank_reference text, p_beneficiary text, p_paid_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE r public.invoice_refunds%ROWTYPE; v_invoice_id bigint; v_bl_id text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_financeiro_user() THEN RAISE EXCEPTION 'Sem permissão para confirmar restituição.' USING ERRCODE = '42501'; END IF;
  IF length(btrim(coalesce(p_bank_reference, ''))) < 3 OR length(btrim(coalesce(p_beneficiary, ''))) < 3 OR p_paid_at IS NULL OR p_paid_at > now() THEN
    RAISE EXCEPTION 'Informe referência bancária, favorecido e data da devolução efetiva.' USING ERRCODE = '22023'; END IF;
  SELECT invoice_id INTO v_invoice_id FROM public.invoice_refunds WHERE id = p_refund_id;
  FOR v_bl_id IN SELECT DISTINCT bl_id FROM public.invoice_receivable_links WHERE invoice_id = v_invoice_id
     UNION SELECT bl_id FROM public.invoice_bls WHERE invoice_id = v_invoice_id ORDER BY 1 LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('bl:' || v_bl_id,0));
  END LOOP;
  PERFORM pg_advisory_xact_lock(hashtextextended('bank-refund:' || lower(btrim(p_bank_reference)),0));
  PERFORM 1 FROM public.invoices WHERE id = v_invoice_id FOR UPDATE;
  SELECT * INTO r FROM public.invoice_refunds WHERE id = p_refund_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Restituição não encontrada.' USING ERRCODE = 'P0002'; END IF;
  IF r.status = 'settled' AND r.bank_reference = btrim(p_bank_reference) AND r.beneficiary = btrim(p_beneficiary) AND r.settled_at = p_paid_at THEN
    RETURN jsonb_build_object('refund_id', r.id, 'status', 'settled'); END IF;
  IF r.status <> 'pending' THEN RAISE EXCEPTION 'Restituição não está pendente.' USING ERRCODE = '22023'; END IF;
  PERFORM 1 FROM public.invoices WHERE id = r.invoice_id FOR UPDATE;
  -- 468 (10-recebimento:12): a devolução do Pix em duplicidade tem como lastro o
  -- próprio Pix, não o recebido pela fatura (que pode ser zero: cancelada,
  -- coberta, substituída); e ela não consome o lastro das outras restituições.
  IF r.origin = 'pix_duplicate' THEN
    IF r.amount_brl > coalesce((SELECT amount_brl FROM public.itau_pix_receipts WHERE end_to_end_id = r.itau_end_to_end_id), 0) THEN
      RAISE EXCEPTION 'Restituição sem lastro no valor recebido.' USING ERRCODE = '22023'; END IF;
  ELSIF (SELECT coalesce(sum(amount_brl),0) FROM public.invoice_refunds
          WHERE invoice_id = r.invoice_id AND status <> 'cancelled' AND origin IS DISTINCT FROM 'pix_duplicate') >
     (SELECT coalesce(total_paid_brl,0) FROM public.invoices WHERE id = r.invoice_id) THEN
    RAISE EXCEPTION 'Restituição sem lastro no valor recebido.' USING ERRCODE = '22023'; END IF;
  IF EXISTS(SELECT 1 FROM public.demurrage_refunds WHERE status='settled' AND lower(btrim(bank_reference))=lower(btrim(p_bank_reference))) THEN
    RAISE EXCEPTION 'Comprovante de devolução já utilizado.' USING ERRCODE='23505'; END IF;
  UPDATE public.invoice_refunds SET status = 'settled', settled_at = p_paid_at,
    bank_reference = btrim(p_bank_reference), beneficiary = btrim(p_beneficiary), settled_by = auth.uid() WHERE id = r.id;
  INSERT INTO public.audit_logs(entity_type, entity_id, field_name, new_value, changed_by, justification)
    VALUES ('invoice_refund', r.id::text, 'refund_confirmed', jsonb_build_object('reference', btrim(p_bank_reference), 'beneficiary', btrim(p_beneficiary), 'paid_at', p_paid_at, 'amount_brl', r.amount_brl)::text, auth.uid(), 'Devolução bancária confirmada pelo Financeiro');
  RETURN jsonb_build_object('refund_id', r.id, 'status', 'settled');
END $function$;

-- 3 --- Extrato que grava o identificador em fatura paga tira o Pix da análise (10-recebimento:11)
DROP TRIGGER IF EXISTS itau_pix_close_receipts_on_extract_txid ON public.invoices;
CREATE TRIGGER itau_pix_close_receipts_on_extract_txid
  AFTER UPDATE OF pix_txid ON public.invoices
  FOR EACH ROW
  WHEN (NEW.status = 'paid' AND NEW.pix_txid IS NOT NULL AND NEW.pix_txid IS DISTINCT FROM OLD.pix_txid)
  EXECUTE FUNCTION public.itau_pix_close_receipts_on_paid();
