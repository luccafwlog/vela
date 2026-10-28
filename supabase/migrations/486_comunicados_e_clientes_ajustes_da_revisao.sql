-- 486: Comunicados e Clientes, ajustes da revisão da PR #1070 (decisões do
-- dono de 2026-10-27).
--
-- Problema e mudança, por seção:
--   1. M2 — o envio redirecionado ao suporte (`simulado`) conta como enviado
--      nos alertas (ADR 0104), mas a abertura do alerta "Reenviar Comunicado
--      de CE e Taxas" e a prévia da planilha de CE ainda exigiam `enviado` ou
--      `parcial`: com a chave desligada, trocar o CE nunca abria o alerta.
--   2. P10 — o Novo cliente gravava contatos para qualquer setor. Decisão do
--      dono: só Administrativo, Documentação e Equipamentos criam por ele;
--      os demais trazem o Cliente pela Base e pela Revisão (só o cadastro). O
--      Cliente do manifesto, cadastrado pela ficha do B/L com o e-mail do
--      documento, segue aberto a todos por `create_customer_from_bl_manifest`.
--   3. B10 — o CNPJ era conferido em todo UPDATE do Cliente: depois da 474,
--      o Cliente com CNPJ de dígitos repetidos não podia mais ser editado nem
--      no endereço. Agora o CNPJ é conferido só quando é gravado ou muda.
--   4. B11 — o detalhe da consolidada desfeita no Portal mostrava
--      `obsolete_reason` como gravado, inclusive nota interna da equipe.
--      Agora mostra só a frase da desfeita pelo Cliente.
--   5. B12 — o contato digitado na Revisão ficava sem autor no Histórico.
--
-- Não reescreve dados existentes.
--
-- Rollback: reaplicar `_set_bl_ce_mercante` e `_analyze_ce_mercante_rows` da
-- `230`, `create_customer_with_contacts` da `008`,
-- `canonicalize_customer_cnpj` da `002`, `_portal_invoice_details_legacy_183` da
-- `473` e `_ensure_customer_contact_email` da `474`; DROP FUNCTION
-- public.create_customer_from_bl_manifest(text).

-- 1. O Comunicado redirecionado conta para abrir o alerta de reenvio --------
CREATE OR REPLACE FUNCTION public._set_bl_ce_mercante(p_bl_id text, p_ce text, p_actor uuid, p_reason text, p_source text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_ce text := NULLIF(regexp_replace(COALESCE(p_ce, ''), '\s', '', 'g'), '');
  v_old text;
  v_old_ce text;
  v_previous text := current_setting('vela.ce_mercante_port', true);
  v_result text;
BEGIN
  IF v_ce IS NOT NULL AND v_ce !~ '^[0-9]{15}$' THEN
    RAISE EXCEPTION 'CE Mercante invalido para o B/L %: o CE tem 15 digitos (recebido "%").', p_bl_id, p_ce
      USING ERRCODE = '22023';
  END IF;

  SELECT ce_mercante INTO v_old FROM public.bls WHERE id = p_bl_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L % nao encontrado.', p_bl_id USING ERRCODE = 'P0002';
  END IF;
  v_old_ce := NULLIF(btrim(COALESCE(v_old, '')), '');
  IF v_old_ce IS NOT DISTINCT FROM v_ce THEN
    RETURN 'unchanged';
  END IF;

  -- Mesmo CE em outro formato (máscara, zero à esquerda): a prévia mostra "Sem
  -- mudança"; grava a forma canônica sem reenvio nem alerta (K10).
  IF v_old_ce IS NOT NULL AND v_ce IS NOT NULL
     AND public.ce_mercante_key(v_old_ce) = public.ce_mercante_key(v_ce) THEN
    PERFORM set_config('vela.ce_mercante_port', 'on', true);
    PERFORM public._audit_skip_once('bls', p_bl_id, 'ce_mercante');
    UPDATE public.bls SET ce_mercante = v_ce WHERE id = p_bl_id;
    PERFORM set_config('vela.ce_mercante_port', COALESCE(v_previous, 'off'), true);
    INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
    VALUES ('bl', p_bl_id, 'ce_mercante', v_old, v_ce, p_actor,
      concat_ws(' · ', 'Formato do CE Mercante normalizado (mesmo número)', NULLIF(btrim(COALESCE(p_reason, '')), '')));
    RETURN 'unchanged';
  END IF;

  PERFORM set_config('vela.ce_mercante_port', 'on', true);
  -- O fato vai no Histórico abaixo, com motivo; o gatilho genérico não repete.
  PERFORM public._audit_skip_once('bls', p_bl_id, 'ce_mercante');
  UPDATE public.bls SET ce_mercante = v_ce WHERE id = p_bl_id;
  PERFORM set_config('vela.ce_mercante_port', COALESCE(v_previous, 'off'), true);

  INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  VALUES ('bl', p_bl_id, 'ce_mercante', COALESCE(v_old, ''), COALESCE(v_ce, ''), p_actor, p_reason);

  v_result := CASE
    WHEN v_ce IS NULL THEN 'removed'
    WHEN v_old_ce IS NULL THEN 'inserted'
    ELSE 'overwritten'
  END;

  -- Comunicado de CE e Taxas já enviado com o CE anterior: o Cliente precisa
  -- recebê-lo de novo (ADR 0078, itens 4 e 5).
  IF v_result <> 'inserted' AND EXISTS (
    SELECT 1 FROM public.customer_communications AS c
    JOIN public.customer_communication_bls AS cb ON cb.communication_id = c.id
    WHERE cb.bl_id = p_bl_id AND c.kind = 'ce_mercante_taxas' AND c.status IN ('enviado', 'parcial', 'simulado')
  ) THEN
    BEGIN
      PERFORM public.upsert_alert_item(
        'comunicado_ce_reenvio_pendente', 'bl', p_bl_id,
        format('O CE Mercante do B/L %s mudou (%s -> %s) depois do Comunicado de CE e Taxas: reenvie o Comunicado ao Cliente.',
          p_bl_id, COALESCE(v_old, 'sem CE'), COALESCE(v_ce, 'removido')),
        p_source,
        jsonb_build_object('bl_id', p_bl_id, 'old_ce', v_old, 'new_ce', v_ce, 'reason', p_reason),
        '/bls/' || p_bl_id
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Nao foi possivel abrir a pendencia de reenvio do B/L %: %', p_bl_id, SQLERRM;
    END;
  END IF;

  -- Troca ou remoção depois do Desbloqueio de CE conferido, por qualquer porta
  -- (planilha ou ficha): abre o alerta (ADR 0078, itens 2 e 4; K2). Conferido
  -- é a conciliação ZPT do CE anterior (migration 230, B1).
  IF v_result <> 'inserted' AND public._bl_ce_unlock_conferred(p_bl_id, v_old_ce) THEN
    PERFORM public.upsert_alert_item(
      'ce_trocado_com_desbloqueio', 'bl', p_bl_id,
      CASE WHEN v_ce IS NULL
        THEN format('O CE Mercante do B/L %s foi removido (era %s) depois do Desbloqueio de CE conferido.', p_bl_id, v_old_ce)
        ELSE format('O CE Mercante do B/L %s mudou (%s -> %s) depois do Desbloqueio de CE conferido.', p_bl_id, v_old_ce, v_ce)
      END,
      p_source,
      jsonb_build_object('bl_id', p_bl_id, 'old_ce', v_old_ce, 'new_ce', v_ce, 'reason', p_reason),
      '/bls/' || p_bl_id);
  END IF;

  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public._analyze_ce_mercante_rows(p_rows jsonb, p_manifesto_numero text, p_voyage_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_numero text := public.canonical_manifesto_numero(p_manifesto_numero);
  v_errors jsonb := '[]'::jsonb;
  v_warnings jsonb := '[]'::jsonb;
  v_rows jsonb := '[]'::jsonb;
  v_item jsonb;
  v_bl public.bls%ROWTYPE;
  v_new_ce text;
  v_holders text;
  v_route record;
  v_routes integer;
  v_manifesto public.manifestos_mercante%ROWTYPE;
  v_has_manifesto boolean := false;
  v_active_ids text[] := ARRAY[]::text[];
  v_current_numero text;
  v_status text;
  v_changes integer := 0;
  v_moves integer := 0;
  v_route_voyage bigint;
  v_route_pol text;
  v_route_pod text;
BEGIN
  IF jsonb_typeof(COALESCE(p_rows, 'null'::jsonb)) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RETURN jsonb_build_object('errors', jsonb_build_array(jsonb_build_object('message', 'Nenhuma linha para importar.')),
      'warnings', '[]'::jsonb, 'rows', '[]'::jsonb);
  END IF;
  IF v_numero IS NULL THEN
    v_errors := v_errors || jsonb_build_array(jsonb_build_object('message', 'Informe o número do Manifesto Mercante deste lote antes de importar.'));
  ELSIF v_numero !~ '^[A-Z0-9]{13}$' THEN
    v_errors := v_errors || jsonb_build_array(jsonb_build_object('message',
      format('Nº de Manifesto Mercante inválido: "%s". O número tem 13 caracteres, letras ou dígitos (ex.: 1226501860578).', p_manifesto_numero)));
  ELSE
    SELECT * INTO v_manifesto FROM public.manifestos_mercante WHERE numero = v_numero;
    v_has_manifesto := FOUND;
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    v_new_ce := NULLIF(regexp_replace(COALESCE(v_item->>'ce', ''), '\s', '', 'g'), '');
    SELECT * INTO v_bl FROM public.bls WHERE id = btrim(v_item->>'bl_id');
    IF NOT FOUND THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object('row', v_item->'row', 'bl_id', v_item->>'bl_id',
        'message', format('B/L %s não encontrado no sistema.', v_item->>'bl_id')));
      CONTINUE;
    END IF;
    IF v_bl.cancelled_at IS NOT NULL THEN
      v_warnings := v_warnings || jsonb_build_array(jsonb_build_object('row', v_item->'row', 'bl_id', v_bl.id,
        'message', format('B/L %s cancelado: a linha é ignorada.', v_bl.id)));
      v_rows := v_rows || jsonb_build_array(jsonb_build_object('row', v_item->'row', 'bl_id', v_bl.id, 'status', 'cancelled'));
      CONTINUE;
    END IF;
    IF v_new_ce IS NULL THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object('row', v_item->'row', 'bl_id', v_bl.id,
        'message', format('Linha sem CE Mercante para o B/L %s.', v_bl.id)));
      CONTINUE;
    END IF;
    IF v_new_ce !~ '^[0-9]{15}$' THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object('row', v_item->'row', 'bl_id', v_bl.id,
        'message', format('CE Mercante inválido para o B/L %s: o CE tem 15 dígitos.', v_bl.id)));
      CONTINUE;
    END IF;
    -- Unicidade como no gatilho `guard_ce_mercante_unique`: B/Ls de carga não
    -- cancelados e B/Ls de Granito (ADR 0078, item 3; K7).
    SELECT string_agg(holder, ', ' ORDER BY holder) INTO v_holders FROM (
      SELECT other.id AS holder
      FROM public.bls AS other
      WHERE other.id <> v_bl.id AND other.cancelled_at IS NULL
        AND public.ce_mercante_key(other.ce_mercante) = public.ce_mercante_key(v_new_ce)
      UNION ALL
      SELECT 'B/L de Granito ' || g.bl_number
      FROM public.granite_bls AS g
      WHERE public.ce_mercante_key(g.ce_mercante) = public.ce_mercante_key(v_new_ce)
    ) AS holders;
    IF v_holders IS NOT NULL THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object('row', v_item->'row', 'bl_id', v_bl.id,
        'message', format('O CE Mercante %s já está em outro B/L não cancelado (%s).', v_new_ce, v_holders)));
      CONTINUE;
    END IF;

    v_active_ids := array_append(v_active_ids, v_bl.id);
    SELECT numero INTO v_current_numero FROM public.manifestos_mercante WHERE id = v_bl.manifesto_mercante_id;
    v_status := CASE
      WHEN NULLIF(btrim(COALESCE(v_bl.ce_mercante, '')), '') IS NULL THEN 'new'
      WHEN public.ce_mercante_key(v_bl.ce_mercante) = public.ce_mercante_key(v_new_ce) THEN 'same'
      ELSE 'change'
    END;
    IF v_status = 'change' THEN v_changes := v_changes + 1; END IF;
    IF v_current_numero IS NOT NULL AND v_numero IS NOT NULL AND v_current_numero IS DISTINCT FROM v_numero THEN
      v_moves := v_moves + 1;
    END IF;
    v_rows := v_rows || jsonb_build_array(jsonb_build_object(
      'row', v_item->'row',
      'bl_id', v_bl.id,
      'status', v_status,
      'current_ce', NULLIF(btrim(COALESCE(v_bl.ce_mercante, '')), ''),
      'new_ce', v_new_ce,
      'current_manifesto', v_current_numero,
      'target_manifesto', v_numero,
      'manifesto_change', v_current_numero IS NOT NULL AND v_current_numero IS DISTINCT FROM v_numero,
      'live_invoices', to_jsonb(public._bl_live_invoice_numbers(v_bl.id)),
      'portal_visible', v_bl.customer_id IS NOT NULL AND NULLIF(btrim(COALESCE(v_bl.ce_mercante, '')), '') IS NOT NULL
        AND public.customer_portal_access_ready(v_bl.customer_id),
      'comunicado_sent', EXISTS (
        SELECT 1 FROM public.customer_communications AS c
        JOIN public.customer_communication_bls AS cb ON cb.communication_id = c.id
        WHERE cb.bl_id = v_bl.id AND c.kind = 'ce_mercante_taxas' AND c.status IN ('enviado', 'parcial', 'simulado')),
      'unlock_confirmed', public._bl_ce_unlock_conferred(v_bl.id, v_bl.ce_mercante)
    ));
  END LOOP;

  IF cardinality(v_active_ids) > 0 AND v_numero ~ '^[A-Z0-9]{13}$' THEN
    SELECT count(DISTINCT (b.voyage_id, public.normalize_port_code(b.pol), public.normalize_port_code(b.pod))) INTO v_routes
    FROM public.bls AS b WHERE b.id = ANY(v_active_ids);
    SELECT b.voyage_id, btrim(b.pol) AS pol, btrim(b.pod) AS pod INTO v_route FROM public.bls AS b WHERE b.id = ANY(v_active_ids) ORDER BY b.id LIMIT 1;
    v_route_voyage := v_route.voyage_id; v_route_pol := v_route.pol; v_route_pod := v_route.pod;
    IF v_routes > 1 THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object('message',
        'Os B/Ls da planilha são de mais de uma viagem ou rota (POL → POD). Um manifesto tem uma única rota: separe a planilha por manifesto.'));
    ELSIF NULLIF(v_route.pol, '') IS NULL OR NULLIF(v_route.pod, '') IS NULL THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object('message',
        'Os B/Ls da planilha não têm POL e POD cadastrados; sem rota não há manifesto.'));
    ELSIF p_voyage_id IS NOT NULL AND v_route.voyage_id IS DISTINCT FROM p_voyage_id THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object('message', 'Os B/Ls da planilha não pertencem à viagem selecionada.'));
    ELSIF v_has_manifesto AND (
      v_manifesto.voyage_id IS DISTINCT FROM v_route.voyage_id
      OR COALESCE(public.normalize_port_code(v_manifesto.pol), upper(v_manifesto.pol)) IS DISTINCT FROM public.normalize_port_code(v_route.pol)
      OR COALESCE(public.normalize_port_code(v_manifesto.pod), upper(v_manifesto.pod)) IS DISTINCT FROM public.normalize_port_code(v_route.pod)
      OR v_manifesto.natureza <> 'carga'
    ) THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object('message',
        format('O Manifesto Mercante %s já está cadastrado para outra viagem, rota ou natureza.', v_numero)));
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'errors', v_errors,
    'warnings', v_warnings,
    'rows', v_rows,
    'active_bl_ids', to_jsonb(v_active_ids),
    'manifesto', jsonb_build_object('numero', v_numero, 'exists', v_has_manifesto,
      'voyage_id', v_route_voyage, 'pol', v_route_pol, 'pod', v_route_pod),
    'changes', v_changes,
    'moves', v_moves,
    'needs_confirmation', (v_changes + v_moves) > 0
  );
END;
$function$;

-- 2. Novo cliente só para os três setores dos contatos ----------------------
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
    RAISE EXCEPTION 'Credenciais invalidas para criar cliente.' USING ERRCODE = '42501';
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
        COALESCE(NULLIF(btrim(v_contact->>'name'), ''), 'Contato'),
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

-- Cliente do manifesto pela ficha do B/L: tudo vem do documento (razão social,
-- CNPJ e e-mail do manifesto), nada é digitado; vale para todo setor, como a
-- captura do e-mail do manifesto. Cliente já cadastrado com o CNPJ volta sem
-- mudança.
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
    RAISE EXCEPTION 'Credenciais invalidas para criar cliente.' USING ERRCODE = '42501';
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
    jsonb_build_array(jsonb_build_object('name', 'Contato manifesto', 'email', v_email, 'purpose', 'geral',
      'is_primary', true, 'box_codes', jsonb_build_array('documentacao_operacao', 'financeiro', 'demurrage'))));
  PERFORM set_config('vela.customer_from_manifest', '', true);
  RETURN v_result;
END;
$function$;
REVOKE ALL ON FUNCTION public.create_customer_from_bl_manifest(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_customer_from_bl_manifest(text) TO authenticated;

-- 3. CNPJ conferido só quando muda -----------------------------------------
CREATE OR REPLACE FUNCTION public.canonicalize_customer_cnpj()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  NEW.cnpj_cpf := public.normalize_cnpj(NEW.cnpj_cpf);
  -- 486 (B10): o CNPJ só é conferido quando é gravado ou muda; o Cliente
  -- antigo com CNPJ que a regra da 474 recusa continua editável.
  IF TG_OP = 'UPDATE' AND NEW.cnpj_cpf IS NOT DISTINCT FROM public.normalize_cnpj(OLD.cnpj_cpf) THEN
    RETURN NEW;
  END IF;
  IF NEW.cnpj_cpf IS NULL OR NOT public.is_valid_cnpj(NEW.cnpj_cpf) THEN
    RAISE EXCEPTION 'CNPJ inválido.' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$function$;

-- 4. Portal sem o motivo interno da desfeita -------------------------------
CREATE OR REPLACE FUNCTION public._portal_invoice_details_legacy_183(p_customer_id bigint, p_invoice_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  result jsonb;
  v_covered_by bigint;
  v_covered_by_number text;
BEGIN
  result := public._portal_invoice_details_legacy_134(p_customer_id, p_invoice_id);
  result := result || jsonb_build_object('financial_summary', public._invoice_financial_summary(p_invoice_id));

  IF result #>> '{invoice,status}' = 'covered' THEN
    SELECT cov.id, cov.invoice_number INTO v_covered_by, v_covered_by_number
    FROM public.invoices AS i
    JOIN public.invoices AS cov ON cov.id = i.covered_by_invoice_id
    WHERE i.id = p_invoice_id
      AND public._portal_invoice_visible(p_customer_id, cov.id);
    -- A coberta não cobra mais nada: o saldo do B/L foi quitado pela consolidada.
    result := jsonb_set(result, '{invoice}', (result->'invoice') || jsonb_build_object(
      'balance_brl', 0,
      'covered_by_invoice_id', v_covered_by,
      'covered_by_invoice_number', v_covered_by_number
    ));
  END IF;

  -- 361: a consolidada substituída abre sem QR e aponta a sucessora (decisão 8).
  IF result #>> '{invoice,status}' = 'obsolete' THEN
    SELECT s.id, s.invoice_number INTO v_covered_by, v_covered_by_number
    FROM public.invoices AS s
    WHERE s.replaces_invoice_id = p_invoice_id
      AND public._portal_invoice_visible(p_customer_id, s.id)
    ORDER BY s.id DESC LIMIT 1;
    result := jsonb_set(result, '{invoice}', (result->'invoice') || jsonb_build_object(
      'balance_brl', 0,
      'pix_payload', NULL,
      'replaced_by_invoice_id', v_covered_by,
      'replaced_by_invoice_number', v_covered_by_number,
      -- 473 (POR-D03): a desfeita pelo Cliente diz isso, sem fatura nova.
      -- 486 (B11): o Cliente vê só a frase da consolidada que ele desfez; o
      -- motivo gravado pela equipe é interno.
      'obsolete_reason', (SELECT CASE WHEN i.obsolete_reason = 'Desfeita pelo cliente pelo portal.' THEN i.obsolete_reason END
                            FROM public.invoices i WHERE i.id = p_invoice_id)
    ));
  END IF;

  RETURN result;
END
$function$;

-- 5. Autor do contato digitado na Revisão ----------------------------------
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
    COALESCE(NULLIF(btrim(p_contact_name), ''), 'Contato manifesto'),
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
