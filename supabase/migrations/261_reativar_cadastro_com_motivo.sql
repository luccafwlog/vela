-- Item 35 (B13) do plano 2026-10-14: reativar tarifa (tabela e item de Taxas
-- Locais, Condição de Cliente, tarifa e acordo de Demurrage, taxa de Granito)
-- e reativar usuário interno pedem motivo, gravado no rastro (ADR 0072; ADR
-- 0073, item 4). Reativar segue do Administrativo. O motivo vai numa linha
-- própria de audit_logs ('reativado') e, pelo contexto de importação, na linha
-- que o gatilho de auditoria grava para a troca de `active`.
-- Só cria a função; não reescreve nem apaga linhas.

CREATE OR REPLACE FUNCTION public.reactivate_catalog_row(p_table text, p_id text, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_count integer;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Somente o Administrativo reativa.' USING ERRCODE = '42501';
  END IF;
  IF p_table NOT IN (
    'charge_tables', 'charge_table_items', 'customer_rate_overrides',
    'demurrage_rates', 'customer_demurrage_agreements', 'granite_rates', 'user_profiles'
  ) THEN
    RAISE EXCEPTION 'Tabela fora da reativação de cadastro: %.', p_table USING ERRCODE = '22023';
  END IF;
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'Informe o motivo da reativação.' USING ERRCODE = '22023';
  END IF;

  PERFORM set_config('vela.import_context', 'Reativação: ' || v_reason, true);
  -- ponytail: id::text evita um ramo por tipo de chave (uuid/bigint), como em
  -- delete_catalog_row; cadastros pequenos.
  EXECUTE format('UPDATE public.%I SET active = true WHERE id::text = $1 AND active = false', p_table) USING p_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  PERFORM set_config('vela.import_context', '', true);

  IF v_count = 0 THEN
    RAISE EXCEPTION 'Nada foi reativado: o registro não existe ou já está ativo.' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  VALUES (p_table, p_id, 'reativado', 'false', 'true', auth.uid(), v_reason);
END;
$function$;

REVOKE ALL ON FUNCTION public.reactivate_catalog_row(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reactivate_catalog_row(text, text, text) TO authenticated;
