-- 488: o gatilho que liga o registro de taxa ao B/L no Histórico lê pela
-- chave primária (revisão da PR #1070, achado M14).
--
-- Problema: `audit_logs_fill_charge_bl_id` (470) achava a taxa por
-- `charge_calculations.id::text = entity_id`; o cast impede o índice e cada
-- registro de taxa lia a tabela inteira dentro da transação de quem grava
-- (um recálculo de Viagem grava milhares deles).
--
-- Mudança: a busca converte o `entity_id` numérico para `bigint` e usa a chave
-- primária. Não reescreve dados existentes.
--
-- Rollback: reaplicar `audit_logs_fill_charge_bl_id` da `470`.

CREATE OR REPLACE FUNCTION public.audit_logs_fill_charge_bl_id()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.bl_id IS NULL AND NEW.entity_type IN ('charge_calculation', 'charge_calculations') THEN
    -- 488 (M14): pela chave primária; o `id::text` lia a tabela inteira a cada
    -- registro de taxa.
    IF NEW.entity_id ~ '^[0-9]{1,18}$' THEN
      SELECT cc.bl_id INTO NEW.bl_id FROM public.charge_calculations cc WHERE cc.id = NEW.entity_id::bigint;
    END IF;
    IF NEW.bl_id IS NULL THEN
      -- Linha já excluída: o B/L do registro anterior da mesma taxa (a exclusão
      -- pelo gatilho genérico entra antes, com o JSON da linha).
      SELECT coalesce(a.bl_id, public._audit_json_field(a.old_value, 'bl_id')) INTO NEW.bl_id
        FROM public.audit_logs a
       WHERE a.entity_type IN ('charge_calculation', 'charge_calculations') AND a.entity_id = NEW.entity_id
         AND coalesce(a.bl_id, public._audit_json_field(a.old_value, 'bl_id')) IS NOT NULL
       ORDER BY a.id DESC LIMIT 1;
    END IF;
    IF NEW.bl_id IS NULL AND NEW.entity_type = 'charge_calculations' THEN
      NEW.bl_id := public._audit_json_field(coalesce(NEW.old_value, NEW.new_value), 'bl_id');
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.audit_logs_fill_charge_bl_id() FROM PUBLIC, anon, authenticated;
