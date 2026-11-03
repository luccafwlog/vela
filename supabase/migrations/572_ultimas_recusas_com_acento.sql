-- 572: as últimas recusas sem acento citadas na revisão do Manual do Operador
-- (PR #1087), em todas as funções vigentes que as levam:
--   Transbordo do B/L % nao encontrado   -> … não encontrado
--     (set_bl_transshipment, set_bl_cod)
--   Lote de datas invalido.               -> … inválido.
--     (apply_container_dates_batch_atomic, apply_container_dates_atomic_legacy_189),
--     com as outras recusas da mesma função: request_id obrigatório, Linha de
--     datas inválida, Data de descarga/devolução inválida, Devolução anterior à
--     descarga, Container % não pertence ao B/L %, B/L obrigatório e Container
--     obrigatório no B/L %
--   Efeito % nao encontrado.              -> … não encontrado.
--     (retry_import_effect, complete_import_effect, process_import_effect;
--     _park_import_effect_waiting leva só a do Lease),
--     com as outras recusas das duas últimas, que só o executor do servidor vê:
--     Lease do efeito não pertence ao worker, Estado final inválido, Resultado
--     de efeito inválido, Identidade de conclusão incompleta, Viagem inválida
--     no efeito de flags e effect_kind não suportado
--
-- Cada função é a definição vigente (lida com pg_get_functiondef no Postgres
-- local com toda a cadeia aplicada) com só esses textos trocados; lógica,
-- ERRCODE, assinatura, SECURITY DEFINER, search_path e grants ficam iguais.
-- Nenhuma função compara esses textos por SQLERRM.
--
-- Só redefine funções; não grava nem reescreve linhas.
-- Rollback: desfazer só as trocas de texto em cada função.

CREATE OR REPLACE FUNCTION public.set_bl_transshipment(p_bl_id text, p_omission_id bigint, p_justification text, p_changed_by uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_was TEXT;
  v_original_pod TEXT;
  v_old_pod TEXT;
  v_customer BIGINT;
  v_justification TEXT := NULLIF(btrim(COALESCE(p_justification, '')), '');
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR p_changed_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Usuário sem permissão ativa.' USING ERRCODE = '42501';
  END IF;

  SELECT t.disposition, o.omitted_pod INTO v_was, v_original_pod
  FROM public.bl_transshipments AS t
  JOIN public.voyage_omissions AS o ON o.id = t.omission_id
  WHERE t.bl_id = p_bl_id AND t.omission_id = p_omission_id
  FOR UPDATE OF o;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transbordo do B/L % não encontrado', p_bl_id USING ERRCODE = 'P0002';
  END IF;

  SELECT pod, customer_id INTO v_old_pod, v_customer
  FROM public.bls WHERE id = p_bl_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L % não encontrado', p_bl_id USING ERRCODE = 'P0002';
  END IF;

  IF v_was = 'cod' AND v_justification IS NULL THEN
    RAISE EXCEPTION 'Reverter COD exige justificativa.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.bl_transshipments
  SET disposition = 'transshipment', updated_at = now()
  WHERE bl_id = p_bl_id AND omission_id = p_omission_id;

  IF v_was = 'cod' THEN
    UPDATE public.bls SET pod = v_original_pod, updated_at = now() WHERE id = p_bl_id;

    IF to_regprocedure('public.apply_cod_financial_effect(text,bigint,text)') IS NOT NULL THEN
      PERFORM public.apply_cod_financial_effect(p_bl_id, p_omission_id, v_old_pod);
    END IF;

    INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
    VALUES ('bls', p_bl_id, 'pod', v_old_pod, v_original_pod, p_changed_by,
      'Reversao de COD para transbordo: ' || v_justification);

    IF v_customer IS NOT NULL THEN
      INSERT INTO public.portal_notifications(customer_id, bl_id, type, title, message, link)
      VALUES (
        v_customer, p_bl_id, 'transshipment', 'Correção de destino (COD)',
        'O destino final do B/L ' || p_bl_id || ' foi restaurado para ' || v_original_pod ||
          ' após a reversão do COD.', NULL
      );
    END IF;
  END IF;

  INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  VALUES ('bls', p_bl_id, 'transbordo', v_was, 'transshipment', p_changed_by,
    'Definicao de transbordo (navio de terceiros)');
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_bl_cod(p_bl_id text, p_omission_id bigint, p_justification text, p_changed_by uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_discharge text;
  v_omitted text;
  v_old_pod text;
  v_customer bigint;
  v_old_terminal uuid;
  v_old_pod_port_id bigint;
  v_justification text := NULLIF(btrim(COALESCE(p_justification, '')), '');
  v_previous_override text := current_setting('vela.bl_terminal_override', true);
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR p_changed_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Usuário sem permissão ativa.' USING ERRCODE = '42501';
  END IF;
  IF v_justification IS NULL THEN RAISE EXCEPTION 'Marcar COD exige justificativa.' USING ERRCODE = '22023'; END IF;

  SELECT o.discharge_pod, o.omitted_pod INTO v_discharge, v_omitted
  FROM public.bl_transshipments AS t
  JOIN public.voyage_omissions AS o ON o.id = t.omission_id
  WHERE t.bl_id = p_bl_id AND t.omission_id = p_omission_id
  FOR UPDATE OF o;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transbordo do B/L % não encontrado', p_bl_id USING ERRCODE = 'P0002';
  END IF;

  SELECT pod, customer_id, terminal_id, pod_port_id
    INTO v_old_pod, v_customer, v_old_terminal, v_old_pod_port_id
  FROM public.bls
  WHERE id = p_bl_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L % não encontrado', p_bl_id USING ERRCODE = 'P0002';
  END IF;

  -- Retry do mesmo COD não repete efeito financeiro, auditoria ou notificação;
  -- inclusive quando a reprecificação concluiu que não havia diferença.
  IF EXISTS (
    SELECT 1
    FROM public.bl_transshipments
    WHERE bl_id = p_bl_id AND omission_id = p_omission_id AND disposition = 'cod'
  ) THEN
    RETURN;
  END IF;

  UPDATE public.bl_transshipments
  SET disposition = 'cod', updated_at = now()
  WHERE bl_id = p_bl_id AND omission_id = p_omission_id;

  -- A exceção terminal é específica do POD anterior. COD deve limpar os dois
  -- campos como uma operação atômica; deixar a dupla antiga seria herdar um
  -- terminal incompatível no destino novo.
  PERFORM set_config('vela.bl_terminal_override', 'on', true);
  UPDATE public.bls
  SET pod = v_discharge,
      manifesto_mercante_id = NULL,
      terminal_id = NULL,
      pod_port_id = NULL,
      updated_at = now()
  WHERE id = p_bl_id;
  PERFORM set_config('vela.bl_terminal_override', COALESCE(v_previous_override, 'off'), true);

  IF to_regprocedure('public.apply_cod_financial_effect(text,bigint,text)') IS NOT NULL THEN
    PERFORM public.apply_cod_financial_effect(p_bl_id, p_omission_id, v_old_pod);
  END IF;

  INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  VALUES ('bls', p_bl_id, 'pod', v_old_pod, v_discharge, p_changed_by,
    'COD apos omissao da escala de ' || v_omitted || ': ' || v_justification);

  IF v_old_terminal IS NOT NULL OR v_old_pod_port_id IS NOT NULL THEN
    INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
    VALUES (
      'bls', p_bl_id, 'terminal_override',
      jsonb_build_object('terminal_id', v_old_terminal, 'pod_port_id', v_old_pod_port_id)::text,
      jsonb_build_object('terminal_id', NULL, 'pod_port_id', NULL)::text,
      p_changed_by,
      'Excecao de terminal limpa por COD: ' || v_justification
    );
  END IF;

  IF v_customer IS NOT NULL THEN
    INSERT INTO public.portal_notifications(customer_id, bl_id, type, title, message, link)
    VALUES (v_customer, p_bl_id, 'transshipment', 'Destino alterado (COD)',
      'A pedido, o destino final do B/L ' || p_bl_id || ' foi alterado para ' || v_discharge ||
        ' (COD), apos a omissao da escala de ' || v_omitted || '.', NULL);
  END IF;
END;
$function$;

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
BEGIN
  IF v_actor IS NULL OR NOT public.is_active_user() OR p_changed_by IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'Usuário sem permissão ativa.' USING ERRCODE = '42501';
  END IF;
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'request_id obrigatório.' USING ERRCODE = '22023';
  END IF;
  IF p_batches IS NULL OR jsonb_typeof(p_batches) <> 'array' OR jsonb_array_length(p_batches) = 0 THEN
    RAISE EXCEPTION 'Planilha de datas vazia.' USING ERRCODE = '22023';
  END IF;
  -- 499: sem teto de B/Ls nem de linhas; o limite é o tempo da chamada.
  FOR v_batch IN SELECT * FROM jsonb_array_elements(p_batches) LOOP
    IF jsonb_typeof(v_batch) <> 'object' OR jsonb_typeof(v_batch->'rows') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'Lote de datas inválido.' USING ERRCODE = '22023';
    END IF;
  END LOOP;

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

CREATE OR REPLACE FUNCTION public.apply_container_dates_atomic_legacy_189(p_request_id uuid, p_bl_id text, p_rows jsonb, p_changed_by uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_role text;
  v_bl_id text := NULLIF(btrim(COALESCE(p_bl_id, '')), '');
  v_count integer := 0;
  v_item jsonb;
  v_num text;
  v_discharge text;
  v_return text;
  v_exp_discharge text;
  v_exp_return text;
  v_updated bigint[] := ARRAY[]::bigint[];
  v_unchanged bigint[] := ARRAY[]::bigint[];
  v_touched text[] := ARRAY[]::text[];
  v_billing_state text := 'pending';
  v_after jsonb := '{}'::jsonb;
  r record;
BEGIN
  IF v_actor IS NULL OR NOT public.is_active_user() OR p_changed_by IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'Usuário sem permissão ativa.' USING ERRCODE = '42501';
  END IF;
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'request_id obrigatório.' USING ERRCODE = '22023';
  END IF;
  IF v_bl_id IS NULL THEN
    RAISE EXCEPTION 'B/L obrigatório.' USING ERRCODE = '22023';
  END IF;
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'Lote de datas inválido.' USING ERRCODE = '22023';
  END IF;
  v_count := jsonb_array_length(p_rows);
  IF v_count = 0 OR v_count > 500 THEN
    RAISE EXCEPTION 'Lote deve ter entre 1 e 500 linhas.' USING ERRCODE = '22023';
  END IF;

  PERFORM 1 FROM public.bls WHERE id = v_bl_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L % não encontrado', v_bl_id USING ERRCODE = 'P0002';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_rows)
  LOOP
    IF jsonb_typeof(v_item) <> 'object' THEN
      RAISE EXCEPTION 'Linha de datas inválida.' USING ERRCODE = '22023';
    END IF;
    v_num := upper(btrim(COALESCE(v_item->>'container_number', '')));
    v_discharge := NULLIF(btrim(COALESCE(v_item->>'discharge_date', '')), '');
    v_return := NULLIF(btrim(COALESCE(v_item->>'return_date', '')), '');
    IF v_num = '' THEN
      RAISE EXCEPTION 'Container obrigatório no B/L %.', v_bl_id USING ERRCODE = '22023';
    END IF;
    IF v_discharge IS NULL OR v_discharge !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR v_discharge::date IS NULL THEN
      RAISE EXCEPTION 'Data de descarga inválida para % no B/L %.', v_num, v_bl_id USING ERRCODE = '22023';
    END IF;
    IF v_return IS NOT NULL AND (v_return !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR v_return::date IS NULL) THEN
      RAISE EXCEPTION 'Data de devolução inválida para % no B/L %.', v_num, v_bl_id USING ERRCODE = '22023';
    END IF;
    IF v_return IS NOT NULL AND v_return::date < v_discharge::date THEN
      RAISE EXCEPTION 'Devolução anterior à descarga para % no B/L %.', v_num, v_bl_id USING ERRCODE = '22023';
    END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_to_recordset(p_rows) AS t(container_number text, discharge_date text, return_date text)
      WHERE upper(btrim(COALESCE(t.container_number, ''))) = v_num
        AND (btrim(COALESCE(t.discharge_date, '')) IS DISTINCT FROM v_discharge
             OR NULLIF(btrim(COALESCE(t.return_date, '')), '') IS DISTINCT FROM v_return)
    ) THEN
      RAISE EXCEPTION 'Container % duplicado com datas conflitantes no B/L %.', v_num, v_bl_id USING ERRCODE = '22023';
    END IF;
  END LOOP;

  -- Todos os conjuntos do arquivo, em ordem de id, antes da trava por linha
  -- abaixo (211): duas planilhas de B/Ls que dividem containers não se travam.
  PERFORM public._lock_container_date_sets(ARRAY(
    SELECT c.id FROM public.bl_containers AS c
    WHERE c.bl_id = v_bl_id
      AND upper(btrim(c.container_number)) IN (
        SELECT upper(btrim(COALESCE(row_item->>'container_number', '')))
        FROM jsonb_array_elements(p_rows) AS row_item)));

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_rows)
  LOOP
    v_num := upper(btrim(COALESCE(v_item->>'container_number', '')));
    v_discharge := NULLIF(btrim(COALESCE(v_item->>'discharge_date', '')), '');
    v_return := NULLIF(btrim(COALESCE(v_item->>'return_date', '')), '');
    v_exp_discharge := NULLIF(btrim(COALESCE(v_item->>'expected_discharge_date', '')), '');
    v_exp_return := NULLIF(btrim(COALESCE(v_item->>'expected_return_date', '')), '');

    SELECT c.id, c.discharge_date::text, c.return_date::text INTO r
    FROM public.bl_containers AS c
    WHERE c.bl_id = v_bl_id AND upper(btrim(c.container_number)) = v_num
    ORDER BY c.id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Container % não pertence ao B/L %.', v_num, v_bl_id USING ERRCODE = 'P0002';
    END IF;

    -- Devolução vazia na planilha não mexe na data gravada (ADR 0078, item 19).
    -- Vem antes da checagem de prévia obsoleta: o container que já está no
    -- valor pedido não é escrito, e a data que outro B/L do mesmo arquivo
    -- acabou de propagar a este (container compartilhado) não é conflito.
    IF r.discharge_date IS NOT DISTINCT FROM v_discharge
       AND (v_return IS NULL OR r.return_date IS NOT DISTINCT FROM v_return) THEN
      v_unchanged := array_append(v_unchanged, r.id);
      CONTINUE;
    END IF;

    -- A prévia que viu a descarga vazia também conta: a chave presente com
    -- valor nulo é conferida, como a da devolução (201).
    IF (v_item ? 'expected_discharge_date') AND (r.discharge_date IS DISTINCT FROM v_exp_discharge) THEN
      RAISE EXCEPTION 'Preview obsoleto para % no B/L %: recarregue e reconfira.', v_num, v_bl_id USING ERRCODE = '22023';
    END IF;
    IF (v_item ? 'expected_return_date') AND (r.return_date IS DISTINCT FROM v_exp_return) THEN
      RAISE EXCEPTION 'Preview obsoleto para % no B/L %: recarregue e reconfira.', v_num, v_bl_id USING ERRCODE = '22023';
    END IF;

    v_touched := v_touched || public._apply_container_dates_core(r.id, v_discharge::date, v_return::date, v_return IS NULL);
    v_updated := array_append(v_updated, r.id);
  END LOOP;

  -- SOC não tem devolução a esperar (ADR 0014; migration 121).
  IF NOT EXISTS (
    SELECT 1 FROM public.bl_containers AS c
    WHERE c.bl_id = v_bl_id AND c.return_date IS NULL AND c.ownership IS DISTINCT FROM 'SOC'
  ) THEN
    v_billing_state := 'ready_for_billing';
  END IF;

  v_role := public.current_actor_role();

  IF cardinality(v_updated) > 0 THEN
    v_touched := ARRAY(SELECT DISTINCT unnest(v_touched || ARRAY[v_bl_id]));
    INSERT INTO public.audit_logs(
      entity_type, entity_id, field_name, old_value, new_value,
      changed_by, justification, actor_role, actor_department
    ) VALUES (
      'bl', v_bl_id, 'container_dates_import',
      jsonb_build_object('request_id', p_request_id, 'bl_id', v_bl_id)::text,
      jsonb_build_object(
        'request_id', p_request_id, 'bl_id', v_bl_id,
        'updated_ids', v_updated, 'unchanged_ids', v_unchanged,
        'billing_state', v_billing_state, 'propagated_bl_ids', v_touched
      )::text,
      v_actor, 'Importacao de datas por B/L (atomica)', v_role, v_role
    );
    v_after := public._after_container_dates(p_request_id, v_touched, v_actor);
  END IF;

  RETURN jsonb_build_object(
    'request_id', p_request_id,
    'bl_id', v_bl_id,
    'updated_ids', v_updated,
    'unchanged_ids', v_unchanged,
    'billing_state', v_billing_state,
    'propagated_bl_ids', to_jsonb(v_touched),
    'demurrage', v_after
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.retry_import_effect(p_effect_id bigint, p_justification text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_row public.import_pending_effects%ROWTYPE;
  v_actor uuid := auth.uid();
  v_role text := public.current_actor_role();
  v_justification text := NULLIF(btrim(COALESCE(p_justification, '')), '');
  v_assign_initiator boolean;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND (v_actor IS NULL OR NOT public.is_active_user()
          OR v_role NOT IN ('administrativo', 'financeiro', 'operacoes', 'documentacao', 'equipamentos')) THEN
    RAISE EXCEPTION 'Usuário sem permissão para reabrir efeito.' USING ERRCODE = '42501';
  END IF;
  IF v_justification IS NULL OR char_length(v_justification) > 500 THEN
    RAISE EXCEPTION 'Justificativa obrigatoria para retry.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_row
  FROM public.import_pending_effects
  WHERE id = p_effect_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Efeito % não encontrado.', p_effect_id USING ERRCODE = 'P0002';
  END IF;
  IF v_row.status IS DISTINCT FROM 'blocked' THEN
    RAISE EXCEPTION 'Somente efeitos bloqueados podem ser reabertos.' USING ERRCODE = '22023';
  END IF;

  -- 570: o efeito gravado sem iniciador passa a ser de quem reprocessa.
  v_assign_initiator := v_row.created_by IS NULL AND v_actor IS NOT NULL;

  UPDATE public.import_pending_effects
     SET status = 'retry_wait',
         attempts = 0,
         next_attempt_at = now(),
         lease_until = NULL,
         leased_by = NULL,
         last_error_code = NULL,
         last_error_message = NULL,
         created_by = CASE WHEN v_assign_initiator THEN v_actor ELSE created_by END,
         result = COALESCE(result, '{}'::jsonb)
           || jsonb_build_object('manual_retry_justification', v_justification)
           || CASE WHEN v_assign_initiator
                THEN jsonb_build_object('initiator_assigned_on_retry', v_actor)
                ELSE '{}'::jsonb END,
         updated_at = now()
   WHERE id = v_row.id;

  INSERT INTO public.audit_logs(
    entity_type, entity_id, field_name, old_value, new_value,
    changed_by, justification, actor_role, actor_department
  ) VALUES (
    'import_effect', v_row.id::text, 'retry',
    jsonb_build_object('status', 'blocked', 'attempts', v_row.attempts)::text,
    (jsonb_build_object('status', 'retry_wait', 'attempts', 0)
      || CASE WHEN v_assign_initiator
           THEN jsonb_build_object('created_by', v_actor, 'initiator_assigned_on_retry', true)
           ELSE '{}'::jsonb END)::text,
    v_actor, v_justification, COALESCE(v_role, 'sistema'), COALESCE(v_role, 'sistema')
  );

  SELECT * INTO v_row FROM public.import_pending_effects WHERE id = p_effect_id;
  RETURN jsonb_build_object('effect', to_jsonb(v_row), 'idempotent', false);
END;
$function$;

CREATE OR REPLACE FUNCTION public.complete_import_effect(p_effect_id bigint, p_worker_id text, p_status text, p_result jsonb DEFAULT NULL::jsonb, p_error_code text DEFAULT NULL::text, p_error_message text DEFAULT NULL::text, p_retry_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_row public.import_pending_effects%ROWTYPE;
  v_final_status text := p_status;
  v_result jsonb := COALESCE(p_result, '{}'::jsonb);
  v_error_code text := NULLIF(left(COALESCE(p_error_code, ''), 200), '');
  v_error_message text := NULLIF(left(COALESCE(p_error_message, ''), 2000), '');
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Executor server-only.' USING ERRCODE = '42501';
  END IF;
  IF p_effect_id IS NULL OR NULLIF(btrim(COALESCE(p_worker_id, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Identidade de conclusão incompleta.' USING ERRCODE = '22023';
  END IF;
  IF p_status NOT IN ('succeeded', 'retry_wait', 'blocked', 'superseded') THEN
    RAISE EXCEPTION 'Estado final inválido.' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(v_result) <> 'object' THEN
    RAISE EXCEPTION 'Resultado de efeito inválido.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_row
  FROM public.import_pending_effects
  WHERE id = p_effect_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Efeito % não encontrado.', p_effect_id USING ERRCODE = 'P0002';
  END IF;

  IF v_row.status IN ('succeeded', 'blocked', 'superseded') THEN
    RETURN jsonb_build_object('effect', to_jsonb(v_row), 'idempotent', true);
  END IF;
  IF v_row.status IS DISTINCT FROM 'running'
     OR v_row.leased_by IS DISTINCT FROM p_worker_id THEN
    RAISE EXCEPTION 'Lease do efeito não pertence ao worker.' USING ERRCODE = '42501';
  END IF;
  IF v_row.lease_until IS NULL OR v_row.lease_until <= now() THEN
    RAISE EXCEPTION 'Lease do efeito expirou.' USING ERRCODE = '40001';
  END IF;

  IF v_final_status = 'retry_wait' AND v_row.attempts >= 5 THEN
    v_final_status := 'blocked';
    v_error_code := COALESCE(v_error_code, 'retry_exhausted');
    v_error_message := COALESCE(v_error_message, 'Numero maximo de tentativas atingido.');
  END IF;

  UPDATE public.import_pending_effects
     SET status = v_final_status,
         lease_until = NULL,
         leased_by = NULL,
         next_attempt_at = CASE
           WHEN v_final_status = 'retry_wait' THEN COALESCE(p_retry_at, now() + interval '5 minutes')
           ELSE next_attempt_at
         END,
         result = v_result,
         last_error_code = CASE WHEN v_final_status = 'succeeded' THEN NULL ELSE v_error_code END,
         last_error_message = CASE WHEN v_final_status = 'succeeded' THEN NULL ELSE v_error_message END,
         updated_at = now()
   WHERE id = v_row.id;

  INSERT INTO public.import_effect_attempts(
    effect_id, attempt_no, event_kind, worker_id, status,
    result, error_code, error_message
  ) VALUES (
    v_row.id, v_row.attempts, 'completed', p_worker_id, v_final_status,
    v_result, CASE WHEN v_final_status = 'succeeded' THEN NULL ELSE v_error_code END,
    CASE WHEN v_final_status = 'succeeded' THEN NULL ELSE v_error_message END
  );

  SELECT * INTO v_row FROM public.import_pending_effects WHERE id = p_effect_id;
  RETURN jsonb_build_object('effect', to_jsonb(v_row), 'idempotent', false);
END;
$function$;

CREATE OR REPLACE FUNCTION public.process_import_effect(p_effect_id bigint, p_worker_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_effect public.import_pending_effects%ROWTYPE;
  v_actor uuid;
  v_result jsonb;
  v_status text;
  v_error_code text;
  v_error_message text;
  v_retry_at timestamptz;
  v_sqlstate text;
  v_voyage_id bigint;
  v_anchor text;
  v_requeued text[] := ARRAY[]::text[];
  v_initiator uuid;
  v_as_system boolean := false;
  v_executor jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Executor server-only.' USING ERRCODE = '42501';
  END IF;
  IF p_effect_id IS NULL
     OR NULLIF(btrim(COALESCE(p_worker_id, '')), '') IS NULL
     OR char_length(p_worker_id) > 128 THEN
    RAISE EXCEPTION 'Identidade de processamento incompleta.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_effect FROM public.import_pending_effects WHERE id = p_effect_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Efeito % não encontrado.', p_effect_id USING ERRCODE = 'P0002';
  END IF;

  IF v_effect.status IN ('succeeded', 'blocked', 'superseded') THEN
    RETURN jsonb_build_object('effect', to_jsonb(v_effect), 'idempotent', true);
  END IF;
  IF v_effect.status IS DISTINCT FROM 'running' OR v_effect.leased_by IS DISTINCT FROM p_worker_id THEN
    RAISE EXCEPTION 'Lease do efeito não pertence ao worker.' USING ERRCODE = '42501';
  END IF;
  IF v_effect.lease_until IS NULL OR v_effect.lease_until <= now() THEN
    RAISE EXCEPTION 'Lease do efeito expirou.' USING ERRCODE = '40001';
  END IF;
  IF v_effect.created_by IS NULL THEN
    RAISE EXCEPTION 'Efeito sem iniciador validado.' USING ERRCODE = '42501';
  END IF;

  v_initiator := v_effect.created_by;
  v_actor := v_initiator;
  -- 394 (ADR 0095, decisão 25): iniciador desativado não bloqueia o efeito;
  -- ele roda como a conta de sistema "Vela (automático)", e o resultado
  -- registra quem o iniciou.
  IF NOT EXISTS (SELECT 1 FROM public.user_profiles WHERE id = v_initiator AND active) THEN
    v_actor := public._import_effect_system_actor();
    IF v_actor IS NULL THEN
      RAISE EXCEPTION 'Iniciador desativado e nenhuma conta de sistema ativa.' USING ERRCODE = '42501';
    END IF;
    v_as_system := true;
  END IF;
  v_executor := jsonb_build_object('executor', 'import-effects-runner', 'worker_id', p_worker_id,
    'initiator_id', v_initiator)
    || CASE WHEN v_as_system THEN jsonb_build_object('executed_as', v_actor, 'executed_as_system', true,
         'executed_as_reason', 'iniciador desativado') ELSE '{}'::jsonb END;
  PERFORM set_config('request.jwt.claim.sub', v_actor::text, true);

  -- Viagem Cancelada: a operação está selada; o efeito sai sem agir.
  v_voyage_id := public._import_effect_voyage_id(v_effect.effect_kind, v_effect.entity_id);
  IF v_voyage_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.voyages WHERE id = v_voyage_id AND status = 'cancelled') THEN
    RETURN public.complete_import_effect(v_effect.id, p_worker_id, 'superseded',
      jsonb_build_object('reason', 'voyage_cancelled', 'voyage_id', v_voyage_id,
        'executor', 'import-effects-runner', 'worker_id', p_worker_id, 'initiator_id', v_initiator),
      NULL, NULL, NULL);
  END IF;

  -- B/L Cancelado é somente leitura: o efeito pendente dele sai sem agir, em
  -- vez de esbarrar na guarda do B/L e virar bloqueio com Alerta crítico.
  IF v_effect.effect_kind <> 'granite_billing'
     AND EXISTS (SELECT 1 FROM public.bls WHERE id = v_effect.entity_id AND cancelled_at IS NOT NULL) THEN
    -- Âncora de Demurrage cancelado (211): a emissão passa ao âncora que restou
    -- em cada grupo dos B/Ls ativos que dividiam container com ele.
    IF v_effect.effect_kind = 'demurrage_billing' THEN
      FOR v_anchor IN
        SELECT DISTINCT public.demurrage_group_anchor(other.id)
        FROM public.bls AS cancelled
        JOIN public.bl_containers AS mine ON mine.bl_id = cancelled.id
        JOIN public.bl_containers AS theirs
          ON upper(btrim(theirs.container_number)) = upper(btrim(mine.container_number))
         AND theirs.bl_id <> mine.bl_id
        JOIN public.bls AS other ON other.id = theirs.bl_id
        WHERE cancelled.id = v_effect.entity_id
          AND cancelled.customer_id IS NOT NULL
          AND other.voyage_id = cancelled.voyage_id
          AND other.customer_id = cancelled.customer_id
          AND other.cancelled_at IS NULL
      LOOP
        CONTINUE WHEN v_anchor IS NULL;
        PERFORM public.enqueue_import_effect(
          md5('demurrage_requeue:' || v_effect.id)::uuid, 'demurrage_billing', v_anchor, v_actor, 1, NULL,
          jsonb_build_object('source', 'demurrage_anchor_cancelled',
            'cancelled_bl_id', v_effect.entity_id, 'origin_effect_id', v_effect.id));
        v_requeued := array_append(v_requeued, v_anchor);
      END LOOP;
    END IF;
    RETURN public.complete_import_effect(v_effect.id, p_worker_id, 'superseded',
      jsonb_build_object('reason', 'bl_cancelled', 'bl_id', v_effect.entity_id,
        'executor', 'import-effects-runner', 'worker_id', p_worker_id, 'initiator_id', v_initiator)
      || CASE WHEN cardinality(v_requeued) > 0
           THEN jsonb_build_object('requeued_anchor_bl_ids', to_jsonb(v_requeued)) ELSE '{}'::jsonb END,
      NULL, NULL, NULL);
  END IF;

  CASE v_effect.effect_kind
    WHEN 'physical_flags' THEN
      IF v_effect.entity_id !~ '^[0-9]+$' THEN
        RAISE EXCEPTION 'Viagem inválida no efeito de flags: %.', v_effect.entity_id USING ERRCODE = '22023';
      END IF;
      v_result := public.apply_baplie_physical_flags_atomic(v_effect.entity_id::bigint, NULL, v_actor);
    WHEN 'provisional_charges', 'local_billing' THEN
      v_result := public._run_import_effect_local_charges(v_effect.entity_id, v_actor);
    WHEN 'granite_billing' THEN
      v_result := public._run_import_effect_granite_billing(v_effect.entity_id, v_actor);
    WHEN 'demurrage_billing' THEN
      v_result := public._run_import_effect_demurrage(v_effect.id, v_effect.entity_id, v_actor);
    WHEN 'vehicle_followup' THEN
      v_result := public._run_import_effect_vehicle_followup(v_effect.entity_id, v_actor);
    ELSE
      RAISE EXCEPTION 'effect_kind não suportado: %.', v_effect.effect_kind USING ERRCODE = '0A000';
  END CASE;

  v_result := COALESCE(v_result, '{}'::jsonb) || v_executor;
  IF v_result ? 'business_wait' THEN
    RETURN public._park_import_effect_waiting(v_effect.id, p_worker_id, v_result);
  END IF;
  RETURN public.complete_import_effect(v_effect.id, p_worker_id, 'succeeded', v_result, NULL, NULL, NULL);
EXCEPTION
  WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE, v_error_message = MESSAGE_TEXT;

    v_status := CASE WHEN v_sqlstate IN ('40001', '40P01', '55P03') THEN 'retry_wait' ELSE 'blocked' END;
    v_error_code := CASE
      WHEN v_status = 'retry_wait' THEN 'transient_sql_error'
      WHEN v_sqlstate = '42501' THEN 'authorization_invalid'
      WHEN v_sqlstate = '22023' THEN 'invalid_effect_payload'
      WHEN v_sqlstate = 'P0002' THEN 'effect_domain_missing'
      WHEN v_sqlstate = '0A000' THEN 'unsupported_effect_kind'
      WHEN v_sqlstate LIKE 'P0%' THEN 'effect_domain_refused'
      ELSE 'effect_failed'
    END;
    IF v_status = 'retry_wait' AND v_effect.attempts >= 5 THEN
      v_status := 'blocked';
      v_error_code := 'retry_exhausted';
      v_error_message := 'Numero maximo de tentativas atingido.';
    ELSIF v_status = 'retry_wait' THEN
      v_retry_at := now() + CASE v_effect.attempts
        WHEN 1 THEN interval '1 minute'
        WHEN 2 THEN interval '5 minutes'
        WHEN 3 THEN interval '15 minutes'
        ELSE interval '60 minutes'
      END;
    END IF;

    IF v_effect.id IS NULL THEN RAISE; END IF;

    IF v_status = 'blocked' THEN
      PERFORM public._record_import_effect_blocked_alert(
        v_effect.id, v_effect.effect_kind, v_effect.entity_id, v_error_code, v_error_message);
    END IF;

    RETURN public.complete_import_effect(
      v_effect.id, p_worker_id, v_status,
      COALESCE(v_executor, jsonb_build_object('executor', 'import-effects-runner', 'worker_id', p_worker_id,
        'initiator_id', v_effect.created_by)) || jsonb_build_object('sqlstate', v_sqlstate),
      v_error_code, v_error_message, v_retry_at);
END;
$function$;

CREATE OR REPLACE FUNCTION public._park_import_effect_waiting(p_effect_id bigint, p_worker_id text, p_result jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_row public.import_pending_effects%ROWTYPE;
  v_code text := left(p_result->>'business_wait', 200);
  v_message text := left(COALESCE(p_result->>'wait_message', p_result->>'business_wait'), 2000);
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Executor server-only.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_row FROM public.import_pending_effects WHERE id = p_effect_id FOR UPDATE;
  IF v_row.status IS DISTINCT FROM 'running' OR v_row.leased_by IS DISTINCT FROM p_worker_id THEN
    RAISE EXCEPTION 'Lease do efeito não pertence ao worker.' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.import_effect_attempts(
    effect_id, attempt_no, event_kind, worker_id, status, result, error_code, error_message
  ) VALUES (
    v_row.id, GREATEST(v_row.attempts, 1), 'completed', p_worker_id, 'retry_wait', p_result, v_code, v_message
  );
  UPDATE public.import_pending_effects
     SET status = 'retry_wait',
         attempts = 0,
         lease_until = NULL,
         leased_by = NULL,
         next_attempt_at = now() + interval '1 hour',
         result = p_result,
         last_error_code = v_code,
         last_error_message = v_message,
         updated_at = now()
   WHERE id = v_row.id
   RETURNING * INTO v_row;
  RETURN jsonb_build_object('effect', to_jsonb(v_row), 'idempotent', false, 'business_wait', v_code);
END;
$function$;
