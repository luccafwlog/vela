-- 426: Disputas — reabertura com teto e só da resolvida, Invoice reemitida
-- sem a Dispute do Cliente anterior e sem oráculo de ids no Portal
-- (auditoria de segurança run-3, notas de endurecimento).
--
-- 1. `portal_request_dispute_reopen` não tinha limite: cada chamada grava
--    mensagem imutável e Alerta. Mesmo teto da abertura (3 em 30 min).
-- 2. `reopen_demurrage_dispute` reabria Dispute cancelada ou ainda aberta; a
--    regra documentada é "reabertura só da resolvida".
-- 3. `reissue_open_documents_on_customer_change` copiava `dispute_*` da Invoice
--    do Cliente anterior para a do novo, que aparecia "Em disputa" no Portal
--    dele e saía da Régua. A Invoice nova nasce sem Dispute (o desconto segue
--    copiado: decisão pendente com o dono).
-- 4. `portal_add_dispute_message` escolhe a Dispute aberta também pelo Cliente
--    da sessão (defesa em profundidade).
-- 5. `add_demurrage_dispute_attachment` e
--    `portal_check_dispute_attachment_eligibility` distinguiam id inexistente
--    (P0002) de id de outro Cliente (42501) para a sessão do Portal; agora os
--    dois recebem o mesmo P0002.
--
-- Só redefine funções; não reescreve nem apaga linhas.
-- Rollback: reaplicar as definições anteriores (002, 081, 385, 109, 106).

CREATE OR REPLACE FUNCTION public.portal_request_dispute_reopen(p_dispute_id bigint, p_body text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_customer_id BIGINT := public.current_portal_customer_id();
  v_dispute public.demurrage_disputes%ROWTYPE;
BEGIN
  IF NULLIF(btrim(p_body), '') IS NULL THEN RAISE EXCEPTION 'Justificativa é obrigatória.' USING ERRCODE = '22023'; END IF;
  -- Cada pedido grava mensagem imutável e Alerta: mesmo teto da abertura.
  PERFORM public.check_portal_rate_limit('dispute_reopen_request', 3, 30);
  SELECT * INTO v_dispute FROM public.demurrage_disputes WHERE id = p_dispute_id AND customer_id = v_customer_id;
  IF NOT FOUND OR v_dispute.state <> 'resolvida' THEN RAISE EXCEPTION 'Dispute não está disponível para solicitação de reabertura.' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.demurrage_dispute_messages(dispute_id, author_id, author_type, body, next_responder, metadata)
  VALUES (p_dispute_id, auth.uid(), 'cliente', btrim(p_body), 'equipamentos', jsonb_build_object('action', 'reopen_request'));
  PERFORM public.block521_upsert_alert('portal_dispute_opened', 'demurrage_invoice', v_dispute.demurrage_invoice_id::text, 'Cliente solicitou reabertura de uma Dispute; decisão de Equipamentos pendente.', 'portal_dispute_reopen_request', 'equipamentos', jsonb_build_object('dispute_id', p_dispute_id), '/demurrage?dispute=' || p_dispute_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public._reopen_demurrage_dispute_impl_20260920(p_dispute_id bigint, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_role TEXT := public._portal_actor_role();
  v_dispute public.demurrage_disputes%ROWTYPE;
BEGIN
  IF v_role IS NULL OR v_role NOT IN ('equipamentos', 'administrativo') THEN RAISE EXCEPTION 'Apenas Equipamentos ou Administrativo pode reabrir a Dispute.' USING ERRCODE = '42501'; END IF;
  IF NULLIF(btrim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'Justificativa é obrigatória.' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_dispute FROM public.demurrage_disputes WHERE id = p_dispute_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Dispute não encontrada.' USING ERRCODE = 'P0002'; END IF;
  -- Reabertura só da resolvida (docs/modules/demurrage.md).
  IF v_dispute.state <> 'resolvida' THEN RAISE EXCEPTION 'Só a Dispute resolvida pode ser reaberta.' USING ERRCODE = '22023'; END IF;
  UPDATE public.demurrage_disputes SET state = 'aberta', next_responder = 'equipamentos', resolved_at = NULL, cancelled_at = NULL WHERE id = p_dispute_id;
  INSERT INTO public.demurrage_dispute_messages(dispute_id, author_id, author_type, body, next_responder, metadata)
  VALUES (p_dispute_id, auth.uid(), v_role, btrim(p_reason), 'equipamentos', jsonb_build_object('action', 'reopen'));
  UPDATE public.demurrage_invoices SET dispute_open = true, dispute_status = 'aberto' WHERE id = v_dispute.demurrage_invoice_id;
  PERFORM public.block521_upsert_alert('portal_dispute_opened', 'demurrage_invoice', v_dispute.demurrage_invoice_id::text, 'Dispute reaberta; análise de Equipamentos pendente.', 'portal_dispute_reopened', 'equipamentos', jsonb_build_object('dispute_id', p_dispute_id), '/demurrage?dispute=' || p_dispute_id);
END;
$function$;

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
    SELECT d.id, d.status FROM public.demurrage_invoices d
    WHERE d.bl_id = NEW.id AND d.customer_id = OLD.customer_id
      AND d.status IN ('issued', 'overdue') AND d.paid_at IS NULL
    ORDER BY d.id
  LOOP
    UPDATE public.demurrage_invoices SET status = 'cancelled', updated_at = now() WHERE id = v_doc.id;
    INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
    VALUES ('demurrage_invoice', v_doc.id::text, 'status', v_doc.status, 'cancelled', auth.uid(), v_reason);
    v_new := public._clone_row('public.demurrage_invoices', v_doc.id,
      jsonb_build_object('customer_id', NEW.customer_id, 'doc_number', public.next_demurrage_doc_number(), 'status', v_doc.status,
        'pix_payload', NULL, 'pix_txid', NULL, 'conciliated_by_extract', false, 'notes',
        'Reemitida pela troca de CNPJ do B/L (substitui a Invoice ' || v_doc.id || ').'),
      -- A Dispute é do Cliente anterior: a Invoice nova nasce sem ela.
      ARRAY['created_at', 'updated_at', 'dunning_suspended_reason',
        'dispute_open', 'dispute_subject', 'dispute_reason', 'dispute_status', 'dispute_notes']);
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
  SELECT id, customer_id, doc_number INTO v_invoice
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

CREATE OR REPLACE FUNCTION public.add_demurrage_dispute_attachment(p_message_id bigint, p_storage_path text, p_file_name text, p_mime_type text, p_size_bytes bigint)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_message public.demurrage_dispute_messages%ROWTYPE;
  v_dispute public.demurrage_disputes%ROWTYPE;
  v_customer_id bigint;
  v_id bigint;
  v_total_stored bigint;
  v_daily_count bigint;
  v_obj_size bigint;
  v_portal_customer_id bigint;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501';
  END IF;

  IF NULLIF(btrim(p_storage_path), '') IS NULL OR NULLIF(btrim(p_file_name), '') IS NULL
     OR char_length(p_file_name) > 255
     OR NULLIF(btrim(p_mime_type), '') IS NULL OR p_size_bytes IS NULL
     OR p_size_bytes <= 0 OR p_size_bytes > 10485760 THEN
    RAISE EXCEPTION 'Anexo inválido.' USING ERRCODE = '22023';
  END IF;

  IF p_mime_type NOT IN ('application/pdf', 'image/jpeg', 'image/png', 'text/plain') THEN
    RAISE EXCEPTION 'Tipo de anexo não permitido.' USING ERRCODE = '22023';
  END IF;

  -- Sessão do Portal só enxerga a própria Dispute: mensagem inexistente e
  -- mensagem de outro Cliente recebem o mesmo erro (sem oráculo de ids).
  IF NOT public.is_active_user() THEN
    v_portal_customer_id := public.current_portal_customer_id();
  END IF;
  SELECT m.* INTO v_message
    FROM public.demurrage_dispute_messages m
    JOIN public.demurrage_disputes d ON d.id = m.dispute_id
   WHERE m.id = p_message_id AND (v_portal_customer_id IS NULL OR d.customer_id = v_portal_customer_id);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Mensagem não encontrada.' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_dispute FROM public.demurrage_disputes WHERE id = v_message.dispute_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Mensagem não encontrada.' USING ERRCODE = 'P0002';
  END IF;

  IF public.is_active_user() THEN
    IF public._portal_actor_role() NOT IN ('equipamentos', 'administrativo')
       OR v_message.author_id IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'Apenas Equipamentos ou Administrativo, na própria mensagem, pode anexar.' USING ERRCODE = '42501';
    END IF;
    IF v_dispute.state <> 'aberta' THEN
      RAISE EXCEPTION 'Anexos só podem ser enviados em disputas abertas.' USING ERRCODE = '22023';
    END IF;
    v_customer_id := v_dispute.customer_id;
  ELSE
    v_customer_id := public.current_portal_customer_id();
    IF v_dispute.customer_id <> v_customer_id THEN
      RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501';
    END IF;

    -- Anexo do Portal só entra em Dispute aberta: a quota soma apenas Disputes
    -- abertas, então aceitar anexo em Dispute resolvida/cancelada deixaria o
    -- upload fora de qualquer teto acumulado.
    IF v_dispute.state <> 'aberta' THEN
      RAISE EXCEPTION 'Anexos só podem ser enviados em disputas abertas.' USING ERRCODE = '22023';
    END IF;

    -- B5: Serialização de quota/taxa por cliente para eliminar TOCTOU
    PERFORM pg_advisory_xact_lock(hashtext('customer_dispute_quota_' || v_customer_id::text));

    -- PAF-03: para o Portal, a mensagem deve ser de cliente e pertencer ao usuário autenticado
    IF v_message.author_type <> 'cliente' OR v_message.author_id IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'Apenas o autor da mensagem pode anexar arquivos.' USING ERRCODE = '42501';
    END IF;

    -- Quota por cliente em disputas abertas (100 MB = 104857600 bytes)
    SELECT COALESCE(SUM(a.size_bytes), 0) INTO v_total_stored
      FROM public.demurrage_dispute_attachments a
      JOIN public.demurrage_disputes d ON d.id = a.dispute_id
     WHERE a.customer_id = v_customer_id
       AND d.state = 'aberta';

    IF (v_total_stored + p_size_bytes) > 104857600 THEN
      RAISE EXCEPTION 'Quota de armazenamento de anexos de 100 MB excedida.' USING ERRCODE = '22023';
    END IF;

    -- Rate limit de 20 anexos por dia
    SELECT COUNT(*) INTO v_daily_count
      FROM public.demurrage_dispute_attachments
     WHERE customer_id = v_customer_id
       AND created_at >= (now() - interval '1 day');

    IF v_daily_count >= 20 THEN
      RAISE EXCEPTION 'Limite diário de 20 anexos excedido.' USING ERRCODE = '22023';
    END IF;
  END IF;

  -- Prefixo estruturado: customer_id/disputes/dispute_id/message_id/...
  IF p_storage_path NOT LIKE (v_customer_id::text || '/disputes/' || v_dispute.id::text || '/' || v_message.id::text || '/%') THEN
    RAISE EXCEPTION 'Caminho de anexo inválido.' USING ERRCODE = '22023';
  END IF;

  -- PAF-03: se storage.objects existir, validar presença física do objeto
  IF to_regclass('storage.objects') IS NOT NULL THEN
    SELECT (metadata->>'size')::bigint
      INTO v_obj_size
      FROM storage.objects
     WHERE bucket_id = 'demurrage-disputes'
       AND name = p_storage_path;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Objeto de anexo não encontrado no storage.' USING ERRCODE = 'P0002';
    END IF;

    IF v_obj_size IS NOT NULL AND v_obj_size <> p_size_bytes THEN
      RAISE EXCEPTION 'Tamanho do arquivo divergente do objeto armazenado.' USING ERRCODE = '22023';
    END IF;
  END IF;

  INSERT INTO public.demurrage_dispute_attachments(
    message_id, dispute_id, customer_id, storage_path, file_name, mime_type, size_bytes, uploaded_by
  ) VALUES (
    v_message.id, v_dispute.id, v_customer_id, p_storage_path, p_file_name, p_mime_type, p_size_bytes, auth.uid()
  ) RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.portal_check_dispute_attachment_eligibility(p_dispute_id bigint, p_size_bytes bigint)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_dispute public.demurrage_disputes%ROWTYPE;
  v_customer_id bigint;
  v_total_stored bigint;
  v_daily_count bigint;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501';
  END IF;

  IF p_size_bytes IS NULL OR p_size_bytes <= 0 OR p_size_bytes > 10485760 THEN
    RAISE EXCEPTION 'Tamanho de anexo inválido.' USING ERRCODE = '22023';
  END IF;

  -- Sessão do Portal: Dispute inexistente e de outro Cliente recebem o mesmo erro.
  IF NOT public.is_active_user() THEN
    v_customer_id := public.current_portal_customer_id();
  END IF;
  SELECT * INTO v_dispute FROM public.demurrage_disputes
   WHERE id = p_dispute_id AND (v_customer_id IS NULL OR customer_id = v_customer_id);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Disputa não encontrada.' USING ERRCODE = 'P0002';
  END IF;

  IF public.is_active_user() THEN
    v_customer_id := v_dispute.customer_id;
  ELSE
    v_customer_id := public.current_portal_customer_id();
    IF v_dispute.customer_id <> v_customer_id THEN
      RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501';
    END IF;

    -- Anexo do Portal só entra em Dispute aberta: a quota soma apenas Disputes
    -- abertas, então aceitar anexo em Dispute resolvida/cancelada deixaria o
    -- upload fora de qualquer teto acumulado.
    IF v_dispute.state <> 'aberta' THEN
      RAISE EXCEPTION 'Anexos só podem ser enviados em disputas abertas.' USING ERRCODE = '22023';
    END IF;

    -- Quota por cliente em disputas abertas (100 MB)
    SELECT COALESCE(SUM(a.size_bytes), 0) INTO v_total_stored
      FROM public.demurrage_dispute_attachments a
      JOIN public.demurrage_disputes d ON d.id = a.dispute_id
     WHERE a.customer_id = v_customer_id
       AND d.state = 'aberta';

    IF (v_total_stored + p_size_bytes) > 104857600 THEN
      RAISE EXCEPTION 'Quota de armazenamento de anexos de 100 MB excedida.' USING ERRCODE = '22023';
    END IF;

    -- Rate limit diário (máx 20 uploads nas últimas 24h)
    SELECT COUNT(*) INTO v_daily_count
      FROM public.demurrage_dispute_attachments
     WHERE customer_id = v_customer_id
       AND created_at >= (now() - interval '1 day');

    IF v_daily_count >= 20 THEN
      RAISE EXCEPTION 'Limite diário de 20 anexos excedido.' USING ERRCODE = '22023';
    END IF;
  END IF;

  RETURN true;
END;
$function$;
