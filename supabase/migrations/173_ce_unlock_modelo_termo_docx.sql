-- 173: modelo do termo de devolução em DOCX.
--
-- O cliente baixa o modelo no Portal, preenche no editor de texto, assina e
-- anexa ao pedido em PDF. Só o modelo publicado pelo desk (source='model')
-- passa a ser .docx; termo, procuração e documentos anuais continuam
-- exclusivamente PDF. Decisão do responsável em 2026-10-10.
--
-- Altera apenas funções (ce_unlock_prepare_upload, de 148, e
-- ce_unlock_finish_upload, de 139); não reescreve linhas. Um modelo PDF já
-- publicado continua baixável até ser substituído.
BEGIN;
CREATE OR REPLACE FUNCTION public.ce_unlock_prepare_upload(p_context jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE cid bigint; rid uuid; role_name text; dtype text; src text; d public.ce_unlock_documents; r public.ce_unlock_requests; total_bytes bigint; ext text;
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
 -- O modelo é baixado pelo cliente para preencher (.docx); o que o cliente anexa é sempre PDF.
 ext:=CASE WHEN src='model' THEN '.docx' ELSE '.pdf' END;
 IF dtype NOT IN('termo','procuracao','model') OR trim(coalesce(p_context->>'file_name',''))='' OR coalesce((p_context->>'size_bytes')::bigint,0) NOT BETWEEN 1 AND 10485760 THEN RAISE EXCEPTION '% obrigatório, até 10 MiB',CASE WHEN src='model' THEN 'DOCX' ELSE 'PDF' END; END IF;
 IF lower(p_context->>'file_name') NOT LIKE '%'||ext THEN RAISE EXCEPTION '% obrigatório',CASE WHEN src='model' THEN 'Modelo em DOCX' ELSE 'PDF' END; END IF;
 IF cid IS NOT NULL THEN PERFORM 1 FROM public.customers WHERE id=cid FOR UPDATE; ELSE PERFORM pg_advisory_xact_lock(hashtextextended(auth.uid()::text||'ce-model-upload',0)); END IF;
 IF (SELECT count(*) FROM ce_unlock_private.upload_attempts WHERE (cid IS NOT NULL AND customer_id=cid OR cid IS NULL AND actor_id=auth.uid()) AND created_at>now()-interval '24 hours')>=20 THEN RAISE EXCEPTION 'Limite de 20 uploads por 24 horas'; END IF;
 SELECT coalesce(sum(z.size_bytes),0) INTO total_bytes FROM public.ce_unlock_documents z LEFT JOIN public.ce_unlock_requests q ON q.id=z.request_id
 WHERE z.purged_at IS NULL AND z.cleanup_claimed_at IS NULL AND z.customer_id=cid AND (z.source='vip_annual' AND (z.created_at>now()-interval '7 days' OR z.status='approved') OR q.state IN('draft','submitted','in_review','changes_requested'));
 IF total_bytes+(p_context->>'size_bytes')::bigint>104857600 THEN RAISE EXCEPTION 'Quota de documentos ativos de 100 MiB excedida'; END IF;
 INSERT INTO ce_unlock_private.upload_attempts(customer_id,actor_id) VALUES(cid,auth.uid());
 INSERT INTO public.ce_unlock_documents(customer_id,request_id,type,source,storage_path,file_name,size_bytes,uploaded_by)
 VALUES(cid,rid,dtype,src,coalesce(cid::text,'models')||'/'||gen_random_uuid()::text||ext,left(p_context->>'file_name',240),(p_context->>'size_bytes')::bigint,auth.uid()) RETURNING * INTO d;
 RETURN jsonb_build_object('id',d.id,'storage_path',d.storage_path);
END $$;
CREATE OR REPLACE FUNCTION public.ce_unlock_finish_upload(p_document_id uuid,p_hash text) RETURNS jsonb
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
 IF m IS NULL OR (m->>'size')::bigint IS DISTINCT FROM d.size_bytes OR m->>'mimetype' IS DISTINCT FROM (CASE WHEN d.source='model' THEN 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ELSE 'application/pdf' END) OR length(coalesce(p_hash,''))<>64 THEN RAISE EXCEPTION 'Arquivo não confirmado no Storage'; END IF;
 UPDATE public.ce_unlock_documents SET status=CASE WHEN source='model' THEN 'approved' ELSE 'uploaded' END,hash=p_hash WHERE id=d.id;
 IF d.request_id IS NOT NULL THEN
 UPDATE public.ce_unlock_request_bls SET termo_approved=CASE WHEN d.type='termo' THEN false ELSE termo_approved END,
 procuracao_approved=CASE WHEN d.type='procuracao' THEN false ELSE procuracao_approved END WHERE request_id=d.request_id AND confirmed_at IS NULL;
 UPDATE public.ce_unlock_requests SET version=version+1,updated_at=now() WHERE id=d.request_id;
 END IF;
 INSERT INTO public.ce_unlock_events(customer_id,request_id,action,actor_id,payload) VALUES(d.customer_id,d.request_id,'upload_'||d.type,auth.uid(),jsonb_build_object('document_id',d.id));
 RETURN ce_unlock_private.doc_json(d.id);
END $$;

COMMIT;
