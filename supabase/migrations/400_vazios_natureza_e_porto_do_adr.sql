-- 400: Vazios — natureza do vazio do Baplie trocado pela planilha e porto do
-- ADR pela régua de porto (revisão da PR #1028; ADR 0095, decisões 21 e 22;
-- complementa a 398 e a 399).
--
-- 1. Porto do ADR. `_vazios_export_locked_by_adr` (262) comparava o porto só
--    com upper(btrim()): um Embarque gravado com apelido (BRVIT) não achava o
--    ADR de Saída fechado gravado no código canônico (BRVIX), e unidades,
--    linhas de serviço e inclusão direta passavam. A função passa a comparar
--    os dois lados por `normalize_port_code` (régua da 391), também na frente
--    de operação. O gatilho `guard_vazios_export_adr_lock`, a leitura
--    `vazios_export_adr_locked`, as RPCs de unidade manual (incluir, editar,
--    excluir), a linha de serviço e a reimportação chamam esta função: todas
--    passam a valer para o apelido.
-- 2. Natureza. Quando a planilha de Vazios de importação toma um container
--    que estava cadastrado pelo Baplie, a 398 apagava a linha do Baplie antes
--    de `import_vazios_importacao_transactional_legacy_189` guardar a natureza
--    (`_vazios_importacao_natureza_map`), e a cama/cover plate digitada se
--    perdia. Aqui a natureza dessas linhas é guardada antes de apagar e volta
--    para a linha nova da planilha quando ela chega sem natureza (a natureza
--    que a linha nova já tiver vale).
-- Não reescreve nem apaga linhas existentes.
--
-- Rollback: reaplicar `_vazios_export_locked_by_adr` da 262 e
-- `import_vazios_importacao_transactional` da 398.

-- 1. Porto do ADR pela régua de porto.
CREATE OR REPLACE FUNCTION public._vazios_export_locked_by_adr(p_voyage_id bigint, p_port text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.agency_departure_reports AS r
    WHERE r.voyage_id = p_voyage_id
      AND public.normalize_port_code(r.port) = public.normalize_port_code(p_port)
      AND r.status = 'closed'
      AND (
        r.terminal_id IS NULL
        OR EXISTS (
          SELECT 1 FROM public.voyage_escala_operation_fronts AS f
          WHERE f.voyage_id = r.voyage_id
            AND public.normalize_port_code(f.port) = public.normalize_port_code(r.port)
            AND f.sentido = 'exportacao' AND f.modalidade = 'vazio'
            AND f.terminal_id = r.terminal_id
        )
      )
  );
$function$;
REVOKE ALL ON FUNCTION public._vazios_export_locked_by_adr(bigint, text) FROM PUBLIC, anon, authenticated;

-- 2. A planilha vale sobre o Baplie e leva a natureza do vazio que substitui.
CREATE OR REPLACE FUNCTION public.import_vazios_importacao_transactional(p_voyage_id bigint, p_description text, p_uploaded_by uuid, p_containers jsonb, p_manifestos jsonb DEFAULT NULL::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_conflict record;
  v_from_baplie integer := 0;
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR p_uploaded_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa para importar vazios.' USING ERRCODE = '42501';
  END IF;
  PERFORM public._lock_import_voyages(ARRAY[p_voyage_id]);
  PERFORM public._set_import_context('Vazios de Importação', p_voyage_id, (SELECT string_agg(m->>'numero', ', ') FROM jsonb_array_elements(COALESCE(p_manifestos, '[]'::jsonb)) AS m));
  PERFORM pg_advisory_xact_lock(hashtextextended('vazios_importacao:' || p_voyage_id::text, 0));

  CREATE TEMP TABLE IF NOT EXISTS pg_temp.vazios_398_planilha (container_key text, container_number text, pol text, pod text) ON COMMIT DROP;
  TRUNCATE pg_temp.vazios_398_planilha;
  IF jsonb_typeof(p_containers) = 'array' THEN
    INSERT INTO pg_temp.vazios_398_planilha
    SELECT upper(regexp_replace(COALESCE(item.container_number, ''), '[^A-Za-z0-9]', '', 'g')),
           upper(btrim(item.container_number)),
           public.normalize_port_code(item.pol), public.normalize_port_code(item.pod)
    FROM jsonb_to_recordset(p_containers) AS item(container_number text, pol text, pod text);
  END IF;

  -- O mesmo container duas vezes no arquivo.
  SELECT p.container_number,
         string_agg(COALESCE(p.pol, '?') || ' → ' || COALESCE(p.pod, '?'), ' e ' ORDER BY p.pol, p.pod) AS rotas
    INTO v_conflict
  FROM pg_temp.vazios_398_planilha AS p
  WHERE p.container_key <> ''
  GROUP BY p.container_key, p.container_number
  HAVING count(*) > 1
  ORDER BY p.container_number
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'O container % aparece mais de uma vez na planilha (%): um vazio de importação existe uma vez por Viagem. Deixe uma linha só e escolha o arquivo de novo. Nada foi gravado.',
      v_conflict.container_number, v_conflict.rotas USING ERRCODE = '23505';
  END IF;

  -- Já está na Viagem, vindo de outra planilha, numa rota que esta planilha
  -- não traz (a planilha só substitui as rotas que traz).
  SELECT c.container_number, c.pol, c.pod INTO v_conflict
  FROM public.vazios_importacao_containers AS c
  JOIN public.vazios_importacao_manifests AS m ON m.id = c.manifest_id
  JOIN pg_temp.vazios_398_planilha AS p ON p.container_key = c.container_key
  WHERE c.voyage_id = p_voyage_id AND m.source <> 'baplie'
    AND NOT EXISTS (
      SELECT 1 FROM pg_temp.vazios_398_planilha AS r
      WHERE r.pol = public.normalize_port_code(c.pol) AND r.pod = public.normalize_port_code(c.pod)
    )
  ORDER BY c.container_number
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'O container % já está nos Vazios de importação desta Viagem na rota % → %, de outra planilha: um vazio de importação existe uma vez por Viagem. Tire o container desta planilha ou traga nela a rota % → % inteira, que a planilha substitui. Nada foi gravado.',
      v_conflict.container_number, COALESCE(v_conflict.pol, '?'), COALESCE(v_conflict.pod, '?'),
      COALESCE(v_conflict.pol, '?'), COALESCE(v_conflict.pod, '?') USING ERRCODE = '23505';
  END IF;

  -- A natureza digitada no vazio do Baplie que a planilha vai substituir.
  CREATE TEMP TABLE IF NOT EXISTS pg_temp.vazios_400_natureza_baplie (container_key text PRIMARY KEY, natureza text) ON COMMIT DROP;
  TRUNCATE pg_temp.vazios_400_natureza_baplie;
  INSERT INTO pg_temp.vazios_400_natureza_baplie
  SELECT DISTINCT ON (c.container_key) c.container_key, c.natureza
  FROM public.vazios_importacao_containers AS c
  JOIN public.vazios_importacao_manifests AS m ON m.id = c.manifest_id
  WHERE m.source = 'baplie' AND c.voyage_id = p_voyage_id AND c.natureza IS NOT NULL
    AND EXISTS (SELECT 1 FROM pg_temp.vazios_398_planilha AS p WHERE p.container_key = c.container_key)
  ORDER BY c.container_key, c.created_at DESC NULLS LAST;

  -- A planilha vale sobre o Baplie: o container que ela traz sai do Baplie,
  -- em qualquer rota.
  DELETE FROM public.vazios_importacao_containers AS c
  USING public.vazios_importacao_manifests AS m
  WHERE m.id = c.manifest_id AND m.source = 'baplie' AND c.voyage_id = p_voyage_id
    AND EXISTS (SELECT 1 FROM pg_temp.vazios_398_planilha AS p WHERE p.container_key = c.container_key);
  GET DIAGNOSTICS v_from_baplie = ROW_COUNT;

  v_result := public.import_vazios_importacao_transactional_legacy_189(p_voyage_id, p_description, p_uploaded_by, p_containers, p_manifestos);

  -- A linha nova da planilha sem natureza recebe a do Baplie substituído.
  UPDATE public.vazios_importacao_containers AS c
  SET natureza = n.natureza
  FROM pg_temp.vazios_400_natureza_baplie AS n,
       public.vazios_importacao_manifests AS m
  WHERE n.container_key = c.container_key AND m.id = c.manifest_id
    AND c.voyage_id = p_voyage_id AND m.source <> 'baplie' AND c.natureza IS NULL;

  RETURN v_result || jsonb_build_object('replaced_from_baplie', v_from_baplie);
END $function$;
