-- 374: troca de CNPJ conclui e reemite os documentos abertos do B/L (ADR
-- 0093, decisão 15; plano da frente financeira, F-31).
--
-- Problema:
--   1. A troca de CNPJ paga ficava em `reissue_pending` quando o B/L já
--      tinha fatura viva para o Cliente-alvo (`already_invoiced`), e a Fatura
--      desatualizada das faturas originais não fechava ao concluir.
--   2. A Invoice de Demurrage e a avulsa em aberto do B/L continuavam com o
--      Cliente antigo.
--
-- Mudança: `_finish_invoice_customer_change` trata a fatura viva do
-- Cliente-alvo como conclusão e fecha a Fatura desatualizada das originais;
-- trocar o Cliente do B/L cancela e reemite, para o novo Cliente, com número
-- novo e o mesmo valor, a avulsa e a Invoice de Demurrage emitidas sem
-- pagamento (as pagas já bloqueiam a troca até a devolução, 136).
--
-- Não altera nem apaga linhas existentes.

-- Copia uma linha trocando colunas; devolve o id novo. Colunas com default
-- de sequência ficam de fora.
CREATE OR REPLACE FUNCTION public._clone_row(p_table regclass, p_id bigint, p_overrides jsonb, p_skip text[] DEFAULT ARRAY[]::text[])
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_cols text; v_sel text; v_id bigint;
BEGIN
  SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY a.attnum),
         string_agg(CASE WHEN p_overrides ? a.attname
                      THEN format('(%L::jsonb ->> %L)::%s', p_overrides, a.attname, format_type(a.atttypid, a.atttypmod))
                      ELSE quote_ident(a.attname) END, ', ' ORDER BY a.attnum)
    INTO v_cols, v_sel
  FROM pg_attribute a
  LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
  WHERE a.attrelid = p_table AND a.attnum > 0 AND NOT a.attisdropped AND a.attgenerated = ''
    AND a.attidentity = '' AND coalesce(pg_get_expr(d.adbin, d.adrelid), '') NOT LIKE 'nextval(%'
    AND NOT (a.attname = ANY(p_skip));
  EXECUTE format('INSERT INTO %s (%s) SELECT %s FROM %s WHERE id = $1 RETURNING id', p_table, v_cols, v_sel, p_table)
    INTO v_id USING p_id;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public._clone_row(regclass, bigint, jsonb, text[]) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.reissue_open_documents_on_customer_change()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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
        'covered_by_invoice_id', 'obsolete_reason']);
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
$$;
REVOKE ALL ON FUNCTION public.reissue_open_documents_on_customer_change() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER reissue_open_documents_on_customer_change
  AFTER UPDATE OF customer_id ON public.bls
  FOR EACH ROW WHEN (OLD.customer_id IS NOT NULL AND NEW.customer_id IS NOT NULL AND OLD.customer_id IS DISTINCT FROM NEW.customer_id)
  EXECUTE FUNCTION public.reissue_open_documents_on_customer_change();

CREATE OR REPLACE FUNCTION public._finish_invoice_customer_change(p_change_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE c public.invoice_customer_changes%ROWTYPE; result jsonb; b public.bls%ROWTYPE; v_original bigint;
BEGIN
 SELECT bl_id INTO c.bl_id FROM public.invoice_customer_changes WHERE id = p_change_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Troca de Cliente não encontrada.' USING ERRCODE = 'P0002'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('bl:' || c.bl_id,0));
 SELECT * INTO c FROM public.invoice_customer_changes WHERE id = p_change_id FOR UPDATE;
 IF c.status = 'completed' THEN RETURN jsonb_build_object('status','completed','invoice_id',c.new_invoice_id); END IF;
 IF EXISTS(SELECT 1 FROM public.invoice_refunds WHERE status = 'pending' AND (correction_receivable_id = c.receivable_id OR
    invoice_id = ANY(c.original_invoice_ids) AND payment_id IS NOT NULL)) THEN
   RETURN jsonb_build_object('status','pending_refund','bl_id',c.bl_id); END IF;
 SELECT * INTO b FROM public.bls WHERE id = c.bl_id FOR UPDATE;
 -- Arquiva o recebível original sem deslocar pagamentos para o novo Cliente.
 UPDATE public.bl_receivables SET source = 'local_charges_archived:' || id::text, status = 'void', balance_brl = 0 WHERE id = c.receivable_id;
 UPDATE public.invoice_receivable_links SET status = 'obsolete' WHERE receivable_id = c.receivable_id;
 UPDATE public.invoice_customer_changes SET status = 'reissue_pending', target_customer_id = b.customer_id WHERE id = c.id;
 BEGIN
   -- O cálculo corrente pode ser substituído; o documento guarda a origem antiga.
   UPDATE public.invoice_items ii SET charge_calculation_snapshot = coalesce(ii.charge_calculation_snapshot,to_jsonb(cc)), charge_calculation_id = NULL
     FROM public.charge_calculations cc WHERE cc.id = ii.charge_calculation_id AND cc.bl_id = c.bl_id;
   PERFORM public._clear_post_billing_hold(c.bl_id);
   UPDATE public.bls SET financial_status = 'pending' WHERE id = c.bl_id;
   IF b.cancelled_at IS NOT NULL THEN
     result := jsonb_build_object('status','cancelled','reason','bl_cancelled');
   ELSE
     result := public._auto_bill_bl_core(c.bl_id,auth.uid(),false);
   END IF;
   -- F-31 (374): o B/L já faturado para o Cliente-alvo (emitido por outro
   -- caminho) conclui a troca, em vez de deixá-la em reemissão pendente.
   IF result->>'status' = 'already_invoiced' THEN
     SELECT jsonb_build_object('status', 'invoiced', 'invoice_id', i.id) INTO result
     FROM public.invoices i
     WHERE i.id = ANY(public._live_local_invoice_ids_for_bl(c.bl_id)) AND i.customer_id = b.customer_id
     ORDER BY i.id DESC LIMIT 1;
     result := coalesce(result, jsonb_build_object('status', 'already_invoiced'));
   END IF;
   IF result->>'status' = 'invoiced' OR result->>'reason' IN ('exempt','bl_cancelled') THEN
     UPDATE public.invoice_customer_changes SET status = 'completed', completed_at = now(),
       new_invoice_id = nullif(coalesce(result->>'invoice_id',result->'invoice'->>'invoice_id'),'')::bigint WHERE id = c.id;
     DELETE FROM public.invoice_basis_pending_changes WHERE bl_id=c.bl_id AND source='customer_change';
     -- F-31 (374): a Fatura desatualizada das faturas originais fecha com a troca concluída.
     FOREACH v_original IN ARRAY coalesce(c.original_invoice_ids, ARRAY[]::bigint[]) LOOP
       PERFORM public.resolve_alert_item('fatura_desatualizada', 'invoice', v_original::text, 'customer_change_completed', '{}'::jsonb);
     END LOOP;
     INSERT INTO public.audit_logs(entity_type,entity_id,field_name,new_value,changed_by,justification)
       VALUES('bl',c.bl_id,'customer_change_completed',jsonb_build_object('change_id',c.id,'original_customer_id',c.original_customer_id,
         'target_customer_id',b.customer_id,'original_invoice_ids',c.original_invoice_ids,'billing',result)::text,auth.uid(),c.reason);
     RETURN jsonb_build_object('status','completed','billing',result,'bl_id',c.bl_id);
   END IF;
 EXCEPTION WHEN OTHERS THEN
   result := jsonb_build_object('status','blocked','reason',SQLERRM);
 END;
 INSERT INTO public.invoice_basis_pending_changes(bl_id,source,error_message)
   VALUES(c.bl_id,'customer_change',coalesce(result->>'reason',result->>'status') || ': ' || coalesce(result->>'message',''))
   ON CONFLICT(bl_id) DO UPDATE SET source=excluded.source,error_message=excluded.error_message;
 PERFORM public.alert_stale_invoice_for_bl(c.bl_id,'customer_change');
 RETURN jsonb_build_object('status','reissue_pending','billing',result,'bl_id',c.bl_id);
END $function$;
