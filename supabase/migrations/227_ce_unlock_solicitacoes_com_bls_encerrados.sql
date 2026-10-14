-- 227: solicitações de Desbloqueio de CE da ficha do Cliente com os B/Ls de
-- todas as situações.
--
-- Problema (revisão da PR do lote 1 da identidade): a migration 224 lia só os
-- vínculos `ce_unlock_request_bls.active`. O fluxo do Desbloqueio (139 a 143)
-- desativa o vínculo quando o B/L é confirmado e quando o pedido é cancelado;
-- não há outro caminho que o desative nem que o apague. Pedido concluído ou
-- cancelado aparecia sem B/L, e a busca por B/L não o encontrava.
--
-- Mudança: `ce_unlock_customer_requests` lista e busca por todos os vínculos
-- do pedido. O restante é a função da 224.
--
-- Só redefine a função; não reescreve nem apaga linhas.
-- Rollback: reaplicar a definição da migration 224.

CREATE OR REPLACE FUNCTION public.ce_unlock_customer_requests(
  p_customer_id bigint,
  p_bl_search text DEFAULT NULL,
  p_page integer DEFAULT 1
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_rows jsonb;
  v_term text := nullif(upper(btrim(coalesce(p_bl_search, ''))), '');
  v_page integer := coalesce(p_page, 1);
BEGIN
  PERFORM ce_unlock_private.actor();
  IF v_page < 1 THEN RAISE EXCEPTION 'Página inválida'; END IF;

  SELECT coalesce(jsonb_agg(q ORDER BY q->>'created_at' DESC, q->>'protocol' DESC), '[]') INTO v_rows FROM (
    SELECT jsonb_build_object(
      'id', r.id, 'protocol', r.protocol, 'state', r.state, 'version', r.version, 'created_at', r.created_at,
      'customer_name', c.name, 'cnpj_cpf', c.cnpj_cpf,
      'sla_started_at', (SELECT max(e.created_at) FROM public.ce_unlock_events e WHERE e.request_id = r.id AND e.action = 'submit'),
      'bl_ids', coalesce((SELECT jsonb_agg(i.bl_id ORDER BY i.bl_id) FROM public.ce_unlock_request_bls i WHERE i.request_id = r.id), '[]'),
      'termo_status', (SELECT d.status FROM public.ce_unlock_documents d WHERE d.request_id = r.id AND d.type = 'termo' AND d.hash IS NOT NULL AND d.status <> 'uploading' ORDER BY d.created_at DESC LIMIT 1),
      'procuracao_status', (SELECT d.status FROM public.ce_unlock_documents d WHERE d.request_id = r.id AND d.type = 'procuracao' AND d.hash IS NOT NULL AND d.status <> 'uploading' ORDER BY d.created_at DESC LIMIT 1)
    ) AS q
    FROM public.ce_unlock_requests r
    JOIN public.customers c ON c.id = r.customer_id
    WHERE r.customer_id = p_customer_id
      AND r.source = 'request'
      AND (v_term IS NULL OR EXISTS (
        SELECT 1 FROM public.ce_unlock_request_bls i
        WHERE i.request_id = r.id AND upper(i.bl_id) LIKE '%' || v_term || '%'
      ))
  ) x;

  RETURN jsonb_build_object(
    'items', coalesce((SELECT jsonb_agg(value) FROM (
      SELECT value FROM jsonb_array_elements(v_rows) WITH ORDINALITY a(value, n)
      WHERE n > (v_page - 1) * 20 AND n <= v_page * 20
    ) p), '[]'),
    'total', jsonb_array_length(v_rows),
    'page', v_page,
    'page_size', 20
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.ce_unlock_customer_requests(bigint, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ce_unlock_customer_requests(bigint, text, integer) TO authenticated, service_role;
