-- 343: B/L novo não reabre a análise do Portal (sessão de testes de
-- 2026-10-20, observação 5; decisões do Lucca em 2026-10-20 e 2026-10-21).
--
-- Problema: o trigger `trg_portal_reopen_on_new_process` (função
-- `portal_reopen_on_new_process`, `AFTER INSERT OR UPDATE OF customer_id ON
-- bls`) devolvia a decisão a `aguardando_analise` em toda conta fora dela,
-- inclusive conta já ativa e inclusive na importação de B/L do MESMO cliente.
-- Na produção, o Vettore (cliente 3) ativou a conta às 15:32:38 e, às
-- 15:36:53, a importação dos lotes 200/202 devolveu a decisão a
-- `aguardando_analise` com a situação `ativo`: a tela mostrava "Aguardando
-- análise" e "Ativa" ao mesmo tempo.
--
-- Decisão (Lucca):
--   2026-10-20: conta do Portal já ATIVA nunca volta para "aguardando
--   análise"; a importação de B/Ls do mesmo cliente não reabre a revisão.
--   2026-10-21: conta ainda NÃO ativa também permanece no mesmo status quando
--   um B/L entra; a entrada do B/L não é fato novo para o que trava o
--   provisionamento do Portal.
--
-- Mudança:
--   1. Sai o trigger `trg_portal_reopen_on_new_process` e a função
--      `portal_reopen_on_new_process`: nem B/L novo nem B/L que passa a ser do
--      cliente mudam a decisão do Portal. A análise só volta a "Aguardando
--      análise" pelo "Reabrir análise" do Administrativo
--      (`portal_return_to_analysis`).
--   2. Correção dos dados atuais: conta cuja decisão foi devolvida a
--      `aguardando_analise` por esse trigger (último evento de decisão é o
--      "Novo processo ativo reabriu a análise do Portal.") volta à decisão
--      anterior a ele, com evento do sistema. Conta reaberta à mão pelo
--      Administrativo não é tocada.
--
-- Reescreve linhas existentes (`customer_portal_accounts.provisioning_decision`
-- das contas reabertas pelo trigger; na produção, o cliente 3). Depende da
-- afirmação "Data status" do AGENTS.md (seção Gotchas): o banco de produção só
-- tem dados de teste.
-- Rollback: recriar a função e o trigger com a definição do dump 002; a
-- correção de dados não tem volta automática (os eventos gravados dizem o
-- estado anterior).

DROP TRIGGER IF EXISTS trg_portal_reopen_on_new_process ON public.bls;
DROP FUNCTION IF EXISTS public.portal_reopen_on_new_process();

DO $$
DECLARE
  v_account record;
BEGIN
  FOR v_account IN
    SELECT a.id, a.customer_id, a.account_situation, last_event.previous_decision
    FROM public.customer_portal_accounts a
    CROSS JOIN LATERAL (
      SELECT e.reason, e.previous_decision
      FROM public.portal_provisioning_events e
      WHERE e.account_id = a.id
        AND e.new_decision IS DISTINCT FROM e.previous_decision
      ORDER BY e.created_at DESC, e.id DESC
      LIMIT 1
    ) last_event
    WHERE a.provisioning_decision = 'aguardando_analise'
      AND last_event.reason = 'Novo processo ativo reabriu a análise do Portal.'
      AND last_event.previous_decision IS NOT NULL
      AND last_event.previous_decision <> 'aguardando_analise'
    FOR UPDATE OF a
  LOOP
    UPDATE public.customer_portal_accounts
    SET provisioning_decision = v_account.previous_decision
    WHERE id = v_account.id;
    PERFORM public._portal_log_event(
      v_account.customer_id, v_account.id, NULL,
      'aguardando_analise', v_account.previous_decision,
      v_account.account_situation, v_account.account_situation,
      'sistema', 'B/L novo não reabre a análise do Portal: a reabertura automática foi desfeita (migration 343).', NULL
    );
  END LOOP;
END $$;
