-- 225: o Modo Inspeção mostra o mesmo Saldo pendente que o Cliente vê.
--
-- Problema (lote 1 da identidade, decisão de 2026-10-14): o cartão Saldo
-- pendente de /portal/billing no Modo Inspeção mostrava R$ 0,00 para um Cliente
-- que, no próprio Portal, via R$ 3.005,00. `portal_open_inspection` (migration
-- 002) lia `customers.pending_balance`, campo antigo do cadastro que não
-- acompanha os recebíveis; a sessão do Cliente (`portal_get_session_overview_v2`,
-- migration 105) soma os recebíveis em aberto, a Demurrage emitida ou vencida em
-- R$ e as faturas avulsas com saldo.
--
-- Mudança: a soma da migration 105 vira `_portal_customer_pending_balance`, e
-- as duas RPCs passam a chamá-la. O cálculo do Cliente não muda.
--
-- Só redefine funções; não reescreve nem apaga linhas.
-- Rollback: reaplicar as definições de `portal_get_session_overview_v2`
-- (migration 105) e `portal_open_inspection` (migration 002) e
-- DROP FUNCTION public._portal_customer_pending_balance(bigint).

CREATE OR REPLACE FUNCTION public._portal_customer_pending_balance(p_customer_id bigint) RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT
    COALESCE((
      SELECT SUM(r.balance_brl)
      FROM public.bl_receivables AS r
      WHERE r.customer_id = p_customer_id
        AND r.status IN ('open', 'partially_settled')
    ), 0)
    + COALESCE((
      SELECT SUM(GREATEST(COALESCE(d.current_total_brl, 0), 0))
      FROM public.demurrage_invoices AS d
      WHERE d.customer_id = p_customer_id
        AND d.status IN ('issued', 'overdue')
    ), 0)
    + COALESCE((
      SELECT SUM(i.balance_brl)
      FROM public.invoices AS i
      WHERE i.customer_id = p_customer_id
        AND i.invoice_type = 'manual'
        AND i.status IN ('issued', 'partially_paid', 'overdue')
        AND i.balance_brl > 0
    ), 0)
$$;

-- Auxiliar interna: só as RPCs do Portal (SECURITY DEFINER) a chamam, depois
-- de validar a sessão ou o gate da inspeção.
REVOKE ALL ON FUNCTION public._portal_customer_pending_balance(bigint) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.portal_get_session_overview_v2() RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_account RECORD;
  v_customer RECORD;
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

  UPDATE public.customer_portal_accounts
  SET last_login_at = now()
  WHERE id = v_account.id;

  RETURN jsonb_build_object(
    'customer_id',       v_customer.id,
    'customer_name',     v_customer.name,
    'customer_cnpj_cpf', v_customer.cnpj_cpf,
    'cnpj_cpf',          v_customer.cnpj_cpf,
    'pending_balance',   public._portal_customer_pending_balance(v_customer.id),
    'contact_email',     v_account.contact_email,
    'account_id',        v_account.id,
    'login_cnpj',        v_account.login_cnpj
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.portal_open_inspection(p_customer_id bigint, p_origin text DEFAULT NULL::text) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_origin TEXT := CASE WHEN p_origin IN ('provisionamento', 'ficha') THEN p_origin ELSE 'ficha' END;
  v_account RECORD;
  v_customer RECORD;
BEGIN
  PERFORM public._portal_inspect_guard(p_customer_id);

  INSERT INTO public.portal_inspection_events (inspector_id, customer_id, origin)
  SELECT auth.uid(), p_customer_id, v_origin
  WHERE NOT EXISTS (
    SELECT 1 FROM public.portal_inspection_events
    WHERE inspector_id = auth.uid()
      AND customer_id = p_customer_id
      AND created_at >= now() - interval '30 minutes'
  );

  SELECT a.id, a.customer_id, a.active, a.contact_email, a.login_cnpj
    INTO v_account
    FROM public.customer_portal_accounts a
   WHERE a.customer_id = p_customer_id;

  SELECT c.id, c.name, c.cnpj_cpf
    INTO v_customer
    FROM public.customers c
   WHERE c.id = p_customer_id;

  RETURN jsonb_build_object(
    'customer_id', v_customer.id,
    'customer_name', v_customer.name,
    'customer_cnpj_cpf', v_customer.cnpj_cpf,
    'cnpj_cpf', v_customer.cnpj_cpf,
    -- Mesmo valor que o Cliente vê na própria sessão (migration 105).
    'pending_balance', public._portal_customer_pending_balance(v_customer.id),
    'contact_email', v_account.contact_email,
    'account_id', v_account.id,
    'account_active', COALESCE(v_account.active, false),
    'login_cnpj', v_account.login_cnpj
  );
END;
$$;
