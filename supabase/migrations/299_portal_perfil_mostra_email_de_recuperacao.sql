-- 299: o Perfil do Portal mostra ao Cliente o e-mail de recuperação atual
-- (lote 4 da identidade visual, aprovado em 2026-10-18).
--
-- Problema: o bloco "E-mail de recuperação" do Perfil mostra o e-mail atual
-- como dado, mas `portal_get_profile` (002) só devolvia `contact_email`, que
-- não acompanha a troca feita pela Edge Function
-- `portal-recovery-email-change`.
--
-- Mudança: só a sessão do próprio Cliente (`portal_get_profile`) ganha
-- `recovery_email`, lido da conta do Portal. O núcleo
-- `_portal_get_profile_core` e o invólucro do Modo Inspeção
-- (`portal_inspect_get_profile`) não mudam: no Vela, o e-mail de recuperação
-- é restrito a alguns perfis (`RECOVERY_EMAIL_READER_ROLES`), e a inspeção
-- aberta a qualquer usuário interno ativo não pode contorná-lo.
--
-- Só redefine uma função; não reescreve nem apaga linhas. Grants preservados
-- por CREATE OR REPLACE.
-- Rollback: reaplicar `portal_get_profile` da migration 002.

CREATE OR REPLACE FUNCTION public.portal_get_profile() RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_customer_id bigint := public.current_portal_customer_id();
BEGIN
  RETURN public._portal_get_profile_core(v_customer_id)
    || jsonb_build_object('recovery_email', (
      SELECT a.recovery_email
      FROM public.customer_portal_accounts AS a
      WHERE a.customer_id = v_customer_id
      LIMIT 1
    ));
END;
$$;
