-- Fecha a janela residual do reset de senha do Portal.
--
-- O GoTrue remove refresh tokens/sessões, mas access tokens permanecem válidos
-- até expirar. O marco local precisa, portanto, recusar qualquer JWT emitido
-- antes da revogação final. A antiga folga de cinco segundos permitia que uma
-- autenticação concorrente com a senha antiga sobrevivesse ao reset.

CREATE OR REPLACE FUNCTION public.current_portal_customer_id() RETURNS bigint
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_customer_id bigint;
  v_revoked_at timestamptz;
  v_issued_at timestamptz;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sessao do portal invalida ou expirada.' USING ERRCODE = '28000';
  END IF;

  SELECT a.customer_id, a.credentials_revoked_at
  INTO v_customer_id, v_revoked_at
  FROM public.customer_portal_accounts AS a
  WHERE a.auth_user_id = auth.uid()
    AND a.active = true;

  IF v_customer_id IS NULL THEN
    RAISE EXCEPTION 'Sessao do portal invalida ou expirada.' USING ERRCODE = '28000';
  END IF;

  IF v_revoked_at IS NOT NULL THEN
    -- Sem iat confiável não há como provar emissão pós-revogação.
    BEGIN
      v_issued_at := to_timestamp(NULLIF(auth.jwt() ->> 'iat', '')::double precision);
    EXCEPTION WHEN OTHERS THEN
      v_issued_at := NULL;
    END;

    IF v_issued_at IS NULL OR v_issued_at < v_revoked_at THEN
      RAISE EXCEPTION 'Sessao do portal invalida ou expirada.' USING ERRCODE = '28000';
    END IF;
  END IF;

  RETURN v_customer_id;
END;
$$;

REVOKE ALL ON FUNCTION public.current_portal_customer_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_portal_customer_id() TO authenticated;

DO $verify_portal_session_revocation_strict_cutoff$
BEGIN
  IF has_function_privilege('anon', 'public.current_portal_customer_id()', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.current_portal_customer_id()', 'EXECUTE') THEN
    RAISE EXCEPTION 'current_portal_customer_id fora do contrato de EXECUTE';
  END IF;
END;
$verify_portal_session_revocation_strict_cutoff$;
