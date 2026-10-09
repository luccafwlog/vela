-- Migration 166: leitura de baplie_reconciliation_resolutions sem depender do
-- default de tabelas da plataforma.
--
-- Evidência (Sentry VELA-16, 27 eventos de 2026-09-22 a 2026-10-08): "Linha do
-- Tempo" da viagem (/viagens/:id, queryKey voyage-timeline) falhava com 42501
-- em previews (pr-797, pr-842, pr-903), no ambiente local do design-audit
-- (localhost:5288) e num preview Vercel — nunca em vela.app.br. No Postgres
-- descartável do replay (scripts/setup-local-pg.sh), SELECT nesta tabela como
-- `authenticated` reproduz "permission denied for table
-- baplie_reconciliation_resolutions"; as outras leituras da linha do tempo passam.
--
-- Causa: em produção a tabela tem `authenticated=arwdDxtm` herdado do ALTER
-- DEFAULT PRIVILEGES da plataforma Supabase, e nenhuma migration concede o
-- acesso. Banco montado só pelas migrations nasce sem o grant. É a única
-- tabela, entre as que dependem desse default, que o navegador lê direto
-- (src/services/voyageTimeline.ts).
--
-- Correção: GRANT SELECT explícito a authenticated (a policy
-- baplie_reconciliation_resolutions_select_active continua limitando a
-- usuários ativos) e ALL a service_role, como a 006 fez com as tabelas do
-- contrato operacional. Em produção é no-op: o ACL já contém esses
-- privilégios. Nenhuma linha é lida, reescrita ou apagada.
--
-- Rollback: REVOKE SELECT ON TABLE public.baplie_reconciliation_resolutions
-- FROM authenticated, somente em banco onde o default da plataforma garanta a
-- leitura (em produção o REVOKE removeria o acesso herdado).

GRANT SELECT ON TABLE public.baplie_reconciliation_resolutions TO authenticated;
GRANT ALL ON TABLE public.baplie_reconciliation_resolutions TO service_role;
