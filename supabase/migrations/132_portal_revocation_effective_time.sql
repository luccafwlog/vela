-- O corte de JWT acompanha a revogação efetiva, inclusive após espera por lock.
BEGIN;

CREATE OR REPLACE FUNCTION public.portal_revoke_sessions(p_user_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  -- Adquirir o lock antes de apagar sessões e calcular o marco final.
  PERFORM 1 FROM public.customer_portal_accounts WHERE auth_user_id=p_user_id FOR UPDATE;
  DELETE FROM auth.refresh_tokens WHERE user_id=p_user_id::text;
  DELETE FROM auth.sessions WHERE user_id=p_user_id;
  UPDATE public.customer_portal_accounts SET credentials_revoked_at=clock_timestamp()
    WHERE auth_user_id=p_user_id;
END $$;

REVOKE ALL ON FUNCTION public.portal_revoke_sessions(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.portal_revoke_sessions(uuid) TO service_role;
COMMIT;
