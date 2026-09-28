-- Edge Functions validam o ator/escopo antes de usar `service_role`; no Preview
-- de branch, os defaults da plataforma nao existem. Tornar explicitos somente
-- os acessos diretos usados pelo runtime do Portal, sem abrir tabelas a clientes.
GRANT SELECT, UPDATE ON TABLE public.customer_portal_accounts TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.portal_invites TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.portal_email_attempts TO service_role;
GRANT SELECT, INSERT ON TABLE public.alerts TO service_role;

GRANT USAGE, SELECT ON SEQUENCE
  public.portal_invites_id_seq,
  public.portal_email_attempts_id_seq,
  public.alerts_id_seq
TO service_role;
