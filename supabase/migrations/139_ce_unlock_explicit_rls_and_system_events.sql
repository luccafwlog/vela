-- CE workflow: explicit RLS declarations and identifiable system actor for draft expiration.
BEGIN;
ALTER TABLE public.ce_unlock_vip_customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ce_unlock_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ce_unlock_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ce_unlock_request_bls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ce_unlock_bl_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ce_unlock_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ce_unlock_exports ENABLE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION public.ce_unlock_cleanup_claim(p_document_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE d public.ce_unlock_documents; r public.ce_unlock_requests; BEGIN
 SELECT * INTO d FROM public.ce_unlock_documents WHERE id=p_document_id;
 -- Same order as request commands: request before associated documents.
 IF d.request_id IS NOT NULL THEN
 SELECT * INTO r FROM public.ce_unlock_requests WHERE id=d.request_id FOR UPDATE;
 PERFORM 1 FROM public.ce_unlock_documents WHERE request_id=r.id ORDER BY id FOR UPDATE;
 END IF;
 SELECT * INTO d FROM public.ce_unlock_documents WHERE id=p_document_id FOR UPDATE;
 IF d.id IS NULL OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(public.ce_unlock_cleanup_candidates()) x WHERE x->>'id'=p_document_id::text) THEN RETURN NULL; END IF;
 IF r.state='draft' AND r.created_at<now()-interval '7 days' THEN
 UPDATE public.ce_unlock_requests SET state='cancelled',version=version+1,updated_at=now() WHERE id=r.id;
 UPDATE public.ce_unlock_request_bls SET active=false WHERE request_id=r.id;
 UPDATE public.ce_unlock_documents SET cleanup_claimed_at=now(),status='revoked',version=version+1 WHERE request_id=r.id AND purged_at IS NULL AND cleanup_claimed_at IS NULL;
 INSERT INTO public.ce_unlock_events(customer_id,request_id,action,actor_id,reason) VALUES(r.customer_id,r.id,'expire_draft','00000000-0000-0000-0000-000000000000','Rascunho abandonado há mais de sete dias');
 ELSE
 UPDATE public.ce_unlock_documents SET cleanup_claimed_at=coalesce(cleanup_claimed_at,now()),status='revoked',version=version+1 WHERE id=d.id;
 END IF;
 RETURN jsonb_build_object('id',d.id,'storage_path',d.storage_path);
END $$;
COMMIT;
