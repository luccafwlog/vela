-- 184 — Base de Clientes vincula só B/Ls pendentes, libera a Revisão e pede
-- confirmação para trocar a razão social (ADR 0078, item 24; Etapa 11 do plano
-- 2026-10-09-correcao-importacoes-ce-mercante).
--
-- O vínculo retroativo passa a: ignorar B/L rejeitado na Revisão; gravar o
-- vínculo como por documento (`matched_document`) com Histórico; reavaliar a
-- Revisão (`apply_bl_review_gate_after_import`) e calcular as Taxas Locais para
-- o faturamento seguir. Razão social diferente da gravada exige
-- `p_confirm_name_change`.

DROP FUNCTION public.apply_customer_base_row_atomic(text, text, text, text, text, text, text, jsonb, uuid);

CREATE FUNCTION public.apply_customer_base_row_atomic(p_cnpj text, p_name text, p_trade_name text, p_address text, p_city text, p_state text, p_zip text, p_emails jsonb, p_changed_by uuid, p_confirm_name_change boolean DEFAULT false)
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

  -- Vinculo retroativo: so B/Ls ainda sem cliente, mesmo CNPJ.
  -- Só B/Ls pendentes de Cliente, nunca o rejeitado na Revisão (que recebe o
  -- Cliente à mão); o vínculo é por documento e a Revisão é reavaliada.
  WITH linked AS (
    UPDATE public.bls AS b
      SET customer_id = v_customer_id,
          customer_reconciliation_status = 'matched_document'
      WHERE b.manifest_customer_cnpj_cpf = v_cnpj
        AND b.customer_id IS NULL
        AND b.cancelled_at IS NULL
        AND COALESCE(b.customer_reconciliation_status, 'missing_customer') <> 'rejected'
      RETURNING b.id
  )
  SELECT array_agg(id ORDER BY id) INTO v_linked FROM linked;
  v_bls_linked := COALESCE(cardinality(v_linked), 0);

  IF v_bls_linked > 0 THEN
    FOREACH v_bl IN ARRAY v_linked LOOP
      INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
      VALUES ('bl', v_bl, 'customer_id', NULL, v_customer_id::text, v_actor, 'Vínculo por documento pela Base de Clientes');
    END LOOP;
    PERFORM public.apply_bl_review_gate_after_import(v_linked, v_actor);
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
REVOKE ALL ON FUNCTION public.apply_customer_base_row_atomic(text, text, text, text, text, text, text, jsonb, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_customer_base_row_atomic(text, text, text, text, text, text, text, jsonb, uuid, boolean) TO authenticated;
