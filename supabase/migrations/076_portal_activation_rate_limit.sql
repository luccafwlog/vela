-- Migration 076: mantém ativação de convite limitada quando o Redis está
-- ausente ou indisponível. O balde tem a mesma chave canônica de CNPJ da
-- defesa atual, mas uma origem própria para não gastar tentativas de login.

ALTER TABLE public.portal_login_attempts
  DROP CONSTRAINT IF EXISTS portal_login_attempts_source_check;

ALTER TABLE public.portal_login_attempts
  ADD CONSTRAINT portal_login_attempts_source_check
  CHECK (source = ANY (ARRAY['login'::text, 'recovery'::text, 'activation'::text]));

CREATE OR REPLACE FUNCTION public.portal_activation_check_rate_limit(p_login text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE v_hash TEXT; v_count INTEGER;
BEGIN
  v_hash := encode(extensions.digest(coalesce(public.normalize_cnpj(coalesce(p_login,'')),''),'sha256'),'hex');
  SELECT count(*) INTO v_count
    FROM public.portal_login_attempts
   WHERE cnpj_hash = v_hash
     AND attempted_at > now() - interval '5 minutes'
     AND succeeded = false
     AND source = 'activation';
  RETURN coalesce(v_count, 0) >= 10;
END; $$;

CREATE OR REPLACE FUNCTION public.portal_activation_register_failure(p_login text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  INSERT INTO public.portal_login_attempts(cnpj_hash, succeeded, source)
  VALUES (
    encode(extensions.digest(coalesce(public.normalize_cnpj(coalesce(p_login,'')),''),'sha256'),'hex'),
    false,
    'activation'
  );
END; $$;

REVOKE ALL ON FUNCTION public.portal_activation_check_rate_limit(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.portal_activation_register_failure(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_activation_check_rate_limit(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.portal_activation_register_failure(text) TO service_role;
