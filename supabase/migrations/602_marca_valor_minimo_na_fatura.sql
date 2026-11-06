-- 602: "Valor mínimo aplicado" no item da fatura (pedido do dono de
-- 2026-11-05, depois da 594; ADR 0125, "Situação atual").
--
-- O THD por tonelada da carga solta de Vitória cobra no mínimo R$ 380,00 por
-- B/L (594): a fatura mostrava "2 t × R$ 62,50 = R$ 380,00" sem explicação. O
-- item da fatura cuja linha calculada recebeu o mínimo passa a levar no
-- `snapshot_payload` a chave `minimum_value` ({"value_brl": 380.00}); a tela da
-- fatura no Vela, a do Portal e o documento impresso mostram "Valor mínimo
-- aplicado". O Portal recebe a chave (portal_invoice_details só tira
-- `charge_adjustment`).
--
-- Quem decide é `_invoice_item_minimum_value_brl`, com a mesma dona da regra
-- (`_thd_weight_ton_minimum_brl`): linha calculada sem taxa alterada à mão,
-- THD por tonelada em R$ de tabela com mínimo, total do item igual ao mínimo
-- e quantidade × unitário abaixo dele. O gatilho `mark_minimum_invoice_item`
-- (BEFORE INSERT, como `mark_adjusted_invoice_item` da 493) vale para toda
-- emissão: individual, consolidada, reemissão e correção.
--
-- Plano de preservação: o passo 3 grava em linhas existentes de
-- public.invoice_items, só as que a função acima reconhece (itens de THD por
-- tonelada da carga solta de Vitória cobrados pelo mínimo; em 2026-11-05, os
-- das faturas refeitas depois da 594). Só acrescenta a chave `minimum_value` ao
-- `snapshot_payload`; quantidade, unitário, total e as demais chaves não
-- mudam, e o valor anterior de cada linha fica em public.audit_logs (gatilho
-- audit_invoice_items, que grava a linha antes e depois). Conferir:
--   SELECT id, invoice_id, snapshot_payload->'minimum_value'
--     FROM public.invoice_items WHERE snapshot_payload ? 'minimum_value';
-- Desfazer: UPDATE public.invoice_items
--   SET snapshot_payload = snapshot_payload - 'minimum_value'
--   WHERE snapshot_payload ? 'minimum_value';
-- Rollback do resto: DROP TRIGGER mark_minimum_invoice_item ON
-- public.invoice_items; DROP FUNCTION public.mark_minimum_invoice_item() e
-- public._invoice_item_minimum_value_brl(bigint, numeric, numeric, numeric).

-- 1. Quem recebeu o mínimo ----------------------------------------------------

CREATE OR REPLACE FUNCTION public._invoice_item_minimum_value_brl(
  p_charge_calculation_id bigint, p_quantity numeric, p_unit_value_brl numeric, p_total_value_brl numeric)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  -- O mínimo (R$) que explica o total do item, ou NULL. A taxa alterada à mão
  -- (adjustment_id) é valor do operador, não o mínimo.
  SELECT m.minimum
    FROM public.charge_calculations AS cc
    JOIN public.charge_table_items AS cti ON cti.id = cc.charge_item_id
    JOIN public.charge_tables AS ct ON ct.id = cc.charge_table_id
    CROSS JOIN LATERAL (
      SELECT public._thd_weight_ton_minimum_brl(ct.cargo_mode, public.normalize_port_code(ct.pod)) AS minimum
    ) AS m
   WHERE cc.id = p_charge_calculation_id
     AND cc.source = 'auto'
     AND cc.adjustment_id IS NULL
     AND upper(coalesce(cti.name, '')) LIKE 'THD%'
     AND cti.application_basis = 'weight_ton'
     AND coalesce(cti.currency, 'BRL') <> 'USD'
     AND m.minimum IS NOT NULL
     AND p_total_value_brl = m.minimum
     AND round(coalesce(p_quantity, 0) * coalesce(p_unit_value_brl, 0), 2) < m.minimum;
$function$;
REVOKE ALL ON FUNCTION public._invoice_item_minimum_value_brl(bigint, numeric, numeric, numeric) FROM PUBLIC, anon, authenticated;

-- 2. Marca na emissão -----------------------------------------------------------

CREATE OR REPLACE FUNCTION public.mark_minimum_invoice_item()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_minimum numeric;
BEGIN
  IF NEW.charge_calculation_id IS NULL THEN
    RETURN NEW;
  END IF;
  v_minimum := public._invoice_item_minimum_value_brl(
    NEW.charge_calculation_id, NEW.quantity, NEW.unit_value_brl, NEW.total_value_brl);
  IF v_minimum IS NOT NULL THEN
    NEW.snapshot_payload := COALESCE(NEW.snapshot_payload, '{}'::jsonb)
      || jsonb_build_object('minimum_value', jsonb_build_object('value_brl', v_minimum));
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.mark_minimum_invoice_item() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS mark_minimum_invoice_item ON public.invoice_items;
CREATE TRIGGER mark_minimum_invoice_item BEFORE INSERT ON public.invoice_items
  FOR EACH ROW EXECUTE FUNCTION public.mark_minimum_invoice_item();

-- 3. Itens já emitidos com o mínimo (ver "Plano de preservação") ----------------

UPDATE public.invoice_items AS ii
   SET snapshot_payload = COALESCE(ii.snapshot_payload, '{}'::jsonb)
     || jsonb_build_object('minimum_value', jsonb_build_object('value_brl', m.minimum))
  FROM (
    SELECT i.id, public._invoice_item_minimum_value_brl(i.charge_calculation_id, i.quantity, i.unit_value_brl, i.total_value_brl) AS minimum
      FROM public.invoice_items AS i
     WHERE i.charge_calculation_id IS NOT NULL
       AND NOT (COALESCE(i.snapshot_payload, '{}'::jsonb) ? 'minimum_value')
  ) AS m
 WHERE ii.id = m.id
   AND m.minimum IS NOT NULL;
