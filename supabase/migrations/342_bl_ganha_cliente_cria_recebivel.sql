-- 342: B/L com taxas calculadas que ganha cliente passa a ter recebível na
-- mesma transação (sessão de testes de 2026-10-20, observação 4).
--
-- Problema: `sync_local_charge_receivable` (migrations 072, 124 e 125) só
-- cria o recebível quando o B/L já tem `customer_id`; sem cliente, devolve
-- NULL e "aguarda a conciliação cadastral". Ela é chamada pelo cálculo de
-- taxas, por `mark_bl_ready_for_billing` e por `_recalculate_bl_cargo_mode`,
-- mas por nenhum caminho que vincula o cliente: a revisão por grupo
-- (`complete_review_customer_group`), a fila de conciliação, a Base de
-- Clientes ou a troca direta de `bls.customer_id`. Na produção, 12 B/Ls
-- importados sem cliente ficaram sem recebível (e fora do saldo pendente)
-- até o recálculo manual, 14 minutos depois do vínculo.
--
-- Mudança: trigger `AFTER UPDATE OF customer_id ON bls` que, quando o B/L
-- passa a ter cliente (de nenhum ou de outro) e tem linha de cálculo vigente:
--   - B/L ainda não faturado (`financial_status` pendente): recalcula as taxas
--     com as condições do novo cliente (`calculate_bl_local_charges`, que
--     sincroniza o recebível no fim), como a aprovação da conciliação de
--     cliente já faz (`approve_customer_reconciliation`). O cálculo feito
--     sem cliente usou as tabelas gerais; copiar esse total para o recebível
--     cobraria o cliente com Condição de Cliente pelo valor errado.
--   - demais (sem fatura viva): `sync_local_charge_receivable` leva o
--     recebível para o novo cliente.
-- Vale para qualquer caminho de vínculo.
-- ponytail: a aprovação da conciliação recalcula de novo depois deste
-- gatilho; o segundo cálculo é idempotente e custa uma passada a mais.
--
-- B/L já faturado (fatura viva, `_live_local_invoice_ids_for_bl`) fica de
-- fora: a troca de cliente dele segue a ADR 0017 (`capture_invoice_basis` e
-- `process_invoice_basis_changes`, com a trava
-- `guard_bl_customer_change_other_receipts`, que roda antes deste trigger).
-- B/L que perde o cliente (X → NULL) também fica como está: o recebível
-- continua com o cliente anterior até o próximo cálculo.
--
-- Uma falha do recálculo ou da sincronização (ex.: ROE ausente com taxa em
-- USD) não desfaz o vínculo do cliente: fica no Histórico do B/L
-- (`local_charges_customer_link_calc_error`, como a conciliação grava a sua)
-- e o recebível nasce no próximo cálculo, como antes.
--
-- Só cria função e trigger; não reescreve nem apaga linhas existentes. Os 7
-- B/Ls do lote 203 da viagem 62 sem cliente ganham recebível quando o
-- cliente for vinculado; os já vinculados sem recebível precisam de um
-- recálculo (não há nenhum hoje: os 12 foram recalculados às 15:44:57).
-- Rollback: DROP TRIGGER trg_sync_receivable_on_bl_customer_link ON
-- public.bls; DROP FUNCTION public.sync_receivable_on_bl_customer_link().

CREATE OR REPLACE FUNCTION public.sync_receivable_on_bl_customer_link()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF COALESCE(NEW.financial_status, 'pending') = 'cancelled' OR NEW.cancelled_at IS NOT NULL THEN
    RETURN NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.charge_calculations cc
    WHERE cc.bl_id = NEW.id
      AND COALESCE(cc.status, 'calculated') IN ('calculated', 'reviewed', 'ready_for_billing')
  ) THEN
    RETURN NULL;
  END IF;
  IF cardinality(public._live_local_invoice_ids_for_bl(NEW.id)) > 0 THEN
    RETURN NULL;
  END IF;
  BEGIN
    IF COALESCE(NEW.financial_status, 'pending') = 'pending' THEN
      PERFORM public.calculate_bl_local_charges(NEW.id, auth.uid(), true);
    ELSE
      PERFORM public.sync_local_charge_receivable(NEW.id);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification)
    VALUES ('bl', NEW.id, 'local_charges_customer_link_calc_error', NULL, SQLERRM, auth.uid(), now(),
      'Falha no recálculo das taxas locais ao vincular o cliente; o recebível nasce no próximo cálculo.');
  END;
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.sync_receivable_on_bl_customer_link() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_sync_receivable_on_bl_customer_link ON public.bls;
CREATE TRIGGER trg_sync_receivable_on_bl_customer_link
  AFTER UPDATE OF customer_id ON public.bls
  FOR EACH ROW
  WHEN (NEW.customer_id IS NOT NULL AND OLD.customer_id IS DISTINCT FROM NEW.customer_id)
  EXECUTE FUNCTION public.sync_receivable_on_bl_customer_link();
