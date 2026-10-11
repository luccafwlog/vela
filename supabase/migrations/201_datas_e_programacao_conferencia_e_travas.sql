-- 201 — Planilha de datas e Programação por planilha: achados da revisão
-- automática nas migrations 190 e 199 (revisão da PR 929).
--
-- Planilha de datas (`apply_container_dates_atomic_legacy_189`, da 190): a
-- prévia que viu a descarga vazia mandava `expected_discharge_date: null`, e a
-- conferência de prévia obsoleta só rodava com valor esperado preenchido. Se
-- outra sessão gravasse a descarga depois da prévia, a planilha a sobrescrevia
-- com outra data sem conferir, e a Demurrage reagia a um dado não revisto.
-- Agora a chave presente é conferida mesmo nula, como a da devolução.
--
-- Programação por planilha (`apply_schedule_sheet_atomic_legacy_189`, da 199):
-- as travas da Viagem nova eram pegas linha a linha, na ordem do arquivo. Dois
-- arquivos simultâneos com as mesmas Viagens em ordens diferentes se travavam
-- mutuamente (deadlock, 40P01), e um arquivo inteiro falhava. Agora todas as
-- travas são pegas antes da primeira linha, em ordem fixa.
--
-- Os invólucros da 189 não mudam. Não reescreve nem apaga linhas existentes:
-- só redefine funções. Rollback: reaplicar a definição da 190 e a da 199.

CREATE OR REPLACE FUNCTION public.apply_container_dates_atomic_legacy_189(p_request_id uuid, p_bl_id text, p_rows jsonb, p_changed_by uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_role text;
  v_bl_id text := NULLIF(btrim(COALESCE(p_bl_id, '')), '');
  v_count integer := 0;
  v_item jsonb;
  v_num text;
  v_discharge text;
  v_return text;
  v_exp_discharge text;
  v_exp_return text;
  v_updated bigint[] := ARRAY[]::bigint[];
  v_unchanged bigint[] := ARRAY[]::bigint[];
  v_touched text[] := ARRAY[]::text[];
  v_billing_state text := 'pending';
  v_after jsonb := '{}'::jsonb;
  r record;
BEGIN
  IF v_actor IS NULL OR NOT public.is_active_user() OR p_changed_by IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa.' USING ERRCODE = '42501';
  END IF;
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'request_id obrigatorio.' USING ERRCODE = '22023';
  END IF;
  IF v_bl_id IS NULL THEN
    RAISE EXCEPTION 'B/L obrigatorio.' USING ERRCODE = '22023';
  END IF;
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'Lote de datas invalido.' USING ERRCODE = '22023';
  END IF;
  v_count := jsonb_array_length(p_rows);
  IF v_count = 0 OR v_count > 500 THEN
    RAISE EXCEPTION 'Lote deve ter entre 1 e 500 linhas.' USING ERRCODE = '22023';
  END IF;

  PERFORM 1 FROM public.bls WHERE id = v_bl_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L % nao encontrado', v_bl_id USING ERRCODE = 'P0002';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_rows)
  LOOP
    IF jsonb_typeof(v_item) <> 'object' THEN
      RAISE EXCEPTION 'Linha de datas invalida.' USING ERRCODE = '22023';
    END IF;
    v_num := upper(btrim(COALESCE(v_item->>'container_number', '')));
    v_discharge := NULLIF(btrim(COALESCE(v_item->>'discharge_date', '')), '');
    v_return := NULLIF(btrim(COALESCE(v_item->>'return_date', '')), '');
    IF v_num = '' THEN
      RAISE EXCEPTION 'Container obrigatorio no B/L %.', v_bl_id USING ERRCODE = '22023';
    END IF;
    IF v_discharge IS NULL OR v_discharge !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR v_discharge::date IS NULL THEN
      RAISE EXCEPTION 'Data de descarga invalida para % no B/L %.', v_num, v_bl_id USING ERRCODE = '22023';
    END IF;
    IF v_return IS NOT NULL AND (v_return !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR v_return::date IS NULL) THEN
      RAISE EXCEPTION 'Data de devolucao invalida para % no B/L %.', v_num, v_bl_id USING ERRCODE = '22023';
    END IF;
    IF v_return IS NOT NULL AND v_return::date < v_discharge::date THEN
      RAISE EXCEPTION 'Devolucao anterior a descarga para % no B/L %.', v_num, v_bl_id USING ERRCODE = '22023';
    END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_to_recordset(p_rows) AS t(container_number text, discharge_date text, return_date text)
      WHERE upper(btrim(COALESCE(t.container_number, ''))) = v_num
        AND (btrim(COALESCE(t.discharge_date, '')) IS DISTINCT FROM v_discharge
             OR NULLIF(btrim(COALESCE(t.return_date, '')), '') IS DISTINCT FROM v_return)
    ) THEN
      RAISE EXCEPTION 'Container % duplicado com datas conflitantes no B/L %.', v_num, v_bl_id USING ERRCODE = '22023';
    END IF;
  END LOOP;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_rows)
  LOOP
    v_num := upper(btrim(COALESCE(v_item->>'container_number', '')));
    v_discharge := NULLIF(btrim(COALESCE(v_item->>'discharge_date', '')), '');
    v_return := NULLIF(btrim(COALESCE(v_item->>'return_date', '')), '');
    v_exp_discharge := NULLIF(btrim(COALESCE(v_item->>'expected_discharge_date', '')), '');
    v_exp_return := NULLIF(btrim(COALESCE(v_item->>'expected_return_date', '')), '');

    SELECT c.id, c.discharge_date::text, c.return_date::text INTO r
    FROM public.bl_containers AS c
    WHERE c.bl_id = v_bl_id AND upper(btrim(c.container_number)) = v_num
    ORDER BY c.id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Container % nao pertence ao B/L %.', v_num, v_bl_id USING ERRCODE = 'P0002';
    END IF;

    -- Devolução vazia na planilha não mexe na data gravada (ADR 0078, item 19).
    -- Vem antes da checagem de prévia obsoleta: o container que já está no
    -- valor pedido não é escrito, e a data que outro B/L do mesmo arquivo
    -- acabou de propagar a este (container compartilhado) não é conflito.
    IF r.discharge_date IS NOT DISTINCT FROM v_discharge
       AND (v_return IS NULL OR r.return_date IS NOT DISTINCT FROM v_return) THEN
      v_unchanged := array_append(v_unchanged, r.id);
      CONTINUE;
    END IF;

    -- A prévia que viu a descarga vazia também conta: a chave presente com
    -- valor nulo é conferida, como a da devolução (201).
    IF (v_item ? 'expected_discharge_date') AND (r.discharge_date IS DISTINCT FROM v_exp_discharge) THEN
      RAISE EXCEPTION 'Preview obsoleto para % no B/L %: recarregue e reconfira.', v_num, v_bl_id USING ERRCODE = '22023';
    END IF;
    IF (v_item ? 'expected_return_date') AND (r.return_date IS DISTINCT FROM v_exp_return) THEN
      RAISE EXCEPTION 'Preview obsoleto para % no B/L %: recarregue e reconfira.', v_num, v_bl_id USING ERRCODE = '22023';
    END IF;

    v_touched := v_touched || public._apply_container_dates_core(r.id, v_discharge::date, v_return::date, v_return IS NULL);
    v_updated := array_append(v_updated, r.id);
  END LOOP;

  -- SOC não tem devolução a esperar (ADR 0014; migration 121).
  IF NOT EXISTS (
    SELECT 1 FROM public.bl_containers AS c
    WHERE c.bl_id = v_bl_id AND c.return_date IS NULL AND c.ownership IS DISTINCT FROM 'SOC'
  ) THEN
    v_billing_state := 'ready_for_billing';
  END IF;

  v_role := public.current_actor_role();

  IF cardinality(v_updated) > 0 THEN
    v_touched := ARRAY(SELECT DISTINCT unnest(v_touched || ARRAY[v_bl_id]));
    INSERT INTO public.audit_logs(
      entity_type, entity_id, field_name, old_value, new_value,
      changed_by, justification, actor_role, actor_department
    ) VALUES (
      'bl', v_bl_id, 'container_dates_import',
      jsonb_build_object('request_id', p_request_id, 'bl_id', v_bl_id)::text,
      jsonb_build_object(
        'request_id', p_request_id, 'bl_id', v_bl_id,
        'updated_ids', v_updated, 'unchanged_ids', v_unchanged,
        'billing_state', v_billing_state, 'propagated_bl_ids', v_touched
      )::text,
      v_actor, 'Importacao de datas por B/L (atomica)', v_role, v_role
    );
    v_after := public._after_container_dates(p_request_id, v_touched, v_actor);
  END IF;

  RETURN jsonb_build_object(
    'request_id', p_request_id,
    'bl_id', v_bl_id,
    'updated_ids', v_updated,
    'unchanged_ids', v_unchanged,
    'billing_state', v_billing_state,
    'propagated_bl_ids', to_jsonb(v_touched),
    'demurrage', v_after
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.apply_schedule_sheet_atomic_legacy_189(
  p_rows jsonb, p_carrier_name text, p_carrier_scac text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_row jsonb;
  v_voyage bigint;
  v_vessel bigint;
  v_carrier bigint;
  v_imo text;
  v_vessel_imo text;
  v_name text;
  v_number text;
  v_matches bigint[];
  v_status text;
  v_label text;
  v_created integer := 0;
  v_updated integer := 0;
  v_changes integer := 0;
  v_ids bigint[] := ARRAY[]::bigint[];
  v_count integer;
  v_lock bigint;
BEGIN
  IF v_actor IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Sem permissão para atualizar a programação.' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION 'Planilha sem linhas.' USING ERRCODE = '22023';
  END IF;

  -- Todas as travas de Viagem nova antes da primeira linha, em ordem fixa
  -- (201): dois arquivos com as mesmas Viagens em ordens diferentes esperam um
  -- pelo outro em vez de se travarem mutuamente (deadlock). Mesmas chaves da
  -- 199: o nome sempre e, com IMO de 7 dígitos, também o IMO.
  FOR v_lock IN
    SELECT DISTINCT hashtextextended(k.lock_key, 0)
    FROM jsonb_array_elements(p_rows) AS r(value)
    CROSS JOIN LATERAL (
      SELECT upper(btrim(COALESCE(r.value->>'voyage_number', ''))) AS number,
             NULLIF(btrim(COALESCE(r.value->>'vessel_name', '')), '') AS name,
             substring(upper(btrim(COALESCE(r.value->>'vessel_imo', ''))) FROM '^(?:IMO[\s:./-]*)?(\d{7})$') AS imo
    ) AS f
    CROSS JOIN LATERAL unnest(ARRAY[
      'schedule_voyage:name:' || upper(f.name) || ':' || f.number,
      'schedule_voyage:imo:' || f.imo || ':' || f.number
    ]) AS k(lock_key)
    WHERE NULLIF(r.value->>'voyage_id', '') IS NULL
      AND f.name IS NOT NULL AND f.number <> '' AND k.lock_key IS NOT NULL
    ORDER BY 1
  LOOP
    PERFORM pg_advisory_xact_lock(v_lock);
  END LOOP;

  FOR v_row IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    v_voyage := NULLIF(v_row->>'voyage_id', '')::bigint;
    v_number := upper(btrim(COALESCE(v_row->>'voyage_number', '')));
    IF v_voyage IS NULL THEN
      -- IMO só identifica com 7 dígitos (V7), na forma de `normalizeVesselImo`.
      v_imo := substring(upper(btrim(COALESCE(v_row->>'vessel_imo', ''))) FROM '^(?:IMO[\s:./-]*)?(\d{7})$');
      v_name := NULLIF(btrim(COALESCE(v_row->>'vessel_name', '')), '');
      IF v_name IS NULL OR v_number = '' THEN
        RAISE EXCEPTION 'Linha sem navio ou viagem.' USING ERRCODE = '22023';
      END IF;
      -- Duas linhas da mesma Viagem nova, ou um reenvio concorrente, não
      -- duplicam: as travas por nome e IMO desta Viagem já foram pegas antes do
      -- laço, em ordem (199 e 201).

      v_vessel := NULL;
      IF v_imo IS NOT NULL THEN
        SELECT array_agg(id ORDER BY id) INTO v_matches FROM public.vessels
        WHERE NULLIF(regexp_replace(upper(btrim(COALESCE(imo, ''))), '^IMO[\s:./-]*', ''), '') = v_imo;
        IF cardinality(v_matches) > 1 THEN
          RAISE EXCEPTION 'Navio com IMO % ambíguo: mais de um cadastro. Corrija antes de importar.', v_imo USING ERRCODE = '22023';
        END IF;
        v_vessel := v_matches[1];
      END IF;
      IF v_vessel IS NULL THEN
        SELECT array_agg(id ORDER BY id) INTO v_matches FROM public.vessels WHERE name = v_name;
        IF cardinality(v_matches) > 1 THEN
          RAISE EXCEPTION 'Navio % ambíguo: mais de um cadastro. Corrija antes de importar.', v_name USING ERRCODE = '22023';
        END IF;
        v_vessel := v_matches[1];
        -- IMO distinto nunca funde: nome igual com outro IMO cadastrado é conflito.
        IF v_vessel IS NOT NULL AND v_imo IS NOT NULL THEN
          SELECT NULLIF(regexp_replace(upper(btrim(COALESCE(imo, ''))), '^IMO[\s:./-]*', ''), '')
            INTO v_vessel_imo FROM public.vessels WHERE id = v_vessel;
          IF v_vessel_imo IS NOT NULL AND v_vessel_imo <> v_imo THEN
            RAISE EXCEPTION 'Navio % com IMO conflitante (% vs %). Corrija antes de importar.', v_name, v_vessel_imo, v_imo
              USING ERRCODE = '22023';
          END IF;
        END IF;
      END IF;

      -- A mesma Viagem pode ter sido criada por outra linha deste arquivo.
      IF v_vessel IS NOT NULL THEN
        SELECT id INTO v_voyage FROM public.voyages
        WHERE vessel_id = v_vessel AND upper(btrim(voyage_number)) = v_number ORDER BY id LIMIT 1;
      END IF;

      IF v_voyage IS NULL THEN
        IF v_vessel IS NULL THEN
          SELECT id INTO v_carrier FROM public.carriers
          WHERE (NULLIF(btrim(COALESCE(p_carrier_scac, '')), '') IS NOT NULL AND scac = btrim(p_carrier_scac))
             OR (NULLIF(btrim(COALESCE(p_carrier_scac, '')), '') IS NULL AND name = btrim(p_carrier_name))
          ORDER BY id LIMIT 1;
          IF v_carrier IS NULL THEN
            INSERT INTO public.carriers(name, scac) VALUES (btrim(p_carrier_name), NULLIF(btrim(COALESCE(p_carrier_scac, '')), ''))
            RETURNING id INTO v_carrier;
          END IF;
          INSERT INTO public.vessels(name, imo, carrier_id) VALUES (v_name, v_imo, v_carrier) RETURNING id INTO v_vessel;
        END IF;
        INSERT INTO public.voyages(vessel_id, voyage_number, pol_id, pod_id, status)
        VALUES (v_vessel, btrim(v_row->>'voyage_number'), NULL, NULL, 'active')
        RETURNING id INTO v_voyage;
        INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
        VALUES ('voyages', v_voyage::text, 'created', NULL, btrim(v_row->>'voyage_number'), v_actor, 'Atualizacao de dados da viagem');
        v_created := v_created + 1;
      ELSE
        v_updated := v_updated + 1;
      END IF;
    ELSE
      IF NOT EXISTS (SELECT 1 FROM public.voyages WHERE id = v_voyage) THEN
        RAISE EXCEPTION 'Viagem % não encontrada.', v_voyage USING ERRCODE = 'P0002';
      END IF;
      v_updated := v_updated + 1;
    END IF;

    -- Viagem cancelada é somente leitura (V8): recusa com o nome dela, antes
    -- de a trava da Viagem selada responder com mensagem técnica.
    SELECT v.status, btrim(concat_ws(' ', s.name, v.voyage_number)) INTO v_status, v_label
    FROM public.voyages v LEFT JOIN public.vessels s ON s.id = v.vessel_id WHERE v.id = v_voyage;
    IF v_status = 'cancelled' THEN
      RAISE EXCEPTION 'Viagem % cancelada: a programação dela não muda. Retire a linha da planilha.', v_label
        USING ERRCODE = '22023';
    END IF;

    UPDATE public.voyages SET show_on_portal = true WHERE id = v_voyage AND show_on_portal IS DISTINCT FROM true;

    -- Horário próprio por evento (V12): com a mesma Viagem e porto em duas
    -- linhas, a última do arquivo é a vigente para quem lê por horário.
    INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by, justification, changed_at)
    SELECT c->>'entity_type', v_voyage::text || '::' || upper(btrim(c->>'port')), c->>'field_name',
           c->>'old_value', c->>'new_value', v_actor, COALESCE(c->>'justification', ''), clock_timestamp()
    FROM jsonb_array_elements(COALESCE(v_row->'changes', '[]'::jsonb)) WITH ORDINALITY AS e(c, ord)
    WHERE c->>'entity_type' IN ('voyage_pol_schedule', 'voyage_pod_schedule')
    ORDER BY ord;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_changes := v_changes + v_count;
    v_ids := array_append(v_ids, v_voyage);
  END LOOP;

  RETURN jsonb_build_object('created', v_created, 'updated', v_updated, 'changes', v_changes, 'voyage_ids', to_jsonb(v_ids));
END $$;
-- Só o invólucro público (189) chama esta função.
REVOKE ALL ON FUNCTION public.apply_schedule_sheet_atomic_legacy_189(jsonb, text, text) FROM PUBLIC, anon, authenticated;
