-- 180: desempenho da importação de CE (M07 da revisão de 2026-10-09; etapa
-- 8.1 do plano de correção). `assert_bl_ce_mercante` e
-- `_sync_local_charge_receivable_before_correction_123` comparavam o id do
-- B/L com `UPPER(BTRIM(id))`/`OR UPPER(id)`, o que impede o uso da chave
-- primária e faz cada B/L faturado varrer `bls` inteira. Agora a igualdade em
-- `id` vem primeiro; a comparação sem caixa fica para o id que não existe
-- exatamente.
--
-- Não reescreve linhas.
--
-- Rollback: reaplicar `assert_bl_ce_mercante` da 001 e
-- `_sync_local_charge_receivable_before_correction_123` da 123.

CREATE OR REPLACE FUNCTION public.assert_bl_ce_mercante(p_bl_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bl_id text := NULLIF(btrim(COALESCE(p_bl_id, '')), '');
  v_ce text;
BEGIN
  IF v_bl_id IS NOT NULL THEN
    SELECT ce_mercante INTO v_ce FROM public.bls WHERE id = v_bl_id;
    IF NOT FOUND THEN
      SELECT ce_mercante INTO v_ce FROM public.bls WHERE upper(btrim(id)) = upper(v_bl_id) LIMIT 1;
    END IF;
  END IF;
  IF NULLIF(btrim(COALESCE(v_ce, '')), '') IS NULL THEN
    RAISE EXCEPTION 'B/L % sem CE Mercante. Cadastre o CE antes de faturar.', p_bl_id
      USING ERRCODE = 'P0003';
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public._sync_local_charge_receivable_before_correction_123(p_bl_id text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bl RECORD;
  v_amount NUMERIC(14,2);
  v_roe NUMERIC(10,4);
  v_roe_effective_date DATE;
  v_paid_amount NUMERIC(14,2);
  v_receivable_id BIGINT;
  v_status TEXT;
BEGIN
  IF auth.uid() IS NOT NULL
     AND NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Credenciais invalidas ou sem permissao de faturamento.' USING ERRCODE = '42501';
  END IF;

  -- Igualdade em `id` usa a chave primária; a comparação sem caixa só roda
  -- quando o id exato não existe (migration 180, M07).
  SELECT id, customer_id, voyage_id, cargo_mode, pol, pod
  INTO v_bl
  FROM public.bls
  WHERE id = btrim(p_bl_id);
  IF NOT FOUND THEN
    SELECT id, customer_id, voyage_id, cargo_mode, pol, pod
    INTO v_bl
    FROM public.bls
    WHERE UPPER(id) = UPPER(btrim(p_bl_id))
    LIMIT 1;
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L % nao encontrado.', p_bl_id USING ERRCODE = 'P0002';
  END IF;

  -- Se o B/L ainda nao tem cliente vinculado, a sincronizacao de recebivel
  -- aguarda a conciliacao cadastral (reconcile/relink). O calculo das taxas
  -- locais permanece preservado.
  IF v_bl.customer_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT roe, effective_date INTO v_roe, v_roe_effective_date
  FROM public.exchange_rate_reference WHERE id = 1;

  IF v_roe IS NULL AND EXISTS (
    SELECT 1 FROM public.charge_calculations AS cc
    WHERE cc.bl_id = v_bl.id
      AND COALESCE(cc.total_value_usd, 0) > 0
      AND COALESCE(cc.status, 'calculated') IN ('calculated', 'reviewed', 'ready_for_billing')
  ) THEN
    RAISE EXCEPTION 'Cambio (ROE) nao configurado; nao e possivel calcular o saldo de linhas em USD.' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(SUM(
    COALESCE(cc.total_value_brl, CASE WHEN COALESCE(cc.total_value_usd, 0) > 0 THEN ROUND(cc.total_value_usd * v_roe, 2) END, 0)
  ), 0)
  INTO v_amount
  FROM public.charge_calculations AS cc
  WHERE cc.bl_id = v_bl.id
    AND COALESCE(cc.status, 'calculated') IN ('calculated', 'reviewed', 'ready_for_billing');

  SELECT COALESCE(SUM(p.amount_brl), 0)
  INTO v_paid_amount
  FROM public.invoice_bls ib
  JOIN public.invoices i ON i.id = ib.invoice_id
  JOIN public.payments p ON p.invoice_id = i.id
  WHERE ib.bl_id = v_bl.id
    AND COALESCE(i.status, 'issued') = 'paid'
    AND i.customer_id = v_bl.customer_id
    AND NOT EXISTS (SELECT 1 FROM public.invoice_customer_changes c
      WHERE c.bl_id = v_bl.id AND i.id = ANY(c.original_invoice_ids)
        AND c.status IN ('reissue_pending', 'completed'));

  v_paid_amount := LEAST(v_paid_amount, v_amount);
  v_status := CASE
    WHEN v_amount <= 0 THEN 'void'
    WHEN v_paid_amount >= v_amount THEN 'settled'
    WHEN v_paid_amount > 0 THEN 'partially_settled'
    ELSE 'open'
  END;

  INSERT INTO public.bl_receivables (
    bl_id, customer_id, source, original_amount_brl, settled_amount_brl, balance_brl,
    status, voyage_id, cargo_mode, pol, pod, roe_frozen, roe_effective_date_frozen, updated_at
  )
  VALUES (
    v_bl.id, v_bl.customer_id, 'local_charges', v_amount, v_paid_amount,
    GREATEST(v_amount - v_paid_amount, 0), v_status, v_bl.voyage_id,
    v_bl.cargo_mode, v_bl.pol, v_bl.pod, v_roe, v_roe_effective_date, now()
  )
  ON CONFLICT (source, bl_id)
  DO UPDATE SET
    customer_id = EXCLUDED.customer_id,
    original_amount_brl = EXCLUDED.original_amount_brl,
    settled_amount_brl = EXCLUDED.settled_amount_brl,
    balance_brl = EXCLUDED.balance_brl,
    status = EXCLUDED.status,
    voyage_id = EXCLUDED.voyage_id,
    cargo_mode = EXCLUDED.cargo_mode,
    pol = EXCLUDED.pol,
    pod = EXCLUDED.pod,
    roe_frozen = EXCLUDED.roe_frozen,
    roe_effective_date_frozen = EXCLUDED.roe_effective_date_frozen,
    updated_at = now()
  RETURNING id INTO v_receivable_id;

  RETURN v_receivable_id;
END;
$function$;
