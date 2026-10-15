-- 232: contatos do Cliente e situação financeira do B/L só pelas RPCs (item
-- P3 do plano de correções; ADR 0060; ADR 0085, falhas 2 e 3).
--
-- Problema (reproduzido no Postgres local, relatório de 2026-10-14):
-- * Financeiro e Operações, recusados por
--   `internal_save_customer_contact_configuration`, trocavam pela API o e-mail
--   do contato principal (UPDATE direto em `customer_contacts`) ou criavam
--   outro principal, que herdava as Caixas de Comunicação, sem evento em
--   `customer_contact_change_events` (policies de escrita da migration 002).
-- * Qualquer usuário ativo marcava `bls.financial_status = 'invoiced'` pela
--   API: a emissão passava a recusar "já faturado" e o alerta de falha de
--   emissão fechava sozinho.
--
-- Mudança:
-- 1. `customer_contacts`: `authenticated` (e `anon`) perde INSERT e UPDATE e
--    as policies de escrita saem. A tela grava pela RPC
--    `internal_save_customer_contact_configuration`; as demais escritas são
--    RPCs `SECURITY DEFINER` (`ensure_customer_contact_email`,
--    `create_customer_with_contacts`, `portal_update_profile`, importação da
--    Base de Clientes e `delete_records`).
-- 2. `bls.financial_status`: gatilho `guard_bl_financial_status_port` recusa
--    a mudança quando quem escreve é a sessão do usuário (`current_user`
--    `authenticated` ou `anon`). As RPCs de faturamento rodam como dono
--    (`SECURITY DEFINER`) e passam; um REVOKE de coluna não bastaria
--    enquanto existir o grant de UPDATE da tabela `bls`.
-- 3. `register_invoice_payment` (migration 002), única função `SECURITY
--    INVOKER` que grava `bls.financial_status`, passa a `SECURITY DEFINER`.
--    Ela não tem chamador na tela (a baixa manual usa
--    `register_verified_invoice_payment`), mas a conciliação por TXID da
--    avulsa a chama (`reconcile_invoice_payment_by_txid_legacy_130`). A guarda
--    (Administrativo ativo) continua a mesma; o P5 a abre ao Financeiro.
--
-- Só muda privilégios, policies, um gatilho e a segurança de uma função; não
-- reescreve nem apaga linhas.
-- Rollback: GRANT INSERT, UPDATE ON public.customer_contacts TO authenticated
-- e recriar as policies da migration 002; DROP TRIGGER
-- guard_bl_financial_status_port e a função; ALTER FUNCTION
-- public.register_invoice_payment(...) SECURITY INVOKER.

-- 1. Contatos do Cliente.
REVOKE INSERT, UPDATE, DELETE ON public.customer_contacts FROM PUBLIC, anon, authenticated;
DROP POLICY IF EXISTS customer_contacts_insert_active_global ON public.customer_contacts;
DROP POLICY IF EXISTS customer_contacts_update_active_global ON public.customer_contacts;

-- 2. Situação financeira do B/L.
CREATE OR REPLACE FUNCTION public.guard_bl_financial_status_port()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- `current_user` é o papel efetivo: dentro de uma RPC SECURITY DEFINER é o
  -- dono da função; na escrita direta pela API é `authenticated`/`anon`.
  IF current_user IN ('authenticated', 'anon')
     AND (CASE WHEN TG_OP = 'INSERT'
            THEN COALESCE(NEW.financial_status, 'pending') <> 'pending'
            ELSE NEW.financial_status IS DISTINCT FROM OLD.financial_status END) THEN
    RAISE EXCEPTION 'A situação financeira do B/L % muda só pela emissão, baixa ou cancelamento da fatura.', NEW.id
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.guard_bl_financial_status_port() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS guard_bl_financial_status_port ON public.bls;
CREATE TRIGGER guard_bl_financial_status_port
  BEFORE INSERT OR UPDATE OF financial_status ON public.bls
  FOR EACH ROW EXECUTE FUNCTION public.guard_bl_financial_status_port();

-- 3. Baixa legada como dono.
ALTER FUNCTION public.register_invoice_payment(bigint, numeric, text, timestamp with time zone, text, uuid) SECURITY DEFINER;
