-- 234: o caminho legado de contas do Portal sai (item A21 do plano de
-- correções; ADR 0083, item 21; ADR 0013).
--
-- Problema: as RPCs `upsert_customer_portal_account` (senha própria em
-- tabela, que a ADR 0013 recusa) e `set_customer_portal_account_active` não
-- têm chamador em `src/` nem nas Edge Functions, mas seguiam executáveis pelo
-- Administrativo; a policy `cpa_admin_all` (ALL) permitia as mesmas escritas
-- direto em `customer_portal_accounts`, inclusive reativar uma conta Suspensa
-- fora da máquina de estados do provisionamento. A tabela de sessões do token
-- antigo (`customer_portal_sessions`) e o job que a limpava
-- (`cleanup-portal-sessions`) ficaram sem uso desde o login pelo Supabase Auth
-- (ADR 0001).
--
-- Mudança:
-- 1. DROP das duas RPCs.
-- 2. `customer_portal_accounts`: `cpa_admin_all` sai; o Administrativo
--    continua lendo (`cpa_admin_select`), e INSERT, UPDATE e DELETE de
--    `authenticated` e `anon` são revogados (em produção a tabela pode ter o
--    privilégio padrão da plataforma). A escrita fica com as Edge Functions
--    (`service_role`) e as RPCs `portal_*` `SECURITY DEFINER`.
-- 3. Job `cleanup-portal-sessions` desagendado e DROP TABLE
--    `customer_portal_sessions` (com a sequence e a policy).
--
-- Reescrita de dados: apaga a tabela `customer_portal_sessions` e as linhas
-- que ela tiver. Apoia-se na afirmação "Data status" do AGENTS.md (produção
-- sem dado real de negócio; toda linha é fixture descartável). Sem ela, esta
-- migration precisaria de plano de preservação.
-- Rollback: recriar a tabela da migration 001 e o job da 003, as RPCs da
-- 002 e a policy `cpa_admin_all` da 002 (as linhas apagadas não voltam).

-- 1. RPCs legadas.
DROP FUNCTION IF EXISTS public.upsert_customer_portal_account(bigint, text, text, boolean, uuid, text);
DROP FUNCTION IF EXISTS public.set_customer_portal_account_active(bigint, boolean, uuid);

-- 2. Escrita direta em customer_portal_accounts.
DROP POLICY IF EXISTS cpa_admin_all ON public.customer_portal_accounts;
DROP POLICY IF EXISTS cpa_admin_select ON public.customer_portal_accounts;
CREATE POLICY cpa_admin_select ON public.customer_portal_accounts
  FOR SELECT TO authenticated USING (public.is_admin());
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.customer_portal_accounts FROM PUBLIC, anon, authenticated;

-- 3. Sessões do token antigo.
DO $cron_sessions$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron')
     AND EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cleanup-portal-sessions') THEN
    PERFORM cron.unschedule('cleanup-portal-sessions');
  END IF;
END;
$cron_sessions$;

DROP TABLE IF EXISTS public.customer_portal_sessions;
