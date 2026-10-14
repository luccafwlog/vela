-- 224: solicitações de Desbloqueio de CE de um Cliente, para a ficha do Cliente.
--
-- Problema (lote 1 da identidade, decisão de 2026-10-14): a aba Desbloqueio de
-- CE e VIP da ficha do Cliente mostrava só a Condição VIP. O responsável pediu
-- as solicitações do Cliente, com a situação, o termo de devolução, a
-- procuração, o prazo e a data de abertura, com busca por B/L e paginação. A
-- leitura interna só tinha a fila de revisão (`review_queue`, migration 160),
-- sem recorte por Cliente e só com pedidos à espera de análise.
--
-- Mudança: `ce_unlock_customer_requests(p_customer_id, p_bl_search, p_page)`,
-- leitura com o mesmo gate do módulo (`ce_unlock_private.actor()`), no mesmo
-- formato de linha de `review_queue` e de todos os estados, do mais recente
-- ao mais antigo, 20 por página.
--
-- Só cria função; não reescreve nem apaga linhas.
-- Rollback: DROP FUNCTION public.ce_unlock_customer_requests(bigint, text, integer).

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
      'bl_ids', coalesce((SELECT jsonb_agg(i.bl_id ORDER BY i.bl_id) FROM public.ce_unlock_request_bls i WHERE i.request_id = r.id AND i.active), '[]'),
      'termo_status', (SELECT d.status FROM public.ce_unlock_documents d WHERE d.request_id = r.id AND d.type = 'termo' AND d.hash IS NOT NULL AND d.status <> 'uploading' ORDER BY d.created_at DESC LIMIT 1),
      'procuracao_status', (SELECT d.status FROM public.ce_unlock_documents d WHERE d.request_id = r.id AND d.type = 'procuracao' AND d.hash IS NOT NULL AND d.status <> 'uploading' ORDER BY d.created_at DESC LIMIT 1)
    ) AS q
    FROM public.ce_unlock_requests r
    JOIN public.customers c ON c.id = r.customer_id
    WHERE r.customer_id = p_customer_id
      AND r.source = 'request'
      AND (v_term IS NULL OR EXISTS (
        SELECT 1 FROM public.ce_unlock_request_bls i
        WHERE i.request_id = r.id AND i.active AND upper(i.bl_id) LIKE '%' || v_term || '%'
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
