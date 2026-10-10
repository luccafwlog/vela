-- 187 — Programação por planilha atômica (Etapa 11 do plano
-- 2026-10-09-correcao-importacoes-ce-mercante; achado OUT-14 da revisão).
--
-- Antes, a tela gravava linha a linha (criar Viagem, ETD/ETA por porto) e uma
-- falha no meio deixava parte gravada, e um reenvio podia duplicar a Viagem.
-- Agora a tela monta a prévia (Viagem existente ou nova, datas que mudam) e
-- grava tudo numa transação: se uma linha falha, nada é gravado.
--
-- Cada linha traz a Viagem já encontrada (`voyage_id`) ou os dados para criá-la
-- (navio pelo IMO normalizado, depois pelo nome canônico; armador padrão), e as
-- mudanças de agenda já calculadas pela tela, por porto. O `entity_id` da
-- agenda é montado aqui (`<voyage_id>::<porto>`), para servir também à Viagem nova.

CREATE OR REPLACE FUNCTION public.apply_schedule_sheet_atomic(
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
  v_name text;
  v_number text;
  v_matches bigint[];
  v_created integer := 0;
  v_updated integer := 0;
  v_changes integer := 0;
  v_ids bigint[] := ARRAY[]::bigint[];
  v_count integer;
BEGIN
  IF v_actor IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Sem permissão para atualizar a programação.' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION 'Planilha sem linhas.' USING ERRCODE = '22023';
  END IF;

  FOR v_row IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    v_voyage := NULLIF(v_row->>'voyage_id', '')::bigint;
    v_number := upper(btrim(COALESCE(v_row->>'voyage_number', '')));
    IF v_voyage IS NULL THEN
      v_imo := NULLIF(btrim(COALESCE(v_row->>'vessel_imo', '')), '');
      v_name := NULLIF(btrim(COALESCE(v_row->>'vessel_name', '')), '');
      IF v_name IS NULL OR v_number = '' THEN
        RAISE EXCEPTION 'Linha sem navio ou viagem.' USING ERRCODE = '22023';
      END IF;
      -- Duas linhas da mesma Viagem nova, ou um reenvio concorrente, não duplicam.
      PERFORM pg_advisory_xact_lock(hashtextextended('schedule_voyage:' || COALESCE(v_imo, v_name) || ':' || v_number, 0));

      v_vessel := NULL;
      IF v_imo IS NOT NULL THEN
        SELECT array_agg(id) INTO v_matches FROM public.vessels WHERE regexp_replace(COALESCE(imo, ''), '\D', '', 'g') = regexp_replace(v_imo, '\D', '', 'g');
        IF cardinality(v_matches) > 1 THEN
          RAISE EXCEPTION 'Navio com IMO % ambíguo: mais de um cadastro. Corrija antes de importar.', v_imo USING ERRCODE = '22023';
        END IF;
        v_vessel := v_matches[1];
      END IF;
      IF v_vessel IS NULL THEN
        SELECT array_agg(id) INTO v_matches FROM public.vessels WHERE name = v_name;
        IF cardinality(v_matches) > 1 THEN
          RAISE EXCEPTION 'Navio % ambíguo: mais de um cadastro. Corrija antes de importar.', v_name USING ERRCODE = '22023';
        END IF;
        v_vessel := v_matches[1];
      END IF;

      -- A mesma Viagem pode ter sido criada por outra linha deste arquivo.
      IF v_vessel IS NOT NULL THEN
        SELECT id INTO v_voyage FROM public.voyages
        WHERE vessel_id = v_vessel AND upper(btrim(voyage_number)) = v_number LIMIT 1;
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

    UPDATE public.voyages SET show_on_portal = true WHERE id = v_voyage AND show_on_portal IS DISTINCT FROM true;

    INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
    SELECT c->>'entity_type', v_voyage::text || '::' || upper(btrim(c->>'port')), c->>'field_name',
           c->>'old_value', c->>'new_value', v_actor, COALESCE(c->>'justification', '')
    FROM jsonb_array_elements(COALESCE(v_row->'changes', '[]'::jsonb)) AS c
    WHERE c->>'entity_type' IN ('voyage_pol_schedule', 'voyage_pod_schedule');
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_changes := v_changes + v_count;
    v_ids := array_append(v_ids, v_voyage);
  END LOOP;

  RETURN jsonb_build_object('created', v_created, 'updated', v_updated, 'changes', v_changes, 'voyage_ids', to_jsonb(v_ids));
END $$;
REVOKE ALL ON FUNCTION public.apply_schedule_sheet_atomic(jsonb, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_schedule_sheet_atomic(jsonb, text, text) TO authenticated;
