-- 389 — Importações: guarda de permissão antes da trava da Viagem.
--
-- A 387 pôs a trava `import_voyage:<id>` como primeiro passo das RPCs de
-- importação. Em `apply_baplie_physical_flags_atomic` e
-- `import_vehicle_rows_transactional` a guarda de usuário ativo só existia no
-- corpo delegado (renomeado nas migrations `126` e `189`), então um usuário sem
-- permissão ativa chegava a segurar a Viagem antes de ser recusado, e
-- `scripts/security/verificar_guardas.py` não via guarda nenhuma na função
-- exposta. A guarda passa a ser o primeiro passo; o corpo delegado continua
-- conferindo o que já conferia (inclusive `p_changed_by` = usuário da sessão).
-- Só redefine funções.

CREATE OR REPLACE FUNCTION public.apply_baplie_physical_flags_atomic(p_voyage_id bigint, p_changes jsonb, p_changed_by uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa.' USING ERRCODE = '42501';
  END IF;
  PERFORM public._lock_import_voyages(ARRAY[p_voyage_id]);
  PERFORM public._set_import_context('Baplie (marcas)', p_voyage_id, NULL);
  RETURN public.apply_baplie_physical_flags_atomic_legacy_189(p_voyage_id, p_changes, p_changed_by);
END $function$;

REVOKE ALL ON FUNCTION public.apply_baplie_physical_flags_atomic(bigint, jsonb, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_baplie_physical_flags_atomic(bigint, jsonb, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.import_vehicle_rows_transactional(p_rows jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa.' USING ERRCODE = '42501';
  END IF;
  PERFORM public._lock_import_voyages_of_bls(public._import_payload_voyage_ids(p_rows, 'voyage_id'), public._import_payload_texts(p_rows, 'bl_id'));
  PERFORM public._set_import_context('Veículos', (p_rows->0->>'voyage_id')::bigint, NULL);
  RETURN public.import_vehicle_rows_transactional_legacy_189(p_rows);
END $function$;

REVOKE ALL ON FUNCTION public.import_vehicle_rows_transactional(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_vehicle_rows_transactional(jsonb) TO authenticated;
