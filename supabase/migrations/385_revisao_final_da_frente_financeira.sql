-- 385: revisão final da frente financeira (PR luccafwlog/vela#1019, ADRs 0093
-- e 0094). Correções dos achados da revisão independente antes do merge:
--
--   1. COD de B/L faturado reprecifica com o câmbio fixado; o ramo não
--      faturado com linha manual converte também as linhas em dólar.
--   2. Consolidada cancelada ou obsoleta solta o B/L que ela faturava sem
--      individual; a nova cobrança desse B/L só sai pelo Emitir.
--   5. Cancelar baixa de consolidada substituída a mantém obsoleta.
--   6. Avulsa reemitida na troca de CNPJ não herda o cancelamento.
--   7. Pix já baixado pelo extrato não volta como duplicidade.
--   8. Cobrança Itaú da Invoice de Demurrage com ROE manual.
--   9-11. Pix sem TXID fecha pela baixa manual; QR estático da avulsa.
--   12-14. Tirar ROE manual; textos do Pix sem TXID; leitura das falhas.
--   15. B/L cancelado: exceção do chassi só no arquivo de B/L.
--   16-17. Refixar só pelo sistema; falha de cálculo recusa no CE da ficha,
--      na reativação e na aprovação da conciliação.
--   18-20. Lançamento manual pela tabela vinculada e preço fixado; nome do
--      item não é correção; correção de Condição alcança quem a usou.
--   21. B/L não faturado recalcula na emissão (backfill da 378).
--   22. Cancelar baixa devolve o papel anterior.
--
-- Os itens 20 e 21 regravam linhas existentes e dependem da afirmação
-- "Data status" do AGENTS.md (seção Gotchas): os dados de produção são de teste.


-- 1. COD (ADR 0094, A1/A4): o B/L faturado reprecifica o destino com o
-- câmbio fixado, não com o do dia; e o ramo não faturado com linha manual
-- converte as linhas em dólar também no total novo.
CREATE OR REPLACE FUNCTION public.apply_cod_financial_effect_legacy_130(p_bl_id text, p_omission_id bigint, p_previous_pod text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor UUID := auth.uid();
  v_bl RECORD;
  v_invoice_id BIGINT;
  v_invoice_snapshot_total NUMERIC(14,2) := 0;
  v_invoice_snapshot_count INTEGER := 0;
  v_previous_adjustment_total NUMERIC(14,2) := 0;
  v_previous_adjustment_count INTEGER := 0;
  v_original_total NUMERIC(14,2) := 0;
  v_new_total NUMERIC(14,2) := 0;
  v_manual_total NUMERIC(14,2) := 0;
  v_paid_amount NUMERIC(14,2) := 0;
  v_outstanding NUMERIC(14,2) := 0;
  v_difference NUMERIC(14,2) := 0;
  v_offset_amount NUMERIC(14,2) := 0;
  v_refund_amount NUMERIC(14,2) := 0;
  v_action TEXT;
  v_manual_review BOOLEAN := false;
  v_has_manual_lines BOOLEAN := false;
  v_roe NUMERIC(10,4);
  v_roe_effective_date DATE;
BEGIN
  IF v_actor IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa.' USING ERRCODE = '42501';
  END IF;

  SELECT b.id, b.pod, b.financial_status
  INTO v_bl
  FROM public.bls AS b
  WHERE b.id = p_bl_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L % nao encontrado', p_bl_id USING ERRCODE = 'P0002';
  END IF;

  -- ADR 0094: o COD muda a tabela (POD novo), não o câmbio fixado.
  SELECT r.roe, r.effective_date
  INTO v_roe, v_roe_effective_date
  FROM public._bl_fixed_roe(p_bl_id) r;

  IF v_roe IS NULL AND EXISTS (
    SELECT 1
    FROM public.charge_calculations AS cc
    WHERE cc.bl_id = p_bl_id
      AND COALESCE(cc.total_value_usd, 0) > 0
  ) THEN
    RAISE EXCEPTION 'Cambio (ROE) nao configurado; nao e possivel calcular linhas em USD.'
      USING ERRCODE = '22023';
  END IF;

  SELECT
    COALESCE(SUM(COALESCE(cc.total_value_brl,
      CASE WHEN COALESCE(cc.total_value_usd, 0) > 0
        THEN ROUND(cc.total_value_usd * v_roe, 2)
      END,
      0)), 0),
    BOOL_OR(COALESCE(cc.source, 'auto') = 'manual')
  INTO v_original_total, v_has_manual_lines
  FROM public.charge_calculations AS cc
  WHERE cc.bl_id = p_bl_id;

  v_original_total := ROUND(COALESCE(v_original_total, 0), 2);
  v_has_manual_lines := COALESCE(v_has_manual_lines, false);

  SELECT COALESCE(SUM(COALESCE(cc.total_value_brl,
    CASE WHEN COALESCE(cc.total_value_usd, 0) > 0
      THEN ROUND(cc.total_value_usd * v_roe, 2)
    END,
    0)), 0)
  INTO v_manual_total
  FROM public.charge_calculations AS cc
  WHERE cc.bl_id = p_bl_id
    AND COALESCE(cc.source, 'auto') = 'manual';
  v_manual_total := ROUND(COALESCE(v_manual_total, 0), 2);

  -- Pending/non-invoiced B/Ls use the existing writing calculator. Manual
  -- rows are source = manual, so calculate_bl_local_charges deletes only auto
  -- rows and preserves their operator-entered intent.
  IF COALESCE(v_bl.financial_status, 'pending') NOT IN ('invoiced', 'partially_paid', 'paid') THEN
    PERFORM public.calculate_bl_local_charges(
      p_bl_id => p_bl_id,
      p_actor => v_actor,
      p_recalculate => true
    );

    IF v_has_manual_lines THEN
      SELECT COALESCE(SUM(COALESCE(cc.total_value_brl,
        CASE WHEN COALESCE(cc.total_value_usd, 0) > 0 THEN ROUND(cc.total_value_usd * v_roe, 2) END, 0)), 0)
      INTO v_new_total
      FROM public.charge_calculations AS cc
      WHERE cc.bl_id = p_bl_id;
      v_new_total := ROUND(COALESCE(v_new_total, 0), 2);
      v_difference := ROUND(v_new_total - v_original_total, 2);
      v_action := 'manual_charge_review';
      v_manual_review := true;
    ELSE
      RETURN;
    END IF;
  ELSE
    -- Billed states must never call the writing calculator: it intentionally
    -- rejects these states. The 311 helper is the single price-resolution
    -- source for both the previous and already-updated destination PODs.
    -- A ponta nova é uma prévia do destino atual. Linhas em USD precisam do
    -- ROE autoritativo do evento; total_value_brl é nulo nessas linhas.
    SELECT r.roe, r.effective_date
    INTO v_roe, v_roe_effective_date
    FROM public._bl_fixed_roe(p_bl_id) r;

    IF v_roe IS NULL AND EXISTS (
      SELECT 1
      FROM public.resolve_bl_local_charge_items(p_bl_id, v_bl.pod) AS item
      WHERE COALESCE(item.total_value_usd, 0) > 0
    ) THEN
      RAISE EXCEPTION 'Cambio (ROE) nao configurado; nao e possivel reprecificar linhas em USD.'
        USING ERRCODE = '22023';
    END IF;

    SELECT COALESCE(SUM(
      COALESCE(item.total_value_brl,
        CASE WHEN COALESCE(item.total_value_usd, 0) > 0
          THEN ROUND(item.total_value_usd * v_roe, 2)
        END,
        0)
    ), 0)
    INTO v_new_total
    FROM public.resolve_bl_local_charge_items(p_bl_id, v_bl.pod) AS item;
    v_new_total := ROUND(COALESCE(v_new_total, 0) + v_manual_total, 2);

    -- A ponta original não é a tabela vigente do POD antigo. O documento que
    -- efetivamente faturou o B/L (invoice_bls, inclusive consolidadas) é o
    -- snapshot monetário; invoice_items/invoices são fallbacks legados.
    SELECT i.id
    INTO v_invoice_id
    FROM public.invoices AS i
    WHERE COALESCE(i.status, 'issued') NOT IN ('cancelled', 'obsolete', 'covered')
      AND (i.bl_id = p_bl_id OR EXISTS (
        SELECT 1 FROM public.invoice_bls AS ib
        WHERE ib.invoice_id = i.id AND ib.bl_id = p_bl_id
      ))
    ORDER BY i.issued_at DESC NULLS LAST, i.id DESC
    LIMIT 1;

    IF v_invoice_id IS NOT NULL THEN
      SELECT COALESCE(SUM(ib.subtotal_brl), 0), COUNT(*)
      INTO v_invoice_snapshot_total, v_invoice_snapshot_count
      FROM public.invoice_bls AS ib
      WHERE ib.invoice_id = v_invoice_id AND ib.bl_id = p_bl_id;

      IF v_invoice_snapshot_count = 0 THEN
        SELECT COALESCE(SUM(COALESCE(
          ii.total_value_brl,
          CASE WHEN COALESCE(ii.total_value_usd, 0) > 0
            THEN ROUND(ii.total_value_usd * NULLIF(ii.snapshot_payload->>'roe', '')::NUMERIC, 2)
          END,
          0
        )), 0), COUNT(*)
        INTO v_invoice_snapshot_total, v_invoice_snapshot_count
        FROM public.invoice_items AS ii
        WHERE ii.invoice_id = v_invoice_id AND ii.bl_id = p_bl_id;
      END IF;

      IF v_invoice_snapshot_count = 0 THEN
        SELECT COALESCE(i.total_brl, 0), 1
        INTO v_invoice_snapshot_total, v_invoice_snapshot_count
        FROM public.invoices AS i
        WHERE i.id = v_invoice_id;
      END IF;
    END IF;

    -- F-18 (368): B/L coberto por consolidada paga (a individual saiu da
    -- busca por estar coberta): o documento é a consolidada, pelo vínculo.
    IF v_invoice_snapshot_count = 0 THEN
      SELECT coalesce(sum(l.subtotal_brl), 0), count(*)
      INTO v_invoice_snapshot_total, v_invoice_snapshot_count
      FROM public.invoice_receivable_links AS l
      WHERE l.bl_id = p_bl_id AND l.status IN ('active', 'settled_by_this_invoice')
        AND l.invoice_id = (
          SELECT i.id FROM public.invoice_receivable_links AS l2 JOIN public.invoices AS i ON i.id = l2.invoice_id
          WHERE l2.bl_id = p_bl_id AND l2.status IN ('active', 'settled_by_this_invoice')
            AND coalesce(i.status, 'issued') NOT IN ('cancelled', 'obsolete', 'covered')
          ORDER BY i.issued_at DESC NULLS LAST, i.id DESC LIMIT 1);
    END IF;

    IF v_invoice_snapshot_count = 0 THEN
      RAISE EXCEPTION 'Nao foi encontrado snapshot da fatura do B/L %.', p_bl_id
        USING ERRCODE = 'P0002';
    END IF;
    v_original_total := ROUND(COALESCE(v_invoice_snapshot_total, 0), 2);

    -- Em uma reversão COD → transbordo (ou nova ida ao COD), a comparação é
    -- contra o último destino efetivamente registrado, para que cada
    -- transição gere seu próprio evento mesmo quando o snapshot original da
    -- invoice permanece imutável.
    SELECT new_destination_value_brl, 1
    INTO v_previous_adjustment_total, v_previous_adjustment_count
    FROM public.cod_adjustments
    WHERE bl_id = p_bl_id AND omission_id = p_omission_id
    ORDER BY id DESC
    LIMIT 1;
    IF v_previous_adjustment_count > 0 THEN
      v_original_total := ROUND(v_previous_adjustment_total, 2);
    END IF;

    SELECT COALESCE(SUM(
      CASE
        WHEN ib.invoice_id IS NOT NULL
          AND COALESCE(i.total_brl, 0) > 0
          AND EXISTS (
            SELECT 1
            FROM public.invoice_bls AS ib_other
            WHERE ib_other.invoice_id = i.id
              AND ib_other.bl_id <> p_bl_id
          )
        THEN p.amount_brl * COALESCE(ib.subtotal_brl, 0) / i.total_brl
        ELSE p.amount_brl
      END
    ), 0)
    INTO v_paid_amount
    FROM public.payments AS p
    JOIN public.invoices AS i ON i.id = p.invoice_id
    LEFT JOIN public.invoice_bls AS ib
      ON ib.invoice_id = i.id AND ib.bl_id = p_bl_id
    WHERE COALESCE(i.status, 'issued') <> 'cancelled'
      AND (i.bl_id = p_bl_id OR ib.bl_id = p_bl_id);
    v_paid_amount := ROUND(GREATEST(COALESCE(v_paid_amount, 0), 0), 2);
    IF v_paid_amount = 0 THEN
      SELECT COALESCE(SUM(COALESCE(i.total_paid_brl, 0)), 0)
      INTO v_paid_amount
      FROM public.invoices AS i
      WHERE i.bl_id = p_bl_id
        AND COALESCE(i.status, 'issued') <> 'cancelled';
      v_paid_amount := ROUND(GREATEST(COALESCE(v_paid_amount, 0), 0), 2);
    END IF;
    -- F-18 (368): o pago pela consolidada está no recebível do B/L.
    SELECT greatest(v_paid_amount, coalesce(max(r.settled_amount_brl), 0)) INTO v_paid_amount
    FROM public.bl_receivables AS r WHERE r.bl_id = p_bl_id AND r.source = 'local_charges';
    v_paid_amount := ROUND(v_paid_amount, 2);
    v_outstanding := ROUND(GREATEST(v_original_total - v_paid_amount, 0), 2);
    v_difference := ROUND(v_new_total - v_original_total, 2);

    -- F-41 (368): sem diferença não há ajuste (antes, a fatura sem pagamento
    -- ganhava um "Cancelar e reemitir" que nunca se liquidava).
    IF v_difference = 0 THEN
      RETURN;
    END IF;

    -- An unpaid invoice is the only cancel/reissue branch. A B/L remains
    -- financial_status = invoiced while its invoice is partially paid, so
    -- payment money—not only the coarse B/L status—selects the next branch.
    IF v_paid_amount = 0 THEN
      v_action := 'cancel_and_reissue';
      v_manual_review := true;
    ELSIF v_difference > 0 THEN
      v_action := 'complementary_invoice';
    ELSIF v_difference < 0 THEN
      v_offset_amount := ROUND(LEAST(ABS(v_difference), v_outstanding), 2);
      v_refund_amount := ROUND(GREATEST(ABS(v_difference) - v_outstanding, 0), 2);
      v_action := CASE
        WHEN v_refund_amount > 0 THEN 'refund_overpayment'
        ELSE 'offset_open_balance'
      END;
    ELSE
      RETURN;
    END IF;
  END IF;

  INSERT INTO public.cod_adjustments (
    bl_id,
    omission_id,
    original_value_brl,
    new_destination_value_brl,
    difference_brl,
    paid_amount_brl,
    outstanding_balance_brl,
    offset_amount_brl,
    refund_amount_brl,
    action,
    status,
    manual_review_required,
    resulting_document_id,
    resulting_document_type,
    created_by
  )
  VALUES (
    p_bl_id,
    p_omission_id,
    ROUND(v_original_total, 2),
    ROUND(v_new_total, 2),
    ROUND(v_difference, 2),
    ROUND(v_paid_amount, 2),
    ROUND(v_outstanding, 2),
    ROUND(v_offset_amount, 2),
    ROUND(v_refund_amount, 2),
    v_action,
    'pending',
    v_manual_review,
    NULL,
    NULL,
    v_actor
  )
  ;
END;
$function$;

-- 2. Consolidada que faturou B/L sem individual (ADR 0093, decisão 9) e foi
-- cancelada ou ficou obsoleta: o B/L volta a "não faturado" quando nenhum
-- documento vivo o cobre (decisão 12). Gatilho adiado para o fim da
-- transação: a reprojeção (356) e a correção (381) obsoletam e recriam a
-- consolidada na mesma transação, e o B/L que a sucessora cobre fica.
CREATE OR REPLACE FUNCTION public.release_bls_of_closed_consolidated()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  UPDATE public.bls b SET financial_status = 'pending'
  WHERE b.id IN (SELECT l.bl_id FROM public.invoice_receivable_links l WHERE l.invoice_id = NEW.id)
    AND coalesce(b.financial_status, 'pending') = 'invoiced'
    AND NOT EXISTS (
      SELECT 1 FROM public.invoice_bls ib JOIN public.invoices i ON i.id = ib.invoice_id
      WHERE ib.bl_id = b.id AND coalesce(i.status, 'issued') NOT IN ('cancelled', 'obsolete'))
    AND NOT EXISTS (
      SELECT 1 FROM public.invoice_receivable_links l2 JOIN public.invoices i2 ON i2.id = l2.invoice_id
      WHERE l2.bl_id = b.id AND i2.id <> NEW.id AND l2.status <> 'obsolete'
        AND coalesce(i2.status, 'issued') NOT IN ('cancelled', 'obsolete'))
    AND NOT EXISTS (
      SELECT 1 FROM public.bl_receivables r WHERE r.bl_id = b.id AND coalesce(r.settled_amount_brl, 0) > 0);
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public.release_bls_of_closed_consolidated() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_release_bls_of_closed_consolidated ON public.invoices;
CREATE CONSTRAINT TRIGGER trg_release_bls_of_closed_consolidated
  AFTER UPDATE OF status ON public.invoices
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  WHEN (NEW.invoice_type = 'consolidated' AND NEW.status IN ('cancelled', 'obsolete')
        AND OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.release_bls_of_closed_consolidated();

-- O B/L cuja cobrança era a consolidada cancelada pela pessoa também só volta
-- a ser faturado pelo Emitir (decisão 12).
CREATE OR REPLACE FUNCTION public._auto_bill_bl_core(p_bl_id text, p_actor uuid, p_reuse_calculation boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bl public.bls%ROWTYPE;
  v_actor uuid := COALESCE(p_actor, auth.uid());
  v_calculation jsonb;
  v_ready jsonb;
  v_invoice jsonb;
  v_existing_invoice_id bigint;
  v_previous_context_table text := current_setting('vela.billing_context_table', true);
  v_previous_request_sub text := current_setting('request.jwt.claim.sub', true);
  v_context_table text := format('vela_auto_billing_%s', replace(gen_random_uuid()::text, '-', ''));
  v_impersonated boolean := false;
  v_context_created boolean := false;
  v_sqlstate text;
  v_error_message text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND (v_actor IS NULL OR v_actor IS DISTINCT FROM auth.uid() OR NOT public.is_active_user()) THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa para faturamento automatico.' USING ERRCODE = '42501';
  END IF;

  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Faturamento automatico sem ator validado.' USING ERRCODE = '42501';
  END IF;

  SELECT *
    INTO v_bl
  FROM public.bls
  WHERE id = p_bl_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'status', 'blocked',
      'reason', 'bl_not_found',
      'bl_id', p_bl_id
    );
  END IF;

  -- Repetir o save/import não pode criar uma segunda invoice. O status do B/L
  -- é a guarda rápida; o link ativo cobre estados antigos parcialmente gravados.
  IF COALESCE(v_bl.financial_status, 'pending') <> 'pending' THEN
    RETURN jsonb_build_object(
      'status', 'already_invoiced',
      'idempotent', true,
      'bl_id', v_bl.id,
      'financial_status', v_bl.financial_status
    );
  END IF;

  SELECT inv.id
    INTO v_existing_invoice_id
  FROM public.invoice_bls AS ib
  JOIN public.invoices AS inv ON inv.id = ib.invoice_id
  WHERE ib.bl_id = v_bl.id
    AND COALESCE(inv.status, 'issued') IN ('draft', 'issued', 'partially_paid', 'overdue')
  ORDER BY inv.id DESC
  LIMIT 1;

  IF v_existing_invoice_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'status', 'already_invoiced',
      'idempotent', true,
      'bl_id', v_bl.id,
      'invoice_id', v_existing_invoice_id
    );
  END IF;

  -- ADR 0093, decisão 12 (362): fatura cancelada pela pessoa solta o B/L; a
  -- nova sai só pelo Emitir, nunca sozinha (Liberação, ativação do Portal, CE,
  -- planilha de CE, vínculo de Cliente, reprocessamento de efeito). A
  -- reemissão automática da correção (cancelada com `reissue_requested_at`)
  -- continua.
  IF EXISTS (
    SELECT 1 FROM (
      SELECT inv.status, inv.reissue_requested_at
      FROM public.invoices AS inv
      WHERE (inv.invoice_type = 'individual'
             AND EXISTS (SELECT 1 FROM public.invoice_bls AS ib WHERE ib.invoice_id = inv.id AND ib.bl_id = v_bl.id))
         OR (inv.invoice_type = 'consolidated'
             AND EXISTS (SELECT 1 FROM public.invoice_receivable_links AS l WHERE l.invoice_id = inv.id AND l.bl_id = v_bl.id)
             AND NOT EXISTS (SELECT 1 FROM public.invoice_bls AS ib2 WHERE ib2.bl_id = v_bl.id))
      ORDER BY inv.id DESC LIMIT 1) AS last_invoice
    WHERE last_invoice.status = 'cancelled' AND last_invoice.reissue_requested_at IS NULL
  ) THEN
    RETURN jsonb_build_object(
      'status', 'skipped',
      'reason', 'invoice_cancelled_awaiting_emitir',
      'bl_id', v_bl.id
    );
  END IF;

  IF NULLIF(btrim(COALESCE(v_bl.ce_mercante, '')), '') IS NULL THEN
    RETURN jsonb_build_object(
      'status', 'blocked',
      'reason', 'ce_mercante_missing',
      'bl_id', v_bl.id
    );
  END IF;

  IF v_bl.customer_id IS NULL
     OR COALESCE(v_bl.customer_reconciliation_status, 'missing_customer') NOT IN ('matched_document', 'reconciled') THEN
    RETURN jsonb_build_object(
      'status', 'blocked',
      'reason', 'customer_reconciliation_pending',
      'bl_id', v_bl.id,
      'customer_id', v_bl.customer_id,
      'customer_reconciliation_status', v_bl.customer_reconciliation_status
    );
  END IF;

  -- O worker carrega o iniciador no GUC antes de chamar esta função. Em uma
  -- chamada server-side direta, o ator explícito recebe o mesmo tratamento.
  -- Só altere a identidade depois das saídas idempotentes acima e restaure-a
  -- em qualquer caminho, para não vazar o ator para o restante da sessão.
  IF auth.uid() IS DISTINCT FROM v_actor THEN
    PERFORM set_config('request.jwt.claim.sub', v_actor::text, true);
    v_impersonated := true;
  END IF;

  IF NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Ator inativo para faturamento automatico.' USING ERRCODE = '42501';
  END IF;

  -- O marcador é uma tabela temporária criada sob o owner do SECURITY
  -- DEFINER. O GUC só carrega o nome da tabela e é limpo antes de retornar.
  EXECUTE format(
    'CREATE TEMP TABLE pg_temp.%I (marker boolean NOT NULL) ON COMMIT DROP',
    v_context_table
  );
  v_context_created := true;
  EXECUTE format(
    'INSERT INTO pg_temp.%I(marker) VALUES (true)',
    v_context_table
  );
  PERFORM set_config('vela.billing_context_table', v_context_table, true);

  -- Taxas do dia do CE (decisão de 2026-09-24): ao abrir o gate, a fatura
  -- retida sai com o cálculo que a transição do CE já gravou. Só calcula
  -- quando o B/L nunca teve cálculo (não há cálculo do dia do CE a manter).
  -- `review_required` também é mantido: recalcular apagaria a revisão feita,
  -- e `mark_bl_ready_for_billing` recusa o B/L até a revisão terminar.
  -- ADR 0093, decisão 3: só o preço fica do dia do CE. Se a base mudou desde
  -- o cálculo (ficha, containers, irmão que chegou ou saiu), recalcula com o
  -- preço congelado.
  IF p_reuse_calculation
     AND v_bl.charge_status IN ('calculated', 'reviewed', 'ready_for_billing', 'review_required', 'exempt')
     AND public.bl_calculation_is_current(v_bl.id) THEN
    v_calculation := jsonb_build_object('bl_id', v_bl.id, 'status', v_bl.charge_status, 'reused', true);
  ELSE
    -- 385: a falha de cálculo sai marcada; o gatilho do CE a recusa (B3).
    BEGIN
      v_calculation := public.calculate_bl_local_charges(v_bl.id, v_actor, true);
    EXCEPTION WHEN OTHERS THEN
      PERFORM public._raise_local_charge_failure(v_bl.id, SQLSTATE, SQLERRM);
    END;
  END IF;

  -- Isenção legítima não possui linha positiva para uma invoice. O CE foi
  -- processado corretamente, mas não há documento financeiro a emitir.
  IF v_calculation->>'status' = 'exempt' THEN
    EXECUTE format('DROP TABLE IF EXISTS pg_temp.%I', v_context_table);
    v_context_created := false;
    PERFORM set_config('vela.billing_context_table', COALESCE(v_previous_context_table, ''), true);
    IF v_impersonated THEN
      PERFORM set_config('request.jwt.claim.sub', COALESCE(v_previous_request_sub, ''), true);
    END IF;
    RETURN v_calculation || jsonb_build_object('status', 'skipped', 'reason', 'exempt');
  END IF;

  -- Trava universal do Portal (ADR 0070): sem Portal pronto e sem Liberação
  -- de faturamento vigente, o CE calcula mas não emite. A retenção fica no
  -- B/L e sai pela ativação do Portal ou pela concessão da Liberação, que
  -- reprocessam o Cliente. Não é falha: a fila de efeitos não é acionada.
  IF NOT public.customer_billing_access_ready(v_bl.customer_id) THEN
    EXECUTE format('DROP TABLE IF EXISTS pg_temp.%I', v_context_table);
    v_context_created := false;
    PERFORM set_config('vela.billing_context_table', COALESCE(v_previous_context_table, ''), true);
    UPDATE public.bls
       SET billing_hold_reason = COALESCE(NULLIF(btrim(billing_hold_reason), ''), 'Acesso ao portal nao provisionado')
     WHERE id = v_bl.id;
    PERFORM public.reconcile_customer_bl_review_alerts(v_bl.customer_id, NULL, 'portal_billing_hold');
    IF v_impersonated THEN
      PERFORM set_config('request.jwt.claim.sub', COALESCE(v_previous_request_sub, ''), true);
    END IF;
    RETURN jsonb_build_object(
      'status', 'held',
      'reason', 'portal_not_provisioned',
      'bl_id', v_bl.id,
      'customer_id', v_bl.customer_id,
      'calculation', v_calculation
    );
  END IF;

  v_ready := public.mark_bl_ready_for_billing(v_bl.id, v_actor);
  v_invoice := public.create_invoice_from_bls_core(
    ARRAY[v_bl.id],
    v_bl.customer_id,
    'Sistema — CE Mercante: fatura automática após o registro do CE.',
    true,
    v_actor,
    'internal',
    NULL
  );

  IF NULLIF(v_invoice->>'invoice_id', '') IS NULL THEN
    RAISE EXCEPTION 'Emissao automatica nao retornou invoice para o B/L %.', v_bl.id
      USING ERRCODE = 'P0001';
  END IF;

  EXECUTE format('DROP TABLE IF EXISTS pg_temp.%I', v_context_table);
  v_context_created := false;
  PERFORM set_config('vela.billing_context_table', COALESCE(v_previous_context_table, ''), true);
  PERFORM public.link_invoice_to_ledger((v_invoice->>'invoice_id')::bigint);

  IF v_impersonated THEN
    PERFORM set_config('request.jwt.claim.sub', COALESCE(v_previous_request_sub, ''), true);
  END IF;

  RETURN jsonb_build_object(
    'status', 'invoiced',
    'idempotent', false,
    'bl_id', v_bl.id,
    'calculation', v_calculation,
    'ready', v_ready,
    'invoice', v_invoice
  );
EXCEPTION
  WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS
      v_sqlstate = RETURNED_SQLSTATE,
      v_error_message = MESSAGE_TEXT;
    IF v_context_created THEN
      EXECUTE format('DROP TABLE IF EXISTS pg_temp.%I', v_context_table);
      v_context_created := false;
    END IF;
    PERFORM set_config('vela.billing_context_table', COALESCE(v_previous_context_table, ''), true);
    IF v_impersonated THEN
      PERFORM set_config('request.jwt.claim.sub', COALESCE(v_previous_request_sub, ''), true);
    END IF;

    -- A atualização documental não é desfeita porque o efeito recuperável
    -- será criado pelo trigger. O worker registrará o bloqueio com o erro
    -- original e poderá ser reprocessado depois da correção operacional.
    RETURN jsonb_build_object(
      'status', 'blocked',
      'reason', 'auto_billing_failed',
      'bl_id', p_bl_id,
      'sqlstate', v_sqlstate,
      'message', left(regexp_replace(COALESCE(v_error_message, ''), '[[:cntrl:]]', ' ', 'g'), 1000)
    );
END;
$function$;

-- 5. Cancelar a baixa de consolidada já substituída (ADR 0093, decisões 6 a
-- 8): ela continua obsoleta (a sucessora é que cobra), seus vínculos não
-- voltam a ativos, e o saldo dos documentos vivos dos mesmos recebíveis
-- acompanha o valor que voltou a ser devido.
CREATE OR REPLACE FUNCTION public._reverse_invoice_payment_impl_109(p_payment_id bigint, p_reason text DEFAULT NULL::text, p_actor uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_payment RECORD;
  v_invoice RECORD;
  v_settlement RECORD;
  v_unsettled_invoice_ids BIGINT[];
  v_total_paid NUMERIC(14,2);
  v_balance NUMERIC(14,2);
  v_actor UUID;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Credenciais invalidas ou sem permissao.' USING ERRCODE = '42501';
  END IF;

  -- Justificativa obrigatoria para cancelar a baixa.
  IF NULLIF(TRIM(COALESCE(p_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Informe a justificativa para cancelar a baixa.' USING ERRCODE = '22023';
  END IF;

  v_actor := COALESCE(p_actor, auth.uid());

  SELECT * INTO v_payment
  FROM public.payments
  WHERE id = p_payment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pagamento % nao encontrado.', p_payment_id USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_invoice
  FROM public.invoices
  WHERE id = v_payment.invoice_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice % nao encontrada.', v_payment.invoice_id USING ERRCODE = 'P0002';
  END IF;

  -- Reverte cada settlement, restaurando o receivable
  FOR v_settlement IN
    SELECT * FROM public.ledger_settlements
    WHERE payment_id = p_payment_id
    ORDER BY id
  LOOP
    UPDATE public.bl_receivables
    SET
      settled_amount_brl = GREATEST(COALESCE(settled_amount_brl, 0) - v_settlement.amount_brl, 0),
      balance_brl = COALESCE(balance_brl, 0) + v_settlement.amount_brl,
      status = CASE
        WHEN GREATEST(COALESCE(balance_brl, 0) + v_settlement.amount_brl, 0) >= original_amount_brl THEN 'open'
        ELSE 'partially_settled'
      END,
      updated_at = now()
    WHERE id = v_settlement.receivable_id;
  END LOOP;

  DELETE FROM public.ledger_settlements WHERE payment_id = p_payment_id;

  -- Restaura invoice_receivable_links que foram afetados por este pagamento
  UPDATE public.invoice_receivable_links irl
  SET status = 'active'
  WHERE irl.invoice_id = v_payment.invoice_id
    AND irl.status = 'settled_by_this_invoice'
    AND COALESCE(v_invoice.status, '') <> 'obsolete'
    AND EXISTS (
      SELECT 1 FROM public.bl_receivables br
      WHERE br.id = irl.receivable_id
        AND br.balance_brl > 0
    );

  -- Recalcula totais da invoice
  SELECT COALESCE(SUM(COALESCE(balance_brl, 0)), 0)
  INTO v_balance
  FROM public.bl_receivables
  WHERE id IN (
    SELECT receivable_id FROM public.invoice_receivable_links
    WHERE invoice_id = v_payment.invoice_id
  );

  SELECT COALESCE(SUM(amount_brl), 0)
  INTO v_total_paid
  FROM public.payments
  WHERE invoice_id = v_payment.invoice_id
    AND id <> p_payment_id;

  UPDATE public.invoices
  SET
    total_paid_brl = v_total_paid,
    balance_brl = CASE WHEN COALESCE(v_invoice.status, '') = 'obsolete' THEN 0 ELSE GREATEST(v_balance, 0) END,
    -- Libera o TXID conciliado para que o mesmo PIX possa ser reconciliado de novo.
    pix_txid = NULL,
    conciliated_by_extract = false,
    status = CASE
      WHEN COALESCE(v_invoice.status, '') = 'covered' THEN 'covered'
      WHEN COALESCE(v_invoice.status, '') = 'obsolete' THEN 'obsolete'
      WHEN v_total_paid <= 0 AND GREATEST(v_balance, 0) >= (SELECT COALESCE(SUM(original_amount_brl), 0) FROM public.bl_receivables WHERE id IN (SELECT receivable_id FROM public.invoice_receivable_links WHERE invoice_id = v_payment.invoice_id)) THEN 'issued'
      WHEN v_total_paid <= 0 THEN 'issued'
      WHEN GREATEST(v_balance, 0) <= 0 THEN 'paid'
      ELSE 'partially_paid'
    END
  WHERE id = v_payment.invoice_id;

  -- F-04 (migration 356): desfaz só o que este documento causou.
  IF COALESCE(v_invoice.status, '') IN ('paid', 'partially_paid') THEN
    -- Individuais cobertas por esta fatura: só os vínculos delas.
    UPDATE public.invoice_receivable_links irl
    SET status = 'active'
    WHERE irl.status = 'settled_elsewhere'
      AND irl.invoice_id IN (SELECT ind.id FROM public.invoices ind
                             WHERE ind.covered_by_invoice_id = v_payment.invoice_id AND ind.status = 'covered')
      AND EXISTS (SELECT 1 FROM public.bl_receivables br WHERE br.id = irl.receivable_id AND br.balance_brl > 0);
    UPDATE public.invoices ind
    SET status = 'issued', covered_by_invoice_id = NULL
    WHERE ind.covered_by_invoice_id = v_payment.invoice_id
      AND ind.status = 'covered'
      AND EXISTS (SELECT 1 FROM public.invoice_receivable_links l WHERE l.invoice_id = ind.id AND l.status = 'active');

    -- Consolidada obsoletada por este pagamento, sem sucessora e sem B/L em
    -- outra consolidada aberta.
    FOR v_settlement IN
      SELECT DISTINCT c.id
      FROM public.invoice_lifecycle_events e
      JOIN public.invoices c ON c.id = e.invoice_id
      WHERE e.event_type = 'obsolete'
        AND e.payload->>'paid_invoice_id' = v_payment.invoice_id::text
        AND c.status = 'obsolete'
        AND NOT EXISTS (SELECT 1 FROM public.invoices s WHERE s.replaces_invoice_id = c.id)
    LOOP
      IF NOT EXISTS (
        SELECT 1 FROM public.invoice_receivable_links l
        JOIN public.invoice_receivable_links l2 ON l2.receivable_id = l.receivable_id AND l2.status = 'active'
        JOIN public.invoices o ON o.id = l2.invoice_id
        WHERE l.invoice_id = v_settlement.id AND o.id <> v_settlement.id
          AND o.invoice_type = 'consolidated' AND coalesce(o.status, 'issued') IN ('draft', 'issued', 'partially_paid')
      ) THEN
        UPDATE public.invoices SET status = 'issued', obsolete_reason = NULL WHERE id = v_settlement.id;
        UPDATE public.invoice_receivable_links SET status = 'active'
         WHERE invoice_id = v_settlement.id AND status = 'obsolete';
      END IF;
    END LOOP;
  END IF;

  -- 385: documentos vivos dos mesmos recebíveis mostram o saldo que voltou.
  UPDATE public.invoices i SET balance_brl = s.balance
  FROM (
    SELECT l.invoice_id, COALESCE(SUM(r.balance_brl), 0) AS balance
    FROM public.invoice_receivable_links l JOIN public.bl_receivables r ON r.id = l.receivable_id
    WHERE l.status = 'active'
      AND l.invoice_id IN (
        SELECT l2.invoice_id FROM public.invoice_receivable_links l2
        WHERE l2.receivable_id IN (SELECT receivable_id FROM public.invoice_receivable_links WHERE invoice_id = v_payment.invoice_id)
          AND l2.invoice_id <> v_payment.invoice_id)
    GROUP BY l.invoice_id
  ) s
  WHERE i.id = s.invoice_id
    AND i.invoice_type IN ('individual', 'consolidated')
    AND COALESCE(i.status, 'issued') IN ('issued', 'partially_paid', 'overdue')
    AND i.balance_brl IS DISTINCT FROM s.balance;

  -- Atualiza financial_status dos BLs vinculados.
  -- bls.financial_status so aceita 'pending','invoiced','paid','cancelled'
  -- (constraint bls_financial_status_check). Ao cancelar a baixa, o BL volta a
  -- 'invoiced' quando ainda ha saldo, ou 'paid' se tudo continua liquidado.
  UPDATE public.bls b
  SET financial_status = (
    SELECT CASE
      WHEN COUNT(*) FILTER (WHERE br.balance_brl > 0) = 0 THEN 'paid'
      ELSE 'invoiced'
    END
    FROM public.bl_receivables br
    WHERE br.bl_id = b.id
  )
  WHERE b.id IN (
    SELECT br.bl_id FROM public.bl_receivables br
    WHERE br.id IN (
      SELECT receivable_id FROM public.invoice_receivable_links
      WHERE invoice_id = v_payment.invoice_id
    )
  );

  INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification)
  VALUES (
    'invoice', v_payment.invoice_id::TEXT, 'payment_reversed',
    COALESCE(v_invoice.status, '?') || ' total_paid=' || COALESCE(v_invoice.total_paid_brl::TEXT, '?'),
    (SELECT COALESCE(status, '?') || ' total_paid=' || COALESCE(total_paid_brl::TEXT, '?') FROM public.invoices WHERE id = v_payment.invoice_id),
    v_actor, now(),
    TRIM(p_reason)
  );

  DELETE FROM public.payments WHERE id = p_payment_id;

  -- Saldos das demais faturas ligadas voltam com o recebível (decisão 6).
  PERFORM public._reproject_invoices_for_receivables(v_payment.invoice_id,
    ARRAY(SELECT receivable_id FROM public.invoice_receivable_links WHERE invoice_id = v_payment.invoice_id), v_actor);

  RETURN jsonb_build_object(
    'payment_id', p_payment_id,
    'invoice_id', v_payment.invoice_id,
    'new_status', (SELECT status FROM public.invoices WHERE id = v_payment.invoice_id)
  );
END;
$function$;

-- 6. Avulsa reemitida na troca de CNPJ (374) não herda data, autor e motivo
-- do cancelamento da original.
CREATE OR REPLACE FUNCTION public.reissue_open_documents_on_customer_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_doc record;
  v_new bigint;
  v_reason text := 'Troca de CNPJ do B/L ' || NEW.id || ': documento reemitido para o novo Cliente.';
BEGIN
  -- Avulsa emitida sem pagamento.
  FOR v_doc IN
    SELECT i.id FROM public.invoices i
    WHERE i.bl_id = NEW.id AND i.invoice_type = 'manual' AND i.customer_id = OLD.customer_id
      AND coalesce(i.status, 'issued') = 'issued' AND coalesce(i.total_paid_brl, 0) = 0
      AND NOT EXISTS (SELECT 1 FROM public.payments p WHERE p.invoice_id = i.id)
    ORDER BY i.id
  LOOP
    PERFORM public._cancel_invoice_core(v_doc.id, v_reason, auth.uid());
    v_new := public._clone_row('public.invoices', v_doc.id,
      jsonb_build_object('customer_id', NEW.customer_id, 'status', 'issued', 'issued_at', now(), 'replaces_invoice_id', v_doc.id,
        'total_paid_brl', 0, 'pix_payload', NULL, 'pix_txid', NULL, 'conciliated_by_extract', false),
      ARRAY['invoice_number', 'created_at', 'updated_at', 'reissue_requested_at', 'reissue_closed_at', 'reissue_closed_reason',
        'covered_by_invoice_id', 'obsolete_reason', 'cancelled_at', 'cancelled_by', 'cancel_reason']);
    UPDATE public.invoices SET balance_brl = total_brl WHERE id = v_new;
    PERFORM public._clone_row('public.invoice_items', ii.id, jsonb_build_object('invoice_id', v_new))
    FROM public.invoice_items ii WHERE ii.invoice_id = v_doc.id;
  END LOOP;

  -- Invoice de Demurrage emitida sem pagamento.
  FOR v_doc IN
    SELECT d.id, d.status FROM public.demurrage_invoices d
    WHERE d.bl_id = NEW.id AND d.customer_id = OLD.customer_id
      AND d.status IN ('issued', 'overdue') AND d.paid_at IS NULL
    ORDER BY d.id
  LOOP
    UPDATE public.demurrage_invoices SET status = 'cancelled', updated_at = now() WHERE id = v_doc.id;
    INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
    VALUES ('demurrage_invoice', v_doc.id::text, 'status', v_doc.status, 'cancelled', auth.uid(), v_reason);
    v_new := public._clone_row('public.demurrage_invoices', v_doc.id,
      jsonb_build_object('customer_id', NEW.customer_id, 'doc_number', public.next_demurrage_doc_number(), 'status', v_doc.status,
        'pix_payload', NULL, 'pix_txid', NULL, 'conciliated_by_extract', false, 'notes',
        'Reemitida pela troca de CNPJ do B/L (substitui a Invoice ' || v_doc.id || ').'),
      ARRAY['created_at', 'updated_at', 'dunning_suspended_reason']);
    PERFORM public._clone_row('public.demurrage_invoice_items', it.id, jsonb_build_object('invoice_id', v_new))
    FROM public.demurrage_invoice_items it WHERE it.invoice_id = v_doc.id;
  END LOOP;
  RETURN NULL;
END;
$function$;

-- 7. Pix que a fatura já recebeu (extrato, plano B ou baixa manual com o
-- endToEndId na referência) e volta pela consulta Itaú não é duplicidade:
-- o recebimento fica como baixado, sem restituição (ADR 0093, decisão 18).
-- Também fecha a falha de consulta do mesmo endToEndId (358).
CREATE OR REPLACE FUNCTION public.itau_pix_settle(p_end_to_end_id text, p_txid text, p_amount_brl numeric, p_paid_at timestamp with time zone)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_existing text;
  v_charge public.itau_pix_charges%ROWTYPE;
  v_invoice_type text;
  v_duplicate boolean := false;
  v_successor bigint;
  v_actor uuid;
  v_previous_sub text := current_setting('request.jwt.claim.sub', true);
  v_result jsonb;
  v_reason text;
  v_request uuid := md5('itau-pix:' || p_end_to_end_id)::uuid;
BEGIN
  IF p_end_to_end_id IS NULL OR p_txid IS NULL OR p_amount_brl IS NULL OR p_paid_at IS NULL THEN
    RAISE EXCEPTION 'Recebimento Itaú incompleto.' USING ERRCODE = '22023';
  END IF;
  -- Mesma ordem de lock para o mesmo Pix: execuções concorrentes esperam.
  PERFORM pg_advisory_xact_lock(hashtextextended('itau_pix_e2e:' || p_end_to_end_id, 0));
  SELECT status INTO v_existing FROM public.itau_pix_receipts WHERE end_to_end_id = p_end_to_end_id;
  IF FOUND THEN RETURN v_existing; END IF;

  SELECT * INTO v_charge FROM public.itau_pix_charges WHERE txid = p_txid FOR UPDATE;
  IF FOUND THEN
    -- O Pix existe no banco: a cobrança está paga, haja baixa ou análise.
    -- Marcar antes da baixa evita que o gatilho do QR a veja como aberta e
    -- tente cancelá-la no Itaú.
    UPDATE public.itau_pix_charges SET status = 'concluded', updated_at = now() WHERE id = v_charge.id;
  END IF;
  IF v_charge.id IS NULL THEN
    v_reason := 'TXID do Vela sem cobrança registrada.';
  -- ADR 0093, decisão 18 (375): Pix em duplicidade em fatura de Taxas Locais
  -- já paga, coberta ou cancelada vira recebimento sem fatura aberta, ligado à
  -- fatura de origem, com restituição pendente.
  ELSIF v_charge.invoice_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.invoices i WHERE i.id = v_charge.invoice_id
      AND i.invoice_type IN ('individual', 'consolidated') AND i.status IN ('paid', 'covered', 'cancelled'))
    AND (
      EXISTS (SELECT 1 FROM public.payments p
              WHERE upper(btrim(coalesce(p.bank_reference, ''))) = upper(btrim(p_end_to_end_id)))
      OR EXISTS (SELECT 1 FROM public.invoices i WHERE i.id = v_charge.invoice_id
                 AND public.normalize_pix_txid(i.pix_txid) = public.normalize_pix_txid(p_txid))
      OR EXISTS (SELECT 1 FROM public.ledger_settlements s
                 WHERE public.normalize_pix_txid(s.pix_txid) = public.normalize_pix_txid(p_txid))) THEN
    -- 385: o mesmo Pix já foi baixado nesta fatura.
    v_result := jsonb_build_object('already_settled', true, 'invoice_id', v_charge.invoice_id);
  ELSIF v_charge.invoice_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.invoices i WHERE i.id = v_charge.invoice_id
      AND i.invoice_type IN ('individual', 'consolidated') AND i.status IN ('paid', 'covered', 'cancelled')) THEN
    v_reason := 'Pix em duplicidade: a fatura de origem já estava paga, coberta ou cancelada. Restituição pendente registrada; o Pix sai da análise quando a devolução for confirmada.';
    v_duplicate := true;
  -- Demurrage: a cobrança guarda a revisão mais nova; o pagamento da revisão
  -- anterior é válido e register_demurrage_payment confere a janela de PTAX.
  ELSIF v_charge.invoice_id IS NOT NULL AND round(p_amount_brl, 2) <> v_charge.amount_brl THEN
    v_reason := 'Valor recebido difere do valor da cobrança.';
  ELSE
    BEGIN
      -- F-05: o mesmo Pix não é baixado duas vezes (extrato ou baixa manual
      -- com o endToEndId na referência).
      IF v_charge.invoice_id IS NOT NULL AND (
           EXISTS (SELECT 1 FROM public.payments p
                   WHERE upper(btrim(coalesce(p.bank_reference, ''))) = upper(btrim(p_end_to_end_id)))
           OR EXISTS (SELECT 1 FROM public.invoices i
                      WHERE i.id = v_charge.invoice_id AND i.invoice_type = 'manual'
                        AND public.normalize_pix_txid(i.pix_txid) = public.normalize_pix_txid(p_txid))) THEN
        RAISE EXCEPTION 'Pix ja baixado nesta fatura (mesmo TXID ou endToEndId): confira antes de baixar de novo.'
          USING ERRCODE = 'P0001';
      END IF;
      IF v_charge.demurrage_invoice_id IS NOT NULL THEN
        v_result := public.register_demurrage_payment(v_request, v_charge.demurrage_invoice_id,
          (p_paid_at AT TIME ZONE 'America/Sao_Paulo')::date, p_txid, round(p_amount_brl, 2), NULL);
      ELSE
        SELECT itau_pix_settlement_actor INTO v_actor FROM public.app_settings WHERE id = 1;
        IF v_actor IS NULL THEN
          RAISE EXCEPTION 'Usuário de baixa automática Itaú não configurado.';
        END IF;
        PERFORM set_config('request.jwt.claim.sub', v_actor::text, true);
        SELECT invoice_type INTO v_invoice_type FROM public.invoices WHERE id = v_charge.invoice_id;
        IF v_invoice_type = 'manual' THEN
          v_result := public.register_verified_invoice_payment(v_charge.invoice_id, round(p_amount_brl, 2), 'pix',
            p_paid_at, 'Baixa automática Itaú Pix', v_request, p_end_to_end_id);
        ELSIF EXISTS (SELECT 1 FROM public.invoices WHERE id = v_charge.invoice_id AND status = 'obsolete') THEN
          -- 361 (decisão 8): QR da consolidada substituída quita a sucessora
          -- aberta; o excedente vira restituição pendente.
          WITH RECURSIVE chain AS (
            SELECT s.id, s.status, 1 AS depth FROM public.invoices s WHERE s.replaces_invoice_id = v_charge.invoice_id
            UNION ALL
            SELECT s.id, s.status, c.depth + 1 FROM chain c JOIN public.invoices s ON s.replaces_invoice_id = c.id
            WHERE c.depth < 50
          )
          SELECT id INTO v_successor FROM chain WHERE status IN ('issued', 'partially_paid') ORDER BY depth DESC LIMIT 1;
          IF v_successor IS NULL THEN
            RAISE EXCEPTION 'Consolidada substituída sem sucessora aberta para receber o Pix.';
          END IF;
          v_result := public.register_ledger_invoice_payment(v_successor, round(p_amount_brl, 2), 'pix', p_paid_at, NULL,
            'manual', 'Pix do QR da consolidada substituída ' || v_charge.invoice_id || ' (baixa automática Itaú Pix)', v_actor);
          UPDATE public.payments SET bank_reference = p_end_to_end_id WHERE id = (v_result->>'payment_id')::bigint;
        ELSE
          v_result := public.reconcile_invoice_payment_by_txid(p_txid, round(p_amount_brl, 2), p_paid_at);
          IF coalesce((v_result->>'settled')::boolean, false) IS NOT TRUE THEN
            RAISE EXCEPTION 'Conciliação recusou: %', coalesce(v_result->>'reason', 'sem motivo');
          END IF;
          UPDATE public.payments SET bank_reference = p_end_to_end_id,
            notes = coalesce(notes || ' · ', '') || 'Baixa automática Itaú Pix'
          WHERE id = (v_result->'payment'->>'payment_id')::bigint;
        END IF;
        -- F-48 (376): a baixa automática Itaú tem origem própria.
        UPDATE public.ledger_settlements SET source = 'itau_pix'
        WHERE source = 'pix_extract' AND payment_id IN (SELECT id FROM public.payments WHERE upper(btrim(coalesce(bank_reference, ''))) = upper(p_end_to_end_id));
        PERFORM set_config('request.jwt.claim.sub', coalesce(v_previous_sub, ''), true);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      -- Mesma regra da 152: erro passageiro falha a chamada para nova tentativa.
      IF left(SQLSTATE, 2) IN ('08', '40', '53', '55', '57', 'XX') THEN RAISE; END IF;
      -- Desfaz só a baixa; a cobrança continua 'concluded' (paga no banco).
      PERFORM set_config('request.jwt.claim.sub', coalesce(v_previous_sub, ''), true);
      v_reason := left(SQLERRM, 300);
    END;
  END IF;

  UPDATE public.itau_pix_receipt_failures SET status = 'handled', updated_at = now()
   WHERE end_to_end_id = p_end_to_end_id AND status <> 'handled';
  IF FOUND THEN
    PERFORM public.resolve_alert_item('pix_unreconciled', 'itau_pix_receipt_failure', p_end_to_end_id, 'itau_pix',
      jsonb_build_object('end_to_end_id', p_end_to_end_id, 'resolved_by', 'itau_pix_settle'));
  END IF;
  INSERT INTO public.itau_pix_receipts(end_to_end_id, txid, charge_id, amount_brl, paid_at, status, reason, result)
  VALUES (p_end_to_end_id, p_txid, v_charge.id, round(p_amount_brl, 2), p_paid_at,
    CASE WHEN v_reason IS NULL THEN 'settled' ELSE 'review' END, v_reason, v_result);
  IF v_duplicate THEN
    INSERT INTO public.invoice_refunds (invoice_id, amount_brl, origin, notes, purpose, itau_end_to_end_id)
    VALUES (v_charge.invoice_id, round(p_amount_brl, 2), 'pix_duplicate',
      'Pix em duplicidade recebido pelo Itaú (endToEndId ' || p_end_to_end_id || ') depois de a fatura estar paga, coberta ou cancelada.',
      'correction', p_end_to_end_id);
  END IF;
  IF v_reason IS NOT NULL THEN
    PERFORM public.upsert_alert_item('pix_unreconciled', 'itau_pix_receipt', p_end_to_end_id,
      'Pix de R$ ' || to_char(round(p_amount_brl, 2), 'FM999G999G990D00') || ' recebido pelo Itaú (TXID ' || p_txid
        || ') não foi baixado automaticamente: ' || v_reason,
      'itau_pix', 'administrativo',
      jsonb_build_object('end_to_end_id', p_end_to_end_id, 'txid', p_txid, 'amount_brl', round(p_amount_brl, 2),
        'invoice_id', v_charge.invoice_id, 'demurrage_invoice_id', v_charge.demurrage_invoice_id),
      '/reconciliacao');
    RETURN 'review';
  END IF;
  RETURN 'settled';
END;
$function$;

-- 8. Cobrança Itaú da Invoice de Demurrage com ROE manual (ADR 0094, B10):
-- a rotina diária estende o QR dela até o corte mesmo sem a PTAX do dia, e o
-- alerta das 14h não a conta como "sem a PTAX de hoje"; a Invoice com Pix em
-- análise (sem QR por regra, 370) também não entra no alerta. Ao tratar o Pix
-- em análise, a Invoice ainda em aberto ganha o QR de volta.
CREATE OR REPLACE FUNCTION public.itau_pix_maintain(p_now timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_expired integer; v_renewed integer; v_extended integer; v_pending integer;
  v_local_day date := (p_now AT TIME ZONE 'America/Sao_Paulo')::date;
  v_ref public.exchange_rate_reference%ROWTYPE;
  v_cutoff timestamptz;
BEGIN
  IF (SELECT pix_provider FROM public.app_settings WHERE id = 1) IS DISTINCT FROM 'itau' THEN
    RETURN jsonb_build_object('skipped', 'provider_static');
  END IF;
  -- 1. Passou da validade: confirmar no banco antes de substituir.
  UPDATE public.itau_pix_charges SET status = 'pending_expire_check', next_attempt_at = p_now, updated_at = p_now
  WHERE status = 'active' AND expires_at <= p_now;
  GET DIAGNOSTICS v_expired = ROW_COUNT;

  -- 2. Taxas Locais abertas: renovar a mesma cobrança com 7 dias de folga, ou
  -- metade da validade configurada quando ela for menor que 14 dias (219: com
  -- validade abaixo de 7 dias, a cobrança recém-renovada voltava a pedir
  -- renovação no minuto seguinte, e o Itaú recebia uma alteração por minuto).
  -- ponytail: folga fixa; ajustar se o Itaú limitar a validade máxima.
  UPDATE public.itau_pix_charges c SET status = 'pending_update', next_attempt_at = p_now, updated_at = p_now,
    expiration_seconds = ceil(extract(epoch FROM p_now + make_interval(secs => s.itau_pix_expiration_seconds) - c.bank_created_at))::integer
  FROM public.app_settings s, public.invoices i
  WHERE s.id = 1 AND i.id = c.invoice_id AND c.status = 'active'
    AND c.expires_at < p_now + least(interval '7 days', make_interval(secs => s.itau_pix_expiration_seconds) / 2)
    AND i.status IN ('issued', 'partially_paid', 'overdue');
  GET DIAGNOSTICS v_renewed = ROW_COUNT;

  -- 3. Demurrage que já reflete a PTAX de hoje e não mudou de valor (ROE
  -- igual ao de ontem não dispara o gatilho): estender até o próximo corte.
  SELECT * INTO v_ref FROM public.exchange_rate_reference WHERE id = 1;
  v_cutoff := public.itau_pix_cutoff(p_now);
  UPDATE public.itau_pix_charges c SET status = 'pending_update', next_attempt_at = p_now, updated_at = p_now,
    expiration_seconds = ceil(extract(epoch FROM v_cutoff - c.bank_created_at))::integer
  FROM public.demurrage_invoices d
  WHERE d.id = c.demurrage_invoice_id AND c.status = 'active' AND c.expires_at < v_cutoff
    AND d.status IN ('issued', 'overdue')
    AND (coalesce(d.roe_manual, false) OR (v_ref.quote_date = v_local_day AND d.current_roe = v_ref.roe));
  GET DIAGNOSTICS v_extended = ROW_COUNT;

  -- 4. Às 14h de dia útil, Demurrage aberta sem a PTAX do dia confirmada na cobrança.
  IF public.itau_pix_business_day(v_local_day) AND (p_now AT TIME ZONE 'America/Sao_Paulo')::time >= time '14:00' THEN
    SELECT count(*) INTO v_pending FROM public.demurrage_invoices d
    LEFT JOIN public.itau_pix_charges c ON c.demurrage_invoice_id = d.id AND c.status = 'active'
    WHERE d.status IN ('issued', 'overdue') AND coalesce(d.current_total_brl, 0) > 0
      AND NOT EXISTS (SELECT 1 FROM public.itau_pix_receipts rec JOIN public.itau_pix_charges ch ON ch.id = rec.charge_id
                      WHERE ch.demurrage_invoice_id = d.id AND rec.status = 'review')
      AND ((NOT coalesce(d.roe_manual, false)
            AND (v_ref.quote_date IS DISTINCT FROM v_local_day OR d.current_roe IS DISTINCT FROM v_ref.roe))
        OR c.id IS NULL OR c.amount_brl <> d.current_total_brl OR c.expires_at < public.itau_pix_cutoff(p_now));
    IF v_pending > 0 THEN
      PERFORM public.upsert_alert_item('demurrage_ptax_recalc_failed', 'exchange_rate_reference', 'itau-pix-14h',
        v_pending || ' fatura(s) de Demurrage sem a PTAX de hoje refletida na cobrança Pix às 14h. Confira a atualização da PTAX; '
          || 'o corte das 14h30 encerra as cobranças atuais e as novas saem com o último valor disponível.',
        'itau_pix', 'documentacao', jsonb_build_object('pending', v_pending, 'day', v_local_day), '/demurrage');
    ELSE
      PERFORM public.resolve_alert_item('demurrage_ptax_recalc_failed', 'exchange_rate_reference', 'itau-pix-14h',
        'itau_pix', jsonb_build_object('day', v_local_day));
    END IF;
  END IF;

  -- 5. Calendário do ano seguinte, 60 dias antes da virada.
  IF v_local_day >= make_date(extract(year FROM v_local_day)::int, 11, 1)
     AND NOT EXISTS (SELECT 1 FROM public.business_holidays WHERE extract(year FROM day) = extract(year FROM v_local_day) + 1) THEN
    PERFORM public.upsert_alert_item('calendario_feriados_pendente', 'business_holidays', 'itau-pix-calendar',
      'Cadastre os feriados de Vitória/ES de ' || (extract(year FROM v_local_day) + 1) || ' em business_holidays: '
        || 'sem eles o prazo das cobranças Pix da Demurrage conta só fins de semana e vence às 14h30 de feriados.',
      'itau_pix', 'documentacao', jsonb_build_object('year', extract(year FROM v_local_day) + 1), '/demurrage');
  ELSIF EXISTS (SELECT 1 FROM public.business_holidays WHERE extract(year FROM day) = extract(year FROM v_local_day) + 1) THEN
    PERFORM public.resolve_alert_item('calendario_feriados_pendente', 'business_holidays', 'itau-pix-calendar',
      'itau_pix', jsonb_build_object('year', extract(year FROM v_local_day) + 1));
  END IF;

  RETURN jsonb_build_object('expired', v_expired, 'renewed', v_renewed, 'extended', coalesce(v_extended, 0), 'ptax_pending', v_pending);
END;
$function$;

CREATE OR REPLACE FUNCTION public._itau_pix_close_receipt(p_end_to_end_id text, p_note text, p_by uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  UPDATE public.itau_pix_receipts SET status = 'handled', handled_at = now(), handled_by = p_by, handled_note = p_note
  WHERE end_to_end_id = p_end_to_end_id AND status = 'review';
  IF FOUND THEN
    PERFORM public.resolve_alert_item('pix_unreconciled', 'itau_pix_receipt', p_end_to_end_id,
      'itau_pix', jsonb_build_object('note', p_note));
    -- 385: Invoice de Demurrage ainda em aberto, sem outro Pix em análise,
    -- volta a ter QR (o gatilho do pix_payload recria a cobrança).
    UPDATE public.demurrage_invoices d SET pix_payload = NULL
    FROM public.itau_pix_receipts r JOIN public.itau_pix_charges c ON c.id = r.charge_id
    WHERE r.end_to_end_id = p_end_to_end_id AND d.id = c.demurrage_invoice_id
      AND d.status IN ('issued', 'overdue')
      AND NOT EXISTS (SELECT 1 FROM public.itau_pix_receipts r2 JOIN public.itau_pix_charges c2 ON c2.id = r2.charge_id
                      WHERE c2.demurrage_invoice_id = d.id AND r2.status = 'review');
  END IF;
END;
$function$;

-- 9. "Pix recebido sem baixa" (sem TXID nenhum, ADR 0093 decisão 16 e ADR
-- 0094 B11) fecha quando a pessoa dá a baixa manual com o endToEndId dele na
-- referência bancária, em qualquer fatura local; antes só fechava o Pix
-- ligado a uma cobrança.
CREATE OR REPLACE FUNCTION public.itau_pix_close_receipts_on_reference()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_e2e text;
BEGIN
  FOR v_e2e IN
    SELECT r.end_to_end_id FROM public.itau_pix_receipts r
    JOIN public.itau_pix_charges c ON c.id = r.charge_id
    JOIN public.invoices i ON i.id = c.invoice_id
    WHERE r.status = 'review' AND c.invoice_id = NEW.invoice_id AND i.status = 'paid'
      AND upper(r.end_to_end_id) = upper(btrim(NEW.bank_reference))
  LOOP
    PERFORM public._itau_pix_close_receipt(v_e2e, 'Fatura paga pela baixa deste Pix.', auth.uid());
  END LOOP;
  FOR v_e2e IN
    SELECT r.end_to_end_id FROM public.itau_pix_receipts r
    WHERE r.status = 'review' AND r.charge_id IS NULL
      AND upper(r.end_to_end_id) = upper(btrim(NEW.bank_reference))
  LOOP
    PERFORM public._itau_pix_close_receipt(v_e2e,
      'Baixa manual deste Pix na fatura ' || coalesce((SELECT invoice_number FROM public.invoices WHERE id = NEW.invoice_id), NEW.invoice_id::text) || '.',
      auth.uid());
  END LOOP;
  RETURN NULL;
END;
$function$;

-- 10. A baixa manual que já nasce com a referência bancária também fecha o
-- Pix em análise (o gatilho da 360 só via a alteração da referência).
DROP TRIGGER IF EXISTS itau_pix_close_receipts_on_reference_insert ON public.payments;
CREATE TRIGGER itau_pix_close_receipts_on_reference_insert
  AFTER INSERT ON public.payments
  FOR EACH ROW WHEN (NEW.bank_reference IS NOT NULL)
  EXECUTE FUNCTION public.itau_pix_close_receipts_on_reference();

-- 11. Pix estático da avulsa (375): o QR remontado cobra o saldo, não o
-- total, e não sai com saldo zero ou fatura fechada.
CREATE OR REPLACE FUNCTION public.populate_local_invoice_pix_payload()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_txid text;
BEGIN
  IF coalesce(NEW.invoice_type, 'individual') IN ('individual', 'consolidated', 'manual')
     AND public._itau_pix_provider() = 'itau' THEN
    NEW.pix_payload := public._itau_pix_sync(NEW.id, NULL, coalesce(NEW.balance_brl, NEW.total_brl, 0),
      coalesce(NEW.status, 'issued') IN ('issued', 'partially_paid', 'overdue') AND coalesce(NEW.balance_brl, NEW.total_brl, 0) > 0
      -- F-37 (375): avulsa em cancelamento com devolução integral não cobra.
      AND NOT public._manual_invoice_cancel_pending(NEW.id));
    RETURN NEW;
  END IF;
  IF NEW.invoice_type = 'manual' THEN
    IF public._manual_invoice_cancel_pending(NEW.id) THEN
      NEW.pix_payload := NULL;
    ELSIF coalesce(NEW.status, 'issued') NOT IN ('issued', 'partially_paid', 'overdue')
       OR coalesce(NEW.balance_brl, NEW.total_brl, 0) <= 0 THEN
      NEW.pix_payload := NULL;
    ELSIF NEW.pix_payload IS NULL THEN
      NEW.pix_payload := public.build_transshipping_pix_payload(coalesce(NEW.balance_brl, NEW.total_brl), NEW.invoice_number);
    END IF;
    RETURN NEW;
  END IF;
  IF coalesce(NEW.invoice_type, 'individual') NOT IN ('individual', 'consolidated') THEN RETURN NEW; END IF;
  IF coalesce(NEW.status, 'issued') NOT IN ('issued', 'partially_paid', 'overdue') OR coalesce(NEW.balance_brl, NEW.total_brl, 0) <= 0 THEN
    NEW.pix_payload := NULL;
  ELSIF TG_OP = 'INSERT' THEN
    NEW.pix_payload := coalesce(NEW.pix_payload, public.build_transshipping_pix_payload(coalesce(NEW.balance_brl, NEW.total_brl), NEW.invoice_number));
  ELSIF NEW.balance_brl IS DISTINCT FROM OLD.balance_brl OR NEW.status IS DISTINCT FROM OLD.status
      OR NEW.pix_payload IS NULL OR NEW.invoice_number IS DISTINCT FROM OLD.invoice_number THEN
    -- Cada apresentação tem identidade própria; pix_txid continua sendo o TXID recebido.
    v_txid := CASE WHEN NOT EXISTS (SELECT 1 FROM public.local_pix_charge_versions WHERE invoice_id = NEW.id)
      THEN left(upper(regexp_replace(NEW.invoice_number, '[^A-Za-z0-9]', '', 'g')), 25)
      ELSE 'VP' || upper(substr(md5(NEW.id::text || clock_timestamp()::text || random()::text), 1, 23)) END;
    NEW.pix_payload := public.build_transshipping_pix_payload(coalesce(NEW.balance_brl, NEW.total_brl), v_txid);
    INSERT INTO public.local_pix_charge_versions(invoice_id, txid, amount_brl, payload)
      VALUES (NEW.id, v_txid, coalesce(NEW.balance_brl, NEW.total_brl), NEW.pix_payload);
  END IF;
  RETURN NEW;
END;
$function$;

-- 12. Tirar o ROE manual (382): o histórico registra a data da cotação de
-- referência usada (não o dia do clique), e a Invoice vencida também pode
-- voltar à PTAX.
CREATE OR REPLACE FUNCTION public.release_demurrage_invoice_manual_roe(p_invoice_id bigint, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_inv public.demurrage_invoices%ROWTYPE;
  v_ref record;
  v_roe numeric;
  v_discount_usd numeric(12,2) := 0;
  v_total_brl numeric(14,2);
  v_quote_date date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_financeiro_user() THEN
    RAISE EXCEPTION 'Tirar o ROE manual é do Financeiro ou do Administrativo.' USING ERRCODE = '42501';
  END IF;
  IF v_reason IS NULL OR char_length(v_reason) < 10 THEN
    RAISE EXCEPTION 'Informe o motivo de tirar o ROE manual (mínimo de 10 caracteres).' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_inv FROM public.demurrage_invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invoice de Demurrage não encontrada.' USING ERRCODE = 'P0002'; END IF;
  IF NOT coalesce(v_inv.roe_manual, false) THEN
    RAISE EXCEPTION 'A Invoice % não tem ROE manual.', v_inv.doc_number USING ERRCODE = '22023';
  END IF;
  IF v_inv.status NOT IN ('issued', 'overdue') OR v_inv.paid_at IS NOT NULL THEN
    RAISE EXCEPTION 'Só a Invoice emitida e não paga troca de câmbio.' USING ERRCODE = '22023';
  END IF;
  SELECT ptax, roe, source, quote_date, effective_date INTO v_ref FROM public.exchange_rate_reference WHERE id = 1;
  IF NOT FOUND OR v_ref.roe IS NULL OR v_ref.roe <= 0 THEN
    RAISE EXCEPTION 'Câmbio de referência não configurado: grave a PTAX antes de tirar o ROE manual.' USING ERRCODE = '22023';
  END IF;
  v_roe := round(v_ref.roe, 4);
  v_quote_date := coalesce(v_ref.quote_date, v_ref.effective_date, v_quote_date);
  IF coalesce(v_inv.discount_value, 0) > 0 THEN
    v_discount_usd := CASE WHEN v_inv.discount_mode = 'percent' THEN round(v_inv.total_usd * (v_inv.discount_value / 100), 2) ELSE v_inv.discount_value END;
  END IF;
  v_total_brl := round(greatest(v_inv.total_usd - v_discount_usd, 0) * v_roe, 2);
  UPDATE public.demurrage_invoices
     SET roe_manual = false, current_roe = v_roe, current_total_brl = v_total_brl,
         roe_source = CASE WHEN v_ref.source IN ('bcb_live', 'cached', 'manual') THEN v_ref.source ELSE 'manual' END,
         pix_payload = CASE WHEN v_total_brl > 0 THEN public.build_transshipping_pix_payload(v_total_brl, v_inv.doc_number) END,
         updated_at = now()
   WHERE id = v_inv.id;
  INSERT INTO public.demurrage_invoice_history(invoice_id, event_date, ptax_used, roe_used, total_usd, total_brl, discount_usd, source)
  VALUES (v_inv.id, v_quote_date, v_ref.ptax, v_roe, v_inv.total_usd, v_total_brl, v_discount_usd,
    CASE WHEN v_ref.source IN ('bcb_live', 'cached', 'manual') THEN v_ref.source ELSE 'manual' END);
  INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  VALUES ('demurrage_invoice', v_inv.id::text, 'roe_manual_removed',
    jsonb_build_object('roe', v_inv.current_roe, 'total_brl', v_inv.current_total_brl)::text,
    jsonb_build_object('roe', v_roe, 'total_brl', v_total_brl)::text, auth.uid(), v_reason);
  RETURN jsonb_build_object('invoice_id', v_inv.id, 'roe', v_roe, 'total_brl', v_total_brl);
END;
$function$;

-- 13. Pix sem TXID nenhum (ADR 0094, B11): o texto não fala mais em "TXID do
-- Vela" (o de TXID de outro sistema é ignorado) e diz como a baixa fecha.
CREATE OR REPLACE FUNCTION public.itau_pix_record_untracked(p_end_to_end_id text, p_amount_brl numeric, p_paid_at timestamp with time zone)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_existing text; v_previous_role text := current_setting('request.jwt.claim.role', true);
BEGIN
  IF p_end_to_end_id IS NULL OR p_amount_brl IS NULL OR p_amount_brl <= 0 OR p_paid_at IS NULL THEN
    RAISE EXCEPTION 'Recebimento Itaú incompleto.' USING ERRCODE = '22023';
  END IF;
  SELECT status INTO v_existing FROM public.itau_pix_receipts WHERE end_to_end_id = p_end_to_end_id;
  IF FOUND THEN RETURN v_existing; END IF;
  INSERT INTO public.itau_pix_receipts (end_to_end_id, txid, amount_brl, paid_at, status, reason)
  VALUES (p_end_to_end_id, '', round(p_amount_brl, 2), p_paid_at, 'review',
    'Pix sem TXID: dê a baixa manual na fatura certa com o endToEndId na referência bancária ou, se não for do Vela, use "Marcar como tratado".');
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM public.upsert_alert_item('pix_unreconciled', 'itau_pix_receipt', p_end_to_end_id,
    'Pix de R$ ' || to_char(round(p_amount_brl, 2), 'FM999G999G990D00') || ' recebido pelo Itaú sem TXID: '
      || 'dê a baixa manual na fatura certa com o endToEndId ' || p_end_to_end_id
      || ' na referência bancária ou, se não for do Vela, use "Marcar como tratado".',
    'itau_pix', 'administrativo', jsonb_build_object('end_to_end_id', p_end_to_end_id, 'amount_brl', round(p_amount_brl, 2)),
    '/reconciliacao');
  PERFORM set_config('request.jwt.claim.role', coalesce(v_previous_role, ''), true);
  RETURN 'review';
END;
$function$;

-- 14. A falha de consulta guarda o Pix inteiro (dados do pagador): só o
-- Financeiro e o Administrativo leem.
DROP POLICY IF EXISTS itau_pix_receipt_failures_select_read ON public.itau_pix_receipt_failures;
CREATE POLICY itau_pix_receipt_failures_select_read ON public.itau_pix_receipt_failures
  FOR SELECT TO authenticated USING ((SELECT public.is_financeiro_user()));

-- 15. B/L cancelado somente leitura (ADR 0094, B4): a exceção provisória do
-- chassi vale só para o arquivo de B/L (marcador vela.vin_reissue), não para
-- "Mover veículos" nem outra escrita; e a marca de exclusão vale só durante
-- a exclusão de cada registro.
CREATE OR REPLACE FUNCTION public.guard_cancelled_bl_cargo()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_bl text;
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('vela.deleting_records', true) = 'on' THEN
    RETURN OLD;
  END IF;
  SELECT b.id INTO v_bl FROM public.bls b
  WHERE b.cancelled_at IS NOT NULL
    AND b.id IN (CASE WHEN TG_OP <> 'INSERT' THEN OLD.bl_id END, CASE WHEN TG_OP <> 'DELETE' THEN NEW.bl_id END)
  LIMIT 1;
  IF v_bl IS NULL THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  -- ponytail: o chassi do B/L cancelado ainda passa ao B/L reemitido pelo
  -- arquivo de B/L (aba VIN, A3 da auditoria das importações). A frente das
  -- importações deixa de ler a aba VIN; com isso esta exceção sai.
  IF TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'vehicles'
     AND current_setting('vela.vin_reissue', true) = 'on'
     AND EXISTS (SELECT 1 FROM public.bls b WHERE b.id = NEW.bl_id AND b.cancelled_at IS NULL)
     AND NOT EXISTS (SELECT 1 FROM public.bls b WHERE b.id = OLD.bl_id AND b.cancelled_at IS NULL) THEN
    RETURN NEW;
  END IF;
  -- O status de Demurrage é derivado e recalculado pelo sistema (197, 200).
  IF TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'bl_containers'
     AND public._voyage_cancelled_financial_only('bl_containers', to_jsonb(OLD), to_jsonb(NEW)) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'B/L % cancelado é somente leitura: reative o B/L pela ficha para alterar containers ou veículos.', v_bl
    USING ERRCODE = '22023';
END;
$function$;

CREATE OR REPLACE FUNCTION public.import_bl_freight_transactional_legacy_205(p_bls jsonb, p_changed_by uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_total_bls INTEGER := COALESCE(jsonb_array_length(p_bls), 0);
  v_inserted_freight_lines INTEGER := 0;
  v_locked_bls TEXT[] := ARRAY[]::TEXT[];
  v_unlocked_bls TEXT[] := ARRAY[]::TEXT[];
  v_container_bls TEXT[] := ARRAY[]::TEXT[];
  v_vehicle_bls TEXT[] := ARRAY[]::TEXT[];
  v_weight_locked_bls TEXT[] := ARRAY[]::TEXT[];
  v_billing_hold_bls TEXT[] := ARRAY[]::TEXT[];
  v_imported_bl_ids TEXT[] := ARRAY[]::TEXT[];
  v_bl_id TEXT;
  v_inserted_vehicles INTEGER := 0;
    v_vehicles_skipped INTEGER := 0;
  v_blocked_container TEXT;
  v_blocked_bl TEXT;
  v_blocked_doc TEXT;
  v_blocked_chassis TEXT;
  v_vehicles_discarded JSONB := '[]'::JSONB;
  v_vehicle_pending_bls TEXT[] := ARRAY[]::TEXT[];
  v_vehicle_summary JSONB;
  v_previous_delete_reason TEXT := current_setting('vela.delete_reason', true);
  -- 213: Troca de Consignatário sem aceite e exceção de terminal do POD antigo.
  v_customer_protected TEXT[] := ARRAY[]::TEXT[];
  v_customer_ignored JSONB := '[]'::JSONB;
  v_terminal_cleared TEXT[] := ARRAY[]::TEXT[];
  v_previous_terminal TEXT := current_setting('vela.bl_terminal_override', true);
  v_audited_fields TEXT[] := ARRAY[
    'voyage_id',
    'cargo_mode',
    'shipper',
    'consignee',
    'notify_party',
    'customer_id',
    'customer_reconciliation_status',
    'customer_reconciliation_notes',
    'billing_hold_reason',
    'pol',
    'pod',
    'place_of_delivery',
    'place_of_receipt',
    'movement_from',
    'movement_to',
    'issue_place',
    'cargo_description',
    'total_packages',
    'packages_unit',
    'consignee_phone',
    'total_weight_kg',
    'total_cbm',
    'incoterm',
    'payment_type',
    'bl_emission_date',
    'manifest_customer_cnpj_cpf',
    'manifest_customer_name',
    'manifest_customer_email',
    'notes'
  ];
BEGIN
  IF auth.uid() IS NULL
     OR NOT public.is_active_user()
     OR p_changed_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Credenciais invalidas para importar frete do BL.'
      USING ERRCODE = '42501';
  END IF;

  IF p_bls IS NULL OR jsonb_typeof(p_bls) <> 'array' THEN
    RAISE EXCEPTION 'Payload de B/Ls invalido.'
      USING ERRCODE = '22023';
  END IF;

  CREATE TEMP TABLE pg_temp.tmp_bl_freight_import (
    id TEXT PRIMARY KEY,
    payload JSONB NOT NULL,
    voyage_id BIGINT,
    batch_id BIGINT,
    cargo_mode TEXT,
    shipper TEXT,
    consignee TEXT,
    notify_party TEXT,
    consignee_block TEXT,
    shipper_block TEXT,
    notify_block TEXT,
    notify2_block TEXT,
    notify_cnpj_cpf TEXT,
    customer_id BIGINT,
    customer_reconciliation_status TEXT,
    customer_reconciliation_notes TEXT,
    billing_hold_reason TEXT,
    pol TEXT,
    pod TEXT,
    place_of_delivery TEXT,
    place_of_receipt TEXT,
    movement_from TEXT,
    movement_to TEXT,
    issue_place TEXT,
    cargo_description TEXT,
    total_packages INTEGER,
    packages_unit TEXT,
    consignee_phone TEXT,
    total_weight_kg NUMERIC,
    total_cbm NUMERIC,
    incoterm TEXT,
    payment_type TEXT,
    bl_emission_date DATE,
    manifest_customer_cnpj_cpf TEXT,
    manifest_customer_name TEXT,
    manifest_customer_email TEXT,
    notes TEXT,
    billing_locked BOOLEAN NOT NULL DEFAULT false,
    override_billing BOOLEAN NOT NULL DEFAULT false,
    billing_impact BOOLEAN NOT NULL DEFAULT false,
    relink_customer BOOLEAN NOT NULL DEFAULT false
  ) ON COMMIT DROP;

  INSERT INTO pg_temp.tmp_bl_freight_import (
    id,
    payload,
    voyage_id,
    batch_id,
    cargo_mode,
    shipper,
    consignee,
    notify_party,
    consignee_block,
    shipper_block,
    notify_block,
    notify2_block,
    notify_cnpj_cpf,
    customer_id,
    customer_reconciliation_status,
    customer_reconciliation_notes,
    billing_hold_reason,
    pol,
    pod,
    place_of_delivery,
    place_of_receipt,
    movement_from,
    movement_to,
    issue_place,
    cargo_description,
    total_packages,
    packages_unit,
    consignee_phone,
    total_weight_kg,
    total_cbm,
    incoterm,
    payment_type,
    bl_emission_date,
    manifest_customer_cnpj_cpf,
    manifest_customer_name,
    manifest_customer_email,
    notes,
    override_billing,
    billing_impact,
    relink_customer
  )
  SELECT
    NULLIF(bl->>'id', ''),
    bl,
    NULLIF(bl->>'voyage_id', '')::BIGINT,
    NULLIF(bl->>'batch_id', '')::BIGINT,
    NULLIF(bl->>'cargo_mode', ''),
    NULLIF(bl->>'shipper', ''),
    NULLIF(bl->>'consignee', ''),
    NULLIF(bl->>'notify_party', ''),
    NULLIF(bl->>'consignee_block', ''),
    NULLIF(bl->>'shipper_block', ''),
    NULLIF(bl->>'notify_block', ''),
    NULLIF(bl->>'notify2_block', ''),
    NULLIF(bl->>'notify_cnpj_cpf', ''),
    NULLIF(bl->>'customer_id', '')::BIGINT,
    reconciliation.status,
    COALESCE(
      NULLIF(bl->>'customer_reconciliation_notes', ''),
      CASE
        WHEN reconciliation.status = 'matched_document' THEN 'Cliente reconciliado automaticamente por CNPJ/CPF.'
        WHEN reconciliation.status = 'matched_name' THEN 'Cliente sugerido por nome; validar documento.'
        ELSE 'Cliente nao encontrado na base cadastral.'
      END
    ),
    COALESCE(
      NULLIF(bl->>'billing_hold_reason', ''),
      CASE
        WHEN reconciliation.status = 'matched_document' THEN NULL
        ELSE 'Aguardando reconciliacao de cliente antes do faturamento.'
      END
    ),
    NULLIF(bl->>'pol', ''),
    NULLIF(bl->>'pod', ''),
    NULLIF(bl->>'place_of_delivery', ''),
    NULLIF(bl->>'place_of_receipt', ''),
    NULLIF(bl->>'movement_from', ''),
    NULLIF(bl->>'movement_to', ''),
    NULLIF(bl->>'issue_place', ''),
    NULLIF(bl->>'cargo_description', ''),
    NULLIF(bl->>'total_packages', '')::INTEGER,
    NULLIF(bl->>'packages_unit', ''),
    NULLIF(bl->>'consignee_phone', ''),
    NULLIF(bl->>'total_weight_kg', '')::NUMERIC,
    NULLIF(bl->>'total_cbm', '')::NUMERIC,
    NULLIF(bl->>'incoterm', ''),
    NULLIF(bl->>'payment_type', ''),
    NULLIF(bl->>'bl_emission_date', '')::DATE,
    public.normalize_document_text(bl->>'manifest_customer_cnpj_cpf'),
    NULLIF(bl->>'manifest_customer_name', ''),
    NULLIF(bl->>'manifest_customer_email', ''),
    NULLIF(bl->>'notes', ''),
    COALESCE(NULLIF(bl->>'override_billing', '')::BOOLEAN, false),
    COALESCE(NULLIF(bl->>'billing_impact', '')::BOOLEAN, false),
    COALESCE(NULLIF(bl->>'relink_customer', '')::BOOLEAN, false)
  FROM jsonb_array_elements(p_bls) AS bl
  CROSS JOIN LATERAL (
    SELECT COALESCE(
      NULLIF(bl->>'customer_reconciliation_status', ''),
      CASE
        WHEN NULLIF(bl->>'customer_id', '') IS NOT NULL THEN 'matched_document'
        ELSE 'missing_customer'
      END
    ) AS status
  ) AS reconciliation;

  IF EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import WHERE id IS NULL) THEN
    RAISE EXCEPTION 'B/L sem identificador no payload de frete.'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_temp.tmp_bl_freight_import
    WHERE customer_reconciliation_status NOT IN ('matched_document', 'matched_name', 'missing_customer', 'reconciled')
  ) THEN
    RAISE EXCEPTION 'Status de reconciliacao de cliente invalido no payload de frete.'
      USING ERRCODE = '22023';
  END IF;

  UPDATE pg_temp.tmp_bl_freight_import AS t
  SET billing_locked = EXISTS (
    SELECT 1
    FROM public.charge_calculations AS cc
    WHERE cc.bl_id = t.id
  ) OR EXISTS (
    SELECT 1
    FROM public.invoice_bls AS ib
    WHERE ib.bl_id = t.id
  )
  WHERE EXISTS (
    SELECT 1
    FROM public.bls AS b
    WHERE b.id = t.id
  );

  SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::TEXT[])
  INTO v_locked_bls
  FROM pg_temp.tmp_bl_freight_import
  WHERE billing_locked;

  SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::TEXT[])
  INTO v_unlocked_bls
  FROM pg_temp.tmp_bl_freight_import
  WHERE NOT billing_locked;

  SELECT COALESCE(array_agg(t.id ORDER BY t.id), ARRAY[]::TEXT[])
  INTO v_weight_locked_bls
  FROM pg_temp.tmp_bl_freight_import AS t
  JOIN public.bls AS b ON b.id = t.id
  WHERE t.billing_locked
    AND NOT t.override_billing
    AND b.cargo_mode = 'carga_solta';

  SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::TEXT[])
  INTO v_billing_hold_bls
  FROM pg_temp.tmp_bl_freight_import
  WHERE billing_locked
    AND NOT override_billing;

  -- 213 (fix 1): Troca de Consignatário. B/L que já tem Cliente e cujo arquivo
  -- aponta outro Cliente, ou um CNPJ diferente do gravado e do Cliente
  -- vinculado (consignatário não cadastrado), mantém Consignee, bloco do
  -- consignatário, CNPJ, razão social e e-mail. Com o aceite
  -- (`relink_customer`), eles entram só depois de `relink_bl_customer` aplicar
  -- a troca (legacy_357), como na carga solta (192, B5); sem o aceite a troca
  -- ignorada volta em `customer_changes_ignored`.
  SELECT
    COALESCE(array_agg(t.id ORDER BY t.id), ARRAY[]::TEXT[]),
    COALESCE(jsonb_agg(jsonb_build_object(
      'bl_id', t.id,
      'customer_id', b.customer_id,
      'file_customer_id', t.customer_id,
      'file_document', t.manifest_customer_cnpj_cpf,
      'file_consignee', t.consignee
    ) ORDER BY t.id) FILTER (WHERE NOT t.relink_customer), '[]'::JSONB)
  INTO v_customer_protected, v_customer_ignored
  FROM pg_temp.tmp_bl_freight_import AS t
  JOIN public.bls AS b ON b.id = t.id
  WHERE b.customer_id IS NOT NULL
    AND (
      (t.customer_id IS NOT NULL AND t.customer_id <> b.customer_id)
      OR (
        t.customer_id IS NULL
        AND t.manifest_customer_cnpj_cpf IS NOT NULL
        AND t.manifest_customer_cnpj_cpf IS DISTINCT FROM public.normalize_document_text(b.manifest_customer_cnpj_cpf)
        AND t.manifest_customer_cnpj_cpf IS DISTINCT FROM (
          SELECT public.normalize_document_text(c.cnpj_cpf) FROM public.customers AS c WHERE c.id = b.customer_id
        )
      )
    );

  -- 213 (fix 5): a exceção de terminal é do POD anterior. O POD corrigido pelo
  -- arquivo limpa terminal e porto da exceção, como na carga solta (174/192) e
  -- no COD. B/L em COD mantém o POD e a exceção (`_guard_cod_pod_on_reimport`).
  SELECT COALESCE(array_agg(t.id ORDER BY t.id), ARRAY[]::TEXT[])
  INTO v_terminal_cleared
  FROM pg_temp.tmp_bl_freight_import AS t
  JOIN public.bls AS b ON b.id = t.id
  WHERE t.id = ANY(v_unlocked_bls)
    AND t.payload ? 'pod'
    AND public.normalize_port_code(t.pod) IS DISTINCT FROM public.normalize_port_code(b.pod)
    AND (b.terminal_id IS NOT NULL OR b.pod_port_id IS NOT NULL);
  IF cardinality(v_terminal_cleared) > 0 THEN
    PERFORM set_config('vela.bl_terminal_override', 'on', true);
  END IF;

  CREATE TEMP TABLE pg_temp.tmp_old_bl_values ON COMMIT DROP AS
  SELECT
    b.id,
    to_jsonb(b) AS old_row,
    to_jsonb(t) AS new_row,
    t.billing_locked
  FROM public.bls AS b
  JOIN pg_temp.tmp_bl_freight_import AS t ON t.id = b.id;

  INSERT INTO public.bls (
    id,
    voyage_id,
    batch_id,
    cargo_mode,
    shipper,
    consignee,
    notify_party,
    consignee_block,
    shipper_block,
    notify_block,
    notify2_block,
    notify_cnpj_cpf,
    customer_id,
    customer_reconciliation_status,
    customer_reconciliation_notes,
    billing_hold_reason,
    pol,
    pod,
    place_of_delivery,
    place_of_receipt,
    movement_from,
    movement_to,
    issue_place,
    cargo_description,
    total_packages,
    packages_unit,
    consignee_phone,
    total_weight_kg,
    total_cbm,
    incoterm,
    payment_type,
    bl_emission_date,
    manifest_customer_cnpj_cpf,
    manifest_customer_name,
    manifest_customer_email,
    notes
  )
  SELECT
    id,
    voyage_id,
    batch_id,
    COALESCE(cargo_mode, 'container'),
    shipper,
    consignee,
    notify_party,
    consignee_block,
    shipper_block,
    notify_block,
    notify2_block,
    notify_cnpj_cpf,
    customer_id,
    customer_reconciliation_status,
    customer_reconciliation_notes,
    billing_hold_reason,
    pol,
    pod,
    place_of_delivery,
    place_of_receipt,
    movement_from,
    movement_to,
    issue_place,
    cargo_description,
    total_packages,
    packages_unit,
    consignee_phone,
    total_weight_kg,
    total_cbm,
    incoterm,
    payment_type,
    bl_emission_date,
    manifest_customer_cnpj_cpf,
    COALESCE(manifest_customer_name, consignee),
    manifest_customer_email,
    notes
  FROM pg_temp.tmp_bl_freight_import
  ON CONFLICT (id) DO UPDATE SET
    voyage_id = CASE WHEN EXCLUDED.id = ANY(v_unlocked_bls) AND EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'voyage_id') THEN EXCLUDED.voyage_id ELSE bls.voyage_id END,
    batch_id = CASE WHEN EXCLUDED.id = ANY(v_unlocked_bls) AND EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'batch_id') THEN EXCLUDED.batch_id ELSE bls.batch_id END,
    cargo_mode = CASE WHEN EXCLUDED.id = ANY(v_unlocked_bls) AND EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'cargo_mode') THEN EXCLUDED.cargo_mode ELSE bls.cargo_mode END,
    shipper = CASE WHEN EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'shipper') THEN EXCLUDED.shipper ELSE bls.shipper END,
    consignee = CASE WHEN EXCLUDED.id = ANY(v_customer_protected) THEN bls.consignee WHEN EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'consignee') THEN EXCLUDED.consignee ELSE bls.consignee END,
    notify_party = CASE WHEN EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'notify_party') THEN EXCLUDED.notify_party ELSE bls.notify_party END,
    consignee_block = CASE WHEN EXCLUDED.id = ANY(v_customer_protected) THEN bls.consignee_block WHEN EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'consignee_block') THEN EXCLUDED.consignee_block ELSE bls.consignee_block END,
    shipper_block = CASE WHEN EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'shipper_block') THEN EXCLUDED.shipper_block ELSE bls.shipper_block END,
    notify_block = CASE WHEN EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'notify_block') THEN EXCLUDED.notify_block ELSE bls.notify_block END,
    notify2_block = CASE WHEN EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'notify2_block') THEN EXCLUDED.notify2_block ELSE bls.notify2_block END,
    notify_cnpj_cpf = CASE WHEN EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'notify_cnpj_cpf') THEN EXCLUDED.notify_cnpj_cpf ELSE bls.notify_cnpj_cpf END,
    customer_id = CASE
      WHEN bls.customer_id IS NULL
        AND EXCLUDED.customer_id IS NOT NULL
        AND EXCLUDED.id <> ALL(v_billing_hold_bls)
        THEN EXCLUDED.customer_id
      ELSE bls.customer_id
    END,
    customer_reconciliation_status = CASE
      WHEN bls.customer_id IS NULL
        AND EXCLUDED.customer_id IS NOT NULL
        AND EXCLUDED.id <> ALL(v_billing_hold_bls)
        THEN EXCLUDED.customer_reconciliation_status
      WHEN bls.customer_id = EXCLUDED.customer_id
        AND EXCLUDED.customer_id IS NOT NULL
        AND COALESCE(bls.customer_reconciliation_status, 'missing_customer') IN ('missing_customer', 'matched_name')
        AND EXCLUDED.customer_reconciliation_status IN ('matched_document', 'matched_name')
        AND EXCLUDED.id <> ALL(v_billing_hold_bls)
        THEN EXCLUDED.customer_reconciliation_status
      WHEN COALESCE(bls.customer_reconciliation_status, '') = ''
        AND EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'customer_reconciliation_status')
        THEN EXCLUDED.customer_reconciliation_status
      ELSE bls.customer_reconciliation_status
    END,
    customer_reconciliation_notes = CASE
      -- 213: a Troca de Consignatário sem aplicar não traz a retenção nem a
      -- nota de reconciliação do consignatário do arquivo.
      WHEN EXCLUDED.id = ANY(v_customer_protected) THEN bls.customer_reconciliation_notes
      WHEN bls.customer_id IS NULL
        AND EXCLUDED.customer_id IS NOT NULL
        AND EXCLUDED.id <> ALL(v_billing_hold_bls)
        THEN EXCLUDED.customer_reconciliation_notes
      WHEN bls.customer_id = EXCLUDED.customer_id
        AND EXCLUDED.customer_id IS NOT NULL
        AND COALESCE(bls.customer_reconciliation_status, 'missing_customer') IN ('missing_customer', 'matched_name')
        AND EXCLUDED.customer_reconciliation_status IN ('matched_document', 'matched_name')
        AND EXCLUDED.id <> ALL(v_billing_hold_bls)
        THEN EXCLUDED.customer_reconciliation_notes
      WHEN COALESCE(bls.customer_reconciliation_notes, '') = ''
        AND EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'customer_reconciliation_notes')
        THEN EXCLUDED.customer_reconciliation_notes
      ELSE bls.customer_reconciliation_notes
    END,
    billing_hold_reason = CASE
      -- 213: a Troca de Consignatário sem aplicar não traz a retenção nem a
      -- nota de reconciliação do consignatário do arquivo.
      WHEN EXCLUDED.id = ANY(v_customer_protected) THEN bls.billing_hold_reason
      WHEN bls.customer_id IS NULL
        AND EXCLUDED.customer_id IS NOT NULL
        AND EXCLUDED.id <> ALL(v_billing_hold_bls)
        THEN EXCLUDED.billing_hold_reason
      WHEN bls.customer_id = EXCLUDED.customer_id
        AND EXCLUDED.customer_id IS NOT NULL
        AND COALESCE(bls.customer_reconciliation_status, 'missing_customer') IN ('missing_customer', 'matched_name')
        AND EXCLUDED.customer_reconciliation_status IN ('matched_document', 'matched_name')
        AND EXCLUDED.id <> ALL(v_billing_hold_bls)
        THEN EXCLUDED.billing_hold_reason
      WHEN COALESCE(bls.billing_hold_reason, '') = ''
        AND EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'billing_hold_reason')
        THEN EXCLUDED.billing_hold_reason
      ELSE bls.billing_hold_reason
    END,
    pol = CASE WHEN EXCLUDED.id = ANY(v_unlocked_bls) AND EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'pol') THEN EXCLUDED.pol ELSE bls.pol END,
    pod = CASE WHEN EXCLUDED.id = ANY(v_unlocked_bls) AND EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'pod') THEN EXCLUDED.pod ELSE bls.pod END,
    terminal_id = CASE WHEN EXCLUDED.id = ANY(v_terminal_cleared) THEN NULL ELSE bls.terminal_id END,
    pod_port_id = CASE WHEN EXCLUDED.id = ANY(v_terminal_cleared) THEN NULL ELSE bls.pod_port_id END,
    place_of_delivery = CASE WHEN EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'place_of_delivery') THEN EXCLUDED.place_of_delivery ELSE bls.place_of_delivery END,
    place_of_receipt = CASE WHEN EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'place_of_receipt') THEN EXCLUDED.place_of_receipt ELSE bls.place_of_receipt END,
    movement_from = CASE WHEN EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'movement_from') THEN EXCLUDED.movement_from ELSE bls.movement_from END,
    movement_to = CASE WHEN EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'movement_to') THEN EXCLUDED.movement_to ELSE bls.movement_to END,
    issue_place = CASE WHEN EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'issue_place') THEN EXCLUDED.issue_place ELSE bls.issue_place END,
    cargo_description = CASE WHEN EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'cargo_description') THEN EXCLUDED.cargo_description ELSE bls.cargo_description END,
    total_packages = CASE WHEN EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'total_packages') THEN EXCLUDED.total_packages ELSE bls.total_packages END,
    packages_unit = CASE WHEN EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'packages_unit') THEN EXCLUDED.packages_unit ELSE bls.packages_unit END,
    consignee_phone = CASE WHEN EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'consignee_phone') THEN EXCLUDED.consignee_phone ELSE bls.consignee_phone END,
    total_weight_kg = CASE WHEN EXCLUDED.id <> ALL(v_weight_locked_bls) AND EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'total_weight_kg') THEN EXCLUDED.total_weight_kg ELSE bls.total_weight_kg END,
    total_cbm = CASE WHEN EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'total_cbm') THEN EXCLUDED.total_cbm ELSE bls.total_cbm END,
    incoterm = CASE WHEN EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'incoterm') THEN EXCLUDED.incoterm ELSE bls.incoterm END,
    payment_type = CASE WHEN EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'payment_type') THEN EXCLUDED.payment_type ELSE bls.payment_type END,
    bl_emission_date = CASE WHEN EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'bl_emission_date') THEN EXCLUDED.bl_emission_date ELSE bls.bl_emission_date END,
    manifest_customer_cnpj_cpf = CASE WHEN EXCLUDED.id = ANY(v_customer_protected) THEN bls.manifest_customer_cnpj_cpf WHEN EXCLUDED.id <> ALL(v_billing_hold_bls) AND EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'manifest_customer_cnpj_cpf') THEN EXCLUDED.manifest_customer_cnpj_cpf ELSE bls.manifest_customer_cnpj_cpf END,
    manifest_customer_name = CASE WHEN EXCLUDED.id = ANY(v_customer_protected) THEN bls.manifest_customer_name WHEN EXCLUDED.id <> ALL(v_billing_hold_bls) AND EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'manifest_customer_name') THEN EXCLUDED.manifest_customer_name ELSE bls.manifest_customer_name END,
    -- M14: o e-mail anda com o documento do consignatário; protegido junto
    -- com o CNPJ, ele não vira contato do Cliente antigo.
    manifest_customer_email = CASE WHEN EXCLUDED.id = ANY(v_customer_protected) THEN bls.manifest_customer_email WHEN EXCLUDED.id <> ALL(v_billing_hold_bls) AND EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'manifest_customer_email') THEN EXCLUDED.manifest_customer_email ELSE bls.manifest_customer_email END,
    notes = CASE WHEN EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'notes') THEN EXCLUDED.notes ELSE bls.notes END,
    updated_at = now();

  IF cardinality(v_terminal_cleared) > 0 THEN
    PERFORM set_config('vela.bl_terminal_override', COALESCE(v_previous_terminal, 'off'), true);
  END IF;

  SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::TEXT[])
  INTO v_imported_bl_ids
  FROM pg_temp.tmp_bl_freight_import;

  INSERT INTO public.audit_logs (
    entity_type,
    entity_id,
    field_name,
    old_value,
    new_value,
    changed_by,
    justification
  )
  SELECT
    'bl',
    old_values.id,
    field_name,
    old_values.old_row->>field_name,
    to_jsonb(b)->>field_name,
    p_changed_by,
    CASE
      WHEN old_values.billing_locked THEN 'Importacao automatica de frete do BL; campos operacionais protegidos por faturamento existente'
      ELSE 'Importacao automatica de frete do BL'
    END
  FROM pg_temp.tmp_old_bl_values AS old_values
  JOIN public.bls AS b ON b.id = old_values.id
  CROSS JOIN unnest(v_audited_fields) AS audited(field_name)
  WHERE COALESCE(old_values.old_row->>field_name, '') IS DISTINCT FROM COALESCE(to_jsonb(b)->>field_name, '');

  DELETE FROM public.bl_freight_lines
  WHERE bl_id IN (
    SELECT id
    FROM pg_temp.tmp_bl_freight_import
    WHERE payload ? 'freight_lines'
       OR payload ? 'freightLines'
  );

  INSERT INTO public.bl_freight_lines (
    bl_id,
    seq,
    description,
    category,
    mercante_code,
    currency,
    amount,
    payment
  )
  SELECT
    t.id,
    COALESCE(NULLIF(line.item->>'seq', '')::INTEGER, line.ordinality::INTEGER),
    NULLIF(line.item->>'description', ''),
    NULLIF(line.item->>'category', ''),
    NULLIF(line.item->>'mercante_code', ''),
    NULLIF(line.item->>'currency', ''),
    NULLIF(line.item->>'amount', '')::NUMERIC,
    NULLIF(line.item->>'payment', '')
  FROM pg_temp.tmp_bl_freight_import AS t
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE
      WHEN jsonb_typeof(COALESCE(t.payload->'freight_lines', t.payload->'freightLines')) = 'array'
        THEN COALESCE(t.payload->'freight_lines', t.payload->'freightLines')
      ELSE '[]'::jsonb
    END
  ) WITH ORDINALITY AS line(item, ordinality);

  GET DIAGNOSTICS v_inserted_freight_lines = ROW_COUNT;

  SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::TEXT[])
  INTO v_container_bls
  FROM pg_temp.tmp_bl_freight_import
  WHERE (NOT billing_locked OR override_billing)
    AND payload ? 'containers';

  SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::TEXT[])
  INTO v_vehicle_bls
  FROM pg_temp.tmp_bl_freight_import
  WHERE (NOT billing_locked OR override_billing)
    AND payload ? 'vehicles';

  -- Containers: reconciliação por número (migration 175, M02). O id, a data de
  -- descarga, a devolução, o status de Demurrage, o local de desova e o perfil
  -- IMO/OOG do container que continua no arquivo ficam; só as colunas do
  -- documento mudam, e só quando mudam. Container ausente do arquivo sai apenas
  -- quando a prévia mostrou a remoção (`remove_containers`); payload sem a
  -- chave mantém a semântica anterior (sai todo ausente).
  CREATE TEMP TABLE pg_temp.tmp_new_containers (
    id BIGINT,
    bl_id TEXT,
    container_number TEXT
  ) ON COMMIT DROP;

  CREATE TEMP TABLE pg_temp.tmp_container_changes (
    bl_id TEXT,
    container_number TEXT,
    change TEXT
  ) ON COMMIT DROP;

  CREATE TEMP TABLE pg_temp.tmp_incoming_containers ON COMMIT DROP AS
  SELECT DISTINCT ON (t.id, upper(btrim(c.item->>'container_number')))
    t.id AS bl_id,
    upper(btrim(c.item->>'container_number')) AS container_number,
    NULLIF(c.item->>'seal_number', '') AS seal_number,
    NULLIF(c.item->>'type', '') AS type,
    NULLIF(c.item->>'tare_weight_kg', '')::NUMERIC AS tare_weight_kg,
    NULLIF(c.item->>'gross_weight_kg', '')::NUMERIC AS gross_weight_kg,
    NULLIF(c.item->>'cbm', '')::NUMERIC AS cbm,
    COALESCE(NULLIF(c.item->>'is_oog', '')::BOOLEAN, false) AS is_oog,
    COALESCE(NULLIF(c.item->>'is_imo', '')::BOOLEAN, false) AS is_imo,
    NULLIF(c.item->>'imo_class', '') AS imo_class,
    NULLIF(c.item->>'un_number', '') AS un_number,
    CASE WHEN upper(btrim(c.item->>'ownership')) IN ('SOC', 'COC') THEN upper(btrim(c.item->>'ownership')) END AS ownership,
    c.ord
  FROM pg_temp.tmp_bl_freight_import AS t
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(t.payload->'containers') = 'array' THEN t.payload->'containers' ELSE '[]'::jsonb END
  ) WITH ORDINALITY AS c(item, ord)
  WHERE t.id = ANY(v_container_bls)
    AND NULLIF(btrim(c.item->>'container_number'), '') IS NOT NULL
  ORDER BY t.id, upper(btrim(c.item->>'container_number')), c.ord;

  CREATE TEMP TABLE pg_temp.tmp_removed_containers ON COMMIT DROP AS
  SELECT bc.id, bc.bl_id, upper(btrim(bc.container_number)) AS container_number
  FROM public.bl_containers AS bc
  JOIN pg_temp.tmp_bl_freight_import AS t ON t.id = bc.bl_id
  WHERE t.id = ANY(v_container_bls)
    AND NOT EXISTS (
      SELECT 1 FROM pg_temp.tmp_incoming_containers AS i
      WHERE i.bl_id = bc.bl_id AND i.container_number = upper(btrim(bc.container_number))
    )
    AND (
      NOT (t.payload ? 'remove_containers')
      OR upper(btrim(bc.container_number)) IN (
        SELECT upper(btrim(listed.value))
        FROM jsonb_array_elements_text(
          CASE WHEN jsonb_typeof(t.payload->'remove_containers') = 'array' THEN t.payload->'remove_containers' ELSE '[]'::jsonb END
        ) AS listed(value)
      )
    );

  SELECT r.container_number, r.bl_id, d.doc_number
    INTO v_blocked_container, v_blocked_bl, v_blocked_doc
  FROM pg_temp.tmp_removed_containers AS r
  JOIN public.demurrage_invoice_items AS di ON di.container_id = r.id
  JOIN public.demurrage_invoices AS d ON d.id = di.invoice_id
  ORDER BY r.bl_id, r.container_number
  LIMIT 1;
  IF v_blocked_container IS NOT NULL THEN
    -- Migration 194 (A2): o item da Invoice de Demurrage trava o container
    -- (ADR 0071, item 3) com a invoice em qualquer situação: cancelar não
    -- destrava (os itens ficam), então a mensagem não manda cancelar.
    RAISE EXCEPTION
      'O container % do B/L % tem a Invoice de Demurrage % e não sai por reimportação.',
      v_blocked_container, v_blocked_bl, v_blocked_doc
      USING ERRCODE = 'P0006';
  END IF;

  WITH updated AS (
    UPDATE public.bl_containers AS bc
    SET
      seal_number = i.seal_number,
      type = i.type,
      tare_weight_kg = i.tare_weight_kg,
      gross_weight_kg = i.gross_weight_kg,
      cbm = i.cbm,
      ownership = CASE
        WHEN i.ownership IS NOT NULL AND bc.ownership_source IS DISTINCT FROM 'manual' THEN i.ownership
        ELSE bc.ownership
      END,
      ownership_source = CASE
        WHEN i.ownership IS NOT NULL AND bc.ownership_source IS DISTINCT FROM 'manual' THEN 'bl'
        ELSE bc.ownership_source
      END
    FROM pg_temp.tmp_incoming_containers AS i
    WHERE i.bl_id = bc.bl_id
      AND i.container_number = upper(btrim(bc.container_number))
      AND (
        bc.seal_number IS DISTINCT FROM i.seal_number
        OR bc.type IS DISTINCT FROM i.type
        OR bc.tare_weight_kg IS DISTINCT FROM i.tare_weight_kg
        OR bc.gross_weight_kg IS DISTINCT FROM i.gross_weight_kg
        OR bc.cbm IS DISTINCT FROM i.cbm
        OR (i.ownership IS NOT NULL AND bc.ownership_source IS DISTINCT FROM 'manual' AND bc.ownership IS DISTINCT FROM i.ownership)
      )
    RETURNING bc.bl_id, upper(btrim(bc.container_number)) AS container_number
  )
  INSERT INTO pg_temp.tmp_container_changes (bl_id, container_number, change)
  SELECT bl_id, container_number, 'updated' FROM updated;

  WITH inserted AS (
    -- Migration 194 (E9-07): IMO/OOG declarado no B/L nasce com origem `bl`,
    -- protegido do Baplie completo (ADR 0078, item 21).
    INSERT INTO public.bl_containers (
      bl_id, container_number, seal_number, type, tare_weight_kg, gross_weight_kg,
      cbm, is_oog, is_imo, imo_class, un_number, profile_source
    )
    SELECT
      i.bl_id, i.container_number, i.seal_number, i.type, i.tare_weight_kg, i.gross_weight_kg,
      i.cbm, i.is_oog, i.is_imo, i.imo_class, i.un_number,
      CASE WHEN i.is_imo OR i.is_oog THEN 'bl' END
    FROM pg_temp.tmp_incoming_containers AS i
    WHERE NOT EXISTS (
      SELECT 1 FROM public.bl_containers AS bc
      WHERE bc.bl_id = i.bl_id AND upper(btrim(bc.container_number)) = i.container_number
    )
    ORDER BY i.bl_id, i.ord
    RETURNING bl_id, upper(btrim(container_number)) AS container_number
  )
  INSERT INTO pg_temp.tmp_container_changes (bl_id, container_number, change)
  SELECT bl_id, container_number, 'inserted' FROM inserted;

  INSERT INTO pg_temp.tmp_new_containers (id, bl_id, container_number)
  SELECT bc.id, bc.bl_id, upper(btrim(bc.container_number))
  FROM public.bl_containers AS bc
  WHERE bc.bl_id IN (
    SELECT id FROM pg_temp.tmp_bl_freight_import
    WHERE id = ANY(v_container_bls) OR id = ANY(v_vehicle_bls)
  );

  -- Veículos (ADR 0078, item 16): a chave `vehicles` só vem quando o arquivo
  -- tem a aba VIN; sem ela nada muda. Com ela, a lista vale por chassi, mas um
  -- B/L que já existia só aplica entradas, saídas e mudanças com
  -- `confirm_vehicle_changes` (a prévia mostrou e o operador confirmou). Chassi
  -- que já está em outro B/L ativo recusa só a linha.
  CREATE TEMP TABLE pg_temp.tmp_incoming_vehicles ON COMMIT DROP AS
  SELECT DISTINCT ON (t.id, upper(btrim(v.item->>'chassis')))
    t.id AS bl_id,
    upper(btrim(v.item->>'chassis')) AS chassis_key,
    btrim(v.item->>'chassis') AS chassis,
    v.item->>'brand' AS brand,
    v.item->>'model' AS model,
    NULLIF(v.item->>'weight_kg', '')::NUMERIC AS weight_kg,
    NULLIF(v.item->>'cbm', '')::NUMERIC AS cbm,
    COALESCE(NULLIF(v.item->>'voyage_id', '')::BIGINT, b.voyage_id) AS voyage_id,
    -- Migration 194 (A2): container que sai pelo arquivo não recebe veículo; a
    -- linha da aba VIN que aponta para ele é recusada como "não está no B/L".
    COALESCE(
      (SELECT given.id FROM (SELECT NULLIF(v.item->>'container_id', '')::BIGINT AS id) AS given
        WHERE NOT EXISTS (SELECT 1 FROM pg_temp.tmp_removed_containers AS r WHERE r.id = given.id)),
      (SELECT c.id FROM pg_temp.tmp_new_containers AS c
        WHERE c.bl_id = t.id AND c.container_number = upper(btrim(NULLIF(v.item->>'container_number', '')))
          AND NOT EXISTS (SELECT 1 FROM pg_temp.tmp_removed_containers AS r WHERE r.id = c.id)
        ORDER BY c.id LIMIT 1)
    ) AS container_id,
    upper(btrim(NULLIF(v.item->>'container_number', ''))) AS container_number,
    -- Migration 194 (A3; ADR 0078, itens 16 e 23, como a 184): chassi em B/L
    -- ou Viagem cancelados não recusa a linha.
    (
      SELECT ov.bl_id FROM public.vehicles AS ov
      JOIN public.bls AS ob ON ob.id = ov.bl_id
      LEFT JOIN public.voyages AS ovy ON ovy.id = ov.voyage_id
      WHERE upper(btrim(ov.chassis)) = upper(btrim(v.item->>'chassis'))
        AND ov.bl_id <> t.id
        AND ob.cancelled_at IS NULL
        AND ovy.status IS DISTINCT FROM 'cancelled'
      ORDER BY ov.bl_id LIMIT 1
    ) AS other_bl_id,
    -- Na mesma Viagem o índice único (voyage_id, chassis) não admite outra
    -- linha: o veículo do B/L cancelado (B/L reemitido) passa para este.
    cancelled_holder.vehicle_id AS cancelled_vehicle_id,
    cancelled_holder.bl_id AS cancelled_bl_id,
    v.ord
  FROM pg_temp.tmp_bl_freight_import AS t
  JOIN public.bls AS b ON b.id = t.id
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(t.payload->'vehicles') = 'array' THEN t.payload->'vehicles' ELSE '[]'::jsonb END
  ) WITH ORDINALITY AS v(item, ord)
  LEFT JOIN LATERAL (
    SELECT ov.id AS vehicle_id, ov.bl_id
    FROM public.vehicles AS ov
    JOIN public.bls AS ob ON ob.id = ov.bl_id
    WHERE ov.voyage_id = COALESCE(NULLIF(v.item->>'voyage_id', '')::BIGINT, b.voyage_id)
      AND upper(btrim(ov.chassis)) = upper(btrim(v.item->>'chassis'))
      AND ov.bl_id <> t.id
      AND ob.cancelled_at IS NOT NULL
    ORDER BY ov.id LIMIT 1
  ) AS cancelled_holder ON true
  WHERE t.id = ANY(v_vehicle_bls)
    AND NULLIF(btrim(v.item->>'chassis'), '') IS NOT NULL
  ORDER BY t.id, upper(btrim(v.item->>'chassis')), v.ord;

  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'bl_id', i.bl_id,
      'chassis', i.chassis,
      'reason', CASE
        WHEN i.other_bl_id IS NOT NULL THEN 'Chassi ja esta no B/L ' || i.other_bl_id
        ELSE 'Container ' || COALESCE(i.container_number, '(vazio)') || ' nao esta no B/L'
      END
    ) ORDER BY i.bl_id, i.ord), '[]'::jsonb)
  INTO v_vehicles_discarded
  FROM pg_temp.tmp_incoming_vehicles AS i
  WHERE i.other_bl_id IS NOT NULL OR i.container_id IS NULL;

  DELETE FROM pg_temp.tmp_incoming_vehicles WHERE other_bl_id IS NOT NULL OR container_id IS NULL;

  -- B/L que já existia com mudança de veículos sem confirmação: nada muda.
  SELECT COALESCE(array_agg(DISTINCT pending.bl_id ORDER BY pending.bl_id), ARRAY[]::TEXT[])
  INTO v_vehicle_pending_bls
  FROM (
    SELECT t.id AS bl_id
    FROM pg_temp.tmp_bl_freight_import AS t
    WHERE t.id = ANY(v_vehicle_bls)
      AND t.id IN (SELECT id FROM pg_temp.tmp_old_bl_values)
      AND NOT COALESCE(NULLIF(t.payload->>'confirm_vehicle_changes', '')::BOOLEAN, false)
      AND (
        EXISTS (
          SELECT 1 FROM public.vehicles AS ev
          WHERE ev.bl_id = t.id
            AND NOT EXISTS (SELECT 1 FROM pg_temp.tmp_incoming_vehicles AS i WHERE i.bl_id = t.id AND i.chassis_key = upper(btrim(ev.chassis)))
            AND NOT EXISTS (
              SELECT 1 FROM jsonb_array_elements(t.payload->'vehicles') AS raw(item)
              WHERE upper(btrim(raw.item->>'chassis')) = upper(btrim(ev.chassis))
            )
        )
        OR EXISTS (
          SELECT 1 FROM pg_temp.tmp_incoming_vehicles AS i
          LEFT JOIN public.vehicles AS ev ON ev.bl_id = i.bl_id AND upper(btrim(ev.chassis)) = i.chassis_key
          WHERE i.bl_id = t.id
            AND (
              ev.id IS NULL
              OR ev.brand IS DISTINCT FROM i.brand
              OR ev.model IS DISTINCT FROM i.model
              OR ev.weight_kg IS DISTINCT FROM i.weight_kg
              OR ev.cbm IS DISTINCT FROM i.cbm
              OR ev.container_id IS DISTINCT FROM i.container_id
            )
        )
      )
  ) AS pending;

  DELETE FROM pg_temp.tmp_incoming_vehicles WHERE bl_id = ANY(v_vehicle_pending_bls);

  CREATE TEMP TABLE pg_temp.tmp_vehicle_changes (
    bl_id TEXT,
    chassis TEXT,
    change TEXT
  ) ON COMMIT DROP;

  WITH updated AS (
    UPDATE public.vehicles AS ev
    SET brand = i.brand, model = i.model, weight_kg = i.weight_kg, cbm = i.cbm,
        container_id = i.container_id, voyage_id = i.voyage_id
    FROM pg_temp.tmp_incoming_vehicles AS i
    WHERE ev.bl_id = i.bl_id
      AND upper(btrim(ev.chassis)) = i.chassis_key
      AND (
        ev.brand IS DISTINCT FROM i.brand
        OR ev.model IS DISTINCT FROM i.model
        OR ev.weight_kg IS DISTINCT FROM i.weight_kg
        OR ev.cbm IS DISTINCT FROM i.cbm
        OR ev.container_id IS DISTINCT FROM i.container_id
        OR ev.voyage_id IS DISTINCT FROM i.voyage_id
      )
    RETURNING ev.bl_id, ev.chassis
  )
  INSERT INTO pg_temp.tmp_vehicle_changes SELECT bl_id, chassis, 'updated' FROM updated;

  WITH removed AS (
    DELETE FROM public.vehicles AS ev
    USING pg_temp.tmp_bl_freight_import AS t
    WHERE ev.bl_id = t.id
      AND t.id = ANY(v_vehicle_bls)
      AND NOT (t.id = ANY(v_vehicle_pending_bls))
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(t.payload->'vehicles') AS raw(item)
        WHERE upper(btrim(raw.item->>'chassis')) = upper(btrim(ev.chassis))
      )
    RETURNING ev.bl_id, ev.chassis
  )
  INSERT INTO pg_temp.tmp_vehicle_changes SELECT bl_id, chassis, 'removed' FROM removed;

  -- Migration 194 (A3): o chassi que estava no B/L cancelado da mesma Viagem
  -- passa para este B/L, com Histórico nos dois B/Ls (e o gatilho de
  -- auditoria do veículo registra B/L, container e Viagem anteriores).
  PERFORM set_config('vela.vin_reissue', 'on', true);
  WITH moved AS (
    UPDATE public.vehicles AS ev
    SET bl_id = i.bl_id, container_id = i.container_id, voyage_id = i.voyage_id,
        brand = i.brand, model = i.model, weight_kg = i.weight_kg, cbm = i.cbm
    FROM pg_temp.tmp_incoming_vehicles AS i
    WHERE ev.id = i.cancelled_vehicle_id
      AND NOT EXISTS (
        SELECT 1 FROM public.vehicles AS cur
        WHERE cur.bl_id = i.bl_id AND upper(btrim(cur.chassis)) = i.chassis_key
      )
    RETURNING ev.bl_id, ev.chassis, i.cancelled_bl_id
  ), moved_log AS (
    INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
    SELECT 'bl', moved.bl_id, 'vehicle_from_cancelled_bl', moved.cancelled_bl_id, moved.chassis, p_changed_by,
      'Reimportacao de B/L: o chassi ' || moved.chassis || ' estava no B/L cancelado ' || moved.cancelled_bl_id || ' e passou para este B/L'
    FROM moved
    UNION ALL
    SELECT 'bl', moved.cancelled_bl_id, 'vehicle_to_reissued_bl', moved.chassis, moved.bl_id, p_changed_by,
      'Reimportacao de B/L: o chassi ' || moved.chassis || ' passou deste B/L cancelado para o B/L ' || moved.bl_id
    FROM moved
  )
  INSERT INTO pg_temp.tmp_vehicle_changes SELECT bl_id, chassis, 'inserted' FROM moved;
  PERFORM set_config('vela.vin_reissue', 'off', true);

  WITH inserted AS (
    INSERT INTO public.vehicles (voyage_id, container_id, bl_id, chassis, brand, model, weight_kg, cbm)
    SELECT i.voyage_id, i.container_id, i.bl_id, i.chassis, i.brand, i.model, i.weight_kg, i.cbm
    FROM pg_temp.tmp_incoming_vehicles AS i
    WHERE NOT EXISTS (
      SELECT 1 FROM public.vehicles AS ev
      WHERE ev.bl_id = i.bl_id AND upper(btrim(ev.chassis)) = i.chassis_key
    )
    ORDER BY i.bl_id, i.ord
    RETURNING bl_id, chassis
  )
  INSERT INTO pg_temp.tmp_vehicle_changes SELECT bl_id, chassis, 'inserted' FROM inserted;

  SELECT count(*) INTO v_inserted_vehicles FROM pg_temp.tmp_vehicle_changes WHERE change = 'inserted';
  v_vehicles_skipped := jsonb_array_length(v_vehicles_discarded);

  -- Um alerta registra o B/L que já existia e o que mudou nos veículos.
  FOR v_bl_id, v_vehicle_summary IN
    SELECT vc.bl_id, jsonb_build_object(
      'inserted', COALESCE(jsonb_agg(vc.chassis ORDER BY vc.chassis) FILTER (WHERE vc.change = 'inserted'), '[]'::jsonb),
      'removed', COALESCE(jsonb_agg(vc.chassis ORDER BY vc.chassis) FILTER (WHERE vc.change = 'removed'), '[]'::jsonb),
      'updated', COALESCE(jsonb_agg(vc.chassis ORDER BY vc.chassis) FILTER (WHERE vc.change = 'updated'), '[]'::jsonb)
    )
    FROM pg_temp.tmp_vehicle_changes AS vc
    WHERE vc.bl_id IN (SELECT id FROM pg_temp.tmp_old_bl_values)
    GROUP BY vc.bl_id
    ORDER BY vc.bl_id
  LOOP
    PERFORM public.upsert_alert_item(
      'bl_vehicles_changed_on_reimport',
      'bl',
      v_bl_id,
      format(
        'Veiculos do B/L %s alterados pela reimportacao: %s entraram, %s sairam, %s mudaram.',
        v_bl_id,
        jsonb_array_length(v_vehicle_summary->'inserted'),
        jsonb_array_length(v_vehicle_summary->'removed'),
        jsonb_array_length(v_vehicle_summary->'updated')
      ),
      'bl_import',
      v_vehicle_summary || jsonb_build_object('bl_id', v_bl_id),
      '/bls/' || v_bl_id
    );
  END LOOP;

  -- Remoção do container por último: o veículo que mudou de container já saiu
  -- dele. Veículo que ainda está nele (arquivo sem aba VIN) impede a remoção.
  SELECT r.container_number, r.bl_id, ev.chassis INTO v_blocked_container, v_blocked_bl, v_blocked_chassis
  FROM pg_temp.tmp_removed_containers AS r
  JOIN public.vehicles AS ev ON ev.container_id = r.id
  ORDER BY r.bl_id, r.container_number, ev.chassis
  LIMIT 1;
  IF v_blocked_container IS NOT NULL THEN
    -- Migration 194 (A2): a recusa diz o que prende o veículo; "reimporte com
    -- a aba VIN" só vale quando o arquivo não tem a aba.
    IF NOT EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import AS t WHERE t.id = v_blocked_bl AND t.payload ? 'vehicles') THEN
      RAISE EXCEPTION
        'O container % do B/L % tem veiculos e o arquivo nao o traz. Reimporte com a aba VIN ou mova os veiculos antes de retirar o container.',
        v_blocked_container, v_blocked_bl
        USING ERRCODE = 'P0006';
    ELSIF v_blocked_bl = ANY(v_vehicle_pending_bls) THEN
      RAISE EXCEPTION
        'O container % do B/L % sai pelo arquivo e ainda tem o veículo %: confirme as mudanças de veículos da aba VIN ou mova os veículos antes de retirar o container.',
        v_blocked_container, v_blocked_bl, v_blocked_chassis
        USING ERRCODE = 'P0006';
    ELSE
      RAISE EXCEPTION
        'O container % do B/L % sai pelo arquivo, mas o veículo % continua nele: a aba VIN não o põe em outro container do B/L. Corrija a aba VIN ou mova os veículos antes de retirar o container.',
        v_blocked_container, v_blocked_bl, v_blocked_chassis
        USING ERRCODE = 'P0006';
    END IF;
  END IF;

  PERFORM set_config('vela.delete_reason', 'Reimportacao de B/L: container ausente do arquivo, remocao mostrada na previa', true);
  WITH removed AS (
    DELETE FROM public.bl_containers AS bc
    USING pg_temp.tmp_removed_containers AS r
    WHERE bc.id = r.id
    RETURNING bc.bl_id, upper(btrim(bc.container_number)) AS container_number
  )
  INSERT INTO pg_temp.tmp_container_changes (bl_id, container_number, change)
  SELECT bl_id, container_number, 'removed' FROM removed;
  PERFORM set_config('vela.delete_reason', COALESCE(v_previous_delete_reason, ''), true);

  INSERT INTO public.audit_logs (
    entity_type,
    entity_id,
    field_name,
    old_value,
    new_value,
    changed_by,
    justification
  )
  SELECT
    'bl',
    t.id,
    'ALTERACAO_OPERACIONAL_BLOQUEADA',
    NULL,
    'billing_locked',
    p_changed_by,
    'Importacao de frete do BL: alteracao com impacto em faturamento bloqueada (sem override do operador)'
  FROM pg_temp.tmp_bl_freight_import AS t
  WHERE t.billing_locked
    AND t.billing_impact
    AND NOT t.override_billing;

  INSERT INTO public.audit_logs (
    entity_type,
    entity_id,
    field_name,
    old_value,
    new_value,
    changed_by,
    justification
  )
  SELECT
    'bl',
    t.id,
    'FATURAMENTO_SOBRESCRITO',
    NULL,
    'override_billing',
    p_changed_by,
    'Importacao de frete do BL: alteracao com impacto em faturamento aplicada por override do operador'
  FROM pg_temp.tmp_bl_freight_import AS t
  WHERE t.billing_locked
    AND t.billing_impact
    AND t.override_billing;

  PERFORM public.apply_bl_review_gate_after_import(v_imported_bl_ids, p_changed_by);

  UPDATE public.bls AS b
  SET
    review_status = 'pending_review',
    billing_hold_reason = COALESCE(NULLIF(b.billing_hold_reason, ''), 'Aguardando reconciliacao de cliente antes do faturamento.'),
    notes = CASE
      WHEN COALESCE(b.notes, '') ILIKE '%Cliente vinculado por nome; validar CNPJ%' THEN b.notes
      WHEN COALESCE(b.notes, '') ILIKE '%Pendencias de importacao:%'
        THEN b.notes || ', Cliente vinculado por nome; validar CNPJ'
      ELSE CONCAT_WS(E'\n', NULLIF(BTRIM(COALESCE(b.notes, '')), ''), 'Pendencias de importacao: Cliente vinculado por nome; validar CNPJ')
    END
  WHERE b.id = ANY(v_imported_bl_ids)
    AND b.customer_reconciliation_status = 'matched_name'
    AND COALESCE(b.financial_status, 'pending') <> 'invoiced';

  FOREACH v_bl_id IN ARRAY v_imported_bl_ids LOOP
    PERFORM public.sync_customer_reconciliation_queue_for_bl(v_bl_id);
  END LOOP;

  RETURN jsonb_build_object(
    'bls_received', v_total_bls,
    'freight_lines_inserted', v_inserted_freight_lines,
    'billing_locked', v_locked_bls,
    'operational_updated', v_unlocked_bls,
    'vehicles_inserted', v_inserted_vehicles,
    'vehicles_skipped', v_vehicles_skipped,
    'container_changes', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'bl_id', grouped.bl_id,
        'inserted', grouped.inserted,
        'updated', grouped.updated,
        'removed', grouped.removed
      ) ORDER BY grouped.bl_id), '[]'::jsonb)
      FROM (
        SELECT bl_id,
          COALESCE(jsonb_agg(container_number ORDER BY container_number) FILTER (WHERE change = 'inserted'), '[]'::jsonb) AS inserted,
          COALESCE(jsonb_agg(container_number ORDER BY container_number) FILTER (WHERE change = 'updated'), '[]'::jsonb) AS updated,
          COALESCE(jsonb_agg(container_number ORDER BY container_number) FILTER (WHERE change = 'removed'), '[]'::jsonb) AS removed
        FROM pg_temp.tmp_container_changes
        GROUP BY bl_id
      ) AS grouped
    ),
    'vehicle_changes', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'bl_id', grouped.bl_id,
        'inserted', grouped.inserted,
        'updated', grouped.updated,
        'removed', grouped.removed
      ) ORDER BY grouped.bl_id), '[]'::jsonb)
      FROM (
        SELECT bl_id,
          COALESCE(jsonb_agg(chassis ORDER BY chassis) FILTER (WHERE change = 'inserted'), '[]'::jsonb) AS inserted,
          COALESCE(jsonb_agg(chassis ORDER BY chassis) FILTER (WHERE change = 'updated'), '[]'::jsonb) AS updated,
          COALESCE(jsonb_agg(chassis ORDER BY chassis) FILTER (WHERE change = 'removed'), '[]'::jsonb) AS removed
        FROM pg_temp.tmp_vehicle_changes
        GROUP BY bl_id
      ) AS grouped
    ),
    'vehicles_discarded', v_vehicles_discarded,
    'vehicle_changes_pending', to_jsonb(v_vehicle_pending_bls),
    'customer_changes_ignored', v_customer_ignored
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_records(p_kind text, p_ids text[], p_dry_run boolean DEFAULT false, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_id text;
  v_count integer;
  v_deleted jsonb := '[]'::jsonb;
  v_blocked jsonb := '[]'::jsonb;
  v_state text;
  v_message text;
  v_constraint text;
  v_entity text;
  v_lock text[];
  v_status text;
  v_bl_id text;
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_bl_voyage bigint;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Somente o Administrativo pode excluir.' USING ERRCODE = '42501';
  END IF;

  v_entity := CASE p_kind
    WHEN 'bl' THEN 'bl'
    WHEN 'container' THEN 'container'
    WHEN 'vehicle' THEN 'vehicle'
    WHEN 'customer' THEN 'customer'
    WHEN 'voyage' THEN 'voyages'
  END;
  IF v_entity IS NULL THEN
    RAISE EXCEPTION 'Tipo de exclusão desconhecido: %.', p_kind USING ERRCODE = '22023';
  END IF;
  IF NOT COALESCE(p_dry_run, false) AND v_reason IS NULL THEN
    RAISE EXCEPTION 'Informe o motivo da exclusão.' USING ERRCODE = '22023';
  END IF;

  FOREACH v_id IN ARRAY ARRAY(
    SELECT u.id FROM unnest(COALESCE(p_ids, ARRAY[]::text[])) WITH ORDINALITY AS u(id, ord)
    GROUP BY u.id ORDER BY min(u.ord)
  ) LOOP
    BEGIN
      v_lock := ARRAY[]::text[];
      IF p_kind = 'voyage' THEN
        SELECT status INTO v_status FROM public.voyages WHERE id = v_id::bigint;
        IF FOUND AND v_status = 'cancelled' THEN
          v_lock := ARRAY['viagem cancelada fica retida'];
        ELSE
          v_lock := public.delete_lock_reasons(v_id::bigint);
        END IF;
      ELSIF p_kind = 'customer' THEN
        IF EXISTS (SELECT 1 FROM public.customers c WHERE c.id = v_id::bigint AND NULLIF(btrim(c.cnpj_cpf), '') IS NOT NULL) THEN
          v_lock := ARRAY['cliente com CNPJ: desative em vez de excluir'];
        END IF;
      ELSE
        v_bl_id := CASE p_kind
          WHEN 'bl' THEN v_id
          WHEN 'container' THEN (SELECT c.bl_id FROM public.bl_containers c WHERE c.id = v_id::bigint)
          ELSE (SELECT COALESCE(v.bl_id, c.bl_id) FROM public.vehicles v
                LEFT JOIN public.bl_containers c ON c.id = v.container_id WHERE v.id = v_id::bigint)
        END;
        v_lock := public.bl_delete_lock_reasons(v_bl_id);
      END IF;
      IF cardinality(v_lock) > 0 THEN
        v_blocked := v_blocked || jsonb_build_object('id', v_id, 'reasons', to_jsonb(v_lock));
        CONTINUE;
      END IF;

      -- 380: a exclusão do B/L (ou da Viagem) leva junto os containers e
      -- veículos, mesmo de B/L cancelado, que é somente leitura no resto.
      PERFORM set_config('vela.deleting_records', CASE WHEN p_kind IN ('voyage', 'bl') THEN 'on' ELSE 'off' END, true);
      IF p_kind = 'voyage' THEN
        PERFORM public.delete_voyage_children(v_id::bigint);
        DELETE FROM public.voyages WHERE id = v_id::bigint;
      ELSIF p_kind = 'bl' THEN
        SELECT b.voyage_id INTO v_bl_voyage FROM public.bls AS b WHERE b.id = v_id;
        DELETE FROM public.vehicles WHERE bl_id = v_id;
        DELETE FROM public.bls WHERE id = v_id;
      ELSIF p_kind = 'container' THEN
        DELETE FROM public.vehicles WHERE container_id = v_id::bigint;
        DELETE FROM public.bl_containers WHERE id = v_id::bigint;
      ELSIF p_kind = 'vehicle' THEN
        DELETE FROM public.vehicles WHERE id = v_id::bigint;
      ELSE
        DELETE FROM public.customer_contacts WHERE customer_id = v_id::bigint;
        DELETE FROM public.customer_rate_overrides WHERE customer_id = v_id::bigint;
        DELETE FROM public.customers WHERE id = v_id::bigint;
      END IF;
      GET DIAGNOSTICS v_count = ROW_COUNT;
      PERFORM set_config('vela.deleting_records', 'off', true);

      IF v_count = 0 THEN
        v_blocked := v_blocked || jsonb_build_object('id', v_id, 'reasons', jsonb_build_array('não encontrado'));
      ELSIF p_dry_run THEN
        RAISE EXCEPTION USING ERRCODE = 'VL001';
      ELSE
        INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
        VALUES (v_entity, v_id, 'deleted', v_id, NULL, auth.uid(), v_reason);
        IF p_kind = 'bl' AND v_bl_voyage IS NOT NULL THEN
          INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
          VALUES ('voyages', v_bl_voyage::text, 'bl_deleted', v_id, 'excluído', auth.uid(), v_reason);
        END IF;
        v_deleted := v_deleted || to_jsonb(v_id);
      END IF;
    EXCEPTION
      WHEN SQLSTATE 'VL001' THEN
        v_deleted := v_deleted || to_jsonb(v_id);
      WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS
          v_state = RETURNED_SQLSTATE,
          v_message = MESSAGE_TEXT,
          v_constraint = CONSTRAINT_NAME;
        v_blocked := v_blocked || jsonb_build_object(
          'id', v_id,
          'reasons', jsonb_build_array(public.delete_record_block_reason(v_state, v_message, v_constraint))
        );
    END;
  END LOOP;

  RETURN jsonb_build_object('deleted', v_deleted, 'blocked', v_blocked, 'dry_run', p_dry_run);
END;
$function$;

-- 16. Refixar o preço (ADR 0094, A2) só pelo sistema até existir o aceite da
-- reimportação (frente das importações): nenhum Departamento chama pela API.
REVOKE EXECUTE ON FUNCTION public.refix_bl_local_charge_prices(text[], text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.refix_bl_local_charge_prices(text[], text) TO service_role;

-- 17. Falha de cálculo recusa a gravação (ADR 0094, B3) também no CE gravado
-- pela ficha em B/L com Cliente, na reativação do B/L e na aprovação da
-- conciliação pela Revisão.
CREATE OR REPLACE FUNCTION public.trg_auto_bill_bl_after_ce_mercante()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_previous_request_role text := current_setting('request.jwt.claim.role', true);
  v_role_impersonated boolean := false;
  v_result jsonb;
BEGIN
  -- Emissão em lotes (migration 181): a planilha grava o CE e o cálculo na
  -- transação e a tela emite logo depois por `emit_ce_mercante_billing`; o
  -- efeito local_billing registrado na gravação fica como rede.
  IF current_setting('vela.ce_billing_deferred', true) = 'on' THEN
    PERFORM public.calculate_bl_local_charges(NEW.id, v_actor, true);
    RETURN NEW;
  END IF;

  v_result := public.auto_bill_bl_after_ce_mercante(NEW.id, v_actor);
  IF v_result->>'reason' = 'auto_billing_failed'
     AND coalesce(v_result->>'message', '') LIKE 'Taxas Locais do B/L % não calculadas:%' THEN
    PERFORM public._raise_local_charge_failure(NEW.id, v_result->>'sqlstate', v_result->>'message');
  END IF;

  -- 288: sem Cliente conciliado o faturamento para antes de calcular. O CE
  -- recém-cadastrado confirma o cálculo mesmo assim (rateio com os irmãos já
  -- gravados); a fatura espera o Cliente.
  IF v_result->>'reason' = 'customer_reconciliation_pending'
     AND NULLIF(BTRIM(OLD.ce_mercante), '') IS NULL THEN
    BEGIN
      PERFORM public.calculate_bl_local_charges(NEW.id, v_actor, true);
    EXCEPTION WHEN OTHERS THEN
      -- 379 (ADR 0094, B3): o CE gravado pela ficha é recusado com a falha.
      PERFORM public._raise_local_charge_failure(NEW.id, SQLSTATE, SQLERRM);
    END;
  END IF;

  -- `held` é a retenção do Portal: quem a desfaz é a ativação do Portal ou a
  -- Liberação, não uma nova tentativa da fila.
  IF v_result->>'status' NOT IN ('invoiced', 'already_invoiced', 'skipped', 'held')
     AND NOT EXISTS (
       SELECT 1
       FROM public.import_pending_effects AS e
       WHERE e.entity_id = NEW.id
         AND e.effect_kind = 'local_billing'
         AND e.status IN ('pending', 'running', 'retry_wait')
     ) THEN
    -- A trigger disparado por uma conexão sem JWT já passou pela autorização
    -- da operação que alterou o B/L. Para deixar a recuperação registrada sem
    -- inventar um usuário, chama a fila como service_role e restaura o claim
    -- imediatamente depois do insert.
    IF auth.uid() IS NULL AND auth.role() IS DISTINCT FROM 'service_role' THEN
      PERFORM set_config('request.jwt.claim.role', 'service_role', true);
      v_role_impersonated := true;
    END IF;

    PERFORM public.enqueue_import_effect(
      gen_random_uuid(),
      'local_billing',
      NEW.id,
      v_actor,
      1,
      NULL,
      jsonb_build_object(
        'source', 'ce_mercante_auto_billing',
        'ce_mercante', NEW.ce_mercante,
        'reason', v_result->>'reason',
        'message', v_result->>'message',
        'actor_source', CASE WHEN v_actor IS NULL THEN 'system' ELSE 'request' END
      )
    );

    IF v_role_impersonated THEN
      PERFORM set_config('request.jwt.claim.role', COALESCE(v_previous_request_role, ''), true);
      v_role_impersonated := false;
    END IF;
  END IF;

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    IF v_role_impersonated THEN
      PERFORM set_config('request.jwt.claim.role', COALESCE(v_previous_request_role, ''), true);
    END IF;
    RAISE;
END;
$function$;

CREATE OR REPLACE FUNCTION public.reactivate_bl(p_bl_id text, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Somente o Administrativo reativa B/L.' USING ERRCODE = '42501';
  END IF;
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'Informe o motivo da reativação.' USING ERRCODE = '22023';
  END IF;
  PERFORM set_config('vela.allow_bl_state', 'on', true);
  UPDATE public.bls SET cancelled_at = NULL, cancelled_by = NULL, cancel_reason = NULL
  WHERE id = p_bl_id AND cancelled_at IS NOT NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L % não está cancelado.', p_bl_id USING ERRCODE = 'P0002';
  END IF;
  PERFORM set_config('vela.allow_bl_state', 'off', true);
  INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  VALUES ('bl', p_bl_id, 'cancelled', 'true', 'false', auth.uid(), v_reason);

  -- F-30 (372): o B/L reativado é recalculado (o cancelamento apagou o
  -- cálculo), e os efeitos de importação encerrados pelo cancelamento voltam à
  -- fila, como na reativação da Viagem (211; revisão das importações, 2d).
  IF EXISTS (SELECT 1 FROM public.bls WHERE id = p_bl_id AND coalesce(financial_status, 'pending') = 'pending') THEN
    BEGIN
      PERFORM public._calculate_bl_local_charges_impl_106(p_bl_id, auth.uid(), true);
    EXCEPTION WHEN OTHERS THEN
      PERFORM public._raise_local_charge_failure(p_bl_id, SQLSTATE, SQLERRM);
    END;
  END IF;
  WITH reopen AS (
    SELECT DISTINCT ON (e.effect_kind) e.id
    FROM public.import_pending_effects AS e
    WHERE e.entity_id = p_bl_id AND e.status = 'superseded' AND e.result->>'reason' = 'bl_cancelled'
      AND NOT EXISTS (SELECT 1 FROM public.import_pending_effects AS newer
        WHERE newer.entity_id = e.entity_id AND newer.effect_kind = e.effect_kind AND newer.id > e.id AND newer.status <> 'superseded')
    ORDER BY e.effect_kind, e.id DESC
  )
  UPDATE public.import_pending_effects AS e
     SET status = 'pending', next_attempt_at = now(), lease_until = NULL, leased_by = NULL,
         result = COALESCE(e.result, '{}'::jsonb) || jsonb_build_object('reopened_on_bl_reactivation', now()),
         updated_at = now()
    FROM reopen WHERE e.id = reopen.id;
  RETURN jsonb_build_object('reactivated', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.approve_customer_reconciliation(p_queue_id bigint, p_customer_id bigint DEFAULT NULL::bigint, p_notes text DEFAULT NULL::text, p_actor uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_queue RECORD;
  v_actor UUID;
  v_target_customer_id BIGINT;
  v_financial_status TEXT;
  v_calculation_error TEXT;
BEGIN
  -- O autor é quem está logado (ADR 0085, regra base 2; migration 241).
  PERFORM public._assert_actor_is_caller(p_actor);
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa' USING ERRCODE = '42501';
  END IF;

  IF NOT public.is_admin() AND p_actor IS NOT NULL AND p_actor IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'O ator informado deve ser o usuario autenticado.' USING ERRCODE = '42501';
  END IF;
  v_actor := CASE WHEN public.is_admin() THEN COALESCE(p_actor, auth.uid()) ELSE auth.uid() END;

  SELECT * INTO v_queue
  FROM public.customer_reconciliation_queue
  WHERE id = p_queue_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item de reconciliacao % nao encontrado.', p_queue_id USING ERRCODE = 'P0002';
  END IF;

  v_target_customer_id := COALESCE(p_customer_id, v_queue.customer_id);
  IF v_target_customer_id IS NULL THEN
    RAISE EXCEPTION 'Informe um cliente para aprovar a reconciliacao.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.bls
  SET
    customer_id = v_target_customer_id,
    suggested_customer_id = NULL,
    customer_reconciliation_status = 'reconciled',
    customer_reconciliation_notes = COALESCE(NULLIF(TRIM(COALESCE(p_notes, '')), ''), 'Cliente reconciliado manualmente.'),
    billing_hold_reason = NULL
  WHERE id = v_queue.bl_id;

  UPDATE public.customer_reconciliation_queue
  SET
    customer_id = v_target_customer_id,
    status = 'approved',
    resolution_notes = COALESCE(NULLIF(TRIM(COALESCE(p_notes, '')), ''), 'Cliente reconciliado manualmente.'),
    approved_by = v_actor,
    approved_at = now(),
    rejected_by = NULL,
    rejected_at = NULL
  WHERE id = p_queue_id;

  PERFORM public.capture_manifest_financial_contact(
    v_target_customer_id,
    v_queue.manifest_customer_email
  );

  PERFORM public.sync_customer_reconciliation_queue_for_bl(v_queue.bl_id);

  -- Se o B/L ainda nao foi faturado, recalcula as taxas locais com as condicoes
  -- especiais do novo cliente vinculado e gera o recebivel no ledger (bl_receivables)
  SELECT financial_status INTO v_financial_status
  FROM public.bls
  WHERE id = v_queue.bl_id;

  IF v_financial_status IS NULL OR v_financial_status = 'pending' THEN
    BEGIN
      PERFORM public.calculate_bl_local_charges(v_queue.bl_id, v_actor, true);
    EXCEPTION WHEN OTHERS THEN
      PERFORM public._raise_local_charge_failure(v_queue.bl_id, SQLSTATE, SQLERRM);
    END;
  END IF;

  INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification)
  VALUES (
    'bl', v_queue.bl_id, 'customer_reconciliation_status', COALESCE(v_queue.status, 'pending'), 'reconciled',
    v_actor, now(), COALESCE(NULLIF(TRIM(COALESCE(p_notes, '')), ''), 'Cliente reconciliado manualmente.')
  );

  RETURN jsonb_build_object(
    'queue_id', p_queue_id,
    'bl_id', v_queue.bl_id,
    'customer_id', v_target_customer_id,
    'status', 'approved',
    'calculation_error', v_calculation_error
  );
END;
$function$;

-- 18. Lançamento manual (ADR 0093, decisão 1; ADR 0094, A1/A3): usa a tabela
-- vinculada ao B/L mesmo que ela tenha sido desativada (reajuste) e o preço
-- fixado do item (valor e Condição da importação); só o item sem preço
-- fixado segue o valor e a Condição da data de referência.
CREATE OR REPLACE FUNCTION public.list_manual_charge_items_for_bl(p_bl_id text)
 RETURNS TABLE(charge_item_id bigint, charge_item_name text, charge_table_id bigint, charge_table_name text, cargo_mode text, pod text, currency text, default_unit_value_brl numeric, default_unit_value_usd numeric, effective_unit_value_brl numeric, effective_unit_value_usd numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_read_user() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH bl_ctx AS (
    SELECT b.id, b.customer_id, b.pod,
      public.bl_local_charge_reference_date(b.id) AS reference_date
    FROM public.bls AS b
    LEFT JOIN public.import_batches AS ib ON ib.id = b.batch_id
    WHERE b.id = upper(btrim(p_bl_id))
  )
  SELECT cti.id, cti.name, ct.id, ct.name, ct.cargo_mode, ct.pod,
    COALESCE(cti.currency, 'BRL'), cti.unit_value_brl, cti.unit_value_usd,
    CASE WHEN COALESCE(cti.currency, 'BRL') = 'USD' THEN NULL
         WHEN fi.charge_item_id IS NOT NULL THEN COALESCE(fi.override_value, fi.unit_value_brl, cti.value_brl, 0)
         ELSE COALESCE(cro.override_value, cti.unit_value_brl, cti.value_brl, 0) END,
    CASE WHEN COALESCE(cti.currency, 'BRL') <> 'USD' THEN NULL
         WHEN fi.charge_item_id IS NOT NULL THEN COALESCE(fi.override_value, fi.unit_value_usd, 0)
         ELSE COALESCE(cro.override_value, cti.unit_value_usd, 0) END
  FROM bl_ctx
  JOIN public.charge_tables AS ct ON ct.id IN (
      SELECT resolved.table_id
      FROM public.resolve_bl_local_charge_table_ids(bl_ctx.id, bl_ctx.reference_date) AS resolved
    )
    AND (
      public.normalize_port_code(ct.pod) = public.normalize_port_code(bl_ctx.pod)
      OR upper(trim(coalesce(ct.pod, ''))) = 'ANY'
    )
  JOIN public.charge_table_items AS cti ON cti.charge_table_id = ct.id
    AND COALESCE(cti.active, true) = true
    AND COALESCE(cti.manual_only, false) = true
  LEFT JOIN LATERAL (
    SELECT cro.override_value
    FROM public.customer_rate_overrides AS cro
    WHERE cro.active
          AND cro.customer_id = bl_ctx.customer_id
      AND cro.charge_item_id = cti.id
      AND (cro.valid_from IS NULL OR cro.valid_from <= bl_ctx.reference_date)
      AND (cro.valid_to IS NULL OR cro.valid_to >= bl_ctx.reference_date)
    ORDER BY cro.created_at DESC
    LIMIT 1
  ) AS cro ON true
  LEFT JOIN public.bl_price_freeze_items AS fi ON fi.bl_id = bl_ctx.id AND fi.charge_item_id = cti.id
  ORDER BY ct.valid_from DESC, ct.id DESC, COALESCE(cti.sort_order, 100), cti.id;
END;
$function$;

CREATE OR REPLACE FUNCTION public._add_manual_bl_charge_impl_106(p_bl_id text, p_charge_item_id bigint, p_quantity numeric DEFAULT 1, p_notes text DEFAULT NULL::text, p_actor uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bl record;
  v_item record;
  v_actor uuid;
  v_qty numeric(12,6);
  v_unit_brl numeric(12,2);
  v_unit_usd numeric(12,2);
  v_total_brl numeric(14,2);
  v_total_usd numeric(14,2);
  v_key text;
  v_calc_id bigint;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa' USING ERRCODE = '42501';
  END IF;
  v_actor := COALESCE(p_actor, auth.uid());

  SELECT b.id, b.customer_id, COALESCE(b.cargo_mode, 'container') AS cargo_mode,
    b.pod, b.charge_status, b.financial_status, b.cancelled_at,
    public.bl_local_charge_reference_date(b.id) AS reference_date
  INTO v_bl
  FROM public.bls AS b
  WHERE b.id = upper(btrim(p_bl_id));
  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L % nao encontrado', p_bl_id USING ERRCODE = 'P0002';
  END IF;

  IF v_bl.cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION 'B/L % cancelado e somente leitura; nao e permitido lancar taxa manual.', p_bl_id USING ERRCODE = '22023';
  END IF;

  IF COALESCE(v_bl.financial_status, 'open') IN ('invoiced', 'partially_paid', 'paid') THEN
    RAISE EXCEPTION 'B/L % ja foi faturado (status financeiro=%); nao e permitido lancar taxa manual.',
      p_bl_id, v_bl.financial_status USING ERRCODE = '22023';
  END IF;

  SELECT cti.id, cti.name, COALESCE(cti.currency, 'BRL') AS currency,
    cti.unit_value_brl, cti.unit_value_usd, cti.value_brl,
    ct.id AS charge_table_id, ct.name AS charge_table_name, ct.cargo_mode, ct.pod,
    cro.override_value,
    fi.charge_item_id AS frozen_item, fi.unit_value_brl AS frozen_brl,
    fi.unit_value_usd AS frozen_usd, fi.override_value AS frozen_override
  INTO v_item
  FROM public.charge_table_items AS cti
  JOIN public.charge_tables AS ct ON ct.id = cti.charge_table_id
    AND ct.id IN (
      SELECT resolved.table_id
      FROM public.resolve_bl_local_charge_table_ids(v_bl.id, v_bl.reference_date) AS resolved
    )
    AND (
      public.normalize_port_code(ct.pod) = public.normalize_port_code(v_bl.pod)
      OR upper(trim(coalesce(ct.pod, ''))) = 'ANY'
    )
  LEFT JOIN LATERAL (
    SELECT cro.override_value
    FROM public.customer_rate_overrides AS cro
    WHERE cro.active
          AND cro.customer_id = v_bl.customer_id
      AND cro.charge_item_id = cti.id
      AND (cro.valid_from IS NULL OR cro.valid_from <= v_bl.reference_date)
      AND (cro.valid_to IS NULL OR cro.valid_to >= v_bl.reference_date)
    ORDER BY cro.created_at DESC
    LIMIT 1
  ) AS cro ON true
  LEFT JOIN public.bl_price_freeze_items AS fi ON fi.bl_id = v_bl.id AND fi.charge_item_id = cti.id
  WHERE cti.id = p_charge_item_id
    AND COALESCE(cti.active, true) = true
    AND COALESCE(cti.manual_only, false) = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item manual % nao elegivel para este B/L', p_charge_item_id USING ERRCODE = '22023';
  END IF;

  v_qty := COALESCE(p_quantity, 1);
  IF v_qty <= 0 THEN
    RAISE EXCEPTION 'Quantidade deve ser maior que zero' USING ERRCODE = '22023';
  END IF;
  IF v_item.currency = 'USD' THEN
    v_unit_brl := NULL;
    v_unit_usd := CASE WHEN v_item.frozen_item IS NOT NULL THEN COALESCE(v_item.frozen_override, v_item.frozen_usd, 0)
      ELSE COALESCE(v_item.override_value, v_item.unit_value_usd, 0) END;
    v_total_brl := NULL;
    v_total_usd := round(v_qty * COALESCE(v_unit_usd, 0), 2);
  ELSE
    v_unit_brl := CASE WHEN v_item.frozen_item IS NOT NULL THEN COALESCE(v_item.frozen_override, v_item.frozen_brl, v_item.value_brl, 0)
      ELSE COALESCE(v_item.override_value, v_item.unit_value_brl, v_item.value_brl, 0) END;
    v_unit_usd := NULL;
    v_total_brl := round(v_qty * COALESCE(v_unit_brl, 0), 2);
    v_total_usd := NULL;
  END IF;

  v_key := concat('manual:item:', p_charge_item_id, ':',
    extract(epoch FROM clock_timestamp())::bigint, ':', floor(random() * 100000)::int);

  INSERT INTO public.charge_calculations (
    bl_id, charge_table_id, charge_item_id, quantity, unit_value_brl, unit_value_usd,
    total_value_brl, total_value_usd, override_applied, source, status,
    calculation_key, notes, manual_reason, created_by, calculated_at
  ) VALUES (
    v_bl.id, v_item.charge_table_id, p_charge_item_id, v_qty, v_unit_brl, v_unit_usd,
    v_total_brl, v_total_usd, (CASE WHEN v_item.frozen_item IS NOT NULL THEN v_item.frozen_override ELSE v_item.override_value END) IS NOT NULL, 'manual', 'reviewed',
    v_key, NULLIF(trim(coalesce(p_notes, '')), ''), 'other_charge_manual', v_actor, now()
  ) RETURNING id INTO v_calc_id;

  UPDATE public.bls
  SET charge_status = CASE WHEN charge_status IN ('not_calculated', 'exempt') THEN 'reviewed' ELSE charge_status END,
      charges_calculated_at = COALESCE(charges_calculated_at, now()),
      charges_reviewed_at = CASE WHEN charge_status IN ('not_calculated', 'exempt') THEN now() ELSE charges_reviewed_at END
  WHERE id = v_bl.id;

  INSERT INTO public.audit_logs (
    entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification
  ) VALUES (
    'charge_calculation', v_calc_id::text, 'manual_insert', NULL,
    concat(v_item.name, ' | qty=', v_qty, ' | total=', coalesce(v_total_brl::text, v_total_usd::text)),
    auth.uid(), now(), coalesce(nullif(trim(coalesce(p_notes, '')), ''), 'Lancamento manual de other charge')
  );

  RETURN jsonb_build_object(
    'id', v_calc_id, 'bl_id', v_bl.id, 'status', 'reviewed', 'currency', v_item.currency,
    'quantity', v_qty, 'unit_value_brl', v_unit_brl, 'unit_value_usd', v_unit_usd,
    'total_value_brl', v_total_brl, 'total_value_usd', v_total_usd
  );
END;
$function$;

-- 19. Editar o nome do item (ou a ordem) não é correção de preço: nada
-- muda. O preço fixado só acompanha o item quando o valor ou a moeda mudam
-- (ADR 0093, decisão 2); as demais regras do item recalculam o B/L.
CREATE OR REPLACE FUNCTION public.reprice_bls_on_charge_item_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bls text[];
BEGIN
  IF TG_OP = 'UPDATE' AND (to_jsonb(NEW) - 'created_at' - 'sort_order' - 'name') = (to_jsonb(OLD) - 'created_at' - 'sort_order' - 'name') THEN
    RETURN NULL;
  END IF;
  -- O preço congelado no CE é corrigido junto (decisão 2 prevalece sobre a 3).
  IF TG_OP = 'UPDATE' AND (NEW.unit_value_brl, NEW.unit_value_usd, NEW.value_brl, NEW.currency)
                          IS DISTINCT FROM (OLD.unit_value_brl, OLD.unit_value_usd, OLD.value_brl, OLD.currency) THEN
    UPDATE public.bl_price_freeze_items
       SET unit_value_brl = NEW.unit_value_brl, unit_value_usd = NEW.unit_value_usd
     WHERE charge_item_id = NEW.id;
  END IF;
  SELECT array_agg(DISTINCT l.bl_id) INTO v_bls
  FROM public.bl_charge_table_links l
  WHERE l.charge_table_id IN (NEW.charge_table_id, CASE WHEN TG_OP = 'UPDATE' THEN OLD.charge_table_id END);
  IF v_bls IS NOT NULL THEN
    PERFORM public._reprice_bls_after_tariff_change(v_bls, true, true);
  END IF;
  RETURN NULL;
END;
$function$;

-- 20. Correção de Condição (ADR 0093, decisão 2) alcança só os B/Ls cujo
-- preço fixado usou aquela Condição; quem foi importado sem ela continua sem
-- ela (ADR 0094, A3). O preço fixado guarda a Condição usada (override_id),
-- preenchida por gatilho em toda gravação do valor da Condição.
ALTER TABLE public.bl_price_freeze_items
  ADD COLUMN override_id bigint REFERENCES public.customer_rate_overrides(id) ON DELETE SET NULL;
COMMENT ON COLUMN public.bl_price_freeze_items.override_id IS
  'Condição de Cliente usada no preço fixado (ADR 0094); a correção dela alcança só estas linhas.';

CREATE OR REPLACE FUNCTION public.bl_price_freeze_item_override_id()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  NEW.override_id := CASE WHEN NEW.override_value IS NULL THEN NULL ELSE (
    SELECT cro.id FROM public.customer_rate_overrides cro
    JOIN public.bls b ON b.id = NEW.bl_id
    JOIN public.bl_price_freezes f ON f.bl_id = NEW.bl_id
    WHERE cro.active AND cro.customer_id = b.customer_id AND cro.charge_item_id = NEW.charge_item_id
      AND cro.override_value = NEW.override_value
      AND (cro.valid_from IS NULL OR cro.valid_from <= f.reference_date)
      AND (cro.valid_to IS NULL OR cro.valid_to >= f.reference_date)
    ORDER BY cro.id DESC LIMIT 1) END;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.bl_price_freeze_item_override_id() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER bl_price_freeze_item_override_id
  BEFORE INSERT OR UPDATE OF override_value ON public.bl_price_freeze_items
  FOR EACH ROW EXECUTE FUNCTION public.bl_price_freeze_item_override_id();

-- Preço fixado existente ganha a Condição usada. Data status (AGENTS.md,
-- seção Gotchas): os dados de produção são de teste; a migration regrava
-- linhas existentes de bl_price_freeze_items.
UPDATE public.bl_price_freeze_items SET override_value = override_value WHERE override_value IS NOT NULL;

CREATE OR REPLACE FUNCTION public.reprice_bls_on_customer_rate_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bls text[];
  v_correction boolean;
BEGIN
  -- ADR 0094, A3: criar, ativar ou desativar Condição não mexe em B/L
  -- existente (vale para os que entrarem depois ou para a reimportação com
  -- aceite). Mudar valor ou vigência de Condição ativa é correção (decisão 2
  -- da ADR 0093): vale para todos os B/Ls na vigência antiga ou nova.
  v_correction := TG_OP = 'UPDATE' AND OLD.active AND NEW.active;
  IF NOT v_correction THEN
    RETURN NULL;
  END IF;
  IF v_correction AND OLD.override_value = NEW.override_value AND OLD.valid_from IS NOT DISTINCT FROM NEW.valid_from
     AND OLD.valid_to IS NOT DISTINCT FROM NEW.valid_to AND OLD.charge_item_id IS NOT DISTINCT FROM NEW.charge_item_id
     AND OLD.customer_id IS NOT DISTINCT FROM NEW.customer_id THEN
    RETURN NULL;
  END IF;

  -- Correção: os B/Ls cujo preço fixado usou esta Condição acompanham; fora
  -- da vigência corrigida (ou de outro Cliente/Item), voltam ao preço da
  -- tabela fixado.
  SELECT array_agg(DISTINCT fi.bl_id) INTO v_bls
  FROM public.bl_price_freeze_items fi JOIN public.bls b ON b.id = fi.bl_id
  WHERE fi.override_id = OLD.id AND b.cancelled_at IS NULL;
  UPDATE public.bl_price_freeze_items fi
     SET override_value = CASE
       WHEN b.customer_id = NEW.customer_id AND fi.charge_item_id = NEW.charge_item_id
        AND f.reference_date >= coalesce(NEW.valid_from, f.reference_date)
        AND f.reference_date <= coalesce(NEW.valid_to, f.reference_date)
       THEN NEW.override_value END
    FROM public.bl_price_freezes f JOIN public.bls b ON b.id = f.bl_id
   WHERE fi.bl_id = f.bl_id AND fi.override_id = OLD.id;
  IF v_bls IS NOT NULL THEN
    PERFORM public._reprice_bls_after_tariff_change(v_bls, v_correction, v_correction);
  END IF;
  RETURN NULL;
END;
$function$;

CREATE INDEX bl_price_freeze_items_override_id_idx ON public.bl_price_freeze_items (override_id);

-- 21. Backfill da 378 (ADR 0094, A4): o B/L não faturado com cálculo gravado
-- antes do preço fixo (Condição escolhida pela ETA) é recalculado na emissão:
-- a base gravada deixa de bater e a emissão recalcula com o preço fixado.
-- Data status (AGENTS.md, seção Gotchas): os dados de produção são de teste;
-- a migration regrava linhas existentes de bl_charge_calculation_basis.
INSERT INTO public.bl_charge_calculation_basis (bl_id, basis)
SELECT b.id, '{}'::jsonb
FROM public.bls b
WHERE b.cancelled_at IS NULL AND coalesce(b.financial_status, 'pending') = 'pending'
  AND EXISTS (SELECT 1 FROM public.charge_calculations cc WHERE cc.bl_id = b.id)
ON CONFLICT (bl_id) DO UPDATE SET basis = '{}'::jsonb;

-- 22. Cancelar baixa (376): depois de abrir o alerta como service_role, o
-- papel volta ao que era (não a 'authenticated' fixo).
CREATE OR REPLACE FUNCTION public.reverse_invoice_payment(p_payment_id bigint, p_reason text DEFAULT NULL::text, p_actor uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_invoice_id bigint; bl_id text; refund record; result jsonb; v_e2e text;
  v_previous_role text := current_setting('request.jwt.claim.role', true);
BEGIN
  -- O autor é quem está logado (ADR 0085, regra base 2; migration 241).
  PERFORM public._assert_actor_is_caller(p_actor);
 IF auth.uid() IS NULL OR NOT public.is_admin() OR p_actor IS NOT NULL AND p_actor<>auth.uid() THEN RAISE EXCEPTION 'Sem permissão para cancelar baixa.' USING ERRCODE='42501'; END IF;
 IF length(btrim(coalesce(p_reason,'')))=0 THEN RAISE EXCEPTION 'Informe o motivo do cancelamento da baixa.' USING ERRCODE='22023'; END IF;
 SELECT p.invoice_id INTO v_invoice_id FROM public.payments p WHERE p.id=p_payment_id;
 FOR bl_id IN SELECT l.bl_id FROM public.invoice_receivable_links l WHERE l.invoice_id=v_invoice_id
 UNION SELECT ib.bl_id FROM public.invoice_bls ib WHERE ib.invoice_id=v_invoice_id ORDER BY 1 LOOP
   PERFORM pg_advisory_xact_lock(hashtextextended('bl:'||bl_id,0)); END LOOP;
 PERFORM 1 FROM public.invoices i WHERE i.id=v_invoice_id FOR UPDATE;
 PERFORM 1 FROM public.payments WHERE id=p_payment_id FOR UPDATE;
 -- Só excedente automático que nunca foi devolvido pode acompanhar baixa falsa.
 -- Restituição por correção/COD/autorizações independentes permanece protegida.
 FOR refund IN SELECT * FROM public.invoice_refunds WHERE payment_id=p_payment_id AND status='pending'
   AND origin='existing' AND cod_adjustment_id IS NULL AND correction_receivable_id IS NULL FOR UPDATE LOOP
   UPDATE public.invoice_refunds SET status='cancelled',notes=concat_ws(E'\n',notes,'Baixa sem recebimento cancelada: '||btrim(p_reason)) WHERE id=refund.id;
   INSERT INTO public.audit_logs(entity_type,entity_id,field_name,old_value,new_value,changed_by,justification)
    VALUES('invoice_refund',refund.id::text,'pending_excess_cancelled',to_jsonb(refund)::text,'cancelled',auth.uid(),btrim(p_reason));
 END LOOP;
 -- F-47 (376): excedente já devolvido impede o estorno; o pendente de outra
 -- origem é cancelado (não apagado em cascata com a baixa).
 IF EXISTS(SELECT 1 FROM public.invoice_refunds WHERE payment_id=p_payment_id AND status='settled') THEN
   RAISE EXCEPTION 'O excedente desta baixa já foi devolvido ao Cliente: a baixa não pode ser cancelada.' USING ERRCODE='22023';
 END IF;
 UPDATE public.invoice_refunds SET status='cancelled',notes=concat_ws(E'\n',notes,'Baixa cancelada: '||btrim(p_reason))
 WHERE payment_id=p_payment_id AND status='pending';
 -- Baixa automática Itaú cancelada: o Pix volta para análise do Financeiro.
 SELECT upper(btrim(bank_reference)) INTO v_e2e FROM public.payments WHERE id=p_payment_id;
 result := public.reverse_invoice_payment_legacy_134(p_payment_id,p_reason,auth.uid());
 IF v_e2e IS NOT NULL AND EXISTS(SELECT 1 FROM public.itau_pix_receipts WHERE end_to_end_id=v_e2e AND status IN ('settled','handled')) THEN
   UPDATE public.itau_pix_receipts SET status='review',reason='Baixa cancelada: '||btrim(p_reason),handled_at=NULL,handled_by=NULL,handled_note=NULL
   WHERE end_to_end_id=v_e2e;
   PERFORM set_config('request.jwt.claim.role','service_role',true);
   PERFORM public.upsert_alert_item('pix_unreconciled','itau_pix_receipt',v_e2e,
     'A baixa automática do Pix '||v_e2e||' foi cancelada ('||btrim(p_reason)||'): dê a baixa na fatura certa ou registre a devolução.',
     'itau_pix','administrativo',jsonb_build_object('end_to_end_id',v_e2e,'payment_id',p_payment_id),'/reconciliacao');
   PERFORM set_config('request.jwt.claim.role',coalesce(v_previous_role,''),true);
 END IF;
 -- Avulsa não tem recebível de B/L; sua dívida é o total emitido menos baixas.
 UPDATE public.invoices SET balance_brl=greatest(total_brl-total_paid_brl,0),
   status=CASE WHEN total_paid_brl=0 THEN 'issued' WHEN total_brl-total_paid_brl<=0 THEN 'paid' ELSE 'partially_paid' END
 WHERE id=v_invoice_id AND invoice_type='manual' AND status<>'cancelled';
 RETURN result || jsonb_build_object('new_status',(SELECT status FROM public.invoices WHERE id=v_invoice_id));
END $function$;
