-- 343: conta do Portal já ativa não volta para "Aguardando análise" por B/L
-- novo (sessão de testes de 2026-10-20, observação 5; decisão do Lucca em
-- 2026-10-20).
--
-- Problema: o trigger `trg_portal_reopen_on_new_process` (função
-- `portal_reopen_on_new_process`, `AFTER INSERT OR UPDATE OF customer_id ON
-- bls`) reabria a análise de toda conta fora de "Aguardando análise",
-- inclusive conta já ativa e inclusive na importação de B/L do MESMO cliente.
-- Na produção, o Vettore (cliente 3) ativou a conta às 15:32:38 e, às
-- 15:36:53, a importação dos lotes 200/202 devolveu a decisão a
-- `aguardando_analise` com a situação `ativo`: a tela mostrava "Aguardando
-- análise" e "Ativa" ao mesmo tempo.
--
-- Decisão (Lucca, 2026-10-20): conta do Portal já ATIVA nunca volta para
-- "aguardando análise"; a importação de B/Ls do mesmo cliente não reabre a
-- revisão de uma conta ativa.
--
-- Mudança:
--   1. `portal_reopen_on_new_process` não toca em conta com situação `ativo`,
--      e no UPDATE só age quando o cliente do B/L de fato mudou. Conta ainda
--      não ativa (sem conta, convite pendente/expirado, falha no envio,
--      suspensa) continua reabrindo como antes.
--   2. Correção dos dados atuais: conta `ativo` cuja decisão foi devolvida a
--      `aguardando_analise` por esse trigger (último evento de decisão é o
--      "Novo processo ativo reabriu a análise do Portal.") volta a
--      `aprovado_para_provisionar`, com evento do sistema. Conta reaberta à
--      mão pelo Administrativo ("Reabrir análise") não é tocada.
--
-- Reescreve linhas existentes (`customer_portal_accounts.provisioning_decision`
-- das contas ativas reabertas pelo trigger; na produção, o cliente 3).
-- Depende da afirmação "Data status" do AGENTS.md (seção Gotchas): o banco de
-- produção só tem dados de teste.
-- Rollback: reaplicar a definição de `portal_reopen_on_new_process` do dump
-- 002; a correção de dados não tem volta automática (os eventos gravados
-- dizem o estado anterior).

CREATE OR REPLACE FUNCTION public.portal_reopen_on_new_process()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_account public.customer_portal_accounts%ROWTYPE;
BEGIN
  IF NEW.customer_id IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.customer_id IS NOT DISTINCT FROM NEW.customer_id THEN RETURN NEW; END IF;
  SELECT * INTO v_account
  FROM public.customer_portal_accounts
  WHERE customer_id = NEW.customer_id
  FOR UPDATE;
  -- Conta ativa não regride por B/L novo (343).
  IF FOUND AND v_account.provisioning_decision <> 'aguardando_analise'
     AND v_account.account_situation <> 'ativo' THEN
    UPDATE public.customer_portal_accounts
    SET provisioning_decision = 'aguardando_analise'
    WHERE id = v_account.id;
    PERFORM public._portal_log_event(
      NEW.customer_id, v_account.id, NULL,
      v_account.provisioning_decision, 'aguardando_analise',
      v_account.account_situation, v_account.account_situation,
      'sistema', 'Novo processo ativo reabriu a análise do Portal.', NULL
    );
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.portal_reopen_on_new_process() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  v_account record;
BEGIN
  FOR v_account IN
    SELECT a.*
    FROM public.customer_portal_accounts a
    WHERE a.account_situation = 'ativo'
      AND a.provisioning_decision = 'aguardando_analise'
      AND (
        SELECT e.reason
        FROM public.portal_provisioning_events e
        WHERE e.account_id = a.id
          AND e.new_decision IS DISTINCT FROM e.previous_decision
        ORDER BY e.created_at DESC, e.id DESC
        LIMIT 1
      ) = 'Novo processo ativo reabriu a análise do Portal.'
    FOR UPDATE OF a
  LOOP
    UPDATE public.customer_portal_accounts
    SET provisioning_decision = 'aprovado_para_provisionar'
    WHERE id = v_account.id;
    PERFORM public._portal_log_event(
      v_account.customer_id, v_account.id, NULL,
      'aguardando_analise', 'aprovado_para_provisionar',
      'ativo', 'ativo',
      'sistema', 'Conta ativa: a análise reaberta por B/L novo foi desfeita (migration 343).', NULL
    );
  END LOOP;
END $$;
