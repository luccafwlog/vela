-- 451: o Histórico dos Comunicados mostra o e-mail exato de cada envio (ponto
-- 8 das observações de 2026-10-23).
--
-- Problema: a aba Histórico de /clientes/comunicacao mostrava o destinatário
-- mascarado (`recipient_masked`, `x***@d***.com`), e nenhuma coluna guardava o
-- endereço usado no envio. A tela é interna: a equipe precisa conferir para
-- qual endereço o comunicado saiu.
--
-- Mudança:
--   1. `customer_communication_attempts.recipient_email`: o endereço exato,
--      gravado pelas Edge Functions dos Comunicados e da Cobrança de Demurrage
--      daqui em diante. Envios anteriores ficam só com o mascarado, porque o
--      endereço nunca foi guardado.
--   2. Leitura só interna: a tabela já tem RLS `is_active_read_user()` e o
--      Portal não a lê (nenhuma RPC do Portal toca nela). O grant de SELECT da
--      tabela para `authenticated` (migration 002) cobre a coluna nova atrás da
--      mesma política.
--   3. `run_retention` (definição da 311): depois de 1 ano o endereço exato é
--      apagado, como a chave de idempotência e o motivo da falha são
--      mascarados; fica o `recipient_masked`.
--
-- Só acrescenta coluna e redefine a função; não reescreve nem apaga linhas (a
-- rotina de retenção é que apaga o endereço, ao rodar).
-- Rollback: reaplicar `run_retention` da 311 e
-- `ALTER TABLE public.customer_communication_attempts DROP COLUMN recipient_email`.

ALTER TABLE public.customer_communication_attempts ADD COLUMN IF NOT EXISTS recipient_email text;
COMMENT ON COLUMN public.customer_communication_attempts.recipient_email IS
  'E-mail exato do destinatário no envio (Histórico interno dos Comunicados). Apagado pela retenção de 1 ano; recipient_masked fica.';

CREATE OR REPLACE FUNCTION public.run_retention()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
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

  -- 451: o endereço exato do destinatário segue a mesma guarda de 1 ano.
  UPDATE public.customer_communication_attempts
     SET idempotency_key = public.mask_email_addresses(idempotency_key),
         last_error = public.mask_email_addresses(last_error),
         recipient_email = NULL
   WHERE created_at < now() - interval '1 year'
     AND (position('@' IN idempotency_key) > 0 OR position('@' IN COALESCE(last_error, '')) > 0 OR recipient_email IS NOT NULL);
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
