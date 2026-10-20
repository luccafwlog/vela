-- 333 — Planilha de datas de descarga e devolução gravada numa vez só
-- (regra de 2026-10-19, lote 6a da identidade: importação com erro é recusada
-- inteira e não grava nada).
--
-- Antes, a tela chamava `apply_container_dates_atomic` uma vez por B/L e
-- seguia com os demais quando o banco recusava um (container que não pertence
-- ao B/L, devolução anterior à descarga gravada, prévia obsoleta): o arquivo
-- ficava gravado em parte ("Lote gravado em parte"). Agora a planilha inteira
-- vai numa chamada só:
--
--   `apply_container_dates_batch_atomic(p_request_id, p_batches, p_changed_by)`
--   `p_batches` = [{ "bl_id": "...", "rows": [ <linhas do contrato da RPC por B/L> ] }, ...]
--
-- Cada B/L passa pela mesma RPC por B/L de sempre (`apply_container_dates_atomic`,
-- invólucro da 189 que grava o contexto do Histórico e chama a
-- `_legacy_189` da 211), num bloco próprio para que a recusa de um B/L seja
-- anotada com o motivo sem interromper a conferência dos outros. No fim, se
-- algum B/L foi recusado, o bloco externo é desfeito inteiro: nenhuma data,
-- linha do Histórico ou efeito de faturamento fica gravado, e a função devolve
-- `{ ok: false, errors: [{ bl_id, code, message }] }` para a tela listar o que
-- foi recusado. Sem recusa, devolve `{ ok: true, updated, unchanged, bls }`.
--
-- Permissão: o mesmo contrato da RPC por B/L — usuário ativo, `p_changed_by`
-- igual a `auth.uid()`; EXECUTE só para `authenticated` (como a 015 deu à
-- `apply_container_dates_atomic`), revogado de PUBLIC e anon. Os conjuntos de
-- containers do arquivo inteiro são travados em ordem de id antes do primeiro
-- B/L (`_lock_container_date_sets`, da 211), como a RPC por B/L já faz para os
-- seus.
--
-- A RPC por B/L continua (Histórico e testes de integração a usam); a tela
-- deixa de chamá-la. Só cria função: não reescreve nem apaga linhas
-- existentes. Rollback: `DROP FUNCTION public.apply_container_dates_batch_atomic(uuid, jsonb, uuid);`

CREATE OR REPLACE FUNCTION public.apply_container_dates_batch_atomic(
  p_request_id uuid,
  p_batches jsonb,
  p_changed_by uuid
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_batch jsonb;
  v_bl_id text;
  v_result jsonb;
  v_errors jsonb := '[]'::jsonb;
  v_updated integer := 0;
  v_unchanged integer := 0;
  v_bls integer := 0;
  v_total_rows integer := 0;
BEGIN
  IF v_actor IS NULL OR NOT public.is_active_user() OR p_changed_by IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa.' USING ERRCODE = '42501';
  END IF;
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'request_id obrigatorio.' USING ERRCODE = '22023';
  END IF;
  IF p_batches IS NULL OR jsonb_typeof(p_batches) <> 'array' OR jsonb_array_length(p_batches) = 0 THEN
    RAISE EXCEPTION 'Planilha de datas vazia.' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_batches) > 2000 THEN
    RAISE EXCEPTION 'Planilha com mais de 2000 B/Ls: divida o arquivo.' USING ERRCODE = '22023';
  END IF;
  FOR v_batch IN SELECT * FROM jsonb_array_elements(p_batches) LOOP
    IF jsonb_typeof(v_batch) <> 'object' OR jsonb_typeof(v_batch->'rows') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'Lote de datas invalido.' USING ERRCODE = '22023';
    END IF;
    v_total_rows := v_total_rows + jsonb_array_length(v_batch->'rows');
  END LOOP;
  IF v_total_rows > 10000 THEN
    RAISE EXCEPTION 'Planilha com mais de 10000 linhas: divida o arquivo.' USING ERRCODE = '22023';
  END IF;

  -- Todos os conjuntos do arquivo, em ordem de id, antes do primeiro B/L.
  PERFORM public._lock_container_date_sets(ARRAY(
    SELECT c.id
    FROM jsonb_array_elements(p_batches) AS b(item)
    CROSS JOIN LATERAL jsonb_array_elements(b.item->'rows') AS r(item)
    JOIN public.bl_containers AS c
      ON c.bl_id = btrim(COALESCE(b.item->>'bl_id', ''))
     AND upper(btrim(c.container_number)) = upper(btrim(COALESCE(r.item->>'container_number', '')))));

  BEGIN
    FOR v_batch IN SELECT * FROM jsonb_array_elements(p_batches) LOOP
      v_bl_id := NULLIF(btrim(COALESCE(v_batch->>'bl_id', '')), '');
      BEGIN
        v_result := public.apply_container_dates_atomic(p_request_id, v_bl_id, v_batch->'rows', p_changed_by);
        v_updated := v_updated + COALESCE(jsonb_array_length(v_result->'updated_ids'), 0);
        v_unchanged := v_unchanged + COALESCE(jsonb_array_length(v_result->'unchanged_ids'), 0);
        v_bls := v_bls + 1;
      EXCEPTION WHEN OTHERS THEN
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'bl_id', COALESCE(v_bl_id, ''), 'code', SQLSTATE, 'message', SQLERRM));
      END;
    END LOOP;

    IF jsonb_array_length(v_errors) > 0 THEN
      -- Desfaz o que os B/Ls aceitos gravaram: o arquivo é recusado inteiro.
      RAISE EXCEPTION 'planilha de datas recusada' USING ERRCODE = 'VB333';
    END IF;
  EXCEPTION WHEN SQLSTATE 'VB333' THEN
    RETURN jsonb_build_object('ok', false, 'request_id', p_request_id, 'errors', v_errors);
  END;

  RETURN jsonb_build_object(
    'ok', true,
    'request_id', p_request_id,
    'updated', v_updated,
    'unchanged', v_unchanged,
    'bls', v_bls
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.apply_container_dates_batch_atomic(uuid, jsonb, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_container_dates_batch_atomic(uuid, jsonb, uuid) TO authenticated;
