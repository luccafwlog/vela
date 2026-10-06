-- PR 847: honor corrected local balances, keep external evidence private,
-- and prevent unfinished upload reservations from replacing registered PDFs.
-- Forward-only function changes; preserves documents, events and prior migrations.
BEGIN;
CREATE OR REPLACE FUNCTION ce_unlock_private.item(p_bl text,p_request uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE b public.bls; i public.ce_unlock_request_bls; r public.ce_unlock_requests; paid boolean; td boolean; pd boolean; delivered boolean;
 vip boolean; reasons text[] := '{}'; eligible boolean; confirmed boolean; vs text; cid bigint;
BEGIN
 SELECT * INTO b FROM public.bls WHERE id=p_bl;
 SELECT * INTO i FROM public.ce_unlock_request_bls WHERE bl_id=p_bl AND (p_request IS NULL OR request_id=p_request)
 ORDER BY active DESC,confirmed_at DESC NULLS LAST,request_id LIMIT 1;
 SELECT * INTO r FROM public.ce_unlock_requests WHERE id=i.request_id;
 SELECT coalesce(enabled,false) INTO vip FROM public.ce_unlock_vip_customers WHERE customer_id=b.customer_id; vip:=coalesce(vip,false);
 SELECT coalesce(bool_and(status='settled' AND balance_brl=0 AND original_amount_brl>0 AND settled_amount_brl>=original_amount_brl-correction_amount_brl
 AND EXISTS(SELECT 1 FROM public.ledger_settlements s WHERE s.receivable_id=x.id)),false)
 INTO paid FROM public.bl_receivables x WHERE bl_id=p_bl AND status<>'void';
 IF EXISTS(SELECT 1 FROM public.cod_adjustments a LEFT JOIN public.invoices n ON n.id=a.resulting_document_id
 WHERE a.bl_id=p_bl AND a.status<>'cancelled' AND a.difference_brl>0
 AND (a.status='pending' OR a.manual_review_required OR (a.resulting_document_type='invoice' AND coalesce(n.balance_brl,1)>0))) THEN paid:=false; END IF;
 SELECT coalesce(d.delivered,false) INTO delivered FROM public.ce_unlock_bl_deliveries d WHERE bl_id=p_bl; delivered:=coalesce(delivered,false);
 IF r.source='vip_annual' THEN
 td:=vip AND ce_unlock_private.valid_doc(i.termo_document_id); pd:=vip AND ce_unlock_private.valid_doc(i.procuracao_document_id);
 ELSE td:=coalesce(i.termo_approved,false); pd:=coalesce(i.procuracao_approved,false); END IF;
 confirmed:=i.confirmed_at IS NOT NULL AND i.confirmed_ce IS NOT DISTINCT FROM b.ce_mercante AND r.customer_id=b.customer_id;
 eligible:=b.cancelled_at IS NULL AND trim(coalesce(b.ce_mercante,''))<>'' AND paid;
 IF r.id IS NOT NULL AND r.customer_id IS DISTINCT FROM b.customer_id THEN reasons:=array_append(reasons,'Cliente do B/L alterado: solicitação anterior inaplicável'); END IF;
 IF b.cancelled_at IS NOT NULL THEN reasons:=array_append(reasons,'B/L cancelado'); END IF;
 IF trim(coalesce(b.ce_mercante,''))='' THEN reasons:=array_append(reasons,'CE Mercante não informado'); END IF;
 IF NOT paid THEN reasons:=array_append(reasons,'Taxas locais sem liquidação integral confirmada'); END IF;
 IF r.id IS NOT NULL AND NOT td THEN reasons:=array_append(reasons,'Termo pendente, vencido ou revogado'); END IF;
 IF r.id IS NOT NULL AND NOT pd THEN reasons:=array_append(reasons,'Procuração pendente, vencida ou revogada'); END IF;
 IF r.id IS NOT NULL AND NOT delivered THEN reasons:=array_append(reasons,'B/L físico aguardando entrega'); END IF;
 IF r.id IS NOT NULL AND i.ce_at_request IS DISTINCT FROM b.ce_mercante THEN reasons:=array_append(reasons,'CE alterado: reconferência necessária'); END IF;
 SELECT ve.name INTO vs FROM public.voyages v JOIN public.vessels ve ON ve.id=v.vessel_id WHERE v.id=b.voyage_id;
 RETURN jsonb_build_object('bl_id',p_bl,'ce_mercante',b.ce_mercante,'customer_id',b.customer_id,
 'customer_name',(SELECT name FROM public.customers WHERE id=b.customer_id),'cnpj_cpf',(SELECT cnpj_cpf FROM public.customers WHERE id=b.customer_id),
 'voyage_id',b.voyage_id,'voyage_number',(SELECT voyage_number FROM public.voyages WHERE id=b.voyage_id),'vessel_name',vs,'pod',b.pod,
 'request_id',r.id,'requested_at',r.created_at,'protocol',r.protocol,'state',coalesce(r.state,'no_request'),'version',r.version,'source',coalesce(r.source,'request'),
 'vip',vip,'termo',td,'procuracao',pd,'paid',paid,'delivered',delivered,'confirmed',confirmed,
 'delivery_version',coalesce((SELECT version FROM public.ce_unlock_bl_deliveries WHERE bl_id=p_bl),0),
 'can_submit',eligible AND NOT coalesce(i.active,false) AND NOT confirmed,
 'can_export',eligible AND r.customer_id=b.customer_id AND td AND pd AND delivered AND r.state IN('submitted','in_review','changes_requested') AND i.active AND i.ce_at_request=b.ce_mercante AND NOT confirmed,
 'export_state',CASE WHEN confirmed THEN 'confirmed' WHEN EXISTS(SELECT 1 FROM public.ce_unlock_exports e WHERE e.sent_at IS NOT NULL AND e.snapshot @> jsonb_build_array(jsonb_build_object('bl_id',p_bl,'request_id',r.id))) THEN 'sent' WHEN EXISTS(SELECT 1 FROM public.ce_unlock_exports e WHERE e.snapshot @> jsonb_build_array(jsonb_build_object('bl_id',p_bl,'request_id',r.id))) THEN 'exported' ELSE 'not_exported' END,
 'reasons',to_jsonb(reasons));
END $$;

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
 IF saved.actor_id IS NOT NULL THEN
   IF saved.payload<>p_payload THEN RAISE EXCEPTION 'Chave já utilizada para outra operação'; END IF;
   -- Preserve o snapshot idempotente, mas não divulgue referências de recibos legados ao Portal.
   IF p_portal AND jsonb_typeof(saved.result->'events')='array' THEN
     RETURN jsonb_set(saved.result,'{events}',coalesce((
       SELECT jsonb_agg(CASE WHEN event->>'action'='confirm' THEN event||jsonb_build_object('reason',NULL) ELSE event END ORDER BY position)
       FROM jsonb_array_elements(saved.result->'events') WITH ORDINALITY AS events(event,position)
     ),'[]'::jsonb));
   END IF;
   RETURN saved.result;
 END IF;
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
 -- Finalize only pending items; confirmed references remain immutable history.
 PERFORM 1 FROM public.bls WHERE id IN(SELECT bl_id FROM public.ce_unlock_request_bls WHERE request_id=r.id AND confirmed_at IS NULL) ORDER BY id FOR UPDATE;
 PERFORM 1 FROM public.bl_receivables WHERE bl_id IN(SELECT bl_id FROM public.ce_unlock_request_bls WHERE request_id=r.id AND confirmed_at IS NULL) ORDER BY id FOR UPDATE;
 PERFORM 1 FROM public.ce_unlock_vip_customers WHERE customer_id=cid FOR UPDATE;
 PERFORM 1 FROM public.ce_unlock_documents WHERE request_id=r.id OR (customer_id=cid AND source='vip_annual') ORDER BY id FOR UPDATE;
 IF r.source='vip_annual' THEN
 IF NOT coalesce((SELECT enabled FROM public.ce_unlock_vip_customers WHERE customer_id=cid),false) THEN RAISE EXCEPTION 'Condição VIP revogada'; END IF;
 t:=ce_unlock_private.annual(cid,'termo'); p:=ce_unlock_private.annual(cid,'procuracao');
 IF t IS NULL OR p IS NULL THEN RAISE EXCEPTION 'Regularize os documentos anuais VIP'; END IF;
 ELSE
 SELECT id INTO t FROM public.ce_unlock_documents WHERE request_id=r.id AND type='termo' AND status<>'uploading' AND hash IS NOT NULL ORDER BY created_at DESC LIMIT 1;
 SELECT id INTO p FROM public.ce_unlock_documents WHERE request_id=r.id AND type='procuracao' AND status<>'uploading' AND hash IS NOT NULL ORDER BY created_at DESC LIMIT 1;
 IF t IS NULL OR p IS NULL OR NOT EXISTS(SELECT 1 FROM public.ce_unlock_documents WHERE id=t AND status IN('uploaded','approved') AND purged_at IS NULL AND cleanup_claimed_at IS NULL) OR NOT EXISTS(SELECT 1 FROM public.ce_unlock_documents WHERE id=p AND status IN('uploaded','approved') AND purged_at IS NULL AND cleanup_claimed_at IS NULL) THEN RAISE EXCEPTION 'Anexe versões atuais de termo e procuração'; END IF;
 END IF;
 PERFORM 1 FROM public.bls WHERE id IN(SELECT bl_id FROM public.ce_unlock_request_bls WHERE request_id=r.id AND confirmed_at IS NULL) ORDER BY id FOR UPDATE;
 PERFORM 1 FROM public.bl_receivables WHERE bl_id IN(SELECT bl_id FROM public.ce_unlock_request_bls WHERE request_id=r.id AND confirmed_at IS NULL) ORDER BY id FOR UPDATE;
 FOR bid IN SELECT bl_id FROM public.ce_unlock_request_bls WHERE request_id=r.id AND confirmed_at IS NULL LOOP
 item:=ce_unlock_private.item(bid,r.id);
 IF NOT (item->>'paid')::boolean OR NOT EXISTS(SELECT 1 FROM public.bls b WHERE b.id=bid AND b.customer_id=cid AND b.cancelled_at IS NULL AND b.ce_mercante=(SELECT ce_at_request FROM public.ce_unlock_request_bls WHERE request_id=r.id AND bl_id=bid)) THEN RAISE EXCEPTION 'B/L % perdeu elegibilidade',bid; END IF;
 END LOOP;
 UPDATE public.ce_unlock_request_bls SET termo_approved=CASE WHEN termo_document_id=t THEN termo_approved ELSE false END,
 procuracao_approved=CASE WHEN procuracao_document_id=p THEN procuracao_approved ELSE false END,
 termo_document_id=t,procuracao_document_id=p WHERE request_id=r.id AND confirmed_at IS NULL;
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
 IF d.id IS NULL OR d.status='uploading' OR d.purged_at IS NOT NULL OR d.cleanup_claimed_at IS NOT NULL THEN RAISE EXCEPTION 'Documento indisponível'; END IF;
 IF d.version IS DISTINCT FROM (p_payload->>'expected_document_version')::bigint THEN RAISE EXCEPTION 'Documento alterado; atualize a página' USING ERRCODE='40001'; END IF;
 IF p_payload->>'decision' NOT IN('approved','changes_requested','revoked') THEN RAISE EXCEPTION 'Decisão inválida'; END IF;
 IF p_payload->>'decision'<>'approved' AND trim(coalesce(p_payload->>'reason',''))='' THEN RAISE EXCEPTION 'Motivo obrigatório'; END IF;
 cid:=d.customer_id;
 IF d.source='request' THEN
 IF r.id IS DISTINCT FROM d.request_id OR r.source<>'request' OR r.state NOT IN('submitted','in_review','changes_requested') THEN RAISE EXCEPTION 'Documento não pertence à análise atual'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.ce_unlock_documents z WHERE z.id=d.id AND z.created_at=(SELECT max(created_at) FROM public.ce_unlock_documents WHERE request_id=r.id AND type=d.type AND status<>'uploading' AND hash IS NOT NULL)) THEN RAISE EXCEPTION 'Documento substituído'; END IF;
 SELECT array_agg(value) INTO ids FROM jsonb_array_elements_text(p_payload->'bl_ids');
 IF coalesce(cardinality(ids),0)=0 OR EXISTS(SELECT 1 FROM unnest(ids) x WHERE NOT EXISTS(SELECT 1 FROM public.ce_unlock_request_bls WHERE request_id=r.id AND bl_id=x AND confirmed_at IS NULL)) THEN RAISE EXCEPTION 'Seleção inválida'; END IF;
 IF EXISTS(SELECT 1 FROM public.ce_unlock_request_bls i WHERE i.request_id=r.id AND i.bl_id=ANY(ids) AND (CASE WHEN d.type='termo' THEN i.termo_document_id ELSE i.procuracao_document_id END) IS DISTINCT FROM d.id) THEN RAISE EXCEPTION 'Documento ainda não reenviado pelo cliente'; END IF;
 UPDATE public.ce_unlock_request_bls SET termo_approved=CASE WHEN d.type='termo' THEN p_payload->>'decision'='approved' ELSE termo_approved END,
 procuracao_approved=CASE WHEN d.type='procuracao' THEN p_payload->>'decision'='approved' ELSE procuracao_approved END
 WHERE request_id=r.id AND bl_id=ANY(ids);
 UPDATE public.ce_unlock_requests SET state=CASE WHEN p_payload->>'decision'<>'approved' OR EXISTS(SELECT 1 FROM public.ce_unlock_documents z WHERE z.request_id=r.id AND z.id<>d.id AND z.status='changes_requested' AND NOT EXISTS(SELECT 1 FROM public.ce_unlock_documents newer WHERE newer.request_id=r.id AND newer.type=z.type AND newer.status<>'uploading' AND newer.hash IS NOT NULL AND newer.created_at>z.created_at)) THEN 'changes_requested' ELSE 'in_review' END,version=version+1,updated_at=now() WHERE id=r.id;
 ELSE
 IF d.source='vip_annual' AND p_payload->>'decision'='approved' THEN
 IF d.coverage_year IS NOT NULL AND (d.coverage_year IS DISTINCT FROM (p_payload->>'coverage_year')::int OR d.valid_from IS DISTINCT FROM (p_payload->>'valid_from')::date OR d.valid_until IS DISTINCT FROM (p_payload->>'valid_until')::date) THEN RAISE EXCEPTION 'Vigência registrada é imutável; apresente novo documento para renovar'; END IF;
 IF (p_payload->>'valid_until')::date IS DISTINCT FROM make_date((p_payload->>'coverage_year')::int,12,31) OR (p_payload->>'valid_from')::date IS NULL THEN RAISE EXCEPTION 'Validade anual deve terminar em 31/12 do ano informado'; END IF;
 END IF;
 END IF;
 UPDATE public.ce_unlock_documents SET version=version+1,status=p_payload->>'decision',reason=p_payload->>'reason',reviewed_by=auth.uid(),reviewed_at=now(),
 valid_from=CASE WHEN source='vip_annual' AND p_payload->>'decision'='approved' THEN (p_payload->>'valid_from')::date ELSE valid_from END,
 valid_until=CASE WHEN source='vip_annual' AND p_payload->>'decision'='approved' THEN (p_payload->>'valid_until')::date ELSE valid_until END,
 coverage_year=CASE WHEN source='vip_annual' AND p_payload->>'decision'='approved' THEN (p_payload->>'coverage_year')::int ELSE coverage_year END WHERE id=d.id;
 result:=CASE WHEN r.id IS NOT NULL THEN ce_unlock_private.request_json(r.id) ELSE ce_unlock_private.vip_json(cid) END;
 WHEN 'apply_vip' THEN
 PERFORM 1 FROM public.ce_unlock_vip_customers WHERE customer_id=cid FOR UPDATE;
 PERFORM 1 FROM public.ce_unlock_documents WHERE customer_id=cid AND source='vip_annual' ORDER BY id FOR UPDATE;
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
 PERFORM 1 FROM public.ce_unlock_bl_deliveries WHERE bl_id=ANY(ids) ORDER BY bl_id FOR UPDATE;
 v:='[]'; FOREACH bid IN ARRAY ids LOOP item:=ce_unlock_private.item(bid); IF NOT coalesce((item->>'can_export')::boolean,false) THEN RAISE EXCEPTION 'B/L % não apto: %',bid,item->'reasons'; END IF; v:=v||jsonb_build_array(item || jsonb_build_object('documents',(SELECT jsonb_build_object('termo_id',i.termo_document_id,'procuracao_id',i.procuracao_document_id,'termo',ce_unlock_private.doc_json(i.termo_document_id),'procuracao',ce_unlock_private.doc_json(i.procuracao_document_id)) FROM public.ce_unlock_request_bls i WHERE i.bl_id=bid AND i.active)));  END LOOP;
 INSERT INTO public.ce_unlock_exports(rows,snapshot,created_by,reexport_of)
 VALUES((SELECT jsonb_agg(jsonb_build_object('bl_id',x->>'bl_id','termo',x->'termo','procuracao',x->'procuracao','delivered',x->'delivered','paid',x->'paid')) FROM jsonb_array_elements(v) x),
 v,auth.uid(),(p_payload->>'reexport_of')::uuid) RETURNING * INTO ex;
 result:=to_jsonb(ex);
 WHEN 'sent' THEN
 SELECT array_agg(value->>'bl_id') INTO ids FROM public.ce_unlock_exports e CROSS JOIN LATERAL jsonb_array_elements(e.snapshot) WHERE e.id=(p_payload->>'export_id')::uuid;
 PERFORM 1 FROM public.ce_unlock_requests WHERE id IN(SELECT request_id FROM public.ce_unlock_request_bls WHERE bl_id=ANY(ids) AND active) ORDER BY id FOR UPDATE;
 PERFORM 1 FROM public.bls WHERE id=ANY(ids) ORDER BY id FOR UPDATE;
 PERFORM 1 FROM public.bl_receivables WHERE bl_id=ANY(ids) ORDER BY id FOR UPDATE;
 PERFORM 1 FROM public.ce_unlock_vip_customers WHERE customer_id IN(SELECT customer_id FROM public.bls WHERE id=ANY(ids)) ORDER BY customer_id FOR UPDATE;
 PERFORM 1 FROM public.ce_unlock_documents WHERE id IN(SELECT termo_document_id FROM public.ce_unlock_request_bls WHERE bl_id=ANY(ids) AND active UNION SELECT procuracao_document_id FROM public.ce_unlock_request_bls WHERE bl_id=ANY(ids) AND active) ORDER BY id FOR UPDATE;
 PERFORM 1 FROM public.ce_unlock_bl_deliveries WHERE bl_id=ANY(ids) ORDER BY bl_id FOR UPDATE;
 SELECT * INTO ex FROM public.ce_unlock_exports WHERE id=(p_payload->>'export_id')::uuid FOR UPDATE;
 IF ex.id IS NULL OR trim(coalesce(p_payload->>'reference',''))='' THEN RAISE EXCEPTION 'Lote e referência de envio obrigatórios'; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(ex.snapshot) LOOP
 v:=ce_unlock_private.item(item->>'bl_id'); IF NOT coalesce((v->>'can_export')::boolean,false) OR v->>'ce_mercante' IS DISTINCT FROM item->>'ce_mercante' OR v->>'request_id' IS DISTINCT FROM item->>'request_id' THEN RAISE EXCEPTION 'Lote desatualizado; gere nova exportação'; END IF;
 END LOOP;
 UPDATE public.ce_unlock_exports SET sent_at=now(),reference=p_payload->>'reference' WHERE id=ex.id RETURNING to_jsonb(ce_unlock_exports.*) INTO result;
 WHEN 'confirm' THEN
 bid:=p_payload->>'bl_id'; ids:=ARRAY[bid];
 PERFORM 1 FROM public.bls WHERE id=ANY(ids) ORDER BY id FOR UPDATE;
 PERFORM 1 FROM public.bl_receivables WHERE bl_id=ANY(ids) ORDER BY id FOR UPDATE;
 PERFORM 1 FROM public.ce_unlock_vip_customers WHERE customer_id IN(SELECT customer_id FROM public.bls WHERE id=ANY(ids)) ORDER BY customer_id FOR UPDATE;
 PERFORM 1 FROM public.ce_unlock_documents WHERE id IN(SELECT termo_document_id FROM public.ce_unlock_request_bls WHERE bl_id=ANY(ids) AND active UNION SELECT procuracao_document_id FROM public.ce_unlock_request_bls WHERE bl_id=ANY(ids) AND active) ORDER BY id FOR UPDATE;
 PERFORM 1 FROM public.ce_unlock_bl_deliveries WHERE bl_id=ANY(ids) ORDER BY bl_id FOR UPDATE;
 item:=ce_unlock_private.item(bid,r.id);
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
 'items',coalesce((SELECT jsonb_agg(ce_unlock_private.item(bl_id,p_id) ORDER BY bl_id) FROM public.ce_unlock_request_bls i WHERE i.request_id=p_id AND (p_customer IS NULL OR EXISTS(SELECT 1 FROM public.bls b WHERE b.id=i.bl_id AND b.customer_id=p_customer AND public.bl_has_portal_release(b.id)))),'[]'),
 'documents',CASE WHEN p_docs THEN coalesce((SELECT jsonb_agg(ce_unlock_private.doc_json(d.id) ORDER BY d.created_at DESC) FROM public.ce_unlock_documents d
 WHERE d.hash IS NOT NULL AND (d.request_id=p_id OR d.id IN(SELECT termo_document_id FROM public.ce_unlock_request_bls WHERE request_id=p_id UNION SELECT procuracao_document_id FROM public.ce_unlock_request_bls WHERE request_id=p_id))),'[]'::jsonb) ELSE '[]'::jsonb END,
 'confirmation_records',CASE WHEN p_customer IS NULL AND p_docs THEN coalesce((SELECT jsonb_agg(jsonb_build_object('bl_id',i.bl_id,'ce_mercante',i.confirmed_ce,'reference',i.external_reference,'confirmed_at',i.confirmed_at) ORDER BY i.bl_id) FROM public.ce_unlock_request_bls i WHERE i.request_id=p_id AND i.confirmed_at IS NOT NULL),'[]'::jsonb) ELSE '[]'::jsonb END,
 'events',coalesce((SELECT jsonb_agg(jsonb_build_object('id',e.id,'action',e.action,'reason',CASE WHEN e.action='confirm' AND NOT (p_customer IS NULL AND p_docs) THEN NULL ELSE e.reason END,'created_at',e.created_at) ORDER BY e.id) FROM public.ce_unlock_events e WHERE (request_id=p_id OR (e.request_id IS NULL AND e.bl_id IN (SELECT bl_id FROM public.ce_unlock_request_bls WHERE request_id=p_id)))),'[]'));
END $$;


CREATE OR REPLACE FUNCTION public.ce_unlock_prepare_upload(p_context jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE cid bigint; rid uuid; role_name text; dtype text; src text; d public.ce_unlock_documents; r public.ce_unlock_requests; total_bytes bigint;
BEGIN
 SELECT CASE role WHEN 'operator' THEN 'documentacao' ELSE role END INTO role_name FROM public.user_profiles WHERE id=auth.uid() AND active;
 IF role_name IS NOT NULL THEN PERFORM ce_unlock_private.actor(true); ELSE cid:=public.current_portal_customer_id(); END IF;
 src:=p_context->>'source'; dtype:=p_context->>'type'; rid:=(p_context->>'request_id')::uuid;
 IF src='model' THEN PERFORM ce_unlock_private.actor(true); dtype:='model'; cid:=NULL;
 ELSIF src='request' THEN
 SELECT * INTO r FROM public.ce_unlock_requests WHERE id=rid FOR UPDATE;
 IF r.id IS NULL OR r.source<>'request' OR r.state NOT IN('draft','changes_requested') OR (role_name IS NULL AND r.customer_id IS DISTINCT FROM cid) THEN RAISE EXCEPTION '42501: Pedido não aceita anexos.' USING ERRCODE='42501'; END IF;
 cid:=r.customer_id;
 ELSIF src='vip_annual' THEN
 IF role_name IS NOT NULL THEN cid:=(p_context->>'customer_id')::bigint; END IF;
 IF NOT coalesce((SELECT enabled FROM public.ce_unlock_vip_customers WHERE customer_id=cid),false) THEN RAISE EXCEPTION '42501: Cliente sem condição VIP.' USING ERRCODE='42501'; END IF;
 ELSE RAISE EXCEPTION 'Contexto de upload inválido'; END IF;
 IF dtype NOT IN('termo','procuracao','model') OR trim(coalesce(p_context->>'file_name',''))='' OR coalesce((p_context->>'size_bytes')::bigint,0) NOT BETWEEN 1 AND 10485760 THEN RAISE EXCEPTION 'PDF obrigatório, até 10 MiB'; END IF;
 IF cid IS NOT NULL THEN PERFORM 1 FROM public.customers WHERE id=cid FOR UPDATE; ELSE PERFORM pg_advisory_xact_lock(hashtextextended(auth.uid()::text||'ce-model-upload',0)); END IF;
 IF (SELECT count(*) FROM ce_unlock_private.upload_attempts WHERE (cid IS NOT NULL AND customer_id=cid OR cid IS NULL AND actor_id=auth.uid()) AND created_at>now()-interval '24 hours')>=20 THEN RAISE EXCEPTION 'Limite de 20 uploads por 24 horas'; END IF;
 SELECT coalesce(sum(z.size_bytes),0) INTO total_bytes FROM public.ce_unlock_documents z LEFT JOIN public.ce_unlock_requests q ON q.id=z.request_id
 WHERE z.purged_at IS NULL AND z.cleanup_claimed_at IS NULL AND z.customer_id=cid AND (z.source='vip_annual' AND (z.created_at>now()-interval '7 days' OR z.status='approved') OR q.state IN('draft','submitted','in_review','changes_requested'));
 IF total_bytes+(p_context->>'size_bytes')::bigint>104857600 THEN RAISE EXCEPTION 'Quota de documentos ativos de 100 MiB excedida'; END IF;
 INSERT INTO ce_unlock_private.upload_attempts(customer_id,actor_id) VALUES(cid,auth.uid());
 INSERT INTO public.ce_unlock_documents(customer_id,request_id,type,source,storage_path,file_name,size_bytes,uploaded_by)
 VALUES(cid,rid,dtype,src,coalesce(cid::text,'models')||'/'||gen_random_uuid()::text||'.pdf',left(p_context->>'file_name',240),(p_context->>'size_bytes')::bigint,auth.uid()) RETURNING * INTO d;
 RETURN jsonb_build_object('id',d.id,'storage_path',d.storage_path);
END $$;

COMMIT;
