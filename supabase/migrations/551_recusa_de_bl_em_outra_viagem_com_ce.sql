-- 551: a recusa do B/L que já está em outra Viagem diz o caminho que funciona
-- com CE Mercante. Decisão do dono de 2026-10-30, na revisão da release #1117
-- (D1, opção a; relatório em docs/archive/audits/revisao-pr-1117-2026-10-30.md).
--
-- Problema:
--   As recusas mandavam "exclua o B/L lá e importe de novo". O B/L com CE
--   Mercante não se exclui (Trava de exclusão, "B/L com CE Mercante"), e o B/L
--   cancelado é somente leitura, inclusive o CE: quem seguia o texto parava na
--   próxima recusa. O B/L cancelado quase sempre tem CE, porque a tela só
--   oferece Cancelar B/L para B/L com CE.
--
-- Mudança (só os textos; condição, código de erro e ordem não mudam):
--   1. Arquivo de B/L (`import_bl_freight_file_atomic_core_405`), B/L cancelado
--      em outra Viagem: "Reative o B/L na Viagem …, tire o CE Mercante, exclua o
--      B/L e importe de novo."
--   2. Arquivo de B/L, B/L ativo em outra Viagem, e carga solta
--      (`import_breakbulk_manifest_transactional_legacy_189`): "exclua o B/L lá
--      (se tiver CE Mercante, tire o CE antes) e importe de novo (cancelar não
--      libera o número)."
--   A prévia da tela (`blFreightImport.ts`, `breakbulkImport.ts`) usa os mesmos
--   textos.
--
-- Só redefine funções; não reescreve nem apaga linhas.
-- Rollback: trocar os textos de volta pelos da 509 e da 511.

DO $patch$
DECLARE
  v_def text;
  v_old_cancelled text := $s$'O B/L % está cancelado na Viagem %: o número continua lá. Exclua o B/L na Viagem % e importe de novo.'$s$;
  v_new_cancelled text := $s$'O B/L % está cancelado na Viagem %: o número continua lá. Reative o B/L na Viagem %, tire o CE Mercante, exclua o B/L e importe de novo.'$s$;
  v_old_active text := $s$exclua o B/L lá e importe de novo (cancelar não libera o número).$s$;
  v_new_active text := $s$exclua o B/L lá (se tiver CE Mercante, tire o CE antes) e importe de novo (cancelar não libera o número).$s$;
BEGIN
  v_def := pg_get_functiondef('public.import_bl_freight_file_atomic_core_405(jsonb, uuid, jsonb)'::regprocedure);
  IF (length(v_def) - length(replace(v_def, v_old_cancelled, ''))) / length(v_old_cancelled) <> 1 THEN
    RAISE EXCEPTION '551: texto do B/L cancelado não encontrado uma única vez em import_bl_freight_file_atomic_core_405';
  END IF;
  IF (length(v_def) - length(replace(v_def, v_old_active, ''))) / length(v_old_active) <> 1 THEN
    RAISE EXCEPTION '551: texto do B/L em outra Viagem não encontrado uma única vez em import_bl_freight_file_atomic_core_405';
  END IF;
  EXECUTE replace(replace(v_def, v_old_cancelled, v_new_cancelled), v_old_active, v_new_active);

  v_def := pg_get_functiondef('public.import_breakbulk_manifest_transactional_legacy_189(text, bigint, uuid, integer, jsonb, jsonb, jsonb)'::regprocedure);
  IF (length(v_def) - length(replace(v_def, v_old_active, ''))) / length(v_old_active) <> 1 THEN
    RAISE EXCEPTION '551: texto do B/L em outra Viagem não encontrado uma única vez em import_breakbulk_manifest_transactional_legacy_189';
  END IF;
  EXECUTE replace(v_def, v_old_active, v_new_active);
END;
$patch$;
