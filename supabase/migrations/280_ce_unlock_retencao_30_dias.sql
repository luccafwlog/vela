-- Migration 280: retenção dos documentos do Desbloqueio de CE conforme o aceite
-- operacional (ADR 0087, item 5), no lugar dos 5 anos da migration `143`.
--
-- - Anexos de solicitação (`source = 'request'`): expurgados 30 dias após o
--   primeiro envio da solicitação, em qualquer estado. Pedido ainda em análise
--   perde os PDFs; metadados e histórico ficam, e o desk pede reenvio.
-- - Termo Anual VIP (`source = 'vip_annual'`): fica até ser substituído. Sai
--   quando não está vigente e existe, para o mesmo Cliente e tipo, documento
--   anual aprovado mais novo com fim de vigência posterior. Documento em
--   análise (`uploaded`) nunca sai por esta regra.
-- - Modelo do termo: sem mudança; o vigente fica, os anteriores saem após 5 anos.
-- - Upload abandonado (1 dia), rascunho (7 dias) e retomada de reivindicação
--   (`cleanup_claimed_at`) não mudam.
--
-- Executar esta migration não apaga nada: a lista só é consumida pelo job
-- diário `ce-unlock-cleanup`. Assinatura, grants e SECURITY DEFINER preservados.
--
-- Rollback: reaplicar `public.ce_unlock_cleanup_candidates()` da migration `143`.

CREATE OR REPLACE FUNCTION public.ce_unlock_cleanup_candidates()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',d.id,'storage_path',d.storage_path)),'[]') FROM public.ce_unlock_documents d LEFT JOIN public.ce_unlock_requests r ON r.id=d.request_id
 WHERE d.purged_at IS NULL AND (d.cleanup_claimed_at IS NOT NULL OR (d.status='uploading' AND d.created_at<now()-interval '1 day') OR (r.state='draft' AND r.created_at<now()-interval '7 days')
 OR (d.source='request' AND (SELECT min(e.created_at) FROM public.ce_unlock_events e WHERE e.request_id=d.request_id AND e.action='submit')<now()-interval '30 days')
 OR (d.source='vip_annual' AND d.status<>'uploaded' AND NOT ce_unlock_private.valid_doc(d.id)
 AND EXISTS(SELECT 1 FROM public.ce_unlock_documents n WHERE n.source='vip_annual' AND n.status='approved' AND n.purged_at IS NULL
 AND n.customer_id=d.customer_id AND n.type=d.type AND n.created_at>d.created_at AND n.valid_until>coalesce(d.valid_until,'-infinity'::date)))
 OR (d.source='model' AND d.created_at<now()-interval '5 years'
 AND d.id<>(SELECT id FROM public.ce_unlock_documents WHERE source='model' AND status='approved' ORDER BY created_at DESC LIMIT 1)))
$function$;
