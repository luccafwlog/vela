-- Migration 073: Purgar linhas espúrias de frete (cabeçalho de bloco "11. Freight & Charges"
-- e cláusulas jurídicas contratuais do B/L) capturadas indevidamente em public.bl_freight_lines.

DELETE FROM public.bl_freight_lines
WHERE
  -- 1. Cabeçalho de bloco impresso do formulário de B/L
  description ~* '^(11[.\s]*)?freight\s*(&|and)\s*charges'
  OR description ~* '^(revenue\s*tons?|rate|per|prepaid|collect)$'
  -- 2. Cláusulas jurídicas e contratuais do B/L
  OR description ~* '^4[.\s]'
  OR description ~* '(received\s+(in|by)\s+(external\s+)?apparent|apparent\s+good\s+order|shipper''?s\s+load|notwithstanding\s+any\s+provision|terms\s+and\s+conditions|particulars\s+furnished)'
  OR (length(description) > 50 AND description ~* '(carrier|order|goods|container|liability)');
