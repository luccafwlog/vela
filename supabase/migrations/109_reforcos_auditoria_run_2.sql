-- Migration 109: reforços adicionais do banco da auditoria run-2 (D4 = b).
--
-- Cada bloco tem caso em src/integration/auditoriaRun2Reforcos.local-pg.test.ts.
-- Não reescreve nem apaga linhas existentes: troca funções, políticas e grants.

-- 1. Recálculo manual por PTAX: só Financeiro e Administrativo definem a PTAX
-- que reprecifica as faturas de Demurrage abertas.
CREATE OR REPLACE FUNCTION public.recalculate_demurrage_invoices_manual(p_ptax numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user()
     OR public.current_actor_role() NOT IN ('financeiro', 'administrativo') THEN
    RAISE EXCEPTION 'Sem permissao.' USING ERRCODE = '42501';
  END IF;
  RETURN public.recalculate_demurrage_invoices(
    p_ptax,
    (now() AT TIME ZONE 'America/Sao_Paulo')::date,
    'manual'
  );
END;
$function$;

-- 2. Trava de liberação do Portal: o Cliente só abre Dispute e só lê detalhe
-- de fatura que as listas do Portal já mostram a ele.
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
    WHERE irl.invoice_id = p_invoice_id AND irl.status = 'active'
  )
  SELECT EXISTS (
    SELECT 1 FROM public.invoices i
    WHERE i.id = p_invoice_id
      AND i.customer_id = p_customer_id
      AND (
        i.invoice_type = 'manual'
        OR (EXISTS (SELECT 1 FROM linked)
            AND NOT EXISTS (SELECT 1 FROM linked WHERE NOT public.bl_has_portal_release(linked.bl_id)))
      )
  );
$function$;
REVOKE ALL ON FUNCTION public._portal_invoice_visible(bigint, bigint) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._portal_invoice_details_core(p_customer_id bigint, p_invoice_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT public._portal_invoice_visible(p_customer_id, p_invoice_id) THEN
    RAISE EXCEPTION 'Invoice % nao encontrada.', p_invoice_id USING ERRCODE = 'P0002';
  END IF;

  v_result := public._portal_invoice_details_core_20260927(p_customer_id, p_invoice_id);

  IF v_result #>> '{invoice,invoice_type}' IS DISTINCT FROM 'manual' THEN
    v_result := jsonb_set(
      v_result,
      '{invoice}',
      (v_result->'invoice') - 'notes',
      true
    );
  END IF;

  RETURN v_result;
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
  WHERE demurrage_invoice_id = v_invoice.id AND state = 'aberta'
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

-- 3. O Portal lê mensagens e anexos de Dispute só por portal_list_disputes,
-- que não devolve author_id/uploaded_by. O SELECT direto expunha o UUID do
-- atendente; sai a política do Portal, fica a interna.
DROP POLICY IF EXISTS demurrage_dispute_messages_portal_read ON public.demurrage_dispute_messages;
DROP POLICY IF EXISTS demurrage_dispute_attachments_portal_read ON public.demurrage_dispute_attachments;

-- 4. Bounce temporário não marca o Email de Recuperação como
-- bounce_permanente nem abre alerta; só bounce permanente e complaint.
CREATE OR REPLACE FUNCTION public.process_portal_email_event(p_event_id bigint, p_worker_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_event public.portal_email_events%ROWTYPE;
  v_worker_id text := NULLIF(btrim(p_worker_id), '');
  v_provider_message_id text;
  v_email text;
  v_next_status text;
  v_event_kind text;
  v_bounce_type text;
  v_permanent_bounce boolean := false;
  v_portal_count integer := 0;
  v_communication_count integer := 0;
  v_portal_attempt_id bigint;
  v_communication_attempt_id bigint;
  v_communication_id bigint;
  v_portal_account_id bigint;
  v_portal_kind text;
  v_attempt_status text;
  v_stale boolean := false;
  v_customer_id bigint;
  v_customer_ids jsonb := '[]'::jsonb;
  v_result jsonb;
  v_retry_status text;
  v_retry_at timestamptz;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'process_portal_email_event exige service_role.' USING ERRCODE = '42501';
  END IF;
  IF p_event_id IS NULL OR v_worker_id IS NULL THEN
    RAISE EXCEPTION 'event_id e worker_id são obrigatórios.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_event
    FROM public.portal_email_events
   WHERE id = p_event_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Evento de email não encontrado.' USING ERRCODE = 'P0002';
  END IF;
  IF v_event.status IN ('processed', 'investigate', 'failed') THEN
    RETURN COALESCE(v_event.processing_result, '{}'::jsonb)
      || jsonb_build_object('event_id', v_event.id, 'status', v_event.status, 'idempotent', true);
  END IF;
  IF v_event.status <> 'processing'
     OR v_event.leased_by IS DISTINCT FROM v_worker_id
     OR v_event.lease_until IS NULL
     OR v_event.lease_until < now() THEN
    RAISE EXCEPTION 'Lease do evento não pertence ao worker ou expirou.' USING ERRCODE = '40001';
  END IF;

  v_event_kind := lower(btrim(v_event.event_type));
  v_provider_message_id := NULLIF(btrim(COALESCE(
    v_event.provider_message_id,
    v_event.payload #>> '{data,email_id}'
  )), '');
  v_email := NULLIF(lower(btrim(COALESCE(
    v_event.payload #>> '{data,to,0}',
    v_event.payload->>'recipient'
  ))), '');
  v_bounce_type := lower(btrim(COALESCE(v_event.payload #>> '{data,bounce,type}', '')));
  v_permanent_bounce := v_event_kind = 'email.bounced' AND v_bounce_type = 'permanent';

  IF v_event_kind NOT IN ('email.delivered', 'email.bounced', 'email.complained') THEN
    v_result := jsonb_build_object(
      'event_id', v_event.id,
      'status', 'processing',
      'processed', true,
      'ignored_unknown_event', true
    );
    UPDATE public.portal_email_events
       SET processing_result = v_result,
           updated_at = now()
     WHERE id = v_event.id;
    RETURN v_result;
  END IF;

  IF v_provider_message_id IS NOT NULL THEN
    SELECT count(*) INTO v_portal_count
      FROM public.portal_email_attempts
     WHERE provider_message_id = v_provider_message_id;
    SELECT count(*) INTO v_communication_count
      FROM public.customer_communication_attempts
     WHERE provider_message_id = v_provider_message_id;
  END IF;

  IF v_portal_count + v_communication_count > 1 THEN
    v_retry_status := 'investigate';
    v_retry_at := NULL;
    UPDATE public.portal_email_events
       SET status = v_retry_status,
           process_after = v_retry_at,
           lease_until = NULL,
           leased_by = NULL,
           last_error_code = 'ambiguous_provider_message_id',
           last_error_message = 'Provider message id corresponde a mais de uma tentativa.',
           processing_result = jsonb_build_object(
             'event_id', v_event.id,
             'status', v_retry_status,
             'provider_message_id', v_provider_message_id
           ),
           updated_at = now()
     WHERE id = v_event.id;
    INSERT INTO public.portal_email_event_attempts (
      event_id, attempt_no, worker_id, status, error_code, error_message, result
    ) VALUES (
      v_event.id, v_event.attempt_count, v_worker_id, v_retry_status,
      'ambiguous_provider_message_id', 'Provider message id corresponde a mais de uma tentativa.',
      jsonb_build_object('provider_message_id', v_provider_message_id)
    );
    RETURN jsonb_build_object(
      'event_id', v_event.id,
      'status', v_retry_status,
      'provider_message_id', v_provider_message_id
    );
  END IF;

  -- Um evento já aplicado pode ser reprocessado após crash no efeito
  -- secundário. Mantemos a referência original e tornamos o bloco idempotente.
  v_portal_attempt_id := v_event.attempt_id;
  v_communication_attempt_id := v_event.communication_attempt_id;
  IF v_portal_attempt_id IS NULL AND v_communication_attempt_id IS NULL AND v_provider_message_id IS NOT NULL THEN
    IF v_portal_count = 1 THEN
      SELECT id, account_id, kind
        INTO v_portal_attempt_id, v_portal_account_id, v_portal_kind
        FROM public.portal_email_attempts
       WHERE provider_message_id = v_provider_message_id;
    ELSIF v_communication_count = 1 THEN
      SELECT a.id, a.communication_id
        INTO v_communication_attempt_id, v_communication_id
        FROM public.customer_communication_attempts a
       WHERE a.provider_message_id = v_provider_message_id;
    END IF;
  END IF;

  IF v_portal_attempt_id IS NOT NULL THEN
    SELECT account_id, kind, status
      INTO v_portal_account_id, v_portal_kind, v_attempt_status
      FROM public.portal_email_attempts
     WHERE id = v_portal_attempt_id;
    v_stale := EXISTS (
      SELECT 1 FROM public.portal_email_events older
       WHERE older.attempt_id = v_portal_attempt_id
         AND older.status = 'processed'
         AND older.received_at > v_event.received_at
    );
  ELSIF v_communication_attempt_id IS NOT NULL THEN
    SELECT communication_id, status
      INTO v_communication_id, v_attempt_status
      FROM public.customer_communication_attempts
     WHERE id = v_communication_attempt_id;
    v_stale := EXISTS (
      SELECT 1 FROM public.portal_email_events older
       WHERE older.communication_attempt_id = v_communication_attempt_id
         AND older.status = 'processed'
         AND older.received_at > v_event.received_at
    );
  END IF;

  IF v_portal_attempt_id IS NULL AND v_communication_attempt_id IS NULL THEN
    IF v_event.attempt_count >= 6 THEN
      v_retry_status := 'investigate';
      v_retry_at := NULL;
    ELSE
      v_retry_status := 'retry_wait';
      v_retry_at := now() + CASE v_event.attempt_count
        WHEN 1 THEN interval '1 minute'
        WHEN 2 THEN interval '5 minutes'
        WHEN 3 THEN interval '15 minutes'
        WHEN 4 THEN interval '60 minutes'
        ELSE interval '360 minutes'
      END;
    END IF;
    v_result := jsonb_build_object(
      'event_id', v_event.id,
      'status', v_retry_status,
      'provider_message_id', v_provider_message_id,
      'error_code', 'attempt_unresolved'
    );
    UPDATE public.portal_email_events
       SET status = v_retry_status,
           process_after = v_retry_at,
           lease_until = NULL,
           leased_by = NULL,
           last_error_code = 'attempt_unresolved',
           last_error_message = 'Tentativa ainda não possui provider_message_id vinculado.',
           processing_result = v_result,
           updated_at = now()
     WHERE id = v_event.id;
    INSERT INTO public.portal_email_event_attempts (
      event_id, attempt_no, worker_id, status, error_code, error_message, result
    ) VALUES (
      v_event.id, v_event.attempt_count, v_worker_id, v_retry_status,
      'attempt_unresolved', 'Tentativa ainda não possui provider_message_id vinculado.', v_result
    );
    IF v_retry_status = 'investigate' THEN
      PERFORM public.block521_upsert_alert(
        'portal_reprocessamento_falhou',
        'portal_email_event',
        v_event.id::text,
        'Evento de email recebido sem tentativa vinculada após o limite de retry; investigue no provedor.',
        'portal_email_events_runner',
        'documentacao',
        jsonb_build_object('event_id', v_event.id, 'provider_message_id', v_provider_message_id),
        '/clientes/portal'
      );
    END IF;
    RETURN v_result;
  END IF;

  v_next_status := CASE v_event_kind
    WHEN 'email.delivered' THEN 'entregue'
    WHEN 'email.bounced' THEN 'bounce'
    WHEN 'email.complained' THEN 'complaint'
  END;

  IF v_portal_attempt_id IS NOT NULL THEN
    IF NOT v_stale AND NOT (
      v_attempt_status IN ('bounce', 'complaint', 'falha_permanente')
      AND v_next_status <> v_attempt_status
    ) THEN
      UPDATE public.portal_email_attempts
         SET status = v_next_status,
             updated_at = now()
       WHERE id = v_portal_attempt_id;
    END IF;
    UPDATE public.portal_email_events
       SET attempt_id = v_portal_attempt_id,
           communication_attempt_id = NULL
     WHERE id = v_event.id;
  ELSE
    IF NOT v_stale AND NOT (
      v_attempt_status IN ('bounce', 'complaint', 'falha_permanente')
      AND v_next_status <> v_attempt_status
    ) THEN
      UPDATE public.customer_communication_attempts
         SET status = v_next_status,
             updated_at = now()
       WHERE id = v_communication_attempt_id;
    END IF;
    UPDATE public.portal_email_events
       SET communication_attempt_id = v_communication_attempt_id,
           attempt_id = NULL
     WHERE id = v_event.id;
  END IF;

  -- Fatos de supressão e saúde do endereço são internos e idempotentes. O
  -- aviso ao cliente e o reparo de caixas ficam para o runner após o commit.
  IF v_email IS NOT NULL AND v_permanent_bounce THEN
    INSERT INTO public.portal_suppressed_emails (email, reason, suppressed_at)
    VALUES (v_email, 'bounce_permanente', now())
    ON CONFLICT (email) DO UPDATE
      SET reason = 'bounce_permanente', suppressed_at = EXCLUDED.suppressed_at;
  ELSIF v_email IS NOT NULL AND v_event_kind = 'email.complained' AND v_portal_attempt_id IS NOT NULL THEN
    INSERT INTO public.portal_suppressed_emails (email, reason, suppressed_at)
    VALUES (v_email, 'complaint', now())
    ON CONFLICT (email) DO NOTHING;
  ELSIF v_email IS NOT NULL AND v_event_kind = 'email.complained' AND v_communication_attempt_id IS NOT NULL THEN
    INSERT INTO public.customer_communication_suppressions (email, reason, suppressed_at)
    VALUES (v_email, 'complaint', now())
    ON CONFLICT (email) DO NOTHING;
  END IF;

  IF v_portal_attempt_id IS NOT NULL
     AND v_portal_kind IS DISTINCT FROM 'contato_bounced_notificacao'
     AND (v_permanent_bounce OR v_event_kind = 'email.complained') THEN
    UPDATE public.customer_portal_accounts
       SET recovery_email_status = CASE WHEN v_event_kind = 'email.bounced' THEN 'bounce_permanente' ELSE 'complaint' END,
           account_situation = CASE WHEN account_situation = 'convite_pendente' THEN 'falha_no_envio' ELSE account_situation END
     WHERE id = v_portal_account_id
        OR (v_email IS NOT NULL AND lower(btrim(recovery_email)) = v_email);
  END IF;

  SELECT COALESCE(jsonb_agg(customer_id ORDER BY customer_id), '[]'::jsonb)
    INTO v_customer_ids
    FROM (
      SELECT DISTINCT a.customer_id
        FROM public.customer_portal_accounts a
       WHERE a.id = v_portal_account_id
      UNION
      SELECT DISTINCT a.customer_id
        FROM public.customer_portal_accounts a
       WHERE v_email IS NOT NULL AND lower(btrim(a.recovery_email)) = v_email
      UNION
      SELECT DISTINCT c.customer_id
        FROM public.customer_communications c
       WHERE c.id = v_communication_id
      UNION
      SELECT DISTINCT cc.customer_id
        FROM public.customer_contacts cc
       WHERE v_email IS NOT NULL AND cc.email_normalized = v_email
    ) customers;

  IF v_permanent_bounce
     AND v_portal_kind IS DISTINCT FROM 'contato_bounced_notificacao' THEN
    -- O reparo de caixas é escrita de domínio, não efeito HTTP. Executá-lo
    -- aqui mantém supressão, conta e fallback na mesma transação do evento.
    FOR v_customer_id IN
      SELECT value::bigint FROM jsonb_array_elements_text(v_customer_ids)
    LOOP
      PERFORM public.repair_customer_contact_box_fallbacks(v_customer_id);
    END LOOP;
  END IF;

  IF v_portal_attempt_id IS NOT NULL
     AND v_portal_kind IS DISTINCT FROM 'contato_bounced_notificacao'
     AND (v_permanent_bounce OR v_event_kind = 'email.complained') THEN
    FOR v_customer_id IN
      SELECT DISTINCT a.customer_id
        FROM public.customer_portal_accounts a
       WHERE a.id = v_portal_account_id
          OR (v_email IS NOT NULL AND lower(btrim(a.recovery_email)) = v_email)
    LOOP
      PERFORM public.block521_upsert_alert(
        'portal_email_suprimido',
        'customer',
        v_customer_id::text,
        'Email de Recuperação indisponível. Informe ou valide outro endereço.',
        'portal_email_events_runner',
        'documentacao',
        jsonb_build_object('customer_id', v_customer_id, 'email', v_email),
        '/clientes/portal?cliente=' || v_customer_id
      );
    END LOOP;
  END IF;

  v_result := jsonb_build_object(
    'event_id', v_event.id,
    'status', 'processing',
    'processed', true,
    'provider_message_id', v_provider_message_id,
    'email', v_email,
    'event_type', v_event_kind,
    'portal_attempt_id', v_portal_attempt_id,
    'communication_attempt_id', v_communication_attempt_id,
    'permanent_bounce', v_permanent_bounce,
    'portal_recovery_attempt', v_portal_attempt_id IS NOT NULL AND v_portal_kind IS DISTINCT FROM 'contato_bounced_notificacao',
    'should_cascade', v_permanent_bounce AND v_portal_kind IS DISTINCT FROM 'contato_bounced_notificacao',
    'customer_ids', v_customer_ids,
    'stale_transition_ignored', v_stale
  );

  UPDATE public.portal_email_events
     SET processing_result = v_result,
         updated_at = now()
   WHERE id = v_event.id;

  INSERT INTO public.portal_email_event_attempts (
    event_id, attempt_no, worker_id, status, result
  ) VALUES (v_event.id, v_event.attempt_count, v_worker_id, 'processing', v_result);

  RETURN v_result;
END;
$function$;

-- 5. Viagem vazia só sai por delete_records (com motivo), como a 088 fez com
-- B/L. Nenhuma tela usa DELETE direto em voyages.
DROP POLICY IF EXISTS voyages_delete_admin ON public.voyages;
REVOKE DELETE ON public.voyages FROM authenticated;

-- 6. Estorno de baixa local pega as mesmas travas da baixa, na mesma ordem
-- (advisory por B/L, depois recebíveis): baixa e estorno concorrentes passam
-- a esperar um pelo outro em vez de abortar por deadlock.
ALTER FUNCTION public.reverse_invoice_payment(bigint, text, uuid) RENAME TO _reverse_invoice_payment_impl_109;
REVOKE ALL ON FUNCTION public._reverse_invoice_payment_impl_109(bigint, text, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.reverse_invoice_payment(p_payment_id bigint, p_reason text DEFAULT NULL::text, p_actor uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_invoice_id bigint;
  v_bl_id text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Credenciais invalidas ou sem permissao.' USING ERRCODE = '42501';
  END IF;
  SELECT invoice_id INTO v_invoice_id FROM public.payments WHERE id = p_payment_id;
  IF v_invoice_id IS NOT NULL THEN
    FOR v_bl_id IN
      SELECT DISTINCT links.bl_id
      FROM (
        SELECT ib.bl_id FROM public.invoice_bls ib WHERE ib.invoice_id = v_invoice_id
        UNION
        SELECT r.bl_id FROM public.invoice_receivable_links l JOIN public.bl_receivables r ON r.id = l.receivable_id WHERE l.invoice_id = v_invoice_id
      ) links ORDER BY 1
    LOOP
      PERFORM pg_advisory_xact_lock(hashtextextended('bl:' || v_bl_id, 0));
    END LOOP;
    PERFORM 1 FROM public.bl_receivables r
    WHERE r.id IN (SELECT s.receivable_id FROM public.ledger_settlements s WHERE s.payment_id = p_payment_id)
    ORDER BY r.id
    FOR UPDATE;
  END IF;
  RETURN public._reverse_invoice_payment_impl_109(p_payment_id, p_reason, p_actor);
END;
$function$;
REVOKE ALL ON FUNCTION public.reverse_invoice_payment(bigint, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reverse_invoice_payment(bigint, text, uuid) TO authenticated, service_role;

-- 7. Desfazer consolidada com PIX em trânsito mandaria o pagamento do Cliente
-- para tratamento manual: recusa enquanto houver exceção PIX ativa com o TXID
-- da fatura. 8. A notificação conta os recebíveis deduplicados.
CREATE OR REPLACE FUNCTION public.portal_obsolete_consolidation(p_invoice_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_customer_id BIGINT := public.current_portal_customer_id();
  v_invoice RECORD;
BEGIN
  PERFORM public.check_portal_rate_limit('obsolete_consolidation', 3, 15);
  SELECT i.id, i.status, i.invoice_type, i.customer_id, i.invoice_number INTO v_invoice
  FROM public.invoices i WHERE i.id = p_invoice_id AND i.customer_id = v_customer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Fatura nao encontrada.' USING ERRCODE = 'P0002'; END IF;
  IF v_invoice.invoice_type != 'consolidated' THEN RAISE EXCEPTION 'Esta fatura nao e uma consolidada.' USING ERRCODE = 'P0002'; END IF;
  IF v_invoice.status IN ('paid', 'covered', 'cancelled', 'obsolete') THEN RAISE EXCEPTION 'Esta fatura ja foi paga ou cancelada e nao pode ser desfeita.' USING ERRCODE = 'P0002'; END IF;
  IF EXISTS (SELECT 1 FROM public.payments WHERE invoice_id = p_invoice_id) THEN RAISE EXCEPTION 'Fatura com pagamento registrado nao pode ser desfeita.' USING ERRCODE = 'P0002'; END IF;
  IF v_invoice.invoice_number IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.pix_reconciliation_exceptions e
    WHERE e.status = 'active'
      AND e.normalized_txid = public.normalize_pix_txid(v_invoice.invoice_number)
  ) THEN
    RAISE EXCEPTION 'Há um PIX desta fatura em conciliação; aguarde antes de desfazer.' USING ERRCODE = '55000';
  END IF;
  INSERT INTO public.invoice_lifecycle_events (invoice_id, event_type, actor, payload)
  VALUES (p_invoice_id, 'obsolete', NULL, jsonb_build_object('reason', 'obsoleted_by_customer', 'origin', 'portal', 'customer_id', v_customer_id));
  UPDATE public.invoices SET status = 'obsolete', obsolete_reason = 'Desfeita pelo cliente pelo portal.', updated_at = now() WHERE id = p_invoice_id;
  UPDATE public.invoice_receivable_links SET status = 'obsolete' WHERE invoice_id = p_invoice_id AND status = 'active';
  INSERT INTO public.portal_notifications (customer_id, type, title, message, link)
  VALUES (v_customer_id, 'system', 'Consolidacao desfeita',
    'A fatura ' || COALESCE(v_invoice.invoice_number, '#' || p_invoice_id) || ' foi desfeita. Os B/Ls estao disponiveis para nova consolidacao.', '/portal/billing');
  RETURN jsonb_build_object('success', true, 'invoice_id', p_invoice_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.portal_create_consolidation(p_receivable_ids bigint[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_customer_id BIGINT := public.current_portal_customer_id();
  v_ids BIGINT[];
  v_result JSONB;
BEGIN
  PERFORM public.check_portal_rate_limit('create_consolidation', 3, 10);
  SELECT ARRAY_AGG(DISTINCT id ORDER BY id) INTO v_ids
  FROM UNNEST(COALESCE(p_receivable_ids, ARRAY[]::BIGINT[])) AS u(id) WHERE id IS NOT NULL;
  IF EXISTS (SELECT 1 FROM public.bl_receivables br WHERE br.id = ANY(v_ids) AND br.customer_id <> v_customer_id) THEN
    RAISE EXCEPTION 'Selecao contem B/Ls de outro cliente.' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.bl_receivables br WHERE br.id = ANY(v_ids) AND NOT public.bl_has_portal_release(br.bl_id)) THEN
    RAISE EXCEPTION 'Selecao contem B/L sem CE Mercante liberado para o portal.' USING ERRCODE = '42501';
  END IF;
  v_result := public.create_local_consolidated_invoice_core(v_customer_id, p_receivable_ids, auth.uid(), 'portal');
  INSERT INTO public.portal_notifications (customer_id, type, title, message, link)
  VALUES (v_customer_id, 'system', 'Fatura consolidada criada',
    'Sua fatura consolidada foi gerada com ' || COALESCE(array_length(v_ids, 1), 0) || ' B/L(s).', '/portal/billing');
  RETURN v_result;
END;
$function$;
