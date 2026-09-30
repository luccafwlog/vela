-- Migration 113: VIT passa a ser alias de Vitória (BRVIX) no banco.
--
-- normalize_port_code já dobrava BRVIT, VIX e VITORIA em BRVIX, então a
-- tabela de taxas locais de BRVIX já vale para B/Ls com POD BRVIT. Faltava a
-- sigla curta VIT. O corpo é lido do catálogo e o trecho trocado com
-- verificação: se não for encontrado a migration falha. Não altera linhas.
DO $migration$
DECLARE
  v_def TEXT := pg_get_functiondef('public.normalize_port_code(text)'::regprocedure);
BEGIN
  IF position($o$IN ('BRVIT', 'VITORIA',$o$ IN v_def) = 0 THEN
    RAISE EXCEPTION 'Migration 113: trecho de Vitória não encontrado em normalize_port_code.';
  END IF;
  EXECUTE replace(v_def, $o$IN ('BRVIT', 'VITORIA',$o$, $n$IN ('BRVIT', 'VIT', 'VITORIA',$n$);
END
$migration$;
