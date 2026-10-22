-- 413: o balde de login do Portal reserva a tentativa de forma atômica
-- (auditoria de segurança run-3, pendência P3; ADR 0049).
--
-- Problema: `portal-login` e a verificação da senha atual em
-- `portal-recovery-email-change` consultavam o balde (`portal_login_check_rate_limit`,
-- só `count(*)`) e só registravam a falha depois de o GoTrue conferir a senha.
-- Pedidos em paralelo para o mesmo CNPJ passavam todos pela consulta antes de
-- qualquer falha ser gravada: o limite de 5 erros em 15 minutos valia só para
-- tentativas em série.
--
-- Mudança: `portal_login_reserve_attempt` trava o hash do CNPJ
-- (`pg_advisory_xact_lock`), conta as falhas da janela e, abaixo do limite, já
-- grava a tentativa como falha antes de a senha ser conferida; no limite,
-- devolve NULL. `portal_login_settle_attempt` marca a reserva como sucesso
-- quando a senha confere, ou a apaga quando a conferência não aconteceu (falha
-- do Auth). Senha errada mantém a reserva como falha. Só `service_role` executa.
-- `portal_login_check_rate_limit` e `portal_login_register_*` ficam no catálogo,
-- sem chamador.
--
-- Só cria funções; não reescreve nem apaga linhas.
-- Rollback: voltar as Edge Functions para isLoginRateLimited/registerLogin*.

CREATE OR REPLACE FUNCTION public.portal_login_reserve_attempt(p_login text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_hash text;
  v_count integer;
  v_id bigint;
BEGIN
  v_hash := encode(extensions.digest(coalesce(public.normalize_cnpj(coalesce(p_login, '')), ''), 'sha256'), 'hex');
  -- Serializa as reservas do mesmo CNPJ: a contagem e a gravação andam juntas.
  PERFORM pg_advisory_xact_lock(hashtextextended('portal_login:' || v_hash, 0));
  SELECT count(*) INTO v_count FROM public.portal_login_attempts
  WHERE cnpj_hash = v_hash AND attempted_at > now() - interval '15 minutes'
    AND succeeded = false AND source = 'login';
  IF coalesce(v_count, 0) >= 5 THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.portal_login_attempts (cnpj_hash, succeeded, source)
  VALUES (v_hash, false, 'login')
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.portal_login_reserve_attempt(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_login_reserve_attempt(text) TO service_role;

CREATE OR REPLACE FUNCTION public.portal_login_settle_attempt(p_attempt_id bigint, p_outcome text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF p_outcome = 'success' THEN
    UPDATE public.portal_login_attempts SET succeeded = true
    WHERE id = p_attempt_id AND source = 'login';
  ELSIF p_outcome = 'void' THEN
    -- A senha não chegou a ser conferida (falha do Auth): não cobra o Cliente.
    DELETE FROM public.portal_login_attempts
    WHERE id = p_attempt_id AND source = 'login' AND succeeded = false;
  ELSE
    RAISE EXCEPTION 'Resultado de tentativa inválido: %', p_outcome USING ERRCODE = '22023';
  END IF;
END;
$function$;
REVOKE ALL ON FUNCTION public.portal_login_settle_attempt(bigint, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_login_settle_attempt(bigint, text) TO service_role;
