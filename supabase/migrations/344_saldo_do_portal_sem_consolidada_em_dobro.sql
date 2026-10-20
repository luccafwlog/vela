-- 344: saldo pendente do Portal conta cada B/L uma vez, sem somar a
-- consolidada aberta por cima das individuais que ela agrupa (sessão de
-- testes de 2026-10-20, observação 6; decisão do Lucca em 2026-10-20).
--
-- Problema: `_portal_customer_pending_balance` (migrations 225 e 298) soma
-- `balance_brl` de todas as faturas de `_portal_list_invoices_core` em
-- `issued`, `partially_paid` ou `overdue`, consolidadas incluídas. As
-- individuais agrupadas numa consolidada continuam `issued` (só viram
-- `covered` quando a consolidada é paga, migration 247), então o saldo
-- cobrava em dobro: na produção, o Vettore tinha 12 individuais de
-- R$ 2.470,00 (R$ 29.640,00) e a consolidada INV-2026-0035 com os mesmos
-- R$ 29.640,00, e o Portal mostrava R$ 59.280,00.
--
-- Decisão (Lucca, 2026-10-20): o saldo do Portal é a soma por B/L das
-- faturas, sem a consolidada em duplicidade; B/L ainda não faturado não entra
-- no saldo do Portal (a tela interna, por recebível, continua contando o B/L
-- sem fatura).
--
-- Mudança: a individual cujos B/Ls estão todos numa consolidada aberta da
-- mesma lista sai da soma; a consolidada conta no lugar dela (e um pagamento
-- parcial da consolidada reduz o saldo). Pagar a consolidada cobre as
-- individuais e zera; desfazer a consolidada (obsoleta/cancelada) devolve as
-- individuais à soma. A lista de faturas não muda: mostra a consolidada e as
-- individuais. Mesma regra do Painel do Portal
-- (`portalInvoicesInOpenBalance`, src/lib/portalInvoiceStatus.tsx).
--
-- Só redefine uma função; não reescreve nem apaga linhas.
-- Rollback: reaplicar a definição da migration 298.

CREATE OR REPLACE FUNCTION public._portal_customer_pending_balance(p_customer_id bigint)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH open_invoices AS (
    SELECT inv.invoice_type, inv.balance_brl, COALESCE(inv.bls, ARRAY[]::text[]) AS bls
    FROM public._portal_list_invoices_core(p_customer_id) AS inv
    WHERE inv.status IN ('issued', 'partially_paid', 'overdue')
  ),
  consolidated_bls AS (
    SELECT DISTINCT unnest(o.bls) AS bl_id
    FROM open_invoices o
    WHERE o.invoice_type = 'consolidated'
  )
  SELECT
    COALESCE((
      SELECT SUM(GREATEST(COALESCE(o.balance_brl, 0), 0))
      FROM open_invoices o
      WHERE o.invoice_type = 'consolidated'
         OR cardinality(o.bls) = 0
         OR EXISTS (SELECT 1 FROM unnest(o.bls) AS b(bl_id) WHERE b.bl_id NOT IN (SELECT c.bl_id FROM consolidated_bls c))
    ), 0)
    + COALESCE((
      SELECT SUM(GREATEST(COALESCE((dem->>'current_total_brl')::numeric, 0), 0))
      FROM jsonb_array_elements(public._portal_list_demurrage_invoices_core(p_customer_id)) AS dem
      WHERE dem->>'status' IN ('issued', 'overdue')
    ), 0)
$function$;

REVOKE ALL ON FUNCTION public._portal_customer_pending_balance(bigint) FROM PUBLIC, anon, authenticated;
