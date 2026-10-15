-- 268: o envelope do Baplie confere quem chama antes de validar a lista
-- (revisão da PR 954; item P13, migration 237).
--
-- Problema: a 237 recusava a lista vazia antes de qualquer conferência de
-- usuário. A guarda (`auth.uid() IS NULL OR NOT is_active_user()`, migration
-- 121) continuava no corpo `_legacy_189`, mas um usuário do Portal ou inativo
-- recebia a mensagem do Baplie (22023) em vez de 42501, e o replay de guardas
-- (`scripts/security/verificar_guardas.py`) não enxerga a guarda dentro do
-- corpo renomeado pela 189.
--
-- Mudança: o envelope recusa primeiro quem não é usuário interno ativo, depois
-- a lista vazia; o resto é o envelope da 237.
--
-- Só redefine uma função; não reescreve nem apaga linhas.
-- Rollback: reaplicar a definição da migration 237.

CREATE OR REPLACE FUNCTION public.import_baplie_staging_transactional(p_voyage_id bigint, p_rows jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Sem permissão para importar o Baplie.' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(COALESCE(p_rows, 'null'::jsonb)) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION 'O Baplie não tem nenhum container: confira o arquivo antes de importar. O Baplie anterior da viagem foi mantido.'
      USING ERRCODE = '22023';
  END IF;
  PERFORM public._set_import_context('Baplie', p_voyage_id, NULL);
  RETURN public.import_baplie_staging_transactional_legacy_189(p_voyage_id, p_rows);
END $function$;
