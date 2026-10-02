-- 125: correções da revisão da PR #839 sobre as migrations 122–124 (ADR 0077).
-- Não reescreve nem apaga linhas existentes.
--
-- 1. Avulsa com item da tabela em USD: o total final (USD total × ROE) pode
--    diferir em centavos de quantidade × unitário gravado pela emissão base. O
--    Pix e o evento de emissão eram montados com o valor anterior; agora seguem
--    o total final da fatura.
-- 2. Fatura com correção registrada não pode ser cancelada. Depois de estornar
--    a baixa, o cancelamento deixava o abatimento no recebível e a reemissão
--    cobrava o B/L recalculado menos uma correção já superada.
-- 3. Cancelar e reemitir uma individual cujo recebível está numa consolidada
--    viva é recusado: a consolidada continuaria cobrando o valor antigo e o
--    recebível fica congelado (124). O caminho é a consolidada, marcando o B/L.
-- 4. sync_local_charge_receivable volta a ter EXECUTE para service_role, como
--    na 072; o wrapper da 124 só concedia a authenticated.

-- ---------------------------------------------------------------------------
-- 1. create_manual_invoice: Pix e evento acompanham o total final
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_manual_invoice(
  p_customer_id bigint, p_item_name text, p_quantity numeric, p_unit_value_brl numeric,
  p_description text DEFAULT NULL, p_bl_id text DEFAULT NULL, p_voyage_id bigint DEFAULT NULL,
  p_actor uuid DEFAULT NULL, p_charge_item_id bigint DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_quote jsonb; v_result jsonb; v_invoice bigint; v_pricing_version bigint; v_total numeric(14,2);
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Credenciais invalidas ou sem permissao de faturamento.' USING ERRCODE = '42501';
  END IF;
  IF p_charge_item_id IS NULL THEN
    RETURN public._create_manual_invoice_custom_122(p_customer_id, p_item_name, p_quantity, p_unit_value_brl,
      p_description, p_bl_id, p_voyage_id, p_actor);
  END IF;
  IF nullif(btrim(p_bl_id), '') IS NULL THEN
    RAISE EXCEPTION 'B/L obrigatorio para item da tabela.' USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM public.bls WHERE id = upper(btrim(p_bl_id)) AND customer_id = p_customer_id FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L nao pertence ao cliente selecionado.' USING ERRCODE = '42501';
  END IF;
  v_quote := public.quote_manual_invoice_charge(p_bl_id, p_charge_item_id);
  v_total := (v_quote->>'total_brl')::numeric;
  v_result := public._create_manual_invoice_custom_122(p_customer_id, v_quote->>'charge_item_name',
    (v_quote->>'quantity')::numeric, (v_quote->>'unit_value_brl')::numeric,
    p_description, upper(btrim(p_bl_id)), p_voyage_id, p_actor);
  v_invoice := (v_result->>'invoice_id')::bigint;
  INSERT INTO public.pricing_rule_versions(version_key, charge_table_id, charge_item_id, customer_id, customer_rate_override_id, metadata)
    VALUES ('manual_invoice:' || v_invoice, (v_quote->>'charge_table_id')::bigint, p_charge_item_id,
      p_customer_id, (v_quote->>'override_id')::bigint, v_quote) RETURNING id INTO v_pricing_version;
  UPDATE public.invoice_items SET charge_item_id = p_charge_item_id, pricing_rule_version_id = v_pricing_version,
    charge_table_id = (v_quote->>'charge_table_id')::bigint,
    snapshot_payload = v_quote, currency = v_quote->>'currency',
    unit_value_usd = (v_quote->>'effective_unit_value_usd')::numeric,
    total_value_usd = (v_quote->>'total_usd')::numeric,
    total_value_brl = v_total
    WHERE invoice_id = v_invoice;
  -- O trigger do Pix só preenche payload vazio; montar com o total final.
  UPDATE public.invoices SET total_brl = v_total, balance_brl = v_total,
    pix_payload = public.build_transshipping_pix_payload(v_total, invoice_number)
    WHERE id = v_invoice;
  UPDATE public.invoice_lifecycle_events SET payload = payload || jsonb_build_object('total_brl', v_total, 'charge_item_id', p_charge_item_id)
    WHERE invoice_id = v_invoice AND event_type = 'issued';
  RETURN v_result || jsonb_build_object('total_brl', v_total, 'balance_brl', v_total);
END;
$$;
REVOKE ALL ON FUNCTION public.create_manual_invoice(bigint, text, numeric, numeric, text, text, bigint, uuid, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_manual_invoice(bigint, text, numeric, numeric, text, text, bigint, uuid, bigint) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. Fatura com correção registrada não é cancelada
-- ---------------------------------------------------------------------------
-- Vale para cancel_invoice e cancel_invoice_for_reissue. A correção vive no
-- recebível, então qualquer fatura ligada a ele fica protegida.
CREATE OR REPLACE FUNCTION public.guard_cancel_invoice_with_correction() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled' AND EXISTS (
    SELECT 1 FROM public.invoice_corrections c
    JOIN public.invoice_receivable_links l ON l.receivable_id = c.receivable_id
    WHERE l.invoice_id = OLD.id
  ) THEN
    RAISE EXCEPTION 'Fatura com correcao registrada nao pode ser cancelada; para diferenca adicional use fatura avulsa ou nova correcao.'
      USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_cancel_invoice_with_correction() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS guard_cancel_invoice_with_correction ON public.invoices;
CREATE TRIGGER guard_cancel_invoice_with_correction BEFORE UPDATE OF status ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.guard_cancel_invoice_with_correction();

-- ---------------------------------------------------------------------------
-- 3. Individual dentro de consolidada viva reemite pela consolidada
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancel_invoice_for_reissue(
  p_invoice_id bigint,
  p_reason text,
  p_correct_bl_ids text[] DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_invoice record;
  v_reason text := NULLIF(TRIM(COALESCE(p_reason, '')), '');
  v_bl_ids text[];
  v_correct text[];
  v_individual record;
  v_cancelled bigint[] := ARRAY[]::bigint[];
  v_consolidated text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Credenciais invalidas ou sem permissao de faturamento.' USING ERRCODE = '42501';
  END IF;

  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'Informe o motivo para cancelar e reemitir a fatura.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_invoice FROM public.invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice % nao encontrada.', p_invoice_id USING ERRCODE = 'P0002';
  END IF;

  IF COALESCE(v_invoice.invoice_type, 'individual') NOT IN ('individual', 'consolidated') THEN
    RAISE EXCEPTION 'Cancelar e reemitir vale apenas para fatura de Taxas Locais.' USING ERRCODE = '22023';
  END IF;

  IF COALESCE(v_invoice.status, 'issued') NOT IN ('draft', 'issued', 'overdue') THEN
    RAISE EXCEPTION 'Somente fatura emitida e sem pagamento pode ser cancelada e reemitida.' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (SELECT 1 FROM public.payments WHERE invoice_id = p_invoice_id) THEN
    RAISE EXCEPTION 'Fatura com pagamento nao pode ser cancelada e reemitida; use fatura avulsa ou restituicao por correcao.' USING ERRCODE = '22023';
  END IF;

  IF COALESCE(v_invoice.invoice_type, 'individual') = 'individual' THEN
    SELECT inv.invoice_number INTO v_consolidated
    FROM public.invoice_receivable_links own
    JOIN public.invoice_receivable_links l ON l.receivable_id = own.receivable_id AND l.invoice_id <> own.invoice_id
    JOIN public.invoices inv ON inv.id = l.invoice_id
    WHERE own.invoice_id = p_invoice_id
      AND inv.invoice_type = 'consolidated'
      AND COALESCE(inv.status, 'issued') IN ('draft', 'issued', 'partially_paid', 'overdue')
    ORDER BY inv.id DESC
    LIMIT 1;
    IF v_consolidated IS NOT NULL THEN
      RAISE EXCEPTION 'Este B/L esta na consolidada %; use Cancelar e reemitir na consolidada marcando o B/L a corrigir.', v_consolidated
        USING ERRCODE = '22023';
    END IF;
  END IF;

  IF v_invoice.invoice_type = 'consolidated' THEN
    SELECT COALESCE(ARRAY_AGG(DISTINCT l.bl_id ORDER BY l.bl_id), ARRAY[]::text[])
    INTO v_bl_ids
    FROM public.invoice_receivable_links l
    WHERE l.invoice_id = p_invoice_id;
  ELSE
    SELECT COALESCE(ARRAY_AGG(DISTINCT ib.bl_id ORDER BY ib.bl_id), ARRAY[]::text[])
    INTO v_bl_ids
    FROM public.invoice_bls ib
    WHERE ib.invoice_id = p_invoice_id;
  END IF;

  PERFORM public.cancel_invoice(p_invoice_id, v_reason, auth.uid());
  UPDATE public.invoices SET reissue_requested_at = now() WHERE id = p_invoice_id;
  v_cancelled := v_cancelled || p_invoice_id;

  IF v_invoice.invoice_type = 'consolidated' AND COALESCE(ARRAY_LENGTH(p_correct_bl_ids, 1), 0) > 0 THEN
    SELECT ARRAY_AGG(DISTINCT UPPER(TRIM(x))) INTO v_correct
    FROM UNNEST(p_correct_bl_ids) AS x
    WHERE TRIM(COALESCE(x, '')) <> '';

    IF EXISTS (SELECT 1 FROM UNNEST(v_correct) AS c(bl_id) WHERE c.bl_id <> ALL(v_bl_ids)) THEN
      RAISE EXCEPTION 'B/L informado nao pertence a esta consolidada.' USING ERRCODE = '22023';
    END IF;

    FOR v_individual IN
      SELECT DISTINCT inv.id
      FROM public.invoice_bls ib
      JOIN public.invoices inv ON inv.id = ib.invoice_id
      WHERE ib.bl_id = ANY(v_correct)
        AND inv.invoice_type = 'individual'
        AND COALESCE(inv.status, 'issued') IN ('draft', 'issued', 'partially_paid', 'overdue')
      ORDER BY inv.id
    LOOP
      IF EXISTS (SELECT 1 FROM public.payments WHERE invoice_id = v_individual.id) THEN
        RAISE EXCEPTION 'A fatura individual % tem pagamento; corrija esse B/L por fatura avulsa ou restituicao.', v_individual.id USING ERRCODE = '22023';
      END IF;
      PERFORM public.cancel_invoice(v_individual.id, v_reason, auth.uid());
      UPDATE public.invoices SET reissue_requested_at = now() WHERE id = v_individual.id;
      v_cancelled := v_cancelled || v_individual.id;
    END LOOP;
  END IF;

  INSERT INTO public.audit_logs(
    entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification
  ) VALUES (
    'invoice', p_invoice_id::text, 'cancel_invoice_for_reissue',
    COALESCE(v_invoice.status, 'issued'), 'cancelled', auth.uid(), now(), v_reason
  );

  RETURN jsonb_build_object(
    'invoice_id', p_invoice_id,
    'invoice_type', v_invoice.invoice_type,
    'customer_id', v_invoice.customer_id,
    'bl_ids', to_jsonb(v_bl_ids),
    'cancelled_invoice_ids', to_jsonb(v_cancelled)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_invoice_for_reissue(bigint, text, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_invoice_for_reissue(bigint, text, text[]) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. Privilégio original de sync_local_charge_receivable
-- ---------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.sync_local_charge_receivable(text) TO service_role;
