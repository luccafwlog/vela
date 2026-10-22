-- 419: Portal — consolidada, convite, recuperação e eventos de e-mail
-- conferidos contra a regra documentada (auditoria de segurança run-3, notas
-- de endurecimento).
--
-- 1. `portal_obsolete_consolidation` aceitava desfazer qualquer consolidada não
--    paga, inclusive rascunho; a regra é `issued/partially_paid/overdue`.
-- 2. `portal_create_consolidation` distinguia recebível de outro Cliente e sem
--    liberação de um id inexistente; agora as três recusas têm a mesma mensagem.
-- 3. `portal_assisted_email_change` invalidava confirmação e recuperação
--    pendentes, mas não o convite enviado ao endereço antigo.
-- 4. `portal_begin_password_reset` não conferia Cliente desativado.
-- 5. `process_portal_email_event` marcava bounce/complaint na conta pelo id da
--    tentativa mesmo quando o endereço não era o de recuperação atual; a
--    situação passa a descrever o endereço (regra da migration 299).
-- 6. `_portal_list_disputes_core` exige também que a Invoice da Dispute seja
--    do Cliente (o filtro de B/L liberado das listas de Demurrage ficou de fora:
--    muda o que o Cliente vê e depende de decisão).
--
-- Só redefine funções; não reescreve nem apaga linhas.
-- Rollback: reaplicar as definições anteriores (109, 298, 002, 131, 299, 013).

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
  -- Só a consolidada emitida e ainda a pagar (documentado em portal-cliente.md);
  -- rascunho e demais estados não são desfeitos pelo Portal.
  IF v_invoice.status NOT IN ('issued', 'partially_paid', 'overdue') THEN RAISE EXCEPTION 'Esta fatura ja foi paga ou cancelada e nao pode ser desfeita.' USING ERRCODE = 'P0002'; END IF;
  IF EXISTS (SELECT 1 FROM public.payments WHERE invoice_id = p_invoice_id) THEN RAISE EXCEPTION 'Fatura com pagamento registrado nao pode ser desfeita.' USING ERRCODE = 'P0002'; END IF;
  IF v_invoice.invoice_number IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.pix_reconciliation_exceptions e
    WHERE e.status = 'active'
      AND e.normalized_txid = public.normalize_pix_txid(v_invoice.invoice_number)
  ) THEN
    RAISE EXCEPTION 'Há um PIX desta fatura em conciliação; aguarde antes de desfazer.' USING ERRCODE = '55000';
  END IF;
  -- F-51 (376): Pix recebido pelo Itaú na cobrança desta consolidada também segura.
  IF EXISTS (SELECT 1 FROM public.itau_pix_receipts r JOIN public.itau_pix_charges c ON c.id = r.charge_id WHERE c.invoice_id = p_invoice_id) THEN
    RAISE EXCEPTION 'Há um PIX desta fatura recebido pelo banco; aguarde a baixa antes de desfazer.' USING ERRCODE = '55000';
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
    -- Mesma recusa de id inexistente: o Portal não distingue recebível alheio.
    RAISE EXCEPTION 'Seleção contém B/L que não pode entrar na consolidada. Atualize a lista.' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.bl_receivables br WHERE br.id = ANY(v_ids) AND NOT public.bl_has_portal_release(br.bl_id)) THEN
    RAISE EXCEPTION 'Seleção contém B/L que não pode entrar na consolidada. Atualize a lista.' USING ERRCODE = '42501';
  END IF;
  -- 298: o Portal só consolida o que a janela lista como elegível: recebível
  -- com fatura emitida e visível, saldo em aberto e sem consolidada aberta.
  IF EXISTS (
    SELECT 1 FROM UNNEST(COALESCE(v_ids, ARRAY[]::BIGINT[])) AS u(id)
    WHERE NOT EXISTS (
      SELECT 1 FROM public._portal_list_consolidatable_receivables_core(v_customer_id) AS c
      WHERE c.receivable_id = u.id AND c.eligibility_status = 'eligible'
    )
  ) THEN
    RAISE EXCEPTION 'Seleção contém B/L que não pode entrar na consolidada. Atualize a lista.' USING ERRCODE = '42501';
  END IF;
  v_result := public.create_local_consolidated_invoice_core(v_customer_id, p_receivable_ids, auth.uid(), 'portal');
  INSERT INTO public.portal_notifications (customer_id, type, title, message, link)
  VALUES (v_customer_id, 'system', 'Fatura consolidada criada',
    'Sua fatura consolidada foi gerada com ' || COALESCE(array_length(v_ids, 1), 0) || ' B/L(s).', '/portal/billing');
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.portal_assisted_email_change(p_customer_id bigint, p_new_email text, p_reason text, p_request_id text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_role TEXT:=public._portal_actor_role(); v_account public.customer_portal_accounts%ROWTYPE;
BEGIN
  IF v_role IS NULL OR v_role NOT IN ('administrativo','documentacao') THEN RAISE EXCEPTION 'permission denied' USING ERRCODE='42501'; END IF;
  IF NULLIF(trim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'Justificativa é obrigatória.' USING ERRCODE='22023'; END IF;
  IF p_new_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN RAISE EXCEPTION 'Email inválido.' USING ERRCODE='22023'; END IF;
  IF EXISTS (SELECT 1 FROM public.portal_suppressed_emails WHERE email=lower(p_new_email)) THEN RAISE EXCEPTION 'Endereço suprimido por bounce/complaint. Informe outro.' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_account FROM public.customer_portal_accounts WHERE customer_id=p_customer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Registro de Portal não encontrado.' USING ERRCODE='P0002'; END IF;
  UPDATE public.customer_portal_accounts SET recovery_email=lower(p_new_email),recovery_email_source='informado_manualmente',pending_recovery_email=NULL,recovery_email_status='ok' WHERE id=v_account.id;
  -- O convite pendente foi para o endereço antigo: também deixa de valer.
  UPDATE public.portal_invites SET status='invalidado_por_reenvio' WHERE account_id=v_account.id AND purpose IN ('confirmacao_email','recuperacao','convite') AND status='pendente';
  IF v_account.auth_user_id IS NOT NULL THEN PERFORM public.portal_revoke_sessions(v_account.auth_user_id); END IF;
  PERFORM public._portal_log_event(p_customer_id,v_account.id,NULL,v_account.provisioning_decision,v_account.provisioning_decision,v_account.account_situation,v_account.account_situation,v_role,p_reason || ' Sessões anteriores encerradas.',p_request_id);
END; $function$;

CREATE OR REPLACE FUNCTION public.portal_begin_password_reset(p_token_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE a public.customer_portal_accounts; i public.portal_invites;
BEGIN
  SELECT * INTO i FROM public.portal_invites WHERE token_hash=p_token_hash AND purpose='recuperacao';
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO a FROM public.customer_portal_accounts WHERE id=i.account_id FOR UPDATE;
  IF NOT FOUND OR a.auth_user_id IS NULL OR NOT a.active OR a.account_situation <> 'ativo'
    OR a.recovery_reset_invite_id IS NOT NULL
    -- Cliente desativado não redefine senha (o banco já nega os dados dele).
    OR EXISTS (SELECT 1 FROM public.customers c WHERE c.id = a.customer_id AND c.deactivated_at IS NOT NULL) THEN RETURN NULL; END IF;
  UPDATE public.portal_invites SET status='consumido', consumed_at=clock_timestamp()
    WHERE id=i.id AND status='pendente' AND expires_at>clock_timestamp()
      AND lower(btrim(sent_to_email))=lower(btrim(a.recovery_email)) RETURNING * INTO i;
  IF NOT FOUND THEN RETURN NULL; END IF;
  -- ponytail: falha ambígua no GoTrue exige triagem manual; automatizar somente
  -- com confirmação durável de conclusão, nunca com timeout do marcador.
  UPDATE public.customer_portal_accounts SET recovery_reset_invite_id=i.id WHERE id=a.id;
  RETURN jsonb_build_object('inviteId',i.id,'account',jsonb_build_object(
    'id',a.id,'auth_user_id',a.auth_user_id,'customer_id',a.customer_id,
    'provisioning_decision',a.provisioning_decision,'account_situation',a.account_situation));
END $function$;

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
     -- A situação descreve o endereço: bounce de outro endereço (confirmação
     -- de troca, aviso ao antigo, convite superado) não marca a conta.
     WHERE (v_email IS NULL AND id = v_portal_account_id)
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
       WHERE (v_email IS NULL AND a.id = v_portal_account_id)
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

CREATE OR REPLACE FUNCTION public._portal_list_disputes_core(p_customer_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', d.id, 'demurrage_invoice_id', d.demurrage_invoice_id,
      'doc_number', di.doc_number, 'state', d.state,
      'next_responder', d.next_responder, 'subject', d.subject,
      'created_at', d.created_at, 'updated_at', d.updated_at,
      'messages', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', m.id, 'author_type', m.author_type, 'body', m.body, 'next_responder', m.next_responder, 'created_at', m.created_at, 'attachments', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', a.id, 'file_name', a.file_name, 'mime_type', a.mime_type, 'storage_path', a.storage_path)) FROM public.demurrage_dispute_attachments a WHERE a.message_id = m.id), '[]'::jsonb)) ORDER BY m.created_at) FROM public.demurrage_dispute_messages m WHERE m.dispute_id = d.id), '[]'::jsonb)
    ) ORDER BY d.created_at DESC)
    FROM public.demurrage_disputes d
    JOIN public.demurrage_invoices di ON di.id = d.demurrage_invoice_id
    -- A Invoice também precisa ser do Cliente (defesa em profundidade).
    WHERE d.customer_id = p_customer_id AND di.customer_id = p_customer_id
  ), '[]'::jsonb);
END;
$function$;
