-- 453: busca por vários B/Ls ou contêineres de uma vez (observações de
-- 2026-10-23, ponto 9).
--
-- Problema: a busca de /bls e /containers casava o texto inteiro. Colar uma
-- lista ("MEDU1, MEDU2" ou uma coluna da planilha) não achava nada.
--
-- Mudança:
--   1. `search_term_tokens(text)`: quebra o texto em espaço, vírgula,
--      ponto e vírgula e quebra de linha. Devolve os termos só quando são dois
--      ou mais; um termo só segue a busca de sempre. É a mesma regra de
--      `src/lib/searchTerms.ts`.
--   2. `operational_list_bls`, `operational_list_bl_summary` e
--      `operational_list_containers`: o texto inteiro continua casando como
--      antes, OU qualquer termo casa o número do B/L (e, na lista de
--      contêineres, o número do contêiner). As funções são ajustadas no lugar
--      (`pg_get_functiondef` + `replace`, como a migration 322), para manter o
--      restante do corpo (inclusive `p_without_customer` da 452).
--
-- Rollback: recriar as três funções com o corpo da 452 / 322 e apagar
-- `search_term_tokens`.
--
-- Só cria e redefine funções; não reescreve nem apaga linhas.

CREATE OR REPLACE FUNCTION public.search_term_tokens(p_search text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE WHEN cardinality(t) >= 2 THEN t ELSE ARRAY[]::text[] END
  FROM (
    SELECT COALESCE(array_agg(DISTINCT x) FILTER (WHERE x <> ''), ARRAY[]::text[]) AS t
    FROM regexp_split_to_table(COALESCE(p_search, ''), '[\s,;]+') AS x
  ) s;
$function$;

REVOKE ALL ON FUNCTION public.search_term_tokens(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_term_tokens(text) TO authenticated, service_role;

DO $patch$
DECLARE
  v_fn regprocedure;
  v_def text;
  v_new text;
  v_bl_old text := $s$OR b.id ILIKE '%' || btrim(p_search) || '%'$s$;
  v_bl_new text := $s$OR b.id ILIKE '%' || btrim(p_search) || '%'
      OR EXISTS (SELECT 1 FROM unnest(public.search_term_tokens(p_search)) AS term WHERE b.id ILIKE '%' || term || '%')$s$;
  v_ct_old text := $s$OR bc.container_number ILIKE '%' || btrim(p_search) || '%'$s$;
  v_ct_new text := $s$OR bc.container_number ILIKE '%' || btrim(p_search) || '%'
      OR EXISTS (SELECT 1 FROM unnest(public.search_term_tokens(p_search)) AS term WHERE bc.container_number ILIKE '%' || term || '%')$s$;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'public.operational_list_bls(integer,integer,text,bigint,text,text,text,text,text,text,text,boolean)'::regprocedure,
    'public.operational_list_bl_summary(text,bigint,text,text,text,text,text,text,text,boolean)'::regprocedure,
    'public.operational_list_containers(integer,integer,text,bigint,text,text,text,text,text,text,text,text,boolean)'::regprocedure
  ] LOOP
    v_def := pg_get_functiondef(v_fn);
    IF position(v_bl_old IN v_def) = 0 THEN
      RAISE EXCEPTION '453: cláusula de busca do B/L não encontrada em %', v_fn;
    END IF;
    v_new := replace(v_def, v_bl_old, v_bl_new);
    IF v_fn::text LIKE '%containers%' THEN
      IF position(v_ct_old IN v_new) = 0 THEN
        RAISE EXCEPTION '453: cláusula de busca do contêiner não encontrada em %', v_fn;
      END IF;
      v_new := replace(v_new, v_ct_old, v_ct_new);
    END IF;
    EXECUTE v_new;
  END LOOP;
END;
$patch$;
