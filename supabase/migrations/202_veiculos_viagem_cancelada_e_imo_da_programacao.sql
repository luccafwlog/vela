-- 202 — Mover veículos e Programação por planilha: achados da revisão
-- automática nas migrations 193 e 201 (revisão da PR 929).
--
-- Mover para outro B/L (`move_vehicles_to_bl`, da 193): a guarda da Viagem
-- Cancelada no veículo olha a Viagem nova (a de destino). Selecionar veículos
-- de uma Viagem Cancelada na página Veículos e movê-los para um B/L ativo
-- tirava os veículos da Viagem que deveria ficar somente leitura. Agora a
-- Viagem de origem também é conferida.
--
-- Programação por planilha (`apply_schedule_sheet_atomic_legacy_189`, da 201):
-- o navio sem IMO achado pelo nome seguia sem o IMO do arquivo. Uma linha
-- seguinte da mesma Viagem com outra grafia e o mesmo IMO não o achava e
-- criava outro navio e outra Viagem, embora a prévia as tratasse como a mesma.
-- Agora o IMO do arquivo é gravado no navio sem IMO, como no cadastro pela
-- tela.
--
-- O invólucro da 189 não muda. Grava o IMO só em navio sem IMO que a própria
-- importação acha; não reescreve outras linhas. Rollback: reaplicar a
-- definição da 193 (`move_vehicles_to_bl`) e a da 201.

CREATE OR REPLACE FUNCTION public.move_vehicles_to_bl(
  p_vehicle_ids bigint[], p_target_bl_id text, p_reason text, p_target_container_id bigint DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_target_id text := upper(btrim(COALESCE(p_target_bl_id, '')));
  v_target public.bls%ROWTYPE;
  v_container bigint := p_target_container_id;
  v_vehicle record;
  v_sources text[] := ARRAY[]::text[];
  v_moved integer := 0;
  v_bl text;
  v_source_status text;
  v_source_label text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Sem permissão para mover veículos.' USING ERRCODE = '42501';
  END IF;
  IF v_reason IS NULL THEN RAISE EXCEPTION 'Informe o motivo.' USING ERRCODE = '22023'; END IF;
  IF COALESCE(cardinality(p_vehicle_ids), 0) = 0 THEN RAISE EXCEPTION 'Selecione ao menos um veículo.' USING ERRCODE = '22023'; END IF;

  -- S4: destino e origens travados juntos, em ordem de id; dois movimentos
  -- cruzados (A→B e B→A) esperam um pelo outro em vez de se travarem.
  -- ponytail: veículo movido por outra sessão entre esta trava e a dos
  -- veículos traz um B/L de origem não travado aqui; o recálculo o trava
  -- depois, fora de ordem. Upgrade: repetir a trava até o conjunto estabilizar.
  PERFORM 1 FROM public.bls
  WHERE id = v_target_id OR id IN (SELECT bl_id FROM public.vehicles WHERE id = ANY(p_vehicle_ids))
  ORDER BY id FOR UPDATE;

  SELECT * INTO v_target FROM public.bls WHERE id = v_target_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'B/L % não encontrado.', p_target_bl_id USING ERRCODE = 'P0002'; END IF;
  IF v_target.cancelled_at IS NOT NULL THEN RAISE EXCEPTION 'B/L % está cancelado.', v_target.id USING ERRCODE = '22023'; END IF;

  IF v_container IS NULL THEN
    SELECT CASE WHEN count(*) = 1 THEN min(id) END INTO v_container FROM public.bl_containers WHERE bl_id = v_target.id;
    IF v_container IS NULL THEN
      RAISE EXCEPTION 'Escolha o container do B/L % que recebe os veículos.', v_target.id USING ERRCODE = '22023';
    END IF;
  ELSIF NOT EXISTS (SELECT 1 FROM public.bl_containers WHERE id = v_container AND bl_id = v_target.id) THEN
    RAISE EXCEPTION 'O container escolhido não é do B/L %.', v_target.id USING ERRCODE = '22023';
  END IF;

  FOR v_vehicle IN SELECT * FROM public.vehicles WHERE id = ANY(p_vehicle_ids) ORDER BY id FOR UPDATE LOOP
    IF v_vehicle.bl_id = v_target.id AND v_vehicle.container_id = v_container THEN CONTINUE; END IF;
    -- Viagem Cancelada é somente leitura também na saída (202): a guarda do
    -- veículo olha a Viagem de destino; a de origem é conferida aqui.
    SELECT v.status, btrim(concat_ws(' ', s.name, v.voyage_number)) INTO v_source_status, v_source_label
    FROM public.voyages AS v LEFT JOIN public.vessels AS s ON s.id = v.vessel_id
    WHERE v.id = COALESCE(v_vehicle.voyage_id, (SELECT b.voyage_id FROM public.bls AS b WHERE b.id = v_vehicle.bl_id));
    IF v_source_status = 'cancelled' THEN
      RAISE EXCEPTION 'Viagem % cancelada: o veículo % não sai dela.', v_source_label, v_vehicle.chassis USING ERRCODE = '42501';
    END IF;
    IF v_vehicle.voyage_id <> v_target.voyage_id AND EXISTS (
      SELECT 1 FROM public.vehicles WHERE voyage_id = v_target.voyage_id AND chassis = v_vehicle.chassis
    ) THEN
      RAISE EXCEPTION 'Chassi % já está na Viagem do B/L %.', v_vehicle.chassis, v_target.id USING ERRCODE = '23505';
    END IF;
    -- C13: cada campo que muda vai ao Histórico com o motivo (o gatilho
    -- gravaria sem ele); o que não muda não deixa marca pendente.
    IF v_vehicle.bl_id IS DISTINCT FROM v_target.id THEN
      PERFORM public._audit_skip_once('vehicles', v_vehicle.id::text, 'bl_id');
    END IF;
    IF v_vehicle.container_id IS DISTINCT FROM v_container THEN
      PERFORM public._audit_skip_once('vehicles', v_vehicle.id::text, 'container_id');
    END IF;
    IF v_vehicle.voyage_id IS DISTINCT FROM v_target.voyage_id THEN
      PERFORM public._audit_skip_once('vehicles', v_vehicle.id::text, 'voyage_id');
    END IF;
    UPDATE public.vehicles SET bl_id = v_target.id, container_id = v_container, voyage_id = v_target.voyage_id
    WHERE id = v_vehicle.id;
    INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
    SELECT 'vehicles', v_vehicle.id::text, f.field_name, f.old_value, f.new_value, auth.uid(), v_reason
    FROM (VALUES
      (1, 'bl_id', v_vehicle.bl_id, v_target.id),
      (2, 'container_id', v_vehicle.container_id::text, v_container::text),
      (3, 'voyage_id', v_vehicle.voyage_id::text, v_target.voyage_id::text)
    ) AS f(ord, field_name, old_value, new_value)
    WHERE f.old_value IS DISTINCT FROM f.new_value
    ORDER BY f.ord;
    v_sources := array_append(v_sources, v_vehicle.bl_id);
    v_moved := v_moved + 1;
  END LOOP;

  FOR v_bl IN SELECT DISTINCT unnest(v_sources || v_target.id) ORDER BY 1 LOOP
    PERFORM public._vehicle_charges_follow(v_bl, auth.uid());
  END LOOP;
  RETURN jsonb_build_object('moved', v_moved, 'target_bl_id', v_target.id, 'container_id', v_container);
END $$;
REVOKE ALL ON FUNCTION public.move_vehicles_to_bl(bigint[], text, text, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.move_vehicles_to_bl(bigint[], text, text, bigint) TO authenticated;

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
          -- Navio sem IMO achado pelo nome recebe o IMO do arquivo (202), como
          -- no cadastro pela tela (`getOrCreateVessel`): a linha seguinte com
          -- outra grafia e o mesmo IMO acha este navio, em vez de criar outro.
          IF v_vessel_imo IS NULL THEN
            UPDATE public.vessels SET imo = v_imo WHERE id = v_vessel;
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
