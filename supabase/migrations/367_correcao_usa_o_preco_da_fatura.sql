-- 367: a correção do B/L faturado cota pelo preço da fatura original (ADR
-- 0093, decisão 4; plano da frente financeira, F-17).
--
-- Depende do "Data status" do AGENTS.md: reescreve o preço congelado dos B/Ls
-- já faturados (gravado pela 355 com o preço de hoje), sem plano de
-- preservação, porque as linhas de produção são de teste.
--
-- Problema: `apply_invoice_basis_changes` (130) cotava a base nova com a
-- tabela e a Condição de hoje (`_quote_bl_local_charges`, 136): a tabela
-- reajustada fazia uma edição neutra reemitir a fatura com o preço novo.
--
-- Mudança: desde as migrations 354 e 355 a cotação usa a tabela vinculada e o
-- preço congelado no CE, que é o preço da fatura emitida; uma tabela nova não
-- muda mais a correção. Para as faturas emitidas antes da 355, o preço
-- congelado passa a ser o das linhas da última fatura viva do B/L, e não o
-- de hoje. A correção de item ou de
-- Condição (decisão 2) continua atualizando o preço congelado.

-- ponytail: a linha da fatura não diz se o preço veio da Condição; quando o
-- congelamento tem Condição, o preço da fatura vai para ela, senão para o
-- preço do item. Uma Condição criada depois do CE e antes desta migration
-- pode ficar trocada pelo preço do item; a correção da Condição a refaz.
UPDATE public.bl_price_freeze_items AS fi
   SET override_value = CASE WHEN fi.override_value IS NOT NULL THEN src.unit END,
       unit_value_brl = CASE WHEN fi.override_value IS NULL AND src.currency <> 'USD' THEN src.unit ELSE fi.unit_value_brl END,
       unit_value_usd = CASE WHEN fi.override_value IS NULL AND src.currency = 'USD' THEN src.unit ELSE fi.unit_value_usd END
  FROM (
    SELECT DISTINCT ON (ii.bl_id, ii.charge_item_id)
      ii.bl_id, ii.charge_item_id, coalesce(ii.currency, 'BRL') AS currency,
      CASE WHEN coalesce(ii.currency, 'BRL') = 'USD' THEN ii.unit_value_usd ELSE ii.unit_value_brl END AS unit
    FROM public.invoice_items ii
    JOIN public.invoices i ON i.id = ii.invoice_id
    WHERE i.invoice_type = 'individual'
      AND coalesce(i.status, 'issued') IN ('issued', 'partially_paid', 'paid', 'covered')
      AND ii.charge_item_id IS NOT NULL
      AND coalesce(ii.calculation_key, '') NOT LIKE '%:imo_oog'
      AND coalesce(ii.source, '') <> 'manual'
    ORDER BY ii.bl_id, ii.charge_item_id, i.id DESC
  ) AS src
 WHERE fi.bl_id = src.bl_id AND fi.charge_item_id = src.charge_item_id AND src.unit IS NOT NULL;
