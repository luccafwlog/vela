-- 269: dois defeitos da conciliação PIX da PR 954 (revisão de 2026-10-15).
--
-- 1. Itens B24 (migration 264): `confirm_unified_pix_matches` é SECURITY
--    INVOKER e passou a chamar `_demurrage_ptax_from_roe`, cujo EXECUTE a
--    própria 264 revogou de `authenticated`. Na Invoice de Demurrage sem valor
--    na janela das duas PTAX (caminho do valor corrente), o Financeiro recebia
--    "permission denied for function _demurrage_ptax_from_roe" e o lote de
--    confirmações inteiro era desfeito (reproduzido no Postgres local). Os dois
--    helpers são cálculos puros, sem leitura de tabela: o EXECUTE volta a
--    `authenticated`.
-- 2. Item A16 (migration 242): a avulsa passou a ser vinculada pelo plano B do
--    extrato, mas `resolve_pix_reconciliation_exception` (migration 247) só
--    aceitava como prova o `ledger_settlements` de fatura individual ou
--    consolidada. A avulsa baixada por TXID grava `payments`, então a exceção
--    nunca encerrava e o alerta "Pix não conciliado" ficava aberto. A
--    resolução local passa a aceitar também a avulsa com o TXID gravado e o
--    evento `reconciled_by_txid` do mesmo valor.
--
-- Só redefine uma função e devolve dois EXECUTE; não reescreve nem apaga linhas.
-- Rollback: reaplicar a definição da migration 247 e revogar o EXECUTE dos
-- dois helpers.

GRANT EXECUTE ON FUNCTION public._demurrage_roe_markup() TO authenticated;
GRANT EXECUTE ON FUNCTION public._demurrage_ptax_from_roe(numeric) TO authenticated;

CREATE OR REPLACE FUNCTION public.resolve_pix_reconciliation_exception(p_exception_id bigint, p_resolution_source text, p_invoice_id bigint DEFAULT NULL, p_demurrage_invoice_id bigint DEFAULT NULL, p_txid text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_exception public.pix_reconciliation_exceptions%ROWTYPE;
  v_normalized_txid TEXT := public.normalize_pix_txid(p_txid);
  v_authoritative BOOLEAN := false;
  v_paid_date DATE;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_financeiro_user() THEN
    RAISE EXCEPTION 'Credenciais invalidas ou sem permissao para reconciliacao PIX.' USING ERRCODE = '42501';
  END IF;
  IF p_resolution_source NOT IN ('local', 'demurrage') THEN
    RAISE EXCEPTION 'Origem de resolucao PIX invalida.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_exception
  FROM public.pix_reconciliation_exceptions
  WHERE id = p_exception_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Excecao PIX % nao encontrada.', p_exception_id USING ERRCODE = 'P0002';
  END IF;
  IF v_exception.status = 'resolved' THEN
    RETURN jsonb_build_object('id', v_exception.id, 'status', 'resolved');
  END IF;
  IF v_normalized_txid IS DISTINCT FROM v_exception.normalized_txid THEN
    RAISE EXCEPTION 'TXID informado nao corresponde exatamente ao TXID persistido na excecao.' USING ERRCODE = '22023';
  END IF;

  IF p_resolution_source = 'local' THEN
    IF p_invoice_id IS NULL OR p_demurrage_invoice_id IS NOT NULL OR v_normalized_txid = '' THEN
      RAISE EXCEPTION 'Resolucao local exige invoice local e TXID persistido.' USING ERRCODE = '22023';
    END IF;
    SELECT EXISTS (
      SELECT 1
      FROM public.invoices i
      JOIN public.ledger_settlements first_settlement
        ON first_settlement.invoice_id = i.id
       AND first_settlement.source = 'pix_extract'
       AND public.normalize_pix_txid(first_settlement.pix_txid) = v_exception.normalized_txid
      WHERE i.id = p_invoice_id
        AND i.invoice_type IN ('individual', 'consolidated')
        AND ABS((
          SELECT COALESCE(SUM(all_settlements.amount_brl), 0)
          FROM public.ledger_settlements all_settlements
          WHERE all_settlements.payment_id = first_settlement.payment_id
        ) - v_exception.amount_brl) <= 0.01
        AND (
          public.normalize_pix_txid(i.pix_txid) = v_exception.normalized_txid
          OR v_exception.normalized_txid <> ''
        )
    ) OR EXISTS (
      -- Avulsa (migration 242): a baixa por TXID vai por `payments`, nunca por
      -- `ledger_settlements`; a prova é o TXID gravado na fatura e o evento
      -- `reconciled_by_txid` com o mesmo valor da exceção.
      SELECT 1
      FROM public.invoices i
      JOIN public.invoice_lifecycle_events e
        ON e.invoice_id = i.id
       AND e.event_type = 'reconciled_by_txid'
       AND public.normalize_pix_txid(e.payload->>'txid') = v_exception.normalized_txid
      WHERE i.id = p_invoice_id
        AND i.invoice_type = 'manual'
        AND i.conciliated_by_extract = true
        AND public.normalize_pix_txid(i.pix_txid) = v_exception.normalized_txid
        AND ABS(COALESCE((e.payload->>'amount_brl')::numeric, 0) - v_exception.amount_brl) <= 0.01
    ) INTO v_authoritative;
  ELSE
    IF p_demurrage_invoice_id IS NULL OR p_invoice_id IS NOT NULL OR v_exception.paid_at IS NULL THEN
      RAISE EXCEPTION 'Resolucao Demurrage exige invoice e data paga persistida.' USING ERRCODE = '22023';
    END IF;
    v_paid_date := (v_exception.paid_at AT TIME ZONE 'UTC')::DATE;
    SELECT EXISTS (
      SELECT 1
      FROM public.demurrage_invoices d
      WHERE d.id = p_demurrage_invoice_id
        AND d.status = 'paid'
        AND d.conciliated_by_extract = true
        AND d.paid_at = v_paid_date
        AND public.normalize_pix_txid(d.pix_txid) = v_exception.normalized_txid
        AND EXISTS (
          SELECT 1
          FROM public.get_demurrage_recent_values(d.id, v_paid_date) w
          WHERE ABS(w.total_brl - v_exception.amount_brl) <= 0.01
        )
    ) INTO v_authoritative;
  END IF;

  IF NOT v_authoritative THEN
    RAISE EXCEPTION 'Nenhuma baixa/settlement autoritativa corresponde a excecao PIX %.', p_exception_id USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.pix_reconciliation_exceptions
  SET status = 'resolved', resolved_at = now(), resolved_by = auth.uid(),
      resolution_source = p_resolution_source,
      resolved_invoice_id = p_invoice_id,
      resolved_demurrage_invoice_id = p_demurrage_invoice_id,
      updated_at = now()
  WHERE id = v_exception.id;

  PERFORM set_config('alerts.foundation_trigger', 'on', true);
  PERFORM public.resolve_alert_item(
    'pix_unreconciled', 'pix_transaction', v_exception.id::TEXT,
    'pix_reconciliation_authoritative', jsonb_build_object(
      'exception_id', v_exception.id,
      'resolution_source', p_resolution_source,
      'invoice_id', COALESCE(p_invoice_id, p_demurrage_invoice_id),
      'txid', NULLIF(p_txid, '')
    )
  );
  PERFORM set_config('alerts.foundation_trigger', 'off', true);

  RETURN jsonb_build_object('id', v_exception.id, 'status', 'resolved');
END;
$function$;
