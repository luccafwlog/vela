-- 237: Baplie sem container é recusado no banco (item P13 do plano de
-- correções; ADR 0085, D15).
--
-- Problema (reproduzido no Postgres local em 2026-10-14):
-- `import_baplie_staging_transactional` aceitava `p_rows` vazio pela API e
-- apagava o Baplie da viagem, sem substituto. A tela já bloqueia a importação
-- sem container (`canImportPreview`).
--
-- Mudança: o envelope recusa lista ausente, que não seja array ou vazia, com
-- mensagem, antes de tocar no Baplie anterior. O resto é o envelope da
-- migration 189 (contexto de importação e corpo `_legacy_189`).
--
-- Só redefine uma função; não reescreve nem apaga linhas.
-- Rollback: reaplicar o envelope sem a checagem (`_set_import_context` e
-- `RETURN public.import_baplie_staging_transactional_legacy_189(...)`).

CREATE OR REPLACE FUNCTION public.import_baplie_staging_transactional(p_voyage_id bigint, p_rows jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF jsonb_typeof(COALESCE(p_rows, 'null'::jsonb)) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION 'O Baplie não tem nenhum container: confira o arquivo antes de importar. O Baplie anterior da viagem foi mantido.'
      USING ERRCODE = '22023';
  END IF;
  PERFORM public._set_import_context('Baplie', p_voyage_id, NULL);
  RETURN public.import_baplie_staging_transactional_legacy_189(p_voyage_id, p_rows);
END $function$;
