-- 061: peso do B/L com semantica unica, e dois ajustes de trigger/catalogo
--
-- Achados B3-R, M10 e M11 da revisao final da PR 698.
--
-- B3-R. A migration 060 passou o resumo operacional a somar os dois pesos
-- (`total_weight_kg / 1000 + bb_weight_ton`), o que corrigiu o B/L misto e
-- quebrou o B/L de carga solta puro: os importadores de carga solta gravavam a
-- MESMA carga nas duas colunas (`breakbulkManifestParser`, `blDocumentParser` e
-- `useBlEditForm` espelhavam `total_weight_kg = bb_weight_ton * 1000`), entao a
-- soma contava o peso duas vezes. O `coalesce(bb_weight_ton, total_weight_kg /
-- 1000)` anterior era o desempate desse espelhamento -- e subcontava o misto.
--
-- Nenhuma formula resolve isso enquanto a coluna tiver dois significados: um
-- B/L misto com `total_weight_kg = 20000` e `bb_weight_ton = 20` e
-- indistinguivel, no banco, de um B/L que veio da carga solta espelhada. A
-- correcao e dar um significado unico a cada coluna:
--
--   bls.total_weight_kg -> SOMENTE carga conteinerizada
--   bls.bb_weight_ton   -> SOMENTE carga solta
--
-- Com as colunas disjuntas, a soma aditiva da 060 fica correta por construcao,
-- em qualquer ordem de chegada da carga. O lado da aplicacao para de espelhar
-- no mesmo commit; esta migration limpa o espelhamento ja gravado.

-- ---------------------------------------------------------------------------
-- 1. Backfill: apagar o peso espelhado, preservando peso de conteiner legitimo
-- ---------------------------------------------------------------------------

-- Só é espelhamento quando as duas colunas medem a mesma carga (tolerancia de
-- 1 kg para o arredondamento kg->ton do parser). Um B/L misto cujo
-- total_weight_kg seja um peso de conteiner de verdade difere de bb_weight_ton
-- e fica intocado.
UPDATE public.bls
SET total_weight_kg = NULL,
    updated_at = now()
WHERE cargo_mode IN ('carga_solta', 'misto')
  AND bb_weight_ton IS NOT NULL
  AND total_weight_kg IS NOT NULL
  AND abs(total_weight_kg - bb_weight_ton * 1000) <= 1;

COMMENT ON COLUMN public.bls.total_weight_kg IS
  'Peso da carga CONTEINERIZADA, em kg. Nao inclui carga solta: esta fica em '
  'bb_weight_ton. As duas colunas sao disjuntas e somam para o peso total do '
  'B/L (ver operational_list_bl_summary e blTotalWeightKg no TypeScript).';

COMMENT ON COLUMN public.bls.bb_weight_ton IS
  'Peso da CARGA SOLTA, em toneladas. Nao inclui carga conteinerizada: esta '
  'fica em total_weight_kg.';

-- ---------------------------------------------------------------------------
-- 2. M10: ressincronizar o recebivel uma vez por B/L, nao uma vez por linha
-- ---------------------------------------------------------------------------

-- A versao FOR EACH ROW da 060 disparava um sync_local_charge_receivable
-- completo por taxa manual lancada; N taxas no mesmo statement viravam N
-- ressincronizacoes do mesmo B/L. O padrao correto ja estava em uso nos
-- triggers de cargo_mode da propria 060 (statement + transition table).
CREATE OR REPLACE FUNCTION public.trg_sync_manual_local_charge_receivable_statement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_row record;
  v_sql text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    v_sql := format(
      'SELECT DISTINCT bl_id FROM (SELECT bl_id, source FROM %I UNION ALL SELECT bl_id, source FROM %I) rows WHERE source = ''manual'' AND bl_id IS NOT NULL',
      TG_ARGV[0], TG_ARGV[1]
    );
  ELSE
    v_sql := format(
      'SELECT DISTINCT bl_id FROM %I WHERE source = ''manual'' AND bl_id IS NOT NULL',
      TG_ARGV[0]
    );
  END IF;

  FOR v_row IN EXECUTE v_sql LOOP
    IF EXISTS (
      SELECT 1 FROM public.bl_receivables
      WHERE bl_id = v_row.bl_id AND source = 'local_charges'
    ) THEN
      PERFORM public.sync_local_charge_receivable(v_row.bl_id);
    END IF;
  END LOOP;
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.trg_sync_manual_local_charge_receivable_statement() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_sync_manual_local_charge_receivable ON public.charge_calculations;
DROP TRIGGER IF EXISTS trg_sync_manual_local_charge_receivable_insert_stmt ON public.charge_calculations;
DROP TRIGGER IF EXISTS trg_sync_manual_local_charge_receivable_update_stmt ON public.charge_calculations;
DROP TRIGGER IF EXISTS trg_sync_manual_local_charge_receivable_delete_stmt ON public.charge_calculations;

CREATE TRIGGER trg_sync_manual_local_charge_receivable_insert_stmt
AFTER INSERT ON public.charge_calculations
REFERENCING NEW TABLE AS new_rows
FOR EACH STATEMENT EXECUTE FUNCTION public.trg_sync_manual_local_charge_receivable_statement('new_rows');

CREATE TRIGGER trg_sync_manual_local_charge_receivable_update_stmt
AFTER UPDATE ON public.charge_calculations
REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
FOR EACH STATEMENT EXECUTE FUNCTION public.trg_sync_manual_local_charge_receivable_statement('new_rows', 'old_rows');

CREATE TRIGGER trg_sync_manual_local_charge_receivable_delete_stmt
AFTER DELETE ON public.charge_calculations
REFERENCING OLD TABLE AS old_rows
FOR EACH STATEMENT EXECUTE FUNCTION public.trg_sync_manual_local_charge_receivable_statement('old_rows');

-- A implementacao row-level da 060 nao esta mais ligada a nenhum trigger; o
-- simbolo permanece no catalogo para nao quebrar o historico de replay.
COMMENT ON FUNCTION public.trg_sync_manual_local_charge_receivable() IS
  'INERTE desde a migration 061: substituida por '
  'trg_sync_manual_local_charge_receivable_statement(). Mantida apenas para '
  'preservar o historico de replay das migrations.';

-- ---------------------------------------------------------------------------
-- 3. M11: marcar a produtora legada de comunicados como inerte
-- ---------------------------------------------------------------------------

COMMENT ON FUNCTION public.evaluate_and_dispatch_automatic_communications_045(timestamptz) IS
  'INERTE desde a migration 060: a producao de comunicados automaticos tem uma '
  'unica produtora, evaluate_and_dispatch_automatic_communications(timestamptz), '
  'que compoe todos os B/Ls elegiveis do cliente antes de criar a claim. Esta '
  'funcao nao e mais chamada por ninguem e existe apenas para preservar o '
  'historico de replay das migrations.';
