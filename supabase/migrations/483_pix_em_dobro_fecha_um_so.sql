-- 483: Pix em dobro na mesma cobrança fecha um só (revisão da PR #1070,
-- achado A1; decisão do dono de 2026-10-27; ADR 0093, decisão 17).
--
-- Problema: `itau_pix_close_receipts_on_paid` fechava todo Pix em análise
-- cujo TXID batia com o da fatura paga. Com dois Pix pagos no mesmo QR e os
-- dois em análise, a baixa da fatura (pelo extrato, gatilho da 471, ou pela
-- baixa manual com o TXID já gravado) fechava os dois, e o Pix em
-- duplicidade sumia sem restituição e sem alerta.
--
-- Mudança: o Pix cujo endToEndId está na referência de um pagamento da fatura
-- fecha (é aquela baixa). Pelo TXID só fecha um: o mais antigo, e só se
-- nenhum Pix da cobrança já pagou a fatura. Os demais da fatura de Taxas
-- Locais seguem como na baixa normal (`itau_pix_settle_core_425`): continuam em
-- análise com o motivo do Pix em duplicidade, ganham a Restituição
-- `pix_duplicate` e o alerta; saem da análise quando a devolução é confirmada
-- (`close_duplicate_pix_on_refund`). Na Invoice de Demurrage o excedente
-- continua em análise para o Financeiro, como antes da 471.
--
-- Não reescreve dados existentes.
--
-- Rollback: reaplicar `itau_pix_close_receipts_on_paid` da `360`.

CREATE OR REPLACE FUNCTION public.itau_pix_close_receipts_on_paid()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_receipt record;
  v_is_invoice boolean := TG_TABLE_NAME = 'invoices';
  v_paid_by_pix boolean;
  v_reason text := 'Pix em duplicidade: a fatura de origem já estava paga, coberta ou cancelada. Restituição pendente registrada; o Pix sai da análise quando a devolução for confirmada.';
BEGIN
  -- Algum Pix da cobrança já pagou esta fatura (baixa automática ou fechado
  -- por esta mesma regra numa chamada anterior)?
  SELECT EXISTS (
    SELECT 1 FROM public.itau_pix_receipts r
    JOIN public.itau_pix_charges c ON c.id = r.charge_id
    WHERE (CASE WHEN v_is_invoice THEN c.invoice_id ELSE c.demurrage_invoice_id END) = NEW.id
      AND (r.status = 'settled' OR (r.status = 'handled' AND r.handled_note = 'Fatura paga pela baixa deste Pix.'))
  ) INTO v_paid_by_pix;

  FOR v_receipt IN
    SELECT r.end_to_end_id, r.txid, r.amount_brl,
      CASE WHEN v_is_invoice THEN
        EXISTS (SELECT 1 FROM public.payments p WHERE p.invoice_id = NEW.id
                AND upper(btrim(coalesce(p.bank_reference, ''))) = upper(r.end_to_end_id))
      ELSE upper(btrim(coalesce(NEW.pix_txid, ''))) = upper(r.end_to_end_id) END AS by_reference
    FROM public.itau_pix_receipts r
    JOIN public.itau_pix_charges c ON c.id = r.charge_id
    WHERE r.status = 'review'
      AND CASE WHEN v_is_invoice THEN
        c.invoice_id = NEW.id AND (
          EXISTS (SELECT 1 FROM public.payments p WHERE p.invoice_id = NEW.id
                  AND upper(btrim(coalesce(p.bank_reference, ''))) = upper(r.end_to_end_id))
          OR public.normalize_pix_txid(NEW.pix_txid) = public.normalize_pix_txid(r.txid))
      ELSE
        c.demurrage_invoice_id = NEW.id AND (
          upper(btrim(coalesce(NEW.pix_txid, ''))) = upper(r.end_to_end_id)
          OR public.normalize_pix_txid(NEW.pix_txid) = public.normalize_pix_txid(r.txid))
      END
    ORDER BY 4 DESC, r.paid_at, r.created_at, r.end_to_end_id
  LOOP
    IF v_receipt.by_reference OR NOT v_paid_by_pix THEN
      PERFORM public._itau_pix_close_receipt(v_receipt.end_to_end_id, 'Fatura paga pela baixa deste Pix.', auth.uid());
      v_paid_by_pix := true;
    ELSIF v_is_invoice THEN
      -- Mesma ordem de lock da baixa normal para o mesmo Pix.
      PERFORM pg_advisory_xact_lock(hashtextextended('itau_pix_e2e:' || v_receipt.end_to_end_id, 0));
      IF NOT EXISTS (SELECT 1 FROM public.invoice_refunds f
                     WHERE f.origin = 'pix_duplicate' AND f.itau_end_to_end_id = v_receipt.end_to_end_id
                       AND f.status <> 'cancelled') THEN
        INSERT INTO public.invoice_refunds (invoice_id, amount_brl, origin, notes, purpose, itau_end_to_end_id)
        VALUES (NEW.id, v_receipt.amount_brl, 'pix_duplicate',
          'Pix recebido pelo Itaú (endToEndId ' || v_receipt.end_to_end_id || ') pagou de novo a fatura já paga por outro Pix da mesma cobrança.',
          'correction', v_receipt.end_to_end_id);
      END IF;
      UPDATE public.itau_pix_receipts SET reason = v_reason WHERE end_to_end_id = v_receipt.end_to_end_id;
      PERFORM public.upsert_alert_item('pix_unreconciled', 'itau_pix_receipt', v_receipt.end_to_end_id,
        'Pix de R$ ' || to_char(v_receipt.amount_brl, 'FM999G999G990D00') || ' recebido pelo Itaú (TXID ' || v_receipt.txid
          || ') não foi baixado automaticamente: ' || v_reason,
        'itau_pix', 'administrativo',
        jsonb_build_object('end_to_end_id', v_receipt.end_to_end_id, 'txid', v_receipt.txid,
          'amount_brl', v_receipt.amount_brl, 'invoice_id', NEW.id, 'demurrage_invoice_id', NULL),
        '/reconciliacao');
    END IF;
  END LOOP;
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public.itau_pix_close_receipts_on_paid() FROM PUBLIC, anon, authenticated;
