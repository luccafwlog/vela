-- 360: Pix em análise só fecha sozinho pela baixa daquele Pix (ADR 0093,
-- decisão 17; plano da frente financeira, F-10).
--
-- Problema: `itau_pix_close_receipts_on_paid` (154) fechava todo Pix em
-- análise da fatura quando ela ficava paga, por qualquer baixa. Um Pix de
-- R$ 600 em análise e uma TED distinta de R$ 600 deixavam o Pix "tratado",
-- sem restituição, e o dinheiro em dobro sumia da fila.
--
-- Mudança: fecha só o recebimento cujo endToEndId é a referência bancária de
-- uma baixa da fatura, ou cujo TXID é o que a fatura conciliou pelo extrato.
-- Os demais continuam em análise para o Financeiro decidir.
--
-- Não altera nem apaga linhas existentes.

CREATE OR REPLACE FUNCTION public.itau_pix_close_receipts_on_paid()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_e2e text;
BEGIN
  FOR v_e2e IN
    SELECT r.end_to_end_id FROM public.itau_pix_receipts r
    JOIN public.itau_pix_charges c ON c.id = r.charge_id
    WHERE r.status = 'review'
      AND CASE WHEN TG_TABLE_NAME = 'invoices' THEN
        c.invoice_id = NEW.id AND (
          EXISTS (SELECT 1 FROM public.payments p WHERE p.invoice_id = NEW.id
                  AND upper(btrim(coalesce(p.bank_reference, ''))) = upper(r.end_to_end_id))
          OR public.normalize_pix_txid(NEW.pix_txid) = public.normalize_pix_txid(r.txid))
      ELSE
        c.demurrage_invoice_id = NEW.id AND (
          upper(btrim(coalesce(NEW.pix_txid, ''))) = upper(r.end_to_end_id)
          OR public.normalize_pix_txid(NEW.pix_txid) = public.normalize_pix_txid(r.txid))
      END
  LOOP
    PERFORM public._itau_pix_close_receipt(v_e2e, 'Fatura paga pela baixa deste Pix.', auth.uid());
  END LOOP;
  RETURN NULL;
END;
$$;

-- A baixa verificada grava a referência bancária depois de quitar a fatura
-- (`register_verified_invoice_payment`): a referência gravada também fecha o
-- Pix em análise de mesmo endToEndId, se a fatura já está paga.
CREATE OR REPLACE FUNCTION public.itau_pix_close_receipts_on_reference()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_e2e text;
BEGIN
  FOR v_e2e IN
    SELECT r.end_to_end_id FROM public.itau_pix_receipts r
    JOIN public.itau_pix_charges c ON c.id = r.charge_id
    JOIN public.invoices i ON i.id = c.invoice_id
    WHERE r.status = 'review' AND c.invoice_id = NEW.invoice_id AND i.status = 'paid'
      AND upper(r.end_to_end_id) = upper(btrim(NEW.bank_reference))
  LOOP
    PERFORM public._itau_pix_close_receipt(v_e2e, 'Fatura paga pela baixa deste Pix.', auth.uid());
  END LOOP;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.itau_pix_close_receipts_on_reference() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER itau_pix_close_receipts_on_reference
  AFTER UPDATE OF bank_reference ON public.payments
  FOR EACH ROW WHEN (NEW.bank_reference IS NOT NULL AND NEW.bank_reference IS DISTINCT FROM OLD.bank_reference)
  EXECUTE FUNCTION public.itau_pix_close_receipts_on_reference();
