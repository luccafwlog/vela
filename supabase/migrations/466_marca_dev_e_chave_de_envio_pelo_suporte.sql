-- 466: marca Dev e chave de envio que redireciona ao suporte (ADR 0104;
-- decisões do dono de 2026-10-27, lote 1 do plano de correções).
--
-- Problema:
--   1. A chave "Envio real de e-mails" (`app_settings.communications_enabled`)
--      é ferramenta de teste do dono, mas qualquer usuário do Administrativo
--      a muda (`set_communications_enabled`, migration `002`).
--   2. Só Administrativo, Documentação e Equipamentos leem `app_settings`
--      (política `app_settings_communications_read`): Financeiro e Operações
--      veem "Em simulação" com o envio ligado e o intervalo de 7 dias na Régua
--      (ficha ACE-D01).
--   3. Disparar Comunicado e salvar modelo são só desses três setores; o dono
--      decidiu que todos agem em Comunicação, e só contatos e Caixas de
--      Comunicação continuam com três setores (ACE-D01, opção A).
--
-- Mudança:
--   1. Coluna `user_profiles.is_dev` (marca Dev). Sem INSERT/UPDATE para
--      `authenticated`: nenhuma tela nem usuário logado a muda, inclusive o
--      Administrativo; dar ou tirar a marca é outra migration. Cada mudança
--      entra no Histórico de ações (`audit_user_profile_changes`).
--   2. `is_dev_user()`: conta ativa, Administrativo, pessoa e com a marca.
--   3. `set_communications_enabled` exige `is_dev_user()`.
--   4. `app_settings` legível por todo usuário interno ativo.
--   5. `save_customer_communication_saved_template` aceita todo usuário
--      interno ativo. O disparo do Comunicado abre na Edge Function
--      `send-customer-communication`, na mesma mudança.
--   6. `admin_list_users` devolve `is_dev` (tela Usuários: "Administrativo · Dev").
--   7. O reenvio do Comunicado de CE e Taxas redirecionado ao suporte
--      ("simulado") fecha o alerta "Reenviar Comunicado de CE e Taxas", como o
--      envio real: o envio redirecionado conta como enviado também nos alertas.
--   8. `process_portal_email_event` reconhece o retorno do provedor para o
--      e-mail enviado ao suporte (id com prefixo `suporte:` na tentativa) e
--      fecha o evento: sem ele, o evento ficaria sem tentativa, seria tentado
--      seis vezes e abriria "Portal do Cliente — falha no reprocessamento".
--   9. Dados: a marca vai para `lucca.juliatti@fwlog.com.br`, o mesmo e-mail em
--      produção e staging; ambiente sem essa conta só registra aviso.
--
-- Data status: a seção 9 reescreve linhas existentes de `user_profiles`
-- (`is_dev` da conta do dono). Depende da afirmação "Data status" do AGENTS.md
-- (2026-09-18): a produção não tem dados reais de negócio.
--
-- Rollback: reaplicar `set_communications_enabled` e `admin_list_users`
-- (definições vigentes: migrations `002` e `440`), a política
-- `app_settings_communications_read` da `002`, as duas funções de modelo
-- (`002`), `audit_user_profile_changes` e o gatilho da `440`,
-- `resolve_ce_resend_alert_on_communication_sent` da `238`,
-- `process_portal_email_event` da `428`; `DROP FUNCTION
-- public.is_dev_user()`; `ALTER TABLE public.user_profiles DROP COLUMN is_dev`.

-- 1 --- Marca Dev -------------------------------------------------------------
ALTER TABLE public.user_profiles
  ADD COLUMN is_dev boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.user_profiles.is_dev IS
  'Marca Dev (ADR 0104): permissões especiais acima do Administrativo, hoje só a chave de envio de e-mails. Só migration ou service_role alteram.';

-- Desde a 440 os grants de INSERT/UPDATE são por coluna e coluna nova nasce
-- sem eles; o REVOKE deixa a regra explícita.
REVOKE INSERT (is_dev), UPDATE (is_dev) ON public.user_profiles FROM PUBLIC, anon, authenticated;

-- 2 --- Quem é Dev ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_dev_user()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.user_profiles p
    WHERE p.id = auth.uid()
      AND p.active = true
      AND p.is_dev = true
      AND p.role = 'administrativo'
      AND p.account_kind = 'pessoa'
  ) AND public._internal_token_current();
$function$;

REVOKE ALL ON FUNCTION public.is_dev_user() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_dev_user() TO authenticated;

-- Histórico de acesso: definição vigente da 440 com a marca Dev.
CREATE OR REPLACE FUNCTION public.audit_user_profile_changes()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  -- Motivo de uma troca feita fora da tela (migration, manutenção).
  v_reason text := NULLIF(btrim(COALESCE(current_setting('vela.access_change_reason', true), '')), '');
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
    VALUES ('user_profile', NEW.id::TEXT, 'role', OLD.role, NEW.role, auth.uid(), v_reason);
  END IF;

  IF NEW.active IS DISTINCT FROM OLD.active THEN
    INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
    VALUES ('user_profile', NEW.id::TEXT, 'active', OLD.active::TEXT, NEW.active::TEXT, auth.uid(), v_reason);
  END IF;

  IF NEW.account_kind IS DISTINCT FROM OLD.account_kind THEN
    INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
    VALUES ('user_profile', NEW.id::TEXT, 'account_kind', OLD.account_kind, NEW.account_kind, auth.uid(), v_reason);
  END IF;

  IF NEW.is_dev IS DISTINCT FROM OLD.is_dev THEN
    INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
    VALUES ('user_profile', NEW.id::TEXT, 'is_dev', OLD.is_dev::TEXT, NEW.is_dev::TEXT, auth.uid(), v_reason);
  END IF;

  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.audit_user_profile_changes() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_audit_user_profile_changes ON public.user_profiles;
CREATE TRIGGER trg_audit_user_profile_changes
  AFTER UPDATE OF role, active, account_kind, is_dev ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION public.audit_user_profile_changes();

-- 3 --- Chave de envio só com a marca Dev -------------------------------------
CREATE OR REPLACE FUNCTION public.set_communications_enabled(p_enabled boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_previous BOOLEAN;
BEGIN
  IF p_enabled IS NULL THEN
    RAISE EXCEPTION 'O estado da chave de envio de e-mails é obrigatório.' USING ERRCODE = '22023';
  END IF;

  IF NOT public.is_dev_user() THEN
    RAISE EXCEPTION 'Somente a conta Dev pode ligar ou desligar o envio real de e-mails.'
      USING ERRCODE = '42501';
  END IF;

  SELECT communications_enabled
    INTO v_previous
    FROM public.app_settings
    WHERE id = 1
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Configuração global não encontrada.' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.app_settings
  SET communications_enabled = p_enabled
  WHERE id = 1;

  IF v_previous IS DISTINCT FROM p_enabled THEN
    INSERT INTO public.audit_logs (
      entity_type, entity_id, field_name, old_value, new_value, changed_by, justification
    )
    VALUES (
      'app_settings', '1', 'communications_enabled', v_previous::TEXT, p_enabled::TEXT, auth.uid(),
      'Alteração da chave global de envio de e-mails'
    );
  END IF;

  RETURN p_enabled;
END;
$function$;

REVOKE ALL ON FUNCTION public.set_communications_enabled(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_communications_enabled(boolean) TO authenticated;

-- 4 --- Configuração legível por todo usuário interno ativo (ACE-D01) ---------
DROP POLICY IF EXISTS app_settings_communications_read ON public.app_settings;
CREATE POLICY app_settings_communications_read ON public.app_settings
  FOR SELECT TO authenticated
  USING ((SELECT public.current_actor_role()) IS NOT NULL);

-- 5 --- Modelo de Comunicado por todo usuário interno ativo (ACE-D01, opção A)
CREATE OR REPLACE FUNCTION public._save_customer_communication_saved_template_impl_20260920(p_name text, p_subject text, p_body text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_id BIGINT;
BEGIN
  IF public._portal_actor_role() IS NULL THEN
    RAISE EXCEPTION 'Sem permissão para salvar modelos.' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.customer_communication_saved_templates (name, subject, body, created_by)
  VALUES (btrim(p_name), btrim(p_subject), btrim(p_body), auth.uid())
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.save_customer_communication_saved_template(p_name text, p_subject text, p_body text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF public._portal_actor_role() IS NULL THEN
    RAISE EXCEPTION 'Sem permissão para salvar modelos.' USING ERRCODE = '42501';
  END IF;
  RETURN public._save_customer_communication_saved_template_impl_20260920(p_name, p_subject, p_body);
END;
$function$;

-- 6 --- Lista de usuários com a marca Dev -------------------------------------
-- O retorno muda: DROP e CREATE, com os grants da 440.
DROP FUNCTION IF EXISTS public.admin_list_users();
CREATE FUNCTION public.admin_list_users()
 RETURNS TABLE(id uuid, full_name text, role text, active boolean, created_at timestamp with time zone, email text, last_sign_in_at timestamp with time zone, email_bounced boolean, account_kind text, is_dev boolean)
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
      )) AS email_bounced,
      p.account_kind,
      p.is_dev
    FROM public.user_profiles p
    LEFT JOIN auth.users u ON u.id = p.id
    ORDER BY p.full_name;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_list_users() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_users() TO authenticated;

-- 7 --- Reenvio de CE redirecionado fecha o alerta ----------------------------
-- Definição vigente da 238 com `simulado` (envio redirecionado ao suporte).
CREATE OR REPLACE FUNCTION public.resolve_ce_resend_alert_on_communication_sent()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bl_id text;
BEGIN
  IF NEW.kind <> 'ce_mercante_taxas' OR NEW.status NOT IN ('enviado', 'parcial', 'simulado')
     OR (TG_OP = 'UPDATE' AND OLD.status IN ('enviado', 'parcial', 'simulado'))
     OR NOT public.alert_actor_is_authorized() THEN
    RETURN NULL;
  END IF;
  FOR v_bl_id IN
    SELECT DISTINCT a.entity_id
    FROM public.customer_communication_bls AS cb
    JOIN public.alerts AS a ON a.entity_type = 'bl' AND a.entity_id = cb.bl_id
    JOIN public.alert_items AS i ON i.alert_id = a.id
    WHERE cb.communication_id = NEW.id
      AND i.item_type = 'comunicado_ce_reenvio_pendente' AND i.status = 'active'
      -- Só o Comunicado criado depois da última troca de CE vale como reenvio.
      AND i.updated_at <= NEW.created_at
  LOOP
    PERFORM public.resolve_alert_item('comunicado_ce_reenvio_pendente', 'bl', v_bl_id,
      'customer_communication_resend',
      jsonb_build_object('resolution', 'comunicado_reenviado', 'communication_id', NEW.id, 'status', NEW.status));
  END LOOP;
  RETURN NULL;
END;
$function$;

-- 8 --- Retorno do provedor para o e-mail enviado ao suporte ------------------
-- Definição vigente da 428 com o bloco da 466 depois do evento desconhecido.
CREATE OR REPLACE FUNCTION public.process_portal_email_event(p_event_id bigint, p_worker_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_event public.portal_email_events%ROWTYPE;
  v_worker_id text := NULLIF(btrim(p_worker_id), '');
  v_provider_message_id text;
  v_email text;
  v_next_status text;
  v_event_kind text;
  v_bounce_type text;
  v_permanent_bounce boolean := false;
  v_portal_count integer := 0;
  v_communication_count integer := 0;
  v_portal_attempt_id bigint;
  v_communication_attempt_id bigint;
  v_communication_id bigint;
  v_portal_account_id bigint;
  v_portal_kind text;
  v_attempt_status text;
  v_stale boolean := false;
  v_customer_id bigint;
  v_customer_ids jsonb := '[]'::jsonb;
  v_result jsonb;
  v_retry_status text;
  v_retry_at timestamptz;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'process_portal_email_event exige service_role.' USING ERRCODE = '42501';
  END IF;
  IF p_event_id IS NULL OR v_worker_id IS NULL THEN
    RAISE EXCEPTION 'event_id e worker_id são obrigatórios.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_event
    FROM public.portal_email_events
   WHERE id = p_event_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Evento de email não encontrado.' USING ERRCODE = 'P0002';
  END IF;
  IF v_event.status IN ('processed', 'investigate', 'failed') THEN
    RETURN COALESCE(v_event.processing_result, '{}'::jsonb)
      || jsonb_build_object('event_id', v_event.id, 'status', v_event.status, 'idempotent', true);
  END IF;
  IF v_event.status <> 'processing'
     OR v_event.leased_by IS DISTINCT FROM v_worker_id
     OR v_event.lease_until IS NULL
     OR v_event.lease_until < now() THEN
    RAISE EXCEPTION 'Lease do evento não pertence ao worker ou expirou.' USING ERRCODE = '40001';
  END IF;

  v_event_kind := lower(btrim(v_event.event_type));
  v_provider_message_id := NULLIF(btrim(COALESCE(
    v_event.provider_message_id,
    v_event.payload #>> '{data,email_id}'
  )), '');
  v_email := NULLIF(lower(btrim(COALESCE(
    v_event.payload #>> '{data,to,0}',
    v_event.payload->>'recipient'
  ))), '');
  v_bounce_type := lower(btrim(COALESCE(v_event.payload #>> '{data,bounce,type}', '')));
  v_permanent_bounce := v_event_kind = 'email.bounced' AND v_bounce_type = 'permanent';

  IF v_event_kind NOT IN ('email.delivered', 'email.bounced', 'email.complained') THEN
    v_result := jsonb_build_object(
      'event_id', v_event.id,
      'status', 'processing',
      'processed', true,
      'ignored_unknown_event', true
    );
    UPDATE public.portal_email_events
       SET processing_result = v_result,
           updated_at = now()
     WHERE id = v_event.id;
    RETURN v_result;
  END IF;

  -- 466 (ADR 0104): e-mail enviado ao suporte com a chave desligada. A
  -- tentativa guarda o id do provedor com o prefixo `suporte:`; o retorno da
  -- caixa do suporte não muda a tentativa nem o contato do Cliente, e o evento
  -- fecha sem novas tentativas nem o alerta de reprocessamento.
  IF v_provider_message_id IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.portal_email_attempts WHERE provider_message_id = 'suporte:' || v_provider_message_id)
    OR EXISTS (SELECT 1 FROM public.customer_communication_attempts WHERE provider_message_id = 'suporte:' || v_provider_message_id)
  ) THEN
    v_result := jsonb_build_object(
      'event_id', v_event.id,
      'status', 'processing',
      'processed', true,
      'ignored_redirected_to_support', true,
      'provider_message_id', v_provider_message_id
    );
    UPDATE public.portal_email_events
       SET processing_result = v_result,
           updated_at = now()
     WHERE id = v_event.id;
    RETURN v_result;
  END IF;

  IF v_provider_message_id IS NOT NULL THEN
    SELECT count(*) INTO v_portal_count
      FROM public.portal_email_attempts
     WHERE provider_message_id = v_provider_message_id;
    SELECT count(*) INTO v_communication_count
      FROM public.customer_communication_attempts
     WHERE provider_message_id = v_provider_message_id;
  END IF;

  IF v_portal_count + v_communication_count > 1 THEN
    v_retry_status := 'investigate';
    v_retry_at := NULL;
    UPDATE public.portal_email_events
       SET status = v_retry_status,
           process_after = v_retry_at,
           lease_until = NULL,
           leased_by = NULL,
           last_error_code = 'ambiguous_provider_message_id',
           last_error_message = 'Provider message id corresponde a mais de uma tentativa.',
           processing_result = jsonb_build_object(
             'event_id', v_event.id,
             'status', v_retry_status,
             'provider_message_id', v_provider_message_id
           ),
           updated_at = now()
     WHERE id = v_event.id;
    INSERT INTO public.portal_email_event_attempts (
      event_id, attempt_no, worker_id, status, error_code, error_message, result
    ) VALUES (
      v_event.id, v_event.attempt_count, v_worker_id, v_retry_status,
      'ambiguous_provider_message_id', 'Provider message id corresponde a mais de uma tentativa.',
      jsonb_build_object('provider_message_id', v_provider_message_id)
    );
    RETURN jsonb_build_object(
      'event_id', v_event.id,
      'status', v_retry_status,
      'provider_message_id', v_provider_message_id
    );
  END IF;

  -- Um evento já aplicado pode ser reprocessado após crash no efeito
  -- secundário. Mantemos a referência original e tornamos o bloco idempotente.
  v_portal_attempt_id := v_event.attempt_id;
  v_communication_attempt_id := v_event.communication_attempt_id;
  IF v_portal_attempt_id IS NULL AND v_communication_attempt_id IS NULL AND v_provider_message_id IS NOT NULL THEN
    IF v_portal_count = 1 THEN
      SELECT id, account_id, kind
        INTO v_portal_attempt_id, v_portal_account_id, v_portal_kind
        FROM public.portal_email_attempts
       WHERE provider_message_id = v_provider_message_id;
    ELSIF v_communication_count = 1 THEN
      SELECT a.id, a.communication_id
        INTO v_communication_attempt_id, v_communication_id
        FROM public.customer_communication_attempts a
       WHERE a.provider_message_id = v_provider_message_id;
    END IF;
  END IF;

  IF v_portal_attempt_id IS NOT NULL THEN
    SELECT account_id, kind, status
      INTO v_portal_account_id, v_portal_kind, v_attempt_status
      FROM public.portal_email_attempts
     WHERE id = v_portal_attempt_id;
    v_stale := EXISTS (
      SELECT 1 FROM public.portal_email_events older
       WHERE older.attempt_id = v_portal_attempt_id
         AND older.status = 'processed'
         AND older.received_at > v_event.received_at
    );
  ELSIF v_communication_attempt_id IS NOT NULL THEN
    SELECT communication_id, status
      INTO v_communication_id, v_attempt_status
      FROM public.customer_communication_attempts
     WHERE id = v_communication_attempt_id;
    v_stale := EXISTS (
      SELECT 1 FROM public.portal_email_events older
       WHERE older.communication_attempt_id = v_communication_attempt_id
         AND older.status = 'processed'
         AND older.received_at > v_event.received_at
    );
  END IF;

  IF v_portal_attempt_id IS NULL AND v_communication_attempt_id IS NULL THEN
    IF v_event.attempt_count >= 6 THEN
      v_retry_status := 'investigate';
      v_retry_at := NULL;
    ELSE
      v_retry_status := 'retry_wait';
      v_retry_at := now() + CASE v_event.attempt_count
        WHEN 1 THEN interval '1 minute'
        WHEN 2 THEN interval '5 minutes'
        WHEN 3 THEN interval '15 minutes'
        WHEN 4 THEN interval '60 minutes'
        ELSE interval '360 minutes'
      END;
    END IF;
    v_result := jsonb_build_object(
      'event_id', v_event.id,
      'status', v_retry_status,
      'provider_message_id', v_provider_message_id,
      'error_code', 'attempt_unresolved'
    );
    UPDATE public.portal_email_events
       SET status = v_retry_status,
           process_after = v_retry_at,
           lease_until = NULL,
           leased_by = NULL,
           last_error_code = 'attempt_unresolved',
           last_error_message = 'Tentativa ainda não possui provider_message_id vinculado.',
           processing_result = v_result,
           updated_at = now()
     WHERE id = v_event.id;
    INSERT INTO public.portal_email_event_attempts (
      event_id, attempt_no, worker_id, status, error_code, error_message, result
    ) VALUES (
      v_event.id, v_event.attempt_count, v_worker_id, v_retry_status,
      'attempt_unresolved', 'Tentativa ainda não possui provider_message_id vinculado.', v_result
    );
    IF v_retry_status = 'investigate' THEN
      PERFORM public.block521_upsert_alert(
        'portal_reprocessamento_falhou',
        'portal_email_event',
        v_event.id::text,
        'Evento de email recebido sem tentativa vinculada após o limite de retry; investigue no provedor.',
        'portal_email_events_runner',
        'documentacao',
        jsonb_build_object('event_id', v_event.id, 'provider_message_id', v_provider_message_id),
        '/clientes/portal'
      );
    END IF;
    RETURN v_result;
  END IF;

  v_next_status := CASE v_event_kind
    WHEN 'email.delivered' THEN 'entregue'
    WHEN 'email.bounced' THEN 'bounce'
    WHEN 'email.complained' THEN 'complaint'
  END;

  IF v_portal_attempt_id IS NOT NULL THEN
    IF NOT v_stale AND NOT (
      v_attempt_status IN ('bounce', 'complaint', 'falha_permanente')
      AND v_next_status <> v_attempt_status
    ) THEN
      UPDATE public.portal_email_attempts
         SET status = v_next_status,
             updated_at = now()
       WHERE id = v_portal_attempt_id;
    END IF;
    UPDATE public.portal_email_events
       SET attempt_id = v_portal_attempt_id,
           communication_attempt_id = NULL
     WHERE id = v_event.id;
  ELSE
    IF NOT v_stale AND NOT (
      v_attempt_status IN ('bounce', 'complaint', 'falha_permanente')
      AND v_next_status <> v_attempt_status
    ) THEN
      UPDATE public.customer_communication_attempts
         SET status = v_next_status,
             updated_at = now()
       WHERE id = v_communication_attempt_id;
    END IF;
    UPDATE public.portal_email_events
       SET communication_attempt_id = v_communication_attempt_id,
           attempt_id = NULL
     WHERE id = v_event.id;
  END IF;

  -- Fatos de supressão e saúde do endereço são internos e idempotentes. O
  -- aviso ao cliente e o reparo de caixas ficam para o runner após o commit.
  IF v_email IS NOT NULL AND v_permanent_bounce THEN
    INSERT INTO public.portal_suppressed_emails (email, reason, suppressed_at)
    VALUES (v_email, 'bounce_permanente', now())
    ON CONFLICT (email) DO UPDATE
      SET reason = 'bounce_permanente', suppressed_at = EXCLUDED.suppressed_at;
  ELSIF v_email IS NOT NULL AND v_event_kind = 'email.complained' AND v_portal_attempt_id IS NOT NULL THEN
    INSERT INTO public.portal_suppressed_emails (email, reason, suppressed_at)
    VALUES (v_email, 'complaint', now())
    ON CONFLICT (email) DO NOTHING;
  ELSIF v_email IS NOT NULL AND v_event_kind = 'email.complained' AND v_communication_attempt_id IS NOT NULL THEN
    INSERT INTO public.customer_communication_suppressions (email, reason, suppressed_at)
    VALUES (v_email, 'complaint', now())
    ON CONFLICT (email) DO NOTHING;
  END IF;

  IF v_portal_attempt_id IS NOT NULL
     AND v_portal_kind IS DISTINCT FROM 'contato_bounced_notificacao'
     AND (v_permanent_bounce OR v_event_kind = 'email.complained') THEN
    UPDATE public.customer_portal_accounts
       SET recovery_email_status = CASE WHEN v_event_kind = 'email.bounced' THEN 'bounce_permanente' ELSE 'complaint' END,
           account_situation = CASE WHEN account_situation = 'convite_pendente' THEN 'falha_no_envio' ELSE account_situation END
     -- A situação descreve o endereço: bounce de outro endereço (confirmação
     -- de troca, aviso ao antigo, convite superado) não marca a conta.
     WHERE (v_email IS NULL AND id = v_portal_account_id)
        OR (v_email IS NOT NULL AND lower(btrim(recovery_email)) = v_email);
  END IF;

  SELECT COALESCE(jsonb_agg(customer_id ORDER BY customer_id), '[]'::jsonb)
    INTO v_customer_ids
    FROM (
      SELECT DISTINCT a.customer_id
        FROM public.customer_portal_accounts a
       WHERE a.id = v_portal_account_id
      UNION
      SELECT DISTINCT a.customer_id
        FROM public.customer_portal_accounts a
       WHERE v_email IS NOT NULL AND lower(btrim(a.recovery_email)) = v_email
      UNION
      SELECT DISTINCT c.customer_id
        FROM public.customer_communications c
       WHERE c.id = v_communication_id
      UNION
      SELECT DISTINCT cc.customer_id
        FROM public.customer_contacts cc
       WHERE v_email IS NOT NULL AND cc.email_normalized = v_email
    ) customers;

  IF v_permanent_bounce
     AND v_portal_kind IS DISTINCT FROM 'contato_bounced_notificacao' THEN
    -- O reparo de caixas é escrita de domínio, não efeito HTTP. Executá-lo
    -- aqui mantém supressão, conta e fallback na mesma transação do evento.
    FOR v_customer_id IN
      SELECT value::bigint FROM jsonb_array_elements_text(v_customer_ids)
    LOOP
      PERFORM public.repair_customer_contact_box_fallbacks(v_customer_id);
    END LOOP;
  END IF;

  IF v_portal_attempt_id IS NOT NULL
     AND v_portal_kind IS DISTINCT FROM 'contato_bounced_notificacao'
     AND (v_permanent_bounce OR v_event_kind = 'email.complained') THEN
    FOR v_customer_id IN
      SELECT DISTINCT a.customer_id
        FROM public.customer_portal_accounts a
       WHERE (v_email IS NULL AND a.id = v_portal_account_id)
          OR (v_email IS NOT NULL AND lower(btrim(a.recovery_email)) = v_email)
    LOOP
      PERFORM public.block521_upsert_alert(
        'portal_email_suprimido',
        'customer',
        v_customer_id::text,
        'Email de Recuperação indisponível. Informe ou valide outro endereço.',
        'portal_email_events_runner',
        'documentacao',
        jsonb_build_object('customer_id', v_customer_id, 'email', v_email),
        '/clientes/portal?cliente=' || v_customer_id
      );
    END LOOP;
  END IF;

  v_result := jsonb_build_object(
    'event_id', v_event.id,
    'status', 'processing',
    'processed', true,
    'provider_message_id', v_provider_message_id,
    'email', v_email,
    'event_type', v_event_kind,
    'portal_attempt_id', v_portal_attempt_id,
    'communication_attempt_id', v_communication_attempt_id,
    'permanent_bounce', v_permanent_bounce,
    'portal_recovery_attempt', v_portal_attempt_id IS NOT NULL AND v_portal_kind IS DISTINCT FROM 'contato_bounced_notificacao',
    'should_cascade', v_permanent_bounce AND v_portal_kind IS DISTINCT FROM 'contato_bounced_notificacao',
    'customer_ids', v_customer_ids,
    'stale_transition_ignored', v_stale
  );

  UPDATE public.portal_email_events
     SET processing_result = v_result,
         updated_at = now()
   WHERE id = v_event.id;

  INSERT INTO public.portal_email_event_attempts (
    event_id, attempt_no, worker_id, status, result
  ) VALUES (v_event.id, v_event.attempt_count, v_worker_id, 'processing', v_result);

  RETURN v_result;
END;
$function$;

-- 9 --- Dados: a conta do dono recebe a marca ----------------------------------
-- Idempotente. Para dar ou tirar a marca depois, outra migration com a lista.
DO $dev_466$
DECLARE
  v_marked integer;
BEGIN
  PERFORM set_config('vela.access_change_reason', 'Marca Dev dada pela migration 466 (ADR 0104).', true);

  UPDATE public.user_profiles p
     SET is_dev = true
    FROM auth.users u
   WHERE u.id = p.id
     AND lower(btrim(u.email)) IN ('lucca.juliatti@fwlog.com.br')
     AND p.is_dev = false;
  GET DIAGNOSTICS v_marked = ROW_COUNT;

  IF NOT EXISTS (
    SELECT 1 FROM public.user_profiles p JOIN auth.users u ON u.id = p.id
     WHERE lower(btrim(u.email)) IN ('lucca.juliatti@fwlog.com.br')
  ) THEN
    RAISE NOTICE '466: nenhuma conta com e-mail da lista Dev neste ambiente; marca não atribuída.';
  ELSE
    RAISE NOTICE '466: % conta(s) marcada(s) como Dev.', v_marked;
  END IF;

  PERFORM set_config('vela.access_change_reason', '', true);
END;
$dev_466$;
