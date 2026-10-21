-- 379: falha de cálculo das Taxas Locais recusa a gravação (ADR 0094, B3).
--
-- Problema: o cálculo que falhava (câmbio ausente com linha em dólar, usuário
-- inativo) era engolido em vários caminhos: o arquivo de B/L gravava e
-- enfileirava o efeito `provisional_charges`; a Base de Clientes, a troca de
-- Cliente e o recálculo da base no fim da transação (ficha, Revisão,
-- importação) só deixavam rastro; o vínculo de Cliente abria
-- `billing_calculation_blocked` (373); o Manifesto BB calculava depois da
-- gravação, no navegador, e ignorava a falha. O B/L ficava gravado sem preço.
--
-- Mudança: todo caminho que calcula recusa a gravação inteira, com a mensagem
-- "Taxas Locais do B/L X não calculadas: <motivo>". O Manifesto BB (e o B/L
-- avulso, que passa por ele) calcula dentro da gravação. B/L sem tabela não é
-- falha: o cálculo termina em espera ("Aguardando tabela de cobrança") e a
-- gravação segue. A 377 continua reabrindo os efeitos já bloqueados.
--
-- A troca para consignatário não cadastrado em B/L não faturado deixa de ser
-- tratada como de B/L faturado só porque o B/L já tem recebível calculado
-- (ADR 0093, decisão 13): com o cálculo agora na gravação do Manifesto BB,
-- todo B/L novo nasce com recebível.
--
-- Não altera nem apaga linhas existentes.

CREATE OR REPLACE FUNCTION public._raise_local_charge_failure(p_bl_id text, p_sqlstate text, p_message text)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'Taxas Locais do B/L % não calculadas: %. Nada foi gravado: corrija e grave de novo.', p_bl_id,
    regexp_replace(coalesce(p_message, 'falha desconhecida'), '^Taxas Locais do B/L [^:]+ não calculadas: |\. Nada foi gravado: corrija e grave de novo\.$', '', 'g')
    USING ERRCODE = CASE WHEN coalesce(p_sqlstate, '') ~ '^[0-9A-Z]{5}$' THEN p_sqlstate ELSE 'P0001' END;
END;
$$;
REVOKE ALL ON FUNCTION public._raise_local_charge_failure(text, text, text) FROM PUBLIC, anon, authenticated;

-- 373: o vínculo de Cliente recusa em vez de abrir o Alerta.
CREATE OR REPLACE FUNCTION public.sync_receivable_on_bl_customer_link()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF COALESCE(NEW.financial_status, 'pending') = 'cancelled' OR NEW.cancelled_at IS NOT NULL THEN
    RETURN NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.charge_calculations cc
    WHERE cc.bl_id = NEW.id
      AND COALESCE(cc.status, 'calculated') IN ('calculated', 'reviewed', 'ready_for_billing')
  ) THEN
    RETURN NULL;
  END IF;
  IF cardinality(public._live_local_invoice_ids_for_bl(NEW.id)) > 0 THEN
    RETURN NULL;
  END IF;
  BEGIN
    IF COALESCE(NEW.financial_status, 'pending') = 'pending' THEN
      PERFORM public.calculate_bl_local_charges(NEW.id, auth.uid(), true);
    ELSE
      PERFORM public.sync_local_charge_receivable(NEW.id);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    PERFORM public._raise_local_charge_failure(NEW.id, SQLSTATE, SQLERRM);
  END;
  RETURN NULL;
END;
$$;

-- Manifesto BB e B/L avulso: o cálculo entra na gravação.
CREATE OR REPLACE FUNCTION public.import_breakbulk_manifest_transactional(p_filename text, p_voyage_id bigint, p_uploaded_by uuid, p_total_bls integer, p_bls jsonb, p_items jsonb, p_errors jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_result jsonb;
  v_bl text;
BEGIN
  PERFORM public._set_import_context('Manifesto BB', p_voyage_id, NULL);
  v_result := public.import_breakbulk_manifest_transactional_legacy_189(p_filename, p_voyage_id, p_uploaded_by, p_total_bls, p_bls, p_items, p_errors);
  FOR v_bl IN
    SELECT b.id FROM public.bls b
    -- B/L novo ou alterado; o idêntico só se nunca foi calculado.
    WHERE (b.id IN (SELECT jsonb_array_elements_text(coalesce(v_result->'inserted_bl_ids', '[]'::jsonb) || coalesce(v_result->'updated_bl_ids', '[]'::jsonb)))
           OR (b.id IN (SELECT r->>'id' FROM jsonb_array_elements(coalesce(p_bls, '[]'::jsonb)) r)
               AND coalesce(b.charge_status, 'not_calculated') = 'not_calculated'))
      AND b.cancelled_at IS NULL AND coalesce(b.financial_status, 'pending') = 'pending'
      AND cardinality(public._live_local_invoice_ids_for_bl(b.id)) = 0
    ORDER BY b.id
  LOOP
    BEGIN
      PERFORM public.calculate_bl_local_charges(v_bl, p_uploaded_by, true);
    EXCEPTION WHEN OTHERS THEN
      PERFORM public._raise_local_charge_failure(v_bl, SQLSTATE, SQLERRM);
    END;
  END LOOP;
  RETURN v_result;
END $function$;

CREATE OR REPLACE FUNCTION public.import_bl_freight_with_metadata_legacy_189(p_bls jsonb, p_changed_by uuid, p_batch jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_result jsonb;
  v_batch_id bigint := NULL;
  v_filename text;
  v_voyage_id bigint;
  v_cargo_mode text := 'container';
  v_total_bls integer;
  v_bl_id text;
  v_mismatch integer := 0;
  v_updated integer := 0;
  v_action_id uuid := gen_random_uuid();
  v_item jsonb;
  v_physical_effect jsonb;
  v_physical_effect_id bigint;
  v_calc_errors jsonb := '[]'::jsonb;
  v_batch_containers jsonb;
BEGIN
  IF v_actor IS NULL OR NOT public.is_active_user() OR p_changed_by IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa.' USING ERRCODE = '42501';
  END IF;
  IF p_bls IS NULL OR jsonb_typeof(p_bls) <> 'array' OR jsonb_array_length(p_bls) = 0 THEN
    RAISE EXCEPTION 'Nenhum B/L informado.' USING ERRCODE = '22023';
  END IF;

  v_result := public.import_bl_freight_transactional(p_bls, p_changed_by);

  -- O batch e opcional (ADR 0017): mesmo no B/L avulso o calculo inicial
  -- deve acontecer nesta mesma operacao, sem depender de worker offline.
  IF p_batch IS NOT NULL THEN
    v_filename := NULLIF(btrim(COALESCE(p_batch->>'filename', '')), '');
    v_voyage_id := NULLIF(btrim(COALESCE(p_batch->>'voyage_id', '')), '')::bigint;
    v_cargo_mode := COALESCE(NULLIF(btrim(COALESCE(p_batch->>'cargo_mode', '')), ''), 'container');
    IF v_filename IS NULL OR v_voyage_id IS NULL THEN
      RAISE EXCEPTION 'Batch invalido: filename e voyage_id obrigatorios.' USING ERRCODE = '22023';
    END IF;
    IF v_cargo_mode NOT IN ('container', 'carga_solta') THEN
      RAISE EXCEPTION 'cargo_mode de batch invalido.' USING ERRCODE = '22023';
    END IF;

    PERFORM 1 FROM public.voyages WHERE id = v_voyage_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Viagem % nao encontrada', v_voyage_id USING ERRCODE = 'P0002';
    END IF;

    SELECT count(*) INTO v_mismatch
    FROM jsonb_array_elements(p_bls) AS item
    WHERE (item->>'voyage_id')::bigint IS DISTINCT FROM v_voyage_id;
    IF v_mismatch > 0 THEN
      RAISE EXCEPTION 'Batch da viagem % com B/L de outra viagem.', v_voyage_id USING ERRCODE = '22023';
    END IF;

    v_total_bls := jsonb_array_length(p_bls);

    INSERT INTO public.import_batches(
      filename, voyage_id, cargo_mode, uploaded_by, status, total_bls, total_containers
    ) VALUES (
      v_filename, v_voyage_id, v_cargo_mode, v_actor, 'completed', v_total_bls, NULL
    ) RETURNING id INTO v_batch_id;

    UPDATE public.bls AS b
      SET batch_id = v_batch_id
      FROM jsonb_array_elements(p_bls) AS item
      WHERE b.id = item->>'id' AND b.voyage_id = v_voyage_id;
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated <> v_total_bls THEN
      RAISE EXCEPTION 'Vinculo de batch falhou: % de % B/Ls vinculados.', v_updated, v_total_bls USING ERRCODE = 'P0002';
    END IF;

    -- Migration 178: sem efeito `physical_flags`; as flags do lote são
    -- aplicadas logo abaixo, na mesma transação.

    -- Baplie soberano em qualquer ordem (migration 118): se o Baplie da
    -- viagem ja existe, as flags fisicas valem antes do calculo inicial
    -- abaixo; o runner do efeito acima nao e pre-requisito.
    -- Migration 150: só os contêineres deste lote (sem filtro a função varre
    -- a viagem inteira, ~3 s numa viagem de ~500 B/Ls).
    SELECT jsonb_agg(DISTINCT upper(btrim(container->>'container_number')))
      INTO v_batch_containers
      FROM jsonb_array_elements(p_bls) AS item,
           jsonb_array_elements(COALESCE(item->'containers', '[]'::jsonb)) AS container
      WHERE NULLIF(btrim(COALESCE(container->>'container_number', '')), '') IS NOT NULL;
    IF v_batch_containers IS NOT NULL THEN
      PERFORM public.apply_baplie_physical_flags_atomic(v_voyage_id, v_batch_containers, v_actor);
    END IF;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_bls)
  LOOP
    -- Preserva o ID exato que foi persistido em public.bls
    v_bl_id := v_item->>'id';
    CONTINUE WHEN v_bl_id IS NULL OR btrim(v_bl_id) = '';
    -- B/L faturado não é recalculado aqui (migration 175, M02): a fatura
    -- emitida segue a ADR 0077 pela base capturada na própria importação.
    -- Recalcular só devolvia "recalculo bloqueado" e enfileirava
    -- provisional_charges em toda reimportação idêntica.
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM public.bls
      WHERE id = v_bl_id AND COALESCE(financial_status, 'pending') IN ('invoiced', 'paid')
    ) OR cardinality(public._live_local_invoice_ids_for_bl(v_bl_id)) > 0;

    -- ADR 0094, B3: falha de cálculo recusa o arquivo inteiro, com o B/L e o
    -- que falta (antes: rastro e efeito `provisional_charges` de recuperação).
    BEGIN
      PERFORM public.calculate_bl_local_charges(v_bl_id, v_actor, true);
    EXCEPTION WHEN OTHERS THEN
      PERFORM public._raise_local_charge_failure(v_bl_id, SQLSTATE, SQLERRM);
    END;
  END LOOP;

  RETURN jsonb_build_object('result', v_result, 'batch_id', v_batch_id, 'calculation_errors', v_calc_errors);
END;
$function$;

CREATE OR REPLACE FUNCTION public.apply_customer_base_row_atomic_legacy_189(p_cnpj text, p_name text, p_trade_name text, p_address text, p_city text, p_state text, p_zip text, p_emails jsonb, p_changed_by uuid, p_confirm_name_change boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_cnpj text := NULLIF(btrim(COALESCE(p_cnpj, '')), '');
  v_name text := NULLIF(btrim(COALESCE(p_name, '')), '');
  v_customer_id bigint;
  v_created boolean := false;
  v_email text;
  v_norm text;
  v_seen text[] := ARRAY[]::text[];
  v_contacts_created integer := 0;
  v_bls_linked integer := 0;
  v_current_name text;
  v_linked text[];
  v_bl text;
  v_consignees text[];
  v_consignee text;
  v_previous_batch text;
BEGIN
  IF v_actor IS NULL OR NOT public.is_active_user() OR p_changed_by IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa.' USING ERRCODE = '42501';
  END IF;
  IF v_cnpj IS NULL OR v_name IS NULL THEN
    RAISE EXCEPTION 'CNPJ e razao social obrigatorios.' USING ERRCODE = '22023';
  END IF;
  IF p_emails IS NULL OR jsonb_typeof(p_emails) <> 'array' OR jsonb_array_length(p_emails) = 0 THEN
    RAISE EXCEPTION 'Ao menos um e-mail obrigatorio.' USING ERRCODE = '22023';
  END IF;

  -- Lock por cliente: serializa concorrentes do mesmo CNPJ.
  SELECT id INTO v_customer_id FROM public.customers WHERE cnpj_cpf = v_cnpj FOR UPDATE;

  -- Razão social diferente da gravada pede confirmação (ADR 0078, item 24).
  IF FOUND THEN
    SELECT name INTO v_current_name FROM public.customers WHERE id = v_customer_id;
    IF upper(btrim(regexp_replace(COALESCE(v_current_name, ''), '[^[:alnum:]]+', ' ', 'g'))) <> upper(btrim(regexp_replace(v_name, '[^[:alnum:]]+', ' ', 'g')))
       AND NOT COALESCE(p_confirm_name_change, false) THEN
      RAISE EXCEPTION 'Razão social diferente da cadastrada (% → %): confirme a troca.', btrim(v_current_name), v_name
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers(
      cnpj_cpf, name, trade_name, address, city, state, zip, notes, pending_balance
    ) VALUES (
      v_cnpj, v_name,
      NULLIF(btrim(COALESCE(p_trade_name, '')), ''),
      NULLIF(btrim(COALESCE(p_address, '')), ''),
      NULLIF(btrim(COALESCE(p_city, '')), ''),
      NULLIF(upper(btrim(COALESCE(p_state, ''))), ''),
      NULLIF(btrim(COALESCE(p_zip, '')), ''),
      NULL, 0
    ) RETURNING id INTO v_customer_id;
    v_created := true;
  ELSE
    UPDATE public.customers
      SET name = v_name,
          trade_name = COALESCE(NULLIF(btrim(COALESCE(p_trade_name, '')), ''), trade_name),
          address = COALESCE(NULLIF(btrim(COALESCE(p_address, '')), ''), address),
          city = COALESCE(NULLIF(btrim(COALESCE(p_city, '')), ''), city),
          state = COALESCE(NULLIF(upper(btrim(COALESCE(p_state, ''))), ''), state),
          zip = COALESCE(NULLIF(btrim(COALESCE(p_zip, '')), ''), zip),
          updated_at = now()
      WHERE id = v_customer_id;
  END IF;

  -- Bases anteriores podiam ter um principal sem e-mail. Ele não satisfaz o
  -- contrato atual; a transação só termina depois que algum e-mail elegível
  -- assume a principalidade.
  UPDATE public.customer_contacts AS cc
  SET is_primary = false,
      updated_at = now()
  WHERE cc.customer_id = v_customer_id
    AND cc.is_primary = true
    AND cc.deactivated_at IS NULL
    AND cc.email_normalized IS NULL;

  -- Contatos: valida formato e duplicata no envio; existente e no-op.
  -- O primeiro e-mail elegível assume a principalidade se ainda não houver
  -- um principal ativo com e-mail; a decisão é reavaliada a cada iteração.
  FOR v_email IN SELECT value #>> '{}' FROM jsonb_array_elements(p_emails)
  LOOP
    v_norm := lower(NULLIF(btrim(COALESCE(v_email, '')), ''));
    IF v_norm IS NULL OR v_norm !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
      RAISE EXCEPTION 'E-mail invalido para o cliente %: %', v_cnpj, COALESCE(v_email, '') USING ERRCODE = '22023';
    END IF;
    IF v_norm = ANY (v_seen) THEN
      RAISE EXCEPTION 'E-mail duplicado no envio: %', v_norm USING ERRCODE = '23505';
    END IF;
    v_seen := array_append(v_seen, v_norm);

    -- Se o endereço já existia como adicional, promovê-lo também corrige
    -- clientes antigos que chegaram sem principal na base cadastral. Um
    -- contato desativado com o mesmo e-mail deve ser reativado; deixá-lo
    -- fora do INSERT abaixo faria o índice único tratar a linha histórica
    -- como duplicata sem criar um principal ativo.
    UPDATE public.customer_contacts AS cc
    SET deactivated_at = NULL,
        is_primary = NOT EXISTS (
          SELECT 1
          FROM public.customer_contacts AS primary_contact
          WHERE primary_contact.customer_id = v_customer_id
            AND primary_contact.is_primary = true
            AND primary_contact.deactivated_at IS NULL
            AND primary_contact.email_normalized IS NOT NULL
        ),
        updated_at = now()
    WHERE cc.customer_id = v_customer_id
      AND cc.email_normalized = v_norm;

    INSERT INTO public.customer_contacts (customer_id, name, email, purpose, is_primary)
    SELECT
      v_customer_id,
      v_name,
      v_norm,
      'financeiro',
      NOT EXISTS (
        SELECT 1
        FROM public.customer_contacts AS cc
        WHERE cc.customer_id = v_customer_id
          AND cc.is_primary = true
          AND cc.deactivated_at IS NULL
          AND cc.email_normalized IS NOT NULL
      )
    WHERE NOT EXISTS (
      SELECT 1 FROM public.customer_contacts AS cc
      WHERE cc.customer_id = v_customer_id
        AND cc.deactivated_at IS NULL
        AND lower(btrim(COALESCE(cc.email, ''))) = v_norm
    );
    IF FOUND THEN
      v_contacts_created := v_contacts_created + 1;
    END IF;
  END LOOP;

  -- Vínculo retroativo (ADR 0078, item 24): só B/Ls pendentes de Cliente com o
  -- mesmo CNPJ, nunca o rejeitado na Revisão (que recebe o Cliente à mão) nem o
  -- de Viagem cancelada, que é somente leitura: o UPDATE cairia em
  -- `trg_guard_voyage_cancelled_bls` (42501) e derrubaria a linha do Cliente
  -- (V9). A prévia (`compareCustomerBaseWithExisting`) usa o mesmo filtro.
  --
  -- Lote (170): o gatilho de linha dos Alertas fica calado enquanto o vínculo e
  -- a Revisão mudam; o Alerta é reconciliado uma vez no fim.
  v_previous_batch := current_setting('vela.bl_review_batch', true);
  PERFORM set_config('vela.bl_review_batch', 'on', true);
  WITH linked AS (
    UPDATE public.bls AS b
      SET customer_id = v_customer_id,
          customer_reconciliation_status = 'matched_document'
      WHERE b.manifest_customer_cnpj_cpf = v_cnpj
        AND b.customer_id IS NULL
        AND b.cancelled_at IS NULL
        AND COALESCE(b.customer_reconciliation_status, 'missing_customer') <> 'rejected'
        AND NOT EXISTS (
          SELECT 1 FROM public.voyages AS v
          WHERE v.id = b.voyage_id AND v.status = 'cancelled'
        )
      RETURNING b.id, b.consignee
  )
  SELECT array_agg(id ORDER BY id), array_agg(DISTINCT consignee)
    INTO v_linked, v_consignees
  FROM linked;
  v_bls_linked := COALESCE(cardinality(v_linked), 0);

  IF v_bls_linked > 0 THEN
    FOREACH v_bl IN ARRAY v_linked LOOP
      INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
      VALUES ('bl', v_bl, 'customer_id', NULL, v_customer_id::text, v_actor, 'Vínculo por documento pela Base de Clientes');
    END LOOP;
    -- O gate da importação captura o contato do manifesto, mas só acrescenta
    -- pendências. Quem libera a Revisão é a dona da regra (V1):
    -- `recompute_bl_review_status` (168) tira a nota "Pendencias de
    -- importacao" velha e devolve o B/L a `reviewed` quando não sobra
    -- pendência real; com pendência real (ex.: Portal não provisionado), fica
    -- só ela. A fila de Reconciliação de Cliente acompanha o vínculo.
    PERFORM public.apply_bl_review_gate_after_import(v_linked, v_actor);
    FOREACH v_bl IN ARRAY v_linked LOOP
      PERFORM public.recompute_bl_review_status(v_bl);
      PERFORM public.sync_customer_reconciliation_queue_for_bl(v_bl);
    END LOOP;
  END IF;
  PERFORM set_config('vela.bl_review_batch', COALESCE(NULLIF(v_previous_batch, ''), 'off'), true);

  IF v_bls_linked > 0 THEN
    -- Um Alerta por Cliente e um por consignatário que deixou de estar sem
    -- Cliente, já com a contagem final (como a 168 e a 170).
    PERFORM public.reconcile_customer_bl_review_alerts(v_customer_id, NULL, 'customer_base_link');
    FOREACH v_consignee IN ARRAY v_consignees LOOP
      PERFORM public.reconcile_customer_bl_review_alerts(NULL, v_consignee, 'customer_base_link');
    END LOOP;
    -- O faturamento segue: com o Cliente, as Taxas Locais são calculadas.
    FOREACH v_bl IN ARRAY v_linked LOOP
      BEGIN
        PERFORM public.calculate_bl_local_charges(v_bl, v_actor, true);
      EXCEPTION WHEN OTHERS THEN
        -- ADR 0094, B3: a linha da Base é recusada inteira.
        PERFORM public._raise_local_charge_failure(v_bl, SQLSTATE, SQLERRM);
      END;
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'customer_id', v_customer_id,
    'created', v_created,
    'contacts_created', v_contacts_created,
    'bls_linked', v_bls_linked,
    'linked_bl_ids', to_jsonb(COALESCE(v_linked, ARRAY[]::text[]))
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.relink_bl_customer_legacy_070(p_bl_id text, p_customer_id bigint, p_changed_by uuid, p_reason text DEFAULT 'Troca de consignatario na reimportacao do B/L'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bl public.bls%ROWTYPE;
  v_blockers TEXT[] := ARRAY[]::TEXT[];
  v_invoice RECORD;
  v_moved_invoices TEXT[] := ARRAY[]::TEXT[];
  v_has_financials BOOLEAN;
  v_settled_receivables INTEGER;
  v_status TEXT;
  v_calculation_error TEXT;
BEGIN
  SELECT * INTO v_bl FROM public.bls WHERE id = p_bl_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('bl_id', p_bl_id, 'applied', false, 'blockers', ARRAY['B/L nao encontrado.']);
  END IF;

  IF v_bl.customer_id IS NOT DISTINCT FROM p_customer_id THEN
    RETURN jsonb_build_object('bl_id', p_bl_id, 'applied', false, 'blockers', ARRAY[]::TEXT[], 'unchanged', true);
  END IF;

  IF p_customer_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.customers WHERE id = p_customer_id) THEN
    RETURN jsonb_build_object(
      'bl_id', p_bl_id,
      'applied', false,
      'blockers', ARRAY['Cliente de destino nao existe.']
    );
  END IF;

  FOR v_invoice IN
    SELECT
      i.id,
      i.invoice_number,
      i.status,
      i.total_paid_brl,
      (SELECT COUNT(*) FROM public.invoice_bls AS ib2 WHERE ib2.invoice_id = i.id) AS bl_count
    FROM public.invoice_bls AS ib
    JOIN public.invoices AS i ON i.id = ib.invoice_id
    WHERE ib.bl_id = p_bl_id
      AND i.status NOT IN ('cancelled', 'obsolete')
    ORDER BY i.id
  LOOP
    IF v_invoice.bl_count > 1 THEN
      v_blockers := array_append(
        v_blockers,
        format('Fatura %s e consolidada com outros B/Ls.', v_invoice.invoice_number)
      );
    ELSIF COALESCE(v_invoice.total_paid_brl, 0) > 0 OR v_invoice.status = 'paid' THEN
      v_blockers := array_append(
        v_blockers,
        format('Fatura %s ja tem pagamento registrado.', v_invoice.invoice_number)
      );
    END IF;
  END LOOP;

  FOR v_invoice IN
    SELECT id, doc_number, status
    FROM public.demurrage_invoices
    WHERE bl_id = p_bl_id
      AND COALESCE(status, '') NOT IN ('cancelled', 'obsolete')
    ORDER BY id
  LOOP
    IF v_invoice.status = 'paid' THEN
      v_blockers := array_append(
        v_blockers,
        format('Demurrage %s ja esta quitada.', v_invoice.doc_number)
      );
    END IF;
  END LOOP;

  SELECT COUNT(*) INTO v_settled_receivables
  FROM public.bl_receivables
  WHERE bl_id = p_bl_id
    AND status <> 'void'
    AND COALESCE(settled_amount_brl, 0) > 0;

  IF v_settled_receivables > 0 THEN
    v_blockers := array_append(
      v_blockers,
      'Recebivel do B/L ja tem baixa registrada; estorne no razao antes de trocar o cliente.'
    );
  END IF;

  v_has_financials :=
    EXISTS (
      SELECT 1
      FROM public.invoice_bls AS ib
      JOIN public.invoices AS i ON i.id = ib.invoice_id
      WHERE ib.bl_id = p_bl_id AND i.status NOT IN ('cancelled', 'obsolete')
    )
    OR EXISTS (SELECT 1 FROM public.bl_receivables WHERE bl_id = p_bl_id AND status <> 'void')
    OR EXISTS (
      SELECT 1 FROM public.demurrage_invoices
      WHERE bl_id = p_bl_id AND COALESCE(status, '') NOT IN ('cancelled', 'obsolete')
    );

  IF p_customer_id IS NULL AND v_has_financials THEN
    v_blockers := array_append(
      v_blockers,
      'Novo consignatario nao esta cadastrado como cliente; cadastre-o antes de trocar o B/L faturado.'
    );
  END IF;

  IF cardinality(v_blockers) > 0 THEN
    RETURN jsonb_build_object('bl_id', p_bl_id, 'applied', false, 'blockers', v_blockers);
  END IF;

  IF auth.uid() IS NOT NULL
     AND NOT public.is_admin()
     AND p_changed_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'O ator informado deve ser o usuario autenticado.' USING ERRCODE = '42501';
  END IF;

  UPDATE public.bls
  SET
    customer_id = p_customer_id,
    customer_reconciliation_status = CASE WHEN p_customer_id IS NULL THEN 'missing_customer' ELSE 'reconciled' END,
    customer_reconciliation_notes = CASE
      WHEN p_customer_id IS NULL THEN 'Consignatario reimportado ainda sem cliente cadastrado.'
      ELSE 'Cliente trocado pela reimportacao do B/L (novo consignatario).'
    END,
    billing_hold_reason = CASE
      WHEN p_customer_id IS NULL THEN 'Aguardando reconciliacao de cliente antes do faturamento.'
      ELSE NULL
    END
  WHERE id = p_bl_id;

  INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  VALUES ('bl', p_bl_id, 'customer_id', v_bl.customer_id::TEXT, p_customer_id::TEXT, p_changed_by, p_reason);

  IF p_customer_id IS NOT NULL THEN
    FOR v_invoice IN
      SELECT i.id, i.invoice_number, i.customer_id
      FROM public.invoice_bls AS ib
      JOIN public.invoices AS i ON i.id = ib.invoice_id
      WHERE ib.bl_id = p_bl_id
        AND i.status NOT IN ('cancelled', 'obsolete')
        AND i.customer_id IS DISTINCT FROM p_customer_id
      ORDER BY i.id
    LOOP
      UPDATE public.invoices SET customer_id = p_customer_id, updated_at = now() WHERE id = v_invoice.id;
      v_moved_invoices := array_append(v_moved_invoices, v_invoice.invoice_number);

      INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
      VALUES ('invoice', v_invoice.id::TEXT, 'customer_id', v_invoice.customer_id::TEXT, p_customer_id::TEXT, p_changed_by, p_reason);
    END LOOP;

    FOR v_invoice IN
      SELECT id, doc_number, customer_id
      FROM public.demurrage_invoices
      WHERE bl_id = p_bl_id
        AND COALESCE(status, '') NOT IN ('cancelled', 'obsolete')
        AND customer_id IS DISTINCT FROM p_customer_id
      ORDER BY id
    LOOP
      UPDATE public.demurrage_invoices SET customer_id = p_customer_id, updated_at = now() WHERE id = v_invoice.id;
      v_moved_invoices := array_append(v_moved_invoices, v_invoice.doc_number);

      INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
      VALUES ('bl', p_bl_id, format('demurrage_%s_customer_id', v_invoice.doc_number), v_invoice.customer_id::TEXT, p_customer_id::TEXT, p_changed_by, p_reason);
    END LOOP;

    UPDATE public.bl_receivables
    SET customer_id = p_customer_id, updated_at = now()
    WHERE bl_id = p_bl_id
      AND status <> 'void'
      AND customer_id IS DISTINCT FROM p_customer_id;
  END IF;

  PERFORM public.sync_customer_reconciliation_queue_for_bl(p_bl_id);

  -- Se o cliente foi alterado e o B/L ainda esta pendente de faturamento,
  -- recalcula as taxas locais com as condicoes especiais do novo cliente
  -- e atualiza o recebivel correspondente em bl_receivables.
  IF p_customer_id IS NOT NULL AND (v_bl.financial_status IS NULL OR v_bl.financial_status = 'pending') THEN
    BEGIN
      PERFORM public.calculate_bl_local_charges(p_bl_id, p_changed_by, true);
    EXCEPTION WHEN OTHERS THEN
      -- ADR 0094, B3: a troca de Cliente é recusada inteira.
      PERFORM public._raise_local_charge_failure(p_bl_id, SQLSTATE, SQLERRM);
    END;
  END IF;

  SELECT review_status INTO v_status FROM public.bls WHERE id = p_bl_id;

  RETURN jsonb_build_object(
    'bl_id', p_bl_id,
    'applied', true,
    'blockers', ARRAY[]::TEXT[],
    'from_customer_id', v_bl.customer_id,
    'to_customer_id', p_customer_id,
    'moved_invoices', to_jsonb(v_moved_invoices),
    'review_status', v_status,
    'calculation_error', v_calculation_error
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.refresh_unbilled_calculations_at_commit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_ids text[] := ARRAY[]::text[];
  v_numbers text[] := ARRAY[]::text[];
  v_voyages bigint[] := ARRAY[]::bigint[];
  v_id text;
BEGIN
  IF TG_TABLE_NAME = 'bls' THEN
    IF TG_OP <> 'INSERT' THEN v_ids := v_ids || OLD.id; v_voyages := v_voyages || OLD.voyage_id; END IF;
    IF TG_OP <> 'DELETE' THEN v_ids := v_ids || NEW.id; v_voyages := v_voyages || NEW.voyage_id; END IF;
    SELECT coalesce(array_agg(DISTINCT upper(btrim(c.container_number))), ARRAY[]::text[]) INTO v_numbers
    FROM public.bl_containers c WHERE c.bl_id = ANY(v_ids);
  ELSE
    IF TG_OP <> 'INSERT' THEN
      v_ids := v_ids || OLD.bl_id;
      IF TG_TABLE_NAME = 'bl_containers' THEN v_numbers := v_numbers || upper(btrim(OLD.container_number)); END IF;
    END IF;
    IF TG_OP <> 'DELETE' THEN
      v_ids := v_ids || NEW.bl_id;
      IF TG_TABLE_NAME = 'bl_containers' THEN v_numbers := v_numbers || upper(btrim(NEW.container_number)); END IF;
    END IF;
    SELECT coalesce(array_agg(DISTINCT b.voyage_id), ARRAY[]::bigint[]) INTO v_voyages FROM public.bls b WHERE b.id = ANY(v_ids);
  END IF;
  -- Irmãos de container da mesma Viagem. O B/L excluído some da conta (F-06).
  IF cardinality(v_numbers) > 0 THEN
    SELECT v_ids || coalesce(array_agg(DISTINCT c.bl_id), ARRAY[]::text[]) INTO v_ids
    FROM public.bl_containers c JOIN public.bls b ON b.id = c.bl_id
    WHERE upper(btrim(c.container_number)) = ANY(v_numbers)
      AND (cardinality(v_voyages) = 0 OR b.voyage_id = ANY(v_voyages));
  END IF;
  FOR v_id IN SELECT DISTINCT unnest(v_ids) ORDER BY 1 LOOP
    BEGIN
      PERFORM public._refresh_bl_calculation_if_stale(v_id, NULL);
    EXCEPTION WHEN OTHERS THEN
      -- ADR 0094, B3: a alteração (ficha, Revisão, importação) é recusada
      -- inteira quando o recálculo da base falha.
      PERFORM public._raise_local_charge_failure(v_id, SQLSTATE, SQLERRM);
    END;
  END LOOP;
  RETURN NULL;
END;
$function$;

-- Troca de Cliente: só fatura, status faturado ou baixa contam como faturado.
CREATE OR REPLACE FUNCTION public.relink_bl_customer(p_bl_id text, p_customer_id bigint, p_changed_by uuid, p_reason text DEFAULT 'Troca de consignatario na reimportacao do B/L'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE b public.bls%ROWTYPE; blockers text[];
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' AND (auth.uid() IS NULL OR NOT public.is_active_user() OR p_changed_by IS DISTINCT FROM auth.uid()) THEN
   RAISE EXCEPTION 'Sem permissão para trocar o Cliente do B/L.' USING ERRCODE='42501'; END IF;
 IF p_changed_by IS NULL OR NOT EXISTS(SELECT 1 FROM public.user_profiles WHERE id=p_changed_by AND active) THEN RAISE EXCEPTION 'Ator interno ativo obrigatório.' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('bl:'||p_bl_id,0));
 SELECT * INTO b FROM public.bls WHERE id=p_bl_id FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('applied',false,'blockers',ARRAY['B/L não encontrado']); END IF;
 IF b.customer_id IS NOT DISTINCT FROM p_customer_id THEN RETURN jsonb_build_object('applied',false,'unchanged',true,'blockers',ARRAY[]::text[]); END IF;
 blockers:=public._bl_customer_change_cash_blockers(p_bl_id,p_customer_id);
 IF cardinality(blockers)>0 THEN RETURN jsonb_build_object('bl_id',p_bl_id,'applied',false,'blockers',blockers); END IF;
 -- 379 (ADR 0093, decisão 13): faturado é fatura viva, status faturado ou
 -- recebível com baixa; o recebível em aberto de B/L não faturado não segura a
 -- troca (é anulado e nasce de novo com o Cliente vinculado depois).
 IF cardinality(public._live_local_invoice_ids_for_bl(p_bl_id))>0 OR coalesce(b.financial_status,'pending')<>'pending'
    OR EXISTS(SELECT 1 FROM public.bl_receivables WHERE bl_id=p_bl_id AND source='local_charges' AND coalesce(settled_amount_brl,0)>0) THEN
   IF p_customer_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.customers WHERE id=p_customer_id) THEN
     RETURN jsonb_build_object('applied',false,'blockers',ARRAY['Cadastre o Cliente de destino antes de trocar B/L faturado']); END IF;
   UPDATE public.bls SET customer_id=p_customer_id,customer_reconciliation_status='reconciled',
     customer_reconciliation_notes='Cliente alterado por reimportação; financeiro preservado e regularizado pela base do B/L' WHERE id=p_bl_id;
   INSERT INTO public.audit_logs(entity_type,entity_id,field_name,old_value,new_value,changed_by,justification)
    VALUES('bl',p_bl_id,'customer_id',b.customer_id::text,p_customer_id::text,p_changed_by,p_reason);
   RETURN jsonb_build_object('bl_id',p_bl_id,'applied',true,'blockers',ARRAY[]::text[],'financial_policy','refund_original_then_reissue');
 END IF;
 RETURN public.relink_bl_customer_legacy_134(p_bl_id,p_customer_id,p_changed_by,p_reason);
END $function$;
