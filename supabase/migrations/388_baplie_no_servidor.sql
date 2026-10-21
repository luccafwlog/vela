-- 388: Baplie conferido e gravado no servidor (ADR 0095, decisões 6, 11 e 13;
-- revisão das importações de 2026-10-21, achados F-04, F-16, F-20, F-21 e F-22;
-- Lote 1 do plano docs/plans/2026-10-21-frente-das-importacoes.md).
--
-- Problema:
--   F-04/F-22. O staging do Baplie não tinha trava nem unicidade: duas
--     gravações sobrepostas deixavam as duas listas (600 linhas para 300
--     containers) e o /baplie contava em dobro.
--   F-21. O modal grava só os PODs marcados, mas a RPC apagava a Viagem
--     inteira: os containers dos PODs desmarcados, as marcas deles, o Nº do
--     manifesto Mercante de vazios e a natureza sumiam.
--   F-16. Viagem, escalas e container repetido eram conferidos só no navegador.
--   F-20. A prévia velha sobrescrevia sem aviso (sem `expected`), e staging,
--     marcas e vazios eram três transações: falha no meio deixava o staging
--     novo com as marcas e os vazios do anterior.
--
-- Mudança:
--   1. Limpeza das linhas repetidas do staging (fica a mais nova de cada
--      container na Viagem) e índice único (viagem, container normalizado).
--      Esta limpeza apaga linhas existentes e depende da afirmação
--      "Data status" do AGENTS.md (seção Gotchas): os dados de produção são de
--      teste. A guarda de Viagem cancelada fica desligada só durante o DELETE.
--   2. `import_baplie_file_atomic(viagem, linhas, PODs, esperado, arquivo)`
--      substitui `import_baplie_staging_transactional` e faz tudo numa
--      transação, depois da trava `import_voyage:<id>` (387):
--        - confere a Viagem do arquivo (TDT) com a escolhida; sem TDT, exige a
--          confirmação da prévia (`arquivo.voyage_confirmed`);
--        - recusa container repetido no arquivo, container de POD fora dos
--          marcados e POD fora das escalas ativas da Viagem (a prévia já os
--          deixa de fora com aviso; aqui só chegam por API ou tela antiga);
--        - confere o `esperado` (quantidade e maior id do staging que a prévia
--          leu): outra importação gravada depois da prévia recusa esta;
--        - apaga do staging só os PODs marcados (mais os containers sem POD e
--          os que o arquivo traz em outro POD) e grava o arquivo;
--        - aplica as marcas (IMO/OOG, SOC/COC) e, se já havia vazios vindos do
--          Baplie e os vazios do staging mudaram, recadastra os vazios — na
--          mesma transação: qualquer falha desfaz o arquivo inteiro.
--   3. `preview_baplie_physical_flags` ganha os PODs marcados: a prévia das
--      marcas parte do mesmo staging que a gravação vai deixar.
--   4. Saem `import_baplie_staging_transactional` e o corpo `_legacy_189`:
--      nenhum caminho grava o staging sem trava, sem conferência e sem as
--      marcas. A tela anterior ao deploy recebe "função não encontrada" e
--      precisa ser recarregada.
--
-- O navio do TDT continua conferido só na prévia: o nome canônico (apelidos de
-- navio) só existe no navegador; a Viagem é a conferência do servidor.
--
-- Rollback: recriar `import_baplie_staging_transactional` e o `_legacy_189`
-- pelas definições da 341 e da 121, `preview_baplie_physical_flags(bigint,
-- jsonb)` pela 182, DROP das funções novas e do índice único. As linhas
-- repetidas apagadas não voltam (eram cópias de container da mesma Viagem).

-- 1. Linhas repetidas e índice único.
ALTER TABLE public.baplie_containers DISABLE TRIGGER trg_guard_voyage_cancelled_baplie_containers;
DELETE FROM public.baplie_containers AS b
USING public.baplie_containers AS newer
WHERE newer.voyage_id = b.voyage_id
  AND upper(btrim(newer.container_number)) = upper(btrim(b.container_number))
  AND newer.id > b.id;
ALTER TABLE public.baplie_containers ENABLE TRIGGER trg_guard_voyage_cancelled_baplie_containers;

CREATE UNIQUE INDEX IF NOT EXISTS baplie_containers_voyage_container_key
  ON public.baplie_containers (voyage_id, (upper(btrim(container_number))));

-- 2. Régua de porto do Baplie no servidor.
-- ponytail: `normalize_port_code` mais os apelidos exatos que o leitor do front
-- reconhece (`EXACT_PORT_ALIASES` em src/services/portCode.ts). Cópia pequena
-- até o Lote 3 (decisão 12) dar uma régua só aos dois lados.
CREATE OR REPLACE FUNCTION public._baplie_port_key(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT public.normalize_port_code(CASE upper(btrim(COALESCE(p_value, '')))
    WHEN 'BRSPB' THEN 'BRSEP' WHEN 'SPB' THEN 'BRSEP' WHEN 'SEP' THEN 'BRSEP'
    WHEN 'CNTCA' THEN 'CNTAC' WHEN 'TCA' THEN 'CNTAC'
    WHEN 'TAO' THEN 'CNTAO' WHEN 'CNCAN' THEN 'CNNSA'
    ELSE p_value END)
$$;
REVOKE ALL ON FUNCTION public._baplie_port_key(text) FROM PUBLIC, anon, authenticated;

-- Linha do staging que a importação substitui: POD marcado, sem POD, ou
-- container que o arquivo traz (em qualquer POD). Sem lista de PODs, tudo.
CREATE OR REPLACE FUNCTION public._baplie_row_replaced(p_pod text, p_container text, p_pod_keys text[], p_incoming text[])
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT p_pod_keys IS NULL
    OR NULLIF(btrim(COALESCE(p_pod, '')), '') IS NULL
    OR public._baplie_port_key(p_pod) = ANY(p_pod_keys)
    OR upper(btrim(COALESCE(p_container, ''))) = ANY(COALESCE(p_incoming, ARRAY[]::text[]))
$$;
REVOKE ALL ON FUNCTION public._baplie_row_replaced(text, text, text[], text[]) FROM PUBLIC, anon, authenticated;

-- Versão do staging: o que a prévia leu e a gravação confere.
CREATE OR REPLACE FUNCTION public._baplie_staging_version(p_voyage_id bigint)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object('count', count(*), 'max_id', max(id))
  FROM public.baplie_containers WHERE voyage_id = p_voyage_id
$$;
REVOKE ALL ON FUNCTION public._baplie_staging_version(bigint) FROM PUBLIC, anon, authenticated;

-- Chave de viagem como na prévia (`voyageKey` em src/services/baplieImport.ts):
-- pontuação e zeros à esquerda não contam ("0012N" = "12N").
CREATE OR REPLACE FUNCTION public._baplie_voyage_key(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT regexp_replace(regexp_replace(upper(COALESCE(p_value, '')), '[^A-Z0-9]', '', 'g'), '^0+', '')
$$;
REVOKE ALL ON FUNCTION public._baplie_voyage_key(text) FROM PUBLIC, anon, authenticated;

-- 3. Importação do Baplie.
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

-- 4. Prévia das marcas sobre o staging que a gravação vai deixar.
DROP FUNCTION IF EXISTS public.preview_baplie_physical_flags(bigint, jsonb);
CREATE FUNCTION public.preview_baplie_physical_flags(p_voyage_id bigint, p_rows jsonb, p_pods text[] DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_pod_keys text[] := CASE WHEN p_pods IS NULL THEN NULL
    ELSE ARRAY(SELECT DISTINCT public._baplie_port_key(p) FROM unnest(p_pods) AS p WHERE NULLIF(btrim(COALESCE(p, '')), '') IS NOT NULL) END;
  v_incoming text[] := ARRAY(SELECT DISTINCT upper(btrim(r.value->>'container_number'))
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_rows) = 'array' THEN p_rows ELSE '[]'::jsonb END) AS r(value));
  v_staged jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa.' USING ERRCODE = '42501';
  END IF;
  -- O que fica do staging (PODs não marcados) mais o arquivo.
  SELECT COALESCE(jsonb_agg(to_jsonb(b)), '[]'::jsonb) INTO v_staged
  FROM public.baplie_containers AS b
  WHERE b.voyage_id = p_voyage_id
    AND NOT public._baplie_row_replaced(b.pod, b.container_number, v_pod_keys, v_incoming);
  v_staged := v_staged || COALESCE(CASE WHEN jsonb_typeof(p_rows) = 'array' THEN p_rows END, '[]'::jsonb);
  RETURN (
    SELECT jsonb_build_object(
      'apply', COALESCE(jsonb_agg(jsonb_build_object('container', p.container_number, 'bl_id', p.bl_id,
        'before', public._baplie_flags_label(p.old_is_imo, p.old_is_oog, p.old_ownership),
        'after', public._baplie_flags_label(p.new_is_imo, p.new_is_oog, p.new_ownership)) ORDER BY p.container_number, p.bl_id)
        FILTER (WHERE p.action = 'apply'), '[]'::jsonb),
      'clear', COALESCE(jsonb_agg(jsonb_build_object('container', p.container_number, 'bl_id', p.bl_id,
        'before', public._baplie_flags_label(p.old_is_imo, p.old_is_oog, p.old_ownership),
        'after', public._baplie_flags_label(p.new_is_imo, p.new_is_oog, p.new_ownership)) ORDER BY p.container_number, p.bl_id)
        FILTER (WHERE p.action = 'clear'), '[]'::jsonb),
      'divergent_manual', COALESCE(jsonb_agg(jsonb_build_object('container', p.container_number, 'bl_id', p.bl_id)
        ORDER BY p.container_number, p.bl_id) FILTER (WHERE p.action = 'divergent_manual'), '[]'::jsonb)
    )
    FROM public._baplie_flag_plan(p_voyage_id, v_staged) AS p
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.preview_baplie_physical_flags(bigint, jsonb, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.preview_baplie_physical_flags(bigint, jsonb, text[]) TO authenticated;

-- 5. Sai a gravação antiga do staging (sem trava, sem conferência, sem marcas).
DROP FUNCTION IF EXISTS public.import_baplie_staging_transactional(bigint, jsonb);
DROP FUNCTION IF EXISTS public.import_baplie_staging_transactional_legacy_189(bigint, jsonb);
