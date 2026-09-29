-- Calculate the Portal billing KPI from current receivables and open invoices.
-- Manual invoices intentionally stay outside the local receivables ledger.

CREATE OR REPLACE FUNCTION public.portal_get_session_overview_v2() RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_account RECORD;
  v_customer RECORD;
  v_pending_balance numeric;
BEGIN
  PERFORM public.current_portal_customer_id();

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sessao do portal invalida ou expirada.' USING ERRCODE = '28000';
  END IF;

  SELECT a.id, a.customer_id, a.active, a.contact_email, a.login_cnpj
  INTO v_account
  FROM public.customer_portal_accounts AS a
  WHERE a.auth_user_id = auth.uid();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sessao do portal invalida ou expirada.' USING ERRCODE = '28000';
  END IF;

  IF NOT v_account.active THEN
    RAISE EXCEPTION 'Acesso ao portal desativado. Entre em contato com o suporte.' USING ERRCODE = '28000';
  END IF;

  SELECT c.id, c.name, c.cnpj_cpf
  INTO v_customer
  FROM public.customers AS c
  WHERE c.id = v_account.customer_id;

  SELECT
    COALESCE((
      SELECT SUM(r.balance_brl)
      FROM public.bl_receivables AS r
      WHERE r.customer_id = v_customer.id
        AND r.status IN ('open', 'partially_settled')
    ), 0)
    + COALESCE((
      SELECT SUM(GREATEST(COALESCE(d.current_total_brl, 0), 0))
      FROM public.demurrage_invoices AS d
      WHERE d.customer_id = v_customer.id
        AND d.status IN ('issued', 'overdue')
    ), 0)
    + COALESCE((
      SELECT SUM(i.balance_brl)
      FROM public.invoices AS i
      WHERE i.customer_id = v_customer.id
        AND i.invoice_type = 'manual'
        AND i.status IN ('issued', 'partially_paid', 'overdue')
        AND i.balance_brl > 0
    ), 0)
  INTO v_pending_balance;

  UPDATE public.customer_portal_accounts
  SET last_login_at = now()
  WHERE id = v_account.id;

  RETURN jsonb_build_object(
    'customer_id',       v_customer.id,
    'customer_name',     v_customer.name,
    'customer_cnpj_cpf', v_customer.cnpj_cpf,
    'cnpj_cpf',          v_customer.cnpj_cpf,
    'pending_balance',   v_pending_balance,
    'contact_email',     v_account.contact_email,
    'account_id',        v_account.id,
    'login_cnpj',        v_account.login_cnpj
  );
END;
$$;
