-- 231: valores de cobrança só pelas RPCs (item P2 do plano de correções;
-- ADR 0077; ADR 0071, item 11; ADR 0085, falha 1).
--
-- Problema (reproduzido no Postgres local, relatório de 2026-10-14): qualquer
-- usuário interno ativo escrevia pela API em `demurrage_invoice_items` (zerava
-- dias, diária e subtotal de item de Invoice emitida e movia o item para
-- outra invoice) e em `charge_calculations` (mudava o THC e zerava a taxa
-- manual antes da emissão), e o Administrativo apagava linha de
-- `charge_calculations` sem a checagem "até ser faturada" de
-- `delete_manual_bl_charge`. Policies de escrita da migration 002 e grant da
-- 006.
--
-- Mudança: `authenticated` (e `anon`, que em produção pode ter o privilégio
-- padrão da plataforma) perde INSERT, UPDATE e DELETE nas duas tabelas, e as
-- policies de escrita saem. O navegador só lê as duas (`src/services/`); a
-- escrita fica com as RPCs `SECURITY DEFINER` de cálculo, emissão e
-- recálculo, que rodam como dono. O gatilho
-- `guard_container_bl_without_containers`, única função `SECURITY INVOKER`
-- que grava `charge_calculations` a partir de uma escrita do usuário em
-- `bls`, passa a `SECURITY DEFINER` para continuar abrindo a linha de revisão.
-- (`import_manifest_transactional_legacy_165`, também INVOKER, só é chamada
-- por `import_manifest_transactional`, DEFINER.)
--
-- Só muda privilégios, policies e a segurança de uma função; não reescreve
-- nem apaga linhas.
-- Rollback: GRANT INSERT, UPDATE, DELETE nas duas tabelas a `authenticated`,
-- recriar as policies da migration 002 e `ALTER FUNCTION
-- public.guard_container_bl_without_containers() SECURITY INVOKER`.

REVOKE INSERT, UPDATE, DELETE ON public.demurrage_invoice_items FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.charge_calculations FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS demurrage_items_insert_active_global ON public.demurrage_invoice_items;
DROP POLICY IF EXISTS demurrage_items_update_active_global ON public.demurrage_invoice_items;
DROP POLICY IF EXISTS demurrage_items_delete_admin ON public.demurrage_invoice_items;
DROP POLICY IF EXISTS charge_calculations_insert_active_global ON public.charge_calculations;
DROP POLICY IF EXISTS charge_calculations_update_active_global ON public.charge_calculations;
DROP POLICY IF EXISTS charge_calculations_delete_admin ON public.charge_calculations;

ALTER FUNCTION public.guard_container_bl_without_containers() SECURITY DEFINER;
ALTER FUNCTION public.guard_container_bl_without_containers() SET search_path TO 'public', 'pg_temp';
REVOKE ALL ON FUNCTION public.guard_container_bl_without_containers() FROM PUBLIC, anon, authenticated;
