-- 419: o access token interno emitido antes da revogação deixa de valer
-- (auditoria de segurança run-3, achado C1; ADR 0099).
--
-- Problema: `internal_revoke_sessions` (106) apaga sessões e refresh tokens,
-- mas não grava o instante da revogação. Os helpers de papel (002) decidem só
-- por `user_profiles(active, role)`, e o PostgREST aceita qualquer JWT
-- assinado e não expirado. Depois de Editar acesso trocar e-mail ou senha, ou
-- de Desativar, o access token já emitido seguia com a autoridade do
-- Departamento até expirar (até 1 hora). O Portal já fecha isso com
-- `credentials_revoked_at` (069, 092, 132).
--
-- Mudança:
--   1. `internal_revoke_sessions` grava o marco em
--      `internal_credential_revocations`, tabela sem grant para os clientes.
--      Numa coluna de `user_profiles` o próprio token antigo apagaria o marco
--      pela política de autoedição.
--   2. `_internal_token_current()`: o token do próprio usuário (claim `sub`
--      igual a `auth.uid()`) precisa ter `iat` igual ou posterior ao marco,
--      como no Portal. Rotina de serviço que age em nome do usuário (troca
--      `request.jwt.claim.sub` e carrega outro JWT, 385/386/394) não é cortada:
--      a ação foi autorizada antes, e quem não está mais ativo continua
--      recusado pelo `active`.
--   3. Os seis helpers de papel e `ce_unlock_private.actor` exigem o token
--      vigente; as seis políticas que liam `user_profiles` direto passam a
--      usar os helpers, com as mesmas condições.
--   4. `check_internal_token_cutoff()` roda antes de toda requisição do
--      PostgREST (`pgrst.db_pre_request`) e cobre as RPCs que ainda leem
--      `user_profiles` no corpo. É a única função executável por `anon`
--      (ADR 0099, exceção à ADR 0090): sem sessão, não faz nada.
--
-- Não altera nem apaga linhas existentes.
-- Rollback: `ALTER ROLE authenticator RESET pgrst.db_pre_request` e
-- `NOTIFY pgrst, 'reload config'`; recriar os helpers, `ce_unlock_private.actor`
-- e as seis políticas pelas definições da 002 e da 250; a tabela pode ficar.

-- 1. Marco da revogação -------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.internal_credential_revocations (
  user_id uuid PRIMARY KEY REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  revoked_at timestamptz NOT NULL
);
ALTER TABLE public.internal_credential_revocations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.internal_credential_revocations FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.internal_credential_revocations TO service_role;

CREATE OR REPLACE FUNCTION public.internal_revoke_sessions(p_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- Lock antes de apagar e marco depois, como em portal_revoke_sessions (132):
  -- token renovado durante a espera fica anterior ao corte.
  PERFORM 1 FROM public.user_profiles WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Usuário interno não encontrado.' USING ERRCODE = 'P0002';
  END IF;
  DELETE FROM auth.refresh_tokens WHERE user_id = p_user_id::text;
  DELETE FROM auth.sessions WHERE user_id = p_user_id;
  INSERT INTO public.internal_credential_revocations (user_id, revoked_at)
  VALUES (p_user_id, clock_timestamp())
  ON CONFLICT (user_id) DO UPDATE
    SET revoked_at = GREATEST(internal_credential_revocations.revoked_at, EXCLUDED.revoked_at);
END;
$function$;
REVOKE ALL ON FUNCTION public.internal_revoke_sessions(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.internal_revoke_sessions(uuid) TO service_role;

-- 2. Token vigente --------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._internal_token_current()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT NOT EXISTS (
    SELECT 1
    FROM public.internal_credential_revocations AS r
    WHERE r.user_id = auth.uid()
      AND auth.jwt() ->> 'sub' = auth.uid()::text
      -- Sem `iat` numérico não há como provar emissão posterior ao marco.
      AND NOT COALESCE(
        CASE WHEN auth.jwt() ->> 'iat' ~ '^[0-9]+(\.[0-9]+)?$'
          THEN to_timestamp((auth.jwt() ->> 'iat')::double precision) >= r.revoked_at
        END,
        false)
  );
$function$;
REVOKE ALL ON FUNCTION public._internal_token_current() FROM PUBLIC, anon, authenticated;

-- 3. Helpers de papel (corpos da 002) com o corte -------------------------------
CREATE OR REPLACE FUNCTION public.is_active_user()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = auth.uid() AND active = true
  ) AND public._internal_token_current();
$function$;

CREATE OR REPLACE FUNCTION public.is_active_read_user()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = auth.uid() AND active = true
  ) AND public._internal_token_current();
$function$;

CREATE OR REPLACE FUNCTION public.is_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_profiles
    WHERE id = auth.uid()
      AND role IN ('admin', 'administrativo')
      AND active = true
  ) AND public._internal_token_current();
$function$;

CREATE OR REPLACE FUNCTION public.is_financeiro_user()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_profiles
    WHERE id = auth.uid()
      AND active = true
      AND role IN ('admin', 'administrativo', 'financeiro')
  ) AND public._internal_token_current();
$function$;

CREATE OR REPLACE FUNCTION public._portal_actor_role()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE up.role WHEN 'admin' THEN 'administrativo' WHEN 'operator' THEN 'documentacao' ELSE up.role END
  FROM public.user_profiles up
  WHERE up.id = auth.uid() AND up.active = true AND public._internal_token_current();
$function$;

CREATE OR REPLACE FUNCTION public.current_actor_role()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE
    WHEN auth.role() = 'service_role' THEN 'sistema'
    ELSE (
      SELECT CASE up.role
        WHEN 'admin' THEN 'administrativo'
        WHEN 'operator' THEN 'documentacao'
        ELSE up.role
      END
      FROM public.user_profiles AS up
      WHERE up.id = auth.uid() AND up.active = true AND public._internal_token_current()
    )
  END;
$function$;

-- Corpo da 250 com o corte.
CREATE OR REPLACE FUNCTION ce_unlock_private.actor(p_manage boolean DEFAULT false)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE r text; BEGIN
 SELECT CASE role WHEN 'operator' THEN 'documentacao' ELSE role END INTO r FROM public.user_profiles
  WHERE id=auth.uid() AND active AND public._internal_token_current();
 IF r IS NULL OR (p_manage AND r NOT IN('administrativo','documentacao')) OR (NOT p_manage AND r NOT IN('administrativo','documentacao','financeiro','operacoes','equipamentos')) THEN
 RAISE EXCEPTION '42501: Acesso negado ao desbloqueio de CE.' USING ERRCODE='42501'; END IF;
 RETURN r;
END $function$;

-- Políticas que liam `user_profiles` direto (002): mesmas condições pelos
-- helpers, que mapeiam `admin` e `operator` como a lista antiga aceitava.
ALTER POLICY portal_events_internal_read ON public.portal_provisioning_events
  USING ((SELECT public.is_active_read_user()));
ALTER POLICY portal_suppressed_internal_read ON public.portal_suppressed_emails
  USING ((SELECT public.is_active_read_user()));
ALTER POLICY portal_email_attempts_internal_read ON public.portal_email_attempts
  USING ((SELECT public.is_active_read_user()));
ALTER POLICY portal_invites_internal_read ON public.portal_invites
  USING ((SELECT public.is_active_read_user()));
ALTER POLICY app_settings_communications_read ON public.app_settings
  USING ((SELECT public.current_actor_role()) IN ('administrativo', 'documentacao', 'equipamentos'));
ALTER POLICY customer_contact_preferences_edit ON public.customer_contact_preferences
  USING ((SELECT public.current_actor_role()) IN ('administrativo', 'documentacao', 'equipamentos'))
  WITH CHECK ((SELECT public.current_actor_role()) IN ('administrativo', 'documentacao', 'equipamentos')
    AND source = 'interno');

-- 4. Corte antes de toda requisição do PostgREST --------------------------------
CREATE OR REPLACE FUNCTION public.check_internal_token_cutoff()
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_current boolean;
BEGIN
  BEGIN
    v_current := public._internal_token_current();
  EXCEPTION WHEN invalid_text_representation THEN
    -- `sub` que não é uuid não é sessão do GoTrue; quem decide é o resto.
    RETURN;
  END;
  IF NOT v_current THEN
    RAISE EXCEPTION 'Sessão encerrada: entre de novo.' USING ERRCODE = '28000';
  END IF;
END;
$function$;
REVOKE ALL ON FUNCTION public.check_internal_token_cutoff() FROM PUBLIC;
-- O PostgREST chama com o papel da requisição; `anon` só passa direto.
GRANT EXECUTE ON FUNCTION public.check_internal_token_cutoff() TO anon, authenticated, service_role;

DO $pre_request_407$
BEGIN
  -- O replay local (scripts/setup-local-pg.sh) não tem o papel do PostgREST.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticator') THEN
    ALTER ROLE authenticator SET pgrst.db_pre_request = 'public.check_internal_token_cutoff';
    NOTIFY pgrst, 'reload config';
  END IF;
END;
$pre_request_407$;
