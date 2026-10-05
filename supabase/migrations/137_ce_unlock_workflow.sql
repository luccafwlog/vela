-- Issue 557: solicitação de CE, cobertura VIP anual e exportação assistida ZPT.
-- Somente entidades novas. Reversão operacional: suspender novas ações na UI;
-- preservar pedidos, documentos e lotes. Nenhuma liberação externa automática.
BEGIN;
CREATE SCHEMA ce_unlock_private;
REVOKE ALL ON SCHEMA ce_unlock_private FROM PUBLIC, anon, authenticated;
CREATE TABLE public.ce_unlock_vip_customers (
 customer_id bigint PRIMARY KEY REFERENCES public.customers(id), enabled boolean NOT NULL DEFAULT false,
 version bigint NOT NULL DEFAULT 0, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.ce_unlock_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), customer_id bigint NOT NULL REFERENCES public.customers(id),
 protocol text NOT NULL UNIQUE DEFAULT ('CE-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,12))),
 state text NOT NULL DEFAULT 'draft' CHECK(state IN('draft','submitted','in_review','changes_requested','cancelled','completed')),
 source text NOT NULL CHECK(source IN('request','vip_annual')), version bigint NOT NULL DEFAULT 0,
 created_by uuid NOT NULL, model_id uuid, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.ce_unlock_documents (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), customer_id bigint REFERENCES public.customers(id),
 request_id uuid REFERENCES public.ce_unlock_requests(id), type text NOT NULL CHECK(type IN('termo','procuracao','model')),
 source text NOT NULL CHECK(source IN('request','vip_annual','model')),
 status text NOT NULL DEFAULT 'uploading' CHECK(status IN('uploading','uploaded','approved','changes_requested','revoked')),
 storage_path text NOT NULL UNIQUE, file_name text NOT NULL, size_bytes bigint NOT NULL CHECK(size_bytes>0 AND size_bytes<=10485760),
 hash text, uploaded_by uuid NOT NULL, reviewed_by uuid, reason text, coverage_year integer,
 valid_from date, valid_until date, created_at timestamptz NOT NULL DEFAULT now(), reviewed_at timestamptz,
 CHECK ((source='request' AND request_id IS NOT NULL AND customer_id IS NOT NULL AND type<>'model')
 OR (source='vip_annual' AND request_id IS NULL AND customer_id IS NOT NULL AND type<>'model')
 OR (source='model' AND request_id IS NULL AND customer_id IS NULL AND type='model')),
 CHECK(source<>'vip_annual' OR status<>'approved' OR (coverage_year IS NOT NULL AND valid_from IS NOT NULL AND valid_until IS NOT NULL AND valid_until=make_date(coverage_year,12,31) AND valid_from<=valid_until))
);
ALTER TABLE public.ce_unlock_requests ADD CONSTRAINT ce_unlock_model_fk FOREIGN KEY(model_id) REFERENCES public.ce_unlock_documents(id);
CREATE TABLE public.ce_unlock_request_bls (
 request_id uuid NOT NULL REFERENCES public.ce_unlock_requests(id), bl_id text NOT NULL REFERENCES public.bls(id),
 ce_at_request text NOT NULL, active boolean NOT NULL DEFAULT true,
 termo_document_id uuid REFERENCES public.ce_unlock_documents(id), procuracao_document_id uuid REFERENCES public.ce_unlock_documents(id),
 termo_approved boolean NOT NULL DEFAULT false, procuracao_approved boolean NOT NULL DEFAULT false,
 confirmed_at timestamptz, confirmed_by uuid, confirmed_ce text, external_reference text,
 PRIMARY KEY(request_id,bl_id)
);
CREATE UNIQUE INDEX ce_unlock_one_active_bl ON public.ce_unlock_request_bls(bl_id) WHERE active;
CREATE INDEX ce_unlock_requests_customer ON public.ce_unlock_requests(customer_id,created_at DESC);
CREATE INDEX ce_unlock_documents_context ON public.ce_unlock_documents(customer_id,request_id,type,created_at DESC);
CREATE TABLE public.ce_unlock_bl_deliveries (
 bl_id text PRIMARY KEY REFERENCES public.bls(id), delivered boolean NOT NULL DEFAULT false, version bigint NOT NULL DEFAULT 0,
 updated_by uuid, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.ce_unlock_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, customer_id bigint, request_id uuid REFERENCES public.ce_unlock_requests(id),
 bl_id text, action text NOT NULL, reason text, actor_id uuid NOT NULL, payload jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.ce_unlock_exports (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), layout_version text NOT NULL DEFAULT 'zpt-5-v1', rows jsonb NOT NULL,
 snapshot jsonb NOT NULL, hash text, created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 sent_at timestamptz, reference text, reexport_of uuid REFERENCES public.ce_unlock_exports(id)
);
CREATE TABLE ce_unlock_private.receipts (
 actor_id uuid NOT NULL, action text NOT NULL, request_key uuid NOT NULL, payload jsonb NOT NULL, result jsonb NOT NULL,
 PRIMARY KEY(actor_id,action,request_key)
);
CREATE TABLE ce_unlock_private.upload_attempts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), customer_id bigint, actor_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX ce_unlock_attempts_customer ON ce_unlock_private.upload_attempts(customer_id,created_at);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['ce_unlock_requests','ce_unlock_request_bls','ce_unlock_documents','ce_unlock_vip_customers','ce_unlock_bl_deliveries','ce_unlock_events','ce_unlock_exports'] LOOP
 EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated',t);
 EXECUTE format('GRANT ALL ON public.%I TO service_role',t);
 END LOOP;
END $$;
GRANT USAGE, SELECT ON SEQUENCE public.ce_unlock_events_id_seq TO service_role;
INSERT INTO storage.buckets(id,name,public) VALUES('ce-unlock-documents','ce-unlock-documents',false);

CREATE FUNCTION ce_unlock_private.actor(p_manage boolean DEFAULT false) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r text; BEGIN
 SELECT CASE role WHEN 'operator' THEN 'documentacao' ELSE role END INTO r FROM public.user_profiles WHERE id=auth.uid() AND active;
 IF r IS NULL OR (p_manage AND r NOT IN('administrativo','documentacao')) OR (NOT p_manage AND r NOT IN('administrativo','documentacao','financeiro','operacoes')) THEN
 RAISE EXCEPTION '42501: Acesso negado ao desbloqueio de CE.' USING ERRCODE='42501'; END IF;
 RETURN r;
END $$;
CREATE FUNCTION ce_unlock_private.today() RETURNS date LANGUAGE sql STABLE AS $$ SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date $$;
CREATE FUNCTION ce_unlock_private.valid_doc(p_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT coalesce((SELECT d.status='approved' AND d.source='vip_annual' AND d.valid_until=make_date(d.coverage_year,12,31)
 AND ce_unlock_private.today() BETWEEN d.valid_from AND d.valid_until FROM public.ce_unlock_documents d WHERE d.id=p_id),false)
$$;
CREATE FUNCTION ce_unlock_private.annual(p_customer bigint,p_type text) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT d.id FROM public.ce_unlock_documents d WHERE d.customer_id=p_customer AND d.type=p_type AND ce_unlock_private.valid_doc(d.id)
 ORDER BY d.created_at DESC,d.id LIMIT 1
$$;
CREATE FUNCTION ce_unlock_private.item(p_bl text,p_request uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE b public.bls; i public.ce_unlock_request_bls; r public.ce_unlock_requests; paid boolean; td boolean; pd boolean; delivered boolean;
 vip boolean; reasons text[] := '{}'; eligible boolean; confirmed boolean; vs text; cid bigint;
BEGIN
 SELECT * INTO b FROM public.bls WHERE id=p_bl;
 SELECT * INTO i FROM public.ce_unlock_request_bls WHERE bl_id=p_bl AND (p_request IS NULL OR request_id=p_request)
 ORDER BY active DESC,confirmed_at DESC NULLS LAST,request_id LIMIT 1;
 SELECT * INTO r FROM public.ce_unlock_requests WHERE id=i.request_id;
 SELECT coalesce(enabled,false) INTO vip FROM public.ce_unlock_vip_customers WHERE customer_id=b.customer_id; vip:=coalesce(vip,false);
 SELECT coalesce(bool_and(status='settled' AND balance_brl=0 AND original_amount_brl>0 AND settled_amount_brl>=original_amount_brl
 AND EXISTS(SELECT 1 FROM public.ledger_settlements s WHERE s.receivable_id=x.id)),false)
 INTO paid FROM public.bl_receivables x WHERE bl_id=p_bl AND status<>'void';
 IF EXISTS(SELECT 1 FROM public.cod_adjustments a LEFT JOIN public.invoices n ON n.id=a.resulting_document_id
 WHERE a.bl_id=p_bl AND a.status<>'cancelled' AND a.difference_brl>0
 AND (a.status='pending' OR a.manual_review_required OR (a.resulting_document_type='invoice' AND coalesce(n.balance_brl,1)>0))) THEN paid:=false; END IF;
 SELECT coalesce(d.delivered,false) INTO delivered FROM public.ce_unlock_bl_deliveries d WHERE bl_id=p_bl; delivered:=coalesce(delivered,false);
 IF r.source='vip_annual' THEN
 td:=vip AND ce_unlock_private.valid_doc(i.termo_document_id); pd:=vip AND ce_unlock_private.valid_doc(i.procuracao_document_id);
 ELSE td:=coalesce(i.termo_approved,false); pd:=coalesce(i.procuracao_approved,false); END IF;
 confirmed:=i.confirmed_at IS NOT NULL AND i.confirmed_ce IS NOT DISTINCT FROM b.ce_mercante;
 eligible:=b.cancelled_at IS NULL AND trim(coalesce(b.ce_mercante,''))<>'' AND paid;
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
 'request_id',r.id,'protocol',r.protocol,'state',coalesce(r.state,'no_request'),'version',r.version,'source',coalesce(r.source,'request'),
 'vip',vip,'termo',td,'procuracao',pd,'paid',paid,'delivered',delivered,'confirmed',confirmed,
 'delivery_version',coalesce((SELECT version FROM public.ce_unlock_bl_deliveries WHERE bl_id=p_bl),0),
 'can_submit',eligible AND NOT coalesce(i.active,false) AND NOT confirmed,
 'can_export',eligible AND td AND pd AND delivered AND r.state IN('submitted','in_review','changes_requested') AND i.active AND i.ce_at_request=b.ce_mercante AND NOT confirmed,
 'export_state',CASE WHEN confirmed THEN 'confirmed' WHEN EXISTS(SELECT 1 FROM public.ce_unlock_exports e WHERE e.snapshot @> jsonb_build_array(jsonb_build_object('bl_id',p_bl,'request_id',r.id))) THEN 'exported' ELSE 'not_exported' END,
 'reasons',to_jsonb(reasons));
END $$;
CREATE FUNCTION ce_unlock_private.doc_json(p_id uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT jsonb_build_object('id',id,'customer_id',customer_id,'request_id',request_id,'type',type,'source',source,'status',status,
 'file_name',file_name,'size_bytes',size_bytes,'valid_from',valid_from,'valid_until',valid_until,'coverage_year',coverage_year,'reason',reason,'created_at',created_at)
 FROM public.ce_unlock_documents WHERE id=p_id
$$;
CREATE FUNCTION ce_unlock_private.request_json(p_id uuid,p_customer bigint DEFAULT NULL,p_docs boolean DEFAULT true) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r public.ce_unlock_requests; BEGIN
 SELECT * INTO r FROM public.ce_unlock_requests WHERE id=p_id AND (p_customer IS NULL OR customer_id=p_customer);
 IF r.id IS NULL THEN RAISE EXCEPTION '42501: Solicitação não encontrada ou não autorizada.' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('id',r.id,'protocol',r.protocol,'state',r.state,'version',r.version,'source',r.source,
 'items',coalesce((SELECT jsonb_agg(ce_unlock_private.item(bl_id,p_id) ORDER BY bl_id) FROM public.ce_unlock_request_bls WHERE request_id=p_id),'[]'),
 'documents',CASE WHEN p_docs THEN coalesce((SELECT jsonb_agg(ce_unlock_private.doc_json(d.id) ORDER BY d.created_at DESC) FROM public.ce_unlock_documents d
 WHERE d.request_id=p_id OR d.id IN(SELECT termo_document_id FROM public.ce_unlock_request_bls WHERE request_id=p_id UNION SELECT procuracao_document_id FROM public.ce_unlock_request_bls WHERE request_id=p_id)),'[]'::jsonb) ELSE '[]'::jsonb END,
 'events',coalesce((SELECT jsonb_agg(jsonb_build_object('id',e.id,'action',e.action,'reason',e.reason,'created_at',e.created_at) ORDER BY e.id) FROM public.ce_unlock_events e WHERE request_id=p_id),'[]'));
END $$;
CREATE FUNCTION ce_unlock_private.vip_json(p_customer bigint,p_docs boolean DEFAULT true) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT jsonb_build_object('customer_id',p_customer,'enabled',coalesce((SELECT enabled FROM public.ce_unlock_vip_customers WHERE customer_id=p_customer),false),
 'version',coalesce((SELECT version FROM public.ce_unlock_vip_customers WHERE customer_id=p_customer),0),
 'termo',ce_unlock_private.annual(p_customer,'termo') IS NOT NULL,'procuracao',ce_unlock_private.annual(p_customer,'procuracao') IS NOT NULL,
 'documents',CASE WHEN p_docs THEN coalesce((SELECT jsonb_agg(ce_unlock_private.doc_json(id) ORDER BY created_at DESC) FROM public.ce_unlock_documents WHERE customer_id=p_customer AND source='vip_annual' AND status<>'uploading'),'[]'::jsonb) ELSE '[]'::jsonb END)
$$;
CREATE FUNCTION ce_unlock_private.list(p_customer bigint,p_filters jsonb,p_page integer,p_requests boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE all_rows jsonb; BEGIN
 IF p_page<1 THEN RAISE EXCEPTION 'Página inválida'; END IF;
 IF p_requests THEN
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',r.id,'protocol',r.protocol,'state',r.state,'version',r.version,'source',r.source,'created_at',r.created_at) ORDER BY r.created_at DESC),'[]') INTO all_rows
 FROM public.ce_unlock_requests r WHERE (p_customer IS NULL OR r.customer_id=p_customer);
 ELSE
 SELECT coalesce(jsonb_agg(j ORDER BY j->>'bl_id'),'[]') INTO all_rows FROM (
 SELECT ce_unlock_private.item(b.id) j FROM public.bls b WHERE trim(coalesce(b.ce_mercante,''))<>''
 AND (p_customer IS NULL OR (b.customer_id=p_customer AND public.bl_has_portal_release(b.id)))
 ) x WHERE (coalesce(p_filters->>'search','')='' OR (j->>'bl_id') ILIKE '%'||(p_filters->>'search')||'%' OR (j->>'ce_mercante') ILIKE '%'||(p_filters->>'search')||'%' OR (j->>'customer_name') ILIKE '%'||(p_filters->>'search')||'%')
 AND (coalesce(p_filters->>'customer_id','')='' OR j->>'customer_id'=p_filters->>'customer_id')
 AND (coalesce(p_filters->>'voyage_id','')='' OR j->>'voyage_id'=p_filters->>'voyage_id')
 AND (coalesce(p_filters->>'pod','')='' OR j->>'pod'=p_filters->>'pod')
 AND (coalesce(p_filters->>'situation','')='' OR j->>'state'=p_filters->>'situation' OR (p_filters->>'situation'='ready' AND (j->>'can_export')::boolean))
 AND (coalesce(p_filters->>'pending_requirement','')='' OR NOT coalesce((j->>(CASE p_filters->>'pending_requirement' WHEN 'taxas' THEN 'paid' WHEN 'bl_fisico' THEN 'delivered' ELSE p_filters->>'pending_requirement' END))::boolean,false));
 END IF;
 RETURN jsonb_build_object('items',coalesce((SELECT jsonb_agg(value) FROM (SELECT value FROM jsonb_array_elements(all_rows) WITH ORDINALITY a(value,n) WHERE n>(p_page-1)*25 AND n<=p_page*25) p),'[]'),'total',jsonb_array_length(all_rows),'page',p_page,'page_size',25);
END $$;
CREATE FUNCTION public.portal_list_ce_unlock_bls(p_filters jsonb DEFAULT '{}',p_page integer DEFAULT 1) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$ SELECT ce_unlock_private.list(public.current_portal_customer_id(),p_filters,p_page) $$;
CREATE FUNCTION public.portal_list_ce_unlock_requests(p_filters jsonb DEFAULT '{}',p_page integer DEFAULT 1) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$ SELECT ce_unlock_private.list(public.current_portal_customer_id(),p_filters,p_page,true) $$;
CREATE FUNCTION public.portal_get_ce_unlock_request(p_request_id uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$ SELECT ce_unlock_private.request_json(p_request_id,public.current_portal_customer_id()) $$;
CREATE FUNCTION public.portal_get_ce_unlock_vip_coverage() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$ SELECT ce_unlock_private.vip_json(public.current_portal_customer_id()) $$;
CREATE FUNCTION public.ce_unlock_read(p_kind text,p_payload jsonb DEFAULT '{}') RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$ DECLARE role_name text; BEGIN
 role_name:=ce_unlock_private.actor();
 CASE p_kind WHEN 'bls' THEN RETURN ce_unlock_private.list(NULL,p_payload->'filters',coalesce((p_payload->>'page')::int,1));
 WHEN 'request' THEN RETURN ce_unlock_private.request_json((p_payload->>'request_id')::uuid,NULL,role_name IN('administrativo','documentacao'));
 WHEN 'vip' THEN RETURN ce_unlock_private.vip_json((p_payload->>'customer_id')::bigint,role_name IN('administrativo','documentacao'));
 WHEN 'exports' THEN PERFORM ce_unlock_private.actor(true); RETURN coalesce((SELECT jsonb_agg(to_jsonb(e) ORDER BY created_at DESC) FROM public.ce_unlock_exports e),'[]');
 WHEN 'model' THEN RETURN (SELECT ce_unlock_private.doc_json(id) FROM public.ce_unlock_documents WHERE source='model' AND status='approved' ORDER BY created_at DESC LIMIT 1);
 ELSE RAISE EXCEPTION 'Leitura inválida'; END CASE;
END $$;
CREATE FUNCTION public.portal_get_ce_unlock_model() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$ BEGIN PERFORM public.current_portal_customer_id(); RETURN (SELECT ce_unlock_private.doc_json(id) FROM public.ce_unlock_documents WHERE source='model' AND status='approved' ORDER BY created_at DESC LIMIT 1); END $$;
CREATE FUNCTION ce_unlock_private.command(p_action text,p_payload jsonb,p_portal boolean) RETURNS jsonb
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
 IF d.id IS NULL OR d.status='uploading' THEN RAISE EXCEPTION 'Documento indisponível'; END IF;
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
 UPDATE public.ce_unlock_requests SET state=CASE WHEN p_payload->>'decision'='approved' THEN 'in_review' ELSE 'changes_requested' END,version=version+1,updated_at=now() WHERE id=r.id;
 ELSE
 IF d.source='vip_annual' AND p_payload->>'decision'='approved' THEN
 IF (p_payload->>'valid_until')::date IS DISTINCT FROM make_date((p_payload->>'coverage_year')::int,12,31) OR (p_payload->>'valid_from')::date IS NULL THEN RAISE EXCEPTION 'Validade anual deve terminar em 31/12 do ano informado'; END IF;
 END IF;
 END IF;
 UPDATE public.ce_unlock_documents SET status=p_payload->>'decision',reason=p_payload->>'reason',reviewed_by=auth.uid(),reviewed_at=now(),
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
 v:='[]'; FOREACH bid IN ARRAY ids LOOP item:=ce_unlock_private.item(bid); IF NOT coalesce((item->>'can_export')::boolean,false) THEN RAISE EXCEPTION 'B/L % não apto: %',bid,item->'reasons'; END IF; v:=v||jsonb_build_array(item); END LOOP;
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
CREATE FUNCTION public.ce_unlock_command(p_action text,p_payload jsonb) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$ SELECT ce_unlock_private.command(p_action,p_payload,false) $$;
CREATE FUNCTION public.portal_ce_unlock_command(p_action text,p_payload jsonb) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$ SELECT ce_unlock_private.command(p_action,p_payload,true) $$;
CREATE FUNCTION public.ce_unlock_prepare_upload(p_context jsonb) RETURNS jsonb
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
 WHERE z.customer_id=cid AND (z.source='vip_annual' AND (z.created_at>now()-interval '7 days' OR z.status='approved') OR q.state IN('draft','submitted','in_review','changes_requested'));
 IF total_bytes+(p_context->>'size_bytes')::bigint>104857600 THEN RAISE EXCEPTION 'Quota de documentos ativos de 100 MiB excedida'; END IF;
 INSERT INTO ce_unlock_private.upload_attempts(customer_id,actor_id) VALUES(cid,auth.uid());
 INSERT INTO public.ce_unlock_documents(customer_id,request_id,type,source,storage_path,file_name,size_bytes,uploaded_by)
 VALUES(cid,rid,dtype,src,coalesce(cid::text,'models')||'/'||gen_random_uuid()::text||'.pdf',left(p_context->>'file_name',240),(p_context->>'size_bytes')::bigint,auth.uid()) RETURNING * INTO d;
 RETURN jsonb_build_object('id',d.id,'storage_path',d.storage_path);
END $$;
CREATE FUNCTION public.ce_unlock_finish_upload(p_document_id uuid,p_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE d public.ce_unlock_documents; c bigint; role_name text; m jsonb; BEGIN
 SELECT CASE role WHEN 'operator' THEN 'documentacao' ELSE role END INTO role_name FROM public.user_profiles WHERE id=auth.uid() AND active;
 IF role_name IS NOT NULL THEN PERFORM ce_unlock_private.actor(true); ELSE c:=public.current_portal_customer_id(); END IF;
 SELECT * INTO d FROM public.ce_unlock_documents WHERE id=p_document_id FOR UPDATE;
 IF d.id IS NULL OR d.uploaded_by IS DISTINCT FROM auth.uid() OR d.status<>'uploading' OR (role_name IS NULL AND d.customer_id IS DISTINCT FROM c) THEN RAISE EXCEPTION '42501: Documento não autorizado.' USING ERRCODE='42501'; END IF;
 IF d.source='vip_annual' AND NOT coalesce((SELECT enabled FROM public.ce_unlock_vip_customers WHERE customer_id=d.customer_id),false) THEN RAISE EXCEPTION 'Condição VIP revogada'; END IF;
 IF d.request_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.ce_unlock_requests WHERE id=d.request_id AND state IN('draft','changes_requested')) THEN RAISE EXCEPTION 'Pedido não aceita anexos'; END IF;
 IF to_regclass('storage.objects') IS NULL THEN RAISE EXCEPTION 'Storage indisponível'; END IF;
 EXECUTE 'SELECT metadata FROM storage.objects WHERE bucket_id=$1 AND name=$2' INTO m USING 'ce-unlock-documents',d.storage_path;
 IF m IS NULL OR (m->>'size')::bigint IS DISTINCT FROM d.size_bytes OR m->>'mimetype' IS DISTINCT FROM 'application/pdf' OR length(coalesce(p_hash,''))<>64 THEN RAISE EXCEPTION 'Objeto PDF não confirmado no Storage'; END IF;
 UPDATE public.ce_unlock_documents SET status=CASE WHEN source='model' THEN 'approved' ELSE 'uploaded' END,hash=p_hash WHERE id=d.id;
 IF d.request_id IS NOT NULL THEN
 UPDATE public.ce_unlock_request_bls SET termo_approved=CASE WHEN d.type='termo' THEN false ELSE termo_approved END,
 procuracao_approved=CASE WHEN d.type='procuracao' THEN false ELSE procuracao_approved END WHERE request_id=d.request_id AND confirmed_at IS NULL;
 UPDATE public.ce_unlock_requests SET version=version+1,updated_at=now() WHERE id=d.request_id;
 END IF;
 INSERT INTO public.ce_unlock_events(customer_id,request_id,action,actor_id,payload) VALUES(d.customer_id,d.request_id,'upload_'||d.type,auth.uid(),jsonb_build_object('document_id',d.id));
 RETURN ce_unlock_private.doc_json(d.id);
END $$;
CREATE FUNCTION public.ce_unlock_document_access(p_document_id uuid) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$ DECLARE d public.ce_unlock_documents; c bigint; role_name text; BEGIN
 SELECT CASE role WHEN 'operator' THEN 'documentacao' ELSE role END INTO role_name FROM public.user_profiles WHERE id=auth.uid() AND active;
 IF role_name IS NOT NULL THEN PERFORM ce_unlock_private.actor(true); ELSE c:=public.current_portal_customer_id(); END IF;
 SELECT * INTO d FROM public.ce_unlock_documents WHERE id=p_document_id;
 IF d.id IS NULL OR d.status='uploading' OR (role_name IS NULL AND d.source<>'model' AND d.customer_id IS DISTINCT FROM c) THEN RAISE EXCEPTION '42501: Documento não autorizado.' USING ERRCODE='42501'; END IF;
 RETURN d.storage_path;
END $$;
CREATE FUNCTION public.ce_unlock_cleanup_candidates() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',d.id,'storage_path',d.storage_path)),'[]') FROM public.ce_unlock_documents d LEFT JOIN public.ce_unlock_requests r ON r.id=d.request_id
 WHERE (d.status='uploading' AND d.created_at<now()-interval '1 day') OR (r.state='draft' AND r.created_at<now()-interval '7 days')
 OR (d.created_at<now()-interval '5 years' AND coalesce(r.state,'completed') IN('cancelled','completed') AND NOT EXISTS(SELECT 1 FROM public.ce_unlock_request_bls i JOIN public.ce_unlock_requests q ON q.id=i.request_id WHERE (i.termo_document_id=d.id OR i.procuracao_document_id=d.id) AND q.state NOT IN('cancelled','completed')))
$$;
REVOKE ALL ON FUNCTION public.ce_unlock_cleanup_candidates() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ce_unlock_cleanup_candidates() TO service_role;

CREATE FUNCTION public.portal_inspect_list_ce_unlock_bls(p_customer_id bigint,p_filters jsonb DEFAULT '{}',p_page integer DEFAULT 1) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$ BEGIN PERFORM ce_unlock_private.actor(); IF NOT EXISTS(SELECT 1 FROM public.customers WHERE id=p_customer_id) THEN RAISE EXCEPTION 'Cliente não autorizado' USING ERRCODE='42501'; END IF; RETURN ce_unlock_private.list(p_customer_id,p_filters,p_page); END $$;

CREATE FUNCTION public.portal_inspect_list_ce_unlock_requests(p_customer_id bigint,p_filters jsonb DEFAULT '{}',p_page integer DEFAULT 1) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$ BEGIN PERFORM ce_unlock_private.actor(); IF NOT EXISTS(SELECT 1 FROM public.customers WHERE id=p_customer_id) THEN RAISE EXCEPTION 'Cliente não autorizado' USING ERRCODE='42501'; END IF; RETURN ce_unlock_private.list(p_customer_id,p_filters,p_page,true); END $$;

CREATE FUNCTION public.portal_inspect_get_ce_unlock_request(p_customer_id bigint,p_request_id uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$ BEGIN PERFORM ce_unlock_private.actor(); IF NOT EXISTS(SELECT 1 FROM public.customers WHERE id=p_customer_id) THEN RAISE EXCEPTION 'Cliente não autorizado' USING ERRCODE='42501'; END IF; RETURN ce_unlock_private.request_json(p_request_id,p_customer_id,ce_unlock_private.actor() IN('administrativo','documentacao')); END $$;

CREATE FUNCTION public.portal_inspect_get_ce_unlock_vip_coverage(p_customer_id bigint) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$ BEGIN PERFORM ce_unlock_private.actor(); IF NOT EXISTS(SELECT 1 FROM public.customers WHERE id=p_customer_id) THEN RAISE EXCEPTION 'Cliente não autorizado' USING ERRCODE='42501'; END IF; RETURN ce_unlock_private.vip_json(p_customer_id,ce_unlock_private.actor() IN('administrativo','documentacao')); END $$;

CREATE FUNCTION public.portal_inspect_get_ce_unlock_model(p_customer_id bigint) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$ BEGIN PERFORM ce_unlock_private.actor(); IF NOT EXISTS(SELECT 1 FROM public.customers WHERE id=p_customer_id) THEN RAISE EXCEPTION 'Cliente não autorizado' USING ERRCODE='42501'; END IF; RETURN (SELECT ce_unlock_private.doc_json(id) FROM public.ce_unlock_documents WHERE source='model' AND status='approved' ORDER BY created_at DESC LIMIT 1); END $$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA ce_unlock_private FROM PUBLIC, anon, authenticated;
DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND (p.proname LIKE 'ce_unlock_%' OR p.proname LIKE 'portal_%ce_unlock_%') LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated',f.signature);
 IF f.signature::text NOT LIKE '%ce_unlock_cleanup_candidates%' THEN
 EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated',f.signature);
 END IF;
 END LOOP;
END $$;
COMMIT;
