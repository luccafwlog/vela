-- 118: flags físicas do Baplie (IMO/OOG) chegam ao B/L em qualquer ordem de
-- importação, e as taxas locais acompanham.
--
-- Sintoma (GREEN SUAPE / 9, 2026-10-01): Baplie com 402 IMO e 1 OOG nos cheios,
-- B/Ls da viagem com 375 IMO e 0 OOG. O Baplie foi importado antes dos B/Ls;
-- a tela do Baplie aplicou as flags quando ainda não havia B/L, e o import de
-- B/L só enfileirava o efeito `physical_flags` para o `import-effects-runner`,
-- que em produção não roda (IMPORT_EFFECTS_CRON_SECRET ausente no Vault e
-- IMPORT_EFFECTS_RUNNER_ENABLED desligado; docs/operations/segredos-cron.md).
-- O B/L grava is_oog=false e is_imo só pelo texto do documento, então o que o
-- Baplie sabia a mais nunca chegava ao B/L.
--
-- 1. import_bl_freight_with_metadata aplica as flags do Baplie da viagem na
--    mesma transação, ANTES do cálculo inicial de taxas, que passa a usar o
--    perfil certo. O efeito `physical_flags` continua enfileirado como
--    recuperação (no-op quando o runner for ligado).
-- 2. apply_baplie_physical_flags_atomic recalcula as taxas locais dos B/Ls
--    cujos containers mudaram de perfil (mesma regra de
--    set_bl_container_profile, migration 115), em vez de depender do runner.
--    B/L faturado recebe a flag física, mas não é recalculado.
--
-- Não reescreve nem apaga linhas existentes: só redefine funções. Viagens já
-- importadas se corrigem reimportando o Baplie (ou o B/L) depois do deploy.

CREATE OR REPLACE FUNCTION public.apply_baplie_physical_flags_atomic(
  p_voyage_id bigint,
  p_changes jsonb,
  p_changed_by uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_role text;
  v_filter text[] := NULL;
  v_item jsonb;
  v_num text;
  v_updated bigint[] := ARRAY[]::bigint[];
  v_staged_imo boolean;
  v_staged_class text;
  v_staged_un text;
  v_staged_oog boolean;
  v_matches bigint[];
  v_current record;
  v_bl_id text;
  v_action_id uuid := gen_random_uuid();
  v_recalculated integer := 0;
  v_calc_errors jsonb := '[]'::jsonb;
BEGIN
  IF v_actor IS NULL OR NOT public.is_active_user() OR p_changed_by IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa.' USING ERRCODE = '42501';
  END IF;
  IF p_voyage_id IS NULL THEN
    RAISE EXCEPTION 'Viagem obrigatoria.' USING ERRCODE = '22023';
  END IF;

  -- Serializa o conjunto fisico por viagem.
  PERFORM 1 FROM public.voyages WHERE id = p_voyage_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Viagem % nao encontrada', p_voyage_id USING ERRCODE = 'P0002';
  END IF;

  -- p_changes e so filtro opcional; valores/previous do browser sao ignorados:
  -- o desejado deriva do restaging no servidor abaixo.
  IF p_changes IS NOT NULL THEN
    IF jsonb_typeof(p_changes) <> 'array' THEN
      RAISE EXCEPTION 'Filtro de flags invalido.' USING ERRCODE = '22023';
    END IF;
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_changes)
    LOOP
      IF jsonb_typeof(v_item) = 'string' THEN
        v_num := upper(btrim(v_item #>> '{}'));
      ELSE
        v_num := upper(btrim(COALESCE(v_item->>'container_number', '')));
      END IF;
      IF v_num IS NOT NULL AND v_num <> '' THEN
        v_filter := array_append(v_filter, v_num);
      END IF;
    END LOOP;
  END IF;

  -- Deriva do staging: full prevalece, IMO/OOG por OR, ultima classe/ONU nao
  -- nula. Sem IMO, classe/ONU zeram (regra do reconciliador).
  FOR v_num, v_staged_imo, v_staged_class, v_staged_un, v_staged_oog IN
    SELECT
      upper(btrim(s.container_number)),
      bool_or(COALESCE(s.is_imo, false)),
      max(s.imo_class) FILTER (WHERE s.imo_class IS NOT NULL),
      max(s.un_number) FILTER (WHERE s.un_number IS NOT NULL),
      bool_or(COALESCE(s.is_oog, false))
    FROM public.baplie_containers AS s
    WHERE s.voyage_id = p_voyage_id
      AND s.status = 'full'
      AND upper(btrim(s.container_number)) ~ '^[A-Z]{4}[0-9]{7}$'
    GROUP BY upper(btrim(s.container_number))
    ORDER BY 1
  LOOP
    IF v_filter IS NOT NULL AND NOT (v_num = ANY (v_filter)) THEN
      CONTINUE;
    END IF;
    IF NOT v_staged_imo THEN
      v_staged_class := NULL;
      v_staged_un := NULL;
    END IF;

    -- Casa com exatamente um bl_container da viagem; 0 ou 2+ viram
    -- divergencia de existencia, nao update arbitrario.
    SELECT COALESCE(array_agg(c.id ORDER BY c.id), ARRAY[]::bigint[])
      INTO v_matches
      FROM public.bl_containers AS c
      JOIN public.bls AS b ON b.id = c.bl_id
      WHERE b.voyage_id = p_voyage_id
        AND upper(btrim(c.container_number)) = v_num;

    IF cardinality(v_matches) <> 1 THEN
      CONTINUE;
    END IF;

    SELECT c.is_imo, c.imo_class, c.un_number, c.is_oog
      INTO v_current
      FROM public.bl_containers AS c
      WHERE c.id = v_matches[1]
      FOR UPDATE;

    IF v_staged_imo IS NOT DISTINCT FROM COALESCE(v_current.is_imo, false)
       AND v_staged_oog IS NOT DISTINCT FROM COALESCE(v_current.is_oog, false)
       AND upper(COALESCE(v_staged_class, '')) IS NOT DISTINCT FROM upper(COALESCE(v_current.imo_class, ''))
       AND upper(COALESCE(v_staged_un, '')) IS NOT DISTINCT FROM upper(COALESCE(v_current.un_number, '')) THEN
      CONTINUE;
    END IF;

    UPDATE public.bl_containers AS c
      SET is_imo = v_staged_imo,
          imo_class = v_staged_class,
          un_number = v_staged_un,
          is_oog = v_staged_oog
      WHERE c.id = v_matches[1];
    v_updated := array_append(v_updated, v_matches[1]);
  END LOOP;

  -- No-op nao cria mudanca ficticia nem evento.
  IF cardinality(v_updated) = 0 THEN
    RETURN jsonb_build_object(
      'voyage_id', p_voyage_id,
      'updated_ids', ARRAY[]::bigint[],
      'applied', 0,
      'recalculated', 0,
      'calculation_errors', '[]'::jsonb
    );
  END IF;

  v_role := public.current_actor_role();

  -- Um unico evento de intencao por viagem, mesma transacao. A trilha por
  -- coluna do trigger audit_row_changes continua (legitima, correlacionada).
  INSERT INTO public.audit_logs(
    entity_type, entity_id, field_name, old_value, new_value,
    changed_by, justification, actor_role, actor_department
  ) VALUES (
    'voyage', p_voyage_id::text, 'baplie_physical_flags',
    jsonb_build_object('voyage_id', p_voyage_id)::text,
    jsonb_build_object(
      'voyage_id', p_voyage_id,
      'updated_ids', v_updated,
      'applied', cardinality(v_updated)
    )::text,
    v_actor, 'Baplie soberano: flags fisicas aplicadas (conjunto atomico)', v_role, v_role
  );

  -- resolve_bl_local_charge_items escolhe tarifa por is_imo/is_oog: o perfil
  -- mudou, a taxa recalcula agora (mesma regra da migration 115). Falha de
  -- calculo nao desfaz as flags; vira auditoria e efeito recuperavel.
  FOR v_bl_id IN
    SELECT DISTINCT c.bl_id
    FROM public.bl_containers AS c
    JOIN public.bls AS b ON b.id = c.bl_id
    WHERE c.id = ANY (v_updated)
      AND COALESCE(b.financial_status, 'pending') NOT IN ('invoiced', 'partially_paid', 'paid')
    ORDER BY 1
  LOOP
    BEGIN
      PERFORM public.calculate_bl_local_charges(v_bl_id, v_actor, true);
      v_recalculated := v_recalculated + 1;
    EXCEPTION WHEN OTHERS THEN
      v_calc_errors := v_calc_errors || jsonb_build_array(jsonb_build_object(
        'bl_id', v_bl_id,
        'message', SQLERRM
      ));
      INSERT INTO public.audit_logs (
        entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification
      ) VALUES (
        'bl', v_bl_id, 'local_charges_auto_calc_error', NULL, SQLERRM, v_actor, now(),
        'Falha no recalculo de taxas locais apos aplicar flags fisicas do Baplie'
      );
      PERFORM public.enqueue_import_effect(
        v_action_id, 'provisional_charges', v_bl_id, v_actor, 1, NULL,
        jsonb_build_object('voyage_id', p_voyage_id, 'source', 'baplie_physical_flags')
      );
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'voyage_id', p_voyage_id,
    'updated_ids', v_updated,
    'applied', cardinality(v_updated),
    'recalculated', v_recalculated,
    'calculation_errors', v_calc_errors
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_baplie_physical_flags_atomic(bigint, jsonb, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_baplie_physical_flags_atomic(bigint, jsonb, uuid) TO authenticated;

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
    PERFORM public.apply_baplie_physical_flags_atomic(v_voyage_id, NULL, v_actor);
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
