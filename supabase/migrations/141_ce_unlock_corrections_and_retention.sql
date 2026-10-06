-- Issue 557: preserve correction state, finalize cleanup and daily scheduling.
-- Relies on the "Data status" assertion in AGENTS.md (2026-09-18) solely for
-- setting the newly created cron job inactive pending deployment configuration.
-- No business rows are rewritten by this migration.
BEGIN;
ALTER TABLE public.ce_unlock_documents ADD CONSTRAINT ce_unlock_vip_start_year CHECK(source<>'vip_annual' OR status<>'approved' OR extract(year FROM valid_from)::int=coverage_year);
CREATE OR REPLACE FUNCTION ce_unlock_private.command(p_action text,p_payload jsonb,p_portal boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE cid bigint; r public.ce_unlock_requests; d public.ce_unlock_documents; bid text; ids text[]; v jsonb; result jsonb;
 key uuid; saved ce_unlock_private.receipts; v_version bigint; delivery public.ce_unlock_bl_deliveries; t uuid; p uuid; ex public.ce_unlock_exports; item jsonb;
BEGIN
 IF p_portal THEN cid:=public.current_portal_customer_id(); IF p_action NOT IN('draft','submit') THEN RAISE EXCEPTION '42501: Ação não autorizada.' USING ERRCODE='42501'; END IF;
 ELSE PERFORM ce_unlock_private.actor(true); END IF;
 key:=(p_payload->>'request_key')::uuid; IF key IS NULL THEN RAISE EXCEPTION 'Chave de operação obrigatória'; END IF;
 -- Lock por ator/chave para retries; sem bloqueio global do módulo.
 PERFORM pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_action||key::text,0));
 SELECT * INTO saved FROM ce_unlock_private.receipts WHERE actor_id=auth.uid() AND action=p_action AND request_key=key;
 IF saved.actor_id IS NOT NULL THEN IF saved.payload<>p_payload THEN RAISE EXCEPTION 'Chave já utilizada para outra operação'; END IF; RETURN saved.result; END IF;
 IF p_payload ? 'request_id' THEN
 SELECT * INTO r FROM public.ce_unlock_requests WHERE id=(p_payload->>'request_id')::uuid AND (NOT p_portal OR customer_id=cid) FOR UPDATE;
 IF r.id IS NULL THEN RAISE EXCEPTION '42501: Solicitação não autorizada.' USING ERRCODE='42501'; END IF;
 IF r.version IS DISTINCT FROM (p_payload->>'expected_version')::bigint THEN RAISE EXCEPTION 'Solicitação alterada; atualize a página.' USING ERRCODE='40001'; END IF;
 cid:=r.customer_id;
 ELSE cid:=coalesce(cid,(p_payload->>'customer_id')::bigint); END IF;
 IF cid IS NOT NULL THEN PERFORM 1 FROM public.customers WHERE id=cid FOR UPDATE; END IF;
 CASE p_action
 WHEN 'draft' THEN
 SELECT array_agg(DISTINCT value ORDER BY value) INTO ids FROM jsonb_array_elements_text(p_payload->'bl_ids');
 IF coalesce(cardinality(ids),0) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Selecione de 1 a 100 B/Ls'; END IF;
 PERFORM 1 FROM public.bls WHERE id=ANY(ids) ORDER BY id FOR UPDATE;
 FOREACH bid IN ARRAY ids LOOP
 IF NOT EXISTS(SELECT 1 FROM public.bls WHERE id=bid AND customer_id=cid AND public.bl_has_portal_release(id)) THEN RAISE EXCEPTION '42501: B/L não autorizado.' USING ERRCODE='42501'; END IF;
 item:=ce_unlock_private.item(bid);
 IF NOT (item->>'can_submit')::boolean THEN RAISE EXCEPTION 'B/L % não pode ser solicitado: %',bid,item->'reasons'; END IF;
 END LOOP;
 INSERT INTO public.ce_unlock_requests(customer_id,source,created_by,model_id)
 VALUES(cid,CASE WHEN coalesce((SELECT enabled FROM public.ce_unlock_vip_customers WHERE customer_id=cid),false) THEN 'vip_annual' ELSE 'request' END,auth.uid(),
 (SELECT id FROM public.ce_unlock_documents WHERE source='model' AND status='approved' ORDER BY created_at DESC LIMIT 1)) RETURNING * INTO r;
 INSERT INTO public.ce_unlock_request_bls(request_id,bl_id,ce_at_request) SELECT r.id,id,ce_mercante FROM public.bls WHERE id=ANY(ids);
 result:=ce_unlock_private.request_json(r.id,cid);
 WHEN 'submit' THEN
 IF r.state NOT IN('draft','changes_requested') THEN RAISE EXCEPTION 'Pedido não aceita envio'; END IF;
 IF r.source='vip_annual' THEN
 IF NOT coalesce((SELECT enabled FROM public.ce_unlock_vip_customers WHERE customer_id=cid),false) THEN RAISE EXCEPTION 'Condição VIP revogada'; END IF;
 t:=ce_unlock_private.annual(cid,'termo'); p:=ce_unlock_private.annual(cid,'procuracao');
 IF t IS NULL OR p IS NULL THEN RAISE EXCEPTION 'Regularize os documentos anuais VIP'; END IF;
 ELSE
 SELECT id INTO t FROM public.ce_unlock_documents WHERE request_id=r.id AND type='termo' AND status IN('uploaded','approved') ORDER BY created_at DESC LIMIT 1;
 SELECT id INTO p FROM public.ce_unlock_documents WHERE request_id=r.id AND type='procuracao' AND status IN('uploaded','approved') ORDER BY created_at DESC LIMIT 1;
 IF t IS NULL OR p IS NULL THEN RAISE EXCEPTION 'Anexe termo e procuração'; END IF;
 END IF;
 PERFORM 1 FROM public.bls WHERE id IN(SELECT bl_id FROM public.ce_unlock_request_bls WHERE request_id=r.id) ORDER BY id FOR UPDATE;
 PERFORM 1 FROM public.bl_receivables WHERE bl_id IN(SELECT bl_id FROM public.ce_unlock_request_bls WHERE request_id=r.id) ORDER BY id FOR UPDATE;
 FOR bid IN SELECT bl_id FROM public.ce_unlock_request_bls WHERE request_id=r.id LOOP
 item:=ce_unlock_private.item(bid,r.id);
 IF NOT (item->>'paid')::boolean OR NOT EXISTS(SELECT 1 FROM public.bls b WHERE b.id=bid AND b.customer_id=cid AND b.cancelled_at IS NULL AND b.ce_mercante=(SELECT ce_at_request FROM public.ce_unlock_request_bls WHERE request_id=r.id AND bl_id=bid)) THEN RAISE EXCEPTION 'B/L % perdeu elegibilidade',bid; END IF;
 END LOOP;
 UPDATE public.ce_unlock_request_bls SET termo_approved=CASE WHEN termo_document_id=t THEN termo_approved ELSE false END,
 procuracao_approved=CASE WHEN procuracao_document_id=p THEN procuracao_approved ELSE false END,
 termo_document_id=t,procuracao_document_id=p WHERE request_id=r.id;
 UPDATE public.ce_unlock_requests SET state='submitted',version=version+1,updated_at=now() WHERE id=r.id;
 result:=ce_unlock_private.request_json(r.id,cid);
 WHEN 'set_vip' THEN
 IF trim(coalesce(p_payload->>'reason',''))='' THEN RAISE EXCEPTION 'Motivo obrigatório'; END IF;
 INSERT INTO public.ce_unlock_vip_customers(customer_id) VALUES(cid) ON CONFLICT DO NOTHING;
 SELECT c.version INTO v_version FROM public.ce_unlock_vip_customers c WHERE customer_id=cid FOR UPDATE;
 IF p_payload ? 'expected_version' AND v_version<>(p_payload->>'expected_version')::bigint THEN RAISE EXCEPTION 'Condição VIP alterada' USING ERRCODE='40001'; END IF;
 UPDATE public.ce_unlock_vip_customers SET enabled=(p_payload->>'enabled')::boolean,version=version+1,updated_at=now() WHERE customer_id=cid;
 result:=ce_unlock_private.vip_json(cid);
 WHEN 'review' THEN
 SELECT * INTO d FROM public.ce_unlock_documents WHERE id=(p_payload->>'document_id')::uuid FOR UPDATE;
 IF d.id IS NULL OR d.status='uploading' OR d.purged_at IS NOT NULL THEN RAISE EXCEPTION 'Documento indisponível'; END IF;
 IF d.version IS DISTINCT FROM (p_payload->>'expected_document_version')::bigint THEN RAISE EXCEPTION 'Documento alterado; atualize a página' USING ERRCODE='40001'; END IF;
 IF p_payload->>'decision' NOT IN('approved','changes_requested','revoked') THEN RAISE EXCEPTION 'Decisão inválida'; END IF;
 IF p_payload->>'decision'<>'approved' AND trim(coalesce(p_payload->>'reason',''))='' THEN RAISE EXCEPTION 'Motivo obrigatório'; END IF;
 cid:=d.customer_id;
 IF d.source='request' THEN
 IF r.id IS DISTINCT FROM d.request_id OR r.source<>'request' OR r.state NOT IN('submitted','in_review','changes_requested') THEN RAISE EXCEPTION 'Documento não pertence à análise atual'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.ce_unlock_documents z WHERE z.id=d.id AND z.created_at=(SELECT max(created_at) FROM public.ce_unlock_documents WHERE request_id=r.id AND type=d.type AND status<>'uploading')) THEN RAISE EXCEPTION 'Documento substituído'; END IF;
 SELECT array_agg(value) INTO ids FROM jsonb_array_elements_text(p_payload->'bl_ids');
 IF coalesce(cardinality(ids),0)=0 OR EXISTS(SELECT 1 FROM unnest(ids) x WHERE NOT EXISTS(SELECT 1 FROM public.ce_unlock_request_bls WHERE request_id=r.id AND bl_id=x AND confirmed_at IS NULL)) THEN RAISE EXCEPTION 'Seleção inválida'; END IF;
 UPDATE public.ce_unlock_request_bls SET termo_approved=CASE WHEN d.type='termo' THEN p_payload->>'decision'='approved' ELSE termo_approved END,
 procuracao_approved=CASE WHEN d.type='procuracao' THEN p_payload->>'decision'='approved' ELSE procuracao_approved END
 WHERE request_id=r.id AND bl_id=ANY(ids);
 UPDATE public.ce_unlock_requests SET state=CASE WHEN p_payload->>'decision'<>'approved' OR EXISTS(SELECT 1 FROM public.ce_unlock_documents z WHERE z.request_id=r.id AND z.id<>d.id AND z.status='changes_requested' AND NOT EXISTS(SELECT 1 FROM public.ce_unlock_documents newer WHERE newer.request_id=r.id AND newer.type=z.type AND newer.status<>'uploading' AND newer.created_at>z.created_at)) THEN 'changes_requested' ELSE 'in_review' END,version=version+1,updated_at=now() WHERE id=r.id;
 ELSE
 IF d.source='vip_annual' AND p_payload->>'decision'='approved' THEN
 IF (p_payload->>'valid_until')::date IS DISTINCT FROM make_date((p_payload->>'coverage_year')::int,12,31) OR (p_payload->>'valid_from')::date IS NULL THEN RAISE EXCEPTION 'Validade anual deve terminar em 31/12 do ano informado'; END IF;
 END IF;
 END IF;
 UPDATE public.ce_unlock_documents SET version=version+1,status=p_payload->>'decision',reason=p_payload->>'reason',reviewed_by=auth.uid(),reviewed_at=now(),
 valid_from=CASE WHEN source='vip_annual' AND p_payload->>'decision'='approved' THEN (p_payload->>'valid_from')::date ELSE valid_from END,
 valid_until=CASE WHEN source='vip_annual' AND p_payload->>'decision'='approved' THEN (p_payload->>'valid_until')::date ELSE valid_until END,
 coverage_year=CASE WHEN source='vip_annual' AND p_payload->>'decision'='approved' THEN (p_payload->>'coverage_year')::int ELSE coverage_year END WHERE id=d.id;
 result:=CASE WHEN r.id IS NOT NULL THEN ce_unlock_private.request_json(r.id) ELSE ce_unlock_private.vip_json(cid) END;
 WHEN 'apply_vip' THEN
 IF r.source<>'vip_annual' OR r.state IN('cancelled','completed') OR NOT coalesce((SELECT enabled FROM public.ce_unlock_vip_customers WHERE customer_id=cid),false) THEN RAISE EXCEPTION 'Cobertura VIP indisponível'; END IF;
 t:=ce_unlock_private.annual(cid,'termo'); p:=ce_unlock_private.annual(cid,'procuracao'); IF t IS NULL OR p IS NULL THEN RAISE EXCEPTION 'Cobertura anual incompleta'; END IF;
 UPDATE public.ce_unlock_request_bls SET termo_document_id=t,procuracao_document_id=p WHERE request_id=r.id AND confirmed_at IS NULL;
 UPDATE public.ce_unlock_requests SET version=version+1,updated_at=now() WHERE id=r.id; result:=ce_unlock_private.request_json(r.id);
 WHEN 'delivery' THEN
 bid:=p_payload->>'bl_id'; SELECT customer_id INTO cid FROM public.bls WHERE id=bid FOR UPDATE;
 IF cid IS NULL THEN RAISE EXCEPTION 'B/L não encontrado'; END IF;
 INSERT INTO public.ce_unlock_bl_deliveries(bl_id) VALUES(bid) ON CONFLICT DO NOTHING;
 SELECT * INTO delivery FROM public.ce_unlock_bl_deliveries WHERE bl_id=bid FOR UPDATE;
 IF delivery.version IS DISTINCT FROM (p_payload->>'expected_version')::bigint THEN RAISE EXCEPTION 'Entrega alterada; atualize a página' USING ERRCODE='40001'; END IF;
 IF NOT (p_payload->>'delivered')::boolean AND trim(coalesce(p_payload->>'reason',''))='' THEN RAISE EXCEPTION 'Motivo obrigatório'; END IF;
 UPDATE public.ce_unlock_bl_deliveries SET delivered=(p_payload->>'delivered')::boolean,version=version+1,updated_by=auth.uid(),updated_at=now() WHERE bl_id=bid;
 result:=ce_unlock_private.item(bid);
 WHEN 'cancel' THEN
 IF trim(coalesce(p_payload->>'reason',''))='' OR r.state IN('cancelled','completed') THEN RAISE EXCEPTION 'Cancelamento exige pedido ativo e motivo'; END IF;
 IF EXISTS(SELECT 1 FROM public.ce_unlock_exports WHERE sent_at IS NOT NULL AND snapshot @> jsonb_build_array(jsonb_build_object('request_id',r.id))) THEN RAISE EXCEPTION 'Pedido enviado à ZPT: confirme o tratamento externo antes de cancelar'; END IF;
 UPDATE public.ce_unlock_requests SET state='cancelled',version=version+1,updated_at=now() WHERE id=r.id;
 UPDATE public.ce_unlock_request_bls SET active=false WHERE request_id=r.id;
 result:=ce_unlock_private.request_json(r.id);
 WHEN 'reconfirm_ce' THEN
 bid:=p_payload->>'bl_id'; IF trim(coalesce(p_payload->>'reason',''))='' THEN RAISE EXCEPTION 'Motivo obrigatório'; END IF;
 UPDATE public.ce_unlock_request_bls SET ce_at_request=(SELECT ce_mercante FROM public.bls WHERE id=bid),termo_approved=false,procuracao_approved=false
 WHERE request_id=r.id AND bl_id=bid AND confirmed_at IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'B/L não pertence ao pedido'; END IF;
 UPDATE public.ce_unlock_requests SET version=version+1,updated_at=now() WHERE id=r.id; result:=ce_unlock_private.request_json(r.id);
 WHEN 'export' THEN
 SELECT array_agg(DISTINCT value ORDER BY value) INTO ids FROM jsonb_array_elements_text(p_payload->'bl_ids');
 IF coalesce(cardinality(ids),0) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Seleção inválida'; END IF;
 -- Mesma ordem de locks: pedidos, B/Ls e recebíveis. Leitura revalidada no momento do lote.
 PERFORM 1 FROM public.ce_unlock_requests WHERE id IN(SELECT request_id FROM public.ce_unlock_request_bls WHERE bl_id=ANY(ids) AND active) ORDER BY id FOR UPDATE;
 PERFORM 1 FROM public.bls WHERE id=ANY(ids) ORDER BY id FOR UPDATE;
 PERFORM 1 FROM public.bl_receivables WHERE bl_id=ANY(ids) ORDER BY id FOR UPDATE;
 PERFORM 1 FROM public.ce_unlock_vip_customers WHERE customer_id IN(SELECT customer_id FROM public.bls WHERE id=ANY(ids)) ORDER BY customer_id FOR UPDATE;
 PERFORM 1 FROM public.ce_unlock_documents WHERE id IN(SELECT termo_document_id FROM public.ce_unlock_request_bls WHERE bl_id=ANY(ids) AND active UNION SELECT procuracao_document_id FROM public.ce_unlock_request_bls WHERE bl_id=ANY(ids) AND active) ORDER BY id FOR UPDATE;
 v:='[]'; FOREACH bid IN ARRAY ids LOOP item:=ce_unlock_private.item(bid); IF NOT coalesce((item->>'can_export')::boolean,false) THEN RAISE EXCEPTION 'B/L % não apto: %',bid,item->'reasons'; END IF; v:=v||jsonb_build_array(item || jsonb_build_object('documents',(SELECT jsonb_build_object('termo_id',i.termo_document_id,'procuracao_id',i.procuracao_document_id,'termo',ce_unlock_private.doc_json(i.termo_document_id),'procuracao',ce_unlock_private.doc_json(i.procuracao_document_id)) FROM public.ce_unlock_request_bls i WHERE i.bl_id=bid AND i.active)));  END LOOP;
 INSERT INTO public.ce_unlock_exports(rows,snapshot,created_by,reexport_of)
 VALUES((SELECT jsonb_agg(jsonb_build_object('bl_id',x->>'bl_id','termo',x->'termo','procuracao',x->'procuracao','delivered',x->'delivered','paid',x->'paid')) FROM jsonb_array_elements(v) x),
 v,auth.uid(),(p_payload->>'reexport_of')::uuid) RETURNING * INTO ex;
 result:=to_jsonb(ex);
 WHEN 'sent' THEN
 SELECT * INTO ex FROM public.ce_unlock_exports WHERE id=(p_payload->>'export_id')::uuid FOR UPDATE;
 IF ex.id IS NULL OR trim(coalesce(p_payload->>'reference',''))='' THEN RAISE EXCEPTION 'Lote e referência de envio obrigatórios'; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(ex.snapshot) LOOP
 v:=ce_unlock_private.item(item->>'bl_id'); IF NOT coalesce((v->>'can_export')::boolean,false) OR v->>'ce_mercante' IS DISTINCT FROM item->>'ce_mercante' OR v->>'request_id' IS DISTINCT FROM item->>'request_id' THEN RAISE EXCEPTION 'Lote desatualizado; gere nova exportação'; END IF;
 END LOOP;
 UPDATE public.ce_unlock_exports SET sent_at=now(),reference=p_payload->>'reference' WHERE id=ex.id RETURNING to_jsonb(ce_unlock_exports.*) INTO result;
 WHEN 'confirm' THEN
 bid:=p_payload->>'bl_id'; item:=ce_unlock_private.item(bid,r.id);
 IF NOT coalesce((item->>'can_export')::boolean,false) OR item->>'ce_mercante' IS DISTINCT FROM p_payload->>'ce_mercante' OR trim(coalesce(p_payload->>'reference',''))='' THEN RAISE EXCEPTION 'Confirmação exige B/L apto, CE atual e evidência externa'; END IF;
 UPDATE public.ce_unlock_request_bls SET confirmed_at=now(),confirmed_by=auth.uid(),confirmed_ce=p_payload->>'ce_mercante',external_reference=p_payload->>'reference',active=false WHERE request_id=r.id AND bl_id=bid;
 UPDATE public.ce_unlock_requests SET version=version+1,updated_at=now(),state=CASE WHEN NOT EXISTS(SELECT 1 FROM public.ce_unlock_request_bls WHERE request_id=r.id AND confirmed_at IS NULL) THEN 'completed' ELSE state END WHERE id=r.id;
 result:=ce_unlock_private.request_json(r.id);
 ELSE RAISE EXCEPTION 'Ação inválida'; END CASE;
 INSERT INTO public.ce_unlock_events(customer_id,request_id,bl_id,action,reason,actor_id,payload) VALUES(cid,r.id,bid,p_action,p_payload->>'reason',auth.uid(),p_payload);
 INSERT INTO ce_unlock_private.receipts(actor_id,action,request_key,payload,result) VALUES(auth.uid(),p_action,key,p_payload,result);
 RETURN result;
END $$;
CREATE OR REPLACE FUNCTION ce_unlock_private.request_json(p_id uuid,p_customer bigint DEFAULT NULL,p_docs boolean DEFAULT true) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r public.ce_unlock_requests; BEGIN
 SELECT * INTO r FROM public.ce_unlock_requests WHERE id=p_id AND (p_customer IS NULL OR customer_id=p_customer);
 IF r.id IS NULL THEN RAISE EXCEPTION '42501: Solicitação não encontrada ou não autorizada.' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('id',r.id,'protocol',r.protocol,'state',r.state,'version',r.version,'source',r.source,
 'items',coalesce((SELECT jsonb_agg(ce_unlock_private.item(bl_id,p_id) ORDER BY bl_id) FROM public.ce_unlock_request_bls WHERE request_id=p_id),'[]'),
 'documents',CASE WHEN p_docs THEN coalesce((SELECT jsonb_agg(ce_unlock_private.doc_json(d.id) ORDER BY d.created_at DESC) FROM public.ce_unlock_documents d
 WHERE d.request_id=p_id OR d.id IN(SELECT termo_document_id FROM public.ce_unlock_request_bls WHERE request_id=p_id UNION SELECT procuracao_document_id FROM public.ce_unlock_request_bls WHERE request_id=p_id)),'[]'::jsonb) ELSE '[]'::jsonb END,
 'events',coalesce((SELECT jsonb_agg(jsonb_build_object('id',e.id,'action',e.action,'reason',e.reason,'created_at',e.created_at) ORDER BY e.id) FROM public.ce_unlock_events e WHERE (request_id=p_id OR (e.request_id IS NULL AND e.bl_id IN (SELECT bl_id FROM public.ce_unlock_request_bls WHERE request_id=p_id)))),'[]'));
END $$;

CREATE OR REPLACE FUNCTION public.ce_unlock_cleanup_candidates() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',d.id,'storage_path',d.storage_path)),'[]') FROM public.ce_unlock_documents d LEFT JOIN public.ce_unlock_requests r ON r.id=d.request_id
 WHERE d.purged_at IS NULL AND ((d.status='uploading' AND d.created_at<now()-interval '1 day') OR (r.state='draft' AND r.created_at<now()-interval '7 days')
 OR (d.created_at<now()-interval '5 years' AND coalesce(r.state,'completed') IN('cancelled','completed') AND NOT EXISTS(SELECT 1 FROM public.ce_unlock_request_bls i JOIN public.ce_unlock_requests q ON q.id=i.request_id WHERE (i.termo_document_id=d.id OR i.procuracao_document_id=d.id) AND q.state NOT IN('cancelled','completed'))))
$$;
CREATE OR REPLACE FUNCTION public.ce_unlock_cleanup_record(p_document_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 PERFORM 1 FROM public.ce_unlock_documents WHERE id=p_document_id FOR UPDATE;
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(public.ce_unlock_cleanup_candidates()) x WHERE x->>'id'=p_document_id::text) THEN RAISE EXCEPTION 'Documento não elegível para expurgo'; END IF;
 UPDATE public.ce_unlock_documents SET purged_at=now(),status='revoked',version=version+1 WHERE id=p_document_id;
END $$;
CREATE FUNCTION public.ce_unlock_expire_drafts() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE n integer; BEGIN
 UPDATE public.ce_unlock_requests r SET state='cancelled',version=version+1,updated_at=now() WHERE r.state='draft' AND r.created_at<now()-interval '7 days'
 AND NOT EXISTS(SELECT 1 FROM public.ce_unlock_documents d WHERE d.request_id=r.id AND d.purged_at IS NULL);
 GET DIAGNOSTICS n=ROW_COUNT;
 UPDATE public.ce_unlock_request_bls SET active=false WHERE active AND request_id IN(SELECT id FROM public.ce_unlock_requests WHERE state='cancelled');
 RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.ce_unlock_expire_drafts() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ce_unlock_expire_drafts() TO service_role;
-- O papel das migrations no Supabase não altera cron.job diretamente; alter_job desativa o job que ele mesmo criou.
SELECT cron.alter_job(cron.schedule('ce-unlock-cleanup','0 6 * * *',$job$SELECT ops.dispatch_edge_job('ce-unlock-cleanup','CE_UNLOCK_CLEANUP_SECRET','Authorization','Bearer ');$job$), active := false);
COMMIT;
