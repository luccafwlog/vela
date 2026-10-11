-- 192 — Correções da revisão da PR 929 nas importações de Base de Clientes,
-- Granito, Vazios de Importação, omissão de escala e carga solta (ADR 0078,
-- itens 9, 14, 15, 24 e 25). Redefine as funções a partir da definição
-- efetiva depois da 189 (as RPCs de importação, na `_legacy_189`; o invólucro
-- público que grava o contexto do Histórico não muda).
--
-- 1. Base de Clientes (`apply_customer_base_row_atomic_legacy_189`):
--    - V1: o B/L vinculado pela Base continuava em Revisão com a nota velha
--      "Cliente nao vinculado" e o faturamento travado, porque o gate da
--      importação só acrescenta pendências. Agora a Revisão de cada B/L
--      vinculado é reavaliada pela dona da regra (`recompute_bl_review_status`),
--      a fila de Reconciliação de Cliente acompanha
--      (`sync_customer_reconciliation_queue_for_bl`) e os Alertas do Cliente e
--      do consignatário são reconciliados uma vez no fim (lote da 170).
--    - V9: B/L pendente em Viagem cancelada derrubava a linha do Cliente
--      inteira (42501 da guarda de Viagem cancelada); agora fica de fora, como
--      na prévia.
-- 2. Granito (`import_granite_manifest_transactional_legacy_189`), V3: o B/L
--    ausente com Invoice nunca sai, como a confirmação promete; fica e volta em
--    `kept_missing_invoiced_bl_numbers`, sem recusar o arquivo.
-- 3. Vazios de Importação (`import_vazios_importacao_transactional_legacy_189`
--    e `_vazios_importacao_prune`):
--    - V2: com POD BRNVT ou BRREC, o Manifesto (gravado como BRITJ/BRSUA pela
--      181) era apagado logo depois de criado e o espelho ficava órfão; a rota
--      passa a ser comparada por `normalize_port_code` dos dois lados e os ids
--      vêm da própria linha do Manifesto.
--    - V11: o Nº é comparado na forma canônica (`canonical_manifesto_numero`);
--      minúsculas e separadores não escapam mais das checagens.
--    - V10: corrigir o Nº da rota atualiza também o espelho
--      `voyage_route_ce_master`; o Manifesto que sai leva o espelho junto.
-- 4. Omissão de escala (`_attach_new_bl_to_voyage_omission`), B1: o Transbordo
--    do B/L importado depois da omissão aparece no Histórico do B/L.
-- 5. Carga solta (`import_breakbulk_manifest_transactional_legacy_189`):
--    - B3: a fila de Reconciliação de Cliente é sincronizada para todo B/L do
--      arquivo (antes, só nas trocas de Consignatário).
--    - B5: Troca de Consignatário recusada não deixa o Consignee novo com o
--      Cliente antigo.
--    - B6: reimportar com o mesmo Cliente preserva a retenção gravada (ex.:
--      "Acesso ao portal nao provisionado").
--
-- Só redefine funções (CREATE OR REPLACE preserva assinatura, dono e ACL);
-- não reescreve nem apaga linhas existentes.
--
-- Rollback: reaplicar as definições efetivas depois da 189 (as `_legacy_189`
-- vêm da 185, 186, 187 e 174 renomeadas pela 189; `_vazios_importacao_prune`
-- da 187; `_attach_new_bl_to_voyage_omission` da 183).

-- 1. Base de Clientes (V1, V9) ─────────────────────────────────────────────
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
        RAISE NOTICE 'Calculo do B/L % adiado: %', v_bl, SQLERRM;
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

-- 2. Granito (V3) ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.import_granite_manifest_transactional_legacy_189(p_voyage_id bigint, p_vessel_voyage text, p_loading_port text, p_discharge_port text, p_total_bls integer, p_total_weight_kg numeric, p_uploaded_by uuid, p_bls jsonb, p_remove_missing text[] DEFAULT NULL::text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_result jsonb;
  v_manifest_id uuid;
  v_action_id uuid := gen_random_uuid();
  v_granite_bl record;
  v_touched uuid[] := ARRAY[]::uuid[];
  v_updated uuid[] := ARRAY[]::uuid[];
  v_inserted uuid[] := ARRAY[]::uuid[];
  v_removed text[] := ARRAY[]::text[];
  v_missing text[] := ARRAY[]::text[];
  v_dup text;
  v_kept_invoiced text[] := ARRAY[]::text[];
BEGIN
  IF auth.uid() IS NULL
     OR NOT public.is_active_user()
     OR p_uploaded_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Credenciais invalidas para importar manifesto Granito.'
      USING ERRCODE = '42501';
  END IF;

  -- Duas planilhas da mesma Viagem não se cruzam.
  PERFORM pg_advisory_xact_lock(hashtextextended('granite_voyage:' || p_voyage_id::text, 0));

  IF NOT EXISTS (
    SELECT 1 FROM public.granite_bls g JOIN public.granite_manifests m ON m.id = g.manifest_id
    WHERE m.voyage_id = p_voyage_id
  ) THEN
    -- Primeira importação da Viagem: caminho original.
    v_result := public.import_granite_manifest_transactional_legacy_136(
      p_voyage_id, p_vessel_voyage, p_loading_port, p_discharge_port,
      p_total_bls, p_total_weight_kg, p_uploaded_by, p_bls
    );
    v_manifest_id := (v_result->>'manifest_id')::uuid;
    UPDATE public.granite_bls AS g
    SET suggested_client_id = NULLIF(item->>'suggested_client_id', '')::bigint
    FROM jsonb_array_elements(COALESCE(p_bls, '[]'::jsonb)) AS item
    WHERE g.manifest_id = v_manifest_id AND g.bl_number = item->>'bl_number';
    SELECT array_agg(id ORDER BY id) INTO v_touched FROM public.granite_bls WHERE manifest_id = v_manifest_id;
    v_inserted := COALESCE(v_touched, ARRAY[]::uuid[]);
  ELSE
    IF NULLIF(btrim(COALESCE(p_vessel_voyage, '')), '') IS NULL
       OR jsonb_typeof(p_bls) <> 'array' OR jsonb_array_length(p_bls) = 0 THEN
      RAISE EXCEPTION 'Manifesto Granito invalido.' USING ERRCODE = '22023';
    END IF;

    CREATE TEMP TABLE tmp_granite_import ON COMMIT DROP AS
    SELECT upper(btrim(item.bl_number)) AS key, item.*
    FROM jsonb_to_recordset(p_bls) AS item(
      client_id bigint, suggested_client_id bigint, sequence integer, booking_number text, bl_number text,
      shipper_ref text, vessel_voyage text, loading_port text, discharge_port text, shipper_name text,
      shipper_cnpj text, consignee_name text, charter text, shipper_m3 numeric, shipper_weight_kg numeric,
      blocks_qty integer, received_blocks_qty integer, final_m3 numeric, real_weight_kg numeric,
      stockyard text, remarks text, partial_restriction boolean, cosco_transport text, fragile_blocks integer,
      cssc_selection text, cargo_readiness_date date, phase text
    );

    SELECT key INTO v_dup FROM tmp_granite_import GROUP BY key HAVING count(*) > 1 LIMIT 1;
    IF v_dup IS NOT NULL THEN
      RAISE EXCEPTION 'B/L % aparece mais de uma vez no arquivo.', v_dup USING ERRCODE = '22023';
    END IF;

    SELECT m.id INTO v_manifest_id FROM public.granite_manifests m
    WHERE m.voyage_id = p_voyage_id ORDER BY m.imported_at DESC NULLS LAST, m.id DESC LIMIT 1
    FOR UPDATE;

    -- Atualiza por número do B/L, preservando CE, Cliente e status de cobrança.
    WITH changed AS (
      UPDATE public.granite_bls AS g
      SET sequence = t.sequence, booking_number = t.booking_number, shipper_ref = t.shipper_ref,
          vessel_voyage = t.vessel_voyage, loading_port = t.loading_port, discharge_port = t.discharge_port,
          shipper_name = t.shipper_name, shipper_cnpj = t.shipper_cnpj, consignee_name = t.consignee_name,
          charter = t.charter, shipper_m3 = t.shipper_m3, shipper_weight_kg = t.shipper_weight_kg,
          blocks_qty = t.blocks_qty, received_blocks_qty = t.received_blocks_qty, final_m3 = t.final_m3,
          real_weight_kg = t.real_weight_kg, stockyard = t.stockyard, remarks = t.remarks,
          partial_restriction = COALESCE(t.partial_restriction, false), cosco_transport = t.cosco_transport,
          fragile_blocks = t.fragile_blocks, cssc_selection = t.cssc_selection,
          cargo_readiness_date = t.cargo_readiness_date, phase = t.phase,
          client_id = COALESCE(g.client_id, t.client_id),
          suggested_client_id = CASE WHEN g.client_id IS NULL THEN t.suggested_client_id ELSE g.suggested_client_id END
      FROM tmp_granite_import AS t, public.granite_manifests AS m
      WHERE m.id = g.manifest_id AND m.voyage_id = p_voyage_id AND upper(btrim(g.bl_number)) = t.key
        AND (g.sequence, g.booking_number, g.shipper_ref, g.vessel_voyage, g.loading_port, g.discharge_port,
             g.shipper_name, g.shipper_cnpj, g.consignee_name, g.charter, g.shipper_m3, g.shipper_weight_kg,
             g.blocks_qty, g.received_blocks_qty, g.final_m3, g.real_weight_kg, g.stockyard, g.remarks,
             g.partial_restriction, g.cosco_transport, g.fragile_blocks, g.cssc_selection,
             g.cargo_readiness_date, g.phase, g.client_id)
            IS DISTINCT FROM
            (t.sequence, t.booking_number, t.shipper_ref, t.vessel_voyage, t.loading_port, t.discharge_port,
             t.shipper_name, t.shipper_cnpj, t.consignee_name, t.charter, t.shipper_m3::numeric(12,3), t.shipper_weight_kg::numeric(14,3),
             t.blocks_qty, t.received_blocks_qty, t.final_m3::numeric(12,3), t.real_weight_kg::numeric(14,3), t.stockyard, t.remarks,
             COALESCE(t.partial_restriction, false), t.cosco_transport, t.fragile_blocks, t.cssc_selection,
             t.cargo_readiness_date, t.phase, COALESCE(g.client_id, t.client_id))
      RETURNING g.id
    )
    SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::uuid[]) INTO v_updated FROM changed;

    WITH added AS (
      INSERT INTO public.granite_bls (
        manifest_id, client_id, suggested_client_id, sequence, booking_number, bl_number, shipper_ref, vessel_voyage,
        loading_port, discharge_port, shipper_name, shipper_cnpj, consignee_name, charter, shipper_m3,
        shipper_weight_kg, blocks_qty, received_blocks_qty, final_m3, real_weight_kg, stockyard, remarks,
        partial_restriction, cosco_transport, fragile_blocks, cssc_selection, cargo_readiness_date, phase, charge_status)
      SELECT v_manifest_id, t.client_id, t.suggested_client_id, t.sequence, t.booking_number, btrim(t.bl_number), t.shipper_ref,
        t.vessel_voyage, t.loading_port, t.discharge_port, t.shipper_name, t.shipper_cnpj, t.consignee_name, t.charter,
        t.shipper_m3, t.shipper_weight_kg, t.blocks_qty, t.received_blocks_qty, t.final_m3, t.real_weight_kg,
        t.stockyard, t.remarks, COALESCE(t.partial_restriction, false), t.cosco_transport, t.fragile_blocks,
        t.cssc_selection, t.cargo_readiness_date, t.phase, 'not_calculated'
      FROM tmp_granite_import AS t
      WHERE NOT EXISTS (
        SELECT 1 FROM public.granite_bls g JOIN public.granite_manifests m ON m.id = g.manifest_id
        WHERE m.voyage_id = p_voyage_id AND upper(btrim(g.bl_number)) = t.key)
      RETURNING id
    )
    SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::uuid[]) INTO v_inserted FROM added;

    -- Ausentes do arquivo novo: saem só com confirmação. O B/L com Invoice
    -- nunca sai: fica e volta em `kept_missing_invoiced_bl_numbers` (V3);
    -- antes, um só deles recusava (23503) o arquivo inteiro, contra o que a
    -- confirmação da tela promete.
    SELECT COALESCE(array_agg(g.bl_number ORDER BY g.bl_number), ARRAY[]::text[]) INTO v_kept_invoiced
    FROM public.granite_bls g JOIN public.granite_manifests m ON m.id = g.manifest_id
    WHERE m.voyage_id = p_voyage_id
      AND upper(btrim(g.bl_number)) = ANY (SELECT upper(btrim(x)) FROM unnest(COALESCE(p_remove_missing, ARRAY[]::text[])) AS x)
      AND NOT EXISTS (SELECT 1 FROM tmp_granite_import t WHERE t.key = upper(btrim(g.bl_number)))
      AND EXISTS (SELECT 1 FROM public.invoice_granite_bls ig WHERE ig.granite_bl_id = g.id);

    WITH gone AS (
      DELETE FROM public.granite_bls AS g
      USING public.granite_manifests AS m
      WHERE m.id = g.manifest_id AND m.voyage_id = p_voyage_id
        AND upper(btrim(g.bl_number)) = ANY (SELECT upper(btrim(x)) FROM unnest(COALESCE(p_remove_missing, ARRAY[]::text[])) AS x)
        AND NOT EXISTS (SELECT 1 FROM tmp_granite_import t WHERE t.key = upper(btrim(g.bl_number)))
        AND NOT EXISTS (SELECT 1 FROM public.invoice_granite_bls ig WHERE ig.granite_bl_id = g.id)
      RETURNING g.bl_number
    )
    SELECT COALESCE(array_agg(bl_number ORDER BY bl_number), ARRAY[]::text[]) INTO v_removed FROM gone;

    IF cardinality(v_removed) > 0 THEN
      INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
      SELECT 'granite_bls', r, 'deleted', r, NULL, auth.uid(), 'Reimportação do Granito: ausente do arquivo novo, saída confirmada'
      FROM unnest(v_removed) AS r;
    END IF;

    SELECT COALESCE(array_agg(g.bl_number ORDER BY g.bl_number), ARRAY[]::text[]) INTO v_missing
    FROM public.granite_bls g JOIN public.granite_manifests m ON m.id = g.manifest_id
    WHERE m.voyage_id = p_voyage_id
      AND NOT EXISTS (SELECT 1 FROM tmp_granite_import t WHERE t.key = upper(btrim(g.bl_number)));

    UPDATE public.granite_manifests
    SET vessel_voyage = btrim(p_vessel_voyage), loading_port = p_loading_port, discharge_port = p_discharge_port,
        total_bls = (SELECT count(*) FROM public.granite_bls WHERE manifest_id = v_manifest_id),
        total_weight_kg = (SELECT COALESCE(sum(real_weight_kg), 0) FROM public.granite_bls WHERE manifest_id = v_manifest_id)
    WHERE id = v_manifest_id;

    v_touched := v_updated || v_inserted;
    v_result := jsonb_build_object('manifest_id', v_manifest_id, 'inserted_bls', cardinality(v_inserted));
  END IF;

  FOR v_granite_bl IN
    SELECT id, bl_number FROM public.granite_bls WHERE id = ANY (v_touched) ORDER BY id
  LOOP
    INSERT INTO public.import_pending_effects(source_action_id, effect_kind, entity_id, created_by, source_snapshot)
    VALUES (v_action_id, 'granite_billing', v_granite_bl.id::text, p_uploaded_by,
      jsonb_build_object('manifest_id', v_manifest_id, 'bl_number', v_granite_bl.bl_number, 'voyage_id', p_voyage_id))
    ON CONFLICT (source_action_id, effect_kind, entity_id) DO NOTHING;
  END LOOP;

  RETURN v_result || jsonb_build_object(
    'updated_bls', cardinality(v_updated),
    'removed_bl_numbers', to_jsonb(v_removed),
    'kept_missing_bl_numbers', to_jsonb(v_missing),
    'kept_missing_invoiced_bl_numbers', to_jsonb(v_kept_invoiced)
  );
END;
$function$;

-- 3. Vazios de Importação (V2, V10, V11) ─────────────────────────────────────
-- Rota viva = algum container de vazios da Viagem com o mesmo POL/POD na forma
-- do cadastro: o Manifesto guarda `normalize_port_code` (181: BRNVT → BRITJ,
-- BRREC → BRSUA), o container guarda o porto como veio. O espelho da rota
-- (`voyage_route_ce_master`, modo vazios) sai junto com o Manifesto que sai,
-- para não ficar Nº sem cadastro.
CREATE OR REPLACE FUNCTION public._vazios_importacao_prune(p_voyage_id bigint)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_count integer := 0; v_more integer;
BEGIN
  DELETE FROM public.vazios_importacao_manifests m
  WHERE m.voyage_id = p_voyage_id
    AND NOT EXISTS (SELECT 1 FROM public.vazios_importacao_containers c WHERE c.manifest_id = m.id);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  WITH gone AS (
    DELETE FROM public.manifestos_mercante mm
    WHERE mm.voyage_id = p_voyage_id AND mm.natureza = 'vazio'
      AND NOT EXISTS (SELECT 1 FROM public.bls b WHERE b.manifesto_mercante_id = mm.id)
      AND NOT EXISTS (
        SELECT 1 FROM public.vazios_importacao_containers c
        JOIN public.vazios_importacao_manifests m ON m.id = c.manifest_id
        WHERE m.voyage_id = p_voyage_id
          AND public.normalize_port_code(c.pol) = public.normalize_port_code(mm.pol)
          AND public.normalize_port_code(c.pod) = public.normalize_port_code(mm.pod)
      )
    RETURNING mm.voyage_id, mm.numero
  ), mirror AS (
    DELETE FROM public.voyage_route_ce_master cm
    USING gone
    WHERE cm.voyage_id = gone.voyage_id AND cm.cargo_mode = 'vazios' AND cm.ce_master = gone.numero
    RETURNING cm.id
  )
  SELECT count(*) INTO v_more FROM gone;
  UPDATE public.vazios_importacao_manifests m
  SET total_containers = (SELECT count(*) FROM public.vazios_importacao_containers c WHERE c.manifest_id = m.id)
  WHERE m.voyage_id = p_voyage_id;
  RETURN v_count + v_more;
END $$;
REVOKE ALL ON FUNCTION public._vazios_importacao_prune(bigint) FROM PUBLIC, anon, authenticated;

-- A importação compara a rota pela forma do cadastro e o Nº pela forma
-- canônica (`canonical_manifesto_numero`), dos dois lados (V2, V11); os ids
-- dos Manifestos vêm da própria linha gravada ou encontrada; corrigir o Nº da
-- rota atualiza também o espelho, com o gatilho de espelho desligado
-- (`vela.route_manifest_mirror`, como `set_voyage_route_ce_master` da 181),
-- sem laço de gatilhos (V10).
CREATE OR REPLACE FUNCTION public.import_vazios_importacao_transactional_legacy_189(
  p_voyage_id bigint,
  p_description text,
  p_uploaded_by uuid,
  p_containers jsonb,
  p_manifestos jsonb DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_manifest_id uuid;
  v_containers jsonb := COALESCE(p_containers, '[]'::jsonb);
  v_manifestos jsonb := COALESCE(p_manifestos, '[]'::jsonb);
  v_total integer;
  v_sem_rota integer;
  v_rotas_sem_numero text;
  v_rotas_com_dois_numeros text;
  v_numero_repetido text;
  v_numero_cadastrado text;
  v_route record;
  v_existing record;
  v_mercante_id uuid;
  v_mercante_ids uuid[] := ARRAY[]::uuid[];
  v_previous_mirror text := current_setting('vela.route_manifest_mirror', true);
  v_replaced integer := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR p_uploaded_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa para importar vazios.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.voyages WHERE id = p_voyage_id) THEN
    RAISE EXCEPTION 'Viagem nao encontrada.' USING ERRCODE = 'P0002';
  END IF;
  IF jsonb_typeof(v_manifestos) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Número do manifesto Mercante é obrigatório.' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('vazios_importacao:' || p_voyage_id::text, 0));

  SELECT count(*),
         count(*) FILTER (WHERE NULLIF(btrim(item.pol), '') IS NULL OR NULLIF(btrim(item.pod), '') IS NULL)
    INTO v_total, v_sem_rota
    FROM jsonb_to_recordset(v_containers) AS item(pol text, pod text);

  IF v_total = 0 THEN
    RAISE EXCEPTION 'Nenhum container na planilha.' USING ERRCODE = '22023';
  END IF;
  IF v_sem_rota > 0 THEN
    RAISE EXCEPTION 'POL e POD são obrigatórios em todas as linhas: o Nº de manifesto Mercante pertence ao porto de origem.' USING ERRCODE = '22023';
  END IF;

  -- Rota e Nº na forma do cadastro; dois códigos do mesmo porto com o mesmo
  -- Nº viram uma rota só.
  CREATE TEMP TABLE IF NOT EXISTS pg_temp.vazios_import_manifestos (pol text, pod text, numero text) ON COMMIT DROP;
  TRUNCATE pg_temp.vazios_import_manifestos;
  INSERT INTO pg_temp.vazios_import_manifestos
  SELECT DISTINCT public.normalize_port_code(m.pol), public.normalize_port_code(m.pod),
         public.canonical_manifesto_numero(m.numero)
  FROM jsonb_to_recordset(v_manifestos) AS m(pol text, pod text, numero text);

  SELECT string_agg(r.pol || ' → ' || r.pod, ', ' ORDER BY r.pol, r.pod)
    INTO v_rotas_sem_numero
    FROM (
      SELECT DISTINCT public.normalize_port_code(item.pol) AS pol, public.normalize_port_code(item.pod) AS pod
      FROM jsonb_to_recordset(v_containers) AS item(pol text, pod text)
    ) r
    WHERE NOT EXISTS (SELECT 1 FROM pg_temp.vazios_import_manifestos m
                      WHERE m.pol = r.pol AND m.pod = r.pod AND m.numero IS NOT NULL);
  IF v_rotas_sem_numero IS NOT NULL THEN
    RAISE EXCEPTION 'Informe um Nº de manifesto Mercante para cada porto de origem: falta em %.', v_rotas_sem_numero USING ERRCODE = '22023';
  END IF;
  SELECT string_agg(d.pol || ' → ' || d.pod, ', ' ORDER BY d.pol, d.pod)
    INTO v_rotas_com_dois_numeros
    FROM (
      SELECT pol, pod FROM pg_temp.vazios_import_manifestos
      WHERE numero IS NOT NULL GROUP BY pol, pod HAVING count(*) > 1
    ) d;
  IF v_rotas_com_dois_numeros IS NOT NULL THEN
    RAISE EXCEPTION 'A rota % recebeu mais de um Nº de manifesto Mercante (o mesmo porto aparece com códigos diferentes na planilha): informe um só.', v_rotas_com_dois_numeros USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_temp.vazios_import_manifestos m
    WHERE m.numero IS NULL OR NOT EXISTS (
      SELECT 1 FROM jsonb_to_recordset(v_containers) AS item(pol text, pod text)
      WHERE public.normalize_port_code(item.pol) = m.pol AND public.normalize_port_code(item.pod) = m.pod
    )
  ) THEN
    RAISE EXCEPTION 'Há Nº de manifesto Mercante para uma rota que não está na planilha.' USING ERRCODE = '22023';
  END IF;

  SELECT min(numero) INTO v_numero_repetido
    FROM (SELECT numero FROM pg_temp.vazios_import_manifestos GROUP BY numero HAVING count(*) > 1) d;
  IF v_numero_repetido IS NOT NULL THEN
    RAISE EXCEPTION 'O número de manifesto Mercante "%" foi informado para mais de um porto de origem.', v_numero_repetido USING ERRCODE = '22023';
  END IF;

  -- O número da mesma rota de vazios nesta Viagem é reaproveitado; em qualquer
  -- outro lugar, recusa.
  SELECT min(m.numero) INTO v_numero_cadastrado
    FROM pg_temp.vazios_import_manifestos m
    JOIN public.manifestos_mercante mm ON mm.numero = m.numero
    WHERE NOT (mm.voyage_id = p_voyage_id AND mm.natureza = 'vazio'
               AND public.normalize_port_code(mm.pol) = m.pol
               AND public.normalize_port_code(mm.pod) = m.pod);
  IF v_numero_cadastrado IS NOT NULL THEN
    RAISE EXCEPTION 'O número de manifesto Mercante "%" já foi cadastrado no sistema.', v_numero_cadastrado USING ERRCODE = '23505';
  END IF;

  -- Natureza digitada antes da substituição.
  CREATE TEMP TABLE IF NOT EXISTS pg_temp.vazios_natureza (container_number text, natureza text) ON COMMIT DROP;
  TRUNCATE pg_temp.vazios_natureza;
  INSERT INTO pg_temp.vazios_natureza SELECT * FROM public._vazios_importacao_natureza_map(p_voyage_id);

  -- A planilha nova substitui os containers das rotas que ela traz.
  DELETE FROM public.vazios_importacao_containers c
  USING public.vazios_importacao_manifests m
  WHERE m.id = c.manifest_id AND m.voyage_id = p_voyage_id
    AND EXISTS (SELECT 1 FROM pg_temp.vazios_import_manifestos r
                WHERE r.pol = public.normalize_port_code(c.pol) AND r.pod = public.normalize_port_code(c.pod));
  GET DIAGNOSTICS v_replaced = ROW_COUNT;

  -- Nº de Manifesto da rota: corrige o existente ou cadastra; o espelho da
  -- rota acompanha.
  PERFORM set_config('vela.route_manifest_mirror', 'on', true);
  FOR v_route IN
    SELECT r.pol, r.pod, r.numero FROM pg_temp.vazios_import_manifestos r
    WHERE r.numero IS NOT NULL ORDER BY r.numero
  LOOP
    SELECT mm.id, mm.numero INTO v_existing
    FROM public.manifestos_mercante mm
    WHERE mm.voyage_id = p_voyage_id AND mm.natureza = 'vazio'
      AND public.normalize_port_code(mm.pol) = v_route.pol
      AND public.normalize_port_code(mm.pod) = v_route.pod
    ORDER BY mm.created_at, mm.id
    LIMIT 1
    FOR UPDATE;
    IF FOUND THEN
      v_mercante_id := v_existing.id;
      IF v_existing.numero IS DISTINCT FROM v_route.numero THEN
        UPDATE public.manifestos_mercante SET numero = v_route.numero WHERE id = v_mercante_id;
      END IF;
    ELSE
      INSERT INTO public.manifestos_mercante (voyage_id, pol, pod, numero, natureza)
      VALUES (p_voyage_id, v_route.pol, v_route.pod, v_route.numero, 'vazio')
      RETURNING id INTO v_mercante_id;
    END IF;
    v_mercante_ids := v_mercante_ids || v_mercante_id;

    UPDATE public.voyage_route_ce_master AS cm
    SET ce_master = v_route.numero, updated_by = p_uploaded_by, updated_at = now()
    WHERE cm.voyage_id = p_voyage_id AND cm.cargo_mode = 'vazios'
      AND public.normalize_port_code(cm.pol) = v_route.pol
      AND public.normalize_port_code(cm.pod) = v_route.pod
      AND cm.ce_master IS DISTINCT FROM v_route.numero;
    INSERT INTO public.voyage_route_ce_master (voyage_id, pol, pod, cargo_mode, ce_master, updated_by, updated_at)
    SELECT p_voyage_id, v_route.pol, v_route.pod, 'vazios', v_route.numero, p_uploaded_by, now()
    WHERE NOT EXISTS (
      SELECT 1 FROM public.voyage_route_ce_master AS cm
      WHERE cm.voyage_id = p_voyage_id AND cm.cargo_mode = 'vazios'
        AND public.normalize_port_code(cm.pol) = v_route.pol
        AND public.normalize_port_code(cm.pod) = v_route.pod
    );
  END LOOP;
  PERFORM set_config('vela.route_manifest_mirror', COALESCE(NULLIF(v_previous_mirror, ''), 'off'), true);

  INSERT INTO public.vazios_importacao_manifests (
    voyage_id, description, total_containers, imported_by, source
  )
  VALUES (p_voyage_id, p_description, v_total, p_uploaded_by, 'manual')
  RETURNING id INTO v_manifest_id;

  INSERT INTO public.vazios_importacao_containers (
    manifest_id, container_number, container_type, tare_kg, pol, pod, natureza
  )
  SELECT v_manifest_id, item.container_number, item.container_type, item.tare_kg, item.pol, item.pod, n.natureza
  FROM jsonb_to_recordset(v_containers) AS item(
    container_number text,
    container_type text,
    tare_kg numeric,
    pol text,
    pod text
  )
  LEFT JOIN pg_temp.vazios_natureza n ON n.container_number = upper(btrim(item.container_number));

  PERFORM public._vazios_importacao_prune(p_voyage_id);

  RETURN jsonb_build_object('manifest_id', v_manifest_id, 'mercante_manifest_ids', to_jsonb(v_mercante_ids),
    'replaced_containers', v_replaced);
END;
$function$;

-- 4. Transbordo por porto omitido no Histórico do B/L (B1) ───────────────────
CREATE OR REPLACE FUNCTION public._attach_new_bl_to_voyage_omission()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE o record;
BEGIN
  FOR o IN
    SELECT id, omitted_pod, discharge_pod FROM public.voyage_omissions
    WHERE voyage_id = NEW.voyage_id AND reverted_at IS NULL
      AND omitted_pod = upper(btrim(COALESCE(NEW.pod, '')))
  LOOP
    INSERT INTO public.bl_transshipments(bl_id, omission_id, disposition, created_by)
    VALUES (NEW.id, o.id, 'transshipment', auth.uid())
    ON CONFLICT (bl_id, omission_id) DO NOTHING;
    IF FOUND THEN
      -- O Histórico do B/L (`bl_timeline`, 133) lê `entity_type = 'bl'` e omite
      -- o que tem o instante da criação do B/L (`now()` da transação, o mesmo
      -- de `bls.created_at`); `clock_timestamp()` põe o evento logo depois de
      -- "B/L criado".
      INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification)
      VALUES ('bl', NEW.id, 'transbordo', NULL, o.discharge_pod, auth.uid(), clock_timestamp(),
        'B/L importado depois da omissão de ' || o.omitted_pod || ': afetado, disposição Transbordo');
    END IF;
  END LOOP;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public._attach_new_bl_to_voyage_omission() FROM PUBLIC, anon, authenticated;

-- 5. Carga solta (B3, B5, B6) ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.import_breakbulk_manifest_transactional_legacy_189(p_filename text, p_voyage_id bigint, p_uploaded_by uuid, p_total_bls integer, p_bls jsonb, p_items jsonb, p_errors jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bls jsonb := COALESCE(p_bls, '[]'::jsonb);
  v_items jsonb := COALESCE(p_items, '[]'::jsonb);
  v_row record;
  v_item jsonb;
  v_before public.bls%ROWTYPE;
  v_after public.bls%ROWTYPE;
  v_bl_id text;
  v_bl_ids text[];
  v_existing_ids text[] := ARRAY[]::text[];
  v_inserted_ids text[] := ARRAY[]::text[];
  v_updated_ids text[] := ARRAY[]::text[];
  v_effect_ids text[];
  v_existing_bb boolean;
  v_incoming_bb boolean;
  v_batch_id bigint;
  v_action_id uuid := gen_random_uuid();
  v_previous_replacement text := current_setting('vela.breakbulk_import_replacement', true);
  v_previous_basis_source text := current_setting('vela.invoice_basis_source', true);
  v_previous_terminal text := current_setting('vela.bl_terminal_override', true);
  v_voyage_label text;
  v_other_label text;
  v_billed boolean;
  v_override boolean;
  v_cod boolean;
  v_in_customer bigint;
  v_customer_mode text;
  v_new_pol text;
  v_new_pod text;
  v_route_locked text[];
  v_relink jsonb;
  v_relinks jsonb := '[]'::jsonb;
  v_customer_ignored jsonb := '[]'::jsonb;
  v_billing_locked jsonb := '[]'::jsonb;
  v_cod_kept jsonb := '[]'::jsonb;
  v_ce_ignored text[];
  v_items_changed boolean;
  v_changed_fields text[];
  v_reasons text[];
  v_human_notes text;
  v_notes text;
  v_review text;
  v_has_live_invoice boolean;
  v_reissues jsonb;
  v_tracked_fields text[] := ARRAY[
    'shipper', 'consignee', 'notify_party', 'cargo_description', 'pol', 'pod',
    'customer_id', 'manifest_customer_cnpj_cpf', 'manifest_customer_name',
    'bb_machine_qty', 'bb_packages_qty', 'bb_packages_total', 'bb_weight_ton',
    'bb_cbm', 'ncm_codes', 'manifesto_mercante_id'
  ];
BEGIN
  IF auth.uid() IS NULL
     OR NOT public.is_active_user()
     OR p_uploaded_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Credenciais invalidas para importar carga solta.'
      USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(v_bls) IS DISTINCT FROM 'array' OR jsonb_typeof(v_items) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Payload de carga solta invalido.' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(array_agg(source.row->>'id'), ARRAY[]::text[])
    INTO v_bl_ids
  FROM jsonb_array_elements(v_bls) AS source(row);

  SELECT concat_ws(' / ', NULLIF(btrim(ve.name), ''), NULLIF(btrim(v.voyage_number), ''))
    INTO v_voyage_label
  FROM public.voyages AS v
  LEFT JOIN public.vessels AS ve ON ve.id = v.vessel_id
  WHERE v.id = p_voyage_id;

  -- 1. Trava os B/Ls existentes e recusa o lote antes de gravar qualquer coisa.
  FOR v_row IN
    SELECT b.id, b.voyage_id, b.financial_status, b.bb_weight_ton, b.bb_packages_qty,
      source.row AS incoming
    FROM public.bls AS b
    JOIN jsonb_array_elements(v_bls) AS source(row) ON b.id = source.row->>'id'
    ORDER BY b.id
    FOR UPDATE OF b
  LOOP
    v_existing_ids := v_existing_ids || v_row.id;

    IF v_row.voyage_id IS DISTINCT FROM p_voyage_id THEN
      SELECT concat_ws(' / ', NULLIF(btrim(ve.name), ''), NULLIF(btrim(v.voyage_number), ''))
        INTO v_other_label
      FROM public.voyages AS v
      LEFT JOIN public.vessels AS ve ON ve.id = v.vessel_id
      WHERE v.id = v_row.voyage_id;
      RAISE EXCEPTION
        'O B/L % ja esta na Viagem % e o arquivo foi importado na Viagem %. Nenhum B/L do lote foi gravado: confira a Viagem de destino ou corrija a Viagem do B/L pela ficha.',
        v_row.id, COALESCE(v_other_label, v_row.voyage_id::text), COALESCE(v_voyage_label, p_voyage_id::text)
        USING ERRCODE = 'P0005';
    END IF;

    v_existing_bb := COALESCE(v_row.bb_weight_ton, 0) > 0
      OR COALESCE(v_row.bb_packages_qty, 0) > 0
      OR EXISTS (SELECT 1 FROM public.bl_breakbulk_items WHERE bl_id = v_row.id);
    v_incoming_bb := COALESCE(NULLIF(v_row.incoming->>'bb_weight_ton', '')::numeric, 0) > 0
      OR COALESCE(NULLIF(v_row.incoming->>'bb_packages_qty', '')::numeric, 0) > 0
      OR EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_items) AS item(row)
        WHERE item.row->>'bl_id' = v_row.id
      );

    IF v_row.financial_status IN ('invoiced', 'paid') AND v_existing_bb AND NOT v_incoming_bb THEN
      RAISE EXCEPTION
        'B/L % ja foi faturado (status financeiro=%); a importacao removeria carga solta. Estorne/refature antes de substituir o manifesto.',
        v_row.id, v_row.financial_status
        USING ERRCODE = 'P0003';
    END IF;
  END LOOP;

  SELECT COALESCE(array_agg(source.row->>'id'), ARRAY[]::text[])
    INTO v_ce_ignored
  FROM jsonb_array_elements(v_bls) AS source(row)
  WHERE NULLIF(btrim(source.row->>'ce_mercante'), '') IS NOT NULL;

  PERFORM set_config('vela.breakbulk_import_replacement', 'on', true);
  PERFORM set_config('vela.invoice_basis_source', 'bl_reimport_correction', true);
  v_batch_id := public.import_manifest_transactional_legacy_165(
    p_filename, p_voyage_id, p_uploaded_by, 'carga_solta', NULL, p_total_bls, 0,
    '[]'::jsonb, '[]'::jsonb, COALESCE(p_errors, '[]'::jsonb)
  );

  -- 2. B/Ls novos: o que o arquivo traz, sem CE.
  WITH inserted AS (
    INSERT INTO public.bls (
      id, voyage_id, batch_id, cargo_mode, shipper, consignee, cargo_description,
      customer_id, suggested_customer_id, pol, pod, total_weight_kg, review_status,
      financial_status, notes, manifest_customer_cnpj_cpf, manifest_customer_name,
      manifest_customer_email, customer_reconciliation_status,
      customer_reconciliation_notes, billing_hold_reason, notify_party,
      bb_machine_qty, bb_packages_qty, bb_packages_total, bb_weight_ton, bb_cbm, ncm_codes
    )
    SELECT
      source.row->>'id',
      p_voyage_id,
      v_batch_id,
      'carga_solta',
      NULLIF(source.row->>'shipper', ''),
      source.row->>'consignee',
      NULLIF(source.row->>'cargo_description', ''),
      NULLIF(source.row->>'customer_id', '')::bigint,
      CASE WHEN NULLIF(source.row->>'customer_id', '') IS NULL
        THEN NULLIF(source.row->>'suggested_customer_id', '')::bigint END,
      NULLIF(source.row->>'pol', ''),
      NULLIF(source.row->>'pod', ''),
      NULLIF(source.row->>'total_weight_kg', '')::numeric,
      COALESCE(NULLIF(source.row->>'review_status', ''), 'ok'),
      'pending',
      NULLIF(source.row->>'notes', ''),
      public.normalize_document_text(source.row->>'manifest_customer_cnpj_cpf'),
      COALESCE(NULLIF(source.row->>'manifest_customer_name', ''), source.row->>'consignee'),
      NULLIF(source.row->>'manifest_customer_email', ''),
      COALESCE(NULLIF(source.row->>'customer_reconciliation_status', ''), 'missing_customer'),
      NULLIF(source.row->>'customer_reconciliation_notes', ''),
      NULLIF(source.row->>'billing_hold_reason', ''),
      NULLIF(source.row->>'notify_party', ''),
      NULLIF(source.row->>'bb_machine_qty', '')::numeric,
      NULLIF(source.row->>'bb_packages_qty', '')::numeric,
      NULLIF(source.row->>'bb_packages_total', '')::numeric,
      NULLIF(source.row->>'bb_weight_ton', '')::numeric,
      NULLIF(source.row->>'bb_cbm', '')::numeric,
      COALESCE(public.normalize_ncm_codes(source.row->'ncm_codes'), '{}'::text[])
    FROM jsonb_array_elements(v_bls) AS source(row)
    WHERE NOT (source.row->>'id' = ANY(v_existing_ids))
    RETURNING id
  )
  SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::text[]) INTO v_inserted_ids FROM inserted;

  -- 3. B/Ls existentes: só o que o arquivo traz, B/L a B/L.
  FOR v_item IN
    SELECT source.row FROM jsonb_array_elements(v_bls) AS source(row)
    WHERE source.row->>'id' = ANY(v_existing_ids)
    ORDER BY source.row->>'id'
  LOOP
    v_bl_id := v_item->>'id';
    SELECT * INTO v_before FROM public.bls WHERE id = v_bl_id;

    -- Faturado = fatura viva ou status financeiro faturado/pago. Cálculo sem
    -- fatura não trava a rota: a tela recalcula o B/L alterado.
    v_billed := COALESCE(v_before.financial_status, 'pending') IN ('invoiced', 'paid')
      OR cardinality(public._live_local_invoice_ids_for_bl(v_bl_id)) > 0;
    v_override := COALESCE(NULLIF(v_item->>'override_billing', '')::boolean, false);
    v_cod := EXISTS (
      SELECT 1 FROM public.bl_transshipments AS t
      JOIN public.voyage_omissions AS o ON o.id = t.omission_id
      WHERE t.bl_id = v_bl_id AND t.disposition = 'cod' AND o.reverted_at IS NULL
    );
    v_in_customer := NULLIF(v_item->>'customer_id', '')::bigint;
    v_customer_mode := CASE
      WHEN v_in_customer IS NULL THEN 'keep'
      WHEN v_before.customer_id IS NULL THEN 'link'
      WHEN v_before.customer_id = v_in_customer THEN 'same'
      WHEN COALESCE(NULLIF(v_item->>'relink_customer', '')::boolean, false) THEN 'relink'
      ELSE 'ignored'
    END;

    v_route_locked := ARRAY[]::text[];
    v_new_pol := COALESCE(NULLIF(btrim(v_item->>'pol'), ''), v_before.pol);
    v_new_pod := COALESCE(NULLIF(btrim(v_item->>'pod'), ''), v_before.pod);
    IF v_new_pod IS DISTINCT FROM v_before.pod AND v_cod THEN
      v_cod_kept := v_cod_kept || jsonb_build_object('bl_id', v_bl_id, 'pod', v_before.pod, 'file_pod', v_new_pod);
      v_new_pod := v_before.pod;
    END IF;
    IF v_billed AND NOT v_override THEN
      IF v_new_pol IS DISTINCT FROM v_before.pol THEN
        v_route_locked := v_route_locked || 'pol'::text;
        v_new_pol := v_before.pol;
      END IF;
      IF v_new_pod IS DISTINCT FROM v_before.pod THEN
        v_route_locked := v_route_locked || 'pod'::text;
        v_new_pod := v_before.pod;
      END IF;
      IF cardinality(v_route_locked) > 0 THEN
        v_billing_locked := v_billing_locked || jsonb_build_object('bl_id', v_bl_id, 'fields', to_jsonb(v_route_locked));
      END IF;
    END IF;

    IF v_customer_mode = 'ignored' THEN
      v_customer_ignored := v_customer_ignored || jsonb_build_object(
        'bl_id', v_bl_id,
        'customer_id', v_before.customer_id,
        'file_customer_id', v_in_customer,
        'file_document', public.normalize_document_text(v_item->>'manifest_customer_cnpj_cpf'),
        'file_consignee', NULLIF(v_item->>'consignee', '')
      );
    END IF;

    IF v_new_pod IS DISTINCT FROM v_before.pod
       AND (v_before.terminal_id IS NOT NULL OR v_before.pod_port_id IS NOT NULL) THEN
      PERFORM set_config('vela.bl_terminal_override', 'on', true);
    END IF;

    UPDATE public.bls AS b
    SET
      batch_id = v_batch_id,
      shipper = COALESCE(NULLIF(v_item->>'shipper', ''), b.shipper),
      -- B5 (192): na Troca de Consignatário o Consignee novo só entra se a troca
      -- for aplicada (UPDATE depois de `relink_bl_customer`).
      consignee = CASE WHEN v_customer_mode IN ('ignored', 'relink') THEN b.consignee
        ELSE COALESCE(NULLIF(v_item->>'consignee', ''), b.consignee) END,
      notify_party = COALESCE(NULLIF(v_item->>'notify_party', ''), b.notify_party),
      cargo_description = COALESCE(NULLIF(v_item->>'cargo_description', ''), b.cargo_description),
      pol = v_new_pol,
      pod = v_new_pod,
      manifesto_mercante_id = CASE WHEN v_new_pod IS DISTINCT FROM b.pod THEN NULL ELSE b.manifesto_mercante_id END,
      terminal_id = CASE WHEN v_new_pod IS DISTINCT FROM b.pod THEN NULL ELSE b.terminal_id END,
      pod_port_id = CASE WHEN v_new_pod IS DISTINCT FROM b.pod THEN NULL ELSE b.pod_port_id END,
      customer_id = CASE WHEN v_customer_mode = 'link' THEN v_in_customer ELSE b.customer_id END,
      suggested_customer_id = CASE
        WHEN v_customer_mode = 'link' THEN NULL
        WHEN b.customer_id IS NULL AND v_in_customer IS NULL AND v_item ? 'suggested_customer_id'
          THEN NULLIF(v_item->>'suggested_customer_id', '')::bigint
        ELSE b.suggested_customer_id
      END,
      customer_reconciliation_status = CASE
        WHEN v_customer_mode = 'link' THEN COALESCE(NULLIF(v_item->>'customer_reconciliation_status', ''), 'matched_document')
        WHEN v_customer_mode = 'same'
          AND COALESCE(b.customer_reconciliation_status, 'missing_customer') IN ('missing_customer', 'matched_name')
          AND v_item->>'customer_reconciliation_status' = 'matched_document'
          THEN 'matched_document'
        WHEN b.customer_id IS NULL AND v_in_customer IS NULL
          AND COALESCE(b.customer_reconciliation_status, 'missing_customer') IN ('missing_customer', 'matched_name')
          AND v_item->>'customer_reconciliation_status' IN ('missing_customer', 'matched_name')
          THEN v_item->>'customer_reconciliation_status'
        ELSE b.customer_reconciliation_status
      END,
      customer_reconciliation_notes = CASE
        WHEN v_customer_mode = 'link'
          OR (v_customer_mode = 'same'
            AND COALESCE(b.customer_reconciliation_status, 'missing_customer') IN ('missing_customer', 'matched_name')
            AND v_item->>'customer_reconciliation_status' = 'matched_document')
          OR (b.customer_id IS NULL AND v_in_customer IS NULL
            AND COALESCE(b.customer_reconciliation_status, 'missing_customer') IN ('missing_customer', 'matched_name')
            AND v_item->>'customer_reconciliation_status' IN ('missing_customer', 'matched_name'))
          THEN COALESCE(NULLIF(v_item->>'customer_reconciliation_notes', ''), b.customer_reconciliation_notes)
        ELSE b.customer_reconciliation_notes
      END,
      -- B6 (192): com o mesmo Cliente a retenção gravada (ex.: "Acesso ao portal
      -- nao provisionado") fica; só a reconciliação que sobe para documento
      -- troca a retenção pela do arquivo, como no B/L de container (175).
      billing_hold_reason = CASE
        WHEN v_customer_mode = 'link' THEN NULLIF(v_item->>'billing_hold_reason', '')
        WHEN v_customer_mode = 'same'
          AND COALESCE(b.customer_reconciliation_status, 'missing_customer') IN ('missing_customer', 'matched_name')
          AND v_item->>'customer_reconciliation_status' = 'matched_document'
          THEN NULLIF(v_item->>'billing_hold_reason', '')
        ELSE b.billing_hold_reason
      END,
      manifest_customer_cnpj_cpf = CASE
        WHEN v_customer_mode IN ('link', 'same') OR (b.customer_id IS NULL AND v_in_customer IS NULL)
          THEN COALESCE(public.normalize_document_text(v_item->>'manifest_customer_cnpj_cpf'), b.manifest_customer_cnpj_cpf)
        ELSE b.manifest_customer_cnpj_cpf
      END,
      manifest_customer_name = CASE
        WHEN v_customer_mode IN ('link', 'same') OR (b.customer_id IS NULL AND v_in_customer IS NULL)
          THEN COALESCE(NULLIF(v_item->>'manifest_customer_name', ''), b.manifest_customer_name)
        ELSE b.manifest_customer_name
      END,
      manifest_customer_email = COALESCE(NULLIF(v_item->>'manifest_customer_email', ''), b.manifest_customer_email),
      bb_machine_qty = COALESCE(NULLIF(v_item->>'bb_machine_qty', '')::numeric, b.bb_machine_qty),
      bb_packages_qty = COALESCE(NULLIF(v_item->>'bb_packages_qty', '')::numeric, b.bb_packages_qty),
      bb_packages_total = COALESCE(NULLIF(v_item->>'bb_packages_total', '')::numeric, b.bb_packages_total),
      bb_weight_ton = COALESCE(NULLIF(v_item->>'bb_weight_ton', '')::numeric, b.bb_weight_ton),
      bb_cbm = COALESCE(NULLIF(v_item->>'bb_cbm', '')::numeric, b.bb_cbm),
      ncm_codes = CASE
        WHEN cardinality(public.normalize_ncm_codes(v_item->'ncm_codes')) > 0
          THEN public.normalize_ncm_codes(v_item->'ncm_codes')
        ELSE b.ncm_codes
      END
    WHERE b.id = v_bl_id;

    PERFORM set_config('vela.bl_terminal_override', COALESCE(v_previous_terminal, 'off'), true);

    IF v_customer_mode = 'relink' THEN
      v_relink := public.relink_bl_customer(v_bl_id, v_in_customer, p_uploaded_by,
        'Troca de Consignatario aceita na reimportacao de carga solta');
      v_relinks := v_relinks || jsonb_build_array(v_relink || jsonb_build_object('bl_id', v_bl_id));
      IF COALESCE((v_relink->>'applied')::boolean, false) THEN
        UPDATE public.bls
        SET consignee = COALESCE(NULLIF(v_item->>'consignee', ''), consignee),
            manifest_customer_cnpj_cpf = COALESCE(public.normalize_document_text(v_item->>'manifest_customer_cnpj_cpf'), manifest_customer_cnpj_cpf),
            manifest_customer_name = COALESCE(NULLIF(v_item->>'manifest_customer_name', ''), manifest_customer_name)
        WHERE id = v_bl_id;
      END IF;
    END IF;

    -- Itens só são substituídos quando o arquivo os traz e eles mudaram.
    v_items_changed := false;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_items) AS item(row) WHERE item.row->>'bl_id' = v_bl_id) THEN
      SELECT
        COALESCE((
          SELECT jsonb_agg(jsonb_build_array(i.item_description, i.package_qty, i.package_unit, i.gross_weight_kg, i.cbm, i.marks)
            ORDER BY i.item_description, i.package_qty, i.gross_weight_kg, i.cbm, i.package_unit, i.marks)
          FROM public.bl_breakbulk_items AS i WHERE i.bl_id = v_bl_id
        ), '[]'::jsonb)
        IS DISTINCT FROM
        COALESCE((
          SELECT jsonb_agg(jsonb_build_array(n.item_description, n.package_qty, n.package_unit, n.gross_weight_kg, n.cbm, n.marks)
            ORDER BY n.item_description, n.package_qty, n.gross_weight_kg, n.cbm, n.package_unit, n.marks)
          FROM (
            SELECT
              item.row->>'item_description' AS item_description,
              COALESCE(NULLIF(item.row->>'package_qty', '')::numeric, 0) AS package_qty,
              NULLIF(item.row->>'package_unit', '') AS package_unit,
              COALESCE(NULLIF(item.row->>'gross_weight_kg', '')::numeric, 0) AS gross_weight_kg,
              COALESCE(NULLIF(item.row->>'cbm', '')::numeric, 0) AS cbm,
              NULLIF(item.row->>'marks', '') AS marks
            FROM jsonb_array_elements(v_items) AS item(row)
            WHERE item.row->>'bl_id' = v_bl_id
          ) AS n
        ), '[]'::jsonb)
      INTO v_items_changed;

      IF v_items_changed THEN
        DELETE FROM public.bl_breakbulk_items WHERE bl_id = v_bl_id;
        INSERT INTO public.bl_breakbulk_items (bl_id, item_description, package_qty, package_unit, gross_weight_kg, cbm, marks)
        SELECT v_bl_id, item.row->>'item_description',
          COALESCE(NULLIF(item.row->>'package_qty', '')::numeric, 0),
          NULLIF(item.row->>'package_unit', ''),
          COALESCE(NULLIF(item.row->>'gross_weight_kg', '')::numeric, 0),
          COALESCE(NULLIF(item.row->>'cbm', '')::numeric, 0),
          NULLIF(item.row->>'marks', '')
        FROM jsonb_array_elements(v_items) AS item(row)
        WHERE item.row->>'bl_id' = v_bl_id;
      END IF;
    END IF;

    SELECT * INTO v_after FROM public.bls WHERE id = v_bl_id;
    SELECT COALESCE(array_agg(f ORDER BY f), ARRAY[]::text[]) INTO v_changed_fields
    FROM unnest(v_tracked_fields) AS f
    WHERE to_jsonb(v_before)->f IS DISTINCT FROM to_jsonb(v_after)->f;
    IF v_items_changed THEN v_changed_fields := v_changed_fields || 'itens_carga_solta'::text; END IF;

    -- Revisão: a pendência de importação é refeita; sem pendência, o status
    -- humano fica e só a pendência antiga sai.
    v_has_live_invoice := EXISTS (
      SELECT 1 FROM public.invoice_bls AS ib JOIN public.invoices AS i ON i.id = ib.invoice_id
      WHERE ib.bl_id = v_bl_id AND i.status NOT IN ('cancelled', 'obsolete')
    );
    IF COALESCE(v_after.financial_status, 'pending') NOT IN ('invoiced', 'paid') AND NOT v_has_live_invoice THEN
      v_reasons := public.compute_bl_review_pendencies(v_bl_id);
      v_human_notes := btrim(regexp_replace(COALESCE(v_after.notes, ''), E'(^|\\n)Pendencias de importacao:[^\\n]*', '', 'gi'));
      v_notes := CASE
        WHEN COALESCE(cardinality(v_reasons), 0) > 0 THEN concat_ws(E'\n', NULLIF(v_human_notes, ''),
          'Pendencias de importacao: ' || array_to_string(v_reasons, ', '))
        ELSE NULLIF(v_human_notes, '')
      END;
      v_review := CASE
        WHEN COALESCE(cardinality(v_reasons), 0) > 0 THEN 'pending_review'
        WHEN v_after.review_status = 'pending_review' THEN 'ok'
        ELSE v_after.review_status
      END;
      IF v_review IS DISTINCT FROM v_after.review_status OR v_notes IS DISTINCT FROM v_after.notes THEN
        UPDATE public.bls SET review_status = v_review, notes = v_notes WHERE id = v_bl_id;
      END IF;
    END IF;

    IF cardinality(v_changed_fields) > 0 THEN
      v_updated_ids := v_updated_ids || v_bl_id;
      INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
      VALUES (
        'bl', v_bl_id, 'reimportacao_carga_solta', NULL,
        jsonb_build_object(
          'tipo', 'reimportacao_carga_solta',
          'viagem', COALESCE(v_voyage_label, p_voyage_id::text),
          'rota', concat_ws(' -> ', v_after.pol, v_after.pod),
          'campos', to_jsonb(v_changed_fields)
        )::text,
        p_uploaded_by,
        'Reimportacao de carga solta na Viagem ' || COALESCE(v_voyage_label, p_voyage_id::text)
          || ' (rota ' || concat_ws(' -> ', COALESCE(v_after.pol, '?'), COALESCE(v_after.pod, '?')) || ')'
      );
    END IF;
  END LOOP;

  -- 4. Itens dos B/Ls novos.
  INSERT INTO public.bl_breakbulk_items (bl_id, item_description, package_qty, package_unit, gross_weight_kg, cbm, marks)
  SELECT item.row->>'bl_id', item.row->>'item_description',
    COALESCE(NULLIF(item.row->>'package_qty', '')::numeric, 0),
    NULLIF(item.row->>'package_unit', ''),
    COALESCE(NULLIF(item.row->>'gross_weight_kg', '')::numeric, 0),
    COALESCE(NULLIF(item.row->>'cbm', '')::numeric, 0),
    NULLIF(item.row->>'marks', '')
  FROM jsonb_array_elements(v_items) AS item(row)
  WHERE item.row->>'bl_id' = ANY(v_inserted_ids);

  IF cardinality(v_bl_ids) > 0 THEN
    PERFORM public.apply_bl_review_gate_after_import(v_bl_ids, p_uploaded_by);
  END IF;
  -- B3 (192): a fila de Reconciliação de Cliente acompanha todo B/L do arquivo
  -- (inseridos e atualizados, inclusive os da Troca de Consignatário), como no
  -- B/L de container (175). O B/L que passa a ter Cliente por CNPJ não deixa
  -- item `pending` velho na fila.
  FOREACH v_bl_id IN ARRAY v_bl_ids LOOP
    PERFORM public.sync_customer_reconciliation_queue_for_bl(v_bl_id);
  END LOOP;

  -- Efeito de taxas locais só para o que entrou ou mudou: reimportar o mesmo
  -- arquivo não enfileira trabalho.
  v_effect_ids := v_inserted_ids || v_updated_ids;
  FOREACH v_bl_id IN ARRAY v_effect_ids LOOP
    INSERT INTO public.import_pending_effects(
      source_action_id, effect_kind, entity_id, created_by, source_snapshot
    ) VALUES (
      v_action_id, 'local_billing', v_bl_id, p_uploaded_by,
      jsonb_build_object('filename', p_filename, 'voyage_id', p_voyage_id, 'cargo_mode', 'carga_solta')
    )
    ON CONFLICT (source_action_id, effect_kind, entity_id) DO NOTHING;
  END LOOP;

  v_reissues := COALESCE(public.process_invoice_basis_changes(), '[]'::jsonb);
  PERFORM set_config('vela.invoice_basis_source', COALESCE(v_previous_basis_source, ''), true);
  PERFORM set_config('vela.breakbulk_import_replacement', COALESCE(v_previous_replacement, 'off'), true);

  RETURN jsonb_build_object(
    'batch_id', v_batch_id,
    'breakbulk_bl_ids', to_jsonb(v_bl_ids),
    'inserted_bl_ids', to_jsonb(v_inserted_ids),
    'updated_bl_ids', to_jsonb(v_updated_ids),
    'unchanged_bl_ids', to_jsonb(ARRAY(
      SELECT existing.id FROM unnest(v_existing_ids) AS existing(id)
      WHERE NOT (existing.id = ANY(v_updated_ids)) ORDER BY existing.id
    )),
    'customer_changes_ignored', v_customer_ignored,
    'customer_relinks', v_relinks,
    'billing_locked', v_billing_locked,
    'cod_pod_kept', v_cod_kept,
    'ce_ignored', to_jsonb(v_ce_ignored),
    'invoice_reissues', v_reissues
  );
END;
$function$;
