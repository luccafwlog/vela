-- Migration 167: conceder ou revogar a Liberação de faturamento sem Portal
-- reavalia a Revisão dos B/Ls do Cliente, como a ativação do Portal já faz.
--
-- Antes: `grant_customer_billing_portal_release` (085) gravava a Liberação e
-- chamava `_reprocess_customer_held_billing`, que limpa `billing_hold_reason`
-- e tenta emitir, mas não regrava `bls.review_status`. O B/L ficava em
-- `pending_review` com "Pendencias de importacao: Acesso ao portal nao
-- provisionado" na fila da Revisão, embora `compute_bl_review_pendencies` já
-- voltasse vazio. Só saía quando alguém salvava a revisão de cada B/L.
-- A ativação do Portal não tinha o problema: o gatilho
-- `trg_reconcile_bl_review_on_portal_change` (002) em `customer_portal_accounts`
-- e `customer_contacts` chama `recompute_bl_review_status` para os B/Ls não
-- faturados do Cliente.
--
-- Agora a mesma função de gatilho vale para `customer_billing_portal_releases`:
--   - concessão (INSERT): o gatilho roda antes de a RPC chamar o
--     reprocessamento, então o B/L sai da revisão antes da tentativa de
--     emissão;
--   - revogação (UPDATE de `revoked_at`): B/Ls ainda não faturados voltam a
--     `pending_review` com o motivo do Portal, como quando o Portal é suspenso.
-- A função é a da 002, sem mudança: lê `customer_id` de NEW/OLD.
--
-- ponytail: o vencimento da Liberação (`review_at` no passado) não é um evento
-- do banco, então não reavalia a Revisão. A emissão continua travada, porque o
-- gate de emissão lê `now()`; só a fila da Revisão demora a mostrar o motivo,
-- até a próxima reavaliação do B/L. Se isso importar, um job diário que
-- reavalie os Clientes com Liberação vencida no dia resolve.
--
-- Casos já parados: o bloco final reavalia `review_status` e as notas técnicas
-- dos B/Ls em revisão, não faturados, de Clientes com Liberação vigente.
-- Reescreve linhas existentes de `bls` e depende da afirmação "Data status" do
-- AGENTS.md (produção sem dados de negócio).

BEGIN;

DROP TRIGGER IF EXISTS trg_reconcile_bl_review_on_billing_release_change ON public.customer_billing_portal_releases;
CREATE TRIGGER trg_reconcile_bl_review_on_billing_release_change
  AFTER INSERT OR DELETE OR UPDATE OF revoked_at, review_at, customer_id
  ON public.customer_billing_portal_releases
  FOR EACH ROW EXECUTE FUNCTION public.trg_reconcile_bl_review_on_portal_change();

DO $$
DECLARE
  v_bl_id text;
BEGIN
  -- A migration roda sem JWT. A reconciliação de Alertas exige um ator
  -- autorizado; o papel de serviço vale só até o fim desta transação.
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('alerts.foundation_trigger', 'on', true);
  FOR v_bl_id IN
    SELECT b.id
    FROM public.bls b
    WHERE b.review_status = 'pending_review'
      AND COALESCE(b.financial_status, '') NOT IN ('invoiced', 'partially_paid', 'paid')
      AND b.customer_id IS NOT NULL
      AND public.customer_billing_release_active(b.customer_id)
  LOOP
    PERFORM public.recompute_bl_review_status(v_bl_id);
    PERFORM public.reconcile_bl_review_alerts(v_bl_id, 'billing_release_backfill');
  END LOOP;
  PERFORM set_config('alerts.foundation_trigger', 'off', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
END;
$$;

COMMIT;
