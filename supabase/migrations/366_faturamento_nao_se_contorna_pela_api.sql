-- 366: as checagens de faturamento não se contornam pela API (plano da
-- frente financeira, F-16; revisão das importações, itens 1a e 1b).
--
-- Problema:
--   1. `authenticated` tinha UPDATE em `bls.charge_status` e
--      `bls.billing_hold_reason` (política `bls_update_active_global`): um
--      UPDATE direto tirava o B/L da revisão e da retenção do gate.
--   2. `create_invoice_from_bls_with_ledger` emitia sem as checagens 4 a 8
--      do Emitir; `create_invoice_from_bls` (002) emitia fora do ledger.
--   3. RPCs antigas de importação e de vínculo, sem chamador no front,
--      seguiam executáveis por `authenticated` e gravavam do payload Cliente,
--      status financeiro e revisão, ou vinculavam sem conferir CNPJ:
--      `import_manifest_transactional` (removida da tela pela ADR 0025),
--      `import_bl_freight_with_metadata`, `import_bl_freight_transactional`,
--      `apply_container_dates_atomic`, `apply_customer_base_row_atomic`,
--      `approve_customer_reconciliation` e `reject_customer_reconciliation`.
--
-- Mudança: UPDATE de `bls` por `authenticated` passa a ser por coluna, sem
-- `charge_status` e `billing_hold_reason`; a emissão pela RPC passa por
-- `mark_bl_ready_for_billing`; as RPCs do item 3 e `create_invoice_from_bls`
-- ficam só com `service_role`. As tabelas do lote 0 (354, 355) já nascem só
-- leitura para `authenticated`.
--
-- Pergunta em aberto (plano, "Perguntas ao Lucca", 1 e 2): fechar a escrita
-- direta das demais tabelas de importação; aba aberta de antes do deploy
-- precisa recarregar.
--
-- Não altera nem apaga linhas existentes.

DO $columns_366$
DECLARE v_columns text;
BEGIN
  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position) INTO v_columns
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'bls'
    AND column_name NOT IN ('charge_status', 'billing_hold_reason');
  EXECUTE 'REVOKE UPDATE ON public.bls FROM authenticated';
  EXECUTE format('GRANT UPDATE (%s) ON public.bls TO authenticated', v_columns);
END;
$columns_366$;

DO $revoke_366$
DECLARE v_fn regprocedure;
BEGIN
  FOR v_fn IN
    SELECT p.oid::regprocedure FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname IN ('create_invoice_from_bls', 'import_manifest_transactional', 'import_bl_freight_with_metadata',
        'import_bl_freight_transactional', 'apply_container_dates_atomic', 'apply_customer_base_row_atomic',
        'approve_customer_reconciliation', 'reject_customer_reconciliation')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', v_fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', v_fn);
  END LOOP;
END;
$revoke_366$;

CREATE OR REPLACE FUNCTION public.create_invoice_from_bls_with_ledger(p_bl_ids text[], p_customer_id bigint DEFAULT NULL::bigint, p_notes text DEFAULT NULL::text, p_issue_now boolean DEFAULT true, p_actor uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_result JSONB;
  v_invoice_id BIGINT;
  v_bl TEXT;
BEGIN
  -- O autor é quem está logado (ADR 0085, regra base 2; migration 241).
  PERFORM public._assert_actor_is_caller(p_actor);
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Credenciais invalidas ou sem permissao de faturamento.' USING ERRCODE = '42501';
  END IF;

  -- F-16 (366): as mesmas checagens do Emitir (Revisão, CE, Cliente,
  -- pendências, terminal, linhas faturáveis), B/L por B/L.
  FOREACH v_bl IN ARRAY coalesce(p_bl_ids, ARRAY[]::text[]) LOOP
    PERFORM public.mark_bl_ready_for_billing(v_bl, auth.uid());
  END LOOP;

  v_result := public.create_invoice_from_bls_core(
    p_bl_ids,
    p_customer_id,
    p_notes,
    p_issue_now,
    COALESCE(p_actor, auth.uid()),
    'internal',
    NULL
  );

  v_invoice_id := (v_result->>'invoice_id')::BIGINT;
  IF v_invoice_id IS NULL THEN
    RAISE EXCEPTION 'Falha ao criar invoice para B/Ls.' USING ERRCODE = 'P0001';
  END IF;

  PERFORM public.link_invoice_to_ledger(v_invoice_id);

  RETURN v_result;
END;
$function$;
