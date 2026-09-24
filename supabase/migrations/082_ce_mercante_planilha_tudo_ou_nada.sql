-- Migration 082: CE Mercante por planilha passa a ser "tudo ou nada", como o
-- EDI (decisão R12 de 2026-09-23, plano
-- docs/plans/2026-09-23-alinhamento-apresentacao-docs-codigo.md).
--
-- Antes, a tela chamava apply_ce_mercante_update (ou a versão de Granito) linha
-- a linha: um erro na linha 40 deixava as 39 anteriores gravadas, cada uma
-- podendo ter emitido fatura. Esta função aplica todas as linhas na mesma
-- transação. Cada linha roda num bloco próprio para que o resultado liste o
-- erro de TODAS as linhas; se houver qualquer erro, o bloco externo desfaz
-- tudo o que foi gravado (inclusive cálculo, fatura e Alertas disparados pelos
-- gatilhos) e a função devolve ok=false sem nenhuma alteração.
--
-- SECURITY INVOKER: as permissões continuam sendo as das funções por linha,
-- que validam usuário ativo e ator.
-- Não reescreve linhas existentes.

CREATE OR REPLACE FUNCTION public.apply_ce_mercante_rows_atomic(
  p_rows jsonb,
  p_changed_by uuid,
  p_target text DEFAULT 'bls'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_row jsonb;
  v_result text;
  v_errors jsonb := '[]'::jsonb;
  v_inserted integer := 0;
  v_overwritten integer := 0;
  v_unchanged integer := 0;
BEGIN
  IF p_target NOT IN ('bls', 'granite') THEN
    RAISE EXCEPTION 'Destino de CE Mercante inválido: %', p_target USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(COALESCE(p_rows, 'null'::jsonb)) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'errors', jsonb_build_array(jsonb_build_object('message', 'Nenhuma linha para importar.')));
  END IF;

  BEGIN
    FOR v_row IN SELECT value FROM jsonb_array_elements(p_rows)
    LOOP
      BEGIN
        IF p_target = 'granite' THEN
          v_result := public.apply_granite_ce_mercante_update((v_row->>'bl_id')::uuid, v_row->>'ce', p_changed_by);
        ELSE
          v_result := public.apply_ce_mercante_update(v_row->>'bl_id', v_row->>'ce', p_changed_by);
        END IF;
        CASE v_result
          WHEN 'overwritten' THEN v_overwritten := v_overwritten + 1;
          WHEN 'unchanged' THEN v_unchanged := v_unchanged + 1;
          ELSE v_inserted := v_inserted + 1;
        END CASE;
      EXCEPTION WHEN OTHERS THEN
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'row', v_row->'row',
          'bl_id', v_row->>'bl_id',
          'message', SQLERRM
        ));
      END;
    END LOOP;

    IF jsonb_array_length(v_errors) > 0 THEN
      -- Desfaz as linhas que tinham dado certo neste lote.
      RAISE EXCEPTION USING ERRCODE = 'P0099', MESSAGE = 'ce_rows_rollback';
    END IF;
  EXCEPTION WHEN SQLSTATE 'P0099' THEN
    RETURN jsonb_build_object('ok', false, 'errors', v_errors);
  END;

  RETURN jsonb_build_object(
    'ok', true,
    'processed', jsonb_array_length(p_rows),
    'inserted', v_inserted,
    'overwritten', v_overwritten,
    'unchanged', v_unchanged
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_ce_mercante_rows_atomic(jsonb, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_ce_mercante_rows_atomic(jsonb, uuid, text) TO authenticated;
