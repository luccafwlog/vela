-- 203 — Demurrage: Invoice com desconto ou disputa aberta não é reemitida
-- sozinha quando as datas do container mudam (ADR 0079, decisão 1).
--
-- Até aqui (179/191), a Invoice sem pagamento cujas datas mudavam era
-- cancelada e reemitida pelo cálculo, sem o desconto nem a disputa da
-- anterior. A Régua, que não cobra Invoice em disputa, voltava a cobrar o
-- Cliente pela nova.
--
-- Agora a Invoice com desconto ou disputa aberta segue o caminho da paga: fica
-- emitida, a Régua é suspensa (`dunning_suspended_reason`) e o Alerta
-- `demurrage_invoice_dates_changed` diz o que fazer. O financeiro cancela, gera
-- de novo pela página Demurrage, refaz o desconto e responde a disputa. Com as
-- datas de volta às faturadas, a suspensão sai. O estorno de uma Invoice paga
-- com desconto (gatilho da 191) cai no mesmo caminho.
--
-- Redefine `_reconcile_demurrage_after_dates` a partir da 191. Não reescreve
-- nem apaga linhas existentes: só redefine a função. Rollback: reaplicar a
-- definição da 191.

CREATE OR REPLACE FUNCTION public._reconcile_demurrage_after_dates(p_bl_ids text[], p_actor uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_invoice public.demurrage_invoices%ROWTYPE;
  v_result jsonb := '[]'::jsonb;
  v_reissue jsonb;
  v_previous text := current_setting('vela.demurrage_internal', true);
  v_paid boolean;
  v_negotiated boolean;
BEGIN
  FOR v_invoice IN
    SELECT DISTINCT ON (di.id) di.*
    FROM unnest(p_bl_ids) AS changed(bl_id)
    JOIN public.demurrage_invoices AS di
      ON di.bl_id = ANY(public.demurrage_group_bl_ids(changed.bl_id) || changed.bl_id)
    WHERE di.status IN ('issued', 'overdue', 'paid')
      AND EXISTS (
        SELECT 1 FROM public.demurrage_invoice_items AS item
        JOIN public.bl_containers AS c ON c.id = item.container_id
        WHERE item.invoice_id = di.id
          AND (c.discharge_date IS DISTINCT FROM item.discharge_date OR c.return_date IS DISTINCT FROM item.return_date)
      )
    ORDER BY di.id
  LOOP
    v_paid := v_invoice.status = 'paid' OR v_invoice.paid_at IS NOT NULL;
    -- Desconto ou disputa aberta (ADR 0079, decisão 1): houve negociação que o
    -- cálculo não refaz. Como a paga, a Invoice não é reemitida sozinha.
    v_negotiated := NOT v_paid
      AND (COALESCE(v_invoice.discount_value, 0) > 0 OR COALESCE(v_invoice.dispute_open, false));
    PERFORM public.upsert_alert_item(
      'demurrage_invoice_dates_changed', 'demurrage_invoice', v_invoice.id::text,
      format('As datas de container da Invoice de Demurrage %s mudaram depois da emissão%s.',
        v_invoice.doc_number, CASE
          WHEN v_paid THEN ' e ela já tem pagamento: a Régua suspendeu a cobrança'
          WHEN v_negotiated THEN ' e ela tem desconto ou disputa aberta: a Régua suspendeu a cobrança; cancele, gere de novo e refaça o desconto ou responda a disputa'
          ELSE '' END),
      'container-dates',
      jsonb_build_object('invoice_id', v_invoice.id, 'bl_id', v_invoice.bl_id, 'paid', v_paid, 'negotiated', v_negotiated),
      '/demurrage');

    IF v_paid OR v_negotiated THEN
      UPDATE public.demurrage_invoices
         SET dunning_suspended_reason = CASE WHEN v_paid
           THEN 'Datas de container alteradas depois do pagamento; conferir a diferença.'
           ELSE 'Datas de container alteradas em Invoice com desconto ou disputa; reemitir à mão.' END
       WHERE id = v_invoice.id;
      v_result := v_result || jsonb_build_array(jsonb_build_object('invoice_id', v_invoice.id, 'status', 'suspended'));
      CONTINUE;
    END IF;

    -- Sem pagamento: cancela e reemite com as datas atuais (ou só cancela).
    UPDATE public.demurrage_invoices SET status = 'cancelled', updated_at = now() WHERE id = v_invoice.id;
    INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification)
    VALUES ('demurrage_invoice', v_invoice.id::text, 'status', v_invoice.status, 'cancelled', p_actor, now(),
      'Datas de container alteradas: cancelada para reemissão automática.');
    IF EXISTS (SELECT 1 FROM public.bls WHERE id = v_invoice.bl_id AND cancelled_at IS NOT NULL) THEN
      v_reissue := jsonb_build_object('status', 'bl_cancelled', 'bl_id', v_invoice.bl_id);
    ELSE
      PERFORM set_config('vela.demurrage_internal', 'on', true);
      v_reissue := public.issue_demurrage_invoice_for_bl(v_invoice.bl_id, NULL);
      PERFORM set_config('vela.demurrage_internal', COALESCE(v_previous, ''), true);
    END IF;
    v_result := v_result || jsonb_build_array(jsonb_build_object(
      'invoice_id', v_invoice.id, 'status', 'cancelled', 'reissue', v_reissue));
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
REVOKE ALL ON FUNCTION public._reconcile_demurrage_after_dates(text[], uuid) FROM PUBLIC, anon, authenticated;
