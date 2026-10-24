-- 455: a busca por lista só conta termos com cara de número (revisão da PR da
-- 453/454, ponto 9 de 2026-10-23).
--
-- Problema: `search_term_tokens` (migration 453) tratava qualquer palavra como
-- termo da lista. Buscar um nome de várias palavras virava lista e trazia
-- ruído: em "IMPORTACAO E EXPORTACAO" o termo "E" casava todo B/L com a letra
-- E; em "ACME 2", o "2" casava todo B/L com o algarismo 2. Além disso, o
-- espaço não separável (U+00A0, comum ao colar de planilha ou e-mail) não
-- separava termos no banco, mas separava na tela (`\s` do JS).
--
-- Mudança: `search_term_tokens(text)` mantém a assinatura e passa a contar só
-- o termo com pelo menos 4 caracteres e pelo menos um dígito; a lista só
-- existe com dois ou mais desses termos, contados antes de tirar os repetidos
-- (a coluna colada com o mesmo B/L em toda linha continua achando esse B/L,
-- como na 453). O espaço não separável passa a separar, como espaço. É a
-- mesma regra de `src/lib/searchTerms.ts`. As listas das migrations 453 e 454
-- chamam a função, então não precisam ser ajustadas de novo.
--
-- ponytail: cada termo da lista é um ILIKE '%termo%' sem índice; o custo é
-- termos × linhas. E nas buscas que a tela faz por GET no PostgREST (Faturas
-- em `billing.ts`, `chargeOperationsService.ts`, `graniteCargo.ts`,
-- `vaziosImportacaoImport.ts`) cada termo vai na URL, e uma lista de centenas
-- de números pode estourar o tamanho da URL. Upgrade: teto de termos com
-- aviso na tela, ou levar essas buscas para RPC (POST).
--
-- Rollback: recriar `search_term_tokens` com o corpo da 453.
--
-- Só redefine funções; não reescreve nem apaga linhas.

CREATE OR REPLACE FUNCTION public.search_term_tokens(p_search text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  -- Termo é o que tem cara de número: 4+ caracteres e algum dígito; o espaço
  -- não separável (\u00a0) separa como espaço. A lista é
  -- contada antes de tirar os repetidos (coluna com o mesmo B/L).
  SELECT CASE WHEN n >= 2 THEN t ELSE ARRAY[]::text[] END
  FROM (
    SELECT count(*) AS n, COALESCE(array_agg(DISTINCT x), ARRAY[]::text[]) AS t
    FROM regexp_split_to_table(COALESCE(p_search, ''), '[\s\u00a0,;]+') AS x
    WHERE char_length(x) >= 4 AND x ~ '[0-9]'
  ) s;
$function$;

REVOKE ALL ON FUNCTION public.search_term_tokens(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_term_tokens(text) TO authenticated, service_role;
