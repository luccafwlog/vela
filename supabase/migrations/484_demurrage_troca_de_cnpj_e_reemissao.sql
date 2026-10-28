-- 484: Demurrage na troca de CNPJ e na reemissão por datas (revisão da PR
-- #1070; decisões do dono de 2026-10-27).
--
-- Problema e mudança, por seção:
--   1. P6 (DEM-D13) — a troca de CNPJ do B/L reemitia na hora a Invoice de
--      Demurrage aberta para o novo Cliente, mesmo sem Portal ativo nem
--      Liberação, e o avisava. Agora, com o gate do novo Cliente fechado, a
--      antiga é cancelada e a nova fica retida: sai recalculada pela fila
--      quando o gate abrir. Com o gate aberto, a cópia sai na hora como antes.
--   2. M3 — a cópia herdava `replaces_invoice_id`: o Portal do novo Cliente
--      citava a Invoice de outro Cliente. A cópia nasce sem a citação.
--   3. M5 — a Demurrage retida pelo gate ficava presa quando o CNPJ do B/L
--      mudava para um Cliente com o gate já aberto (só o CE e a abertura do
--      gate enfileiravam). A troca de Cliente do B/L também enfileira.
--   4. P7 — a reemissão por datas alteradas de uma Invoice que o Cliente já
--      via ficava retida se o gate estivesse fechado naquele momento, e o
--      Cliente ficava sem fatura. Agora a substituta sai mesmo com o gate
--      fechado (o CE continua exigido); o gate continua valendo para a
--      primeira emissão.
--
-- Não reescreve dados existentes.
--
-- Rollback: reaplicar `reissue_open_documents_on_customer_change` da `434`,
-- `_reconcile_demurrage_after_dates` e `_demurrage_issue_block_reason` da
-- `472`; DROP TRIGGER trg_enqueue_demurrage_after_customer_change ON
-- public.bls; DROP FUNCTION public._enqueue_demurrage_after_customer_change().

-- 1 e 2. Troca de CNPJ do B/L ----------------------------------------------
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
  v_demurrage_block text;
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

  -- Invoice de Demurrage emitida sem pagamento. 484 (P6, DEM-D13): com o
  -- gate do novo Cliente fechado, a antiga é cancelada e a nova fica retida;
  -- sai recalculada pela fila quando o gate abrir (gatilho
  -- trg_enqueue_demurrage_after_customer_change e _reprocess_customer_held_billing).
  v_demurrage_block := public._demurrage_issue_block_reason(NEW.id);
  FOR v_doc IN
    SELECT d.id, d.status, d.total_usd, d.current_roe, d.discount_mode FROM public.demurrage_invoices d
    WHERE d.bl_id = NEW.id AND d.customer_id = OLD.customer_id
      AND d.status IN ('issued', 'overdue') AND d.paid_at IS NULL
    ORDER BY d.id
  LOOP
    UPDATE public.demurrage_invoices SET status = 'cancelled', updated_at = now() WHERE id = v_doc.id;
    INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
    VALUES ('demurrage_invoice', v_doc.id::text, 'status', v_doc.status, 'cancelled', auth.uid(),
      CASE WHEN v_demurrage_block IS NULL THEN v_reason
        ELSE 'Troca de CNPJ do B/L ' || NEW.id || ': a Invoice do novo Cliente fica retida até o faturamento abrir (' || v_demurrage_block || ').' END);
    CONTINUE WHEN v_demurrage_block IS NOT NULL;
    v_new := public._clone_row('public.demurrage_invoices', v_doc.id,
      jsonb_build_object('customer_id', NEW.customer_id, 'doc_number', public.next_demurrage_doc_number(), 'status', v_doc.status,
        'pix_payload', NULL, 'pix_txid', NULL, 'conciliated_by_extract', false,
        -- O desconto foi negociado com o Cliente anterior (434): a Invoice nova
        -- nasce com o valor cheio em R$, pelo ROE da anterior.
        'current_total_brl', CASE WHEN v_doc.current_roe > 0 THEN round(v_doc.total_usd * v_doc.current_roe, 2) END,
        'notes', 'Reemitida pela troca de CNPJ do B/L (substitui a Invoice ' || v_doc.id || ').'
          || CASE WHEN v_doc.discount_mode IS NOT NULL THEN ' O desconto da Invoice anterior não foi copiado.' ELSE '' END),
      -- A Dispute e o desconto são do Cliente anterior: a Invoice nova nasce sem eles.
      -- 484 (M3): a citação da cancelada é do Cliente anterior.
      ARRAY['created_at', 'updated_at', 'dunning_suspended_reason', 'replaces_invoice_id',
        'dispute_open', 'dispute_subject', 'dispute_reason', 'dispute_status', 'dispute_notes',
        'discount_type', 'discount_value', 'discount_mode', 'discount_justification', 'discount_approver']);
    PERFORM public._clone_row('public.demurrage_invoice_items', it.id, jsonb_build_object('invoice_id', v_new))
    FROM public.demurrage_invoice_items it WHERE it.invoice_id = v_doc.id;
  END LOOP;
  RETURN NULL;
END;
$function$;

-- 4. Reemissão por datas da Invoice que o Cliente já via -------------------
CREATE OR REPLACE FUNCTION public._demurrage_issue_block_reason(p_bl_id text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_gate jsonb;
BEGIN
  IF NOT public.bl_has_portal_release(p_bl_id) THEN
    RETURN format('B/L %s sem CE Mercante. Cadastre o CE antes de faturar.', p_bl_id);
  END IF;
  -- 484 (P7): na reemissão por datas da Invoice que o Cliente já via, o gate
  -- do Portal não segura a substituta (o CE continua exigido).
  IF current_setting('vela.demurrage_reissue_visible', true) = 'on' THEN
    RETURN NULL;
  END IF;
  v_gate := public.portal_billing_gate(p_bl_id);
  IF NOT coalesce((v_gate->>'allowed')::boolean, false) THEN
    RETURN 'Faturamento bloqueado pelo Portal: ' || coalesce(v_gate->>'reason', 'Portal do Cliente não está pronto.');
  END IF;
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public._demurrage_issue_block_reason(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._reconcile_demurrage_after_dates(p_bl_ids text[], p_actor uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_invoice public.demurrage_invoices%ROWTYPE;
  v_invoice_id bigint;
  v_result jsonb := '[]'::jsonb;
  v_reissue jsonb;
  v_previous text := current_setting('vela.demurrage_internal', true);
  v_paid boolean;
  v_negotiated boolean;
  v_voyage_id bigint;
  v_keys text[];
  v_tried text[];
  v_waiting text[];
  v_extra jsonb;
  v_next_bl text;
  v_attempt jsonb;
  v_unbilled text[];
  v_message text;
BEGIN
  FOR v_invoice_id IN
    SELECT DISTINCT di.id
    FROM unnest(p_bl_ids) AS changed(bl_id)
    JOIN public.demurrage_invoices AS di
      ON di.bl_id = ANY(public.demurrage_group_bl_ids(changed.bl_id) || changed.bl_id)
      -- A Invoice que cobra caixa deste B/L, mesmo ancorada fora do grupo de
      -- hoje (grupo que se dividiu depois da emissão, 214).
      OR EXISTS (
        SELECT 1 FROM public.demurrage_invoice_items AS own_item
        JOIN public.bl_containers AS own ON own.id = own_item.container_id
        WHERE own_item.invoice_id = di.id AND own.bl_id = changed.bl_id
      )
    WHERE di.status IN ('issued', 'overdue', 'paid')
      AND EXISTS (
        SELECT 1 FROM public.demurrage_invoice_items AS item
        JOIN public.bl_containers AS c ON c.id = item.container_id
        WHERE item.invoice_id = di.id
          AND (c.discharge_date IS DISTINCT FROM item.discharge_date OR c.return_date IS DISTINCT FROM item.return_date)
      )
    ORDER BY di.id
  LOOP
    -- A decisão vale para a linha travada (211): uma baixa que confirmou
    -- depois da leitura acima não tem a Invoice paga cancelada e reemitida.
    SELECT * INTO v_invoice FROM public.demurrage_invoices WHERE id = v_invoice_id FOR UPDATE;
    CONTINUE WHEN NOT FOUND OR v_invoice.status NOT IN ('issued', 'overdue', 'paid');
    CONTINUE WHEN NOT EXISTS (
      SELECT 1 FROM public.demurrage_invoice_items AS item
      JOIN public.bl_containers AS c ON c.id = item.container_id
      WHERE item.invoice_id = v_invoice.id
        AND (c.discharge_date IS DISTINCT FROM item.discharge_date OR c.return_date IS DISTINCT FROM item.return_date)
    );
    v_paid := v_invoice.status = 'paid' OR v_invoice.paid_at IS NOT NULL;
    -- Desconto ou disputa aberta (ADR 0079, decisão 1): houve negociação que o
    -- cálculo não refaz. Como a paga, a Invoice não é reemitida sozinha.
    v_negotiated := NOT v_paid
      AND (COALESCE(v_invoice.discount_value, 0) > 0 OR COALESCE(v_invoice.dispute_open, false));
    v_message := format('As datas de container da Invoice de Demurrage %s mudaram depois da emissão%s.',
        v_invoice.doc_number, CASE
          WHEN v_paid THEN ' e ela já tem pagamento: a Régua suspendeu a cobrança'
          WHEN v_negotiated THEN ' e ela tem desconto ou disputa aberta: a Régua suspendeu a cobrança; cancele, gere de novo e refaça o desconto ou responda a disputa'
          ELSE '' END);

    IF v_paid OR v_negotiated THEN
      PERFORM public.upsert_alert_item(
        'demurrage_invoice_dates_changed', 'demurrage_invoice', v_invoice.id::text, v_message,
        'container-dates',
        jsonb_build_object('invoice_id', v_invoice.id, 'bl_id', v_invoice.bl_id, 'paid', v_paid, 'negotiated', v_negotiated),
        '/demurrage');
      UPDATE public.demurrage_invoices
         SET dunning_suspended_reason = CASE WHEN v_paid
           THEN 'Datas de container alteradas depois do pagamento; conferir a diferença.'
           ELSE 'Datas de container alteradas em Invoice com desconto ou disputa; reemitir à mão.' END
       WHERE id = v_invoice.id
         -- 317 (R5): a suspensão pela recusa do provedor (D6) fica; ao
         -- resolver o alerta, a retomada aplica a suspensão por datas.
         AND (dunning_suspended_reason IS NULL OR dunning_suspended_reason NOT LIKE 'Cobrança recusada pelo provedor%');
      v_result := v_result || jsonb_build_array(jsonb_build_object('invoice_id', v_invoice.id, 'status', 'suspended'));
      CONTINUE;
    END IF;

    -- Sem pagamento: cancela e reemite com as datas atuais (ou só cancela).
    UPDATE public.demurrage_invoices SET status = 'cancelled', updated_at = now()
     WHERE id = v_invoice.id AND status IN ('issued', 'overdue') AND paid_at IS NULL;
    CONTINUE WHEN NOT FOUND;
    INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification)
    VALUES ('demurrage_invoice', v_invoice.id::text, 'status', v_invoice.status, 'cancelled', p_actor, now(),
      'Datas de container alteradas: cancelada para reemissão automática.');
    v_extra := '[]'::jsonb;
    v_unbilled := ARRAY[]::text[];
    v_voyage_id := NULL;
    IF EXISTS (SELECT 1 FROM public.bls WHERE id = v_invoice.bl_id AND cancelled_at IS NOT NULL) THEN
      v_reissue := jsonb_build_object('status', 'bl_cancelled', 'bl_id', v_invoice.bl_id);
    -- Viagem Cancelada não recebe Invoice de Demurrage (211): só cancela.
    ELSIF EXISTS (
      SELECT 1 FROM public.bls AS b JOIN public.voyages AS v ON v.id = b.voyage_id
      WHERE b.id = v_invoice.bl_id AND v.status = 'cancelled'
    ) THEN
      v_reissue := jsonb_build_object('status', 'voyage_cancelled', 'bl_id', v_invoice.bl_id);
    ELSE
      -- Cada caixa uma vez (214): a reemissão cobra as caixas da Invoice
      -- cancelada que nenhuma outra Invoice viva cobre. Primeiro pelo grupo do
      -- B/L dela; a caixa que saiu desse grupo, pelo âncora do B/L ativo que
      -- ainda a tem. Cada âncora é tentado uma vez.
      SELECT voyage_id INTO v_voyage_id FROM public.bls WHERE id = v_invoice.bl_id;
      SELECT COALESCE(array_agg(DISTINCT upper(btrim(item.container_number))), ARRAY[]::text[]) INTO v_keys
      FROM public.demurrage_invoice_items AS item
      WHERE item.invoice_id = v_invoice.id AND NULLIF(btrim(item.container_number), '') IS NOT NULL;
      v_tried := ARRAY[]::text[];
      v_waiting := ARRAY[]::text[];
      v_next_bl := v_invoice.bl_id;
      PERFORM set_config('vela.demurrage_internal', 'on', true);
      -- 484 (decisão do dono, P7): o Cliente já via a Invoice cancelada; a
      -- substituta sai mesmo com o gate fechado.
      PERFORM set_config('vela.demurrage_reissue_visible', 'on', true);
      LOOP
        v_attempt := public.issue_demurrage_invoice_for_bl(v_next_bl, NULL);
        -- 472 (DEM-D08): a Invoice reemitida guarda qual cancelada ela substitui.
        IF v_attempt->>'status' = 'issued' AND (v_attempt->>'invoice_id') IS NOT NULL THEN
          UPDATE public.demurrage_invoices SET replaces_invoice_id = v_invoice.id
           WHERE id = (v_attempt->>'invoice_id')::bigint;
        END IF;
        IF cardinality(v_tried) = 0 THEN
          v_reissue := v_attempt;
        ELSE
          v_extra := v_extra || jsonb_build_array(v_attempt || jsonb_build_object('bl_id', v_next_bl));
        END IF;
        v_tried := array_append(v_tried, COALESCE(v_attempt->>'anchor_bl_id', v_next_bl));
        -- Sem sobreestadia ou aguardando devolução: as caixas do grupo ficam
        -- sem Invoice por regra, não por perda (a devolução enfileira de novo).
        IF v_attempt->>'status' IN ('no_overstay', 'waiting_return') THEN
          v_waiting := v_waiting || ARRAY(
            SELECT DISTINCT upper(btrim(c.container_number)) FROM public.bl_containers AS c
            WHERE c.bl_id = ANY(public.demurrage_group_bl_ids(COALESCE(v_attempt->>'anchor_bl_id', v_next_bl))));
        END IF;
        SELECT holder.id INTO v_next_bl
        FROM unnest(v_keys) AS k(container_key)
        JOIN public.bl_containers AS c ON upper(btrim(c.container_number)) = k.container_key
        JOIN public.bls AS holder ON holder.id = c.bl_id
        WHERE holder.voyage_id = v_voyage_id AND holder.customer_id = v_invoice.customer_id
          AND holder.cancelled_at IS NULL
          AND c.ownership IS DISTINCT FROM 'SOC'
          AND k.container_key <> ALL(v_waiting)
          AND NOT EXISTS (
            SELECT 1 FROM public._demurrage_billed_container_keys(v_voyage_id, v_invoice.customer_id) AS billed
            WHERE billed.container_key = k.container_key)
          AND public.demurrage_group_anchor(holder.id) <> ALL(v_tried)
        ORDER BY k.container_key, holder.id
        LIMIT 1;
        EXIT WHEN NOT FOUND;
      END LOOP;
      PERFORM set_config('vela.demurrage_internal', COALESCE(v_previous, ''), true);
      PERFORM set_config('vela.demurrage_reissue_visible', '', true);
      SELECT COALESCE(array_agg(k.container_key ORDER BY k.container_key), ARRAY[]::text[]) INTO v_unbilled
      FROM unnest(v_keys) AS k(container_key)
      WHERE k.container_key <> ALL(v_waiting)
        AND NOT EXISTS (
          SELECT 1 FROM public._demurrage_billed_container_keys(v_voyage_id, v_invoice.customer_id) AS billed
          WHERE billed.container_key = k.container_key);
    END IF;
    IF cardinality(v_unbilled) > 0 THEN
      -- Caixa da Invoice cancelada que ficou sem cobrança não é sucesso: o
      -- Alerta diz quais caixas conferir e fecha quando todas estiverem numa
      -- Invoice viva (349, resolve_demurrage_dates_changed_on_billing).
      PERFORM public.upsert_alert_item(
        'demurrage_invoice_dates_changed', 'demurrage_invoice', v_invoice.id::text,
        v_message || format(
          ' A reemissão automática não cobrou o(s) container(s) %s: %s',
          array_to_string(v_unbilled, ', '),
          CASE WHEN v_reissue->>'status' = 'blocked'
            THEN 'a emissão aguarda: ' || (v_reissue->>'reason') || ' A nova Invoice sai sozinha quando o motivo for resolvido.'
            ELSE 'confira o grupo e emita a Demurrage deles.' END),
        'container-dates',
        jsonb_build_object('invoice_id', v_invoice.id, 'bl_id', v_invoice.bl_id, 'paid', v_paid, 'negotiated', v_negotiated,
          'voyage_id', v_voyage_id, 'customer_id', v_invoice.customer_id,
          'unbilled_containers', to_jsonb(v_unbilled), 'reissue_status', v_reissue->>'status'),
        '/demurrage');
    ELSE
      -- 349 (P1): a reemissão cobriu todas as caixas, ou não havia o que
      -- cobrar (B/L ou Viagem cancelados, sem sobreestadia, aguardando
      -- devolução). Nada a conferir: o alerta não fica aberto.
      PERFORM public.resolve_alert_item(
        'demurrage_invoice_dates_changed', 'demurrage_invoice', v_invoice.id::text, 'container-dates',
        jsonb_build_object('resolution', 'reissue_complete', 'invoice_id', v_invoice.id,
          'reissue_status', v_reissue->>'status'));
    END IF;
    v_result := v_result || jsonb_build_array(jsonb_build_object(
      'invoice_id', v_invoice.id, 'status', 'cancelled', 'reissue', v_reissue,
      'reissue_extra', v_extra, 'unbilled_containers', to_jsonb(v_unbilled),
      'reissue_complete', cardinality(v_unbilled) = 0));
  END LOOP;

  -- Com as datas de volta às faturadas, a Invoice com desconto ou disputa sai
  -- da suspensão (a paga sai pelo estorno, como na 191).
  UPDATE public.demurrage_invoices AS di
     SET dunning_suspended_reason = NULL
    FROM unnest(p_bl_ids) AS changed(bl_id)
   WHERE di.bl_id = ANY(public.demurrage_group_bl_ids(changed.bl_id) || changed.bl_id)
     AND di.status IN ('issued', 'overdue')
     AND di.paid_at IS NULL
     AND di.dunning_suspended_reason = 'Datas de container alteradas em Invoice com desconto ou disputa; reemitir à mão.'
     AND NOT EXISTS (
       SELECT 1 FROM public.demurrage_invoice_items AS item
       JOIN public.bl_containers AS c ON c.id = item.container_id
       WHERE item.invoice_id = di.id
         AND (c.discharge_date IS DISTINCT FROM item.discharge_date OR c.return_date IS DISTINCT FROM item.return_date)
     );
  RETURN v_result;
END;
$function$;

-- 3. A troca de Cliente do B/L enfileira a Demurrage retida -----------------
CREATE OR REPLACE FUNCTION public._enqueue_demurrage_after_customer_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  PERFORM public._enqueue_held_demurrage_billing(ARRAY[NEW.id], auth.uid());
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public._enqueue_demurrage_after_customer_change() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_enqueue_demurrage_after_customer_change ON public.bls;
CREATE TRIGGER trg_enqueue_demurrage_after_customer_change
  AFTER UPDATE OF customer_id ON public.bls
  FOR EACH ROW
  WHEN (NEW.customer_id IS NOT NULL AND OLD.customer_id IS DISTINCT FROM NEW.customer_id)
  EXECUTE FUNCTION public._enqueue_demurrage_after_customer_change();
