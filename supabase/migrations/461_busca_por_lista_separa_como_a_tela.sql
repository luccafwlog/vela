-- 461: a busca por lista separa os termos nos mesmos espaços no banco e na tela
-- (revisão da PR de release luccafwlog/vela#1061, migration 455).
--
-- Problema: `search_term_tokens` (455) separava os termos por `\s`, ` `,
-- vírgula e ponto e vírgula; o `\s` do banco segue o locale do servidor. A tela
-- (`src/lib/searchTerms.ts`) separava pelo `\s` do JavaScript, que inclui todos
-- os espaços Unicode. Uma lista colada com o espaço não separável estreito
-- (U+202F) ou o espaço de algarismo (U+2007), comuns em planilha e e-mail, virava
-- lista nas telas filtradas no navegador e não virava nas filtradas no banco
-- (/bls, /containers, Desbloqueio de CE, Faturas e Demurrage do Portal):
-- `search_term_tokens('MEDU1234567' || chr(8239) || 'MEDU2345678')` dava `{}`.
--
-- Mudança: `search_term_tokens(text)` mantém assinatura, volatilidade, grants e
-- a regra dos termos (4+ caracteres com dígito, dois ou mais, contados antes de
-- tirar os repetidos) e passa a separar pela mesma lista enumerada da tela:
-- espaços ASCII, U+00A0, U+1680, U+2000 a U+200A, U+2028, U+2029, U+202F,
-- U+205F, U+3000, U+FEFF, vírgula e ponto e vírgula. As listas das migrations
-- 453 e 454 chamam a função e seguem sem ajuste.
--
-- Só redefine função; não reescreve nem apaga linhas.
-- Rollback: reaplicar `search_term_tokens` da 455.

CREATE OR REPLACE FUNCTION public.search_term_tokens(p_search text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  -- Termo é o que tem cara de número: 4+ caracteres e algum dígito. Os
  -- separadores são os mesmos de `src/lib/searchTerms.ts` (SEPARATORS). A lista
  -- é contada antes de tirar os repetidos (coluna com o mesmo B/L).
  SELECT CASE WHEN n >= 2 THEN t ELSE ARRAY[]::text[] END
  FROM (
    SELECT count(*) AS n, COALESCE(array_agg(DISTINCT x), ARRAY[]::text[]) AS t
    FROM regexp_split_to_table(COALESCE(p_search, ''),
      '[ \t\n\v\f\r   -     　﻿,;]+') AS x
    WHERE char_length(x) >= 4 AND x ~ '[0-9]'
  ) s;
$function$;

REVOKE ALL ON FUNCTION public.search_term_tokens(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_term_tokens(text) TO authenticated, service_role;
