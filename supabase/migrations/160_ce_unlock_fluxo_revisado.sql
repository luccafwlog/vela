-- Desbloqueio de CE: revisão do fluxo aprovada em 2026-10-07
-- (docs/spec/2026-10-07-desbloqueio-ce-revisao-fluxo-design.md).
--  * análise documental por solicitação (sem seleção de B/L) com recusa motivada;
--  * conclusão da solicitação quando os quatro requisitos de todos os B/Ls estão atendidos;
--  * cancelamento pelo cliente enquanto a solicitação estiver em rascunho/correção;
--  * exportar = registrar o envio; saem 'sent' e 'confirm' (a ZPT desbloqueia sozinha);
--  * conciliação com o arquivo "Exportar Tela" da ZPT, visível só ao desk;
--  * prazo (SLA) por B/L, aviso no sino e fila de e-mail para a caixa Documentação e Operação.
-- Forward-only. Colunas e tabelas novas; confirmações externas legadas permanecem
-- preservadas, apenas deixam de ser criadas. Reversão operacional: suspender a UI nova;
-- nada é apagado. Não há reescrita de linhas existentes pela migration.
BEGIN;

-- ---------------------------------------------------------------- estrutura
ALTER TABLE public.ce_unlock_request_bls
 ADD COLUMN exported_at timestamptz,
 ADD COLUMN exported_by uuid,
 ADD COLUMN export_id uuid REFERENCES public.ce_unlock_exports(id);

CREATE TABLE public.ce_unlock_zpt_status (
 bl_id text PRIMARY KEY REFERENCES public.bls(id), ce_mercante text NOT NULL,
 status text NOT NULL CHECK(status IN('unlocked','divergent')),
 zpt_status text NOT NULL, description text, pending text[] NOT NULL DEFAULT '{}',
 without_export boolean NOT NULL DEFAULT false, zpt_updated_at timestamptz,
 reconciled_at timestamptz NOT NULL DEFAULT now(), reconciled_by uuid NOT NULL
);

CREATE TABLE public.ce_unlock_email_outbox (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 customer_id bigint NOT NULL REFERENCES public.customers(id),
 request_id uuid NOT NULL REFERENCES public.ce_unlock_requests(id),
 kind text NOT NULL CHECK(kind IN('changes_requested','documentation_validated')),
 subject text NOT NULL, body text NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN('pending','sent','skipped','failed')),
 attempts integer NOT NULL DEFAULT 0, last_error text, done_recipients text[] NOT NULL DEFAULT '{}',
 created_at timestamptz NOT NULL DEFAULT now(), processed_at timestamptz
);
CREATE INDEX ce_unlock_email_outbox_pending ON public.ce_unlock_email_outbox(id) WHERE status='pending';

ALTER TABLE public.ce_unlock_zpt_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ce_unlock_email_outbox ENABLE ROW LEVEL SECURITY;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['ce_unlock_zpt_status','ce_unlock_email_outbox'] LOOP
 EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated',t);
 EXECUTE format('GRANT ALL ON public.%I TO service_role',t);
 END LOOP;
END $$;
GRANT USAGE, SELECT ON SEQUENCE public.ce_unlock_email_outbox_id_seq TO service_role;

-- ---------------------------------------------------------------- prazo (SLA)
-- Janela da manhã (início antes das 12:00): 17:00 do mesmo dia útil. Janela da tarde: 12:30
-- do próximo dia útil. Sábado/domingo valem como antes das 08:00 de segunda. Sem feriados.
-- Espelha src/services/ceUnlockSla.ts; o teste SQL confere os dois com os mesmos casos.
CREATE FUNCTION ce_unlock_private.sla_deadline(p_start timestamptz) RETURNS timestamptz
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE l timestamp := p_start AT TIME ZONE 'America/Sao_Paulo'; d date := (p_start AT TIME ZONE 'America/Sao_Paulo')::date;
 dow integer := extract(isodow FROM (p_start AT TIME ZONE 'America/Sao_Paulo'))::integer; slot time := time '17:00';
BEGIN
 IF dow IN(6,7) THEN d:=d+(8-dow);
 ELSIF l::time>=time '12:00' THEN d:=d+CASE WHEN dow=5 THEN 3 ELSE 1 END; slot:=time '12:30'; END IF;
 RETURN (d+slot) AT TIME ZONE 'America/Sao_Paulo';
END $$;

-- Campos que só o desk vê: envio/conciliação com a ZPT. O Portal nunca os recebe.
CREATE FUNCTION ce_unlock_private.portal_view(j jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
 SELECT j-'export_state'-'exported_at'-'zpt_status'-'zpt_description'-'zpt_pending'-'zpt_updated_at'-'zpt_without_export' $$;

-- ---------------------------------------------------------------- B/L (item)
CREATE OR REPLACE FUNCTION ce_unlock_private.item(p_bl text,p_request uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE b public.bls; i public.ce_unlock_request_bls; r public.ce_unlock_requests; zs public.ce_unlock_zpt_status; paid boolean; td boolean; pd boolean; delivered boolean;
 vip boolean; reasons text[] := '{}'; eligible boolean; confirmed boolean; vs text; sla timestamptz;
BEGIN
 SELECT * INTO b FROM public.bls WHERE id=p_bl;
 SELECT * INTO i FROM public.ce_unlock_request_bls WHERE bl_id=p_bl AND (p_request IS NULL OR request_id=p_request)
 ORDER BY active DESC,confirmed_at DESC NULLS LAST,request_id LIMIT 1;
 SELECT * INTO r FROM public.ce_unlock_requests WHERE id=i.request_id;
 SELECT * INTO zs FROM public.ce_unlock_zpt_status WHERE bl_id=p_bl AND ce_mercante IS NOT DISTINCT FROM b.ce_mercante;
 SELECT coalesce(enabled,false) INTO vip FROM public.ce_unlock_vip_customers WHERE customer_id=b.customer_id; vip:=coalesce(vip,false);
 SELECT coalesce(bool_and(status='settled' AND balance_brl=0 AND original_amount_brl>0 AND settled_amount_brl>=original_amount_brl-correction_amount_brl
 AND EXISTS(SELECT 1 FROM public.ledger_settlements s WHERE s.receivable_id=x.id)),false)
 INTO paid FROM public.bl_receivables x WHERE x.bl_id=p_bl AND x.status<>'void'
 AND x.source='local_charges' AND x.customer_id=b.customer_id;
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
 (SELECT max(s.created_at) FROM public.ledger_settlements s JOIN public.bl_receivables x ON x.id=s.receivable_id WHERE x.bl_id=p_bl AND x.status<>'void'));
 END IF;
 IF r.id IS NOT NULL AND r.customer_id IS DISTINCT FROM b.customer_id THEN reasons:=array_append(reasons,'Cliente do B/L alterado: solicitação anterior inaplicável'); END IF;
 IF b.cancelled_at IS NOT NULL THEN reasons:=array_append(reasons,'B/L cancelado'); END IF;
 IF trim(coalesce(b.ce_mercante,''))='' THEN reasons:=array_append(reasons,'CE Mercante não informado'); END IF;
 IF NOT paid THEN reasons:=array_append(reasons,'Taxas locais sem liquidação integral confirmada'); END IF;
 IF r.id IS NOT NULL AND NOT td THEN reasons:=array_append(reasons,'Termo de devolução pendente, vencido ou revogado'); END IF;
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
 'can_export',eligible AND r.customer_id=b.customer_id AND td AND pd AND delivered AND r.state IN('submitted','in_review','changes_requested','completed') AND i.active AND i.ce_at_request=b.ce_mercante AND NOT confirmed,
 'export_state',CASE WHEN confirmed THEN 'confirmed' WHEN i.exported_at IS NOT NULL THEN 'exported' ELSE 'not_exported' END,
 'exported_at',i.exported_at,'sla_started_at',sla,
 'zpt_status',zs.status,'zpt_description',zs.description,'zpt_pending',to_jsonb(zs.pending),'zpt_updated_at',zs.zpt_updated_at,'zpt_without_export',zs.without_export,
 'reasons',to_jsonb(reasons));
END $$;

CREATE OR REPLACE FUNCTION ce_unlock_private.visible_item(p_bl text,p_customer bigint) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE j jsonb; owner_id bigint; BEGIN
 j:=ce_unlock_private.item(p_bl);
 IF p_customer IS NOT NULL AND j->>'request_id' IS NOT NULL THEN
 SELECT customer_id INTO owner_id FROM public.ce_unlock_requests WHERE id=(j->>'request_id')::uuid;
 IF owner_id IS DISTINCT FROM p_customer THEN
 j:=j||jsonb_build_object('request_id',NULL,'protocol',NULL,'requested_at',NULL,'state','no_request','version',NULL,'source','request','termo',false,'procuracao',false,'confirmed',false,'export_state','not_exported','can_export',false,'sla_started_at',NULL);
 END IF; END IF;
 IF p_customer IS NOT NULL THEN j:=ce_unlock_private.portal_view(j); END IF;
 RETURN j;
END $$;

CREATE OR REPLACE FUNCTION ce_unlock_private.list(p_customer bigint,p_filters jsonb,p_page integer,p_requests boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE all_rows jsonb; BEGIN
 IF p_page<1 THEN RAISE EXCEPTION 'Página inválida'; END IF;
 IF p_requests THEN
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',r.id,'protocol',r.protocol,'state',r.state,'version',r.version,'source',r.source,'created_at',r.created_at) ORDER BY r.created_at DESC),'[]') INTO all_rows
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
 OR (p_filters->>'situation'='divergent' AND j->>'zpt_status'='divergent'))
 AND (coalesce(p_filters->>'pending_requirement','')='' OR NOT coalesce((j->>(CASE p_filters->>'pending_requirement' WHEN 'taxas' THEN 'paid' WHEN 'bl_fisico' THEN 'delivered' ELSE p_filters->>'pending_requirement' END))::boolean,false));
 END IF;
 RETURN jsonb_build_object('items',coalesce((SELECT jsonb_agg(value) FROM (SELECT value FROM jsonb_array_elements(all_rows) WITH ORDINALITY a(value,n) WHERE n>(p_page-1)*25 AND n<=p_page*25) p),'[]'),'total',jsonb_array_length(all_rows),'page',p_page,'page_size',25);
END $$;

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
 'events',coalesce((SELECT jsonb_agg(jsonb_build_object('id',e.id,'action',e.action,'reason',CASE WHEN e.action='confirm' AND NOT (p_customer IS NULL AND p_docs) THEN NULL ELSE e.reason END,'created_at',e.created_at) ORDER BY e.id) FROM public.ce_unlock_events e WHERE (request_id=p_id OR (e.request_id IS NULL AND e.bl_id IN (SELECT bl_id FROM public.ce_unlock_request_bls WHERE request_id=p_id)))),'[]'));
END $$;

-- Fila "Solicitações": uma linha por pedido de documentos por solicitação ainda não validados.
CREATE FUNCTION ce_unlock_private.review_queue(p_page integer) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE rows_ jsonb; BEGIN
 IF p_page<1 THEN RAISE EXCEPTION 'Página inválida'; END IF;
 SELECT coalesce(jsonb_agg(q ORDER BY q->>'sla_started_at',q->>'protocol'),'[]') INTO rows_ FROM (
 SELECT jsonb_build_object('id',r.id,'protocol',r.protocol,'state',r.state,'version',r.version,'created_at',r.created_at,
 'customer_name',c.name,'cnpj_cpf',c.cnpj_cpf,
 'sla_started_at',(SELECT max(e.created_at) FROM public.ce_unlock_events e WHERE e.request_id=r.id AND e.action='submit'),
 'bl_ids',(SELECT jsonb_agg(i.bl_id ORDER BY i.bl_id) FROM public.ce_unlock_request_bls i WHERE i.request_id=r.id AND i.active),
 'termo_status',(SELECT d.status FROM public.ce_unlock_documents d WHERE d.request_id=r.id AND d.type='termo' AND d.hash IS NOT NULL AND d.status<>'uploading' ORDER BY d.created_at DESC LIMIT 1),
 'procuracao_status',(SELECT d.status FROM public.ce_unlock_documents d WHERE d.request_id=r.id AND d.type='procuracao' AND d.hash IS NOT NULL AND d.status<>'uploading' ORDER BY d.created_at DESC LIMIT 1)) q
 FROM public.ce_unlock_requests r JOIN public.customers c ON c.id=r.customer_id
 WHERE r.source='request' AND r.state IN('submitted','in_review','changes_requested')
 AND EXISTS(SELECT 1 FROM public.ce_unlock_request_bls i WHERE i.request_id=r.id AND i.active AND NOT (i.termo_approved AND i.procuracao_approved))
 ) x;
 RETURN jsonb_build_object('items',coalesce((SELECT jsonb_agg(value) FROM (SELECT value FROM jsonb_array_elements(rows_) WITH ORDINALITY a(value,n) WHERE n>(p_page-1)*25 AND n<=p_page*25) p),'[]'),'total',jsonb_array_length(rows_),'page',p_page,'page_size',25);
END $$;

CREATE OR REPLACE FUNCTION public.ce_unlock_read(p_kind text,p_payload jsonb DEFAULT '{}') RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$ DECLARE role_name text; BEGIN
 role_name:=ce_unlock_private.actor();
 CASE p_kind WHEN 'bls' THEN RETURN ce_unlock_private.list(NULL,p_payload->'filters',coalesce((p_payload->>'page')::int,1));
 WHEN 'review_queue' THEN RETURN ce_unlock_private.review_queue(coalesce((p_payload->>'page')::int,1));
 WHEN 'request' THEN RETURN ce_unlock_private.request_json((p_payload->>'request_id')::uuid,NULL,role_name IN('administrativo','documentacao'));
 WHEN 'vip' THEN RETURN ce_unlock_private.vip_json((p_payload->>'customer_id')::bigint,role_name IN('administrativo','documentacao'));
 WHEN 'exports' THEN PERFORM ce_unlock_private.actor(true); RETURN coalesce((SELECT jsonb_agg(to_jsonb(e) ORDER BY created_at DESC) FROM public.ce_unlock_exports e),'[]');
 WHEN 'model' THEN RETURN (SELECT ce_unlock_private.doc_json(id) FROM public.ce_unlock_documents WHERE source='model' AND status='approved' ORDER BY created_at DESC LIMIT 1);
 ELSE RAISE EXCEPTION 'Leitura inválida'; END CASE;
END $$;

-- ---------------------------------------------------------------- avisos ao cliente
-- Sino do Portal (tipo 'system') + fila de e-mail para a caixa Documentação e Operação.
-- O envio real é feito pela função ce-unlock-notify-email; nada é enviado de dentro da RPC.
CREATE FUNCTION ce_unlock_private.notify(p_request uuid,p_kind text,p_text text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r public.ce_unlock_requests; title text; msg text; BEGIN
 SELECT * INTO r FROM public.ce_unlock_requests WHERE id=p_request;
 IF r.id IS NULL THEN RETURN; END IF;
 IF p_kind='changes_requested' THEN
 title:='Desbloqueio de CE: correção solicitada';
 msg:='A solicitação '||r.protocol||' precisa de correção. Motivo: '||coalesce(p_text,'não informado')||'. Reenvie os documentos pelo Portal.';
 ELSE
 title:='Desbloqueio de CE: documentação validada';
 msg:='A documentação da solicitação '||r.protocol||' foi validada. Prazo para o desbloqueio: até '||p_text||'. Consulte o Mercante para verificar o desbloqueio.';
 END IF;
 INSERT INTO public.portal_notifications(customer_id,type,title,message,link) VALUES(r.customer_id,'system',title,msg,'/portal/desbloqueio-ce?pedido='||r.id);
 INSERT INTO public.ce_unlock_email_outbox(customer_id,request_id,kind,subject,body) VALUES(r.customer_id,r.id,p_kind,title,msg);
END $$;

-- Conclusão: todos os B/Ls ativos com os quatro requisitos. Reabre se um requisito for desfeito.
-- ponytail: avaliada nos comandos (aprovação, entrega, VIP, envio); uma liquidação posterior,
-- sozinha, só é refletida no próximo comando. Upgrade: trigger em ledger_settlements.
CREATE FUNCTION ce_unlock_private.refresh_completion(p_request uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r public.ce_unlock_requests; bid text; ready boolean:=true; n integer:=0; started timestamptz; it jsonb; BEGIN
 SELECT * INTO r FROM public.ce_unlock_requests WHERE id=p_request FOR UPDATE;
 IF r.id IS NULL OR r.state NOT IN('submitted','in_review','changes_requested','completed') THEN RETURN; END IF;
 FOR bid IN SELECT bl_id FROM public.ce_unlock_request_bls WHERE request_id=r.id AND active ORDER BY bl_id LOOP
 n:=n+1; it:=ce_unlock_private.item(bid,r.id);
 IF NOT coalesce((it->>'can_export')::boolean,false) THEN ready:=false; EXIT; END IF;
 started:=greatest(started,(it->>'sla_started_at')::timestamptz);
 END LOOP;
 IF n=0 THEN RETURN; END IF;
 IF ready AND r.state<>'completed' THEN
 UPDATE public.ce_unlock_requests SET state='completed',version=version+1,updated_at=now() WHERE id=r.id;
 INSERT INTO public.ce_unlock_events(customer_id,request_id,action,actor_id) VALUES(r.customer_id,r.id,'complete',coalesce(auth.uid(),'00000000-0000-0000-0000-000000000000'));
 PERFORM ce_unlock_private.notify(r.id,'documentation_validated',to_char(ce_unlock_private.sla_deadline(coalesce(started,now())) AT TIME ZONE 'America/Sao_Paulo','DD/MM "às" HH24:MI'));
 ELSIF NOT ready AND r.state='completed' THEN
 UPDATE public.ce_unlock_requests SET state='in_review',version=version+1,updated_at=now() WHERE id=r.id;
 INSERT INTO public.ce_unlock_events(customer_id,request_id,action,actor_id) VALUES(r.customer_id,r.id,'reopen',coalesce(auth.uid(),'00000000-0000-0000-0000-000000000000'));
 END IF;
END $$;

-- ---------------------------------------------------------------- comandos
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
 IF trim(coalesce(p_payload->>'reason',''))='' OR r.state='cancelled' THEN RAISE EXCEPTION 'Cancelamento exige pedido ativo e motivo'; END IF;
 END IF;
 IF EXISTS(SELECT 1 FROM public.ce_unlock_request_bls WHERE request_id=r.id AND exported_at IS NOT NULL) THEN
 RAISE EXCEPTION '%',CASE WHEN p_portal THEN 'Pedido não pode ser cancelado pelo cliente. Contate a agência.' ELSE 'Pedido com B/L já exportado para a ZPT: confirme o tratamento externo antes de cancelar' END; END IF;
 UPDATE public.ce_unlock_requests SET state='cancelled',version=version+1,updated_at=now() WHERE id=r.id;
 UPDATE public.ce_unlock_request_bls SET active=false WHERE request_id=r.id;
 result:=ce_unlock_private.request_json(r.id);
 WHEN 'reconfirm_ce' THEN
 bid:=p_payload->>'bl_id'; IF trim(coalesce(p_payload->>'reason',''))='' THEN RAISE EXCEPTION 'Motivo obrigatório'; END IF;
 UPDATE public.ce_unlock_request_bls SET ce_at_request=(SELECT ce_mercante FROM public.bls WHERE id=bid),termo_approved=false,procuracao_approved=false,exported_at=NULL
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
 ELSE RAISE EXCEPTION 'Ação inválida'; END CASE;
 INSERT INTO public.ce_unlock_events(customer_id,request_id,bl_id,action,reason,actor_id,payload) VALUES(cid,r.id,bid,p_action,coalesce(ev_reason,p_payload->>'reason'),auth.uid(),p_payload);
 INSERT INTO ce_unlock_private.receipts(actor_id,action,request_key,payload,result) VALUES(auth.uid(),p_action,key,p_payload,result);
 RETURN result;
END $$;

-- ---------------------------------------------------------------- conciliação com a ZPT
-- O CE casa ignorando zeros à esquerda: a planilha da ZPT guarda o CE como número e os perde.
-- Recebe só o essencial de cada linha do "Exportar Tela" (CE, status, descrição, data,
-- colunas ainda em "Não"). Nome/CPF do operador da ZPT e horários dos checks nunca chegam aqui.
CREATE FUNCTION public.ce_unlock_reconcile(p_rows jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE total integer; unlocked integer; divergent integer; ignored integer; unknown integer; summary jsonb; BEGIN
 PERFORM ce_unlock_private.actor(true);
 IF jsonb_typeof(p_rows)<>'array' OR jsonb_array_length(p_rows) NOT BETWEEN 1 AND 20000 THEN RAISE EXCEPTION 'Arquivo da ZPT vazio ou grande demais (máximo de 20000 linhas)'; END IF;
 DROP TABLE IF EXISTS pg_temp.zpt_rows;
 CREATE TEMP TABLE zpt_rows ON COMMIT DROP AS
 SELECT DISTINCT ON (b.id) b.id bl_id, b.ce_mercante ce, s.zpt_status, s.descr, s.upd, s.pend,
 lower(s.zpt_status)='desbloqueado' is_unlocked,
 EXISTS(SELECT 1 FROM public.ce_unlock_request_bls i WHERE i.bl_id=b.id AND i.active AND i.exported_at IS NOT NULL) was_exported
 FROM (SELECT btrim(x->>'ce') ce, btrim(coalesce(x->>'status','')) zpt_status, nullif(btrim(x->>'description'),'') descr,
 nullif(x->>'updated_at','')::timestamptz upd, coalesce(ARRAY(SELECT jsonb_array_elements_text(x->'pending')),'{}'::text[]) pend
 FROM jsonb_array_elements(p_rows) x) s
 JOIN public.bls b ON ltrim(btrim(b.ce_mercante),'0')=ltrim(s.ce,'0') AND b.cancelled_at IS NULL
 WHERE s.zpt_status<>'' AND s.ce<>'' ORDER BY b.id, s.upd DESC NULLS LAST;
 INSERT INTO public.ce_unlock_zpt_status(bl_id,ce_mercante,status,zpt_status,description,pending,without_export,zpt_updated_at,reconciled_by)
 SELECT bl_id,ce,CASE WHEN is_unlocked THEN 'unlocked' ELSE 'divergent' END,zpt_status,descr,pend,is_unlocked AND NOT was_exported,upd,auth.uid()
 FROM zpt_rows WHERE is_unlocked OR was_exported
 ON CONFLICT (bl_id) DO UPDATE SET ce_mercante=EXCLUDED.ce_mercante,status=EXCLUDED.status,zpt_status=EXCLUDED.zpt_status,description=EXCLUDED.description,
 pending=EXCLUDED.pending,without_export=EXCLUDED.without_export,zpt_updated_at=EXCLUDED.zpt_updated_at,reconciled_at=now(),reconciled_by=EXCLUDED.reconciled_by;
 -- Bloqueado na ZPT e nunca exportado pelo Vela: nada a conciliar; registro antigo de "desbloqueado" fica obsoleto.
 DELETE FROM public.ce_unlock_zpt_status z USING zpt_rows r WHERE z.bl_id=r.bl_id AND NOT r.is_unlocked AND NOT r.was_exported;
 SELECT count(*) FILTER (WHERE is_unlocked), count(*) FILTER (WHERE NOT is_unlocked AND was_exported), count(*) FILTER (WHERE NOT is_unlocked AND NOT was_exported)
 INTO unlocked,divergent,ignored FROM zpt_rows;
 total:=jsonb_array_length(p_rows);
 SELECT count(*) INTO unknown FROM jsonb_array_elements(p_rows) x WHERE NOT EXISTS(SELECT 1 FROM public.bls b WHERE ltrim(btrim(b.ce_mercante),'0')=ltrim(btrim(x->>'ce'),'0') AND b.cancelled_at IS NULL);
 summary:=jsonb_build_object('rows',total,'unlocked',unlocked,'divergent',divergent,'ignored',ignored,'unknown_ce',unknown);
 INSERT INTO public.ce_unlock_events(action,actor_id,payload) VALUES('reconcile',auth.uid(),summary);
 RETURN summary;
END $$;

-- ---------------------------------------------------------------- fila de e-mail (service_role)
CREATE FUNCTION public.ce_unlock_email_pending(p_limit integer DEFAULT 20) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT coalesce(jsonb_agg(to_jsonb(o) ORDER BY o.id),'[]') FROM (SELECT id,customer_id,request_id,kind,subject,body,done_recipients,attempts
 FROM public.ce_unlock_email_outbox WHERE status='pending' AND attempts<5 ORDER BY id LIMIT greatest(1,least(p_limit,100))) o $$;
CREATE FUNCTION public.ce_unlock_email_finish(p_id bigint,p_status text,p_done text[],p_error text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ BEGIN
 IF p_status NOT IN('pending','sent','skipped','failed') THEN RAISE EXCEPTION 'Estado inválido'; END IF;
 UPDATE public.ce_unlock_email_outbox SET status=p_status,done_recipients=coalesce(p_done,done_recipients),last_error=left(p_error,300),
 attempts=attempts+1,processed_at=CASE WHEN p_status='pending' THEN processed_at ELSE now() END WHERE id=p_id;
END $$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA ce_unlock_private FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ce_unlock_reconcile(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ce_unlock_reconcile(jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.ce_unlock_email_pending(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ce_unlock_email_finish(bigint,text,text[],text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ce_unlock_email_pending(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.ce_unlock_email_finish(bigint,text,text[],text) TO service_role;
COMMIT;
