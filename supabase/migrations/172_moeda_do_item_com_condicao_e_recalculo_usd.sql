-- 172: efeitos da migration 171 (Condição de Cliente vale na moeda do item).
--
-- 1. Item de Taxa com Condição de Cliente ativa não troca de moeda. A condição
--    guarda só o número, na moeda do item (CONTEXT.md, "Condição de Cliente");
--    trocar a moeda reinterpretaria o valor negociado (R$ 1.200 viraria
--    US$ 1.200). Para cobrar em outra moeda, cadastra-se um item novo e as
--    condições são recadastradas nele. Decisão do responsável em 2026-10-09
--    (revisão da PR 923).
--
-- 2. Recalcula os B/Ls não faturados e não cancelados que ainda têm linha
--    automática em item em dólar gravada com `override_applied = true`: é a
--    marca do erro corrigido pela 171 (valor da tabela com a condição dada
--    como aplicada). Sem isso, eles seriam faturados acima do negociado até
--    alguém recalcular. Usa o mesmo motor do botão de recálculo
--    (`_calculate_bl_local_charges_impl_106`), que recusa B/L faturado
--    (migration 262) e preserva linhas manuais. Falha de um B/L não aborta os
--    demais: vira aviso e o B/L fica como estava.
--
--    Reescreve linhas de `charge_calculations` dos B/Ls afetados. Isso depende
--    da afirmação "Data status" do AGENTS.md (produção só com dados de
--    teste); ver também a consulta dos B/Ls já faturados em
--    docs/modules/taxas-locais.md.
--
-- Rollback: DROP TRIGGER charge_table_items_currency_locked_by_condition ON
-- public.charge_table_items; DROP FUNCTION
-- public.guard_charge_item_currency_with_condition(). O recálculo não tem
-- volta automática: reaplicar a 129 e recalcular os mesmos B/Ls.

CREATE OR REPLACE FUNCTION public.guard_charge_item_currency_with_condition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_count integer;
BEGIN
  IF COALESCE(NEW.currency, 'BRL') IS NOT DISTINCT FROM COALESCE(OLD.currency, 'BRL') THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM public.customer_rate_overrides AS cro
  WHERE cro.charge_item_id = OLD.id
    AND cro.active;

  IF v_count > 0 THEN
    RAISE EXCEPTION 'O item "%" tem % condição(ões) de Cliente ativa(s) na moeda atual. Para cobrar em outra moeda, cadastre um item novo e recadastre as condições nele.', OLD.name, v_count
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.guard_charge_item_currency_with_condition() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS charge_table_items_currency_locked_by_condition ON public.charge_table_items;
CREATE TRIGGER charge_table_items_currency_locked_by_condition
  BEFORE UPDATE OF currency ON public.charge_table_items
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_charge_item_currency_with_condition();

DO $recalc$
DECLARE
  v_bl_id text;
  v_done integer := 0;
  v_failed integer := 0;
BEGIN
  FOR v_bl_id IN
    SELECT DISTINCT cc.bl_id
    FROM public.charge_calculations AS cc
    JOIN public.charge_table_items AS cti ON cti.id = cc.charge_item_id
    JOIN public.bls AS b ON b.id = cc.bl_id
    WHERE COALESCE(cc.source, 'auto') = 'auto'
      AND cc.override_applied
      AND cti.currency = 'USD'
      AND b.cancelled_at IS NULL
      AND COALESCE(b.financial_status, 'pending') NOT IN ('invoiced', 'partially_paid', 'paid')
    ORDER BY cc.bl_id
  LOOP
    BEGIN
      PERFORM public._calculate_bl_local_charges_impl_106(v_bl_id, NULL, true);
      v_done := v_done + 1;
    EXCEPTION WHEN OTHERS THEN
      v_failed := v_failed + 1;
      RAISE WARNING '172: recálculo do B/L % falhou: %', v_bl_id, SQLERRM;
    END;
  END LOOP;

  RAISE NOTICE '172: % B/L(s) recalculado(s) com a Condição de Cliente em dólar; % falha(s).', v_done, v_failed;
END;
$recalc$;
