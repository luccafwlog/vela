-- 298: Desbloqueio de CE, o B/L muda de solicitação (caminho A)
-- (lote 4 da identidade visual, decidido pelo responsável em 2026-10-18).
--
-- Problema: um B/L só podia estar numa solicitação ativa. Para juntá-lo a
-- outros B/Ls numa solicitação nova, o Cliente precisava cancelar a antiga
-- (e não podia, se ela já estava em análise). O Histórico da correção pedida
-- terminava em ".." quando o motivo já tinha ponto final.
--
-- Mudança:
--   1. `item.can_submit` aceita B/L ativo em solicitação ainda não validada
--      (rascunho, enviada, em análise ou correção pedida) do mesmo Cliente,
--      ainda não enviado à ZPT. B/L de "Documentação validada", de outro
--      Cliente ou já exportado continua bloqueado.
--   2. `command('draft')` trava antes as solicitações de onde os B/Ls saem
--      (pedido antes do Cliente e do B/L, a ordem dos demais comandos), cria
--      a nova, tira os B/Ls da antiga (`active=false`), registra
--      `bl_moved` em cada B/L e, se a antiga ficar sem B/L, cancela-a com o
--      evento `cancel` e o motivo. Documentos não passam para a nova.
--   3. `request_json` esconde da solicitação antiga o B/L que saiu (o
--      Histórico mostra a saída) e o Portal passa a ver `bl_moved`.
--   4. A lista "Minhas solicitações" traz os B/Ls e o início do prazo para
--      desbloqueio de cada solicitação.
--   5. O aviso de correção pedida não repete o ponto final do motivo.
--
-- A trava `ce_unlock_one_active_bl` (139) continua: um B/L, uma solicitação
-- ativa. Só redefine funções; não reescreve nem apaga linhas.
-- Rollback: reaplicar `ce_unlock_private.command` (161 com os ajustes da 220 e
-- da 279), `ce_unlock_private.item` (279), `request_json` e `list` (296) e
-- `notify` (160).

CREATE OR REPLACE FUNCTION ce_unlock_private.item(p_bl text, p_request uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE b public.bls; i public.ce_unlock_request_bls; r public.ce_unlock_requests; zs public.ce_unlock_zpt_status; paid boolean; td boolean; pd boolean; delivered boolean;
 local_paid boolean; exempt boolean:=false; manual_open boolean; vip boolean; reasons text[] := '{}'; eligible boolean; confirmed boolean; vs text; sla timestamptz;
BEGIN
 SELECT * INTO b FROM public.bls WHERE id=p_bl;
 SELECT * INTO i FROM public.ce_unlock_request_bls WHERE bl_id=p_bl AND (p_request IS NULL OR request_id=p_request)
 ORDER BY active DESC,confirmed_at DESC NULLS LAST,request_id LIMIT 1;
 SELECT * INTO r FROM public.ce_unlock_requests WHERE id=i.request_id;
 SELECT * INTO zs FROM public.ce_unlock_zpt_status WHERE bl_id=p_bl AND ce_mercante IS NOT DISTINCT FROM b.ce_mercante;
 SELECT coalesce(enabled,false) INTO vip FROM public.ce_unlock_vip_customers WHERE customer_id=b.customer_id; vip:=coalesce(vip,false);
 SELECT coalesce(bool_and(status='settled' AND balance_brl=0 AND original_amount_brl>0 AND settled_amount_brl>=original_amount_brl-correction_amount_brl
 AND EXISTS(SELECT 1 FROM public.ledger_settlements s WHERE s.receivable_id=x.id)),false)
 INTO local_paid FROM public.bl_receivables x WHERE x.bl_id=p_bl AND x.status<>'void'
 AND x.source='local_charges' AND x.customer_id=b.customer_id;
 -- ADR 0087, item 2: B/L com Taxas Locais isentas, sem recebível vigente, não tem o requisito.
 IF NOT local_paid AND b.charge_status='exempt' AND NOT EXISTS(SELECT 1 FROM public.bl_receivables x
 WHERE x.bl_id=p_bl AND x.status<>'void' AND x.source='local_charges') THEN local_paid:=true; exempt:=true; END IF;
 -- ADR 0087, item 3: fatura avulsa emitida que referencia o B/L precisa estar quitada. Demurrage não entra.
 manual_open:=EXISTS(SELECT 1 FROM public.invoices n WHERE n.bl_id=p_bl AND n.invoice_type='manual'
 AND n.customer_id=b.customer_id AND n.status IN('issued','partially_paid') AND n.balance_brl>0);
 paid:=local_paid AND NOT manual_open;
 IF EXISTS(SELECT 1 FROM public.invoice_customer_changes c WHERE c.bl_id=p_bl AND c.status<>'completed')
 OR EXISTS(SELECT 1 FROM public.invoice_basis_pending_changes c WHERE c.bl_id=p_bl AND c.source='customer_change') THEN
 paid:=false; reasons:=array_append(reasons,'Troca de Cliente aguarda devolução e nova cobrança'); END IF;
 IF EXISTS(SELECT 1 FROM public.cod_adjustments a LEFT JOIN public.invoices n ON n.id=a.resulting_document_id
 WHERE a.bl_id=p_bl AND a.status<>'cancelled' AND a.difference_brl>0
 AND (a.status='pending' OR a.manual_review_required OR (a.resulting_document_type='invoice' AND coalesce(n.balance_brl,1)>0))) THEN paid:=false; END IF;
 SELECT coalesce(d.delivered,false) INTO delivered FROM public.ce_unlock_bl_deliveries d WHERE bl_id=p_bl; delivered:=coalesce(delivered,false);
 IF r.source='vip_annual' THEN
 td:=vip AND ce_unlock_private.valid_doc(i.termo_document_id); pd:=vip AND ce_unlock_private.valid_doc(i.procuracao_document_id);
 ELSE td:=coalesce(i.termo_approved,false); pd:=coalesce(i.procuracao_approved,false); END IF;
 confirmed:=i.confirmed_at IS NOT NULL AND i.confirmed_ce IS NOT DISTINCT FROM b.ce_mercante AND r.customer_id=b.customer_id;
 eligible:=b.cancelled_at IS NULL AND trim(coalesce(b.ce_mercante,''))<>'' AND paid;
 IF r.id IS NOT NULL AND r.state NOT IN('draft','cancelled') THEN
 -- Prazo recomeça quando o cliente resolve uma pendência dele: reenvio, entrega do original, nova liquidação.
 sla:=greatest((SELECT max(e.created_at) FROM public.ce_unlock_events e WHERE e.request_id=r.id AND e.action='submit'),
 CASE WHEN delivered THEN (SELECT d.updated_at FROM public.ce_unlock_bl_deliveries d WHERE d.bl_id=p_bl) END,
 (SELECT max(s.created_at) FROM public.ledger_settlements s JOIN public.bl_receivables x ON x.id=s.receivable_id WHERE x.bl_id=p_bl AND x.status<>'void'),
 (SELECT max(p.created_at) FROM public.payments p JOIN public.invoices n ON n.id=p.invoice_id WHERE n.bl_id=p_bl AND n.invoice_type='manual' AND n.customer_id=b.customer_id));
 END IF;
 IF r.id IS NOT NULL AND r.customer_id IS DISTINCT FROM b.customer_id THEN reasons:=array_append(reasons,'Cliente do B/L alterado: solicitação anterior inaplicável'); END IF;
 IF b.cancelled_at IS NOT NULL THEN reasons:=array_append(reasons,'B/L cancelado'); END IF;
 IF trim(coalesce(b.ce_mercante,''))='' THEN reasons:=array_append(reasons,'CE Mercante não informado'); END IF;
 IF NOT local_paid OR (NOT paid AND NOT manual_open) THEN reasons:=array_append(reasons,'Taxas locais sem liquidação integral confirmada'); END IF;
 IF manual_open THEN reasons:=array_append(reasons,'Fatura avulsa do B/L em aberto'); END IF;
 IF r.id IS NOT NULL AND NOT td THEN reasons:=array_append(reasons,'Termo de devolução pendente, vencido ou revogado'); END IF;
 IF r.id IS NOT NULL AND NOT pd THEN reasons:=array_append(reasons,'Procuração pendente, vencida ou revogada'); END IF;
 IF r.id IS NOT NULL AND NOT delivered THEN reasons:=array_append(reasons,'B/L físico aguardando entrega'); END IF;
 IF r.id IS NOT NULL AND i.ce_at_request IS DISTINCT FROM b.ce_mercante THEN reasons:=array_append(reasons,'CE alterado: reconferência necessária'); END IF;
 SELECT ve.name INTO vs FROM public.voyages v JOIN public.vessels ve ON ve.id=v.vessel_id WHERE v.id=b.voyage_id;
 RETURN jsonb_build_object('bl_id',p_bl,'ce_mercante',b.ce_mercante,'customer_id',b.customer_id,
 'customer_name',(SELECT name FROM public.customers WHERE id=b.customer_id),'cnpj_cpf',(SELECT cnpj_cpf FROM public.customers WHERE id=b.customer_id),
 'voyage_id',b.voyage_id,'voyage_number',(SELECT voyage_number FROM public.voyages WHERE id=b.voyage_id),'vessel_name',vs,'pod',b.pod,
 'request_id',r.id,'requested_at',r.created_at,'protocol',r.protocol,'state',coalesce(r.state,'no_request'),'version',r.version,'source',coalesce(r.source,'request'),
 'vip',vip,'termo',td,'procuracao',pd,'paid',paid,'paid_exempt',exempt,'delivered',delivered,'confirmed',confirmed,
 'delivery_version',coalesce((SELECT version FROM public.ce_unlock_bl_deliveries WHERE bl_id=p_bl),0),
 -- 298: B/L ativo em solicitação ainda não validada, do mesmo Cliente e não
 -- enviado à ZPT, pode mudar para uma solicitação nova (caminho A).
 'can_submit',eligible AND NOT confirmed AND (NOT coalesce(i.active,false)
 OR (r.state IN('draft','submitted','in_review','changes_requested') AND r.customer_id=b.customer_id
 AND i.exported_at IS NULL AND i.export_id IS NULL AND i.confirmed_at IS NULL)),
 'can_export',eligible AND r.customer_id=b.customer_id AND td AND pd AND delivered AND r.state IN('submitted','in_review','changes_requested','completed') AND i.active AND i.ce_at_request=b.ce_mercante AND NOT confirmed,
 'export_state',CASE WHEN confirmed THEN 'confirmed' WHEN i.exported_at IS NOT NULL THEN 'exported' ELSE 'not_exported' END,
 'exported_at',i.exported_at,'sla_started_at',sla,
 'zpt_status',zs.status,'zpt_description',zs.description,'zpt_pending',to_jsonb(zs.pending),'zpt_updated_at',zs.zpt_updated_at,'zpt_without_export',zs.without_export,
 'reasons',to_jsonb(reasons));
END $function$;

CREATE OR REPLACE FUNCTION ce_unlock_private.command(p_action text, p_payload jsonb, p_portal boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE cid bigint; r public.ce_unlock_requests; old_ids uuid[]; q record; d public.ce_unlock_documents; bid text; ids text[]; v jsonb; result jsonb; rid uuid; ev_reason text;
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
 -- 298: o B/L pode sair de outra solicitação ainda não validada (caminho A).
 -- Pedido antes do Cliente e do B/L, a mesma ordem dos demais comandos.
 IF p_action='draft' THEN
 PERFORM 1 FROM public.ce_unlock_requests WHERE id IN(SELECT x.request_id FROM public.ce_unlock_request_bls x
 WHERE x.active AND x.bl_id IN(SELECT jsonb_array_elements_text(p_payload->'bl_ids'))) ORDER BY id FOR UPDATE;
 SELECT array_agg(DISTINCT x.request_id) INTO old_ids FROM public.ce_unlock_request_bls x
 WHERE x.active AND x.bl_id IN(SELECT jsonb_array_elements_text(p_payload->'bl_ids'));
 END IF;
 IF cid IS NOT NULL THEN PERFORM 1 FROM public.customers WHERE id=cid FOR NO KEY UPDATE; END IF;
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
 -- 298: B/L de solicitação ainda não validada muda para a nova. A antiga
 -- registra a saída; sem nenhum B/L, é cancelada. Documentos não passam.
 FOR q IN SELECT x.request_id,array_agg(x.bl_id ORDER BY x.bl_id) AS bls FROM public.ce_unlock_request_bls x
 WHERE x.bl_id=ANY(ids) AND x.active GROUP BY x.request_id ORDER BY x.request_id LOOP
 IF old_ids IS NULL OR NOT q.request_id=ANY(old_ids) THEN RAISE EXCEPTION 'Solicitação alterada; atualize a página.' USING ERRCODE='40001'; END IF;
 UPDATE public.ce_unlock_request_bls SET active=false WHERE request_id=q.request_id AND bl_id=ANY(q.bls);
 INSERT INTO public.ce_unlock_events(customer_id,request_id,bl_id,action,reason,actor_id,payload)
 SELECT cid,q.request_id,moved,'bl_moved','B/L passou para a solicitação '||r.protocol,auth.uid(),jsonb_build_object('to_request',r.id,'to_protocol',r.protocol)
 FROM unnest(q.bls) AS moved;
 IF EXISTS(SELECT 1 FROM public.ce_unlock_request_bls WHERE request_id=q.request_id AND active) THEN
 UPDATE public.ce_unlock_requests SET version=version+1,updated_at=now() WHERE id=q.request_id;
 PERFORM ce_unlock_private.refresh_completion(q.request_id);
 ELSE
 UPDATE public.ce_unlock_requests SET state='cancelled',version=version+1,updated_at=now() WHERE id=q.request_id;
 INSERT INTO public.ce_unlock_events(customer_id,request_id,action,reason,actor_id,payload)
 VALUES(cid,q.request_id,'cancel','Todos os B/Ls passaram para a solicitação '||r.protocol,auth.uid(),jsonb_build_object('to_request',r.id,'to_protocol',r.protocol));
 END IF;
 END LOOP;
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
 PERFORM 1 FROM public.invoices WHERE bl_id=ANY(ids) AND invoice_type='manual' ORDER BY id FOR UPDATE;
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
END $function$;

CREATE OR REPLACE FUNCTION ce_unlock_private.request_json(p_id uuid,p_customer bigint DEFAULT NULL,p_docs boolean DEFAULT true) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r public.ce_unlock_requests; BEGIN
 SELECT * INTO r FROM public.ce_unlock_requests WHERE id=p_id AND (p_customer IS NULL OR customer_id=p_customer);
 IF r.id IS NULL THEN RAISE EXCEPTION '42501: Solicitação não encontrada ou não autorizada.' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('id',r.id,'protocol',r.protocol,'state',r.state,'version',r.version,'source',r.source,
 'customer_name',(SELECT name FROM public.customers WHERE id=r.customer_id),
 'items',coalesce((SELECT jsonb_agg(CASE WHEN p_customer IS NULL THEN ce_unlock_private.item(bl_id,p_id) ELSE ce_unlock_private.portal_view(ce_unlock_private.item(bl_id,p_id)) END ORDER BY bl_id) FROM public.ce_unlock_request_bls i WHERE i.request_id=p_id AND (r.state='cancelled' OR NOT EXISTS(SELECT 1 FROM public.ce_unlock_events moved WHERE moved.request_id=p_id AND moved.bl_id=i.bl_id AND moved.action='bl_moved')) AND (p_customer IS NULL OR EXISTS(SELECT 1 FROM public.bls b WHERE b.id=i.bl_id AND b.customer_id=p_customer AND public.bl_has_portal_release(b.id)))),'[]'),
 'documents',CASE WHEN p_docs THEN coalesce((SELECT jsonb_agg(ce_unlock_private.doc_json(d.id) ORDER BY d.created_at DESC) FROM public.ce_unlock_documents d
 WHERE d.hash IS NOT NULL AND (d.request_id=p_id OR d.id IN(SELECT termo_document_id FROM public.ce_unlock_request_bls WHERE request_id=p_id UNION SELECT procuracao_document_id FROM public.ce_unlock_request_bls WHERE request_id=p_id))),'[]'::jsonb) ELSE '[]'::jsonb END,
 'confirmation_records',CASE WHEN p_customer IS NULL AND p_docs THEN coalesce((SELECT jsonb_agg(jsonb_build_object('bl_id',i.bl_id,'ce_mercante',i.confirmed_ce,'reference',i.external_reference,'confirmed_at',i.confirmed_at) ORDER BY i.bl_id) FROM public.ce_unlock_request_bls i WHERE i.request_id=p_id AND i.confirmed_at IS NOT NULL),'[]'::jsonb) ELSE '[]'::jsonb END,
 'events',coalesce((SELECT jsonb_agg(jsonb_build_object('id',e.id,'action',e.action,'reason',CASE WHEN e.action='confirm' AND NOT (p_customer IS NULL AND p_docs) THEN NULL ELSE e.reason END,'created_at',e.created_at)
 || CASE WHEN p_customer IS NULL THEN jsonb_build_object('actor',coalesce(
   (SELECT up.full_name FROM public.user_profiles up WHERE up.id=e.actor_id),
   CASE WHEN EXISTS(SELECT 1 FROM public.customer_portal_accounts a WHERE a.auth_user_id=e.actor_id) THEN 'Cliente pelo Portal' END,
   CASE WHEN e.actor_id='00000000-0000-0000-0000-000000000000' THEN 'Sistema' END)) ELSE '{}'::jsonb END ORDER BY e.id) FROM public.ce_unlock_events e WHERE (request_id=p_id OR (e.request_id IS NULL AND e.bl_id IN (SELECT bl_id FROM public.ce_unlock_request_bls WHERE request_id=p_id)))
 AND (p_customer IS NULL OR e.action IN('draft','submit','review','cancel','complete','upload_termo','upload_procuracao','expire_draft','confirm','bl_moved'))),'[]'));
END $$;

CREATE OR REPLACE FUNCTION ce_unlock_private.list(p_customer bigint,p_filters jsonb,p_page integer,p_requests boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE all_rows jsonb; BEGIN
 IF p_page<1 THEN RAISE EXCEPTION 'Página inválida'; END IF;
 IF p_requests THEN
 -- 298: Minhas solicitações mostra os B/Ls e o prazo para desbloqueio.
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',r.id,'protocol',r.protocol,'state',r.state,'version',r.version,'source',r.source,'created_at',r.created_at,
 'bl_ids',coalesce((SELECT jsonb_agg(i.bl_id ORDER BY i.bl_id) FROM public.ce_unlock_request_bls i WHERE i.request_id=r.id AND (r.state='cancelled' OR NOT EXISTS(SELECT 1 FROM public.ce_unlock_events moved WHERE moved.request_id=r.id AND moved.bl_id=i.bl_id AND moved.action='bl_moved'))),'[]'::jsonb),
 'sla_started_at',(SELECT max((ce_unlock_private.item(i.bl_id,r.id)->>'sla_started_at')::timestamptz) FROM public.ce_unlock_request_bls i WHERE i.request_id=r.id AND i.active)) ORDER BY r.created_at DESC),'[]') INTO all_rows
 FROM public.ce_unlock_requests r WHERE (p_customer IS NULL OR r.customer_id=p_customer);
 ELSE
 SELECT coalesce(jsonb_agg(j ORDER BY j->>'bl_id'),'[]') INTO all_rows FROM (
 SELECT ce_unlock_private.visible_item(b.id,p_customer) j FROM public.bls b WHERE trim(coalesce(b.ce_mercante,''))<>''
 AND (p_customer IS NULL OR (b.customer_id=p_customer AND public.bl_has_portal_release(b.id)))
 ) x WHERE (coalesce(p_filters->>'search','')='' OR (j->>'bl_id') ILIKE '%'||(p_filters->>'search')||'%' OR (j->>'ce_mercante') ILIKE '%'||(p_filters->>'search')||'%' OR (j->>'customer_name') ILIKE '%'||(p_filters->>'search')||'%')
 AND (coalesce(p_filters->>'customer_id','')='' OR j->>'customer_id'=p_filters->>'customer_id')
 AND (coalesce(p_filters->>'voyage_id','')='' OR j->>'voyage_id'=p_filters->>'voyage_id')
 AND (coalesce(p_filters->>'pod','')='' OR j->>'pod'=p_filters->>'pod')
 AND (coalesce(p_filters->>'situation','')='' OR j->>'state'=p_filters->>'situation'
 OR (p_filters->>'situation'='ready' AND (j->>'can_export')::boolean)
 OR (p_filters->>'situation'='ready_not_exported' AND (j->>'can_export')::boolean AND j->>'export_state'='not_exported' AND j->>'zpt_status' IS DISTINCT FROM 'unlocked')
 OR (p_filters->>'situation'='exported' AND j->>'export_state'='exported' AND j->>'zpt_status' IS NULL)
 OR (p_filters->>'situation'='unlocked' AND j->>'zpt_status'='unlocked')
 OR (p_filters->>'situation'='divergent' AND j->>'zpt_status'='divergent'))
 AND (coalesce(p_filters->>'pending_requirement','')='' OR NOT coalesce((j->>(CASE p_filters->>'pending_requirement' WHEN 'taxas' THEN 'paid' WHEN 'bl_fisico' THEN 'delivered' ELSE p_filters->>'pending_requirement' END))::boolean,false));
 END IF;
 RETURN jsonb_build_object('items',coalesce((SELECT jsonb_agg(value) FROM (SELECT value FROM jsonb_array_elements(all_rows) WITH ORDINALITY a(value,n) WHERE n>(p_page-1)*25 AND n<=p_page*25) p),'[]'),'total',jsonb_array_length(all_rows),'page',p_page,'page_size',25);
END $$;

CREATE OR REPLACE FUNCTION ce_unlock_private.notify(p_request uuid, p_kind text, p_text text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE r public.ce_unlock_requests; title text; msg text; BEGIN
 SELECT * INTO r FROM public.ce_unlock_requests WHERE id=p_request;
 IF r.id IS NULL THEN RETURN; END IF;
 IF p_kind='changes_requested' THEN
 title:='Desbloqueio de CE: correção solicitada';
 -- 298: o motivo digitado já pode terminar em ponto; não repetir.
 msg:='A solicitação '||r.protocol||' precisa de correção. Motivo: '||regexp_replace(coalesce(p_text,'não informado'),'[.[:space:]]+$','')||'. Reenvie os documentos pelo Portal.';
 ELSE
 title:='Desbloqueio de CE: documentação validada';
 msg:='A documentação da solicitação '||r.protocol||' foi validada. Prazo para o desbloqueio: até '||p_text||'. Consulte o Mercante para verificar o desbloqueio.';
 END IF;
 INSERT INTO public.portal_notifications(customer_id,type,title,message,link) VALUES(r.customer_id,'system',title,msg,'/portal/desbloqueio-ce?pedido='||r.id);
 INSERT INTO public.ce_unlock_email_outbox(customer_id,request_id,kind,subject,body) VALUES(r.customer_id,r.id,p_kind,title,msg);
END $function$;
