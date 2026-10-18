-- Migration 309: ninguém fica sem saber dos e-mails (plano de correção dos
-- e-mails, docs/plans/2026-10-17-correcao-dos-emails.md, itens 2.1, 2.4 e 2.8).
--
-- 1. Provedor sem retorno (2.1, INF-01): o detector de Alertas abre o tipo novo
--    email_retorno_provedor_silencioso (Administrativo, D21) quando há
--    tentativa 'aceito' com provider_message_id há mais de 2 h sem nenhum
--    evento em portal_email_events, em portal_email_attempts ou em
--    customer_communication_attempts (só envio real). Fecha sozinho quando não
--    houver mais. Sem retorno do webhook, bounces deixam de suprimir endereços
--    e os envios ficam "aceito" para sempre.
-- 2. Processamento de eventos (2.4, INF-08):
--    - complete_portal_email_event: a partir da 6ª conclusão com retry_wait
--      (attempt_count >= 6, a mesma régua de claim_portal_email_events), o
--      evento vai para 'investigate' em vez de esperar 6 h para sempre;
--    - gatilho em portal_email_events: toda entrada em 'investigate' abre o
--      Alerta portal_reprocessamento_falhou do evento, inclusive o caso
--      ambiguous_provider_message_id e o lease vencido na 6ª tentativa. O caso
--      attempt_unresolved já abria o Alerta em process_portal_email_event
--      (migration 109) e fica como está.
-- 3. E-mail devolvido de usuário interno (2.8, D19, INF-05/POR-08): o detector
--    abre o tipo novo usuario_email_devolvido (Administrativo) para cada
--    usuário interno ativo cujo e-mail de acesso (auth.users) está suprimido
--    por bounce ou reclamação; fecha quando o e-mail muda, a supressão sai ou o
--    usuário é desativado. admin_list_users devolve email_bounced para a tela
--    Admin › Usuários, e release_internal_user_email_suppression (server-only,
--    chamada pela Edge admin-users ao salvar o e-mail em Editar acesso) libera
--    a supressão do endereço antigo quando ele não é contato de Cliente nem
--    Email de Recuperação do Portal.
-- 4. run_alert_detectors chama o detector novo. Definição vigente (migration
--    002) com uma linha a mais.
--
-- Não altera nem apaga linhas existentes: só a rotina (detector, gatilho e
-- RPC) escreve, ao rodar.

INSERT INTO public.alert_type_catalog (type, severity, responsible_department, audience_departments, default_destination)
VALUES
  ('email_retorno_provedor_silencioso', 'critical', 'administrativo', ARRAY['administrativo'], '/alertas'),
  ('usuario_email_devolvido', 'normal', 'administrativo', ARRAY['administrativo'], '/admin/usuarios')
ON CONFLICT (type) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 1 e 3. Detector dos e-mails
-- ---------------------------------------------------------------------------
-- ponytail: olha só as tentativas criadas e aceitas nos últimos 7 dias (o
-- silêncio antigo já foi visto; a máscara da retenção, migration 311, toca
-- updated_at de tentativas de mais de 1 ano e não pode reabrir o Alerta) e faz um NOT EXISTS por tentativa em
-- portal_email_events (índices por provider_message_id, attempt_id e
-- communication_attempt_id). Com volume alto, trocar por uma marca de
-- "primeiro evento" na própria tentativa.
CREATE OR REPLACE FUNCTION public.detect_email_monitoring_alerts()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
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

  -- Provedor sem retorno (2.1).
  SELECT count(*) FILTER (WHERE src = 'portal'), count(*) FILTER (WHERE src = 'comunicado'), min(accepted_at)
    INTO v_silent_portal, v_silent_communication, v_oldest
  FROM (
    SELECT 'portal'::text AS src, a.updated_at AS accepted_at
    FROM public.portal_email_attempts a
    WHERE a.status = 'aceito'
      AND a.provider_message_id IS NOT NULL
      AND a.updated_at < now() - interval '2 hours'
      AND a.updated_at >= now() - interval '7 days'
      AND a.created_at >= now() - interval '7 days'
      AND NOT EXISTS (
        SELECT 1 FROM public.portal_email_events e
        WHERE e.provider_message_id = a.provider_message_id OR e.attempt_id = a.id
      )
    UNION ALL
    SELECT 'comunicado', a.updated_at
    FROM public.customer_communication_attempts a
    WHERE a.status = 'aceito'
      AND a.dispatch_mode = 'real'
      AND a.provider_message_id IS NOT NULL
      AND a.updated_at < now() - interval '2 hours'
      AND a.updated_at >= now() - interval '7 days'
      AND a.created_at >= now() - interval '7 days'
      AND NOT EXISTS (
        SELECT 1 FROM public.portal_email_events e
        WHERE e.provider_message_id = a.provider_message_id OR e.communication_attempt_id = a.id
      )
  ) silent;

  IF v_silent_portal + v_silent_communication > 0 THEN
    PERFORM public.upsert_alert_item(
      'email_retorno_provedor_silencioso',
      'email_provider',
      'webhook',
      format('%s e-mail(s) aceito(s) pelo provedor há mais de 2 horas sem retorno do webhook (%s do Portal e avisos internos, %s de Comunicados; o mais antigo em %s). Sem esse retorno, entregas não são confirmadas e devoluções não suprimem o endereço. Confira o webhook na MillionSend e o segredo RESEND_WEBHOOK_SECRET.',
        v_silent_portal + v_silent_communication, v_silent_portal, v_silent_communication,
        to_char(v_oldest AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI')),
      'email_monitoring',
      jsonb_build_object('portal_attempts', v_silent_portal, 'communication_attempts', v_silent_communication, 'oldest_accepted_at', v_oldest),
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
    'bounced_internal_users', v_bounced_users
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.detect_email_monitoring_alerts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.detect_email_monitoring_alerts() TO service_role;

-- ---------------------------------------------------------------------------
-- 4. Runner dos detectores: definição da migration 002 com o detector novo.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.run_alert_detectors() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_actor UUID;
  v_adr_pending INTEGER := 0;
  v_adr_deadline INTEGER := 0;
  v_bl_review INTEGER := 0;
  v_granite_review INTEGER := 0;
  v_voyage_ops INTEGER := 0;
  v_portal JSONB;
  v_customer_communications JSONB;
  v_email_monitoring JSONB;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Executor server-only.' USING ERRCODE = '42501';
  END IF;

  SELECT id INTO v_actor
  FROM public.user_profiles
  WHERE active = true AND role <> 'equipamentos'
  ORDER BY CASE WHEN role IN ('admin', 'administrativo') THEN 0 ELSE 1 END, created_at, id
  LIMIT 1;

  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Não há usuário interno ativo para executar os detectores.' USING ERRCODE = 'P0002';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_actor::TEXT, true);
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('alerts.detector_runner', 'on', true);

  -- Faturas vencidas saíram do runner: taxa local não tem vencimento praticado
  -- (issue #605). O Demurrage nunca teve (ADR 0014).

  -- ADR - Relatório de Saída da Agência (Bloco 5)
  v_adr_pending := public.detect_agency_report_pending();
  v_adr_deadline := public.detect_agency_report_deadline_missed();

  -- Revisão Manual de B/L e Granito (Bloco 1)
  v_bl_review := public.detect_bl_review_pendencies();
  v_granite_review := public.detect_granite_bl_review_pendencies();

  -- Operação e Viagens (Bloco 4)
  v_voyage_ops := public.detect_voyage_operation_alerts();

  -- Portal do Cliente e Disputas (Bloco 2)
  v_portal := public.reconcile_client_portal_alerts();

  -- Comunicados ao Cliente: NOA/NOR/NOB e falha de contato alternativo.
  v_customer_communications := public.detect_customer_communication_alerts();

  -- E-mails: provedor sem retorno e usuário interno com e-mail devolvido (310).
  v_email_monitoring := public.detect_email_monitoring_alerts();

  RETURN jsonb_build_object(
    'agency_report_pending', v_adr_pending,
    'agency_report_deadline_missed', v_adr_deadline,
    'bl_review_pendencies', v_bl_review,
    'granite_bl_review_pendencies', v_granite_review,
    'voyage_operation_alerts', v_voyage_ops,
    'client_portal', v_portal,
    'customer_communications', v_customer_communications,
    'email_monitoring', v_email_monitoring
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. Conclusão do evento: 6ª conclusão com retry_wait vai para investigação.
--    Definição da migration 022 com essa única mudança.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.complete_portal_email_event(p_event_id bigint, p_worker_id text, p_status text, p_error_code text DEFAULT NULL::text, p_error_message text DEFAULT NULL::text, p_retry_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_event public.portal_email_events%ROWTYPE;
  v_worker_id text := NULLIF(btrim(p_worker_id), '');
  v_status text := NULLIF(btrim(p_status), '');
  v_retry_at timestamptz;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'complete_portal_email_event exige service_role.' USING ERRCODE = '42501';
  END IF;
  IF p_event_id IS NULL OR v_worker_id IS NULL OR v_status IS NULL THEN
    RAISE EXCEPTION 'event_id, worker_id e status são obrigatórios.' USING ERRCODE = '22023';
  END IF;
  IF v_status NOT IN ('processed', 'retry_wait', 'failed', 'investigate') THEN
    RAISE EXCEPTION 'status de conclusão inválido.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_event
    FROM public.portal_email_events
   WHERE id = p_event_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Evento de email não encontrado.' USING ERRCODE = 'P0002';
  END IF;

  IF v_event.status = 'processed' THEN
    RETURN jsonb_build_object('event_id', v_event.id, 'status', 'processed', 'idempotent', true);
  END IF;
  IF v_event.status <> 'processing'
     OR v_event.leased_by IS DISTINCT FROM v_worker_id
     OR v_event.lease_until IS NULL
     OR v_event.lease_until < now() THEN
    RAISE EXCEPTION 'Lease do evento não pertence ao worker ou expirou.' USING ERRCODE = '40001';
  END IF;

  -- Seis tentativas (1, 5, 15, 60 e 360 min entre elas) esgotadas: o evento
  -- vai para investigação e o gatilho abre o Alerta (migration 309). Antes
  -- ficava em retry_wait a cada 6 h para sempre, sem aviso.
  IF v_status = 'retry_wait' AND v_event.attempt_count >= 6 THEN
    v_status := 'investigate';
  END IF;

  v_retry_at := CASE
    WHEN v_status = 'retry_wait' THEN COALESCE(
      p_retry_at,
      now() + CASE v_event.attempt_count
        WHEN 1 THEN interval '1 minute'
        WHEN 2 THEN interval '5 minutes'
        WHEN 3 THEN interval '15 minutes'
        WHEN 4 THEN interval '60 minutes'
        ELSE interval '360 minutes'
      END
    )
    ELSE NULL
  END;

  UPDATE public.portal_email_events
     SET status = v_status,
         process_after = v_retry_at,
         processed_at = CASE WHEN v_status = 'processed' THEN now() ELSE NULL END,
         lease_until = NULL,
         leased_by = NULL,
         last_error_code = NULLIF(btrim(p_error_code), ''),
         last_error_message = NULLIF(btrim(p_error_message), ''),
         processing_result = processing_result || jsonb_build_object('status', v_status),
         updated_at = now()
   WHERE id = p_event_id;

  INSERT INTO public.portal_email_event_attempts (
    event_id, attempt_no, worker_id, status, error_code, error_message, result
  ) VALUES (
    v_event.id, v_event.attempt_count, v_worker_id, v_status,
    NULLIF(btrim(p_error_code), ''), NULLIF(btrim(p_error_message), ''),
    v_event.processing_result || jsonb_build_object('status', v_status)
  );

  RETURN jsonb_build_object(
    'event_id', p_event_id,
    'status', v_status,
    'retry_at', v_retry_at,
    'idempotent', false
  );
END;
$function$;

-- ---------------------------------------------------------------------------
-- 2. Toda entrada em 'investigate' abre o Alerta do evento.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._portal_email_event_investigate_alert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- attempt_unresolved já abre o Alerta em process_portal_email_event (109).
  IF NEW.last_error_code IS NOT DISTINCT FROM 'attempt_unresolved' THEN
    RETURN NEW;
  END IF;
  -- Falha no Alerta não desfaz a investigação: o evento parar de ciclar vem antes.
  BEGIN
    PERFORM public.block521_upsert_alert(
      'portal_reprocessamento_falhou',
      'portal_email_event',
      NEW.id::text,
      CASE NEW.last_error_code
        WHEN 'ambiguous_provider_message_id' THEN
          'Evento de e-mail do provedor corresponde a mais de uma tentativa de envio e não foi aplicado; confira o envio no provedor.'
        ELSE
          'Evento de e-mail do provedor não foi processado depois de 6 tentativas (' || COALESCE(NEW.last_error_code, 'sem código') || '); investigue no provedor.'
      END,
      'portal_email_events_runner',
      'documentacao',
      jsonb_build_object('event_id', NEW.id, 'provider_message_id', NEW.provider_message_id,
        'event_type', NEW.event_type, 'error_code', NEW.last_error_code, 'attempt_count', NEW.attempt_count),
      '/clientes/portal'
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Alerta do evento de e-mail % nao gravado: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public._portal_email_event_investigate_alert() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS portal_email_events_investigate_alert ON public.portal_email_events;
CREATE TRIGGER portal_email_events_investigate_alert
  AFTER UPDATE OF status ON public.portal_email_events
  FOR EACH ROW
  WHEN (NEW.status = 'investigate' AND OLD.status IS DISTINCT FROM 'investigate')
  EXECUTE FUNCTION public._portal_email_event_investigate_alert();

-- ---------------------------------------------------------------------------
-- 3. Admin › Usuários mostra "E-mail devolvido".
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_list_users();
CREATE FUNCTION public.admin_list_users()
 RETURNS TABLE(id uuid, full_name text, role text, active boolean, created_at timestamp with time zone, email text, last_sign_in_at timestamp with time zone, email_bounced boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Apenas administradores podem listar usuários.'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
    SELECT
      p.id,
      p.full_name,
      p.role,
      p.active,
      p.created_at,
      u.email::TEXT,
      u.last_sign_in_at,
      (NULLIF(btrim(u.email), '') IS NOT NULL AND (
        EXISTS (SELECT 1 FROM public.portal_suppressed_emails pse WHERE lower(btrim(pse.email)) = lower(btrim(u.email)))
        OR EXISTS (SELECT 1 FROM public.customer_communication_suppressions ccs WHERE lower(btrim(ccs.email)) = lower(btrim(u.email)))
      )) AS email_bounced
    FROM public.user_profiles p
    LEFT JOIN auth.users u ON u.id = p.id
    ORDER BY p.full_name;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_list_users() FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_list_users() TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Editar acesso libera a supressão do endereço antigo do usuário interno.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.release_internal_user_email_suppression(p_email text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_email text := lower(btrim(COALESCE(p_email, '')));
  v_portal integer := 0;
  v_communication integer := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Executor server-only.' USING ERRCODE = '42501';
  END IF;
  IF v_email = '' THEN
    RETURN 0;
  END IF;
  -- Endereço que também é de Cliente continua suprimido: a devolução vale
  -- para os Comunicados e o Portal dele, e só o cadastro do Cliente corrige.
  IF EXISTS (SELECT 1 FROM public.customer_contacts cc WHERE lower(btrim(cc.email)) = v_email)
     OR EXISTS (SELECT 1 FROM public.customer_portal_accounts a WHERE lower(btrim(a.recovery_email)) = v_email) THEN
    RETURN 0;
  END IF;

  DELETE FROM public.portal_suppressed_emails WHERE lower(btrim(email)) = v_email;
  GET DIAGNOSTICS v_portal = ROW_COUNT;
  DELETE FROM public.customer_communication_suppressions WHERE lower(btrim(email)) = v_email;
  GET DIAGNOSTICS v_communication = ROW_COUNT;
  RETURN v_portal + v_communication;
END;
$function$;

REVOKE ALL ON FUNCTION public.release_internal_user_email_suppression(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_internal_user_email_suppression(text) TO service_role;
