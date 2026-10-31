-- 557: contato capturado do B/L sem nome fica em branco.
--
-- Pedido do dono (2026-10-31): o contato que o sistema cria a partir do e-mail
-- do manifesto aparecia no Vela e no Portal com o nome "Contato manifesto". O
-- manifesto não traz o nome da pessoa; o campo deve ficar em branco, e não
-- preenchido com um texto que parece nome.
--
-- Mudança (cada função redefinida com o corpo vigente e só o nome trocado):
-- - `_ensure_customer_contact_email` (corpo da 486): sem nome, grava NULL
--   (antes, "Contato manifesto"); o padrão do parâmetro passa a NULL.
-- - `ensure_customer_contact_email` (474): padrão do nome passa a NULL.
-- - `capture_manifest_financial_contact` (474): captura do manifesto sem nome.
-- - `create_customer_from_bl_manifest` (509): o contato do Cliente criado pelo
--   manifesto vai sem nome.
-- - `create_customer_with_contacts` (509): nome vazio grava NULL (antes,
--   "Contato"). O cadastro pela tela de Clientes continua exigindo nome
--   ("Informe o nome de todo contato preenchido."); só o caminho do manifesto
--   chegava aqui sem nome.
-- O e-mail digitado pela equipe na Revisão segue com a razão social como nome
-- (D07, migration 474).
--
-- Dados existentes: o contato com o nome "Contato manifesto" fica sem nome.
-- Essa limpeza reescreve linhas e depende do "Data status" do AGENTS.md (seção
-- Gotchas): o banco de produção só tem dados de teste. Os eventos do Histórico
-- do Cliente já gravados não mudam.
--
-- CREATE OR REPLACE mantém os privilégios das funções.
--
-- Rollback: recriar as cinco funções com os corpos de 486, 474 e 509 (nomes
-- "Contato manifesto" e "Contato"); os nomes limpos não voltam sozinhos.

CREATE OR REPLACE FUNCTION public._ensure_customer_contact_email(p_customer_id bigint, p_email text, p_contact_name text DEFAULT NULL::text, p_purpose text DEFAULT 'financeiro'::text, p_related_bl_id text DEFAULT NULL::text, p_origin text DEFAULT 'bl_automatico'::text)
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
  -- 474: núcleo interno, sem a guarda de quem chama (a de cada chamador vale).
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
    -- 557: sem nome no manifesto, o contato fica sem nome (antes, "Contato manifesto").
    NULLIF(btrim(p_contact_name), ''),
    v_email,
    p_origin,
    NOT v_has_primary,
    COALESCE(NULLIF(btrim(p_purpose), ''), 'financeiro')
  )
  RETURNING id INTO v_contact_id;

  INSERT INTO public.customer_contact_change_events (
    customer_id, source, actor_id, related_bl_id, after_snapshot, change_summary
  )
  VALUES (
    p_customer_id,
    p_origin,
    -- 486 (B12): o e-mail digitado pela equipe leva o autor ao Histórico.
    CASE WHEN p_origin = 'interno' THEN auth.uid() END,
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

CREATE OR REPLACE FUNCTION public.ensure_customer_contact_email(p_customer_id bigint, p_email text, p_contact_name text DEFAULT NULL::text, p_purpose text DEFAULT 'financeiro'::text, p_related_bl_id text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
BEGIN
  -- 474 (ACE-D04): chamada direta só de Administrativo, Documentação e
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
  RETURN public._ensure_customer_contact_email(p_customer_id, p_email, NULL);
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
    RAISE EXCEPTION 'B/L % nao encontrado.', p_bl_id USING ERRCODE = 'P0002';
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
  v_result := public.create_customer_with_contacts(
    jsonb_build_object('cnpj_cpf', v_cnpj, 'name', btrim(v_bl.manifest_customer_name)),
    jsonb_build_array(jsonb_build_object('email', v_email, 'purpose', 'geral',
      'is_primary', true, 'box_codes', jsonb_build_array('documentacao_operacao', 'financeiro', 'demurrage'))));
  PERFORM set_config('vela.customer_from_manifest', '', true);
  RETURN v_result;
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

  RETURN to_jsonb(v_customer);
END;
$function$;

UPDATE public.customer_contacts
   SET name = NULL
 WHERE name = 'Contato manifesto';
