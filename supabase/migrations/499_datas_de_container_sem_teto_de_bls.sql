-- 499: planilha de datas de descarga e devolução sem teto de B/Ls (pedido do
-- dono de 2026-10-28: a planilha com 317 B/Ls era recusada pelo teto de 300).
--
-- Problema:
--   A 333 pôs o teto de 300 B/Ls (e 10.000 linhas) porque o custo de cada B/L
--   crescia com o tamanho da Viagem e a chamada tem `statement_timeout` de
--   60 s. O custo vinha de `_lock_container_date_sets` (211): o `OR EXISTS`
--   impedia o índice `idx_bl_containers_number_normalized` e cada chamada
--   varria todos os containers com o B/L. Ela roda uma vez para o arquivo e
--   outra a cada B/L (dentro da RPC por B/L). Medido em 2026-10-28 no PG 16
--   local, Viagem de 9.000 containers: 1.000 B/Ls 25 s, dos quais 9,3 s na
--   trava; 3.000 B/Ls 61 s, 28 s na trava.
--
-- Mudança:
--   1. `_lock_container_date_sets` trava o mesmo conjunto (os containers
--      pedidos e os de mesmo número na mesma Viagem, de B/L ativo, em ordem de
--      id), mas acha os irmãos pelo número normalizado, com o índice. Medido no
--      mesmo banco: 300 B/Ls 4,6 s; 3.000 B/Ls / 9.000 containers 39 s. O
--      custo passa a crescer com o tamanho do arquivo, não com o da Viagem.
--   2. `apply_container_dates_batch_atomic` (387) sem os tetos de 300 B/Ls e
--      10.000 linhas. O resto do corpo é o da 387: trava da Viagem, conjuntos
--      em ordem de id, B/Ls em ordem de `bl_id` e recusa do arquivo inteiro
--      (regra de 2026-10-19).
--
-- ponytail: o teto que sobra é o `statement_timeout` de 60 s. Com cerca de
-- 4–5 ms por container gravado (gatilhos de Histórico, recálculo e grupo de
-- Demurrage por linha), cabem uns 12.000 containers por arquivo no PG local;
-- acima disso a chamada é cancelada (57014), nada é gravado e a tela pede para
-- dividir a planilha. Upgrade: preparo em etapas numa tabela de staging com
-- publicação numa RPC final.
--
-- Só redefine funções; não reescreve nem apaga linhas existentes.
-- Rollback: reaplicar `_lock_container_date_sets` da 211 e
-- `apply_container_dates_batch_atomic` da 387.

CREATE OR REPLACE FUNCTION public._lock_container_date_sets(p_container_ids bigint[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- Mesmo conjunto que `_apply_container_dates_core` escreve: o container e os
  -- de mesmo número na mesma Viagem, de B/L ativo. Travar tudo em ordem de id
  -- antes de qualquer linha isolada evita o deadlock entre duas gravações que
  -- dividem containers (211). 499: os irmãos saem pelo número normalizado
  -- (índice), sem varrer a Viagem.
  PERFORM 1
  FROM public.bl_containers AS c
  WHERE c.id IN (
      SELECT x.id FROM unnest(p_container_ids) AS x(id)
      UNION
      SELECT theirs.id
      FROM (
        SELECT DISTINCT upper(btrim(mine.container_number)) AS number, mine_bl.voyage_id
        FROM public.bl_containers AS mine
        JOIN public.bls AS mine_bl ON mine_bl.id = mine.bl_id
        WHERE mine.id = ANY(p_container_ids)
      ) AS wanted
      JOIN public.bl_containers AS theirs ON upper(btrim(theirs.container_number)) = wanted.number
      JOIN public.bls AS b ON b.id = theirs.bl_id
      WHERE b.cancelled_at IS NULL AND b.voyage_id = wanted.voyage_id)
    AND EXISTS (SELECT 1 FROM public.bls AS owner WHERE owner.id = c.bl_id)
  ORDER BY c.id
  FOR UPDATE OF c;
END;
$function$;
REVOKE ALL ON FUNCTION public._lock_container_date_sets(bigint[]) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.apply_container_dates_batch_atomic(p_request_id uuid, p_batches jsonb, p_changed_by uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET statement_timeout TO '60s'
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
  -- 499: sem teto de B/Ls nem de linhas; o limite é o tempo da chamada.
  FOR v_batch IN SELECT * FROM jsonb_array_elements(p_batches) LOOP
    IF jsonb_typeof(v_batch) <> 'object' OR jsonb_typeof(v_batch->'rows') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'Lote de datas invalido.' USING ERRCODE = '22023';
    END IF;
  END LOOP;

  -- 387: a trava das Viagens vem antes de qualquer outra (ADR 0095, decisão 6).
  PERFORM public._lock_import_voyages_of_bls(NULL, public._import_payload_texts(p_batches, 'bl_id'));

  -- Todos os conjuntos do arquivo, em ordem de id, antes do primeiro B/L.
  PERFORM public._lock_container_date_sets(ARRAY(
    SELECT c.id
    FROM jsonb_array_elements(p_batches) AS b(item)
    CROSS JOIN LATERAL jsonb_array_elements(b.item->'rows') AS r(item)
    JOIN public.bl_containers AS c
      ON c.bl_id = btrim(COALESCE(b.item->>'bl_id', ''))
     AND upper(btrim(c.container_number)) = upper(btrim(COALESCE(r.item->>'container_number', '')))));

  BEGIN
    -- Em ordem de B/L: arquivos simultâneos travam na mesma ordem.
    FOR v_batch IN
      SELECT b.item FROM jsonb_array_elements(p_batches) AS b(item)
      ORDER BY btrim(COALESCE(b.item->>'bl_id', ''))
    LOOP
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
