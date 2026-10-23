-- 440: conta de integração (API ITAÚ) separada das pessoas.
--
-- A conta "API ITAÚ" (app_settings.itau_pix_settlement_actor, migration 152)
-- é técnica: a baixa automática do Pix entra no banco como ela
-- (itau_pix_settle_core_425) e o id dela fica em "Registrado por". O e-mail
-- não é uma caixa real. Por ter papel Administrativo e nada que a separasse
-- das pessoas, ela:
--   - recebia o Resumo diário interno (portal-daily-digest); o provedor
--     recusa o endereço (HTTP 422 all_recipients_suppressed), a rodada
--     contava falha e o heartbeat do BetterStack ficava vermelho (23/10);
--   - recebia os avisos do sino do Administrativo (fanout_alert_item e
--     fanout_alert_item_for_department, definição vigente da 328);
--   - contava como "último Administrativo ativo" (gatilho da 239), o que
--     deixava a última pessoa Administrativa ser rebaixada ou desativada;
--   - tinha mais privilégio do que a baixa precisa.
--
-- Mudança:
--   1. `user_profiles.account_kind` ('pessoa' | 'integracao', padrão
--      'pessoa'). Ninguém muda pelo navegador: INSERT e UPDATE de
--      `authenticated` passam a ser por coluna, sem `account_kind`, como a 436
--      fez em `customers` (o GRANT era da tabela inteira). Só migration ou
--      service_role marcam uma conta.
--   2. O histórico de acesso (audit_user_profile_changes) registra também a
--      troca de `account_kind` e grava o motivo informado em
--      `vela.access_change_reason`, quando houver.
--   3. "Último Administrativo ativo" conta só pessoas; mudar a conta de
--      integração não esbarra no gatilho, e marcar a última pessoa
--      Administrativa como integração é recusado.
--   4. O sino não entrega aviso a conta de integração, nem no fallback
--      crítico do Administrativo.
--   5. `admin_list_users` devolve `account_kind` (badge "Integração").
--   6. Dados: a conta de `itau_pix_settlement_actor` vira 'integracao', o
--      e-mail dela entra em `portal_suppressed_emails` (bounce_permanente) e o
--      papel passa de Administrativo para Financeiro, com o motivo no
--      Histórico de ações. A baixa automática só exige Financeiro: as funções
--      que ela chama (register_verified_invoice_payment,
--      register_ledger_invoice_payment, reconcile_invoice_payment_by_txid e as
--      internas) checam is_financeiro_user(), que aceita Financeiro e
--      Administrativo; register_demurrage_payment aceita o service_role da
--      Edge Function. Nenhuma exige is_admin() ou o papel Administrativo.
--      Se a conta for o único Administrativo ativo do ambiente, só o e-mail é
--      suprimido (aviso no log): marcá-la deixaria ninguém para administrar.
--
-- O Resumo diário tira a conta de integração na Edge Function
-- portal-daily-digest, que lê `account_kind`: publicada antes desta migration,
-- a consulta falha (500) até a migration chegar. O alerta de e-mail devolvido
-- já ignorava a conta da baixa pelo id (319).
--
-- Data status: a seção 6 reescreve linhas de `user_profiles` (account_kind e
-- role da conta de integração) e insere em `portal_suppressed_emails`. Depende
-- da afirmação "Data status" do AGENTS.md (2026-09-18): a produção não tem
-- dados reais de negócio, e esta é uma conta técnica.
--
-- Rollback: reaplicar as definições de admin_list_users (309),
-- guard_last_active_administrativo (239), audit_user_profile_changes (002) e
-- fanout_alert_item/fanout_alert_item_for_department (328) com os gatilhos de
-- antes; `GRANT INSERT, UPDATE ON public.user_profiles TO authenticated`;
-- devolver o papel `administrativo` à conta pela tela Usuários; e
-- `ALTER TABLE public.user_profiles DROP COLUMN account_kind`.

-- 1 --- Tipo de conta -------------------------------------------------------
ALTER TABLE public.user_profiles
  ADD COLUMN account_kind text NOT NULL DEFAULT 'pessoa'
  CONSTRAINT user_profiles_account_kind_check CHECK (account_kind IN ('pessoa', 'integracao'));

COMMENT ON COLUMN public.user_profiles.account_kind IS
  'pessoa: usuário interno de verdade. integracao: conta técnica (ex.: API ITAÚ da baixa automática do Pix), fora de e-mails, avisos e da contagem de último Administrativo ativo. Só migration ou service_role alteram.';

-- O GRANT era da tabela inteira: tirar só a coluna não fecharia nada. Coluna
-- nova de `user_profiles` nasce sem INSERT/UPDATE direto até alguém concedê-la.
DO $columns_440$
DECLARE v_columns text;
BEGIN
  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position) INTO v_columns
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'user_profiles' AND column_name <> 'account_kind';
  EXECUTE 'REVOKE INSERT, UPDATE ON public.user_profiles FROM authenticated';
  EXECUTE format('GRANT INSERT (%1$s), UPDATE (%1$s) ON public.user_profiles TO authenticated', v_columns);
END;
$columns_440$;

-- 2 --- Histórico de acesso -------------------------------------------------
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

  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.audit_user_profile_changes() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_audit_user_profile_changes ON public.user_profiles;
CREATE TRIGGER trg_audit_user_profile_changes
  AFTER UPDATE OF role, active, account_kind ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION public.audit_user_profile_changes();

-- 3 --- Último Administrativo ativo conta só pessoas -------------------------
CREATE OR REPLACE FUNCTION public.guard_last_active_administrativo()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- Conta de integração não administra ninguém: mudá-la não tira a última
  -- pessoa Administrativa, e ela não conta como a que sobra (440).
  IF OLD.role = 'administrativo' AND OLD.active AND OLD.account_kind = 'pessoa'
     AND (NEW.role IS DISTINCT FROM 'administrativo' OR NEW.active IS NOT TRUE
          OR NEW.account_kind IS DISTINCT FROM 'pessoa') THEN
    -- ponytail: lock global de transação para mudanças em Administrativos;
    -- são raras, então serializar todas é barato e evita a corrida entre duas
    -- sessões que rebaixam os dois últimos ao mesmo tempo.
    PERFORM pg_advisory_xact_lock(hashtext('vela.last_active_administrativo'));
    IF NOT EXISTS (
      SELECT 1 FROM public.user_profiles AS p
      WHERE p.id <> OLD.id AND p.role = 'administrativo' AND p.active
        AND p.account_kind <> 'integracao'
    ) THEN
      RAISE EXCEPTION '% é o último usuário Administrativo ativo. Antes de mudar o setor ou desativar, ative ou cadastre outro usuário Administrativo.',
        COALESCE(NULLIF(btrim(OLD.full_name), ''), 'Este usuário')
        USING ERRCODE = '22023';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.guard_last_active_administrativo() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS guard_last_active_administrativo ON public.user_profiles;
CREATE TRIGGER guard_last_active_administrativo
  BEFORE UPDATE OF role, active, account_kind ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_last_active_administrativo();

-- 4 --- Sino: conta de integração não recebe aviso ---------------------------
-- Definição vigente (328) com o filtro de `account_kind` nos dois laços.
CREATE OR REPLACE FUNCTION public.fanout_alert_item(p_alert_id bigint, p_item_id bigint, p_event_id bigint)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_item public.alert_items%ROWTYPE;
  v_alert public.alerts%ROWTYPE;
  v_catalog public.alert_type_catalog%ROWTYPE;
  v_user RECORD;
  v_count INTEGER := 0;
  v_fallback BOOLEAN := false;
BEGIN
  SELECT * INTO v_item FROM public.alert_items WHERE id = p_item_id;
  SELECT * INTO v_alert FROM public.alerts WHERE id = p_alert_id;
  SELECT * INTO v_catalog FROM public.alert_type_catalog WHERE type = v_item.item_type;

  -- O papel legado `operator` é Documentação, como no resto do sistema (328).
  -- Conta de integração não é pessoa e não recebe aviso (440).
  FOR v_user IN
    SELECT up.id, CASE up.role WHEN 'operator' THEN 'documentacao' ELSE up.role END AS department
    FROM public.user_profiles up
    WHERE up.active = true
      AND up.account_kind <> 'integracao'
      AND (CASE up.role WHEN 'operator' THEN 'documentacao' ELSE up.role END) = ANY(v_catalog.audience_departments)
  LOOP
    INSERT INTO public.internal_notifications (
      alert_id, alert_item_id, event_id, recipient_id, recipient_department,
      is_fallback, item_type, severity, title, message, entity_type, entity_id,
      destination, payload
    )
    VALUES (
      p_alert_id, p_item_id, p_event_id, v_user.id, v_user.department,
      false, v_item.item_type, v_item.severity, 'Nova pendência operacional',
      v_item.message, v_alert.entity_type, v_alert.entity_id, v_item.destination,
      v_item.metadata
    )
    ON CONFLICT (event_id, recipient_id) DO NOTHING;
    v_count := v_count + 1;
  END LOOP;

  IF v_count = 0 AND v_item.severity = 'critical' THEN
    v_fallback := true;
    FOR v_user IN
      SELECT up.id, up.role AS department
      FROM public.user_profiles up
      WHERE up.active = true AND up.role = 'administrativo'
        AND up.account_kind <> 'integracao'
    LOOP
      INSERT INTO public.internal_notifications (
        alert_id, alert_item_id, event_id, recipient_id, recipient_department,
        is_fallback, item_type, severity, title, message, entity_type, entity_id,
        destination, payload
      )
      VALUES (
        p_alert_id, p_item_id, p_event_id, v_user.id, v_user.department,
        true, v_item.item_type, v_item.severity, 'Nova pendência operacional',
        v_item.message, v_alert.entity_type, v_alert.entity_id, v_item.destination,
        jsonb_build_object('fallback_for', v_item.department) || v_item.metadata
      )
      ON CONFLICT (event_id, recipient_id) DO NOTHING;
      v_count := v_count + 1;
    END LOOP;
  END IF;

  IF v_count = 0 THEN
    INSERT INTO public.alert_notification_failures (
      alert_id, alert_item_id, event_id, item_type, department, reason
    )
    VALUES (
      p_alert_id, p_item_id, p_event_id, v_item.item_type,
      COALESCE(v_item.department, v_catalog.responsible_department),
      CASE WHEN v_fallback THEN 'Nenhum destinatário ativo no fallback Administrativo.'
           ELSE 'Nenhum destinatário ativo na audiência do item.' END
    );
  END IF;

  RETURN v_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fanout_alert_item_for_department(p_alert_id bigint, p_item_id bigint, p_event_id bigint, p_department text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_item public.alert_items%ROWTYPE;
  v_alert public.alerts%ROWTYPE;
  v_catalog public.alert_type_catalog%ROWTYPE;
  v_user RECORD;
  v_audience TEXT[];
  v_count INTEGER := 0;
  v_fallback BOOLEAN := false;
BEGIN
  SELECT * INTO v_item FROM public.alert_items WHERE id = p_item_id;
  SELECT * INTO v_alert FROM public.alerts WHERE id = p_alert_id;
  SELECT * INTO v_catalog FROM public.alert_type_catalog WHERE type = v_item.item_type;

  SELECT COALESCE(array_agg(DISTINCT department ORDER BY department), '{}'::TEXT[])
  INTO v_audience
  FROM unnest(
    COALESCE(v_catalog.audience_departments, '{}'::TEXT[])
    || CASE WHEN NULLIF(btrim(p_department), '') IS NULL THEN '{}'::TEXT[]
            ELSE ARRAY[NULLIF(btrim(p_department), '')] END
  ) AS departments(department)
  WHERE department IS NOT NULL;

  -- O papel legado `operator` é Documentação, como no resto do sistema (328).
  -- Conta de integração não é pessoa e não recebe aviso (440).
  FOR v_user IN
    SELECT up.id, CASE up.role WHEN 'operator' THEN 'documentacao' ELSE up.role END AS department
    FROM public.user_profiles up
    WHERE up.active = true
      AND up.account_kind <> 'integracao'
      AND (CASE up.role WHEN 'operator' THEN 'documentacao' ELSE up.role END) = ANY(v_audience)
  LOOP
    INSERT INTO public.internal_notifications (
      alert_id, alert_item_id, event_id, recipient_id, recipient_department,
      is_fallback, item_type, severity, title, message, entity_type, entity_id,
      destination, payload
    )
    VALUES (
      p_alert_id, p_item_id, p_event_id, v_user.id, v_user.department,
      false, v_item.item_type, v_item.severity, 'Nova pendência operacional',
      v_item.message, v_alert.entity_type, v_alert.entity_id, v_item.destination,
      v_item.metadata
    )
    ON CONFLICT (event_id, recipient_id) DO NOTHING;
    v_count := v_count + 1;
  END LOOP;

  IF v_count = 0 AND v_item.severity = 'critical' THEN
    v_fallback := true;
    FOR v_user IN
      SELECT up.id, up.role AS department
      FROM public.user_profiles up
      WHERE up.active = true AND up.role = 'administrativo'
        AND up.account_kind <> 'integracao'
    LOOP
      INSERT INTO public.internal_notifications (
        alert_id, alert_item_id, event_id, recipient_id, recipient_department,
        is_fallback, item_type, severity, title, message, entity_type, entity_id,
        destination, payload
      )
      VALUES (
        p_alert_id, p_item_id, p_event_id, v_user.id, v_user.department,
        true, v_item.item_type, v_item.severity, 'Nova pendência operacional',
        v_item.message, v_alert.entity_type, v_alert.entity_id, v_item.destination,
        jsonb_build_object('fallback_for', COALESCE(NULLIF(btrim(p_department), ''), v_catalog.responsible_department)) || v_item.metadata
      )
      ON CONFLICT (event_id, recipient_id) DO NOTHING;
      v_count := v_count + 1;
    END LOOP;
  END IF;

  IF v_count = 0 THEN
    INSERT INTO public.alert_notification_failures (
      alert_id, alert_item_id, event_id, item_type, department, reason
    )
    VALUES (
      p_alert_id, p_item_id, p_event_id, v_item.item_type,
      COALESCE(NULLIF(btrim(p_department), ''), v_catalog.responsible_department, 'desconhecido'),
      CASE WHEN v_fallback THEN 'Nenhum destinatário ativo no fallback Administrativo.'
           ELSE 'Nenhum destinatário ativo na audiência do item.' END
    );
  END IF;

  RETURN v_count;
END;
$function$;

-- As duas seguem fora do alcance do navegador, como na 328.
REVOKE ALL ON FUNCTION public.fanout_alert_item(bigint, bigint, bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fanout_alert_item_for_department(bigint, bigint, bigint, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fanout_alert_item(bigint, bigint, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.fanout_alert_item_for_department(bigint, bigint, bigint, text) TO service_role;

-- 5 --- Lista de usuários devolve o tipo de conta ----------------------------
-- Definição vigente (309) com `account_kind`; o tipo de retorno muda.
DROP FUNCTION IF EXISTS public.admin_list_users();
CREATE FUNCTION public.admin_list_users()
 RETURNS TABLE(id uuid, full_name text, role text, active boolean, created_at timestamp with time zone, email text, last_sign_in_at timestamp with time zone, email_bounced boolean, account_kind text)
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
      p.account_kind
    FROM public.user_profiles p
    LEFT JOIN auth.users u ON u.id = p.id
    ORDER BY p.full_name;
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_list_users() FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_list_users() TO authenticated;

-- 6 --- Dados: a conta da baixa automática Itaú ------------------------------
-- Idempotente: rodar de novo não duplica supressão nem histórico.
DO $integracao_440$
DECLARE
  v_actor uuid;
BEGIN
  SELECT s.itau_pix_settlement_actor INTO v_actor FROM public.app_settings s WHERE s.id = 1;
  IF v_actor IS NULL THEN
    RAISE NOTICE '440: app_settings.itau_pix_settlement_actor vazio; nenhuma conta marcada como integração.';
    RETURN;
  END IF;

  -- O endereço não é uma caixa real: suprimido, o envio nem chega ao provedor.
  INSERT INTO public.portal_suppressed_emails (email, reason)
  SELECT lower(btrim(u.email)), 'bounce_permanente'
    FROM auth.users u
   WHERE u.id = v_actor AND NULLIF(btrim(u.email), '') IS NOT NULL
  ON CONFLICT (email) DO NOTHING;

  -- Ambiente em que a conta da baixa é o único Administrativo ativo: marcá-la
  -- deixaria ninguém para administrar (a seção 3 recusaria). Fica só a
  -- supressão; a marcação espera uma pessoa Administrativa ativa.
  IF EXISTS (SELECT 1 FROM public.user_profiles p
              WHERE p.id = v_actor AND p.role = 'administrativo' AND p.active AND p.account_kind = 'pessoa')
     AND NOT EXISTS (SELECT 1 FROM public.user_profiles p
              WHERE p.id <> v_actor AND p.role = 'administrativo' AND p.active AND p.account_kind <> 'integracao') THEN
    RAISE NOTICE '440: a conta da baixa automática é o único Administrativo ativo; e-mail suprimido, tipo e papel mantidos.';
    RETURN;
  END IF;

  PERFORM set_config('vela.access_change_reason',
    'Conta técnica da baixa automática do Pix (migration 440): marcada como integração e Financeiro, o papel que a baixa exige.', true);

  UPDATE public.user_profiles SET account_kind = 'integracao'
   WHERE id = v_actor AND account_kind IS DISTINCT FROM 'integracao';

  UPDATE public.user_profiles SET role = 'financeiro'
   WHERE id = v_actor AND role = 'administrativo';

  PERFORM set_config('vela.access_change_reason', '', true);
END;
$integracao_440$;
