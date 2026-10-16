-- 296: Desbloqueio de CE, aba "Andamento dos B/Ls" e autor no Histórico
-- (lote 3 da identidade visual, rodada 2 aprovada em 2026-10-16).
--
-- Problema:
--   1. Os cartões da aba filtram a lista por situação, mas
--      `ce_unlock_private.list` (160) só conhecia "aptos não exportados" e
--      "divergentes": não havia como listar nem contar os exportados que
--      aguardam a ZPT nem os desbloqueados.
--   2. O Histórico do detalhe ganhou a coluna "Por", e `request_json` (161)
--      não dizia quem fez cada registro.
--
-- Mudança:
--   1. `situation` aceita `exported` (exportado pelo Vela, sem retorno da
--      ZPT) e `unlocked` (desbloqueado na ZPT). Os demais valores, a ordem,
--      a paginação e o formato não mudam.
--   2. Cada evento do detalhe interno leva `actor`: o nome do usuário
--      interno, "Cliente pelo Portal" para conta do Portal ou "Sistema" para
--      o usuário técnico. O Portal (p_customer não nulo) não recebe o campo.
--
-- Só redefine as funções; não reescreve nem apaga linhas.
-- Rollback: reaplicar `ce_unlock_private.list` da migration 160 e
-- `ce_unlock_private.request_json` da migration 161.

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
 OR (p_filters->>'situation'='exported' AND j->>'export_state'='exported' AND j->>'zpt_status' IS NULL)
 OR (p_filters->>'situation'='unlocked' AND j->>'zpt_status'='unlocked')
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
 'events',coalesce((SELECT jsonb_agg(jsonb_build_object('id',e.id,'action',e.action,'reason',CASE WHEN e.action='confirm' AND NOT (p_customer IS NULL AND p_docs) THEN NULL ELSE e.reason END,'created_at',e.created_at)
 || CASE WHEN p_customer IS NULL THEN jsonb_build_object('actor',coalesce(
   (SELECT up.full_name FROM public.user_profiles up WHERE up.id=e.actor_id),
   CASE WHEN EXISTS(SELECT 1 FROM public.customer_portal_accounts a WHERE a.auth_user_id=e.actor_id) THEN 'Cliente pelo Portal' END,
   CASE WHEN e.actor_id='00000000-0000-0000-0000-000000000000' THEN 'Sistema' END)) ELSE '{}'::jsonb END ORDER BY e.id) FROM public.ce_unlock_events e WHERE (request_id=p_id OR (e.request_id IS NULL AND e.bl_id IN (SELECT bl_id FROM public.ce_unlock_request_bls WHERE request_id=p_id)))
 AND (p_customer IS NULL OR e.action IN('draft','submit','review','cancel','complete','upload_termo','upload_procuracao','expire_draft','confirm'))),'[]'));
END $$;

