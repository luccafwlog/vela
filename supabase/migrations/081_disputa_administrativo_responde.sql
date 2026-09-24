-- Migration 081: Equipamentos e Administrativo respondem, listam e reabrem
-- disputas de Demurrage (decisão R13 de 2026-09-23, plano
-- docs/plans/2026-09-23-alinhamento-apresentacao-docs-codigo.md).
--
-- Equipamentos continua dono da disputa: o Alerta portal_dispute_opened e o
-- próximo responsável interno seguem 'equipamentos'. O Administrativo responde
-- como cobertura, e a mensagem grava author_type = 'administrativo' para o
-- Portal mostrar quem respondeu. Os corpos abaixo são as definições vigentes
-- (002 e 068) com apenas a trava de perfil, o author_type e o texto da
-- notificação ajustados.
-- Não reescreve linhas existentes.

ALTER TABLE public.demurrage_dispute_messages
  DROP CONSTRAINT IF EXISTS demurrage_dispute_messages_author_type_check;
ALTER TABLE public.demurrage_dispute_messages
  ADD CONSTRAINT demurrage_dispute_messages_author_type_check
  CHECK (author_type = ANY (ARRAY['cliente'::text, 'equipamentos'::text, 'administrativo'::text, 'sistema'::text]));

CREATE OR REPLACE FUNCTION public._add_demurrage_dispute_message_impl_20260920(p_dispute_id bigint, p_body text, p_next_responder text DEFAULT 'cliente'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_role TEXT := public._portal_actor_role();
  v_dispute public.demurrage_disputes%ROWTYPE;
  v_message_id BIGINT;
  v_resolved BOOLEAN := p_next_responder = 'ninguem';
BEGIN
  IF v_role IS NULL OR v_role NOT IN ('equipamentos', 'administrativo') THEN RAISE EXCEPTION 'Apenas Equipamentos ou Administrativo pode responder a Dispute.' USING ERRCODE = '42501'; END IF;
  IF NULLIF(btrim(p_body), '') IS NULL THEN RAISE EXCEPTION 'Informe a mensagem da disputa.' USING ERRCODE = '22023'; END IF;
  IF p_next_responder NOT IN ('cliente', 'equipamentos', 'ninguem') THEN RAISE EXCEPTION 'Responsável inválido.' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_dispute FROM public.demurrage_disputes WHERE id = p_dispute_id FOR UPDATE;
  IF NOT FOUND OR v_dispute.state <> 'aberta' THEN RAISE EXCEPTION 'Dispute não está aberta.' USING ERRCODE = '42501'; END IF;
  IF v_dispute.next_responder <> 'equipamentos' THEN RAISE EXCEPTION 'A Dispute aguarda manifestação do cliente.' USING ERRCODE = '42501'; END IF;

  INSERT INTO public.demurrage_dispute_messages(dispute_id, author_id, author_type, body, next_responder, metadata)
  VALUES (p_dispute_id, auth.uid(), v_role, btrim(p_body), p_next_responder, jsonb_build_object('channel', 'internal'))
  RETURNING id INTO v_message_id;
  IF v_resolved THEN
    UPDATE public.demurrage_disputes SET state = 'resolvida', next_responder = 'ninguem', resolved_at = now() WHERE id = p_dispute_id;
    UPDATE public.demurrage_invoices SET dispute_open = false, dispute_status = 'resolvido' WHERE id = v_dispute.demurrage_invoice_id;
  ELSE
    UPDATE public.demurrage_disputes SET state = 'aberta', next_responder = p_next_responder WHERE id = p_dispute_id;
    UPDATE public.demurrage_invoices SET dispute_open = true, dispute_status = 'aberto' WHERE id = v_dispute.demurrage_invoice_id;
  END IF;
  IF p_next_responder = 'cliente' THEN
    INSERT INTO public.portal_notifications(customer_id, bl_id, type, title, message, link)
    SELECT v_dispute.customer_id, NULL, 'dispute_responded', 'Disputa respondida', CASE WHEN v_role = 'administrativo' THEN 'Administrativo respondeu à sua disputa.' ELSE 'Equipamentos respondeu à sua disputa.' END, '/demurrage';
    PERFORM public.block521_resolve_alert('portal_dispute_opened', 'demurrage_invoice', v_dispute.demurrage_invoice_id::text, 'equipamentos', 'portal_dispute_message');
  ELSIF p_next_responder = 'equipamentos' THEN
    PERFORM public.block521_upsert_alert(
      'portal_dispute_opened', 'demurrage_invoice', v_dispute.demurrage_invoice_id::text,
      'Nova resposta na Dispute; ação de Equipamentos pendente.', 'portal_dispute_message', 'equipamentos',
      jsonb_build_object('dispute_id', p_dispute_id, 'message_id', v_message_id), '/demurrage?dispute=' || p_dispute_id
    );
  ELSE
    PERFORM public.block521_resolve_alert('portal_dispute_opened', 'demurrage_invoice', v_dispute.demurrage_invoice_id::text, 'equipamentos', 'portal_dispute_message');
  END IF;
  RETURN jsonb_build_object('dispute_id', p_dispute_id, 'message_id', v_message_id, 'state', CASE WHEN v_resolved THEN 'resolvida' ELSE 'aberta' END);
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
  UPDATE public.demurrage_disputes SET state = 'aberta', next_responder = 'equipamentos', resolved_at = NULL, cancelled_at = NULL WHERE id = p_dispute_id;
  INSERT INTO public.demurrage_dispute_messages(dispute_id, author_id, author_type, body, next_responder, metadata)
  VALUES (p_dispute_id, auth.uid(), v_role, btrim(p_reason), 'equipamentos', jsonb_build_object('action', 'reopen'));
  UPDATE public.demurrage_invoices SET dispute_open = true, dispute_status = 'aberto' WHERE id = v_dispute.demurrage_invoice_id;
  PERFORM public.block521_upsert_alert('portal_dispute_opened', 'demurrage_invoice', v_dispute.demurrage_invoice_id::text, 'Dispute reaberta; análise de Equipamentos pendente.', 'portal_dispute_reopened', 'equipamentos', jsonb_build_object('dispute_id', p_dispute_id), '/demurrage?dispute=' || p_dispute_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public._list_demurrage_disputes_internal_impl_20260920(p_state text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF public._portal_actor_role() IS NULL OR public._portal_actor_role() NOT IN ('equipamentos', 'administrativo') THEN
    RAISE EXCEPTION 'Apenas Equipamentos ou Administrativo pode consultar a fila de Disputes.' USING ERRCODE = '42501';
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

CREATE OR REPLACE FUNCTION public.add_demurrage_dispute_message(p_dispute_id bigint, p_body text, p_next_responder text DEFAULT 'cliente'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF public._portal_actor_role() IS NULL OR public._portal_actor_role() NOT IN ('equipamentos', 'administrativo') THEN
    RAISE EXCEPTION 'Apenas Equipamentos ou Administrativo pode responder a Dispute.' USING ERRCODE = '42501';
  END IF;
  RETURN public._add_demurrage_dispute_message_impl_20260920(p_dispute_id, p_body, p_next_responder);
END;
$function$;

CREATE OR REPLACE FUNCTION public.list_demurrage_disputes_internal(p_state text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF public._portal_actor_role() IS NULL OR public._portal_actor_role() NOT IN ('equipamentos', 'administrativo') THEN
    RAISE EXCEPTION 'Apenas Equipamentos ou Administrativo pode consultar a fila de Disputes.' USING ERRCODE = '42501';
  END IF;
  RETURN public._list_demurrage_disputes_internal_impl_20260920(p_state);
END;
$function$;

CREATE OR REPLACE FUNCTION public.reopen_demurrage_dispute(p_dispute_id bigint, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF public._portal_actor_role() IS NULL OR public._portal_actor_role() NOT IN ('equipamentos', 'administrativo') THEN
    RAISE EXCEPTION 'Apenas Equipamentos ou Administrativo pode reabrir a Dispute.' USING ERRCODE = '42501';
  END IF;
  PERFORM public._reopen_demurrage_dispute_impl_20260920(p_dispute_id, p_reason);
END;
$function$;
