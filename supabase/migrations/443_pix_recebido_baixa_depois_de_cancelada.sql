-- 443: ajuste da 442 (ADR 0100), achado pelo teste de banco antes da
-- publicação. `itau_pix_settle_received` usava uma chave de tentativa fixa por
-- Pix e usuário: depois de a baixa ser cancelada, dar a baixa do mesmo Pix em
-- outra fatura era recusado ("Tentativa reutilizada com dados diferentes") e,
-- na mesma fatura, devolvia "Esta baixa foi cancelada". A chave passa a ser
-- nova a cada chamada; a repetição continua barrada pelo lock do endToEndId e
-- pela baixa já existente.
--
-- Só redefine a função; não reescreve nem apaga linhas.
-- Rollback: reaplicar a definição da 442.

CREATE OR REPLACE FUNCTION public.itau_pix_settle_received(p_end_to_end_id text, p_source text, p_invoice_id bigint)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_receipt public.itau_pix_receipts%ROWTYPE;
  v_existing record;
  v_doc text;
  v_result jsonb;
  v_request uuid := gen_random_uuid();
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_financeiro_user() THEN
    RAISE EXCEPTION 'Sem permissão para conciliar Pix recebidos.' USING ERRCODE = '42501';
  END IF;
  IF p_source IS NULL OR p_source NOT IN ('local', 'demurrage') OR p_invoice_id IS NULL THEN
    RAISE EXCEPTION 'Escolha a fatura que recebe o Pix.' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('itau_pix_e2e:' || p_end_to_end_id, 0));
  SELECT * INTO v_receipt FROM public.itau_pix_receipts WHERE end_to_end_id = p_end_to_end_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pix recebido não encontrado.' USING ERRCODE = 'P0002';
  END IF;
  IF v_receipt.status <> 'received' THEN
    RAISE EXCEPTION 'Este Pix é de cobrança do Vela: a baixa é automática ou segue em Pendências.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_existing FROM public._itau_pix_receipt_settlement(v_receipt.end_to_end_id, v_receipt.txid);
  IF v_existing.invoice_id IS NOT NULL THEN
    RAISE EXCEPTION 'Este Pix já tem baixa na fatura %.', v_existing.doc_number USING ERRCODE = '22023';
  END IF;

  IF p_source = 'local' THEN
    -- Sem FOR UPDATE: a baixa trava os B/Ls antes da fatura, na ordem de sempre.
    SELECT invoice_number INTO v_doc FROM public.invoices
    WHERE id = p_invoice_id AND status IN ('issued', 'partially_paid') AND balance_brl > 0
      AND invoice_type IN ('individual', 'consolidated', 'manual');
    IF NOT FOUND THEN
      RAISE EXCEPTION 'A fatura não está aberta para receber este Pix.' USING ERRCODE = '22023';
    END IF;
    v_result := public.register_verified_invoice_payment(p_invoice_id, v_receipt.amount_brl, 'pix', v_receipt.paid_at,
      'Baixa manual do Pix recebido ' || v_receipt.end_to_end_id || ' (Conciliação PIX)', v_request, v_receipt.end_to_end_id);
  ELSE
    SELECT doc_number INTO v_doc FROM public.demurrage_invoices
    WHERE id = p_invoice_id AND status IN ('issued', 'overdue') AND paid_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'A Invoice de Demurrage não está aberta para receber este Pix.' USING ERRCODE = '22023';
    END IF;
    -- O valor do Pix tem de bater com uma das duas últimas fotos de PTAX (ADR 0015).
    v_result := public.register_demurrage_payment(v_request, p_invoice_id,
      (v_receipt.paid_at AT TIME ZONE 'America/Sao_Paulo')::date, v_receipt.end_to_end_id, v_receipt.amount_brl, NULL);
  END IF;
  RETURN jsonb_build_object('source', p_source, 'invoice_id', p_invoice_id, 'doc_number', v_doc,
    'end_to_end_id', v_receipt.end_to_end_id, 'amount_brl', v_receipt.amount_brl, 'result', v_result);
END;
$$;
