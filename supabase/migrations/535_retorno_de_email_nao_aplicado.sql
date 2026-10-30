-- 535: aviso do provedor de e-mail que o Vela não aplica deixa de virar
-- "Portal do Cliente — falha no reprocessamento" da Documentação.
--
-- Problema (produção, 30/10/2026): a conta da MillionSend avisa o webhook de
-- todo e-mail que sai dela, inclusive os do formulário do site da Fwlog para
-- suporte@portalfwlog.com.br. O Vela não acha esses envios entre os seus,
-- tenta de novo por 6 vezes (cerca de 7 h 20) e abria o alerta crítico
-- `portal_reprocessamento_falhou` para a Documentação, com o texto técnico
-- "Evento de email recebido sem tentativa vinculada após o limite de retry" e
-- o número interno do evento em Registro. O alerta não tem Cliente nem B/L, e
-- a conferência é no painel da MillionSend: nada que a Documentação faça.
--
-- Mudança (decisão do dono de 2026-10-30):
--   1. Tipo novo `email_retorno_nao_aplicado` ("Retorno do provedor de e-mail
--      não aplicado"): Administrativo, normal, abre os Alertas. Todo evento do
--      provedor que vai para investigação abre este tipo, não mais
--      `portal_reprocessamento_falhou`, que fica só para o B/L.
--   2. `process_portal_email_event`: aviso de **entrega** que esgota as 6
--      tentativas sem envio do Vela fecha sem alerta (`ignored_unknown_delivery`).
--      Devolução e spam sem envio do Vela continuam indo para investigação.
--      O resto do corpo é o da 469.
--   3. O gatilho `_portal_email_event_investigate_alert` abre o alerta em todos
--      os casos (antes a função acima abria o de envio não achado), com a
--      mensagem em português do operador: o que aconteceu, para quem (endereço
--      mascarado, `_mask_email_for_display`, regra de src/lib/maskEmail.ts),
--      quando (horário de Brasília) e o que fazer. O metadata leva
--      `recipient_masked`, que a fila mostra em Registro.
--   4. O tipo novo resolve com justificativa, como o anterior no evento de
--      e-mail (migration 316): nenhuma rotina tira o evento de 'investigate'.
--   5. Dados: aviso de entrega já em investigação por envio não achado passa a
--      'processed', e o alerta aberto dele fecha.
--
-- Reescreve linhas existentes (item 5). Apoia-se na afirmação "Data status" do
-- AGENTS.md (seção Gotchas): os dados de produção são de teste.
-- Rollback: reaplicar `process_portal_email_event` da 469,
-- `_portal_email_event_investigate_alert` da 309 e
-- `_alert_types_resolved_with_justification` da 495; desativar o tipo no
-- catálogo; apagar `_mask_email_for_display`.

INSERT INTO public.alert_type_catalog (type, severity, responsible_department, audience_departments, default_destination, active)
VALUES ('email_retorno_nao_aplicado', 'normal', 'administrativo', ARRAY['administrativo'], '/alertas', true)
ON CONFLICT (type) DO NOTHING;

-- Mesma regra de src/lib/maskEmail.ts: "suporte@portalfwlog.com.br" vira
-- "s***@p***.br". Sem endereço válido, NULL.
CREATE OR REPLACE FUNCTION public._mask_email_for_display(p_email text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
  SELECT left(v.local_part, 1) || '***@' || left(v.domain, 1) || '***'
         || COALESCE(substring(v.domain FROM '^.+(\.[^.]*)$'), '')
    FROM (SELECT split_part(lower(btrim(p_email)), '@', 1) AS local_part,
                 split_part(lower(btrim(p_email)), '@', 2) AS domain) v
   WHERE v.local_part <> '' AND v.domain <> '';
$function$;

REVOKE ALL ON FUNCTION public._mask_email_for_display(text) FROM PUBLIC, anon, authenticated;

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

  -- 469 (ADR 0104): e-mail enviado ao suporte com a chave desligada. A
  -- tentativa guarda o id do provedor com o prefixo `suporte:`; o retorno da
  -- caixa do suporte não muda a tentativa nem o contato do Cliente, e o evento
  -- fecha sem novas tentativas nem o alerta de reprocessamento.
  IF v_provider_message_id IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.portal_email_attempts WHERE provider_message_id = 'suporte:' || v_provider_message_id)
    OR EXISTS (SELECT 1 FROM public.customer_communication_attempts WHERE provider_message_id = 'suporte:' || v_provider_message_id)
  ) THEN
    v_result := jsonb_build_object(
      'event_id', v_event.id,
      'status', 'processing',
      'processed', true,
      'ignored_redirected_to_support', true,
      'provider_message_id', v_provider_message_id
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
    -- 535: a conta da MillionSend avisa o webhook de todo e-mail dela, também
    -- dos que saem de outro sistema (o formulário do site da Fwlog). Entrega
    -- que continua sem envio do Vela depois das 6 tentativas fecha sem alerta:
    -- não há contato nem tentativa a atualizar. As tentativas continuam porque
    -- o aviso pode chegar antes de o envio do Vela gravar o id do provedor.
    IF v_event.attempt_count >= 6 AND v_event_kind = 'email.delivered' THEN
      v_result := jsonb_build_object(
        'event_id', v_event.id,
        'status', 'processing',
        'processed', true,
        'ignored_unknown_delivery', true,
        'provider_message_id', v_provider_message_id
      );
      UPDATE public.portal_email_events
         SET processing_result = v_result,
             updated_at = now()
       WHERE id = v_event.id;
      RETURN v_result;
    END IF;
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
    -- 535: a entrada em 'investigate' abre o alerta pelo gatilho
    -- portal_email_events_investigate_alert, como nos demais casos.
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

CREATE OR REPLACE FUNCTION public._portal_email_event_investigate_alert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_recipient text := public._mask_email_for_display(COALESCE(NEW.payload #>> '{data,to,0}', NEW.payload->>'recipient'));
  v_notice text;
  v_message text;
BEGIN
  v_notice := format('A MillionSend avisou em %s que o e-mail para %s %s',
    to_char(NEW.received_at AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY "às" HH24:MI'),
    COALESCE(v_recipient, 'um endereço não informado'),
    CASE lower(btrim(NEW.event_type))
      WHEN 'email.delivered' THEN 'foi entregue'
      WHEN 'email.bounced' THEN 'foi devolvido'
      WHEN 'email.complained' THEN 'foi marcado como spam'
      ELSE format('teve o evento %s', NEW.event_type)
    END);
  v_message := v_notice || CASE NEW.last_error_code
    WHEN 'attempt_unresolved' THEN
      ', mas esse e-mail não está entre os enviados pelo Vela. Se ele saiu de outro sistema da mesma conta da MillionSend, como o site, resolva com justificativa; se saiu do Vela, procure o envio na MillionSend e confira o contato do Cliente.'
    WHEN 'ambiguous_provider_message_id' THEN
      ', mas o aviso corresponde a mais de um envio do Vela e nada foi atualizado. Confira os envios na MillionSend.'
    ELSE
      format(', mas o Vela não conseguiu aplicar o aviso depois de %s tentativas (erro %s). Confira o envio na MillionSend.',
        NEW.attempt_count, COALESCE(NEW.last_error_code, 'sem código'))
  END;

  -- Falha no Alerta não desfaz a investigação: o evento parar de ciclar vem antes.
  BEGIN
    PERFORM public.block521_upsert_alert(
      'email_retorno_nao_aplicado',
      'portal_email_event',
      NEW.id::text,
      v_message,
      'portal_email_events_runner',
      'administrativo',
      jsonb_build_object('event_id', NEW.id, 'provider_message_id', NEW.provider_message_id,
        'event_type', NEW.event_type, 'error_code', NEW.last_error_code, 'attempt_count', NEW.attempt_count,
        'recipient_masked', v_recipient, 'received_at', NEW.received_at),
      '/alertas'
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Alerta do evento de e-mail % nao gravado: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public._portal_email_event_investigate_alert() FROM PUBLIC, anon, authenticated;

-- Definição da 495 com o tipo novo.
CREATE OR REPLACE FUNCTION public._alert_types_resolved_with_justification()
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT ARRAY['portal_abuso_login', 'bl_vehicles_changed_on_reimport', 'ce_trocado_com_desbloqueio',
    'cobranca_demurrage_recusada', 'desbloqueio_ce_aviso_nao_enviado',
    'demurrage_invoice_dates_changed', 'comunicado_recusado',
    -- 495 (ADR 0111, D6): conferência da taxa alterada à mão.
    'taxa_alterada_mudou',
    -- 535: retorno do provedor de e-mail que nenhuma rotina tira da investigação.
    'email_retorno_nao_aplicado']::text[]
    || public._alert_types_held_after_justification();
$function$;

-- Item 5: aviso de entrega que já estava em investigação por envio não achado.
DO $entregas_535$
DECLARE
  v_event_id bigint;
  v_previous_role text := current_setting('request.jwt.claim.role', true);
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  FOR v_event_id IN
    SELECT id FROM public.portal_email_events
     WHERE status = 'investigate'
       AND last_error_code = 'attempt_unresolved'
       AND lower(btrim(event_type)) = 'email.delivered'
  LOOP
    UPDATE public.portal_email_events
       SET status = 'processed',
           processed_at = now(),
           last_error_code = NULL,
           last_error_message = NULL,
           processing_result = processing_result
             || jsonb_build_object('status', 'processed', 'ignored_unknown_delivery', true),
           updated_at = now()
     WHERE id = v_event_id;
    PERFORM public.resolve_alert_item('portal_reprocessamento_falhou', 'portal_email_event', v_event_id::text, 'migration_535',
      jsonb_build_object('note', 'Aviso de entrega de e-mail que não é do Vela fecha sem alerta (migration 535).'));
  END LOOP;
  PERFORM set_config('request.jwt.claim.role', coalesce(v_previous_role, ''), true);
END;
$entregas_535$;
