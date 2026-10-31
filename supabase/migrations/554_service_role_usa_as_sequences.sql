-- Migration 554: service_role usa as sequences do schema public, como em
-- produção. Completa a 340, que deu a service_role o SELECT/INSERT/UPDATE/
-- DELETE das tabelas e deixou de fora as sequences dos ids.
--
-- Incidente (staging, 2026-10-30 e 2026-10-31): todo Comunicado, manual ou da
-- régua automática, falhava com "Falha no envio do comunicado." antes de
-- chegar ao provedor. O log da Edge send-customer-communication trazia
-- 42501 "permission denied for sequence customer_communication_attempts_id_seq":
-- a Edge grava a tentativa direto na tabela com service_role, e o id vem dessa
-- sequence. O registro da falha batia no mesmo erro, então o Comunicado
-- ficava em "falha" sem nenhuma tentativa no Histórico. A régua de Demurrage
-- (Edge demurrage-dunning) grava na mesma tabela do mesmo jeito.
--
-- Causa: em produção, o default privilege do papel das migrations dá USAGE,
-- SELECT e UPDATE das sequences novas a service_role (e a anon/authenticated);
-- a branch staging e o replay local nascem só da cadeia e não têm esse
-- default. Comparação feita em 2026-10-31, somente leitura: em produção,
-- service_role usa todas as sequences de Comunicado; na staging, 64 sequences
-- do public não tinham USAGE para service_role; no replay local, 65 de 88.
-- A 101 já tinha dado o grant, pelo mesmo motivo, só às sequences que o
-- Portal usava.
--
-- Mudança:
-- 1. USAGE e SELECT (nextval/currval) a service_role em toda sequence do
--    public. Ele já tem INSERT em todas as tabelas (340); sem a sequence, o
--    INSERT que depende do id padrão falha. Sem UPDATE (setval): nenhuma Edge
--    o usa.
-- 2. O default privilege do papel das migrations passa a dar o mesmo às
--    sequences novas. A suíte local-pg grantsDoReplay confere o resultado.
--
-- Não muda anon nem authenticated (a 106 tirou as sequences de anon). Não
-- altera nem apaga linhas. Idempotente. Rollback: REVOKE USAGE, SELECT das
-- mesmas sequences e ALTER DEFAULT PRIVILEGES ... REVOKE inverso.

DO $grants_554$
DECLARE
  v_sequence text;
BEGIN
  FOR v_sequence IN
    SELECT c.relname FROM pg_class c
    WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'S'
    ORDER BY c.relname
  LOOP
    EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE public.%I TO service_role', v_sequence);
  END LOOP;
END;
$grants_554$;

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO service_role;
