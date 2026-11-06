-- 595: endereço da Receita no cadastro do Cliente pela Revisão (pedido do dono
-- de 2026-11-05, ADR 0126).
--
-- `complete_review_customer_group` ganha `p_profile jsonb DEFAULT NULL` com
-- `trade_name`, `address`, `city`, `state` e `zip`, que a tela preenche com os
-- dados da Receita (Edge Function `cnpj-lookup`). Só o Cliente criado pela
-- função recebe esses campos; o Cliente já cadastrado (escolhido, achado pelo
-- CNPJ ou criado por outra sessão no meio, `unique_violation`) não muda. UF
-- fora de 2 letras e CEP fora de 8 dígitos viram nulos, como no Novo cliente.
-- `p_profile` que não é objeto JSON é recusado.
--
-- Assinatura nova: o parâmetro a mais exige DROP e CREATE (CREATE OR REPLACE
-- criaria uma sobrecarga ao lado da antiga). O corpo é o vigente (474; o
-- pg_get_functiondef no Postgres local com a cadeia até a 594 confere com
-- ela) com só as linhas do perfil a mais. Grants refeitos como os da antiga
-- (002): nada para PUBLIC e anon, EXECUTE para authenticated. A chamada sem
-- `p_profile` (tela anterior ao deploy) continua igual: o parâmetro é
-- opcional e o PostgREST chama por nome.
--
-- Só redefine a função; não grava nem reescreve linhas.
-- Rollback: DROP da função de 7 parâmetros e reaplicar a definição da 474
-- (com os grants da 002).

DROP FUNCTION public.complete_review_customer_group(text[], bigint, text, text, text, uuid);

CREATE FUNCTION public.complete_review_customer_group(p_bl_ids text[], p_customer_id bigint DEFAULT NULL::bigint, p_cnpj_cpf text DEFAULT NULL::text, p_name text DEFAULT NULL::text, p_email text DEFAULT NULL::text, p_changed_by uuid DEFAULT NULL::uuid, p_profile jsonb DEFAULT NULL::jsonb)
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
  -- 474 (D10): só quem edita contatos inclui o e-mail; os demais cadastram o Cliente.
  v_can_contacts BOOLEAN := public._can_edit_customer_contacts();
  -- 595 (ADR 0126): dados da Receita para o Cliente criado aqui. Normalizados
  -- como no Novo cliente: UF com 2 letras e CEP com 8 dígitos, senão nulos.
  v_trade_name TEXT := NULLIF(btrim(p_profile->>'trade_name'), '');
  v_address TEXT := NULLIF(btrim(p_profile->>'address'), '');
  v_city TEXT := NULLIF(btrim(p_profile->>'city'), '');
  v_state TEXT := upper(NULLIF(btrim(p_profile->>'state'), ''));
  v_zip TEXT := NULLIF(regexp_replace(COALESCE(p_profile->>'zip', ''), '\D', '', 'g'), '');
BEGIN
  IF p_profile IS NOT NULL AND jsonb_typeof(p_profile) <> 'object' THEN
    RAISE EXCEPTION 'Dados cadastrais do cliente em formato inválido.' USING ERRCODE = '22023';
  END IF;
  IF v_state !~ '^[A-Z]{2}$' THEN v_state := NULL; END IF;
  IF v_zip !~ '^[0-9]{8}$' THEN v_zip := NULL; END IF;
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
        -- Só o Cliente criado aqui recebe o perfil: o já cadastrado (escolhido
        -- ou achado pelo CNPJ, inclusive na corrida abaixo) não muda.
        INSERT INTO public.customers (cnpj_cpf, name, trade_name, address, city, state, zip)
        VALUES (v_cnpj, v_name, v_trade_name, v_address, v_city, v_state, v_zip)
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

REVOKE ALL ON FUNCTION public.complete_review_customer_group(text[], bigint, text, text, text, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_review_customer_group(text[], bigint, text, text, text, uuid, jsonb) TO authenticated;
