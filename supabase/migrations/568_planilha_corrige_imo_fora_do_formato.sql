-- 568: a planilha de programação corrige o IMO gravado fora do formato, em vez
-- de recusar como "IMO conflitante".
--
-- Achado da sincronização do Manual do Operador de 2026-11-02 (PR #1087). A
-- #1135 deixou corrigir pela tela da Viagem (e por Adicionar navio) o IMO
-- gravado errado, como o nome do navio digitado no campo IMO: o cadastro
-- (`getOrCreateVessel`) troca o IMO que não tem 7 dígitos. A planilha de
-- Chegadas e Saídas continuou recusando a mesma linha com "Navio X com IMO
-- conflitante (COSCO SHIPPING … vs 9900019)", na prévia e na gravação.
--
-- apply_schedule_sheet_atomic_legacy_189 é a definição vigente (217, lida com
-- pg_get_functiondef no Postgres local com toda a cadeia aplicada) com duas
-- trocas:
--   1. no navio achado pelo nome, só o IMO gravado com 7 dígitos, diferente
--      do arquivo, é conflito;
--   2. o IMO gravado vazio ou fora do formato recebe o IMO do arquivo (antes,
--      só o vazio);
--   3. na Viagem já cadastrada (a prévia manda o id dela), o navio com IMO
--      fora do formato recebe o IMO de 7 dígitos do arquivo, salvo se esse
--      IMO já for de outro navio. A prévia acha essa Viagem pelo nome
--      (`findVoyageByNumberAndVessel`), em vez de oferecer "Cria".
-- IMOs válidos diferentes continuam recusados; a assinatura, o SECURITY
-- DEFINER, o search_path e os grants ficam iguais (CREATE OR REPLACE).
--
-- Só redefine a função. Ela grava o IMO no navio quando a importação passa,
-- como já fazia com o navio sem IMO; não reescreve linhas por conta própria.
-- Rollback: reaplicar a função pela migration 217.

CREATE OR REPLACE FUNCTION public.apply_schedule_sheet_atomic_legacy_189(p_rows jsonb, p_carrier_name text, p_carrier_scac text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  v_checked text[] := ARRAY[]::text[];
  v_stale record;
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
      'schedule_voyage:imo:' || f.imo || ':' || f.number,
      -- 217: o navio também, sem o número da Viagem — dois arquivos com o
      -- mesmo navio novo em viagens diferentes não criam dois cadastros.
      'schedule_vessel:name:' || upper(f.name),
      'schedule_vessel:imo:' || f.imo
    ]) AS k(lock_key)
    WHERE NULLIF(r.value->>'voyage_id', '') IS NULL
      AND f.name IS NOT NULL AND f.number <> '' AND k.lock_key IS NOT NULL
    ORDER BY 1
  LOOP
    PERFORM pg_advisory_xact_lock(v_lock);
  END LOOP;

  -- 213 (fix 7): as Viagens já cadastradas do arquivo (pelo id ou pelo navio e
  -- número) são travadas antes do laço, em ordem de id. Travadas na ordem do
  -- arquivo (publicação no Portal, conferência da prévia e o snapshot da
  -- agenda), dois arquivos com as mesmas Viagens em ordens diferentes se
  -- travavam mutuamente (deadlock).
  PERFORM 1
  FROM public.voyages AS v
  WHERE v.id IN (
      SELECT NULLIF(r.value->>'voyage_id', '')::bigint
      FROM jsonb_array_elements(p_rows) AS r(value)
      WHERE NULLIF(r.value->>'voyage_id', '') IS NOT NULL
    )
    OR v.id IN (
      SELECT ev.id
      FROM jsonb_array_elements(p_rows) AS r(value)
      CROSS JOIN LATERAL (
        SELECT upper(btrim(COALESCE(r.value->>'voyage_number', ''))) AS number,
               NULLIF(btrim(COALESCE(r.value->>'vessel_name', '')), '') AS name,
               substring(upper(btrim(COALESCE(r.value->>'vessel_imo', ''))) FROM '^(?:IMO[\s:./-]*)?(\d{7})$') AS imo
      ) AS f
      JOIN public.vessels AS s
        ON s.name = f.name
        OR (f.imo IS NOT NULL AND NULLIF(regexp_replace(upper(btrim(COALESCE(s.imo, ''))), '^IMO[\s:./-]*', ''), '') = f.imo)
      JOIN public.voyages AS ev ON ev.vessel_id = s.id AND upper(btrim(ev.voyage_number)) = f.number
      WHERE NULLIF(r.value->>'voyage_id', '') IS NULL AND f.number <> ''
    )
  ORDER BY v.id
  FOR UPDATE OF v;

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
        -- 568: só um IMO gravado válido (7 dígitos) conflita; o gravado fora do
        -- formato (o nome do navio no campo IMO) foi erro de digitação e é
        -- substituído, como no cadastro pela tela (`getOrCreateVessel`, #1135).
        IF v_vessel IS NOT NULL AND v_imo IS NOT NULL THEN
          SELECT NULLIF(regexp_replace(upper(btrim(COALESCE(imo, ''))), '^IMO[\s:./-]*', ''), '')
            INTO v_vessel_imo FROM public.vessels WHERE id = v_vessel;
          IF v_vessel_imo ~ '^\d{7}$' AND v_vessel_imo <> v_imo THEN
            RAISE EXCEPTION 'Navio % com IMO conflitante (% vs %). Corrija antes de importar.', v_name, v_vessel_imo, v_imo
              USING ERRCODE = '22023';
          END IF;
          -- Navio sem IMO achado pelo nome recebe o IMO do arquivo (202), como
          -- no cadastro pela tela (`getOrCreateVessel`): a linha seguinte com
          -- outra grafia e o mesmo IMO acha este navio, em vez de criar outro.
          IF v_vessel_imo IS NULL OR v_vessel_imo !~ '^\d{7}$' THEN
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
      -- 568: a Viagem já cadastrada cujo navio tem IMO fora do formato (a
      -- prévia a acha pelo nome) recebe o IMO de 7 dígitos do arquivo, como a
      -- Viagem nova; nunca o IMO que já é de outro navio.
      v_imo := substring(upper(btrim(COALESCE(v_row->>'vessel_imo', ''))) FROM '^(?:IMO[\s:./-]*)?(\d{7})$');
      IF v_imo IS NOT NULL THEN
        UPDATE public.vessels AS s SET imo = v_imo
          FROM public.voyages AS v
         WHERE v.id = v_voyage AND s.id = v.vessel_id
           AND NULLIF(regexp_replace(upper(btrim(COALESCE(s.imo, ''))), '^IMO[\s:./-]*', ''), '') !~ '^\d{7}$'
           AND NOT EXISTS (
             SELECT 1 FROM public.vessels AS other
              WHERE other.id <> s.id
                AND NULLIF(regexp_replace(upper(btrim(COALESCE(other.imo, ''))), '^IMO[\s:./-]*', ''), '') = v_imo);
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

    -- Prévia obsoleta (209): a data que a prévia viu (`old_value`) tem de ser
    -- a vigente, ou já a do arquivo (mandar a mesma data de novo não muda
    -- nada). A Viagem é travada antes; a gravação de agenda pela tela também
    -- escreve nela (snapshot), então espera. Cada data é conferida na primeira
    -- linha do arquivo que a traz: as seguintes da mesma Viagem e porto partem
    -- do que a própria planilha gravou.
    PERFORM 1 FROM public.voyages WHERE id = v_voyage FOR UPDATE;
    SELECT x.field, x.port, x.cur INTO v_stale
    FROM (
      SELECT c->>'field_name' AS field, upper(btrim(c->>'port')) AS port,
             NULLIF(btrim(COALESCE(c->>'old_value', '')), '') AS old_v,
             NULLIF(btrim(COALESCE(c->>'new_value', '')), '') AS new_v,
             (SELECT NULLIF(btrim(COALESCE(a.new_value, '')), '') FROM public.audit_logs AS a
               WHERE a.entity_type = c->>'entity_type'
                 AND a.entity_id = v_voyage::text || '::' || upper(btrim(c->>'port'))
                 AND a.field_name = c->>'field_name'
               ORDER BY a.changed_at DESC, a.id DESC LIMIT 1) AS cur,
             v_voyage::text || '::' || (c->>'entity_type') || '::' || upper(btrim(c->>'port')) || '::' || (c->>'field_name') AS key
      FROM jsonb_array_elements(COALESCE(v_row->'changes', '[]'::jsonb)) AS c
      WHERE c->>'entity_type' IN ('voyage_pol_schedule', 'voyage_pod_schedule')
    ) AS x
    WHERE NOT (x.key = ANY(v_checked))
      AND x.cur IS DISTINCT FROM x.old_v AND x.cur IS DISTINCT FROM x.new_v
    LIMIT 1;
    IF FOUND THEN
      RAISE EXCEPTION 'A programação da Viagem % mudou depois da prévia: % em % agora é %. Confira a prévia de novo antes de gravar.',
        v_label, upper(v_stale.field), v_stale.port, COALESCE(v_stale.cur, 'vazia')
        USING ERRCODE = '22023';
    END IF;
    v_checked := v_checked || ARRAY(
      SELECT v_voyage::text || '::' || (c->>'entity_type') || '::' || upper(btrim(c->>'port')) || '::' || (c->>'field_name')
      FROM jsonb_array_elements(COALESCE(v_row->'changes', '[]'::jsonb)) AS c);

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
END $function$;
