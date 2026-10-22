-- 425: Demurrage reemitida sem o desconto do Cliente anterior e Dispute nova
-- só em fatura não paga (auditoria de segurança run-3, decisões do dono em
-- 2026-10-22).
--
-- 1. A troca de Cliente do B/L reemite a Invoice de Demurrage aberta para o
--    novo Cliente (`reissue_open_documents_on_customer_change`). A 417 tirou
--    a Dispute do Cliente anterior da cópia; o desconto seguia copiado. O
--    desconto foi negociado com o Cliente anterior: a Invoice nova nasce sem
--    ele, com o R$ cheio pelo ROE da anterior (`total_usd × current_roe`), e
--    a nota diz que o desconto não foi copiado. Quem quiser dar desconto ao
--    novo Cliente aplica de novo, com justificativa (`apply_demurrage_discount`).
-- 2. `portal_add_dispute_message` abria Dispute nova em Invoice paga, contra a
--    regra da tela ("Invoice não paga"). Agora recusa (22023) quando não há
--    Dispute aberta e a Invoice está paga; a conversa de uma Dispute já aberta
--    continua mesmo se a Invoice for paga no meio dela.
--
-- Só redefine funções; não reescreve nem apaga linhas.
-- Rollback: reaplicar as definições da 417.

CREATE OR REPLACE FUNCTION public.reissue_open_documents_on_customer_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_doc record;
  v_new bigint;
  v_reason text := 'Troca de CNPJ do B/L ' || NEW.id || ': documento reemitido para o novo Cliente.';
BEGIN
  -- Avulsa emitida sem pagamento.
  FOR v_doc IN
    SELECT i.id FROM public.invoices i
    WHERE i.bl_id = NEW.id AND i.invoice_type = 'manual' AND i.customer_id = OLD.customer_id
      AND coalesce(i.status, 'issued') = 'issued' AND coalesce(i.total_paid_brl, 0) = 0
      AND NOT EXISTS (SELECT 1 FROM public.payments p WHERE p.invoice_id = i.id)
    ORDER BY i.id
  LOOP
    PERFORM public._cancel_invoice_core(v_doc.id, v_reason, auth.uid());
    v_new := public._clone_row('public.invoices', v_doc.id,
      jsonb_build_object('customer_id', NEW.customer_id, 'status', 'issued', 'issued_at', now(), 'replaces_invoice_id', v_doc.id,
        'total_paid_brl', 0, 'pix_payload', NULL, 'pix_txid', NULL, 'conciliated_by_extract', false),
      ARRAY['invoice_number', 'created_at', 'updated_at', 'reissue_requested_at', 'reissue_closed_at', 'reissue_closed_reason',
        'covered_by_invoice_id', 'obsolete_reason', 'cancelled_at', 'cancelled_by', 'cancel_reason']);
    UPDATE public.invoices SET balance_brl = total_brl WHERE id = v_new;
    PERFORM public._clone_row('public.invoice_items', ii.id, jsonb_build_object('invoice_id', v_new))
    FROM public.invoice_items ii WHERE ii.invoice_id = v_doc.id;
  END LOOP;

  -- Invoice de Demurrage emitida sem pagamento.
  FOR v_doc IN
    SELECT d.id, d.status, d.total_usd, d.current_roe, d.discount_mode FROM public.demurrage_invoices d
    WHERE d.bl_id = NEW.id AND d.customer_id = OLD.customer_id
      AND d.status IN ('issued', 'overdue') AND d.paid_at IS NULL
    ORDER BY d.id
  LOOP
    UPDATE public.demurrage_invoices SET status = 'cancelled', updated_at = now() WHERE id = v_doc.id;
    INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
    VALUES ('demurrage_invoice', v_doc.id::text, 'status', v_doc.status, 'cancelled', auth.uid(), v_reason);
    v_new := public._clone_row('public.demurrage_invoices', v_doc.id,
      jsonb_build_object('customer_id', NEW.customer_id, 'doc_number', public.next_demurrage_doc_number(), 'status', v_doc.status,
        'pix_payload', NULL, 'pix_txid', NULL, 'conciliated_by_extract', false,
        -- O desconto foi negociado com o Cliente anterior (425): a Invoice nova
        -- nasce com o valor cheio em R$, pelo ROE da anterior.
        'current_total_brl', CASE WHEN v_doc.current_roe > 0 THEN round(v_doc.total_usd * v_doc.current_roe, 2) END,
        'notes', 'Reemitida pela troca de CNPJ do B/L (substitui a Invoice ' || v_doc.id || ').'
          || CASE WHEN v_doc.discount_mode IS NOT NULL THEN ' O desconto da Invoice anterior não foi copiado.' ELSE '' END),
      -- A Dispute e o desconto são do Cliente anterior: a Invoice nova nasce sem eles.
      ARRAY['created_at', 'updated_at', 'dunning_suspended_reason',
        'dispute_open', 'dispute_subject', 'dispute_reason', 'dispute_status', 'dispute_notes',
        'discount_type', 'discount_value', 'discount_mode', 'discount_justification', 'discount_approver']);
    PERFORM public._clone_row('public.demurrage_invoice_items', it.id, jsonb_build_object('invoice_id', v_new))
    FROM public.demurrage_invoice_items it WHERE it.invoice_id = v_doc.id;
  END LOOP;
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.portal_add_dispute_message(p_demurrage_invoice_id bigint, p_body text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_customer_id BIGINT := public.current_portal_customer_id();
  v_invoice RECORD;
  v_dispute RECORD;
  v_dispute_id BIGINT;
  v_message_id BIGINT;
BEGIN
  IF NULLIF(btrim(p_body), '') IS NULL THEN RAISE EXCEPTION 'Informe a mensagem da disputa.' USING ERRCODE = '22023'; END IF;
  PERFORM public.check_portal_rate_limit('open_dispute', 3, 30);
  -- Mesmo recorte de _portal_list_demurrage_invoices_core (auditoria run-2).
  SELECT id, customer_id, doc_number, status INTO v_invoice
  FROM public.demurrage_invoices
  WHERE id = p_demurrage_invoice_id AND customer_id = v_customer_id
    AND status IN ('issued', 'overdue', 'paid')
    AND public.bl_has_portal_release(bl_id)
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Fatura de demurrage não encontrada.' USING ERRCODE = 'P0002'; END IF;

  SELECT * INTO v_dispute
  FROM public.demurrage_disputes
  WHERE demurrage_invoice_id = v_invoice.id AND customer_id = v_customer_id AND state = 'aberta'
  ORDER BY id DESC LIMIT 1 FOR UPDATE;
  -- Fatura paga não abre Dispute nova (425); a conversa já aberta segue.
  IF v_dispute.id IS NULL AND v_invoice.status = 'paid' THEN
    RAISE EXCEPTION 'Fatura de demurrage paga não aceita nova disputa.' USING ERRCODE = '22023';
  END IF;
  IF v_dispute.id IS NOT NULL AND v_dispute.next_responder <> 'cliente' THEN
    RAISE EXCEPTION 'Aguarde a resposta de Equipamentos.' USING ERRCODE = '42501';
  END IF;
  v_dispute_id := COALESCE(v_dispute.id, public.ensure_demurrage_dispute(v_invoice.id, v_customer_id, 'cliente', NULL));

  INSERT INTO public.demurrage_dispute_messages(dispute_id, author_id, author_type, body, next_responder, metadata)
  VALUES (v_dispute_id, auth.uid(), 'cliente', btrim(p_body), 'equipamentos', jsonb_build_object('channel', 'portal'))
  RETURNING id INTO v_message_id;
  UPDATE public.demurrage_disputes SET state = 'aberta', next_responder = 'equipamentos', resolved_at = NULL, cancelled_at = NULL WHERE id = v_dispute_id;
  UPDATE public.demurrage_invoices SET dispute_open = true, dispute_status = 'aberto', dispute_reason = COALESCE(dispute_reason, btrim(p_body)) WHERE id = v_invoice.id;
  INSERT INTO public.portal_notifications(customer_id, bl_id, type, title, message, link)
  SELECT v_customer_id, NULL, 'dispute_opened', 'Disputa registrada', 'Sua disputa de demurrage foi registrada.', '/demurrage'
  WHERE NOT EXISTS (
    SELECT 1 FROM public.portal_notifications n
    WHERE n.customer_id = v_customer_id AND n.type = 'dispute_opened'
      AND n.created_at > now() - interval '30 minutes'
      AND n.message = 'Sua disputa de demurrage foi registrada.'
  );
  PERFORM public.block521_upsert_alert('portal_dispute_opened', 'demurrage_invoice', v_invoice.id::text,
    'Cliente enviou mensagem na Dispute ' || v_invoice.doc_number || '; resposta de Equipamentos pendente.',
    'portal_dispute_message', 'equipamentos', jsonb_build_object('dispute_id', v_dispute_id, 'message_id', v_message_id),
    '/demurrage?dispute=' || v_dispute_id);
  RETURN jsonb_build_object('dispute_id', v_dispute_id, 'message_id', v_message_id);
END;
$function$;
