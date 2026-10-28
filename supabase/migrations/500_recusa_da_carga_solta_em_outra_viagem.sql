-- 500: a recusa da carga solta (Manifesto BB e B/L avulso) para B/L que já
-- está em outra Viagem dá a mesma orientação do arquivo de B/L de container
-- (BLR-026, migration 392): excluir o B/L na outra Viagem e importar de novo.
-- Decisão do dono em 2026-10-28 (catálogo de situações da importação, S6.03,
-- pergunta P1). O texto antigo mandava "corrigir a Viagem do B/L pela ficha",
-- mas a ficha não muda a Viagem e nenhuma função muda `bls.voyage_id`.
--
-- Só troca o texto do RAISE em
-- `import_breakbulk_manifest_transactional_legacy_189` (definição vigente da
-- 386), elo da cadeia import_breakbulk_manifest_transactional → _core_405 →
-- _legacy_189. SQLSTATE P0005, parâmetros e o resto da função ficam iguais;
-- CREATE OR REPLACE preserva dono e grants.
--
-- Só redefine função; não reescreve nem apaga linhas.
-- Rollback: reaplicar a função como estava na 386.

DO $patch$
DECLARE
  v_def text;
  v_old text := $s$Nenhum B/L do lote foi gravado: confira a Viagem de destino ou corrija a Viagem do B/L pela ficha.$s$;
  v_new text := $s$Nenhum B/L do lote foi gravado: exclua o B/L la e importe de novo (cancelar nao libera o numero).$s$;
BEGIN
  v_def := pg_get_functiondef('public.import_breakbulk_manifest_transactional_legacy_189(text,bigint,uuid,integer,jsonb,jsonb,jsonb)'::regprocedure);
  IF position(v_old IN v_def) = 0 THEN
    RAISE EXCEPTION '500: trecho não encontrado em import_breakbulk_manifest_transactional_legacy_189';
  END IF;
  IF position(v_old IN substr(v_def, position(v_old IN v_def) + 1)) > 0 THEN
    RAISE EXCEPTION '500: trecho repetido em import_breakbulk_manifest_transactional_legacy_189';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END;
$patch$;
