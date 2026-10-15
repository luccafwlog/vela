-- Migration 282: a projeção de documento do Desbloqueio de CE informa se o
-- arquivo já saiu do Storage.
--
-- Com a retenção de 30 dias (migration `280`) e as versões anteriores visíveis
-- no pedido interno, a tela precisa saber quando o PDF não existe mais, em vez
-- de oferecer "Abrir documento" e receber "Documento não autorizado". Dois
-- campos novos, nas mesmas condições em que `ce_unlock_document_access` recusa
-- o download:
-- - `purged`: o arquivo saiu do Storage (`purged_at`);
-- - `cleanup_pending`: o expurgo reivindicou o arquivo (`cleanup_claimed_at`)
--   e ainda não confirmou a remoção. Se a remoção falhar, o objeto continua no
--   Storage até a rodada seguinte, então a tela não pode dizer "removido".
--
-- Só acrescenta chaves ao JSON; assinatura, grants e SECURITY DEFINER
-- preservados. Nenhuma linha é alterada.
--
-- Rollback: reaplicar `ce_unlock_private.doc_json` da migration `140`.

CREATE OR REPLACE FUNCTION ce_unlock_private.doc_json(p_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
 SELECT jsonb_build_object('id',id,'version',version,'customer_id',customer_id,'request_id',request_id,'type',type,'source',source,'status',status,
 'file_name',file_name,'size_bytes',size_bytes,'valid_from',valid_from,'valid_until',valid_until,'coverage_year',coverage_year,'reason',reason,'created_at',created_at,
 'purged',purged_at IS NOT NULL,
 'cleanup_pending',purged_at IS NULL AND cleanup_claimed_at IS NOT NULL)
 FROM public.ce_unlock_documents WHERE id=p_id
$function$;
