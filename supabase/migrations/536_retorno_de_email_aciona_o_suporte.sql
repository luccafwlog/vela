-- 536: a mensagem do Alerta "Retorno do provedor de e-mail não aplicado"
-- (`email_retorno_nao_aplicado`) manda acionar o suporte em vez de procurar o
-- envio no painel da MillionSend.
--
-- Decisão do dono de 2026-10-30, na revisão da PR: não há registro de quem do
-- Administrativo tem acesso ao painel da MillionSend, e o tipo irmão
-- (Provedor de e-mail sem retorno) já orienta acionar o suporte.
--
-- Muda só os três textos do gatilho da 535; regra, setor, gravidade e
-- permissões iguais. Alerta já aberto mantém a mensagem antiga.
-- Não reescreve nem apaga linhas.
-- Rollback: reaplicar `_portal_email_event_investigate_alert` da 535.

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
      ', mas esse e-mail não está entre os enviados pelo Vela. Se ele saiu de outro sistema da mesma conta da MillionSend, como o site, resolva com justificativa; se saiu do Vela, acione o suporte com o destinatário e o horário deste alerta e confira o contato do Cliente.'
    WHEN 'ambiguous_provider_message_id' THEN
      ', mas o aviso corresponde a mais de um envio do Vela e nada foi atualizado. Acione o suporte com o destinatário e o horário deste alerta.'
    ELSE
      format(', mas o Vela não conseguiu aplicar o aviso depois de %s tentativas (erro %s). Acione o suporte com o destinatário e o horário deste alerta.',
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
