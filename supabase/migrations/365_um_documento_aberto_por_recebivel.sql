-- 365: um documento local aberto por recebível; a consolidada interna conta
-- como faturamento do B/L sem individual (ADR 0093, decisão 9; plano da
-- frente financeira, F-15).
--
-- Problema: a consolidada interna aceitava B/L sem individual sem marcá-lo
-- nem conferir a prontidão (`create_local_consolidated_invoice_core`, 019), e
-- o Emitir depois tirava uma individual por cima; `link_invoice_to_ledger`
-- virava "consolidada" a fatura de vários B/Ls sem conferir se algum já
-- tinha individual aberta. Ficavam dois documentos abertos cobrando o mesmo
-- recebível.
--
-- Mudança:
--   1. A consolidada roda as checagens do Emitir (`mark_bl_ready_for_billing`)
--      para o B/L sem individual viva e o marca como faturado.
--   2. Gatilho `trg_single_open_local_document`: o vínculo ativo novo de uma
--      individual aberta é recusado quando o recebível já tem outra
--      individual aberta ou está numa consolidada aberta.
--   3. A reemissão automática da consolidada encerra quando um B/L ficou
--      isento, em vez de esperar para sempre.
--
-- Não altera nem apaga linhas existentes.

CREATE OR REPLACE FUNCTION public.guard_single_open_local_document()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status <> 'active' OR NOT EXISTS (
    SELECT 1 FROM public.invoices i WHERE i.id = NEW.invoice_id AND i.invoice_type = 'individual'
      AND coalesce(i.status, 'issued') IN ('draft', 'issued', 'partially_paid')) THEN
    RETURN NEW;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.invoice_receivable_links l JOIN public.invoices o ON o.id = l.invoice_id
    WHERE l.receivable_id = NEW.receivable_id AND l.invoice_id <> NEW.invoice_id AND l.status = 'active'
      AND o.invoice_type IN ('individual', 'consolidated')
      AND coalesce(o.status, 'issued') IN ('draft', 'issued', 'partially_paid')) THEN
    RAISE EXCEPTION 'O B/L % ja tem documento de Taxas Locais aberto (individual ou consolidada); nao emita outro por cima.', NEW.bl_id
      USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_single_open_local_document() FROM PUBLIC, anon, authenticated;
-- Só na emissão (INSERT): o estorno que devolve a individual coberta à
-- consolidada reaberta reativa o vínculo de propósito.
CREATE TRIGGER trg_single_open_local_document
  BEFORE INSERT ON public.invoice_receivable_links
  FOR EACH ROW EXECUTE FUNCTION public.guard_single_open_local_document();

CREATE OR REPLACE FUNCTION public.create_local_consolidated_invoice_core(p_customer_id bigint, p_receivable_ids bigint[], p_actor uuid DEFAULT NULL::uuid, p_origin text DEFAULT 'internal'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_ids BIGINT[];
  v_count INTEGER;
  v_invoice_id BIGINT;
  v_invoice_number TEXT;
  v_total NUMERIC(14,2);
  v_missing_roe_count INTEGER;
  v_bl_without_individual TEXT;
BEGIN
  SELECT ARRAY_AGG(DISTINCT id ORDER BY id)
  INTO v_ids
  FROM UNNEST(COALESCE(p_receivable_ids, ARRAY[]::BIGINT[])) AS u(id)
  WHERE id IS NOT NULL;

  IF COALESCE(ARRAY_LENGTH(v_ids, 1), 0) < 1 THEN
    RAISE EXCEPTION 'Nenhum receivable informado para consolidar.' USING ERRCODE = '22023';
  END IF;

  IF NOT public.customer_billing_access_ready(p_customer_id) THEN
    RAISE EXCEPTION 'Emissao consolidada bloqueada: conta do Portal do cliente nao esta pronta para receber a fatura.' USING ERRCODE = 'P0003';
  END IF;

  PERFORM 1 FROM public.bl_receivables WHERE id = ANY(v_ids) ORDER BY id FOR UPDATE;

  -- ADR 0093, decisão 9 (365): B/L sem individual viva entra na consolidada
  -- como faturamento dele: passa pelas checagens do Emitir (Revisão, CE,
  -- gate) e fica "faturado"; nenhuma individual sai por cima enquanto ela
  -- estiver aberta (gatilho trg_single_open_local_document).
  FOR v_bl_without_individual IN
    SELECT br.bl_id FROM public.bl_receivables br
    WHERE br.id = ANY(v_ids)
      AND NOT EXISTS (
        SELECT 1 FROM public.invoice_receivable_links l JOIN public.invoices i ON i.id = l.invoice_id
        WHERE l.receivable_id = br.id AND l.status = 'active' AND i.invoice_type = 'individual'
          AND coalesce(i.status, 'issued') IN ('draft', 'issued', 'partially_paid'))
    ORDER BY br.bl_id
  LOOP
    PERFORM public.mark_bl_ready_for_billing(v_bl_without_individual, p_actor);
    UPDATE public.bls SET financial_status = 'invoiced'
     WHERE id = v_bl_without_individual AND coalesce(financial_status, 'pending') = 'pending';
  END LOOP;

  SELECT COUNT(*) INTO v_count FROM public.bl_receivables WHERE id = ANY(v_ids);
  IF v_count <> ARRAY_LENGTH(v_ids, 1) THEN
    RAISE EXCEPTION 'Receivable(s) inexistente(s) na selecao.' USING ERRCODE = 'P0002';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.bl_receivables WHERE id = ANY(v_ids) AND customer_id <> p_customer_id
  ) THEN
    RAISE EXCEPTION 'Selecao contem receivables de clientes diferentes.' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.bl_receivables
    WHERE id = ANY(v_ids) AND (status NOT IN ('open', 'partially_settled') OR balance_brl <= 0)
  ) THEN
    RAISE EXCEPTION 'Todos os receivables precisam estar abertos com saldo positivo.' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.invoice_receivable_links l
    JOIN public.invoices inv ON inv.id = l.invoice_id
    WHERE l.receivable_id = ANY(v_ids)
      AND inv.invoice_type = 'consolidated'
      AND COALESCE(inv.status, 'issued') IN ('draft', 'issued', 'partially_paid', 'overdue')
  ) THEN
    RAISE EXCEPTION 'Um ou mais B/Ls ja estao em consolidada aberta.' USING ERRCODE = '23505';
  END IF;

  SELECT COALESCE(SUM(balance_brl), 0) INTO v_total
  FROM public.bl_receivables WHERE id = ANY(v_ids);

  INSERT INTO public.invoices (
    customer_id, bl_id, issued_at, total_brl, status, invoice_type,
    notes, total_paid_brl, balance_brl, issued_by
  )
  VALUES (
    p_customer_id, NULL, now(), v_total, 'issued', 'consolidated',
    NULL, 0, v_total, p_actor
  )
  RETURNING id, invoice_number INTO v_invoice_id, v_invoice_number;

  INSERT INTO public.invoice_receivable_links (invoice_id, receivable_id, bl_id, subtotal_brl, status, bl_snapshot)
  SELECT
    v_invoice_id, br.id, br.bl_id, br.balance_brl, 'active',
    jsonb_build_object('bl_id', br.bl_id, 'voyage_id', br.voyage_id, 'cargo_mode', br.cargo_mode, 'pol', br.pol, 'pod', br.pod)
  FROM public.bl_receivables br
  WHERE br.id = ANY(v_ids);

  -- Achado 4 da review da PR 501: garante que todo receivable USD selecionado
  -- tem ROE congelado antes de montar o detalhamento (evita usar um ROE
  -- global "current" como fallback silencioso).
  SELECT COUNT(*)
  INTO v_missing_roe_count
  FROM public.bl_receivables br
  JOIN public.charge_calculations cc ON cc.bl_id = br.bl_id
  LEFT JOIN public.charge_table_items cti ON cti.id = cc.charge_item_id
  WHERE br.id = ANY(v_ids)
    AND br.roe_frozen IS NULL
    AND COALESCE(cti.currency, 'BRL') = 'USD'
    AND COALESCE(cc.total_value_usd, 0) > 0
    AND COALESCE(cc.status, 'calculated') IN ('calculated', 'reviewed', 'ready_for_billing');

  IF v_missing_roe_count > 0 THEN
    RAISE EXCEPTION 'Um ou mais receivables selecionados nao tem ROE congelado para linhas em USD; recalcule/atualize o B/L antes de consolidar.' USING ERRCODE = '22023';
  END IF;

  WITH links AS (
    SELECT l.bl_id, l.subtotal_brl, br.roe_frozen, br.roe_effective_date_frozen
    FROM public.invoice_receivable_links l
    JOIN public.bl_receivables br ON br.id = l.receivable_id
    WHERE l.invoice_id = v_invoice_id
  ),
  calcs AS (
    SELECT
      cc.bl_id, cc.id AS charge_calculation_id, cc.charge_table_id, cc.charge_item_id,
      cc.quantity,
      COALESCE(cc.unit_value_brl, CASE WHEN COALESCE(cti.currency, 'BRL') = 'USD' THEN ROUND(COALESCE(cc.unit_value_usd, 0) * links.roe_frozen, 2) END) AS unit_value_brl,
      COALESCE(cc.total_value_brl, CASE WHEN COALESCE(cti.currency, 'BRL') = 'USD' THEN ROUND(COALESCE(cc.total_value_usd, 0) * links.roe_frozen, 2) END, 0) AS total_value_brl,
      cti.currency, cti.application_basis,
      cc.unit_value_usd, cc.total_value_usd, cc.calculation_key, cti.name AS charge_name,
      links.roe_frozen, links.roe_effective_date_frozen
    FROM public.charge_calculations cc
    JOIN links ON links.bl_id = cc.bl_id
    LEFT JOIN public.charge_table_items cti ON cti.id = cc.charge_item_id
    WHERE (COALESCE(cc.total_value_brl, 0) > 0 OR COALESCE(cc.total_value_usd, 0) > 0)
      AND COALESCE(cc.status, 'calculated') IN ('calculated', 'reviewed', 'ready_for_billing')
  ),
  bl_recon AS (
    SELECT links.bl_id, links.subtotal_brl,
      COUNT(calcs.charge_calculation_id) AS calc_count,
      COALESCE(SUM(calcs.total_value_brl), 0) AS detailed_sum
    FROM links
    LEFT JOIN calcs ON calcs.bl_id = links.bl_id
    GROUP BY links.bl_id, links.subtotal_brl
  )
  INSERT INTO public.invoice_items (
    invoice_id, charge_calculation_id, description, quantity, unit_value_brl,
    total_value_brl, bl_id, charge_table_id, charge_item_id, source, currency,
    unit_value_usd, total_value_usd, calculation_key, snapshot_payload
  )
  SELECT
    v_invoice_id, calcs.charge_calculation_id,
    CONCAT('BL ', calcs.bl_id, ' - ', COALESCE(calcs.charge_name, calcs.calculation_key, 'Linha de taxa')),
    COALESCE(calcs.quantity, 1), calcs.unit_value_brl, calcs.total_value_brl,
    calcs.bl_id, calcs.charge_table_id, calcs.charge_item_id, 'ledger',
    COALESCE(calcs.currency, 'BRL'), calcs.unit_value_usd, calcs.total_value_usd,
    calcs.calculation_key,
    jsonb_build_object(
      'reconciled', true,
      'shared_quantity_label', CASE
        WHEN calcs.application_basis = 'container_distinct_voyage'
          AND calcs.quantity > 0 AND calcs.quantity < 1
        THEN CONCAT('1/', ROUND(1 / calcs.quantity)::INTEGER)
        ELSE NULL
      END,
      'roe', CASE WHEN COALESCE(calcs.currency, 'BRL') = 'USD' THEN calcs.roe_frozen ELSE NULL END,
      'roe_effective_date', CASE WHEN COALESCE(calcs.currency, 'BRL') = 'USD' THEN calcs.roe_effective_date_frozen ELSE NULL END
    )
  FROM calcs
  JOIN bl_recon ON bl_recon.bl_id = calcs.bl_id
  WHERE bl_recon.calc_count > 0 AND ABS(bl_recon.detailed_sum - bl_recon.subtotal_brl) < 0.01
  UNION ALL
  SELECT
    v_invoice_id, NULL, CONCAT('BL ', bl_recon.bl_id, ' - Taxas locais'),
    1, bl_recon.subtotal_brl, bl_recon.subtotal_brl,
    bl_recon.bl_id, NULL, NULL, 'ledger', 'BRL', NULL, NULL, NULL,
    jsonb_build_object('reconciled', false)
  FROM bl_recon
  WHERE NOT (bl_recon.calc_count > 0 AND ABS(bl_recon.detailed_sum - bl_recon.subtotal_brl) < 0.01);

  INSERT INTO public.invoice_lifecycle_events (invoice_id, event_type, actor, payload)
  VALUES (v_invoice_id, 'issued', p_actor,
    jsonb_build_object('invoice_type', 'consolidated', 'receivable_count', ARRAY_LENGTH(v_ids, 1), 'total_brl', v_total, 'origin', COALESCE(p_origin, 'internal')));

  INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification)
  VALUES ('invoice', v_invoice_id::TEXT, 'create_consolidated', NULL,
    CONCAT('invoice=', v_invoice_number, ' | receivables=', ARRAY_LENGTH(v_ids, 1), ' | total=', v_total),
    p_actor, now(),
    CASE WHEN COALESCE(p_origin, 'internal') = 'portal' THEN 'Emissao de consolidada via portal do cliente' ELSE 'Emissao de consolidada via ledger' END);

  RETURN jsonb_build_object(
    'invoice_id', v_invoice_id,
    'invoice_number', v_invoice_number,
    'status', 'issued',
    'invoice_type', 'consolidated',
    'receivable_count', ARRAY_LENGTH(v_ids, 1),
    'total_brl', v_total
  );
END;
$function$;

-- A reemissão da consolidada pela correção não traz de volta o B/L que ficou
-- isento (ele não passaria nas checagens do item 1): encerra a reemissão.
CREATE OR REPLACE FUNCTION public._try_recreate_consolidated(p_invoice_id bigint, p_actor uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_inv record; v_ids bigint[]; v_mismatch text; v_waiting text;
BEGIN
  SELECT * INTO v_inv FROM public.invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND OR v_inv.invoice_type IS DISTINCT FROM 'consolidated' OR v_inv.status IS DISTINCT FROM 'cancelled'
     OR v_inv.reissue_requested_at IS NULL OR v_inv.reissue_closed_at IS NOT NULL
     OR EXISTS (SELECT 1 FROM public.invoices s WHERE s.replaces_invoice_id = p_invoice_id) THEN
    RETURN 'not_pending';
  END IF;

  SELECT array_agg(l.receivable_id ORDER BY l.receivable_id) INTO v_ids
  FROM public.invoice_receivable_links l WHERE l.invoice_id = p_invoice_id;

  SELECT string_agg(x.bl_id || ': ' || x.reason, '; ' ORDER BY x.bl_id) INTO v_mismatch FROM (
    SELECT br.bl_id, CASE
      WHEN b.cancelled_at IS NOT NULL THEN 'B/L cancelado'
      -- 365: B/L que ficou isento não volta para a consolidada.
      WHEN b.charge_status = 'exempt' THEN 'B/L isento'
      WHEN br.customer_id IS DISTINCT FROM v_inv.customer_id THEN 'B/L passou para outro Cliente'
      WHEN br.status NOT IN ('open', 'partially_settled') OR br.balance_brl <= 0 THEN 'sem saldo a cobrar (quitado ou isento)'
    END AS reason
    FROM public.invoice_receivable_links l
    JOIN public.bl_receivables br ON br.id = l.receivable_id
    JOIN public.bls b ON b.id = br.bl_id
    WHERE l.invoice_id = p_invoice_id) x
  WHERE x.reason IS NOT NULL;
  IF v_mismatch IS NOT NULL THEN
    PERFORM public._close_pending_reissue(p_invoice_id, 'Consolidada nao reemitida: os B/Ls ja nao sao os mesmos (' || v_mismatch || ').');
    RETURN 'closed';
  END IF;

  SELECT string_agg(DISTINCT ib.bl_id, ', ') INTO v_waiting
  FROM public.invoice_receivable_links l
  JOIN public.invoice_bls ib ON ib.bl_id = l.bl_id
  JOIN public.invoices i ON i.id = ib.invoice_id
  WHERE l.invoice_id = p_invoice_id AND i.invoice_type = 'individual' AND i.status = 'cancelled'
    AND i.reissue_requested_at IS NOT NULL AND i.reissue_closed_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM public.invoices s WHERE s.replaces_invoice_id = i.id)
    AND NOT EXISTS (SELECT 1 FROM public.invoice_bls ib2 JOIN public.invoices i2 ON i2.id = ib2.invoice_id
      WHERE ib2.bl_id = ib.bl_id AND i2.invoice_type = 'individual'
        AND coalesce(i2.status, 'issued') IN ('draft', 'issued', 'overdue', 'partially_paid', 'paid', 'covered'));
  IF v_waiting IS NOT NULL THEN
    PERFORM public.upsert_alert_item('fatura_desatualizada', 'invoice', p_invoice_id::text,
      'Consolidada ' || v_inv.invoice_number || ' cancelada para correcao; volta sozinha quando sair a fatura individual do B/L ' || v_waiting || '.',
      'invoice_reissue', 'administrativo', jsonb_build_object('invoice_id', p_invoice_id, 'bl_id', v_waiting, 'auto_reissue', 'waiting'),
      '/taxas-locais?invoice=' || p_invoice_id);
    RETURN 'waiting';
  END IF;

  IF p_actor IS NULL THEN RETURN 'pending'; END IF;
  BEGIN
    PERFORM public.create_local_consolidated_invoice_core(v_inv.customer_id, v_ids, p_actor, 'internal');
    RETURN 'reissued';
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.upsert_alert_item('fatura_desatualizada', 'invoice', p_invoice_id::text,
      'Consolidada ' || v_inv.invoice_number || ' cancelada para correcao, mas a nova emissao nao saiu (' || SQLERRM
        || '). Resolva o motivo e use Tentar reemitir em Reemissao pendente.',
      'invoice_reissue', 'administrativo', jsonb_build_object('invoice_id', p_invoice_id, 'auto_reissue', 'pending', 'reason', SQLERRM),
      '/taxas-locais?invoice=' || p_invoice_id);
    RETURN 'pending';
  END;
END;
$function$;
