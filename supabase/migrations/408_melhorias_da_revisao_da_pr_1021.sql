-- 408: melhorias da revisão da PR 1021 (relatório
-- docs/archive/audits/2026-10-22-revisao-pr-1021.md, achados R-09, R-10, R-11,
-- R-13 e R-16; decisão do responsável de 2026-10-22 para R-13).
--
-- Problemas e mudanças:
--   R-09  Excluir o B/L de menor Laden on Board deixava o ATD do POL na data
--         dele: só o cancelamento recalculava (401). `delete_records` passa a
--         chamar `_recompute_voyage_pol_atd` depois de excluir o B/L (ADR 0095,
--         decisão 23; a correção manual continua vencendo).
--   R-10  Reimportar o Embarque de vazios atualizava as unidades no manifesto
--         antigo e apagava o manifesto novo, o único com nome e hash: quem e
--         quando da importação nova se perdiam e o reenvio não avisava. O
--         envelope de `import_vazios_bookings_transactional` (405) grava o
--         recibo no manifesto mais recente das unidades da operação, como o do
--         Granito.
--   R-11  `apply_ce_mercante_rows_atomic`, `import_breakbulk_manifest_transactional`
--         e `import_granite_manifest_transactional` pegavam a trava da Viagem
--         (387) antes de conferir o usuário: uma conta sem perfil interno
--         ativo esperava a importação em curso e só então era recusada. A
--         guarda passa a ser o primeiro passo, como a 389 fez nas outras.
--   R-13  `record_audit_entries` (404) aceitava navio, número e status da
--         Viagem com qualquer valor: Operações gravava "status → cancelled"
--         numa Viagem ativa. Esses três campos já são gravados pelo gatilho
--         `audit_voyages` com o valor real; a RPC deixa de aceitá-los e a tela
--         deixa de mandá-los (a linha duplicada some do Histórico da Viagem).
--   R-16  A planilha de Veículos (`import_vehicle_rows_transactional`) só
--         conferia o local de desova da linha do B/L da planilha; com a 406,
--         preencher a linha vazia sobrescrevia sem confirmação o local
--         diferente do mesmo container noutro B/L. "Gravado" passa a ser o do
--         container físico nos B/Ls ativos da Viagem.
--
-- Só redefine funções (CREATE OR REPLACE mantém os grants); não reescreve nem
-- apaga linhas existentes.
--
-- Rollback: reaplicar `delete_records` da 394, `apply_ce_mercante_rows_atomic`
-- da 387 (com o statement_timeout da 396), os envelopes
-- `import_breakbulk_manifest_transactional`, `import_granite_manifest_transactional`
-- e `import_vazios_bookings_transactional` da 405, `record_audit_entries` da
-- 404 e `import_vehicle_rows_transactional_legacy_189` na definição anterior a
-- esta migration (corpo da 184).

CREATE OR REPLACE FUNCTION public.delete_records(p_kind text, p_ids text[], p_dry_run boolean DEFAULT false, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_id text;
  v_count integer;
  v_deleted jsonb := '[]'::jsonb;
  v_blocked jsonb := '[]'::jsonb;
  v_state text;
  v_message text;
  v_constraint text;
  v_entity text;
  v_lock text[];
  v_status text;
  v_bl_id text;
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_bl_voyage bigint;
  v_bl_pol text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Somente o Administrativo pode excluir.' USING ERRCODE = '42501';
  END IF;

  v_entity := CASE p_kind
    WHEN 'bl' THEN 'bl'
    WHEN 'container' THEN 'container'
    WHEN 'vehicle' THEN 'vehicle'
    WHEN 'customer' THEN 'customer'
    WHEN 'voyage' THEN 'voyages'
  END;
  IF v_entity IS NULL THEN
    RAISE EXCEPTION 'Tipo de exclusão desconhecido: %.', p_kind USING ERRCODE = '22023';
  END IF;
  IF NOT COALESCE(p_dry_run, false) AND v_reason IS NULL THEN
    RAISE EXCEPTION 'Informe o motivo da exclusão.' USING ERRCODE = '22023';
  END IF;

  FOREACH v_id IN ARRAY ARRAY(
    SELECT u.id FROM unnest(COALESCE(p_ids, ARRAY[]::text[])) WITH ORDINALITY AS u(id, ord)
    GROUP BY u.id ORDER BY min(u.ord)
  ) LOOP
    BEGIN
      v_lock := ARRAY[]::text[];
      IF p_kind = 'voyage' THEN
        SELECT status INTO v_status FROM public.voyages WHERE id = v_id::bigint;
        IF FOUND AND v_status = 'cancelled' THEN
          v_lock := ARRAY['viagem cancelada fica retida'];
        ELSE
          v_lock := public.delete_lock_reasons(v_id::bigint);
        END IF;
      ELSIF p_kind = 'customer' THEN
        IF EXISTS (SELECT 1 FROM public.customers c WHERE c.id = v_id::bigint AND NULLIF(btrim(c.cnpj_cpf), '') IS NOT NULL) THEN
          v_lock := ARRAY['cliente com CNPJ: desative em vez de excluir'];
        END IF;
      ELSE
        v_bl_id := CASE p_kind
          WHEN 'bl' THEN v_id
          WHEN 'container' THEN (SELECT c.bl_id FROM public.bl_containers c WHERE c.id = v_id::bigint)
          ELSE (SELECT COALESCE(v.bl_id, c.bl_id) FROM public.vehicles v
                LEFT JOIN public.bl_containers c ON c.id = v.container_id WHERE v.id = v_id::bigint)
        END;
        v_lock := public.bl_delete_lock_reasons(v_bl_id);
      END IF;
      IF cardinality(v_lock) > 0 THEN
        v_blocked := v_blocked || jsonb_build_object('id', v_id, 'reasons', to_jsonb(v_lock));
        CONTINUE;
      END IF;

      -- 380: a exclusão do B/L (ou da Viagem) leva junto os containers e
      -- veículos, mesmo de B/L cancelado, que é somente leitura no resto.
      PERFORM set_config('vela.deleting_records', CASE WHEN p_kind IN ('voyage', 'bl') THEN 'on' ELSE 'off' END, true);
      -- 394 (ADR 0095, decisão 7): os efeitos pendentes do registro saem
      -- como "descartado: registro excluído", sem Alerta.
      IF p_kind = 'voyage' THEN
        PERFORM public._discard_import_effects_of_deleted(
          ARRAY(SELECT b.id FROM public.bls AS b WHERE b.voyage_id = v_id::bigint)
          || CASE WHEN EXISTS (SELECT 1 FROM public.bls AS b WHERE b.id = v_id AND b.voyage_id IS DISTINCT FROM v_id::bigint)
               THEN ARRAY[]::text[] ELSE ARRAY[v_id] END,
          'voyage');
      ELSIF p_kind = 'bl' THEN
        PERFORM public._discard_import_effects_of_deleted(ARRAY[v_id], 'bl');
      END IF;
      IF p_kind = 'voyage' THEN
        PERFORM public.delete_voyage_children(v_id::bigint);
        DELETE FROM public.voyages WHERE id = v_id::bigint;
      ELSIF p_kind = 'bl' THEN
        SELECT b.voyage_id, b.pol INTO v_bl_voyage, v_bl_pol FROM public.bls AS b WHERE b.id = v_id;
        DELETE FROM public.vehicles WHERE bl_id = v_id;
        DELETE FROM public.bls WHERE id = v_id;
      ELSIF p_kind = 'container' THEN
        DELETE FROM public.vehicles WHERE container_id = v_id::bigint;
        DELETE FROM public.bl_containers WHERE id = v_id::bigint;
      ELSIF p_kind = 'vehicle' THEN
        DELETE FROM public.vehicles WHERE id = v_id::bigint;
      ELSE
        DELETE FROM public.customer_contacts WHERE customer_id = v_id::bigint;
        DELETE FROM public.customer_rate_overrides WHERE customer_id = v_id::bigint;
        DELETE FROM public.customers WHERE id = v_id::bigint;
      END IF;
      GET DIAGNOSTICS v_count = ROW_COUNT;
      PERFORM set_config('vela.deleting_records', 'off', true);

      IF v_count = 0 THEN
        v_blocked := v_blocked || jsonb_build_object('id', v_id, 'reasons', jsonb_build_array('não encontrado'));
      ELSIF p_dry_run THEN
        RAISE EXCEPTION USING ERRCODE = 'VL001';
      ELSE
        INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
        VALUES (v_entity, v_id, 'deleted', v_id, NULL, auth.uid(), v_reason);
        IF p_kind = 'bl' AND v_bl_voyage IS NOT NULL THEN
          INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
          VALUES ('voyages', v_bl_voyage::text, 'bl_deleted', v_id, 'excluído', auth.uid(), v_reason);
          -- 408 (R-09; ADR 0095, decisão 23): o B/L excluído deixa de contar no
          -- ATD do POL, como o cancelado (salvo correção manual).
          IF NULLIF(btrim(COALESCE(v_bl_pol, '')), '') IS NOT NULL THEN
            PERFORM public._recompute_voyage_pol_atd(
              v_bl_voyage, v_bl_pol, auth.uid(),
              'ATD recalculado: B/L ' || v_id || ' excluído; só B/Ls ativos contam (ADR 0095, decisão 23)');
          END IF;
        END IF;
        v_deleted := v_deleted || to_jsonb(v_id);
      END IF;
    EXCEPTION
      WHEN SQLSTATE 'VL001' THEN
        v_deleted := v_deleted || to_jsonb(v_id);
      WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS
          v_state = RETURNED_SQLSTATE,
          v_message = MESSAGE_TEXT,
          v_constraint = CONSTRAINT_NAME;
        v_blocked := v_blocked || jsonb_build_object(
          'id', v_id,
          'reasons', jsonb_build_array(public.delete_record_block_reason(v_state, v_message, v_constraint))
        );
    END;
  END LOOP;

  RETURN jsonb_build_object('deleted', v_deleted, 'blocked', v_blocked, 'dry_run', p_dry_run);
END;
$function$;

CREATE OR REPLACE FUNCTION public.apply_ce_mercante_rows_atomic(p_rows jsonb, p_changed_by uuid, p_target text DEFAULT 'bls'::text, p_manifesto_numero text DEFAULT NULL::text, p_voyage_id bigint DEFAULT NULL::bigint, p_confirm_changes boolean DEFAULT false, p_reason text DEFAULT NULL::text, p_defer_billing boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET statement_timeout TO '60s'
AS $function$
BEGIN
  -- 408 (R-11): a guarda antes da trava da Viagem, como a 389 fez nas outras.
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR p_changed_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa.' USING ERRCODE = '42501';
  END IF;
  IF p_target = 'granite' THEN
    RAISE EXCEPTION 'A planilha de CE Mercante não se aplica ao Granito: o Granito só totaliza a carga do navio.'
      USING ERRCODE = '22023';
  END IF;
  PERFORM public._lock_import_voyages_of_bls(ARRAY[p_voyage_id], public._import_payload_texts(p_rows, 'bl_id'));
  PERFORM public._set_import_context('CE Mercante', p_voyage_id, p_manifesto_numero);
  RETURN public.apply_ce_mercante_rows_atomic_legacy_189(p_rows, p_changed_by, p_target, p_manifesto_numero, p_voyage_id, p_confirm_changes, p_reason, p_defer_billing);
END $function$;

CREATE OR REPLACE FUNCTION public.import_breakbulk_manifest_transactional(p_filename text, p_voyage_id bigint, p_uploaded_by uuid, p_total_bls integer, p_bls jsonb, p_items jsonb, p_errors jsonb, p_file_hash text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  -- 408 (R-11): a guarda antes da trava da Viagem (o corpo a pega primeiro).
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR p_uploaded_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Credenciais invalidas para importar carga solta.' USING ERRCODE = '42501';
  END IF;
  PERFORM public._declare_import_file(p_filename, p_file_hash);
  v_result := public.import_breakbulk_manifest_transactional_core_405(
    p_filename, p_voyage_id, p_uploaded_by, p_total_bls, p_bls, p_items, p_errors);
  PERFORM public._declare_import_file(NULL, NULL);
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.import_granite_manifest_transactional(p_voyage_id bigint, p_vessel_voyage text, p_loading_port text, p_discharge_port text, p_total_bls integer, p_total_weight_kg numeric, p_uploaded_by uuid, p_bls jsonb, p_remove_missing text[] DEFAULT NULL::text[], p_filename text DEFAULT NULL::text, p_file_hash text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  -- 408 (R-11): a guarda antes da trava da Viagem (o corpo a pega primeiro).
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR p_uploaded_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Sem permissão para importar o Granito: entre de novo com um usuário ativo.' USING ERRCODE = '42501';
  END IF;
  PERFORM public._declare_import_file(p_filename, p_file_hash);
  v_result := public.import_granite_manifest_transactional_core_405(
    p_voyage_id, p_vessel_voyage, p_loading_port, p_discharge_port,
    p_total_bls, p_total_weight_kg, p_uploaded_by, p_bls, p_remove_missing);
  -- A reimportação atualiza o manifesto existente em vez de inserir (206): o
  -- recibo desta gravação substitui o anterior, para o aviso de reenvio
  -- apontar a última importação.
  IF NULLIF(current_setting('vela.import_file_hash', true), '') IS NOT NULL THEN
    UPDATE public.granite_manifests
    SET filename = NULLIF(current_setting('vela.import_file_name', true), ''),
        file_hash = current_setting('vela.import_file_hash', true),
        imported_by = p_uploaded_by,
        imported_at = now()
    WHERE id = (v_result->>'manifest_id')::uuid;
  END IF;
  PERFORM public._declare_import_file(NULL, NULL);
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.import_vazios_bookings_transactional(p_voyage_id bigint, p_port text, p_uploaded_by uuid, p_bookings jsonb, p_filename text DEFAULT NULL::text, p_file_hash text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  PERFORM public._declare_import_file(p_filename, p_file_hash);
  v_result := public.import_vazios_bookings_transactional_core_405(p_voyage_id, p_port, p_uploaded_by, p_bookings);
  -- 408 (R-10): a reimportação atualiza as unidades no manifesto em que já
  -- estão e apaga o manifesto novo, que ficou vazio; o recibo desta gravação
  -- vai para o manifesto mais recente das unidades da operação, como o
  -- Granito faz (405), para o aviso de reenvio apontar a última importação.
  IF NULLIF(current_setting('vela.import_file_hash', true), '') IS NOT NULL
     AND v_result->>'manifest_id' IS NULL AND v_result->>'operation_id' IS NOT NULL THEN
    UPDATE public.vazios_manifests
    SET filename = NULLIF(current_setting('vela.import_file_name', true), ''),
        file_hash = current_setting('vela.import_file_hash', true),
        imported_by = p_uploaded_by,
        imported_at = now()
    WHERE id = (
      SELECT m.id
      FROM public.vazios_bookings AS b
      JOIN public.vazios_manifests AS m ON m.id = b.manifest_id
      WHERE b.operation_id = (v_result->>'operation_id')::uuid
        AND m.description IS DISTINCT FROM 'Inclusao manual no Embarque de Vazios'
      ORDER BY m.imported_at DESC NULLS LAST, m.id
      LIMIT 1);
  END IF;
  PERFORM public._declare_import_file(NULL, NULL);
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.record_audit_entries(p_entries jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_entry jsonb;
  v_type text;
  v_field text;
  v_count integer := 0;
BEGIN
  IF v_actor IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuário sem permissão ativa para registrar no Histórico.' USING ERRCODE = '42501';
  END IF;
  IF p_entries IS NULL OR jsonb_typeof(p_entries) <> 'array' THEN
    RAISE EXCEPTION 'Registros do Histórico inválidos.' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_entries) > 100 THEN
    RAISE EXCEPTION 'Registros demais para o Histórico de uma vez.' USING ERRCODE = '22023';
  END IF;

  FOR v_entry IN SELECT e FROM jsonb_array_elements(p_entries) AS t(e) LOOP
    v_type := v_entry ->> 'entity_type';
    v_field := v_entry ->> 'field_name';
    IF NULLIF(btrim(COALESCE(v_entry ->> 'entity_id', '')), '') IS NULL THEN
      RAISE EXCEPTION 'Registro do Histórico sem identificação.' USING ERRCODE = '22023';
    END IF;
    IF NOT (
         (v_type IN ('voyage_pod_schedule', 'voyage_pol_schedule') AND v_field IN (
            'etd', 'eta', 'etb', 'ata', 'atb', 'atd', 'rtw', 'ces', 'linked',
            'escala_number', 'deleted', 'omitted', 'tem_importacao'))
      -- 408 (R-13): navio, número e status da Viagem vêm só do gatilho de
      -- `voyages` (audit_voyages), com o valor que de fato mudou.
      OR (v_type = 'voyages' AND v_field IN (
            'created', 'indicated_first_brazilian_port', 'indicated_first_brazilian_eta'))
      OR (v_type = 'system_event' AND v_field IN (
            'manifest_import_rate_limited', 'manifest_import_duplicate_hash',
            'bl_review_concurrent_conflict', 'invoice_create_conflict',
            'invoice_payment_invalid', 'invoice_cancel_blocked',
            'customer_finance_communication_failed', 'granite_reimport_already_invoiced'))
      OR (v_type = 'user_profile' AND v_field IN ('created', 'email', 'password', 'role', 'active', 'full_name')
          AND public.is_admin())
    ) THEN
      RAISE EXCEPTION 'Registro do Histórico não aceito: % / %.', v_type, v_field USING ERRCODE = '42501';
    END IF;

    INSERT INTO public.audit_logs (
      entity_type, entity_id, field_name, old_value, new_value,
      changed_by, changed_at, justification, actor_role, actor_department)
    VALUES (
      v_type, btrim(v_entry ->> 'entity_id'), v_field, v_entry ->> 'old_value', v_entry ->> 'new_value',
      v_actor,
      -- Mesma hora do INSERT direto (audit_logs_force_actor): o status de B/Ls
      -- e CEs usa a hora do relógio para ordenar gravações da mesma transação.
      CASE WHEN v_type = 'voyage_pod_schedule' AND v_field IN ('ces', 'export_ces') THEN clock_timestamp() ELSE now() END,
      NULLIF(v_entry ->> 'justification', ''),
      public.current_actor_role(), public.current_actor_role());
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.import_vehicle_rows_transactional_legacy_189(p_rows jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_count integer := COALESCE(jsonb_array_length(p_rows), 0);
  v_action_id uuid := gen_random_uuid();
  v_bl_id text;
  v_problem text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Credenciais invalidas ou sem permissao para importar veiculos.'
      USING ERRCODE = '42501';
  END IF;
  IF v_count = 0 THEN RETURN 0; END IF;

  CREATE TEMP TABLE IF NOT EXISTS tmp_vehicle_import (
    voyage_id bigint, container_id bigint, bl_id text, chassis text, brand text, model text,
    weight_kg numeric, cbm numeric, unpacking_location text, unpacking_confirmed boolean
  ) ON COMMIT DROP;
  TRUNCATE tmp_vehicle_import;
  INSERT INTO tmp_vehicle_import
  SELECT row.voyage_id, row.container_id, upper(btrim(row.bl_id)), upper(btrim(row.chassis)), row.brand, row.model,
         row.weight_kg, row.cbm, NULLIF(btrim(row.unpacking_location), ''), COALESCE(row.unpacking_confirmed, false)
  FROM jsonb_to_recordset(p_rows) AS row(
    voyage_id bigint, container_id bigint, bl_id text, chassis text, brand text, model text,
    weight_kg numeric, cbm numeric, unpacking_location text, unpacking_confirmed boolean
  );

  -- B/L da Viagem, ativo; sem busca de B/L "parecido".
  SELECT 'B/L ' || t.bl_id || ' não encontrado na Viagem ou cancelado.' INTO v_problem
  FROM tmp_vehicle_import t
  LEFT JOIN public.bls b ON b.id = t.bl_id AND b.voyage_id = t.voyage_id AND b.cancelled_at IS NULL
  WHERE b.id IS NULL LIMIT 1;
  IF v_problem IS NOT NULL THEN RAISE EXCEPTION '%', v_problem USING ERRCODE = '22023'; END IF;

  -- Mesmo chassi em outra Viagem ativa.
  SELECT 'Chassi ' || t.chassis || ' já cadastrado na Viagem ' || COALESCE(v.voyage_number, v.id::text) || '.' INTO v_problem
  FROM tmp_vehicle_import t
  JOIN public.vehicles ve ON ve.chassis = t.chassis AND ve.voyage_id <> t.voyage_id
  JOIN public.bls b ON b.id = ve.bl_id AND b.cancelled_at IS NULL
  JOIN public.voyages v ON v.id = ve.voyage_id AND v.status IS DISTINCT FROM 'cancelled'
  LIMIT 1;
  IF v_problem IS NOT NULL THEN RAISE EXCEPTION '%', v_problem USING ERRCODE = '23505'; END IF;

  -- Local de desova diferente para o mesmo container no arquivo.
  SELECT 'Local de desova diferente para o container ' || c.container_number || ' no mesmo arquivo.' INTO v_problem
  FROM tmp_vehicle_import t JOIN public.bl_containers c ON c.id = t.container_id
  WHERE t.unpacking_location IS NOT NULL
  GROUP BY c.container_number
  HAVING count(DISTINCT upper(t.unpacking_location)) > 1
  LIMIT 1;
  IF v_problem IS NOT NULL THEN RAISE EXCEPTION '%', v_problem USING ERRCODE = '22023'; END IF;

  INSERT INTO public.vehicles(voyage_id, container_id, bl_id, chassis, brand, model, weight_kg, cbm)
  SELECT voyage_id, container_id, bl_id, chassis, brand, model, weight_kg, cbm FROM tmp_vehicle_import;

  -- Só preenche vazio; troca o gravado apenas com confirmação. 408 (R-16): o
  -- gravado é o do container físico (406 propaga o local aos outros B/Ls
  -- ativos da Viagem), não só o da linha do B/L da planilha.
  UPDATE public.bl_containers AS c
  SET unpacking_location = t.unpacking_location
  FROM (SELECT DISTINCT ON (container_id) container_id, voyage_id, unpacking_location, unpacking_confirmed
        FROM tmp_vehicle_import WHERE unpacking_location IS NOT NULL ORDER BY container_id) AS t
  WHERE c.id = t.container_id
    AND c.unpacking_location IS DISTINCT FROM t.unpacking_location
    AND (t.unpacking_confirmed OR NOT EXISTS (
      SELECT 1
      FROM public.bl_containers AS s
      JOIN public.bls AS sb ON sb.id = s.bl_id AND sb.cancelled_at IS NULL
      WHERE sb.voyage_id = t.voyage_id
        AND upper(btrim(s.container_number)) = upper(btrim(c.container_number))
        AND NULLIF(btrim(COALESCE(s.unpacking_location, '')), '') IS NOT NULL
        AND upper(btrim(s.unpacking_location)) <> upper(btrim(t.unpacking_location))));

  FOR v_bl_id IN SELECT DISTINCT bl_id FROM tmp_vehicle_import ORDER BY 1 LOOP
    INSERT INTO public.import_pending_effects(source_action_id, effect_kind, entity_id, created_by, source_snapshot)
    VALUES (v_action_id, 'vehicle_followup', v_bl_id, auth.uid(),
      jsonb_build_object('row_count', v_count, 'voyage_ids',
        (SELECT jsonb_agg(DISTINCT voyage_id ORDER BY voyage_id) FROM tmp_vehicle_import)))
    ON CONFLICT (source_action_id, effect_kind, entity_id) DO NOTHING;
    PERFORM public._vehicle_charges_follow(v_bl_id, auth.uid());
  END LOOP;

  RETURN v_count;
END;
$function$;
