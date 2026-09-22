-- Migration 073: Purgar linhas espúrias de frete (cabeçalho de bloco "11. Freight & Charges"
-- e cláusulas jurídicas contratuais do B/L) capturadas indevidamente em public.bl_freight_lines.
--
-- Esta migration depende da afirmação "Data status" da seção Gotchas do AGENTS.md:
-- o banco de produção ainda contém somente fixtures descartáveis. O critério
-- abaixo é deliberadamente restrito às linhas sem valor (`amount IS NULL`), que
-- é o estado persistido de cabeçalhos/cláusulas textuais rejeitados pelo parser.
-- `seq` é somente a ordem de exibição; não há consumidor que exija sequência
-- contínua, e uma reimportação já recria as linhas a partir de 1.

DELETE FROM public.bl_freight_lines
WHERE amount IS NULL
  AND (
    -- Cabeçalho: igualdade após colapsar espaços, como no parser.
    regexp_replace(trim(coalesce(description, '')), '[[:space:]]+', ' ', 'g') ~* '^(11[.[:space:]]*)?freight[[:space:]]*(&|and)[[:space:]]*charges$'
    OR regexp_replace(trim(coalesce(description, '')), '[[:space:]]+', ' ', 'g') ~* '^(revenue[[:space:]]*tons?|rate|per|prepaid|collect)$'
    -- Cláusulas: frases contratuais ancoradas, sem heurística de tamanho ou substring.
    OR regexp_replace(trim(coalesce(description, '')), '[[:space:]]+', ' ', 'g') ~* '^(4[.][[:space:]]*)?received[[:space:]]+(in|by)[[:space:]]+.*apparent[[:space:]]+good[[:space:]]+order'
    OR regexp_replace(trim(coalesce(description, '')), '[[:space:]]+', ' ', 'g') ~* '^apparent[[:space:]]+good[[:space:]]+order'
    OR regexp_replace(trim(coalesce(description, '')), '[[:space:]]+', ' ', 'g') ~* '^shipper''?s[[:space:]]+load'
    OR regexp_replace(trim(coalesce(description, '')), '[[:space:]]+', ' ', 'g') ~* '^notwithstanding[[:space:]]+any[[:space:]]+provision'
    OR regexp_replace(trim(coalesce(description, '')), '[[:space:]]+', ' ', 'g') ~* '^terms[[:space:]]+and[[:space:]]+conditions'
    OR regexp_replace(trim(coalesce(description, '')), '[[:space:]]+', ' ', 'g') ~* '^particulars[[:space:]]+furnished'
  );
