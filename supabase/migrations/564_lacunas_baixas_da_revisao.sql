-- 564: lacunas baixas da revisão da release 2026-11-01 (PR #1142).
--
-- Decisões do dono de 2026-11-01 (corrigir antes da release):
--   1. "B/L criado" em lote: o gatilho da 560 (`audit_bl_created`, por linha,
--      plpgsql) deixava o INSERT em `bls` ~2,5× mais lento (1,4 s de 2,4 s
--      num INSERT de 2.000 B/Ls no Postgres 16 local). Passa a um gatilho por
--      comando com tabela de transição (`audit_bl_created_batch`): um único
--      INSERT … SELECT em `audit_logs` por comando, com o mesmo resumo, o
--      mesmo autor e o mesmo contexto da importação. ON CONFLICT DO UPDATE
--      (reimportação) continua sem linha: a tabela de transição do INSERT só
--      traz as linhas inseridas.
--   2. Reabertura do ADR sem terminal (`reopen_agency_departure_report`, 509)
--      gravava a linha com a chave `viagem::PORTO`; o fechamento (559) e a
--      reabertura por `report_id` gravam o id do ADR. Fechar e reabrir o mesmo
--      ADR apareciam no Histórico de ações como dois registros. Passa a gravar
--      o id do ADR (o corpo da 509 com só a chave trocada). A guarda de
--      exclusão de ADR vazio (556) já procura pelo id do ADR. A Linha do Tempo
--      do ADR não lê esta linha (lê os sign-offs dos departamentos).
--   3. `_apply_customer_contact_configuration` (245) gravava "Contato" no
--      contato novo sem nome; a 557 passou o cadastro a gravar em branco.
--      Mesmo tratamento aqui (corpo da 245 com só esse valor trocado). A tela
--      exige o nome; o caso só chegava por chamada direta.
--
-- Só redefine funções e gatilhos; não grava nem reescreve linhas existentes.
-- CREATE OR REPLACE mantém os privilégios das funções redefinidas.
--
-- Rollback: recriar `audit_bl_created` e os gatilhos `audit_bls_created` e
-- `audit_granite_bls_created` como na 560 e apagar `audit_bl_created_batch`;
-- recriar `reopen_agency_departure_report` com o corpo da 509 e
-- `_apply_customer_contact_configuration` com o corpo da 245.

-- 1 -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.audit_bl_created_batch()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  -- Pelo JSON: o mesmo gatilho serve a `bls` e `granite_bls`, que têm
  -- colunas diferentes.
  v_keys text[] := CASE TG_TABLE_NAME
    WHEN 'bls' THEN ARRAY['id', 'voyage_id', 'customer_id', 'cargo_mode', 'pol', 'pod', 'batch_id']
    ELSE ARRAY['id', 'bl_number', 'manifest_id', 'client_id']
  END;
  v_actor uuid := auth.uid();
  v_context text := NULLIF(btrim(current_setting('vela.import_context', true)), '');
BEGIN
  -- Resumo, não o registro inteiro: uma importação grava centenas de B/Ls.
  INSERT INTO public.audit_logs (entity_type, entity_id, field_name, new_value, changed_by, justification)
  SELECT TG_TABLE_NAME, r.row ->> 'id', 'criado',
         (SELECT jsonb_object_agg(k, r.row -> k)
            FROM unnest(v_keys) AS k
           WHERE r.row -> k IS NOT NULL AND r.row -> k <> 'null'::jsonb)::text,
         v_actor, v_context
    FROM (SELECT to_jsonb(n) AS row FROM new_rows AS n) AS r;
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public.audit_bl_created_batch() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS audit_bls_created ON public.bls;
CREATE TRIGGER audit_bls_created
  AFTER INSERT ON public.bls
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_bl_created_batch();

DROP TRIGGER IF EXISTS audit_granite_bls_created ON public.granite_bls;
CREATE TRIGGER audit_granite_bls_created
  AFTER INSERT ON public.granite_bls
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_bl_created_batch();

DROP FUNCTION IF EXISTS public.audit_bl_created();

-- 2 -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reopen_agency_departure_report(p_voyage_id bigint, p_port text, p_justification text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_report_id UUID;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501';
  END IF;
  IF btrim(COALESCE(p_justification, '')) = '' THEN
    RAISE EXCEPTION 'Reabertura exige justificativa.' USING ERRCODE = '22023';
  END IF;
  SELECT id INTO v_report_id
  FROM public.agency_departure_reports
  WHERE voyage_id = p_voyage_id
    AND port = upper(btrim(p_port))
    AND status = 'closed'
    AND terminal_id IS NULL
  FOR UPDATE;
  IF v_report_id IS NULL THEN
    RAISE EXCEPTION 'ADR nao esta fechado.' USING ERRCODE = 'P0002';
  END IF;
  UPDATE public.agency_departure_reports
  SET status = 'open', closed_at = NULL, closed_by = NULL, closed_snapshot = NULL
  WHERE id = v_report_id;
  INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  -- 564: a chave é o próprio ADR, como o fechamento (559) e a reabertura
  -- por report_id gravam: fechar e reabrir ficam no mesmo registro.
  VALUES ('agency_departure_report', v_report_id::text,
          'status', 'closed', 'open', auth.uid(), btrim(p_justification));
  RETURN jsonb_build_object('report_id', v_report_id);
END;
$function$;

-- 3 -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._apply_customer_contact_configuration(p_customer_id bigint, p_contacts jsonb, p_source text, p_actor_id uuid DEFAULT NULL, p_portal_account_id bigint DEFAULT NULL, p_related_bl_id text DEFAULT NULL, p_justification text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_before_config jsonb;
  v_after_config jsonb;
  v_item jsonb;
  v_item_id bigint;
  v_item_name text;
  v_item_email text;
  v_item_phone text;
  v_item_is_primary boolean;
  v_item_active boolean;
  v_item_boxes jsonb;
  v_box_code text;
  v_active_primary_count integer := 0;
  v_seen_emails text[] := ARRAY[]::text[];
  v_target_contact_ids bigint[] := ARRAY[]::bigint[];
  v_existing_dup record;
  v_active_box record;
  v_box_has_recipient boolean;
  v_box_has_linked boolean;
  v_new_id bigint;
  v_action_id uuid := gen_random_uuid();
  v_contact_box_codes text[];
  v_suppression_reason text;
  v_suppressed_only_boxes text[] := ARRAY[]::text[];
  v_ids_with_email bigint[] := ARRAY[]::bigint[];
BEGIN
  IF p_customer_id IS NULL THEN
    RAISE EXCEPTION 'ID do cliente é obrigatório.' USING ERRCODE = '22023';
  END IF;

  IF p_source NOT IN ('portal', 'interno', 'bl_automatico', 'sistema') THEN
    RAISE EXCEPTION 'Origem inválida: %', p_source USING ERRCODE = '22023';
  END IF;

  IF jsonb_typeof(p_contacts) <> 'array' THEN
    RAISE EXCEPTION 'Payload de contatos inválido (esperado array).' USING ERRCODE = '22023';
  END IF;

  -- Lock pessimista no cliente para serializar mutacoes
  PERFORM 1 FROM public.customers WHERE id = p_customer_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cliente % não encontrado.', p_customer_id USING ERRCODE = '02000';
  END IF;

  -- Pre-popular IDs dos contatos enviados no payload para evitar sensibilidade à ordem de validação
  SELECT COALESCE(array_agg(NULLIF(elem->>'id', '')::bigint), ARRAY[]::bigint[])
  INTO v_target_contact_ids
  FROM jsonb_array_elements(p_contacts) elem
  WHERE NULLIF(elem->>'id', '') IS NOT NULL;

  -- IDs cujo payload traz e-mail (para liberacao previa do indice unico e
  -- suporte a troca de e-mails entre contatos sem erro cru de constraint).
  SELECT COALESCE(array_agg(NULLIF(elem->>'id', '')::bigint), ARRAY[]::bigint[])
  INTO v_ids_with_email
  FROM jsonb_array_elements(p_contacts) elem
  WHERE NULLIF(elem->>'id', '') IS NOT NULL
    AND NULLIF(lower(btrim(COALESCE(elem->>'email', ''))), '') IS NOT NULL;

  -- Snapshot anterior
  v_before_config := public._build_customer_contact_configuration(p_customer_id);

  -- -------------------------------------------------------------------------
  -- Validacao pre-transacao em lote
  -- -------------------------------------------------------------------------
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_contacts)
  LOOP
    IF jsonb_typeof(v_item) <> 'object' THEN
      RAISE EXCEPTION 'Item de contato inválido.' USING ERRCODE = '22023';
    END IF;

    v_item_id := NULLIF(v_item->>'id', '')::bigint;
    v_item_name := NULLIF(btrim(COALESCE(v_item->>'name', '')), '');
    v_item_email := NULLIF(lower(btrim(COALESCE(v_item->>'email', ''))), '');
    v_item_phone := NULLIF(btrim(COALESCE(v_item->>'phone', '')), '');
    v_item_is_primary := COALESCE((v_item->>'is_primary')::boolean, false);
    v_item_active := COALESCE((v_item->>'active')::boolean, true);
    v_item_boxes := COALESCE(v_item->'box_codes', '[]'::jsonb);

    -- Pertencimento ao cliente
    IF v_item_id IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.customer_contacts
        WHERE id = v_item_id AND customer_id = p_customer_id
      ) THEN
        RAISE EXCEPTION 'Contato % não pertence ao cliente %.', v_item_id, p_customer_id USING ERRCODE = '42501';
      END IF;
    END IF;

    -- Validacao de e-mail em contatos ativos ou novos
    -- (ponytail: v_seen rastreia TODOS os e-mails do payload, inclusive de
    -- inativos — o contrato e "inclusive contra um registro inativo". Antes,
    -- reutilizar o e-mail de um inativo presente no payload passava na
    -- validacao e morria no indice com "Este registro ja existe".)
    IF v_item_email IS NOT NULL THEN
      IF v_item_email = ANY(v_seen_emails) THEN
        RAISE EXCEPTION 'E-mail duplicado no envio: %', v_item_email USING ERRCODE = '23505';
      END IF;
      v_seen_emails := array_append(v_seen_emails, v_item_email);
    END IF;

    IF v_item_active OR v_item_id IS NULL THEN
      IF v_item_email IS NULL THEN
        RAISE EXCEPTION 'E-mail é obrigatório para contato ativo.' USING ERRCODE = '22023';
      END IF;

      IF v_item_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
        RAISE EXCEPTION 'E-mail inválido: %', v_item_email USING ERRCODE = '22023';
      END IF;

      -- Unicidade contra registros existentes do mesmo cliente fora do payload
      -- (exclui o payload inteiro para permitir troca de e-mails entre dois
      -- contatos; duplicidade dentro do payload ja caiu no v_seen acima,
      -- inclusive para inativos.)
      SELECT id, name, email INTO v_existing_dup
      FROM public.customer_contacts
      WHERE customer_id = p_customer_id
        AND email_normalized = v_item_email
        AND (v_item_id IS NULL OR id <> v_item_id)
        AND id <> ALL(v_target_contact_ids);

      IF FOUND THEN
        RAISE EXCEPTION 'E-mail % já cadastrado para o contato "%" (ID %).',
          v_item_email, COALESCE(v_existing_dup.name, 'sem nome'), v_existing_dup.id
          USING ERRCODE = '23505';
      END IF;
    END IF;

    -- Regras do contato principal e caixas
    IF v_item_active THEN
      IF v_item_is_primary THEN
        v_active_primary_count := v_active_primary_count + 1;
        -- Principal ativo nasce vinculado as 3 caixas se nao especificadas
        IF jsonb_array_length(v_item_boxes) = 0 THEN
          v_item_boxes := '["documentacao_operacao", "financeiro", "demurrage"]'::jsonb;
        END IF;
      ELSE
        IF jsonb_array_length(v_item_boxes) = 0 THEN
          RAISE EXCEPTION 'Contato adicional ativo deve ter ao menos uma caixa vinculada.' USING ERRCODE = '22023';
        END IF;
      END IF;

      -- Validar caixas existentes
      FOR v_box_code IN SELECT jsonb_array_elements_text(v_item_boxes)
      LOOP
        IF NOT EXISTS (
          SELECT 1 FROM public.customer_communication_boxes
          WHERE code = v_box_code AND active = true
        ) THEN
          RAISE EXCEPTION 'Caixa de comunicação inválida: %', v_box_code USING ERRCODE = '22023';
        END IF;
      END LOOP;
    END IF;
  END LOOP;

  -- Exatamente um contato principal ativo
  IF v_active_primary_count <> 1 THEN
    RAISE EXCEPTION 'O cliente deve ter exatamente um contato principal ativo.' USING ERRCODE = '22023';
  END IF;

  -- -------------------------------------------------------------------------
  -- Invariante global: nenhuma caixa ativa pode terminar sem contato vinculado.
  -- Dois niveis: (1) sem nenhum contato ativo vinculado => bloqueia (erro de
  -- usuario); (2) com vinculados mas todos suprimidos/bounce => permite salvar
  -- (caso contrario o cliente cujo unico contato sofreu bounce ficaria
  -- insalvavel — nem o telefone poderia ser corrigido) e registra alerta
  -- caixa_sem_destinatario para triagem. O repair() deliberadamente permite
  -- caixa bloqueada vazia; este nucleo nao pode contradize-lo.
  -- -------------------------------------------------------------------------
  FOR v_active_box IN
    SELECT code, label FROM public.customer_communication_boxes WHERE active = true
  LOOP
    v_box_has_recipient := false;
    v_box_has_linked := false;
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_contacts)
    LOOP
      v_item_active := COALESCE((v_item->>'active')::boolean, true);
      v_item_email := NULLIF(lower(btrim(COALESCE(v_item->>'email', ''))), '');
      v_item_is_primary := COALESCE((v_item->>'is_primary')::boolean, false);
      v_item_boxes := COALESCE(v_item->'box_codes', '[]'::jsonb);
      IF v_item_is_primary AND jsonb_array_length(v_item_boxes) = 0 THEN
        v_item_boxes := '["documentacao_operacao", "financeiro", "demurrage"]'::jsonb;
      END IF;

      IF v_item_active AND v_item_email IS NOT NULL AND (v_item_boxes ? v_active_box.code) THEN
        v_box_has_linked := true;
        -- Verificar supressao
        IF NOT EXISTS (
          SELECT 1 FROM public.portal_suppressed_emails pse
          WHERE lower(btrim(pse.email)) = v_item_email AND pse.reason = 'bounce_permanente'
        ) AND NOT EXISTS (
          SELECT 1 FROM public.customer_communication_suppressions ccs
          WHERE lower(btrim(ccs.email)) = v_item_email
        ) THEN
          v_box_has_recipient := true;
          EXIT;
        END IF;
      END IF;
    END LOOP;

    IF NOT v_box_has_linked THEN
      RAISE EXCEPTION 'A caixa "%" ficaria sem nenhum destinatário ativo elegível. Vincule outro e-mail antes de remover.',
        v_active_box.label USING ERRCODE = '22023';
    ELSIF NOT v_box_has_recipient THEN
      v_suppressed_only_boxes := array_append(v_suppressed_only_boxes, v_active_box.code);
    END IF;
  END LOOP;

  -- -------------------------------------------------------------------------
  -- Aplicacao das alteracoes no banco
  -- -------------------------------------------------------------------------

  -- Desativar contatos nao mencionados no payload (se estavam ativos)
  UPDATE public.customer_contacts
  SET deactivated_at = COALESCE(deactivated_at, now()),
      is_primary = false,
      updated_at = now()
  WHERE customer_id = p_customer_id
    AND id <> ALL(v_target_contact_ids)
    AND deactivated_at IS NULL;

  -- Liberacao previa para trocas atômicas sem violar indices nao-deferraveis:
  -- (a) e-mails dos alvos com e-mail no payload vao a NULL, liberando o indice
  -- unico para swaps; (b) primarios vao a false, liberando o indice parcial de
  -- principal unico independente da ordem do payload.
  -- (ponytail: O(n) com dois UPDATEs varrendo o cliente; teto aceitavel para
  -- cadastro (<50 contatos). Upgrade seria constraint DEFERRABLE.)
  IF cardinality(v_ids_with_email) > 0 THEN
    UPDATE public.customer_contacts
    SET email = NULL
    WHERE customer_id = p_customer_id
      AND id = ANY(v_ids_with_email);
  END IF;

  UPDATE public.customer_contacts
  SET is_primary = false
  WHERE customer_id = p_customer_id
    AND id = ANY(v_target_contact_ids)
    AND is_primary = true;

  -- Processar cada contato do payload
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_contacts)
  LOOP
    v_item_id := NULLIF(v_item->>'id', '')::bigint;
    v_item_name := NULLIF(btrim(COALESCE(v_item->>'name', '')), '');
    v_item_email := NULLIF(lower(btrim(COALESCE(v_item->>'email', ''))), '');
    v_item_phone := NULLIF(btrim(COALESCE(v_item->>'phone', '')), '');
    v_item_is_primary := COALESCE((v_item->>'is_primary')::boolean, false);
    v_item_active := COALESCE((v_item->>'active')::boolean, true);
    v_item_boxes := COALESCE(v_item->'box_codes', '[]'::jsonb);
    IF v_item_is_primary AND jsonb_array_length(v_item_boxes) = 0 THEN
      v_item_boxes := '["documentacao_operacao", "financeiro", "demurrage"]'::jsonb;
    END IF;

    IF v_item_id IS NOT NULL THEN
      -- Atualizar existente
      UPDATE public.customer_contacts
      SET name = COALESCE(v_item_name, name),
          email = COALESCE(v_item_email, email),
          phone = v_item_phone,
          is_primary = v_item_is_primary,
          deactivated_at = CASE WHEN v_item_active THEN NULL ELSE COALESCE(deactivated_at, now()) END,
          updated_at = now()
      WHERE id = v_item_id;

      IF v_item_active THEN
        -- Sincronizar vinculos da caixa para contato ativo
        SELECT array_agg(value) INTO v_contact_box_codes
        FROM jsonb_array_elements_text(v_item_boxes);

        DELETE FROM public.customer_contact_box_links
        WHERE contact_id = v_item_id
          AND box_code <> ALL(COALESCE(v_contact_box_codes, ARRAY[]::text[]));

        INSERT INTO public.customer_contact_box_links (contact_id, box_code)
        SELECT v_item_id, unnest(COALESCE(v_contact_box_codes, ARRAY[]::text[]))
        ON CONFLICT DO NOTHING;
      END IF;
      -- Contatos inativos preservam os vinculos no banco para historico
    ELSE
      -- Inserir novo contato
      INSERT INTO public.customer_contacts (
        customer_id, name, email, phone, is_primary, origin, deactivated_at
      )
      VALUES (
        p_customer_id,
        -- 564: sem nome fica em branco, como no cadastro (557).
        v_item_name,
        v_item_email,
        v_item_phone,
        v_item_is_primary,
        p_source,
        CASE WHEN v_item_active THEN NULL ELSE now() END
      )
      RETURNING id INTO v_new_id;

      IF v_item_active THEN
        SELECT array_agg(value) INTO v_contact_box_codes
        FROM jsonb_array_elements_text(v_item_boxes);

        -- Sync exato: o trigger de seed ja inseriu o default no INSERT acima;
        -- remover o excedente garante que o pedido (ex.: so financeiro) nao
        -- herde documentacao_operacao do seed.
        DELETE FROM public.customer_contact_box_links
        WHERE contact_id = v_new_id
          AND box_code <> ALL(COALESCE(v_contact_box_codes, ARRAY[]::text[]));

        INSERT INTO public.customer_contact_box_links (contact_id, box_code)
        SELECT v_new_id, unnest(COALESCE(v_contact_box_codes, ARRAY[]::text[]))
        ON CONFLICT DO NOTHING;
      END IF;
    END IF;
  END LOOP;

  -- Caixas vinculadas mas sem destinatario elegivel (todas suprimidas/bounce):
  -- save permitido para nao travar correcoes cadastrais; superficie via alerta.
  IF cardinality(v_suppressed_only_boxes) > 0 THEN
    FOR v_box_code IN SELECT unnest(v_suppressed_only_boxes)
    LOOP
      PERFORM public.upsert_alert_item(
        'caixa_sem_destinatario',
        'customer',
        p_customer_id::text,
        'A caixa ' || v_box_code || ' possui vínculos ativos mas nenhum destinatário elegível (supressão/bounce).',
        p_source,
        jsonb_build_object('customer_id', p_customer_id, 'box_code', v_box_code),
        '/clientes'
      );
    END LOOP;
  ELSE
    -- Toda caixa ativa tem destinatário elegível: o alerta fecha pela origem.
    PERFORM public.resolve_alert_item(
      'caixa_sem_destinatario', 'customer', p_customer_id::text, p_source,
      jsonb_build_object('customer_id', p_customer_id)
    );
  END IF;

  -- O salvamento exige exatamente um principal ativo (validado acima): o
  -- alerta de Cliente sem contato principal fecha pela origem.
  PERFORM public.resolve_alert_item(
    'cliente_sem_contato_principal', 'customer', p_customer_id::text, p_source,
    jsonb_build_object('customer_id', p_customer_id)
  );

  -- Snapshot posterior
  v_after_config := public._build_customer_contact_configuration(p_customer_id);

  -- Registrar evento append-only de auditoria
  INSERT INTO public.customer_contact_change_events (
    action_id, customer_id, source, actor_id, portal_account_id, related_bl_id,
    before_snapshot, after_snapshot, change_summary
  )
  VALUES (
    v_action_id,
    p_customer_id,
    p_source,
    p_actor_id,
    p_portal_account_id,
    p_related_bl_id,
    v_before_config->'contacts',
    v_after_config->'contacts',
    jsonb_build_object(
      'action', 'save_contact_configuration',
      'justification', p_justification,
      'contacts_count', jsonb_array_length(v_after_config->'contacts')
    )
  );

  RETURN v_after_config;
END;
$function$;
