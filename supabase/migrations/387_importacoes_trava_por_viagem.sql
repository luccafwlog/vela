-- 387: trava por Viagem em toda importação de Viagem (ADR 0095, decisão 6;
-- revisão das importações de 2026-10-21, achados F-04 e F-11; Lote 1 do plano
-- docs/plans/2026-10-21-frente-das-importacoes.md).
--
-- Problema:
--   Cada importação travava do seu jeito (B/L por `bl:<id>`, CE por
--   `ce_mercante_voyage:<id>`, vazios por `vazios_importacao:<id>`, o Baplie
--   por nada). O INSERT em `bls`/`import_batches`/`baplie_containers` toma
--   FOR KEY SHARE na Viagem pela FK, e depois a própria importação (178) e o
--   gatilho diferido do status documental (134) pedem `voyages FOR UPDATE`:
--   duas importações da mesma Viagem caíam em deadlock (40P01, "deadlock
--   detected" em inglês na tela), e dois Baplies sobrepostos deixavam as duas
--   listas no staging.
--
-- Mudança:
--   1. `_lock_import_voyages(viagens)`: `pg_advisory_xact_lock` na chave
--      `import_voyage:<id>` de cada Viagem, em ordem crescente de id. Sem
--      SECURITY DEFINER e sem EXECUTE para a API: só as RPCs chamam.
--   2. `_lock_import_voyages_of_bls(viagens, B/Ls)`: o mesmo, juntando a
--      Viagem em que cada B/L já está (reimportação que traz o B/L de outra
--      Viagem toca as duas).
--   3. Toda RPC pública de importação de Viagem chama a trava como primeiro
--      passo, antes de qualquer escrita: arquivo de B/L, Manifesto BB e B/L
--      avulso (mesma RPC), planilha de CE, Baplie (marcas e vazios; o staging
--      é a 388), datas, Vazios de importação, Embarque de vazios, Veículos e
--      Granito. A segunda importação da mesma Viagem espera a primeira
--      terminar (COMMIT ou ROLLBACK) em vez de cruzar com ela.
--   4. `replace_vazios_from_baplie_transactional` volta a gravar o contexto da
--      importação no Histórico ("Importação de Vazios pelo Baplie · Viagem …"),
--      que a 336 tirou ao redefinir o nome público (F-26).
--
-- As travas que já existiam dentro dos corpos ficam (são tomadas depois desta
-- e, entre importações da mesma Viagem, nunca disputadas). Programação e Base
-- de Clientes não são de uma Viagem e ficam de fora.
--
-- ponytail: a trava é consultiva e só as importações a pedem; outra escrita na
-- Viagem (efeito da fila, edição na ficha) não espera por ela e ainda pode
-- cruzar com uma importação. Caminho de evolução: a mesma chamada nas RPCs de
-- edição que tocam a Viagem, se o deadlock aparecer nelas.
--
-- Só redefine funções; não reescreve nem apaga linhas existentes.
-- Rollback: reaplicar as definições anteriores dos invólucros (189 gerada,
-- 268/341/325/335/333/274/386 conforme o objeto) e DROP das duas funções de
-- trava.

CREATE OR REPLACE FUNCTION public._lock_import_voyages(p_voyage_ids bigint[])
RETURNS void
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id bigint;
BEGIN
  FOR v_id IN
    SELECT DISTINCT x FROM unnest(COALESCE(p_voyage_ids, ARRAY[]::bigint[])) AS x
    WHERE x IS NOT NULL ORDER BY x
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('import_voyage:' || v_id::text, 0));
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public._lock_import_voyages(bigint[]) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._lock_import_voyages_of_bls(p_voyage_ids bigint[], p_bl_ids text[])
RETURNS void
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public._lock_import_voyages(
    COALESCE(p_voyage_ids, ARRAY[]::bigint[])
    || ARRAY(SELECT b.voyage_id FROM public.bls AS b
             WHERE b.id = ANY(COALESCE(p_bl_ids, ARRAY[]::text[])) AND b.voyage_id IS NOT NULL));
END $$;
REVOKE ALL ON FUNCTION public._lock_import_voyages_of_bls(bigint[], text[]) FROM PUBLIC, anon, authenticated;

-- Id de Viagem lido do payload sem quebrar no texto inválido (o corpo recusa depois).
CREATE OR REPLACE FUNCTION public._import_payload_voyage_ids(p_items jsonb, p_key text)
RETURNS bigint[]
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(array_agg(DISTINCT (btrim(i.value->>p_key))::bigint), ARRAY[]::bigint[])
  FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_items) = 'array' THEN p_items ELSE '[]'::jsonb END) AS i(value)
  WHERE jsonb_typeof(i.value) = 'object' AND btrim(COALESCE(i.value->>p_key, '')) ~ '^[0-9]{1,18}$'
$$;
REVOKE ALL ON FUNCTION public._import_payload_voyage_ids(jsonb, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._import_payload_texts(p_items jsonb, p_key text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(array_agg(DISTINCT btrim(i.value->>p_key)), ARRAY[]::text[])
  FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_items) = 'array' THEN p_items ELSE '[]'::jsonb END) AS i(value)
  WHERE jsonb_typeof(i.value) = 'object' AND NULLIF(btrim(COALESCE(i.value->>p_key, '')), '') IS NOT NULL
$$;
REVOKE ALL ON FUNCTION public._import_payload_texts(jsonb, text) FROM PUBLIC, anon, authenticated;


-- Baplie: marcas (o staging é redefinido na 388).
CREATE OR REPLACE FUNCTION public.apply_baplie_physical_flags_atomic(p_voyage_id bigint, p_changes jsonb, p_changed_by uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  PERFORM public._lock_import_voyages(ARRAY[p_voyage_id]);
  PERFORM public._set_import_context('Baplie (marcas)', p_voyage_id, NULL);
  RETURN public.apply_baplie_physical_flags_atomic_legacy_189(p_voyage_id, p_changes, p_changed_by);
END $function$;

-- Planilha de CE: a Viagem da tela e a de cada B/L da planilha.
CREATE OR REPLACE FUNCTION public.apply_ce_mercante_rows_atomic(p_rows jsonb, p_changed_by uuid, p_target text DEFAULT 'bls'::text, p_manifesto_numero text DEFAULT NULL::text, p_voyage_id bigint DEFAULT NULL::bigint, p_confirm_changes boolean DEFAULT false, p_reason text DEFAULT NULL::text, p_defer_billing boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF p_target = 'granite' THEN
    RAISE EXCEPTION 'A planilha de CE Mercante não se aplica ao Granito: o Granito só totaliza a carga do navio.'
      USING ERRCODE = '22023';
  END IF;
  PERFORM public._lock_import_voyages_of_bls(ARRAY[p_voyage_id], public._import_payload_texts(p_rows, 'bl_id'));
  PERFORM public._set_import_context('CE Mercante', p_voyage_id, p_manifesto_numero);
  RETURN public.apply_ce_mercante_rows_atomic_legacy_189(p_rows, p_changed_by, p_target, p_manifesto_numero, p_voyage_id, p_confirm_changes, p_reason, p_defer_billing);
END $function$;

-- Planilha de datas: as Viagens dos B/Ls do arquivo, antes dos conjuntos de container.
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
  IF jsonb_array_length(p_batches) > 300 THEN
    RAISE EXCEPTION 'Planilha com mais de 300 B/Ls: divida o arquivo.' USING ERRCODE = '22023';
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

-- Arquivo de B/L: a Viagem de cada B/L do arquivo e a Viagem em que ele já está.
CREATE OR REPLACE FUNCTION public.import_bl_freight_file_atomic(p_bls jsonb, p_changed_by uuid, p_batch jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET statement_timeout TO '60s'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_result jsonb;
  v_core jsonb;
  v_discarded jsonb;
BEGIN
  IF v_actor IS NULL OR NOT public.is_active_user() OR p_changed_by IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa.' USING ERRCODE = '42501';
  END IF;
  IF p_bls IS NULL OR jsonb_typeof(p_bls) <> 'array' OR jsonb_array_length(p_bls) = 0 THEN
    RAISE EXCEPTION 'Nenhum B/L informado.' USING ERRCODE = '22023';
  END IF;

  -- 387: trava das Viagens antes da primeira escrita (ADR 0095, decisão 6).
  PERFORM public._lock_import_voyages_of_bls(
    public._import_payload_voyage_ids(p_bls, 'voyage_id')
      || public._import_payload_voyage_ids(jsonb_build_array(COALESCE(p_batch, '{}'::jsonb)), 'voyage_id'),
    public._import_payload_texts(p_bls, 'id'));

  IF p_batch IS NULL THEN
    v_result := public.import_bl_freight_transactional(p_bls, p_changed_by);
    v_core := v_result;
  ELSE
    v_result := public.import_bl_freight_with_metadata(p_bls, p_changed_by, p_batch);
    v_core := v_result->'result';
  END IF;

  v_discarded := COALESCE(v_core->'vehicles_discarded', '[]'::jsonb);
  IF jsonb_typeof(v_discarded) = 'array' AND jsonb_array_length(v_discarded) > 0 THEN
    RAISE EXCEPTION 'Nada foi gravado: o banco recusou veiculos da aba VIN (%).', jsonb_array_length(v_discarded)
      USING ERRCODE = '23514', HINT = 'vehicles_discarded', DETAIL = v_discarded::text;
  END IF;

  RETURN v_result;
END;
$function$;

-- Manifesto BB e B/L avulso de carga solta (a mesma RPC).
CREATE OR REPLACE FUNCTION public.import_breakbulk_manifest_transactional(p_filename text, p_voyage_id bigint, p_uploaded_by uuid, p_total_bls integer, p_bls jsonb, p_items jsonb, p_errors jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_result jsonb;
  v_bl text;
BEGIN
  PERFORM public._lock_import_voyages_of_bls(ARRAY[p_voyage_id], public._import_payload_texts(p_bls, 'id'));
  PERFORM public._set_import_context('Manifesto BB', p_voyage_id, NULL);
  v_result := public.import_breakbulk_manifest_transactional_legacy_189(p_filename, p_voyage_id, p_uploaded_by, p_total_bls, p_bls, p_items, p_errors);
  FOR v_bl IN
    SELECT b.id FROM public.bls b
    -- B/L novo ou alterado; o idêntico só se nunca foi calculado.
    WHERE (b.id IN (SELECT jsonb_array_elements_text(coalesce(v_result->'inserted_bl_ids', '[]'::jsonb) || coalesce(v_result->'updated_bl_ids', '[]'::jsonb)))
           OR (b.id IN (SELECT r->>'id' FROM jsonb_array_elements(coalesce(p_bls, '[]'::jsonb)) r)
               AND coalesce(b.charge_status, 'not_calculated') = 'not_calculated'))
      AND b.cancelled_at IS NULL AND coalesce(b.financial_status, 'pending') = 'pending'
      AND cardinality(public._live_local_invoice_ids_for_bl(b.id)) = 0
    ORDER BY b.id
  LOOP
    BEGIN
      PERFORM public.calculate_bl_local_charges(v_bl, p_uploaded_by, true);
    EXCEPTION WHEN OTHERS THEN
      PERFORM public._raise_local_charge_failure(v_bl, SQLSTATE, SQLERRM);
    END;
  END LOOP;
  RETURN v_result;
END $function$;

-- Granito.
CREATE OR REPLACE FUNCTION public.import_granite_manifest_transactional(p_voyage_id bigint, p_vessel_voyage text, p_loading_port text, p_discharge_port text, p_total_bls integer, p_total_weight_kg numeric, p_uploaded_by uuid, p_bls jsonb, p_remove_missing text[] DEFAULT NULL::text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bls jsonb := p_bls;
  v_result jsonb;
BEGIN
  PERFORM public._lock_import_voyages(ARRAY[p_voyage_id]);
  PERFORM public._set_import_context('Granito', p_voyage_id, NULL);

  -- O Granito não tem Cliente: o vínculo e a sugestão do arquivo não entram.
  IF jsonb_typeof(p_bls) = 'array' THEN
    SELECT COALESCE(jsonb_agg(item.value || '{"client_id": null, "suggested_client_id": null}'::jsonb ORDER BY item.ordinality), '[]'::jsonb)
    INTO v_bls
    FROM jsonb_array_elements(p_bls) WITH ORDINALITY AS item(value, ordinality);
  END IF;

  BEGIN
    v_result := public.import_granite_manifest_transactional_legacy_189(
      p_voyage_id, p_vessel_voyage, p_loading_port, p_discharge_port,
      p_total_bls, p_total_weight_kg, p_uploaded_by, v_bls, p_remove_missing
    );
  EXCEPTION
    -- Achado G7: as recusas do corpo legado vinham sem acento.
    WHEN insufficient_privilege THEN
      IF SQLERRM = 'Credenciais invalidas para importar manifesto Granito.' THEN
        RAISE EXCEPTION 'Sem permissão para importar o Granito: entre de novo com um usuário ativo.' USING ERRCODE = '42501';
      END IF;
      RAISE;
    WHEN no_data_found THEN
      IF SQLERRM = 'Viagem nao encontrada.' THEN
        RAISE EXCEPTION 'Viagem de destino não encontrada.' USING ERRCODE = 'P0002';
      END IF;
      RAISE;
    WHEN invalid_parameter_value THEN
      IF SQLERRM = 'Manifesto Granito invalido.' THEN
        RAISE EXCEPTION 'A planilha não tem B/L de Granito válido para gravar.' USING ERRCODE = '22023';
      END IF;
      RAISE;
  END;

  -- ponytail: o corpo legado ainda enfileira `granite_billing` por B/L novo ou
  -- alterado; aqui o efeito desta transação sai da fila antes do commit (o
  -- runner só vê a fila depois dele). Identifica-se pelo autor, pela Viagem e
  -- pelo instante da transação (`now()`). Caminho de evolução: reescrever o
  -- corpo sem o INSERT quando a limpeza das colunas sem uso acontecer.
  DELETE FROM public.import_pending_effects
  WHERE effect_kind = 'granite_billing'
    AND status = 'pending'
    AND created_by = p_uploaded_by
    AND created_at = now()
    AND source_snapshot->>'voyage_id' = p_voyage_id::text;

  RETURN v_result;
END $function$;

-- Embarque de vazios (exportação, mas da Viagem).
CREATE OR REPLACE FUNCTION public.import_vazios_bookings_transactional(p_voyage_id bigint, p_port text, p_uploaded_by uuid, p_bookings jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user()
     OR p_uploaded_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa para importar unidades.' USING ERRCODE = '42501';
  END IF;
  PERFORM public._lock_import_voyages(ARRAY[p_voyage_id]);
  IF public._vazios_export_locked_by_adr(p_voyage_id, p_port) THEN
    RAISE EXCEPTION 'O ADR de Saída deste porto está fechado: reabra o ADR para mudar as unidades embarcadas.'
      USING ERRCODE = '23514';
  END IF;
  PERFORM public._set_import_context('Embarque de Vazios', p_voyage_id, NULL);
  RETURN public.import_vazios_bookings_transactional_legacy_189(p_voyage_id, p_port, p_uploaded_by, p_bookings);
END $function$;

-- Vazios de importação (planilha).
CREATE OR REPLACE FUNCTION public.import_vazios_importacao_transactional(p_voyage_id bigint, p_description text, p_uploaded_by uuid, p_containers jsonb, p_manifestos jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  PERFORM public._lock_import_voyages(ARRAY[p_voyage_id]);
  PERFORM public._set_import_context('Vazios de Importação', p_voyage_id, (SELECT string_agg(m->>'numero', ', ') FROM jsonb_array_elements(COALESCE(p_manifestos, '[]'::jsonb)) AS m));
  RETURN public.import_vazios_importacao_transactional_legacy_189(p_voyage_id, p_description, p_uploaded_by, p_containers, p_manifestos);
END $function$;

-- Veículos: a Viagem de cada linha e a do B/L de cada linha.
CREATE OR REPLACE FUNCTION public.import_vehicle_rows_transactional(p_rows jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  PERFORM public._lock_import_voyages_of_bls(public._import_payload_voyage_ids(p_rows, 'voyage_id'), public._import_payload_texts(p_rows, 'bl_id'));
  PERFORM public._set_import_context('Veículos', (p_rows->0->>'voyage_id')::bigint, NULL);
  RETURN public.import_vehicle_rows_transactional_legacy_189(p_rows);
END $function$;

-- Vazios pelo Baplie: trava e, de volta, o contexto do Histórico (F-26).
CREATE OR REPLACE FUNCTION public.replace_vazios_from_baplie_transactional(p_voyage_id bigint, p_description text, p_uploaded_by uuid, p_replace_existing boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_manifest_id UUID;
  v_total INTEGER;
  v_pruned INTEGER;
  v_removed INTEGER;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR p_uploaded_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa para importar vazios Baplie.' USING ERRCODE = '42501';
  END IF;
  PERFORM public._lock_import_voyages(ARRAY[p_voyage_id]);
  PERFORM public._set_import_context('Vazios pelo Baplie', p_voyage_id, NULL);
  PERFORM pg_advisory_xact_lock(hashtextextended('vazios_importacao:' || p_voyage_id::text, 0));

  SELECT count(*)::INTEGER
  INTO v_total
  FROM public.baplie_containers
  WHERE voyage_id = p_voyage_id AND status = 'empty';

  IF v_total = 0 THEN
    IF NOT p_replace_existing THEN
      RAISE EXCEPTION 'Nenhum container vazio encontrado no Baplie desta viagem.'
        USING ERRCODE = 'P0002';
    END IF;
    -- Baplie novo sem vazios: os vazios do Baplie anterior saem da Viagem.
    DELETE FROM public.vazios_importacao_manifests
    WHERE voyage_id = p_voyage_id AND source = 'baplie';
    GET DIAGNOSTICS v_removed = ROW_COUNT;
    v_pruned := public._vazios_importacao_prune(p_voyage_id);
    RETURN jsonb_build_object('manifest_id', NULL, 'total', 0, 'pruned', v_pruned, 'removed', v_removed > 0);
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS pg_temp.vazios_natureza (container_number text, natureza text) ON COMMIT DROP;
  TRUNCATE pg_temp.vazios_natureza;
  INSERT INTO pg_temp.vazios_natureza SELECT * FROM public._vazios_importacao_natureza_map(p_voyage_id);

  IF p_replace_existing THEN
    DELETE FROM public.vazios_importacao_manifests
    WHERE voyage_id = p_voyage_id AND source = 'baplie';
  ELSIF EXISTS (
    SELECT 1 FROM public.vazios_importacao_manifests
    WHERE voyage_id = p_voyage_id AND source = 'baplie'
  ) THEN
    RAISE EXCEPTION 'Ja existe manifesto Baplie para esta viagem.'
      USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.vazios_importacao_manifests (
    voyage_id, description, total_containers, imported_by, source
  )
  VALUES (
    p_voyage_id, COALESCE(p_description, 'Importado via Baplie EDI'),
    v_total, p_uploaded_by, 'baplie'
  )
  RETURNING id INTO v_manifest_id;

  INSERT INTO public.vazios_importacao_containers (
    manifest_id, container_number, container_type, tare_kg, pol, pod, natureza
  )
  SELECT v_manifest_id, b.container_number, b.size_type, b.weight_kg, b.pol, b.pod, n.natureza
  FROM public.baplie_containers b
  LEFT JOIN pg_temp.vazios_natureza n ON n.container_number = upper(btrim(b.container_number))
  WHERE b.voyage_id = p_voyage_id AND b.status = 'empty';

  v_pruned := public._vazios_importacao_prune(p_voyage_id);

  RETURN jsonb_build_object('manifest_id', v_manifest_id, 'total', v_total, 'pruned', v_pruned, 'removed', false);
END;
$function$;

-- O corpo da 189 que a 336 deixou sem chamador (F-26).
DROP FUNCTION IF EXISTS public.replace_vazios_from_baplie_transactional_legacy_189(bigint, text, uuid, boolean);
