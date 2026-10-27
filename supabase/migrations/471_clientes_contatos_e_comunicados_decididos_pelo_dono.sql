-- 471: Clientes, contatos e Comunicados (decisões do dono de 2026-10-27,
-- lote 6 do plano de correções).
--
-- Problema e mudança, por seção:
--   1. 06-clientes-comunicacao:D08 — o banco aceitava CNPJ de caractere repetido
--      ("00000000000000") que a tela recusa. `is_valid_cnpj` passa a recusá-lo,
--      como `src/lib/cnpj.ts`.
--   2. D10 (absorve ACE-D14) e ACE-D04 — a Base de Clientes, o cadastro pela
--      Revisão e a RPC `ensure_customer_contact_email` incluíam ou mudavam
--      contatos para qualquer setor ativo. Agora só Administrativo,
--      Documentação e Equipamentos (`_can_edit_customer_contacts`, a mesma
--      lista de `internal_save_customer_contact_configuration`); os demais
--      importam só o cadastro. A captura do e-mail do manifesto na importação
--      do B/L continua para todos, pelo núcleo interno
--      `_ensure_customer_contact_email`.
--   3. D07 — o e-mail digitado no cadastro pela Revisão entrava com origem
--      "Capturado do B/L". Passa a entrar como "Cadastrado pela equipe"
--      (`interno`).
--   4. D15 — a Base de Clientes mudava o cadastro e reativava contatos de
--      Cliente desativado e contava como vínculo o B/L que o gatilho transforma
--      em sugestão. Cliente desativado não muda pela Base (reative-o na ficha);
--      a sugestão volta separada (`bls_suggested`), sem a trilha "Vínculo por
--      documento".
--   5. D18 — a varredura de 15 minutos e o gatilho de contato fechavam o alerta
--      "Cliente sem contato alternativo" contando contato desativado. Os dois
--      contam só contatos ativos, como o processamento do bounce.
--
-- Rollback: reaplicar `is_valid_cnpj`, `complete_review_customer_group` e
-- `resolve_customer_contact_bounce_alert_on_change` da `002`,
-- `ensure_customer_contact_email` da `106`, `capture_manifest_financial_contact`
-- da `008`, `import_bl_freight_transactional_legacy_322` da `194`,
-- `apply_customer_base_row_atomic_legacy_189` da `379`,
-- `apply_customer_base_batch_atomic` da `334` e
-- `detect_customer_communication_alerts` da `315`; DROP FUNCTION
-- public._ensure_customer_contact_email(bigint, text, text, text, text, text)
-- e public._can_edit_customer_contacts().

-- 1. D08
CREATE OR REPLACE FUNCTION public.is_valid_cnpj(p_value text)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE STRICT
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_cnpj TEXT := public.normalize_cnpj(p_value);
  v_sum INTEGER;
  v_remainder INTEGER;
  v_digit INTEGER;
  v_weights INTEGER[];
  v_index INTEGER;
BEGIN
  IF v_cnpj !~ '^[0-9A-Z]{14}$' OR right(v_cnpj, 2) !~ '^[0-9]{2}$' THEN
    RETURN FALSE;
  END IF;
  -- 471 (D08): CNPJ de caractere repetido não existe na Receita; "00000000000000"
  -- passava no dígito verificador. Mesma guarda de `src/lib/cnpj.ts`.
  IF v_cnpj ~ '^(.)\1{13}$' THEN
    RETURN FALSE;
  END IF;

  v_weights := ARRAY[5,4,3,2,9,8,7,6,5,4,3,2];
  v_sum := 0;
  FOR v_index IN 1..12 LOOP
    v_sum := v_sum + (ascii(substr(v_cnpj, v_index, 1)) - 48) * v_weights[v_index];
  END LOOP;
  v_remainder := v_sum % 11;
  v_digit := 11 - v_remainder;
  IF v_digit >= 10 THEN v_digit := 0; END IF;
  IF v_digit <> substr(v_cnpj, 13, 1)::INTEGER THEN RETURN FALSE; END IF;

  v_weights := ARRAY[6,5,4,3,2,9,8,7,6,5,4,3,2];
  v_sum := 0;
  FOR v_index IN 1..13 LOOP
    v_sum := v_sum + (ascii(substr(v_cnpj, v_index, 1)) - 48) * v_weights[v_index];
  END LOOP;
  v_remainder := v_sum % 11;
  v_digit := 11 - v_remainder;
  IF v_digit >= 10 THEN v_digit := 0; END IF;
  RETURN v_digit = substr(v_cnpj, 14, 1)::INTEGER;
END;
$function$;

-- 2. D10/ACE-D04: quem inclui ou muda contatos do Cliente.
CREATE OR REPLACE FUNCTION public._can_edit_customer_contacts()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  -- Mesma lista de `internal_save_customer_contact_configuration` e de
  -- `edit_customer_contacts` na tela: Administrativo, Documentação e
  -- Equipamentos (com os nomes antigos admin/operator).
  SELECT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = auth.uid() AND active = true
      AND role IN ('administrativo', 'admin', 'documentacao', 'operator', 'equipamentos')
  );
$function$;
REVOKE ALL ON FUNCTION public._can_edit_customer_contacts() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._ensure_customer_contact_email(p_customer_id bigint, p_email text, p_contact_name text DEFAULT 'Contato manifesto'::text, p_purpose text DEFAULT 'financeiro'::text, p_related_bl_id text DEFAULT NULL::text, p_origin text DEFAULT 'bl_automatico'::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_email text;
  v_has_primary boolean := false;
  v_existing record;
  v_contact_id bigint;
BEGIN
  -- 471: núcleo interno, sem a guarda de quem chama (a de cada chamador vale).
  -- `p_origin`: `bl_automatico` (e-mail do manifesto) ou `interno` (digitado
  -- pela equipe na Revisão, D07).
  IF p_origin NOT IN ('bl_automatico', 'interno') THEN
    RAISE EXCEPTION 'Origem inválida: %', p_origin USING ERRCODE = '22023';
  END IF;

  IF p_customer_id IS NULL THEN
    RETURN false;
  END IF;

  v_email := lower(NULLIF(btrim(COALESCE(p_email, '')), ''));
  IF v_email IS NULL THEN
    RETURN false;
  END IF;

  IF v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
    RAISE EXCEPTION 'E-mail inválido.' USING ERRCODE = '22023';
  END IF;

  PERFORM 1 FROM public.customers WHERE id = p_customer_id FOR UPDATE;

  SELECT id, is_primary, deactivated_at
  INTO v_existing
  FROM public.customer_contacts
  WHERE customer_id = p_customer_id
    AND email_normalized = v_email
  FOR UPDATE;

  SELECT EXISTS (
    SELECT 1 FROM public.customer_contacts
    WHERE customer_id = p_customer_id
      AND is_primary = true
      AND deactivated_at IS NULL
  )
  INTO v_has_primary;

  IF v_existing.id IS NOT NULL THEN
    -- Ativo ou inativo: nao duplica, nao reativa, nao altera caixas
    IF v_existing.deactivated_at IS NOT NULL AND NOT v_has_primary THEN
      PERFORM public.upsert_alert_item(
        'cliente_sem_contato_principal',
        'customer',
        p_customer_id::text,
        'Endereço reapareceu no B/L mas cadastro permanece inativo',
        'bl_automatico',
        jsonb_build_object('customer_id', p_customer_id, 'email', v_email),
        '/clientes'
      );
    END IF;
    RETURN false;
  END IF;

  -- As caixas vêm do gatilho trg_seed_customer_contact_box_links.
  INSERT INTO public.customer_contacts (
    customer_id, name, email, origin, is_primary, purpose
  )
  VALUES (
    p_customer_id,
    COALESCE(NULLIF(btrim(p_contact_name), ''), 'Contato manifesto'),
    v_email,
    p_origin,
    NOT v_has_primary,
    COALESCE(NULLIF(btrim(p_purpose), ''), 'financeiro')
  )
  RETURNING id INTO v_contact_id;

  INSERT INTO public.customer_contact_change_events (
    customer_id, source, related_bl_id, after_snapshot, change_summary
  )
  VALUES (
    p_customer_id,
    p_origin,
    p_related_bl_id,
    jsonb_build_array(jsonb_build_object(
      'id', v_contact_id,
      'email', v_email,
      'is_primary', NOT v_has_primary,
      'origin', p_origin,
      'box_codes', (SELECT COALESCE(jsonb_agg(l.box_code ORDER BY l.box_code), '[]'::jsonb)
                    FROM public.customer_contact_box_links l WHERE l.contact_id = v_contact_id)
    )),
    jsonb_build_object('action', CASE WHEN p_origin = 'interno' THEN 'review_contact_added' ELSE 'bl_contact_captured' END, 'contact_id', v_contact_id, 'email', v_email, 'is_primary', NOT v_has_primary)
  );

  RETURN true;
END;
$function$;
REVOKE ALL ON FUNCTION public._ensure_customer_contact_email(bigint, text, text, text, text, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.ensure_customer_contact_email(p_customer_id bigint, p_email text, p_contact_name text DEFAULT 'Contato manifesto'::text, p_purpose text DEFAULT 'financeiro'::text, p_related_bl_id text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
BEGIN
  -- 471 (ACE-D04): chamada direta só de Administrativo, Documentação e
  -- Equipamentos (ou do service_role); a captura do manifesto usa o núcleo.
  IF auth.role() IS DISTINCT FROM 'service_role' AND (auth.uid() IS NULL OR NOT public._can_edit_customer_contacts()) THEN
    RAISE EXCEPTION 'Permissão negada para editar contatos do cliente.' USING ERRCODE = '42501';
  END IF;
  RETURN public._ensure_customer_contact_email(p_customer_id, p_email, p_contact_name, p_purpose, p_related_bl_id, 'bl_automatico');
END;
$function$;

CREATE OR REPLACE FUNCTION public.capture_manifest_financial_contact(p_customer_id bigint, p_email text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
BEGIN
  RETURN public._ensure_customer_contact_email(p_customer_id, p_email, 'Contato manifesto');
END;
$function$;

CREATE OR REPLACE FUNCTION public.import_bl_freight_transactional_legacy_322(p_bls jsonb, p_changed_by uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_result JSONB;
  v_bl_id TEXT;
  v_email TEXT;
  v_file_document TEXT;
  v_customer_id BIGINT;
  v_reasons TEXT[];
  v_human_notes TEXT;
  v_notes TEXT;
  v_review_status TEXT;
  v_financial_status TEXT;
  v_new_review_status TEXT;
  v_has_active_invoice BOOLEAN;
BEGIN
  v_result := public.import_bl_freight_transactional_legacy_284(p_bls, p_changed_by);

  FOR v_bl_id, v_email, v_file_document IN
    SELECT item->>'id', NULLIF(btrim(item->>'manifest_customer_email'), ''),
      public.normalize_document_text(item->>'manifest_customer_cnpj_cpf')
    FROM jsonb_array_elements(COALESCE(p_bls, '[]'::JSONB)) AS item
    WHERE item->>'id' IS NOT NULL
  LOOP
    IF v_email IS NOT NULL THEN
      -- M14 (migration 175): o e-mail do arquivo só vira contato do Cliente
      -- cujo CNPJ é o do arquivo; na Troca de Consignatário ele entra depois
      -- do relink, pelo gate, no Cliente novo. Migration 194 (A4): a
      -- comparação mantém as letras do CNPJ alfanumérico.
      SELECT b.customer_id INTO v_customer_id
      FROM public.bls AS b
      JOIN public.customers AS c ON c.id = b.customer_id
      WHERE b.id = v_bl_id
        AND public.normalize_document_text(c.cnpj_cpf) = v_file_document;
      IF v_customer_id IS NOT NULL THEN
        PERFORM public._ensure_customer_contact_email(v_customer_id, v_email);
      END IF;
    END IF;

    SELECT
      b.notes,
      b.review_status,
      b.financial_status,
      EXISTS (
        SELECT 1
        FROM public.invoice_bls AS ib
        JOIN public.invoices AS i ON i.id = ib.invoice_id
        WHERE ib.bl_id = b.id
          AND i.status NOT IN ('cancelled', 'obsolete')
      )
    INTO v_notes, v_review_status, v_financial_status, v_has_active_invoice
    FROM public.bls AS b
    WHERE b.id = v_bl_id;

    IF NOT FOUND THEN CONTINUE; END IF;
    IF v_financial_status = 'invoiced' OR v_has_active_invoice THEN CONTINUE; END IF;

    v_reasons := public.compute_bl_review_pendencies(v_bl_id);
    v_human_notes := btrim(
      regexp_replace(
        COALESCE(v_notes, ''),
        E'(^|\\n)Pendencias de importacao:[^\\n]*$',
        '',
        'i'
      )
    );
    v_notes := CASE
      WHEN COALESCE(cardinality(v_reasons), 0) > 0 THEN concat_ws(
        E'\n',
        NULLIF(v_human_notes, ''),
        'Pendencias de importacao: ' || array_to_string(v_reasons, ', ')
      )
      ELSE NULLIF(v_human_notes, '')
    END;

    v_new_review_status := CASE WHEN COALESCE(cardinality(v_reasons), 0) = 0 THEN 'reviewed' ELSE 'pending_review' END;

    UPDATE public.bls
    SET review_status = v_new_review_status,
        notes = v_notes
    WHERE id = v_bl_id;

    IF v_review_status IS DISTINCT FROM v_new_review_status THEN
      INSERT INTO public.audit_logs (
        entity_type, entity_id, field_name, old_value, new_value, changed_by, justification
      )
      VALUES (
        'bl', v_bl_id, 'review_status', v_review_status, v_new_review_status, p_changed_by,
        'Gate canonico reaplicado apos e-mail importado'
      );
    END IF;

    PERFORM public.sync_customer_reconciliation_queue_for_bl(v_bl_id);
  END LOOP;

  RETURN v_result;
END;
$function$;

-- 3. D10 e D07: cadastro pela Revisão
CREATE OR REPLACE FUNCTION public.complete_review_customer_group(p_bl_ids text[], p_customer_id bigint DEFAULT NULL::bigint, p_cnpj_cpf text DEFAULT NULL::text, p_name text DEFAULT NULL::text, p_email text DEFAULT NULL::text, p_changed_by uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor UUID := auth.uid();
  v_cnpj TEXT := public.normalize_cnpj(p_cnpj_cpf);
  v_name TEXT := NULLIF(btrim(p_name), '');
  v_email TEXT := lower(NULLIF(btrim(p_email), ''));
  v_customer public.customers%ROWTYPE;
  v_bl public.bls%ROWTYPE;
  v_candidates TEXT[];
  v_reasons TEXT[];
  v_human_notes TEXT;
  v_notes TEXT;
  v_bls JSONB := '[]'::JSONB;
  v_missing INTEGER := 0;
  v_requested_count INTEGER := 0;
  v_group_name_identity TEXT;
  v_bl_name_identity TEXT;
  -- 471 (D10): só quem edita contatos inclui o e-mail; os demais cadastram o Cliente.
  v_can_contacts BOOLEAN := public._can_edit_customer_contacts();
BEGIN
  IF v_actor IS NULL OR NOT public.is_active_user() OR p_changed_by IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'Usuário sem permissão ativa para concluir o grupo.' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(cardinality(p_bl_ids), 0) = 0 THEN
    RAISE EXCEPTION 'Nenhum B/L informado para o grupo.' USING ERRCODE = '22023';
  END IF;
  IF v_cnpj IS NULL OR NOT public.is_valid_cnpj(v_cnpj) THEN
    RAISE EXCEPTION 'Informe um CNPJ válido antes de vincular o grupo.' USING ERRCODE = '22023';
  END IF;
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'Informe a razão social do cliente.' USING ERRCODE = '22023';
  END IF;
  IF NOT v_can_contacts THEN
    v_email := NULL;
  ELSIF v_email IS NULL OR v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
    RAISE EXCEPTION 'Informe um e-mail válido para o cliente.' USING ERRCODE = '22023';
  END IF;

  SELECT COUNT(*)::INTEGER INTO v_requested_count
  FROM (
    SELECT b.id
    FROM public.bls AS b
    WHERE b.id = ANY(p_bl_ids)
      AND b.review_status = 'pending_review'
    ORDER BY b.id
    FOR UPDATE
  ) AS locked_bls;

  IF EXISTS (SELECT 1 FROM unnest(p_bl_ids) AS requested(id) WHERE requested.id IS NULL OR btrim(requested.id) = '')
     OR v_requested_count <> cardinality(p_bl_ids) THEN
    RAISE EXCEPTION 'Um ou mais B/Ls não estão mais pendentes de revisão.' USING ERRCODE = 'PT409';
  END IF;

  IF p_customer_id IS NOT NULL THEN
    SELECT * INTO v_customer FROM public.customers WHERE id = p_customer_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Cliente selecionado não foi encontrado.' USING ERRCODE = 'P0002';
    END IF;
    IF public.normalize_cnpj(v_customer.cnpj_cpf) IS DISTINCT FROM v_cnpj THEN
      RAISE EXCEPTION 'O CNPJ informado não corresponde ao cliente selecionado.' USING ERRCODE = '22023';
    END IF;
  ELSE
    SELECT * INTO v_customer FROM public.customers WHERE public.normalize_cnpj(cnpj_cpf) = v_cnpj FOR UPDATE;
    IF NOT FOUND THEN
      BEGIN
        INSERT INTO public.customers (cnpj_cpf, name)
        VALUES (v_cnpj, v_name)
        RETURNING * INTO v_customer;
      EXCEPTION WHEN unique_violation THEN
        SELECT * INTO v_customer FROM public.customers WHERE public.normalize_cnpj(cnpj_cpf) = v_cnpj FOR UPDATE;
        IF NOT FOUND THEN RAISE; END IF;
      END;
    END IF;
  END IF;

  FOR v_bl IN
    SELECT * FROM public.bls WHERE id = ANY(p_bl_ids) ORDER BY id FOR UPDATE
  LOOP
    v_candidates := public.review_bl_document_candidates(
      v_bl.manifest_customer_cnpj_cpf,
      v_bl.consignee_block,
      v_bl.cargo_description
    );

    -- Grupos sem evidência documental só podem reunir B/Ls do mesmo
    -- consignatário normalizado. Grupos com CNPJ são validados pelas
    -- evidências abaixo, sem exigir igualdade textual sujeita a ruído OCR.
    IF COALESCE(cardinality(v_candidates), 0) = 0 AND v_bl.customer_id IS NULL THEN
      v_bl_name_identity := lower(regexp_replace(btrim(COALESCE(v_bl.consignee, '')), '\s+', ' ', 'g'));
      IF v_bl_name_identity = '' THEN
        RAISE EXCEPTION 'O B/L % não possui CNPJ ou consignatário suficiente para validar o grupo.', v_bl.id USING ERRCODE = 'PT409';
      END IF;
      IF v_group_name_identity IS NULL THEN
        v_group_name_identity := v_bl_name_identity;
      ELSIF v_group_name_identity <> v_bl_name_identity THEN
        RAISE EXCEPTION 'Os B/Ls informados não pertencem ao mesmo grupo de consignatário.' USING ERRCODE = 'PT409';
      END IF;
    END IF;

    IF cardinality(v_candidates) > 1
       AND NOT (cardinality(p_bl_ids) = 1 AND v_cnpj = ANY(v_candidates)) THEN
      RAISE EXCEPTION 'O B/L % contém CNPJs conflitantes nas evidências.', v_bl.id USING ERRCODE = 'PT409';
    END IF;
    IF cardinality(v_candidates) = 1 AND v_cnpj <> v_candidates[1] THEN
      RAISE EXCEPTION 'O CNPJ do B/L % não corresponde ao grupo informado.', v_bl.id USING ERRCODE = 'PT409';
    END IF;
    IF v_bl.customer_id IS NOT NULL AND v_bl.customer_id <> v_customer.id THEN
      RAISE EXCEPTION 'O B/L % já está vinculado a outro cliente; corrija o vínculo individualmente.', v_bl.id USING ERRCODE = 'PT409';
    END IF;

    -- D07: digitado pela equipe, não capturado do B/L.
    IF v_email IS NOT NULL THEN
      PERFORM public._ensure_customer_contact_email(v_customer.id, v_email, v_customer.name, 'financeiro', v_bl.id, 'interno');
    END IF;

    UPDATE public.bls
    SET customer_id = v_customer.id,
        customer_reconciliation_status = 'reconciled',
        customer_reconciliation_notes = 'Cliente cadastrado/vinculado pela revisão manual por grupo.',
        suggested_customer_id = NULL
    WHERE id = v_bl.id;

    INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
    VALUES ('bl', v_bl.id, 'customer_id', v_bl.customer_id::TEXT, v_customer.id::TEXT, v_actor,
            'Onboarding transacional de cliente pela revisão manual.');

    v_reasons := public.compute_bl_review_pendencies(v_bl.id);
    v_human_notes := btrim(
      regexp_replace(
        COALESCE(v_bl.notes, ''),
        E'(^|\\n)Pendencias de importacao:[^\\n]*$',
        '',
        'i'
      )
    );
    v_notes := CASE
      WHEN COALESCE(cardinality(v_reasons), 0) > 0 THEN concat_ws(
        E'\n',
        NULLIF(v_human_notes, ''),
        'Pendencias de importacao: ' || array_to_string(v_reasons, ', ')
      )
      ELSE NULLIF(v_human_notes, '')
    END;

    UPDATE public.bls
    SET review_status = CASE WHEN COALESCE(cardinality(v_reasons), 0) = 0 THEN 'reviewed' ELSE 'pending_review' END,
        notes = v_notes
    WHERE id = v_bl.id;

    PERFORM public.sync_customer_reconciliation_queue_for_bl(v_bl.id);

    IF COALESCE(cardinality(v_reasons), 0) > 0 THEN v_missing := v_missing + 1; END IF;
    v_bls := v_bls || jsonb_build_array(jsonb_build_object(
      'bl_id', v_bl.id,
      'review_status', CASE WHEN COALESCE(cardinality(v_reasons), 0) = 0 THEN 'reviewed' ELSE 'pending_review' END,
      'pendencias', to_jsonb(v_reasons),
      'resolved', COALESCE(cardinality(v_reasons), 0) = 0
    ));
  END LOOP;

  RETURN jsonb_build_object(
    'customer', jsonb_build_object('id', v_customer.id, 'cnpj_cpf', v_customer.cnpj_cpf, 'name', v_customer.name),
    'bls', v_bls,
    'pending_count', v_missing,
    'contact_saved', v_email IS NOT NULL
  );
END;
$function$;

-- 4. D10 e D15: Base de Clientes
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
  -- 471 (D10): só quem edita contatos inclui ou muda contatos pela Base.
  v_can_contacts boolean := public._can_edit_customer_contacts();
  -- 471 (D15): Cliente desativado não muda pela Base.
  v_deactivated boolean := false;
  v_suggested text[];
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
      RAISE EXCEPTION 'E-mail invalido para o cliente %: %', v_cnpj, COALESCE(v_email, '') USING ERRCODE = '22023';
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
    'linked_bl_ids', to_jsonb(COALESCE(v_linked, ARRAY[]::text[])),
    'bls_suggested', COALESCE(cardinality(v_suggested), 0),
    'customer_deactivated', v_deactivated,
    'contacts_skipped', NOT v_can_contacts
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.apply_customer_base_batch_atomic(p_rows jsonb, p_changed_by uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET statement_timeout TO '60s'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_row jsonb;
  v_cnpj text;
  v_expected text;
  v_current text;
  v_result jsonb;
  v_errors jsonb := '[]'::jsonb;
  v_imported integer := 0;
  v_updated integer := 0;
  v_contacts integer := 0;
  v_bls integer := 0;
  v_suggested integer := 0;
  v_deactivated integer := 0;
  v_linked jsonb := '[]'::jsonb;
BEGIN
  IF v_actor IS NULL OR NOT public.is_active_user() OR p_changed_by IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa.' USING ERRCODE = '42501';
  END IF;
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION 'Base de Clientes vazia.' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_rows) > 3000 THEN
    RAISE EXCEPTION 'Base com mais de 3000 Clientes: divida o arquivo.' USING ERRCODE = '22023';
  END IF;

  BEGIN
    -- Em ordem de CNPJ: bases simultâneas travam os Clientes na mesma ordem.
    FOR v_row IN
      SELECT r.item FROM jsonb_array_elements(p_rows) AS r(item)
      ORDER BY btrim(COALESCE(r.item->>'cnpj', ''))
    LOOP
      v_cnpj := NULLIF(btrim(COALESCE(v_row->>'cnpj', '')), '');
      BEGIN
        IF jsonb_typeof(v_row) <> 'object' THEN
          RAISE EXCEPTION 'Linha da base invalida.' USING ERRCODE = '22023';
        END IF;
        -- O aceite da troca vale para o nome que a prévia mostrou.
        IF COALESCE((v_row->>'confirm_name_change')::boolean, false) THEN
          -- Comparação exata: a tela manda o nome como o leu (sem trim).
          v_expected := v_row->>'expected_current_name';
          SELECT name INTO v_current
          FROM public.customers WHERE cnpj_cpf = v_cnpj FOR UPDATE;
          IF v_expected IS NULL OR NOT FOUND OR v_current IS DISTINCT FROM v_expected THEN
            RAISE EXCEPTION 'A razão social do Cliente % mudou depois da prévia: leia o arquivo de novo.', v_cnpj
              USING ERRCODE = 'P0001';
          END IF;
        END IF;

        v_result := public.apply_customer_base_row_atomic(
          v_cnpj,
          v_row->>'name',
          v_row->>'trade_name',
          v_row->>'address',
          v_row->>'city',
          v_row->>'state',
          v_row->>'zip',
          COALESCE(v_row->'emails', '[]'::jsonb),
          p_changed_by,
          COALESCE((v_row->>'confirm_name_change')::boolean, false)
        );
        IF COALESCE((v_result->>'created')::boolean, false) THEN
          v_imported := v_imported + 1;
        ELSE
          v_updated := v_updated + 1;
        END IF;
        v_contacts := v_contacts + COALESCE((v_result->>'contacts_created')::integer, 0);
        v_bls := v_bls + COALESCE((v_result->>'bls_linked')::integer, 0);
        v_suggested := v_suggested + COALESCE((v_result->>'bls_suggested')::integer, 0);
        IF COALESCE((v_result->>'customer_deactivated')::boolean, false) THEN
          v_deactivated := v_deactivated + 1;
        END IF;
        v_linked := v_linked || COALESCE(v_result->'linked_bl_ids', '[]'::jsonb);
      EXCEPTION WHEN OTHERS THEN
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'cnpj', COALESCE(v_cnpj, ''), 'code', SQLSTATE, 'message', SQLERRM));
      END;
    END LOOP;

    IF jsonb_array_length(v_errors) > 0 THEN
      -- Desfaz os Clientes aceitos: a base é recusada inteira.
      RAISE EXCEPTION 'base de clientes recusada' USING ERRCODE = 'VB334';
    END IF;
  EXCEPTION WHEN SQLSTATE 'VB334' THEN
    RETURN jsonb_build_object('ok', false, 'errors', v_errors);
  END;

  RETURN jsonb_build_object(
    'ok', true,
    'imported', v_imported,
    'updated', v_updated,
    'contacts_created', v_contacts,
    'bls_linked', v_bls,
    'linked_bl_ids', v_linked,
    'bls_suggested', v_suggested,
    'deactivated_skipped', v_deactivated,
    'contacts_skipped', NOT public._can_edit_customer_contacts()
  );
END;
$function$;

-- 5. D18
CREATE OR REPLACE FUNCTION public.detect_customer_communication_alerts()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_now TIMESTAMPTZ := now();
  v_source TEXT := 'customer_communication_detector';
  v_pending RECORD;
  v_stale RECORD;
  v_customer RECORD;
  v_keys text[] := '{}'::text[];
  v_has_bounced_contact BOOLEAN;
  v_valid_contacts INTEGER;
  v_noa_pending INTEGER := 0;
  v_nor_pending INTEGER := 0;
  v_nob_pending INTEGER := 0;
  v_bounce_pending INTEGER := 0;
  v_stale_pending_settled INTEGER := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Executor server-only.' USING ERRCODE = '42501';
  END IF;

  -- 315: Comunicado "Em envio" sem dono vira falha. Falha aqui não derruba os
  -- alertas abaixo.
  BEGIN
    v_stale_pending_settled := public.settle_stale_pending_customer_communications();
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Comunicados pendentes nao reconciliados: %', SQLERRM;
  END;

  -- Um item por escala (NOA/NOR) ou Atracação (NOB) que ainda tem Cliente sem
  -- Comunicado entregue a todos os destinatários (migration 315; simulado
  -- conta, D4). Escala sem alvo não abre item.
  FOR v_pending IN
    SELECT t.kind, t.voyage_id, t.port, t.milestone_at, t.milestone_text,
      t.anchor_atracacao_id, t.terminal_id, t.terminal_code,
      CASE WHEN t.kind = 'aviso_chegada_noa' THEN 'comunicado_noa_pendente'
           WHEN t.kind = 'aviso_prontidao_nor' THEN 'comunicado_nor_pendente'
           ELSE 'comunicado_nob_pendente' END AS item_type,
      CASE WHEN t.kind = 'aviso_atracacao_nob' THEN 'voyage_escala_terminal' ELSE 'voyage_pod_schedule' END AS entity_type,
      t.voyage_id || '::' || t.port || CASE WHEN t.kind = 'aviso_atracacao_nob' THEN '::' || t.terminal_code ELSE '' END AS entity_id,
      string_agg(t.customer_name, ', ' ORDER BY t.customer_name) AS customers,
      jsonb_agg(t.customer_id ORDER BY t.customer_id) AS customer_ids
    FROM public.customer_communication_automation_targets(v_now) t
    WHERE t.kind IN ('aviso_chegada_noa', 'aviso_prontidao_nor', 'aviso_atracacao_nob')
    GROUP BY t.kind, t.voyage_id, t.port, t.milestone_at, t.milestone_text,
      t.anchor_atracacao_id, t.terminal_id, t.terminal_code
  LOOP
    v_keys := v_keys || (v_pending.item_type || '|' || v_pending.entity_id);
    IF v_pending.kind = 'aviso_chegada_noa' THEN v_noa_pending := v_noa_pending + 1;
    ELSIF v_pending.kind = 'aviso_prontidao_nor' THEN v_nor_pending := v_nor_pending + 1;
    ELSE v_nob_pending := v_nob_pending + 1;
    END IF;
    PERFORM public.upsert_alert_item(
      v_pending.item_type, v_pending.entity_type, v_pending.entity_id,
      CASE v_pending.kind
        WHEN 'aviso_chegada_noa' THEN 'NOA pendente para a escala ' || v_pending.port
          || ' (ETA ' || public.customer_communication_milestone_label(v_pending.milestone_text) || ')'
        WHEN 'aviso_prontidao_nor' THEN 'NOR pendente para a escala ' || v_pending.port
          || ' (ATA ' || public.customer_communication_milestone_label(v_pending.milestone_text) || ')'
        ELSE 'NOB pendente no terminal ' || v_pending.terminal_code || ' para a escala ' || v_pending.port
          || ' (ATB ' || public.customer_communication_milestone_label(v_pending.milestone_text) || ')'
      END || ': ' || v_pending.customers,
      v_source, 'documentacao',
      jsonb_strip_nulls(jsonb_build_object(
        'voyage_id', v_pending.voyage_id,
        'port', v_pending.port,
        'milestone', CASE v_pending.kind WHEN 'aviso_chegada_noa' THEN 'eta' WHEN 'aviso_prontidao_nor' THEN 'ata' ELSE 'atb' END,
        'milestone_at', v_pending.milestone_at,
        'terminal_id', v_pending.terminal_id,
        'terminal_code', v_pending.terminal_code,
        'state_id', v_pending.anchor_atracacao_id,
        'customer_ids', v_pending.customer_ids,
        'window_days', CASE WHEN v_pending.kind = 'aviso_chegada_noa' THEN 5 ELSE 30 END
      )),
      '/clientes/comunicacao'
    );
  END LOOP;

  -- Fecha o que não é mais alvo: entregue a todos, janela vencida, escala
  -- excluída ou omitida, terminal removido, sem B/L elegível.
  FOR v_stale IN
    SELECT DISTINCT i.item_type, a.entity_type, a.entity_id
    FROM public.alert_items i
    JOIN public.alerts a ON a.id = i.alert_id
    WHERE i.item_type IN ('comunicado_noa_pendente', 'comunicado_nor_pendente', 'comunicado_nob_pendente')
      AND i.status = 'active'
  LOOP
    IF NOT (v_stale.item_type || '|' || v_stale.entity_id) = ANY(v_keys) THEN
      PERFORM public.resolve_alert_item(
        v_stale.item_type, v_stale.entity_type, v_stale.entity_id,
        v_source, jsonb_build_object('reason', 'no_pending_target')
      );
    END IF;
  END LOOP;

  -- A cascata de bounce é o produtor imediato, mas a varredura também fecha
  -- a pendência quando um novo contato válido é cadastrado na Ficha.
  FOR v_customer IN
    SELECT c.id, c.cnpj_cpf
    FROM public.customers c
  LOOP
    SELECT
      EXISTS (
        SELECT 1
        FROM public.customer_contacts cc
        JOIN public.portal_suppressed_emails pse
          ON lower(btrim(pse.email)) = lower(btrim(cc.email))
         AND pse.reason = 'bounce_permanente'
        WHERE cc.customer_id = v_customer.id
          AND cc.deactivated_at IS NULL
          AND NULLIF(btrim(cc.email), '') IS NOT NULL
      ),
      -- 471 (D18): só contato ativo conta como alternativa, como no bounce.
      COUNT(*) FILTER (
        WHERE cc.deactivated_at IS NULL
          AND NULLIF(btrim(cc.email), '') IS NOT NULL
          AND NOT EXISTS (
            SELECT 1
            FROM public.portal_suppressed_emails pse
            WHERE lower(btrim(pse.email)) = lower(btrim(cc.email))
          )
      )::INTEGER
    INTO v_has_bounced_contact, v_valid_contacts
    FROM public.customer_contacts cc
    WHERE cc.customer_id = v_customer.id;

    IF v_has_bounced_contact AND v_valid_contacts = 0 THEN
      v_bounce_pending := v_bounce_pending + 1;
      UPDATE public.alerts
      SET status = 'closed', closed_at = COALESCE(closed_at, now())
      WHERE type = 'cliente_contato_bounced_sem_alternativa'
        AND entity_type = 'customer'
        AND entity_id = v_customer.id::TEXT
        AND NOT EXISTS (
          SELECT 1
          FROM public.alert_items i
          WHERE i.alert_id = public.alerts.id
            AND i.item_type = 'cliente_contato_bounced_sem_alternativa'
        )
        AND status <> 'closed';

      PERFORM public.upsert_alert_item(
        'cliente_contato_bounced_sem_alternativa', 'customer', v_customer.id::TEXT,
        'Cliente sem contato alternativo válido após bounce permanente; atualize o cadastro.',
        v_source, 'documentacao',
        jsonb_build_object(
          'customer_id', v_customer.id,
          'customer_cnpj', v_customer.cnpj_cpf,
          'reason', 'all_contacts_bounced_or_suppressed'
        ),
        '/clientes'
      );
    ELSE
      PERFORM public.resolve_alert_item(
        'cliente_contato_bounced_sem_alternativa', 'customer', v_customer.id::TEXT,
        v_source, jsonb_build_object('reason', 'valid_contact_available')
      );
      UPDATE public.alerts
      SET status = 'closed', closed_at = COALESCE(closed_at, now())
      WHERE type = 'cliente_contato_bounced_sem_alternativa'
        AND entity_type = 'customer'
        AND entity_id = v_customer.id::TEXT
        AND NOT EXISTS (
          SELECT 1
          FROM public.alert_items i
          WHERE i.alert_id = public.alerts.id
            AND i.item_type = 'cliente_contato_bounced_sem_alternativa'
        )
        AND status <> 'closed';
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'noa_pending', v_noa_pending,
    'nor_pending', v_nor_pending,
    'nob_pending', v_nob_pending,
    'bounced_without_alternative', v_bounce_pending,
    'stale_pending_settled', v_stale_pending_settled
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.resolve_customer_contact_bounce_alert_on_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- 471 (D18): contato desativado não é alternativa.
  IF NEW.deactivated_at IS NULL
     AND NULLIF(btrim(NEW.email), '') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.portal_suppressed_emails pse
       WHERE lower(btrim(pse.email)) = lower(btrim(NEW.email))
         AND pse.reason = 'bounce_permanente'
     ) THEN
    PERFORM set_config('alerts.foundation_trigger', 'on', true);
    PERFORM public.resolve_alert_item(
      'cliente_contato_bounced_sem_alternativa', 'customer', NEW.customer_id::TEXT,
      'customer_contact_change', jsonb_build_object('contact_id', NEW.id)
    );
    PERFORM set_config('alerts.foundation_trigger', 'off', true);
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('alerts.foundation_trigger', 'off', true);
  RAISE WARNING 'Reconciliação de alerta de bounce ignorada para customer_contacts.id=%: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$function$;

-- D18: reativar um contato também fecha o alerta na hora (antes só a troca de
-- e-mail disparava; a reativação esperava a varredura).
DROP TRIGGER IF EXISTS resolve_customer_contact_bounce_alert_on_change ON public.customer_contacts;
CREATE TRIGGER resolve_customer_contact_bounce_alert_on_change AFTER INSERT OR UPDATE OF email, deactivated_at ON public.customer_contacts FOR EACH ROW EXECUTE FUNCTION public.resolve_customer_contact_bounce_alert_on_change();
