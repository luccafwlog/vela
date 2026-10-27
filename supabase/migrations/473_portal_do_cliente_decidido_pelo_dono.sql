-- 473: Portal do Cliente (decisões do dono de 2026-10-27, lote 5 do plano de
-- correções).
--
-- Problema e mudança, por seção:
--   1. POR-D13 — a troca do E-mail de recuperação pela equipe
--      (`portal_assisted_email_change`) e a liberação do endereço bloqueado
--      (`portal_release_suppressed_email`) deixavam o Portal pronto sem emitir
--      as faturas retidas. As duas passam a reprocessar o faturamento retido,
--      como a confirmação pelo Cliente (375); a liberação vale também para os
--      Clientes que dividem a caixa.
--   2. POR-D06 — as notificações "Disputa registrada" e "Disputa respondida"
--      apontavam para `/demurrage` (rota interna) e o sino do Portal não abria
--      nada. Passam a abrir Faturamento → Demurrage na Disputa; as já gravadas
--      são corrigidas.
--   3. POR-D02 — a Espiadinha (Modo Inspeção) da aba BLs não aplicava o filtro
--      de omissão vigente do Portal do Cliente e mostrava Transbordo de
--      omissão revertida. Os dois invólucros passam a usar o mesmo
--      `_portal_list_operation_bls_visible`.
--   4. POR-D03 — o detalhe da consolidada desfeita pelo Cliente dizia
--      "Substituída por outra fatura": o detalhe devolve `obsolete_reason`
--      ("Desfeita pelo cliente pelo portal.").
--
-- Data status: a seção 2 reescreve `portal_notifications.link` das
-- notificações de Disputa já gravadas. Depende da afirmação "Data status" do
-- AGENTS.md (2026-09-18): a produção não tem dados reais de negócio.
--
-- Rollback: reaplicar `portal_assisted_email_change` da `428`,
-- `portal_release_suppressed_email` da `002`, `portal_add_dispute_message` da
-- `434`, `_add_demurrage_dispute_message_impl_20260920` da `081`,
-- `portal_list_operation_bls` e `portal_inspect_list_operation_bls` da `002` e
-- `_portal_invoice_details_legacy_183` da `361`;
-- DROP FUNCTION public._portal_list_operation_bls_visible(bigint).

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
  -- 473 (POR-D13): o Portal ficou pronto pela troca da equipe: emite o que
  -- estava retido, como a confirmação pelo Cliente (375).
  IF public.customer_billing_access_ready(p_customer_id) THEN
    PERFORM public._reprocess_customer_held_billing_as_system(p_customer_id, 'assisted_email_change');
  END IF;
END; $function$;

CREATE OR REPLACE FUNCTION public.portal_release_suppressed_email(p_customer_id bigint, p_email text, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_role TEXT := public._portal_actor_role();
  v_account public.customer_portal_accounts%ROWTYPE;
  v_email TEXT := lower(NULLIF(trim(coalesce(p_email,'')),''));
  v_removed INTEGER;
  v_compartilhada public.customer_portal_accounts%ROWTYPE;
BEGIN
  IF v_role IS NULL OR v_role NOT IN ('administrativo','documentacao') THEN RAISE EXCEPTION 'permission denied' USING ERRCODE='42501'; END IF;
  IF NULLIF(trim(coalesce(p_reason,'')),'') IS NULL THEN RAISE EXCEPTION 'Justificativa é obrigatória.' USING ERRCODE='22023'; END IF;
  IF v_email IS NULL THEN RAISE EXCEPTION 'Email inválido.' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_account FROM public.customer_portal_accounts WHERE customer_id=p_customer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Registro de Portal não encontrado.' USING ERRCODE='P0002'; END IF;

  -- O endereço liberado tem de ser o que este Cliente usa. Sem isto, quem pode
  -- operar um Cliente qualquer poderia limpar o bloqueio de qualquer endereço
  -- do sistema, e o único rastro ficaria no histórico do Cliente escolhido para
  -- passar na guarda -- que não tem nada a ver com o endereço liberado.
  IF v_email IS DISTINCT FROM lower(v_account.recovery_email)
     AND v_email IS DISTINCT FROM lower(v_account.pending_recovery_email) THEN
    RAISE EXCEPTION 'Endereço não pertence a este Cliente.' USING ERRCODE='22023';
  END IF;

  DELETE FROM public.portal_suppressed_emails WHERE email = v_email;
  GET DIAGNOSTICS v_removed = ROW_COUNT;
  IF v_removed = 0 THEN RAISE EXCEPTION 'Endereço não está na lista de bloqueio.' USING ERRCODE='P0002'; END IF;

  -- O sinal de email quebrado (299) é consequência do bloqueio; liberar sem
  -- limpá-lo deixaria o console acusando falha num endereço que voltou a valer.
  UPDATE public.customer_portal_accounts SET recovery_email_status='ok'
  WHERE lower(recovery_email) = v_email AND recovery_email_status <> 'ok';

  PERFORM public._portal_log_event(
    p_customer_id, v_account.id, NULL,
    v_account.provisioning_decision, v_account.provisioning_decision,
    v_account.account_situation, v_account.account_situation,
    v_role,
    'Endereço ' || v_email || ' liberado da lista de bloqueio de emails. ' || trim(p_reason),
    NULL);

  -- Caixa compartilhada: a liberação já valeu para estes Clientes no DELETE
  -- acima. Registrar só no histórico de quem pediu deixaria os outros com o
  -- endereço reaberto e nenhuma linha explicando quando, por quem e por quê.
  -- `pending_recovery_email` conta junto: a guarda de propriedade acima aceita
  -- o endereço ainda não confirmado como sendo do Cliente, e quem espera a
  -- confirmação é exatamente quem o bloqueio estava impedindo de concluir.
  FOR v_compartilhada IN
    SELECT * FROM public.customer_portal_accounts
    WHERE (lower(recovery_email) = v_email OR lower(pending_recovery_email) = v_email)
      AND customer_id <> p_customer_id
  LOOP
    PERFORM public._portal_log_event(
      v_compartilhada.customer_id, v_compartilhada.id, NULL,
      v_compartilhada.provisioning_decision, v_compartilhada.provisioning_decision,
      v_compartilhada.account_situation, v_compartilhada.account_situation,
      v_role,
      'Endereço ' || v_email || ' liberado da lista de bloqueio de emails na liberação feita para o Cliente #'
        || p_customer_id || ' (caixa compartilhada). ' || trim(p_reason),
      NULL);
    IF public.customer_billing_access_ready(v_compartilhada.customer_id) THEN
      PERFORM public._reprocess_customer_held_billing_as_system(v_compartilhada.customer_id, 'suppressed_email_release');
    END IF;
  END LOOP;
  -- 473 (POR-D13): o endereço liberado deixa o Portal pronto: emite o retido.
  IF public.customer_billing_access_ready(p_customer_id) THEN
    PERFORM public._reprocess_customer_held_billing_as_system(p_customer_id, 'suppressed_email_release');
  END IF;
END; $function$;

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
  -- Fatura paga não abre Dispute nova (434); a conversa já aberta segue.
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
  SELECT v_customer_id, NULL, 'dispute_opened', 'Disputa registrada', 'Sua disputa de demurrage foi registrada.', '/portal/billing?tab=demurrage&disputas=1&disputa=' || v_dispute_id
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
    SELECT v_dispute.customer_id, NULL, 'dispute_responded', 'Disputa respondida', CASE WHEN v_role = 'administrativo' THEN 'Administrativo respondeu à sua disputa.' ELSE 'Equipamentos respondeu à sua disputa.' END, '/portal/billing?tab=demurrage&disputas=1&disputa=' || v_dispute.id;
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

CREATE OR REPLACE FUNCTION public._portal_list_operation_bls_visible(p_customer_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_rows JSONB := public._portal_list_operation_bls_core(p_customer_id);
BEGIN
  RETURN (
    SELECT COALESCE(jsonb_agg(
      item || jsonb_build_object(
        'transshipment', CASE
          WHEN omission.id IS NULL THEN NULL
          WHEN omission.disposition = 'cod' THEN jsonb_build_object(
            'omission_id', omission.id,
            'disposition', omission.disposition,
            'omitted_pod', omission.omitted_pod,
            'discharge_pod', omission.discharge_pod
          )
          ELSE jsonb_build_object(
            'omission_id', omission.id,
            'disposition', omission.disposition,
            'omitted_pod', omission.omitted_pod,
            'discharge_pod', omission.discharge_pod,
            'onward_vessel_name', omission.onward_vessel_name,
            'onward_carrier', omission.onward_carrier,
            'onward_voyage_number', omission.onward_voyage_number,
            'onward_etd', omission.onward_etd,
            'onward_eta', omission.onward_eta
          )
        END
      ) ORDER BY ordinality
    ), '[]'::jsonb)
    FROM jsonb_array_elements(v_rows) WITH ORDINALITY AS rows(item, ordinality)
    LEFT JOIN LATERAL (
      SELECT vo.id, bt.disposition, vo.omitted_pod, vo.discharge_pod,
             vo.onward_vessel_name, vo.onward_carrier, vo.onward_voyage_number,
             vo.onward_etd, vo.onward_eta
      FROM public.bl_transshipments bt
      JOIN public.voyage_omissions vo ON vo.id = bt.omission_id
      WHERE bt.bl_id = item->>'bl_id'
        AND vo.reverted_at IS NULL
      ORDER BY vo.omitted_at DESC, vo.id DESC
      LIMIT 1
    ) omission ON true
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.portal_list_operation_bls()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$ BEGIN RETURN public._portal_list_operation_bls_visible(public.current_portal_customer_id()); END; $function$;

CREATE OR REPLACE FUNCTION public.portal_inspect_list_operation_bls(p_customer_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$ BEGIN RETURN public._portal_list_operation_bls_visible(public._portal_inspect_guard(p_customer_id)); END; $function$;

CREATE OR REPLACE FUNCTION public._portal_invoice_details_legacy_183(p_customer_id bigint, p_invoice_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  result jsonb;
  v_covered_by bigint;
  v_covered_by_number text;
BEGIN
  result := public._portal_invoice_details_legacy_134(p_customer_id, p_invoice_id);
  result := result || jsonb_build_object('financial_summary', public._invoice_financial_summary(p_invoice_id));

  IF result #>> '{invoice,status}' = 'covered' THEN
    SELECT cov.id, cov.invoice_number INTO v_covered_by, v_covered_by_number
    FROM public.invoices AS i
    JOIN public.invoices AS cov ON cov.id = i.covered_by_invoice_id
    WHERE i.id = p_invoice_id
      AND public._portal_invoice_visible(p_customer_id, cov.id);
    -- A coberta não cobra mais nada: o saldo do B/L foi quitado pela consolidada.
    result := jsonb_set(result, '{invoice}', (result->'invoice') || jsonb_build_object(
      'balance_brl', 0,
      'covered_by_invoice_id', v_covered_by,
      'covered_by_invoice_number', v_covered_by_number
    ));
  END IF;

  -- 361: a consolidada substituída abre sem QR e aponta a sucessora (decisão 8).
  IF result #>> '{invoice,status}' = 'obsolete' THEN
    SELECT s.id, s.invoice_number INTO v_covered_by, v_covered_by_number
    FROM public.invoices AS s
    WHERE s.replaces_invoice_id = p_invoice_id
      AND public._portal_invoice_visible(p_customer_id, s.id)
    ORDER BY s.id DESC LIMIT 1;
    result := jsonb_set(result, '{invoice}', (result->'invoice') || jsonb_build_object(
      'balance_brl', 0,
      'pix_payload', NULL,
      'replaced_by_invoice_id', v_covered_by,
      'replaced_by_invoice_number', v_covered_by_number,
      -- 473 (POR-D03): a desfeita pelo Cliente diz isso, sem fatura nova.
      'obsolete_reason', (SELECT i.obsolete_reason FROM public.invoices i WHERE i.id = p_invoice_id)
    ));
  END IF;

  RETURN result;
END
$function$;

REVOKE ALL ON FUNCTION public._portal_list_operation_bls_visible(bigint) FROM PUBLIC, anon, authenticated;

-- Notificações de Disputa já gravadas com a rota interna.
UPDATE public.portal_notifications
   SET link = '/portal/billing?tab=demurrage&disputas=1'
 WHERE link = '/demurrage';
