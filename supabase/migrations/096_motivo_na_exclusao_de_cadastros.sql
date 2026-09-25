-- Motivo gravado nas exclusões de cadastro que não passam por delete_records
-- (ADR 0072; plano docs/plans/2026-09-24-politica-de-exclusao.md, Fase 3).
--
-- - delete_catalog_row(table, id, reason) exclui uma linha de tabela de taxa,
--   local, serviço de local ou linha de serviço de vazios, exigindo motivo.
--   Mantém quem podia excluir: o Administrativo ativo; na linha de serviço de
--   vazios, qualquer usuário ativo (política da 087).
-- - audit_row_changes grava o motivo (vela.delete_reason, local à transação)
--   na justificativa do registro "excluido".
-- - DELETE direto dessas tabelas pela API deixa de existir: sem isso, uma
--   chamada fora da RPC excluiria sem motivo.
-- - customer_demurrage_agreements passa a ter o trigger de auditoria que as
--   outras tabelas de taxa já tinham.
--
-- Não reescreve nem exclui linhas existentes.

CREATE OR REPLACE FUNCTION public.audit_row_changes() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_old JSONB := CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) ELSE '{}'::jsonb END;
  v_new JSONB := CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) ELSE '{}'::jsonb END;
  v_key_parts TEXT[] := string_to_array(COALESCE(TG_ARGV[0], 'id'), ',');
  v_entity_id TEXT;
  v_field RECORD;
BEGIN
  SELECT string_agg(COALESCE(v_new ->> k, v_old ->> k), '/')
    INTO v_entity_id
    FROM unnest(v_key_parts) AS k;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.audit_logs(entity_type, entity_id, field_name, new_value, changed_by)
    VALUES (TG_TABLE_NAME, v_entity_id, 'criado', v_new::TEXT, auth.uid());
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, changed_by, justification)
    VALUES (TG_TABLE_NAME, v_entity_id, 'excluido', v_old::TEXT, auth.uid(),
            NULLIF(btrim(current_setting('vela.delete_reason', true)), ''));
  ELSE
    FOR v_field IN
      SELECT key, value AS old_value, v_new ->> key AS new_value
      FROM jsonb_each_text(v_old)
      WHERE v_old ->> key IS DISTINCT FROM v_new ->> key
    LOOP
      INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by)
      VALUES (TG_TABLE_NAME, v_entity_id, v_field.key, v_field.old_value, v_field.new_value, auth.uid());
    END LOOP;
    FOR v_field IN
      SELECT key, value AS new_value
      FROM jsonb_each_text(v_new)
      WHERE NOT (v_old ? key)
    LOOP
      INSERT INTO public.audit_logs(entity_type, entity_id, field_name, new_value, changed_by)
      VALUES (TG_TABLE_NAME, v_entity_id, v_field.key, v_field.new_value, auth.uid());
    END LOOP;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_catalog_row(p_table text, p_id text, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_count integer;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Somente o Administrativo pode excluir.' USING ERRCODE = '42501';
  END IF;
  -- Linha de serviço de vazios é custo interno: qualquer usuário ativo exclui
  -- (ADR 0071, política da migration 087). O resto é do Administrativo.
  IF p_table <> 'vazios_export_service_lines' AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Somente o Administrativo pode excluir.' USING ERRCODE = '42501';
  END IF;
  IF p_table NOT IN (
    'granite_rates', 'depots', 'depot_services', 'vazios_export_service_lines',
    'demurrage_rates', 'customer_demurrage_agreements', 'customer_rate_overrides',
    'charge_table_items'
  ) THEN
    RAISE EXCEPTION 'Tabela fora da exclusão de cadastro: %.', p_table USING ERRCODE = '22023';
  END IF;
  IF NULLIF(btrim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'Informe o motivo da exclusão.' USING ERRCODE = '22023';
  END IF;

  PERFORM set_config('vela.delete_reason', btrim(p_reason), true);
  -- ponytail: id::text evita um ramo por tipo de chave (uuid/bigint); perde o
  -- índice, aceitável em cadastros pequenos. Se uma tabela crescer, comparar
  -- no tipo da coluna.
  EXECUTE format('DELETE FROM public.%I WHERE id::text = $1', p_table) USING p_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  PERFORM set_config('vela.delete_reason', '', true);

  IF v_count = 0 THEN
    RAISE EXCEPTION 'Nada foi excluído: o registro já não existe.' USING ERRCODE = 'P0002';
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.delete_catalog_row(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_catalog_row(text, text, text) TO authenticated;

REVOKE DELETE ON public.granite_rates, public.depots, public.depot_services,
  public.vazios_export_service_lines, public.demurrage_rates,
  public.customer_demurrage_agreements, public.customer_rate_overrides,
  public.charge_table_items
FROM authenticated;

DROP POLICY IF EXISTS granite_rates_delete_admin ON public.granite_rates;
DROP POLICY IF EXISTS depots_delete_global ON public.depots;
DROP POLICY IF EXISTS depot_services_delete_global ON public.depot_services;
DROP POLICY IF EXISTS vazios_export_service_lines_write_global_delete ON public.vazios_export_service_lines;
DROP POLICY IF EXISTS demurrage_rates_admin_delete_global ON public.demurrage_rates;
DROP POLICY IF EXISTS customer_rate_overrides_delete_local_charges_global ON public.customer_rate_overrides;
DROP POLICY IF EXISTS charge_table_items_delete_local_charges_global ON public.charge_table_items;

DROP TRIGGER IF EXISTS audit_customer_demurrage_agreements ON public.customer_demurrage_agreements;
CREATE TRIGGER audit_customer_demurrage_agreements
  AFTER INSERT OR DELETE OR UPDATE ON public.customer_demurrage_agreements
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_changes('id');
