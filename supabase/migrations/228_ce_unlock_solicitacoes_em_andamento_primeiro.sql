-- 228: solicitações de Desbloqueio de CE da ficha do Cliente com as em
-- andamento primeiro.
--
-- Problema (passe completo do lote 1 da identidade, 2026-10-14): a proposta
-- aprovada pede "as em andamento vêm primeiro; as concluídas e canceladas
-- ficam no fim". A 227 ordenava só pela data de abertura, misturando pedidos
-- concluídos entre os abertos.
--
-- Mudança: `ce_unlock_customer_requests` ordena primeiro pelo grupo (em
-- andamento: rascunho, enviada, em análise, correção solicitada; depois
-- concluídas e canceladas) e, dentro de cada grupo, pela abertura mais
-- recente. O restante é a função da 227.
--
-- Só redefine a função; não reescreve nem apaga linhas.
-- Rollback: reaplicar a definição da migration 227.

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

  SELECT coalesce(jsonb_agg(q ORDER BY (q->>'state') IN ('completed', 'cancelled'), q->>'created_at' DESC, q->>'protocol' DESC), '[]') INTO v_rows FROM (
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
    'items', coalesce((SELECT jsonb_agg(value ORDER BY n) FROM (
      SELECT value, n FROM jsonb_array_elements(v_rows) WITH ORDINALITY a(value, n)
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
