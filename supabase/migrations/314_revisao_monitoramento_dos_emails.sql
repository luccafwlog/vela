-- Migration 314: correções da revisão do monitoramento, da retenção e dos
-- grants dos e-mails (plano de correção dos e-mails,
-- docs/plans/2026-10-17-correcao-dos-emails.md, itens 2.1, 2.3, 2.7 e 5.3).
--
-- 1. Provedor sem retorno (2.1): o detector da migration 309 abria o Alerta
--    crítico email_retorno_provedor_silencioso por UMA tentativa aceita sem
--    evento próprio há 2 h (um e-mail adiado pelo destino bastava) e o deixava
--    aberto por até 7 dias, mesmo com o webhook de volta. Passa a medir o
--    silêncio do webhook: conta só as tentativas aceitas com id do provedor há
--    mais de 2 h e DEPOIS do último evento recebido em portal_email_events
--    (max(received_at)); qualquer evento novo fecha o Alerta na rodada
--    seguinte. Exige ao menos 3 dessas tentativas (ver o comentário no
--    detector). Índice novo em portal_email_events(received_at) para o max().
-- 2. Comunicado sem destinatário (nob_sem_destinatario, 304) e aviso do
--    Desbloqueio de CE não enviado (desbloqueio_ce_aviso_nao_enviado, 307):
--    o metadata passa a levar customer_cnpj, e "Abrir Cliente" abre a ficha do
--    Cliente em vez da lista (src/services/alerts.ts). As duas funções são as
--    definições das migrations 304 (evaluate_and_dispatch_automatic_communications)
--    e 307 (ce_unlock_email_finish) só com essa mudança.
-- 3. Grants (5.3): customer_communication_dunning_groups e
--    demurrage_dunning_claims, que ficaram de fora da migration 312, recebem o
--    mesmo tratamento: sai TRUNCATE, TRIGGER e REFERENCES de anon e
--    authenticated. Tabela ausente no ambiente é ignorada.
-- 4. mask_email_addresses (migration 311) ganha um COMMENT com o motivo de o
--    marcador ser 'email-<32 hex>' e não o 'sha256:<64 hex>' do recipientKey
--    das Edge Functions.
--
-- Fica como está: portal_reprocessamento_falhou do evento de e-mail
-- (migrations 109 e 309) continua com Documentação. O tipo existe desde a 022,
-- vale também para o reprocessamento do faturamento por B/L, e a audiência do
-- catálogo é por tipo; a D21 cobre os tipos novos. O link do alerta do evento
-- é corrigido no roteador (alerts.ts), não aqui.
--
-- Só cria índice, troca funções, comenta e tira privilégios; não altera nem
-- apaga linhas.

-- ---------------------------------------------------------------------------
-- 1. Detector dos e-mails: silêncio do webhook.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_portal_email_events_received_at
  ON public.portal_email_events (received_at);

-- Definição da migration 309 com o bloco "Provedor sem retorno" trocado; o
-- bloco do usuário interno com e-mail devolvido é o mesmo.
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

REVOKE ALL ON FUNCTION public.detect_email_monitoring_alerts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.detect_email_monitoring_alerts() TO service_role;

-- ---------------------------------------------------------------------------
-- 2. customer_cnpj no metadata dos alertas de Cliente sem destinatário.
-- ---------------------------------------------------------------------------
-- Definição da migration 304 com customer_cnpj nos alvos sem destinatário e no
-- metadata do alerta nob_sem_destinatario.
CREATE OR REPLACE FUNCTION public.evaluate_and_dispatch_automatic_communications(p_as_of timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_as_of timestamptz := coalesce(p_as_of, now());
  v_target record;
  v_customer record;
  v_candidates jsonb := '[]'::jsonb;
  v_unreachable jsonb := '{}'::jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Executor server-only.' USING ERRCODE = '42501';
  END IF;

  FOR v_target IN SELECT * FROM public.customer_communication_automation_targets(v_as_of) t ORDER BY t.claim_key
  LOOP
    IF COALESCE(cardinality(v_target.emails), 0) = 0 THEN
      -- 2.7: Cliente sem destinatário vira alerta, não candidato.
      v_unreachable := jsonb_set(v_unreachable, ARRAY[v_target.customer_id::text],
        COALESCE(v_unreachable -> (v_target.customer_id::text), '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
          'kind', v_target.kind, 'voyage_id', v_target.voyage_id, 'port', v_target.port,
          'voyage_number', v_target.voyage_number, 'atracacao_id', v_target.anchor_atracacao_id,
          'terminal_code', v_target.terminal_code, 'bl_ids', to_jsonb(v_target.bl_ids),
          'customer_name', v_target.customer_name, 'customer_cnpj', v_target.customer_cnpj)));
      CONTINUE;
    END IF;

    INSERT INTO public.customer_communication_automation_claims (claim_key)
    VALUES (v_target.claim_key)
    ON CONFLICT (claim_key) DO UPDATE
      SET claimed_at = now(), released_at = NULL, rejected_at = NULL, rejection_reason = NULL
      WHERE (customer_communication_automation_claims.released_at IS NOT NULL
         OR customer_communication_automation_claims.claimed_at < v_as_of - interval '30 minutes')
        AND (customer_communication_automation_claims.rejected_at IS NULL
         OR customer_communication_automation_claims.rejected_at < v_as_of - interval '24 hours')
        -- 1D: recusa não definitiva só volta depois do intervalo (migration 303).
        AND (customer_communication_automation_claims.next_attempt_at IS NULL
         OR customer_communication_automation_claims.next_attempt_at <= v_as_of);
    IF FOUND THEN
      v_candidates := v_candidates || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
        'claim_key', v_target.claim_key, 'kind', v_target.kind, 'nature', v_target.nature,
        'customer_id', v_target.customer_id, 'customer_name', v_target.customer_name,
        'customer_cnpj', v_target.customer_cnpj, 'voyage_id', v_target.voyage_id,
        'vessel_name', v_target.vessel_name, 'voyage_number', v_target.voyage_number,
        'port', v_target.port, 'milestone_at', v_target.milestone_text,
        'anchor_atracacao_id', v_target.anchor_atracacao_id, 'terminal_id', v_target.terminal_id,
        'terminal_name', v_target.terminal_code,
        'bl_ids', to_jsonb(v_target.bl_ids), 'emails', to_jsonb(v_target.emails)
      )));
    END IF;
  END LOOP;

  -- 2.7: um alerta por Cliente sem destinatário, com todos os seus alvos. Falha
  -- no alerta não aborta a rodada dos outros Clientes.
  FOR v_customer IN SELECT key AS customer_id, value AS targets FROM jsonb_each(v_unreachable)
  LOOP
    BEGIN
      PERFORM public.upsert_alert_item(
        'nob_sem_destinatario',
        'customer',
        v_customer.customer_id,
        'Cliente ' || (v_customer.targets -> 0 ->> 'customer_name') || ': sem contato ativo para receber '
          || (SELECT string_agg(public.customer_communication_kind_short_label(t ->> 'kind')
                || ' da viagem ' || COALESCE(t ->> 'voyage_number', t ->> 'voyage_id')
                || CASE WHEN t ->> 'kind' = 'ce_mercante_taxas' THEN '' ELSE ' (' || COALESCE(t ->> 'port', '—')
                  || COALESCE(' · ' || (t ->> 'terminal_code'), '') || ')' END,
                '; ' ORDER BY t ->> 'kind', t ->> 'voyage_id')
              FROM jsonb_array_elements(v_customer.targets) t)
          || '. Cadastre um contato na caixa Documentação e Operação (ou Financeiro, para o CE e Taxas).',
        'comunicado_automacao',
        -- 314: customer_cnpj leva "Abrir Cliente" à ficha do Cliente, não à lista.
        jsonb_build_object('customer_id', v_customer.customer_id::bigint,
          'customer_cnpj', v_customer.targets -> 0 ->> 'customer_cnpj', 'targets', v_customer.targets),
        '/clientes'
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Alerta nob_sem_destinatario do Cliente % nao gravado: %', v_customer.customer_id, SQLERRM;
    END;
  END LOOP;

  -- Fecha o alerta de quem já tem destinatário ou não tem mais alvo (janela
  -- vencida, Comunicado registrado, Cliente desativado).
  FOR v_customer IN
    SELECT DISTINCT a.entity_id
    FROM public.alert_items i
    JOIN public.alerts a ON a.id = i.alert_id
    WHERE i.item_type = 'nob_sem_destinatario' AND i.status = 'active'
      AND a.entity_type = 'customer'
      AND NOT (v_unreachable ? a.entity_id)
  LOOP
    BEGIN
      PERFORM public.resolve_alert_item('nob_sem_destinatario', 'customer', v_customer.entity_id, 'comunicado_automacao', '{}'::jsonb);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Alerta nob_sem_destinatario do Cliente % nao resolvido: %', v_customer.entity_id, SQLERRM;
    END;
  END LOOP;

  -- 1D: tira do alerta comunicado_recusado as claims cujo alvo deixou de existir.
  FOR v_customer IN
    SELECT DISTINCT a.entity_id
    FROM public.alert_items i
    JOIN public.alerts a ON a.id = i.alert_id
    WHERE i.item_type = 'comunicado_recusado' AND i.status = 'active'
      AND a.entity_type = 'customer' AND a.entity_id ~ '^[0-9]+$'
  LOOP
    PERFORM public.refresh_customer_communication_refusal_alert(v_customer.entity_id::bigint);
  END LOOP;

  RETURN v_candidates;
END;
$function$;

-- Definição da migration 307 com customer_cnpj no metadata do alerta.
CREATE OR REPLACE FUNCTION public.ce_unlock_email_finish(p_id bigint, p_status text, p_done text[], p_error text DEFAULT NULL)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_customer_id bigint;
  v_customer_name text;
  v_customer_cnpj text;
  v_kind text;
BEGIN
  IF p_status NOT IN ('pending', 'sent', 'partial', 'simulated', 'skipped', 'failed') THEN
    RAISE EXCEPTION 'Estado inválido';
  END IF;

  UPDATE public.ce_unlock_email_outbox
  SET status = p_status,
      done_recipients = coalesce(p_done, done_recipients),
      last_error = left(p_error, 300),
      attempts = attempts + 1,
      processed_at = CASE WHEN p_status = 'pending' THEN processed_at ELSE now() END
  WHERE id = p_id
  RETURNING customer_id, kind INTO v_customer_id, v_kind;

  IF v_customer_id IS NULL OR p_status = 'pending' THEN
    RETURN;
  END IF;

  BEGIN
    IF p_status IN ('skipped', 'failed') THEN
      SELECT c.name, c.cnpj_cpf INTO v_customer_name, v_customer_cnpj FROM public.customers c WHERE c.id = v_customer_id;
      PERFORM public.upsert_alert_item(
        'desbloqueio_ce_aviso_nao_enviado',
        'customer',
        v_customer_id::text,
        'Cliente ' || coalesce(v_customer_name, v_customer_id::text) || ': aviso do Desbloqueio de CE não enviado. '
          || CASE WHEN p_status = 'skipped' THEN 'Nenhum destinatário: ' ELSE 'Falha de envio: ' END
          || coalesce(left(p_error, 300), 'sem motivo informado'),
        'ce_unlock_email',
        -- 314: customer_cnpj leva "Abrir Cliente" à ficha do Cliente, não à lista.
        jsonb_build_object('customer_id', v_customer_id, 'customer_cnpj', v_customer_cnpj, 'outbox_id', p_id, 'kind', v_kind, 'status', p_status, 'reason', left(p_error, 300)),
        '/clientes'
      );
    ELSE
      PERFORM public.resolve_alert_item(
        'desbloqueio_ce_aviso_nao_enviado',
        'customer',
        v_customer_id::text,
        'ce_unlock_email',
        jsonb_build_object('outbox_id', p_id, 'status', p_status)
      );
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Alerta desbloqueio_ce_aviso_nao_enviado da linha % nao gravado: %', p_id, SQLERRM;
  END;
END
$function$;

REVOKE ALL ON FUNCTION public.ce_unlock_email_finish(bigint, text, text[], text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ce_unlock_email_finish(bigint, text, text[], text) TO service_role;

-- ---------------------------------------------------------------------------
-- 3. Grants das tabelas da Régua de Cobrança que faltaram na migration 312.
-- ---------------------------------------------------------------------------
DO $grants_314$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'customer_communication_dunning_groups',
    'demurrage_dunning_claims'
  ]
  LOOP
    IF to_regclass('public.' || v_table) IS NOT NULL THEN
      EXECUTE format('REVOKE TRUNCATE, TRIGGER, REFERENCES ON TABLE public.%I FROM anon, authenticated', v_table);
    END IF;
  END LOOP;
END;
$grants_314$;

-- ---------------------------------------------------------------------------
-- 4. Por que a máscara da retenção não usa o formato do recipientKey.
-- ---------------------------------------------------------------------------
COMMENT ON FUNCTION public.mask_email_addresses(text) IS
  'Retenção dos e-mails (migration 311, D17): troca cada endereço por ''email-'' + 32 hex do SHA-256 do endereço em minúsculas. '
  'O formato difere de propósito do ''sha256:<64 hex>'' do recipientKey (_shared/email.ts): a chave mascarada nunca coincide com '
  'uma chave nova, então o UPDATE da run_retention não esbarra na unicidade de idempotency_key, e nenhuma tentativa com mais de '
  '1 ano é reaproveitada por um envio novo. O marcador só identifica o mesmo endereço entre tentativas antigas.';
