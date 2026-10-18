-- Migration 311: retenção de 1 ano dos e-mails (plano de correção dos e-mails,
-- item 5.2, D17, INF-15).
--
-- run_retention (migration 094) já apagava portal_email_event_attempts com
-- mais de 1 ano, mas não tocava em portal_email_events (o payload e o
-- processing_result guardam o endereço do destinatário) nem nas tentativas de
-- envio, cuja chave de idempotência e motivo de falha podem ter o e-mail em
-- claro (ex.: 'resumo:<data>:<e-mail>' e 'comunicado:<id>:<n>:<e-mail>').
--
-- 1. mask_email_addresses(text): troca cada endereço do texto por
--    'email-' + 32 primeiros hex do SHA-256 do endereço em minúsculas. É
--    determinística, então a chave de idempotência continua única.
-- 2. run_retention, além do que já fazia (definição da 094, mesma ordem):
--    - apaga portal_email_events recebidos há mais de 1 ano, junto com o
--      histórico deles em portal_email_event_attempts (somente inclusão; a
--      rotina liga vela.retention, como na 094);
--    - mascara idempotency_key e last_error de portal_email_attempts e de
--      customer_communication_attempts criadas há mais de 1 ano. O Histórico
--      do Comunicado continua (destinatário mascarado, status, data), sem o
--      e-mail completo. recipient_masked já é mascarado na gravação.
--
-- As tabelas de tentativas não têm payload próprio: o envelope do provedor
-- fica só em portal_email_events, que sai inteiro. A máscara muda updated_at
-- (gatilho set_updated_at); o detector de provedor sem retorno (migration 309)
-- só olha tentativas criadas nos últimos 7 dias, então não reabre Alerta.
--
-- A migration não altera nem apaga linhas; quem apaga e mascara é a rotina,
-- ao rodar (job data-retention, 06:30 UTC, migration 094).

CREATE OR REPLACE FUNCTION public.mask_email_addresses(p_text text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_text text := p_text;
  v_email text;
BEGIN
  IF v_text IS NULL OR position('@' IN v_text) = 0 THEN
    RETURN v_text;
  END IF;
  FOR v_email IN
    SELECT DISTINCT m[1]
    FROM regexp_matches(v_text, '([A-Za-z0-9._%+''-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})', 'g') AS m
    ORDER BY 1 DESC
  LOOP
    v_text := replace(v_text, v_email,
      'email-' || left(encode(extensions.digest(convert_to(lower(v_email), 'UTF8'), 'sha256'), 'hex'), 32));
  END LOOP;
  RETURN v_text;
END;
$function$;

REVOKE ALL ON FUNCTION public.mask_email_addresses(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.run_retention()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_result jsonb := '{}'::jsonb;
  v_count integer;
BEGIN
  PERFORM set_config('vela.retention', 'on', true);

  DELETE FROM public.audit_logs
  WHERE changed_at < now() - interval '5 years'
    AND entity_type NOT IN ('voyage_pod_schedule', 'voyage_pol_schedule')
    AND NOT (entity_type = 'voyages'
             AND field_name IN ('indicated_first_brazilian_port', 'indicated_first_brazilian_eta'));
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('audit_logs', v_count);

  DELETE FROM public.portal_provisioning_events WHERE created_at < now() - interval '1 year';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('portal_provisioning_events', v_count);

  -- O histórico de um evento que sai vai junto, mesmo que a última tentativa
  -- tenha menos de 1 ano (a FK é RESTRICT).
  DELETE FROM public.portal_email_event_attempts
  WHERE occurred_at < now() - interval '1 year'
     OR event_id IN (SELECT e.id FROM public.portal_email_events e WHERE e.received_at < now() - interval '1 year');
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('portal_email_event_attempts', v_count);

  -- Eventos do provedor (D17): o payload guarda o endereço do destinatário.
  DELETE FROM public.portal_email_events WHERE received_at < now() - interval '1 year';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('portal_email_events', v_count);

  -- Tentativas de envio (D17): ficam, sem o e-mail em claro.
  UPDATE public.portal_email_attempts
     SET idempotency_key = public.mask_email_addresses(idempotency_key),
         last_error = public.mask_email_addresses(last_error)
   WHERE created_at < now() - interval '1 year'
     AND (position('@' IN idempotency_key) > 0 OR position('@' IN COALESCE(last_error, '')) > 0);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('portal_email_attempts_masked', v_count);

  UPDATE public.customer_communication_attempts
     SET idempotency_key = public.mask_email_addresses(idempotency_key),
         last_error = public.mask_email_addresses(last_error)
   WHERE created_at < now() - interval '1 year'
     AND (position('@' IN idempotency_key) > 0 OR position('@' IN COALESCE(last_error, '')) > 0);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('customer_communication_attempts_masked', v_count);

  DELETE FROM public.portal_inspection_events WHERE created_at < now() - interval '1 year';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('portal_inspection_events', v_count);

  DELETE FROM public.portal_login_attempts WHERE attempted_at < now() - interval '1 year';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('portal_login_attempts', v_count);

  DELETE FROM public.portal_login_resolution_attempts WHERE attempted_at < now() - interval '1 year';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('portal_login_resolution_attempts', v_count);

  PERFORM set_config('vela.retention', 'off', true);
  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.run_retention() FROM PUBLIC, anon, authenticated;
