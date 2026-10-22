-- 371: o saldo do Vela separa o faturado do que falta faturar, e a avulsa
-- aberta entra (ADR 0093, decisões 10 e 11; plano da frente financeira, F-23 e
-- F-24).
--
-- Problema: `get_customer_pending_balances` (070) somava os recebíveis de
-- Taxas Locais e a Demurrage, sem a Fatura Avulsa aberta e sem separar o que
-- já foi faturado do que ainda não foi.
--
-- Mudança: a função devolve também
--   - `invoiced_open_brl` — "Faturado em aberto": faturas emitidas e não
--     quitadas, pelo saldo restante, com a regra do Portal (cada B/L uma vez:
--     o recebível com vínculo ativo a fatura viva conta pelo seu saldo, seja a
--     consolidada aberta, seja a individual), mais a avulsa e a Demurrage
--     emitidas;
--   - `to_invoice_brl` — "A faturar": recebíveis em aberto sem fatura viva;
--   - `manual_balance_brl` — a avulsa aberta, pelo saldo restante;
-- e `total_balance_brl` passa a ser a soma das duas primeiras ("Saldo
-- pendente total"). `local_balance_brl` e `demurrage_balance_brl` continuam.
-- O saldo do Portal não muda (só fatura emitida e não quitada, 344).
--
-- Não altera nem apaga linhas existentes.

DROP FUNCTION public.get_customer_pending_balances(bigint[]);

CREATE FUNCTION public.get_customer_pending_balances(p_customer_ids bigint[] DEFAULT NULL::bigint[])
RETURNS TABLE(customer_id bigint, local_balance_brl numeric, demurrage_balance_brl numeric, total_balance_brl numeric,
  invoiced_open_brl numeric, to_invoice_brl numeric, manual_balance_brl numeric)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_read_user() THEN
    RAISE EXCEPTION 'Usuario sem permissao para consultar saldos.' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH receivables AS (
    SELECT r.customer_id, r.balance_brl,
      EXISTS (
        SELECT 1 FROM public.invoice_receivable_links l JOIN public.invoices i ON i.id = l.invoice_id
        WHERE l.receivable_id = r.id AND l.status = 'active'
          AND i.invoice_type IN ('individual', 'consolidated')
          AND coalesce(i.status, 'issued') IN ('issued', 'partially_paid')
      ) AS invoiced
    FROM public.bl_receivables r
    WHERE r.status IN ('open', 'partially_settled')
      AND (p_customer_ids IS NULL OR r.customer_id = ANY(p_customer_ids))
  ), local_totals AS (
    SELECT x.customer_id,
      sum(x.balance_brl) AS amount,
      sum(x.balance_brl) FILTER (WHERE x.invoiced) AS invoiced_amount,
      sum(x.balance_brl) FILTER (WHERE NOT x.invoiced) AS to_invoice_amount
    FROM receivables x
    GROUP BY x.customer_id
  ), demurrage_totals AS (
    SELECT d.customer_id, sum(greatest(coalesce(d.current_total_brl, 0), 0)) AS amount
    FROM public.demurrage_invoices d
    WHERE d.status IN ('issued', 'overdue')
      AND (p_customer_ids IS NULL OR d.customer_id = ANY(p_customer_ids))
    GROUP BY d.customer_id
  ), manual_totals AS (
    SELECT m.customer_id, sum(greatest(coalesce(m.balance_brl, 0), 0)) AS amount
    FROM public.invoices m
    WHERE m.invoice_type = 'manual' AND coalesce(m.status, 'issued') IN ('issued', 'partially_paid')
      AND (p_customer_ids IS NULL OR m.customer_id = ANY(p_customer_ids))
    GROUP BY m.customer_id
  ), customers_with_balance AS (
    SELECT lt.customer_id FROM local_totals lt
    UNION SELECT dt.customer_id FROM demurrage_totals dt
    UNION SELECT mt.customer_id FROM manual_totals mt
  )
  SELECT c.customer_id,
    coalesce(l.amount, 0),
    coalesce(d.amount, 0),
    coalesce(l.invoiced_amount, 0) + coalesce(d.amount, 0) + coalesce(m.amount, 0) + coalesce(l.to_invoice_amount, 0),
    coalesce(l.invoiced_amount, 0) + coalesce(d.amount, 0) + coalesce(m.amount, 0),
    coalesce(l.to_invoice_amount, 0),
    coalesce(m.amount, 0)
  FROM customers_with_balance c
  LEFT JOIN local_totals l ON l.customer_id = c.customer_id
  LEFT JOIN demurrage_totals d ON d.customer_id = c.customer_id
  LEFT JOIN manual_totals m ON m.customer_id = c.customer_id;
END;
$$;
REVOKE ALL ON FUNCTION public.get_customer_pending_balances(bigint[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_customer_pending_balances(bigint[]) TO authenticated, service_role;
