-- 211 — Revisão final da PR 929: Demurrage, datas de container e Viagem
-- Cancelada (achados verificados na revisão final).
--
-- 1. A reconciliação de datas (`_reconcile_demurrage_after_dates`, da 203)
--    trava cada Invoice de Demurrage com FOR UPDATE antes de decidir. Uma baixa
--    (`register_demurrage_payment`) que confirmava primeiro tinha a Invoice
--    paga cancelada e reemitida; agora a decisão usa a linha travada, o UPDATE
--    que cancela só pega a Invoice emitida sem pagamento, e o Alerta só é
--    gravado depois da trava. Na Viagem Cancelada a Invoice é cancelada sem
--    reemissão, como no B/L Cancelado.
-- 2. `_container_demurrage_status` (200) e `_container_free_days` (197) contam
--    pela data de São Paulo, a mesma da Invoice, e não por `current_date` (o
--    banco roda em UTC: das 21h à meia-noite o container ficava em atraso um
--    dia antes).
-- 3. Defesa em profundidade das datas de container: `authenticated` e `anon`
--    não executam mais `update_container_demurrage_dates` (SECURITY INVOKER
--    legada, sem chamador no app nem nas Edge Functions) e o gatilho novo
--    `trg_guard_container_dates_direct_write` recusa (42501) mudar descarga ou
--    devolução em UPDATE direto pelo PostgREST. Os caminhos legítimos são
--    SECURITY DEFINER (`set_container_dates`, planilha de datas, job de status)
--    e rodam como o dono das funções.
-- 4. Datas gravadas em paralelo num container compartilhado não entram mais em
--    deadlock: `_lock_container_date_sets` trava o conjunto inteiro (o próprio
--    container e os de mesmo número na Viagem, de B/L ativo) em ordem de id
--    antes de qualquer trava de linha isolada. Usada por `set_container_dates`
--    (da 210) e `apply_container_dates_atomic_legacy_189` (da 201).
-- 5. Viagem Cancelada não recebe Invoice de Demurrage: `demurrage_invoices`
--    entra em `guard_voyage_cancelled_via_parent` (Viagem pelo B/L) com o
--    gatilho BEFORE INSERT `trg_guard_voyage_cancelled_demurrage_invoices`.
-- 6. No UPDATE, `guard_voyage_cancelled_via_parent` (da 200) também resolve a
--    Viagem pela linha antiga: container (bl_id) e B/L de Granito (manifest_id)
--    não saem da Viagem Cancelada. A exceção só-financeira continua.
-- 7. `reactivate_voyage` (da 089) reabre (`pending`) os efeitos de importação
--    que o cancelamento encerrou (`superseded`, motivo `voyage_cancelled`),
--    salvo quando o mesmo (entity_id, effect_kind) já tem efeito mais novo não
--    encerrado. `process_import_effect` confere o estado atual ao rodar.
-- 8. `process_import_effect` (da 190): o efeito `demurrage_billing` do B/L-âncora
--    cancelado antes de rodar enfileira, por `enqueue_import_effect`, a emissão
--    do âncora que restou em cada grupo dos B/Ls que dividiam container com ele.
--
-- Não reescreve nem apaga linhas existentes. Rollback: reaplicar as definições
-- citadas acima (203, 200, 197, 210, 201, 200, 089, 190), devolver EXECUTE de
-- `update_container_demurrage_dates` a `authenticated`, remover os gatilhos
-- `trg_guard_container_dates_direct_write` e
-- `trg_guard_voyage_cancelled_demurrage_invoices` e as funções
-- `_lock_container_date_sets`, `_voyage_cancelled_parent_voyage_id` e
-- `guard_container_dates_direct_write`.

-- 1. Reconciliação de datas trava a Invoice antes de decidir.
CREATE OR REPLACE FUNCTION public._reconcile_demurrage_after_dates(p_bl_ids text[], p_actor uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_invoice public.demurrage_invoices%ROWTYPE;
  v_invoice_id bigint;
  v_result jsonb := '[]'::jsonb;
  v_reissue jsonb;
  v_previous text := current_setting('vela.demurrage_internal', true);
  v_paid boolean;
  v_negotiated boolean;
BEGIN
  FOR v_invoice_id IN
    SELECT DISTINCT di.id
    FROM unnest(p_bl_ids) AS changed(bl_id)
    JOIN public.demurrage_invoices AS di
      ON di.bl_id = ANY(public.demurrage_group_bl_ids(changed.bl_id) || changed.bl_id)
    WHERE di.status IN ('issued', 'overdue', 'paid')
      AND EXISTS (
        SELECT 1 FROM public.demurrage_invoice_items AS item
        JOIN public.bl_containers AS c ON c.id = item.container_id
        WHERE item.invoice_id = di.id
          AND (c.discharge_date IS DISTINCT FROM item.discharge_date OR c.return_date IS DISTINCT FROM item.return_date)
      )
    ORDER BY di.id
  LOOP
    -- A decisão vale para a linha travada (211): uma baixa que confirmou
    -- depois da leitura acima não tem a Invoice paga cancelada e reemitida.
    SELECT * INTO v_invoice FROM public.demurrage_invoices WHERE id = v_invoice_id FOR UPDATE;
    CONTINUE WHEN NOT FOUND OR v_invoice.status NOT IN ('issued', 'overdue', 'paid');
    CONTINUE WHEN NOT EXISTS (
      SELECT 1 FROM public.demurrage_invoice_items AS item
      JOIN public.bl_containers AS c ON c.id = item.container_id
      WHERE item.invoice_id = v_invoice.id
        AND (c.discharge_date IS DISTINCT FROM item.discharge_date OR c.return_date IS DISTINCT FROM item.return_date)
    );
    v_paid := v_invoice.status = 'paid' OR v_invoice.paid_at IS NOT NULL;
    -- Desconto ou disputa aberta (ADR 0079, decisão 1): houve negociação que o
    -- cálculo não refaz. Como a paga, a Invoice não é reemitida sozinha.
    v_negotiated := NOT v_paid
      AND (COALESCE(v_invoice.discount_value, 0) > 0 OR COALESCE(v_invoice.dispute_open, false));
    PERFORM public.upsert_alert_item(
      'demurrage_invoice_dates_changed', 'demurrage_invoice', v_invoice.id::text,
      format('As datas de container da Invoice de Demurrage %s mudaram depois da emissão%s.',
        v_invoice.doc_number, CASE
          WHEN v_paid THEN ' e ela já tem pagamento: a Régua suspendeu a cobrança'
          WHEN v_negotiated THEN ' e ela tem desconto ou disputa aberta: a Régua suspendeu a cobrança; cancele, gere de novo e refaça o desconto ou responda a disputa'
          ELSE '' END),
      'container-dates',
      jsonb_build_object('invoice_id', v_invoice.id, 'bl_id', v_invoice.bl_id, 'paid', v_paid, 'negotiated', v_negotiated),
      '/demurrage');

    IF v_paid OR v_negotiated THEN
      UPDATE public.demurrage_invoices
         SET dunning_suspended_reason = CASE WHEN v_paid
           THEN 'Datas de container alteradas depois do pagamento; conferir a diferença.'
           ELSE 'Datas de container alteradas em Invoice com desconto ou disputa; reemitir à mão.' END
       WHERE id = v_invoice.id;
      v_result := v_result || jsonb_build_array(jsonb_build_object('invoice_id', v_invoice.id, 'status', 'suspended'));
      CONTINUE;
    END IF;

    -- Sem pagamento: cancela e reemite com as datas atuais (ou só cancela).
    UPDATE public.demurrage_invoices SET status = 'cancelled', updated_at = now()
     WHERE id = v_invoice.id AND status IN ('issued', 'overdue') AND paid_at IS NULL;
    CONTINUE WHEN NOT FOUND;
    INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification)
    VALUES ('demurrage_invoice', v_invoice.id::text, 'status', v_invoice.status, 'cancelled', p_actor, now(),
      'Datas de container alteradas: cancelada para reemissão automática.');
    IF EXISTS (SELECT 1 FROM public.bls WHERE id = v_invoice.bl_id AND cancelled_at IS NOT NULL) THEN
      v_reissue := jsonb_build_object('status', 'bl_cancelled', 'bl_id', v_invoice.bl_id);
    -- Viagem Cancelada não recebe Invoice de Demurrage (211): só cancela.
    ELSIF EXISTS (
      SELECT 1 FROM public.bls AS b JOIN public.voyages AS v ON v.id = b.voyage_id
      WHERE b.id = v_invoice.bl_id AND v.status = 'cancelled'
    ) THEN
      v_reissue := jsonb_build_object('status', 'voyage_cancelled', 'bl_id', v_invoice.bl_id);
    ELSE
      PERFORM set_config('vela.demurrage_internal', 'on', true);
      v_reissue := public.issue_demurrage_invoice_for_bl(v_invoice.bl_id, NULL);
      PERFORM set_config('vela.demurrage_internal', COALESCE(v_previous, ''), true);
    END IF;
    v_result := v_result || jsonb_build_array(jsonb_build_object(
      'invoice_id', v_invoice.id, 'status', 'cancelled', 'reissue', v_reissue));
  END LOOP;

  -- Com as datas de volta às faturadas, a Invoice com desconto ou disputa sai
  -- da suspensão (a paga sai pelo estorno, como na 191).
  UPDATE public.demurrage_invoices AS di
     SET dunning_suspended_reason = NULL
    FROM unnest(p_bl_ids) AS changed(bl_id)
   WHERE di.bl_id = ANY(public.demurrage_group_bl_ids(changed.bl_id) || changed.bl_id)
     AND di.status IN ('issued', 'overdue')
     AND di.paid_at IS NULL
     AND di.dunning_suspended_reason = 'Datas de container alteradas em Invoice com desconto ou disputa; reemitir à mão.'
     AND NOT EXISTS (
       SELECT 1 FROM public.demurrage_invoice_items AS item
       JOIN public.bl_containers AS c ON c.id = item.container_id
       WHERE item.invoice_id = di.id
         AND (c.discharge_date IS DISTINCT FROM item.discharge_date OR c.return_date IS DISTINCT FROM item.return_date)
     );
  RETURN v_result;
END;
$function$;

-- 2. Status e free time contam pela data de São Paulo.
CREATE OR REPLACE FUNCTION public._container_demurrage_status(p_bl_id text, p_container_type text, p_discharge_date date, p_return_date date, p_ownership text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_free integer;
BEGIN
  IF p_return_date IS NOT NULL THEN
    RETURN 'returned';
  END IF;
  IF p_discharge_date IS NULL OR p_ownership = 'SOC' THEN
    RETURN 'within_free_time';
  END IF;
  -- B/L Cancelado ou Viagem Cancelada não corre Demurrage.
  IF EXISTS (
    SELECT 1 FROM public.bls AS b LEFT JOIN public.voyages AS v ON v.id = b.voyage_id
    WHERE b.id = p_bl_id AND (b.cancelled_at IS NOT NULL OR v.status = 'cancelled')
  ) THEN
    RETURN 'within_free_time';
  END IF;
  v_free := public._container_free_days(p_bl_id, p_container_type, p_discharge_date);
  -- ponytail: sem free time cadastrado (tabela ou acordo) não há como dizer que
  -- venceu; o container fica no prazo até a tabela existir.
  -- Dia de São Paulo, como a Invoice (211); a sessão do banco roda em UTC.
  IF v_free IS NOT NULL AND (now() AT TIME ZONE 'America/Sao_Paulo')::date - p_discharge_date > v_free THEN
    RETURN 'overdue';
  END IF;
  RETURN 'within_free_time';
END;
$function$;

CREATE OR REPLACE FUNCTION public._container_free_days(p_bl_id text, p_container_type text, p_discharge_date date)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COALESCE(
    (SELECT b.free_time_override FROM public.bls AS b WHERE b.id = p_bl_id),
    (SELECT a.free_days
       FROM public.customer_demurrage_agreements AS a
       JOIN public.bls AS b ON b.customer_id = a.customer_id
      WHERE b.id = p_bl_id AND a.active = true
        AND p_discharge_date >= a.valid_from
        AND (a.valid_to IS NULL OR p_discharge_date <= a.valid_to)
      ORDER BY a.valid_from DESC, a.id DESC
      LIMIT 1),
    (SELECT r.free_days
       FROM public._active_demurrage_rates((now() AT TIME ZONE 'America/Sao_Paulo')::date) AS r
      WHERE public._demurrage_canonical_type(r.container_type) = public._demurrage_canonical_type(p_container_type)
      ORDER BY r.valid_from DESC, r.id DESC
      LIMIT 1)
  );
$function$;

-- 3. Datas de container só pelas RPCs.
REVOKE EXECUTE ON FUNCTION public.update_container_demurrage_dates(bigint, date, date, text, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.guard_container_dates_direct_write()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- SECURITY INVOKER de propósito: dentro das RPCs (SECURITY DEFINER) o
  -- current_user é o dono da função; só o UPDATE direto do PostgREST chega
  -- aqui como authenticated ou anon.
  IF current_user IN ('authenticated', 'anon')
     AND (NEW.discharge_date IS DISTINCT FROM OLD.discharge_date
          OR NEW.return_date IS DISTINCT FROM OLD.return_date) THEN
    RAISE EXCEPTION 'Descarga e devolução do container são gravadas pela ficha do B/L ou pela planilha de datas.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.guard_container_dates_direct_write() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_container_dates_direct_write ON public.bl_containers;
CREATE TRIGGER trg_guard_container_dates_direct_write
  BEFORE UPDATE OF discharge_date, return_date ON public.bl_containers
  FOR EACH ROW EXECUTE FUNCTION public.guard_container_dates_direct_write();

-- 4. Trava do conjunto de containers de mesmo número, em ordem de id.
CREATE OR REPLACE FUNCTION public._lock_container_date_sets(p_container_ids bigint[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- Mesmo conjunto que `_apply_container_dates_core` escreve: o container e os
  -- de mesmo número na mesma Viagem, de B/L ativo. Travar tudo em ordem de id
  -- antes de qualquer linha isolada evita o deadlock entre duas gravações que
  -- dividem containers (211).
  PERFORM 1
  FROM public.bl_containers AS c
  JOIN public.bls AS b ON b.id = c.bl_id
  WHERE c.id = ANY(p_container_ids)
     OR (b.cancelled_at IS NULL AND EXISTS (
       SELECT 1
       FROM public.bl_containers AS mine
       JOIN public.bls AS mine_bl ON mine_bl.id = mine.bl_id
       WHERE mine.id = ANY(p_container_ids)
         AND upper(btrim(c.container_number)) = upper(btrim(mine.container_number))
         AND b.voyage_id = mine_bl.voyage_id))
  ORDER BY c.id
  FOR UPDATE OF c;
END;
$function$;
REVOKE ALL ON FUNCTION public._lock_container_date_sets(bigint[]) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.set_container_dates(p_container_id bigint, p_discharge_date date, p_return_date date, p_reason text DEFAULT NULL::text, p_keep_discharge boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_old record;
  v_touched text[];
  v_request uuid := gen_random_uuid();
  v_role text := public.current_actor_role();
  v_discharge date := p_discharge_date;
BEGIN
  IF v_actor IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa.' USING ERRCODE = '42501';
  END IF;
  -- O conjunto do container compartilhado antes da linha (211).
  PERFORM public._lock_container_date_sets(ARRAY[p_container_id]);
  SELECT c.id, c.bl_id, c.container_number, c.discharge_date, c.return_date INTO v_old
  FROM public.bl_containers AS c WHERE c.id = p_container_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Container % nao encontrado.', p_container_id USING ERRCODE = 'P0002';
  END IF;
  -- Só a devolução muda (210): a descarga é a gravada, lida sob a trava.
  IF p_keep_discharge THEN
    v_discharge := v_old.discharge_date;
  END IF;
  IF p_return_date IS NOT NULL AND v_discharge IS NOT NULL AND p_return_date < v_discharge THEN
    RAISE EXCEPTION 'Devolução anterior à descarga.' USING ERRCODE = '22023';
  END IF;
  IF p_return_date IS NOT NULL AND v_discharge IS NULL THEN
    RAISE EXCEPTION 'Informe a descarga antes da devolução.' USING ERRCODE = '22023';
  END IF;
  IF ((v_old.discharge_date IS NOT NULL AND v_discharge IS NULL)
      OR (v_old.return_date IS NOT NULL AND p_return_date IS NULL))
     AND v_reason IS NULL THEN
    RAISE EXCEPTION 'Informe o motivo para remover a data.' USING ERRCODE = '22023';
  END IF;

  v_touched := public._apply_container_dates_core(p_container_id, v_discharge, p_return_date, false);

  IF cardinality(v_touched) > 0 THEN
    INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by, justification, actor_role, actor_department)
    VALUES ('bl', v_old.bl_id, 'container_dates',
      jsonb_build_object('container', v_old.container_number, 'discharge_date', v_old.discharge_date, 'return_date', v_old.return_date)::text,
      jsonb_build_object('container', v_old.container_number, 'discharge_date', v_discharge, 'return_date', p_return_date, 'propagated_bl_ids', v_touched)::text,
      v_actor, COALESCE(v_reason, 'Edição das datas do container'), v_role, v_role);
  END IF;

  RETURN jsonb_build_object(
    'container_id', p_container_id,
    'propagated_bl_ids', to_jsonb(v_touched),
    'demurrage', CASE WHEN cardinality(v_touched) > 0 THEN public._after_container_dates(v_request, v_touched, v_actor) ELSE '{}'::jsonb END
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
    RAISE EXCEPTION 'Usuario sem permissao ativa.' USING ERRCODE = '42501';
  END IF;
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'request_id obrigatorio.' USING ERRCODE = '22023';
  END IF;
  IF v_bl_id IS NULL THEN
    RAISE EXCEPTION 'B/L obrigatorio.' USING ERRCODE = '22023';
  END IF;
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'Lote de datas invalido.' USING ERRCODE = '22023';
  END IF;
  v_count := jsonb_array_length(p_rows);
  IF v_count = 0 OR v_count > 500 THEN
    RAISE EXCEPTION 'Lote deve ter entre 1 e 500 linhas.' USING ERRCODE = '22023';
  END IF;

  PERFORM 1 FROM public.bls WHERE id = v_bl_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L % nao encontrado', v_bl_id USING ERRCODE = 'P0002';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_rows)
  LOOP
    IF jsonb_typeof(v_item) <> 'object' THEN
      RAISE EXCEPTION 'Linha de datas invalida.' USING ERRCODE = '22023';
    END IF;
    v_num := upper(btrim(COALESCE(v_item->>'container_number', '')));
    v_discharge := NULLIF(btrim(COALESCE(v_item->>'discharge_date', '')), '');
    v_return := NULLIF(btrim(COALESCE(v_item->>'return_date', '')), '');
    IF v_num = '' THEN
      RAISE EXCEPTION 'Container obrigatorio no B/L %.', v_bl_id USING ERRCODE = '22023';
    END IF;
    IF v_discharge IS NULL OR v_discharge !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR v_discharge::date IS NULL THEN
      RAISE EXCEPTION 'Data de descarga invalida para % no B/L %.', v_num, v_bl_id USING ERRCODE = '22023';
    END IF;
    IF v_return IS NOT NULL AND (v_return !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR v_return::date IS NULL) THEN
      RAISE EXCEPTION 'Data de devolucao invalida para % no B/L %.', v_num, v_bl_id USING ERRCODE = '22023';
    END IF;
    IF v_return IS NOT NULL AND v_return::date < v_discharge::date THEN
      RAISE EXCEPTION 'Devolucao anterior a descarga para % no B/L %.', v_num, v_bl_id USING ERRCODE = '22023';
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
      RAISE EXCEPTION 'Container % nao pertence ao B/L %.', v_num, v_bl_id USING ERRCODE = 'P0002';
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

-- 5 e 6. Viagem Cancelada: Invoice de Demurrage e linha que sai da Viagem.
CREATE OR REPLACE FUNCTION public._voyage_cancelled_parent_voyage_id(p_table text, p_row jsonb)
 RETURNS bigint
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE p_table
    WHEN 'bl_containers' THEN (SELECT voyage_id FROM public.bls WHERE id = p_row->>'bl_id')
    WHEN 'invoice_bls' THEN (SELECT voyage_id FROM public.bls WHERE id = p_row->>'bl_id')
    WHEN 'invoice_receivable_links' THEN (SELECT voyage_id FROM public.bls WHERE id = p_row->>'bl_id')
    WHEN 'customer_communication_bls' THEN (SELECT voyage_id FROM public.bls WHERE id = p_row->>'bl_id')
    WHEN 'demurrage_invoices' THEN (SELECT voyage_id FROM public.bls WHERE id = p_row->>'bl_id')
    -- Avulsa traz a Viagem no cabeçalho; individual, pelo B/L.
    WHEN 'invoices' THEN COALESCE(NULLIF(p_row->>'voyage_id', '')::bigint,
      (SELECT voyage_id FROM public.bls WHERE id = p_row->>'bl_id'))
    WHEN 'granite_bls' THEN (SELECT voyage_id FROM public.granite_manifests WHERE id = (p_row->>'manifest_id')::uuid)
    WHEN 'customer_communications' THEN NULLIF(p_row->>'anchor_voyage_id', '')::bigint
  END;
$function$;
REVOKE ALL ON FUNCTION public._voyage_cancelled_parent_voyage_id(text, jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.guard_voyage_cancelled_via_parent()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_row jsonb := to_jsonb(CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END);
  v_voyage_id bigint;
  v_old_voyage_id bigint;
BEGIN
  v_voyage_id := public._voyage_cancelled_parent_voyage_id(TG_TABLE_NAME, v_row);
  -- No UPDATE, a Viagem da linha antiga também conta (211): a linha não sai
  -- da Viagem Cancelada trocando de B/L ou de manifesto.
  IF TG_OP = 'UPDATE' THEN
    v_old_voyage_id := public._voyage_cancelled_parent_voyage_id(TG_TABLE_NAME, to_jsonb(OLD));
    IF v_old_voyage_id IS NOT NULL AND v_old_voyage_id IS DISTINCT FROM v_voyage_id
       AND EXISTS (SELECT 1 FROM public.voyages WHERE id = v_old_voyage_id AND status = 'cancelled')
       AND NOT EXISTS (SELECT 1 FROM public.voyages WHERE id = v_voyage_id AND status = 'cancelled') THEN
      v_voyage_id := v_old_voyage_id;
    END IF;
  END IF;
  IF v_voyage_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.voyages WHERE id = v_voyage_id AND status = 'cancelled') THEN
    -- Granito: só o status de cobrança (190). Container: só o status de
    -- Demurrage, que o gatilho da 197 recalcula (200).
    IF TG_OP = 'UPDATE' AND TG_TABLE_NAME IN ('granite_bls', 'bl_containers') THEN
      IF public._voyage_cancelled_financial_only(TG_TABLE_NAME, to_jsonb(OLD), to_jsonb(NEW)) THEN
        RETURN NEW;
      END IF;
    END IF;
    RAISE EXCEPTION 'Viagem % cancelada: operação selada e somente leitura.', v_voyage_id USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$function$;

DROP TRIGGER IF EXISTS trg_guard_voyage_cancelled_demurrage_invoices ON public.demurrage_invoices;
CREATE TRIGGER trg_guard_voyage_cancelled_demurrage_invoices
  BEFORE INSERT ON public.demurrage_invoices
  FOR EACH ROW EXECUTE FUNCTION public.guard_voyage_cancelled_via_parent();

-- 7. Reativar a Viagem reabre os efeitos encerrados pelo cancelamento.
CREATE OR REPLACE FUNCTION public.reactivate_voyage(p_voyage_id bigint, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_status text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Somente o Administrativo reativa viagem.' USING ERRCODE = '42501';
  END IF;
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'Informe o motivo da reativação.' USING ERRCODE = '22023';
  END IF;
  SELECT status INTO v_status FROM public.voyages WHERE id = p_voyage_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Viagem % não encontrada.', p_voyage_id USING ERRCODE = 'P0002';
  END IF;
  IF v_status IS DISTINCT FROM 'cancelled' THEN
    RAISE EXCEPTION 'Viagem % não está cancelada.', p_voyage_id USING ERRCODE = '22023';
  END IF;

  PERFORM set_config('vela.allow_voyage_reactivate', 'on', true);
  UPDATE public.voyages SET status = 'active' WHERE id = p_voyage_id;
  PERFORM set_config('vela.allow_voyage_reactivate', 'off', true);
  PERFORM public.refresh_voyage_status_from_terminal_scales(p_voyage_id);

  -- Efeitos que o cancelamento encerrou voltam à fila (211). Só o mais novo de
  -- cada (entity_id, effect_kind), e nenhum que já tenha efeito mais novo não
  -- encerrado. O executor confere o estado atual ao rodar.
  WITH closed AS (
    SELECT e.id, e.entity_id, e.effect_kind
    FROM public.import_pending_effects AS e
    WHERE e.status = 'superseded'
      AND e.result->>'reason' = 'voyage_cancelled'
      AND public._import_effect_voyage_id(e.effect_kind, e.entity_id) = p_voyage_id
  ), reopen AS (
    SELECT DISTINCT ON (closed.entity_id, closed.effect_kind) closed.id
    FROM closed
    WHERE NOT EXISTS (
      SELECT 1 FROM public.import_pending_effects AS newer
      WHERE newer.entity_id = closed.entity_id
        AND newer.effect_kind = closed.effect_kind
        AND newer.id > closed.id
        AND newer.status <> 'superseded'
    )
    ORDER BY closed.entity_id, closed.effect_kind, closed.id DESC
  )
  UPDATE public.import_pending_effects AS e
     SET status = 'pending', next_attempt_at = now(), lease_until = NULL, leased_by = NULL,
         result = COALESCE(e.result, '{}'::jsonb) || jsonb_build_object(
           'reopened_on_reactivation', jsonb_build_object('voyage_id', p_voyage_id, 'at', now())),
         updated_at = now()
    FROM reopen
   WHERE e.id = reopen.id;

  INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  VALUES ('voyages', p_voyage_id::text, 'status', 'cancelled', 'active', auth.uid(), 'Reativação de viagem: ' || v_reason);
  RETURN jsonb_build_object('voyage_id', p_voyage_id, 'reactivated', true);
END;
$function$;

-- 8. Âncora de Demurrage cancelado passa a emissão ao âncora que restou.
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
    RAISE EXCEPTION 'Efeito % nao encontrado.', p_effect_id USING ERRCODE = 'P0002';
  END IF;

  IF v_effect.status IN ('succeeded', 'blocked', 'superseded') THEN
    RETURN jsonb_build_object('effect', to_jsonb(v_effect), 'idempotent', true);
  END IF;
  IF v_effect.status IS DISTINCT FROM 'running' OR v_effect.leased_by IS DISTINCT FROM p_worker_id THEN
    RAISE EXCEPTION 'Lease do efeito nao pertence ao worker.' USING ERRCODE = '42501';
  END IF;
  IF v_effect.lease_until IS NULL OR v_effect.lease_until <= now() THEN
    RAISE EXCEPTION 'Lease do efeito expirou.' USING ERRCODE = '40001';
  END IF;
  IF v_effect.created_by IS NULL THEN
    RAISE EXCEPTION 'Efeito sem iniciador validado.' USING ERRCODE = '42501';
  END IF;

  v_actor := v_effect.created_by;
  PERFORM set_config('request.jwt.claim.sub', v_actor::text, true);

  -- Viagem Cancelada: a operação está selada; o efeito sai sem agir.
  v_voyage_id := public._import_effect_voyage_id(v_effect.effect_kind, v_effect.entity_id);
  IF v_voyage_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.voyages WHERE id = v_voyage_id AND status = 'cancelled') THEN
    RETURN public.complete_import_effect(v_effect.id, p_worker_id, 'superseded',
      jsonb_build_object('reason', 'voyage_cancelled', 'voyage_id', v_voyage_id,
        'executor', 'import-effects-runner', 'worker_id', p_worker_id, 'initiator_id', v_actor),
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
        'executor', 'import-effects-runner', 'worker_id', p_worker_id, 'initiator_id', v_actor)
      || CASE WHEN cardinality(v_requeued) > 0
           THEN jsonb_build_object('requeued_anchor_bl_ids', to_jsonb(v_requeued)) ELSE '{}'::jsonb END,
      NULL, NULL, NULL);
  END IF;

  CASE v_effect.effect_kind
    WHEN 'physical_flags' THEN
      IF v_effect.entity_id !~ '^[0-9]+$' THEN
        RAISE EXCEPTION 'Viagem invalida no efeito de flags: %.', v_effect.entity_id USING ERRCODE = '22023';
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
      RAISE EXCEPTION 'effect_kind nao suportado: %.', v_effect.effect_kind USING ERRCODE = '0A000';
  END CASE;

  v_result := COALESCE(v_result, '{}'::jsonb) || jsonb_build_object(
    'executor', 'import-effects-runner', 'worker_id', p_worker_id, 'initiator_id', v_actor);
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
      jsonb_build_object('executor', 'import-effects-runner', 'worker_id', p_worker_id,
        'initiator_id', v_effect.created_by, 'sqlstate', v_sqlstate),
      v_error_code, v_error_message, v_retry_at);
END;
$function$;
