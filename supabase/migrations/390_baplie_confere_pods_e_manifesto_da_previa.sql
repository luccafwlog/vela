-- 390: Baplie confere os portos marcados e o manifesto de vazios da prévia
-- (revisão da PR luccafwlog/vela#1023 sobre a `388`; ADR 0095, decisões 11 e
-- 13, achado F-20; Lote 1 da frente das importações).
--
-- Problema:
--   1. `p_pods` podia trazer um porto sem nenhuma linha em `p_rows`. O escopo
--      da exclusão (`_baplie_row_replaced`) apagava o staging desse porto, e
--      com ele as marcas vindas do Baplie e os vazios (natureza digitada e Nº
--      do manifesto Mercante das rotas que ficavam sem container). A tela só
--      manda portos que têm container; o caminho aberto era API ou tela antiga.
--   2. O diálogo de `reimportBaplie` lê o manifesto de vazios do Baplie e avisa
--      o que acontece com a natureza e o Nº do manifesto Mercante. Se outra
--      sessão criasse, recadastrasse ou apagasse esse manifesto entre a prévia
--      e a gravação, a RPC agia sobre um manifesto que o operador não viu.
--
-- Mudança: `import_baplie_file_atomic` (mesma assinatura) passa a
--   - recusar porto marcado sem container no arquivo, com a mesma régua de
--     porto da `388` (`_baplie_port_key`) dos dois lados;
--   - conferir, depois da trava da Viagem, `p_expected.vazios_manifest`: o
--     manifesto de vazios do Baplie lido na prévia (`{id, total}` ou nulo).
--     O recadastro sempre cria manifesto novo (id novo) e a poda das rotas
--     (`_vazios_importacao_prune`) atualiza `total_containers`; id e total são
--     a versão. Sem a chave (tela anterior ao deploy), recusa e pede a prévia
--     de novo: o único chamador é `reimportBaplie`, que manda a chave.
-- Só redefine funções; nenhuma linha existente é reescrita.
--
-- ponytail: a versão do manifesto é id + total; trocar a natureza de um vazio
-- não muda nenhum dos dois e não é conferida (o diálogo não mostra a natureza
-- de cada vazio, só avisa que a digitada sai com o vazio). Se o diálogo passar
-- a mostrar a natureza, a versão precisa de um carimbo de alteração.
--
-- Rollback: recriar `import_baplie_file_atomic` pela definição da `388` e DROP
-- de `_baplie_vazios_manifest_version`.

-- Manifesto de vazios do Baplie da Viagem como a prévia lê
-- (`getBaplieManifestForVoyage`: o mais recente de origem Baplie).
CREATE OR REPLACE FUNCTION public._baplie_vazios_manifest_version(p_voyage_id bigint)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE((
    SELECT jsonb_build_object('id', m.id, 'total', m.total_containers)
    FROM public.vazios_importacao_manifests AS m
    WHERE m.voyage_id = p_voyage_id AND m.source = 'baplie'
    ORDER BY m.imported_at DESC, m.id
    LIMIT 1
  ), 'null'::jsonb)
$$;
REVOKE ALL ON FUNCTION public._baplie_vazios_manifest_version(bigint) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.import_baplie_file_atomic(
  p_voyage_id bigint,
  p_rows jsonb,
  p_pods text[],
  p_expected jsonb,
  p_file jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET statement_timeout = '60s'
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_voyage public.voyages%ROWTYPE;
  v_file_voyage text := NULLIF(btrim(COALESCE(p_file->>'voyage_number', '')), '');
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

  -- Decisão 6: a segunda importação da Viagem espera esta terminar.
  PERFORM public._lock_import_voyages(ARRAY[p_voyage_id]);
  PERFORM public._set_import_context('Baplie', p_voyage_id, NULL);

  SELECT * INTO v_voyage FROM public.voyages WHERE id = p_voyage_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Viagem de destino não encontrada.' USING ERRCODE = 'P0002';
  END IF;

  -- Decisão 13: a Viagem do arquivo é a escolhida; sem TDT, a prévia confirma.
  IF v_file_voyage IS NOT NULL THEN
    IF public._baplie_voyage_key(v_file_voyage) IS DISTINCT FROM public._baplie_voyage_key(v_voyage.voyage_number) THEN
      RAISE EXCEPTION 'O arquivo é da viagem %; a viagem escolhida é %. Nada foi gravado.', v_file_voyage, COALESCE(v_voyage.voyage_number, '—')
        USING ERRCODE = '22023';
    END IF;
  ELSIF COALESCE(p_file->>'voyage_confirmed', '') <> 'true' THEN
    RAISE EXCEPTION 'O arquivo não diz a viagem: confirme na prévia que este Baplie é da viagem escolhida. Nada foi gravado.'
      USING ERRCODE = '22023';
  END IF;

  -- Container repetido no arquivo.
  SELECT string_agg(n, ', ' ORDER BY n), count(*) INTO v_list, v_count FROM (
    SELECT upper(btrim(r.value->>'container_number')) AS n
    FROM jsonb_array_elements(p_rows) AS r(value)
    GROUP BY 1 HAVING count(*) > 1 ORDER BY 1 LIMIT 20
  ) AS d;
  IF v_count > 0 THEN
    RAISE EXCEPTION 'Container repetido no Baplie (%): nada foi gravado. Confira o arquivo.', v_list USING ERRCODE = '22023';
  END IF;

  -- Container de POD que o operador não marcou.
  v_pod_keys := ARRAY(SELECT DISTINCT public._baplie_port_key(p) FROM unnest(p_pods) AS p WHERE NULLIF(btrim(COALESCE(p, '')), '') IS NOT NULL);
  SELECT string_agg(DISTINCT r.value->>'pod', ', '), count(*) INTO v_list, v_count
  FROM jsonb_array_elements(p_rows) AS r(value)
  WHERE NULLIF(btrim(COALESCE(r.value->>'pod', '')), '') IS NOT NULL
    AND NOT (public._baplie_port_key(r.value->>'pod') = ANY(v_pod_keys));
  IF v_count > 0 THEN
    RAISE EXCEPTION '% container(s) com porto de descarga fora dos portos marcados (%): nada foi gravado.', v_count, v_list
      USING ERRCODE = '22023';
  END IF;

  -- 390: porto marcado sem nenhum container no arquivo. O escopo da exclusão
  -- (`_baplie_row_replaced`) apagaria o Baplie, as marcas e os vazios dele.
  SELECT string_agg(k, ', ' ORDER BY k), count(*) INTO v_list, v_count
  FROM unnest(v_pod_keys) AS k
  WHERE NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_rows) AS r(value)
    WHERE NULLIF(btrim(COALESCE(r.value->>'pod', '')), '') IS NOT NULL
      AND public._baplie_port_key(r.value->>'pod') = k
  );
  IF v_count > 0 THEN
    RAISE EXCEPTION 'Porto(s) marcado(s) sem nenhum container no arquivo (%): gravar apagaria o Baplie, as marcas e os vazios já gravados desse(s) porto(s). Desmarque o porto ou confira o arquivo. Nada foi gravado.', v_list
      USING ERRCODE = '22023';
  END IF;

  -- POD fora das escalas ativas da Viagem (sem escala cadastrada, nada é conferido, como na prévia).
  v_eligible := ARRAY(SELECT DISTINCT public._baplie_port_key(e.pod) FROM public.get_voyage_eligible_pods(p_voyage_id) AS e);
  IF cardinality(v_eligible) > 0 THEN
    SELECT string_agg(DISTINCT r.value->>'pod', ', '), count(*) INTO v_list, v_count
    FROM jsonb_array_elements(p_rows) AS r(value)
    WHERE NULLIF(btrim(COALESCE(r.value->>'pod', '')), '') IS NOT NULL
      AND NOT (public._baplie_port_key(r.value->>'pod') = ANY(v_eligible));
    IF v_count > 0 THEN
      RAISE EXCEPTION '% container(s) descarregam fora das escalas da Viagem (%): a prévia os deixa de fora. Nada foi gravado.', v_count, v_list
        USING ERRCODE = '22023';
    END IF;
  END IF;

  -- F-20: o staging que a prévia leu é o que está gravado.
  v_current := public._baplie_staging_version(p_voyage_id);
  IF jsonb_typeof(p_expected) IS DISTINCT FROM 'object'
     OR (p_expected->'count') IS DISTINCT FROM (v_current->'count')
     OR (p_expected->'max_id') IS DISTINCT FROM (v_current->'max_id') THEN
    RAISE EXCEPTION 'O Baplie desta viagem mudou depois da prévia (outra importação foi gravada). Escolha o arquivo de novo para conferir a diferença. Nada foi gravado.'
      USING ERRCODE = '22023';
  END IF;

  -- 390: o manifesto de vazios do Baplie que a prévia leu (e o diálogo usou
  -- para avisar da natureza e do Nº do manifesto Mercante) é o que está gravado.
  v_manifest := public._baplie_vazios_manifest_version(p_voyage_id);
  IF (p_expected->'vazios_manifest') IS DISTINCT FROM v_manifest THEN
    RAISE EXCEPTION 'Os vazios de importação do Baplie desta viagem mudaram depois da prévia (outra sessão recadastrou, alterou ou apagou o manifesto de vazios). Escolha o arquivo de novo para conferir a diferença. Nada foi gravado.'
      USING ERRCODE = '22023';
  END IF;
  v_previous_total := (v_current->>'count')::integer;

  v_incoming := ARRAY(SELECT DISTINCT upper(btrim(r.value->>'container_number')) FROM jsonb_array_elements(p_rows) AS r(value));
  SELECT COALESCE(string_agg(upper(btrim(container_number)) || '|' || COALESCE(pol, '') || '|' || COALESCE(pod, ''), ',' ORDER BY 1), '')
    INTO v_empties_before
  FROM public.baplie_containers WHERE voyage_id = p_voyage_id AND status = 'empty';

  -- Decisão 11: só os PODs marcados saem; o resto da Viagem fica.
  PERFORM set_config('alerts.baplie_coverage_deferred', 'on', true);
  DELETE FROM public.baplie_containers AS b
  WHERE b.voyage_id = p_voyage_id
    AND public._baplie_row_replaced(b.pod, b.container_number, v_pod_keys, v_incoming);
  GET DIAGNOSTICS v_replaced = ROW_COUNT;

  INSERT INTO public.baplie_containers (
    voyage_id, container_number, size_type, status, weight_kg, pol, pod, final_dest, bl_ref, slot,
    is_imo, imo_class, un_number, is_oog, ownership, imported_by
  )
  SELECT
    p_voyage_id, row.container_number, row.size_type, row.status, row.weight_kg, row.pol, row.pod,
    row.final_dest, row.bl_ref, row.slot, row.is_imo, row.imo_class, row.un_number, row.is_oog,
    CASE WHEN upper(btrim(row.ownership)) IN ('SOC', 'COC') THEN upper(btrim(row.ownership)) END,
    v_actor
  FROM jsonb_to_recordset(p_rows) AS row(
    container_number text, size_type text, status text, weight_kg numeric, pol text, pod text,
    final_dest text, bl_ref text, slot text, is_imo boolean, imo_class text, un_number text,
    is_oog boolean, ownership text
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
      || COALESCE(' (portos ' || NULLIF(array_to_string(ARRAY(SELECT unnest(v_pod_keys) ORDER BY 1), ', '), '') || ')', ''),
    v_role, v_role
  );

  PERFORM set_config('alerts.baplie_coverage_deferred', 'off', true);
  PERFORM public.reconcile_voyage_baplie_coverage_alerts(p_voyage_id, 'baplie_coverage_import');
  PERFORM public.reconcile_voyage_baplie_missing_alerts(p_voyage_id, 'baplie_import');

  -- F-20: marcas e vazios na mesma transação do staging.
  v_flags := public.apply_baplie_physical_flags_atomic(p_voyage_id, NULL, v_actor);

  SELECT COALESCE(string_agg(upper(btrim(container_number)) || '|' || COALESCE(pol, '') || '|' || COALESCE(pod, ''), ',' ORDER BY 1), '')
    INTO v_empties_after
  FROM public.baplie_containers WHERE voyage_id = p_voyage_id AND status = 'empty';
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
    'flags', v_flags,
    'vazios', v_vazios
  );
END $$;
REVOKE ALL ON FUNCTION public.import_baplie_file_atomic(bigint, jsonb, text[], jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_baplie_file_atomic(bigint, jsonb, text[], jsonb, jsonb) TO authenticated;
