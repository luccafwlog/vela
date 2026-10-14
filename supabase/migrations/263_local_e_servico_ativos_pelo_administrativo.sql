-- Item 35 (B15) do plano 2026-10-14: desativar e reativar Local, terminal e
-- serviço do Local passam a ser do Administrativo, com diálogo, e reativar pede
-- motivo (ADR 0073, item 8; ADR 0072). O gatilho recusa a troca de `active`
-- fora do Administrativo, como nas tarifas (migration 091), e a reativação com
-- motivo (migration 261) passa a cobrir os dois cadastros.
-- Só cria gatilhos e redefine funções; não reescreve nem apaga linhas.

CREATE OR REPLACE FUNCTION public.guard_catalog_active_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF OLD.active IS DISTINCT FROM NEW.active AND auth.uid() IS NOT NULL AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Somente o Administrativo desativa ou reativa o cadastro.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_guard_catalog_active_change ON public.depots;
CREATE TRIGGER trg_guard_catalog_active_change
  BEFORE UPDATE OF active ON public.depots
  FOR EACH ROW EXECUTE FUNCTION public.guard_catalog_active_change();

DROP TRIGGER IF EXISTS trg_guard_catalog_active_change ON public.depot_services;
CREATE TRIGGER trg_guard_catalog_active_change
  BEFORE UPDATE OF active ON public.depot_services
  FOR EACH ROW EXECUTE FUNCTION public.guard_catalog_active_change();

-- Local e serviço novos nascem ativos fora do Administrativo.
CREATE OR REPLACE FUNCTION public.guard_catalog_insert_inactive()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NEW.active IS FALSE AND auth.uid() IS NOT NULL AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Somente o Administrativo cadastra o cadastro desativado.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_guard_catalog_insert_inactive ON public.depots;
CREATE TRIGGER trg_guard_catalog_insert_inactive
  BEFORE INSERT ON public.depots
  FOR EACH ROW EXECUTE FUNCTION public.guard_catalog_insert_inactive();

DROP TRIGGER IF EXISTS trg_guard_catalog_insert_inactive ON public.depot_services;
CREATE TRIGGER trg_guard_catalog_insert_inactive
  BEFORE INSERT ON public.depot_services
  FOR EACH ROW EXECUTE FUNCTION public.guard_catalog_insert_inactive();

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
    'demurrage_rates', 'customer_demurrage_agreements', 'granite_rates', 'user_profiles',
    'depots', 'depot_services'
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
