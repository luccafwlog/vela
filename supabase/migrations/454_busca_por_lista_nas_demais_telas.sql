-- 454: busca por vários B/Ls nas demais buscas feitas no banco (ponto 9 de
-- 2026-10-23, ampliado pelo responsável em 2026-10-24: "todo filtro do Vela e
-- do Portal que busque por B/L ou contêiner").
--
-- Problema: depois da 453, colar uma lista ainda não achava nada no
-- Desbloqueio de CE interno, nas solicitações de desbloqueio da ficha do
-- Cliente, no modal Consolidar fatura e nas abas Faturas e Demurrage do
-- Portal: essas buscas rodam em RPCs que casam o texto inteiro.
--
-- Mudança: mesma regra da 453 (`search_term_tokens`). O texto inteiro
-- continua casando como antes, OU qualquer termo da lista casa o número do
-- B/L (e o CE, no Desbloqueio de CE interno). As funções são ajustadas no
-- lugar (`pg_get_functiondef` + `replace`, como as migrations 322 e 453), sem
-- sobrescrever o restante do corpo, inclusive o que a 448 redefiniu em
-- `ce_unlock_private.list` e `ce_unlock_customer_requests`.
--   - ce_unlock_private.list (Desbloqueio de CE › Andamento)
--   - ce_unlock_customer_requests (ficha do Cliente)
--   - list_consolidatable_receivables (Consolidar fatura)
--   - _portal_list_invoices_page_core (Portal › Faturas)
--   - _portal_list_demurrage_invoices_page_core (Portal › Demurrage)
--
-- Rollback: recriar as cinco funções com o corpo anterior (o
-- `pg_get_functiondef` delas antes desta migration).
--
-- Só redefine funções; não reescreve nem apaga linhas.

DO $patch$
DECLARE
  v_patch record;
  v_def text;
BEGIN
  FOR v_patch IN
    SELECT * FROM (VALUES
      (
        'ce_unlock_private.list(bigint,jsonb,integer,boolean)'::regprocedure,
        $s$OR (j->>'customer_name') ILIKE '%'||(p_filters->>'search')||'%')$s$,
        $s$OR (j->>'customer_name') ILIKE '%'||(p_filters->>'search')||'%'
    OR EXISTS (SELECT 1 FROM unnest(public.search_term_tokens(p_filters->>'search')) AS term
      WHERE (j->>'bl_id') ILIKE '%'||term||'%' OR (j->>'ce_mercante') ILIKE '%'||term||'%'))$s$
      ),
      (
        'public.ce_unlock_customer_requests(bigint,text,integer)'::regprocedure,
        $s$upper(i.bl_id) LIKE '%' || v_term || '%'$s$,
        $s$(upper(i.bl_id) LIKE '%' || v_term || '%'
          OR EXISTS (SELECT 1 FROM unnest(public.search_term_tokens(p_bl_search)) AS term
            WHERE upper(i.bl_id) LIKE '%' || upper(term) || '%'))$s$
      ),
      (
        'public.list_consolidatable_receivables(bigint,bigint,text)'::regprocedure,
        $s$OR br.bl_id ILIKE '%' || TRIM(p_search) || '%'$s$,
        $s$OR br.bl_id ILIKE '%' || TRIM(p_search) || '%'
        OR EXISTS (SELECT 1 FROM unnest(public.search_term_tokens(p_search)) AS term WHERE br.bl_id ILIKE '%' || term || '%')$s$
      ),
      (
        'public._portal_list_invoices_page_core(bigint,integer,integer,text,text,text,text,date,date)'::regprocedure,
        $s$WHERE POSITION(LOWER(BTRIM(p_bl)) IN LOWER(value)) > 0$s$,
        $s$WHERE POSITION(LOWER(BTRIM(p_bl)) IN LOWER(value)) > 0
            OR EXISTS (SELECT 1 FROM unnest(public.search_term_tokens(p_bl)) AS term WHERE POSITION(LOWER(term) IN LOWER(value)) > 0)$s$
      ),
      (
        'public._portal_list_demurrage_invoices_page_core(bigint,integer,integer,text,text,text,text,date,date)'::regprocedure,
        $s$OR POSITION(LOWER(BTRIM(p_bl)) IN LOWER(COALESCE(r.row->>'bl_id', ''))) > 0$s$,
        $s$OR POSITION(LOWER(BTRIM(p_bl)) IN LOWER(COALESCE(r.row->>'bl_id', ''))) > 0
        OR EXISTS (SELECT 1 FROM unnest(public.search_term_tokens(p_bl)) AS term
          WHERE POSITION(LOWER(term) IN LOWER(COALESCE(r.row->>'bl_id', ''))) > 0)$s$
      )
    ) AS p(fn, old_clause, new_clause)
  LOOP
    v_def := pg_get_functiondef(v_patch.fn);
    IF position(v_patch.old_clause IN v_def) = 0 THEN
      RAISE EXCEPTION '454: cláusula de busca não encontrada em %', v_patch.fn;
    END IF;
    EXECUTE replace(v_def, v_patch.old_clause, v_patch.new_clause);
  END LOOP;
END;
$patch$;
