-- 353: alertas que só fechavam na rodada de 15 minutos fecham na hora do fato
-- (revisão dos alertas de 2026-10-21, docs/revisao-alertas-2026-10.md;
-- decisão do Lucca: "o ideal é que o alerta seja fechado imediatamente junto
-- com o fato que o resolve").
--
-- Problema: o fato que resolve estes alertas acontece fora do detector, mas só
-- o detector (`run_alert_detectors`, a cada 15 minutos) os fechava. Até a
-- rodada seguinte o alerta ficava aberto na fila e no sino.
--   1. NOA, NOR e NOB pendentes (`detect_customer_communication_alerts`, 315):
--      o Comunicado entregue a todos os destinatários (tentativa em
--      `customer_communication_attempts`) e a escala que muda (ETA, ATA,
--      exclusão ou omissão no audit `voyage_pod_schedule`).
--   2. "E-mail devolvido" do usuário interno (`detect_email_monitoring_alerts`,
--      319): o e-mail salvo em Admin › Usuários › Editar acesso (a Edge
--      `admin-users` chama `release_internal_user_email_suppression` depois de
--      gravar), a supressão liberada e o usuário desativado.
--   3. "Provedor de e-mail sem retorno" (mesmo detector): qualquer evento novo
--      do provedor em `portal_email_events`.
--
-- "B/Ls esperados" quando muda o ETD do porto de origem, listado no relatório
-- como só do detector, já fecha na hora: o audit `voyage_pol_schedule` atualiza
-- `voyages.pol_schedule_snapshot` (`trg_voyage_schedule_snapshot`), o audit
-- dessa atualização (`voyages`) chama `reconcile_voyage_operation_alerts`, que
-- reconcilia a viagem inteira (341). A suíte desta migration cobre o caso.
--
-- Mudança:
--   1. `resolve_customer_communication_pending_alerts(viagem, porto,
--      atracação, origem)` fecha os itens NOA/NOR/NOB abertos da escala (ou da
--      Atracação) que deixaram de ser alvo, pela mesma conta do detector
--      (`customer_communication_automation_targets`). Gatilhos em
--      `customer_communication_attempts` (tentativa entregue, aceita ou
--      devolvida) e no audit da escala a chamam. Na tentativa, a conta só roda
--      quando nenhum Cliente do alerta tem destinatário pendente.
--   2. `internal_users_with_bounced_email()` e
--      `resolve_internal_user_email_alerts(origem)` separam a regra do
--      detector; gatilhos de DELETE nas duas tabelas de supressão, de
--      desativação em `user_profiles` e o fim de
--      `release_internal_user_email_suppression` fecham na hora. Não há
--      gatilho em `auth.users`: o repositório não tem precedente no schema
--      `auth`, e a troca de e-mail do usuário interno passa sempre pela Edge
--      `admin-users`, que chama a RPC.
--   3. `reconcile_email_provider_silence_alert(origem)` é a conta do detector;
--      gatilho de INSERT em `portal_email_events` a chama quando o alerta está
--      aberto.
--
-- O detector continua: abre os alertas de prazo (nenhum evento acontece quando
-- o tempo passa) e é a rede de segurança. Ficam só no detector: a janela que
-- vence (NOA no ETA, NOR e NOB 30 dias depois), o B/L cancelado ou sem Cliente
-- e o Cliente desativado nos Comunicados, e o e-mail trocado fora da Edge
-- `admin-users`.
--
-- Falha ao fechar não desfaz a gravação de origem: vira WARNING, como nas
-- 347 e 348, e o detector refaz a conta.
--
-- Só cria e troca funções e gatilhos; não reescreve nem apaga linhas.
-- Rollback: DROP dos gatilhos resolve_customer_communication_alerts_on_attempt_insert,
-- resolve_customer_communication_alerts_on_attempt_update (customer_communication_attempts),
-- resolve_customer_communication_alerts_on_schedule_audit (audit_logs),
-- resolve_internal_user_email_alerts_on_release (portal_suppressed_emails e
-- customer_communication_suppressions),
-- resolve_internal_user_email_alerts_on_deactivation (user_profiles) e
-- resolve_email_provider_silence_on_event (portal_email_events) e das funções
-- novas; reaplicar `detect_email_monitoring_alerts` (319) e
-- `release_internal_user_email_suppression` (309).

-- 1 -------------------------------------------------------------------------
-- Comunicados NOA, NOR e NOB pendentes.
CREATE OR REPLACE FUNCTION public.resolve_customer_communication_pending_alerts(
  p_voyage_id bigint,
  p_port text,
  p_atracacao_id uuid,
  p_source text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_port text := COALESCE(public.normalize_port_code(p_port), NULLIF(upper(btrim(p_port)), ''));
  v_item record;
  v_keys text[];
  v_closed integer := 0;
BEGIN
  IF NOT public.alert_actor_is_authorized() THEN
    RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501';
  END IF;

  -- A Atracação identifica o NOB; a viagem e o porto, a escala (NOA, NOR e os
  -- NOB dela). O porto do item NOB é o do terminal, sem normalizar.
  FOR v_item IN
    SELECT DISTINCT i.item_type, a.entity_type, a.entity_id
    FROM public.alert_items i
    JOIN public.alerts a ON a.id = i.alert_id
    WHERE i.item_type IN ('comunicado_noa_pendente', 'comunicado_nor_pendente', 'comunicado_nob_pendente')
      AND i.status = 'active'
      AND CASE
        WHEN p_atracacao_id IS NOT NULL THEN i.metadata->>'state_id' = p_atracacao_id::text
        ELSE i.metadata->>'voyage_id' = p_voyage_id::text
          AND COALESCE(public.normalize_port_code(i.metadata->>'port'), upper(btrim(i.metadata->>'port'))) = v_port
      END
  LOOP
    -- Os alvos de agora, uma vez por chamada e só com item aberto. Mesma chave
    -- do detector (`detect_customer_communication_alerts`, 315).
    -- ponytail: a conta é a de todos os alvos, como no detector; filtrar por
    -- escala dentro de `customer_communication_automation_targets` é o upgrade
    -- se a conta pesar nos gatilhos.
    IF v_keys IS NULL THEN
      SELECT COALESCE(array_agg(
          CASE WHEN t.kind = 'aviso_chegada_noa' THEN 'comunicado_noa_pendente'
               WHEN t.kind = 'aviso_prontidao_nor' THEN 'comunicado_nor_pendente'
               ELSE 'comunicado_nob_pendente' END
          || '|' || t.voyage_id || '::' || t.port
          || CASE WHEN t.kind = 'aviso_atracacao_nob' THEN '::' || t.terminal_code ELSE '' END), '{}'::text[])
        INTO v_keys
      FROM public.customer_communication_automation_targets(now()) t
      WHERE t.kind IN ('aviso_chegada_noa', 'aviso_prontidao_nor', 'aviso_atracacao_nob');
    END IF;
    IF NOT (v_item.item_type || '|' || v_item.entity_id) = ANY (v_keys) THEN
      PERFORM public.resolve_alert_item(
        v_item.item_type, v_item.entity_type, v_item.entity_id,
        p_source, jsonb_build_object('reason', 'no_pending_target')
      );
      v_closed := v_closed + 1;
    END IF;
  END LOOP;

  RETURN v_closed;
END;
$function$;

REVOKE ALL ON FUNCTION public.resolve_customer_communication_pending_alerts(bigint, text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_customer_communication_pending_alerts(bigint, text, uuid, text) TO service_role;

-- Tentativa que resolve o destinatário (entregue, aceita ou devolvida): a
-- mesma condição de `customer_communication_target_pending_recipients` (318).
CREATE OR REPLACE FUNCTION public.resolve_customer_communication_alerts_on_attempt()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_communication public.customer_communications%ROWTYPE;
  v_item_type text;
  v_port text;
  v_previous text := current_setting('alerts.foundation_trigger', true);
BEGIN
  SELECT * INTO v_communication FROM public.customer_communications WHERE id = NEW.communication_id;
  IF NOT FOUND
     OR v_communication.nature IS DISTINCT FROM 'avisos_operacionais'
     OR v_communication.kind NOT IN ('aviso_chegada_noa', 'aviso_prontidao_nor', 'aviso_atracacao_nob') THEN
    RETURN NULL;
  END IF;
  v_item_type := CASE v_communication.kind
    WHEN 'aviso_chegada_noa' THEN 'comunicado_noa_pendente'
    WHEN 'aviso_prontidao_nor' THEN 'comunicado_nor_pendente'
    ELSE 'comunicado_nob_pendente' END;
  v_port := COALESCE(public.normalize_port_code(v_communication.anchor_port), upper(btrim(v_communication.anchor_port)));

  -- Sem alerta aberto do Comunicado, nada a fechar. Com algum Cliente do
  -- alerta ainda esperando destinatário, ele segue aberto: a conta de todos os
  -- alvos só roda quando a última tentativa pendente se resolve.
  IF NOT EXISTS (
    SELECT 1
    FROM public.alert_items i
    WHERE i.item_type = v_item_type
      AND i.status = 'active'
      AND CASE
        WHEN v_communication.kind = 'aviso_atracacao_nob' THEN i.metadata->>'state_id' = v_communication.anchor_atracacao_id::text
        ELSE i.metadata->>'voyage_id' = v_communication.anchor_voyage_id::text
          AND COALESCE(public.normalize_port_code(i.metadata->>'port'), upper(btrim(i.metadata->>'port'))) = v_port
      END
      AND NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(COALESCE(i.metadata->'customer_ids', '[]'::jsonb)) AS c(customer_id)
        WHERE public.customer_communication_target_pending_recipients(
          v_communication.kind, c.customer_id::bigint, v_communication.anchor_voyage_id, v_port,
          v_communication.anchor_atracacao_id,
          public.customer_communication_automatic_recipients(c.customer_id::bigint, ARRAY['documentacao_operacao'])
        ) IS NOT NULL
      )
  ) THEN
    RETURN NULL;
  END IF;

  PERFORM set_config('alerts.foundation_trigger', 'on', true);
  BEGIN
    IF v_communication.kind = 'aviso_atracacao_nob' THEN
      PERFORM public.resolve_customer_communication_pending_alerts(NULL, NULL, v_communication.anchor_atracacao_id, 'customer_communication_delivered');
    ELSE
      PERFORM public.resolve_customer_communication_pending_alerts(v_communication.anchor_voyage_id, v_port, NULL, 'customer_communication_delivered');
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Alerta de Comunicado pendente não fechado pela tentativa %: %', NEW.id, SQLERRM;
  END;
  PERFORM set_config('alerts.foundation_trigger', COALESCE(v_previous, ''), true);
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.resolve_customer_communication_alerts_on_attempt() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS resolve_customer_communication_alerts_on_attempt_insert ON public.customer_communication_attempts;
CREATE TRIGGER resolve_customer_communication_alerts_on_attempt_insert
  AFTER INSERT ON public.customer_communication_attempts
  FOR EACH ROW
  WHEN (NEW.status IN ('aceito', 'entregue', 'bounce', 'complaint'))
  EXECUTE FUNCTION public.resolve_customer_communication_alerts_on_attempt();

DROP TRIGGER IF EXISTS resolve_customer_communication_alerts_on_attempt_update ON public.customer_communication_attempts;
CREATE TRIGGER resolve_customer_communication_alerts_on_attempt_update
  AFTER UPDATE OF status, provider_message_id ON public.customer_communication_attempts
  FOR EACH ROW
  WHEN (NEW.status IN ('aceito', 'entregue', 'bounce', 'complaint')
    AND (OLD.status IS DISTINCT FROM NEW.status OR OLD.provider_message_id IS DISTINCT FROM NEW.provider_message_id))
  EXECUTE FUNCTION public.resolve_customer_communication_alerts_on_attempt();

-- 2 -------------------------------------------------------------------------
-- Audit da escala (ETA, ATA, exclusão ou omissão): fecha o NOA, NOR ou NOB
-- que deixou de ser alvo. A janela que vence sem gravação fica no detector.
CREATE OR REPLACE FUNCTION public.resolve_customer_communication_alerts_on_schedule_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_voyage_id bigint;
  v_previous text := current_setting('alerts.foundation_trigger', true);
BEGIN
  IF NEW.entity_id !~ '^[0-9]+::[^:]+$' THEN
    RETURN NULL;
  END IF;
  v_voyage_id := split_part(NEW.entity_id, '::', 1)::bigint;
  IF NOT EXISTS (
    SELECT 1 FROM public.alert_items i
    WHERE i.item_type IN ('comunicado_noa_pendente', 'comunicado_nor_pendente', 'comunicado_nob_pendente')
      AND i.status = 'active'
      AND i.metadata->>'voyage_id' = v_voyage_id::text
  ) THEN
    RETURN NULL;
  END IF;

  PERFORM set_config('alerts.foundation_trigger', 'on', true);
  BEGIN
    PERFORM public.resolve_customer_communication_pending_alerts(
      v_voyage_id, split_part(NEW.entity_id, '::', 2), NULL, 'customer_communication_schedule');
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Alerta de Comunicado pendente não fechado pelo audit_logs.id=%: %', NEW.id, SQLERRM;
  END;
  PERFORM set_config('alerts.foundation_trigger', COALESCE(v_previous, ''), true);
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.resolve_customer_communication_alerts_on_schedule_audit() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS resolve_customer_communication_alerts_on_schedule_audit ON public.audit_logs;
CREATE TRIGGER resolve_customer_communication_alerts_on_schedule_audit
  AFTER INSERT ON public.audit_logs
  FOR EACH ROW
  WHEN (NEW.entity_type = 'voyage_pod_schedule' AND NEW.field_name IN ('eta', 'ata', 'deleted', 'omitted'))
  EXECUTE FUNCTION public.resolve_customer_communication_alerts_on_schedule_audit();

-- 3 -------------------------------------------------------------------------
-- E-mail: as duas contas do detector (319) viram funções próprias, chamadas
-- pelo detector e pelos gatilhos.
CREATE OR REPLACE FUNCTION public.reconcile_email_provider_silence_alert(p_source text DEFAULT 'email_monitoring')
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
BEGIN
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
      p_source,
      jsonb_build_object('portal_attempts', v_silent_portal, 'communication_attempts', v_silent_communication,
        'oldest_accepted_at', v_oldest, 'last_event_received_at', v_last_event),
      '/alertas'
    );
  ELSE
    PERFORM public.resolve_alert_item('email_retorno_provedor_silencioso', 'email_provider', 'webhook', p_source, '{}'::jsonb);
  END IF;

  RETURN jsonb_build_object(
    'silent_portal_attempts', v_silent_portal,
    'silent_communication_attempts', v_silent_communication,
    'last_event_received_at', v_last_event
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.reconcile_email_provider_silence_alert(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_email_provider_silence_alert(text) TO service_role;

-- Usuário interno ativo com o e-mail de acesso suprimido (2.8). A conta técnica
-- da baixa automática Itaú (migration 152) não é pessoa e fica de fora (319).
CREATE OR REPLACE FUNCTION public.internal_users_with_bounced_email()
RETURNS TABLE (user_id uuid, full_name text, reason text, suppressed_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
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
    AND p.id IS DISTINCT FROM (SELECT st.itau_pix_settlement_actor FROM public.app_settings st WHERE st.id = 1);
$function$;

REVOKE ALL ON FUNCTION public.internal_users_with_bounced_email() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.internal_users_with_bounced_email() TO service_role;

CREATE OR REPLACE FUNCTION public.resolve_internal_user_email_alerts(p_source text DEFAULT 'email_monitoring')
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_open record;
  v_closed integer := 0;
BEGIN
  FOR v_open IN
    SELECT DISTINCT a.entity_id
    FROM public.alert_items i
    JOIN public.alerts a ON a.id = i.alert_id
    WHERE i.item_type = 'usuario_email_devolvido'
      AND i.status = 'active'
      AND a.entity_type = 'user_profile'
      AND NOT EXISTS (
        SELECT 1 FROM public.internal_users_with_bounced_email() b WHERE b.user_id::text = a.entity_id)
  LOOP
    PERFORM public.resolve_alert_item('usuario_email_devolvido', 'user_profile', v_open.entity_id, p_source, '{}'::jsonb);
    v_closed := v_closed + 1;
  END LOOP;
  RETURN v_closed;
END;
$function$;

REVOKE ALL ON FUNCTION public.resolve_internal_user_email_alerts(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_internal_user_email_alerts(text) TO service_role;

-- Definição vigente (migration 319) com as contas nas funções acima.
CREATE OR REPLACE FUNCTION public.detect_email_monitoring_alerts()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_silence jsonb;
  v_bounced_users integer := 0;
  v_user record;
BEGIN
  IF NOT public.alert_actor_is_authorized() THEN
    RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501';
  END IF;

  v_silence := public.reconcile_email_provider_silence_alert('email_monitoring');

  -- Usuário interno com e-mail devolvido (2.8).
  FOR v_user IN SELECT * FROM public.internal_users_with_bounced_email() LOOP
    v_bounced_users := v_bounced_users + 1;
    PERFORM public.upsert_alert_item(
      'usuario_email_devolvido',
      'user_profile',
      v_user.user_id::text,
      format('Usuário interno %s: o e-mail de acesso foi %s em %s e está suprimido; os e-mails do sistema (Resumo diário, avisos) não chegam a ele. Corrija o e-mail em Admin › Usuários › Editar acesso.',
        v_user.full_name,
        CASE WHEN v_user.reason = 'complaint' THEN 'marcado como spam' ELSE 'devolvido pelo provedor' END,
        to_char(v_user.suppressed_at AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY')),
      'email_monitoring',
      jsonb_build_object('user_id', v_user.user_id, 'reason', v_user.reason, 'suppressed_at', v_user.suppressed_at),
      '/admin/usuarios'
    );
  END LOOP;

  PERFORM public.resolve_internal_user_email_alerts('email_monitoring');

  RETURN jsonb_build_object(
    'silent_portal_attempts', v_silence->'silent_portal_attempts',
    'silent_communication_attempts', v_silence->'silent_communication_attempts',
    'last_event_received_at', v_silence->'last_event_received_at',
    'bounced_internal_users', v_bounced_users
  );
END;
$function$;

-- Supressão liberada (DELETE em qualquer das duas tabelas) ou usuário
-- desativado. A origem vem do gatilho.
CREATE OR REPLACE FUNCTION public.resolve_internal_user_email_alerts_on_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_previous text := current_setting('alerts.foundation_trigger', true);
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.alert_items i WHERE i.item_type = 'usuario_email_devolvido' AND i.status = 'active'
  ) THEN
    RETURN NULL;
  END IF;
  PERFORM set_config('alerts.foundation_trigger', 'on', true);
  BEGIN
    PERFORM public.resolve_internal_user_email_alerts(TG_ARGV[0]);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Alerta de e-mail devolvido não fechado (%): %', TG_ARGV[0], SQLERRM;
  END;
  PERFORM set_config('alerts.foundation_trigger', COALESCE(v_previous, ''), true);
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.resolve_internal_user_email_alerts_on_change() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS resolve_internal_user_email_alerts_on_release ON public.portal_suppressed_emails;
CREATE TRIGGER resolve_internal_user_email_alerts_on_release
  AFTER DELETE ON public.portal_suppressed_emails
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.resolve_internal_user_email_alerts_on_change('email_suppression_released');

DROP TRIGGER IF EXISTS resolve_internal_user_email_alerts_on_release ON public.customer_communication_suppressions;
CREATE TRIGGER resolve_internal_user_email_alerts_on_release
  AFTER DELETE ON public.customer_communication_suppressions
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.resolve_internal_user_email_alerts_on_change('email_suppression_released');

DROP TRIGGER IF EXISTS resolve_internal_user_email_alerts_on_deactivation ON public.user_profiles;
CREATE TRIGGER resolve_internal_user_email_alerts_on_deactivation
  AFTER UPDATE OF active ON public.user_profiles
  FOR EACH ROW
  WHEN (OLD.active AND NOT NEW.active)
  EXECUTE FUNCTION public.resolve_internal_user_email_alerts_on_change('user_deactivated');

-- Definição vigente (migration 309). A Edge `admin-users` chama esta RPC depois
-- de gravar o e-mail novo em Editar acesso: o alerta do usuário fecha aqui,
-- mesmo quando o endereço antigo continua suprimido por ser de Cliente (353).
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
  IF NOT EXISTS (SELECT 1 FROM public.customer_contacts cc WHERE lower(btrim(cc.email)) = v_email)
     AND NOT EXISTS (SELECT 1 FROM public.customer_portal_accounts a WHERE lower(btrim(a.recovery_email)) = v_email) THEN
    DELETE FROM public.portal_suppressed_emails WHERE lower(btrim(email)) = v_email;
    GET DIAGNOSTICS v_portal = ROW_COUNT;
    DELETE FROM public.customer_communication_suppressions WHERE lower(btrim(email)) = v_email;
    GET DIAGNOSTICS v_communication = ROW_COUNT;
  END IF;

  -- Falha ao fechar não desfaz a liberação; o detector refaz a conta.
  BEGIN
    PERFORM public.resolve_internal_user_email_alerts('user_email_changed');
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Alerta de e-mail devolvido não fechado na troca de e-mail: %', SQLERRM;
  END;
  RETURN v_portal + v_communication;
END;
$function$;

REVOKE ALL ON FUNCTION public.release_internal_user_email_suppression(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_internal_user_email_suppression(text) TO service_role;

-- Evento novo do provedor: o webhook voltou.
CREATE OR REPLACE FUNCTION public.resolve_email_provider_silence_on_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_previous text := current_setting('alerts.foundation_trigger', true);
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.alert_items i WHERE i.item_type = 'email_retorno_provedor_silencioso' AND i.status = 'active'
  ) THEN
    RETURN NULL;
  END IF;
  PERFORM set_config('alerts.foundation_trigger', 'on', true);
  BEGIN
    PERFORM public.reconcile_email_provider_silence_alert('email_event_received');
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Alerta de provedor sem retorno não reconciliado: %', SQLERRM;
  END;
  PERFORM set_config('alerts.foundation_trigger', COALESCE(v_previous, ''), true);
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.resolve_email_provider_silence_on_event() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS resolve_email_provider_silence_on_event ON public.portal_email_events;
CREATE TRIGGER resolve_email_provider_silence_on_event
  AFTER INSERT ON public.portal_email_events
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.resolve_email_provider_silence_on_event();
