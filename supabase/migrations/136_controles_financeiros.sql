-- Controles financeiros: evidência de restituição e resumo de recebimentos.
-- Preserva valores e documentos históricos; não remove dados existentes.
-- Renumerada de 134 para 148 (134 é da escala; 135-147 das PRs 845/847); os sufixos _legacy_134 são só nomes.
BEGIN;
ALTER TABLE public.invoice_refunds ADD COLUMN bank_reference text, ADD COLUMN beneficiary text,
  ADD COLUMN settled_by uuid REFERENCES public.user_profiles(id);
CREATE UNIQUE INDEX invoice_refunds_bank_reference ON public.invoice_refunds(lower(btrim(bank_reference))) WHERE bank_reference IS NOT NULL AND status = 'settled';

CREATE FUNCTION public.confirm_invoice_refund(p_refund_id bigint, p_bank_reference text, p_beneficiary text, p_paid_at timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r public.invoice_refunds%ROWTYPE; v_invoice_id bigint; v_bl_id text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_financeiro_user() THEN RAISE EXCEPTION 'Sem permissão para confirmar restituição.' USING ERRCODE = '42501'; END IF;
  IF length(btrim(coalesce(p_bank_reference, ''))) < 3 OR length(btrim(coalesce(p_beneficiary, ''))) < 3 OR p_paid_at IS NULL OR p_paid_at > now() THEN
    RAISE EXCEPTION 'Informe referência bancária, favorecido e data da devolução efetiva.' USING ERRCODE = '22023'; END IF;
  SELECT invoice_id INTO v_invoice_id FROM public.invoice_refunds WHERE id = p_refund_id;
  FOR v_bl_id IN SELECT DISTINCT bl_id FROM public.invoice_receivable_links WHERE invoice_id = v_invoice_id
     UNION SELECT bl_id FROM public.invoice_bls WHERE invoice_id = v_invoice_id ORDER BY 1 LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('bl:' || v_bl_id,0));
  END LOOP;
  PERFORM pg_advisory_xact_lock(hashtextextended('bank-refund:' || lower(btrim(p_bank_reference)),0));
  PERFORM 1 FROM public.invoices WHERE id = v_invoice_id FOR UPDATE;
  SELECT * INTO r FROM public.invoice_refunds WHERE id = p_refund_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Restituição não encontrada.' USING ERRCODE = 'P0002'; END IF;
  IF r.status = 'settled' AND r.bank_reference = btrim(p_bank_reference) AND r.beneficiary = btrim(p_beneficiary) AND r.settled_at = p_paid_at THEN
    RETURN jsonb_build_object('refund_id', r.id, 'status', 'settled'); END IF;
  IF r.status <> 'pending' THEN RAISE EXCEPTION 'Restituição não está pendente.' USING ERRCODE = '22023'; END IF;
  PERFORM 1 FROM public.invoices WHERE id = r.invoice_id FOR UPDATE;
  IF (SELECT coalesce(sum(amount_brl),0) FROM public.invoice_refunds WHERE invoice_id = r.invoice_id AND status <> 'cancelled') >
     (SELECT coalesce(total_paid_brl,0) FROM public.invoices WHERE id = r.invoice_id) THEN
    RAISE EXCEPTION 'Restituição sem lastro no valor recebido.' USING ERRCODE = '22023'; END IF;
  IF EXISTS(SELECT 1 FROM public.demurrage_refunds WHERE status='settled' AND lower(btrim(bank_reference))=lower(btrim(p_bank_reference))) THEN
    RAISE EXCEPTION 'Comprovante de devolução já utilizado.' USING ERRCODE='23505'; END IF;
  UPDATE public.invoice_refunds SET status = 'settled', settled_at = p_paid_at,
    bank_reference = btrim(p_bank_reference), beneficiary = btrim(p_beneficiary), settled_by = auth.uid() WHERE id = r.id;
  INSERT INTO public.audit_logs(entity_type, entity_id, field_name, new_value, changed_by, justification)
    VALUES ('invoice_refund', r.id::text, 'refund_confirmed', jsonb_build_object('reference', btrim(p_bank_reference), 'beneficiary', btrim(p_beneficiary), 'paid_at', p_paid_at, 'amount_brl', r.amount_brl)::text, auth.uid(), 'Devolução bancária confirmada pelo Financeiro');
  RETURN jsonb_build_object('refund_id', r.id, 'status', 'settled');
END $$;
REVOKE ALL ON FUNCTION public.confirm_invoice_refund(bigint,text,text,timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_invoice_refund(bigint,text,text,timestamptz) TO authenticated;

CREATE FUNCTION public._invoice_financial_summary(p_invoice_id bigint) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
 WITH scope AS (SELECT * FROM public.invoices WHERE id = p_invoice_id), cash AS (
   SELECT coalesce(sum(p.amount_brl),0) received, max(p.paid_at) paid_at FROM public.payments p WHERE p.invoice_id = p_invoice_id
 ), covered AS (
   SELECT coalesce(sum(s.amount_brl),0) received, max(p.paid_at) paid_at FROM public.ledger_settlements s
   JOIN public.payments p ON p.id = s.payment_id JOIN scope i ON i.covered_by_invoice_id = s.invoice_id
   WHERE s.receivable_id IN (SELECT receivable_id FROM public.invoice_receivable_links WHERE invoice_id = p_invoice_id)
 ), refunds AS (
   SELECT coalesce(sum(r.amount_brl) FILTER (WHERE r.status = 'settled'),0) returned,
     coalesce(sum(r.amount_brl) FILTER (WHERE r.status = 'pending'),0) pending
   FROM public.invoice_refunds r JOIN scope i ON r.invoice_id = i.id OR
    (i.status = 'covered' AND r.invoice_id = i.covered_by_invoice_id AND r.correction_receivable_id IN
      (SELECT receivable_id FROM public.invoice_receivable_links WHERE invoice_id = i.id))
 )
 SELECT jsonb_build_object('gross_received_brl', CASE WHEN i.status = 'covered' THEN covered.received ELSE cash.received END,
  'offset_brl', coalesce((SELECT sum(c.offset_brl) FROM public.invoice_corrections c WHERE c.invoice_id = i.id OR c.receivable_id IN (SELECT receivable_id FROM public.invoice_receivable_links WHERE invoice_id = i.id)),0),
  'refunded_brl', refunds.returned, 'pending_refund_brl', refunds.pending,
  'net_received_brl', (CASE WHEN i.status = 'covered' THEN covered.received ELSE cash.received END) - refunds.returned,
  'paid_at', CASE WHEN i.status = 'covered' THEN covered.paid_at ELSE cash.paid_at END,
  'covered_by_invoice_number', (SELECT invoice_number FROM public.invoices WHERE id = i.covered_by_invoice_id))
 FROM scope i CROSS JOIN cash CROSS JOIN covered CROSS JOIN refunds;
$$;
REVOKE ALL ON FUNCTION public._invoice_financial_summary(bigint) FROM PUBLIC, anon, authenticated;
ALTER FUNCTION public.list_invoice_details(bigint) RENAME TO _list_invoice_details_legacy_134;
REVOKE ALL ON FUNCTION public._list_invoice_details_legacy_134(bigint) FROM PUBLIC, anon, authenticated;
CREATE FUNCTION public.list_invoice_details(p_invoice_id bigint) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE result jsonb;
BEGIN
  result := public._list_invoice_details_legacy_134(p_invoice_id);
  RETURN result || jsonb_build_object('financial_summary', public._invoice_financial_summary(p_invoice_id));
END $$;
REVOKE ALL ON FUNCTION public.list_invoice_details(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_invoice_details(bigint) TO authenticated;
ALTER FUNCTION public._portal_invoice_details_core(bigint,bigint) RENAME TO _portal_invoice_details_legacy_134;
REVOKE ALL ON FUNCTION public._portal_invoice_details_legacy_134(bigint,bigint) FROM PUBLIC, anon, authenticated;
CREATE FUNCTION public._portal_invoice_details_core(p_customer_id bigint,p_invoice_id bigint) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE result jsonb;
BEGIN
 result := public._portal_invoice_details_legacy_134(p_customer_id,p_invoice_id);
 RETURN result || jsonb_build_object('financial_summary', public._invoice_financial_summary(p_invoice_id));
END $$;
REVOKE ALL ON FUNCTION public._portal_invoice_details_core(bigint,bigint) FROM PUBLIC, anon, authenticated;
ALTER TABLE public.invoice_items ADD COLUMN charge_calculation_snapshot jsonb;

CREATE TABLE public.invoice_customer_changes (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 bl_id text NOT NULL REFERENCES public.bls(id), receivable_id bigint NOT NULL UNIQUE REFERENCES public.bl_receivables(id),
 original_customer_id bigint NOT NULL REFERENCES public.customers(id), target_customer_id bigint NOT NULL REFERENCES public.customers(id),
 original_invoice_ids bigint[] NOT NULL,
 status text NOT NULL CHECK(status IN ('pending_refund','reissue_pending','completed')),
 new_invoice_id bigint REFERENCES public.invoices(id), reason text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz, created_by uuid NOT NULL REFERENCES public.user_profiles(id)
);
ALTER TABLE public.invoice_customer_changes ENABLE ROW LEVEL SECURITY;
CREATE POLICY invoice_customer_changes_read ON public.invoice_customer_changes FOR SELECT TO authenticated USING(public.is_active_read_user());
GRANT SELECT ON public.invoice_customer_changes TO authenticated;
ALTER TABLE public.bl_receivables DROP CONSTRAINT bl_receivables_source_check;
ALTER TABLE public.bl_receivables ADD CONSTRAINT bl_receivables_source_check CHECK(source = 'local_charges' OR source = 'local_charges_archived:' || id::text);

CREATE FUNCTION public._finish_invoice_customer_change(p_change_id bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE c public.invoice_customer_changes%ROWTYPE; result jsonb; b public.bls%ROWTYPE;
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
   IF result->>'status' = 'invoiced' OR result->>'reason' IN ('exempt','bl_cancelled') THEN
     UPDATE public.invoice_customer_changes SET status = 'completed', completed_at = now(),
       new_invoice_id = nullif(coalesce(result->>'invoice_id',result->'invoice'->>'invoice_id'),'')::bigint WHERE id = c.id;
     DELETE FROM public.invoice_basis_pending_changes WHERE bl_id=c.bl_id AND source='customer_change';
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
END $$;
REVOKE ALL ON FUNCTION public._finish_invoice_customer_change(bigint) FROM PUBLIC, anon, authenticated;

ALTER FUNCTION public._apply_paid_basis_change(text,bigint,jsonb,boolean,text,uuid) RENAME TO _apply_paid_basis_change_legacy_134;
REVOKE ALL ON FUNCTION public._apply_paid_basis_change_legacy_134(text,bigint,jsonb,boolean,text,uuid) FROM PUBLIC, anon, authenticated;
CREATE FUNCTION public._apply_paid_basis_change(p_bl_id text,p_receivable_id bigint,p_quote jsonb,p_customer_changed boolean,p_source text,p_actor uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r public.bl_receivables%ROWTYPE; c public.invoice_customer_changes%ROWTYPE; ids bigint[]; paid_invoice bigint; result jsonb;
BEGIN
 SELECT * INTO c FROM public.invoice_customer_changes WHERE receivable_id = p_receivable_id;
 IF FOUND THEN
   IF c.status = 'pending_refund' THEN RETURN jsonb_build_object('bl_id',p_bl_id,'status','pending_refund','reason','Devolver ao Cliente original antes da nova cobrança'); END IF;
   RETURN public._finish_invoice_customer_change(c.id);
 END IF;
 IF NOT p_customer_changed THEN RETURN public._apply_paid_basis_change_legacy_134(p_bl_id,p_receivable_id,p_quote,false,p_source,p_actor); END IF;
 SELECT * INTO r FROM public.bl_receivables WHERE id = p_receivable_id FOR UPDATE;
 ids := public._live_local_invoice_ids_for_bl(p_bl_id);
 SELECT invoice_id INTO paid_invoice FROM public.ledger_settlements WHERE receivable_id = p_receivable_id ORDER BY invoice_id LIMIT 1;
 IF paid_invoice IS NULL OR p_actor IS NULL THEN
   PERFORM public.alert_stale_invoice_for_bl(p_bl_id,p_source);
   RETURN jsonb_build_object('bl_id',p_bl_id,'status','has_payment','reason','no_paid_invoice'); END IF;
 INSERT INTO public.invoice_customer_changes(bl_id,receivable_id,original_customer_id,target_customer_id,original_invoice_ids,status,reason,created_by)
 VALUES(p_bl_id,r.id,r.customer_id,(SELECT customer_id FROM public.bls WHERE id=p_bl_id),ids,'pending_refund','Troca de CNPJ: devolver ao Cliente original e emitir para o novo Cliente',p_actor) RETURNING * INTO c;
 IF r.original_amount_brl - r.correction_amount_brl > 0 THEN
   result := public._register_invoice_correction_core(paid_invoice,r.id,0,c.reason,p_actor);
 END IF;
 PERFORM public.alert_stale_invoice_for_bl(p_bl_id,'customer_change');
 IF NOT EXISTS(SELECT 1 FROM public.invoice_refunds WHERE correction_receivable_id=r.id AND status='pending') THEN
   RETURN public._finish_invoice_customer_change(c.id); END IF;
 RETURN jsonb_build_object('bl_id',p_bl_id,'status','pending_refund','refund_brl',result->'refund_brl','reason',c.reason);
END $$;
REVOKE ALL ON FUNCTION public._apply_paid_basis_change(text,bigint,jsonb,boolean,text,uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._live_local_invoice_ids_for_bl(p_bl_id text) RETURNS bigint[]
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
 SELECT coalesce(array_agg(DISTINCT inv.id ORDER BY inv.id),ARRAY[]::bigint[]) FROM public.invoices inv
 WHERE inv.invoice_type IN ('individual','consolidated') AND coalesce(inv.status,'issued') IN ('draft','issued','overdue','partially_paid','paid')
 AND NOT EXISTS(SELECT 1 FROM public.invoice_customer_changes c WHERE c.bl_id=p_bl_id AND c.status IN ('reissue_pending','completed') AND inv.id=ANY(c.original_invoice_ids))
 AND (EXISTS(SELECT 1 FROM public.invoice_bls ib WHERE ib.invoice_id=inv.id AND ib.bl_id=p_bl_id)
 OR EXISTS(SELECT 1 FROM public.invoice_receivable_links l WHERE l.invoice_id=inv.id AND l.bl_id=p_bl_id AND l.status IN ('active','settled_by_this_invoice')));
$$;

CREATE FUNCTION public.guard_invoice_during_customer_refund() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.invoice_customer_changes c WHERE c.bl_id = NEW.bl_id AND c.status = 'pending_refund') THEN
   RAISE EXCEPTION 'Confirme a devolução ao Cliente original antes de emitir nova cobrança para este B/L.' USING ERRCODE = '22023'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_invoice_during_customer_refund() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER guard_invoice_during_customer_refund BEFORE INSERT ON public.invoice_bls FOR EACH ROW EXECUTE FUNCTION public.guard_invoice_during_customer_refund();
CREATE TRIGGER guard_ledger_invoice_during_customer_refund BEFORE INSERT ON public.invoice_receivable_links FOR EACH ROW EXECUTE FUNCTION public.guard_invoice_during_customer_refund();

CREATE FUNCTION public.finish_customer_change_after_refund() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE change_id bigint;
BEGIN
 IF NEW.status = 'settled' AND OLD.status IS DISTINCT FROM 'settled' THEN
   FOR change_id IN SELECT id FROM public.invoice_customer_changes WHERE status <> 'completed' AND
     (receivable_id=NEW.correction_receivable_id OR NEW.invoice_id=ANY(original_invoice_ids)) ORDER BY id LOOP
     PERFORM public._finish_invoice_customer_change(change_id);
   END LOOP;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.finish_customer_change_after_refund() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER finish_customer_change_after_refund AFTER UPDATE OF status ON public.invoice_refunds FOR EACH ROW EXECUTE FUNCTION public.finish_customer_change_after_refund();

ALTER FUNCTION public.retry_invoice_basis_changes(text) RENAME TO retry_invoice_basis_changes_legacy_134;
REVOKE ALL ON FUNCTION public.retry_invoice_basis_changes_legacy_134(text) FROM PUBLIC, anon, authenticated;
CREATE FUNCTION public.retry_invoice_basis_changes(p_bl_id text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE change_id bigint;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_admin() THEN RAISE EXCEPTION 'Sem permissão.' USING ERRCODE='42501'; END IF;
 SELECT id INTO change_id FROM public.invoice_customer_changes WHERE bl_id = p_bl_id AND status <> 'completed' ORDER BY id DESC LIMIT 1;
 IF change_id IS NOT NULL THEN RETURN public._finish_invoice_customer_change(change_id); END IF;
 RETURN public.retry_invoice_basis_changes_legacy_134(p_bl_id);
END $$;
REVOKE ALL ON FUNCTION public.retry_invoice_basis_changes(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.retry_invoice_basis_changes(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.prevent_duplicate_active_invoice_bl_link() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.invoices WHERE id = NEW.invoice_id AND coalesce(status,'issued') IN ('draft','issued','partially_paid','overdue','paid'))
 AND EXISTS(SELECT 1 FROM public.invoice_bls ib JOIN public.invoices inv ON inv.id = ib.invoice_id
   WHERE ib.bl_id = NEW.bl_id AND ib.id IS DISTINCT FROM NEW.id AND coalesce(inv.status,'issued') IN ('draft','issued','partially_paid','overdue','paid')
   AND NOT EXISTS(SELECT 1 FROM public.invoice_customer_changes c JOIN public.bl_receivables r ON r.id = c.receivable_id
    WHERE c.bl_id = ib.bl_id AND c.status IN ('reissue_pending','completed') AND inv.id=ANY(c.original_invoice_ids)
    AND r.source = 'local_charges_archived:' || r.id::text AND r.balance_brl = 0 AND r.original_amount_brl = r.correction_amount_brl
    AND NOT EXISTS(SELECT 1 FROM public.invoice_refunds f WHERE f.correction_receivable_id = r.id AND f.status = 'pending')))
 THEN RAISE EXCEPTION 'PT409: B/L ja vinculado a uma invoice ativa.' USING ERRCODE='23505'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.prevent_duplicate_active_invoice_bl_link() FROM PUBLIC, anon, authenticated;
ALTER TABLE public.payments ADD COLUMN bank_reference text;
-- A referência pode se repetir: um PIX pode pagar mais de uma cobrança (decisão de 2026-10-05).
CREATE TABLE public.financial_payment_attempts(request_id uuid PRIMARY KEY,payload_hash text NOT NULL,payment_id bigint, result jsonb,created_by uuid NOT NULL REFERENCES public.user_profiles(id));
ALTER TABLE public.financial_payment_attempts ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION public.register_verified_invoice_payment(p_invoice_id bigint,p_amount_brl numeric,p_method text,p_paid_at timestamptz,p_notes text,p_request_id uuid,p_bank_reference text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE h text; attempt public.financial_payment_attempts%ROWTYPE; v_result jsonb; v_payment_id bigint; bl_id text; manual_invoice record; paid numeric; excess numeric;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_admin() THEN RAISE EXCEPTION 'Sem permissão para registrar pagamento.' USING ERRCODE = '42501'; END IF;
 IF p_amount_brl IS NULL OR p_amount_brl::text IN ('NaN','Infinity','-Infinity') OR p_amount_brl<=0 OR p_amount_brl<>round(p_amount_brl,2) THEN RAISE EXCEPTION 'Informe valor positivo com até duas casas decimais.' USING ERRCODE='22023'; END IF;
 IF p_request_id IS NULL OR length(btrim(coalesce(p_bank_reference,''))) < 3 THEN RAISE EXCEPTION 'Informe a referência do recebimento bancário.' USING ERRCODE = '22023'; END IF;
 -- Ordem compartilhada com importação e conciliação: B/Ls antes das linhas financeiras.
 FOR bl_id IN SELECT DISTINCT l.bl_id FROM public.invoice_receivable_links l WHERE l.invoice_id=p_invoice_id
 UNION SELECT ib.bl_id FROM public.invoice_bls ib WHERE ib.invoice_id=p_invoice_id ORDER BY 1 LOOP
   PERFORM pg_advisory_xact_lock(hashtextextended('bl:'||bl_id,0)); END LOOP;
 h := md5(jsonb_build_object('invoice',p_invoice_id,'amount',round(p_amount_brl,2),'method',p_method,'paid_at',p_paid_at,'notes',p_notes,'reference',lower(btrim(p_bank_reference)))::text);
 INSERT INTO public.financial_payment_attempts(request_id,payload_hash,created_by) VALUES(p_request_id,h,auth.uid()) ON CONFLICT DO NOTHING;
 SELECT * INTO attempt FROM public.financial_payment_attempts WHERE request_id=p_request_id FOR UPDATE;
 IF attempt.payload_hash <> h OR attempt.created_by <> auth.uid() THEN RAISE EXCEPTION 'Tentativa reutilizada com dados diferentes.' USING ERRCODE='22023'; END IF;
 IF attempt.result IS NOT NULL THEN
   IF NOT EXISTS(SELECT 1 FROM public.payments p WHERE p.id=attempt.payment_id) THEN RAISE EXCEPTION 'Esta baixa foi cancelada. Confira o extrato e inicie uma nova operação.' USING ERRCODE='22023'; END IF;
   RETURN attempt.result; END IF;
 IF (SELECT invoice_type FROM public.invoices WHERE id=p_invoice_id) = 'manual' THEN
   SELECT * INTO manual_invoice FROM public.invoices WHERE id=p_invoice_id AND status IN ('issued','overdue','partially_paid','paid') FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'Fatura avulsa não está disponível para receber pagamento.' USING ERRCODE='22023'; END IF;
   excess := greatest(p_amount_brl-manual_invoice.balance_brl,0);
   INSERT INTO public.payments(invoice_id,amount_brl,payment_method,paid_at,registered_by,notes)
     VALUES(p_invoice_id,p_amount_brl,p_method,coalesce(p_paid_at,now()),auth.uid(),p_notes) RETURNING id INTO v_payment_id;
   SELECT sum(amount_brl) INTO paid FROM public.payments WHERE invoice_id=p_invoice_id;
   UPDATE public.invoices SET total_paid_brl=paid,balance_brl=greatest(manual_invoice.balance_brl-p_amount_brl,0),
     status=CASE WHEN manual_invoice.balance_brl-p_amount_brl<=0 THEN 'paid' ELSE 'partially_paid' END WHERE id=p_invoice_id;
   IF excess>0 THEN
     INSERT INTO public.invoice_refunds(invoice_id,payment_id,amount_brl,notes,registered_by)
       VALUES(p_invoice_id,v_payment_id,excess,'Excedente de recebimento da fatura avulsa',auth.uid()); END IF;
   v_result := jsonb_build_object('invoice_id',p_invoice_id,'payment_id',v_payment_id,'refund_due_brl',excess);
 ELSE
   v_result := public.register_ledger_invoice_payment(p_invoice_id,p_amount_brl,p_method,p_paid_at,NULL,'manual',p_notes,auth.uid(),p_request_id);
 END IF;
 v_payment_id := (v_result->>'payment_id')::bigint;
 IF v_payment_id IS NULL THEN RAISE EXCEPTION 'Pagamento não retornou identificador.'; END IF;
 UPDATE public.payments SET bank_reference=btrim(p_bank_reference) WHERE id=v_payment_id;
 UPDATE public.financial_payment_attempts SET payment_id=v_payment_id,result=v_result WHERE request_id=p_request_id;
 RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.register_verified_invoice_payment(bigint,numeric,text,timestamptz,text,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.register_verified_invoice_payment(bigint,numeric,text,timestamptz,text,uuid,text) TO authenticated;

-- A API antiga de confirmação sem comprovante deixa de liquidar devoluções.
CREATE OR REPLACE FUNCTION public.settle_invoice_refund(p_refund_id bigint,p_actor uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_financeiro_user() THEN
    RAISE EXCEPTION 'Sem permissão para confirmar restituição.' USING ERRCODE='42501';
  END IF;
  RAISE EXCEPTION 'Use a confirmação de devolução com referência bancária, favorecido e data.' USING ERRCODE='22023';
END $$;
ALTER TABLE public.invoice_refunds ADD COLUMN purpose text NOT NULL DEFAULT 'correction' CHECK(purpose IN ('correction','cancel')),
 ADD COLUMN request_id uuid UNIQUE;
CREATE TABLE public.demurrage_refunds(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, invoice_id bigint NOT NULL REFERENCES public.demurrage_invoices(id),
 amount_brl numeric(14,2) NOT NULL CHECK(amount_brl>0), status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','settled','cancelled')),
 purpose text NOT NULL CHECK(purpose IN ('correction','cancel')), notes text NOT NULL, request_id uuid NOT NULL UNIQUE,
 created_at timestamptz NOT NULL DEFAULT now(), registered_by uuid NOT NULL REFERENCES public.user_profiles(id),
 settled_at timestamptz, settled_by uuid REFERENCES public.user_profiles(id), bank_reference text, beneficiary text
);
CREATE UNIQUE INDEX demurrage_refunds_bank_reference ON public.demurrage_refunds(lower(btrim(bank_reference))) WHERE status='settled';
ALTER TABLE public.demurrage_refunds ENABLE ROW LEVEL SECURITY;
CREATE POLICY demurrage_refunds_read ON public.demurrage_refunds FOR SELECT TO authenticated USING(public.is_active_read_user());
GRANT SELECT ON public.demurrage_refunds TO authenticated;

CREATE FUNCTION public.request_financial_refund(p_source text,p_invoice_id bigint,p_amount_brl numeric,p_reason text,p_purpose text,p_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE received numeric; reserved numeric; existing record; refund_id bigint;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_admin() THEN RAISE EXCEPTION 'Somente o Administrativo autoriza restituição excepcional.' USING ERRCODE='42501'; END IF;
 IF p_source NOT IN ('manual','demurrage') OR p_source IS NULL OR p_purpose NOT IN ('correction','cancel') OR p_purpose IS NULL OR
    p_request_id IS NULL OR coalesce(round(p_amount_brl,2),0)<=0 OR length(btrim(coalesce(p_reason,'')))<10 THEN
    RAISE EXCEPTION 'Informe origem, valor positivo, finalidade e justificativa detalhada.' USING ERRCODE='22023'; END IF;
 IF p_source='manual' THEN
   SELECT total_paid_brl INTO received FROM public.invoices WHERE id=p_invoice_id AND invoice_type='manual' AND status IN ('paid','partially_paid') FOR UPDATE;
   SELECT id,invoice_id,amount_brl,notes,purpose,status INTO existing FROM public.invoice_refunds WHERE request_id=p_request_id;
   SELECT coalesce(sum(amount_brl),0) INTO reserved FROM public.invoice_refunds WHERE invoice_id=p_invoice_id AND status<>'cancelled';
 ELSE
   SELECT current_total_brl INTO received FROM public.demurrage_invoices WHERE id=p_invoice_id AND status='paid' FOR UPDATE;
   SELECT id,invoice_id,amount_brl,notes,purpose,status INTO existing FROM public.demurrage_refunds WHERE request_id=p_request_id;
   SELECT coalesce(sum(amount_brl),0) INTO reserved FROM public.demurrage_refunds WHERE invoice_id=p_invoice_id AND status<>'cancelled';
 END IF;
 IF existing.id IS NOT NULL THEN
   IF existing.status='cancelled' THEN RAISE EXCEPTION 'Autorização cancelada: inicie nova solicitação.' USING ERRCODE='22023'; END IF;
   IF existing.invoice_id<>p_invoice_id OR existing.amount_brl<>round(p_amount_brl,2) OR existing.notes<>btrim(p_reason) OR existing.purpose<>p_purpose THEN
     RAISE EXCEPTION 'Solicitação reutilizada com outros dados.' USING ERRCODE='22023'; END IF;
   RETURN jsonb_build_object('refund_id',existing.id,'idempotent',true); END IF;
 IF received IS NULL OR round(p_amount_brl,2)>received-reserved THEN RAISE EXCEPTION 'Restituição excede o recebimento disponível ou fatura não está paga.' USING ERRCODE='22023'; END IF;
 IF p_purpose='cancel' AND round(p_amount_brl,2)<>received-reserved THEN RAISE EXCEPTION 'Cancelamento exige devolver todo o recebido ainda disponível.' USING ERRCODE='22023'; END IF;
 IF p_source='manual' THEN
   INSERT INTO public.invoice_refunds(invoice_id,amount_brl,origin,notes,registered_by,purpose,request_id)
    VALUES(p_invoice_id,round(p_amount_brl,2),'correction',btrim(p_reason),auth.uid(),p_purpose,p_request_id) RETURNING id INTO refund_id;
 ELSE
   INSERT INTO public.demurrage_refunds(invoice_id,amount_brl,notes,registered_by,purpose,request_id)
    VALUES(p_invoice_id,round(p_amount_brl,2),btrim(p_reason),auth.uid(),p_purpose,p_request_id) RETURNING id INTO refund_id;
 END IF;
 INSERT INTO public.audit_logs(entity_type,entity_id,field_name,new_value,changed_by,justification)
 VALUES(p_source||'_invoice',p_invoice_id::text,'refund_requested',jsonb_build_object('refund_id',refund_id,'amount_brl',round(p_amount_brl,2),'purpose',p_purpose)::text,auth.uid(),btrim(p_reason));
 RETURN jsonb_build_object('refund_id',refund_id,'status','pending');
END $$;
REVOKE ALL ON FUNCTION public.request_financial_refund(text,bigint,numeric,text,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.request_financial_refund(text,bigint,numeric,text,text,uuid) TO authenticated;

CREATE FUNCTION public.list_financial_refunds(p_source text,p_invoice_id bigint) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE received numeric; rows jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_active_read_user() THEN RAISE EXCEPTION 'Sem permissão.' USING ERRCODE='42501'; END IF;
 IF p_source='manual' THEN
   SELECT total_paid_brl INTO received FROM public.invoices WHERE id=p_invoice_id AND invoice_type='manual';
   SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]'::jsonb) INTO rows FROM public.invoice_refunds r WHERE invoice_id=p_invoice_id;
 ELSIF p_source='demurrage' THEN
   SELECT CASE WHEN paid_at IS NOT NULL THEN current_total_brl ELSE 0 END INTO received FROM public.demurrage_invoices WHERE id=p_invoice_id;
   SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]'::jsonb) INTO rows FROM public.demurrage_refunds r WHERE invoice_id=p_invoice_id;
 ELSE RAISE EXCEPTION 'Origem inválida.' USING ERRCODE='22023'; END IF;
 RETURN jsonb_build_object('received_brl',coalesce(received,0),'refunds',rows);
END $$;
REVOKE ALL ON FUNCTION public.list_financial_refunds(text,bigint) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.list_financial_refunds(text,bigint) TO authenticated;

CREATE FUNCTION public.confirm_demurrage_refund(p_refund_id bigint,p_bank_reference text,p_beneficiary text,p_paid_at timestamptz) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r public.demurrage_refunds%ROWTYPE; invoice_id bigint; v_bl_id text;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_financeiro_user() THEN RAISE EXCEPTION 'Sem permissão para confirmar restituição.' USING ERRCODE='42501'; END IF;
 IF length(btrim(coalesce(p_bank_reference,'')))<3 OR length(btrim(coalesce(p_beneficiary,'')))<3 OR p_paid_at IS NULL OR p_paid_at>now() THEN RAISE EXCEPTION 'Informe comprovante, favorecido e data efetiva.' USING ERRCODE='22023'; END IF;
 SELECT d.invoice_id INTO invoice_id FROM public.demurrage_refunds d WHERE d.id=p_refund_id;
 SELECT d.bl_id INTO v_bl_id FROM public.demurrage_invoices d WHERE d.id=invoice_id;
 PERFORM pg_advisory_xact_lock(hashtextextended('bl:'||v_bl_id,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('bank-refund:'||lower(btrim(p_bank_reference)),0));
 PERFORM 1 FROM public.demurrage_invoices d WHERE d.id=invoice_id FOR UPDATE;
 SELECT * INTO r FROM public.demurrage_refunds WHERE id=p_refund_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Restituição não encontrada.' USING ERRCODE='P0002'; END IF;
 IF r.status='settled' AND r.bank_reference=btrim(p_bank_reference) AND r.beneficiary=btrim(p_beneficiary) AND r.settled_at=p_paid_at THEN RETURN jsonb_build_object('status','settled'); END IF;
 IF r.status<>'pending' THEN RAISE EXCEPTION 'Restituição não está pendente.' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM public.invoice_refunds WHERE status='settled' AND lower(btrim(bank_reference))=lower(btrim(p_bank_reference))) THEN RAISE EXCEPTION 'Comprovante de devolução já utilizado.' USING ERRCODE='23505'; END IF;
 UPDATE public.demurrage_refunds SET status='settled',bank_reference=btrim(p_bank_reference),beneficiary=btrim(p_beneficiary),settled_at=p_paid_at,settled_by=auth.uid() WHERE id=r.id;
 IF EXISTS(SELECT 1 FROM public.demurrage_refunds WHERE demurrage_refunds.invoice_id=r.invoice_id AND purpose='cancel' AND status<>'cancelled') AND (SELECT sum(amount_brl) FROM public.demurrage_refunds WHERE demurrage_refunds.invoice_id=r.invoice_id AND status='settled')=(SELECT current_total_brl FROM public.demurrage_invoices WHERE id=r.invoice_id) THEN
   UPDATE public.demurrage_invoices SET status='cancelled',notes=concat_ws(E'\n',notes,'Cancelada após devolução integral: '||r.notes) WHERE id=r.invoice_id; END IF;
 INSERT INTO public.audit_logs(entity_type,entity_id,field_name,new_value,changed_by,justification)
 VALUES('demurrage_refund',r.id::text,'refund_confirmed',jsonb_build_object('reference',p_bank_reference,'beneficiary',p_beneficiary,'paid_at',p_paid_at,'amount_brl',r.amount_brl)::text,auth.uid(),r.notes);
 RETURN jsonb_build_object('status','settled');
END $$;
REVOKE ALL ON FUNCTION public.confirm_demurrage_refund(bigint,text,text,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.confirm_demurrage_refund(bigint,text,text,timestamptz) TO authenticated;

CREATE FUNCTION public.close_manual_invoice_after_refund() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.status='settled' AND OLD.status IS DISTINCT FROM 'settled' AND EXISTS(SELECT 1 FROM public.invoice_refunds WHERE invoice_id=NEW.invoice_id AND purpose='cancel' AND status<>'cancelled') THEN
   UPDATE public.invoices SET status='cancelled',balance_brl=0,cancelled_at=now(),cancelled_by=auth.uid(),cancel_reason='Devolução integral confirmada: '||NEW.notes
   WHERE id=NEW.invoice_id AND invoice_type='manual' AND total_paid_brl=(SELECT sum(amount_brl) FROM public.invoice_refunds WHERE invoice_id=NEW.invoice_id AND status='settled');
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.close_manual_invoice_after_refund() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER close_manual_invoice_after_refund AFTER UPDATE OF status ON public.invoice_refunds FOR EACH ROW EXECUTE FUNCTION public.close_manual_invoice_after_refund();
CREATE FUNCTION public.guard_demurrage_payment_after_refund() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF (NEW.paid_at IS DISTINCT FROM OLD.paid_at OR NEW.current_total_brl IS DISTINCT FROM OLD.current_total_brl) AND EXISTS(SELECT 1 FROM public.demurrage_refunds WHERE invoice_id=OLD.id AND status<>'cancelled') THEN
   RAISE EXCEPTION 'Recebimento financia restituição: preserve a baixa e o valor congelado.' USING ERRCODE='22023'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_demurrage_payment_after_refund() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER guard_demurrage_payment_after_refund BEFORE UPDATE OF paid_at,current_total_brl ON public.demurrage_invoices FOR EACH ROW EXECUTE FUNCTION public.guard_demurrage_payment_after_refund();
CREATE FUNCTION public.prepare_bl_financial_cancellation(p_invoice_id bigint,p_bl_id text,p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r public.bl_receivables%ROWTYPE; paid_invoice bigint;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_admin() THEN RAISE EXCEPTION 'Somente o Administrativo prepara cancelamento financeiro.' USING ERRCODE='42501'; END IF;
 IF length(btrim(coalesce(p_reason,'')))<10 THEN RAISE EXCEPTION 'Informe justificativa detalhada para cancelar a cobrança deste B/L.' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('bl:'||p_bl_id,0));
 PERFORM 1 FROM public.invoices WHERE id=p_invoice_id FOR UPDATE;
 SELECT br.* INTO r FROM public.bl_receivables br JOIN public.invoice_receivable_links l ON l.receivable_id=br.id
 WHERE br.bl_id=p_bl_id AND br.source='local_charges' AND l.invoice_id=p_invoice_id AND l.status IN ('active','settled_by_this_invoice') FOR UPDATE OF br;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.invoices WHERE id=p_invoice_id AND status IN ('paid','partially_paid')) THEN
   RAISE EXCEPTION 'Selecione B/L da fatura paga ou parcialmente paga.' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM public.invoice_customer_changes WHERE bl_id=p_bl_id AND status<>'completed') THEN RAISE EXCEPTION 'Conclua a troca de Cliente antes de solicitar outro ajuste.' USING ERRCODE='22023'; END IF;
 IF r.original_amount_brl-r.correction_amount_brl=0 THEN RETURN jsonb_build_object('status','already_prepared'); END IF;
 SELECT invoice_id INTO paid_invoice FROM public.ledger_settlements WHERE receivable_id=r.id ORDER BY invoice_id LIMIT 1;
 RETURN public._register_invoice_correction_core(coalesce(paid_invoice,p_invoice_id),r.id,0,'Cancelamento financeiro do B/L '||p_bl_id||': '||btrim(p_reason),auth.uid());
END $$;
REVOKE ALL ON FUNCTION public.prepare_bl_financial_cancellation(bigint,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.prepare_bl_financial_cancellation(bigint,text,text) TO authenticated;

ALTER FUNCTION public._quote_bl_local_charges(text,numeric) RENAME TO _quote_bl_local_charges_legacy_134;
REVOKE ALL ON FUNCTION public._quote_bl_local_charges_legacy_134(text,numeric) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public._quote_bl_local_charges(p_bl_id text,p_roe numeric) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.bls WHERE id=p_bl_id AND cancelled_at IS NOT NULL) THEN RETURN jsonb_build_object('status','exempt','total_brl',0); END IF;
 RETURN public._quote_bl_local_charges_legacy_134(p_bl_id,p_roe);
END $$;
REVOKE ALL ON FUNCTION public._quote_bl_local_charges(text,numeric) FROM PUBLIC,anon,authenticated;

ALTER FUNCTION public.get_invoice_correction_summary(bigint) RENAME TO get_invoice_correction_summary_legacy_134;
REVOKE ALL ON FUNCTION public.get_invoice_correction_summary_legacy_134(bigint) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.get_invoice_correction_summary(p_invoice_id bigint) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE result jsonb;
BEGIN
 result := public.get_invoice_correction_summary_legacy_134(p_invoice_id);
 RETURN result || jsonb_build_object('customer_changes',coalesce((SELECT jsonb_agg(jsonb_build_object('bl_id',c.bl_id,'status',c.status,'new_invoice_id',c.new_invoice_id))
 FROM public.invoice_customer_changes c WHERE p_invoice_id=ANY(c.original_invoice_ids)),'[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.get_invoice_correction_summary(bigint) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_invoice_correction_summary(bigint) TO authenticated;
CREATE FUNCTION public.guard_financial_refund_evidence() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_OP='DELETE' THEN
   IF OLD.status='settled' THEN RAISE EXCEPTION 'Devolução confirmada é histórico financeiro e não pode ser apagada.' USING ERRCODE='22023'; END IF;
   RETURN OLD;
 END IF;
 IF TG_OP='INSERT' AND NEW.status='settled' THEN RAISE EXCEPTION 'Registre a autorização pendente e confirme a devolução com comprovante.' USING ERRCODE='22023'; END IF;
 IF TG_OP='UPDATE' THEN
   IF OLD.status='settled' AND to_jsonb(OLD) IS DISTINCT FROM to_jsonb(NEW) THEN RAISE EXCEPTION 'Devolução confirmada não pode ser alterada.' USING ERRCODE='22023'; END IF;
   IF (to_jsonb(OLD)-ARRAY['status','settled_at','settled_by','bank_reference','beneficiary','notes']) IS DISTINCT FROM
      (to_jsonb(NEW)-ARRAY['status','settled_at','settled_by','bank_reference','beneficiary','notes']) THEN
     RAISE EXCEPTION 'Valor, origem e autorização da restituição são imutáveis.' USING ERRCODE='22023'; END IF;
   IF NEW.status='settled' AND OLD.status IS DISTINCT FROM 'settled' THEN
     IF auth.uid() IS NULL OR NOT public.is_financeiro_user() OR NEW.settled_by IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'Sem permissão para confirmar devolução.' USING ERRCODE='42501'; END IF;
     IF length(btrim(coalesce(NEW.bank_reference,'')))<3 OR length(btrim(coalesce(NEW.beneficiary,'')))<3 OR NEW.settled_at IS NULL OR NEW.settled_at>now() THEN
       RAISE EXCEPTION 'Devolução exige referência bancária, favorecido e data efetiva.' USING ERRCODE='22023'; END IF;
   END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_financial_refund_evidence() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER guard_financial_refund_evidence BEFORE INSERT OR UPDATE OR DELETE ON public.invoice_refunds FOR EACH ROW EXECUTE FUNCTION public.guard_financial_refund_evidence();
CREATE TRIGGER guard_demurrage_refund_evidence BEFORE INSERT OR UPDATE OR DELETE ON public.demurrage_refunds FOR EACH ROW EXECUTE FUNCTION public.guard_financial_refund_evidence();

CREATE FUNCTION public.cancel_financial_refund_authorization(p_source text,p_refund_id bigint,p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE affected integer;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_admin() THEN RAISE EXCEPTION 'Somente o Administrativo cancela autorização de restituição.' USING ERRCODE='42501'; END IF;
 IF length(btrim(coalesce(p_reason,'')))<10 THEN RAISE EXCEPTION 'Informe justificativa detalhada.' USING ERRCODE='22023'; END IF;
 IF p_source='manual' THEN
   UPDATE public.invoice_refunds SET status='cancelled',notes=notes||E'\nAutorização cancelada: '||btrim(p_reason)
    WHERE id=p_refund_id AND status='pending' AND request_id IS NOT NULL;
 ELSIF p_source='demurrage' THEN
   UPDATE public.demurrage_refunds SET status='cancelled',notes=notes||E'\nAutorização cancelada: '||btrim(p_reason) WHERE id=p_refund_id AND status='pending';
 ELSE RAISE EXCEPTION 'Origem inválida.' USING ERRCODE='22023'; END IF;
 GET DIAGNOSTICS affected=ROW_COUNT;
 IF affected<>1 THEN RAISE EXCEPTION 'Autorização não está pendente ou foi gerada pela correção do B/L.' USING ERRCODE='22023'; END IF;
 INSERT INTO public.audit_logs(entity_type,entity_id,field_name,new_value,changed_by,justification)
 VALUES(p_source||'_refund',p_refund_id::text,'authorization_cancelled','cancelled',auth.uid(),btrim(p_reason));
END $$;
REVOKE ALL ON FUNCTION public.cancel_financial_refund_authorization(text,bigint,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.cancel_financial_refund_authorization(text,bigint,text) TO authenticated;
-- Escritas de restituição passam pelas RPCs com autoridade e evidência.
REVOKE INSERT,UPDATE,DELETE ON public.invoice_refunds FROM authenticated;
CREATE FUNCTION public.list_invoice_refunds_with_evidence(p_invoice_id bigint) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_active_read_user() THEN RAISE EXCEPTION 'Sem permissão.' USING ERRCODE='42501'; END IF;
 RETURN coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.created_at DESC,r.id DESC) FROM public.invoice_refunds r WHERE invoice_id=p_invoice_id),'[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.list_invoice_refunds_with_evidence(bigint) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.list_invoice_refunds_with_evidence(bigint) TO authenticated;
ALTER FUNCTION public.reverse_invoice_payment(bigint,text,uuid) RENAME TO reverse_invoice_payment_legacy_134;
REVOKE ALL ON FUNCTION public.reverse_invoice_payment_legacy_134(bigint,text,uuid) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.reverse_invoice_payment(p_payment_id bigint,p_reason text DEFAULT NULL,p_actor uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_invoice_id bigint; bl_id text; refund record; result jsonb;
BEGIN
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
 result := public.reverse_invoice_payment_legacy_134(p_payment_id,p_reason,auth.uid());
 -- Avulsa não tem recebível de B/L; sua dívida é o total emitido menos baixas.
 UPDATE public.invoices SET balance_brl=greatest(total_brl-total_paid_brl,0),
   status=CASE WHEN total_paid_brl=0 THEN 'issued' WHEN total_brl-total_paid_brl<=0 THEN 'paid' ELSE 'partially_paid' END
 WHERE id=v_invoice_id AND invoice_type='manual' AND status<>'cancelled';
 RETURN result || jsonb_build_object('new_status',(SELECT status FROM public.invoices WHERE id=v_invoice_id));
END $$;
REVOKE ALL ON FUNCTION public.reverse_invoice_payment(bigint,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.reverse_invoice_payment(bigint,text,uuid) TO authenticated;
CREATE FUNCTION public._bl_customer_change_cash_blockers(p_bl_id text,p_customer_id bigint) RETURNS text[]
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE blockers text[]:=ARRAY[]::text[];
BEGIN
 IF EXISTS(SELECT 1 FROM public.demurrage_invoices d WHERE d.bl_id=p_bl_id AND d.customer_id IS DISTINCT FROM p_customer_id AND d.paid_at IS NOT NULL AND coalesce(d.current_total_brl,0)>
   coalesce((SELECT sum(r.amount_brl) FROM public.demurrage_refunds r WHERE r.invoice_id=d.id AND r.status='settled'),0)) THEN
   blockers:=array_append(blockers,'Demurrage recebida: devolva ao Cliente original e confirme a restituição excepcional antes de trocar o CNPJ.'); END IF;
 IF EXISTS(SELECT 1 FROM public.invoices i WHERE i.invoice_type='manual' AND i.bl_id=p_bl_id AND i.customer_id IS DISTINCT FROM p_customer_id AND i.total_paid_brl>
   coalesce((SELECT sum(r.amount_brl) FROM public.invoice_refunds r WHERE r.invoice_id=i.id AND r.status='settled'),0)) THEN
   blockers:=array_append(blockers,'Avulsa recebida: devolva ao Cliente original e confirme a restituição excepcional antes de trocar o CNPJ.'); END IF;
 RETURN blockers;
END $$;
REVOKE ALL ON FUNCTION public._bl_customer_change_cash_blockers(text,bigint) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.guard_bl_customer_change_other_receipts() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE blockers text[];
BEGIN
 IF NEW.customer_id IS DISTINCT FROM OLD.customer_id THEN
   blockers:=public._bl_customer_change_cash_blockers(OLD.id,NEW.customer_id);
   IF cardinality(blockers)>0 THEN RAISE EXCEPTION '%',array_to_string(blockers,' ') USING ERRCODE='22023'; END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_bl_customer_change_other_receipts() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER guard_bl_customer_change_other_receipts BEFORE UPDATE OF customer_id ON public.bls FOR EACH ROW EXECUTE FUNCTION public.guard_bl_customer_change_other_receipts();

ALTER FUNCTION public.relink_bl_customer(text,bigint,uuid,text) RENAME TO relink_bl_customer_legacy_134;
REVOKE ALL ON FUNCTION public.relink_bl_customer_legacy_134(text,bigint,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.relink_bl_customer(p_bl_id text,p_customer_id bigint,p_changed_by uuid,p_reason text DEFAULT 'Troca de consignatario na reimportacao do B/L') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE b public.bls%ROWTYPE; blockers text[];
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' AND (auth.uid() IS NULL OR NOT public.is_active_user() OR p_changed_by IS DISTINCT FROM auth.uid()) THEN
   RAISE EXCEPTION 'Sem permissão para trocar o Cliente do B/L.' USING ERRCODE='42501'; END IF;
 IF p_changed_by IS NULL OR NOT EXISTS(SELECT 1 FROM public.user_profiles WHERE id=p_changed_by AND active) THEN RAISE EXCEPTION 'Ator interno ativo obrigatório.' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('bl:'||p_bl_id,0));
 SELECT * INTO b FROM public.bls WHERE id=p_bl_id FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('applied',false,'blockers',ARRAY['B/L não encontrado']); END IF;
 IF b.customer_id IS NOT DISTINCT FROM p_customer_id THEN RETURN jsonb_build_object('applied',false,'unchanged',true,'blockers',ARRAY[]::text[]); END IF;
 blockers:=public._bl_customer_change_cash_blockers(p_bl_id,p_customer_id);
 IF cardinality(blockers)>0 THEN RETURN jsonb_build_object('bl_id',p_bl_id,'applied',false,'blockers',blockers); END IF;
 IF EXISTS(SELECT 1 FROM public.bl_receivables WHERE bl_id=p_bl_id AND source='local_charges') OR cardinality(public._live_local_invoice_ids_for_bl(p_bl_id))>0 THEN
   IF p_customer_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.customers WHERE id=p_customer_id) THEN
     RETURN jsonb_build_object('applied',false,'blockers',ARRAY['Cadastre o Cliente de destino antes de trocar B/L faturado']); END IF;
   UPDATE public.bls SET customer_id=p_customer_id,customer_reconciliation_status='reconciled',
     customer_reconciliation_notes='Cliente alterado por reimportação; financeiro preservado e regularizado pela base do B/L' WHERE id=p_bl_id;
   INSERT INTO public.audit_logs(entity_type,entity_id,field_name,old_value,new_value,changed_by,justification)
    VALUES('bl',p_bl_id,'customer_id',b.customer_id::text,p_customer_id::text,p_changed_by,p_reason);
   RETURN jsonb_build_object('bl_id',p_bl_id,'applied',true,'blockers',ARRAY[]::text[],'financial_policy','refund_original_then_reissue');
 END IF;
 RETURN public.relink_bl_customer_legacy_134(p_bl_id,p_customer_id,p_changed_by,p_reason);
END $$;
REVOKE ALL ON FUNCTION public.relink_bl_customer(text,bigint,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.relink_bl_customer(text,bigint,uuid,text) TO service_role;

-- Integração: arquivo financeiro permanece void e recebimento antigo não liquida
-- a nova cobrança, inclusive quando o B/L retorna ao mesmo CNPJ.
CREATE OR REPLACE FUNCTION public.guard_corrected_receivable_balance() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.source = 'local_charges_archived:' || NEW.id::text THEN
   NEW.balance_brl := 0; NEW.status := 'void';
 ELSIF NEW.correction_amount_brl > 0 THEN
   NEW.balance_brl := greatest(NEW.original_amount_brl - NEW.settled_amount_brl - NEW.correction_amount_brl,0);
   NEW.status := CASE WHEN NEW.balance_brl=0 THEN 'settled' WHEN NEW.settled_amount_brl>0 THEN 'partially_settled' ELSE 'open' END;
 END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public._sync_local_charge_receivable_before_correction_123(p_bl_id text) RETURNS bigint
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
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

  SELECT id, customer_id, voyage_id, cargo_mode, pol, pod
  INTO v_bl
  FROM public.bls
  WHERE id = btrim(p_bl_id)
     OR UPPER(id) = UPPER(btrim(p_bl_id))
  ORDER BY (id = btrim(p_bl_id)) DESC
  LIMIT 1;

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
$$;

REVOKE ALL ON FUNCTION public._sync_local_charge_receivable_before_correction_123(text) FROM PUBLIC,anon,authenticated;

COMMIT;
