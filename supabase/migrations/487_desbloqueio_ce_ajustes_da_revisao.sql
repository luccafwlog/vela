-- 487: Desbloqueio de CE, ajustes da revisão da PR #1070 (decisões do dono de
-- 2026-10-27; ADR 0110).
--
-- Problema e mudança, por seção:
--   1. M10 — `request_day` (479) lia `ce_unlock_events` sem índice, uma vez por
--      anual e por B/L de Cliente VIP: as listas do Desbloqueio de CE ficavam
--      cerca de 10× mais lentas e tendiam a passar do limite de 8 s. Ganham
--      os índices da busca por solicitação e por B/L.
--   2. P8a — o B/L que passa de uma solicitação para outra nascia VIP no
--      rascunho pela data da solicitação antiga e era recusado no envio pela
--      data de hoje. Decisão do dono: vale o primeiro envio do B/L, contando a
--      solicitação de onde ele foi passado para outra (evento `bl_moved`). O
--      pedido cancelado de propósito e refeito depois vale pela data do novo.
--   3. P8b — a regra da 479 reabria solicitações VIP em andamento, inclusive
--      exportadas, que tinham o anual ligado pela regra anterior. Decisão do
--      dono: quem já tem o anual ligado continua coberto; a data da
--      solicitação vale para o que for ligado daqui em diante. Os vínculos
--      que só a regra anterior cobria ficam guardados em
--      `ce_unlock_annual_kept_by_transition`.
--   4. B21 — a ficha do Cliente mostrava Termo e Procuração "Não enviado" nas
--      solicitações VIP; agora mostra a situação do anual ligado.
--
-- Não reescreve dados existentes: só grava, numa tabela nova, os vínculos que
-- a transição mantém cobertos.
--
-- Rollback: reaplicar `ce_unlock_private.request_day`, `ce_unlock_private.covers`
-- e `ce_unlock_customer_requests` da `479`; DROP INDEX
-- idx_ce_unlock_events_request_action, idx_ce_unlock_events_bl_action; DROP
-- TABLE public.ce_unlock_annual_kept_by_transition.

-- 1. Índices da data da solicitação ------------------------------------------
CREATE INDEX IF NOT EXISTS idx_ce_unlock_events_request_action
  ON public.ce_unlock_events (request_id, action, created_at);
CREATE INDEX IF NOT EXISTS idx_ce_unlock_events_bl_action
  ON public.ce_unlock_events (bl_id, action);

-- 2. Primeiro envio do B/L, seguindo a mudança de solicitação ----------------

-- Dia (Brasília) em que o desbloqueio do B/L foi solicitado: o primeiro envio
-- da solicitação ativa mais recente dele ou das solicitações de onde ele foi
-- passado para ela; sem envio ainda, hoje.
CREATE OR REPLACE FUNCTION ce_unlock_private.request_day(p_bl text)
 RETURNS date
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
 WITH RECURSIVE current_request AS (
   SELECT i.request_id FROM public.ce_unlock_request_bls i
   JOIN public.ce_unlock_requests r ON r.id = i.request_id
   WHERE i.bl_id = p_bl AND i.active AND r.state <> 'cancelled'
   ORDER BY r.created_at DESC, r.id DESC LIMIT 1
 ), chain(request_id, depth) AS (
   SELECT request_id, 0 FROM current_request
   UNION ALL
   SELECT moved.request_id, chain.depth + 1
   FROM chain
   JOIN public.ce_unlock_events moved
     ON moved.action = 'bl_moved' AND moved.bl_id = p_bl
    AND moved.payload->>'to_request' = chain.request_id::text
   WHERE chain.depth < 20
 )
 SELECT coalesce((
   SELECT (min(e.created_at) AT TIME ZONE 'America/Sao_Paulo')::date
   FROM public.ce_unlock_events e
   WHERE e.action = 'submit' AND e.request_id IN (SELECT request_id FROM chain)
 ), ce_unlock_private.today())
$function$;
REVOKE ALL ON FUNCTION ce_unlock_private.request_day(text) FROM PUBLIC, anon, authenticated;

-- 3. O anual já ligado pela regra anterior continua cobrindo -----------------

-- Vínculos de anual que a regra da 456 (vínculo do CE) cobria e a da 479 (data
-- da solicitação) não cobre, nas solicitações ativas de hoje. Ficam cobertos
-- (decisão do dono, P8b); o que for ligado daqui em diante segue só a 479.
-- Tabela em `public`, sem grant nem política: só as funções do Desbloqueio a
-- leem, e a limpeza dos dados de teste a esvazia com o resto.
CREATE TABLE IF NOT EXISTS public.ce_unlock_annual_kept_by_transition (
  bl_id text NOT NULL,
  document_id uuid NOT NULL REFERENCES public.ce_unlock_documents(id) ON DELETE CASCADE,
  kept_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (bl_id, document_id)
);
ALTER TABLE public.ce_unlock_annual_kept_by_transition ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ce_unlock_annual_kept_by_transition FROM PUBLIC, anon, authenticated;

INSERT INTO public.ce_unlock_annual_kept_by_transition (bl_id, document_id)
SELECT DISTINCT i.bl_id, d.id
FROM public.ce_unlock_request_bls i
JOIN public.ce_unlock_requests r ON r.id = i.request_id AND r.state <> 'cancelled'
JOIN public.ce_unlock_documents d ON d.id IN (i.termo_document_id, i.procuracao_document_id)
WHERE i.active
  AND d.status = 'approved' AND d.source = 'vip_annual' AND d.valid_until = make_date(d.coverage_year, 12, 31)
  AND ce_unlock_private.ce_link_day(i.bl_id) BETWEEN d.valid_from AND d.valid_until
  AND NOT (ce_unlock_private.request_day(i.bl_id) BETWEEN d.valid_from AND d.valid_until)
ON CONFLICT DO NOTHING;

-- O anual cobre o B/L: aprovado, de ano inteiro, e o desbloqueio do B/L foi
-- solicitado dentro da vigência dele (479) — ou o vínculo vem da regra
-- anterior e ficou guardado na transição (487, P8b). Vencido, continua
-- cobrindo o que foi solicitado nela; revogado não cobre.
CREATE OR REPLACE FUNCTION ce_unlock_private.covers(p_doc uuid, p_bl text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
 SELECT coalesce((SELECT d.status='approved' AND d.source='vip_annual' AND d.valid_until=make_date(d.coverage_year,12,31)
   AND (ce_unlock_private.request_day(p_bl) BETWEEN d.valid_from AND d.valid_until
        OR EXISTS (SELECT 1 FROM public.ce_unlock_annual_kept_by_transition k
                   WHERE k.bl_id = p_bl AND k.document_id = d.id))
   FROM public.ce_unlock_documents d WHERE d.id=p_doc),false)
$function$;

-- 4. Ficha do Cliente com a situação do anual nas solicitações VIP -----------
CREATE OR REPLACE FUNCTION public.ce_unlock_customer_requests(p_customer_id bigint, p_bl_search text DEFAULT NULL::text, p_page integer DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
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
      -- 479 (08-desbloqueio-ce:2): a ficha lista também as solicitações VIP.
      'source', r.source,
      'customer_name', c.name, 'cnpj_cpf', c.cnpj_cpf,
      -- 448: o prazo só existe com os quatro requisitos em todos os B/Ls.
      'sla_started_at', ce_unlock_private.request_sla_start(r.id),
      -- 450: a concluída mostra o prazo até a última exportação, como o detalhe.
      'exported_at', (SELECT CASE WHEN count(*) > 0 AND bool_and(i.exported_at IS NOT NULL) THEN max(i.exported_at) END
        FROM public.ce_unlock_request_bls i WHERE i.request_id = r.id AND i.active),
      -- 479: o B/L que mudou de solicitação sai daqui, como no detalhe.
      'bl_ids', coalesce((SELECT jsonb_agg(i.bl_id ORDER BY i.bl_id) FROM public.ce_unlock_request_bls i WHERE i.request_id = r.id
        AND NOT EXISTS (SELECT 1 FROM public.ce_unlock_events moved WHERE moved.request_id = r.id AND moved.bl_id = i.bl_id AND moved.action = 'bl_moved')), '[]'),
      -- 487 (B21): a solicitação VIP não tem documento próprio; vale o anual
      -- ligado aos B/Ls dela.
      'termo_status', CASE WHEN r.source = 'vip_annual'
        THEN (SELECT d.status FROM public.ce_unlock_request_bls i JOIN public.ce_unlock_documents d ON d.id = i.termo_document_id
              WHERE i.request_id = r.id AND i.active ORDER BY d.created_at DESC LIMIT 1)
        ELSE (SELECT d.status FROM public.ce_unlock_documents d WHERE d.request_id = r.id AND d.type = 'termo' AND d.hash IS NOT NULL AND d.status <> 'uploading' ORDER BY d.created_at DESC LIMIT 1) END,
      'procuracao_status', CASE WHEN r.source = 'vip_annual'
        THEN (SELECT d.status FROM public.ce_unlock_request_bls i JOIN public.ce_unlock_documents d ON d.id = i.procuracao_document_id
              WHERE i.request_id = r.id AND i.active ORDER BY d.created_at DESC LIMIT 1)
        ELSE (SELECT d.status FROM public.ce_unlock_documents d WHERE d.request_id = r.id AND d.type = 'procuracao' AND d.hash IS NOT NULL AND d.status <> 'uploading' ORDER BY d.created_at DESC LIMIT 1) END
    ) AS q
    FROM public.ce_unlock_requests r
    JOIN public.customers c ON c.id = r.customer_id
    WHERE r.customer_id = p_customer_id
      AND (v_term IS NULL OR EXISTS (
        SELECT 1 FROM public.ce_unlock_request_bls i
        WHERE i.request_id = r.id AND (upper(i.bl_id) LIKE '%' || v_term || '%'
          OR EXISTS (SELECT 1 FROM unnest(public.search_term_tokens(p_bl_search)) AS term
            WHERE upper(i.bl_id) LIKE '%' || upper(term) || '%'))
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
