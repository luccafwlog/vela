-- Desbloqueio de CE: correções da revisão do PR 884 (2026-10-07) sobre a migration 160.
-- Spec: docs/archive/specs/2026-10-07-desbloqueio-ce-revisao-fluxo-design.md.
--  * Portal: cancelar devolve a projeção do cliente; histórico sem exportação/entrega/VIP;
--  * prazo de sábado/domingo vence segunda às 12:00;
--  * solicitação com documentação validada não pode mais ser cancelada;
--  * "documentação validada" avisa o cliente uma vez só;
--  * conclusão reavaliada por varredura (liquidação posterior também conclui/reabre);
--  * conciliação: "Bloqueado" anterior à exportação não vira divergência;
--  * e-mail de aviso registra tentativa em portal_email_attempts (kind ce_unlock_notificacao);
--  * lotes zpt-5-v1 passam a contar como exportados (exported_at/export_id).
-- O preenchimento de exported_at dos lotes antigos reescreve linhas existentes e depende
-- da afirmação "Data status" do AGENTS.md (produção sem dados de negócio).
BEGIN;

-- Avisos por e-mail do desbloqueio passam a registrar tentativa (bounce/entrega via webhook).
ALTER TABLE public.portal_email_attempts DROP CONSTRAINT portal_email_attempts_kind_check;
ALTER TABLE public.portal_email_attempts ADD CONSTRAINT portal_email_attempts_kind_check CHECK (kind = ANY (ARRAY['convite','reenvio','recuperacao','alteracao_email','alerta_critico','resumo_diario','contato_bounced_notificacao','ce_unlock_notificacao']));

UPDATE public.ce_unlock_request_bls i SET exported_at=e.created_at,exported_by=e.created_by,export_id=e.id
FROM (SELECT DISTINCT ON (x->>'bl_id',x->>'request_id') x->>'bl_id' bl,(x->>'request_id')::uuid rq,ex.id,ex.created_at,ex.created_by
 FROM public.ce_unlock_exports ex CROSS JOIN LATERAL jsonb_array_elements(ex.snapshot) x
 WHERE ex.layout_version='zpt-5-v1' AND x->>'request_id' IS NOT NULL
 ORDER BY x->>'bl_id',x->>'request_id',ex.created_at DESC) e
WHERE i.bl_id=e.bl AND i.request_id=e.rq AND i.export_id IS NULL;

-- Prazo: sábado/domingo vencem segunda às 12:00 (decisão de 2026-10-07).
CREATE OR REPLACE FUNCTION ce_unlock_private.sla_deadline(p_start timestamptz) RETURNS timestamptz
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE l timestamp := p_start AT TIME ZONE 'America/Sao_Paulo'; d date := (p_start AT TIME ZONE 'America/Sao_Paulo')::date;
 dow integer := extract(isodow FROM (p_start AT TIME ZONE 'America/Sao_Paulo'))::integer; slot time := time '17:00';
BEGIN
 IF dow IN(6,7) THEN d:=d+(8-dow); slot:=time '12:00';
 ELSIF l::time>=time '12:00' THEN d:=d+CASE WHEN dow=5 THEN 3 ELSE 1 END; slot:=time '12:30'; END IF;
 RETURN (d+slot) AT TIME ZONE 'America/Sao_Paulo';
END $$;

-- Histórico do Portal só com o que é do cliente: sem exportação, entrega (motivo interno) ou VIP.
-- Confirmação legada continua como "Andamento atualizado", sem referência (migration 146).
CREATE OR REPLACE FUNCTION ce_unlock_private.request_json(p_id uuid,p_customer bigint DEFAULT NULL,p_docs boolean DEFAULT true) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r public.ce_unlock_requests; BEGIN
 SELECT * INTO r FROM public.ce_unlock_requests WHERE id=p_id AND (p_customer IS NULL OR customer_id=p_customer);
 IF r.id IS NULL THEN RAISE EXCEPTION '42501: Solicitação não encontrada ou não autorizada.' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('id',r.id,'protocol',r.protocol,'state',r.state,'version',r.version,'source',r.source,
 'customer_name',(SELECT name FROM public.customers WHERE id=r.customer_id),
 'items',coalesce((SELECT jsonb_agg(CASE WHEN p_customer IS NULL THEN ce_unlock_private.item(bl_id,p_id) ELSE ce_unlock_private.portal_view(ce_unlock_private.item(bl_id,p_id)) END ORDER BY bl_id) FROM public.ce_unlock_request_bls i WHERE i.request_id=p_id AND (p_customer IS NULL OR EXISTS(SELECT 1 FROM public.bls b WHERE b.id=i.bl_id AND b.customer_id=p_customer AND public.bl_has_portal_release(b.id)))),'[]'),
 'documents',CASE WHEN p_docs THEN coalesce((SELECT jsonb_agg(ce_unlock_private.doc_json(d.id) ORDER BY d.created_at DESC) FROM public.ce_unlock_documents d
 WHERE d.hash IS NOT NULL AND (d.request_id=p_id OR d.id IN(SELECT termo_document_id FROM public.ce_unlock_request_bls WHERE request_id=p_id UNION SELECT procuracao_document_id FROM public.ce_unlock_request_bls WHERE request_id=p_id))),'[]'::jsonb) ELSE '[]'::jsonb END,
 'confirmation_records',CASE WHEN p_customer IS NULL AND p_docs THEN coalesce((SELECT jsonb_agg(jsonb_build_object('bl_id',i.bl_id,'ce_mercante',i.confirmed_ce,'reference',i.external_reference,'confirmed_at',i.confirmed_at) ORDER BY i.bl_id) FROM public.ce_unlock_request_bls i WHERE i.request_id=p_id AND i.confirmed_at IS NOT NULL),'[]'::jsonb) ELSE '[]'::jsonb END,
 'events',coalesce((SELECT jsonb_agg(jsonb_build_object('id',e.id,'action',e.action,'reason',CASE WHEN e.action='confirm' AND NOT (p_customer IS NULL AND p_docs) THEN NULL ELSE e.reason END,'created_at',e.created_at) ORDER BY e.id) FROM public.ce_unlock_events e WHERE (request_id=p_id OR (e.request_id IS NULL AND e.bl_id IN (SELECT bl_id FROM public.ce_unlock_request_bls WHERE request_id=p_id)))
 AND (p_customer IS NULL OR e.action IN('draft','submit','review','cancel','complete','upload_termo','upload_procuracao','expire_draft','confirm'))),'[]'));
END $$;

CREATE OR REPLACE FUNCTION ce_unlock_private.command(p_action text,p_payload jsonb,p_portal boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE cid bigint; r public.ce_unlock_requests; d public.ce_unlock_documents; bid text; ids text[]; v jsonb; result jsonb; rid uuid; ev_reason text;
 key uuid; saved ce_unlock_private.receipts; v_version bigint; delivery public.ce_unlock_bl_deliveries; t uuid; p uuid; ex public.ce_unlock_exports; item jsonb;
BEGIN
 IF p_portal THEN cid:=public.current_portal_customer_id(); IF p_action NOT IN('draft','submit','cancel') THEN RAISE EXCEPTION '42501: Ação não autorizada.' USING ERRCODE='42501'; END IF;
 ELSE PERFORM ce_unlock_private.actor(true); END IF;
 key:=(p_payload->>'request_key')::uuid; IF key IS NULL THEN RAISE EXCEPTION 'Chave de operação obrigatória'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_action||key::text,0));
 SELECT * INTO saved FROM ce_unlock_private.receipts WHERE actor_id=auth.uid() AND action=p_action AND request_key=key;
 IF saved.actor_id IS NOT NULL THEN
   IF saved.payload<>p_payload THEN RAISE EXCEPTION 'Chave já utilizada para outra operação'; END IF;
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
 IF t IS NULL OR p IS NULL OR NOT EXISTS(SELECT 1 FROM public.ce_unlock_documents WHERE id=t AND status IN('uploaded','approved') AND purged_at IS NULL AND cleanup_claimed_at IS NULL) OR NOT EXISTS(SELECT 1 FROM public.ce_unlock_documents WHERE id=p AND status IN('uploaded','approved') AND purged_at IS NULL AND cleanup_claimed_at IS NULL) THEN RAISE EXCEPTION 'Anexe versões atuais de termo de devolução e procuração'; END IF;
 END IF;
 FOR bid IN SELECT bl_id FROM public.ce_unlock_request_bls WHERE request_id=r.id AND confirmed_at IS NULL LOOP
 item:=ce_unlock_private.item(bid,r.id);
 IF NOT (item->>'paid')::boolean OR NOT EXISTS(SELECT 1 FROM public.bls b WHERE b.id=bid AND b.customer_id=cid AND b.cancelled_at IS NULL AND b.ce_mercante=(SELECT ce_at_request FROM public.ce_unlock_request_bls WHERE request_id=r.id AND bl_id=bid)) THEN RAISE EXCEPTION 'B/L % perdeu elegibilidade',bid; END IF;
 END LOOP;
 UPDATE public.ce_unlock_request_bls SET termo_approved=CASE WHEN termo_document_id=t THEN termo_approved ELSE false END,
 procuracao_approved=CASE WHEN procuracao_document_id=p THEN procuracao_approved ELSE false END,
 termo_document_id=t,procuracao_document_id=p WHERE request_id=r.id AND confirmed_at IS NULL;
 UPDATE public.ce_unlock_requests SET state='submitted',version=version+1,updated_at=now() WHERE id=r.id;
 -- O evento entra antes da conclusão para que o prazo (SLA) parta do envio.
 INSERT INTO public.ce_unlock_events(customer_id,request_id,action,actor_id,payload) VALUES(cid,r.id,'submit',auth.uid(),p_payload);
 PERFORM ce_unlock_private.refresh_completion(r.id);
 result:=ce_unlock_private.request_json(r.id,cid);
 INSERT INTO ce_unlock_private.receipts(actor_id,action,request_key,payload,result) VALUES(auth.uid(),p_action,key,p_payload,result);
 RETURN result;
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
 IF r.id IS DISTINCT FROM d.request_id OR r.source<>'request' OR r.state NOT IN('submitted','in_review','changes_requested','completed') THEN RAISE EXCEPTION 'Documento não pertence à análise atual'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.ce_unlock_documents z WHERE z.id=d.id AND z.created_at=(SELECT max(created_at) FROM public.ce_unlock_documents WHERE request_id=r.id AND type=d.type AND status<>'uploading' AND hash IS NOT NULL)) THEN RAISE EXCEPTION 'Documento substituído'; END IF;
 -- A decisão vale para a solicitação inteira: todos os B/Ls ainda abertos.
 SELECT array_agg(bl_id) INTO ids FROM public.ce_unlock_request_bls WHERE request_id=r.id AND active AND confirmed_at IS NULL;
 IF coalesce(cardinality(ids),0)=0 THEN RAISE EXCEPTION 'Solicitação sem B/Ls abertos'; END IF;
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
 IF r.id IS NOT NULL AND d.source='request' THEN
 IF p_payload->>'decision'<>'approved' THEN PERFORM ce_unlock_private.notify(r.id,'changes_requested',(CASE d.type WHEN 'termo' THEN 'Termo de devolução: ' ELSE 'Procuração: ' END)||trim(p_payload->>'reason')); END IF;
 PERFORM ce_unlock_private.refresh_completion(r.id);
 END IF;
 result:=CASE WHEN r.id IS NOT NULL THEN ce_unlock_private.request_json(r.id) ELSE ce_unlock_private.vip_json(cid) END;
 WHEN 'apply_vip' THEN
 PERFORM 1 FROM public.ce_unlock_vip_customers WHERE customer_id=cid FOR UPDATE;
 PERFORM 1 FROM public.ce_unlock_documents WHERE customer_id=cid AND source='vip_annual' ORDER BY id FOR UPDATE;
 IF r.source<>'vip_annual' OR r.state IN('cancelled','completed') OR NOT coalesce((SELECT enabled FROM public.ce_unlock_vip_customers WHERE customer_id=cid),false) THEN RAISE EXCEPTION 'Cobertura VIP indisponível'; END IF;
 t:=ce_unlock_private.annual(cid,'termo'); p:=ce_unlock_private.annual(cid,'procuracao'); IF t IS NULL OR p IS NULL THEN RAISE EXCEPTION 'Cobertura anual incompleta'; END IF;
 UPDATE public.ce_unlock_request_bls SET termo_document_id=t,procuracao_document_id=p WHERE request_id=r.id AND confirmed_at IS NULL;
 UPDATE public.ce_unlock_requests SET version=version+1,updated_at=now() WHERE id=r.id;
 PERFORM ce_unlock_private.refresh_completion(r.id);
 result:=ce_unlock_private.request_json(r.id);
 WHEN 'delivery' THEN
 bid:=p_payload->>'bl_id';
 -- Mesma ordem de locks dos demais comandos: pedido antes do B/L.
 SELECT request_id INTO rid FROM public.ce_unlock_request_bls WHERE bl_id=bid AND active LIMIT 1;
 IF rid IS NOT NULL THEN PERFORM 1 FROM public.ce_unlock_requests WHERE id=rid FOR UPDATE; END IF;
 SELECT customer_id INTO cid FROM public.bls WHERE id=bid FOR UPDATE;
 IF cid IS NULL THEN RAISE EXCEPTION 'B/L não encontrado'; END IF;
 INSERT INTO public.ce_unlock_bl_deliveries(bl_id) VALUES(bid) ON CONFLICT DO NOTHING;
 SELECT * INTO delivery FROM public.ce_unlock_bl_deliveries WHERE bl_id=bid FOR UPDATE;
 IF delivery.version IS DISTINCT FROM (p_payload->>'expected_version')::bigint THEN RAISE EXCEPTION 'Entrega alterada; atualize a página' USING ERRCODE='40001'; END IF;
 IF NOT (p_payload->>'delivered')::boolean AND trim(coalesce(p_payload->>'reason',''))='' THEN RAISE EXCEPTION 'Motivo obrigatório'; END IF;
 UPDATE public.ce_unlock_bl_deliveries SET delivered=(p_payload->>'delivered')::boolean,version=version+1,updated_by=auth.uid(),updated_at=now() WHERE bl_id=bid;
 IF rid IS NOT NULL THEN PERFORM ce_unlock_private.refresh_completion(rid); END IF;
 result:=ce_unlock_private.item(bid);
 WHEN 'cancel' THEN
 IF p_portal THEN
 IF r.state NOT IN('draft','changes_requested') THEN RAISE EXCEPTION 'Pedido não pode ser cancelado pelo cliente. Contate a agência.'; END IF;
 ev_reason:=coalesce(nullif(trim(p_payload->>'reason'),''),'Cancelado pelo cliente');
 ELSE
 IF r.state='completed' THEN RAISE EXCEPTION 'Documentação validada: a solicitação não pode mais ser cancelada'; END IF;
 IF trim(coalesce(p_payload->>'reason',''))='' OR r.state='cancelled' THEN RAISE EXCEPTION 'Cancelamento exige pedido ativo e motivo'; END IF;
 END IF;
 IF EXISTS(SELECT 1 FROM public.ce_unlock_request_bls WHERE request_id=r.id AND (exported_at IS NOT NULL OR export_id IS NOT NULL)) THEN
 RAISE EXCEPTION '%',CASE WHEN p_portal THEN 'Pedido não pode ser cancelado pelo cliente. Contate a agência.' ELSE 'Pedido com B/L já exportado para a ZPT: confirme o tratamento externo antes de cancelar' END; END IF;
 UPDATE public.ce_unlock_requests SET state='cancelled',version=version+1,updated_at=now() WHERE id=r.id;
 UPDATE public.ce_unlock_request_bls SET active=false WHERE request_id=r.id;
 -- Portal recebe a projeção do cliente, nunca a do desk.
 result:=ce_unlock_private.request_json(r.id,CASE WHEN p_portal THEN cid END);
 WHEN 'reconfirm_ce' THEN
 bid:=p_payload->>'bl_id'; IF trim(coalesce(p_payload->>'reason',''))='' THEN RAISE EXCEPTION 'Motivo obrigatório'; END IF;
 -- export_id fica: lembra que o B/L já foi à ZPT (trava de cancelamento); exported_at volta à fila.
 UPDATE public.ce_unlock_request_bls SET ce_at_request=(SELECT ce_mercante FROM public.bls WHERE id=bid),termo_approved=false,procuracao_approved=false,exported_at=NULL,exported_by=NULL
 WHERE request_id=r.id AND bl_id=bid AND confirmed_at IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'B/L não pertence ao pedido'; END IF;
 UPDATE public.ce_unlock_requests SET version=version+1,updated_at=now() WHERE id=r.id;
 PERFORM ce_unlock_private.refresh_completion(r.id);
 result:=ce_unlock_private.request_json(r.id);
 WHEN 'export' THEN
 SELECT array_agg(DISTINCT value ORDER BY value) INTO ids FROM jsonb_array_elements_text(p_payload->'bl_ids');
 IF coalesce(cardinality(ids),0) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Seleção inválida'; END IF;
 PERFORM 1 FROM public.ce_unlock_requests WHERE id IN(SELECT request_id FROM public.ce_unlock_request_bls WHERE bl_id=ANY(ids) AND active) ORDER BY id FOR UPDATE;
 PERFORM 1 FROM public.bls WHERE id=ANY(ids) ORDER BY id FOR UPDATE;
 PERFORM 1 FROM public.bl_receivables WHERE bl_id=ANY(ids) ORDER BY id FOR UPDATE;
 PERFORM 1 FROM public.ce_unlock_vip_customers WHERE customer_id IN(SELECT customer_id FROM public.bls WHERE id=ANY(ids)) ORDER BY customer_id FOR UPDATE;
 PERFORM 1 FROM public.ce_unlock_documents WHERE id IN(SELECT termo_document_id FROM public.ce_unlock_request_bls WHERE bl_id=ANY(ids) AND active UNION SELECT procuracao_document_id FROM public.ce_unlock_request_bls WHERE bl_id=ANY(ids) AND active) ORDER BY id FOR UPDATE;
 PERFORM 1 FROM public.ce_unlock_bl_deliveries WHERE bl_id=ANY(ids) ORDER BY bl_id FOR UPDATE;
 v:='[]'; FOREACH bid IN ARRAY ids LOOP item:=ce_unlock_private.item(bid); IF NOT coalesce((item->>'can_export')::boolean,false) THEN RAISE EXCEPTION 'B/L % não apto: %',bid,item->'reasons'; END IF; v:=v||jsonb_build_array(item || jsonb_build_object('documents',(SELECT jsonb_build_object('termo_id',i.termo_document_id,'procuracao_id',i.procuracao_document_id,'termo',ce_unlock_private.doc_json(i.termo_document_id),'procuracao',ce_unlock_private.doc_json(i.procuracao_document_id)) FROM public.ce_unlock_request_bls i WHERE i.bl_id=bid AND i.active)));  END LOOP;
 INSERT INTO public.ce_unlock_exports(layout_version,rows,snapshot,created_by,reexport_of)
 VALUES('zpt-5-v2',(SELECT jsonb_agg(jsonb_build_object('bl_id',x->>'bl_id','termo',x->'termo','procuracao',x->'procuracao','delivered',x->'delivered','paid',x->'paid')) FROM jsonb_array_elements(v) x),
 v,auth.uid(),(p_payload->>'reexport_of')::uuid) RETURNING * INTO ex;
 -- Exportar é o registro do envio à ZPT. Divergência anterior fica limpa até nova conciliação.
 UPDATE public.ce_unlock_request_bls SET exported_at=now(),exported_by=auth.uid(),export_id=ex.id WHERE bl_id=ANY(ids) AND active;
 DELETE FROM public.ce_unlock_zpt_status WHERE bl_id=ANY(ids) AND status='divergent';
 result:=to_jsonb(ex);
 bid:=NULL; -- o lote não pertence a um B/L só; os B/Ls ficam no payload do evento.
 ELSE RAISE EXCEPTION 'Ação inválida'; END CASE;
 INSERT INTO public.ce_unlock_events(customer_id,request_id,bl_id,action,reason,actor_id,payload) VALUES(cid,r.id,bid,p_action,coalesce(ev_reason,p_payload->>'reason'),auth.uid(),p_payload);
 INSERT INTO ce_unlock_private.receipts(actor_id,action,request_key,payload,result) VALUES(auth.uid(),p_action,key,p_payload,result);
 RETURN result;
END $$;

-- Conclusão: avisa "documentação validada" só na primeira vez; uma reabertura seguida de
-- nova conclusão (ex.: BL de Entrega desmarcado e marcado de novo) não repete o aviso.
CREATE OR REPLACE FUNCTION ce_unlock_private.refresh_completion(p_request uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r public.ce_unlock_requests; bid text; ready boolean:=true; n integer:=0; started timestamptz; it jsonb; first_time boolean; BEGIN
 SELECT * INTO r FROM public.ce_unlock_requests WHERE id=p_request FOR UPDATE;
 IF r.id IS NULL OR r.state NOT IN('submitted','in_review','changes_requested','completed') THEN RETURN; END IF;
 FOR bid IN SELECT bl_id FROM public.ce_unlock_request_bls WHERE request_id=r.id AND active ORDER BY bl_id LOOP
 n:=n+1; it:=ce_unlock_private.item(bid,r.id);
 IF NOT coalesce((it->>'can_export')::boolean,false) THEN ready:=false; EXIT; END IF;
 started:=greatest(started,(it->>'sla_started_at')::timestamptz);
 END LOOP;
 IF n=0 THEN RETURN; END IF;
 IF ready AND r.state<>'completed' THEN
 first_time:=NOT EXISTS(SELECT 1 FROM public.ce_unlock_events e WHERE e.request_id=r.id AND e.action='complete');
 UPDATE public.ce_unlock_requests SET state='completed',version=version+1,updated_at=now() WHERE id=r.id;
 INSERT INTO public.ce_unlock_events(customer_id,request_id,action,actor_id) VALUES(r.customer_id,r.id,'complete',coalesce(auth.uid(),'00000000-0000-0000-0000-000000000000'));
 IF first_time THEN
 PERFORM ce_unlock_private.notify(r.id,'documentation_validated',to_char(ce_unlock_private.sla_deadline(coalesce(started,now())) AT TIME ZONE 'America/Sao_Paulo','DD/MM "às" HH24:MI'));
 END IF;
 ELSIF NOT ready AND r.state='completed' THEN
 UPDATE public.ce_unlock_requests SET state='in_review',version=version+1,updated_at=now() WHERE id=r.id;
 INSERT INTO public.ce_unlock_events(customer_id,request_id,action,actor_id) VALUES(r.customer_id,r.id,'reopen',coalesce(auth.uid(),'00000000-0000-0000-0000-000000000000'));
 END IF;
END $$;

-- Varredura das solicitações abertas: a liquidação (ou a perda dela) não passa por comando do
-- módulo; o job ce-unlock-notify-email chama esta função antes de enviar a fila.
-- ponytail: O(solicitações abertas × B/Ls) a cada execução do job (5 min). Upgrade: fila de
-- B/Ls tocados por trigger em ledger_settlements, fora da transação financeira.
CREATE FUNCTION public.ce_unlock_refresh_open() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE rid uuid; n integer:=0; BEGIN
 FOR rid IN SELECT id FROM public.ce_unlock_requests WHERE state IN('submitted','in_review','changes_requested','completed') ORDER BY id LOOP
 PERFORM ce_unlock_private.refresh_completion(rid); n:=n+1;
 END LOOP;
 RETURN n;
END $$;

-- Conciliação: uma linha "Bloqueado" cuja Data Atualização é anterior à exportação ainda não
-- reflete o envio (arquivo antigo ou planilha não processada); não vira divergência.
CREATE OR REPLACE FUNCTION public.ce_unlock_reconcile(p_rows jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE total integer; unlocked integer; divergent integer; stale integer; ignored integer; unknown integer; summary jsonb; BEGIN
 IF NOT public.is_active_user() THEN RAISE EXCEPTION '42501: Acesso negado.' USING ERRCODE='42501'; END IF;
 PERFORM ce_unlock_private.actor(true);
 IF jsonb_typeof(p_rows)<>'array' OR jsonb_array_length(p_rows) NOT BETWEEN 1 AND 20000 THEN RAISE EXCEPTION 'Arquivo da ZPT vazio ou grande demais (máximo de 20000 linhas)'; END IF;
 DROP TABLE IF EXISTS pg_temp.zpt_rows;
 CREATE TEMP TABLE zpt_rows ON COMMIT DROP AS
 SELECT bl_id,ce,zpt_status,descr,upd,pend,is_unlocked,exported_at IS NOT NULL was_exported,
 (NOT is_unlocked AND exported_at IS NOT NULL AND upd IS NOT NULL AND upd<exported_at) is_stale
 FROM (SELECT DISTINCT ON (b.id) b.id bl_id, b.ce_mercante ce, s.zpt_status, s.descr, s.upd, s.pend,
 lower(s.zpt_status)='desbloqueado' is_unlocked,
 (SELECT max(i.exported_at) FROM public.ce_unlock_request_bls i WHERE i.bl_id=b.id AND i.active) exported_at
 FROM (SELECT btrim(x->>'ce') ce, btrim(coalesce(x->>'status','')) zpt_status, nullif(btrim(x->>'description'),'') descr,
 nullif(x->>'updated_at','')::timestamptz upd, coalesce(ARRAY(SELECT jsonb_array_elements_text(x->'pending')),'{}'::text[]) pend
 FROM jsonb_array_elements(p_rows) x) s
 JOIN public.bls b ON ltrim(btrim(b.ce_mercante),'0')=ltrim(s.ce,'0') AND b.cancelled_at IS NULL
 WHERE s.zpt_status<>'' AND s.ce<>'' ORDER BY b.id, s.upd DESC NULLS LAST) q;
 INSERT INTO public.ce_unlock_zpt_status(bl_id,ce_mercante,status,zpt_status,description,pending,without_export,zpt_updated_at,reconciled_by)
 SELECT bl_id,ce,CASE WHEN is_unlocked THEN 'unlocked' ELSE 'divergent' END,zpt_status,descr,pend,is_unlocked AND NOT was_exported,upd,auth.uid()
 FROM zpt_rows WHERE is_unlocked OR (was_exported AND NOT is_stale)
 ON CONFLICT (bl_id) DO UPDATE SET ce_mercante=EXCLUDED.ce_mercante,status=EXCLUDED.status,zpt_status=EXCLUDED.zpt_status,description=EXCLUDED.description,
 pending=EXCLUDED.pending,without_export=EXCLUDED.without_export,zpt_updated_at=EXCLUDED.zpt_updated_at,reconciled_at=now(),reconciled_by=EXCLUDED.reconciled_by;
 DELETE FROM public.ce_unlock_zpt_status z USING zpt_rows r WHERE z.bl_id=r.bl_id AND NOT r.is_unlocked AND NOT r.was_exported;
 SELECT count(*) FILTER (WHERE is_unlocked), count(*) FILTER (WHERE NOT is_unlocked AND was_exported AND NOT is_stale),
 count(*) FILTER (WHERE is_stale), count(*) FILTER (WHERE NOT is_unlocked AND NOT was_exported)
 INTO unlocked,divergent,stale,ignored FROM zpt_rows;
 total:=jsonb_array_length(p_rows);
 SELECT count(*) INTO unknown FROM jsonb_array_elements(p_rows) x WHERE NOT EXISTS(SELECT 1 FROM public.bls b WHERE ltrim(btrim(b.ce_mercante),'0')=ltrim(btrim(x->>'ce'),'0') AND b.cancelled_at IS NULL);
 summary:=jsonb_build_object('rows',total,'unlocked',unlocked,'divergent',divergent,'stale',stale,'ignored',ignored,'unknown_ce',unknown);
 INSERT INTO public.ce_unlock_events(action,actor_id,payload) VALUES('reconcile',auth.uid(),summary);
 RETURN summary;
END $$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA ce_unlock_private FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ce_unlock_refresh_open() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ce_unlock_refresh_open() TO service_role;
COMMIT;
