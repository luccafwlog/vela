-- 562: o "ciente" vencido apagado na limpeza não entra no Histórico de ações,
-- e o filtro Ação do Histórico não chama uma função por linha.
--
-- Revisão da release 2026-11-01 (PR #1142). A 560 pôs o gatilho genérico
-- `audit_row_changes` em `bl_charge_adjustment_acks` para INSERT, UPDATE e
-- DELETE. `ack_bl_charge_adjustment_impact` (495) apaga, a cada "ciente", os
-- aceites vencidos de TODOS os usuários (`DELETE ... WHERE expires_at < now()`):
-- o Histórico gravava a exclusão do "ciente" de uma pessoa com o autor de
-- outra, que só marcou "ciente" num B/L qualquer. O aceite é um token de 30
-- minutos; vencer não é ação de ninguém, e nenhuma tela altera ou apaga um
-- aceite. O que o Histórico deve mostrar é só quem marcou "ciente".
--
-- Mudança:
--   1. O gatilho `audit_bl_charge_adjustment_acks` passa a AFTER INSERT.
--   2. `_audit_action_kind` (558) perde o `SET search_path`. Com SET, o
--      planejador não expande a função SQL inline e o filtro Ação de
--      `admin_action_history` (`ev.action_kind = v_action`) a chamava uma vez
--      por linha de `audit_logs`: 1,37 s com 500 mil linhas no Postgres 16
--      local, contra 0,12 s sem SET (medido numa transação desfeita). É a
--      exceção de desempenho de docs/operations/seguranca.md: SQL simples, sem
--      DEFINER, corpo só com `pg_catalog`; a suíte `advisorFuncoesFechadas` a
--      aceita e confere no plano que continua inline.
--      ponytail: o filtro Ação continua lendo `audit_logs` inteira (só sem o
--      custo da chamada); se a tabela crescer a ponto de pesar, índice parcial
--      por data nas linhas de criação e exclusão.
--
-- Só troca gatilho e atributo de função; não grava nem reescreve linhas
-- existentes (as exclusões já gravadas no staging continuam como registro).
--
-- Rollback: recriar o gatilho como na 560 (AFTER INSERT OR UPDATE OR DELETE,
-- `audit_row_changes('id')`); `ALTER FUNCTION public._audit_action_kind(text,
-- text) SET search_path TO 'public', 'pg_temp'`.

DROP TRIGGER IF EXISTS audit_bl_charge_adjustment_acks ON public.bl_charge_adjustment_acks;
CREATE TRIGGER audit_bl_charge_adjustment_acks
  AFTER INSERT ON public.bl_charge_adjustment_acks
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_changes('id');

ALTER FUNCTION public._audit_action_kind(text, text) RESET search_path;
