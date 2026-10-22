-- 410: Baplie — armador da Viagem e transbordo (ADR 0095, decisões 14 e 15;
-- Lote 9 da frente das importações; decisões do dono B12b e B12c).
--
-- Problema:
--   1. Navio compartilhado: o "outro operador" era deduzido no navegador pelos
--      operadores (NAD+CA) dos containers que estavam nos B/Ls da Viagem, com o
--      cabeçalho do arquivo (TDT) como reserva. Antes dos B/Ls chegarem, a regra
--      dependia do TDT, que num navio compartilhado pode trazer o parceiro de
--      slot; e o servidor gravava o que a tela mandasse.
--   2. Transbordo (EQD 8249 = 6) era descartado pelo leitor: o container nem
--      aparecia no Baplie da Viagem nem na conciliação.
--
-- Mudança:
--   - `carriers.baplie_codes` (text[]): os códigos com que o armador aparece no
--     Baplie (NAD+CA e TDT 3127), em maiúsculas. Container cujo operador não
--     está nos códigos do armador da Viagem (navio → armador) é de outro
--     armador: `import_baplie_file_atomic` não o grava no staging (fica fora
--     das marcas IMO/OOG/SOC-COC e da conciliação) e devolve a contagem em
--     `other_carrier`; `preview_baplie_physical_flags` o deixa de fora. Não
--     depende dos B/Ls importados nem recusa o arquivo. Armador sem códigos ou
--     container sem operador: nada é separado (a prévia avisa).
--   - `baplie_containers.is_transshipment`: o container em transbordo entra no
--     staging marcado e aparece na conciliação, mas `_baplie_flag_plan` não o
--     usa (não leva IMO/OOG nem SOC/COC aos B/Ls) e o recadastro dos vazios do
--     Baplie não o conta (não descarrega como vazio de importação).
--   - Seed: o armador COSCO (SCAC CSSC ou nome com "COSCO") recebe os códigos
--     COS e COSCO, os que os Baplies da COSCO trazem no NAD+CA e no TDT. Esta
--     atualização reescreve linhas existentes de `carriers` e depende da
--     afirmação "Data status" do AGENTS.md (seção Gotchas): os dados de
--     produção são de teste. Só preenche quem está sem código.
--
-- ponytail: o código é comparado por igualdade (maiúsculas, sem espaços);
-- operador com grafia nova do mesmo armador cai como outro armador até entrar
-- no cadastro (a prévia lista os códigos separados).
--
-- Rollback: recriar `import_baplie_file_atomic` pela `390`,
-- `preview_baplie_physical_flags` pela `388`, `_baplie_flag_plan` pela `194`,
-- `replace_vazios_from_baplie_transactional` pela `398`; DROP das funções
-- `_baplie_carrier_codes`/`_baplie_other_carrier` e das colunas novas.

ALTER TABLE public.carriers
  ADD COLUMN IF NOT EXISTS baplie_codes text[] NOT NULL DEFAULT '{}'::text[];
COMMENT ON COLUMN public.carriers.baplie_codes IS
  'Códigos do armador no Baplie (NAD+CA, TDT 3127), em maiúsculas. Operador fora deles é outro armador (ADR 0095, decisão 14).';

ALTER TABLE public.baplie_containers
  ADD COLUMN IF NOT EXISTS is_transshipment boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.baplie_containers.is_transshipment IS
  'Transbordo (EQD 8249 = 6): aparece na conciliação, não leva marcas aos B/Ls nem vira vazio de importação (ADR 0095, decisão 15).';

UPDATE public.carriers
SET baplie_codes = ARRAY['COS', 'COSCO']
WHERE baplie_codes = '{}'::text[]
  AND (upper(btrim(COALESCE(scac, ''))) = 'CSSC' OR name ILIKE '%cosco%');

-- Códigos do armador da Viagem (navio → armador), normalizados.
CREATE OR REPLACE FUNCTION public._baplie_carrier_codes(p_voyage_id bigint)
RETURNS text[]
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(ARRAY(
    SELECT DISTINCT upper(btrim(code))
    FROM public.voyages AS v
    JOIN public.vessels AS vs ON vs.id = v.vessel_id
    JOIN public.carriers AS c ON c.id = vs.carrier_id
    CROSS JOIN LATERAL unnest(c.baplie_codes) AS code
    WHERE v.id = p_voyage_id AND NULLIF(btrim(code), '') IS NOT NULL
  ), '{}'::text[])
$$;
REVOKE ALL ON FUNCTION public._baplie_carrier_codes(bigint) FROM PUBLIC, anon, authenticated;

-- Outro armador: há códigos cadastrados, o container traz operador e ele não está neles.
CREATE OR REPLACE FUNCTION public._baplie_other_carrier(p_operator text, p_codes text[])
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT cardinality(COALESCE(p_codes, '{}'::text[])) > 0
    AND NULLIF(btrim(COALESCE(p_operator, '')), '') IS NOT NULL
    AND NOT (upper(btrim(p_operator)) = ANY(p_codes))
$$;
REVOKE ALL ON FUNCTION public._baplie_other_carrier(text, text[]) FROM PUBLIC, anon, authenticated;

-- Marcas: transbordo não leva IMO/OOG nem SOC/COC aos B/Ls (decisão 15).
CREATE OR REPLACE FUNCTION public._baplie_flag_plan(p_voyage_id bigint, p_staged jsonb DEFAULT NULL::jsonb)
 RETURNS TABLE(bl_container_id bigint, bl_id text, container_number text, action text, old_is_imo boolean, old_imo_class text, old_un_number text, old_is_oog boolean, old_ownership text, new_is_imo boolean, new_imo_class text, new_un_number text, new_is_oog boolean, new_ownership text, new_ownership_source text, new_profile_source text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH staged AS (
    SELECT upper(btrim(s.container_number)) AS container_number, s.status, s.is_imo, s.imo_class, s.un_number, s.is_oog, s.ownership
    FROM public.baplie_containers AS s
    WHERE p_staged IS NULL AND s.voyage_id = p_voyage_id AND NOT s.is_transshipment
    UNION ALL
    SELECT upper(btrim(r.container_number)), r.status, r.is_imo, r.imo_class, r.un_number, r.is_oog,
      CASE WHEN upper(btrim(r.ownership)) IN ('SOC', 'COC') THEN upper(btrim(r.ownership)) END
    FROM jsonb_to_recordset(COALESCE(p_staged, '[]'::jsonb)) AS r(
      container_number text, status text, is_imo boolean, imo_class text, un_number text, is_oog boolean, ownership text,
      is_transshipment boolean)
    WHERE p_staged IS NOT NULL AND NOT COALESCE(r.is_transshipment, false)
  ), desired AS (
    SELECT container_number,
      bool_or(COALESCE(is_imo, false)) AS is_imo,
      max(imo_class) FILTER (WHERE imo_class IS NOT NULL) AS imo_class,
      max(un_number) FILTER (WHERE un_number IS NOT NULL) AS un_number,
      bool_or(COALESCE(is_oog, false)) AS is_oog,
      max(ownership) FILTER (WHERE ownership IS NOT NULL) AS ownership
    FROM staged
    WHERE status = 'full' AND container_number ~ '^[A-Z]{4}[0-9]{7}$'
    GROUP BY container_number
  ), targets AS (
    SELECT c.*, d.container_number AS desired_number, d.is_imo AS d_imo,
      CASE WHEN d.is_imo THEN d.imo_class END AS d_class, CASE WHEN d.is_imo THEN d.un_number END AS d_un,
      d.is_oog AS d_oog, d.ownership AS d_ownership
    FROM public.bl_containers AS c
    JOIN public.bls AS b ON b.id = c.bl_id
    LEFT JOIN desired AS d ON d.container_number = upper(btrim(c.container_number))
    WHERE b.voyage_id = p_voyage_id AND b.cancelled_at IS NULL
  ), planned AS (
    SELECT t.id, t.bl_id, t.container_number,
      t.is_imo AS o_imo, t.imo_class AS o_class, t.un_number AS o_un, t.is_oog AS o_oog, t.ownership AS o_own,
      t.profile_source, t.ownership_source,
      t.desired_number IS NOT NULL AS in_baplie,
      CASE
        WHEN t.profile_source = 'manual' THEN COALESCE(t.is_imo, false)
        WHEN t.desired_number IS NOT NULL THEN t.d_imo
        WHEN t.profile_source = 'baplie' THEN false
        ELSE COALESCE(t.is_imo, false)
      END AS n_imo,
      CASE
        WHEN t.profile_source = 'manual' THEN t.imo_class
        WHEN t.desired_number IS NOT NULL THEN t.d_class
        WHEN t.profile_source = 'baplie' THEN NULL
        ELSE t.imo_class
      END AS n_class,
      CASE
        WHEN t.profile_source = 'manual' THEN t.un_number
        WHEN t.desired_number IS NOT NULL THEN t.d_un
        WHEN t.profile_source = 'baplie' THEN NULL
        ELSE t.un_number
      END AS n_un,
      CASE
        WHEN t.profile_source = 'manual' THEN COALESCE(t.is_oog, false)
        WHEN t.desired_number IS NOT NULL THEN t.d_oog
        WHEN t.profile_source = 'baplie' THEN false
        ELSE COALESCE(t.is_oog, false)
      END AS n_oog,
      CASE
        WHEN t.profile_source = 'manual' THEN 'manual'
        WHEN t.desired_number IS NOT NULL AND t.profile_source = 'bl'
             AND t.d_imo = COALESCE(t.is_imo, false) AND t.d_oog = COALESCE(t.is_oog, false) THEN 'bl'
        WHEN t.desired_number IS NOT NULL THEN 'baplie'
        WHEN t.profile_source = 'baplie' THEN NULL
        ELSE t.profile_source
      END AS n_profile_source,
      CASE
        WHEN t.ownership_source IN ('bl', 'manual') THEN t.ownership
        WHEN t.desired_number IS NOT NULL THEN t.d_ownership
        ELSE NULL
      END AS n_own,
      CASE
        WHEN t.ownership_source IN ('bl', 'manual') THEN t.ownership_source
        WHEN t.desired_number IS NOT NULL AND t.d_ownership IS NOT NULL THEN 'baplie'
        ELSE NULL
      END AS n_own_source,
      t.d_imo, t.d_oog
    FROM targets AS t
  )
  SELECT p.id, p.bl_id, p.container_number,
    CASE
      WHEN p.profile_source = 'manual' AND p.in_baplie
           AND (p.d_imo IS DISTINCT FROM COALESCE(p.o_imo, false) OR p.d_oog IS DISTINCT FROM COALESCE(p.o_oog, false))
        THEN 'divergent_manual'
      WHEN COALESCE(p.o_imo, false) IS NOT DISTINCT FROM p.n_imo
           AND COALESCE(p.o_oog, false) IS NOT DISTINCT FROM p.n_oog
           AND upper(COALESCE(p.o_class, '')) = upper(COALESCE(p.n_class, ''))
           AND upper(COALESCE(p.o_un, '')) = upper(COALESCE(p.n_un, ''))
           AND p.o_own IS NOT DISTINCT FROM p.n_own
        THEN CASE WHEN p.in_baplie AND p.profile_source IS DISTINCT FROM p.n_profile_source THEN 'source_only' ELSE 'unchanged' END
      WHEN NOT p.in_baplie THEN 'clear'
      ELSE 'apply'
    END,
    COALESCE(p.o_imo, false), p.o_class, p.o_un, COALESCE(p.o_oog, false), p.o_own,
    p.n_imo, p.n_class, p.n_un, p.n_oog, p.n_own, p.n_own_source, p.n_profile_source
  FROM planned AS p;
$function$;

-- Prévia das marcas: container de outro armador fica de fora (decisão 14).
CREATE OR REPLACE FUNCTION public.preview_baplie_physical_flags(p_voyage_id bigint, p_rows jsonb, p_pods text[] DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_codes text[] := public._baplie_carrier_codes(p_voyage_id);
  v_rows jsonb;
  v_pod_keys text[] := CASE WHEN p_pods IS NULL THEN NULL
    ELSE ARRAY(SELECT DISTINCT public._baplie_port_key(p) FROM unnest(p_pods) AS p WHERE NULLIF(btrim(COALESCE(p, '')), '') IS NOT NULL) END;
  v_incoming text[];
  v_staged jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa.' USING ERRCODE = '42501';
  END IF;
  SELECT COALESCE(jsonb_agg(r.value), '[]'::jsonb) INTO v_rows
  FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_rows) = 'array' THEN p_rows ELSE '[]'::jsonb END) AS r(value)
  WHERE NOT public._baplie_other_carrier(r.value->>'operator', v_codes);
  v_incoming := ARRAY(SELECT DISTINCT upper(btrim(r.value->>'container_number')) FROM jsonb_array_elements(v_rows) AS r(value));
  SELECT COALESCE(jsonb_agg(to_jsonb(b)), '[]'::jsonb) INTO v_staged
  FROM public.baplie_containers AS b
  WHERE b.voyage_id = p_voyage_id
    AND NOT public._baplie_row_replaced(b.pod, b.container_number, v_pod_keys, v_incoming);
  v_staged := v_staged || v_rows;
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

-- Gravação: outro armador fora do staging; transbordo gravado marcado.
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

  IF v_file_voyage IS NOT NULL THEN
    IF public._baplie_voyage_key(v_file_voyage) IS DISTINCT FROM public._baplie_voyage_key(v_voyage.voyage_number) THEN
      RAISE EXCEPTION 'O arquivo é da viagem %; a viagem escolhida é %. Nada foi gravado.', v_file_voyage, COALESCE(v_voyage.voyage_number, '—')
        USING ERRCODE = '22023';
    END IF;
  ELSIF COALESCE(p_file->>'voyage_confirmed', '') <> 'true' THEN
    RAISE EXCEPTION 'O arquivo não diz a viagem: confirme na prévia que este Baplie é da viagem escolhida. Nada foi gravado.'
      USING ERRCODE = '22023';
  END IF;

  -- 410 (decisão 14): container de outro armador (pelos códigos do armador da
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
    'vazios', v_vazios
  );
END $$;
REVOKE ALL ON FUNCTION public.import_baplie_file_atomic(bigint, jsonb, text[], jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_baplie_file_atomic(bigint, jsonb, text[], jsonb, jsonb) TO authenticated;

-- Vazios pelo Baplie: o vazio em transbordo não descarrega como vazio de importação.
CREATE OR REPLACE FUNCTION public.replace_vazios_from_baplie_transactional(p_voyage_id bigint, p_description text, p_uploaded_by uuid, p_replace_existing boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_manifest_id uuid;
  v_empty integer;
  v_total integer;
  v_planilha integer;
  v_pruned integer;
  v_removed integer;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR p_uploaded_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa para importar vazios Baplie.' USING ERRCODE = '42501';
  END IF;
  PERFORM public._lock_import_voyages(ARRAY[p_voyage_id]);
  PERFORM public._set_import_context('Vazios pelo Baplie', p_voyage_id, NULL);
  PERFORM pg_advisory_xact_lock(hashtextextended('vazios_importacao:' || p_voyage_id::text, 0));

  SELECT count(*)::integer INTO v_empty
  FROM public.baplie_containers
  WHERE voyage_id = p_voyage_id AND status = 'empty' AND NOT is_transshipment;

  IF v_empty = 0 THEN
    IF NOT p_replace_existing THEN
      RAISE EXCEPTION 'Nenhum container vazio encontrado no Baplie desta viagem.'
        USING ERRCODE = 'P0002';
    END IF;
    DELETE FROM public.vazios_importacao_manifests
    WHERE voyage_id = p_voyage_id AND source = 'baplie';
    GET DIAGNOSTICS v_removed = ROW_COUNT;
    v_pruned := public._vazios_importacao_prune(p_voyage_id);
    RETURN jsonb_build_object('manifest_id', NULL, 'total', 0, 'planilha', 0, 'pruned', v_pruned, 'removed', v_removed > 0);
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

  CREATE TEMP TABLE IF NOT EXISTS pg_temp.vazios_398_baplie (container_number text, size_type text, weight_kg numeric, pol text, pod text) ON COMMIT DROP;
  TRUNCATE pg_temp.vazios_398_baplie;
  INSERT INTO pg_temp.vazios_398_baplie
  SELECT DISTINCT ON (upper(regexp_replace(b.container_number, '[^A-Za-z0-9]', '', 'g')))
         b.container_number, b.size_type, b.weight_kg, b.pol, b.pod
  FROM public.baplie_containers AS b
  WHERE b.voyage_id = p_voyage_id AND b.status = 'empty' AND NOT b.is_transshipment
    AND NOT EXISTS (
      SELECT 1 FROM public.vazios_importacao_containers AS c
      WHERE c.voyage_id = p_voyage_id
        AND c.container_key = upper(regexp_replace(b.container_number, '[^A-Za-z0-9]', '', 'g'))
    )
  ORDER BY upper(regexp_replace(b.container_number, '[^A-Za-z0-9]', '', 'g')), b.id;
  SELECT count(*)::integer INTO v_total FROM pg_temp.vazios_398_baplie;
  v_planilha := v_empty - v_total;

  IF v_total > 0 THEN
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
    FROM pg_temp.vazios_398_baplie AS b
    LEFT JOIN pg_temp.vazios_natureza n ON n.container_number = upper(btrim(b.container_number));
  END IF;

  v_pruned := public._vazios_importacao_prune(p_voyage_id);

  RETURN jsonb_build_object('manifest_id', v_manifest_id, 'total', v_total, 'planilha', v_planilha,
    'pruned', v_pruned, 'removed', false);
END $function$;
