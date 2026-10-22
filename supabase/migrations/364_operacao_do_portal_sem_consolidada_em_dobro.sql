-- 364: a aba Operação do Portal não soma a consolidada aberta por cima da
-- individual (plano da frente financeira, F-14).
--
-- Problema: `_portal_bl_local_charges` (298) somava a individual e a parte
-- do B/L na consolidada aberta: um B/L de R$ 100 aparecia com R$ 200.
--
-- Mudança: a regra da migration 344 (cada B/L uma vez; a consolidada aberta
-- conta no lugar da individual).
--
-- Não altera nem apaga linhas existentes.

CREATE OR REPLACE FUNCTION public._portal_bl_local_charges(p_customer_id bigint, p_bl text, p_invoices jsonb)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH visible AS (
    SELECT (inv->>'id')::bigint AS invoice_id,
           inv->>'status' AS status,
           inv->>'invoice_type' AS invoice_type,
           COALESCE((inv->>'total_brl')::numeric, 0) AS total_brl,
           COALESCE((inv->>'balance_brl')::numeric, 0) AS balance_brl,
           jsonb_array_length(COALESCE(inv->'bls', '[]'::jsonb)) AS bl_count
    FROM jsonb_array_elements(COALESCE(p_invoices, '[]'::jsonb)) AS inv
    WHERE inv->>'invoice_type' IN ('individual', 'consolidated')
      AND inv->>'status' NOT IN ('draft', 'cancelled', 'obsolete', 'covered')
      AND COALESCE(inv->'bls', '[]'::jsonb) ? p_bl
      -- 364: com consolidada aberta do B/L, ela conta no lugar da individual
      -- (mesma regra do saldo do Portal, migration 344).
      AND NOT (inv->>'invoice_type' = 'individual' AND EXISTS (
        SELECT 1 FROM jsonb_array_elements(COALESCE(p_invoices, '[]'::jsonb)) AS con
        WHERE con->>'invoice_type' = 'consolidated'
          AND con->>'status' IN ('issued', 'partially_paid', 'overdue')
          AND COALESCE(con->'bls', '[]'::jsonb) ? p_bl))
  ),
  share AS (
    -- Fatura de um B/L só: o total e o saldo da própria fatura. Consolidada
    -- de vários B/Ls: a parte deste B/L, pelo recebível ligado a ela.
    SELECT
      CASE WHEN v.bl_count <= 1 THEN v.total_brl
        ELSE COALESCE((SELECT SUM(br.original_amount_brl - COALESCE(br.correction_amount_brl, 0))
          FROM public.invoice_receivable_links irl
          JOIN public.bl_receivables br ON br.id = irl.receivable_id
          WHERE irl.invoice_id = v.invoice_id AND irl.bl_id = p_bl
            AND irl.status IN ('active', 'settled_by_this_invoice')), 0) END AS total_brl,
      CASE WHEN v.bl_count <= 1 THEN v.balance_brl
        ELSE COALESCE((SELECT SUM(br.balance_brl)
          FROM public.invoice_receivable_links irl
          JOIN public.bl_receivables br ON br.id = irl.receivable_id
          WHERE irl.invoice_id = v.invoice_id AND irl.bl_id = p_bl
            AND irl.status = 'active'), 0) END AS balance_brl
    FROM visible AS v
  )
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM visible) THEN jsonb_build_object(
      'status', CASE WHEN (SELECT SUM(GREATEST(balance_brl, 0)) FROM share) > 0 THEN 'open' ELSE 'paid' END,
      'total_brl', (SELECT SUM(total_brl) FROM share),
      'balance_brl', (SELECT SUM(GREATEST(balance_brl, 0)) FROM share)
    )
    WHEN EXISTS (
      SELECT 1 FROM public.bl_receivables br
      WHERE br.bl_id = p_bl AND br.customer_id = p_customer_id
        AND br.source = 'local_charges' AND br.status IN ('open', 'partially_settled')
    ) THEN jsonb_build_object('status', 'awaiting_invoice')
    ELSE jsonb_build_object('status', 'none')
  END
$function$;
