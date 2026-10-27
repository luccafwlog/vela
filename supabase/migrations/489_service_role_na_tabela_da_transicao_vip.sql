-- 489: `service_role` lê e escreve a tabela da transição VIP da 487, como toda
-- tabela do `public` (contrato de GRANTs da migration `340`).
--
-- Problema: `ce_unlock_annual_kept_by_transition` (487) nasceu com REVOKE de
-- `anon` e `authenticated` e sem o GRANT de `service_role` que o restante do
-- `public` tem; o teste de contrato `grantsDoReplay` a acusava.
--
-- Mudança: GRANT de SELECT, INSERT, UPDATE e DELETE a `service_role`. `anon` e
-- `authenticated` seguem sem acesso; só as funções do Desbloqueio a leem.
--
-- Não reescreve dados existentes.
--
-- Rollback: REVOKE ALL ON public.ce_unlock_annual_kept_by_transition FROM service_role.

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ce_unlock_annual_kept_by_transition TO service_role;
