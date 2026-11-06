-- 610: o Novo cliente vincula os B/Ls que já esperavam por ele (pedido do
-- dono de 2026-11-06).
--
-- Caso: um B/L importado antes de o Cliente existir fica "Sem cliente
-- vinculado" na Revisão. Cadastrar o Cliente pela tela de Clientes (Novo
-- cliente) não voltava a esses B/Ls; só a Base de Clientes (ADR 0078, item 24)
-- e o "Cadastrar e vincular" da Revisão vinculavam.
--
-- Mudança:
-- - `_link_pending_bls_to_customer` (nova, interna, sem EXECUTE para a API):
--   o vínculo retroativo por documento que morava dentro da Base de Clientes,
--   com o mesmo filtro (B/L sem Cliente, `manifest_customer_cnpj_cpf` igual ao
--   CNPJ do Cliente, não cancelado, não rejeitado, Viagem não cancelada), o
--   mesmo Histórico, a mesma reavaliação da Revisão, os mesmos Alertas e o
--   mesmo cálculo das Taxas Locais. Escolhe, por parâmetro, se falha no
--   cálculo recusa quem chama (Base, ADR 0094 B3) ou volta em
--   `charges_failed` com o motivo (Novo cliente).
-- - `apply_customer_base_row_atomic_legacy_189`: corpo vigente (509; o
--   pg_get_functiondef no Postgres local com a cadeia até a 606 confere) com o
--   bloco do vínculo trocado pela chamada à função nova; mesmo resultado.
-- - `create_customer_with_contacts`: corpo vigente (557) com o vínculo no fim;
--   devolve o Cliente com `bl_link` (`linked_bl_ids`, `bls_suggested`,
--   `charges_failed`).
-- - `create_customer_from_bl_manifest`: corpo vigente (557) marcando o B/L da
--   ficha (`vela.customer_from_manifest_bl`), que fica de fora do vínculo
--   automático porque a ficha o vincula logo depois, com a confirmação dela.
--
-- Número 610: a 607, a 608 e a 609 já estão numa branch em andamento
-- (`claude/relaxed-hawking-pta0oh`), que não toca estas funções; o Supabase
-- identifica a migration pelo prefixo.
--
-- CREATE OR REPLACE mantém os privilégios das três funções existentes.
--
-- Plano de preservação: a migration só cria e redefine funções; não grava,
-- reescreve nem apaga linha existente. As linhas que as funções novas mudam
-- depois (só `bls.customer_id` vazio e `customer_reconciliation_status`) ficam
-- registradas uma a uma em `audit_logs` (`field_name = 'customer_id'`,
-- `old_value` nulo, justificativa "Vínculo por documento no cadastro do
-- Cliente"); conferir pelo Histórico do B/L e desfazer pelo Desvincular da
-- ficha do B/L.
--
-- Rollback: DROP de `_link_pending_bls_to_customer` depois de reaplicar as
-- definições de `apply_customer_base_row_atomic_legacy_189` (509),
-- `create_customer_with_contacts` (557) e `create_customer_from_bl_manifest`
-- (557).

CREATE FUNCTION public._link_pending_bls_to_customer(
  p_customer_id bigint,
  p_actor uuid,
  p_justification text,
  p_alert_source text,
  p_refuse_on_charge_failure boolean,
  p_exclude_bl_id text DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_cnpj text;
  v_linked text[];
  v_bl text;
  v_consignees text[];
  v_consignee text;
  v_previous_batch text;
  v_suggested text[];
  v_charges_failed jsonb := '[]'::jsonb;
BEGIN
  -- Núcleo interno (sem guarda própria): quem chama confere o ator.
  SELECT cnpj_cpf INTO v_cnpj FROM public.customers WHERE id = p_customer_id;
  IF NULLIF(btrim(COALESCE(v_cnpj, '')), '') IS NULL THEN
    RETURN jsonb_build_object('linked_bl_ids', '[]'::jsonb, 'bls_suggested', 0, 'charges_failed', '[]'::jsonb);
  END IF;

  -- Vínculo retroativo (ADR 0078, item 24): só B/Ls pendentes de Cliente com o
  -- mesmo CNPJ, nunca o rejeitado na Revisão (que recebe o Cliente à mão) nem o
  -- de Viagem cancelada, que é somente leitura: o UPDATE cairia em
  -- `trg_guard_voyage_cancelled_bls` (42501) e derrubaria a linha do Cliente
  -- (V9). A prévia da Base (`compareCustomerBaseWithExisting`) usa o mesmo filtro.
  --
  -- Lote (170): o gatilho de linha dos Alertas fica calado enquanto o vínculo e
  -- a Revisão mudam; o Alerta é reconciliado uma vez no fim.
  v_previous_batch := current_setting('vela.bl_review_batch', true);
  PERFORM set_config('vela.bl_review_batch', 'on', true);
  WITH linked AS (
    UPDATE public.bls AS b
      SET customer_id = p_customer_id,
          customer_reconciliation_status = 'matched_document'
      WHERE b.manifest_customer_cnpj_cpf = v_cnpj
        AND b.customer_id IS NULL
        AND b.cancelled_at IS NULL
        AND b.id IS DISTINCT FROM p_exclude_bl_id
        AND COALESCE(b.customer_reconciliation_status, 'missing_customer') <> 'rejected'
        AND NOT EXISTS (
          SELECT 1 FROM public.voyages AS v
          WHERE v.id = b.voyage_id AND v.status = 'cancelled'
        )
      RETURNING b.id, b.consignee, b.customer_id
  )
  -- D15: com Cliente desativado, `guard_bl_link_to_deactivated_customer`
  -- transforma o vínculo em sugestão (customer_id volta nulo): não é vínculo.
  SELECT array_agg(id ORDER BY id) FILTER (WHERE customer_id IS NOT NULL),
         array_agg(DISTINCT consignee) FILTER (WHERE customer_id IS NOT NULL),
         array_agg(id ORDER BY id) FILTER (WHERE customer_id IS NULL)
    INTO v_linked, v_consignees, v_suggested
  FROM linked;
  IF v_suggested IS NOT NULL THEN
    FOREACH v_bl IN ARRAY v_suggested LOOP
      PERFORM public.recompute_bl_review_status(v_bl);
      PERFORM public.sync_customer_reconciliation_queue_for_bl(v_bl);
    END LOOP;
  END IF;

  IF v_linked IS NOT NULL THEN
    FOREACH v_bl IN ARRAY v_linked LOOP
      INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
      VALUES ('bl', v_bl, 'customer_id', NULL, p_customer_id::text, p_actor, p_justification);
    END LOOP;
    -- O gate da importação captura o contato do manifesto, mas só acrescenta
    -- pendências. Quem libera a Revisão é a dona da regra (V1):
    -- `recompute_bl_review_status` (168) tira a nota "Pendencias de
    -- importacao" velha e devolve o B/L a `reviewed` quando não sobra
    -- pendência real; com pendência real (ex.: Portal não provisionado), fica
    -- só ela. A fila de Reconciliação de Cliente acompanha o vínculo.
    PERFORM public.apply_bl_review_gate_after_import(v_linked, p_actor);
    FOREACH v_bl IN ARRAY v_linked LOOP
      PERFORM public.recompute_bl_review_status(v_bl);
      PERFORM public.sync_customer_reconciliation_queue_for_bl(v_bl);
    END LOOP;
  END IF;
  PERFORM set_config('vela.bl_review_batch', COALESCE(NULLIF(v_previous_batch, ''), 'off'), true);

  IF v_linked IS NOT NULL THEN
    -- Um Alerta por Cliente e um por consignatário que deixou de estar sem
    -- Cliente, já com a contagem final (como a 168 e a 170).
    PERFORM public.reconcile_customer_bl_review_alerts(p_customer_id, NULL, p_alert_source);
    FOREACH v_consignee IN ARRAY v_consignees LOOP
      PERFORM public.reconcile_customer_bl_review_alerts(NULL, v_consignee, p_alert_source);
    END LOOP;
    -- O faturamento segue: com o Cliente, as Taxas Locais são calculadas.
    FOREACH v_bl IN ARRAY v_linked LOOP
      BEGIN
        PERFORM public.calculate_bl_local_charges(v_bl, p_actor, true);
      EXCEPTION WHEN OTHERS THEN
        IF p_refuse_on_charge_failure THEN
          -- ADR 0094, B3: quem chama é recusado inteiro.
          PERFORM public._raise_local_charge_failure(v_bl, SQLSTATE, SQLERRM);
        END IF;
        -- Sem recusa (Novo cliente): o vínculo fica, o cálculo não; o motivo
        -- volta para a tela, nunca em silêncio.
        v_charges_failed := v_charges_failed || jsonb_build_array(jsonb_build_object('bl_id', v_bl, 'reason', SQLERRM));
      END;
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'linked_bl_ids', to_jsonb(COALESCE(v_linked, ARRAY[]::text[])),
    'bls_suggested', COALESCE(cardinality(v_suggested), 0),
    'charges_failed', v_charges_failed
  );
END;
$function$;

REVOKE ALL ON FUNCTION public._link_pending_bls_to_customer(bigint, uuid, text, text, boolean, text) FROM PUBLIC, anon, authenticated;

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
  v_link jsonb;
  -- 474 (D10): só quem edita contatos inclui ou muda contatos pela Base.
  v_can_contacts boolean := public._can_edit_customer_contacts();
  -- 474 (D15): Cliente desativado não muda pela Base.
  v_deactivated boolean := false;
BEGIN
  IF v_actor IS NULL OR NOT public.is_active_user() OR p_changed_by IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'Usuário sem permissão ativa.' USING ERRCODE = '42501';
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
    SELECT name, deactivated_at IS NOT NULL INTO v_current_name, v_deactivated FROM public.customers WHERE id = v_customer_id;
    IF upper(btrim(regexp_replace(COALESCE(v_current_name, ''), '[^[:alnum:]]+', ' ', 'g'))) <> upper(btrim(regexp_replace(v_name, '[^[:alnum:]]+', ' ', 'g')))
       AND NOT COALESCE(p_confirm_name_change, false) AND NOT v_deactivated THEN
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
  ELSIF NOT v_deactivated THEN
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
  IF v_can_contacts AND NOT v_deactivated THEN
  UPDATE public.customer_contacts AS cc
  SET is_primary = false,
      updated_at = now()
  WHERE cc.customer_id = v_customer_id
    AND cc.is_primary = true
    AND cc.deactivated_at IS NULL
    AND cc.email_normalized IS NULL;
  END IF;

  -- Contatos: valida formato e duplicata no envio; existente e no-op.
  -- O primeiro e-mail elegível assume a principalidade se ainda não houver
  -- um principal ativo com e-mail; a decisão é reavaliada a cada iteração.
  FOR v_email IN SELECT value #>> '{}' FROM jsonb_array_elements(p_emails)
  LOOP
    v_norm := lower(NULLIF(btrim(COALESCE(v_email, '')), ''));
    IF v_norm IS NULL OR v_norm !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
      RAISE EXCEPTION 'E-mail inválido para o cliente %: %', v_cnpj, COALESCE(v_email, '') USING ERRCODE = '22023';
    END IF;
    IF v_norm = ANY (v_seen) THEN
      RAISE EXCEPTION 'E-mail duplicado no envio: %', v_norm USING ERRCODE = '23505';
    END IF;
    v_seen := array_append(v_seen, v_norm);
    CONTINUE WHEN NOT v_can_contacts OR v_deactivated;

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

  -- Vínculo retroativo (ADR 0078, item 24): a regra mora em
  -- `_link_pending_bls_to_customer` (610), a mesma do Novo cliente. Na Base,
  -- falha no cálculo das Taxas Locais recusa a linha inteira (ADR 0094, B3).
  v_link := public._link_pending_bls_to_customer(
    v_customer_id, v_actor, 'Vínculo por documento pela Base de Clientes', 'customer_base_link', true, NULL);
  v_bls_linked := jsonb_array_length(v_link->'linked_bl_ids');

  RETURN jsonb_build_object(
    'customer_id', v_customer_id,
    'created', v_created,
    'contacts_created', v_contacts_created,
    'bls_linked', v_bls_linked,
    'linked_bl_ids', v_link->'linked_bl_ids',
    'bls_suggested', (v_link->>'bls_suggested')::integer,
    'customer_deactivated', v_deactivated,
    'contacts_skipped', NOT v_can_contacts
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_customer_with_contacts(p_customer jsonb, p_contacts jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_customer public.customers%ROWTYPE;
  v_contact jsonb;
  v_has_primary boolean := false;
  v_primary_email text;
  v_contact_id bigint;
  v_box_codes jsonb;
  v_box_code text;
  v_email text;
  v_is_primary boolean;
  v_link jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuário sem permissão para criar cliente.' USING ERRCODE = '42501';
  END IF;
  -- 486 (decisão do dono, P10): o Novo cliente grava contatos, que só
  -- Administrativo, Documentação e Equipamentos incluem (ACE-D04, D10). O
  -- Cliente do manifesto, cadastrado pela ficha do B/L com o e-mail do
  -- documento, vem por `create_customer_from_bl_manifest`, aberto a todos.
  IF NOT public._can_edit_customer_contacts()
     AND current_setting('vela.customer_from_manifest', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Novo cliente é de Administrativo, Documentação e Equipamentos, porque grava os contatos. Traga o Cliente pela Base de Clientes ou pela Revisão.' USING ERRCODE = '42501';
  END IF;

  IF jsonb_typeof(p_customer) <> 'object'
     OR jsonb_typeof(p_contacts) <> 'array'
     OR NULLIF(btrim(p_customer->>'cnpj_cpf'), '') IS NULL
     OR NULLIF(btrim(p_customer->>'name'), '') IS NULL THEN
    RAISE EXCEPTION 'Cadastro de cliente invalido.' USING ERRCODE = '22023';
  END IF;

  -- Exige pelo menos um contato que seja principal e tenha e-mail
  FOR v_contact IN SELECT * FROM jsonb_array_elements(p_contacts)
  LOOP
    IF COALESCE((v_contact->>'is_primary')::boolean, false) = true THEN
      v_has_primary := true;
      v_primary_email := NULLIF(lower(btrim(COALESCE(v_contact->>'email', ''))), '');
    END IF;
  END LOOP;

  IF NOT v_has_primary OR v_primary_email IS NULL THEN
    RAISE EXCEPTION 'Criação de cliente exige ao menos um contato principal com e-mail válido.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.customers (
    cnpj_cpf, name, trade_name, address, city, state, zip, notes
  )
  VALUES (
    btrim(p_customer->>'cnpj_cpf'),
    btrim(p_customer->>'name'),
    NULLIF(btrim(p_customer->>'trade_name'), ''),
    NULLIF(btrim(p_customer->>'address'), ''),
    NULLIF(btrim(p_customer->>'city'), ''),
    NULLIF(btrim(p_customer->>'state'), ''),
    NULLIF(btrim(p_customer->>'zip'), ''),
    NULLIF(btrim(p_customer->>'notes'), '')
  )
  RETURNING * INTO v_customer;

  -- Inserir contatos e vincular caixas
  FOR v_contact IN SELECT * FROM jsonb_array_elements(p_contacts)
  LOOP
    v_email := NULLIF(lower(btrim(COALESCE(v_contact->>'email', ''))), '');
    v_is_primary := COALESCE((v_contact->>'is_primary')::boolean, false);
    v_box_codes := v_contact->'box_codes';

    IF v_email IS NOT NULL THEN
      INSERT INTO public.customer_contacts (
        customer_id, name, email, phone, purpose, is_primary, origin
      )
      VALUES (
        v_customer.id,
        NULLIF(btrim(v_contact->>'name'), ''),
        v_email,
        NULLIF(btrim(v_contact->>'phone'), ''),
        COALESCE(NULLIF(btrim(v_contact->>'purpose'), ''), 'geral'),
        v_is_primary,
        'interno'
      )
      RETURNING id INTO v_contact_id;

      IF v_is_primary THEN
        -- Principal recebe as 3 caixas
        INSERT INTO public.customer_contact_box_links (contact_id, box_code)
        SELECT v_contact_id, code
        FROM public.customer_communication_boxes
        WHERE active = true
        ON CONFLICT DO NOTHING;
      ELSE
        -- Adicionais recebem as caixas informadas ou documentacao_operacao
        IF v_box_codes IS NOT NULL AND jsonb_array_length(v_box_codes) > 0 THEN
          FOR v_box_code IN SELECT jsonb_array_elements_text(v_box_codes)
          LOOP
            INSERT INTO public.customer_contact_box_links (contact_id, box_code)
            VALUES (v_contact_id, v_box_code)
            ON CONFLICT DO NOTHING;
          END LOOP;
        ELSE
          INSERT INTO public.customer_contact_box_links (contact_id, box_code)
          VALUES (v_contact_id, 'documentacao_operacao')
          ON CONFLICT DO NOTHING;
        END IF;
      END IF;
    END IF;
  END LOOP;

  -- Registrar evento inicial
  INSERT INTO public.customer_contact_change_events (
    customer_id, source, actor_id, after_snapshot, change_summary
  )
  VALUES (
    v_customer.id,
    'interno',
    auth.uid(),
    (public._build_customer_contact_configuration(v_customer.id))->'contacts',
    jsonb_build_object('action', 'customer_created')
  );

  -- 610: B/L pendente de Cliente com o mesmo CNPJ é vinculado por documento,
  -- como na Base de Clientes. Falha no cálculo das Taxas Locais não desfaz o
  -- cadastro: o B/L fica vinculado sem o cálculo e volta em `charges_failed`,
  -- que a tela mostra com o motivo. O B/L do cadastro pela ficha do B/L
  -- (`vela.customer_from_manifest_bl`) fica de fora: a ficha o vincula em
  -- seguida, com a própria confirmação.
  v_link := public._link_pending_bls_to_customer(
    v_customer.id, auth.uid(), 'Vínculo por documento no cadastro do Cliente', 'customer_created_link', false,
    NULLIF(current_setting('vela.customer_from_manifest_bl', true), ''));

  RETURN to_jsonb(v_customer) || jsonb_build_object('bl_link', v_link);
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_customer_from_bl_manifest(p_bl_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_bl public.bls%ROWTYPE;
  v_cnpj text;
  v_email text;
  v_existing public.customers%ROWTYPE;
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuário sem permissão para criar cliente.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_bl FROM public.bls WHERE id = p_bl_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L % não encontrado.', p_bl_id USING ERRCODE = 'P0002';
  END IF;
  v_cnpj := public.normalize_cnpj(v_bl.manifest_customer_cnpj_cpf);
  v_email := NULLIF(lower(btrim(COALESCE(v_bl.manifest_customer_email, ''))), '');
  IF v_cnpj IS NULL OR NULLIF(btrim(COALESCE(v_bl.manifest_customer_name, '')), '') IS NULL THEN
    RAISE EXCEPTION 'O manifesto do B/L % não traz o Cliente (razão social e CNPJ).', p_bl_id USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_existing FROM public.customers WHERE cnpj_cpf = v_cnpj;
  IF FOUND THEN
    RETURN to_jsonb(v_existing);
  END IF;
  IF v_email IS NULL OR position('@' IN v_email) = 0 THEN
    RAISE EXCEPTION 'O cliente do manifesto não está cadastrado e o manifesto não traz e-mail. Cadastre-o em Clientes e vincule pela busca.' USING ERRCODE = '22023';
  END IF;
  PERFORM set_config('vela.customer_from_manifest', 'on', true);
  -- 610: o vínculo automático do cadastro deixa este B/L para a ficha.
  PERFORM set_config('vela.customer_from_manifest_bl', p_bl_id, true);
  v_result := public.create_customer_with_contacts(
    jsonb_build_object('cnpj_cpf', v_cnpj, 'name', btrim(v_bl.manifest_customer_name)),
    jsonb_build_array(jsonb_build_object('email', v_email, 'purpose', 'geral',
      'is_primary', true, 'box_codes', jsonb_build_array('documentacao_operacao', 'financeiro', 'demurrage'))));
  PERFORM set_config('vela.customer_from_manifest', '', true);
  PERFORM set_config('vela.customer_from_manifest_bl', '', true);
  RETURN v_result;
END;
$function$;
