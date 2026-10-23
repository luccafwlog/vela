-- 411: o Baplie cria a escala do porto marcado que ainda não é escala da
-- Viagem (revisão manual de 2026-10-22, item D1).
--
-- Problema:
--   GREEN ITAJAI / 11: o Baplie trazia 242 containers com descarga em
--   Sepetiba/Itaguaí, porto sem escala na Viagem. A prévia os listava como
--   "fora das escalas" e só deixava importar os 672 de BRVIX; para trazê-los
--   era preciso cadastrar a escala à mão e importar de novo.
--
-- Mudança:
--   `import_baplie_file_atomic` (409) aceita `p_file.new_escalas`: portos
--   brasileiros que a prévia ofereceu desmarcados e o operador marcou. Antes
--   de conferir as escalas, cria cada uma no Histórico da Viagem
--   (`voyage_pod_schedule`: `deleted=false` e `tem_importacao=true`, com a
--   justificativa "Escala criada pela importação do Baplie"), e os containers
--   desse porto passam na conferência. A escala nasce sem datas (ETA, ATA e
--   atracações são informados na Viagem). Recusa: Viagem cancelada, porto
--   estrangeiro, porto não marcado no arquivo e escala omitida (a omissão é
--   revertida na Viagem). Escala removida volta ao planejamento; escala só de
--   exportação passa a descarregar importação. A assinatura não muda (os
--   chamadores e os grants da 403 continuam valendo); o retorno ganha
--   `escalas_criadas`.
--
-- Só redefine a função; não reescreve nem apaga linhas existentes.
--
-- Rollback: reaplicar `import_baplie_file_atomic` da 409.

CREATE OR REPLACE FUNCTION public.import_baplie_file_atomic(p_voyage_id bigint, p_rows jsonb, p_pods text[], p_expected jsonb, p_file jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET statement_timeout TO '60s'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_voyage public.voyages%ROWTYPE;
  v_codes text[];
  v_rows jsonb;
  v_other_carrier integer;
  v_pod_keys text[];
  v_incoming text[];
  v_eligible text[];
  v_list text;
  v_count integer;
  v_current jsonb;
  v_previous_total integer;
  v_replaced integer;
  v_staged integer;
  v_total integer;
  v_empties_before text;
  v_empties_after text;
  v_role text;
  v_flags jsonb;
  v_vazios jsonb;
  v_manifest jsonb;
  v_new_escalas text[];
  v_new text;
  v_state record;
  v_escalas_criadas text[] := '{}';
BEGIN
  IF v_actor IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Credenciais invalidas ou sem permissao para importar Baplie.' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(COALESCE(p_rows, 'null'::jsonb)) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION 'O Baplie não tem nenhum container: confira o arquivo antes de importar. O Baplie anterior da viagem foi mantido.'
      USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_rows) AS r(value) WHERE jsonb_typeof(r.value) <> 'object') THEN
    RAISE EXCEPTION 'Linha do Baplie inválida: nada foi gravado.' USING ERRCODE = '22023';
  END IF;
  IF p_pods IS NULL THEN
    RAISE EXCEPTION 'Informe os portos de descarga que este Baplie substitui: nada foi gravado.' USING ERRCODE = '22023';
  END IF;

  PERFORM public._lock_import_voyages(ARRAY[p_voyage_id]);
  PERFORM public._set_import_context('Baplie', p_voyage_id, NULL);

  SELECT * INTO v_voyage FROM public.voyages WHERE id = p_voyage_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Viagem de destino não encontrada.' USING ERRCODE = 'P0002';
  END IF;

  -- 409 (ADR 0096, decisão 2): o número de viagem do Baplie não é conferido
  -- com o da Viagem (o armador não usa o mesmo número); navio, armador e
  -- escalas continuam conferidos. `p_file` segue aceito por compatibilidade.

  -- 403 (decisão 14): container de outro armador (pelos códigos do armador da
  -- Viagem) não entra no staging, nas marcas nem na conciliação; só é contado.
  v_codes := public._baplie_carrier_codes(p_voyage_id);
  SELECT COALESCE(jsonb_agg(r.value) FILTER (WHERE NOT public._baplie_other_carrier(r.value->>'operator', v_codes)), '[]'::jsonb),
         count(*) FILTER (WHERE public._baplie_other_carrier(r.value->>'operator', v_codes))
    INTO v_rows, v_other_carrier
  FROM jsonb_array_elements(p_rows) AS r(value);
  IF jsonb_array_length(v_rows) = 0 THEN
    RAISE EXCEPTION 'Nenhum container a importar: os % container(s) do arquivo são de outro armador (códigos do armador da Viagem: %). O Baplie anterior da viagem foi mantido.',
      v_other_carrier, array_to_string(v_codes, ', ')
      USING ERRCODE = '22023';
  END IF;

  SELECT string_agg(n, ', ' ORDER BY n), count(*) INTO v_list, v_count FROM (
    SELECT upper(btrim(r.value->>'container_number')) AS n
    FROM jsonb_array_elements(v_rows) AS r(value)
    GROUP BY 1 HAVING count(*) > 1 ORDER BY 1 LIMIT 20
  ) AS d;
  IF v_count > 0 THEN
    RAISE EXCEPTION 'Container repetido no Baplie (%): nada foi gravado. Confira o arquivo.', v_list USING ERRCODE = '22023';
  END IF;

  v_pod_keys := ARRAY(SELECT DISTINCT public._baplie_port_key(p) FROM unnest(p_pods) AS p WHERE NULLIF(btrim(COALESCE(p, '')), '') IS NOT NULL);
  SELECT string_agg(DISTINCT r.value->>'pod', ', '), count(*) INTO v_list, v_count
  FROM jsonb_array_elements(v_rows) AS r(value)
  WHERE NULLIF(btrim(COALESCE(r.value->>'pod', '')), '') IS NOT NULL
    AND NOT (public._baplie_port_key(r.value->>'pod') = ANY(v_pod_keys));
  IF v_count > 0 THEN
    RAISE EXCEPTION '% container(s) com porto de descarga fora dos portos marcados (%): nada foi gravado.', v_count, v_list
      USING ERRCODE = '22023';
  END IF;

  SELECT string_agg(k, ', ' ORDER BY k), count(*) INTO v_list, v_count
  FROM unnest(v_pod_keys) AS k
  WHERE NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_rows) AS r(value)
    WHERE NULLIF(btrim(COALESCE(r.value->>'pod', '')), '') IS NOT NULL
      AND public._baplie_port_key(r.value->>'pod') = k
  );
  IF v_count > 0 THEN
    RAISE EXCEPTION 'Porto(s) marcado(s) sem nenhum container no arquivo (%): gravar apagaria o Baplie, as marcas e os vazios já gravados desse(s) porto(s). Desmarque o porto ou confira o arquivo. Nada foi gravado.', v_list
      USING ERRCODE = '22023';
  END IF;

  -- 411: porto marcado que não é escala da Viagem e que a prévia ofereceu
  -- como escala nova (`p_file.new_escalas`) vira escala aqui, na mesma
  -- transação: a recusa de qualquer conferência abaixo desfaz a escala junto.
  v_new_escalas := ARRAY(
    SELECT DISTINCT public.normalize_port_code(e)
    FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(p_file->'new_escalas') = 'array' THEN p_file->'new_escalas' ELSE '[]'::jsonb END) AS e
    WHERE NULLIF(btrim(e), '') IS NOT NULL);
  IF cardinality(v_new_escalas) > 0 THEN
    IF v_voyage.status = 'cancelled' THEN
      RAISE EXCEPTION 'Viagem cancelada é somente leitura: a escala de % não foi criada. Nada foi gravado.', array_to_string(v_new_escalas, ', ')
        USING ERRCODE = '22023';
    END IF;
    SELECT string_agg(k, ', ' ORDER BY k) INTO v_list FROM unnest(v_new_escalas) AS k WHERE k !~ '^BR[A-Z0-9]{3}$';
    IF v_list IS NOT NULL THEN
      RAISE EXCEPTION 'Só porto brasileiro vira escala da Viagem (%): nada foi gravado.', v_list USING ERRCODE = '22023';
    END IF;
    SELECT string_agg(k, ', ' ORDER BY k) INTO v_list FROM unnest(v_new_escalas) AS k WHERE NOT (k = ANY(v_pod_keys));
    IF v_list IS NOT NULL THEN
      RAISE EXCEPTION 'Escala nova sem o porto marcado no arquivo (%): nada foi gravado.', v_list USING ERRCODE = '22023';
    END IF;
    v_role := public.current_actor_role();
    FOREACH v_new IN ARRAY v_new_escalas LOOP
      -- Último estado de cada grafia do porto na Viagem (BRSEP e BRIGI são a mesma escala).
      SELECT
        bool_or(l.field_name = 'omitted' AND l.new_value = 'true') AS omitted,
        bool_or(l.field_name = 'deleted' AND l.new_value = 'true') AS deleted,
        bool_or(l.field_name = 'tem_importacao' AND l.new_value = 'false') AS no_import,
        count(*) AS fields
      INTO v_state
      FROM (
        SELECT DISTINCT ON (a.entity_id, a.field_name) a.field_name, a.new_value
        FROM public.audit_logs a
        WHERE a.entity_type = 'voyage_pod_schedule'
          AND a.entity_id LIKE p_voyage_id::text || '::%'
          AND public.normalize_port_code(split_part(a.entity_id, '::', 2)) = v_new
          AND a.field_name IN ('deleted', 'omitted', 'tem_importacao')
        ORDER BY a.entity_id, a.field_name, a.changed_at DESC, a.id DESC
      ) l;
      IF COALESCE(v_state.omitted, false) THEN
        RAISE EXCEPTION 'A escala de % foi omitida: reverta a omissão na Viagem antes de importar containers para ela. Nada foi gravado.', v_new
          USING ERRCODE = '22023';
      END IF;
      -- Já é escala elegível (outra sessão a criou depois da prévia): nada a criar.
      CONTINUE WHEN v_new = ANY(ARRAY(SELECT public._baplie_port_key(e.pod) FROM public.get_voyage_eligible_pods(p_voyage_id) AS e));
      INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification, actor_role, actor_department)
      SELECT 'voyage_pod_schedule', p_voyage_id::text || '::' || v_new, f.field, f.old_value, f.new_value, v_actor, clock_timestamp(),
             'Escala criada pela importação do Baplie (containers com descarga em ' || v_new || ')', v_role, v_role
      FROM (VALUES
        ('deleted', CASE WHEN COALESCE(v_state.deleted, false) THEN 'true' END, 'false', COALESCE(v_state.deleted, false) OR v_state.fields = 0),
        ('tem_importacao', CASE WHEN COALESCE(v_state.no_import, false) THEN 'false' END, 'true', COALESCE(v_state.no_import, false) OR v_state.fields = 0)
      ) AS f(field, old_value, new_value, needed)
      WHERE f.needed;
      v_escalas_criadas := array_append(v_escalas_criadas, v_new);
    END LOOP;
  END IF;

  v_eligible := ARRAY(SELECT DISTINCT public._baplie_port_key(e.pod) FROM public.get_voyage_eligible_pods(p_voyage_id) AS e);
  IF cardinality(v_eligible) > 0 THEN
    SELECT string_agg(DISTINCT r.value->>'pod', ', '), count(*) INTO v_list, v_count
    FROM jsonb_array_elements(v_rows) AS r(value)
    WHERE NULLIF(btrim(COALESCE(r.value->>'pod', '')), '') IS NOT NULL
      AND NOT (public._baplie_port_key(r.value->>'pod') = ANY(v_eligible));
    IF v_count > 0 THEN
      RAISE EXCEPTION '% container(s) descarregam fora das escalas da Viagem (%): a prévia os deixa de fora. Nada foi gravado.', v_count, v_list
        USING ERRCODE = '22023';
    END IF;
  END IF;

  v_current := public._baplie_staging_version(p_voyage_id);
  IF jsonb_typeof(p_expected) IS DISTINCT FROM 'object'
     OR (p_expected->'count') IS DISTINCT FROM (v_current->'count')
     OR (p_expected->'max_id') IS DISTINCT FROM (v_current->'max_id') THEN
    RAISE EXCEPTION 'O Baplie desta viagem mudou depois da prévia (outra importação foi gravada). Escolha o arquivo de novo para conferir a diferença. Nada foi gravado.'
      USING ERRCODE = '22023';
  END IF;

  v_manifest := public._baplie_vazios_manifest_version(p_voyage_id);
  IF (p_expected->'vazios_manifest') IS DISTINCT FROM v_manifest THEN
    RAISE EXCEPTION 'Os vazios de importação do Baplie desta viagem mudaram depois da prévia (outra sessão recadastrou, alterou ou apagou o manifesto de vazios). Escolha o arquivo de novo para conferir a diferença. Nada foi gravado.'
      USING ERRCODE = '22023';
  END IF;
  v_previous_total := (v_current->>'count')::integer;

  v_incoming := ARRAY(SELECT DISTINCT upper(btrim(r.value->>'container_number')) FROM jsonb_array_elements(v_rows) AS r(value));
  -- Vazio em transbordo não é vazio de importação (decisão 15).
  SELECT COALESCE(string_agg(upper(btrim(container_number)) || '|' || COALESCE(pol, '') || '|' || COALESCE(pod, ''), ',' ORDER BY 1), '')
    INTO v_empties_before
  FROM public.baplie_containers WHERE voyage_id = p_voyage_id AND status = 'empty' AND NOT is_transshipment;

  PERFORM set_config('alerts.baplie_coverage_deferred', 'on', true);
  DELETE FROM public.baplie_containers AS b
  WHERE b.voyage_id = p_voyage_id
    AND public._baplie_row_replaced(b.pod, b.container_number, v_pod_keys, v_incoming);
  GET DIAGNOSTICS v_replaced = ROW_COUNT;

  INSERT INTO public.baplie_containers (
    voyage_id, container_number, size_type, status, weight_kg, pol, pod, final_dest, bl_ref, slot,
    is_imo, imo_class, un_number, is_oog, ownership, is_transshipment, imported_by
  )
  SELECT
    p_voyage_id, row.container_number, row.size_type, row.status, row.weight_kg, row.pol, row.pod,
    row.final_dest, row.bl_ref, row.slot, row.is_imo, row.imo_class, row.un_number, row.is_oog,
    CASE WHEN upper(btrim(row.ownership)) IN ('SOC', 'COC') THEN upper(btrim(row.ownership)) END,
    COALESCE(row.is_transshipment, false),
    v_actor
  FROM jsonb_to_recordset(v_rows) AS row(
    container_number text, size_type text, status text, weight_kg numeric, pol text, pod text,
    final_dest text, bl_ref text, slot text, is_imo boolean, imo_class text, un_number text,
    is_oog boolean, ownership text, is_transshipment boolean
  );
  GET DIAGNOSTICS v_staged = ROW_COUNT;

  SELECT count(*) INTO v_total FROM public.baplie_containers WHERE voyage_id = p_voyage_id;
  v_role := public.current_actor_role();
  INSERT INTO public.audit_logs(
    entity_type, entity_id, field_name, old_value, new_value,
    changed_by, justification, actor_role, actor_department
  ) VALUES (
    'voyage', p_voyage_id::text, 'baplie_import',
    v_previous_total::text, v_total::text,
    v_actor,
    CASE WHEN v_previous_total > 0 THEN 'Baplie substituído' ELSE 'Baplie importado' END
      || COALESCE(' (portos ' || NULLIF(array_to_string(ARRAY(SELECT unnest(v_pod_keys) ORDER BY 1), ', '), '') || ')', '')
      || CASE WHEN v_other_carrier > 0 THEN '; ' || v_other_carrier || ' container(s) de outro armador fora' ELSE '' END,
    v_role, v_role
  );

  PERFORM set_config('alerts.baplie_coverage_deferred', 'off', true);
  PERFORM public.reconcile_voyage_baplie_coverage_alerts(p_voyage_id, 'baplie_coverage_import');
  PERFORM public.reconcile_voyage_baplie_missing_alerts(p_voyage_id, 'baplie_import');

  v_flags := public.apply_baplie_physical_flags_atomic(p_voyage_id, NULL, v_actor);

  SELECT COALESCE(string_agg(upper(btrim(container_number)) || '|' || COALESCE(pol, '') || '|' || COALESCE(pod, ''), ',' ORDER BY 1), '')
    INTO v_empties_after
  FROM public.baplie_containers WHERE voyage_id = p_voyage_id AND status = 'empty' AND NOT is_transshipment;
  IF v_empties_after IS DISTINCT FROM v_empties_before
     AND EXISTS (SELECT 1 FROM public.vazios_importacao_manifests WHERE voyage_id = p_voyage_id AND source = 'baplie') THEN
    v_vazios := public.replace_vazios_from_baplie_transactional(p_voyage_id, NULL, v_actor, true);
  END IF;

  RETURN jsonb_build_object(
    'voyage_id', p_voyage_id,
    'staged', v_staged,
    'replaced', v_replaced,
    'previous_total', v_previous_total,
    'total', v_total,
    'pods', to_jsonb(v_pod_keys),
    'other_carrier', v_other_carrier,
    'flags', v_flags,
    'vazios', v_vazios,
    'escalas_criadas', to_jsonb(v_escalas_criadas)
  );
END $function$;
