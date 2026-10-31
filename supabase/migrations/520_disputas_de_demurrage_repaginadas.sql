-- 520: Disputas de Demurrage (lote 7 do plano da repaginação da Demurrage;
-- ADR 0112, D15 a D18).
--
-- 1. Invoice cancelada cancela a Disputa aberta dela (D16). Vale para todo
--    caminho de cancelamento (`cancel_demurrage_invoice`, a reemissão por
--    datas, a troca de CNPJ): um gatilho adiado, no fim da transação, lê o
--    motivo do cancelamento em `audit_logs` e
--    - grava a mensagem de sistema na conversa, com o motivo;
--    - deixa a Invoice com `dispute_open` falso e `dispute_status`
--      `cancelado`, e a Disputa `cancelada` (gatilho da 1ª fase);
--    - avisa o Cliente no Portal (`dispute_cancelled`), com link para a aba
--      Demurrage;
--    - fecha os Alertas `portal_dispute_opened` e `demurrage_disputa_prazo`.
-- 2. Uma conversa por Invoice (D17): `portal_add_dispute_message` recusa abrir
--    Disputa nova para a Invoice que já teve uma resolvida e indica
--    Solicitar reabertura; `reopen_demurrage_dispute` recusa Invoice cancelada.
-- 3. Prazo de 1 dia útil (D18), pelo calendário do Vela (`business_holidays`,
--    o mesmo do Pix Itaú): a Disputa aberta que aguarda Equipamentos vence no
--    mesmo horário do dia útil seguinte ao início da espera (sexta 17h vence
--    segunda 17h; véspera de feriado pula o feriado). Vencida, abre o Alerta
--    `demurrage_disputa_prazo` para Equipamentos, que fecha quando a equipe
--    responde (gatilho na Disputa) ou na rotina `demurrage-disputa-prazo` a
--    cada 15 minutos, que também abre os que venceram sem gravação.
-- 4. A lista interna (`list_demurrage_disputes_internal`) devolve a situação e
--    os valores da Invoice, desde quando a Disputa espera, o prazo e se venceu;
--    as que aguardam a nossa resposta vêm primeiro (D15).
--
-- Não reescreve nem apaga linhas existentes.
--
-- Rollback: `SELECT cron.unschedule('demurrage-disputa-prazo')`; apagar os
-- gatilhos `trg_demurrage_invoice_cancel_dispute` e
-- `trg_demurrage_dispute_deadline_alert` e as funções novas; recriar
-- `portal_add_dispute_message` (473), `_reopen_demurrage_dispute_impl_20260920`
-- e `_list_demurrage_disputes_internal_impl_20260920` (472) e a restrição
-- `portal_notifications_type_check` sem `dispute_cancelled`; `UPDATE
-- alert_type_catalog SET active = false WHERE type = 'demurrage_disputa_prazo'`.

ALTER TABLE public.portal_notifications DROP CONSTRAINT IF EXISTS portal_notifications_type_check;
ALTER TABLE public.portal_notifications ADD CONSTRAINT portal_notifications_type_check
  CHECK (type IN ('invoice_issued', 'demurrage_issued', 'dispute_responded', 'dispute_opened', 'dispute_cancelled', 'system', 'transshipment'));

INSERT INTO public.alert_type_catalog (type, severity, responsible_department, audience_departments, default_destination)
VALUES ('demurrage_disputa_prazo', 'normal', 'equipamentos', ARRAY['equipamentos'], '/demurrage?tab=disputas')
ON CONFLICT (type) DO NOTHING;

-- ─── 1. Invoice cancelada cancela a Disputa aberta ────────────────────────

CREATE OR REPLACE FUNCTION public._demurrage_cancel_dispute_with_invoice()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_dispute public.demurrage_disputes%ROWTYPE;
  v_reason text;
  v_doc text;
BEGIN
  SELECT * INTO v_dispute FROM public.demurrage_disputes
   WHERE demurrage_invoice_id = NEW.id AND state = 'aberta'
   ORDER BY id DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND OR NOT EXISTS (SELECT 1 FROM public.demurrage_invoices WHERE id = NEW.id AND status = 'cancelled') THEN
    RETURN NULL;
  END IF;
  -- O motivo é o do cancelamento, gravado na mesma transação pelo caminho
  -- que cancelou (à mão, reemissão por datas ou troca de CNPJ).
  SELECT NULLIF(btrim(a.justification), '') INTO v_reason
    FROM public.audit_logs AS a
   WHERE a.entity_type = 'demurrage_invoice' AND a.entity_id = NEW.id::text
     AND a.field_name = 'status' AND a.new_value = 'cancelled'
   ORDER BY a.changed_at DESC, a.id DESC LIMIT 1;
  v_reason := COALESCE(v_reason, 'Invoice cancelada.');
  SELECT doc_number INTO v_doc FROM public.demurrage_invoices WHERE id = NEW.id;

  INSERT INTO public.demurrage_dispute_messages(dispute_id, author_id, author_type, body, next_responder, metadata)
  VALUES (v_dispute.id, NULL, 'sistema',
    format('A Invoice %s foi cancelada e esta disputa foi encerrada junto. Motivo: %s', v_doc, v_reason),
    'ninguem', jsonb_build_object('action', 'invoice_cancelled', 'reason', v_reason));
  -- Pelo gatilho da Invoice, a Disputa fica `cancelada` e o Alerta da
  -- Disputa (`portal_dispute_opened`) fecha.
  UPDATE public.demurrage_invoices SET dispute_open = false, dispute_status = 'cancelado' WHERE id = NEW.id;
  UPDATE public.demurrage_disputes SET state = 'cancelada', next_responder = 'ninguem', cancelled_at = COALESCE(cancelled_at, now())
   WHERE id = v_dispute.id AND state <> 'cancelada';
  INSERT INTO public.portal_notifications(customer_id, bl_id, type, title, message, link)
  VALUES (v_dispute.customer_id, NULL, 'dispute_cancelled', 'Disputa encerrada',
    format('A Invoice de Demurrage %s foi cancelada e a disputa foi encerrada. Motivo: %s', v_doc, v_reason),
    '/portal/billing?tab=demurrage&disputas=1&disputa=' || v_dispute.id);
  PERFORM set_config('alerts.foundation_trigger', 'on', true);
  PERFORM public.resolve_alert_item('portal_dispute_opened', 'demurrage_invoice', NEW.id::text, 'demurrage_invoice_cancelled', '{}'::jsonb);
  PERFORM public.resolve_alert_item('demurrage_disputa_prazo', 'demurrage_invoice', NEW.id::text, 'demurrage_invoice_cancelled', '{}'::jsonb);
  PERFORM set_config('alerts.foundation_trigger', 'off', true);
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public._demurrage_cancel_dispute_with_invoice() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_demurrage_invoice_cancel_dispute ON public.demurrage_invoices;
CREATE CONSTRAINT TRIGGER trg_demurrage_invoice_cancel_dispute
  AFTER UPDATE OF status ON public.demurrage_invoices
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  WHEN (NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled')
  EXECUTE FUNCTION public._demurrage_cancel_dispute_with_invoice();

-- ─── 2. Uma conversa por Invoice ──────────────────────────────────────────

-- Corpo da 473, com a recusa de D17 antes de abrir Disputa nova.
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
  -- 520 (ADR 0112, D17): uma conversa por Invoice. Depois de resolvida, o
  -- Cliente contesta de novo só pela reabertura, que Equipamentos decide.
  IF v_dispute.id IS NULL AND EXISTS (
    SELECT 1 FROM public.demurrage_disputes
     WHERE demurrage_invoice_id = v_invoice.id AND customer_id = v_customer_id AND state = 'resolvida'
  ) THEN
    RAISE EXCEPTION 'Esta Invoice já teve uma disputa resolvida. Para contestar de novo, use Solicitar reabertura na conversa da disputa.' USING ERRCODE = '22023';
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

-- Corpo da 472, com a recusa de Invoice cancelada (D17).
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
  -- 520 (ADR 0112, D17): reabre só em Invoice emitida ou paga.
  IF NOT EXISTS (SELECT 1 FROM public.demurrage_invoices WHERE id = v_dispute.demurrage_invoice_id AND status IN ('issued', 'overdue', 'paid')) THEN
    RAISE EXCEPTION 'A Invoice desta disputa está cancelada: a disputa não reabre.' USING ERRCODE = '22023';
  END IF;
  UPDATE public.demurrage_disputes SET state = 'aberta', next_responder = 'equipamentos', resolved_at = NULL, cancelled_at = NULL WHERE id = p_dispute_id;
  INSERT INTO public.demurrage_dispute_messages(dispute_id, author_id, author_type, body, next_responder, metadata)
  VALUES (p_dispute_id, auth.uid(), v_role, btrim(p_reason), 'equipamentos', jsonb_build_object('action', 'reopen'));
  UPDATE public.demurrage_invoices SET dispute_open = true, dispute_status = 'aberto' WHERE id = v_dispute.demurrage_invoice_id;
  PERFORM public.block521_upsert_alert('portal_dispute_opened', 'demurrage_invoice', v_dispute.demurrage_invoice_id::text, 'Dispute reaberta; análise de Equipamentos pendente.', 'portal_dispute_reopened', 'equipamentos', jsonb_build_object('dispute_id', p_dispute_id), '/demurrage?dispute=' || p_dispute_id);
END;
$function$;

-- ─── 3. Prazo de 1 dia útil ───────────────────────────────────────────────

-- Mesmo horário de Brasília no dia útil seguinte (calendário do Vela).
CREATE OR REPLACE FUNCTION public._demurrage_dispute_due_at(p_since timestamptz)
 RETURNS timestamptz
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_local timestamp := p_since AT TIME ZONE 'America/Sao_Paulo';
  v_day date := (p_since AT TIME ZONE 'America/Sao_Paulo')::date + 1;
BEGIN
  IF p_since IS NULL THEN RETURN NULL; END IF;
  -- ponytail: sem o ano em `business_holidays`, feriado conta como dia útil
  -- (o prazo vence antes); cadastrar o ano resolve, como no Pix Itaú.
  WHILE NOT public.itau_pix_business_day(v_day) LOOP
    v_day := v_day + 1;
  END LOOP;
  RETURN (v_day + v_local::time) AT TIME ZONE 'America/Sao_Paulo';
END;
$function$;
REVOKE ALL ON FUNCTION public._demurrage_dispute_due_at(timestamptz) FROM PUBLIC, anon, authenticated;

-- Desde quando a Disputa aberta espera Equipamentos: a primeira mensagem
-- depois da última que passou a vez a outro; sem mensagem, a abertura.
CREATE OR REPLACE FUNCTION public._demurrage_dispute_waiting_since(p_dispute_id bigint)
 RETURNS timestamptz
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE WHEN d.state = 'aberta' AND d.next_responder = 'equipamentos' THEN
    COALESCE((
      SELECT min(m.created_at) FROM public.demurrage_dispute_messages AS m
       WHERE m.dispute_id = d.id AND m.next_responder = 'equipamentos'
         AND m.created_at > COALESCE((
           SELECT max(o.created_at) FROM public.demurrage_dispute_messages AS o
            WHERE o.dispute_id = d.id AND o.next_responder <> 'equipamentos'), '-infinity'::timestamptz)
    ), d.created_at)
  END
  FROM public.demurrage_disputes AS d WHERE d.id = p_dispute_id;
$function$;
REVOKE ALL ON FUNCTION public._demurrage_dispute_waiting_since(bigint) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.reconcile_demurrage_dispute_deadline_alerts(p_dispute_id bigint DEFAULT NULL, p_source text DEFAULT 'demurrage_disputa_prazo')
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_previous_role text := current_setting('request.jwt.claim.role', true);
  v_previous_sub text := current_setting('request.jwt.claim.sub', true);
  v_previous_claims text := current_setting('request.jwt.claims', true);
  v_row RECORD;
  v_open integer := 0;
BEGIN
  -- Chamada pelo pg_cron e por gatilho: o Alerta é do sistema.
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);

  FOR v_row IN
    SELECT d.id, d.demurrage_invoice_id, di.doc_number, w.since, public._demurrage_dispute_due_at(w.since) AS due_at
      FROM public.demurrage_disputes AS d
      JOIN public.demurrage_invoices AS di ON di.id = d.demurrage_invoice_id
      CROSS JOIN LATERAL (SELECT public._demurrage_dispute_waiting_since(d.id) AS since) AS w
     WHERE (p_dispute_id IS NULL OR d.id = p_dispute_id)
  LOOP
    IF v_row.since IS NOT NULL AND now() > v_row.due_at THEN
      PERFORM public.upsert_alert_item(
        'demurrage_disputa_prazo', 'demurrage_invoice', v_row.demurrage_invoice_id::text,
        format('Disputa da Invoice %s sem resposta de Equipamentos desde %s: o prazo de 1 dia útil venceu em %s.',
          v_row.doc_number,
          to_char(v_row.since AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI'),
          to_char(v_row.due_at AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI')),
        p_source, 'equipamentos',
        jsonb_build_object('dispute_id', v_row.id, 'waiting_since', v_row.since, 'due_at', v_row.due_at),
        '/demurrage?dispute=' || v_row.id);
      v_open := v_open + 1;
    ELSIF EXISTS (
      SELECT 1 FROM public.alert_items i JOIN public.alerts a ON a.id = i.alert_id
       WHERE i.item_type = 'demurrage_disputa_prazo' AND i.status = 'active'
         AND a.entity_type = 'demurrage_invoice' AND a.entity_id = v_row.demurrage_invoice_id::text
    ) AND NOT EXISTS (
      -- Outra Disputa da mesma Invoice ainda vencida segura o Alerta.
      SELECT 1 FROM public.demurrage_disputes AS other
       WHERE other.demurrage_invoice_id = v_row.demurrage_invoice_id AND other.id <> v_row.id
         AND now() > public._demurrage_dispute_due_at(public._demurrage_dispute_waiting_since(other.id))
    ) THEN
      PERFORM public.resolve_alert_item('demurrage_disputa_prazo', 'demurrage_invoice', v_row.demurrage_invoice_id::text, p_source, '{}'::jsonb);
    END IF;
  END LOOP;

  PERFORM set_config('request.jwt.claim.role', COALESCE(v_previous_role, ''), true);
  PERFORM set_config('request.jwt.claim.sub', COALESCE(v_previous_sub, ''), true);
  PERFORM set_config('request.jwt.claims', COALESCE(v_previous_claims, ''), true);
  RETURN v_open;
END;
$function$;
REVOKE ALL ON FUNCTION public.reconcile_demurrage_dispute_deadline_alerts(bigint, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_demurrage_dispute_deadline_alerts(bigint, text) TO service_role;

-- A resposta da equipe (ou o fim da Disputa) fecha o Alerta na hora.
CREATE OR REPLACE FUNCTION public._demurrage_dispute_deadline_alert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  PERFORM public.reconcile_demurrage_dispute_deadline_alerts(NEW.id, 'demurrage_disputa_prazo_resposta');
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public._demurrage_dispute_deadline_alert() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_demurrage_dispute_deadline_alert ON public.demurrage_disputes;
CREATE TRIGGER trg_demurrage_dispute_deadline_alert
  AFTER UPDATE OF state, next_responder ON public.demurrage_disputes
  FOR EACH ROW
  WHEN (OLD.state IS DISTINCT FROM NEW.state OR OLD.next_responder IS DISTINCT FROM NEW.next_responder)
  EXECUTE FUNCTION public._demurrage_dispute_deadline_alert();

DO $schedule_520$
BEGIN
  IF to_regnamespace('cron') IS NULL THEN
    RAISE WARNING '520: pg_cron ausente; agende demurrage-disputa-prazo no ambiente de produção.';
    RETURN;
  END IF;
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'demurrage-disputa-prazo';
  PERFORM cron.schedule('demurrage-disputa-prazo', '7-59/15 * * * *',
    $cmd_520$SELECT public.reconcile_demurrage_dispute_deadline_alerts(NULL, 'demurrage-disputa-prazo');$cmd_520$);
END;
$schedule_520$;

-- ─── 4. Lista interna ─────────────────────────────────────────────────────

-- Corpo da 472 com a situação e os valores da Invoice, a espera e o prazo
-- (D15, D18); as que aguardam a nossa resposta primeiro.
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
    SELECT jsonb_agg(row_json ORDER BY waiting_us DESC, updated_at DESC)
    FROM (
      SELECT (d.state = 'aberta' AND d.next_responder = 'equipamentos') AS waiting_us, d.updated_at,
        jsonb_build_object(
          'id', d.id, 'demurrage_invoice_id', d.demurrage_invoice_id,
          'doc_number', di.doc_number, 'customer_id', d.customer_id,
          'customer_name', c.name, 'state', d.state,
          'next_responder', d.next_responder, 'subject', d.subject,
          'created_at', d.created_at, 'updated_at', d.updated_at,
          'resolved_at', d.resolved_at, 'cancelled_at', d.cancelled_at,
          'invoice_status', di.status, 'invoice_total_usd', di.total_usd,
          'invoice_discount_mode', di.discount_mode, 'invoice_discount_value', di.discount_value,
          'invoice_current_total_brl', di.current_total_brl,
          'waiting_since', w.since,
          'due_at', public._demurrage_dispute_due_at(w.since),
          'overdue', COALESCE(now() > public._demurrage_dispute_due_at(w.since), false),
          'messages', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', m.id, 'author_type', m.author_type, 'body', m.body, 'next_responder', m.next_responder, 'created_at', m.created_at, 'attachments', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', a.id, 'file_name', a.file_name, 'mime_type', a.mime_type, 'size_bytes', a.size_bytes, 'storage_path', a.storage_path) ORDER BY a.id) FROM public.demurrage_dispute_attachments a WHERE a.message_id = m.id), '[]'::jsonb)) ORDER BY m.created_at) FROM public.demurrage_dispute_messages m WHERE m.dispute_id = d.id), '[]'::jsonb)
        ) AS row_json
      FROM public.demurrage_disputes d
      JOIN public.demurrage_invoices di ON di.id = d.demurrage_invoice_id
      JOIN public.customers c ON c.id = d.customer_id
      CROSS JOIN LATERAL (SELECT public._demurrage_dispute_waiting_since(d.id) AS since) AS w
      WHERE p_state IS NULL OR d.state = p_state
    ) AS listed
  ), '[]'::jsonb);
END;
$function$;
