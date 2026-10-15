-- Migration 250: leitura global nas telas restantes (itens A18 e P12 do plano
-- docs/plans/2026-10-14-correcoes-decididas-na-revisao-geral.md; ADR 0045;
-- ADR 0083, item 18; ADR 0085, D11, D12, D16, D17 e D19).
--
-- - Desbloqueio de CE: a leitura (ce_unlock_private.actor() sem gestão) aceita
--   Equipamentos, e os documentos do pedido e do VIP abrem para todo usuário
--   interno ativo (ce_unlock_read entrega os documentos a todos;
--   ce_unlock_document_access deixa de exigir a gestão). Gerir o pedido e ver a
--   referência externa da confirmação seguem de Administrativo e Documentação.
-- - Demurrage: list_demurrage_disputes_internal (e o núcleo
--   _list_demurrage_disputes_internal_impl_20260920) aceita qualquer Departamento;
--   responder, reabrir e anexar seguem de Equipamentos e do Administrativo.
-- - Portal: portal_list_provisioning_events aceita Operações, e o console
--   (portal_list_provisioning_console) deixa de mascarar Email de Recuperação,
--   origem, entrega e candidatos para Operações.
-- O corpo de cada função é o vigente; muda só quem lê. Não altera nem apaga linhas.

CREATE OR REPLACE FUNCTION ce_unlock_private.actor(p_manage boolean DEFAULT false)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE r text; BEGIN
 SELECT CASE role WHEN 'operator' THEN 'documentacao' ELSE role END INTO r FROM public.user_profiles WHERE id=auth.uid() AND active;
 IF r IS NULL OR (p_manage AND r NOT IN('administrativo','documentacao')) OR (NOT p_manage AND r NOT IN('administrativo','documentacao','financeiro','operacoes','equipamentos')) THEN
 RAISE EXCEPTION '42501: Acesso negado ao desbloqueio de CE.' USING ERRCODE='42501'; END IF;
 RETURN r;
END $function$;

CREATE OR REPLACE FUNCTION public.ce_unlock_read(p_kind text, p_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$ DECLARE role_name text; BEGIN
 role_name:=ce_unlock_private.actor();
 CASE p_kind WHEN 'bls' THEN RETURN ce_unlock_private.list(NULL,p_payload->'filters',coalesce((p_payload->>'page')::int,1));
 WHEN 'review_queue' THEN RETURN ce_unlock_private.review_queue(coalesce((p_payload->>'page')::int,1));
 WHEN 'request' THEN
   -- Documentos para todos; a referência externa da confirmação segue do desk.
   IF role_name IN('administrativo','documentacao') THEN
     RETURN ce_unlock_private.request_json((p_payload->>'request_id')::uuid,NULL,true);
   END IF;
   RETURN ce_unlock_private.request_json((p_payload->>'request_id')::uuid,NULL,false)
     || jsonb_build_object('documents', ce_unlock_private.request_json((p_payload->>'request_id')::uuid,NULL,true)->'documents');
 WHEN 'vip' THEN RETURN ce_unlock_private.vip_json((p_payload->>'customer_id')::bigint,true);
 WHEN 'exports' THEN PERFORM ce_unlock_private.actor(true); RETURN coalesce((SELECT jsonb_agg(to_jsonb(e) ORDER BY created_at DESC) FROM public.ce_unlock_exports e),'[]');
 WHEN 'model' THEN RETURN (SELECT ce_unlock_private.doc_json(id) FROM public.ce_unlock_documents WHERE source='model' AND status='approved' ORDER BY created_at DESC LIMIT 1);
 ELSE RAISE EXCEPTION 'Leitura inválida'; END CASE;
END $function$;

CREATE OR REPLACE FUNCTION public.ce_unlock_document_access(p_document_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$ DECLARE d public.ce_unlock_documents; c bigint; role_name text; BEGIN
 SELECT CASE role WHEN 'operator' THEN 'documentacao' ELSE role END INTO role_name FROM public.user_profiles WHERE id=auth.uid() AND active;
 IF role_name IS NOT NULL THEN PERFORM ce_unlock_private.actor(); ELSE c:=public.current_portal_customer_id(); END IF;
 SELECT * INTO d FROM public.ce_unlock_documents WHERE id=p_document_id;
 IF d.id IS NULL OR d.status='uploading' OR d.purged_at IS NOT NULL OR d.cleanup_claimed_at IS NOT NULL OR (role_name IS NULL AND d.source<>'model' AND d.customer_id IS DISTINCT FROM c) THEN RAISE EXCEPTION '42501: Documento não autorizado.' USING ERRCODE='42501'; END IF;
 RETURN d.storage_path;
END $function$;

CREATE OR REPLACE FUNCTION public._list_demurrage_disputes_internal_impl_20260920(p_state text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF public._portal_actor_role() IS NULL OR public._portal_actor_role() NOT IN ('administrativo', 'documentacao', 'financeiro', 'operacoes', 'equipamentos') THEN
    RAISE EXCEPTION 'Usuário interno ativo obrigatório para consultar as Disputes.' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', d.id, 'demurrage_invoice_id', d.demurrage_invoice_id,
      'doc_number', di.doc_number, 'customer_id', d.customer_id,
      'customer_name', c.name, 'state', d.state,
      'next_responder', d.next_responder, 'subject', d.subject,
      'created_at', d.created_at, 'updated_at', d.updated_at,
      'messages', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', m.id, 'author_type', m.author_type, 'body', m.body, 'next_responder', m.next_responder, 'created_at', m.created_at) ORDER BY m.created_at) FROM public.demurrage_dispute_messages m WHERE m.dispute_id = d.id), '[]'::jsonb)
    ) ORDER BY d.updated_at DESC)
    FROM public.demurrage_disputes d
    JOIN public.demurrage_invoices di ON di.id = d.demurrage_invoice_id
    JOIN public.customers c ON c.id = d.customer_id
    WHERE p_state IS NULL OR d.state = p_state
  ), '[]'::jsonb);
END;
$function$;

CREATE OR REPLACE FUNCTION public.list_demurrage_disputes_internal(p_state text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF public._portal_actor_role() IS NULL OR public._portal_actor_role() NOT IN ('administrativo', 'documentacao', 'financeiro', 'operacoes', 'equipamentos') THEN
    RAISE EXCEPTION 'Usuário interno ativo obrigatório para consultar as Disputes.' USING ERRCODE = '42501';
  END IF;
  RETURN public._list_demurrage_disputes_internal_impl_20260920(p_state);
END;
$function$;

CREATE OR REPLACE FUNCTION public.portal_list_provisioning_events(p_customer_id bigint, p_limit integer DEFAULT 10)
 RETURNS SETOF portal_provisioning_events
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_role TEXT := public._portal_actor_role();
BEGIN
  IF v_role IS NULL OR v_role NOT IN ('administrativo','documentacao','financeiro','operacoes','equipamentos') THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE='42501';
  END IF;
  RETURN QUERY SELECT e.* FROM public.portal_provisioning_events e
  WHERE e.customer_id = p_customer_id ORDER BY e.created_at DESC LIMIT LEAST(GREATEST(COALESCE(p_limit, 10), 1), 50);
END; $function$;

CREATE OR REPLACE FUNCTION public.portal_list_provisioning_console(p_customer_id bigint DEFAULT NULL)
 RETURNS SETOF jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_role TEXT := public._portal_actor_role();
  v_full_access BOOLEAN := v_role IN ('administrativo', 'documentacao', 'financeiro', 'operacoes', 'equipamentos');
BEGIN
  IF v_role IS NULL OR v_role NOT IN ('administrativo', 'documentacao', 'financeiro', 'operacoes', 'equipamentos') THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE = '42501';
  END IF;

  PERFORM public.portal_repair_missing_accounts();

  RETURN QUERY
  SELECT jsonb_build_object(
    'account_id', a.id,
    'customer_id', c.id,
    'customer_name', c.name,
    'cnpj_cpf', c.cnpj_cpf,
    'provisioning_decision', a.provisioning_decision,
    'account_situation', CASE
      WHEN a.account_situation = 'convite_pendente' AND pi.expires_at < now()
        THEN 'convite_expirado'
      ELSE a.account_situation
    END,
    'recovery_email', CASE WHEN v_full_access THEN a.recovery_email ELSE NULL END,
    'recovery_email_source', CASE WHEN v_full_access THEN a.recovery_email_source ELSE NULL END,
    'pending_invite_expires_at', pi.expires_at,
    'latest_delivery_status', CASE WHEN v_full_access THEN CASE WHEN ea.status = 'aceito' AND ea.provider_message_id IS NULL THEN 'nao_confirmado' ELSE ea.status END ELSE NULL END,
    'exception_reason', NULL,
    'last_event_at', ev.created_at,
    'has_critical_alert', EXISTS (
      SELECT 1
      FROM public.alerts al
      LEFT JOIN public.alert_items ai ON ai.alert_id = al.id
      WHERE al.status <> 'closed'
        AND (
          (al.entity_type = 'customer' AND al.entity_id = c.id::text)
          OR (al.entity_type = 'bl' AND EXISTS (
            SELECT 1
            FROM public.bls cb
            WHERE cb.id = al.entity_id AND cb.customer_id = c.id
          ))
        )
        AND (al.type = 'aggregate' OR ai.severity = 'critical' OR al.type = 'portal_abuso_login')
    ),
    'has_open_invoice', EXISTS (
      SELECT 1
      FROM public.invoices i
      WHERE i.customer_id = c.id
        AND i.status IN ('issued', 'overdue', 'partially_paid')
    ),
    'has_active_process', EXISTS (
      SELECT 1
      FROM public.bls b
      WHERE b.customer_id = c.id
        AND b.financial_status IS DISTINCT FROM 'cancelled'
    ),
    -- A fila precisa expor qualquer contato ativo com e-mail. Para contatos
    -- do modelo novo sem purpose, `geral` é somente o rótulo de compatibilidade
    -- da API; elegibilidade e roteamento continuam nas caixas canônicas.
    'candidates', CASE WHEN v_full_access THEN COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'email', cc.email,
          'purpose', COALESCE(cc.purpose, 'geral'),
          'origin', 'Contato do Cliente'
        ) ORDER BY cc.id
      )
      FROM public.customer_contacts cc
      WHERE cc.customer_id = c.id
        AND cc.deactivated_at IS NULL
        AND cc.email_normalized IS NOT NULL
    ), '[]'::jsonb) ELSE '[]'::jsonb END,
    'recovery_email_status', CASE WHEN v_full_access THEN a.recovery_email_status ELSE NULL END,
    'recovery_email_suppressed', CASE
      WHEN v_full_access AND a.recovery_email IS NOT NULL THEN EXISTS (
        SELECT 1
        FROM public.portal_suppressed_emails s
        WHERE s.email = lower(a.recovery_email)
      )
      ELSE false
    END,
    'shared_email_count', CASE
      WHEN v_full_access AND a.recovery_email IS NOT NULL THEN (
        SELECT count(*)
        FROM public.customer_portal_accounts other
        WHERE lower(other.recovery_email) = lower(a.recovery_email)
          AND other.id <> a.id
      )
      ELSE 0
    END
  )
  FROM public.customer_portal_accounts a
  JOIN public.customers c ON c.id = a.customer_id
  LEFT JOIN LATERAL (
    SELECT expires_at
    FROM public.portal_invites
    WHERE account_id = a.id
      AND purpose = 'convite'
      AND status = 'pendente'
    ORDER BY created_at DESC
    LIMIT 1
  ) pi ON true
  LEFT JOIN LATERAL (
    SELECT status, provider_message_id
    FROM public.portal_email_attempts
    WHERE account_id = a.id
    ORDER BY created_at DESC
    LIMIT 1
  ) ea ON true
  LEFT JOIN LATERAL (
    SELECT created_at
    FROM public.portal_provisioning_events
    WHERE customer_id = c.id
    ORDER BY created_at DESC
    LIMIT 1
  ) ev ON true
  WHERE p_customer_id IS NULL OR c.id = p_customer_id
  ORDER BY c.name;
END;
$function$;
