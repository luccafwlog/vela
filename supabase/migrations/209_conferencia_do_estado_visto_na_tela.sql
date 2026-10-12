-- 209 — Conferência do estado visto na tela (achados da revisão automática da
-- PR 929 sobre a 195, a 181, a 204 e a 202). Em todos, outra sessão muda o
-- dado entre a tela e a gravação, e a gravação seguia o valor novo sem mostrar.
--
-- 1. `remove_bl_ce_mercante` recebe `p_expected_ce` (o CE exibido na ficha) e
--    recusa se o CE travado for outro, como a correção já faz (207).
-- 2. `move_bls_to_manifesto_mercante` e `unlink_bls_from_manifesto_mercante`
--    recebem `p_expected` (B/L → Nº de Manifesto exibido, ou null) e recusam
--    se algum B/L travado estiver em outro Manifesto.
-- 3. Alerta de tabela de cobrança faltando (204/208): a lista do POD e da
--    modalidade é travada (advisory lock da chave) antes de ser lida, ao
--    incluir e ao retirar B/L. Dois lotes simultâneos não apagam o B/L um do
--    outro.
-- 4. Programação por planilha (202): a data que a prévia viu tem de ser a
--    vigente (ou já a do arquivo); outra gravada depois recusa o arquivo.
--
-- Os parâmetros novos têm DEFAULT NULL: sem eles, o comportamento é o
-- anterior. Só redefine funções; não reescreve nem apaga linhas existentes.
-- Rollback: reaplicar as definições da 195 (remover CE), 181 (mover e
-- desvincular, removendo as de assinatura nova), 204/208 (alerta) e 202
-- (Programação), e DROP de `_check_expected_manifestos`.

DROP FUNCTION IF EXISTS public.remove_bl_ce_mercante(text, text);

CREATE FUNCTION public.remove_bl_ce_mercante(p_bl_id text, p_reason text, p_expected_ce text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_invoices text;
  v_result text;
  v_old text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa.' USING ERRCODE = '42501';
  END IF;
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'Informe o motivo da remocao do CE Mercante.' USING ERRCODE = '22023';
  END IF;
  SELECT ce_mercante INTO v_old FROM public.bls WHERE id = p_bl_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L % nao encontrado.', p_bl_id USING ERRCODE = 'P0002';
  END IF;
  IF p_expected_ce IS NOT NULL
     AND public.ce_mercante_key(v_old) IS DISTINCT FROM public.ce_mercante_key(p_expected_ce) THEN
    RAISE EXCEPTION 'O CE Mercante do B/L % mudou depois que a ficha foi aberta (agora: %). Recarregue a ficha e confira antes de remover.',
      p_bl_id, COALESCE(NULLIF(btrim(COALESCE(v_old, '')), ''), 'sem CE')
      USING ERRCODE = '22023';
  END IF;
  v_invoices := NULLIF(array_to_string(public._bl_live_invoice_numbers(p_bl_id), ', '), '');
  IF v_invoices IS NOT NULL THEN
    RAISE EXCEPTION 'O CE Mercante do B/L % nao pode ser removido: ha fatura emitida (%). O Administrativo precisa cancelar a fatura antes.', p_bl_id, v_invoices
      USING ERRCODE = 'P0011';
  END IF;
  v_result := public._set_bl_ce_mercante(p_bl_id, NULL, auth.uid(), 'Remocao do CE Mercante pela ficha: ' || v_reason, 'ce_mercante_ficha');
  RETURN jsonb_build_object('status', v_result, 'bl_id', p_bl_id);
END;
$function$;
REVOKE ALL ON FUNCTION public.remove_bl_ce_mercante(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remove_bl_ce_mercante(text, text, text) TO authenticated, service_role;

-- Confere, depois de travar os B/Ls, o Manifesto que a tela mostrava.
CREATE OR REPLACE FUNCTION public._check_expected_manifestos(p_ids text[], p_expected jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_stale text;
BEGIN
  IF p_expected IS NULL OR jsonb_typeof(p_expected) <> 'object' THEN
    RETURN;
  END IF;
  SELECT string_agg(format('%s está em %s', b.id, COALESCE(m.numero, 'nenhum Manifesto')), '; ' ORDER BY b.id) INTO v_stale
  FROM jsonb_each(p_expected) AS e(bl_id, expected)
  JOIN public.bls AS b ON b.id = btrim(e.bl_id)
  LEFT JOIN public.manifestos_mercante AS m ON m.id = b.manifesto_mercante_id
  WHERE b.id = ANY(p_ids)
    AND m.numero IS DISTINCT FROM public.canonical_manifesto_numero(CASE WHEN jsonb_typeof(e.expected) = 'string' THEN e.expected #>> '{}' END);
  IF v_stale IS NOT NULL THEN
    RAISE EXCEPTION 'O Manifesto Mercante mudou depois da tela: %. Recarregue e confira antes de gravar.', v_stale
      USING ERRCODE = '22023';
  END IF;
END;
$function$;
REVOKE ALL ON FUNCTION public._check_expected_manifestos(text[], jsonb) FROM PUBLIC, anon, authenticated;

DROP FUNCTION IF EXISTS public.move_bls_to_manifesto_mercante(text[], text, text);

CREATE FUNCTION public.move_bls_to_manifesto_mercante(p_bl_ids text[], p_numero text, p_reason text, p_expected jsonb DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_numero text := public.canonical_manifesto_numero(p_numero);
  v_ids text[];
  v_route record;
  v_routes integer;
  v_target public.manifestos_mercante%ROWTYPE;
  v_created boolean := false;
  v_moved integer;
BEGIN
  IF v_actor IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa.' USING ERRCODE = '42501';
  END IF;
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'Informe o motivo da mudança de Manifesto Mercante.' USING ERRCODE = '22023';
  END IF;
  IF v_numero IS NULL OR v_numero !~ '^[A-Z0-9]{13}$' THEN
    RAISE EXCEPTION 'Nº de Manifesto Mercante inválido: "%". O número tem 13 caracteres, letras ou dígitos (ex.: 1226501860578).', p_numero
      USING ERRCODE = 'P0012';
  END IF;

  v_ids := public._lock_bls_for_manifesto(p_bl_ids);
  PERFORM public._check_expected_manifestos(v_ids, p_expected);
  SELECT count(DISTINCT (b.voyage_id, public.normalize_port_code(b.pol), public.normalize_port_code(b.pod))) INTO v_routes
  FROM public.bls AS b WHERE b.id = ANY(v_ids);
  IF v_routes > 1 THEN
    RAISE EXCEPTION 'Os B/Ls selecionados são de mais de uma viagem ou rota (POL → POD); um Manifesto tem uma única rota.' USING ERRCODE = '22023';
  END IF;
  SELECT b.voyage_id, btrim(b.pol) AS pol, btrim(b.pod) AS pod INTO v_route FROM public.bls AS b WHERE b.id = ANY(v_ids) LIMIT 1;
  IF NULLIF(v_route.pol, '') IS NULL OR NULLIF(v_route.pod, '') IS NULL THEN
    RAISE EXCEPTION 'Os B/Ls selecionados não têm POL e POD cadastrados; sem rota não há Manifesto.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_target FROM public.manifestos_mercante WHERE numero = v_numero;
  v_created := NOT FOUND;
  PERFORM public._upsert_route_manifesto(v_route.voyage_id, v_route.pol, v_route.pod, 'carga', v_numero);
  SELECT * INTO v_target FROM public.manifestos_mercante WHERE numero = v_numero;
  IF v_created THEN
    INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
    VALUES ('voyage', v_route.voyage_id::text, 'manifesto_mercante_created', NULL, v_numero, v_actor, v_reason);
  END IF;

  v_moved := public._link_bls_to_manifesto(v_ids, v_target.id, v_actor, v_reason);
  RETURN jsonb_build_object(
    'manifesto_mercante_id', v_target.id, 'numero', v_numero, 'created', v_created,
    'moved', v_moved, 'unchanged', cardinality(v_ids) - v_moved);
END;
$function$;
REVOKE ALL ON FUNCTION public.move_bls_to_manifesto_mercante(text[], text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.move_bls_to_manifesto_mercante(text[], text, text, jsonb) TO authenticated;

DROP FUNCTION IF EXISTS public.unlink_bls_from_manifesto_mercante(text[], text);

CREATE FUNCTION public.unlink_bls_from_manifesto_mercante(p_bl_ids text[], p_reason text, p_expected jsonb DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_ids text[];
  v_count integer;
BEGIN
  IF v_actor IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa.' USING ERRCODE = '42501';
  END IF;
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'Informe o motivo do desvínculo do Manifesto Mercante.' USING ERRCODE = '22023';
  END IF;
  v_ids := public._lock_bls_for_manifesto(p_bl_ids);
  PERFORM public._check_expected_manifestos(v_ids, p_expected);
  v_count := public._link_bls_to_manifesto(v_ids, NULL, v_actor, v_reason);
  RETURN jsonb_build_object('unlinked', v_count, 'unchanged', cardinality(v_ids) - v_count);
END;
$function$;
REVOKE ALL ON FUNCTION public.unlink_bls_from_manifesto_mercante(text[], text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.unlink_bls_from_manifesto_mercante(text[], text, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public._note_charge_table_gap(p_pod text, p_mode text, p_bl_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_current jsonb;
BEGIN
  -- Trava a lista antes de ler (209): dois lotes no mesmo POD não se apagam.
  PERFORM pg_advisory_xact_lock(hashtextextended('charge_table_gap:' || p_pod || ':' || COALESCE(p_mode, 'container'), 0));
  SELECT i.metadata->'bl_ids' INTO v_current
  FROM public.alert_items AS i
  JOIN public.alerts AS a ON a.id = i.alert_id
  WHERE i.item_type = 'billing_charge_table_missing' AND i.status = 'active'
    AND a.entity_type = 'charge_table_gap' AND a.entity_id = p_pod || ':' || COALESCE(p_mode, 'container')
  ORDER BY i.id DESC
  LIMIT 1;
  PERFORM public._write_charge_table_gap(p_pod, p_mode,
    ARRAY(SELECT DISTINCT x FROM (
      SELECT jsonb_array_elements_text(COALESCE(v_current, '[]'::jsonb)) AS x
      UNION SELECT p_bl_id
    ) AS ids ORDER BY 1),
    'ce_mercante_planilha');
END;
$function$;
REVOKE ALL ON FUNCTION public._note_charge_table_gap(text, text, text) FROM PUBLIC, anon, authenticated;

-- Tira os B/Ls das listas; cada lista é travada e relida antes de gravar.
CREATE OR REPLACE FUNCTION public._drop_bls_from_charge_table_gaps(p_bl_ids text[], p_source text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_key text;
  v_meta jsonb;
BEGIN
  IF COALESCE(cardinality(p_bl_ids), 0) = 0 OR NOT public.alert_actor_is_authorized() THEN
    RETURN;
  END IF;
  FOR v_key IN
    SELECT DISTINCT a.entity_id
    FROM public.alert_items AS i
    JOIN public.alerts AS a ON a.id = i.alert_id
    WHERE i.item_type = 'billing_charge_table_missing' AND i.status = 'active'
      AND a.entity_type = 'charge_table_gap'
      AND COALESCE(i.metadata->'bl_ids', '[]'::jsonb) ?| p_bl_ids
    ORDER BY 1
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('charge_table_gap:' || v_key, 0));
    SELECT i.metadata INTO v_meta
    FROM public.alert_items AS i
    JOIN public.alerts AS a ON a.id = i.alert_id
    WHERE i.item_type = 'billing_charge_table_missing' AND i.status = 'active'
      AND a.entity_type = 'charge_table_gap' AND a.entity_id = v_key
    ORDER BY i.id DESC
    LIMIT 1;
    CONTINUE WHEN v_meta IS NULL;
    PERFORM public._write_charge_table_gap(
      v_meta->>'pod', v_meta->>'cargo_mode',
      ARRAY(SELECT x FROM jsonb_array_elements_text(v_meta->'bl_ids') AS x WHERE NOT (x = ANY(p_bl_ids)) ORDER BY 1),
      p_source);
  END LOOP;
END;
$function$;
REVOKE ALL ON FUNCTION public._drop_bls_from_charge_table_gaps(text[], text) FROM PUBLIC, anon, authenticated;

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
END $$;
-- Só o invólucro público (189) chama esta função.
REVOKE ALL ON FUNCTION public.apply_schedule_sheet_atomic_legacy_189(jsonb, text, text) FROM PUBLIC, anon, authenticated;
