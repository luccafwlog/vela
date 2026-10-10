-- 186 — Vazios: reimportação substitui a rota preservando a natureza; o
-- recadastro pelo Baplie preserva a natureza e remove manifestos vazios; o
-- Embarque de Vazios atualiza por container e preserva as unidades manuais
-- (ADR 0078, item 25; Etapa 11 do plano 2026-10-09-correcao-importacoes-ce-mercante).
--
-- Antes, reimportar Vazios de Importação duplicava os containers da rota (ou
-- recusava pelo Nº de Manifesto já cadastrado); o recadastro pelo Baplie apagava
-- a natureza (cama/cover plate) digitada na tela e deixava manifestos sem
-- container; o Embarque de Vazios apagava todas as unidades da operação,
-- inclusive as incluídas à mão, e deixava manifestos órfãos.

-- Natureza digitada, por container, antes de substituir as linhas da Viagem.
CREATE OR REPLACE FUNCTION public._vazios_importacao_natureza_map(p_voyage_id bigint)
RETURNS TABLE(container_number text, natureza text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT DISTINCT ON (upper(btrim(c.container_number))) upper(btrim(c.container_number)), c.natureza
  FROM public.vazios_importacao_containers c
  JOIN public.vazios_importacao_manifests m ON m.id = c.manifest_id
  WHERE m.voyage_id = p_voyage_id AND c.natureza IS NOT NULL
  ORDER BY upper(btrim(c.container_number)), c.created_at DESC NULLS LAST;
$$;
REVOKE ALL ON FUNCTION public._vazios_importacao_natureza_map(bigint) FROM PUBLIC, anon, authenticated;

-- Manifestos sem container e Nº de Manifesto `vazio` sem rota viva saem.
CREATE OR REPLACE FUNCTION public._vazios_importacao_prune(p_voyage_id bigint)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_count integer := 0; v_more integer;
BEGIN
  DELETE FROM public.vazios_importacao_manifests m
  WHERE m.voyage_id = p_voyage_id
    AND NOT EXISTS (SELECT 1 FROM public.vazios_importacao_containers c WHERE c.manifest_id = m.id);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  DELETE FROM public.manifestos_mercante mm
  WHERE mm.voyage_id = p_voyage_id AND mm.natureza = 'vazio'
    AND NOT EXISTS (SELECT 1 FROM public.bls b WHERE b.manifesto_mercante_id = mm.id)
    AND NOT EXISTS (
      SELECT 1 FROM public.vazios_importacao_containers c
      JOIN public.vazios_importacao_manifests m ON m.id = c.manifest_id
      WHERE m.voyage_id = p_voyage_id AND upper(btrim(c.pol)) = mm.pol AND upper(btrim(c.pod)) = mm.pod
    );
  GET DIAGNOSTICS v_more = ROW_COUNT;
  UPDATE public.vazios_importacao_manifests m
  SET total_containers = (SELECT count(*) FROM public.vazios_importacao_containers c WHERE c.manifest_id = m.id)
  WHERE m.voyage_id = p_voyage_id;
  RETURN v_count + v_more;
END $$;
REVOKE ALL ON FUNCTION public._vazios_importacao_prune(bigint) FROM PUBLIC, anon, authenticated;

-- Vazios de Importação ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.import_vazios_importacao_transactional(
  p_voyage_id bigint,
  p_description text,
  p_uploaded_by uuid,
  p_containers jsonb,
  p_manifestos jsonb DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_manifest_id uuid;
  v_containers jsonb := COALESCE(p_containers, '[]'::jsonb);
  v_manifestos jsonb := COALESCE(p_manifestos, '[]'::jsonb);
  v_total integer;
  v_sem_rota integer;
  v_rotas_sem_numero text;
  v_numero_repetido text;
  v_numero_cadastrado text;
  v_mercante_ids jsonb;
  v_replaced integer := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR p_uploaded_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa para importar vazios.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.voyages WHERE id = p_voyage_id) THEN
    RAISE EXCEPTION 'Viagem nao encontrada.' USING ERRCODE = 'P0002';
  END IF;
  IF jsonb_typeof(v_manifestos) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Número do manifesto Mercante é obrigatório.' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('vazios_importacao:' || p_voyage_id::text, 0));

  SELECT count(*),
         count(*) FILTER (WHERE NULLIF(btrim(item.pol), '') IS NULL OR NULLIF(btrim(item.pod), '') IS NULL)
    INTO v_total, v_sem_rota
    FROM jsonb_to_recordset(v_containers) AS item(pol text, pod text);

  IF v_total = 0 THEN
    RAISE EXCEPTION 'Nenhum container na planilha.' USING ERRCODE = '22023';
  END IF;
  IF v_sem_rota > 0 THEN
    RAISE EXCEPTION 'POL e POD são obrigatórios em todas as linhas: o Nº de manifesto Mercante pertence ao porto de origem.' USING ERRCODE = '22023';
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS pg_temp.vazios_import_manifestos (pol text, pod text, numero text) ON COMMIT DROP;
  TRUNCATE pg_temp.vazios_import_manifestos;
  INSERT INTO pg_temp.vazios_import_manifestos
  SELECT upper(btrim(m.pol)), upper(btrim(m.pod)), NULLIF(btrim(m.numero), '')
  FROM jsonb_to_recordset(v_manifestos) AS m(pol text, pod text, numero text);

  SELECT string_agg(r.pol || ' → ' || r.pod, ', ' ORDER BY r.pol, r.pod)
    INTO v_rotas_sem_numero
    FROM (
      SELECT DISTINCT upper(btrim(item.pol)) AS pol, upper(btrim(item.pod)) AS pod
      FROM jsonb_to_recordset(v_containers) AS item(pol text, pod text)
    ) r
    WHERE (SELECT count(*) FROM pg_temp.vazios_import_manifestos m
           WHERE m.pol = r.pol AND m.pod = r.pod AND m.numero IS NOT NULL) <> 1;
  IF v_rotas_sem_numero IS NOT NULL THEN
    RAISE EXCEPTION 'Informe um Nº de manifesto Mercante para cada porto de origem: falta em %.', v_rotas_sem_numero USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_temp.vazios_import_manifestos m
    WHERE m.numero IS NULL OR NOT EXISTS (
      SELECT 1 FROM jsonb_to_recordset(v_containers) AS item(pol text, pod text)
      WHERE upper(btrim(item.pol)) = m.pol AND upper(btrim(item.pod)) = m.pod
    )
  ) THEN
    RAISE EXCEPTION 'Há Nº de manifesto Mercante para uma rota que não está na planilha.' USING ERRCODE = '22023';
  END IF;

  SELECT min(numero) INTO v_numero_repetido
    FROM (SELECT numero FROM pg_temp.vazios_import_manifestos GROUP BY numero HAVING count(*) > 1) d;
  IF v_numero_repetido IS NOT NULL THEN
    RAISE EXCEPTION 'O número de manifesto Mercante "%" foi informado para mais de um porto de origem.', v_numero_repetido USING ERRCODE = '22023';
  END IF;

  -- O número da mesma rota de vazios nesta Viagem é reaproveitado; em qualquer
  -- outro lugar, recusa.
  SELECT min(m.numero) INTO v_numero_cadastrado
    FROM pg_temp.vazios_import_manifestos m
    JOIN public.manifestos_mercante mm ON mm.numero = m.numero
    WHERE NOT (mm.voyage_id = p_voyage_id AND mm.natureza = 'vazio' AND mm.pol = m.pol AND mm.pod = m.pod);
  IF v_numero_cadastrado IS NOT NULL THEN
    RAISE EXCEPTION 'O número de manifesto Mercante "%" já foi cadastrado no sistema.', v_numero_cadastrado USING ERRCODE = '23505';
  END IF;

  -- Natureza digitada antes da substituição.
  CREATE TEMP TABLE IF NOT EXISTS pg_temp.vazios_natureza (container_number text, natureza text) ON COMMIT DROP;
  TRUNCATE pg_temp.vazios_natureza;
  INSERT INTO pg_temp.vazios_natureza SELECT * FROM public._vazios_importacao_natureza_map(p_voyage_id);

  -- A planilha nova substitui os containers das rotas que ela traz.
  DELETE FROM public.vazios_importacao_containers c
  USING public.vazios_importacao_manifests m
  WHERE m.id = c.manifest_id AND m.voyage_id = p_voyage_id
    AND EXISTS (SELECT 1 FROM pg_temp.vazios_import_manifestos r
                WHERE r.pol = upper(btrim(c.pol)) AND r.pod = upper(btrim(c.pod)));
  GET DIAGNOSTICS v_replaced = ROW_COUNT;

  -- Nº de Manifesto da rota: corrige o existente ou cadastra.
  UPDATE public.manifestos_mercante mm SET numero = r.numero
  FROM pg_temp.vazios_import_manifestos r
  WHERE mm.voyage_id = p_voyage_id AND mm.natureza = 'vazio' AND mm.pol = r.pol AND mm.pod = r.pod
    AND mm.numero IS DISTINCT FROM r.numero;
  INSERT INTO public.manifestos_mercante (voyage_id, pol, pod, numero, natureza)
  SELECT p_voyage_id, r.pol, r.pod, r.numero, 'vazio'
  FROM pg_temp.vazios_import_manifestos r
  WHERE NOT EXISTS (SELECT 1 FROM public.manifestos_mercante mm
                    WHERE mm.voyage_id = p_voyage_id AND mm.natureza = 'vazio' AND mm.pol = r.pol AND mm.pod = r.pod);
  SELECT jsonb_agg(mm.id ORDER BY mm.numero) INTO v_mercante_ids
  FROM public.manifestos_mercante mm JOIN pg_temp.vazios_import_manifestos r
    ON mm.voyage_id = p_voyage_id AND mm.natureza = 'vazio' AND mm.pol = r.pol AND mm.pod = r.pod;

  INSERT INTO public.vazios_importacao_manifests (
    voyage_id, description, total_containers, imported_by, source
  )
  VALUES (p_voyage_id, p_description, v_total, p_uploaded_by, 'manual')
  RETURNING id INTO v_manifest_id;

  INSERT INTO public.vazios_importacao_containers (
    manifest_id, container_number, container_type, tare_kg, pol, pod, natureza
  )
  SELECT v_manifest_id, item.container_number, item.container_type, item.tare_kg, item.pol, item.pod, n.natureza
  FROM jsonb_to_recordset(v_containers) AS item(
    container_number text,
    container_type text,
    tare_kg numeric,
    pol text,
    pod text
  )
  LEFT JOIN pg_temp.vazios_natureza n ON n.container_number = upper(btrim(item.container_number));

  PERFORM public._vazios_importacao_prune(p_voyage_id);

  RETURN jsonb_build_object('manifest_id', v_manifest_id, 'mercante_manifest_ids', v_mercante_ids,
    'replaced_containers', v_replaced);
END;
$function$;
REVOKE ALL ON FUNCTION public.import_vazios_importacao_transactional(bigint, text, uuid, jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.import_vazios_importacao_transactional(bigint, text, uuid, jsonb, jsonb) TO authenticated;

-- Recadastro pelo Baplie ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.replace_vazios_from_baplie_transactional(p_voyage_id bigint, p_description text, p_uploaded_by uuid, p_replace_existing boolean DEFAULT false) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_manifest_id UUID;
  v_total INTEGER;
  v_pruned INTEGER;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR p_uploaded_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa para importar vazios Baplie.' USING ERRCODE = '42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('vazios_importacao:' || p_voyage_id::text, 0));

  SELECT count(*)::INTEGER
  INTO v_total
  FROM public.baplie_containers
  WHERE voyage_id = p_voyage_id AND status = 'empty';

  IF v_total = 0 THEN
    RAISE EXCEPTION 'Nenhum container vazio encontrado no Baplie desta viagem.'
      USING ERRCODE = 'P0002';
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

  RETURN jsonb_build_object('manifest_id', v_manifest_id, 'total', v_total, 'pruned', v_pruned);
END;
$$;
REVOKE ALL ON FUNCTION public.replace_vazios_from_baplie_transactional(bigint, text, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.replace_vazios_from_baplie_transactional(bigint, text, uuid, boolean) TO authenticated;

-- Embarque de Vazios ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.import_vazios_bookings_transactional(p_voyage_id bigint, p_port text, p_uploaded_by uuid, p_bookings jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $_$
DECLARE
  v_manifest_id UUID;
  v_operation_id UUID;
  v_total INTEGER := jsonb_array_length(COALESCE(p_bookings, '[]'::JSONB));
  v_updated INTEGER := 0;
  v_inserted INTEGER := 0;
  v_removed INTEGER := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user()
     OR p_uploaded_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa para importar unidades.' USING ERRCODE = '42501';
  END IF;
  IF NULLIF(btrim(p_port), '') IS NULL THEN
    RAISE EXCEPTION 'Porto de embarque obrigatorio.' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.voyages WHERE id = p_voyage_id) THEN
    RAISE EXCEPTION 'Viagem nao encontrada.' USING ERRCODE = 'P0002';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(COALESCE(p_bookings, '[]'::JSONB)) AS item(container_number TEXT)
    GROUP BY upper(btrim(container_number))
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Planilha invalida: Container duplicado na planilha.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.vazios_export_operations (voyage_id, embark_port, updated_at)
  VALUES (p_voyage_id, upper(btrim(p_port)), now())
  ON CONFLICT (voyage_id, embark_port) DO UPDATE SET updated_at = EXCLUDED.updated_at
  RETURNING id INTO v_operation_id;

  -- ponytail: validacao no RPC e tudo-ou-nada para nao subestimar pagamento por erro de uma linha.
  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(COALESCE(p_bookings, '[]'::JSONB)) AS r(
      container_number TEXT, container_type TEXT, local_code TEXT, condition TEXT,
      hand_in_date DATE, hand_out_date DATE, movement_date DATE
    )
    LEFT JOIN public.depots d ON lower(d.code) = lower(btrim(r.local_code))
    WHERE NULLIF(btrim(r.container_number), '') IS NULL
       OR r.container_number !~ '^[A-Za-z]{4}[0-9]{7}$'
       OR NULLIF(btrim(r.local_code), '') IS NULL
       OR d.id IS NULL
       OR (d.id IS NOT NULL AND NOT d.active)
       OR (COALESCE(d.tipo, 'depot') = 'depot' AND (r.hand_in_date IS NULL OR r.hand_out_date IS NULL))
       OR (COALESCE(d.tipo, 'depot') = 'depot' AND r.hand_out_date < r.hand_in_date)
       OR (d.id IS NOT NULL AND d.tipo = 'terminal_portuario' AND (r.hand_in_date IS NOT NULL OR r.hand_out_date IS NOT NULL))
       OR r.condition IS NULL OR r.condition NOT IN ('vazio', 'material')
  ) THEN
    RAISE EXCEPTION 'Planilha invalida: corrija todas as linhas e importe novamente.' USING ERRCODE = '22023';
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS pg_temp.vazios_bookings_in (
    container_number text, container_type text, local_id uuid, condition text,
    hand_in_date date, hand_out_date date, movement_date date
  ) ON COMMIT DROP;
  TRUNCATE pg_temp.vazios_bookings_in;
  INSERT INTO pg_temp.vazios_bookings_in
  SELECT upper(btrim(r.container_number)), r.container_type, d.id, r.condition, r.hand_in_date, r.hand_out_date, r.movement_date
  FROM jsonb_to_recordset(COALESCE(p_bookings, '[]'::JSONB)) AS r(
    container_number TEXT, container_type TEXT, local_code TEXT, condition TEXT,
    hand_in_date DATE, hand_out_date DATE, movement_date DATE
  )
  JOIN public.depots d ON lower(d.code) = lower(btrim(r.local_code)) AND d.active;

  INSERT INTO public.vazios_manifests (voyage_id, description, total_bookings, imported_by)
  VALUES (p_voyage_id, p_port, v_total, p_uploaded_by) RETURNING id INTO v_manifest_id;

  -- Atualiza por container (o mesmo id), inclusive a unidade incluída à mão.
  UPDATE public.vazios_bookings b
  SET container_type = i.container_type, local_id = i.local_id, condition = i.condition,
      hand_in_date = i.hand_in_date, hand_out_date = i.hand_out_date, movement_date = i.movement_date
  FROM pg_temp.vazios_bookings_in i
  WHERE b.operation_id = v_operation_id AND upper(btrim(b.container_number)) = i.container_number;
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  INSERT INTO public.vazios_bookings (
    voyage_id, operation_id, manifest_id, container_number, container_type,
    local_id, condition, hand_in_date, hand_out_date, movement_date
  )
  SELECT p_voyage_id, v_operation_id, v_manifest_id, i.container_number, i.container_type, i.local_id,
         i.condition, i.hand_in_date, i.hand_out_date, i.movement_date
  FROM pg_temp.vazios_bookings_in i
  WHERE NOT EXISTS (SELECT 1 FROM public.vazios_bookings b
                    WHERE b.operation_id = v_operation_id AND upper(btrim(b.container_number)) = i.container_number);
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  -- Unidade de planilha anterior que o arquivo novo não traz sai; a incluída à
  -- mão (manifesto de inclusão manual) fica.
  -- ponytail: a unidade manual é reconhecida pela descrição do manifesto que
  -- `create_manual_vazios_booking` grava; uma coluna de origem seria o upgrade.
  DELETE FROM public.vazios_bookings b
  USING public.vazios_manifests vm
  WHERE vm.id = b.manifest_id AND b.operation_id = v_operation_id
    AND vm.description IS DISTINCT FROM 'Inclusao manual no Embarque de Vazios'
    AND NOT EXISTS (SELECT 1 FROM pg_temp.vazios_bookings_in i WHERE i.container_number = upper(btrim(b.container_number)));
  GET DIAGNOSTICS v_removed = ROW_COUNT;

  -- Manifestos sem unidade não ficam órfãos.
  DELETE FROM public.vazios_manifests vm
  WHERE vm.voyage_id = p_voyage_id
    AND NOT EXISTS (SELECT 1 FROM public.vazios_bookings b WHERE b.manifest_id = vm.id);
  -- Os totais lidos pelos cards contam as unidades que ficaram em cada manifesto.
  UPDATE public.vazios_manifests vm
  SET total_bookings = (SELECT count(*) FROM public.vazios_bookings b WHERE b.manifest_id = vm.id)
  WHERE vm.voyage_id = p_voyage_id;

  RETURN jsonb_build_object(
    'manifest_id', CASE WHEN EXISTS (SELECT 1 FROM public.vazios_manifests WHERE id = v_manifest_id) THEN v_manifest_id END,
    'operation_id', v_operation_id,
    'total', v_total,
    'updated', v_updated,
    'inserted', v_inserted,
    'removed', v_removed,
    'replaced', FALSE
  );
END;
$_$;
REVOKE ALL ON FUNCTION public.import_vazios_bookings_transactional(bigint, text, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_vazios_bookings_transactional(bigint, text, uuid, jsonb) TO authenticated;
