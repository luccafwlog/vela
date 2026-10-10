-- 189 — Rastro das importações (ADR 0078, item 9; Etapa 14 do plano
-- 2026-10-09-correcao-importacoes-ce-mercante).
--
-- O gatilho `audit_row_changes` já grava, por campo alterado, quem, quando, o
-- valor anterior e o novo. Faltava o tipo de importação e o contexto. Agora
-- cada RPC de importação define `vela.import_context` na transação
-- ("Importação de <tipo> · Viagem <navio> <número> · Manifesto <Nº>") e o
-- gatilho grava esse texto como justificativa de cada linha do Histórico que
-- não tem outra. Não se guarda lote, arquivo nem linha (ADR 0078, item 9).
--
-- Os invólucros são gerados a partir da assinatura efetiva de cada função:
-- a original vira `<nome>_legacy_189`, sem mudança de comportamento, e o nome
-- público só define o contexto e a chama.

CREATE OR REPLACE FUNCTION public._set_import_context(p_kind text, p_voyage_id bigint, p_manifesto text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_voyage text;
BEGIN
  IF p_voyage_id IS NOT NULL THEN
    SELECT btrim(concat_ws(' ', vs.name, v.voyage_number)) INTO v_voyage
    FROM public.voyages v LEFT JOIN public.vessels vs ON vs.id = v.vessel_id WHERE v.id = p_voyage_id;
  END IF;
  PERFORM set_config('vela.import_context', concat_ws(' · ',
    'Importação de ' || p_kind,
    CASE WHEN v_voyage IS NOT NULL THEN 'Viagem ' || v_voyage END,
    CASE WHEN NULLIF(btrim(COALESCE(p_manifesto, '')), '') IS NOT NULL THEN 'Manifesto ' || btrim(p_manifesto) END), true);
END $$;
REVOKE ALL ON FUNCTION public._set_import_context(text, bigint, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public._set_import_context(text, bigint, text) FROM authenticated;

CREATE OR REPLACE FUNCTION public.audit_row_changes() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE
  v_old JSONB := CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) ELSE '{}'::jsonb END;
  v_new JSONB := CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) ELSE '{}'::jsonb END;
  v_key_parts TEXT[] := string_to_array(COALESCE(TG_ARGV[0], 'id'), ',');
  v_entity_id TEXT;
  v_field RECORD;
  v_skip text[] := string_to_array(NULLIF(current_setting('vela.audit_skip', true), ''), ',');
  v_token text;
  v_context text := NULLIF(btrim(current_setting('vela.import_context', true)), '');
BEGIN
  SELECT string_agg(COALESCE(v_new ->> k, v_old ->> k), '/')
    INTO v_entity_id
    FROM unnest(v_key_parts) AS k;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.audit_logs(entity_type, entity_id, field_name, new_value, changed_by, justification)
    VALUES (TG_TABLE_NAME, v_entity_id, 'criado', v_new::TEXT, auth.uid(), v_context);
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, changed_by, justification)
    VALUES (TG_TABLE_NAME, v_entity_id, 'excluido', v_old::TEXT, auth.uid(),
            COALESCE(NULLIF(btrim(current_setting('vela.delete_reason', true)), ''), v_context));
  ELSE
    FOR v_field IN
      SELECT key, value AS old_value, v_new ->> key AS new_value
      FROM jsonb_each_text(v_old)
      WHERE v_old ->> key IS DISTINCT FROM v_new ->> key
    LOOP
      v_token := TG_TABLE_NAME || '/' || v_entity_id || '/' || v_field.key;
      IF v_skip IS NOT NULL AND v_token = ANY(v_skip) THEN
        v_skip := array_remove(v_skip, v_token);
        PERFORM set_config('vela.audit_skip', COALESCE(array_to_string(v_skip, ','), ''), true);
        CONTINUE;
      END IF;
      INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
      VALUES (TG_TABLE_NAME, v_entity_id, v_field.key, v_field.old_value, v_field.new_value, auth.uid(), v_context);
    END LOOP;
    FOR v_field IN
      SELECT key, value AS new_value
      FROM jsonb_each_text(v_new)
      WHERE NOT (v_old ? key)
    LOOP
      INSERT INTO public.audit_logs(entity_type, entity_id, field_name, new_value, changed_by, justification)
      VALUES (TG_TABLE_NAME, v_entity_id, v_field.key, v_field.new_value, auth.uid(), v_context);
    END LOOP;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

-- Invólucros: (nome, tipo de importação, expressão da Viagem, expressão do Manifesto).
DO $do$
DECLARE
  r record;
  v_oid oid;
  v_args text;
  v_identity text;
  v_result text;
  v_call text;
  v_body text;
  v_grantee text;
  v_grantees text[];
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('import_bl_freight_with_metadata', 'B/L', '(p_bls->0->>''voyage_id'')::bigint', 'NULL'),
    ('import_bl_freight_transactional', 'B/L', '(p_bls->0->>''voyage_id'')::bigint', 'NULL'),
    ('import_breakbulk_manifest_transactional', 'Manifesto BB', 'p_voyage_id', 'NULL'),
    ('apply_ce_mercante_rows_atomic', 'CE Mercante', 'p_voyage_id', 'p_manifesto_numero'),
    ('import_baplie_staging_transactional', 'Baplie', 'p_voyage_id', 'NULL'),
    ('apply_baplie_physical_flags_atomic', 'Baplie (marcas)', 'p_voyage_id', 'NULL'),
    ('import_vehicle_rows_transactional', 'Veículos', '(p_rows->0->>''voyage_id'')::bigint', 'NULL'),
    ('import_granite_manifest_transactional', 'Granito', 'p_voyage_id', 'NULL'),
    ('import_vazios_importacao_transactional', 'Vazios de Importação', 'p_voyage_id', '(SELECT string_agg(m->>''numero'', '', '') FROM jsonb_array_elements(COALESCE(p_manifestos, ''[]''::jsonb)) AS m)'),
    ('replace_vazios_from_baplie_transactional', 'Vazios pelo Baplie', 'p_voyage_id', 'NULL'),
    ('import_vazios_bookings_transactional', 'Embarque de Vazios', 'p_voyage_id', 'NULL'),
    ('apply_customer_base_row_atomic', 'Base de Clientes', 'NULL::bigint', 'NULL'),
    ('apply_container_dates_atomic', 'datas de container', '(SELECT voyage_id FROM public.bls WHERE id = p_bl_id)', 'NULL'),
    ('apply_schedule_sheet_atomic', 'Programação', 'NULL::bigint', 'NULL')
  ) AS t(fn, kind, voyage_expr, manifesto_expr) LOOP
    SELECT p.oid, pg_get_function_arguments(p.oid), pg_get_function_identity_arguments(p.oid), pg_get_function_result(p.oid)
      INTO v_oid, v_args, v_identity, v_result
    FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = r.fn;
    IF v_oid IS NULL THEN RAISE EXCEPTION 'Função % não encontrada para o rastro.', r.fn; END IF;

    SELECT string_agg(quote_ident(n), ', ' ORDER BY i) INTO v_call
    FROM unnest((SELECT proargnames FROM pg_proc WHERE oid = v_oid)) WITH ORDINALITY AS a(n, i)
    WHERE i <= (SELECT pronargs FROM pg_proc WHERE oid = v_oid);

    -- O nome público mantém exatamente os privilégios que a função tinha.
    SELECT array_agg(CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END) INTO v_grantees
    FROM pg_proc p, aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
    WHERE p.oid = v_oid AND a.privilege_type = 'EXECUTE' AND a.grantee <> p.proowner;

    EXECUTE format('ALTER FUNCTION public.%I(%s) RENAME TO %I', r.fn, v_identity, r.fn || '_legacy_189');
    EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC, anon, authenticated', r.fn || '_legacy_189', v_identity);

    v_body := format(
      'CREATE FUNCTION public.%1$I(%2$s) RETURNS %3$s LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
BEGIN
  PERFORM public._set_import_context(%4$L, %5$s, %6$s);
  RETURN public.%7$I(%8$s);
END $f$', r.fn, v_args, v_result, r.kind, r.voyage_expr, r.manifesto_expr, r.fn || '_legacy_189', v_call);
    EXECUTE v_body;
    EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC', r.fn, v_identity);
    FOREACH v_grantee IN ARRAY COALESCE(v_grantees, ARRAY[]::text[]) LOOP
      EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO %s', r.fn, v_identity,
        CASE WHEN v_grantee = 'PUBLIC' THEN 'PUBLIC' ELSE quote_ident(v_grantee) END);
    END LOOP;
  END LOOP;
END
$do$;
