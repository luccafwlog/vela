-- 479: Desbloqueio de CE (decisões do dono de 2026-10-27, lote 11 do plano de
-- correções; ADR 0110).
--
-- Problema e mudança, por seção:
--   1. 08-desbloqueio-ce:4 (decisão do dono, "outra") — o termo e a procuração
--      anuais cobriam o B/L cujo CE Mercante foi vinculado dentro da vigência
--      (migrations `449` e `456`). O dono decidiu, com a diretoria: o anual
--      cobre todo CE com o desbloqueio solicitado dentro da vigência, sem olhar
--      importação do B/L nem vínculo do CE. O dia que vale é o do envio da
--      solicitação (dia de Brasília); antes do envio, o de hoje.
--   2. 08-desbloqueio-ce:5 — no Modo Inspeção, os documentos da solicitação e
--      os anuais vinham vazios para Financeiro, Operações e Equipamentos. Todos
--      os setores os veem, como no Vela (ADR 0085, D16).
--   3. 08-desbloqueio-ce:2 — a ficha do Cliente não listava as solicitações VIP
--      e repetia o B/L que mudou de solicitação. Lista todas, com a origem, e
--      tira o B/L movido.
--
-- Só cria e redefine funções; não reescreve nem apaga linhas.
--
-- Rollback: reaplicar `ce_unlock_private.covers` da `456`,
-- `ce_unlock_customer_requests` da `448`, `portal_inspect_get_ce_unlock_request`
-- e `portal_inspect_get_ce_unlock_vip_coverage` da `139`, e
-- `DROP FUNCTION ce_unlock_private.request_day(text)`.

-- 1. Cobertura do anual pela data da solicitação -------------------------------

-- Dia (Brasília) em que o desbloqueio do B/L foi solicitado: o primeiro envio
-- da solicitação ativa mais recente dele; sem envio ainda, hoje.
CREATE OR REPLACE FUNCTION ce_unlock_private.request_day(p_bl text)
 RETURNS date
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
 SELECT coalesce((
   SELECT (min(e.created_at) AT TIME ZONE 'America/Sao_Paulo')::date
   FROM public.ce_unlock_events e
   WHERE e.action = 'submit'
     AND e.request_id = (
       SELECT i.request_id FROM public.ce_unlock_request_bls i
       JOIN public.ce_unlock_requests r ON r.id = i.request_id
       WHERE i.bl_id = p_bl AND i.active AND r.state <> 'cancelled'
       ORDER BY r.created_at DESC, r.id DESC LIMIT 1)
 ), ce_unlock_private.today())
$function$;
REVOKE ALL ON FUNCTION ce_unlock_private.request_day(text) FROM PUBLIC, anon, authenticated;

-- O anual cobre o B/L: aprovado, de ano inteiro, e o desbloqueio do B/L foi
-- solicitado dentro da vigência dele (479). Vencido, continua cobrindo o que
-- foi solicitado nela; revogado não cobre.
CREATE OR REPLACE FUNCTION ce_unlock_private.covers(p_doc uuid, p_bl text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
 SELECT coalesce((SELECT d.status='approved' AND d.source='vip_annual' AND d.valid_until=make_date(d.coverage_year,12,31)
   AND ce_unlock_private.request_day(p_bl) BETWEEN d.valid_from AND d.valid_until
   FROM public.ce_unlock_documents d WHERE d.id=p_doc),false)
$function$;

-- 2. Documentos na Inspeção para todos os setores ------------------------------

CREATE OR REPLACE FUNCTION public.portal_inspect_get_ce_unlock_request(p_customer_id bigint, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$ BEGIN PERFORM ce_unlock_private.actor(); IF NOT EXISTS(SELECT 1 FROM public.customers WHERE id=p_customer_id) THEN RAISE EXCEPTION 'Cliente não autorizado' USING ERRCODE='42501'; END IF; RETURN ce_unlock_private.request_json(p_request_id,p_customer_id,true); END $function$;

CREATE OR REPLACE FUNCTION public.portal_inspect_get_ce_unlock_vip_coverage(p_customer_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$ BEGIN PERFORM ce_unlock_private.actor(); IF NOT EXISTS(SELECT 1 FROM public.customers WHERE id=p_customer_id) THEN RAISE EXCEPTION 'Cliente não autorizado' USING ERRCODE='42501'; END IF; RETURN ce_unlock_private.vip_json(p_customer_id,true); END $function$;

-- 3. Ficha do Cliente com as solicitações VIP ----------------------------------

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
      'termo_status', (SELECT d.status FROM public.ce_unlock_documents d WHERE d.request_id = r.id AND d.type = 'termo' AND d.hash IS NOT NULL AND d.status <> 'uploading' ORDER BY d.created_at DESC LIMIT 1),
      'procuracao_status', (SELECT d.status FROM public.ce_unlock_documents d WHERE d.request_id = r.id AND d.type = 'procuracao' AND d.hash IS NOT NULL AND d.status <> 'uploading' ORDER BY d.created_at DESC LIMIT 1)
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
