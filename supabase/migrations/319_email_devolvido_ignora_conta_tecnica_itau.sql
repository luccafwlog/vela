-- Migration 319: o alerta "E-mail devolvido" (usuario_email_devolvido,
-- migrations 309 e 314) ignora a conta técnica da baixa automática Itaú.
--
-- Depois do deploy do PR #973, a primeira rodada abriu o alerta para a conta
-- "API ITAÚ" (Administrativo). Ela existe só para ser o autor das baixas
-- automáticas do Pix (app_settings.itau_pix_settlement_actor, migration 152;
-- decisão de 2026-10-06 de não usar a conta de uma pessoa), precisa continuar
-- ativa, e o endereço dela não é uma caixa real: o alerta pedia uma correção
-- que não existe e só podia ser dispensado. A conta configurada como autor da
-- baixa sai do detector; o alerta aberto fecha na rodada seguinte pelo laço de
-- fechamento que já existe.
--
-- Definição vigente (migration 314) com uma condição a mais. Só troca a
-- função; não altera nem apaga linhas.

CREATE OR REPLACE FUNCTION public.detect_email_monitoring_alerts()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  -- Três tentativas seguidas sem nenhum evento depois delas é o padrão de
  -- webhook parado. Uma ou duas podem ser só o provedor segurando aquelas
  -- mensagens (destino adiando, fila do provedor) numa hora de pouco envio; com
  -- o webhook parado de verdade, o Resumo diário e os Comunicados passam de 3
  -- em poucas horas.
  c_min_silent CONSTANT integer := 3;
  v_last_event timestamptz;
  v_silent_portal integer := 0;
  v_silent_communication integer := 0;
  v_oldest timestamptz;
  v_bounced_users integer := 0;
  v_bounced_ids text[] := '{}'::text[];
  v_user record;
  v_open record;
BEGIN
  IF NOT public.alert_actor_is_authorized() THEN
    RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501';
  END IF;

  -- Provedor sem retorno (2.1): o que conta é o silêncio do webhook, não o
  -- evento de cada tentativa. Tentativa aceita antes do último evento recebido
  -- não conta, tenha ou não evento próprio: o webhook estava entregando depois
  -- dela. Sem evento nenhum na tabela, contam todas as da janela.
  SELECT max(e.received_at) INTO v_last_event FROM public.portal_email_events e;

  -- ponytail: updated_at da tentativa 'aceito' faz as vezes do horário de
  -- aceite (a tentativa não guarda esse instante à parte); a janela de 7 dias
  -- de created_at evita que a máscara da retenção (migration 311), que toca
  -- updated_at de tentativas com mais de 1 ano, entre na conta. Se outra
  -- escrita passar a tocar tentativas aceitas, gravar accepted_at.
  SELECT count(*) FILTER (WHERE src = 'portal'), count(*) FILTER (WHERE src = 'comunicado'), min(accepted_at)
    INTO v_silent_portal, v_silent_communication, v_oldest
  FROM (
    SELECT 'portal'::text AS src, a.updated_at AS accepted_at
    FROM public.portal_email_attempts a
    WHERE a.status = 'aceito'
      AND a.provider_message_id IS NOT NULL
      AND a.updated_at < now() - interval '2 hours'
      AND a.updated_at > COALESCE(v_last_event, '-infinity'::timestamptz)
      AND a.created_at >= now() - interval '7 days'
    UNION ALL
    SELECT 'comunicado', a.updated_at
    FROM public.customer_communication_attempts a
    WHERE a.status = 'aceito'
      AND a.dispatch_mode = 'real'
      AND a.provider_message_id IS NOT NULL
      AND a.updated_at < now() - interval '2 hours'
      AND a.updated_at > COALESCE(v_last_event, '-infinity'::timestamptz)
      AND a.created_at >= now() - interval '7 days'
  ) silent;

  IF v_silent_portal + v_silent_communication >= c_min_silent THEN
    PERFORM public.upsert_alert_item(
      'email_retorno_provedor_silencioso',
      'email_provider',
      'webhook',
      format('O webhook do provedor de e-mail está sem retorno: %s e-mail(s) aceito(s) há mais de 2 horas sem nenhum evento recebido depois deles (%s do Portal e avisos internos, %s de Comunicados; o mais antigo em %s; último evento recebido em %s). Sem esse retorno, entregas não são confirmadas e devoluções não suprimem o endereço. Confira o webhook na MillionSend e o segredo RESEND_WEBHOOK_SECRET.',
        v_silent_portal + v_silent_communication, v_silent_portal, v_silent_communication,
        to_char(v_oldest AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI'),
        COALESCE(to_char(v_last_event AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI'), 'nenhum')),
      'email_monitoring',
      jsonb_build_object('portal_attempts', v_silent_portal, 'communication_attempts', v_silent_communication,
        'oldest_accepted_at', v_oldest, 'last_event_received_at', v_last_event),
      '/alertas'
    );
  ELSE
    PERFORM public.resolve_alert_item('email_retorno_provedor_silencioso', 'email_provider', 'webhook', 'email_monitoring', '{}'::jsonb);
  END IF;

  -- Usuário interno com e-mail devolvido (2.8).
  FOR v_user IN
    SELECT p.id, p.full_name, s.reason, s.suppressed_at
    FROM public.user_profiles p
    JOIN auth.users u ON u.id = p.id
    JOIN LATERAL (
      SELECT x.reason, x.suppressed_at
      FROM (
        SELECT pse.reason, pse.suppressed_at FROM public.portal_suppressed_emails pse
        WHERE lower(btrim(pse.email)) = lower(btrim(u.email))
        UNION ALL
        SELECT ccs.reason, ccs.suppressed_at FROM public.customer_communication_suppressions ccs
        WHERE lower(btrim(ccs.email)) = lower(btrim(u.email))
      ) x
      ORDER BY x.suppressed_at DESC
      LIMIT 1
    ) s ON true
    WHERE p.active
      AND NULLIF(btrim(u.email), '') IS NOT NULL
      -- Conta técnica da baixa automática Itaú (migration 152): não é pessoa e
      -- não recebe e-mail; o endereço dela não precisa existir.
      AND p.id IS DISTINCT FROM (SELECT st.itau_pix_settlement_actor FROM public.app_settings st WHERE st.id = 1)
  LOOP
    v_bounced_users := v_bounced_users + 1;
    v_bounced_ids := v_bounced_ids || v_user.id::text;
    PERFORM public.upsert_alert_item(
      'usuario_email_devolvido',
      'user_profile',
      v_user.id::text,
      format('Usuário interno %s: o e-mail de acesso foi %s em %s e está suprimido; os e-mails do sistema (Resumo diário, avisos) não chegam a ele. Corrija o e-mail em Admin › Usuários › Editar acesso.',
        v_user.full_name,
        CASE WHEN v_user.reason = 'complaint' THEN 'marcado como spam' ELSE 'devolvido pelo provedor' END,
        to_char(v_user.suppressed_at AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY')),
      'email_monitoring',
      jsonb_build_object('user_id', v_user.id, 'reason', v_user.reason, 'suppressed_at', v_user.suppressed_at),
      '/admin/usuarios'
    );
  END LOOP;

  FOR v_open IN
    SELECT DISTINCT a.entity_id
    FROM public.alert_items i
    JOIN public.alerts a ON a.id = i.alert_id
    WHERE i.item_type = 'usuario_email_devolvido'
      AND i.status = 'active'
      AND a.entity_type = 'user_profile'
      AND NOT (a.entity_id = ANY (v_bounced_ids))
  LOOP
    PERFORM public.resolve_alert_item('usuario_email_devolvido', 'user_profile', v_open.entity_id, 'email_monitoring', '{}'::jsonb);
  END LOOP;

  RETURN jsonb_build_object(
    'silent_portal_attempts', v_silent_portal,
    'silent_communication_attempts', v_silent_communication,
    'last_event_received_at', v_last_event,
    'bounced_internal_users', v_bounced_users
  );
END;
$function$;
