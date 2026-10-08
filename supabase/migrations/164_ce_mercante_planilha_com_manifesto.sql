-- 164: a planilha de CE Mercante grava os CEs e o vínculo com o Manifesto
-- Mercante na mesma transação, com o número do manifesto obrigatório.
--
-- Regra do dono (2026-10-08): cada importação da planilha de CE Mercante é um
-- manifesto. Antes de importar, o operador informa o número do manifesto
-- daquele lote. Manifesto = navio + viagem + rota (par POL → POD) + número;
-- todos os B/Ls do lote precisam ser da mesma viagem e da mesma rota. Uma rota
-- pode ter vários manifestos: o operador importa cada um em separado, com o
-- seu número. Repetir um número já cadastrado junta os B/Ls ao mesmo
-- manifesto.
--
-- Antes desta migration o número era opcional e o vínculo era feito pelo
-- navegador depois da RPC: com rota divergente o CE ficava gravado e o
-- manifesto não (gravação parcial). Agora a validação de rota/viagem/
-- manifesto acontece antes de qualquer gravação, e o manifesto criado, os CEs
-- e o vínculo são desfeitos juntos se qualquer linha falhar.
--
-- Também remove apply_ce_mercante_manifest: a importação de CE por arquivo EDI
-- não faz parte do processo (o CE entra só pela planilha; EDI é o Baplie), e
-- a função validava cobertura por import_batches, que não identifica
-- manifesto.
--
-- Não reescreve nem apaga linhas existentes.

DROP FUNCTION IF EXISTS public.apply_ce_mercante_manifest(jsonb, uuid);
DROP FUNCTION IF EXISTS public.apply_ce_mercante_rows_atomic(jsonb, uuid, text);

CREATE FUNCTION public.apply_ce_mercante_rows_atomic(
  p_rows jsonb,
  p_changed_by uuid,
  p_target text DEFAULT 'bls',
  p_manifesto_numero text DEFAULT NULL,
  p_voyage_id bigint DEFAULT NULL
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
  v_numero text := NULLIF(btrim(COALESCE(p_manifesto_numero, '')), '');
  v_bl_ids text[];
  v_found integer;
  v_route record;
  v_route_count integer;
  v_manifesto public.manifestos_mercante%ROWTYPE;
  v_conflict text;
BEGIN
  IF p_target NOT IN ('bls', 'granite') THEN
    RAISE EXCEPTION 'Destino de CE Mercante inválido: %', p_target USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(COALESCE(p_rows, 'null'::jsonb)) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'errors', jsonb_build_array(jsonb_build_object('message', 'Nenhuma linha para importar.')));
  END IF;

  IF p_target = 'bls' THEN
    IF v_numero IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'errors', jsonb_build_array(jsonb_build_object(
        'message', 'Informe o número do Manifesto Mercante deste lote antes de importar.')));
    END IF;

    SELECT array_agg(DISTINCT upper(btrim(value->>'bl_id')))
      INTO v_bl_ids
      FROM jsonb_array_elements(p_rows);

    -- Trava os B/Ls do lote: o vínculo e a rota não mudam durante a importação.
    PERFORM 1 FROM public.bls WHERE id = ANY (v_bl_ids) ORDER BY id FOR UPDATE;
    SELECT count(*) INTO v_found FROM public.bls WHERE id = ANY (v_bl_ids);
    IF v_found <> cardinality(v_bl_ids) THEN
      -- B/L inexistente cai no erro por linha abaixo; aqui só não há rota a validar.
      NULL;
    ELSE
      SELECT count(DISTINCT (b.voyage_id, upper(btrim(COALESCE(b.pol, ''))), upper(btrim(COALESCE(b.pod, '')))))
        INTO v_route_count
        FROM public.bls b WHERE b.id = ANY (v_bl_ids);
      SELECT b.voyage_id, upper(btrim(COALESCE(b.pol, ''))) AS pol, upper(btrim(COALESCE(b.pod, ''))) AS pod,
             btrim(b.pol) AS pol_raw, btrim(b.pod) AS pod_raw
        INTO v_route
        FROM public.bls b WHERE b.id = ANY (v_bl_ids) ORDER BY b.id LIMIT 1;

      IF v_route_count > 1 THEN
        RETURN jsonb_build_object('ok', false, 'errors', jsonb_build_array(jsonb_build_object(
          'message', 'Os B/Ls da planilha são de mais de uma viagem ou rota (POL → POD). Um manifesto tem uma única rota: separe a planilha por manifesto.')));
      END IF;
      IF v_route.pol = '' OR v_route.pod = '' THEN
        RETURN jsonb_build_object('ok', false, 'errors', jsonb_build_array(jsonb_build_object(
          'message', 'Os B/Ls da planilha não têm POL e POD cadastrados; sem rota não há manifesto.')));
      END IF;
      IF p_voyage_id IS NOT NULL AND v_route.voyage_id IS DISTINCT FROM p_voyage_id THEN
        RETURN jsonb_build_object('ok', false, 'errors', jsonb_build_array(jsonb_build_object(
          'message', 'Os B/Ls da planilha não pertencem à viagem selecionada.')));
      END IF;

      SELECT * INTO v_manifesto FROM public.manifestos_mercante WHERE numero = v_numero FOR UPDATE;
      IF FOUND AND (
        v_manifesto.voyage_id IS DISTINCT FROM v_route.voyage_id
        OR upper(btrim(v_manifesto.pol)) <> v_route.pol
        OR upper(btrim(v_manifesto.pod)) <> v_route.pod
        OR v_manifesto.natureza <> 'carga'
      ) THEN
        RETURN jsonb_build_object('ok', false, 'errors', jsonb_build_array(jsonb_build_object(
          'message', format('O Manifesto Mercante %s já está cadastrado para outra viagem, rota ou natureza.', v_numero))));
      END IF;

      SELECT string_agg(b.id, ', ' ORDER BY b.id) INTO v_conflict
        FROM public.bls b
        WHERE b.id = ANY (v_bl_ids)
          AND b.manifesto_mercante_id IS NOT NULL
          AND b.manifesto_mercante_id IS DISTINCT FROM v_manifesto.id;
      IF v_conflict IS NOT NULL THEN
        RETURN jsonb_build_object('ok', false, 'errors', jsonb_build_array(jsonb_build_object(
          'message', format('B/L já vinculado a outro Manifesto Mercante: %s.', v_conflict))));
      END IF;
    END IF;
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

    IF p_target = 'bls' THEN
      IF v_manifesto.id IS NULL THEN
        INSERT INTO public.manifestos_mercante (voyage_id, pol, pod, numero, natureza)
          VALUES (v_route.voyage_id, v_route.pol_raw, v_route.pod_raw, v_numero, 'carga')
          RETURNING * INTO v_manifesto;
      END IF;
      UPDATE public.bls SET manifesto_mercante_id = v_manifesto.id
        WHERE id = ANY (v_bl_ids) AND manifesto_mercante_id IS DISTINCT FROM v_manifesto.id;
    END IF;
  EXCEPTION WHEN SQLSTATE 'P0099' THEN
    RETURN jsonb_build_object('ok', false, 'errors', v_errors);
  END;

  RETURN jsonb_build_object(
    'ok', true,
    'processed', jsonb_array_length(p_rows),
    'inserted', v_inserted,
    'overwritten', v_overwritten,
    'unchanged', v_unchanged,
    'manifesto_mercante_id', v_manifesto.id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_ce_mercante_rows_atomic(jsonb, uuid, text, text, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_ce_mercante_rows_atomic(jsonb, uuid, text, text, bigint) TO authenticated;
