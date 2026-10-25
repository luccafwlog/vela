-- 457: o anual vencido que ainda cobre B/L não é expurgado (revisão da 456,
-- ADR 0102).
--
-- Problema: desde a 456, o anual continua cobrindo, depois de vencer, os B/Ls
-- cujo CE foi vinculado na vigência dele. Mas a limpeza diária
-- (`ce_unlock_cleanup_candidates`, 280; job `ce-unlock-cleanup`) escolhia o
-- anual vencido assim que havia outro aprovado mais novo, e o
-- `ce_unlock_cleanup_claim` (144) o revoga e apaga o PDF. Em janeiro, com o
-- anual novo aprovado, o pedido VIP do B/L com CE vinculado em dezembro
-- perdia de novo a cobertura, e o anual novo não a devolve.
--
-- Mudança: `ce_unlock_cleanup_candidates` deixa de escolher o anual aprovado
-- que ainda cobre algum B/L do Cliente não cancelado, nem exportado nem
-- conferido. O restante é a 280.
--
-- ponytail: a guarda vale até um ano depois do fim da vigência; depois disso o
-- anual sai como antes, mesmo cobrindo B/L nunca pedido. Teto de custo: a
-- rodada diária confere `covers` nos B/Ls do Cliente de cada anual vencido
-- substituído (poucos por Cliente). Upgrade: marcar no anual a data do último
-- B/L coberto pendente.
--
-- Só redefine funções; não reescreve nem apaga linhas.
-- Rollback: reaplicar `ce_unlock_cleanup_candidates` da 280.

CREATE OR REPLACE FUNCTION public.ce_unlock_cleanup_candidates()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',d.id,'storage_path',d.storage_path)),'[]') FROM public.ce_unlock_documents d LEFT JOIN public.ce_unlock_requests r ON r.id=d.request_id
 WHERE d.purged_at IS NULL AND (d.cleanup_claimed_at IS NOT NULL OR (d.status='uploading' AND d.created_at<now()-interval '1 day') OR (r.state='draft' AND r.created_at<now()-interval '7 days')
 OR (d.source='request' AND (r.state='cancelled' OR (r.state='completed'
 AND NOT EXISTS(SELECT 1 FROM public.ce_unlock_request_bls u WHERE u.request_id=r.id AND u.active AND u.exported_at IS NULL)))
 AND (SELECT max(e.created_at) FROM public.ce_unlock_events e WHERE e.request_id=d.request_id AND e.action IN('complete','cancel'))<now()-interval '30 days')
 OR (d.source='vip_annual' AND d.status<>'uploaded' AND NOT ce_unlock_private.valid_doc(d.id)
 AND EXISTS(SELECT 1 FROM public.ce_unlock_documents n WHERE n.source='vip_annual' AND n.status='approved' AND n.purged_at IS NULL
 AND n.customer_id=d.customer_id AND n.type=d.type AND n.created_at>d.created_at AND n.valid_until>coalesce(d.valid_until,'-infinity'::date))
 -- 457: o anual vencido que ainda cobre B/L pendente do Cliente fica (456).
 AND NOT (d.status='approved' AND d.valid_until>=ce_unlock_private.today()-365
 AND EXISTS(SELECT 1 FROM public.bls b WHERE b.customer_id=d.customer_id AND b.cancelled_at IS NULL AND ce_unlock_private.covers(d.id,b.id)
 AND NOT EXISTS(SELECT 1 FROM public.ce_unlock_request_bls u WHERE u.bl_id=b.id AND (u.exported_at IS NOT NULL OR u.confirmed_at IS NOT NULL)))))
 OR (d.source='model' AND d.created_at<now()-interval '5 years'
 AND d.id<>(SELECT id FROM public.ce_unlock_documents WHERE source='model' AND status='approved' ORDER BY created_at DESC LIMIT 1)))
$function$;
