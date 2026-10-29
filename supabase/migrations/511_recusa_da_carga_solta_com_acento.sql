-- 511: a recusa da carga solta (Manifesto BB e B/L avulso) para B/L que já
-- está em outra Viagem sai com acento. A migration 500 trocou a orientação
-- (excluir o B/L na outra Viagem e importar de novo) com o texto sem acento, e
-- a tela mostra a recusa do banco como veio (P0005, `classifyDbError`):
-- "exclua o B/L la e importe de novo (cancelar nao libera o numero)", enquanto
-- a prévia já dizia "lá", "não" e "número". Achado da revisão da PR #1084.
--
-- Só troca o texto do RAISE em
-- `import_breakbulk_manifest_transactional_legacy_189` (definição vigente da
-- 500), pelo mesmo remendo da 500. SQLSTATE P0005, parâmetros e o resto da
-- função ficam iguais; CREATE OR REPLACE preserva dono e grants.
--
-- Só redefine função; não reescreve nem apaga linhas.
-- Rollback: reaplicar a 500 (o texto sem acento) pelo mesmo remendo.

DO $patch$
DECLARE
  v_def text;
  v_old text := $s$'O B/L % ja esta na Viagem % e o arquivo foi importado na Viagem %. Nenhum B/L do lote foi gravado: exclua o B/L la e importe de novo (cancelar nao libera o numero).'$s$;
  v_new text := $s$'O B/L % já está na Viagem % e o arquivo foi importado na Viagem %. Nenhum B/L do lote foi gravado: exclua o B/L lá e importe de novo (cancelar não libera o número).'$s$;
BEGIN
  v_def := pg_get_functiondef('public.import_breakbulk_manifest_transactional_legacy_189(text,bigint,uuid,integer,jsonb,jsonb,jsonb)'::regprocedure);
  IF position(v_old IN v_def) = 0 THEN
    RAISE EXCEPTION '511: trecho não encontrado em import_breakbulk_manifest_transactional_legacy_189';
  END IF;
  IF position(v_old IN substr(v_def, position(v_old IN v_def) + 1)) > 0 THEN
    RAISE EXCEPTION '511: trecho repetido em import_breakbulk_manifest_transactional_legacy_189';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END;
$patch$;
