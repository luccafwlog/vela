-- 150: a importação de B/L reaplica as flags físicas do Baplie só nos
-- contêineres do próprio lote.
--
-- Sintoma (06/10/2026): depois que a importação passou a ir em lotes de 20
-- B/Ls (#862), cada lote levava ~6 s numa viagem de ~500 B/Ls. Medição em
-- produção (transação desfeita): apply_baplie_physical_flags_atomic sem filtro
-- = 3,1 s por chamada, porque percorre todo contêiner do Baplie da viagem e,
-- para cada um, faz uma busca sem índice em bl_containers; com o filtro dos
-- 53 contêineres do lote = 0,23 s. O cálculo de taxas de 20 B/Ls = 0,37 s.
--
-- Os contêineres dos demais B/Ls não mudam nesta importação: as flags deles já
-- foram aplicadas quando foram importados ou quando o Baplie entrou. Lote sem
-- contêiner (carga solta) não chama a função, pois filtro vazio vira "viagem
-- inteira" nela.
--
-- Não reescreve nem apaga linhas existentes.

CREATE OR REPLACE FUNCTION public.import_bl_freight_with_metadata(
  p_bls jsonb,
  p_changed_by uuid,
  p_batch jsonb DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_result jsonb;
  v_batch_id bigint := NULL;
  v_filename text;
  v_voyage_id bigint;
  v_cargo_mode text := 'container';
  v_total_bls integer;
  v_bl_id text;
  v_mismatch integer := 0;
  v_updated integer := 0;
  v_action_id uuid := gen_random_uuid();
  v_item jsonb;
  v_physical_effect jsonb;
  v_physical_effect_id bigint;
  v_calc_errors jsonb := '[]'::jsonb;
  v_batch_containers jsonb;
BEGIN
  IF v_actor IS NULL OR NOT public.is_active_user() OR p_changed_by IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa.' USING ERRCODE = '42501';
  END IF;
  IF p_bls IS NULL OR jsonb_typeof(p_bls) <> 'array' OR jsonb_array_length(p_bls) = 0 THEN
    RAISE EXCEPTION 'Nenhum B/L informado.' USING ERRCODE = '22023';
  END IF;

  v_result := public.import_bl_freight_transactional(p_bls, p_changed_by);

  -- O batch e opcional (ADR 0017): mesmo no B/L avulso o calculo inicial
  -- deve acontecer nesta mesma operacao, sem depender de worker offline.
  IF p_batch IS NOT NULL THEN
    v_filename := NULLIF(btrim(COALESCE(p_batch->>'filename', '')), '');
    v_voyage_id := NULLIF(btrim(COALESCE(p_batch->>'voyage_id', '')), '')::bigint;
    v_cargo_mode := COALESCE(NULLIF(btrim(COALESCE(p_batch->>'cargo_mode', '')), ''), 'container');
    IF v_filename IS NULL OR v_voyage_id IS NULL THEN
      RAISE EXCEPTION 'Batch invalido: filename e voyage_id obrigatorios.' USING ERRCODE = '22023';
    END IF;
    IF v_cargo_mode NOT IN ('container', 'carga_solta') THEN
      RAISE EXCEPTION 'cargo_mode de batch invalido.' USING ERRCODE = '22023';
    END IF;

    PERFORM 1 FROM public.voyages WHERE id = v_voyage_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Viagem % nao encontrada', v_voyage_id USING ERRCODE = 'P0002';
    END IF;

    SELECT count(*) INTO v_mismatch
    FROM jsonb_array_elements(p_bls) AS item
    WHERE (item->>'voyage_id')::bigint IS DISTINCT FROM v_voyage_id;
    IF v_mismatch > 0 THEN
      RAISE EXCEPTION 'Batch da viagem % com B/L de outra viagem.', v_voyage_id USING ERRCODE = '22023';
    END IF;

    v_total_bls := jsonb_array_length(p_bls);

    INSERT INTO public.import_batches(
      filename, voyage_id, cargo_mode, uploaded_by, status, total_bls, total_containers
    ) VALUES (
      v_filename, v_voyage_id, v_cargo_mode, v_actor, 'completed', v_total_bls, NULL
    ) RETURNING id INTO v_batch_id;

    UPDATE public.bls AS b
      SET batch_id = v_batch_id
      FROM jsonb_array_elements(p_bls) AS item
      WHERE b.id = item->>'id' AND b.voyage_id = v_voyage_id;
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated <> v_total_bls THEN
      RAISE EXCEPTION 'Vinculo de batch falhou: % de % B/Ls vinculados.', v_updated, v_total_bls USING ERRCODE = 'P0002';
    END IF;

    v_physical_effect := public.enqueue_import_effect(
      v_action_id,
      'physical_flags',
      v_voyage_id::text,
      v_actor,
      1,
      NULL,
      jsonb_build_object(
        'filename', v_filename,
        'voyage_id', v_voyage_id,
        'cargo_mode', v_cargo_mode,
        'bl_count', v_total_bls
      )
    );
    v_physical_effect_id := NULLIF(v_physical_effect->'effect'->>'id', '')::bigint;

    -- Baplie soberano em qualquer ordem (migration 118): se o Baplie da
    -- viagem ja existe, as flags fisicas valem antes do calculo inicial
    -- abaixo; o runner do efeito acima nao e pre-requisito.
    -- Migration 150: só os contêineres deste lote (sem filtro a função varre
    -- a viagem inteira, ~3 s numa viagem de ~500 B/Ls).
    SELECT jsonb_agg(DISTINCT upper(btrim(container->>'container_number')))
      INTO v_batch_containers
      FROM jsonb_array_elements(p_bls) AS item,
           jsonb_array_elements(COALESCE(item->'containers', '[]'::jsonb)) AS container
      WHERE NULLIF(btrim(COALESCE(container->>'container_number', '')), '') IS NOT NULL;
    IF v_batch_containers IS NOT NULL THEN
      PERFORM public.apply_baplie_physical_flags_atomic(v_voyage_id, v_batch_containers, v_actor);
    END IF;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_bls)
  LOOP
    -- Preserva o ID exato que foi persistido em public.bls
    v_bl_id := v_item->>'id';
    CONTINUE WHEN v_bl_id IS NULL OR btrim(v_bl_id) = '';

    -- Disparo imediato do calculo inicial das taxas locais com base nas tabelas cadastradas
    BEGIN
      PERFORM public.calculate_bl_local_charges(v_bl_id, v_actor, true);
    EXCEPTION WHEN OTHERS THEN
      -- Registra rastro detalhado do erro em audit_logs e acumula no retorno do batch.
      v_calc_errors := v_calc_errors || jsonb_build_array(jsonb_build_object(
        'bl_id', v_bl_id,
        'message', SQLERRM
      ));
      INSERT INTO public.audit_logs (
        entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification
      ) VALUES (
        'bl', v_bl_id, 'local_charges_auto_calc_error', NULL, SQLERRM, v_actor, now(),
        'Falha no calculo automatico de taxas locais na importacao do B/L'
      );
      -- A fila e somente recuperacao: um calculo bem-sucedido nao e repetido pelo worker.
      IF p_batch IS NOT NULL THEN
        PERFORM public.enqueue_import_effect(
          v_action_id,
          'provisional_charges',
          v_bl_id,
          v_actor,
          1,
          v_physical_effect_id,
          jsonb_build_object(
            'filename', v_filename,
            'voyage_id', v_voyage_id,
            'cargo_mode', v_cargo_mode
          )
        );
      END IF;
    END;
  END LOOP;

  RETURN jsonb_build_object('result', v_result, 'batch_id', v_batch_id, 'calculation_errors', v_calc_errors);
END;
$$;

REVOKE ALL ON FUNCTION public.import_bl_freight_with_metadata(jsonb, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_bl_freight_with_metadata(jsonb, uuid, jsonb) TO authenticated, service_role;
